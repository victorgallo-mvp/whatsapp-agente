const axios = require("axios");

const BASE = "https://whatsapp-agente-production-5d73.up.railway.app";

const entries = [
  { source_type: "product",      context: "cartao visita flyer",            content: "Cartões de visita e flyers são produzidos em lote mínimo de 1000 unidades. Disponíveis em acabamento simples ou laminação fosca com verniz localizado." },
  { source_type: "product",      context: "acrílico placa ACM instalação",  content: "Placas de ACM, acrílico e instalações requerem visita técnica antes da produção para medição e avaliação do local." },
  { source_type: "sales_script", context: "cliente quer desconto preco",    content: "Nunca negocie preços diretamente. Diga: os valores são tabelados, mas o consultor pode verificar condições especiais para você." },
  { source_type: "sales_script", context: "cliente quer repaginar renovar antes de investir geladeira equipamento",  content: "Se o cliente disser que quer repaginar ou renovar o estabelecimento ou equipamento antes de investir: apresente dois ângulos. Primeiro: adesivos podem ser aplicados diretamente em geladeiras, balcões, portas e equipamentos, dando visual completamente novo sem troca do item — o serviço da Comunynk é a renovação. Segundo: comunicação visual bem feita atrai mais clientes e aumenta o ticket médio do estabelecimento. É um investimento que se paga, não apenas um custo estético." },
  { source_type: "sales_script", context: "cliente prefere investir em outro setor prioridade diferente",          content: "Se o cliente disser que prefere investir em outro setor primeiro: a comunicação visual é o que o cliente vê antes de entrar — impacta todos os outros setores. Um estabelecimento com identidade visual forte atrai mais movimento, o que potencializa qualquer outro investimento feito internamente. Sugira começar com um item de menor valor para já ter resultado visível enquanto organiza outros investimentos." },
  { source_type: "sales_script", context: "cliente sem orcamento agora nao tem dinheiro esta caro",                content: "Se o cliente disser que não tem orçamento ou que está caro: há opções de entrada acessíveis como adesivos e banners de alto impacto visual e custo reduzido. A Comunynk tem soluções para diferentes tamanhos de investimento. Pergunte qual seria o valor confortável para começar e ajuste a proposta. Nunca negocie preço tabelado — ofereça uma solução menor se necessário." },
  { source_type: "sales_script", context: "cliente quer esperar momento certo nao e hora",                         content: "Se o cliente disser que vai esperar o momento certo: cada dia sem identidade visual é um dia em que potenciais clientes passam pelo estabelecimento sem entrar ou sem memorizar a marca. A concorrência não espera. O processo de produção e instalação é rápido — em poucos dias já está no ar. Pergunte o que especificamente o faria sentir que é o momento certo e trabalhe nesse ponto." },
  { source_type: "sales_script", context: "cliente nao acredita em retorno nao vai fazer diferenca resultado",     content: "Se o cliente duvidar do retorno do investimento em comunicação visual: empresas com identidade visual consistente e bem aplicada geram mais confiança no consumidor, aumentam o reconhecimento de marca e, consequentemente, o ticket médio. O impacto é direto no movimento do estabelecimento. Ofereça como exemplo a diferença de percepção entre dois estabelecimentos do mesmo setor — um com fachada bem comunicada e outro sem." },
];

async function seed() {
  for (const entry of entries) {
    let ok = false;
    while (!ok) {
      try {
        await axios.post(`${BASE}/admin/knowledge`, entry, { headers: { "Content-Type": "application/json" } });
        console.log("OK:", entry.content.substring(0, 60));
        ok = true;
      } catch (err) {
        if (err.response?.status === 429) {
          console.log("Rate limit, aguardando 30s...");
          await new Promise(r => setTimeout(r, 30000));
        } else {
          console.error("ERRO:", err.response?.data || err.message);
          ok = true;
        }
      }
    }
    await new Promise(r => setTimeout(r, 10000));
  }
  console.log("Concluído.");
}

seed();
