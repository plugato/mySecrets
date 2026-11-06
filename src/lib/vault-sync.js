/**
 * Sincronização do cofre por pasta (Google Drive para computador, ou qualquer
 * pasta sincronizada).
 *
 * O cofre continua sendo um único arquivo criptografado (secrets.enc); a nuvem
 * só vê o arquivo cifrado. Estrutura criada na pasta escolhida:
 *
 *   MySecrets/
 *     secrets.enc                 cofre criptografado (AES-256-GCM)
 *     backups/                    backups automáticos e cópias de conflito
 *     .mysecrets-exclusoes.json   ids apagados de vez (só ids aleatórios)
 *     LEIA-ME.txt
 *
 * Quando dois PCs editam antes de sincronizar, as versões são mescladas entrada
 * por entrada: vence a alteração mais recente (updatedAt/deletedAt). Exclusões
 * definitivas viram "lápides" para que a entrada não ressuscite pela outra cópia.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const VAULT_FILE = 'secrets.enc';
const FOLDER_NAME = 'MySecrets';
const TOMBSTONES_FILE = '.mysecrets-exclusoes.json';
const LOCATION_FILE = 'vault-location.json';

const LEIA_ME = `MySecrets — cofre sincronizado
==============================

Esta pasta guarda o seu cofre do MySecrets para sincronizar entre computadores.

- secrets.enc: o cofre, criptografado com AES-256-GCM. Sem a senha mestra
  ninguém consegue ler, nem o Google.
- backups/: cópias automáticas do cofre e versões de conflito já mescladas.
- .mysecrets-exclusoes.json: identificadores de itens apagados (não contém
  nenhum dado), usado para um item apagado num PC não voltar pelo outro.

Não edite nem renomeie esses arquivos. Para usar em outro PC, instale o
MySecrets, abra Configurações > Sincronização e escolha esta mesma pasta,
com a mesma senha mestra.
`;

// ===== Onde o cofre está =====

/** Lê a pasta configurada (userData/vault-location.json) ou null. */
function readVaultLocation(userDataPath) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(userDataPath, LOCATION_FILE), 'utf8'));
    return cfg && typeof cfg.dir === 'string' && cfg.dir ? cfg.dir : null;
  } catch (_) {
    return null;
  }
}

