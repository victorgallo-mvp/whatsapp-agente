require("dotenv").config();
const express    = require("express");
const axios      = require("axios");
const nodemailer = require("nodemailer");
const { Pool }   = require("pg");
const cron       = require("node-cron");

const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const ZAPI_INSTANCE_ID   = process.env.ZAPI_INSTANCE_ID;
const ZAPI_TOKEN         = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT_TOKEN  = process.env.ZAPI_CLIENT_TOKEN;
const PORT               = process.env.PORT || 3000;

// Google Calendar (configurar depois)
const GOOGLE_CALENDAR_ENABLED = process.env.GOOGLE_CALENDAR_ENABLED === "true";
const GOOGLE_CLIENT_ID        = process.env.GOOGLE_CLIENT_ID        || "";
const GOOGLE_CLIENT_SECRET    = process.env.GOOGLE_CLIENT_SECRET    || "";
const GOOGLE_CALENDAR_ID      = process.env.GOOGLE_CALENDAR_ID      || "";
const GOOGLE_REDIRECT_URI     = process.env.GOOGLE_REDIRECT_URI     || "";
const GOOGLE_REFRESH_TOKEN    = process.env.GOOGLE_REFRESH_TOKEN    || "";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY || "";

const NOTIFICACOES = {
  whatsapp_responsavel: process.env.WHATSAPP_RESPONSAVEL || "PREENCHA_AQUI",
  email_responsavel:    process.env.EMAIL_RESPONSAVEL    || "PREENCHA_AQUI",
  gmail_remetente:      process.env.GMAIL_REMETENTE      || "PREENCHA_AQUI",
  gmail_senha_app:      process.env.GMAIL_SENHA_APP      || "PREENCHA_AQUI",
};

