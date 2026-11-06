/**
 * MySecrets - Servidor MCP local (agentes de IA e extensão do navegador).
 *
 * - inicia/para o processo do servidor (mcp-server/http-server.js);
 * - logins que a extensão pede para salvar;
 * - pareamento automático da extensão (pergunta na primeira vez);
 * - gravações pedidas por agentes (store_secret/store_secret_file), com
 *   confirmação na janela, fila e aviso na bandeja.
 *
 * register({ getWindow, mcpTokenPath, mcpEndpointPath, trustedExtensionsPath })
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, ipcMain, dialog, Notification } = require('electron');
const { createAgentWriteQueue } = require('../lib/agent-queue');
const attachmentFiles = require('../../mcp-server/files');
const tray = require('./tray');
const { t } = require('./i18n');

let deps = { getWindow: () => null };
const win = () => deps.getWindow();

function register(d) {
  deps = d;
}

// ===== Gerenciamento do Servidor MCP (HTTP) =====
//
// Permite iniciar/parar o servidor MCP direto do app. O servidor roda como
// processo filho (mcp-server/http-server.js), escutando em 127.0.0.1 e exigindo
// um token bearer gerado aqui. Ele lê o cofre pela sessão (.session), então só
// funciona com o app desbloqueado.

let mcpProcess = null;
let mcpInfo = null; // { host, port, url, token, startedAt }
let mcpLastError = null;

function getMcpServerPath() {
  // Em dev: <raiz>/mcp-server/http-server.js. Empacotado: dentro de resources.
  const candidates = [
    path.join(__dirname, '..', '..', 'mcp-server', 'http-server.js'),
    // Empacotado: mcp-server fica fora do asar (asarUnpack)
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'mcp-server', 'http-server.js'),
    path.join(process.resourcesPath || '', 'mcp-server', 'http-server.js'),
    path.join(process.resourcesPath || '', 'app', 'mcp-server', 'http-server.js')
  ];
  return candidates.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } }) || candidates[0];
}

function getMcpStatus() {
  return {
    running: !!mcpProcess,
    info: mcpProcess ? mcpInfo : null,
    error: mcpLastError
  };
}

// Token fixo entre reinícios: a extensão pareia uma vez só. Arquivo 0600 no
// perfil do usuário, mesmo nível de confiança do .machine-secret.
function getMcpToken() {
  try {
    const saved = fs.readFileSync(deps.mcpTokenPath, 'utf8').trim();
    if (/^[0-9a-f]{48}$/.test(saved)) return saved;
  } catch (_) { /* primeira vez */ }
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(deps.mcpTokenPath, token, { mode: 0o600 });
  return token;
}

function startMcpServer(options = {}) {
  return new Promise((resolve) => {
    if (mcpProcess) {
      return resolve({ success: true, status: getMcpStatus(), alreadyRunning: true });
    }

    const port = parseInt(options.port, 10) || 8765;
    const token = getMcpToken();
    const serverPath = getMcpServerPath();

    if (!fs.existsSync(serverPath)) {
      mcpLastError = t('Arquivo do servidor MCP não encontrado: ') + serverPath;
      return resolve({ success: false, error: mcpLastError });
    }

    mcpLastError = null;

    const child = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        // ELECTRON_RUN_AS_NODE faz o binário do Electron rodar como Node puro,
        // evitando depender de um Node instalado no sistema.
        ELECTRON_RUN_AS_NODE: '1',
        MYSECRETS_MCP_PORT: String(port),
        MYSECRETS_MCP_TOKEN: token,
        MYSECRETS_MCP_HOST: '127.0.0.1'
      },
      // 'ipc': canal para a extensão salvar logins pelo app (mysecrets/save_login)
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    child.on('message', (msg) => handleMcpMessage(child, msg));

    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };

    let stdoutBuf = '';
    child.stdout.on('data', (data) => {
      stdoutBuf += data.toString();
      const nl = stdoutBuf.indexOf('\n');
      if (nl >= 0 && !settled) {
        const line = stdoutBuf.slice(0, nl).trim();
        try {
          const ready = JSON.parse(line);
          if (ready && ready.ready) {
            mcpProcess = child;
            mcpInfo = {
              host: ready.host,
              port: ready.port,
              url: ready.url,
              token: ready.token || token,
              startedAt: Date.now()
            };
            console.log('✅ Servidor MCP iniciado em', mcpInfo.url);
            writeMcpEndpoint(mcpInfo.port);
            finish({ success: true, status: getMcpStatus() });
          }
        } catch (_) { /* linha não-JSON, ignora */ }
      }
    });

    child.stderr.on('data', (data) => {
      console.log('[MCP]', data.toString().trim());
    });

    child.on('error', (err) => {
      mcpLastError = err.message;
      mcpProcess = null;
      mcpInfo = null;
      finish({ success: false, error: err.message });
    });

    child.on('exit', (code, signal) => {
      console.log('Servidor MCP encerrado', code, signal || '');
      if (mcpProcess === child) removeMcpEndpoint();
      if (!settled) {
        mcpLastError = code === 2
          ? t("Não foi possível iniciar (porta {0} em uso?)", { 0: port })
          : t("Servidor encerrou (código {0})", { 0: code });
        finish({ success: false, error: mcpLastError });
      }
      mcpProcess = null;
      mcpInfo = null;
      // Notifica o renderer que o servidor caiu
      if (win() && !win().isDestroyed()) {
        win().webContents.send('mcp-stopped', { code, signal });
      }
    });

    // Timeout de segurança caso o "ready" nunca chegue
    setTimeout(() => {
      if (!settled) {
        try { child.kill(); } catch (_) {}
        mcpLastError = t('Tempo esgotado ao iniciar o servidor MCP');
        finish({ success: false, error: mcpLastError });
      }
    }, 8000);
  });
}

