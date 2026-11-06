/**
 * MySecrets - Códigos 2FA (TOTP/HOTP), usado pelo app e pelo servidor MCP.
 *
 * - "period" é o período de verdade (o otplib 12 só lia "step": entradas de
 *   60 s geravam o código de 30 s).
 * - Segredos de 80 bits (16 caracteres base32) são comuns nos serviços reais:
 *   o otplib 13 recusa menos de 128 bits por padrão, então o limite mínimo é
 *   relaxado aqui (guardrails).
 * - O segredo é normalizado (maiúsculas, sem espaços, hífens nem "=" no fim),
 *   como os sites costumam mostrar.
 * - Sem código inventado: erro é erro.
 *
 * Node puro; vai desempacotado junto com o MCP (asarUnpack).
 */

const otplib = require('otplib');

const HASHES = ['sha1', 'sha256', 'sha512'];
const GUARDRAILS = otplib.createGuardrails({ MIN_SECRET_BYTES: 1 });

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

function normalizeSecret(secret) {
  return String(secret == null ? '' : secret).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
}

function generateTotp(secret, opts = {}, now = Date.now()) {
  const o = options(opts);
  const code = otplib.generateSync({
    strategy: 'totp', secret: normalizeSecret(secret), period: o.period, digits: o.digits,
    algorithm: o.algorithm, epoch: Math.floor(now / 1000), guardrails: GUARDRAILS
  });
  const remaining = o.period - (Math.floor(now / 1000) % o.period);
  return { code, remaining, period: o.period };
}

function generateHotp(secret, counter = 0, opts = {}) {
  const o = options(opts);
  const c = Math.max(0, parseInt(counter, 10) || 0);
  const code = otplib.generateSync({
    strategy: 'hotp', secret: normalizeSecret(secret), counter: c, digits: o.digits,
    algorithm: o.algorithm, guardrails: GUARDRAILS
  });
  return { code, counter: c + 1 };
}

function verifyTotp(token, secret, opts = {}, now = Date.now()) {
  const o = options(opts);
  const janela = Math.min(Math.max(parseInt(opts.window, 10) || 1, 0), 10);
  const r = otplib.verifySync({
    strategy: 'totp', token: String(token), secret: normalizeSecret(secret), period: o.period, digits: o.digits,
    algorithm: o.algorithm, epoch: Math.floor(now / 1000), epochTolerance: janela * o.period, guardrails: GUARDRAILS
  });
  return !!(r && r.valid);
}

module.exports = { generateTotp, generateHotp, verifyTotp, options, normalizeSecret };
