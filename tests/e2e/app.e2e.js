// Testes ponta a ponta no app Electron de verdade (perfil temporário).
// npm run test:e2e  (no Linux sem tela: xvfb-run -a npm run test:e2e)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { launchApp, ROOT } = require('./app');
const { encryptVault, decryptVault } = require('../../src/lib/vault-crypto');

const PW = 'senha-de-teste-e2e';
const T = (m) => new Date(Date.UTC(2026, 10, 5, 12, m)).toISOString();
let app;

before(async () => { app = await launchApp(); });
after(async () => { if (app) await app.close(); });

const api = (code) => app.evaluate(`(async () => JSON.stringify(await (${code})))()`).then(JSON.parse);
const vaultFile = () => path.join(app.vaultDir, 'secrets.enc');
const readDisk = () => JSON.parse(decryptVault(JSON.parse(fs.readFileSync(vaultFile(), 'utf8')), PW));

test('gerador de senhas no preload real (sandbox)', async () => {
  const r = await app.evaluate(`JSON.stringify({ a: window.electronAPI.generatePassword(20, true), b: window.electronAPI.generatePassword(12, false) })`).then(JSON.parse);
  assert.strictEqual(r.a.length, 20);
  assert.match(r.b, /^[A-Za-z0-9]{12}$/);
});

test('dados do cofre nunca viram HTML (lista, grade, MFA, detalhes, importação)', async () => {
  const injetados = await app.evaluate(`(async () => {
    const P = '"><img src=x data-pwn=1><b data-pwn=1>';
    const evil = { id: 'id' + P, type: 'mfa' + P, title: 'T' + P, username: 'u' + P, url: 'https://x' + P,
      mfaSecret: 'JBSWY3DPEHPK3PXP', mfaAlgorithm: 'totp' + P, mfaDigits: '6' + P, mfaPeriod: '30' + P,
      mfaHash: 'sha1' + P, mfaCounter: '0' + P, tokenType: 'api' + P, token: 'tok', tags: [] };
    const host = document.createElement('div'); document.body.appendChild(host);
    host.appendChild(createEntryElement(evil));
    host.appendChild(createGridCard(evil));
    host.appendChild(createMFARow({ ...evil, mfaAlgorithm: 'hotp' }));
    showImportPreview([{ ...evil, type: 'login' }, { ...evil, type: 'token' }]);
    await renderEntryDetails({ ...evil, type: 'mfa', mfaAlgorithm: 'hotp' });
    await renderEntryDetails({ ...evil, type: 'token' });
    const n = document.querySelectorAll('[data-pwn]').length;
    host.remove();
    return n;
  })()`);
  assert.strictEqual(injetados, 0);
});

test('salvar com a tela desatualizada (o sync gravou por baixo) mescla em vez de apagar', async () => {
  assert.strictEqual((await api(`window.electronAPI.saveData([{id:'a',type:'note',title:'A',updatedAt:'${T(1)}'}], '${PW}', {autoBackup:false})`)).success, true);
  assert.strictEqual((await api(`window.electronAPI.loadData('${PW}')`)).data.length, 1);
  // "Sincronização" grava uma entrada vinda de outro aparelho direto no disco
  fs.writeFileSync(vaultFile(), JSON.stringify(encryptVault(JSON.stringify([
    { id: 'a', type: 'note', title: 'A', updatedAt: T(1) },
    { id: 'b', type: 'note', title: 'Do celular', updatedAt: T(2) }
  ]), PW)));
  const r = await api(`window.electronAPI.saveData([{id:'a',type:'note',title:'A editada',updatedAt:'${T(3)}'}], '${PW}', {autoBackup:false})`);
  assert.strictEqual(r.merged, true);
  assert.deepStrictEqual(readDisk().map((e) => `${e.id}:${e.title}`).sort(), ['a:A editada', 'b:Do celular']);
  // Agora a tela tem "b": apagar de verdade funciona
  await api(`window.electronAPI.saveData([{id:'a',type:'note',title:'A editada',updatedAt:'${T(3)}'}], '${PW}', {autoBackup:false})`);
  assert.deepStrictEqual(readDisk().map((e) => e.id), ['a']);
});

