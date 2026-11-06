// MySecrets (renderer) - Estado da aplicação, referências do DOM, configurações e temas.
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

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
    }).then(result => {
        // Com sincronização, o main pode ter mesclado alterações de outro PC
        if (result && result.success && result.merged && Array.isArray(result.data)) {
            replaceVaultData(result.data);
        }
        return result;
    });
}

/** Troca o conteúdo do cofre em memória (sincronização) e redesenha a tela. */
function replaceVaultData(entries) {
    currentData = entries;
    setTimeout(() => {
        updateEntryCounts();
        renderTagsSidebar();
        handleSearch();
    }, 0);
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
