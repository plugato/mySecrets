/**
 * MySecrets - Aprovação pelo celular de qualquer lugar (relay pela internet)
 *
 * A ligação pela rede local (phone-link.js) só funciona com o celular no mesmo
 * Wi-Fi. Para aprovar pedidos de agentes (gravar, ler) e o login do PC estando
 * fora de casa, o PC e o celular trocam mensagens por uma CAIXA POSTAL no site
 * (Worker + Durable Object, site/src/relay.js). O Worker só vê dados cifrados:
 *
 *   canal   = hex(HMAC(S, "relay-channel"))[0..32]   — id opaco por pareamento
 *   pedido  = AES-256-GCM(HMAC(S, "relay-req" | reqId), JSON, aad "pairId|reqId")
 *   resposta: o celular gera um par P-256 efêmero e faz ECDH com a chave
 *             efêmera do PC que veio no pedido (epk):
 *             chave = HMAC(S, "relay-answer" | reqId | base64(ecdh))
 *             caixa = AES-256-GCM(chave, JSON, aad "pairId|reqId|answer")
 *
 * Aprovar exige a digital no celular, porque a resposta leva K_d (a chave que
 * só sai do Keystore com a digital) e o PC confere que ela abre a senha mestra
 * guardada no pareamento. Negar não leva K_d. A chave privada efêmera do PC
 * some depois do pedido: respostas gravadas não se abrem mesmo se S vazar.
 *
 * Fluxo: PC publica o pedido (POST /relay/{canal}), manda um push "relay"
 * assinado com S, o celular busca os pedidos (GET /relay/{canal}), mostra a
 * notificação e publica a resposta (POST /relay/{canal}/{reqId}/answer). O PC
 * espera a resposta com long-poll (GET .../answer?wait=20).
 *
 * Fim antecipado de uma liberação de leitura: o PC deixa uma "escuta" com id
 * "e" + reqId; o celular responde nela com decision "end" (mesma criptografia,
 * com a epk do pedido original).
 *
 * Módulo Node puro (fetch injetável) para o main e para os testes. O lado do
 * celular está em android/app/src/main/java/.../link/Relay*.kt.
 */

const crypto = require('crypto');
const { hmac, mac, macOk, gcmSeal, gcmOpen, b64url, openPassword, verificationCode } = require('./phone-link');

const RELAY_URL = process.env.MYSECRETS_RELAY_URL || 'https://mysecrets.ancalagon.com.br/relay';
const PUSH_URL = process.env.MYSECRETS_PUSH_URL || 'https://mysecrets.ancalagon.com.br/push';
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const KINDS = new Set(['write', 'read', 'unlock']);
const WINDOW_CHOICES = [5, 15, 30];

// ===== Criptografia =====

/** Id do canal (caixa postal) deste pareamento: 32 caracteres hex. */
function channelId(secret) {
  return hmac(secret, 'relay-channel').subarray(0, 16).toString('hex');
}

function requestKey(secret, reqId) {
  return hmac(secret, 'relay-req', reqId);
}

function answerKey(secret, reqId, shared) {
  return hmac(secret, 'relay-answer', reqId, Buffer.from(shared).toString('base64'));
}

const endId = (reqId) => 'e' + reqId;

function newKeyPair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
}

function exportPublic(publicKey) {
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}

