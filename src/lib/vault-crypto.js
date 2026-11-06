/**
 * MySecrets - Criptografia do cofre (módulo compartilhado)
 *
 * Formato v2 (atual):  AES-256-GCM + PBKDF2-SHA256 com 600.000 iterações.
 *   { version: 2, algorithm: 'aes-256-gcm', salt, iv, authTag, encrypted, iterations }
 *   GCM é autenticado: qualquer adulteração do arquivo é detectada na leitura.
 *
 * Formato v1 (legado): AES-256-CBC + PBKDF2-SHA256 com 100.000 iterações.
 *   { encrypted, salt, iv }  — sem campo version.
 *   Continua legível para migração transparente no primeiro desbloqueio.
 *
 * Módulo Node puro (sem Electron) para ser usado pelo main.js, pelo
 * mcp-server e pelos testes.
 */

const crypto = require('crypto');

const V2_ITERATIONS = 600000;
const V1_ITERATIONS = 100000;
// O número de iterações vem do próprio arquivo. Sem limite, um arquivo
// adulterado (ex.: no Drive) com bilhões de iterações travaria o app.
const MIN_ITERATIONS = 1000;
const MAX_ITERATIONS = 10000000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

function deriveKey(password, salt, iterations) {
  return crypto.pbkdf2Sync(password, salt, iterations, KEY_LENGTH, DIGEST);
}

/**
 * Criptografa o texto no formato v2 (AES-256-GCM).
 */
function encryptVault(text, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12); // 96 bits, tamanho recomendado para GCM
  const key = deriveKey(password, salt, V2_ITERATIONS);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return {
    version: 2,
    algorithm: 'aes-256-gcm',
    iterations: V2_ITERATIONS,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    encrypted
  };
}

/**
 * Detecta se o objeto está no formato legado v1 (CBC sem autenticação).
 */
function isLegacyFormat(encryptedData) {
  return !encryptedData.version || encryptedData.version < 2;
}

/**
 * Descriptografa o cofre em qualquer formato (v2 GCM ou v1 CBC legado).
 * Lança erro se a senha estiver errada ou os dados tiverem sido adulterados.
 */
function decryptVault(encryptedData, password) {
  if (!encryptedData || !encryptedData.encrypted || !encryptedData.salt || !encryptedData.iv) {
    throw new Error('Formato de dados criptografados inválido');
  }

  const salt = Buffer.from(encryptedData.salt, 'hex');
  const iv = Buffer.from(encryptedData.iv, 'hex');

  if (isLegacyFormat(encryptedData)) {
    const key = deriveKey(password, salt, V1_ITERATIONS);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  const iterations = iterationsOf(encryptedData);
  return decryptGcm(encryptedData, deriveKey(password, salt, iterations));
}

function iterationsOf(encryptedData) {
  const iterations = encryptedData.iterations || V2_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error('Formato de dados criptografados inválido (iterações)');
  }
  return iterations;
}

function decryptGcm(encryptedData, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encryptedData.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function encryptGcm(text, { salt, iterations, key }) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return {
    version: 2,
    algorithm: 'aes-256-gcm',
    iterations,
    salt,
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    encrypted
  };
}

/**
 * Descriptografa com uma das chaves derivadas da sessão (sem a senha mestra).
 * Lança erro se nenhuma chave serve para o salt/iterações do arquivo.
 */
function decryptWithKeys(encryptedData, keys) {
  if (!encryptedData || !encryptedData.encrypted || !encryptedData.salt || !encryptedData.iv) {
    throw new Error('Formato de dados criptografados inválido');
  }
  if (isLegacyFormat(encryptedData)) throw new Error('Cofre no formato antigo: desbloqueie o app para atualizar');
  const iterations = iterationsOf(encryptedData);
  const k = (keys || []).find((x) => x && x.salt === encryptedData.salt && Number(x.iterations) === iterations);
  if (!k) throw Object.assign(new Error('Nenhuma chave da sessão abre este cofre'), { code: 'KEY_NOT_FOUND' });
  return decryptGcm(encryptedData, Buffer.from(k.key, 'hex'));
}

