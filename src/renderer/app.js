// Implementação de MFA com suporte a diferentes algoritmos usando otplib
class MFA {
    static async generateTOTP(secret, period = 30, digits = 6, algorithm = 'sha1') {
        if (!window.electronAPI || !window.electronAPI.generateTOTP) {
            console.error('API do Electron não disponível');
            return { code: '000000', remaining: 30, period };
        }
        
        return await window.electronAPI.generateTOTP(secret, { period, digits, algorithm });
    }
    
    static async generateHOTP(secret, counter = 0, digits = 6, algorithm = 'sha1') {
        if (!window.electronAPI || !window.electronAPI.generateHOTP) {
            console.error('API do Electron não disponível');
            return { code: '000000', counter: counter + 1 };
        }
        
        return await window.electronAPI.generateHOTP(secret, counter, { digits, algorithm });
    }
    
    static async generate(entry) {
        const { 
            mfaSecret, 
            mfaAlgorithm = 'totp', 
            mfaPeriod = 30, 
            mfaDigits = 6, 
            mfaCounter = 0, 
            mfaHash = 'sha1' 
        } = entry;
        
        console.log('MFA.generate - mfaHash:', mfaHash, 'typeof:', typeof mfaHash);
        
        if (mfaAlgorithm === 'hotp') {
            return await this.generateHOTP(mfaSecret, mfaCounter, mfaDigits, mfaHash);
        } else {
            return await this.generateTOTP(mfaSecret, mfaPeriod, mfaDigits, mfaHash);
        }
    }
    
    static async verifyTOTP(code, entry) {
        if (!window.electronAPI || !window.electronAPI.verifyTOTP) {
            console.error('API do Electron não disponível');
            return false;
        }
        
        const { mfaSecret, mfaPeriod = 30, mfaDigits = 6, mfaHash = 'sha1' } = entry;
        return await window.electronAPI.verifyTOTP(code, mfaSecret, { 
            period: mfaPeriod, 
            digits: mfaDigits, 
            algorithm: mfaHash 
        });
    }
}

// Estado da aplicação
let currentData = [];
let filteredData = [];
let selectedEntry = null;
let currentMasterPassword = '';
let editingEntry = null;
let selectedTag = null; // tag ativa no filtro da sidebar

// Entradas ativas (fora da lixeira) e entradas na lixeira
function activeData() {
    return currentData.filter(e => !e.deletedAt);
}

function trashedData() {
    return currentData.filter(e => e.deletedAt);
}

/**
 * Salva o cofre respeitando as preferências (backup automático).
 * Usar sempre este helper em vez de chamar saveData diretamente.
 */
function persistData() {
    return window.electronAPI.saveData(currentData, currentMasterPassword, {
        autoBackup: getSettings().autoBackup
    });
}

// ===== Configurações do usuário =====

const DEFAULT_SETTINGS = {
    autoLockMinutes: 15,       // 0 = nunca
    clipboardClearSeconds: 30, // 0 = nunca
    lockOnSuspend: true,
    autoBackup: true,
    globalShortcut: false,     // Ctrl+Shift+M — desligado por padrão (o registro pode travar o teclado)
    mcpAutoStart: true,        // sobe o servidor local ao desbloquear (autofill da extensão)
    mcpPort: 8765
};

let cachedSettings = null;

function getSettings() {
    if (cachedSettings) return cachedSettings;
    try {
        const stored = JSON.parse(localStorage.getItem('settings') || '{}');
        // updateSettings grava tudo, então o antigo padrão "desligado" ficou
        // salvo: liga uma vez para a extensão funcionar sem abrir o modal MCP.
        if (!stored.mcpAutoStartMigrated) {
            stored.mcpAutoStart = true;
            stored.mcpAutoStartMigrated = true;
            localStorage.setItem('settings', JSON.stringify({ ...DEFAULT_SETTINGS, ...stored }));
        }
        cachedSettings = { ...DEFAULT_SETTINGS, ...stored };
    } catch (_) {
        cachedSettings = { ...DEFAULT_SETTINGS };
    }
    return cachedSettings;
}

function updateSettings(partial) {
    cachedSettings = { ...getSettings(), ...partial };
    localStorage.setItem('settings', JSON.stringify(cachedSettings));
    resetAutoLockTimer(); // o timeout pode ter mudado
}

// Elementos DOM
const authScreen = document.getElementById('auth-screen');
const mainScreen = document.getElementById('main-screen');
const loginForm = document.getElementById('login-form');
const setupForm = document.getElementById('setup-form');
const masterPasswordInput = document.getElementById('master-password');
const newMasterPasswordInput = document.getElementById('new-master-password');
const confirmMasterPasswordInput = document.getElementById('confirm-master-password');
const loginBtn = document.getElementById('login-btn');
const setupBtn = document.getElementById('setup-btn');
const loginError = document.getElementById('login-error');
const setupError = document.getElementById('setup-error');
const helloLoginBtn = document.getElementById('hello-login-btn');
const helloDivider = document.getElementById('hello-divider');
const forgotPasswordBtn = document.getElementById('forgot-password-btn');

// Modal de reset
const resetConfirmationModal = document.getElementById('reset-confirmation-modal');
const resetConfirmationInput = document.getElementById('reset-confirmation');
const cancelResetBtn = document.getElementById('cancel-reset-btn');
const confirmResetBtn = document.getElementById('confirm-reset-btn');

// Elementos da tela principal
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search');
const addEntryBtn = document.getElementById('add-entry-btn');
const importEntriesBtn = document.getElementById('import-entries-btn');
const lockBtn = document.getElementById('lock-btn');
const themeToggleBtn = document.getElementById('theme-toggle');
const themeMenu = document.getElementById('theme-menu');
const filterBtns = document.querySelectorAll('.filter-btn');
const sortSelect = document.getElementById('sort-select');
const entriesList = document.getElementById('entries-list');
const welcomeMessage = document.getElementById('welcome-message');
const entryDetails = document.getElementById('entry-details');
const mfaOverview = document.getElementById('mfa-overview');
const mfaCodesGrid = document.getElementById('mfa-codes-grid');
const entriesCount = document.getElementById('entries-count');

// Modal elementos
const entryModal = document.getElementById('entry-modal');
const passwordGeneratorModal = document.getElementById('password-generator-modal');
const importModal = document.getElementById('import-modal');
const modalTitle = document.getElementById('modal-title');
const entryForm = document.getElementById('entry-form');

// Elementos de importação
const importFileInput = document.getElementById('import-file-input');
let pendingImportEntries = null; // entradas lidas no preview, aguardando confirmação
const fileInfo = document.getElementById('file-info');
const importPreview = document.getElementById('import-preview');
const importEntriesList = document.getElementById('import-entries-list');
const skipDuplicates = document.getElementById('skip-duplicates');
const cancelImportBtn = document.getElementById('cancel-import-btn');
const confirmImportBtn = document.getElementById('confirm-import-btn');

// Elementos do formulário
const entryType = document.getElementById('entry-type');
const entryTitle = document.getElementById('entry-title');
const entryUrl = document.getElementById('entry-url');
const entryUsername = document.getElementById('entry-username');
const entryPassword = document.getElementById('entry-password');
const entryLinkedMfa = document.getElementById('entry-linked-mfa');
const entryMfaSecret = document.getElementById('entry-mfa-secret');
const entryMfaAlgorithm = document.getElementById('entry-mfa-algorithm');
const entryMfaPeriod = document.getElementById('entry-mfa-period');
const entryMfaDigits = document.getElementById('entry-mfa-digits');
const entryMfaCounter = document.getElementById('entry-mfa-counter'); 
const entryMfaDigitsHotp = document.getElementById('entry-mfa-digits-hotp');
const entryMfaHash = document.getElementById('entry-mfa-hash');
const entryMfaHashHotp = document.getElementById('entry-mfa-hash-hotp');
const mfaTotpOptions = document.getElementById('mfa-totp-options');
const mfaHotpOptions = document.getElementById('mfa-hotp-options');
const entryToken = document.getElementById('entry-token');
const entryTokenType = document.getElementById('entry-token-type');
const entryTokenExpires = document.getElementById('entry-token-expires');
const entryNotes = document.getElementById('entry-notes');

// Grupos de campos
const urlGroup = document.getElementById('url-group');
const usernameGroup = document.getElementById('username-group');
const passwordGroup = document.getElementById('password-group');
const linkedMfaGroup = document.getElementById('linked-mfa-group');
const mfaGroup = document.getElementById('mfa-group');
const tokenGroup = document.getElementById('token-group');

// Custom Fields
const customFieldsList = document.getElementById('custom-fields-list');
const addCustomFieldBtn = document.getElementById('add-custom-field-btn');
let currentCustomFields = []; // Array temporário para custom fields durante edição

// Gerador de senhas
const passwordLength = document.getElementById('password-length');
const lengthValue = document.getElementById('length-value');
const includeSymbols = document.getElementById('include-symbols');
const generatedPassword = document.getElementById('generated-password');

// Funções de tema
const AVAILABLE_THEMES = ['light', 'dark', 'ocean', 'forest', 'sunset'];

function initializeTheme() {
    const savedTheme = localStorage.getItem('theme');
    setTheme(AVAILABLE_THEMES.includes(savedTheme) ? savedTheme : 'light');
}

function setTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);

    // Marcar opção ativa no menu de temas
    document.querySelectorAll('.theme-option').forEach(option => {
        option.classList.toggle('active', option.dataset.themeValue === theme);
    });
}

function toggleThemeMenu(event) {
    event.stopPropagation();
    themeMenu.classList.toggle('open');
}

function closeThemeMenu() {
    themeMenu.classList.remove('open');
}

// ===== Bloqueio automático por inatividade =====

let autoLockTimer = null;
let sessionRefreshTimer = null;

function isUnlocked() {
    return mainScreen.style.display !== 'none' && mainScreen.style.display !== '';
}

function resetAutoLockTimer() {
    if (autoLockTimer) {
        clearTimeout(autoLockTimer);
        autoLockTimer = null;
    }
    const minutes = getSettings().autoLockMinutes;
    if (minutes > 0 && isUnlocked()) {
        autoLockTimer = setTimeout(() => {
            if (isUnlocked()) {
                console.log('Bloqueio automático por inatividade');
                lockApp();
            }
        }, minutes * 60 * 1000);
    }
}

function setupAutoLock() {
    // Qualquer atividade do usuário reinicia o timer (mousemove com throttle)
    let lastActivity = 0;
    const onActivity = () => {
        const now = Date.now();
        if (now - lastActivity > 5000) {
            lastActivity = now;
            resetAutoLockTimer();
        }
    };
    ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(evt => {
        document.addEventListener(evt, onActivity, { passive: true });
    });

    // Bloqueio vindo do sistema (suspend/lock-screen) ou da bandeja
    if (window.electronAPI.onSystemLock) {
        window.electronAPI.onSystemLock(() => {
            if (!isUnlocked()) return;
            // Bloqueio via bandeja é sempre respeitado; suspend depende da opção
            if (getSettings().lockOnSuspend !== false) {
                console.log('Bloqueio solicitado pelo sistema');
                lockApp();
            }
        });
    }
}

function startSessionRefresh() {
    stopSessionRefresh();
    // Renova a sessão da extensão/MCP a cada 5 min enquanto desbloqueado
    if (window.electronAPI.refreshSession) {
        sessionRefreshTimer = setInterval(() => {
            if (isUnlocked()) {
                window.electronAPI.refreshSession();
            }
        }, 5 * 60 * 1000);
    }
}

