// A extensão no Chromium de verdade (headless, CDP): carrega uma cópia
// apontada para um app falso, abre uma página de login e confere pareamento,
// botão e preenchimento. Precisa de um Chromium que aceite --load-extension
// (Chrome for Testing; o Chrome oficial bloqueia desde a versão 137). Informe
// em CHROME_BIN; sem ele, procura o do Playwright e, sem nada, pula.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listen, fakeApp, copyExtension, loginSite, TOKEN, USER, PASSWORD } = require('./extension-helpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromePath() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    for (const d of fs.readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
      const bin = path.join(cache, d, 'chrome-linux64', 'chrome');
      if (fs.existsSync(bin)) return bin;
    }
  } catch (_) { /* sem cache */ }
  return null;
}

test('extensão no Chromium: pareia, mostra o botão e preenche o login', { skip: !chromePath() && 'Chromium com --load-extension não encontrado (CHROME_BIN)' }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-cr-'));
  const log = [];
  const app = fakeApp(log);
  const appPort = await listen(app);
  const site = loginSite();
  const sitePort = await listen(site);
  const ext = path.join(work, 'ext');
  copyExtension(ext, appPort);

  const port = 30000 + Math.floor(Math.random() * 20000);
  const args = ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(work, 'perfil')}`,
    `--load-extension=${ext}`, `--disable-extensions-except=${ext}`, '--no-first-run', '--no-default-browser-check', '--lang=pt-BR', 'about:blank'];
  if (process.env.CI) args.unshift('--no-sandbox');
  const chrome = spawn(chromePath(), args, { stdio: 'ignore' });
  let ws;
  try {
    let alvos = [];
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      try { alvos = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch (_) { continue; }
      if (alvos.some((t) => t.type === 'service_worker' && t.url.endsWith('/background.js'))) break;
    }
    assert.ok(alvos.some((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://')), 'service worker da extensão carregou');

    for (let i = 0; i < 40 && !log.some((l) => l.path === '/pair'); i++) await sleep(250);
    assert.ok(log.some((l) => l.path === '/pair' && /^chrome-extension:\/\//.test(l.origin)), 'pareou com Origin chrome-extension');

    const pagina = await (await fetch(`http://127.0.0.1:${port}/json/new?http://127.0.0.1:${sitePort}/login`, { method: 'PUT' })).json();
    ws = new WebSocket(pagina.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0;
    const avaliar = (expression) => new Promise((resolve) => {
      const my = ++id;
      const h = (m) => { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener('message', h); resolve(d.result && d.result.result ? d.result.result.value : null); } };
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });

    let botao = null;
    for (let i = 0; i < 60 && !botao; i++) {
      botao = await avaliar("document.getElementById('mysecrets-autofill-button')?.textContent?.trim() || null");
      if (!botao) await sleep(250);
    }
    assert.strictEqual(botao, '1 entrada', 'botão de preencher aparece (em português: navegador em pt-BR)');
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
    if (ws) ws.close();
    chrome.kill();
    await new Promise((r) => { chrome.once('exit', r); setTimeout(r, 3000); });
    app.close(); site.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
