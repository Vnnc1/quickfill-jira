# Jira QuickFill QA

> É o QuickFill que você já usa, agora com o nome **QuickFill QA**. Para quem desenvolve existe o
> **QuickFill DEV** (`jira-quickfill-dev.zip`), um painel do seu dia e do seu progresso. Veja o fim deste arquivo.

Extensão Chrome (Manifest V3) que abre um modal sobre o Jira, encontra as subtarefas
de uma tarefa (ex.: `MEED-1653`) e grava de uma vez:

| Campo do Jira        | O que a extensão faz                                              |
|----------------------|-------------------------------------------------------------------|
| **Data limite**      | `duedate` via `PUT /rest/api/3/issue/{key}`                       |
| **Data de início**   | custom field detectado automaticamente pelo `editmeta`            |
| **Estimativa original** | `timetracking.originalEstimate` (formato M/H/D)                |
| **Controle de tempo**| `POST /worklog` — apontamento real, com `adjustEstimate=auto`     |
| **Status**           | `POST /transitions` com a transição escolhida                     |
| **Criar subtarefa**  | `POST /rest/api/3/issue` com `parent`, tipo de subtarefa do projeto e `assignee` |
| **Buscar por coluna**| JQL `status in (...)` via `/rest/api/3/search/jql`                |
| **Story points**     | campo detectado pelo `editmeta`, só valores de Fibonacci          |
| **Meu dia**          | seus worklogs do dia, por horário e demanda, contra a meta de 4h  |

Tudo por **API REST v3** — nada de clicar em campos na tela, então mudanças de
layout do Jira não quebram a extensão.

## Instalação

1. Abra `chrome://extensions` e ligue o **Modo do desenvolvedor**.
2. **Carregar sem compactação** → selecione a pasta `jira-quickfill`.
3. Clique no ícone da extensão → ⚙ **Opções** e preencha:
   - **URL do Jira**: `https://suaempresa.atlassian.net`
   - **E-mail Atlassian**: o mesmo do seu login
   - **API token**: gere em <https://id.atlassian.com/manage-profile/security/api-tokens>
4. Clique em **Testar conexão** — deve responder com o seu nome.

## Interface

Quatro abas e uma barra de ação fixa no rodapé:

- **Tarefa** — busca uma tarefa e lista a **própria tarefa pai** (marcada como *pai*) e as
  subtarefas. Qualquer uma delas recebe horas, datas, story points e status.
- **Lote** — um seletor **MEED | SUS** no topo escolhe o espaço (cada um guarda seu quadro,
  colunas, seleção e campos). Passo 1: tarefas do quadro ou digitadas. Passo 2:
  **Aplicar em Subtarefas** ou **Tarefas pai**.
- **Painel** — dashboard das demandas abertas no seu nome.
- **Equipe** — quem apontou, quanto, contra a meta e o teto de cada pessoa, ao vivo.
- **Meu dia** — apontamentos do dia contra a meta, com histórico.
- **Pílula no topo** — quanto você já apontou hoje contra a meta; clique para abrir o Meu dia.

### Equipe (ao vivo, a cada 30 s)

O topo mostra um resumo do dia (horas da equipe e quantos bateram a meta, com clique para filtrar). Há duas visões: **Cartões**, com um anel de progresso no avatar e o último apontamento de cada pessoa, e **Linha do tempo**, com todos na mesma régua de horário. Abaixo ficam os **Últimos apontamentos**, ao vivo.

Mostra todas as pessoas que apontam horas nos projetos acompanhados (Opções › Equipe;
padrão: MEED e SUS), para o dia escolhido:

- **Indicadores clicáveis:** quantos apontaram (ex.: 4/5), bateram a meta, passaram do
  teto e estão sem apontamento. Clicar filtra a lista.
- **Um cartão por pessoa** com total do dia, barra contra a **meta** (marcador amarelo) e o
  **teto** (marcador vermelho), situação (*faltam 1h 30m*, *✓ meta*, *acima do teto*,
  *sem apontamento*), número de demandas e horário do último apontamento.
