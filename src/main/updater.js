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

const { app, dialog, ipcMain } = require('electron');
const { t } = require('./i18n');

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

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

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
      detail: t('Reinicie agora para aplicar, ou ela será instalada ao fechar o app.'),
      buttons: [t('Depois'), t('Reiniciar agora')],
      defaultId: 1
    });
    if (result.response === 1) {
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