/**
 * Cache da chave derivada, como no app Android. PBKDF2 com 600 mil iterações
 * leva centenas de ms; sem cache, cada gravação (e cada sincronização)
 * travava o processo principal.
 *
 * - Gravar reaproveita salt + chave da sessão, com IV aleatório novo a cada
 *   gravação (seguro em GCM).
 * - prime() deriva a chave de forma assíncrona ao abrir o cofre.
 * - Arquivo com outro salt (ex.: vindo da nuvem) ou senha diferente deriva de
 *   novo. clear() esquece tudo (cofre bloqueado).
 */
function createKeyCache({ onChange } = {}) {
  let senha = null;
  const chaves = new Map(); // "salt:iterações" -> Buffer
  let paraGravar = null;    // { salt, iterations, key }

  const id = (salt, it) => `${salt}:${it}`;

  function usarSenha(password) {
    if (password === senha) return;
    clear();
    senha = password;
  }

  function guardar(salt, iterations, key) {
    chaves.set(id(salt, iterations), key);
    if (chaves.size > 8) chaves.delete(chaves.keys().next().value);
    if (!paraGravar && iterations === V2_ITERATIONS) paraGravar = { salt, iterations, key };
    if (onChange) onChange();
  }

  /** Chaves em cache (sem a senha), para a sessão do servidor MCP. */
  function exportKeys() {
    return [...chaves.entries()].map(([k, key]) => {
      const [salt, iterations] = k.split(':');
      return { salt, iterations: Number(iterations), key: key.toString('hex') };
    });
  }

  async function prime(encryptedData, password) {
    if (!encryptedData || !encryptedData.salt || isLegacyFormat(encryptedData)) return;
    const iterations = iterationsOf(encryptedData);
    usarSenha(password);
    if (chaves.has(id(encryptedData.salt, iterations))) return;
    const key = await new Promise((resolve, reject) => crypto.pbkdf2(
      password, Buffer.from(encryptedData.salt, 'hex'), iterations, KEY_LENGTH, DIGEST,
      (err, k) => (err ? reject(err) : resolve(k))
    ));
    if (senha === password) guardar(encryptedData.salt, iterations, key);
  }

  function encrypt(text, password) {
    usarSenha(password);
    if (!paraGravar) {
      const salt = crypto.randomBytes(16).toString('hex');
      guardar(salt, V2_ITERATIONS, deriveKey(password, Buffer.from(salt, 'hex'), V2_ITERATIONS));
    }
    return encryptGcm(text, paraGravar);
  }

  function decrypt(encryptedData, password) {
    if (!encryptedData || !encryptedData.encrypted || !encryptedData.salt || !encryptedData.iv) {
      throw new Error('Formato de dados criptografados inválido');
    }
    if (isLegacyFormat(encryptedData)) return decryptVault(encryptedData, password);
    const iterations = iterationsOf(encryptedData);
    usarSenha(password);
    let key = chaves.get(id(encryptedData.salt, iterations));
    const nova = !key;
    if (nova) key = deriveKey(password, Buffer.from(encryptedData.salt, 'hex'), iterations);
    const text = decryptGcm(encryptedData, key); // senha errada: lança e não guarda a chave
    if (nova) guardar(encryptedData.salt, iterations, key);
    return text;
  }

  function clear() {
    chaves.forEach((k) => k.fill(0));
    chaves.clear();
    paraGravar = null;
    senha = null;
  }

  return { prime, encrypt, decrypt, clear, exportKeys };
}

/**
 * Gera o formato legado v1 — usado apenas em testes de migração.
 */
function encryptVaultLegacy(text, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const key = deriveKey(password, salt, V1_ITERATIONS);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { encrypted, salt: salt.toString('hex'), iv: iv.toString('hex') };
}

module.exports = {
  V2_ITERATIONS,
  V1_ITERATIONS,
  encryptVault,
  decryptVault,
  encryptVaultLegacy,
  isLegacyFormat,
  createKeyCache,
  decryptWithKeys
};
