#!/usr/bin/env node
/**
 * Envia a extensão para a Chrome Web Store e pede a publicação (API v2).
 *
 * Uso (no workflow do GitHub, depois do build):
 *   node scripts/publish-chrome-extension.js dist/MySecrets-Autofill-extensao-chrome.zip
 *
 * Ambiente:
 *   CWS_SERVICE_ACCOUNT_JSON  chave JSON da conta de serviço (adicionada no
 *                             Developer Dashboard > Conta)
 *   CWS_PUBLISHER_ID          ID do editor (Dashboard > Editor > Configurações)
 *   CWS_EXTENSION_ID          ID da extensão na loja
 *
 * Se a versão do manifest já é a publicada (ou a que está em revisão), não
 * envia nada: a loja recusa upload sem aumentar a versão.
 */

const crypto = require('crypto');
const fs = require('fs');

const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://chromewebstore.googleapis.com';

const b64url = (v) => Buffer.from(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** JWT assinado com a chave da conta de serviço (RS256), trocado por um access token. */
async function serviceAccountToken(key, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const assinatura = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key.private_key);
  const jwt = `${header}.${claims}.${b64url(assinatura)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Falha ao autenticar a conta de serviço: ${corpo.error_description || corpo.error || res.status}`);
  return corpo.access_token;
}

async function api(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}) },
    body: body == null ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body))
  });
  const texto = await res.text();
  let corpo;
  try { corpo = texto ? JSON.parse(texto) : {}; } catch (_) { corpo = { raw: texto }; }
  if (!res.ok) {
    const msg = (corpo.error && corpo.error.message) || texto.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(`Chrome Web Store respondeu HTTP ${res.status}: ${msg}`);
  }
  return corpo;
}

/** Versões já publicada e em revisão, para não reenviar a mesma. */
function knownVersions(status) {
  const versoes = [];
  for (const rev of [status.publishedItemRevisionStatus, status.submittedItemRevisionStatus]) {
    for (const canal of (rev && rev.distributionChannels) || []) {
      if (canal.crxVersion) versoes.push(canal.crxVersion);
    }
  }
  return versoes;
}

/** Versão do manifest.json dentro do zip (sem dependências: lê o diretório central). */
function manifestVersionFromZip(buffer) {
  const zlib = require('zlib');
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Zip da extensão inválido');
  let p = buffer.readUInt32LE(eocd + 16);
  const total = buffer.readUInt16LE(eocd + 10);
  for (let n = 0; n < total; n++) {
    const metodo = buffer.readUInt16LE(p + 10);
    const tamanho = buffer.readUInt32LE(p + 20);
    const lenNome = buffer.readUInt16LE(p + 28);
    const lenExtra = buffer.readUInt16LE(p + 30);
    const lenComent = buffer.readUInt16LE(p + 32);
    const local = buffer.readUInt32LE(p + 42);
    const nome = buffer.toString('utf8', p + 46, p + 46 + lenNome);
    p += 46 + lenNome + lenExtra + lenComent;
    if (nome !== 'manifest.json') continue;
    const ini = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const dados = buffer.subarray(ini, ini + tamanho);
    const texto = metodo === 8 ? zlib.inflateRawSync(dados).toString('utf8') : dados.toString('utf8');
    return JSON.parse(texto).version;
  }
  throw new Error('manifest.json não encontrado no zip');
}

async function publish({ zipPath, key, publisherId, extensionId, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const zip = fs.readFileSync(zipPath);
  const versao = manifestVersionFromZip(zip);
  const item = `publishers/${publisherId}/items/${extensionId}`;
  const token = await serviceAccountToken(key);

  const status = await api(token, 'GET', `${API}/v2/${item}:fetchStatus`);
  if (knownVersions(status).includes(versao)) {
    log(`Versão ${versao} já está publicada ou em revisão na loja — nada a enviar.`);
    return { skipped: true, version: versao };
  }

  log(`Enviando a versão ${versao}…`);
  let upload = await api(token, 'POST', `${API}/upload/v2/${item}:upload`, zip);
  let estado = upload.uploadState;

  // Upload assíncrono: acompanha pelo fetchStatus (até ~2 min)
  for (let i = 0; estado === 'UPLOAD_IN_PROGRESS' && i < 24; i++) {
    await sleep(5000);
    estado = (await api(token, 'GET', `${API}/v2/${item}:fetchStatus`)).lastAsyncUploadState;
  }
  if (estado === 'UPLOAD_IN_PROGRESS') throw new Error('Upload ainda em processamento na loja após 2 minutos');
  if (estado && /FAIL|NOT_FOUND/i.test(estado)) {
    throw new Error(`Upload recusado pela loja (${estado})`);
  }

  const resultado = await api(token, 'POST', `${API}/v2/${item}:publish`, { publishType: 'DEFAULT_PUBLISH' });
  for (const w of (resultado.warningInfo && resultado.warningInfo.warnings) || []) {
    log(`Aviso da loja: ${w.reason || ''} ${w.description || ''}`.trim());
  }
  log(`Versão ${versao} enviada para revisão (estado: ${resultado.state || 'desconhecido'}). Publica sozinha após aprovada.`);
  return { skipped: false, version: versao, state: resultado.state };
}

if (require.main === module) {
  const zipPath = process.argv[2];
  const { CWS_SERVICE_ACCOUNT_JSON, CWS_PUBLISHER_ID, CWS_EXTENSION_ID } = process.env;
  if (!zipPath || !CWS_SERVICE_ACCOUNT_JSON || !CWS_PUBLISHER_ID || !CWS_EXTENSION_ID) {
    console.error('Uso: CWS_SERVICE_ACCOUNT_JSON=… CWS_PUBLISHER_ID=… CWS_EXTENSION_ID=… node scripts/publish-chrome-extension.js <zip>');
    process.exit(2);
  }
  publish({
    zipPath,
    key: JSON.parse(CWS_SERVICE_ACCOUNT_JSON),
    publisherId: CWS_PUBLISHER_ID.trim(),
    extensionId: CWS_EXTENSION_ID.trim()
  }).catch((err) => {
    console.error(`::error::${err.message}`);
    process.exit(1);
  });
}

module.exports = { publish, serviceAccountToken, knownVersions, manifestVersionFromZip };
