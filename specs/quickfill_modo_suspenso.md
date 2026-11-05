# QuickFill suspenso no Jira

## Atualização de 05/11/2026 — interface nativa

O clique no card pertence ao Jira. Foi removido o modal próprio que interceptava esse clique. O QuickFill complementa a área lateral de informações da demanda, tanto no modal quanto na visualização completa (`/browse/CHAVE`), com um painel recolhível em Shadow DOM.

O painel mostra responsável, status, prioridade, prazo, tempo apontado/restante e atividade recente (até cinco comentários e cinco registros recentes do histórico, combinados em até oito eventos). Permite comentar, apontar minutos com data de início, consultar e executar transições permitidas e copiar o link. Transições com campos obrigatórios sem padrão orientam usar o seletor nativo. As gravações usam a sessão da aba e não são repetidas automaticamente. A interface nativa pode precisar de atualização após uma gravação pela API.

Ao segurar um card por 350 ms ou iniciar seu arraste, o menu de hover fecha e aparecem guias tracejadas. Os destinos vêm das transições da tarefa e dos IDs de status configurados nas colunas do quadro. Nunca se infere workflow pela posição das colunas. O Jira continua responsável pelo drop; o QuickFill não faz uma segunda gravação. Sem acesso à configuração, só se usa correspondência exata entre nome de status e coluna. Se não for possível localizar colunas, são mostrados os nomes dos destinos, sem inventar áreas permitidas. Guias são removidas ao soltar, cancelar, pressionar Escape, sair da janela ou desativar o modo.

Cards recebem indicação textual e visual de prioridade máxima/crítica, alta e baixa, além de prazo vencido. O resumo acompanha os cards presentes no DOM e respeita filtros nativos. Quando o conjunto visível é reduzido, os cards passam a exibir responsável, status, prazo e tempo apontado. Os botões **Detalhar/Resumir cards**, **Por responsável** e **Atualizar dados** controlam a apresentação. Contagens descrevem somente o recorte carregado, não o total do projeto; quadros virtualizados podem ter mais tarefas fora desse recorte. Dados têm cache de 30 segundos, renovado ao consultar novamente ou solicitar atualização. Não há recolhimento automático das colunas nativas.

## Experimentar

1. Execute `npm run build` e recarregue a extensão em `chrome://extensions`.
2. Recarregue o Jira e ative **QuickFill** no canto inferior direito.
3. Clique em uma demanda e alterne os modos de visualização do próprio Jira.
4. Segure um card para consultar seus destinos e use o arraste nativo.
5. Filtre por responsável e abra **Por responsável** para os detalhes do recorte.

Os quatro pacotes gerados são `jira-quickfill-qa`, `jira-quickfill-dev`, `jira-quickfill-scrum` e `jira-quickfill-design`. A ativação é lembrada na sessão da aba para acompanhar a abertura de uma demanda completa. Desativar restaura as anotações e remove o painel e as guias. O acesso anterior pelo ícone/atalho da extensão continua disponível.

## Compatibilidade e validação

Limitado ao Jira Cloud em `*.atlassian.net`. O painel é inserido na área nativa de contexto quando reconhecida; se o layout do Jira não expõe essa área, usa um painel flutuante recolhível na própria página. Seletores de cards e colunas são heurísticos e ainda precisam de validação no Jira autenticado da equipe. Não foi acessada nem modificada uma demanda real nesta validação.

A skill design-taste-frontend foi aplicada como aprimoramento de uma interface existente: superfícies neutras, cor reservada às prioridades, textos explícitos e nenhuma reconstrução do quadro. A validação local usa um DOM Jira simulado e APIs simuladas. Foram verificados: clique nativo preservado, painel nos modos normal e tela cheia, comentário ADF enviado ao servidor local, seletor de transições, filtragem de pessoa com contagens e detalhamento coerentes e guias de destino. Testes unitários cobrem mapeamento de múltiplos status por coluna, transições ausentes, prioridades em português/inglês e URLs dos modos nativos.

Build dos quatro perfis e testes específicos passaram. A suíte geral mantém uma falha preexistente em `release empacota histórico e notas só do perfil lançado, sem publicar builds locais`, já reproduzida anteriormente em uma cópia limpa de HEAD: histórico de outro perfil removido de `update.json`. O release não foi alterado nesta tarefa.

APIs de referência: [transições](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/) e [configuração de colunas](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/).
