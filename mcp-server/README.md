# MySecrets MCP Server

Servidor [MCP](https://modelcontextprotocol.io) que expõe o seu cofre do
**MySecrets** (senhas, tokens e OTPs/2FA) para clientes como **Claude Code**,
**Claude Desktop** e outros assistentes compatíveis com MCP.

## Como funciona (segurança)

Este servidor **não guarda a senha mestra**. Ele reaproveita exatamente o mesmo
modelo de segurança da extensão Chrome (native host):

1. Você abre o app **MySecrets** e **desbloqueia** o cofre.
2. O app grava um arquivo de sessão criptografado (`.session`) contendo a senha
   mestra, válido por **15 minutos** e amarrado à máquina/processo.
3. O servidor MCP lê essa sessão, descriptografa `secrets.enc` em memória e
   responde às ferramentas.

Se o app estiver **fechado, bloqueado ou a sessão expirou**, nenhuma ferramenta
devolve segredos — retorna um erro pedindo para desbloquear o app.

## Ferramentas disponíveis

| Ferramenta | O que faz |
|------------|-----------|
| `vault_status` | Diz se o cofre está acessível (app aberto e desbloqueado). |
| `list_secrets` | Lista entradas **sem** expor senhas/segredos. |
| `search_secrets` | Busca por título, URL/domínio, usuário ou tag (sem senhas). |
| `get_credentials` | Retorna usuário + senha (e OTP vinculado, se houver). |
| `get_otp` | Gera o código OTP/TOTP atual de uma entrada. |

Identifique a entrada por `id` (exato) ou por `query` (busca textual — usa o
resultado mais relevante).

## Dois modos de uso

### A) Controlado pelo app (recomendado) — transporte HTTP

Abra o **MySecrets**, clique no botão **MCP** no cabeçalho e em **Iniciar servidor**.
O app sobe um servidor HTTP local (`127.0.0.1`) protegido por um **token** gerado
na hora. A própria tela mostra o comando pronto para colar no cliente:

```bash
claude mcp add --transport http mysecrets http://127.0.0.1:8765/mcp \
  --header "Authorization: Bearer <TOKEN_MOSTRADO_NO_APP>"
```

Ou em `.mcp.json` / Claude Desktop:

```json
{
  "mcpServers": {
    "mysecrets": {
      "type": "http",
      "url": "http://127.0.0.1:8765/mcp",
      "headers": { "Authorization": "Bearer <TOKEN_MOSTRADO_NO_APP>" }
    }
  }
}
```

O token muda a cada vez que você inicia o servidor. Iniciar/parar é feito pelo app.

### B) Spawnado pelo cliente — transporte stdio

Neste modo o cliente MCP inicia o processo sozinho (não precisa iniciar nada no app,
mas o cofre ainda precisa estar aberto e desbloqueado):

## Instalação (stdio)

Não há dependências novas: usa apenas o `otplib` que o app já possui.

### Claude Code (CLI)

```bash
claude mcp add mysecrets -- node /home/ancalagon/mySecrets/mcp-server/index.js
```

Ou, por projeto, em `.mcp.json` / configuração do cliente:

```json
{
  "mcpServers": {
    "mysecrets": {
      "command": "node",
      "args": ["/home/ancalagon/mySecrets/mcp-server/index.js"]
    }
  }
}
```

### Claude Desktop

Edite `claude_desktop_config.json`:

- Linux: `~/.config/Claude/claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mysecrets": {
      "command": "node",
      "args": ["/home/ancalagon/mySecrets/mcp-server/index.js"]
    }
  }
}
```

Reinicie o cliente após configurar.

## Uso

1. Abra o MySecrets e **desbloqueie** o cofre.
2. No seu assistente, peça, por exemplo:
   - "Qual a senha do meu GitHub?"
   - "Me dá o código 2FA da Microsoft."
   - "Lista minhas contas do GitLab."

## Variáveis de ambiente

- `MYSECRETS_DATA_DIR` — sobrescreve o diretório de dados do app (padrão:
  `~/.config/mysecrets` no Linux, `%APPDATA%\mysecrets` no Windows,
  `~/Library/Application Support/mysecrets` no macOS).

## Teste rápido

Com o app aberto e desbloqueado:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"vault_status"}}' \
  | node mcp-server/index.js
```
