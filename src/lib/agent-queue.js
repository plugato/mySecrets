/**
 * MySecrets - Fila de gravações pedidas por agente (MCP)
 *
 * Cada pedido tem um prazo absoluto (deadline) contado a partir da chegada ao
 * app, INCLUINDO o tempo esperando na fila. Os pedidos são confirmados um por
 * vez. Regras que evitam o "falso negativo" (agente recebe erro, mas a
 * gravação acontece depois):
 *   - passou do prazo, cancelado pelo agente ou sem confirmação: nunca grava;
 *   - a confirmação só vale se chegar antes do prazo;
 *   - o resultado devolvido ao agente é sempre o que de fato aconteceu.
 *
 * Módulo Node puro (sem Electron) para o main.js e para os testes.
 */

const EXPIRED_ERROR = 'Tempo esgotado: o pedido não foi confirmado no app a tempo. Nada foi gravado.';
const CANCELLED_ERROR = 'O agente cancelou o pedido (desconectou ou desistiu). Nada foi gravado.';

function withTimeout(promise, ms, onTimeout) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => { timer = setTimeout(() => resolve(onTimeout()), Math.max(0, ms)); })
  ]).finally(() => clearTimeout(timer));
}

/**
 * opts:
 *   windowMs        prazo de cada pedido (ms, a partir da chegada)
 *   applyTimeoutMs  limite para a gravação depois de aprovada
 *   graceMs         folga para a resposta da confirmação chegar após o prazo
 *   confirm(job)    -> Promise<{ success, approved, expired?, error? }>
 *   apply(job)      -> Promise<{ success, id, mode, title } | { success:false, error }>
 *   cancelConfirm(job)  fecha a confirmação em andamento (agente cancelou)
 *   onShow(job)     a confirmação deste pedido vai aparecer (chamar atenção)
 *   onCount(n)      quantidade de pedidos pendentes mudou
 *   now()           relógio (testes)
 */
function createAgentWriteQueue(opts) {
  const {
    windowMs,
    applyTimeoutMs = 10000,
    graceMs = 2000,
    confirm,
    apply,
    cancelConfirm = () => {},
    onShow = () => {},
    onCount = () => {},
    now = Date.now
  } = opts;

  const jobs = [];
  let running = false;

  const pending = () => jobs.length;

  async function run(job) {
    if (job.cancelled) return { success: false, cancelled: true, error: CANCELLED_ERROR };
    if (now() >= job.deadline) return { success: false, expired: true, error: EXPIRED_ERROR };

    job.stage = 'confirm';
    try { onShow(job); } catch (_) { /* chamar atenção é melhor esforço */ }
    const answer = await withTimeout(
      Promise.resolve().then(() => confirm(job)),
      job.deadline - now() + graceMs,
      () => ({ success: true, approved: false, expired: true })
    ).catch((err) => ({ success: false, error: err.message }));

    if (job.cancelled) return { success: false, cancelled: true, error: CANCELLED_ERROR };
    if (!answer || !answer.success) return answer || { success: false, error: 'Resposta vazia do app' };
    if (answer.expired || (answer.approved && now() >= job.deadline)) {
      return { success: false, expired: true, error: EXPIRED_ERROR };
    }
    if (!answer.approved) {
      return { success: false, declined: true, error: 'O usuário recusou a gravação no app.' };
    }

    job.stage = 'apply';
    return withTimeout(
      Promise.resolve().then(() => apply(job)),
      applyTimeoutMs,
      () => ({ success: false, error: 'A gravação não terminou a tempo; confira o cofre antes de repetir.' })
    ).catch((err) => ({ success: false, error: err.message }));
  }

  async function pump() {
    if (running) return;
    running = true;
    while (jobs.length > 0) {
      const job = jobs[0];
      const result = await run(job);
      jobs.shift();
      job.stage = 'done';
      try { onCount(pending()); } catch (_) {}
      job.resolve(result);
    }
    running = false;
  }

  return {
    /** Enfileira um pedido; resolve com o resultado verdadeiro. */
    submit(id, request) {
      return new Promise((resolve) => {
        const job = { id, request, deadline: now() + windowMs, cancelled: false, stage: 'queued', resolve };
        jobs.push(job);
        try { onCount(pending()); } catch (_) {}
        pump();
      });
    },

    /** Agente desistiu: tira da fila ou fecha a confirmação em andamento. */
    cancel(id) {
      const job = jobs.find((j) => j.id === id);
      if (!job || job.stage === 'done') return false;
      job.cancelled = true;
      if (job.stage === 'confirm') {
        try { cancelConfirm(job); } catch (_) {}
      }
      return true;
    },

    pending,
    current: () => (jobs[0] && jobs[0].stage !== 'queued' ? jobs[0] : null)
  };
}

module.exports = { createAgentWriteQueue, EXPIRED_ERROR, CANCELLED_ERROR };
