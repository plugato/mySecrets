// Sincronização com o Google Drive (src/lib/gdrive-sync.js) contra um Drive
// simulado: exclusões não se perdem, edições feitas durante a rodada não são
// sobrescritas e envios concorrentes de outro aparelho são mesclados.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { syncWithRetry, syncOnce } = require('../src/lib/gdrive-sync');
const vaultSync = require('../src/lib/vault-sync');

const PW = 'senha';
// Cifra de mentira (rápida); confere a senha como a de verdade
const encrypt = (text, pw) => ({ pw, text });
const decrypt = (obj, pw) => { if (obj.pw !== pw) throw new Error('senha'); return obj.text; };
const hash = (entries) => crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

const T = (min) => new Date(Date.UTC(2026, 10, 5, 12, min)).toISOString();

function fakeDrive() {
  const files = new Map(); // name -> { id, content, md5Checksum }
  let n = 0;
  const drive = {
    files,
    hooks: { beforeDownload: null, beforeFind: null },
    uploads: [],
    put(name, content) {
      const f = files.get(name) || { id: `id${++n}` };
      Object.assign(f, { content, md5Checksum: md5(content) });
      files.set(name, f);
      return f;
    },
    putVault(entries) { return drive.put(vaultSync.VAULT_FILE, JSON.stringify(encrypt(JSON.stringify(entries), PW))); },
    vault() { const f = files.get(vaultSync.VAULT_FILE); return f ? JSON.parse(decrypt(JSON.parse(f.content), PW)) : null; },
    tombs() { const f = files.get(vaultSync.TOMBSTONES_FILE); return f ? JSON.parse(f.content) : null; },
    client: {
      async ensureFolder() { return 'pasta'; },
      async findFile(name) {
        if (drive.hooks.beforeFind) await drive.hooks.beforeFind(name);
        const f = files.get(name);
        return f ? { id: f.id, md5Checksum: f.md5Checksum } : null;
      },
      async download(id) {
        const [name, f] = [...files.entries()].find(([, v]) => v.id === id);
        if (drive.hooks.beforeDownload) await drive.hooks.beforeDownload(name);
        return f.content;
      },
      async upload(name, folderId, content) {
        drive.uploads.push(name);
        const f = drive.put(name, content);
        return { id: f.id, md5Checksum: f.md5Checksum };
      }
    }
  };
  return drive;
}

function fakeLocal(entries = [], tombstones = {}) {
  const local = { entries, tombstones, writes: 0 };
  local.deps = {
    readLocal: () => JSON.parse(JSON.stringify(local.entries)),
    writeLocal: (e) => { local.entries = e; local.writes++; },
    readLocalTombs: () => ({ tombstones: { ...local.tombstones }, files: [] }),
    writeLocalTombs: (t) => { local.tombstones = t; }
  };
  return local;
}

function run(drive, local, state = { folderId: 'pasta' }) {
  return syncWithRetry({ client: drive.client, password: PW, state, folderName: 'MySecrets', ...local.deps, encrypt, decrypt, hash });
}

const ids = (list) => list.map((e) => e.id).sort();

test('mescla nos dois sentidos', async () => {
  const drive = fakeDrive();
  drive.putVault([{ id: 'r', title: 'Remota', updatedAt: T(1) }]);
  const local = fakeLocal([{ id: 'l', title: 'Local', updatedAt: T(2) }]);
  const r = await run(drive, local);
  assert.deepStrictEqual(ids(local.entries), ['l', 'r']);
  assert.deepStrictEqual(ids(drive.vault()), ['l', 'r']);
  assert.strictEqual(r.localChanged, true);
});

test('D1: falha ao baixar as exclusões da nuvem interrompe sem sobrescrevê-las', async () => {
  const drive = fakeDrive();
  drive.putVault([{ id: 'x', updatedAt: T(1) }]);
  drive.put(vaultSync.TOMBSTONES_FILE, JSON.stringify({ apagadaNoCelular: T(5) }));
  drive.hooks.beforeDownload = (name) => { if (name === vaultSync.TOMBSTONES_FILE) throw new Error('rede caiu'); };
  const local = fakeLocal([{ id: 'apagadaNoCelular', updatedAt: T(1) }], { apagadaAqui: T(3) });

  await assert.rejects(run(drive, local), /rede caiu/);
  assert.deepStrictEqual(drive.tombs(), { apagadaNoCelular: T(5) }, 'lista remota intacta');
  assert.deepStrictEqual(drive.uploads, [], 'nada enviado');
  assert.strictEqual(local.writes, 0);
});

test('D1: lista de exclusões ilegível na nuvem interrompe sem sobrescrevê-la', async () => {
  const drive = fakeDrive();
  drive.put(vaultSync.TOMBSTONES_FILE, '{ meio arquivo');
  const local = fakeLocal([{ id: 'a', updatedAt: T(1) }], { b: T(2) });
  await assert.rejects(run(drive, local), /ilegível/);
  assert.strictEqual(drive.files.get(vaultSync.TOMBSTONES_FILE).content, '{ meio arquivo');
  assert.deepStrictEqual(drive.uploads, []);
});

test('erro de rede ao baixar o cofre não é confundido com outra senha', async () => {
  const drive = fakeDrive();
  drive.putVault([{ id: 'x', updatedAt: T(1) }]);
  drive.hooks.beforeDownload = (name) => { if (name === vaultSync.VAULT_FILE) throw new Error('ETIMEDOUT'); };
  await assert.rejects(run(drive, fakeLocal()), /ETIMEDOUT/);
});

