// MySecrets Chrome Extension — Background Service Worker
//
// Conversa com o app desktop pelo servidor local que o próprio app sobe
// (127.0.0.1, token bearer). O token chega aqui por pareamento automático: a
// extensão pede em POST /pair e o app aprova (pergunta ao usuário só na primeira
// vez). Colar o código do app (MCP > Extensão) continua como alternativa.
//
// Consequência: sem app aberto e cofre desbloqueado a extensão não tem dados.
// Nada de senha mestra nem cópia do cofre no navegador.

import { parsePairingCode, validConn, pairUrl, saveDecision, displayHost } from './lib.mjs';

const CONN_KEY = 'mysecrets_conn'; // { url, token }
const UNPAIRED_KEY = 'mysecrets_unpaired'; // usuário desconectou: não reconectar sozinho
const DEFAULT_URL = 'http://127.0.0.1:8765/mcp';
let rpcId = 0;

// ===== Pareamento =====

async function getConn() {
  const stored = await chrome.storage.local.get(CONN_KEY);
  return stored[CONN_KEY] || null;
}

async function savePairing(conn) {
  await chrome.storage.local.set({ [CONN_KEY]: conn });
  await chrome.storage.local.remove(UNPAIRED_KEY);
  return status();
}

async function pair(code) {
  return savePairing(parsePairingCode(code));
}

