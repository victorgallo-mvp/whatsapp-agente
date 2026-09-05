require("dotenv").config();
const express    = require("express");
const axios      = require("axios");
const nodemailer = require("nodemailer");
const { Pool }   = require("pg");
const cron       = require("node-cron");
const path       = require("path");

const app = express();
app.use(express.json({ limit: "25mb" })); // áudio em base64 estoura o padrão de 100kb
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
  // JID do grupo da empresa (termina em @g.us). Opcional: sem ele, notificação
  // vai só pro responsável. Descubra o JID com GET /admin/grupos.
  grupo_empresa:        process.env.GRUPO_EMPRESA        || "",
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
  // Em qual contagem de interação o resumo foi feito pela última vez — é o que
  // permite refazer a cada N mensagens, e não só a cada 24h.
  await db.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS resumo_ate_interacao INT DEFAULT 0`);

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

  // Conversas de teste do playground. Tabela separada de propósito: não polui
  // "mensagens"/"leads" nem o dashboard com tráfego de teste, mas fica gravada.
  // Antes o histórico vivia só em memória e todo deploy apagava — justo o
  // material que a gente usa pra achar defeito de comportamento.
  await db.query(`
    CREATE TABLE IF NOT EXISTS playground_mensagens (
      id          SERIAL PRIMARY KEY,
      session_id  TEXT NOT NULL,
      client_slug TEXT NOT NULL,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      rag_usado   JSONB DEFAULT '[]',
      tags        JSONB DEFAULT '[]',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_playground_sessao ON playground_mensagens (session_id, created_at)`);

  // Contatos que já conversavam com este número antes da IA entrar. Serve pra
  // não atender quem já tem relação com o dono: contato pessoal, fornecedor,
  // cliente antigo que ele mesmo atende. Populado uma vez na instalação, a
  // partir das conversas que a instância do Evolution já tem.
  await db.query(`
    CREATE TABLE IF NOT EXISTS contatos_conhecidos (
      phone       TEXT PRIMARY KEY,
      nome        TEXT,
      origem      TEXT DEFAULT 'retrato_instalacao',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

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

// Núcleo da transcrição, separado do WhatsApp de propósito: o mesmo caminho
// serve pro áudio que chega pela Evolution e pro endpoint de teste. Testar a
// transcrição sem depender de mandar áudio por WhatsApp é o que permite validar
// o pipeline antes de migrar de provedor.
async function transcreverBuffer(buffer, mimetype = "audio/ogg", nomeArquivo = "audio.ogg") {
  const FormData = require("form-data");
  const form = new FormData();
  form.append("file", buffer, { filename: nomeArquivo, contentType: mimetype });
  form.append("model", "whisper-large-v3");
  form.append("language", "pt");
  form.append("response_format", "text");

  const r = await axios.post(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    form,
    { headers: { ...form.getHeaders(), Authorization: `Bearer ${GROQ_API_KEY}` }, maxBodyLength: Infinity }
  );
  return typeof r.data === "string" ? r.data.trim() : (r.data?.text || "").trim();
}

async function transcreverAudio(rawMsg) {
  const { base64, mimetype } = await obterBase64Midia(rawMsg);
  return transcreverBuffer(Buffer.from(base64, "base64"), mimetype || "audio/ogg");
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
            { type: "text",  text: `Descreva esta imagem para a equipe de ${EMPRESA}, em até 4 linhas, de forma objetiva.

Se for comprovante de pagamento ou transferência (PIX, TED, depósito), transcreva literalmente o que está visível: valor, data e hora, nome do pagador, nome do favorecido, instituição e identificador da transação. Não conclua se o pagamento é verdadeiro nem se o dinheiro entrou — isso não se verifica por imagem. Apenas transcreva o que está escrito e diga se algum desses campos não aparece.

Se for outro tipo de imagem (foto de veículo, documento, print de conversa, local), diga o que é e o que aparece de relevante.

Responda em português.` }
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
// Confere se todo valor em R$ que a IA citou existe de fato na tabela do prompt.
// Alucinação de dígito em preço é o erro mais caro deste sistema: num teste a IA
// cotou R$ 27.490 numa moto de R$ 17.490, dez mil reais de diferença, sem nada
// no sistema percebendo. Aqui não bloqueia a resposta, mas deixa rastro no log e
// aparece no playground, que é o que permite pegar antes de virar rotina.
function conferirPrecos(texto, instrucoes) {
  const daTabela = new Set((instrucoes.match(/R\$ ?[\d.]+/g) || []).map(v => v.replace(/[^\d]/g, "")));
  if (daTabela.size === 0) return [];
  const citados = (texto.match(/R\$ ?[\d.]+/g) || []).map(v => v.replace(/[^\d]/g, ""));
  // valores curtos são troco de conversa (ex: "R$ 50"), não cotação de máquina
  return [...new Set(citados.filter(v => v.length >= 4 && !daTabela.has(v)))];
}

// Gera a resposta e, se aparecer valor em R$ que não existe na tabela, tenta de
// novo uma vez. Validar preço DENTRO do modelo não funciona: quando eu mandei
// ela "conferir o valor antes de mandar", a conferência saiu no texto pro
// cliente, em inglês ("Wait, let me re-check the price"). O único lugar onde
// essa checagem funciona é aqui fora, depois da resposta pronta.
async function gerarRespostaValidada(payload, instrucoes) {
  let resposta = await chamarClaude(payload);
  let texto    = resposta.data.content?.[0]?.text || "";

  const suspeitos = conferirPrecos(texto, instrucoes);
  if (suspeitos.length) {
    console.warn("[PRECO][SUSPEITO] regenerando. valores fora da tabela:", suspeitos.join(", "));
    const segunda = await chamarClaude(payload);
    const texto2  = segunda.data.content?.[0]?.text || "";
    const ainda   = conferirPrecos(texto2, instrucoes);
    if (ainda.length) {
      console.error("[PRECO][PERSISTE] segunda tentativa também citou valor fora da tabela:", ainda.join(", "));
    }
    // fica com a segunda se ela estiver limpa; senão devolve a primeira mesmo,
    // já logada, em vez de deixar o cliente sem resposta
    if (!ainda.length) { resposta = segunda; texto = texto2; }
  }
  return { resposta, texto, suspeitos };
}

function normalizarTexto(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Cliente escreve como fala, não como a gente catalogou: quem procura a 270 FI
// digita "270 fi" ou "fi 270" com a mesma naturalidade. Sem aceitar a ordem
// invertida, "queria saber da fi 270" não casava com nenhum termo, o filtro
// descartava a ficha e a IA respondia "confirmo e retorno" sobre dado indexado.
// Só inverte termo de duas palavras — é onde a troca acontece na prática.
function formasDoTermo(termo) {
  const t = normalizarTexto(termo).trim();
  const partes = t.split(/\s+/).filter(Boolean);
  return partes.length === 2 ? [t, `${partes[1]} ${partes[0]}`] : [t];
}

function textoMencionaTermo(textoNormalizado, termo) {
  return formasDoTermo(termo).some(f => textoNormalizado.includes(f));
}

// Termos de escopo cadastrados no conhecimento do cliente (metadata.termos).
// Cacheado porque muda pouco e seria uma consulta a cada mensagem recebida.
const escopoTermosCache = new Map(); // clientId -> { termos, ts }
const ESCOPO_TTL_MS = 10 * 60 * 1000;

async function termosDeEscopo(clientId) {
  const cache = escopoTermosCache.get(clientId);
  if (cache && Date.now() - cache.ts < ESCOPO_TTL_MS) return cache.termos;
  try {
    const res = await db.query(
      `SELECT DISTINCT jsonb_array_elements_text(metadata->'termos') AS termo
       FROM knowledge_base
       WHERE client_id = $1 AND metadata ? 'termos'`,
      [clientId]
    );
    // Mais longo primeiro: numa conversa que citou "250 rxi-r", queremos casar
    // com ele e não com o "250 rxi" que está contido dentro dele.
    const termos = res.rows.map(r => r.termo).sort((a, b) => b.length - a.length);
    escopoTermosCache.set(clientId, { termos, ts: Date.now() });
    return termos;
  } catch (err) {
    console.error("[RAG] Erro ao carregar termos de escopo:", err.message);
    return [];
  }
}

// Qual produto a conversa está tratando. Varre o histórico do mais recente pro
// mais antigo, então trocar de assunto no meio da conversa funciona: passa a
// valer o último citado.
// Varre a conversa INTEIRA, incluindo o que a IA disse. Quem citou o produto não
// importa para saber do que se está falando: quando ela recomenda um modelo e o
// cliente responde "por favor" ou "essa mesmo", o assunto é o modelo que ela
// nomeou. Olhar só o cliente fazia a busca sair sem modelo justamente nesse
// caso, e ela pedia pra confirmar spec de ficha que estava indexada.
//
// Isso é diferente do texto da query (montarQueryRAG), que segue usando só
// mensagens do cliente: lá a fala da IA enviesaria a busca pro que ela já disse.
function assuntoDaConversa(historico, termos) {
  if (!termos || termos.length === 0) return null;
  const msgs = historico || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const texto = normalizarTexto(msgs[i].content);
    const achado = termos.find(t => textoMencionaTermo(texto, t));
    if (achado) return achado;
  }
  return null;
}

// Monta a query de busca a partir das últimas mensagens DO CLIENTE (o histórico
// recebido já inclui a mensagem atual). Só mensagens do cliente entram: incluir
// as respostas da IA enviesaria a busca pro que ela já disse.
//
// O "assunto" é o que conserta conversa longa. Sem ele, o nome do modelo saía da
// janela depois de duas ou três trocas e o filtro de escopo — corretamente —
// descartava a ficha, porque a pergunta não citava produto nenhum. Resultado: a
// IA dizia "confirmo e retorno" sobre dado que estava indexado. Com o assunto
// grudado na query, a conversa continua sabendo do que se trata.
function montarQueryRAG(historico, janela = 3, assunto = null) {
  const base = (historico || [])
    .filter(m => m.role === "user")
    .slice(-janela)
    .map(m => m.content)
    .join(" ");
  const precisaAssunto = assunto && !normalizarTexto(base).includes(normalizarTexto(assunto));
  return (precisaAssunto ? assunto + " " + base : base).slice(0, 1000);
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
// Pergunta comparativa precisa das duas fichas por definição. Sem isto, o
// mecanismo que separa variante base da versão -R trabalhava contra: cliente
// perguntou "qual a diferença dela pra 300" depois de falar da 300 TSX-R, e a
// ficha da 300 TSX foi descartada, porque "300" sozinho não é termo cadastrado
// (não pode ser, colide com XWOLF 300). Falar do modelo só pelo número é o
// normal do cliente, então na comparação a exclusão é suspensa.
const MARCAS_COMPARACAO = ["diferenca", "diferencas", "diferente", "compar", "versus", " vs ",
                            "melhor que", "entre a ", "entre o ", "qual das", "qual dos"];

function ehComparacao(queryNormalizada) {
  return MARCAS_COMPARACAO.some(m => queryNormalizada.includes(m));
}

function filtrarPorEscopo(rows, queryText) {
  const q = normalizarTexto(queryText);
  const comparando = ehComparacao(q);
  const mantidos = [];
  const descartados = [];
  for (const r of rows) {
    const termos = r.metadata?.termos;
    if (!Array.isArray(termos) || termos.length === 0) { mantidos.push(r); continue; }

    // Apaga do texto as ocorrências das variantes a excluir ANTES de testar os
    // termos, em vez de descartar a entrada de cara. Assim "250 rxi-r" deixa de
    // contar como menção à "250 rxi" — mas numa pergunta comparativa ("a 250 rxi
    // e a rxi-r") o "250 rxi" que sobra ainda casa, e as duas fichas vêm, que é
    // o certo pra comparar. Descartar direto fazia a comparação perder a base.
    let alvo = q;
    const excluir = comparando ? null : r.metadata?.excluir;
    if (Array.isArray(excluir)) {
      for (const t of excluir) {
        for (const forma of formasDoTermo(t)) alvo = alvo.split(forma).join(" ");
      }
    }
    if (termos.some(t => textoMencionaTermo(alvo, t))) mantidos.push(r);
    else descartados.push(r.metadata?.escopo || termos[0]);
  }
  if (descartados.length) {
    console.log("[RAG] descartado por escopo:", descartados.join(", "));
  }
  // Sinal de alerta: a busca por similaridade achou candidatos, e o filtro
  // derrubou TODOS. Ou o cliente perguntou de produto que não temos ficha
  // (esperado), ou ele escreveu o nome de um jeito que a gente não previu —
  // que foi a causa dos três últimos bugs de "confirmo e retorno" sobre dado
  // indexado. Logar isso é o que troca "esperar o cliente reportar" por
  // "aparece no log". Vale varrer periodicamente atrás de formas novas.
  if (rows.length > 0 && mantidos.length === 0) {
    console.warn("[RAG][ESCOPO-ZERO] nenhum resultado sobreviveu. query:", queryText.slice(0, 120),
                 "| candidatos descartados:", descartados.join(", "));
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

    // O que já se sabia deste cliente. Sem isso a memória de longo prazo era uma
    // ilusão: o operador || do JSONB SUBSTITUI a chave, então cada resumo novo
    // apagava o anterior. Quem contou na segunda-feira que mora em Contagem
    // sumia do registro na quarta. Agora o resumidor recebe o registro atual e
    // mescla, em vez de sobrescrever às cegas.
    const anterior = await db.query(`SELECT profile FROM leads WHERE phone = $1`, [phone]);
    const perfilAtual = anterior.rows[0]?.profile || {};
    const temHistorico = Object.keys(perfilAtual).length > 0;
    const blocoAnterior = temHistorico
      ? `\n\nREGISTRO ATUAL DESTE CLIENTE (de conversas anteriores):\n${JSON.stringify(perfilAtual, null, 2)}\n\n` +
        `Atualize esse registro com o que a conversa abaixo acrescenta. Regras da mesclagem:\n` +
        `- Carregue adiante o que continua valendo, mesmo que a conversa nova não repita.\n` +
        `- Corrija o que a conversa nova contradiz — o mais recente vence.\n` +
        `- Remova de pendencias o que já foi resolvido.\n` +
        `- Não duplique o mesmo fato escrito de outro jeito.`
      : "";

    const res = await chamarClaude({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system:     `Você analisa conversas de atendimento da ${EMPRESA} e extrai um registro estruturado em JSON. Seja literal: registre o que foi dito, não o que você supõe.`,
      messages:   [{ role: "user", content: `Extraia da conversa, em JSON:
{
  "fatos": "dados objetivos que o cliente informou ou que foram confirmados: nome, produto de interesse, cidade, valores citados, datas. Só o que está escrito na conversa.",
  "compromissos": "o que a atendente afirmou ou prometeu ao cliente: preços informados, prazos, especificações passadas, encaminhamentos. Isso existe para ela não se contradizer depois.",
  "pendencias": "o que ficou em aberto e precisa de retorno",
  "inferencias": "leitura de intenção ou perfil. Isto é hipótese, não fato — marque como tal e não invente sinal que a conversa não dá.",
  "produto_interesse": "produto ou plano específico, se houver",
  "resumo": "duas ou três frases, orientado a decisão e pendência, não narrativo"
}

Não escreva "o cliente disse X e a atendente respondeu Y". Registre o estado atual: o que se sabe, o que foi prometido, o que falta.${blocoAnterior}

Conversa:
${conversa}` }],
    });
    const texto     = res.data.content?.[0]?.text || "";
    const jsonMatch = texto.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonLimpo = jsonMatch[0].replace(/[\r\n]+/g, " ").replace(/,\s*}/g, "}");
      const perfil = JSON.parse(jsonLimpo);
      await db.query(
        `UPDATE leads SET profile = profile || $2, last_summary = $3,
                profile_updated_at = NOW(), resumo_ate_interacao = total_interactions
         WHERE phone = $1`,
        [phone, JSON.stringify(perfil), perfil.resumo || null]
      );
      console.log("[BRAIN] Perfil atualizado para:", phone);
    }
  } catch (err) {
    console.error("[BRAIN] Erro ao atualizar perfil:", err.message);
  }
}

// A cada quantas interações o resumo é refeito. O gatilho era só de 24h, o que
// tornava o resumo inútil DENTRO de uma conversa: quem falava 30 mensagens
// seguidas nunca via o resumo atualizar, e o que saía da janela de histórico se
// perdia de vez. Agora conta interação também.
const INTERACOES_POR_RESUMO = 8;

async function verificarAtualizacaoPerfil(phone) {
  try {
    const res = await db.query(
      `SELECT profile_updated_at, total_interactions, resumo_ate_interacao FROM leads WHERE phone = $1`,
      [phone]
    );
    if (!res.rows[0]) return;
    const { profile_updated_at, total_interactions, resumo_ate_interacao } = res.rows[0];
    if (total_interactions < 3) return;

    const desdeUltimoResumo = total_interactions - (resumo_ate_interacao || 0);
    const ultimaAtt         = profile_updated_at ? new Date(profile_updated_at).getTime() : 0;
    const VINTE_QUATRO_H    = 24 * 60 * 60 * 1000;

    if (desdeUltimoResumo >= INTERACOES_POR_RESUMO || Date.now() - ultimaAtt >= VINTE_QUATRO_H) {
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

    // getHistory já traz a mensagem atual (foi gravada logo acima), então a
    // query sai daqui direto — antes ela era concatenada de novo, duplicando a
    // mensagem e deixando só UMA anterior de contexto real.
    const historico = await getHistory(userId);
    const KB_ID     = AGENT_CONFIG.knowledgeClientId || CLIENT_ID;
    const assunto   = assuntoDaConversa(historico, await termosDeEscopo(KB_ID));
    const queryText = montarQueryRAG(historico, 3, assunto);
    if (assunto) console.log("[RAG] assunto da conversa:", assunto);

    const [lead, knowledge, slots] = await Promise.all([
      getLead(userId),
      buscarConhecimento(queryText, 4, 0.35, KB_ID),
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

    const sistema = promptComData(AGENT_CONFIG.instructions, { lead, knowledge, slots });
    const { texto: reply } = await gerarRespostaValidada({
      model:      "claude-sonnet-4-6",
      max_tokens: 1000,
      system:     sistema,
      messages:   mensagensComData(historico),
    }, sistema);
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
      .replace(/\[TRANSFERIR_ATENDENTE\].*/g, "")
      .replace(/\[CONSULTAR_TIME\].*/g, "")
      .replace(/\[COMPROVANTE_RECEBIDO\].*/g, "")
      .replace(/\[VENDA_FECHADA\].*/g, "")
      .trim();

    // Resposta composta só de tag some inteira ao limpar os marcadores. Sem
    // esta guarda mandaríamos mensagem vazia pro cliente, que no WhatsApp é
    // silêncio no melhor caso e erro de envio no pior.
    const precosSuspeitos = conferirPrecos(replyLimpo, AGENT_CONFIG.instructions);
    if (precosSuspeitos.length) {
      console.warn("[PRECO][SUSPEITO] valor citado que não está na tabela:",
                   precosSuspeitos.map(v => "R$ " + v).join(", "), "| resposta:", replyLimpo.slice(0, 160));
    }

    if (!conflito && !replyLimpo) {
      console.warn("[OLIVIA] Resposta ficou vazia após remover tags. Original:", reply.slice(0, 200));
    }
    if (!conflito && replyLimpo) {
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
      const isToResponsavel = foneResponsavel.length > 5 && (
        foneBody === foneResponsavel ||
        semDDI(foneBody) === semDDI(foneResponsavel) ||
        sem9(foneBody) === sem9(foneResponsavel)
      );

      // Qualquer coisa que ELE mandar pro cliente pausa a IA nesse chat, não só
      // texto. Antes só texto contava, e nos áudios reais dele quase tudo é voz:
      // ele respondia o cliente falando, a IA não pausava, não registrava nada e
      // seguia respondendo por cima do que ele tinha combinado.
      if (body.phone && !isToResponsavel) {
        let registro;
        if (body.text?.message) {
          registro = "[DIRETO] " + body.text.message;
        } else if (body.audio && body.rawMsg && GROQ_API_KEY) {
          // Transcreve o áudio dele também: o que ele fala é o que o cliente
          // ouviu, e sem isso a conversa fica com um buraco justo onde a
          // negociação acontece.
          try {
            const t = await transcreverAudio(body.rawMsg);
            registro = "[DIRETO] (áudio) " + (t || "não foi possível transcrever");
          } catch (err) {
            console.error("[DIRETO] Falha ao transcrever áudio do operador:", err.message);
            registro = "[DIRETO] (áudio enviado)";
          }
        } else if (body.audio)    registro = "[DIRETO] (áudio enviado)";
        else if (body.image)      registro = "[DIRETO] (imagem enviada)" + (body.image.caption ? " — " + body.image.caption : "");
        else if (body.document)   registro = "[DIRETO] (documento enviado: " + (body.document.fileName || "arquivo") + ")";
        else if (body.video)      registro = "[DIRETO] (vídeo enviado)";
        else if (body.sticker)    registro = "[DIRETO] (figurinha)";
        else if (body.location)   registro = "[DIRETO] (localização enviada)";
        else if (body.contact)    registro = "[DIRETO] (contato enviado)";
        else                      registro = "[DIRETO] (mensagem enviada)";

        upsertLead(body.phone, {}).catch(err => console.error("[WEBHOOK] upsertLead fromMe erro:", err.message));
        await addToHistory(body.phone, "assistant", registro);

        const res = await db.query(
          `UPDATE leads SET olivia_ativa = FALSE WHERE phone = $1 AND olivia_ativa IS DISTINCT FROM FALSE`,
          [body.phone]
        );
        if (res.rowCount > 0) {
          console.log("[DIRETO] Operador assumiu — " + AGENTE + " pausada para:", body.phone);
        }
        broadcastSSE("leads_update", { phone: body.phone });
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

    // Contato que já falava com este número antes da IA entrar: não atende.
    // É gente com relação prévia com o dono, e quem responde é ele. Registra a
    // mensagem pra aparecer no painel e segue sem gerar resposta.
    if (AGENT_CONFIG.ignorarContatosConhecidos) {
      const conhecido = await db.query(`SELECT nome FROM contatos_conhecidos WHERE phone = $1`, [foneBody]);
      if (conhecido.rows[0]) {
        const texto = body.text?.message || (body.audio ? "(áudio)" : body.image ? "(imagem)" : "(mensagem)");
        await addToHistory(body.phone, "user", texto);
        await db.query(`UPDATE leads SET olivia_ativa = FALSE WHERE phone = $1`, [body.phone]).catch(() => {});
        broadcastSSE("leads_update", { phone: body.phone });
        console.log("[CONTATO CONHECIDO] Sem resposta automática para:", foneBody, conhecido.rows[0].nome || "");
        return;
      }
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

// Destino pode ser telefone ou grupo. Grupo vem como JID terminado em @g.us e
// não pode passar por sanitizePhone, que arrancaria o sufixo e transformaria o
// grupo num número inexistente.
function destinoWpp(dest) {
  const d = String(dest || "");
  return d.endsWith("@g.us") ? d : sanitizePhone(d);
}

async function sendZAPIMessage(phone, text) {
  await axios.post(
    `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
    { number: destinoWpp(phone), text },
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

// Monta os blocos de contexto com tags XML. A separação estrutural importa: o
// Claude usa cada bloco pelo que ele é, e antes tudo vinha num texto corrido
// injetado como se fosse fala do cliente (role "user"), o que embaralhava
// "verdade sobre o produto" com "o que o cliente disse".
function blocosDeContexto({ lead = null, knowledge = [], slots = null } = {}) {
  let ctx = "";

  if (knowledge.length > 0) {
    // Cada entrada em bloco próprio, identificada pela origem. Quando duas fichas
    // chegam juntas numa comparação, lista corrida deixa a fronteira implícita e
    // o modelo mistura: num teste ele atribuiu à 250 RXi-R um curso de suspensão
    // de 310 mm que era da RXi base, porque a ficha da RXi-R não traz esse dado.
    // Com o bloco identificado, a regra de "cada número sai da ficha daquele
    // modelo" tem onde se apoiar.
    ctx += `\n\n<contexto_negocio>\n` +
           `Fatos verificados sobre produto e serviço, vindos da base oficial. Trate como verdade. ` +
           `O que não estiver aqui, você não sabe, e não completa com suposição.\n` +
           `Cada bloco abaixo é uma fonte separada. Dado de um bloco vale só para o que aquele bloco descreve.\n`;
    knowledge.forEach(k => {
      const origem = k.metadata?.escopo || k.context || k.source_type || "geral";
      ctx += `\n<fonte sobre="${String(origem).replace(/"/g, "'")}">\n${k.content}\n</fonte>\n`;
    });
    ctx += `</contexto_negocio>`;
  }

  if (lead) {
    const p = lead.profile || {};
    ctx += `\n\n<historico_cliente>\n` +
           `Dados já conhecidos deste cliente. Use sem perguntar de novo.\n` +
           `Nome: ${lead.nome || "desconhecido"}\n`;
    if (lead.empresa)  ctx += `Empresa: ${lead.empresa}\n`;
    if (lead.endereco) ctx += `Endereço: ${lead.endereco}\n`;
    if (lead.stage)    ctx += `Etapa: ${lead.stage}\n`;
    if (p.fatos)        ctx += `Fatos apurados: ${p.fatos}\n`;
    if (p.compromissos) ctx += `Já foi dito ao cliente (mantenha coerência, não contradiga): ${p.compromissos}\n`;
    if (p.pendencias)   ctx += `Em aberto: ${p.pendencias}\n`;
    // Inferência entra marcada como hipótese de propósito: se virar "verdade",
    // a IA cristaliza julgamento errado sobre a pessoa e age em cima disso.
    if (p.inferencias)  ctx += `Leitura de perfil (HIPÓTESE, pode estar errada — nunca afirme ao cliente nem trate como fato): ${p.inferencias}\n`;
    if (!p.fatos && lead.last_summary) ctx += `Resumo da conversa anterior: ${lead.last_summary}\n`;
    ctx += `Se o cliente mencionar assunto diferente do anterior, atenda normalmente — não force o contexto antigo.\n` +
           `</historico_cliente>`;
  }

  if (slots && slots.length > 0) {
    ctx += `\n\n<agenda_disponivel>\n`;
    slots.forEach(s => { ctx += `- ${s.data}: ${s.horarios.join(", ")}\n`; });
    ctx += `Ofereça esses horários. O cliente pode sugerir horário com minutos dentro dos blocos (16h30 vale se 16h estiver livre). Fora dos blocos, oriente a escolher um dos listados.\n` +
           `</agenda_disponivel>`;
  } else if (slots !== null && slots.length === 0) {
    ctx += `\n\n<agenda_disponivel>\nNenhum horário livre nos próximos dias. Informe que a equipe entra em contato para agendar.\n</agenda_disponivel>`;
  }

  return ctx;
}

// O contexto agora vive no system, não num turno falso de usuário. As regras
// críticas do cliente são repetidas no fim porque em conversa longa o modelo
// afrouxa as instruções do começo — e as duas que mais falharam nos testes
// (inventar spec e cotar a variante errada) são justamente as caras.
function promptComData(instrucoes = AGENT_CONFIG.instructions, contexto = {}, regrasCriticas = AGENT_CONFIG.regrasCriticas) {
  const d = dataAtualStr();
  let prompt = `DATA DE HOJE: ${d}. Nunca use datas anteriores a esta. Calcule sempre a partir desta data.\n\n` +
               instrucoes +
               blocosDeContexto(contexto) +
               `\n\n<lembretes>\nHoje é ${d}. Qualquer data deve ser calculada a partir daqui.`;
  if (regrasCriticas) prompt += `\n${regrasCriticas}`;
  prompt += `\n</lembretes>`;
  return prompt;
}

// Só o diálogo. Contexto de negócio e de cliente saíram daqui de propósito.
function mensagensComData(history) {
  return [...(history || [])];
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
      `Reunião agendada pela ${AGENTE}.\n\n` +
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

  // ─── HANDOFF PARA ATENDENTE HUMANO ─────────────────────────────────────────
  // Cliente declarou intenção de compra: a IA vai até aqui e o humano assume
  // reserva, sinal, prazo e pagamento. Diferente do [PRECISA_SUPORTE], que é
  // desistência do atendimento por falta de resposta — este é o desfecho bom,
  // e a notificação precisa chegar pronta pro atendente entrar sem ler o
  // histórico inteiro.
  //
  // A reativação é manual pelo dashboard, de propósito: se a IA voltasse
  // sozinha, atropelaria o atendente no meio da negociação.
  if (reply.includes("[TRANSFERIR_ATENDENTE]")) {
    const linha      = reply.match(/\[TRANSFERIR_ATENDENTE\](.*)/)?.[1]?.trim() || "";
    const nome       = linha.match(/Nome: ([^|]+)/)?.[1]?.trim()       || "Cliente";
    const telefone   = linha.match(/Telefone: ([^|]+)/)?.[1]?.trim()   || userId;
    const produto    = linha.match(/Produto: ([^|]+)/)?.[1]?.trim()    || "não informado";
    const estimativa = linha.match(/Estimativa: ([^|]+)/)?.[1]?.trim() || "";
    const observacao = linha.match(/Observacao: ([^|]+)/)?.[1]?.trim() || "";
    const foneWA     = formatarTelefoneWA(telefone);

    await upsertLead(userId, { nome, stage: "fechando" });
    await db.query(`UPDATE leads SET olivia_ativa = FALSE WHERE phone = $1`, [userId]);

    const corpo =
      `Cliente com intenção de compra. Assuma a conversa para tratar reserva, sinal, prazo e pagamento.\n\n` +
      `Nome: ${nome}\n` +
      `Telefone: ${telefone}\n` +
      `Interesse: ${produto}\n` +
      (estimativa ? `Valor de tabela: ${estimativa}\n` : "") +
      (observacao ? `Contexto: ${observacao}\n` : "") +
      `\nAbrir conversa: https://wa.me/${foneWA}\n\n` +
      `${AGENTE} já avisou o cliente que um consultor vai continuar, e foi desativada nesse chat. ` +
      `Responda direto pelo WhatsApp ou pelo painel. Para religar a ${AGENTE} depois, use o toggle no dashboard.`;

    await notificarResponsavel(`Intenção de compra — ${nome} (${produto})`, corpo);
    broadcastSSE("leads_update", { phone: userId });
    console.log("[TRANSFERIR_ATENDENTE]", nome, "|", produto, "| Olivia desativada para:", userId);
  }

  // ─── VENDA FECHADA ─────────────────────────────────────────────────────────
  // Sinal pago e cadastro completo. Vai pro grupo de vendas no formato que a
  // equipe usa pra abrir a ordem de serviço e mandar pra fila de montagem.
  // Pausa a IA: daqui pra frente é preparação e entrega, processo do time.
  if (reply.includes("[VENDA_FECHADA]")) {
    const linha = reply.match(/\[VENDA_FECHADA\](.*)/)?.[1]?.trim() || "";
    const campo = n => linha.match(new RegExp(n + ": ([^|]+)"))?.[1]?.trim() || "";
    const nome  = campo("Nome") || "Cliente";
    const tel   = campo("Telefone") || userId;
    const foneWA = formatarTelefoneWA(tel);

    await upsertLead(userId, { nome, endereco: campo("Endereco"), stage: "fechado" });
    await db.query(`UPDATE leads SET olivia_ativa = FALSE WHERE phone = $1`, [userId]);

    // Formato de ficha, pra equipe copiar direto pro sistema
    const ficha =
      `NOME: ${nome}\n` +
      `CPF: ${campo("CPF")}\n` +
      `RG: ${campo("RG")}\n` +
      `ENDEREÇO: ${campo("Endereco")}\n` +
      `BAIRRO: ${campo("Bairro")}\n` +
      `CIDADE: ${campo("Cidade")}\n` +
      `ESTADO: ${campo("Estado")}\n` +
      `CEP: ${campo("CEP")}\n` +
      `TELEFONE: ${tel}\n` +
      `E-MAIL: ${campo("Email")}\n` +
      `PESO: ${campo("Peso")}\n` +
      `ALTURA: ${campo("Altura")}\n` +
      `MODELO DA MOTO: ${campo("Modelo")}`;

    const obs = campo("Observacao");
    await notificarResponsavel(
      `VENDA FECHADA — ${nome} (${campo("Modelo")})`,
      `Sinal de reserva pago e cadastro completo. Abrir ordem de serviço e mandar pra fila de montagem.\n\n` +
      ficha +
      (obs ? `\n\nOBSERVAÇÕES: ${obs}` : "") +
      `\n\nAbrir conversa: https://wa.me/${foneWA}\n\n` +
      `Confira a entrada do sinal no extrato antes de liberar a montagem. A ${AGENTE} foi desativada nesse chat.`
    );
    broadcastSSE("leads_update", { phone: userId });
    console.log("[VENDA_FECHADA]", nome, "|", campo("Modelo"));
  }

  // ─── COMPROVANTE DE PAGAMENTO ──────────────────────────────────────────────
  // Não pausa a IA, de propósito. O cliente acabou de mandar dinheiro: sumir
  // nesse momento é o pior atendimento possível, e não é necessário. Ela sabe
  // seguir a conversa — o que ela não pode é afirmar que o dinheiro entrou.
  // A verificação é humana e acontece em paralelo, com o aviso indo pro grupo.
  if (reply.includes("[COMPROVANTE_RECEBIDO]")) {
    const linha    = reply.match(/\[COMPROVANTE_RECEBIDO\](.*)/)?.[1]?.trim() || "";
    const nome     = linha.match(/Cliente: ([^|]+)/)?.[1]?.trim()   || "Cliente";
    const telefone = linha.match(/Telefone: ([^|]+)/)?.[1]?.trim()  || userId;
    const valor    = linha.match(/Valor: ([^|]+)/)?.[1]?.trim()     || "não identificado";
    const produto  = linha.match(/Produto: ([^|]+)/)?.[1]?.trim()   || "não informado";
    const dados    = linha.match(/Dados: ([^|]+)/)?.[1]?.trim()     || "";
    const foneWA   = formatarTelefoneWA(telefone);

    await upsertLead(userId, { nome, stage: "fechando" });
    await notificarResponsavel(
      `COMPROVANTE PARA CONFERIR — ${nome} (${valor})`,
      `Cliente mandou comprovante de pagamento. CONFIRA A ENTRADA NO EXTRATO antes de liberar qualquer coisa.\n\n` +
      `Cliente: ${nome}\n` +
      `Telefone: ${telefone}\n` +
      `Produto: ${produto}\n` +
      `Valor no comprovante: ${valor}\n` +
      (dados ? `Outros dados do comprovante: ${dados}\n` : "") +
      `\nAbrir conversa: https://wa.me/${foneWA}\n\n` +
      `A ${AGENTE} confirmou apenas o RECEBIMENTO do print, não o pagamento, e segue atendendo. ` +
      `Print de comprovante se edita com facilidade: só considere pago o que aparecer no extrato.`
    );
    broadcastSSE("leads_update", { phone: userId });
    console.log("[COMPROVANTE_RECEBIDO]", nome, "|", valor, "| IA segue ativa");
  }

  // ─── DÚVIDA QUE A IA NÃO RESPONDE ──────────────────────────────────────────
  // "Confirmo e te retorno" é um compromisso assumido com o cliente. Sem isso
  // aqui era promessa vazia: ninguém ficava sabendo e o retorno nunca vinha.
  //
  // Pausa a IA, como o handoff e o suporte. Se um humano precisa entrar pra
  // responder, deixar a IA seguir falando recria o problema de duas vozes na
  // mesma conversa — e nenhuma das duas sabe o que a outra respondeu ao cliente.
  // Quem assume, conduz até o fim; reativação é manual pelo dashboard.
  if (reply.includes("[CONSULTAR_TIME]")) {
    const linha    = reply.match(/\[CONSULTAR_TIME\](.*)/)?.[1]?.trim() || "";
    const nome     = linha.match(/Cliente: ([^|]+)/)?.[1]?.trim()  || "Cliente";
    const telefone = linha.match(/Telefone: ([^|]+)/)?.[1]?.trim() || userId;
    const modelo   = linha.match(/Modelo: ([^|]+)/)?.[1]?.trim()   || "não informado";
    const pergunta = linha.match(/Pergunta: ([^|]+)/)?.[1]?.trim() || "não especificada";
    const foneWA   = formatarTelefoneWA(telefone);

    await db.query(`UPDATE leads SET olivia_ativa = FALSE WHERE phone = $1`, [userId]);

    await notificarResponsavel(
      `Cliente aguardando retorno — ${nome}`,
      `A ${AGENTE} não tinha essa informação e prometeu retorno ao cliente. Assuma a conversa.\n\n` +
      `Cliente: ${nome}\n` +
      `Telefone: ${telefone}\n` +
      `Modelo: ${modelo}\n` +
      `O que ele perguntou: ${pergunta}\n\n` +
      `Abrir conversa: https://wa.me/${foneWA}\n\n` +
      `A ${AGENTE} foi desativada nesse chat e o cliente está esperando. Responda direto pelo WhatsApp ` +
      `ou pelo painel. Para reativar a ${AGENTE} depois, use o toggle no dashboard.`
    );
    broadcastSSE("leads_update", { phone: userId });
    console.log("[CONSULTAR_TIME]", nome, "|", modelo, "|", pergunta, "| Olivia desativada para:", userId);
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

  // Grupo da empresa, quando configurado. Vai além do responsável porque tem
  // aviso que a equipe inteira precisa ver na hora, como comprovante de
  // pagamento chegando.
  if (NOTIFICACOES.grupo_empresa) {
    try {
      await sendZAPIMessage(NOTIFICACOES.grupo_empresa, assunto + "\n\n" + corpo);
      console.log("Notificacao enviada ao grupo da empresa.");
    } catch (err) {
      console.error("Erro ao notificar grupo:", err.response?.data || err.message);
    }
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
    const msgs = [{
      role: "user",
      content: `[FORMULÁRIO] Este cliente demonstrou interesse em: ${produtoClean || "nossos serviços"}. Inicie a conversa com uma mensagem de boas-vindas personalizada.`,
    }];

    let mensagemAbertura = null;
    try {
      const response = await chamarClaude({
        model:      "claude-sonnet-4-6",
        max_tokens: 300,
        system:     promptComData(AGENT_CONFIG.instructions, { lead: leadCtx }),
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
      .replace(/\[TRANSFERIR_ATENDENTE\].*/g, "")
      .replace(/\[CONSULTAR_TIME\].*/g, "")
      .replace(/\[COMPROVANTE_RECEBIDO\].*/g, "")
      .replace(/\[VENDA_FECHADA\].*/g, "")
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

// Apaga entradas de um client_id, opcionalmente só de um source_type. Existe
// porque o POST acima é INSERT puro, sem chave natural pra fazer upsert: rodar
// um script de seed duas vezes duplicava tudo silenciosamente, e conhecimento
// duplicado ocupa as vagas do topK com cópias da mesma coisa, empurrando para
// fora resultado que era relevante. Com isso o seed passa a limpar antes de
// escrever, e roda quantas vezes for preciso sem estragar a base.
app.delete("/admin/knowledge", async (req, res) => {
  const clientId   = req.query.clientId || req.query.client_id;
  const sourceType = req.query.sourceType || req.query.source_type;
  if (!clientId) return res.status(400).json({ error: "clientId obrigatorio (evita apagar a base de outro cliente por engano)" });
  try {
    const r = sourceType
      ? await db.query(`DELETE FROM knowledge_base WHERE client_id = $1 AND source_type = $2`, [clientId, sourceType])
      : await db.query(`DELETE FROM knowledge_base WHERE client_id = $1`, [clientId]);
    console.log("[KNOWLEDGE] Removidas", r.rowCount, "entradas de", clientId, sourceType ? "| tipo " + sourceType : "| TODOS os tipos");
    res.json({ ok: true, removidas: r.rowCount, client_id: clientId, source_type: sourceType || "(todos)" });
  } catch (err) {
    console.error("[KNOWLEDGE] Erro ao remover:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN: DIAGNÓSTICO DO RAG ───────────────────────────────────────────────
// Roda exatamente a mesma busca que a Olivia usa em tempo real, pra auditar
// o que seria recuperado para uma mensagem qualquer — sem precisar simular
// uma conversa inteira no WhatsApp. Útil pra checar cobertura e detectar
// buracos no conhecimento (query sem nenhum resultado acima do threshold).
// Força o resumo de um lead agora, sem esperar o gatilho de interações nem
// mandar mensagem pra pessoa. Serve pra conferir a mesclagem do perfil depois de
// mexer no extrator, e pra atualizar um lead na mão antes de um atendente
// assumir a conversa.
app.post("/admin/leads/:phone/resumir", async (req, res) => {
  const phone = sanitizePhone(req.params.phone);
  try {
    const antes = await db.query(`SELECT profile FROM leads WHERE phone = $1`, [phone]);
    if (!antes.rows[0]) return res.status(404).json({ error: "lead não encontrado" });

    await atualizarPerfilLead(phone);

    const depois = await db.query(`SELECT profile, last_summary FROM leads WHERE phone = $1`, [phone]);
    res.json({
      phone,
      antes:  antes.rows[0].profile,
      depois: depois.rows[0].profile,
      resumo: depois.rows[0].last_summary,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CONTATOS CONHECIDOS ─────────────────────────────────────────────────────
// Tira um retrato de quem já conversava com este número antes da IA entrar.
// Roda uma vez, na instalação. Quem estiver nessa lista não é atendido pela IA:
// é gente que já tem relação com o dono e que ele mesmo atende.
//
// Só vale se o cliente ligar ignorarContatosConhecidos no config — ligar isso
// num número que já operava com IA faria ela parar de responder aos leads que
// ela mesma vinha atendendo.
app.post("/admin/contatos/retrato", async (req, res) => {
  if (!EVOLUTION_URL || !EVOLUTION_API_KEY) {
    return res.status(503).json({ error: "Evolution não configurado" });
  }
  try {
    const r = await axios.post(
      `${EVOLUTION_URL}/chat/findChats/${EVOLUTION_INSTANCE}`,
      {},
      { headers: EVOLUTION_HEADERS(), timeout: 60000 }
    );
    const chats = Array.isArray(r.data) ? r.data : (r.data?.chats || []);
    let salvos = 0, grupos = 0;

    for (const c of chats) {
      const jid = c.remoteJid || c.id || c.jid || "";
      if (!jid) continue;
      if (jid.endsWith("@g.us")) { grupos++; continue; }   // grupo já é ignorado no webhook
      const phone = jid.replace(/@s\.whatsapp\.net$/, "").replace(/\D/g, "");
      if (!phone) continue;
      await db.query(
        `INSERT INTO contatos_conhecidos (phone, nome) VALUES ($1, $2) ON CONFLICT (phone) DO NOTHING`,
        [phone, c.pushName || c.name || null]
      );
      salvos++;
    }
    const total = await db.query(`SELECT COUNT(*)::int n FROM contatos_conhecidos`);
    console.log(`[CONTATOS] Retrato: ${salvos} conversas individuais, ${grupos} grupos ignorados`);
    res.json({ ok: true, conversas_lidas: chats.length, individuais: salvos, grupos_ignorados: grupos, total_na_base: total.rows[0].n });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Lista os grupos em que este número está, com o JID de cada um. É o que se
// põe em GRUPO_EMPRESA: o identificador não aparece no app do WhatsApp.
app.get("/admin/grupos", async (req, res) => {
  if (!EVOLUTION_URL || !EVOLUTION_API_KEY) return res.status(503).json({ error: "Evolution não configurado" });
  try {
    const r = await axios.get(
      `${EVOLUTION_URL}/group/fetchAllGroups/${EVOLUTION_INSTANCE}?getParticipants=false`,
      { headers: EVOLUTION_HEADERS(), timeout: 60000 }
    );
    const grupos = (Array.isArray(r.data) ? r.data : r.data?.groups || [])
      .map(g => ({ nome: g.subject || g.name || "(sem nome)", jid: g.id || g.remoteJid }))
      .filter(g => g.jid);
    res.json({ total: grupos.length, grupos, comoUsar: "copie o jid e ponha na env GRUPO_EMPRESA" });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.get("/admin/contatos", async (req, res) => {
  const r = await db.query(`SELECT COUNT(*)::int n FROM contatos_conhecidos`);
  const amostra = await db.query(`SELECT phone, nome FROM contatos_conhecidos ORDER BY created_at DESC LIMIT 10`);
  res.json({ total: r.rows[0].n, amostra: amostra.rows });
});

app.delete("/admin/contatos/:phone", async (req, res) => {
  const r = await db.query(`DELETE FROM contatos_conhecidos WHERE phone = $1`, [sanitizePhone(req.params.phone)]);
  res.json({ ok: true, removidos: r.rowCount });
});

// Transcreve um áudio enviado em base64, pelo mesmo caminho que o áudio do
// WhatsApp segue. Serve pra conferir a qualidade da transcrição com áudio real
// antes de depender dela em produção, e pra estudar conversas exportadas.
app.post("/admin/transcrever", async (req, res) => {
  const { base64, mimetype, nome } = req.body;
  if (!base64) return res.status(400).json({ error: "campo base64 obrigatorio" });
  if (!GROQ_API_KEY) return res.status(503).json({ error: "GROQ_API_KEY nao configurado" });
  try {
    const inicio = Date.now();
    const texto  = await transcreverBuffer(Buffer.from(base64, "base64"), mimetype || "audio/ogg", nome || "audio.ogg");
    res.json({ texto, ms: Date.now() - inicio, caracteres: texto.length });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

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
                       "ORCAMENTO_APROVADO", "VISITA_REAGENDADA", "VISITA_CANCELADA", "PRECISA_SUPORTE",
                       "TRANSFERIR_ATENDENTE", "CONSULTAR_TIME", "COMPROVANTE_RECEBIDO", "VENDA_FECHADA"];

// Tags que desativam a IA em produção. O playground precisa simular isso, senão
// dá falsa impressão nos fluxos de passagem: numa sessão de teste a IA disparou
// PRECISA_SUPORTE e continuou respondendo normalmente, o que em atendimento real
// não aconteceria — ela ficaria muda esperando o humano.
// COMPROVANTE_RECEBIDO fica FORA desta lista de propósito: ele avisa o time e a
// IA continua atendendo. Já esteve aqui por engano, e o playground passou a
// simular uma pausa que produção não faz — simulação mentindo sobre o
// comportamento real é pior que não simular.
const TAGS_QUE_PAUSAM = ["PRECISA_SUPORTE", "TRANSFERIR_ATENDENTE", "CONSULTAR_TIME", "VENDA_FECHADA"];
const playgroundPausados = new Set(); // sessionId que já bateu numa tag de pausa

app.get("/admin/playground/clients", (req, res) => {
  const fs = require("fs");
  // "_" no início marca módulo compartilhado (ex: _trailland-produtos), não é
  // um agente selecionável.
  const arquivos = fs.readdirSync(path.join(__dirname, "clients"))
    .filter(f => f.endsWith(".js") && !f.startsWith("_"))
    .map(f => f.replace(/\.js$/, ""));
  res.json({ clients: arquivos });
});

// Reiniciar limpa a memória e começa uma sessão nova, mas NÃO apaga o que foi
// gravado: a conversa anterior continua consultável pra análise depois.
app.post("/admin/playground/reset", (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) { playgroundSessions.delete(sessionId); playgroundPausados.delete(sessionId); }
  res.json({ ok: true, novaSessao: require("crypto").randomUUID() });
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

  // Não está em memória: pode ser sessão nova ou sessão que sobreviveu a um
  // deploy (o Map morre com o processo). Reidrata do banco antes de continuar,
  // senão a conversa "reinicia" do zero no meio do teste sem ninguém entender.
  if (!playgroundSessions.has(sessionId)) {
    let anterior = [];
    try {
      const r = await db.query(
        `SELECT role, content FROM playground_mensagens WHERE session_id = $1 ORDER BY created_at ASC LIMIT 60`,
        [sessionId]
      );
      anterior = r.rows.map(m => ({ role: m.role, content: m.content }));
      if (anterior.length) console.log(`[PLAYGROUND] sessão ${sessionId} reidratada do banco (${anterior.length} msgs)`);
    } catch (err) {
      console.error("[PLAYGROUND] Falha ao reidratar sessão:", err.message);
    }
    playgroundSessions.set(sessionId, anterior);
  }
  const history = playgroundSessions.get(sessionId);
  history.push({ role: "user", content: message });

  if (playgroundPausados.has(sessionId)) {
    db.query(
      `INSERT INTO playground_mensagens (session_id, client_slug, role, content) VALUES ($1, $2, 'user', $3)`,
      [sessionId, clientSlug, message]
    ).catch(() => {});
    return res.json({
      reply: "",
      pausado: true,
      aviso: "A IA está desativada nesta conversa — em atendimento real quem responde daqui em diante é o atendente humano. Use Reiniciar para simular um atendimento novo.",
      tagsDetectadas: [], knowledgeUsado: [],
    });
  }

  try {
    // Mesmo caminho da produção: histórico já com a mensagem atual, e o assunto
    // da conversa grudado na query pra não perder o modelo em conversa longa.
    // Agentes diferentes podem compartilhar a mesma base: o de fechamento vende
    // as mesmas máquinas do atendimento inicial, então lê o conhecimento de
    // "trailland" em vez do próprio slug.
    const kbId     = clientConfig.knowledgeClientId || clientSlug;
    const assunto  = assuntoDaConversa(history, await termosDeEscopo(kbId));
    const queryRAG = montarQueryRAG(history, 3, assunto);
    const knowledge = await buscarConhecimento(queryRAG, 4, 0.35, kbId);

    // Mesmo caminho da produção, pra que o teste reflita o comportamento real.
    const sistema = promptComData(clientConfig.instructions, { knowledge }, clientConfig.regrasCriticas);
    const response = (await gerarRespostaValidada({
      model:      "claude-sonnet-4-6",
      max_tokens: 1000,
      system:     sistema,
      messages:   mensagensComData(history),
    }, sistema)).resposta;

    const reply = (response.data.content?.[0]?.text || "").trim();

    // Resposta vazia acontece de vez em quando. Empilhar isso no histórico
    // corrompe a conversa daí pra frente: a IA passa a "ver" um turno em branco
    // dela mesma e perde o fio (num teste ela cotou a 270 FI e na mensagem
    // seguinte perguntou de qual modelo o cliente falava). Produção já
    // descartava; aqui não. Tira a mensagem do cliente do histórico também,
    // pra ele poder repetir sem duplicar o turno.
    if (!reply) {
      history.pop();
      console.warn("[PLAYGROUND] Claude devolveu resposta vazia. sessão:", sessionId);
      return res.json({
        reply: "",
        vazia: true,
        aviso: "O modelo devolveu resposta vazia. Manda a mensagem de novo — nada foi gravado nesse turno.",
        tagsDetectadas: [], knowledgeUsado: [],
      });
    }

    history.push({ role: "assistant", content: reply });

    let replyLimpo = reply;
    const tagsDetectadas = [];
    for (const tag of TAGS_GATILHO) {
      const re = new RegExp(`\\[${tag}\\].*`, "gs");
      if (re.test(reply)) tagsDetectadas.push(tag);
      replyLimpo = replyLimpo.replace(re, "").trim();
    }

    const ragUsado = knowledge.map(k => ({
      context: k.context, source_type: k.source_type,
      similarity: Math.round(k.similarity * 1000) / 1000,
    }));

    // Grava a troca. O que o RAG devolveu vai junto porque é isso que distingue
    // "respondeu errado" de "respondeu sem ter o dado" — foi assim que achamos
    // a resposta inventada de partida a kick, num turno em que a busca falhou.
    db.query(
      `INSERT INTO playground_mensagens (session_id, client_slug, role, content, rag_usado, tags)
       VALUES ($1, $2, 'user', $3, '[]'::jsonb, '[]'::jsonb),
              ($1, $2, 'assistant', $4, $5::jsonb, $6::jsonb)`,
      [sessionId, clientSlug, message, reply, JSON.stringify(ragUsado), JSON.stringify(tagsDetectadas)]
    ).catch(err => console.error("[PLAYGROUND] Falha ao gravar conversa:", err.message));

    const pausou = tagsDetectadas.some(t => TAGS_QUE_PAUSAM.includes(t));
    if (pausou) playgroundPausados.add(sessionId);

    const precosSuspeitos = conferirPrecos(replyLimpo, clientConfig.instructions);
    if (precosSuspeitos.length) console.warn("[PRECO][SUSPEITO]", precosSuspeitos, "|", replyLimpo.slice(0, 140));

    res.json({ reply: replyLimpo, tagsDetectadas, knowledgeUsado: ragUsado, pausouAgora: pausou, precosSuspeitos });
  } catch (err) {
    console.error("[PLAYGROUND] Erro:", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// Lista as conversas de teste gravadas, mais recentes primeiro.
app.get("/admin/playground/sessions", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT session_id, client_slug, COUNT(*)::int AS msgs,
              MIN(created_at) AS inicio, MAX(created_at) AS fim,
              (ARRAY_AGG(content ORDER BY created_at) FILTER (WHERE role = 'user'))[1] AS primeira
       FROM playground_mensagens
       GROUP BY session_id, client_slug
       ORDER BY MAX(created_at) DESC
       LIMIT $1`,
      [parseInt(req.query.limit) || 30]
    );
    res.json({ sessions: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Transcrição completa de uma conversa de teste, com o que o RAG devolveu turno
// a turno.
app.get("/admin/playground/sessions/:sessionId", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT role, content, rag_usado, tags, created_at
       FROM playground_mensagens WHERE session_id = $1 ORDER BY created_at ASC`,
      [req.params.sessionId]
    );
    res.json({ session_id: req.params.sessionId, mensagens: r.rows });
  } catch (err) {
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
// commit em que este processo subiu. Sem isso não dá pra saber se o deploy já
// pegou uma correção: o endpoint de saúde responde igual na versão velha e na
// nova, e eu já testei código antigo achando que era o novo mais de uma vez.
const BUILD = (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 7) || (() => {
  try { return require("child_process").execSync("git rev-parse --short HEAD").toString().trim(); }
  catch { return "desconhecido"; }
})();

app.get("/", (req, res) => res.json({
  build: BUILD,
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
