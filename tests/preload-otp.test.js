// Falha ao gerar o código 2FA não pode virar um código falso que pareça válido.
const { test } = require('node:test');
const assert = require('node:assert');
const { loadPreload } = require('./helpers/load-preload');

test('TOTP: erro do processo principal vira "ERRO", não 000000', async () => {
  const api = loadPreload({ invoke: async () => ({ success: false, error: 'segredo inválido' }) });
  const r = await api.generateTOTP('X');
  assert.strictEqual(r.code, 'ERRO');
  assert.strictEqual(r.error, 'segredo inválido');
});

test('TOTP: exceção no IPC também', async () => {
  const api = loadPreload({ invoke: async () => { throw new Error('ipc caiu'); } });
  const r = await api.generateTOTP('X');
  assert.strictEqual(r.code, 'ERRO');
});

test('HOTP: erro não avança o contador', async () => {
  const api = loadPreload({ invoke: async () => ({ success: false, error: 'x' }) });
  const r = await api.generateHOTP('X', 7);
  assert.deepStrictEqual({ code: r.code, counter: r.counter }, { code: 'ERRO', counter: 7 });
});

test('sucesso continua igual', async () => {
  const api = loadPreload({ invoke: async () => ({ success: true, code: '123456', remaining: 10, period: 30 }) });
  assert.deepStrictEqual(await api.generateTOTP('X'), { code: '123456', remaining: 10, period: 30 });
});
