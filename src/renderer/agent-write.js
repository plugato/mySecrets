// Gravação no cofre pedida por um agente (servidor MCP) e anexos de arquivo.
//
// Funções puras, sem DOM e sem Electron: o renderer usa para montar o resumo
// mostrado no diálogo de confirmação e para aplicar a gravação depois que o
// usuário aprova. Carregado como script clássico no renderer; também exporta
// via module.exports para os testes em tests/.
//
// Pedido de gravação (montado por mcp-server/core.js):
//   {
//     target:  { id?, title },          entrada a atualizar (id) ou título
//     type?:   'login' | 'token' | 'note' (só ao criar)
//     project?: 'tcg-scanner'          vira uma tag (agrupa na barra lateral)
//     tags?:   ['android', ...]
//     fields?: { username, password, url, token, tokenType, notes }
//     customFields?: [{ name, value, type: 'text' | 'password' }]
//     files?:  [{ name, mime, size, sha256, note, data(base64) }]
//   }

const AGENT_FIELD_NAMES = ['username', 'password', 'url', 'token', 'tokenType', 'notes'];
const AGENT_FIELD_LABELS = {
    username: 'usuário',
    password: 'senha',
    url: 'URL',
    token: 'token',
    tokenType: 'tipo de token',
    notes: 'notas'
};

