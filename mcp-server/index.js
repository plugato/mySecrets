#!/usr/bin/env node
/**
 * MySecrets MCP Server — transporte stdio
 *
 * Expõe o cofre do MySecrets (senhas, tokens e OTPs) para clientes MCP
 * (Claude Desktop, Claude Code, etc.) via stdio. O cliente MCP é quem spawna
 * este processo.
 *
 * Para o modo HTTP (controlado pelo app desktop), veja http-server.js.
 *
 * SEGURANÇA: só devolve segredos enquanto o app MySecrets estiver ABERTO e
 * DESBLOQUEADO. A senha mestra nunca é persistida por este servidor.
 *
 * Gravação (store_secret, store_secret_file): este processo não grava o cofre.
 * Ele repassa a chamada ao servidor local do app (http-server.js, ligado ao
 * desbloquear), que pede confirmação ao usuário e grava pelo app. O endereço
 * vem de <userData>/.mcp-endpoint e o token de <userData>/.mcp-token, os dois
 * criados pelo app.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { dispatch } = require('./core');
const vault = require('./vault');

// Maior que o limite do servidor do app (260 s), que por sua vez é maior que o
// prazo de confirmação (240 s) + gravação (10 s): a resposta verdadeira chega antes.
const FORWARD_TIMEOUT = 275000;
const activeForwards = new Set();

function appEndpoint() {
  let port = null;
  try {
    const ep = JSON.parse(fs.readFileSync(path.join(vault.USER_DATA_PATH, '.mcp-endpoint'), 'utf8'));
    port = parseInt(ep.port, 10) || null;
  } catch (_) { /* servidor do app desligado */ }
  if (process.env.MYSECRETS_MCP_PORT) port = parseInt(process.env.MYSECRETS_MCP_PORT, 10) || port;
  let token = process.env.MYSECRETS_MCP_TOKEN || null;
  if (!token) {
    try { token = fs.readFileSync(path.join(vault.USER_DATA_PATH, '.mcp-token'), 'utf8').trim(); } catch (_) { /* sem token */ }
  }
  return { port, token };
}

/** Repassa uma ferramenta de gravação ao servidor HTTP do app. */
function forwardToApp(name, args) {
  const { port, token } = appEndpoint();
  if (!port || !token) {
    return Promise.reject(new Error(
      'O servidor local do MySecrets está desligado. Abra o app, desbloqueie o cofre e ' +
      'ligue o servidor MCP (botão MCP > Iniciar servidor, ou "iniciar ao desbloquear").'
    ));
  }
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/mcp',
      method: 'POST',
      timeout: FORWARD_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${token}`
      }
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode === 401) return reject(new Error('O app recusou o token (.mcp-token desatualizado?).'));
        try {
          const msg = JSON.parse(data);
          if (msg.error) return reject(new Error(msg.error.message));
          const text = msg.result && msg.result.content && msg.result.content[0] && msg.result.content[0].text;
          const parsed = JSON.parse(text || '{}');
          if (msg.result.isError) {
            const e = parsed.locked
              ? new vault.VaultLockedError(parsed.reason)
              : new Error(parsed.error || 'Falha ao gravar');
            ['declined', 'expired', 'cancelled'].forEach((k) => { if (parsed[k]) e[k] = true; });
            return reject(e);
          }
          resolve(parsed);
        } catch (_) {
          reject(new Error('Resposta inválida do servidor do app.'));
        }
      });
    });
    activeForwards.add(req);
    req.on('close', () => activeForwards.delete(req));
    // Fechar a conexão faz o servidor do app cancelar o pedido: nada é gravado depois
    req.on('timeout', () => req.destroy(new Error('O app não respondeu a tempo; o pedido foi cancelado.')));
    req.on('error', (err) => reject(err.code === 'ECONNREFUSED'
      ? new Error('O servidor local do MySecrets não está rodando. Abra e desbloqueie o app.')
      : err));
    req.end(body);
  });
}

const ctx = { forward: forwardToApp, client: 'agente-stdio' };

// O cliente MCP pode fechar o pipe enquanto um pedido espera confirmação:
// escrever no stdout fechado dá EPIPE. Encerra limpo em vez de cair.
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  // Cancela gravações em espera (o servidor do app fecha o modal e não grava)
  for (const req of activeForwards) req.destroy();
  setImmediate(() => process.exit(0));
}

process.stdout.on('error', (err) => {
  if (err.code !== 'EPIPE' && err.code !== 'ERR_STREAM_DESTROYED') {
    process.stderr.write('[mysecrets-mcp] erro no stdout: ' + err.message + '\n');
  }
  shutdown();
});

function send(msg) {
  if (shuttingDown || process.stdout.destroyed || !process.stdout.writable) return;
  try {
    process.stdout.write(JSON.stringify(msg) + '\n');
  } catch (_) {
    shutdown();
  }
}

// Leitura de mensagens JSON-RPC delimitadas por newline
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      process.stderr.write('[mysecrets-mcp] JSON inválido: ' + err.message + '\n');
      continue;
    }
    dispatch(msg, ctx).then((response) => { if (response) send(response); }, () => {});
  }
});

// stdin fechado = cliente foi embora: ninguém vai ler as respostas pendentes
process.stdin.on('end', shutdown);
process.stdin.on('close', shutdown);
process.stdin.on('error', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGPIPE', shutdown);

process.stderr.write('[mysecrets-mcp] Servidor MCP (stdio) iniciado. Cofre: ' + vault.USER_DATA_PATH + '\n');
