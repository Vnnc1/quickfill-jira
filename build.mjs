/**
 * Gera os pacotes do QuickFill a partir de um código só.
 *
 *   node build.mjs            → atualiza as pastas DEV, SCRUM e DESIGN a partir da pasta QA
 *   node build.mjs --zip      → idem, e gera também os .zip para distribuir
 *
 * A pasta jira-quickfill-qa é a fonte: edite lá e rode o build. Os arquivos que mudam
 * por perfil (lib/role.js, manifest.json, content.js, content.css) são gerados aqui;
 * o README de cada pacote é mantido à mão.
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { renderIcon, ICON_SIZES } from "./tools/icons.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "jira-quickfill-qa");
const VERSION = "4.5.1";

const ROLES = {
  qa: {
    dir: "jira-quickfill-qa",
    name: "Jira QuickFill QA",
    title: "Jira QuickFill QA",
    description: "QA: preenche datas, estimativa, apontamento e status de subtarefas (Testes Manuais), em uma tarefa ou em lote, com painel, equipe e meu dia.",
    key: "J", hint: "Abrir o modal do Jira QuickFill na aba atual",
    launcher: { text: "⏱", bottom: 18, color: "#579dff" }, frame: [520, 700],
  },
  dev: {
    dir: "jira-quickfill-dev",
    name: "Jira QuickFill DEV — Meu progresso",
    title: "Jira QuickFill DEV",
    description: "DEV: seu dia e seu progresso no Jira — meta do dia, sequência, histórico, suas demandas (com o QA, voltaram, entregues) e a equipe.",
    key: "Y", hint: "Abrir o QuickFill DEV na aba atual",
    launcher: { text: "DEV", bottom: 66, color: "#4bce97" }, frame: [600, 760],
  },
  scrum: {
    dir: "jira-quickfill-scrum",
    name: "Jira QuickFill SCRUM — Sprint e equipe",
    title: "Jira QuickFill SCRUM",
    description: "SCRUM: saúde da sprint (burndown, previsão, velocidade), quem está com o quê, riscos (impedidas, paradas, fila do QA) e a equipe ao vivo.",
    key: "K", hint: "Abrir o QuickFill SCRUM na aba atual",
    launcher: { text: "SM", bottom: 114, color: "#f5cd47" }, frame: [600, 760],
  },
  design: {
    dir: "jira-quickfill-design",
    name: "Jira QuickFill DESIGN — HUs e metas",
    title: "Jira QuickFill DESIGN",
    description: "DESIGN: suas HUs por etapa (fila, em design, revisão, com o dev), quem está aguardando design, meta semanal de entregas, seu dia e a equipe.",
    key: "E", hint: "Abrir o QuickFill DESIGN na aba atual",
    launcher: { text: "UX", bottom: 162, color: "#e774bb" }, frame: [600, 760],
  },
};


const RELEASE_FILE = join(ROOT, "release.config.json");
if (!existsSync(RELEASE_FILE)) writeFileSync(RELEASE_FILE, JSON.stringify({ repo: "", branch: "main", notes: "" }, null, 2) + "\n");
const RELEASE = JSON.parse(readFileSync(RELEASE_FILE, "utf8"));
const GH = String(RELEASE.repo || "").match(/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/);
const BRANCH = RELEASE.branch || "main";

const PRIVATE = RELEASE.private !== false;
const ghFile = (path) => (PRIVATE
  ? `https://api.github.com/repos/${GH[1]}/${GH[2]}/contents/${path}?ref=${BRANCH}`
  : `https://raw.githubusercontent.com/${GH[1]}/${GH[2]}/${BRANCH}/${path}`);
const UPDATE_URL = RELEASE.updateUrl || (GH ? ghFile("update.json") : "");

const SCRIPT_URL = GH && !PRIVATE ? ghFile("dist/quickfill.ps1") : "";
const INSTALL_CMD = SCRIPT_URL ? `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm ${SCRIPT_URL} | iex"` : "";
const downloadOf = (dir) => (RELEASE.downloadBase ? `${RELEASE.downloadBase.replace(/\/+$/, "")}/${dir}.zip`
  : GH ? ghFile(`dist/${dir}.zip`) : "");

const PER_ROLE = new Set(["lib/role.js", "manifest.json", "content.js", "content.css", "README.md", ...ICON_SIZES.map((n) => `icons/icon${n}.png`)]);

function listFiles(dir, base = "") {
  const out = [];
  for (const e of readdirSync(join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, rel));
    else out.push(rel);
  }
  return out;
}

function roleJs(role) {
  return `/**
 * Perfil do pacote. O mesmo código gera quatro extensões:
 *   "qa"     — Jira QuickFill QA     (o modelo completo: Tarefa, Lote, Painel, Equipe, Meu dia)
 *   "dev"    — Jira QuickFill DEV    (meu progresso: Hoje, Progresso, Demandas, Equipe)
 *   "scrum"  — Jira QuickFill SCRUM  (Sprint, Pessoas, Riscos, Equipe)
 *   "design" — Jira QuickFill DESIGN (Hoje, HUs, Progresso, Equipe)
 * Gerado pelo build.mjs — não edite à mão.
 */
