// MySecrets (renderer) - QR code por arrastar e controle do servidor MCP.
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

// ===== Drag & drop de imagem de QR code =====

function setupQrDropzone() {
    const dropzone = document.getElementById('qr-dropzone');
    if (!dropzone) return;

    ['dragenter', 'dragover'].forEach(evt => {
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach(evt => {
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('drag-over');
        });
    });

    dropzone.addEventListener('drop', (e) => {
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            processQrImageFile(file);
        }
    });
}

// ===== Controle do Servidor MCP =====

function setupMcpControls() {
    setupMcpAudit();
    const mcpBtn = document.getElementById('mcp-btn');
    if (!mcpBtn) return;

    mcpBtn.addEventListener('click', openMcpModal);
    document.getElementById('mcp-close-btn').addEventListener('click', closeModals);
    document.getElementById('mcp-start-btn').addEventListener('click', startMcp);
    document.getElementById('mcp-stop-btn').addEventListener('click', stopMcp);

    // Botões de copiar
    document.querySelectorAll('#mcp-modal [data-copy]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const el = document.getElementById(btn.dataset.copy);
            if (el) {
                window.electronAPI.copyToClipboard(el.value);
                const icon = btn.querySelector('.material-symbols-outlined');
                if (icon) {
                    const prev = icon.textContent;
                    icon.textContent = 'check';
                    setTimeout(() => { icon.textContent = prev; }, 1200);
                }
            }
        });
    });

    // Mostrar/ocultar token
    const tokenToggle = document.getElementById('mcp-token-toggle');
    if (tokenToggle) {
        tokenToggle.addEventListener('click', () => {
            const input = document.getElementById('mcp-token');
            const icon = tokenToggle.querySelector('.material-symbols-outlined');
            if (input.type === 'password') {
                input.type = 'text';
                icon.textContent = 'visibility_off';
            } else {
                input.type = 'password';
                icon.textContent = 'visibility';
            }
        });
    }

    // Abas
    document.querySelectorAll('#mcp-modal .mcp-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#mcp-modal .mcp-tab').forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('#mcp-modal .mcp-tab-content').forEach((c) => {
                c.style.display = c.dataset.tabContent === tab.dataset.tab ? 'block' : 'none';
            });
        });
    });

    // Iniciar o servidor junto com o desbloqueio (autofill da extensão)
    const autostart = document.getElementById('mcp-autostart');
    if (autostart) {
        autostart.addEventListener('change', () => {
            updateSettings({ mcpAutoStart: autostart.checked });
        });
    }

    // Atualiza o indicador se o servidor cair sozinho
    if (window.electronAPI.onMcpStopped) {
        window.electronAPI.onMcpStopped(() => refreshMcpStatus());
    }

    // Estado inicial do indicador no botão
    refreshMcpStatus();
}

async function openMcpModal() {
    document.getElementById('mcp-modal').style.display = 'flex';
    const s = getSettings();
    const portInput = document.getElementById('mcp-port-input');
    if (portInput) portInput.value = s.mcpPort || 8765;
    const autostart = document.getElementById('mcp-autostart');
    if (autostart) autostart.checked = s.mcpAutoStart === true;
    await refreshMcpStatus();
    await renderMcpAudit();
}

// ===== Atividade recente (registro das leituras) =====

const MCP_AUDIT_ACAO = {
    list_secrets: tr('listou o cofre'),
    search_secrets: tr('buscou no cofre'),
    get_credentials: tr('leu as credenciais de'),
    get_otp: tr('leu o código 2FA de'),
    get_secret_file: tr('baixou um anexo de'),
    passkey_get: tr('entrou com a passkey de')
};
const MCP_AUDIT_CLIENTE = { 'agente-stdio': tr('Agente (stdio)'), 'agente-http': tr('Agente (HTTP)'), extensao: tr('Extensão do navegador') };

async function renderMcpAudit() {
    const lista = document.getElementById('mcp-audit-list');
    if (!lista || !window.electronAPI.mcpAudit) return;
    const registros = await window.electronAPI.mcpAudit().catch(() => []);
    lista.replaceChildren();
    if (!registros.length) {
        const vazio = document.createElement('li');
        vazio.className = 'mcp-audit-empty';
        vazio.textContent = tr('Nenhuma leitura registrada.');
        lista.appendChild(vazio);
        return;
    }
    const tituloDe = (id) => {
        const e = currentData.find((x) => x.id === id);
        return e ? e.title : tr('(entrada removida)');
    };
    for (const r of registros) {
        const li = document.createElement('li');
        const quando = document.createElement('time');
        quando.dateTime = r.at;
        quando.textContent = new Date(r.at).toLocaleString(I18N.locale);
        const texto = document.createElement('span');
        const cliente = MCP_AUDIT_CLIENTE[r.client] || tr('Agente');
        const acao = MCP_AUDIT_ACAO[r.tool] || r.tool;
        const alvo = ['list_secrets', 'search_secrets'].includes(r.tool)
            ? tr('{0} resultado(s)', { 0: r.ids.length })
            : r.ids.map(tituloDe).join(', ');
        const ehBusca = ['list_secrets', 'search_secrets'].includes(r.tool);
        texto.textContent = ehBusca ? `${cliente} ${acao}: ${alvo}` : `${cliente} ${acao} ${alvo}`;
        li.append(quando, texto);
        lista.appendChild(li);
    }
}

