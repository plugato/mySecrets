// MySecrets (renderer) - Lista, grade e detalhes das entradas.
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

const TYPE_ICONS = {
    login: 'account_circle',
    mfa: 'security',
    token: 'key',
    note: 'note',
    passkey: 'passkey'
};

const TYPE_LABELS = {
    login: tr('Login'),
    mfa: tr('MFA'),
    token: tr('Token'),
    note: tr('Nota'),
    passkey: tr('Passkey')
};

function entrySubtitle(entry) {
    return entry.username || entry.url ||
           (entry.type === 'token' ? (entry.tokenType ? tr("Token {0}", { 0: String(entry.tokenType).toUpperCase() }) : tr('Token')) : '') ||
           (entry.type === 'note' ? tr('Nota segura') : '');
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
            <button class="grid-card-btn-secondary" data-action="copy-password" title="${escapeHtml(tr("Copiar senha"))}">
                <span class="material-symbols-outlined">key</span>
            </button>`;
        }
        if (linkedMfaEntry || (entry.type === 'mfa' && entry.mfaSecret)) {
            quickCopyHTML += `
            <button class="grid-card-btn-secondary" data-action="copy-mfa" title="${escapeHtml(tr("Copiar código MFA"))}">
                <span class="material-symbols-outlined">pin</span>
            </button>`;
        }
        if (entry.type === 'token' && entry.token) {
            quickCopyHTML += `
            <button class="grid-card-btn-secondary" data-action="copy-token" title="${escapeHtml(tr("Copiar token"))}">
                <span class="material-symbols-outlined">content_copy</span>
            </button>`;
        }
    }

    const footerHTML = inTrash ? `
        <div class="grid-card-footer">
            <button class="grid-card-btn" data-action="restore">
                <span class="material-symbols-outlined">restore_from_trash</span>
                ${escapeHtml(tr("Restaurar"))}
            </button>
            <button class="grid-card-btn-secondary btn-danger-hover" data-action="delete-forever" title="${escapeHtml(tr("Excluir definitivamente"))}">
                <span class="material-symbols-outlined">delete_forever</span>
            </button>
        </div>
    ` : `
        <div class="grid-card-footer">
            <button class="grid-card-btn" data-action="view">
                <span class="material-symbols-outlined">visibility</span>
                ${escapeHtml(tr("Ver Detalhes"))}
            </button>
            ${quickCopyHTML}
            ${entry.type === 'passkey' ? '' : `<button class="grid-card-btn-secondary" data-action="edit" title="${escapeHtml(tr("Editar"))}">
                <span class="material-symbols-outlined">edit</span>
            </button>`}
        </div>
    `;

    // eslint-disable-next-line no-unsanitized/property -- type/labels de tabela fixa; tags e rodapé escapados
    card.innerHTML = `
        <div class="grid-card-header">
            <div class="grid-card-icon badge-${escapeHtml(entry.type)}">
                <span class="material-symbols-outlined">${TYPE_ICONS[entry.type]}</span>
            </div>
            ${entry.favorite && !inTrash ? `<span class="material-symbols-outlined favorite-star" title="${escapeHtml(tr('Favorito'))}">star</span>` : ''}
            <div class="grid-card-type">${inTrash ? tr('Na lixeira') : TYPE_LABELS[entry.type]}</div>
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
        copyToClipboard(entry.password, tr('Senha copiada'));
        flashCopied('copy-password');
    });
    bind('copy-token', () => {
        copyToClipboard(entry.token, tr('Token copiado'));
        flashCopied('copy-token');
    });
    bind('copy-mfa', async () => {
        const mfaEntry = entry.type === 'mfa' ? entry : linkedMfaEntry;
        if (!mfaEntry) return;
        try {
            const result = await MFA.generate(mfaEntry);
            copyToClipboard(result.code, tr('Código MFA copiado'));
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

    // eslint-disable-next-line no-unsanitized/property -- ícone de tabela fixa; título e subtítulo escapados
    div.innerHTML = `
        <div class="entry-item-icon badge-${escapeHtml(entry.type)}">
            <span class="material-symbols-outlined">${TYPE_ICONS[entry.type]}</span>
        </div>
        <div class="entry-item-content">
            <h3>${escapeHtml(entry.title)}</h3>
            ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
        </div>
        ${entry.favorite && !entry.deletedAt ? `<span class="material-symbols-outlined favorite-star" title="${escapeHtml(tr('Favorito'))}">star</span>` : ''}
    `;

    div.addEventListener('click', () => selectEntry(entry));
    // Teclado: a lista é navegável com Tab e abre com Enter/Espaço
    div.tabIndex = 0;
    div.setAttribute('role', 'button');
    div.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectEntry(entry); }
    });

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
    
    const selectedElement = document.querySelector(`[data-id="${CSS.escape(String(entry.id))}"]`);
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
    const copyBtnHTML = (value, label = tr('Copiar')) => {
        copyValues.push(value);
        return `<button class="copy-btn" data-copy-idx="${copyValues.length - 1}">${label}</button>`;
    };

    let detailsHTML = `
        <div class="detail-header">
            <button class="btn-back" data-action="back">
                <span class="material-symbols-outlined">arrow_back</span>
                ${escapeHtml(tr("Voltar"))}
            </button>
        </div>
        <h2>
            <span class="detail-type-icon badge-${escapeHtml(entry.type)}"><span class="material-symbols-outlined">${TYPE_ICONS[entry.type]}</span></span>
            <span class="detail-title-text">${escapeHtml(entry.title)}</span>
            ${inTrash ? '' : `
                <button class="favorite-btn ${entry.favorite ? 'active' : ''}" data-action="toggle-favorite" title="${entry.favorite ? tr('Remover dos favoritos') : tr('Marcar como favorito')}">
                    <span class="material-symbols-outlined">star</span>
                </button>
            `}
        </h2>
        ${(entry.tags || []).length ? `<div class="detail-tags">${entry.tags.map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        ${inTrash ? `
            <div class="trash-banner">
                <span class="material-symbols-outlined">delete</span>
                ${escapeHtml(tr("Esta entrada está na lixeira desde"))} ${new Date(entry.deletedAt).toLocaleDateString(I18N.locale)} ${escapeHtml(tr("e será removida definitivamente após 30 dias."))}
            </div>
        ` : ''}
        <div class="detail-section">
    `;

    if (entry.type === 'login') {
        if (entry.url) {
            detailsHTML += `
                <div class="detail-row">
                    <span class="detail-label">${escapeHtml(tr("URL:"))}</span>
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
                    <span class="detail-label">${escapeHtml(tr("Usuário:"))}</span>
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
                    <span class="detail-label">${escapeHtml(tr("Senha:"))}</span>
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
                        <span class="detail-label">${escapeHtml(tr("2FA Vinculado:"))}</span>
                        <div class="detail-value">
                            <span class="mfa-linked-title">${escapeHtml(mfaEntry.title)}</span>
                            <span class="totp-code" id="linked-mfa-code-${escapeHtml(entry.id)}">${mfaResult.code}</span>
                            ${mfaEntry.mfaAlgorithm === 'totp' ?
                                `<div class="totp-timer" id="linked-mfa-timer-${escapeHtml(entry.id)}">${mfaResult.remaining}s</div>` :
                                ''
                            }
                            <button class="copy-btn" data-copy-live="linked-mfa-code-${escapeHtml(entry.id)}">${escapeHtml(tr("Copiar Código"))}</button>
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
                    <span class="detail-label">${escapeHtml(tr("Algoritmo:"))}</span>
                    <div class="detail-value">
                        <span>${algorithmLabel} (${escapeHtml(entry.mfaDigits || 6)} ${escapeHtml(tr("dígitos,"))} ${escapeHtml(String(entry.mfaHash || 'sha1').toUpperCase())})</span>
                    </div>
                </div>
                <div class="detail-row">
                    <span class="detail-label">${escapeHtml(tr("Código"))} ${algorithmLabel}:</span>
                    <div class="detail-value">
                        <span class="totp-code" id="mfa-code-${escapeHtml(entry.id)}">${mfaResult.code}</span>
                        ${entry.mfaAlgorithm === 'totp' ?
                            `<div class="totp-timer" id="mfa-timer-${escapeHtml(entry.id)}">${mfaResult.remaining}s</div>` :
                            `<div class="hotp-counter" id="mfa-counter-${escapeHtml(entry.id)}">${escapeHtml(tr("Contador:"))} ${escapeHtml(mfaResult.counter)}</div>`
                        }
                        <button class="copy-btn" data-copy-live="mfa-code-${escapeHtml(entry.id)}">${escapeHtml(tr("Copiar"))}</button>
                        ${entry.mfaAlgorithm === 'hotp' ?
                            `<button class="btn btn-secondary" data-action="hotp-next">${escapeHtml(tr("Próximo"))}</button>` :
                            ''
                        }
                    </div>
                </div>
            `;

            if (entry.mfaAlgorithm === 'totp') {
                detailsHTML += `
                    <div class="detail-row">
                        <span class="detail-label">${escapeHtml(tr("Período:"))}</span>
                        <div class="detail-value">
                            <span>${escapeHtml(entry.mfaPeriod || 30)} segundos</span>
                        </div>
                    </div>
                `;
            }
        }
    } else if (entry.type === 'passkey' && entry.passkey) {
        // A chave privada nunca aparece nem pode ser copiada
        const p = entry.passkey;
        const origem = { browser: tr('Navegador (extensão)'), android: tr('Android') }[p.createdBy] || p.createdBy || '';
        detailsHTML += `
            <div class="detail-row">
                <span class="detail-label">${escapeHtml(tr("Site:"))}</span>
                <div class="detail-value"><span>${escapeHtml(p.rpId)}</span></div>
            </div>`;
        if (p.userName) {
            detailsHTML += `
            <div class="detail-row">
                <span class="detail-label">${escapeHtml(tr("Usuário:"))}</span>
                <div class="detail-value">
                    <span>${escapeHtml(p.userName)}</span>
                    ${copyBtnHTML(p.userName)}
                </div>
            </div>`;
        }
        if (p.userDisplayName && p.userDisplayName !== p.userName) {
            detailsHTML += `
            <div class="detail-row">
                <span class="detail-label">${escapeHtml(tr("Nome:"))}</span>
                <div class="detail-value"><span>${escapeHtml(p.userDisplayName)}</span></div>
            </div>`;
        }
        detailsHTML += `
            <div class="detail-row">
                <span class="detail-label">${escapeHtml(tr("Criada em:"))}</span>
                <div class="detail-value"><span>${escapeHtml(entry.createdAt ? new Date(entry.createdAt).toLocaleString(I18N.locale) : '')}${origem ? ' · ' + escapeHtml(origem) : ''}</span></div>
            </div>
            <div class="detail-row">
                <span class="detail-label"></span>
                <div class="detail-value"><small>${escapeHtml(tr("A chave da passkey fica só no cofre: não pode ser vista, copiada nem editada. Para trocar, exclua e crie outra no site."))}</small></div>
            </div>`;
    } else if (entry.type === 'token') {
        if (entry.token) {
            copyValues.push(entry.token);
            const tokenIdx = copyValues.length - 1;
            detailsHTML += `
                <div class="detail-row">
                    <span class="detail-label">${escapeHtml(tr("Tipo de Token:"))}</span>
                    <div class="detail-value">
                        <span class="token-badge ${escapeHtml(entry.tokenType || 'other')}">${entry.tokenType ? escapeHtml(String(entry.tokenType).toUpperCase()) : tr('OUTRO')}</span>
                    </div>
                </div>
                <div class="detail-row">
                    <span class="detail-label">${escapeHtml(tr("Token:"))}</span>
                    <div class="detail-value token-display">
                        <div class="token-value" data-copy-idx="${tokenIdx}">${escapeHtml(entry.token)}</div>
                        <button class="copy-btn" style="margin-top: 0.5rem;" data-copy-idx="${tokenIdx}">${escapeHtml(tr("Copiar Token"))}</button>
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
                        <span class="detail-label">${escapeHtml(tr("Expiração:"))}</span>
                        <div class="detail-value">
                            <span class="${isExpired ? 'token-expired' : 'token-valid'}">
                                ${expiresDate.toLocaleDateString(I18N.locale)}
                                ${isExpired ? tr(' (Expirado)') : daysUntilExpiry > 0 ? tr(" ({0} dias restantes)", { 0: daysUntilExpiry }) : tr(' (Expira hoje)')}
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
                <span class="detail-label">${escapeHtml(tr("Notas:"))}</span>
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
                <h3>${escapeHtml(tr("Campos Personalizados"))}</h3>
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
                            ${escapeHtml(tr("Copiar"))}
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
                <h3>${escapeHtml(tr("Histórico de Senhas"))}</h3>
        `;
        [...entry.passwordHistory].reverse().forEach(hist => {
            copyValues.push(hist.password);
            const idx = copyValues.length - 1;
            const when = hist.changedAt ? new Date(hist.changedAt).toLocaleString(I18N.locale) : '';
            detailsHTML += `
                <div class="custom-field-detail">
                    <span class="custom-field-detail-label">${escapeHtml(tr("Trocada em"))} ${escapeHtml(when)}:</span>
                    <div class="custom-field-detail-value password-type" data-copy-idx="${idx}">
                        <span>${escapeHtml(hist.password)}</span>
                        <button class="custom-field-copy-btn" data-copy-idx="${idx}">
                            <span class="material-symbols-outlined">content_copy</span>
                            ${escapeHtml(tr("Copiar"))}
                        </button>
                    </div>
                </div>
            `;
        });
        detailsHTML += `</div>`;
    }

    // Anexos de arquivo (guardados cifrados dentro do cofre)
    const anexos = entryAttachments(entry);
    if (anexos.length > 0 || !inTrash) {
        detailsHTML += `
            <div class="detail-custom-fields detail-attachments">
                <h3>${escapeHtml(tr("Anexos"))}${anexos.length ? ` (${anexos.length})` : ''}</h3>
        `;
        anexos.forEach(att => {
            const quando = att.updatedAt || att.addedAt;
            const meta = [
                formatFileSize(att.size),
                quando ? new Date(quando).toLocaleDateString(I18N.locale) : '',
                att.note || ''
            ].filter(Boolean).map(escapeHtml).join(' · ');
            detailsHTML += `
                <div class="attachment-row">
                    <span class="material-symbols-outlined attachment-icon">attach_file</span>
                    <div class="attachment-info">
                        <span class="attachment-name">${escapeHtml(att.name)}</span>
                        <span class="attachment-meta" title="sha256 ${escapeHtml(att.sha256)}">${meta}</span>
                    </div>
                    <button class="custom-field-copy-btn" data-att-save="${escapeHtml(att.id)}" title="${escapeHtml(tr("Salvar uma cópia no disco"))}">
                        <span class="material-symbols-outlined">download</span>
                        ${escapeHtml(tr("Baixar"))}
                    </button>
                    ${inTrash ? '' : `
                        <button class="custom-field-copy-btn attachment-remove" data-att-remove="${escapeHtml(att.id)}" title="${escapeHtml(tr("Remover do cofre"))}">
                            <span class="material-symbols-outlined">delete</span>
                        </button>
                    `}
                </div>
            `;
        });
        if (!inTrash) {
            detailsHTML += `
                <button class="btn btn-secondary attachment-add" data-action="attach">
                    <span class="material-symbols-outlined">attach_file</span>
                    ${escapeHtml(tr("Anexar arquivo"))}
                </button>
                <p class="attachment-hint">${escapeHtml(tr("Até 1 MB por arquivo (keystore, .pem, .json, .env...). O conteúdo fica cifrado dentro do cofre e sincroniza junto."))}</p>
            `;
        }
        detailsHTML += `</div>`;
    }

    detailsHTML += inTrash ? `
        <div class="entry-actions">
            <button class="btn btn-primary" data-action="restore">
                <span class="material-symbols-outlined">restore_from_trash</span>
                ${escapeHtml(tr("Restaurar"))}
            </button>
            <button class="btn btn-danger" data-action="delete">
                <span class="material-symbols-outlined">delete_forever</span>
                ${escapeHtml(tr("Excluir definitivamente"))}
            </button>
        </div>
    ` : `
        <div class="entry-actions">
            ${entry.type === 'passkey' ? '' : `<button class="btn btn-primary" data-action="edit">${escapeHtml(tr("Editar"))}</button>`}
            <button class="btn btn-danger" data-action="delete">${escapeHtml(tr("Excluir"))}</button>
        </div>
    `;

    // eslint-disable-next-line no-unsanitized/property -- detailsHTML: dados do cofre passam por escapeHtml (auditado)
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
            const code = codeEl ? codeEl.textContent.trim() : '';
            if (code && code !== 'ERRO') copyToClipboard(code);
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
    bindAction('attach', () => attachFilesToEntry(entry.id));
    entryDetails.querySelectorAll('[data-att-save]').forEach(el => {
        el.addEventListener('click', (e) => { e.stopPropagation(); downloadAttachment(entry.id, el.dataset.attSave); });
    });
    entryDetails.querySelectorAll('[data-att-remove]').forEach(el => {
        el.addEventListener('click', (e) => { e.stopPropagation(); removeAttachment(entry.id, el.dataset.attRemove); });
    });

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
            alert(tr('Erro ao salvar favorito'));
        }
    } catch (error) {
        entry.favorite = !entry.favorite;
        alert(tr('Erro ao salvar favorito'));
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
        modalTitle.textContent = tr('Editar Entrada');
        populateForm(entry);
        loadCustomFields(entry); // Carregar custom fields
    } else {
        modalTitle.textContent = tr('Adicionar Entrada');
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
        setStatus(tr('Leitor de QR indisponivel.'), 'var(--danger, #e11d48)');
        return;
    }

    setStatus(tr('Lendo imagem...'), '');

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
                setStatus(tr('Nenhum QR code reconhecido na imagem.'), 'var(--danger, #e11d48)');
                return;
            }

            const ok = applyOtpauthToForm(result.data);
            if (ok) {
                setStatus(tr('QR code importado com sucesso!'), 'var(--success, #16a34a)');
            } else {
                setStatus(tr('QR code nao e um codigo TOTP/HOTP valido.'), 'var(--danger, #e11d48)');
            }
        } catch (e) {
            console.error('Erro ao decodificar QR:', e);
            setStatus(tr('Erro ao processar a imagem.'), 'var(--danger, #e11d48)');
        }
    };
    img.onerror = () => {
        setStatus(tr('Nao foi possivel abrir a imagem.'), 'var(--danger, #e11d48)');
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
    entryLinkedMfa.innerHTML = `<option value="">${escapeHtml(tr('Nenhum (sem 2FA)'))}</option>`;
    
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
