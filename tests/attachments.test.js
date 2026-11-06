// Anexos de arquivo no cofre e gravação por agente (MCP), com arquivos falsos
// num diretório temporário. O papel do app (diálogo + renderer) é simulado:
// o teste recebe o pedido por IPC, aplica com agent-write.js e grava o
// secrets.enc com vault-crypto.js, como o app faria.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork, spawn } = require('node:child_process');

// Diretório de dados falso ANTES de carregar o mcp-server (vault.js lê na carga)
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-anexos-'));
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-arquivos-'));
process.env.MYSECRETS_DATA_DIR = DATA_DIR;

const files = require('../mcp-server/files');
const core = require('../mcp-server/core');
const { encryptVault, decryptVault, createKeyCache } = require('../src/lib/vault-crypto');
const { planAgentWrite, applyAgentWrite, entryAttachments, normalizeProjectTag } = require('../src/renderer/agent-write');

const PASSWORD = 'senha-mestra-de-teste-123!';
// Como o app: salt estável (cache de chaves) e a sessão leva só as chaves derivadas
const CHAVES = createKeyCache();
CHAVES.encrypt('[]', PASSWORD);
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.enc');

process.on('exit', () => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
});

// ===== Ambiente falso: segredo de máquina, sessão desbloqueada e cofre =====

function writeSession(extra = {}) {
  const secret = crypto.randomBytes(32);
  fs.writeFileSync(path.join(DATA_DIR, '.machine-secret'), secret, { mode: 0o600 });
  const key = crypto.createHash('sha256').update('mysecrets-session-v2').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = JSON.stringify({
    timestamp: Date.now(),
    pid: process.pid,
    unlocked: true,
    keys: CHAVES.exportKeys(),
    expiresAt: Date.now() + 15 * 60 * 1000,
    hostname: os.hostname(),
    ...extra
  });
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  fs.writeFileSync(path.join(DATA_DIR, '.session'), JSON.stringify({
    version: 2, encrypted, iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex')
  }), { mode: 0o600 });
}

function writeVault(entries) {
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(CHAVES.encrypt(JSON.stringify(entries), PASSWORD)));
}

function readVault() {
  return JSON.parse(decryptVault(JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')), PASSWORD));
}

function fakeFile(name, content) {
  const p = path.join(WORK_DIR, name);
  fs.writeFileSync(p, content);
  return p;
}

// Arquivos falsos no formato dos que serão guardados de verdade
const FAKE_JKS = Buffer.concat([Buffer.from([0xfe, 0xed, 0xfe, 0xed, 0, 0, 0, 2]), crypto.randomBytes(4088)]);
const FAKE_AES = crypto.randomBytes(32);
const FAKE_PEM = '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEoAoGCCqGSM49\n-----END EC PRIVATE KEY-----\n';
const FAKE_ENV = 'R2_ACCESS_KEY=falso\nJWT_SEGREDO=nao-e-real\n';

// ===== files.js =====

test('files: lê binário e texto, com sha256 e tamanho, e grava de volta igual', () => {
  const jks = files.readFileAsAttachment(fakeFile('release.jks', FAKE_JKS));
  assert.strictEqual(jks.name, 'release.jks');
  assert.strictEqual(jks.mime, 'application/x-java-keystore');
  assert.strictEqual(jks.size, FAKE_JKS.length);
  assert.strictEqual(jks.sha256, crypto.createHash('sha256').update(FAKE_JKS).digest('hex'));
  assert.deepStrictEqual(files.verifyAttachment(jks), FAKE_JKS);

  const env = files.readFileAsAttachment(fakeFile('.env', FAKE_ENV), { note: 'reconhecimento' });
  assert.strictEqual(env.mime, 'text/plain');
  assert.strictEqual(env.note, 'reconhecimento');

  const out = path.join(WORK_DIR, 'saida', 'release.jks');
  files.writeAttachmentToPath(jks, out);
  assert.deepStrictEqual(fs.readFileSync(out), FAKE_JKS);
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(out).mode & 0o777, 0o600, 'arquivo de segredo sai com permissão 600');
  }
  assert.throws(() => files.writeAttachmentToPath(jks, out), /overwrite/);
  const sem = files.writeAttachmentToPath(jks, out, { overwrite: true });
  assert.strictEqual(sem.backupPath, undefined, 'sem backup: true não deixa cópia');
});

