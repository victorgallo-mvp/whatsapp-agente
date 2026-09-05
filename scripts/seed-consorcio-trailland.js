// ─── BASE DE CONHECIMENTO: CONSÓRCIO — TRAILLAND ─────────────────────────────
// Consórcio aparece em 321 das 893 conversas sincronizadas (36%), mais que
// preço. Era o maior buraco de conhecimento do agente.
//
// O QUE ESTÁ AQUI E O QUE NÃO ESTÁ. Estas entradas cobrem como o consórcio
// funciona e qual a postura da loja. Elas NÃO trazem número: taxa, prazo, valor
// de carta e valor de parcela ficaram deliberadamente de fora, porque mudam com
// o tempo e porque consórcio é contrato — número errado não é resposta ruim, é
// problema jurídico do cliente. Esses casos são tratados no prompt, na seção
// que manda consultar em vez de responder.
//
// Origem: levantado de 497 mensagens da loja e revisado antes de indexar. Ver
// clients/RASCUNHO-CONSORCIO-TRAILLAND.md.
//
// Uso:
//   BASE_URL=https://<deploy-trailland> node scripts/seed-consorcio-trailland.js
//   ... --dry-run    só mostra o que enviaria

const axios = require("axios");

const BASE = process.env.BASE_URL;
if (!BASE) {
  // Sem default de propósito: o deploy da TrailLand e o de teste são URLs
  // diferentes, e semear no lugar errado contamina a base do outro cliente.
  console.error("Defina BASE_URL com o deploy do cliente. Ex.:");
  console.error("  BASE_URL=https://whatsapp-agente-production-fc65.up.railway.app node scripts/seed-consorcio-trailland.js");
  process.exit(1);
}
const DRY = process.argv.includes("--dry-run");

// Contexto compartilhado: é o texto que vira embedding junto com o content, e
// precisa soar como a pergunta do cliente, não como instrução pra IA.
const CTX = "consórcio, carta de crédito, parcela mensal, como funciona, âncora consórcios";

