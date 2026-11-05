/**
 * MySecrets - Conferência de backups antes de importar (Node puro, testável).
 */

const fs = require('fs');
const vaultCrypto = require('./vault-crypto');

/**
 * Confere um arquivo de backup antes de importar. Devolve
 * { ok: false, error } se não é um cofre do MySecrets, ou
 * { ok: true, opensWithCurrent } com true/false se abre com a senha atual
 * (null quando o cofre está bloqueado e não dá para testar).
 */
function inspectBackup(file, currentPassword) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return { ok: false, error: 'Este arquivo não é um backup do MySecrets.' };
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.encrypted || !parsed.salt || !parsed.iv) {
    return { ok: false, error: 'Este arquivo não é um backup do MySecrets.' };
  }
  if (!currentPassword) return { ok: true, opensWithCurrent: null };
  try {
    const entries = JSON.parse(vaultCrypto.decryptVault(parsed, currentPassword));
    if (!Array.isArray(entries)) return { ok: false, error: 'O backup abriu, mas o conteúdo não é um cofre válido.' };
    return { ok: true, opensWithCurrent: true, count: entries.length };
  } catch (e) {
    if (/iterações/.test(e.message)) return { ok: false, error: 'O arquivo de backup está corrompido ou foi adulterado.' };
    return { ok: true, opensWithCurrent: false };
  }
}

module.exports = { inspectBackup };
