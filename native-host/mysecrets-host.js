#!/usr/bin/env node

/**
 * MySecrets Native Messaging Host
 * 
 * Este script permite que a extensão Chrome se comunique com o app desktop
 * para acessar os dados de login armazenados de forma segura.
 * 
 * Protocolo Native Messaging:
 * - Mensagens são enviadas via stdin/stdout
 * - Formato: 4 bytes (comprimento) + JSON
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ===== CONFIGURAÇÃO =====

// Caminho para os dados do MySecrets
const ELECTRON_APP = 'mysecrets';
const USER_DATA_PATH = path.join(
  os.homedir(),
  '.config',
  ELECTRON_APP
);
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

// Timeout para sessão (15 minutos)
const SESSION_TIMEOUT = 15 * 60 * 1000;

// ===== FUNÇÕES DE COMUNICAÇÃO =====

/**
 * Lê mensagem do stdin (Chrome envia assim)
 */
function readMessage() {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let messageLength = null;
    let timeout = null;

    // Timeout de 5 segundos
    timeout = setTimeout(() => {
      debug('Timeout ao ler mensagem');
      reject(new Error('Timeout reading message'));
    }, 5000);

    const onData = (chunk) => {
      try {
        if (!chunk) return;
        
        // Garante que chunk é Buffer
        if (!Buffer.isBuffer(chunk)) {
          chunk = Buffer.from(chunk);
        }
        
        buffer = Buffer.concat([buffer, chunk]);
        debug('Dados recebidos:', buffer.length, 'bytes');

        // Ainda não temos o tamanho da mensagem
        if (messageLength === null && buffer.length >= 4) {
          messageLength = buffer.readUInt32LE(0);
          debug('Tamanho da mensagem:', messageLength);
          
          if (messageLength === 0 || messageLength > 1048576) { // Max 1MB
            clearTimeout(timeout);
            reject(new Error('Invalid message length: ' + messageLength));
            return;
          }
        }

        // Já temos o tamanho e todos os dados
        if (messageLength !== null && buffer.length >= 4 + messageLength) {
          clearTimeout(timeout);
          process.stdin.removeListener('data', onData);
          process.stdin.removeListener('end', onEnd);
          process.stdin.pause();

          const messageBuffer = buffer.slice(4, 4 + messageLength);
          const message = JSON.parse(messageBuffer.toString('utf8'));
          debug('Mensagem parseada:', message);
          resolve(message);
        }
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    };

    const onEnd = () => {
      clearTimeout(timeout);
      reject(new Error('stdin ended before message complete'));
    };

    process.stdin.on('data', onData);
    process.stdin.once('end', onEnd);
  });
}

/**
 * Envia mensagem para stdout (Chrome recebe assim)
 */
function sendMessage(message) {
  const buffer = Buffer.from(JSON.stringify(message), 'utf8');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32LE(buffer.length, 0);
  
  process.stdout.write(lengthBuffer);
  process.stdout.write(buffer);
}

/**
 * Envia erro
 */
function sendError(error, code = 'ERROR') {
  sendMessage({
    success: false,
    error: error.message || error,
    code: code
  });
}

// ===== FUNÇÕES DE SEGURANÇA =====

/**
 * Gera chave de sessão (formato v2).
 * Deve corresponder a generateSessionKey() do main.js:
 *   sha256('mysecrets-session-v2' || machineSecret)
 * O segredo de máquina (.machine-secret, 32 bytes aleatórios, chmod 600) é
 * criado pelo app — sem ele, o arquivo de sessão é indecifrável.
 */
const MACHINE_SECRET_FILE = path.join(USER_DATA_PATH, '.machine-secret');

function generateSessionKey() {
  const secret = fs.readFileSync(MACHINE_SECRET_FILE);
  return crypto.createHash('sha256')
    .update('mysecrets-session-v2')
    .update(secret)
    .digest();
}

/**
 * Descriptografa dados da sessão (v2: AES-256-GCM autenticado)
 */
