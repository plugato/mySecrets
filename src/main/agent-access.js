/**
 * MySecrets - Aprovação de pedidos de agentes no PC e no celular (de qualquer
 * lugar, pelo relay: docs/developer/RELAY.md).
 *
 * LEITURAS (get_credentials, get_otp, get_secret_file, list/search/match):
 *   - cofre aberto e aprovação "só com o cofre bloqueado" (padrão): livres;
 *   - cofre bloqueado, ou aprovação "sempre": o servidor MCP pergunta aqui.
 *     O pedido vai ao celular (se ligado) e, com o cofre aberto, a um modal no
 *     PC; com o cofre bloqueado, desbloquear o app também libera. Respostas:
 *       "só esta"     o cofre é decifrado só na memória para aquela chamada;
 *       "por N min"   sessão de leitura (scope agent-read) até o prazo;
 *       "negar".
 * GRAVAÇÕES: a fila de src/main/mcp.js pergunta por confirmWrite(): modal do
 *   PC (com o cofre aberto ou assim que for aberto) × celular. Com o cofre
 *   bloqueado, a gravação aprovada no celular é aplicada aqui no processo
 *   principal com a senha conferida pela digital (applyWriteLocked).
 *
 * register({ getWindow, userDataPath, currentSessionPassword, readEntries,
 *            openAgentSession, closeAgentSession, applyWriteLocked })
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { ipcMain } = require('electron');
const core = require('../../mcp-server/core');
const vault = require('../../mcp-server/vault');
const relay = require('../lib/phone-relay');
const lib = require('../lib/agent-access');
const phone = require('./phone');
const tray = require('./tray');
const { t } = require('./i18n');

let deps = null;
const events = new EventEmitter();

function register(d) {
  deps = d;
}

const win = () => (deps && deps.getWindow ? deps.getWindow() : null);
const send = (channel, payload) => {
  const w = win();
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
};

// Prazos iguais aos da gravação: 240 s de espera < 260 s do servidor local < 275 s do stdio
const APPROVAL_WINDOW = 240000;

// ===== Configurações =====

const settings = () => lib.readSettings(deps.userDataPath);

ipcMain.handle('agent-approval-get', async () => ({
  settings: settings(),
  phones: phone.hasPhones(),
  readWindow: readWindow.active()
}));

ipcMain.handle('agent-approval-set', async (event, partial) => {
  const novo = lib.writeSettings(deps.userDataPath, partial);
  return { success: true, settings: novo };
});

// ===== Liberação de leitura por tempo =====

const readWindow = lib.createReadWindow({
  onStart: (w) => {
    console.log(`Leitura liberada para agentes por ${w.minutes} min (${w.source})`);
    tray.setReadWindow(w.until, () => readWindow.end('user'));
    send('agent-read-window', w);
  },
  onEnd: (w, reason) => {
    console.log(`Liberação de leitura encerrada (${reason})`);
    if (deps) deps.closeAgentSession();
    tray.setReadWindow(null);
    send('agent-read-window', null);
  }
});

ipcMain.handle('agent-read-window-end', async () => ({ success: readWindow.end('user') }));

async function startWindow(minutes, password, info) {
  const until = Date.now() + minutes * 60 * 1000;
  // Com o cofre aberto, a sessão normal já serve; bloqueado, cria a de leitura
  if (!deps.currentSessionPassword()) await deps.openAgentSession(password, until);
  readWindow.start(minutes, info);
  // O celular pode encerrar antes ("Encerrar agora" na notificação)
  if (info.approval && info.approval.channel) {
    const ctl = new AbortController();
    readWindow.onStop(() => ctl.abort());
    relay.listenForEnd(info.approval, { until, signal: ctl.signal })
      .then((fim) => { if (fim) readWindow.end('phone'); })
      .catch(() => {});
  }
}

/** Bloqueio do app: a liberação acaba junto. */
function onLock() {
  readWindow.end('lock');
}

/** Cofre aberto no PC: quem espera um desbloqueio (pedidos em andamento) segue. */
function onUnlock() {
  events.emit('unlocked');
}

function waitUnlocked(signal) {
  return new Promise((resolve) => {
    if (deps.currentSessionPassword()) { resolve(true); return; }
    const ok = () => { cleanup(); resolve(true); };
    const fim = () => { cleanup(); resolve(false); };
    const cleanup = () => {
      events.off('unlocked', ok);
      if (signal) signal.removeEventListener('abort', fim);
    };
    events.on('unlocked', ok);
    if (signal) signal.addEventListener('abort', fim, { once: true });
  });
}