function stopSessionRefresh() {
    if (sessionRefreshTimer) {
        clearInterval(sessionRefreshTimer);
        sessionRefreshTimer = null;
    }
}

// ===== Atalhos de teclado =====

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModals();
            closeThemeMenu();
            return;
        }

        if (!(e.ctrlKey || e.metaKey) || !isUnlocked()) return;

        switch (e.key.toLowerCase()) {
            case 'f':
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
                break;
            case 'n':
                e.preventDefault();
                openEntryModal();
                break;
            case 'l':
                e.preventDefault();
                lockApp();
                break;
        }
    });
}

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
        { pct: 25, color: 'var(--danger-color)', text: 'Muito fraca' },
        { pct: 50, color: 'var(--warning-color)', text: 'Fraca' },
        { pct: 75, color: 'var(--info-color)', text: 'Boa' },
        { pct: 100, color: 'var(--success-color)', text: 'Forte' }
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
        alert('Erro na inicialização da aplicação: ' + error.message);
        // Em caso de erro, mostrar tela de setup como fallback
        showSetupForm();
    }
});

// Event Listeners
function setupEventListeners() {
    // Autenticação
    loginBtn.addEventListener('click', handleLogin);
    setupBtn.addEventListener('click', handleSetup);
    helloLoginBtn.addEventListener('click', () => handleHelloLogin(false));
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

// ===== Modal de Configurações =====

function setupSettingsControls() {
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    if (!settingsBtn || !settingsModal) return;

    const autoLockSelect = document.getElementById('setting-auto-lock');
    const clipboardSelect = document.getElementById('setting-clipboard-clear');
    const lockOnSuspendCheck = document.getElementById('setting-lock-on-suspend');
    const autoBackupCheck = document.getElementById('setting-auto-backup');
    const globalShortcutCheck = document.getElementById('setting-global-shortcut');

    settingsBtn.addEventListener('click', async () => {
        const s = getSettings();
        autoLockSelect.value = String(s.autoLockMinutes);
        clipboardSelect.value = String(s.clipboardClearSeconds);
        lockOnSuspendCheck.checked = s.lockOnSuspend !== false;
        autoBackupCheck.checked = s.autoBackup !== false;
        if (globalShortcutCheck) globalShortcutCheck.checked = s.globalShortcut === true;
        settingsModal.style.display = 'flex';

        // Info sobre backups automáticos existentes
        const info = document.getElementById('setting-backup-info');
        if (info && window.electronAPI.listBackups) {
            try {
                const backups = await window.electronAPI.listBackups();
                info.textContent = backups.length > 0
                    ? `${backups.length} backup(s) automático(s) — mais recente: ${new Date(backups[0].modifiedAt).toLocaleString('pt-BR')}`
                    : 'Nenhum backup automático ainda.';
            } catch (_) { /* opcional */ }
        }
    });

    document.getElementById('settings-close-btn').addEventListener('click', closeModals);

    autoLockSelect.addEventListener('change', () => {
        updateSettings({ autoLockMinutes: parseInt(autoLockSelect.value, 10) || 0 });
    });
    clipboardSelect.addEventListener('change', () => {
        updateSettings({ clipboardClearSeconds: parseInt(clipboardSelect.value, 10) || 0 });
    });
    lockOnSuspendCheck.addEventListener('change', () => {
        updateSettings({ lockOnSuspend: lockOnSuspendCheck.checked });
    });
    autoBackupCheck.addEventListener('change', () => {
        updateSettings({ autoBackup: autoBackupCheck.checked });
    });
    if (globalShortcutCheck) {
        globalShortcutCheck.addEventListener('change', () => {
            updateSettings({ globalShortcut: globalShortcutCheck.checked });
            // Aplica na hora: ativar agenda o registro com atraso; desativar remove já
            if (window.electronAPI.setGlobalShortcut) {
                window.electronAPI.setGlobalShortcut(globalShortcutCheck.checked).catch(() => {});
            }
        });
    }

    document.getElementById('export-backup-btn').addEventListener('click', async () => {
        try {
            await window.electronAPI.exportBackup();
        } catch (error) {
            alert('Erro ao exportar backup: ' + error.message);
        }
    });

    document.getElementById('import-backup-btn').addEventListener('click', async () => {
        try {
            await window.electronAPI.importBackup();
        } catch (error) {
            alert('Erro ao restaurar backup: ' + error.message);
        }
    });

    setupUpdateControls();
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
        if (badge) { badge.textContent = 'Em execução'; badge.classList.add('running'); }
        if (text) text.textContent = `Escutando em ${status.info.url}`;
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
        if (badge) { badge.textContent = 'Parado'; badge.classList.remove('running'); }
        if (text) {
            text.textContent = (status && status.error)
                ? `Parado — ${status.error}`
                : 'O servidor não está em execução.';
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
    document.getElementById('mcp-status-text').textContent = 'Iniciando...';
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
}

// ===== Windows Hello (login por digital) =====

// true = leitor aceita digital direto (WinBio), sem abrir a janela do Hello
let helloSilentMode = false;

async function updateHelloButton() {
    try {
        const status = await window.electronAPI.helloStatus();
        helloSilentMode = !!status.silent;
        const show = status.available && status.enrolled;
        helloLoginBtn.style.display = show ? 'flex' : 'none';
        helloDivider.style.display = show ? 'flex' : 'none';
        helloLoginBtn.querySelector('span').textContent = helloSilentMode
            ? 'Entrar com digital'
            : 'Entrar com Windows Hello';
    } catch (error) {
        console.error('Erro ao verificar status do Windows Hello:', error);
        helloLoginBtn.style.display = 'none';
        helloDivider.style.display = 'none';
    }
}

/**
 * Dispara o Windows Hello automaticamente ao abrir o app (uma vez):
 * a janela do Hello já aparece e basta encostar o dedo — zero cliques.
 * Se o usuário cancelar, a tela de senha continua disponível normalmente.
 */
let helloAutoAttempted = false;

async function autoHelloLogin() {
    if (helloAutoAttempted) return;
    helloAutoAttempted = true;

    try {
        const status = await window.electronAPI.helloStatus();
        if (!status.available || !status.enrolled) return;
        await handleHelloLogin(true);
    } catch (error) {
        console.error('Erro no login automático por digital:', error);
    }
}

async function handleHelloLogin(auto = false) {
    hideError(loginError);
    helloLoginBtn.disabled = true;
    const label = helloLoginBtn.querySelector('span');
    const originalLabel = label.textContent;
    label.textContent = helloSilentMode
        ? '👆 Encoste o dedo no leitor...'
        : 'Aguardando Windows Hello...';

    try {
        const helloResult = await window.electronAPI.helloLogin();

        if (!helloResult.success) {
            // Na tentativa automática, cancelar o Hello não é erro:
            // o usuário só quer digitar a senha
            if (!auto) showError(loginError, helloResult.error);
            return;
        }

        const result = await window.electronAPI.loadData(helloResult.password);

        if (result.success) {
            currentMasterPassword = helloResult.password;
            currentData = result.data || [];
            showMainScreen();
        } else {
            // Senha guardada não abre mais o cofre (ex.: cofre recriado).
            // Remove o cadastro para forçar novo enroll com a senha atual.
            await window.electronAPI.helloDisable();
            updateHelloButton();
            showError(loginError, 'A senha salva no Windows Hello não é mais válida. Entre com a senha mestra.');
        }
    } catch (error) {
        showError(loginError, 'Erro no login por digital');
    } finally {
        helloLoginBtn.disabled = false;
        label.textContent = originalLabel;
    }
}

/**
 * Após login/setup com senha: se o Windows Hello estiver disponível e ainda
 * não habilitado, oferece habilitar o login por digital (pergunta uma vez).
 */
async function offerHelloEnrollment(password) {
    try {
        const status = await window.electronAPI.helloStatus();
        if (!status.available || status.enrolled) return;
        if (localStorage.getItem('helloEnrollDeclined') === 'true') return;

        const enrollHint = status.silent
            ? 'Ao aceitar, encoste o dedo no leitor para confirmar.'
            : 'Ao aceitar, confirme sua identidade na janela do Windows Hello.';
        const wants = confirm(`Deseja habilitar o login por digital?\n\nVocê poderá desbloquear o MySecrets usando sua biometria em vez da senha mestra.\n\n${enrollHint}`);
        if (!wants) {
            localStorage.setItem('helloEnrollDeclined', 'true');
            return;
        }

        const result = await window.electronAPI.helloEnroll(password);
        if (result.success) {
            alert('✅ Login por digital habilitado! Na próxima vez, use o botão de digital na tela de login.');
        } else {
            alert('Não foi possível habilitar o login por digital: ' + result.error);
        }
    } catch (error) {
        console.error('Erro ao oferecer cadastro Windows Hello:', error);
    }
}

function showSetupForm() {
    console.log('Mostrando formulário de setup');
    // Garantir que estamos na tela de autenticação
    authScreen.style.display = 'block';
    mainScreen.style.display = 'none';
    
    // Mostrar apenas o formulário de setup
    loginForm.style.display = 'none';
    setupForm.style.display = 'block';
    
    // Esconder modal de reset se estiver aberto
    resetConfirmationModal.style.display = 'none';
    
    newMasterPasswordInput.focus();
}

async function handleLogin() {
    const password = masterPasswordInput.value.trim();
    
    if (!password) {
        showError(loginError, 'Digite a senha mestra');
        return;
    }
    
    try {
        const result = await window.electronAPI.loadData(password);
        
        if (result.success) {
            currentMasterPassword = password;
            currentData = result.data || [];
            showMainScreen();
            offerHelloEnrollment(password);
        } else {
            showError(loginError, result.error);
        }
    } catch (error) {
        showError(loginError, 'Erro ao carregar dados');
    }
}

async function handleSetup() {
    const password = newMasterPasswordInput.value.trim();
    const confirmPassword = confirmMasterPasswordInput.value.trim();
    
    if (!password) {
        showError(setupError, 'Digite uma senha mestra');
        return;
    }
    
    if (password.length < 8) {
        showError(setupError, 'Senha deve ter pelo menos 8 caracteres');
        return;
    }
    
    if (password !== confirmPassword) {
        showError(setupError, 'Senhas não coincidem');
        return;
    }
    
    try {
        currentMasterPassword = password;
        currentData = [];

        const result = await persistData();
        
        if (result.success) {
            showMainScreen();
            offerHelloEnrollment(password);
        } else {
            showError(setupError, `Erro ao criar cofre: ${result.error}`);
        }
    } catch (error) {
        showError(setupError, `Erro ao criar cofre: ${error.message}`);
    }
}

function showMainScreen() {
    console.log('Mostrando tela principal');
    
    // Mostrar tela principal e esconder autenticação
    authScreen.style.display = 'none';
    mainScreen.style.display = 'block';
    
    // Esconder todos os modais
    resetConfirmationModal.style.display = 'none';
    entryModal.style.display = 'none';
    passwordGeneratorModal.style.display = 'none';
    
    // Limpar erros e campos
    hideError(loginError);
    hideError(setupError);
    masterPasswordInput.value = '';
    newMasterPasswordInput.value = '';
    confirmMasterPasswordInput.value = '';
    
    // Limpar pesquisa
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    
    // Resetar filtro ativo
    filterBtns.forEach(btn => btn.classList.remove('active'));
    document.querySelector('[data-type="all"]').classList.add('active');

    // Limpar seleção
    selectedEntry = null;
    selectedTag = null;

    // Purga entradas da lixeira com mais de 30 dias
    purgeExpiredTrash();

    // Atualizar dados e interface
    filteredData = [...activeData()];
    updateEntryCounts();
    renderTagsSidebar();
    renderEntries();

    // Iniciar bloqueio automático e renovação de sessão
    resetAutoLockTimer();
    startSessionRefresh();

    // Servidor local para o autofill da extensão, se o usuário optou por isso
    if (getSettings().mcpAutoStart === true) {
        window.electronAPI.mcpStart({ port: getSettings().mcpPort || 8765 })
            .then((r) => { if (r && r.success) refreshMcpStatus(); })
            .catch(() => {});
    }

    // Mostrar mensagem de boas-vindas se não houver entradas
    if (activeData().length === 0) {
        welcomeMessage.style.display = 'block';
        entryDetails.style.display = 'none';
        const gridView = document.getElementById('grid-view');
        if (gridView) gridView.style.display = 'none';
    }
}

/**
 * Remove permanentemente entradas que estão na lixeira há mais de 30 dias.
 */
async function purgeExpiredTrash() {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const before = currentData.length;
    currentData = currentData.filter(e => {
        if (!e.deletedAt) return true;
        return new Date(e.deletedAt).getTime() > cutoff;
    });
    if (currentData.length !== before) {
        console.log(`Lixeira: ${before - currentData.length} entrada(s) purgada(s) após 30 dias`);
        try {
            await persistData();
        } catch (error) {
            console.error('Erro ao purgar lixeira:', error);
        }
    }
}

function lockApp() {
    console.log('Bloqueando aplicação');

    // Fechar todos os modais primeiro
    closeModals();

    // Esconder visualização MFA e limpar timers
    hideMFAOverview();

    // Parar timers de bloqueio/sessão
    if (autoLockTimer) {
        clearTimeout(autoLockTimer);
        autoLockTimer = null;
    }
    stopSessionRefresh();

    // Destruir a sessão em disco (extensão Chrome / MCP param de funcionar)
    if (window.electronAPI.lock) {
        window.electronAPI.lock();
    }

    // Mostrar tela de autenticação
    mainScreen.style.display = 'none';
    authScreen.style.display = 'block';

    // Limpar dados sensíveis
    currentMasterPassword = '';
    currentData = [];
    filteredData = [];
    selectedEntry = null;
    selectedTag = null;
    searchInput.value = '';

    // Mostrar formulário de login (dados já existem)
    showLoginForm();
}

// Funções de busca e filtro
function currentFilterType() {
    const activeBtn = document.querySelector('.filter-btn.active');
    return activeBtn ? activeBtn.dataset.type : 'all';
}

function handleSearch() {
    const query = searchInput.value.toLowerCase().trim();

    // Mostrar/esconder botão de limpar pesquisa
    if (query) {
        clearSearchBtn.style.display = 'block';
    } else {
        clearSearchBtn.style.display = 'none';
    }

    // Aplicar filtro ativo
    const activeFilter = currentFilterType();
    let baseData;

    if (activeFilter === 'trash') {
        baseData = trashedData();
    } else if (activeFilter === 'favorite') {
        baseData = activeData().filter(entry => entry.favorite);
    } else if (activeFilter === 'all' || activeFilter === 'health') {
        baseData = activeData();
    } else {
        baseData = activeData().filter(entry => entry.type === activeFilter);
    }

    // Filtro por tag selecionada na sidebar
    if (selectedTag) {
        baseData = baseData.filter(entry =>
            Array.isArray(entry.tags) && entry.tags.includes(selectedTag)
        );
    }

    if (!query) {
        filteredData = [...baseData];
    } else {
        filteredData = baseData.filter(entry =>
            entry.title.toLowerCase().includes(query) ||
            entry.username?.toLowerCase().includes(query) ||
            entry.url?.toLowerCase().includes(query) ||
            entry.notes?.toLowerCase().includes(query) ||
            (Array.isArray(entry.tags) && entry.tags.some(t => String(t).toLowerCase().includes(query)))
        );
    }

    handleSort(); // Aplicar ordenação
}

function handleFilter(type) {
    // Atualizar botões ativos
    filterBtns.forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[data-type="${type}"]`).classList.add('active');

    // Limpar seleção atual ao mudar filtro
    selectedEntry = null;

    // Limpar todos os timers de detalhes
    if (window.detailTimers) {
        Object.values(window.detailTimers).forEach(timer => clearInterval(timer));
        window.detailTimers = {};
    }

    // Esconder vistas especiais por padrão
    entryDetails.style.display = 'none';
    const gridView = document.getElementById('grid-view');

    if (type === 'mfa') {
        if (gridView) gridView.style.display = 'none';
        hideHealthOverview();
        showMFAOverview();
    } else if (type === 'health') {
        if (gridView) gridView.style.display = 'none';
        welcomeMessage.style.display = 'none';
        hideMFAOverview();
        showHealthOverview();
    } else {
        hideMFAOverview();
        hideHealthOverview();
        // Reprocessar pesquisa com novo filtro
        handleSearch();
    }

    // Atualizar contadores
    updateEntryCounts();
}

// Função para atualizar contadores
function updateEntryCounts() {
    const active = activeData();
    const counts = {
        all: active.length,
        favorite: active.filter(e => e.favorite).length,
        login: active.filter(e => e.type === 'login').length,
        mfa: active.filter(e => e.type === 'mfa').length,
        token: active.filter(e => e.type === 'token').length,
        note: active.filter(e => e.type === 'note').length,
        trash: trashedData().length,
        health: computeHealthIssues().total
    };

    // Atualizar contadores dos filtros
    Object.keys(counts).forEach(type => {
        const countElement = document.getElementById(`count-${type}`);
        if (countElement) {
            countElement.textContent = counts[type];
        }
    });

    // Atualizar contador geral
    if (entriesCount) {
        const total = counts.all;
        entriesCount.textContent = `${total} ${total === 1 ? 'entrada' : 'entradas'}`;
    }
}

// ===== Tags na sidebar =====

function renderTagsSidebar() {
    const container = document.getElementById('sidebar-tags');
    const list = document.getElementById('tags-list');
    if (!container || !list) return;

    // Coletar tags das entradas ativas com contagem
    const tagCounts = new Map();
    activeData().forEach(entry => {
        (entry.tags || []).forEach(tag => {
            const t = String(tag).trim();
            if (t) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
        });
    });

    if (tagCounts.size === 0) {
        container.style.display = 'none';
        selectedTag = null;
        return;
    }

    // Se a tag selecionada sumiu, limpar
    if (selectedTag && !tagCounts.has(selectedTag)) {
        selectedTag = null;
    }

    container.style.display = 'block';
    list.innerHTML = '';

    [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 20)
        .forEach(([tag, count]) => {
            const chip = document.createElement('button');
            chip.className = 'tag-chip' + (selectedTag === tag ? ' active' : '');
            chip.innerHTML = `<span class="tag-name">${escapeHtml(tag)}</span><span class="tag-count">${count}</span>`;
            chip.addEventListener('click', () => {
                selectedTag = (selectedTag === tag) ? null : tag;
                renderTagsSidebar();
                handleSearch();
            });
            list.appendChild(chip);
        });
}

// ===== Saúde das Senhas =====

const HEALTH_OLD_DAYS = 365;

/**
 * Analisa as senhas do cofre: reutilizadas, fracas e antigas.
 */
function computeHealthIssues() {
    const withPassword = activeData().filter(e => e.password);

    // Reutilizadas: mesma senha em 2+ entradas
    const byPassword = new Map();
    withPassword.forEach(e => {
        if (!byPassword.has(e.password)) byPassword.set(e.password, []);
        byPassword.get(e.password).push(e);
    });
    const reusedGroups = [...byPassword.values()].filter(group => group.length > 1);
    const reused = reusedGroups.flat();

    // Fracas: pontuação <= 2
    const weak = withPassword.filter(e => computePasswordStrength(e.password) <= 2);

    // Antigas: sem alteração há mais de 1 ano
    const cutoff = Date.now() - HEALTH_OLD_DAYS * 24 * 60 * 60 * 1000;
    const old = withPassword.filter(e => {
        const ref = new Date(e.updatedAt || e.createdAt || 0).getTime();
        return ref > 0 && ref < cutoff;
    });

    const uniqueIssueIds = new Set([...reused, ...weak, ...old].map(e => e.id));

    return { reused, reusedGroups, weak, old, total: uniqueIssueIds.size };
}

function showHealthOverview() {
    welcomeMessage.style.display = 'none';
    entryDetails.style.display = 'none';
    const healthOverview = document.getElementById('health-overview');
    if (!healthOverview) return;
    healthOverview.style.display = 'block';
    renderHealthOverview();
}

function hideHealthOverview() {
    const healthOverview = document.getElementById('health-overview');
    if (healthOverview) healthOverview.style.display = 'none';
}

function renderHealthOverview() {
    const healthOverview = document.getElementById('health-overview');
    if (!healthOverview) return;

    const issues = computeHealthIssues();
    const totalWithPassword = activeData().filter(e => e.password).length;

    const sectionHTML = (title, icon, cssClass, entries, description) => {
        let html = `
            <div class="health-section ${cssClass}">
                <div class="health-section-header">
                    <span class="material-symbols-outlined">${icon}</span>
                    <h3>${title}</h3>
                    <span class="health-count">${entries.length}</span>
                </div>
                <p class="health-description">${description}</p>
        `;
        if (entries.length === 0) {
            html += `<div class="health-ok"><span class="material-symbols-outlined">check_circle</span> Tudo certo por aqui!</div>`;
        } else {
            html += '<div class="health-items">';
            entries.forEach(e => {
                html += `
                    <button class="health-item" data-entry-id="${escapeHtml(e.id)}">
                        <span class="material-symbols-outlined">key</span>
                        <span class="health-item-title">${escapeHtml(e.title)}</span>
                        <span class="health-item-subtitle">${escapeHtml(e.username || e.url || '')}</span>
                        <span class="material-symbols-outlined health-item-arrow">chevron_right</span>
                    </button>
                `;
            });
            html += '</div>';
        }
        html += '</div>';
        return html;
    };

    healthOverview.innerHTML = `
        <div class="health-header">
            <h2>Saúde das Senhas</h2>
            <p>${totalWithPassword} senha(s) analisada(s) — ${issues.total} com algum problema</p>
        </div>
        ${sectionHTML('Senhas reutilizadas', 'content_copy', 'health-danger', issues.reused,
            'A mesma senha usada em mais de uma conta: se uma vazar, todas ficam expostas.')}
        ${sectionHTML('Senhas fracas', 'warning', 'health-warning', issues.weak,
            'Senhas curtas ou com pouca variedade de caracteres. Use o gerador para trocá-las.')}
        ${sectionHTML('Senhas antigas', 'history', 'health-info', issues.old,
            `Sem alteração há mais de ${HEALTH_OLD_DAYS} dias. Considere renová-las.`)}
    `;

    // Clique no item abre a entrada
    healthOverview.querySelectorAll('.health-item').forEach(item => {
        item.addEventListener('click', () => {
            const entry = activeData().find(e => e.id === item.dataset.entryId);
            if (entry) {
                hideHealthOverview();
                selectEntry(entry);
            }
        });
    });
}

// Funções de renderização
function renderEntries() {
    entriesList.innerHTML = '';
    
    if (filteredData.length === 0) {
        const query = searchInput.value.trim();
        const message = query ? 
            'Nenhuma entrada encontrada para sua pesquisa' : 
            'Nenhuma entrada nesta categoria';
        entriesList.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); padding: 2rem;">
                <span class="material-symbols-outlined" style="font-size: 3rem; margin-bottom: 1rem; display: block; opacity: 0.5;">search_off</span>
                <p>${message}</p>
            </div>
        `;
        return;
    }
    
    filteredData.forEach(entry => {
        const entryElement = createEntryElement(entry);
        entriesList.appendChild(entryElement);
    });
    
    // Atualizar seleção visual se houver entrada selecionada
    if (selectedEntry && filteredData.find(e => e.id === selectedEntry.id)) {
        const selectedElement = document.querySelector(`[data-id="${selectedEntry.id}"]`);
        if (selectedElement) {
            selectedElement.classList.add('active');
        }
    } else {
        // Se nenhuma entrada selecionada, mostrar vista de grade
        selectedEntry = null;
        renderGridView();
    }
}

// Nova função: Renderizar vista de grade quando nenhuma entrada está selecionada
function renderGridView() {
    // Nas vistas especiais (MFA / Saúde) a grade não é usada
    const filter = currentFilterType();
    if (filter === 'mfa' || filter === 'health') {
        const existingGrid = document.getElementById('grid-view');
        if (existingGrid) existingGrid.style.display = 'none';
        return;
    }

    welcomeMessage.style.display = 'none';
    entryDetails.style.display = 'none';
    
    // Criar ou mostrar container de grade
    let gridView = document.getElementById('grid-view');
    if (!gridView) {
        gridView = document.createElement('div');
        gridView.id = 'grid-view';
        gridView.className = 'grid-view';
        document.querySelector('.content').appendChild(gridView);
    }
    
    gridView.style.display = 'grid';
    gridView.innerHTML = '';
    
    // Renderizar cards em grade
    filteredData.forEach(entry => {
        const card = createGridCard(entry);
        gridView.appendChild(card);
    });
}

const TYPE_ICONS = {
    login: 'account_circle',
    mfa: 'security',
    token: 'key',
    note: 'note'
};

const TYPE_LABELS = {
    login: 'Login',
    mfa: 'MFA',
    token: 'Token',
    note: 'Nota'
};

function entrySubtitle(entry) {
    return entry.username || entry.url ||
           (entry.type === 'token' ? (entry.tokenType ? `Token ${entry.tokenType.toUpperCase()}` : 'Token') : '') ||
           (entry.type === 'note' ? 'Nota segura' : '');
}

function entryTagsHTML(entry, max = 3) {
    const tags = (entry.tags || []).filter(Boolean).slice(0, max);
    if (tags.length === 0) return '';
    return `<div class="card-tags">${tags.map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join('')}</div>`;
}

// Nova função: Criar card para vista de grade
function createGridCard(entry) {
    const card = document.createElement('div');
    card.className = 'grid-card' + (entry.deletedAt ? ' trashed' : '');
    card.dataset.id = entry.id;

    const subtitle = entrySubtitle(entry);
    const inTrash = !!entry.deletedAt;

    // MFA vinculado a um login (para oferecer cópia rápida do código)
    const linkedMfaEntry = (!inTrash && entry.type === 'login' && entry.linkedMfaId)
        ? activeData().find(e => e.id === entry.linkedMfaId && e.type === 'mfa' && e.mfaSecret)
        : null;

    // Botões de cópia rápida, sem precisar abrir os detalhes
    let quickCopyHTML = '';
    if (!inTrash) {
        if (entry.type === 'login' && entry.password) {
            quickCopyHTML += `
            <button class="grid-card-btn-secondary" data-action="copy-password" title="Copiar senha">
                <span class="material-symbols-outlined">key</span>
            </button>`;
        }
        if (linkedMfaEntry || (entry.type === 'mfa' && entry.mfaSecret)) {
            quickCopyHTML += `
            <button class="grid-card-btn-secondary" data-action="copy-mfa" title="Copiar código MFA">
                <span class="material-symbols-outlined">pin</span>
            </button>`;
        }
        if (entry.type === 'token' && entry.token) {
            quickCopyHTML += `
            <button class="grid-card-btn-secondary" data-action="copy-token" title="Copiar token">
                <span class="material-symbols-outlined">content_copy</span>
            </button>`;
        }
    }

    const footerHTML = inTrash ? `
        <div class="grid-card-footer">
            <button class="grid-card-btn" data-action="restore">
                <span class="material-symbols-outlined">restore_from_trash</span>
                Restaurar
            </button>
            <button class="grid-card-btn-secondary btn-danger-hover" data-action="delete-forever" title="Excluir definitivamente">
                <span class="material-symbols-outlined">delete_forever</span>
            </button>
        </div>
    ` : `
        <div class="grid-card-footer">
            <button class="grid-card-btn" data-action="view">
                <span class="material-symbols-outlined">visibility</span>
                Ver Detalhes
            </button>
            ${quickCopyHTML}
            <button class="grid-card-btn-secondary" data-action="edit" title="Editar">
                <span class="material-symbols-outlined">edit</span>
            </button>
        </div>
    `;

    card.innerHTML = `
        <div class="grid-card-header">
            <div class="grid-card-icon badge-${entry.type}">
                <span class="material-symbols-outlined">${TYPE_ICONS[entry.type]}</span>
            </div>
            ${entry.favorite && !inTrash ? '<span class="material-symbols-outlined favorite-star" title="Favorito">star</span>' : ''}
            <div class="grid-card-type">${inTrash ? 'Na lixeira' : TYPE_LABELS[entry.type]}</div>
        </div>
        <div class="grid-card-content">
            <h3>${escapeHtml(entry.title)}</h3>
            ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
            ${entryTagsHTML(entry)}
        </div>
        ${footerHTML}
    `;

    // Ações dos botões (sem handlers inline — bloqueados pela CSP)
    const bind = (action, fn) => {
        const btn = card.querySelector(`[data-action="${action}"]`);
        if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    };
    bind('view', () => selectEntry(entry));
    bind('edit', () => editEntry(entry.id));
    bind('restore', () => restoreEntry(entry.id));
    bind('delete-forever', () => deleteEntry(entry.id));

    // Feedback visual: troca o ícone por um check por 1s após copiar
    const flashCopied = (action) => {
        const btn = card.querySelector(`[data-action="${action}"]`);
        const icon = btn && btn.querySelector('.material-symbols-outlined');
        if (!icon) return;
        const original = icon.textContent;
        icon.textContent = 'check';
        btn.classList.add('copied');
        setTimeout(() => {
            icon.textContent = original;
            btn.classList.remove('copied');
        }, 1000);
    };
    bind('copy-password', () => {
        copyToClipboard(entry.password, 'Senha copiada');
        flashCopied('copy-password');
    });
    bind('copy-token', () => {
        copyToClipboard(entry.token, 'Token copiado');
        flashCopied('copy-token');
    });
    bind('copy-mfa', async () => {
        const mfaEntry = entry.type === 'mfa' ? entry : linkedMfaEntry;
        if (!mfaEntry) return;
        try {
            const result = await MFA.generate(mfaEntry);
            copyToClipboard(result.code, 'Código MFA copiado');
            flashCopied('copy-mfa');
        } catch (error) {
            console.error('Erro ao gerar código MFA:', error);
        }
    });

    card.addEventListener('click', () => selectEntry(entry));

    return card;
}

function createEntryElement(entry) {
    const div = document.createElement('div');
    div.className = 'entry-item' + (entry.deletedAt ? ' trashed' : '');
    div.dataset.id = entry.id;

    const subtitle = entrySubtitle(entry);

    div.innerHTML = `
        <div class="entry-item-icon badge-${entry.type}">
            <span class="material-symbols-outlined">${TYPE_ICONS[entry.type]}</span>
        </div>
        <div class="entry-item-content">
            <h3>${escapeHtml(entry.title)}</h3>
            ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
        </div>
        ${entry.favorite && !entry.deletedAt ? '<span class="material-symbols-outlined favorite-star" title="Favorito">star</span>' : ''}
    `;

    div.addEventListener('click', () => selectEntry(entry));

    return div;
}

async function selectEntry(entry) {
    selectedEntry = entry;

    // Esconder vistas especiais e grade
    hideMFAOverview();
    hideHealthOverview();
    const gridView = document.getElementById('grid-view');
    if (gridView) {
        gridView.style.display = 'none';
    }
    
    // Atualizar seleção visual
    document.querySelectorAll('.entry-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const selectedElement = document.querySelector(`[data-id="${entry.id}"]`);
    if (selectedElement) {
        selectedElement.classList.add('active');
    }
    
    // Mostrar detalhes
    await renderEntryDetails(entry);
}

async function renderEntryDetails(entry) {
    welcomeMessage.style.display = 'none';
    hideHealthOverview();
    entryDetails.style.display = 'block';

    const inTrash = !!entry.deletedAt;

    // Valores a copiar ficam neste array — os botões referenciam o índice via
    // data-copy-idx, nunca o valor dentro do HTML (evita injeção e vaza menos)
    const copyValues = [];
    const copyBtnHTML = (value, label = 'Copiar') => {
        copyValues.push(value);
        return `<button class="copy-btn" data-copy-idx="${copyValues.length - 1}">${label}</button>`;
    };

    let detailsHTML = `
        <div class="detail-header">
            <button class="btn-back" data-action="back">
                <span class="material-symbols-outlined">arrow_back</span>
                Voltar
            </button>
        </div>
        <h2>
            <span class="detail-type-icon badge-${entry.type}"><span class="material-symbols-outlined">${TYPE_ICONS[entry.type]}</span></span>
            <span class="detail-title-text">${escapeHtml(entry.title)}</span>
            ${inTrash ? '' : `
                <button class="favorite-btn ${entry.favorite ? 'active' : ''}" data-action="toggle-favorite" title="${entry.favorite ? 'Remover dos favoritos' : 'Marcar como favorito'}">
                    <span class="material-symbols-outlined">star</span>
                </button>
            `}
        </h2>
        ${(entry.tags || []).length ? `<div class="detail-tags">${entry.tags.map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        ${inTrash ? `
            <div class="trash-banner">
                <span class="material-symbols-outlined">delete</span>
                Esta entrada está na lixeira desde ${new Date(entry.deletedAt).toLocaleDateString('pt-BR')} e será removida definitivamente após 30 dias.
            </div>
        ` : ''}
        <div class="detail-section">
    `;

    if (entry.type === 'login') {
        if (entry.url) {
            detailsHTML += `
                <div class="detail-row">
                    <span class="detail-label">URL:</span>
                    <div class="detail-value">
                        <span>${escapeHtml(entry.url)}</span>
                        ${copyBtnHTML(entry.url)}
                    </div>
                </div>
            `;
        }

        if (entry.username) {
            detailsHTML += `
                <div class="detail-row">
                    <span class="detail-label">Usuário:</span>
                    <div class="detail-value">
                        <span>${escapeHtml(entry.username)}</span>
                        ${copyBtnHTML(entry.username)}
                    </div>
                </div>
            `;
        }

        if (entry.password) {
            detailsHTML += `
                <div class="detail-row">
                    <span class="detail-label">Senha:</span>
                    <div class="detail-value">
                        <span>••••••••</span>
                        ${copyBtnHTML(entry.password)}
                    </div>
                </div>
            `;
        }

        // Mostrar MFA vinculado se existir
        if (entry.linkedMfaId) {
            const mfaEntry = activeData().find(e => e.id === entry.linkedMfaId && e.type === 'mfa');
            if (mfaEntry && mfaEntry.mfaSecret) {
                const mfaResult = await MFA.generate(mfaEntry);
                detailsHTML += `
                    <div class="detail-row detail-mfa-linked">
                        <span class="detail-label">2FA Vinculado:</span>
                        <div class="detail-value">
                            <span class="mfa-linked-title">${escapeHtml(mfaEntry.title)}</span>
                            <span class="totp-code" id="linked-mfa-code-${entry.id}">${mfaResult.code}</span>
                            ${mfaEntry.mfaAlgorithm === 'totp' ?
                                `<div class="totp-timer" id="linked-mfa-timer-${entry.id}">${mfaResult.remaining}s</div>` :
                                ''
                            }
                            <button class="copy-btn" data-copy-live="linked-mfa-code-${entry.id}">Copiar Código</button>
                        </div>
                    </div>
                `;

                // Iniciar timer do MFA vinculado
                if (mfaEntry.mfaAlgorithm === 'totp') {
                    setTimeout(() => startMFATimer(entry.id, mfaEntry, 'linked-mfa-'), 100);
                }
            }
        }
    } else if (entry.type === 'mfa') {
        if (entry.mfaSecret) {
            const mfaResult = await MFA.generate(entry);
            const algorithmLabel = entry.mfaAlgorithm === 'hotp' ? 'HOTP' : 'TOTP';

            detailsHTML += `
                <div class="detail-row">
                    <span class="detail-label">Algoritmo:</span>
                    <div class="detail-value">
                        <span>${algorithmLabel} (${entry.mfaDigits || 6} dígitos, ${(entry.mfaHash || 'sha1').toUpperCase()})</span>
                    </div>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Código ${algorithmLabel}:</span>
                    <div class="detail-value">
                        <span class="totp-code" id="mfa-code-${entry.id}">${mfaResult.code}</span>
                        ${entry.mfaAlgorithm === 'totp' ?
                            `<div class="totp-timer" id="mfa-timer-${entry.id}">${mfaResult.remaining}s</div>` :
                            `<div class="hotp-counter" id="mfa-counter-${entry.id}">Contador: ${mfaResult.counter}</div>`
                        }
                        <button class="copy-btn" data-copy-live="mfa-code-${entry.id}">Copiar</button>
                        ${entry.mfaAlgorithm === 'hotp' ?
                            `<button class="btn btn-secondary" data-action="hotp-next">Próximo</button>` :
                            ''
                        }
                    </div>
                </div>
            `;

            if (entry.mfaAlgorithm === 'totp') {
                detailsHTML += `
                    <div class="detail-row">
                        <span class="detail-label">Período:</span>
                        <div class="detail-value">
                            <span>${entry.mfaPeriod || 30} segundos</span>
                        </div>
                    </div>
                `;
            }
        }
    } else if (entry.type === 'token') {
        if (entry.token) {
            copyValues.push(entry.token);
            const tokenIdx = copyValues.length - 1;
            detailsHTML += `
                <div class="detail-row">
                    <span class="detail-label">Tipo de Token:</span>
                    <div class="detail-value">
                        <span class="token-badge ${entry.tokenType || 'other'}">${entry.tokenType ? entry.tokenType.toUpperCase() : 'OUTRO'}</span>
                    </div>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Token:</span>
                    <div class="detail-value token-display">
                        <div class="token-value" data-copy-idx="${tokenIdx}">${escapeHtml(entry.token)}</div>
                        <button class="copy-btn" style="margin-top: 0.5rem;" data-copy-idx="${tokenIdx}">Copiar Token</button>
                    </div>
                </div>
            `;

            if (entry.tokenExpires) {
                const expiresDate = new Date(entry.tokenExpires);
                const now = new Date();
                const isExpired = expiresDate < now;
                const daysUntilExpiry = Math.ceil((expiresDate - now) / (1000 * 60 * 60 * 24));

                detailsHTML += `
                    <div class="detail-row">
                        <span class="detail-label">Expiração:</span>
                        <div class="detail-value">
                            <span class="${isExpired ? 'token-expired' : 'token-valid'}">
                                ${expiresDate.toLocaleDateString('pt-BR')}
                                ${isExpired ? ' (Expirado)' : daysUntilExpiry > 0 ? ` (${daysUntilExpiry} dias restantes)` : ' (Expira hoje)'}
                            </span>
                        </div>
                    </div>
                `;
            }
        }
    }

    if (entry.notes) {
        detailsHTML += `
            <div class="detail-row">
                <span class="detail-label">Notas:</span>
                <div class="detail-value">
                    <span>${escapeHtml(entry.notes).replace(/\n/g, '<br>')}</span>
                </div>
            </div>
        `;
    }

    detailsHTML += `
        </div>
    `;

    // Renderizar Custom Fields se existirem
    if (entry.customFields && Array.isArray(entry.customFields) && entry.customFields.length > 0) {
        detailsHTML += `
            <div class="detail-custom-fields">
                <h3>Campos Personalizados</h3>
        `;

        entry.customFields.forEach(field => {
            const isPassword = field.type === 'password';
            const valueClass = isPassword ? 'password-type' : '';
            copyValues.push(field.value);
            const idx = copyValues.length - 1;

            detailsHTML += `
                <div class="custom-field-detail">
                    <span class="custom-field-detail-label">${escapeHtml(field.name)}:</span>
                    <div class="custom-field-detail-value ${valueClass}" data-copy-idx="${idx}">
                        <span>${escapeHtml(field.value)}</span>
                        <button class="custom-field-copy-btn" data-copy-idx="${idx}">
                            <span class="material-symbols-outlined">content_copy</span>
                            Copiar
                        </button>
                    </div>
                </div>
            `;
        });

        detailsHTML += `
            </div>
        `;
    }

    // Histórico de senhas anteriores
    if (Array.isArray(entry.passwordHistory) && entry.passwordHistory.length > 0) {
        detailsHTML += `
            <div class="detail-custom-fields password-history">
                <h3>Histórico de Senhas</h3>
        `;
        [...entry.passwordHistory].reverse().forEach(hist => {
            copyValues.push(hist.password);
            const idx = copyValues.length - 1;
            const when = hist.changedAt ? new Date(hist.changedAt).toLocaleString('pt-BR') : '';
            detailsHTML += `
                <div class="custom-field-detail">
                    <span class="custom-field-detail-label">Trocada em ${escapeHtml(when)}:</span>
                    <div class="custom-field-detail-value password-type" data-copy-idx="${idx}">
                        <span>${escapeHtml(hist.password)}</span>
                        <button class="custom-field-copy-btn" data-copy-idx="${idx}">
                            <span class="material-symbols-outlined">content_copy</span>
                            Copiar
                        </button>
                    </div>
                </div>
            `;
        });
        detailsHTML += `</div>`;
    }

    detailsHTML += inTrash ? `
        <div class="entry-actions">
            <button class="btn btn-primary" data-action="restore">
                <span class="material-symbols-outlined">restore_from_trash</span>
                Restaurar
            </button>
            <button class="btn btn-danger" data-action="delete">
                <span class="material-symbols-outlined">delete_forever</span>
                Excluir definitivamente
            </button>
        </div>
    ` : `
        <div class="entry-actions">
            <button class="btn btn-primary" data-action="edit">Editar</button>
            <button class="btn btn-danger" data-action="delete">Excluir</button>
        </div>
    `;

    entryDetails.innerHTML = detailsHTML;

    // ===== Bind das ações (handlers inline são bloqueados pela CSP) =====

    entryDetails.querySelectorAll('[data-copy-idx]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            copyToClipboard(copyValues[parseInt(el.dataset.copyIdx, 10)]);
        });
    });

    entryDetails.querySelectorAll('[data-copy-live]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const codeEl = document.getElementById(el.dataset.copyLive);
            if (codeEl) copyToClipboard(codeEl.textContent.trim());
        });
    });

    const bindAction = (action, fn) => {
        entryDetails.querySelectorAll(`[data-action="${action}"]`).forEach(el => {
            el.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
        });
    };
    bindAction('back', () => backToGridView());
    bindAction('edit', () => editEntry(entry.id));
    bindAction('delete', () => deleteEntry(entry.id));
    bindAction('restore', () => restoreEntry(entry.id));
    bindAction('hotp-next', () => updateHOTPCounter(entry.id));
    bindAction('toggle-favorite', () => toggleFavorite(entry.id));

    // Iniciar timer do MFA se necessário
    if (entry.type === 'mfa' && entry.mfaSecret) {
        if (entry.mfaAlgorithm === 'totp') {
            startMFATimer(entry.id, entry);
        }
    }
}

/**
 * Marca/desmarca uma entrada como favorita.
 */
async function toggleFavorite(entryId) {
    const entry = currentData.find(e => e.id === entryId);
    if (!entry) return;

    entry.favorite = !entry.favorite;
    entry.updatedAt = new Date().toISOString();

    try {
        const result = await persistData();
        if (result.success) {
            updateEntryCounts();
            handleSearch();
            if (selectedEntry?.id === entryId) {
                await renderEntryDetails(entry);
            }
        } else {
            entry.favorite = !entry.favorite; // desfaz
            alert('Erro ao salvar favorito');
        }
    } catch (error) {
        entry.favorite = !entry.favorite;
        alert('Erro ao salvar favorito');
    }
}

// Função para voltar à vista anterior (grade, MFA ou Saúde)
function backToGridView() {
    selectedEntry = null;

    // Limpar todos os timers de detalhes antes de sair
    if (window.detailTimers) {
        Object.values(window.detailTimers).forEach(timer => clearInterval(timer));
        window.detailTimers = {};
    }

    entryDetails.style.display = 'none';

    const filter = currentFilterType();
    if (filter === 'mfa') {
        showMFAOverview();
    } else if (filter === 'health') {
        showHealthOverview();
    } else {
        renderGridView();
    }

    // Remover seleção visual da sidebar
    document.querySelectorAll('.entry-item').forEach(item => {
        item.classList.remove('active');
    });
}

// Timer do MFA - Inicializar storage global de timers
if (!window.detailTimers) {
    window.detailTimers = {};
}

// Timer do MFA
function startMFATimer(entryId, mfaEntry, prefix = 'mfa-') {
    const timerKey = `${prefix}${entryId}`;
    
    // Limpar timer anterior se existir
    if (window.detailTimers[timerKey]) {
        clearInterval(window.detailTimers[timerKey]);
        delete window.detailTimers[timerKey];
    }
    
    const updateMFA = async () => {
        const mfaCodeElement = document.getElementById(`${prefix}code-${entryId}`);
        const mfaTimerElement = document.getElementById(`${prefix}timer-${entryId}`);
        
        if (mfaCodeElement && mfaTimerElement && mfaEntry.mfaAlgorithm === 'totp') {
            const mfaResult = await MFA.generate(mfaEntry);
            mfaCodeElement.textContent = mfaResult.code;
            mfaTimerElement.textContent = `${mfaResult.remaining}s`;
            
            // Atualizar cor do timer baseado no tempo restante
            const period = mfaEntry.mfaPeriod || 30;
            const percentage = (mfaResult.remaining / period) * 360;
            mfaTimerElement.style.background = `conic-gradient(var(--success-color) ${percentage}deg, var(--border) ${percentage}deg)`;
        } else if (!mfaCodeElement || !mfaTimerElement) {
            // Elementos não existem mais, limpar timer
            if (window.detailTimers[timerKey]) {
                clearInterval(window.detailTimers[timerKey]);
                delete window.detailTimers[timerKey];
            }
        }
    };
    
    // Atualizar imediatamente e depois a cada segundo
    updateMFA();
    window.detailTimers[timerKey] = setInterval(updateMFA, 1000);
}

// Funções do modal
function openEntryModal(entry = null) {
    editingEntry = entry;
    
    if (entry) {
        modalTitle.textContent = 'Editar Entrada';
        populateForm(entry);
        loadCustomFields(entry); // Carregar custom fields
    } else {
        modalTitle.textContent = 'Adicionar Entrada';
        entryForm.reset();
        currentCustomFields = []; // Limpar custom fields
        renderCustomFields();
        handleEntryTypeChange();
    }
    
    entryModal.style.display = 'flex';
    entryTitle.focus();
}

function populateForm(entry) {
    entryType.value = entry.type;
    entryTitle.value = entry.title;
    document.getElementById('entry-tags').value = (entry.tags || []).join(', ');
    document.getElementById('entry-favorite').checked = !!entry.favorite;
    entryUrl.value = entry.url || '';
    entryUsername.value = entry.username || '';
    entryPassword.value = entry.password || '';
    entryMfaSecret.value = entry.mfaSecret || '';
    entryMfaAlgorithm.value = entry.mfaAlgorithm || 'totp';
    entryMfaPeriod.value = entry.mfaPeriod || 30;
    entryMfaDigits.value = entry.mfaDigits || 6;
    entryMfaCounter.value = entry.mfaCounter || 0;
    entryMfaDigitsHotp.value = entry.mfaDigits || 6;
    entryMfaHash.value = entry.mfaHash || 'sha1';
    entryMfaHashHotp.value = entry.mfaHash || 'sha1';
    entryToken.value = entry.token || '';
    entryTokenType.value = entry.tokenType || 'api';
    entryTokenExpires.value = entry.tokenExpires || '';
    entryNotes.value = entry.notes || '';
    
    handleEntryTypeChange();
    
    // Carregar MFA vinculado (após popular select)
    if (entry.type === 'login' && entry.linkedMfaId) {
        entryLinkedMfa.value = entry.linkedMfaId;
    }
    
    loadCustomFields(entry); // Carregar custom fields
}

/**
 * Le uma imagem de QR code escolhida pelo usuario, decodifica o otpauth://
 * e preenche os campos do formulario MFA automaticamente.
 */
function handleMfaQrImageSelect(event) {
    const file = event.target.files && event.target.files[0];
    // permite reescolher o mesmo arquivo depois
    event.target.value = '';
    if (file) processQrImageFile(file);
}

/**
 * Processa um arquivo de imagem com QR code (vindo do input ou de drag & drop).
 */
function processQrImageFile(file) {
    const status = document.getElementById('mfa-qr-import-status');
    const setStatus = (msg, cor) => {
        if (!status) return;
        status.textContent = msg;
        status.style.color = cor || '';
    };

    if (!file) return;

    if (typeof jsQR !== 'function') {
        setStatus('Leitor de QR indisponivel.', 'var(--danger, #e11d48)');
        return;
    }

    setStatus('Lendo imagem...', '');

    const img = new Image();
    img.onload = () => {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            const result = jsQR(imageData.data, imageData.width, imageData.height);
            URL.revokeObjectURL(img.src);

            if (!result || !result.data) {
                setStatus('Nenhum QR code reconhecido na imagem.', 'var(--danger, #e11d48)');
                return;
            }

            const ok = applyOtpauthToForm(result.data);
            if (ok) {
                setStatus('QR code importado com sucesso!', 'var(--success, #16a34a)');
            } else {
                setStatus('QR code nao e um codigo TOTP/HOTP valido.', 'var(--danger, #e11d48)');
            }
        } catch (e) {
            console.error('Erro ao decodificar QR:', e);
            setStatus('Erro ao processar a imagem.', 'var(--danger, #e11d48)');
        }
    };
    img.onerror = () => {
        setStatus('Nao foi possivel abrir a imagem.', 'var(--danger, #e11d48)');
    };
    img.src = URL.createObjectURL(file);
}

/**
 * Faz o parse de uma URI otpauth:// e preenche os campos do formulario MFA.
 * Retorna true se conseguiu extrair um segredo valido.
 */
function applyOtpauthToForm(raw) {
    let url;
    try {
        url = new URL(String(raw).trim());
    } catch (e) {
        return false;
    }
    if (url.protocol !== 'otpauth:') return false;

    const tipo = (url.hostname || '').toLowerCase(); // 'totp' ou 'hotp'
    const secret = url.searchParams.get('secret');
    if (!secret) return false;

    const algorithm = (url.searchParams.get('algorithm') || 'sha1').toLowerCase();
    const digits = url.searchParams.get('digits') || '6';
    const period = url.searchParams.get('period') || '30';
    const counter = url.searchParams.get('counter') || '0';
    const issuer = url.searchParams.get('issuer') || '';
    const label = decodeURIComponent((url.pathname || '').replace(/^\/+/, ''));

    // titulo e usuario a partir do label "Issuer:conta"
    let title = issuer || label;
    let username = '';
    if (label.includes(':')) {
        const partes = label.split(':');
        username = partes.slice(1).join(':');
        if (!issuer) title = partes[0];
    } else if (label) {
        username = label;
    }

    // garante que estamos no tipo MFA
    if (entryType && entryType.value !== 'mfa') {
        entryType.value = 'mfa';
        handleEntryTypeChange();
    }

    // algoritmo TOTP/HOTP
    if (entryMfaAlgorithm) {
        entryMfaAlgorithm.value = (tipo === 'hotp') ? 'hotp' : 'totp';
        handleMfaAlgorithmChange();
    }

    const set = (id, val) => { const el = document.getElementById(id); if (el != null && val != null) el.value = val; };

    set('entry-mfa-secret', secret);

    if (tipo === 'hotp') {
        set('entry-mfa-counter', counter);
        set('entry-mfa-digits-hotp', digits);
        set('entry-mfa-hash-hotp', algorithm);
    } else {
        set('entry-mfa-period', period);
        set('entry-mfa-digits', digits);
        set('entry-mfa-hash', algorithm);
    }

    // preenche titulo/usuario apenas se estiverem vazios (nao sobrescreve o que o usuario digitou)
    const tituloEl = document.getElementById('entry-title');
    if (tituloEl && !tituloEl.value.trim() && title) tituloEl.value = title;
    const userEl = document.getElementById('entry-username');
    if (userEl && !userEl.value.trim() && username) userEl.value = username;

    return true;
}

function handleEntryTypeChange() {
    const type = entryType.value;
    
    // Mostrar/ocultar campos baseado no tipo
    urlGroup.style.display = type === 'login' ? 'block' : 'none';
    usernameGroup.style.display = type === 'login' ? 'block' : 'none';
    passwordGroup.style.display = type === 'login' ? 'block' : 'none';
    linkedMfaGroup.style.display = type === 'login' ? 'block' : 'none';
    mfaGroup.style.display = type === 'mfa' ? 'block' : 'none';
    tokenGroup.style.display = type === 'token' ? 'block' : 'none';
    
    // Se for login, popular lista de MFA
    if (type === 'login') {
        populateMfaSelect();
    }
    
    // Se for MFA, configurar algoritmo padrão
    if (type === 'mfa') {
        handleMfaAlgorithmChange();
    }
}

/**
 * Popula o select de MFA com as entradas MFA disponíveis
 */
function populateMfaSelect() {
    const mfaEntries = activeData().filter(entry => entry.type === 'mfa');
    
    // Limpar e adicionar opção padrão
    entryLinkedMfa.innerHTML = '<option value="">Nenhum (sem 2FA)</option>';
    
    // Adicionar cada entrada MFA
    mfaEntries.forEach(entry => {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.title;
        entryLinkedMfa.appendChild(option);
    });
}

function handleMfaAlgorithmChange() {
    const algorithm = entryMfaAlgorithm.value;
    
    // Mostrar/ocultar opções baseado no algoritmo
    mfaTotpOptions.style.display = algorithm === 'totp' ? 'block' : 'none';
    mfaHotpOptions.style.display = algorithm === 'hotp' ? 'block' : 'none';
}

// ===== CUSTOM FIELDS FUNCTIONS =====

/**
 * Gera ID único para custom fields
 * Usa timestamp + random + counter para garantir unicidade
 */
let customFieldCounter = 0;
function generateCustomFieldId() {
    customFieldCounter++;
    return `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${customFieldCounter}`;
}

/**
 * Adiciona um novo campo personalizado vazio
 */
function addCustomField() {
    const fieldId = generateCustomFieldId();
    const field = {
        id: fieldId,
        name: '',
        value: '',
        type: 'text' // text, password, email, url, etc.
    };
    
    currentCustomFields.push(field);
    renderCustomFields();
    
    // Focar no input de nome do novo campo
    setTimeout(() => {
        const nameInput = document.querySelector(`[data-field-id="${fieldId}"] .field-name`);
        if (nameInput) nameInput.focus();
    }, 100);
}

/**
 * Remove um campo personalizado
 */
function removeCustomField(fieldId) {
    currentCustomFields = currentCustomFields.filter(f => f.id !== fieldId);
    renderCustomFields();
}

/**
 * Atualiza um campo personalizado
 */
function updateCustomField(fieldId, property, value) {
    const field = currentCustomFields.find(f => f.id === fieldId);
    if (field) {
        field[property] = value;
    }
}

/**
 * Renderiza a lista de custom fields no modal
 */
function renderCustomFields() {
    customFieldsList.innerHTML = '';
    
    if (currentCustomFields.length === 0) {
        return;
    }
    
    currentCustomFields.forEach(field => {
        const fieldDiv = document.createElement('div');
        fieldDiv.className = 'custom-field-item';
        fieldDiv.dataset.fieldId = field.id;
        
        // Input para nome do campo
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'custom-field-input field-name';
        nameInput.placeholder = 'Nome do campo (ex: CPF, PIN)';
        nameInput.value = field.name || '';
        nameInput.addEventListener('input', (e) => {
            updateCustomField(field.id, 'name', e.target.value);
        });
        
        // Container para valor e tipo
        const valueContainer = document.createElement('div');
        valueContainer.style.display = 'flex';
        valueContainer.style.gap = '0.5rem';
        valueContainer.style.flex = '2';
        
        // Input para valor
        const valueInput = document.createElement('input');
        valueInput.type = field.type === 'password' ? 'password' : 'text';
        valueInput.className = 'custom-field-input';
        valueInput.placeholder = 'Valor';
        valueInput.value = field.value || '';
        valueInput.style.flex = '1';
        valueInput.addEventListener('input', (e) => {
            updateCustomField(field.id, 'value', e.target.value);
        });
        
        // Select para tipo
        const typeSelect = document.createElement('select');
        typeSelect.className = 'custom-field-type-select';
        typeSelect.innerHTML = `
            <option value="text">Texto</option>
            <option value="password">Senha</option>
            <option value="email">Email</option>
            <option value="url">URL</option>
            <option value="number">Número</option>
            <option value="date">Data</option>
        `;
        typeSelect.value = field.type || 'text';
        typeSelect.addEventListener('change', (e) => {
            updateCustomField(field.id, 'type', e.target.value);
            valueInput.type = e.target.value === 'password' ? 'password' : 'text';
        });
        
        valueContainer.appendChild(valueInput);
        valueContainer.appendChild(typeSelect);
        
        // Botão de remover
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'custom-field-remove-btn';
        removeBtn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
        removeBtn.addEventListener('click', () => removeCustomField(field.id));
        
        // Adicionar elementos ao field div
        fieldDiv.appendChild(nameInput);
        fieldDiv.appendChild(valueContainer);
        fieldDiv.appendChild(removeBtn);
        
        customFieldsList.appendChild(fieldDiv);
    });
}

/**
 * Carrega custom fields de uma entrada existente
 */
function loadCustomFields(entry) {
    currentCustomFields = [];
    if (entry && entry.customFields && Array.isArray(entry.customFields)) {
        currentCustomFields = entry.customFields.map(f => ({
            id: f.id || generateCustomFieldId(),
            name: f.name || '',
            value: f.value || '',
            type: f.type || 'text'
        }));
    }
    renderCustomFields();
}

/**
 * Obtém custom fields limpos (apenas com nome e valor preenchidos)
 */
function getCleanCustomFields() {
    return currentCustomFields
        .filter(f => f.name.trim() && f.value.trim())
        .map(f => ({
            id: f.id,
            name: f.name.trim(),
            value: f.value.trim(),
            type: f.type || 'text'
        }));
}

// ===== END CUSTOM FIELDS FUNCTIONS =====

/**
 * Converte o campo de tags (texto separado por vírgula) em array limpo.
 */
function parseTagsInput() {
    return document.getElementById('entry-tags').value
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)
        .filter((t, i, arr) => arr.indexOf(t) === i)
        .slice(0, 20);
}

const SHARED_PASSWORD_TAG = 'SSO_BANK';

const hasSharedTag = e => !e.deletedAt &&
    (e.tags || []).some(t => String(t).toUpperCase() === SHARED_PASSWORD_TAG);

/**
 * Entradas com a tag SSO_BANK compartilham a mesma senha:
 * sem senha → herda a do grupo; com senha → propaga para todas as outras.
 */
function syncSharedPassword(entry) {
    if (!hasSharedTag(entry)) return;
    const others = currentData.filter(e => e.id !== entry.id && hasSharedTag(e));

    if (!entry.password) {
        const source = others.find(e => e.password);
        if (source) entry.password = source.password;
        return;
    }

    const now = new Date().toISOString();
    others.forEach(e => {
        if (e.password === entry.password) return;
        if (e.password) {
            e.passwordHistory = [...(e.passwordHistory || []), { password: e.password, changedAt: now }].slice(-10);
        }
        e.password = entry.password;
        e.updatedAt = now;
    });
}

async function saveEntry() {
    const title = entryTitle.value.trim();
    const type = entryType.value;

    if (!title) {
        alert('Digite um título para a entrada');
        return;
    }

    const newPassword = entryPassword.value.trim();

    const entry = {
        id: editingEntry?.id || generateId(),
        type,
        title,
        url: entryUrl.value.trim(),
        username: entryUsername.value.trim(),
        password: newPassword,
        linkedMfaId: type === 'login' ? (entryLinkedMfa.value || '') : '', // MFA vinculado
        mfaSecret: entryMfaSecret.value.trim(),
        mfaAlgorithm: entryMfaAlgorithm.value,
        mfaPeriod: parseInt(entryMfaPeriod.value) || 30,
        mfaDigits: parseInt(entryMfaAlgorithm.value === 'hotp' ? entryMfaDigitsHotp.value : entryMfaDigits.value) || 6,
        mfaCounter: parseInt(entryMfaCounter.value) || 0,
        mfaHash: entryMfaAlgorithm.value === 'hotp' ? entryMfaHashHotp.value : entryMfaHash.value,
        token: entryToken.value.trim(),
        tokenType: entryTokenType.value,
        tokenExpires: entryTokenExpires.value,
        notes: entryNotes.value.trim(),
        customFields: getCleanCustomFields(), // Adicionar custom fields
        tags: parseTagsInput(),
        favorite: document.getElementById('entry-favorite').checked,
        createdAt: editingEntry?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    if (editingEntry) {
        // Preservar campos que o formulário não gerencia
        if (editingEntry.deletedAt) entry.deletedAt = editingEntry.deletedAt;
        entry.passwordHistory = [...(editingEntry.passwordHistory || [])];

        // Histórico de senhas: guarda a anterior quando ela muda (máx. 10)
        if (editingEntry.password && newPassword !== editingEntry.password) {
            entry.passwordHistory.push({
                password: editingEntry.password,
                changedAt: new Date().toISOString()
            });
            entry.passwordHistory = entry.passwordHistory.slice(-10);
        }
    }

    if (editingEntry) {
        const index = currentData.findIndex(e => e.id === editingEntry.id);
        currentData[index] = entry;
    } else {
        currentData.push(entry);
    }

    syncSharedPassword(entry);

    try {
        const result = await persistData();

        if (result.success) {
            updateEntryCounts();
            renderTagsSidebar();
            handleSearch();
            selectEntry(entry);
            closeModals();
        } else {
            alert('Erro ao salvar entrada');
        }
    } catch (error) {
        alert('Erro ao salvar entrada');
    }
}

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
        
        <div class="mfa-row-code" id="mfa-code-${entry.id}">
            ••••••
        </div>

        <div class="mfa-row-timer">
            ${entry.mfaAlgorithm === 'totp' ? `
                <div class="mfa-timer" id="mfa-timer-${entry.id}">30</div>
            ` : `
                <div class="mfa-counter" id="mfa-counter-${entry.id}">
                    ${entry.mfaCounter || 0}
                </div>
            `}
        </div>

        <div class="mfa-row-info">
            ${entry.mfaAlgorithm.toUpperCase()}<br>
            <small>${entry.mfaDigits}d • ${entry.mfaPeriod || 30}s</small>
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
        const mfaCodeElement = document.getElementById(`mfa-code-${entryId}`);
        const mfaTimerElement = document.getElementById(`mfa-timer-${entryId}`);
        
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
    const mfaCodeElement = document.getElementById(`mfa-code-${entryId}`);
    const copyBtn = document.querySelector(`[data-id="${entryId}"] .mfa-copy-btn`);
    
    if (mfaCodeElement && mfaCodeElement.textContent.trim() !== '••••••') {
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

// Funções de Importação
function openImportModal() {
    importModal.style.display = 'flex';
    
    // Resetar estado do modal
    importFileInput.value = '';
    pendingImportEntries = null;
    fileInfo.style.display = 'none';
    importPreview.style.display = 'none';
    confirmImportBtn.disabled = true;
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    
    if (!file) {
        fileInfo.style.display = 'none';
        importPreview.style.display = 'none';
        confirmImportBtn.disabled = true;
        return;
    }
    
    pendingImportEntries = null;
    confirmImportBtn.disabled = true;

    if (!/\.(json|csv|zip)$/i.test(file.name)) {
        alert('Por favor, selecione um arquivo .json, .csv ou .zip.');
        return;
    }

    // Mostrar informações do arquivo
    fileInfo.innerHTML = `
        <strong>Arquivo selecionado:</strong> ${escapeHtml(file.name)}<br>
        <strong>Tamanho:</strong> ${(file.size / 1024).toFixed(2)} KB
    `;
    fileInfo.style.display = 'block';

    readImportFile(file).then(importData => {
        if (!importData) return;

        // Validar e filtrar entradas válidas
        const validEntries = validateImportData(importData);

        if (validEntries.length === 0) {
            alert('Nenhuma entrada válida encontrada no arquivo.');
            return;
        }

        // Mostrar preview das entradas
        pendingImportEntries = validEntries;
        showImportPreview(validEntries);
        confirmImportBtn.disabled = false;
    }).catch(error => {
        console.error('Erro ao processar arquivo:', error);
        alert('Erro ao ler o arquivo. Verifique se o formato está correto.');
    });
}

/**
 * Lê o arquivo escolhido e devolve as entradas normalizadas (ou null, já tendo
 * avisado o usuário). .zip: export do Proton Pass; .csv: CSV do Proton Pass;
 * .json: MySecrets/autenticador, Bitwarden ou Proton Pass.
 */
async function readImportFile(file) {
    const nome = file.name.toLowerCase();

    if (nome.endsWith('.zip')) {
        const json = await extractTextFromZip(await file.arrayBuffer(), n => /(^|\/)data\.json$/i.test(n));
        if (json == null) {
            alert('Nao encontrei o data.json dentro do ZIP. Use o export do Proton Pass sem criptografia.');
            return null;
        }
        return normalizeImportData(JSON.parse(json));
    }

    const texto = await file.text();

    if (nome.endsWith('.csv')) {
        if (!isProtonPassCsv(texto)) {
            alert('CSV nao reconhecido. Por enquanto so o CSV exportado pelo Proton Pass e suportado.');
            return null;
        }
        return convertProtonPassToMySecrets(protonPassCsvToJson(texto), generateId);
    }

    return normalizeImportData(JSON.parse(texto));
}

/**
 * Normaliza a origem da importacao.
 * Aceita: array no formato MySecrets/autenticador, o objeto de export do
 * Bitwarden ({ encrypted, folders, items }) ou o data.json do Proton Pass
 * ({ encrypted, vaults }). Retorna sempre um array, ou null quando o formato
 * nao e reconhecido.
 */
function normalizeImportData(parsed) {
    if (Array.isArray(parsed)) {
        return parsed;
    }

    if (isProtonPassJson(parsed)) {
        if (parsed.encrypted === true) {
            alert('Este export do Proton Pass esta criptografado (PGP). Exporte novamente sem criptografia.');
            return null;
        }
        return convertProtonPassToMySecrets(parsed, generateId);
    }

    if (parsed && Array.isArray(parsed.items)) {
        if (parsed.encrypted === true) {
            alert('Este export do Bitwarden esta criptografado. Exporte novamente sem criptografia (unencrypted).');
            return null;
        }
        return convertBitwardenToMySecrets(parsed);
    }

    alert('Formato de arquivo invalido. Esperado um array de entradas ou um export do Bitwarden ou do Proton Pass.');
    return null;
}

/**
 * Converte um export do Bitwarden para o formato do MySecrets.
 * Tipos do Bitwarden: 1=login, 2=nota, 3=cartao, 4=identidade.
 * O MySecrets so tem login/mfa/note, entao cartao e identidade viram notas
 * estruturadas. Logins com TOTP geram uma entrada MFA vinculada.
 */
function convertBitwardenToMySecrets(bw) {
    const pastas = {};
    (bw.folders || []).forEach(f => { if (f && f.id) pastas[f.id] = f.name; });

    const resultado = [];

    const lerTotp = parseImportTotp;

    const blocoNotas = (item) => {
        const partes = [];
        if (item.notes) partes.push(String(item.notes).trim());
        if (item.folderId && pastas[item.folderId]) {
            partes.push('Pasta Bitwarden: ' + pastas[item.folderId]);
        }
        return partes.filter(Boolean).join('\n\n');
    };

    const camposCustom = (item) => (item.fields || [])
        .filter(f => f && (f.name || f.value))
        .map(f => ({
            id: generateId(),
            name: f.name || 'campo',
            value: f.value == null ? '' : String(f.value),
            type: f.type === 1 ? 'password' : 'text'
        }));

    const paresParaNota = (titulo, obj, ordem) => {
        const linhas = ['[' + titulo + ']'];
        ordem.forEach(([chave, rotulo]) => {
            if (obj && obj[chave]) linhas.push(rotulo + ': ' + obj[chave]);
        });
        return linhas.length > 1 ? linhas.join('\n') : '';
    };

    (bw.items || []).forEach(item => {
        if (!item) return;

        const nome = (item.name || '').trim() || '(sem titulo)';
        const tags = ['importado', 'bitwarden'];
        if (item.folderId && pastas[item.folderId]) {
            tags.push(String(pastas[item.folderId]).toLowerCase().replace(/\s+/g, '-'));
        }
        if (item.favorite) tags.push('favorito');

        const base = {
            createdAt: item.creationDate || new Date().toISOString(),
            updatedAt: item.revisionDate || new Date().toISOString(),
            tags: tags
        };

        if (item.type === 1) {
            const lg = item.login || {};
            const uris = (lg.uris || []).map(u => u && u.uri).filter(Boolean);
            let notas = blocoNotas(item);
            if (uris.length > 1) {
                notas = (notas ? notas + '\n\n' : '') +
                        'Outras URLs:\n' + uris.slice(1).map(u => '- ' + u).join('\n');
            }

            const entrada = Object.assign({}, base, {
                id: generateId(),
                title: nome,
                type: 'login',
                url: uris[0] || '',
                username: lg.username || '',
                password: lg.password || '',
                notes: notas
            });

            const cf = camposCustom(item);
            if (cf.length) entrada.customFields = cf;

            const totp = lerTotp(lg.totp);
            if (totp) {
                const mfaId = generateId();
                resultado.push(Object.assign({}, base, {
                    id: mfaId,
                    title: nome + ' (2FA)',
                    type: 'mfa',
                    url: uris[0] || '',
                    username: lg.username || '',
                    password: '',
                    mfaSecret: totp.secret,
                    mfaAlgorithm: 'totp',
                    mfaPeriod: totp.periodo,
                    mfaDigits: totp.digitos,
                    mfaCounter: 0,
                    mfaHash: totp.algoritmo,
                    notes: 'Importado do Bitwarden (2FA de "' + nome + '")',
                    tags: tags.concat(['mfa'])
                }));
                entrada.linkedMfaId = mfaId;
            }

            resultado.push(entrada);

        } else if (item.type === 2) {
            const entrada = Object.assign({}, base, {
                id: generateId(),
                title: nome,
                type: 'note',
                url: '',
                username: '',
                password: '',
                notes: blocoNotas(item) || '(nota vazia no Bitwarden)'
            });
            const cf = camposCustom(item);
            if (cf.length) entrada.customFields = cf;
            resultado.push(entrada);

        } else if (item.type === 3) {
            const c = item.card || {};
            const corpo = paresParaNota('Cartao', c, [
                ['cardholderName', 'Titular'], ['brand', 'Bandeira'], ['number', 'Numero'],
                ['expMonth', 'Mes'], ['expYear', 'Ano'], ['code', 'CVV']
            ]);
            resultado.push(Object.assign({}, base, {
                id: generateId(),
                title: nome,
                type: 'note',
                url: '',
                username: c.cardholderName || '',
                password: '',
                notes: [corpo, blocoNotas(item)].filter(Boolean).join('\n\n'),
                tags: tags.concat(['cartao'])
            }));

        } else if (item.type === 4) {
            const idt = item.identity || {};
            const corpo = paresParaNota('Identidade', idt, [
                ['title', 'Tratamento'], ['firstName', 'Nome'], ['middleName', 'Meio'],
                ['lastName', 'Sobrenome'], ['company', 'Empresa'], ['email', 'Email'],
                ['phone', 'Telefone'], ['ssn', 'SSN'], ['username', 'Usuario'],
                ['passportNumber', 'Passaporte'], ['licenseNumber', 'CNH'],
                ['address1', 'Endereco'], ['address2', 'Complemento'], ['city', 'Cidade'],
                ['state', 'Estado'], ['postalCode', 'CEP'], ['country', 'Pais']
            ]);
            resultado.push(Object.assign({}, base, {
                id: generateId(),
                title: nome,
                type: 'note',
                url: '',
                username: idt.username || idt.email || '',
                password: '',
                notes: [corpo, blocoNotas(item)].filter(Boolean).join('\n\n'),
                tags: tags.concat(['identidade'])
            }));
        }
    });

    return resultado;
}

function validateImportData(data) {
    return data.filter(entry => {
        // Verificar se é formato MySecrets (já processado)
        if (entry.title && entry.type) {
            // Verificar se é um tipo válido
            if (!['login', 'mfa', 'note'].includes(entry.type)) {
                return false;
            }
            
            // Se for MFA, verificar se tem secret
            if (entry.type === 'mfa' && !entry.mfaSecret) {
                return false;
            }
            
            return true;
        }
        
        // Verificar se é formato de autenticador externo (novo formato)
        if (entry.secret && entry.issuer && entry.label) {
            // Verificar se tem os campos necessários para MFA
            return entry.type === 'totp' || entry.type === 'hotp';
        }
        
        return false;
    }).map(entry => {
        // Se já está no formato MySecrets, retornar como está
        if (entry.title && entry.type) {
            return entry;
        }
        
        // Converter formato de autenticador externo para formato MySecrets
        return convertExternalToMySecrets(entry);
    });
}

function convertExternalToMySecrets(externalEntry) {
    const now = new Date().toISOString();
    
    // Extrair título baseado no label e issuer
    let title = externalEntry.issuer || 'MFA';
    let username = '';
    
    // Processar o label para extrair informações
    if (externalEntry.label) {
        const label = externalEntry.label;
        
        // Se contém ":", pode ser issuer:account
        if (label.includes(':')) {
            const parts = label.split(':');
            if (parts.length === 2) {
                const [labelIssuer, account] = parts;
                username = account.replace(/\\/g, '\\');
                // Se não temos issuer, usar o do label
                if (!externalEntry.issuer || externalEntry.issuer === labelIssuer) {
                    title = labelIssuer;
                }
            }
        } else if (label.includes('_')) {
            // Formato com underscore (ex: gitlab.exemplo.com_usuario@exemplo.com)
            const parts = label.split('_');
            if (parts.length >= 2) {
                username = parts.slice(1).join('_');
            }
        } else {
            username = label;
        }
        
        // Melhorar o título baseado no contexto
        if (username) {
            let cleanUsername = username.split('@')[0].split('\\').pop();
            
            title += ` - ${cleanUsername}`;
        }
    }
    
    // Definir URL baseada no issuer
    let url = '';
    const issuerLower = (externalEntry.issuer || '').toLowerCase();
    if (issuerLower.includes('microsoft')) {
        url = 'https://account.microsoft.com';
    }
    
    return {
        id: generateId(),
        title: title,
        type: 'mfa',
        url: url,
        username: username,
        password: '',
        mfaSecret: externalEntry.secret,
        mfaAlgorithm: externalEntry.type || 'totp',
        mfaPeriod: externalEntry.period || 30,
        mfaDigits: externalEntry.digits || 6,
        mfaCounter: externalEntry.counter || 0,
        mfaHash: (externalEntry.algorithm || 'sha1').toLowerCase(),
        notes: `Importado de autenticador externo\nIssuer: ${externalEntry.issuer}\nLabel: ${externalEntry.label}\nAlgoritmo: ${(externalEntry.algorithm || 'SHA1').toUpperCase()}\nDígitos: ${externalEntry.digits || 6}\nPeríodo: ${externalEntry.period || 30}s`,
        createdAt: now,
        updatedAt: now,
        tags: ['importado', 'mfa', ...(externalEntry.tags || []), issuerLower.replace(/\s+/g, '-')]
    };
}

function showImportPreview(entries) {
    importEntriesList.innerHTML = '';
    
    entries.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'import-entry-item';
        
        const typeLabels = {
            login: 'Login',
            mfa: 'MFA',
            note: 'Nota'
        };
        
        let details = [];
        if (entry.username) details.push(`Usuário: ${entry.username}`);
        if (entry.url) details.push(`URL: ${entry.url}`);
        if (entry.type === 'mfa' && entry.mfaSecret) {
            details.push(`Secret: ${entry.mfaSecret.substring(0, 8)}...`);
        }
        
        div.innerHTML = `
            <div class="import-entry-info">
                <h4 class="import-entry-title">${escapeHtml(entry.title)}</h4>
                <p class="import-entry-details">${details.join(' • ')}</p>
            </div>
            <span class="import-entry-badge">${typeLabels[entry.type]}</span>
        `;
        
        importEntriesList.appendChild(div);
    });
    
    importPreview.style.display = 'block';
}

async function handleImportEntries() {
    const validEntries = pendingImportEntries;
    if (!validEntries) return;

    try {
        let entriesToImport = validEntries;
        
        // Filtrar duplicatas se a opção estiver marcada
        if (skipDuplicates.checked) {
            const existingTitles = new Set(currentData.map(entry => entry.title.toLowerCase()));
            entriesToImport = validEntries.filter(entry => 
                !existingTitles.has(entry.title.toLowerCase())
            );
        }
        
        if (entriesToImport.length === 0) {
            alert('Nenhuma entrada nova para importar (todas já existem).');
            return;
        }
        
        // Importar entradas
        const now = new Date().toISOString();
        entriesToImport.forEach(entry => {
            // Garantir que tenha ID único
            entry.id = entry.id || generateId();
            
            // Atualizar timestamps
            entry.createdAt = entry.createdAt || now;
            entry.updatedAt = now;
            
            // Adicionar ao dados atuais
            currentData.push(entry);
        });
        
        // Salvar dados
        const result = await persistData();

        if (result.success) {
            // Atualizar interface
            updateEntryCounts();
            renderTagsSidebar();
            handleSearch();

            // Fechar modal e mostrar sucesso
            closeModals();
            alert(`${entriesToImport.length} entradas importadas com sucesso!`);

            // Se não havia entradas antes, remover mensagem de boas-vindas
            if (currentData.length === entriesToImport.length) {
                welcomeMessage.style.display = 'none';
                if (entriesToImport.length > 0) {
                    selectEntry(entriesToImport[0]);
                }
            }
        } else {
            alert('Erro ao salvar entradas importadas: ' + result.error);
        }
    } catch (error) {
        console.error('Erro na importação:', error);
        alert('Erro ao importar entradas: ' + error.message);
    }
}

function closeModals() {
    console.log('Fechando todos os modais');
    entryModal.style.display = 'none';
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
    alert('Senha copiada!');
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
function copyToClipboard(text, label = 'Copiado') {
    const clearSeconds = getSettings().clipboardClearSeconds;
    window.electronAPI.copyToClipboard(text, clearSeconds);

    // Feedback visual
    const tooltip = document.createElement('div');
    tooltip.textContent = clearSeconds > 0 ? `${label}! (limpa em ${clearSeconds}s)` : `${label}!`;
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
        if (!confirm('Excluir esta entrada DEFINITIVAMENTE? Esta ação não pode ser desfeita.')) {
            return;
        }
        currentData = currentData.filter(e => e.id !== entryId);
    } else {
        if (!confirm('Mover esta entrada para a lixeira? Você poderá restaurá-la em até 30 dias.')) {
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
            alert('Erro ao excluir entrada');
        }
    } catch (error) {
        alert('Erro ao excluir entrada');
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
            alert('Erro ao restaurar entrada');
        }
    } catch (error) {
        alert('Erro ao restaurar entrada');
    }
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function escapeHtml(text) {
    // Escapa também aspas: valores podem ser interpolados dentro de atributos
    // HTML, e sem isso uma entrada maliciosa escaparia do atributo (XSS)
    return String(text ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

function showError(element, message) {
    element.textContent = message;
    element.classList.add('show');
}

function hideError(element) {
    element.classList.remove('show');
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
            alert('Erro ao atualizar contador HOTP');
        }
    } catch (error) {
        alert('Erro ao atualizar contador HOTP');
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
            
            alert('Cofre resetado com sucesso! Você pode criar uma nova senha mestra.');
        } else {
            alert('Erro ao resetar cofre: ' + result.error);
        }
    } catch (error) {
        alert('Erro ao resetar cofre: ' + error.message);
    }
}