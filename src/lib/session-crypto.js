/**
 * MySecrets - Criptografia do arquivo de sessão (.session), compartilhada
 * pelo app (main.js) e pelo servidor MCP (mcp-server/vault.js).
 *
 * A sessão guarda a senha mestra enquanto o cofre está aberto, cifrada com
 * AES-256-GCM e uma chave derivada do .machine-secret (arquivo 0600 no perfil
 * do usuário). Só o formato v2 é aceito: sessões antigas ou em texto puro são
 * descartadas e recriadas no próximo desbloqueio.
 *
 * Node puro: o MCP roda fora do Electron (stdio com o node do sistema), então
 * este arquivo também vai desempacotado (asarUnpack).
 */

const crypto = require('crypto');

/** Chave da sessão a partir do segredo da máquina (Buffer). */
function sessionKey(machineSecret) {
  return crypto.createHash('sha256')
    .update('mysecrets-session-v2')
    .update(machineSecret)
    .digest();
}

function encryptSession(data, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return {
    version: 2,
    encrypted,
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex')
  };
}

/** Dados da sessão, ou null se o formato é antigo, foi adulterado ou a chave não confere. */
function decryptSession(encryptedData, key) {
  try {
    if (!encryptedData || encryptedData.version !== 2 || !encryptedData.authTag) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encryptedData.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (_) {
    return null;
  }
}

module.exports = { sessionKey, encryptSession, decryptSession };
