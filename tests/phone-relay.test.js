// Aprovação pelo celular de qualquer lugar: criptografia, caixa postal do
// Worker (site/src/relay-core.js) e o fluxo completo com um celular simulado.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');
const link = require('../src/lib/phone-link');
const relay = require('../src/lib/phone-relay');
const vectors = require('./fixtures/relay-vectors.json');

const loadCore = () => import(path.join(__dirname, '..', 'site', 'src', 'relay-core.js'));

/** Storage em memória com a mesma interface do Durable Object. */
function memStorage() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async put(k, v) { m.set(k, structuredClone(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return new Map([...m].filter(([k]) => k.startsWith(prefix))); }
  };
}

/** fetch falso: /relay/{canal}/... vai para uma Mailbox por canal; /push anota. */
async function fakeNet() {
  const { Mailbox } = await loadCore();
  const boxes = new Map();
  const pushes = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/push') {
      pushes.push(JSON.parse(init.body));
      return { ok: true, status: 204 };
    }
    const parts = u.pathname.split('/');
    const canal = parts[2];
    if (!boxes.has(canal)) boxes.set(canal, new Mailbox(memStorage()));
    const call = boxes.get(canal).handle(init.method || 'GET', parts.slice(3).join('/'),
      init.body ? JSON.parse(init.body) : null, Object.fromEntries(u.searchParams));
    // Como o fetch de verdade: abortar derruba a espera
    const r = await (init.signal ? Promise.race([call, new Promise((_, rej) => {
      if (init.signal.aborted) rej(new Error('abort'));
      init.signal.addEventListener('abort', () => rej(new Error('abort')), { once: true });
    })]) : call);
    return { ok: r.status < 300, status: r.status, json: async () => r.json };
  };
  return { fetch, pushes, boxes };
}

const BASE = { url: 'https://relay.test/relay', pushUrl: 'https://relay.test/push' };

