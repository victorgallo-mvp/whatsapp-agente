// ─── TESTE DE RECUPERAÇÃO — RAG DA PROTÁSIO ──────────────────────────────────
// Pergunta coisas do jeito que o cliente pergunta e confere se o chunk CERTO
// volta, acima do limite que o servidor usa em produção (0.35).
//
// Isto é o que decide se dá para tirar o fato do prompt: enquanto a recuperação
// errar, tirar do prompt significa trocar uma resposta certa por um silêncio.
//
// Uso: BASE_URL=https://<deploy-protasio> node scripts/testar-rag-protasio.js

const axios = require("axios");
const BASE = process.env.BASE_URL || "";
const MIN  = 0.35;   // mesmo minSimilarity do fluxo real

// pergunta do cliente -> escopo que DEVE vir em primeiro lugar
const CASOS = [
  ["a transferencia ta inclusa no preço da moto?",            "transferência e documentação"],
  ["quanto custa pra passar a moto pro meu nome?",            "transferência e documentação"],
  ["posso parcelar a transferencia?",                         "transferência e documentação"],
  ["tem oficina autorizada em caxias do sul?",                "oficinas autorizadas"],
  ["se der problema na moto eu preciso voltar ate torres?",   "oficinas autorizadas"],
  ["essa moto tem garantia? de quanto tempo?",                "garantia e estado da moto"],
  ["voces entregam em outra cidade? quanto fica o frete?",    "entrega e frete"],
  ["onde fica a loja de voces?",                              "endereço"],
  ["que horas voces abrem no sabado?",                        "horário de funcionamento"],
  ["aceita cartao? parcela em quantas vezes?",                "formas de pagamento"],
  ["voces trabalham com consorcio?",                          "formas de pagamento"],
  ["aceita carro na troca?",                                  "moto na troca"],
  ["voces tem moto 0km?",                                     "moto 0km"],
  ["posso dar uma volta pra testar a moto?",                  "test ride"],
  ["voces fazem seguro?",                                     "seguro"],
  ["tem desconto se eu indicar um amigo?",                    "indicação e fidelidade"],
  ["comprei uma moto ai e ta com barulho no motor",           "pós-venda"],
  ["ha quanto tempo voces estao no mercado?",                 "a loja"],
  // negativos: nada da base responde isso, e o certo é NÃO recuperar com força
  ["quanto custa uma xre 300?",                               null],
  ["tem fazer 250 no patio?",                                 null],
];

(async () => {
  if (!BASE) { console.error("Faltou BASE_URL."); process.exit(1); }
  let acertos = 0, erros = 0, avaliados = 0, noTop = 0;

  for (const [pergunta, esperado] of CASOS) {
    try {
      const r = await axios.get(`${BASE}/admin/knowledge/search`, {
        params: { q: pergunta, clientId: process.env.KB_CLIENT_ID || "protasio", minSim: 0, topK: 4 },
        timeout: 30000,
      });
      const res = r.data.resultados || r.data.results || r.data || [];
      const top = res[0] || {};
      const escopo = top.metadata?.escopo || top.context || "(nenhum)";
      const sim = Number(top.similarity ?? top.sim ?? 0);

      if (esperado === null) {
        // negativo: aceitável se nada passar do limite
        const passou = sim < MIN;
        console.log((passou ? "ok  " : "ATEN").padEnd(5) + `"${pergunta}"`);
        console.log(`      top: ${escopo} (${sim.toFixed(3)})${passou ? " — abaixo do limite, correto" : " — recupera algo que não responde"}`);
      } else {
        avaliados++;
        const certo = String(escopo).includes(esperado) && sim >= MIN;
        // O que a produção realmente usa: os 4 primeiros acima do limite. Estar
        // em 2o lugar não é erro — o fato chega no prompt do mesmo jeito.
        const pos = res.findIndex(x => String(x.metadata?.escopo || "").includes(esperado) && Number(x.similarity ?? 0) >= MIN);
        if (certo) acertos++; else erros++;
        if (pos >= 0) noTop++;
        console.log((certo ? "ok  " : pos >= 0 ? "2o+ " : "ERRO").padEnd(5) + `"${pergunta}"`);
        console.log(`      esperado: ${esperado} | 1o: ${escopo} (${sim.toFixed(3)})` + (pos > 0 ? ` | o certo veio em ${pos + 1}o (${Number(res[pos].similarity).toFixed(3)})` : pos < 0 ? " | NAO veio entre os 4" : ""));
      }
    } catch (err) {
      console.error("FALHA na consulta:", pergunta, "->", err.response?.data || err.message);
      erros++;
    }
  }
  console.log(`\nEm 1o lugar: ${acertos}/${avaliados}`);
  console.log(`Entre os 4 que a produção injeta: ${noTop}/${avaliados}  <- é esta que decide`);
})();
