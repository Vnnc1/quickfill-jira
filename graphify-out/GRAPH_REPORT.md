# Graph Report - projeto-quickFill  (2026-10-22)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1136 nodes · 3440 edges · 44 communities (37 shown, 7 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 123 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2900ce62`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Métricas SCRUM e DESIGN
- Reuniões e atividades
- Interface, regras e formulários
- Espaço UX (DESIGN)
- Build e release
- Documentação e distribuição
- Serviço: caches e estado
- Datas, período e Demandas DEV
- Janela flutuante, execuções e durações
- Navegação e seleção de subtarefas
- Linha do tempo e formatação
- Serviço: atribuir e criar
- Manifesto da extensão
- Histórico da demanda
- Aplicação no Jira e mensagens
- Filtros e intervalos de período
- Carregamento dos painéis
- Rascunhos e fechamento
- Apontamentos e Meu dia
- Cache assíncrono e correções
- Opções e perfil
- Abas da tela (HTML)
- Agenda e aplicar (serviço)
- Execuções, comentários e deploy
- Paginação e consultas Jira
- package.json
- Período do QA
- Formulário e ações (HTML)
- Filtros por espaço
- Resultado da aplicação
- Script de conteúdo do Jira
- Tema e cores
- Sprints (serviço)
- Perfis, alertas e configuração
- Seletor de Espaço
- Persistência da visualização
- Sprints e calendário
- Seleção de sprint e dia
- Restauração da visualização
- Escala da interface
- Retorno após aplicação
- Aprimoramento dos cards
- Configuração SCRUM

## God Nodes (most connected - your core abstractions)
1. `jira()` - 56 edges
2. `getConfig()` - 50 edges
3. `send()` - 46 edges
4. `todayISO()` - 44 edges
5. `setMode()` - 38 edges
6. `renderSprint()` - 37 edges
7. `el()` - 35 edges
8. `addDaysIso()` - 34 edges
9. `renderToday()` - 32 edges
10. `renderDemands()` - 29 edges

## Surprising Connections (you probably didn't know these)
- `Limites e próximas etapas` --references--> `execSave()`  [INFERRED]
  specs/quickfill_reverse_spec.md → src/background.js
- `Defeitos corrigidos` --references--> `jira()`  [INFERRED]
  specs/quickfill_reverse_spec.md → src/background.js
- `Defeitos corrigidos` --references--> `fetchMyBusy()`  [INFERRED]
  specs/quickfill_reverse_spec.md → src/background.js
- `Defeitos corrigidos` --references--> `mapLimit()`  [INFERRED]
  specs/quickfill_reverse_spec.md → src/background.js
- `Contratos para próximas implementações` --references--> `connectionKey()`  [INFERRED]
  specs/quickfill_reverse_spec.md → src/lib/async-cache.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Fluxo de atualização com um clique** — distribuicao_verificacao_versao_15min, distribuicao_atualizar_agora, distribuicao_ajudante_native_messaging, distribuicao_instalador_quickfill, distribuicao_repositorio_quickfill_jira [EXTRACTED 1.00]
- **Fluxo de release por perfil** — readme_npm_run_status, readme_npm_run_release, readme_profile_json, readme_update_json, readme_versao_por_perfil [EXTRACTED 1.00]
- **QA panes sharing one period filter (Painel, Validacao, Meu dia)** — src_modal_qaperiodbar, src_modal_pane_panel, src_modal_pane_qaq, src_modal_pane_day [EXTRACTED 1.00]
- **Quatro extensões QuickFill geradas de um só código** — profiles_qa_readme_quickfill_qa, profiles_dev_readme_quickfill_dev, profiles_scrum_readme_quickfill_scrum, profiles_design_readme_quickfill_design, readme_um_codigo_quatro_extensoes, profiles_qa_readme_build_mjs [EXTRACTED 1.00]
- **SCRUM panes sharing one period filter (Sprint, Pessoas, Riscos)** — src_modal_scperiodbar, src_modal_pane_sprint, src_modal_pane_people, src_modal_pane_risks [EXTRACTED 1.00]
- **Worklog apply flow (pick issue, fill form, apply)** — src_modal_pane_single, src_modal_pane_space, src_modal_formcard, src_modal_actionbar [INFERRED 0.85]

