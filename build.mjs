/**
 * Gera as extensões do QuickFill a partir de um código só.
 *
 *   src/                         código compartilhado (é aqui que se edita)
 *   profiles/<perfil>/           o que é de cada extensão:
 *     profile.json               versão, nome, descrição, atalho e permissões extras
 *     CHANGELOG.md               o que mudou em cada versão daquele perfil
 *     README.md                  manual que vai dentro do pacote
 *     files/                     (opcional) arquivos que substituem os de src/ só naquele perfil
 *   jira-quickfill-<perfil>/     saída do build (não vai para o git): carregue no Chrome para testar
 *   dist/<pasta>.zip             pacote publicado de cada perfil (só muda quando aquele perfil é lançado)
 *
 *   node build.mjs               gera as 4 pastas para testar
 *   npm run status               mostra a versão de cada perfil e se ele tem mudança não lançada
 *   npm run release -- dev -m "o que mudou"    lança só o DEV (veja tools/release.mjs)
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { renderIcon, ICON_SIZES } from "./tools/icons.mjs";

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const SRC = join(ROOT, "src");
const PROFILES_DIR = join(ROOT, "profiles");
export const ORDER = ["qa", "dev", "scrum", "design"];

/* ---------- perfis ---------- */

export function readProfiles() {
  return Object.fromEntries(ORDER.map((role) => {
    const file = join(PROFILES_DIR, role, "profile.json");
    return [role, { role, file, ...JSON.parse(readFileSync(file, "utf8")) }];
  }));
}

export function saveProfile(p) {
  const { role, file, ...data } = p;
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

/* ---------- repositório e aviso de versão ---------- */

const RELEASE_FILE = join(ROOT, "release.config.json");
const RELEASE = existsSync(RELEASE_FILE) ? JSON.parse(readFileSync(RELEASE_FILE, "utf8")) : { repo: "", branch: "main" };
const GH = String(RELEASE.repo || "").match(/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/);
const BRANCH = RELEASE.branch || "main";
const PRIVATE = RELEASE.private !== false;
const ghFile = (path) => (PRIVATE
  ? `https://api.github.com/repos/${GH[1]}/${GH[2]}/contents/${path}?ref=${BRANCH}`
  : `https://raw.githubusercontent.com/${GH[1]}/${GH[2]}/${BRANCH}/${path}`);
export const UPDATE_URL = RELEASE.updateUrl || (GH ? ghFile("update.json") : "");
const SCRIPT_URL = GH && !PRIVATE ? ghFile("dist/quickfill.ps1") : "";
const INSTALL_CMD = SCRIPT_URL ? `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm ${SCRIPT_URL} | iex"` : "";
const downloadOf = (folder) => (RELEASE.downloadBase ? `${RELEASE.downloadBase.replace(/\/+$/, "")}/${folder}.zip`
  : GH ? ghFile(`dist/${folder}.zip`) : "");

/* ---------- arquivos de cada pacote ---------- */

function listFiles(dir, base = "") {
  if (!existsSync(join(dir, base))) return [];
  const out = [];
  for (const e of readdirSync(join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, rel));
    else out.push(rel);
  }
  return out.sort();
}

function roleJs(p) {
  return `/**
 * Perfil do pacote: ${p.title} ${p.version}.
 * Gerado pelo build.mjs a partir de profiles/${p.role}/profile.json — não edite à mão.
 */
export const ROLE = "${p.role}";
/** update.json do repositório da equipe (aviso de nova versão). Vazio = sem aviso. */
export const UPDATE_URL = "${UPDATE_URL}";
/** Comando de instalação/atualização (Win+R). Com QF_EXT_ID também ativa o botão "Atualizar agora". */
export const INSTALL_CMD = ${JSON.stringify(INSTALL_CMD)};
`;
}

function manifestJson(p) {
  const src = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
  const icons = Object.fromEntries(ICON_SIZES.map((n) => [String(n), `icons/icon${n}.png`]));
  const hosts = (src.host_permissions || []).filter((h) => !h.includes("github.com"));
  const { manifest_version, name, version, description, ...rest } = src;   // nome, versão e descrição vêm do perfil
  return JSON.stringify({
    manifest_version,
    name: p.name,
    version: p.version,
    description: p.description,
    ...rest,
    host_permissions: [...hosts, "https://api.github.com/*", ...(p.extraHosts || [])],
    icons,
    action: { ...src.action, default_title: p.title, default_icon: icons },
    commands: { "open-quickfill": { suggested_key: { default: `Ctrl+Shift+${p.shortcut}`, mac: `Command+Shift+${p.shortcut}` }, description: p.shortcutHint } },
  }, null, 2) + "\n";
}

function contentJs(p) {
  let s = readFileSync(join(SRC, "content.js"), "utf8");
  if (p.role === "qa") return s;
  const swap = (a, b) => { if (!s.includes(a)) throw new Error(`content.js: trecho não encontrado: ${a}`); s = s.split(a).join(b); };
  swap(`const HOST_ID = "jira-quickfill-host";`, `const HOST_ID = "jira-quickfill-${p.role}-host";`);
  swap(`frame.className = "jqf-frame";`, `frame.className = "jqf-frame jqf-frame-${p.role}";`);
  return s;
}

/** Arquivos gerados por perfil (o resto vem de src/ e de profiles/<perfil>/files/). */
function generated(p) {
  return {
    "lib/role.js": roleJs(p),
    "manifest.json": manifestJson(p),
    "content.js": contentJs(p),
    "README.md": readFileSync(join(PROFILES_DIR, p.role, "README.md"), "utf8"),
    "CHANGELOG.md": readFileSync(join(PROFILES_DIR, p.role, "CHANGELOG.md"), "utf8"),
    ...Object.fromEntries(ICON_SIZES.map((n) => [`icons/icon${n}.png`, renderIcon(p.role, n)])),
  };
}