// ===== Celular =====

function linked(parent) {
  const ctl = new AbortController();
  if (parent) {
    if (parent.aborted) ctl.abort();
    else parent.addEventListener('abort', () => ctl.abort(), { once: true });
  }
  return ctl;
}

/** Aprovação pelo celular como fonte da corrida (firstDecision). */
function phoneSource(opts) {
  return phone.requestRemoteApproval(opts).then(
    (r) => ({
      decided: true,
      approved: r.decision === 'approve',
      declined: r.decision !== 'approve',
      mode: r.mode,
      minutes: r.minutes,
      password: r.password,
      approval: r,
      phoneName: r.phoneName
    }),
    (e) => {
      if (e.code === 'cancelled') return { decided: false, cancelled: true, error: e.message };
      if (e.code === 'expired') return { decided: true, expired: true };
      return { decided: false, error: e.message };
    }
  );
}

// Nomes dos campos como no pedido do agente: o celular mostra no idioma dele
const FIELD_NAMES = ['username', 'password', 'url', 'token', 'tokenType', 'notes'];
// O celular mostra o valor destes; dos outros (senha, token, notas), só o tamanho
const PLAIN_FIELDS = new Set(['username', 'url', 'tokenType']);

const clip = (v, max) => {
  // eslint-disable-next-line no-control-regex -- uma linha só, sem caracteres de controle
  const t = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

function inferWriteType(req) {
  if (['login', 'token', 'note'].includes(req.type)) return req.type;
  const f = req.fields || {};
  if (f.token) return 'token';
  if (f.password || f.username) return 'login';
  return 'note';
}

/**
 * Resumo de uma gravação para o celular. Valores só do que não é segredo
 * (usuário, URL, tipo de token, campos extras de texto); senha, token, notas
 * e campos extras do tipo senha vão só com o tamanho. "fields" e
 * "customFields" (só nomes) continuam para o app 2.4.0 do celular.
 */
function writeSummary(req) {
  const fields = req.fields || {};
  const presentes = FIELD_NAMES.filter((k) => fields[k] !== undefined && fields[k] !== null);
  const custom = (req.customFields || []).slice(0, 20);
  return {
    target: clip((req.target && (req.target.title || req.target.id)) || '', 120),
    type: inferWriteType(req),
    fields: presentes,
    values: Object.fromEntries(presentes.filter((k) => PLAIN_FIELDS.has(k)).map((k) => [k, clip(fields[k], 120)])),
    lengths: Object.fromEntries(presentes.filter((k) => !PLAIN_FIELDS.has(k)).map((k) => [k, String(fields[k]).length])),
    customFields: custom.map((c) => clip(c.name, 60)),
    custom: custom.map((c) => (c.type === 'password'
      ? { name: clip(c.name, 60), secret: true, length: String(c.value == null ? '' : c.value).length }
      : { name: clip(c.name, 60), value: clip(c.value, 80) })),
    files: (req.files || []).map((f) => ({ name: clip(f.name, 120), size: f.size })).slice(0, 20),
    project: req.project ? clip(req.project, 60) : undefined,
    tags: (req.tags || []).slice(0, 10).map((t) => clip(t, 40))
  };
}

function readSummary(tool, args) {
  const a = args || {};
  const s = { tool };
  if (a.query) s.query = String(a.query).slice(0, 120);
  if (a.id) s.id = String(a.id).slice(0, 64);
  if (a.name) s.attachment = String(a.name).slice(0, 120);
  if (a.url) s.query = String(a.url).slice(0, 120);
  if (a.type) s.type = String(a.type).slice(0, 20);
  return s;
}

// ===== Gravações =====

/**
 * Confirmação de uma gravação da fila (agent-queue). pc = { ask(), cancel() }:
 * o modal do renderer. Devolve o formato da fila: { success, approved,
 * expired?, error?, locked? }. Aprovada no celular, job.password guarda a
 * senha conferida para applyWriteLocked (se o cofre continuar bloqueado).
 */
async function confirmWrite(job, pc) {
  const s = settings();
  const remoto = s.remote && phone.hasPhones();
  const aberto = !!deps.currentSessionPassword();
  if (!aberto && !remoto) {
    return {
      success: false,
      locked: true,
      error: t('O cofre está bloqueado. Desbloqueie o MySecrets ou ligue "Aprovar pelo celular de qualquer lugar" (Configurações > Celular). Nada foi gravado.')
    };
  }

  const ctl = new AbortController();
  job.abort = () => ctl.abort();
  // No prazo, tudo que espera (desbloqueio no PC, celular) desiste
  const prazo = setTimeout(() => ctl.abort(), Math.max(0, job.deadline - Date.now()));
  const fontes = [];
  // PC: o modal aparece já (cofre aberto) ou assim que o app for desbloqueado
  fontes.push({
    name: 'pc',
    promise: waitUnlocked(ctl.signal).then((ok) => {
      if (!ok) return { decided: false, error: 'cancelado' };
      job.pcAsked = true;
      return pc.ask().then((r) => (r && (r.success || r.cancelled) ? { decided: true, ...r } : { decided: false, ...(r || {}) }));
    })
  });
  if (remoto) {
    fontes.push({
      name: 'phone',
      promise: phoneSource({
        kind: 'write',
        summary: writeSummary(job.request),
        client: job.request.client || 'agente',
        deadline: job.deadline,
        pending: job.pending || 1,
        signal: ctl.signal,
        onPosted: (info) => send('agent-write-remote', { jobId: job.id, phones: info.phones })
      })
    });
  }

  const d = await lib.firstDecision(fontes);
  clearTimeout(prazo);
  ctl.abort();
  if (d.source !== 'pc' && job.pcAsked) pc.cancel();
  if (!d.decided && Date.now() >= job.deadline) return { success: true, approved: false, expired: true };
  if (!d.decided) return { success: false, error: d.error || t('Sem resposta') };
  if (d.cancelled) return { success: false, cancelled: true, error: d.error };
  if (d.expired) return { success: true, approved: false, expired: true };
  if (d.source === 'phone' && d.approved) {
    job.password = d.password;
    console.log(`Gravação de agente aprovada no celular ${d.phoneName || ''}`.trim());
  }
  return { success: true, approved: !!d.approved };
}

// ===== Leituras =====

const readAborts = new Map(); // reqId -> AbortController
let readChain = Promise.resolve();
let readPending = 0;

// Modal de leitura no renderer (cofre aberto e aprovação "sempre")
const rendererReads = new Map();

ipcMain.handle('agent-read-answer', async (event, jobId, answer) => {
  const done = rendererReads.get(jobId);
  if (done) {
    rendererReads.delete(jobId);
    done(answer || { approved: false });
  }
  return true;
});

function askPcRead(job, s) {
  return new Promise((resolve) => {
    const w = win();
    if (!w || w.isDestroyed()) { resolve({ decided: false, error: t('App sem janela aberta') }); return; }
    const timer = setTimeout(() => {
      if (rendererReads.delete(job.id)) {
        send('agent-read-cancel', job.id);
        resolve({ decided: true, expired: true });
      }
    }, Math.max(0, job.deadline - Date.now()));
    rendererReads.set(job.id, (a) => {
      clearTimeout(timer);
      resolve({ decided: true, approved: a.approved === true, declined: a.approved !== true, mode: a.mode === 'window' ? 'window' : 'once', minutes: relay.windowMinutes(a.minutes || s.windowMinutes) });
    });
    job.cancelPc = () => {
      if (rendererReads.delete(job.id)) {
        clearTimeout(timer);
        send('agent-read-cancel', job.id);
        resolve({ decided: false, cancelled: true });
      }
    };
    send('agent-read', {
      jobId: job.id,
      client: job.client,
      summary: job.summary,
      deadline: job.deadline,
      windowMinutes: s.windowMinutes,
      pending: readPending
    });
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  });
}

/** Executa a ferramenta aqui no processo principal (sessão aberta ou senha). */
async function runRead(job, password, approval) {
  let data;
  const s = vault.checkSession();
  if (s.valid && s.unlocked) {
    data = core.callTool(job.tool, job.args, {});
  } else {
    if (!password) return { success: false, locked: true, error: vault.reasonMessage('LOCKED') };
    // "Só esta": decifra só na memória, para esta chamada; nenhuma sessão é criada
    const entries = await deps.readEntries(password);
    data = vault.withEntries(entries, () => core.callTool(job.tool, job.args, {}));
  }
  return { success: true, data, approval };
}

async function processRead(job) {
  if (job.signal.aborted) return { success: false, cancelled: true, error: t('O agente cancelou o pedido.') };
  if (Date.now() >= job.deadline) return { success: false, expired: true, error: t('Tempo esgotado: a leitura não foi aprovada a tempo.') };

  const s = settings();
  if (readWindow.active()) return runRead(job, null, 'window');
  const aberto = deps.currentSessionPassword();
  if (aberto && s.readPolicy !== 'always') return runRead(job, null, 'unlocked');

  const remoto = s.remote && phone.hasPhones();
  if (!aberto && !remoto) {
    return {
      success: false,
      locked: true,
      error: t('O cofre está bloqueado. Desbloqueie o MySecrets ou ligue "Aprovar pelo celular de qualquer lugar" (Configurações > Celular).')
    };
  }

  const ctl = linked(job.signal);
  const prazo = setTimeout(() => ctl.abort(), Math.max(0, job.deadline - Date.now()));
  const fontes = [];
  // PC: modal com o cofre aberto (aprovação "sempre"); bloqueado, desbloquear libera
  fontes.push({
    name: 'pc',
    promise: (async () => {
      if (!(await waitUnlocked(ctl.signal))) return { decided: false, cancelled: true };
      if (settings().readPolicy !== 'always') return { decided: true, approved: true, mode: 'unlocked' };
      return askPcRead(job, s);
    })()
  });
  if (remoto) {
    fontes.push({
      name: 'phone',
      promise: phoneSource({
        kind: 'read',
        summary: job.summary,
        client: job.client,
        deadline: job.deadline,
        windowMinutes: s.windowMinutes,
        allowWindow: true,
        pending: Math.max(1, readPending),
        signal: ctl.signal
      })
    });
  }

  const d = await lib.firstDecision(fontes);
  clearTimeout(prazo);
  ctl.abort();
  if (d.source !== 'pc' && job.cancelPc) job.cancelPc();
  if (job.signal.aborted) return { success: false, cancelled: true, error: t('O agente cancelou o pedido.') };
  if (d.expired || (!d.decided && Date.now() >= job.deadline)) return { success: false, expired: true, error: t('Tempo esgotado: a leitura não foi aprovada a tempo.') };
  if (!d.decided) return { success: false, error: d.error || t('Sem resposta') };
  if (!d.approved) return { success: false, declined: true, error: t('O usuário negou a leitura.') };

  if (d.mode === 'unlocked') return runRead(job, null, 'unlocked');
  const password = d.password || deps.currentSessionPassword();
  if (d.mode === 'window') {
    await startWindow(relay.windowMinutes(d.minutes), password, {
      source: d.source,
      phoneName: d.phoneName,
      approval: d.source === 'phone' ? d.approval : null
    });
    return runRead(job, password, 'window');
  }
  return runRead(job, password, 'once');
}

/**
 * Pedido de leitura vindo do servidor local. Um por vez: quem chega enquanto
 * outro espera aproveita a liberação por tempo, se o usuário escolher.
 */
function handleRead(reqId, payload) {
  const ctl = new AbortController();
  readAborts.set(reqId, ctl);
  const tool = String(payload && payload.tool || '');
  const job = {
    id: crypto.randomUUID(),
    tool,
    args: (payload && payload.args) || {},
    client: String(payload && payload.client || 'agente').slice(0, 60),
    summary: readSummary(tool, payload && payload.args),
    deadline: Date.now() + APPROVAL_WINDOW,
    signal: ctl.signal
  };
  readPending++;
  const p = readChain.then(() => {
    if (!core.APPROVABLE_READS.has(tool)) return { success: false, error: t('Ferramenta não permitida') };
    return processRead(job);
  }).catch((e) => ({ success: false, error: e.message, locked: e instanceof vault.VaultLockedError || undefined }));
  readChain = p.then(() => {}, () => {});
  return p.finally(() => {
    readPending--;
    readAborts.delete(reqId);
  });
}

function cancelRead(reqId) {
  const ctl = readAborts.get(reqId);
  if (ctl) ctl.abort();
}

module.exports = {
  register,
  writeSummary,
  confirmWrite,
  handleRead,
  cancelRead,
  onLock,
  onUnlock,
  readWindowActive: () => readWindow.active(),
  endReadWindow: (reason) => readWindow.end(reason || 'user')
};
