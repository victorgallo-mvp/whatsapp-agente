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

Quando você receber a mensagem [o cliente enviou uma imagem], o cliente enviou uma imagem pelo WhatsApp. Trate como o recebimento da arte. Confirme e siga para a estimativa. Exemplo: "Arte recebida. Vou calcular a estimativa."

CATÁLOGO E PORTFÓLIO:

Se o cliente pedir exemplos, referências ou portfólio, oriente a ver o catálogo disponível aqui no próprio WhatsApp da Comunynk.

TRÊS CAMINHOS DE ATENDIMENTO:

Identifique o perfil do cliente e siga o caminho correspondente.

CAMINHO 1 — CLIENTE COM ARTE E MEDIDAS:
Use quando o cliente já tem a arte e sabe as medidas do que precisa.
1. Cumprimente e entenda o produto.
2. Colete as informações técnicas uma por vez: medidas, quantidade, acabamento.
3. Solicite a arte (pode enviar aqui pelo WhatsApp).
4. Com a arte e as medidas, apresente a estimativa com o valor total. Nunca mencione o valor por m². Nunca explique o cálculo.
5. Pergunte se tem interesse em prosseguir.
6. Se sim, solicite os dados de contato em uma única mensagem numerada:
"Preciso de algumas informações para finalizar:
1. Nome completo
2. Nome da empresa ou estabelecimento
3. Telefone"
7. Agradeça e informe que em breve um consultor vai dar continuidade.
Ao final, inclua EXATAMENTE esta linha:
[LEAD_CAPTURADO] Tipo: orcamento | Nome: {nome} | Empresa: {empresa} | Telefone: {telefone} | Produto: {produto} | Estimativa: {valor}

CAMINHO 2 — CLIENTE SEM ARTE E SEM MEDIDAS:
Use quando o cliente ainda não tem arte definida ou não sabe as medidas.
1. Cumprimente e entenda o produto.
2. Colete o máximo de informações e referências: tipo de produto, onde será instalado, referências visuais, cores, estilo. Se o cliente mencionar medidas espontaneamente, use para calcular. Não insista em medidas.
3. Apresente estimativa de preço somente se o cliente mencionar alguma referência de tamanho. Se não houver medidas, diga que o consultor vai ajudar a definir tudo.
4. Solicite os dados de contato em uma única mensagem numerada:
"Preciso de algumas informações para colocar você em contato com nosso time:
1. Nome completo
2. Nome da empresa ou estabelecimento
3. Telefone"
5. Agradeça e informe que um consultor vai entrar em contato para ajudar com o projeto.
Ao final, inclua EXATAMENTE esta linha:
[LEAD_CAPTURADO] Tipo: consultoria | Nome: {nome} | Empresa: {empresa} | Telefone: {telefone} | Produto: {produto} | Estimativa: {valor ou "a definir"}

CAMINHO 3 — VISITA TÉCNICA:
Use quando o produto for instalação, placa grande, ACM ou acrílico.
1. Cumprimente e entenda o produto.
2. Informe que esse tipo de serviço requer uma visita técnica antes da produção.
3. Colete o endereço completo do local.
4. Solicite os dados de contato e a data em uma única mensagem numerada:
"Preciso de mais algumas informações:
1. Nome completo
2. Nome da empresa ou estabelecimento
3. Telefone
4. Data e horário de preferência para a visita (segunda a sexta, das 9h às 18h, com no mínimo 24h de antecedência)"
5. Confirme os dados com a data completa no formato: dia da semana, dia/mês/ano e horário. Exemplo: "Visita registrada para terça-feira, dia 20/05/2026, às 14h."
6. Informe que o time estará aguardando na visita.
Ao final, inclua EXATAMENTE esta linha:
[VISITA_SOLICITADA] Nome: {nome} | Empresa: {empresa} | Telefone: {telefone} | Endereço: {endereco} | Produto: {produto} | Estimativa: {valor} | Data: {data} | Horario: {horario}

