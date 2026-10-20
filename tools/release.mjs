/**
 * Versões por perfil: cada extensão (QA, DEV, SCRUM, DESIGN) tem a sua.
 *
 *   npm run status                                   versão de cada perfil e se tem mudança não lançada
 *   npm run release -- dev -m "o que mudou"          lança só o DEV (4.8.2 → 4.8.3)
 *   npm run release -- dev,scrum -m "..."            lança DEV e SCRUM, cada um a partir da sua versão
 *   npm run release -- todos --minor -m "..."        os 4, subindo o número do meio (4.8.2 → 4.9.0)
 *   npm run release -- qa --major -m "..."           5.0.0
 *   npm run release -- qa --dry -m "..."             mostra o que faria, sem gravar nada
 *
 * O release roda os testes, sobe a versão em profiles/<perfil>/profile.json, escreve a entrada no
 * profiles/<perfil>/CHANGELOG.md, gera o .zip só dos perfis lançados e atualiza o update.json só
 * para eles. Os outros perfis continuam com a versão e o .zip que já estavam publicados.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT, ORDER, readProfiles, saveProfile, buildProfile, packageHash, zipProfile, readUpdate, writeUpdate, writeInstaller } from "../build.mjs";

const args = process.argv.slice(2);
const cmd = args.shift();
const today = new Date().toISOString().slice(0, 10);

function bump(v, kind) {
  const [a, b, c] = String(v).split(".").map(Number);
  return kind === "major" ? `${a + 1}.0.0` : kind === "minor" ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}

/** Impressão digital do que está publicado (o .zip de dist/), para comparar com o código atual. */
function publishedHash(p) {
  const zip = join(ROOT, "dist", `${p.folder}.zip`);
  if (!existsSync(zip)) return "";
  const tmp = mkdtempSync(join(tmpdir(), "qf-pub-"));
  try {
    execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Path '${zip}' -DestinationPath '${tmp}' -Force`], { stdio: "ignore" });
    return packageHash(p, join(tmp, p.folder));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

function status() {
  const profiles = readProfiles(), pub = readUpdate().packages || {};
  console.log("Perfil  Versão   Publicado   Situação");
  const pending = [];
  for (const role of ORDER) {
    const p = profiles[role];
    buildProfile(p);
    const now = packageHash(p);
    const base = pub[role]?.hash || publishedHash(p);
    const changed = !base || now !== base;
    if (changed) pending.push(role);
    console.log(`${role.toUpperCase().padEnd(7)} ${p.version.padEnd(8)} ${(pub[role]?.date || "—").padEnd(11)} ${changed ? "mudou desde a última versão → precisa de release" : "igual ao publicado"}`);
  }
  console.log(pending.length
    ? `\nPara lançar: npm run release -- ${pending.join(",")} -m "o que mudou"`
    : "\nNada para lançar.");
  return pending;
}

function release() {
  const kind = args.includes("--major") ? "major" : args.includes("--minor") ? "minor" : "patch";
  const dry = args.includes("--dry");
  const mi = args.findIndex((a) => a === "-m" || a === "--notes");
  const notes = mi >= 0 ? String(args[mi + 1] || "").trim() : "";
  const target = args.find((a, i) => !a.startsWith("-") && i !== mi + 1) || "";
  const roles = target === "todos" || target === "all" ? ORDER : target.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
  const bad = roles.filter((r) => !ORDER.includes(r));
  if (!roles.length || bad.length || !notes) {
    console.error(`Uso: npm run release -- <${ORDER.join("|")}|todos>[,...] [--minor|--major] [--dry] -m "o que mudou"`);
    if (bad.length) console.error(`Perfil desconhecido: ${bad.join(", ")}`);
    if (!notes) console.error("Escreva o que mudou com -m \"...\" (vai para o aviso de versão e para o CHANGELOG do perfil).");
    process.exit(1);
  }

  if (!dry && !args.includes("--skip-tests")) {
    console.log("Rodando os testes...");
    execFileSync(process.execPath, ["--test", "tests/*.test.mjs"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
    console.log("✓ testes ok");
  }

  const profiles = readProfiles();
  const released = {};
  for (const role of roles) {
    const p = profiles[role];
    const from = p.version;
    p.version = bump(from, kind);
    console.log(`${role.toUpperCase().padEnd(7)} ${from} → ${p.version}`);
    if (dry) continue;
    saveProfile(p);
    const log = join(ROOT, "profiles", role, "CHANGELOG.md");
    const text = readFileSync(log, "utf8");
    const entry = `## ${p.version} (${today})\n\n${notes.split(/\n|;\s*/).filter(Boolean).map((n) => `- ${n.trim()}`).join("\n")}\n\n`;
    const at = text.indexOf("\n## ");
    writeFileSync(log, at < 0 ? `${text.trimEnd()}\n\n${entry}` : text.slice(0, at + 1) + entry + text.slice(at + 1));
    buildProfile(p);
    zipProfile(p);
    released[role] = { version: p.version, date: today, notes, hash: packageHash(p) };
  }
  if (dry) return console.log("\n(--dry: nada foi gravado)");
  // os outros perfis também são gerados de novo (pastas de teste), mas não mudam de versão nem de .zip
  for (const role of ORDER) if (!roles.includes(role)) buildProfile(profiles[role]);
  writeUpdate(profiles, released);
  writeInstaller();
  const title = roles.map((r) => `${r.toUpperCase()} ${profiles[r].version}`).join(", ");
  console.log(`\n✓ Lançado: ${title}. Falta só o git:`);
  console.log(`  git add -A profiles update.json dist && git commit -m "QuickFill ${title}: ${notes.replace(/"/g, "'")}" && git push`);
}

if (cmd === "status") status();
else if (cmd === "release") release();
else {
  console.error("Use: npm run status  |  npm run release -- <perfis> -m \"o que mudou\"");
  process.exit(1);
}
