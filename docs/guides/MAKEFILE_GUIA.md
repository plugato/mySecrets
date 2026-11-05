# 🚀 Guia Rápido do Makefile

Comandos simplificados para facilitar TUDO no MySecrets!

---

## ⚡ Comandos Mais Usados

```bash
# Ver todos os comandos disponíveis
make

# Executar o app (DevTools aberto)
make dev

# Build Linux (AppImage)
make build-linux

# Ver status do projeto
make status

# Limpar tudo
make clean
```

---

## 📋 Categorias de Comandos

### 🚀 Execução

```bash
make dev          # Modo desenvolvimento (DevTools)
make start        # Modo produção (sem DevTools)
make run          # Alias para 'make dev'
```

### 📦 Build

```bash
make build        # Build TODAS as plataformas (demora!)
make build-linux  # Build só Linux (AppImage) ⭐
make build-win    # Build Windows (requer Wine)
make pack         # Empacota sem instalador (rápido)
```

### 🔧 Setup e Instalação

```bash
make install      # Instala dependências npm
make reinstall    # Remove tudo e reinstala
make icons        # Gera ícones temporários
make setup        # Setup inicial completo
```

### 🧪 Testes

```bash
make test         # Executa testes
make test-android # Testes do app Android
make test-import  # Testa importação de MFA
```

### 🧹 Limpeza

```bash
make clean        # Remove builds (dist/)
make clean-all    # Remove TUDO (até node_modules)
```

### 🌐 Extensão Chrome

```bash
make extension      # Prepara extensão
make ext-icons      # Gera ícones da extensão
make ext-pack       # Empacota extensão (.zip)
make ext-install    # Mostra como instalar
```

### 📊 Informações

```bash
make status       # Status do projeto
make version      # Versões instaladas
make size         # Tamanho dos builds
make docs         # Lista documentação
make check        # Verifica problemas
```

### 🎯 Comandos Combinados

```bash
make all          # install + icons + dev
make quick        # clean + install + dev
make build-all    # clean + build-linux + build-win
```

---

## 🎮 Casos de Uso Comuns

### 1️⃣ Primeira Vez - Setup Inicial

```bash
make setup
# Instala tudo, gera ícones, pronto para usar!
```

### 2️⃣ Executar Para Desenvolver

```bash
make dev
# Abre com DevTools (F12) para debug
```

### 3️⃣ Criar Executável Linux

```bash
make build-linux
# Gera: dist/MySecrets-1.0.0.AppImage
```

### 4️⃣ Testar Como Usuário Final

```bash
make start
# Sem DevTools, experiência real
```

### 5️⃣ Algo Deu Errado - Limpar e Reinstalar

```bash
make quick
# Limpa tudo, reinstala e executa
```

### 6️⃣ Preparar Extensão Chrome

```bash
make ext-icons
make ext-install  # Mostra instruções
```

### 7️⃣ Build Completo para Distribuição

```bash
make build-all
# Linux + Windows (demora!)
```

### 8️⃣ Verificar Status do Projeto

```bash
make status
# Mostra estrutura, builds, dependências
```

---

## 🔥 Atalhos do Teclado (VSCode)

Configure em `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Run MySecrets",
      "type": "shell",
      "command": "make dev",
      "group": {
        "kind": "build",
        "isDefault": true
      }
    }
  ]
}
```

Agora: **Ctrl+Shift+B** = `make dev` 🚀

---

## 💡 Dicas

### Execução Rápida

```bash
# Em vez de:
cd /media/ancalagon/DEV/Project/mySecrets && npm run dev

# Use:
make dev
```

### Build Rápido

```bash
# Build rápido sem instalador (para testar)
make pack

# Executar
./dist/linux-unpacked/mysecrets
```

### Ver Logs Coloridos

O Makefile usa cores:
- 🟢 Verde = Sucesso/Comandos
- 🟡 Amarelo = Categorias/Avisos
- 🔵 Azul = Cabeçalhos
- 🔴 Vermelho = Erros/Alertas

### Verificar Antes de Buildar

```bash
# Ver status
make status

# Ver versões
make version

# Verificar problemas
make check
```

---

## 📊 Output dos Comandos

### `make status`

```
═══════════════════════════════════════════════════════
  📊 Status do MySecrets
═══════════════════════════════════════════════════════

📁 Estrutura:
  ✅ src/
  ✅ assets/
  ✅ chrome-extension/
  ✅ node_modules/

📦 Builds:
  ✅ dist/ (403M)
    ✅ AppImage (113M)

🔧 Dependências:
  ✅ Instaladas (492M)
```

### `make version`