- **Meta e teto por pessoa:** abra o cartão e ajuste (ex.: meta 7h, teto 9h) → Salvar.
  *Padrão* volta aos valores das Opções. Fica salvo na sua conta do Chrome.
- **Demandas da pessoa:** ao abrir o cartão, linha do tempo do dia (uma cor por demanda),
  lista das demandas com horários e o histórico dos últimos 5 dias úteis contra a meta.
- Quem apontou nos últimos dias **continua na lista com 0h** — é assim que você vê quem
  ainda não marcou. Para acompanhar alguém que nunca apareceu, use *+ Acompanhar uma pessoa*
  (busca no Jira e fixa). *Ocultar* tira alguém da lista sem apagar a configuração.
- Ordene por **menos horas** (padrão — quem está mais longe da meta primeiro), **mais horas**
  ou **nome**, e filtre pelo nome.

**Atualização automática:** com o dia de hoje aberto, a aba consulta o Jira a cada 30 s
(indicador *● ao vivo · atualizado há Xs*). Quem mudou desde a última leitura pisca e mostra
a diferença (*+1h 30m agora*). Para não pesar no Jira:

- a cada 30 s vai **uma** busca pelas issues alteradas desde a última leitura, e só os apontamentos
  dessas issues são relidos; a carga completa acontece ao abrir, ao trocar de dia e a cada 3 min;
- se o Jira pedir uma pausa (limite de uso), a extensão espera o tempo pedido e a atualização
  automática espera mais a cada vez (1, 2 e até 5 min), voltando ao normal na primeira resposta boa;
- nunca há duas consultas ao mesmo tempo, e ela **para** quando você sai da aba, minimiza o
  Chrome ou clica em ❚❚. Dias anteriores não ficam consultando (são histórico).

**Confiabilidade dos números (2.3):**

- Quando o Jira pede para esperar (erro 429, comum com muitas leituras em paralelo), a
  extensão espera e tenta de novo. Antes, aquela tarefa sumia da soma em silêncio.
  Se mesmo assim algo não puder ser lido, aparece "dados parciais" e a tarefa é relida
  na próxima atualização.
- A atualização ao vivo cobre todo o tempo desde a última leitura — apontar pela aba
  Tarefa com a Equipe fechada e voltar minutos depois não perde mais nada.
- O dia escolhido vem numa consulta própria e completa (até 1000 tarefas), separada do
  histórico.
- **Escopo:** o seletor ao lado da busca alterna entre os projetos configurados
  (ex.: MEED+SUS) e **Todos**. Se você tem horas em outro projeto, o seu cartão avisa —
  "Você tem 5h 30m apontadas no dia; 2h em PORTAL, fora dos projetos desta visão" — com
  um atalho para ver todos. É isso que explica a pílula do topo (todos os projetos) mostrar
  um total diferente do cartão.

Você só vê apontamentos que a sua conta pode ver no Jira — apontamentos com visibilidade
restrita a um grupo do qual você não participa não entram na soma.

### Sprints (MEED e SUS)

No topo do **Painel**, um cartão por espaço com a sprint ativa:

- nome, **início e fim**, e quantos **dias úteis** faltam (amarelo nos 2 últimos dias,
  vermelho se passou do fim);
- barra do **tempo decorrido** da sprint e barra do **andamento dos itens** (concluídos,
  em andamento, a fazer), com "13 de 24 concluídos · seus: 2/5";
- a **próxima sprint** com as datas, quando já estiver planejada.

Cada demanda da lista ganha a etiqueta da sprint em que está (*Sprint 16 · até 20/10*) ou
*fora da sprint ativa* — assim você sabe em que entrega cada alteração vai de fato sair.
Subtarefas herdam a sprint da tarefa pai.

O quadro usado é o escolhido no Lote, se for scrum. Se for kanban (sem sprints), a extensão
procura o quadro scrum do projeto — preferindo o que tem o nome do projeto.

### Tamanho da tela

