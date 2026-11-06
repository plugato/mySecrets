/**
 * MySecrets - Bandeja do sistema, atalho global e bloqueio ao suspender.
 *
 * register(deps) informa o que vem do main.js:
 *   getWindow(), createWindow(), destroySession(), showAndFocusWindow(),
 *   pendingWrites() (pedidos de gravação de agentes aguardando).
 */

const path = require('path');
const fs = require('fs');
const { app, Menu, Tray, ipcMain, nativeImage, globalShortcut, powerMonitor } = require('electron');

let deps = null;

function register(d) {
  deps = d;
}

let tray = null;
let trayBaseIcon = null;

// Ícone da bandeja com um ponto vermelho: há pedido de gravação esperando
function trayBadgeIcon(base) {
  const size = base.getSize();
  const bmp = Buffer.from(base.toBitmap());
  const r = Math.max(3, Math.round(size.width * 0.28));
  const cx = size.width - r;
  const cy = r - 1;
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * size.width + x) * 4; // BGRA
      bmp[i] = 40; bmp[i + 1] = 40; bmp[i + 2] = 230; bmp[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(bmp, { width: size.width, height: size.height });
}

function updateTrayIndicator(pending) {
  if (!tray || !trayBaseIcon) return;
  try {
    tray.setImage(pending > 0 ? trayBadgeIcon(trayBaseIcon) : trayBaseIcon);
  } catch (_) { /* sem bitmap: fica só o texto */ }
  tray.setToolTip(pending > 0
    ? `MySecrets — ${pending} pedido${pending > 1 ? 's' : ''} de gravação aguardando`
    : 'MySecrets');
  const itens = [];
  if (pending > 0) {
    itens.push({ label: `Revisar pedido de gravação (${pending})`, click: () => deps.showAndFocusWindow() });
    itens.push({ type: 'separator' });
  }
  itens.push(
    { label: 'Mostrar/Ocultar', click: () => toggleMainWindow() },
    { label: 'Bloquear', click: () => sendLockToRenderer() },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() }
  );
  tray.setContextMenu(Menu.buildFromTemplate(itens));
}

function sendLockToRenderer() {
  deps.destroySession();
  const win = deps.getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('system-lock');
  }
}

function toggleMainWindow() {
  const win = deps.getWindow();
  if (!win || win.isDestroyed()) {
    deps.createWindow();
    return;
  }
  if (win.isVisible() && win.isFocused()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
    if (!fs.existsSync(iconPath)) return;

    let trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) return;
    trayIcon = trayIcon.resize({ width: 16, height: 16 });

    tray = new Tray(trayIcon);
    trayBaseIcon = trayIcon;
    updateTrayIndicator(deps.pendingWrites());
    tray.on('click', () => (deps.pendingWrites() > 0 ? deps.showAndFocusWindow() : toggleMainWindow()));
  } catch (error) {
    console.warn('⚠️ Não foi possível criar o ícone na bandeja:', error.message);
  }
}

function setupPowerMonitor() {
  // Bloqueia o cofre quando o sistema suspende ou a tela é travada:
  // a sessão em disco é destruída e o renderer volta para a tela de login
  ['suspend', 'lock-screen'].forEach((evt) => {
    try {
      powerMonitor.on(evt, () => {
        console.log(`Sistema: ${evt} — bloqueando cofre`);
        sendLockToRenderer();
      });
    } catch (_) { /* evento não suportado na plataforma */ }
  });
}

// ===== Atalho global (Ctrl+Shift+M) — opcional, desligado por padrão =====
// O grab de teclado feito pelo registro pode travar o input do sistema por
// alguns segundos (observado no WSLg/X11). Por isso o atalho:
//   1. só é registrado se o usuário ativar nas configurações (via IPC);
//   2. é registrado com atraso, para o grab não coincidir com a inicialização.

const GLOBAL_SHORTCUT = 'CommandOrControl+Shift+M';
const GLOBAL_SHORTCUT_DELAY_MS = 5000;
let globalShortcutTimer = null;

function applyGlobalShortcut(enabled) {
  if (globalShortcutTimer) {
    clearTimeout(globalShortcutTimer);
    globalShortcutTimer = null;
  }

  if (!enabled) {
    try {
      globalShortcut.unregister(GLOBAL_SHORTCUT);
    } catch (_) { /* não estava registrado */ }
    return { enabled: false };
  }

  if (globalShortcut.isRegistered(GLOBAL_SHORTCUT)) {
    return { enabled: true };
  }

  globalShortcutTimer = setTimeout(() => {
    globalShortcutTimer = null;
    try {
      globalShortcut.register(GLOBAL_SHORTCUT, () => toggleMainWindow());
      console.log(`Atalho global ${GLOBAL_SHORTCUT} registrado (após atraso de ${GLOBAL_SHORTCUT_DELAY_MS / 1000}s)`);
    } catch (error) {
      console.warn('⚠️ Não foi possível registrar o atalho global:', error.message);
    }
  }, GLOBAL_SHORTCUT_DELAY_MS);

  return { enabled: true, delayed: true };
}

ipcMain.handle('set-global-shortcut', async (event, enabled) => applyGlobalShortcut(!!enabled));

module.exports = { register, createTray, setupPowerMonitor, updateTrayIndicator, toggleMainWindow };
