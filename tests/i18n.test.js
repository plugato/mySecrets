// Idiomas: toda chave usada no código tem tradução; traduções seguras.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const espree = require('espree');

const ROOT = path.join(__dirname, '..');
const EN = require('../src/locales/en.json');
const FNS = new Set(['tr', 't', 'trAgente', 'trProton']);
const ARQUIVOS = [
  'src/main.js', ...fs.readdirSync(path.join(ROOT, 'src/main')).map((f) => `src/main/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'src/renderer/app')).map((f) => `src/renderer/app/${f}`),
  'src/renderer/agent-write.js', 'src/renderer/proton-pass-import.js', 'src/renderer/a11y.js'
];

function chavesDoCodigo() {
  const chaves = new Map(); // chave -> arquivo:linha
  const dinamicas = [];
  for (const f of ARQUIVOS) {
    const ast = espree.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'), { ecmaVersion: 2023, sourceType: 'script', loc: true });
    (function walk(n) {
      if (!n || typeof n.type !== 'string') return;
      if (n.type === 'CallExpression' && FNS.has(n.callee.name)) {
        const a = n.arguments[0];
        if (a && a.type === 'Literal' && typeof a.value === 'string') chaves.set(a.value, `${f}:${n.loc.start.line}`);
        else if (a && a.type === 'TemplateLiteral' && !a.expressions.length) chaves.set(a.quasis[0].value.cooked, `${f}:${n.loc.start.line}`);
        else dinamicas.push(`${f}:${n.loc.start.line}`);
      }
      for (const k of Object.keys(n)) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
    })(ast);
  }
  return { chaves, dinamicas };
}

test('toda chave usada no código tem tradução em inglês', () => {
  const { chaves, dinamicas } = chavesDoCodigo();
  assert.deepStrictEqual(dinamicas, [], 'tr()/t() só com texto literal (para poder conferir)');
  const faltam = [...chaves].filter(([k]) => !(k in EN)).map(([k, onde]) => `${onde}  ${JSON.stringify(k)}`);
  assert.deepStrictEqual(faltam, []);
});

test('traduções: mesmos marcadores, sem HTML e sem espaço perdido nas pontas', () => {
  const marcadores = (s) => (s.match(/\{\w+\}/g) || []).sort();
  for (const [pt, en] of Object.entries(EN)) {
    assert.deepStrictEqual(marcadores(en), marcadores(pt), `marcadores: ${pt}`);
    assert.ok(!/[<>&]/.test(en) || /[<>&]/.test(pt), `tradução com HTML: ${en}`);
    assert.strictEqual(/^\s/.test(en), /^\s/.test(pt), `espaço inicial: ${pt}`);
    assert.strictEqual(/\s$/.test(en), /\s$/.test(pt), `espaço final: ${pt}`);
    assert.ok(en.trim().length > 0, `tradução vazia: ${pt}`);
  }
});

test('t() do processo principal interpola e cai no português sem tradução', () => {
  const { interpolate } = require('../src/main/i18n');
  assert.strictEqual(interpolate('Olá {nome}, {n} itens', { nome: 'Ana', n: 3 }), 'Olá Ana, 3 itens');
  assert.strictEqual(interpolate('Sem {x}', {}), 'Sem {x}');
});