// Pede o token ao app. Pode demorar: na primeira vez o app espera o usuário
// responder se permite a conexão.
async function autoPair() {
  const conn = await getConn();
  let res;
  try {
    res = await fetch(pairUrl(conn ? conn.url : DEFAULT_URL), { method: 'POST' });
  } catch (_) {
    throw new Error('App MySecrets fechado ou servidor local parado');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Servidor respondeu ${res.status}`);
  return savePairing(validConn(body));
}

// Sem pareamento ou com token trocado: tenta parear sozinho, a menos que o
// usuário tenha desconectado de propósito. Devolve o erro, se houver.
async function ensurePaired() {
  if ((await chrome.storage.local.get(UNPAIRED_KEY))[UNPAIRED_KEY]) return null;
  const st = await status();
  if (st.paired && !st.badToken) return null;
  try {
    await autoPair();
    return null;
  } catch (err) {
    return err.message;
  }
}

async function unpair() {
  await chrome.storage.local.remove(CONN_KEY);
  await chrome.storage.local.set({ [UNPAIRED_KEY]: true });
}

// ===== Chamada ao cofre =====

async function postJsonRpc(method, params) {
  const conn = await getConn();
  if (!conn) throw new Error('Extensão não pareada com o app');

  let res;
  try {
    res = await fetch(conn.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })
    });
  } catch (_) {
    throw new Error('App MySecrets fechado ou servidor local parado');
  }

  if (res.status === 401) {
    const err = new Error('Token inválido — refaça o pareamento');
    err.badToken = true;
    throw err;
  }
  if (!res.ok) throw new Error(`Servidor respondeu ${res.status}`);

  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body;
}

async function rpc(tool, args = {}) {
  const body = await postJsonRpc('tools/call', { name: tool, arguments: args });

  const text = body.result && body.result.content && body.result.content[0]
    ? body.result.content[0].text
    : null;
  const data = text ? JSON.parse(text) : {};

  if (body.result && body.result.isError) {
    const err = new Error(data.error || 'Erro no cofre');
    err.locked = !!data.locked;
    throw err;
  }
  return data;
}

async function status() {
  const conn = await getConn();
  if (!conn) return { paired: false, unlocked: false };
  try {
    const s = await rpc('vault_status');
    return { paired: true, unlocked: !!s.accessible, message: s.message };
  } catch (err) {
    return { paired: true, unlocked: false, error: err.message, badToken: !!err.badToken };
  }
}

// Entradas do MESMO site da URL (host ou domínio registrável), só metadados.
// O app compara pela Public Suffix List: nada de busca textual aqui.
async function entriesForUrl(url, types = ['login']) {
  if (!displayHost(url)) return [];
  const r = await rpc('match_url', { url, types });
  return r.results || [];
}

function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch (_) { return false; }
}

// Senha e OTP são buscados só no momento de preencher (OTP precisa estar fresco).
// expectedUrl: a página que o usuário via ao pedir o preenchimento. Se a aba
// navegou para outro lugar, ou a entrada não é deste site, nada é enviado.
async function fillTab(tabId, id, expectedUrl) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab || !tab.url || (expectedUrl && !sameOrigin(tab.url, expectedUrl))) {
    throw new Error('A página mudou. Abra o MySecrets de novo nesta página.');
  }
  const doSite = await entriesForUrl(tab.url);
  if (!doSite.some((e) => e.id === id)) {
    throw new Error('Esta entrada não é deste site.');
  }

  const c = await rpc('get_credentials', { id });

  // Se o login não tem MFA vinculado, ainda procura uma entrada MFA do site:
  // muita gente guarda o login e o 2FA como entradas separadas.
  let otp = c.otp || null;
  if (!otp) {
    const mfa = await entriesForUrl(tab.url, ['mfa']).catch(() => []);
    if (mfa.length) {
      try { otp = await rpc('get_otp', { id: mfa[0].id }); } catch (_) { /* sem OTP */ }
    }
  }

  // Confere de novo: as chamadas acima são assíncronas e a aba pode ter navegado
  const now = await chrome.tabs.get(tabId);
  if (!now || !sameOrigin(now.url, tab.url)) {
    throw new Error('A página mudou. Abra o MySecrets de novo nesta página.');
  }

  await chrome.tabs.sendMessage(tabId, {
    type: 'fill_fields',
    entry: {
      id: c.id,
      title: c.title,
      username: c.username,
      password: c.password,
      url: c.url,
      mfaCode: (otp && otp.code) || null
    }
  }, { frameId: 0 });
}

async function fillFirstMatch(tab) {
  if (!tab || !tab.url) return;
  const matches = await entriesForUrl(tab.url);
  if (matches.length) await fillTab(tab.id, matches[0].id, tab.url);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// ===== Oferecer para salvar logins =====
//
// O content script avisa quando um formulário com senha é enviado. Se o login
// não está no cofre (ou a senha mudou), guarda um "pendente" por aba em
// chrome.storage.session (só memória, inacessível às páginas) e a página
// mostra a pergunta — inclusive depois do redirecionamento do login.

const PENDING_KEY = 'mysecrets_pending_save';  // session: { [tabId]: pendente }
const USER_HINT_KEY = 'mysecrets_user_hint';   // session: { [host]: { username, at } }
const NEVER_KEY = 'mysecrets_never_save';      // local: [hosts]
const PENDING_TTL = 3 * 60 * 1000;

async function sessionGet(key) {
  return (await chrome.storage.session.get(key))[key] || {};
}

async function getPending(tabId) {
  const all = await sessionGet(PENDING_KEY);
  const p = all[tabId];
  return p && Date.now() - p.at < PENDING_TTL ? p : null;
}

async function setPending(tabId, pending) {
  const all = await sessionGet(PENDING_KEY);
  if (pending) all[tabId] = pending; else delete all[tabId];
  await chrome.storage.session.set({ [PENDING_KEY]: all });
}

// O que a página pode ver: nunca a senha
function promptView(p) {
  return { mode: p.mode, host: p.host, username: p.username || '', title: p.title || '' };
}

async function neverList() {
  return (await chrome.storage.local.get(NEVER_KEY))[NEVER_KEY] || [];
}

// Login em duas etapas: o usuário é digitado numa tela e a senha na seguinte
async function rememberUsername(url, username) {
  const host = displayHost(url);
  if (!host || !username) return;
  const hints = await sessionGet(USER_HINT_KEY);
  hints[host] = { username: String(username).slice(0, 512), at: Date.now() };
  await chrome.storage.session.set({ [USER_HINT_KEY]: hints });
}

async function usernameHint(host) {
  const h = (await sessionGet(USER_HINT_KEY))[host];
  return h && Date.now() - h.at < PENDING_TTL ? h.username : '';
}

async function loginSubmitted(msg, sender) {
  const tab = sender.tab;
  const host = displayHost(msg.url);
  const password = typeof msg.password === 'string' ? msg.password : '';
  if (!tab || !host || !password || password.length > 4096) return {};
  if ((await neverList()).includes(host)) return {};

  const st = await status();
  if (!st.unlocked) return {}; // sem cofre aberto não há como salvar

  const username = String(msg.username || '').trim().slice(0, 512) || await usernameHint(host);
  const decision = saveDecision(await entriesForUrl(msg.url), username);

  let pending;
  if (decision.mode === 'check') {
    const saved = await rpc('get_credentials', { id: decision.id });
    if (saved.password === password) return {}; // já está salvo
    pending = { mode: 'update', id: decision.id, title: saved.title, username: username || saved.username || '' };
  } else {
    pending = { mode: 'new', username };
  }
  pending = { ...pending, url: msg.url, host, password, at: Date.now() };
  await setPending(tab.id, pending);

  // Página de uma tela só (SPA) segue aberta: pergunta já. Se ela navegar, a
  // próxima página pede o pendente ao carregar.
  chrome.tabs.sendMessage(tab.id, { type: 'show_save_prompt', prompt: promptView(pending) }).catch(() => {});
  return {};
}

async function saveDecided(msg, sender) {
  const tab = sender.tab;
  if (!tab) return {};
  const pending = await getPending(tab.id);
  await setPending(tab.id, null);
  if (!pending) return {};

  if (msg.action === 'never') {
    const list = await neverList();
    if (!list.includes(pending.host)) {
      await chrome.storage.local.set({ [NEVER_KEY]: [...list, pending.host] });
    }
    return {};
  }
  if (msg.action !== 'save') return {};

  const body = await postJsonRpc('mysecrets/save_login', {
    id: pending.mode === 'update' ? pending.id : undefined,
    url: pending.url,
    username: pending.username,
    password: pending.password
  });
  return { saved: true, mode: (body.result && body.result.mode) || pending.mode };
}

// ===== Mensagens do popup / content script =====

const handlers = {
  check_status: async () => {
    const pairError = await ensurePaired();
    return { ...(await status()), pairError };
  },
  connect: async () => {
    await chrome.storage.local.remove(UNPAIRED_KEY);
    try {
      return await autoPair();
    } catch (err) {
      return { ...(await status()), pairError: err.message };
    }
  },
  pair: (msg) => pair(msg.code),
  unpair: () => unpair().then(() => ({ success: true })),
  find_entries_for_url: async (msg) => ({ entries: await entriesForUrl(msg.url) }),
  login_submitted: (msg, sender) => loginSubmitted(msg, sender),
  remember_username: (msg) => rememberUsername(msg.url, msg.username).then(() => ({})),
  get_pending_save: async (msg, sender) => {
    const p = sender.tab ? await getPending(sender.tab.id) : null;
    return { prompt: p ? promptView(p) : null };
  },
  save_decision: (msg, sender) => saveDecided(msg, sender),
  get_never_save: async () => ({ hosts: await neverList() }),
  remove_never_save: async (msg) => {
    await chrome.storage.local.set({ [NEVER_KEY]: (await neverList()).filter((h) => h !== msg.host) });
    return {};
  },
  autofill: async (msg, sender) => {
    const tab = msg.tabId ? { id: msg.tabId, url: msg.url } : (sender.tab || await activeTab());
    await fillTab(tab.id, msg.id, msg.url || tab.url || '');
    return { success: true };
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message && message.type];
  if (!handler) {
    sendResponse({ success: false, error: 'Tipo de mensagem desconhecido' });
    return false;
  }
  handler(message, sender)
    .then((result) => sendResponse({ success: true, ...result }))
    .catch((err) => sendResponse({ success: false, error: err.message, locked: !!err.locked }));
  return true; // resposta assíncrona
});

// ===== Menu de contexto e atalho =====

chrome.runtime.onInstalled.addListener(() => {
  // Recém-instalada: já pede a conexão ao app (se estiver aberto)
  ensurePaired().catch(() => {});
  chrome.contextMenus.create({
    id: 'mysecrets-autofill',
    title: 'Preencher com MySecrets',
    contexts: ['editable']
  }, () => chrome.runtime.lastError /* já existe */);
});

// Aba fechada: descarta o login pendente dela
chrome.tabs.onRemoved.addListener((tabId) => { setPending(tabId, null).catch(() => {}); });

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'mysecrets-autofill') {
    fillFirstMatch(tab).catch((err) => console.warn('Autofill:', err.message));
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === 'autofill') await fillFirstMatch(await activeTab());
    if (command === 'lock') await unpair();
  } catch (err) {
    console.warn('Comando', command, '→', err.message);
  }
});
