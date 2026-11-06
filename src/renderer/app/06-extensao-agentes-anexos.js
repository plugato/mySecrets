// MySecrets (renderer) - Logins da extensão, gravações pedidas por agentes, anexos e atualizações.
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

// ===== Logins salvos pela extensão do navegador =====

/**
 * A extensão perguntou "Salvar este login?" e o usuário aceitou. Cria uma
 * entrada de login ou, com id, atualiza a senha (guardando a anterior no
 * histórico, como numa edição normal).
 */
async function saveLoginFromExtension({ id, url, username, password }) {
    if (!currentMasterPassword) return { success: false, error: 'Cofre bloqueado' };

    const now = new Date().toISOString();
    let entry;
    let mode;

    if (id) {
        entry = currentData.find(e => e.id === id && !e.deletedAt);
        if (!entry) return { success: false, error: 'Entrada não encontrada no cofre' };
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
    if (!result.success) return { success: false, error: result.error || 'Erro ao salvar o cofre' };

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
        <dt>Ação</dt><dd><strong>${escapeHtml(s.heading)}</strong></dd>
        <dt>Entrada</dt><dd>${escapeHtml(s.title)}</dd>
        <dt>Tipo</dt><dd>${escapeHtml(s.type)}</dd>`;
    if (s.tags.length) html += `<dt>Projeto/tags</dt><dd>${s.tags.map(escapeHtml).join(', ')}</dd>`;
    if (s.fields.length) {
        html += `<dt>Campos</dt><dd>${s.fields.map(f => escapeHtml(f.name) + marca(f.replaces)).join(', ')}</dd>`;
    }
    if (s.customFields.length) {
        html += `<dt>Campos extras</dt><dd>${s.customFields.map(c => escapeHtml(c.name) + marca(c.replaces)).join(', ')}</dd>`;
    }
    if (s.files.length) {
        html += `<dt>Arquivos</dt><dd>${lista(s.files.map(f =>
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
        state.total > 1 ? `Pedido 1 de ${state.total}` : '';
    const timerEl = document.getElementById('agent-write-timer');
    timerEl.textContent = `Vence em ${state.remaining} — depois disso nada é gravado`;
    timerEl.classList.toggle('urgent', state.remainingMs < 30000);
    agentModal.style.display = 'flex';
}

const agentConfirm = createConfirmController({ render: renderAgentConfirm });

document.getElementById('agent-write-approve').addEventListener('click', () => agentConfirm.answer(true));
document.getElementById('agent-write-decline').addEventListener('click', () => agentConfirm.answer(false));

async function handleAgentWriteRequest({ op, jobId, request, deadline, total }) {
    if (!currentMasterPassword) {
        return { success: false, error: 'O cofre está bloqueado. Desbloqueie o MySecrets e peça a gravação de novo. Nada foi gravado.' };
    }

    if (op === 'confirm') {
        const plan = planAgentWrite(currentData, request);
        if (plan.error) return { success: false, error: plan.error };
        return agentConfirm.request(jobId, plan, deadline, total);
    }

    if (op !== 'apply') return { success: false, error: 'Operação desconhecida' };

    const antes = currentData.map(e => ({ ...e }));
    const { entry, mode } = applyAgentWrite(currentData, request, { newId: generateId });
    const result = await persistData();
    if (!result.success) {
        currentData = antes;
        return { success: false, error: result.error || 'Erro ao salvar o cofre' };
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
        alert('Não foi possível anexar: ' + picked.error);
        return;
    }
    if (picked.files.length === 0) return;

    const anexos = [...entryAttachments(entry)];
    const now = new Date().toISOString();
    for (const f of picked.files) {
        const idx = anexos.findIndex(a => a.name === f.name);
        if (idx >= 0) {
            if (!confirm(`Já existe um anexo "${f.name}" nesta entrada. Substituir?`)) continue;
            anexos[idx] = { ...f, id: anexos[idx].id, addedAt: anexos[idx].addedAt || now, updatedAt: now };
        } else {
            anexos.push({ ...f, id: generateId(), addedAt: now, updatedAt: now });
        }
    }
    if (anexos.length > MAX_ATTACHMENTS_PER_ENTRY) {
        alert(`No máximo ${MAX_ATTACHMENTS_PER_ENTRY} anexos por entrada.`);
        return;
    }
    await saveEntryAttachments(entry, anexos);
}

async function removeAttachment(entryId, attachmentId) {
    const entry = currentData.find(e => e.id === entryId);
    if (!entry) return;
    const att = entryAttachments(entry).find(a => a.id === attachmentId);
    if (!att) return;
    if (!confirm(`Remover o anexo "${att.name}" do cofre? Baixe uma cópia antes se ainda precisar dele.`)) return;
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
        alert('Erro ao salvar o cofre');
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
    if (!result.success) alert('Não foi possível salvar o arquivo: ' + result.error);
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
                    setStatus('Verificando atualizações...');
                    break;
                case 'available':
                    setStatus(`Nova versão ${data.version} encontrada — baixando...`);
                    break;
                case 'downloading':
                    setStatus(`Baixando atualização... ${data.percent}%`);
                    break;
                case 'downloaded':
                    setStatus(`Versão ${data.version} baixada! Reinicie para aplicar.`);
                    break;
                case 'none':
                    setStatus('Você já está na versão mais recente.');
                    break;
                case 'error':
                    setStatus(`Falha ao verificar: ${data.message}`);
                    break;
            }
        });
    }

    checkBtn.addEventListener('click', async () => {
        checkBtn.disabled = true;
        setStatus('Verificando atualizações...');
        try {
            const result = await window.electronAPI.checkForUpdates();
            if (!result.success) {
                setStatus(`Falha ao verificar: ${result.error}`);
            }
            // Resultados de sucesso chegam pelos eventos update-status
        } catch (error) {
            setStatus(`Falha ao verificar: ${error.message}`);
        } finally {
            checkBtn.disabled = false;
        }
    });
}
