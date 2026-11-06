/**
 * MySecrets - Registro das leituras feitas por agentes (MCP) e pela extensão.
 *
 * Só ferramentas que entregam segredos ou listam o cofre. Guarda data,
 * ferramenta, cliente e os ids das entradas: nenhum título, senha ou texto
 * (o app mostra os títulos, porque tem o cofre aberto). As consultas
 * match_url que a extensão faz em cada página não entram (seria um histórico
 * de navegação).
 *
 * Arquivo: mcp-audit.jsonl no perfil do app (600), limitado às últimas linhas.
 */

const fs = require('fs');
const path = require('path');

const FILE = 'mcp-audit.jsonl';
const AUDITADAS = new Set(['list_secrets', 'search_secrets', 'get_credentials', 'get_otp', 'get_secret_file', 'passkey_get']);
const MAX_LINHAS = 500;
const MAX_BYTES = 200 * 1024;

const arquivo = (dir) => path.join(dir, FILE);

/** ids das entradas que a ferramenta devolveu (sem conteúdo). */
function idsFrom(tool, data) {
  if (!data) return [];
  if (Array.isArray(data.results)) return data.results.map((e) => e && e.id).filter(Boolean).slice(0, 25);
  if (data.entry && data.entry.id) return [data.entry.id];
  if (data.id) return [data.id];
  return [];
}

function record(dir, { tool, client, data, now = Date.now() }) {
  if (!AUDITADAS.has(tool) || !dir) return;
  const f = arquivo(dir);
  const linha = JSON.stringify({ at: new Date(now).toISOString(), tool, client: client || 'agente', ids: idsFrom(tool, data) }) + '\n';
  fs.appendFileSync(f, linha, { mode: 0o600 });
  try {
    if (fs.statSync(f).size > MAX_BYTES) {
      const linhas = fs.readFileSync(f, 'utf8').trim().split('\n').slice(-MAX_LINHAS);
      fs.writeFileSync(f, linhas.join('\n') + '\n', { mode: 0o600 });
    }
  } catch (_) { /* o registro nunca atrapalha a leitura */ }
}

/** Últimos registros, do mais novo para o mais antigo. */
function read(dir, limit = 50) {
  let texto;
  try { texto = fs.readFileSync(arquivo(dir), 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const l of texto.trim().split('\n').reverse()) {
    if (out.length >= limit) break;
    try {
      const r = JSON.parse(l);
      if (r && AUDITADAS.has(r.tool)) out.push({ at: r.at, tool: r.tool, client: r.client, ids: Array.isArray(r.ids) ? r.ids : [] });
    } catch (_) { /* linha quebrada */ }
  }
  return out;
}

function clear(dir) {
  try { fs.unlinkSync(arquivo(dir)); } catch (_) { /* já não existia */ }
}

module.exports = { record, read, clear, idsFrom, AUDITADAS, FILE };
