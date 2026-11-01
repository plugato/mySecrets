/**
 * MySecrets MCP — núcleo compartilhado
 *
 * Contém a definição das ferramentas e o dispatcher JSON-RPC, sem depender
 * de nenhum transporte específico. É reutilizado por:
 *   - index.js        (transporte stdio, spawnado pelo cliente MCP)
 *   - http-server.js  (transporte HTTP, controlado pelo app desktop)
 */

const vault = require('./vault');

const SERVER_INFO = { name: 'mysecrets', version: '1.0.0' };
const PROTOCOL_VERSION = '2024-11-05';

// ===== Utilidades de busca =====

function scoreMatch(entry, query) {
  const q = query.toLowerCase();
  const fields = [entry.title, entry.url, entry.username, ...(entry.tags || [])]
    .filter(Boolean)
    .map((f) => String(f).toLowerCase());

  let best = 0;
  for (const f of fields) {
    if (f === q) best = Math.max(best, 100);
    else if (f.startsWith(q)) best = Math.max(best, 80);
    else if (f.includes(q)) best = Math.max(best, 60);
  }
  if (entry.url) {
    try {
      const host = new URL(entry.url).hostname.toLowerCase();
      if (host === q) best = Math.max(best, 90);
      else if (host.includes(q)) best = Math.max(best, 70);
    } catch (_) { /* url inválida */ }
  }
  return best;
}

function findEntries(entries, { id, query, type }) {
  if (id) return entries.filter((e) => e.id === id);
  let pool = entries;
  if (type) pool = pool.filter((e) => e.type === type);
  if (!query) return pool;
  return pool
    .map((e) => ({ e, score: scoreMatch(e, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.e);
}

function publicView(e) {
  return {
    id: e.id,
    type: e.type,
    title: e.title,
    username: e.username || null,
    url: e.url || null,
    tags: e.tags || [],
    hasPassword: !!e.password,
    hasOtp: !!(e.mfaSecret || e.linkedMfaId),
    notes: e.type === 'note' ? e.notes : undefined
  };
}

function resolveOtp(entry, allEntries) {
  let mfaEntry = null;
  if (entry.mfaSecret) mfaEntry = entry;
  else if (entry.linkedMfaId) {
    mfaEntry = allEntries.find((e) => e.id === entry.linkedMfaId && e.mfaSecret);
  }
  if (!mfaEntry) return null;
  const otp = vault.generateOtp(mfaEntry);
  return {
    ...otp,
    algorithm: mfaEntry.mfaAlgorithm || 'totp',
    hash: mfaEntry.mfaHash || 'sha1',
    digits: mfaEntry.mfaDigits || 6,
    linkedFrom: mfaEntry.id !== entry.id ? mfaEntry.id : undefined
  };
}

// ===== Definição das ferramentas =====

const TOOLS = [
  {
    name: 'vault_status',
    description:
      'Verifica se o cofre MySecrets está acessível (app aberto e desbloqueado). ' +
      'Chame isto primeiro se outras ferramentas indicarem bloqueio.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'list_secrets',
    description:
      'Lista as entradas do cofre SEM expor senhas ou segredos OTP. ' +
      'Útil para descobrir o que existe antes de pedir uma credencial específica.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['login', 'mfa', 'note'], description: 'Filtra por tipo.' },
        limit: { type: 'number', description: 'Máximo de itens (padrão 100).' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'search_secrets',
    description:
      'Busca entradas por título, URL/domínio, usuário ou tag. Retorna metadados ' +
      'SEM senhas. Use o id ou o título do resultado com get_credentials/get_otp.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto de busca (ex.: "github", "gitlab.empresa").' },
        type: { type: 'string', enum: ['login', 'mfa', 'note'] }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'get_credentials',
    description:
      'Retorna usuário e senha de uma entrada. Identifique por "id" (preferível) ' +
      'ou por "query" (busca textual). Se houver OTP vinculado, retorna o código atual.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID exato da entrada.' },
        query: { type: 'string', description: 'Texto para localizar a entrada.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_otp',
    description:
      'Gera o código OTP/TOTP atual de uma entrada (token de dois fatores). ' +
      'Identifique por "id" ou "query". Funciona em entradas MFA ou logins com MFA vinculado.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID exato da entrada.' },
        query: { type: 'string', description: 'Texto para localizar a entrada.' }
      },
      additionalProperties: false
    }
  }
];

