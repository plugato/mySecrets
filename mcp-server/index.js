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
 */

const { dispatch } = require('./core');
const vault = require('./vault');

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
    try {
      const response = dispatch(JSON.parse(line));
      if (response) send(response);
    } catch (err) {
      process.stderr.write('[mysecrets-mcp] JSON inválido: ' + err.message + '\n');
    }
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

process.stderr.write('[mysecrets-mcp] Servidor MCP (stdio) iniciado. Cofre: ' + vault.USER_DATA_PATH + '\n');