test('files: sobrescrever com backup guarda o anterior; link simbólico é recusado', () => {
  const jks = files.readFileAsAttachment(fakeFile('release.jks', FAKE_JKS));
  const dir = path.join(WORK_DIR, 'backup');
  const alvo = path.join(dir, 'alvo.txt');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(alvo, 'conteúdo importante');

  const r1 = files.writeAttachmentToPath(jks, alvo, { overwrite: true, backup: true });
  assert.deepStrictEqual(fs.readFileSync(alvo), FAKE_JKS);
  assert.ok(r1.backupPath && r1.backupPath.startsWith(alvo + '.bak-'));
  assert.strictEqual(fs.readFileSync(r1.backupPath, 'utf8'), 'conteúdo importante');
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(r1.backupPath).mode & 0o777, 0o600, 'backup também sai com 600');
  }
  // Dois backups no mesmo segundo não se sobrescrevem
  const r2 = files.writeAttachmentToPath(jks, alvo, { overwrite: true, backup: true });
  assert.notStrictEqual(r2.backupPath, r1.backupPath);
  assert.ok(fs.existsSync(r1.backupPath));
  // Não sobra arquivo temporário
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);

  if (process.platform !== 'win32') {
    const real = path.join(dir, 'real.txt');
    fs.writeFileSync(real, 'não mexer');
    const link = path.join(dir, 'link.txt');
    fs.symlinkSync(real, link);
    assert.throws(() => files.writeAttachmentToPath(jks, link, { overwrite: true, backup: true }), /link simbólico/);
    assert.strictEqual(fs.readFileSync(real, 'utf8'), 'não mexer');
  }
});

test('files: recusa caminho relativo, arquivo grande e anexo adulterado', () => {
  assert.throws(() => files.readFileAsAttachment('relativo.txt'), /absoluto/);
  assert.throws(() => files.readFileAsAttachment(path.join(WORK_DIR, 'nao-existe')), /não encontrado/);
  assert.throws(() => files.readFileAsAttachment(WORK_DIR), /Não é um arquivo/);
  const grande = fakeFile('grande.bin', Buffer.alloc(files.MAX_ATTACHMENT_BYTES + 1));
  assert.throws(() => files.readFileAsAttachment(grande), /grande demais/);
  assert.doesNotThrow(() => files.readFileAsAttachment(fakeFile('limite.bin', Buffer.alloc(files.MAX_ATTACHMENT_BYTES))));

  const att = files.attachmentFromBuffer(FAKE_AES, { name: 'mobile_chave.bin' });
  const outro = Buffer.from(att.data, 'base64');
  outro[0] ^= 0xff;
  assert.throws(() => files.verifyAttachment({ ...att, data: outro.toString('base64') }), /sha256/);
  assert.throws(() => files.verifyAttachment({ ...att, size: 31 }), /tamanho/);
  assert.throws(() => files.verifyAttachment({ ...att, data: 'não é base64!' }), /base64/);
});

test('files: nome do anexo não carrega diretório', () => {
  assert.strictEqual(files.sanitizeName('../../etc/passwd'), 'passwd');
  assert.strictEqual(files.sanitizeName('C:\\Users\\x\\chave.pem'), 'chave.pem');
  assert.strictEqual(files.sanitizeName('..'), 'arquivo');
  assert.strictEqual(files.sanitizeName('a\nb'), 'a_b');
});

// ===== agent-write.js =====

