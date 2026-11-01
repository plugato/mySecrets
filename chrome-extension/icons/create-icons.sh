#!/bin/bash
# Script para criar ícones temporários da extensão MySecrets
# Requer ImageMagick instalado

echo "🎨 Criando ícones temporários para MySecrets Extension..."

# Verifica se ImageMagick está instalado
if ! command -v convert &> /dev/null; then
    echo "❌ Erro: ImageMagick não encontrado"
    echo "   Instale com: sudo apt-get install imagemagick"
    exit 1
fi

# Cores
PRIMARY_COLOR="#667eea"
SECONDARY_COLOR="#764ba2"

# Cria ícones para cada tamanho
for size in 16 32 48 128; do
    echo "   Criando icon${size}.png..."
    
    # Calcula tamanhos proporcionais
    rx=$((size / 8))  # Raio dos cantos
    font_size=$((size * 6 / 10))  # Tamanho do emoji
    y_pos=$((size * 7 / 10))  # Posição Y do emoji
    
    # Cria SVG temporário
    cat > temp${size}.svg << EOF
<svg width="$size" height="$size" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:$PRIMARY_COLOR;stop-opacity:1" />
      <stop offset="100%" style="stop-color:$SECONDARY_COLOR;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="$size" height="$size" fill="url(#grad)" rx="$rx" />
  <text x="50%" y="$y_pos" 
        font-size="$font_size" 
        text-anchor="middle" 
        fill="white" 
        font-family="Arial, sans-serif">🔐</text>
</svg>
EOF
    
    # Converte SVG para PNG
    convert temp${size}.svg icon${size}.png 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "   ✅ icon${size}.png criado"
    else
        echo "   ❌ Erro ao criar icon${size}.png"
    fi
    
    # Remove arquivo temporário
    rm temp${size}.svg
done

echo ""
echo "✅ Ícones criados com sucesso!"
echo ""
echo "📁 Localização: $(pwd)"
echo ""
echo "🔍 Verificando arquivos criados:"
ls -lh icon*.png 2>/dev/null || echo "   ⚠️  Nenhum arquivo PNG encontrado"
echo ""
echo "💡 Dica: Estes são ícones temporários para desenvolvimento."
echo "   Para produção, considere criar ícones profissionais."

