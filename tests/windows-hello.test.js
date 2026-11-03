// Windows Hello: o IID usado no interop (RequestVerificationForWindowAsync)
// tem que bater com o GUID paramétrico que o WinRT calcula para
// IAsyncOperation<UserConsentVerificationResult>. Errado, o Windows recusa a
// chamada e o app cai no caminho antigo, sem avisar.

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Algoritmo do WinRT para interfaces genéricas: UUID v5 (SHA-1) da assinatura
function winrtParametricIid(signature) {
  const ns = Buffer.from('11f47ad57b7342c0abae878b1e16adee', 'hex');
  const h = crypto.createHash('sha1').update(Buffer.concat([ns, Buffer.from(signature, 'utf8')])).digest().subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return [x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20)].join('-');
}

const IASYNC_OPERATION = '{9fc2b0bb-e446-44e2-aa61-9cab8f636af2}';

test('algoritmo confere com um IID publicado (IAsyncOperation<bool>)', () => {
  assert.strictEqual(winrtParametricIid(`pinterface(${IASYNC_OPERATION};b1)`), 'cdb5efb3-5788-509d-9be1-71ccb8a3362a');
});

test('HELLO_ASYNC_OP_IID é o IID de IAsyncOperation<UserConsentVerificationResult>', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const m = /const HELLO_ASYNC_OP_IID = '([0-9a-f-]{36})'/.exec(main);
  assert.ok(m, 'constante não encontrada em src/main.js');
  const esperado = winrtParametricIid(
    `pinterface(${IASYNC_OPERATION};enum(Windows.Security.Credentials.UI.UserConsentVerificationResult;i4))`
  );
  assert.strictEqual(m[1], esperado);
});
