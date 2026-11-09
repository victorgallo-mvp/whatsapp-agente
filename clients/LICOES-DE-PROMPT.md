# Lições que se repetiram em todos os agentes

Isto não é teoria. Cada item abaixo custou pelo menos um erro em produção, com
cliente real do outro lado. Estão aqui porque o padrão reapareceu em agentes
diferentes, de nichos diferentes — inclusive depois de já ter sido corrigido
uma vez, porque quem escreveu o agente novo (eu) não trouxe a lição junto.

Leia antes de escrever um `clients/<slug>.js` novo.

---

## O princípio que organiza todos os outros

O que determina se uma instrução vai ser obedecida **não é ela ser positiva ou
negativa**. É se o modelo precisa inferir alguma coisa para cumpri-la.

| Tipo | Confiabilidade | Exemplo que funcionou / falhou |
|---|---|---|
| Dado estrutural | alta | valor do acessório escrito na linha do produto |
| Proibição concreta | média-alta | "não diga 'não tenho registro'" — 0 violações em 187 respostas |
| Instrução positiva concreta | média | "responda em três partes, nesta ordem" |
| Qualquer coisa que exija julgamento | baixa | "a 270 MXi e a 250 RXi não estão na lista" — falhou em 4 de 7 |

Repare que há instrução negativa nos dois extremos. "Não diga a frase X" segura
porque o modelo consegue verificar se está prestes a dizer X. "Esses dois não
estão na lista" falha porque, para obedecer, ele precisa saber o que mais está
fora — e isso ninguém disse.

"Não calcule de cabeça" é negativa e nunca funcionou. O que funcionou foi tirar
a conta do caminho.

**Antes de escrever qualquer regra, pergunte: para obedecer isso, o modelo
precisa descobrir alguma coisa?** Se precisar, a regra vai falhar em algum
momento, e o conserto é mudar o dado, não reforçar o texto.

---

## 1. Se a resposta exige derivar um número, tire a derivação do caminho

A regra em texto não segura. Pedir "tenha cuidado ao comparar valores" falha;
colocar o valor pronto onde ele é lido funciona.

**Casos reais:**

A IA omitia modelos dentro da faixa de preço pedida, porque comparava valores
de cabeça. A correção não foi instruir melhor: foi criar listas já ordenadas do
mais barato ao mais caro, com a instrução "percorra a lista na ordem".

A condição de acessórios à vista valia para 5 modelos. A regra dizia "esses
cinco, e a 270 MXi e a 250 RXi não estão na lista" — e a IA ofereceu acessório
numa Pro Racing 110RR, numa 50TS e numa 250 RXi. Apertar o texto deixou 4 de 7
casos ainda errados. **O que resolveu foi escrever o valor na linha de cada
produto na tabela** (`à vista: +R$ 500 em acessórios` / `SEM acessório`), com a
regra mandando ler de lá. Ela passou a consultar em vez de calcular.

**Regra prática:** se você se pegar escrevendo "não calcule", "não estime" ou
"tenha atenção", pare e pergunte onde o dado poderia estar escrito pronto.

## 2. Liste o que vale, não o que não vale

Lista de exceções vira generalização. Nomear duas exceções deixa o resto do
catálogo em aberto, e o modelo preenche o vazio.

Escreva o escopo fechado ("estes cinco e mais nenhum produto") e nomeie os
grupos excluídos um a um. O caro é o que você não mencionou.

## 3. Instrução condicional com condição vaga vira instrução sempre

"Pergunte só se a conversa estiver fluindo" foi lido como permissão, e a IA
passou a perguntar em toda conversa — segurando quem já estava pronto para
agendar.

Se o comportamento é opcional e você não consegue definir a condição de forma
verificável, **remova a opção**. "Não pergunte" é mais confiável que "pergunte
às vezes".

## 4. Promessa de retorno sem tag é mentira

