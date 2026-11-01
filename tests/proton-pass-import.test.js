// Importação do Proton Pass: data.json, CSV e ZIP (dados fictícios).

const { test } = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');

const {
  parseCsv,
  isProtonPassJson,
  isProtonPassCsv,
  protonPassCsvToJson,
  convertProtonPassToMySecrets,
  extractTextFromZip
} = require('../src/renderer/proton-pass-import');

let seq = 0;
const gerarId = () => 'id' + (++seq);

const exportJson = {
  version: '1.21.0',
  userId: 'usuario',
  encrypted: false,
  vaults: {
    v1: {
      name: 'Pessoal',
      items: [
        {
          state: 1, pinned: true, createTime: 1700000000, modifyTime: 1700000100,
          data: {
            type: 'login',
            metadata: { name: 'GitHub', note: 'conta de teste' },
            content: {
              itemEmail: 'teste@exemplo.com', itemUsername: 'teste',
              password: 'senha-falsa',
              urls: ['https://github.com', 'https://gist.github.com'],
              totpUri: 'otpauth://totp/GitHub:teste?secret=JBSWY3DPEHPK3PXP&digits=8&period=60&algorithm=SHA256'
            },
            extraFields: [{ fieldName: 'PIN', type: 'hidden', data: { content: '1234' } }]
          }
        },
        {
          state: 1, createTime: 1700000000, modifyTime: 1700000000,
          data: { type: 'note', metadata: { name: 'Nota', note: 'texto' }, content: {}, extraFields: [] }
        },
        {
          state: 2, createTime: 1700000000, modifyTime: 1700000000,
          data: { type: 'note', metadata: { name: 'Na lixeira', note: 'x' }, content: {}, extraFields: [] }
        },
        {
          state: 1, createTime: 1700000000, modifyTime: 1700000000,
          data: {
            type: 'creditCard', metadata: { name: 'Cartão', note: '' },
            content: { cardholderName: 'Fulano', number: '4111111111111111', verificationCode: '123', expirationDate: '2030-01' },
            extraFields: []
          }
        },
        {
          state: 1, createTime: 1700000000, modifyTime: 1700000000,
          data: {
            type: 'wifi', metadata: { name: 'Casa', note: '' },
            content: { ssid: 'MinhaRede', password: 'wifi-falsa', security: 'WPA2' }, extraFields: []
          }
        }
      ]
    }
  }
};

test('detecta o data.json do Proton Pass', () => {
  assert.ok(isProtonPassJson(exportJson));
  assert.ok(!isProtonPassJson([]));
  assert.ok(!isProtonPassJson({ items: [] }));
});

test('converte login com TOTP, e-mail separado e campo extra', () => {
  const r = convertProtonPassToMySecrets(exportJson, gerarId);
  const login = r.find(e => e.type === 'login');
  const mfa = r.find(e => e.type === 'mfa');

  assert.strictEqual(login.title, 'GitHub');
  assert.strictEqual(login.username, 'teste');
  assert.strictEqual(login.password, 'senha-falsa');
  assert.strictEqual(login.url, 'https://github.com');
  assert.match(login.notes, /conta de teste/);
  assert.match(login.notes, /gist\.github\.com/);
  assert.match(login.notes, /Cofre Proton Pass: Pessoal/);
  assert.deepStrictEqual(login.customFields.map(f => [f.name, f.value, f.type]),
    [['E-mail', 'teste@exemplo.com', 'text'], ['PIN', '1234', 'password']]);
  assert.ok(login.tags.includes('proton-pass') && login.tags.includes('favorito') && login.tags.includes('pessoal'));
  assert.strictEqual(login.createdAt, new Date(1700000000 * 1000).toISOString());

  assert.strictEqual(login.linkedMfaId, mfa.id);
  assert.strictEqual(mfa.mfaSecret, 'JBSWY3DPEHPK3PXP');
  assert.strictEqual(mfa.mfaDigits, 8);
  assert.strictEqual(mfa.mfaPeriod, 60);
  assert.strictEqual(mfa.mfaHash, 'sha256');
});

