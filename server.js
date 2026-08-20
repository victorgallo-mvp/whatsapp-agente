require("dotenv").config();
const express    = require("express");
const axios      = require("axios");
const nodemailer = require("nodemailer");
const { Pool }   = require("pg");
const cron       = require("node-cron");
const path       = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const EVOLUTION_URL      = (process.env.EVOLUTION_URL || "").replace(/\/$/, "");
const EVOLUTION_API_KEY  = process.env.EVOLUTION_API_KEY  || "";
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "comunynk-olivia";
const PORT               = process.env.PORT || 3000;

// Google Calendar (configurar depois)
const GOOGLE_CALENDAR_ENABLED = process.env.GOOGLE_CALENDAR_ENABLED === "true";
const GOOGLE_CLIENT_ID        = process.env.GOOGLE_CLIENT_ID        || "";
const GOOGLE_CLIENT_SECRET    = process.env.GOOGLE_CLIENT_SECRET    || "";
const GOOGLE_CALENDAR_ID      = process.env.GOOGLE_CALENDAR_ID      || "";
const GOOGLE_REDIRECT_URI     = process.env.GOOGLE_REDIRECT_URI     || "";
const GOOGLE_REFRESH_TOKEN    = process.env.GOOGLE_REFRESH_TOKEN    || "";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY || "";
const GROQ_API_KEY   = process.env.GROQ_API_KEY   || "";

// Identificador do cliente/tenant ativo na base de conhecimento (knowledge_base.client_id).
// Segue o mesmo CLIENT_SLUG do deploy por padrão — um env var só decide config, prompt e
// filtro de conhecimento juntos. Registros de outros clientes continuam no banco (se o
// mesmo Postgres for compartilhado), só não são retornados pela busca.
const CLIENT_ID = process.env.CLIENT_ID || process.env.CLIENT_SLUG || "viltrum";

const NOTIFICACOES = {
  whatsapp_responsavel: process.env.WHATSAPP_RESPONSAVEL || "PREENCHA_AQUI",
  email_responsavel:    process.env.EMAIL_RESPONSAVEL    || "PREENCHA_AQUI",
  gmail_remetente:      process.env.GMAIL_REMETENTE      || "PREENCHA_AQUI",
  gmail_senha_app:      process.env.GMAIL_SENHA_APP      || "PREENCHA_AQUI",
};

// Cada cliente é um arquivo em clients/<slug>.js (mesmo motor, prompt e config
// isolados por deploy). CLIENT_SLUG decide qual carregar — default "viltrum"
// pra não quebrar o deploy atual se a env var não for setada.
const CLIENT_SLUG  = process.env.CLIENT_SLUG || "viltrum";
const AGENT_CONFIG = require(`./clients/${CLIENT_SLUG}`);

// Atalhos usados nas notificações/e-mails — antes o nome da empresa vinha
// cravado no texto ("Viltrum"), o que fazia todo deploy de outro cliente
// mandar notificação assinada com o nome errado.
const EMPRESA = AGENT_CONFIG.company;
const AGENTE  = AGENT_CONFIG.name;

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
  await db.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS arte_url TEXT`);
  await db.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS arte_raw_msg JSONB`);
  await db.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS olivia_ativa BOOLEAN DEFAULT TRUE`);

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
      cancelado        BOOLEAN DEFAULT FALSE,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE visitas ADD COLUMN IF NOT EXISTS cancelado BOOLEAN DEFAULT FALSE`);

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
    `SELECT nome, empresa, endereco, stage, profile, last_summary, total_interactions, olivia_ativa FROM leads WHERE phone = $1`,
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
  broadcastSSE("leads_update", { phone });
}

async function addToHistory(userId, role, content) {
  const res = await db.query(
    `INSERT INTO mensagens (user_id, role, content) VALUES ($1, $2, $3) RETURNING created_at`,
    [userId, role, content]
  );
  broadcastSSE("message", { phone: userId, role, content, created_at: res.rows[0]?.created_at });
}

async function salvarArteRaw(phone, rawMsg) {
  await db.query(
    `INSERT INTO leads (phone, arte_raw_msg) VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET arte_raw_msg = $2`,
    [phone, JSON.stringify(rawMsg)]
  );
}

async function transcreverAudio(rawMsg) {
  const { base64, mimetype } = await obterBase64Midia(rawMsg);
  const buffer = Buffer.from(base64, "base64");

  const FormData = require("form-data");
  const form = new FormData();
  form.append("file", buffer, {
    filename: "audio.ogg",
    contentType: mimetype || "audio/ogg",
  });
  form.append("model", "whisper-large-v3");
  form.append("language", "pt");
  form.append("response_format", "text");

  const r = await axios.post(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    form,
    { headers: { ...form.getHeaders(), Authorization: `Bearer ${GROQ_API_KEY}` } }
  );
  return typeof r.data === "string" ? r.data.trim() : (r.data?.text || "").trim();
}

async function obterBase64Midia(rawMsg) {
  const r = await axios.post(
    `${EVOLUTION_URL}/chat/getBase64FromMediaMessage/${EVOLUTION_INSTANCE}`,
    { message: rawMsg, convertToMp4: false },
    { headers: EVOLUTION_HEADERS() }
  );
  return { base64: r.data.base64, mimetype: r.data.mimetype || "image/jpeg" };
}

async function encaminharArteParaOperador(phone, rawMsg, caption) {
  if (NOTIFICACOES.whatsapp_responsavel === "PREENCHA_AQUI") return;
  try {
    const lead = await getLead(phone);
    const nome = lead?.nome || phone;
    const captionText = `Arte/referência de ${nome} (${phone})` + (caption ? `\n"${caption}"` : "");
    const { base64, mimetype } = await obterBase64Midia(rawMsg);
    await axios.post(
      `${EVOLUTION_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`,
      { number: sanitizePhone(NOTIFICACOES.whatsapp_responsavel), mediatype: "image", media: base64, mimetype, caption: captionText },
      { headers: EVOLUTION_HEADERS() }
    );
    console.log("[ARTE] Encaminhada para operador de:", phone);
  } catch (err) {
    console.error("[ARTE] Erro ao encaminhar arte para operador:", err.response?.data || err.message);
  }
}

// ─── VISÃO: ANÁLISE DE IMAGENS COM CLAUDE ────────────────────────────────────
async function analisarImagem(imageUrl) {
  try {
    const imgRes   = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 15000 });
    const base64   = Buffer.from(imgRes.data).toString("base64");
    const mediaType = (imgRes.headers["content-type"] || "image/jpeg").split(";")[0].trim();
    const tiposSuportados = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!tiposSuportados.includes(mediaType)) return null;

    const res = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages:   [{
          role:    "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text",  text: "Analise esta imagem no contexto de uma empresa de impressão e comunicação visual. Descreva em até 3 linhas: tipo de imagem (arte finalizada para impressão, foto de local para instalação, imagem de referência, logotipo, etc.), características relevantes como dimensões estimadas, tipo de superfície, formato ou qualidade aparente. Seja objetivo e técnico. Responda em português." }
          ]
        }]
      },
      {
        headers: {
          "x-api-key":         ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type":      "application/json",
        },
      }
    );
    return res.data.content?.[0]?.text || null;
  } catch (err) {
    console.error("[VISION] Erro ao analisar imagem:", err.response?.data || err.message);
    return null;
  }
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

// Threshold calibrado empiricamente com voyage-3-lite: match direto de contexto
// salvo fica em ~0.5-0.55, relacionado mas genérico em ~0.35-0.45, irrelevante
// tende a ficar abaixo de ~0.31. 0.35 pega objeção real (mesmo com frase curta e
// coloquial) com margem seguindo abaixo do que aparece pra pergunta fora do
// escopo da base. Reajustar se a base crescer muito ou mudar de embedding model
// — vale reauditar com /admin/knowledge/search?minSim=0 de tempos em tempos.
// Monta a query de busca juntando as últimas mensagens do cliente com a atual.
// Sem isso, pergunta de continuação com pronome ("qual a potência DELA?") não
// tem nenhum termo pesquisável e o RAG volta vazio, mesmo com a resposta
// indexada — o modelo/assunto ficou na mensagem anterior. Só mensagens do
// cliente entram: incluir as respostas da IA enviesaria a busca pro que ela
// já disse, em vez do que o cliente quer saber.
function montarQueryRAG(historico, mensagemAtual, janela = 2) {
  const anteriores = (historico || [])
    .filter(m => m.role === "user")
    .slice(-janela)
    .map(m => m.content);
  return [...anteriores, mensagemAtual].join(" ").slice(0, 1000);
}