test('bloquear tira o cofre da página', async () => {
  const r = await app.evaluate(`(async () => {
    const e = [{id:'l1',type:'login',title:'Banco XYZ',username:'eu',password:'segredo-visivel',updatedAt:new Date().toISOString()},
               {id:'m1',type:'mfa',title:'2FA Banco',mfaSecret:'JBSWY3DPEHPK3PXP',mfaAlgorithm:'totp',updatedAt:new Date().toISOString()}];
    await window.electronAPI.saveData(e, '${PW}', {autoBackup:false});
    const r = await window.electronAPI.loadData('${PW}');
    currentMasterPassword = '${PW}'; currentData = r.data; filteredData = r.data;
    renderEntries(); await renderEntryDetails(r.data[0]); renderMFACodes();
    const antes = document.body.innerHTML.includes('Banco XYZ');
    lockApp();
    const html = document.body.innerHTML;
    return JSON.stringify({ antes, depois: ['Banco XYZ', '2FA Banco', 'segredo-visivel', 'JBSWY3DPEHPK3PXP'].filter((t) => html.includes(t)) });
  })()`).then(JSON.parse);
  assert.strictEqual(r.antes, true);
  assert.deepStrictEqual(r.depois, []);
});

test('acessibilidade: modal prende o foco; axe sem violações WCAG A/AA nos 5 temas', async () => {
  await app.evaluate(fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8'));
  const modal = await app.evaluate(`(async () => {
    const origem = document.createElement('button'); origem.id = 'origem-e2e'; origem.textContent = 'origem'; document.body.appendChild(origem); origem.focus();
    const m = document.getElementById('entry-modal'); m.style.display = 'flex';
    await new Promise((r) => setTimeout(r, 100));
    const dentro = m.contains(document.activeElement);
    const dialog = m.getAttribute('role') === 'dialog' && m.getAttribute('aria-modal') === 'true';
    const axeModal = (await axe.run(m, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v) => v.id);
    m.style.display = 'none';
    await new Promise((r) => setTimeout(r, 100));
    const voltou = document.activeElement && document.activeElement.id;
    origem.remove();
    return JSON.stringify({ dentro, dialog, axeModal, voltou });
  })()`).then(JSON.parse);
  assert.deepStrictEqual(modal, { dentro: true, dialog: true, axeModal: [], voltou: 'origem-e2e' });

  // Sem animação de troca de tema: o axe mede as cores finais (e exercita a
  // regra prefers-reduced-motion do CSS)
  await app.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const porTema = await app.evaluate(`(async () => {
    const DEBUG = ${JSON.stringify(!!process.env.E2E_DEBUG)};
    const e = [{id:'a1',type:'login',title:'Banco',username:'eu',password:'x',url:'https://b.com',tags:['t'],updatedAt:new Date().toISOString()},
               {id:'m1',type:'mfa',title:'2FA',mfaSecret:'JBSWY3DPEHPK3PXP',mfaAlgorithm:'totp',updatedAt:new Date().toISOString()},
               {id:'t1',type:'token',title:'API',token:'abc',tokenType:'api',updatedAt:new Date().toISOString()}];
    await window.electronAPI.saveData(e, '${PW}', {autoBackup:false});
    const r = await window.electronAPI.loadData('${PW}');
    currentMasterPassword = '${PW}'; currentData = r.data; filteredData = r.data;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('main-screen').style.display = 'flex';
    const out = {};
    for (const tema of ['light', 'dark', 'ocean', 'forest', 'sunset']) {
      document.body.setAttribute('data-theme', tema);
      renderEntries(); await renderEntryDetails(r.data[0]);
      // Espera as cores pararem de mudar (troca de tema) antes de medir
      const amostra = () => [...document.querySelectorAll('body, h1, .sidebar-header h3, .entry-item p, .filter-btn.active span')]
        .map((el) => getComputedStyle(el).color + getComputedStyle(el).backgroundColor).join('|');
      let anterior = '';
      for (let k = 0; k < 40; k++) {
        await new Promise((x) => requestAnimationFrame(() => requestAnimationFrame(x)));
        await new Promise((x) => setTimeout(x, 50));
        const agora = amostra();
        if (agora === anterior) break;
        anterior = agora;
      }
      out[tema] = (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v) => v.id + ' x' + v.nodes.length + (DEBUG ? ' ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' ' + ((n.any[0] && n.any[0].message) || '').slice(0, 120)).join(' | ') : ''));
    }
    lockApp();
    return JSON.stringify(out);
  })()`).then(JSON.parse);
  assert.deepStrictEqual(porTema, { light: [], dark: [], ocean: [], forest: [], sunset: [] });
});

test('servidor MCP sobe pelo app e responde get_otp e match_url', async () => {
  const port = 30000 + Math.floor(Math.random() * 20000);
  await api(`window.electronAPI.saveData([{id:'m1',type:'mfa',title:'X',mfaSecret:'JBSWY3DPEHPK3PXP',mfaAlgorithm:'totp',url:'https://github.com',updatedAt:new Date().toISOString()}], '${PW}', {autoBackup:false})`);
  await api(`window.electronAPI.loadData('${PW}')`);
  const st = await api(`window.electronAPI.mcpStart({ port: ${port} })`);
  try {
    assert.strictEqual(st.success, true, st.error);
    const tok = st.status.info.token;
    const call = async (name, args) => {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
      });
      return JSON.parse((await res.json()).result.content[0].text);
    };
    assert.match((await call('get_otp', { id: 'm1' })).code, /^\d{6}$/);
    assert.deepStrictEqual((await call('match_url', { url: 'https://gist.github.com' })).results.map((e) => e.id), ['m1']);
    assert.strictEqual((await call('match_url', { url: 'https://hub.com' })).count, 0);

    // Atividade recente: a leitura do código aparece com o título; match_url não entra
    const atividade = await app.evaluate(`(async () => {
      const r = await window.electronAPI.loadData('${PW}');
      currentData = r.data;
      await openMcpModal();
      const texto = document.getElementById('mcp-audit-list').textContent;
      document.getElementById('mcp-modal').style.display = 'none';
      return texto;
    })()`);
    assert.match(atividade, /leu o código 2FA de X/);
    assert.ok(!/match_url/.test(atividade));
  } finally {
    await api('window.electronAPI.mcpStop()');
  }
});

