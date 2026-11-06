// Implementação de referência (RFC 4226 / 6238) só com o crypto do Node, para
// os testes não dependerem da biblioteca que estão testando.
const crypto = require('node:crypto');

function base32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.toUpperCase().replace(/[\s=-]/g, '')) bits += A.indexOf(ch).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

function hotp(secret, counter, { digits = 6, algorithm = 'sha1' } = {}) {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac(algorithm, base32(secret)).update(c).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}

function totp(secret, nowMs, { period = 30, ...rest } = {}) {
  return hotp(secret, Math.floor(nowMs / 1000 / period), rest);
}

module.exports = { hotp, totp };