const AGENT_CONFIG = {
  name: "Olivia",
  company: "Comunynk",
  instructions: `Você é Olivia, atendente virtual da Comunynk, empresa especializada em impressão e comunicação visual.

Nunca use markdown, asteriscos, negrito, itálico ou listas com marcadores.
Responda sempre em texto simples, como uma conversa de WhatsApp.
Tom: direto, cordial e objetivo. Sem emojis. Sem travessões. Ortografia perfeita.
Frases curtas. Sem parágrafos longos.
Não elogie a escolha do cliente ("ótima escolha", "perfeito!", "que legal", "com prazer"). Não repita o que o cliente disse. Vá direto ao próximo passo.
Faça uma pergunta por vez para informações técnicas do produto.
Para coleta de dados de contato, agrupe todas as perguntas em uma única mensagem numerada.

ÁUDIOS:

Você não consegue ouvir áudios. Se o cliente enviar um áudio, diga: "Não consigo ouvir áudios por aqui. Pode me escrever o que precisa?"

IMAGENS:

Quando você receber a mensagem [o cliente enviou uma imagem], o cliente enviou uma imagem pelo WhatsApp. Trate como o recebimento da arte. Confirme e pergunte se o cliente aprovou ou quer alterações — use isso para decidir o próximo passo.
Se o cliente aprovar a arte, inclua ao final: [ARTE_APROVADA] Cliente: {nome} | Telefone: {telefone}
Se o cliente pedir alterações, inclua ao final: [ARTE_REVISAO] Cliente: {nome} | Telefone: {telefone} | Alteracao: {descricao do que o cliente pediu}

CATÁLOGO E PORTFÓLIO:

Se o cliente pedir exemplos, referências ou portfólio, oriente a ver o catálogo disponível aqui no próprio WhatsApp da Comunynk.

ARTE:

Produtos de impressão (adesivo, lona, banner, tecido, canvas, fotográfico, papel, jateado, preto fosco, perfurado, cartão, flyer) sempre precisam de arte para produção. Para esses produtos, solicite a arte em qualquer caminho — mesmo que o cliente não tenha medidas. Diga: "Você pode enviar a arte aqui pelo WhatsApp, mesmo que ainda não tenha as medidas definidas."
Não calcule estimativa de impressão sem ter pelo menos uma referência de tamanho da arte.
Quando o cliente responder sobre uma arte recebida (aprovando ou pedindo alterações), emita a tag correspondente acima.

QUATRO CAMINHOS DE ATENDIMENTO:

Identifique o perfil do cliente e siga o caminho correspondente.

CAMINHO 0 — CLIENTE PEDE VISITA TÉCNICA DIRETAMENTE:
Use quando o cliente já sabe que precisa de visita técnica e pede isso explicitamente.
1. Cumprimente.
2. Pergunte o produto brevemente (em uma frase).
3. Peça uma foto do local (opcional, mas incentive: "Se puder enviar uma foto do local, ajuda bastante.").
4. Vá direto para o agendamento — use o mesmo fluxo do Caminho 3 a partir do passo de coletar endereço e dados.

CAMINHO 1 — CLIENTE COM ARTE E MEDIDAS:
Use quando o cliente já tem a arte e sabe as medidas.
1. Cumprimente e entenda o produto.
2. Colete as informações técnicas uma por vez: medidas da arte, quantidade, acabamento.
   Medidas da arte determinam o preço, não o tamanho do local. Se o cliente mencionar o tamanho do espaço, use como referência mas pergunte: "E qual seria o tamanho da arte em si?"
3. Solicite a arte (pode enviar aqui pelo WhatsApp).
4. Com arte e medidas, apresente a estimativa com o valor total. Nunca mencione o valor por m². Nunca explique o cálculo.
5. Pergunte se tem interesse em prosseguir.
6. Se sim, solicite os dados de contato em uma única mensagem numerada:
"Preciso de algumas informações para finalizar:
1. Nome completo
2. Nome da empresa ou estabelecimento
3. Telefone"
7. Agradeça e informe que em breve um consultor vai dar continuidade.
Ao final, inclua EXATAMENTE esta linha:
[LEAD_CAPTURADO] Tipo: orcamento | Nome: {nome} | Empresa: {empresa} | Telefone: {telefone} | Produto: {produto} | Estimativa: {valor}

CAMINHO 2 — CLIENTE SEM MEDIDAS:
Use quando o cliente não sabe as medidas exatas.
1. Cumprimente e entenda o produto.
2. Colete referências: onde será instalado, cores, estilo, tamanho aproximado do espaço.
3. Se o produto precisar de arte (veja seção ARTE acima), solicite a arte mesmo sem medidas.
4. Apresente estimativa somente se houver alguma referência de tamanho da arte. Caso contrário, diga que o consultor vai ajudar a definir.
5. Solicite os dados de contato em uma única mensagem numerada:
"Preciso de algumas informações para colocar você em contato com nosso time:
1. Nome completo
2. Nome da empresa ou estabelecimento
3. Telefone"
6. Agradeça e informe que um consultor vai entrar em contato.
Ao final, inclua EXATAMENTE esta linha:
[LEAD_CAPTURADO] Tipo: consultoria | Nome: {nome} | Empresa: {empresa} | Telefone: {telefone} | Produto: {produto} | Estimativa: {valor ou "a definir"}

CAMINHO 3 — VISITA TÉCNICA:
Use quando o produto for instalação, placa grande, ACM ou acrílico, ou quando o cliente pedir visita (use Caminho 0 nesse caso).
1. Cumprimente e entenda o produto.
2. Informe que esse tipo de serviço requer uma visita técnica antes da produção.
3. Colete o endereço completo do local.
4. Se já tiver os dados do cliente (nome, empresa, telefone), confirme-os em vez de perguntar novamente. Pergunte apenas o que estiver faltando. Solicite sempre a data:
"Confirmo seus dados: Nome: {nome} | Empresa: {empresa} | Telefone: {telefone}. Está correto?
Qual a data e horário de preferência para a visita?"
Se não tiver os dados, solicite tudo em uma mensagem numerada:
"Preciso de mais algumas informações:
1. Nome completo
2. Nome da empresa ou estabelecimento
3. Telefone
4. Data e horário de preferência para a visita"
5. Horários disponíveis para visita: segunda a sexta, das 8h às 10h ou das 16h às 18h, com no mínimo 24h de antecedência. Se o cliente sugerir horário fora dessas janelas, informe os horários disponíveis e peça nova sugestão.
6. Confirme os dados com a data completa no formato: dia da semana, dia/mês/ano e horário. Exemplo: "Visita registrada para terça-feira, dia 20/05/2026, às 9h."
7. Informe que o time estará aguardando na visita.
Ao final, inclua EXATAMENTE esta linha:
[VISITA_SOLICITADA] Nome: {nome} | Empresa: {empresa} | Telefone: {telefone} | Endereço: {endereco} | Produto: {produto} | Estimativa: {valor} | Data: {data} | Horario: {horario}

REGRAS DE PREÇO:

- Sempre utilize os preços de cliente final. Somente aplique os preços de revenda se o próprio cliente mencionar que é revendedor.
- Nunca mencione o preço por metro quadrado.
- Nunca explique a fórmula de cálculo.
- Regra de estimativa:
  - Se o valor calculado for até R$ 500,00 e não houver instalação: informe o valor exato. Exemplo: "A estimativa é de R$ 360,00."
  - Se houver instalação no serviço: informe sempre em margem. Exemplo: "A estimativa fica entre R$ 280,00 e R$ 350,00."
  - Se o valor calculado for acima de R$ 500,00 sem instalação: não informe o valor. Diga: "Para esse tamanho, o consultor vai precisar avaliar para passar um orçamento preciso."
- Deixe claro que é uma estimativa e que o valor final é confirmado pelo time.
- Nunca negocie preços. Se o cliente pedir desconto: "Os valores são tabelados, mas o consultor pode verificar condições especiais para você."
- Nunca informe prazos exatos. Diga: "O prazo é confirmado pelo time após a análise do pedido."
- Se o produto não estiver na tabela: "Esse item preciso verificar com o time. Posso deixar seu contato para um consultor te retornar?"

ARGUMENTOS DE VENDA:

Use apenas quando houver objeção real do cliente.
- Preocupação com saúde ou segurança: "Os materiais que utilizamos usam tinta atóxica, sem risco para pessoas ou ambientes."
- Dúvida sobre durabilidade ou qualidade: "Nossos produtos têm garantia de até 5 anos."

TABELA DE PREÇOS (uso interno — nunca revelar o valor por m²):

IMPRESSÕES (por m²):
Adesivo: R$ 70,00 revenda / R$ 90,00 cliente final
Adesivo imp. + rec.: R$ 80,00 / R$ 100,00
Adesivo promocional: R$ 65,00 / R$ 75,00
Adesivo pro. imp. + rec.: R$ 75,00 / R$ 85,00
Adesivo rec. + masc.: R$ 100,00 / R$ 150,00
Lona: R$ 60,00 / R$ 80,00
Banner / lona com ilhós: R$ 70,00 / R$ 90,00
Tecido: R$ 120,00 / R$ 135,00
Canvas: R$ 150,00 / R$ 180,00
Fotográfico: R$ 120,00 / R$ 150,00
Papel: R$ 40,00 / R$ 50,00
Laminação: R$ 30,00 / R$ 40,00
Jateado: R$ 90,00 / R$ 120,00
Preto fosco: R$ 70,00 / R$ 90,00
Perfurado: R$ 120,00 / R$ 140,00
Wind banner: apenas cliente final / R$ 350,00 por unidade
Instalação adesivo: R$ 30,00 por m²
Instalação lona ilhós: R$ 30,00 por m²

CARTÕES E FLYERS (por 1000 unidades, apenas cliente final):
Cartão visita 4x4 simples: R$ 130,00
Cartão visita 4x4 laminação fosca + verniz localizado: R$ 230,00
Flyer A5 4x4: R$ 336,00
Flyer A6 4x4: R$ 226,00

PLACAS (por m²):
Placa 2mm + adesivo: R$ 170,00 / R$ 220,00
Placa 3mm + adesivo: R$ 230,00 / R$ 250,00
Placa 3mm colmeia + adesivo: R$ 230,00 / R$ 250,00
Placa 5mm + adesivo: R$ 320,00 / R$ 370,00
Placa 10mm CNC + adesivo: R$ 520,00 / R$ 570,00
Placa 20mm CNC + adesivo: R$ 920,00 / R$ 970,00
Placa ACM CNC + adesivo: R$ 350,00 / R$ 400,00
Acrílico 3mm CNC + adesivo: R$ 600,00 / R$ 650,00
Acrílico 3mm largo CNC + adesivo: R$ 600,00 / R$ 650,00
Acrílico 4mm CNC + adesivo: R$ 700,00 / R$ 750,00
Acrílico 5mm CNC + adesivo: R$ 800,00 / R$ 850,00
Acrílico 6mm CNC + adesivo: R$ 900,00 / R$ 950,00
Acrílico 8mm CNC + adesivo: R$ 1.000,00 / R$ 1.050,00
Acrílico 10mm CNC + adesivo: R$ 1.100,00 / R$ 1.150,00

Responda sempre em português.`,
};

