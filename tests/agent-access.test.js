// Leitura de agentes com aprovação: configurações, liberação por tempo,
// corrida PC × celular e as regras do servidor MCP (política "sempre",
// cofre bloqueado, sessão de leitura invisível para a extensão).
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-acesso-'));
process.env.MYSECRETS_DATA_DIR = DATA_DIR;
process.on('exit', () => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const lib = require('../src/lib/agent-access');
const core = require('../mcp-server/core');
const vault = require('../mcp-server/vault');
const { createKeyCache } = require('../src/lib/vault-crypto');

const PASSWORD = 'senha-mestra-de-teste-123!';
const CHAVES = createKeyCache();
const ENTRADAS = [{ id: 'g1', type: 'login', title: 'GitHub', username: 'eu', password: 'p4ss', url: 'https://github.com' }];
fs.writeFileSync(path.join(DATA_DIR, 'secrets.enc'), JSON.stringify(CHAVES.encrypt(JSON.stringify(ENTRADAS), PASSWORD)));

function writeSession(extra = {}) {
  const secret = crypto.randomBytes(32);
  fs.writeFileSync(path.join(DATA_DIR, '.machine-secret'), secret, { mode: 0o600 });
  const key = crypto.createHash('sha256').update('mysecrets-session-v2').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = JSON.stringify({
    timestamp: Date.now(), pid: process.pid, unlocked: true, keys: CHAVES.exportKeys(),
    expiresAt: Date.now() + 15 * 60 * 1000, hostname: os.hostname(), ...extra
  });
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  fs.writeFileSync(path.join(DATA_DIR, '.session'), JSON.stringify({
    version: 2, encrypted, iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex')
  }), { mode: 0o600 });
}
const noSession = () => fs.rmSync(path.join(DATA_DIR, '.session'), { force: true });
const call = async (name, args, ctx) => {
  const r = await core.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx);
  return { isError: !!r.result.isError, data: JSON.parse(r.result.content[0].text) };
};

test('configurações: padrão seguro, valores inválidos viram o padrão, arquivo 600', () => {
  assert.deepStrictEqual(lib.readSettings(DATA_DIR), { remote: false, readPolicy: 'locked', windowMinutes: 5 });
  const s = lib.writeSettings(DATA_DIR, { remote: true, windowMinutes: 15 });
  assert.deepStrictEqual(s, { remote: true, readPolicy: 'locked', windowMinutes: 15 });
  assert.deepStrictEqual(lib.writeSettings(DATA_DIR, { readPolicy: 'nunca', windowMinutes: 999, remote: 'sim' }),
    { remote: false, readPolicy: 'locked', windowMinutes: 5 });
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(DATA_DIR, lib.SETTINGS_FILE)).mode & 0o777, 0o600);
  lib.writeSettings(DATA_DIR, { remote: false });
});

test('liberação por tempo: vence no prazo, encerra antes e chama o fim uma vez', () => {
  let agora = 1000;
  const timers = [];
  const fins = [];
  const w = lib.createReadWindow({
    now: () => agora,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {},
    onEnd: (v, motivo) => fins.push(motivo)
  });
  const v = w.start(5, { source: 'phone', phoneName: 'Pixel' });
  assert.strictEqual(v.until, 1000 + 5 * 60000);
  assert.strictEqual(timers[0].ms, 5 * 60000);
  let parou = 0;
  w.onStop(() => parou++);
  assert.strictEqual(w.active().phoneName, 'Pixel');
  agora += 5 * 60000; // relógio pulou (suspensão): active() encerra
  assert.strictEqual(w.active(), null);
  assert.deepStrictEqual(fins, ['expired']);
  assert.strictEqual(parou, 1);
  assert.strictEqual(w.end('user'), false);

  w.start(15, {});
  w.start(30, {}); // substitui a anterior
  assert.deepStrictEqual(fins, ['expired', 'replaced']);
  assert.strictEqual(w.end('phone'), true);
  assert.deepStrictEqual(fins, ['expired', 'replaced', 'phone']);
});

