// Métodos de passkey do servidor local: só a extensão chega neles, o rpId é
// conferido contra a origem, a chave privada nunca sai, e o login assinado é
// aceito por um servidor WebAuthn independente.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const sw = require('@simplewebauthn/server');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-pk-'));
process.env.MYSECRETS_DATA_DIR = DATA_DIR;
test.after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const sc = require('../src/lib/session-crypto');
const pk = require('../src/lib/passkey');
const { createKeyCache } = require('../src/lib/vault-crypto');

const ORIGIN = 'https://login.exemplo.com.br';
const RP = 'exemplo.com.br';
const EXT = 'chrome-extension://abcdefghijklmnop';
const challenge = () => crypto.randomBytes(32).toString('base64url');

let credencial; // a visão do site (chave pública), para verificar o login
let passkey;

test.before(async () => {
  const ch = challenge();
  const r = pk.create({ origin: ORIGIN, rpId: RP, user: { id: 'dXNlcg', name: 'eu@exemplo.com.br' }, challenge: ch });
  passkey = r.passkey;
  credencial = (await sw.verifyRegistrationResponse({ response: r.response, expectedChallenge: ch, expectedOrigin: ORIGIN, expectedRPID: RP })).registrationInfo.credential;
  const outra = pk.create({ origin: 'https://github.com', rpId: 'github.com', user: { id: 'dXNlcg' }, challenge: challenge() }).passkey;

  const chaves = createKeyCache();
  fs.writeFileSync(path.join(DATA_DIR, 'secrets.enc'), JSON.stringify(chaves.encrypt(JSON.stringify([
    { id: 'pk1', type: 'passkey', title: RP, passkey },
    { id: 'pk2', type: 'passkey', title: 'github.com', passkey: outra },
    { id: 'l1', type: 'login', title: 'Exemplo', url: ORIGIN, username: 'eu', password: 'p' },
  ]), 'pw')));
  const secret = crypto.randomBytes(32);
  fs.writeFileSync(path.join(DATA_DIR, '.machine-secret'), secret, { mode: 0o600 });
  fs.writeFileSync(path.join(DATA_DIR, '.session'), JSON.stringify(sc.encryptSession({
    timestamp: Date.now(), pid: process.pid, unlocked: true, keys: chaves.exportKeys(),
    expiresAt: Date.now() + 600000, hostname: os.hostname(),
  }, sc.sessionKey(secret))));
});

async function servidor(t) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = fork(path.join(__dirname, '..', 'mcp-server', 'http-server.js'), [], {
    env: { ...process.env, MYSECRETS_DATA_DIR: DATA_DIR, MYSECRETS_MCP_PORT: String(port), MYSECRETS_MCP_TOKEN: 'tk' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', () => reject(new Error('servidor saiu'))); });
  const chamar = async (method, params, origin = EXT) => {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer tk' };
    if (origin) headers.Origin = origin;
    const r = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return r.json();
  };
  return { child, chamar };
}

test('agente (sem Origin de extensão) não alcança as passkeys', async (t) => {
  const { chamar } = await servidor(t);
  for (const m of ['mysecrets/passkey_list', 'mysecrets/passkey_get', 'mysecrets/passkey_create']) {
    const r = await chamar(m, { origin: ORIGIN, rpId: RP }, null);
    assert.strictEqual(r.error && r.error.code, -32601, m);
  }
});

test('lista só as passkeys do site, sem a chave privada', async (t) => {
  const { chamar } = await servidor(t);
  const r = await chamar('mysecrets/passkey_list', { origin: ORIGIN, rpId: RP });
  assert.deepStrictEqual(r.result.passkeys.map((p) => p.credentialId), [passkey.credentialId]);
  assert.strictEqual(r.result.passkeys[0].userName, 'eu@exemplo.com.br');
  assert.ok(!JSON.stringify(r).includes(passkey.privateKey));
  // Página de outro site pedindo o rpId deste
  const evil = await chamar('mysecrets/passkey_list', { origin: 'https://exemplo-com.br.evil.io', rpId: RP });
  assert.strictEqual(evil.error.data.name, 'SecurityError');
});

test('login assinado é aceito pelo site e fica no registro de atividade', async (t) => {
  const { chamar } = await servidor(t);
  const ch = challenge();
  const r = await chamar('mysecrets/passkey_get', { origin: ORIGIN, rpId: RP, challenge: ch, credentialId: passkey.credentialId });
  const v = await sw.verifyAuthenticationResponse({ response: r.result.credential, expectedChallenge: ch, expectedOrigin: ORIGIN, expectedRPID: RP, credential: credencial, requireUserVerification: true });
  assert.strictEqual(v.verified, true);
  assert.ok(!JSON.stringify(r).includes(passkey.privateKey));
  const log = fs.readFileSync(path.join(DATA_DIR, 'mcp-audit.jsonl'), 'utf8');
  assert.match(log, /"tool":"passkey_get","client":"extensao","ids":\["pk1"\]/);

  // Passkey de outro site, pedida por esta página: não existe para este rpId
  const outra = await chamar('mysecrets/passkey_get', { origin: ORIGIN, rpId: RP, challenge: ch, credentialId: 'inexistente' });
  assert.strictEqual(outra.error.data.name, 'NotAllowedError');
});

test('criar: excluída → InvalidStateError; senão sobe ao app e devolve a resposta dele', async (t) => {
  const { child, chamar } = await servidor(t);
  const user = { id: 'bm92bw', name: 'novo@exemplo.com.br', displayName: 'Novo' };
  const dup = await chamar('mysecrets/passkey_create', { origin: ORIGIN, rpId: RP, challenge: challenge(), user, excludeCredentials: [{ id: passkey.credentialId, type: 'public-key' }] });
  assert.strictEqual(dup.error.data.name, 'InvalidStateError');

  child.on('message', (m) => {
    if (m.type !== 'passkey_create') return;
    assert.deepStrictEqual(Object.keys(m.payload).sort(), ['challenge', 'origin', 'rpId', 'rpName', 'user']);
    assert.strictEqual(m.payload.rpId, RP);
    assert.strictEqual(m.payload.origin, ORIGIN);
    child.send({ type: 'passkey_create_result', reqId: m.reqId, result: { success: true, response: { id: 'novo' } } });
  });
  const ok = await chamar('mysecrets/passkey_create', { origin: ORIGIN + '/cadastro?x=1', rpId: RP, rpName: 'Exemplo', challenge: challenge(), user });
  assert.deepStrictEqual(ok.result, { credential: { id: 'novo' } });

  const ruim = await chamar('mysecrets/passkey_create', { origin: 'http://exemplo.com.br', rpId: RP, challenge: challenge(), user });
  assert.strictEqual(ruim.error.data.name, 'SecurityError');
});