function writeMcpEndpoint(port) {
  try {
    fs.writeFileSync(deps.mcpEndpointPath, JSON.stringify({ port, pid: process.pid }), { mode: 0o600 });
  } catch (err) {
    console.warn('⚠️ Não foi possível gravar .mcp-endpoint:', err.message);
  }
}

function removeMcpEndpoint() {
  try { fs.unlinkSync(deps.mcpEndpointPath); } catch (_) { /* já removido */ }
}

function stopMcpServer() {
  removeMcpEndpoint();
  if (!mcpProcess) return { success: true, status: getMcpStatus() };
  try {
    mcpProcess.kill('SIGTERM');
  } catch (err) {
    return { success: false, error: err.message };
  }
  mcpProcess = null;
  mcpInfo = null;
  return { success: true, status: getMcpStatus() };
}

ipcMain.handle('mcp-status', async () => getMcpStatus());
// ===== Salvar login pedido pela extensão =====
//
// O servidor local (processo filho) repassa o pedido por IPC; quem grava é o
// renderer, que tem o cofre aberto em memória e salva como numa edição normal.

const extensionSaves = new Map();
const EXTENSION_SAVE_TIMEOUT = 10000;

function handleMcpMessage(child, msg) {
  if (msg && msg.type === 'agent_write') {
    handleAgentWrite(child, msg);
    return;
  }
  if (msg && msg.type === 'agent_write_cancel') {
    agentQueue.cancel(msg.reqId);
    return;
  }
  if (msg && msg.type === 'pair_request') {
    approveExtension(msg.payload && msg.payload.origin).then((ok) => {
      const result = ok ? { success: true } : { success: false, error: t('Conexão recusada no app') };
      try { child.send({ type: 'pair_result', reqId: msg.reqId, result }); } catch (_) { /* filho encerrado */ }
    });
    return;
  }
  if (!msg || msg.type !== 'save_login') return;
  const responder = (result) => {
    try { child.send({ type: 'save_login_result', reqId: msg.reqId, result }); } catch (_) { /* filho encerrado */ }
  };
  if (!win() || win().isDestroyed()) {
    responder({ success: false, error: t('App sem janela aberta') });
    return;
  }
  extensionSaves.set(msg.reqId, responder);
  setTimeout(() => {
    if (extensionSaves.delete(msg.reqId)) responder({ success: false, error: t('O app não respondeu') });
  }, EXTENSION_SAVE_TIMEOUT);
  win().webContents.send('extension-save-login', { reqId: msg.reqId, ...msg.payload });
}

// ===== Pareamento automático da extensão =====
//
// A extensão pede o token em POST /pair (ver mcp-server/http-server.js). Na
// primeira vez que um id de extensão pede, o app pergunta ao usuário; aprovado,
// o id fica em extension-origins.json e as próximas conexões são silenciosas.

