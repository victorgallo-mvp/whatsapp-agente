// ─── EXTRATOR DE CONVERSAS DO EVOLUTION ──────────────────────────────────────
// Puxa o histórico que o WhatsApp sincronizou para o Postgres do Evolution no
// momento em que o número foi vinculado, e monta transcrições legíveis, uma por
// cliente.
//
// Por que existe: o history sync chega uma vez só, na vinculação, e fica dentro
// do banco do Evolution num formato cru (paginado, com o texto enterrado em
// message.<tipo>.text e o telefone às vezes escondido atrás de um @lid). Ler
// isso na mão não escala. Aqui a gente transforma em conversa lida de cima a
// baixo, que é o formato em que dá para diagnosticar atendimento.
//
// As transcrições contêm dados reais de cliente. Elas saem FORA do repositório,
// no diretório que você passar em --saida. Não commite isso.
//
// Uso:
//   EVOLUTION_URL=... EVOLUTION_API_KEY=... EVOLUTION_INSTANCE=... \
//     node scripts/extrair-conversas-evolution.js --saida /tmp/conversas
//
//   --min 6          só conversas com pelo menos 6 mensagens (padrão)
//   --max-chats 100  limita quantas conversas gravar (padrão: todas)
//   --dias 180       só mensagens dos últimos N dias (padrão: tudo)

const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

const URL      = process.env.EVOLUTION_URL;
const KEY      = process.env.EVOLUTION_API_KEY;
const INSTANCE = process.env.EVOLUTION_INSTANCE;

const arg = (n, def) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : def; };
const SAIDA     = arg("saida", "/tmp/conversas-evolution");
const MIN_MSGS  = parseInt(arg("min", "6"), 10);
const MAX_CHATS = parseInt(arg("max-chats", "0"), 10) || Infinity;
const DIAS      = parseInt(arg("dias", "0"), 10) || 0;

if (!URL || !KEY || !INSTANCE) {
  console.error("Faltam EVOLUTION_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE no ambiente.");
  process.exit(1);
}

// O nome da instância vai no path da URL e pode ter espaço (o painel do
// Evolution aceita nome com espaço na criação). Sem encode, vira URL inválida.
const ROTA = `${URL}/chat/findMessages/${encodeURIComponent(INSTANCE)}`;

// O texto fica em lugares diferentes conforme o tipo. Mensagem de mídia não tem
// texto nenhum, e mesmo assim precisa aparecer na transcrição: um "(áudio)" no
// meio de uma negociação é informação, porque explica um salto no assunto.
function textoDaMensagem(m) {
  const msg = m.message || {};
  if (msg.conversation)                    return msg.conversation;
  if (msg.extendedTextMessage?.text)       return msg.extendedTextMessage.text;
  if (msg.imageMessage)                    return "(imagem)" + (msg.imageMessage.caption ? " " + msg.imageMessage.caption : "");
  if (msg.videoMessage)                    return "(vídeo)" + (msg.videoMessage.caption ? " " + msg.videoMessage.caption : "");
  if (msg.audioMessage)                    return "(áudio)";
  if (msg.documentMessage)                 return "(documento: " + (msg.documentMessage.fileName || "arquivo") + ")";
  if (msg.stickerMessage)                  return "(figurinha)";
  if (msg.locationMessage)                 return "(localização)";
  if (msg.contactMessage)                  return "(contato)";
  if (msg.reactionMessage)                 return "(reação " + (msg.reactionMessage.text || "") + ")";
  if (msg.listResponseMessage?.title)      return msg.listResponseMessage.title;
  if (msg.buttonsResponseMessage?.selectedDisplayText) return msg.buttonsResponseMessage.selectedDisplayText;
  return "";
}

// Com addressingMode "lid" o remoteJid é um identificador interno e o telefone
// real vem em remoteJidAlt. Agrupar pelo lid espalharia a mesma pessoa em
// conversas diferentes conforme o formato que o WhatsApp usou em cada trecho.
function chaveDoChat(m) {
  const k = m.key || {};
  const alt = k.remoteJidAlt || "";
  const jid = k.remoteJid || "";
  const escolhido = alt.endsWith("@s.whatsapp.net") ? alt : jid;
  return escolhido.replace(/@s\.whatsapp\.net$/, "").replace(/@lid$/, "").replace(/@g\.us$/, "@GRUPO");
}

