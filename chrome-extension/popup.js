// MySecrets Chrome Extension — Popup
// Toda a lógica de cofre vive no background; aqui é só tela.

// Textos: tradução do navegador (_locales/*/messages.json) com o português
// do próprio código como reserva (fora do navegador, nos testes).
function msg(chave, pt, subs) {
  const lista = subs === undefined ? [] : [].concat(subs).map(String);
  let s = '';
  try { s = (globalThis.chrome && chrome.i18n && chrome.i18n.getMessage(chave, lista)) || ''; } catch (_) { s = ''; }
  return s || pt.replace(/\$(\d)/g, (m, n) => (lista[n - 1] !== undefined ? lista[n - 1] : m));
}

// Textos fixos do popup.html: data-i18n="chave" (texto) e data-i18n-placeholder/-title
document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = msg(n.dataset.i18n, n.textContent); });
document.querySelectorAll('[data-i18n-placeholder]').forEach((n) => { n.placeholder = msg(n.dataset.i18nPlaceholder, n.placeholder); });
document.querySelectorAll('[data-i18n-title]').forEach((n) => { n.title = msg(n.dataset.i18nTitle, n.title); });

const screens = {
  pair: document.getElementById('pair-screen'),
  list: document.getElementById('list-screen'),
  error: document.getElementById('error-screen')
};

const el = (id) => document.getElementById(id);

let currentTab = null;
let entries = [];

function showScreen(name) {
  Object.values(screens).forEach((s) => { s.style.display = 'none'; });
  screens[name].style.display = 'block';
}

function ask(message) {
  return chrome.runtime.sendMessage(message);
}

// ===== Renderização =====

function renderEntries(list) {
  const container = el('entries-list');
  container.innerHTML = '';
  el('empty-state').style.display = list.length ? 'none' : 'block';
  container.style.display = list.length ? 'block' : 'none';

  for (const entry of list) {
    const item = document.createElement('div');
    item.className = 'entry-item';

    const icon = document.createElement('div');
    icon.className = 'entry-icon';
    icon.textContent = entry.hasOtp ? '🔐' : '🔑';

    const info = document.createElement('div');
    info.className = 'entry-info';
    const title = document.createElement('div');
    title.className = 'entry-title';
    title.textContent = entry.title;
    const sub = document.createElement('div');
    sub.className = 'entry-subtitle';
    sub.textContent = entry.username || entry.url || msg('noDetails', 'Sem detalhes');
    info.append(title, sub);

    const btn = document.createElement('button');
    btn.className = 'btn-autofill';
    btn.textContent = msg('fill', 'Preencher');
    btn.addEventListener('click', () => autofill(entry.id, btn));

    item.append(icon, info, btn);
    container.appendChild(item);
  }
}

function updateSiteInfo(count) {
  try {
    el('site-url').textContent = new URL(currentTab.url).hostname;
  } catch (_) {
    el('site-url').textContent = msg('tabNoSite', 'Aba sem site');
  }
  el('site-matches').textContent = count === 1 ? msg('oneEntryFound', '1 entrada encontrada') : msg('nEntriesFound', '$1 entradas encontradas', count);
  el('entries-count').textContent = count === 1 ? msg('oneEntry', '1 entrada') : msg('nEntries', '$1 entradas', count);
}

function setPairMessage(title, hint, isError = false) {
  el('pair-title').textContent = title;
  el('pair-title').style.color = isError ? '#f44336' : '';
  el('pair-hint').textContent = hint;
}

function showErrorScreen(message) {
  el('error-text').textContent = message || msg('cannotReachApp', 'Não foi possível falar com o MySecrets');
  showScreen('error');
}

// ===== Ações =====

async function autofill(id, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  const res = await ask({ type: 'autofill', id, tabId: currentTab.id, url: currentTab.url });
  if (res && res.success) {
    window.close();
  } else {
    btn.disabled = false;
    btn.textContent = msg('error', 'Erro');
    showErrorScreen(res && res.error);
  }
}

async function loadEntries() {
  const res = await ask({ type: 'find_entries_for_url', url: currentTab ? currentTab.url : '' });
  if (!res || !res.success) {
    showErrorScreen(res && res.error);
    return;
  }
  entries = res.entries || [];
  updateSiteInfo(entries.length);
  renderEntries(entries);
  showScreen('list');
  updateNeverSave();
}

// Site marcado como "Nunca neste site" na pergunta de salvar login
async function updateNeverSave() {
  const btn = el('never-save-button');
  let host = '';
  try { host = new URL(currentTab.url).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { /* página interna */ }
  const res = await ask({ type: 'get_never_save' });
  const bloqueado = !!(host && res && res.success && res.hosts.includes(host));
  btn.style.display = bloqueado ? '' : 'none';
  btn.onclick = async () => {
    await ask({ type: 'remove_never_save', host });
    updateNeverSave();
  };
}

function showStatus(status) {
  if (!status || !status.paired || status.badToken) {
    if (status && status.pairError) {
      setPairMessage(status.pairError, msg('openAndUnlock', 'Abra o MySecrets, desbloqueie o cofre e tente de novo'), true);
    } else {
      setPairMessage(msg('disconnected', 'Extensão desconectada'), msg('clickConnect', 'Clique em Conectar e permita no app MySecrets'));
    }
    el('connect-button').disabled = false;
    showScreen('pair');
    return false;
  }
  if (!status.unlocked) {
    showErrorScreen(status.error || status.message);
    return false;
  }
  return true;
}

async function initialize() {
  [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // O pareamento automático pode esperar o usuário responder no app
  setPairMessage(msg('connecting', 'Conectando ao app…'), msg('ifAsked', 'Se o MySecrets perguntar, clique em Permitir'));
  el('connect-button').disabled = true;
  showScreen('pair');

  if (showStatus(await ask({ type: 'check_status' }))) await loadEntries();
}

// ===== Eventos =====

el('connect-button').addEventListener('click', async () => {
  setPairMessage(msg('connecting', 'Conectando ao app…'), msg('ifAsked', 'Se o MySecrets perguntar, clique em Permitir'));
  el('connect-button').disabled = true;
  if (showStatus(await ask({ type: 'connect' }))) await loadEntries();
});

el('pair-button').addEventListener('click', async () => {
  const code = el('pair-code-input').value;
  if (!code) return;
  const res = await ask({ type: 'pair', code });
  if (res && res.success) {
    el('pair-code-input').value = '';
    await initialize();
  } else {
    setPairMessage((res && res.error) || 'Falha no pareamento', 'Copie o código novamente no app', true);
  }
});

el('pair-code-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') el('pair-button').click();
});

el('search-input').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  renderEntries(!q ? entries : entries.filter((entry) =>
    [entry.title, entry.username, entry.url].filter(Boolean)
      .some((f) => f.toLowerCase().includes(q))
  ));
});

el('refresh-button').addEventListener('click', () => initialize());
el('retry-button').addEventListener('click', () => initialize());

el('unpair-button').addEventListener('click', async () => {
  await ask({ type: 'unpair' });
  showStatus({ paired: false });
});

el('help-button').addEventListener('click', () => {
  const help = el('help-info');
  help.style.display = help.style.display === 'none' ? 'block' : 'none';
});

document.addEventListener('DOMContentLoaded', initialize);
