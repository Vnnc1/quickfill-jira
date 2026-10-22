# Como distribuir e atualizar os QuickFill na equipe

Repositório **público**: <https://github.com/Vnnc1/quickfill-jira> (branch `master`). Não precisa de
token nem de conta no GitHub para instalar ou atualizar.

## Para a equipe: mande só isto

> **Instalar o QuickFill:** abra <https://github.com/Vnnc1/quickfill-jira> e siga o "Instalar (1 minuto)".

Não precisa mandar arquivo nenhum. O instalador sempre baixa a versão mais nova.

| Quando | O que a pessoa faz |
|---|---|
| **Primeira vez** | Win+R › cola o comando do README › escolhe o perfil › carrega a pasta (já copiada) em `chrome://extensions` › preenche as Opções |
| **Ativar o botão (uma vez)** | Opções › **Ativar atualização com um clique** › Win+R › Ctrl+V › Enter |
| **Versão nova** | Clica em **Atualizar agora** no aviso do QuickFill (sem ativar: **Copiar comando de atualização** › Win+R › Ctrl+V › Enter › **Recarregar extensão**) |

- A extensão fica em `Documentos\QuickFill\<pasta>` (ex.: `C:\Users\Fernanda\Documents\QuickFill\jira-quickfill-dev`).
  Se o Documentos estiver no OneDrive, vai para lá.
- O instalador atualiza só os perfis que a pessoa já tem. Para instalar outro, basta rodar e escolher.

Para atualizações o sistema retorna qualquer atualização em uns 20 minutos (a partir da versão com a verificação a cada 15 min), quem abrir o QuickFill vê o aviso de versão nova.

## Como funciona o botão "Atualizar agora"

O Chrome não deixa uma extensão alterar os próprios arquivos. Quem quiser atualizar com um clique pode
ativar um pequeno **ajudante** do Chrome (*Native Messaging*) nas Opções ou no modal de novidades.
A instalação e a atualização comuns pelo PowerShell não criam nem regravam o Ajudante ou o Registro.
Somente o comando de ativação usa `QF_AJUDANTE=1` (ou `-AtivarAjudante -ExtId <id>`):
- fica em `Documentos\QuickFill\.ajudante` e vale só para aquele usuário do Windows, sem administrador;
- é liberado apenas para os QuickFill que pediram;
- ao clicar no botão, a extensão chama o ajudante, que roda o mesmo instalador em modo silencioso e baixa a
  versão nova do repositório; em seguida a extensão se recarrega e volta onde a pessoa estava.

Para desativar, apague a pasta `.ajudante` e as chaves
`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.quickfill.updater` e
`HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.quickfill.updater`.

## Novidades por versão e por build

O modal abre uma vez por versão disponível e por conteúdo novo instalado. O histórico pode ser
reaberto pelo botão de novidades no cabeçalho. As notas vêm do `CHANGELOG.md` de cada perfil e são
incluídas no pacote e em `update.json` quando há release, inclusive para quem pulou versões.
Servidores antigos que fornecem apenas `notes` continuam funcionando.

`npm run build` gera também um relatório dos arquivos alterados e as mensagens dos commits desde o
último registro do histórico. Para fornecer descrições específicas,
use `npm run build -- --notes "Correção na busca; Ajudante opcional"`. Para publicar e notificar a
equipe, continue usando `npm run release -- <perfil> -m "o que mudou"` e publique os arquivos gerados.

## Perguntas comuns

- **"Desative extensões no modo de desenvolvedor"** ao abrir o Chrome: é o aviso normal para extensões fora
  da loja. É só fechar.
- **Win+R está bloqueado na máquina:** abra o **PowerShell** pelo menu Iniciar e cole o mesmo comando.
- **O Windows avisou que o .bat é de fonte desconhecida:** clique em *Mais informações › Executar assim mesmo*,
  ou use o comando pelo Win+R, que não passa por esse aviso.
