// Peças comuns dos testes da extensão em navegadores de verdade: um app falso
// (pareamento + ferramentas que a extensão usa) e uma página de login.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function listen(server) {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

// App falso: pareamento + JSON-RPC das ferramentas que a extensão usa
function fakeApp(log) {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const origin = req.headers.origin || '';
      log.push({ path: req.url, origin, auth: req.headers.authorization || '' });
      const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Content-Type': 'application/json' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (!/^(chrome|moz)-extension:\/\//.test(origin)) { res.writeHead(403, cors); return res.end('{}'); }
      if (req.url === '/pair') {
        res.writeHead(200, cors);
        return res.end(JSON.stringify({ url: `http://127.0.0.1:${req.socket.localPort}/mcp`, token: 'tk-ext' }));
      }
      if (req.headers.authorization !== 'Bearer tk-ext') { res.writeHead(401, cors); return res.end('{}'); }
      const msg = JSON.parse(body || '{}');
      const { name, arguments: args } = msg.params || {};
      let data;
      if (name === 'vault_status') data = { accessible: true };
      else if (name === 'match_url') data = { count: 1, results: [{ id: 'e1', type: 'login', title: 'Site de teste', username: 'eu@exemplo.com', url: args.url }] };
      else if (name === 'get_credentials') data = { id: 'e1', title: 'Site de teste', username: 'eu@exemplo.com', password: 's3nh4-da-extensao', url: 'http://127.0.0.1/' };
      else return (res.writeHead(200, cors), res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: '{"error":"sem OTP"}' }] } })));
      res.writeHead(200, cors);
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(data) }] } }));
    });
  });
}

const PAGINA = `<!doctype html><html><body>
<form id="f" action="/ok" method="post">
  <input type="email" name="email" id="user" autocomplete="username">
  <input type="password" name="password" id="pass" autocomplete="current-password">
  <button type="submit">Entrar</button>
</form></body></html>`;

/** Copia a extensão para dir, apontando para o app falso na porta dada. */
function copyExtension(dir, appPort) {
  fs.cpSync(path.join(ROOT, 'chrome-extension'), dir, { recursive: true });
  const bg = path.join(dir, 'background.js');
  const src = fs.readFileSync(bg, 'utf8');
  const novo = src.replace("'http://127.0.0.1:8765/mcp'", `'http://127.0.0.1:${appPort}/mcp'`);
  if (novo === src) throw new Error('DEFAULT_URL não encontrado em background.js');
  fs.writeFileSync(bg, novo);
}

function loginSite() {
  return http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGINA); });
}

module.exports = { listen, fakeApp, copyExtension, loginSite, TOKEN: 'tk-ext', USER: 'eu@exemplo.com', PASSWORD: 's3nh4-da-extensao' };
