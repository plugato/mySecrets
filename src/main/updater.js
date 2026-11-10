/**
 * MySecrets - Atualizações automáticas (electron-updater + GitHub Releases).
 *
 * O app consulta as releases públicas de plugato/mySecrets (sem token). No
 * Windows só funciona instalado pelo instalador NSIS: a cópia de win-unpacked
 * (make run-win) não tem resources/app-update.yml.
 *
 * Os handlers de IPC são registrados ao carregar o módulo; register() só
 * informa a janela principal. setupAutoUpdater() roda com o app pronto.
 */

const { app, clipboard, dialog, ipcMain, shell } = require('electron');
const { t } = require('./i18n');
const linuxInstall = require('./linux-install');

let getWindow = () => null;

let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (error) {
  console.warn('⚠️ electron-updater indisponível:', error.message);
}

function sendUpdateStatus(status, extra = {}) {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('update-status', { status, ...extra });
  }
}

function setupAutoUpdater() {
  if (!autoUpdater) return;

  // .deb: o app instala por conta própria (ver linux-install.js); o pkexec do
  // electron-updater ao fechar falharia em silêncio no COSMIC
  const deb = linuxInstall.isDebInstall();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = !deb;

  // Em dev (--dev), usa dev-app-update.yml da raiz para permitir testes
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
  }

  autoUpdater.on('checking-for-update', () => {
    console.log('🔄 Verificando atualizações...');
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('⬇️ Atualização disponível:', info.version);
    sendUpdateStatus('available', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('✅ Aplicativo atualizado (nenhuma versão nova)');
    sendUpdateStatus('none', { version: app.getVersion() });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('downloading', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    console.log('✅ Atualização baixada:', info.version);
    sendUpdateStatus('downloaded', { version: info.version });

    const result = await dialog.showMessageBox(getWindow(), {
      type: 'info',
      title: t('Atualização pronta'),
      message: t("A versão {0} do MySecrets foi baixada.", { 0: info.version }),
      detail: deb
        ? t('Instale agora para aplicar (o app fecha e reabre na versão nova).')
        : t('Reinicie agora para aplicar, ou ela será instalada ao fechar o app.'),
      buttons: [t('Depois'), deb ? t('Instalar agora') : t('Reiniciar agora')],
      defaultId: 1
    });
    if (result.response !== 1) return;
    if (deb && info.downloadedFile) {
      await installDeb(info.downloadedFile);
    } else {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (error) => {
    console.warn('⚠️ Erro no auto-update:', error.message);
    sendUpdateStatus('error', { message: error.message });
  });

  // Verificação automática só no app empacotado (em dev, use o botão
  // "Verificar agora" nas Configurações)
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn('⚠️ Falha ao verificar atualizações:', err.message);
      });
    }, 5000);
  }
}

/** Linux .deb: pkexec; sem agente de senha, terminal com sudo; sem terminal, o comando para copiar. */
async function installDeb(debPath) {
  const tentativa = linuxInstall.installWithPkexec(debPath);
  if (tentativa.result === 'ok') {
    app.relaunch();
    app.exit(0);
    return;
  }
  if (tentativa.result === 'cancelled') {
    sendUpdateStatus('error', { message: t('Instalação cancelada.') });
    return;
  }
  console.warn('⚠️ pkexec não instalou a atualização:', tentativa.detail);

  const script = linuxInstall.terminalScript(debPath, process.execPath, {
    title: t('Atualizando o MySecrets. Digite a sua senha do sistema:'),
    ok: t('MySecrets atualizado. Reabrindo…'),
    fail: t('A instalação não terminou. O MySecrets vai abrir na versão de antes.'),
    enter: t('Tecle Enter para fechar.')
  });
  const term = linuxInstall.findTerminal(script);
  if (term && await linuxInstall.openTerminal(term)) {
    // O terminal reabre o app no final (instalado ou não)
    app.exit(0);
    return;
  }

  const comando = linuxInstall.installCommand(debPath);
  const r = await dialog.showMessageBox(getWindow(), {
    type: 'info',
    title: t('Instalar a atualização'),
    message: t('Não foi possível pedir a senha do sistema. Para instalar, rode no terminal:'),
    detail: comando,
    buttons: [t('Fechar'), t('Copiar comando')],
    defaultId: 1
  });
  if (r.response === 1) clipboard.writeText(comando);
  shell.showItemInFolder(debPath);
}

ipcMain.handle('get-app-version', async () => app.getVersion());

ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater) {
    return { success: false, error: t('electron-updater não está instalado') };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return {
      success: true,
      currentVersion: app.getVersion(),
      latestVersion: result && result.updateInfo ? result.updateInfo.version : null
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

function register(deps) {
  getWindow = deps.getWindow;
}

module.exports = { register, setupAutoUpdater };