/** Celular simulado: busca o canal e responde o primeiro pedido. */
async function phoneAnswers(net, qr, answer, { waitMs = 5 } = {}) {
  const p = link.parsePairingQr(qr);
  const ch = relay.channelId(p.secret);
  for (let i = 0; i < 200; i++) {
    const r = await net.fetch(`${BASE.url}/${ch}`);
    const { items } = await r.json();
    if (items && items.length) {
      const it = items[0];
      const req = relay.openRequest(p.secret, p.pairId, it.reqId, it.box);
      const a = typeof answer === 'function' ? answer(req, p) : answer;
      const msg = relay.sealAnswer(p.secret, p.pairId, it.reqId, req.epk, a);
      const res = await net.fetch(`${BASE.url}/${ch}/${it.reqId}/answer`, { method: 'POST', body: JSON.stringify(msg) });
      return { req, status: res.status };
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
  throw new Error('nenhum pedido chegou');
}

test('vetores: canal, chaves, ECDH e caixas iguais às do Android', () => {
  const S = Buffer.from(vectors.S_hex, 'hex');
  assert.strictEqual(relay.channelId(S), vectors.channelId);
  assert.strictEqual(relay.requestKey(S, vectors.reqId).toString('hex'), vectors.requestKey_hex);
  const req = relay.openRequest(S, vectors.pairId, vectors.reqId, vectors.requestBox_b64, 1700000001000);
  assert.deepStrictEqual(req, JSON.parse(vectors.requestJson));
  const pcPriv = crypto.createPrivateKey({ key: Buffer.from(vectors.pcPrivatePkcs8_b64, 'base64'), format: 'der', type: 'pkcs8' });
  assert.strictEqual(relay.ecdh(pcPriv, vectors.phonePublicSpki_b64).toString('hex'), vectors.ecdhShared_hex);
  const ans = relay.openAnswer(S, vectors.pairId, vectors.reqId, pcPriv, { epk: vectors.phonePublicSpki_b64, box: vectors.answerBox_b64 });
  assert.deepStrictEqual(ans, JSON.parse(vectors.answerJson));
  assert.ok(relay.verifyRelayPush(S, vectors.relayPush, 1700000000500));
  assert.strictEqual(link.verificationCode(S, vectors.reqId), vectors.unlockCode_for_reqId);
});

test('pedido não abre com outro segredo, vencido ou trocado de id', () => {
  const { pairing } = link.createPairing('x');
  const r = relay.sealRequest(pairing, { kind: 'read', summary: { tool: 'get_otp' }, expiresAt: Date.now() + 60000 });
  assert.throws(() => relay.openRequest(crypto.randomBytes(32), pairing.pairId, r.reqId, r.box));
  assert.throws(() => relay.openRequest(pairing.secret, pairing.pairId, 'outro-id-qualquer', r.box));
  assert.throws(() => relay.openRequest(pairing.secret, pairing.pairId, r.reqId, r.box, Date.now() + 120000), /vencido/);
  assert.strictEqual(relay.openRequest(pairing.secret, pairing.pairId, r.reqId, r.box).summary.tool, 'get_otp');
});

test('resposta só abre com a chave efêmera do pedido e o id certo', () => {
  const { pairing } = link.createPairing('x');
  const r = relay.sealRequest(pairing, { kind: 'write', expiresAt: Date.now() + 60000 });
  const msg = relay.sealAnswer(pairing.secret, pairing.pairId, r.reqId, r.body.epk, { decision: 'deny' });
  assert.strictEqual(relay.openAnswer(pairing.secret, pairing.pairId, r.reqId, r.privateKey, msg).decision, 'deny');
  const outra = relay.sealRequest(pairing, { kind: 'write', expiresAt: Date.now() + 60000 });
  assert.throws(() => relay.openAnswer(pairing.secret, pairing.pairId, r.reqId, outra.privateKey, msg));
  assert.throws(() => relay.openAnswer(pairing.secret, pairing.pairId, outra.reqId, r.privateKey, msg));
});

test('caixa postal: lista pedidos sem resposta, guarda a resposta uma vez e respeita o prazo', async () => {
  const { Mailbox } = await loadCore();
  let agora = 1000000;
  const mb = new Mailbox(memStorage(), () => agora);
  assert.strictEqual((await mb.handle('POST', '', { reqId: 'abcdefgh', box: 'AAAA', exp: agora + 60000 })).status, 204);
  assert.strictEqual((await mb.handle('POST', '', { reqId: 'abcdefgh', box: 'AAAA', exp: agora + 60000 })).status, 409);
  assert.strictEqual((await mb.handle('POST', '', { reqId: 'eabcdefgh', exp: agora + 60000, listen: true })).status, 204);
  assert.strictEqual((await mb.handle('POST', '', { reqId: 'x', box: 'AAAA', exp: agora + 60000 })).status, 400);
  assert.strictEqual((await mb.handle('POST', '', { reqId: 'muitolongo', box: 'AAAA', exp: agora + 60 * 60000 })).status, 400);
  let lista = await mb.handle('GET', '', null);
  assert.deepStrictEqual(lista.json.items, [{ reqId: 'abcdefgh', box: 'AAAA' }]); // a escuta não aparece
  assert.strictEqual((await mb.handle('GET', 'abcdefgh/answer', null, {})).status, 204);
  assert.strictEqual((await mb.handle('POST', 'abcdefgh/answer', { epk: 'QQ==', box: 'QQ==' })).status, 204);
  assert.strictEqual((await mb.handle('POST', 'abcdefgh/answer', { epk: 'QQ==', box: 'QQ==' })).status, 410);
  assert.deepStrictEqual((await mb.handle('GET', 'abcdefgh/answer', null, {})).json, { epk: 'QQ==', box: 'QQ==' });
  lista = await mb.handle('GET', '', null);
  assert.deepStrictEqual(lista.json.items, []);
  agora += 61000;
  assert.strictEqual((await mb.handle('GET', 'abcdefgh/answer', null, {})).status, 404);
  assert.strictEqual((await mb.handle('POST', 'eabcdefgh/answer', { epk: 'QQ==', box: 'QQ==' })).status, 410);
});

test('caixa postal: long-poll acorda quando a resposta chega', async () => {
  const { Mailbox } = await loadCore();
  const mb = new Mailbox(memStorage());
  await mb.handle('POST', '', { reqId: 'abcdefgh', box: 'AAAA', exp: Date.now() + 60000 });
  const inicio = Date.now();
  const espera = mb.handle('GET', 'abcdefgh/answer', null, { wait: '5' });
  setTimeout(() => mb.handle('POST', 'abcdefgh/answer', { epk: 'QQ==', box: 'QQ==' }), 50);
  const r = await espera;
  assert.strictEqual(r.status, 200);
  assert.ok(Date.now() - inicio < 2000);
});

test('leitura aprovada por 5 min no celular: devolve a senha conferida e o modo', async () => {
  const net = await fakeNet();
  const { pairing, qr } = link.createPairing('senha mestra');
  const pedidoP = relay.requestApproval([{ pairing, pushToken: 'tok-'.padEnd(30, 'x'), phoneName: 'Pixel' }], {
    ...BASE, fetch: net.fetch, kind: 'read', summary: { tool: 'get_credentials', query: 'github' },
    client: 'claude-code', deadline: Date.now() + 30000, windowMinutes: 5
  });
  const { req, status } = await phoneAnswers(net, qr, (r, p) => ({ decision: 'approve', mode: 'window', minutes: 5, kd: p.unlockKey }));
  assert.strictEqual(status, 204);
  assert.strictEqual(req.kind, 'read');
  assert.strictEqual(req.client, 'claude-code');
  assert.deepStrictEqual(req.summary, { tool: 'get_credentials', query: 'github' });
  const r = await pedidoP;
  assert.strictEqual(r.decision, 'approve');
  assert.strictEqual(r.password, 'senha mestra');
  assert.strictEqual(r.mode, 'window');
  assert.strictEqual(r.minutes, 5);
  assert.strictEqual(r.phoneName, 'Pixel');
  // push assinado com S, sem nada do pedido; quem respondeu não recebe outro
  assert.strictEqual(net.pushes.length, 1);
  const push = net.pushes[0];
  assert.strictEqual(push.data.type, 'relay');
  assert.ok(relay.verifyRelayPush(pairing.secret, push.data));
  // pedido retirado da caixa postal
  const ch = relay.channelId(pairing.secret);
  assert.deepStrictEqual((await (await net.fetch(`${BASE.url}/${ch}`)).json()).items, []);
});

test('aprovação sem K_d válida não vale (quem só tem S não aprova)', async () => {
  const net = await fakeNet();
  const { pairing, qr } = link.createPairing('senha');
  const pedidoP = relay.requestApproval([{ pairing }], { ...BASE, fetch: net.fetch, kind: 'write', deadline: Date.now() + 30000 });
  await phoneAnswers(net, qr, { decision: 'approve', kd: crypto.randomBytes(32) });
  await assert.rejects(pedidoP, (e) => e.code === 'invalid');
});

test('negado no celular; prazo esgotado; cancelado pelo PC', async () => {
  const net = await fakeNet();
  const { pairing, qr } = link.createPairing('s');
  const negado = relay.requestApproval([{ pairing }], { ...BASE, fetch: net.fetch, kind: 'write', deadline: Date.now() + 30000 });
  await phoneAnswers(net, qr, { decision: 'deny' });
  assert.strictEqual((await negado).decision, 'deny');

  await assert.rejects(relay.requestApproval([{ pairing }], { ...BASE, fetch: net.fetch, kind: 'read', deadline: Date.now() + 300 }),
    (e) => e.code === 'expired');

  const ctl = new AbortController();
  const antes = net.pushes.length;
  const cancelado = relay.requestApproval([{ pairing, pushToken: 'tok-'.padEnd(30, 'x') }], { ...BASE, fetch: net.fetch, kind: 'read', deadline: Date.now() + 30000, signal: ctl.signal });
  setTimeout(() => ctl.abort(), 50);
  await assert.rejects(cancelado, (e) => e.code === 'cancelled');
  // Um push para mostrar o pedido e outro para o celular apagar a notificação
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(net.pushes.length - antes, 2);
});

test('sem internet: erro offline na hora', async () => {
  const { pairing } = link.createPairing('s');
  const fetch = async () => { throw new Error('ENOTFOUND'); };
  await assert.rejects(relay.requestApproval([{ pairing }], { ...BASE, fetch, kind: 'write', deadline: Date.now() + 30000 }),
    (e) => e.code === 'offline');
});

test('fim antecipado da liberação: o celular manda "end" para a escuta', async () => {
  const net = await fakeNet();
  const { pairing, qr } = link.createPairing('senha');
  const pedidoP = relay.requestApproval([{ pairing }], { ...BASE, fetch: net.fetch, kind: 'read', deadline: Date.now() + 30000 });
  const { req } = await phoneAnswers(net, qr, (r, p) => ({ decision: 'approve', mode: 'window', minutes: 15, kd: p.unlockKey }));
  const aprov = await pedidoP;
  assert.strictEqual(aprov.minutes, 15);

  const fimP = relay.listenForEnd(aprov, { fetch: net.fetch, url: BASE.url, until: Date.now() + 30000 });
  const p = link.parsePairingQr(qr);
  const ch = relay.channelId(p.secret);
  const id = relay.endId(req.reqId);
  let st = 0;
  for (let i = 0; i < 100 && st !== 204; i++) {
    const msg = relay.sealAnswer(p.secret, p.pairId, id, req.epk, { decision: 'end' });
    st = (await net.fetch(`${BASE.url}/${ch}/${id}/answer`, { method: 'POST', body: JSON.stringify(msg) })).status;
    if (st !== 204) await new Promise((r) => setTimeout(r, 5));
  }
  assert.strictEqual(await fimP, true);
});

test('tempo da liberação: só 5, 15 ou 30 minutos', () => {
  assert.strictEqual(relay.windowMinutes(15), 15);
  assert.strictEqual(relay.windowMinutes('30'), 30);
  assert.strictEqual(relay.windowMinutes(999), 5);
  assert.strictEqual(relay.windowMinutes(undefined), 5);
});
