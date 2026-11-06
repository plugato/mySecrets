const { app, BrowserWindow, Menu, ipcMain, dialog, clipboard, globalShortcut, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const vaultCrypto = require('./lib/vault-crypto');
const sessionCrypto = require('./lib/session-crypto');
const { inspectBackup } = require('./lib/vault-backup');
const vaultSync = require('./lib/vault-sync');
// Anexos de arquivo (ler/conferir/gravar em disco): módulo Node puro, também
// usado pelo servidor MCP
const attachmentFiles = require('../mcp-server/files');

// Códigos 2FA (o mesmo módulo do servidor MCP)
const otp = require('./lib/otp');
// Idioma (pt-BR/inglês): src/main/i18n.js; t('texto em português')
const i18n = require('./main/i18n');
const { t } = i18n;

// Configuração de segurança
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

let mainWindow;
let isDevMode = process.argv.includes('--dev');

// Arquivos locais desta máquina (nunca sincronizados)
const userDataPath = app.getPath('userData');
const sessionPath = path.join(userDataPath, '.session');
const helloPath = path.join(userDataPath, 'hello.enc');
const machineSecretPath = path.join(userDataPath, '.machine-secret');
const mcpTokenPath = path.join(userDataPath, '.mcp-token');
// Porta do servidor local enquanto ele roda: o MCP stdio lê para repassar gravações
const mcpEndpointPath = path.join(userDataPath, '.mcp-endpoint');
const trustedExtensionsPath = path.join(userDataPath, 'extension-origins.json');

// Certificar que o diretório userData existe
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

// ===== Local do cofre =====
//
// Por padrão o cofre fica em userData. Com a sincronização ligada ele fica numa
// pasta MySecrets dentro do Google Drive (ou outra pasta sincronizada) — ver
// src/lib/vault-sync.js. Sessão, token MCP e Windows Hello continuam locais.

function isSyncEnabled() {
  return !!vaultSync.readVaultLocation(userDataPath);
}

function vaultDir() {
  return vaultSync.readVaultLocation(userDataPath) || userDataPath;
}

function vaultFile() {
  return path.join(vaultDir(), vaultSync.VAULT_FILE);
}

function backupsPath() {
  return path.join(vaultDir(), 'backups');
}

// ===== Gerenciamento de Sessão (para Native Messaging) =====

/**
 * Segredo de máquina: 32 bytes aleatórios gerados uma única vez e guardados
 * com permissão 600. A chave da sessão deriva dele — diferente do esquema
 * antigo (hostname+PID+versão, adivinhável por força-bruta), um arquivo de
 * sessão copiado para fora da máquina é inútil sem esse segredo.
 * O mcp-server lê o mesmo arquivo para decifrar a sessão localmente.
 */
function getMachineSecret() {
  try {
    if (fs.existsSync(machineSecretPath)) {
      const secret = fs.readFileSync(machineSecretPath);
      if (secret.length >= 32) return secret;
    }
  } catch (_) { /* regenera abaixo */ }

  const secret = crypto.randomBytes(32);
  fs.writeFileSync(machineSecretPath, secret);
  try {
    fs.chmodSync(machineSecretPath, 0o600);
  } catch (_) { /* Windows não suporta chmod */ }
  return secret;
}

function generateSessionKey() {
  return sessionCrypto.sessionKey(getMachineSecret());
}

/** Criptografa dados da sessão (v2: AES-256-GCM, autenticado). */
function encryptSession(data) {
  return sessionCrypto.encryptSession(data, generateSessionKey());
}

/**
 * Descriptografa dados da sessão (somente formato v2 — sessões antigas
 * são simplesmente descartadas e recriadas no próximo desbloqueio)
 */
function decryptSession(encryptedData) {
  const data = sessionCrypto.decryptSession(encryptedData, generateSessionKey());
  if (!data) console.error('Sessão inválida ou de formato antigo');
  return data;
}

/** Senha mestra da sessão aberta, ou null se o cofre está bloqueado. */
function currentSessionPassword() {
  try {
    const data = decryptSession(JSON.parse(fs.readFileSync(sessionPath, 'utf8')));
    if (!data || !data.unlocked || Date.now() > data.expiresAt) return null;
    return data.password || null;
  } catch (_) {
    return null;
  }
}

/**
 * Cria arquivo de sessão quando o usuário desbloqueia
 * Permite que a extensão Chrome acesse os dados
 * SEGURANÇA: Senha é criptografada com chave baseada no sistema
 */
function createSession(masterPassword) {
  const sessionData = {
    timestamp: Date.now(),
    pid: process.pid,
    unlocked: true,
    password: masterPassword,  // Será criptografado
    expiresAt: Date.now() + (15 * 60 * 1000), // 15 minutos
    hostname: require('os').hostname()
  };
  
  const encryptedSession = encryptSession(sessionData);
  fs.writeFileSync(sessionPath, JSON.stringify(encryptedSession), 'utf8');
  
  // Definir permissões restritas (apenas owner pode ler/escrever)
  // chmod 600 - rw-------
  try {
    fs.chmodSync(sessionPath, 0o600);
    console.log('✅ Sessão criptografada criada para extensão Chrome');
    console.log('   Permissões: 600 (apenas owner)');
    console.log('   Expira em: 15 minutos');
  } catch (error) {
    console.warn('⚠️ Não foi possível definir permissões restritas:', error.message);
  }
}

/**
 * Atualiza timestamp da sessão e verifica expiração
 */
function refreshSession() {
  if (fs.existsSync(sessionPath)) {
    try {
      const encryptedData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      const sessionData = decryptSession(encryptedData);
      
      if (!sessionData) {
        console.log('⚠️ Sessão corrompida ou inválida');
        destroySession();
        return false;
      }
      
      // Verificar expiração
      if (Date.now() > sessionData.expiresAt) {
        console.log('⚠️ Sessão expirada');
        destroySession();
        return false;
      }

      // Renovar: enquanto o app estiver aberto e desbloqueado, a sessão
      // continua válida (o renderer chama isto periodicamente)
      sessionData.timestamp = Date.now();
      sessionData.expiresAt = Date.now() + (15 * 60 * 1000);

      const encryptedSession = encryptSession(sessionData);
      fs.writeFileSync(sessionPath, JSON.stringify(encryptedSession), 'utf8');
      
      return true;
    } catch (error) {
      console.error('Erro ao atualizar sessão:', error);
      destroySession();
      return false;
    }
  }
  return false;
}

/**
 * Remove arquivo de sessão quando bloquear ou fechar
 */
function destroySession() {
  // Sem sessão = cofre fechado: esquece também a chave derivada em memória
  try { vaultKeys.clear(); } catch (_) { /* ainda não inicializado */ }
  if (fs.existsSync(sessionPath)) {
    try {
      fs.unlinkSync(sessionPath);
      console.log('✅ Sessão removida');
    } catch (error) {
      console.error('Erro ao remover sessão:', error);
    }
  }
}

// ===== Idioma =====

i18n.register({
  userDataPath,
  existingInstall: () => fs.existsSync(vaultFile()),
  onChange: () => {
    buildAppMenu();
    tray.updateTrayIndicator(mcp.pendingWrites());
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
  }
});

// ===== Windows Hello: src/main/windows-hello.js =====

const windowsHello = require('./main/windows-hello');
windowsHello.register({ getWindow: () => mainWindow, helloPath });

// ===== Servidor MCP, extensão e gravações de agentes: src/main/mcp.js =====

const mcp = require('./main/mcp');
mcp.register({ getWindow: () => mainWindow, mcpTokenPath, mcpEndpointPath, trustedExtensionsPath });
const { startMcpServer, stopMcpServer, showAndFocusWindow } = mcp;

// ===== Anexos pela interface =====

ipcMain.handle('attachment-pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: t('Anexar arquivo ao cofre'),
    properties: ['openFile', 'multiSelections']
  });
  if (result.canceled || result.filePaths.length === 0) return { success: true, files: [] };
  try {
    const files = result.filePaths.map((p) => attachmentFiles.readFileAsAttachment(p));
    return { success: true, files };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('attachment-save', async (event, att) => {
  try {
    attachmentFiles.verifyAttachment(att);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: t('Salvar anexo'),
      defaultPath: path.join(app.getPath('downloads'), attachmentFiles.sanitizeName(att.name))
    });
    if (result.canceled || !result.filePath) return { success: true, canceled: true };
    // O diálogo do sistema já perguntou se pode substituir
    const saved = attachmentFiles.writeAttachmentToPath(att, result.filePath, { overwrite: true });
    return { success: true, path: saved.path };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mcp-start', async (event, options) => startMcpServer(options || {}));
ipcMain.handle('mcp-stop', async () => stopMcpServer());

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log('Caminho do preload:', preloadPath);
  console.log('Preload existe?', fs.existsSync(preloadPath));
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // DevTools expõem o cofre destravado: bloqueados fora do modo --dev,
      // não só escondidos do menu
      devTools: isDevMode,
      preload: preloadPath
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
  // Para de piscar na barra de tarefas quando o usuário volta ao app
  mainWindow.on('focus', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(false);
  });

  // Mostrar janela quando estiver pronta.
  // O evento ready-to-show nao dispara de forma confiavel em ambientes com
  // renderizacao por software (WSL2, VMs, sessoes remotas). Como a janela nasce
  // com show: false, uma falha do evento a deixaria invisivel para sempre --
  // aparece o icone na barra de tarefas, mas nenhuma tela. Dai os fallbacks.
  // show() nao levanta nem ativa a janela: sob WSLg/X11 ela sobe atras das
  // demais, aparecendo so como icone na barra de tarefas. Dai o focus().
  const showWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.moveTop();
    mainWindow.focus();
  };

  mainWindow.once('ready-to-show', showWindow);
  mainWindow.webContents.once('did-finish-load', showWindow);
  setTimeout(showWindow, 3000);

  // DevTools somente em modo dev (--dev). Ancorado, ele ocupa metade da janela
  // e esconde a UI, fazendo o app parecer que nao abriu tela. Num gerenciador
  // de senhas tambem expoe o cofre destravado a quem alcance a maquina.
  if (isDevMode) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  buildAppMenu();
}

