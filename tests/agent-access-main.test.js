// Processo principal (src/main/agent-access.js) com Electron, celular e
// bandeja simulados: corrida PC × celular, "só esta", "por N min",
// desbloqueio no PC durante a espera e gravação aprovada no celular.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-acesso-main-'));
process.env.MYSECRETS_DATA_DIR = DATA_DIR;
process.on('exit', () => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const lib = require('../src/lib/agent-access');
const { createKeyCache } = require('../src/lib/vault-crypto');

// ===== Simulações =====

const handlers = {};
const enviados = [];
const fakeWindow = {
  isDestroyed: () => false, isMinimized: () => false, restore() {}, show() {}, focus() {},
  webContents: { send: (canal, dados) => enviados.push({ canal, dados }) }
};
const fakeElectron = {
  ipcMain: { handle: (canal, fn) => { handlers[canal] = fn; }, on() {} },
  app: { getPath: () => DATA_DIR, getLocale: () => 'pt-BR', on() {} }
};
const celular = { phones: true, pedidos: [], responder: null };
const fakePhone = {
  hasPhones: () => celular.phones,
  requestRemoteApproval: (opts) => {
    celular.pedidos.push(opts);
    return new Promise((resolve, reject) => {
      const abortar = () => reject(Object.assign(new Error('Cancelado'), { code: 'cancelled' }));
      if (opts.signal) opts.signal.addEventListener('abort', abortar, { once: true });
      celular.responder = (r) => (r instanceof Error ? reject(r) : resolve(r));
    });
  }
};
const bandeja = [];
const fakeTray = { setReadWindow: (until) => bandeja.push(until) };
const fakeI18n = { t: (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s) };

const MAIN = path.join(__dirname, '..', 'src', 'main');
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'electron') return fakeElectron;
  if (parent && parent.filename && parent.filename.startsWith(MAIN)) {
    if (request === './phone') return fakePhone;
    if (request === './tray') return fakeTray;
    if (request === './i18n') return fakeI18n;
  }
  return origLoad.call(this, request, parent, ...rest);
};
const access = require('../src/main/agent-access');
Module._load = origLoad;
const vault = require('../mcp-server/vault');

// ===== Cofre e sessão =====

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

// O "app": senha da sessão aberta no PC, sessão de leitura, decifrar com a senha
const app = { password: null, agentSessions: [], closed: 0, reads: 0 };
access.register({
  getWindow: () => fakeWindow,
  userDataPath: DATA_DIR,
  currentSessionPassword: () => app.password,
  readEntries: async (pw) => {
    app.reads++;
    assert.strictEqual(pw, PASSWORD);
    return ENTRADAS;
  },
  openAgentSession: async (pw, until) => {
    app.agentSessions.push({ pw, until });
    writeSession({ scope: 'agent-read', expiresAt: until });
  },
  closeAgentSession: () => {
    app.closed++;
    if (!app.password) noSession();
  }
});

const aprovar = (extra = {}) => ({ decision: 'approve', password: PASSWORD, mode: 'once', minutes: 5, phoneName: 'Pixel', ...extra });
const esperarPedido = async (n) => {
  for (let i = 0; i < 200 && celular.pedidos.length < n; i++) await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(celular.pedidos.length, n, 'pedido ao celular');
  return celular.pedidos[n - 1];
};

test('bloqueado e sem aprovação pelo celular: erro "bloqueado" na hora', async () => {
  lib.writeSettings(DATA_DIR, { remote: false });
  noSession();
  const r = await access.handleRead('r0', { tool: 'get_credentials', args: { query: 'github' }, client: 'claude-code' });
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.locked, true);
  assert.match(r.error, /Aprovar pelo celular/);
});

