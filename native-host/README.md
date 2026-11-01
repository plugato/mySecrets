# 🔌 Native Messaging Host - MySecrets

Este diretório contém o **Native Messaging Host** que permite a comunicação segura entre a extensão Chrome e o aplicativo desktop MySecrets.

---

## 📋 O Que É?

Native Messaging é o protocolo oficial do Chrome para permitir que extensões se comuniquem com aplicativos nativos instalados no computador de forma segura.

### Como Funciona:

```
┌─────────────┐           ┌──────────────┐           ┌─────────────┐
│  Extensão   │  Native   │    Native    │   File    │  App        │
│  Chrome     │◄─────────►│   Messaging  │◄─────────►│  MySecrets  │
│             │  Protocol │     Host     │   I/O     │  Desktop    │
└─────────────┘           └──────────────┘           └─────────────┘
```

1. **Extensão** solicita dados (ex: logins para github.com)
2. **Native Host** (script Node.js) processa a solicitação
3. **Host** lê dados criptografados do app MySecrets
4. **Host** retorna dados para a extensão
5. **Extensão** preenche formulários automaticamente

---

## 🚀 Instalação Rápida

### 1. Instalar o Native Host

```bash
cd /media/ancalagon/DEV/Project/mySecrets/native-host
bash install.sh
```

O script irá:
- ✅ Tornar `mysecrets-host.js` executável
- ✅ Pedir o Extension ID (copie do Chrome)
- ✅ Criar manifest em `~/.config/google-chrome/NativeMessagingHosts/`
- ✅ Configurar permissões

### 2. Obter Extension ID

1. Abra Chrome: `chrome://extensions/`
2. Ative **Modo do desenvolvedor**
3. Encontre **MySecrets Autofill**
4. Copie o **Extension ID** (algo como `abcdefghijklmnopqrstuvwxyz123456`)

### 3. Executar Instalação

```bash
bash install.sh
# Cole o Extension ID quando solicitado
```

### 4. Testar

1. Abra o app MySecrets desktop: `make dev`
2. Desbloqueie o cofre com sua senha mestra
3. Abra o Chrome
4. Clique na extensão MySecrets
5. Deve mostrar: **✅ Conectado ao app desktop**

---

## 📂 Arquivos

### `mysecrets-host.js`
Script Node.js que serve como ponte entre extensão e app.

**Comandos suportados:**
- `status` - Verifica se app está aberto e desbloqueado
- `get_entries` - Busca entradas de login (opcionalmente filtradas por URL)
- `ping` - Teste de conexão

### `com.mysecrets.native.json`
Manifest que o Chrome usa para encontrar o host.

**Formato:**
```json
{
  "name": "com.mysecrets.native",
  "description": "MySecrets Native Messaging Host",
  "path": "/caminho/completo/para/mysecrets-host.js",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://SEU_EXTENSION_ID_AQUI/"
  ]
}
```

### `install.sh`
Script de instalação automática.

---

## 🔧 Configuração Manual

Se preferir configurar manualmente:

### 1. Tornar Host Executável

```bash
chmod +x mysecrets-host.js
```

### 2. Criar Manifest

Crie o arquivo em:
```
~/.config/google-chrome/NativeMessagingHosts/com.mysecrets.native.json
```

Conteúdo:
```json
{
  "name": "com.mysecrets.native",
  "description": "MySecrets Native Messaging Host",
  "path": "/media/ancalagon/DEV/Project/mySecrets/native-host/mysecrets-host.js",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://SEU_EXTENSION_ID/"
  ]
}
```

**IMPORTANTE:** Use o caminho **COMPLETO** para `mysecrets-host.js`!

### 3. Substituir Extension ID

Substitua `SEU_EXTENSION_ID` pelo ID real da extensão (obtido em `chrome://extensions/`).

---

## 🧪 Testar Instalação

### Teste 1: Verificar Manifest

```bash
cat ~/.config/google-chrome/NativeMessagingHosts/com.mysecrets.native.json
```

Deve mostrar o manifest com caminho correto e Extension ID.

### Teste 2: Testar Host Diretamente

```bash
echo '{"command":"ping"}' | node mysecrets-host.js | xxd
```

Deve retornar uma resposta (em formato binário).

### Teste 3: Verificar no Chrome

1. Abra Chrome DevTools (F12)
2. Vá para aba "Console"
3. Recarregue a extensão
4. Deve ver: `✅ App MySecrets conectado`

---

## 🔐 Segurança

### Como os Dados São Protegidos

1. **Sessão Temporária**
   - Quando você desbloqueia o app desktop, ele cria um arquivo `.session`
   - Este arquivo contém uma chave de sessão temporária
   - A sessão expira em 15 minutos de inatividade

2. **Dados Criptografados**
   - Os dados no arquivo `secrets.enc` estão sempre criptografados
   - O host usa a chave de sessão para descriptografar temporariamente
   - A extensão recebe apenas os dados necessários (filtrados por URL)

3. **Verificação de Processo**
   - O host verifica se o app MySecrets ainda está rodando (por PID)
   - Se o app fechar, a sessão é invalidada automaticamente

4. **Permissões Restritas**
   - Apenas a extensão com o ID correto pode se comunicar
   - O Chrome gerencia todas as permissões