test('corrida: vale a primeira resposta que decide; canal indisponível não decide', async () => {
  const atraso = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
  let d = await lib.firstDecision([
    { name: 'pc', promise: atraso(30, { decided: true, approved: false }) },
    { name: 'phone', promise: atraso(5, { decided: false, error: 'sem internet' }) }
  ]);
  assert.strictEqual(d.source, 'pc');
  assert.strictEqual(d.approved, false);

  d = await lib.firstDecision([
    { name: 'pc', promise: atraso(50, { decided: true, approved: false }) },
    { name: 'phone', promise: atraso(5, { decided: true, approved: true, mode: 'window' }) }
  ]);
  assert.strictEqual(d.source, 'phone');
  assert.strictEqual(d.mode, 'window');

  d = await lib.firstDecision([
    { name: 'pc', promise: Promise.reject(new Error('quebrou')) },
    { name: 'phone', promise: atraso(5, { decided: false, error: 'sem internet' }) }
  ]);
  assert.strictEqual(d.decided, false);
  assert.strictEqual(d.error, 'sem internet');
  assert.strictEqual((await lib.firstDecision([])).decided, false);
});

test('MCP: cofre bloqueado pede ao app; aberto lê direto', async () => {
  const pedidos = [];
  const ctx = {
    client: 'claude-code',
    requestRead: async (tool, args) => {
      pedidos.push({ tool, args });
      return { data: { liberado: true }, approval: 'once' };
    }
  };
  noSession();
  let r = await call('get_credentials', { query: 'github' }, ctx);
  assert.deepStrictEqual(r.data, { liberado: true });
  assert.deepStrictEqual(pedidos, [{ tool: 'get_credentials', args: { query: 'github' } }]);

  writeSession();
  r = await call('get_credentials', { query: 'github' }, ctx);
  assert.strictEqual(r.data.password, 'p4ss');
  assert.strictEqual(pedidos.length, 1);

  // Sem requestRead (extensão), bloqueio continua sendo erro
  noSession();
  r = await call('get_credentials', { query: 'github' }, { allowWrite: false, client: 'extensao' });
  assert.strictEqual(r.isError, true);
  assert.strictEqual(r.data.locked, true);
});

test('MCP: aprovação "sempre" pergunta mesmo com o cofre aberto (vault_status não)', async () => {
  lib.writeSettings(DATA_DIR, { readPolicy: 'always' });
  writeSession();
  let pedidos = 0;
  const ctx = { client: 'x', requestRead: async () => { pedidos++; throw Object.assign(new Error('O usuário negou a leitura.'), { declined: true }); } };
  const r = await call('get_otp', { query: 'github' }, ctx);
  assert.strictEqual(r.isError, true);
  assert.strictEqual(r.data.declined, true);
  assert.strictEqual(pedidos, 1);
  const st = await call('vault_status', {}, ctx);
  assert.strictEqual(st.data.accessible, true);
  assert.strictEqual(st.data.readApproval, 'always');
  assert.strictEqual(pedidos, 1);
  lib.writeSettings(DATA_DIR, { readPolicy: 'locked' });
});

test('MCP: liberação de leitura (scope agent-read) serve ao agente, não à extensão', async () => {
  writeSession({ scope: 'agent-read', timestamp: Date.now() - 20 * 60000, expiresAt: Date.now() + 10 * 60000 });
  const agente = await call('get_credentials', { query: 'github' }, { client: 'x', requestRead: async () => assert.fail('não devia perguntar') });
  assert.strictEqual(agente.data.password, 'p4ss');
  const st = await call('vault_status', {}, { client: 'x', requestRead: async () => ({}) });
  assert.ok(st.data.readWindowUntil);

  const ext = { allowWrite: false, client: 'extensao' };
  const r = await call('get_credentials', { query: 'github' }, ext);
  assert.strictEqual(r.isError, true);
  assert.strictEqual(r.data.locked, true);
  assert.strictEqual((await call('vault_status', {}, ext)).data.accessible, false);
  // Passkeys (só a extensão usa) também não
  assert.throws(() => vault.loadPasskeys(), vault.VaultLockedError);
  noSession();
});

test('"só esta": entradas decifradas pelo app valem só durante a chamada', () => {
  noSession();
  const data = vault.withEntries(ENTRADAS, () => core.callTool('get_credentials', { id: 'g1' }, {}));
  assert.strictEqual(data.password, 'p4ss');
  assert.throws(() => core.callTool('get_credentials', { id: 'g1' }, {}), vault.VaultLockedError);
});