test('D2: edição salva enquanto a rede respondia não é sobrescrita', async () => {
  const drive = fakeDrive();
  drive.putVault([{ id: 'r', title: 'Remota', updatedAt: T(1) }]);
  const local = fakeLocal([{ id: 'l', title: 'antes', updatedAt: T(1) }]);
  drive.hooks.beforeDownload = (name) => {
    if (name === vaultSync.VAULT_FILE) {
      // O usuário salva no meio da rodada
      local.entries = [{ id: 'l', title: 'editada durante o sync', updatedAt: T(9) }, { id: 'nova', updatedAt: T(9) }];
    }
  };
  await run(drive, local);
  const l = local.entries.find((e) => e.id === 'l');
  assert.strictEqual(l.title, 'editada durante o sync');
  assert.deepStrictEqual(ids(local.entries), ['l', 'nova', 'r']);
  assert.deepStrictEqual(ids(drive.vault()), ['l', 'nova', 'r'], 'a nuvem recebe a edição também');
});

test('D2: exclusão feita durante a rodada não ressuscita a entrada', async () => {
  const drive = fakeDrive();
  drive.putVault([{ id: 'a', updatedAt: T(1) }, { id: 'b', updatedAt: T(1) }]);
  const local = fakeLocal([{ id: 'a', updatedAt: T(1) }, { id: 'b', updatedAt: T(1) }]);
  drive.hooks.beforeDownload = () => {
    // O usuário apaga "b" de vez enquanto o download acontece
    local.entries = [{ id: 'a', updatedAt: T(1) }];
    local.tombstones = { b: T(8) };
  };
  drive.files.get(vaultSync.VAULT_FILE).md5Checksum = 'mudou'; // força o download
  drive.putVault([{ id: 'a', updatedAt: T(1) }, { id: 'b', updatedAt: T(1) }]);
  await run(drive, local, { folderId: 'pasta', lastRemoteMd5: 'antigo' });
  assert.deepStrictEqual(ids(local.entries), ['a']);
  assert.deepStrictEqual(ids(drive.vault()), ['a']);
  assert.deepStrictEqual(drive.tombs(), { b: T(8) });
});

test('D3: outro aparelho envia entre a leitura e o envio → recomeça e mescla os dois', async () => {
  const drive = fakeDrive();
  drive.putVault([{ id: 'base', updatedAt: T(1) }]);
  const local = fakeLocal([{ id: 'base', updatedAt: T(1) }, { id: 'doPC', updatedAt: T(3) }]);
  let enviouCelular = false;
  drive.hooks.beforeFind = (name) => {
    // Depois da leitura (2 findFile), na conferência antes do envio, o celular envia
    if (!enviouCelular && drive.uploads.length === 0 && name === vaultSync.VAULT_FILE && drive._finds++ >= 1) {
      enviouCelular = true;
      drive.putVault([{ id: 'base', updatedAt: T(1) }, { id: 'doCelular', updatedAt: T(4) }]);
    }
  };
  drive._finds = 0;
  await run(drive, local);
  assert.ok(enviouCelular);
  assert.deepStrictEqual(ids(drive.vault()), ['base', 'doCelular', 'doPC'], 'nada do celular se perdeu');
  assert.deepStrictEqual(ids(local.entries), ['base', 'doCelular', 'doPC']);
});

test('D3: nuvem mudando sem parar → desiste depois de 3 tentativas, sem sobrescrever', async () => {
  const drive = fakeDrive();
  drive.putVault([{ id: 'base', updatedAt: T(1) }]);
  const local = fakeLocal([{ id: 'doPC', updatedAt: T(3) }]);
  let k = 0;
  drive.hooks.beforeFind = (name) => {
    if (name === vaultSync.VAULT_FILE && ++k % 2 === 0) drive.putVault([{ id: 'base', updatedAt: T(1) }, { id: `c${k}`, updatedAt: T(5) }]);
  };
  await assert.rejects(run(drive, local), (e) => e.code === 'remote_changed' && e.localChanged === true);
  assert.deepStrictEqual(drive.uploads, []);
});

test('falha no envio depois de gravar localmente avisa a tela (localChanged)', async () => {
  const drive = fakeDrive();
  drive.putVault([{ id: 'r', updatedAt: T(1) }]);
  drive.client.upload = async () => { throw new Error('quota'); };
  const local = fakeLocal([{ id: 'l', updatedAt: T(2) }]);
  await assert.rejects(syncOnce({ client: drive.client, password: PW, state: { folderId: 'pasta' }, ...local.deps, encrypt, decrypt, hash }),
    (e) => /quota/.test(e.message) && e.localChanged === true);
});

test('cofre da nuvem com outra senha mestra', async () => {
  const drive = fakeDrive();
  drive.put(vaultSync.VAULT_FILE, JSON.stringify(encrypt('[]', 'outra')));
  await assert.rejects(run(drive, fakeLocal()), /outra senha/);
});

test('exclusões locais ilegíveis são guardadas, não apagadas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-tomb-'));
  try {
    fs.writeFileSync(path.join(dir, vaultSync.TOMBSTONES_FILE), '{ quebrado');
    fs.writeFileSync(path.join(dir, '.mysecrets-exclusoes (1).json'), JSON.stringify({ a: T(1) }));
    const r = vaultSync.readTombstones(dir);
    assert.deepStrictEqual(r.tombstones, { a: T(1) });
    const guardados = fs.readdirSync(dir).filter((f) => f.startsWith('.corrompido-'));
    assert.strictEqual(guardados.length, 1);
    assert.strictEqual(fs.readFileSync(path.join(dir, guardados[0]), 'utf8'), '{ quebrado');
    vaultSync.writeTombstones(dir, r.tombstones, r.files);
    assert.ok(fs.existsSync(path.join(dir, guardados[0])), 'gravar não apaga a cópia');
    assert.deepStrictEqual(vaultSync.readTombstones(dir).tombstones, { a: T(1) }, 'cópia não volta a ser lida');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
