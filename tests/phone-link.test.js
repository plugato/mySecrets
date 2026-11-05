// Ligação PC ↔ celular Android pela rede local: pareamento e desbloqueio.
// Um "celular" simulado em Node faz o papel do app Android.

const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');

const link = require('../src/lib/phone-link');

/** Celular simulado: guarda o que leu do QR e responde como o app Android. */
function fakePhone(qr, { approve = true, phoneName = 'Pixel de Teste', delayMs = 20 } = {}) {
  const p = link.parsePairingQr(qr);
  const vistos = new Set();
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.type === 'done') return;
      const enviar = (o) => socket.write(JSON.stringify(o) + '\n');
      if (msg.pair !== p.pairId || !link.verifyHello(p.secret, msg) || vistos.has(msg.nonce)) {
        enviar({ type: 'error', message: 'Pareamento desconhecido' });
        return;
      }
      vistos.add(msg.nonce);
      if (msg.op === 'pair') {
        enviar({ type: 'paired', phone: phoneName, mac: link.mac(p.secret, 'paired', msg.nonce, phoneName) });
        return;
      }
      enviar({ type: 'pending', phone: phoneName, mac: link.mac(p.secret, 'pending', msg.nonce, phoneName) });
      server.lastCode = link.verificationCode(p.secret, msg.nonce);
      setTimeout(() => {
        if (approve) enviar(link.sealApproval(p.secret, p.pairId, msg.nonce, p.unlockKey));
        else enviar({ type: 'deny', mac: link.mac(p.secret, 'deny', msg.nonce) });
      }, delayMs);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const opts = (server, extra = {}) => ({ hosts: ['127.0.0.1'], port: server.address().port, ...extra });

test('QR leva o necessário e o PC não guarda a chave de desbloqueio', () => {
  const { pairing, qr } = link.createPairing('senha-mestra', 'PC-Casa');
  const p = link.parsePairingQr(qr);
  assert.strictEqual(p.pairId, pairing.pairId);
  assert.strictEqual(p.name, 'PC-Casa');
  assert.ok(p.secret.equals(pairing.secret));
  assert.strictEqual(link.openPassword(pairing, p.unlockKey), 'senha-mestra');
  assert.ok(!JSON.stringify(pairing).includes(p.unlockKey.toString('base64')));
});

test('confirma o pareamento e devolve o nome do celular', async () => {
  const { pairing, qr } = link.createPairing('x');
  const phone = await fakePhone(qr);
  try {
    const r = await link.confirmPairing(pairing, opts(phone));
    assert.strictEqual(r.phoneName, 'Pixel de Teste');
    assert.strictEqual(r.host, '127.0.0.1');
  } finally { phone.close(); }
});

test('desbloqueio aprovado devolve a senha mestra e mostra o mesmo código', async () => {
  const { pairing, qr } = link.createPairing('minha senha forte');
  const phone = await fakePhone(qr);
  const estados = [];
  try {
    const r = await link.requestUnlock(pairing, opts(phone, { onStatus: (s) => estados.push(s) }));
    assert.strictEqual(r.password, 'minha senha forte');
    const esperando = estados.find(s => s.stage === 'waiting');
    assert.match(esperando.code, /^\d{3} \d{3}$/);
    assert.strictEqual(esperando.code, phone.lastCode);
  } finally { phone.close(); }
});

test('desbloqueio negado no celular vira erro denied', async () => {
  const { pairing, qr } = link.createPairing('x');
  const phone = await fakePhone(qr, { approve: false });
  try {
    await assert.rejects(link.requestUnlock(pairing, opts(phone)), (e) => e.code === 'denied');
  } finally { phone.close(); }
});

test('celular com outro pareamento não é aceito', async () => {
  const outro = link.createPairing('x');
  const { pairing } = link.createPairing('y');
  const phone = await fakePhone(outro.qr);
  try {
    await assert.rejects(link.requestUnlock(pairing, opts(phone)), (e) => e.code === 'not_found' && /Pareamento desconhecido/.test(e.message));
  } finally { phone.close(); }
});

test('resposta de aprovação forjada sem o segredo não abre o cofre', async () => {
  const { pairing, qr } = link.createPairing('x');
  const p = link.parsePairingQr(qr);
  const hello = link.buildHello(pairing, 'unlock');
  const falso = link.sealApproval(Buffer.alloc(32, 7), p.pairId, hello.nonce, p.unlockKey);
  assert.throws(() => link.openApproval(pairing, hello.nonce, falso));
  const certo = link.sealApproval(p.secret, p.pairId, hello.nonce, p.unlockKey);
  assert.ok(link.openApproval(pairing, hello.nonce, certo).equals(p.unlockKey));
});

test('hello adulterado ou antigo é recusado pelo celular', () => {
  const { pairing } = link.createPairing('x');
  const hello = link.buildHello(pairing, 'unlock');
  assert.ok(link.verifyHello(pairing.secret, hello));
  assert.ok(!link.verifyHello(pairing.secret, { ...hello, op: 'pair' }));
  assert.ok(!link.verifyHello(pairing.secret, { ...hello, name: 'Outro PC' }));
  assert.ok(!link.verifyHello(pairing.secret, hello, Date.now() + 10 * 60 * 1000));
});

test('sem celular na rede: erro amigável', async () => {
  const { pairing } = link.createPairing('x');
  const s = net.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  s.close();
  await assert.rejects(link.requestUnlock(pairing, { hosts: ['127.0.0.1'], port }), (e) => e.code === 'not_found');
});

test('candidatos: último IP primeiro e a sub-rede /24 sem o próprio PC', () => {
  const ifs = { wlan0: [{ family: 'IPv4', address: '192.168.0.10', internal: false }], lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] };
  const h = link.candidateHosts('192.168.0.77', ifs);
  assert.strictEqual(h[0], '192.168.0.77');
  assert.strictEqual(h.length, 253);
  assert.ok(!h.includes('192.168.0.10'));
  assert.ok(!h.some(ip => ip.startsWith('127.')));
});

test('vetores fixos usados pelos testes do Android continuam válidos', () => {
  const v = require('./fixtures/phone-link-vectors.json');
  const secret = Buffer.from(v.secret, 'base64');
  assert.strictEqual(link.mac(secret, ...v.macParts), v.mac);
  assert.strictEqual(link.verificationCode(secret, v.nonce), v.code);
  const pairing = { pairId: v.pairId, secret, unlock: v.unlock };
  const unlockKey = link.openApproval(pairing, v.nonce, { data: v.approval });
  assert.strictEqual(unlockKey.toString('base64'), v.unlockKey);
  assert.strictEqual(link.openPassword(pairing, unlockKey), v.password);
});