function importPublic(b64) {
  const key = crypto.createPublicKey({ key: Buffer.from(String(b64 || ''), 'base64'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails.namedCurve !== 'prime256v1') {
    throw new Error('Chave do celular inválida');
  }
  return key;
}

function ecdh(privateKey, publicB64) {
  return crypto.diffieHellman({ privateKey, publicKey: importPublic(publicB64) });
}

/**
 * Monta o pedido cifrado. Devolve { reqId, box, privateKey, body }.
 * privateKey (efêmera) fica só na memória do PC enquanto o pedido existe.
 */
function sealRequest(pairing, fields, now = Date.now()) {
  if (!KINDS.has(fields.kind)) throw new Error('Tipo de pedido inválido');
  const reqId = fields.reqId || b64url(crypto.randomBytes(16));
  const { publicKey, privateKey } = newKeyPair();
  const body = {
    v: 1,
    reqId,
    pairId: pairing.pairId,
    kind: fields.kind,
    desktop: pairing.name,
    client: fields.client || 'agente',
    ts: now,
    expiresAt: fields.expiresAt,
    epk: exportPublic(publicKey),
    pending: fields.pending || 1,
    summary: fields.summary || {}
  };
  if (fields.kind === 'read') {
    body.windowMinutes = fields.windowMinutes || 5;
    body.allowWindow = fields.allowWindow !== false;
  }
  if (fields.kind === 'unlock') body.code = verificationCode(pairing.secret, reqId);
  const box = gcmSeal(requestKey(pairing.secret, reqId), Buffer.from(JSON.stringify(body), 'utf8'),
    `${pairing.pairId}|${reqId}`).toString('base64');
  return { reqId, box, privateKey, body };
}

/** Lado do celular (referência + testes): abre um pedido. */
function openRequest(secret, pairId, reqId, box, now = Date.now()) {
  const body = JSON.parse(gcmOpen(requestKey(secret, reqId), Buffer.from(String(box), 'base64'), `${pairId}|${reqId}`).toString('utf8'));
  if (body.v !== 1 || body.reqId !== reqId || body.pairId !== pairId || !KINDS.has(body.kind)) throw new Error('Pedido inválido');
  if (Math.abs(now - Number(body.ts)) > CLOCK_SKEW_MS || now > Number(body.expiresAt)) throw new Error('Pedido vencido');
  return body;
}

/**
 * Lado do celular (referência + testes): resposta a um pedido (ou à escuta de
 * fim, com id endId(reqId)). answer = { decision, mode?, minutes?, kd? (Buffer) }.
 */
function sealAnswer(secret, pairId, id, pcEpk, answer, now = Date.now()) {
  const { publicKey, privateKey } = newKeyPair();
  const shared = ecdh(privateKey, pcEpk);
  const body = { v: 1, reqId: id, decision: answer.decision, ts: now };
  if (answer.mode) body.mode = answer.mode;
  if (answer.minutes) body.minutes = answer.minutes;
  if (answer.kd) body.kd = Buffer.from(answer.kd).toString('base64');
  const box = gcmSeal(answerKey(secret, id, shared), Buffer.from(JSON.stringify(body), 'utf8'), `${pairId}|${id}|answer`);
  return { epk: exportPublic(publicKey), box: box.toString('base64') };
}

/** Abre a resposta do celular; confere id e formato. */
function openAnswer(secret, pairId, id, privateKey, msg) {
  if (!msg || typeof msg.box !== 'string' || typeof msg.epk !== 'string') throw new Error('Resposta inválida do celular');
  const shared = ecdh(privateKey, msg.epk);
  const body = JSON.parse(gcmOpen(answerKey(secret, id, shared), Buffer.from(msg.box, 'base64'), `${pairId}|${id}|answer`).toString('utf8'));
  if (body.v !== 1 || body.reqId !== id || !['approve', 'deny', 'end'].includes(body.decision)) {
    throw new Error('Resposta inválida do celular');
  }
  return body;
}

/** Push que avisa o celular de pedidos novos na caixa postal; assinado com S. */
function buildRelayPush(pairing, now = Date.now()) {
  const nonce = b64url(crypto.randomBytes(16));
  const ts = String(now);
  return { type: 'relay', pairId: pairing.pairId, ts, nonce, sig: mac(pairing.secret, 'relay', pairing.pairId, ts, nonce) };
}

function verifyRelayPush(secret, data, now = Date.now()) {
  if (!data || data.type !== 'relay') return false;
  const ts = Number(data.ts);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > CLOCK_SKEW_MS || !data.nonce) return false;
  return macOk(secret, data.sig, 'relay', data.pairId, String(data.ts), data.nonce);
}

/** Normaliza a escolha de tempo da liberação de leitura (minutos). */
function windowMinutes(n) {
  const v = parseInt(n, 10);
  return WINDOW_CHOICES.includes(v) ? v : 5;
}

// ===== HTTP (caixa postal) =====

function client(opts = {}) {
  const fetchFn = opts.fetch || globalThis.fetch;
  const base = (opts.url || RELAY_URL).replace(/\/+$/, '');
  async function call(path, { method = 'GET', body, timeoutMs = 10000, signal } = {}) {
    const ctl = new AbortController();
    const abort = () => ctl.abort();
    if (signal) {
      if (signal.aborted) ctl.abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    const timer = setTimeout(abort, timeoutMs);
    try {
      const r = await fetchFn(base + path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal
      });
      let data = null;
      if (r.status === 200) {
        try { data = await r.json(); } catch (_) { data = null; }
      }
      return { status: r.status, data };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
    }
  }
  return {
    post: (ch, item) => call(`/${ch}`, { method: 'POST', body: item }),
    list: (ch) => call(`/${ch}`),
    remove: (ch, id) => call(`/${ch}/${id}`, { method: 'DELETE' }),
    answer: (ch, id, msg) => call(`/${ch}/${id}/answer`, { method: 'POST', body: msg }),
    poll: (ch, id, waitS, signal) => call(`/${ch}/${id}/answer?wait=${waitS}`, { timeoutMs: (waitS + 10) * 1000, signal })
  };
}

async function sendRelayPush(pairing, token, opts = {}) {
  const fetchFn = opts.fetch || globalThis.fetch;
  if (!token || !fetchFn) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 5000);
  try {
    const r = await fetchFn(opts.pushUrl || PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, data: buildRelayPush(pairing) }),
      signal: ctl.signal
    });
    if (r && r.status === 410 && opts.onGone) opts.onGone();
    return !!(r && r.ok);
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/**
 * Espera a resposta de um id (pedido ou escuta) até o prazo. Devolve o corpo
 * aberto ({ decision, ... }) ou null (prazo, cancelado). Respostas que não
 * abrem (lixo de quem sabe o canal) são ignoradas.
 */
