// MySecrets (renderer) - Busca, filtros, contadores, tags e saúde das senhas.
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

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
            (Array.isArray(entry.tags) && entry.tags.some(t => String(t).toLowerCase().includes(query))) ||
            entryAttachments(entry).some(a => String(a.name).toLowerCase().includes(query))
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
        entriesCount.textContent = total === 1 ? tr('1 entrada') : tr('{0} entradas', { 0: total });
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
            // eslint-disable-next-line no-unsanitized/property -- count é número
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

// ===== Senhas vazadas (Have I Been Pwned) =====
// Só os 5 primeiros caracteres do SHA-1 de cada senha saem do computador; a
// comparação é feita aqui. Roda só quando a pessoa pede. Resultado só em
// memória (apagado ao bloquear).
let pwnedState = null; // { checkedAt, hashByPassword: Map, counts: Map(hash -> n), error }
let pwnedRunning = false;

async function sha1Hex(texto) {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(texto));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function parsePwnedRange(texto) {
    const out = new Map();
    for (const linha of String(texto).split(/\r?\n/)) {
        const m = /^([0-9A-Fa-f]{35}):(\d+)$/.exec(linha.trim());
        if (m) out.set(m[1].toUpperCase(), parseInt(m[2], 10));
    }
    return out;
}

/**
 * Verifica as senhas do cofre. fetchRange(prefixo) -> { success, text } (o
 * padrão é o IPC do app; os testes passam outro).
 */
async function checkPwnedPasswords(fetchRange = (p) => window.electronAPI.pwnedRange(p)) {
    const senhas = [...new Set(activeData().filter((e) => e.password).map((e) => e.password))];
    const hashByPassword = new Map();
    for (const pw of senhas) hashByPassword.set(pw, await sha1Hex(pw));
    const porPrefixo = new Map();
    for (const h of hashByPassword.values()) {
        const pre = h.slice(0, 5);
        if (!porPrefixo.has(pre)) porPrefixo.set(pre, []);
        porPrefixo.get(pre).push(h);
    }
    const counts = new Map();
    const prefixos = [...porPrefixo.keys()];
    let erro = null;
    // Algumas consultas ao mesmo tempo, não todas de uma vez
    for (let i = 0; i < prefixos.length; i += 4) {
        const lote = prefixos.slice(i, i + 4);
        const respostas = await Promise.all(lote.map((pre) => fetchRange(pre).catch((e) => ({ success: false, error: e.message }))));
        respostas.forEach((r, k) => {
            if (!r || !r.success) { erro = (r && r.error) || tr('Falha na consulta'); return; }
            const sufixos = parsePwnedRange(r.text);
            for (const h of porPrefixo.get(lote[k])) counts.set(h, sufixos.get(h.slice(5)) || 0);
        });
    }
    return { checkedAt: new Date().toISOString(), hashByPassword, counts, error: erro };
}

/** Entradas cuja senha apareceu em vazamentos, com a contagem. */
function pwnedEntries() {
    if (!pwnedState) return { leaked: [], unchecked: 0 };
    const leaked = [];
    let unchecked = 0;
    activeData().filter((e) => e.password).forEach((e) => {
        const h = pwnedState.hashByPassword.get(e.password);
        if (!h || !pwnedState.counts.has(h)) { unchecked++; return; }
        const n = pwnedState.counts.get(h);
        if (n > 0) leaked.push({ ...e, pwnedCount: n });
    });
    return { leaked, unchecked };
}

