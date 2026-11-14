# Aprovar pelo celular de qualquer lugar (relay)

A ligação PC ↔ celular pela rede local (`src/lib/phone-link.js`) só funciona
com o celular no mesmo Wi-Fi. O relay deixa o celular aprovar **de qualquer
lugar** (4G, outra rede):

- **gravações de agentes** (`store_secret`, `store_secret_file`);
- **leituras de agentes** com o cofre bloqueado (ou sempre, se configurado),
  liberando **só aquela leitura** (padrão) ou **por alguns minutos** (5, 15 ou 30);
- o **login do PC**, quando o celular não está na rede local.

O app precisa estar aberto no PC (pode estar bloqueado) e o servidor local
(MCP) ligado.

## Peças

| Onde | Arquivo | Papel |
|---|---|---|
| Site (Worker) | `site/src/relay.js`, `site/src/relay-core.js` | Caixa postal cifrada: um Durable Object por pareamento |
| Site (Worker) | `site/src/push.js` | Push FCM `type: 'relay'` ("há pedido na caixa postal") |
| PC | `src/lib/phone-relay.js` | Criptografia, cliente HTTP, `requestApproval`, `listenForEnd` |
| PC | `src/main/phone.js` | `requestRemoteApproval()` para os celulares pareados |
| PC | `src/main/mcp.js` | Corrida PC × celular nas gravações e leituras de agentes |
| Celular | `android/.../link/Relay*.kt` | Busca, notificação, digital e resposta |

## Chaves

Tudo deriva do segredo do pareamento **S** (32 bytes, o mesmo do Wi-Fi) com
`HMAC(S, "mysecrets-link-v1|p1|p2|...")` (função `hmac` de `phone-link.js` /
`LinkProtocol.hmac`; as partes são texto juntado com `|`).

| Nome | Valor |
|---|---|
| canal | `hex(HMAC(S, "relay-channel"))[0:32]` (16 primeiros bytes em hex) |
| chave do pedido | `HMAC(S, "relay-req", reqId)` |
| chave da resposta | `HMAC(S, "relay-answer", id, base64(ecdh))` |

`ecdh` = segredo compartilhado ECDH P-256 (32 bytes, coordenada x) entre a
chave efêmera do PC (`epk` no pedido) e uma chave efêmera nova do celular.
Chaves públicas em DER SPKI, base64 padrão.

Cifra: AES-256-GCM, `iv(12) || ciphertext || tag(16)` em base64 padrão.

| Mensagem | AAD |
|---|---|
| pedido | `pairId|reqId` |
| resposta | `pairId|id|answer` |

Vetores de teste (os dois lados): `tests/fixtures/relay-vectors.json` e
`android/app/src/test/resources/relay-vectors.json`.

## Pedido (PC → celular)

```json
{
  "v": 1, "reqId": "<base64url 16 bytes>", "pairId": "...",
  "kind": "write" | "read" | "unlock",
  "desktop": "PC-Casa", "client": "claude-code",
  "ts": 1700000000000, "expiresAt": 1700000240000,
  "epk": "<SPKI base64 da chave efêmera do PC>",
  "pending": 1,
  "summary": { ... },
  "windowMinutes": 5, "allowWindow": true,      // só em "read"
  "code": "123 456"                              // só em "unlock"
}
```

`summary` (só nomes, nunca valores):

- `write`: `{ target, fields: [nomes], customFields: [nomes], files: [{ name, size }], project, tags }`
- `read`: `{ tool, query?, id?, attachment? }`
- `unlock`: `{}` (o celular mostra `code`, que também aparece no PC)

O celular recusa pedido com `|agora − ts| > 5 min` ou `agora > expiresAt`.

## Resposta (celular → PC)

```json
{ "v": 1, "reqId": "<id>", "decision": "approve" | "deny" | "end", "ts": ...,
  "mode": "once" | "window", "minutes": 5, "kd": "<K_d em base64>" }
```

Enviada como `{ "epk": "<SPKI do celular>", "box": "<cifrado>" }`.

- **approve** exige a digital: leva **K_d**, que só sai do Keystore com ela. O PC
  confere que K_d abre a senha mestra guardada no pareamento; se não abrir, vale
  como recusa. Assim, quem tem só S (sem a digital) não consegue aprovar.
- **deny** não leva K_d (negar não precisa da digital).
- `mode`/`minutes` só em leituras: `once` = só esta leitura; `window` = leituras
  livres por `minutes` (5, 15 ou 30).
- **end**: fim antecipado de uma liberação por tempo. Vai para o id `"e" + reqId`
  (a "escuta" que o PC deixa na caixa postal durante a liberação), cifrado com
  a `epk` do pedido original. Não leva K_d.

## Caixa postal (Worker)

Base: `https://mysecrets.ancalagon.com.br/relay/{canal}`

| Método | Caminho | Quem | Resposta |
|---|---|---|---|
| POST | `/` `{ reqId, box, exp }` | PC | 204 |
| POST | `/` `{ reqId: "e…", exp, listen: true }` | PC (escuta de fim) | 204 |
| GET | `/` | celular | 200 `{ items: [{ reqId, box }] }` (pedidos sem resposta) |
| DELETE | `/{id}` | PC | 204 |
| POST | `/{id}/answer` `{ epk, box }` | celular | 204; 410 se o pedido já acabou |
| GET | `/{id}/answer?wait=20` | PC (long-poll) | 200 `{ epk, box }`, 204 ainda não, 404 não existe |

Os itens expiram no `exp` (no máximo 31 min). O celular **não** lista as escutas.

## Push

`{ type: "relay", pairId, ts, nonce, sig }` com
`sig = base64(HMAC(S, "relay", pairId, ts, nonce))`. Mandado a cada pedido
novo. O celular confere a assinatura e busca o canal. Pedidos que sumiram da
caixa postal (respondidos ou vencidos) têm a notificação apagada.

## Liberação de leitura

- **Só esta** (padrão): o app decifra o cofre só na memória do processo
  principal, executa aquela chamada, devolve o resultado ao agente e esquece a
  senha. Nenhuma sessão é criada.
- **Por N minutos**: o app cria uma sessão (`.session`) com `scope: "agent-read"`
  e `expiresAt` = agora + N min. As leituras do agente passam sem perguntar; a
  extensão do navegador continua bloqueada; **gravações continuam pedindo
  aprovação uma a uma**. No fim, a sessão e a chave somem. O celular mostra
  "Leitura liberada até HH:MM" com **Encerrar agora**; o PC mostra o mesmo na
  bandeja (menu **Encerrar liberação de leitura**).
- **Quando perguntar** (Configurações > Celular): "só com o cofre bloqueado"
  (padrão; com o cofre aberto as leituras são livres, como antes) ou "sempre".

## Segurança

- O Worker vê só o canal (opaco), o tamanho e o horário. Nem títulos.
- Sigilo futuro: as chaves efêmeras somem depois do pedido; respostas gravadas
  não se abrem mesmo se S vazar depois.
- Desligado por padrão ("Aprovar pedidos de agentes pelo celular, de qualquer
  lugar").
- Limites: 32 itens por canal, 16 KB por pedido, `RELAY_LIMIT` por IP.
