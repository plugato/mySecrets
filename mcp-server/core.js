/**
 * MySecrets MCP — núcleo compartilhado
 *
 * Contém a definição das ferramentas e o dispatcher JSON-RPC, sem depender
 * de nenhum transporte específico. É reutilizado por:
 *   - index.js        (transporte stdio, spawnado pelo cliente MCP)
 *   - http-server.js  (transporte HTTP, controlado pelo app desktop)
 */

const vault = require('./vault');
const files = require('./files');
const audit = require('./audit');
const { getDomain } = require('tldts');

const SERVER_INFO = { name: 'mysecrets', version: '1.1.0' };

// Ferramentas que GRAVAM no cofre. Só rodam com o app aberto e desbloqueado e
// cada chamada pede confirmação ao usuário na janela do app.
const WRITE_TOOLS = new Set(['store_secret', 'store_secret_file']);

// O que a extensão do navegador (cliente com Origin) pode chamar: só o
// necessário para preencher. Se ela for comprometida, não lista nem busca o
// cofre inteiro e não mexe em anexos.
const BROWSER_TOOLS = new Set(['vault_status', 'match_url', 'get_credentials', 'get_otp']);
const PROTOCOL_VERSION = '2024-11-05';

// ===== Utilidades de busca =====

function scoreMatch(entry, query) {
  const q = query.toLowerCase();
  const fields = [
    entry.title, entry.url, entry.username, ...(entry.tags || []),
    ...((entry.attachments || []).map((a) => a && a.name))
  ]
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

// ===== Casamento por URL (preenchimento automático) =====
//
// Diferente da busca textual: só devolve entradas cuja URL é do MESMO site da
// página. "hub.com" não recebe o login de "github.com", e em hospedagens
// compartilhadas (github.io, vercel.app...) cada inquilino é um site separado,
// porque o domínio registrável vem da Public Suffix List (tldts, com os
// sufixos privados).

function parseSiteUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let s = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!host) return null;
  return {
    protocol: u.protocol,
    host,
    // Sem domínio registrável (IP, localhost, intranet): compara host e porta
    site: getDomain(host, { allowPrivateDomains: true }) || null,
    hostPort: u.port ? `${host}:${u.port}` : host
  };
}

/** 100 = mesmo host; 50 = mesmo domínio registrável; 0 = outro site. */
function urlMatchScore(entryUrl, page) {
  const e = parseSiteUrl(entryUrl);
  if (!e || !page) return 0;
  // Login salvo em https não vai para uma página http (rebaixamento)
  if (e.protocol === 'https:' && page.protocol === 'http:') return 0;
  if (!e.site || !page.site) return e.hostPort === page.hostPort ? 100 : 0;
  if (e.host === page.host) return 100;
  return e.site === page.site ? 50 : 0;
}

function matchUrl(entries, pageUrl, { types } = {}) {
  const page = parseSiteUrl(pageUrl);
  if (!page) return [];
  return entries
    .filter((e) => !types || types.includes(e.type))
    .map((e) => ({ e, score: urlMatchScore(e.url, page) }))
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
    notes: e.type === 'note' ? e.notes : undefined,
    customFields: (e.customFields || []).map((c) => c.name),
    attachments: (e.attachments || []).map(files.attachmentMeta)
  };
}

// ===== Pedido de gravação (agente -> app) =====
//
// Valida os argumentos da ferramenta e monta o pedido que o app aplica depois
// da confirmação do usuário (ver src/renderer/agent-write.js). Arquivos são
// lidos aqui, do caminho local, e seguem com tamanho e sha256.

const TEXT_LIMITS = { username: 512, password: 4096, url: 2048, token: 16384, tokenType: 32, notes: 20000 };

function str(value, label, max, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`Informe "${label}".`);
    return undefined;
  }
  if (typeof value !== 'string') throw new Error(`"${label}" precisa ser texto.`);
  if (required && !value.trim()) throw new Error(`Informe "${label}".`);
  if (value.length > max) throw new Error(`"${label}" passa do limite de ${max} caracteres.`);
  return value;
}

function buildTarget(args) {
  const id = str(args.id, 'id', 128);
  const title = str(args.title, 'title', 200, { required: !id });
  return { id: id || undefined, title: title ? title.trim() : undefined };
}

function buildCommon(args) {
  const project = str(args.project, 'project', 60);
  let tags = [];
  if (args.tags !== undefined) {
    if (!Array.isArray(args.tags) || args.tags.length > 20) throw new Error('"tags" precisa ser uma lista (até 20).');
    tags = args.tags.map((t) => str(t, 'tags[]', 60)).filter((t) => t && t.trim());
  }
  return { project: project && project.trim() ? project.trim() : undefined, tags };
}

