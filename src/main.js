const { app, BrowserWindow, Menu, Tray, ipcMain, dialog, safeStorage, clipboard, nativeImage, globalShortcut, powerMonitor, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { execFile, spawn } = require('child_process');
const vaultCrypto = require('./lib/vault-crypto');
const vaultSync = require('./lib/vault-sync');
const googleDrive = require('./lib/google-drive');
// Anexos de arquivo (ler/conferir/gravar em disco): módulo Node puro, também
// usado pelo servidor MCP
const attachmentFiles = require('../mcp-server/files');

// Carregar otplib no processo principal
let otplib;
let totpGenerator, hotpGenerator;
try {
  otplib = require('otplib');
  totpGenerator = otplib.authenticator; // Usar authenticator em vez de totp
  hotpGenerator = otplib.hotp;
  console.log('otplib carregado com sucesso no processo principal');
} catch (error) {
  console.error('Erro ao carregar otplib:', error);
  otplib = null;
}

// Configuração de segurança
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

let mainWindow;
let isDevMode = process.argv.includes('--dev');

// Arquivos locais desta máquina (nunca sincronizados)
const userDataPath = app.getPath('userData');
const sessionPath = path.join(userDataPath, '.session');
const helloPath = path.join(userDataPath, 'hello.enc');
const machineSecretPath = path.join(userDataPath, '.machine-secret');
const mcpTokenPath = path.join(userDataPath, '.mcp-token');
// Porta do servidor local enquanto ele roda: o MCP stdio lê para repassar gravações
const mcpEndpointPath = path.join(userDataPath, '.mcp-endpoint');
const trustedExtensionsPath = path.join(userDataPath, 'extension-origins.json');

// Certificar que o diretório userData existe
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

// ===== Local do cofre =====
//
// Por padrão o cofre fica em userData. Com a sincronização ligada ele fica numa
// pasta MySecrets dentro do Google Drive (ou outra pasta sincronizada) — ver
// src/lib/vault-sync.js. Sessão, token MCP e Windows Hello continuam locais.

function isSyncEnabled() {
  return !!vaultSync.readVaultLocation(userDataPath);
}

function vaultDir() {
  return vaultSync.readVaultLocation(userDataPath) || userDataPath;
}

function vaultFile() {
  return path.join(vaultDir(), vaultSync.VAULT_FILE);
}

function backupsPath() {
  return path.join(vaultDir(), 'backups');
}

// ===== Gerenciamento de Sessão (para Native Messaging) =====

/**
 * Segredo de máquina: 32 bytes aleatórios gerados uma única vez e guardados
 * com permissão 600. A chave da sessão deriva dele — diferente do esquema
 * antigo (hostname+PID+versão, adivinhável por força-bruta), um arquivo de
 * sessão copiado para fora da máquina é inútil sem esse segredo.
 * O mcp-server lê o mesmo arquivo para decifrar a sessão localmente.
 */
function getMachineSecret() {
  try {
    if (fs.existsSync(machineSecretPath)) {
      const secret = fs.readFileSync(machineSecretPath);
      if (secret.length >= 32) return secret;
    }
  } catch (_) { /* regenera abaixo */ }

  const secret = crypto.randomBytes(32);
  fs.writeFileSync(machineSecretPath, secret);
  try {
    fs.chmodSync(machineSecretPath, 0o600);
  } catch (_) { /* Windows não suporta chmod */ }
  return secret;
}

function generateSessionKey() {
  return crypto.createHash('sha256')
    .update('mysecrets-session-v2')
    .update(getMachineSecret())
    .digest();
}

/**
 * Criptografa dados da sessão (v2: AES-256-GCM, autenticado)
 */
function encryptSession(data) {
  const key = generateSessionKey();
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return {
    version: 2,
    encrypted,
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex')
  };
}

/**
 * Descriptografa dados da sessão (somente formato v2 — sessões antigas
 * são simplesmente descartadas e recriadas no próximo desbloqueio)
 */
function decryptSession(encryptedData) {
  try {
    if (encryptedData.version !== 2 || !encryptedData.authTag) {
      return null; // formato antigo: inválido a partir de agora
    }
    const key = generateSessionKey();
    const iv = Buffer.from(encryptedData.iv, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Erro ao descriptografar sessão:', error);
    return null;
  }
}

/**
 * Cria arquivo de sessão quando o usuário desbloqueia
 * Permite que a extensão Chrome acesse os dados
 * SEGURANÇA: Senha é criptografada com chave baseada no sistema
 */
function createSession(masterPassword) {
  const sessionData = {
    timestamp: Date.now(),
    pid: process.pid,
    unlocked: true,
    password: masterPassword,  // Será criptografado
    expiresAt: Date.now() + (15 * 60 * 1000), // 15 minutos
    hostname: require('os').hostname()
  };
  
  const encryptedSession = encryptSession(sessionData);
  fs.writeFileSync(sessionPath, JSON.stringify(encryptedSession), 'utf8');
  
  // Definir permissões restritas (apenas owner pode ler/escrever)
  // chmod 600 - rw-------
  try {
    fs.chmodSync(sessionPath, 0o600);
    console.log('✅ Sessão criptografada criada para extensão Chrome');
    console.log('   Permissões: 600 (apenas owner)');
    console.log('   Expira em: 15 minutos');
  } catch (error) {
    console.warn('⚠️ Não foi possível definir permissões restritas:', error.message);
  }
}

/**
 * Atualiza timestamp da sessão e verifica expiração
 */
function refreshSession() {
  if (fs.existsSync(sessionPath)) {
    try {
      const encryptedData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      const sessionData = decryptSession(encryptedData);
      
      if (!sessionData) {
        console.log('⚠️ Sessão corrompida ou inválida');
        destroySession();
        return false;
      }
      
      // Verificar expiração
      if (Date.now() > sessionData.expiresAt) {
        console.log('⚠️ Sessão expirada');
        destroySession();
        return false;
      }

      // Renovar: enquanto o app estiver aberto e desbloqueado, a sessão
      // continua válida (o renderer chama isto periodicamente)
      sessionData.timestamp = Date.now();
      sessionData.expiresAt = Date.now() + (15 * 60 * 1000);

      const encryptedSession = encryptSession(sessionData);
      fs.writeFileSync(sessionPath, JSON.stringify(encryptedSession), 'utf8');
      
      return true;
    } catch (error) {
      console.error('Erro ao atualizar sessão:', error);
      destroySession();
      return false;
    }
  }
  return false;
}

/**
 * Remove arquivo de sessão quando bloquear ou fechar
 */
function destroySession() {
  if (fs.existsSync(sessionPath)) {
    try {
      fs.unlinkSync(sessionPath);
      console.log('✅ Sessão removida');
    } catch (error) {
      console.error('Erro ao remover sessão:', error);
    }
  }
}

// ===== Windows Hello (login por digital/biometria) =====
//
// Usa a API WinRT UserConsentVerifier via PowerShell — não exige módulo nativo.
// A senha mestra fica guardada em hello.enc, criptografada com safeStorage
// (DPAPI no Windows, vinculada à conta do usuário). Ela só é liberada ao
// renderer depois que o Windows Hello confirma a biometria.

const isWSL = process.platform === 'linux' && os.release().toLowerCase().includes('microsoft');

function getPowerShellPath() {
  if (process.platform === 'win32') return 'powershell.exe';
  if (isWSL) {
    const interopPath = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
    if (fs.existsSync(interopPath)) return interopPath;
    return 'powershell.exe'; // interop do WSL resolve pelo PATH
  }
  return null;
}

/**
 * Executa um script PowerShell e retorna o stdout (trim).
 * Usa -EncodedCommand para evitar problemas de escaping/aspas.
 */
function runPowerShell(script, timeoutMs, onSpawn) {
  return new Promise((resolve, reject) => {
    const psPath = getPowerShellPath();
    if (!psPath) {
      reject(new Error('PowerShell não disponível nesta plataforma'));
      return;
    }
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = execFile(
      psPath,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(String(stdout).trim());
        }
      }
    );
    if (onSpawn) onSpawn(child);
  });
}

// Prelúdio comum: carrega o tipo WinRT e prepara o helper para aguardar
// IAsyncOperation (PowerShell 5.1 não tem await nativo para WinRT)
const HELLO_PS_PRELUDE = `
$ErrorActionPreference = 'Stop'
[Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType=WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]
`;

/**
 * Verifica se o Windows Hello está disponível e configurado.
 * Retorna { available, reason }
 */
let helloAvailabilityCache = null;

