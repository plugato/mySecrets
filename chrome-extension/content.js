// MySecrets Chrome Extension - Content Script
// Detecta e preenche campos de formulários

// Logs de diagnóstico desligados: o console do content script aparece no
// DevTools de qualquer site. Nunca registre valores (senha, código, entrada).
const DEBUG = false;
function debug(...args) { if (DEBUG) console.log('[MySecrets]', ...args); }

debug('content script carregado');

// Extensão recarregada/atualizada com a página aberta: este script fica órfão
// e qualquer chamada ao chrome.runtime lança "Extension context invalidated".
// Nesse caso ele se desliga em silêncio; recarregar a página traz o novo.
function sendToBackground(message, callback) {
  if (!chrome.runtime?.id) return shutdown();
  try {
    chrome.runtime.sendMessage(message, callback);
  } catch (_) {
    shutdown();
  }
}

function shutdown() {
  if (typeof observer !== 'undefined') observer.disconnect();
  document.getElementById('mysecrets-autofill-button')?.remove();
}

// ===== Detectores de Campos =====

/**
 * Encontra campos de usuário/email na página
 */
function findUsernameFields() {
  const selectors = [
    'input[type="email"]',
    'input[type="text"][name*="user" i]',
    'input[type="text"][name*="email" i]',
    'input[type="text"][id*="user" i]',
    'input[type="text"][id*="email" i]',
    'input[type="text"][placeholder*="email" i]',
    'input[type="text"][placeholder*="usuário" i]',
    'input[type="text"][autocomplete="username"]',
    'input[type="text"][autocomplete="email"]'
  ];
  
  const fields = [];
  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(field => {
      if (!fields.includes(field) && isVisible(field) && !isMfaField(field)) {
        fields.push(field);
      }
    });
  });
  
  return fields;
}

/**
 * Encontra campos de senha na página
 */
function findPasswordFields() {
  const fields = Array.from(document.querySelectorAll('input[type="password"]'))
    .filter(field => isVisible(field));
  return fields;
}

/**
 * Verifica se um elemento está visível
 */
function isVisible(element) {
  if (!element) return false;
  
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && 
         style.visibility !== 'hidden' && 
         style.opacity !== '0' &&
         element.offsetWidth > 0 &&
         element.offsetHeight > 0;
}

/**
 * Encontra o formulário de login na página
 */
function findLoginForm() {
  const usernameFields = findUsernameFields();
  const passwordFields = findPasswordFields();

  // Login de duas etapas mostra um campo por página (usuário, depois senha,
  // depois o código 2FA), então aceita formulário parcial.
  if (usernameFields.length === 0 && passwordFields.length === 0) {
    return null;
  }
  
  // Encontra o formulário que contém ambos os campos
  for (const username of usernameFields) {
    for (const password of passwordFields) {
      const usernameForm = username.form || username.closest('form');
      const passwordForm = password.form || password.closest('form');
      
      if (usernameForm && usernameForm === passwordForm) {
        return {
          form: usernameForm,
          usernameField: username,
          passwordField: password
        };
      }
    }
  }
  
  // Se não encontrou formulário comum, usa os primeiros campos disponíveis
  return {
    form: null,
    usernameField: usernameFields[0] || null,
    passwordField: passwordFields[0] || null
  };
}

// ===== Preenchimento de Campos =====

/**
 * Preenche um campo de input
 */
function fillField(field, value) {
  if (!field || !value) return false;
  
  try {
    // Foca no campo
    field.focus();
    
    // Define o valor
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;
    nativeInputValueSetter.call(field, value);
    
    // Dispara eventos para notificar frameworks (React, Vue, etc.)
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Remove foco
    field.blur();
    
    return true;
  } catch (error) {
    console.error('[MySecrets] Erro ao preencher campo:', error && error.message);
    return false;
  }
}

/**
 * Preenche formulário com dados da entrada
 */
