/**
 * MySecrets - IPC da consulta de senhas vazadas. O renderer manda só o
 * prefixo de 5 caracteres do SHA-1 (ver src/lib/pwned.js).
 */

const { ipcMain } = require('electron');
const pwned = require('../lib/pwned');

ipcMain.handle('pwned-range', async (event, prefix) => {
  try {
    return { success: true, text: await pwned.fetchRange(prefix) };
  } catch (error) {
    return { success: false, error: error.name === 'TimeoutError' ? 'Sem resposta do serviço de senhas vazadas' : error.message };
  }
});
