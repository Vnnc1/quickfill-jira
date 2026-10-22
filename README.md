# QuickFill para Jira

Extensões do Chrome para o dia a dia da equipe no Jira:

| QuickFill | Para quem | O que faz |
|---|---|---|
| **QA** | QA | Preenche datas, estimativa, horas e status das subtarefas (Testes Manuais), em uma tarefa ou em lote. Inclui fila de validação e Meu dia |
| **DEV** | Desenvolvimento | Seu dia contra a meta, progresso por sprint e suas demandas (PR, deploy, validação, reabertas) |
| **SCRUM** | Scrum Master | Saúde da sprint, burndown, quem está com o quê, riscos e o card "Realizando Deploy" |
| **DESIGN** | Design UI/UX | HUs por etapa, quem está esperando design, Figma por HU, checklist de handoff e meta semanal |

Os quatro perfis enviam descrições, comentários e apontamentos sem acrescentar assinaturas
automáticas do QuickFill. O antigo formulário de evidência/retorno ao DEV foi retirado.

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
   [API token do Jira](https://id.atlassian.com/manage-profile/security/api-tokens). Depois clique em **Testar conexão**.
   A ativação do Ajudante para atualizar com um clique é opcional.

## Atualizar

Quando houver uma atualização, o **modal de novidades** abre uma vez com as alterações e o histórico
do seu perfil. Você pode reabri-lo pelo botão **Novidades e histórico de versões**, no cabeçalho,
ou por **Ver o que mudou** no aviso.

**Pelo PowerShell:** no modal, clique em **Copiar comando de atualização**, abra o PowerShell, cole e
tecle **Enter**. Depois clique em **Recarregar extensão** (ou recarregue em `chrome://extensions`).
Esse comando atualiza apenas o seu perfil e não instala nem modifica o Ajudante.

**Com um clique (opcional):** ative uma vez em **Opções › Atualização com um clique**, ou abra a opção
**Ajudante opcional para atualizar com um clique** no modal de novidades.
Clique no botão, tecle **Win + R**, cole (**Ctrl+V**) e tecle **Enter**. Pronto: quando sair versão nova,
chega uma notificação do Windows e o aviso no topo do QuickFill mostra **Atualizar agora**: ele baixa, instala e se recarrega sozinho.

Somente o comando de ativação instala o Ajudante em `Documentos\QuickFill\.ajudante` e registra o
Native Messaging para seu usuário do Windows. Quem já tem o Ajudante pode continuar usando-o.

As configurações, o token e as metas continuam.

---

## Para quem mantém o código

Um código só, quatro extensões, **cada uma com a sua versão**.

```
src/                         código compartilhado: é aqui que se edita
profiles/<perfil>/           o que é de cada extensão (qa, dev, scrum, design)
  profile.json               versão, nome, descrição, atalho e permissões extras
  CHANGELOG.md               o que mudou em cada versão daquele perfil
  README.md                  manual que vai dentro do pacote
  files/                     (opcional) arquivos que substituem os de src/ só naquele perfil
jira-quickfill-<perfil>/     gerado pelo build para testar no Chrome (fora do git)
dist/<pasta>.zip             o que está publicado de cada perfil
update.json                  versão, data e notas publicadas de cada perfil
```

```
npm test                                  # testes
npm run build                             # gera as 4 pastas para testar no Chrome
npm run build -- --notes "Correção no filtro; Melhorias na busca"  # notas do build local
npm run status                            # versão de cada perfil e quais têm mudança não lançada
npm run release -- dev -m "o que mudou"   # lança só o DEV (4.8.2 → 4.8.3)
```

Cada build inclui `lib/changelog-data.js` com o histórico do perfil, um identificador do conteúdo e um
relatório automático dos arquivos alterados desde o último commit do `CHANGELOG.md` daquele perfil
(incluindo alterações locais e arquivos novos). As mensagens dos commits desse período entram como
notas automáticas; `--notes` permite fornecer a descrição das mudanças no lugar delas.
O modal abre uma vez por conteúdo novo do build, inclusive quando o número da versão continua igual.
O build não publica nem aumenta versões: as notas oficiais continuam sendo registradas no release.

Os contratos de cache, transporte e paginação, as correções investigadas com Graphify e os pontos para futuras refatorações estão em [Investigação técnica do QuickFill](specs/quickfill_reverse_spec.md).

### Lançar uma versão

1. `npm run status` mostra quais perfis mudaram desde a última versão publicada.
2. Lance só os perfis que a correção atinge:
   - `npm run release -- dev -m "Hoje: corrige a meta do dia"` → só o DEV sobe (patch: 4.8.2 → 4.8.3);
   - `npm run release -- dev,scrum -m "..."` → DEV e SCRUM, cada um a partir da sua versão;
   - `npm run release -- todos --minor -m "..."` → os 4, número do meio (4.8.x → 4.9.0); `--major` → 5.0.0;
   - `--dry` mostra o que faria sem gravar; separe itens da nota com `;` (viram linhas no CHANGELOG).
3. O release roda os testes, sobe a versão em `profiles/<perfil>/profile.json`, escreve no
   `CHANGELOG.md` do perfil, gera o `.zip` **só dos perfis lançados** e atualiza o `update.json` só para eles,
   incluindo o histórico estruturado em `packages.<perfil>.changelog` para o modal de quem vai atualizar.
4. Faça o `git commit` e o `git push` que ele mostra no fim.

Os perfis que não foram lançados continuam com a mesma versão e o mesmo `.zip`: quem usa não recebe aviso.
Quando o código compartilhado muda, `npm run status` marca os perfis afetados; lance quando fizer sentido para cada um.

Em uns 20 minutos o aviso aparece para quem usa o perfil lançado, com as notas daquele perfil.
O instalador só baixa de novo o perfil cuja versão mudou. Detalhes em [DISTRIBUICAO.md](DISTRIBUICAO.md).
