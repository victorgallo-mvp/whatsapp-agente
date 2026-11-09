# Config por cliente

Cada arquivo aqui é um cliente/agente diferente rodando o mesmo motor
(`server.js`). Trocar de cliente é trocar a env var `CLIENT_SLUG` — nunca
copiar o motor.

## Criar um cliente novo

1. Copie `clients/viltrum.js` para `clients/<slug>.js` (slug curto, minúsculo,
   sem espaço — vira o valor de `CLIENT_SLUG`).
2. Ajuste `name` (nome do agente, pode manter "Olivia" ou trocar), `company`
   e reescreva `instructions` do zero pro negócio desse cliente — não dá pra
   só trocar nome, o prompt inteiro (produtos, fluxos, tom, tags que ele
   emite) precisa fazer sentido pro caso dele. Ver `server.js` →
   `verificarGatilhos()` pra saber quais tags `[LEAD_CAPTURADO]`,
   `[VISITA_SOLICITADA]` etc. o prompt pode emitir e o que cada uma dispara.
3. Cada cliente = 1 deploy isolado (serviço Railway próprio), com suas
   próprias env vars:
   - `CLIENT_SLUG` → nome do arquivo aqui dentro (sem `.js`)
   - `DATABASE_URL` → banco Postgres próprio (não compartilha dados com
     outro cliente)
   - `EVOLUTION_INSTANCE` / `EVOLUTION_URL` / `EVOLUTION_API_KEY` → número de
     WhatsApp próprio na Evolution API
   - `WHATSAPP_RESPONSAVEL`, `EMAIL_RESPONSAVEL`, `GMAIL_REMETENTE`,
     `GMAIL_SENHA_APP` → pra quem esse cliente quer que as notificações
     cheguem (pode ser o próprio cliente, não precisa ser a Viltrum)
   - `GOOGLE_CALENDAR_*` → se o fluxo de agendamento for usado, agenda
     própria desse cliente
   - `VOYAGE_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY` → geralmente as
     mesmas chaves da Viltrum (contas compartilhadas), a menos que o
     cliente prefira as próprias
4. Rode `node scripts/chunk-and-ingest.js` / um seed próprio pra popular o
   `knowledge_base` desse cliente (o banco já é isolado, então nem precisa
   se preocupar com `client_id` cruzando com outro cliente).
5. `public/dashboard.html` não precisa de nenhuma mudança — ele pega o nome
   da empresa dinamicamente em `/` no carregamento.

## Por que não é multi-tenant (um processo servindo todo mundo)

`leads`, `mensagens`, `clientes` e `visitas` não têm coluna de tenant — só
fazem sentido com banco isolado por cliente. Se um dia isso escalar pra
muitos clientes ao ponto de banco-por-cliente ficar caro/inviável de
gerenciar, aí vale investir num refactor de multi-tenancy de verdade
(tenant resolvido por instância do webhook, tabelas particionadas). Com
poucos clientes, isolamento total por deploy é mais simples e mais seguro.

## Triagem estruturada (`qualificacao`)

Agente cujo trabalho é **filtrar e ranquear** lead, não vender (primeiro caso:
`protasio.js`). O cliente declara no próprio arquivo:

- `qualificacao.campos` — o que extrair da conversa. Campo com `opcoes` só
  aceita um dos valores listados; sem `opcoes` é texto livre.
- `qualificacao.pontuar(campos)` — a régua: devolve `{ score, temperatura,
  motivos, faltando }`. É código, não prompt: dois leads iguais recebem a
  mesma nota e o vendedor vê o porquê.
- `rotulos` / `valores` — como cada campo e valor aparecem pra gente.

O motor (`server.js`) faz o resto: extrai a cada turno com Haiku e mescla com
o que já sabia (`atualizarQualificacao`), injeta o já respondido no prompt pra
IA não perguntar de novo, grava em `leads.qualificacao/score/temperatura`, e
no `[LEAD_QUALIFICADO]` refaz a ficha, notifica o responsável com nota e
motivos e pausa a IA.

Telas: `/fila` é a lista ranqueada pro vendedor (temperatura → nota → último
contato, com o que faltou perguntar). O `/dashboard` ganha o selo de
temperatura no cartão e o link pra fila. O `/playground` mostra a ficha e a
nota a cada turno, com a mesma extração da produção.

Sem `qualificacao` no arquivo do cliente nada disso roda: zero custo extra.