O controle **− 100% +** no topo ajusta a escala de 80% a 150% (clique no número para
voltar a 100%; atalhos Ctrl + / Ctrl − / Ctrl 0). No overlay do Jira a moldura cresce e
encolhe junto; no popup a janela acompanha. A escala fica salva.

### Horas também em tarefas pai

- Na aba **Tarefa**, o primeiro item da lista é a tarefa que você buscou. Selecione-a para
  apontar direto nela — mesmo formulário, mesma jornada 11h–17h, mesmo teto.
- No **Lote**, troque *Aplicar em* para **Tarefas pai**: as tarefas selecionadas no passo 1
  recebem os valores diretamente, sem expandir em subtarefas. O botão de criar subtarefa
  some nesse modo, porque não se aplica.

### Abrir a demanda no Jira

Cada demanda tem um botão **↗** que abre a issue em uma nova aba para investigar:

- **Tarefa:** em cada linha da lista (pai e subtarefas) e em **Abrir no Jira**, no topo do formulário.
- **Painel:** botão **Jira** em cada card, e um **↗** ao lado de "↳ tarefa pai" para abrir a pai.
- **Lote:** em cada linha das listas do quadro e das subtarefas.

Clicar no botão não seleciona nem marca a linha. Com **Ctrl/⌘** ou com o botão do meio, a aba abre em segundo plano.

### Painel (minhas demandas)

Tudo o que está atribuído a você e ainda não foi resolvido (`assignee = currentUser() AND
resolution = Unresolved`):

- **Indicadores clicáveis:** abertas · atrasadas · vencem em 7 dias · sem data limite.
  Clicar filtra a lista; clicar de novo limpa.
- **Distribuição por status** em barra, com legenda clicável para filtrar, horas apontadas
  x estimadas e quantas você concluiu nos últimos 7 dias.
- **Filtros** por projeto (Todos / MEED / SUS…), tipo (Pai / Sub) e busca por chave ou título.
- **Lista agrupada por status**, atrasadas primeiro e depois por data limite. Cada linha mostra
  prazo (*atrasada 2d*, *vence hoje*), tarefa pai, story points e uma barrinha de horas
  apontadas x estimadas (vermelha quando passa).
- **Clique numa demanda** para abri-la na aba Tarefa, já selecionada e pronta para apontar.
  O ↗ abre no Jira.

## Uso

- Em qualquer página `*.atlassian.net`: **Ctrl+Shift+J** (ou o botão ⏱ no canto
  inferior direito) abre o modal. Se você já estiver numa issue, a chave vem preenchida.
- Fora do Jira: clique no ícone da extensão na barra.

O modal tem duas abas.

### Como escrever a chave

Em qualquer campo de chave, estas formas são equivalentes:

```
M1653   M-1653   M 1653      →  MEED-1653   (abreviação)
1653    #1653                →  MEED-1653   (projeto padrão)
MEED-1653  meed-1653         →  MEED-1653
https://…/browse/MEED-1653   →  MEED-1653
```

A abreviação vem das Opções (`M=MEED`, várias separadas por vírgula) e o número puro
usa o **projeto padrão**. Um prefixo fora do mapa é mantido como veio, então
`ABC-9` e `ABC2-15` continuam funcionando sem configurar nada.

### Aba "Uma tarefa"

Digite `MEED-1653` → **Buscar** → escolha a subtarefa → preencha → **Aplicar**.
`Ctrl+Enter` aplica, `Esc` fecha. Se só houver uma subtarefa, ela é selecionada sozinha.
O formulário já vem preenchido com os valores atuais, então normalmente você só ajusta o que mudou.

### Lote: espaços MEED e SUS

Os dois espaços têm **exatamente as mesmas funcionalidades** — mudam só o projeto e as colunas:

| Aba | Projeto | Colunas padrão |
| --- | --- | --- |
| **MEED** | o projeto padrão (MEED) | Validação, Deploy |
| **SUS** | livre (vazio = todos os projetos que você enxerga) | Deploy, Validação Meeds All |

Cada espaço guarda o próprio estado — busca, seleção, subtarefas carregadas e campos
preenchidos. Trocar de espaço não perde nada, e o rascunho salva os dois.

