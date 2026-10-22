# Instala ou atualiza os QuickFill desta máquina a partir do repositório da equipe.
#
#   1ª vez: Win+R > cole o comando do README (ou dois cliques no atualizar-quickfill.bat) > escolha o perfil.
#           Depois, em chrome://extensions: Modo do desenvolvedor > Carregar sem compactação > pasta indicada.
#   Depois: no aviso "Nova versão" do QuickFill, clique em "Atualizar agora" (botão nativo — ver abaixo)
#           ou em "Copiar comando de atualização" e cole no Win+R.
#
# Botão "Atualizar agora": SOMENTE com -AtivarAjudante este script registra um ajudante (Native Messaging, só para
# este usuário, sem administrador) em Documentos\QuickFill\.ajudante. A extensão chama o ajudante, que roda
# este mesmo script em modo silencioso e devolve o resultado; a extensão então se recarrega sozinha.
#
#   -Pacotes qa,dev   instala/atualiza só esses       -AtivarAjudante -ExtId <id>   ativa o botão (opcional)
#   -Silencioso       sem perguntas (usado pelo ajudante)   -TrocarToken   (repositório privado) pede o token de novo
#   Pelo Win+R: QF_EXT_ID, QF_PACOTES e QF_AJUDANTE=1 (consentimento explícito).
#
# Os endereços abaixo são preenchidos pelo build.mjs (release.config.json).

param([string]$Pacotes = "", [switch]$TrocarToken, [switch]$Silencioso, [string]$ExtId = "", [switch]$AtivarAjudante)
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
if (-not $ExtId -and $env:QF_EXT_ID) { $ExtId = $env:QF_EXT_ID }
if (-not $Pacotes -and $env:QF_PACOTES) { $Pacotes = $env:QF_PACOTES }
if ($env:QF_AJUDANTE -eq "1") { $AtivarAjudante = $true }

$UpdateUrl = "__UPDATE_URL__"
$ScriptUrl = "__SCRIPT_URL__"
$HostName  = "com.quickfill.updater"
# Pasta Documentos da pessoa (ex.: C:\Users\Fernanda\Documents\QuickFill) — respeita Documentos no OneDrive
$Documentos = [Environment]::GetFolderPath("MyDocuments")
if (-not $Documentos) { $Documentos = Join-Path $env:USERPROFILE "Documents" }
$Destino   = Join-Path $Documentos "QuickFill"
$TokenFile = Join-Path $Destino ".token"
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Falhar([string]$msg) {
  if ($Silencioso) { throw $msg }
  Write-Host $msg -ForegroundColor Red
  Read-Host "Tecle Enter para fechar" | Out-Null
  exit 1
}

if (-not $Silencioso) { Write-Host ""; Write-Host "  QuickFill - instalar / atualizar" -ForegroundColor Cyan; Write-Host "" }
if ($UpdateUrl -like "__*") { Falhar "Endereço de atualização não configurado (release.config.json)." }
if ($AtivarAjudante -and ($ExtId -notmatch '^[a-p]{32}$' -or $ScriptUrl -like "__*")) {
  Falhar "Para ativar o Ajudante, copie o comando nas Opções do QuickFill (ID da extensão necessário)."
}
New-Item -ItemType Directory -Force -Path $Destino | Out-Null

# Token de leitura (só quando o repositório é privado) — guardado criptografado para este usuário (DPAPI)
$privado = $UpdateUrl -like "*api.github.com*"
$token = ""
if ($privado) {
  if ($TrocarToken -and (Test-Path $TokenFile)) { Remove-Item $TokenFile -Force }
  if (Test-Path $TokenFile) {
    $sec = Get-Content $TokenFile | ConvertTo-SecureString
    $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  } elseif ($Silencioso) { Falhar "Token de leitura não configurado: rode o atualizar-quickfill uma vez pelo Win+R." }
  else {
    Write-Host "Cole o token de leitura do QuickFill (pedir ao responsável) e tecle Enter:" -ForegroundColor Cyan
    $sec = Read-Host -AsSecureString
    $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    if (-not $token) { Falhar "Sem token não dá para baixar do repositório privado." }
    $sec | ConvertFrom-SecureString | Set-Content $TokenFile
  }
}
$headers = @{ "User-Agent" = "quickfill-installer" }
if ($privado) { $headers["Authorization"] = "Bearer $token"; $headers["Accept"] = "application/vnd.github.raw+json" }

Write-Host "Lendo a versão publicada..."
try {
  $sep = if ($UpdateUrl.Contains("?")) { "&" } else { "?" }
  $info = Invoke-RestMethod -Uri ("$UpdateUrl$sep" + "t=" + [DateTimeOffset]::Now.ToUnixTimeSeconds()) -Headers $headers -UseBasicParsing
} catch {
  if ($privado) { Remove-Item $TokenFile -Force -ErrorAction SilentlyContinue; Falhar "O GitHub recusou o acesso — o token pode estar errado ou vencido. Rode de novo e cole um token válido." }
  Falhar "Não consegui ler $UpdateUrl : $($_.Exception.Message)"
}

