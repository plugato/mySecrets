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

const FORWARD_TIMEOUT = 250000; // o usuário tem até 4 min para confirmar no app

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
            if (parsed.declined) e.declined = true;
            return reject(e);
          }
          resolve(parsed);
        } catch (_) {
          reject(new Error('Resposta inválida do servidor do app.'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('O app não respondeu a tempo.')));
    req.on('error', (err) => reject(err.code === 'ECONNREFUSED'
      ? new Error('O servidor local do MySecrets não está rodando. Abra e desbloqueie o app.')
      : err));
    req.end(body);
  });
}

const ctx = { forward: forwardToApp };

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
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
    dispatch(msg, ctx).then((response) => { if (response) send(response); });
  }
});

// Espera respostas pendentes (ex.: gravação aguardando confirmação) antes de sair
process.stdin.on('end', () => { process.exitCode = 0; });
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

process.stderr.write('[mysecrets-mcp] Servidor MCP (stdio) iniciado. Cofre: ' + vault.USER_DATA_PATH + '\n');
