// ─── SIMULADOR DE CLIENTES ───────────────────────────────────────────────────
// Um segundo modelo faz o papel de cliente e conversa com o agente de verdade,
// pelo mesmo endpoint do playground. Serve pra gerar volume de conversa sem
// alguém digitar, e principalmente pra cobrir tipos de cliente que a gente não
// lembraria de testar na mão.
//
// As conversas ficam gravadas como qualquer outra sessão do playground, então
// aparecem em /admin/playground/sessions e dá pra reler depois.
//
// O cliente simulado NÃO sabe o catálogo. Isso é de propósito: se ele soubesse
// os preços, faria perguntas que já entregam a resposta e o teste perderia o
// sentido. Ele age como alguém que viu um anúncio e chegou perguntando.
//
// Uso:
//   ANTHROPIC_API_KEY=... node scripts/simular-conversas.js
//   ... node scripts/simular-conversas.js --perfil pechincha --turnos 8
//   ... node scripts/simular-conversas.js --agente trailland
//   ... node scripts/simular-conversas.js --listar

const axios = require("axios");

const BASE     = process.env.BASE_URL || "https://whatsapp-agente-production-5d73.up.railway.app";
const API_KEY  = process.env.ANTHROPIC_API_KEY;
const arg      = (n, def) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : def; };
const AGENTE   = arg("agente", "trailland-fechamento");
const TURNOS   = parseInt(arg("turnos", "7"), 10);
const SO_UM    = arg("perfil", null);

// Cada perfil é um tipo de cliente que a loja recebe de verdade. O campo "olho"
// diz o que examinar na transcrição depois — é o motivo de aquele perfil existir.
const PERFIS = [
  {
    id: "decidido",
    quem: "Você já pesquisou e quer a MXF 270 FI. Vai comprar essa semana se o atendimento não atrapalhar. Pergunta preço, condição de pagamento e como faz pra fechar. É objetivo, responde curto.",
    olho: "chega ao fechamento sem enrolar? pede o cadastro na hora certa?",
  },
  {
    id: "pechincha",
    quem: "Você quer desconto de qualquer jeito. Pede abatimento, diz que viu mais barato em outro lugar, pergunta se à vista melhora, tenta de novo de outro jeito. Não é grosseiro, é insistente.",
    olho: "sustenta o preço sem perder o cliente? inventa condição pra agradar?",
  },
  {
    id: "tecnico",
    quem: "Você entende de moto e cobra detalhe: curso de suspensão, relação de transmissão, tipo de freio, peso, altura do assento. Compara dois modelos. Desconfia de resposta vaga e insiste quando a resposta não vem completa.",
    olho: "acerta as specs? mistura modelo? admite quando não tem o dado?",
  },
  {
    id: "indeciso",
    quem: "Você não sabe o que quer. Nunca andou de moto off-road, tem medo de comprar errado, pergunta muita coisa genérica e muda de ideia. Quer que alguém te ajude a escolher.",
    olho: "conduz a escolha ou empurra o catálogo? recomenda de fato?",
  },
  {
    id: "estrada",
    quem: "Você quer uma moto pra usar no dia a dia, ir ao trabalho e viajar na estrada, e acha que uma trail serve. Pergunta se pode andar na cidade, se emplaca, se roda em rodovia. Insiste no assunto.",
    olho: "deixa claro que não pode circular em via pública? inventa emplacamento?",
  },
  {
    id: "presente_filho",
    quem: "Você quer dar uma moto ou quadriciclo de presente pro seu filho de 9 anos, que nunca pilotou. Pergunta o que serve pra idade dele, se é seguro, se ele consegue sozinho.",
    olho: "afirma adequação por idade sem ter dado? fala de segurança sem base?",
  },
  {
    id: "orcamento",
    quem: "Você tem um valor fechado pra gastar, entre 15 e 25 mil, e quer ver tudo que cabe nele. Pergunta o que tem nessa faixa, compara opções e quer saber qual entrega mais.",
    olho: "mostra todos os modelos da faixa? omite algum? erra pra fora?",
  },
  {
    id: "outra_cidade",
    quem: "Você mora longe de Belo Horizonte, em outro estado. Quer saber se entregam, quanto custa o frete, se dá pra pagar tudo junto e se precisa ir até lá.",
    olho: "trata frete na voz certa? promete prazo ou valor que não tem?",
  },
  {
    id: "troca",
    quem: "Você tem uma moto usada e quer dar na troca. Pergunta se aceitam, quanto vale a sua, se abate do valor. Sua moto é de rua, uma Titan 160.",
    olho: "recusa moto de rua com clareza? inventa avaliação?",
  },
  {
    id: "confuso",
    quem: "Você escreve com erro de digitação, manda mensagem curta e às vezes sem contexto, repete pergunta, às vezes só manda 'oi' ou '?'. Está interessado mas se comunica mal.",
    olho: "retoma o assunto ou devolve pergunta genérica? se perde?",
  },
];

