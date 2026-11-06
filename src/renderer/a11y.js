// Acessibilidade dos modais e botões, num lugar só (sem mexer em cada modal):
// - cada .modal vira um diálogo (role, aria-modal, título como rótulo);
// - ao abrir, o foco entra no modal e o Tab fica preso nele; ao fechar, o
//   foco volta para onde estava;
// - botões só com ícone ganham aria-label (do title, ou "Fechar" no ×).
(function () {
    'use strict';

    const FOCAVEIS = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), ' +
        'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const visivel = (el) => !!el && el.isConnected && getComputedStyle(el).display !== 'none' &&
        getComputedStyle(el).visibility !== 'hidden';

    function focaveis(modal) {
        return [...modal.querySelectorAll(FOCAVEIS)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    }

    // ===== Diálogos =====

    let seq = 0;
    function prepararModal(modal) {
        if (modal.dataset.a11y) return;
        modal.dataset.a11y = '1';
        modal.setAttribute('role', modal.getAttribute('role') || 'dialog');
        modal.setAttribute('aria-modal', 'true');
        const titulo = modal.querySelector('h1, h2, h3');
        if (titulo && !modal.hasAttribute('aria-labelledby') && !modal.hasAttribute('aria-label')) {
            if (!titulo.id) titulo.id = `modal-titulo-${++seq}`;
            modal.setAttribute('aria-labelledby', titulo.id);
        }
    }

    const abertos = []; // pilha: [{ modal, voltar }]

    function aoAbrir(modal) {
        if (abertos.some((a) => a.modal === modal)) return;
        abertos.push({ modal, voltar: document.activeElement });
        // Espera o conteúdo do modal ser preenchido por quem o abriu
        setTimeout(() => {
            if (!visivel(modal) || modal.contains(document.activeElement)) return;
            const alvo = modal.querySelector('[autofocus]') ||
                focaveis(modal).find((el) => !el.classList.contains('close-btn')) || focaveis(modal)[0];
            if (alvo) alvo.focus();
            else { modal.setAttribute('tabindex', '-1'); modal.focus(); }
        }, 0);
    }

    function aoFechar(modal) {
        const i = abertos.findIndex((a) => a.modal === modal);
        if (i < 0) return;
        const [{ voltar }] = abertos.splice(i, 1);
        if (voltar && voltar.isConnected && typeof voltar.focus === 'function' && !abertos.length) {
            setTimeout(() => {
                const atual = document.activeElement;
                if (!atual || atual === document.body || modal.contains(atual)) voltar.focus();
            }, 0);
        }
    }

    function verificar(modal) {
        if (visivel(modal)) aoAbrir(modal); else aoFechar(modal);
    }

    // Tab preso no modal de cima
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab' || !abertos.length) return;
        const { modal } = abertos[abertos.length - 1];
        if (!visivel(modal)) return;
        const lista = focaveis(modal);
        if (!lista.length) { e.preventDefault(); return; }
        const primeiro = lista[0];
        const ultimo = lista[lista.length - 1];
        if (!modal.contains(document.activeElement)) { e.preventDefault(); primeiro.focus(); return; }
        if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    }, true);

    // ===== Botões só com ícone =====

    function rotular(btn) {
        if (btn.hasAttribute('aria-label')) return;
        const texto = btn.textContent.replace(/\s+/g, ' ').trim();
        if (btn.classList.contains('close-btn') || texto === '×') { btn.setAttribute('aria-label', tr('Fechar')); return; }
        const soIcone = [...btn.childNodes].every((n) =>
            (n.nodeType === 3 && !n.textContent.trim()) ||
            (n.nodeType === 1 && n.classList.contains('material-symbols-outlined')));
        if (soIcone && btn.title) btn.setAttribute('aria-label', btn.title);
        // Ícone dentro de botão com texto: o leitor de tela não precisa ler o nome do ícone
        btn.querySelectorAll('.material-symbols-outlined').forEach((i) => i.setAttribute('aria-hidden', 'true'));
    }

    function varrer(raiz) {
        if (raiz.nodeType !== 1) return;
        if (raiz.matches('.modal')) prepararModal(raiz);
        if (raiz.matches('button')) rotular(raiz);
        raiz.querySelectorAll('.modal').forEach(prepararModal);
        raiz.querySelectorAll('button').forEach(rotular);
    }

    function iniciar() {
        varrer(document.body);
        new MutationObserver((mudancas) => {
            for (const m of mudancas) {
                if (m.type === 'childList') m.addedNodes.forEach(varrer);
                else if (m.target.classList && m.target.classList.contains('modal')) verificar(m.target);
            }
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
        document.querySelectorAll('.modal').forEach(verificar);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();