O que segue vale para os dois espaços.

Cole várias demandas (uma por linha, ou separadas por vírgula/espaço — pode misturar
tarefas pai e subtarefas) → **Carregar subtarefas**. A extensão expande cada chave nas
suas subtarefas, agrupadas por pai, com checkbox em cada uma.

- **Pré-seleção inteligente:** vêm marcadas as subtarefas atribuídas a você. Se nenhuma
  for sua, todas são marcadas. Os botões **Só as minhas** / **Todas** refazem a seleção.
- Preencha os campos **uma vez** e clique em **Aplicar em N subtarefas**.
- Barra de progresso durante o carregamento e a aplicação; até 3 issues em paralelo
  para não estourar o rate limit do Jira.
- **Status no lote é casado por _nome_**, não por id de transição — ids mudam de workflow
  para workflow. O dropdown mostra quantas issues aceitam cada status
  (`Concluído (possível em 4 de 6)`). Onde a transição não existir a partir do status
  atual, aquela issue reporta o motivo e as demais seguem normalmente.
- O resultado sai issue a issue, expansível; as que falharam já vêm abertas.

Uma falha em uma subtarefa nunca aborta o lote.

### Selecionar pelas colunas do quadro

**Escolha o quadro no seletor** e as colunas dele aparecem como chips selecionáveis —
marque "Validação Meeds All", "Deploy", o que for. Depois clique em **Buscar nas colunas**
e a extensão lista, com **checkbox**, tudo o que está naquelas colunas — agrupado por status, com chave, resumo e responsável. Você marca o que
interessa (ou usa **Todas** / **Só as minhas** / **Nenhuma**) e clica em
**Carregar subtarefas das N selecionadas**. Não precisa digitar chave nenhuma.

Digitar continua disponível no bloco recolhido **Digitar as demandas manualmente**, para
quando você já sabe as chaves ou quer misturar tarefas de fora das colunas.

- **Por que selecionar o quadro importa:** o nome da COLUNA quase nunca é igual ao nome
  do STATUS. "Validação Meeds All" é rótulo de coluna e pode agrupar vários status com
  outros nomes. Com o quadro selecionado, a extensão lê
  `/rest/agile/1.0/board/{id}/configuration`, pega os **ids de status** que cada coluna
  agrupa e monta `status in (id, id, …) AND filter = <filtro do quadro>` — ou seja, o
  mesmo recorte que você vê no quadro.
- Sem quadro selecionado, a busca cai para nome de status (`status in ("Deploy")`). Se
  voltar vazia, a extensão procura status parecidos e sugere, avisando que o nome
  provavelmente é de coluna.
- **Só as atribuídas a mim** acrescenta `assignee = currentUser()`.
- **Só tarefas pai** acrescenta `issuetype not in subTaskIssueTypes()`, para a lista vir
  no nível certo — é o padrão, já que o passo seguinte é expandir em subtarefas.
- Restringe ao projeto padrão e ordena por atualização mais recente, com teto de 200 issues.

O nome da coluna precisa bater com o **status** do Jira. Se a sua coluna agrupa mais de
um status, liste todos separados por vírgula.

### Criar a subtarefa de testes

Nas duas abas há o bloco **Criar subtarefa**, que cria a subtarefa já atribuída a você
— por padrão chamada **Testes Manuais** (o nome padrão fica nas Opções e pode ser
trocado na hora).

- **Uma tarefa:** digite a chave do pai, abra o bloco e clique em **Criar subtarefa**.
  Ela é criada, a lista recarrega e o formulário já abre nela, pronto para preencher.
- **Em lote:** cole várias tarefas pai e use **Criar subtarefas**. Ao terminar, as
  subtarefas recém-criadas são carregadas e ficam marcadas — só preencher e aplicar.

Detalhes que evitam surpresa:

- **Não duplica.** Com a opção ligada (padrão), uma tarefa que já tenha subtarefa com
  esse nome é reaproveitada em vez de ganhar uma segunda. A comparação ignora acento e caixa.
