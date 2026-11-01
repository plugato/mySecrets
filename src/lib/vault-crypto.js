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

  const iterations = encryptedData.iterations || V2_ITERATIONS;
  const key = deriveKey(password, salt, iterations);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
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
  isLegacyFormat
};
