# 🚀 Como Executar o MySecrets

Guia completo para rodar e buildar o projeto MySecrets.

## ✅ Pré-requisitos (Já Feito!)

Você já tem:
- ✅ Node.js instalado
- ✅ Dependências instaladas (`node_modules/` existe)
- ✅ Código fonte completo

---

## 🏃 Executar o Projeto (3 Formas)

### Forma 1: Modo Desenvolvimento (Recomendado)

```bash
cd /media/ancalagon/DEV/Project/mySecrets
npm run dev
```

**O que faz:**
- Abre o aplicativo com **DevTools** (F12) aberto automaticamente
- Permite debug em tempo real
- Mostra logs no console

**Quando usar:** Durante desenvolvimento e testes

---

### Forma 2: Modo Produção

```bash
cd /media/ancalagon/DEV/Project/mySecrets
npm start
```

**O que faz:**
- Abre o aplicativo **sem DevTools**
- Experiência como usuário final
- Mais leve e rápido

**Quando usar:** Para testar a experiência do usuário

---

### Forma 3: Executar Diretamente com Electron

```bash
cd /media/ancalagon/DEV/Project/mySecrets
npx electron .
```

**O que faz:**
- Executa o Electron diretamente
- Sem scripts npm
- Útil para debug avançado

---

## 🎯 Executar Agora (RECOMENDADO)

### Opção Rápida - Modo Dev:

```bash
cd /media/ancalagon/DEV/Project/mySecrets && npm run dev
```

**Deve abrir:**
1. Janela do aplicativo MySecrets
2. DevTools aberto automaticamente
3. Tela de login/configuração

**Primeira vez usando:**
- Crie uma senha mestra
- Adicione algumas entradas de teste
- Explore as funcionalidades

---

## 📦 Buildar o Projeto (Criar Executável)

### Build para Linux (AppImage)

```bash
cd /media/ancalagon/DEV/Project/mySecrets
npm run build-linux
```

**Resultado:**
- Arquivo: `dist/MySecrets-1.0.0.AppImage`
- Tamanho: ~100-150 MB
- Executável independente

**Como usar:**
```bash
chmod +x dist/MySecrets-1.0.0.AppImage
./dist/MySecrets-1.0.0.AppImage
```

---

### Build para Windows (de dentro do Linux)

```bash
npm run build-win
```

**Requisitos:**
- Wine instalado (para cross-compilation)
- Pode levar mais tempo

**Instalar Wine (se necessário):**
```bash
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install wine64 wine32
```

**Resultado:**
- Arquivo: `dist/MySecrets-Setup-1.0.0.exe`
- Instalador para Windows

---

### Build para Todas as Plataformas

```bash
npm run build
```

**Gera:**
- AppImage (Linux)
- Instalador .exe (Windows)  
- Todos os formatos configurados

⚠️ **Atenção:** Pode levar 5-10 minutos e ocupar ~500MB

---

### Build "Pack" (Sem Instalador)

```bash
npm run pack
```

**O que faz:**
- Apenas empacota o app
- Não cria instalador
- Mais rápido para testes
- Resultado em: `dist/linux-unpacked/`

**Executar:**
```bash
./dist/linux-unpacked/mysecrets
```

---

## 🔧 Troubleshooting

### Erro: "Cannot find module"

```bash
# Reinstalar dependências
rm -rf node_modules package-lock.json
npm install
```

### Erro: "Electron failed to install correctly"

```bash
# Reinstalar Electron
npm install electron --save-dev
```

### Erro ao buildar para Windows

```bash
# Instalar Wine
sudo apt install wine64 wine32

# Ou desabilitar build Windows temporariamente
# Edite package.json e use apenas: npm run build-linux
```

### Erro: "EACCES: permission denied"

```bash
# Dar permissão na pasta dist
sudo chown -R $USER:$USER dist/
```

### Build muito lento

```bash
# Use pack em vez de build para testes
npm run pack

# Ou desabilite compressão (edite package.json):
"build": {
  "compression": "store"  // em vez de "maximum"
}
```

---

## 📊 Scripts Disponíveis

| Script | Comando | O que faz |
|--------|---------|-----------|
| **Dev** | `npm run dev` | Executa com DevTools |
| **Start** | `npm start` | Executa modo produção |
| **Build** | `npm run build` | Build para todas as plataformas |
| **Build Linux** | `npm run build-linux` | AppImage para Linux |
| **Build Windows** | `npm run build-win` | Instalador para Windows |
| **Pack** | `npm run pack` | Empacota sem instalador |

---

## 🎮 Usando o Aplicativo

### Primeira Vez

1. **Execute:** `npm run dev`

2. **Tela de Configuração:**
   - Crie senha mestra (mínimo 8 caracteres)
   - Confirme a senha
   - Clique em "Criar Cofre"

3. **Adicionar Entradas:**
   - Clique em "Adicionar"
   - Escolha tipo: Login, MFA, Token ou Nota
   - Preencha os campos
   - Clique em "Salvar"

