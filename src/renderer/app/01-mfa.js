// MySecrets (renderer) - Geração dos códigos 2FA (via processo principal).
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

// Implementação de MFA com suporte a diferentes algoritmos usando otplib
class MFA {
    static async generateTOTP(secret, period = 30, digits = 6, algorithm = 'sha1') {
        if (!window.electronAPI || !window.electronAPI.generateTOTP) {
            console.error('API do Electron não disponível');
            return { code: 'ERRO', error: 'API indisponível', remaining: 30, period };
        }
        
        return await window.electronAPI.generateTOTP(secret, { period, digits, algorithm });
    }
    
    static async generateHOTP(secret, counter = 0, digits = 6, algorithm = 'sha1') {
        if (!window.electronAPI || !window.electronAPI.generateHOTP) {
            console.error('API do Electron não disponível');
            return { code: 'ERRO', error: 'API indisponível', counter };
        }
        
        return await window.electronAPI.generateHOTP(secret, counter, { digits, algorithm });
    }
    
    static async generate(entry) {
        const { 
            mfaSecret, 
            mfaAlgorithm = 'totp', 
            mfaPeriod = 30, 
            mfaDigits = 6, 
            mfaCounter = 0, 
            mfaHash = 'sha1' 
        } = entry;
        
        console.log('MFA.generate - mfaHash:', mfaHash, 'typeof:', typeof mfaHash);
        
        if (mfaAlgorithm === 'hotp') {
            return await this.generateHOTP(mfaSecret, mfaCounter, mfaDigits, mfaHash);
        } else {
            return await this.generateTOTP(mfaSecret, mfaPeriod, mfaDigits, mfaHash);
        }
    }
    
    static async verifyTOTP(code, entry) {
        if (!window.electronAPI || !window.electronAPI.verifyTOTP) {
            console.error('API do Electron não disponível');
            return false;
        }
        
        const { mfaSecret, mfaPeriod = 30, mfaDigits = 6, mfaHash = 'sha1' } = entry;
        return await window.electronAPI.verifyTOTP(code, mfaSecret, { 
            period: mfaPeriod, 
            digits: mfaDigits, 
            algorithm: mfaHash 
        });
    }
}
