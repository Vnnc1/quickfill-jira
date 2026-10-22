import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseChangelog, powershellCommand, releaseEntries } from "../src/lib/changelog.js";
import { buildChanges } from "../tools/changelog.mjs";

const base = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://example.com/quickfill.ps1 | iex"';
const extensionId = "a".repeat(32);
const decodeCommand = (command) => Buffer.from(command.split(" -EncodedCommand ")[1], "base64").toString("utf16le");

test("histórico preserva versões, datas e notas com acentos", () => {
  assert.deepEqual(parseChangelog("# Histórico\n\n## 4.9.1 (2026-10-22)\n\n- Correção de horários\n- Ajudante opcional\n\n## 4.8.9 (2026-10-21)\n\n- Filtro"), [
    { version: "4.9.1", date: "2026-10-22", changes: ["Correção de horários", "Ajudante opcional"] },
    { version: "4.8.9", date: "2026-10-21", changes: ["Filtro"] },
  ]);
});

test("comando padrão desativa a ativação implícita e limita a atualização ao perfil", () => {
  const command = decodeCommand(powershellCommand(base, { role: "dev", extensionId }));
  assert.ok(command.includes("$env:QF_AJUDANTE='0'"));
  assert.ok(command.includes("$env:QF_EXT_ID=''"));
  assert.ok(command.includes("$env:QF_PACOTES='dev'"));
  assert.ok(!command.includes(extensionId));
  assert.ok(decodeCommand(powershellCommand(base, { role: "dev", extensionId, helper: true })).includes(`$env:QF_EXT_ID='${extensionId}'`));
  assert.equal(powershellCommand(base, { helper: true, extensionId: "invalido" }), "");
  assert.equal(powershellCommand(base, { role: "dev'; irm evil" }), "");
});

test("comando copiado executa no PowerShell sem expandir variáveis no processo externo", { skip: process.platform !== "win32" }, () => {
  const printState = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Output ('STATE:' + $env:QF_AJUDANTE + ':' + $env:QF_PACOTES + ':' + $env:QF_EXT_ID)"`;
  for (const helper of [false, true]) {
    const command = powershellCommand(printState, { role: "dev", extensionId, helper });
    const expected = `STATE:${helper ? "1" : "0"}:dev:${helper ? extensionId : ""}`;
    const output = execFileSync("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8", timeout: 15000, stdio: "pipe",
      env: { ...process.env, QF_AJUDANTE: "old", QF_EXT_ID: "old", QF_PACOTES: "old" } });
    assert.ok(output.includes(expected), output);
    const args = command.split(" ");
    const direct = execFileSync(args.shift(), args, { encoding: "utf8", timeout: 15000, stdio: "pipe" });
    assert.ok(direct.includes(expected), direct);
  }
});

test("histórico remoto por perfil inclui versões puladas e aceita servidores antigos", () => {
  const local = [{ version: "4.8.5", changes: ["Instalada"] }];
  const update = { latest: "4.10.0", notes: "- Corrige o filtro; Melhora a busca", date: "2026-10-22" };
  assert.deepEqual(releaseEntries(update, local).map((entry) => entry.version), ["4.10.0", "4.8.5"]);
  assert.deepEqual(releaseEntries(update, local)[0].changes, ["Corrige o filtro", "Melhora a busca"]);
  update.changelog = [{ version: "4.10.0", changes: ["Nota completa"] }, { version: "4.9.0", changes: ["Intermediária"] }];
  assert.equal(releaseEntries(update, local).length, 3);
  assert.deepEqual(releaseEntries(update, local)[0].changes, ["Nota completa"]);
});

