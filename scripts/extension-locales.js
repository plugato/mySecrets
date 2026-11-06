#!/usr/bin/env node
/**
 * Gera chrome-extension/_locales/pt_BR/messages.json a partir do código:
 * msg('chave', 'texto em português') nos scripts, data-i18n no popup.html e os
 * textos do manifesto. O inglês (_locales/en/messages.json) é mantido à mão.
 *
 *   node scripts/extension-locales.js           grava o pt_BR
 *   node scripts/extension-locales.js --check   falha se algo estiver fora de sincronia
 */
const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '..', 'chrome-extension');
const MANIFESTO = {
  extName: 'MySecrets Autofill',
  extDescription: 'Preenche login, senha e código 2FA com o cofre do app MySecrets (servidor local + token)',
  cmdAutofill: 'Preencher o formulário',
  cmdLock: 'Desconectar a extensão do app'
};

function coletar() {
  const msgs = { ...MANIFESTO };
  const definir = (k, pt, onde) => {
    if (k in msgs && msgs[k] !== pt) throw new Error(`Chave "${k}" com dois textos (${onde}): "${msgs[k]}" x "${pt}"`);
    msgs[k] = pt;
  };
  for (const f of ['background.js', 'content.js', 'popup.js', 'lib.mjs']) {
    const src = fs.readFileSync(path.join(EXT, f), 'utf8');
    for (const m of src.matchAll(/\bmsg\('(\w+)', '((?:[^'\\]|\\.)*)'/g)) definir(m[1], m[2].replace(/\\'/g, "'"), f);
  }
  const html = fs.readFileSync(path.join(EXT, 'popup.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n="(\w+)"[^>]*>([^<]*)</g)) definir(m[1], m[2].replace(/\s+/g, ' ').trim(), 'popup.html');
  for (const m of html.matchAll(/(placeholder|title)="([^"]*)"\s*data-i18n-(placeholder|title)="(\w+)"/g)) definir(m[4], m[2], 'popup.html');
  for (const m of html.matchAll(/data-i18n-(placeholder|title)="(\w+)"/g)) if (!(m[2] in msgs)) throw new Error(`data-i18n-${m[1]}="${m[2]}" sem texto ao lado`);
  return msgs;
}

function json(msgs) {
  const out = {};
  for (const k of Object.keys(msgs).sort()) out[k] = { message: msgs[k] };
  return JSON.stringify(out, null, 2) + '\n';
}

const pt = coletar();
const ptPath = path.join(EXT, '_locales', 'pt_BR', 'messages.json');
const en = JSON.parse(fs.readFileSync(path.join(EXT, '_locales', 'en', 'messages.json'), 'utf8'));
const problemas = [];
for (const k of Object.keys(pt)) if (!en[k]) problemas.push(`sem inglês: ${k} ("${pt[k]}")`);
for (const k of Object.keys(en)) if (!(k in pt)) problemas.push(`inglês sobrando: ${k}`);
for (const k of Object.keys(pt)) {
  const n = (s) => (s.match(/\$\d/g) || []).sort().join();
  if (en[k] && n(en[k].message) !== n(pt[k])) problemas.push(`marcadores diferentes: ${k}`);
}

if (process.argv.includes('--check')) {
  const atual = fs.existsSync(ptPath) ? fs.readFileSync(ptPath, 'utf8') : '';
  if (atual !== json(pt)) problemas.push('_locales/pt_BR/messages.json desatualizado: rode node scripts/extension-locales.js');
  if (problemas.length) { console.error(problemas.join('\n')); process.exit(1); }
  console.log(`ok: ${Object.keys(pt).length} textos`);
} else {
  fs.mkdirSync(path.dirname(ptPath), { recursive: true });
  fs.writeFileSync(ptPath, json(pt));
  console.log(`pt_BR: ${Object.keys(pt).length} textos`);
  if (problemas.length) console.log(problemas.join('\n'));
}
