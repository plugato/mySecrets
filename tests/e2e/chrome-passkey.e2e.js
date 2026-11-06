// Passkeys na extensão, no Chromium de verdade: a página chama
// navigator.credentials.create/get, o cartão do MySecrets aparece (shadow DOM
// fechado, só clique de verdade), e o resultado é aceito por um servidor
// WebAuthn independente. "Usar outro dispositivo" cai no autenticador do
// navegador (virtual, pelo CDP). O app é falso, mas usa a mesma biblioteca de
// passkeys do app (src/lib/passkey.js); a parte do app tem e2e próprio.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sw = require('@simplewebauthn/server');
const { listen, copyExtension, passkeyApp } = require('./extension-helpers');

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

test('passkeys pela extensão no Chromium: cria, entra, recusa outro rpId e cai no navegador quando pedido',
  { skip: !chromePath() && 'Chromium com --load-extension não encontrado (CHROME_BIN)' }, async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-pk-cr-'));
    const log = [];
    const app = passkeyApp(log);
    const appPort = await listen(app);
    const site = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Site</title><h1>Site de teste</h1>'); });
    const sitePort = await listen(site);
    const ORIGIN = `http://localhost:${sitePort}`;
    const ext = path.join(work, 'ext');
    copyExtension(ext, appPort);

    const port = 30000 + Math.floor(Math.random() * 20000);
    const args = ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(work, 'perfil')}`,
      `--load-extension=${ext}`, `--disable-extensions-except=${ext}`, '--no-first-run', '--no-default-browser-check', '--lang=pt-BR', 'about:blank'];
    if (process.env.CI) args.unshift('--no-sandbox');
    const chrome = spawn(chromePath(), args, { stdio: 'ignore' });
    let ws;
    try {
      for (let i = 0; i < 60; i++) {
        await sleep(500);
        try {
          const alvos = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
          if (alvos.some((t) => t.type === 'service_worker' && t.url.endsWith('/background.js'))) break;
        } catch (_) { /* abrindo */ }
      }
      await sleep(1000); // pareamento automático
      const pagina = await (await fetch(`http://127.0.0.1:${port}/json/new?${ORIGIN}/`, { method: 'PUT' })).json();
      ws = new WebSocket(pagina.webSocketDebuggerUrl);
      await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
      let id = 0;
      const cdp = (method, params = {}) => new Promise((resolve, reject) => {
        const my = ++id;
        const h = (m) => { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener('message', h); if (d.error) reject(new Error(d.error.message)); else resolve(d.result); } };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id: my, method, params }));
      });
      const avaliar = async (expression) => (await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
      for (let i = 0; i < 40 && !(await avaliar('document.readyState === "complete"')); i++) await sleep(100);

      // Autenticador do próprio navegador (para "usar outro dispositivo")
      await cdp('WebAuthn.enable', { enableUI: false });
      await cdp('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

      // Clique de verdade (isTrusted) num botão do cartão (shadow DOM fechado)
      async function clicar(texto) {
        for (let i = 0; i < 50; i++) {
          const { root } = await cdp('DOM.getDocument', { depth: -1, pierce: true });
          const achar = (n) => {
            if (n.nodeName === 'BUTTON' && (n.children || []).some((c) => c.nodeType === 3 && c.nodeValue.includes(texto))) return n;
            for (const f of [...(n.children || []), ...(n.shadowRoots || [])]) { const r = achar(f); if (r) return r; }
            return null;
          };
          const no = achar(root);
          if (no) {
            const { model } = await cdp('DOM.getBoxModel', { backendNodeId: no.backendNodeId });
            const [x1, y1, , , x3, y3] = model.content;
            const x = (x1 + x3) / 2; const y = (y1 + y3) / 2;
            await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
            await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
            return;
          }
          await sleep(100);
        }
        throw new Error(`botão "${texto}" não apareceu`);
      }

      const user = { id: Buffer.from('usuario-1').toString('base64url'), name: 'eu@localhost', displayName: 'Eu' };
      const criarJs = (ch, rpId = 'localhost') => `(() => {
        const b = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
        window.__r = navigator.credentials.create({ publicKey: {
          rp: { id: '${rpId}', name: 'Teste' }, user: { id: b('${user.id}'), name: '${user.name}', displayName: '${user.displayName}' },
          challenge: b('${ch}'), pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' } } })
          .then((c) => ({ ok: true, instancia: c instanceof PublicKeyCredential, json: c.toJSON(), transp: c.response.getTransports() }), (e) => ({ ok: false, name: e.name }));
        return true;
      })()`;
      const resultado = () => avaliar('window.__r');

      // 1) Criar pelo MySecrets
      const ch1 = crypto.randomBytes(32).toString('base64url');
      await avaliar(criarJs(ch1));
      await clicar('Salvar no MySecrets');
      const c1 = await resultado();
      assert.ok(c1.ok, JSON.stringify(c1));
      assert.strictEqual(c1.instancia, true, 'instanceof PublicKeyCredential');
      const reg = await sw.verifyRegistrationResponse({ response: c1.json, expectedChallenge: ch1, expectedOrigin: ORIGIN, expectedRPID: 'localhost', requireUserVerification: true });
      assert.strictEqual(reg.verified, true);
      assert.ok(log.some((l) => l.method === 'mysecrets/passkey_create' && l.origin === ORIGIN), 'origem vem da aba');

      // 2) Entrar com ela
      const ch2 = crypto.randomBytes(32).toString('base64url');
      await avaliar(`(() => {
        const b = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
        window.__r = navigator.credentials.get({ publicKey: { rpId: 'localhost', challenge: b('${ch2}'), userVerification: 'preferred' } })
          .then((c) => ({ ok: true, json: c.toJSON() }), (e) => ({ ok: false, name: e.name }));
        return true;
      })()`);
      await clicar('eu@localhost');
      const c2 = await resultado();
      assert.ok(c2.ok, JSON.stringify(c2));
      const auth = await sw.verifyAuthenticationResponse({ response: c2.json, expectedChallenge: ch2, expectedOrigin: ORIGIN, expectedRPID: 'localhost', credential: reg.registrationInfo.credential, requireUserVerification: true });
      assert.strictEqual(auth.verified, true);

      // 3) rpId de outro site: SecurityError, sem cartão
      await avaliar(criarJs(crypto.randomBytes(32).toString('base64url'), 'github.com'));
      let c3 = null;
      for (let i = 0; i < 50 && !c3; i++) { c3 = await resultado(); if (!c3) await sleep(100); }
      assert.deepStrictEqual(c3, { ok: false, name: 'SecurityError' });

      // 4) "Usar outro dispositivo": vai para o autenticador do navegador, não para o app
      const criadasAntes = log.filter((l) => l.method === 'mysecrets/passkey_create').length;
      const ch4 = crypto.randomBytes(32).toString('base64url');
      await avaliar(criarJs(ch4));
      await clicar('Usar outro dispositivo');
      const c4 = await resultado();
      assert.ok(c4.ok, JSON.stringify(c4));
      assert.strictEqual(log.filter((l) => l.method === 'mysecrets/passkey_create').length, criadasAntes);
      const reg4 = await sw.verifyRegistrationResponse({ response: c4.json, expectedChallenge: ch4, expectedOrigin: ORIGIN, expectedRPID: 'localhost' });
      assert.notStrictEqual(reg4.registrationInfo.credential.id, reg.registrationInfo.credential.id);
    } finally {
      if (ws) ws.close();
      chrome.kill();
      await new Promise((r) => { chrome.once('exit', r); setTimeout(r, 3000); });
      app.close(); site.close();
      fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