test("relatório de build detecta alterações commitadas, locais, removidas e arquivos novos", () => {
  const root = mkdtempSync(join(tmpdir(), "qf-changelog-test-"));
  try {
    const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    mkdirSync(join(root, "src")); mkdirSync(join(root, "profiles", "qa"), { recursive: true });
    git("init"); git("config", "user.name", "QuickFill Test"); git("config", "user.email", "test@example.com");
    writeFileSync(join(root, "src", "modal.js"), "original");
    writeFileSync(join(root, "src", "removed.js"), "original");
    writeFileSync(join(root, "profiles", "qa", "CHANGELOG.md"), "## 1.0.0 (2026-10-22)\n- Original");
    git("add", "."); git("commit", "-m", "Publicação");
    writeFileSync(join(root, "src", "modal.js"), "commitado"); git("add", "."); git("commit", "-m", "Corrige modal");
    rmSync(join(root, "src", "removed.js")); writeFileSync(join(root, "src", "novo.js"), "novo");
    const report = buildChanges(root, "qa", "Correção no modal; Atualização opcional");
    assert.deepEqual(report.files, ["src/modal.js", "src/novo.js", "src/removed.js"]);
    assert.deepEqual(report.changes, ["Correção no modal", "Atualização opcional"]);
    assert.equal(buildChanges(root, "qa").sourceHash, report.sourceHash);
    assert.deepEqual(buildChanges(root, "qa").changes, ["Corrige modal"]);
    writeFileSync(join(root, "src", "novo.js"), "modificado");
    assert.notEqual(buildChanges(root, "qa").sourceHash, report.sourceHash);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("release empacota histórico e notas só do perfil lançado, sem publicar builds locais", { skip: process.platform !== "win32" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "qf-release-test-"));
  try {
    for (const file of ["build.mjs", "package.json", "release.config.json", "update.json", "src", "tools", "profiles"]) {
      cpSync(new URL(`../${file}`, import.meta.url), join(root, file), { recursive: true });
    }
    const before = JSON.parse(readFileSync(join(root, "update.json"), "utf8"));
    const notes = "Modal de novidades; Ajudante opcional";
    execFileSync(process.execPath, ["tools/release.mjs", "release", "qa", "--skip-tests", "-m", notes], { cwd: root, stdio: "pipe", timeout: 30000 });
    const after = JSON.parse(readFileSync(join(root, "update.json"), "utf8"));
    assert.equal(after.packages.qa.notes, notes);
    assert.deepEqual(after.packages.dev, before.packages.dev);
    assert.deepEqual(after.packages.design, before.packages.design);
    const readData = () => JSON.parse(readFileSync(join(root, "jira-quickfill-qa", "lib", "changelog-data.js"), "utf8").split("export const CHANGELOG = ")[1].trim().replace(/;$/, ""));
    const data = readData();
    assert.deepEqual(data.releases, after.packages.qa.changelog);
    assert.deepEqual(data.releases[0].changes, ["Modal de novidades", "Ajudante opcional"]);
    assert.deepEqual(data.build.files, []);
    assert.deepEqual(data.build.changes, []);
    const build = await import(pathToFileURL(join(root, "build.mjs")));
    const profile = build.readProfiles().qa;
    const hash = build.packageHash(profile);
    build.buildProfile(profile, { released: true });
    assert.equal(readData().build.id, data.build.id, "o mesmo conteúdo não reabre o modal");
    build.buildProfile(profile);
    assert.equal(readData().build.id, data.build.id, "rebuild sem mudanças mantém a identidade do release");
    build.buildProfile(profile, { notes: "Notas do build local" });
    assert.deepEqual(readData().build.changes, ["Notas do build local"]);
    assert.equal(build.packageHash(profile), hash, "metadados não tornam o perfil falsamente alterado");
    assert.equal(JSON.parse(readFileSync(join(root, "update.json"), "utf8")).packages.qa.notes, notes);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("instalador só registra Ajudante com opção explícita, inclusive quando há IDs antigos", { skip: process.platform !== "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "qf-installer-test-"));
  try {
    const source = readFileSync(new URL("../tools/atualizar-quickfill.ps1", import.meta.url), "utf8")
      .replaceAll("__UPDATE_URL__", "https://example.com/update.json").replaceAll("__SCRIPT_URL__", "https://example.com/quickfill.ps1")
      .replace('[Environment]::GetFolderPath("MyDocuments")', "$env:QF_TEST_ROOT");
    writeFileSync(join(root, "installer.ps1"), "\ufeff" + source);
    const harness = String.raw`
$ErrorActionPreference = 'Stop'
$global:QFRegistryWrites = 0
function Invoke-RestMethod { return [pscustomobject]@{ packages = [pscustomobject]@{ qa = [pscustomobject]@{ folder = 'jira-quickfill-qa'; version = '1.0.0'; download = 'https://example.com/qa.zip' } } } }
function Invoke-WebRequest { param($Uri, $OutFile, $Headers, [switch]$UseBasicParsing); Copy-Item -LiteralPath $env:QF_TEST_ZIP -Destination $OutFile }
function New-Item {
  [CmdletBinding(SupportsShouldProcess=$true)]
  param($Path, [Alias('Type')]$ItemType, [switch]$Force)
  if ($Path -like 'HKCU:*') { $global:QFRegistryWrites++; return }
  Microsoft.PowerShell.Management\New-Item @PSBoundParameters
}
function Set-ItemProperty { param($Path, $Name, $Value); if ($Path -notlike 'HKCU:*') { throw 'Registro inesperado' }; $global:QFRegistryWrites++ }
function Read-Host { throw 'Prompt inesperado' }
function Start-Process { throw 'Processo inesperado' }
function Verify($condition, $message) { if (-not $condition) { throw $message } }
$env:TEMP = Join-Path $PSScriptRoot 'temp'
New-Item -Path $env:TEMP -ItemType Directory -Force | Out-Null
$env:QF_TEST_ROOT = Join-Path $PSScriptRoot 'documents'
$env:QF_TEST_ZIP = Join-Path $PSScriptRoot 'qa.zip'
$payload = Join-Path $PSScriptRoot 'payload/jira-quickfill-qa'
New-Item -Path $payload -ItemType Directory -Force | Out-Null
'{"version":"1.0.0"}' | Set-Content (Join-Path $payload 'manifest.json')
'corrigido' | Set-Content (Join-Path $payload 'modal.js')
Compress-Archive -Path $payload -DestinationPath $env:QF_TEST_ZIP
$env:QF_PACOTES = ''; $env:QF_AJUDANTE = '0'; $env:QF_EXT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
& "$PSScriptRoot/installer.ps1" -Pacotes qa -Silencioso
$helper = Join-Path $env:QF_TEST_ROOT 'QuickFill/.ajudante'
Verify (-not (Test-Path $helper)) 'Instalacao comum criou Ajudante'
Verify ($global:QFRegistryWrites -eq 0) 'Instalacao comum alterou Registro'
Verify ((Get-Content (Join-Path $env:QF_TEST_ROOT 'QuickFill/jira-quickfill-qa/modal.js')) -eq 'corrigido') 'Nao instalou a correcao'
# Um ajudante legado nunca deve ser regravado pela atualizacao normal.
New-Item -Path $helper -ItemType Directory -Force | Out-Null
'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' | Set-Content (Join-Path $helper 'ids.txt')
'preservar' | Set-Content (Join-Path $helper 'host.ps1')
& "$PSScriptRoot/installer.ps1" -Pacotes qa -Silencioso
Verify ((Get-Content (Join-Path $helper 'host.ps1')) -eq 'preservar') 'Atualizacao regravou ajudante legado'
Verify ($global:QFRegistryWrites -eq 0) 'IDs antigos ativaram Registro'
# Somente a acao explicita grava ajudante e Registro.
& "$PSScriptRoot/installer.ps1" -AtivarAjudante -ExtId 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' -Silencioso
Verify ($global:QFRegistryWrites -eq 4) 'Ativacao explicita nao registrou Chrome e Edge'
Verify (Test-Path (Join-Path $helper 'host.bat')) 'Ativacao nao criou host'
$manifest = Get-Content (Join-Path $helper 'com.quickfill.updater.json') -Raw | ConvertFrom-Json
Verify ($manifest.allowed_origins.Count -eq 2) 'Ativacao perdeu ID antigo'
Write-Output 'INSTALLER_OK'
`;
    writeFileSync(join(root, "verify.ps1"), "\ufeff" + harness);
    const output = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "verify.ps1")], { encoding: "utf8", timeout: 30000 });
    assert.ok(output.includes("INSTALLER_OK"), output);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
