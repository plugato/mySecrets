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
const { encryptVault } = require('../src/lib/vault-crypto');

const SECRET = crypto.randomBytes(32);
fs.writeFileSync(path.join(DATA_DIR, '.machine-secret'), SECRET, { mode: 0o600 });
const sessao = (extra = {}) => ({ timestamp: Date.now(), pid: process.pid, unlocked: true, password: 'pw',
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
  fs.writeFileSync(path.join(DATA_DIR, 'secrets.enc'), JSON.stringify(encryptVault(JSON.stringify([{ id: 'x', title: 'X' }]), 'pw')));
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
  const enc = encryptVault('[]', 'pw');
  fs.writeFileSync(path.join(DATA_DIR, 'secrets.enc'), JSON.stringify({ ...enc, iterations: 1e12 }));
  assert.throws(() => vault.loadEntries(), /iterações/);
});
