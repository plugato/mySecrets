// MySecrets — passkeys, parte do content script (mundo isolado).
//
// Recebe os pedidos do passkey-page.js (mundo da página), pergunta ao usuário
// num cartão em shadow DOM fechado e fala com o background, que confere a
// origem da aba e chama o app. Só cliques de verdade (isTrusted) contam: a
// página não consegue escolher uma passkey sozinha.
(() => {
  'use strict';
  if (window.top !== window) return;

  const CANAL = 'mysecrets-passkey';

  function msg(chave, pt, subs) {
    const lista = subs === undefined ? [] : [].concat(subs).map(String);
    let s;
    try { s = (globalThis.chrome && chrome.i18n && chrome.i18n.getMessage(chave, lista)) || ''; } catch (_) { s = ''; }
    return s || pt.replace(/\$(\d)/g, (m, n) => (lista[n - 1] !== undefined ? lista[n - 1] : m));
  }

  const responder = (id, dados) => window.postMessage({ canal: CANAL, tipo: 'resposta', id, ...dados }, window.location.origin);

  function background(mensagem) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(mensagem, (r) => {
          if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
          else resolve(r || { success: false });
        });
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  }

  // ===== cartão =====
  let aberto = null; // { id, host }

  function fechar(id) {
    if (!aberto || (id && aberto.id !== id)) return;
    aberto.host.remove();
    aberto = null;
  }

  function cartao(id, titulo, sub) {
    if (aberto) { responder(aberto.id, { erro: { name: 'NotAllowedError', message: 'Substituído por outro pedido' } }); fechar(); }
    const host = document.createElement('div');
    host.style.cssText = 'position: fixed; top: 16px; right: 16px; z-index: 2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .card { width: 340px; box-sizing: border-box; padding: 14px 16px; border-radius: 12px;
          background: #fff; color: #1d1d1f; box-shadow: 0 8px 28px rgba(0,0,0,.22);
          font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        @media (prefers-color-scheme: dark) { .card { background: #1f2024; color: #ececec; } .sub, .conta small { color: #a0a4ab !important; } }
        .topo { display: flex; gap: 10px; align-items: center; }
        img { width: 28px; height: 28px; border-radius: 6px; }
        .titulo { font-weight: 600; }
        .sub { color: #5f6368; font-size: 13px; margin-top: 2px; word-break: break-all; }
        .contas { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
        .conta { text-align: left; background: rgba(91,91,214,.10); color: inherit; }
        .conta small { display: block; color: #5f6368; font-size: 12px; }
        .acoes { display: flex; gap: 8px; margin-top: 12px; align-items: center; flex-wrap: wrap; }
        button { font: inherit; border: 0; border-radius: 8px; padding: 7px 14px; cursor: pointer; }
        button:focus-visible { outline: 2px solid #5b5bd6; outline-offset: 2px; }
        .principal { background: #5b5bd6; color: #fff; font-weight: 600; }
        .secundario { background: rgba(127,127,127,.15); color: inherit; }
        .cancelar { background: none; color: inherit; opacity: .7; padding: 7px 4px; margin-left: auto; font-size: 12px; text-decoration: underline; }
        .status { margin-top: 10px; font-size: 13px; }
      </style>
      <div class="card" role="dialog" aria-label="MySecrets">
        <div class="topo"><img alt=""><div><div class="titulo"></div><div class="sub"></div></div></div>
        <div class="contas"></div>
        <div class="status" hidden></div>
        <div class="acoes"></div>
      </div>`;
    root.querySelector('img').src = chrome.runtime.getURL('icons/icon48.png');
    root.querySelector('.titulo').textContent = titulo;
    root.querySelector('.sub').textContent = sub;
    document.documentElement.appendChild(host);
    aberto = { id, host };

    const botao = (onde, classe, texto, acao) => {
      const b = document.createElement('button');
      b.className = classe;
      b.textContent = texto;
      b.addEventListener('click', (ev) => { if (ev.isTrusted) acao(b); });
      root.querySelector(onde).appendChild(b);
      return b;
    };
    const status = (texto) => {
      const s = root.querySelector('.status');
      s.hidden = !texto;
      s.textContent = texto || '';
      root.querySelectorAll('button').forEach((b) => { b.disabled = !!texto; });
    };
    return { root, botao, status };
  }

  const recusa = { erro: { name: 'NotAllowedError', message: 'Cancelado pelo usuário' } };
  const devolver = (id, r) => { fechar(id); responder(id, r); };
  const resultado = (r) => (r && r.success ? { credencial: r.credential } : { erro: { name: (r && r.name) || 'NotAllowedError', message: (r && r.error) || 'Falhou' } });

  // ===== get =====
  async function entrar(id, dados) {
    const lista = await background({ type: 'passkey_list', rpId: dados.rpId, allowCredentials: dados.allowCredentials });
    // App fechado, cofre bloqueado ou nenhuma passkey do site: o navegador cuida
    if (!lista.success || !lista.passkeys || !lista.passkeys.length) return responder(id, { nativo: true });

    const ui = cartao(id, msg('passkeyGetTitle', 'Entrar com uma passkey do MySecrets'), lista.rpId);
    for (const p of lista.passkeys) {
      ui.botao('.contas', 'conta', '', async () => {
        ui.status(msg('passkeySigning', 'Entrando…'));
        const r = await background({ type: 'passkey_get', rpId: dados.rpId, challenge: dados.challenge, credentialId: p.credentialId });
        devolver(id, resultado(r));
      }).replaceChildren(document.createTextNode(p.userName || p.userDisplayName || p.title), Object.assign(document.createElement('small'), { textContent: p.userDisplayName && p.userDisplayName !== p.userName ? p.userDisplayName : p.title }));
    }
    ui.botao('.acoes', 'secundario', msg('passkeyOtherDevice', 'Usar outro dispositivo'), () => devolver(id, { nativo: true }));
    ui.botao('.acoes', 'cancelar', msg('passkeyCancel', 'Cancelar'), () => devolver(id, recusa));
  }

  // ===== create =====
  async function criar(id, dados) {
    // Confere se o app está disponível e se o rpId é deste site antes de oferecer
    const teste = await background({ type: 'passkey_list', rpId: dados.rp.id, allowCredentials: [] });
    if (!teste.success) return responder(id, teste.name === 'SecurityError' ? resultado(teste) : { nativo: true });

    const conta = dados.user.name || dados.user.displayName || '';
    const ui = cartao(id, msg('passkeyCreateTitle', 'Salvar uma passkey no MySecrets?'), conta ? `${conta} · ${teste.rpId}` : teste.rpId);
    ui.botao('.acoes', 'principal', msg('passkeySave', 'Salvar no MySecrets'), async () => {
      ui.status(msg('passkeyConfirmInApp', 'Confirme no app MySecrets…'));
      const r = await background({ type: 'passkey_create', rp: dados.rp, user: dados.user, challenge: dados.challenge, excludeCredentials: dados.excludeCredentials });
      devolver(id, resultado(r));
    });
    ui.botao('.acoes', 'secundario', msg('passkeyOtherDevice', 'Usar outro dispositivo'), () => devolver(id, { nativo: true }));
    ui.botao('.acoes', 'cancelar', msg('passkeyCancel', 'Cancelar'), () => devolver(id, recusa));
  }

  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (ev.source !== window || !d || d.canal !== CANAL || typeof d.id !== 'string') return;
    if (d.tipo === 'cancelar') return fechar(d.id);
    if (d.tipo !== 'pedido' || !d.dados || typeof d.dados !== 'object') return;
    const falhar = (e) => responder(d.id, { erro: { name: 'NotAllowedError', message: e.message } });
    if (d.op === 'get') entrar(d.id, d.dados).catch(falhar);
    else if (d.op === 'create') criar(d.id, d.dados).catch(falhar);
  });
})();
