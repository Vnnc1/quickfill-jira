# Jira QuickFill DESIGN — HUs e metas

Painel para quem faz UI/UX. Uma HU de design é a **prototipação** do que vai (ou não) para o Figma e
depois para o desenvolvimento. Mostra **suas HUs por etapa**, **quem está esperando pelo design**,
**como você vai na meta da semana** e leva direto à **tela no Figma**.

A barra **Espaço · Todos | MEED | SUS** vale para todas as abas.

## Voltar de onde parou (3.11)

Fechar clicando fora, com **Esc**, abrindo uma demanda no Jira ou trocando de aba do navegador guarda a tela:
aba, rolagem, filtros, buscas, cartões abertos e campos digitados (inclusive o checklist de handoff ainda não salvo). Ao reabrir, volta igual, com os
dados que já estavam carregados (até 10 min; o ↻ sempre busca de novo). O **X** fecha de verdade: limpa isso e,
na próxima vez, tudo vem do Jira.

## Espaço de Design (3.5)

Configure **Opções › HUs de design › Projeto(s) do espaço de Design**: Hoje, HUs, Progresso e Equipe passam a
usar só esse espaço (não MEED/SUS). HUs impedidas/aguardando aparecem num bloco próprio.

## Hoje e Progresso

Os mesmos do QuickFill DEV: horas do dia contra a meta, ritmo, sequência, histórico e "onde foi seu tempo".

## HUs

Entram as HUs atribuídas a você, as que você moveu nos últimos 60 dias e todas que tiverem uma das
**etiquetas de design** (Opções; padrão `design, ux, ui`). *Todas | Minhas* alterna o recorte.

- **Resumo:** na fila · em design · em revisão · entregues na semana contra a meta.
- **⏰ Devs aguardando design:** HUs da sprint ativa que ainda não saíram do design — o que mais
  segura o time. Prioridade alta fica destacada.
- **Entregas por semana:** últimas 6 semanas contra a meta, com o lead time médio do design e
  quantas vezes uma HU voltou da revisão.
- **Colunas:** Na fila · Prototipando · Em revisão · Entregue (backlog do dev) · Implementadas.
- **Figma:** o botão **Figma do projeto** abre o arquivo do Meeds V2. Em cada HU, **Figma** e
  **▶ Protótipo** levam direto à tela — pelo link colado na HU ou, com o token do Figma nas Opções,
  pelo nome do frame (com a chave `MEED-123` ou `HU 12` no nome).
- **Checklist de handoff (Design → DEV):** Figma, estados, responsivo, acessibilidade, textos, Design
  System, protótipo e critérios com o PO. *Salvar* guarda na HU (qualquer QuickFill lê);
  *Concluir handoff* também comenta na HU para o dev.
- **Sem tela do Figma vinculada:** HUs em andamento sem link nem frame encontrado.

A etapa vem do **nome do status** (configurável nas Opções). **Entregue** = protótipo concluído e a HU
seguiu para o backlog da sprint do dev (Meeds All) — pelo status (ex.: *Pronto para dev*) ou por ter
entrado numa sprint depois de prototipada.

## Opções

**Etiquetas de design**, **meta de HUs por semana** (padrão 3), **nomes dos status** do Design
(provisório), **link do Figma do projeto** e **token do Figma** (opcional), além da conexão, meta e equipe.

## Instalação

1. Carregue a pasta `jira-quickfill-design` em `chrome://extensions` (Modo do desenvolvedor › Carregar sem compactação).
2. Nas Opções, preencha a conexão ou importe a configuração exportada de outro QuickFill.
3. No Jira, abra pelo botão **UX** ou com **Ctrl+Shift+E**.
