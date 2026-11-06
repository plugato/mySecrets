// MySecrets (renderer) - Painel de códigos 2FA.
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

// Funções de Visualização MFA
function showMFAOverview() {
    // Esconder outras visualizações
    welcomeMessage.style.display = 'none';
    entryDetails.style.display = 'none';
    
    // Mostrar visualização MFA
    mfaOverview.style.display = 'block';
    
    // Renderizar códigos MFA
    renderMFACodes();
}

function hideMFAOverview() {
    mfaOverview.style.display = 'none';
    
    // Limpar timers MFA
    if (window.mfaTimers) {
        Object.values(window.mfaTimers).forEach(timer => clearInterval(timer));
        window.mfaTimers = {};
    }
}

function renderMFACodes() {
    const mfaEntries = activeData().filter(entry => entry.type === 'mfa');

    if (mfaEntries.length === 0) {
        mfaCodesGrid.innerHTML = `
            <div class="mfa-empty-state">
                <span class="material-symbols-outlined">security</span>
                <h3>Nenhuma entrada MFA encontrada</h3>
                <p>Adicione suas primeiras entradas de autenticação multifator</p>
                <button class="btn btn-primary" id="mfa-empty-add-btn">
                    <span class="material-symbols-outlined">add</span>
                    Adicionar MFA
                </button>
            </div>
        `;
        const addBtn = document.getElementById('mfa-empty-add-btn');
        if (addBtn) addBtn.addEventListener('click', () => openEntryModal());
        return;
    }
    
    // Criar cabeçalho da tabela
    mfaCodesGrid.innerHTML = `
        <div class="mfa-table-header">
            <div>Serviço</div>
            <div>Código MFA</div>
            <div>Timer</div>
            <div>Algoritmo</div>
            <div>Ações</div>
        </div>
    `;
    
    // Inicializar objeto de timers se não existir
    if (!window.mfaTimers) {
        window.mfaTimers = {};
    }
    
    mfaEntries.forEach(entry => {
        const rowElement = createMFARow(entry);
        mfaCodesGrid.appendChild(rowElement);
        
        // Iniciar timer para TOTP
        if (entry.mfaAlgorithm === 'totp') {
            startMFARowTimer(entry.id, entry);
        }
    });
}

function createMFARow(entry) {
    const div = document.createElement('div');
    div.className = 'mfa-code-row';
    div.dataset.id = entry.id;
    
    // eslint-disable-next-line no-unsanitized/property -- todos os campos com escapeHtml
    div.innerHTML = `
        <div class="mfa-row-title">
            <div class="mfa-row-name">
                <span class="material-symbols-outlined">security</span>
                ${escapeHtml(entry.title)}
            </div>
            <div class="mfa-row-details">
                ${entry.username ? escapeHtml(entry.username) : 'N/A'}
            </div>
        </div>
        
        <div class="mfa-row-code" id="mfa-row-code-${escapeHtml(entry.id)}">
            ••••••
        </div>

        <div class="mfa-row-timer">
            ${entry.mfaAlgorithm === 'totp' ? `
                <div class="mfa-timer" id="mfa-row-timer-${escapeHtml(entry.id)}">30</div>
            ` : `
                <div class="mfa-counter" id="mfa-row-counter-${escapeHtml(entry.id)}">
                    ${escapeHtml(entry.mfaCounter || 0)}
                </div>
            `}
        </div>

        <div class="mfa-row-info">
            ${escapeHtml(String(entry.mfaAlgorithm ?? '').toUpperCase())}<br>
            <small>${escapeHtml(entry.mfaDigits || 6)}d • ${escapeHtml(entry.mfaPeriod || 30)}s</small>
        </div>

        <div class="mfa-row-actions">
            <button class="mfa-copy-btn" title="Copiar código">
                <span class="material-symbols-outlined">content_copy</span>
            </button>
            <button class="mfa-edit-btn" title="Editar">
                <span class="material-symbols-outlined">edit</span>
            </button>
        </div>
    `;

    div.querySelector('.mfa-row-code').addEventListener('click', () => copyMFACode(entry.id));
    div.querySelector('.mfa-copy-btn').addEventListener('click', () => copyMFACode(entry.id));
    div.querySelector('.mfa-edit-btn').addEventListener('click', () => editEntry(entry.id));

    return div;
}

