/**
 * MySecrets - Consulta de senhas vazadas (Have I Been Pwned, "range API").
 *
 * k-anonymity: só os 5 primeiros caracteres do SHA-1 da senha saem do
 * computador. A API devolve todos os sufixos com esse prefixo (com
 * preenchimento aleatório, Add-Padding) e a comparação é feita localmente,
 * no renderer. Este módulo nunca recebe senha nem hash completo.
 */

const API = 'https://api.pwnedpasswords.com/range/';
const PREFIXO = /^[0-9A-F]{5}$/;

async function fetchRange(prefix, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const p = String(prefix || '').toUpperCase();
  if (!PREFIXO.test(p)) throw new Error('Prefixo inválido');
  const res = await fetchImpl(API + p, {
    headers: { 'Add-Padding': 'true', 'User-Agent': 'MySecrets-password-health' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`Serviço de senhas vazadas respondeu HTTP ${res.status}`);
  return res.text();
}

/** "SUFIXO:CONTAGEM" por linha -> Map(sufixo -> contagem); linhas de preenchimento têm contagem 0. */
function parseRange(texto) {
  const out = new Map();
  for (const linha of String(texto).split(/\r?\n/)) {
    const m = /^([0-9A-Fa-f]{35}):(\d+)$/.exec(linha.trim());
    if (m) out.set(m[1].toUpperCase(), parseInt(m[2], 10));
  }
  return out;
}

module.exports = { fetchRange, parseRange };
