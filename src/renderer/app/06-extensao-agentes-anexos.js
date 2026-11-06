// MySecrets (renderer) - Logins da extensão, gravações pedidas por agentes, anexos e atualizações.
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

// ===== Logins salvos pela extensão do navegador =====

/**
 * A extensão perguntou "Salvar este login?" e o usuário aceitou. Cria uma
 * entrada de login ou, com id, atualiza a senha (guardando a anterior no
 * histórico, como numa edição normal).
 */
async function saveLoginFromExtension({ id, url, username, password }) {
    if (!currentMasterPassword) return { success: false, error: tr('Cofre bloqueado') };

    const now = new Date().toISOString();
    let entry;
    let mode;

    if (id) {
        entry = currentData.find(e => e.id === id && !e.deletedAt);
        if (!entry) return { success: false, error: tr('Entrada não encontrada no cofre') };
        if (entry.password && entry.password !== password) {
            entry.passwordHistory = [...(entry.passwordHistory || []), { password: entry.password, changedAt: now }].slice(-10);
        }
        entry.password = password;
        if (username && !entry.username) entry.username = username;
        entry.updatedAt = now;
        mode = 'update';
    } else {
        let origem = url;
        let titulo = url;
        try {
            const u = new URL(url);
            origem = u.origin;
            titulo = u.hostname.replace(/^www\./, '');
        } catch (_) { /* url já validada pelo servidor */ }
        entry = {
            id: generateId(),
            type: 'login',
            title: titulo,
            url: origem,
            username: username || '',
            password,
            notes: '',
            tags: ['extensao'],
            favorite: false,
            createdAt: now,
            updatedAt: now
        };
        currentData.push(entry);
        mode = 'new';
    }

    const result = await persistData();
    if (!result.success) return { success: false, error: result.error || tr('Erro ao salvar o cofre') };

    updateEntryCounts();
    renderTagsSidebar();
    handleSearch();
    return { success: true, id: entry.id, mode };
}

if (window.electronAPI && window.electronAPI.onExtensionSaveLogin) {
    window.electronAPI.onExtensionSaveLogin(async (req) => {
        let result;
        try {
            result = await saveLoginFromExtension(req);
        } catch (error) {
            result = { success: false, error: error.message };
        }
        window.electronAPI.extensionSaveResult(req.reqId, result);
    });
}

/** Passkey criada pela extensão (o app já confirmou com o usuário e gerou a chave). */
async function savePasskeyFromExtension(entry) {
    if (!currentMasterPassword) return { success: false, error: tr('Cofre bloqueado') };
    if (!entry || entry.type !== 'passkey' || !entry.passkey || !entry.passkey.privateKey) {
        return { success: false, error: tr('Passkey inválida') };
    }
    currentData.push(entry);
    const result = await persistData();
    if (!result.success) {
        currentData = currentData.filter(e => e !== entry);
        return { success: false, error: result.error || tr('Erro ao salvar o cofre') };
    }
    updateEntryCounts();
    renderTagsSidebar();
    handleSearch();
    return { success: true, id: entry.id };
}

if (window.electronAPI && window.electronAPI.onExtensionSavePasskey) {
    window.electronAPI.onExtensionSavePasskey(async (req) => {
        let result;
        try {
            result = await savePasskeyFromExtension(req.entry);
        } catch (error) {
            result = { success: false, error: error.message };
        }
        window.electronAPI.extensionSaveResult(req.reqId, result);
    });
}

/**
 * A extensão pediu para criar uma passkey: modal em destaque com o site, a
 * conta e a página que pediu. Um pedido por vez; o foco começa em "Recusar".
 */
let passkeyAsk = null;

function finishPasskeyAsk(approved) {
    if (!passkeyAsk) return;
    const { reqId } = passkeyAsk;
    passkeyAsk = null;
    document.getElementById('passkey-modal').style.display = 'none';
    window.electronAPI.extensionSaveResult(reqId, { approved });
}

if (window.electronAPI && window.electronAPI.onExtensionConfirmPasskey) {
    window.electronAPI.onExtensionConfirmPasskey((req) => {
        if (passkeyAsk || !currentMasterPassword) {
            window.electronAPI.extensionSaveResult(req.reqId, { approved: false });
            return;
        }
        passkeyAsk = req;
        document.getElementById('passkey-site').textContent = req.rpId;
        document.getElementById('passkey-account').textContent = req.account;
        document.getElementById('passkey-origin').textContent = req.origin;
        document.getElementById('passkey-modal').style.display = 'flex';
        setTimeout(() => document.getElementById('passkey-decline').focus(), 0);
    });
    window.electronAPI.onExtensionConfirmPasskeyCancel((reqId) => {
        if (passkeyAsk && passkeyAsk.reqId === reqId) {
            passkeyAsk = null;
            document.getElementById('passkey-modal').style.display = 'none';
        }
    });
    document.getElementById('passkey-approve').addEventListener('click', () => finishPasskeyAsk(true));
    document.getElementById('passkey-decline').addEventListener('click', () => finishPasskeyAsk(false));
}

