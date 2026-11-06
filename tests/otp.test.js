// Códigos 2FA (src/lib/otp.js), usados pelo app e pelo MCP, contra uma
// implementação de referência do RFC (tests/helpers/rfc-otp.js).
const { test } = require('node:test');
const assert = require('node:assert');
const otp = require('../src/lib/otp');
const ref = require('./helpers/rfc-otp');

const S = 'JBSWY3DPEHPK3PXP'; // 80 bits: comum nos serviços reais
const AGORA = Date.UTC(2026, 10, 5, 12, 0, 10); // 10 s depois do início de um período de 30 e de 60

test('referência confere com o RFC 6238 (SHA-1, 8 dígitos, T=59)', () => {
  assert.strictEqual(ref.totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000, { digits: 8 }), '94287082');
});

test('vetor do RFC 6238 pelo módulo do app', () => {
  assert.strictEqual(otp.generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { digits: 8 }, 59000).code, '94287082');
});

test('segredo de 80 bits funciona (o otplib 13 recusaria por padrão)', () => {
  assert.strictEqual(otp.generateTotp(S, {}, AGORA).code, ref.totp(S, AGORA));
});

test('TOTP de 60 s usa o período de 60 s', () => {
  const r = otp.generateTotp(S, { period: 60 }, AGORA);
  assert.strictEqual(r.code, ref.totp(S, AGORA, { period: 60 }));
  assert.strictEqual(r.period, 60);
  assert.strictEqual(r.remaining, 50);
});

test('hash e dígitos; tipo (totp/hotp) passado como hash vira sha1', () => {
  assert.strictEqual(otp.generateTotp(S, { algorithm: 'SHA256', digits: 8 }, AGORA).code, ref.totp(S, AGORA, { algorithm: 'sha256', digits: 8 }));
  assert.strictEqual(otp.generateTotp(S, { algorithm: 'totp' }, AGORA).code, ref.totp(S, AGORA));
});

test('segredo colado como os sites mostram (minúsculas, espaços, hífens, "=")', () => {
  const esperado = ref.totp(S, AGORA);
  for (const variante of ['jbsw y3dp ehpk 3pxp', 'JBSW-Y3DP-EHPK-3PXP', 'JBSWY3DPEHPK3PXP====']) {
    assert.strictEqual(otp.generateTotp(variante, {}, AGORA).code, esperado, variante);
  }
});

test('HOTP usa e avança o contador', () => {
  assert.deepStrictEqual(otp.generateHotp(S, 5), { code: ref.hotp(S, 5), counter: 6 });
});

test('verificação aceita o código atual e recusa outro', () => {
  const { code } = otp.generateTotp(S, { period: 60 }, AGORA);
  assert.strictEqual(otp.verifyTotp(code, S, { period: 60 }, AGORA), true);
  const errado = code === '000000' ? '111111' : '000000';
  assert.strictEqual(otp.verifyTotp(errado, S, { period: 60 }, AGORA), false);
});

test('segredo inválido dá erro (não código inventado)', () => {
  assert.throws(() => otp.generateTotp('!!!!', {}, AGORA));
});
