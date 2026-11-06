// MySecrets (renderer) - Força de senha, inicialização da tela e eventos.
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

// ===== Força de senha =====

/**
 * Pontuação simples de força: 0 (muito fraca) a 4 (forte).
 * Considera comprimento e variedade de classes de caracteres.
 */
function computePasswordStrength(password) {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (password.length >= 16) score++;

    let classes = 0;
    if (/[a-z]/.test(password)) classes++;
    if (/[A-Z]/.test(password)) classes++;
    if (/[0-9]/.test(password)) classes++;
    if (/[^a-zA-Z0-9]/.test(password)) classes++;
    if (classes >= 3) score++;
    if (classes < 2 && score > 1) score = 1;

    // Padrões óbvios derrubam a pontuação
    if (/^(.)\1+$/.test(password) || /^(0123|1234|abcd|qwer|senha|password)/i.test(password)) {
        score = Math.min(score, 1);
    }

    return Math.min(score, 4);
}

function updateStrengthMeter() {
    const fill = document.getElementById('strength-fill');
    const label = document.getElementById('strength-label');
    if (!fill || !label) return;

    const password = newMasterPasswordInput.value;
    const score = computePasswordStrength(password);
    const levels = [
        { pct: 5, color: 'var(--danger-color)', text: '' },
        { pct: 25, color: 'var(--danger-color)', text: tr('Muito fraca') },
        { pct: 50, color: 'var(--warning-color)', text: tr('Fraca') },
        { pct: 75, color: 'var(--info-color)', text: tr('Boa') },
        { pct: 100, color: 'var(--success-color)', text: tr('Forte') }
    ];
    const level = levels[score];
    fill.style.width = password ? `${level.pct}%` : '0';
    fill.style.background = level.color;
    label.textContent = password ? level.text : '';
    label.style.color = level.color;
}

// Funções de pesquisa aprimorada
function clearSearch() {
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    handleSearch();
}

// Funções de ordenação
function handleSort() {
    const sortType = sortSelect.value;
    
    filteredData.sort((a, b) => {
        switch (sortType) {
            case 'title':
                return a.title.localeCompare(b.title);
            case 'title-desc':
                return b.title.localeCompare(a.title);
            case 'date-new':
                return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
            case 'date-old':
                return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
            case 'type':
                return a.type.localeCompare(b.type);
            default:
                return 0;
        }
    });
    
    renderEntries();
}

// Inicialização
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Iniciando aplicação MySecrets...');
    
    try {
        // Inicializar tema
        initializeTheme();
        
        const dataExists = await window.electronAPI.checkDataExists();
        console.log('Verificação de dados existentes:', dataExists);
        
        if (dataExists) {
            console.log('Dados encontrados - mostrando tela de login');
            showLoginForm();
            autoHelloLogin();
        } else {
            console.log('Nenhum dado encontrado - mostrando tela de setup');
            showSetupForm();
        }
        
        setupEventListeners();
        setupKeyboardShortcuts();
        setupAutoLock();
        updatePasswordLength();
        generateNewPassword();

        // Informa ao main se o atalho global deve ser registrado
        // (só acontece se o usuário ativou nas configurações; o main aplica um atraso)
        if (window.electronAPI.setGlobalShortcut) {
            window.electronAPI.setGlobalShortcut(getSettings().globalShortcut === true).catch(() => {});
        }

        console.log('Inicialização concluída com sucesso');
    } catch (error) {
        console.error('Erro na inicialização:', error);
        alert(tr('Erro na inicialização da aplicação: ') + error.message);
        // Em caso de erro, mostrar tela de setup como fallback
        showSetupForm();
    }
});

// Event Listeners
function setupEventListeners() {
    // Autenticação
    loginBtn.addEventListener('click', handleLogin);
    setupBtn.addEventListener('click', handleSetup);
    helloLoginBtn.addEventListener('click', () => {
        if (helloWaiting) cancelHelloLogin();
        else handleHelloLogin(false);
    });
    forgotPasswordBtn.addEventListener('click', showResetConfirmation);
    masterPasswordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
    
    // Reset do cofre
    cancelResetBtn.addEventListener('click', closeResetModal);
    confirmResetBtn.addEventListener('click', handleReset);
    resetConfirmationInput.addEventListener('input', handleResetConfirmationInput);
    
    // Tela principal
    addEntryBtn.addEventListener('click', () => openEntryModal());
    importEntriesBtn.addEventListener('click', openImportModal);
    lockBtn.addEventListener('click', lockApp);
    themeToggleBtn.addEventListener('click', toggleThemeMenu);
    document.querySelectorAll('.theme-option').forEach(option => {
        option.addEventListener('click', () => {
            setTheme(option.dataset.themeValue);
            closeThemeMenu();
        });
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.theme-switcher')) {
            closeThemeMenu();
        }
    });
    searchInput.addEventListener('input', handleSearch);
    clearSearchBtn.addEventListener('click', clearSearch);
    sortSelect.addEventListener('change', handleSort);
    
    // Filtros
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => handleFilter(btn.dataset.type));
    });
    
    // Modal
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', closeModals);
    });
    
    document.getElementById('cancel-btn').addEventListener('click', closeModals);
    document.getElementById('save-btn').addEventListener('click', saveEntry);
    
    // Tipo de entrada
    entryType.addEventListener('change', handleEntryTypeChange);
    
    // Algoritmo MFA
    entryMfaAlgorithm.addEventListener('change', handleMfaAlgorithmChange);

    // Importar MFA a partir de imagem de QR code
    const qrImportBtn = document.getElementById('mfa-qr-import-btn');
    const qrImportInput = document.getElementById('mfa-qr-import-input');
    if (qrImportBtn && qrImportInput) {
        qrImportBtn.addEventListener('click', () => qrImportInput.click());
        qrImportInput.addEventListener('change', handleMfaQrImageSelect);
    }

    // Gerador de senhas
    document.getElementById('generate-password-btn').addEventListener('click', openPasswordGenerator);
    document.getElementById('toggle-password-btn').addEventListener('click', togglePasswordVisibility);
    passwordLength.addEventListener('input', updatePasswordLength);
    includeSymbols.addEventListener('change', generateNewPassword);
    document.getElementById('regenerate-btn').addEventListener('click', generateNewPassword);
    document.getElementById('copy-generated-btn').addEventListener('click', copyGeneratedPassword);
    document.getElementById('use-password-btn').addEventListener('click', useGeneratedPassword);
    
    // Importação
    importFileInput.addEventListener('change', handleFileSelect);
    cancelImportBtn.addEventListener('click', closeModals);
    confirmImportBtn.addEventListener('click', handleImportEntries);
    
    // Custom Fields
    addCustomFieldBtn.addEventListener('click', addCustomField);

    // Servidor MCP
    setupMcpControls();

    // Configurações
    setupSettingsControls();

    // Botão de boas-vindas (adicionar primeira entrada)
    const welcomeAddBtn = document.getElementById('welcome-add-btn');
    if (welcomeAddBtn) {
        welcomeAddBtn.addEventListener('click', () => openEntryModal());
    }

    // Medidor de força da senha mestra (setup)
    newMasterPasswordInput.addEventListener('input', updateStrengthMeter);

    // Arrastar e soltar imagem de QR code no formulário MFA
    setupQrDropzone();

    // Fechar modais clicando fora
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeModals();
        }
    });
}
