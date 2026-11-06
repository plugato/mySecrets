// Passkeys na extensão, no Firefox de verdade (WebDriver BiDi): o script no
// mundo da página (world: MAIN), o content script e o background funcionam
// juntos. O BiDi não alcança o shadow DOM fechado do cartão para clicar, então
// aqui vai o caminho sem clique: rpId de outro site volta SecurityError para a
// página, depois de passar pelo app com a origem da aba. O fluxo com clique
// (criar e entrar) é testado no Chromium (chrome-passkey.e2e.js).
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { listen, copyExtension, passkeyApp, firefoxPath, Bidi } = require('./extension-helpers');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('passkeys pela extensão no Firefox: a página recebe SecurityError para rpId de outro site', { skip: !firefoxPath() && 'Firefox não encontrado' }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-pk-ff-'));
  const log = [];
  const app = passkeyApp(log);
  const appPort = await listen(app);
  const site = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Site</title><h1>Site</h1>'); });
  const sitePort = await listen(site);
  const ORIGIN = `http://localhost:${sitePort}`;
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
    await bidi.send('webExtension.install', { extensionData: { type: 'path', path: ext } });
    await sleep(1500); // pareamento automático

    const { contexts } = await bidi.send('browsingContext.getTree', {});
    const ctx = contexts[0].context;
    await bidi.send('browsingContext.navigate', { context: ctx, url: `${ORIGIN}/`, wait: 'complete' });
    const avaliar = async (expr) => (await bidi.send('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true })).result.value;

    const r = await avaliar(`navigator.credentials.create({ publicKey: {
        rp: { id: 'github.com', name: 'x' }, user: { id: new Uint8Array([1, 2, 3]), name: 'eu', displayName: 'Eu' },
        challenge: new Uint8Array(32), pubKeyCredParams: [{ type: 'public-key', alg: -7 }] } })
      .then(() => 'criou', (e) => e.name)`);
    assert.strictEqual(r, 'SecurityError');
    assert.ok(log.some((l) => l.method === 'mysecrets/passkey_list' && l.origin === ORIGIN), 'passou pelo app com a origem da aba');
  } finally {
    if (bidi) { try { await bidi.send('session.end'); } catch (_) { /* fechando */ } bidi.ws.close(); }
    ff.kill();
    await new Promise((r) => { ff.once('exit', r); setTimeout(r, 3000); });
    app.close(); site.close();
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
