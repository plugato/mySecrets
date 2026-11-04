// Confirmação de gravação por agente: fila com prazo (main), modal (renderer),
// cancelamento quando o agente desiste e encerramento limpo do MCP stdio.
// Cobre o "falso negativo": o agente recebia "O app não respondeu" e a
// gravação acontecia depois, quando o usuário achava o diálogo escondido.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { fork, spawn } = require('node:child_process');

const { createAgentWriteQueue, EXPIRED_ERROR } = require('../src/lib/agent-queue');
const { createConfirmController, planAgentWrite, planSummary, formatRemaining } = require('../src/renderer/agent-write');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// Relógio controlado pelo teste
function fakeClock(start = 1000000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function queueWith(overrides = {}) {
  const log = { shown: [], applied: [], cancelledConfirm: [], counts: [] };
  const q = createAgentWriteQueue({
    windowMs: 240000,
    confirm: async () => ({ success: true, approved: true }),
    apply: async (job) => { log.applied.push(job.id); return { success: true, id: 'e1', mode: 'new', title: 'T' }; },
    cancelConfirm: (job) => log.cancelledConfirm.push(job.id),
    onShow: (job) => log.shown.push(job.id),
    onCount: (n) => log.counts.push(n),
    ...overrides
  });
  return { q, log };
}

// ===== Fila com prazo (src/lib/agent-queue.js) =====

test('fila: aprovado dentro do prazo grava e devolve o resultado verdadeiro', async () => {
  const { q, log } = queueWith();
  const r = await q.submit('a', { target: { title: 'T' }, files: [] });
  assert.deepStrictEqual(r, { success: true, id: 'e1', mode: 'new', title: 'T' });
  assert.deepStrictEqual(log.applied, ['a']);
  assert.deepStrictEqual(log.counts, [1, 0]);
});

test('falso negativo: aprovação que chega depois do prazo NÃO grava', async () => {
  const clock = fakeClock();
  const resposta = deferred();
  const { q, log } = queueWith({ now: clock.now, graceMs: 60000, confirm: () => resposta.promise });
  const pendente = q.submit('a', { target: { title: 'T' }, files: [] });
  await sleep(5);
  clock.advance(241000);           // usuário só acha o pedido depois de 4 min
  resposta.resolve({ success: true, approved: true });
  const r = await pendente;
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.expired, true);
  assert.strictEqual(r.error, EXPIRED_ERROR);
  assert.deepStrictEqual(log.applied, [], 'nada gravado depois do prazo');
});

test('falso negativo: o tempo na fila conta no prazo do pedido seguinte', async () => {
  const clock = fakeClock();
  const primeira = deferred();
  const restanteVisto = {};
  const { q, log } = queueWith({
    now: clock.now,
    confirm: (job) => {
      restanteVisto[job.id] = job.deadline - clock.now();
      return job.id === 'a' ? primeira.promise : { success: true, approved: true };
    }
  });
  const ra = q.submit('a', { target: { title: 'A' }, files: [] });
  clock.advance(10000);
  const rb = q.submit('b', { target: { title: 'B' }, files: [] });
  await sleep(5);
  assert.deepStrictEqual(log.shown, ['a'], 'um pedido por vez');
  clock.advance(229000);           // usuário aprova "a" aos 239 s
  primeira.resolve({ success: true, approved: true });
  assert.strictEqual((await ra).success, true);
  assert.strictEqual((await rb).success, true);
  assert.strictEqual(restanteVisto.b, 11000, '"b" esperou na fila: sobram 11 s, não 240 s');

  // Se "a" demora além do prazo de "b", "b" vence sem nem aparecer
  const segunda = deferred();
  const { q: q2, log: log2 } = queueWith({ now: clock.now, confirm: (job) => (job.id === 'c' ? segunda.promise : { success: true, approved: true }) });
  const rc = q2.submit('c', { target: { title: 'C' }, files: [] });
  const rd = q2.submit('d', { target: { title: 'D' }, files: [] });
  await sleep(5);
  clock.advance(241000);
  segunda.resolve({ success: true, approved: true });
  assert.strictEqual((await rc).expired, true);
  assert.strictEqual((await rd).expired, true);
  assert.deepStrictEqual(log2.shown, ['c'], 'pedido vencido nem aparece');
  assert.deepStrictEqual(log2.applied, []);
});

test('fila: confirmação sem resposta vence sozinha (sem gravar)', async () => {
  const { q, log } = queueWith({ windowMs: 40, graceMs: 10, confirm: () => new Promise(() => {}) });
  const r = await q.submit('a', { target: { title: 'T' }, files: [] });
  assert.strictEqual(r.expired, true);
  assert.deepStrictEqual(log.applied, []);
});

