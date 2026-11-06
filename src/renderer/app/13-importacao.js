// MySecrets (renderer) - Importação (MySecrets, Bitwarden, autenticadores).
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

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
        alert(tr('Por favor, selecione um arquivo .json, .csv ou .zip.'));
        return;
    }

    // Mostrar informações do arquivo
    // eslint-disable-next-line no-unsanitized/property -- nome escapado; tamanho é número
    fileInfo.innerHTML = `
        <strong>${escapeHtml(tr("Arquivo selecionado:"))}</strong> ${escapeHtml(file.name)}<br>
        <strong>${escapeHtml(tr("Tamanho:"))}</strong> ${(file.size / 1024).toFixed(2)} KB
    `;
    fileInfo.style.display = 'block';

    readImportFile(file).then(importData => {
        if (!importData) return;

        // Validar e filtrar entradas válidas
        const validEntries = validateImportData(importData);

        if (validEntries.length === 0) {
            alert(tr('Nenhuma entrada válida encontrada no arquivo.'));
            return;
        }

        // Mostrar preview das entradas
        pendingImportEntries = validEntries;
        showImportPreview(validEntries);
        confirmImportBtn.disabled = false;
    }).catch(error => {
        console.error('Erro ao processar arquivo:', error);
        alert(tr('Erro ao ler o arquivo. Verifique se o formato está correto.'));
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
            alert(tr('Nao encontrei o data.json dentro do ZIP. Use o export do Proton Pass sem criptografia.'));
            return null;
        }
        return normalizeImportData(JSON.parse(json));
    }

    const texto = await file.text();

    if (nome.endsWith('.csv')) {
        if (!isProtonPassCsv(texto)) {
            alert(tr('CSV nao reconhecido. Por enquanto so o CSV exportado pelo Proton Pass e suportado.'));
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
            alert(tr('Este export do Proton Pass esta criptografado (PGP). Exporte novamente sem criptografia.'));
            return null;
        }
        return convertProtonPassToMySecrets(parsed, generateId);
    }

    if (parsed && Array.isArray(parsed.items)) {
        if (parsed.encrypted === true) {
            alert(tr('Este export do Bitwarden esta criptografado. Exporte novamente sem criptografia (unencrypted).'));
            return null;
        }
        return convertBitwardenToMySecrets(parsed);
    }

    alert(tr('Formato de arquivo invalido. Esperado um array de entradas ou um export do Bitwarden ou do Proton Pass.'));
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
            if (!['login', 'mfa', 'token', 'note'].includes(entry.type)) {
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
        notes: tr("Importado de autenticador externo\nIssuer: {0}\nLabel: {1}\nAlgoritmo: {2}\nDígitos: {3}\nPeríodo: {4}s", { 0: externalEntry.issuer, 1: externalEntry.label, 2: (externalEntry.algorithm || 'SHA1').toUpperCase(), 3: externalEntry.digits || 6, 4: externalEntry.period || 30 }),
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
        
        let details = [];
        if (entry.username) details.push(tr("Usuário: {0}", { 0: entry.username }));
        if (entry.url) details.push(tr("URL: {0}", { 0: entry.url }));
        if (entry.type === 'mfa' && entry.mfaSecret) {
            details.push(tr("Secret: {0}...", { 0: entry.mfaSecret.substring(0, 8) }));
        }
        
        div.innerHTML = `
            <div class="import-entry-info">
                <h4 class="import-entry-title">${escapeHtml(entry.title)}</h4>
                <p class="import-entry-details">${escapeHtml(details.join(' • '))}</p>
            </div>
            <span class="import-entry-badge">${escapeHtml(TYPE_LABELS[entry.type] || entry.type)}</span>
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
            alert(tr('Nenhuma entrada nova para importar (todas já existem).'));
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
            alert(tr("{0} entradas importadas com sucesso!", { 0: entriesToImport.length }));

            // Se não havia entradas antes, remover mensagem de boas-vindas
            if (currentData.length === entriesToImport.length) {
                welcomeMessage.style.display = 'none';
                if (entriesToImport.length > 0) {
                    selectEntry(entriesToImport[0]);
                }
            }
        } else {
            alert(tr('Erro ao salvar entradas importadas: ') + result.error);
        }
    } catch (error) {
        console.error('Erro na importação:', error);
        alert(tr('Erro ao importar entradas: ') + error.message);
    }
}