function buildFile(spec, label) {
  if (!spec || typeof spec !== 'object') throw new Error(`"${label}" inválido.`);
  const filePath = str(spec.path, `${label}.path`, 4096, { required: true });
  return files.readFileAsAttachment(filePath, {
    name: str(spec.name, `${label}.name`, files.MAX_NAME_LENGTH),
    mime: str(spec.mime, `${label}.mime`, 100),
    note: str(spec.note, `${label}.note`, files.MAX_NOTE_LENGTH)
  });
}

function buildWriteRequest(name, args = {}) {
  const req = { target: buildTarget(args), ...buildCommon(args) };

  if (name === 'store_secret') {
    if (args.type !== undefined && !['login', 'token', 'note'].includes(args.type)) {
      throw new Error('"type" precisa ser login, token ou note.');
    }
    req.type = args.type;
    const fields = {};
    for (const [k, max] of Object.entries(TEXT_LIMITS)) {
      const v = str(args[k], k, max);
      if (v !== undefined) fields[k] = v;
    }
    req.fields = fields;
    if (args.customFields !== undefined) {
      if (!Array.isArray(args.customFields) || args.customFields.length > 50) {
        throw new Error('"customFields" precisa ser uma lista (até 50).');
      }
      req.customFields = args.customFields.map((cf, i) => {
        if (!cf || typeof cf !== 'object') throw new Error(`customFields[${i}] inválido.`);
        return {
          name: str(cf.name, `customFields[${i}].name`, 100, { required: true }).trim(),
          value: str(cf.value, `customFields[${i}].value`, 16384, { required: true }),
          type: cf.type === 'password' ? 'password' : 'text'
        };
      });
    }
    const lista = args.files === undefined ? [] : args.files;
    if (!Array.isArray(lista)) throw new Error('"files" precisa ser uma lista.');
    req.files = lista.map((f, i) => buildFile(f, `files[${i}]`));
  } else {
    // store_secret_file: um arquivo, com nota opcional
    req.files = [buildFile({ path: args.path, name: args.name, mime: args.mime, note: args.note }, 'arquivo')];
  }

  if (req.files.length > files.MAX_ATTACHMENTS_PER_ENTRY) {
    throw new Error(`No máximo ${files.MAX_ATTACHMENTS_PER_ENTRY} arquivos por gravação.`);
  }
  const nomes = req.files.map((f) => f.name);
  if (new Set(nomes).size !== nomes.length) throw new Error('Dois arquivos com o mesmo nome na mesma gravação.');

  const temAlgo = Object.keys(req.fields || {}).length || (req.customFields || []).length || req.files.length ||
    req.project || req.tags.length;
  if (!temAlgo) throw new Error('Nada para gravar: informe campos, customFields ou files.');
  return req;
}