function fillLoginForm(entry) {
  // Na segunda etapa do 2FA a página costuma ter só o campo do código: não há
  // formulário de login para achar, mas ainda há o que preencher.
  const loginForm = findLoginForm() || { form: null, usernameField: null, passwordField: null };

  if (!loginForm.usernameField && !loginForm.passwordField && !entry.mfaCode) {
    console.warn('Nenhum formulário de login encontrado');
    showNotification('Nenhum formulário encontrado nesta página', 'warning');
    return false;
  }
  
  let filled = false;
  
  // Preenche usuário/email
  if (loginForm.usernameField && entry.username) {
    if (fillField(loginForm.usernameField, entry.username)) {
      debug('Campo de usuário preenchido');
      filled = true;
    }
  }
  
  // Preenche senha
  if (loginForm.passwordField && entry.password) {
    if (fillField(loginForm.passwordField, entry.password)) {
      debug('Campo de senha preenchido');
      filled = true;
    }
  }
  
  // Preenche campo MFA/2FA se existir código
  if (entry.mfaCode) {
    debug('entrada tem código MFA');
    const mfaField = findMfaField();
    if (mfaField) {
      debug('campo MFA encontrado');
      if (fillField(mfaField, entry.mfaCode)) {
        debug('✅ Campo 2FA preenchido com código MFA');
        highlightField(mfaField);
        filled = true;
      }
    } else {
      debug('❌ Código MFA disponível mas campo 2FA não encontrado na página');
      debug('📝 Verifique se o campo está visível e não está em iframe');
    }
  } else {
    debug('ℹ️ Entry não tem código MFA vinculado');
  }
  
  // Preenche custom fields
  if (entry.customFields && Array.isArray(entry.customFields)) {
    const customFieldsFilled = fillCustomFields(entry.customFields);
    if (customFieldsFilled > 0) {
      debug(`${customFieldsFilled} custom fields preenchidos`);
      filled = true;
    }
  }
  
  if (filled) {
    const onlyMfa = !loginForm.usernameField && !loginForm.passwordField;
    const msg = onlyMfa
      ? `Código 2FA preenchido: ${entry.title}`
      : (entry.mfaCode ? `Preenchido com: ${entry.title} + 2FA` : `Preenchido com: ${entry.title}`);
    showNotification(msg, 'success');
    
    // Destaca os campos preenchidos
    highlightField(loginForm.usernameField);
    highlightField(loginForm.passwordField);
  }
  
  return filled;
}

/**
 * Detecta campo de MFA/2FA na página
 * Procura por campos com nomes comuns de autenticação de dois fatores
 */
const MFA_SELECTORS = [
  'input[autocomplete="one-time-code"]',
  'input[name*="2fa" i]', 'input[name*="2factor" i]', 'input[name*="mfa" i]',
  'input[name*="otp" i]', 'input[name*="totp" i]', 'input[name*="verification" i]',
  'input[name*="code" i]', 'input[name*="token" i]', 'input[name*="authenticator" i]',
  'input[id*="2fa" i]', 'input[id*="2factor" i]', 'input[id*="mfa" i]',
  'input[id*="otp" i]', 'input[id*="totp" i]', 'input[id*="verification" i]',
  'input[id*="code" i]', 'input[id*="authenticator" i]',
  'input[placeholder*="code" i]', 'input[placeholder*="código" i]',
  'input[placeholder*="verification" i]', 'input[placeholder*="authenticator" i]',
  'input[aria-label*="code" i]', 'input[aria-label*="verification" i]',
  'input[aria-label*="authenticator" i]'
];
const MFA_TYPES = ['text', 'password', 'number', 'tel'];

function isMfaField(field) {
  return MFA_SELECTORS.some((sel) => field.matches(sel));
}

function findMfaField() {
  for (const selector of MFA_SELECTORS) {
    for (const field of document.querySelectorAll(selector)) {
      if (isVisible(field) && MFA_TYPES.includes(field.type)) return field;
    }
  }
  return null;
}

/**
 * Preenche custom fields no formulário
 * Tenta fazer match de campos baseado em name, id, placeholder, label
 */
