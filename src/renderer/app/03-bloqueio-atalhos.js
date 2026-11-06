// MySecrets (renderer) - Bloqueio automático por inatividade e atalhos de teclado.
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

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
