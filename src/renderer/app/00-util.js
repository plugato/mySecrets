// MySecrets (renderer) - Utilitários usados no carregamento (escapeHtml, ids, mensagens de erro).
// Scripts clássicos carregados em ordem pelo index.html; compartilham o escopo global.

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function escapeHtml(text) {
    // Escapa também aspas: valores podem ser interpolados dentro de atributos
    // HTML, e sem isso uma entrada maliciosa escaparia do atributo (XSS)
    return String(text ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

function showError(element, message) {
    element.textContent = message;
    element.classList.add('show');
}

function hideError(element) {
    element.classList.remove('show');
}