- **O tipo de subtarefa é descoberto pelo projeto**, pela flag `subtask` que o próprio
  Jira devolve — nunca pelo nome, que muda por idioma e por projeto ("Subtarefa",
  "Sub-task"). Se o seu projeto não expuser o tipo, dá para fixar o id nas Opções.
- **Atribuição com fallback:** se a tela de criação do projeto não tiver o campo
  responsável, a subtarefa é criada sem ele e a atribuição vai logo depois por
  `PUT /assignee`. Se nem assim for possível, a extensão avisa que ela ficou sem responsável
  em vez de fingir sucesso.
- Tentar criar subtarefa dentro de uma subtarefa é bloqueado com mensagem clara.

### Jornada de trabalho (11:00–17:00, até 6h por dia)

Todo apontamento — numa subtarefa ou em lote — é encaixado na sua jornada:

- **Começa às 11:00 e termina às 17:00**, no fuso do navegador (horário de Brasília).
  Antes o horário era 09:00 UTC fixo, o que no Brasil caía às **06:00**.
- **Tudo fica no mesmo dia** (padrão a partir da v2.4). Se o tempo não cabe até as 17:00,
  o apontamento **passa das 17:00 no mesmo dia** — nunca vai para o dia seguinte. Ex.: lote
  5 × 1h30 vira 11:00–12:30 … 15:30–17:00 e o quinto fica 17:00–18:30.
- **Sem sobreposição:** a extensão lê seus apontamentos do dia no Jira e coloca os novos
  nos horários livres, em sequência. Um lote de 5 subtarefas × 20m vira
  11:00–11:20, 11:20–11:40, 11:40–12:00…
- Passar das 17:00 ou do teto de 6h é permitido e aparece como aviso (área hachurada na
  linha do tempo). Só é recusado o que atravessaria a meia-noite.
- Prefere o comportamento antigo? Em **Opções › Jornada › Quando o tempo não cabe na
  jornada**, escolha *Levar o restante para o próximo dia útil* (respeita o teto e pula
  sábado/domingo).

**Começou / Terminou — calculado pelo tempo trabalhado.** O formulário segue a ordem em que
você pensa ao terminar uma demanda: *1. Quanto tempo* → *2. Quando* → *3. Demanda*.

- O campo **Terminou** já vem com **agora**. Ao digitar o **Trabalhado**, o **Começou** é
  calculado sozinho: terminou às 14:43 com 40m → começou às **14:03**.
- Prefere informar quando começou? Digite no **Começou** e o **Terminou** é calculado.
- **agora** volta o término para o horário atual; **auto** deixa a extensão escolher o
  primeiro horário livre da jornada (comportamento antigo).
- No **Lote**, o tempo vale para cada subtarefa e elas entram em sequência: 3 × 40m
  terminando às 14:43 → 12:43 → 14:43.
- O horário informado é respeitado: terminou às 18:20 com 1h20 → 17:00–18:20; 5h terminando
  às 14:43 → 09:43–14:43. A faixa abaixo dos campos avisa quanto ficou fora da jornada.
- O **Dia** vem como hoje. A *data de início da tarefa* no Jira só é gravada quando ainda
  está vazia (é o primeiro dia de trabalho); se já existir, é mantida.

**Hora de início (como no Jira):** abaixo da Data de início há o campo **Hora de início
do apontamento**. Vazio (botão **Automático**) = primeiro horário livre a partir das 11:00.
Preenchido = o apontamento começa naquela hora; num lote, os seguintes vêm em sequência.
Se a hora escolhida já estiver ocupada, a extensão usa o próximo horário livre e avisa.
Hora fora da jornada é aceita no mesmo dia (no modo *próximo dia útil* ela é recusada).

**Barra de progresso:** abaixo do Controle de tempo aparece a jornada do dia — uma barra
com o quanto você já atuou (cinza) mais o que este lançamento vai somar (azul) contra o
teto de 6h, e uma linha do tempo 11:00–17:00 mostrando cada apontamento no horário real.
A lista "Horários que serão apontados" mostra o plano exato antes de você aplicar. Depois
de aplicar, a barra é recarregada do Jira e passa a mostrar o tempo já atuado.