function trustedExtensions() {
  try {
    const list = JSON.parse(fs.readFileSync(deps.trustedExtensionsPath, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

const pairPrompts = new Map(); // origin -> Promise<boolean>, evita perguntar duas vezes

function approveExtension(origin) {
  if (typeof origin !== 'string' || !/^(chrome|moz)-extension:\/\/[\w-]+$/.test(origin)) return Promise.resolve(false);
  if (trustedExtensions().includes(origin)) return Promise.resolve(true);
  if (!win() || win().isDestroyed()) return Promise.resolve(false);

  if (!pairPrompts.has(origin)) {
    const ask = (async () => {
      win().show();
      win().focus();
      const { response } = await dialog.showMessageBox(win(), {
        type: 'question',
        title: t('Conectar extensão'),
        message: t('Uma extensão do navegador quer se conectar ao MySecrets'),
        detail: t("{0}\n\nPermita só se você acabou de instalar ou abrir a extensão MySecrets Autofill. ", { 0: origin }) +
          t('Ela poderá preencher logins enquanto o cofre estiver desbloqueado.'),
        buttons: [t('Permitir'), t('Recusar')],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      });
      if (response !== 0) return false;
      fs.writeFileSync(deps.trustedExtensionsPath, JSON.stringify([...trustedExtensions(), origin]), { mode: 0o600 });
      return true;
    })().finally(() => pairPrompts.delete(origin));
    pairPrompts.set(origin, ask);
  }
  return pairPrompts.get(origin);
}

ipcMain.handle('extension-save-result', async (event, reqId, result) => {
  const responder = extensionSaves.get(reqId);
  if (responder) {
    extensionSaves.delete(reqId);
    responder(result);
  }
  return true;
});

// ===== Gravação pedida por agente (MCP store_secret / store_secret_file) =====
//
// O servidor local repassa o pedido por IPC. O app confere os anexos (tamanho
// e sha256) e põe o pedido numa fila (src/lib/agent-queue.js). Na vez dele, o
// renderer mostra um modal de confirmação em destaque, dentro do app, com o
// resumo (entrada nova ou existente, campos que mudam, arquivos) e o tempo
// restante. Se a janela estiver atrás de outras, minimizada ou na bandeja, o
// app chama atenção (notificação, piscar na barra de tarefas, indicador na
// bandeja). Só grava com o clique em "Gravar no cofre". Nenhum valor secreto
// vai para o modal, a notificação ou o log.
//
// Prazos (do menor para o maior, para o agente sempre receber o resultado
// verdadeiro): confirmação 240 s desde a chegada (inclui a fila) + gravação até
// 10 s  <  http-server 260 s  <  index.js (stdio) 275 s.

const AGENT_WRITE_WINDOW = 240000;
const AGENT_APPLY_TIMEOUT = 10000;
const rendererAsks = new Map();

function askRenderer(op, payload, timeout) {
  return new Promise((resolve) => {
    if (!win() || win().isDestroyed()) {
      resolve({ success: false, error: t('App sem janela aberta') });
      return;
    }
    const reqId = crypto.randomUUID();
    const timer = setTimeout(() => {
      if (rendererAsks.delete(reqId)) resolve({ success: false, error: t('O app não respondeu') });
    }, timeout);
    rendererAsks.set(reqId, (result) => { clearTimeout(timer); resolve(result); });
    win().webContents.send('agent-write', { reqId, op, ...payload });
  });
}

ipcMain.handle('agent-write-result', async (event, reqId, result) => {
  const done = rendererAsks.get(reqId);
  if (done) {
    rendererAsks.delete(reqId);
    done(result || { success: false, error: t('Resposta vazia') });
  }
  return true;
});

// Texto vindo do agente vai para a notificação numa linha só e curto
function oneLine(text, max = 120) {
  // eslint-disable-next-line no-control-regex -- remove caracteres de controle do texto
  const t = String(text == null ? '' : text).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function validateAgentRequest(req) {
  if (!req || typeof req !== 'object' || !req.target) throw new Error(t('Pedido de gravação inválido'));
  if (!Array.isArray(req.files)) req.files = [];
  if (req.files.length > attachmentFiles.MAX_ATTACHMENTS_PER_ENTRY) throw new Error(t('Arquivos demais num pedido'));
  req.files.forEach((f) => {
    attachmentFiles.verifyAttachment(f);
    f.name = attachmentFiles.sanitizeName(f.name);
  });
  return req;
}

// ----- Chamar atenção -----

let agentNotification = null;
let alwaysOnTopTimer = null;

function showAndFocusWindow() {
  if (!win() || win().isDestroyed()) return;
  if (win().isMinimized()) win().restore();
  win().show();
  win().moveTop();
  win().focus();
}

function stopAttention() {
  if (alwaysOnTopTimer) {
    clearTimeout(alwaysOnTopTimer);
    alwaysOnTopTimer = null;
  }
  if (win() && !win().isDestroyed()) {
    win().setAlwaysOnTop(false);
    win().flashFrame(false);
  }
  if (agentNotification) {
    try { agentNotification.close(); } catch (_) {}
    agentNotification = null;
  }
}

function callAttention(job) {
  if (!win() || win().isDestroyed()) return;
  const wasFocused = win().isFocused();
  const inTray = !win().isVisible() && !win().isMinimized();
  console.log(`Pedido de gravação de agente: janela ${wasFocused ? 'em foco' : inTray ? 'na bandeja' : win().isMinimized() ? 'minimizada' : 'sem foco'}`);

  if (win().isMinimized()) win().restore();
  if (!inTray && !wasFocused) {
    // Sobe a janela por um instante (sem deixá-la presa no topo) e tenta o foco.
    // Em desktops Linux com prevenção de roubo de foco, o piscar e a
    // notificação abaixo cobrem o caso em que o foco não vem.
    win().show();
    win().setAlwaysOnTop(true);
    win().moveTop();
    win().focus();
    if (process.platform === 'darwin') app.focus({ steal: true });
    if (alwaysOnTopTimer) clearTimeout(alwaysOnTopTimer);
    alwaysOnTopTimer = setTimeout(() => {
      alwaysOnTopTimer = null;
      if (win() && !win().isDestroyed()) win().setAlwaysOnTop(false);
    }, 2000);
  }

  if (!wasFocused) {
    win().flashFrame(true); // pisca na barra de tarefas até o usuário focar
    if (Notification.isSupported()) {
      const titulo = oneLine(job.request.target.title || 'entrada existente', 80);
      const qtd = job.request.files.length;
      if (agentNotification) {
        try { agentNotification.close(); } catch (_) {}
      }
      agentNotification = new Notification({
        title: t('Pedido de gravação no cofre'),
        body: t("Entrada: \"{0}\"{1}. ", { 0: titulo, 1: qtd ? t(' ({0} arquivo(s))', { 0: qtd }) : '' }) +
          t('Abra o MySecrets para aprovar ou recusar.'),
        urgency: 'critical'
      });
      // Clicar só abre o app no modal; nunca grava nada
      agentNotification.on('click', () => showAndFocusWindow());
      agentNotification.show();
    }
  }
}

// ----- Fila -----

const agentQueue = createAgentWriteQueue({
  windowMs: AGENT_WRITE_WINDOW,
  applyTimeoutMs: AGENT_APPLY_TIMEOUT,
  confirm: (job) => askRenderer('confirm', {
    jobId: job.id,
    deadline: job.deadline,
    total: agentQueue.pending(),
    // O resumo não precisa do conteúdo dos arquivos
    request: { ...job.request, files: job.request.files.map(({ data, ...meta }) => meta) }
  }, job.deadline - Date.now() + 1000),
  apply: (job) => askRenderer('apply', { jobId: job.id, request: job.request }, AGENT_APPLY_TIMEOUT),
  cancelConfirm: (job) => {
    if (win() && !win().isDestroyed()) win().webContents.send('agent-write-cancel', job.id);
  },
  onShow: (job) => callAttention(job),
  onCount: (n) => {
    if (win() && !win().isDestroyed()) win().webContents.send('agent-write-count', n);
    tray.updateTrayIndicator(n);
    if (n === 0) stopAttention();
  }
});

function handleAgentWrite(child, msg) {
  const responder = (result) => {
    if (result && result.success) {
      console.log(`✅ Gravação de agente aplicada (${result.mode})`);
    } else {
      console.log('Gravação de agente não aplicada:', (result && result.error) || 'sem resposta');
    }
    try { child.send({ type: 'agent_write_result', reqId: msg.reqId, result }); } catch (_) { /* filho encerrado */ }
  };
  try {
    validateAgentRequest(msg.payload);
  } catch (err) {
    responder({ success: false, error: err.message });
    return;
  }
  agentQueue.submit(msg.reqId, msg.payload).then(responder);
}

module.exports = { register, startMcpServer, stopMcpServer, showAndFocusWindow, pendingWrites: () => agentQueue.pending() };
