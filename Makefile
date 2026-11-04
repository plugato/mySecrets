# ============================================
# MySecrets - Makefile
# ============================================
# Comandos simplificados para desenvolvimento
# ============================================

.PHONY: help install dev start run run-win build build-linux build-win pack pack-win clean test icons extension ext-install ext-dev ext-reload docs docs-open docs-user docs-dev docs-ext mcp mcp-test mcp-config

# Cores para output
GREEN  := \033[0;32m
YELLOW := \033[0;33m
BLUE   := \033[0;34m
RED    := \033[0;31m
NC     := \033[0m # No Color

# ============================================
# 📋 HELP - Mostra todos os comandos
# ============================================
help:
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"
	@echo "$(GREEN)  🔒 MySecrets - Comandos Disponíveis$(NC)"
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"
	@echo ""
	@echo "$(YELLOW)🚀 Execução:$(NC)"
	@echo "  $(GREEN)make dev$(NC)           - Executa em modo desenvolvimento (DevTools)"
	@echo "  $(GREEN)make start$(NC)         - Executa em modo produção"
	@echo "  $(GREEN)make run$(NC)           - Alias para 'make dev'"
	@echo "  $(GREEN)make run-win$(NC)       - Gera build Windows e abre no Windows (WSL)"
	@echo ""
	@echo "$(YELLOW)📦 Build:$(NC)"
	@echo "  $(GREEN)make build$(NC)         - Build para todas as plataformas"
	@echo "  $(GREEN)make build-linux$(NC)   - Build AppImage (Linux)"
	@echo "  $(GREEN)make build-win$(NC)     - Build instalador (Windows)"
	@echo "  $(GREEN)make pack$(NC)          - Empacota sem instalador (rápido)"
	@echo "  $(GREEN)make pack-win$(NC)      - Empacota Windows sem instalador (rápido)"
	@echo ""
	@echo "$(YELLOW)🔧 Setup:$(NC)"
	@echo "  $(GREEN)make install$(NC)       - Instala dependências"
	@echo "  $(GREEN)make reinstall$(NC)     - Reinstala tudo do zero"
	@echo "  $(GREEN)make icons$(NC)         - Gera ícones temporários"
	@echo ""
	@echo "$(YELLOW)🧪 Testes:$(NC)"
	@echo "  $(GREEN)make test$(NC)          - Executa testes"
	@echo "  $(GREEN)make test-totp$(NC)     - Testa geração TOTP"
	@echo "  $(GREEN)make test-import$(NC)   - Testa importação MFA"
	@echo ""
	@echo "$(YELLOW)🧹 Limpeza:$(NC)"
	@echo "  $(GREEN)make clean$(NC)         - Remove builds e cache"
	@echo "  $(GREEN)make clean-all$(NC)     - Remove TUDO (node_modules também)"
	@echo ""
	@echo "$(YELLOW)🌐 Extensão Chrome:$(NC)"
	@echo "  $(GREEN)make extension$(NC)     - Build da extensão"
	@echo "  $(GREEN)make ext-icons$(NC)     - Gera ícones da extensão"
	@echo "  $(GREEN)make ext-pack$(NC)      - Empacota extensão (.zip)"
	@echo "  $(GREEN)make ext-install$(NC)   - Mostra como instalar"
	@echo "  $(GREEN)make ext-integrate$(NC) - 🔥 Integra com app desktop"
	@echo "  $(GREEN)make ext-check$(NC)     - Verifica integração"
	@echo ""
	@echo "$(YELLOW)📊 Info:$(NC)"
	@echo "  $(GREEN)make status$(NC)        - Mostra status do projeto"
	@echo "  $(GREEN)make version$(NC)       - Mostra versões"
	@echo "  $(GREEN)make size$(NC)          - Mostra tamanho dos builds"
	@echo "  $(GREEN)make docs$(NC)          - 📚 Ver documentação organizada"
	@echo "  $(GREEN)make docs-open$(NC)     - Abrir INDEX.md"
	@echo ""
	@echo "$(YELLOW)🎯 Comandos Rápidos:$(NC)"
	@echo "  $(GREEN)make$(NC)              - Mostra esta ajuda"
	@echo "  $(GREEN)make all$(NC)           - Install + Icons + Dev"
	@echo "  $(GREEN)make quick$(NC)         - Limpeza + Install + Dev"
	@echo ""
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"

# ============================================
# 🚀 EXECUÇÃO
# ============================================

# Modo desenvolvimento (recomendado)
dev:
	@echo "$(GREEN)🚀 Iniciando MySecrets (Modo Dev)...$(NC)"
	npm run dev

# Modo produção
start:
	@echo "$(GREEN)🚀 Iniciando MySecrets (Modo Produção)...$(NC)"
	npm start

# Alias
run: dev

# ============================================
# 📦 BUILD
# ============================================

# Build todas as plataformas
build:
	@echo "$(YELLOW)📦 Buildando para todas as plataformas...$(NC)"
	@echo "$(RED)⚠️  Isso pode demorar 5-10 minutos!$(NC)"
	npm run build
	@echo "$(GREEN)✅ Build completo!$(NC)"
	@make size

# Build Linux (AppImage)
build-linux:
	@echo "$(YELLOW)📦 Buildando para Linux (AppImage)...$(NC)"
	npm run build-linux
	@echo "$(GREEN)✅ Build Linux completo!$(NC)"
	@make size

# Build Windows
build-win:
	@echo "$(YELLOW)📦 Buildando para Windows...$(NC)"
	@echo "$(RED)⚠️  Requer Wine instalado!$(NC)"
	npm run build-win
	@echo "$(GREEN)✅ Build Windows completo!$(NC)"
	@make size

# Empacota sem instalador (rápido)
pack:
	@echo "$(YELLOW)📦 Empacotando (sem instalador)...$(NC)"
	npm run pack
	@echo "$(GREEN)✅ Empacotado em dist/linux-unpacked/$(NC)"

# Empacota Windows sem instalador (rápido)
pack-win:
	@echo "$(YELLOW)📦 Empacotando para Windows (sem instalador)...$(NC)"
	npx electron-builder --win --dir
	@echo "$(GREEN)✅ Empacotado em dist/win-unpacked/MySecrets.exe$(NC)"

# Gera build Windows e abre no Windows (requer WSL)
# O Electron não roda direto de \\wsl.localhost (processos filhos do Chromium
# falham em caminho UNC), então o build é copiado para %LOCALAPPDATA%\MySecrets
run-win: pack-win
	@echo "$(GREEN)🚀 Abrindo MySecrets no Windows...$(NC)"
	@if ! grep -qi microsoft /proc/version; then \
		echo "$(RED)❌ Este comando só funciona no WSL$(NC)"; \
		exit 1; \
	fi
	@LOCALAPPDATA=$$(cd /mnt/c && /mnt/c/Windows/System32/cmd.exe /c "echo %LOCALAPPDATA%" 2>/dev/null | tr -d '\r'); \
	if [ -z "$$LOCALAPPDATA" ]; then echo "$(RED)❌ Não foi possível resolver %LOCALAPPDATA%$(NC)"; exit 1; fi; \
	DEST=$$(wslpath -u "$$LOCALAPPDATA")/MySecrets; \
	printf '$(YELLOW)📋 Copiando build para %s\\MySecrets ...$(NC)\n' "$$LOCALAPPDATA"; \
	/mnt/c/Windows/System32/taskkill.exe /IM MySecrets.exe /F >/dev/null 2>&1 || true; \
	mkdir -p "$$DEST"; \
	if command -v rsync >/dev/null 2>&1; then \
		rsync -a --delete dist/win-unpacked/ "$$DEST/"; \
	else \
		rm -rf "$$DEST" && cp -r dist/win-unpacked "$$DEST"; \
	fi; \
	cd /mnt/c && /mnt/c/Windows/System32/cmd.exe /c start "" "$$LOCALAPPDATA\\MySecrets\\MySecrets.exe"
	@echo "$(GREEN)✅ MySecrets aberto no Windows!$(NC)"

# ============================================
# 🔧 SETUP E INSTALAÇÃO
# ============================================

# Instala dependências
install:
	@echo "$(YELLOW)📥 Instalando dependências...$(NC)"
	npm install
	@echo "$(GREEN)✅ Dependências instaladas!$(NC)"

# Reinstala tudo
reinstall:
	@echo "$(RED)🗑️  Removendo node_modules...$(NC)"
	rm -rf node_modules package-lock.json
	@echo "$(YELLOW)📥 Reinstalando dependências...$(NC)"
	npm install
	@echo "$(GREEN)✅ Reinstalação completa!$(NC)"

# Gera ícones temporários
icons:
	@echo "$(YELLOW)🎨 Gerando ícones temporários...$(NC)"
	@if [ ! -f "assets/icon.png" ]; then \
		mkdir -p assets; \
		convert -size 512x512 xc:none \
			-gravity center \
			-fill "#4A90E2" -draw "circle 256,256 256,50" \
			-fill white -font DejaVu-Sans-Bold -pointsize 120 \
			-annotate +0+0 "MS" \
			assets/icon.png; \
		echo "$(GREEN)✅ Ícone criado: assets/icon.png$(NC)"; \
	else \
		echo "$(BLUE)ℹ️  Ícone já existe$(NC)"; \
	fi

# ============================================
# 🧪 TESTES
# ============================================

# Executa testes
test:
	@echo "$(YELLOW)🧪 Executando testes...$(NC)"
	@if [ -f "test-totp.js" ]; then \
		node test-totp.js; \
	else \
		echo "$(RED)❌ Arquivo de teste não encontrado$(NC)"; \
	fi

# Testa TOTP
test-totp:
	@echo "$(YELLOW)🔐 Testando geração TOTP...$(NC)"
	node test-totp.js

# Testa importação MFA
test-import:
	@echo "$(YELLOW)📥 Testando importação MFA...$(NC)"
	@if [ -f "import-mfa-entries.js" ]; then \
		node import-mfa-entries.js; \
	else \
		echo "$(RED)❌ Script de importação não encontrado$(NC)"; \
	fi

# ============================================
# 🧹 LIMPEZA
# ============================================

# Remove builds e cache
clean:
	@echo "$(RED)🧹 Limpando builds e cache...$(NC)"
	rm -rf dist/
	rm -rf out/
	rm -rf .webpack/
	@echo "$(GREEN)✅ Limpeza completa!$(NC)"

# Remove TUDO (incluindo node_modules)
clean-all:
	@echo "$(RED)🗑️  REMOVENDO TUDO...$(NC)"
	rm -rf dist/ out/ .webpack/ node_modules/ package-lock.json
	@echo "$(GREEN)✅ Tudo removido!$(NC)"
	@echo "$(YELLOW)💡 Execute 'make install' para reinstalar$(NC)"

# ============================================
# 🌐 EXTENSÃO CHROME
# ============================================

# Build da extensão
extension:
	@echo "$(YELLOW)🌐 Preparando extensão Chrome...$(NC)"
	@if [ -d "chrome-extension" ]; then \
		echo "$(GREEN)✅ Extensão pronta em: chrome-extension/$(NC)"; \
		echo "$(BLUE)📝 Carregue em: chrome://extensions/$(NC)"; \
	else \
		echo "$(RED)❌ Pasta chrome-extension não encontrada$(NC)"; \
	fi

# Gera ícones da extensão
ext-icons:
	@echo "$(YELLOW)🎨 Gerando ícones da extensão...$(NC)"
	@if [ -f "chrome-extension/icons/create-icons.sh" ]; then \
		cd chrome-extension/icons && bash create-icons.sh; \
		echo "$(GREEN)✅ Ícones da extensão gerados!$(NC)"; \
	else \
		echo "$(RED)❌ Script de ícones não encontrado$(NC)"; \
	fi

# Empacota extensão
ext-pack:
	@echo "$(YELLOW)📦 Empacotando extensão...$(NC)"
	@if [ -d "chrome-extension" ]; then \
		cd chrome-extension && \
		zip -r ../mySecrets-extension.zip . -x "*.git*" "*README*.md" "TESTE*.md" "*.sh"; \
		echo "$(GREEN)✅ Extensão empacotada: mySecrets-extension.zip$(NC)"; \
	else \
		echo "$(RED)❌ Pasta chrome-extension não encontrada$(NC)"; \
	fi

# Instruções para instalar extensão
ext-install:
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"
	@echo "$(YELLOW)📝 Como Instalar a Extensão no Chrome:$(NC)"
	@echo ""
	@echo "1. Abra o Chrome"
	@echo "2. Vá em: $(GREEN)chrome://extensions/$(NC)"
	@echo "3. Ative: $(GREEN)'Modo do desenvolvedor'$(NC) (canto superior direito)"
	@echo "4. Clique: $(GREEN)'Carregar sem compactação'$(NC)"
	@echo "5. Selecione a pasta: $(GREEN)chrome-extension/$(NC)"
	@echo "6. Copie o Extension ID"
	@echo "7. Execute: $(GREEN)make ext-integrate$(NC)"
	@echo ""
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"

# Instruções de pareamento com o app
ext-integrate:
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"
	@echo "$(YELLOW)🔌 Conectar a extensão ao app (autofill):$(NC)"
	@echo ""
	@echo "1. No app: $(GREEN)MCP$(NC) → $(GREEN)Iniciar servidor$(NC)"
	@echo "2. Marque: $(GREEN)'Iniciar o servidor ao desbloquear o cofre'$(NC)"
	@echo "3. Aba $(GREEN)'Extensão (autofill)'$(NC) → copiar o código"
	@echo "4. Clique no ícone da extensão → colar o código → $(GREEN)Conectar$(NC)"
	@echo ""
	@echo "$(BLUE)Sem native messaging: a extensão fala com 127.0.0.1 usando token.$(NC)"
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"

# Verifica integração
ext-check:
	@echo "$(YELLOW)🔍 Verificando integração...$(NC)"
	@echo ""
	@echo "$(YELLOW)Servidor local do app (porta 8765):$(NC)"
	@if curl -s -m 2 http://127.0.0.1:8765/health >/dev/null 2>&1; then \
		echo "  $(GREEN)✅ No ar$(NC) — $$(curl -s http://127.0.0.1:8765/health)"; \
	else \
		echo "  $(RED)❌ Fora do ar$(NC) — abra o app e inicie o servidor em MCP"; \
	fi
	@echo ""
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"

# Versões
version:
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"
	@echo "$(GREEN)  📋 Versões$(NC)"
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"
	@echo ""
	@echo "$(YELLOW)MySecrets:$(NC) $(shell node -p "require('./package.json').version" 2>/dev/null || echo 'N/A')"
	@echo "$(YELLOW)Node.js:$(NC)   $(shell node --version 2>/dev/null || echo 'Não instalado')"
	@echo "$(YELLOW)npm:$(NC)       $(shell npm --version 2>/dev/null || echo 'Não instalado')"
	@echo "$(YELLOW)Electron:$(NC)  $(shell npm list electron --depth=0 2>/dev/null | grep electron | awk '{print $$2}' || echo 'Não instalado')"
	@echo ""
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"

# Tamanho dos builds
size:
	@echo ""
	@echo "$(YELLOW)📊 Tamanho dos Builds:$(NC)"
	@if [ -d "dist" ]; then \
		echo "  Total: $(shell du -sh dist 2>/dev/null | cut -f1)"; \
		if [ -f "dist/MySecrets-1.0.0.AppImage" ]; then \
			echo "  AppImage: $(shell du -sh dist/MySecrets-1.0.0.AppImage 2>/dev/null | cut -f1)"; \
		fi; \
		if [ -d "dist/linux-unpacked" ]; then \
			echo "  Unpacked: $(shell du -sh dist/linux-unpacked 2>/dev/null | cut -f1)"; \
		fi; \
	else \
		echo "  $(RED)Nenhum build encontrado$(NC)"; \
	fi
	@echo ""

# ============================================
# 🎯 COMANDOS COMBINADOS
# ============================================

# Setup completo
all: install icons dev

# Limpeza e reinstalação rápida
quick: clean install dev

# Setup inicial do projeto
setup:
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"
	@echo "$(GREEN)  🚀 Setup Inicial do MySecrets$(NC)"
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"
	@make install
	@make icons
	@make ext-icons
	@echo ""
	@echo "$(GREEN)✅ Setup completo!$(NC)"
	@echo ""
	@echo "$(YELLOW)Próximos passos:$(NC)"
	@echo "  1. $(GREEN)make dev$(NC)        - Executar aplicativo"
	@echo "  2. $(GREEN)make ext-install$(NC) - Ver como instalar extensão"
	@echo ""
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"

# Build completo (Linux + Windows)
build-all: clean build-linux build-win
	@echo "$(GREEN)✅ Build completo de todas as plataformas!$(NC)"
	@make size

# ============================================
# 🎨 EXTRAS
# ============================================

# Abre documentação
docs:
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"
	@echo "$(GREEN)  📚 Documentação Organizada$(NC)"
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"
	@echo ""
	@echo "$(YELLOW)📖 Essencial:$(NC)"
	@echo "  README.md              - Visão geral"
	@echo "  QUICK_START.md         - Início rápido (5 min)"
	@echo "  INDEX.md               - 🔥 Navegação de tudo"
	@echo ""
	@echo "$(YELLOW)📂 Por Categoria:$(NC)"
	@echo "  docs/user/             - Para usuários"
	@echo "  docs/developer/        - Para desenvolvedores"
	@echo "  docs/extension/        - Extensão Chrome"
	@echo "  docs/guides/           - Guias práticos"
	@echo "  docs/summaries/        - Resumos e índices"
	@echo ""
	@echo "$(YELLOW)💡 Comandos:$(NC)"
	@echo "  $(GREEN)make docs-open$(NC)         - Abrir INDEX.md"
	@echo "  $(GREEN)make docs-user$(NC)         - Docs de usuário"
	@echo "  $(GREEN)make docs-dev$(NC)          - Docs de desenvolvedor"
	@echo "  $(GREEN)make docs-ext$(NC)          - Docs da extensão"
	@echo ""
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"

# Abrir documentação
docs-open:
	@if command -v xdg-open &> /dev/null; then \
		xdg-open INDEX.md 2>/dev/null || cat INDEX.md; \
	else \
		cat INDEX.md; \
	fi

# Ver docs de usuário
docs-user:
	@echo "$(YELLOW)📖 Documentação para Usuários:$(NC)"
	@ls -1 docs/user/

# Ver docs de desenvolvedor
docs-dev:
	@echo "$(YELLOW)💻 Documentação para Desenvolvedores:$(NC)"
	@ls -1 docs/developer/

# Ver docs da extensão
docs-ext:
	@echo "$(YELLOW)🌐 Documentação da Extensão:$(NC)"
	@ls -1 docs/extension/

# Mostra atalhos de teclado
shortcuts:
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"
	@echo "$(GREEN)  ⌨️  Atalhos do Makefile$(NC)"
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"
	@echo ""
	@echo "$(YELLOW)Comandos mais usados:$(NC)"
	@echo "  $(GREEN)make$(NC)              → Mostra ajuda"
	@echo "  $(GREEN)make dev$(NC)          → Executar (F5 no VSCode)"
	@echo "  $(GREEN)make build-linux$(NC)  → Build rápido"
	@echo "  $(GREEN)make clean$(NC)        → Limpar tudo"
	@echo ""
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"

# ============================================
# 🤖 SERVIDOR MCP (Claude / assistentes)
# ============================================

# Executa o servidor MCP (stdio) — normalmente iniciado pelo cliente MCP
mcp:
	@echo "$(GREEN)🤖 Iniciando servidor MCP do MySecrets...$(NC)"
	@echo "$(YELLOW)⚠️  O app precisa estar aberto e DESBLOQUEADO.$(NC)"
	node mcp-server/index.js

# Testa o servidor MCP (requer app aberto e desbloqueado)
mcp-test:
	@echo "$(YELLOW)🧪 Testando servidor MCP...$(NC)"
	@printf '%s\n' \
		'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
		'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"vault_status"}}' \
		| node mcp-server/index.js

# Mostra a configuração para adicionar o MCP ao cliente
mcp-config:
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"
	@echo "$(GREEN)  🤖 Configuração do MCP MySecrets$(NC)"
	@echo "$(BLUE)═══════════════════════════════════════════════════════$(NC)"
	@echo ""
	@echo "$(YELLOW)Claude Code:$(NC)"
	@echo "  $(GREEN)claude mcp add --scope user mysecrets -- node $(shell pwd)/mcp-server/index.js$(NC)"
	@echo ""
	@echo "$(YELLOW)Claude Desktop / .mcp.json:$(NC)"
	@echo '  {'
	@echo '    "mcpServers": {'
	@echo '      "mysecrets": {'
	@echo '        "command": "node",'
	@echo '        "args": ["$(shell pwd)/mcp-server/index.js"]'
	@echo '      }'
	@echo '    }'
	@echo '  }'
	@echo ""
	@echo "$(YELLOW)Gravar (store_secret / store_secret_file):$(NC) app aberto, desbloqueado,"
	@echo "  servidor local ligado (MCP > Iniciar servidor) e confirmar o pedido no app (4 min)."
	@echo ""
	@echo "$(BLUE)Detalhes: mcp-server/README.md$(NC)"

# ============================================
# 🐛 DEBUG
# ============================================

# Modo debug verboso
debug:
	@echo "$(YELLOW)🐛 Executando em modo debug...$(NC)"
	DEBUG=* npm run dev

# Verifica problemas
check:
	@echo "$(YELLOW)🔍 Verificando problemas...$(NC)"
	@echo ""
	@echo "$(YELLOW)Node.js:$(NC)"
	@node --version || echo "$(RED)❌ Node.js não instalado$(NC)"
	@echo ""
	@echo "$(YELLOW)npm:$(NC)"
	@npm --version || echo "$(RED)❌ npm não instalado$(NC)"
	@echo ""
	@echo "$(YELLOW)Dependências:$(NC)"
	@if [ -d "node_modules" ]; then \
		echo "$(GREEN)✅ node_modules existe$(NC)"; \
	else \
		echo "$(RED)❌ Execute: make install$(NC)"; \
	fi
	@echo ""
	@echo "$(YELLOW)package.json:$(NC)"
	@if [ -f "package.json" ]; then \
		echo "$(GREEN)✅ package.json existe$(NC)"; \
	else \
		echo "$(RED)❌ package.json não encontrado!$(NC)"; \
	fi

# ============================================
# Default target (mostra help)
# ============================================
.DEFAULT_GOAL := help
