import { ROLE, INSTALL_CMD } from "./lib/role.js";
import { powershellCommand } from "./lib/changelog.js";
import { PALETTE, ROLE_ACCENT, applyAccent, loadAccent } from "./lib/theme.js";

const ROLE_NAME = { qa: "QuickFill QA", dev: "QuickFill DEV", scrum: "QuickFill SCRUM", design: "QuickFill DESIGN" }[ROLE] || "QuickFill";
document.documentElement.classList.add(`role-${ROLE}`);
loadAccent(ROLE);
if (ROLE !== "qa") document.documentElement.classList.add("role-dash");
document.querySelectorAll("[data-roles]").forEach((e) => e.classList.toggle("role-off", !e.dataset.roles.split(/\s+/).includes(ROLE)));
document.title = `Jira ${ROLE_NAME} — Opções`;
document.querySelector(".hdr h1").textContent = `${ROLE_NAME} · Opções`;
const ROLE_SUB = {
  dev: "Conexão, jornada, meta do dia, equipe e espaços",
  scrum: "Conexão, equipe, espaços e limites da sprint",
  design: "Conexão, meta do dia, etiquetas de design e equipe",
}[ROLE];
if (ROLE_SUB) document.querySelector(".hdr p").textContent = ROLE_SUB;

/* Lista de pessoas com busca no Jira (aceita entradas só com o nome, casadas pelo começo do nome). */
function peoplePicker(prefix, hiddenId) {
  const list = () => { try { return JSON.parse($(hiddenId).value || "[]"); } catch { return []; } };
  const render = () => {
    const box = $(`${prefix}Chips`);
    box.innerHTML = "";
    for (const d of list()) {
      const c = document.createElement("span");
      c.className = "pick-chip";
      c.textContent = d.accountId ? d.name : `${d.name} (pelo nome)`;
      const x = document.createElement("button");
      x.textContent = "✕"; x.title = "Remover";
      x.addEventListener("click", () => { $(hiddenId).value = JSON.stringify(list().filter((y) => (y.accountId || y.name) !== (d.accountId || d.name))); render(); msg("Lembre de salvar."); });
      c.appendChild(x);
      box.appendChild(c);
    }
    if (!box.children.length) box.innerHTML = '<span class="help" style="margin:0">Ninguém.</span>';
  };
  let timer = null;
  // depois da carga do módulo (o $ é declarado mais abaixo)
  queueMicrotask(() => $(`${prefix}Search`).addEventListener("input", () => {
    clearTimeout(timer);
    const q = $(`${prefix}Search`).value.trim();
    const box = $(`${prefix}Results`);
    if (q.length < 2) { box.innerHTML = ""; return; }
    timer = setTimeout(() => chrome.runtime.sendMessage({ type: "TEAM_USER_SEARCH", payload: { query: q } }, (res) => {
      box.innerHTML = "";
      if (chrome.runtime.lastError || !res?.ok) { box.textContent = res?.error || "Não foi possível buscar (salve a conexão primeiro)."; return; }
      for (const u of res.data) {
        const b = document.createElement("button");
        b.className = "btn"; b.textContent = `+ ${u.name}`;
        b.addEventListener("click", () => {
          const next = list().filter((y) => y.accountId !== u.accountId && !(!y.accountId && u.name.toLowerCase().startsWith(String(y.name).toLowerCase())));
          next.push(u);
          $(hiddenId).value = JSON.stringify(next);
          $(`${prefix}Search`).value = ""; box.innerHTML = "";
          render(); msg("Lembre de salvar.");
        });
        box.appendChild(b);
      }
      if (!res.data.length) box.textContent = "Ninguém encontrado.";
    }), 350);
  }));
  return { render };
}
const smPicker = peoplePicker("sm", "smPeople");
const ignorePicker = peoplePicker("ignore", "ignorePeople");
const designPicker = peoplePicker("designP", "designPeople");

const FIELDS = ["baseUrl", "email", "apiToken", "startDateFieldId", "logWorkComment", "subtaskName", "subtaskTypeId",
  "defaultProject", "projectAliases", "statusColumns", "sustProject", "sustColumns",
  "workStart", "workEnd", "dailyCapHours", "dailyGoalHours",
  "defaultStoryPoints", "storyPointsFieldId",
  "teamProjects", "teamGoalHours", "teamCapHours", "overflowMode",
  "scrumStaleDays", "scrumWipLimit", "designLabels", "designWeeklyGoal",
  "stageFeito", "stageDeploy", "stagePrd", "stageQa", "stageReopen", "designDoing", "designReview", "designDelivered",
  "feitoThreshold", "deployIssueType", "deploySummary", "deployers", "figmaUrl", "figmaToken",
  "stageValidated", "stageBlocked", "qaPeople", "designProjects", "smPeople", "ignorePeople", "designPeople", "accentColor", "openMode", "updateUrl", "updateToken",
  "uxProject", "uxHuProject", "uxWeeklyGoal", "uxHiddenFronts", "uxIssueType"];
