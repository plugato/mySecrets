// Atualização .deb no Linux: pkexec, terminal com sudo ou comando para copiar.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');

const li = require('../src/main/linux-install');

const msgs = { title: 'Atualizando', ok: 'Pronto', fail: 'Falhou', enter: 'Enter' };

test('só considera .deb quando resources/package-type diz deb', { skip: process.platform !== 'linux' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-pt-'));
  try {
    assert.strictEqual(li.isDebInstall({}, dir), false);
    fs.writeFileSync(path.join(dir, 'package-type'), 'deb\n');
    assert.strictEqual(li.isDebInstall({}, dir), true);
    assert.strictEqual(li.isDebInstall({ APPIMAGE: '/x.AppImage' }, dir), false);
    fs.writeFileSync(path.join(dir, 'package-type'), 'rpm');
    assert.strictEqual(li.isDebInstall({}, dir), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('caminho com aspas e espaços não quebra o comando', () => {
  const deb = "/home/a b/.cache/it's/mysecrets_2.3.0_amd64.deb";
  const r = spawnSync('bash', ['-c', `printf %s ${li.shQuote(deb)}`], { encoding: 'utf8' });
  assert.strictEqual(r.stdout, deb);
  assert.strictEqual(li.installCommand('/tmp/x.deb'), "sudo apt install -y '/tmp/x.deb'");
});

test('script do terminal é bash válido, instala e reabre o app nos dois casos', () => {
  const s = li.terminalScript("/tmp/o'k.deb", '/opt/MySecrets/mysecrets', msgs);
  assert.strictEqual(spawnSync('bash', ['-n', '-c', s]).status, 0);
  assert.match(s, /sudo apt install -y/);
  // Reabre fora do if/else: com ou sem sucesso
  const depoisDoFi = s.slice(s.lastIndexOf('fi'));
  assert.match(depoisDoFi, /setsid '\/opt\/MySecrets\/mysecrets'/);
});

test('escolhe o primeiro terminal disponível, com o jeito certo de passar o comando', () => {
  const t1 = li.findTerminal('echo oi', (c) => ['gnome-terminal', 'xterm'].includes(c));
  assert.deepStrictEqual(t1, { cmd: 'gnome-terminal', args: ['--', 'bash', '-c', 'echo oi'] });
  const t2 = li.findTerminal('echo oi', (c) => c === 'xfce4-terminal');
  assert.deepStrictEqual(t2.args, ['-x', 'bash', '-c', 'echo oi']);
  assert.strictEqual(li.findTerminal('x', () => false), null);
});

test('pkexec: ok, cancelado (126) e sem agente de senha (127, COSMIC)', { skip: process.platform !== 'linux' }, () => {
  const run = (status, stderr = '') => () => ({ status, stderr });
  // Só vale onde há pkexec no PATH (o módulo confere antes)
  const temPkexec = spawnSync('bash', ['-c', 'command -v pkexec']).status === 0;
  if (!temPkexec) return;
  assert.strictEqual(li.installWithPkexec('/x.deb', run(0)).result, 'ok');
  assert.strictEqual(li.installWithPkexec('/x.deb', run(126)).result, 'cancelled');
  const r = li.installWithPkexec('/x.deb', run(127, 'Error executing command as another user: No authentication agent found.'));
  assert.strictEqual(r.result, 'no-agent');
  assert.match(r.detail, /No authentication agent/);
});

test('openTerminal: resolve false se o terminal não existe', async () => {
  const falha = () => { const e = new EventEmitter(); setImmediate(() => e.emit('error', new Error('ENOENT'))); e.unref = () => {}; return e; };
  assert.strictEqual(await li.openTerminal({ cmd: 'x', args: [] }, falha), false);
  const ok = () => { const e = new EventEmitter(); e.unref = () => {}; return e; };
  assert.strictEqual(await li.openTerminal({ cmd: 'x', args: [] }, ok), true);
});
