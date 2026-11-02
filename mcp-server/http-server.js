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
 *   - Só devolve segredos com o cofre aberto e desbloqueado (via .session).
 *
 * Configuração por ambiente:
 *   MYSECRETS_MCP_PORT   porta TCP (padrão 8765)
 *   MYSECRETS_MCP_TOKEN  token bearer obrigatório (se ausente, gera um e loga)
 *   MYSECRETS_MCP_HOST   host de bind (padrão 127.0.0.1)
 */

const http = require('http');
const crypto = require('crypto');
const { dispatch } = require('./core');
const vault = require('./vault');

const PORT = parseInt(process.env.MYSECRETS_MCP_PORT || '8765', 10);
const HOST = process.env.MYSECRETS_MCP_HOST || '127.0.0.1';
const TOKEN = process.env.MYSECRETS_MCP_TOKEN || crypto.randomBytes(24).toString('hex');
const MAX_BODY = 1024 * 1024; // 1MB

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

// ===== Salvar login vindo da extensão =====
//
// Método fora do MCP ('mysecrets/save_login'): o cofre aberto vive no app, então
// o pedido sobe pelo canal IPC do processo pai (o app que iniciou este servidor)
// e o app grava a entrada. Sem o app como pai, não há como salvar.

const SAVE_TIMEOUT = 15000;
const pendingSaves = new Map();

if (process.send) {
  process.on('message', (msg) => {
    if (!msg || msg.type !== 'save_login_result') return;
    const p = pendingSaves.get(msg.reqId);
    if (!p) return;
    pendingSaves.delete(msg.reqId);
    clearTimeout(p.timer);
    p.resolve(msg.result || { success: false, error: 'Resposta vazia do app' });
  });
}

function validSaveParams(p) {
  if (!p || typeof p !== 'object') return 'Parâmetros ausentes';
  if (typeof p.url !== 'string' || p.url.length > 2048 || !/^https?:\/\//i.test(p.url)) return 'URL inválida';
  if (p.username != null && (typeof p.username !== 'string' || p.username.length > 512)) return 'Usuário inválido';
  if (typeof p.password !== 'string' || !p.password || p.password.length > 4096) return 'Senha inválida';
  if (p.id != null && (typeof p.id !== 'string' || p.id.length > 128)) return 'Id inválido';
  return null;
}

function askAppToSave(params) {
  return new Promise((resolve) => {
    if (!process.send) {
      resolve({ success: false, error: 'Servidor não foi iniciado pelo app MySecrets' });
      return;
    }
    const reqId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingSaves.delete(reqId);
      resolve({ success: false, error: 'O app não respondeu' });
    }, SAVE_TIMEOUT);
    pendingSaves.set(reqId, { resolve, timer });
    process.send({
      type: 'save_login',
      reqId,
      payload: { id: params.id || null, url: params.url, username: params.username || '', password: params.password }
    });
  });
}

async function handleSaveLogin(msg, reply) {
  const erro = validSaveParams(msg.params);
  if (erro) return reply(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: erro } });
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
      vaultAccessible: !!(s.valid && s.unlocked)
    });
  }

  if (url !== '/mcp') {
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
  req.on('end', () => {
    if (tooBig) return;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (_) {
      return reply(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }

    // Aceita mensagem única ou batch
    if (Array.isArray(parsed)) {
      const responses = parsed.map(dispatch).filter(Boolean);
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

    const response = dispatch(parsed);
    if (!response) {
      res.writeHead(202, cors); // notificação
      return res.end();
    }
    return reply(200, response);
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

module.exports = { originOk, corsHeaders, server, validSaveParams };