const artes = {};

// ─── POSTGRES ─────────────────────────────────────────────────────────────────
const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS mensagens (
      id         SERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_mensagens_user_id ON mensagens (user_id, created_at)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      phone      TEXT PRIMARY KEY,
      nome       TEXT,
      empresa    TEXT,
      endereco   TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS endereco TEXT`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS leads (
      phone               TEXT PRIMARY KEY,
      nome                TEXT,
      empresa             TEXT,
      endereco            TEXT,
      stage               TEXT DEFAULT 'novo',
      profile             JSONB DEFAULT '{}',
      last_summary        TEXT,
      total_interactions  INT DEFAULT 0,
      last_interaction_at TIMESTAMPTZ,
      profile_updated_at  TIMESTAMPTZ,
      created_at          TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Migra dados existentes da tabela clientes
  await db.query(`
    INSERT INTO leads (phone, nome, empresa, endereco)
    SELECT phone, nome, empresa, endereco FROM clientes
    ON CONFLICT (phone) DO NOTHING
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS visitas (
      id               SERIAL PRIMARY KEY,
      user_id          TEXT NOT NULL,
      dados            TEXT NOT NULL,
      data_visita      DATE,
      horario          TEXT,
      lembrete_enviado BOOLEAN DEFAULT FALSE,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // pgvector e base de conhecimento (opcional — requer extensão vector no Postgres)
  try {
    await db.query("CREATE EXTENSION IF NOT EXISTS vector");
    await db.query(`
      CREATE TABLE IF NOT EXISTS knowledge_base (
        id          SERIAL PRIMARY KEY,
        client_id   TEXT NOT NULL DEFAULT 'comunynk',
        source_type TEXT NOT NULL,
        content     TEXT NOT NULL,
        context     TEXT,
        embedding   vector(512),
        metadata    JSONB DEFAULT '{}',
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_embedding
      ON knowledge_base USING hnsw (embedding vector_cosine_ops)
    `);
    console.log("[pgvector] Extensao e tabela knowledge_base prontas.");
  } catch (err) {
    console.warn("[pgvector] Nao disponivel — RAG desativado:", err.message);
  }

  console.log("Banco de dados pronto.");
}

async function getHistory(userId) {
  const res = await db.query(
    `SELECT role, content FROM mensagens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 35`,
    [userId]
  );
  return res.rows.reverse();
}

async function getLead(phone) {
  const res = await db.query(
    `SELECT nome, empresa, endereco, stage, profile, last_summary, total_interactions FROM leads WHERE phone = $1`,
    [phone]
  );
  return res.rows[0] || null;
}

async function upsertLead(phone, { nome, empresa, endereco, stage } = {}) {
  await db.query(
    `INSERT INTO leads (phone, nome, empresa, endereco, stage, last_interaction_at, total_interactions)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'novo'), NOW(), 1)
     ON CONFLICT (phone) DO UPDATE SET
       nome                = COALESCE($2, leads.nome),
       empresa             = COALESCE($3, leads.empresa),
       endereco            = COALESCE($4, leads.endereco),
       stage               = COALESCE($5, leads.stage),
       last_interaction_at = NOW(),
       total_interactions  = leads.total_interactions + 1`,
    [phone, nome || null, empresa || null, endereco || null, stage || null]
  );
}

async function addToHistory(userId, role, content) {
  await db.query(
    `INSERT INTO mensagens (user_id, role, content) VALUES ($1, $2, $3)`,
    [userId, role, content]
  );
}

// ─── BRAIN: RAG + PERFIL DE LEAD ─────────────────────────────────────────────
async function gerarEmbedding(texto) {
  const res = await axios.post(
    "https://api.voyageai.com/v1/embeddings",
    { model: "voyage-3-lite", input: [texto] },
    { headers: { Authorization: "Bearer " + VOYAGE_API_KEY, "Content-Type": "application/json" } }
  );
  return res.data.data[0].embedding;
}

async function buscarConhecimento(mensagem, topK = 4) {
  if (!VOYAGE_API_KEY) return [];
  try {
    const emb    = await gerarEmbedding(mensagem);
    const embStr = "[" + emb.join(",") + "]";
    const res    = await db.query(
      `SELECT content, context, source_type,
              1 - (embedding <=> $1::vector) AS similarity
       FROM knowledge_base
       WHERE client_id = 'comunynk'
         AND 1 - (embedding <=> $1::vector) >= 0.6
       ORDER BY similarity DESC
       LIMIT $2`,
      [embStr, topK]
    );
    return res.rows;
  } catch (err) {
    console.error("[RAG] Erro ao buscar conhecimento:", err.message);
    return [];
  }
}

async function atualizarPerfilLead(phone) {
  try {
    const history = await getHistory(phone);
    if (history.length < 3) return;
    const conversa = history.map(m => m.role + ": " + m.content).join("\n");
    const res = await chamarClaude({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system:     "Você é um analista de leads de uma empresa de impressão e comunicação visual. Extraia informações estruturadas em JSON com base na conversa.",
      messages:   [{ role: "user", content: `Analise a conversa e extraia as informações em JSON:\n{\n  "interesse_principal": "...",\n  "produto_interesse": "...",\n  "orcamento_estimado": "...",\n  "objecoes": "...",\n  "resumo": "..."\n}\n\nConversa:\n${conversa}` }],
    });
    const texto     = res.data.content?.[0]?.text || "";
    const jsonMatch = texto.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonLimpo = jsonMatch[0].replace(/[\r\n]+/g, " ").replace(/,\s*}/g, "}");
      const perfil = JSON.parse(jsonLimpo);
      await db.query(
        `UPDATE leads SET profile = profile || $2, last_summary = $3, profile_updated_at = NOW() WHERE phone = $1`,
        [phone, JSON.stringify(perfil), perfil.resumo || null]
      );
      console.log("[BRAIN] Perfil atualizado para:", phone);
    }
  } catch (err) {
    console.error("[BRAIN] Erro ao atualizar perfil:", err.message);
  }
}

