# Jira QuickFill DEV — Meu progresso

Painel para o dia a dia de quem desenvolve. Mostra **como está o seu dia**, **como você vem
indo nos últimos dias** e **onde estão as suas demandas**, sempre de olho na equipe.
É só de leitura: nada é alterado no Jira. Para apontar horas e criar subtarefas, use o Jira ou o
**QuickFill QA**.

A barra **Espaço · Todos | MEED | SUS** vale para todas as abas.

## Voltar de onde parou (3.11)

Fechar clicando fora, com **Esc**, abrindo uma demanda no Jira ou trocando de aba do navegador guarda a tela:
aba, rolagem, filtros, buscas, cartões abertos e o dia escolhido. Ao reabrir, volta igual, com os
dados que já estavam carregados (até 10 min; o ↻ sempre busca de novo). O **X** fecha de verdade: limpa isso e,
na próxima vez, tudo vem do Jira.

## Novidades da 3.5

- **Progresso › Sprint:** opção **Todas as sprints atuais (MEED + SUS)**; na sprint, tudo (metas, média, sequência,
  gráficos) conta só as horas em demandas da(s) sprint(s). Barras por espaço e, em "Onde foi seu tempo", a sua
  atuação em cada demanda dia a dia.
- **Demandas:** primeiro **Em seu nome agora** (com **▶ atuando agora**), depois Feito, Reaberto, Deploy,
  Validação e **Finalizados** — essas colunas mostram só o que entrou nelas no período (Hoje = hoje).
  O card de deploy vira **Deploy DES** (MEED) ou **Deploy HMP** (SUS). **Impedido** tem card próprio.
- **Personalizar:** blocos separados por tela, intervalo de atualização e "Restaurar padrão".

## Hoje

- **Anel do dia:** horas apontadas até o teto. O ponto amarelo marca a meta. Ao lado, uma frase
  direta: *Faltam 1h20 (dá tempo, restam 2h de jornada)*, *Meta batida! 🎉* ou *Passou do teto*.
- **Chips:** 🔥 dias seguidos batendo a meta, a sua média dos últimos 10 dias e quantas demandas
  você tocou no dia.
- **Ritmo:** *Até 15:10 você costuma ter 3h; hoje está com 2h (−1h)*.
- **Linha do tempo** com a marca de *agora* e a lista **No que você atuou**, com a fatia de cada
  demanda no dia e o botão ↗ para abrir no Jira.
- **Seus últimos dias:** barras dos últimos 10 dias úteis contra a meta. Clique em uma barra para
  abrir aquele dia. Também dá para navegar com ‹ › e pelo calendário.
- **Equipe no dia:** média de quem apontou, onde você está em relação a ela, quem bateu a meta,
  a barra de cada pessoa contra a própria meta e **🤝 quem atuou nas mesmas demandas que você**.
- Atualiza sozinho a cada minuto enquanto estiver aberto em *hoje*.

**⋯ Personalizar:** ajusta a **meta diária** com − / + (ela é salva nas Opções) e liga ou desliga
cada bloco: ritmo, sequência, linha do tempo, demandas, equipe, comparação semanal, "onde foi seu
tempo" e a atualização automática.

## Progresso

Período: **Semana · 14 dias · 30 dias · Sprint**.

- Horas apontadas (▲/▼ contra o período anterior de mesmo tamanho), média por dia útil, dias com
  meta e a 🔥 sequência atual com a melhor do período.
- **Dia a dia:** barras com a linha da meta, em verde quando bateu, azul quando ficou abaixo e
  vermelho quando passou do teto. Clique em um dia para abrir o *Hoje* daquele dia.
- **Esta semana x semana passada**, comparando até o mesmo dia da semana.
- **Onde foi seu tempo:** as demandas que mais consumiram horas, com a % de cada uma, e a divisão MEED x SUS.

**Sprint:** as datas vêm do quadro de cada espaço, a cada abertura. Quadros *scrum* e de projetos
gerenciados pela equipe são aceitos. Se nenhum quadro do espaço tiver sprints, as sprints saem do
campo *Sprint* das próprias demandas do espaço. Quando uma sprint fecha e
outra começa, o período acompanha sozinho. No seletor aparecem a sprint atual e as 3 últimas
encerradas de cada espaço (MEED e SUS, cada uma com suas datas). O cartão da sprint mostra o dia
(*dia 8 de 11 úteis*), quanto falta, o objetivo e as concluídas da sprint, e o gráfico vai até o
último dia dela. Com **só demandas da sprint** ligado, as horas contam apenas as demandas do
backlog da sprint e as subtarefas delas. Meta, média e sequência continuam usando o dia inteiro.

## Demandas

Os cartões seguem as colunas do quadro: **Em andamento · Reaberto · Feito · Deploy HMP/DES ·
Validação · Entregues**.

O filtro (**Hoje · 7 · 14 · 30 dias**) mostra só as demandas que **se movimentaram no período**:
entraram na coluna atual, receberam horas suas ou foram movidas por você. No **Hoje** aparece apenas
o que aconteceu hoje. O que está em seu nome mas parado fica em um bloco recolhido, *Em seu nome,
sem movimento*, para não poluir os cartões.

- **Prioridade do Jira** em cada demanda, com cor por criticidade. A linha *Prioridade* mostra
  quantas há de cada uma, e clicar filtra. As mais críticas aparecem primeiro.
- **Reaberto:** o que voltou de Feito, Deploy, Validação ou Concluído para desenvolvimento no
  período, com quem devolveu e quando.
- O deploy de produção (PRD) fica fora dos cartões. Aparece só como contagem no rodapé.

## Velocidade

- Os apontamentos já vêm junto da busca do Jira, e só se faz uma chamada extra por demanda
  quando ela tem mais de 20 apontamentos.
- O histórico fica guardado no navegador: ao abrir, aparece na hora e só os últimos dias são relidos.
- Trocar o dia no *Hoje* é instantâneo dentro do que já foi carregado. Fora disso, busca só os dias que faltam.
- A *Equipe no dia* usa uma leitura leve, só do dia, e as Demandas leem apenas as suas, com cache.

## Equipe

Ao vivo a cada 30 s, com meta e teto por pessoa. Com **Todos**, soma MEED e SUS,
independentemente do campo *Projetos* da Equipe nas Opções.

- **Resumo:** horas da equipe no dia, média, e uma barra com quantos bateram a meta, ficaram
  abaixo, passaram do teto ou não apontaram. Clicar filtra.
- **Cartões:** cada pessoa com um anel de progresso no avatar, as horas contra a meta, o que fez
  por último ("agora há pouco 14:30 · SUS-2097") e as barrinhas dos últimos dias. Clique para ver
  os detalhes (linha do tempo, demandas, meta/teto).
- **Linha do tempo:** todos na mesma régua de horário, com a marca de *agora*, para ver quem estava
  em quê ao mesmo tempo.
- **Últimos apontamentos:** os lançamentos mais recentes da equipe, ao vivo.

## Instalação

1. Descompacte `jira-quickfill-dev.zip` e carregue a pasta `jira-quickfill-dev` em
   `chrome://extensions` (Modo do desenvolvedor › Carregar sem compactação).
2. Nas Opções, preencha a conexão ou importe a configuração exportada do QuickFill QA.
3. No Jira, abra pelo botão **DEV** (acima do ⏱) ou com **Ctrl+Shift+Y**.
