// MySecrets (renderer) - Modal de configurações e sincronização (pasta e Google Drive).
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

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

    const languageSelect = document.getElementById('setting-language');
    if (languageSelect) {
        languageSelect.addEventListener('change', async () => {
            // O processo principal guarda a escolha e recarrega a janela
            await window.electronAPI.setLanguage(languageSelect.value);
        });
    }

    settingsBtn.addEventListener('click', async () => {
        const s = getSettings();
        if (languageSelect) languageSelect.value = window.I18N.pref || 'auto';
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
                    ? tr("{0} backup(s) automático(s) — mais recente: {1}", { 0: backups.length, 1: new Date(backups[0].modifiedAt).toLocaleString(I18N.locale) })
                    : tr('Nenhum backup automático ainda.');
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
            alert(tr('Erro ao exportar backup: ') + error.message);
        }
    });

    document.getElementById('import-backup-btn').addEventListener('click', async () => {
        try {
            await window.electronAPI.importBackup();
        } catch (error) {
            alert(tr('Erro ao restaurar backup: ') + error.message);
        }
    });

    setupUpdateControls();
    setupSyncControls();
    setupGdriveControls();
    setupPhoneControls();
}

// ===== Login com Google (sincronização pela API do Drive) =====

function setupGdriveControls() {
    const block = document.getElementById('gdrive-block');
    const statusEl = document.getElementById('gdrive-status-text');
    const connectBtn = document.getElementById('gdrive-connect-btn');
    const syncBtn = document.getElementById('gdrive-sync-btn');
    const disconnectBtn = document.getElementById('gdrive-disconnect-btn');
    const folderBlock = document.getElementById('sync-folder-block');
    if (!block || !window.electronAPI.gdriveStatus) return;

    function render(st) {
        if (!st.available) {
            statusEl.textContent = tr('Login com Google indisponível nesta versão do app. Use a opção avançada abaixo.');
            connectBtn.style.display = 'none';
            syncBtn.style.display = 'none';
            disconnectBtn.style.display = 'none';
            return;
        }
        if (st.connected) {
            let texto = tr("✅ Conectado como {0}", { 0: st.email || 'conta Google' });
            if (st.syncing) texto += tr(' · sincronizando…');
            else if (st.lastSyncAt) texto += tr(" · última sincronização: {0}", { 0: new Date(st.lastSyncAt).toLocaleString(I18N.locale) });
            if (st.lastError) texto += `\n⚠️ ${st.lastError}`;
            statusEl.textContent = texto;
            connectBtn.style.display = 'none';
            syncBtn.style.display = '';
            disconnectBtn.style.display = '';
            if (folderBlock) folderBlock.style.display = 'none';
        } else {
            statusEl.textContent = st.lastError
                ? `⚠️ ${st.lastError}`
                : tr('Cofre só neste PC. Entre com sua conta Google para sincronizar automaticamente.');
            connectBtn.style.display = '';
            syncBtn.style.display = 'none';
            disconnectBtn.style.display = 'none';
            if (folderBlock) folderBlock.style.display = '';
        }
    }

    async function refresh() {
        try { render(await window.electronAPI.gdriveStatus()); } catch (_) { /* opcional */ }
    }

    connectBtn.addEventListener('click', async () => {
        connectBtn.disabled = true;
        statusEl.textContent = tr('Abrindo o login do Google no navegador… conclua por lá.');
        try {
            const result = await window.electronAPI.gdriveConnect(currentMasterPassword);
            if (!result.success) alert(tr('Não foi possível conectar ao Google: ') + result.error);
        } finally {
            connectBtn.disabled = false;
            refresh();
        }
    });

    syncBtn.addEventListener('click', async () => {
        syncBtn.disabled = true;
        try {
            render(await window.electronAPI.gdriveSyncNow(currentMasterPassword));
        } finally {
            syncBtn.disabled = false;
        }
    });

    disconnectBtn.addEventListener('click', async () => {
        if (!confirm(tr('Desconectar a conta Google? O cofre continua neste PC e a cópia no Drive não é apagada.'))) return;
        const result = await window.electronAPI.gdriveDisconnect();
        if (!result.success) alert(tr('Erro ao desconectar: ') + result.error);
        refresh();
    });

    window.electronAPI.onGdriveStatus(render);
    document.getElementById('settings-btn').addEventListener('click', refresh);
    refresh();
}

