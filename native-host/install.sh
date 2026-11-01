#!/bin/bash

##
# Script de Instalação do Native Messaging Host
# 
# Instala o host de mensagens nativas para comunicação
# entre a extensão Chrome e o app MySecrets desktop
##

set -e

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   MySecrets - Instalação do Native Messaging Host   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Detecta diretório do script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Caminhos
HOST_SCRIPT="$SCRIPT_DIR/mysecrets-wrapper.sh"
HOST_MANIFEST="$SCRIPT_DIR/com.mysecrets.native.json"

# Diretório de instalação do Chrome (Linux)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    NATIVE_MESSAGING_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    CHROMIUM_DIR="$HOME/.config/chromium/NativeMessagingHosts"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    NATIVE_MESSAGING_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    CHROMIUM_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
else
    echo -e "${RED}❌ Sistema operacional não suportado${NC}"
    exit 1
fi

echo -e "${YELLOW}📁 Verificando arquivos...${NC}"

# Verifica se os arquivos existem
if [ ! -f "$HOST_SCRIPT" ]; then
    echo -e "${RED}❌ Erro: mysecrets-wrapper.sh não encontrado${NC}"
    exit 1
fi

if [ ! -f "$HOST_MANIFEST" ]; then
    echo -e "${RED}❌ Erro: com.mysecrets.native.json não encontrado${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Arquivos encontrados${NC}"
echo ""

# Torna o script executável
echo -e "${YELLOW}🔧 Tornando script executável...${NC}"
chmod +x "$HOST_SCRIPT"
echo -e "${GREEN}✅ Permissões configuradas${NC}"
echo ""

# Pergunta o Extension ID
echo -e "${YELLOW}🔑 Extension ID${NC}"
echo ""
echo "Para encontrar o Extension ID:"
echo "1. Abra Chrome/Chromium"
echo "2. Vá em chrome://extensions/"
echo "3. Ative 'Modo do desenvolvedor'"
echo "4. Encontre 'MySecrets' e copie o ID"
echo ""
echo -e "${YELLOW}Cole o Extension ID (ou deixe em branco para configurar depois):${NC}"
read -r EXTENSION_ID

if [ -z "$EXTENSION_ID" ]; then
    echo -e "${YELLOW}⚠️  Extension ID não fornecido. Você precisará editar manualmente o manifest depois.${NC}"
    EXTENSION_ID="EXTENSION_ID_HERE"
else
    echo -e "${GREEN}✅ Extension ID: $EXTENSION_ID${NC}"
fi
echo ""

# Cria manifest temporário com o Extension ID e caminho correto
echo -e "${YELLOW}📝 Criando manifest...${NC}"
TMP_MANIFEST="/tmp/com.mysecrets.native.json"

cat > "$TMP_MANIFEST" << EOF
{
  "name": "com.mysecrets.native",
  "description": "MySecrets Native Messaging Host",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF

echo -e "${GREEN}✅ Manifest criado${NC}"
echo ""

# Instala para Chrome
echo -e "${YELLOW}🌐 Instalando para Google Chrome...${NC}"
mkdir -p "$NATIVE_MESSAGING_DIR"
cp "$TMP_MANIFEST" "$NATIVE_MESSAGING_DIR/com.mysecrets.native.json"
echo -e "${GREEN}✅ Instalado em: $NATIVE_MESSAGING_DIR${NC}"
echo ""

# Instala para Chrome Unstable (se existir)
CHROME_UNSTABLE_DIR="$HOME/.config/google-chrome-unstable/NativeMessagingHosts"
if [ -d "$HOME/.config/google-chrome-unstable" ]; then
    echo -e "${YELLOW}🌐 Instalando para Chrome Unstable...${NC}"
    mkdir -p "$CHROME_UNSTABLE_DIR"
    cp "$TMP_MANIFEST" "$CHROME_UNSTABLE_DIR/com.mysecrets.native.json"
    echo -e "${GREEN}✅ Instalado em: $CHROME_UNSTABLE_DIR${NC}"
    echo ""
fi

# Instala para Chromium (se existir)
if command -v chromium &> /dev/null || command -v chromium-browser &> /dev/null; then
    echo -e "${YELLOW}🌐 Instalando para Chromium...${NC}"
    mkdir -p "$CHROMIUM_DIR"
    cp "$TMP_MANIFEST" "$CHROMIUM_DIR/com.mysecrets.native.json"
    echo -e "${GREEN}✅ Instalado em: $CHROMIUM_DIR${NC}"
    echo ""
fi

# Limpa temporário
rm "$TMP_MANIFEST"

# Mostra resumo
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              ✅ Instalação Completa!                  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}📊 Resumo:${NC}"
echo "  • Host instalado: $NATIVE_MESSAGING_DIR"
echo "  • Script: $HOST_SCRIPT"
echo "  • Extension ID: $EXTENSION_ID"
echo ""
echo -e "${YELLOW}🎯 Próximos passos:${NC}"
echo "  1. Carregue a extensão no Chrome (chrome://extensions/)"
echo "  2. Abra o app MySecrets desktop"
echo "  3. Desbloqueie o cofre"
echo "  4. A extensão agora terá acesso aos seus dados!"
echo ""

if [ "$EXTENSION_ID" == "EXTENSION_ID_HERE" ]; then
    echo -e "${RED}⚠️  IMPORTANTE:${NC}"
    echo "  Você precisa editar o manifest com o Extension ID correto:"
    echo "  $NATIVE_MESSAGING_DIR/com.mysecrets.native.json"
    echo ""
fi

echo -e "${YELLOW}📖 Documentação:${NC}"
echo "  Ver: native-host/README.md"
echo ""
