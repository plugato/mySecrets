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

module.exports = { originOk, corsHeaders, server };