function setupMcpAudit() {
    const limpar = document.getElementById('mcp-audit-clear');
    if (!limpar) return;
    limpar.addEventListener('click', async () => {
        await window.electronAPI.mcpAuditClear();
        await renderMcpAudit();
    });
}

async function refreshMcpStatus() {
    try {
        const status = await window.electronAPI.mcpStatus();
        renderMcpStatus(status);
        return status;
    } catch (err) {
        console.error('Erro ao consultar status do MCP:', err);
    }
}

function renderMcpStatus(status) {
    const running = status && status.running;
    const dot = document.getElementById('mcp-status-dot');
    const badge = document.getElementById('mcp-badge');
    const text = document.getElementById('mcp-status-text');
    const startBtn = document.getElementById('mcp-start-btn');
    const stopBtn = document.getElementById('mcp-stop-btn');
    const connection = document.getElementById('mcp-connection');

    if (dot) dot.classList.toggle('running', !!running);

    if (running && status.info) {
        if (badge) { badge.textContent = tr('Em execução'); badge.classList.add('running'); }
        if (text) text.textContent = tr("Escutando em {0}", { 0: status.info.url });
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        if (connection) {
            connection.style.display = 'block';
            document.getElementById('mcp-url').value = status.info.url;
            document.getElementById('mcp-token').value = status.info.token;
            document.getElementById('mcp-cmd-cli').value =
                `claude mcp add --transport http mysecrets ${status.info.url} ` +
                `--header "Authorization: Bearer ${status.info.token}"`;
            document.getElementById('mcp-cmd-json').value = JSON.stringify({
                mcpServers: {
                    mysecrets: {
                        type: 'http',
                        url: status.info.url,
                        headers: { Authorization: `Bearer ${status.info.token}` }
                    }
                }
            }, null, 2);
            // Pareamento da extensão: url + token em uma string só, para colar no popup
            const pairField = document.getElementById('mcp-pair-code');
            if (pairField) {
                pairField.value = btoa(JSON.stringify({ url: status.info.url, token: status.info.token }));
            }
        }
    } else {
        if (badge) { badge.textContent = tr('Parado'); badge.classList.remove('running'); }
        if (text) {
            text.textContent = (status && status.error)
                ? tr("Parado — {0}", { 0: status.error })
                : tr('O servidor não está em execução.');
        }
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        if (connection) connection.style.display = 'none';
    }
}

async function startMcp() {
    const startBtn = document.getElementById('mcp-start-btn');
    const port = parseInt(document.getElementById('mcp-port-input').value, 10) || 8765;
    updateSettings({ mcpPort: port });
    startBtn.disabled = true;
    document.getElementById('mcp-status-text').textContent = tr('Iniciando...');
    try {
        const result = await window.electronAPI.mcpStart({ port });
        if (result.success) {
            renderMcpStatus(result.status);
        } else {
            renderMcpStatus({ running: false, error: result.error });
        }
    } catch (err) {
        renderMcpStatus({ running: false, error: err.message });
    }
}

async function stopMcp() {
    const stopBtn = document.getElementById('mcp-stop-btn');
    stopBtn.disabled = true;
    try {
        const result = await window.electronAPI.mcpStop();
        renderMcpStatus(result.status || { running: false });
    } catch (err) {
        renderMcpStatus({ running: false, error: err.message });
    }
}

// Funções de autenticação
function showLoginForm() {
    console.log('Mostrando formulário de login');
    // Garantir que estamos na tela de autenticação
    authScreen.style.display = 'block';
    mainScreen.style.display = 'none';
    
    // Mostrar apenas o formulário de login
    loginForm.style.display = 'block';
    setupForm.style.display = 'none';
    
    // Esconder modal de reset se estiver aberto
    resetConfirmationModal.style.display = 'none';

    masterPasswordInput.focus();

    // Mostrar botão de login por digital se disponível e habilitado
    updateHelloButton();
    updatePhoneButton();
}