export const ROLE = "${role}";
/** update.json do repositório da equipe (aviso de nova versão). Vazio = sem aviso. */
export const UPDATE_URL = "${UPDATE_URL}";
/** Comando de instalação/atualização (Win+R). Com QF_EXT_ID também ativa o botão "Atualizar agora". */
export const INSTALL_CMD = ${JSON.stringify(INSTALL_CMD)};
`;
}

function manifest(role, r) {
  const src = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
  const icons = Object.fromEntries(ICON_SIZES.map((n) => [String(n), `icons/icon${n}.png`]));

  const hosts = (src.host_permissions || []).filter((h) => !h.includes("figma.com"));
  return JSON.stringify({
    ...src,

    host_permissions: [...hosts.filter((h) => !h.includes("github.com")), "https://api.github.com/*", ...(role === "design" ? ["https://api.figma.com/*"] : [])],
    icons,
    name: r.name,
    version: VERSION,
    description: r.description,
    action: { ...src.action, default_title: r.title, default_icon: icons },
    commands: { "open-quickfill": { suggested_key: { default: `Ctrl+Shift+${r.key}`, mac: `Command+Shift+${r.key}` }, description: r.hint } },
  }, null, 2) + "\n";
}

function contentJs(role, r) {
  let s = readFileSync(join(SRC, "content.js"), "utf8");
  const suffix = role === "qa" ? "" : `-${role}`;
  const swap = (a, b) => { if (!s.includes(a)) throw new Error(`content.js: trecho não encontrado: ${a}`); s = s.split(a).join(b); };
  swap(`const HOST_ID = "jira-quickfill-host";`, `const HOST_ID = "jira-quickfill${suffix}-host";`);
  swap(`frame.className = "jqf-frame";`, `frame.className = "jqf-frame jqf-frame-${role}";`);
  swap(`"jqf-launcher")) return;`, `"jqf-launcher${suffix}")) return;`);
  swap(`btn.id = "jqf-launcher";`, `btn.id = "jqf-launcher${suffix}";`);
  swap(`btn.className = "jqf-launcher";`, `btn.className = "jqf-launcher jqf-${role}";`);
  swap(`btn.title = "Jira QuickFill QA (Ctrl+Shift+J)";`, `btn.title = "${r.title} (Ctrl+Shift+${r.key})";`);
  swap(`btn.textContent = "⏱";`, `btn.textContent = "${r.launcher.text}";`);
  return s;
}

function contentCss(role, r) {
  const base = readFileSync(join(SRC, "content.css"), "utf8").replace(/\n\/\* QuickFill [\s\S]*$/, "\n");
  if (role === "qa") return base;
  return `${base.trimEnd()}