async function runPwnedCheck() {
    if (pwnedRunning) return;
    pwnedRunning = true;
    renderHealthOverview();
    try {
        pwnedState = await checkPwnedPasswords();
    } catch (error) {
        pwnedState = { checkedAt: new Date().toISOString(), hashByPassword: new Map(), counts: new Map(), error: error.message };
    } finally {
        pwnedRunning = false;
        renderHealthOverview();
    }
}

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

    const { leaked } = pwnedEntries();
    const uniqueIssueIds = new Set([...reused, ...weak, ...old, ...leaked].map(e => e.id));

    return { reused, reusedGroups, weak, old, leaked, total: uniqueIssueIds.size };
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
            html += `<div class="health-ok"><span class="material-symbols-outlined">check_circle</span> ${escapeHtml(tr("Tudo certo por aqui!"))}</div>`;
        } else {
            html += '<div class="health-items">';
            entries.forEach(e => {
                html += `
                    <button class="health-item" data-entry-id="${escapeHtml(e.id)}">
                        <span class="material-symbols-outlined">key</span>
                        <span class="health-item-title">${escapeHtml(e.title)}</span>
                        <span class="health-item-subtitle">${escapeHtml(e.pwnedCount ? tr('Apareceu {0} vez(es) em vazamentos', { 0: e.pwnedCount.toLocaleString(I18N.locale) }) : (e.username || e.url || ''))}</span>
                        <span class="material-symbols-outlined health-item-arrow">chevron_right</span>
                    </button>
                `;
            });
            html += '</div>';
        }
        html += '</div>';
        return html;
    };

    // Seção de vazamentos: só depois que a pessoa pede a verificação
    const { unchecked } = pwnedEntries();
    const pwnedDesc = tr('Senhas que aparecem em vazamentos públicos (Have I Been Pwned). Só os 5 primeiros caracteres do hash SHA-1 de cada senha saem do computador; a senha nunca é enviada.');
    let pwnedHTML;
    if (!pwnedState) {
        pwnedHTML = `
            <div class="health-section health-danger">
                <div class="health-section-header">
                    <span class="material-symbols-outlined">travel_explore</span>
                    <h3>${escapeHtml(tr("Senhas vazadas"))}</h3>
                </div>
                <p class="health-description">${pwnedDesc}</p>
                <button class="btn btn-primary" id="pwned-check-btn" ${pwnedRunning ? 'disabled' : ''}>${pwnedRunning ? tr('Verificando…') : tr('Verificar vazamentos')}</button>
            </div>`;
    } else {
        pwnedHTML = sectionHTML(tr('Senhas vazadas'), 'travel_explore', 'health-danger', issues.leaked,
            escapeHtml(pwnedDesc) + (pwnedState.error ? ` <strong>${escapeHtml(tr("Verificação incompleta:"))} ${escapeHtml(pwnedState.error)}</strong>` : '') +
            (unchecked ? tr(" {0} senha(s) nova(s) ainda não verificada(s).", { 0: unchecked }) : '') +
            ` <button class="btn btn-secondary" id="pwned-check-btn" ${pwnedRunning ? 'disabled' : ''}>${pwnedRunning ? tr('Verificando…') : tr('Verificar de novo')}</button>`);
    }

    // eslint-disable-next-line no-unsanitized/property -- números e sectionHTML (escapa os dados das entradas)
    healthOverview.innerHTML = `
        <div class="health-header">
            <h2>${escapeHtml(tr("Saúde das Senhas"))}</h2>
            <p>${totalWithPassword} ${escapeHtml(tr("senha(s) analisada(s) —"))} ${issues.total} ${escapeHtml(tr("com algum problema"))}</p>
        </div>
        ${pwnedHTML}
        ${sectionHTML(tr('Senhas reutilizadas'), 'content_copy', 'health-danger', issues.reused,
            tr('A mesma senha usada em mais de uma conta: se uma vazar, todas ficam expostas.'))}
        ${sectionHTML(tr('Senhas fracas'), 'warning', 'health-warning', issues.weak,
            tr('Senhas curtas ou com pouca variedade de caracteres. Use o gerador para trocá-las.'))}
        ${sectionHTML(tr('Senhas antigas'), 'history', 'health-info', issues.old,
            tr("Sem alteração há mais de {0} dias. Considere renová-las.", { 0: HEALTH_OLD_DAYS }))}
    `;

    const pwnedBtn = document.getElementById('pwned-check-btn');
    if (pwnedBtn) pwnedBtn.addEventListener('click', runPwnedCheck);

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
            tr('Nenhuma entrada encontrada para sua pesquisa') : 
            tr('Nenhuma entrada nesta categoria');
        // eslint-disable-next-line no-unsanitized/property -- mensagem constante
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
        const selectedElement = document.querySelector(`[data-id="${CSS.escape(String(selectedEntry.id))}"]`);
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
