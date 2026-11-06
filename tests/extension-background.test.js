// Service worker da extensão (chrome-extension/background.js) com chrome.* e
// fetch simulados: o preenchimento só envia a senha para a aba certa, do site
// certo, e a busca do site usa match_url (casamento pelo app, não textual).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { matchUrl } = require('../mcp-server/core');

const VAULT = [
  { id: 'gh', type: 'login', title: 'GitHub', url: 'https://github.com', username: 'eu', password: 'senha-gh' },
  { id: 'gh2fa', type: 'mfa', title: 'GitHub 2FA', url: 'https://github.com' },
  { id: 'gl', type: 'login', title: 'GitLab', url: 'https://gitlab.com', username: 'eu', password: 'senha-gl' }
];

function setup() {
  const tabs = new Map([[1, { id: 1, url: 'https://github.com/login' }]]);
  const sent = [];
  const rpcCalls = [];
  const listeners = {};
  const store = {};
  const ev = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  const area = {
    get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : {}),
    set: async (o) => { Object.assign(store, o); },
    remove: async (k) => { delete store[k]; }
  };
  store.mysecrets_conn = { url: 'http://127.0.0.1:8765/mcp', token: 'tk' };

  globalThis.chrome = {
    storage: { local: area, session: area },
    runtime: { onMessage: ev('message'), onInstalled: ev('installed') },
    tabs: {
      get: async (id) => ({ ...tabs.get(id) }),
      query: async () => [tabs.get(1)],
      sendMessage: async (tabId, msg, opts) => { sent.push({ tabId, msg, opts }); },
      onRemoved: ev('removed')
    },
    contextMenus: { create: () => {}, onClicked: ev('menu') },
    commands: { onCommand: ev('command') }
  };

  // Servidor do app simulado: responde as ferramentas usadas pela extensão
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const { name, arguments: args } = body.params;
    rpcCalls.push({ name, args });
    let data;
    if (name === 'vault_status') data = { accessible: true };
    else if (name === 'match_url') {
      const r = matchUrl(VAULT, args.url, { types: args.types });
      data = { count: r.length, results: r.map(({ id, title, type, url }) => ({ id, title, type, url })) };
    } else if (name === 'get_credentials') data = { ...VAULT.find((e) => e.id === args.id) };
    else if (name === 'get_otp') data = { id: args.id, code: '123456' };
    else data = {};
    return {
      ok: true, status: 200,
      json: async () => ({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(data) }] } })
    };
  };

  return { tabs, sent, rpcCalls, listeners };
}

async function loadBackground() {
  const file = pathToFileURL(path.join(__dirname, '..', 'chrome-extension', 'background.js')).href;
  await import(`${file}?t=${Date.now()}${Math.random()}`);
}

function ask(listeners, message, sender = {}) {
  return new Promise((resolve) => listeners.message(message, sender, resolve));
}

test('lista do popup usa match_url e só traz logins do site', async () => {
  const env = setup();
  await loadBackground();
  const res = await ask(env.listeners, { type: 'find_entries_for_url', url: 'https://github.com/login' });
  assert.strictEqual(res.success, true);
  assert.deepStrictEqual(res.entries.map((e) => e.id), ['gh']);
  assert.ok(env.rpcCalls.every((c) => c.name !== 'search_secrets'), 'sem busca textual');

  const parecido = await ask(env.listeners, { type: 'find_entries_for_url', url: 'https://hub.com/login' });
  assert.deepStrictEqual(parecido.entries, []);
});

test('preencher: envia login + 2FA do site para o frame principal da aba', async () => {
  const env = setup();
  await loadBackground();
  const res = await ask(env.listeners, { type: 'autofill', id: 'gh', tabId: 1, url: 'https://github.com/login' });
  assert.strictEqual(res.success, true, res.error);
  assert.strictEqual(env.sent.length, 1);
  assert.strictEqual(env.sent[0].msg.entry.password, 'senha-gh');
  assert.strictEqual(env.sent[0].msg.entry.mfaCode, '123456', '2FA separado do mesmo site');
  assert.deepStrictEqual(env.sent[0].opts, { frameId: 0 });
  assert.ok(env.rpcCalls.some((c) => c.name === 'get_otp' && c.args.id === 'gh2fa'), 'OTP pelo id, não por busca');
});