function normalizarTexto(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Barreira contra contaminação entre modelos. Busca por similaridade não sabe
// que "MXF 270 FI" e "Wolf 550" são produtos diferentes: perguntar a spec de um
// recuperava a ficha do outro acima do threshold, e o modelo podia atribuir
// peso/potência do produto errado ao cliente. Isso piora conforme a base cresce.
//
// Entradas com metadata.termos só sobrevivem se a query mencionar de fato aquele
// produto. Entradas sem termos (script de objeção, institucional) passam sempre,
// porque não são específicas de um item.
//
// metadata.excluir resolve o caso do nome de um modelo ser prefixo de outro:
// "250 rxi" está inteiro dentro de "250 rxi-r", e "300 tsx" dentro de "300 tsx-r".
// Sem exclusão, perguntar da versão -R traria também a ficha da versão base, que
// tem componentes e preço diferentes. Se a query casar com algo em excluir, a
// entrada cai mesmo que um termo tenha batido.
function filtrarPorEscopo(rows, queryText) {
  const q = normalizarTexto(queryText);
  const mantidos = [];
  const descartados = [];
  for (const r of rows) {
    const termos = r.metadata?.termos;
    if (!Array.isArray(termos) || termos.length === 0) { mantidos.push(r); continue; }

    const excluir = r.metadata?.excluir;
    if (Array.isArray(excluir) && excluir.some(t => q.includes(normalizarTexto(t)))) {
      descartados.push((r.metadata?.escopo || termos[0]) + " (variante excluida)");
      continue;
    }
    if (termos.some(t => q.includes(normalizarTexto(t)))) mantidos.push(r);
    else descartados.push(r.metadata?.escopo || termos[0]);
  }
  if (descartados.length) {
    console.log("[RAG] descartado por escopo:", descartados.join(", "));
  }
  return mantidos;
}

// strict = true propaga o erro em vez de devolver lista vazia. No atendimento
// real queremos degradar em silêncio (melhor responder sem conhecimento do que
// não responder), mas no diagnóstico isso escondia falha de API disfarçada de
// "nada encontrado" — e leva a conclusão errada sobre a qualidade da base.
async function buscarConhecimento(mensagem, topK = 4, minSimilarity = 0.35, clientId = CLIENT_ID, strict = false) {
  if (!VOYAGE_API_KEY) {
    if (strict) throw new Error("VOYAGE_API_KEY não configurado");
    return [];
  }
  try {
    let emb;
    try {
      emb = await gerarEmbedding(mensagem);
    } catch (err) {
      // Retry — o Voyage free tier rate-limita fácil e uma falha aqui fazia a
      // Olivia responder sem nenhum contexto de conhecimento, em silêncio.
      await new Promise(r => setTimeout(r, 1500));
      emb = await gerarEmbedding(mensagem);
    }
    const embStr = "[" + emb.join(",") + "]";
    // Busca com folga (topK * 3) porque o filtro de escopo abaixo pode descartar
    // resultados — sem a folga, uma ficha de outro modelo ocupando o topo faria
    // a resposta certa ficar de fora do limite.
    const res    = await db.query(
      `SELECT content, context, source_type, metadata,
              1 - (embedding <=> $1::vector) AS similarity
       FROM knowledge_base
       WHERE client_id = $3
         AND 1 - (embedding <=> $1::vector) >= $4
       ORDER BY similarity DESC
       LIMIT $2`,
      [embStr, topK * 3, clientId, minSimilarity]
    );
    return filtrarPorEscopo(res.rows, mensagem).slice(0, topK);
  } catch (err) {
    // Loga distinto de "0 resultados": aqui a busca FALHOU, não é ausência de
    // conhecimento relevante. Sem essa distinção não dá pra saber se a base
    // está ruim ou se a API de embedding está caindo.
    console.error("[RAG][FALHA] Busca não executada:", err.response?.data?.error || err.message);
    if (strict) throw err;
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
    if ((body.image?.imageUrl || body.document?.documentUrl) && body.rawMsg) {
      const { base64, mimetype } = await obterBase64Midia(body.rawMsg);
      const mediaType   = body.image ? "image" : "document";
      const captionText = intro + (conteudo ? "\n" + conteudo : "");
      const payload     = { number: sanitizePhone(clientePhone), mediatype: mediaType, media: base64, mimetype, caption: captionText };
      if (body.document) payload.fileName = body.document.fileName || "documento.pdf";
      await axios.post(
        `${EVOLUTION_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`,
        payload,
        { headers: EVOLUTION_HEADERS() }
      );
      console.log("[RELAY] Midia encaminhada via getBase64FromMediaMessage para:", clientePhone);
    } else if (conteudo) {
      await sendZAPIMessage(clientePhone, intro + "\n\n" + conteudo);
    } else {
      await sendZAPIMessage(NOTIFICACOES.whatsapp_responsavel, "Mensagem vazia. Nada foi enviado.");
      return;
    }

    let registroHistorico;
    if (body.image?.imageUrl) {
      registroHistorico = "[RELAY:ARTE] A equipe enviou uma arte para avaliação." + (conteudo ? " " + conteudo : "");
    } else if (body.document?.documentUrl) {
      registroHistorico = "[RELAY:DOCUMENTO] A equipe enviou um documento: " + (body.document.fileName || "documento.pdf") + (conteudo ? " — " + conteudo : "");
    } else {
      registroHistorico = "[RELAY:MENSAGEM] " + conteudo;
    }
    await addToHistory(clientePhone, "assistant", registroHistorico);

    console.log("[RELAY] Mensagem encaminhada para cliente:", clientePhone);
    await sendZAPIMessage(NOTIFICACOES.whatsapp_responsavel, "Mensagem encaminhada para " + clientePhone + ".");
  } catch (err) {
    console.error("Erro no relay:", JSON.stringify(err.response?.data || err.message));
    await sendZAPIMessage(NOTIFICACOES.whatsapp_responsavel, "Erro ao encaminhar a mensagem. Tente novamente.");
  }
}

// ─── SSE (PUSH PARA DASHBOARD) ───────────────────────────────────────────────
const sseClients = new Set();

function broadcastSSE(type, data) {
  const payload = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  sseClients.forEach(res => {
    try { res.write(payload); } catch { sseClients.delete(res); }
  });
}

// ─── DEBOUNCE DE MENSAGENS ───────────────────────────────────────────────────
const pendingMessages   = {};
const lastResponseTime  = {};
const processingUsers   = new Set();
const DEBOUNCE_MS       = 5000;
const POST_RESPONSE_MS  = 5000;

function enfileirarMensagem(userId, item) {
  if (!pendingMessages[userId]) {
    pendingMessages[userId] = { timer: null, items: [] };
  }
  pendingMessages[userId].items.push(item);
  clearTimeout(pendingMessages[userId].timer);

  const sinceLastResponse = Date.now() - (lastResponseTime[userId] || 0);
  const emProcessamento   = processingUsers.has(userId);
  const delay = (sinceLastResponse < POST_RESPONSE_MS || emProcessamento)
    ? Math.max(POST_RESPONSE_MS - sinceLastResponse, 0) + DEBOUNCE_MS
    : DEBOUNCE_MS;

  pendingMessages[userId].timer = setTimeout(
    () => processarMensagensPendentes(userId),
    delay
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
  if (processingUsers.has(userId)) {
    // Já há um processamento em andamento — reagenda as mensagens pendentes
    const existing = pendingMessages[userId];
    if (existing) {
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => processarMensagensPendentes(userId), DEBOUNCE_MS);
    }
    return;
  }

  const pending = pendingMessages[userId];
  if (!pending) return;
  delete pendingMessages[userId];

  processingUsers.add(userId);
  try {
    for (const item of pending.items) {
      await addToHistory(userId, "user", item.content);
    }

    const mensagemAtual = pending.items.map(i => i.content).join(" ");
    const KEYWORDS_AGENDA = ["visita", "horário", "horario", "agendar", "disponível", "disponivel", "agenda", "data"];
    const ehAgendamento   = KEYWORDS_AGENDA.some(k => mensagemAtual.toLowerCase().includes(k));

    const historico = await getHistory(userId);
    const queryText = montarQueryRAG(historico, mensagemAtual);

    const [lead, knowledge, slots] = await Promise.all([
      getLead(userId),
      buscarConhecimento(queryText),
      ehAgendamento ? buscarSlotsDisponiveis(5) : Promise.resolve(null),
    ]);

    if (lead?.olivia_ativa === false) {
      console.log("[OLIVIA] Desativada para:", userId);
      return;
    }

    if (knowledge.length > 0) {
      console.log("[RAG] " + knowledge.length + " resultado(s) para:", queryText.substring(0, 60));
    }
    if (slots) {
      console.log("[CALENDAR] Slots injetados:", slots.map(s => s.data + " " + s.horarios.join("/")).join(" | "));
    }

    const response = await chamarClaude({
      model:      "claude-sonnet-4-6",
      max_tokens: 1000,
      system:     promptComData(),
      messages:   mensagensComData(historico, lead, knowledge, slots),
    });

    let reply = response.data.content?.[0]?.text;
    if (!reply) return;

    await addToHistory(userId, "assistant", reply);
    const conflito = await verificarGatilhos(reply, userId);

    const replyLimpo = reply
      .replace(/\[LEAD_CAPTURADO\].*/g, "")
      .replace(/\[VISITA_SOLICITADA\].*/g, "")
      .replace(/\[ARTE_APROVADA\].*/g, "")
      .replace(/\[ARTE_REVISAO\].*/g, "")
      .replace(/\[ORCAMENTO_APROVADO\].*/g, "")
      .replace(/\[VISITA_REAGENDADA\].*/g, "")
      .replace(/\[VISITA_CANCELADA\].*/g, "")
      .replace(/\[PRECISA_SUPORTE\].*/g, "")
      .trim();

    if (!conflito) {
      console.log("[OLIVIA RESPONDE] " + replyLimpo);
      await sendZAPIMessage(userId, replyLimpo);
      lastResponseTime[userId] = Date.now();
    }

    // Atualiza contagem de interações e verifica se perfil precisa de update
    upsertLead(userId, {}).catch(err => console.error("[PROCESSAMENTO] upsertLead erro:", err.message));
    verificarAtualizacaoPerfil(userId);
  } catch (err) {
    console.error("Erro ao processar mensagens:", err.response?.data || err.message);
  } finally {
    processingUsers.delete(userId);
  }
}

// ─── WEBHOOK EVOLUTION API ───────────────────────────────────────────────────
const AUTO_REPLY_PATTERNS = [
  "agradecemos sua mensagem",
  "não estamos disponíveis",
  "nao estamos disponiveis",
  "entraremos em contato assim que",
  "fora do horário de atendimento",
  "fora do horario de atendimento",
  "horário de atendimento",
  "horario de atendimento",
  "resposta automática",
  "resposta automatica",
  "mensagem automática",
  "mensagem automatica",
  "atendimento automático",
  "atendimento automatico",
];

function ehRespostaAutomatica(texto) {
  const lower = (texto || "").toLowerCase();
  return AUTO_REPLY_PATTERNS.some(p => lower.includes(p));
}

function parseWebhookBody(raw) {
  if (!raw.data?.key) return raw;
  const data = raw.data;
  const key  = data.key;
  const msg  = data.message || {};
  const jid  = key.remoteJid || "";
  const phone = jid.replace(/@s\.whatsapp\.net$/, "").replace(/@g\.us$/, "");

  const imageMsg = msg.imageMessage;
  const docMsg   = msg.documentMessage
                || msg.documentWithCaptionMessage?.message?.documentMessage;
  const audioMsg = msg.audioMessage;

  // Extração de texto — cobre mensagens diretas, encaminhadas e templates
  const textoRaw = msg.conversation
    || msg.extendedTextMessage?.text
    || msg.ephemeralMessage?.message?.conversation
    || msg.ephemeralMessage?.message?.extendedTextMessage?.text
    || msg.viewOnceMessage?.message?.extendedTextMessage?.text
    || null;

  if (!textoRaw && !imageMsg && !docMsg && !audioMsg && !msg.videoMessage && !msg.stickerMessage) {
    const tipos = Object.keys(msg).join(",");
    if (tipos) console.log("[WEBHOOK] Tipo de mensagem nao mapeado:", tipos);
  }

  return {
    phone,
    fromMe:      key.fromMe  || false,
    isGroup:     jid.endsWith("@g.us"),
    isForwarded: !!(data.contextInfo?.isForwarded || msg.extendedTextMessage?.contextInfo?.isForwarded),
    text:        textoRaw ? { message: textoRaw } : null,
    image:       imageMsg ? { imageUrl: imageMsg.url, caption: imageMsg.caption || "" } : null,
    document:    docMsg   ? { documentUrl: docMsg.url, fileName: docMsg.fileName || "documento.pdf", caption: docMsg.caption || "" } : null,
    audio:       audioMsg ? { audioUrl: audioMsg.url, ptt: audioMsg.ptt || false } : null,
    video:       msg.videoMessage    || null,
    sticker:     msg.stickerMessage  || null,
    contact:     msg.contactMessage  || null,
    location:    msg.locationMessage || null,
    rawMsg:      { key, message: msg },
  };
}

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    // Log completo do payload para diagnóstico
    const evento = req.body.event || req.body.type || "(sem event)";
    console.log("[WEBHOOK] evento:", evento, "| keys:", Object.keys(req.body).join(","));

    if (req.body.event && req.body.event !== "messages.upsert") return;
    const body = parseWebhookBody(req.body);
    console.log("[WEBHOOK] phone:", body.phone, "| fromMe:", body.fromMe, "| isGroup:", body.isGroup, "| temTexto:", !!body.text?.message, "| temImagem:", !!body.image);

    if (body.isGroup) return;

    const foneBody        = (body.phone || "").replace(/\D/g, "");
    const foneResponsavel = (NOTIFICACOES.whatsapp_responsavel || "").replace(/\D/g, "");
    const semDDI          = n => n.startsWith("55") && n.length >= 12 ? n.slice(2) : n;
    const sem9            = n => n.startsWith("55") && n.length === 13 && n[4] === "9" ? n.slice(0, 4) + n.slice(5) : n;

    // Mensagem enviada da própria instância (operador via WhatsApp Web/App)
    if (body.fromMe) {
      if (body.text?.message && body.phone) {
        const isToResponsavel = foneResponsavel.length > 5 && (
          foneBody === foneResponsavel ||
          semDDI(foneBody) === semDDI(foneResponsavel) ||
          sem9(foneBody) === sem9(foneResponsavel)
        );
        if (!isToResponsavel) {
          upsertLead(body.phone, {}).catch(err => console.error("[WEBHOOK] upsertLead fromMe erro:", err.message));
          await addToHistory(body.phone, "assistant", "[DIRETO] " + body.text.message);
          broadcastSSE("leads_update", { phone: body.phone });
        }
      }
      return;
    }

    // Detecta se é o responsável enviando um relay
    const ehResponsavel   = foneResponsavel.length > 5 &&
                            (foneBody === foneResponsavel ||
                             semDDI(foneBody) === semDDI(foneResponsavel) ||
                             sem9(foneBody) === sem9(foneResponsavel));
    console.log("[WEBHOOK] fone:", foneBody, "| responsavel:", foneResponsavel, "| match:", ehResponsavel);
    if (ehResponsavel) {
      await processarMensagemResponsavel(body);
      return;
    }

    // Áudio: tenta transcrever com Groq Whisper
    if (body.audio && body.rawMsg) {
      if (!GROQ_API_KEY) {
        console.warn("[AUDIO] GROQ_API_KEY não configurada — áudio ignorado.");
        return res.sendStatus(200);
      }
      try {
        console.log("[AUDIO] Transcrevendo áudio de:", body.phone);
        const transcricao = await transcreverAudio(body.rawMsg);
        if (!transcricao) throw new Error("Transcrição vazia");
        console.log("[AUDIO] Transcrito:", transcricao.substring(0, 100));
        upsertLead(body.phone, {}).catch(() => {});
        enfileirarMensagem(body.phone, { content: transcricao });
      } catch (err) {
        console.error("[AUDIO] Falha na transcrição:", err.response?.data || err.message);
        await sendZAPIMessage(body.phone, "Recebido, nosso consultor entrará em contato em breve.");
        if (NOTIFICACOES.whatsapp_responsavel !== "PREENCHA_AQUI") {
          await sendZAPIMessage(
            NOTIFICACOES.whatsapp_responsavel,
            `[ÁUDIO NÃO TRANSCRITO] ${body.phone} enviou um áudio que não foi possível transcrever. Necessita atenção manual.`
          ).catch(() => {});
        }
      }
      return res.sendStatus(200);
    }

    // Outras mídias não suportadas (vídeo, sticker, contato, localização)
    if (body.video || body.sticker || body.contact || body.location || body.audio) {
      const tipo = body.video ? "video" : body.sticker ? "sticker" : body.contact ? "contact" : body.location ? "location" : "audio";
      console.log("[WEBHOOK] Midia nao suportada:", tipo);
      await sendZAPIMessage(body.phone, "Recebido, nosso consultor entrará em contato em breve.");
      return res.sendStatus(200);
    }

    const userId = body.phone;

    // Imagem: analisa com Claude Vision e enfileira com descrição
    if (body.image) {
      const caption = body.image.caption ? " — legenda: " + body.image.caption : "";
      if (body.rawMsg) {
        artes[userId] = body.rawMsg;
        salvarArteRaw(userId, body.rawMsg).catch(() => {});
        encaminharArteParaOperador(userId, body.rawMsg, body.image.caption || "").catch(() => {});
      }

      let descricao = "";
      if (body.image.imageUrl) {
        console.log("[VISION] Analisando imagem de:", userId);
        const analise = await analisarImagem(body.image.imageUrl);
        if (analise) {
          descricao = " — análise: " + analise;
          console.log("[VISION] Resultado:", analise.substring(0, 100));
        }
      }

      upsertLead(userId, {}).catch(err => console.error("[WEBHOOK] upsertLead imagem erro:", err.message));
      enfileirarMensagem(userId, { content: "[o cliente enviou uma imagem" + caption + descricao + "]" });
      return;
    }

    // Texto: enfileira
    if (!body.text?.message) {
      console.log("[WEBHOOK] Mensagem sem texto processável — descartada. phone:", userId);
      return;
    }

    // Detecta resposta automática de ausência (WhatsApp Business bot do cliente)
    if (ehRespostaAutomatica(body.text.message)) {
      console.log("[WEBHOOK] Resposta automática detectada de:", userId);
      upsertLead(userId, {}).catch(err => console.error("[WEBHOOK] upsertLead auto_reply erro:", err.message));
      await addToHistory(userId, "system", "[AUTO_RESPOSTA] O cliente tem resposta automática ativa. Número possivelmente indisponível no momento.");
      return;
    }

    console.log("[" + userId + "] " + body.text.message);
    // Garante que o lead existe no banco imediatamente (antes de Olivia processar)
    upsertLead(userId, {}).catch(err => console.error("[WEBHOOK] upsertLead erro:", err.message));
    enfileirarMensagem(userId, { content: body.text.message });

  } catch (err) {
    console.error("Erro:", err.response?.data || err.message);
  }
});

