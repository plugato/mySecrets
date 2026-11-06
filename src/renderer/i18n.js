// Idioma da interface (pt-BR e inglês). O texto em português é a chave do
// dicionário que o processo principal entrega (src/locales/en.json).
// - tr('Texto em português', { n: 1 }): para textos montados em JS;
// - o HTML estático é traduzido aqui, no carregamento, antes de qualquer dado
//   do cofre aparecer na página (nada do usuário é "traduzido").
(function () {
    'use strict';
    const dados = (window.electronAPI && window.electronAPI.i18n) || { lang: 'pt-BR', pref: 'auto', messages: {} };
    const M = dados.messages || {};
    const tem = (k) => Object.prototype.hasOwnProperty.call(M, k);

    // locale para datas e números (toLocaleString)
    window.I18N = { lang: dados.lang, pref: dados.pref, locale: dados.lang === 'en' ? 'en-US' : 'pt-BR' };
    window.tr = function (chave, vars) {
        let s = tem(chave) ? M[chave] : chave;
        if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
        return s;
    };

    const ATRIBUTOS = ['placeholder', 'title', 'aria-label'];
    const chaves = new Set(); // textos estáticos encontrados (o teste confere que todos têm tradução)

    function traduzir(raiz) {
        const andar = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        let n = andar.currentNode;
        while (n) {
            if (n.nodeType === Node.TEXT_NODE) {
                const pai = n.parentElement;
                const texto = n.nodeValue.trim();
                if (texto && pai && !pai.closest('script, style, [data-no-i18n]') && !pai.classList.contains('material-symbols-outlined') && /[A-Za-zÀ-ú]/.test(texto)) {
                    chaves.add(texto);
                    if (tem(texto)) n.nodeValue = n.nodeValue.replace(texto, M[texto]);
                }
            } else if (!n.closest('[data-no-i18n]')) {
                for (const a of ATRIBUTOS) {
                    const v = n.getAttribute(a);
                    if (v && /[A-Za-zÀ-ú]/.test(v)) {
                        chaves.add(v);
                        if (tem(v)) n.setAttribute(a, M[v]);
                    }
                }
            }
            n = andar.nextNode();
        }
    }

    document.documentElement.lang = dados.lang;
    traduzir(document.body);
    if (tem(document.title)) document.title = M[document.title];
    window.I18N.staticKeys = () => [...chaves];
})();
