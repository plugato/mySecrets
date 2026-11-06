// ESLint: regras de correção e segurança (sem regras de estilo).
// no-unsanitized aponta innerHTML/insertAdjacentHTML com valores que não
// passaram por escapeHtml(): foi assim que dados do cofre viraram HTML.
const js = require('@eslint/js');
const globals = require('globals');
const nounsanitized = require('eslint-plugin-no-unsanitized');

const comum = {
  ...js.configs.recommended.rules,
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-empty': ['warn', { allowEmptyCatch: true }],
  eqeqeq: ['error', 'smart'],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error'
};

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'android/**', 'graphify-out/**', 'docs/**', 'src/renderer/jsQR.js', '.venv/**'] },
  {
    files: ['src/main.js', 'src/main/**/*.js', 'src/lib/**/*.js', 'mcp-server/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: comum
  },
  {
    files: ['src/preload.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: comum
  },
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, jsQR: 'readonly' } },
    plugins: { 'no-unsanitized': nounsanitized },
    rules: {
      ...comum,
      // Os scripts do renderer compartilham o escopo global (vários <script>)
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-unsanitized/property': ['error', { escape: { methods: ['escapeHtml'] } }],
      'no-unsanitized/method': ['error', { escape: { methods: ['escapeHtml'] } }]
    }
  },
  {
    files: ['chrome-extension/**/*.js', 'chrome-extension/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.webextensions, chrome: 'readonly' }
    },
    plugins: { 'no-unsanitized': nounsanitized },
    rules: {
      ...comum,
      'no-unsanitized/property': 'error',
      'no-unsanitized/method': 'error'
    }
  },
  {
    files: ['chrome-extension/content.js', 'chrome-extension/popup.js'],
    languageOptions: { sourceType: 'script' }
  }
];
