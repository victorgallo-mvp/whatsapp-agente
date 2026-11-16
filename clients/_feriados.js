// Calendário de feriados, compartilhado entre clientes.
//
// POR QUE ISSO EXISTE: a regra em texto não segura data. O prompt da Sorrix
// dizia "se hoje for sexta, o próximo horário que você oferece é segunda", e
// mesmo assim ela ofereceu sábado em 4 de 10 simulações — porque, para
// obedecer, ela precisava descobrir que dia da semana é amanhã. Feriado é a
// mesma armadilha, pior: ela não tem como saber que 20/11 é feriado.
//
// O conserto é o item 1 do LICOES-DE-PROMPT.md: tirar a conta do caminho. O
// servidor calcula os próximos dias de atendimento e injeta a lista pronta no
// contexto. A instrução vira "ofereça da lista", que é consulta, não dedução.
//
// Os móveis são CALCULADOS a partir da Páscoa, não digitados: lista digitada
// vence no fim do ano e ninguém lembra de atualizar. Quem percebe é o paciente
// que recebeu confirmação para um dia em que a clínica estava fechada.

// Páscoa pelo algoritmo gregoriano anônimo (Meeus/Jones/Butcher).
function pascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

const maisDias = (d, n) => new Date(d.getTime() + n * 86400000);
const iso = d => d.toISOString().slice(0, 10);

// Feriados nacionais fixos (Lei 662/1949, 6.802/1980 e 14.759/2023, que tornou
// 20 de novembro feriado nacional).
const FIXOS_NACIONAIS = [
  ["01-01", "Confraternização Universal"],
  ["04-21", "Tiradentes"],
  ["05-01", "Dia do Trabalho"],
  ["09-07", "Independência"],
  ["10-12", "Nossa Senhora Aparecida"],
  ["11-02", "Finados"],
  ["11-15", "Proclamação da República"],
  ["11-20", "Consciência Negra"],
  ["12-25", "Natal"],
];

// Derivados da Páscoa. Carnaval, Cinzas e Corpus Christi são ponto facultativo
// por lei, não feriado — mas clínica costuma fechar, e o erro de não marcar num
// dia aberto custa um horário; o de marcar num dia fechado custa um paciente
// viajando até a porta fechada. O default erra para o lado seguro, e cada
// cliente remove o que de fato funciona em `trabalhaEm`.
function MOVEIS(ano) {
  const p = pascoa(ano);
  return [
    [iso(maisDias(p, -48)), "Carnaval (segunda)"],
    [iso(maisDias(p, -47)), "Carnaval (terça)"],
    [iso(maisDias(p, -46)), "Quarta-feira de Cinzas"],
    [iso(maisDias(p, -2)),  "Sexta-feira Santa"],
    [iso(maisDias(p, 60)),  "Corpus Christi"],
  ];
}

// feriadosDoAno(ano, extras) -> { "2026-11-20": "Consciência Negra", ... }
// `extras` é a lista do cliente: feriado municipal, aniversário da cidade,
// padroeiro, recesso. Formato ["MM-DD", "nome"] para o que repete todo ano, ou
// ["AAAA-MM-DD", "nome"] para data única (recesso de um ano só).
function feriadosDoAno(ano, extras = []) {
  const m = {};
  for (const [md, nome] of FIXOS_NACIONAIS) m[`${ano}-${md}`] = nome;
  for (const [data, nome] of MOVEIS(ano)) m[data] = nome;
  for (const [quando, nome] of extras) {
    m[/^\d{4}-/.test(quando) ? quando : `${ano}-${quando}`] = nome;
  }
  return m;
}

const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

// Os próximos `quantos` dias em que o cliente atende, a partir de hoje
// (inclusive, se hoje ainda der). Devolve o que a IA precisa ler, já escrito:
//   [{ iso, rotulo: "segunda, dia 17/11", diaSemana: 1 }]
//
// `diasQueAtende` são índices de 0 (domingo) a 6. `extras` são os feriados
// próprios do cliente. `pularHoje` serve para quando já passou do último
// horário do dia.
function proximosDiasDeAtendimento({
  quantos = 5,
  diasQueAtende = [1, 2, 3, 4, 5],
  extras = [],
  hoje = new Date(),
  pularHoje = false,
} = {}) {
  const base = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
  const out = [];
  const cache = {};
  for (let i = pularHoje ? 1 : 0; out.length < quantos && i < 120; i++) {
    const d = maisDias(base, i);
    const ano = d.getUTCFullYear();
    cache[ano] = cache[ano] || feriadosDoAno(ano, extras);
    const key = iso(d);
    if (!diasQueAtende.includes(d.getUTCDay())) continue;
    if (cache[ano][key]) continue;
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    out.push({ iso: key, rotulo: `${SEMANA[d.getUTCDay()]}, dia ${dd}/${mm}`, diaSemana: d.getUTCDay() });
  }
  return out;
}

// Feriados que caem nos próximos `dias`, para a IA poder explicar por que não
// ofereceu determinada data em vez de só omitir.
function feriadosProximos({ dias = 21, extras = [], hoje = new Date() } = {}) {
  const base = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
  const out = [];
  const cache = {};
  for (let i = 0; i <= dias; i++) {
    const d = maisDias(base, i);
    const ano = d.getUTCFullYear();
    cache[ano] = cache[ano] || feriadosDoAno(ano, extras);
    const nome = cache[ano][iso(d)];
    if (!nome) continue;
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    out.push({ iso: iso(d), rotulo: `${dd}/${mm}`, nome, diaSemana: SEMANA[d.getUTCDay()] });
  }
  return out;
}

module.exports = { pascoa, feriadosDoAno, proximosDiasDeAtendimento, feriadosProximos, SEMANA };
