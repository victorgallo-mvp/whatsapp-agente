const axios = require("axios");

const BASE = "https://whatsapp-agente-production-5d73.up.railway.app";

const entries = [
  { source_type: "product",      context: "cartao visita flyer",            content: "Cartões de visita e flyers são produzidos em lote mínimo de 1000 unidades. Disponíveis em acabamento simples ou laminação fosca com verniz localizado." },
  { source_type: "product",      context: "acrílico placa ACM instalação",  content: "Placas de ACM, acrílico e instalações requerem visita técnica antes da produção para medição e avaliação do local." },
  { source_type: "sales_script", context: "cliente quer desconto preco",    content: "Nunca negocie preços diretamente. Diga: os valores são tabelados, mas o consultor pode verificar condições especiais para você." },
  { source_type: "sales_script", context: "cliente quer repaginar renovar antes de investir geladeira equipamento",  content: "Se o cliente disser que quer repaginar ou renovar o estabelecimento ou equipamento antes de investir: apresente dois ângulos. Primeiro: adesivos podem ser aplicados diretamente em geladeiras, balcões, portas e equipamentos, dando visual completamente novo sem troca do item — o serviço da Comunynk é a renovação. Segundo: comunicação visual bem feita atrai mais clientes e aumenta o ticket médio do estabelecimento. É um investimento que se paga, não apenas um custo estético." },
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