// ===== Execução das ferramentas =====

function callTool(name, args = {}) {
  switch (name) {
    case 'vault_status': {
      const s = vault.checkSession();
      return {
        accessible: !!(s.valid && s.unlocked),
        valid: s.valid,
        unlocked: !!s.unlocked,
        reason: s.reason || null,
        message: s.valid && s.unlocked
          ? 'Cofre desbloqueado e acessível.'
          : vault.reasonMessage(s.reason || 'LOCKED'),
        dataDir: vault.USER_DATA_PATH
      };
    }

    case 'list_secrets': {
      const entries = vault.loadEntries();
      const limit = args.limit || 100;
      let list = entries;
      if (args.type) list = list.filter((e) => e.type === args.type);
      return { count: list.length, entries: list.slice(0, limit).map(publicView) };
    }

    case 'search_secrets': {
      const entries = vault.loadEntries();
      const results = findEntries(entries, { query: args.query, type: args.type });
      return { count: results.length, results: results.slice(0, 25).map(publicView) };
    }

    case 'get_credentials': {
      if (!args.id && !args.query) throw new Error('Informe "id" ou "query".');
      const entries = vault.loadEntries();
      const matches = findEntries(entries, { id: args.id, query: args.query });
      if (matches.length === 0) throw new Error('Nenhuma entrada encontrada.');
      const entry = matches[0];
      const result = {
        id: entry.id,
        title: entry.title,
        username: entry.username || null,
        password: entry.password || null,
        url: entry.url || null,
        notes: entry.notes || null
      };
      const otp = resolveOtp(entry, entries);
      if (otp) result.otp = otp;
      if (matches.length > 1) {
        result.note = `Havia ${matches.length} correspondências; retornada a mais relevante ("${entry.title}").`;
        result.otherMatches = matches.slice(1, 6).map((e) => ({ id: e.id, title: e.title, username: e.username }));
      }
      return result;
    }

    case 'get_otp': {
      if (!args.id && !args.query) throw new Error('Informe "id" ou "query".');
      const entries = vault.loadEntries();
      const matches = findEntries(entries, { id: args.id, query: args.query })
        .sort((a, b) => (!!(b.mfaSecret || b.linkedMfaId)) - (!!(a.mfaSecret || a.linkedMfaId)));
      if (matches.length === 0) throw new Error('Nenhuma entrada encontrada.');
      const entry = matches[0];
      const otp = resolveOtp(entry, entries);
      if (!otp) throw new Error(`A entrada "${entry.title}" não possui OTP configurado.`);
      return {
        id: entry.id,
        title: entry.title,
        username: entry.username || null,
        code: otp.code,
        secondsRemaining: otp.remaining,
        period: otp.period,
        algorithm: otp.algorithm,
        digits: otp.digits
      };
    }

    default:
      throw new Error(`Ferramenta desconhecida: ${name}`);
  }
}

// ===== Dispatcher JSON-RPC (independente de transporte) =====
//
// Retorna o objeto de resposta JSON-RPC, ou null para notificações
// (mensagens sem id, que não devem receber resposta).

function dispatch(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  const ok = (result) => (isNotification ? null : { jsonrpc: '2.0', id, result });
  const err = (code, message) => (isNotification ? null : { jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize':
      return ok({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });

    case 'notifications/initialized':
    case 'initialized':
      return null;

    case 'ping':
      return ok({});

    case 'tools/list':
      return ok({ tools: TOOLS });

    case 'tools/call': {
      const toolName = params && params.name;
      const toolArgs = (params && params.arguments) || {};
      try {
        const data = callTool(toolName, toolArgs);
        return ok({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } catch (e) {
        const locked = e instanceof vault.VaultLockedError;
        return ok({
          isError: true,
          content: [{
            type: 'text',
            text: JSON.stringify({ error: e.message, locked: locked || undefined, reason: e.reason || undefined })
          }]
        });
      }
    }

    default:
      return err(-32601, `Método não suportado: ${method}`);
  }
}

module.exports = { TOOLS, callTool, dispatch, SERVER_INFO, PROTOCOL_VERSION };
