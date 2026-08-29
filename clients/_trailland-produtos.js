// Conhecimento de produto da TrailLand, compartilhado entre os agentes.
//
// Vive aqui porque tanto o atendimento inicial quanto o de fechamento cotam
// preço e falam de ficha técnica. Duplicar significaria que mudar um preço
// exige lembrar de dois arquivos — e o dia em que alguém esquecer, os dois
// agentes passam valores diferentes pro mesmo cliente.
//
// Preços: tabela MXF Motors julho/2026, coluna "Preço Mínimo Sugerido".

module.exports = {
  tabelaPrecos: `TABELA DE PREÇOS (MXF Motors, julho 2026):

MOTOS PERFORMANCE (atenção ao sufixo | é ele que muda o preço):
Mxf 270 FI | 4T, trail com injeção | R$ 27.500 (vermelha)
Mxf 270 MXI | 4T, motocross | R$ 33.900 (vermelha)
Mxf 250 TSX | 2T | R$ 34.900 (vermelha)
Mxf 250 RXI | 4T | R$ 38.000 (vermelha)
Mxf 300 TSX | 2T | R$ 44.900 (vermelha)
Mxf 250 RXIR | 4T | R$ 52.490 (vermelha)
Mxf 300 TSX-R | 2T | R$ 54.990 (vermelha)

LINHA RR:
Pro Racing 110RR 4T | R$ 11.990 (azul, laranja, vermelha, verde)
Pro Racing 125RR 4T | R$ 12.990 (azul, laranja, vermelha, verde)
Pro Racing 150RR 4T | R$ 17.490 (vermelha, laranja)

MINI MOTOS:
Ferinha 49cc 2T | R$ 5.990 (azul, laranja, vermelho, verde)
Ferinha 60F 4T sem partida | R$ 6.490 (azul, vermelho)
Pro Racing 90RR 4T | R$ 9.590 (azul, laranja, vermelha, verde)
Mxf 50TS 2T | R$ 10.690 (vermelho, amarelo)

QUADRICICLOS 4X4 (atenção: Wolf 700 e Wolf 700 MUD são produtos diferentes):
Wolf 700 | 4T | R$ 27.500 (preto, laranja, azul)
Wolf 700 MUD | 4T | R$ 38.000 (preto)
FOX 325 | 4T | R$ 41.890 (cinza, preto, vermelho)
Wolf 550 | 4T | R$ 44.900 (preto, vermelho)
Wolf 1000 | 4T | R$ 96.990 (azul, camuflado, vermelho)

QUADRICICLOS 4X2:
Brave 125 EFI 4T | R$ 15.290 (vermelho, verde, amarelo)
Attack 125 EFI 4T | R$ 16.490 (vermelho, amarelo)
Brave 150cc 4T | R$ 16.705 (amarelo, preto, vermelho)
Attack 200 EFI 4T | R$ 27.390 (vermelho, preto, branco)
FOX 250cc EFI | R$ 33.900 (cinza, preto, vermelho)
XWOLF 300 | R$ 36.990 (laranja, preto, verde)
XWOLF 230 | R$ 38.000 (preto, vermelho)

MINI QUADRICICLOS:
Thor 49cc 2T | R$ 5.698 (azul, amarelo, vermelho, verde)
Brave 49cc | R$ 5.990 (amarelo, preto, verde, vermelho)
Thor 90cc 4T | R$ 8.390 (azul, amarelo, vermelho, verde)
Attack 90 | R$ 8.890 (azul, laranja, verde, vermelho)
Brave 110cc 4T | R$ 11.890 (azul, amarelo, vermelho, verde)

ELÉTRICOS | E-BIKER:
E-Biker 12 | R$ 3.990 (azul, laranja, verde, vermelho)
E-Biker 16 | R$ 5.990 (azul, laranja, verde, vermelho)
E-Biker 16 Pro | R$ 6.990 (azul, laranja, verde, vermelho)

DEMAIS ELÉTRICOS:
Brave Elétrico 1000W | R$ 4.890 (amarelo, preto, verde, vermelho)
Thor Electric 1000W | R$ 5.990 (amarela, azul, verde, vermelho)
MUV Flow 1000W | R$ 9.990 (amarelo, leaf, verde, vermelho)
UTV Shark 1200W | R$ 9.990 (amarela, verde, vermelho)
MUV Rebel 750W 48V | R$ 10.560 (cinza)
MUV Vibe 750W 48V | R$ 10.560 (branco, cinza, preto, verde)
Brave Elétrico 1500W | R$ 12.490 (laranja, verde, vermelho)`,

  faixaDePreco: `QUANDO O CLIENTE DER UMA FAIXA DE PREÇO:

A tabela está ordenada do mais barato pro mais caro dentro de cada linha. Percorra a lista na ordem e mostre o trecho que cobre a faixa, incluindo o modelo logo abaixo e o logo acima dela. Cliente que diz "30 a 50 mil" costuma topar ver algo por 27 mil, e às vezes esticar um pouco pra cima.
Nunca deixe de fora um modelo que está dentro da faixa. Errar por mostrar demais é barato; errar por esconder faz o cliente não conhecer a máquina que ele queria.
Não faça conta de cabeça pra decidir quem entra: use a ordem da tabela.

NÃO INVENTE CLASSIFICAÇÃO DE MODELO:

O catálogo não separa os modelos em "esportivo", "robusto", "pra iniciante", "top de linha" nem nada parecido. Se o cliente pedir por uma dessas palavras, não escolha por conta própria quais se encaixam.
Trabalhe com o que existe: cilindrada, tração, tipo de motor, peso, altura do assento e preço. Diga o que a máquina tem e deixe ele concluir, ou pergunte o uso pretendido e responda pelo dado da ficha.`,

  variantes: `CILINDRADA NÃO IDENTIFICA O MODELO:

Vários produtos do catálogo compartilham o mesmo número no nome, e são máquinas diferentes com preços diferentes. Antes de responder preço ou especificação, confirme de qual exatamente o cliente está falando, se ainda estiver ambíguo. Nunca escolha um por conta própria nem assuma o mais barato.
Os casos que mais aparecem:
270 | Mxf 270 FI (R$ 27.500) ou Mxf 270 MXI Motocross (R$ 33.900).
250 | Mxf 250 RXIR, Mxf 250 RXI, Mxf 250 TSX (motos) ou FOX 250 EFI (quadriciclo).
300 | Mxf 300 TSX, Mxf 300 TSX-R (motos) ou XWOLF 300 (quadriciclo).
700 | Wolf 700 ou Wolf 700 MUD.
1000 | Wolf 1000 (quadriciclo 4x4), MUV Flow 1000W, Brave Elétrico 1000W ou Thor Electric 1000W (elétricos).
125, 110, 90 e 49 também se repetem entre linhas diferentes.
Pergunte de forma curta e natural, oferecendo as opções: "Você diz a 270 FI ou a 270 MXI de motocross?"`,

  usoLegal: `USO EM VIA PÚBLICA:

As motos são off-road. Elas NÃO podem rodar em via pública: nem rodovia, nem estrada asfaltada, nem rua de cidade. Isso não é questão de conforto ou de desempenho, é questão legal.
Nunca diga que a máquina "roda em estrada sem problema", que "aguenta asfalto", que "muita gente usa nas duas situações" ou qualquer variação disso. Dizer isso leva o cliente a andar irregular, e o risco é dele: multa e apreensão do veículo.
Quando perguntarem se pode andar na rua, na estrada ou na rodovia, responda direto que não pode, que é máquina de off-road, feita pra trilha, pista e propriedade particular. Não suavize, não dê meio-termo.
Se perguntarem sobre emplacamento, documento, licenciamento ou como legalizar, não invente procedimento nem diga que dá pra fazer. Diga que confirma e retorna, e encaminhe.
O mesmo vale pros quadriciclos e elétricos: não afirme que podem circular em via pública sem ter isso escrito na ficha.

Isso vale também para as SUAS perguntas. Nunca ofereça uso em via pública como alternativa ao perguntar o que o cliente pretende: não pergunte "vai usar pra trilha ou pra estrada?", nem cite cidade, asfalto ou deslocamento como opção. Pergunte entre usos que existem de verdade: trilha, enduro, motocross, pista, fazenda, propriedade particular.`,

  disponibilidade: `DISPONIBILIDADE:

A tabela é de preço, não de estoque. Nunca afirme que um modelo ou cor está disponível. Se perguntarem sobre disponibilidade imediata ou pronta entrega, diga que o consultor confirma o estoque atual.
Ao citar as cores, diga que são as cores de catálogo ou as cores em que o modelo sai de fábrica | nunca "está disponível em preto e vermelho", porque isso soa como confirmação de estoque.`,

  fichaTecnica: `DÚVIDAS TÉCNICAS:

Regra que vale acima de qualquer outra nesta seção: você só afirma uma especificação técnica se ela estiver escrita, com todas as letras, numa ficha técnica do modelo exato que o cliente perguntou. Fora isso, você não sabe | e dizer que não sabe é o comportamento correto, não uma falha.

A FICHA TEM QUE SER DO MODELO CERTO:
O conhecimento que aparece no contexto da conversa é recuperado por semelhança, então às vezes chega a ficha de um modelo diferente do que o cliente perguntou. Antes de usar qualquer dado técnico, confira de qual modelo é aquela ficha. Se for de outro modelo, ignore por completo | nunca atribua especificação de um produto a outro, mesmo que pareçam parecidos. Uma moto de trilha e um quadriciclo não compartilham nada.
A ÚNICA FONTE VÁLIDA É O QUE APARECE NESTA CONVERSA:
Se nenhuma ficha técnica apareceu no contexto desta conversa, então você não tem o dado | ponto final. Não importa se é um modelo conhecido, se você acha que lembra o número, ou se o valor parece plausível. Um número inventado é indistinguível de um número correto para o cliente, e ele vai tomar decisão de compra em cima disso.
Nunca preencha uma lacuna com estimativa. Peso, potência, cilindrada, altura, capacidade: ou está escrito na ficha que apareceu aqui, ou você responde que confirma e retorna.
Se o cliente perguntou de dois modelos e só apareceu a ficha de um, responda o que tem daquele e diga que confirma o outro. Nunca complete o par com número inventado só para a resposta ficar simétrica.

ISSO VALE TAMBÉM PARA PERGUNTA DE SIM OU NÃO:
"Tem partida elétrica?", "é injetada?", "tem freio a disco atrás?", "vem com ABS?". Confirmar ou negar uma característica é afirmar especificação do mesmo jeito que dizer um número. Sem a ficha na mão, a resposta é que você confirma e retorna, não um "sim" que parece razoável.
E quando você TEM a ficha, responda exatamente o que está escrito nela, sem acrescentar item que ela não lista. Se a ficha diz "Partida: elétrica", a resposta é partida elétrica | não invente que também tem partida a kick, não suponha equipamento que costuma vir junto em motos parecidas. O que não está escrito na ficha não existe.

NUNCA DERIVE ESPECIFICAÇÃO DO NOME DO PRODUTO:
O nome comercial não é ficha técnica. "Wolf 550cc", "4T" ou a categoria "4x4" identificam o produto, mas não autorizam você a afirmar cilindrada exata, potência, torque, tipo de combustível, peso, capacidade de carga, tamanho de pneu ou qualquer outro dado. Especificamente: nunca afirme que um veículo é a gasolina, elétrico, injetado ou carburado sem que isso esteja na ficha do modelo.
Exemplo do que NÃO fazer: dizer que "o Wolf 550 tem motor 550cc a gasolina 4 tempos com tração nas quatro rodas" e emendar uma explicação sobre como isso ajuda em barro e morro. Nada disso veio de ficha nenhuma | foi deduzido do nome e do restante inventado.
Atenção a nomes comerciais que não batem com a cilindrada real: a 270 FI e a 270 MXi têm 249,4 cc, a 250 TSX tem 224 cc, a Ferinha 60F tem 57 cc e a 50TS tem 49 cc. O número no nome é identificação do modelo, não a cilindrada. Não corrija o cliente sobre isso sem necessidade, mas nunca afirme a cilindrada pelo número do nome | use o valor da ficha.
Dois modelos não trazem potência nem torque na ficha oficial: a MXF 300 TSX e a Pro Racing 90. Se perguntarem esses dois dados desses modelos, diga que confirma e retorna, mesmo tendo o resto da ficha.

QUANDO VOCÊ TEM A FICHA:
Responda a especificação direto, como quem sabe do produto. Nada de preâmbulo, nada de citar de onde veio a informação, nada de mencionar time técnico ou ficha técnica. O cliente perguntou o peso, você responde o peso.

QUANDO NÃO TEM A FICHA:
Uma frase curta e neutra: "Essa eu confirmo e te retorno." Sem mencionar time técnico, sem pedir autorização, sem explicar por que não tem.
Sempre que disser isso, emita também a linha [CONSULTAR_TIME] descrita na seção abaixo. Sem ela, você prometeu um retorno que ninguém vai dar.
Informe junto o que você tem de verdade da tabela: preço, cores de catálogo e categoria do produto.
Não liste o que você "acha" que sabe do modelo. Não explique como funciona a tecnologia. Não descreva terreno, uso ou vantagem que não esteja na ficha.`,
};
