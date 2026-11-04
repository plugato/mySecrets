# 🔒 MySecrets

Gerenciador de senhas e autenticação 2FA com extensão Chrome integrada.

---

## ⚡ Início Rápido (2 minutos)

```bash
# 1. Instalar dependências (primeira vez)
npm install

# 2. Executar
make dev

# 3. Criar senha mestra e começar a usar!
```

📖 **Guia detalhado:** [QUICK_START.md](QUICK_START.md)

---

## 🎯 O Que Faz?

✅ **Armazena senhas** de forma criptografada (AES-256)  
✅ **Gera códigos 2FA** (TOTP/HOTP)  
✅ **Extensão Chrome** para autofill automático  
✅ **Guarda arquivos** (keystore, `.pem`, `.json`, `.env`) cifrados dentro do cofre  
✅ **Servidor MCP** para assistentes de IA lerem e (com sua confirmação) gravarem segredos  
✅ **100% offline** - seus dados nunca saem do seu computador  

---

## 📦 Principais Recursos

### Aplicativo Desktop
- 🔐 Criptografia AES-256-CBC + PBKDF2
- 🔑 Gerenciamento de senhas
- 📱 Geração de códigos MFA (TOTP/HOTP)
- 💾 Backup/restore
- 📎 Anexos de arquivo por entrada (até 1 MB cada), cifrados no mesmo cofre e sincronizados
- 🏷️ Tags para agrupar por projeto (ex.: `tcg-scanner`), com filtro na barra lateral
- 🎨 Interface moderna

### Extensão Chrome
- 🌐 Autofill automático de formulários
- 🔄 Integração com app desktop (servidor local + token)
- ⌨️ Atalhos de teclado (`Ctrl+Shift+A`)
- 🔒 Sem cópia do cofre no navegador: tudo vem do app desbloqueado

### Servidor MCP (assistentes de IA)
- Ferramentas de leitura: `list_secrets`, `search_secrets`, `get_credentials`, `get_otp`, `get_secret_file`
- Ferramentas de gravação: `store_secret`, `store_secret_file` — cada gravação abre um pedido de confirmação em destaque no app (com notificação se ele estiver escondido)
  com o nome da entrada e os nomes/tamanhos dos arquivos, e só grava se você aprovar
- Configurar no Claude Code: `make mcp-config` ou
  `claude mcp add --scope user mysecrets -- node $(pwd)/mcp-server/index.js`
- Detalhes: **[mcp-server/README.md](mcp-server/README.md)**

---

## 🚀 Comandos Principais

```bash
# Executar aplicativo
make dev              # Modo desenvolvimento (com DevTools)
make start            # Modo produção

# Build
make build-linux      # Criar AppImage para distribuir

# Extensão Chrome
make ext-integrate    # Como parear extensão com o app
make ext-check        # Verificar integração

# Informações
make status           # Ver status do projeto
make                  # Ver TODOS os comandos
```

---

## 🌐 Extensão Chrome

### Instalar Extensão:

1. Chrome: `chrome://extensions/`
2. Ativar **Modo do desenvolvedor**
3. **Carregar sem compactação** → pasta `chrome-extension/`

### Integrar com App Desktop:

```bash
make ext-integrate
# Cola Extension ID quando solicitado
```

📖 **Guia completo:** [docs/extension/INTEGRACAO_EXTENSAO.md](docs/extension/INTEGRACAO_EXTENSAO.md)

---

## 📚 Documentação

### Essencial (Leia Primeiro):

| Documento | Para Quem | O Que É |
|-----------|-----------|---------|
| **[QUICK_START.md](QUICK_START.md)** | 👤 Usuário | Começar em 5 minutos |
| **[docs/guides/EXECUTAR_PROJETO.md](docs/guides/EXECUTAR_PROJETO.md)** | 💻 Todos | Como executar e buildar |
| **[docs/guides/MAKEFILE_GUIA.md](docs/guides/MAKEFILE_GUIA.md)** | 💻 Todos | Guia do Makefile |

### Por Tema:

#### 👤 Para Usuários
- **[docs/user/INSTALLATION.md](docs/user/INSTALLATION.md)** - Instalação detalhada
- **[docs/user/SECURITY.md](docs/user/SECURITY.md)** - Segurança e criptografia
- **[QUICK_START.md](QUICK_START.md)** - Início rápido