function decryptSessionData(encryptedData) {
  try {
    if (encryptedData.version !== 2 || !encryptedData.authTag) {
      return { success: false, error: 'Formato de sessão antigo — desbloqueie o app novamente' };
    }
    const key = generateSessionKey();
    const iv = Buffer.from(encryptedData.iv, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    const data = JSON.parse(decrypted);
    return { success: true, data };
  } catch (error) {
    debug('Erro ao descriptografar sessão:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Verifica se há uma sessão ativa (app desktop aberto e desbloqueado)
 */
function checkSession() {
  if (!fs.existsSync(SESSION_FILE)) {
    return { valid: false, reason: 'NO_SESSION' };
  }

  try {
    const fileData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    
    let sessionData;
    
    // Verificar se está criptografado (novo formato)
    if (fileData.encrypted && fileData.iv) {
      const decrypted = decryptSessionData(fileData);
      
      if (!decrypted.success) {
        debug('Falha ao descriptografar sessão:', decrypted.error);
        return { valid: false, reason: 'DECRYPT_FAILED' };
      }
      
      sessionData = decrypted.data;
    } else {
      // Formato antigo (sem criptografia)
      sessionData = fileData;
    }
    
    const now = Date.now();
    
    // Verificar expiração explícita
    if (sessionData.expiresAt && now > sessionData.expiresAt) {
      debug('Sessão expirada (expiresAt)');
      try {
        fs.unlinkSync(SESSION_FILE);
      } catch (e) {}
      return { valid: false, reason: 'SESSION_EXPIRED' };
    }
    
    // Verificar idade da sessão (fallback)
    if (now - sessionData.timestamp > SESSION_TIMEOUT) {
      debug('Sessão expirada (timeout)');
      try {
        fs.unlinkSync(SESSION_FILE);
      } catch (e) {}
      return { valid: false, reason: 'SESSION_EXPIRED' };
    }

    // Verificar se o app está rodando (por PID)
    if (sessionData.pid) {
      try {
        process.kill(sessionData.pid, 0);
      } catch (e) {
        debug('Processo não existe mais');
        try {
          fs.unlinkSync(SESSION_FILE);
        } catch (err) {}
        return { valid: false, reason: 'APP_CLOSED' };
      }
    }
    
    // Verificar hostname (segurança adicional)
    const os = require('os');
    if (sessionData.hostname && sessionData.hostname !== os.hostname()) {
      debug('Hostname diferente - possível cópia de arquivo de sessão');
      return { valid: false, reason: 'HOSTNAME_MISMATCH' };
    }

    return {
      valid: true,
      unlocked: sessionData.unlocked,
      timestamp: sessionData.timestamp,
      sessionData
    };
  } catch (error) {
    debug('Erro ao verificar sessão:', error);
    return { valid: false, reason: 'INVALID_SESSION' };
  }
}

/**
 * Descriptografa o cofre usando a senha mestra.
 * Espelha src/lib/vault-crypto.js:
 *   v2 (atual): AES-256-GCM + PBKDF2-SHA256 600k iterações
 *   v1 (legado): AES-256-CBC + PBKDF2-SHA256 100k iterações
 */
function decryptData(encryptedDataString, password) {
  try {
    const encryptedData = JSON.parse(encryptedDataString);

    if (!encryptedData.encrypted || !encryptedData.salt || !encryptedData.iv) {
      throw new Error('Invalid encrypted data format - missing fields');
    }

    const salt = Buffer.from(encryptedData.salt, 'hex');
    const iv = Buffer.from(encryptedData.iv, 'hex');

    if (!encryptedData.version || encryptedData.version < 2) {
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return JSON.parse(decrypted);
    }

    const iterations = encryptedData.iterations || 600000;
    const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (error) {
    debug('Erro de descriptografia:', error);
    throw new Error('Decryption failed: ' + error.message);
  }
}

// ===== HANDLERS DE COMANDOS =====

/**
 * Retorna status da conexão
 */
function handleStatus() {
  const session = checkSession();
  
  sendMessage({
    success: true,
    connected: true,
    session: {
      valid: session.valid,
      unlocked: session.unlocked,
      reason: session.reason
    },
    appInstalled: fs.existsSync(getSecretsFile()),
    version: '1.0.0',
    security: {
      sessionEncrypted: true,
      hostnameValidation: true
    }
  });
}

/**
 * Gera código MFA usando otplib
 */
function generateMfaCode(mfaEntry) {
  try {
    const { authenticator, hotp } = require('otplib');
    
    if (mfaEntry.mfaAlgorithm === 'hotp') {
      // HOTP (Counter-based)
      const token = hotp.generate(mfaEntry.mfaSecret, mfaEntry.mfaCounter || 0);
      return token.slice(0, mfaEntry.mfaDigits || 6);
    } else {
      // TOTP (Time-based) - padrão
      authenticator.options = {
        digits: mfaEntry.mfaDigits || 6,
        step: mfaEntry.mfaPeriod || 30,
        algorithm: (mfaEntry.mfaHash || 'sha1').toUpperCase()
      };
      return authenticator.generate(mfaEntry.mfaSecret);
    }
  } catch (error) {
    debug('Erro ao gerar código MFA:', error);
    return null;
  }
}

/**
 * Retorna entradas de login para uma URL
 */
function handleGetEntries(message) {
  const session = checkSession();
  
  if (!session.valid) {
    return sendError('App MySecrets não está aberto ou está bloqueado', 'APP_LOCKED');
  }

  if (!session.unlocked) {
    return sendError('App MySecrets está bloqueado. Desbloqueie primeiro.', 'APP_LOCKED');
  }

  try {
    // Lê os dados criptografados
    if (!fs.existsSync(getSecretsFile())) {
      return sendMessage({
        success: true,
        entries: []
      });
    }

    const encryptedData = fs.readFileSync(getSecretsFile(), 'utf8');
    
    // Obter senha da sessão (pode estar criptografada)
    let password;
    if (session.sessionData && session.sessionData.password) {
      password = session.sessionData.password;
    } else {
      // Fallback: tentar ler diretamente
      const fileData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      if (fileData.password) {
        password = fileData.password;
      } else {
        return sendError('Session password not available', 'NO_SESSION_PASSWORD');
      }
    }

    // Descriptografa os dados usando a senha mestra
    const data = decryptData(encryptedData, password);
    
    // Os dados são um array direto, não um objeto com campo 'entries'
    // Entradas na lixeira (soft delete) não são expostas à extensão
    let allEntries = (Array.isArray(data) ? data : (data.entries || []))
      .filter(entry => entry && !entry.deletedAt);
    let entries = allEntries;
    
    // Filtra por URL se fornecida
    if (message.url) {
      const urlObj = new URL(message.url);
      const domain = urlObj.hostname;
      
      entries = allEntries.filter(entry => {
        if (entry.type !== 'login' || !entry.url) return false;
        
        try {
          const entryUrl = new URL(entry.url);
          const entryDomain = entryUrl.hostname;
          
          return domain === entryDomain || 
                 domain.endsWith('.' + entryDomain) ||
                 entryDomain.endsWith('.' + domain);
        } catch {
          return false;
        }
      });
    }
    
    // Processar entradas: adicionar código MFA se linkedMfaId existir
    entries = entries.map(entry => {
      if (entry.type === 'login' && entry.linkedMfaId) {
        const mfaEntry = allEntries.find(e => e.id === entry.linkedMfaId && e.type === 'mfa');
        
        if (mfaEntry && mfaEntry.mfaSecret) {
          const mfaCode = generateMfaCode(mfaEntry);
          if (mfaCode) {
            return {
              ...entry,
              mfaCode: mfaCode,
              mfaEntry: {
                id: mfaEntry.id,
                title: mfaEntry.title,
                algorithm: mfaEntry.mfaAlgorithm
              }
            };
          }
        }
      }
      return entry;
    });

    sendMessage({
      success: true,
      entries: entries,
      count: entries.length
    });
  } catch (error) {
    sendError('Failed to read entries: ' + error.message, 'READ_ERROR');
  }
}

/**
 * Testa a conexão
 */
function handlePing() {
  sendMessage({
    success: true,
    message: 'pong',
    timestamp: Date.now()
  });
}

// ===== MAIN =====

async function main() {
  try {
    debug('Configurando streams...');
    
    // Configura stdin/stdout para modo binário
    process.stdin.setEncoding(null);
    process.stdout.setEncoding(null);

    // Desabilita buffering
    process.stdin.resume();

    debug('Aguardando mensagem...');
    
    // Lê mensagem do Chrome
    const message = await readMessage();
    
    debug('Mensagem recebida:', message);

    // Processa comando
    debug('Processando comando:', message.command);
    
    switch (message.command) {
      case 'status':
        debug('Executando handleStatus...');
        handleStatus();
        break;
        
      case 'get_entries':
        debug('Executando handleGetEntries...');
        handleGetEntries(message);
        break;
        
      case 'ping':
        debug('Executando handlePing...');
        handlePing();
        break;
        
      default:
        debug('Comando desconhecido:', message.command);
        sendError('Unknown command: ' + message.command, 'UNKNOWN_COMMAND');
    }

    debug('Comando processado, encerrando...');
    
    // Encerra após responder
    process.exit(0);
  } catch (error) {
    debug('Erro fatal:', error);
    sendError(error.message || error, 'FATAL_ERROR');
    process.exit(1);
  }
}

// Trata erros não capturados
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT ERROR:', error);
  sendError(error.message, 'UNCAUGHT_EXCEPTION');
  process.exit(1);
});

// Debug: log para stderr (não interfere com stdout)
function debug(...args) {
  console.error('[DEBUG]', ...args);
}

debug('Native host iniciando...');
debug('Session file path:', SESSION_FILE);
debug('Secrets file path:', getSecretsFile());

// Inicia
main().catch(error => {
  debug('Main error:', error);
  sendError(error.message, 'MAIN_ERROR');
  process.exit(1);
});
