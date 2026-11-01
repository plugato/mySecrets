const otplib = require('otplib');

// Simular exatamente como seu main.js faz agora
let totpGenerator = otplib.authenticator; // Como na correção

// Seu secret
const secret = 'JBSWY3DPEHPK3PXP';
const options = { period: 30, digits: 6, algorithm: 'sha1' };

console.log('=== Simulação Exata da Aplicação ===');

// Simular o handler generate-totp
async function simulateGenerateTotp(secret, options = {}) {
  try {
    const { period = 30, digits = 6, algorithm = 'sha1' } = options;
    
    if (totpGenerator) {
      // Configurar otplib exatamente como no main.js
      totpGenerator.options = {
        digits,
        period,
        algorithm: algorithm.toLowerCase()
        // Não definir encoding - otplib usa base32 por padrão
      };
      
      const code = totpGenerator.generate(secret);
      const epoch = Math.floor(Date.now() / 1000);
      const remaining = period - (epoch % period);
      
      return { success: true, code, remaining, period };
    } else {
      return { success: false, error: 'totpGenerator não disponível' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Executar o teste
simulateGenerateTotp(secret, options)
  .then(result => {
    if (result.success) {
      console.log('✅ Código TOTP da aplicação:', result.code);
      console.log('Tempo restante:', result.remaining + 's');
      console.log('Período:', result.period + 's');
    } else {
      console.log('❌ Erro:', result.error);
    }
    
    // Comparar com authenticator direto
    console.log('\n--- Comparação ---');
    otplib.authenticator.options = {
      digits: 6,
      period: 30,
      algorithm: 'sha1'
    };
    
    const directCode = otplib.authenticator.generate(secret);
    console.log('Código direto do authenticator:', directCode);
    
    if (result.success) {
      console.log('Códigos iguais:', result.code === directCode ? '✅ Sim' : '❌ Não');
    }
  });