function startMFARowTimer(entryId, entry) {
    const updateMFARow = async () => {
        const mfaCodeElement = document.getElementById(`mfa-row-code-${entryId}`);
        const mfaTimerElement = document.getElementById(`mfa-row-timer-${entryId}`);
        
        if (mfaCodeElement && mfaTimerElement && entry.mfaAlgorithm === 'totp') {
            try {
                const mfaResult = await MFA.generate(entry);
                
                // Atualizar código apenas se mudou
                if (mfaCodeElement.textContent !== mfaResult.code) {
                    mfaCodeElement.textContent = mfaResult.code;
                }
                
                // Atualizar timer apenas se mudou
                const currentTimer = parseInt(mfaTimerElement.textContent) || 0;
                if (currentTimer !== mfaResult.remaining) {
                    mfaTimerElement.textContent = mfaResult.remaining.toString();
                }
                
                // Atualizar cor do timer baseado no tempo restante
                const period = entry.mfaPeriod || 30;
                const percentage = (mfaResult.remaining / period) * 360;
                
                // Resetar classes
                mfaTimerElement.classList.remove('warning', 'danger');
                
                let backgroundColor = 'var(--success-color)';
                if (mfaResult.remaining <= 5) {
                    mfaTimerElement.classList.add('danger');
                    backgroundColor = 'var(--danger-color)';
                } else if (mfaResult.remaining <= 10) {
                    mfaTimerElement.classList.add('warning');
                    backgroundColor = 'var(--warning-color)';
                }
                
                mfaTimerElement.style.background = `conic-gradient(${backgroundColor} ${percentage}deg, var(--border) ${percentage}deg)`;
                
            } catch (error) {
                console.error('Erro ao gerar MFA para linha:', error);
                if (mfaCodeElement.textContent !== '••••••') {
                    mfaCodeElement.textContent = '••••••';
                }
            }
        }
    };
    
    // Limpar timer anterior se existir
    if (window.mfaTimers[entryId]) {
        clearInterval(window.mfaTimers[entryId]);
    }
    
    // Atualizar imediatamente
    updateMFARow();
    
    // Criar novo timer - atualizar a cada segundo
    window.mfaTimers[entryId] = setInterval(updateMFARow, 1000);
}

async function copyMFACode(entryId) {
    const mfaCodeElement = document.getElementById(`mfa-row-code-${entryId}`);
    const copyBtn = document.querySelector(`[data-id="${CSS.escape(String(entryId))}"] .mfa-copy-btn`);
    
    if (mfaCodeElement && !['••••••', 'ERRO'].includes(mfaCodeElement.textContent.trim())) {
        try {
            await window.electronAPI.copyToClipboard(
                mfaCodeElement.textContent.trim(),
                getSettings().clipboardClearSeconds
            );
            
            // Feedback visual
            mfaCodeElement.classList.add('copying');
            const originalText = copyBtn.innerHTML;
            copyBtn.innerHTML = '<span class="material-symbols-outlined">check</span>';
            copyBtn.style.background = 'var(--success-color)';
            copyBtn.style.color = 'var(--text-inverse)';

            setTimeout(() => {
                mfaCodeElement.classList.remove('copying');
                // eslint-disable-next-line no-unsanitized/property -- restaura o HTML do próprio botão
                copyBtn.innerHTML = originalText;
                copyBtn.style.background = '';
                copyBtn.style.color = '';
            }, 1000);
            
        } catch (error) {
            console.error('Erro ao copiar código MFA:', error);
            alert('Erro ao copiar código');
        }
    }
}
