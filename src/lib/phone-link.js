/**
 * MySecrets - Ligação com o celular Android pela rede Wi-Fi (sem servidor)
 *
 * Permite desbloquear o cofre no PC aprovando no celular com a digital.
 *
 * PAREAMENTO (uma vez, com o cofre aberto no PC):
 *   O PC sorteia duas chaves de 32 bytes:
 *     S   = segredo do pareamento (autentica as mensagens nos dois sentidos)
 *     K_d = chave de desbloqueio
 *   A senha mestra é cifrada com K_d (AES-256-GCM) e só esse resultado fica no
 *   PC. K_d e S vão para o celular dentro do QR code mostrado na tela; o
 *   celular guarda K_d no Android Keystore, liberada só pela digital. O PC
 *   esquece K_d: sem o celular, o arquivo do PC não abre o cofre.
 *
 * DESBLOQUEIO (o celular precisa estar com o app aberto na mesma rede):
 *   1. O PC procura o celular: tenta o último IP conhecido e depois a sub-rede
 *      local (/24) na porta PHONE_PORT. Só conexões de saída no PC — nada de
 *      firewall pedindo permissão.
 *   2. O PC manda "hello" (op unlock) com nonce, horário e HMAC(S).
 *   3. O celular confere o HMAC e responde "pending"; os dois mostram o mesmo
 *      código de 6 dígitos (derivado de S e do nonce).
 *   4. O usuário toca em Aprovar e encosta o dedo: o celular devolve K_d cifrada
 *      com uma chave derivada de S + nonce (AES-256-GCM, vale só para esse
 *      pedido). O PC abre a senha mestra com K_d e desbloqueia normalmente.
 *
 * Protocolo: uma mensagem JSON por linha (\n) sobre TCP. Versão 1.
 * O lado do celular está em android/app/src/main/java/.../link/.
 */

const crypto = require('crypto');
const net = require('net');
const os = require('os');

const PHONE_PORT = 47653;
const PROTO = 'mysecrets-link-v1';
const QR_PREFIX = 'mysecrets-pair:1:';
const MAX_LINE = 16 * 1024;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ===== Primitivas =====

/** HMAC-SHA256(S, "mysecrets-link-v1|p1|p2|...") */
function hmac(secret, ...parts) {
  return crypto.createHmac('sha256', secret).update([PROTO, ...parts].join('|'), 'utf8').digest();
}

function mac(secret, ...parts) {
  return hmac(secret, ...parts).toString('base64');
}

function macOk(secret, provided, ...parts) {
  if (typeof provided !== 'string') return false;
  const esperado = hmac(secret, ...parts);
  const recebido = Buffer.from(provided, 'base64');
  return recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado);
}

/** Código de 6 dígitos mostrado no PC e no celular ("123 456"). */
function verificationCode(secret, nonce) {
  const n = hmac(secret, 'code', nonce).readUInt32BE(0) % 1000000;
  const s = String(n).padStart(6, '0');
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

/** Chave AES de uso único para a resposta de um pedido de desbloqueio. */
function responseKey(secret, nonce) {
  return hmac(secret, 'unlock-key', nonce);
}

/** AES-256-GCM no formato Java/Android: iv(12) || ciphertext || tag(16). */
function gcmSeal(key, plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]);
}