test('painel de códigos MFA e detalhes da mesma entrada não compartilham ids', async () => {
  const r = await app.evaluate(`(async () => {
    const e = [{id:'mx',type:'mfa',title:'2FA X',mfaSecret:'JBSWY3DPEHPK3PXP',mfaAlgorithm:'totp',updatedAt:new Date().toISOString()}];
    await window.electronAPI.saveData(e, '${PW}', {autoBackup:false});
    const r = await window.electronAPI.loadData('${PW}');
    currentMasterPassword = '${PW}'; currentData = r.data; filteredData = r.data;
    await renderEntryDetails(r.data[0]);
    renderMFACodes();
    await new Promise((x) => setTimeout(x, 1500));
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
    const duplicados = ids.filter((id, i) => ids.indexOf(id) !== i);
    const linha = document.getElementById('mfa-row-code-mx');
    const detalhe = document.getElementById('mfa-code-mx');
    const out = { duplicados, linha: linha && linha.textContent.trim(), detalhe: detalhe && detalhe.textContent.trim() };
    lockApp();
    return JSON.stringify(out);
  })()`).then(JSON.parse);
  assert.deepStrictEqual(r.duplicados, []);
  assert.match(r.linha, /^\d{6}$/, 'o painel mostra o código, não ••••••');
  assert.match(r.detalhe, /^\d{6}$/);
});

test('TOTP de 60 s pelo app real usa o período certo', async () => {
  const ref = require('../helpers/rfc-otp');
  const S = 'JBSWY3DPEHPK3PXP';
  const antes = Date.now();
  const r = await api(`window.electronAPI.generateTOTP('${S}', { period: 60 })`);
  const depois = Date.now();
  const esperados = [antes, depois].map((t) => ref.totp(S, t, { period: 60 }));
  assert.strictEqual(r.period, 60);
  assert.ok(esperados.includes(r.code), `código ${r.code} não é o de 60 s (${esperados})`);
});

