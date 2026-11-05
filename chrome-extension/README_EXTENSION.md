<div align="center">

# 🌐 MySecrets Autofill

**Extensão Chrome que preenche login, senha e código 2FA com o cofre do app desktop.**

![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)
![Sem cofre no navegador](https://img.shields.io/badge/cofre_no_navegador-nenhum-22c55e?style=flat-square)

<img src="../docs/screenshots/extensao-popup.png" alt="Popup da extensão listando os logins do site atual" width="320">

</div>

A extensão **não guarda o cofre nem a senha mestra**. Ela pergunta ao app, que
só responde com o cofre aberto e desbloqueado.

## Como funciona

```
Extensão  --(HTTP + token)-->  127.0.0.1:8765  --(sessão)-->  cofre do app
```

O app sobe um servidor local (o mesmo usado pelos assistentes de IA), escutando
só em loopback e exigindo um token bearer. O token chega à extensão por um
código de pareamento que você copia no app. Fechou o app ou bloqueou o cofre, a
extensão fica sem dados.

## Instalação (uma vez)

1. Chrome → `chrome://extensions/` → ative **Modo do desenvolvedor**
2. **Carregar sem compactação** → selecione a pasta `chrome-extension/`
3. No app MySecrets: **MCP** → **Iniciar servidor** → marque
   *"Iniciar o servidor ao desbloquear o cofre"*
4. Copie o **Código de pareamento da extensão** (abaixo do token)
5. Clique no ícone da extensão → cole o código → **Conectar**

## Uso

- Ícone da extensão: lista os logins do site atual → **Preencher**
- `Ctrl+Shift+A`: preenche direto com a primeira correspondência
- Clique direito num campo → *Preencher com MySecrets*
- `Ctrl+Shift+L`: desconecta a extensão do app

O código 2FA é buscado no momento do preenchimento, então nunca vai expirado.

## Correspondência de site

A busca tenta, nesta ordem: domínio exato → sem `www.` → domínio base
(`app.exemplo.com.br` → `exemplo.com.br`). Cadastre a URL no login do app para que
ele apareça aqui.

## Problemas

| Sintoma | Causa |
|---|---|
| "App MySecrets fechado ou servidor local parado" | Abra o app e inicie o servidor em **MCP** |
| "Token inválido — refaça o pareamento" | O token do app mudou (ex.: app reinstalado do zero): copie o código de novo |
| "Cofre bloqueado" | Desbloqueie o app |
| Nenhuma entrada no site | O login cadastrado não tem a URL do site |

## Segurança

- Servidor só em `127.0.0.1`, token obrigatório em toda chamada
- Páginas web comuns são bloqueadas por origem (`Origin`), mesmo com o token
- O código de pareamento é recusado se apontar para fora do seu computador
- Senha e OTP só saem do app na hora do preenchimento — a lista do popup traz
  apenas título e usuário