Toda vez que a IA diz "vou verificar e te retorno", "o consultor confirma" ou
"vou passar para a equipe", tem que sair a linha de tag junto. Sem ela ninguém
é avisado e o cliente espera por nada.

Aconteceu várias vezes, em agentes diferentes. A instrução que funciona é dizer
o porquê no próprio prompt: *"sem essa linha ninguém fica sabendo e o cliente
espera por nada"*.

Cuidado com o inverso: emitir a tag **e** fazer uma pergunta na mesma mensagem.
As tags de passagem desligam a IA no mesmo turno, então a pergunta morre sem
resposta. Ou pergunta, ou transfere.

## 5. Nunca narrar o próprio mecanismo

O cliente não sabe nem precisa saber como o sistema funciona por dentro.

Saíram em produção: *"Antes de encaminhar, é a primeira vez que você vem
aqui?"*, *"vou registrar aqui"*, *"deixa eu verificar no sistema"*. É conversa
de bastidor vazando para quem está do outro lado.

Da mesma família: a IA se corrigindo em voz alta. Um agente chegou a escrever
*"Wait, let me re-check the price"* — em inglês, no meio de uma conversa em
português. A causa era uma instrução minha mandando verificar antes de enviar,
e o único lugar onde ela consegue "verificar" é a própria saída. A validação
foi para o servidor e a instrução saiu do prompt.

## 6. Fato único, estável e crítico vai no prompt, não no RAG

O RAG pode não recuperar. Quando não recupera, o modelo preenche com o que
parece plausível.

A IA inventou "Embracon" como administradora do consórcio porque a busca
voltou vazia para "como funciona o consórcio" (similaridade 0,313, abaixo do
corte de 0,35). O nome da administradora passou para o prompt: se a busca
falhar, o fato continua em contexto.

Vale para: nome de parceiro, endereço, garantia, formas de pagamento, telefone
de outro setor. Ficha técnica de produto pode ficar no RAG; identidade do
negócio, não.

## 7. Antes de escrever uma regra nova, procure a que já existe

Duas regras do mesmo prompt se contradisseram: uma proibia encerrar com
"qualquer dúvida é só chamar" e outra, 170 linhas abaixo, scriptava exatamente
essa frase.

E ao escrever o agente da clínica do zero, deixei de fora lições que já estavam
resolvidas no agente de motos (itens 3 e 5 desta lista). As duas voltaram como
bug, em produção.

Busque pela frase literal antes de adicionar. Prompt grande esconde contradição.

## 8. O que o anúncio promete não é o que o catálogo diz

Leads de click-to-WhatsApp chegam com o texto do anúncio no contexto. A IA
repetiu "R$ 1.500 em acessórios" numa máquina cuja condição real era R$ 1.000,
porque o anúncio prometia esse valor para a linha inteira.

A instrução precisa cobrir **dois** casos, e eu só tinha escrito o primeiro:
- o cliente cita a condição do anúncio → não confirme nem negue, encaminhe
- a IA anuncia por conta própria → **proibido**, mesmo que esteja no contexto

## 9. Simulação que mente é pior que simulação nenhuma

O playground pausava num caso em que produção não pausa, porque uma tag entrou
por engano na lista de pausa. Gastei duas rodadas de diagnóstico culpando o
prompt.

O playground também misturava conversa entre agentes: o histórico era guardado
só por `sessionId`, e trocar de cliente no seletor entregava a conversa do
anterior. Corrigido com chave `clientSlug::sessionId`.

Quando o ambiente de teste divergir de produção, conserte o ambiente antes de
continuar diagnosticando.

## 10. Verifique no caminho real, não no caminho feliz

O cache de prompt parecia funcionar porque testei repetindo **a mesma**
chamada. Produção nunca repete: cada mensagem é de um cliente diferente. O
`cache_control` estava no bloco errado e o cache nunca acertava — pior, a
escrita custa 1,25x, então estava **mais caro** que não ter cache.

