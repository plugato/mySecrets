# 📚 Índice de Documentação - MySecrets

Navegação simplificada de toda a documentação.

---

## 🚀 Começar Agora

```bash
make dev              # Executar app
make                  # Ver todos os comandos
```

---

## 📖 Documentação por Categoria

### 🎯 ESSENCIAL (Leia Primeiro)

| Documento | Tempo | Descrição |
|-----------|-------|-----------|
| **[README.md](README.md)** | 2 min | Visão geral do projeto |
| **[QUICK_START.md](QUICK_START.md)** | 5 min | Início rápido |
| **[docs/guides/COMO_USAR.txt](docs/guides/COMO_USAR.txt)** | 2 min | Referência rápida de comandos |

---

### 👤 PARA USUÁRIOS

| Documento | Descrição |
|-----------|-----------|
| **[docs/user/INSTALLATION.md](docs/user/INSTALLATION.md)** | Como instalar no Linux/Windows/Mac |
| **[docs/user/SECURITY.md](docs/user/SECURITY.md)** | Como seus dados são protegidos |

---

### 💻 PARA DESENVOLVEDORES

| Documento | Descrição |
|-----------|-----------|
| **[docs/developer/DEVELOPER_GUIDE.md](docs/developer/DEVELOPER_GUIDE.md)** | Guia técnico completo |
| **[docs/developer/CONTRIBUTING.md](docs/developer/CONTRIBUTING.md)** | Como contribuir |
| **[docs/developer/CHANGELOG.md](docs/developer/CHANGELOG.md)** | Histórico de mudanças |

---

### 🌐 EXTENSÃO CHROME

| Documento | Descrição |
|-----------|-----------|
| **[docs/extension/INTEGRACAO_EXTENSAO.md](docs/extension/INTEGRACAO_EXTENSAO.md)** | Como integrar com app desktop |
| **[docs/extension/LEIA_ME_EXTENSAO.md](docs/extension/LEIA_ME_EXTENSAO.md)** | README da extensão |
| **[docs/extension/EXTENSION_SUMMARY.md](docs/extension/EXTENSION_SUMMARY.md)** | Resumo técnico |
| **[chrome-extension/README_EXTENSION.md](chrome-extension/README_EXTENSION.md)** | Documentação técnica |

---

### 🤖 SERVIDOR MCP (ASSISTENTES DE IA)

| Documento | Descrição |
|-----------|-----------|
| **[mcp-server/README.md](mcp-server/README.md)** | Ferramentas de leitura e gravação, anexos de arquivo, configuração no Claude Code |

---

### 📖 GUIAS PRÁTICOS

| Documento | Descrição |
|-----------|-----------|
| **[docs/guides/EXECUTAR_PROJETO.md](docs/guides/EXECUTAR_PROJETO.md)** | Como executar e buildar |
| **[docs/guides/MAKEFILE_GUIA.md](docs/guides/MAKEFILE_GUIA.md)** | Guia completo do Makefile |
| **[docs/guides/INSTALAR_INTEGRACAO.txt](docs/guides/INSTALAR_INTEGRACAO.txt)** | Integração extensão (visual) |

---

### 📑 RESUMOS E ÍNDICES

| Documento | Descrição |
|-----------|-----------|
| **[docs/summaries/START_HERE.md](docs/summaries/START_HERE.md)** | Navegação por perfil de usuário |
| **[docs/summaries/DOCS_INDEX.md](docs/summaries/DOCS_INDEX.md)** | Índice completo por tópico |
| **[docs/summaries/RESUMO_INTEGRACAO.md](docs/summaries/RESUMO_INTEGRACAO.md)** | Resumo da integração |
| **[docs/summaries/RESUMO_MAKEFILE.md](docs/summaries/RESUMO_MAKEFILE.md)** | Resumo do Makefile |
| **[docs/summaries/DOCUMENTATION_SUMMARY.md](docs/summaries/DOCUMENTATION_SUMMARY.md)** | Resumo de toda documentação |

---

## 🎯 Fluxos de Leitura

### 👤 "Sou Novo Usuário"

1. [README.md](README.md) - Visão geral (2 min)
2. [QUICK_START.md](QUICK_START.md) - Começar (5 min)
3. [docs/guides/EXECUTAR_PROJETO.md](docs/guides/EXECUTAR_PROJETO.md) - Detalhes (10 min)
4. Usar o app! 🚀

### 💻 "Sou Desenvolvedor"

1. [README.md](README.md) - Contexto
2. [docs/developer/DEVELOPER_GUIDE.md](docs/developer/DEVELOPER_GUIDE.md) - Arquitetura
3. [docs/guides/MAKEFILE_GUIA.md](docs/guides/MAKEFILE_GUIA.md) - Comandos
4. [docs/developer/CONTRIBUTING.md](docs/developer/CONTRIBUTING.md) - Contribuir

### 🌐 "Quero Usar a Extensão"

