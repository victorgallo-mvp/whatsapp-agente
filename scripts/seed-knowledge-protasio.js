// ─── BASE DE CONHECIMENTO — PROTÁSIO MOTOS ───────────────────────────────────
// Os FATOS da loja saem do prompt e passam a viver aqui. A divisão é a mesma do
// resto do repo: comportamento (tom, o que ela não pode afirmar, quando emitir
// tag, como pedir o CPF) fica no prompt, porque vale em toda mensagem; fato
// (preço de transferência, endereço, garantia, oficinas) vem para cá, porque só
// é consultado quando alguém pergunta e porque muda sem avisar — e mudar aqui
// não exige deploy.
//
// FICA NO PROMPT, DE PROPÓSITO: a lista de cidades com frete grátis. Ela é a
// única que, se a recuperação falhar, produz uma afirmação ERRADA em vez de um
// "não sei" — em teste a Dani já disse que Florianópolis tinha frete grátis, e
// não tem. Enquanto for assim, ela não sai do prompt.
//
// O CAMPO `context` É A FALA DO CLIENTE, NÃO A DA LOJA. O embedding é gerado
// priorizando o context (ver /admin/knowledge no server.js), então ele é escrito
// com as palavras que a pessoa usa no WhatsApp — "a transferência tá inclusa?",
// "tem oficina na minha cidade?" —, não com o jargão interno. Chunk que embeda
// a linguagem da loja não casa com a pergunta de quem escreve.
//
// Uso:
//   BASE_URL=https://<deploy-protasio> node scripts/seed-knowledge-protasio.js
//   node scripts/seed-knowledge-protasio.js --dry-run

const axios = require("axios");

const BASE      = process.env.BASE_URL || "";
const CLIENT_ID = process.env.KB_CLIENT_ID || "protasio";
const DRY_RUN   = process.argv.includes("--dry-run");

