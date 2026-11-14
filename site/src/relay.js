/**
 * /relay/{canal}/... — caixa postal para aprovar pedidos do PC no celular de
 * qualquer lugar (fora do Wi-Fi de casa). Um Durable Object por canal; a
 * lógica fica em relay-core.js. O conteúdo é cifrado de ponta a ponta entre o
 * PC e o celular (src/lib/phone-relay.js): este Worker só guarda texto opaco
 * por alguns minutos.
 *
 * Limites: corpo até 20 KB, 32 itens por canal, prazo de até 31 minutos e
 * RELAY_LIMIT por IP (abuso em geral).
 */

import { DurableObject } from 'cloudflare:workers';
import { Mailbox } from './relay-core.js';

const MAX_CORPO = 20 * 1024;
const CANAL = /^[0-9a-f]{32}$/;

const resposta = (status, json) =>
  new Response(json ? JSON.stringify(json) : null, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export class RelayMailbox extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.box = new Mailbox(ctx.storage);
  }

  async fetch(request) {
    const url = new URL(request.url);
    // /relay/{canal}/resto -> /resto
    const resto = url.pathname.split('/').slice(3).join('/');
    let corpo = null;
    if (request.method === 'POST') {
      try {
        corpo = JSON.parse(await request.text());
      } catch (_) {
        return resposta(400, { erro: 'JSON inválido' });
      }
    }
    const r = await this.box.handle(request.method, resto, corpo, Object.fromEntries(url.searchParams));
    if (request.method === 'POST' || request.method === 'DELETE') {
      const prox = await this.box.nextExpiry();
      if (prox) await this.ctx.storage.setAlarm(prox + 1000);
    }
    return resposta(r.status, r.json);
  }

  // Limpeza: apaga o que venceu e reagenda para o próximo prazo
  async alarm() {
    const prox = await this.box.nextExpiry();
    if (prox) await this.ctx.storage.setAlarm(prox + 1000);
    else await this.ctx.storage.deleteAll();
  }
}

export async function handleRelay(request, env) {
  if (!env.RELAY) return resposta(503, { erro: 'relay não configurado' });
  const { pathname } = new URL(request.url);
  const canal = pathname.split('/')[2] || '';
  if (!CANAL.test(canal)) return resposta(404, { erro: 'não encontrado' });
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return resposta(405, { erro: 'método não permitido' });
  if (Number(request.headers.get('content-length') || 0) > MAX_CORPO) return resposta(413, { erro: 'corpo grande demais' });

  const ip = request.headers.get('cf-connecting-ip') || 'sem-ip';
  if (env.RELAY_LIMIT && !(await env.RELAY_LIMIT.limit({ key: `ip:${ip}` })).success) return resposta(429, { erro: 'muitos pedidos' });

  const stub = env.RELAY.get(env.RELAY.idFromName(canal));
  return stub.fetch(request);
}
