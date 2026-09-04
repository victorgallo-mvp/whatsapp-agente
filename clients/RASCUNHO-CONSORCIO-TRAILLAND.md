# Rascunho: base de conhecimento de consórcio — TrailLand

**Status: NÃO INDEXADO.** Este arquivo é para revisão antes de virar entrada no
RAG. Levantado a partir de 497 mensagens da loja sobre consórcio, dentro das 893
conversas que o WhatsApp sincronizou na vinculação do número (04/09/2026).

Consórcio aparece em **321 das 893 conversas (36%)** — assunto mais frequente
que preço. É o maior buraco de conhecimento do agente hoje.

---

## Uma ressalva sobre a origem deste material

Boa parte das explicações longas que a loja mandou são definições genéricas de
consórcio, do tipo que se copia de uma busca ou de um assistente. Elas descrevem
corretamente **como consórcio funciona**, mas quase nunca trazem o número da
TrailLand: qual a taxa, qual o prazo, qual a carta de cada modelo.

Então este rascunho tem duas naturezas bem diferentes, e elas não podem ser
tratadas do mesmo jeito:

- **Bloco A** — o que dá para afirmar, porque é conceito de consórcio ou é fato
  observado repetidamente nas conversas.
- **Bloco B** — o que o agente vai precisar responder e **não temos**. Indexar
  invenção aqui é pior que não ter nada: consórcio é contrato, e informação
  errada sobre prazo ou taxa vira problema de verdade.

---

## BLOCO A — para indexar depois da sua revisão

### A1. Administradora
A TrailLand trabalha com a **Âncora Consórcios** (Âncora Administradora, de
Franca/SP). Não é consórcio próprio da loja: a loja é o ponto de venda, e a
gestão do grupo, as assembleias e a liberação da carta são da Âncora.

### A2. O que é a taxa de administração
Valor cobrado pela Âncora para formar e gerir o grupo: assembleias,
contemplações, emissão de boletos, gestão financeira. **Não é juro** — é o preço
do serviço. Incide sobre o **valor total da carta de crédito**, não sobre saldo
devedor, e varia conforme o plano contratado.

### A3. Reajuste anual
Acontece no **mês de aniversário do grupo** e serve para a carta manter o poder
de compra frente à inflação. É aplicado sobre o saldo devedor e reflete nas
parcelas futuras.

### A4. Contemplação
Acontece por **sorteio em assembleia** ou por **lance**. O lance é uma oferta
para antecipar a contemplação em vez de depender do sorteio; se vencer, o valor
abate parcelas. A contemplação pode ser usada para **reduzir o valor da parcela**
ou **diminuir a quantidade de meses restantes** — o cliente escolhe.

### A5. Fiador
A Âncora **pode** exigir fiador no momento da contemplação. Não é automático para
todo mundo, é critério da administradora. Nunca prometer que não vai precisar.

### A6. Plano 70%
Modalidade de parcela reduzida: o cliente paga mensalidades calculadas sobre 70%
do valor do bem até ser contemplado.

### A7. Consórcio de fora
Se o cliente já tem um consórcio de outra administradora que cobre off-road, a
TrailLand **aceita** — fornece os dados necessários (chassi, modelo, nota). Mas a
parte burocrática fica com o cliente e o representante dele, porque a loja não
tem acesso ao processo da outra administradora.

### A8. Acessórios entram na carta
Acessórios podem ser incluídos no valor da carta de crédito.

### A9. Consórcio não serve para quem tem pressa
Postura observada e correta: se o cliente quer a moto **com urgência**, o
caminho é cartão, não consórcio. Consórcio é para quem tem prazo. Vale a IA
dizer isso com franqueza em vez de empurrar consórcio para quem quer sair
pilotando.

---

## BLOCO B — o que falta, e precisa vir da TrailLand

Sem isso o agente continua caindo em `CONSULTAR_TIME` justamente nas perguntas
que mais aparecem.

1. **Qual a taxa de administração, em %?** É a pergunta mais frequente e a que
   não tem resposta em nenhuma das 497 mensagens.
2. **Quais os prazos disponíveis** (quantos meses) e qual o padrão vendido.
3. **Valor da carta de crédito por modelo.** Apareceu uma única vez, R$ 28.890,
   sem dizer de qual moto.
4. **Valor da parcela por modelo/prazo** — o cliente pergunta "quanto fica por
   mês", que é a pergunta comercial de verdade.
5. **Tem taxa de adesão?** Quanto? É diluída ou paga na entrada?
6. **Fundo de reserva** existe e qual o percentual.
7. **Aceita CPF com restrição?** Apareceu uma menção afirmando que sim. Uma só
   não sustenta uma afirmação dessas — se estiver errado, gera falsa expectativa
   em cliente negativado.
8. **Seguro é obrigatório?** Quanto custa.
9. **Prazo entre contemplação e retirada da moto.**
10. **Regra de desistência:** como funciona a restituição, em quanto tempo, com
    qual desconto.

---

## Ponto separado: os anúncios contradizem a tabela

Descoberto no mesmo levantamento, via metadados de origem dos leads que vêm de
anúncio (23% do total). O anúncio que o cliente clicou vem inteiro no webhook,
com preço e condição.

| Item | O anúncio promete | Nossa tabela / prompt |
|---|---|---|
| Attack 200 EFI | de R$ 28.990 por **R$ 23.900** | R$ 27.390 |
| Parcelamento | **18x sem juros** | 21x com juros |
| 10x sem juros | **toda a linha de quadriciclos** | só a MXF 270 FI |
| Loncin 550 | anunciado com ficha completa | não existe na tabela |
| MXF 270 FI | R$ 27.500, 13.750 + 10x 1.375 | confere |

Isso não é problema de RAG, é conflito de dado comercial. O cliente clica num
anúncio de R$ 23.900 e recebe R$ 27.390 — parece propaganda enganosa e o lead
morre na primeira resposta. Precisa ser resolvido com a loja antes de ligar o
agente para leads de anúncio.