test('ignora a lixeira e converte nota, cartão e wifi', () => {
  const r = convertProtonPassToMySecrets(exportJson, gerarId);
  assert.ok(!r.some(e => e.title === 'Na lixeira'));

  const nota = r.find(e => e.title === 'Nota');
  assert.strictEqual(nota.type, 'note');
  assert.match(nota.notes, /texto/);

  const cartao = r.find(e => e.title === 'Cartão');
  assert.strictEqual(cartao.type, 'note');
  assert.match(cartao.notes, /Numero: 4111111111111111/);
  assert.match(cartao.notes, /CVV: 123/);

  const wifi = r.find(e => e.title === 'Casa');
  assert.strictEqual(wifi.username, 'MinhaRede');
  assert.strictEqual(wifi.password, 'wifi-falsa');
  assert.doesNotMatch(wifi.notes, /wifi-falsa/);
});

test('aceita o formato antigo com content.username', () => {
  const antigo = { vaults: { v: { name: 'X', items: [{ state: 1, data: {
    type: 'login', metadata: { name: 'Site' }, content: { username: 'velho', password: 'p', urls: [] }
  } }] } } };
  const [login] = convertProtonPassToMySecrets(antigo, gerarId);
  assert.strictEqual(login.username, 'velho');
  assert.strictEqual(login.customFields, undefined);
});

const csv = [
  'type,name,url,email,username,password,note,totp,createTime,modifyTime,vault',
  'login,Exemplo,"https://a.com, https://b.com",eu@exemplo.com,eu,"se,nha""falsa","linha 1',
  'linha 2",JBSWY3DPEHPK3PXP,1700000000,1700000000,Trabalho',
  'note,Só nota,,,,,conteúdo,,1700000000,1700000000,Trabalho',
  ''
].join('\r\n');

test('parseCsv lida com aspas, vírgulas e quebras de linha', () => {
  const linhas = parseCsv(csv);
  assert.strictEqual(linhas.length, 3);
  assert.strictEqual(linhas[1][5], 'se,nha"falsa');
  assert.strictEqual(linhas[1][6], 'linha 1\r\nlinha 2');
});

test('converte o CSV do Proton Pass', () => {
  assert.ok(isProtonPassCsv(csv));
  assert.ok(!isProtonPassCsv('a,b,c\n1,2,3'));

  const r = convertProtonPassToMySecrets(protonPassCsvToJson(csv), gerarId);
  const login = r.find(e => e.type === 'login');
  assert.strictEqual(login.username, 'eu');
  assert.strictEqual(login.password, 'se,nha"falsa');
  assert.strictEqual(login.url, 'https://a.com');
  assert.match(login.notes, /https:\/\/b\.com/);
  assert.ok(login.tags.includes('trabalho'));
  assert.ok(r.some(e => e.type === 'mfa' && e.mfaSecret === 'JBSWY3DPEHPK3PXP'));
  assert.ok(r.some(e => e.type === 'note' && e.title === 'Só nota'));
});

// Monta um ZIP mínimo com os arquivos dados (deflate).
function montarZip(arquivos) {
  const locais = [], centrais = [];
  let offset = 0;
  for (const [nome, texto] of Object.entries(arquivos)) {
    const nomeBuf = Buffer.from(nome);
    const dados = Buffer.from(texto);
    const comp = zlib.deflateRawSync(dados);
    const crc = zlib.crc32(dados);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    locais.push(local, nomeBuf, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(dados.length, 24); central.writeUInt16LE(nomeBuf.length, 28); central.writeUInt32LE(offset, 42);
    centrais.push(central, nomeBuf);

    offset += 30 + nomeBuf.length + comp.length;
  }
  const dir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(Object.keys(arquivos).length, 8); fim.writeUInt16LE(Object.keys(arquivos).length, 10);
  fim.writeUInt32LE(dir.length, 12); fim.writeUInt32LE(offset, 16);
  const buf = Buffer.concat([...locais, dir, fim]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

test('extrai o data.json do ZIP do Proton Pass', async () => {
  const zip = montarZip({
    'Proton Pass/leia-me.txt': 'outro arquivo',
    'Proton Pass/data.json': JSON.stringify(exportJson)
  });
  const texto = await extractTextFromZip(zip, n => /(^|\/)data\.json$/i.test(n));
  assert.deepStrictEqual(JSON.parse(texto), exportJson);
  assert.strictEqual(await extractTextFromZip(zip, n => n === 'nao-existe'), null);
});
