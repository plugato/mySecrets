// Publicação da extensão na Chrome Web Store (API v2), com fetch simulado.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { publish, manifestVersionFromZip, knownVersions } = require('../scripts/publish-chrome-extension');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = {
  client_email: 'publicador@projeto.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
};

// Zip mínimo (deflate) com um manifest.json
function zipComManifest(versao) {
  const nome = Buffer.from('manifest.json');
  const dados = Buffer.from(JSON.stringify({ manifest_version: 3, name: 'X', version: versao }));
  const comp = zlib.deflateRawSync(dados);
  const crc = zlib.crc32(dados);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(dados.length, 22); local.writeUInt16LE(nome.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(dados.length, 24); central.writeUInt16LE(nome.length, 28);
  const dir = Buffer.concat([central, nome]);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(1, 8); fim.writeUInt16LE(1, 10);
  fim.writeUInt32LE(dir.length, 12); fim.writeUInt32LE(30 + nome.length + comp.length, 16);
  return Buffer.concat([local, nome, comp, dir, fim]);
}

function escreverZip(versao) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cws-')), 'ext.zip');
  fs.writeFileSync(f, zipComManifest(versao));
  return f;
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });

test('lê a versão do manifest dentro do zip', () => {
  assert.strictEqual(manifestVersionFromZip(zipComManifest('1.4.0')), '1.4.0');
});

test('knownVersions junta publicada e em revisão', () => {
  assert.deepStrictEqual(knownVersions({
    publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: '1.3.0' }] },
    submittedItemRevisionStatus: { distributionChannels: [{ crxVersion: '1.4.0' }] }
  }), ['1.3.0', '1.4.0']);
  assert.deepStrictEqual(knownVersions({}), []);
});

test('autentica com JWT da conta de serviço, envia e publica', async () => {
  const chamadas = [];
  global.fetch = async (url, opts = {}) => {
    url = String(url);
    chamadas.push({ url, opts });
    if (url === 'https://oauth2.googleapis.com/token') {
      const jwt = new URLSearchParams(opts.body.toString()).get('assertion');
      const [h, c, s] = jwt.split('.');
      const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${c}`)
        .verify(publicKey, Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
      assert.ok(ok, 'assinatura RS256 válida');
      const claims = JSON.parse(Buffer.from(c, 'base64').toString());
      assert.strictEqual(claims.iss, key.client_email);
      assert.strictEqual(claims.scope, 'https://www.googleapis.com/auth/chromewebstore');
      return json({ access_token: 'tok' });
    }
    if (url.endsWith(':fetchStatus')) {
      return json({ publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: '1.3.0' }] }, lastAsyncUploadState: 'SUCCEEDED' });
    }
    if (url.includes('/upload/v2/')) return json({ uploadState: 'UPLOAD_IN_PROGRESS' });
    if (url.endsWith(':publish')) return json({ state: 'PENDING_REVIEW', warningInfo: { warnings: [] } });
    throw new Error('URL inesperada ' + url);
  };

  const logs = [];
  const r = await publish({
    zipPath: escreverZip('1.4.0'), key, publisherId: 'pub1', extensionId: 'ext1',
    log: (m) => logs.push(m), sleep: async () => {}
  });

  assert.deepStrictEqual(r, { skipped: false, version: '1.4.0', state: 'PENDING_REVIEW' });
  const upload = chamadas.find(c => c.url.includes('/upload/'));
  assert.strictEqual(upload.url, 'https://chromewebstore.googleapis.com/upload/v2/publishers/pub1/items/ext1:upload');
  assert.ok(Buffer.isBuffer(upload.opts.body));
  assert.strictEqual(upload.opts.headers.Authorization, 'Bearer tok');
  const pub = chamadas.find(c => c.url.endsWith(':publish'));
  assert.deepStrictEqual(JSON.parse(pub.opts.body), { publishType: 'DEFAULT_PUBLISH' });
  assert.ok(logs.some(l => /revisão/.test(l)));
});

test('não reenvia versão que já está na loja', async () => {
  const chamadas = [];
  global.fetch = async (url) => {
    chamadas.push(String(url));
    if (String(url).includes('oauth2')) return json({ access_token: 'tok' });
    return json({ submittedItemRevisionStatus: { distributionChannels: [{ crxVersion: '1.4.0' }] } });
  };
  const r = await publish({ zipPath: escreverZip('1.4.0'), key, publisherId: 'p', extensionId: 'e', log: () => {} });
  assert.strictEqual(r.skipped, true);
  assert.ok(!chamadas.some(u => u.includes(':upload') || u.includes(':publish')));
});

test('upload recusado vira erro', async () => {
  global.fetch = async (url) => {
    url = String(url);
    if (url.includes('oauth2')) return json({ access_token: 'tok' });
    if (url.endsWith(':fetchStatus')) return json({});
    if (url.includes('/upload/')) return json({ uploadState: 'FAILED' });
    throw new Error('não deveria publicar');
  };
  await assert.rejects(publish({ zipPath: escreverZip('2.0.0'), key, publisherId: 'p', extensionId: 'e', log: () => {} }), /recusado/);
});