**Estimativa x trabalhado:**

- Estimativa em branco é gravada igual ao tempo trabalhado — assim as duas sempre batem.
- Se você preencher as duas e elas não baterem, o modal avisa a diferença antes de aplicar.
- Ao mover para um status de **Concluído** (categoria "done" do Jira, não pelo nome), o
  último apontamento zera o tempo restante.

Tudo isso é configurável nas Opções (início, fim, teto, fins de semana, as duas regras de
estimativa). No modo *próximo dia útil*, o teto não pode ser maior que a janela (11:00–17:00 = 6h).

### Story points (Fibonacci)

O formulário tem um seletor com **1 · 2 · 3 · 5 · 8 · 13 · 21**, já com **1** marcado
(o padrão é configurável nas Opções). **manter** deixa o valor atual da subtarefa intacto.

- Abaixo do seletor aparece o valor atual — ex.: `atual: 3 → será 1` — para você não
  sobrescrever sem perceber.
- Só valores de Fibonacci são aceitos; qualquer outro é recusado antes de enviar ao Jira.
- O campo é descoberto pelo nome na tela de edição ("Story point estimate", "Story Points",
  "Pontos de história"). Se a subtarefa não tiver o campo, o resultado mostra isso
  explicitamente; no lote, o modal avisa em quantas subtarefas o campo existe.

### Meu dia (meta de 4h, teto de 6h)

A aba **Meu dia** mostra, para a data escolhida:

- **Total apontado x meta**, com um selo: *Faltam 30m para a meta*, *✓ Meta batida · +1h*
  ou *Passou do teto de 6h*.
- **Linha do tempo 11:00–17:00** com cada apontamento no horário real, uma cor por demanda.
- **Demandas trabalhadas** — chave, status, resumo, horários e tempo de cada uma; clique
  para abrir no Jira.
- **Últimos 10 dias úteis** — gráfico de barras com a linha da meta: verde = meta batida,
  azul = abaixo, cinza = sem apontamento. Clique numa barra para abrir aquele dia.

Navegue com ‹ › (pulando fins de semana), pelo calendário ou em **Hoje**. Os dados vêm
dos seus worklogs no Jira, então o que você apontar à mão também aparece.

### Formato de tempo (M · H · D)

Aceita e normaliza para o formato do Jira:

```
10m → 10m        20  → 20m (número puro = minutos)
2h  → 2h         1h30 → 1h 30m
1,5h → 1h 30m    1d   → 6h
1.5d → 9h        2D3H → 15h  (case-insensitive)
```

Há um preview embaixo do campo mostrando o total em minutos antes de você aplicar.
**1 dia = 6 horas** (a jornada). Para o Jira a extensão envia sempre horas e minutos
(`1d` sai como `6h`), nunca "d" — senão o Jira usaria o expediente dele, geralmente 8h.

### Status

O dropdown lista **as transições realmente disponíveis** para aquela subtarefa
(Em andamento, Concluído, o que o seu workflow permitir). Nada é chutado por nome;
se uma transição não aparece, é porque o workflow não a permite a partir do status atual.

## O rascunho não se perde ao fechar

O popup do Chrome é destruído toda vez que perde o foco — não existe "minimizar".
Por isso a extensão salva tudo continuamente em `chrome.storage.session`:

- o que você digitou em cada campo, nas duas abas;
- as listas já carregadas do Jira (subtarefas, status disponíveis) — reabrir **não**
  refaz as chamadas de API;
- quais subtarefas estavam marcadas no lote;
- o último resultado da aplicação.

Ao reabrir, aparece um aviso "Rascunho restaurado (salvo há X min)" e tudo volta como
estava. O rascunho vale enquanto o Chrome estiver aberto (nunca vai para o disco) e
expira em 12h, para você não aplicar datas de ontem sem perceber.

