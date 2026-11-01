const otplib = require('otplib');

// Simular exatamente como a aplicação faz
const secret = 'JBSWY3DPEHPK3PXP';
const options = { period: 30, digits: 6, algorithm: 'sha1' };

console.log('=== Teste da Aplicação Corrigida ===');

// Usando authenticator como na correção
const totpGenerator = otplib.authenticator;

try {
  const { period = 30, digits = 6, algorithm = 'sha1' } = options;
  
  // Configurar otplib
  totpGenerator.options = {
    digits,
    period,
    algorithm: algorithm.toLowerCase()
  };
  
  const code = totpGenerator.generate(secret);
  const epoch = Math.floor(Date.now() / 1000);
  const remaining = period - (epoch % period);
  
  console.log('✅ Código TOTP:', code);
  console.log('Tempo restante:', remaining + 's');
  
  // Verificar se o código é válido
  const isValid = totpGenerator.verify({ token: code, secret });
  console.log('Código válido:', isValid ? '✅ Sim' : '❌ Não');
  
} catch (error) {
  console.error('❌ Erro:', error.message);
}

console.log('\n=== Teste concluído ===');