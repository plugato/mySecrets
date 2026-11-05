/**
 * MySecrets - Anexos de arquivo (lado Node)
 *
 * Um anexo vive DENTRO de uma entrada do cofre, então é cifrado junto com o
 * resto (AES-256-GCM, mesmo secrets.enc, mesma sincronização):
 *
 *   entry.attachments = [{
 *     id, name, mime, size, sha256, note, data (base64), addedAt, updatedAt
 *   }]
 *
 * Este módulo lê um arquivo do disco e monta o anexo, confere um anexo
 * recebido (tamanho e sha256 batem com o conteúdo) e grava um anexo de volta
 * em disco. É Node puro, sem Electron: usado pelo servidor MCP e pelo main.js.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 1 MiB por arquivo: cobre keystore, .pem, .json de conta de serviço e .env.
// O cofre inteiro é cifrado e regravado a cada alteração, por isso o limite.
const MAX_ATTACHMENT_BYTES = 1024 * 1024;
const MAX_ATTACHMENTS_PER_ENTRY = 20;
const MAX_NAME_LENGTH = 200;
const MAX_NOTE_LENGTH = 2000;

const MIME_BY_EXT = {
  '.txt': 'text/plain',
  '.env': 'text/plain',
  '.json': 'application/json',
  '.pem': 'application/x-pem-file',
  '.key': 'application/octet-stream',
  '.crt': 'application/x-x509-ca-cert',
  '.cer': 'application/x-x509-ca-cert',
  '.p12': 'application/x-pkcs12',
  '.pfx': 'application/x-pkcs12',
  '.jks': 'application/x-java-keystore',
  '.keystore': 'application/x-java-keystore',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.zip': 'application/zip',
  '.bin': 'application/octet-stream'
};

function guessMime(name) {
  const base = path.basename(String(name || '')).toLowerCase();
  if (base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) return 'text/plain';
  return MIME_BY_EXT[path.extname(base)] || 'application/octet-stream';
}

/**
 * Nome seguro para guardar e para sugerir no "Salvar como": só o nome base,
 * sem barras, sem caracteres de controle, sem "." / "..".
 */
function sanitizeName(name) {
  let n = path.basename(String(name || '').replace(/\\/g, '/'));
  // eslint-disable-next-line no-control-regex -- remove caracteres de controle de nomes de arquivo
  n = n.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').trim();
  if (!n || n === '.' || n === '..') n = 'arquivo';
  return n.slice(0, MAX_NAME_LENGTH);
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`;
}

/** Monta um anexo a partir do conteúdo em memória. */
function attachmentFromBuffer(buffer, { name, mime, note } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('Conteúdo do arquivo inválido');
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Arquivo grande demais (${formatSize(buffer.length)}); o limite é ${formatSize(MAX_ATTACHMENT_BYTES)}`);
  }
  const safeName = sanitizeName(name);
  return {
    name: safeName,
    mime: typeof mime === 'string' && mime && mime.length <= 100 ? mime : guessMime(safeName),
    size: buffer.length,
    sha256: sha256Hex(buffer),
    note: typeof note === 'string' ? note.slice(0, MAX_NOTE_LENGTH) : '',
    data: buffer.toString('base64')
  };
}