// Todas nascem ligadas: só ficam desligadas se tiverem sido salvas como false.
const FLAGS = ["assignSelf", "skipWeekends", "estimateFromSpent", "zeroRemainingOnDone"];
const DEFAULT_VALUES = { workStart: "11:00", workEnd: "17:00", dailyCapHours: "6", dailyGoalHours: "4", defaultStoryPoints: "1",
  teamGoalHours: "4", teamCapHours: "6", overflowMode: "sameDay",
  scrumStaleDays: "3", scrumWipLimit: "2", designLabels: "design, ux, ui", designWeeklyGoal: "3",
  uxProject: "UX", uxWeeklyGoal: "8", uxHiddenFronts: "Instagram", uxIssueType: "HU",
  feitoThreshold: "3", deployIssueType: "Tarefa", deploySummary: "Realizando Deploy", deployers: "[]",
  qaPeople: '[{"name":"Almir Vinicius"},{"name":"Jhonathan Pinheiro"}]',
  openMode: "panel", accentColor: "", updateUrl: "",
  smPeople: '[{"name":"Marjorie Pinheiro"}]', designPeople: '[{"name":"Amanda Saraiva"}]', ignorePeople: '[{"name":"Teste Novetech"}]' };

const toMin = (t) => {
  const m = String(t || "").trim().match(/^(\d{1,2})(?::|h)?(\d{2})?$/);
  if (!m || +m[1] > 23 || +(m[2] || 0) > 59) return null;
  return +m[1] * 60 + +(m[2] || 0);
};
const $ = (id) => document.getElementById(id);

function msg(text, bad) {
  const el = $("msg");
  el.textContent = text;
  el.style.color = bad ? "var(--err)" : "var(--ok)";
}

chrome.storage.sync.get([...FIELDS, ...FLAGS], (cfg) => {
  FIELDS.forEach((f) => ($(f).value = String(cfg[f] ?? DEFAULT_VALUES[f] ?? "")));
  // assignSelf nasce ligado: só fica desligado se tiver sido salvo como false
  FLAGS.forEach((f) => ($(f).checked = cfg[f] !== false));
  renderDeployers();
  renderQaPeople();
  smPicker.render();
  ignorePicker.render();
  renderSwatches();
  designPicker.render();
});

/* ---------- Quem faz deploy (busca no Jira) ---------- */

const deployersList = () => { try { return JSON.parse($("deployers").value || "[]"); } catch { return []; } };
function renderDeployers() {
  const box = $("deployerChips");
  box.innerHTML = "";
  for (const d of deployersList()) {
    const c = document.createElement("span");
    c.className = "pick-chip";
    c.textContent = d.name;
    const x = document.createElement("button");
    x.textContent = "✕"; x.title = "Remover";
    x.addEventListener("click", () => { $("deployers").value = JSON.stringify(deployersList().filter((y) => y.accountId !== d.accountId)); renderDeployers(); });
    c.appendChild(x);
    box.appendChild(c);
  }
  if (!box.children.length) box.innerHTML = '<span class="help" style="margin:0">Ninguém ainda.</span>';
}
let searchTimer = null;
$("deployerSearch").addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = $("deployerSearch").value.trim();
  if (q.length < 2) { $("deployerResults").innerHTML = ""; return; }
  searchTimer = setTimeout(() => {
    chrome.runtime.sendMessage({ type: "TEAM_USER_SEARCH", payload: { query: q } }, (res) => {
      const box = $("deployerResults");
      box.innerHTML = "";
      if (chrome.runtime.lastError || !res?.ok) { box.textContent = res?.error || "Não foi possível buscar (salve a conexão primeiro)."; return; }
      for (const u of res.data) {
        const b = document.createElement("button");
        b.className = "btn"; b.textContent = `+ ${u.name}`;
        b.addEventListener("click", () => {
          const list = deployersList();
          if (!list.some((y) => y.accountId === u.accountId)) list.push(u);
          $("deployers").value = JSON.stringify(list);
          $("deployerSearch").value = ""; box.innerHTML = "";
          renderDeployers();
          msg("Lembre de salvar.");
        });
        box.appendChild(b);
      }
      if (!res.data.length) box.textContent = "Ninguém encontrado.";
    });
  }, 350);
});