/** "TCG Scanner" -> "tcg-scanner" (mesmo padrão das tags importadas). */
function normalizeProjectTag(project) {
    return String(project || '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 60);
}

function requestTags(req) {
    const tags = [];
    const add = (t) => {
        const v = String(t || '').trim();
        if (v && !tags.includes(v)) tags.push(v);
    };
    if (req.project) add(normalizeProjectTag(req.project));
    (req.tags || []).forEach(add);
    return tags;
}

/**
 * Acha a entrada alvo: pelo id ou, sem id, pelo título exato (sem diferenciar
 * maiúsculas). Com projeto, prefere a entrada que já tem a tag do projeto.
 * Entradas na lixeira são ignoradas.
 */
function findAgentTarget(entries, req) {
    const ativas = entries.filter(e => e && !e.deletedAt);
    const target = req.target || {};
    if (target.id) {
        return { entry: ativas.find(e => e.id === target.id) || null, byId: true };
    }
    const titulo = String(target.title || '').trim().toLowerCase();
    const mesmas = ativas.filter(e => String(e.title || '').trim().toLowerCase() === titulo);
    if (mesmas.length === 0) return { entry: null, byId: false };
    const tag = req.project ? normalizeProjectTag(req.project) : null;
    const doProjeto = tag ? mesmas.find(e => (e.tags || []).includes(tag)) : null;
    return { entry: doProjeto || mesmas[0], byId: false };
}

function inferType(req) {
    if (['login', 'token', 'note'].includes(req.type)) return req.type;
    const f = req.fields || {};
    if (f.token) return 'token';
    if (f.password || f.username) return 'login';
    return 'note';
}

/**
 * Resumo do que vai ser gravado, SEM valores secretos: só nomes de campos,
 * nomes/tamanhos/sha256 dos arquivos. É o que o diálogo de confirmação mostra.
 */
function planAgentWrite(entries, req) {
    const { entry, byId } = findAgentTarget(entries, req);
    if (byId && !entry) return { error: 'Entrada não encontrada no cofre (id informado)' };

    const fields = req.fields || {};
    const fieldNames = AGENT_FIELD_NAMES.filter(k => fields[k] !== undefined && fields[k] !== null);
    const custom = (req.customFields || []).map(cf => {
        const existente = entry && (entry.customFields || []).find(c => c.name === cf.name);
        return { name: cf.name, replaces: !!existente };
    });
    const existentes = (entry && entry.attachments) || [];
    const files = (req.files || []).map(f => ({
        name: f.name,
        size: f.size,
        sha256: f.sha256,
        replaces: existentes.some(a => a.name === f.name)
    }));

    return {
        mode: entry ? 'update' : 'new',
        entryId: entry ? entry.id : null,
        title: entry ? entry.title : String((req.target || {}).title || '').trim(),
        type: entry ? entry.type : inferType(req),
        tags: requestTags(req),
        fields: fieldNames.map(k => ({
            name: k,
            label: AGENT_FIELD_LABELS[k],
            replaces: !!(entry && entry[k])
        })),
        customFields: custom,
        files
    };
}

/**
 * Aplica o pedido em `entries` (muda o array). Devolve { entry, mode }.
 * opts.newId() gera ids; opts.now é o carimbo ISO da alteração.
 */
function applyAgentWrite(entries, req, opts = {}) {
    const newId = opts.newId || (() => Date.now().toString(36) + Math.random().toString(36).slice(2));
    const now = opts.now || new Date().toISOString();
    const plan = planAgentWrite(entries, req);
    if (plan.error) throw new Error(plan.error);

    let entry;
    if (plan.mode === 'update') {
        entry = entries.find(e => e.id === plan.entryId);
    } else {
        if (!plan.title) throw new Error('Informe o título da entrada');
        entry = {
            id: newId(),
            type: plan.type,
            title: plan.title,
            url: '',
            username: '',
            password: '',
            notes: '',
            tags: [],
            favorite: false,
            createdAt: now,
            updatedAt: now
        };
        entries.push(entry);
    }

    const fields = req.fields || {};
    AGENT_FIELD_NAMES.forEach(k => {
        if (fields[k] === undefined || fields[k] === null) return;
        const valor = String(fields[k]);
        if (k === 'password' && entry.password && entry.password !== valor) {
            entry.passwordHistory = [...(entry.passwordHistory || []), { password: entry.password, changedAt: now }].slice(-10);
        }
        entry[k] = valor;
    });

    if (Array.isArray(req.customFields) && req.customFields.length) {
        const lista = Array.isArray(entry.customFields) ? entry.customFields.map(c => ({ ...c })) : [];
        req.customFields.forEach(cf => {
            const tipo = cf.type === 'password' ? 'password' : 'text';
            const existente = lista.find(c => c.name === cf.name);
            if (existente) {
                existente.value = String(cf.value);
                existente.type = tipo;
            } else {
                lista.push({ id: newId(), name: cf.name, value: String(cf.value), type: tipo });
            }
        });
        entry.customFields = lista;
    }

    const tags = Array.isArray(entry.tags) ? [...entry.tags] : [];
    plan.tags.forEach(t => { if (!tags.includes(t)) tags.push(t); });
    entry.tags = tags;

    if (Array.isArray(req.files) && req.files.length) {
        const anexos = Array.isArray(entry.attachments) ? [...entry.attachments] : [];
        req.files.forEach(f => {
            const novo = {
                name: f.name,
                mime: f.mime || 'application/octet-stream',
                size: f.size,
                sha256: f.sha256,
                note: f.note || '',
                data: f.data
            };
            const idx = anexos.findIndex(a => a.name === f.name);
            if (idx >= 0) {
                anexos[idx] = { ...novo, id: anexos[idx].id, addedAt: anexos[idx].addedAt || now, updatedAt: now };
            } else {
                anexos.push({ ...novo, id: newId(), addedAt: now, updatedAt: now });
            }
        });
        entry.attachments = anexos;
    }

    entry.updatedAt = now;
    return { entry, mode: plan.mode };
}

/** Lista de anexos de uma entrada (cofres antigos não têm o campo). */
function entryAttachments(entry) {
    return entry && Array.isArray(entry.attachments) ? entry.attachments : [];
}

function formatFileSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} KB`;
    return `${(n / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`;
}

/** "3:59" (minutos:segundos) para o tempo restante do pedido. */
function formatRemaining(ms) {
    const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Linhas do resumo mostrado no modal de confirmação. Só nomes, tamanhos e
 * início do sha256: nunca valores nem conteúdo.
 */
function planSummary(plan) {
    const tipos = { login: 'Login', token: 'Token', note: 'Nota segura', mfa: 'MFA' };
    return {
        heading: plan.mode === 'new' ? 'Criar entrada nova' : 'Atualizar entrada existente',
        title: plan.title,
        type: tipos[plan.type] || plan.type,
        tags: plan.tags,
        fields: plan.fields.map(f => ({ name: f.label, replaces: f.replaces })),
        customFields: plan.customFields.map(c => ({ name: c.name, replaces: c.replaces })),
        files: plan.files.map(f => ({
            name: f.name,
            size: formatFileSize(f.size),
            sha256: String(f.sha256 || '').slice(0, 12),
            replaces: f.replaces
        }))
    };
}

/**
 * Controla o modal de confirmação: um pedido por vez, com prazo. Sem DOM:
 * render(state) desenha (state = null fecha o modal). Respostas possíveis:
 *   { success: true, approved: true }          clicou "Gravar no cofre"
 *   { success: true, approved: false }         clicou "Recusar"
 *   { success: true, approved: false, expired: true }   prazo acabou
 *   { success: false, cancelled: true, error }  agente cancelou
 *   { success: false, error }                  cofre bloqueado, etc.
 */
function createConfirmController({ render, now = () => Date.now(), setTimer = setInterval, clearTimer = clearInterval }) {
    let current = null;
    let total = 1;
    let timer = null;

    function state() {
        if (!current) return null;
        return {
            jobId: current.jobId,
            summary: planSummary(current.plan),
            remainingMs: Math.max(0, current.deadline - now()),
            remaining: formatRemaining(current.deadline - now()),
            position: 1,
            total: Math.max(1, total)
        };
    }

    function draw() { render(state()); }

    function finish(result) {
        if (!current) return false;
        const c = current;
        current = null;
        if (timer) { clearTimer(timer); timer = null; }
        draw();
        c.resolve(result);
        return true;
    }

    function tick() {
        if (current && now() >= current.deadline) finish({ success: true, approved: false, expired: true });
        else draw();
    }

    return {
        request(jobId, plan, deadline, pending) {
            finish({ success: false, error: 'Substituído por outro pedido' });
            total = pending || 1;
            return new Promise(resolve => {
                current = { jobId, plan, deadline, resolve };
                if (now() >= deadline) {
                    finish({ success: true, approved: false, expired: true });
                    return;
                }
                timer = setTimer(tick, 1000);
                draw();
            });
        },
        answer(approved) { return finish({ success: true, approved: approved === true }); },
        cancel(jobId) {
            if (!current || current.jobId !== jobId) return false;
            return finish({ success: false, cancelled: true, error: 'O agente cancelou o pedido. Nada foi gravado.' });
        },
        cancelAll(error) { return finish({ success: false, error }); },
        setTotal(n) { total = n || 1; if (current) draw(); },
        tick,
        active() { return current ? current.jobId : null; }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        AGENT_FIELD_NAMES,
        normalizeProjectTag,
        findAgentTarget,
        planAgentWrite,
        applyAgentWrite,
        entryAttachments,
        formatFileSize,
        formatRemaining,
        planSummary,
        createConfirmController
    };
}
