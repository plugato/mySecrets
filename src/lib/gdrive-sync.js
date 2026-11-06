/**
 * MySecrets - Uma rodada de sincronização com o Google Drive (Node puro).
 *
 * Separado do main.js para ser testado com um Drive simulado. Garantias:
 *
 * - Exclusões nunca se perdem: se a lista de exclusões da nuvem não puder ser
 *   baixada ou lida, a rodada é interrompida (antes ela virava "vazia" e era
 *   enviada por cima da lista dos outros aparelhos, e itens apagados voltavam).
 *
 * - Edições feitas durante a rodada não se perdem: o cofre e as exclusões
 *   locais são lidos, mesclados e gravados num trecho sem await, logo antes de
 *   gravar. O que o usuário salvou enquanto a rede respondia entra na mescla.
 *
 * - Envio otimista: antes de enviar, confere se os arquivos da nuvem mudaram
 *   desde a leitura (md5Checksum). Se mudaram, a rodada recomeça e mescla de
 *   novo, em vez de apagar o que outro aparelho acabou de enviar.
 */

const vaultSync = require('./vault-sync');

class RemoteChangedError extends Error {
  constructor() {
    super('O cofre no Google Drive mudou durante a sincronização.');
    this.code = 'remote_changed';
  }
}

const md5Of = (meta) => (meta ? meta.md5Checksum || null : null);

function parseTombstones(texto) {
  let t;
  try { t = JSON.parse(texto); } catch (_) { t = null; }
  if (!t || typeof t !== 'object' || Array.isArray(t)) {
    throw new Error('A lista de exclusões no Google Drive está ilegível. A sincronização foi interrompida para não perder exclusões.');
  }
  return t;
}

/**
 * deps:
 *   client       DriveClient (findFile, download, upload, ensureFolder)
 *   password     senha mestra
 *   state        { folderId, lastRemoteMd5, lastSyncedHash }
 *   folderName, readme
 *   readLocal()            -> entradas do cofre local ([] se não existe)
 *   writeLocal(entries)    grava o cofre local
 *   readLocalTombs()       -> { tombstones, files }
 *   writeLocalTombs(t, files)
 *   encrypt(text, pw) -> objeto; decrypt(obj, pw) -> text
 *   hash(entries) -> string
 * Retorna { folderId, lastRemoteMd5, lastSyncedHash, localChanged }.
 */
async function syncOnce(deps) {
  const { client, password, state = {}, folderName, readme } = deps;
  const { VAULT_FILE, TOMBSTONES_FILE } = vaultSync;

  let folderId = state.folderId;
  if (!folderId) {
    folderId = await client.ensureFolder(folderName);
    if (readme && !(await client.findFile('LEIA-ME.txt', folderId))) {
      await client.upload('LEIA-ME.txt', folderId, readme, null, 'text/plain');
    }
  }

  const remoteMeta = await client.findFile(VAULT_FILE, folderId);
  const tombMeta = await client.findFile(TOMBSTONES_FILE, folderId);

  // Só baixa o cofre da nuvem se ele mudou desde a última sincronização.
  // Erro de rede sobe como está; só falha ao decifrar vira "outra senha".
  let remote = null;
  if (remoteMeta && md5Of(remoteMeta) !== state.lastRemoteMd5) {
    const texto = await client.download(remoteMeta.id);
    try {
      remote = JSON.parse(deps.decrypt(JSON.parse(texto), password));
    } catch (e) {
      throw new Error('O cofre no Google Drive usa outra senha mestra (ou está corrompido).', { cause: e });
    }
    if (!Array.isArray(remote)) throw new Error('O cofre no Google Drive está corrompido.');
  }

  // Lista de exclusões: falha ao baixar ou ler interrompe a rodada
  const remoteT = tombMeta ? parseTombstones(await client.download(tombMeta.id)) : {};

  // ===== Trecho síncrono: lê o estado local ATUAL, mescla e grava =====
  const localT = deps.readLocalTombs();
  const tombs = vaultSync.mergeTombstones(localT.tombstones, remoteT);
  const local = deps.readLocal();
  const merged = vaultSync.mergeVaults(remote ? [local, remote] : [local], tombs);
  const mergedHash = deps.hash(merged);
  const localChanged = deps.hash(local) !== mergedHash;
  if (localChanged) deps.writeLocal(merged);
  if (JSON.stringify(tombs) !== JSON.stringify(localT.tombstones)) {
    deps.writeLocalTombs(tombs, localT.files);
  }
  // ===== fim do trecho síncrono =====

  try {
    return await enviar();
  } catch (e) {
    // A tela precisa recarregar mesmo se o envio falhar: o cofre local mudou
    if (localChanged) e.localChanged = true;
    throw e;
  }

  async function enviar() {
    const remoteHash = remote ? deps.hash(remote) : (remoteMeta ? state.lastSyncedHash : null);
    const enviarCofre = !remoteMeta || mergedHash !== remoteHash;
    const enviarExclusoes = JSON.stringify(tombs) !== JSON.stringify(remoteT);

    let md5 = md5Of(remoteMeta);
    if (enviarCofre || enviarExclusoes) {
      // Outro aparelho enviou algo desde a leitura? Recomeça em vez de sobrescrever.
      const [agoraV, agoraT] = [await client.findFile(VAULT_FILE, folderId), await client.findFile(TOMBSTONES_FILE, folderId)];
      if (md5Of(agoraV) !== md5Of(remoteMeta) || md5Of(agoraT) !== md5Of(tombMeta)) {
        throw Object.assign(new RemoteChangedError(), { folderId });
      }
      if (enviarExclusoes) {
        // Exclusões primeiro: se o envio do cofre falhar, a próxima rodada ainda
        // sabe o que foi apagado.
        await client.upload(TOMBSTONES_FILE, folderId, JSON.stringify(tombs), tombMeta && tombMeta.id, 'application/json');
      }
      if (enviarCofre) {
        const conteudo = JSON.stringify(deps.encrypt(JSON.stringify(merged), password));
        const up = await client.upload(VAULT_FILE, folderId, conteudo, remoteMeta && remoteMeta.id);
        md5 = up.md5Checksum;
      }
    }

    return { folderId, lastRemoteMd5: md5, lastSyncedHash: mergedHash, localChanged };
  }
}

/** syncOnce com novas tentativas quando a nuvem muda no meio da rodada. */
async function syncWithRetry(deps, tentativas = 3) {
  let state = deps.state || {};
  let localChanged = false;
  for (let i = 1; ; i++) {
    try {
      const r = await syncOnce({ ...deps, state });
      return { ...r, localChanged: localChanged || r.localChanged };
    } catch (e) {
      if (!(e instanceof RemoteChangedError) || i >= tentativas) {
        if (localChanged) e.localChanged = true;
        throw e;
      }
      // A rodada interrompida pode já ter gravado a mescla local
      localChanged = localChanged || !!e.localChanged;
      state = { ...state, folderId: e.folderId || state.folderId };
    }
  }
}

module.exports = { syncOnce, syncWithRetry, RemoteChangedError };
