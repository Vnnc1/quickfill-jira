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

O Chrome não deixa uma extensão alterar os próprios arquivos. Por isso o instalador registra um pequeno
**ajudante** do Chrome (*Native Messaging*):
- fica em `Documentos\QuickFill\.ajudante` e vale só para aquele usuário do Windows, sem administrador;
- é liberado apenas para os QuickFill que pediram;
- ao clicar no botão, a extensão chama o ajudante, que roda o mesmo instalador em modo silencioso e baixa a
  versão nova do repositório; em seguida a extensão se recarrega e volta onde a pessoa estava.

Para desativar, apague a pasta `.ajudante` e a chave
`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.quickfill.updater`.

## Perguntas comuns

- **"Desative extensões no modo de desenvolvedor"** ao abrir o Chrome: é o aviso normal para extensões fora
  da loja. É só fechar.
- **Win+R está bloqueado na máquina:** abra o **PowerShell** pelo menu Iniciar e cole o mesmo comando.
- **O Windows avisou que o .bat é de fonte desconhecida:** clique em *Mais informações › Executar assim mesmo*,
  ou use o comando pelo Win+R, que não passa por esse aviso.
