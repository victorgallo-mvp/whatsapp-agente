// ─── BASE DE CONHECIMENTO — TRAILLAND ────────────────────────────────────────
// Fichas técnicas por modelo, transcritas à mão dos PDFs oficiais da MXF.
//
// NÃO use chunk-and-ingest.js pros PDFs de ficha técnica: alguns são diagramados
// em duas colunas e o extrator devolve o rótulo depois do valor ("CILINDRADA:
// 28cv a 7.500 rpm" — isso é a potência), o que faria a Olivia passar spec
// errada. Aqui cada par label:valor foi conferido um a um contra o PDF.
//
// ESCOLHA DOS TERMOS (metadata.termos) — a entrada só é recuperada se a conversa
// mencionar aqueles termos. Número solto colide no catálogo MXF: "270" casa com
// a FI e com a MXi; "250" com RXi, RXi-R, TSX e FOX 250; "125" com Pro Racing,
// Attack e Brave. Use sempre o que distingue o modelo, nunca só a cilindrada.
// Quando o nome de um modelo é prefixo de outro ("250 rxi" dentro de "250 rxi-r",
// "300 tsx" dentro de "300 tsx-r"), declare metadata.excluir na versão base.
//
// Uso:
//   node scripts/seed-knowledge-trailland.js            # indexa
//   node scripts/seed-knowledge-trailland.js --dry-run  # só mostra
//   node scripts/seed-knowledge-trailland.js --start=5  # retoma a partir da 5a
//   BASE_URL=https://<deploy-trailland> node scripts/seed-knowledge-trailland.js

const axios = require("axios");

const BASE      = process.env.BASE_URL || "https://whatsapp-agente-production-5d73.up.railway.app";
const CLIENT_ID = "trailland";
const DRY_RUN   = process.argv.includes("--dry-run");

const CTX = "ficha técnica, especificações, motor, cilindrada, potência, quantos cv, torque, peso, quanto pesa, altura do assento, altura do solo, suspensão, freio, pneu, roda, tanque, marchas, partida, dimensões";