O botão 🗑 no topo descarta tudo — listas, campos e resultado. O botão **Limpar**
zera só os campos, mantendo as listas carregadas.

## Detalhes de comportamento

- **Cada etapa é reportada separadamente.** Se a estimativa gravou mas a transição
  falhou por permissão, você vê `✓ Campos` e `✕ Status — motivo`, em vez de um erro genérico.
- **"Data de início"** é descoberta pelo `editmeta` da issue, casando nomes como
  *Start date*, *Data de início*, *Target start*. Se a sua instância usa outro nome,
  coloque o `customfield_XXXXX` nas Opções para forçar.
- **O worklog começa na Data de início**, no primeiro horário livre da jornada
  (veja "Jornada de trabalho" acima).
- Colar a URL da issue no campo de busca também funciona.

## Arquivos

```
manifest.json      permissões, atalho, content script
background.js      cliente REST, descoberta de campos, aplicação em 3 etapas, lote
modal.html/.js/.css  formulário com as abas "uma tarefa" e "em lote"
content.js/.css    overlay no Jira + botão flutuante
options.html/.js/.css  credenciais e ajustes (visual próprio)
lib/duration.js    parser M/H/D (testável isoladamente)
lib/draft.js       persistência do rascunho (storage.session)
lib/schedule.js    agendador da jornada: janela, teto diário, encaixe e dias úteis
lib/devstats.js    métricas do DEV (sequência, período, demandas)
lib/teamstats.js   métricas do SCRUM (sprint, pessoas, riscos) e do DESIGN (HUs)
lib/role.js        perfil do pacote (gerado pelo build.mjs)
```

## QuickFill DEV

O mesmo código gera uma segunda extensão, `jira-quickfill-dev.zip`, feita para quem desenvolve.
Ela é só de leitura e tem as abas **Hoje · Progresso · Demandas · Equipe**: o seu dia contra a meta,
a sequência de dias, o histórico, as demandas com o QA, as que voltaram e as entregues, além da equipe.
As duas extensões podem ficar instaladas juntas. Para usar a mesma configuração nas duas, use
**Opções › Exportar configuração** e, na outra, **Importar configuração…**. Os detalhes estão no
README do pacote DEV.

## Novidades da 4.0 — novo visual

- **Painel lateral do Chrome** (padrão): o ícone da extensão, o botão no Jira e o atalho abrem o QuickFill
  ao lado da página. O botão **◧ / ⤢** no topo alterna para o **modal grande** sobre o Jira (até 1000×860)
  sem perder onde você estava. Dá para escolher o padrão em Opções › Aparência e abertura.
- **Cor de destaque por perfil** (QA azul, DEV verde, SCRUM âmbar, DESIGN rosa), trocável em Opções numa
  paleta igual para todos. As cores de dados (em andamento, abaixo da meta, burndown) continuam fixas.
- **Setas para recolher/expandir** em todos os cards com título; fica lembrado por tela.
- Com espaço sobrando (modal grande), os cards se organizam em **duas ou três colunas**.
- **Aviso de nova versão** vindo do repositório da equipe — ver DISTRIBUICAO.md na raiz do projeto.

## Voltar de onde parou (3.11)

Fechar clicando fora, com **Esc**, abrindo uma demanda no Jira ou trocando de aba do navegador guarda a tela:
aba, rolagem, filtros, buscas, cartões abertos e campos digitados (inclusive a evidência de teste). Ao reabrir, volta igual, com os
dados que já estavam carregados (até 10 min; o ↻ sempre busca de novo). O **X** fecha de verdade: limpa isso e,
na próxima vez, tudo vem do Jira.

## Novidades da 3.7 — mesmos filtros dos outros QuickFill

- **Espaço (Todos · MEED · SUS)** no topo de **Painel, Validação, Meu dia e Equipe** — o mesmo filtro do DEV/SCRUM,
  lembrado entre as telas. O Painel sempre mostra MEED e SUS (antes só os espaços em que você tinha demanda).
