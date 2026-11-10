/**
 * Worker do site do MySecrets. Rotas (o resto vem de public/):
 *   GET /apk                      APK do Android da última release
 *   GET /download/{plataforma}    android | windows | windows-portatil | linux-appimage | linux-deb |
 *                                 linux-arm64-appimage | linux-arm64-deb | extensao
 *   GET /versao                   { versao, publicada, arquivos: { plataforma: { url, tamanho } } }
 *   POST /push                    { token, data } -> push do Firebase que acorda o app Android
 *                                 quando o PC pede aprovação (ver push.js)
 * A consulta à API do GitHub fica em cache por 10 minutos (sem token: 60 consultas/hora por IP do Worker).
 */

// Plataforma -> teste no nome do arquivo da release
const ARQUIVOS = {
  android: (n) => /-android\.apk$/.test(n),
  windows: (n) => /^MySecrets-Setup-.*\.exe$/.test(n),
  'windows-portatil': (n) => /-portable\.exe$/.test(n),
  'linux-appimage': (n) => /^MySecrets-[\d.]+\.AppImage$/.test(n),
  'linux-deb': (n) => /_amd64\.deb$/.test(n),
  'linux-arm64-appimage': (n) => /-arm64\.AppImage$/.test(n),
  'linux-arm64-deb': (n) => /_arm64\.deb$/.test(n),
  extensao: (n) => /extensao-chrome\.zip$/.test(n),
};

import { handlePush } from './push.js';

const CACHE_SEGUNDOS = 600;

async function ultimaRelease(env, ctx) {
  const api = `https://api.github.com/repos/${env.REPO}/releases/latest`;
  const cache = caches.default;
  const chave = new Request(api);
  let resp = await cache.match(chave);
  if (!resp) {
    const r = await fetch(api, {
      headers: { 'User-Agent': 'mysecrets-site', Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`);
    resp = new Response(await r.text(), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_SEGUNDOS}` },
    });
    ctx.waitUntil(cache.put(chave, resp.clone()));
  }
  const rel = await resp.json();
  const arquivos = {};
  for (const [plataforma, bate] of Object.entries(ARQUIVOS)) {
    const a = rel.assets.find((x) => bate(x.name));
    if (a) arquivos[plataforma] = { nome: a.name, url: a.browser_download_url, tamanho: a.size };
  }
  return { versao: rel.tag_name.replace(/^v/, ''), publicada: rel.published_at, pagina: rel.html_url, arquivos };
}

const json = (dados, status = 200) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/push') {
      if (request.method !== 'POST') return new Response('método não permitido', { status: 405 });
      return handlePush(request, env);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('método não permitido', { status: 405 });

    const plataforma = pathname === '/apk' ? 'android' : pathname.match(/^\/download\/([\w-]+)\/?$/)?.[1];
    if (pathname === '/versao' || plataforma) {
      let rel;
      try {
        rel = await ultimaRelease(env, ctx);
      } catch (e) {
        // GitHub fora ou limite estourado: manda para a página de releases, que sempre funciona
        if (plataforma) return Response.redirect(`https://github.com/${env.REPO}/releases/latest`, 302);
        return json({ erro: String(e.message || e) }, 502);
      }
      if (pathname === '/versao') return json(rel);
      const a = rel.arquivos[plataforma];
      if (!a) return new Response('arquivo não encontrado na última versão', { status: 404 });
      return Response.redirect(a.url, 302);
    }

    return env.ASSETS.fetch(request);
  },
};