function fillCustomFields(customFields) {
  let filledCount = 0;
  
  customFields.forEach(field => {
    const fieldName = field.name.toLowerCase();
    const fieldValue = field.value;
    
    if (!fieldValue) return;
    
    // Tentar encontrar campo por vários critérios
    const selectors = [
      `input[name*="${fieldName}" i]`,
      `input[id*="${fieldName}" i]`,
      `input[placeholder*="${fieldName}" i]`,
      `input[aria-label*="${fieldName}" i]`
    ];
    
    // Também buscar por labels associados
    const labels = Array.from(document.querySelectorAll('label'));
    labels.forEach(label => {
      if (label.textContent.toLowerCase().includes(fieldName)) {
        const forAttr = label.getAttribute('for');
        if (forAttr) {
          selectors.push(`input#${forAttr}`);
        }
      }
    });
    
    // Tentar preencher com cada seletor
    for (const selector of selectors) {
      try {
        const inputs = document.querySelectorAll(selector);
        inputs.forEach(input => {
          if (isVisible(input) && !input.value) {
            // Determinar tipo de input baseado no custom field type
            if (field.type === 'password') {
              input.type = 'password';
            }
            
            if (fillField(input, fieldValue)) {
              highlightField(input);
              filledCount++;
              debug(`Custom field "${field.name}" preenchido`);
            }
          }
        });
        
        if (filledCount > 0) break; // Se preencheu, não tentar outros seletores
      } catch (e) {
        // Seletor inválido, ignorar
      }
    }
  });
  
  return filledCount;
}

/**
 * Destaca um campo temporariamente
 */
function highlightField(field) {
  if (!field) return;
  
  const originalBorder = field.style.border;
  const originalBoxShadow = field.style.boxShadow;
  
  field.style.border = '2px solid #4CAF50';
  field.style.boxShadow = '0 0 5px rgba(76, 175, 80, 0.5)';
  
  setTimeout(() => {
    field.style.border = originalBorder;
    field.style.boxShadow = originalBoxShadow;
  }, 2000);
}

// ===== Notificações =====

/**
 * Mostra notificação na página
 */
