# QuickFill — investigação e base para evolução

Data: 22/10/2026. Escopo: comunicação com Jira, paginação, identidade, caches de apontamentos e Demandas, planejamento da jornada e integração com os quatro perfis.

## Evidências e arquitetura observada

O projeto é uma extensão Chrome Manifest V3 em JavaScript com módulos ES, sem dependências npm de produção. `src/background.js` recebe mensagens da interface, consulta o Jira com e-mail/API token e executa alterações. `src/modal.js`, `src/design-ux.js` e `src/lib/exec-view.js` montam a interface; `src/content.js` integra a abertura ao Jira. As configurações são lidas de `chrome.storage.sync`; rascunhos usam `storage.session`, com fallback local. `build.mjs` gera QA, DEV, SCRUM e DESIGN a partir do mesmo `src/` e dos metadados em `profiles/`.

O grafo usado no início da investigação em `graphify-out/graph.json` tinha 1.102 nós e 3.372 arestas. O relatório apontava `jira`, `getConfig` e os fluxos de apontamento como pontos centrais. As consultas abaixo ajudaram a delimitar os consumidores afetados; cada defeito foi confirmado lendo o código. Conexões inferidas do Graphify não foram tratadas como prova de defeito.

```powershell
graphify query "fetchMyBusy" --budget 1600
graphify query "myDemands" --budget 2300
```

Após as correções, o grafo foi atualizado com `graphify update .`: JSON, visualização HTML e relatório passaram a incluir os três módulos novos, os arquivos de teste e esta investigação, com referências ao código atual. As extrações semânticas anteriores foram mantidas; cópias de segurança permitem consultar o estado anterior. Os módulos e as correções estão descritos abaixo.

## Defeitos corrigidos

| Fluxo e localização | Comportamento anterior | Comportamento implementado |
|---|---|---|
| `background.js`: `fetchMyBusy`, `applySingle`, `applyBatch` | Resultados com erro de `mapLimit` eram ignorados. A agenda podia guardar totais parciais e aplicar horas sem conhecer todos os horários ocupados. | Falhas na leitura são propagadas e não entram no cache. A prévia informa o erro; aplicação individual e em lote com horas param antes das escritas. |
| `background.js`: `myDemands` | Um único par de chave/Promise era reutilizado entre períodos; a resposta mais lenta podia sobrescrever os dados de outro período. | Cache separado por configuração e intervalo, com compartilhamento apenas da mesma chave. |
| `background.js`: identidade, progresso, status, prioridades, espaços e colunas | Identidade e metadados podiam ser reutilizados depois de mudar a conexão. O cache de espaços não considerava mudanças de projeto ou quadro. | As leituras alteradas consideram a identidade da conexão; espaços consideram projetos, quadros e regras. Falha ao ler prioridades não é guardada permanentemente. |
| `lib/jira-client.js`: transporte extraído de `jira` | Pools locais podiam somar muitas chamadas simultâneas; não havia timeout; `Retry-After` era truncado em 30 segundos. | Até seis chamadas de transporte simultâneas, timeout de 30 segundos por tentativa incluindo leitura do corpo e espera integral do cooldown em parcelas de até 30 segundos. |
| `lib/jira-client.js`: repetição de operações | Escritas recebendo 429 eram repetidas automaticamente. Respostas HTML com HTTP 200 podiam virar dados nulos. | Repetição automática só de GET/HEAD ou chamadas explicitamente de leitura, incluindo POST JQL. Escritas e falhas de rede com resultado incerto não são repetidas pelo transporte. JSON inválido é erro. |
| `lib/jira-search.js`: três implementações de busca | Fallback podia misturar páginas já recebidas; um número 404/405 na mensagem de outro erro acionava o endpoint antigo; token repetido podia manter a paginação ativa. | Paginação compartilhada, fallback pelo status HTTP e reinício dos resultados, limite na última página e detecção de token repetido. |
| `lib/schedule.js`: `buildPlan` | O limite de dias reiniciava para cada item do lote. Itens seguintes podiam ser agendados além dos dias consultados no Jira. | Uma única janela de dias para todo o lote; o que não cabe retorna em `unplaced`. |
| `background.js`: `execSave` | Horas gravadas pelas Execuções não invalidavam os apontamentos já guardados em memória. | Sucessos de worklog invalidam progresso/apontamentos e Demandas antes da próxima leitura. |

A busca de apontamentos passou de 300 para 1.000 demandas e falha explicitamente ao atingir esse teto, em vez de considerar uma lista possivelmente cortada como completa. É uma escolha conservadora: exatamente 1.000 resultados também exigem reduzir o período.

## Requisitos observados após as correções

