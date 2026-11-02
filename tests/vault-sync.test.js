// Sincronização do cofre por pasta: mesclagem, lápides, cópias de conflito.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sync = require('../src/lib/vault-sync');

const e = (id, updatedAt, extra = {}) => ({ id, title: id, updatedAt, ...extra });

test('mescla por id ficando com a alteração mais recente', () => {
  const pc1 = [e('a', '2026-01-02T00:00:00Z', { title: 'A novo' }), e('b', '2026-01-01T00:00:00Z')];
  const pc2 = [e('a', '2026-01-01T00:00:00Z', { title: 'A velho' }), e('c', '2026-01-03T00:00:00Z')];
  const r = sync.mergeVaults([pc1, pc2]);
  assert.deepStrictEqual(r.map(x => x.id), ['a', 'b', 'c']);
  assert.strictEqual(r.find(x => x.id === 'a').title, 'A novo');
});

test('ida para a lixeira conta como alteração', () => {
  const pc1 = [e('a', '2026-01-01T00:00:00Z', { deletedAt: '2026-01-05T00:00:00Z' })];
  const pc2 = [e('a', '2026-01-03T00:00:00Z')];
  assert.ok(sync.mergeVaults([pc2, pc1])[0].deletedAt);
});

test('empate fica com a versão deste PC (primeira lista)', () => {
  const r = sync.mergeVaults([[e('a', '2026-01-01T00:00:00Z', { title: 'local' })], [e('a', '2026-01-01T00:00:00Z', { title: 'nuvem' })]]);
  assert.strictEqual(r[0].title, 'local');
});

test('lápide remove a entrada, a não ser que ela tenha sido editada depois', () => {
  const t = { a: '2026-01-05T00:00:00Z', b: '2026-01-05T00:00:00Z' };
  const r = sync.mergeVaults([[e('a', '2026-01-04T00:00:00Z'), e('b', '2026-01-06T00:00:00Z')]], t);
  assert.deepStrictEqual(r.map(x => x.id), ['b']);
});

test('removedIds e mergeTombstones', () => {
  assert.deepStrictEqual(sync.removedIds(new Set(['a', 'b', 'c']), [e('a'), e('c')]), ['b']);
  assert.deepStrictEqual(
    sync.mergeTombstones({ x: '2026-01-01T00:00:00Z' }, { x: '2026-02-01T00:00:00Z', y: '2026-01-01T00:00:00Z' }),
    { x: '2026-02-01T00:00:00Z', y: '2026-01-01T00:00:00Z' });
});

test('pasta MySecrets: estrutura, cópias de conflito e lápides', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-sync-'));
  try {
    const dir = sync.syncFolderFor(base);
    assert.strictEqual(path.basename(dir), 'MySecrets');
    assert.strictEqual(sync.syncFolderFor(dir), dir);

    sync.prepareSyncFolder(dir);
    assert.ok(fs.existsSync(path.join(dir, 'backups')));
    assert.ok(fs.existsSync(path.join(dir, 'LEIA-ME.txt')));

    for (const f of ['secrets.enc', 'secrets (1).enc', 'secrets_conflict-1.enc', 'secrets.enc (1)', '.secrets.enc.tmp', 'outro.enc']) {
      fs.writeFileSync(path.join(dir, f), '{}');
    }
    assert.deepStrictEqual(sync.findConflictCopies(dir).map(f => path.basename(f)).sort(),
      ['secrets (1).enc', 'secrets.enc (1)', 'secrets_conflict-1.enc']);

    fs.writeFileSync(path.join(dir, '.mysecrets-exclusoes.json'), JSON.stringify({ a: '2026-01-01T00:00:00Z' }));
    fs.writeFileSync(path.join(dir, '.mysecrets-exclusoes (1).json'), JSON.stringify({ b: '2026-01-02T00:00:00Z' }));
    const { tombstones, files } = sync.readTombstones(dir);
    assert.deepStrictEqual(Object.keys(tombstones).sort(), ['a', 'b']);
    sync.writeTombstones(dir, tombstones, files);
    assert.ok(!fs.existsSync(path.join(dir, '.mysecrets-exclusoes (1).json')));
    assert.deepStrictEqual(Object.keys(sync.readTombstones(dir).tombstones).sort(), ['a', 'b']);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('vault-location.json liga e desliga a pasta', () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-ud-'));
  try {
    assert.strictEqual(sync.readVaultLocation(ud), null);
    sync.writeVaultLocation(ud, '/drive/MySecrets');
    assert.strictEqual(sync.readVaultLocation(ud), '/drive/MySecrets');
    sync.writeVaultLocation(ud, null);
    assert.strictEqual(sync.readVaultLocation(ud), null);
  } finally {
    fs.rmSync(ud, { recursive: true, force: true });
  }
});

test('detecta o Google Drive para computador', () => {
  const existe = (alvo) => (p) => p === alvo;
  assert.strictEqual(sync.detectGoogleDrive({}, 'win32', existe('G:\\Meu Drive')), 'G:\\Meu Drive');
  assert.strictEqual(sync.detectGoogleDrive({}, 'win32', existe('H:\\My Drive')), 'H:\\My Drive');
  assert.strictEqual(sync.detectGoogleDrive({}, 'linux', () => false), null);
  assert.strictEqual(sync.detectGoogleDrive({}, 'linux', existe(path.join(os.homedir(), 'GoogleDrive'))),
    path.join(os.homedir(), 'GoogleDrive'));
});