const entries = [
  {
    source_type: "documentacao",
    context: "a transferência tá inclusa no preço? quanto custa pra transferir a moto pro meu nome? tem que pagar documentação? qual o valor da papelada, do detran?",
    content:
      "Transferência da moto: a taxa é cobrada pelo DETRAN e NÃO está inclusa no valor da moto. São R$ 700 no Detran do Rio Grande do Sul e R$ 600 no Detran de Santa Catarina. " +
      "A taxa de transferência pode ser parcelada em até 3x sem juros no cartão, em mais vezes com a taxa da maquininha, ou entrar junto no valor financiado. " +
      "SOBRE O DESPACHANTE, A CONDIÇÃO É OBRIGATÓRIA E NUNCA SE OMITE: o serviço de despachante é cortesia da loja APENAS para quem é de Porto Alegre e região metropolitana ou de Torres e região até 50 km. " +
      "Para quem é de fora dessas duas áreas o despachante existe, mas NÃO é de graça. Nunca diga \"o despachante é por nossa conta\" sem dizer para quem | em teste isso saiu solto para um cliente e vira promessa que a loja não fez.",
    metadata: { escopo: "transferência e documentação" },
  },
  {
    source_type: "documentacao",
    context: "quem resolve a papelada? a documentação demora? vocês têm despachante? como funciona a transferência em porto alegre?",
    content:
      "A loja tem despachante credenciado em Porto Alegre e região metropolitana para agilizar toda a burocracia documental de transferência. " +
      "Nenhuma moto é entregue com débito no Detran, e toda seminova sai com a documentação resolvida.",
    metadata: { escopo: "despachante" },
  },
  // Dois chunks de propósito. O embedding é gerado com context + content juntos,
  // então conteúdo longo dilui a pergunta: com a lista das dez cidades no mesmo
  // chunk, "se der problema preciso voltar até Torres?" não recuperava nem em
  // sexto lugar, perdendo para pós-venda e até para "endereço". O primeiro chunk
  // responde a OBJEÇÃO e é curto; o segundo carrega a LISTA.
  {
    source_type: "pos_venda",
    context: "se der problema na moto vou ter que voltar até torres? e a revisão, preciso voltar aí? moro longe, como faço a manutenção depois? tem assistência perto de mim?",
    content:
      "Não precisa voltar a Torres para revisar nem para resolver problema: a loja tem rede de oficinas autorizadas em várias cidades do RS e de SC.",
    metadata: { escopo: "oficinas autorizadas" },
  },
  {
    source_type: "pos_venda",
    context: "em quais cidades vocês têm oficina autorizada? tem oficina em caxias, em porto alegre, em criciúma? qual a lista de oficinas?",
    content:
      "Oficinas autorizadas, e esta lista é fechada — são estas dez cidades e mais nenhuma, agrupadas por região: " +
      "Litoral norte do RS: Torres, Três Cachoeiras, Tramandaí. " +
      "Grande Porto Alegre: Porto Alegre, Canoas, Gravataí, Viamão. " +
      "Serra gaúcha: Garibaldi. " +
      "Sul de Santa Catarina: Araranguá, Balneário Gaivota. " +
      "Se a cidade da pessoa não está nessas dez, cite a da região dela e nunca afirme que a dela tem. Para quem é de Santa Catarina a referência é Araranguá ou Balneário Gaivota, nunca Porto Alegre.",
    metadata: { escopo: "oficinas autorizadas (lista)" },
  },
  {
    source_type: "garantia",
    context: "a moto tem garantia? quanto tempo de garantia? e se der problema depois que eu comprar? a moto é revisada?",
    content:
      "Toda seminova sai revisada e com a documentação resolvida, e é entregue com o tanque cheio. " +
      "A garantia de seminova é de três meses, conforme o Código de Defesa do Consumidor. " +
      "Nenhuma moto é entregue com débito no Detran.",
    metadata: { escopo: "garantia e estado da moto" },
  },
  {
    source_type: "entrega",
    context: "vocês entregam? moro longe, dá pra comprar sem ir aí? quanto custa o frete? entregam na minha cidade?",
    content:
      "A loja entrega em todo o Brasil. O frete é grátis em um raio de até 200 km da loja; fora desse raio a entrega também é feita, com um valor acessível, só o custo da gasolina. " +
      "Para quem compra de longe e não vem à loja, o vendedor mostra a moto ao vivo por videochamada, por dentro e por fora. " +
      "O processo completo de compra a distância está neste documento: https://docs.google.com/document/d/17ygiUlLUiFQrvO5oSlbFKGdBRl5HuvS4RzYc3TZCJHM/edit?usp=sharing",
    metadata: { escopo: "entrega e frete" },
  },
  {
    source_type: "institucional",
    context: "onde fica a loja? qual o endereço de vocês? onde vocês ficam? em que cidade vocês ficam? como chego aí? me manda a localização",
    content:
      "A loja fica na Av. do Riacho, 1255, sala 11, Centro, Torres, RS, no litoral norte do Rio Grande do Sul. " +
      "Localização no mapa: https://hubly.work/Localização-ProtásioMotos",
    metadata: { escopo: "endereço" },
  },
  {
    source_type: "institucional",
    context: "que horas vocês abrem? qual o horário de funcionamento? abre sábado? abre no domingo? fecha pro almoço? até que horas fica aberto?",
    content:
      "Horário de funcionamento: segunda a sexta das 8h às 18h, sem fechar ao meio-dia. Sábado das 8h às 12h. Domingo não abre.",
    metadata: { escopo: "horário de funcionamento" },
  },
  {
    source_type: "pagamento",
    context: "aceita cartão? parcela em quantas vezes? aceita boleto? trabalham com consórcio? como posso pagar?",
    content:
      "Formas de pagamento aceitas: à vista, cartão de crédito, financiamento e moto na troca. " +
      "No cartão a loja parcela em até 21x, com a taxa da maquininha por conta do cliente — a taxa existe e entra no valor, e quem fecha o valor exato é o vendedor. " +
      "Para a loja, cartão é pagamento à vista: ela recebe de uma vez e quem parcela é a operadora, então quem paga no cartão não passa por análise de crédito. " +
      "A loja NÃO trabalha com consórcio e NÃO aceita boleto, cheque nem promissória.",
    metadata: { escopo: "formas de pagamento" },
  },
  {
    source_type: "troca",
    context: "dá pra avaliar minha moto por foto? preciso levar a moto até aí pra vocês avaliarem? como funciona a avaliação da moto que eu vou dar na troca? quanto vocês pagam na minha moto?",
    content:
      "Avaliação da moto da troca: pode ser feita POR FOTO, a moto não precisa ir até a loja para ser avaliada. " +
      "O que é preciso para avaliar: fotos da moto (frente, lado e painel), modelo, ano, quilometragem e se o documento está em dia e sem débito. " +
      "Quem avalia e define o valor é a loja, não a atendente: ela junta as fotos e os dados e passa para avaliação. Nenhum valor, nem faixa, nem estimativa, sai antes dessa avaliação.",
    metadata: { escopo: "avaliação da troca" },
  },
  {
    source_type: "troca",
    context: "aceita meu carro na troca? dou minha caminhonete de entrada? aceita jet ski, quadriciclo?",
    content:
      "Na troca a loja aceita SOMENTE moto. Carro, caminhonete, quadriciclo, jet ski ou qualquer outro veículo não entram. " +
      "A avaliação da moto da troca é presencial, na loja, com o vendedor olhando a moto de perto, e é rápida. " +
      "A loja também compra moto de particular, de quem quer vender sem comprar outra.",
    metadata: { escopo: "moto na troca" },
  },
  {
    source_type: "institucional",
    context: "vocês vendem moto 0km? tem moto zero quilômetro? tem moto nova de fábrica? só trabalham com usada?",
    content:
      "Moto 0km: além das seminovas, a loja também trabalha com 0km. Preço, prazo de entrega e garantia de fábrica da 0km quem passa é o vendedor.",
    metadata: { escopo: "moto 0km" },
  },
  {
    source_type: "institucional",
    context: "posso dar uma volta na moto? tem test ride? dá pra experimentar antes de comprar?",
    content:
      "A loja não faz test ride, por segurança. Conhecer a moto de perto na loja, sentar nela e ver tudo, pode.",
    metadata: { escopo: "test ride" },
  },
  {
    source_type: "institucional",
    context: "vocês fazem seguro da moto? dá pra contratar seguro junto com a compra? vocês cotam seguro? tem seguro de moto?",
    content:
      "Seguro de moto: a loja faz a cotação para quem quiser, junto com o vendedor, na hora da compra.",
    metadata: { escopo: "seguro" },
  },
  {
    source_type: "institucional",
    context: "tem desconto se eu indicar um amigo? vocês têm programa de fidelidade? tem benefício pra cliente antigo?",
    content:
      "Quem indica um amigo que compra ganha um tanque cheio. " +
      "Cartão fidelidade: a cada dez revisões feitas na loja, uma revisão Plus de graça.",
    metadata: { escopo: "indicação e fidelidade" },
  },
  {
    source_type: "pos_venda",
    context: "já comprei uma moto com vocês e estou com problema, sou cliente de vocês, comprei aí mês passado, quero acionar a garantia da moto que comprei, cadê o documento da minha moto",
    content:
      "Pós-venda (quem já comprou): atende de segunda a sexta, das 8h às 18h, pelo número wa.me/5551980581021. " +
      "A moto pode ser atendida em qualquer uma das oficinas autorizadas da rede (ver a lista de oficinas).",
    metadata: { escopo: "pós-venda" },
  },
  {
    source_type: "institucional",
    context: "há quanto tempo vocês existem? quantos anos de mercado? desde quando a loja trabalha? vocês são confiáveis? a loja é de confiança? vocês são sérios? loja antiga ou nova?",
    content:
      "A Protásio Motos está no mercado desde 1992, trabalha com motos de procedência, revisadas e com a documentação resolvida, e entrega em todo o Brasil. " +
      "A loja fica em Torres, no litoral norte do Rio Grande do Sul, e tem rede de oficinas autorizadas no RS e em SC.",
    metadata: { escopo: "a loja" },
  },
];

