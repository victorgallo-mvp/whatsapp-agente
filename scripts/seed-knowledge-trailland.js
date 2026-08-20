// ─── BASE DE CONHECIMENTO — TRAILLAND ────────────────────────────────────────
// Fichas técnicas por modelo. NÃO use chunk-and-ingest.js pros PDFs de ficha
// técnica da MXF: eles são diagramados em duas colunas e o extrator devolve o
// rótulo depois do valor ("CILINDRADA: 28cv a 7.500 rpm" — isso é a potência),
// o que faria a Olivia passar spec errada. Aqui os pares label:valor são
// transcritos à mão a partir do PDF oficial e conferidos um a um.
//
// Uso:
//   node scripts/seed-knowledge-trailland.js            # indexa
//   node scripts/seed-knowledge-trailland.js --dry-run  # só mostra
//   BASE_URL=https://<deploy-trailland> node scripts/seed-knowledge-trailland.js

const axios = require("axios");

const BASE      = process.env.BASE_URL || "https://whatsapp-agente-production-5d73.up.railway.app";
const CLIENT_ID = "trailland";
const DRY_RUN   = process.argv.includes("--dry-run");

const entries = [
  {
    source_type: "ficha_tecnica",
    context: "mxf 270 fi motor, cilindrada, potência, torque, injeção eletrônica, transmissão, marchas, partida, quantos cv tem a 270",
    // termos: a entrada só é recuperada se a conversa mencionar este modelo.
    // Sem isso, perguntar spec do Wolf 550 trazia a ficha da 270 FI acima do
    // threshold e a IA podia atribuir os números ao produto errado.
    //
    // CUIDADO ao escolher termos: número solto colide no catálogo MXF. "270"
    // sozinho casaria também com a 270 MXI Motocross, que é outro produto e tem
    // outro preço. Mesma armadilha em 250 (RXIR/RXI/TSX/FOX), 300 (TSX/TSX-R/
    // XWOLF), 1000 (Wolf/Flow/Brave/Thor), 125, 110, 90, 49... Use sempre o
    // termo que distingue o modelo, nunca só a cilindrada. Cuidado também com
    // termo que é prefixo de outro: "rxi" casa dentro de "rxir".
    metadata: { escopo: "MXF 270 FI", termos: ["270 fi", "270fi", "270 f i"] },
    content: "Ficha técnica MXF 270 FI — motor e desempenho. Motor: 4 tempos, 4 válvulas, gasolina, refrigerado a ar, monocilíndrico. Cilindrada real: 249,4 cc (o \"270\" é nome comercial do modelo). Potência máxima: 28 cv a 7.500 rpm. Torque: 2,7 kgf.m a 7.000 rpm. Alimentação: injeção eletrônica TBI Bosch 8.0. Transmissão: 6 marchas. Partida: elétrica. Movimentação: corrente, pinhão 12 dentes e coroa 52 dentes. Capacidade do tanque: 8 litros.",
  },
  {
    source_type: "ficha_tecnica",
    context: "mxf 270 fi suspensão, freio, roda, pneu, peso, altura do assento, altura do solo, entre-eixos, dimensões, quanto pesa a 270",
    metadata: { escopo: "MXF 270 FI", termos: ["270 fi", "270fi", "270 f i"] },
    content: "Ficha técnica MXF 270 FI — ciclística e dirigibilidade. Suspensão dianteira: invertida de longo curso (300 mm) com regulagem de compressão e retorno. Suspensão traseira: amortecedor com link, com regulagem de pré-carga, compressão e retorno, pressurizada a nitrogênio. Freio dianteiro: hidráulico a disco de 260 mm. Freio traseiro: hidráulico a disco de 220 mm. Roda dianteira: aro de alumínio e raios de aço inox 4 mm, pneu Kenda 80/100-21. Roda traseira: aro de alumínio e raios de aço inox 4 mm, pneu Kenda 120/80-18. Altura do assento: 910 mm. Altura do solo: 330 mm. Entre-eixos: 1.500 mm. Peso: 112 kg. Dimensões: 2.160 x 840 x 1.240 mm. Quadro: aço liga cromo-molibdênio de alta resistência. Painel: LED multifunções.",
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

  console.log(`Enviando ${entries.length} entradas para client_id="${CLIENT_ID}" em ${BASE}`);
  for (const entry of entries) {
    let ok = false;
    while (!ok) {
      try {
        await axios.post(`${BASE}/admin/knowledge`, { ...entry, client_id: CLIENT_ID });
        console.log("OK:", entry.context.slice(0, 60));
        ok = true;
      } catch (err) {
        // /admin/knowledge responde 500 mesmo quando a causa é rate limit do
        // Voyage por trás — detecta pelo texto, não pelo status HTTP.
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
