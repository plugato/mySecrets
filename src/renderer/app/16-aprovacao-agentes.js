// MySecrets (renderer) - Aprovação de pedidos de agentes: leitura (liberar só
// esta, por N min ou negar), aviso de que o pedido também foi ao celular e as
// configurações de "aprovar pelo celular de qualquer lugar".
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.
// O processo principal decide e executa (src/main/agent-access.js).

const AGENT_READ_TOOLS = {
    get_credentials: tr('Credenciais (usuário e senha)'),
    get_otp: tr('Código 2FA'),
    get_secret_file: tr('Arquivo anexo'),
    list_secrets: tr('Lista de entradas do cofre'),
    search_secrets: tr('Busca no cofre'),
    match_url: tr('Entradas de um site')
};

// ===== Pedido de leitura (modal no PC) =====

let agentReadAsk = null; // { jobId, deadline, minutes, timer }
const agentReadModal = document.getElementById('agent-read-modal');

function closeAgentRead() {
    if (agentReadAsk && agentReadAsk.timer) clearInterval(agentReadAsk.timer);
    agentReadAsk = null;
    if (agentReadModal) agentReadModal.style.display = 'none';
}

function answerAgentRead(approved, mode) {
    if (!agentReadAsk) return;
    const { jobId, minutes } = agentReadAsk;
    closeAgentRead();
    window.electronAPI.agentReadAnswer(jobId, { approved, mode, minutes });
}

function renderAgentReadTimer() {
    if (!agentReadAsk) return;
    const restante = agentReadAsk.deadline - Date.now();
    const el = document.getElementById('agent-read-timer');
    el.textContent = tr("Vence em {0} — depois disso a leitura é negada", { 0: formatRemaining(restante) });
    el.classList.toggle('urgent', restante < 30000);
    if (restante <= 0) closeAgentRead();
}

function showAgentRead(req) {
    if (!agentReadModal) return;
    closeAgentRead();
    const s = req.summary || {};
    const linhas = [
        [tr('Agente'), req.client || tr('Agente')],
        [tr('O que'), AGENT_READ_TOOLS[s.tool] || s.tool]
    ];
    if (s.id) {
        const e = currentData.find((x) => x.id === s.id);
        linhas.push([tr('Entrada'), e ? e.title : s.id]);
    }
    if (s.query) linhas.push([tr('Busca'), s.query]);
    if (s.attachment) linhas.push([tr('Arquivo'), s.attachment]);
    const dl = document.createElement('dl');
    linhas.forEach(([k, v]) => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        dl.append(dt, dd);
    });
    document.getElementById('agent-read-body').replaceChildren(dl);
    document.getElementById('agent-read-queue').textContent =
        req.pending > 1 ? tr("Mais {0} pedido(s) esperando", { 0: req.pending - 1 }) : '';
    const minutos = req.windowMinutes || 5;
    document.getElementById('agent-read-window').textContent = tr("Liberar por {0} min", { 0: minutos });
    agentReadAsk = { jobId: req.jobId, deadline: req.deadline, minutes: minutos, timer: setInterval(renderAgentReadTimer, 1000) };
    renderAgentReadTimer();
    agentReadModal.style.display = 'flex';
    // Foco em "Negar": Enter por engano não libera nada
    setTimeout(() => document.getElementById('agent-read-decline').focus(), 0);
}

if (window.electronAPI && window.electronAPI.onAgentRead && agentReadModal) {
    window.electronAPI.onAgentRead(showAgentRead);
    window.electronAPI.onAgentReadCancel((jobId) => {
        if (agentReadAsk && agentReadAsk.jobId === jobId) closeAgentRead();
    });
    document.getElementById('agent-read-once').addEventListener('click', () => answerAgentRead(true, 'once'));
    document.getElementById('agent-read-window').addEventListener('click', () => answerAgentRead(true, 'window'));
    document.getElementById('agent-read-decline').addEventListener('click', () => answerAgentRead(false));
}

