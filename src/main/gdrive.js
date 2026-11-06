/**
 * MySecrets - Sincronização com login do Google (Google Drive API).
 *
 * O cofre continua local (userData/secrets.enc, funciona offline) e uma cópia
 * criptografada vai para a pasta "MySecrets" no Drive do usuário. Cada
 * sincronização baixa a versão da nuvem se ela mudou, mescla entrada por
 * entrada (vault-sync.js), grava localmente e envia o resultado. Roda ao
 * desbloquear, alguns segundos depois de cada alteração e a cada minuto.
 * O refresh token fica protegido pelo cofre do sistema (safeStorage) ou, sem
 * ele, pelo segredo de máquina.
 *
 * register(deps): getWindow, userDataPath, vaultFile, readVaultEntries,
 * writeVaultFile, rememberVault, encryptVault, decryptVault, encryptSession,
 * decryptSession, disableFolderSync.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ipcMain, shell, safeStorage } = require('electron');
const googleDrive = require('../lib/google-drive');
const vaultSync = require('../lib/vault-sync');
const gdriveSyncLib = require('../lib/gdrive-sync');

let deps = { getWindow: () => null };
const win = () => deps.getWindow();

function register(d) {
  deps = d;
}

const gdriveStatePath = () => path.join(deps.userDataPath, 'google-drive.json');
const GDRIVE_FOLDER = 'MySecrets';
const GDRIVE_INTERVAL = 60 * 1000;
const GDRIVE_LEIA_ME = `MySecrets — cofre sincronizado
==============================

Esta pasta é mantida pelo app MySecrets (login com Google).

- secrets.enc: o seu cofre, criptografado com AES-256-GCM. Sem a senha mestra
  ninguém consegue ler, nem o Google.
- .mysecrets-exclusoes.json: identificadores de itens apagados (sem dados).

Não edite nem apague esses arquivos. Para usar em outro PC, instale o
MySecrets, crie o cofre com a mesma senha mestra e, em Configurações >
Sincronização, clique em "Entrar com Google".
`;

const gdrive = { client: null, password: null, timer: null, debounce: null, running: null, again: false };

function readGdriveState() {
  try {
    return JSON.parse(fs.readFileSync(gdriveStatePath(), 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeGdriveState(state) {
  fs.writeFileSync(gdriveStatePath(), JSON.stringify(state, null, 2));
  try { fs.chmodSync(gdriveStatePath(), 0o600); } catch (_) { /* Windows */ }
}

function updateGdriveState(patch) {
  writeGdriveState({ ...(readGdriveState() || {}), ...patch });
}

function protectToken(token) {
  if (safeStorage.isEncryptionAvailable()) {
    return { kind: 'safeStorage', data: safeStorage.encryptString(token).toString('base64') };
  }
  return { kind: 'machine', data: deps.encryptSession({ token }) };
}

function unprotectToken(p) {
  if (p.kind === 'safeStorage') return safeStorage.decryptString(Buffer.from(p.data, 'base64'));
  const d = deps.decryptSession(p.data);
  return d && d.token;
}

function isGdriveConnected() {
  const st = readGdriveState();
  return !!(st && st.token);
}

function gdriveClient() {
  if (gdrive.client) return gdrive.client;
  const cfg = googleDrive.loadClientConfig();
  const st = readGdriveState();
  if (!cfg || !st || !st.token) return null;
  const refreshToken = unprotectToken(st.token);
  if (!refreshToken) return null;
  gdrive.client = new googleDrive.DriveClient(cfg, refreshToken);
  return gdrive.client;
}

function gdriveStatus() {
  const st = readGdriveState() || {};
  return {
    available: !!googleDrive.loadClientConfig(),
    connected: !!st.token,
    email: st.email || '',
    lastSyncAt: st.lastSyncAt || null,
    lastError: st.lastError || null,
    syncing: !!gdrive.running
  };
}

function notifyGdrive() {
  if (win() && !win().isDestroyed()) {
    win().webContents.send('gdrive-status', gdriveStatus());
  }
}

const entriesHash = (entries) => crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');

/** Exclusões definitivas feitas neste PC viram lápides locais (enviadas no sync). */
function recordLocalTombstones(ids) {
  if (!ids.length) return;
  const { tombstones, files } = vaultSync.readTombstones(deps.userDataPath);
  const agora = new Date().toISOString();
  ids.forEach((id) => { tombstones[id] = agora; });
  vaultSync.writeTombstones(deps.userDataPath, tombstones, files);
}

