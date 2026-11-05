/**
 * MySecrets - Acesso ao cofre para o servidor MCP
 *
 * Reaproveita o mesmo modelo de segurança do native-host da extensão Chrome:
 *   - O cofre (secrets.enc) só é lido enquanto o app desktop estiver ABERTO e
 *     DESBLOQUEADO. Ao desbloquear, o app cria um arquivo .session criptografado
 *     contendo a senha mestra (válido por 15 minutos).
 *   - A senha mestra NUNCA é armazenada por este servidor. Se o app estiver
 *     fechado ou bloqueado, nenhuma operação retorna segredos.
 *
 * Este módulo não tem dependências além de otplib (já usado pelo app).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const vaultCrypto = require('../src/lib/vault-crypto');
const sessionCrypto = require('../src/lib/session-crypto');

const APP_NAME = 'mysecrets';
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutos (igual ao main.js)

/**
 * Descobre o diretório userData do Electron para cada plataforma.
 */
function getUserDataPath() {
  if (process.env.MYSECRETS_DATA_DIR) {
    return process.env.MYSECRETS_DATA_DIR;
  }
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_NAME);
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_NAME);
  }
}

const USER_DATA_PATH = getUserDataPath();
// Com a sincronização ligada, o app grava em userData/vault-location.json a
// pasta do cofre (ex.: Google Drive/MySecrets). Sessão e segredo de máquina
// continuam em userData.
function getSecretsFile() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(USER_DATA_PATH, 'vault-location.json'), 'utf8'));
    if (cfg && cfg.dir) return path.join(cfg.dir, 'secrets.enc');
  } catch (_) { /* sem sincronização */ }
  return path.join(USER_DATA_PATH, 'secrets.enc');
}
const SESSION_FILE = path.join(USER_DATA_PATH, '.session');
const MACHINE_SECRET_FILE = path.join(USER_DATA_PATH, '.machine-secret');

/**
 * Gera a chave de sessão (formato v2).
 * Precisa casar exatamente com generateSessionKey() do main.js:
 *   sha256('mysecrets-session-v2' || machineSecret)
 * O segredo de máquina é um arquivo de 32 bytes aleatórios (chmod 600)
 * criado pelo app — sem ele, o arquivo de sessão é indecifrável.
 */
/**
 * Descriptografa o arquivo de sessão (v2: AES-256-GCM autenticado).
 * Retorna { success, data } | { success:false, error }.
 */
function decryptSession(encryptedData) {
  let secret;
  try { secret = fs.readFileSync(MACHINE_SECRET_FILE); } catch (_) {
    return { success: false, error: 'Não foi possível descriptografar a sessão' };
  }
  const data = sessionCrypto.decryptSession(encryptedData, sessionCrypto.sessionKey(secret));
  if (!data) {
    return { success: false, error: encryptedData && encryptedData.version !== 2
      ? 'Formato de sessão antigo — desbloqueie o app novamente'
      : 'Não foi possível descriptografar a sessão' };
  }
  return { success: true, data };
}

/**
 * Verifica se existe uma sessão válida (app aberto e desbloqueado).
 * Retorna { valid, unlocked?, sessionData?, reason? }.
 */
function checkSession() {
  if (!fs.existsSync(SESSION_FILE)) {
    return { valid: false, reason: 'NO_SESSION' };
  }

  let sessionData;
  try {
    const fileData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    // Só sessão cifrada (v2). Um .session em texto puro não é aceito.
    const decrypted = decryptSession(fileData);
    if (!decrypted.success) return { valid: false, reason: 'DECRYPT_FAILED' };
    sessionData = decrypted.data;
  } catch (_) {
    return { valid: false, reason: 'INVALID_SESSION' };
  }

  const now = Date.now();

  if (sessionData.expiresAt && now > sessionData.expiresAt) {
    return { valid: false, reason: 'SESSION_EXPIRED' };
  }
  if (sessionData.timestamp && now - sessionData.timestamp > SESSION_TIMEOUT) {
    return { valid: false, reason: 'SESSION_EXPIRED' };
  }
  if (sessionData.pid) {
    try {
      process.kill(sessionData.pid, 0); // 0 = só testa existência
    } catch (_) {
      return { valid: false, reason: 'APP_CLOSED' };
    }
  }
  if (sessionData.hostname && sessionData.hostname !== os.hostname()) {
    return { valid: false, reason: 'HOSTNAME_MISMATCH' };
  }

  return { valid: true, unlocked: sessionData.unlocked, sessionData };
}