// ===== Sincronização (Google Drive) =====

function setupSyncControls() {
    const statusEl = document.getElementById('sync-status-text');
    const driveBtn = document.getElementById('sync-drive-btn');
    const chooseBtn = document.getElementById('sync-choose-btn');
    const disableBtn = document.getElementById('sync-disable-btn');
    if (!driveBtn || !window.electronAPI.syncStatus) return;

    let detected = null;

    async function refresh() {
        try {
            const st = await window.electronAPI.syncStatus();
            detected = st.detected;
            if (st.enabled) {
                statusEl.textContent = tr("✅ Sincronizando em: {0}", { 0: st.dir });
                driveBtn.style.display = 'none';
                chooseBtn.querySelector('span:last-child').textContent = tr('Mudar pasta…');
                disableBtn.style.display = '';
            } else {
                statusEl.textContent = detected
                    ? tr("Cofre só neste PC. Google Drive encontrado em: {0}", { 0: detected })
                    : tr('Cofre só neste PC. Google Drive para computador não encontrado — instale-o ou escolha a pasta manualmente.');
                driveBtn.style.display = detected ? '' : 'none';
                chooseBtn.querySelector('span:last-child').textContent = tr('Escolher pasta…');
                disableBtn.style.display = 'none';
            }
        } catch (_) {
            statusEl.textContent = tr('Não foi possível verificar a sincronização.');
        }
    }

    async function enable(baseDir) {
        if (!baseDir) return;
        const ok = confirm(tr("O cofre criptografado será guardado em:\n{0}{1}\n\nSe já houver um cofre lá (de outro PC), os dois serão mesclados. Continuar?", { 0: baseDir, 1: /MySecrets$/.test(baseDir) ? '' : (baseDir.includes('\\') ? '\\' : '/') + 'MySecrets' }));
        if (!ok) return;
        const result = await window.electronAPI.syncEnable(baseDir, currentMasterPassword);
        if (!result.success) {
            alert(tr('Não foi possível ligar a sincronização: ') + result.error);
            return;
        }
        if (Array.isArray(result.data)) replaceVaultData(result.data);
        alert(result.merged
            ? tr('Sincronização ligada. O cofre deste PC foi mesclado com o que já estava no Drive.')
            : tr('Sincronização ligada. Nos outros PCs, escolha esta mesma pasta.'));
        refresh();
    }

    driveBtn.addEventListener('click', () => enable(detected));
    chooseBtn.addEventListener('click', async () => enable(await window.electronAPI.syncChooseFolder()));
    disableBtn.addEventListener('click', async () => {
        if (!confirm(tr('Parar de sincronizar? O cofre volta a ficar só neste PC (com a versão atual do Drive). A pasta no Drive não é apagada.'))) return;
        const result = await window.electronAPI.syncDisable();
        if (!result.success) alert(tr('Erro ao desligar a sincronização: ') + result.error);
        refresh();
    });

    document.getElementById('settings-btn').addEventListener('click', refresh);
    refresh();
}

/**
 * Outro PC atualizou o cofre no Drive: recarrega. Se houver um formulário
 * aberto, espera ele fechar para não perder a edição.
 */
let pendingVaultReload = false;

async function reloadVaultFromDisk() {
    if (!currentMasterPassword) return;
    if (entryModal.style.display === 'flex') {
        pendingVaultReload = true;
        return;
    }
    pendingVaultReload = false;
    const result = await window.electronAPI.loadData(currentMasterPassword);
    if (result.success) replaceVaultData(result.data);
}

if (window.electronAPI && window.electronAPI.onVaultChanged) {
    window.electronAPI.onVaultChanged(() => { reloadVaultFromDisk(); });
}
