const otplib = require('otplib');

const secret = 'JBSWY3DPEHPK3PXP';
const algorithm = 'SHA1';
const digits = 6;
const period = 30;

console.log('=== Diagnóstico TOTP ===');
console.log('Secret:', secret);
console.log('Current timestamp:', Math.floor(Date.now() / 1000));
console.log('Current time step:', Math.floor(Date.now() / 1000 / period));

// Teste com diferentes métodos do otplib
console.log('\n--- Métodos diferentes ---');

// Método 1: totp direto
try {
  otplib.totp.options = { digits, period, algorithm: algorithm.toLowerCase() };
  const code1 = otplib.totp.generate(secret);
  console.log('1. totp.generate():', code1);
} catch (e) {
  console.log('1. totp.generate() ERROR:', e.message);
}

// Método 2: authenticator
try {
  otplib.authenticator.options = { digits, period, algorithm: algorithm.toLowerCase() };
  const code2 = otplib.authenticator.generate(secret);
  console.log('2. authenticator.generate():', code2);
} catch (e) {
  console.log('2. authenticator.generate() ERROR:', e.message);
}

// Método 3: Verificar se há diferença na configuração
console.log('\n--- Configurações atuais ---');
console.log('totp.options:', otplib.totp.options);
console.log('authenticator.options:', otplib.authenticator.options);

// Teste de verificação
console.log('\n--- Testes de verificação ---');
const testCode1 = otplib.totp.generate(secret);
const testCode2 = otplib.authenticator.generate(secret);

console.log('Código totp:', testCode1);
console.log('Código authenticator:', testCode2);

// Verificar se os códigos são válidos
const verify1 = otplib.totp.verify({ token: testCode1, secret });
const verify2 = otplib.authenticator.verify({ token: testCode2, secret });

console.log('totp válido:', verify1);
console.log('authenticator válido:', verify2);

// Teste cruzado
const crossVerify1 = otplib.totp.verify({ token: testCode2, secret });
const crossVerify2 = otplib.authenticator.verify({ token: testCode1, secret });

console.log('totp verifica authenticator:', crossVerify1);
console.log('authenticator verifica totp:', crossVerify2);