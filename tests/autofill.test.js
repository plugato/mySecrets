// Integração de autofill: casamento de domínio, pareamento e acesso da extensão
// ao servidor local.

const { test } = require('node:test');
const assert = require('node:assert');

process.env.MYSECRETS_MCP_TOKEN = 'token-de-teste';
const { originOk, corsHeaders, server } = require('../mcp-server/http-server');

const lib = import('../chrome-extension/lib.mjs');
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnop';

// ===== Casamento de domínio =====

test('hostCandidates: domínio exato, sem www e domínio base', async () => {
  const { hostCandidates } = await lib;
  assert.deepStrictEqual(hostCandidates('https://github.com/login'), ['github.com']);
  assert.deepStrictEqual(hostCandidates('https://www.github.com/login'), ['www.github.com', 'github.com']);
  assert.deepStrictEqual(
    hostCandidates('https://accounts.google.com/signin'),
    ['accounts.google.com', 'google.com']
  );
  // sufixo composto: não pode reduzir para "com.br"
  assert.deepStrictEqual(
    hostCandidates('https://app.exemplo.com.br/login'),
    ['app.exemplo.com.br', 'exemplo.com.br']
  );
  assert.deepStrictEqual(hostCandidates('chrome://extensions'), []);
  assert.deepStrictEqual(hostCandidates('nao-e-url'), []);
});

// ===== Pareamento =====

const code = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');

test('parsePairingCode: aceita loopback', async () => {
  const { parsePairingCode } = await lib;
  const conn = parsePairingCode(code({ url: 'http://127.0.0.1:8765/mcp', token: 'abc' }));
  assert.deepStrictEqual(conn, { url: 'http://127.0.0.1:8765/mcp', token: 'abc' });
});

test('parsePairingCode: recusa servidor remoto e código quebrado', async () => {
  const { parsePairingCode } = await lib;
  const remoto = code({ url: 'http://evil.example.com/mcp', token: 'abc' });
  assert.throws(() => parsePairingCode(remoto), /fora do seu computador/);
  assert.throws(() => parsePairingCode(code({ url: 'http://127.0.0.1/mcp' })), /incompleto/);
  assert.throws(() => parsePairingCode('nada disso'), /inválido/);
});

// ===== Origem e CORS =====

test('originOk: libera extensão e loopback, bloqueia página web', () => {
  assert.strictEqual(originOk(EXT_ORIGIN), true);
  assert.strictEqual(originOk('moz-extension://abc'), true);
  assert.strictEqual(originOk('http://localhost:3000'), true);
  assert.strictEqual(originOk(undefined), true, 'cliente MCP nativo não envia Origin');
  assert.strictEqual(originOk('https://evil.example.com'), false);
});

test('corsHeaders: só ecoa origem de extensão', () => {
  assert.strictEqual(corsHeaders(EXT_ORIGIN)['Access-Control-Allow-Origin'], EXT_ORIGIN);
  assert.deepStrictEqual(corsHeaders('https://evil.example.com'), {});
});

// ===== Servidor respondendo à extensão =====

test('servidor: preflight, token e bloqueio de página web', async (t) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const call = (headers, method = 'POST') => fetch(url, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) : undefined
  });

  const preflight = await call({ Origin: EXT_ORIGIN }, 'OPTIONS');
  assert.strictEqual(preflight.status, 204, 'preflight não pode exigir token');
  assert.strictEqual(preflight.headers.get('access-control-allow-origin'), EXT_ORIGIN);

  const semToken = await call({ Origin: EXT_ORIGIN, 'Content-Type': 'application/json' });
  assert.strictEqual(semToken.status, 401);
  assert.strictEqual(semToken.headers.get('access-control-allow-origin'), EXT_ORIGIN);

  const comToken = await call({
    Origin: EXT_ORIGIN,
    'Content-Type': 'application/json',
    Authorization: 'Bearer token-de-teste'
  });
  assert.strictEqual(comToken.status, 200);
  assert.strictEqual(comToken.headers.get('access-control-allow-origin'), EXT_ORIGIN);

  const paginaWeb = await call({
    Origin: 'https://evil.example.com',
    'Content-Type': 'application/json',
    Authorization: 'Bearer token-de-teste'
  });
  assert.strictEqual(paginaWeb.status, 403, 'página web não pode falar com o cofre');
});

