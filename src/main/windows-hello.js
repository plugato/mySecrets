/**
 * MySecrets - Windows Hello (login por digital/biometria).
 *
 * Usa a API WinRT UserConsentVerifier via PowerShell, sem módulo nativo.
 * A senha mestra fica em hello.enc, cifrada com safeStorage (DPAPI no
 * Windows). Ela só vai para o renderer depois que o Windows Hello confirma.
 *
 * register({ getWindow, helloPath }) informa a janela e o arquivo.
 */

const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { ipcMain, safeStorage } = require('electron');

let deps = { getWindow: () => null, helloPath: null };
const getWindow = () => deps.getWindow();

function register(d) {
  deps = d;
}

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
  if (process.platform === 'win32' && getWindow() && !getWindow().isDestroyed()) {
    const handle = getWindow().getNativeWindowHandle();
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
    if (getWindow() && !getWindow().isDestroyed()) getWindow().webContents.focus();
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
  return fs.existsSync(deps.helloPath);
}

function removeHelloEnrollment() {
  if (fs.existsSync(deps.helloPath)) {
    try {
      fs.unlinkSync(deps.helloPath);
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
    fs.writeFileSync(deps.helloPath, JSON.stringify(stored), 'utf8');
    try {
      fs.chmodSync(deps.helloPath, 0o600);
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

    const stored = JSON.parse(fs.readFileSync(deps.helloPath, 'utf8'));
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

module.exports = { register, removeHelloEnrollment, HELLO_ASYNC_OP_IID };
