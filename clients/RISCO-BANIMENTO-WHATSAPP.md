# Risco de banimento do WhatsApp — decisão e protocolo

## A decisão (agosto/2026)

Rodar **Evolution API agora**, migrar para a **API oficial depois**, aceitando
conscientemente o risco na janela inicial.

Este documento existe pra que a aceitação do risco seja informada e pra que o
protocolo de mitigação não se perca. Quem for subir um cliente novo lê isto
antes.

## Por que é risco real

Evolution API roda sobre o Baileys, que é engenharia reversa do WhatsApp Web —
cliente não oficial, contra os termos da Meta. Não é área cinzenta.

Números de mercado: ferramentas desse tipo tipicamente duram **2 a 8 semanas
até detecção**, e um levantamento com 600+ PMEs apontou **68% com pelo menos um
banimento em 12 meses**. A detecção é heurística e por aprendizado de máquina,
não regra fixa — por isso uma conta roda meses limpa e outra cai numa semana
fazendo o mesmo.

O agravante que não é técnico: se o número **do cliente** cair por causa do
sistema que a agência instalou, o problema é da agência. Perder o WhatsApp que
recebe o tráfego pago não tem desfazer.

## O maior risco está dentro do nosso próprio sistema

O padrão mais perigoso é **mensagem para quem nunca escreveu antes**. É o gatilho
número um de banimento, e o WhatsApp acompanha mensagens enviadas que ficam sem
resposta em 48h.

No que construímos, duas funcionalidades fazem exatamente isso:

| Funcionalidade | Risco | Recomendação enquanto estiver no Evolution |
|---|---|---|
| Botão **"Novo Lead"** do dashboard (`/api/leads/iniciar`) | **Alto** — envia primeira mensagem a quem não pediu contato | Não usar em número de cliente. Se usar, só para quem pediu contato por outro canal |
| **Cron de lembrete** diário (8h) | Médio — mensagem iniciada pela empresa | Só faz sentido onde há agendamento. TrailLand não usa |
| Olivia respondendo mensagem recebida | **Baixo** — é o padrão seguro | Uso normal |

O fluxo principal da TrailLand (cliente vê anúncio → escreve → Olivia responde)
é o de menor risco que existe. O perigo mora nas duas funcionalidades acima.

## Protocolo para número novo

1. **Usar o número manualmente por 2 a 5 dias antes de ligar a automação.** Conta
   sem histórico é a mais sensível — o WhatsApp avalia "peso" da conta por
   comportamento.
2. **Não passar de 50 mensagens/dia** nos primeiros dias.
3. **Esperar 3 a 5 dias antes de aumentar volume.**
4. **Teto de 30 mensagens enviadas por hora** em regime normal.
5. **Manter taxa de resposta acima de 30%** — muita mensagem sem retorno é sinal
   de disparo em massa.
6. Preferir número com histórico orgânico a chip novo.

## Quando parar de adiar a migração

Migrar para a API oficial **antes** que qualquer um destes aconteça:

- Volume passar de ~100 conversas novas por dia
- Aparecer o primeiro aviso ou restrição temporária no número
- O cliente começar a depender do canal para faturamento relevante
- Precisar de mensagem ativa (template) de forma recorrente

## O que a API oficial resolve e custa

Resolve: risco de ban some, protocolo estável (Meta não muda por baixo), selo de
conta comercial.

Custo real no padrão da TrailLand: **praticamente zero.** Desde julho/2025 a
cobrança é por mensagem, e resposta dentro da janela de 24h após o cliente
escrever é **gratuita e sem teto**. Só se paga mensagem iniciada pela empresa
(utilidade ~R$ 0,05, marketing ~R$ 0,31–0,38).

Custo de implantação: verificação Meta Business (dias), número dedicado que sai
do app comum, template aprovado para qualquer mensagem ativa, e uma camada de
abstração de provedor no código (`sendZAPIMessage`, `wppSendImage` e download de
mídia hoje estão presos ao Evolution).

Restrição operacional a considerar antes: a janela de 24h vira regra dura. No
fluxo de handoff, se o atendente humano voltar a falar com o cliente dois dias
depois, precisa de template.

## Política da Meta de 15/01/2026

A proibição de "chatbots de uso geral" **não afeta** este sistema. Ela mira
assistentes tipo ChatGPT usando o WhatsApp como canal de distribuição. Bot de
atendimento de empresa — dúvida de produto, preço, pedido, agendamento —
continua permitido e incentivado.

Para seguir do lado certo: manter a Olivia no escopo dela (catálogo, preço,
ficha técnica, handoff) e não transformá-la num "pergunte o que quiser".