- **Período (Hoje · 7 · 14 · 30 dias)** em **Painel, Validação e Meu dia**:
  - Painel: "vencem no período", "concluídas no período" e o atalho **Movimentadas** (atualizadas no período);
    a lista continua com todas as suas demandas abertas.
  - Validação: separa o que **chegou no período** do que **espera há mais tempo**.
  - Meu dia: o histórico vira **últimos N dias úteis** (total, média e dias com meta); em Hoje, só o dia.
- **Equipe** usa o Espaço e mantém a própria data (sem Período). Tarefa e Lote não mudam.

## Novidades da 3.5

- **Tarefa:** a subtarefa atribuída a você aparece com **Você** (as outras mostram o responsável) e, com várias
  subtarefas, a sua "Testes Manuais" já abre selecionada.
- **Painel:** abre na hora com o que já estava carregado e atualiza sozinho; atalhos **Em andamento · A fazer ·
  Testes Manuais**, busca no topo (também pela tarefa pai), em andamento primeiro e sprints recolhíveis.
- **Etapas novas nos 4 QuickFill:** **Impedido / Aguardando** (não conta mais como em andamento) e **Validado**
  (sai da fila do QA). Opções › Etapas do quadro › **Ver como cada status foi classificado** mostra cada coluna.

## Novidades da 3.4

- **Aba Validação:** a fila de tudo que está nas colunas de validação, por prioridade e tempo esperando,
  com **Testar** (abre na aba Tarefa) e o filtro *Atribuídas a mim*.
- **Evidência de teste / retorno ao DEV** (aba Tarefa, abaixo da lista): Aprovado ou Reprovado,
  ambiente, passos/evidência e link. Vira um comentário padronizado na tarefa pai (ou na selecionada).
  Na reprovação escolha a categoria (Opções) e o motivo: a demanda ganha a etiqueta `retorno-<categoria>`.
- **Etapas do quadro** nas Opções (Feito, Deploy, Validação, Reaberto) — provisório, vazio = padrão.

## QuickFill SCRUM e QuickFill DESIGN

O mesmo código gera mais dois painéis só de leitura:

- **SCRUM** (`jira-quickfill-scrum`, botão **SM**, Ctrl+Shift+K): Sprint (burndown, previsão, velocidade,
  HUs/tarefas/bugs e subtarefas, card “Realizando Deploy”), Pessoas (WIP, **Atribuir** com sugestão),
  Riscos (impedidas, paradas, aguardando deploy, fila do QA, causa do retrabalho…) e Equipe.
- **DESIGN** (`jira-quickfill-design`, botão **UX**, Ctrl+Shift+E): Hoje, HUs (prototipando, revisão,
  entregue ao dev, Figma/Protótipo por HU, checklist de handoff, meta semanal), Progresso e Equipe.

## Build (um código, quatro extensões)

Edite os arquivos **nesta pasta** e rode `node build.mjs` na raiz do projeto: ele copia o código
compartilhado para as pastas DEV, SCRUM e DESIGN e gera o que muda por perfil (`lib/role.js`,
`manifest.json`, `content.js`, `content.css` e os ícones). `npm run zip` também gera os .zip e
`npm test` roda os testes das métricas (`tests/`).

## Atualizando a extensão

Depois de trocar os arquivos, **sempre clique em recarregar (↻)** no card da extensão em
`chrome://extensions`. Sem isso, as telas carregam os arquivos novos, mas o serviço em
segundo plano continua rodando o código antigo da memória — e aparecem erros como
*"The message port closed before a response was received"* ou apontamentos às 06:00.

A partir da 1.8 a extensão detecta isso sozinha: ao abrir, ela compara a versão do serviço
com a dos arquivos e, se forem diferentes, mostra um aviso vermelho no topo com o botão
**Recarregar extensão**, que resolve sem sair do Jira (o rascunho é preservado).

## Segurança

O API token fica em `chrome.storage.sync` e só é enviado para o domínio configurado —
`host_permissions` está restrito a `https://*.atlassian.net/*`. Nenhum servidor
intermediário. Para revogar o acesso, apague o token em id.atlassian.com.
