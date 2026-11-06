// Senhas vazadas: só o prefixo de 5 caracteres do SHA-1 sai do computador.
const { test } = require('node:test');
const assert = require('node:assert');
const { fetchRange, parseRange } = require('../src/lib/pwned');

test('consulta só o prefixo, com preenchimento', async () => {
  let chamado;
  const fetchImpl = async (url, opts) => { chamado = { url, opts }; return { ok: true, text: async () => 'x' }; };
  assert.strictEqual(await fetchRange('5baa6', { fetchImpl }), 'x');
  assert.strictEqual(chamado.url, 'https://api.pwnedpasswords.com/range/5BAA6');
  assert.strictEqual(chamado.opts.headers['Add-Padding'], 'true');
});

test('recusa qualquer coisa que não seja um prefixo de 5 hex (nunca a senha ou o hash inteiro)', async () => {
  const fetchImpl = async () => { throw new Error('não devia chamar'); };
  for (const ruim of ['senha123', '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8', '5BAA', '5BAA6/../x', '', null]) {
    await assert.rejects(fetchRange(ruim, { fetchImpl }), /Prefixo inválido/);
  }
});

test('erro HTTP vira mensagem', async () => {
  await assert.rejects(fetchRange('ABCDE', { fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
});

test('lê as linhas e ignora lixo', () => {
  const m = parseRange('1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n0018A45C4D1DEF81644B54AB7F969B88D65:0\nlixo\n');
  assert.strictEqual(m.get('1E4C9B93F3F0682250B6CF8331B7EE68FD8'), 9545824);
  assert.strictEqual(m.get('0018A45C4D1DEF81644B54AB7F969B88D65'), 0);
  assert.strictEqual(m.size, 2);
});