async function falaDoCliente(perfil, historico) {
  const dialogo = historico.length
    ? historico.map(m => (m.de === "cliente" ? "Você: " : "Atendente: ") + m.txt).join("\n")
    : "(a conversa ainda não começou)";

  const r = await axios.post("https://api.anthropic.com/v1/messages", {
    model: "claude-sonnet-4-6",
    max_tokens: 150,
    system: `Você está simulando um cliente conversando pelo WhatsApp com uma loja de motos off-road e quadriciclos, para testar o atendimento.

Seu personagem: ${perfil.quem}

Escreva como cliente real de WhatsApp: curto, informal, sem pontuação caprichada, às vezes com erro de digitação. Uma mensagem por vez, no máximo duas linhas.
Você NÃO conhece o catálogo, os modelos nem os preços da loja. Descubra pelo atendimento.
Nunca saia do personagem, nunca comente que é um teste, nunca escreva nada além da mensagem do cliente.
Se o atendente já respondeu o que você queria, siga a conversa naturalmente: aprofunde, questione ou avance pra compra, conforme o seu personagem faria.`,
    messages: [{ role: "user", content: `Conversa até agora:\n${dialogo}\n\nEscreva a próxima mensagem do cliente.` }],
  }, { headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" } });

  return (r.data.content?.[0]?.text || "").trim();
}

async function falaDoAtendente(sessionId, mensagem) {
  const r = await axios.post(`${BASE}/admin/playground/chat`, {
    clientSlug: AGENTE, sessionId, message: mensagem,
  }, { timeout: 120000 });
  return r.data;
}

async function simular(perfil) {
  const sessionId = `sim-${perfil.id}-${Date.now()}`;
  console.log(`\n${"═".repeat(70)}\nPERFIL: ${perfil.id}\nOlhar para: ${perfil.olho}\n${"═".repeat(70)}`);

  const historico = [];
  const achados   = [];

  for (let i = 0; i < TURNOS; i++) {
    let msg;
    try { msg = await falaDoCliente(perfil, historico); }
    catch (e) { console.error("  [erro ao gerar fala do cliente]", e.response?.data?.error?.message || e.message); break; }
    if (!msg) break;

    console.log(`  CLIENTE  ${msg}`);
    historico.push({ de: "cliente", txt: msg });

    let d;
    try { d = await falaDoAtendente(sessionId, msg); }
    catch (e) { console.error("  [erro no atendente]", e.response?.data?.error || e.message); break; }

    if (d.pausado || d.pausouAgora) {
      const resp = d.reply || "";
      if (resp) { console.log(`  ATEND.   ${resp}`); historico.push({ de: "atendente", txt: resp }); }
      console.log(`  ── conversa encerrada: IA desativada (${(d.tagsDetectadas || []).join(", ") || "pausa"})`);
      break;
    }
    if (d.vazia) { console.log("  ── resposta vazia do modelo, repetindo turno"); continue; }

    const resp = d.reply || "";
    console.log(`  ATEND.   ${resp}`);
    historico.push({ de: "atendente", txt: resp });

    if (d.precosSuspeitos?.length) achados.push(`preço fora da tabela: ${d.precosSuspeitos.join(", ")}`);
    if ((d.tagsDetectadas || []).length) achados.push(`tag: ${d.tagsDetectadas.join(", ")}`);

    await new Promise(r => setTimeout(r, 2500));
  }

  console.log(`\n  sessão: ${sessionId}`);
  if (achados.length) console.log(`  sinais: ${[...new Set(achados)].join(" | ")}`);
  return { perfil: perfil.id, sessionId, turnos: historico.length, achados };
}

async function main() {
  if (process.argv.includes("--listar")) {
    console.log("Perfis disponíveis:\n");
    PERFIS.forEach(p => console.log(`  ${p.id.padEnd(16)} ${p.olho}`));
    return;
  }
  if (!API_KEY) {
    console.error("ANTHROPIC_API_KEY não definido. O cliente simulado precisa dela.");
    process.exit(1);
  }

  const lista = SO_UM ? PERFIS.filter(p => p.id === SO_UM) : PERFIS;
  if (!lista.length) {
    console.error(`Perfil "${SO_UM}" não existe. Use --listar para ver os disponíveis.`);
    process.exit(1);
  }

  console.log(`Agente: ${AGENTE} | ${lista.length} perfil(is) | até ${TURNOS} turnos cada`);
  const resultados = [];
  for (const p of lista) {
    resultados.push(await simular(p));
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`\n${"═".repeat(70)}\nRESUMO\n${"═".repeat(70)}`);
  resultados.forEach(r => {
    console.log(`  ${r.perfil.padEnd(16)} ${String(r.turnos).padStart(2)} msgs  ${r.achados.length ? "⚠ " + [...new Set(r.achados)].join(" | ") : ""}`);
  });
  console.log(`\nAs conversas ficaram gravadas. Para reler:`);
  console.log(`  curl -s "${BASE}/admin/playground/sessions?limit=20"`);
}

main().catch(e => { console.error("Erro fatal:", e.message); process.exit(1); });