function gcmOpen(key, sealed, aad) {
  if (!Buffer.isBuffer(sealed) || sealed.length < 12 + 16) throw new Error('Dados cifrados inválidos');
  const iv = sealed.subarray(0, 12);
  const tag = sealed.subarray(sealed.length - 16);
  const ct = sealed.subarray(12, sealed.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  if (aad) d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

// ===== Pareamento =====

/**
 * Cria um pareamento novo. Devolve:
 *   pairing  { pairId, name, secret (Buffer), unlock (base64) } — o que o PC guarda
 *   qr       texto do QR code (contém S e K_d — mostrar só na tela)
 */
function createPairing(masterPassword, desktopName = os.hostname()) {
  if (!masterPassword) throw new Error('Senha mestra ausente');
  const pairId = crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(32);
  const unlockKey = crypto.randomBytes(32);
  const unlock = gcmSeal(unlockKey, Buffer.from(masterPassword, 'utf8'), pairId).toString('base64');
  const qr = QR_PREFIX + b64url(Buffer.from(JSON.stringify({
    p: pairId,
    n: desktopName,
    s: secret.toString('base64'),
    k: unlockKey.toString('base64')
  }), 'utf8'));
  unlockKey.fill(0);
  return { pairing: { pairId, name: desktopName, secret, unlock }, qr };
}

/** Lê o texto do QR (usado pelos testes e como referência do formato). */
function parsePairingQr(text) {
  if (typeof text !== 'string' || !text.startsWith(QR_PREFIX)) throw new Error('QR code não é do MySecrets');
  const d = JSON.parse(fromB64url(text.slice(QR_PREFIX.length)).toString('utf8'));
  if (!d.p || !d.s || !d.k) throw new Error('QR code incompleto');
  return { pairId: d.p, name: d.n || '', secret: Buffer.from(d.s, 'base64'), unlockKey: Buffer.from(d.k, 'base64') };
}

/** Abre a senha mestra guardada no PC com a K_d que veio do celular. */
function openPassword(pairing, unlockKey) {
  return gcmOpen(unlockKey, Buffer.from(pairing.unlock, 'base64'), pairing.pairId).toString('utf8');
}

// ===== Mensagens =====

function buildHello(pairing, op, desktopName = pairing.name) {
  const nonce = b64url(crypto.randomBytes(16));
  const ts = Date.now();
  return {
    v: 1, op, pair: pairing.pairId, name: desktopName, nonce, ts,
    mac: mac(pairing.secret, 'hello', op, pairing.pairId, nonce, ts, desktopName)
  };
}

/** Lado do celular (referência + testes): confere um hello recebido. */
function verifyHello(secret, msg, now = Date.now()) {
  if (!msg || msg.v !== 1 || !['pair', 'unlock'].includes(msg.op)) return false;
  if (Math.abs(now - Number(msg.ts)) > CLOCK_SKEW_MS) return false;
  return macOk(secret, msg.mac, 'hello', msg.op, msg.pair, msg.nonce, msg.ts, msg.name);
}

/** Lado do celular (referência + testes): resposta de aprovação. */
function sealApproval(secret, pairId, nonce, unlockKey) {
  return { type: 'approve', data: gcmSeal(responseKey(secret, nonce), unlockKey, `${pairId}|${nonce}`).toString('base64') };
}

function openApproval(pairing, nonce, msg) {
  return gcmOpen(responseKey(pairing.secret, nonce), Buffer.from(String(msg.data || ''), 'base64'), `${pairing.pairId}|${nonce}`);
}

/** Primeira resposta válida do celular a um hello (pending/paired). */
function validFirstReply(pairing, hello, msg) {
  if (!msg) return false;
  const esperado = hello.op === 'pair' ? 'paired' : 'pending';
  return msg.type === esperado && macOk(pairing.secret, msg.mac, msg.type, hello.nonce, msg.phone || '');
}

// ===== Rede =====

/** IPs a tentar: último conhecido primeiro, depois as sub-redes /24 locais. */
function candidateHosts(lastIp, interfaces = os.networkInterfaces()) {
  const hosts = [];
  const add = (ip) => { if (ip && !hosts.includes(ip)) hosts.push(ip); };
  add(lastIp);
  for (const lista of Object.values(interfaces || {})) {
    for (const i of lista || []) {
      if (i.family !== 'IPv4' && i.family !== 4) continue;
      if (i.internal || !/^(10|172|192)\./.test(i.address)) continue;
      const proprio = i.address;
      const base = proprio.split('.').slice(0, 3).join('.');
      for (let n = 1; n < 255; n++) {
        const ip = `${base}.${n}`;
        if (ip !== proprio) add(ip);
      }
    }
  }
  return hosts;
}

/** Socket TCP com leitura por linha. */
class LineConn {
  constructor(socket) {
    this.socket = socket;
    this.buf = '';
    this.lines = [];
    this.waiters = [];
    this.closed = false;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buf += chunk;
      if (this.buf.length > MAX_LINE) { this.close(); return; }
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        let msg = null;
        try { msg = JSON.parse(line); } catch (_) { /* linha inválida */ }
        const w = this.waiters.shift();
        if (w) w.resolve(msg); else this.lines.push(msg);
      }
    });
    const fim = () => {
      this.closed = true;
      this.waiters.splice(0).forEach(w => w.reject(new Error('Conexão encerrada pelo celular')));
    };
    socket.on('close', fim);
    socket.on('error', fim);
  }

  send(obj) {
    this.socket.write(JSON.stringify(obj) + '\n');
  }

  next(timeoutMs) {
    if (this.lines.length) return Promise.resolve(this.lines.shift());
    if (this.closed) return Promise.reject(new Error('Conexão encerrada pelo celular'));
    return new Promise((resolve, reject) => {
      const w = {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); }
      };
      const t = setTimeout(() => {
        const idx = this.waiters.indexOf(w);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(Object.assign(new Error('Tempo esgotado esperando o celular'), { code: 'timeout' }));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  close() {
    this.closed = true;
    try { this.socket.destroy(); } catch (_) {}
  }
}

function connect(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const t = setTimeout(() => { socket.destroy(); reject(new Error('timeout')); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(t); resolve(new LineConn(socket)); });
    socket.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Procura o celular pareado: conecta nos candidatos (em paralelo), manda o
 * hello e fica com o primeiro que responder com HMAC válido.
 * Devolve { conn, host, hello, reply }.
 */
async function findPhone(pairing, op, opts = {}) {
  const port = opts.port || PHONE_PORT;
  const hosts = opts.hosts || candidateHosts(opts.lastIp);
  const connectTimeout = opts.connectTimeout || 800;
  const replyTimeout = opts.replyTimeout || 4000;
  const concurrency = opts.concurrency || 64;
  const signal = opts.signal;

  let achado = null;
  let ultimoErro = null;
  const abertas = new Set();

  const tentar = async (host) => {
    if (achado || (signal && signal.aborted)) return;
    let conn;
    try {
      conn = await connect(host, port, connectTimeout);
    } catch (_) {
      return;
    }
    if (achado || (signal && signal.aborted)) { conn.close(); return; }
    abertas.add(conn);
    try {
      const hello = buildHello(pairing, op, opts.desktopName || pairing.name);
      conn.send(hello);
      const reply = await conn.next(replyTimeout);
      if (!achado && validFirstReply(pairing, hello, reply)) {
        achado = { conn, host, hello, reply };
        abertas.delete(conn);
        return;
      }
      if (reply && reply.type === 'error' && reply.message) ultimoErro = reply.message;
    } catch (_) { /* não é o celular */ }
    abertas.delete(conn);
    conn.close();
  };

  // Último IP conhecido primeiro (resposta quase instantânea no caso comum)
  const fila = hosts.slice();
  if (opts.lastIp && fila[0] === opts.lastIp) await tentar(fila.shift());

  const trabalhadores = Array.from({ length: Math.min(concurrency, fila.length) }, async () => {
    while (fila.length && !achado && !(signal && signal.aborted)) await tentar(fila.shift());
  });
  await Promise.all(trabalhadores);
  abertas.forEach(c => c.close());

  if (signal && signal.aborted) throw Object.assign(new Error('Cancelado'), { code: 'cancelled' });
  if (!achado) {
    throw Object.assign(new Error(ultimoErro
      ? `O celular respondeu: ${ultimoErro}`
      : 'Celular não encontrado. Abra o MySecrets no Android, na mesma rede Wi-Fi do PC.'), { code: 'not_found' });
  }
  return achado;
}

/**
 * Confirma o pareamento: o celular (que acabou de ler o QR) responde com o nome.
 * Devolve { phoneName, host }.
 */
async function confirmPairing(pairing, opts = {}) {
  const { conn, host, reply } = await findPhone(pairing, 'pair', opts);
  conn.close();
  return { phoneName: String(reply.phone || 'Android').slice(0, 80), host };
}

/**
 * Pede o desbloqueio ao celular. onStatus recebe
 *   { stage: 'searching' } e { stage: 'waiting', code, phoneName }.
 * Devolve { password, host }.
 */
async function requestUnlock(pairing, opts = {}) {
  const onStatus = opts.onStatus || (() => {});
  onStatus({ stage: 'searching' });
  const { conn, host, hello, reply } = await findPhone(pairing, 'unlock', opts);
  const cancelar = () => conn.close();
  if (opts.signal) opts.signal.addEventListener('abort', cancelar, { once: true });

  try {
    onStatus({ stage: 'waiting', code: verificationCode(pairing.secret, hello.nonce), phoneName: reply.phone || '' });
    let resposta;
    try {
      resposta = await conn.next(opts.approvalTimeout || 90 * 1000);
    } catch (e) {
      if (opts.signal && opts.signal.aborted) throw Object.assign(new Error('Cancelado'), { code: 'cancelled' });
      throw e;
    }
    if (resposta && resposta.type === 'deny' && macOk(pairing.secret, resposta.mac, 'deny', hello.nonce)) {
      throw Object.assign(new Error('Pedido negado no celular'), { code: 'denied' });
    }
    if (!resposta || resposta.type !== 'approve') {
      throw new Error((resposta && resposta.message) || 'Resposta inválida do celular');
    }
    const unlockKey = openApproval(pairing, hello.nonce, resposta);
    const password = openPassword(pairing, unlockKey);
    unlockKey.fill(0);
    conn.send({ type: 'done' });
    return { password, host };
  } finally {
    if (opts.signal) opts.signal.removeEventListener('abort', cancelar);
    conn.close();
  }
}

module.exports = {
  PHONE_PORT,
  QR_PREFIX,
  mac,
  macOk,
  verificationCode,
  createPairing,
  parsePairingQr,
  openPassword,
  buildHello,
  verifyHello,
  sealApproval,
  openApproval,
  candidateHosts,
  findPhone,
  confirmPairing,
  requestUnlock
};