$("save").addEventListener("click", () => {
  const data = {};
  FIELDS.forEach((f) => (data[f] = $(f).value.trim()));
  FLAGS.forEach((f) => (data[f] = $(f).checked));
  if (!data.subtaskName) data.subtaskName = "Testes Manuais";

  // Jornada: valida antes de salvar — uma janela inválida quebraria todo apontamento.
  data.workStart = data.workStart || "11:00";
  data.workEnd = data.workEnd || "17:00";
  const ws = toMin(data.workStart), we = toMin(data.workEnd);
  if (ws == null || we == null) return msg("Horário inválido na jornada. Use HH:MM, ex.: 11:00.", true);
  if (we <= ws) return msg("O fim da jornada precisa ser depois do início.", true);
  const cap = Number(data.dailyCapHours || 6);
  if (!(cap > 0)) return msg("O teto diário precisa ser maior que zero.", true);
  data.overflowMode = data.overflowMode === "nextDay" ? "nextDay" : "sameDay";
  if (data.overflowMode === "nextDay" && cap * 60 > we - ws) {
    return msg(`O teto (${cap}h) não cabe na janela ${data.workStart}–${data.workEnd} (${(we - ws) / 60}h).`, true);
  }
  data.dailyCapHours = String(cap);
  const goal = Number(data.dailyGoalHours || 4);
  if (!(goal > 0)) return msg("A meta diária precisa ser maior que zero.", true);
  if (goal > cap) return msg(`A meta (${goal}h) não pode passar do teto (${cap}h).`, true);
  data.dailyGoalHours = String(goal);
  data.defaultStoryPoints = Number(data.defaultStoryPoints || 1);
  const tg = Number(data.teamGoalHours || 4), tc = Number(data.teamCapHours || 6);
  if (!(tg > 0 && tc > 0 && tc <= 24)) return msg("Meta e teto padrão da equipe precisam estar entre 0 e 24 horas.", true);
  if (tg > tc) return msg("A meta padrão da equipe não pode passar do teto.", true);
  data.teamGoalHours = String(tg);
  data.teamCapHours = String(tc);
  data.scrumStaleDays = String(Math.min(30, Math.max(1, Math.round(Number(data.scrumStaleDays) || 3))));
  data.scrumWipLimit = String(Math.min(20, Math.max(1, Math.round(Number(data.scrumWipLimit) || 2))));
  data.designWeeklyGoal = String(Math.min(50, Math.max(1, Math.round(Number(data.designWeeklyGoal) || 3))));
  data.designLabels = data.designLabels || "design, ux, ui";
  data.feitoThreshold = String(Math.min(50, Math.max(1, Math.round(Number(data.feitoThreshold) || 3))));
  data.deployIssueType = data.deployIssueType || "Tarefa";
  data.deploySummary = data.deploySummary || "Realizando Deploy";
  data.deployers = data.deployers || "[]";
  data.qaPeople = data.qaPeople || "[]";
  data.smPeople = data.smPeople || "[]";
  data.ignorePeople = data.ignorePeople || "[]";
  data.designPeople = data.designPeople || "[]";
  data.designProjects = data.designProjects.toUpperCase();
  data.uxProject = (data.uxProject || "UX").trim().toUpperCase();
  data.uxHuProject = (data.uxHuProject || "").trim().toUpperCase();
  data.uxWeeklyGoal = String(Math.min(50, Math.max(1, Math.round(Number(data.uxWeeklyGoal) || 8))));
  if (data.figmaUrl && !/figma\.com\/(file|design|proto|board)\//.test(data.figmaUrl)) return msg("O link do Figma precisa ser de um arquivo (figma.com/design/…).", true);
  data.teamProjects = data.teamProjects.toUpperCase();
  data.defaultProject = data.defaultProject.toUpperCase();
  data.sustProject = data.sustProject.toUpperCase();
  if (!data.statusColumns) data.statusColumns = "Validação, Deploy";
  if (!data.sustColumns) data.sustColumns = "Deploy, Validação Meeds All";
  data.baseUrl = data.baseUrl.replace(/\/+$/, "");
  if (data.baseUrl && !/^https:\/\//.test(data.baseUrl)) data.baseUrl = "https://" + data.baseUrl;
  chrome.storage.sync.set(data, () => {
    $("baseUrl").value = data.baseUrl;
    msg("✓ Salvo. Reabra o modal para aplicar.");
  });
});

$("test").addEventListener("click", () => {
  msg("Testando…");
  chrome.runtime.sendMessage({ type: "TEST_CONNECTION" }, (res) => {
    if (chrome.runtime.lastError) return msg(chrome.runtime.lastError.message, true);
    if (!res?.ok) return msg(res?.error || "Falhou.", true);
    msg(`Conectado como ${res.data.displayName} (${res.data.email || res.data.accountId}).`);
  });
});

/* ---------- Exportar / importar (entre QA, DEV, SCRUM e DESIGN) ---------- */

const SHARE_KEYS = [...FIELDS, ...FLAGS, "teamPeople", "batchBoardId", "sustBoardId"];

$("btnExport").addEventListener("click", async () => {
  const data = await chrome.storage.sync.get(SHARE_KEYS);
  if (!$("exportToken").checked) { delete data.apiToken; delete data.figmaToken; delete data.updateToken; }
  const blob = new Blob([JSON.stringify({ kind: "jira-quickfill-config", version: 1, from: ROLE, exportedAt: new Date().toISOString(), data }, null, 2)],
    { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `quickfill-config-${ROLE}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  msg(`✓ Configuração exportada${data.apiToken ? " (com o token)" : " (sem o token)"}.`);
});

$("btnImport").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async () => {
  const file = $("importFile").files[0];
  $("importFile").value = "";
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    if (json?.kind !== "jira-quickfill-config" || typeof json.data !== "object") throw new Error("Arquivo não é uma configuração do QuickFill.");
    const data = Object.fromEntries(Object.entries(json.data).filter(([k]) => SHARE_KEYS.includes(k)));
    if (!data.apiToken) delete data.apiToken;   // sem token no arquivo: mantém o atual
    await chrome.storage.sync.set(data);
    location.reload();
  } catch (e) {
    msg(e.message || "Não foi possível importar.", true);
  }
});

/* ---------- Equipe de QA (mesma busca do deploy; aceita entradas só com o nome) ---------- */

const qaList = () => { try { return JSON.parse($("qaPeople").value || "[]"); } catch { return []; } };
function renderQaPeople() {
  const box = $("qaChips");
  box.innerHTML = "";
  for (const d of qaList()) {
    const c = document.createElement("span");
    c.className = "pick-chip";
    c.textContent = d.accountId ? d.name : `${d.name} (pelo nome)`;
    const x = document.createElement("button");
    x.textContent = "✕"; x.title = "Remover";
    x.addEventListener("click", () => { $("qaPeople").value = JSON.stringify(qaList().filter((y) => y !== d && (y.accountId || y.name) !== (d.accountId || d.name))); renderQaPeople(); msg("Lembre de salvar."); });
    c.appendChild(x);
    box.appendChild(c);
  }
  if (!box.children.length) box.innerHTML = '<span class="help" style="margin:0">Ninguém ainda.</span>';
}
let qaTimer = null;
$("qaSearch").addEventListener("input", () => {
  clearTimeout(qaTimer);
  const q = $("qaSearch").value.trim();
  if (q.length < 2) { $("qaResults").innerHTML = ""; return; }
  qaTimer = setTimeout(() => {
    chrome.runtime.sendMessage({ type: "TEAM_USER_SEARCH", payload: { query: q } }, (res) => {
      const box = $("qaResults");
      box.innerHTML = "";
      if (chrome.runtime.lastError || !res?.ok) { box.textContent = res?.error || "Não foi possível buscar (salve a conexão primeiro)."; return; }
      for (const u of res.data) {
        const b = document.createElement("button");
        b.className = "btn"; b.textContent = `+ ${u.name}`;
        b.addEventListener("click", () => {
          // troca a entrada "só nome" pela pessoa do Jira
          const list = qaList().filter((y) => y.accountId !== u.accountId && !(!y.accountId && u.name.toLowerCase().startsWith(String(y.name).toLowerCase())));
          list.push(u);
          $("qaPeople").value = JSON.stringify(list);
          $("qaSearch").value = ""; box.innerHTML = "";
          renderQaPeople();
          msg("Lembre de salvar.");
        });
        box.appendChild(b);
      }
      if (!res.data.length) box.textContent = "Ninguém encontrado.";
    });
  }, 350);
});

/* ---------- Diagnóstico: como cada status foi classificado ---------- */

const STAGE_TXT = { todo: "A fazer", doing: "Em andamento", blocked: "Impedido / Aguardando", feito: "Feito", deploy: "Deploy",
  qa: "Validação (fila do QA)", validated: "Validado", done: "Concluído" };
$("btnStatusMap").addEventListener("click", () => {
  const box = $("statusMap");
  box.textContent = "Lendo os quadros… (salve antes, se mudou os nomes acima)";
  chrome.runtime.sendMessage({ type: "STATUS_MAP" }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) { box.textContent = res?.error || chrome.runtime.lastError?.message || "Falhou."; return; }
    box.innerHTML = "";
    for (const sp of res.data) {
      const h = document.createElement("h3");
      h.className = "sub";
      h.textContent = `${sp.project}${sp.board ? ` · quadro ${sp.board.name}` : " · sem quadro"}`;
      box.appendChild(h);
      const t = document.createElement("table");
      t.innerHTML = "<tr><th>Coluna</th><th>Status</th><th>Etapa no QuickFill</th></tr>";
      for (const s of sp.statuses.sort((a, b) => Object.keys(STAGE_TXT).indexOf(a.stage) - Object.keys(STAGE_TXT).indexOf(b.stage))) {
        const tr = document.createElement("tr");
        for (const v of [s.column, s.name, STAGE_TXT[s.stage] || s.stage]) { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); }
        if (s.stage === "blocked") tr.className = "st-blocked";
        t.appendChild(tr);
      }
      if (!sp.statuses.length) { const p = document.createElement("p"); p.className = "help"; p.textContent = "Nenhuma coluna lida do quadro."; box.appendChild(p); }
      else box.appendChild(t);
    }
  });
});

/* ---------- Cor de destaque (paleta igual para todos; padrão = cor do perfil) ---------- */

function renderSwatches() {
  const box = $("swatches");
  box.innerHTML = "";
  const cur = ($("accentColor").value || "").toLowerCase();
  const pick = (hex) => {
    $("accentColor").value = hex;
    applyAccent(hex || ROLE_ACCENT[ROLE]);
    chrome.storage.sync.set({ accentColor: hex });   // aplica na hora nas telas abertas
    renderSwatches();
  };
  const def = document.createElement("button");
  def.className = `sw sw-def ${!cur ? "on" : ""}`;
  def.style.setProperty("--c", ROLE_ACCENT[ROLE]);
  def.textContent = "Padrão do perfil";
  def.addEventListener("click", () => pick(""));
  box.appendChild(def);
  for (const p of PALETTE) {
    const b = document.createElement("button");
    b.className = `sw ${cur === p.hex ? "on" : ""}`;
    b.style.setProperty("--c", p.hex);
    b.title = p.name;
    b.setAttribute("aria-label", p.name);
    b.addEventListener("click", () => pick(p.hex));
    box.appendChild(b);
  }
  const custom = document.createElement("input");
  custom.type = "color";
  custom.className = "sw-custom";
  custom.title = "Outra cor";
  custom.value = cur && /^#[0-9a-f]{6}$/i.test(cur) ? cur : ROLE_ACCENT[ROLE];
  custom.addEventListener("change", () => pick(custom.value.toLowerCase()));
  box.appendChild(custom);
}

/* ---------- Atualização com um clique (ajudante nativo) ---------- */

function nativeStatus() {
  chrome.runtime.sendMessage({ type: "NATIVE_PING" }, (res) => {
    const ok = !chrome.runtime.lastError && res?.ok && res.data?.available;
    $("nativeStatus").textContent = ok ? "✓ ativada nesta máquina" : "— ainda não ativada";
    $("nativeStatus").style.color = ok ? "var(--ok)" : "";
    $("btnNative").textContent = ok ? "Ativar de novo (copiar comando)" : "Ativar atualização com um clique";
  });
}
$("btnNative").addEventListener("click", async () => {
  if (!INSTALL_CMD) return msg("Este pacote não tem o endereço do repositório (release.config.json).", true);
  const cmd = powershellCommand(INSTALL_CMD, { role: ROLE, extensionId: chrome.runtime.id, helper: true });
  try { await navigator.clipboard.writeText(cmd); msg("Comando copiado! Tecle Win+R, cole (Ctrl+V) e Enter. Depois volte aqui e recarregue a página."); }
  catch { prompt("Copie o comando e cole no Win+R:", cmd); }
});
nativeStatus();

if (location.hash === "#atualizacao") setTimeout(() => { $("atualizacao").scrollIntoView({ block: "center" }); $("atualizacao").classList.add("flash"); }, 300);
