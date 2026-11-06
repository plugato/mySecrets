// Registro das leituras do MCP: só ids, só ferramentas que leem segredos.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const audit = require('../mcp-server/audit');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mysecrets-audit-'));
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

test('registra leituras com ids, sem conteúdo; ignora match_url e vault_status', () => {
  audit.record(DIR, { tool: 'get_credentials', client: 'agente-stdio', data: { id: 'e1', title: 'GitHub', password: 'segredo' } });
  audit.record(DIR, { tool: 'search_secrets', client: 'agente-http', data: { count: 2, results: [{ id: 'a' }, { id: 'b' }] } });
  audit.record(DIR, { tool: 'match_url', client: 'extensao', data: { results: [{ id: 'x' }] } });
  audit.record(DIR, { tool: 'vault_status', client: 'extensao', data: {} });
  audit.record(DIR, { tool: 'get_secret_file', client: 'agente-stdio', data: { entry: { id: 'e9', title: 'Keystore' }, path: '/tmp/x' } });
  const bruto = fs.readFileSync(path.join(DIR, audit.FILE), 'utf8');
  assert.ok(!/segredo|GitHub|Keystore|\/tmp\/x/.test(bruto), 'nada de conteúdo, título ou caminho');
  const r = audit.read(DIR);
  assert.deepStrictEqual(r.map((x) => [x.tool, x.client, x.ids]), [
    ['get_secret_file', 'agente-stdio', ['e9']],
    ['search_secrets', 'agente-http', ['a', 'b']],
    ['get_credentials', 'agente-stdio', ['e1']]
  ]);
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(DIR, audit.FILE)).mode & 0o777, 0o600);
});

test('arquivo limitado e limpar apaga', () => {
  for (let i = 0; i < 3000; i++) audit.record(DIR, { tool: 'get_otp', client: 'agente-stdio', data: { id: 'id-' + i } });
  assert.ok(fs.statSync(path.join(DIR, audit.FILE)).size <= 210 * 1024);
  assert.strictEqual(audit.read(DIR, 1)[0].ids[0], 'id-2999');
  audit.clear(DIR);
  assert.deepStrictEqual(audit.read(DIR), []);
});
