import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseChangelog, splitNotes } from "../src/lib/changelog.js";

export function profileHistory(root, role) {
  return parseChangelog(readFileSync(join(root, "profiles", role, "CHANGELOG.md"), "utf8"));
}

/** Compara com o último commit do histórico do perfil, incluindo mudanças locais e arquivos novos.
 * Inclui os assuntos dos commits; --notes ou o release fornecem notas editoriais. */
export function buildChanges(root, role, notes = "") {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const paths = ["src", "build.mjs", "tools", `profiles/${role}`];
  let files = [], commits = [];
  try {
    const base = git(["log", "-1", "--format=%H", "--", `profiles/${role}/CHANGELOG.md`]) || "HEAD";
    commits = [...new Set(git(["log", "--format=%s", `${base}..HEAD`, "--", ...paths]).split(/\r?\n/).filter(Boolean))];
    files = [...new Set([
      ...git(["diff", "--name-only", base, "--", ...paths]).split(/\r?\n/),
      ...git(["ls-files", "--others", "--exclude-standard", "--", ...paths]).split(/\r?\n/),
    ])].filter(Boolean).filter((file) => !file.endsWith("/CHANGELOG.md")).sort();
  } catch { /* Sem Git (arquivo baixado): o histórico publicado e as notas continuam disponíveis. */ }
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    try { hash.update(readFileSync(join(root, file))); } catch { hash.update("deleted"); }
  }
  return { changes: splitNotes(notes).length ? splitNotes(notes) : commits, files, sourceHash: files.length ? hash.digest("hex").slice(0, 16) : "" };
}