// Menu da aplicação (refeito quando o idioma muda)
function buildAppMenu() {
  const template = [
    {
      label: t('Arquivo'),
      submenu: [
        {
          label: t('Exportar Backup'),
          click: () => exportBackup()
        },
        {
          label: t('Importar Backup'),
          click: () => importBackup()
        },
        { type: 'separator' },
        {
          label: t('Sair'),
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: t('Editar'),
      submenu: [
        { role: 'undo', label: t('Desfazer') },
        { role: 'redo', label: t('Refazer') },
        { type: 'separator' },
        { role: 'cut', label: t('Recortar') },
        { role: 'copy', label: t('Copiar') },
        { role: 'paste', label: t('Colar') }
      ]
    },
    {
      label: t('Visualizar'),
      submenu: [
        { role: 'reload', label: t('Recarregar') },
        { role: 'forceReload', label: t('Forçar Recarregamento') },
        // DevTools expõem o cofre destravado: só no modo --dev
        ...(isDevMode ? [{ role: 'toggleDevTools', label: t('Ferramentas do Desenvolvedor') }] : []),
        { type: 'separator' },
        { role: 'resetZoom', label: t('Zoom Padrão') },
        { role: 'zoomIn', label: t('Aumentar Zoom') },
        { role: 'zoomOut', label: t('Diminuir Zoom') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('Tela Cheia') }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Criptografia do cofre: ver src/lib/vault-crypto.js
// (v2: AES-256-GCM + PBKDF2 600k; lê e migra o formato legado v1 CBC)
const { isLegacyFormat } = vaultCrypto;
// Chave derivada em cache: gravar e sincronizar sem PBKDF2 a cada vez
const vaultKeys = vaultCrypto.createKeyCache();
const encryptVault = (text, password) => vaultKeys.encrypt(text, password);
const decryptVault = (data, password) => vaultKeys.decrypt(data, password);

// ===== Backup automático =====
//
// A cada salvamento, se o backup mais recente tiver mais de 6 horas,
// grava uma cópia do cofre criptografado em userData/backups (mantém 14).

const AUTO_BACKUP_MIN_INTERVAL = 6 * 60 * 60 * 1000; // 6 horas
const AUTO_BACKUP_KEEP = 14;

function listAutoBackups() {
  try {
    if (!fs.existsSync(backupsPath())) return [];
    return fs.readdirSync(backupsPath())
      .filter((f) => /^vault-.*\.enc$/.test(f))
      .map((f) => {
        const full = path.join(backupsPath(), f);
        return { file: full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (_) {
    return [];
  }
}

function maybeAutoBackup() {
  try {
    if (!fs.existsSync(vaultFile())) return;

    const backups = listAutoBackups();
    if (backups.length > 0 && Date.now() - backups[0].mtime < AUTO_BACKUP_MIN_INTERVAL) {
      return; // backup recente já existe
    }

    if (!fs.existsSync(backupsPath())) {
      fs.mkdirSync(backupsPath(), { recursive: true });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(vaultFile(), path.join(backupsPath(), `vault-${stamp}.enc`));

    // Rotaciona: mantém apenas os mais recentes
    listAutoBackups().slice(AUTO_BACKUP_KEEP).forEach((b) => {
      try { fs.unlinkSync(b.file); } catch (_) {}
    });
    console.log('✅ Backup automático criado');
  } catch (error) {
    console.warn('⚠️ Falha no backup automático:', error.message);
  }
}

// ===== Leitura/gravação do cofre e sincronização =====

// Estado do arquivo na última leitura/gravação deste PC: o hash revela se outro
// PC (via Google Drive) gravou uma versão nova; os ids revelam exclusões
// definitivas feitas aqui desde então.
let vaultState = { hash: null, ids: new Set() };

// O que a TELA recebeu por último (load-data/save-data). A sincronização grava
// no disco por baixo dela; exclusões são calculadas contra isto, não contra o
// disco, senão entradas recém-chegadas de outro aparelho pareceriam apagadas.
let rendererBase = { hash: null, ids: new Set() };

function rememberRendererBase() {
  rendererBase = { hash: vaultState.hash, ids: new Set(vaultState.ids) };
}

function fileHash(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (_) {
    return null;
  }
}

function rememberVault(entries) {
  vaultState = {
    hash: fileHash(vaultFile()),
    ids: new Set((entries || []).map((e) => e && e.id).filter(Boolean))
  };
}

function readVaultEntries(file, masterPassword) {
  return JSON.parse(decryptVault(JSON.parse(fs.readFileSync(file, 'utf8')), masterPassword));
}

/**
 * Grava via arquivo temporário + rename, para a nuvem nunca sincronizar um
 * cofre pela metade. Se o rename falhar (arquivo preso pelo cliente do Drive
 * no Windows), grava direto.
 */
function writeVaultFile(entries, masterPassword) {
  const file = vaultFile();
  const conteudo = JSON.stringify(encryptVault(JSON.stringify(entries), masterPassword));
  const tmp = path.join(path.dirname(file), '.' + path.basename(file) + '.tmp');
  try {
    fs.writeFileSync(tmp, conteudo);
    fs.renameSync(tmp, file);
  } catch (_) {
    fs.writeFileSync(file, conteudo);
    try { fs.unlinkSync(tmp); } catch (__) {}
  }
}

/**
 * Junta as entradas deste PC com o que chegou pela pasta sincronizada: uma
 * versão nova do secrets.enc gravada por outro PC, cópias de conflito criadas
 * pela nuvem e exclusões definitivas (lápides). Cópias de conflito mescladas
 * vão para backups/. Cópias com outra senha mestra são deixadas como estão.
 */
function mergeWithSyncFolder(entries, masterPassword, deletedNow = []) {
  const dir = vaultDir();
  const file = vaultFile();
  const fontes = [entries];

  if (fs.existsSync(file) && fileHash(file) !== vaultState.hash) {
    fontes.push(readVaultEntries(file, masterPassword));
  }

  const conflitos = [];
  for (const copia of vaultSync.findConflictCopies(dir)) {
    try {
      fontes.push(readVaultEntries(copia, masterPassword));
      conflitos.push(copia);
    } catch (_) {
      console.warn('Cópia de conflito ignorada (outra senha ou arquivo inválido):', path.basename(copia));
    }
  }

  const { tombstones, files } = vaultSync.readTombstones(dir);
  const agora = new Date().toISOString();
  const novas = {};
  deletedNow.forEach((id) => { novas[id] = agora; });
  const todas = vaultSync.mergeTombstones(tombstones, novas);
  if (deletedNow.length > 0 || files.length > 1) {
    vaultSync.writeTombstones(dir, todas, files);
  }

  const merged = vaultSync.mergeVaults(fontes, todas);

  if (conflitos.length > 0) {
    const destino = path.join(backupsPath(), 'conflitos');
    fs.mkdirSync(destino, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    conflitos.forEach((copia) => {
      try {
        fs.renameSync(copia, path.join(destino, `${stamp}-${path.basename(copia)}`));
      } catch (_) { /* fica para a próxima */ }
    });
  }

  return { entries: merged, merged: fontes.length > 1 || merged.length !== entries.length };
}

// Avisa o renderer quando outro PC atualiza o cofre na pasta sincronizada
let watchedVaultFile = null;

function startVaultWatcher() {
  stopVaultWatcher();
  if (!isSyncEnabled()) return;
  watchedVaultFile = vaultFile();
  fs.watchFile(watchedVaultFile, { interval: 5000 }, () => {
    const hash = fileHash(watchedVaultFile);
    if (hash && hash !== vaultState.hash && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vault-changed');
    }
  });
}

function stopVaultWatcher() {
  if (watchedVaultFile) {
    fs.unwatchFile(watchedVaultFile);
    watchedVaultFile = null;
  }
}

// IPC Handlers
ipcMain.handle('save-data', async (event, data, masterPassword, options = {}) => {
  try {
    let entries = data;
    let merged = false;
    // Exclusões feitas pelo usuário: comparadas com o que a tela tinha
    const removidos = vaultSync.removedIds(rendererBase.ids, data);
    if (isGdriveConnected()) {
      recordLocalTombstones(removidos);
    }

    // A sincronização gravou o disco depois que a tela carregou: mescla em vez
    // de sobrescrever (a edição da tela vence empates).
    const diskHash = fileHash(vaultFile());
    if (diskHash && rendererBase.hash && diskHash !== rendererBase.hash) {
      try {
        const doDisco = readVaultEntries(vaultFile(), masterPassword);
        const agora = new Date().toISOString();
        const lapides = { ...vaultSync.readTombstones(userDataPath).tombstones };
        removidos.forEach((id) => { lapides[id] = agora; });
        entries = vaultSync.mergeVaults([data, doDisco], lapides);
        merged = true;
      } catch (mergeError) {
        // Ex.: troca de senha mestra (disco ainda com a senha antiga)
        console.error('Não foi possível mesclar com o cofre do disco:', mergeError.message);
      }
    }

    if (isSyncEnabled()) {
      const r = mergeWithSyncFolder(entries, masterPassword, removidos);
      entries = r.entries;
      merged = merged || r.merged;
    }
    writeVaultFile(entries, masterPassword);
    rememberVault(entries);
    rememberRendererBase();
    gdriveSync.afterSave(masterPassword);
    if (options.autoBackup !== false) {
      maybeAutoBackup();
    }
    return merged ? { success: true, merged: true, data: entries } : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-data', async (event, masterPassword) => {
  try {
    if (!fs.existsSync(vaultFile())) {
      // Cria sessão mesmo sem dados
      rememberVault([]);
      rememberRendererBase();
      createSession(masterPassword);
      startVaultWatcher();
      startGdrive(masterPassword);
      return { success: true, data: [] };
    }

    const encryptedData = JSON.parse(fs.readFileSync(vaultFile(), 'utf8'));
    // Deriva a chave fora da thread principal (a janela não congela ao abrir)
    await vaultKeys.prime(encryptedData, masterPassword);
    const decryptedData = decryptVault(encryptedData, masterPassword);
    let entries = JSON.parse(decryptedData);

    // Migração transparente: cofres no formato legado (AES-CBC, PBKDF2 100k)
    // são regravados no formato v2 (AES-GCM, PBKDF2 600k) no primeiro acesso
    if (isLegacyFormat(encryptedData)) {
      try {
        writeVaultFile(entries, masterPassword);
        console.log('✅ Cofre migrado para o formato v2 (AES-256-GCM)');
      } catch (migrationError) {
        console.error('Erro na migração do cofre (dados seguem legíveis):', migrationError);
      }
    }

    // Sincronização: mescla cópias de conflito e exclusões vindas de outro PC
    if (isSyncEnabled()) {
      rememberVault(entries);
      try {
        const r = mergeWithSyncFolder(entries, masterPassword);
        if (r.merged) writeVaultFile(r.entries, masterPassword);
        entries = r.entries;
      } catch (syncError) {
        console.error('Erro ao mesclar a pasta sincronizada (cofre segue legível):', syncError);
      }
    }

    rememberVault(entries);
    rememberRendererBase();

    // Cria sessão quando desbloquear com sucesso
    createSession(masterPassword);
    startVaultWatcher();
    startGdrive(masterPassword);

    return { success: true, data: entries };
  } catch (error) {
    return { success: false, error: t('Senha mestra incorreta ou dados corrompidos') };
  }
});

ipcMain.handle('check-data-exists', async () => {
  return fs.existsSync(vaultFile());
});

ipcMain.handle('reset-data', async () => {
  try {
    // Idem para o Google Drive: só esquece a conta neste PC
    gdriveSync.forgetAccount();
    if (isSyncEnabled()) {
      // Não apaga o cofre da nuvem (os outros PCs dependem dele): só desliga
      // a sincronização neste PC e apaga o cofre local.
      stopVaultWatcher();
      vaultSync.writeVaultLocation(userDataPath, null);
    }
    if (fs.existsSync(vaultFile())) {
      fs.unlinkSync(vaultFile());
    }
    destroySession();
    windowsHello.removeHelloEnrollment();
    phoneUnlock.removePhoneLinks();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ===== Sincronização (Google Drive ou outra pasta sincronizada) =====

ipcMain.handle('sync-status', async () => ({
  enabled: isSyncEnabled(),
  dir: isSyncEnabled() ? vaultDir() : null,
  detected: vaultSync.detectGoogleDrive()
}));

ipcMain.handle('sync-choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: t('Escolha a pasta do Google Drive'),
    defaultPath: vaultSync.detectGoogleDrive() || undefined,
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('sync-enable', async (event, baseDir, masterPassword) => {
  try {
    if (isGdriveConnected()) {
      return { success: false, error: t('Desconecte a conta Google antes de usar uma pasta sincronizada.') };
    }
    if (!baseDir || !fs.existsSync(baseDir)) {
      return { success: false, error: t('Pasta não encontrada.') };
    }
    const destino = vaultSync.syncFolderFor(baseDir);
    if (path.resolve(destino) === path.resolve(vaultDir())) {
      return { success: false, error: t('O cofre já está nessa pasta.') };
    }

    const local = fs.existsSync(vaultFile()) ? readVaultEntries(vaultFile(), masterPassword) : [];
    vaultSync.prepareSyncFolder(destino);

    // Outro PC já sincroniza nessa pasta: mescla os dois cofres
    const remotoFile = path.join(destino, vaultSync.VAULT_FILE);
    let entries = local;
    let existia = false;
    if (fs.existsSync(remotoFile)) {
      let remoto;
      try {
        remoto = readVaultEntries(remotoFile, masterPassword);
      } catch (_) {
        return {
          success: false,
          error: t('Já existe um cofre nessa pasta com outra senha mestra. Use a mesma senha mestra em todos os PCs.')
        };
      }
      existia = true;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.copyFileSync(remotoFile, path.join(destino, 'backups', `vault-antes-de-mesclar-${stamp}.enc`));
      entries = vaultSync.mergeVaults([local, remoto], vaultSync.readTombstones(destino).tombstones);
    }

    vaultSync.writeVaultLocation(userDataPath, destino);
    writeVaultFile(entries, masterPassword);
    rememberVault(entries);
    startVaultWatcher();
    return { success: true, dir: destino, merged: existia, data: entries };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/** Desliga a sincronização por pasta trazendo a versão atual para este PC. */
function disableFolderSync() {
  if (!isSyncEnabled()) return;
  stopVaultWatcher();

  const origem = vaultFile();
  const localFile = path.join(userDataPath, vaultSync.VAULT_FILE);
  if (fs.existsSync(origem)) {
    if (fs.existsSync(localFile)) {
      const localBackups = path.join(userDataPath, 'backups');
      fs.mkdirSync(localBackups, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.copyFileSync(localFile, path.join(localBackups, `vault-antes-de-desligar-sync-${stamp}.enc`));
    }
    fs.copyFileSync(origem, localFile);
  }

  vaultSync.writeVaultLocation(userDataPath, null);
  vaultState.hash = fileHash(localFile);
}

ipcMain.handle('sync-disable', async () => {
  try {
    disableFolderSync();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ===== Sincronização com login do Google: src/main/gdrive.js =====

const gdriveSync = require('./main/gdrive');
gdriveSync.register({
  getWindow: () => mainWindow, userDataPath, vaultFile, readVaultEntries, writeVaultFile, rememberVault,
  encryptVault, decryptVault, encryptSession, decryptSession, disableFolderSync
});
const { isGdriveConnected, recordLocalTombstones, startGdrive, stopGdrive, protectToken, unprotectToken } = gdriveSync;

ipcMain.handle('refresh-session', async () => {
  const success = refreshSession();
  return { success };
});

// Handler para bloquear (destruir sessão)
ipcMain.handle('lock', async () => {
  destroySession();
  stopVaultWatcher();
  stopGdrive();
  clearCopiedSecret();
  return { success: true };
});

// ===== Clipboard com limpeza automática =====
//
// Copia via processo principal e, se configurado, limpa o clipboard após N
// segundos — apenas se ele ainda contiver o valor copiado (não apaga algo
// que o usuário copiou depois).

let clipboardClearTimer = null;
let clipboardCopied = null; // último valor copiado pelo app

/** Cofre bloqueado: tira da área de transferência o que o app copiou (só isso). */
function clearCopiedSecret() {
  if (clipboardClearTimer) {
    clearTimeout(clipboardClearTimer);
    clipboardClearTimer = null;
  }
  try {
    if (clipboardCopied !== null && clipboard.readText() === clipboardCopied) clipboard.clear();
  } catch (_) { /* clipboard indisponível */ }
  clipboardCopied = null;
}

ipcMain.handle('copy-to-clipboard', async (event, text, clearAfterSeconds = 0) => {
  try {
    clipboard.writeText(String(text));
    clipboardCopied = String(text);

    if (clipboardClearTimer) {
      clearTimeout(clipboardClearTimer);
      clipboardClearTimer = null;
    }

    const seconds = parseInt(clearAfterSeconds, 10) || 0;
    if (seconds > 0) {
      const copied = String(text);
      clipboardClearTimer = setTimeout(() => {
        try {
          if (clipboard.readText() === copied) {
            clipboard.clear();
            console.log('✅ Clipboard limpo automaticamente');
          }
        } catch (_) { /* clipboard indisponível */ }
        clipboardClearTimer = null;
      }, seconds * 1000);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ===== Backup manual (exportar/restaurar) via modal de configurações =====

ipcMain.handle('export-backup', async () => {
  try {
    await exportBackup();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('import-backup', async () => {
  try {
    await importBackup();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-backups', async () => {
  return listAutoBackups().map((b) => ({
    file: b.file,
    name: path.basename(b.file),
    modifiedAt: b.mtime
  }));
});

// ===== Celular Android: src/main/phone.js =====

const phoneUnlock = require('./main/phone');
phoneUnlock.register({ getWindow: () => mainWindow, userDataPath, protectToken, unprotectToken });

// Códigos 2FA (src/lib/otp.js)
ipcMain.handle('generate-totp', async (event, secret, options = {}) => {
  try {
    return { success: true, ...otp.generateTotp(secret, options) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('generate-hotp', async (event, secret, counter, options = {}) => {
  try {
    return { success: true, ...otp.generateHotp(secret, counter, options) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('verify-totp', async (event, token, secret, options = {}) => {
  try {
    return { success: true, isValid: otp.verifyTotp(token, secret, options) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Funções de backup
async function exportBackup() {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: t('Exportar Backup'),
    defaultPath: `mysecrets-backup-${new Date().toISOString().slice(0, 10)}.enc`,
    filters: [
      { name: t('Backup Criptografado'), extensions: ['enc'] }
    ]
  });
  
  if (result.canceled) return;
  if (!fs.existsSync(vaultFile())) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: t('Exportar Backup'),
      message: t('Ainda não há cofre salvo para exportar.')
    });
    return;
  }
  fs.copyFileSync(vaultFile(), result.filePath);
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: t('Backup Exportado'),
    message: t('Backup exportado com sucesso!')
  });
}

async function importBackup() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: t('Importar Backup'),
    defaultPath: fs.existsSync(backupsPath()) ? backupsPath() : undefined,
    filters: [
      { name: t('Backup Criptografado'), extensions: ['enc'] }
    ],
    properties: ['openFile']
  });
  
  if (result.canceled || result.filePaths.length === 0) return;
  const origem = result.filePaths[0];

  const info = inspectBackup(origem, currentSessionPassword());
  if (!info.ok) {
    await dialog.showMessageBox(mainWindow, { type: 'error', title: t('Importar Backup'), message: info.error });
    return;
  }

  let detail = t('O cofre atual será guardado em backups/ antes da troca.');
  if (info.opensWithCurrent === true) {
    detail = t("O backup abre com a sua senha atual ({0} entradas). ", { 0: info.count }) + detail;
  } else if (info.opensWithCurrent === false) {
    detail = t('ATENÇÃO: este backup NÃO abre com a sua senha mestra atual. Depois de importar, ') +
      t('você vai precisar da senha usada quando ele foi criado, senão não conseguirá abrir o cofre. ') + detail;
  } else {
    detail = t('Não foi possível conferir a senha do backup (cofre bloqueado). Depois de importar, ') +
      t('use a senha com que ele foi criado. ') + detail;
  }

  const response = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: t('Confirmar Importação'),
    message: t('Esta ação substituirá todos os dados atuais. Deseja continuar?'),
    detail,
    buttons: [t('Cancelar'), info.opensWithCurrent === false ? t('Importar mesmo assim') : t('Importar')],
    defaultId: 0,
    cancelId: 0
  });
  if (response.response !== 1) return;

  // Guarda o cofre atual: importar nunca apaga dados sem volta
  let guardado = null;
  if (fs.existsSync(vaultFile())) {
    fs.mkdirSync(backupsPath(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    guardado = path.join(backupsPath(), `antes-de-importar-${stamp}.enc`);
    fs.copyFileSync(vaultFile(), guardado);
  }

  // Troca atômica: cópia temporária na mesma pasta + rename
  const tmp = path.join(path.dirname(vaultFile()), '.' + path.basename(vaultFile()) + '.import.tmp');
  fs.copyFileSync(origem, tmp);
  fs.renameSync(tmp, vaultFile());

  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: t('Backup Importado'),
    message: t('Backup importado com sucesso! A aplicação será reiniciada.'),
    detail: guardado ? t("O cofre anterior foi guardado em:\n{0}", { 0: guardado }) : undefined
  });
  app.relaunch();
  app.exit();
}

// ===== Senhas vazadas (Have I Been Pwned, só prefixo do hash): src/main/pwned.js =====

require('./main/pwned');

// ===== Atualizações automáticas: src/main/updater.js =====

const updater = require('./main/updater');
updater.register({ getWindow: () => mainWindow });

// ===== Bandeja, atalho global e bloqueio ao suspender: src/main/tray.js =====

const tray = require('./main/tray');
tray.register({
  getWindow: () => mainWindow,
  createWindow: () => createWindow(),
  destroySession: () => destroySession(),
  showAndFocusWindow: () => showAndFocusWindow(),
  pendingWrites: () => mcp.pendingWrites()
});


// Eventos da aplicação
// Uma instância só: duas brigariam pelo arquivo do cofre e pela porta do MCP.
// A segunda só traz a janela da primeira para frente.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  createWindow();
  tray.createTray();
  tray.setupPowerMonitor();
  updater.setupAutoUpdater();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  destroySession(); // Remove sessão ao fechar
  stopMcpServer();  // Encerra o servidor MCP junto com o app
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  destroySession(); // Remove sessão antes de fechar
  stopMcpServer();  // Garante que o processo MCP não fique órfão
});

// Prevenir navegação externa
// A interface é uma página só (index.html): não abre janelas, não navega e
// não usa permissões do navegador (câmera, microfone, notificações...).
// O filtro antigo comparava origin com 'file://', mas a origem de file: é
// "null": funcionava por acaso, bloqueando tudo.
app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e) => e.preventDefault());
  contents.on('will-attach-webview', (e) => e.preventDefault());
});