test('"só esta" no celular: lê com a senha conferida, sem criar sessão', async () => {
  lib.writeSettings(DATA_DIR, { remote: true, windowMinutes: 15 });
  noSession();
  const p = access.handleRead('r1', { tool: 'get_credentials', args: { query: 'github' }, client: 'claude-code' });
  const pedido = await esperarPedido(1);
  assert.strictEqual(pedido.kind, 'read');
  assert.strictEqual(pedido.client, 'claude-code');
  assert.deepStrictEqual(pedido.summary, { tool: 'get_credentials', query: 'github' });
  assert.strictEqual(pedido.windowMinutes, 15);
  celular.responder(aprovar());
  const r = await p;
  assert.strictEqual(r.success, true, r.error);
  assert.strictEqual(r.approval, 'once');
  assert.strictEqual(r.data.password, 'p4ss');
  assert.strictEqual(app.reads, 1);
  assert.strictEqual(app.agentSessions.length, 0);
  assert.strictEqual(fs.existsSync(path.join(DATA_DIR, '.session')), false);
});

test('"por 15 min": cria a sessão de leitura; a próxima leitura não pergunta; bloquear encerra', async () => {
  const p = access.handleRead('r2', { tool: 'get_otp', args: { query: 'nada' }, client: 'claude-code' });
  await esperarPedido(2);
  celular.responder(aprovar({ mode: 'window', minutes: 15 }));
  const r = await p;
  // A entrada não tem OTP: a ferramenta responde erro, mas a liberação vale
  assert.strictEqual(r.success, false);
  assert.match(r.error, /OTP|encontrada/);
  assert.strictEqual(app.agentSessions.length, 1);
  assert.ok(Math.abs(app.agentSessions[0].until - (Date.now() + 15 * 60000)) < 5000);
  assert.ok(access.readWindowActive());
  assert.ok(bandeja.at(-1) > Date.now());

  const r2 = await access.handleRead('r3', { tool: 'get_credentials', args: { id: 'g1' }, client: 'claude-code' });
  assert.strictEqual(r2.success, true);
  assert.strictEqual(r2.approval, 'window');
  assert.strictEqual(celular.pedidos.length, 2, 'não perguntou de novo');

  access.onLock();
  assert.strictEqual(access.readWindowActive(), null);
  assert.strictEqual(app.closed, 1);
  assert.strictEqual(bandeja.at(-1), null);
  assert.strictEqual(fs.existsSync(path.join(DATA_DIR, '.session')), false);
});

test('negado no celular; agente desistiu no meio', async () => {
  let p = access.handleRead('r4', { tool: 'get_credentials', args: { id: 'g1' } });
  await esperarPedido(3);
  celular.responder({ decision: 'deny', phoneName: 'Pixel' });
  let r = await p;
  assert.strictEqual(r.declined, true);

  p = access.handleRead('r5', { tool: 'get_credentials', args: { id: 'g1' } });
  await esperarPedido(4);
  access.cancelRead('r5');
  r = await p;
  assert.strictEqual(r.cancelled, true);
});

test('desbloquear o app no PC durante a espera libera a leitura (aprovação "só com o cofre bloqueado")', async () => {
  const p = access.handleRead('r6', { tool: 'get_credentials', args: { id: 'g1' } });
  const pedido = await esperarPedido(5);
  app.password = PASSWORD;
  writeSession();
  access.onUnlock();
  const r = await p;
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.approval, 'unlocked');
  assert.ok(pedido.signal.aborted, 'pedido ao celular cancelado');
  app.password = null;
  noSession();
});

test('aprovação "sempre" com o cofre aberto: modal no PC × celular; o PC responde primeiro', async () => {
  lib.writeSettings(DATA_DIR, { readPolicy: 'always' });
  app.password = PASSWORD;
  writeSession();
  enviados.length = 0;
  const p = access.handleRead('r7', { tool: 'get_credentials', args: { id: 'g1' }, client: 'claude-code' });
  const pedido = await esperarPedido(6);
  const modal = enviados.find((e) => e.canal === 'agent-read');
  assert.ok(modal, 'modal no PC');
  assert.strictEqual(modal.dados.windowMinutes, 15);
  await handlers['agent-read-answer']({}, modal.dados.jobId, { approved: true, mode: 'once' });
  const r = await p;
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.approval, 'once');
  assert.ok(pedido.signal.aborted);
  lib.writeSettings(DATA_DIR, { readPolicy: 'locked' });
  app.password = null;
  noSession();
});

