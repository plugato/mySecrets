// Funções puras usadas pelo background e cobertas por tests/autofill.test.js.
// Candidatos de busca para uma URL, em ordem de especificidade.
// Usado pelo background (import) e pelos testes (import dinâmico no Node).

// ponytail: heurística simples de sufixo público, sem baixar a PSL.
// Se aparecer um sufixo composto fora desta lista (ex.: .co.jp), adicione aqui.
const COMPOUND_SUFFIX = /^(com|co|net|org|gov|edu|ac)\.[a-z]{2}$/;

export function hostCandidates(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return [];
  }
  // Páginas internas (chrome://, about:, file://) não têm login a preencher.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return [];

  const host = parsed.hostname.toLowerCase();
  if (!host) return [];

  const out = [host];

  const bare = host.replace(/^www\./, '');
  if (bare !== host) out.push(bare);

  const labels = bare.split('.');
  if (labels.length > 2) {
    const tail2 = labels.slice(-2).join('.');
    out.push(COMPOUND_SUFFIX.test(tail2) ? labels.slice(-3).join('.') : tail2);
  }

  return [...new Set(out.filter(Boolean))];
}

// O código de pareamento vem colado pelo usuário: decodifica e valida.
export function parsePairingCode(code) {
  let conn;
  try {
    conn = JSON.parse(atob(String(code).trim()));
  } catch (_) {
    throw new Error('Código inválido');
  }
  return validConn(conn);
}

// Só aceita loopback, senão um código (ou resposta) malicioso apontaria a
// extensão (e o token) para um servidor remoto.
export function validConn(conn) {
  if (!conn || typeof conn.url !== 'string' || typeof conn.token !== 'string' || !conn.token) {
    throw new Error('Código incompleto');
  }
  let u;
  try {
    u = new URL(conn.url);
  } catch (_) {
    throw new Error('Código inválido');
  }
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(u.hostname)) {
    throw new Error('Código aponta para fora do seu computador');
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