async function puxarPagina(page) {
  const r = await axios.post(ROTA, { where: {}, page, offset: 200 },
    { headers: { apikey: KEY, "Content-Type": "application/json" }, timeout: 120000 });
  const bloco = r.data?.messages || r.data || {};
  return { registros: bloco.records || [], paginas: bloco.pages || 1, total: bloco.total || 0 };
}

async function main() {
  fs.mkdirSync(SAIDA, { recursive: true });

  const corte = DIAS ? Math.floor(Date.now() / 1000) - DIAS * 86400 : 0;
  const chats = new Map();
  let pagina = 1, paginas = 1, lidas = 0;

  do {
    const { registros, paginas: p, total } = await puxarPagina(pagina);
    paginas = p;
    if (pagina === 1) console.log(`${total} mensagens em ${paginas} páginas.`);

    for (const m of registros) {
      lidas++;
      const ts = Number(m.messageTimestamp) || 0;
      if (corte && ts < corte) continue;

      const chave = chaveDoChat(m);
      if (!chave || chave.endsWith("@GRUPO")) continue;   // grupo não é atendimento

      const texto = textoDaMensagem(m);
      if (!texto) continue;

      if (!chats.has(chave)) chats.set(chave, { nome: "", msgs: [] });
      const c = chats.get(chave);
      if (!c.nome && !m.key?.fromMe && m.pushName) c.nome = String(m.pushName).trim();
      c.msgs.push({ ts, de: m.key?.fromMe ? "LOJA" : "CLIENTE", texto });
    }

    process.stdout.write(`\r  página ${pagina}/${paginas} — ${lidas} mensagens, ${chats.size} conversas`);
    pagina++;
  } while (pagina <= paginas);

  console.log("\n");

  // Conversa curta quase sempre é engano, número errado ou "oi" sem resposta.
  // Não ajuda a diagnosticar atendimento e polui a amostra.
  const uteis = [...chats.entries()]
    .map(([fone, c]) => ({ fone, ...c, msgs: c.msgs.sort((a, b) => a.ts - b.ts) }))
    .filter(c => c.msgs.length >= MIN_MSGS)
    .filter(c => c.msgs.some(m => m.de === "CLIENTE") && c.msgs.some(m => m.de === "LOJA"))
    .sort((a, b) => b.msgs.length - a.msgs.length)
    .slice(0, MAX_CHATS);

  const indice = [];
  for (const c of uteis) {
    const quando = new Date((c.msgs[c.msgs.length - 1].ts || 0) * 1000).toISOString().slice(0, 10);
    const arquivo = `${quando}_${c.fone}.txt`;
    const cabecalho = `# ${c.nome || "(sem nome)"} — ${c.fone}\n# ${c.msgs.length} mensagens | última em ${quando}\n\n`;
    const corpo = c.msgs.map(m => {
      const h = new Date(m.ts * 1000).toISOString().slice(0, 16).replace("T", " ");
      return `[${h}] ${m.de}: ${m.texto}`;
    }).join("\n");
    fs.writeFileSync(path.join(SAIDA, arquivo), cabecalho + corpo);
    indice.push({ arquivo, nome: c.nome, fone: c.fone, msgs: c.msgs.length, ultima: quando });
  }

  fs.writeFileSync(path.join(SAIDA, "_indice.json"), JSON.stringify(indice, null, 2));

  console.log(`${chats.size} conversas no total, ${uteis.length} com ${MIN_MSGS}+ mensagens dos dois lados.`);
  console.log(`Gravadas em ${SAIDA}`);
  console.log(`\nAs 10 maiores:`);
  indice.slice(0, 10).forEach(i => console.log(`  ${String(i.msgs).padStart(4)} msgs  ${i.ultima}  ${i.nome || i.fone}`));
}

main().catch(e => { console.error("\nErro:", e.response?.data || e.message); process.exit(1); });
