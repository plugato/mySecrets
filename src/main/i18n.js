/**
 * MySecrets - Idioma (pt-BR e inglês).
 *
 * O texto em português é a chave: src/locales/en.json mapeia "texto em
 * português" -> "English text". Sem tradução, fica o português.
 * Marcadores: "Copiado {n}" com { n: 3 }.
 *
 * A preferência ("auto", "pt-BR" ou "en") fica em userData/language.json
 * (instalações anteriores aos idiomas ficam em "pt-BR"). O
 * renderer recebe o dicionário pelo preload (i18n-get) e usa tr(); o
 * processo principal usa t() nos diálogos e menus.
 */

const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

const LOCALES = { en: require('../locales/en.json') };
const PREFS = ['auto', 'pt-BR', 'en'];

let deps = { userDataPath: null, onChange: () => {} };
let atual = null;

const prefPath = () => path.join(deps.userDataPath, 'language.json');

function readPref() {
  try {
    const p = JSON.parse(fs.readFileSync(prefPath(), 'utf8')).language;
    return PREFS.includes(p) ? p : 'auto';
  } catch (_) {
    return 'auto';
  }
}

function resolve(pref) {
  if (pref === 'pt-BR' || pref === 'en') return pref;
  const sistema = (app.getPreferredSystemLanguages()[0] || app.getLocale() || '').toLowerCase();
  return sistema.startsWith('pt') ? 'pt-BR' : 'en';
}

function lang() {
  if (!atual) atual = resolve(readPref());
  return atual;
}

function interpolate(texto, vars) {
  if (!vars) return texto;
  return texto.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function t(chave, vars) {
  const msgs = LOCALES[lang()];
  return interpolate(msgs && Object.prototype.hasOwnProperty.call(msgs, chave) ? msgs[chave] : chave, vars);
}

function register(d) {
  deps = d;
  // Quem já usava o app (antes de haver idiomas) continua em português; só
  // instalações novas seguem o idioma do sistema.
  try {
    if (!fs.existsSync(prefPath()) && deps.existingInstall && deps.existingInstall()) {
      fs.writeFileSync(prefPath(), JSON.stringify({ language: 'pt-BR' }));
    }
  } catch (_) { /* sem permissão: segue no automático */ }
  ipcMain.on('i18n-get', (event) => {
    event.returnValue = { lang: lang(), pref: readPref(), messages: LOCALES[lang()] || {} };
  });
  ipcMain.handle('i18n-set', async (event, pref) => {
    if (!PREFS.includes(pref)) return { success: false, error: t('Idioma inválido') };
    fs.writeFileSync(prefPath(), JSON.stringify({ language: pref }));
    atual = resolve(pref);
    deps.onChange(atual);
    return { success: true, lang: atual };
  });
}

module.exports = { register, t, lang, interpolate };
