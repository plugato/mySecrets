/**
 * Caixa postal do relay (lógica pura, sem nada da Cloudflare: testável em Node).
 *
 * Um canal por pareamento PC ↔ celular. O conteúdo é cifrado de ponta a ponta
 * (src/lib/phone-relay.js); aqui só se guarda texto opaco com prazo.
 *
 *   POST   /                 { reqId, box, exp } pedido novo (PC)
 *                            { reqId, exp, listen: true } escuta sem pedido (PC)
 *   GET    /                 { items: [{ reqId, box }] } pedidos sem resposta (celular)
 *   DELETE /{id}             o PC retira o pedido
 *   POST   /{id}/answer      { epk, box } resposta (celular); 410 se não há pedido aberto
 *   GET    /{id}/answer?wait=N  200 { epk, box } | 204 ainda não | 404 não existe
 */

export const MAX_ITEMS = 32;
export const MAX_BOX = 16 * 1024;
export const MAX_ANSWER = 4 * 1024;
export const MAX_TTL_MS = 31 * 60 * 1000;
export const MAX_WAIT_S = 25;

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const B64 = /^[A-Za-z0-9+/=]+$/;
const PREFIX = 'req:';

const out = (status, json) => ({ status, json });

export class Mailbox {
  /**
   * storage: { get(k), put(k, v), delete(k), list({ prefix }) -> Map } (async)
   * now():   relógio (testes)
   */
  constructor(storage, now = Date.now) {
    this.storage = storage;
    this.now = now;
    this.waiters = new Map(); // id -> Set<resolve>
  }

  async items() {
    const all = await this.storage.list({ prefix: PREFIX });
    const vivos = [];
    for (const [k, v] of all) {
      if (!v || v.exp <= this.now()) await this.storage.delete(k);
      else vivos.push({ id: k.slice(PREFIX.length), ...v });
    }
    return vivos;
  }

  async get(id) {
    const v = await this.storage.get(PREFIX + id);
    if (!v) return null;
    if (v.exp <= this.now()) {
      await this.storage.delete(PREFIX + id);
      return null;
    }
    return v;
  }

  wake(id) {
    const set = this.waiters.get(id);
    if (!set) return;
    this.waiters.delete(id);
    set.forEach((r) => r());
  }

  /** Menor prazo guardado (para o alarme de limpeza). */
  async nextExpiry() {
    const vivos = await this.items();
    return vivos.length ? Math.min(...vivos.map((v) => v.exp)) : null;
  }

  async handle(method, path, body, query = {}) {
    const parts = path.split('/').filter(Boolean);

    if (parts.length === 0 && method === 'POST') {
      if (!body || typeof body !== 'object' || !ID.test(String(body.reqId || ''))) return out(400, { erro: 'pedido inválido' });
      const exp = Number(body.exp);
      if (!Number.isFinite(exp) || exp <= this.now() || exp > this.now() + MAX_TTL_MS) return out(400, { erro: 'prazo inválido' });
      const listen = body.listen === true;
      if (!listen && (typeof body.box !== 'string' || !body.box || body.box.length > MAX_BOX || !B64.test(body.box))) {
        return out(400, { erro: 'pedido inválido' });
      }
      const vivos = await this.items();
      if (vivos.some((v) => v.id === body.reqId)) return out(409, { erro: 'pedido repetido' });
      if (vivos.length >= MAX_ITEMS) return out(429, { erro: 'caixa cheia' });
      await this.storage.put(PREFIX + body.reqId, { box: listen ? null : body.box, exp, listen, answer: null });
      return out(204);
    }

    if (parts.length === 0 && method === 'GET') {
      const vivos = await this.items();
      return out(200, {
        items: vivos.filter((v) => !v.listen && !v.answer).map((v) => ({ reqId: v.id, box: v.box })),
      });
    }

    const id = parts[0];
    if (!ID.test(id || '')) return out(404, { erro: 'não encontrado' });

    if (parts.length === 1 && method === 'DELETE') {
      await this.storage.delete(PREFIX + id);
      this.wake(id);
      return out(204);
    }

    if (parts.length === 2 && parts[1] === 'answer' && method === 'POST') {
      if (!body || typeof body.epk !== 'string' || typeof body.box !== 'string' ||
          body.epk.length > 256 || body.box.length > MAX_ANSWER || !B64.test(body.epk) || !B64.test(body.box)) {
        return out(400, { erro: 'resposta inválida' });
      }
      const v = await this.get(id);
      if (!v || v.answer) return out(410, { erro: 'pedido encerrado' });
      v.answer = { epk: body.epk, box: body.box };
      await this.storage.put(PREFIX + id, v);
      this.wake(id);
      return out(204);
    }

    if (parts.length === 2 && parts[1] === 'answer' && method === 'GET') {
      const wait = Math.max(0, Math.min(MAX_WAIT_S, parseInt(query.wait, 10) || 0));
      let v = await this.get(id);
      if (!v) return out(404, { erro: 'não encontrado' });
      if (!v.answer && wait > 0) {
        await new Promise((resolve) => {
          let set = this.waiters.get(id);
          if (!set) this.waiters.set(id, (set = new Set()));
          const done = () => { clearTimeout(t); set.delete(done); resolve(); };
          const t = setTimeout(done, wait * 1000);
          set.add(done);
        });
        v = await this.get(id);
        if (!v) return out(404, { erro: 'não encontrado' });
      }
      return v.answer ? out(200, v.answer) : out(204);
    }

    return out(405, { erro: 'método não permitido' });
  }
}
