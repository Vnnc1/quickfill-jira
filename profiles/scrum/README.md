# Jira QuickFill SCRUM — Sprint e equipe

Painel para quem conduz o time (Scrum Master / gestão). Mostra **como está a sprint**, **quem está
com o quê** e **o que está travando**, além da equipe ao vivo. Só grava no Jira quando você pede:
**Atribuir** uma demanda e **criar o card “Realizando Deploy”**.

A barra **Espaço · Todos | MEED | SUS** vale para todas as abas.

## Voltar de onde parou (3.11)

Fechar clicando fora, com **Esc**, abrindo uma demanda no Jira ou trocando de aba do navegador guarda a tela:
aba, rolagem, filtros, buscas, cartões abertos e campos digitados (rascunho). Ao reabrir, volta igual, com os
dados que já estavam carregados (até 10 min; o ↻ sempre busca de novo). O **X** fecha de verdade: limpa isso e,
na próxima vez, tudo vem do Jira.

## PR, Feito e subtarefas (3.11)

- **PR** (pull request, Meeds All) conta como **Feito** (aguardando deploy), igual ao Feito/hotfix do SUS — inclusive
  o aviso e o botão do card “Realizando Deploy”.
- Subtarefa ainda aberta (ex.: em PR) com a **tarefa pai concluída ou validada** segue o pai: não conta como em
  andamento nem no WIP. Elas aparecem em **Riscos › Subtarefas esquecidas**, para fechar no Jira.

## Novidades da 3.5

- **Período** (Sprint · Hoje · 7 · 14 dias) vale para Sprint, Pessoas e Riscos.
- **⋯ Ajustes** aplicam na hora (regras e quais blocos aparecem).
- **Impedido / Aguardando** e **Validado** em "Onde estão os itens"; **Métricas de fluxo** (cycle time, tempo na
  validação, reabertas, aprovadas de 1ª, vazão) e **Resumo do período**.
- **Pessoas:** a equipe de QA (Opções › Equipe) fica à parte, fora das regras de WIP, "livre" e sugestões.
- **Reabertas:** cada entrada em Reaberto conta uma volta (2×, 3×…); **Fila do QA** é só a coluna Validação.

## Sprint

- Cartão da sprint ativa de cada espaço: datas, dia atual (*dia 8 de 9 úteis*), quanto falta e o objetivo.
- Barras de **tempo decorrido x itens concluídos x pontos concluídos** — se o trabalho fica mais de 10%
  atrás do tempo, a barra fica amarela.
- **HUs · Tarefas · Bugs:** concluídas de cada tipo, e as subtarefas à parte.
- **Previsão no ritmo atual:** quantos itens devem sair até o fim, pelo ritmo de conclusão da sprint.
- **Onde estão os itens:** A fazer · Em andamento · Feito · Deploy · Validação · Concluído.
- **Feito acumulado → card “Realizando Deploy”:** com cards em Feito, aparece o botão para criar o card
  para quem faz o deploy (lista das Opções), com título, descrição, os cards incluídos (desmarque o que
  não vai), vínculo “relacionado a” com cada um e, se quiser, já na sprint ativa. Passando do limite
  (padrão 3), o aviso fica em destaque.
- **Itens e subtarefas:** cada HU/tarefa/bug com as subtarefas, quem está em cada uma e o progresso
  (2/3). *Com subtarefas* mostra só as que foram divididas.
- **⋯ Ajustes:** dias para “parada”, limite de WIP e cards em Feito para o deploy — mudam na hora.
- **Burndown** por itens ou por pontos (botões *Itens | Pontos*), com a linha ideal tracejada.
- **Velocidade das últimas 3 sprints** contra o compromisso atual — avisa quando a sprint tem
  mais do que o time costuma entregar.
- **Copiar resumo:** texto com o andamento e os riscos.

Subtarefas não contam na sprint (o compromisso são as tarefas pai), mas aparecem em Pessoas e Riscos.

## Pessoas

- Uma linha por pessoa com a barra das etapas, itens em andamento (WIP), o mais antigo parado,
  validações, concluídos (com pontos), paradas e retornos. Clique para ver os itens.
- Alerta de **WIP acima do limite** (Opções) e selo **livre** para quem não tem nada aberto.
- **Sem responsável, com sugestão:** para cada item sem dono, sugere quem já atua na mesma tarefa
  pai e não está sobrecarregado, ou quem tem menos coisa em andamento. **Atribuir** abre a lista
  (sugestão já marcada; primeiro quem está na sprint, depois o resto do projeto) e grava ao confirmar.
- Filtro por nome e ordem por carga, WIP ou nome.

## Riscos

Contadores clicáveis e listas para: 🚩 impedidas (campo *Flagged*), 🔁 voltaram para desenvolvimento,
⏳ paradas há N dias úteis, ☑ aguardando deploy (Feito), 🔍 fila do QA, 📅 atrasadas, ⚠ prioridade alta ainda em *A fazer*,
👤 sem responsável, ⌛ passaram da estimativa e ➕ entraram depois do início da sprint.

Com 3 ou mais itens esperando validação, aparece um aviso de gargalo no QA. Quando o QA reprova pelo
QuickFill QA, a causa (etiqueta `retorno-…`) aparece em *Voltaram* e no bloco **Retrabalho por causa**.

## Equipe

A mesma aba do QA e do DEV: ao vivo a cada 30 s, horas de cada pessoa contra a meta e o teto.

## Opções

Além da conexão e da equipe: **dias para considerar parada** (padrão 3), **limite de WIP por pessoa**
(padrão 2), **deploy** (limite de cards em Feito, tipo e título do card, quem faz deploy — busca no Jira)
e **Etapas do quadro** (nomes das colunas Feito, Deploy, Validação, Reaberto; provisório). O campo de story points é detectado sozinho; force o `customfield` se não for encontrado.

## Instalação

1. Carregue a pasta `jira-quickfill-scrum` em `chrome://extensions` (Modo do desenvolvedor › Carregar sem compactação).
2. Nas Opções, preencha a conexão ou importe a configuração exportada de outro QuickFill.
3. No Jira, abra pelo botão **SM** ou com **Ctrl+Shift+K**.