test('agent-write: cria nota com projeto, campos e anexos', () => {
  const entries = [];
  const pem = files.attachmentFromBuffer(Buffer.from(FAKE_PEM), { name: 'tcg-scanner-ota.pem', note: 'chave da OTA' });
  const req = {
    target: { title: 'TCG Scanner — chave da OTA' },
    project: 'TCG Scanner',
    fields: { notes: 'fica em ~/.android' },
    customFields: [{ name: 'uso', value: 'assinar OTA', type: 'text' }],
    files: [pem]
  };
  const plan = planAgentWrite(entries, req);
  assert.strictEqual(plan.mode, 'new');
  assert.strictEqual(plan.type, 'note');
  assert.deepStrictEqual(plan.tags, ['tcg-scanner']);
  assert.deepStrictEqual(plan.files.map(f => [f.name, f.size, f.replaces]), [['tcg-scanner-ota.pem', pem.size, false]]);
  assert.ok(!JSON.stringify(plan).includes('BEGIN EC'), 'resumo não leva conteúdo');

  let n = 0;
  const { entry, mode } = applyAgentWrite(entries, req, { newId: () => 'id' + (++n), now: '2026-11-04T10:00:00.000Z' });
  assert.strictEqual(mode, 'new');
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entry.type, 'note');
  assert.deepStrictEqual(entry.tags, ['tcg-scanner']);
  assert.strictEqual(entry.notes, 'fica em ~/.android');
  assert.strictEqual(entry.attachments.length, 1);
  assert.strictEqual(Buffer.from(entry.attachments[0].data, 'base64').toString(), FAKE_PEM);
  assert.strictEqual(entry.attachments[0].addedAt, '2026-11-04T10:00:00.000Z');
});

