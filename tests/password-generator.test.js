// Gerador de senhas do preload: usa crypto.getRandomValues e não tem viés.
// Carrega o preload real com um módulo 'electron' simulado para capturar a API.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const { loadPreload, PRELOAD } = require('./helpers/load-preload');

const api = loadPreload();
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

test('não usa Math.random no código do gerador', () => {
  const src = fs.readFileSync(PRELOAD, 'utf8');
  assert.ok(!src.includes('Math.random'), 'preload.js não deve usar Math.random');
});

test('respeita o tamanho pedido', () => {
  for (const len of [0, 1, 8, 16, 64, 128]) {
    assert.strictEqual(api.generatePassword(len, true).length, len);
  }
  assert.strictEqual(api.generatePassword().length, 16);
});

test('tamanho absurdo é limitado e não trava', () => {
  assert.strictEqual(api.generatePassword(Infinity, true).length, 1024);
  assert.strictEqual(api.generatePassword(1e9, true).length, 1024);
  assert.strictEqual(api.generatePassword(-5, true).length, 0);
  assert.strictEqual(api.generatePassword('abc', true).length, 0);
});

test('sem símbolos usa só letras e números', () => {
  const pw = api.generatePassword(2000, false);
  for (const ch of pw) assert.ok(ALNUM.includes(ch), `caractere inesperado: ${ch}`);
});

test('com símbolos usa só o alfabeto esperado e inclui símbolos', () => {
  const pw = api.generatePassword(2000, true);
  for (const ch of pw) assert.ok((ALNUM + SYMBOLS).includes(ch), `caractere inesperado: ${ch}`);
  assert.ok([...pw].some((ch) => SYMBOLS.includes(ch)));
});

test('distribuição uniforme (qui-quadrado)', () => {
  const alphabet = ALNUM + SYMBOLS; // 88 caracteres: 256 % 88 != 0, testa o descarte
  const N = 88 * 2000;
  let pw = '';
  while (pw.length < N) pw += api.generatePassword(Math.min(1024, N - pw.length), true);
  const counts = new Map();
  for (const ch of pw) counts.set(ch, (counts.get(ch) || 0) + 1);
  assert.strictEqual(counts.size, alphabet.length, 'todos os caracteres devem aparecer');
  const expected = N / alphabet.length;
  let chi2 = 0;
  for (const ch of alphabet) chi2 += ((counts.get(ch) || 0) - expected) ** 2 / expected;
  // 87 graus de liberdade: p=0.0001 fica perto de 150. Com viés de módulo
  // (Math.floor(byte % 88)) o valor passaria de 1000 com este N.
  assert.ok(chi2 < 150, `qui-quadrado alto demais: ${chi2.toFixed(1)}`);
});

test('duas senhas seguidas são diferentes', () => {
  assert.notStrictEqual(api.generatePassword(32, true), api.generatePassword(32, true));
});