async function verificarAtualizacaoPerfil(phone) {
  try {
    const res = await db.query(
      `SELECT profile_updated_at, total_interactions FROM leads WHERE phone = $1`,
      [phone]
    );
    if (!res.rows[0]) return;
    const { profile_updated_at, total_interactions } = res.rows[0];
    if (total_interactions < 3) return;
    const ultimaAtt        = profile_updated_at ? new Date(profile_updated_at).getTime() : 0;
    const VINTE_QUATRO_H   = 24 * 60 * 60 * 1000;
    if (Date.now() - ultimaAtt >= VINTE_QUATRO_H) {
      atualizarPerfilLead(phone); // fire and forget
    }
  } catch (err) {
    console.error("[BRAIN] Erro ao verificar perfil:", err.message);
  }
}

// ─── RELAY DO RESPONSÁVEL ────────────────────────────────────────────────────
async function processarMensagemResponsavel(body) {
  const texto = body.text?.message || body.image?.caption || body.document?.caption || "";

  // Tenta extrair o telefone do cliente por dois caminhos
  let clientePhone = null;

  // Caminho 1: prefixo @55... no início da mensagem
  const matchPrefixo = texto.match(/^@(\d+)\s*([\s\S]*)/);
  if (matchPrefixo) {
    clientePhone = matchPrefixo[1];
  }

  console.log("[RELAY] clientePhone extraido:", clientePhone, "| texto:", texto, "| tipo:", body.image ? "imagem" : body.document ? "documento" : "texto");

  if (!clientePhone) {
    await sendZAPIMessage(
      NOTIFICACOES.whatsapp_responsavel,
      "Não consegui identificar o cliente destino.\n\nInicie a mensagem com @55DDD99999999 seguido do texto.\nExemplo: @5511999998888 Segue o orçamento."
    );
    return;
  }

  const intro = "Segue uma mensagem da nossa equipe:";
  const conteudo = matchPrefixo ? matchPrefixo[2].trim() : texto.trim();

  try {
    if (body.image?.imageUrl) {
      await axios.post(
        `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-image`,
        { phone: clientePhone, image: body.image.imageUrl, caption: intro + (conteudo ? "\n" + conteudo : "") },
        { headers: { "Client-Token": ZAPI_CLIENT_TOKEN, "Content-Type": "application/json" } }
      );
    } else if (body.document?.documentUrl) {
      await axios.post(
        `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-document`,
        { phone: clientePhone, document: body.document.documentUrl, fileName: body.document.fileName || "documento.pdf", caption: intro },
        { headers: { "Client-Token": ZAPI_CLIENT_TOKEN, "Content-Type": "application/json" } }
      );
    } else if (conteudo) {
      await sendZAPIMessage(clientePhone, intro + "\n\n" + conteudo);
    } else {
      await sendZAPIMessage(NOTIFICACOES.whatsapp_responsavel, "Mensagem vazia. Nada foi enviado.");
      return;
    }

    const registroHistorico = body.image?.imageUrl
      ? "[a equipe enviou uma imagem" + (conteudo ? " — " + conteudo : "") + "]"
      : intro + (conteudo ? "\n\n" + conteudo : "");
    await addToHistory(clientePhone, "assistant", registroHistorico);

    console.log("[RELAY] Mensagem encaminhada para cliente:", clientePhone);
    await sendZAPIMessage(NOTIFICACOES.whatsapp_responsavel, "Mensagem encaminhada para " + clientePhone + ".");
  } catch (err) {
    console.error("Erro no relay:", err.response?.data || err.message);
    await sendZAPIMessage(NOTIFICACOES.whatsapp_responsavel, "Erro ao encaminhar a mensagem. Tente novamente.");
  }
}

// ─── DEBOUNCE DE MENSAGENS ───────────────────────────────────────────────────
const pendingMessages = {};
const DEBOUNCE_MS = 3500;

function enfileirarMensagem(userId, item) {
  if (!pendingMessages[userId]) {
    pendingMessages[userId] = { timer: null, items: [] };
  }
  pendingMessages[userId].items.push(item);
  clearTimeout(pendingMessages[userId].timer);
  pendingMessages[userId].timer = setTimeout(
    () => processarMensagensPendentes(userId),
    DEBOUNCE_MS
  );
}

