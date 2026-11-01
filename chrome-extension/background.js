// MySecrets Chrome Extension — Background Service Worker
//
// Conversa com o app desktop pelo servidor local que o próprio app sobe
// (127.0.0.1, token bearer). O token chega aqui por pareamento: o usuário copia
// o código no app (MCP > Extensão) e cola no popup.
//
// Consequência: sem app aberto e cofre desbloqueado a extensão não tem dados.
// Nada de senha mestra nem cópia do cofre no navegador.

import { hostCandidates, parsePairingCode } from './lib.mjs';

const CONN_KEY = 'mysecrets_conn'; // { url, token }
let rpcId = 0;

// ===== Pareamento =====

async function getConn() {
  const stored = await chrome.storage.local.get(CONN_KEY);
  return stored[CONN_KEY] || null;
}

async function pair(code) {
  const conn = parsePairingCode(code);
  await chrome.storage.local.set({ [CONN_KEY]: conn });
  return status();
}

async function unpair() {
  await chrome.storage.local.remove(CONN_KEY);
}

// ===== Chamada ao cofre =====

async function rpc(tool, args = {}) {
  const conn = await getConn();
  if (!conn) throw new Error('Extensão não pareada com o app');

  let res;
  try {
    res = await fetch(conn.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'tools/call',
        params: { name: tool, arguments: args }
      })
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

// Logins do domínio atual — só metadados, sem senha.
async function entriesForUrl(url) {
  for (const query of hostCandidates(url)) {
    const r = await rpc('search_secrets', { query, type: 'login' });
    if (r.count) return r.results;
  }
  return [];
}

// Senha e OTP são buscados só no momento de preencher (OTP precisa estar fresco).
async function fillTab(tabId, id, siteQueries = []) {
  const c = await rpc('get_credentials', { id });

  // Se o login não tem MFA vinculado, ainda procura uma entrada MFA do site:
  // muita gente guarda o login e o 2FA como entradas separadas.
  let otp = c.otp || null;
  for (const query of otp ? [] : siteQueries) {
    try {
      otp = await rpc('get_otp', { query });
      break;
    } catch (_) { /* nenhuma entrada 2FA com esse domínio */ }
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
  });
}

async function fillFirstMatch(tab) {
  if (!tab || !tab.url) return;
  const matches = await entriesForUrl(tab.url);
  if (matches.length) await fillTab(tab.id, matches[0].id, hostCandidates(tab.url));
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// ===== Mensagens do popup / content script =====

const handlers = {
  check_status: () => status(),
  pair: (msg) => pair(msg.code),
  unpair: () => unpair().then(() => ({ success: true })),
  find_entries_for_url: async (msg) => ({ entries: await entriesForUrl(msg.url) }),
  autofill: async (msg, sender) => {
    const tab = msg.tabId ? { id: msg.tabId, url: msg.url } : (sender.tab || await activeTab());
    await fillTab(tab.id, msg.id, hostCandidates(msg.url || tab.url || ''));
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
  chrome.contextMenus.create({
    id: 'mysecrets-autofill',
    title: 'Preencher com MySecrets',
    contexts: ['editable']
  }, () => chrome.runtime.lastError /* já existe */);
});

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
