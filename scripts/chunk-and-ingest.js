// ─── CHUNK + INGEST ───────────────────────────────────────────────────────────
// Pipeline genérico de RAG: pega um arquivo (PDF ou texto), separa em chunks,
// gera embedding de cada chunk (via /admin/knowledge, que usa Voyage) e guarda
// no knowledge_base. Uso para QUALQUER conteúdo novo — não só a apresentação
// institucional inicial. Nada é sobrescrito: cada chunk vira uma linha nova.
//
// Uso:
//   node scripts/chunk-and-ingest.js <arquivo.pdf|arquivo.txt> [opções]
//
// Opções:
//   --base <url>          URL do servidor (default: BASE_URL do env ou produção Railway)
//   --source-type <tipo>  source_type gravado no knowledge_base (default: "institucional")
//   --client-id <id>      client_id alvo (default: "viltrum")
//   --max-chars <n>       tamanho alvo de cada chunk em caracteres (default: 900)
//   --dry-run             só mostra os chunks gerados, não envia nada

const fs   = require("fs");
const path = require("path");
const axios = require("axios");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { args[key] = next; i++; }
      else args[key] = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

// PDFs com títulos em caixa alta e letter-spacing decorativo (ex: "V I L T R U M")
// extraem cada letra separada por espaço. Junta sequências de 3+ letras soltas
// de volta em palavras, sem mexer no texto corrido normal.
function desespacarTitulos(texto) {
  return texto.replace(/(?:\b[A-ZÀ-Ú]\s){2,}[A-ZÀ-Ú]\b/g, m => m.replace(/\s/g, ""));
}

async function extrairTexto(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    const pdfParse = require("pdf-parse");
    const buffer   = fs.readFileSync(filePath);
    const data     = await pdfParse(buffer);
    return desespacarTitulos(data.text);
  }
  return fs.readFileSync(filePath, "utf-8");
}

// Divide o texto em parágrafos (linhas em branco separam), depois agrupa
// parágrafos em chunks de até maxChars, carregando o último parágrafo do
// chunk anterior como início do próximo (overlap leve, mantém contexto).
function chunkTexto(texto, maxChars = 900) {
  const paragrafos = texto
    .split(/\n\s*\n/)
    .map(p => p.replace(/\s+/g, " ").trim())
    .filter(p => p.length > 0);

  const chunks = [];
  let atual = "";
  let ultimoParagrafo = "";

  for (const p of paragrafos) {
    if (p.length > maxChars) {
      // parágrafo gigante sozinho — fecha o chunk atual e manda ele isolado
      if (atual) { chunks.push(atual.trim()); atual = ""; }
      chunks.push(p.slice(0, maxChars));
      ultimoParagrafo = p.slice(0, maxChars);
      continue;
    }
    const candidato = atual ? atual + "\n\n" + p : p;
    if (candidato.length > maxChars && atual) {
      chunks.push(atual.trim());
      atual = ultimoParagrafo ? ultimoParagrafo + "\n\n" + p : p;
    } else {
      atual = candidato;
    }
    ultimoParagrafo = p;
  }
  if (atual.trim()) chunks.push(atual.trim());

  return chunks.filter(c => c.length > 20); // descarta fragmentos residuais
}

async function ingerir({ base, chunks, sourceType, clientId, dryRun, offset = 0, total = chunks.length }) {
  if (dryRun) {
    chunks.forEach((c, i) => {
      console.log(`\n── chunk ${i + 1}/${chunks.length} (${c.length} chars) ──`);
      console.log(c);
    });
    console.log(`\n[DRY RUN] ${chunks.length} chunks gerados, nada enviado.`);
    return;
  }

  // O /admin/knowledge sempre responde 500 (mesmo quando a causa é rate limit
  // do Voyage por trás) — então detectamos "429" pelo texto da mensagem, não
  // pelo status HTTP da nossa própria resposta.
  const ehRateLimit = err => {
    const msg = JSON.stringify(err.response?.data || err.message || "");
    return err.response?.status === 429 || msg.includes("429");
  };

  let ok = 0, falhas = 0;
  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i];
    let tentativas = 0;
    while (tentativas < 6) {
      try {
        const res = await axios.post(`${base}/admin/knowledge`, {
          content,
          source_type: sourceType,
          client_id: clientId,
          context: `chunk ${offset + i + 1}/${total}`,
        });
        console.log(`OK [${offset + i + 1}/${total}]`, res.data.preview);
        ok++;
        break;
      } catch (err) {
        tentativas++;
        if (ehRateLimit(err) && tentativas < 6) {
          console.log(`Rate limit, aguardando 15s (tentativa ${tentativas}/5)...`);
          await new Promise(r => setTimeout(r, 15000));
        } else {
          console.error(`ERRO [${offset + i + 1}/${total}]:`, err.response?.data || err.message);
          falhas++;
          break;
        }
      }
    }
    await new Promise(r => setTimeout(r, 4000)); // evita rajada
  }
  console.log(`\nConcluído. ${ok} indexados, ${falhas} falharam.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args._[0];
  if (!file) {
    console.error("Uso: node scripts/chunk-and-ingest.js <arquivo.pdf|arquivo.txt> [--base url] [--source-type tipo] [--client-id id] [--max-chars n] [--dry-run]");
    process.exit(1);
  }

  const base       = args.base || process.env.BASE_URL || "https://whatsapp-agente-production-5d73.up.railway.app";
  const sourceType = args["source-type"] || "institucional";
  const clientId   = args["client-id"] || "viltrum";
  const maxChars   = parseInt(args["max-chars"] || "900", 10);

  console.log("Lendo:", file);
  const texto      = await extrairTexto(file);
  const todosChunks = chunkTexto(texto, maxChars);
  const startChunk = parseInt(args["start-chunk"] || "1", 10); // 1-indexado, útil pra retomar após falha parcial
  const chunks     = todosChunks.slice(startChunk - 1);
  console.log(`Gerados ${todosChunks.length} chunks (~${maxChars} chars cada) para client_id="${clientId}". Enviando a partir do chunk ${startChunk}.`);

  await ingerir({ base, chunks, sourceType, clientId, dryRun: !!args["dry-run"], offset: startChunk - 1, total: todosChunks.length });
}

main().catch(err => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
