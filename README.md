# QuickFill para Jira

Extensões do Chrome para o dia a dia da equipe no Jira:

| QuickFill | Para quem | O que faz |
|---|---|---|
| **QA** | QA | Preenche datas, estimativa, horas e status das subtarefas (Testes Manuais), em uma tarefa ou em lote. Inclui fila de validação, evidência de teste e Meu dia |
| **DEV** | Desenvolvimento | Seu dia contra a meta, progresso por sprint e suas demandas (PR, deploy, validação, reabertas) |
| **SCRUM** | Scrum Master | Saúde da sprint, burndown, quem está com o quê, riscos e o card "Realizando Deploy" |
| **DESIGN** | Design UI/UX | HUs por etapa, quem está esperando design, Figma por HU, checklist de handoff e meta semanal |

---

## Instalar (1 minuto)

1. **Rode o instalador.** Use um destes dois jeitos:
   - Tecle **Win + R**, cole a linha abaixo e tecle **Enter**:

     ```
     powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Vnnc1/quickfill-jira/master/dist/quickfill.ps1 | iex"
     ```

   - **ou** baixe o [`atualizar-quickfill.bat`](https://github.com/Vnnc1/quickfill-jira/raw/master/dist/atualizar-quickfill.bat) e dê dois cliques.
2. **Escolha o seu QuickFill:** digite `qa`, `dev`, `scrum`, `design` ou `todos` e tecle **Enter**.
   A extensão fica em **Documentos › QuickFill** e a pasta abre sozinha.
3. **Carregue no Chrome:** abra `chrome://extensions`, ligue o **Modo do desenvolvedor** (canto superior direito),
   clique em **Carregar sem compactação** e escolha a pasta. O caminho já está copiado: é só colar com **Ctrl+V**.
4. **Configure:** clique no ícone do QuickFill › ⚙ **Opções** e preencha a URL do Jira, o seu e-mail e o
   [API token do Jira](https://id.atlassian.com/manage-profile/security/api-tokens). Depois clique em **Testar conexão** e, na mesma página, em **Ativar atualização com um clique**.

## Atualizar

**Com um clique (recomendado):** ative uma vez em **Opções › Atualização com um clique**.
Clique no botão, tecle **Win + R**, cole (**Ctrl+V**) e tecle **Enter**. Pronto: quando sair versão nova,
chega uma notificação do Windows e o aviso no topo do QuickFill mostra **Atualizar agora**: ele baixa, instala e se recarrega sozinho.

**Sem ativar:** no aviso **"Nova versão disponível"**, clique em **Copiar comando de atualização**, tecle
**Win + R**, cole e tecle **Enter**. Depois clique em **Recarregar extensão**. Esse comando também ativa o
botão para as próximas vezes.

As configurações, o token e as metas continuam.

---

## Para quem mantém o código

O código fica em `jira-quickfill-qa/`; o `build.mjs` gera os quatro pacotes.

```
npm test            # testes das métricas
npm run build       # gera as pastas das 4 extensões
npm run zip         # + os .zip em dist/ e o update.json (publicação)
```

Para publicar uma versão nova:
1. Aumente `VERSION` no `build.mjs` e escreva o que mudou em `notes` no `release.config.json`.
2. Rode `npm test` e `npm run zip`.
3. Faça `git commit` e `git push`.

Em até 6 horas o aviso aparece para todos. Detalhes em [DISTRIBUICAO.md](DISTRIBUICAO.md).
