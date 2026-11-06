// MySecrets — passkeys, parte que roda NO MUNDO DA PÁGINA (world: MAIN).
//
// Substitui navigator.credentials.create/get só para pedidos publicKey e
// repassa ao content script (passkey-content.js) por postMessage. Tudo o que
// não dá para atender (conditional, outro algoritmo, chave de hardware) e o
// botão "usar outro dispositivo" vão para a implementação original do
// navegador. Nenhum segredo passa por aqui: a página recebe só a resposta
// pública que receberia de qualquer autenticador.
(() => {
  'use strict';
  if (window.top !== window || !window.navigator.credentials || window.__mysecretsPasskey) return;
  Object.defineProperty(window, '__mysecretsPasskey', { value: true });

  const CANAL = 'mysecrets-passkey';
  const creds = navigator.credentials;
  const nativoCreate = creds.create.bind(creds);
  const nativoGet = creds.get.bind(creds);

  // ===== bytes <-> base64url =====
  const bytes = (v) => {
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    throw new TypeError('BufferSource esperado');
  };
  const b64url = (v) => {
    let s = '';
    for (const b of bytes(v)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const buf = (s) => {
    const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  };
  const listaIds = (l) => (Array.isArray(l) ? l.map((c) => ({ id: b64url(c.id), type: c.type })) : []);

  // ===== conversa com o content script =====
  let seq = 0;
  function pedir(op, dados, signal) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2)}`;
      const fim = () => { window.removeEventListener('message', ouvir); if (signal) signal.removeEventListener('abort', abortar); };
      const ouvir = (ev) => {
        if (ev.source !== window || !ev.data || ev.data.canal !== CANAL || ev.data.tipo !== 'resposta' || ev.data.id !== id) return;
        fim();
        resolve(ev.data);
      };
      const abortar = () => {
        fim();
        window.postMessage({ canal: CANAL, tipo: 'cancelar', id }, window.location.origin);
        reject(signal.reason instanceof Error ? signal.reason : new DOMException('Operação cancelada', 'AbortError'));
      };
      window.addEventListener('message', ouvir);
      if (signal) signal.addEventListener('abort', abortar);
      window.postMessage({ canal: CANAL, tipo: 'pedido', id, op, dados }, window.location.origin);
    });
  }

  // ===== montagem do PublicKeyCredential =====
  function definir(alvo, props) {
    for (const [k, v] of Object.entries(props)) Object.defineProperty(alvo, k, { value: v, enumerable: true });
    return alvo;
  }

  function credencial(c, criacao) {
    const r = c.response;
    const resp = {};
    if (criacao) {
      const attestationObject = buf(r.attestationObject);
      const authData = buf(r.authenticatorData);
      const spki = buf(r.publicKey);
      definir(resp, {
        clientDataJSON: buf(r.clientDataJSON),
        attestationObject,
        getTransports: () => r.transports.slice(),
        getAuthenticatorData: () => authData.slice(0),
        getPublicKey: () => spki.slice(0),
        getPublicKeyAlgorithm: () => r.publicKeyAlgorithm,
      });
      if (window.AuthenticatorAttestationResponse) Object.setPrototypeOf(resp, AuthenticatorAttestationResponse.prototype);
    } else {
      definir(resp, {
        clientDataJSON: buf(r.clientDataJSON),
        authenticatorData: buf(r.authenticatorData),
        signature: buf(r.signature),
        userHandle: r.userHandle ? buf(r.userHandle) : null,
      });
      if (window.AuthenticatorAssertionResponse) Object.setPrototypeOf(resp, AuthenticatorAssertionResponse.prototype);
    }
    const json = { id: c.id, rawId: c.rawId, type: 'public-key', authenticatorAttachment: c.authenticatorAttachment, clientExtensionResults: c.clientExtensionResults || {}, response: { ...r } };
    const out = definir({}, {
      id: c.id,
      rawId: buf(c.rawId),
      type: 'public-key',
      authenticatorAttachment: c.authenticatorAttachment || 'platform',
      response: resp,
      getClientExtensionResults: () => ({ ...(c.clientExtensionResults || {}) }),
      toJSON: () => JSON.parse(JSON.stringify(json)),
    });
    if (window.PublicKeyCredential) Object.setPrototypeOf(out, PublicKeyCredential.prototype);
    return out;
  }

  function erro(e) {
    return new DOMException((e && e.message) || 'Operação não permitida', (e && e.name) || 'NotAllowedError');
  }

  // ===== create =====
  function podeCriar(pk) {
    const params = Array.isArray(pk.pubKeyCredParams) ? pk.pubKeyCredParams : [];
    if (params.length && !params.some((p) => p && p.alg === -7 && p.type === 'public-key')) return false;
    const sel = pk.authenticatorSelection || {};
    if (sel.authenticatorAttachment === 'cross-platform') return false;
    return true;
  }

  creds.create = async function create(options) {
    const pk = options && options.publicKey;
    if (!pk || !podeCriar(pk) || (options.signal && options.signal.aborted)) return nativoCreate(options);
    const dados = {
      rp: { id: pk.rp && pk.rp.id, name: pk.rp && pk.rp.name },
      user: { id: b64url(pk.user.id), name: pk.user.name, displayName: pk.user.displayName },
      challenge: b64url(pk.challenge),
      excludeCredentials: listaIds(pk.excludeCredentials),
    };
    const r = await pedir('create', dados, options.signal);
    if (r.nativo) return nativoCreate(options);
    if (r.erro) throw erro(r.erro);
    return credencial(r.credencial, true);
  };

  // ===== get =====
  creds.get = async function get(options) {
    const pk = options && options.publicKey;
    // Preenchimento condicional (sugestão no campo) fica com o navegador nesta versão
    if (!pk || options.mediation === 'conditional' || (options.signal && options.signal.aborted)) return nativoGet(options);
    const dados = {
      rpId: pk.rpId,
      challenge: b64url(pk.challenge),
      allowCredentials: listaIds(pk.allowCredentials),
    };
    const r = await pedir('get', dados, options.signal);
    if (r.nativo) return nativoGet(options);
    if (r.erro) throw erro(r.erro);
    return credencial(r.credencial, false);
  };
})();