/* QuickFill ${role.toUpperCase()}: botão empilhado acima dos outros perfis */
.jqf-launcher.jqf-${role} { bottom: ${r.launcher.bottom}px; font-size: 10px; font-weight: 800; letter-spacing: .02em; color: ${r.launcher.color}; }
`;
}

const shared = listFiles(SRC).filter((f) => !PER_ROLE.has(f));

const qaContent = { js: readFileSync(join(SRC, "content.js"), "utf8"), css: readFileSync(join(SRC, "content.css"), "utf8") };

for (const [role, r] of Object.entries(ROLES)) {
  const out = join(ROOT, r.dir);
  mkdirSync(join(out, "lib"), { recursive: true });
  if (role !== "qa") {
    for (const f of shared) {
      mkdirSync(dirname(join(out, f)), { recursive: true });
      copyFileSync(join(SRC, f), join(out, f));
    }
    writeFileSync(join(out, "content.js"), contentJs(role, r));
    writeFileSync(join(out, "content.css"), contentCss(role, r));
  } else {
    writeFileSync(join(out, "content.js"), qaContent.js);
    writeFileSync(join(out, "content.css"), qaContent.css);
  }
  writeFileSync(join(out, "lib/role.js"), roleJs(role));
  writeFileSync(join(out, "manifest.json"), manifest(role, r));
  mkdirSync(join(out, "icons"), { recursive: true });
  for (const n of ICON_SIZES) writeFileSync(join(out, `icons/icon${n}.png`), renderIcon(role, n));
  if (!existsSync(join(out, "README.md"))) writeFileSync(join(out, "README.md"), `# ${r.title}\n`);
  console.log(`✓ ${r.dir} (${role})`);

  if (process.argv.includes("--zip")) {
    mkdirSync(join(ROOT, "dist"), { recursive: true });
    const zip = join(ROOT, "dist", `${r.dir}.zip`);
    try {
      execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${out}' -DestinationPath '${zip}' -Force`], { stdio: "ignore" });
      console.log(`  zip: ${zip}`);
    } catch { console.log("  (não foi possível gerar o .zip — compacte a pasta manualmente)"); }
  }
}

/* ---------- update.json e instalador da equipe ---------- */
const update = {
  version: VERSION,
  private: PRIVATE,
  repo: RELEASE.repo || "",
  installCommand: INSTALL_CMD,
  guide: RELEASE.repo ? `${RELEASE.repo.replace(/\/+$/, "")}#readme` : "",
  date: new Date().toISOString().slice(0, 10),
  notes: RELEASE.notes || "",
  packages: Object.fromEntries(Object.entries(ROLES).map(([role, r]) => [role, { version: VERSION, folder: r.dir, download: downloadOf(r.dir) }])),
};
writeFileSync(join(ROOT, "update.json"), JSON.stringify(update, null, 2) + "\n");
mkdirSync(join(ROOT, "dist"), { recursive: true });
const ps1 = readFileSync(join(ROOT, "tools", "atualizar-quickfill.ps1"), "utf8").replace("__UPDATE_URL__", UPDATE_URL || "__UPDATE_URL__").replaceAll("__SCRIPT_URL__", SCRIPT_URL || "__SCRIPT_URL__");
if (INSTALL_CMD) {
  
  writeFileSync(join(ROOT, "dist", "atualizar-quickfill.bat"), `@echo off\r\ntitle QuickFill - instalar / atualizar\r\n${INSTALL_CMD}\r\n`);
  for (const old of ["atualizar-quickfill.ps1"]) { try { rmSync(join(ROOT, "dist", old)); } catch { /* já não existe */ } }
} else {
  writeFileSync(join(ROOT, "dist", "atualizar-quickfill.ps1"), "\ufeff" + ps1);
  writeFileSync(join(ROOT, "dist", "atualizar-quickfill.bat"),
    "@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0atualizar-quickfill.ps1\" %*\r\n");
}
console.log(UPDATE_URL ? `✓ update.json (${VERSION}) · aviso lido de ${UPDATE_URL}` : "✓ update.json gerado — preencha \"repo\" em release.config.json para ligar o aviso de versão");
