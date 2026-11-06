# Passkeys: plano (última etapa)

Status: **planejado, não iniciado.** Este documento é o ponto de partida para
implementar passkeys (WebAuthn) no MySecrets. Ele fica por último porque é o
item maior e o mais sensível de segurança do roadmap.

## Objetivo

Guardar passkeys no mesmo cofre (`secrets.enc`) e usá-las para entrar em sites
e apps, como os gerenciadores de senha fazem:

- **Navegador** (Chrome e Firefox, pela extensão + app desktop): criar e usar
  passkeys em qualquer site.
- **Android** (Credential Manager, Android 14+): o app vira provedor de
  passkeys do sistema, para apps e navegadores.
- Sincroniza pelo Google Drive como o resto do cofre.

Fora do escopo da primeira versão: passkeys "device-bound" (chave presa a
hardware), atestado de fabricante (`attestation` diferente de `none`),
extensões como `prf`/`largeBlob`, e importar/exportar passkeys de outros
gerenciadores (o formato CXF ainda é recente).

## Modelo de dados (entrada nova no cofre)

```json
{
  "id": "...", "type": "passkey", "title": "github.com",
  "updatedAt": "...", "createdAt": "...",
  "passkey": {
    "rpId": "github.com",
    "credentialId": "<base64url>",
    "userHandle": "<base64url>",
    "userName": "eu@exemplo.com",
    "userDisplayName": "Eu",
    "alg": -7,
    "privateKey": "<PKCS#8 base64url>",
    "signCount": 0,
    "discoverable": true,
    "createdBy": "chrome|firefox|android"
  }
}
```

- Algoritmo: **ES256 (-7)**, aceito por praticamente todos os sites. A chave
  privada fica só dentro do cofre cifrado.
- Uma passkey pode ser ligada a um login existente do mesmo site (como o 2FA
  hoje: `linkedPasskeyId`) ou ficar sozinha.
- `signCount` fica em 0 e não é incrementado (prática dos gerenciadores
  sincronizados; os sites aceitam). Assim, editar em dois aparelhos não gera
  conflito.
- Merge e exclusões: as mesmas regras de hoje (`vault-sync.js`,
  `Merge.kt`): a passkey é uma entrada como as outras.

## Fase 1: navegador (extensão + app desktop)

### Fluxo

1. **Página → extensão.** Um script no mundo da página (`world: "MAIN"`)
   substitui `navigator.credentials.create/get` só para `publicKey`. Ele repassa
   o pedido ao content script por `postMessage`, com um canal próprio, e
   sempre oferece "usar outro dispositivo", que chama a implementação original
   do navegador.
2. **Extensão → app.** O background valida o pedido e chama ferramentas novas do
   servidor local (só para a extensão, como `match_url`):
   `passkey_create` (com confirmação na janela do app) e `passkey_get`.
3. **App.** Gera ou usa a chave (`crypto` do Node, ES256), monta
   `authenticatorData`, assina `authenticatorData || SHA-256(clientDataJSON)` e
   devolve. Na criação, a resposta usa `attestationObject` com formato `none`.
4. **Extensão → página.** Monta um `PublicKeyCredential` compatível
   (`response.clientDataJSON`, `authenticatorData`, `signature`, `userHandle`,
   `getTransports()`, `getPublicKey()`, `toJSON()`).

### Segurança (requisitos, todos com teste)

- **rpId x origem:** o `rpId` precisa ser o host da página ou um sufixo
  registrável dele (Public Suffix List, a mesma do `match_url`). `rpId` de outro
  site é recusado. Só `https:` (e `http://localhost` para desenvolvimento).
- **clientDataJSON montado pela extensão**, nunca vindo da página:
  `type`, `challenge` (o da página), `origin` (o da aba, conferido de novo no
  background) e `crossOrigin: false`. Frames: só o frame principal na primeira
  versão.
- **Presença e verificação do usuário:** criar sempre pede confirmação no app.
  Usar uma passkey mostra na página qual conta vai entrar, e o clique conta
  como presença. Verificação (`UV`) só com o cofre desbloqueado. Os flags
  `UP`/`UV`/`BE`/`BS` no `authenticatorData` devem refletir isso.
- **Nenhuma chave privada sai do app.** A extensão recebe só a assinatura.
- O canal página↔content script não aceita mensagens de outros frames nem de
  outras origens, e cada pedido tem um id aleatório.
- Ferramentas MCP de agentes **não** veem passkeys (nem a chave nem que existem),
  a não ser que isso seja decidido depois.

### Interface

- Desktop: tipo "Passkey" na lista e nos detalhes (site, usuário, criada em,
  dispositivo), excluir e ligar a um login. Sem editar a chave.
- Extensão: no `get`, lista as passkeys do site (como os logins hoje); no
  `create`, "Salvar passkey no MySecrets?".

### Pronto quando

- Testes unitários: montagem de `authenticatorData`/`attestationObject` (CBOR),
  assinatura verificável com a chave pública, validação de `rpId` (casos de
  sufixo público, subdomínio, outro site, http), e o merge com passkeys.
- E2E em Chromium e Firefox reais (como os testes da extensão de hoje) contra
  um servidor WebAuthn de teste local, usando uma biblioteca de verificação de
  servidor (ex.: `@simplewebauthn/server`): registrar, entrar e recusar
  `rpId` de outro site.
- Teste manual em sites reais (ex.: webauthn.io, GitHub).

## Fase 2: Android (Credential Manager)

- `CredentialProviderService` (Android 14+): responder a `BeginCreateCredential`
  e `BeginGetCredential`, abrindo uma Activity com biometria para concluir.
- Validação de origem: em navegadores, a origem vem do próprio navegador
  (lista de navegadores confiáveis, como no autofill); em apps, conferir o
  vínculo do app com o domínio (**Digital Asset Links**,
  `/.well-known/assetlinks.json`) antes de aceitar o `rpId`.
- Mesma montagem de resposta da fase 1 (port em Kotlin, testado contra os
  mesmos vetores gerados pelo desktop, como o `CompatTest` faz com o cofre).
- Pronto quando: testes JVM com os vetores; teste no emulador com um app de
  exemplo do Credential Manager; teste num site real pelo Chrome do Android.

## Riscos e decisões em aberto

- Sites que exigem atestado ou chaves presas a hardware não vão aceitar
  (esperado para gerenciadores sincronizados).
- Alguns sites detectam provedores por `getClientCapabilities()`: decidir o que
  anunciar.
- Prioridade entre o provedor do MySecrets e o do navegador/sistema quando o
  usuário tem os dois (oferecer sempre "usar outro dispositivo").
- Exportar passkeys (CXF/CXP) quando o padrão amadurecer.