```
═══════════════════════════════════════════════════════
  📋 Versões
═══════════════════════════════════════════════════════

MySecrets:  1.0.0
Node.js:    v20.19.5
npm:        10.8.2
Electron:   electron@38.2.1
```

### `make size`

```
📊 Tamanho dos Builds:
  Total: 403M
  AppImage: 113M
  Unpacked: 279M
```

---

## 🆘 Troubleshooting

### "make: command not found"

```bash
# Instalar make
sudo apt install build-essential
```

### "Permission denied"

```bash
# Dar permissão ao Makefile
chmod +x Makefile
```

### Comandos não funcionam

```bash
# Verificar se está na pasta correta
pwd  # Deve mostrar: /media/ancalagon/DEV/Project/mySecrets

# Verificar se Makefile existe
ls -la Makefile
```

### Erro ao buildar

```bash
# Limpar e tentar novamente
make clean
make build-linux
```

### Node.js não encontrado

```bash
# Verificar instalação
make check

# Se não instalado:
sudo apt install nodejs npm
```

---

## 🎯 Fluxo de Trabalho Recomendado

### Desenvolvimento Diário

```bash
# 1. Verificar status
make status

# 2. Executar
make dev

# 3. Desenvolver...

# 4. Testar
make test

# 5. Buildar se OK
make build-linux
```

### Após Git Pull

```bash
# Reinstalar dependências
make install

# Executar
make dev
```

### Preparar Release

```bash
# 1. Limpar tudo
make clean

# 2. Reinstalar
make install

# 3. Testar
make dev

# 4. Build completo
make build-all

# 5. Verificar tamanhos
make size
```

---

## 📚 Comandos Detalhados

### `make dev`
- Executa `npm run dev`
- Abre DevTools automaticamente
- Para desenvolvimento e debug

### `make build-linux`
- Cria AppImage para Linux
- Arquivo: `dist/MySecrets-1.0.0.AppImage`
- Tamanho: ~100-150MB
- Pode ser executado em qualquer distro

### `make clean`
- Remove `dist/`, `out/`, `.webpack/`
- NÃO remove `node_modules/`
- Útil antes de buildar

### `make clean-all`
- Remove TUDO incluindo `node_modules/`
- Use quando tiver problemas
- Depois: `make install`

### `make status`
- Mostra estrutura do projeto
- Lista builds existentes
- Verifica dependências

### `make ext-pack`
- Cria `dist/MySecrets-Autofill-extensao-chrome.zip`
- Pronto para distribuir
- Inclui apenas arquivos necessários

---

## 🔧 Customização

### Adicionar Seu Próprio Comando

Edite `Makefile` e adicione:

```makefile
# Meu comando customizado
meu-comando:
	@echo "Fazendo algo..."
	# seus comandos aqui
```

Usar:
```bash
make meu-comando
```

### Modificar Cores

No Makefile, procure por:
```makefile
GREEN  := \033[0;32m
YELLOW := \033[0;33m
BLUE   := \033[0;34m
RED    := \033[0;31m
NC     := \033[0m
```

---

## ⚡ Comandos de Uma Linha

```bash
# Executar direto
make dev

# Build rápido
make build-linux

# Limpar e buildar
make clean && make build-linux

# Reinstalar e executar
make reinstall && make dev

# Ver tudo de uma vez
make status && make version
```

---

## 🎓 Comparação: Antes vs Depois

### ANTES (Sem Makefile)

```bash
cd /media/ancalagon/DEV/Project/mySecrets
npm run dev
```

```bash
cd /media/ancalagon/DEV/Project/mySecrets
npm run build-linux
ls -lh dist/
```

```bash
cd /media/ancalagon/DEV/Project/mySecrets
rm -rf dist/
rm -rf node_modules/
npm install
```

### DEPOIS (Com Makefile)

```bash
make dev
```

```bash
make build-linux && make size
```

```bash
make quick
```

✅ **Mais simples, rápido e fácil de lembrar!**

---

## 📖 Referência Rápida

| O que fazer | Comando |
|-------------|---------|
| Executar | `make dev` |
| Build Linux | `make build-linux` |
| Ver status | `make status` |
| Limpar | `make clean` |
| Reinstalar | `make reinstall` |
| Rodar os testes | `make test` |
| Ver versões | `make version` |
| Ajuda | `make` ou `make help` |

---

## 🚀 Começar Agora

```bash
# Ver todos os comandos
make

# Executar o app
make dev

# Verificar status
make status

# Build AppImage
make build-linux
```

---

**Makefile: Simplificando TUDO no MySecrets! 🔥**

Para ver esta ajuda a qualquer momento: `make`