/** Gera a pasta de um perfil do zero (arquivos apagados em src/ somem do pacote também). */
export function buildProfile(p) {
  const out = join(ROOT, p.folder);
  rmSync(out, { recursive: true, force: true });
  const write = (rel, data) => { mkdirSync(dirname(join(out, rel)), { recursive: true }); writeFileSync(join(out, rel), data); };
  for (const f of listFiles(SRC)) {
    mkdirSync(dirname(join(out, f)), { recursive: true });
    copyFileSync(join(SRC, f), join(out, f));
  }
  const own = join(PROFILES_DIR, p.role, "files");
  for (const f of listFiles(own)) { mkdirSync(dirname(join(out, f)), { recursive: true }); copyFileSync(join(own, f), join(out, f)); }
  for (const [rel, data] of Object.entries(generated(p))) write(rel, data);
  return out;
}

/**
 * Impressão digital do pacote, sem contar o número da versão nem o histórico de versões:
 * se mudar, o perfil tem alteração ainda não lançada.
 */
export function packageHash(p, dir = join(ROOT, p.folder)) {
  const h = createHash("sha256");
  for (const f of listFiles(dir)) {
    if (f === "CHANGELOG.md") continue;
    let data = readFileSync(join(dir, f));
    if (/\.(js|css|html|json|md)$/.test(f)) data = Buffer.from(String(data).replace(/\r\n/g, "\n"));
    if (f === "manifest.json") data = Buffer.from(String(data).replace(/"version": "[^"]*",?\n/, ""));
    if (f === "lib/role.js") data = Buffer.from(String(data).split("\n").filter((l) => l.startsWith("export ")).join("\n"));
    h.update(f).update("\0").update(data).update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

export function zipProfile(p) {
  mkdirSync(join(ROOT, "dist"), { recursive: true });
  const zip = join(ROOT, "dist", `${p.folder}.zip`);
  execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${join(ROOT, p.folder)}' -DestinationPath '${zip}' -Force`], { stdio: "ignore" });
  return zip;
}

/* ---------- update.json (o que está publicado de cada perfil) ---------- */

const UPDATE_FILE = join(ROOT, "update.json");
export const readUpdate = () => (existsSync(UPDATE_FILE) ? JSON.parse(readFileSync(UPDATE_FILE, "utf8")) : { packages: {} });

const semver = (v) => String(v).split(".").map(Number);
export const cmpVersion = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

/** Grava o update.json: `released` traz { role: { version, date, notes, hash } } dos perfis lançados agora. */
export function writeUpdate(profiles, released = {}) {
  const prev = readUpdate();
  const packages = {};
  for (const role of ORDER) {
    const p = profiles[role], old = prev.packages?.[role] || {};
    packages[role] = { version: old.version || p.version, folder: p.folder, download: downloadOf(p.folder),
      date: old.date || prev.date || "", notes: old.notes ?? prev.notes ?? "", hash: old.hash || "", ...(released[role] || {}) };
  }
  const latest = Object.values(packages).reduce((a, b) => (cmpVersion(b.version, a.version) > 0 ? b : a));
  const last = Object.values(released)[0] || { date: prev.date || "", notes: prev.notes || "" };
  const update = {
    // versão e notas do topo: só para extensões antigas, que ainda não leem por perfil
    version: latest.version,
    private: PRIVATE,
    repo: RELEASE.repo || "",
    installCommand: INSTALL_CMD,
    guide: RELEASE.repo ? `${RELEASE.repo.replace(/\/+$/, "")}#readme` : "",
    date: last.date,
    notes: last.notes,
    packages,
  };
  writeFileSync(UPDATE_FILE, JSON.stringify(update, null, 2) + "\n");
  return update;
}

/** Instalador da equipe (.bat) em dist/. */
export function writeInstaller() {
  mkdirSync(join(ROOT, "dist"), { recursive: true });
  const ps1 = readFileSync(join(ROOT, "tools", "atualizar-quickfill.ps1"), "utf8")
    .replace("__UPDATE_URL__", UPDATE_URL || "__UPDATE_URL__").replaceAll("__SCRIPT_URL__", SCRIPT_URL || "__SCRIPT_URL__");
  if (INSTALL_CMD) {
    // repositório público: o comando do README baixa dist/quickfill.ps1
    writeFileSync(join(ROOT, "dist", "quickfill.ps1"), ps1.replace(/\r?\n/g, "\r\n"));
    writeFileSync(join(ROOT, "dist", "atualizar-quickfill.bat"), `@echo off\r\ntitle QuickFill - instalar / atualizar\r\n${INSTALL_CMD}\r\n`);
    try { rmSync(join(ROOT, "dist", "atualizar-quickfill.ps1")); } catch { /* já não existe */ }
    return;
  }
  writeFileSync(join(ROOT, "dist", "atualizar-quickfill.ps1"), "\ufeff" + ps1);
  writeFileSync(join(ROOT, "dist", "atualizar-quickfill.bat"), "@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0atualizar-quickfill.ps1\" %*\r\n");
}

/* ---------- linha de comando: node build.mjs ---------- */

if (process.argv[1]?.endsWith("build.mjs")) {
  const profiles = readProfiles();
  for (const role of ORDER) {
    const p = profiles[role];
    buildProfile(p);
    console.log(`✓ ${p.folder.padEnd(22)} ${role.toUpperCase().padEnd(6)} ${p.version}`);
  }
  console.log("Pastas prontas para testar no Chrome. Para publicar: npm run status / npm run release");
}