#### 💻 Para Desenvolvedores
- **[docs/developer/DEVELOPER_GUIDE.md](docs/developer/DEVELOPER_GUIDE.md)** - Guia técnico
- **[docs/developer/CONTRIBUTING.md](docs/developer/CONTRIBUTING.md)** - Como contribuir
- **[docs/developer/CHANGELOG.md](docs/developer/CHANGELOG.md)** - Histórico de versões

#### 🌐 Extensão Chrome
- **[docs/extension/INTEGRACAO_EXTENSAO.md](docs/extension/INTEGRACAO_EXTENSAO.md)** - Integração com app
- **[docs/extension/LEIA_ME_EXTENSAO.md](docs/extension/LEIA_ME_EXTENSAO.md)** - README da extensão

#### 🤖 Servidor MCP
- **[mcp-server/README.md](mcp-server/README.md)** - Ferramentas, gravação por agente com confirmação, anexos

#### 📖 Guias Práticos
- **[docs/guides/EXECUTAR_PROJETO.md](docs/guides/EXECUTAR_PROJETO.md)** - Executar e buildar
- **[docs/guides/MAKEFILE_GUIA.md](docs/guides/MAKEFILE_GUIA.md)** - Todos os comandos Make
- **[docs/guides/COMO_USAR.txt](docs/guides/COMO_USAR.txt)** - Referência rápida

#### 📑 Índices
- **[docs/summaries/START_HERE.md](docs/summaries/START_HERE.md)** - Navegação completa
- **[docs/summaries/DOCS_INDEX.md](docs/summaries/DOCS_INDEX.md)** - Índice de toda documentação

---

## 🔧 Tecnologias

- **Electron** - Framework desktop
- **Node.js** - Backend
- **Chrome Extensions API** - Extensão
- **crypto** (Node.js) - Criptografia
- **otplib** - Geração de códigos MFA

---

## 🔐 Segurança

### Criptografia
- **AES-256-CBC** para dados
- **PBKDF2** para derivação de chave (100.000 iterações)
- **Salt único** por instalação

### Arquitetura
- **Context Isolation** ativado
- **Node Integration** desativado
- **Dados sempre criptografados** em disco

📖 **Detalhes:** [docs/user/SECURITY.md](docs/user/SECURITY.md)

---

## 📂 Estrutura do Projeto

```
mySecrets/
├── src/                        # App Electron
│   ├── main.js                 # Processo principal
│   ├── preload.js              # Preload script
│   └── renderer/               # Interface
├── chrome-extension/           # Extensão Chrome
│   ├── background.js           # Service worker
│   ├── content.js              # Content script
│   ├── popup.html/js           # Popup UI
│   └── manifest.json           # Manifest
├── native-host/                # Native Messaging
│   ├── mysecrets-host.js       # Host de comunicação
│   └── install.sh              # Instalador
├── docs/                       # 📚 Documentação organizada
│   ├── user/                   # Para usuários
│   ├── developer/              # Para desenvolvedores
│   ├── extension/              # Sobre extensão
│   ├── guides/                 # Guias práticos
│   └── summaries/              # Índices e resumos
├── Makefile                    # Comandos simplificados
├── package.json                # Dependências
└── README.md                   # Este arquivo
```

---

## 🆘 Problemas Comuns

### App não abre

```bash
# Reinstalar dependências
make reinstall
make dev
```

### Extensão não conecta ao app

```bash
# Verificar integração
make ext-check

# Reinstalar native host
make ext-integrate
```

### Esqueci a senha mestra

⚠️ **Não há recuperação!** Os dados são criptografados de forma irreversível.

Solução: Começar do zero (backup será perdido)

---

## 📝 Licença

MIT License - Veja [LICENSE](LICENSE)

---

## 🎯 Links Rápidos

| Ação | Comando / Link |
|------|----------------|
| **Executar** | `make dev` |
| **Ver comandos** | `make` ou `make help` |
| **Guia rápido** | [QUICK_START.md](QUICK_START.md) |
| **Instalar extensão** | [docs/extension/](docs/extension/) |
| **Documentação completa** | [docs/summaries/START_HERE.md](docs/summaries/START_HERE.md) |

---

**Feito com ❤️ para manter suas senhas seguras e organizadas.**

🚀 **Comece agora:** `make dev`