test('preencher: recusa entrada de outro site', async () => {
  const env = setup();
  await loadBackground();
  const res = await ask(env.listeners, { type: 'autofill', id: 'gl', tabId: 1, url: 'https://github.com/login' });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /não é deste site/);
  assert.strictEqual(env.sent.length, 0);
  assert.ok(!env.rpcCalls.some((c) => c.name === 'get_credentials'), 'nem chega a ler a senha');
});

test('preencher: recusa se a aba navegou para outro site depois do popup abrir', async () => {
  const env = setup();
  await loadBackground();
  env.tabs.set(1, { id: 1, url: 'https://evil.example.com/' });
  const res = await ask(env.listeners, { type: 'autofill', id: 'gh', tabId: 1, url: 'https://github.com/login' });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /página mudou/);
  assert.strictEqual(env.sent.length, 0);
});

test('preencher: recusa se a aba navega durante a busca da senha', async () => {
  const env = setup();
  await loadBackground();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const r = await realFetch(url, init);
    if (JSON.parse(init.body).params.name === 'get_credentials') env.tabs.set(1, { id: 1, url: 'https://evil.example.com/' });
    return r;
  };
  const res = await ask(env.listeners, { type: 'autofill', id: 'gh', tabId: 1, url: 'https://github.com/login' });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /página mudou/);
  assert.strictEqual(env.sent.length, 0);
});

// ===== Passkeys =====

function comPasskeys(env, resposta) {
  const anterior = globalThis.fetch;
  env.passkeyCalls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (!String(body.method).startsWith('mysecrets/passkey')) return anterior(url, init);
    env.passkeyCalls.push(body);
    const r = resposta(body);
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: body.id, ...r }) };
  };
}

test('passkeys: a origem vem da aba (sender), nunca da mensagem; só o frame principal', async () => {
  const env = setup();
  await loadBackground();
  comPasskeys(env, () => ({ result: { rpId: 'github.com', passkeys: [] } }));
  const sender = { tab: { id: 1, url: 'https://github.com/login' }, frameId: 0, url: 'https://github.com/login?next=/x' };
  const r = await ask(env.listeners, { type: 'passkey_list', rpId: 'github.com', origin: 'https://evil.com' }, sender);
  assert.strictEqual(r.success, true, r.error);
  assert.strictEqual(env.passkeyCalls[0].params.origin, 'https://github.com');

  const iframe = await ask(env.listeners, { type: 'passkey_get', rpId: 'github.com', challenge: 'x', credentialId: 'y' }, { ...sender, frameId: 3 });
  assert.strictEqual(iframe.success, false);
  assert.strictEqual(iframe.name, 'NotAllowedError');
  const semAba = await ask(env.listeners, { type: 'passkey_create', rp: { id: 'github.com' } }, { frameId: 0, url: 'https://github.com' });
  assert.strictEqual(semAba.success, false);
  assert.strictEqual(env.passkeyCalls.length, 1, 'nada foi ao app');
});

test('passkeys: o nome do erro do app chega à página; criar repassa só os campos esperados', async () => {
  const env = setup();
  await loadBackground();
  comPasskeys(env, (b) => (b.method === 'mysecrets/passkey_create'
    ? { result: { credential: { id: 'novo' } } }
    : { error: { code: -32000, message: 'rpId é um sufixo público', data: { name: 'SecurityError' } } }));
  const sender = { tab: { id: 1, url: 'https://login.exemplo.com.br/' }, frameId: 0, url: 'https://login.exemplo.com.br/' };
  const erro = await ask(env.listeners, { type: 'passkey_list', rpId: 'com.br' }, sender);
  assert.deepStrictEqual({ success: erro.success, name: erro.name }, { success: false, name: 'SecurityError' });

  const ok = await ask(env.listeners, { type: 'passkey_create', rp: { id: 'exemplo.com.br', name: 'Ex' }, user: { id: 'dQ', name: 'eu' }, challenge: 'Y2g', excludeCredentials: [], extra: 'x' }, sender);
  assert.deepStrictEqual(ok.credential, { id: 'novo' });
  const p = env.passkeyCalls.find((c) => c.method === 'mysecrets/passkey_create').params;
  assert.deepStrictEqual(Object.keys(p).sort(), ['challenge', 'excludeCredentials', 'origin', 'rpId', 'rpName', 'user']);
  assert.strictEqual(p.origin, 'https://login.exemplo.com.br');
});