async function waitAnswer(api, pairing, ch, id, privateKey, { deadline, signal, waitS = 20, now = Date.now }) {
  while (!(signal && signal.aborted) && now() < deadline) {
    const wait = Math.max(1, Math.min(waitS, Math.ceil((deadline - now()) / 1000)));
    let r;
    try {
      r = await api.poll(ch, id, wait, signal);
    } catch (_) {
      if (signal && signal.aborted) return null;
      await sleep(2000, signal); // sem rede: tenta de novo
      continue;
    }
    if (r.status === 200 && r.data) {
      try {
        return openAnswer(pairing.secret, pairing.pairId, id, privateKey, r.data);
      } catch (_) {
        await sleep(1000, signal);
        continue;
      }
    }
    if (r.status === 404 || r.status === 410) return null; // sumiu (venceu)
    if (r.status !== 204) await sleep(2000, signal);
  }
  return null;
}

/**
 * Pede aprovação a todos os celulares pareados (com push, se houver token).
 *
 * phones: [{ pairing, pushToken?, phoneName?, onPushGone? }]
 * opts:   { kind, summary, client, deadline, windowMinutes, allowWindow,
 *           pending, signal, fetch, url, pushUrl, onPosted(info) }
 *
 * Devolve { decision: 'approve'|'deny', mode, minutes, password?, pairId,
 *           phoneName, reqId, privateKey } ou lança (code: 'offline' |
 *           'expired' | 'cancelled'). Na aprovação, password vem conferida
 *           (K_d abriu a senha mestra guardada no pareamento).
 */
