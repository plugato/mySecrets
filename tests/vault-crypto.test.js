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

test('v1 legado: senha errada não revela o conteúdo', () => {
  // CBC não é autenticado: a senha errada costuma falhar no padding, mas em
  // ~1/256 das vezes o padding "confere" por acaso e sai lixo (o app trata
  // como senha errada quando o JSON.parse falha). Nunca sai o conteúdo.
  const legacy = encryptVaultLegacy(PAYLOAD, PASSWORD);
  let saida = null;
  try { saida = decryptVault(legacy, 'senha-errada'); } catch (_) { /* esperado na maioria das vezes */ }
  assert.notStrictEqual(saida, PAYLOAD);
  if (saida !== null) assert.throws(() => JSON.parse(saida));
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

test('v2: número de iterações fora do limite é recusado antes de derivar a chave', () => {
  const enc = encryptVault(PAYLOAD, PASSWORD);
  for (const iterations of [1e12, 2 ** 31, 999, 0.5, -1, '600000']) {
    const t0 = Date.now();
    assert.throws(() => decryptVault({ ...enc, iterations }, PASSWORD), /iterações/);
    assert.ok(Date.now() - t0 < 1000, 'falha rápido, sem derivar a chave');
  }
});

// ===== Cache da chave derivada =====

const { createKeyCache } = require('../src/lib/vault-crypto');

test('cache: gravar reaproveita a chave (rápido) e o arquivo abre sem cache', () => {
  const c = createKeyCache();
  const a = c.encrypt(PAYLOAD, PASSWORD);           // 1ª: deriva
  const t0 = Date.now();
  const b = c.encrypt(PAYLOAD, PASSWORD);           // 2ª: sem PBKDF2
  assert.ok(Date.now() - t0 < 50, 'segunda gravação não deriva a chave');
  assert.strictEqual(a.salt, b.salt);
  assert.notStrictEqual(a.iv, b.iv, 'IV novo a cada gravação');
  assert.strictEqual(decryptVault(b, PASSWORD), PAYLOAD, 'formato idêntico ao normal');
  assert.strictEqual(c.decrypt(b, PASSWORD), PAYLOAD);
});

test('cache: prime assíncrono e depois decrypt sem derivar', async () => {
  const enc = encryptVault(PAYLOAD, PASSWORD);
  const c = createKeyCache();
  await c.prime(enc, PASSWORD);
  const t0 = Date.now();
  assert.strictEqual(c.decrypt(enc, PASSWORD), PAYLOAD);
  assert.ok(Date.now() - t0 < 50);
  // Depois de abrir, gravar usa o mesmo salt do arquivo
  assert.strictEqual(c.encrypt('x', PASSWORD).salt, enc.salt);
});

test('cache: senha errada falha e não estraga o cache; troca de senha gera outro salt', () => {
  const c = createKeyCache();
  const enc = c.encrypt(PAYLOAD, PASSWORD);
  assert.throws(() => c.decrypt(enc, 'errada'));
  assert.strictEqual(c.decrypt(enc, PASSWORD), PAYLOAD);
  const nova = c.encrypt(PAYLOAD, 'outra-senha');
  assert.notStrictEqual(nova.salt, enc.salt);
  assert.strictEqual(decryptVault(nova, 'outra-senha'), PAYLOAD);
  assert.throws(() => decryptVault(nova, PASSWORD));
});

test('cache: clear esquece a chave; legado e iterações absurdas continuam tratados', () => {
  const c = createKeyCache();
  const enc = c.encrypt(PAYLOAD, PASSWORD);
  c.clear();
  assert.strictEqual(c.decrypt(enc, PASSWORD), PAYLOAD, 'deriva de novo');
  assert.strictEqual(c.decrypt(encryptVaultLegacy(PAYLOAD, PASSWORD), PASSWORD), PAYLOAD);
  assert.throws(() => c.decrypt({ ...enc, iterations: 1e12 }, PASSWORD), /iterações/);
});
