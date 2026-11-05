// Importar backup: confere o arquivo antes de trocar o cofre.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { encryptVault } = require('../src/lib/vault-crypto');
const { inspectBackup } = require('../src/lib/vault-backup');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-backup-'));
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

function arquivo(nome, conteudo) {
  const p = path.join(DIR, nome);
  fs.writeFileSync(p, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
  return p;
}

const ENTRADAS = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];

test('backup com a senha atual: abre e conta as entradas', () => {
  const p = arquivo('ok.enc', encryptVault(JSON.stringify(ENTRADAS), 'atual'));
  assert.deepStrictEqual(inspectBackup(p, 'atual'), { ok: true, opensWithCurrent: true, count: 2 });
});

test('backup com outra senha: avisa (não bloqueia)', () => {
  const p = arquivo('outra.enc', encryptVault(JSON.stringify(ENTRADAS), 'antiga'));
  assert.deepStrictEqual(inspectBackup(p, 'atual'), { ok: true, opensWithCurrent: false });
});

test('cofre bloqueado: não dá para testar a senha', () => {
  const p = arquivo('bloq.enc', encryptVault(JSON.stringify(ENTRADAS), 'atual'));
  assert.deepStrictEqual(inspectBackup(p, null), { ok: true, opensWithCurrent: null });
});

test('arquivo que não é cofre é recusado', () => {
  assert.strictEqual(inspectBackup(arquivo('texto.enc', 'não sou json'), 'atual').ok, false);
  assert.strictEqual(inspectBackup(arquivo('json.enc', { foo: 1 }), 'atual').ok, false);
  assert.strictEqual(inspectBackup(path.join(DIR, 'nao-existe.enc'), 'atual').ok, false);
  const naoLista = arquivo('obj.enc', encryptVault(JSON.stringify({ x: 1 }), 'atual'));
  assert.match(inspectBackup(naoLista, 'atual').error, /não é um cofre/);
});

test('backup adulterado com iterações absurdas é recusado sem travar', () => {
  const enc = encryptVault(JSON.stringify(ENTRADAS), 'atual');
  const p = arquivo('dos.enc', { ...enc, iterations: 1e12 });
  const t0 = Date.now();
  const r = inspectBackup(p, 'atual');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /corrompido|adulterado/);
  assert.ok(Date.now() - t0 < 1000);
});