async function seed() {
  if (DRY_RUN) {
    console.log(`${entries.length} entradas para client_id="${CLIENT_ID}"\n`);
    entries.forEach((e, i) => {
      console.log(`${String(i + 1).padStart(2)}. [${e.source_type}] ${e.metadata.escopo}`);
      console.log(`    context: ${e.context.slice(0, 95)}...`);
      console.log(`    content: ${e.content.length} chars\n`);
    });
    return;
  }
  if (!BASE) {
    console.error("Faltou BASE_URL (a URL do deploy da Protásio).");
    process.exit(1);
  }

  console.log(`Enviando ${entries.length} entradas para ${BASE} (client_id="${CLIENT_ID}")`);
  let ok = 0, falhas = 0;
  for (const entry of entries) {
    let concluido = false, tentativas = 0;
    while (!concluido) {
      try {
        await axios.post(`${BASE}/admin/knowledge`, { ...entry, client_id: CLIENT_ID });
        console.log("OK:", entry.metadata.escopo);
        ok++; concluido = true;
      } catch (err) {
        // /admin/knowledge responde 500 mesmo quando a causa é rate limit do
        // Voyage por trás — detecta pelo texto, não pelo status HTTP.
        const msg = JSON.stringify(err.response?.data || err.message || "");
        tentativas++;
        if ((err.response?.status === 429 || msg.includes("429")) && tentativas < 8) {
          console.log(`   rate limit, aguardando 15s (tentativa ${tentativas})...`);
          await new Promise(r => setTimeout(r, 15000));
        } else {
          console.error("ERRO em", entry.metadata.escopo, ":", err.response?.data || err.message);
          falhas++; concluido = true;
        }
      }
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log(`\nConcluído. ${ok} indexadas, ${falhas} falharam.`);
}

seed();
