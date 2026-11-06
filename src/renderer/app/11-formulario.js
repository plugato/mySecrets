// MySecrets (renderer) - Formulário de entrada e campos personalizados.
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

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
        // Anexos: pega a versão atual (um agente pode ter anexado algo com o formulário aberto)
        const versaoAtual = currentData.find(e => e.id === editingEntry.id) || editingEntry;
        if (entryAttachments(versaoAtual).length) entry.attachments = [...versaoAtual.attachments];
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