test('fila: agente cancela durante a confirmação ou ainda na fila', async () => {
  const resposta = deferred();
  const { q, log } = queueWith({ confirm: (job) => (job.id === 'a' ? resposta.promise : { success: true, approved: true }) });
  const ra = q.submit('a', { target: { title: 'A' }, files: [] });
  const rb = q.submit('b', { target: { title: 'B' }, files: [] });
  await sleep(5);
  assert.strictEqual(q.cancel('b'), true);
  assert.strictEqual(q.cancel('a'), true);
  assert.deepStrictEqual(log.cancelledConfirm, ['a'], 'fecha o modal aberto');
  resposta.resolve({ success: true, approved: true }); // clique tardio é ignorado
  assert.strictEqual((await ra).cancelled, true);
  assert.strictEqual((await rb).cancelled, true);
  assert.deepStrictEqual(log.applied, []);
  assert.strictEqual(q.cancel('nao-existe'), false);
});

test('fila: recusa e erro do renderer chegam ao agente como são', async () => {
  let resposta = { success: true, approved: false };
  const { q, log } = queueWith({ confirm: async () => resposta });
  let r = await q.submit('a', { target: { title: 'T' }, files: [] });
  assert.strictEqual(r.declined, true);
  resposta = { success: false, error: 'O cofre está bloqueado.' };
  r = await q.submit('b', { target: { title: 'T' }, files: [] });
  assert.strictEqual(r.error, 'O cofre está bloqueado.');
  assert.deepStrictEqual(log.applied, []);
});

// ===== Modal do renderer (createConfirmController) =====

function controller(clock) {
  const frames = [];
  let tick = null;
  const c = createConfirmController({
    render: (s) => frames.push(s),
    now: clock.now,
    setTimer: (fn) => { tick = fn; return 1; },
    clearTimer: () => { tick = null; }
  });
  return { c, frames, tick: () => tick && tick() };
}

const REQ = {
  target: { title: 'TCG Scanner — keystore de release' },
  project: 'tcg-scanner',
  fields: { password: 'senha-secreta-nao-mostrar', notes: 'nota secreta' },
  customFields: [{ name: 'storePassword', value: 'outra-secreta', type: 'password' }],
  files: [{ name: 'release.jks', size: 4096, sha256: 'ab'.repeat(32) }]
};

test('modal: mostra resumo sem valores, posição na fila e tempo; aprovar resolve', async () => {
  const clock = fakeClock();
  const { c, frames } = controller(clock);
  const plan = planAgentWrite([], REQ);
  const p = c.request('job1', plan, clock.now() + 240000, 3);
  const s = frames.at(-1);
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.remaining, '4:00');
  assert.strictEqual(s.summary.heading, 'Criar entrada nova');
  assert.deepStrictEqual(s.summary.tags, ['tcg-scanner']);
  assert.deepStrictEqual(s.summary.files, [{ name: 'release.jks', size: '4,0 KB', sha256: 'abababababab', replaces: false }]);
  const texto = JSON.stringify(s);
  for (const segredo of ['senha-secreta-nao-mostrar', 'nota secreta', 'outra-secreta']) {
    assert.ok(!texto.includes(segredo), `modal não mostra "${segredo}"`);
  }
  c.setTotal(2);
  assert.strictEqual(frames.at(-1).total, 2);
  assert.strictEqual(c.answer(true), true);
  assert.deepStrictEqual(await p, { success: true, approved: true });
  assert.strictEqual(frames.at(-1), null, 'modal fecha');
});

test('modal: recusar, vencer o prazo, cancelamento do agente e bloqueio', async () => {
  const clock = fakeClock();
  const { c, frames, tick } = controller(clock);
  const plan = planAgentWrite([], REQ);

  let p = c.request('j1', plan, clock.now() + 240000, 1);
  c.answer(false);
  assert.deepStrictEqual(await p, { success: true, approved: false });

  p = c.request('j2', plan, clock.now() + 240000, 1);
  clock.advance(200000);
  tick();
  assert.strictEqual(frames.at(-1).remaining, '0:40');
  clock.advance(40000);
  tick();
  assert.deepStrictEqual(await p, { success: true, approved: false, expired: true });
  assert.strictEqual(c.answer(true), false, 'clique depois de vencer não vale');

  p = c.request('j3', plan, clock.now() + 240000, 1);
  assert.strictEqual(c.cancel('outro'), false);
  c.cancel('j3');
  assert.strictEqual((await p).cancelled, true);

  p = c.request('j4', plan, clock.now() + 240000, 1);
  c.cancelAll('O cofre foi bloqueado antes da confirmação. Nada foi gravado.');
  assert.deepStrictEqual(await p, { success: false, error: 'O cofre foi bloqueado antes da confirmação. Nada foi gravado.' });
  assert.strictEqual(c.active(), null);
});

test('modal: atualização mostra o que é substituído', () => {
  const entries = [{
    id: 'k', title: 'TCG Scanner — keystore de release', type: 'token', tags: ['tcg-scanner'], password: 'x',
    customFields: [{ name: 'storePassword', value: 'v' }], attachments: [{ name: 'release.jks' }]
  }];
  const s = planSummary(planAgentWrite(entries, REQ));
  assert.strictEqual(s.heading, 'Atualizar entrada existente');
  assert.strictEqual(s.type, 'Token');
  assert.deepStrictEqual(s.fields, [{ name: 'senha', replaces: true }, { name: 'notas', replaces: false }]);
  assert.strictEqual(s.customFields[0].replaces, true);
  assert.strictEqual(s.files[0].replaces, true);
  assert.strictEqual(formatRemaining(61000), '1:01');
  assert.strictEqual(formatRemaining(-5), '0:00');
});

