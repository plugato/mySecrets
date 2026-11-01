const { contextBridge, ipcRenderer } = require('electron');

console.log('=== PRELOAD CARREGADO ===');

// Expor APIs seguras para o renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Operações de dados
  saveData: (data, masterPassword) => ipcRenderer.invoke('save-data', data, masterPassword),
  loadData: (masterPassword) => ipcRenderer.invoke('load-data', masterPassword),
  checkDataExists: () => ipcRenderer.invoke('check-data-exists'),
  resetData: () => ipcRenderer.invoke('reset-data'),
  
  // Utilidades
  generatePassword: (length = 16, includeSymbols = true) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const allChars = includeSymbols ? chars + symbols : chars;
    
    let password = '';
    for (let i = 0; i < length; i++) {
      password += allChars.charAt(Math.floor(Math.random() * allChars.length));
    }
    return password;
  },
  
  // Copiar para clipboard
  copyToClipboard: (text) => {
    navigator.clipboard.writeText(text);
  },
  
  // MFA básico para teste
  generateTOTP: (secret, options = {}) => {
    const { period = 30, digits = 6 } = options;
    const epoch = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epoch / period);
    
    // Algoritmo básico para teste
    const code = ((counter * 123456) % Math.pow(10, digits)).toString().padStart(digits, '0');
    const remaining = period - (epoch % period);
    
    return { code, remaining, period };
  },
  
  generateHOTP: (secret, counter, options = {}) => {
    const { digits = 6 } = options;
    const code = ((counter * 654321) % Math.pow(10, digits)).toString().padStart(digits, '0');
    return { code, counter: counter + 1 };
  }
});

console.log('=== ELECTRON API EXPOSTA ===');