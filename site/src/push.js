/**
 * POST /push — o app desktop pede para acordar o MySecrets do celular.
 *
 * Corpo: { token, data: { type: 'wake', pairId, ts, nonce, sig } }
 *  - token: token do Firebase Cloud Messaging do celular (o celular manda ao PC
 *    pela rede local; este Worker não guarda nada).
 *  - data: repassado como está. A assinatura (sig) usa o segredo do pareamento,
 *    que só o PC e o celular têm: o celular ignora push que não confere. Nada
 *    do cofre passa por aqui — o pedido de senha continua pela rede local.
 *
 * Segredo: FCM_SERVICE_ACCOUNT (JSON da conta de serviço do Firebase, com a
 * permissão "Firebase Cloud Messaging API Admin"):
 *   npx wrangler secret put FCM_SERVICE_ACCOUNT < conta-de-servico.json
 */

const CHAVES = ['type', 'pairId', 'ts', 'nonce', 'sig'];
const MAX_CORPO = 8 * 1024;

const resposta = (status, erro) =>
  new Response(erro ? JSON.stringify({ erro }) : null, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/** Confere o formato; devolve { token, data } ou uma mensagem de erro. */
export function validar(corpo) {
  if (!corpo || typeof corpo !== 'object') return 'corpo inválido';
  const { token, data } = corpo;
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096 || !/^[\w:.-]+$/.test(token)) return 'token inválido';
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'data inválido';
  const chaves = Object.keys(data).sort();
  if (chaves.join(',') !== [...CHAVES].sort().join(',')) return 'data inválido';
  for (const k of CHAVES) {
    if (typeof data[k] !== 'string' || !data[k] || data[k].length > 256) return 'data inválido';
  }
  if (data.type !== 'wake') return 'data inválido';
  return { token, data: Object.fromEntries(CHAVES.map((k) => [k, data[k]])) };
}

// ===== OAuth da conta de serviço (JWT RS256) =====

let tokenEmCache = null; // { valor, expira, projeto }

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlTexto = (s) => b64url(new TextEncoder().encode(s));

async function chavePrivada(pem) {
  const corpo = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(corpo), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

async function acessoGoogle(env, fetchFn) {
  const agora = Math.floor(Date.now() / 1000);
  if (tokenEmCache && tokenEmCache.expira - 300 > agora) return tokenEmCache;
  const conta = JSON.parse(env.FCM_SERVICE_ACCOUNT);
  const cabecalho = b64urlTexto(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const pedido = b64urlTexto(JSON.stringify({
    iss: conta.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 3600,
  }));
  const assinatura = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await chavePrivada(conta.private_key),
    new TextEncoder().encode(`${cabecalho}.${pedido}`));
  const r = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${cabecalho}.${pedido}.${b64url(assinatura)}`,
    }),
  });
  if (!r.ok) throw new Error(`OAuth do Google respondeu ${r.status}`);
  const j = await r.json();
  tokenEmCache = { valor: j.access_token, expira: agora + (j.expires_in || 3600), projeto: conta.project_id };
  return tokenEmCache;
}

// ===== Rota =====

export async function handlePush(request, env, fetchFn = fetch) {
  if (!env.FCM_SERVICE_ACCOUNT) return resposta(503, 'push não configurado');
  const tamanho = Number(request.headers.get('content-length') || 0);
  if (tamanho > MAX_CORPO) return resposta(413, 'corpo grande demais');
  let corpo;
  try {
    const texto = await request.text();
    if (texto.length > MAX_CORPO) return resposta(413, 'corpo grande demais');
    corpo = JSON.parse(texto);
  } catch (_) {
    return resposta(400, 'JSON inválido');
  }
  const v = validar(corpo);
  if (typeof v === 'string') return resposta(400, v);

  // Limites: por IP (abuso em geral) e por token (não deixa encher um celular de push)
  const ip = request.headers.get('cf-connecting-ip') || 'sem-ip';
  for (const chave of [`ip:${ip}`, `tok:${v.token.slice(-64)}`]) {
    if (env.PUSH_LIMIT && !(await env.PUSH_LIMIT.limit({ key: chave })).success) return resposta(429, 'muitos pedidos');
  }

  let acesso;
  try {
    acesso = await acessoGoogle(env, fetchFn);
  } catch (e) {
    console.error('push: OAuth falhou', e.message);
    return resposta(502, 'falha ao autenticar no Firebase');
  }
  const r = await fetchFn(`https://fcm.googleapis.com/v1/projects/${acesso.projeto}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${acesso.valor}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: v.token,
        data: v.data,
        // Alta prioridade: acorda o celular em modo soneca e libera o serviço em primeiro plano
        android: { priority: 'HIGH', ttl: '60s' },
      },
    }),
  });
  if (r.ok) return resposta(204);
  // Token velho (app desinstalado/reinstalado): o PC deve esquecer
  if (r.status === 404 || r.status === 400) {
    const txt = await r.text();
    if (/UNREGISTERED|INVALID_ARGUMENT/.test(txt)) return resposta(410, 'token inválido ou expirado');
  }
  if (r.status === 401) tokenEmCache = null;
  console.error('push: FCM respondeu', r.status);
  return resposta(502, `Firebase respondeu ${r.status}`);
}
