// MySecrets (renderer) - Celular Android: aprovar o login pelo celular.
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

// ===== Celular Android: aprovar o login pelo celular (mesma rede Wi-Fi) =====

let phoneShown = false;
let phoneWaiting = false;

async function updatePhoneButton() {
    const btn = document.getElementById('phone-login-btn');
    if (!btn || !window.electronAPI.phoneStatus) return;
    try {
        const st = await window.electronAPI.phoneStatus();
        phoneShown = st.phones.length > 0;
    } catch (_) {
        phoneShown = false;
    }
    btn.style.display = phoneShown ? 'flex' : 'none';
    helloDivider.style.display = (phoneShown || helloShown) ? 'flex' : 'none';
}

function setPhoneLoginStatus(text) {
    const el = document.getElementById('phone-login-status');
    if (!el) return;
    el.textContent = text || '';
    el.style.display = text ? 'block' : 'none';
}

async function handlePhoneLogin() {
    const btn = document.getElementById('phone-login-btn');
    const label = btn.querySelector('span:last-child');
    if (phoneWaiting) {
        window.electronAPI.phoneCancel().catch(() => {});
        return;
    }
    hideError(loginError);
    phoneWaiting = true;
    label.textContent = tr('Cancelar pedido ao celular');
    setPhoneLoginStatus(tr('Procurando o celular na rede…'));
    try {
        const r = await window.electronAPI.phoneUnlock();
        if (mainScreen.style.display === 'block') return;
        if (!r.success) {
            if (!r.cancelled) showError(loginError, r.error);
            return;
        }
        const result = await window.electronAPI.loadData(r.password);
        if (result.success) {
            currentMasterPassword = r.password;
            currentData = result.data || [];
            showMainScreen();
        } else {
            showError(loginError, tr('A senha guardada para o celular não abre mais este cofre. Entre com a senha mestra e pareie o celular de novo.'));
        }
    } catch (error) {
        showError(loginError, tr('Erro ao pedir aprovação ao celular'));
    } finally {
        phoneWaiting = false;
        label.textContent = tr('Aprovar pelo celular');
        setPhoneLoginStatus('');
    }
}

if (window.electronAPI && window.electronAPI.onPhoneUnlockStatus) {
    window.electronAPI.onPhoneUnlockStatus((s) => {
        if (!phoneWaiting) return;
        if (s.stage === 'searching') setPhoneLoginStatus(tr('Procurando o celular na rede…'));
        if (s.stage === 'waiting') {
            setPhoneLoginStatus(tr("Aprove no celular{0} com a digital. Código: {1}", { 0: s.phoneName ? ' (' + s.phoneName + ')' : '', 1: s.code }));
        }
    });
}

function setupPhoneControls() {
    const statusEl = document.getElementById('phone-status-text');
    const list = document.getElementById('phone-list');
    const pairBtn = document.getElementById('phone-pair-btn');
    const cancelBtn = document.getElementById('phone-pair-cancel-btn');
    const box = document.getElementById('phone-pair-box');
    const qrImg = document.getElementById('phone-pair-qr');
    const loginBtn = document.getElementById('phone-login-btn');
    if (!statusEl || !window.electronAPI.phoneStatus) return;

    if (loginBtn) loginBtn.addEventListener('click', handlePhoneLogin);
    if (window.electronAPI.onPhonePairStatus) {
        window.electronAPI.onPhonePairStatus((text) => {
            const live = document.getElementById('phone-pair-live');
            if (live) live.textContent = text || '';
        });
    }

    function render(phones) {
        list.innerHTML = '';
        statusEl.textContent = phones.length
            ? tr("{0} celular(es) pareado(s).", { 0: phones.length })
            : tr('Nenhum celular pareado.');
        phones.forEach((p) => {
            const li = document.createElement('li');
            const quando = new Date(p.lastUsedAt || p.pairedAt).toLocaleString();
            // eslint-disable-next-line no-unsanitized/property -- nome e datas escapados
            li.innerHTML = `<span><strong>${escapeHtml(p.phoneName || 'Android')}</strong> <small>${p.lastUsedAt ? tr('usado em') : tr('pareado em')} ${escapeHtml(quando)}</small></span>`;
            const rm = document.createElement('button');
            rm.className = 'btn btn-secondary btn-small';
            rm.textContent = tr('Remover');
            rm.addEventListener('click', async () => {
                if (!confirm(tr("Remover o celular \"{0}\"? Ele não poderá mais aprovar o login neste PC.", { 0: p.phoneName }))) return;
                const r = await window.electronAPI.phoneUnpair(p.pairId);
                render(r.phones);
                updatePhoneButton();
            });
            li.appendChild(rm);
            list.appendChild(li);
        });
    }

    function endPairing() {
        box.style.display = 'none';
        qrImg.removeAttribute('src');
        cancelBtn.style.display = 'none';
        pairBtn.disabled = false;
    }

    async function refresh() {
        const st = await window.electronAPI.phoneStatus();
        render(st.phones);
    }

    pairBtn.addEventListener('click', async () => {
        if (!currentMasterPassword) return;
        pairBtn.disabled = true;
        const start = await window.electronAPI.phonePairStart(currentMasterPassword);
        if (!start.success) {
            alert(tr('Não foi possível iniciar o pareamento: ') + start.error);
            pairBtn.disabled = false;
            return;
        }
        qrImg.src = start.image;
        box.style.display = 'block';
        cancelBtn.style.display = '';
        const r = await window.electronAPI.phonePairWait();
        endPairing();
        if (r.success) {
            alert(tr("✅ Celular \"{0}\" pareado! Na tela de login, use \"Aprovar pelo celular\".", { 0: r.phoneName }));
        } else if (!r.cancelled) {
            alert(tr('Pareamento não concluído: ') + r.error);
        }
        refresh();
        updatePhoneButton();
    });

    cancelBtn.addEventListener('click', () => {
        window.electronAPI.phoneCancel();
        endPairing();
    });

    refresh().catch(() => {});
}
