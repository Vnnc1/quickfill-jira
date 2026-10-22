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