- **OBS-001:** Quando duas leituras pedirem a mesma chave enquanto a carga estiver em andamento, o cache deve compartilhar a mesma Promise.
- **OBS-002:** Quando período, configuração relevante ou identidade da conexão mudar, a leitura de Demandas deve usar uma chave distinta.
- **OBS-003:** Quando uma leitura falhar, o cache não deve guardar a falha como resultado válido.
- **OBS-004:** Quando o cache for limpo durante uma leitura, essa resposta antiga não deve repovoá-lo.
- **OBS-005:** Enquanto houver cooldown de 429 para a conexão, chamadas novas e chamadas aguardando na fila devem esperar sua expiração antes de enviar a requisição.
- **OBS-006:** Quando um apontamento necessário à agenda não puder ser lido, a aplicação individual ou em lote com horas deve falhar antes das escritas desse fluxo.
- **OBS-007:** Quando os itens excederem a janela da jornada, o plano deve informar o tempo não alocado sem avançar além do limite global de dias.
- **OBS-008:** Quando o endpoint de busca responder 404/405, o fallback deve reiniciar a paginação sem reaproveitar os resultados parciais do endpoint anterior.

## Contratos para próximas implementações

| Módulo | Contrato | Como estender |
|---|---|---|
| `src/lib/async-cache.js` | `createAsyncCache({ ttlMs, maxEntries, now })`, `.get(key, load, { force })`, `.clear()` | Migrar outras leituras para caches com TTL e capacidade definidos. Incluir configuração/conta/período relevantes na chave. `force` ignora o valor pronto, mas compartilha uma leitura já em andamento. |
| `src/lib/jira-client.js` | `createJiraClient({ fetchFn, sleep, now, random, concurrency, timeoutMs })` | Adicionar métricas ou outra política de transporte sem espalhar mudanças pelos handlers. Usar `readOnly: true` apenas em operações sem efeitos de escrita. |
| `src/lib/jira-search.js` | `searchIssues(request, { jql, fields, max, cfg, expand })` | Consumir a mesma paginação em novos relatórios. Preservar `error.status` em adaptadores de transporte. |
| `src/lib/schedule.js` | `buildPlan(...)` continua puro | Adicionar regras de calendário e jornada com testes de intervalos, teto e dias úteis, sem depender de Chrome ou Jira. |
| `tests/background.test.mjs` | Roteador real com Chrome e rede simulados | Exercitar mensagens de novos handlers sem exportar funções internas nem acessar dados reais. |

`connectionKey` contém credenciais apenas como parte de uma chave interna em memória. Não registrar essas chaves em logs, métricas, arquivos ou mensagens da interface. O transporte não introduz persistência de credenciais.

## Verificação e critérios de aceitação

Verificações executadas nesta alteração:

- `npm test`: 90 testes passaram, incluindo os 60 existentes e 30 novos.
- Testes do roteador: aplicação individual/lote bloqueadas com worklogs ilegíveis, recuperação após falha, troca de conexão, períodos concorrentes, mudança de projeto e invalidação após horas das Execuções.
- No cenário simulado, 20 pedidos simultâneos de progresso para o mesmo intervalo produziram uma busca JQL e uma consulta de identidade. Esse resultado mede redução de chamadas duplicadas, não latência real no Jira.
- Testes de transporte: limite global de concorrência, timeout liberando a fila, `Retry-After` de 75 segundos e em data HTTP, HTTP 204, limites de retry, ausência de repetição automática de escritas e erro em resposta HTML.
- `npm run build`: geradas as pastas dos quatro perfis, mantendo as versões existentes.
- `node --check` nos scripts de `src/` e `tests/`, além de `git diff --check`.

Critérios exercitados: dado um lote maior que a janela, nenhum chunk ultrapassa o último dia; dadas respostas fora de ordem, cada período conserva seu resultado; dada uma falha de leitura, nenhum write de aplicação é enviado; dadas leituras idênticas simultâneas, a rede recebe uma única carga daquele conjunto de dados.

As mudanças locais anteriores em `design-ux.js`, `modal.css` e o painel de Execuções foram mantidas. Não houve release, publicação ou alteração dos ZIPs em `dist/`.

## Limites e próximas etapas

Não houve teste autenticado no Jira nem teste interativo da extensão no Chrome. Permissões, automações de cada projeto e desempenho com dados reais ainda precisam de validação no ambiente da equipe. Não há afirmação de cobertura integral do projeto nem de ganho percentual de latência.

Há outros caches próprios em SCRUM, sprints, DESIGN e Figma que ainda não foram migrados para o contrato comum. Próximas mudanças podem migrá-los por fluxo, incluindo testes de expiração e mudança de configuração.

