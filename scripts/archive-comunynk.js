// ─── ARQUIVAMENTO DOS DADOS DA COMUNYNK ──────────────────────────────────────
// Renomeia as tabelas operacionais atuais (mensagens, clientes, leads, visitas)
// para "<nome>_comunynk_archive" e recria tabelas novas vazias com o mesmo
// schema. Nada é apagado: o histórico da Comunynk continua 100% consultável
// no banco, só passa a não aparecer mais no dashboard nem nas buscas ativas
// do servidor (que sempre usam os nomes de tabela originais).
//
// knowledge_base NÃO é renomeada — ela já tem uma coluna client_id que separa
// os registros por cliente (ex: "comunynk" x "viltrum"), então o histórico de
// conhecimento antigo fica preservado nas mesmas linhas, só filtrado.
//
// Uso:
//   DATABASE_URL=postgres://... node scripts/archive-comunynk.js
//   (ou: railway run node scripts/archive-comunynk.js, se DATABASE_URL só existir no Railway)
//
// É seguro rodar mais de uma vez: cada rename só acontece se a tabela de
// origem existir e a tabela _archive de destino ainda não existir.

const { Pool } = require("pg");

const TABELAS = ["mensagens", "clientes", "leads", "visitas"];
const SUFIXO  = "_comunynk_archive";

async function tabelaExiste(db, nome) {
  const res = await db.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)`,
    [nome]
  );
  return res.rows[0].exists;
}

async function contarLinhas(db, nome) {
  const res = await db.query(`SELECT COUNT(*)::int AS n FROM ${nome}`);
  return res.rows[0].n;
}

async function criarTabelasNovas(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS mensagens (
      id         SERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_mensagens_user_id ON mensagens (user_id, created_at)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      phone      TEXT PRIMARY KEY,
      nome       TEXT,
      empresa    TEXT,
      endereco   TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS leads (
      phone               TEXT PRIMARY KEY,
      nome                TEXT,
      empresa             TEXT,
      endereco            TEXT,
      stage               TEXT DEFAULT 'novo',
      profile             JSONB DEFAULT '{}',
      last_summary        TEXT,
      total_interactions  INT DEFAULT 0,
      last_interaction_at TIMESTAMPTZ,
      profile_updated_at  TIMESTAMPTZ,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      arte_url            TEXT,
      arte_raw_msg        JSONB,
      olivia_ativa        BOOLEAN DEFAULT TRUE
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS visitas (
      id               SERIAL PRIMARY KEY,
      user_id          TEXT NOT NULL,
      dados            TEXT NOT NULL,
      data_visita      DATE,
      horario          TEXT,
      lembrete_enviado BOOLEAN DEFAULT FALSE,
      cancelado        BOOLEAN DEFAULT FALSE,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL nao definido. Rode com: DATABASE_URL=postgres://... node scripts/archive-comunynk.js");
    process.exit(1);
  }

  const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  try {
    console.log("Conectado. Iniciando arquivamento...\n");

    for (const tabela of TABELAS) {
      const origemExiste = await tabelaExiste(db, tabela);
      if (!origemExiste) {
        console.log(`[SKIP] Tabela "${tabela}" nao existe, nada a arquivar.`);
        continue;
      }
      const destino = tabela + SUFIXO;
      const destinoExiste = await tabelaExiste(db, destino);
      if (destinoExiste) {
        console.log(`[SKIP] "${destino}" ja existe — arquivamento ja foi feito antes.`);
        continue;
      }
      const linhas = await contarLinhas(db, tabela);
      await db.query(`ALTER TABLE ${tabela} RENAME TO ${destino}`);
      console.log(`[OK] "${tabela}" (${linhas} linhas) renomeada para "${destino}".`);
    }

    console.log("\nCriando tabelas operacionais novas e vazias...");
    await criarTabelasNovas(db);
    console.log("Pronto. mensagens, clientes, leads e visitas estao vazias e prontas para a operacao da Viltrum.");
    console.log("knowledge_base nao foi tocada — os registros antigos (client_id = \"comunynk\") continuam la, so nao sao mais buscados.");
  } catch (err) {
    console.error("Erro no arquivamento:", err.message);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