/** Lê um arquivo do disco (caminho absoluto) e monta o anexo. */
function readFileAsAttachment(filePath, { name, mime, note } = {}) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('Informe o caminho do arquivo');
  if (!path.isAbsolute(filePath)) throw new Error('Use um caminho absoluto para o arquivo');
  let st;
  try {
    st = fs.statSync(filePath);
  } catch (_) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }
  if (!st.isFile()) throw new Error(`Não é um arquivo: ${filePath}`);
  if (st.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Arquivo grande demais (${formatSize(st.size)}); o limite é ${formatSize(MAX_ATTACHMENT_BYTES)}`);
  }
  return attachmentFromBuffer(fs.readFileSync(filePath), { name: name || path.basename(filePath), mime, note });
}

/**
 * Confere um anexo vindo de fora (agente, IPC): campos, tamanho e sha256.
 * Devolve o conteúdo decodificado ou lança erro.
 */
function verifyAttachment(att) {
  if (!att || typeof att !== 'object') throw new Error('Anexo inválido');
  if (typeof att.name !== 'string' || !att.name || att.name.length > MAX_NAME_LENGTH) throw new Error('Nome de anexo inválido');
  if (typeof att.data !== 'string') throw new Error(`Anexo "${att.name}" sem conteúdo`);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(att.data)) throw new Error(`Anexo "${att.name}" com base64 inválido`);
  const buffer = Buffer.from(att.data, 'base64');
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new Error(`Anexo "${att.name}" passa do limite de ${formatSize(MAX_ATTACHMENT_BYTES)}`);
  if (att.size !== buffer.length) throw new Error(`Anexo "${att.name}": tamanho não confere`);
  if (typeof att.sha256 !== 'string' || att.sha256.toLowerCase() !== sha256Hex(buffer)) {
    throw new Error(`Anexo "${att.name}": sha256 não confere`);
  }
  return buffer;
}

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

function backupStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

/**
 * Grava o anexo em disco (permissão 600). Confere o sha256 antes de gravar.
 * - Não sobrescreve um arquivo existente a não ser com overwrite: true.
 * - Nunca grava através de um link simbólico (o destino seria outro arquivo).
 * - backup: true guarda uma cópia do arquivo substituído em
 *   "<arquivo>.bak-<data>" antes de sobrescrever (usado pelo MCP: um agente
 *   não pode destruir um arquivo sem volta).
 * A gravação é atômica: arquivo temporário na mesma pasta + rename.
 */
function writeAttachmentToPath(att, outPath, { overwrite = false, backup = false } = {}) {
  if (typeof outPath !== 'string' || !outPath) throw new Error('Informe o caminho de destino');
  if (!path.isAbsolute(outPath)) throw new Error('Use um caminho absoluto para o destino');
  const buffer = verifyAttachment(att);
  const st = lstatOrNull(outPath);
  if (st && st.isSymbolicLink()) throw new Error(`O destino é um link simbólico; não gravo através dele: ${outPath}`);
  if (st && !st.isFile()) throw new Error(`O destino não é um arquivo: ${outPath}`);
  if (st && !overwrite) throw new Error(`Já existe um arquivo em ${outPath} (use overwrite: true para substituir)`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  let backupPath;
  if (st && backup) {
    backupPath = `${outPath}.bak-${backupStamp()}`;
    let n = 1;
    while (lstatOrNull(backupPath)) backupPath = `${outPath}.bak-${backupStamp()}-${n++}`;
    fs.copyFileSync(outPath, backupPath, fs.constants.COPYFILE_EXCL);
    try { fs.chmodSync(backupPath, 0o600); } catch (_) { /* Windows */ }
  }

  const tmp = path.join(path.dirname(outPath), `.${path.basename(outPath)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, buffer, { mode: 0o600, flag: 'wx' });
    try { fs.chmodSync(tmp, 0o600); } catch (_) { /* Windows */ }
    fs.renameSync(tmp, outPath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* já foi */ }
    throw e;
  }
  return { path: outPath, size: buffer.length, sha256: att.sha256, backupPath };
}

/** Metadados de um anexo, sem o conteúdo. */
function attachmentMeta(att) {
  return {
    id: att.id,
    name: att.name,
    mime: att.mime,
    size: att.size,
    sha256: att.sha256,
    note: att.note || '',
    addedAt: att.addedAt || null,
    updatedAt: att.updatedAt || null
  };
}

module.exports = {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_ENTRY,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  guessMime,
  sanitizeName,
  sha256Hex,
  formatSize,
  attachmentFromBuffer,
  readFileAsAttachment,
  verifyAttachment,
  writeAttachmentToPath,
  attachmentMeta
};
