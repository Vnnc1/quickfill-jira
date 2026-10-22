/** Contrato comum ao build, ao aviso remoto e ao histórico instalado. */
export function splitNotes(notes) {
  return (Array.isArray(notes) ? notes : String(notes || "").split(/\r?\n|;\s*/))
    .filter((item) => typeof item === "string")
    .map((item) => item.replace(/^\s*[-*]\s+/, "").trim()).filter(Boolean);
}

export function parseChangelog(markdown) {
  const releases = [];
  let entry;
  for (const line of String(markdown).split(/\r?\n/)) {
    const heading = line.match(/^## (\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)/);
    if (heading) { entry = { version: heading[1], date: heading[2], changes: [] }; releases.push(entry); }
    else if (entry && /^[-*]\s+/.test(line)) entry.changes.push(line.replace(/^[-*]\s+/, "").trim());
  }
  return releases;
}

/** Atualizar e ativar são comandos distintos, mesmo com um Ajudante já instalado. */
export function powershellCommand(base, { role = "", extensionId = "", helper = false } = {}) {
  const command = String(base || "").match(/^(powershell(?:\.exe)?\s+.*?)\s+-Command\s+"([\s\S]*)"$/i);
  if (!command) return "";
  if (role && !/^(qa|dev|scrum|design)$/.test(role)) return "";
  if (helper && !/^[a-p]{32}$/.test(extensionId)) return "";
  const settings = [`$env:QF_AJUDANTE='${helper ? "1" : "0"}';`, "$env:QF_EXT_ID='';"];
  if (role) settings.push(`$env:QF_PACOTES='${role}';`);
  if (helper) settings.push(`$env:QF_EXT_ID='${extensionId}';`);
  const script = `${settings.join(" ")} ${command[2]}`;
  // UTF-16LE evita que o PowerShell externo expanda $env antes de executar o comando.
  // Também funciona no Win+R, sem depender das regras de aspas de cada shell.
  let bytes = "";
  for (let i = 0; i < script.length; i++) bytes += String.fromCharCode(script.charCodeAt(i) & 255, script.charCodeAt(i) >> 8);
  return `${command[1]} -EncodedCommand ${btoa(bytes)}`;
}

export function releaseEntries(update, local = []) {
  const entries = Array.isArray(update?.changelog) ? update.changelog : [];
  const latest = update?.latest ? [{ version: update.latest, date: update.date, changes: splitNotes(update.notes) }] : [];
  const seen = new Set();
  return [...entries, ...latest, ...local].filter((entry) => {
    if (!/^\d+\.\d+\.\d+$/.test(entry?.version) || seen.has(entry.version)) return false;
    seen.add(entry.version); return true;
  }).map((entry) => ({ version: entry.version, date: String(entry.date || ""), changes: splitNotes(entry.changes) }))
    .sort((a, b) => {
      const x = a.version.split(".").map(Number), y = b.version.split(".").map(Number);
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    });
}
