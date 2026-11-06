// Carrega src/preload.js com um módulo 'electron' simulado e devolve a API
// exposta ao renderer. invoke(canal, ...args) simula o processo principal.
const path = require('node:path');
const Module = require('node:module');

const PRELOAD = path.join(__dirname, '..', '..', 'src', 'preload.js');

function loadPreload({ invoke = async () => ({}) } = {}) {
  let api = null;
  const fakeElectron = {
    contextBridge: { exposeInMainWorld: (_name, obj) => { api = obj; } },
    ipcRenderer: { invoke, sendSync: () => ({ lang: 'pt-BR', pref: 'auto', messages: {} }), on: () => {}, send: () => {}, removeListener: () => {}, removeAllListeners: () => {} }
  };
  const origLoad = Module._load;
  const orig = { log: console.log, error: console.error };
  Module._load = function (request, ...rest) {
    if (request === 'electron') return fakeElectron;
    return origLoad.call(this, request, ...rest);
  };
  console.log = () => {};
  console.error = () => {};
  try {
    delete require.cache[PRELOAD];
    require(PRELOAD);
  } finally {
    Module._load = origLoad;
    Object.assign(console, orig);
  }
  return api;
}

module.exports = { loadPreload, PRELOAD };