/**
 * Descriptografa secrets.enc usando a senha mestra (mesmo código do app:
 * src/lib/vault-crypto.js, que vai desempacotado junto com o MCP).
 */
function decryptVault(encryptedDataString, password) {
  return JSON.parse(vaultCrypto.decryptVault(JSON.parse(encryptedDataString), password));
}

/**
 * Erro tipado para comunicar estados de bloqueio ao cliente MCP.
 */
class VaultLockedError extends Error {
  constructor(reason) {
    super(reasonMessage(reason));
    this.name = 'VaultLockedError';
    this.reason = reason;
  }
}

function reasonMessage(reason) {
  const map = {
    NO_SESSION: 'O app MySecrets não está aberto ou nunca foi desbloqueado nesta máquina.',
    SESSION_EXPIRED: 'A sessão expirou (15 min). Abra o MySecrets e desbloqueie novamente.',
    APP_CLOSED: 'O app MySecrets foi fechado. Abra-o e desbloqueie o cofre.',
    DECRYPT_FAILED: 'Não foi possível ler a sessão do MySecrets (app pode estar bloqueado).',
    HOSTNAME_MISMATCH: 'Arquivo de sessão pertence a outra máquina.',
    INVALID_SESSION: 'Sessão inválida ou corrompida.',
    NO_SESSION_PASSWORD: 'A sessão não contém a senha mestra.',
    LOCKED: 'O cofre está bloqueado. Desbloqueie o MySecrets primeiro.'
  };
  return map[reason] || 'O cofre MySecrets está indisponível.';
}

/**
 * Carrega e descriptografa todas as entradas do cofre.
 * Lança VaultLockedError se o app estiver fechado/bloqueado.
 */
function loadEntries() {
  const session = checkSession();
  if (!session.valid) throw new VaultLockedError(session.reason);
  if (!session.unlocked) throw new VaultLockedError('LOCKED');

  const password = session.sessionData && session.sessionData.password;
  if (!password) throw new VaultLockedError('NO_SESSION_PASSWORD');

  if (!fs.existsSync(getSecretsFile())) return [];

  const encryptedData = fs.readFileSync(getSecretsFile(), 'utf8');
  const data = decryptVault(encryptedData, password);
  const entries = Array.isArray(data) ? data : (data.entries || []);
  // Entradas na lixeira (soft delete) não são expostas via MCP
  return entries.filter((e) => e && !e.deletedAt);
}

/**
 * Gera o código OTP (TOTP ou HOTP) para uma entrada de MFA.
 * Retorna { code, remaining, period } ou lança erro.
 */
function generateOtp(mfaEntry) {
  const { authenticator, hotp } = require('otplib');
  const digits = mfaEntry.mfaDigits || 6;
  const period = mfaEntry.mfaPeriod || 30;
  // mfaAlgorithm é o TIPO (totp/hotp); o hash fica em mfaHash. Entradas antigas
  // sem mfaHash usavam o tipo como hash e o otplib recusava ("Received totp").
  const HASHES = ['sha1', 'sha256', 'sha512'];
  const pedido = String(mfaEntry.mfaHash || mfaEntry.mfaAlgorithm || '').toLowerCase();
  const algorithm = HASHES.includes(pedido) ? pedido : 'sha1';

  if (mfaEntry.mfaAlgorithm === 'hotp') {
    hotp.options = { digits, algorithm: normalizeAlgo(algorithm) };
    const code = hotp.generate(mfaEntry.mfaSecret, mfaEntry.mfaCounter || 0);
    return { code, counter: (mfaEntry.mfaCounter || 0) + 1 };
  }

  authenticator.options = {
    digits,
    step: period,
    algorithm: normalizeAlgo(algorithm)
  };
  const code = authenticator.generate(mfaEntry.mfaSecret);
  const epoch = Math.floor(Date.now() / 1000);
  const remaining = period - (epoch % period);
  return { code, remaining, period };
}

function normalizeAlgo(algo) {
  // otplib espera 'sha1' | 'sha256' | 'sha512' (minúsculo) no authenticator moderno
  return String(algo).toLowerCase();
}

module.exports = {
  USER_DATA_PATH,
  getSecretsFile,
  SESSION_FILE,
  checkSession,
  loadEntries,
  generateOtp,
  VaultLockedError,
  reasonMessage
};
