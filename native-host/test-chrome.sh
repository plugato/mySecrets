#!/bin/bash

echo "🔍 Teste de Native Messaging - MySecrets"
echo ""

# 1. Verificar Extension ID
echo "1️⃣ Extension ID no manifest:"
grep "chrome-extension" ~/.config/google-chrome/NativeMessagingHosts/com.mysecrets.native.json || echo "❌ Manifest não encontrado"
echo ""

# 2. Verificar caminho do wrapper
echo "2️⃣ Caminho do wrapper no manifest:"
grep "path" ~/.config/google-chrome/NativeMessagingHosts/com.mysecrets.native.json || echo "❌ Path não encontrado"
echo ""

# 3. Verificar se wrapper existe e é executável
WRAPPER="/media/ancalagon/DEV/Project/mySecrets/native-host/mysecrets-wrapper.sh"
echo "3️⃣ Wrapper existe e é executável?"
if [ -x "$WRAPPER" ]; then
    echo "✅ Sim: $WRAPPER"
else
    echo "❌ Não: $WRAPPER"
fi
echo ""

# 4. Verificar Node.js
echo "4️⃣ Node.js encontrado?"
if [ -f "/home/ancalagon/.local/share/mise/installs/node/20.19.5/bin/node" ]; then
    echo "✅ Node.js: /home/ancalagon/.local/share/mise/installs/node/20.19.5/bin/node"
    /home/ancalagon/.local/share/mise/installs/node/20.19.5/bin/node --version
else
    echo "❌ Node.js não encontrado no caminho esperado"
fi
echo ""

# 5. Testar wrapper diretamente
echo "5️⃣ Testar wrapper (timeout 2s):"
echo '{"command":"ping"}' | timeout 2 "$WRAPPER" 2>&1 || echo "⚠️  Wrapper não respondeu (esperado - precisa de formato binário)"
echo ""

# 6. Verificar logs do Chrome (se existirem)
echo "6️⃣ Logs do Chrome (últimas linhas):"
if [ -f ~/.config/google-chrome/chrome_debug.log ]; then
    tail -5 ~/.config/google-chrome/chrome_debug.log 2>/dev/null || echo "Sem logs"
else
    echo "Arquivo de log não existe"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Diagnóstico completo"
echo ""
echo "🎯 Próximo passo:"
echo "   Copie o Extension ID de chrome://extensions/"
echo "   e me informe se é diferente de: fpckkmfmhhenlcdpgmaaopneddapegdl"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
