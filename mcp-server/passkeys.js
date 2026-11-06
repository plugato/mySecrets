/**
 * MySecrets - Passkeys pedidas pela extensão do navegador.
 *
 * Métodos fora do MCP, só para pedidos com Origin de extensão pareada
 * (agentes nunca chegam aqui; ver docs/developer/PASSKEYS.md):
 *   mysecrets/passkey_list    quais passkeys o cofre tem para o site (sem chave)
 *   mysecrets/passkey_get     assina o login com a passkey escolhida
 *   mysecrets/passkey_create  cria: o app pede confirmação, gera a chave e grava
 *
 * A origem é a da aba, conferida pela extensão no background (não vem da
 * página). Aqui ela é conferida de novo contra o rpId pela Public Suffix List.
 */

const pk = require('../src/lib/passkey');
const vault = require('./vault');
const audit = require('./audit');

const METHODS = new Set(['mysecrets/passkey_list', 'mysecrets/passkey_get', 'mysecrets/passkey_create']);

class PasskeyError extends Error {
  constructor(name, message) {
    super(message);
    // Nome do DOMException que a página deve receber
    this.domName = name;
  }
}

const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

function baseParams(p) {
  if (!p || typeof p !== 'object') throw new PasskeyError('NotAllowedError', 'Parâmetros ausentes');
  if (!str(p.origin, 2048)) throw new PasskeyError('SecurityError', 'Origem inválida');
  if (p.rpId != null && !str(p.rpId, 253)) throw new PasskeyError('SecurityError', 'rpId inválido');
  try {
    return pk.checkRpId(p.origin, p.rpId);
  } catch (e) {
    throw new PasskeyError('SecurityError', e.message);
  }
}

function credIds(list) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > 64) throw new PasskeyError('NotAllowedError', 'Lista de credenciais inválida');
  return list.filter((c) => c && str(c.id, 1024)).map((c) => ({ id: c.id }));
}

function publicInfo(e) {
  return {
    credentialId: e.passkey.credentialId,
    userName: e.passkey.userName || '',
    userDisplayName: e.passkey.userDisplayName || '',
    title: e.title || e.passkey.rpId,
  };
}

function list(p) {
  const rp = baseParams(p);
  return { rpId: rp, passkeys: pk.matching(vault.loadPasskeys(), rp, credIds(p.allowCredentials)).map(publicInfo) };
}

function get(p) {
  const rp = baseParams(p);
  if (!str(p.challenge, 1024)) throw new PasskeyError('NotAllowedError', 'Desafio inválido');
  if (!str(p.credentialId, 1024)) throw new PasskeyError('NotAllowedError', 'Passkey não escolhida');
  const entry = pk.matching(vault.loadPasskeys(), rp, [{ id: p.credentialId }])[0];
  if (!entry) throw new PasskeyError('NotAllowedError', 'Passkey não encontrada para este site');
  const credential = pk.get({ origin: p.origin, rpId: rp, challenge: p.challenge, passkey: entry.passkey, verified: true });
  try { audit.record(vault.USER_DATA_PATH, { tool: 'passkey_get', client: 'extensao', data: { id: entry.id } }); } catch (_) { /* opcional */ }
  return { credential };
}

/** Confere o pedido e devolve o que vai ao app (que confirma e gera a chave). */
function createRequest(p) {
  const rp = baseParams(p);
  if (!str(p.challenge, 1024)) throw new PasskeyError('NotAllowedError', 'Desafio inválido');
  const u = p.user;
  if (!u || typeof u !== 'object' || !str(u.id, 128)) throw new PasskeyError('NotAllowedError', 'Usuário inválido');
  if (u.name != null && typeof u.name !== 'string') throw new PasskeyError('NotAllowedError', 'Usuário inválido');
  if (u.displayName != null && typeof u.displayName !== 'string') throw new PasskeyError('NotAllowedError', 'Usuário inválido');
  // O site já tem uma destas passkeys no cofre: o WebAuthn pede InvalidStateError
  const exclude = credIds(p.excludeCredentials);
  if (exclude.length && pk.matching(vault.loadPasskeys(), rp, exclude).length) {
    throw new PasskeyError('InvalidStateError', 'Já existe uma passkey deste site no MySecrets');
  }
  const cut = (s, n) => String(s || '').slice(0, n);
  return {
    origin: new URL(p.origin).origin,
    rpId: rp,
    rpName: cut(p.rpName, 256),
    user: { id: u.id, name: cut(u.name, 256), displayName: cut(u.displayName, 256) },
    challenge: p.challenge,
  };
}

/**
 * Atende um método de passkey. askApp(type, payload, timeout) sobe ao app.
 * Devolve { result } ou { error: { code, message, data: { name } } }.
 */
async function handle(method, params, askApp) {
  try {
    if (method === 'mysecrets/passkey_list') return { result: list(params) };
    if (method === 'mysecrets/passkey_get') return { result: get(params) };
    const req = createRequest(params);
    const r = await askApp('passkey_create', req, 120000);
    if (!r || !r.success) throw new PasskeyError('NotAllowedError', (r && r.error) || 'Recusado no app');
    return { result: { credential: r.response } };
  } catch (e) {
    if (e instanceof vault.VaultLockedError) return { error: { code: -32002, message: e.message, data: { name: 'NotAllowedError' } } };
    return { error: { code: -32000, message: e.message, data: { name: e.domName || 'NotAllowedError' } } };
  }
}

module.exports = { METHODS, handle, createRequest, list, get };
