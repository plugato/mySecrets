/**
 * Login com Google e acesso ao Google Drive (sem dependências).
 *
 * - OAuth 2.0 para apps desktop: navegador do sistema + redirecionamento para
 *   http://127.0.0.1:<porta> + PKCE (S256).
 * - Escopo drive.file: o app só enxerga os arquivos que ele mesmo criou —
 *   nada mais do Drive do usuário.
 * - Os arquivos ficam numa pasta "MySecrets" visível no Drive.
 *
 * O Client ID vem de src/google-oauth.json (gerado no build a partir dos
 * secrets do GitHub; não fica no repositório). Em apps desktop o Google não
 * trata o client secret como segredo — ele vai junto com o app.
 */

const crypto = require('crypto');
const http = require('http');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPES = ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Lê o Client ID do build; null se este build não tem login com Google. */
function loadClientConfig() {
  try {
    const cfg = require('../google-oauth.json');
    return cfg && cfg.clientId && cfg.clientSecret ? cfg : null;
  } catch (_) {
    return null;
  }
}

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const PAGINA_OK = `<!doctype html><meta charset="utf-8"><title>MySecrets</title>
<body style="font-family:system-ui;text-align:center;padding:3rem">
<h2>✅ Conta Google conectada</h2><p>Pode fechar esta aba e voltar ao MySecrets.</p></body>`;
const PAGINA_ERRO = `<!doctype html><meta charset="utf-8"><title>MySecrets</title>
<body style="font-family:system-ui;text-align:center;padding:3rem">
<h2>Não foi possível conectar</h2><p>Volte ao MySecrets e tente de novo.</p></body>`;

/**
 * Abre o login do Google no navegador e espera o retorno no loopback.
 * Retorna { refreshToken, accessToken, expiresAt, email }.
 */
function authorize({ clientId, clientSecret }, openBrowser, timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64url(crypto.randomBytes(16));
    let redirectUri = '';
    let timer = null;

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/') { res.writeHead(404).end(); return; }

      const code = url.searchParams.get('code');
      const erro = url.searchParams.get('error');
      if (url.searchParams.get('state') !== state || (!code && !erro)) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGINA_ERRO);
        return;
      }

      const finalizar = (fn, valor) => {
        clearTimeout(timer);
        server.close();
        fn(valor);
      };

      if (erro) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGINA_ERRO);
        finalizar(reject, new Error(erro === 'access_denied' ? 'Login cancelado.' : 'Erro do Google: ' + erro));
        return;
      }

      try {
        const tokens = await postForm(TOKEN_URL, {
          code, client_id: clientId, client_secret: clientSecret,
          redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier
        });
        if (!tokens.refresh_token) throw new Error('O Google não devolveu um refresh token.');
        const info = await getJson(USERINFO_URL, tokens.access_token).catch(() => ({}));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGINA_OK);
        finalizar(resolve, {
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token,
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          email: info.email || ''
        });
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGINA_ERRO);
        finalizar(reject, e);
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}`;
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent'
      });
      timer = setTimeout(() => {
        server.close();
        reject(new Error('Tempo esgotado esperando o login do Google.'));
      }, timeoutMs);
      openBrowser(`${AUTH_URL}?${params}`);
    });
  });
}

async function postForm(url, campos) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(campos)
  });
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(corpo.error_description || corpo.error || `HTTP ${res.status}`);
    e.code = corpo.error;
    throw e;
  }
  return corpo;
}

async function getJson(url, accessToken) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Revoga o acesso do app na conta Google (melhor esforço). */
async function revoke(token) {
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' });
  } catch (_) { /* offline: o token expira/é removido localmente mesmo assim */ }
}

/**
 * Cliente do Drive com renovação automática do access token.
 * Erro com code 'invalid_grant' = acesso revogado: o usuário precisa entrar de novo.
 */
class DriveClient {
  constructor({ clientId, clientSecret }, refreshToken) {
    this.cfg = { clientId, clientSecret };
    this.refreshToken = refreshToken;
    this.accessToken = null;
    this.expiresAt = 0;
  }

  async token() {
    if (this.accessToken && Date.now() < this.expiresAt - 60000) return this.accessToken;
    const t = await postForm(TOKEN_URL, {
      client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret,
      refresh_token: this.refreshToken, grant_type: 'refresh_token'
    });
    this.accessToken = t.access_token;
    this.expiresAt = Date.now() + (t.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  async request(url, opts = {}, tentativa = 0) {
    const res = await fetch(url, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + await this.token() }
    });
    if (res.status === 401 && tentativa === 0) {
      this.accessToken = null;
      return this.request(url, opts, 1);
    }
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      throw new Error(`Google Drive respondeu HTTP ${res.status}: ${corpo.slice(0, 200)}`);
    }
    return res;
  }

  async find(q) {
    const params = new URLSearchParams({ q, fields: 'files(id,name,md5Checksum,modifiedTime)', spaces: 'drive', pageSize: '10' });
    const res = await this.request(`${DRIVE}/files?${params}`);
    return (await res.json()).files || [];
  }

  /** Pasta MySecrets criada pelo app (cria se não existir). */
  async ensureFolder(nome) {
    const existentes = await this.find(`name = '${nome}' and mimeType = '${FOLDER_MIME}' and trashed = false`);
    if (existentes.length > 0) return existentes[0].id;
    const res = await this.request(`${DRIVE}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nome, mimeType: FOLDER_MIME })
    });
    return (await res.json()).id;
  }

  /** Metadados de um arquivo da pasta, ou null. */
  async findFile(nome, folderId) {
    const r = await this.find(`name = '${nome}' and '${folderId}' in parents and trashed = false`);
    return r[0] || null;
  }

  async download(fileId) {
    const res = await this.request(`${DRIVE}/files/${fileId}?alt=media`);
    return res.text();
  }

  /** Cria ou substitui o conteúdo de um arquivo. Retorna { id, md5Checksum, modifiedTime }. */
  async upload(nome, folderId, conteudo, fileId = null, mime = 'application/octet-stream') {
    const fields = 'fields=id,md5Checksum,modifiedTime';
    if (fileId) {
      const res = await this.request(`${UPLOAD}/files/${fileId}?uploadType=media&${fields}`, {
        method: 'PATCH',
        headers: { 'Content-Type': mime },
        body: conteudo
      });
      return res.json();
    }
    const boundary = 'mysecrets' + crypto.randomBytes(8).toString('hex');
    const corpo = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({ name: nome, parents: [folderId] }),
      `--${boundary}`,
      `Content-Type: ${mime}`,
      '',
      conteudo,
      `--${boundary}--`,
      ''
    ].join('\r\n');
    const res = await this.request(`${UPLOAD}/files?uploadType=multipart&${fields}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: corpo
    });
    return res.json();
  }
}

module.exports = { loadClientConfig, authorize, revoke, DriveClient, SCOPES };