async function checkHelloAvailability() {
  if (process.platform !== 'win32' && !isWSL) {
    return { available: false, reason: 'Windows Hello só está disponível no Windows' };
  }

  // Cacheia apenas resultado positivo: indisponibilidade pode ser transitória
  // (dispositivo ocupado) ou mudar se o usuário configurar o Hello depois
  if (helloAvailabilityCache) {
    return helloAvailabilityCache;
  }

  const script = `${HELLO_PS_PRELUDE}
try {
  $task = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerifierAvailability]).Invoke($null, @([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()))
  $null = $task.Wait(10000)
  Write-Output ([int]$task.Result)
} catch {
  Write-Output 'ERR'
}`;

  try {
    const output = await runPowerShell(script, 20000);
    const code = parseInt(output, 10);
    // UserConsentVerifierAvailability: 0=Available, 1=DeviceNotPresent,
    // 2=NotConfiguredForUser, 3=DisabledByPolicy, 4=DeviceBusy
    const reasons = {
      1: 'Nenhum dispositivo biométrico encontrado',
      2: 'Windows Hello não está configurado para este usuário',
      3: 'Windows Hello desabilitado por política do sistema',
      4: 'Dispositivo biométrico ocupado'
    };
    if (code === 0) {
      helloAvailabilityCache = { available: true };
      return helloAvailabilityCache;
    }
    return { available: false, reason: reasons[code] || 'Windows Hello indisponível' };
  } catch (error) {
    console.error('Erro ao verificar Windows Hello:', error.message);
    return { available: false, reason: 'Não foi possível verificar o Windows Hello' };
  }
}

// IID de IAsyncOperation<UserConsentVerificationResult>: GUID paramétrico do
// WinRT, derivado (SHA-1) da assinatura do tipo. Conferido em
// tests/windows-hello.test.js.
const HELLO_ASYNC_OP_IID = 'fd596ffd-2318-558f-9dbe-d21df43764a5';

// Prompt em andamento: um só por vez, e cancelável (login com senha)
let helloPending = null; // { promise, child }

function cancelHelloVerification() {
  if (helloPending && helloPending.child) {
    try { helloPending.child.kill(); } catch (_) { /* já encerrou */ }
  }
}

/**
 * Abre o prompt do Windows Hello (digital/PIN/rosto).
 * Retorna true somente se o usuário for verificado.
 */
function requestHelloVerification(message) {
  if (helloPending) return helloPending.promise;
  const pending = { child: null };
  pending.promise = runHelloPrompt(message, (child) => { pending.child = child; })
    .finally(() => { if (helloPending === pending) helloPending = null; });
  helloPending = pending;
  return pending.promise;
}

async function runHelloPrompt(message, onSpawn) {
  // A mensagem é fixa (definida abaixo neste arquivo); escape defensivo de aspas simples
  const safeMessage = String(message).replace(/'/g, "''");
  // HWND da janela do app: o prompt nasce preso a ela
  let appHwnd = '0';
  if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
    const handle = mainWindow.getNativeWindowHandle();
    appHwnd = (handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))).toString();
  }
  // Caminho principal: RequestVerificationForWindowAsync (IUserConsentVerifierInterop),
  // a API da Microsoft para apps desktop. O prompt fica preso à janela do app,
  // sempre na frente, e o foco volta sozinho ao fechar.
  //
  // Reserva (interop falhou, ou WSL sem janela): RequestVerificationAsync, que
  // abre o prompt em segundo plano porque quem chama é um processo sem janela.
  // Aí é preciso caçar a janela do prompt e trazê-la para a frente.
  const script = `${HELLO_PS_PRELUDE}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("39E050C3-4E74-441A-8DC0-B81104DF949C"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
public interface IUserConsentVerifierInterop {
    [return: MarshalAs(UnmanagedType.IInspectable)]
    object RequestVerificationForWindowAsync(IntPtr appWindow, [MarshalAs(UnmanagedType.HString)] string message, [In] ref Guid riid);
}

public static class HelloInterop {
    [DllImport("combase.dll", PreserveSig = false)]
    static extern void RoGetActivationFactory([MarshalAs(UnmanagedType.HString)] string activatableClassId, [In] ref Guid iid, [MarshalAs(UnmanagedType.IInspectable)] out object factory);

    public static object Request(IntPtr hwnd, string message) {
        Guid factoryIid = typeof(IUserConsentVerifierInterop).GUID;
        Guid opIid = new Guid("${HELLO_ASYNC_OP_IID}");
        object factory;
        RoGetActivationFactory("Windows.Security.Credentials.UI.UserConsentVerifier", ref factoryIid, out factory);
        return ((IUserConsentVerifierInterop)factory).RequestVerificationForWindowAsync(hwnd, message, ref opIid);
    }
}

public static class Win32Focus {
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
function Focus-Window($hwnd) {
  # O toque de Alt libera a permissão de SetForegroundWindow
  [Win32Focus]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [Win32Focus]::SetForegroundWindow($hwnd) | Out-Null
  [Win32Focus]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
}

$resultType = [Windows.Security.Credentials.UI.UserConsentVerificationResult]
$app = [IntPtr]::new([Int64]${appHwnd})
try {
  # Só cai na reserva se o prompt preso à janela nem chegou a abrir
  $op = $null
  try {
    if ($app -ne [IntPtr]::Zero) { $op = [HelloInterop]::Request($app, '${safeMessage}') }
  } catch { }

  if ($op -ne $null) {
    $mode = 'INTEROP'
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($op))
    $null = $task.Wait(60000)
  } else {
    $mode = 'LEGACY'
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('${safeMessage}')))
    # Espera até 60 s e, enquanto isso, traz o prompt para a frente assim
    # que ele aparecer (pode demorar alguns segundos)
    $shown = $false
    for ($i = 0; $i -lt 300 -and -not $task.IsCompleted; $i++) {
      if (-not $shown) {
        $hwnd = [Win32Focus]::FindWindow('Credential Dialog Xaml Host', $null)
        if ($hwnd -ne [IntPtr]::Zero) {
          [Win32Focus]::ShowWindow($hwnd, 5) | Out-Null
          Focus-Window $hwnd
          $shown = $true
        }
      }
      Start-Sleep -Milliseconds 200
    }
  }

  # No modo reserva o foco fica com este processo sem janela e o teclado
  # para de responder até um Alt+Tab: devolve o foco ao app.
  if ($mode -eq 'LEGACY' -and $app -ne [IntPtr]::Zero) {
    Start-Sleep -Milliseconds 150
    Focus-Window $app
  }

  if ($task.IsCompleted) { Write-Output "$mode $([int]$task.Result)" } else { Write-Output "$mode TIMEOUT" }
} catch {
  Write-Output "ERR $($_.Exception.Message)"
}`;

  try {
    const output = await runPowerShell(script, 75000, onSpawn);
    console.log('Windows Hello:', output);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.focus();
    // UserConsentVerificationResult: 0 = Verified
    return /^(INTEROP|LEGACY) 0$/.test(output);
  } catch (error) {
    // Inclui o cancelamento (processo morto pelo login com senha)
    console.error('Erro na verificação Windows Hello:', error.message);
    return false;
  }
}

/**
 * Verifica a identidade do usuário via Windows Hello.
 * Nota: em leitores match-on-chip (ex.: notebooks Dell com Enhanced Sign-in
 * Security) a digital SÓ é acessível pela janela do Hello — a API antiga
 * WinBio abre sessão mas nunca recebe o toque, então não há modo silencioso.
 * Retorna { verified, error }
 */
async function verifyUserIdentity(message) {
  const verified = await requestHelloVerification(message);
  return verified
    ? { verified: true }
    : { verified: false, error: 'Verificação do Windows Hello cancelada ou falhou' };
}

// Fallback quando safeStorage não está disponível (ex.: WSL sem keyring):
// AES-256 com chave derivada da máquina/usuário. Mais fraco que DPAPI,
// mas impede que o arquivo seja útil se copiado para outra máquina/conta.
function machineKey() {
  const info = `mysecrets-hello-${os.hostname()}-${os.userInfo().username}`;
  return crypto.createHash('sha256').update(info).digest();
}

function helloEncryptSecret(text) {
  if (safeStorage.isEncryptionAvailable()) {
    return { method: 'safeStorage', payload: safeStorage.encryptString(text).toString('base64') };
  }
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', machineKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { method: 'machine', payload: encrypted, iv: iv.toString('hex') };
}