// ===== Servidor HTTP: cancela no app quando o agente desiste ou o prazo estoura =====

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-confirm-'));
process.on('exit', () => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

function writeUnlockedSession() {
  const secret = crypto.randomBytes(32);
  fs.writeFileSync(path.join(DATA_DIR, '.machine-secret'), secret);
  const key = crypto.createHash('sha256').update('mysecrets-session-v2').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(JSON.stringify({
    timestamp: Date.now(), pid: process.pid, unlocked: true, password: 'x',
    expiresAt: Date.now() + 900000, hostname: os.hostname()
  }), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  fs.writeFileSync(path.join(DATA_DIR, '.session'), JSON.stringify({
    version: 2, encrypted, iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex')
  }));
}

async function startServer(t, extraEnv = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = fork(path.join(__dirname, '..', 'mcp-server', 'http-server.js'), [], {
    env: {
      ...process.env, MYSECRETS_DATA_DIR: DATA_DIR, MYSECRETS_MCP_PORT: String(port),
      MYSECRETS_MCP_TOKEN: 'tk', MYSECRETS_MCP_HOST: '127.0.0.1', ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve);
    child.once('exit', () => reject(new Error('servidor saiu')));
  });
  fs.writeFileSync(path.join(DATA_DIR, '.mcp-endpoint'), JSON.stringify({ port }));
  fs.writeFileSync(path.join(DATA_DIR, '.mcp-token'), 'tk');
  return { child, port };
}

function waitMessage(child, type) {
  return new Promise((resolve) => {
    const onMsg = (m) => { if (m.type === type) { child.off('message', onMsg); resolve(m); } };
    child.on('message', onMsg);
  });
}

const storeCall = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name: 'store_secret', arguments: { title: 'X', notes: 'y' } }
});

test('servidor: prazo estourado devolve erro E cancela no app (não grava depois)', async (t) => {
  writeUnlockedSession();
  const { child, port } = await startServer(t, { MYSECRETS_AGENT_WRITE_TIMEOUT: '300' });
  const pedido = waitMessage(child, 'agent_write');
  const cancel = waitMessage(child, 'agent_write_cancel');
  const resp = fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tk' }, body: storeCall
  }).then((r) => r.json());
  const msg = await pedido;                 // o "app" recebe e não responde
  const c = await cancel;
  assert.strictEqual(c.reqId, msg.reqId, 'o app é avisado para descartar o pedido');
  const body = await resp;
  const out = JSON.parse(body.result.content[0].text);
  assert.strictEqual(body.result.isError, true);
  assert.strictEqual(out.expired, true);
  assert.match(out.error, /nada foi gravado/);
});

test('servidor: cliente que desconecta cancela o pedido no app', async (t) => {
  writeUnlockedSession();
  const { child, port } = await startServer(t);
  const pedido = waitMessage(child, 'agent_write');
  const cancel = waitMessage(child, 'agent_write_cancel');
  const req = http.request({
    host: '127.0.0.1', port, path: '/mcp', method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tk' }
  });
  req.on('error', () => {});
  req.end(storeCall);
  const msg = await pedido;
  req.destroy();                            // agente desistiu
  const c = await cancel;
  assert.strictEqual(c.reqId, msg.reqId);
});

// ===== MCP stdio: EPIPE e stdin fechado encerram limpo =====

function spawnStdio(t) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp-server', 'index.js')], {
    env: { ...process.env, MYSECRETS_DATA_DIR: DATA_DIR }, stdio: ['pipe', 'pipe', 'pipe']
  });
  t.after(() => child.kill());
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal, stderr: () => stderr })));
  return { child, exited };
}

test('stdio: cliente fecha o stdout com gravação pendente -> sai limpo (sem EPIPE) e cancela no app', async (t) => {
  writeUnlockedSession();
  const { child: server } = await startServer(t);
  const pedido = waitMessage(server, 'agent_write');
  const cancel = waitMessage(server, 'agent_write_cancel');
  const { child, exited } = spawnStdio(t);
  child.stdin.write(storeCall + '\n');
  await pedido;                             // pedido esperando confirmação no app
  child.stdout.destroy();                   // cliente MCP foi embora
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n'); // força uma escrita
  const r = await exited;
  assert.strictEqual(r.code, 0, r.stderr());
  assert.doesNotMatch(r.stderr(), /EPIPE|Unhandled/);
  await cancel;
});

test('stdio: stdin fechado com gravação pendente -> sai limpo e cancela no app', async (t) => {
  writeUnlockedSession();
  const { child: server } = await startServer(t);
  const pedido = waitMessage(server, 'agent_write');
  const cancel = waitMessage(server, 'agent_write_cancel');
  const { child, exited } = spawnStdio(t);
  child.stdin.write(storeCall + '\n');
  await pedido;
  child.stdin.end();
  const r = await exited;
  assert.strictEqual(r.code, 0, r.stderr());
  assert.doesNotMatch(r.stderr(), /EPIPE|Unhandled/);
  await cancel;
});