// ===== Oferecer para salvar logins =====

test('saveDecision: novo, conferir senha, sem usuário', async () => {
  const { saveDecision } = await lib;
  const logins = [{ id: '1', username: 'Eu@Exemplo.com' }, { id: '2', username: 'outro' }];
  assert.deepStrictEqual(saveDecision(logins, ' eu@exemplo.com '), { mode: 'check', id: '1' });
  assert.deepStrictEqual(saveDecision(logins, 'novo'), { mode: 'new' });
  assert.deepStrictEqual(saveDecision([], 'eu'), { mode: 'new' });
  assert.deepStrictEqual(saveDecision([{ id: '9', username: 'x' }], ''), { mode: 'check', id: '9' });
  assert.deepStrictEqual(saveDecision(logins, ''), { mode: 'new' });
});

test('displayHost: tira www e ignora páginas internas', async () => {
  const { displayHost } = await lib;
  assert.strictEqual(displayHost('https://www.GitHub.com/login?x=1'), 'github.com');
  assert.strictEqual(displayHost('chrome://settings'), '');
  assert.strictEqual(displayHost('lixo'), '');
});

test('validSaveParams: só aceita login web com senha', () => {
  const { validSaveParams } = require('../mcp-server/http-server');
  assert.strictEqual(validSaveParams({ url: 'https://a.com', username: 'eu', password: 'p' }), null);
  assert.match(validSaveParams({ url: 'javascript:alert(1)', password: 'p' }), /URL/);
  assert.match(validSaveParams({ url: 'https://a.com', password: '' }), /Senha/);
  assert.match(validSaveParams({ url: 'https://a.com', password: 'p', username: 'x'.repeat(600) }), /Usuário/);
  assert.match(validSaveParams(null), /ausentes/);
});

test('save_login: servidor repassa ao app por IPC e devolve o resultado', async (t) => {
  const { fork } = require('node:child_process');
  const path = require('node:path');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = fork(path.join(__dirname, '..', 'mcp-server', 'http-server.js'), [], {
    env: { ...process.env, MYSECRETS_MCP_PORT: String(port), MYSECRETS_MCP_TOKEN: 'tk', MYSECRETS_MCP_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  t.after(() => child.kill());

  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve);
    child.once('exit', () => reject(new Error('servidor saiu')));
  });

  // Faz o papel do app: grava e responde
  const recebidos = [];
  child.on('message', (msg) => {
    recebidos.push(msg.payload);
    const result = msg.payload.password === 'falhar'
      ? { success: false, error: 'Cofre bloqueado' }
      : { success: true, id: 'novo1', mode: msg.payload.id ? 'update' : 'new' };
    child.send({ type: 'save_login_result', reqId: msg.reqId, result });
  });

  const chamar = (params, token = 'tk') => fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: EXT_ORIGIN },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'mysecrets/save_login', params })
  });

  let r = await chamar({ url: 'https://github.com/login', username: 'eu', password: 's3nha' });
  let body = await r.json();
  assert.deepStrictEqual(body.result, { saved: true, id: 'novo1', mode: 'new' });
  assert.deepStrictEqual(recebidos[0], { id: null, url: 'https://github.com/login', username: 'eu', password: 's3nha' });

  body = await (await chamar({ url: 'https://github.com', password: 'falhar' })).json();
  assert.strictEqual(body.error.message, 'Cofre bloqueado');

  body = await (await chamar({ url: 'ftp://x', password: 'p' })).json();
  assert.match(body.error.message, /URL/);
  assert.strictEqual(recebidos.length, 2, 'parâmetro inválido não chega ao app');

  r = await chamar({ url: 'https://github.com', password: 'p' }, 'errado');
  assert.strictEqual(r.status, 401);
  assert.strictEqual(recebidos.length, 2, 'sem token não chega ao app');
});