const entries = [
  {
    source_type: "ficha_tecnica",
    context: `mxf 270 fi ${CTX}`,
    content: "Ficha técnica MXF 270 FI (trail com injeção). Motor: 4 tempos, 4 válvulas, gasolina, refrigerado a ar, monocilíndrico. Cilindrada: 249,4 cc (o \"270\" é nome comercial do modelo, não a cilindrada). Potência máxima: 28 cv a 7.500 rpm. Torque: 2,7 kgf.m a 7.000 rpm. Alimentação: injeção eletrônica TBI Bosch 8.0. Transmissão: 6 marchas. Partida: elétrica. Movimentação: corrente, pinhão 12 dentes, coroa 52 dentes. Capacidade do tanque: 8 litros. Suspensão dianteira: invertida de longo curso (300 mm) com regulagem de compressão e retorno. Suspensão traseira: amortecedor com link, com regulagem de pré-carga, compressão e retorno, pressurizada a nitrogênio. Freio dianteiro: hidráulico a disco de 260 mm. Freio traseiro: hidráulico a disco de 220 mm. Rodas: aro de alumínio e raios de aço inox 4 mm. Pneu dianteiro Kenda 80/100-21, traseiro Kenda 120/80-18. Altura do assento: 910 mm. Altura do solo: 330 mm. Entre-eixos: 1.500 mm. Peso: 112 kg. Dimensões: 2.160 x 840 x 1.240 mm. Quadro: aço liga cromo-molibdênio de alta resistência. Painel: LED multifunções.",
    metadata: { escopo: "MXF 270 FI", termos: ["270 fi", "270fi"] },
  },
  {
    source_type: "ficha_tecnica",
    context: `mxf 270 mxi motocross ${CTX}`,
    content: "Ficha técnica MXF 270 MXi (motocross). Motor: 4 tempos, gasolina, refrigerado a ar, monocilíndrico. Cilindrada: 249,4 cc (o \"270\" é nome comercial do modelo, não a cilindrada). Potência máxima: 28 cv a 7.500 rpm. Torque: 2,7 kgf.m a 7.000 rpm. Alimentação: injeção eletrônica TBI Bosch 8.0. Marchas: 6. Partida: elétrica. Transmissão: corrente, pinhão 12 dentes, coroa 50 dentes. Quadro: aço liga cromo-molibdênio de alta resistência, MX Ready. Suspensão dianteira: duplo cartucho 48 mm, invertida de longo curso (300 mm), com regulagem de compressão e retorno. Suspensão traseira: MP com regulagem de pré-carga da mola e ajustes de compressão (rápida e lenta) e retorno (300 mm). Freio dianteiro: hidráulico a disco de 260 mm, Taisko Japan. Freio traseiro: hidráulico a disco de 220 mm, Taisko Japan. Rodas: aros de alumínio Giant GLM Italy e raios de aço inox 4 mm. Pneu dianteiro Kenda 80/100-21, traseiro Kenda 110/90-19. Capacidade do tanque: 8 litros. Altura do assento: 980 mm. Altura do solo: 350 mm. Entre-eixos: 1.500 mm. Peso: 110 kg. Dimensões: 2.160 x 840 x 1.240 mm.",
    metadata: { escopo: "MXF 270 MXi", termos: ["270 mxi", "270mxi", "mxi"] },
  },
  {
    source_type: "ficha_tecnica",
    context: `mxf 250 rxi ${CTX}`,
    content: "Ficha técnica MXF 250 RXi. Motor: 4 tempos, monocilíndrico, refrigerado a água, 4 válvulas DOHC. Cilindrada: 249,9 cc. Potência máxima: 40,8 cv. Torque máximo: 2,95 kgf.m. Arrefecimento: refrigerado a água com ventilador auxiliar automático. Alimentação: injeção eletrônica Bosch 8.0 TBI. Transmissão: 5 marchas. Partida: elétrica com bateria de lítio. Movimentação: corrente 520 com retentor, pinhão 13 dentes, coroa 51 dentes. Quadro: aço liga cromo-molibdênio de alta resistência. Embreagem: multidiscos banhados a óleo. Suspensão dianteira: MP com regulagem de compressão e retorno (310 mm). Suspensão traseira: MP com regulagem de pré-carga da mola e ajustes de compressão (rápida e lenta) e retorno (300 mm). Freio dianteiro: hidráulico, pistão duplo, discos ventilados de 260 mm. Freio traseiro: hidráulico, pistão duplo, discos ventilados de 220 mm. Rodas: aros Giant e raios de aço inox 4 mm. Pneu dianteiro Kenda 80/100-21, traseiro Kenda 120/80-18. Escapamento: aço inox e alumínio. Capacidade do tanque: 8 litros. Altura do assento: 950 mm. Altura do solo: 340 mm. Entre-eixos: 1.480 mm. Peso: 110 kg. Capacidade de carga: 150 kg. Dimensões: 2.160 x 830 x 1.270 mm.",
    metadata: { escopo: "MXF 250 RXi", termos: ["250 rxi", "250rxi"], excluir: ["rxi-r", "rxir", "rxi r"] },
  },
  {
    source_type: "ficha_tecnica",
    context: `mxf 250 rxi-r rxir competição ${CTX}`,
    content: "Ficha técnica MXF 250 RXi-R, a versão de competição da RXi. Motor: 4 tempos, monocilíndrico, refrigerado a água, 4 válvulas DOHC. Cilindrada: 249,9 cc. Potência máxima: 40,8 cv. Torque máximo: 2,95 kgf.m. Arrefecimento: refrigerado a água com ventilador auxiliar automático. Alimentação: injeção eletrônica Bosch 8.0 TBI. Transmissão: 5 marchas. Partida: elétrica com bateria de lítio. Movimentação: corrente DID X-Ring 520 com retentor, pinhão 13 dentes, coroa tri-metal 51 dentes. Quadro: aço liga cromo-molibdênio de alta resistência. Embreagem: multidiscos banhados a óleo. Suspensão dianteira: Kayaba duplo cartucho 48 mm, totalmente ajustável em compressão e retorno, tubos com tratamento DLC. Suspensão traseira: MP com regulagem de pré-carga da mola e ajustes de compressão (rápida e lenta) e retorno (300 mm). Freio dianteiro: hidráulico a disco de 260 mm, Taisko Japan. Freio traseiro: hidráulico a disco de 220 mm, Taisko Japan. Rodas: aros Excel Takasago 21x1,60 na dianteira e 18x2,15 na traseira. Pneu dianteiro Kenda 80/100-21, traseiro Kenda 140/80-18. Escapamento: full titânio, MXF Pro-Exhaust Titanium. Capacidade do tanque: 8 litros. Altura do assento: 950 mm. Altura do solo: 340 mm. Entre-eixos: 1.480 mm. Peso: 107 kg. Capacidade de carga: 150 kg. Dimensões: 2.160 x 830 x 1.270 mm.",
    metadata: { escopo: "MXF 250 RXi-R", termos: ["250 rxi-r", "250 rxir", "rxi-r", "rxir"] },
  },
  {
    source_type: "ficha_tecnica",
    context: `mxf 250 tsx 2 tempos ${CTX}`,
    content: "Ficha técnica MXF 250 TSX (2 tempos). Motor: 224 cc, 2 tempos, monocilíndrico, com válvula de controle eletrônico. Atenção: o \"250\" é nome comercial do modelo, a cilindrada real é 224 cc. Potência máxima: 35,5 cv a 9.000 rpm. Torque: 29,5 Nm a 7.000 rpm. Arrefecimento: refrigerado a água com ventilador auxiliar automático. Alimentação: carburador. Transmissão: corrente 520, pinhão 12 dentes, coroa 52 dentes. Marchas: 6. Embreagem: multidiscos banhados a óleo. Capacidade do tanque: 8 litros. Partida: elétrica. Suspensão dianteira: SZC com regulagem de compressão e retorno e válvula de alívio de ar (310 mm). Suspensão traseira: SZC com regulagem de pré-carga da mola e ajustes de compressão (rápida e lenta) e retorno (300 mm). Freio dianteiro: hidráulico, pistão duplo, discos ventilados de 260 mm. Freio traseiro: hidráulico, pistão duplo, discos ventilados de 220 mm. Rodas: aros de alumínio e raios de aço inox 4 mm. Pneu dianteiro Kenda 80/100-21, traseiro Kenda 120/80-18. Altura do assento: 950 mm. Altura do solo: 350 mm. Entre-eixos: 1.500 mm. Peso: 111 kg. Capacidade de carga: 150 kg. Dimensões: 2.180 x 830 x 1.300 mm.",
    metadata: { escopo: "MXF 250 TSX", termos: ["250 tsx", "250tsx"] },
  },
  {
    source_type: "ficha_tecnica",
    context: `mxf 300 tsx 2 tempos ${CTX}`,
    content: "Ficha técnica MXF 300 TSX (2 tempos). Motor: 300 cc, 2 tempos, monocilíndrico, com válvula de controle eletrônico. Arrefecimento: refrigerado a água. Alimentação: carburador. Transmissão: corrente 520, pinhão 12 dentes, coroa 52 dentes. Marchas: 6. Embreagem: multidiscos banhados a óleo. Capacidade do tanque: 8 litros. Partida: elétrica. Suspensão dianteira: SZC com regulagem de compressão e retorno e válvula de alívio de ar (310 mm). Suspensão traseira: SZC com regulagem de pré-carga da mola e ajustes de compressão (rápida e lenta) e retorno (300 mm). Freio dianteiro: hidráulico, pistão duplo, discos ventilados de 260 mm. Freio traseiro: hidráulico, pistão duplo, discos ventilados de 220 mm. Rodas: aros de alumínio e raios de aço inox 4 mm. Pneu dianteiro Kenda 80/100-21, traseiro Kenda 120/80-18. Altura do assento: 950 mm. Altura do solo: 350 mm. Entre-eixos: 1.500 mm. Peso: 108 kg. Capacidade de carga: 150 kg. Dimensões: 2.180 x 830 x 1.300 mm. A ficha oficial deste modelo não informa potência nem torque — se perguntarem, confirme com o time em vez de estimar.",
    metadata: { escopo: "MXF 300 TSX", termos: ["300 tsx", "300tsx"], excluir: ["tsx-r", "tsxr", "tsx r"] },
  },
  {
    source_type: "ficha_tecnica",
    context: `pro racing 150rr ${CTX}`,
    content: "Ficha técnica MXF Pro Racing 150RR. Motor: 150 cc, monocilíndrico, 4 tempos. Potência: 14,5 cv a 9.500 rpm. Torque: 11,5 Nm a 8.000 rpm. Arrefecimento: refrigerado a óleo. Alimentação: carburador. Velocidade máxima: 100 km/h. Transmissão: embreagem manual. Marchas: 4. Capacidade do tanque: 5,5 litros. Consumo: 2,8 litros a cada 100 km. Partida: elétrica e pedal. Suspensão dianteira: invertida 770-45/48. Suspensão traseira: amortecedor hidráulico de 335 mm. Freio dianteiro: pinça de pistões duplos, disco de 220 mm. Freio traseiro: pinça de pistão único, disco de 190 mm. Roda dianteira: pneu off-road 70/100-17, aro em aço 1.60-17, cubo de alumínio. Roda traseira: pneu off-road 90/100-14, aro em aço 1.85-14, cubo de alumínio. Altura do assento: 865 mm. Altura do solo: 305 mm. Entre-eixos: 1.260 mm. Peso: 85 kg. Capacidade de carga: 100 kg. Dimensões: 1.815 x 820 x 1.095 mm.",
    metadata: { escopo: "Pro Racing 150RR", termos: ["150rr", "150 rr", "pro racing 150", "racing 150"] },
  },
  {
    source_type: "ficha_tecnica",
    context: `pro racing 125rr ${CTX}`,
    content: "Ficha técnica MXF Pro Racing 125RR. Motor: 125 cc, monocilíndrico, 4 tempos. Potência: 9,5 cv a 7.500 rpm. Torque: 9,0 Nm a 5.500 rpm. Arrefecimento: refrigerado a ar. Alimentação: carburador. Velocidade máxima: 80 km/h. Transmissão: embreagem manual. Marchas: 4. Capacidade do tanque: 5,5 litros. Consumo: 2,4 litros a cada 100 km. Partida: elétrica e pedal. Suspensão dianteira: invertida 770-45/48. Suspensão traseira: amortecedor hidráulico de 280 mm. Freio dianteiro: pinça de pistões duplos, disco de 220 mm. Freio traseiro: pinça de pistão único, disco de 190 mm. Roda dianteira: pneu off-road 70/100-17, aro em aço 1.60-17, cubo de alumínio. Roda traseira: pneu off-road 90/100-14, aro em aço 1.85-14, cubo de alumínio. Altura do assento: 865/835 mm (ajustável). Altura do solo: 340/310 mm. Entre-eixos: 1.260/1.265 mm. Peso: 79 kg. Capacidade de carga: 100 kg. Dimensões: 1.810 x 820 x 1.100/1.075 mm.",
    metadata: { escopo: "Pro Racing 125RR", termos: ["125rr", "125 rr", "pro racing 125", "racing 125"] },
  },
  {
    source_type: "ficha_tecnica",
    context: `pro racing 110rr ${CTX}`,
    content: "Ficha técnica MXF Pro Racing 110RR. Motor: 110 cc, monocilíndrico, 4 tempos. Potência: 7 cv a 7.500 rpm. Torque: 7,5 Nm a 5.500 rpm. Arrefecimento: refrigerado a ar. Alimentação: carburador. Velocidade máxima: 70 km/h. Transmissão: automática (não tem embreagem manual). Marchas: automáticas. Capacidade do tanque: 5,5 litros. Consumo: 2,2 litros a cada 100 km. Partida: elétrica. Suspensão dianteira: invertida 735-45/48. Suspensão traseira: amortecedor hidráulico de 280 mm. Freio dianteiro: pinça de pistões duplos, disco de 220 mm. Freio traseiro: pinça de pistão único, disco de 190 mm. Roda dianteira: pneu off-road 60/100-14, aro em aço 1.60-14. Roda traseira: pneu off-road 80/100-12, aro em aço 1,85-12. Altura do assento: 820/790 mm (ajustável). Altura do solo: 285/255 mm. Entre-eixos: 1.210 mm. Peso: 74 kg. Capacidade de carga: 85 kg. Dimensões: 1.700 x 820 x 1.060/1.035 mm.",
    metadata: { escopo: "Pro Racing 110RR", termos: ["110rr", "110 rr", "pro racing 110", "racing 110"] },
  },
  {
    source_type: "ficha_tecnica",
    context: `pro racing 90 ${CTX}`,
    content: "Ficha técnica MXF Pro Racing 90. Motor: 90 cc, 4 tempos, gasolina. Arrefecimento: refrigerada a ar. Alimentação: carburador. Velocidade máxima: 60 a 70 km/h. Transmissão: automática. Marchas: automática. Capacidade do tanque: 3,5 litros. Partida: elétrica. Suspensão dianteira: invertida. Suspensão traseira: mono shock com amortecedor de 270 mm (curso de 43 mm). Freio dianteiro: hidráulico a disco. Freio traseiro: hidráulico a disco. Roda dianteira: 12 polegadas. Roda traseira: 10 polegadas. Altura do assento: 580 mm. Altura do solo: 170 mm. Entre-eixos: 1.005 mm. Peso: 53 kg. Capacidade de carga: 80 kg. Dimensões: 1.430 x 630 x 850 mm. A ficha oficial deste modelo não informa potência nem torque — se perguntarem, confirme com o time em vez de estimar.",
    metadata: { escopo: "Pro Racing 90", termos: ["90rr", "90 rr", "pro racing 90", "racing 90"] },
  },
  {
    source_type: "ficha_tecnica",
    context: `ferinha 60f infantil ${CTX}`,
    content: "Ficha técnica MXF Ferinha 60F. Motor: 57 cc, monocilíndrico, 4 tempos, refrigerado a ar. Atenção: o \"60\" é nome comercial do modelo, a cilindrada real é 57 cc. Potência: 3 cv a 6.000 rpm. Torque: 2,49 Nm a 6.000 rpm. Alimentação: carburador. Velocidade máxima: 50 km/h. Transmissão: automática por corrente. Marchas: automática. Capacidade do tanque: 2,1 litros. Consumo: 65 km por litro. Partida: manual — este modelo não tem partida elétrica. Suspensão dianteira: invertida 515/33,5. Suspensão traseira: sistema pro link com amortecedor de 280 mm. Freio dianteiro: mecânico com disco de 140 mm. Freio traseiro: mecânico com disco de 140 mm. Roda dianteira: aro em aço 1.40-10, pneu 2,50-10. Roda traseira: aro em aço 1.40-10, pneu 2,50-11. Altura do assento: 600 mm. Altura do solo: 230 mm. Entre-eixos: 840 mm. Peso: 28 kg. Capacidade de carga: 50 kg. Dimensões: 1.230 x 550 x 800 mm. Porte pequeno.",
    metadata: { escopo: "Ferinha 60F", termos: ["60f", "60 f", "ferinha 60"] },
  },
  {
    source_type: "ficha_tecnica",
    context: `mxf 50ts 2 tempos ${CTX}`,
    content: "Ficha técnica MXF 50TS. Motor: monocilíndrico, 2 tempos, refrigerado a ar. Cilindrada: 49 cc (o \"50\" é nome comercial do modelo). Potência: 10,5 cv a 11.500 rpm. Torque: 9,2 Nm a 7.000 rpm. Partida: pedal. Carburador PZ18. Freio dianteiro: discos de 220 mm, pistão duplo. Freio traseiro: disco de 190 mm. Rodas: aro de aço 1.40 x 12 na dianteira e 1.60 x 10 na traseira. Pneus: 2.75-12 dianteiro e 3.00-10 traseiro. Capacidade do tanque: 3,5 litros. Suspensão dianteira: hidráulica invertida 650 mm. Suspensão traseira: sistema shock 270 mm. Altura do assento: 680 mm. Altura do solo: 240 mm. Entre-eixos: 990 mm. Peso: 49 kg. Dimensões: 1.410 x 675 x 950 mm.",
    // "50ts"/"50 ts" estão literalmente dentro de "250tsx"/"250 tsx" — sem a
    // exclusão, perguntar da 250 TSX trazia junto a ficha da 50TS.
    metadata: { escopo: "MXF 50TS", termos: ["50ts", "50 ts"], excluir: ["250ts", "250 ts"] },
  },
];

async function seed() {
  if (DRY_RUN) {
    entries.forEach((e, i) => {
      const m = e.metadata;
      console.log(`\n[${i + 1}/${entries.length}] ${m.escopo} | termos: ${JSON.stringify(m.termos)}${m.excluir ? " | excluir: " + JSON.stringify(m.excluir) : ""}`);
      console.log(`  ${e.content.slice(0, 140)}...`);
    });
    console.log(`\n[DRY RUN] ${entries.length} entradas, nada enviado.`);
    return;
  }

  const startAt = parseInt((process.argv.find(a => a.startsWith("--start=")) || "--start=1").split("=")[1], 10);
  const lista   = entries.slice(startAt - 1);
  console.log(`Enviando ${lista.length} de ${entries.length} entradas (a partir da #${startAt}) para client_id="${CLIENT_ID}"`);

  let ok = 0, falhas = 0;
  for (const entry of lista) {
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
    await new Promise(r => setTimeout(r, 5000));
  }
  console.log(`\nConcluído. ${ok} indexadas, ${falhas} falharam.`);
}

seed();