async function runGdriveSync(masterPassword) {
  const client = gdriveClient();
  if (!client || !masterPassword) return;
  const st = readGdriveState() || {};

  try {
    const r = await gdriveSyncLib.syncWithRetry({
      client,
      password: masterPassword,
      state: st,
      folderName: GDRIVE_FOLDER,
      readme: GDRIVE_LEIA_ME,
      readLocal: () => (fs.existsSync(deps.vaultFile()) ? deps.readVaultEntries(deps.vaultFile(), masterPassword) : []),
      writeLocal: (entries) => {
        deps.writeVaultFile(entries, masterPassword);
        deps.rememberVault(entries);
      },
      readLocalTombs: () => vaultSync.readTombstones(deps.userDataPath),
      writeLocalTombs: (tombs, files) => vaultSync.writeTombstones(deps.userDataPath, tombs, files),
      encrypt: deps.encryptVault,
      decrypt: deps.decryptVault,
      hash: entriesHash
    });

    // Chegou algo de outro aparelho: a tela recarrega
    if (r.localChanged && win() && !win().isDestroyed()) win().webContents.send('vault-changed');

    updateGdriveState({
      folderId: r.folderId,
      lastRemoteMd5: r.lastRemoteMd5,
      lastSyncedHash: r.lastSyncedHash,
      lastSyncAt: new Date().toISOString(),
      lastError: null
    });
  } catch (error) {
    if (error.localChanged && win() && !win().isDestroyed()) win().webContents.send('vault-changed');
    if (error.code === 'invalid_grant' || error.code === 'insufficient_scope') {
      // Acesso revogado ou sem a permissão do Drive: precisa entrar de novo
      gdrive.client = null;
      updateGdriveState({
        token: null,
        lastError: error.code === 'invalid_grant' ? 'O acesso ao Google foi revogado. Entre novamente.' : error.message
      });
    } else {
      updateGdriveState({ lastError: error.message });
    }
    console.error('Sincronização com Google Drive falhou:', error.message);
  }
}

/** Uma sincronização por vez; pedidos durante uma execução geram mais uma rodada. */
function gdriveSync(masterPassword = gdrive.password) {
  if (!isGdriveConnected() || !masterPassword) return Promise.resolve();
  if (gdrive.running) {
    gdrive.again = true;
    return gdrive.running;
  }
  notifyGdrive();
  gdrive.running = runGdriveSync(masterPassword).finally(() => {
    gdrive.running = null;
    notifyGdrive();
    if (gdrive.again) {
      gdrive.again = false;
      gdriveSync();
    }
  });
  return gdrive.running;
}

function scheduleGdriveSync(delayMs = 3000) {
  if (!isGdriveConnected() || !gdrive.password) return;
  clearTimeout(gdrive.debounce);
  gdrive.debounce = setTimeout(() => gdriveSync(), delayMs);
}

function startGdrive(masterPassword) {
  if (!isGdriveConnected()) return;
  gdrive.password = masterPassword;
  clearInterval(gdrive.timer);
  gdrive.timer = setInterval(() => gdriveSync(), GDRIVE_INTERVAL);
  scheduleGdriveSync(500);
}

function stopGdrive() {
  clearInterval(gdrive.timer);
  clearTimeout(gdrive.debounce);
  gdrive.timer = null;
  gdrive.password = null;
}

ipcMain.handle('gdrive-status', async () => gdriveStatus());

ipcMain.handle('gdrive-connect', async (event, masterPassword) => {
  const cfg = googleDrive.loadClientConfig();
  if (!cfg) return { success: false, error: 'Esta versão do app não tem o login com Google configurado.' };
  try {
    deps.disableFolderSync(); // as duas formas de sincronizar não convivem

    const auth = await googleDrive.authorize(cfg, (url) => shell.openExternal(url));
    writeGdriveState({ email: auth.email, token: protectToken(auth.refreshToken) });
    gdrive.client = new googleDrive.DriveClient(cfg, auth.refreshToken);
    gdrive.client.accessToken = auth.accessToken;
    gdrive.client.expiresAt = auth.expiresAt;

    await gdriveSync(masterPassword);
    const st = readGdriveState() || {};
    if (st.lastError) {
      // Primeira sincronização falhou (ex.: senha mestra diferente): não fica meio conectado
      await googleDrive.revoke(auth.refreshToken);
      gdrive.client = null;
      fs.unlinkSync(gdriveStatePath());
      return { success: false, error: st.lastError };
    }

    startGdrive(masterPassword);
    return { success: true, status: gdriveStatus() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('gdrive-sync-now', async (event, masterPassword) => {
  if (masterPassword) gdrive.password = masterPassword;
  await gdriveSync(masterPassword || gdrive.password);
  return gdriveStatus();
});

ipcMain.handle('gdrive-disconnect', async () => {
  try {
    const client = gdriveClient();
    stopGdrive();
    if (client) await googleDrive.revoke(client.refreshToken);
    gdrive.client = null;
    if (fs.existsSync(gdriveStatePath())) fs.unlinkSync(gdriveStatePath());
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handler para atualizar sessão (chamado periodicamente pelo renderer)

/** Depois de salvar: lembra a senha e agenda a sincronização. */
function afterSave(masterPassword) {
  if (!isGdriveConnected()) return;
  gdrive.password = masterPassword;
  scheduleGdriveSync();
}

/** Apagar o cofre deste PC: esquece a conta Google aqui (a nuvem fica intacta). */
function forgetAccount() {
  if (!isGdriveConnected()) return;
  stopGdrive();
  gdrive.client = null;
  fs.unlinkSync(gdriveStatePath());
}

module.exports = {
  register, isGdriveConnected, recordLocalTombstones, startGdrive, stopGdrive,
  afterSave, forgetAccount, protectToken, unprotectToken
};
