/**
 * MySecrets - Instalar a atualização .deb no Linux.
 *
 * O electron-updater instala o .deb com `pkexec --disable-internal-agent`.
 * Isso falha (código 127, "No authentication agent found") quando o app
 * roda fora da sessão de login: no COSMIC (Pop!_OS 24.04) e em outros
 * ambientes com systemd, o app aberto pelo menu fica num escopo próprio
 * (app.slice) e o agente de senha da sessão não atende o pedido.
 *
 * Por isso o app faz a instalação por conta própria:
 *   1. tenta o pkexec (funciona onde o agente atende);
 *   2. se não houver agente, abre um terminal com `sudo apt install` já
 *      pronto, que reabre o MySecrets no final;
 *   3. sem terminal conhecido, devolve o comando para o usuário copiar.
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

/** Instalado pelo .deb (e não AppImage/rpm/pasta solta)? */
function isDebInstall(env = process.env, resourcesPath = process.resourcesPath) {
  if (process.platform !== 'linux' || env.APPIMAGE || !resourcesPath) return false;
  try {
    return fs.readFileSync(path.join(resourcesPath, 'package-type'), 'utf8').trim() === 'deb';
  } catch (_) {
    return false;
  }
}

/** Aspas simples de shell (o caminho vem do cache do usuário). */
function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Comando que o usuário roda (ou copia) para instalar. */
function installCommand(debPath) {
  return `sudo apt install -y ${shQuote(debPath)}`;
}

/**
 * Script do terminal: instala e reabre o MySecrets (a versão nova ou, se a
 * instalação falhar ou for cancelada, a mesma de antes).
 */
function terminalScript(debPath, appPath, msgs) {
  return [
    `echo ${shQuote(msgs.title)}`,
    'echo',
    `if ${installCommand(debPath)}; then`,
    `  echo; echo ${shQuote(msgs.ok)}; sleep 2`,
    'else',
    `  echo; echo ${shQuote(msgs.fail)}; read -r -p ${shQuote(msgs.enter + ' ')} _`,
    'fi',
    `setsid ${shQuote(appPath)} >/dev/null 2>&1 < /dev/null &`,
    'sleep 1'
  ].join('\n');
}

// Terminal -> argumentos para rodar "bash -c script". cosmic-term por último:
// não tem opção documentada para executar um comando.
const TERMINAIS = [
  ['gnome-terminal', (s) => ['--', 'bash', '-c', s]],
  ['konsole', (s) => ['-e', 'bash', '-c', s]],
  ['xfce4-terminal', (s) => ['-x', 'bash', '-c', s]],
  ['kitty', (s) => ['bash', '-c', s]],
  ['alacritty', (s) => ['-e', 'bash', '-c', s]],
  ['tilix', (s) => ['-e', 'bash', '-c', s]],
  ['x-terminal-emulator', (s) => ['-e', 'bash', '-c', s]],
  ['xterm', (s) => ['-e', 'bash', '-c', s]],
  ['cosmic-term', (s) => ['-e', 'bash', '-c', s]]
];

function hasCommand(cmd, envPath = process.env.PATH || '') {
  return envPath.split(':').some((dir) => {
    if (!dir) return false;
    try {
      fs.accessSync(path.join(dir, cmd), fs.constants.X_OK);
      return true;
    } catch (_) {
      return false;
    }
  });
}

/** Primeiro terminal disponível: { cmd, args } ou null. */
function findTerminal(script, has = hasCommand) {
  for (const [cmd, args] of TERMINAIS) {
    if (has(cmd)) return { cmd, args: args(script) };
  }
  return null;
}

/**
 * Tenta com pkexec. Devolve 'ok', 'cancelled' (fechou a janela de senha) ou
 * 'no-agent' (sem agente de senha / não autorizado — vai para o terminal).
 */
function installWithPkexec(debPath, run = spawnSync) {
  if (!hasCommand('pkexec')) return { result: 'no-agent', detail: 'pkexec não encontrado' };
  const r = run('pkexec', ['--disable-internal-agent', 'dpkg', '-i', debPath], { encoding: 'utf8' });
  if (r.error) return { result: 'no-agent', detail: r.error.message };
  if (r.status === 0) return { result: 'ok' };
  if (r.status === 126) return { result: 'cancelled' };
  return { result: 'no-agent', detail: String(r.stderr || '').trim() || `pkexec saiu com ${r.status}` };
}

/** Abre o terminal; resolve true se ele subiu. */
function openTerminal(term, spawnFn = spawn) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(term.cmd, term.args, { detached: true, stdio: 'ignore' });
    } catch (_) {
      resolve(false);
      return;
    }
    let done = false;
    const fim = (ok) => { if (!done) { done = true; resolve(ok); } };
    child.once('error', () => fim(false));
    // Sem erro logo de cara: o terminal abriu
    setTimeout(() => { child.unref(); fim(true); }, 700);
  });
}

module.exports = {
  isDebInstall,
  shQuote,
  installCommand,
  terminalScript,
  findTerminal,
  installWithPkexec,
  openTerminal
};