async function chamarClaude(payload, tentativa = 1) {
  try {
    return await axios.post(
      "https://api.anthropic.com/v1/messages",
      payload,
      {
        headers: {
          "x-api-key":         ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type":      "application/json",
        },
      }
    );
  } catch (err) {
    const tipo = err.response?.data?.error?.type;
    if (tipo === "overloaded_error" && tentativa < 4) {
      const delay = tentativa * 3000;
      console.log(`[CLAUDE] Sobrecarga — tentativa ${tentativa}/3, aguardando ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      return chamarClaude(payload, tentativa + 1);
    }
    throw err;
  }
}

async function processarMensagensPendentes(userId) {
  const pending = pendingMessages[userId];
  if (!pending) return;
  delete pendingMessages[userId];

  try {
    for (const item of pending.items) {
      await addToHistory(userId, "user", item.content);
    }

    const queryText = pending.items.map(i => i.content).join(" ");
    const [lead, knowledge] = await Promise.all([
      getLead(userId),
      buscarConhecimento(queryText),
    ]);

    if (knowledge.length > 0) {
      console.log("[RAG] " + knowledge.length + " resultado(s) encontrado(s) para:", queryText.substring(0, 60));
    }

    const response = await chamarClaude({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system:     promptComData(),
      messages:   mensagensComData(await getHistory(userId), lead, knowledge),
    });

    let reply = response.data.content?.[0]?.text;
    if (!reply) return;

    await addToHistory(userId, "assistant", reply);
    await verificarGatilhos(reply, userId);

    const replyLimpo = reply
      .replace(/\[LEAD_CAPTURADO\].*/g, "")
      .replace(/\[VISITA_SOLICITADA\].*/g, "")
      .replace(/\[ARTE_APROVADA\].*/g, "")
      .replace(/\[ARTE_REVISAO\].*/g, "")
      .trim();

    console.log("[OLIVIA RESPONDE] " + replyLimpo);
    await sendZAPIMessage(userId, replyLimpo);

    // Atualiza contagem de interações e verifica se perfil precisa de update
    upsertLead(userId, {}).catch(() => {});
    verificarAtualizacaoPerfil(userId);
  } catch (err) {
    console.error("Erro ao processar mensagens:", err.response?.data || err.message);
    const tipo = err.response?.data?.error?.type;
    if (tipo === "overloaded_error") {
      await sendZAPIMessage(userId, "Em breve nossa equipe vai entrar em contato com você.");
    }
  }
}

// ─── WEBHOOK Z-API ───────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;

    if (body.fromMe) return;
    if (body.isGroup) return;

    // Detecta se é o responsável enviando um relay
    const foneBody        = (body.phone || "").replace(/\D/g, "");
    const foneResponsavel = (NOTIFICACOES.whatsapp_responsavel || "").replace(/\D/g, "");
    const semDDI          = n => n.startsWith("55") && n.length >= 12 ? n.slice(2) : n;
    const sem9            = n => n.startsWith("55") && n.length === 13 && n[4] === "9" ? n.slice(0, 4) + n.slice(5) : n;
    const ehResponsavel   = foneResponsavel.length > 5 &&
                            (foneBody === foneResponsavel ||
                             semDDI(foneBody) === semDDI(foneResponsavel) ||
                             sem9(foneBody) === sem9(foneResponsavel));
    console.log("[WEBHOOK] fone:", foneBody, "| responsavel:", foneResponsavel, "| match:", ehResponsavel);
    if (ehResponsavel) {
      await processarMensagemResponsavel(body);
      return;
    }

    // Áudio: responde imediatamente, sem debounce
    if (body.audio) {
      await sendZAPIMessage(body.phone, "Não consigo ouvir áudios por aqui. Pode me escrever o que precisa?");
      return;
    }

    const userId = body.phone;

    // Imagem: enfileira com o texto representativo
    if (body.image) {
      const caption = body.image.caption ? " — legenda: " + body.image.caption : "";
      if (body.image.imageUrl) artes[userId] = body.image.imageUrl;
      enfileirarMensagem(userId, { content: "[o cliente enviou uma imagem" + caption + "]" });
      return;
    }

    // Texto: enfileira
    if (!body.text?.message) return;
    console.log("[" + userId + "] " + body.text.message);
    enfileirarMensagem(userId, { content: body.text.message });

  } catch (err) {
    console.error("Erro:", err.response?.data || err.message);
  }
});

// ─── ENVIO VIA Z-API ─────────────────────────────────────────────────────────
async function sendZAPIMessage(phone, text) {
  await axios.post(
    `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`,
    { phone, message: text },
    {
      headers: {
        "Client-Token": ZAPI_CLIENT_TOKEN,
        "Content-Type": "application/json",
      },
    }
  );
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function dataAtualStr() {
  const dias  = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return `${dias[agora.getDay()]}, ${agora.getDate()} de ${meses[agora.getMonth()]} de ${agora.getFullYear()}`;
}

function promptComData() {
  const d = dataAtualStr();
  return `DATA DE HOJE: ${d}. Nunca use datas anteriores a esta. Calcule sempre a partir desta data.\n\n` +
         AGENT_CONFIG.instructions +
         `\n\nLEMBRETE FINAL: hoje é ${d}. Qualquer data de visita deve ser calculada a partir daqui.`;
}

function mensagensComData(history, lead = null, knowledge = []) {
  const d = dataAtualStr();
  let ctx = `[Sistema] Hoje é ${d}.`;
  if (lead) {
    ctx += ` Cliente identificado — Nome: ${lead.nome || "desconhecido"} | Empresa: ${lead.empresa || "desconhecida"}`;
    if (lead.endereco)     ctx += ` | Endereço: ${lead.endereco}`;
    if (lead.stage)        ctx += ` | Etapa: ${lead.stage}`;
    if (lead.last_summary) ctx += ` | Contexto anterior: ${lead.last_summary}`;
    ctx += `. Use esses dados sem perguntar novamente. Confirme com o cliente e pergunte só o que estiver faltando.`;
  }
  if (knowledge.length > 0) {
    ctx += `\n\n[Conhecimento relevante]:\n`;
    knowledge.forEach(k => {
      ctx += `- ${k.content}`;
      if (k.context) ctx += ` (${k.context})`;
      ctx += "\n";
    });
  }
  return [
    { role: "user",      content: ctx },
    { role: "assistant", content: `Entendido.` },
    ...history,
  ];
}
function formatarTelefoneWA(telefone) {
  const nums = (telefone || "").replace(/\D/g, "");
  return nums.startsWith("55") && nums.length >= 12 ? nums : "55" + nums;
}

function parsearDataParaDB(dataStr) {
  const hoje = new Date();
  const match = dataStr.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/) ||
                dataStr.match(/dia\s*(\d{1,2})/);
  if (!match) return null;
  let dia, mes, ano;
  if (match[0].includes("/") || match[0].includes("-")) {
    dia = parseInt(match[1]);
    mes = parseInt(match[2]) - 1;
    ano = match[3] ? parseInt(match[3] < 100 ? "20" + match[3] : match[3]) : hoje.getFullYear();
  } else {
    dia = parseInt(match[1]);
    mes = hoje.getMonth();
    ano = hoje.getFullYear();
    if (dia <= hoje.getDate()) mes += 1;
  }
  const d = new Date(ano, mes, dia);
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// ─── GATILHOS ────────────────────────────────────────────────────────────────
async function verificarGatilhos(reply, userId) {
  if (reply.includes("[LEAD_CAPTURADO]")) {
    const linha = reply.match(/\[LEAD_CAPTURADO\](.*)/)?.[1]?.trim() || "";
    const tipo     = linha.match(/Tipo: ([^|]+)/)?.[1]?.trim()     || "orcamento";
    const nome     = linha.match(/Nome: ([^|]+)/)?.[1]?.trim()     || "Cliente";
    const empresa  = linha.match(/Empresa: ([^|]+)/)?.[1]?.trim()  || "";
    const telefone = linha.match(/Telefone: ([^|]+)/)?.[1]?.trim() || "";
    const produto  = linha.match(/Produto: ([^|]+)/)?.[1]?.trim()  || "";
    const estimativa = linha.match(/Estimativa: ([^|]+)/)?.[1]?.trim() || "";
    const foneWA   = formatarTelefoneWA(telefone);

    let assunto, intro, msgSugerida;
    if (tipo === "consultoria") {
      assunto = "Novo lead para consultoria - Comunynk";
      intro   = "Cliente sem arte ou medidas definidas. Precisa de apoio para estruturar o projeto.";
      msgSugerida = `Olá ${nome}, tudo bem? Sou da equipe da Comunynk. A Olivia me passou seu contato. Vi que você está precisando de ${produto} e nosso time pode te ajudar a definir o projeto. Quando tiver um momento para conversarmos?`;
    } else {
      assunto = "Novo lead para orçamento - Comunynk";
      intro   = "Cliente com arte e medidas. Pronto para receber orçamento detalhado.";
      msgSugerida = `Olá ${nome}, tudo bem? Sou da equipe da Comunynk. A Olivia me passou seu contato. Você estava interessado em ${produto} com estimativa de ${estimativa}. Posso te enviar o orçamento detalhado agora.`;
    }

    const corpo =
      `${intro}\n\n` +
      `Nome: ${nome}\n` +
      `Empresa: ${empresa}\n` +
      `Telefone: ${telefone}\n` +
      `Produto: ${produto}\n` +
      `Estimativa: ${estimativa}\n\n` +
      `Abrir conversa: https://wa.me/${foneWA}\n\n` +
      `Mensagem sugerida:\n"${msgSugerida}"`;

    await upsertLead(userId, { nome, empresa, stage: "qualificado" });
    await notificarResponsavel(assunto, corpo);

    const arteUrl = artes[userId];
    if (arteUrl && NOTIFICACOES.whatsapp_responsavel !== "PREENCHA_AQUI") {
      try {
        await axios.post(
          `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-image`,
          {
            phone:   NOTIFICACOES.whatsapp_responsavel,
            image:   arteUrl,
            caption: "Arte do cliente: " + nome,
          },
          { headers: { "Client-Token": ZAPI_CLIENT_TOKEN, "Content-Type": "application/json" } }
        );
        console.log("Arte encaminhada para o responsavel.");
      } catch (err) {
        console.error("Erro ao encaminhar arte:", err.response?.data || err.message);
      }
    }
  }

  if (reply.includes("[VISITA_SOLICITADA]")) {
    const linha    = reply.match(/\[VISITA_SOLICITADA\](.*)/)?.[1]?.trim() || "";
    const nome     = linha.match(/Nome: ([^|]+)/)?.[1]?.trim()     || "Cliente";
    const empresa  = linha.match(/Empresa: ([^|]+)/)?.[1]?.trim()  || "";
    const telefone = linha.match(/Telefone: ([^|]+)/)?.[1]?.trim() || "";
    const endereco = linha.match(/Endereço: ([^|]+)/)?.[1]?.trim() || "";
    const produto  = linha.match(/Produto: ([^|]+)/)?.[1]?.trim()  || "";
    const estimativa = linha.match(/Estimativa: ([^|]+)/)?.[1]?.trim() || "";
    const dataStr  = linha.match(/Data: ([^|]+)/)?.[1]?.trim()     || "";
    const horario  = linha.match(/Horario: ([^|]+)/)?.[1]?.trim()  || "";
    const foneWA   = formatarTelefoneWA(telefone);
    const dataDB   = parsearDataParaDB(dataStr);

    console.log("[VISITA_SOLICITADA] detectado:", linha);
    console.log("[GOOGLE CALENDAR] ENABLED:", GOOGLE_CALENDAR_ENABLED, "| REFRESH_TOKEN:", GOOGLE_REFRESH_TOKEN ? "OK" : "AUSENTE");

    if (GOOGLE_CALENDAR_ENABLED) {
      await criarEventoCalendar(linha);
    }

    if (dataDB) {
      await db.query(
        `INSERT INTO visitas (user_id, dados, data_visita, horario) VALUES ($1, $2, $3, $4)`,
        [userId, linha, dataDB, horario]
      );
    }

    const msgSugerida = `Olá ${nome}, tudo bem? Sou da equipe da Comunynk. Passando para confirmar a visita técnica agendada para ${dataStr} às ${horario}. Estaremos no endereço informado. Qualquer dúvida, estou à disposição.`;

    const corpo =
      `Visita técnica agendada pela Olivia.\n\n` +
      `Nome: ${nome}\n` +
      `Empresa: ${empresa}\n` +
      `Telefone: ${telefone}\n` +
      `Endereço: ${endereco}\n` +
      `Produto: ${produto}\n` +
      `Estimativa: ${estimativa}\n` +
      `Data: ${dataStr}\n` +
      `Horário: ${horario}\n\n` +
      `Abrir conversa: https://wa.me/${foneWA}\n\n` +
      `Mensagem sugerida para confirmar no dia:\n"${msgSugerida}"`;

    await upsertLead(userId, { nome, empresa, endereco, stage: "qualificando" });
    await notificarResponsavel("Nova visita técnica - Comunynk", corpo);
  }

  if (reply.includes("[ARTE_APROVADA]")) {
    const linha    = reply.match(/\[ARTE_APROVADA\](.*)/)?.[1]?.trim() || "";
    const nome     = linha.match(/Cliente: ([^|]+)/)?.[1]?.trim()    || "Cliente";
    const telefone = linha.match(/Telefone: ([^|]+)/)?.[1]?.trim()   || "";
    const foneWA   = formatarTelefoneWA(telefone);
    await notificarResponsavel(
      "Arte aprovada pelo cliente - Comunynk",
      `${nome} aprovou a arte. Pronto para produção.\n\nTelefone: ${telefone}\nAbrir conversa: https://wa.me/${foneWA}`
    );
  }

  if (reply.includes("[ARTE_REVISAO]")) {
    const linha      = reply.match(/\[ARTE_REVISAO\](.*)/)?.[1]?.trim() || "";
    const nome       = linha.match(/Cliente: ([^|]+)/)?.[1]?.trim()       || "Cliente";
    const telefone   = linha.match(/Telefone: ([^|]+)/)?.[1]?.trim()      || "";
    const alteracao  = linha.match(/Alteracao: ([^|]+)/)?.[1]?.trim()     || "";
    const foneWA     = formatarTelefoneWA(telefone);
    await notificarResponsavel(
      "Cliente pede alteração na arte - Comunynk",
      `${nome} quer alterações na arte.\n\nPedido: ${alteracao}\nTelefone: ${telefone}\nAbrir conversa: https://wa.me/${foneWA}`
    );
  }
}

// ─── GOOGLE CALENDAR ──────────────────────────────────────────────────────────
async function criarEventoCalendar(dadosVisita) {
  if (!GOOGLE_CALENDAR_ENABLED) return;
  if (!GOOGLE_REFRESH_TOKEN) {
    console.error("[GOOGLE CALENDAR] GOOGLE_REFRESH_TOKEN nao definido.");
    return;
  }

  try {
    const tokenRes = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type:    "refresh_token",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenRes.data.access_token;

    const nome     = dadosVisita.match(/Nome: ([^|]+)/)?.[1]?.trim()     || "Cliente";
    const endereco = dadosVisita.match(/Endereço: ([^|]+)/)?.[1]?.trim() || "";
    const produto  = dadosVisita.match(/Produto: ([^|]+)/)?.[1]?.trim()  || "";
    const data     = dadosVisita.match(/Data: ([^|]+)/)?.[1]?.trim()     || "";
    const horario  = dadosVisita.match(/Horario: ([^|]+)/)?.[1]?.trim()  || "09:00";

    console.log("[GOOGLE CALENDAR] data extraida:", data, "| horario extraido:", horario);

    // Parsing da data: aceita "27/05", "27/05/2026", "27-05-2026", "dia 27"
    const hoje = new Date();
    let inicio = new Date();
    const matchData = data.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/) ||
                      data.match(/dia\s*(\d{1,2})/);
    if (matchData) {
      let dia, mes, ano;
      if (matchData[0].includes("/") || matchData[0].includes("-")) {
        dia = parseInt(matchData[1]);
        mes = parseInt(matchData[2]) - 1;
        ano = matchData[3] ? parseInt(matchData[3] < 100 ? "20" + matchData[3] : matchData[3]) : hoje.getFullYear();
      } else {
        // formato "dia 27" — usa mês atual, avança para próximo mês se já passou
        dia = parseInt(matchData[1]);
        mes = hoje.getMonth();
        ano = hoje.getFullYear();
        if (dia <= hoje.getDate()) mes += 1;
      }
      inicio = new Date(ano, mes, dia);
    } else {
      inicio.setDate(inicio.getDate() + 1);
    }

    // Parsing do horário: aceita "14h", "14:00", "14h00", "14h30", "9"
    let hora = 9, min = 0;
    const matchHora = horario.match(/(\d{1,2})[h:](\d{2})?/);
    if (matchHora) {
      hora = parseInt(matchHora[1]);
      min  = parseInt(matchHora[2] || "0");
    } else {
      const soNum = horario.match(/^\d{1,2}$/);
      if (soNum) hora = parseInt(soNum[0]);
    }
    inicio.setHours(hora, min, 0, 0);
    const fim = new Date(inicio.getTime() + 60 * 60 * 1000);

    const fmtLocal = d => {
      const p = n => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
             "T" + p(d.getHours()) + ":" + p(d.getMinutes()) + ":00";
    };

    await axios.post(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID || "primary")}/events`,
      {
        summary:     "Visita Técnica - " + nome,
        description: "Produto: " + produto + "\nDados: " + dadosVisita,
        location:    endereco,
        start: { dateTime: fmtLocal(inicio), timeZone: "America/Sao_Paulo" },
        end:   { dateTime: fmtLocal(fim),    timeZone: "America/Sao_Paulo" },
      },
      { headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" } }
    );

    console.log("[GOOGLE CALENDAR] Evento criado para " + nome);
  } catch (err) {
    console.error("Erro Google Calendar:", err.response?.data || err.message);
  }
}

// ─── NOTIFICACAO RESPONSAVEL ─────────────────────────────────────────────────
async function notificarResponsavel(assunto, corpo) {
  const emailConfigurado =
    NOTIFICACOES.gmail_remetente !== "PREENCHA_AQUI" &&
    NOTIFICACOES.gmail_senha_app !== "PREENCHA_AQUI" &&
    NOTIFICACOES.email_responsavel !== "PREENCHA_AQUI";

  if (emailConfigurado) {
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: NOTIFICACOES.gmail_remetente, pass: NOTIFICACOES.gmail_senha_app },
      });
      await transporter.sendMail({
        from:    "Olivia Comunynk <" + NOTIFICACOES.gmail_remetente + ">",
        to:      NOTIFICACOES.email_responsavel,
        subject: assunto,
        text:    corpo,
      });
      console.log("Email enviado.");
    } catch (err) {
      console.error("Erro email:", err.message);
    }
  } else {
    console.log("[NOTIFICACAO - EMAIL NAO CONFIGURADO] " + assunto + "\n" + corpo);
  }

  const whatsappConfigurado = NOTIFICACOES.whatsapp_responsavel !== "PREENCHA_AQUI";

  if (whatsappConfigurado) {
    try {
      await sendZAPIMessage(NOTIFICACOES.whatsapp_responsavel, assunto + "\n\n" + corpo);
      console.log("WhatsApp responsavel enviado.");
    } catch (err) {
      console.error("Erro WhatsApp responsavel:", err.message);
    }
  } else {
    console.log("[NOTIFICACAO - WHATSAPP NAO CONFIGURADO] " + assunto);
  }
}

// ─── ADMIN: INDEXAR BASE DE CONHECIMENTO ─────────────────────────────────────
app.post("/admin/knowledge", async (req, res) => {
  const { content, context, source_type = "faq" } = req.body;
  if (!content) return res.status(400).json({ error: "content obrigatorio" });
  if (!VOYAGE_API_KEY) return res.status(503).json({ error: "VOYAGE_API_KEY nao configurado" });
  try {
    const embedding = await gerarEmbedding(content);
    const embStr    = "[" + embedding.join(",") + "]";
    await db.query(
      `INSERT INTO knowledge_base (source_type, content, context, embedding) VALUES ($1, $2, $3, $4::vector)`,
      [source_type, content, context || null, embStr]
    );
    console.log("[KNOWLEDGE] Indexado:", source_type, "|", content.substring(0, 60));
    res.json({ ok: true, source_type, preview: content.substring(0, 80) });
  } catch (err) {
    console.error("[KNOWLEDGE] Erro:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── OAUTH GOOGLE (gerar refresh token uma única vez) ────────────────────────
app.get("/auth", (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    return res.send(
      "<h3>Variaveis ausentes no Railway:</h3>" +
      "<pre>" +
      "GOOGLE_CLIENT_ID: " + (GOOGLE_CLIENT_ID || "NAO DEFINIDO") + "\n" +
      "GOOGLE_CLIENT_SECRET: " + (GOOGLE_CLIENT_SECRET ? "OK" : "NAO DEFINIDO") + "\n" +
      "GOOGLE_REDIRECT_URI: " + (GOOGLE_REDIRECT_URI || "NAO DEFINIDO") +
      "</pre>"
    );
  }
  const url = "https://accounts.google.com/o/oauth2/auth?" +
    "client_id=" + GOOGLE_CLIENT_ID +
    "&redirect_uri=" + encodeURIComponent(GOOGLE_REDIRECT_URI) +
    "&response_type=code" +
    "&scope=" + encodeURIComponent("https://www.googleapis.com/auth/calendar") +
    "&access_type=offline" +
    "&prompt=consent";
  console.log("[AUTH] Redirecionando para:", url);
  res.redirect(url);
});

app.get("/oauth2callback", async (req, res) => {
  console.log("[CALLBACK] url:", req.url, "| query:", JSON.stringify(req.query));
  const code = req.query.code;
  if (!code) return res.send("Codigo nao recebido. URL completa: " + req.url);

  try {
    const tokenRes = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  GOOGLE_REDIRECT_URI,
        grant_type:    "authorization_code",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const refreshToken = tokenRes.data.refresh_token;
    console.log("REFRESH TOKEN GERADO:", refreshToken);
    res.send("<h2>Refresh Token gerado</h2><p>Copie o valor abaixo e adicione no Railway como GOOGLE_REFRESH_TOKEN:</p><pre>" + refreshToken + "</pre>");
  } catch (err) {
    console.error("Erro OAuth:", err.response?.data || err.message);
    res.send("Erro ao gerar token. Veja os logs do Railway.");
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({
  status: "ok",
  agent: AGENT_CONFIG.name,
  company: AGENT_CONFIG.company,
  calendar: GOOGLE_CALENDAR_ENABLED ? "ativo" : "pendente configuracao",
}));

// ─── LEMBRETE DIÁRIO DE VISITAS (8h horário de Brasília) ─────────────────────
cron.schedule("0 8 * * *", async () => {
  try {
    const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const p = n => String(n).padStart(2, "0");
    const hoje = agora.getFullYear() + "-" + p(agora.getMonth() + 1) + "-" + p(agora.getDate());

    const res = await db.query(
      `SELECT * FROM visitas WHERE data_visita = $1 AND lembrete_enviado = FALSE`,
      [hoje]
    );

    for (const visita of res.rows) {
      const nome     = visita.dados.match(/Nome: ([^|]+)/)?.[1]?.trim()     || "Cliente";
      const telefone = visita.dados.match(/Telefone: ([^|]+)/)?.[1]?.trim() || "";
      const horario  = visita.horario || "";
      const foneWA   = formatarTelefoneWA(telefone);

      const msgSugerida = `Olá ${nome}, tudo bem? Passando para confirmar a visita técnica de hoje às ${horario}. Qualquer dúvida, estou à disposição.`;
      const corpo =
        `Visita técnica hoje!\n\n` +
        `Cliente: ${nome}\n` +
        `Telefone: ${telefone}\n` +
        `Horário: ${horario}\n\n` +
        `Abrir conversa: https://wa.me/${foneWA}\n\n` +
        `Mensagem sugerida:\n"${msgSugerida}"`;

      await sendZAPIMessage(visita.user_id, `Olá ${nome}, tudo bem? Passando para confirmar a visita técnica agendada para hoje às ${horario}. Estaremos no local. Qualquer dúvida é só chamar.`);
      console.log("[LEMBRETE] Confirmacao enviada ao cliente:", visita.user_id);

      await notificarResponsavel("Lembrete de visita técnica hoje - " + nome, corpo);

      await db.query(`UPDATE visitas SET lembrete_enviado = TRUE WHERE id = $1`, [visita.id]);
      console.log("[LEMBRETE] Visita enviada para:", nome);
    }
  } catch (err) {
    console.error("Erro no lembrete de visitas:", err.message);
  }
}, { timezone: "America/Sao_Paulo" });

initDb().then(() => {
  app.listen(PORT, () => console.log("Agente " + AGENT_CONFIG.name + " da " + AGENT_CONFIG.company + " rodando na porta " + PORT));
}).catch(err => {
  console.error("Erro ao conectar ao banco:", err.message);
  process.exit(1);
});