test('agente pede para gravar pelo MCP: app mostra a confirmação e grava ao aprovar; recusa não grava', async () => {
  const port = 30000 + Math.floor(Math.random() * 20000);
  await app.evaluate(`(async () => {
    await window.electronAPI.saveData([], '${PW}', {autoBackup:false});
    const r = await window.electronAPI.loadData('${PW}');
    currentMasterPassword = '${PW}'; currentData = r.data; filteredData = r.data;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('main-screen').style.display = 'flex';
  })()`);
  const st = await api(`window.electronAPI.mcpStart({ port: ${port} })`);
  try {
    assert.strictEqual(st.success, true, st.error);
    const pedir = (args) => fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.status.info.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'store_secret', arguments: args } })
    }).then((r) => r.json()).then((b) => ({ isError: !!b.result.isError, data: JSON.parse(b.result.content[0].text) }));
    const esperarModal = () => app.evaluate(`(async () => {
      for (let i = 0; i < 50; i++) {
        if (getComputedStyle(document.getElementById('agent-write-modal')).display !== 'none') return document.getElementById('agent-write-body').textContent;
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    })()`);

    // Aprovado: grava
    const p1 = pedir({ title: 'Chave do agente', type: 'token', token: 'tok-123', project: 'e2e' });
    const texto = await esperarModal();
    assert.ok(texto && texto.includes('Chave do agente'), 'modal mostra o pedido');
    await app.evaluate(`document.getElementById('agent-write-approve').click()`);
    const r1 = await p1;
    assert.strictEqual(r1.isError, false, JSON.stringify(r1.data));
    assert.strictEqual(r1.data.saved, true);
    assert.ok(readDisk().some((e) => e.title === 'Chave do agente' && e.token === 'tok-123'));

    // Recusado: não grava
    const p2 = pedir({ title: 'Recusada', type: 'note', notes: 'x' });
    assert.ok(await esperarModal());
    await app.evaluate(`document.getElementById('agent-write-decline').click()`);
    const r2 = await p2;
    assert.strictEqual(r2.isError, true);
    assert.strictEqual(r2.data.declined, true);
    assert.ok(!readDisk().some((e) => e.title === 'Recusada'));
  } finally {
    await api('window.electronAPI.mcpStop()');
    await app.evaluate('lockApp()');
  }
});

test('pela interface: criar o cofre, adicionar uma entrada, bloquear e desbloquear', async () => {
  const ui = await launchApp();
  try {
    const ev = (js) => ui.evaluate(`(async () => { ${js} })()`);
    const preencher = (id, valor) => `{ const el = document.getElementById('${id}'); el.value = ${JSON.stringify(valor)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }`;
    const esperar = (cond) => ev(`for (let i = 0; i < 60; i++) { if (${cond}) return true; await new Promise((r) => setTimeout(r, 100)); } return false;`);
    const visivel = (id) => `(getComputedStyle(document.getElementById('${id}')).display !== 'none')`;

    // Perfil novo: sem servidor MCP automático (não disputa a porta 8765)
    await ev(`localStorage.setItem('settings', JSON.stringify({ mcpAutoStart: false })); location.reload();`).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    for (let i = 0; i < 40 && !(await ui.evaluate('typeof renderEntries === "function"').catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));

    assert.ok(await esperar(visivel('setup-form')), 'tela de criar cofre');
    await ev(`${preencher('new-master-password', 'Senha-Mestra-Forte-123!')} ${preencher('confirm-master-password', 'Senha-Mestra-Forte-123!')} document.getElementById('setup-btn').click();`);
    assert.ok(await esperar(visivel('main-screen')), 'cofre criado e aberto');

    await ev(`document.getElementById('add-entry-btn').click();`);
    assert.ok(await esperar(visivel('entry-modal')), 'formulário abre pelo botão');
    await ev(`${preencher('entry-type', 'login')} ${preencher('entry-title', 'Conta pela interface')} ${preencher('entry-username', 'eu@exemplo.com')} ${preencher('entry-password', 'senha-da-conta')} ${preencher('entry-url', 'https://exemplo.com')} document.getElementById('save-btn').click();`);
    assert.ok(await esperar(`document.getElementById('entries-list').textContent.includes('Conta pela interface')`), 'entrada aparece na lista');
    const disco = JSON.parse(decryptVault(JSON.parse(fs.readFileSync(path.join(ui.vaultDir, 'secrets.enc'), 'utf8')), 'Senha-Mestra-Forte-123!'));
    assert.ok(disco.some((e) => e.title === 'Conta pela interface' && e.password === 'senha-da-conta'), 'gravada no disco');

    await ev(`document.getElementById('lock-btn').click();`);
    assert.ok(await esperar(visivel('login-form') + ` && !document.body.innerHTML.includes('Conta pela interface')`), 'bloqueado e sem dados na página');

    await ev(`${preencher('master-password', 'senha-errada')} document.getElementById('login-btn').click();`);
    assert.ok(await esperar(`document.getElementById('login-error').textContent.trim().length > 0`), 'senha errada mostra erro');
    await ev(`${preencher('master-password', 'Senha-Mestra-Forte-123!')} document.getElementById('login-btn').click();`);
    assert.ok(await esperar(visivel('main-screen') + ` && document.getElementById('entries-list').textContent.includes('Conta pela interface')`), 'desbloqueado com a entrada');
  } finally {
    await ui.close();
  }
});