function helloDecryptSecret(stored) {
  if (stored.method === 'safeStorage') {
    return safeStorage.decryptString(Buffer.from(stored.payload, 'base64'));
  }
  const decipher = crypto.createDecipheriv('aes-256-cbc', machineKey(), Buffer.from(stored.iv, 'hex'));
  let decrypted = decipher.update(stored.payload, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function isHelloEnrolled() {
  return fs.existsSync(helloPath);
}

function removeHelloEnrollment() {
  if (fs.existsSync(helloPath)) {
    try {
      fs.unlinkSync(helloPath);
      console.log('✅ Cadastro Windows Hello removido');
    } catch (error) {
      console.error('Erro ao remover cadastro Windows Hello:', error);
    }
  }
}

// Status: disponibilidade + se já existe senha cadastrada para uso com Hello
ipcMain.handle('hello-status', async () => {
  const availability = await checkHelloAvailability();
  return {
    available: availability.available,
    reason: availability.reason || null,
    enrolled: isHelloEnrolled(),
    silent: false // leitores match-on-chip não permitem digital sem a janela do Hello
  };
});

// Habilita o login por digital: confirma a identidade no Hello e
// guarda a senha mestra criptografada
ipcMain.handle('hello-enroll', async (event, masterPassword) => {
  try {
    const availability = await checkHelloAvailability();
    if (!availability.available) {
      return { success: false, error: availability.reason };
    }

    const result = await verifyUserIdentity(
      'Confirme sua identidade para habilitar o login por digital no MySecrets'
    );
    if (!result.verified) {
      return { success: false, error: result.error };
    }

    const stored = { version: 1, ...helloEncryptSecret(masterPassword) };
    fs.writeFileSync(helloPath, JSON.stringify(stored), 'utf8');
    try {
      fs.chmodSync(helloPath, 0o600);
    } catch (_) { /* Windows não suporta chmod */ }

    console.log('✅ Login por Windows Hello habilitado');
    return { success: true };
  } catch (error) {
    console.error('Erro ao habilitar Windows Hello:', error);
    return { success: false, error: error.message };
  }
});

// Login por digital: prompt do Hello -> descriptografa e devolve a senha mestra
ipcMain.handle('hello-login', async () => {
  try {
    if (!isHelloEnrolled()) {
      return { success: false, error: 'Login por digital não está habilitado' };
    }

    const result = await verifyUserIdentity('Desbloqueie o MySecrets');
    if (!result.verified) {
      return { success: false, error: result.error };
    }

    const stored = JSON.parse(fs.readFileSync(helloPath, 'utf8'));
    const masterPassword = helloDecryptSecret(stored);
    return { success: true, password: masterPassword };
  } catch (error) {
    console.error('Erro no login Windows Hello:', error);
    return { success: false, error: 'Não foi possível recuperar as credenciais. Use a senha mestra.' };
  }
});

// Usuário entrou com a senha ou desistiu: fecha o prompt pendente
ipcMain.handle('hello-cancel', async () => {
  cancelHelloVerification();
  return { success: true };
});

// Desabilita o login por digital
ipcMain.handle('hello-disable', async () => {
  removeHelloEnrollment();
  return { success: true };
});

// ===== Gerenciamento do Servidor MCP (HTTP) =====
//
// Permite iniciar/parar o servidor MCP direto do app. O servidor roda como
// processo filho (mcp-server/http-server.js), escutando em 127.0.0.1 e exigindo
// um token bearer gerado aqui. Ele lê o cofre pela sessão (.session), então só
// funciona com o app desbloqueado.

let mcpProcess = null;
let mcpInfo = null; // { host, port, url, token, startedAt }
let mcpLastError = null;

function getMcpServerPath() {
  // Em dev: <raiz>/mcp-server/http-server.js. Empacotado: dentro de resources.
  const candidates = [
    path.join(__dirname, '..', 'mcp-server', 'http-server.js'),
    // Empacotado: mcp-server fica fora do asar (asarUnpack)
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'mcp-server', 'http-server.js'),
    path.join(process.resourcesPath || '', 'mcp-server', 'http-server.js'),
    path.join(process.resourcesPath || '', 'app', 'mcp-server', 'http-server.js')
  ];
  return candidates.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } }) || candidates[0];
}

function getMcpStatus() {
  return {
    running: !!mcpProcess,
    info: mcpProcess ? mcpInfo : null,
    error: mcpLastError
  };
}

// Token fixo entre reinícios: a extensão pareia uma vez só. Arquivo 0600 no
// perfil do usuário, mesmo nível de confiança do .machine-secret.
function getMcpToken() {
  try {
    const saved = fs.readFileSync(mcpTokenPath, 'utf8').trim();
    if (/^[0-9a-f]{48}$/.test(saved)) return saved;
  } catch (_) { /* primeira vez */ }
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(mcpTokenPath, token, { mode: 0o600 });
  return token;
}

function startMcpServer(options = {}) {
  return new Promise((resolve) => {
    if (mcpProcess) {
      return resolve({ success: true, status: getMcpStatus(), alreadyRunning: true });
    }

    const port = parseInt(options.port, 10) || 8765;
    const token = getMcpToken();
    const serverPath = getMcpServerPath();

    if (!fs.existsSync(serverPath)) {
      mcpLastError = 'Arquivo do servidor MCP não encontrado: ' + serverPath;
      return resolve({ success: false, error: mcpLastError });
    }

    mcpLastError = null;

    const child = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        // ELECTRON_RUN_AS_NODE faz o binário do Electron rodar como Node puro,
        // evitando depender de um Node instalado no sistema.
        ELECTRON_RUN_AS_NODE: '1',
        MYSECRETS_MCP_PORT: String(port),
        MYSECRETS_MCP_TOKEN: token,
        MYSECRETS_MCP_HOST: '127.0.0.1'
      },
      // 'ipc': canal para a extensão salvar logins pelo app (mysecrets/save_login)
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    child.on('message', (msg) => handleMcpMessage(child, msg));

    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };

    let stdoutBuf = '';
    child.stdout.on('data', (data) => {
      stdoutBuf += data.toString();
      const nl = stdoutBuf.indexOf('\n');
      if (nl >= 0 && !settled) {
        const line = stdoutBuf.slice(0, nl).trim();
        try {
          const ready = JSON.parse(line);
          if (ready && ready.ready) {
            mcpProcess = child;
            mcpInfo = {
              host: ready.host,
              port: ready.port,
              url: ready.url,
              token: ready.token || token,
              startedAt: Date.now()
            };
            console.log('✅ Servidor MCP iniciado em', mcpInfo.url);
            writeMcpEndpoint(mcpInfo.port);
            finish({ success: true, status: getMcpStatus() });
          }
        } catch (_) { /* linha não-JSON, ignora */ }
      }
    });

    child.stderr.on('data', (data) => {
      console.log('[MCP]', data.toString().trim());
    });

    child.on('error', (err) => {
      mcpLastError = err.message;
      mcpProcess = null;
      mcpInfo = null;
      finish({ success: false, error: err.message });
    });

    child.on('exit', (code, signal) => {
      console.log('Servidor MCP encerrado', code, signal || '');
      if (mcpProcess === child) removeMcpEndpoint();
      if (!settled) {
        mcpLastError = code === 2
          ? `Não foi possível iniciar (porta ${port} em uso?)`
          : `Servidor encerrou (código ${code})`;
        finish({ success: false, error: mcpLastError });
      }
      mcpProcess = null;
      mcpInfo = null;
      // Notifica o renderer que o servidor caiu
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mcp-stopped', { code, signal });
      }
    });

    // Timeout de segurança caso o "ready" nunca chegue
    setTimeout(() => {
      if (!settled) {
        try { child.kill(); } catch (_) {}
        mcpLastError = 'Tempo esgotado ao iniciar o servidor MCP';
        finish({ success: false, error: mcpLastError });
      }
    }, 8000);
  });
}

function writeMcpEndpoint(port) {
  try {
    fs.writeFileSync(mcpEndpointPath, JSON.stringify({ port, pid: process.pid }), { mode: 0o600 });
  } catch (err) {
    console.warn('⚠️ Não foi possível gravar .mcp-endpoint:', err.message);
  }
}

function removeMcpEndpoint() {
  try { fs.unlinkSync(mcpEndpointPath); } catch (_) { /* já removido */ }
}

function stopMcpServer() {
  removeMcpEndpoint();
  if (!mcpProcess) return { success: true, status: getMcpStatus() };
  try {
    mcpProcess.kill('SIGTERM');
  } catch (err) {
    return { success: false, error: err.message };
  }
  mcpProcess = null;
  mcpInfo = null;
  return { success: true, status: getMcpStatus() };
}

ipcMain.handle('mcp-status', async () => getMcpStatus());
// ===== Salvar login pedido pela extensão =====
//
// O servidor local (processo filho) repassa o pedido por IPC; quem grava é o
// renderer, que tem o cofre aberto em memória e salva como numa edição normal.

const extensionSaves = new Map();
const EXTENSION_SAVE_TIMEOUT = 10000;