const entries = [
  {
    source_type: "consorcio",
    context: "como funciona o consórcio, me explica o consórcio, quero saber sobre consórcio, vocês trabalham com consórcio, tem consórcio, como é o consórcio de vocês, consórcio de moto",
    content: "Sim, a TrailLand trabalha com consórcio, pela Âncora Consórcios. Funciona assim: o cliente entra num grupo de participantes e paga uma parcela mensal. Todo mês há uma assembleia em que alguém é contemplado, por sorteio ou por lance, e recebe a carta de crédito para comprar a moto ou o quadriciclo na loja. Não tem juro como no financiamento: o que se paga além do valor do bem é a taxa de administração, que remunera a gestão do grupo. A contemplação não tem data garantida, então é caminho para quem tem prazo, não para quem quer sair pilotando essa semana. Os valores (parcela, prazo, carta e taxa) dependem do plano e quem passa é o consultor.",
    metadata: { escopo: "Consórcio — visão geral", termos: ["consórcio", "consorcio", "consorio", "consócio"] },
  },
  {
    source_type: "consorcio",
    context: `com quem é o consórcio da trailland, qual administradora, ${CTX}`,
    content: "A TrailLand trabalha com a Âncora Consórcios (Âncora Administradora, de Franca/SP). O consórcio não é da loja: a TrailLand é o ponto de venda, e quem faz a gestão do grupo, realiza as assembleias e libera a carta de crédito é a Âncora. Isso importa quando o cliente pergunta de processo interno, prazo de análise ou documentação — parte disso é da administradora, não da loja.",
    metadata: { escopo: "Administradora do consórcio", termos: ["consórcio", "consorcio", "âncora", "ancora", "administradora"] },
  },
  {
    source_type: "consorcio",
    context: `o que é a taxa de administração do consórcio, é juro, ${CTX}`,
    content: "A taxa de administração é o valor cobrado pela Âncora para formar e gerir o grupo de consórcio: organizar as assembleias, realizar as contemplações, emitir boletos e cuidar da gestão financeira. Ela NÃO é juro, é o preço do serviço de administração. Incide sobre o valor total da carta de crédito, e não sobre o saldo devedor, e varia conforme o plano contratado. Explicar o conceito é permitido. Informar o percentual não: esse número muda e tem que ser confirmado com o time.",
    metadata: { escopo: "Taxa de administração", termos: ["taxa de administração", "taxa administrativa", "taxa", "juros do consórcio"] },
  },
  {
    source_type: "consorcio",
    context: `a parcela do consórcio aumenta, reajuste anual, ${CTX}`,
    content: "O reajuste do consórcio Âncora acontece no mês de aniversário do grupo. Ele serve para a carta de crédito manter o poder de compra frente à inflação, ou seja, para que o valor continue comprando a mesma moto lá na frente. É aplicado sobre o saldo devedor e reflete no valor das parcelas seguintes. Então sim, a parcela pode subir ao longo do plano, e isso é normal e previsto em contrato, não é cobrança extra.",
    metadata: { escopo: "Reajuste anual", termos: ["reajuste", "reajusta", "aumenta a parcela", "parcela aumenta", "correção", "inflação"] },
  },
  {
    source_type: "consorcio",
    context: `como sou contemplado no consórcio, sorteio, lance, assembleia, ${CTX}`,
    content: "A contemplação acontece de duas formas: por sorteio na assembleia mensal, ou por lance. O lance é uma oferta que o cliente faz para antecipar a contemplação em vez de depender só da sorte do sorteio. Se o lance for vencedor, o valor ofertado abate parcelas. Depois de contemplado, o cliente escolhe o que fazer com esse abatimento: reduzir o valor da parcela mensal, ou diminuir a quantidade de meses que faltam.",
    metadata: { escopo: "Contemplação", termos: ["contemplado", "contemplação", "contempla", "sorteio", "sorteado", "lance", "assembleia"] },
  },
  {
    source_type: "consorcio",
    context: `precisa de fiador no consórcio, avalista, garantia, ${CTX}`,
    content: "A Âncora pode exigir fiador no momento da contemplação. Não é automático para todo mundo, é critério da administradora conforme a análise. Nunca afirmar ao cliente que não vai precisar de fiador: isso é decisão da Âncora, e prometer o contrário gera frustração exatamente na hora em que ele já está comprometido com o plano.",
    metadata: { escopo: "Fiador", termos: ["fiador", "avalista", "garantia", "precisa de fiador"] },
  },
  {
    source_type: "consorcio",
    context: `plano 70, parcela reduzida do consórcio, ${CTX}`,
    content: "O plano 70% (também chamado de parcela reduzida ou Plano Renovação 70) é uma modalidade em que o cliente paga mensalidades calculadas sobre 70% do valor do bem até ser contemplado. Serve para quem quer entrar com parcela menor no começo. Os valores concretos desse plano precisam ser confirmados com o time.",
    metadata: { escopo: "Plano 70%", termos: ["plano 70", "70%", "parcela reduzida", "renovação 70"] },
  },
  {
    source_type: "consorcio",
    context: `já tenho consórcio de outra administradora, posso usar na trailland, ${CTX}`,
    content: "Se o cliente já tem consórcio de outra administradora e a carta cobre veículo off-road, a TrailLand aceita. A loja fornece o que for necessário do lado dela: dados do veículo, chassi, modelo e nota fiscal. Mas a parte burocrática com a administradora fica com o cliente e o representante dele, porque a TrailLand não tem acesso ao processo de outra empresa. Deixar isso claro desde o começo evita a expectativa de que a loja vai resolver tudo.",
    metadata: { escopo: "Consórcio de outra administradora", termos: ["outro consórcio", "outra administradora", "meu consórcio", "já tenho consórcio", "carta de outro"] },
  },
  {
    source_type: "consorcio",
    context: `acessórios entram no consórcio, capacete, protetor, ${CTX}`,
    content: "Acessórios podem ser incluídos no valor da carta de crédito do consórcio. Ou seja, o cliente não precisa comprar os acessórios à parte: dá para dimensionar a carta contemplando moto mais acessórios. Quais itens e quanto isso muda o valor da carta precisa ser confirmado com o time.",
    metadata: { escopo: "Acessórios na carta", termos: ["acessório", "acessórios", "acessorios", "capacete", "entra na carta"] },
  },
  {
    source_type: "consorcio",
    context: `consórcio vale a pena se eu quero a moto rápido, urgência, ${CTX}`,
    content: "Consórcio não serve para quem tem pressa: a contemplação depende de sorteio ou de lance, e não há data garantida para o cliente sair com a moto. Se o cliente quer a moto com urgência, o caminho honesto é o cartão, e é isso que se recomenda a ele, mesmo que o consórcio pareça mais barato. Consórcio é para quem tem prazo e quer planejar. Dizer isso com franqueza vale mais que empurrar o consórcio: cliente que entra achando que vai receber rápido cancela depois.",
    metadata: { escopo: "Consórcio x urgência", termos: ["consórcio", "consorcio", "urgência", "urgente", "pressa", "quando recebo", "quanto tempo"] },
  },
];

async function main() {
  console.log(`${entries.length} entradas de consórcio para ${BASE}`);
  if (DRY) {
    entries.forEach(e => console.log(`\n[${e.metadata.escopo}] termos: ${e.metadata.termos.join(", ")}\n  ${e.content.slice(0, 150)}...`));
    return;
  }
  let ok = 0, falhou = 0;
  for (const e of entries) {
    try {
      await axios.post(`${BASE}/admin/knowledge`, { ...e, client_id: "trailland" }, { timeout: 60000 });
      console.log("OK:", e.metadata.escopo);
      ok++;
    } catch (err) {
      console.error("FALHOU:", e.metadata.escopo, "|", err.response?.data?.error || err.message);
      falhou++;
    }
    await new Promise(r => setTimeout(r, 700));
  }
  console.log(`\nConcluído. ${ok} indexadas, ${falhou} falharam.`);
}

main().catch(e => { console.error("Erro:", e.message); process.exit(1); });
