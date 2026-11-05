// Abre o app Electron de verdade (perfil isolado, nunca o cofre real) e
// conversa com a janela pelo protocolo de depuração do Chromium (CDP).
// Usado pelos testes *.e2e.js (npm run test:e2e). No Linux sem tela, rode
// com xvfb-run.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const ELECTRON = require(path.join(ROOT, 'node_modules', 'electron'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchApp() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-e2e-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, XDG_CONFIG_HOME: profile, APPDATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [`--remote-debugging-port=${port}`, ROOT];
  // Runners de CI (Ubuntu 24) não permitem o sandbox do Chromium sem privilégio
  if (process.env.CI) args.unshift('--no-sandbox');
  const child = spawn(ELECTRON, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === 'page' && t.url.endsWith('index.html'));
    } catch (_) { /* ainda abrindo */ }
  }
  if (!target) {
    child.kill();
    throw new Error('A janela do app não abriu.\n' + log.slice(-2000));
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  // Espera o app.js terminar de carregar
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const my = ++id;
    const onMsg = (m) => {
      const d = JSON.parse(m.data);
      if (d.id !== my) return;
      ws.removeEventListener('message', onMsg);
      if (d.error) reject(new Error(d.error.message)); else resolve(d.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: my, method, params }));
  });

  /** Avalia uma expressão na janela (pode ser async) e devolve o valor. */
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    }
    return r.result.value;
  }

  for (let i = 0; i < 40; i++) {
    if (await evaluate('typeof renderEntries === "function" && !!window.electronAPI').catch(() => false)) break;
    await sleep(250);
  }

  async function close() {
    try { ws.close(); } catch (_) { /* já fechado */ }
    child.kill();
    await new Promise((r) => { child.once('exit', r); setTimeout(r, 3000); });
    fs.rmSync(profile, { recursive: true, force: true });
  }

  return { evaluate, send, close, profile, vaultDir: path.join(profile, 'mysecrets'), log: () => log };
}

module.exports = { launchApp, ROOT };
