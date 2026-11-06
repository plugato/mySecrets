const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload.js sendo carregado...');

// Expor APIs seguras para o renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Operações de dados
  saveData: (data, masterPassword, options) => ipcRenderer.invoke('save-data', data, masterPassword, options || {}),
  loadData: (masterPassword) => ipcRenderer.invoke('load-data', masterPassword),
  checkDataExists: () => ipcRenderer.invoke('check-data-exists'),
  resetData: () => ipcRenderer.invoke('reset-data'),

  // Sessão (extensão Chrome / servidor MCP)
  refreshSession: () => ipcRenderer.invoke('refresh-session'),
  lock: () => ipcRenderer.invoke('lock'),
  onSystemLock: (callback) => ipcRenderer.on('system-lock', () => callback()),

  // Backups
  exportBackup: () => ipcRenderer.invoke('export-backup'),
  importBackup: () => ipcRenderer.invoke('import-backup'),
  listBackups: () => ipcRenderer.invoke('list-backups'),

  // Sincronização do cofre (Google Drive ou outra pasta sincronizada)
  syncStatus: () => ipcRenderer.invoke('sync-status'),
  syncChooseFolder: () => ipcRenderer.invoke('sync-choose-folder'),
  syncEnable: (baseDir, masterPassword) => ipcRenderer.invoke('sync-enable', baseDir, masterPassword),
  syncDisable: () => ipcRenderer.invoke('sync-disable'),
  onVaultChanged: (callback) => ipcRenderer.on('vault-changed', () => callback()),

  // Sincronização com login do Google (Google Drive API)
  gdriveStatus: () => ipcRenderer.invoke('gdrive-status'),
  gdriveConnect: (masterPassword) => ipcRenderer.invoke('gdrive-connect', masterPassword),
  gdriveSyncNow: (masterPassword) => ipcRenderer.invoke('gdrive-sync-now', masterPassword),
  gdriveDisconnect: () => ipcRenderer.invoke('gdrive-disconnect'),
  onGdriveStatus: (callback) => ipcRenderer.on('gdrive-status', (event, data) => callback(data)),

  // Atalho global (Ctrl+Shift+M) — opcional, registrado com atraso pelo main
  setGlobalShortcut: (enabled) => ipcRenderer.invoke('set-global-shortcut', enabled),

  // Atualizações automáticas
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, data) => callback(data)),

  // Windows Hello (login por digital/biometria)
  helloStatus: () => ipcRenderer.invoke('hello-status'),
  helloEnroll: (masterPassword) => ipcRenderer.invoke('hello-enroll', masterPassword),
  helloLogin: () => ipcRenderer.invoke('hello-login'),
  helloDisable: () => ipcRenderer.invoke('hello-disable'),
  helloCancel: () => ipcRenderer.invoke('hello-cancel'),

  // Celular Android (aprovar o login no celular, mesma rede Wi-Fi)
  phoneStatus: () => ipcRenderer.invoke('phone-status'),
  phonePairStart: (masterPassword) => ipcRenderer.invoke('phone-pair-start', masterPassword),
  phonePairWait: () => ipcRenderer.invoke('phone-pair-wait'),
  phoneCancel: () => ipcRenderer.invoke('phone-cancel'),
  phoneUnpair: (pairId) => ipcRenderer.invoke('phone-unpair', pairId),
  phoneUnlock: () => ipcRenderer.invoke('phone-unlock'),
  onPhoneUnlockStatus: (callback) => ipcRenderer.on('phone-unlock-status', (event, data) => callback(data)),
  onPhonePairStatus: (callback) => ipcRenderer.on('phone-pair-status', (event, text) => callback(text)),

  // Servidor MCP (integração com assistentes de IA)
  mcpStatus: () => ipcRenderer.invoke('mcp-status'),
  mcpStart: (options) => ipcRenderer.invoke('mcp-start', options),
  mcpStop: () => ipcRenderer.invoke('mcp-stop'),
  onMcpStopped: (callback) => ipcRenderer.on('mcp-stopped', (event, data) => callback(data)),
  // Extensão pedindo para salvar um login (via servidor local)
  onExtensionSaveLogin: (callback) => ipcRenderer.on('extension-save-login', (event, data) => callback(data)),
  extensionSaveResult: (reqId, result) => ipcRenderer.invoke('extension-save-result', reqId, result),
  // Agente (MCP) pedindo para gravar: resumo para o diálogo e, aprovado, gravação
  onAgentWrite: (callback) => ipcRenderer.on('agent-write', (event, data) => callback(data)),
  agentWriteResult: (reqId, result) => ipcRenderer.invoke('agent-write-result', reqId, result),
  onAgentWriteCancel: (callback) => ipcRenderer.on('agent-write-cancel', (event, jobId) => callback(jobId)),
  onAgentWriteCount: (callback) => ipcRenderer.on('agent-write-count', (event, n) => callback(n)),

  // Anexos de arquivo (seletor e "Salvar como" ficam no processo principal)
  attachmentPick: () => ipcRenderer.invoke('attachment-pick'),
  attachmentSave: (attachment) => ipcRenderer.invoke('attachment-save', attachment),
  
  // Senhas vazadas: só o prefixo de 5 caracteres do SHA-1 vai ao processo principal
  pwnedRange: (prefix) => ipcRenderer.invoke('pwned-range', prefix),

  // Utilidades
  // Usa o gerador criptográfico (crypto.getRandomValues). Descarta os bytes
  // acima do maior múltiplo do tamanho do alfabeto (rejection sampling) para
  // que todos os caracteres tenham a mesma chance, sem viés de módulo.
  generatePassword: (length = 16, includeSymbols = true) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const allChars = includeSymbols ? chars + symbols : chars;
    const n = Math.min(1024, Math.max(0, Math.floor(Number(length) || 0)));
    const limit = 256 - (256 % allChars.length);

    let password = '';
    const buf = new Uint8Array(64);
    while (password.length < n) {
      crypto.getRandomValues(buf);
      for (let i = 0; i < buf.length && password.length < n; i++) {
        if (buf[i] < limit) password += allChars[buf[i] % allChars.length];
      }
    }
    return password;
  },
  
  // Copiar para clipboard (com limpeza automática opcional após N segundos)
  copyToClipboard: (text, clearAfterSeconds = 0) => {
    return ipcRenderer.invoke('copy-to-clipboard', text, clearAfterSeconds);
  },
  
  // Funções MFA via IPC
  generateTOTP: async (secret, options = {}) => {
    try {
      const result = await ipcRenderer.invoke('generate-totp', secret, options);
      if (result.success) {
        return { code: result.code, remaining: result.remaining, period: result.period };
      } else {
        console.error('Erro no TOTP:', result.error);
        // Nunca um código falso que pareça válido (000000 podia ser copiado)
        return { code: 'ERRO', error: result.error || 'Falha ao gerar o código', remaining: 30, period: 30 };
      }
    } catch (error) {
      console.error('Erro ao gerar TOTP:', error);
      return { code: 'ERRO', error: error.message, remaining: 30, period: 30 };
    }
  },
  
  generateHOTP: async (secret, counter, options = {}) => {
    try {
      const result = await ipcRenderer.invoke('generate-hotp', secret, counter, options);
      if (result.success) {
        return { code: result.code, counter: result.counter };
      } else {
        console.error('Erro no HOTP:', result.error);
        return { code: 'ERRO', error: result.error || 'Falha ao gerar o código', counter };
      }
    } catch (error) {
      console.error('Erro ao gerar HOTP:', error);
      return { code: 'ERRO', error: error.message, counter };
    }
  },
  
  // Verificar se um código TOTP é válido
  verifyTOTP: async (token, secret, options = {}) => {
    try {
      const result = await ipcRenderer.invoke('verify-totp', token, secret, options);
      if (result.success) {
        console.log('Verificação TOTP:', result);
        return result.isValid;
      } else {
        console.error('Erro na verificação TOTP:', result.error);
        return false;
      }
    } catch (error) {
      console.error('Erro ao verificar TOTP:', error);
      return false;
    }
  }
});

console.log('electronAPI exposta com sucesso!');