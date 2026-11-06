// Códigos OTP gerados pelo MCP (mcp-server/vault.js) para entradas do cofre.
const { test } = require('node:test');
const assert = require('node:assert');
const ref = require('./helpers/rfc-otp');
const { generateOtp } = require('../mcp-server/vault');

const SECRET = 'JBSWY3DPEHPK3PXP';

function esperadoTotp(algorithm, digits = 6, period = 30) {
  return ref.totp(SECRET, Date.now(), { algorithm, digits, period });
}

test('entrada sem mfaHash (só mfaAlgorithm: totp) usa sha1 em vez de falhar', () => {
  const r = generateOtp({ mfaSecret: SECRET, mfaAlgorithm: 'totp' });
  assert.strictEqual(r.code, esperadoTotp('sha1'));
  assert.strictEqual(r.period, 30);
});

test('mfaHash sha256 e 8 dígitos são respeitados', () => {
  const r = generateOtp({ mfaSecret: SECRET, mfaAlgorithm: 'totp', mfaHash: 'SHA256', mfaDigits: 8 });
  assert.strictEqual(r.code, esperadoTotp('sha256', 8));
});

test('HOTP sem mfaHash usa sha1 e o contador', () => {
  const r = generateOtp({ mfaSecret: SECRET, mfaAlgorithm: 'hotp', mfaCounter: 3 });
  assert.strictEqual(r.code, ref.hotp(SECRET, 3));
  assert.strictEqual(r.counter, 4);
});
