require("dotenv").config();
const express    = require("express");
const axios      = require("axios");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const ZAPI_INSTANCE_ID   = process.env.ZAPI_INSTANCE_ID;
const ZAPI_TOKEN         = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT_TOKEN  = process.env.ZAPI_CLIENT_TOKEN;
const PORT               = process.env.PORT || 3000;

// Google Calendar (configurar depois)
const GOOGLE_CALENDAR_ENABLED = process.env.GOOGLE_CALENDAR_ENABLED === "true";
const GOOGLE_CLIENT_EMAIL     = process.env.GOOGLE_CLIENT_EMAIL     || "";
const GOOGLE_PRIVATE_KEY      = process.env.GOOGLE_PRIVATE_KEY      || "";
const GOOGLE_CALENDAR_ID      = process.env.GOOGLE_CALENDAR_ID      || "";

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
Tom: cordial, humanizado e direto. Sem emojis. Sem travessões. Ortografia perfeita.
Use frases curtas. Nunca escreva parágrafos longos.
Faça uma pergunta por vez. Nunca faça duas perguntas na mesma mensagem.

ÁUDIOS:

Você não consegue ouvir áudios. Se o cliente enviar um áudio, peça desculpas de forma gentil e humanizada e solicite que ele escreva a mensagem. Exemplo: "Desculpe, infelizmente não consigo ouvir áudios por aqui. Pode me escrever o que precisa? Fico à disposição."

IMAGENS:

Quando você receber a mensagem [o cliente enviou uma imagem], significa que o cliente enviou uma imagem pelo WhatsApp. Você não consegue ver o conteúdo da imagem, mas deve tratá-la como o recebimento da arte. Confirme o recebimento de forma natural e siga para a estimativa. Exemplo: "Recebi a arte, obrigada. Deixa eu calcular a estimativa para você."

FLUXO DE ATENDIMENTO:

1. Cumprimente e pergunte como pode ajudar.
2. Identifique o tipo de cliente: pergunte se é cliente final ou revenda.
3. Entenda o produto que o cliente precisa.
4. Colete as informações necessárias uma por vez: tipo de produto, medidas, quantidade, acabamentos.
5. Peça a arte antes de calcular a estimativa. Diga que ela pode ser enviada aqui mesmo pelo WhatsApp.
6. Após receber a arte ou confirmação de que ela será enviada, apresente a estimativa com o valor final. Nunca mencione o preço por metro quadrado. Nunca explique a fórmula de cálculo. Apresente apenas o valor total estimado.
7. Pergunte se o cliente tem interesse em prosseguir.
8. Se o produto exigir visita técnica (instalação, placas grandes, ACM ou acrílico), siga o fluxo de agendamento abaixo.
9. Se não exigir visita, colete nome completo e e-mail para o time comercial entrar em contato.
10. Agradeça e informe que em breve um consultor vai dar continuidade.
Ao final, inclua EXATAMENTE esta linha:
[LEAD_CAPTURADO] Nome: {nome} | Email: {email} | Produto: {produto} | Estimativa: {valor}

FLUXO DE AGENDAMENTO DE VISITA TÉCNICA:

Quando o produto for instalação, placa grande, ACM ou acrílico, após o cliente confirmar interesse:
1. Informe que esse tipo de serviço requer uma visita técnica antes da produção.
2. Colete o endereço completo do local.
3. Colete nome completo e e-mail para confirmação.
4. Envie o link do Calendly para o cliente escolher o melhor horário: https://calendly.com/victor-gallo-loreleibd/30min
5. Informe que o atendimento é de segunda a sexta, das 9h às 18h, e que o agendamento deve ter no mínimo 24 horas de antecedência.
6. Agradeça e diga que o time estará aguardando na visita.
Ao final, inclua EXATAMENTE esta linha:
[VISITA_SOLICITADA] Nome: {nome} | Email: {email} | Endereço: {endereco} | Produto: {produto} | Estimativa: {valor}

REGRAS DE PREÇO:

- Nunca mencione o preço por metro quadrado.
- Nunca explique a fórmula de cálculo.
- Apresente apenas o valor total estimado. Exemplo: "A estimativa para esse serviço é de R$ 360,00."
- Sempre deixe claro que é uma estimativa e que o valor final é confirmado pelo time.
- Nunca negocie preços. Se o cliente pedir desconto, diga: "Os valores são tabelados, mas o consultor pode verificar condições especiais para você."
- Nunca informe prazos exatos. Diga: "O prazo é confirmado pelo time após a análise do pedido."
- Se o produto não estiver na tabela, diga: "Esse item preciso verificar com o time. Posso já deixar seu contato para um consultor te retornar?"

ARGUMENTOS DE VENDA:

Use apenas quando houver uma objeção real do cliente. Nunca use de forma aleatória ou em todo atendimento.
- Se o cliente demonstrar preocupação com saúde ou segurança: "Os materiais que utilizamos usam tinta atóxica, sem risco para pessoas ou ambientes."
- Se o cliente questionar durabilidade ou qualidade: "Nossos produtos têm garantia de até 5 anos."

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

const conversations = {};
const artes = {}; // armazena URL da última imagem enviada por usuário

function getHistory(userId) {
  if (!conversations[userId]) conversations[userId] = [];
  return conversations[userId];
}

function addToHistory(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content });
  if (history.length > 20) history.splice(0, history.length - 20);
}

// ─── WEBHOOK Z-API ───────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;

    if (body.fromMe) return;
    if (body.isGroup) return;

    // Responde áudios sem chamar o Claude
    if (body.audio) {
      await sendZAPIMessage(body.phone, "Desculpe, infelizmente não consigo ouvir áudios por aqui. Pode me escrever o que precisa? Fico à disposição.");
      return;
    }

    // Detecta imagem e injeta como mensagem de texto no histórico
    if (body.image) {
      const caption = body.image.caption ? " — legenda: " + body.image.caption : "";
      const mensagemImagem = "[o cliente enviou uma imagem" + caption + "]";
      addToHistory(body.phone, "user", mensagemImagem);
      if (body.image.imageUrl) artes[body.phone] = body.image.imageUrl;

      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model:      "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system:     AGENT_CONFIG.instructions,
          messages:   getHistory(body.phone),
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

      addToHistory(body.phone, "assistant", reply);
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
    addToHistory(userId, "user", text);

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model:      "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system:     AGENT_CONFIG.instructions,
        messages:   getHistory(userId),
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

    addToHistory(userId, "assistant", reply);
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

// ─── GATILHOS ────────────────────────────────────────────────────────────────
async function verificarGatilhos(reply, userId) {
  if (reply.includes("[LEAD_CAPTURADO]")) {
    const linha = reply.match(/\[LEAD_CAPTURADO\](.*)/)?.[1]?.trim() || "";
    const corpo = "A Olivia coletou um novo lead:\n\n" + linha + "\n\nRetorne ao cliente para dar continuidade.";
    await notificarResponsavel("Novo lead capturado pela Olivia - Comunynk", corpo);

    // Encaminha a arte como imagem direta, se houver
    const arteUrl = artes[userId];
    if (arteUrl && NOTIFICACOES.whatsapp_responsavel !== "PREENCHA_AQUI") {
      try {
        await axios.post(
          `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-image`,
          {
            phone:   NOTIFICACOES.whatsapp_responsavel,
            image:   arteUrl,
            caption: "Arte do cliente: " + (linha.match(/Nome: ([^|]+)/)?.[1]?.trim() || ""),
          },
          {
            headers: {
              "Client-Token": ZAPI_CLIENT_TOKEN,
              "Content-Type": "application/json",
            },
          }
        );
        console.log("Arte encaminhada para o responsavel.");
      } catch (err) {
        console.error("Erro ao encaminhar arte:", err.response?.data || err.message);
      }
    }
  }

  if (reply.includes("[VISITA_SOLICITADA]")) {
    const linha = reply.match(/\[VISITA_SOLICITADA\](.*)/)?.[1]?.trim() || "";

    if (GOOGLE_CALENDAR_ENABLED) {
      await criarEventoCalendar(linha);
    }

    await notificarResponsavel(
      "Nova visita técnica solicitada pela Olivia - Comunynk",
      "A Olivia registrou uma solicitação de visita técnica:\n\n" + linha + "\n\nConfirme a disponibilidade com o cliente."
    );
  }
}

// ─── GOOGLE CALENDAR (ativar depois) ─────────────────────────────────────────
async function criarEventoCalendar(dadosVisita) {
  if (!GOOGLE_CALENDAR_ENABLED) return;

  try {
    // Implementação futura com googleapis
    // Variáveis necessárias no Railway:
    // GOOGLE_CALENDAR_ENABLED=true
    // GOOGLE_CLIENT_EMAIL=sua-service-account@projeto.iam.gserviceaccount.com
    // GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...
    // GOOGLE_CALENDAR_ID=id-do-calendario@group.calendar.google.com
    console.log("[GOOGLE CALENDAR] Visita a agendar:", dadosVisita);
  } catch (err) {
    console.error("Erro Google Calendar:", err.message);
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

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({
  status: "ok",
  agent: AGENT_CONFIG.name,
  company: AGENT_CONFIG.company,
  calendar: GOOGLE_CALENDAR_ENABLED ? "ativo" : "pendente configuracao",
}));

app.listen(PORT, () => console.log("Agente " + AGENT_CONFIG.name + " da " + AGENT_CONFIG.company + " rodando na porta " + PORT));