test('agent-write: atualiza pelo título, guarda histórico e substitui anexo de mesmo nome', () => {
  const v1 = files.attachmentFromBuffer(Buffer.from('versão 1'), { name: '.env' });
  const entries = [
    { id: 'outra', title: 'Keystore', tags: ['outro-projeto'], type: 'login', password: 'x' },
    {
      id: 'k1', title: 'Keystore', type: 'login', tags: ['tcg-scanner'], password: 'antiga',
      customFields: [{ id: 'c1', name: 'keyAlias', value: 'upload', type: 'text' }],
      attachments: [{ ...v1, id: 'a1', addedAt: '2026-01-01T00:00:00.000Z' }],
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  ];
  const v2 = files.attachmentFromBuffer(Buffer.from('versão 2'), { name: '.env' });
  const req = {
    target: { title: 'keystore' },
    project: 'tcg-scanner',
    fields: { password: 'nova' },
    customFields: [{ name: 'keyAlias', value: 'release' }, { name: 'storePassword', value: 's', type: 'password' }],
    files: [v2]
  };
  const plan = planAgentWrite(entries, req);
  assert.strictEqual(plan.mode, 'update');
  assert.strictEqual(plan.entryId, 'k1', 'prefere a entrada do mesmo projeto');
  assert.deepStrictEqual(plan.fields, [{ name: 'password', label: 'senha', replaces: true }]);
  assert.deepStrictEqual(plan.customFields, [{ name: 'keyAlias', replaces: true }, { name: 'storePassword', replaces: false }]);
  assert.strictEqual(plan.files[0].replaces, true);

  const { entry } = applyAgentWrite(entries, req, { newId: () => 'novo', now: '2026-11-04T10:00:00.000Z' });
  assert.strictEqual(entry.id, 'k1');
  assert.strictEqual(entry.password, 'nova');
  assert.deepStrictEqual(entry.passwordHistory, [{ password: 'antiga', changedAt: '2026-11-04T10:00:00.000Z' }]);
  assert.deepStrictEqual(entry.customFields.map(c => [c.name, c.value, c.type]),
    [['keyAlias', 'release', 'text'], ['storePassword', 's', 'password']]);
  assert.strictEqual(entry.attachments.length, 1);
  assert.strictEqual(entry.attachments[0].id, 'a1', 'mantém o id do anexo substituído');
  assert.strictEqual(entry.attachments[0].addedAt, '2026-01-01T00:00:00.000Z');
  assert.strictEqual(Buffer.from(entry.attachments[0].data, 'base64').toString(), 'versão 2');
  assert.strictEqual(entry.updatedAt, '2026-11-04T10:00:00.000Z', 'updatedAt sobe para a sincronização mesclar');
  assert.strictEqual(entries[0].password, 'x', 'a outra entrada de mesmo título fica intacta');
});

test('agent-write: id inexistente e entrada na lixeira não são alvo', () => {
  const entries = [{ id: 'z', title: 'Apagada', deletedAt: '2026-01-01' }];
  assert.match(planAgentWrite(entries, { target: { id: 'nao' } }).error, /não encontrada/);
  assert.match(planAgentWrite(entries, { target: { id: 'z' } }).error, /não encontrada/);
  assert.strictEqual(planAgentWrite(entries, { target: { title: 'Apagada' } }).mode, 'new');
  assert.strictEqual(normalizeProjectTag(' TCG  Scanner '), 'tcg-scanner');
});

test('compatibilidade: entrada antiga sem anexos e cofre com anexos cifrado/decifrado', () => {
  assert.deepStrictEqual(entryAttachments({ id: 'velha', title: 'Sem anexos' }), []);
  const att = files.attachmentFromBuffer(FAKE_JKS, { name: 'release.jks' });
  const entries = [{ id: 'velha', title: 'Antiga' }, { id: 'nova', title: 'Com anexo', attachments: [{ ...att, id: 'a' }] }];
  const enc = encryptVault(JSON.stringify(entries), PASSWORD);
  assert.strictEqual(enc.version, 2, 'mesmo envelope v2 (AES-256-GCM)');
  assert.ok(!enc.encrypted.includes(att.data), 'conteúdo não aparece em claro');
  const back = JSON.parse(decryptVault(enc, PASSWORD));
  assert.deepStrictEqual(files.verifyAttachment(back[1].attachments[0]), FAKE_JKS);
});

// ===== core.js: validação do pedido =====

test('buildWriteRequest: valida argumentos e lê os arquivos', () => {
  assert.throws(() => core.buildWriteRequest('store_secret', { password: 'x' }), /title/);
  assert.throws(() => core.buildWriteRequest('store_secret', { title: 'T' }), /Nada para gravar/);
  assert.throws(() => core.buildWriteRequest('store_secret', { title: 'T', type: 'mfa', notes: 'n' }), /type/);
  assert.throws(() => core.buildWriteRequest('store_secret_file', { title: 'T', path: 'rel.txt' }), /absoluto/);
  const p = fakeFile('a.bin', FAKE_AES);
  assert.throws(() => core.buildWriteRequest('store_secret', {
    title: 'T', files: [{ path: p }, { path: p }]
  }), /mesmo nome/);

  const req = core.buildWriteRequest('store_secret', {
    title: ' Keystore ', project: 'tcg-scanner', password: 'segredo',
    customFields: [{ name: 'storePassword', value: 'xyz', type: 'password' }],
    files: [{ path: p, name: 'mobile_chave.bin', note: 'AES' }]
  });
  assert.strictEqual(req.target.title, 'Keystore');
  assert.strictEqual(req.files[0].name, 'mobile_chave.bin');
  assert.strictEqual(req.files[0].size, 32);
  const resumo = JSON.stringify(core.describeRequest(req));
  assert.ok(!resumo.includes('segredo') && !resumo.includes('xyz') && !resumo.includes(req.files[0].data),
    'resumo não expõe valores nem conteúdo');
});

// ===== Ponta a ponta: stdio -> servidor HTTP do app -> "app" -> cofre =====

async function startHttpServer(t, onWrite) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = fork(path.join(__dirname, '..', 'mcp-server', 'http-server.js'), [], {
    env: { ...process.env, MYSECRETS_MCP_PORT: String(port), MYSECRETS_MCP_TOKEN: 'tk', MYSECRETS_MCP_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve);
    child.once('exit', () => reject(new Error('servidor saiu')));
  });
  child.on('message', async (msg) => {
    if (msg.type !== 'agent_write') return;
    const result = await onWrite(msg.payload);
    child.send({ type: 'agent_write_result', reqId: msg.reqId, result });
  });
  fs.writeFileSync(path.join(DATA_DIR, '.mcp-endpoint'), JSON.stringify({ port }));
  fs.writeFileSync(path.join(DATA_DIR, '.mcp-token'), 'tk');
  return port;
}

// Faz o papel do app: "diálogo" (decide), aplica e grava o secrets.enc
function fakeApp(decisions) {
  return async (req) => {
    decisions.pedidos.push(req);
    if (!decisions.aprovar) return { success: false, declined: true, error: 'O usuário recusou a gravação no app.' };
    const entries = fs.existsSync(SECRETS_FILE) ? readVault() : [];
    const { entry, mode } = applyAgentWrite(entries, req);
    writeVault(entries);
    return { success: true, id: entry.id, mode, title: entry.title };
  };
}