## Communities (44 total, 7 thin omitted)

### Community 0 - "Métricas SCRUM e DESIGN"
Cohesion: 0.06
Nodes (93): deployLabel(), feitoLabel(), since(), avg(), businessAge(), businessDays(), DEFAULT_DR, designBoard() (+85 more)

### Community 1 - "Reuniões e atividades"
Cohesion: 0.05
Nodes (84): createJiraClient(), adfToText(), byLabel(), categoryText(), classifyIssue(), groupOfType(), MEETING_GROUPS, MEETING_RULES (+76 more)

### Community 2 - "Interface, regras e formulários"
Cohesion: 0.04
Nodes (46): setMeetingApi(), DESIGN_STAGES, HANDOFF_ITEMS, RISKS, STAGES, TYPE_LABEL, ACT, BOOT (+38 more)

### Community 3 - "Espaço UX (DESIGN)"
Cohesion: 0.09
Nodes (67): act(), actBtn(), age(), ageColor(), ageTxt(), brDate(), card(), chip() (+59 more)

### Community 4 - "Build e release"
Cohesion: 0.06
Nodes (46): buildProfile(), cmpVersion(), contentJs(), downloadOf(), generated(), GH, ghFile(), listFiles() (+38 more)

### Community 5 - "Documentação e distribuição"
Cohesion: 0.06
Nodes (50): Botão Atualizar agora (atualização com um clique), Como distribuir e atualizar os QuickFill, Instalador quickfill.ps1 / atualizar-quickfill.bat, Repositório público Vnnc1/quickfill-jira, Verificação de versão nova a cada 15 min, Jira QuickFill DESIGN: histórico de versões, Espaço UX (abas Quadro, Entregas, Demanda), Olho do Figma (Visualizar telas e Protótipo navegável) (+42 more)

### Community 6 - "Serviço: caches e estado"
Cohesion: 0.04
Nodes (63): _activity, _aliases, _assignable, BOARD_FIELDS, _boardConfigCache, brDay(), _busyCache, checkUpdate() (+55 more)

### Community 7 - "Datas, período e Demandas DEV"
Cohesion: 0.12
Nodes (36): addDaysIso(), DAY_MS, daysOf(), isoOf(), isWeekendIso(), pad(), startOfIso(), averageBefore() (+28 more)

### Community 8 - "Janela flutuante, execuções e durações"
Cohesion: 0.07
Nodes (61): finish(), formatJira(), HOURS_PER_DAY, humanize(), parseDuration(), pickEstimate(), UNIT_MINUTES, cardOf() (+53 more)

### Community 9 - "Navegação e seleção de subtarefas"
Cohesion: 0.11
Nodes (48): applySingleContext(), blankForm(), brDate(), createBatchSubtasks(), discardAll(), formValues(), hmToMin(), initBoards() (+40 more)

### Community 10 - "Linha do tempo e formatação"
Cohesion: 0.10
Nodes (53): meetingsBetween(), avatarColor(), avatarRing(), bigRing(), businessStep(), dayLabel(), dayShort(), fmtDur() (+45 more)

### Community 11 - "Serviço: atribuir e criar"
Cohesion: 0.09
Nodes (40): Evidências e arquitetura observada, adfExcerpt(), adfLinesText(), assertConfigured(), assignableUsers(), assignIssue(), categoryField(), columnKind() (+32 more)

### Community 12 - "Manifesto da extensão"
Cohesion: 0.06
Nodes (31): action, default_icon, default_title, background, service_worker, type, commands, open-quickfill (+23 more)