// ===== Gravação pedida por agente (servidor MCP) =====

/**
 * O main pede a confirmação ('confirm') de um pedido por vez e, se o usuário
 * aprovar, a gravação ('apply'). A confirmação é um modal em destaque dentro
 * do app, com o prazo correndo; a lógica fica em agent-write.js.
 */
const agentModal = document.getElementById('agent-write-modal');

function renderAgentConfirm(state) {
    if (!state) {
        agentModal.style.display = 'none';
        return;
    }
    const s = state.summary;
    const marca = (r, texto = 'substitui') => r ? ` <span class="agent-write-replace">(${texto})</span>` : '';
    const lista = (itens) => `<ul>${itens.join('')}</ul>`;
    let html = `<dl>
        <dt>${escapeHtml(tr("Ação"))}</dt><dd><strong>${escapeHtml(s.heading)}</strong></dd>
        <dt>${escapeHtml(tr("Entrada"))}</dt><dd>${escapeHtml(s.title)}</dd>
        <dt>${escapeHtml(tr("Tipo"))}</dt><dd>${escapeHtml(s.type)}</dd>`;
    if (s.tags.length) html += `<dt>${escapeHtml(tr("Projeto/tags"))}</dt><dd>${s.tags.map(escapeHtml).join(', ')}</dd>`;
    if (s.fields.length) {
        html += `<dt>${escapeHtml(tr("Campos"))}</dt><dd>${s.fields.map(f => escapeHtml(f.name) + marca(f.replaces)).join(', ')}</dd>`;
    }
    if (s.customFields.length) {
        html += `<dt>${escapeHtml(tr("Campos extras"))}</dt><dd>${s.customFields.map(c => escapeHtml(c.name) + marca(c.replaces)).join(', ')}</dd>`;
    }
    if (s.files.length) {
        html += `<dt>${escapeHtml(tr("Arquivos"))}</dt><dd>${lista(s.files.map(f =>
            `<li>${escapeHtml(f.name)} — ${escapeHtml(f.size)} <span class="agent-write-sha">sha256 ${escapeHtml(f.sha256)}…</span>` +
            `${marca(f.replaces, 'substitui o anexo atual')}</li>`))}</dd>`;
    }
    html += `</dl>`;

    const body = document.getElementById('agent-write-body');
    // Redesenha o corpo só quando o pedido muda (o timer atualiza a cada segundo)
    if (body.dataset.jobId !== state.jobId) {
        // eslint-disable-next-line no-unsanitized/property -- html montado acima só com escapeHtml
        body.innerHTML = html;
        body.dataset.jobId = state.jobId;
        setTimeout(() => document.getElementById('agent-write-decline').focus(), 0);
    }
    document.getElementById('agent-write-queue').textContent =
        state.total > 1 ? tr("Pedido 1 de {0}", { 0: state.total }) : '';
    const timerEl = document.getElementById('agent-write-timer');
    timerEl.textContent = tr("Vence em {0} — depois disso nada é gravado", { 0: state.remaining });
    timerEl.classList.toggle('urgent', state.remainingMs < 30000);
    agentModal.style.display = 'flex';
}

const agentConfirm = createConfirmController({ render: renderAgentConfirm });

document.getElementById('agent-write-approve').addEventListener('click', () => agentConfirm.answer(true));
document.getElementById('agent-write-decline').addEventListener('click', () => agentConfirm.answer(false));

async function handleAgentWriteRequest({ op, jobId, request, deadline, total }) {
    if (!currentMasterPassword) {
        return { success: false, error: tr('O cofre está bloqueado. Desbloqueie o MySecrets e peça a gravação de novo. Nada foi gravado.') };
    }

    if (op === 'confirm') {
        const plan = planAgentWrite(currentData, request);
        if (plan.error) return { success: false, error: plan.error };
        return agentConfirm.request(jobId, plan, deadline, total);
    }

    if (op !== 'apply') return { success: false, error: tr('Operação desconhecida') };

    const antes = currentData.map(e => ({ ...e }));
    const { entry, mode } = applyAgentWrite(currentData, request, { newId: generateId });
    const result = await persistData();
    if (!result.success) {
        currentData = antes;
        return { success: false, error: result.error || tr('Erro ao salvar o cofre') };
    }

    updateEntryCounts();
    renderTagsSidebar();
    handleSearch();
    if (selectedEntry && selectedEntry.id === entry.id) {
        const atual = currentData.find(e => e.id === entry.id);
        if (atual) selectEntry(atual);
    }
    return { success: true, id: entry.id, mode, title: entry.title };
}

