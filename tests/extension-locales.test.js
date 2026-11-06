// Textos da extensão: pt_BR gerado do código e inglês completo.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('extensão: _locales em sincronia com o código (pt_BR) e inglês completo', () => {
  const saida = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'extension-locales.js'), '--check'], { encoding: 'utf8' });
  assert.match(saida, /^ok:/);
});