### Community 13 - "Histórico da demanda"
Cohesion: 0.15
Nodes (27): buildHistory(), fmtSpan(), isBack(), LANE_OF, laneOf(), LANES, noteFor(), onlyReturns() (+19 more)

### Community 14 - "Aplicação no Jira e mensagens"
Cohesion: 0.16
Nodes (26): activationCommand(), afterApply(), apply(), applyBatch(), applySingle(), busy(), checkForUpdate(), checkService() (+18 more)

### Community 15 - "Filtros e intervalos de período"
Cohesion: 0.23
Nodes (12): brShort(), dayShort(), DOW, endMs(), normPeriod(), periodRange(), prevBusinessDay(), startMs() (+4 more)

### Community 16 - "Carregamento dos painéis"
Cohesion: 0.18
Nodes (18): canSkipFetch(), dmRange(), dmSprint(), loadDemands(), loadDmSprintKeys(), loadHus(), loadPanel(), loadPrefs() (+10 more)

### Community 17 - "Rascunhos e fechamento"
Cohesion: 0.38
Nodes (6): clearDraft(), flushDraft(), loadDraft(), saveDraft(), close(), quit()

### Community 18 - "Apontamentos e Meu dia"
Cohesion: 0.14
Nodes (40): boardIssue(), closedSprintStats(), completeLogs(), dayReport(), designHus(), extraFields(), fetchMyBusy(), fullChangelog() (+32 more)

### Community 19 - "Cache assíncrono e correções"
Cohesion: 0.20
Nodes (9): Contratos para próximas implementações, Defeitos corrigidos, Limites e próximas etapas, QuickFill — investigação e base para evolução, Requisitos observados após as correções, Verificação e critérios de aceitação, _statusMeta, connectionKey() (+1 more)

### Community 20 - "Opções e perfil"
Cohesion: 0.12
Nodes (18): INSTALL_CMD, ROLE, UPDATE_URL, Jira Connection Settings (baseUrl, email, apiToken), DEFAULT_VALUES, deployersList(), designPicker, FIELDS (+10 more)

### Community 21 - "Abas da tela (HTML)"
Cohesion: 0.14
Nodes (19): Meu dia Pane, Demandas Pane (DEV) with period, sprint and search filters, HUs Pane (DESIGN legacy), Painel Pane (my demands), Pessoas Pane (SCRUM), Progresso Pane (DEV/DESIGN), Validacao Pane (QA prioritized queue), Riscos Pane (SCRUM) (+11 more)

### Community 22 - "Agenda e aplicar (serviço)"
Cohesion: 0.16
Nodes (22): applyBatch(), applySingle(), applyToSubtask(), clearBusyCache(), planWorklogs(), previewWorkday(), resolveEstimate(), resolveStartTime() (+14 more)

### Community 23 - "Execuções, comentários e deploy"
Cohesion: 0.32
Nodes (19): addComment(), adfBold(), adfDoc(), adfLines(), adfLink(), adfList(), adfPara(), adfText() (+11 more)

### Community 24 - "Paginação e consultas Jira"
Cohesion: 0.40
Nodes (3): searchPlain(), searchIssues(), query

### Community 25 - "package.json"
Cohesion: 0.17
Nodes (11): author, description, license, name, private, scripts, build, release (+3 more)

### Community 26 - "Período do QA"
Cohesion: 0.20
Nodes (18): activityRendered(), activityRow(), dueInPeriod(), inQp(), isoOfMs(), loadActivity(), movedInPeriod(), pad() (+10 more)

### Community 27 - "Formulário e ações (HTML)"
Cohesion: 0.20
Nodes (11): Fixed Action Bar (Aplicar/Limpar), Day Goal Pill (dayPill ring), Test Evidence / Return to DEV Block, Shared Worklog Form (formCard), Tarefa Pane (single issue lookup), Lote Pane (MEED/SUS batch), Keys and Boards Settings (default project, aliases, batch columns), QA Rejection Categories Setting (+3 more)