function writeVaultLocation(userDataPath, dir) {
  const file = path.join(userDataPath, LOCATION_FILE);
  if (dir) {
    fs.writeFileSync(file, JSON.stringify({ dir }, null, 2));
  } else if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

/** Pasta MySecrets dentro da pasta escolhida (não duplica se já for ela). */
function syncFolderFor(baseDir) {
  return path.basename(baseDir) === FOLDER_NAME ? baseDir : path.join(baseDir, FOLDER_NAME);
}

/** Prepara a estrutura da pasta sincronizada. */
function prepareSyncFolder(dir) {
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const leiaMe = path.join(dir, 'LEIA-ME.txt');
  if (!fs.existsSync(leiaMe)) fs.writeFileSync(leiaMe, LEIA_ME);
}

/**
 * Procura a pasta do Google Drive para computador.
 * Windows: unidade virtual (G:\Meu Drive); macOS: ~/Library/CloudStorage;
 * Linux não tem cliente oficial — cobre os caminhos comuns de rclone/Insync.
 */
function detectGoogleDrive(env = process.env, platform = process.platform, exists = fs.existsSync) {
  const home = os.homedir();
  const nomes = ['Meu Drive', 'My Drive'];
  const candidatos = [];

  if (platform === 'win32') {
    for (let c = 'D'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
      nomes.forEach(n => candidatos.push(String.fromCharCode(c) + ':\\' + n));
    }
    const perfil = env.USERPROFILE || home;
    candidatos.push(path.join(perfil, 'Google Drive'), path.join(perfil, 'Meu Drive'), path.join(perfil, 'My Drive'));
  } else if (platform === 'darwin') {
    const cloud = path.join(home, 'Library', 'CloudStorage');
    try {
      fs.readdirSync(cloud).filter(d => d.startsWith('GoogleDrive')).forEach(d => {
        nomes.forEach(n => candidatos.push(path.join(cloud, d, n)));
      });
    } catch (_) { /* sem Google Drive */ }
    candidatos.push(path.join(home, 'Google Drive'));
  } else {
    ['GoogleDrive', 'Google Drive', 'google-drive', 'gdrive', 'Drive'].forEach(d => candidatos.push(path.join(home, d)));
    try {
      const insync = path.join(home, 'Insync');
      fs.readdirSync(insync).forEach(conta => candidatos.push(path.join(insync, conta, 'Google Drive')));
    } catch (_) { /* sem Insync */ }
  }

  return candidatos.find(p => exists(p)) || null;
}

// ===== Mesclagem =====

const tempo = (iso) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Momento da última alteração de uma entrada (edição ou ida para a lixeira). */
function entryTime(e) {
  return Math.max(tempo(e && e.updatedAt), tempo(e && e.deletedAt));
}

/** Junta mapas de lápides { id: isoDate }, ficando com a data mais recente. */
function mergeTombstones(...mapas) {
  const out = {};
  mapas.forEach(m => Object.entries(m || {}).forEach(([id, quando]) => {
    if (!out[id] || tempo(quando) > tempo(out[id])) out[id] = quando;
  }));
  return out;
}

/**
 * Mescla várias versões do cofre (arrays de entradas).
 * Por id, vence a entrada alterada por último; empate fica com a primeira lista
 * (a deste PC). Entradas apagadas de vez depois da última alteração somem.
 * A ordem segue a primeira lista, com as entradas novas no fim.
 */
function mergeVaults(listas, tombstones = {}) {
  const porId = new Map();
  listas.forEach(lista => (lista || []).forEach(e => {
    if (!e || !e.id) return;
    const atual = porId.get(e.id);
    if (!atual || entryTime(e) > entryTime(atual)) porId.set(e.id, e);
  }));

  for (const [id, quando] of Object.entries(tombstones)) {
    const e = porId.get(id);
    if (e && tempo(quando) >= entryTime(e)) porId.delete(id);
  }

  return Array.from(porId.values());
}

/** Ids que existiam antes e não existem mais (exclusão definitiva). */
function removedIds(antes, depois) {
  const agora = new Set((depois || []).map(e => e && e.id));
  return Array.from(antes || []).filter(id => id && !agora.has(id));
}

// ===== Arquivos na pasta =====

/**
 * Cópias de conflito criadas pela nuvem, ex.: "secrets (1).enc",
 * "secrets_conflict-20261101.enc" ou "secrets.enc (1)".
 */
function findConflictCopies(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => f !== VAULT_FILE && /^secrets[ ._(-].*enc/i.test(f))
      .map(f => path.join(dir, f));
  } catch (_) {
    return [];
  }
}

/** Lê e junta as lápides, incluindo cópias de conflito do próprio arquivo. */
function readTombstones(dir) {
  const arquivos = [];
  try {
    fs.readdirSync(dir).forEach(f => {
      if (/^\.mysecrets-exclusoes\b.*\.json\b/i.test(f)) arquivos.push(path.join(dir, f));
    });
  } catch (_) { /* pasta inexistente */ }

  const lidos = [];
  const mapas = [];
  arquivos.forEach(f => {
    let m;
    try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { m = null; }
    if (m && typeof m === 'object' && !Array.isArray(m)) {
      mapas.push(m);
      lidos.push(f);
      return;
    }
    // Ilegível: guarda uma cópia com outro nome (que não é lido de novo) em vez
    // de deixar a próxima gravação apagar o que havia nele.
    try {
      const guardado = path.join(path.dirname(f), `.corrompido-${Date.now()}-${path.basename(f).replace(/^\./, '')}`);
      fs.renameSync(f, guardado);
    } catch (_) { /* sem permissão: segue sem ele */ }
  });
  return { tombstones: mergeTombstones(...mapas), files: lidos };
}

/** Grava as lápides e remove as cópias de conflito delas. */
function writeTombstones(dir, tombstones, arquivosAntigos = []) {
  const principal = path.join(dir, TOMBSTONES_FILE);
  fs.writeFileSync(principal, JSON.stringify(tombstones, null, 2));
  arquivosAntigos.filter(f => f !== principal).forEach(f => {
    try { fs.unlinkSync(f); } catch (_) {}
  });
}

module.exports = {
  VAULT_FILE,
  FOLDER_NAME,
  TOMBSTONES_FILE,
  readVaultLocation,
  writeVaultLocation,
  syncFolderFor,
  prepareSyncFolder,
  detectGoogleDrive,
  entryTime,
  mergeTombstones,
  mergeVaults,
  removedIds,
  findConflictCopies,
  readTombstones,
  writeTombstones
};
