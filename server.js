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

FLUXO DE ATENDIMENTO:

1. Cumprimente e pergunte como pode ajudar.
2. Identifique o tipo de cliente: pergunte se é cliente final ou revenda. Isso define o preço.
3. Entenda o produto que o cliente precisa.
4. Colete as informações necessárias para calcular, uma por vez:
   - Tipo de produto
   - Medidas em metros quadrados (quando aplicável)
   - Quantidade (quando aplicável)
   - Acabamentos ou especificações (ex: com recorte, laminação, instalação)
5. Com todas as informações, apresente a estimativa de forma clara e simples.
6. Pergunte se o cliente tem interesse em prosseguir.
7. Se sim, colete nome completo e e-mail para o time comercial entrar em contato.
8. Agradeça e informe que em breve um consultor vai dar continuidade.
Ao final, inclua EXATAMENTE esta linha na sua resposta:
[LEAD_CAPTURADO] Nome: {nome} | Email: {email} | Produto: {produto} | Estimativa: {valor}

REGRAS IMPORTANTES:

- Nunca negocie preços. Se o cliente pedir desconto, diga: "Os valores são tabelados, mas o consultor pode verificar condições especiais para você."
- Nunca informe prazos exatos. Diga: "O prazo é confirmado pelo time após a análise do pedido."
- Nunca invente preços. Use apenas a tabela abaixo.
- Se o produto não estiver na tabela, diga: "Esse item preciso verificar com o time. Posso já deixar seu contato para um consultor te retornar?"
- Para produtos vendidos por m², pergunte as medidas e calcule: largura x altura x preço por m².
- Sempre arredonde estimativas para cima e deixe claro que é uma estimativa, o valor final é confirmado pelo time.

TABELA DE PREÇOS:

IMPRESSÕES (valor por m²):
Adesivo: R$ 70,00 (revenda) / R$ 90,00 (cliente final)
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
Wind banner: indisponível para revenda / R$ 350,00 por unidade (cliente final)
Instalação adesivo: R$ 30,00 (revenda e cliente final)
Instalação lona ilhós: R$ 30,00 (revenda e cliente final)

CARTÕES E FLYERS (por 1000 unidades, apenas cliente final):
Cartão visita 4x4 simples: R$ 130,00
Cartão visita 4x4 laminação fosca + verniz localizado: R$ 230,00
Flyer A5 4x4: R$ 336,00
Flyer A6 4x4: R$ 226,00

PLACAS (valor por m²):
Placa 2mm + adesivo: R$ 170,00 (revenda) / R$ 220,00 (cliente final)
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

    // Ignora mensagens enviadas pelo próprio número (evita loop)
    if (body.fromMe) return;

    // Ignora se não for mensagem de texto
    if (!body.text?.message) return;

    // Ignora mensagens de grupos
    if (body.isGroup) return;

    const userId = body.phone;        // número do cliente ex: "5511999999999"
    const text   = body.text.message; // texto da mensagem

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
    await notificarResponsavel(
      "Novo lead capturado pela Olivia - Comunynk",
      "A Olivia coletou um novo lead:\n\n" + linha + "\n\nRetorne ao cliente para dar continuidade."
    );
  }
}

// ─── NOTIFICACAO RESPONSAVEL ─────────────────────────────────────────────────
async function notificarResponsavel(assunto, corpo) {
  // E-mail (opcional)
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

  // WhatsApp para o responsável (opcional)
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
app.get("/", (req, res) => res.json({ status: "ok", agent: AGENT_CONFIG.name, company: AGENT_CONFIG.company }));

app.listen(PORT, () => console.log("Agente " + AGENT_CONFIG.name + " da " + AGENT_CONFIG.company + " rodando na porta " + PORT));