function showNotification(message, type = 'info') {
  // Remove notificação anterior se existir
  const existing = document.getElementById('mysecrets-notification');
  if (existing) {
    existing.remove();
  }
  
  const notification = document.createElement('div');
  notification.id = 'mysecrets-notification';
  notification.textContent = message;
  
  const colors = {
    success: '#4CAF50',
    warning: '#FF9800',
    error: '#F44336',
    info: '#2196F3'
  };
  
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${colors[type] || colors.info};
    color: white;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    animation: mysecrets-slide-in 0.3s ease-out;
  `;
  
  // Adiciona animação
  const style = document.createElement('style');
  style.textContent = `
    @keyframes mysecrets-slide-in {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(notification);
  
  // Remove após 3 segundos
  setTimeout(() => {
    notification.style.animation = 'mysecrets-slide-in 0.3s ease-out reverse';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

/**
 * Mostra botão de autofill quando detecta formulário
 */
function showAutofillButton(count) {
  // Remove botão anterior se existir
  const existing = document.getElementById('mysecrets-autofill-button');
  if (existing) {
    existing.remove();
  }
  
  // Senha, ou só o código na segunda etapa do 2FA (GitLab, etc.)
  const loginForm = findLoginForm();
  const target = (loginForm && loginForm.passwordField) || findMfaField();
  if (!target) return;
  
  const button = document.createElement('button');
  button.id = 'mysecrets-autofill-button';
  // eslint-disable-next-line no-unsanitized/property -- count é número
  button.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
    </svg>
    <span>${count} ${count === 1 ? 'entrada' : 'entradas'}</span>
  `;
  
  button.style.cssText = `
    position: absolute;
    padding: 6px 12px;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
    z-index: 999998;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    transition: background 0.2s;
  `;
  
  button.onmouseenter = () => button.style.background = '#1976D2';
  button.onmouseleave = () => button.style.background = '#2196F3';
  
  button.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Solicita autofill ao background script
    sendToBackground({ 
      type: 'find_entries_for_url',
      url: window.location.href
    }, (response) => {
      if (response.success && response.entries.length > 0) {
        if (response.entries.length === 1) {
          requestFill(response.entries[0].id);
        } else {
          // Abre popup para escolher
          showEntrySelector(response.entries);
        }
      }
    });
  };
  
  document.body.appendChild(button);

  // Dentro do campo de senha, no canto direito: acima dele ficava embaixo do
  // menu nativo de senhas do Chrome (aberto no campo de usuário).
  const rect = target.getBoundingClientRect();
  button.style.height = `${Math.max(18, Math.min(26, rect.height - 8))}px`;
  button.style.padding = '0 8px';
  const left = rect.right - button.offsetWidth - 4;
  button.style.top = `${rect.top + window.scrollY + (rect.height - button.offsetHeight) / 2}px`;
  button.style.left = `${left + window.scrollX}px`;
}

/**
 * A lista traz só título/usuário: senha e 2FA vêm do background na hora
 * (mesmo caminho do popup), que responde com um 'fill_fields'.
 */
function requestFill(id) {
  sendToBackground({ type: 'autofill', id, url: window.location.href }, (response) => {
    if (!response?.success) {
      showNotification(response?.error || 'Falha ao preencher', 'error');
    }
  });
}

/**
 * Mostra seletor de entradas quando há múltiplas
 */
function showEntrySelector(entries) {
  // Remove seletor anterior se existir
  const existing = document.getElementById('mysecrets-entry-selector');
  if (existing) {
    existing.remove();
  }
  
  const selector = document.createElement('div');
  selector.id = 'mysecrets-entry-selector';
  
  selector.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 999999;
    max-width: 400px;
    width: 90%;
    max-height: 400px;
    overflow-y: auto;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;
  
  const header = document.createElement('div');
  header.textContent = 'Escolha uma entrada';
  header.style.cssText = `
    padding: 16px;
    border-bottom: 1px solid #e0e0e0;
    font-size: 16px;
    font-weight: 600;
    color: #333;
  `;
  
  selector.appendChild(header);
  
  entries.forEach(entry => {
    const item = document.createElement('div');
    item.style.cssText = `
      padding: 12px 16px;
      cursor: pointer;
      border-bottom: 1px solid #f0f0f0;
      transition: background 0.2s;
    `;
    
    item.onmouseenter = () => item.style.background = '#f5f5f5';
    item.onmouseleave = () => item.style.background = 'white';
    
    const title = document.createElement('div');
    title.textContent = entry.title;
    title.style.cssText = 'font-weight: 500; margin-bottom: 4px;';
    
    const username = document.createElement('div');
    username.textContent = entry.username || 'Sem usuário';
    username.style.cssText = 'font-size: 12px; color: #666;';
    
    item.appendChild(title);
    item.appendChild(username);
    
    item.onclick = () => {
      requestFill(entry.id);
      selector.remove();
      backdrop.remove();
    };
    
    selector.appendChild(item);
  });
  
  // Adiciona backdrop
  const backdrop = document.createElement('div');
  backdrop.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 999998;
  `;
  backdrop.onclick = () => {
    selector.remove();
    backdrop.remove();
  };
  
  document.body.appendChild(backdrop);
  document.body.appendChild(selector);
}

// ===== Message Handlers =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debug('mensagem recebida:', message && message.type);
  
  switch (message.type) {
    case 'fill_fields': {
      const success = fillLoginForm(message.entry);
      sendResponse({ success });
      break;
    }
      
    case 'entries_available':
      // Mostra botão de autofill
      if (message.count > 0) {
        showAutofillButton(message.count);
      }
      sendResponse({ success: true });
      break;
      
    case 'show_save_prompt':
      showSavePrompt(message.prompt);
      sendResponse({ success: true });
      break;

    case 'detect_fields': {
      const loginForm = findLoginForm();
      sendResponse({
        success: true,
        hasForm: !!loginForm,
        fields: {
          username: !!loginForm?.usernameField,
          password: !!loginForm?.passwordField
        }
      });
      break;
    }

    default:
      sendResponse({ success: false, error: 'Tipo de mensagem desconhecido' });
  }
  
  return true;
});

// ===== Oferecer para salvar logins =====
//
// Quando um formulário com senha é enviado, manda usuário e senha ao background,
// que decide se o login é novo (ou se a senha mudou). A pergunta aparece nesta
// página ou na próxima, depois do redirecionamento do login.

let lastSubmitted = '';

function passwordFieldsIn(scope) {
  return Array.from((scope || document).querySelectorAll('input[type="password"]'))
    .filter(f => f.value && isVisible(f));
}

function captureLogin(scope) {
  const form = scope && scope.tagName === 'FORM' ? scope : (scope && scope.closest ? scope.closest('form') : null);
  const doForm = form ? passwordFieldsIn(form) : [];
  const passwords = doForm.length ? doForm : passwordFieldsIn(null);
  if (passwords.length === 0) return;

  // Troca de senha / cadastro: o último campo é a senha nova (ou a confirmação)
  const password = passwords[passwords.length - 1].value;

  const candidatos = findUsernameFields().filter(f => f.value && (!form || form.contains(f)));
  const username = candidatos.length ? candidatos[0].value.trim() : '';

  const chave = username + '\u0000' + password;
  if (chave === lastSubmitted) return; // submit + clique no mesmo envio
  lastSubmitted = chave;

  sendToBackground({ type: 'login_submitted', url: window.location.href, username, password });
}

document.addEventListener('submit', (e) => captureLogin(e.target), true);

// SPAs costumam logar sem submit: clique no botão ou Enter no campo
document.addEventListener('click', (e) => {
  const botao = e.target.closest && e.target.closest('button, input[type="submit"], input[type="button"], [role="button"]');
  if (botao) captureLogin(botao);
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') captureLogin(e.target);
}, true);

// Login em duas etapas: guarda o usuário digitado na primeira tela
document.addEventListener('change', (e) => {
  const campo = e.target;
  if (campo && campo.tagName === 'INPUT' && campo.value && findUsernameFields().includes(campo)) {
    sendToBackground({ type: 'remember_username', url: window.location.href, username: campo.value.trim() });
  }
}, true);

function showSavePrompt(prompt) {
  if (!prompt || document.getElementById('mysecrets-save-prompt')) return;

  const host = document.createElement('div');
  host.id = 'mysecrets-save-prompt';
  host.style.cssText = 'position: fixed; top: 16px; right: 16px; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'closed' });

  const atualizar = prompt.mode === 'update';
  root.innerHTML = `
    <style>
      .card { width: 320px; box-sizing: border-box; padding: 14px 16px; border-radius: 12px;
        background: #fff; color: #1d1d1f; box-shadow: 0 8px 28px rgba(0,0,0,.22);
        font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        animation: entrar .25s ease-out; }
      @media (prefers-color-scheme: dark) { .card { background: #1f2024; color: #ececec; } .sub { color: #a0a4ab !important; } }
      @keyframes entrar { from { transform: translateY(-12px); opacity: 0; } to { transform: none; opacity: 1; } }
      .topo { display: flex; gap: 10px; align-items: center; }
      img { width: 28px; height: 28px; border-radius: 6px; }
      .titulo { font-weight: 600; }
      .sub { color: #5f6368; font-size: 13px; margin-top: 2px; word-break: break-all; }
      .acoes { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
      button { font: inherit; border: 0; border-radius: 8px; padding: 7px 14px; cursor: pointer; }
      .salvar { background: #5b5bd6; color: #fff; font-weight: 600; }
      .depois { background: rgba(127,127,127,.15); color: inherit; }
      .nunca { background: none; color: inherit; opacity: .7; padding: 7px 4px; margin-left: auto; font-size: 12px; text-decoration: underline; }
    </style>
    <div class="card" role="dialog" aria-label="MySecrets">
      <div class="topo">
        <img alt="">
        <div>
          <div class="titulo"></div>
          <div class="sub"></div>
        </div>
      </div>
      <div class="acoes">
        <button class="salvar"></button>
        <button class="depois">Agora não</button>
        <button class="nunca">Nunca neste site</button>
      </div>
    </div>`;

  root.querySelector('img').src = chrome.runtime.getURL('icons/icon48.png');
  root.querySelector('.titulo').textContent = atualizar ? 'Atualizar a senha no MySecrets?' : 'Salvar este login no MySecrets?';
  root.querySelector('.sub').textContent = atualizar
    ? `${prompt.title || prompt.host}${prompt.username ? ' · ' + prompt.username : ''}`
    : `${prompt.username || '(sem usuário)'} · ${prompt.host}`;
  root.querySelector('.salvar').textContent = atualizar ? 'Atualizar' : 'Salvar';

  const fechar = () => host.remove();
  const decidir = (action) => {
    fechar();
    sendToBackground({ type: 'save_decision', action }, (response) => {
      if (action !== 'save') return;
      if (response && response.success && response.saved) {
        showNotification(atualizar ? 'Senha atualizada no MySecrets' : 'Login salvo no MySecrets', 'success');
      } else {
        showNotification('Não foi possível salvar: ' + ((response && response.error) || 'app indisponível'), 'error');
      }
    });
  };

  root.querySelector('.salvar').addEventListener('click', () => decidir('save'));
  root.querySelector('.depois').addEventListener('click', () => decidir('dismiss'));
  root.querySelector('.nunca').addEventListener('click', () => decidir('never'));
  setTimeout(fechar, 60000);

  document.documentElement.appendChild(host);
}

// ===== Inicialização =====

// Detecta formulários ao carregar
// document_idle costuma injetar este script depois do 'load' em página estática
// (ex.: tela do código 2FA do GitLab): aí o evento nunca viria.
function detectOnLoad() {
  debug('Página carregada, detectando formulários...');

  // Login enviado na página anterior (antes do redirecionamento) esperando resposta
  sendToBackground({ type: 'get_pending_save' }, (response) => {
    if (response?.success && response.prompt) showSavePrompt(response.prompt);
  });
  
  if (findLoginForm() || findMfaField()) {
    debug('Formulário de login detectado');
    
    // Notifica background script
    sendToBackground({
      type: 'find_entries_for_url',
      url: window.location.href
    }, (response) => {
      if (response?.success && response.entries.length > 0) {
        showAutofillButton(response.entries.length);
      }
    });
  }
}

if (document.readyState === 'complete') {
  detectOnLoad();
} else {
  window.addEventListener('load', detectOnLoad);
}

// Observa mudanças no DOM (para SPAs)
// Com debounce para evitar loops
let mutationTimeout = null;
let lastCheckTime = 0;
let lastFormFound = false;

const observer = new MutationObserver(() => {
  // Debounce: só verifica 500ms após a última mudança
  clearTimeout(mutationTimeout);
  
  mutationTimeout = setTimeout(() => {
    const now = Date.now();
    
    // Rate limit: não verifica mais de uma vez a cada 2 segundos
    if (now - lastCheckTime < 2000) {
      return;
    }
    
    lastCheckTime = now;
    const hasForm = !!(findLoginForm() || findMfaField());
    
    // Só envia mensagem se o estado mudou (formulário apareceu/desapareceu)
    if (hasForm && !lastFormFound) {
      debug('Novo formulário detectado via MutationObserver');
      lastFormFound = true;
      
      sendToBackground({
        type: 'find_entries_for_url',
        url: window.location.href
      }, (response) => {
        if (response?.success && response.entries.length > 0) {
          showAutofillButton(response.entries.length);
        }
      });
    } else if (!hasForm && lastFormFound) {
      // Formulário foi removido
      lastFormFound = false;
      document.getElementById('mysecrets-autofill-button')?.remove();
    }
  }, 500);
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

debug('MySecrets Content Script pronto');