test('senhas vazadas: só prefixos de 5 caracteres saem; a vazada aparece no painel', async () => {
  const crypto = require('node:crypto');
  const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex').toUpperCase();
  const VAZADA = sha1('password');
  const r = await app.evaluate(`(async () => {
    const e = [{id:'v1',type:'login',title:'Conta vazada',username:'eu',password:'password',updatedAt:new Date().toISOString()},
               {id:'v2',type:'login',title:'Conta segura',username:'eu',password:'qZ8!vN2#Lm5$wR9@xT4',updatedAt:new Date().toISOString()}];
    await window.electronAPI.saveData(e, '${PW}', {autoBackup:false});
    const r = await window.electronAPI.loadData('${PW}');
    currentMasterPassword = '${PW}'; currentData = r.data; filteredData = r.data;
    const pedidos = [];
    // API falsa: responde a sufixo da senha vazada (e um de preenchimento)
    const falsa = async (pre) => {
      pedidos.push(pre);
      const linhas = ['0018A45C4D1DEF81644B54AB7F969B88D65:0'];
      if (pre === '${VAZADA.slice(0, 5)}') linhas.push('${VAZADA.slice(5)}:9545824');
      return { success: true, text: linhas.join('\\r\\n') };
    };
    pwnedState = await checkPwnedPasswords(falsa);
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('main-screen').style.display = 'flex';
    showHealthOverview();
    const painel = document.getElementById('health-overview').textContent;
    const out = { pedidos, vazadas: computeHealthIssues().leaked.map((x) => x.id), painel: painel.includes('Conta vazada') && painel.includes('vez(es) em vazamentos') };
    lockApp();
    out.depoisDoBloqueio = pwnedState === null;
    return JSON.stringify(out);
  })()`).then(JSON.parse);
  assert.ok(r.pedidos.length >= 1 && r.pedidos.every((p) => /^[0-9A-F]{5}$/.test(p)), `só prefixos: ${r.pedidos}`);
  assert.ok(!r.pedidos.some((p) => p.includes('password')));
  assert.deepStrictEqual(r.vazadas, ['v1']);
  assert.strictEqual(r.painel, true);
  assert.strictEqual(r.depoisDoBloqueio, true);
});

test('idiomas: todo texto estático tem tradução; nenhuma tradução sobrando', async () => {
  const en = require('../../src/locales/en.json');
  const estaticas = await app.evaluate('JSON.stringify(window.I18N.staticKeys())').then(JSON.parse);
  const semTraducao = estaticas.filter((k) => !(k in en));
  assert.deepStrictEqual(semTraducao, [], 'texto do index.html sem tradução em src/locales/en.json');

  // Chaves usadas no código (mesma regra do teste unitário) + estáticas = tudo que o en.json precisa ter
  const espree = require('espree');
  const usadas = new Set(estaticas);
  const raiz = path.join(__dirname, '..', '..');
  const arquivos = ['src/main.js', ...fs.readdirSync(path.join(raiz, 'src/main')).map((f) => `src/main/${f}`),
    ...fs.readdirSync(path.join(raiz, 'src/renderer/app')).map((f) => `src/renderer/app/${f}`),
    'src/renderer/agent-write.js', 'src/renderer/proton-pass-import.js', 'src/renderer/a11y.js'];
  for (const f of arquivos) {
    const ast = espree.parse(fs.readFileSync(path.join(raiz, f), 'utf8'), { ecmaVersion: 2023, sourceType: 'script' });
    (function walk(n) {
      if (!n || typeof n.type !== 'string') return;
      if (n.type === 'CallExpression' && ['tr', 't', 'trAgente', 'trProton'].includes(n.callee.name) && n.arguments[0] && typeof n.arguments[0].value === 'string') usadas.add(n.arguments[0].value);
      for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
    })(ast);
  }
  assert.deepStrictEqual(Object.keys(en).filter((k) => !usadas.has(k)), [], 'tradução que ninguém usa mais');
});