if (window.electronAPI && window.electronAPI.onAgentWrite) {
    window.electronAPI.onAgentWrite(async (req) => {
        let result;
        try {
            result = await handleAgentWriteRequest(req);
        } catch (error) {
            result = { success: false, error: error.message };
        }
        window.electronAPI.agentWriteResult(req.reqId, result);
    });
    window.electronAPI.onAgentWriteCancel((jobId) => agentConfirm.cancel(jobId));
    window.electronAPI.onAgentWriteCount((n) => agentConfirm.setTotal(n));
}

// ===== Anexos de arquivo (interface) =====

const MAX_ATTACHMENTS_PER_ENTRY = 20;

async function attachFilesToEntry(entryId) {
    const entry = currentData.find(e => e.id === entryId);
    if (!entry) return;
    const picked = await window.electronAPI.attachmentPick();
    if (!picked.success) {
        alert(tr('Não foi possível anexar: ') + picked.error);
        return;
    }
    if (picked.files.length === 0) return;

    const anexos = [...entryAttachments(entry)];
    const now = new Date().toISOString();
    for (const f of picked.files) {
        const idx = anexos.findIndex(a => a.name === f.name);
        if (idx >= 0) {
            if (!confirm(tr("Já existe um anexo \"{0}\" nesta entrada. Substituir?", { 0: f.name }))) continue;
            anexos[idx] = { ...f, id: anexos[idx].id, addedAt: anexos[idx].addedAt || now, updatedAt: now };
        } else {
            anexos.push({ ...f, id: generateId(), addedAt: now, updatedAt: now });
        }
    }
    if (anexos.length > MAX_ATTACHMENTS_PER_ENTRY) {
        alert(tr("No máximo {0} anexos por entrada.", { 0: MAX_ATTACHMENTS_PER_ENTRY }));
        return;
    }
    await saveEntryAttachments(entry, anexos);
}

async function removeAttachment(entryId, attachmentId) {
    const entry = currentData.find(e => e.id === entryId);
    if (!entry) return;
    const att = entryAttachments(entry).find(a => a.id === attachmentId);
    if (!att) return;
    if (!confirm(tr("Remover o anexo \"{0}\" do cofre? Baixe uma cópia antes se ainda precisar dele.", { 0: att.name }))) return;
    await saveEntryAttachments(entry, entryAttachments(entry).filter(a => a.id !== attachmentId));
}

async function saveEntryAttachments(entry, anexos) {
    const anteriores = entry.attachments;
    const updatedAt = entry.updatedAt;
    entry.attachments = anexos;
    entry.updatedAt = new Date().toISOString();
    const result = await persistData();
    if (!result.success) {
        entry.attachments = anteriores;
        entry.updatedAt = updatedAt;
        alert(tr('Erro ao salvar o cofre'));
        return;
    }
    const atual = currentData.find(e => e.id === entry.id) || entry;
    handleSearch();
    selectEntry(atual);
}

async function downloadAttachment(entryId, attachmentId) {
    const entry = currentData.find(e => e.id === entryId);
    const att = entry && entryAttachments(entry).find(a => a.id === attachmentId);
    if (!att) return;
    const result = await window.electronAPI.attachmentSave(att);
    if (!result.success) alert(tr('Não foi possível salvar o arquivo: ') + result.error);
}

// ===== Atualizações automáticas (UI) =====

function setupUpdateControls() {
    const versionEl = document.getElementById('app-version');
    const statusEl = document.getElementById('update-status-text');
    const checkBtn = document.getElementById('check-updates-btn');
    if (!checkBtn) return;

    if (window.electronAPI.getAppVersion) {
        window.electronAPI.getAppVersion().then(v => { versionEl.textContent = `v${v}`; });
    }

    const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

    if (window.electronAPI.onUpdateStatus) {
        window.electronAPI.onUpdateStatus((data) => {
            switch (data.status) {
                case 'checking':
                    setStatus(tr('Verificando atualizações...'));
                    break;
                case 'available':
                    setStatus(tr("Nova versão {0} encontrada — baixando...", { 0: data.version }));
                    break;
                case 'downloading':
                    setStatus(tr("Baixando atualização... {0}%", { 0: data.percent }));
                    break;
                case 'downloaded':
                    setStatus(tr("Versão {0} baixada! Reinicie para aplicar.", { 0: data.version }));
                    break;
                case 'none':
                    setStatus(tr('Você já está na versão mais recente.'));
                    break;
                case 'error':
                    setStatus(tr("Falha ao verificar: {0}", { 0: data.message }));
                    break;
            }
        });
    }

    checkBtn.addEventListener('click', async () => {
        checkBtn.disabled = true;
        setStatus(tr('Verificando atualizações...'));
        try {
            const result = await window.electronAPI.checkForUpdates();
            if (!result.success) {
                setStatus(tr("Falha ao verificar: {0}", { 0: result.error }));
            }
            // Resultados de sucesso chegam pelos eventos update-status
        } catch (error) {
            setStatus(tr("Falha ao verificar: {0}", { 0: error.message }));
        } finally {
            checkBtn.disabled = false;
        }
    });
}