// ─── ENVIO VIA EVOLUTION API ─────────────────────────────────────────────────
const EVOLUTION_HEADERS = () => ({ "apikey": EVOLUTION_API_KEY, "Content-Type": "application/json" });

function sanitizePhone(phone) {
  return (phone || "").replace(/\D/g, "");
}

async function sendZAPIMessage(phone, text) {
  await axios.post(
    `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
    { number: sanitizePhone(phone), text },
    { headers: EVOLUTION_HEADERS() }
  );
}

async function wppSendImage(phone, imageUrl, caption = "") {
  await axios.post(
    `${EVOLUTION_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`,
    { number: sanitizePhone(phone), mediatype: "image", media: imageUrl, caption },
    { headers: EVOLUTION_HEADERS() }
  );
}

async function wppSendDocument(phone, documentUrl, fileName, caption = "") {
  await axios.post(
    `${EVOLUTION_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`,
    { number: sanitizePhone(phone), mediatype: "document", media: documentUrl, fileName, caption },
    { headers: EVOLUTION_HEADERS() }
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

function mensagensComData(history, lead = null, knowledge = [], slots = null) {
  const d = dataAtualStr();
  let ctx = `[Sistema] Hoje é ${d}.`;
  if (lead) {
    ctx += ` Cliente identificado — Nome: ${lead.nome || "desconhecido"} | Empresa: ${lead.empresa || "desconhecida"}`;
    if (lead.endereco)     ctx += ` | Endereço: ${lead.endereco}`;
    if (lead.stage)        ctx += ` | Etapa: ${lead.stage}`;
    if (lead.last_summary) ctx += ` | Contexto da última conversa (pode estar desatualizado): ${lead.last_summary}`;
    ctx += `. Use esses dados sem perguntar novamente. Se o cliente mencionar produto ou assunto diferente do contexto anterior, inicie novo atendimento normalmente. Confirme com o cliente e pergunte só o que estiver faltando.`;
  }
  if (knowledge.length > 0) {
    ctx += `\n\n[Conhecimento relevante]:\n`;
    knowledge.forEach(k => {
      ctx += `- ${k.content}`;
      if (k.context) ctx += ` (${k.context})`;
      ctx += "\n";
    });
  }
  if (slots && slots.length > 0) {
    ctx += `\n\n[Horários disponíveis para reunião]:\n`;
    slots.forEach(s => { ctx += `- ${s.data}: ${s.horarios.join(", ")}\n`; });
    ctx += `Ofereça esses horários ao cliente. O cliente pode sugerir qualquer horário com minutos dentro desses blocos (ex: 16h30 é aceito se 16h estiver disponível). Se o cliente sugerir horário fora de todos os blocos disponíveis, oriente a escolher dentro dos horários listados.`;
  } else if (slots !== null && slots.length === 0) {
    ctx += `\n\n[Horários disponíveis para reunião]: nenhum horário disponível nos próximos dias. Informe ao lead que a equipe vai entrar em contato para agendar.`;
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
    const tipo      = linha.match(/Tipo: ([^|]+)/)?.[1]?.trim()       || "orcamento";
    const nome      = linha.match(/Nome: ([^|]+)/)?.[1]?.trim()       || "Cliente";
    const empresa   = linha.match(/Empresa: ([^|]+)/)?.[1]?.trim()    || "";
    const telefone  = linha.match(/Telefone: ([^|]+)/)?.[1]?.trim()   || "";
    const produto   = linha.match(/Produto: ([^|]+)/)?.[1]?.trim()    || "";
    const estimativa = linha.match(/Estimativa: ([^|]+)/)?.[1]?.trim() || "";
    const observacao = linha.match(/Observacao: ([^|]+)/)?.[1]?.trim() || "";
    const foneWA    = formatarTelefoneWA(telefone);

    let assunto, intro, msgSugerida;
    if (tipo === "reserva") {
      assunto = `Reserva solicitada - ${EMPRESA}`;
      intro   = `Cliente pediu para reservar uma unidade. Confirmar disponibilidade em estoque e retornar.`;
      msgSugerida = `Olá ${nome}, tudo bem? Sou da equipe da ${EMPRESA}. A ${AGENTE} me passou seu contato sobre a reserva do ${produto}. Vou confirmar a disponibilidade e já te retorno com as condições.`;
    } else if (tipo === "consultoria") {
      assunto = `Novo lead ${EMPRESA} - ainda decidindo`;
      intro   = `Lead qualificado pela ${AGENTE}, ainda sem decisão fechada. Precisa de apoio para definir o melhor caminho.`;
      msgSugerida = `Olá ${nome}, tudo bem? Sou da equipe da ${EMPRESA}. A ${AGENTE} me passou seu contato. Vi que você está buscando ${produto || "mais informações"} e posso te ajudar a definir o melhor caminho. Quando tiver um momento para conversarmos?`;
    } else {
      assunto = `Novo lead ${EMPRESA} - interesse definido`;
      intro   = `Lead qualificado pela ${AGENTE}, já com interesse definido. Pronto para receber a proposta.`;
      msgSugerida = `Olá ${nome}, tudo bem? Sou da equipe da ${EMPRESA}. A ${AGENTE} me passou seu contato. Você demonstrou interesse no ${produto} (${estimativa}). Posso te passar os próximos passos agora.`;
    }

    const corpo =
      `${intro}\n\n` +
      `Nome: ${nome}\n` +
      `Empresa: ${empresa}\n` +
      `Telefone: ${telefone}\n` +
      `Interesse: ${produto}\n` +
      `Valor: ${estimativa}\n` +
      `Observação: ${observacao}\n\n` +
      `Abrir conversa: https://wa.me/${foneWA}\n\n` +
      `Mensagem sugerida:\n"${msgSugerida}"`;

    await upsertLead(userId, { nome, empresa, stage: "qualificado" });
    await notificarResponsavel(assunto, corpo);

    const arteRaw = artes[userId] || await db.query(`SELECT arte_raw_msg FROM leads WHERE phone = $1`, [userId]).then(r => r.rows[0]?.arte_raw_msg ? JSON.parse(r.rows[0].arte_raw_msg) : null);
    if (arteRaw && NOTIFICACOES.whatsapp_responsavel !== "PREENCHA_AQUI") {
      try {
        const captionObs = observacao && observacao.toLowerCase() !== "nenhuma"
          ? "\n\nObservação do cliente: " + observacao
          : "";
        const { base64, mimetype } = await obterBase64Midia(arteRaw);
        await axios.post(
          `${EVOLUTION_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`,
          { number: sanitizePhone(NOTIFICACOES.whatsapp_responsavel), mediatype: "image", media: base64, mimetype, caption: "Imagem enviada por " + nome + captionObs },
          { headers: EVOLUTION_HEADERS() }
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
      const disponivel = await slotEstaDisponivel(dataStr, horario);
      if (!disponivel) {
        console.log("[CALENDAR] Slot indisponivel — solicitando reagendamento ao cliente");
        await sendZAPIMessage(userId,
          `Esse horário não está disponível. Por favor escolha entre os horários que listei, de segunda a sexta em horário comercial.`
        );
        return true;
      }
      await criarEventoCalendar(linha);
    }

    if (dataDB) {
      await db.query(
        `INSERT INTO visitas (user_id, dados, data_visita, horario) VALUES ($1, $2, $3, $4)`,
        [userId, linha, dataDB, horario]
      );
    }

    const msgSugerida = `Olá ${nome}, tudo bem? Sou da equipe da ${EMPRESA}. Passando para confirmar nossa conversa agendada para ${dataStr} às ${horario}, por ${endereco}. Qualquer dúvida, estou à disposição.`;

    const corpo =
      `Reunião agendada pela Olivia.\n\n` +
      `Nome: ${nome}\n` +
      `Empresa: ${empresa}\n` +
      `Telefone: ${telefone}\n` +
      `Formato: ${endereco}\n` +
      `Plano de interesse: ${produto}\n` +
      `Valor: ${estimativa}\n` +
      `Data: ${dataStr}\n` +
      `Horário: ${horario}\n\n` +
      `Abrir conversa: https://wa.me/${foneWA}\n\n` +
      `Mensagem sugerida para confirmar no dia:\n"${msgSugerida}"`;

    await upsertLead(userId, { nome, empresa, endereco, stage: "qualificando" });
    await notificarResponsavel(`Nova reunião agendada - ${EMPRESA}`, corpo);
  }

  if (reply.includes("[ARTE_APROVADA]")) {
    const linha    = reply.match(/\[ARTE_APROVADA\](.*)/)?.[1]?.trim() || "";
    const nome     = linha.match(/Cliente: ([^|]+)/)?.[1]?.trim()    || "Cliente";
    const telefone = linha.match(/Telefone: ([^|]+)/)?.[1]?.trim()   || "";
    const foneWA   = formatarTelefoneWA(telefone);
    await notificarResponsavel(
      `Arte aprovada pelo cliente - ${EMPRESA}`,
      `${nome} aprovou a arte. Pronto para produção.\n\nTelefone: ${telefone}\nAbrir conversa: https://wa.me/${foneWA}`
    );
  }

  if (reply.includes("[ORCAMENTO_APROVADO]")) {
    const linha    = reply.match(/\[ORCAMENTO_APROVADO\](.*)/)?.[1]?.trim() || "";
    const nome     = linha.match(/Cliente: ([^|]+)/)?.[1]?.trim()    || "Cliente";
    const telefone = linha.match(/Telefone: ([^|]+)/)?.[1]?.trim()   || "";
    const foneWA   = formatarTelefoneWA(telefone);
    await upsertLead(userId, { nome, stage: "fechando" });
    await notificarResponsavel(
      `Proposta aprovada pelo lead - ${EMPRESA}`,
      `${nome} aprovou a proposta e está pronto para seguir.\n\nTelefone: ${telefone}\nAbrir conversa: https://wa.me/${foneWA}`
    );
    console.log("[ORCAMENTO_APROVADO]", nome, telefone);
  }

  if (reply.includes("[ARTE_REVISAO]")) {
    const linha      = reply.match(/\[ARTE_REVISAO\](.*)/)?.[1]?.trim() || "";
    const nome       = linha.match(/Cliente: ([^|]+)/)?.[1]?.trim()       || "Cliente";
    const telefone   = linha.match(/Telefone: ([^|]+)/)?.[1]?.trim()      || "";
    const alteracao  = linha.match(/Alteracao: ([^|]+)/)?.[1]?.trim()     || "";
    const foneWA     = formatarTelefoneWA(telefone);
    await notificarResponsavel(
      `Cliente pede alteração na arte - ${EMPRESA}`,
      `${nome} quer alterações na arte.\n\nPedido: ${alteracao}\nTelefone: ${telefone}\nAbrir conversa: https://wa.me/${foneWA}`
    );
    const arteRaw = artes[userId] || await db.query(`SELECT arte_raw_msg FROM leads WHERE phone = $1`, [userId]).then(r => r.rows[0]?.arte_raw_msg ? JSON.parse(r.rows[0].arte_raw_msg) : null);
    if (arteRaw && NOTIFICACOES.whatsapp_responsavel !== "PREENCHA_AQUI") {
      try {
        const { base64, mimetype } = await obterBase64Midia(arteRaw);
        await axios.post(
          `${EVOLUTION_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`,
          { number: sanitizePhone(NOTIFICACOES.whatsapp_responsavel), mediatype: "image", media: base64, mimetype, caption: `Arte de ${nome} — alteração solicitada: ${alteracao}` },
          { headers: EVOLUTION_HEADERS() }
        );
        console.log("[ARTE_REVISAO] Arte encaminhada ao responsavel com descricao de alteracao.");
      } catch (err) {
        console.error("[ARTE_REVISAO] Erro ao encaminhar arte:", err.response?.data || err.message);
      }
    }
    await addToHistory(userId, "assistant", `[ARTE_REVISAO] Pedido de alteração encaminhado ao responsavel — alteração: ${alteracao}`);
  }

  if (reply.includes("[VISITA_REAGENDADA]")) {
    const linha    = reply.match(/\[VISITA_REAGENDADA\](.*)/)?.[1]?.trim() || "";
    const nome     = linha.match(/Nome: ([^|]+)/)?.[1]?.trim()     || "Cliente";
    const telefone = linha.match(/Telefone: ([^|]+)/)?.[1]?.trim() || "";
    const dataStr  = linha.match(/Data: ([^|]+)/)?.[1]?.trim()     || "";
    const horario  = linha.match(/Horario: ([^|]+)/)?.[1]?.trim()  || "";
    const dataDB   = parsearDataParaDB(dataStr);
    const foneWA   = formatarTelefoneWA(telefone);

    if (dataDB) {
      await db.query(
        `UPDATE visitas SET data_visita = $1, horario = $2, lembrete_enviado = FALSE
         WHERE user_id = $3 AND cancelado = FALSE
         AND id = (SELECT id FROM visitas WHERE user_id = $3 AND cancelado = FALSE ORDER BY created_at DESC LIMIT 1)`,
        [dataDB, horario, userId]
      );
    }

    if (GOOGLE_CALENDAR_ENABLED) {
      await deletarEventoCalendar(nome, userId);
      // Busca dados originais (endereço, produto) da visita para montar evento completo
      const visitaOriginal = await db.query(
        `SELECT dados FROM visitas WHERE user_id = $1 AND cancelado = FALSE ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      const dadosOriginais = visitaOriginal.rows[0]?.dados || "";
      const endereco = dadosOriginais.match(/Endereço: ([^|]+)/)?.[1]?.trim() || "";
      const produto  = dadosOriginais.match(/Produto: ([^|]+)/)?.[1]?.trim()  || "";
      const linhaCompleta = `Nome: ${nome} | Endereço: ${endereco} | Produto: ${produto} | Data: ${dataStr} | Horario: ${horario}`;
      await criarEventoCalendar(linhaCompleta);
    }

    await notificarResponsavel(
      `Reunião reagendada - ${EMPRESA}`,
      `${nome} reagendou a reunião para ${dataStr} às ${horario}.\n\nTelefone: ${telefone}\nAbrir conversa: https://wa.me/${foneWA}`
    );
    console.log("[VISITA_REAGENDADA]", nome, dataStr, horario);
  }

  if (reply.includes("[PRECISA_SUPORTE]")) {
    const linha    = reply.match(/\[PRECISA_SUPORTE\](.*)/)?.[1]?.trim() || "";
    const nome     = linha.match(/Cliente: ([^|]+)/)?.[1]?.trim() || "Cliente";
    const telefone = linha.match(/Telefone: ([^|]+)/)?.[1]?.trim() || userId;
    const foneWA   = formatarTelefoneWA(telefone);
    await db.query(`UPDATE leads SET olivia_ativa = FALSE WHERE phone = $1`, [userId]);
    await notificarResponsavel(
      `${AGENTE} solicitou suporte — ` + nome,
      `${AGENTE} identificou que esse atendimento precisa de um consultor.\n\nCliente: ${nome}\nTelefone: ${telefone}\nAbrir conversa: https://wa.me/${foneWA}\n\n${AGENTE} foi desativada para esse chat. Reative quando concluir o atendimento.`
    );
    console.log("[PRECISA_SUPORTE] Olivia desativada para:", userId);
  }

  if (reply.includes("[VISITA_CANCELADA]")) {
    const linha    = reply.match(/\[VISITA_CANCELADA\](.*)/)?.[1]?.trim() || "";
    const nome     = linha.match(/Nome: ([^|]+)/)?.[1]?.trim()     || "Cliente";
    const telefone = linha.match(/Telefone: ([^|]+)/)?.[1]?.trim() || "";
    const foneWA   = formatarTelefoneWA(telefone);

    await db.query(
      `UPDATE visitas SET cancelado = TRUE WHERE user_id = $1 AND cancelado = FALSE`,
      [userId]
    );

    if (GOOGLE_CALENDAR_ENABLED) {
      await deletarEventoCalendar(nome, userId);
    }

    await notificarResponsavel(
      `Reunião cancelada - ${EMPRESA}`,
      `${nome} cancelou a reunião.\n\nTelefone: ${telefone}\nAbrir conversa: https://wa.me/${foneWA}`
    );
    console.log("[VISITA_CANCELADA]", nome, telefone);
  }

  return false;
}

// ─── GOOGLE CALENDAR ──────────────────────────────────────────────────────────
async function buscarAccessToken() {
  const res = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type:    "refresh_token",
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return res.data.access_token;
}

function horaEmSP(isoStr) {
  const d    = new Date(isoStr);
  const spStr = d.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
  return new Date(spStr).getHours();
}

function slotOcupado(hora, busyPeriods) {
  return busyPeriods.some(b => {
    const bStart = horaEmSP(b.start);
    const bEnd   = horaEmSP(b.end);
    return bStart < hora + 1 && bEnd > hora;
  });
}

async function buscarSlotsBloqueados(data, accessToken) {
  const p     = n => String(n).padStart(2, "0");
  const ano   = data.getFullYear();
  const mes   = p(data.getMonth() + 1);
  const dia   = p(data.getDate());
  const calId = GOOGLE_CALENDAR_ID || "primary";
  const res   = await axios.post(
    "https://www.googleapis.com/calendar/v3/freeBusy",
    {
      timeMin:  `${ano}-${mes}-${dia}T00:00:00-03:00`,
      timeMax:  `${ano}-${mes}-${dia}T23:59:59-03:00`,
      timeZone: "America/Sao_Paulo",
      items:    [{ id: calId }],
    },
    { headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" } }
  );
  return res.data.calendars?.[calId]?.busy || [];
}

async function buscarSlotsDisponiveis(diasAFrente = 5) {
  if (!GOOGLE_CALENDAR_ENABLED || !GOOGLE_REFRESH_TOKEN) return null;
  try {
    const accessToken = await buscarAccessToken();
    const SLOTS_DIA   = [9, 10, 11, 14, 15, 16, 17]; // horário comercial, com pausa de almoço
    const dias        = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
    const agora       = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const resultado   = [];
    let verificados = 0, contados = 0;

    while (contados < diasAFrente && verificados < 20) {
      verificados++;
      const data = new Date(agora);
      data.setDate(data.getDate() + verificados);
      const dow = data.getDay();
      if (dow === 0 || dow === 6) continue;
      contados++;

      const busy   = await buscarSlotsBloqueados(data, accessToken);
      const livres = SLOTS_DIA.filter(h => !slotOcupado(h, busy));
      if (livres.length > 0) {
        const p   = n => String(n).padStart(2, "0");
        resultado.push({
          data:     `${dias[dow]}, ${data.getDate()}/${p(data.getMonth() + 1)}`,
          horarios: livres.map(h => h + "h"),
        });
      }
    }
    return resultado;
  } catch (err) {
    console.error("[CALENDAR] Erro ao buscar disponibilidade:", err.message);
    return null;
  }
}

async function slotEstaDisponivel(dataStr, horarioStr) {
  if (!GOOGLE_CALENDAR_ENABLED || !GOOGLE_REFRESH_TOKEN) return true;
  try {
    const accessToken = await buscarAccessToken();
    const hoje        = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const matchData   = dataStr.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    if (!matchData) return true;
    const dia  = parseInt(matchData[1]);
    const mes  = parseInt(matchData[2]) - 1;
    const ano  = matchData[3] ? parseInt(matchData[3].length === 2 ? "20" + matchData[3] : matchData[3]) : hoje.getFullYear();
    const data = new Date(ano, mes, dia);
    const matchHora = horarioStr.match(/(\d{1,2})[h:]/);
    const hora = matchHora ? parseInt(matchHora[1]) : 9;
    const busy = await buscarSlotsBloqueados(data, accessToken);
    const ocupado = slotOcupado(hora, busy);
    console.log("[CALENDAR] Slot", horarioStr, dataStr, "| ocupado:", ocupado);
    return !ocupado;
  } catch (err) {
    console.error("[CALENDAR] Erro ao verificar slot:", err.message);
    return true;
  }
}

async function deletarEventoCalendar(nome, userId) {
  if (!GOOGLE_CALENDAR_ENABLED || !GOOGLE_REFRESH_TOKEN) return;
  try {
    const accessToken = await buscarAccessToken();
    const calId       = GOOGLE_CALENDAR_ID || "primary";
    const res = await axios.get(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,
      {
        params: { q: nome, orderBy: "updated", maxResults: 5 },
        headers: { Authorization: "Bearer " + accessToken },
      }
    );
    for (const evento of (res.data.items || [])) {
      if (evento.summary?.includes(nome)) {
        await axios.delete(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${evento.id}`,
          { headers: { Authorization: "Bearer " + accessToken } }
        );
        console.log("[CALENDAR] Evento deletado:", evento.summary);
      }
    }
  } catch (err) {
    console.error("[CALENDAR] Erro ao deletar evento:", err.response?.data || err.message);
  }
}

async function criarEventoCalendar(dadosVisita) {
  if (!GOOGLE_CALENDAR_ENABLED) return;
  if (!GOOGLE_REFRESH_TOKEN) {
    console.error("[GOOGLE CALENDAR] GOOGLE_REFRESH_TOKEN nao definido.");
    return;
  }

  try {
    const accessToken = await buscarAccessToken();

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
    const fim = new Date(inicio.getTime() + 30 * 60 * 1000);

    const fmtLocal = d => {
      const p = n => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
             "T" + p(d.getHours()) + ":" + p(d.getMinutes()) + ":00";
    };

    await axios.post(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID || "primary")}/events`,
      {
        summary:     `Reunião ${EMPRESA} - ` + nome,
        description: "Plano de interesse: " + produto + "\nDados: " + dadosVisita,
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
        from:    `${AGENTE} ${EMPRESA} <` + NOTIFICACOES.gmail_remetente + ">",
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

// ─── API: CONTROLE DA OLIVIA POR CHAT ────────────────────────────────────────
app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // desativa buffering no nginx/Railway
  res.flushHeaders();
  sseClients.add(res);
  res.write("data: {\"type\":\"connected\"}\n\n");
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25000);
  req.on("close", () => { sseClients.delete(res); clearInterval(ping); });
});

app.post("/api/leads/:phone/toggle-olivia", async (req, res) => {
  try {
    const phone = req.params.phone;
    const { ativa, mensagem } = req.body;
    if (typeof ativa !== "boolean") return res.status(400).json({ error: "ativa deve ser boolean" });
    await db.query(
      `INSERT INTO leads (phone, olivia_ativa) VALUES ($1, $2)
       ON CONFLICT (phone) DO UPDATE SET olivia_ativa = $2`,
      [phone, ativa]
    );
    console.log("[OLIVIA] Toggle:", phone, "→", ativa);

    if (ativa && mensagem?.trim()) {
      const texto = mensagem.trim();
      await sendZAPIMessage(phone, texto);
      await addToHistory(phone, "assistant", texto);
      console.log("[OLIVIA] Mensagem de reativação enviada para:", phone);
    }

    broadcastSSE("leads_update", { phone, olivia_ativa: ativa });
    res.json({ ok: true, phone, olivia_ativa: ativa });
  } catch (err) {
    console.error("[TOGGLE] Erro:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/leads/iniciar", async (req, res) => {
  try {
    const { phone, nome, empresa, produto } = req.body;
    if (!phone?.trim()) return res.status(400).json({ error: "phone obrigatorio" });

    const phoneClean = phone.trim().replace(/\D/g, "");
    if (phoneClean.length < 10) return res.status(400).json({ error: "phone invalido" });

    const nomeClean    = nome?.trim()    || null;
    const empresaClean = empresa?.trim() || null;
    const produtoClean = produto?.trim() || null;

    await db.query(
      `INSERT INTO leads (phone, nome, empresa, olivia_ativa, stage, last_interaction_at, total_interactions)
       VALUES ($1, $2, $3, true, 'novo', NOW(), 0)
       ON CONFLICT (phone) DO UPDATE SET
         nome    = COALESCE($2, leads.nome),
         empresa = COALESCE($3, leads.empresa),
         last_interaction_at = NOW()`,
      [phoneClean, nomeClean, empresaClean]
    );

    if (produtoClean) {
      await db.query(
        `UPDATE leads SET profile = COALESCE(profile, '{}'::jsonb) || $2 WHERE phone = $1`,
        [phoneClean, JSON.stringify({ produto_interesse: produtoClean })]
      );
    }

    // Gera mensagem de abertura via Olivia
    const leadCtx = { nome: nomeClean, empresa: empresaClean };
    const msgs = mensagensComData([], leadCtx, [], null);
    msgs.push({
      role: "user",
      content: `[FORMULÁRIO] Este cliente demonstrou interesse em: ${produtoClean || "comunicação visual"}. Inicie a conversa com uma mensagem de boas-vindas personalizada.`,
    });

    let mensagemAbertura = null;
    try {
      const response = await chamarClaude({
        model:      "claude-sonnet-4-6",
        max_tokens: 300,
        system:     promptComData(),
        messages:   msgs,
      });
      mensagemAbertura = response.data.content?.[0]?.text?.trim() || null;
    } catch (err) {
      console.error("[INICIAR] Falha ao gerar mensagem:", err.message);
    }

    if (!mensagemAbertura) {
      const nomeTxt   = nomeClean  ? `, ${nomeClean}`   : "";
      const prodTxt   = produtoClean ? ` em ${produtoClean}` : " em marketing digital com IA";
      mensagemAbertura = `Olá${nomeTxt}! Sou a ${AGENTE} da ${EMPRESA}. Vi que você tem interesse${prodTxt}. Como posso te ajudar?`;
    }

    const mensagemLimpa = mensagemAbertura
      .replace(/\[LEAD_CAPTURADO\].*/g, "")
      .replace(/\[VISITA_SOLICITADA\].*/g, "")
      .replace(/\[PRECISA_SUPORTE\].*/g, "")
      .trim();

    await sendZAPIMessage(phoneClean, mensagemLimpa);
    await addToHistory(phoneClean, "assistant", mensagemLimpa);
    broadcastSSE("leads_update", { phone: phoneClean });

    console.log("[INICIAR] Lead criado e mensagem enviada para:", phoneClean);
    res.json({ ok: true, phone: phoneClean, mensagem: mensagemLimpa });
  } catch (err) {
    console.error("[INICIAR] Erro:", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/leads", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT l.phone, l.nome, l.empresa, l.stage, l.olivia_ativa,
              l.last_interaction_at, l.total_interactions,
              l.profile, l.last_summary,
              m.content AS ultima_mensagem, m.role AS ultima_role
       FROM leads l
       LEFT JOIN LATERAL (
         SELECT content, role FROM mensagens WHERE user_id = l.phone ORDER BY created_at DESC LIMIT 1
       ) m ON TRUE
       ORDER BY l.last_interaction_at DESC NULLS LAST LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/leads/:phone/msgs", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT role, content, created_at FROM mensagens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 150`,
      [req.params.phone]
    );
    res.json(result.rows.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/leads/:phone/send", async (req, res) => {
  try {
    const phone = req.params.phone;
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: "text obrigatorio" });
    await sendZAPIMessage(phone, text.trim());
    const registroHistorico = "[RELAY:MENSAGEM] " + text.trim();
    await addToHistory(phone, "assistant", registroHistorico);
    console.log("[DASHBOARD] Mensagem manual enviada para:", phone);
    res.json({ ok: true });
  } catch (err) {
    console.error("[DASHBOARD] Erro ao enviar:", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/leads/:phone/send-image", async (req, res) => {
  try {
    const phone = req.params.phone;
    const { imageUrl, imageBase64, mimeType, caption } = req.body;

    if (!imageUrl && !imageBase64)
      return res.status(400).json({ error: "imageUrl ou imageBase64 obrigatorio" });

    let payload;
    if (imageBase64) {
      const mime = mimeType || "image/jpeg";
      const ext  = mime.split("/")[1] || "jpg";
      payload = {
        number:    sanitizePhone(phone),
        mediatype: "image",
        mimetype:  mime,
        fileName:  "imagem." + ext,
        media:     imageBase64,
        caption:   caption || "",
      };
    } else {
      payload = {
        number:    sanitizePhone(phone),
        mediatype: "image",
        media:     imageUrl.trim(),
        caption:   caption || "",
      };
    }

    await axios.post(
      `${EVOLUTION_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`,
      payload,
      { headers: EVOLUTION_HEADERS() }
    );

    const registroHistorico = "[RELAY:ARTE] A equipe enviou uma imagem." +
      (caption ? " " + caption : "") +
      (imageUrl ? " | url: " + imageUrl.trim() : "");
    await addToHistory(phone, "assistant", registroHistorico);
    console.log("[DASHBOARD] Imagem enviada para:", phone);
    res.json({ ok: true });
  } catch (err) {
    console.error("[DASHBOARD] Erro ao enviar imagem:", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// ─── ADMIN: INDEXAR BASE DE CONHECIMENTO ─────────────────────────────────────
app.post("/admin/knowledge", async (req, res) => {
  const { content, context, source_type = "faq", client_id = CLIENT_ID, metadata } = req.body;
  if (!content) return res.status(400).json({ error: "content obrigatorio" });
  if (!VOYAGE_API_KEY) return res.status(503).json({ error: "VOYAGE_API_KEY nao configurado" });
  try {
    // O vetor precisa casar com a LINGUAGEM DO LEAD, não com o texto da instrução.
    // "context" é escrito para soar como a fala real do cliente ("cliente acha caro");
    // "content" costuma ser a instrução pra IA ("não negocie o valor..."), que embeda
    // mal contra mensagens de cliente. Prioriza context na hora de gerar o vetor.
    const textoParaEmbedding = context ? `${context}. ${content}` : content;
    const embedding = await gerarEmbedding(textoParaEmbedding);
    const embStr    = "[" + embedding.join(",") + "]";
    // metadata.termos escopa a entrada a um produto: ela só será recuperada se a
    // conversa mencionar aquele produto (ver filtrarPorEscopo).
    await db.query(
      `INSERT INTO knowledge_base (client_id, source_type, content, context, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5::vector, COALESCE($6::jsonb, '{}'::jsonb))`,
      [client_id, source_type, content, context || null, embStr, metadata ? JSON.stringify(metadata) : null]
    );
    console.log("[KNOWLEDGE] Indexado:", client_id, "|", source_type, "|", content.substring(0, 60));
    res.json({ ok: true, client_id, source_type, escopo: metadata?.escopo || null, preview: content.substring(0, 80) });
  } catch (err) {
    console.error("[KNOWLEDGE] Erro:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN: DIAGNÓSTICO DO RAG ───────────────────────────────────────────────
// Roda exatamente a mesma busca que a Olivia usa em tempo real, pra auditar
// o que seria recuperado para uma mensagem qualquer — sem precisar simular
// uma conversa inteira no WhatsApp. Útil pra checar cobertura e detectar
// buracos no conhecimento (query sem nenhum resultado acima do threshold).
app.get("/admin/knowledge/search", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "query param 'q' obrigatorio" });
  const topK     = parseInt(req.query.topK) || 4;
  const minSim   = req.query.minSim !== undefined ? parseFloat(req.query.minSim) : 0.35;
  const clientId = req.query.clientId || CLIENT_ID;
  try {
    // strict: no diagnóstico, falha de embedding tem que aparecer como erro —
    // não pode se disfarçar de "nenhum resultado relevante".
    const resultados = await buscarConhecimento(q, topK, minSim, clientId, true);
    res.json({ query: q, client_id: clientId, minSimilarity: minSim, count: resultados.length, resultados });
  } catch (err) {
    const detalhe = err.response?.data?.error || err.message;
    res.status(502).json({
      error: "busca falhou (nao confundir com ausencia de resultado)",
      detalhe,
      dica: String(detalhe).includes("429") ? "rate limit do Voyage — espere alguns segundos e repita" : undefined,
    });
  }
});

// ─── ADMIN: PLAYGROUND DE CONVERSA (sem WhatsApp) ────────────────────────────
// Testa qualquer clients/<slug>.js direto por chat, sem precisar de instância
// Evolution nem número conectado. Histórico fica só em memória (Map abaixo) —
// nunca grava em "mensagens"/"leads", então não polui o banco real nem o
// dashboard com conversa de teste. Reinicia sozinho se o processo reiniciar.
const playgroundSessions = new Map(); // sessionId -> [{ role, content }]
const TAGS_GATILHO = ["LEAD_CAPTURADO", "VISITA_SOLICITADA", "ARTE_APROVADA", "ARTE_REVISAO",
                       "ORCAMENTO_APROVADO", "VISITA_REAGENDADA", "VISITA_CANCELADA", "PRECISA_SUPORTE"];

app.get("/admin/playground/clients", (req, res) => {
  const fs = require("fs");
  const arquivos = fs.readdirSync(path.join(__dirname, "clients"))
    .filter(f => f.endsWith(".js"))
    .map(f => f.replace(/\.js$/, ""));
  res.json({ clients: arquivos });
});

app.post("/admin/playground/reset", (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) playgroundSessions.delete(sessionId);
  res.json({ ok: true });
});

app.post("/admin/playground/chat", async (req, res) => {
  const { clientSlug, sessionId, message } = req.body;
  if (!clientSlug || !sessionId || !message) {
    return res.status(400).json({ error: "clientSlug, sessionId e message são obrigatórios" });
  }

  let clientConfig;
  try {
    clientConfig = require(`./clients/${clientSlug}`);
  } catch (err) {
    return res.status(404).json({ error: `Cliente "${clientSlug}" não encontrado em clients/` });
  }

  if (!playgroundSessions.has(sessionId)) playgroundSessions.set(sessionId, []);
  const history = playgroundSessions.get(sessionId);
  // monta a query ANTES de empilhar a mensagem atual, pra não duplicá-la
  const queryRAG = montarQueryRAG(history, message);
  history.push({ role: "user", content: message });

  try {
    const knowledge = await buscarConhecimento(queryRAG, 4, 0.35, clientSlug);

    const d      = dataAtualStr();
    const system = `DATA DE HOJE: ${d}. Nunca use datas anteriores a esta. Calcule sempre a partir desta data.\n\n` +
                   clientConfig.instructions +
                   `\n\nLEMBRETE FINAL: hoje é ${d}. Qualquer data de visita deve ser calculada a partir daqui.`;

    const response = await chamarClaude({
      model:      "claude-sonnet-4-6",
      max_tokens: 1000,
      system,
      messages:   mensagensComData(history, null, knowledge, null),
    });

    const reply = response.data.content?.[0]?.text || "";
    history.push({ role: "assistant", content: reply });

    let replyLimpo = reply;
    const tagsDetectadas = [];
    for (const tag of TAGS_GATILHO) {
      const re = new RegExp(`\\[${tag}\\].*`, "gs");
      if (re.test(reply)) tagsDetectadas.push(tag);
      replyLimpo = replyLimpo.replace(re, "").trim();
    }

    res.json({
      reply: replyLimpo,
      tagsDetectadas,
      knowledgeUsado: knowledge.map(k => ({
        context: k.context, source_type: k.source_type,
        similarity: Math.round(k.similarity * 1000) / 1000,
      })),
    });
  } catch (err) {
    console.error("[PLAYGROUND] Erro:", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/playground", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "playground.html"));
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
      const formato  = visita.dados.match(/Endereço: ([^|]+)/)?.[1]?.trim() || "";
      const horario  = visita.horario || "";
      const foneWA   = formatarTelefoneWA(telefone);

      const msgSugerida = `Olá ${nome}, tudo bem? Passando para confirmar nossa conversa de hoje às ${horario}. Qualquer dúvida, estou à disposição.`;
      const corpo =
        `Reunião hoje!\n\n` +
        `Cliente: ${nome}\n` +
        `Telefone: ${telefone}\n` +
        `Formato: ${formato}\n` +
        `Horário: ${horario}\n\n` +
        `Abrir conversa: https://wa.me/${foneWA}\n\n` +
        `Mensagem sugerida:\n"${msgSugerida}"`;

      const msgLembrete = `Olá ${nome}, tudo bem? Passando para confirmar nossa conversa agendada para hoje às ${horario}, por ${formato}. Qualquer dúvida é só chamar.`;
      await sendZAPIMessage(visita.user_id, msgLembrete);
      await addToHistory(visita.user_id, "assistant", "[LEMBRETE_VISITA] " + msgLembrete);
      console.log("[LEMBRETE] Confirmacao enviada ao cliente:", visita.user_id);

      await notificarResponsavel("Lembrete de reunião hoje - " + nome, corpo);

      await db.query(`UPDATE visitas SET lembrete_enviado = TRUE WHERE id = $1`, [visita.id]);
      upsertLead(visita.user_id, {}).catch(err => console.error("[LEMBRETE] upsertLead erro:", err.message));
      broadcastSSE("leads_update", { phone: visita.user_id });
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
