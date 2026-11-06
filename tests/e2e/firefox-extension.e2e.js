// A extensão no Firefox de verdade (headless, WebDriver BiDi): instala uma
// cópia apontada para um app falso, abre uma página de login e confere que o
// botão aparece e que o clique preenche usuário e senha. Pulado se não houver
// Firefox. Nunca fala com o app real (porta 8765).
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listen, fakeApp, copyExtension, loginSite, TOKEN, USER, PASSWORD } = require('./extension-helpers');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function firefoxPath() {
  for (const bin of [process.env.FIREFOX_BIN, 'firefox', 'firefox-esr'].filter(Boolean)) {
    try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return bin; } catch (_) { /* não tem */ }
  }
  return null;
}

class Bidi {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) {
        const { resolve, reject } = this.pending.get(d.id);
        this.pending.delete(d.id);
        if (d.type === 'error') reject(new Error(`${d.error}: ${d.message}`)); else resolve(d.result);
      } else if (d.type === 'event') this.events.push(d);
    };
  }
  open() { return new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; }); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

test('extensão no Firefox: pareia, mostra o botão e preenche o login', { skip: !firefoxPath() && 'Firefox não encontrado' }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-ff-'));
  const log = [];
  const app = fakeApp(log);
  const appPort = await listen(app);
  const site = loginSite();
  const sitePort = await listen(site);

  // Cópia da extensão apontada para o app falso
  const ext = path.join(work, 'ext');
  copyExtension(ext, appPort);

  const bidiPort = 30000 + Math.floor(Math.random() * 20000);
  const profile = path.join(work, 'profile');
  fs.mkdirSync(profile);
  const ff = spawn(firefoxPath(), ['--headless', '--no-remote', '--profile', profile, `--remote-debugging-port=${bidiPort}`, 'about:blank'], { stdio: 'ignore' });
  let bidi;
  try {
    for (let i = 0; i < 60 && !bidi; i++) {
      await sleep(500);
      try { const b = new Bidi(`ws://127.0.0.1:${bidiPort}/session`); await b.open(); bidi = b; } catch (_) { /* subindo */ }
    }
    assert.ok(bidi, 'Firefox não abriu o WebDriver BiDi');
    await bidi.send('session.new', { capabilities: { alwaysMatch: { 'moz:firefoxOptions': {} } } });
    const instalada = await bidi.send('webExtension.install', { extensionData: { type: 'path', path: ext } });
    assert.ok(instalada.extension, 'extensão instalada');

    // Pareamento automático ao instalar
    for (let i = 0; i < 40 && !log.some((l) => l.path === '/pair'); i++) await sleep(250);
    assert.ok(log.some((l) => l.path === '/pair' && /^moz-extension:\/\//.test(l.origin)), 'pareou com Origin moz-extension');

    const { contexts } = await bidi.send('browsingContext.getTree', {});
    const ctx = contexts[0].context;
    await bidi.send('browsingContext.navigate', { context: ctx, url: `http://127.0.0.1:${sitePort}/login`, wait: 'complete' });
    const avaliar = async (expr) => (await bidi.send('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true })).result.value;

    let botao = null;
    for (let i = 0; i < 40 && !botao; i++) {
      botao = await avaliar("document.getElementById('mysecrets-autofill-button')?.textContent?.trim() || null");
      if (!botao) await sleep(250);
    }
    assert.match(botao || '', /1 entrada/, 'botão de preencher aparece');
    assert.ok(log.some((l) => l.path === '/mcp' && l.auth === `Bearer ${TOKEN}`), 'usou o token do pareamento');

    await avaliar("document.getElementById('mysecrets-autofill-button').click()");
    let valores = null;
    for (let i = 0; i < 40; i++) {
      valores = JSON.parse(await avaliar("JSON.stringify({ u: document.getElementById('user').value, p: document.getElementById('pass').value })"));
      if (valores.p) break;
      await sleep(250);
    }
    assert.deepStrictEqual(valores, { u: USER, p: PASSWORD });
  } finally {
    if (bidi) { try { await bidi.send('session.end'); } catch (_) { /* fechando */ } bidi.ws.close(); }
    ff.kill();
    await new Promise((r) => { ff.once('exit', r); setTimeout(r, 3000); });
    app.close(); site.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
