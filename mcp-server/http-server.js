#!/usr/bin/env node
/**
 * MySecrets MCP Server — transporte HTTP (Streamable HTTP)
 *
 * Modo de servidor persistente, pensado para ser INICIADO E CONTROLADO pelo
 * app desktop MySecrets. Fica escutando em 127.0.0.1:<porta> e responde
 * requisições JSON-RPC do MCP em POST /mcp.
 *
 * SEGURANÇA:
 *   - Escuta apenas em loopback (127.0.0.1).
 *   - Exige cabeçalho `Authorization: Bearer <token>` — o token é gerado pelo
 *     app e passado via env MYSECRETS_MCP_TOKEN. Sem o token correto, tudo é 401.
 *   - Valida o cabeçalho Origin para mitigar DNS rebinding a partir de páginas web.
 *   - POST /pair entrega o token à extensão só depois que o app aprova o id dela.
 *   - Só devolve segredos com o cofre aberto e desbloqueado (via .session).
 *   - Gravações de agente (store_secret, store_secret_file) sobem ao app por IPC
 *     e só são aplicadas depois que o usuário confirma no diálogo do app (ou no
 *     celular, de qualquer lugar: docs/developer/RELAY.md).
 *   - Leituras com o cofre bloqueado (ou sempre, se configurado) também sobem
 *     ao app, que pede a aprovação e devolve o resultado daquela chamada.
 *     Pedidos com Origin (extensão do navegador) não podem gravar por aí.
 *
 * Configuração por ambiente:
 *   MYSECRETS_MCP_PORT   porta TCP (padrão 8765)
 *   MYSECRETS_MCP_TOKEN  token bearer obrigatório (se ausente, gera um e loga)
 *   MYSECRETS_MCP_HOST   host de bind (padrão 127.0.0.1)
 */

const http = require('http');
const crypto = require('crypto');
const { dispatch, matchUrl, appError } = require('./core');
const vault = require('./vault');
const passkeys = require('./passkeys');

const PORT = parseInt(process.env.MYSECRETS_MCP_PORT || '8765', 10);
const HOST = process.env.MYSECRETS_MCP_HOST || '127.0.0.1';
const TOKEN = process.env.MYSECRETS_MCP_TOKEN || crypto.randomBytes(24).toString('hex');
// 4 MB: um anexo de até 1 MB chega em base64 dentro do JSON-RPC
const MAX_BODY = 4 * 1024 * 1024;

function log(...args) {
  process.stderr.write('[mysecrets-mcp-http] ' + args.join(' ') + '\n');
}

