// Login com Google (OAuth loopback + PKCE) e cliente do Drive, com fetch simulado.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');

const { authorize, DriveClient } = require('../src/lib/google-drive');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const cfg = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'segredo' };

// Faz uma requisição real ao servidor de loopback (sem passar pelo fetch simulado)
const httpGet = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
});

test('authorize: PKCE, state e troca do código por tokens', async () => {
  let tokenBody = null;
  global.fetch = async (url, opts = {}) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      tokenBody = new URLSearchParams(opts.body.toString());
      return json({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600, scope: 'openid https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email' });
    }
    if (String(url).startsWith('https://openidconnect.googleapis.com/v1/userinfo')) {
      assert.strictEqual(opts.headers.Authorization, 'Bearer acc');
      return json({ email: 'eu@exemplo.com' });
    }
    throw new Error('URL inesperada ' + url);
  };

  const resultado = await authorize(cfg, (authUrl) => {
    const u = new URL(authUrl);
    assert.strictEqual(u.searchParams.get('client_id'), cfg.clientId);
    assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
    assert.match(u.searchParams.get('scope'), /drive\.file/);
    assert.doesNotMatch(u.searchParams.get('scope'), /auth\/drive(\s|$)/);
    const redirect = u.searchParams.get('redirect_uri');
    assert.match(redirect, /^http:\/\/127\.0\.0\.1:\d+$/);

    // state errado é recusado antes do retorno correto
    httpGet(`${redirect}/?code=x&state=errado`).then((status) => {
      assert.strictEqual(status, 400);
      return httpGet(`${redirect}/?code=codigo123&state=${u.searchParams.get('state')}`);
    });
    globalThis.__challenge = u.searchParams.get('code_challenge');
  });

  assert.deepStrictEqual({ r: resultado.refreshToken, a: resultado.accessToken, e: resultado.email },
    { r: 'ref', a: 'acc', e: 'eu@exemplo.com' });
  assert.strictEqual(tokenBody.get('code'), 'codigo123');
  assert.strictEqual(tokenBody.get('grant_type'), 'authorization_code');
  const desafio = crypto.createHash('sha256').update(tokenBody.get('code_verifier')).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.strictEqual(desafio, globalThis.__challenge);
});

test('authorize: caixinha do Drive desmarcada na tela do Google', async () => {
  let revogado = false;
  global.fetch = async (url) => {
    url = String(url);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return json({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600, scope: 'openid https://www.googleapis.com/auth/userinfo.email' });
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) { revogado = true; return json({}); }
    throw new Error('URL inesperada ' + url);
  };
  await assert.rejects(authorize(cfg, (authUrl) => {
    const u = new URL(authUrl);
    httpGet(`${u.searchParams.get('redirect_uri')}/?code=c&state=${u.searchParams.get('state')}`);
  }), (e) => e.code === 'insufficient_scope' && /permissão do Google Drive/.test(e.message));
  assert.ok(revogado, 'o acesso parcial deve ser revogado');
});

test('DriveClient: 403 por falta de escopo vira insufficient_scope', async () => {
  global.fetch = async (url) => String(url).includes('oauth2.googleapis.com/token')
    ? json({ access_token: 'a', expires_in: 3600 })
    : json({ error: { code: 403, message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] } }, 403);
  const c = new DriveClient(cfg, 'refresh');
  await assert.rejects(c.ensureFolder('MySecrets'), (e) => e.code === 'insufficient_scope');
});

test('authorize: login cancelado', async () => {
  await assert.rejects(authorize(cfg, (authUrl) => {
    const u = new URL(authUrl);
    httpGet(`${u.searchParams.get('redirect_uri')}/?error=access_denied&state=${u.searchParams.get('state')}`);
  }), /cancelado/);
});

test('DriveClient: renova o token, cria a pasta e envia arquivo multipart', async () => {
  const chamadas = [];
  global.fetch = async (url, opts = {}) => {
    url = String(url);
    chamadas.push({ url, opts });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'novo', expires_in: 3600 });
    if (url.includes('/drive/v3/files?q=')) return json({ files: [] });
    if (url.includes('/drive/v3/files?fields=id')) return json({ id: 'pasta1' });
    if (url.includes('/upload/drive/v3/files?uploadType=multipart')) return json({ id: 'arq1', md5Checksum: 'abc' });
    if (url.includes('/upload/drive/v3/files/arq1?uploadType=media')) return json({ id: 'arq1', md5Checksum: 'def' });
    throw new Error('URL inesperada ' + url);
  };

  const c = new DriveClient(cfg, 'refresh');
  assert.strictEqual(await c.ensureFolder('MySecrets'), 'pasta1');
  const criado = await c.upload('secrets.enc', 'pasta1', '{"x":1}');
  assert.strictEqual(criado.md5Checksum, 'abc');
  const atualizado = await c.upload('secrets.enc', 'pasta1', '{"x":2}', 'arq1');
  assert.strictEqual(atualizado.md5Checksum, 'def');

  // token renovado uma vez só e enviado em todas as chamadas ao Drive
  assert.strictEqual(chamadas.filter(x => x.url.includes('oauth2.googleapis.com/token')).length, 1);
  chamadas.filter(x => x.url.includes('googleapis.com/') && !x.url.includes('oauth2'))
    .forEach(x => assert.strictEqual(x.opts.headers.Authorization, 'Bearer novo'));

  const busca = new URL(chamadas.find(x => x.url.includes('files?q=')).url).searchParams.get('q');
  assert.match(busca, /name = 'MySecrets' and mimeType = 'application\/vnd.google-apps.folder'/);

  const multipart = chamadas.find(x => x.url.includes('uploadType=multipart'));
  assert.match(multipart.opts.headers['Content-Type'], /^multipart\/related; boundary=/);
  assert.match(multipart.opts.body, /"name":"secrets.enc","parents":\["pasta1"\]/);
  assert.match(multipart.opts.body, /\{"x":1\}/);

  const patch = chamadas.find(x => x.url.includes('/files/arq1?uploadType=media'));
  assert.strictEqual(patch.opts.method, 'PATCH');
  assert.strictEqual(patch.opts.body, '{"x":2}');
});

test('DriveClient: acesso revogado vira erro invalid_grant', async () => {
  global.fetch = async () => json({ error: 'invalid_grant', error_description: 'Token has been revoked.' }, 400);
  const c = new DriveClient(cfg, 'refresh');
  await assert.rejects(c.find("name = 'x'"), (e) => e.code === 'invalid_grant');
});
