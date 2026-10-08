// ─── ATRIBUIÇÃO RETROATIVA DE ANÚNCIO ────────────────────────────────────────
// Varre o banco do Evolution procurando cliques de click-to-WhatsApp e preenche
// anuncio_id, anuncio_ctwa_clid, anuncio_url, anuncio_fonte e anuncio_origem nos
// leads que estão sem.
//
// Por que existe: a captura ao vivo só começou em 08/09 e, até 08/10, perdia o
// clique quando ele chegava numa mensagem sem corpo de texto — que é como o
// WhatsApp entrega a maior parte deles. Os identificadores nunca deixaram de
// chegar: estavam em contextInfo.externalAdReply e iam para o lixo. O banco do
// Evolution guardou tudo, então a atribuição é recuperável.
//
// Qual clique vence, quando o mesmo telefone clicou mais de uma vez: o PRIMEIRO.
// Para custo por lead o que interessa é a aquisição, o anúncio que trouxe a
// pessoa. O último clique diria em que anúncio ela mexeu depois de já ser
// cliente, o que não é atribuição.
//
// Idempotente: o endpoint só preenche campo vazio, então rodar de novo não
// sobrescreve nem duplica.
//
// Uso:
//   EVOLUTION_URL=... EVOLUTION_API_KEY=... EVOLUTION_INSTANCE=... \
//   BASE_URL=https://<deploy-do-cliente> node scripts/retroativo-anuncios.js
//
//   --dry-run   só mostra o que faria

const axios = require("axios");

const URL      = process.env.EVOLUTION_URL;
const KEY      = process.env.EVOLUTION_API_KEY;
const INSTANCE = process.env.EVOLUTION_INSTANCE;
const BASE     = process.env.BASE_URL;
const DRY      = process.argv.includes("--dry-run");

if (!URL || !KEY || !INSTANCE || !BASE) {
  console.error("Faltam EVOLUTION_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE e BASE_URL.");
  process.exit(1);
}

const ROTA = `${URL}/chat/findMessages/${encodeURIComponent(INSTANCE)}`;

async function pagina(page) {
  const r = await axios.post(ROTA, { where: {}, page, offset: 200 },
    { headers: { apikey: KEY, "Content-Type": "application/json" }, timeout: 120000 });
  const b = r.data?.messages || {};
  return { registros: b.records || [], paginas: b.pages || 1 };
}

// O contextInfo aparece em lugares diferentes conforme o tipo da mensagem, e no
// caso mais comum (clique sem corpo de texto) ele vem no topo do registro.
function extrair(m) {
  const msg = m.message || {};
  const ci = m.contextInfo
    || msg.extendedTextMessage?.contextInfo
    || msg.imageMessage?.contextInfo
    || null;
  const ad = ci?.externalAdReply;
  if (!ad) return null;

  const k = m.key || {};
  const alt = k.remoteJidAlt || "";
  const jid = alt.endsWith("@s.whatsapp.net") ? alt : (k.remoteJid || "");
  const phone = jid.replace(/@s\.whatsapp\.net$/, "").replace(/@lid$/, "").replace(/\D/g, "");
  if (!phone || jid.endsWith("@g.us")) return null;

  const titulo = (ad.title || "").trim();
  const corpo  = (ad.body  || "").trim();
  const id     = String(ad.sourceId || "").trim();
  const clid   = String(ad.ctwaClid || ci.ctwaClid || "").trim();
  if (!titulo && !corpo && !id && !clid) return null;

  return {
    phone,
    ts:    Number(m.messageTimestamp) || 0,
    id,
    clid:  clid.slice(0, 255),
    url:   (ad.sourceUrl || "").slice(0, 300),
    fonte: (ci.conversionSource || ad.sourceType || "").slice(0, 40),
    texto: [titulo.slice(0, 200), corpo.slice(0, 900)].filter(Boolean).join("\n"),
    titulo,
  };
}

async function main() {
  console.log("Varrendo o Evolution atrás de cliques de anúncio...");
  const primeiros = new Map();   // phone -> clique mais antigo
  let pagina_n = 1, paginas = 1, total = 0, cliques = 0;

  do {
    let bloco;
    try { bloco = await pagina(pagina_n); }
    catch (e) { console.error(`\n  [página ${pagina_n} falhou: ${e.message}]`); pagina_n++; continue; }
    paginas = bloco.paginas;

    for (const m of bloco.registros) {
      total++;
      const a = extrair(m);
      if (!a) continue;
      cliques++;
      const atual = primeiros.get(a.phone);
      if (!atual || a.ts < atual.ts) primeiros.set(a.phone, a);
    }
    process.stdout.write(`\r  página ${pagina_n}/${paginas} — ${total} mensagens, ${cliques} cliques, ${primeiros.size} leads`);
    pagina_n++;
  } while (pagina_n <= paginas);

  console.log("\n");
  const registros = [...primeiros.values()].sort((a, b) => a.ts - b.ts);

  const porAnuncio = {};
  for (const r of registros) {
    const k = r.titulo || r.id || "(sem título)";
    porAnuncio[k] = (porAnuncio[k] || 0) + 1;
  }
  console.log(`${cliques} cliques, ${registros.length} leads distintos.`);
  console.log(`com id do anúncio: ${registros.filter(r => r.id).length} | com ctwa_clid: ${registros.filter(r => r.clid).length}`);
  console.log(`\nTop anúncios por leads trazidos:`);
  Object.entries(porAnuncio).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([t, n]) => console.log(`  ${String(n).padStart(4)}  ${t.slice(0, 78)}`));

  if (DRY) { console.log("\n--dry-run: nada enviado."); return; }

  // Lotes pequenos: o endpoint faz um UPDATE por registro e 700 de uma vez
  // estouraria o timeout do Railway.
  const LOTE = 50;
  let ok = 0, semLead = 0, erros = 0;
  for (let i = 0; i < registros.length; i += LOTE) {
    const fatia = registros.slice(i, i + LOTE);
    try {
      const r = await axios.post(`${BASE}/admin/anuncios/retroativo`, { registros: fatia }, { timeout: 120000 });
      ok      += r.data.atualizados || 0;
      semLead += r.data.sem_lead_ou_ja_preenchido || 0;
      erros   += r.data.erros || 0;
      process.stdout.write(`\r  enviados ${Math.min(i + LOTE, registros.length)}/${registros.length} — atualizados ${ok}`);
    } catch (e) {
      console.error(`\n  lote ${i} falhou: ${e.response?.data?.error || e.message}`);
      erros += fatia.length;
    }
  }
  console.log(`\n\nConcluído. ${ok} leads ganharam atribuição, ${semLead} sem lead no banco ou já preenchidos, ${erros} erros.`);
  console.log(`\nOs "sem lead" são esperados: muita gente clicou no anúncio e nunca mandou mensagem,`);
  console.log(`então nunca virou lead do nosso lado.`);
}

main().catch(e => { console.error("\nErro:", e.response?.data || e.message); process.exit(1); });