async function requestApproval(phones, opts) {
  const api = client(opts);
  const now = opts.now || Date.now;
  const deadline = opts.deadline;
  const ctl = new AbortController();
  const repassar = () => ctl.abort();
  if (opts.signal) opts.signal.addEventListener('abort', repassar, { once: true });

  const postados = [];
  let respondeu = null; // pairId do celular que respondeu
  try {
    await Promise.all(phones.map(async (ph) => {
      const ch = channelId(ph.pairing.secret);
      const req = sealRequest(ph.pairing, {
        kind: opts.kind,
        summary: opts.summary,
        client: opts.client,
        expiresAt: deadline,
        windowMinutes: opts.windowMinutes,
        allowWindow: opts.allowWindow,
        pending: opts.pending
      }, now());
      let r;
      try {
        r = await api.post(ch, { reqId: req.reqId, box: req.box, exp: deadline });
      } catch (_) {
        return;
      }
      if (r.status !== 204 && r.status !== 200) return;
      postados.push({ ph, ch, req });
      sendRelayPush(ph.pairing, ph.pushToken, { fetch: opts.fetch, pushUrl: opts.pushUrl, onGone: ph.onPushGone });
    }));
    if (!postados.length) {
      throw Object.assign(new Error('Sem conexão com o serviço de aprovação pelo celular.'), { code: 'offline' });
    }
    if (opts.onPosted) {
      try {
        opts.onPosted({ phones: postados.map((p) => p.ph.phoneName || ''), code: postados[0].req.body.code });
      } catch (_) { /* aviso é melhor esforço */ }
    }

    const esperas = postados.map((p) => waitAnswer(api, p.ph.pairing, p.ch, p.req.reqId, p.req.privateKey,
      { deadline, signal: ctl.signal, now })
      .then((ans) => {
        if (!ans || ans.decision === 'end') throw new Error('sem resposta');
        return { ans, p };
      }));

    let venceu;
    try {
      venceu = await Promise.any(esperas);
    } catch (_) {
      if (opts.signal && opts.signal.aborted) throw Object.assign(new Error('Cancelado'), { code: 'cancelled' });
      throw Object.assign(new Error('O celular não respondeu a tempo.'), { code: 'expired' });
    }
    const { ans, p } = venceu;
    respondeu = p.ph.pairing.pairId;
    const out = {
      decision: ans.decision,
      pairId: p.ph.pairing.pairId,
      phoneName: p.ph.phoneName || '',
      reqId: p.req.reqId,
      privateKey: p.req.privateKey,
      channel: p.ch,
      pairing: p.ph.pairing
    };
    if (ans.decision === 'approve') {
      let kd;
      try {
        kd = Buffer.from(String(ans.kd || ''), 'base64');
        out.password = openPassword(p.ph.pairing, kd);
      } catch (_) {
        // Sem K_d válida não há prova da digital: vale como recusa
        throw Object.assign(new Error('A aprovação do celular não pôde ser conferida. Pareie o celular de novo.'), { code: 'invalid' });
      } finally {
        if (kd) kd.fill(0);
      }
      out.mode = ans.mode === 'window' ? 'window' : 'once';
      out.minutes = windowMinutes(ans.minutes || opts.windowMinutes);
    }
    return out;
  } finally {
    if (opts.signal) opts.signal.removeEventListener('abort', repassar);
    ctl.abort();
    // Tira da caixa postal o que sobrou e avisa os celulares que não
    // responderam (PC respondeu antes, venceu, agente desistiu): eles buscam
    // de novo e apagam a notificação. Quem responder antes disso recebe 410.
    await Promise.all(postados.map((p) => api.remove(p.ch, p.req.reqId).catch(() => {})));
    postados.filter((p) => p.ph.pairing.pairId !== respondeu)
      .forEach((p) => sendRelayPush(p.ph.pairing, p.ph.pushToken, { fetch: opts.fetch, pushUrl: opts.pushUrl }));
  }
}

/**
 * Durante uma liberação de leitura: deixa a escuta de fim na caixa postal e
 * espera o celular mandar "end". Resolve true (o celular encerrou) ou false.
 */
async function listenForEnd(approval, { until, signal, fetch, url, now = Date.now }) {
  const api = client({ fetch, url });
  const id = endId(approval.reqId);
  try {
    const r = await api.post(approval.channel, { reqId: id, exp: until, listen: true });
    if (r.status !== 204 && r.status !== 200) return false;
  } catch (_) {
    return false;
  }
  try {
    for (;;) {
      const ans = await waitAnswer(api, approval.pairing, approval.channel, id, approval.privateKey, { deadline: until, signal, now });
      if (!ans) return false;
      if (ans.decision === 'end') return true;
    }
  } finally {
    api.remove(approval.channel, id).catch(() => {});
  }
}

module.exports = {
  RELAY_URL,
  WINDOW_CHOICES,
  channelId,
  requestKey,
  answerKey,
  endId,
  ecdh,
  exportPublic,
  sealRequest,
  openRequest,
  sealAnswer,
  openAnswer,
  buildRelayPush,
  verifyRelayPush,
  windowMinutes,
  client,
  sendRelayPush,
  requestApproval,
  listenForEnd
};