A análise de imagem passou semanas quebrada em silêncio: baixava a URL direto
em vez de descriptografar, a API rejeitava, a função devolvia `null` e nenhum
erro aparecia. 37 imagens, zero analisadas.

A atribuição de anúncio se perdia porque o clique costuma chegar numa mensagem
**sem corpo de texto**, e a gravação estava dentro do ramo de texto.

**Teste sempre pelo webhook, com o payload real.** O playground não cobre
imagem, áudio, anúncio nem mensagem sem corpo.

## 11. Deploy que "subiu" pode não ter subido

`GET /` expõe `build` com o hash do commit justamente porque testar se o
servidor responde não prova nada — a versão antiga responde igual.

Outra armadilha: deploys diferentes podem seguir **branches diferentes**. Um
ajuste foi para `feat/evolution-api` e o cliente que seguia `main` não recebeu.

## 12. Correção feita num agente não migra sozinha

A tabela de preços estava **colada** dentro de um dos agentes em vez de
importada do módulo compartilhado. Semanas de correção de catálogo valeram só
para o outro agente: preço antigo, sem ordenação, com travessão que já tínhamos
removido.

Ao mexer num agente de um cliente que tem mais de um, confira o outro. E
prefira módulo compartilhado (`clients/_<slug>-produtos.js`) a texto colado.

## 13. Preço: não existe regra universal

Na concessionária, **segurar o valor afastava** — a IA informa preço de tabela
na hora, e isso aumentou a conversa.

Na clínica, **dar o valor afasta** — ticket alto, e a própria clínica constatou
que ao vivo converte. Ali a IA não dá número nenhum.

O que decide é o negócio, não uma boa prática. Pergunte ao cliente o que
acontece hoje quando alguém pergunta o preço no WhatsApp.

E quando a IA não dá preço, evasiva pura também perde. O que funciona é
responder a pergunta que está atrás do "quanto custa" — quase sempre "cabe no
meu bolso" — com o que existe de real: parcelamento, condição, ou o que for.

## 14. Extração estruturada por mensagem dobra o custo

O sistema de qualificação roda uma chamada Haiku a cada mensagem do cliente,
relendo a conversa inteira e reextraindo todos os campos.

Medido na Protásio (13 campos, conversa de 8 turnos): **929 tokens de entrada
por chamada**. A 1.000 leads e 8 turnos, são US$ 19,43/mês — contra US$ 17,41
do agente inteiro. Ou seja, mais que dobra.

Dois motivos: o Haiku 4.5 exige 4.096 tokens para cachear e a chamada tem 929,
então nunca cacheia; e cada turno relê tudo de novo, então o custo cresce com
o tamanho da conversa.

Se o custo incomodar, o caminho é mandar só as mensagens novas desde a última
extração (a função já recebe o que foi extraído antes) em vez da conversa
inteira. Não foi feito ainda.

## 15. O custo é quase todo prompt fixo

97% dos tokens de entrada de cada mensagem são o prompt de sistema. O histórico
da conversa é ruído perto disso.

Cada regra adicionada depois de um bug vira custo em toda mensagem, para
sempre. Um prompt cresceu 64% em sete semanas assim. Cache resolve a maior
parte, mas o tamanho ainda importa.

## 15. Extrator estruturado preenche por ausência: exija a citação

Pedir ao modelo "registre só o que o cliente disse" não segura. No agente de
triagem da Protásio, a primeira mensagem ("tem CB 500 aí?") saiu da extração
como `cnh=nao, entrada=nao, prazo=pesquisando`. Como a ficha é mesclada turno a
turno, "sem habilitação" grudou no lead até o fim.

O que resolveu foi estrutural, não textual: cada campo de opções volta como
`{valor, trecho}`, e o servidor descarta o valor cujo trecho não aparece na
fala do cliente (`trechoConfere` em `server.js`). O log mostra cada descarte.
É o item 1 aplicado à extração: tire a dedução do caminho.
