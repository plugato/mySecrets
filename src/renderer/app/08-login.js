// MySecrets (renderer) - Windows Hello, login, criação do cofre e bloqueio.
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

// ===== Windows Hello (login por digital) =====

// true = leitor aceita digital direto (WinBio), sem abrir a janela do Hello
let helloSilentMode = false;
let helloShown = false;

async function updateHelloButton() {
    try {
        const status = await window.electronAPI.helloStatus();
        helloSilentMode = !!status.silent;
        const show = status.available && status.enrolled;
        helloLoginBtn.style.display = show ? 'flex' : 'none';
        helloShown = show;
        helloDivider.style.display = (show || phoneShown) ? 'flex' : 'none';
        helloLoginBtn.querySelector('span').textContent = helloSilentMode
            ? tr('Entrar com digital')
            : tr('Entrar com Windows Hello');
    } catch (error) {
        console.error('Erro ao verificar status do Windows Hello:', error);
        helloLoginBtn.style.display = 'none';
        helloShown = false;
        helloDivider.style.display = phoneShown ? 'flex' : 'none';
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

// Prompt do Hello aberto: o botão vira "cancelar" e a senha continua liberada
let helloWaiting = false;
let helloCancelled = false;

function cancelHelloLogin() {
    helloCancelled = true;
    window.electronAPI.helloCancel().catch(() => {});
}

async function handleHelloLogin(auto = false) {
    hideError(loginError);
    helloWaiting = true;
    helloCancelled = false;
    const label = helloLoginBtn.querySelector('span');
    const originalLabel = label.textContent;
    label.textContent = helloSilentMode
        ? tr('👆 Encoste o dedo no leitor... (clique para cancelar)')
        : tr('Aguardando Windows Hello... (clique para cancelar)');

    try {
        const helloResult = await window.electronAPI.helloLogin();

        // Cancelado, ou o usuário já entrou com a senha enquanto isso
        if (helloCancelled || mainScreen.style.display === 'block') return;

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
            showError(loginError, tr('A senha salva no Windows Hello não é mais válida. Entre com a senha mestra.'));
        }
    } catch (error) {
        showError(loginError, tr('Erro no login por digital'));
    } finally {
        helloWaiting = false;
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
            ? tr('Ao aceitar, encoste o dedo no leitor para confirmar.')
            : tr('Ao aceitar, confirme sua identidade na janela do Windows Hello.');
        const wants = confirm(tr("Deseja habilitar o login por digital?\n\nVocê poderá desbloquear o MySecrets usando sua biometria em vez da senha mestra.\n\n{0}", { 0: enrollHint }));
        if (!wants) {
            localStorage.setItem('helloEnrollDeclined', 'true');
            return;
        }

        const result = await window.electronAPI.helloEnroll(password);
        if (result.success) {
            alert(tr('✅ Login por digital habilitado! Na próxima vez, use o botão de digital na tela de login.'));
        } else {
            alert(tr('Não foi possível habilitar o login por digital: ') + result.error);
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
        showError(loginError, tr('Digite a senha mestra'));
        return;
    }

    // Entrou com a senha: fecha o prompt do Hello que ficou aberto
    if (helloWaiting) cancelHelloLogin();

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
        showError(loginError, tr('Erro ao carregar dados'));
    }
}

async function handleSetup() {
    const password = newMasterPasswordInput.value.trim();
    const confirmPassword = confirmMasterPasswordInput.value.trim();
    
    if (!password) {
        showError(setupError, tr('Digite uma senha mestra'));
        return;
    }
    
    if (password.length < 8) {
        showError(setupError, tr('Senha deve ter pelo menos 8 caracteres'));
        return;
    }
    
    if (password !== confirmPassword) {
        showError(setupError, tr('Senhas não coincidem'));
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
            showError(setupError, tr("Erro ao criar cofre: {0}", { 0: result.error }));
        }
    } catch (error) {
        showError(setupError, tr("Erro ao criar cofre: {0}", { 0: error.message }));
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

    // Pedido de agente aberto: bloqueou, então não grava
    agentConfirm.cancelAll(tr('O cofre foi bloqueado antes da confirmação. Nada foi gravado.'));

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
    pwnedState = null;

    // Tirar da tela o que veio do cofre (estava só escondido)
    entriesList.innerHTML = '';
    entryDetails.innerHTML = '';
    mfaCodesGrid.innerHTML = '';
    const grid = document.getElementById('grid-view');
    if (grid) grid.innerHTML = '';
    const health = document.getElementById('health-overview');
    if (health) health.innerHTML = '';

    // Mostrar formulário de login (dados já existem)
    showLoginForm();
}
