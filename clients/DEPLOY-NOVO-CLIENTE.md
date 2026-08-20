# Guia: subir um cliente novo do zero

Toda vez que fechar um cliente novo, repete isso. Cada cliente = 1 servidor
Evolution API isolado + 1 deploy do bot isolado (banco próprio). Se o
Evolution de um cliente cair, os outros continuam de pé.

Vou usar `trailland` como exemplo — troca pelo slug do cliente real em cada
passo.

---

## Parte 1 — Servidor Evolution API (o número de WhatsApp)

### 1.1. Criar o projeto no Railway

Railway → **New Project** → **Deploy a Docker Image** → imagem:
`atendai/evolution-api:latest` (é a imagem oficial, mesma família que já
roda a instância da Viltrum).

### 1.2. Adicionar banco de dados do Evolution

No mesmo projeto Railway: **+ New** → **Database** → **PostgreSQL**. O
Evolution API v2 guarda instância/sessão no Postgres — sem isso ele não
sobe.

Opcional mas recomendado: **+ New** → **Database** → **Redis** (cache e
fila do Evolution rodam melhor com Redis, mas ele funciona sem).

### 1.3. Variáveis de ambiente do serviço Evolution API

No serviço do Evolution (não no Postgres), configura:

| Variável | Valor |
|---|---|
| `AUTHENTICATION_API_KEY` | uma chave secreta que você inventa (vira `EVOLUTION_API_KEY` do lado do bot) |
| `DATABASE_ENABLED` | `true` |
| `DATABASE_PROVIDER` | `postgresql` |
| `DATABASE_CONNECTION_URI` | a `DATABASE_URL` que o Railway gerou no passo 1.2 (referencia com `${{Postgres.DATABASE_URL}}` se estiver no mesmo projeto) |
| `CACHE_REDIS_ENABLED` | `true` (se criou o Redis) |
| `CACHE_REDIS_URI` | a URL do Redis do passo 1.2 |

Deploy. Depois que subir: **Settings → Networking → Generate Domain** pra
ganhar uma URL pública (`https://evolution-trailland.up.railway.app` ou
parecido). Essa URL é o `EVOLUTION_URL` do cliente.

### 1.4. Criar a instância (o número em si)

Com a URL e a `AUTHENTICATION_API_KEY` em mãos, chama a API do próprio
Evolution (Postman, Insomnia, ou `curl`):

```bash
curl -X POST "https://evolution-trailland.up.railway.app/instance/create" \
  -H "apikey: SUA_AUTHENTICATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "trailland",
    "qrcode": true,
    "integration": "WHATSAPP-BAILEYS"
  }'
```

A resposta traz um QR code (base64). Abre no navegador ou converte pra
imagem, e escaneia no WhatsApp do cliente: **Configurações → Aparelhos
conectados → Conectar aparelho**. Esse é o número que vira o WhatsApp da
IA — combine com o cliente qual número vai ser esse antes de escanear.

### 1.5. Apontar o webhook pra esse cliente

Isso só funciona depois que o bot (Parte 2) já estiver no ar, porque
precisa da URL dele:

```bash
curl -X POST "https://evolution-trailland.up.railway.app/webhook/set/trailland" \
  -H "apikey: SUA_AUTHENTICATION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "url": "https://trailland-bot.up.railway.app/webhook",
      "enabled": true,
      "events": ["MESSAGES_UPSERT"]
    }
  }'
```

---

## Parte 2 — O bot (whatsapp-agente) pra esse cliente

### 2.1. Criar o serviço

Railway → **New Project** → **Deploy from GitHub repo** → aponta pro
mesmo repositório `whatsapp-agente`, branch `feat/evolution-api` (ou a
branch que estiver estável na hora).

### 2.2. Banco de dados isolado

**+ New** → **Database** → **PostgreSQL** nesse mesmo projeto. É o banco
só dessa TrailLand — não compartilha lead nem conhecimento com nenhum
outro cliente.

### 2.3. Variáveis de ambiente do bot

| Variável | Valor |
|---|---|
| `CLIENT_SLUG` | `trailland` (bate com o nome do arquivo em `clients/`) |
| `DATABASE_URL` | a do Postgres do passo 2.2 |
| `EVOLUTION_URL` | a URL do Evolution da Parte 1.3 |
| `EVOLUTION_API_KEY` | a `AUTHENTICATION_API_KEY` da Parte 1.3 |
| `EVOLUTION_INSTANCE` | `trailland` (mesmo nome do passo 1.4) |
| `ANTHROPIC_API_KEY` | pode reusar a mesma chave da Viltrum |
| `VOYAGE_API_KEY` | pode reusar a mesma chave da Viltrum |
| `GROQ_API_KEY` | pode reusar a mesma chave da Viltrum (transcrição de áudio) |
| `WHATSAPP_RESPONSAVEL` | número de quem recebe notificação de lead novo pra esse cliente |
| `EMAIL_RESPONSAVEL` | e-mail de quem recebe notificação |
| `GMAIL_REMETENTE` / `GMAIL_SENHA_APP` | conta de envio (pode ser a mesma da Viltrum ou uma dedicada) |
| `GOOGLE_CALENDAR_ENABLED` | `false`, a menos que esse cliente use agendamento |
| `PORT` | o Railway seta sozinho, não precisa mexer |

Deploy. Depois que subir, **Settings → Networking → Generate Domain**
pra ganhar a URL pública — é ela que entra no passo 1.5 acima.

### 2.4. Confirmar que subiu certo

```bash
curl https://trailland-bot.up.railway.app/
# esperado: {"status":"ok","agent":"Olivia","company":"TrailLand","calendar":"pendente configuracao"}
```

### 2.5. Popular a base de conhecimento

Com o `BASE_URL` apontando pro domínio desse cliente:

```bash
BASE_URL=https://trailland-bot.up.railway.app node scripts/chunk-and-ingest.js "caminho/do/documento.pdf" --client-id trailland
```

(o `client_id` aqui é redundante já que o banco é isolado, mas mantém
consistente com o resto do padrão)

---

## Checklist rápido pra cada cliente novo

- [ ] Ler `RISCO-BANIMENTO-WHATSAPP.md` e alinhar o risco com o cliente
- [ ] Número aquecido: usado manualmente por 2 a 5 dias antes de ligar a automação
- [ ] `clients/<slug>.js` criado e revisado
- [ ] Projeto Evolution API no Railway (+ Postgres, + Redis opcional)
- [ ] Instância criada e QR code escaneado no número do cliente
- [ ] Projeto do bot no Railway (+ Postgres próprio)
- [ ] Env vars do bot preenchidas
- [ ] Webhook do Evolution apontando pro domínio do bot
- [ ] `GET /` do bot responde com o `company` certo
- [ ] Base de conhecimento inicial indexada
- [ ] Teste manual: manda "oi" pro número do cliente e confere a resposta
- [ ] Combinado com o time: **não usar o botão "Novo Lead"** em número de cliente
      enquanto estiver no Evolution (é disparo pra quem não pediu contato, o
      maior gatilho de banimento)