`execSave` envolve várias gravações independentes no Jira: descrição, vínculos, worklogs, propriedade e comentário. A leitura do código mostra que isso não é uma transação. Se uma gravação de horas funcionar e a propriedade falhar, repetir manualmente o salvamento pode duplicar horas. A evolução indicada é um protocolo de operações com IDs estáveis e reconciliação do resultado no Jira, incluindo concorrência entre usuários; esta refatoração de transporte não resolve essa atomicidade.

Aplicações simultâneas originadas em janelas diferentes também não reservam os horários planejados entre si. O limite de transporte reduz concorrência de rede, mas não é um bloqueio de negócio. Uma futura fila de aplicação deve abranger planejamento e escrita e testar reenvio/interrupção do service worker.

Para a verificação manual, carregar a pasta gerada correspondente em `chrome://extensions`, testar Meu dia/Progresso e Demandas, alternar período/projeto, conferir um lote com agenda ocupada e validar o retorno após indisponibilidade do Jira. Para distribuir depois da revisão, seguir o processo de release já documentado no README.

Referências oficiais consultadas para transporte e busca: [rate limits do Jira](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/), [orientações para clientes](https://developer.atlassian.com/cloud/jira/platform/build-an-app-that-respects-rate-limits/) e [busca JQL do Jira Cloud](https://confluence.atlassian.com/jirakb/run-jql-search-query-using-jira-cloud-rest-api-1289424308.html). O endpoint clássico é mantido apenas como compatibilidade com instâncias antigas; o fluxo principal usa `/search/jql`.

## Investigação pelo grafo: assinaturas nas descrições e comentários

Data: 22/10/2026. Escopo desta etapa: a assinatura “Marcado no QuickFill: …” mostrada na descrição de MEED-2426, os caminhos de publicação relacionados e a correção do fluxo usado pelo QA.

### Método e atualidade da evidência

Foi consultado o grafo existente em `graphify-out/graph.json`, com 1.136 nós, 3.440 arestas e 44 comunidades. O snapshot indica o commit `2900ce62ac430ecd1cbb0ef7f9db08bc2131833e`; o HEAD desta investigação era `4044b1b0fae0dc70d8d4c60989e54da4c798ba7f`, com alterações locais adicionais. Portanto, os vínculos serviram para navegação; os números de linha e os comportamentos foram conferidos no código atual. O grafo original não foi regenerado ou substituído.

Consultas realizadas:

```powershell
graphify query createMeetingIssue --budget 1700
graphify query postEvidence --budget 1100
```

Também foi feita uma consulta direta às arestas `calls` de `adfDoc`, identificando seis publicadores: `createMeetingIssue`, `postEvidence`, `uxAction`, `execSave`, `createDeployCard` e `handoffSave`. O recorte entre esses publicadores e os auxiliares de publicação contém 14 nós e 38 arestas extraídas. Como a primeira consulta CLI ultrapassa o orçamento para manter todas as arestas e a segunda trunca a vizinhança, a conclusão não depende só da saída resumida da CLI: os registros correspondentes do JSON e os seis fluxos no código foram lidos.

### Causa confirmada

O fluxo de atividades é `openMeetingModal` → mensagem `CREATE_MEETING_ISSUE` → `createMeetingIssue` → montagem da descrição ADF → `jira` → `POST /rest/api/3/issue`. A emissão da mensagem está em [meetings.js](../src/lib/meetings.js#L456) e o roteamento em [background.js](../src/background.js#L3497). Essa ligação entre interface e serviço foi confirmada no código, pois a chamada indireta pela mensagem não aparece como uma chamada direta no grafo.

Antes da correção desta etapa, `createMeetingIssue` acrescentava um parágrafo em itálico com “Marcado no QuickFill”, data e horários. Isso ocorria mesmo com descrição vazia. A correção anterior tinha removido a assinatura de `postEvidence`, responsável por comentários de evidência, e não alcançava a criação de atividades. São dois publicadores independentes.

`adfDoc`, `adfLines` e `jira` não adicionam a marca. A composição acontecia nos publicadores. Remover a palavra “QuickFill” de todo texto enviado seria uma correção incorreta: a própria descrição da imagem menciona o projeto QuickFill como conteúdo escrito pelo usuário.

### Inventário dos publicadores

| Publicador e evidência atual | Destino | Situação nesta etapa |
|---|---|---|
| [createMeetingIssue](../src/background.js#L2926) | Descrição de atividade/reunião criada pela linha do tempo; compartilhado entre perfis | Corrigido: envia só os parágrafos informados. Quando não há descrição, omite o campo. Datas e horários continuam nos campos/apontamentos. |
| `postEvidence` (nó histórico do grafo) | Comentário de evidência QA | Funcionalidade retirada: formulário, configuração, restauração e handler de publicação removidos. |
| [uxAction, operação clone](../src/background.js#L2667) | Descrição da HU criada no DESIGN | Assinatura removida; mantém a referência e o vínculo com a HU. |
| [execSave](../src/background.js#L2769) | Comentário do worklog e comentário de resumo no DESIGN | Duas assinaturas removidas; mantém título do trabalho, horas, resumo e notas. |
| [createDeployCard](../src/background.js#L2990) | Descrição do card de deploy no SCRUM | Assinatura removida; mantém descrição, lista de cards, vínculos, responsável e sprint. Omite descrição quando vazia. |
| [handoffSave](../src/background.js#L3096) | Comentário de handoff no DESIGN | Assinatura removida; mantém checklist, notas e link do Figma. |

Após a autorização para a retirada integral, os cinco pontos adicionais em DESIGN/SCRUM foram corrigidos e o formulário de evidência foi retirado. O snapshot original ainda contém os seis publicadores antigos; no código atual, `postEvidence` não existe mais. Os auxiliares ADF continuam neutros: não removem palavras ou trechos digitados pelo usuário.

### Requisitos e critérios de aceitação da correção QA

- **OBS-CONTENT-001:** Quando uma atividade da linha do tempo for criada no Jira, a descrição deve conter apenas os parágrafos informados, sem assinatura automática, data ou horários anexados ao texto.
- **OBS-CONTENT-002:** Quando a descrição estiver vazia, a criação deve omitir esse campo, sem gerar um documento ADF vazio ou usar uma assinatura como substituto.
- **OBS-CONTENT-003:** Quando o usuário mencionar “QuickFill” no título ou na descrição, o conteúdo deve ser preservado.
- **OBS-CONTENT-004:** Quando uma atividade for criada, a atribuição e o apontamento de tempo devem continuar funcionando independentemente da remoção da assinatura.

O teste `atividade da linha do tempo cria descrição sem assinatura e preserva texto do usuário`, em `tests/background.test.mjs`, passa pelo roteador real do service worker com Chrome e Jira simulados. Confere igualdade do documento ADF com os parágrafos esperados, ausência de descrição quando vazia, atribuição e worklog de 30 minutos. O título e a descrição do cenário contêm a palavra QuickFill, garantindo que ela não seja removida do conteúdo legítimo.

Verificação da investigação inicial: 99 testes aprovados. Após a retirada integral, `npm test`: 103 testes aprovados. Foram adicionados testes dos publicadores DESIGN/SCRUM, incluindo fallback de prioridade na clonagem, descrição vazia no deploy, preservação de conteúdo, links, horas, checklist e metadados internos. O teste antigo de publicação de evidência foi substituído por um teste que comprova a rejeição da ação retirada, sem chamadas ao Jira. Não houve teste autenticado nem alteração de demanda real no Jira. A montagem do payload foi corrigida antes do transporte; autenticação, token, URL, política de repetição e tratamento de erros do cliente Jira não foram alterados. Erros de criação continuam propagados; a alternativa de atribuição reutiliza os mesmos campos, sem reconstruir ou reinserir a assinatura.

### Retirada da funcionalidade de evidência/retorno ao DEV

Foram removidos o bloco HTML da aba Tarefa, os listeners e funções associados, estilos exclusivos, a configuração `qaRejectCategories` nas Opções e nos defaults, e o handler `POST_EVIDENCE`. A criação automática de comentários de aprovação/reprovação e de etiquetas `retorno-*` por esse formulário deixa de existir.

Snapshots novos guardam apenas filtros e data do QA. Propriedades antigas de evidência nos snapshots são ignoradas, permitindo reabrir uma sessão anterior sem acessar elementos removidos. Dados já gravados no Jira e a leitura de causas históricas pelos relatórios permanecem disponíveis; nenhuma demanda ou etiqueta existente é apagada.

### Limites e encaminhamento

A imagem mostra uma assinatura com data de 15/10/2026. Sozinha, ela não demonstra que a demanda tenha sido criada depois das correções de 22/10. A emissão da assinatura no código atual foi confirmada independentemente dessa data. Remover o gerador impede novas assinaturas, mas não reescreve descrições já gravadas, incluindo a de MEED-2426.

A mudança em `src/` alcança os quatro perfis. Foram regeneradas e conferidas as quatro pastas locais QA, DEV, SCRUM e DESIGN; ZIPs de distribuição e extensão instalada não são atualizados por esse build. É necessário recarregar cada extensão que usa essas pastas para executar o código novo.

Para próximas correções, partir dos consumidores reversos de `adfDoc` e `addComment`, seguir os handlers até o endpoint e testar cada publicador, como foi feito para os cinco pontos de DESIGN/SCRUM. Os auxiliares de ADF devem continuar neutros, sem filtros globais que apaguem texto do usuário. O grafo precisa ter seu snapshot confrontado com o HEAD e com o código local a cada investigação.