# Sem parâmetro: atualiza os que já estão instalados; se nenhum, pergunta qual instalar.
$todos = $info.packages.PSObject.Properties | ForEach-Object { $_.Name }
if ($Pacotes) { $lista = $Pacotes.Split(",") | ForEach-Object { $_.Trim().ToLower() } }
else {
  $lista = @($todos | Where-Object { Test-Path (Join-Path $Destino $info.packages.$_.folder) })
  if (-not $lista) {
    if ($Silencioso) { Falhar "Nenhum QuickFill instalado em $Destino." }
    Write-Host "Qual QuickFill instalar? ($($todos -join ', '), ou 'todos')"
    $r = (Read-Host).Trim().ToLower()
    $lista = if ($r -eq "todos") { $todos } else { $r.Split(",") | ForEach-Object { $_.Trim() } }
  }
}

$novos = @()
foreach ($p in $lista) {
  $pkg = $info.packages.$p
  if (-not $pkg) { Write-Host "Pacote desconhecido: $p" -ForegroundColor Yellow; continue }
  if ($pkg.folder -ne "jira-quickfill-$p") { Falhar "Pasta inválida no pacote $p." }
  # Cada perfil tem a sua versão: se este já está na mais nova, não baixa de novo (a não ser que tenha sido pedido pelo nome).
  $manAtual = Join-Path (Join-Path $Destino $pkg.folder) "manifest.json"
  if (-not $Pacotes -and (Test-Path $manAtual)) {
    $instalada = (Get-Content $manAtual -Raw -Encoding UTF8 | ConvertFrom-Json).version
    if ($instalada -eq $pkg.version) { Write-Host "  =   $p $instalada já é a versão mais nova"; continue }
  }
  $zip = Join-Path $env:TEMP "$($pkg.folder).zip"
  Write-Host "Baixando $p $($pkg.version) ..."
  Invoke-WebRequest -Uri $pkg.download -OutFile $zip -Headers $headers -UseBasicParsing
  $pasta = Join-Path $Destino $pkg.folder
  # Valida os caminhos absolutos antes de qualquer exclusão recursiva.
  $destinoAbsoluto = [IO.Path]::GetFullPath($Destino).TrimEnd('\') + '\'
  $pasta = [IO.Path]::GetFullPath($pasta)
  if (-not $pasta.StartsWith($destinoAbsoluto, [StringComparison]::OrdinalIgnoreCase)) { Falhar "Pasta fora do destino QuickFill." }
  if (-not (Test-Path (Join-Path $pasta "manifest.json"))) { $novos += $pasta }
  $tmp = Join-Path $env:TEMP "qf-$p"
  $tempAbsoluto = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
  $tmp = [IO.Path]::GetFullPath($tmp)
  if (-not $tmp.StartsWith($tempAbsoluto, [StringComparison]::OrdinalIgnoreCase)) { Falhar "Pasta temporária inválida." }
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $origem = Get-ChildItem $tmp -Directory | Select-Object -First 1
  if (-not $origem) { $origem = Get-Item $tmp }
  # Mantém a mesma pasta (o Chrome continua apontando para ela); só troca os arquivos.
  New-Item -ItemType Directory -Force -Path $pasta | Out-Null
  Get-ChildItem $pasta -Force | Remove-Item -Recurse -Force
  Copy-Item -Path (Join-Path $origem.FullName "*") -Destination $pasta -Recurse -Force
  if ($privado) { @{ token = $token } | ConvertTo-Json | Set-Content -Path (Join-Path $pasta "update.local.json") -Encoding UTF8 }
  Remove-Item $tmp -Recurse -Force; Remove-Item $zip -Force
  Write-Host "  OK  $p $($pkg.version) em $pasta" -ForegroundColor Green
}

# ---------------------------------------------------------------------------------------------------
# Ajudante do botão "Atualizar agora" (Native Messaging). Registrado para este usuário (HKCU), liberado
# só para as extensões QuickFill que pediram (ids em .ajudante\ids.txt).
# ---------------------------------------------------------------------------------------------------
$ajudante = $false
if ($AtivarAjudante) {
$HostDir = Join-Path $Destino ".ajudante"
$IdsFile = Join-Path $HostDir "ids.txt"
$ids = @()
if (Test-Path $IdsFile) { $ids = @(Get-Content $IdsFile | Where-Object { $_ -match '^[a-p]{32}$' }) }
if ($ExtId -match '^[a-p]{32}$' -and $ids -notcontains $ExtId) { $ids += $ExtId }
if ($ids.Count -and $ScriptUrl -notlike "__*") {
  New-Item -ItemType Directory -Force -Path $HostDir | Out-Null
  Set-Content -Path $IdsFile -Value $ids -Encoding ASCII
  $hostPs1 = @'
# Ajudante do QuickFill (Native Messaging): recebe {"action":"ping"|"update","package":"qa"} da extensão.
$ErrorActionPreference = "Stop"
$in = [Console]::OpenStandardInput(); $out = [Console]::OpenStandardOutput()
function Ler { $b = New-Object byte[] 4; if ($in.Read($b, 0, 4) -lt 4) { return $null }
  $n = [BitConverter]::ToInt32($b, 0); $buf = New-Object byte[] $n; $r = 0
  while ($r -lt $n) { $k = $in.Read($buf, $r, $n - $r); if ($k -le 0) { break }; $r += $k }
  [Text.Encoding]::UTF8.GetString($buf, 0, $r) | ConvertFrom-Json }
function Responder($o) { $j = [Text.Encoding]::UTF8.GetBytes(($o | ConvertTo-Json -Compress))
  $out.Write([BitConverter]::GetBytes($j.Length), 0, 4); $out.Write($j, 0, $j.Length); $out.Flush() }
$msg = Ler
$log = Join-Path $PSScriptRoot "ultima-atualizacao.log"
try {
  if ($msg.action -eq "ping") { Responder @{ ok = $true; helper = "1" }; exit 0 }
  if ($msg.action -eq "update") {
    $pkg = [string]$msg.package
    if ($pkg -notmatch '^(qa|dev|scrum|design)$') { throw "Pacote inválido." }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $code = Invoke-RestMethod -Uri ("__SCRIPT_URL__?t=" + [DateTimeOffset]::Now.ToUnixTimeSeconds()) -UseBasicParsing
    $env:QF_AJUDANTE = "0"; $env:QF_EXT_ID = ""
    & ([scriptblock]::Create($code)) -Pacotes $pkg -Silencioso *> $log
    Responder @{ ok = $true }
    exit 0
  }
  Responder @{ ok = $false; error = "Ação desconhecida." }
} catch {
  Responder @{ ok = $false; error = $_.Exception.Message }
}
'@
  Set-Content -Path (Join-Path $HostDir "host.ps1") -Value $hostPs1.Replace("__SCRIPT_URL__", $ScriptUrl) -Encoding UTF8
  Set-Content -Path (Join-Path $HostDir "host.bat") -Value "@echo off`r`npowershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"%~dp0host.ps1`"" -Encoding ASCII
  $manifest = [ordered]@{ name = $HostName; description = "Atualizador do QuickFill"; path = (Join-Path $HostDir "host.bat"); type = "stdio";
    allowed_origins = @($ids | ForEach-Object { "chrome-extension://$_/" }) }
  $manifestPath = Join-Path $HostDir "$HostName.json"
  ($manifest | ConvertTo-Json) | Set-Content -Path $manifestPath -Encoding ASCII
  foreach ($k in @("HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName", "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName")) {
    New-Item -Path $k -Force | Out-Null
    Set-ItemProperty -Path $k -Name "(default)" -Value $manifestPath
  }
  $ajudante = $true
}
} # Fim da ativação opcional. Atualizações comuns não criam nem alteram .ajudante ou o Registro.

if ($Silencioso) { return }

Write-Host ""
if ($novos.Count) {
  # Primeira instalação: abre a pasta e copia o caminho para colar no "Carregar sem compactação"
  Write-Host "PRIMEIRA INSTALAÇÃO — falta só carregar no Chrome:" -ForegroundColor Yellow
  Write-Host "  1. Abra chrome://extensions e ligue o 'Modo do desenvolvedor' (canto superior direito)"
  Write-Host "  2. Clique em 'Carregar sem compactação' e escolha a pasta:"
  foreach ($n in $novos) { Write-Host "       $n" -ForegroundColor Green }
  Write-Host "     (o caminho já foi copiado — cole com Ctrl+V na barra de endereço da janela de escolha)"
  Write-Host "  3. Nas Opções da extensão, preencha URL do Jira, e-mail e token do Jira"
  Write-Host "  4. Opcional: nas Opções, ative o Ajudante para atualizar com um clique"
  try { Set-Clipboard -Value $novos[0] } catch { }
  try { Start-Process explorer.exe $Destino } catch { }
} else {
  Write-Host "Atualizado! No Chrome, abra o QuickFill e clique em 'Recarregar extensão' no aviso do topo." -ForegroundColor Green
  Write-Host "(ou em chrome://extensions clique no botão de recarregar do QuickFill)"
}
if ($ajudante) { Write-Host ""; Write-Host "Botão 'Atualizar agora' ativado: nas próximas versões é só clicar nele no QuickFill." -ForegroundColor Cyan }
Write-Host ""
Read-Host "Tecle Enter para fechar" | Out-Null