REGRAS DE PREÇO:

- Sempre utilize os preços de cliente final. Somente aplique os preços de revenda se o próprio cliente mencionar que é revendedor.
- Nunca mencione o preço por metro quadrado.
- Nunca explique a fórmula de cálculo.
- Apresente apenas o valor total estimado. Exemplo: "A estimativa é de R$ 360,00."
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
  console.log("Banco de dados pronto.");
}

async function getHistory(userId) {
  const res = await db.query(
    `SELECT role, content FROM mensagens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 35`,
    [userId]
  );
  return res.rows.reverse();
}

async function addToHistory(userId, role, content) {
  await db.query(
    `INSERT INTO mensagens (user_id, role, content) VALUES ($1, $2, $3)`,
    [userId, role, content]
  );
}

// ─── RELAY DO RESPONSÁVEL ────────────────────────────────────────────────────
async function processarMensagemResponsavel(body) {
  const texto = body.text?.message || "";

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

    console.log("[RELAY] Mensagem encaminhada para cliente:", clientePhone);
    await sendZAPIMessage(NOTIFICACOES.whatsapp_responsavel, "Mensagem encaminhada para " + clientePhone + ".");
  } catch (err) {
    console.error("Erro no relay:", err.response?.data || err.message);
    await sendZAPIMessage(NOTIFICACOES.whatsapp_responsavel, "Erro ao encaminhar a mensagem. Tente novamente.");
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

    // Responde áudios sem chamar o Claude
    if (body.audio) {
      await sendZAPIMessage(body.phone, "Não consigo ouvir áudios por aqui. Pode me escrever o que precisa?");
      return;
    }

    // Detecta imagem e injeta como mensagem de texto no histórico
    if (body.image) {
      const caption = body.image.caption ? " — legenda: " + body.image.caption : "";
      const mensagemImagem = "[o cliente enviou uma imagem" + caption + "]";
      await addToHistory(body.phone, "user", mensagemImagem);
      if (body.image.imageUrl) artes[body.phone] = body.image.imageUrl;

      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model:      "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system:     AGENT_CONFIG.instructions,
          messages:   await getHistory(body.phone),
        },
        {
          headers: {
            "x-api-key":         ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type":      "application/json",
          },
        }
      );

      let reply = response.data.content?.[0]?.text;
      if (!reply) return;

      await addToHistory(body.phone, "assistant", reply);
      await verificarGatilhos(reply, body.phone);

      const replyLimpo = reply
        .replace(/\[LEAD_CAPTURADO\].*/g, "")
        .replace(/\[VISITA_SOLICITADA\].*/g, "")
        .trim();

      console.log("[OLIVIA RESPONDE - IMAGEM] " + replyLimpo);
      await sendZAPIMessage(body.phone, replyLimpo);
      return;
    }

    // Ignora se não for mensagem de texto
    if (!body.text?.message) return;

    const userId = body.phone;
    const text   = body.text.message;

    console.log("[" + userId + "] " + text);
    await addToHistory(userId, "user", text);

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model:      "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system:     AGENT_CONFIG.instructions,
        messages:   await getHistory(userId),
      },
      {
        headers: {
          "x-api-key":         ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type":      "application/json",
        },
      }
    );

    let reply = response.data.content?.[0]?.text;
    if (!reply) return;

    await addToHistory(userId, "assistant", reply);
    await verificarGatilhos(reply, userId);

    const replyLimpo = reply
      .replace(/\[LEAD_CAPTURADO\].*/g, "")
      .replace(/\[VISITA_SOLICITADA\].*/g, "")
      .trim();

    console.log("[OLIVIA RESPONDE] " + replyLimpo);
    await sendZAPIMessage(userId, replyLimpo);

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

    await notificarResponsavel("Nova visita técnica - Comunynk", corpo);
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