// Resumo do pedido para respostas e logs: nunca inclui valores nem conteúdo.
function describeRequest(req) {
  return {
    target: req.target,
    project: req.project || null,
    fields: Object.keys(req.fields || {}),
    customFields: (req.customFields || []).map((c) => c.name),
    files: req.files.map((f) => ({ name: f.name, size: f.size, sha256: f.sha256 }))
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
        type: { type: 'string', enum: ['login', 'mfa', 'token', 'note'], description: 'Filtra por tipo.' },
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
        query: { type: 'string', description: 'Texto de busca (ex.: "github", "gitlab.empresa", "tcg-scanner").' },
        type: { type: 'string', enum: ['login', 'mfa', 'token', 'note'] }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'match_url',
    description:
      'Entradas do MESMO site de uma URL (usado pelo preenchimento automático). Diferente ' +
      'de search_secrets, não faz busca textual: compara host e domínio registrável. ' +
      'Retorna metadados SEM senhas.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL da página (http ou https).' },
        types: {
          type: 'array',
          items: { type: 'string', enum: ['login', 'mfa', 'token', 'note'] },
          description: 'Tipos aceitos (padrão: todos).'
        }
      },
      required: ['url'],
      additionalProperties: false
    }
  },
  {
    name: 'get_credentials',
    description:
      'Retorna usuário, senha, token, notas e campos personalizados de uma entrada. ' +
      'Identifique por "id" (preferível) ou por "query" (busca textual). Se houver OTP ' +
      'vinculado, retorna o código atual. Anexos aparecem só como metadados: use get_secret_file.',
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
  },
  {
    name: 'get_secret_file',
    description:
      'Salva um arquivo anexado a uma entrada (keystore, .pem, .json, .env...) num caminho ' +
      'local. O conteúdo não volta na resposta, só metadados (tamanho, sha256). O arquivo ' +
      'é gravado com permissão 600 e não sobrescreve um existente sem overwrite: true. Ao ' +
      'sobrescrever, o arquivo anterior é guardado em "<arquivo>.bak-<data>" (backupPath na ' +
      'resposta). Links simbólicos são recusados.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID exato da entrada.' },
        query: { type: 'string', description: 'Texto para localizar a entrada (título, tag, nome do anexo).' },
        name: { type: 'string', description: 'Nome do anexo. Opcional se a entrada tiver um só.' },
        attachmentId: { type: 'string', description: 'ID do anexo (alternativa a "name").' },
        outPath: { type: 'string', description: 'Caminho ABSOLUTO onde gravar o arquivo.' },
        overwrite: { type: 'boolean', description: 'Substitui o arquivo de destino se já existir (padrão false). O anterior vira um .bak.' }
      },
      required: ['outPath'],
      additionalProperties: false
    }
  },
  {
    name: 'store_secret',
    description:
      'Cria ou atualiza uma entrada no cofre com campos de texto e, opcionalmente, arquivos. ' +
      'Com "id" atualiza essa entrada; sem id, atualiza a entrada ativa com o mesmo título ' +
      '(preferindo a do mesmo projeto) ou cria uma nova. Só os campos informados mudam; ' +
      'customFields e anexos com o mesmo nome são substituídos. O usuário precisa CONFIRMAR ' +
      'no app (a chamada espera até 4 minutos; se vencer, nada é gravado e o erro traz ' +
      'expired: true). Requer o app aberto, ' +
      'desbloqueado e com o servidor local ligado.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID da entrada a atualizar.' },
        title: { type: 'string', description: 'Título da entrada (obrigatório sem id).' },
        type: { type: 'string', enum: ['login', 'token', 'note'], description: 'Tipo ao criar (padrão: deduzido dos campos).' },
        project: { type: 'string', description: 'Projeto/grupo; vira uma tag (ex.: "tcg-scanner").' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags extras.' },
        username: { type: 'string' },
        password: { type: 'string' },
        url: { type: 'string' },
        token: { type: 'string' },
        tokenType: { type: 'string', description: 'api, jwt, bearer, oauth, access, secret...' },
        notes: { type: 'string' },
        customFields: {
          type: 'array',
          description: 'Campos extras, ex.: [{"name":"storePassword","value":"...","type":"password"}].',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              value: { type: 'string' },
              type: { type: 'string', enum: ['text', 'password'] }
            },
            required: ['name', 'value']
          }
        },
        files: {
          type: 'array',
          description: 'Arquivos a anexar, lidos de caminhos locais absolutos.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Caminho absoluto do arquivo.' },
              name: { type: 'string', description: 'Nome no cofre (padrão: nome do arquivo).' },
              note: { type: 'string' },
              mime: { type: 'string' }
            },
            required: ['path']
          }
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'store_secret_file',
    description:
      'Anexa UM arquivo local (até 1 MB, binário ou texto) a uma entrada do cofre. Com "id" ' +
      'usa essa entrada; sem id, usa a entrada com o mesmo título (ou cria uma nota segura). ' +
      'Um anexo com o mesmo nome é substituído. O usuário precisa CONFIRMAR no app.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho ABSOLUTO do arquivo a guardar.' },
        id: { type: 'string', description: 'ID da entrada.' },
        title: { type: 'string', description: 'Título da entrada (obrigatório sem id).' },
        project: { type: 'string', description: 'Projeto/grupo; vira uma tag.' },
        tags: { type: 'array', items: { type: 'string' } },
        name: { type: 'string', description: 'Nome no cofre (padrão: nome do arquivo).' },
        note: { type: 'string', description: 'Nota sobre o arquivo.' },
        mime: { type: 'string' }
      },
      required: ['path'],
      additionalProperties: false
    }
  }
];

// ===== Execução das ferramentas =====

