const { test } = require('node:test');
const assert = require('node:assert');
const {
  encryptVault,
  decryptVault,
  encryptVaultLegacy,
  isLegacyFormat,
  V2_ITERATIONS
} = require('../src/lib/vault-crypto');

const PASSWORD = 'senha-mestra-de-teste-123!';
const PAYLOAD = JSON.stringify([
  { id: 'a1', title: 'Conta çãé "aspas" \'simples\'', password: 'p@ss' },
  { id: 'b2', title: 'MFA', mfaSecret: 'JBSWY3DPEHPK3PXP' }
]);

test('v2: criptografa e descriptografa (roundtrip)', () => {
  const enc = encryptVault(PAYLOAD, PASSWORD);
  assert.strictEqual(enc.version, 2);
  assert.strictEqual(enc.algorithm, 'aes-256-gcm');
  assert.strictEqual(enc.iterations, V2_ITERATIONS);
  assert.ok(enc.authTag && enc.salt && enc.iv && enc.encrypted);

  const dec = decryptVault(enc, PASSWORD);
  assert.strictEqual(dec, PAYLOAD);
});

test('v2: senha errada lança erro', () => {
  const enc = encryptVault(PAYLOAD, PASSWORD);
  assert.throws(() => decryptVault(enc, 'senha-errada'));
});

test('v2: adulteração do arquivo é detectada (GCM)', () => {
  const enc = encryptVault(PAYLOAD, PASSWORD);
  // flipar um byte do ciphertext
  const bytes = Buffer.from(enc.encrypted, 'hex');
  bytes[0] ^= 0xff;
  const tampered = { ...enc, encrypted: bytes.toString('hex') };
  assert.throws(() => decryptVault(tampered, PASSWORD));
});

test('v2: adulteração do authTag é detectada', () => {
  const enc = encryptVault(PAYLOAD, PASSWORD);
  const tag = Buffer.from(enc.authTag, 'hex');
  tag[0] ^= 0xff;
  assert.throws(() => decryptVault({ ...enc, authTag: tag.toString('hex') }, PASSWORD));
});

test('v1 legado (CBC): ainda é legível para migração', () => {
  const legacy = encryptVaultLegacy(PAYLOAD, PASSWORD);
  assert.ok(isLegacyFormat(legacy));
  const dec = decryptVault(legacy, PASSWORD);
  assert.strictEqual(dec, PAYLOAD);
});

test('v1 legado: senha errada lança erro', () => {
  const legacy = encryptVaultLegacy(PAYLOAD, PASSWORD);
  assert.throws(() => decryptVault(legacy, 'senha-errada'));
});

test('isLegacyFormat distingue os formatos', () => {
  assert.strictEqual(isLegacyFormat(encryptVaultLegacy('x', 'p')), true);
  assert.strictEqual(isLegacyFormat(encryptVault('x', 'p')), false);
});

test('formato inválido lança erro', () => {
  assert.throws(() => decryptVault({}, PASSWORD));
  assert.throws(() => decryptVault({ encrypted: 'aa' }, PASSWORD));
});

test('salt/iv únicos por criptografia', () => {
  const a = encryptVault(PAYLOAD, PASSWORD);
  const b = encryptVault(PAYLOAD, PASSWORD);
  assert.notStrictEqual(a.salt, b.salt);
  assert.notStrictEqual(a.iv, b.iv);
  assert.notStrictEqual(a.encrypted, b.encrypted);
});

test('payload unicode/emoji sobrevive ao roundtrip', () => {
  const unicode = JSON.stringify({ title: '🔐 Cofre — ção £¥€' });
  const enc = encryptVault(unicode, PASSWORD);
  assert.strictEqual(decryptVault(enc, PASSWORD), unicode);
});
