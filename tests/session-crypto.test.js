// Sessão (.session) compartilhada entre o app e o MCP.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-sessao-'));
process.env.MYSECRETS_DATA_DIR = DATA_DIR;
test.after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const sc = require('../src/lib/session-crypto');
const vault = require('../mcp-server/vault');
const { encryptVault, createKeyCache } = require('../src/lib/vault-crypto');
const CHAVES = createKeyCache();
const COFRE = (entradas) => JSON.stringify(CHAVES.encrypt(JSON.stringify(entradas), 'pw'));
COFRE([]);

const SECRET = crypto.randomBytes(32);
fs.writeFileSync(path.join(DATA_DIR, '.machine-secret'), SECRET, { mode: 0o600 });
const sessao = (extra = {}) => ({ timestamp: Date.now(), pid: process.pid, unlocked: true, keys: CHAVES.exportKeys(),
  expiresAt: Date.now() + 60000, hostname: os.hostname(), ...extra });

test('ida e volta; chave errada e formato antigo dão null', () => {
  const key = sc.sessionKey(SECRET);
  const enc = sc.encryptSession({ a: 1 }, key);
  assert.deepStrictEqual(sc.decryptSession(enc, key), { a: 1 });
  assert.strictEqual(sc.decryptSession(enc, sc.sessionKey(crypto.randomBytes(32))), null);
  assert.strictEqual(sc.decryptSession({ ...enc, version: 1 }, key), null);
  assert.strictEqual(sc.decryptSession({ ...enc, authTag: '00'.repeat(16) }, key), null, 'adulterada');
});

test('MCP aceita a sessão cifrada pelo app e lê o cofre', () => {
  fs.writeFileSync(path.join(DATA_DIR, '.session'), JSON.stringify(sc.encryptSession(sessao(), sc.sessionKey(SECRET))));
  fs.writeFileSync(path.join(DATA_DIR, 'secrets.enc'), COFRE([{ id: 'x', title: 'X' }]));
  const s = vault.checkSession();
  assert.strictEqual(s.valid, true);
  assert.deepStrictEqual(vault.loadEntries().map((e) => e.id), ['x']);
});

test('MCP recusa .session em texto puro', () => {
  fs.writeFileSync(path.join(DATA_DIR, '.session'), JSON.stringify(sessao()));
  assert.deepStrictEqual(vault.checkSession(), { valid: false, reason: 'DECRYPT_FAILED' });
});

test('MCP recusa cofre com iterações absurdas (mesma cripto do app)', () => {
  fs.writeFileSync(path.join(DATA_DIR, '.session'), JSON.stringify(sc.encryptSession(sessao(), sc.sessionKey(SECRET))));
  const enc = JSON.parse(COFRE([]));
  fs.writeFileSync(path.join(DATA_DIR, 'secrets.enc'), JSON.stringify({ ...enc, iterations: 1e12 }));
  assert.throws(() => vault.loadEntries(), /iterações/);
});

test('a sessão não guarda a senha mestra; com outro salt o MCP pede para desbloquear de novo', () => {
  const dados = sc.decryptSession(sc.encryptSession(sessao(), sc.sessionKey(SECRET)), sc.sessionKey(SECRET));
  assert.ok(!('password' in dados), 'sem senha na sessão');
  assert.ok(Array.isArray(dados.keys) && dados.keys[0].key.length === 64);
  fs.writeFileSync(path.join(DATA_DIR, '.session'), JSON.stringify(sc.encryptSession(sessao(), sc.sessionKey(SECRET))));
  // Cofre gravado por outro aparelho (outro salt) e ainda não regravado aqui
  fs.writeFileSync(path.join(DATA_DIR, 'secrets.enc'), JSON.stringify(encryptVault('[]', 'pw')));
  assert.throws(() => vault.loadEntries(), (e) => e.reason === 'NO_SESSION_KEY');
});

test('passkeys nunca aparecem para as ferramentas dos agentes', () => {
  const core = require('../mcp-server/core');
  fs.writeFileSync(path.join(DATA_DIR, '.session'), JSON.stringify(sc.encryptSession(sessao(), sc.sessionKey(SECRET))));
  const passkey = { rpId: 'github.com', credentialId: 'abc', privateKey: 'SEGREDO-DA-CHAVE', userName: 'eu' };
  fs.writeFileSync(path.join(DATA_DIR, 'secrets.enc'), COFRE([
    { id: 'l', type: 'login', title: 'GitHub', url: 'https://github.com', username: 'eu', password: 'p' },
    { id: 'pk', type: 'passkey', title: 'github.com', passkey },
  ]));
  assert.deepStrictEqual(vault.loadEntries().map((e) => e.id), ['l']);
  assert.deepStrictEqual(vault.loadPasskeys().map((e) => e.id), ['pk']);
  const saidas = [
    core.callTool('list_secrets', {}),
    core.callTool('list_secrets', { type: 'passkey' }),
    core.callTool('search_secrets', { query: 'github' }),
    core.callTool('match_url', { url: 'https://github.com/login' }),
    core.callTool('get_credentials', { query: 'github' }),
  ].map((r) => JSON.stringify(r));
  for (const s of saidas) {
    assert.ok(!s.includes('SEGREDO-DA-CHAVE') && !s.includes('"pk"'), s);
  }
  assert.throws(() => core.callTool('get_credentials', { id: 'pk' }));
});