test('idiomas: app em inglês mostra a interface em inglês', async () => {
  const ui = await launchApp({ files: { 'language.json': JSON.stringify({ language: 'en' }) } });
  try {
    const r = await ui.evaluate(`(async () => {
      const visivel = (id) => getComputedStyle(document.getElementById(id)).display !== 'none';
      const telas = [];
      telas.push(document.body.innerText);
      // Abre as configurações e o gerador (textos de modais e montados em JS)
      document.getElementById('settings-modal').style.display = 'flex';
      telas.push(document.getElementById('settings-modal').innerText);
      document.getElementById('settings-modal').style.display = 'none';
      return JSON.stringify({
        lang: document.documentElement.lang,
        locale: I18N.locale,
        botaoCriar: document.getElementById('setup-btn').textContent.trim(),
        dinamico: tr('Senhas vazadas'),
        comVariavel: tr('{0} entradas importadas com sucesso!', { 0: 3 }),
        textoPt: telas.join('\\n').split('\\n').filter((l) => /[ãõçáéíóúâêôà]/i.test(l) && !/Português/.test(l))
      });
    })()`).then(JSON.parse);
    assert.strictEqual(r.lang, 'en');
    assert.strictEqual(r.locale, 'en-US');
    assert.strictEqual(r.botaoCriar, 'Create Vault');
    assert.strictEqual(r.dinamico, 'Leaked passwords');
    assert.strictEqual(r.comVariavel, '3 entries imported successfully!');
    assert.deepStrictEqual(r.textoPt, [], 'texto em português na interface em inglês');
  } finally {
    await ui.close();
  }
});

test('idiomas: quem já tinha cofre continua em português; instalação nova segue o sistema', async () => {
  const cofre = JSON.stringify(encryptVault('[]', PW));
  const antigo = await launchApp({ files: { 'language.json': null, 'secrets.enc': cofre } });
  try {
    assert.strictEqual(await antigo.evaluate('I18N.lang'), 'pt-BR');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(antigo.vaultDir, 'language.json'), 'utf8')), { language: 'pt-BR' });
  } finally { await antigo.close(); }

  const novo = await launchApp({ files: { 'language.json': null } });
  try {
    assert.strictEqual(await novo.evaluate('I18N.pref'), 'auto');
    assert.ok(['pt-BR', 'en'].includes(await novo.evaluate('I18N.lang')));
    assert.ok(!fs.existsSync(path.join(novo.vaultDir, 'language.json')), 'instalação nova não fixa idioma');
  } finally { await novo.close(); }
});

test('idiomas: trocar nas configurações recarrega a janela no novo idioma', async () => {
  const ui = await launchApp();
  try {
    assert.strictEqual(await ui.evaluate('I18N.lang'), 'pt-BR');
    await ui.evaluate(`(() => { const s = document.getElementById('setting-language'); s.value = 'en'; s.dispatchEvent(new Event('change')); })()`);
    let lang = null;
    for (let i = 0; i < 40 && lang !== 'en'; i++) {
      await new Promise((r) => setTimeout(r, 250));
      lang = await ui.evaluate('window.I18N && I18N.lang').catch(() => null);
    }
    assert.strictEqual(lang, 'en');
    assert.strictEqual(await ui.evaluate("document.getElementById('setup-btn').textContent.trim()"), 'Create Vault');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(ui.vaultDir, 'language.json'), 'utf8')), { language: 'en' });
  } finally { await ui.close(); }
});
