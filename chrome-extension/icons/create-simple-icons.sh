#!/bin/bash
# Cria ícones temporários usando texto

for size in 16 32 48 128; do
  convert -size ${size}x${size} xc:"#667eea" \
          -gravity center \
          -pointsize $((size * 60 / 100)) \
          -fill white \
          -annotate +0+0 "🔐" \
          icon${size}.png 2>/dev/null || \
  convert -size ${size}x${size} xc:"#667eea" \
          -gravity center \
          -pointsize $((size * 60 / 100)) \
          -fill white \
          -font DejaVu-Sans \
          -annotate +0+0 "MS" \
          icon${size}.png
  echo "Criado icon${size}.png"
done
