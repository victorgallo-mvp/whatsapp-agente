// ─── SEED DE CONTORNO DE OBJEÇÃO — VILTRUM ───────────────────────────────────
// Entradas curtas e cirúrgicas para o RAG: "quando o lead diz X, a Olivia
// responde Y". Diferente do chunk-and-ingest.js (que quebra documentos longos
// em pedaços), aqui cada entrada já nasce do tamanho certo pra ser recuperada
// sozinha. O campo "context" deve soar como a frase real do lead — é ele que
// entra na busca por similaridade.
//
// Uso:
//   node scripts/seed-knowledge-viltrum.js            # indexa de verdade
//   node scripts/seed-knowledge-viltrum.js --dry-run  # só mostra, não envia

const axios = require("axios");

const BASE      = process.env.BASE_URL || "https://whatsapp-agente-production-5d73.up.railway.app";
const CLIENT_ID = "viltrum";
const DRY_RUN   = process.argv.includes("--dry-run");

const entries = [
  {
    source_type: "sales_script",
    context: "cliente diz que vai tentar fazer marketing sozinho ou com um freelancer",
    content: "Reconheça sem desmerecer: fazer sozinho ou com freelancer funciona até um certo ponto, mas cada peça (tráfego, redes, vídeo, atendimento) fica com um responsável diferente, sem uma visão única do resultado. A Viltrum entrega isso como um sistema integrado, com um único time respondendo pelo resultado. Pergunte o que mais pesa hoje: tempo, falta de know-how, ou dificuldade de coordenar os fornecedores.",
  },
  {
    source_type: "sales_script",
    context: "cliente já teve experiência ruim com outra agência de marketing",
    content: "Valide a frustração sem criticar a agência anterior. Pergunte especificamente o que não funcionou (falta de transparência, resultado fraco, comunicação ruim). Reforce que a Viltrum resolve exatamente esse ponto com o dashboard próprio em tempo real — o cliente acompanha sem depender de reunião mensal para saber o que está acontecendo com o investimento.",
  },
  {
    source_type: "sales_script",
    context: "cliente quer contratar só tráfego pago sem o resto do pacote",
    content: "Explique que tráfego pago sozinho tende a gerar volume sem qualificação — a dor mais comum é gastar em anúncio e sobrar pouco tempo pra separar curioso de comprador. Os planos da Viltrum já incluem esse filtro (qualificação e, no Completo, atendimento por IA). Se ainda assim o cliente quiser só tráfego, não force o pacote completo: informe que o time pode montar uma proposta e avaliar viabilidade.",
  },
  {
    source_type: "sales_script",
    context: "cliente acha caro ou diz que não tem orçamento agora",
    content: "Não negocie o valor do plano. Pergunte qual seria o investimento confortável pra começar. Lembre que cada dia sem geração de lead qualificado tem custo invisível — lead que esfria, tráfego mal aproveitado. Se o orçamento for reduzido, sugira o Essencial como porta de entrada, com upgrade pro Completo mais adiante.",
  },
  {
    source_type: "sales_script",
    context: "cliente pergunta se o serviço funciona para o nicho ou tipo de negócio dele",
    content: "Cite os cases reais como referência de segmentos variados: clínica odontológica (ROAS de 14,95x em 2 meses), indústria/distribuidora (leads a R$ 1,50), comunicação visual (atendimento 24h resolvendo gargalo operacional). Reforce que o método é o mesmo independente do nicho: entender a dor, estruturar tráfego e atendimento em cima dela. Se for um segmento muito específico, ofereça a call de 30 minutos para um diagnóstico direto.",
  },
  {
    source_type: "sales_script",
    context: "cliente pergunta prazo para ver resultado ou quando o retorno aparece",
    content: "Não prometa prazo exato. Diga que a curva de aprendizado da campanha fica visível no dashboard desde a primeira semana, mas resultado consistente costuma vir depois do primeiro ciclo de otimização (em torno de 30 a 60 dias, variando por segmento e verba). Reforce que isso é justamente o que a call de diagnóstico vai destravar: um cenário realista pro negócio dele.",
  },
  {
    source_type: "sales_script",
    context: "cliente desconfia de atendimento automatizado ou diz que não quer robô respondendo o cliente dele",
    content: "Reforce que a proposta da Olivia é justamente não parecer bot: ela entende o pedido, faz perguntas de qualificação e só aciona o humano quando necessário — o lead ganha resposta imediata, o dono do negócio só vê lead pronto. Convide para o próprio lead perceber isso na prática: ele está, nesse momento, conversando com a mesma Olivia que seria implementada pra ele.",
  },
  {
    source_type: "sales_script",
    context: "cliente diz que vai pensar ou decidir depois",
    content: "Não insista. Encerre cordialmente e deixe a porta aberta: 'Sem problema. Quando fizer sentido pra você, é só chamar.' Se o lead já demonstrou uma dor concreta na conversa, você pode oferecer a call de 30 minutos como algo sem compromisso, não como fechamento de venda — muitas vezes isso reduz a fricção de 'decidir agora'.",
  },
  {
    source_type: "sales_script",
    context: "cliente pergunta sobre fidelidade, contrato longo ou multa de cancelamento",
    content: "Se você não tiver essa informação confirmada, não invente prazo de fidelidade nem valor de multa. Diga que as condições contratuais são detalhadas na conversa com o time, e ofereça encaminhar para alguém confirmar os termos.",
  },
  {
    source_type: "sales_script",
    context: "cliente compara com preço de freelancer ou agência mais barata",
    content: "Não entre em disputa de preço. Reforce o que está incluso no valor: operação integrada com um único time responsável, dashboard de transparência em tempo real, e no plano Completo a Olivia rodando 24 horas. Pergunte o que mais importa pra decisão dele: preço isolado, ou resultado com previsibilidade.",
  },
  {
    source_type: "sales_script",
    context: "cliente acha que só precisa rodar mais anúncio ou aumentar o tráfego pago",
    content: "Anúncio tem que vender, mas só ele não basta. Se o lead chega e ninguém responde a tempo, o problema nunca foi o anúncio — foi quem responde depois. Explique que a Viltrum trabalha o funil inteiro, não só a atração: de nada adianta gerar mais mensagem se metade esfria esperando resposta.",
  },
  {
    source_type: "sales_script",
    context: "cliente acha que marketing é só postar mais nas redes sociais",
    content: "Marketing não é postagem, é operação. Postar mais sem estratégia, dados e um funil que conecta tráfego, conteúdo e atendimento gera engajamento sem gerar venda. Reforce que a Viltrum entrega o sistema completo — estratégia, IA, dados que guiam decisão e resultado mensurável — não só produção de conteúdo solto.",
  },
  {
    source_type: "sales_script",
    context: "cliente já usa vários fornecedores diferentes para tráfego, redes, site e atendimento",
    content: "Reconheça a dor de coordenar tudo isso sozinho: quando ninguém se responsabiliza pelo resultado geral, a culpa sempre sobra pro dono do negócio administrar. A Viltrum une tráfego, redes, vídeo, landing page e atendimento por IA num único time e numa única prestação de contas — um ponto de contato, um resultado só pelo qual alguém responde.",
  },
];

