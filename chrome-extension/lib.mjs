// Funções puras usadas pelo background e cobertas por tests/autofill.test.js.
// O casamento de domínio (qual login é de qual site) é feito no app, pela
// ferramenta match_url (mcp-server/core.js), com a Public Suffix List.

// Textos: tradução do navegador (_locales/*/messages.json) com o português
// do próprio código como reserva (fora do navegador, nos testes).
export function msg(chave, pt, subs) {
  const lista = subs === undefined ? [] : [].concat(subs).map(String);
  let s;
  try { s = (globalThis.chrome && chrome.i18n && chrome.i18n.getMessage(chave, lista)) || ''; } catch (_) { s = ''; }
  return s || pt.replace(/\$(\d)/g, (m, n) => (lista[n - 1] !== undefined ? lista[n - 1] : m));
}

// O código de pareamento vem colado pelo usuário: decodifica e valida.
export function parsePairingCode(code) {
  let conn;
  try {
    conn = JSON.parse(atob(String(code).trim()));
  } catch (e) {
    throw new Error(msg('pairInvalidCode', 'Código inválido'), { cause: e });
  }
  return validConn(conn);
}

// Só aceita loopback, senão um código (ou resposta) malicioso apontaria a
// extensão (e o token) para um servidor remoto.
export function validConn(conn) {
  if (!conn || typeof conn.url !== 'string' || typeof conn.token !== 'string' || !conn.token) {
    throw new Error(msg('pairIncompleteCode', 'Código incompleto'));
  }
  let u;
  try {
    u = new URL(conn.url);
  } catch (e) {
    throw new Error(msg('pairInvalidCode', 'Código inválido'), { cause: e });
  }
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(u.hostname)) {
    throw new Error(msg('pairNotLocal', 'Código aponta para fora do seu computador'));
  }
  return { url: conn.url, token: conn.token };
}

// Endereço do pareamento automático: mesmo servidor do /mcp.
export function pairUrl(mcpUrl) {
  return String(mcpUrl).replace(/\/mcp$/, '/pair');
}

// ===== Oferecer para salvar logins =====

// Decide o que fazer com um login enviado numa página, dado o que já existe
// no cofre para o site (metadados de search_secrets, sem senha):
//   { mode: 'new' }            nada salvo para esse usuário → oferecer salvar
//   { mode: 'check', id }      já existe → o background compara a senha e,
//                              se mudou, oferece atualizar
export function saveDecision(matches, username) {
  const user = String(username || '').trim().toLowerCase();
  const list = Array.isArray(matches) ? matches : [];
  if (user) {
    const same = list.find((m) => String(m.username || '').trim().toLowerCase() === user);
    return same ? { mode: 'check', id: same.id } : { mode: 'new' };
  }
  // Sem usuário (ex.: tela só de senha): só dá para comparar se há um único login
  return list.length === 1 ? { mode: 'check', id: list[0].id } : { mode: 'new' };
}

// Host para mostrar/guardar (sem www), ou '' para páginas que não são web.
export function displayHost(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}