### Community 28 - "Filtros por espaço"
Cohesion: 0.47
Nodes (6): designOnly(), inSpace(), scopedDay(), scopedProg(), scopedTeam(), scopeEntries()

### Community 29 - "Resultado da aplicação"
Cohesion: 0.31
Nodes (10): blankSpace(), defaultEnd(), link(), nowEnd(), renderBatchResult(), renderCreateResult(), renderSingleResult(), restore() (+2 more)

### Community 30 - "Script de conteúdo do Jira"
Cohesion: 0.52
Nodes (6): close(), currentIssueKey(), destroy(), open(), sizeFrame(), toggle()

### Community 31 - "Tema e cores"
Cohesion: 0.38
Nodes (6): applyAccent(), hexRgb(), loadAccent(), PALETTE, ROLE_ACCENT, renderSwatches()

### Community 32 - "Sprints (serviço)"
Cohesion: 0.28
Nodes (9): boardHasSprints(), closedSprints(), findScrumBoard(), sprintDate(), sprintFieldId(), sprintInfo(), sprintIssues(), sprintsByJql() (+1 more)

### Community 33 - "Perfis, alertas e configuração"
Cohesion: 0.50
Nodes (4): QuickFill Role Profiles (QA, DEV, SCRUM, DESIGN), Stale/Update/Restored Alerts, Appearance and Update Settings (accent, update.json, one-click native update), Config Export/Import between QuickFill variants

### Community 36 - "Persistência da visualização"
Cohesion: 0.50
Nodes (4): uxViewState(), saveView(), saveViewSoon(), viewSnapshot()

### Community 37 - "Sprints e calendário"
Cohesion: 0.50
Nodes (4): addDays(), businessDaysUntil(), daysBetween(), renderSprints()

### Community 38 - "Seleção de sprint e dia"
Cohesion: 0.67
Nodes (3): paintScDay(), paintSprintPick(), scPastSprint()

## Ambiguous Edges - Review These
- `Role-gated Tab Navigation (data-roles)` → `Lote Pane (MEED/SUS batch)`  [AMBIGUOUS]
  src/modal.html · relation: references

## Knowledge Gaps
- **13 isolated node(s):** `Floating Mini Window (floatMini)`, `Jira Connection Settings (baseUrl, email, apiToken)`, `Progresso Pane (DEV/DESIGN)`, `Hoje Pane (DEV/DESIGN)`, `Global Space Selector (spaceBar)` (+8 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 217 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `QuickFill — investigação e base para evolução` connect `Cache assíncrono e correções` to `Serviço: atribuir e criar`, `Documentação e distribuição`?**
  _High betweenness centrality (0.115) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `jira()` (e.g. with `Defeitos corrigidos` and `Evidências e arquitetura observada`) actually correct?**
  _`jira()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Floating Mini Window (floatMini)`, `Jira Connection Settings (baseUrl, email, apiToken)`, `Progresso Pane (DEV/DESIGN)` to the rest of the system?**
  _13 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Métricas SCRUM e DESIGN` be split into smaller, more focused modules?**
  _Cohesion score 0.06019377447948877 - nodes in this community are weakly interconnected._
- **Why does `parseDuration()` connect `Janela flutuante, execuções e durações` to `Interface, regras e formulários`, `Serviço: caches e estado`, `Navegação e seleção de subtarefas`, `Aplicação no Jira e mensagens`, `Agenda e aplicar (serviço)`, `Execuções, comentários e deploy`?**
  _High betweenness centrality (0.109) - this node is a cross-community bridge._
- **Should `Reuniões e atividades` be split into smaller, more focused modules?**
  _Cohesion score 0.05025699600228441 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Role-gated Tab Navigation (data-roles)` and `Lote Pane (MEED/SUS batch)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._