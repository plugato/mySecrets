/**
 * MySecrets - Celular Android: desbloquear o PC aprovando no celular (mesma
 * rede Wi-Fi).
 *
 * Protocolo e criptografia em src/lib/phone-link.js. Aqui fica só o que o PC
 * guarda (phone-link.json): por celular, o segredo do pareamento (protegido
 * pelo safeStorage) e a senha mestra cifrada com a chave que só o celular tem.
 *
 * register({ getWindow, userDataPath, protectToken, unprotectToken })
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const QRCode = require('qrcode');
const phoneLink = require('../lib/phone-link');
const { t } = require('./i18n');

let deps = null;

function register(d) {
  deps = d;
}

const phoneLinkPath = () => path.join(deps.userDataPath, 'phone-link.json');
const phone = { pending: null, abort: null };
// Testes/desenvolvimento: IPs fixos em vez de varrer a rede (ex.: emulador via adb forward)
const phoneTestHosts = process.env.MYSECRETS_PHONE_HOSTS ? process.env.MYSECRETS_PHONE_HOSTS.split(',').map(h => h.trim()).filter(Boolean) : undefined;

function readPhoneLinks() {
  try {
    const d = JSON.parse(fs.readFileSync(phoneLinkPath(), 'utf8'));
    return Array.isArray(d.phones) ? d.phones : [];
  } catch (_) {
    return [];
  }
}

function writePhoneLinks(phones) {
  fs.writeFileSync(phoneLinkPath(), JSON.stringify({ phones }, null, 2));
  try { fs.chmodSync(phoneLinkPath(), 0o600); } catch (_) { /* Windows */ }
}

function removePhoneLinks() {
  try { if (fs.existsSync(phoneLinkPath())) fs.unlinkSync(phoneLinkPath()); } catch (_) {}
}

function pairingFromStored(p) {
  const secret = deps.unprotectToken(p.secret);
  if (!secret) throw new Error(t('Não foi possível ler o pareamento deste celular. Pareie de novo.'));
  return { pairId: p.pairId, name: p.desktopName || os.hostname(), secret: Buffer.from(secret, 'base64'), unlock: p.unlock };
}

function phoneSummary() {
  return readPhoneLinks().map(p => ({ pairId: p.pairId, phoneName: p.phoneName, pairedAt: p.pairedAt, lastUsedAt: p.lastUsedAt || null }));
}

function sendPhoneStatus(status) {
  const win = deps.getWindow();
  if (win && !win.isDestroyed()) win.webContents.send('phone-unlock-status', status);
}

ipcMain.handle('phone-status', async () => ({ phones: phoneSummary() }));

// Começa um pareamento: devolve o QR (imagem) e espera o celular confirmar
ipcMain.handle('phone-pair-start', async (event, masterPassword) => {
  try {
    if (!masterPassword) throw new Error(t('Cofre bloqueado'));
    if (phone.abort) phone.abort.abort();
    const { pairing, qr } = phoneLink.createPairing(masterPassword, os.hostname());
    phone.pending = pairing;
    const image = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
    return { success: true, image, desktopName: pairing.name };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Procura o celular que leu o QR (repete por até 2 minutos)
ipcMain.handle('phone-pair-wait', async () => {
  const pairing = phone.pending;
  if (!pairing) return { success: false, error: t('Nenhum pareamento em andamento') };
  const controller = new AbortController();
  phone.abort = controller;
  const limite = Date.now() + 5 * 60 * 1000;
  let ultimaResposta = null;
  const status = (texto) => {
    const win = deps.getWindow();
  if (win && !win.isDestroyed()) win.webContents.send('phone-pair-status', texto);
  };
  try {
    while (Date.now() < limite) {
      status(ultimaResposta
        ? t("Procurando o celular na rede… Última resposta do celular: {0}", { 0: ultimaResposta })
        : t('Procurando o celular na rede… Leia o QR no celular e confirme com a digital.'));
      try {
        const r = await phoneLink.confirmPairing(pairing, { signal: controller.signal, connectTimeout: 600, hosts: phoneTestHosts });
        const phones = readPhoneLinks().filter(p => p.pairId !== pairing.pairId);
        phones.push({
          pairId: pairing.pairId,
          desktopName: pairing.name,
          phoneName: r.phoneName,
          lastIp: r.host,
          pairedAt: new Date().toISOString(),
          secret: deps.protectToken(pairing.secret.toString('base64')),
          unlock: pairing.unlock
        });
        writePhoneLinks(phones);
        phone.pending = null;
        return { success: true, phoneName: r.phoneName };
      } catch (e) {
        if (e.code === 'cancelled') return { success: false, cancelled: true };
        if (/respondeu:/.test(e.message)) ultimaResposta = e.message.replace(/^.*respondeu:\s*/, '');
        console.log('[celular] pareamento ainda não confirmado:', e.message);
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    return {
      success: false,
      error: ultimaResposta
        ? t("O celular respondeu, mas não confirmou este pareamento: {0}", { 0: ultimaResposta })
        : t('O celular não respondeu. Confira se ele está na mesma rede Wi-Fi e com o MySecrets aberto na tela de pareamento.')
    };
  } finally {
    if (phone.abort === controller) phone.abort = null;
  }
});

ipcMain.handle('phone-cancel', async () => {
  if (phone.abort) phone.abort.abort();
  phone.pending = null;
  return { success: true };
});

ipcMain.handle('phone-unpair', async (event, pairId) => {
  writePhoneLinks(readPhoneLinks().filter(p => p.pairId !== pairId));
  return { success: true, phones: phoneSummary() };
});

// Login: pede a aprovação ao celular e devolve a senha mestra ao renderer
// (o mesmo caminho do login por Windows Hello)
ipcMain.handle('phone-unlock', async () => {
  const phones = readPhoneLinks();
  if (!phones.length) return { success: false, error: t('Nenhum celular pareado') };
  if (phone.abort) phone.abort.abort();
  const controller = new AbortController();
  phone.abort = controller;

  // Mais recente primeiro; se houver mais de um celular, o primeiro que responder vence
  const ordenados = phones.slice().sort((a, b) => String(b.lastUsedAt || b.pairedAt).localeCompare(String(a.lastUsedAt || a.pairedAt)));
  let ultimoErro = null;
  try {
    for (const p of ordenados) {
      try {
        const pairing = pairingFromStored(p);
        const r = await phoneLink.requestUnlock(pairing, {
          lastIp: p.lastIp,
          hosts: phoneTestHosts,
          signal: controller.signal,
          onStatus: (s) => sendPhoneStatus({ ...s, phoneName: s.phoneName || p.phoneName })
        });
        writePhoneLinks(readPhoneLinks().map(x => x.pairId === p.pairId ? { ...x, lastIp: r.host, lastUsedAt: new Date().toISOString() } : x));
        return { success: true, password: r.password };
      } catch (e) {
        if (e.code === 'cancelled' || e.code === 'denied') return { success: false, cancelled: e.code === 'cancelled', error: e.message };
        ultimoErro = e;
      }
    }
    return { success: false, error: ultimoErro ? ultimoErro.message : t('Celular não encontrado') };
  } finally {
    if (phone.abort === controller) phone.abort = null;
  }
});

module.exports = { register, removePhoneLinks };