// ===== Gravação: o pedido também foi ao celular =====

let agentWriteRemote = null; // { jobId, phones }

function renderAgentWriteRemote(jobId) {
    const el = document.getElementById('agent-write-remote');
    if (!el) return;
    const ativo = agentWriteRemote && agentWriteRemote.jobId === jobId;
    el.style.display = ativo ? 'block' : 'none';
    if (ativo) {
        const nomes = (agentWriteRemote.phones || []).filter(Boolean).join(', ');
        el.textContent = nomes
            ? tr("Também enviado ao celular ({0}): a primeira resposta vale.", { 0: nomes })
            : tr('Também enviado ao celular: a primeira resposta vale.');
    }
}

if (window.electronAPI && window.electronAPI.onAgentWriteRemote) {
    window.electronAPI.onAgentWriteRemote((info) => {
        agentWriteRemote = info;
        renderAgentWriteRemote(agentConfirm.active());
    });
}

// ===== Configurações: aprovar pelo celular de qualquer lugar =====

function renderReadWindow(w) {
    const box = document.getElementById('phone-read-window');
    if (!box) return;
    box.style.display = w ? 'flex' : 'none';
    if (w) {
        const ate = new Date(w.until).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' });
        document.getElementById('phone-read-window-text').textContent = tr("Leitura liberada para agentes até {0}", { 0: ate });
    }
}

async function setupAgentApproval() {
    const remote = document.getElementById('phone-remote');
    const policy = document.getElementById('phone-read-policy');
    const minutes = document.getElementById('phone-window-minutes');
    if (!remote || !window.electronAPI.agentApprovalGet) return;

    let atual = null;
    try {
        atual = await window.electronAPI.agentApprovalGet();
    } catch (_) {
        return;
    }
    remote.checked = atual.settings.remote;
    policy.value = atual.settings.readPolicy;
    minutes.value = String(atual.settings.windowMinutes);
    renderReadWindow(atual.readWindow);

    const salvar = async (partial) => {
        const r = await window.electronAPI.agentApprovalSet(partial);
        if (r && r.settings) {
            remote.checked = r.settings.remote;
            policy.value = r.settings.readPolicy;
            minutes.value = String(r.settings.windowMinutes);
        }
        return r;
    };
    remote.addEventListener('change', async () => {
        if (remote.checked && !atual.phones) {
            const st = await window.electronAPI.phoneStatus().catch(() => ({ phones: [] }));
            if (!st.phones.length) {
                remote.checked = false;
                alert(tr('Pareie o celular primeiro (botão “Parear celular”).'));
                return;
            }
        }
        await salvar({ remote: remote.checked });
        // O servidor local precisa estar ligado para receber os pedidos dos agentes
        if (remote.checked) startMcpForRemote();
    });
    policy.addEventListener('change', () => salvar({ readPolicy: policy.value }));
    minutes.addEventListener('change', () => salvar({ windowMinutes: parseInt(minutes.value, 10) }));
    document.getElementById('phone-read-window-end').addEventListener('click', () => window.electronAPI.agentReadWindowEnd());
}

if (window.electronAPI && window.electronAPI.onAgentReadWindow) {
    window.electronAPI.onAgentReadWindow(renderReadWindow);
}

/** Com a aprovação pelo celular ligada, o servidor local roda mesmo com o cofre bloqueado. */
async function startMcpForRemote() {
    if (!window.electronAPI.agentApprovalGet) return;
    try {
        const atual = await window.electronAPI.agentApprovalGet();
        if (!atual.settings.remote || !atual.phones) return;
        const r = await window.electronAPI.mcpStart({ port: getSettings().mcpPort || 8765 });
        if (r && r.success && typeof refreshMcpStatus === 'function') refreshMcpStatus();
    } catch (_) { /* o usuário liga pelo painel MCP */ }
}

setupAgentApproval();
startMcpForRemote();