async function seed() {
  if (DRY_RUN) {
    entries.forEach((e, i) => {
      console.log(`\n[${i + 1}/${entries.length}] context: ${e.context}`);
      console.log(`content: ${e.content}`);
    });
    console.log(`\n[DRY RUN] ${entries.length} entradas, nada enviado.`);
    return;
  }

  const startAt = parseInt((process.argv.find(a => a.startsWith("--start=")) || "--start=1").split("=")[1], 10);
  const lista   = entries.slice(startAt - 1);
  console.log(`Enviando ${lista.length} de ${entries.length} entradas, a partir da #${startAt}.`);

  for (const entry of lista) {
    let ok = false;
    while (!ok) {
      try {
        await axios.post(`${BASE}/admin/knowledge`, { ...entry, client_id: CLIENT_ID });
        console.log("OK:", entry.context);
        ok = true;
      } catch (err) {
        // /admin/knowledge sempre responde 500, mesmo quando a causa é rate limit do
        // Voyage por trás — detecta pelo texto da mensagem, não pelo status HTTP.
        const msg = JSON.stringify(err.response?.data || err.message || "");
        if (err.response?.status === 429 || msg.includes("429")) {
          console.log("Rate limit, aguardando 15s...");
          await new Promise(r => setTimeout(r, 15000));
        } else {
          console.error("ERRO:", err.response?.data || err.message);
          ok = true;
        }
      }
    }
    await new Promise(r => setTimeout(r, 4000));
  }
  console.log("\nConcluído.");
}

seed();