function handleMcpMessage(child, msg) {
  if (msg && msg.type === 'agent_write') {
    handleAgentWrite(child, msg);
    return;
  }
  if (msg && msg.type === 'pair_request') {
    approveExtension(msg.payload && msg.payload.origin).then((ok) => {
      const result = ok ? { success: true } : { success: false, error: 'Conexão recusada no app' };
      try { child.send({ type: 'pair_result', reqId: msg.reqId, result }); } catch (_) { /* filho encerrado */ }
    });
    return;
  }
  if (!msg || msg.type !== 'save_login') return;
  const responder = (result) => {
    try { child.send({ type: 'save_login_result', reqId: msg.reqId, result }); } catch (_) { /* filho encerrado */ }
  };
  if (!mainWindow || mainWindow.isDestroyed()) {
    responder({ success: false, error: 'App sem janela aberta' });
    return;
  }
  extensionSaves.set(msg.reqId, responder);
  setTimeout(() => {
    if (extensionSaves.delete(msg.reqId)) responder({ success: false, error: 'O app não respondeu' });
  }, EXTENSION_SAVE_TIMEOUT);
  mainWindow.webContents.send('extension-save-login', { reqId: msg.reqId, ...msg.payload });
}

// ===== Pareamento automático da extensão =====
//
// A extensão pede o token em POST /pair (ver mcp-server/http-server.js). Na
// primeira vez que um id de extensão pede, o app pergunta ao usuário; aprovado,
// o id fica em extension-origins.json e as próximas conexões são silenciosas.

function trustedExtensions() {
  try {
    const list = JSON.parse(fs.readFileSync(trustedExtensionsPath, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

const pairPrompts = new Map(); // origin -> Promise<boolean>, evita perguntar duas vezes

function approveExtension(origin) {
  if (typeof origin !== 'string' || !/^(chrome|moz)-extension:\/\/[\w-]+$/.test(origin)) return Promise.resolve(false);
  if (trustedExtensions().includes(origin)) return Promise.resolve(true);
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(false);

  if (!pairPrompts.has(origin)) {
    const ask = (async () => {
      mainWindow.show();
      mainWindow.focus();
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Conectar extensão',
        message: 'Uma extensão do navegador quer se conectar ao MySecrets',
        detail: `${origin}\n\nPermita só se você acabou de instalar ou abrir a extensão MySecrets Autofill. ` +
          'Ela poderá preencher logins enquanto o cofre estiver desbloqueado.',
        buttons: ['Permitir', 'Recusar'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      });
      if (response !== 0) return false;
      fs.writeFileSync(trustedExtensionsPath, JSON.stringify([...trustedExtensions(), origin]), { mode: 0o600 });
      return true;
    })().finally(() => pairPrompts.delete(origin));
    pairPrompts.set(origin, ask);
  }
  return pairPrompts.get(origin);
}

ipcMain.handle('extension-save-result', async (event, reqId, result) => {
  const responder = extensionSaves.get(reqId);
  if (responder) {
    extensionSaves.delete(reqId);
    responder(result);
  }
  return true;
});

// ===== Gravação pedida por agente (MCP store_secret / store_secret_file) =====
//
// O servidor local repassa o pedido por IPC. O app confere os anexos (tamanho
// e sha256), pede ao renderer um resumo (entrada nova ou existente, campos que
// mudam, arquivos substituídos), mostra um diálogo nativo e só grava se o
// usuário aprovar. Os pedidos entram numa fila: um diálogo por vez. Nenhum
// valor secreto vai para o diálogo nem para o log.

const AGENT_PREVIEW_TIMEOUT = 15000;
const AGENT_APPLY_TIMEOUT = 30000;
const rendererAsks = new Map();
let agentWriteQueue = Promise.resolve();

function askRenderer(op, request, timeout) {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      resolve({ success: false, error: 'App sem janela aberta' });
      return;
    }
    const reqId = crypto.randomUUID();
    const timer = setTimeout(() => {
      if (rendererAsks.delete(reqId)) resolve({ success: false, error: 'O app não respondeu' });
    }, timeout);
    rendererAsks.set(reqId, (result) => { clearTimeout(timer); resolve(result); });
    mainWindow.webContents.send('agent-write', { reqId, op, request });
  });
}

ipcMain.handle('agent-write-result', async (event, reqId, result) => {
  const done = rendererAsks.get(reqId);
  if (done) {
    rendererAsks.delete(reqId);
    done(result || { success: false, error: 'Resposta vazia' });
  }
  return true;
});

