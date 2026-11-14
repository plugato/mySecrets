/**
 * MySecrets - Peças puras do acesso de agentes com aprovação (sem Electron):
 *
 *   - configurações da aprovação (arquivo agent-approval.json no perfil, lido
 *     também pelo servidor MCP para saber se toda leitura pede aprovação);
 *   - liberação de leitura por tempo ("janela");
 *   - corrida entre canais de aprovação (janela do PC × celular).
 */

const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = 'agent-approval.json';
const READ_POLICIES = ['locked', 'always'];
const WINDOW_CHOICES = [5, 15, 30];
const DEFAULT_SETTINGS = Object.freeze({
  remote: false,          // aprovar pelo celular de qualquer lugar (relay)
  readPolicy: 'locked',   // pedir aprovação de leitura: só com o cofre bloqueado | sempre
  windowMinutes: 5        // tempo do botão "Liberar por N min"
});

function normalizeSettings(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    remote: o.remote === true,
    readPolicy: READ_POLICIES.includes(o.readPolicy) ? o.readPolicy : DEFAULT_SETTINGS.readPolicy,
    windowMinutes: WINDOW_CHOICES.includes(Number(o.windowMinutes)) ? Number(o.windowMinutes) : DEFAULT_SETTINGS.windowMinutes
  };
}

function readSettings(dir) {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(path.join(dir, SETTINGS_FILE), 'utf8')));
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(dir, partial) {
  const novo = normalizeSettings({ ...readSettings(dir), ...(partial || {}) });
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify(novo), { mode: 0o600 });
  return novo;
}

/**
 * Liberação de leitura por tempo. start() substitui a anterior; o fim vem
 * pelo prazo, por end() (bloqueio, celular, bandeja) ou ao consultar active()
 * depois do prazo (relógio que pulou na suspensão).
 */
function createReadWindow({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, onStart, onEnd } = {}) {
  let cur = null;

  function end(reason) {
    if (!cur) return false;
    const c = cur;
    cur = null;
    clearTimer(c.timer);
    if (c.stop) { try { c.stop(); } catch (_) { /* melhor esforço */ } }
    if (onEnd) onEnd(view(c), reason);
    return true;
  }

  function view(c) {
    return c ? { until: c.until, minutes: c.minutes, source: c.source, phoneName: c.phoneName } : null;
  }

  return {
    start(minutes, info = {}) {
      end('replaced');
      const ms = minutes * 60 * 1000;
      cur = { ...info, minutes, until: now() + ms };
      cur.timer = setTimer(() => end('expired'), ms);
      if (onStart) onStart(view(cur));
      return view(cur);
    },
    /** Função chamada no fim (ex.: parar a escuta do celular). */
    onStop(fn) { if (cur) cur.stop = fn; },
    active() {
      if (cur && now() >= cur.until) end('expired');
      return view(cur);
    },
    end
  };
}

/**
 * Primeira resposta que DECIDE. sources: [{ name, promise }], cada promise
 * resolve em { decided: true, ... } (aprovou, recusou, venceu, cancelado) ou
 * { decided: false, error } (canal indisponível: celular sem internet, app
 * bloqueado). Se nenhum decidir, devolve a última resposta indecisa.
 */
function firstDecision(sources) {
  return new Promise((resolve) => {
    if (!sources.length) {
      resolve({ decided: false, error: 'Nenhum canal de aprovação disponível' });
      return;
    }
    let restantes = sources.length;
    let feito = false;
    sources.forEach((s) => {
      Promise.resolve(s.promise)
        .catch((e) => ({ decided: false, error: e && e.message }))
        .then((r) => {
          if (feito) return;
          const res = { source: s.name, ...(r || { decided: false }) };
          if (res.decided || --restantes === 0) {
            feito = true;
            resolve(res);
          }
        });
    });
  });
}

module.exports = {
  SETTINGS_FILE,
  READ_POLICIES,
  WINDOW_CHOICES,
  DEFAULT_SETTINGS,
  normalizeSettings,
  readSettings,
  writeSettings,
  createReadWindow,
  firstDecision
};
