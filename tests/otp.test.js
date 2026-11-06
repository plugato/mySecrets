// Códigos 2FA (src/lib/otp.js), usados pelo app e pelo MCP.
const { test } = require('node:test');
const assert = require('node:assert');
const { authenticator, hotp } = require('otplib');
const otp = require('../src/lib/otp');

const S = 'JBSWY3DPEHPK3PXP';
const AGORA = Date.UTC(2026, 10, 5, 12, 0, 10); // 10 s depois do início de um período de 30 e de 60

test('TOTP de 60 s usa o período de 60 s (antes saía o código de 30 s)', () => {
  const r = otp.generateTotp(S, { period: 60 }, AGORA);
  assert.strictEqual(r.code, authenticator.clone({ step: 60, epoch: AGORA }).generate(S));
  assert.notStrictEqual(r.code, authenticator.clone({ step: 30, epoch: AGORA + 30000 }).generate(S));
  assert.strictEqual(r.period, 60);
  assert.strictEqual(r.remaining, 50);
});

test('vetor do RFC 6238 (SHA-1, 8 dígitos, T=59)', () => {
  // segredo ASCII "12345678901234567890" em base32
  const rfc = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.strictEqual(otp.generateTotp(rfc, { digits: 8 }, 59000).code, '94287082');
});

test('hash e dígitos; tipo (totp/hotp) passado como hash vira sha1', () => {
  assert.strictEqual(otp.generateTotp(S, { algorithm: 'SHA256', digits: 8 }, AGORA).code,
    authenticator.clone({ algorithm: 'sha256', digits: 8, epoch: AGORA }).generate(S));
  assert.strictEqual(otp.generateTotp(S, { algorithm: 'totp' }, AGORA).code,
    authenticator.clone({ epoch: AGORA }).generate(S));
});

test('HOTP usa e avança o contador', () => {
  assert.deepStrictEqual(otp.generateHotp(S, 5), { code: hotp.generate(S, 5), counter: 6 });
});

test('verificação aceita o código atual e recusa outro', () => {
  const { code } = otp.generateTotp(S, { period: 60 }, AGORA);
  assert.strictEqual(otp.verifyTotp(code, S, { period: 60 }, AGORA), true);
  assert.strictEqual(otp.verifyTotp('000000', S, { period: 60 }, AGORA), code === '000000');
});