// Texto vindo do agente vai para o diálogo numa linha só e curto
function oneLine(text, max = 120) {
  const t = String(text == null ? '' : text).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function validateAgentRequest(req) {
  if (!req || typeof req !== 'object' || !req.target) throw new Error('Pedido de gravação inválido');
  if (!Array.isArray(req.files)) req.files = [];
  if (req.files.length > attachmentFiles.MAX_ATTACHMENTS_PER_ENTRY) throw new Error('Arquivos demais num pedido');
  req.files.forEach((f) => {
    attachmentFiles.verifyAttachment(f);
    f.name = attachmentFiles.sanitizeName(f.name);
  });
  return req;
}

function agentDialogDetail(plan) {
  const linhas = [];
  linhas.push(`Tipo: ${plan.type}`);
  if (plan.tags.length) linhas.push(`Projeto/tags: ${plan.tags.map((t) => oneLine(t, 60)).join(', ')}`);
  if (plan.fields.length) {
    linhas.push('Campos: ' + plan.fields.map((f) => f.label + (f.replaces ? ' (substitui)' : '')).join(', '));
  }
  if (plan.customFields.length) {
    linhas.push('Campos personalizados: ' +
      plan.customFields.map((c) => oneLine(c.name, 60) + (c.replaces ? ' (substitui)' : '')).join(', '));
  }
  if (plan.files.length) {
    linhas.push('Arquivos:');
    plan.files.forEach((f) => {
      linhas.push(`  • ${oneLine(f.name, 80)} — ${attachmentFiles.formatSize(f.size)} — sha256 ${String(f.sha256).slice(0, 12)}…` +
        (f.replaces ? ' (substitui o anexo atual)' : ''));
    });
  }
  linhas.push('');
  linhas.push('Os valores não aparecem aqui. Permita só se você pediu isto a um assistente agora.');
  return linhas.join('\n');
}

async function processAgentWrite(request) {
  if (!mainWindow || mainWindow.isDestroyed()) return { success: false, error: 'App sem janela aberta' };
  validateAgentRequest(request);

  // O resumo não precisa do conteúdo dos arquivos
  const semConteudo = { ...request, files: request.files.map(({ data, ...meta }) => meta) };
  const preview = await askRenderer('preview', semConteudo, AGENT_PREVIEW_TIMEOUT);
  if (!preview.success) return preview;
  const plan = preview.plan;

  mainWindow.show();
  mainWindow.focus();
  const titulo = oneLine(plan.title, 80);
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Gravação pedida por um agente',
    message: plan.mode === 'new'
      ? `Um agente (MCP) quer CRIAR a entrada "${titulo}"`
      : `Um agente (MCP) quer ATUALIZAR a entrada "${titulo}"`,
    detail: agentDialogDetail(plan),
    buttons: ['Gravar no cofre', 'Recusar'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (response !== 0) {
    console.log('Gravação de agente recusada pelo usuário');
    return { success: false, declined: true, error: 'O usuário recusou a gravação no app.' };
  }

  const result = await askRenderer('apply', request, AGENT_APPLY_TIMEOUT);
  if (result.success) {
    console.log(`✅ Gravação de agente aplicada (${result.mode}, ${request.files.length} arquivo(s))`);
  }
  return result;
}

function handleAgentWrite(child, msg) {
  const responder = (result) => {
    try { child.send({ type: 'agent_write_result', reqId: msg.reqId, result }); } catch (_) { /* filho encerrado */ }
  };
  agentWriteQueue = agentWriteQueue
    .then(() => processAgentWrite(msg.payload))
    .then(responder, (err) => responder({ success: false, error: err.message }));
}

// ===== Anexos pela interface =====

ipcMain.handle('attachment-pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Anexar arquivo ao cofre',
    properties: ['openFile', 'multiSelections']
  });
  if (result.canceled || result.filePaths.length === 0) return { success: true, files: [] };
  try {
    const files = result.filePaths.map((p) => attachmentFiles.readFileAsAttachment(p));
    return { success: true, files };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('attachment-save', async (event, att) => {
  try {
    attachmentFiles.verifyAttachment(att);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar anexo',
      defaultPath: path.join(app.getPath('downloads'), attachmentFiles.sanitizeName(att.name))
    });
    if (result.canceled || !result.filePath) return { success: true, canceled: true };
    // O diálogo do sistema já perguntou se pode substituir
    const saved = attachmentFiles.writeAttachmentToPath(att, result.filePath, { overwrite: true });
    return { success: true, path: saved.path };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mcp-start', async (event, options) => startMcpServer(options || {}));
ipcMain.handle('mcp-stop', async () => stopMcpServer());

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log('Caminho do preload:', preloadPath);
  console.log('Preload existe?', fs.existsSync(preloadPath));
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: preloadPath
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  // Mostrar janela quando estiver pronta.
  // O evento ready-to-show nao dispara de forma confiavel em ambientes com
  // renderizacao por software (WSL2, VMs, sessoes remotas). Como a janela nasce
  // com show: false, uma falha do evento a deixaria invisivel para sempre --
  // aparece o icone na barra de tarefas, mas nenhuma tela. Dai os fallbacks.
  // show() nao levanta nem ativa a janela: sob WSLg/X11 ela sobe atras das
  // demais, aparecendo so como icone na barra de tarefas. Dai o focus().
  const showWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.moveTop();
    mainWindow.focus();
  };

  mainWindow.once('ready-to-show', showWindow);
  mainWindow.webContents.once('did-finish-load', showWindow);
  setTimeout(showWindow, 3000);

  // DevTools somente em modo dev (--dev). Ancorado, ele ocupa metade da janela
  // e esconde a UI, fazendo o app parecer que nao abriu tela. Num gerenciador
  // de senhas tambem expoe o cofre destravado a quem alcance a maquina.
  if (isDevMode) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Menu da aplicação
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Exportar Backup',
          click: () => exportBackup()
        },
        {
          label: 'Importar Backup',
          click: () => importBackup()
        },
        { type: 'separator' },
        {
          label: 'Sair',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' }
      ]
    },
    {
      label: 'Visualizar',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'forceReload', label: 'Forçar Recarregamento' },
        { role: 'toggleDevTools', label: 'Ferramentas do Desenvolvedor' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom Padrão' },
        { role: 'zoomIn', label: 'Aumentar Zoom' },
        { role: 'zoomOut', label: 'Diminuir Zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela Cheia' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Criptografia do cofre: ver src/lib/vault-crypto.js
// (v2: AES-256-GCM + PBKDF2 600k; lê e migra o formato legado v1 CBC)
const { encryptVault, decryptVault, isLegacyFormat } = vaultCrypto;

// ===== Backup automático =====
//
// A cada salvamento, se o backup mais recente tiver mais de 6 horas,
// grava uma cópia do cofre criptografado em userData/backups (mantém 14).

const AUTO_BACKUP_MIN_INTERVAL = 6 * 60 * 60 * 1000; // 6 horas
const AUTO_BACKUP_KEEP = 14;

function listAutoBackups() {
  try {
    if (!fs.existsSync(backupsPath())) return [];
    return fs.readdirSync(backupsPath())
      .filter((f) => /^vault-.*\.enc$/.test(f))
      .map((f) => {
        const full = path.join(backupsPath(), f);
        return { file: full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (_) {
    return [];
  }
}

function maybeAutoBackup() {
  try {
    if (!fs.existsSync(vaultFile())) return;

    const backups = listAutoBackups();
    if (backups.length > 0 && Date.now() - backups[0].mtime < AUTO_BACKUP_MIN_INTERVAL) {
      return; // backup recente já existe
    }

    if (!fs.existsSync(backupsPath())) {
      fs.mkdirSync(backupsPath(), { recursive: true });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(vaultFile(), path.join(backupsPath(), `vault-${stamp}.enc`));

    // Rotaciona: mantém apenas os mais recentes
    listAutoBackups().slice(AUTO_BACKUP_KEEP).forEach((b) => {
      try { fs.unlinkSync(b.file); } catch (_) {}
    });
    console.log('✅ Backup automático criado');
  } catch (error) {
    console.warn('⚠️ Falha no backup automático:', error.message);
  }
}

// ===== Leitura/gravação do cofre e sincronização =====

// Estado do arquivo na última leitura/gravação deste PC: o hash revela se outro
// PC (via Google Drive) gravou uma versão nova; os ids revelam exclusões
// definitivas feitas aqui desde então.
let vaultState = { hash: null, ids: new Set() };

function fileHash(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (_) {
    return null;
  }
}

function rememberVault(entries) {
  vaultState = {
    hash: fileHash(vaultFile()),
    ids: new Set((entries || []).map((e) => e && e.id).filter(Boolean))
  };
}

function readVaultEntries(file, masterPassword) {
  return JSON.parse(decryptVault(JSON.parse(fs.readFileSync(file, 'utf8')), masterPassword));
}

/**
 * Grava via arquivo temporário + rename, para a nuvem nunca sincronizar um
 * cofre pela metade. Se o rename falhar (arquivo preso pelo cliente do Drive
 * no Windows), grava direto.
 */
function writeVaultFile(entries, masterPassword) {
  const file = vaultFile();
  const conteudo = JSON.stringify(encryptVault(JSON.stringify(entries), masterPassword));
  const tmp = path.join(path.dirname(file), '.' + path.basename(file) + '.tmp');
  try {
    fs.writeFileSync(tmp, conteudo);
    fs.renameSync(tmp, file);
  } catch (_) {
    fs.writeFileSync(file, conteudo);
    try { fs.unlinkSync(tmp); } catch (__) {}
  }
}

/**
 * Junta as entradas deste PC com o que chegou pela pasta sincronizada: uma
 * versão nova do secrets.enc gravada por outro PC, cópias de conflito criadas
 * pela nuvem e exclusões definitivas (lápides). Cópias de conflito mescladas
 * vão para backups/. Cópias com outra senha mestra são deixadas como estão.
 */
function mergeWithSyncFolder(entries, masterPassword, deletedNow = []) {
  const dir = vaultDir();
  const file = vaultFile();
  const fontes = [entries];

  if (fs.existsSync(file) && fileHash(file) !== vaultState.hash) {
    fontes.push(readVaultEntries(file, masterPassword));
  }

  const conflitos = [];
  for (const copia of vaultSync.findConflictCopies(dir)) {
    try {
      fontes.push(readVaultEntries(copia, masterPassword));
      conflitos.push(copia);
    } catch (_) {
      console.warn('Cópia de conflito ignorada (outra senha ou arquivo inválido):', path.basename(copia));
    }
  }

  const { tombstones, files } = vaultSync.readTombstones(dir);
  const agora = new Date().toISOString();
  const novas = {};
  deletedNow.forEach((id) => { novas[id] = agora; });
  const todas = vaultSync.mergeTombstones(tombstones, novas);
  if (deletedNow.length > 0 || files.length > 1) {
    vaultSync.writeTombstones(dir, todas, files);
  }

  const merged = vaultSync.mergeVaults(fontes, todas);

  if (conflitos.length > 0) {
    const destino = path.join(backupsPath(), 'conflitos');
    fs.mkdirSync(destino, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    conflitos.forEach((copia) => {
      try {
        fs.renameSync(copia, path.join(destino, `${stamp}-${path.basename(copia)}`));
      } catch (_) { /* fica para a próxima */ }
    });
  }

  return { entries: merged, merged: fontes.length > 1 || merged.length !== entries.length };
}

// Avisa o renderer quando outro PC atualiza o cofre na pasta sincronizada
let watchedVaultFile = null;

function startVaultWatcher() {
  stopVaultWatcher();
  if (!isSyncEnabled()) return;
  watchedVaultFile = vaultFile();
  fs.watchFile(watchedVaultFile, { interval: 5000 }, () => {
    const hash = fileHash(watchedVaultFile);
    if (hash && hash !== vaultState.hash && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vault-changed');
    }
  });
}

function stopVaultWatcher() {
  if (watchedVaultFile) {
    fs.unwatchFile(watchedVaultFile);
    watchedVaultFile = null;
  }
}

// IPC Handlers
ipcMain.handle('save-data', async (event, data, masterPassword, options = {}) => {
  try {
    let entries = data;
    let merged = false;
    if (isGdriveConnected()) {
      recordLocalTombstones(vaultSync.removedIds(vaultState.ids, data));
    }
    if (isSyncEnabled()) {
      const r = mergeWithSyncFolder(data, masterPassword, vaultSync.removedIds(vaultState.ids, data));
      entries = r.entries;
      merged = r.merged;
    }
    writeVaultFile(entries, masterPassword);
    rememberVault(entries);
    if (isGdriveConnected()) {
      gdrive.password = masterPassword;
      scheduleGdriveSync();
    }
    if (options.autoBackup !== false) {
      maybeAutoBackup();
    }
    return merged ? { success: true, merged: true, data: entries } : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-data', async (event, masterPassword) => {
  try {
    if (!fs.existsSync(vaultFile())) {
      // Cria sessão mesmo sem dados
      rememberVault([]);
      createSession(masterPassword);
      startVaultWatcher();
      startGdrive(masterPassword);
      return { success: true, data: [] };
    }

    const encryptedData = JSON.parse(fs.readFileSync(vaultFile(), 'utf8'));
    const decryptedData = decryptVault(encryptedData, masterPassword);
    let entries = JSON.parse(decryptedData);

    // Migração transparente: cofres no formato legado (AES-CBC, PBKDF2 100k)
    // são regravados no formato v2 (AES-GCM, PBKDF2 600k) no primeiro acesso
    if (isLegacyFormat(encryptedData)) {
      try {
        writeVaultFile(entries, masterPassword);
        console.log('✅ Cofre migrado para o formato v2 (AES-256-GCM)');
      } catch (migrationError) {
        console.error('Erro na migração do cofre (dados seguem legíveis):', migrationError);
      }
    }

    // Sincronização: mescla cópias de conflito e exclusões vindas de outro PC
    if (isSyncEnabled()) {
      rememberVault(entries);
      try {
        const r = mergeWithSyncFolder(entries, masterPassword);
        if (r.merged) writeVaultFile(r.entries, masterPassword);
        entries = r.entries;
      } catch (syncError) {
        console.error('Erro ao mesclar a pasta sincronizada (cofre segue legível):', syncError);
      }
    }

    rememberVault(entries);

    // Cria sessão quando desbloquear com sucesso
    createSession(masterPassword);
    startVaultWatcher();
    startGdrive(masterPassword);

    return { success: true, data: entries };
  } catch (error) {
    return { success: false, error: 'Senha mestra incorreta ou dados corrompidos' };
  }
});

ipcMain.handle('check-data-exists', async () => {
  return fs.existsSync(vaultFile());
});

ipcMain.handle('reset-data', async () => {
  try {
    if (isGdriveConnected()) {
      // Idem para o Google Drive: só esquece a conta neste PC
      stopGdrive();
      gdrive.client = null;
      fs.unlinkSync(gdriveStatePath);
    }
    if (isSyncEnabled()) {
      // Não apaga o cofre da nuvem (os outros PCs dependem dele): só desliga
      // a sincronização neste PC e apaga o cofre local.
      stopVaultWatcher();
      vaultSync.writeVaultLocation(userDataPath, null);
    }
    if (fs.existsSync(vaultFile())) {
      fs.unlinkSync(vaultFile());
    }
    destroySession();
    removeHelloEnrollment();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ===== Sincronização (Google Drive ou outra pasta sincronizada) =====

ipcMain.handle('sync-status', async () => ({
  enabled: isSyncEnabled(),
  dir: isSyncEnabled() ? vaultDir() : null,
  detected: vaultSync.detectGoogleDrive()
}));

ipcMain.handle('sync-choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Escolha a pasta do Google Drive',
    defaultPath: vaultSync.detectGoogleDrive() || undefined,
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('sync-enable', async (event, baseDir, masterPassword) => {
  try {
    if (isGdriveConnected()) {
      return { success: false, error: 'Desconecte a conta Google antes de usar uma pasta sincronizada.' };
    }
    if (!baseDir || !fs.existsSync(baseDir)) {
      return { success: false, error: 'Pasta não encontrada.' };
    }
    const destino = vaultSync.syncFolderFor(baseDir);
    if (path.resolve(destino) === path.resolve(vaultDir())) {
      return { success: false, error: 'O cofre já está nessa pasta.' };
    }

    const local = fs.existsSync(vaultFile()) ? readVaultEntries(vaultFile(), masterPassword) : [];
    vaultSync.prepareSyncFolder(destino);

    // Outro PC já sincroniza nessa pasta: mescla os dois cofres
    const remotoFile = path.join(destino, vaultSync.VAULT_FILE);
    let entries = local;
    let existia = false;
    if (fs.existsSync(remotoFile)) {
      let remoto;
      try {
        remoto = readVaultEntries(remotoFile, masterPassword);
      } catch (_) {
        return {
          success: false,
          error: 'Já existe um cofre nessa pasta com outra senha mestra. Use a mesma senha mestra em todos os PCs.'
        };
      }
      existia = true;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.copyFileSync(remotoFile, path.join(destino, 'backups', `vault-antes-de-mesclar-${stamp}.enc`));
      entries = vaultSync.mergeVaults([local, remoto], vaultSync.readTombstones(destino).tombstones);
    }

    vaultSync.writeVaultLocation(userDataPath, destino);
    writeVaultFile(entries, masterPassword);
    rememberVault(entries);
    startVaultWatcher();
    return { success: true, dir: destino, merged: existia, data: entries };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/** Desliga a sincronização por pasta trazendo a versão atual para este PC. */
function disableFolderSync() {
  if (!isSyncEnabled()) return;
  stopVaultWatcher();

  const origem = vaultFile();
  const localFile = path.join(userDataPath, vaultSync.VAULT_FILE);
  if (fs.existsSync(origem)) {
    if (fs.existsSync(localFile)) {
      const localBackups = path.join(userDataPath, 'backups');
      fs.mkdirSync(localBackups, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.copyFileSync(localFile, path.join(localBackups, `vault-antes-de-desligar-sync-${stamp}.enc`));
    }
    fs.copyFileSync(origem, localFile);
  }

  vaultSync.writeVaultLocation(userDataPath, null);
  vaultState.hash = fileHash(localFile);
}

ipcMain.handle('sync-disable', async () => {
  try {
    disableFolderSync();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ===== Sincronização com login do Google (Google Drive API) =====
//
// O cofre continua local (userData/secrets.enc, funciona offline) e uma cópia
// criptografada vai para a pasta "MySecrets" no Drive do usuário. Cada
// sincronização baixa a versão da nuvem se ela mudou, mescla entrada por
// entrada (vault-sync.js), grava localmente e envia o resultado. Roda ao
// desbloquear, alguns segundos depois de cada alteração e a cada minuto.
// O refresh token fica protegido pelo cofre do sistema (safeStorage) ou, sem
// ele, pelo segredo de máquina.

const gdriveStatePath = path.join(userDataPath, 'google-drive.json');
const GDRIVE_FOLDER = 'MySecrets';
const GDRIVE_INTERVAL = 60 * 1000;
const GDRIVE_LEIA_ME = `MySecrets — cofre sincronizado
==============================

Esta pasta é mantida pelo app MySecrets (login com Google).

- secrets.enc: o seu cofre, criptografado com AES-256-GCM. Sem a senha mestra
  ninguém consegue ler, nem o Google.
- .mysecrets-exclusoes.json: identificadores de itens apagados (sem dados).

Não edite nem apague esses arquivos. Para usar em outro PC, instale o
MySecrets, crie o cofre com a mesma senha mestra e, em Configurações >
Sincronização, clique em "Entrar com Google".
`;

const gdrive = { client: null, password: null, timer: null, debounce: null, running: null, again: false };

function readGdriveState() {
  try {
    return JSON.parse(fs.readFileSync(gdriveStatePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeGdriveState(state) {
  fs.writeFileSync(gdriveStatePath, JSON.stringify(state, null, 2));
  try { fs.chmodSync(gdriveStatePath, 0o600); } catch (_) { /* Windows */ }
}

function updateGdriveState(patch) {
  writeGdriveState({ ...(readGdriveState() || {}), ...patch });
}

function protectToken(token) {
  if (safeStorage.isEncryptionAvailable()) {
    return { kind: 'safeStorage', data: safeStorage.encryptString(token).toString('base64') };
  }
  return { kind: 'machine', data: encryptSession({ token }) };
}

function unprotectToken(p) {
  if (p.kind === 'safeStorage') return safeStorage.decryptString(Buffer.from(p.data, 'base64'));
  const d = decryptSession(p.data);
  return d && d.token;
}

function isGdriveConnected() {
  const st = readGdriveState();
  return !!(st && st.token);
}

function gdriveClient() {
  if (gdrive.client) return gdrive.client;
  const cfg = googleDrive.loadClientConfig();
  const st = readGdriveState();
  if (!cfg || !st || !st.token) return null;
  const refreshToken = unprotectToken(st.token);
  if (!refreshToken) return null;
  gdrive.client = new googleDrive.DriveClient(cfg, refreshToken);
  return gdrive.client;
}

function gdriveStatus() {
  const st = readGdriveState() || {};
  return {
    available: !!googleDrive.loadClientConfig(),
    connected: !!st.token,
    email: st.email || '',
    lastSyncAt: st.lastSyncAt || null,
    lastError: st.lastError || null,
    syncing: !!gdrive.running
  };
}

function notifyGdrive() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('gdrive-status', gdriveStatus());
  }
}

const entriesHash = (entries) => crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');

/** Exclusões definitivas feitas neste PC viram lápides locais (enviadas no sync). */
function recordLocalTombstones(ids) {
  if (!ids.length) return;
  const { tombstones, files } = vaultSync.readTombstones(userDataPath);
  const agora = new Date().toISOString();
  ids.forEach((id) => { tombstones[id] = agora; });
  vaultSync.writeTombstones(userDataPath, tombstones, files);
}

async function runGdriveSync(masterPassword) {
  const client = gdriveClient();
  if (!client || !masterPassword) return;
  const st = readGdriveState() || {};

  try {
    let folderId = st.folderId;
    if (!folderId) {
      folderId = await client.ensureFolder(GDRIVE_FOLDER);
      if (!(await client.findFile('LEIA-ME.txt', folderId))) {
        await client.upload('LEIA-ME.txt', folderId, GDRIVE_LEIA_ME, null, 'text/plain');
      }
    }

    const local = fs.existsSync(vaultFile()) ? readVaultEntries(vaultFile(), masterPassword) : [];
    const remoteMeta = await client.findFile(vaultSync.VAULT_FILE, folderId);
    const tombMeta = await client.findFile(vaultSync.TOMBSTONES_FILE, folderId);

    // Só baixa o cofre da nuvem se ele mudou desde a última sincronização
    let remote = null;
    if (remoteMeta && remoteMeta.md5Checksum !== st.lastRemoteMd5) {
      try {
        remote = readEncryptedEntries(await client.download(remoteMeta.id), masterPassword);
      } catch (_) {
        throw new Error('O cofre no Google Drive usa outra senha mestra (ou está corrompido).');
      }
    }

    const localT = vaultSync.readTombstones(userDataPath);
    let remoteT = {};
    if (tombMeta) {
      try { remoteT = JSON.parse(await client.download(tombMeta.id)); } catch (_) { remoteT = {}; }
    }
    const tombs = vaultSync.mergeTombstones(localT.tombstones, remoteT);

    const merged = vaultSync.mergeVaults(remote ? [local, remote] : [local], tombs);
    const mergedHash = entriesHash(merged);

    // Chegou algo de outro PC: grava localmente e avisa a tela
    if (entriesHash(local) !== mergedHash) {
      writeVaultFile(merged, masterPassword);
      rememberVault(merged);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('vault-changed');
    }

    // Envia se a nuvem não tem o resultado da mesclagem
    const remoteHash = remote ? entriesHash(remote) : (remoteMeta ? st.lastSyncedHash : null);
    let md5 = remoteMeta ? remoteMeta.md5Checksum : null;
    if (!remoteMeta || mergedHash !== remoteHash) {
      const conteudo = JSON.stringify(encryptVault(JSON.stringify(merged), masterPassword));
      const up = await client.upload(vaultSync.VAULT_FILE, folderId, conteudo, remoteMeta && remoteMeta.id);
      md5 = up.md5Checksum;
    }

    if (JSON.stringify(tombs) !== JSON.stringify(remoteT)) {
      await client.upload(vaultSync.TOMBSTONES_FILE, folderId, JSON.stringify(tombs), tombMeta && tombMeta.id, 'application/json');
    }
    if (JSON.stringify(tombs) !== JSON.stringify(localT.tombstones)) {
      vaultSync.writeTombstones(userDataPath, tombs, localT.files);
    }

    updateGdriveState({
      folderId,
      lastRemoteMd5: md5,
      lastSyncedHash: mergedHash,
      lastSyncAt: new Date().toISOString(),
      lastError: null
    });
  } catch (error) {
    if (error.code === 'invalid_grant' || error.code === 'insufficient_scope') {
      // Acesso revogado ou sem a permissão do Drive: precisa entrar de novo
      gdrive.client = null;
      updateGdriveState({
        token: null,
        lastError: error.code === 'invalid_grant' ? 'O acesso ao Google foi revogado. Entre novamente.' : error.message
      });
    } else {
      updateGdriveState({ lastError: error.message });
    }
    console.error('Sincronização com Google Drive falhou:', error.message);
  }
}

function readEncryptedEntries(conteudo, masterPassword) {
  return JSON.parse(decryptVault(JSON.parse(conteudo), masterPassword));
}

/** Uma sincronização por vez; pedidos durante uma execução geram mais uma rodada. */
function gdriveSync(masterPassword = gdrive.password) {
  if (!isGdriveConnected() || !masterPassword) return Promise.resolve();
  if (gdrive.running) {
    gdrive.again = true;
    return gdrive.running;
  }
  notifyGdrive();
  gdrive.running = runGdriveSync(masterPassword).finally(() => {
    gdrive.running = null;
    notifyGdrive();
    if (gdrive.again) {
      gdrive.again = false;
      gdriveSync();
    }
  });
  return gdrive.running;
}

function scheduleGdriveSync(delayMs = 3000) {
  if (!isGdriveConnected() || !gdrive.password) return;
  clearTimeout(gdrive.debounce);
  gdrive.debounce = setTimeout(() => gdriveSync(), delayMs);
}

function startGdrive(masterPassword) {
  if (!isGdriveConnected()) return;
  gdrive.password = masterPassword;
  clearInterval(gdrive.timer);
  gdrive.timer = setInterval(() => gdriveSync(), GDRIVE_INTERVAL);
  scheduleGdriveSync(500);
}

function stopGdrive() {
  clearInterval(gdrive.timer);
  clearTimeout(gdrive.debounce);
  gdrive.timer = null;
  gdrive.password = null;
}

ipcMain.handle('gdrive-status', async () => gdriveStatus());

ipcMain.handle('gdrive-connect', async (event, masterPassword) => {
  const cfg = googleDrive.loadClientConfig();
  if (!cfg) return { success: false, error: 'Esta versão do app não tem o login com Google configurado.' };
  try {
    disableFolderSync(); // as duas formas de sincronizar não convivem

    const auth = await googleDrive.authorize(cfg, (url) => shell.openExternal(url));
    writeGdriveState({ email: auth.email, token: protectToken(auth.refreshToken) });
    gdrive.client = new googleDrive.DriveClient(cfg, auth.refreshToken);
    gdrive.client.accessToken = auth.accessToken;
    gdrive.client.expiresAt = auth.expiresAt;

    await gdriveSync(masterPassword);
    const st = readGdriveState() || {};
    if (st.lastError) {
      // Primeira sincronização falhou (ex.: senha mestra diferente): não fica meio conectado
      await googleDrive.revoke(auth.refreshToken);
      gdrive.client = null;
      fs.unlinkSync(gdriveStatePath);
      return { success: false, error: st.lastError };
    }

    startGdrive(masterPassword);
    return { success: true, status: gdriveStatus() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('gdrive-sync-now', async (event, masterPassword) => {
  if (masterPassword) gdrive.password = masterPassword;
  await gdriveSync(masterPassword || gdrive.password);
  return gdriveStatus();
});

ipcMain.handle('gdrive-disconnect', async () => {
  try {
    const client = gdriveClient();
    stopGdrive();
    if (client) await googleDrive.revoke(client.refreshToken);
    gdrive.client = null;
    if (fs.existsSync(gdriveStatePath)) fs.unlinkSync(gdriveStatePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handler para atualizar sessão (chamado periodicamente pelo renderer)
ipcMain.handle('refresh-session', async () => {
  const success = refreshSession();
  return { success };
});

// Handler para bloquear (destruir sessão)
ipcMain.handle('lock', async () => {
  destroySession();
  stopVaultWatcher();
  stopGdrive();
  return { success: true };
});

// ===== Clipboard com limpeza automática =====
//
// Copia via processo principal e, se configurado, limpa o clipboard após N
// segundos — apenas se ele ainda contiver o valor copiado (não apaga algo
// que o usuário copiou depois).

let clipboardClearTimer = null;

ipcMain.handle('copy-to-clipboard', async (event, text, clearAfterSeconds = 0) => {
  try {
    clipboard.writeText(String(text));

    if (clipboardClearTimer) {
      clearTimeout(clipboardClearTimer);
      clipboardClearTimer = null;
    }

    const seconds = parseInt(clearAfterSeconds, 10) || 0;
    if (seconds > 0) {
      const copied = String(text);
      clipboardClearTimer = setTimeout(() => {
        try {
          if (clipboard.readText() === copied) {
            clipboard.clear();
            console.log('✅ Clipboard limpo automaticamente');
          }
        } catch (_) { /* clipboard indisponível */ }
        clipboardClearTimer = null;
      }, seconds * 1000);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ===== Backup manual (exportar/restaurar) via modal de configurações =====

ipcMain.handle('export-backup', async () => {
  try {
    await exportBackup();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('import-backup', async () => {
  try {
    await importBackup();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-backups', async () => {
  return listAutoBackups().map((b) => ({
    file: b.file,
    name: path.basename(b.file),
    modifiedAt: b.mtime
  }));
});

// Handlers MFA
ipcMain.handle('generate-totp', async (event, secret, options = {}) => {
  try {
    const { period = 30, digits = 6, algorithm = 'sha1' } = options;
    
    if (totpGenerator) {
      // Configurar otplib
      totpGenerator.options = {
        digits,
        period,
        algorithm: algorithm.toLowerCase()
        // Não definir encoding - otplib usa base32 por padrão
      };
      
      const code = totpGenerator.generate(secret);
      const epoch = Math.floor(Date.now() / 1000);
      const remaining = period - (epoch % period);
      
      return { success: true, code, remaining, period };
    } else {
      // Implementação simples de fallback
      const epoch = Math.floor(Date.now() / 1000);
      const counter = Math.floor(epoch / period);
      
      let hash = 0;
      const combined = secret + counter.toString();
      for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      
      const code = Math.abs(hash) % Math.pow(10, digits);
      const remaining = period - (epoch % period);
      
      return { 
        success: true, 
        code: code.toString().padStart(digits, '0'), 
        remaining, 
        period,
        fallback: true 
      };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('generate-hotp', async (event, secret, counter, options = {}) => {
  try {
    const { digits = 6, algorithm = 'sha1' } = options;
    
    if (hotpGenerator) {
      // Configurar otplib
      hotpGenerator.options = {
        digits,
        algorithm: algorithm.toLowerCase()
        // Não definir encoding - otplib usa base32 por padrão
      };
      
      const code = hotpGenerator.generate(secret, counter);
      return { success: true, code, counter: counter + 1 };
    } else {
      // Implementação simples de fallback
      let hash = 0;
      const combined = secret + counter.toString();
      for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      
      const code = Math.abs(hash) % Math.pow(10, digits);
      
      return { 
        success: true, 
        code: code.toString().padStart(digits, '0'), 
        counter: counter + 1,
        fallback: true 
      };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('verify-totp', async (event, token, secret, options = {}) => {
  try {
    const { period = 30, digits = 6, algorithm = 'sha1', window = 1 } = options;
    
    if (totpGenerator) {
      totpGenerator.options = {
        digits,
        period,
        algorithm: algorithm.toLowerCase(),
        window
        // Não definir encoding - otplib usa base32 por padrão
      };
      
      const isValid = totpGenerator.verify({ token, secret });
      return { success: true, isValid };
    } else {
      // Verificação simples
      const epoch = Math.floor(Date.now() / 1000);
      const counter = Math.floor(epoch / period);
      
      let hash = 0;
      const combined = secret + counter.toString();
      for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      
      const code = Math.abs(hash) % Math.pow(10, digits);
      const expectedCode = code.toString().padStart(digits, '0');
      
      return { success: true, isValid: token === expectedCode, fallback: true };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Funções de backup
async function exportBackup() {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar Backup',
    defaultPath: `mysecrets-backup-${new Date().toISOString().slice(0, 10)}.enc`,
    filters: [
      { name: 'Backup Criptografado', extensions: ['enc'] }
    ]
  });
  
  if (!result.canceled && fs.existsSync(vaultFile())) {
    fs.copyFileSync(vaultFile(), result.filePath);
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Backup Exportado',
      message: 'Backup exportado com sucesso!'
    });
  }
}

async function importBackup() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar Backup',
    defaultPath: fs.existsSync(backupsPath()) ? backupsPath() : undefined,
    filters: [
      { name: 'Backup Criptografado', extensions: ['enc'] }
    ],
    properties: ['openFile']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    const response = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Confirmar Importação',
      message: 'Esta ação substituirá todos os dados atuais. Deseja continuar?',
      buttons: ['Cancelar', 'Importar'],
      defaultId: 0
    });
    
    if (response.response === 1) {
      fs.copyFileSync(result.filePaths[0], vaultFile());
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Backup Importado',
        message: 'Backup importado com sucesso! A aplicação será reiniciada.'
      });
      app.relaunch();
      app.exit();
    }
  }
}

// ===== Atualizações automáticas (electron-updater + GitHub Releases) =====
//
// O app consulta as releases públicas de plugato/mySecrets (sem token). No Windows só funciona instalado pelo instalador NSIS: a cópia de
// win-unpacked (make run-win) não tem resources/app-update.yml.

let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (error) {
  console.warn('⚠️ electron-updater indisponível:', error.message);
}

function sendUpdateStatus(status, extra = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, ...extra });
  }
}

function setupAutoUpdater() {
  if (!autoUpdater) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Em dev (--dev), usa dev-app-update.yml da raiz para permitir testes
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
  }

  autoUpdater.on('checking-for-update', () => {
    console.log('🔄 Verificando atualizações...');
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('⬇️ Atualização disponível:', info.version);
    sendUpdateStatus('available', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('✅ Aplicativo atualizado (nenhuma versão nova)');
    sendUpdateStatus('none', { version: app.getVersion() });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('downloading', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    console.log('✅ Atualização baixada:', info.version);
    sendUpdateStatus('downloaded', { version: info.version });

    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Atualização pronta',
      message: `A versão ${info.version} do MySecrets foi baixada.`,
      detail: 'Reinicie agora para aplicar, ou ela será instalada ao fechar o app.',
      buttons: ['Depois', 'Reiniciar agora'],
      defaultId: 1
    });
    if (result.response === 1) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (error) => {
    console.warn('⚠️ Erro no auto-update:', error.message);
    sendUpdateStatus('error', { message: error.message });
  });

  // Verificação automática só no app empacotado (em dev, use o botão
  // "Verificar agora" nas Configurações)
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn('⚠️ Falha ao verificar atualizações:', err.message);
      });
    }, 5000);
  }
}

ipcMain.handle('get-app-version', async () => app.getVersion());

ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater) {
    return { success: false, error: 'electron-updater não está instalado' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return {
      success: true,
      currentVersion: app.getVersion(),
      latestVersion: result && result.updateInfo ? result.updateInfo.version : null
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ===== Bandeja do sistema (tray) e atalho global =====

let tray = null;

function sendLockToRenderer() {
  destroySession();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('system-lock');
  }
}

function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, '../assets/icon.png');
    if (!fs.existsSync(iconPath)) return;

    let trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) return;
    trayIcon = trayIcon.resize({ width: 16, height: 16 });

    tray = new Tray(trayIcon);
    tray.setToolTip('MySecrets');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Mostrar/Ocultar', click: () => toggleMainWindow() },
      { label: 'Bloquear', click: () => sendLockToRenderer() },
      { type: 'separator' },
      { label: 'Sair', click: () => app.quit() }
    ]));
    tray.on('click', () => toggleMainWindow());
  } catch (error) {
    console.warn('⚠️ Não foi possível criar o ícone na bandeja:', error.message);
  }
}

function setupPowerMonitor() {
  // Bloqueia o cofre quando o sistema suspende ou a tela é travada:
  // a sessão em disco é destruída e o renderer volta para a tela de login
  ['suspend', 'lock-screen'].forEach((evt) => {
    try {
      powerMonitor.on(evt, () => {
        console.log(`Sistema: ${evt} — bloqueando cofre`);
        sendLockToRenderer();
      });
    } catch (_) { /* evento não suportado na plataforma */ }
  });
}

// ===== Atalho global (Ctrl+Shift+M) — opcional, desligado por padrão =====
// O grab de teclado feito pelo registro pode travar o input do sistema por
// alguns segundos (observado no WSLg/X11). Por isso o atalho:
//   1. só é registrado se o usuário ativar nas configurações (via IPC);
//   2. é registrado com atraso, para o grab não coincidir com a inicialização.

const GLOBAL_SHORTCUT = 'CommandOrControl+Shift+M';
const GLOBAL_SHORTCUT_DELAY_MS = 5000;
let globalShortcutTimer = null;

function applyGlobalShortcut(enabled) {
  if (globalShortcutTimer) {
    clearTimeout(globalShortcutTimer);
    globalShortcutTimer = null;
  }

  if (!enabled) {
    try {
      globalShortcut.unregister(GLOBAL_SHORTCUT);
    } catch (_) { /* não estava registrado */ }
    return { enabled: false };
  }

  if (globalShortcut.isRegistered(GLOBAL_SHORTCUT)) {
    return { enabled: true };
  }

  globalShortcutTimer = setTimeout(() => {
    globalShortcutTimer = null;
    try {
      globalShortcut.register(GLOBAL_SHORTCUT, () => toggleMainWindow());
      console.log(`Atalho global ${GLOBAL_SHORTCUT} registrado (após atraso de ${GLOBAL_SHORTCUT_DELAY_MS / 1000}s)`);
    } catch (error) {
      console.warn('⚠️ Não foi possível registrar o atalho global:', error.message);
    }
  }, GLOBAL_SHORTCUT_DELAY_MS);

  return { enabled: true, delayed: true };
}

ipcMain.handle('set-global-shortcut', async (event, enabled) => applyGlobalShortcut(!!enabled));

// Eventos da aplicação
app.whenReady().then(() => {
  createWindow();
  createTray();
  setupPowerMonitor();
  setupAutoUpdater();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  destroySession(); // Remove sessão ao fechar
  stopMcpServer();  // Encerra o servidor MCP junto com o app
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  destroySession(); // Remove sessão antes de fechar
  stopMcpServer();  // Garante que o processo MCP não fique órfão
});

// Prevenir navegação externa
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== 'file://') {
      event.preventDefault();
    }
  });
});

// Teste das funções MFA (apenas para debugging)
if (isDevMode) {
  setTimeout(async () => {
    try {
      const secret = 'JBSWY3DPEHPK3PXP'; // Exemplo de secret base32
      const totp = totpGenerator.generate(secret);
      console.log('Teste TOTP gerado:', totp);
    } catch (error) {
      console.error('Erro no teste TOTP:', error);
    }
  }, 2000);
}