// Comparação de tokens resistente a timing
function tokenOk(header) {
  if (!header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  const provided = Buffer.from(m[1]);
  const expected = Buffer.from(TOKEN);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

// Rejeita origens de navegador (DNS rebinding). Clientes MCP nativos não enviam
// Origin. A extensão de autofill envia chrome-extension://<id>: é liberada porque
// continua obrigada a apresentar o token, que só sai do app via pareamento.
const EXTENSION_ORIGIN = /^(chrome|moz)-extension:\/\//;

function originOk(origin) {
  if (!origin) return true;
  if (EXTENSION_ORIGIN.test(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch (_) {
    return false;
  }
}

// A extensão roda em outra origem, então precisa dos cabeçalhos CORS liberados.
function corsHeaders(origin) {
  if (!origin || !EXTENSION_ORIGIN.test(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600'
  };
}

function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

// ===== Pedidos ao app (processo pai) =====
//
// O cofre aberto e a decisão do usuário vivem no app, então salvar login e
// parear a extensão sobem pelo canal IPC do processo pai. Sem o app como pai,
// nenhum dos dois funciona.

const SAVE_TIMEOUT = 15000;
const PAIR_TIMEOUT = 60000; // o usuário pode precisar responder a pergunta no app
// Gravação de agente: o app dá 240 s para a confirmação (contando a fila) e
// até 10 s para gravar, e sempre responde antes deste limite. Se mesmo assim
// ele estourar, o pedido é cancelado no app (não grava depois). O transporte
// stdio (index.js) espera um pouco mais que isto.
const AGENT_WRITE_TIMEOUT = parseInt(process.env.MYSECRETS_AGENT_WRITE_TIMEOUT || '260000', 10); // env: só para testes
// Leitura com o cofre bloqueado (ou aprovação "sempre"): mesmos prazos da gravação
const AGENT_READ_TIMEOUT = AGENT_WRITE_TIMEOUT;
const RESULT_TYPES = new Set(['save_login_result', 'pair_result', 'agent_write_result', 'agent_read_result', 'passkey_create_result']);
const pendingAsks = new Map();

if (process.send) {
  // App encerrado (até por sinal, sem passar pelo before-quit): sai junto, em
  // vez de ficar órfão segurando a porta
  process.on('disconnect', () => process.exit(0));
  process.on('message', (msg) => {
    if (!msg || !RESULT_TYPES.has(msg.type)) return;
    const p = pendingAsks.get(msg.reqId);
    if (!p) return;
    pendingAsks.delete(msg.reqId);
    clearTimeout(p.timer);
    p.resolve(msg.result || { success: false, error: 'Resposta vazia do app' });
  });
}

function askApp(type, payload, timeout) {
  return new Promise((resolve) => {
    if (!process.send) {
      resolve({ success: false, error: 'Servidor não foi iniciado pelo app MySecrets' });
      return;
    }
    const reqId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingAsks.delete(reqId);
      resolve({ success: false, error: 'O app não respondeu' });
    }, timeout);
    pendingAsks.set(reqId, { resolve, timer });
    process.send({ type, reqId, payload });
  });
}

// ===== Salvar login vindo da extensão =====
//
// Método fora do MCP ('mysecrets/save_login'): quem grava a entrada é o app.

function validSaveParams(p) {
  if (!p || typeof p !== 'object') return 'Parâmetros ausentes';
  if (typeof p.url !== 'string' || p.url.length > 2048 || !/^https?:\/\//i.test(p.url)) return 'URL inválida';
  if (p.username != null && (typeof p.username !== 'string' || p.username.length > 512)) return 'Usuário inválido';
  if (typeof p.password !== 'string' || !p.password || p.password.length > 4096) return 'Senha inválida';
  if (p.id != null && (typeof p.id !== 'string' || p.id.length > 128)) return 'Id inválido';
  return null;
}

function askAppToSave(params) {
  return askApp('save_login', {
    id: params.id || null, url: params.url, username: params.username || '', password: params.password
  }, SAVE_TIMEOUT);
}

// ===== Pareamento automático da extensão =====
//
// POST /pair devolve url + token, sem o usuário copiar código nenhum. Quem
// identifica a extensão é o Origin (chrome-extension://<id>): página web não
// consegue enviá-lo e cada extensão tem o seu. O app pergunta ao usuário na
// primeira vez que um id pede e lembra a resposta.

async function handlePair(req, res, reply) {
  const origin = req.headers.origin;
  if (!origin || !EXTENSION_ORIGIN.test(origin)) {
    return reply(403, { error: 'Só a extensão pode parear' });
  }
  const result = await askApp('pair_request', { origin }, PAIR_TIMEOUT);
  if (!result.success) {
    return reply(403, { error: result.error || 'Conexão recusada no app' });
  }
  return reply(200, { url: `http://${HOST}:${req.socket.localPort}/mcp`, token: TOKEN });
}

// Gravação (e leitura que pede aprovação) de agente: como askApp, mas avisa o
// app para cancelar o pedido se o cliente desconectar ou o prazo estourar,
// para nada ser gravado (ou liberado) depois de o agente já ter recebido um erro.
function submitAgentWrite(pedido, res) {
  return submitToApp('agent_write', pedido, res, AGENT_WRITE_TIMEOUT,
    'O app não respondeu a tempo; o pedido foi cancelado e nada foi gravado.');
}

function submitAgentRead(pedido, res) {
  return submitToApp('agent_read', pedido, res, AGENT_READ_TIMEOUT,
    'O app não respondeu a tempo; o pedido de leitura foi cancelado.');
}

function submitToApp(type, pedido, res, timeout, timeoutError) {
  return new Promise((resolve) => {
    if (!process.send) {
      resolve({ success: false, error: 'Servidor não foi iniciado pelo app MySecrets' });
      return;
    }
    const reqId = crypto.randomUUID();
    let done = false;
    const cancelInApp = () => {
      try { process.send({ type: `${type}_cancel`, reqId }); } catch (_) { /* app encerrado */ }
    };
    const finish = (result) => {
      if (done) return;
      done = true;
      pendingAsks.delete(reqId);
      clearTimeout(timer);
      if (res) res.removeListener('close', onClose);
      resolve(result);
    };
    const timer = setTimeout(() => {
      cancelInApp();
      finish({ success: false, expired: true, error: timeoutError });
    }, timeout);
    const onClose = () => {
      if (res.writableEnded) return;
      cancelInApp();
      finish({ success: false, cancelled: true, error: 'Cliente desconectou' });
    };
    if (res) res.on('close', onClose);
    pendingAsks.set(reqId, { resolve: finish, timer });
    process.send({ type, reqId, payload: pedido });
  });
}

// ===== Nome do agente =====
//
// Aparece no pedido de aprovação ("claude-code quer ler..."). Vem do
// clientInfo do initialize: o transporte stdio repassa no cabeçalho
// X-MySecrets-Client; clientes HTTP diretos recebem um Mcp-Session-Id no
// initialize e mandam de volta nas chamadas seguintes.

const clientNames = new Map(); // Mcp-Session-Id -> nome
const MAX_CLIENT_SESSIONS = 200;

// Letras de qualquer idioma (com acento), números e um pouco de pontuação
function cleanClientName(name) {
  const v = String(name || '').normalize('NFC').replace(/[^\p{L}\p{M}\p{N}_ .@()+-]/gu, '').trim().slice(0, 60);
  return v || null;
}

/**
 * Valor do cabeçalho X-MySecrets-Client. O stdio manda com encodeURIComponent
 * (cabeçalho HTTP só leva latin1); um cliente que mandou UTF-8 cru chega
 * como latin1 e é recuperado aqui.
 */
function headerText(h) {
  if (h == null) return '';
  const s = String(h);
  if (/%[0-9A-Fa-f]{2}/.test(s)) {
    try { return decodeURIComponent(s); } catch (_) { /* não era URI */ }
  }
  // eslint-disable-next-line no-control-regex -- só bytes latin1
  if (/[\u0080-\u00ff]/.test(s) && /^[\u0000-\u00ff]*$/.test(s)) {
    const u = Buffer.from(s, 'latin1').toString('utf8');
    if (!u.includes('\uFFFD')) return u;
  }
  return s;
}

function rememberClient(name) {
  const id = crypto.randomUUID();
  clientNames.set(id, cleanClientName(name) || 'agente-http');
  if (clientNames.size > MAX_CLIENT_SESSIONS) clientNames.delete(clientNames.keys().next().value);
  return id;
}

function clientName(req) {
  if (req.headers.origin) return 'extensao';
  return cleanClientName(headerText(req.headers['x-mysecrets-client'])) ||
    clientNames.get(String(req.headers['mcp-session-id'] || '')) || 'agente-http';
}

// Contexto das ferramentas MCP: gravação vai ao app, que pede confirmação;
// leitura com o cofre bloqueado também (a extensão, não).
function toolContext(req, res) {
  const client = clientName(req);
  const ctx = {
    allowWrite: !req.headers.origin,
    client,
    submitWrite: (pedido) => submitAgentWrite({ ...pedido, client }, res)
  };
  if (!req.headers.origin) {
    ctx.requestRead = async (tool, args) => {
      const r = await submitAgentRead({ tool, args, client }, res);
      if (!r || !r.success) throw appError(r, 'O app não liberou a leitura.');
      return { data: r.data, approval: r.approval };
    };
  }
  return ctx;
}

async function handleSaveLogin(msg, reply) {
  const erro = validSaveParams(msg.params);
  if (erro) return reply(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: erro } });
  // Atualizar a senha de uma entrada existente: ela precisa ser do mesmo site
  // do formulário enviado, senão um site parecido trocaria a senha de outro.
  if (msg.params.id) {
    let doSite = [];
    try {
      if (vault.checkSession().scope !== 'agent-read') doSite = matchUrl(vault.loadEntries(), msg.params.url, { types: ['login'] });
    } catch (_) { /* bloqueado */ }
    if (!doSite.some((e) => e.id === msg.params.id)) {
      return reply(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Esta entrada não é do site do formulário' } });
    }
  }
  const result = await askAppToSave(msg.params);
  if (!result.success) {
    return reply(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: result.error || 'Falha ao salvar' } });
  }
  return reply(200, { jsonrpc: '2.0', id: msg.id, result: { saved: true, id: result.id, mode: result.mode } });
}

const server = http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0];
  const cors = corsHeaders(req.headers.origin);
  const reply = (status, obj, extra = {}) => sendJson(res, status, obj, { ...cors, ...extra });

  // Endpoint de saúde: não exige token, não expõe nada sensível.
  if (req.method === 'GET' && (url === '/health' || url === '/')) {
    const s = vault.checkSession();
    return sendJson(res, 200, {
      server: 'mysecrets-mcp',
      transport: 'http',
      // A liberação de leitura para agentes não conta (a extensão não a usa)
      vaultAccessible: !!(s.valid && s.unlocked && s.scope !== 'agent-read')
    });
  }

  if (url !== '/mcp' && url !== '/pair') {
    return sendJson(res, 404, { error: 'Not found' });
  }

  if (!originOk(req.headers.origin)) {
    return sendJson(res, 403, { error: 'Origin não permitida' });
  }

  // Preflight do navegador: não carrega Authorization, então responde antes do token.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }

  if (url === '/pair') {
    if (req.method !== 'POST') return reply(405, { error: 'Use POST' }, { 'Allow': 'POST' });
    return handlePair(req, res, reply);
  }

  if (!tokenOk(req.headers.authorization)) {
    return reply(401, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Não autorizado: token ausente ou inválido' }
    }, { 'WWW-Authenticate': 'Bearer' });
  }

  // Streamable HTTP: o GET abriria um stream SSE (opcional). Não usamos push,
  // então respondemos 405 e o cliente segue só com POST.
  if (req.method === 'GET') {
    return reply(405, { error: 'GET não suportado (use POST)' }, { 'Allow': 'POST' });
  }

  if (req.method !== 'POST') {
    return reply(405, { error: 'Método não suportado' }, { 'Allow': 'POST' });
  }

  let body = '';
  let tooBig = false;
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY) {
      tooBig = true;
      req.destroy();
    }
  });
  req.on('end', async () => {
    if (tooBig) return;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (_) {
      return reply(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }

    // Aceita mensagem única ou batch
    if (Array.isArray(parsed)) {
      const ctx = toolContext(req, res);
      const responses = (await Promise.all(parsed.map((m) => dispatch(m, ctx)))).filter(Boolean);
      // Batch só com notificações → 202 sem corpo
      if (responses.length === 0) {
        res.writeHead(202, cors);
        return res.end();
      }
      return reply(200, responses);
    }

    if (parsed && parsed.method === 'mysecrets/save_login') {
      return handleSaveLogin(parsed, reply);
    }

    if (parsed && passkeys.METHODS.has(parsed.method)) {
      // Só a extensão (Origin de extensão já aprovada em originOk); agentes, não
      if (!/^(chrome|moz)-extension:\/\//.test(req.headers.origin || '')) {
        return reply(200, { jsonrpc: '2.0', id: parsed.id, error: { code: -32601, message: 'Method not found' } });
      }
      const out = await passkeys.handle(parsed.method, parsed.params, askApp);
      return reply(200, { jsonrpc: '2.0', id: parsed.id, ...out });
    }

    // initialize de cliente HTTP direto: guarda o nome para os pedidos de aprovação
    const extra = {};
    if (parsed && parsed.method === 'initialize' && !req.headers.origin) {
      const info = parsed.params && parsed.params.clientInfo;
      extra['Mcp-Session-Id'] = rememberClient(info && info.name);
    }
    const response = await dispatch(parsed, toolContext(req, res));
    if (!response) {
      res.writeHead(202, cors); // notificação
      return res.end();
    }
    return reply(200, response, extra);
  });
  req.on('error', () => { /* conexão abortada */ });
});

server.on('error', (err) => {
  log('ERRO no servidor:', err.message);
  // Sinaliza ao processo pai (app) que a porta falhou
  if (err.code === 'EADDRINUSE') {
    process.exitCode = 2;
  }
  process.exit(2);
});

if (require.main === module) server.listen(PORT, HOST, () => {
  // Primeira linha do stdout = JSON com os dados de conexão, para o app parsear.
  process.stdout.write(JSON.stringify({
    ready: true,
    host: HOST,
    port: PORT,
    url: `http://${HOST}:${PORT}/mcp`,
    token: TOKEN
  }) + '\n');
  log(`Escutando em http://${HOST}:${PORT}/mcp`);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

module.exports = { originOk, corsHeaders, server, validSaveParams, cleanClientName, headerText };