### Tipos de Entradas

#### 🔑 Login
- **Para:** Sites, aplicativos
- **Campos:** Título, URL, Usuário, Senha, Notas

#### 🔐 MFA (Autenticação 2FA)
- **Para:** Códigos TOTP/HOTP
- **Campos:** 
  - Chave secreta
  - Período (30s padrão)
  - Dígitos (6 ou 8)
  - Algoritmo (SHA-1, SHA-256, SHA-512)

#### 🎫 Token
- **Para:** API keys, JWT, tokens de acesso
- **Campos:**
  - Token/chave
  - Tipo (API, JWT, Bearer, etc.)
  - Data de expiração

#### 📝 Nota Segura
- **Para:** Qualquer texto confidencial
- **Exemplos:** 
  - Chaves SSH
  - Códigos de recuperação
  - Informações de cartão
  - Senhas de WiFi

---

## 🧪 Testar MFA (TOTP)

### Adicionar Código TOTP de Teste

1. **Clique em "Adicionar" → "MFA"**

2. **Use esta chave secreta de teste:**
   ```
   JBSWY3DPEHPK3PXP
   ```

3. **Configurações:**
   - Algoritmo: TOTP
   - Período: 30 segundos
   - Dígitos: 6
   - Hash: SHA-1

4. **Verificar código:**
   - O código deve mudar a cada 30 segundos
   - Barra de progresso mostra tempo restante

### Importar Múltiplos MFA

```bash
# Use o script de importação
node import-mfa-entries.js
```

---

## 📁 Estrutura de Arquivos

```
mySecrets/
├── src/
│   ├── main.js              # Processo principal
│   ├── preload.js           # Preload script
│   └── renderer/            # Interface
│       ├── index.html       # HTML
│       ├── styles.css       # Estilos
│       └── app.js           # Lógica
├── assets/                  # Ícones
├── dist/                    # Builds (gerados)
├── node_modules/            # Dependências
├── package.json             # Configuração
└── README.md                # Documentação
```

---

## 🔍 Debug e Logs

### Ver Logs do Electron

**Modo Dev:**
- DevTools abre automaticamente
- Console mostra todos os logs

**Modo Produção:**
- Pressione `F12` para abrir DevTools
- Ou: Menu → Ver → Ferramentas do Desenvolvedor

### Logs do Sistema

**Linux:**
```bash
# Ver saída do terminal
npm run dev 2>&1 | tee app.log
```

**Arquivo de dados:**
```bash
# Linux
cat ~/.config/mysecrets/secrets.enc

# Será criptografado - normal aparecer "lixo"
```

---

## 🚀 Executar AGORA - Passo a Passo

### Método Recomendado:

```bash
# 1. Navegue até a pasta
cd /media/ancalagon/DEV/Project/mySecrets

# 2. Execute modo dev
npm run dev

# 3. Aguarde o aplicativo abrir (5-10 segundos)

# 4. Crie senha mestra na primeira tela

# 5. Comece a usar!
```

### Se der erro:

```bash
# Reinstalar dependências
npm install

# Tentar novamente
npm run dev
```

---

## 📊 Verificar Build

Após buildar, verifique:

```bash
# Listar arquivos gerados
ls -lh dist/

# Verificar tamanho
du -h dist/MySecrets-1.0.0.AppImage

# Testar AppImage
chmod +x dist/MySecrets-1.0.0.AppImage
./dist/MySecrets-1.0.0.AppImage
```

---

## 🎯 Checklist de Execução

- [ ] Navegado para pasta do projeto
- [ ] Executado `npm run dev`
- [ ] Aplicativo abriu
- [ ] DevTools aberto (F12)
- [ ] Criada senha mestra
- [ ] Adicionada entrada de teste
- [ ] MFA testado (opcional)
- [ ] Backup exportado (opcional)

Se todos ✅: **Aplicativo funcionando perfeitamente!** 🎉

---

## 🆘 Precisa de Ajuda?

**Documentação:**
- [README.md](README.md) - Guia completo
- [QUICK_START.md](QUICK_START.md) - Início rápido
- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) - Para desenvolvedores

**Problemas comuns:**
- Veja seção "Troubleshooting" acima
- Verifique logs no DevTools (F12)
- Reinstale dependências: `npm install`

---

## 💡 Dicas Úteis

### Desenvolvimento Rápido

```bash
# Terminal 1: Modo watch (auto-reload)
npm run dev

# Terminal 2: Logs
tail -f ~/.config/Electron/logs/main.log
```

### Build Rápido para Testes

```bash
# Só empacota, não cria instalador
npm run pack

# Executa direto
./dist/linux-unpacked/mysecrets
```

### Limpar Builds Antigos

```bash
# Remove dist completamente
rm -rf dist/

# Build limpo
npm run build-linux
```

---

**Pronto! Agora você pode executar e buildar o MySecrets! 🚀🔒**

**Execute agora:**
```bash
cd /media/ancalagon/DEV/Project/mySecrets && npm run dev
```