function stdioClient(t) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp-server', 'index.js')], {
    env: { ...process.env, MYSECRETS_DATA_DIR: DATA_DIR },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  t.after(() => child.kill());
  let buf = '';
  const waiting = new Map();
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      const w = waiting.get(msg.id);
      if (w) { waiting.delete(msg.id); w(msg); }
    }
  });
  let id = 0;
  return (name, args) => new Promise((resolve) => {
    const myId = ++id;
    waiting.set(myId, (msg) => {
      const r = msg.result;
      resolve({ isError: !!r.isError, data: JSON.parse(r.content[0].text) });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method: 'tools/call', params: { name, arguments: args } }) + '\n');
  });
}

test('ponta a ponta: agente grava keystore + senhas, lê de volta e recusa é respeitada', async (t) => {
  writeSession();
  writeVault([{ id: 'antiga', type: 'login', title: 'GitHub', username: 'eu', password: 'p' }]);
  const decisions = { aprovar: true, pedidos: [] };
  const port = await startHttpServer(t, fakeApp(decisions));
  const call = stdioClient(t);

  // 1) Entrada com senhas + keystore numa gravação só
  const jksPath = fakeFile('release.jks', FAKE_JKS);
  let r = await call('store_secret', {
    title: 'TCG Scanner — keystore de release',
    project: 'tcg-scanner',
    notes: 'keystore do APK',
    customFields: [
      { name: 'storePassword', value: 'senha-falsa-1', type: 'password' },
      { name: 'keyAlias', value: 'upload' }
    ],
    files: [{ path: jksPath, note: 'keystore Android' }]
  });
  assert.strictEqual(r.isError, false, JSON.stringify(r.data));
  assert.strictEqual(r.data.mode, 'new');
  assert.deepStrictEqual(r.data.files.map(f => f.name), ['release.jks']);
  assert.ok(!JSON.stringify(r.data).includes('senha-falsa-1'), 'resposta não ecoa segredos');
  const keystoreId = r.data.id;

  // 2) Anexa mais arquivos à mesma entrada (pelo id) e cria outra pelo título
  r = await call('store_secret_file', { id: keystoreId, path: fakeFile('mobile_chave.bin', FAKE_AES), note: 'AES-256' });
  assert.strictEqual(r.data.mode, 'update');
  r = await call('store_secret_file', { title: 'TCG Scanner — .env do reconhecimento', project: 'tcg-scanner', path: fakeFile('.env', FAKE_ENV) });
  assert.strictEqual(r.data.mode, 'new');

  // 3) O cofre gravado continua cifrado e com a entrada antiga intacta
  const cofre = readVault();
  assert.strictEqual(cofre.length, 3);
  assert.strictEqual(cofre.find(e => e.id === 'antiga').password, 'p');
  assert.ok(!fs.readFileSync(SECRETS_FILE, 'utf8').includes('upload'), 'nada em texto puro no disco');

  // 4) Leitura: busca por projeto, credenciais com campos e download do anexo
  r = await call('search_secrets', { query: 'tcg-scanner' });
  assert.strictEqual(r.data.count, 2);
  const meta = r.data.results.find(e => e.id === keystoreId);
  assert.deepStrictEqual(meta.attachments.map(a => a.name), ['release.jks', 'mobile_chave.bin']);
  assert.ok(!('data' in meta.attachments[0]), 'listagem não traz conteúdo');

  r = await call('get_credentials', { id: keystoreId });
  assert.strictEqual(r.data.customFields.find(c => c.name === 'storePassword').value, 'senha-falsa-1');

  r = await call('get_secret_file', { id: keystoreId, outPath: path.join(WORK_DIR, 'out', 'x.jks') });
  assert.strictEqual(r.isError, true);
  assert.match(r.data.error, /informe "name"/);

  const outJks = path.join(WORK_DIR, 'out', 'release.jks');
  r = await call('get_secret_file', { id: keystoreId, name: 'release.jks', outPath: outJks });
  assert.strictEqual(r.isError, false, JSON.stringify(r.data));
  assert.deepStrictEqual(fs.readFileSync(outJks), FAKE_JKS);
  r = await call('get_secret_file', { query: '.env do reconhecimento', outPath: path.join(WORK_DIR, 'out', '.env') });
  assert.strictEqual(r.isError, false, JSON.stringify(r.data));
  assert.strictEqual(fs.readFileSync(path.join(WORK_DIR, 'out', '.env'), 'utf8'), FAKE_ENV);
  r = await call('get_secret_file', { id: keystoreId, name: 'release.jks', outPath: outJks });
  assert.match(r.data.error, /overwrite/, 'não sobrescreve sem pedir');
  fs.writeFileSync(outJks, 'versão local');
  r = await call('get_secret_file', { id: keystoreId, name: 'release.jks', outPath: outJks, overwrite: true });
  assert.strictEqual(r.isError, false, JSON.stringify(r.data));
  assert.strictEqual(fs.readFileSync(r.data.backupPath, 'utf8'), 'versão local', 'sobrescrever guarda o anterior');

  // 5) Usuário recusa no app: nada muda e o agente fica sabendo
  decisions.aprovar = false;
  const antes = fs.readFileSync(SECRETS_FILE, 'utf8');
  r = await call('store_secret', { id: keystoreId, password: 'trocar' });
  assert.strictEqual(r.isError, true);
  assert.strictEqual(r.data.declined, true);
  assert.strictEqual(fs.readFileSync(SECRETS_FILE, 'utf8'), antes);

  // 6) Extensão (com Origin) não grava pelo servidor, mesmo com o token
  const pedidosAntes = decisions.pedidos.length;
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tk', Origin: 'chrome-extension://abc' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'store_secret', arguments: { title: 'X', notes: 'y' } } })
  });
  const body = await res.json();
  assert.strictEqual(body.result.isError, true);
  assert.match(body.result.content[0].text, /não é permitida/);
  assert.strictEqual(decisions.pedidos.length, pedidosAntes, 'pedido nem chega ao app');

  // ...e também não grava arquivos no disco com get_secret_file
  const destinoExt = path.join(WORK_DIR, 'out', 'pela-extensao.jks');
  const resFile = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tk', Origin: 'chrome-extension://abc' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_secret_file', arguments: { id: keystoreId, name: 'release.jks', outPath: destinoExt } } })
  });
  const bodyFile = await resFile.json();
  assert.strictEqual(bodyFile.result.isError, true);
  assert.match(bodyFile.result.content[0].text, /não é permitido/);
  assert.ok(!fs.existsSync(destinoExt), 'nada gravado');

  // ...nem lista/busca o cofre inteiro; tools/list só mostra o necessário para preencher
  const ext = async (method, params) => (await (await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tk', Origin: 'chrome-extension://abc' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method, params })
  })).json());
  const lista = await ext('tools/call', { name: 'list_secrets', arguments: {} });
  assert.strictEqual(lista.result.isError, true);
  assert.match(lista.result.content[0].text, /não é permitido para a extensão/);
  const busca = await ext('tools/call', { name: 'search_secrets', arguments: { query: 'tcg' } });
  assert.strictEqual(busca.result.isError, true);
  const ferramentas = (await ext('tools/list', {})).result.tools.map((t) => t.name).sort();
  assert.deepStrictEqual(ferramentas, ['get_credentials', 'get_otp', 'match_url', 'vault_status']);
  const ok = await ext('tools/call', { name: 'match_url', arguments: { url: 'https://exemplo.com' } });
  assert.strictEqual(ok.result.isError, undefined, 'ferramenta de preenchimento continua liberada');
});

test('ponta a ponta: cofre bloqueado e servidor do app desligado', async (t) => {
  // Sem servidor do app: stdio explica o que fazer
  fs.rmSync(path.join(DATA_DIR, '.mcp-endpoint'), { force: true });
  writeSession();
  const call = stdioClient(t);
  let r = await call('store_secret', { title: 'X', notes: 'y' });
  assert.strictEqual(r.isError, true);
  assert.match(r.data.error, /servidor local/);

  // Servidor ligado mas sessão bloqueada: recusado antes de chegar ao app
  const decisions = { aprovar: true, pedidos: [] };
  await startHttpServer(t, fakeApp(decisions));
  writeSession({ unlocked: false });
  r = await call('store_secret', { title: 'X', notes: 'y' });
  assert.strictEqual(r.isError, true);
  assert.strictEqual(r.data.locked, true);
  assert.strictEqual(decisions.pedidos.length, 0);
  writeSession();
});
