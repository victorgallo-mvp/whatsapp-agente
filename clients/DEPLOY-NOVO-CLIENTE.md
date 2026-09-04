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

Atalho que evita erro de digitação: abra o serviço Evolution de um cliente
que **já funciona**, copie a lista inteira de variáveis e cole aqui, trocando
só `AUTHENTICATION_API_KEY`, `DATABASE_CONNECTION_URI`, `CACHE_REDIS_URI` e
`SERVER_URL`. É mais confiável que montar do zero, porque acompanha qualquer
ajuste que a imagem do Evolution tenha exigido depois que este guia foi
escrito.

| Variável | Valor |
|---|---|
| `AUTHENTICATION_API_KEY` | uma chave secreta que você inventa (vira `EVOLUTION_API_KEY` do lado do bot) |
| `SERVER_URL` | o domínio público deste próprio serviço (passo abaixo) |
| `DATABASE_ENABLED` | `true` |
| `DATABASE_PROVIDER` | `postgresql` |
| `DATABASE_CONNECTION_URI` | a `DATABASE_URL` que o Railway gerou no passo 1.2 (referencia com `${{Postgres.DATABASE_URL}}` se estiver no mesmo projeto) |
| `CACHE_REDIS_ENABLED` | `true` (se criou o Redis) |
| `CACHE_REDIS_URI` | a URL do Redis do passo 1.2 |

`SERVER_URL` é ovo de serpente: sem ela o Evolution sobe, conecta e parece
saudável, mas monta as URLs de mídia apontando pro lugar errado — o sintoma
aparece só depois, em foto e áudio que não baixam. É circular com o passo do
domínio: gere o domínio primeiro, volte e preencha, e redeploy.

Deploy. Depois que subir: **Settings → Networking → Generate Domain** pra
ganhar uma URL pública (`https://evolution-trailland.up.railway.app` ou
parecido). Essa URL é o `EVOLUTION_URL` do cliente, e é onde fica o
**painel do Evolution: `https://<esse-dominio>/manager`**, que loga com a
`AUTHENTICATION_API_KEY` e é por onde se cria a instância e se lê o QR code
na tela (o QR expira em ~40s e o painel renova sozinho, diferente do curl).

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

## Número que também é pessoal

Se a IA vai rodar num número que a pessoa usa no dia a dia, dois ajustes:

**1. Retrato dos contatos, na instalação.** Depois de conectar o QR code e antes
de liberar a IA, rode uma vez:

```bash
curl -X POST https://<bot>.up.railway.app/admin/contatos/retrato
```

Isso grava todo mundo que já tinha conversa com aquele número. Quem está nessa
lista não é atendido pela IA — é gente com relação prévia, e quem responde é o
dono. Conferir com `GET /admin/contatos`, e tirar alguém da lista com
`DELETE /admin/contatos/<telefone>` se ele quiser que a IA atenda aquele contato.

Só tem efeito se o `clients/<slug>.js` declarar `ignorarContatosConhecidos: true`.
Não ligue isso num número que já vinha operando com IA: ela pararia de responder
justamente os leads que já atendia.

**2. Mensagem manual pausa a IA.** Qualquer coisa que o dono mandar pro cliente
(texto, áudio, imagem, documento) desliga a IA naquela conversa. Reativação é
manual, pelo toggle do dashboard. Não precisa configurar, já é o comportamento.

## Desligar as automações do WhatsApp Business antes de ligar a IA

No app do número, em **Configurações → Ferramentas comerciais**, desative
**Mensagem de saudação** e **Mensagem de ausência**.

Não é preferência estética, é incompatibilidade. Essas mensagens saem do
próprio número, então chegam no webhook como `fromMe` — idênticas a uma
mensagem digitada pelo dono. O bot lê isso como "o humano assumiu" e roda
`olivia_ativa = FALSE`. Com a saudação ligada, toda conversa nova é pausada
logo no primeiro "oi", e a IA morre antes de responder.

O sintoma é traiçoeiro: parece "a IA não responde", e não há nada errado no
bot. Quem for diagnosticar vai procurar no lugar errado.

Respostas rápidas podem ficar — são manuais e só disparam se alguém escolher.

## Grupo da empresa

Para notificação chegar num grupo além do responsável, descubra o JID:

```bash
curl https://<bot>.up.railway.app/admin/grupos
```

e ponha o valor na env `GRUPO_EMPRESA`. O identificador termina em `@g.us` e não
aparece no app do WhatsApp.

## Checklist rápido pra cada cliente novo

- [ ] Ler `RISCO-BANIMENTO-WHATSAPP.md` e alinhar o risco com o cliente
- [ ] Número aquecido: usado manualmente por 2 a 5 dias antes de ligar a automação
- [ ] Mensagem de saudação e de ausência DESATIVADAS no WhatsApp Business
      (saem como `fromMe` e pausam a IA em toda conversa nova)
- [ ] `clients/<slug>.js` criado e revisado
- [ ] Projeto Evolution API no Railway (+ Postgres, + Redis opcional)
- [ ] Instância criada e QR code escaneado no número do cliente
- [ ] Projeto do bot no Railway (+ Postgres próprio)
- [ ] Env vars do bot preenchidas
- [ ] Webhook do Evolution apontando pro domínio do bot
- [ ] `GET /` do bot responde com o `company` certo
- [ ] Base de conhecimento inicial indexada
- [ ] Teste manual: manda "oi" pro número do cliente e confere a resposta
- [ ] Se o número for pessoal do dono: retrato de contatos rodado ANTES de liberar
- [ ] Se houver grupo da empresa: `GRUPO_EMPRESA` preenchido com o JID
- [ ] Combinado com o time: **não usar o botão "Novo Lead"** em número de cliente
      enquanto estiver no Evolution (é disparo pra quem não pediu contato, o
      maior gatilho de banimento)