1. [README.md](README.md) - O que é
2. Instalar extensão (chrome://extensions/)
3. [docs/extension/INTEGRACAO_EXTENSAO.md](docs/extension/INTEGRACAO_EXTENSAO.md) - Integrar
4. `make ext-integrate` - Configurar
5. Usar! 🎉

### 🔐 "Me Preocupo com Segurança"

1. [docs/user/SECURITY.md](docs/user/SECURITY.md) - Política de segurança
2. [docs/developer/DEVELOPER_GUIDE.md](docs/developer/DEVELOPER_GUIDE.md) - Implementação
3. Código fonte em `src/` - Auditável

---

## 📂 Estrutura de Pastas

```
docs/
├── user/           👤 Documentação para usuários
│   ├── INSTALLATION.md
│   └── SECURITY.md
│
├── developer/      💻 Documentação para desenvolvedores
│   ├── DEVELOPER_GUIDE.md
│   ├── CONTRIBUTING.md
│   └── CHANGELOG.md
│
├── extension/      🌐 Documentação da extensão Chrome
│   ├── INTEGRACAO_EXTENSAO.md
│   ├── LEIA_ME_EXTENSAO.md
│   └── EXTENSION_SUMMARY.md
│
├── guides/         📖 Guias práticos
│   ├── EXECUTAR_PROJETO.md
│   ├── MAKEFILE_GUIA.md
│   ├── COMO_USAR.txt
│   └── INSTALAR_INTEGRACAO.txt
│
└── summaries/      📑 Resumos e índices
    ├── START_HERE.md
    ├── DOCS_INDEX.md
    ├── RESUMO_INTEGRACAO.md
    ├── RESUMO_MAKEFILE.md
    └── DOCUMENTATION_SUMMARY.md
```

---

## 🔍 Buscar por Tópico

### Executar o Projeto
- [README.md](README.md) - Comando rápido
- [QUICK_START.md](QUICK_START.md) - Passo a passo
- [docs/guides/EXECUTAR_PROJETO.md](docs/guides/EXECUTAR_PROJETO.md) - Guia completo

### Makefile
- [docs/guides/MAKEFILE_GUIA.md](docs/guides/MAKEFILE_GUIA.md) - Guia completo
- [docs/guides/COMO_USAR.txt](docs/guides/COMO_USAR.txt) - Referência rápida
- [docs/summaries/RESUMO_MAKEFILE.md](docs/summaries/RESUMO_MAKEFILE.md) - Resumo

### Extensão Chrome
- [docs/extension/INTEGRACAO_EXTENSAO.md](docs/extension/INTEGRACAO_EXTENSAO.md) - Integração
- [docs/guides/INSTALAR_INTEGRACAO.txt](docs/guides/INSTALAR_INTEGRACAO.txt) - Instalação visual
- [docs/summaries/RESUMO_INTEGRACAO.md](docs/summaries/RESUMO_INTEGRACAO.md) - Resumo técnico

### Servidor MCP e anexos
- [mcp-server/README.md](mcp-server/README.md) - `store_secret`, `store_secret_file`, `get_secret_file`
- Fluxo: agente chama a ferramenta → app mostra o diálogo (entrada, arquivos, tamanhos) → você aprova → grava no cofre cifrado
- Configurar no Claude Code: `make mcp-config`

### Instalação
- [docs/user/INSTALLATION.md](docs/user/INSTALLATION.md) - Detalhado
- [QUICK_START.md](QUICK_START.md) - Rápido

### Segurança
- [docs/user/SECURITY.md](docs/user/SECURITY.md) - Política e detalhes
- [docs/developer/DEVELOPER_GUIDE.md](docs/developer/DEVELOPER_GUIDE.md) - Implementação

### Desenvolvimento
- [docs/developer/DEVELOPER_GUIDE.md](docs/developer/DEVELOPER_GUIDE.md) - Arquitetura
- [docs/developer/CONTRIBUTING.md](docs/developer/CONTRIBUTING.md) - Contribuir
- [docs/developer/CHANGELOG.md](docs/developer/CHANGELOG.md) - Histórico

---

## 📊 Estatísticas da Documentação

- **Total de documentos:** 19
- **Páginas totais:** ~8.000 linhas
- **Tempo de leitura completa:** ~4 horas
- **Tempo para começar:** 5 minutos (QUICK_START.md)

---

## 💡 Dicas de Navegação

### Ver Comandos Disponíveis

```bash
make              # Lista TODOS os comandos
make help         # Mesma coisa
```

### Documentação no Terminal

```bash
# Referência rápida
cat docs/guides/COMO_USAR.txt

# Ver guia específico
cat docs/guides/EXECUTAR_PROJETO.md | less

# Buscar em toda documentação
grep -r "palavra" docs/
```

### Abrir no Editor

```bash
# VSCode
code docs/

# Vim
vim INDEX.md
```

---

## 🆘 Não Encontrou o Que Procura?

1. **Verificar este índice** - Procure por palavra-chave
2. **Ver [START_HERE.md](docs/summaries/START_HERE.md)** - Navegação por perfil
3. **Ver [DOCS_INDEX.md](docs/summaries/DOCS_INDEX.md)** - Índice completo
4. **Buscar nos arquivos:**
   ```bash
   grep -r "sua_busca" docs/
   ```

---

## 🚀 Links Rápidos

| Ação | Documento |
|------|-----------|
| Começar agora | [QUICK_START.md](QUICK_START.md) |
| Ver comandos | `make` |
| Executar | `make dev` |
| Instalar extensão | [docs/extension/](docs/extension/) |
| Desenvolver | [docs/developer/DEVELOPER_GUIDE.md](docs/developer/DEVELOPER_GUIDE.md) |

---

**Navegue pela documentação de forma organizada e encontre o que precisa rapidamente!**

📖 **Comece aqui:** [README.md](README.md)
