# 🔌 Integração Extensão + App Desktop

Guia completo para fazer a extensão Chrome usar os mesmos dados de login do aplicativo MySecrets desktop.

---

## 🎯 O Que Foi Implementado

✅ **Native Messaging** - Comunicação segura entre extensão e app  
✅ **Sincronização Automática** - Extensão lê dados direto do app  
✅ **Segurança** - Sessões temporárias com timeout  
✅ **Fallback** - Extensão funciona standalone se app não estiver aberto  

---

## 🚀 Instalação em 3 Passos

### Passo 1: Instalar Native Messaging Host

```bash
cd /media/ancalagon/DEV/Project/mySecrets/native-host
bash install.sh
```

**O que o script faz:**
- Torna `mysecrets-host.js` executável
- Solicita Extension ID
- Cria manifest em `~/.config/google-chrome/NativeMessagingHosts/`
- Configura permissões

### Passo 2: Obter Extension ID

1. Abra Chrome: **chrome://extensions/**
2. Ative **Modo do desenvolvedor** (canto superior direito)
3. Encontre **MySecrets Autofill**
4. Copie o **Extension ID** (ex: `abcdefghijklmnopqrst123456789012`)

![Extension ID Location](https://via.placeholder.com/600x200/4A90E2/FFFFFF?text=Extension+ID+aqui)

### Passo 3: Configurar

```bash
# Cole o Extension ID quando solicitado
bash install.sh
```

Exemplo:
```
🔑 Extension ID
Cole o Extension ID: abcdefghijklmnopqrst123456789012
✅ Extension ID: abcdefghijklmnopqrst123456789012
```

---

## ✅ Testar Integração

### 1. Abrir App Desktop

```bash
make dev
```

### 2. Desbloquear Cofre

Digite sua senha mestra no app desktop.

**O que acontece:**
- ✅ App cria arquivo `.session` em `~/.config/mysecrets/`
- ✅ Sessão contém chave temporária para descriptografar dados
- ✅ Extensão pode agora acessar os dados

### 3. Verificar Conexão na Extensão

1. Abra o Chrome
2. Clique no ícone da extensão MySecrets
3. Console deve mostrar:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ MySecrets Extension - Pronto!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Conectado ao app MySecrets desktop
📱 Dados sincronizados automaticamente
```

### 4. Testar Autofill

1. Vá para um site (ex: **github.com/login**)
2. Extensão deve detectar automaticamente
3. Clique na extensão → Deve mostrar entradas do app desktop
4. Clique em "Preencher" → Formulário é preenchido!

---

## 🔄 Como Funciona

### Arquitetura

```
┌──────────────────┐         Native          ┌──────────────────┐
│   Extensão       │       Messaging         │   App Desktop    │
│   Chrome         │◄──────────────────────►│   MySecrets      │
│                  │                         │                  │
│  - Detecta forms │   1. Solicita dados    │  - Armazena      │
│  - Preenche      │   2. Recebe filtrados  │  - Criptografa   │
│  - Mostra UI     │   3. Usa para fill     │  - Gerencia MFA  │
└──────────────────┘                         └──────────────────┘
        │                                              │
        │                                              │
        ▼                                              ▼
┌──────────────────┐                         ┌──────────────────┐
│  Storage Local   │                         │  secrets.enc     │
│  (Fallback)      │                         │  (Criptografado) │
└──────────────────┘                         └──────────────────┘
```

### Fluxo de Dados

1. **Usuário desbloqueia app desktop**
   - App cria sessão em `~/.config/mysecrets/.session`
   - Sessão contém: timestamp, PID, chave temporária

2. **Extensão detecta formulário de login**
   - Extrai URL atual (ex: `github.com`)
   - Solicita entradas via Native Messaging

3. **Native Host processa solicitação**
   - Verifica se sessão é válida
   - Verifica se app ainda está rodando (PID)
   - Descriptografa `secrets.enc` com chave de sessão
   - Filtra entradas pela URL
   - Retorna apenas entradas relevantes

4. **Extensão preenche formulário**
   - Recebe entradas filtradas
   - Detecta campos username/password
   - Preenche automaticamente

### Segurança

#### ✅ Dados Sempre Criptografados
```javascript
// secrets.enc está sempre criptografado em disco
// AES-256-CBC + PBKDF2
{
  "iv": "...",
  "salt": "...",
  "data": "... dados criptografados ..."
}
```

#### ✅ Sessão Temporária
```javascript
// .session é temporário e tem timeout
{
  "timestamp": 1234567890,     // Criado quando
  "pid": 12345,                 // PID do app
  "unlocked": true,             // Estado
  "key": "sha256_hash..."       // Chave temporária
}

// Expira em 15 minutos de inatividade
```

#### ✅ Verificações de Segurança
- ⚡ Sessão expira automaticamente
- ⚡ Verifica se app ainda está rodando (PID)
- ⚡ Apenas Extension ID autorizado pode acessar
- ⚡ Dados filtrados por URL (não envia tudo)
- ⚡ Sessão removida ao fechar app

---

## 📝 Comandos Úteis

### Verificar Instalação

```bash
# Ver manifest instalado
cat ~/.config/google-chrome/NativeMessagingHosts/com.mysecrets.native.json

# Verificar sessão ativa
ls -la ~/.config/mysecrets/.session

# Ver dados da sessão
cat ~/.config/mysecrets/.session
```

### Testar Native Host

```bash
# Teste direto
echo '{"command":"status"}' | node native-host/mysecrets-host.js | xxd

# Teste com app rodando
echo '{"command":"get_entries","url":"https://github.com"}' | node native-host/mysecrets-host.js | xxd
```

### Debug

```bash
# Logs do Chrome
# Abra: chrome://extensions/
# Clique: "Detalhes" → "Inspecionar visualizações: service worker"
# Vá para aba "Console"

# Ver processo do app
ps aux | grep mysecrets

# Ver sessão
cat ~/.config/mysecrets/.session
```

---

## 🆘 Troubleshooting

### ❌ "Host not found"

**Problema:** Chrome não encontra o native host.

**Solução:**
```bash
# Reinstalar
cd native-host
bash install.sh

# Verificar manifest
cat ~/.config/google-chrome/NativeMessagingHosts/com.mysecrets.native.json
```

### ❌ "Access denied"

**Problema:** Extension ID errado ou não configurado.

**Solução:**
1. Copie Extension ID correto de `chrome://extensions/`
2. Edite manifest:
   ```bash
   nano ~/.config/google-chrome/NativeMessagingHosts/com.mysecrets.native.json
   ```
3. Substitua `EXTENSION_ID_HERE` pelo ID real
4. Salve e recarregue extensão

### ❌ "App locked"

**Problema:** App não está aberto ou está bloqueado.

**Solução:**
```bash
# Abrir app
make dev

# Desbloquear no app
# (Digite senha mestra)
```

### ❌ Extensão não mostra dados

**Debug passo a passo:**

1. **App está rodando?**
   ```bash
   ps aux | grep mysecrets
   ```

2. **Sessão existe?**
   ```bash
   ls -la ~/.config/mysecrets/.session
   ```

3. **Sessão está válida?**
   ```bash
   cat ~/.config/mysecrets/.session
   # Verifique timestamp (não deve ter mais de 15min)
   ```

4. **Logs da extensão:**
   - F12 no Chrome
   - Console → procure erros

5. **Testar host:**
   ```bash
   echo '{"command":"status"}' | node native-host/mysecrets-host.js | xxd
   ```

---

## 🔥 Casos de Uso

### Uso Normal

```bash
# 1. Abrir app
make dev

# 2. Desbloquear
# (Digite senha no app)

# 3. Navegar para site
# chrome → github.com/login

# 4. Extensão detecta e preenche automaticamente
```

### Desenvolvimento

```bash
# Terminal 1: App desktop
make dev

# Terminal 2: Logs da extensão
# chrome://extensions/ → service worker → console

# Terminal 3: Monitorar sessão
watch -n 1 'cat ~/.config/mysecrets/.session 2>/dev/null || echo "Sem sessão"'
```

### Testing

```bash
# 1. Criar dados de teste no app
# Adicionar login para github.com

# 2. Verificar se extensão recebe
# F12 → Console → ver logs

# 3. Testar autofill
# github.com/login → deve preencher
```

---

## 📊 Comparação: Antes vs Depois

### ANTES (Sem Integração)

```
❌ Dados duplicados (app + extensão separados)
❌ Sincronização manual necessária
❌ Dois lugares para gerenciar senhas
❌ Inconsistência entre app e extensão
```

### DEPOIS (Com Integração)

```
✅ Única fonte de dados (app desktop)
✅ Sincronização automática
✅ Gerenciar senhas apenas no app
✅ Sempre consistente
✅ Mais seguro (dados criptografados no disco)
```

---

## 🎯 Checklist de Configuração

- [ ] Native host instalado (`bash install.sh`)
- [ ] Extension ID configurado corretamente
- [ ] Manifest em `~/.config/google-chrome/NativeMessagingHosts/`
- [ ] Script `mysecrets-host.js` executável
- [ ] App desktop rodando (`make dev`)
- [ ] Cofre desbloqueado no app
- [ ] Extensão carregada no Chrome
- [ ] Console mostra "Conectado ao app desktop"
- [ ] Teste em github.com/login funcionou

Se todos ✅: **Integração completa! 🎉**

---

## 📚 Arquivos Importantes

| Arquivo | Localização | Descrição |
|---------|-------------|-----------|
| **mysecrets-host.js** | `native-host/` | Script de comunicação |
| **install.sh** | `native-host/` | Script de instalação |
| **Manifest** | `~/.config/google-chrome/NativeMessagingHosts/` | Config do Chrome |
| **Session** | `~/.config/mysecrets/.session` | Sessão temporária |
| **Secrets** | `~/.config/mysecrets/secrets.enc` | Dados criptografados |

---

## 🚀 Próximos Passos

### Depois de Configurar:

1. **Adicionar Logins no App**
   ```bash
   make dev
   # Adicionar → Login → github.com
   ```

2. **Testar Autofill**
   - Abra github.com/login
   - Extensão detecta automaticamente
   - Clique para preencher

3. **Usar Diariamente**
   - Mantenha app aberto em background
   - Extensão sempre terá dados atualizados
   - Adicione novos logins apenas no app

---

## 💡 Dicas

### Performance
- ✅ App pode ficar minimizado
- ✅ Sessão persiste por 15 minutos
- ✅ Não precisa reabrir app toda hora

### Segurança
- ✅ Sempre feche app ao sair do computador
- ✅ Use senha mestra forte
- ✅ Sessão expira automaticamente

### Workflow
- ✅ Abra app no boot do sistema
- ✅ Desbloqueie uma vez
- ✅ Use extensão o dia todo
- ✅ Bloqueie ao final do dia

---

## 📖 Documentação Adicional

- [native-host/README.md](native-host/README.md) - Detalhes técnicos
- [chrome-extension/README_EXTENSION.md](chrome-extension/README_EXTENSION.md) - Guia da extensão
- [SECURITY.md](SECURITY.md) - Segurança do sistema

---

**Pronto! Agora a extensão usa os mesmos dados do app desktop! 🎉🔐**

Para instalar:
```bash
cd native-host && bash install.sh
```
