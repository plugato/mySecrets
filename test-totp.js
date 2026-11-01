const otplib = require('otplib');

// URI fornecido
const otpauthUri = 'otpauth://totp/usuario%2Eteste%40EXEMPLO?secret=JBSWY3DPEHPK3PXP&issuer=Exemplo&algorithm=SHA1&digits=6&period=30';

console.log('=== Teste Completo TOTP ===');
console.log('URI:', otpauthUri);

// Parse do URI
const url = new URL(otpauthUri);
const secret = url.searchParams.get('secret');
const algorithm = url.searchParams.get('algorithm') || 'SHA1';
const digits = parseInt(url.searchParams.get('digits')) || 6;
const period = parseInt(url.searchParams.get('period')) || 30;

console.log('\n--- Parâmetros ---');
console.log('Secret:', secret);
console.log('Algorithm:', algorithm);
console.log('Digits:', digits);
console.log('Period:', period);

// Teste 1: Configuração padrão do otplib
console.log('\n--- Teste 1: Configuração Padrão ---');
try {
  otplib.totp.options = {
    digits: digits,
    period: period,
    algorithm: algorithm.toLowerCase()
  };
  
  const code1 = otplib.totp.generate(secret);
  console.log('Código gerado:', code1);
  
  const epoch = Math.floor(Date.now() / 1000);
  const remaining = period - (epoch % period);
  console.log('Tempo restante:', remaining + 's');
  
} catch (error) {
  console.error('Erro no teste 1:', error.message);
}

// Teste 2: Usando authenticator (mais compatível)
console.log('\n--- Teste 2: Usando Authenticator ---');
try {
  const { authenticator } = otplib;
  
  authenticator.options = {
    digits: digits,
    period: period,
    algorithm: algorithm.toLowerCase()
  };
  
  const code2 = authenticator.generate(secret);
  console.log('Código gerado (authenticator):', code2);
  
} catch (error) {
  console.error('Erro no teste 2:', error.message);
}

// Teste 3: Validação com diferentes janelas de tempo
console.log('\n--- Teste 3: Diferentes Momentos ---');
try {
  const now = Math.floor(Date.now() / 1000);
  
  for (let offset = -1; offset <= 1; offset++) {
    const timeStep = Math.floor((now + (offset * period)) / period);
    console.log(`Time step ${offset}: ${timeStep}`);
    
    // Manual calculation for verification
    const crypto = require('crypto');
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32BE(timeStep, 4);
    
    // Decode base32 secret
    const base32 = require('hi-base32');
    const key = base32.decode(secret);
    
    const hmac = crypto.createHmac('sha1', key);
    hmac.update(buffer);
    const hash = hmac.digest();
    
    const offset_bits = hash[hash.length - 1] & 0xf;
    const code = ((hash[offset_bits] & 0x7f) << 24) |
                 ((hash[offset_bits + 1] & 0xff) << 16) |
                 ((hash[offset_bits + 2] & 0xff) << 8) |
                 (hash[offset_bits + 3] & 0xff);
    
    const finalCode = (code % Math.pow(10, digits)).toString().padStart(digits, '0');
    console.log(`Código manual para step ${offset}: ${finalCode}`);
  }
} catch (error) {
  console.error('Erro no teste 3:', error.message);
}

console.log('\n=== Teste concluído ===');