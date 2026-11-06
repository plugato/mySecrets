/**
 * MySecrets - Códigos 2FA (TOTP/HOTP), usado pelo app e pelo servidor MCP.
 *
 * Antes cada um tinha a sua versão. A do app passava "period" ao otplib, que
 * só entende "step": entradas de 60 s geravam o código de 30 s (errado). E,
 * se o otplib não carregasse, inventava um código a partir de um hash. Aqui
 * não há código inventado: erro é erro.
 *
 * Node puro; vai desempacotado junto com o MCP (asarUnpack).
 */

const { authenticator, hotp } = require('otplib');

const HASHES = ['sha1', 'sha256', 'sha512'];

/** Opções válidas: dígitos 6–8, período 1–3600 s, hash sha1/sha256/sha512. */
function options({ digits = 6, period = 30, algorithm = 'sha1' } = {}) {
  const d = parseInt(digits, 10);
  const p = parseInt(period, 10);
  const a = String(algorithm || 'sha1').toLowerCase();
  return {
    digits: d >= 6 && d <= 8 ? d : 6,
    period: p >= 1 && p <= 3600 ? p : 30,
    // mfaAlgorithm (totp/hotp) já foi passado aqui por engano: vira sha1
    algorithm: HASHES.includes(a) ? a : 'sha1'
  };
}

function generateTotp(secret, opts = {}, now = Date.now()) {
  const o = options(opts);
  const code = authenticator.clone({ step: o.period, digits: o.digits, algorithm: o.algorithm, epoch: now }).generate(secret);
  const remaining = o.period - (Math.floor(now / 1000) % o.period);
  return { code, remaining, period: o.period };
}

function generateHotp(secret, counter = 0, opts = {}) {
  const o = options(opts);
  const c = Math.max(0, parseInt(counter, 10) || 0);
  const code = hotp.clone({ digits: o.digits, algorithm: o.algorithm }).generate(secret, c);
  return { code, counter: c + 1 };
}

function verifyTotp(token, secret, opts = {}, now = Date.now()) {
  const o = options(opts);
  const window = Math.min(Math.max(parseInt(opts.window, 10) || 1, 0), 10);
  return authenticator.clone({ step: o.period, digits: o.digits, algorithm: o.algorithm, epoch: now, window })
    .check(String(token), secret);
}

module.exports = { generateTotp, generateHotp, verifyTotp, options };