test('resumo da gravação para o celular: valores só do que não é segredo', () => {
  const s = access.writeSummary({
    target: { title: 'GitHub CI' },
    fields: { username: 'bot@x.com', password: 'segredo-123', url: 'https://github.com', token: 'ghp_abc', tokenType: 'PAT', notes: 'nota\nsecreta' },
    customFields: [{ name: 'Conta', value: '42', type: 'text' }, { name: 'PIN', value: '9876', type: 'password' }],
    files: [{ name: 'chave.pem', size: 2048, data: 'QUJD' }],
    project: 'tcg-scanner',
    tags: ['ci']
  });
  assert.strictEqual(s.type, 'token');
  assert.deepStrictEqual(s.values, { username: 'bot@x.com', url: 'https://github.com', tokenType: 'PAT' });
  assert.deepStrictEqual(s.lengths, { password: 11, token: 7, notes: 12 });
  assert.deepStrictEqual(s.custom, [{ name: 'Conta', value: '42' }, { name: 'PIN', secret: true, length: 4 }]);
  assert.deepStrictEqual(s.files, [{ name: 'chave.pem', size: 2048 }]);
  // O app 2.4.0 do celular lê só os nomes
  assert.deepStrictEqual(s.fields, ['username', 'password', 'url', 'token', 'tokenType', 'notes']);
  assert.deepStrictEqual(s.customFields, ['Conta', 'PIN']);
  const texto = JSON.stringify(s);
  for (const segredo of ['segredo-123', 'ghp_abc', 'secreta', '9876', 'QUJD']) assert.ok(!texto.includes(segredo), segredo);
});

test('gravação com o cofre bloqueado: aprovada no celular guarda a senha para gravar', async () => {
  const job = { id: 'j1', request: { target: { title: 'Token' }, fields: { token: 'x' }, files: [], client: 'claude-code' }, deadline: Date.now() + 60000 };
  let pcPerguntado = false;
  const p = access.confirmWrite(job, { ask: () => { pcPerguntado = true; return new Promise(() => {}); }, cancel() {} });
  const pedido = await esperarPedido(7);
  assert.strictEqual(pedido.kind, 'write');
  assert.deepStrictEqual(pedido.summary.fields, ['token']);
  assert.strictEqual(pedido.summary.target, 'Token');
  assert.ok(!JSON.stringify(pedido.summary).includes('"x"'), 'nenhum valor vai ao celular');
  celular.responder(aprovar());
  const r = await p;
  assert.deepStrictEqual(r, { success: true, approved: true });
  assert.strictEqual(job.password, PASSWORD);
  assert.strictEqual(pcPerguntado, false, 'cofre bloqueado: sem modal no PC');
});

test('celular sem internet e PC bloqueado: vence no prazo e não pergunta depois', async () => {
  lib.writeSettings(DATA_DIR, { remote: true });
  noSession();
  let pcPerguntado = false;
  const job = { id: 'j3', request: { target: { title: 'T' } }, deadline: Date.now() + 300 };
  const p = access.confirmWrite(job, { ask: () => { pcPerguntado = true; return Promise.resolve({ success: true, approved: true }); }, cancel() {} });
  await esperarPedido(8);
  celular.responder(Object.assign(new Error('sem internet'), { code: 'offline' }));
  const r = await p;
  assert.deepStrictEqual(r, { success: true, approved: false, expired: true });
  access.onUnlock(); // desbloqueou depois: nada aparece
  await new Promise((x) => setTimeout(x, 20));
  assert.strictEqual(pcPerguntado, false);
});

test('gravação com o cofre bloqueado e sem celular: "bloqueado" na hora', async () => {
  lib.writeSettings(DATA_DIR, { remote: false });
  const r = await access.confirmWrite({ id: 'j2', request: { target: { title: 'T' } }, deadline: Date.now() + 60000 }, { ask: () => assert.fail(), cancel() {} });
  assert.strictEqual(r.locked, true);
  assert.ok(vault); // carregado junto com o módulo
});