function callTool(name, args = {}, ctx = {}) {
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

    case 'match_url': {
      if (typeof args.url !== 'string' || args.url.length > 4096) throw new Error('Informe "url".');
      const types = Array.isArray(args.types) ? args.types.filter((t) => typeof t === 'string') : undefined;
      const results = matchUrl(vault.loadEntries(), args.url, { types });
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
        notes: entry.notes || null,
        tags: entry.tags || []
      };
      if (entry.token) {
        result.token = entry.token;
        result.tokenType = entry.tokenType || null;
      }
      if ((entry.customFields || []).length) {
        result.customFields = entry.customFields.map((c) => ({ name: c.name, value: c.value, type: c.type || 'text' }));
      }
      if ((entry.attachments || []).length) result.attachments = entry.attachments.map(files.attachmentMeta);
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

    case 'get_secret_file': {
      // Grava no disco: clientes de navegador (a extensão, que manda Origin)
      // não precisam disso e não podem usar.
      if (ctx.allowWrite === false) throw new Error('get_secret_file não é permitido para este cliente.');
      if (!args.id && !args.query) throw new Error('Informe "id" ou "query".');
      const entries = vault.loadEntries();
      const matches = findEntries(entries, { id: args.id, query: args.query })
        .filter((e) => (e.attachments || []).length > 0);
      if (matches.length === 0) throw new Error('Nenhuma entrada com anexos encontrada.');
      const entry = matches[0];
      const anexos = entry.attachments;
      let att;
      if (args.attachmentId) att = anexos.find((a) => a.id === args.attachmentId);
      else if (args.name) att = anexos.find((a) => a.name === args.name);
      else if (anexos.length === 1) att = anexos[0];
      else {
        throw new Error(`A entrada "${entry.title}" tem ${anexos.length} anexos; informe "name": ` +
          anexos.map((a) => a.name).join(', '));
      }
      if (!att) throw new Error(`Anexo não encontrado em "${entry.title}".`);
      const saved = files.writeAttachmentToPath(att, args.outPath, { overwrite: args.overwrite === true, backup: true });
      return {
        saved: true,
        entry: { id: entry.id, title: entry.title },
        attachment: files.attachmentMeta(att),
        path: saved.path,
        backupPath: saved.backupPath
      };
    }

    default:
      throw new Error(`Ferramenta desconhecida: ${name}`);
  }
}

/**
 * Ferramentas de gravação. Quem grava é o app: ctx.submitWrite(pedido) leva o
 * pedido até ele (transporte HTTP, por IPC); ctx.forward(nome, args) repassa a
 * chamada inteira ao servidor HTTP do app (transporte stdio). Sem nenhum dos
 * dois, a gravação é recusada.
 */
async function callWriteTool(name, args, ctx) {
  if (ctx.forward) return ctx.forward(name, args);
  if (!ctx.submitWrite) throw new Error('Gravação indisponível neste transporte.');
  if (ctx.allowWrite === false) throw new Error('Gravação não é permitida para este cliente.');

  const s = vault.checkSession();
  if (!s.valid) throw new vault.VaultLockedError(s.reason);
  if (!s.unlocked) throw new vault.VaultLockedError('LOCKED');

  const req = buildWriteRequest(name, args);
  const result = await ctx.submitWrite(req);
  if (!result || !result.success) {
    const e = new Error((result && result.error) || 'O app não gravou.');
    ['declined', 'expired', 'cancelled'].forEach((k) => { if (result && result[k]) e[k] = true; });
    throw e;
  }
  return {
    saved: true,
    mode: result.mode,
    id: result.id,
    title: result.title,
    ...describeRequest(req)
  };
}

// ===== Dispatcher JSON-RPC (independente de transporte) =====
//
// Retorna o objeto de resposta JSON-RPC, ou null para notificações
// (mensagens sem id, que não devem receber resposta).

async function dispatch(msg, ctx = {}) {
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
      return ok({ tools: ctx.allowWrite === false ? TOOLS.filter((t) => BROWSER_TOOLS.has(t.name)) : TOOLS });

    case 'tools/call': {
      const toolName = params && params.name;
      const toolArgs = (params && params.arguments) || {};
      try {
        if (ctx.allowWrite === false && !WRITE_TOOLS.has(toolName) && !BROWSER_TOOLS.has(toolName)) {
          throw new Error(`${toolName} não é permitido para a extensão do navegador. Atualize a extensão MySecrets.`);
        }
        const data = WRITE_TOOLS.has(toolName)
          ? await callWriteTool(toolName, toolArgs, ctx)
          : callTool(toolName, toolArgs, ctx);
        // Registro das leituras (ids, sem conteúdo); nunca impede a resposta
        try { audit.record(vault.USER_DATA_PATH, { tool: toolName, client: ctx.client, data }); } catch (_) { /* sem disco */ }
        return ok({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } catch (e) {
        const locked = e instanceof vault.VaultLockedError;
        return ok({
          isError: true,
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: e.message,
              locked: locked || undefined,
              reason: e.reason || undefined,
              declined: e.declined || undefined,
              expired: e.expired || undefined,
              cancelled: e.cancelled || undefined
            })
          }]
        });
      }
    }

    default:
      return err(-32601, `Método não suportado: ${method}`);
  }
}

module.exports = {
  TOOLS,
  WRITE_TOOLS,
  BROWSER_TOOLS,
  matchUrl,
  urlMatchScore,
  parseSiteUrl,
  callTool,
  callWriteTool,
  buildWriteRequest,
  describeRequest,
  dispatch,
  SERVER_INFO,
  PROTOCOL_VERSION
};
