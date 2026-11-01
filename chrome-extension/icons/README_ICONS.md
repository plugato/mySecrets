# Ícones da Extensão MySecrets

Esta pasta deve conter os ícones da extensão nos seguintes tamanhos:

## Arquivos Necessários

```
icons/
├── icon16.png    # 16x16px  - Barra de ferramentas
├── icon32.png    # 32x32px  - Windows/Linux taskbar
├── icon48.png    # 48x48px  - Página de extensões
└── icon128.png   # 128x128px - Chrome Web Store
```

## Como Criar os Ícones

### Opção 1: Usando ImageMagick

Se você tem ImageMagick instalado:

```bash
# A partir do ícone principal do MySecrets
cd chrome-extension/icons

# Converter do ícone principal
convert ../../assets/icon.png -resize 16x16 icon16.png
convert ../../assets/icon.png -resize 32x32 icon32.png
convert ../../assets/icon.png -resize 48x48 icon48.png
convert ../../assets/icon.png -resize 128x128 icon128.png
```

### Opção 2: Online

Use geradores online:
- https://www.favicon-generator.org/
- https://realfavicongenerator.net/
- https://www.websiteplanet.com/webtools/favicon-generator/

### Opção 3: Manualmente

Use qualquer editor de imagens (GIMP, Photoshop, Figma):

1. Abra o ícone principal do MySecrets
2. Redimensione para cada tamanho necessário
3. Exporte como PNG
4. Salve nesta pasta com os nomes corretos

## Design Recomendado

### Cores
- **Principal**: #667eea (roxo/azul)
- **Secundária**: #764ba2 (roxo escuro)
- **Ícone**: 🔐 (cadeado) ou similar

### Estilo
- **Forma**: Quadrado com cantos arredondados (opcional)
- **Fundo**: Gradiente de roxo/azul
- **Símbolo**: Cadeado branco centralizado
- **Padding**: 10-15% de margem interna

### Exemplo de Design

```
┌────────────────┐
│                │
│      🔐        │  ← Cadeado branco
│                │     
│                │
└────────────────┘
  Fundo gradiente
  #667eea → #764ba2
```

## Ícones Temporários

Para desenvolvimento rápido, você pode usar ícones de emoji:

### Criar SVG e Converter

```bash
#!/bin/bash
# Script para criar ícones temporários

for size in 16 32 48 128; do
  echo "Criando icon${size}.png..."
  
  # Cria SVG temporário
  cat > temp.svg << EOF
<svg width="$size" height="$size" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="$size" height="$size" fill="url(#grad)" rx="$((size/8))" />
  <text x="50%" y="$(($size * 7 / 10))" 
        font-size="$(($size * 6 / 10))" 
        text-anchor="middle" 
        fill="white">🔐</text>
</svg>
EOF
  
  # Converte para PNG (requer Inkscape ou ImageMagick)
  convert temp.svg icon${size}.png
  
  # Limpa arquivo temporário
  rm temp.svg
done

echo "Ícones criados com sucesso!"
```

Salve como `create-icons.sh`, dê permissão de execução e rode:

```bash
chmod +x create-icons.sh
./create-icons.sh
```

## Verificação

Depois de criar os ícones, verifique:

1. **Tamanhos corretos**:
   ```bash
   file icon*.png
   # Deve mostrar dimensões corretas
   ```

2. **Qualidade visual**:
   - Abra cada arquivo em visualizador
   - Verifique se estão nítidos
   - Verifique se cores estão corretas

3. **Transparência** (opcional):
   - Fundos podem ser transparentes ou sólidos
   - Chrome adiciona fundo branco/preto automaticamente

## Diretrizes de Design

### Favicon (16x16 e 32x32)
- Mantenha simples
- Evite detalhes finos
- Use cores contrastantes
- Símbolo reconhecível

### Extensions Page (48x48)
- Pode ter mais detalhes
- Boa visibilidade do símbolo principal
- Gradientes funcionam bem

### Web Store (128x128)
- Alta qualidade
- Detalhes visíveis
- Representativo da marca
- Profissional

## Recursos

### Ferramentas Gratuitas
- **GIMP**: Editor de imagens gratuito
- **Inkscape**: Editor vetorial gratuito
- **Figma**: Design online gratuito
- **Canva**: Templates prontos

### Bibliotecas de Ícones
- **Material Icons**: https://fonts.google.com/icons
- **Font Awesome**: https://fontawesome.com/
- **Feather Icons**: https://feathericons.com/
- **Heroicons**: https://heroicons.com/

### Templates
Procure por "chrome extension icon template" no Google para encontrar templates prontos.

## Troubleshooting

### Ícones não aparecem
- Verifique nomes dos arquivos (exatamente como no manifest.json)
- Verifique se arquivos existem nesta pasta
- Recarregue a extensão em chrome://extensions/

### Ícones borrados
- Use PNG, não JPG
- Mantenha dimensões exatas
- Não redimensione no manifest, use arquivos nativos
- Evite gradientes muito sutis em ícones pequenos

### Ícones com fundo errado
- Use fundo sólido ou transparente
- Chrome pode adicionar fundo próprio
- Teste em tema claro e escuro do Chrome

## Exemplo de Uso no Manifest

```json
{
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  }
}
```

---

**Dica**: Comece com ícones simples para desenvolvimento e refine depois para produção.


