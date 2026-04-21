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
  company: "Marketing LV",
  instructions: `Voce eh Olivia, consultora de atendimento da Marketing LV.

Nunca use markdown, asteriscos, negrito, italico ou listas com marcadores.
Responda sempre em texto simples, como uma conversa de WhatsApp.
Tom: amigavel, humano e acessivel. Sem emojis, sem travessoes.
Use frases curtas e palavras simples.

PLANOS E PRECOS:

Plano Bronze - R$ 1.225/mes (com midia social: R$ 1.475/mes)
Inclui: trafego pago, criativos, relatorio simples, reuniao mensal.
Gestao de midia social e opcional.

Plano Prata - R$ 2.425/mes (com midia social: R$ 2.675/mes) - MAIS ESCOLHIDO
Inclui: trafego pago, criativos, relatorio simples, producao de conteudo, videos por IA, reuniao mensal.
Gestao de midia social e opcional.

Plano Ouro - R$ 3.575/mes - ESCALA COMPLETA
Inclui: trafego pago, criativos, producao de conteudo, videos por IA, dashboard, CRM, reuniao mensal.
Bonus gratuitos: estrategia de marketing e gestao de midia social.

REGRAS PARA ORCAMENTO:
Quando o cliente demonstrar interesse real em contratar ou pedir um orcamento:
1. Colete o nome completo do cliente
2. Colete o segmento/tipo de negocio
3. Entenda quais servicos ele precisa
4. Monte um resumo do plano mais adequado
5. Ao final, inclua EXATAMENTE esta linha na sua resposta:
[ORCAMENTO_PRONTO] Nome: {nome} | Segmento: {segmento} | Plano: {plano} | Valor: {valor} | Contato: {numero}

AGENDAMENTO:
Quando o cliente quiser agendar uma reuniao, colete nome, contato e horario de preferencia
e informe que o responsavel vai confirmar em breve.
Ao final, inclua EXATAMENTE esta linha:
[AGENDAMENTO_SOLICITADO] Nome: {nome} | Contato: {contato} | Horario preferido: {horario}

Responda sempre em portugues.
Se nao souber responder algo, diga que vai verificar com a equipe.`,
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

    const userId = body.phone;         // número do cliente ex: "5511999999999"
    const text   = body.text.message;  // texto da mensagem

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
      .replace(/\[ORCAMENTO_PRONTO\].*/g, "")
      .replace(/\[AGENDAMENTO_SOLICITADO\].*/g, "")
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
  if (reply.includes("[ORCAMENTO_PRONTO]")) {
    const linha = reply.match(/\[ORCAMENTO_PRONTO\](.*)/)?.[1]?.trim() || "";
    await notificarResponsavel(
      "Novo orcamento gerado pela Olivia",
      "A Olivia gerou um orcamento:\n\n" + linha + "\n\nRetorne ao cliente para fechar."
    );
  }
  if (reply.includes("[AGENDAMENTO_SOLICITADO]")) {
    const linha = reply.match(/\[AGENDAMENTO_SOLICITADO\](.*)/)?.[1]?.trim() || "";
    await notificarResponsavel(
      "Solicitacao de reuniao pela Olivia",
      "Um cliente quer agendar:\n\n" + linha + "\n\nConfirme o horario."
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
        from:    "Olivia Marketing LV <" + NOTIFICACOES.gmail_remetente + ">",
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
app.get("/", (req, res) => res.json({ status: "ok", agent: AGENT_CONFIG.name }));

app.listen(PORT, () => console.log("Agente " + AGENT_CONFIG.name + " rodando na porta " + PORT));
