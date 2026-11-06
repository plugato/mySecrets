// MySecrets (renderer) - Modais, gerador de senha, ações nas entradas e reset do cofre.
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

function closeModals() {
    console.log('Fechando todos os modais');
    entryModal.style.display = 'none';
    if (pendingVaultReload) setTimeout(reloadVaultFromDisk, 0);
    passwordGeneratorModal.style.display = 'none';
    resetConfirmationModal.style.display = 'none';
    importModal.style.display = 'none';
    const mcpModalEl = document.getElementById('mcp-modal');
    if (mcpModalEl) mcpModalEl.style.display = 'none';
    const settingsModalEl = document.getElementById('settings-modal');
    if (settingsModalEl) settingsModalEl.style.display = 'none';

    // Limpar campos do modal de reset
    resetConfirmationInput.value = '';
    confirmResetBtn.disabled = true;
}

// Funções do gerador de senhas
function openPasswordGenerator() {
    generateNewPassword();
    passwordGeneratorModal.style.display = 'flex';
}

function updatePasswordLength() {
    lengthValue.textContent = passwordLength.value;
    generateNewPassword();
}

function generateNewPassword() {
    const length = parseInt(passwordLength.value);
    const symbols = includeSymbols.checked;
    const password = window.electronAPI.generatePassword(length, symbols);
    generatedPassword.value = password;
}

function copyGeneratedPassword() {
    window.electronAPI.copyToClipboard(generatedPassword.value);
    alert(tr('Senha copiada!'));
}

function useGeneratedPassword() {
    entryPassword.value = generatedPassword.value;
    closeModals();
}

function togglePasswordVisibility() {
    const btn = document.getElementById('toggle-password-btn');
    if (entryPassword.type === 'password') {
        entryPassword.type = 'text';
        btn.textContent = '🙈';
    } else {
        entryPassword.type = 'password';
        btn.textContent = '👁️';
    }
}

// Funções de utilidade
function copyToClipboard(text, label = tr('Copiado')) {
    const clearSeconds = getSettings().clipboardClearSeconds;
    window.electronAPI.copyToClipboard(text, clearSeconds);

    // Feedback visual
    const tooltip = document.createElement('div');
    tooltip.textContent = clearSeconds > 0 ? tr("{0}! (limpa em {1}s)", { 0: label, 1: clearSeconds }) : `${label}!`;
    tooltip.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--success-color);
        color: white;
        padding: 0.5rem 1rem;
        border-radius: 0.5rem;
        z-index: 10000;
        font-size: 0.9rem;
    `;
    
    document.body.appendChild(tooltip);
    setTimeout(() => document.body.removeChild(tooltip), 1000);
}

function editEntry(entryId) {
    const entry = currentData.find(e => e.id === entryId);
    if (entry) {
        openEntryModal(entry);
    }
}

/**
 * Exclui uma entrada: entradas ativas vão para a lixeira (soft delete,
 * recuperáveis por 30 dias); entradas já na lixeira são removidas de vez.
 */
async function deleteEntry(entryId) {
    const entry = currentData.find(e => e.id === entryId);
    if (!entry) return;

    if (entry.deletedAt) {
        // Já está na lixeira: excluir definitivamente
        if (!confirm(tr('Excluir esta entrada DEFINITIVAMENTE? Esta ação não pode ser desfeita.'))) {
            return;
        }
        currentData = currentData.filter(e => e.id !== entryId);
    } else {
        if (!confirm(tr('Mover esta entrada para a lixeira? Você poderá restaurá-la em até 30 dias.'))) {
            return;
        }
        entry.deletedAt = new Date().toISOString();
    }

    try {
        const result = await persistData();

        if (result.success) {
            updateEntryCounts();
            renderTagsSidebar();
            handleSearch();

            // Limpar detalhes se a entrada excluída estava selecionada
            if (selectedEntry?.id === entryId) {
                selectedEntry = null;
                entryDetails.style.display = 'none';
                if (activeData().length === 0 && currentFilterType() !== 'trash') {
                    welcomeMessage.style.display = 'block';
                }
            }
        } else {
            alert(tr('Erro ao excluir entrada'));
        }
    } catch (error) {
        alert(tr('Erro ao excluir entrada'));
    }
}

/**
 * Restaura uma entrada da lixeira.
 */
async function restoreEntry(entryId) {
    const entry = currentData.find(e => e.id === entryId);
    if (!entry || !entry.deletedAt) return;

    delete entry.deletedAt;
    entry.updatedAt = new Date().toISOString();

    try {
        const result = await persistData();
        if (result.success) {
            updateEntryCounts();
            renderTagsSidebar();
            handleSearch();
            if (selectedEntry?.id === entryId) {
                selectedEntry = null;
                entryDetails.style.display = 'none';
                renderGridView();
            }
        } else {
            alert(tr('Erro ao restaurar entrada'));
        }
    } catch (error) {
        alert(tr('Erro ao restaurar entrada'));
    }
}





// Função para atualizar contador HOTP
async function updateHOTPCounter(entryId) {
    const entry = currentData.find(e => e.id === entryId);
    if (!entry || entry.mfaAlgorithm !== 'hotp') return;
    
    // Incrementar contador
    entry.mfaCounter = (entry.mfaCounter || 0) + 1;
    entry.updatedAt = new Date().toISOString();

    try {
        const result = await persistData();

        if (result.success) {
            // Atualizar interface
            await renderEntryDetails(entry);
        } else {
            alert(tr('Erro ao atualizar contador HOTP'));
        }
    } catch (error) {
        alert(tr('Erro ao atualizar contador HOTP'));
    }
}

// Funções de reset do cofre
function showResetConfirmation() {
    resetConfirmationModal.style.display = 'flex';
    resetConfirmationInput.value = '';
    resetConfirmationInput.focus();
    confirmResetBtn.disabled = true;
}

function closeResetModal() {
    resetConfirmationModal.style.display = 'none';
    resetConfirmationInput.value = '';
    confirmResetBtn.disabled = true;
}

function handleResetConfirmationInput() {
    const value = resetConfirmationInput.value.trim().toUpperCase();
    confirmResetBtn.disabled = value !== 'RESETAR';
}

async function handleReset() {
    if (resetConfirmationInput.value.trim().toUpperCase() !== 'RESETAR') {
        return;
    }
    
    try {
        const result = await window.electronAPI.resetData();
        
        if (result.success) {
            closeResetModal();
            currentData = [];
            currentMasterPassword = '';
            selectedEntry = null;
            
            // Mostrar tela de setup
            mainScreen.style.display = 'none';
            authScreen.style.display = 'block';
            showSetupForm();
            
            alert(tr('Cofre resetado com sucesso! Você pode criar uma nova senha mestra.'));
        } else {
            alert(tr('Erro ao resetar cofre: ') + result.error);
        }
    } catch (error) {
        alert(tr('Erro ao resetar cofre: ') + error.message);
    }
}