### Arquitetura de Segurança

```
┌─────────────────────────────────────────────────────────┐
│  1. Usuário desbloqueia app com senha mestra            │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  2. App cria .session com chave temporária (SHA-256)    │
│     PID do processo + timestamp                         │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  3. Extensão solicita dados via Native Messaging        │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  4. Host verifica:                                      │
│     - Sessão válida?                                    │
│     - App ainda rodando (PID exists)?                   │
│     - Sessão não expirou (<15min)?                      │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  5. Host descriptografa secrets.enc com chave de sessão │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  6. Host filtra entradas por URL solicitada             │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  7. Extensão recebe apenas entradas relevantes          │
└─────────────────────────────────────────────────────────┘
```

---

## 🆘 Troubleshooting

### Erro: "Host not found"

**Problema:** Chrome não encontra o native host.

**Soluções:**
1. Verifique se o manifest existe:
   ```bash
   ls -la ~/.config/google-chrome/NativeMessagingHosts/
   ```

2. Verifique se o caminho no manifest está correto:
   ```bash
   cat ~/.config/google-chrome/NativeMessagingHosts/com.mysecrets.native.json
   ```

3. Use caminho **COMPLETO** (não relativo):
   - ✅ `/media/ancalagon/DEV/Project/mySecrets/native-host/mysecrets-host.js`
   - ❌ `./mysecrets-host.js`

4. Verifique se o script é executável:
   ```bash
   chmod +x /media/ancalagon/DEV/Project/mySecrets/native-host/mysecrets-host.js
   ```

### Erro: "Access denied"

**Problema:** Extension ID não está configurado ou está errado.

**Solução:**
1. Obtenha o Extension ID correto em `chrome://extensions/`
2. Edite o manifest:
   ```bash
   nano ~/.config/google-chrome/NativeMessagingHosts/com.mysecrets.native.json
   ```
3. Substitua `EXTENSION_ID_HERE` pelo ID real
4. Salve e recarregue a extensão

### Erro: "App locked"

**Problema:** App MySecrets não está aberto ou está bloqueado.

**Solução:**
1. Abra o app MySecrets: `make dev`
2. Desbloqueie com sua senha mestra
3. Tente novamente na extensão

### Erro: "Session expired"

**Problema:** Sessão expirou após 15 minutos de inatividade.

**Solução:**
1. Abra o app MySecrets
2. Desbloqueie novamente
3. A sessão será recriada

### Erro: "Node.js not found"

**Problema:** Node.js não está instalado ou não está no PATH.

**Solução:**
```bash
# Verificar Node.js
node --version

# Se não instalado:
sudo apt install nodejs

# Verificar se funciona:
node /media/ancalagon/DEV/Project/mySecrets/native-host/mysecrets-host.js
```

### Extensão não conecta

**Debug:**

1. **Verificar logs do Chrome:**
   - F12 → Console
   - Procure por mensagens da extensão

2. **Testar host manualmente:**
   ```bash
   echo '{"command":"status"}' | node mysecrets-host.js | xxd
   ```

3. **Verificar app desktop:**
   ```bash
   # App está rodando?
   ps aux | grep mysecrets
   
   # Sessão existe?
   ls -la ~/.config/mysecrets/.session
   
   # Ver conteúdo da sessão:
   cat ~/.config/mysecrets/.session
   ```

4. **Reinstalar:**
   ```bash
   cd native-host
   bash install.sh
   # Cole Extension ID novamente
   ```

---

## 📊 Logs e Debug

### Habilitar Logs Verbose

No `mysecrets-host.js`, adicione no início:

```javascript
const DEBUG = true;

function log(...args) {
  if (DEBUG) {
    console.error(...args); // Usa stderr para não interferir com stdout
  }
}
```

### Ver Logs do Host

Os logs do native host vão para o console do Chrome DevTools:

1. Abra `chrome://extensions/`
2. Clique em "Detalhes" na extensão MySecrets
3. Clique em "Inspecionar visualizações: service worker"
4. Vá para aba "Console"

### Arquivo de Log do App

O app desktop pode criar logs em:
```bash
~/.config/Electron/logs/main.log
```

---

## 🔄 Desinstalar

### Remover Native Host

```bash
rm ~/.config/google-chrome/NativeMessagingHosts/com.mysecrets.native.json
rm ~/.config/chromium/NativeMessagingHosts/com.mysecrets.native.json
```

### Remover Sessão

```bash
rm ~/.config/mysecrets/.session
```

---

## 📚 Documentação Adicional

- [Chrome Native Messaging](https://developer.chrome.com/docs/apps/nativeMessaging/)
- [Protocolo de Comunicação](https://developer.chrome.com/docs/extensions/mv3/nativeMessaging/#native-messaging-host-protocol)
- [Segurança](../SECURITY.md)

---

## 🎯 Resumo

### Para Instalar:
```bash
cd native-host
bash install.sh
# Cole Extension ID
```

### Para Usar:
1. Abra app desktop: `make dev`
2. Desbloqueie
3. Use extensão normalmente

### Para Debug:
1. F12 no Chrome
2. Console → procure logs da extensão
3. Verifique se aparece "✅ Conectado ao app desktop"

---

**Pronto! A extensão agora usa os mesmos dados do app desktop! 🎉**
