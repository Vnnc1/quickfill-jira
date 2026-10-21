import { parseDuration, humanize } from "./lib/duration.js";
import { saveDraft, flushDraft, loadDraft, clearDraft, since } from "./lib/draft.js";
import { ROLE, INSTALL_CMD } from "./lib/role.js";
import { initUx, loadUx, uxData, uxViewState, uxApplyViewState, renderUxBoard, renderUxDeliveries, renderUxDemand, renderUxToday, renderUxProgress } from "./design-ux.js";
import { loadAccent } from "./lib/theme.js";
import { initFloat, popOutFromPanel } from "./lib/float.js";
import { openHistory, ICON_HIST } from "./lib/history-view.js";
import { loadMeetings, onMeetingsChange, meetingMinutes, attachMeetings, meetingsCard, setMeetingApi,
  meetingsOn, meetingsBetween, meetingLog, describeChange, ago, MEETING_TYPES, MEETING_GROUPS, groupOfType, rgba as mtgRgba } from "./lib/meetings.js";
import { byLabel } from "./lib/meeting-detect.js";
import { addDaysIso, isWeekendIso, DAY_MS } from "./lib/dates.js";
import { totalOf, byIssue, streakAt, averageBefore, averageUntil, periodStats, weekCompare, countedDays, demandBoard, deployLabel, feitoLabel, DEMAND_GROUPS } from "./lib/devstats.js";
import { STAGES, RISKS, DESIGN_STAGES, HANDOFF_ITEMS, TYPE_LABEL, stageOf, typeGroup, normName, sprintHealth, sprintTree, peopleLoad,
  sprintRisks, returnCauses, designBoard, businessAge, lastMove, reopenEvents, qaMatcher, flowMetrics, linkParents } from "./lib/teamstats.js";

/* =====================================================================
   Jira QuickFill — modal
   Abas: Tarefa · Lote (MEED | SUS) · Painel · Meu dia
   ===================================================================== */

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const inIframe = window.parent !== window;
if (inIframe) document.documentElement.classList.add("embedded");
/* Perfis: "qa" é o completo (Tarefa/Lote); "dev", "scrum" e "design" são painéis só de leitura. */
const IS_DASH = ROLE !== "qa";
const HAS_PROG = ROLE === "dev" || ROLE === "design";   // Hoje/Progresso: histórico dos seus apontamentos
const ROLE_NAME = { qa: "QuickFill QA", dev: "QuickFill DEV", scrum: "QuickFill SCRUM", design: "QuickFill DESIGN" }[ROLE] || "QuickFill";
document.documentElement.classList.add(`role-${ROLE}`);
if (IS_DASH) document.documentElement.classList.add("role-dash");
loadAccent(ROLE);
/* Onde está aberto: painel lateral do Chrome (página da extensão no topo, sem ?standalone),
   modal sobre o Jira (iframe) ou janela própria. */
const inPanel = !inIframe && !params.get("standalone");
if (inPanel) document.documentElement.classList.add("panel");
if (inPanel || params.get("standalone")) document.documentElement.classList.add("embedded");
/* Abas e blocos com data-roles="dev design" só aparecem nesses perfis. */
document.querySelectorAll("[data-roles]").forEach((e) => e.classList.toggle("role-off", !e.dataset.roles.split(/\s+/).includes(ROLE)));

const FORM_IDS = ["dueDate", "startDate", "startTime", "endTime", "estimate", "spent", "worklogComment", "statusSel"];
const CREATE_IDS = ["newSubtaskName", "assignSelfSingle", "skipDupSingle",
                    "newSubtaskNameBatch", "assignSelfBatch", "skipDupBatch"];
/* "Lote" tem dois espaços (MEED e SUS) com estado próprio; a aba é uma só. */
const SPACES = ["batch", "sustentacao"];
const isSpace = (m) => m === "lote";
const SPACE_LABEL = { batch: "MEED", sustentacao: "SUS" };
const VIEW_TABS = ["day", "panel", "team", "today", "progress", "demands", "sprint", "people", "risks", "hus", "qaq", "uxboard", "uxdeliv", "uxdemand"];
const UX_TABS = { uxboard: ["uxBoardBox", renderUxBoard], uxdeliv: ["uxDelivBox", renderUxDeliveries], uxdemand: ["uxDemandBox", renderUxDemand] };
/** Redesenha o que do espaço UX está na tela (aba do UX, ou as partes do Hoje e do Progresso). */
function rerenderUx() {
  const tab = UX_TABS[state.mode];
  if (tab) tab[1]($(tab[0]));
  if (ROLE === "design" && state.mode === "today") renderUxToday($("uxTodayBox"));
  if (ROLE === "design" && state.mode === "progress") renderUxProgress($("uxProgBox"));
}   // abas de consulta (sem formulário)

/* Padrões (sobrescritos pelo GET_DEFAULTS no boot) */
let DEF = {
  fibonacci: [1, 2, 3, 5, 8, 13, 21],
  defaultStoryPoints: 1,
  workday: { start: 660, end: 1020, cap: 360, goal: 240 },
};

/* ---------- links para o Jira ---------- */

const issueUrl = (key, base = DEF.baseUrl) => (base && key ? `${base}/browse/${key}` : "");

/** Abre a issue numa nova aba do navegador (Ctrl/⌘/botão do meio: em segundo plano). */
function openIssue(url, e) {
  if (!url) return toast("Configure a URL do Jira nas Opções.");
  const background = !!(e && (e.ctrlKey || e.metaKey || e.button === 1));
  if (chrome.tabs?.create) chrome.tabs.create({ url, active: !background });
  else window.open(url, "_blank", "noopener");
}

/**
 * Botão "Jira ↗" que abre a demanda sem disparar o clique da linha.
 * Usa <span role="link"> para poder ficar dentro de <button>.
 */
function jiraLink(key, { base, label = "Jira", title } = {}) {
  const url = issueUrl(key, base);
  const el = document.createElement("span");
  el.className = "jl";
  el.setAttribute("role", "link");
  el.tabIndex = 0;
  el.title = title || `Abrir ${key} no Jira (nova aba)\n${url}`;
  el.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (label) el.append(document.createTextNode(label));
  const go = (e) => { e.preventDefault(); e.stopPropagation(); openIssue(url, e); };
  el.addEventListener("click", go);
  el.addEventListener("auxclick", (e) => { if (e.button === 1) go(e); });
  el.addEventListener("mousedown", (e) => e.stopPropagation());
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") go(e); });
  return el;
}

/**
 * Botão "Histórico" que abre o caminho da demanda no quadro (etapas, voltas, quem mexeu).
 * Mesmo esquema do jiraLink: <span role="button"> para poder ficar dentro de <button>/<label>.
 */
function histLink(key, { base, label = "Histórico" } = {}) {
  const el = document.createElement("span");
  el.className = "jl hl";
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  el.title = `Ver o caminho de ${key} no quadro`;
  if (!label) el.setAttribute("aria-label", `Histórico de ${key}`);
  el.innerHTML = ICON_HIST;
  if (label) el.append(document.createTextNode(label));
  const go = (e) => { e.preventDefault(); e.stopPropagation(); openHistory(key, { send, openIssue, base: base || DEF.baseUrl }); };
  el.addEventListener("click", go);
  el.addEventListener("mousedown", (e) => e.stopPropagation());
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") go(e); });
  return el;
}

/* ---------- formatação ---------- */

const pad = (n) => String(n).padStart(2, "0");
const fmtHM = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const fmtDur = (m) => { m = Math.round(m || 0); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };
/** Concordância com a quantidade: pl(1, "dia útil", "dias úteis") → "dia útil". Zero e 2 ou mais vão para o plural. */
const pl = (n, one, many) => (Math.abs(Number(n) || 0) >= 2 || !Number(n) ? many : one);
const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const dow = (d) => { const [y, m, da] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, da)).getUTCDay(); };
const dayShort = (d) => `${DOW[dow(d)]} ${d.slice(8, 10)}/${d.slice(5, 7)}`;
const addDays = (d, n) => { const [y, m, da] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, da + n)).toISOString().slice(0, 10); };
const businessStep = (d, dir) => { let x = addDays(d, dir); while ([0, 6].includes(dow(x))) x = addDays(x, dir); return x; };

const parseKeyList = (t) => String(t || "").split(/[\n,;]+|\s{2,}/).map((s) => s.trim()).filter(Boolean);
const parseColumns = (t) => String(t || "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);

const ISSUE_COLORS = ["#579dff", "#4bce97", "#f5cd47", "#f87168", "#9f8fef", "#6cc3e0", "#fea362", "#e774bb"];

/* =====================================================================
   Estado
   ===================================================================== */

function blankSpace() {
  return {
    project: "", boardId: "", boardColumns: [], pickedColumns: [], columns: "",
    source: "board", level: "sub", onlyMine: false, excludeSub: true, keysText: "",
    board: { issues: [], checked: [], statuses: [], me: null },
    targets: [], checked: [], statuses: [], me: null, form: {},
  };
}

const state = {
  mode: "single",
  prevMode: "single",
  subtasks: [],
  parent: null,            // tarefa pai buscada na aba Tarefa (também pode receber horas)
  selected: null,
  spaceId: "batch",        // espaço ativo dentro do Lote
  panel: { project: "", type: "all", q: "", status: "", kpi: "", data: null },
  storyPoints: 1,          // null = não alterar
  endAnchor: null,         // horário de término INFORMADO (o campo pode exibir o valor ajustado à jornada)
  startAnchor: null,       // horário de início INFORMADO
  echo: { start: null, end: null },  // valores escritos pela extensão nos campos (não são entrada do usuário)
  timeMode: "end",         // "end": fim conhecido → início = fim − trabalhado · "start": início conhecido · "auto": 1º horário livre
  spaces: { batch: blankSpace(), sustentacao: blankSpace() },
  lastResult: null,
  dayDate: todayISO(),
};
const space = (id = state.spaceId) => state.spaces[id];

/* =====================================================================
   Rascunho
   ===================================================================== */

const formValues = () => ({
  ...Object.fromEntries(FORM_IDS.map((id) => [id, $(id).value])),
  storyPoints: state.storyPoints,
  timeMode: state.timeMode,
});

function snapshot() {
  if (isSpace(state.mode)) saveSpaceFromUI(state.spaceId);
  return {
    mode: VIEW_TABS.includes(state.mode) ? state.prevMode : state.mode,
    spaceId: state.spaceId,
    parentKey: $("parentKey").value,
    parent: state.parent,
    subtasks: state.subtasks,
    selected: state.selected,
    spaces: state.spaces,
    form: formValues(),
    create: Object.fromEntries(CREATE_IDS.map((id) => [id, $(id).type === "checkbox" ? $(id).checked : $(id).value])),
    lastResult: state.lastResult,
  };
}
const touch = () => saveDraft(snapshot);

/* =====================================================================
   Ponte com o serviço em segundo plano
   ===================================================================== */

const PORT_ERRORS = /message port closed|receiving end does not exist|extension context invalidated/i;

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type, payload }, (res) => {
        const err = chrome.runtime.lastError?.message;
        if (err) {
          if (PORT_ERRORS.test(err)) {
            markStale("O serviço da extensão não respondeu — está desatualizado ou parou.");
            return reject(new Error("Serviço da extensão desatualizado. Use “Recarregar extensão” no topo."));
          }
          return reject(new Error(err));
        }
        if (!res) { markStale("O serviço da extensão não respondeu."); return reject(new Error("Sem resposta da extensão.")); }
        if (!res.ok && /desconhecida pelo serviço/.test(res.error || "")) markStale(res.error);
        res.ok ? resolve(res.data) : reject(new Error(res.error));
      });
    } catch {
      markStale("A extensão foi atualizada e esta janela ficou desconectada.");
      reject(new Error("A extensão foi atualizada. Feche e abra o modal de novo."));
    }
  });
}

function markStale(text) {
  $("staleBox").querySelector("span").textContent = `${text} Acontece quando os arquivos são trocados sem recarregar a extensão.`;
  $("staleBox").classList.remove("hidden");
}

async function checkService() {
  const mine = chrome.runtime.getManifest().version;
  try {
    const res = await Promise.race([send("PING"), new Promise((_, r) => setTimeout(() => r(new Error("t")), 3000))]);
    if (res?.version !== mine) markStale(`O serviço em execução é a v${res?.version || "?"}, mas os arquivos são da v${mine}.`);
  } catch { markStale("O serviço da extensão não respondeu."); }
}

/* =====================================================================
   Feedback
   ===================================================================== */

let toastTimer = null;
function toast(msg, kind = "err") {
  const el = $("toast");
  clearTimeout(toastTimer);
  if (!msg) return el.classList.add("hidden");
  el.textContent = msg;
  el.className = `toast ${kind === "err" ? "" : kind}`;
  if (kind !== "err") toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
}
$("toast").addEventListener("click", () => toast(null));

const busy = (on) => $("app").classList.toggle("loading", on);
const BOOT = { done: false };   // a tela salva já voltou (a janela flutuante espera por isso)

/* =====================================================================
   Abas
   ===================================================================== */

function setMode(mode, { restoring = false } = {}) {
  if (!restoring && isSpace(state.mode)) saveSpaceFromUI(state.spaceId);
  if (!VIEW_TABS.includes(mode)) state.prevMode = mode;
  if (mode === "team") startTeamPolling(); else stopTeamPolling();
  if (ROLE === "qa") {
    // Espaço vale para Painel, Validação, Meu dia e Equipe; Período para as três primeiras (Equipe tem a própria data)
    $("spaceBar").classList.toggle("hidden", !["panel", "qaq", "day", "team"].includes(mode));
    $("qaPeriodBar").classList.toggle("hidden", !["panel", "qaq", "day"].includes(mode));
  }
  $("scPeriodBar").classList.toggle("hidden", mode === "team" || mode === "today");   // Equipe e Hoje têm a própria data
  state.mode = mode;

  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  document.querySelector('[data-pane="single"]').classList.toggle("hidden", mode !== "single");
  document.querySelector('[data-pane="space"]').classList.toggle("hidden", !isSpace(mode));
  document.querySelector('[data-pane="day"]').classList.toggle("hidden", mode !== "day");
  document.querySelector('[data-pane="panel"]').classList.toggle("hidden", mode !== "panel");
  document.querySelector('[data-pane="team"]').classList.toggle("hidden", mode !== "team");
  for (const v of ["today", "progress", "demands", "sprint", "people", "risks", "hus", "qaq", "uxboard", "uxdeliv", "uxdemand"]) document.querySelector(`[data-pane="${v}"]`).classList.toggle("hidden", mode !== v);
  if (ROLE === "design") $("spaceBar").classList.toggle("hidden", !!UX_TABS[mode]);   // o espaço UX tem a própria Frente
  if (mode === "today") startTodayPolling(); else stopTodayPolling();
  $("result").classList.add("hidden");
  toast(null);

  if (["sprint", "people", "risks"].includes(mode)) {
    showForm(false);
    if (SC.data) renderScrum();
    if (!SC.data || Date.now() - SC.data.generatedAt > 60 * 1000) loadScrum();
  } else if (mode === "qaq") {
    showForm(false);
    if (QQ.data) renderQaQueue();
    if (!QQ.data || Date.now() - QQ.data.generatedAt > 60 * 1000) loadQaQueue();
  } else if (UX_TABS[mode]) {
    showForm(false);
    if (uxData()) rerenderUx();
    loadUx({ render: rerenderUx }).catch(() => {});
  } else if (mode === "hus") {
    showForm(false);
    if (DS.data) renderHus();
    if (!DS.data || Date.now() - DS.data.generatedAt > 90 * 1000) loadHus();
  } else if (["today", "progress", "demands"].includes(mode)) {
    showForm(false);
    if (mode === "today") loadToday();
    if (mode === "progress") loadProgress();
    if (ROLE === "design" && mode !== "demands") { rerenderUx(); loadUx({ render: rerenderUx }).catch(() => {}); }
    if (mode === "demands") loadDemands();
  } else if (mode === "day") {
    showForm(false);
    loadDay(state.dayDate);
  } else if (mode === "panel") {
    showForm(false);
    loadPanel();
    setTimeout(() => $("panelSearch").focus(), 50);
  } else if (mode === "team") {
    showForm(false);
    if (team.data && team.data.date === team.date) renderTeam();
    loadTeam({ silent: !!team.data });
  } else if (isSpace(mode)) {
    loadSpaceToUI(state.spaceId);
    const sp = space();
    if (sp.boardId && !sp.boardColumns.length) loadBoardColumns(sp.boardId, { silent: true });
  } else {
    showForm(!!state.selected);
    if (state.selected) applySingleContext(state.selected, null, { keepValues: true });
    renderRecent();
  }
  $("scroll").scrollTop = 0;
  if (!restoring) touch();
  saveViewSoon();
}

function showForm(on) {
  $("formCard").classList.toggle("hidden", !on);
  $("actionBar").classList.toggle("hidden", !on);
}

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setMode(t.dataset.mode)));

/* =====================================================================
   Story points (Fibonacci)
   ===================================================================== */

function renderFib() {
  const box = $("fibGroup");
  box.innerHTML = "";
  for (const v of DEF.fibonacci) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = v;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(state.storyPoints === v));
    b.classList.toggle("on", state.storyPoints === v);
    b.addEventListener("click", () => { state.storyPoints = v; renderFib(); updateStoryHint(); touch(); });
    box.appendChild(b);
  }
  const none = document.createElement("button");
  none.type = "button";
  none.className = "none" + (state.storyPoints == null ? " on" : "");
  none.textContent = "manter";
  none.title = "Mantém o valor atual da subtarefa";
  none.addEventListener("click", () => { state.storyPoints = null; renderFib(); updateStoryHint(); touch(); });
  box.appendChild(none);
}

function updateStoryHint() {
  const el = $("curStory");
  el.className = "";
  if (isSpace(state.mode)) {
    const sp = space();
    const total = sp.targets.length;
    const n = sp.targets.filter((t) => t.storyField).length;
    el.textContent = !total ? "" : n === total ? "campo disponível em todas" : `campo disponível em ${n} de ${total} — as demais serão reportadas`;
    if (total && n < total) el.className = "bad";
    return;
  }
  const ctx = state.selected;
  if (!ctx) { el.textContent = ""; return; }
  if (!ctx.storyField) { el.textContent = "esta subtarefa não tem campo de story points na tela"; el.className = "bad"; return; }
  const cur = ctx.current.storyPoints;
  el.textContent = cur == null
    ? "sem valor atual"
    : state.storyPoints != null && state.storyPoints !== cur
      ? `atual: ${cur} → será ${state.storyPoints}`
      : `atual: ${cur}`;
}

/* =====================================================================
   Formulário
   ===================================================================== */

function setFormValues(v) {
  for (const id of FORM_IDS) if (v[id] !== undefined) $(id).value = v[id];
  if ("storyPoints" in v) state.storyPoints = v.storyPoints;
  if (v.timeMode) state.timeMode = v.timeMode;
  if (v.endTime !== undefined) state.endAnchor = hmToMin(v.endTime);
  if (v.startTime !== undefined) state.startAnchor = hmToMin(v.startTime);
  renderFib();
  updateStoryHint();
  refreshPreviews();
  updateTimeHint();
}

/** Fim padrão = agora (limitado ao fim da jornada). Antes do início da jornada, automático. */
function defaultEnd() {
  const n = nowMin();
  if (n <= DEF.workday.start) return { endTime: "", timeMode: "auto" };
  return { endTime: fmtHM(nowEnd()), timeMode: "end" };
}

/** "Agora" como horário de término: no modo mesmo dia não é limitado ao fim da jornada. */
function nowEnd() {
  return DEF.workday.overflow === "nextDay" ? Math.min(nowMin(), DEF.workday.end) : nowMin();
}

const blankForm = () => ({
  dueDate: "", startDate: todayISO(), startTime: "", ...defaultEnd(), estimate: "", spent: "",
  worklogComment: "", statusSel: "", storyPoints: DEF.defaultStoryPoints,
});

function updatePreview(inputId, previewId) {
  const el = $(previewId);
  const raw = $(inputId).value;
  el.className = "";
  if (!raw.trim()) { el.textContent = ""; return; }
  const p = parseDuration(raw);
  if (!p.ok) { el.textContent = p.error; el.className = "bad"; return; }
  el.textContent = `= ${humanize(p.minutes)}`;
  el.className = "good";
}

function updateEstimateMatch() {
  const el = $("estMatch");
  const est = parseDuration($("estimate").value);
  const sp = parseDuration($("spent").value);
  el.className = "match";
  if (!sp.ok || !sp.minutes) { el.textContent = ""; return; }
  // Tarefa com estimativa: ela não muda sozinha — o trabalhado só acumula.
  const cur = !isSpace(state.mode) && state.selected ? state.selected.current : null;
  const curEst = cur ? parseDuration(cur.originalEstimate) : null;
  if (curEst?.ok && curEst.minutes) {
    const before = parseDuration(cur.timeSpent).minutes || 0;
    const total = before + sp.minutes;
    const acc = before ? `trabalhado ${fmtDur(before)} + ${fmtDur(sp.minutes)} = ${fmtDur(total)}` : `trabalhado ${fmtDur(total)}`;
    const typed = $("estimate").value.trim();
    if (typed && est.ok && est.minutes !== curEst.minutes) {
      el.textContent = `Estimativa muda de ${fmtDur(curEst.minutes)} para ${fmtDur(est.minutes)} · ${acc}.`;
      el.classList.add(total > est.minutes ? "warn" : "info");
    } else {
      el.textContent = `Estimativa mantida (${fmtDur(curEst.minutes)}) · ${acc}${total > curEst.minutes ? ` · passa ${fmtDur(total - curEst.minutes)}` : ""}.`;
      el.classList.add(total > curEst.minutes ? "warn" : "ok");
    }
    return;
  }
  if (!$("estimate").value.trim() && isSpace(state.mode)) {
    el.textContent = `Estimativa vazia → mantém a de cada subtarefa; só preenche (${fmtDur(sp.minutes)}) onde não tem.`;
    el.classList.add("info");
  } else if (!$("estimate").value.trim()) {
    el.textContent = `Estimativa vazia → será gravada igual ao trabalhado (${fmtDur(sp.minutes)}).`;
    el.classList.add("info");
  } else if (est.ok && est.minutes === sp.minutes) {
    el.textContent = `✓ Estimativa e trabalhado batem (${fmtDur(sp.minutes)}).`;
    el.classList.add("ok");
  } else if (est.ok) {
    el.classList.add("warn");
    const d = Math.abs(sp.minutes - est.minutes);
    el.textContent = sp.minutes > est.minutes
      ? `Trabalhado passa da estimativa em ${fmtDur(d)}.`
      : `Trabalhado fica ${fmtDur(d)} abaixo da estimativa.`;
  } else el.textContent = "";
}

/** O que acontece com a "Data de início" da tarefa com o Dia escolhido. */
function updateStartHint() {
  const ctx = !isSpace(state.mode) ? state.selected : null;
  if (!ctx) return;
  const day = $("startDate").value;
  const cur = (ctx.current.startDate || "").slice(0, 10);
  $("curStart").textContent = !ctx.startField ? "só no apontamento"
    : !cur ? "também vira a data de início da tarefa"
    : day && day < cur ? `data de início vai de ${brDate(cur)} para ${brDate(day)}`
    : `início da tarefa: ${brDate(cur)} (mantido)`;
}

function refreshPreviews() {
  updateStartHint();
  updatePreview("estimate", "prevEstimate");
  updatePreview("spent", "prevSpent");
  updateEstimateMatch();
}

/* ---------- Início / fim do trabalho ---------- */

const hmToMin = (t) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

/** Total que será apontado: no lote, o tempo vale para cada subtarefa marcada. */
function workedTotal() {
  const p = parseDuration($("spent").value);
  if (!p.ok || !p.minutes) return { total: 0, each: 0, n: 0 };
  const n = isSpace(state.mode) ? Math.max(1, space().checked.length) : 1;
  return { total: p.minutes * n, each: p.minutes, n };
}

/**
 * Mantém Começou/Terminou coerentes com o tempo trabalhado:
 *  - modo "end"  : você informa quando terminou (padrão: agora) → começou = terminou − trabalhado
 *  - modo "start": você informa quando começou → terminou = começou + trabalhado
 *  - modo "auto" : a extensão escolhe o 1º horário livre da jornada
 * Tudo dentro da jornada (11:00–17:00): o que passar do fim vai para o próximo dia útil.
 */
function updateTimeHint() {
  const wd = DEF.workday;
  const hint = $("timeHint");
  const mode = state.timeMode;
  const { total, each, n } = workedTotal();
  hint.className = "timeline-hint";

  $("btnAutoTime").classList.toggle("on", mode === "auto");
  $("btnNow").classList.toggle("on", mode === "end" && $("startDate").value === todayISO()
    && $("endTime").value === fmtHM(nowEnd()));
  $("startTime").classList.toggle("calc", mode === "end");
  $("endTime").classList.toggle("calc", mode === "start");

  if (mode === "auto") {
    writeTime("startTime", "");
    writeTime("endTime", "");
    hint.textContent = wd.overflow !== "nextDay"
      ? `Automático: primeiro horário livre na jornada ${fmtHM(wd.start)}–${fmtHM(wd.end)}; se não couber, continua depois das ${fmtHM(wd.end)} no mesmo dia.`
      : `Automático: primeiro horário livre a partir das ${fmtHM(wd.start)} (jornada ${fmtHM(wd.start)}–${fmtHM(wd.end)}).`;
    return;
  }

  // Calcula sempre a partir do que a pessoa informou, não do valor já ajustado no campo.
  const anchor = mode === "end"
    ? (state.endAnchor ?? hmToMin($("endTime").value))
    : (state.startAnchor ?? hmToMin($("startTime").value));
  if (anchor == null) {
    hint.textContent = mode === "end" ? "Informe quando terminou (ou use “agora”)." : "Informe quando começou.";
    return;
  }
  if (!total) {
    if (mode === "end") writeTime("startTime", ""); else writeTime("endTime", "");
    hint.textContent = mode === "end"
      ? `Terminou às ${fmtHM(anchor)} — informe o tempo trabalhado e o início é calculado.`
      : `Começou às ${fmtHM(anchor)} — informe o tempo trabalhado e o fim é calculado.`;
    return;
  }

  const notes = [];
  let start, end;

  if (wd.overflow !== "nextDay") {
    // Mesmo dia: respeita exatamente o horário informado, mesmo fora da jornada.
    if (mode === "end") { end = anchor; start = end - total; }
    else { start = anchor; end = start + total; }
    if (start < 0 || end > 24 * 60) {
      hint.textContent = start < 0
        ? `${fmtDur(total)} terminando às ${fmtHM(end)} começaria no dia anterior. Ajuste o horário ou o tempo.`
        : `${fmtDur(total)} começando às ${fmtHM(start)} passaria da meia-noite. Ajuste o horário ou o tempo.`;
      hint.classList.add("warn");
      writeTime(mode === "end" ? "startTime" : "endTime", "");
      return;
    }
    if (mode === "end") writeTime("startTime", fmtHM(start)); else writeTime("endTime", fmtHM(end));
    hint.innerHTML = "";
    const b1 = document.createElement("b"); b1.textContent = fmtHM(start);
    const b2 = document.createElement("b"); b2.textContent = fmtHM(end);
    hint.append(b1, document.createTextNode(" → "), b2,
      document.createTextNode(` · ${fmtDur(total)}${n > 1 ? ` (${n} × ${fmtDur(each)}, em sequência)` : ""}`));
    if (end > wd.end) notes.push(`passa ${fmtDur(end - Math.max(start, wd.end))} das ${fmtHM(wd.end)}, no mesmo dia`);
    if (start < wd.start) notes.push(`começa ${fmtDur(Math.min(end, wd.start) - start)} antes das ${fmtHM(wd.start)}`);
    if (notes.length) { hint.append(document.createTextNode(` · ${notes.join(" · ")}`)); hint.classList.add("info"); }
    return;
  }

  if (mode === "end") {
    end = anchor;
    if (end > wd.end) { notes.push(`você informou ${fmtHM(end)}; a jornada termina às ${fmtHM(wd.end)}`); end = wd.end; }
    start = end - total;
    if (start < wd.start) {
      // Não cabe entre o início da jornada e o fim informado: começa às 11:00 e o resto transborda.
      start = wd.start;
      end = start + total;
      notes.push(`${fmtDur(total)} terminando às ${fmtHM(anchor > wd.end ? wd.end : anchor)} começaria às ${fmtHM(Math.max(0, (anchor > wd.end ? wd.end : anchor) - total))}, antes da jornada — ajustado para ${fmtHM(wd.start)}`);
    }
    writeTime("startTime", fmtHM(start));
  } else {
    start = anchor;
    if (start < wd.start || start >= wd.end) {
      hint.textContent = `${fmtHM(start)} está fora da jornada (${fmtHM(wd.start)}–${fmtHM(wd.end)}). Ajuste o início ou use “auto”.`;
      hint.classList.add("warn");
      writeTime("endTime", "");
      return;
    }
    end = start + total;
  }
  writeTime("endTime", fmtHM(Math.min(end, wd.end)));
  const spill = Math.max(0, end - wd.end);

  hint.innerHTML = "";
  const b1 = document.createElement("b"); b1.textContent = fmtHM(start);
  const b2 = document.createElement("b"); b2.textContent = fmtHM(Math.min(end, wd.end));
  hint.append(b1, document.createTextNode(" → "), b2,
    document.createTextNode(` · ${fmtDur(total)}${n > 1 ? ` (${n} × ${fmtDur(each)}, em sequência)` : ""}`));
  if (spill) notes.push(`${fmtDur(spill)} vão para o próximo dia útil`);
  if (notes.length) { hint.append(document.createTextNode(` · ${notes.join(" · ")}`)); hint.classList.add("warn"); }
}

function writeTime(id, value) {
  $(id).value = value;
  state.echo[id === "startTime" ? "start" : "end"] = value || null;
}

function setTimeMode(mode) {
  state.timeMode = mode;
  updateTimeHint();
  refreshWorkday({ delay: 0 });
  touch();
}

/* =====================================================================
   Aba Tarefa
   ===================================================================== */

async function findSubtasks() {
  const key = $("parentKey").value.trim();
  if (!key) return toast("Informe a chave da tarefa (ex.: M1653).");
  toast(null);
  busy(true);
  try {
    const tree = await send("LOAD_TREE", { key });
    state.subtasks = tree.subtasks;
    state.parent = tree.parent.isSubtask ? null : tree.parent;
    $("ctxLine").textContent = `${tree.parent.key} · ${tree.parent.summary}`;
    renderSubtasks();
    if (!tree.subtasks.length) {
      showForm(false);
      openCreate("Single", true);
      toast("Sem subtarefas: aplique na própria tarefa (primeiro item) ou crie uma subtarefa.", "info");
    } else if (tree.subtasks.length === 1) {
      busy(false);
      await selectSubtask(tree.subtasks[0].key);
    } else {
      // Várias subtarefas: abre direto a "Testes Manuais" que é sua (se houver só uma)
      const name = String(DEF.subtaskName || "Testes Manuais").toLowerCase();
      const mine = tree.subtasks.filter((s) => s.mine);
      const pick = mine.filter((s) => s.summary.toLowerCase().includes(name));
      const target = pick.length === 1 ? pick[0] : mine.length === 1 ? mine[0] : null;
      if (target) { busy(false); await selectSubtask(target.key); toast(`${target.key} é a sua — já selecionada.`, "info"); }
    }
    touch();
  } catch (e) { toast(e.message); } finally { busy(false); }
}

function renderSubtasks() {
  if (!$("evidenceBody").classList.contains("hidden")) setTimeout(renderEvidenceTargets);
  const box = $("subtaskList");
  box.innerHTML = "";
  const rows = state.parent
    ? [{ ...state.parent, isParent: true }, ...state.subtasks]
    : state.subtasks;
  for (const s of rows) {
    const b = document.createElement("button");
    b.className = "item" + (state.selected?.key === s.key ? " sel" : "");
    b.dataset.key = s.key;
    b.innerHTML = `<span class="radio"></span><span class="k"></span><span class="s"></span><span class="st"></span>`;
    b.querySelector(".k").textContent = s.key;
    b.querySelector(".s").textContent = s.summary;
    b.querySelector(".st").textContent = s.status;
    if (s.mine) {
      const you = document.createElement("span");
      you.className = "tag-you";
      you.textContent = "Você";
      you.title = "Atribuída a você";
      b.querySelector(".s").after(you);
      b.classList.add("mine");
    } else if (s.assignee) {
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = s.assignee.name.split(" ")[0];
      who.title = `Atribuída a ${s.assignee.name}`;
      b.querySelector(".s").after(who);
    } else if (!s.isParent && s.assignee === null) {
      const who = document.createElement("span");
      who.className = "who none";
      who.textContent = "sem responsável";
      b.querySelector(".s").after(who);
    }
    if (s.isParent) {
      const tag = document.createElement("span");
      tag.className = "tag-parent";
      tag.textContent = "pai";
      b.querySelector(".k").after(tag);
      b.title = "Aplicar horas, datas, pontos e status na própria tarefa pai";
    }
    b.append(histLink(s.key, { label: "" }), jiraLink(s.key, { label: "" }));
    b.addEventListener("click", () => selectSubtask(s.key));
    box.appendChild(b);
  }
}

async function selectSubtask(key) {
  busy(true);
  toast(null);
  try {
    const ctx = await send("LOAD_SUBTASK", { key });
    state.selected = ctx;
    applySingleContext(ctx);
    if (!ctx.canEditTimeTracking) toast("Aviso: o controle de tempo não está editável nesta issue.", "info");
    touch();
  } catch (e) { toast(e.message); } finally { busy(false); }
}

const brDate = (d) => d.split("-").reverse().join("/");

function applySingleContext(ctx, override = null, { keepValues = false } = {}) {
  $("targetLine").innerHTML = "";
  const b = document.createElement("b");
  b.textContent = ctx.key;
  const sum = document.createElement("span");
  sum.className = "tl-sum";
  sum.textContent = ` · ${ctx.summary}`;
  $("targetLine").append(b, sum, jiraLink(ctx.key, { label: "Abrir no Jira" }));

  $("curDue").textContent = ctx.current.dueDate ? `atual ${brDate(ctx.current.dueDate)}` : "";
  updateStartHint();
  $("curStatus").textContent = `atual: ${ctx.status}`;

  const sel = $("statusSel");
  const prevStatus = sel.value;
  sel.innerHTML = `<option value="">Não alterar</option>`;
  for (const t of ctx.transitions) {
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = t.to && t.to !== t.name ? `${t.name} → ${t.to}` : t.name;
    o.dataset.name = t.to || t.name;
    o.dataset.cat = t.toCategory || "";
    sel.appendChild(o);
  }

  if (override) setFormValues(override);
  else if (keepValues) { sel.value = prevStatus; setFormValues({}); }
  else setFormValues({
    ...blankForm(),                      // dia = hoje, terminou = agora
    dueDate: ctx.current.dueDate || "",
    estimate: ctx.current.originalEstimate || "",
  });

  $("btnApply").textContent = state.parent && ctx.key === state.parent.key ? "Aplicar na tarefa" : "Aplicar na subtarefa";
  $("btnApply").disabled = false;
  showForm(true);
  document.querySelectorAll("#subtaskList .item").forEach((el) => el.classList.toggle("sel", el.dataset.key === ctx.key));
  refreshWorkday({ delay: 0 });
}

/* ---------- criação ---------- */

function openCreate(which, open) {
  $(`create${which}Body`).classList.toggle("hidden", !open);
  if (open) $(which === "Single" ? "newSubtaskName" : "newSubtaskNameBatch").focus();
}
$("btnShowCreateSingle").addEventListener("click", () => openCreate("Single", $("createSingleBody").classList.contains("hidden")));
$("btnShowCreateBatch").addEventListener("click", () => openCreate("Batch", $("createBatchBody").classList.contains("hidden")));

async function createSingleSubtask() {
  const parentKey = $("parentKey").value.trim();
  if (!parentKey) return toast("Informe a chave da tarefa pai (ex.: M1653).");
  busy(true);
  try {
    const res = await send("CREATE_SUBTASK", {
      parentKey,
      summary: $("newSubtaskName").value.trim(),
      assignToMe: $("assignSelfSingle").checked,
      skipIfExists: $("skipDupSingle").checked,
    });
    openCreate("Single", false);
    busy(false);
    await findSubtasks();
    await selectSubtask(res.key);
    toast(`${res.key} ${res.created ? "criada" : "já existia"} — ${res.detail}`, "ok");
  } catch (e) { toast(e.message); } finally { busy(false); }
}

async function createBatchSubtasks() {
  const sp = space();
  const keys = sp.source === "board" && sp.board.issues.length ? sp.board.checked : parseKeyList($("batchKeys").value);
  if (!keys.length) return toast("Selecione ou digite ao menos uma tarefa pai.");
  busy(true);
  $("batchProgress").classList.remove("hidden");
  try {
    const res = await send("CREATE_SUBTASKS_BATCH", {
      parentKeys: keys,
      summary: $("newSubtaskNameBatch").value.trim(),
      assignToMe: $("assignSelfBatch").checked,
      skipIfExists: $("skipDupBatch").checked,
    });
    openCreate("Batch", false);
    const fresh = new Set(res.results.filter((r) => r.ok && r.key).map((r) => r.key));
    busy(false);
    await resolveBatch(keys);
    renderCreateResult(res);
    if (fresh.size) { sp.checked = sp.targets.filter((t) => fresh.has(t.key)).map((t) => t.key); renderBatchList(); touch(); }
  } catch (e) { toast(e.message); } finally { busy(false); $("batchProgress").classList.add("hidden"); }
}

/* =====================================================================
   Aba Lote (espaços MEED e SUS)
   ===================================================================== */

function saveSpaceFromUI(id) {
  const sp = state.spaces[id];
  if (!sp) return;
  sp.columns = $("statusColumns").value || sp.columns;
  sp.onlyMine = $("onlyMineBoard").checked;
  sp.excludeSub = $("excludeSubBoard").checked;
  sp.keysText = $("batchKeys").value;
  sp.form = formValues();
}

function loadSpaceToUI(id) {
  const sp = state.spaces[id];
  $("statusColumns").value = "";
  $("statusColumns").placeholder = sp.columns ? `Status, ex.: ${sp.columns}` : "Status, ex.: Validação, Deploy";
  $("onlyMineBoard").checked = !!sp.onlyMine;
  $("excludeSubBoard").checked = sp.excludeSub !== false;
  $("batchKeys").value = sp.keysText || "";
  setSource(sp.source || "board", { silent: true });
  setLevel(sp.level || "sub", { silent: true });
  document.querySelectorAll("#spaceSeg button").forEach((b) => b.classList.toggle("on", b.dataset.space === id));
  renderBoardOptions(sp.boardId);
  renderColumnPills();
  renderBoardList();
  renderBatchList();
  $("boardInfo").textContent = "";
  $("boardBox").classList.toggle("hidden", !sp.board.issues.length);
  if (sp.targets.length) prepareBatchForm(sp.form);
  else showForm(false);
}

/* ---------- espaço (MEED / SUS) e nível (subtarefas / tarefas pai) ---------- */

function setSpace(id) {
  if (id === state.spaceId) return;
  saveSpaceFromUI(state.spaceId);
  state.spaceId = id;
  document.querySelectorAll("#spaceSeg button").forEach((b) => b.classList.toggle("on", b.dataset.space === id));
  $("result").classList.add("hidden");
  loadSpaceToUI(id);
  const sp = space();
  if (sp.boardId && !sp.boardColumns.length) loadBoardColumns(sp.boardId, { silent: true });
  touch();
}
document.querySelectorAll("#spaceSeg button").forEach((b) => b.addEventListener("click", () => setSpace(b.dataset.space)));

function setLevel(level, { silent = false } = {}) {
  const sp = space();
  const changed = sp.level !== level;
  sp.level = level;
  document.querySelectorAll("#levelSeg button").forEach((b) => b.classList.toggle("on", b.dataset.level === level));
  const parent = level === "parent";
  $("levelHint").textContent = parent
    ? "As próprias tarefas selecionadas recebem horas, datas, pontos e status."
    : "As subtarefas de cada tarefa selecionada.";
  $("createBatch").classList.toggle("hidden", parent);
  if (!silent) updateBoardCount();
  if (changed && !silent) {
    // Trocar de nível invalida a lista carregada: o alvo é outro conjunto de issues.
    sp.targets = []; sp.checked = []; sp.statuses = [];
    renderBatchList();
    showForm(false);
    const keys = sp.source === "board" ? sp.board.checked : parseKeyList($("batchKeys").value);
    if (keys.length) resolveBatch();
    touch();
  }
}
document.querySelectorAll("#levelSeg button").forEach((b) => b.addEventListener("click", () => setLevel(b.dataset.level)));

function setSource(src, { silent = false } = {}) {
  const sp = space();
  sp.source = src;
  document.querySelectorAll("#sourceSeg button").forEach((b) => b.classList.toggle("on", b.dataset.src === src));
  $("srcBoard").classList.toggle("hidden", src !== "board");
  $("srcManual").classList.toggle("hidden", src !== "manual");
  if (!silent) touch();
}
document.querySelectorAll("#sourceSeg button").forEach((b) => b.addEventListener("click", () => setSource(b.dataset.src)));

/* ---------- quadros ---------- */

let boardsCache = null;

function renderBoardOptions(selectedId) {
  const sel = $("boardSel");
  sel.innerHTML = `<option value="">Sem quadro — buscar por status</option>`;
  for (const b of boardsCache || []) {
    const o = document.createElement("option");
    o.value = String(b.id);
    o.textContent = b.projectKey ? `${b.name} · ${b.projectKey}` : b.name;
    sel.appendChild(o);
  }
  sel.value = selectedId ? String(selectedId) : "";
  $("manualStatusBox").classList.toggle("hidden", !!sel.value);
}

async function initBoards({ force = false } = {}) {
  const sel = $("boardSel");
  try {
    sel.disabled = true;
    if (!boardsCache || force) boardsCache = await send("LIST_BOARDS");
    if (isSpace(state.mode)) {
      renderBoardOptions(space().boardId);
      if (space().boardId) await loadBoardColumns(space().boardId, { silent: true });
    }
  } catch (e) {
    sel.innerHTML = `<option value="">Sem quadro — buscar por status</option>`;
    $("boardInfo").textContent = `Não consegui listar quadros: ${e.message}`;
  } finally { sel.disabled = false; }
}

async function loadBoardColumns(boardId, { silent = false } = {}) {
  const sp = space();
  if (!boardId) { sp.boardColumns = []; sp.pickedColumns = []; renderColumnPills(); return; }
  try {
    if (!silent) $("boardInfo").textContent = "Lendo colunas do quadro…";
    const conf = await send("BOARD_COLUMNS", { boardId });
    sp.boardColumns = conf.columns;
    const fromCfg = parseColumns(sp.columns).map((x) => x.toLowerCase());
    const valid = new Set(conf.columns.map((c) => c.name.toLowerCase()));
    const keep = sp.pickedColumns.filter((n) => valid.has(n.toLowerCase()));
    sp.pickedColumns = keep.length ? keep : conf.columns.filter((c) => fromCfg.includes(c.name.toLowerCase())).map((c) => c.name);
    renderColumnPills();
    if (!silent) $("boardInfo").textContent = `Marque as colunas de "${conf.name}" e busque.`;
  } catch (e) { sp.boardColumns = []; renderColumnPills(); $("boardInfo").textContent = e.message; }
}

function renderColumnPills() {
  const sp = space();
  const box = $("colsList");
  box.innerHTML = "";
  box.classList.toggle("hidden", !sp.boardColumns.length);
  $("manualStatusBox").classList.toggle("hidden", !!sp.boardId);
  const picked = new Set(sp.pickedColumns.map((n) => n.toLowerCase()));
  for (const c of sp.boardColumns) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pill" + (picked.has(c.name.toLowerCase()) ? " on" : "");
    b.textContent = c.name;
    if (!c.statusIds.length) b.title = "Coluna sem status mapeado";
    b.addEventListener("click", () => {
      const set = new Set(sp.pickedColumns);
      set.has(c.name) ? set.delete(c.name) : set.add(c.name);
      sp.pickedColumns = [...set];
      renderColumnPills();
      touch();
    });
    box.appendChild(b);
  }
}

$("boardSel").addEventListener("change", async () => {
  const sp = space();
  sp.boardId = $("boardSel").value || "";
  sp.pickedColumns = [];
  await loadBoardColumns(sp.boardId);
  if (sp.boardId) send("SAVE_BOARD", { space: state.spaceId, boardId: sp.boardId }).catch(() => {});
  touch();
});
$("btnReloadBoards").addEventListener("click", () => initBoards({ force: true }));

async function loadFromBoard() {
  const sp = space();
  sp.boardId = $("boardSel").value || "";
  if (sp.boardId && !sp.pickedColumns.length) return toast("Marque ao menos uma coluna do quadro.");
  const statuses = parseColumns($("statusColumns").value || sp.columns);
  if (!sp.boardId && !statuses.length) return toast("Selecione um quadro ou informe os status.");

  busy(true);
  $("boardInfo").textContent = "Buscando…";
  try {
    const res = await send("SEARCH_COLUMNS", {
      boardId: sp.boardId || null,
      columns: sp.pickedColumns,
      statuses,
      projects: sp.project ? [sp.project] : [],
      onlyMine: $("onlyMineBoard").checked,
      excludeSubtasks: $("excludeSubBoard").checked,
    });
    sp.board = { issues: res.issues, checked: res.issues.map((i) => i.key), statuses: res.statuses, me: res.me };
    sp.me = res.me;
    $("boardInfo").textContent = res.issues.length
      ? ""
      : res.hint?.length
        ? `Nada encontrado. Esse nome parece de coluna, não de status — selecione o quadro. Status parecidos: ${res.hint.join(", ")}.`
        : `Nenhuma tarefa em ${res.statuses.join(" / ")}.`;
    renderBoardList();
    $("boardBox").classList.toggle("hidden", !res.issues.length);
    touch();
  } catch (e) { $("boardInfo").textContent = ""; toast(e.message); } finally { busy(false); }
}

function renderBoardList() {
  const sp = space();
  const box = $("boardList");
  box.innerHTML = "";
  if (!sp.board.issues.length) return;
  const checked = new Set(sp.board.checked);
  let lastStatus = null;
  for (const i of sp.board.issues) {
    if (i.status !== lastStatus) {
      lastStatus = i.status;
      const h = document.createElement("div");
      h.className = "group";
      h.textContent = i.status;
      box.appendChild(h);
    }
    const row = document.createElement("label");
    row.className = "item" + (checked.has(i.key) ? " sel" : "");
    row.innerHTML = `<input type="checkbox" /><span class="k"></span><span class="s"></span><span class="st"></span>`;
    const cb = row.querySelector("input");
    cb.checked = checked.has(i.key);
    cb.addEventListener("change", () => {
      const set = new Set(sp.board.checked);
      cb.checked ? set.add(i.key) : set.delete(i.key);
      sp.board.checked = [...set];
      row.classList.toggle("sel", cb.checked);
      updateBoardCount();
      touch();
    });
    row.querySelector(".k").textContent = i.key;
    row.querySelector(".s").textContent = i.summary;
    row.querySelector(".st").textContent = i.assignee || "sem responsável";
    row.append(histLink(i.key, { label: "" }), jiraLink(i.key, { label: "" }));
    box.appendChild(row);
  }
  updateBoardCount();
}

function updateBoardCount() {
  const sp = space();
  const n = sp.board.checked.length;
  $("boardCount").textContent = `${n} de ${sp.board.issues.length} selecionadas`;
  const parent = space().level === "parent";
  $("btnUseSelected").textContent = !n ? "Selecione tarefas"
    : parent ? `Usar ${n} tarefa${n === 1 ? "" : "s"} selecionada${n === 1 ? "" : "s"}`
    : `Carregar subtarefas de ${n} tarefa${n === 1 ? "" : "s"}`;
  $("btnUseSelected").disabled = !n;
}

function pickBoard(mode) {
  const sp = space();
  if (mode === "all") sp.board.checked = sp.board.issues.map((i) => i.key);
  else if (mode === "none") sp.board.checked = [];
  else {
    sp.board.checked = sp.board.issues.filter((i) => i.assigneeId && i.assigneeId === sp.board.me?.accountId).map((i) => i.key);
    if (!sp.board.checked.length) toast("Nenhuma dessas tarefas está atribuída a você.", "info");
  }
  renderBoardList();
  touch();
}

/* ---------- subtarefas do lote ---------- */

async function resolveBatch(keysOverride = null) {
  const sp = space();
  const keys = keysOverride || (sp.source === "board" ? sp.board.checked : parseKeyList($("batchKeys").value));
  if (!keys.length) return toast("Selecione tarefas no quadro ou digite as chaves.");
  busy(true);
  $("batchProgress").classList.remove("hidden");
  try {
    const data = await send("RESOLVE_BATCH", { keys, level: sp.level || "sub" });
    sp.targets = data.targets;
    sp.statuses = data.statuses;
    sp.me = data.me;
    const mine = data.targets.filter((t) => t.assigneeId && t.assigneeId === data.me.accountId);
    sp.checked = (mine.length ? mine : data.targets).map((t) => t.key);
    renderBatchErrors(data.errors);
    renderBatchList();
    if (!data.targets.length) {
      showForm(false);
      openCreate("Batch", true);
      toast(sp.level === "parent" ? "Nenhuma tarefa carregada." : "Nenhuma subtarefa encontrada — crie em lote abaixo ou use “Tarefas pai”.", "info");
    } else {
      prepareBatchForm();
      $("stepSubs").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    touch();
  } catch (e) { toast(e.message); } finally { busy(false); $("batchProgress").classList.add("hidden"); }
}

function renderBatchList() {
  const sp = space();
  const box = $("batchList");
  box.innerHTML = "";
  const checked = new Set(sp.checked);
  let lastParent = null;
  for (const t of sp.targets) {
    if (t.parentKey && t.parentKey !== lastParent) {
      lastParent = t.parentKey;
      const h = document.createElement("div");
      h.className = "group";
      h.textContent = `${t.parentKey}${t.parentSummary ? ` · ${t.parentSummary}` : ""}`;
      box.appendChild(h);
    }
    const row = document.createElement("label");
    row.className = "item" + (checked.has(t.key) ? " sel" : "");
    row.innerHTML = `<input type="checkbox" /><span class="k"></span><span class="s"></span><span class="st"></span>`;
    const cb = row.querySelector("input");
    cb.checked = checked.has(t.key);
    cb.addEventListener("change", () => {
      const set = new Set(sp.checked);
      cb.checked ? set.add(t.key) : set.delete(t.key);
      sp.checked = [...set];
      row.classList.toggle("sel", cb.checked);
      updateBatchCount();
      updateTimeHint();
      refreshWorkday();
      touch();
    });
    row.querySelector(".k").textContent = t.key;
    row.querySelector(".s").textContent = t.summary;
    row.querySelector(".st").textContent = t.status;
    row.title = t.assigneeName ? `Responsável: ${t.assigneeName}` : "Sem responsável";
    row.append(histLink(t.key, { label: "" }), jiraLink(t.key, { label: "" }));
    box.appendChild(row);
  }
  updateBatchCount();
}

function renderBatchErrors(errors) {
  const box = $("batchErrors");
  box.innerHTML = "";
  if (!errors?.length) return box.classList.add("hidden");
  for (const e of errors) { const d = document.createElement("div"); d.textContent = `${e.key}: ${e.error}`; box.appendChild(d); }
  box.classList.remove("hidden");
}

function updateBatchCount() {
  const sp = space();
  const n = sp.checked.length;
  const noun = sp.level === "parent" ? ["tarefa", "tarefas"] : ["subtarefa", "subtarefas"];
  $("batchCount").textContent = sp.targets.length
    ? `${n} de ${sp.targets.length} ${noun[1]} selecionadas`
    : sp.level === "parent" ? "Escolha as tarefas acima." : "Escolha as tarefas acima e carregue as subtarefas.";
  if (isSpace(state.mode)) {
    $("btnApply").textContent = n ? `Aplicar em ${n} ${n === 1 ? noun[0] : noun[1]}` : `Selecione ${noun[1]}`;
    $("btnApply").disabled = !n;
  }
}

function prepareBatchForm(override = null) {
  const sp = space();
  $("targetLine").innerHTML = "";
  const b = document.createElement("b");
  b.textContent = `Lote ${SPACE_LABEL[state.spaceId]}`;
  $("targetLine").append(b, document.createTextNode(
    sp.level === "parent" ? " · os mesmos valores em todas as tarefas marcadas" : " · os mesmos valores em todas as subtarefas marcadas"));

  const total = sp.targets.length;
  const withStart = sp.targets.filter((t) => t.startField).length;
  $("curDue").textContent = "sobrescreve o atual";
  const emptyStart = sp.targets.filter((t) => t.startField && !t.current?.startDate).length;
  $("curStart").textContent = emptyStart ? `vira data de início em ${emptyStart} sem data` : "datas de início mantidas";

  const sel = $("statusSel");
  sel.innerHTML = `<option value="">Não alterar</option>`;
  for (const s of sp.statuses) {
    const o = document.createElement("option");
    o.value = s.name;
    o.textContent = s.count === total ? s.name : `${s.name} (${s.count} de ${total})`;
    sel.appendChild(o);
  }
  $("curStatus").textContent = "resolvido issue a issue, pelo nome";

  setFormValues(override && Object.keys(override).length
    ? { ...(override.timeMode ? {} : defaultEnd()), ...override }   // rascunho antigo, sem início/fim
    : blankForm());
  showForm(true);
  updateBatchCount();
  refreshWorkday({ delay: 0 });
}

/* =====================================================================
   Jornada no formulário (prévia do que será apontado)
   ===================================================================== */

function workdayKeys() {
  if (isSpace(state.mode)) return space().checked;
  return state.selected ? [state.selected.key] : [];
}

let wdTimer = null, wdSeq = 0;
function refreshWorkday({ force = false, delay = 450 } = {}) {
  clearTimeout(wdTimer);
  wdTimer = setTimeout(async () => {
    if ($("formCard").classList.contains("hidden")) return;
    const seq = ++wdSeq;
    const raw = $("spent").value.trim();
    if (!parseDuration(raw).ok) return;
    try {
      const plan = await send("PLAN_PREVIEW", {
        startDate: $("startDate").value || todayISO(),
        startTime: $("startTime").value || "",
        timeSpent: raw,
        keys: workdayKeys(),
        force,
      });
      if (seq === wdSeq) renderWorkday(plan);
    } catch (e) {
      if (seq !== wdSeq) return;
      const box = $("workdayBox");
      box.innerHTML = "";
      note(box, "err", e.message);
      box.classList.remove("hidden");
    }
  }, delay);
}

/** Barra de meta: já apontado + este lançamento, com marcador da meta. */
function meter({ before, add, cap, goal, doneColor = false }) {
  const m = document.createElement("div");
  m.className = "meter";
  const fill = document.createElement("div");
  fill.className = "fill";
  fill.style.width = `${Math.min(100, ((before + add) / cap) * 100)}%`;
  const total = before + add || 1;
  const o = document.createElement("i");
  o.className = doneColor && before >= goal ? "done" : doneColor ? "new" : "old";
  o.style.width = `${(before / total) * 100}%`;
  const n = document.createElement("i");
  n.className = "new";
  n.style.width = `${(add / total) * 100}%`;
  fill.append(o, n);
  const g = document.createElement("span");
  g.className = "goal";
  g.style.left = `${(goal / cap) * 100}%`;
  g.dataset.label = `meta ${fmtDur(goal)}`;
  m.append(fill, g);
  return m;
}

/** Linha do tempo da janela com segmentos e marcações de hora. */
function track(wd, segs) {
  // A régua cobre a jornada e se estende para mostrar o que ficou antes/depois dela
  // (ex.: 17:00–18:30 no mesmo dia). A parte fora da jornada aparece hachurada.
  const segMin = Math.min(wd.start, ...segs.map((s) => s.start));
  const segMax = Math.max(wd.end, ...segs.map((s) => s.start + s.minutes));
  const lo = Math.max(0, Math.floor(segMin / 60) * 60);
  const hi = Math.min(24 * 60, Math.ceil(segMax / 60) * 60);
  const span = hi - lo;
  const pct = (m) => `${((m - lo) / span) * 100}%`;

  const t = document.createElement("div");
  t.className = "track";
  for (const [a, b] of [[lo, wd.start], [wd.end, hi]]) {
    if (b <= a) continue;
    const off = document.createElement("span");
    off.className = a === lo ? "off pre" : "off post";
    off.style.left = pct(a);
    off.style.width = `${((b - a) / span) * 100}%`;
    off.title = "fora da jornada";
    t.appendChild(off);
  }
  for (let h = lo + 60; h < hi; h += 60) {
    const hr = document.createElement("span");
    hr.className = "hr";
    hr.style.left = pct(h);
    t.appendChild(hr);
  }
  let outside = 0;
  for (const s of segs) {
    const a = s.start, b = s.start + s.minutes;
    outside += Math.max(0, Math.min(b, wd.start) - a) + Math.max(0, b - Math.max(a, wd.end));
    const el = document.createElement("span");
    el.className = `seg ${s.cls || ""}`;
    if (s.color) el.style.background = s.color;
    el.style.left = pct(Math.max(a, lo));
    el.style.width = `${((Math.min(b, hi) - Math.max(a, lo)) / span) * 100}%`;
    el.title = s.title || "";
    t.appendChild(el);
  }
  const scale = document.createElement("div");
  scale.className = "scale";
  const step = span > 10 * 60 ? 120 : 60;
  for (let h = lo; h <= hi; h += step) {
    const sp = document.createElement("span");
    sp.textContent = `${Math.floor(h / 60)}h`;
    sp.style.left = pct(h);
    if (h === lo) sp.className = "first";
    else if (h + step > hi) sp.className = "last";
    if (h < wd.start || h > wd.end) sp.classList.add("off");
    scale.appendChild(sp);
  }
  return { track: t, scale, outside, lo, hi };
}

function note(box, kind, text) {
  const p = document.createElement("div");
  p.className = `wd-note ${kind}`;
  p.textContent = text;
  box.appendChild(p);
}

function legend(items) {
  const lg = document.createElement("div");
  lg.className = "legend";
  for (const [color, label] of items) {
    const s = document.createElement("span");
    const i = document.createElement("i");
    i.style.background = color;
    s.append(i, document.createTextNode(label));
    lg.appendChild(s);
  }
  return lg;
}

function renderWorkday(plan) {
  const box = $("workdayBox");
  box.innerHTML = "";
  const wd = { start: plan.workday.start, end: plan.workday.end };
  const cap = plan.workday.capMinutes;
  const goal = DEF.workday.goal;

  for (const d of plan.days.slice(0, 4)) {
    const head = document.createElement("div");
    head.className = "wd-head";
    head.innerHTML = `<b></b><span></span>`;
    head.querySelector("b").textContent = dayShort(d.date) + (d.date === todayISO() ? " · hoje" : "");
    head.querySelector("span").textContent = d.planned
      ? `${fmtDur(d.usedBefore)} + ${fmtDur(d.planned)} = ${fmtDur(d.total)} de ${fmtDur(cap)}`
      : `${fmtDur(d.usedBefore)} de ${fmtDur(cap)}`;
    box.appendChild(head);
    box.appendChild(meter({ before: d.usedBefore, add: d.planned, cap, goal }));

    const segs = [
      ...d.existing.map((x) => ({ start: x.start, minutes: x.minutes, cls: "old", title: `${x.key} · ${fmtHM(x.start)}–${fmtHM(x.start + x.minutes)} (já apontado)` })),
      ...d.plannedSlots.map((x) => ({ start: x.start, minutes: x.minutes, cls: "new", title: `${x.key} · ${fmtHM(x.start)}–${fmtHM(x.end)} (novo)` })),
    ];
    const tr = track(wd, segs);
    if (MTG_ON) attachMeetings(tr, { date: d.date, now: d.date === todayISO() ? nowMin() : null, onChange: rerenderMeetings });   // marcar reunião também aqui
    box.append(tr.track, tr.scale);
    if (tr.outside) note(box, "info", `${fmtDur(tr.outside)} fora da jornada ${fmtHM(wd.start)}–${fmtHM(wd.end)} neste dia (mesmo dia, contam no teto).`);
  }

  box.appendChild(legend([["#7f8ea3", "já apontado"], ["var(--accent)", "este lançamento"], ["var(--warn)", "meta"]]));

  const withChunks = plan.items.filter((i) => i.chunks.length);
  if (withChunks.length) {
    const det = document.createElement("details");
    det.className = "wd-plan";
    det.open = withChunks.length <= 2;
    const s = document.createElement("summary");
    s.textContent = `Horários que serão apontados (${withChunks.length})`;
    det.appendChild(s);
    for (const it of withChunks) {
      const r = document.createElement("div");
      r.textContent = `${it.key}  ${it.chunks.map((c) => `${dayShort(c.date)} ${fmtHM(c.start)}–${fmtHM(c.end)}`).join(" + ")}`;
      det.appendChild(r);
    }
    box.appendChild(det);
  }
  if (plan.shifted) note(box, "warn", plan.shifted);
  if (plan.spills) note(box, "warn", "O dia não comporta tudo: o restante vai para o próximo dia útil.");
  if (plan.overCap) note(box, "warn", `Passa ${fmtDur(plan.overCap)} do teto de ${fmtDur(cap)} — permitido, fica tudo no mesmo dia.`);
  if (plan.unplaced) note(box, "err", plan.workday.overflow === "sameDay"
    ? `${fmtDur(plan.unplaced)} passariam da meia-noite — ajuste o horário ou o tempo.`
    : `Faltam ${fmtDur(plan.unplaced)} de espaço nos próximos 30 dias — reduza o tempo ou a seleção.`);
  if (plan.busyError) note(box, "warn", `Não consegui ler seus apontamentos (${plan.busyError}); pode haver sobreposição.`);

  box.classList.remove("hidden");
}

/* =====================================================================
   Painel: demandas atribuídas a mim
   ===================================================================== */

const CAT_COLORS = { new: ["#8c9bab", "#6b7a8c", "#a8b5c2"], indeterminate: ["#579dff", "#9f8fef", "#6cc3e0", "#fea362", "#e774bb"], done: ["#4bce97"] };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

async function loadPanel({ force = false } = {}) {
  loadSprints({ force });   // em paralelo; falha nas sprints não derruba o painel
  const P = state.panel;
  if (!P.restored) {
    P.restored = true;
    try { Object.assign(P, JSON.parse(localStorage.getItem("qf.panel") || "{}")); } catch { /* sem storage */ }
    $("panelSearch").value = P.q || "";
    if (!P.data) {
      try { const { panelData } = await chrome.storage.local.get({ panelData: null }); if (panelData?.issues) P.data = panelData; } catch { /* sem cache */ }
    }
  }
  if (P.data) renderPanel();
  else $("panelBox").innerHTML = `<p class="muted xs">Carregando suas demandas…</p>`;
  // Sempre atualiza ao abrir (o que já estava aparece na hora)
  force = force || takeFresh("panel");
  if (!force && P.data && Date.now() - (P.data.fetchedAt || 0) < 45 * 1000) return;
  if (canSkipFetch(P.data, force)) return;
  $("panelInfo").textContent = "atualizando…";
  try {
    const data = await send("MY_DASHBOARD", {});
    data.fetchedAt = Date.now();
    P.data = data;
    chrome.storage.local.set({ panelData: data }).catch(() => {});
    renderPanel();
  } catch (e) {
    if (!P.data) { $("panelBox").innerHTML = ""; note($("panelBox"), "err", e.message); }
    else toast(e.message);
  }
}

/* ---------- Sprints de cada espaço ---------- */

const sprintOf = new Map();   // chave da demanda -> { space, name, end }

/** Dias úteis de hoje até a data (inclusive); negativo se já passou. */
function businessDaysUntil(from, to) {
  if (!to) return null;
  if (to < from) return -1;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (![0, 6].includes(dow(d))) n++;
  return n;
}

async function loadSprints({ force = false } = {}) {
  try {
    const info = await send("SPRINT_INFO", { force });
    state.sprints = info;
    sprintOf.clear();
    for (const sp of info.spaces) for (const a of sp.active || []) for (const k of a.keys || []) {
      sprintOf.set(k, { space: sp.label, name: a.name, end: a.end });
    }
    renderSprints();
    if (state.panel.data) renderPanel();   // as linhas ganham a etiqueta da sprint
  } catch (e) {
    $("sprintBox").innerHTML = "";
    note($("sprintBox"), "warn", `Sprints indisponíveis: ${e.message}`);
  }
}

function renderSprints() {
  const box = $("sprintBox");
  box.innerHTML = "";
  const info = state.sprints;
  if (!info) return;
  for (const sp of info.spaces) {
    if (gspace.project && sp.project !== gspace.project) continue;
    const card = document.createElement("div");
    card.className = "sprint";
    const top = document.createElement("div");
    top.className = "sp-top";
    const tag = document.createElement("span");
    tag.className = "sp-space";
    tag.textContent = sp.label;
    top.appendChild(tag);
    card.appendChild(top);

    if (sp.error) {
      const e = document.createElement("div");
      e.className = "sp-err";
      e.textContent = sp.error;
      card.appendChild(e);
      box.appendChild(card);
      continue;
    }
    const a = sp.active?.[0];
    if (!a) {
      const nm = document.createElement("span");
      nm.className = "sp-name";
      nm.textContent = "Sem sprint ativa";
      top.appendChild(nm);
    } else {
      const nm = document.createElement("span");
      nm.className = "sp-name";
      nm.textContent = a.name;
      nm.title = a.goal ? `Objetivo: ${a.goal}` : a.name;
      const left = document.createElement("span");
      const bd = businessDaysUntil(info.today, a.end);
      left.className = "sp-left " + (bd == null ? "ok" : bd < 0 ? "err" : bd <= 2 ? "warn" : "ok");
      left.textContent = bd == null ? "sem data" : bd < 0 ? "vencida" : bd === 1 ? (a.end === info.today ? "termina hoje" : "1 dia útil") : `${bd} dias úteis`;
      top.append(nm, left);

      const dates = document.createElement("div");
      dates.className = "sp-dates";
      dates.innerHTML = "<span></span><span></span>";
      dates.firstChild.textContent = a.start ? `início ${brDate(a.start).slice(0, 5)}` : "";
      dates.lastChild.textContent = a.end ? `fim ${brDate(a.end).slice(0, 5)}` : "";
      card.appendChild(dates);

      // Tempo decorrido da sprint
      if (a.start && a.end) {
        const span = Math.max(1, daysBetween(a.start, a.end));
        const gone = Math.min(span, Math.max(0, daysBetween(a.start, info.today)));
        const t = document.createElement("div");
        t.className = "sp-time";
        t.title = `${Math.round((gone / span) * 100)}% do tempo da sprint`;
        const i = document.createElement("i");
        i.style.width = `${(gone / span) * 100}%`;
        t.appendChild(i);
        card.appendChild(t);
      }

      // Andamento dos itens
      const st = a.stats || { total: 0 };
      if (st.total) {
        const w = document.createElement("div");
        w.className = "sp-work";
        for (const [cls, n, lbl] of [["d", st.done, "concluídos"], ["p", st.doing, "em andamento"], ["t", st.todo, "a fazer"]]) {
          if (!n) continue;
          const i = document.createElement("i");
          i.className = cls;
          i.style.flex = String(n);
          i.title = `${n} ${lbl}`;
          w.appendChild(i);
        }
        card.appendChild(w);
        const m = document.createElement("div");
        m.className = "sp-meta";
        m.innerHTML = "<span><b></b> de <b></b> concluídos</span><span></span>";
        m.querySelectorAll("b")[0].textContent = st.done;
        m.querySelectorAll("b")[1].textContent = st.total;
        m.lastChild.textContent = st.mine ? `seus: ${st.mineDone}/${st.mine}` : "nenhum seu";
        card.appendChild(m);
      }
    }
    if (sp.next) {
      const n = document.createElement("div");
      n.className = "sp-next";
      n.textContent = `Próxima: ${sp.next.name}${sp.next.start ? ` · ${brDate(sp.next.start).slice(0, 5)}` : ""}${sp.next.end ? ` → ${brDate(sp.next.end).slice(0, 5)}` : ""}`;
      card.appendChild(n);
    }
    box.appendChild(card);
  }
}

/** Filtros de escopo (projeto/tipo) — base dos indicadores. */
function panelScoped() {
  const { type } = state.panel;
  const project = gspace.project;
  return (state.panel.data?.issues || []).filter((i) =>
    (!project || i.project === project) &&
    (type === "all" || (type === "sub" ? i.isSubtask : !i.isSubtask)));
}

/** Escopo + filtros de detalhe (busca, status, indicador clicado). */
/** Escopo + filtros de detalhe (atalho, busca, status, indicador clicado). */
function panelFiltered(scoped) {
  const { q, status, kpi, quick } = state.panel;
  const term = (q || "").trim().toLowerCase();
  const tests = String(DEF.subtaskName || "Testes Manuais").toLowerCase();
  return scoped.filter((i) =>
    (!term || i.key.toLowerCase().includes(term) || i.summary.toLowerCase().includes(term) || (i.parentKey || "").toLowerCase().includes(term)) &&
    (!status || i.status === status) &&
    (quick !== "doing" || i.statusCategory === "indeterminate") &&
    (quick !== "todo" || i.statusCategory === "new") &&
    (quick !== "tests" || (i.isSubtask && i.summary.toLowerCase().includes(tests))) &&
    (quick !== "moved" || movedInPeriod(i)) &&
    (kpi !== "overdue" || i.overdue) &&
    (kpi !== "due" || dueInPeriod(i)) &&
    (kpi !== "nodue" || !i.due));
}

/* ---------- Período do QA (Hoje · 7 · 14 · 30 dias) ---------- */

const QP = { period: "7" };
try { QP.period = localStorage.getItem("qf.qaPeriod") || "7"; } catch { /* sem storage */ }
const QP_LABEL = { today: "hoje", yesterday: "ontem", 7: "em 7 dias", 14: "em 14 dias", 30: "em 30 dias" };
const qpDays = () => (QP.period === "today" || QP.period === "yesterday" ? 1 : Number(QP.period));
/** "Ontem" = o dia útil anterior (na segunda, a sexta). */
const qpYesterday = () => businessStep(todayISO(), -1);
/** Intervalo do período escolhido (ms). Ontem é só aquele dia; os outros vão até agora. */
function qpRange() {
  if (QP.period === "yesterday") { const y = qpYesterday(); return { from: Date.parse(`${y}T00:00:00`), to: Date.parse(`${y}T23:59:59.999`) }; }
  return { from: Date.parse(`${addDaysIso(todayISO(), -(qpDays() - 1))}T00:00:00`), to: Infinity };
}
const qpFrom = () => qpRange().from;
const inQp = (ms) => { const r = qpRange(); return !!ms && ms >= r.from && ms <= r.to; };
/** Vence dentro do período, contando a partir de hoje (Hoje e Ontem = vence hoje). */
const dueInPeriod = (i) => !!i.due && i.due >= todayISO() && i.due <= addDaysIso(todayISO(), qpDays() - 1);
/** Teve alguma atualização no período. */
const movedInPeriod = (i) => !!i.updated && inQp(Date.parse(i.updated));

function setQaPeriod(p) {
  QP.period = p;
  document.querySelectorAll("#qaPeriod button").forEach((b) => b.classList.toggle("on", b.dataset.p === p));
  try { localStorage.setItem("qf.qaPeriod", p); } catch { /* sem storage */ }
  if (state.mode === "panel") renderPanel();
  if (state.mode === "qaq") renderQaQueue();
  if (state.mode === "day") loadDay(p === "yesterday" ? qpYesterday() : p === "today" ? todayISO() : state.dayDate);
}

/* ---------- Demandas em que você atuou, em qualquer status (Painel › Todas e Tarefa › recentes) ---------- */

const ACT = { data: null, seq: 0, recent: "today" };
try { ACT.recent = localStorage.getItem("qf.recent") || "today"; } catch { /* sem storage */ }

async function loadActivity({ force = false } = {}) {
  const seq = ++ACT.seq;
  if (!ACT.data) {
    try { const { qaActivity } = await chrome.storage.local.get({ qaActivity: null }); if (qaActivity?.issues && !ACT.data) ACT.data = qaActivity; } catch { /* sem cache */ }
    if (ACT.data) activityRendered();
  }
  if (!force && ACT.data && Date.now() - ACT.data.generatedAt < 2 * 60 * 1000) return activityRendered();
  try {
    const data = await send("MY_ACTIVITY", { force });
    if (seq !== ACT.seq) return;
    ACT.data = data;
    chrome.storage.local.set({ qaActivity: data }).catch(() => {});
    activityRendered();
  } catch (e) {
    if (state.mode === "panel" && state.panel.scope === "all" && !ACT.data) { $("panelBox").innerHTML = ""; note($("panelBox"), "err", e.message); }
    else toast(e.message);
  }
}
function activityRendered() {
  if (state.mode === "panel" && state.panel.scope === "all") renderPanel();
  if (state.mode === "single") renderRecent();
}

const dayLabel = (iso) => (iso === todayISO() ? "Hoje" : iso === addDaysIso(todayISO(), -1) ? "Ontem" : dayShort(iso));
const CAT_TXT = { done: "Concluída", indeterminate: "Em andamento", new: "A fazer" };

/** Linha de demanda com status atual, última mudança e quem estava com ela. */
function activityRow(it, url) {
  const right = el("span", "dm-right");
  const st = el("span", `st-pill cat-${it.statusCategory || "x"}`, it.status || "—");
  st.dataset.tip = CAT_TXT[it.statusCategory] || "";
  const t = it.updated ? new Date(it.updated) : null;
  right.append(st, el("span", "m-row-r", t ? `${pad(t.getHours())}:${pad(t.getMinutes())}` : ""));
  const bits = [];
  if (it.lastMove) bits.push(`${it.lastMove.from} → ${it.lastMove.to}${it.lastMove.byMe ? " · por você" : it.lastMove.by ? ` · por ${it.lastMove.by.split(" ")[0]}` : ""}`);
  bits.push(it.mine ? "com você" : it.assignee ? `com ${it.assignee.name}` : "sem responsável");
  if (it.parentKey) bits.push(`↳ ${it.parentKey}`);
  const line = issueLine(it, right, bits.join(" · "), url);
  line.querySelector(".m-row-top").prepend(el("span", `tt ${it.isSubtask ? "tt-sub" : "tt-task"}`, it.isSubtask ? "Sub" : "Pai"));
  line.classList.add("clickable");
  line.title = "Abrir na aba Tarefa";
  line.addEventListener("click", () => openFromPanel(it));
  return line;
}

/** Painel › Todas: tudo em que você atuou, no período escolhido, agrupado por dia. */
function renderActivity(box) {
  const P = state.panel;
  if (!ACT.data) { box.innerHTML = `<p class="muted xs">Lendo as demandas em que você atuou…</p>`; loadActivity(); return; }
  $("panelInfo").textContent = `atualizado ${since(ACT.data.generatedAt)}`;
  const term = (P.q || "").trim().toLowerCase();
  const list = ACT.data.issues.filter((i) => inSpace(i.key)
    && (P.type === "all" || (P.type === "sub" ? i.isSubtask : !i.isSubtask))
    && inQp(i.updated)
    && (!term || [i.key, i.summary, i.parentKey, i.status].some((v) => String(v || "").toLowerCase().includes(term))));
  const k = el("div", "quick-row");
  const kp = (n, label) => { const b = el("div", "quick"); b.append(el("b", null, String(n)), el("span", null, label)); return b; };
  k.append(kp(list.length, `atualizadas ${QP_LABEL[QP.period]}`),
    kp(list.filter((i) => i.statusCategory === "done").length, "concluídas"),
    kp(list.filter((i) => i.statusCategory === "indeterminate").length, "em andamento"),
    kp(list.filter((i) => i.lastMove?.byMe || (i.myLastMove && inQp(i.myLastMove.at))).length, "você moveu"),
    kp(list.filter((i) => !i.mine).length, "já com outra pessoa"));
  box.appendChild(k);
  const card = mCard("Todas as demandas em que você atuou", `${list.length} · qualquer status`);
  let last = "";
  for (const it of list.slice(0, 120)) {
    const d = isoOfMs(it.updated);
    if (d !== last) { last = d; card.appendChild(el("div", "group", dayLabel(d))); }
    card.appendChild(activityRow(it, ACT.data.url));
  }
  if (!list.length) card.appendChild(el("div", "empty", term ? "Nada com essa busca." : `Nenhuma demanda sua atualizada ${QP_LABEL[QP.period]}.`));
  if (list.length > 120) card.appendChild(el("p", "muted xs", `+ ${list.length - 120} — refine a busca.`));
  box.appendChild(card);
  if (ACT.data.truncated) note(box, "warn", "Mais de 300 demandas nos últimos 30 dias: mostrando as atualizadas mais recentemente.");
}

/** Aba Tarefa: as últimas demandas em que você atuou (Hoje · Ontem · 7 dias), para abrir com um clique. */
function renderRecent() {
  if (ROLE !== "qa") return;
  const box = $("recentBox");
  box.innerHTML = "";
  document.querySelectorAll("#recentPeriod button").forEach((b) => b.classList.toggle("on", b.dataset.p === ACT.recent));
  if (!ACT.data) { box.appendChild(el("p", "muted xs", "Carregando…")); loadActivity(); return; }
  const t = todayISO(), y = businessStep(t, -1);
  const pick = (i) => { const d = isoOfMs(i.updated); return ACT.recent === "today" ? d === t : ACT.recent === "yesterday" ? d === y : d >= addDaysIso(t, -6); };
  const list = ACT.data.issues.filter(pick);
  for (const it of list.slice(0, 8)) box.appendChild(activityRow(it, ACT.data.url));
  if (!list.length) box.appendChild(el("p", "muted xs", ACT.recent === "today" ? "Nenhuma demanda sua atualizada hoje ainda." : "Nada nesse período."));
  $("recentAll").textContent = list.length > 8 ? `ver as ${list.length} no Painel` : "ver no Painel";
}

function renderPanel() {
  const d = state.panel.data;
  if (!d) return;
  const P = state.panel;

  // Projeto: Todos + os projetos onde você tem demanda
  const proj = $("panelProject");
  proj.innerHTML = "";
  // Sempre os espaços configurados (MEED e SUS), mesmo sem demanda sua em um deles
  const spaces = [...new Set([DEF.spaces?.batch?.label, DEF.spaces?.sustentacao?.label, ...d.projects].filter(Boolean))];
  for (const p of ["", ...spaces]) {
    const b = document.createElement("button");
    b.textContent = p || "Todos";
    b.classList.toggle("on", P.project === p);
    b.addEventListener("click", () => { P.project = p; P.status = ""; renderPanel(); });
    proj.appendChild(b);
  }
  document.querySelectorAll("#panelType button").forEach((b) => b.classList.toggle("on", b.dataset.type === P.type));

  const scoped = panelScoped();
  const list = panelFiltered(scoped);
  const box = $("panelBox");
  box.innerHTML = "";
  try { localStorage.setItem("qf.panel", JSON.stringify({ project: P.project, type: P.type, quick: P.quick || "", q: P.q || "", scope: P.scope || "open" })); } catch { /* sem storage */ }
  document.querySelectorAll("#panelScope button").forEach((b) => b.classList.toggle("on", b.dataset.scope === (P.scope || "open")));
  if (P.scope === "all") return renderActivity(box);
  $("panelInfo").textContent = d.fetchedAt ? `atualizado ${since(d.fetchedAt)}` : "";

  /* --- atalhos: o que você quer ver agora --- */
  const tests = String(DEF.subtaskName || "Testes Manuais").toLowerCase();
  const QUICK = [
    ["", "Todas", scoped.length],
    ["doing", "Em andamento", scoped.filter((i) => i.statusCategory === "indeterminate").length],
    ["todo", "A fazer", scoped.filter((i) => i.statusCategory === "new").length],
    ["tests", DEF.subtaskName || "Testes Manuais", scoped.filter((i) => i.isSubtask && i.summary.toLowerCase().includes(tests)).length],
    ["moved", `Movimentadas ${QP_LABEL[QP.period]}`, scoped.filter(movedInPeriod).length],
  ];
  const quick = el("div", "quick-row");
  for (const [id, label, n] of QUICK) {
    const b = el("button", `quick ${(P.quick || "") === id ? "on" : ""}`);
    b.append(el("b", null, String(n)), el("span", null, label));
    b.addEventListener("click", () => { P.quick = id; P.status = ""; renderPanel(); });
    quick.appendChild(b);
  }
  box.appendChild(quick);

  /* --- indicadores --- */
  const k = {
    open: scoped.length,
    overdue: scoped.filter((i) => i.overdue).length,
    due: scoped.filter(dueInPeriod).length,
    nodue: scoped.filter((i) => !i.due).length,
  };
  const kpis = document.createElement("div");
  kpis.className = "kpis";
  const tile = (id, value, label, cls) => {
    const t = document.createElement("button");
    t.className = `kpi ${cls || ""}` + (P.kpi === id && id ? " on" : "");
    t.innerHTML = `<b></b><span></span>`;
    t.firstChild.textContent = value;
    t.lastChild.textContent = label;
    t.addEventListener("click", () => { P.kpi = P.kpi === id ? "" : id; renderPanel(); });
    return t;
  };
  kpis.classList.add("three");
  kpis.append(
    tile("overdue", k.overdue, "atrasadas", k.overdue ? "err" : ""),
    tile("due", k.due, qpDays() === 1 ? "vencem hoje" : `vencem em ${QP.period} dias`, k.due ? "warn" : ""),
    tile("nodue", k.nodue, "sem data limite"),
  );
  box.appendChild(kpis);

  /* --- resumo: horas e concluídas --- */
  const sum = document.createElement("div");
  sum.className = "card";
  const spent = scoped.reduce((s, i) => s + i.spent, 0);
  const est = scoped.reduce((s, i) => s + i.estimate, 0);
  const t1 = document.createElement("div");
  t1.className = "card-t";
  t1.append(document.createTextNode("Distribuição por status"));
  const t1s = document.createElement("span");
  const doneN = d.done ? d.done.filter((x) => inQp(x.at) && (!gspace.project || x.project === gspace.project)).length : d.kpi.doneWeek;
  t1s.textContent = `✓ ${doneN} concluída${doneN === 1 ? "" : "s"} ${QP_LABEL[QP.period]}`;
  t1.appendChild(t1s);
  sum.appendChild(t1);
  const hrs = document.createElement("div");
  hrs.className = "muted xs";
  hrs.textContent = est
    ? `${fmtDur(spent)} apontadas de ${fmtDur(est)} estimadas nas demandas abertas (${Math.round((spent / est) * 100)}%)`
    : `${fmtDur(spent)} apontadas nas demandas abertas`;
  sum.appendChild(hrs);

  const counts = new Map();
  for (const i of scoped) counts.set(i.status, (counts.get(i.status) || 0) + 1);
  // Em andamento primeiro: é o que você está mexendo agora
  const CAT = { indeterminate: 0, new: 1, done: 2 };
  const statuses = d.statuses.filter((s) => counts.has(s.name)).sort((a, b) => (CAT[a.category] ?? 1) - (CAT[b.category] ?? 1) || counts.get(b.name) - counts.get(a.name));
  const used = { new: 0, indeterminate: 0, done: 0 };
  const colorOf = new Map(statuses.map((s) => {
    const pal = CAT_COLORS[s.category] || CAT_COLORS.indeterminate;
    const c = pal[used[s.category] = ((used[s.category] ?? -1) + 1) % pal.length] || pal[0];
    return [s.name, c];
  }));

  const stack = document.createElement("div");
  stack.className = "stack";
  for (const s of statuses) {
    const i = document.createElement("i");
    i.style.flex = String(counts.get(s.name));
    i.style.background = colorOf.get(s.name);
    i.title = `${s.name}: ${counts.get(s.name)}`;
    stack.appendChild(i);
  }
  sum.appendChild(stack);

  const lg = document.createElement("div");
  lg.className = "stack-legend";
  for (const s of statuses) {
    const b = document.createElement("button");
    b.classList.toggle("on", P.status === s.name);
    const i = document.createElement("i");
    i.style.background = colorOf.get(s.name);
    b.append(i, document.createTextNode(`${s.name} ${counts.get(s.name)}`));
    b.addEventListener("click", () => { P.status = P.status === s.name ? "" : s.name; renderPanel(); });
    lg.appendChild(b);
  }
  sum.appendChild(lg);
  box.appendChild(sum);

  /* --- lista --- */
  const card = document.createElement("div");
  card.className = "card";
  const lt = document.createElement("div");
  lt.className = "card-t";
  lt.append(document.createTextNode(P.status || (P.kpi === "overdue" ? "Atrasadas" : P.kpi === "due" ? (qpDays() === 1 ? "Vencem hoje" : `Vencem em ${QP.period} dias`) : P.kpi === "nodue" ? "Sem data limite" : "Minhas demandas")));
  const lts = document.createElement("span");
  lts.textContent = `${list.length} de ${scoped.length}`;
  lt.appendChild(lts);
  card.appendChild(lt);

  if (!list.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.innerHTML = scoped.length ? "<b>🔎</b>Nada com esses filtros." : "<b>🎉</b>Nenhuma demanda aberta no seu nome.";
    card.appendChild(e);
  }

  // Atrasadas primeiro, depois por data limite, depois sem data.
  const sorted = list.slice().sort((a, b) =>
    (b.overdue - a.overdue) || ((a.due || "9999") .localeCompare(b.due || "9999")) || (b.updated || "").localeCompare(a.updated || ""));

  let lastStatus = null;
  const grouped = !P.status;
  const ordered = grouped
    ? statuses.flatMap((s) => sorted.filter((i) => i.status === s.name))
    : sorted;

  for (const it of ordered) {
    if (grouped && it.status !== lastStatus) {
      lastStatus = it.status;
      const g = document.createElement("div");
      g.className = "group";
      g.style.color = colorOf.get(it.status);
      g.textContent = `${it.status} · ${counts.get(it.status)}`;
      card.appendChild(g);
    }
    card.appendChild(dashRow(it, d));
  }
  box.appendChild(card);
}

function dashRow(it, d) {
  const row = document.createElement("div");
  row.className = "dash-row";
  row.title = "Abrir na aba Tarefa para apontar";

  const top = document.createElement("div");
  top.className = "dr-top";
  const k = document.createElement("span");
  k.className = "k";
  k.textContent = it.key;
  const ty = document.createElement("span");
  ty.className = `ty ${it.isSubtask ? "ty-sub" : "ty-pai"}`;
  ty.textContent = it.isSubtask ? "sub" : "pai";
  top.append(k, ty);

  const sm = document.createElement("div");
  sm.className = "dr-sum";
  sm.textContent = it.summary;

  const meta = document.createElement("div");
  meta.className = "dr-meta";
  if (it.due) {
    const dd = document.createElement("span");
    const diff = daysBetween(d.today, it.due);
    if (it.overdue) { dd.className = "late"; dd.textContent = `atrasada ${-diff}d · ${brDate(it.due)}`; }
    else if (diff === 0) { dd.className = "soon"; dd.textContent = "vence hoje"; }
    else if (diff <= 7) { dd.className = "soon"; dd.textContent = `vence em ${diff}d · ${brDate(it.due)}`; }
    else dd.textContent = `vence ${brDate(it.due)}`;
    meta.appendChild(dd);
  }
  const spr = sprintOf.get(it.key) || (it.parentKey && sprintOf.get(it.parentKey));
  if (state.sprints) {
    const s = document.createElement("span");
    if (spr) {
      s.className = "spr";
      s.textContent = `${spr.name}${spr.end ? ` · até ${brDate(spr.end).slice(0, 5)}` : ""}`;
      s.title = `Entra na entrega da ${spr.name} (${spr.space})`;
    } else {
      s.className = "spr out";
      s.textContent = "fora da sprint ativa";
    }
    meta.appendChild(s);
  }
  if (it.parentKey) {
    const p = document.createElement("span");
    p.className = "pk";
    p.append(document.createTextNode(`↳ ${it.parentKey}`), jiraLink(it.parentKey, { base: d.url || DEF.baseUrl, label: "", title: `Abrir a tarefa pai ${it.parentKey} no Jira` }));
    meta.appendChild(p);
  }
  if (it.storyPoints != null) { const sp = document.createElement("span"); sp.textContent = `${it.storyPoints} pt`; meta.appendChild(sp); }

  const side = document.createElement("div");
  side.className = "dr-side";
  const links = document.createElement("span");
  links.className = "dr-links";
  links.append(histLink(it.key, { base: d.url || DEF.baseUrl }), jiraLink(it.key, { base: d.url || DEF.baseUrl, label: "Jira" }));
  side.appendChild(links);
  if (it.estimate || it.spent) {
    const bar = document.createElement("div");
    bar.className = "mini-bar";
    const fill = document.createElement("i");
    const pct = it.estimate ? (it.spent / it.estimate) * 100 : 100;
    fill.style.width = `${Math.min(100, pct)}%`;
    if (it.estimate && it.spent > it.estimate) fill.className = "over";
    bar.appendChild(fill);
    const hrs = document.createElement("span");
    hrs.className = "hrs";
    hrs.textContent = it.estimate ? `${fmtDur(it.spent)} / ${fmtDur(it.estimate)}` : fmtDur(it.spent);
    side.append(bar, hrs);
  }

  row.append(top, side, sm, meta);
  row.addEventListener("click", () => openFromPanel(it));
  return row;
}

/** Leva a demanda para a aba Tarefa, já selecionada e pronta para apontar. */
async function openFromPanel(it) {
  setMode("single");
  $("parentKey").value = it.parentKey || it.key;
  await findSubtasks();
  if (state.selected?.key !== it.key) await selectSubtask(it.key);
}

document.querySelectorAll("#panelType button").forEach((b) => b.addEventListener("click", () => {
  state.panel.type = b.dataset.type;
  state.panel.status = "";
  renderPanel();
}));
$("panelRefresh").addEventListener("click", () => (state.panel.scope === "all" ? loadActivity({ force: true }) : loadPanel({ force: true })));
$("panelScope").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.panel.scope = b.dataset.scope;
  renderPanel();
  if (state.panel.scope === "all") loadActivity();
});
$("recentPeriod").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  ACT.recent = b.dataset.p;
  try { localStorage.setItem("qf.recent", ACT.recent); } catch { /* sem storage */ }
  renderRecent();
});
$("recentAll").addEventListener("click", () => {
  state.panel.scope = "all";
  setQaPeriod(ACT.recent === "today" ? "today" : ACT.recent === "yesterday" ? "yesterday" : "7");
  setMode("panel");
});
try { $("sprintWrap").open = localStorage.getItem("qf.sprintWrap") === "1"; } catch { /* sem storage */ }
$("sprintWrap").addEventListener("toggle", () => { try { localStorage.setItem("qf.sprintWrap", $("sprintWrap").open ? "1" : "0"); } catch { /* sem storage */ } });
let panelSearchTimer = null;
$("panelSearch").addEventListener("input", () => {
  clearTimeout(panelSearchTimer);
  panelSearchTimer = setTimeout(() => { state.panel.q = $("panelSearch").value; renderPanel(); }, 150);
});

/* =====================================================================
   Equipe: quem apontou, quanto, contra a meta e o teto de cada pessoa
   ===================================================================== */

const TEAM_POLL_MS = 30 * 1000;
/** Quando o Jira pede pausa (429), a atualização automática espera mais a cada vez: 1, 2 e até 5 min. */
const RATE_BACKOFF_MAX_MS = 5 * 60 * 1000;
const isRateLimited = (msg) => /\bJira 429\b/.test(String(msg || ""));
const nextBackoff = (cur) => Math.min(RATE_BACKOFF_MAX_MS, cur ? cur * 2 : 60 * 1000);
const team = {
  data: null, date: todayISO(), open: new Set(), sort: "low", q: "", filter: "",
  paused: false, timer: null, ticker: null, inflight: false, showHidden: false, backoff: 0, backoffUntil: 0,
  lastOk: 0, error: null, pendingRender: false, scope: "cfg",
  view: (() => { try { return localStorage.getItem("qf.teamView") || "cards"; } catch { return "cards"; } })(),
};

function startTeamPolling() {
  stopTeamPolling();
  team.timer = setInterval(pollTeam, TEAM_POLL_MS);
  team.ticker = setInterval(updateTeamLive, 1000);
  updateTeamLive();
}
function stopTeamPolling() {
  clearInterval(team.timer);
  clearInterval(team.ticker);
  team.timer = team.ticker = null;
}

function pollTeam() {
  // Só atualiza sozinho para hoje, com a aba visível e sem pausa.
  if (state.mode !== "team" || team.paused || team.date !== todayISO() || document.visibilityState !== "visible") return;
  if (Date.now() < team.backoffUntil) return;   // o Jira pediu pausa: espera antes de consultar de novo
  loadTeam({ silent: true });
}

async function loadTeam({ force = false, silent = false } = {}) {
  if (team.inflight) return;           // nunca empilha chamadas: a próxima rodada espera esta
  team.inflight = true;
  const date = team.date;
  $("teamDate").value = date;
  $("teamNext").disabled = date >= todayISO();
  if (!silent) $("teamBox").innerHTML = `<p class="muted xs">Carregando a equipe de ${dayShort(date)}…</p>`;
  try {
    const scope = team.scope;
    const rep = await send("TEAM_REPORT", { date, force, scope: "cfg", projects: gspace.projects });
    if (rep.date !== team.date || scope !== team.scope) return;   // trocou de dia/escopo no meio do caminho
    team.data = rep;
    team.error = null;
    team.lastOk = Date.now();
    team.backoff = 0; team.backoffUntil = 0;
    renderTeam();
  } catch (e) {
    team.error = e.message;
    if (isRateLimited(e.message)) { team.backoff = nextBackoff(team.backoff); team.backoffUntil = Date.now() + team.backoff; }
    if (!team.data || team.data.date !== date) { $("teamBox").innerHTML = ""; note($("teamBox"), "err", e.message); }
  } finally {
    team.inflight = false;
    updateTeamLive();
  }
}

function updateTeamLive() {
  const live = team.date === todayISO();
  const el = $("teamLive");
  el.className = "live" + (!live ? " past" : team.paused ? " paused" : team.error ? " err" : "");
  const wait = Math.ceil((team.backoffUntil - Date.now()) / 1000);
  el.querySelector("b").textContent = !live ? "histórico" : team.paused ? "pausado"
    : wait > 0 ? `Jira pediu uma pausa · volta em ${wait >= 60 ? `${Math.ceil(wait / 60)} min` : `${wait}s`}`
    : team.error ? "falha ao atualizar" : "ao vivo";
  const ago = team.lastOk ? Math.max(0, Math.round((Date.now() - team.lastOk) / 1000)) : null;
  $("teamAgo").textContent = ago == null ? "" : live ? ` · atualizado há ${ago}s` : "";
  $("teamPause").textContent = team.paused ? "▶" : "❚❚";
  $("teamPause").title = team.paused ? "Retomar atualização a cada 30 s" : "Pausar atualização automática";
  $("teamPause").disabled = !live;
}

const initials = (n) => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
function avatarColor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ISSUE_COLORS[h % ISSUE_COLORS.length];
}

const STATE_LABEL = { met: ["✓ meta", "ok"], over: ["acima do teto", "err"], under: ["abaixo da meta", "warn"], none: ["sem apontamento", "none"] };

function renderTeam() {
  // Não destrói um campo que a pessoa está editando: renderiza quando sair dele.
  if ($("teamBox").contains(document.activeElement) && document.activeElement.tagName === "INPUT") {
    team.pendingRender = true;
    return;
  }
  team.pendingRender = false;
  const d = scopedTeam(team.data);
  if (!d) return;
  if (d.scope !== "all" && d.projects.length) $("teamScopeCfg").textContent = d.projects.join("+");
  const box = $("teamBox");
  box.innerHTML = "";

  const term = team.q.trim().toLowerCase();
  const visible = d.people.filter((p) => !p.hidden);
  const hiddenCount = d.people.length - visible.length;
  const base = (team.showHidden ? d.people : visible).filter((p) => !term || p.name.toLowerCase().includes(term));

  /* --- resumo da equipe (clique filtra) --- */
  const k = {
    logged: visible.filter((p) => p.total > 0).length,
    met: visible.filter((p) => p.state === "met").length,
    over: visible.filter((p) => p.state === "over").length,
    under: visible.filter((p) => p.state === "under").length,
    none: visible.filter((p) => p.state === "none").length,
  };
  const teamTotal = visible.reduce((sum, p) => sum + p.total, 0);
  const teamAvg = k.logged ? teamTotal / k.logged : 0;
  box.appendChild(teamHero(visible, k, teamTotal, teamAvg, d));

  let people = base.filter((p) => !team.filter || p.state === team.filter);
  const ratio = (p) => p.total / (p.goal || 1);
  people.sort(
    team.sort === "name" ? (a, b) => a.name.localeCompare(b.name)
    : team.sort === "high" ? (a, b) => b.total - a.total || a.name.localeCompare(b.name)
    : (a, b) => ratio(a) - ratio(b) || a.name.localeCompare(b.name));
  // Você e os fixados sempre no topo
  people.sort((a, b) => (b.isMe - a.isMe) || (b.pinned - a.pinned));

  // Faixa de horário comum a todos (cada pessoa tem sua jornada; mostra o dia inteiro trabalhado)
  const all = d.people.flatMap((p) => p.entries);
  const rs = Math.min(8 * 60, ...all.map((e) => Math.floor(e.start / 60) * 60));
  const re = Math.max(18 * 60, ...all.map((e) => Math.ceil(e.end / 60) * 60));
  const range = { start: Math.max(0, rs), end: Math.min(24 * 60, re) };

  const mtgView = MTG_ON && (team.view === "mtg" || team.view === "exec");
  if (!people.length && !mtgView) {
    const e = document.createElement("div");
    e.className = "empty";
    e.innerHTML = d.people.length ? "<b>🔎</b>Ninguém com esse filtro." : "<b>👥</b>Ninguém apontou nos projetos acompanhados nos últimos dias.";
    box.appendChild(e);
  } else if (team.view === "lanes") {
    box.appendChild(teamLanes(people, range, d));
  } else if (mtgView) {
    for (const c of teamMeetingsView(people, range, d, team.view === "exec" ? "execucao" : "reunioes")) box.appendChild(c);
  } else {
    const grid = document.createElement("div");
    grid.className = "tgrid";
    for (const p of people) grid.appendChild(personCard(p, d, range));
    box.appendChild(grid);
  }

  if (d.live) {
    const feed = teamFeed(visible);
    if (feed) box.appendChild(feed);
  }

  if (hiddenCount) {
    const sep = document.createElement("div");
    sep.className = "team-sep";
    sep.append(document.createTextNode(`${hiddenCount} ${pl(hiddenCount, "pessoa oculta", "pessoas ocultas")}`));
    const b = document.createElement("button");
    b.textContent = team.showHidden ? "esconder" : "mostrar";
    b.addEventListener("click", () => { team.showHidden = !team.showHidden; renderTeam(); });
    sep.appendChild(b);
    box.appendChild(sep);
  }
  if (d.partial) note(box, "warn", `${d.partial} ${pl(d.partial, "tarefa não pôde ser lida", "tarefas não puderam ser lidas")} agora (limite do Jira) — os totais podem estar menores; tentando de novo na próxima atualização.`);
  if (d.truncated) note(box, "warn", "Dia com mais de 1000 tarefas apontadas: a lista foi limitada. Restrinja os projetos nas Opções.");
  const foot = document.createElement("p");
  foot.className = "muted xs";
  foot.textContent = `Projetos: ${d.scope === "all" ? "todos que você enxerga" : d.projects.join(", ")} · meta/teto padrão ${fmtDur(d.defaults.goal)} / ${fmtDur(d.defaults.cap)} (ajustável por pessoa)`;
  box.appendChild(foot);
}

const keyColor = (key) => avatarColor(key);

/** Anel de progresso em volta do avatar: arco = % da meta; vermelho acima do teto. */
function avatarRing(p, size = 46) {
  const R = 20, C = 2 * Math.PI * R;
  const frac = Math.min(1, p.total / Math.max(1, p.goal));
  const color = p.state === "over" ? "var(--err)" : p.state === "met" ? "var(--ok)" : p.total ? "var(--data)" : "transparent";
  const w = document.createElement("span");
  w.className = "t-ring";
  w.style.width = w.style.height = `${size}px`;
  w.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="4"/>
    <circle cx="24" cy="24" r="${R}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"
      stroke-dasharray="${(frac * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 24 24)"/></svg>`;
  const av = document.createElement("span");
  av.className = "t-av";
  av.style.background = avatarColor(p.accountId);
  av.textContent = initials(p.name);
  w.appendChild(av);
  return w;
}

function teamHero(visible, k, total, avg, d) {
  const hero = document.createElement("div");
  hero.className = "t-hero";
  const left = document.createElement("div");
  left.className = "t-hero-l";
  left.innerHTML = "<small></small><b></b><span></span>";
  left.querySelector("small").textContent = d.live ? "equipe hoje" : `equipe em ${dayShort(d.date)}`;
  left.querySelector("b").textContent = fmtDur(total);
  left.querySelector("span").textContent = `${k.logged}/${visible.length} apontaram · média ${fmtDur(avg)}`;

  // barra empilhada: quantas pessoas em cada estado
  const states = [["met", "bateram a meta", "var(--ok)"], ["under", "abaixo da meta", "var(--data)"], ["over", "acima do teto", "var(--err)"], ["none", "sem apontamento", "var(--surface-3)"]];
  const right = document.createElement("div");
  right.className = "t-hero-r";
  const bar = document.createElement("div");
  bar.className = "stackbar tall";
  for (const [id, label, color] of states) {
    if (!k[id]) continue;
    const sg = document.createElement("i");
    sg.style.flex = String(k[id]);
    sg.style.background = color;
    sg.dataset.tip = `${k[id]} ${label}`;
    bar.appendChild(sg);
  }
  right.appendChild(bar);
  const chips = document.createElement("div");
  chips.className = "t-chips";
  for (const [id, label, color] of states) {
    const c = document.createElement("button");
    c.className = "t-chip" + (team.filter === id ? " on" : "");
    c.innerHTML = "<i></i><b></b><span></span>";
    c.querySelector("i").style.background = color;
    c.querySelector("b").textContent = String(k[id]);
    c.querySelector("span").textContent = label;
    c.addEventListener("click", () => { team.filter = team.filter === id ? "" : id; renderTeam(); });
    chips.appendChild(c);
  }
  right.appendChild(chips);

  // Cartões e Linha do tempo de um lado; Reuniões e Execução num filtro à parte
  const views = document.createElement("div");
  views.className = "t-views";
  const groups = [[["cards", "Cartões"], ["lanes", "Linha do tempo"]]];
  if (MTG_ON) groups.push([["mtg", MEETING_GROUPS.reunioes.label], ["exec", MEETING_GROUPS.execucao.label]]);
  for (const g of groups) {
    const seg = document.createElement("div");
    seg.className = "seg";
    for (const [id, label] of g) {
      const b = document.createElement("button");
      b.textContent = label;
      b.classList.toggle("on", (team.view || "cards") === id);
      b.setAttribute("aria-pressed", String((team.view || "cards") === id));
      b.addEventListener("click", () => { team.view = id; try { localStorage.setItem("qf.teamView", id); } catch { /* ok */ } renderTeam(); });
      seg.appendChild(b);
    }
    views.appendChild(seg);
  }
  hero.append(left, right, views);
  return hero;
}

/** Todos na mesma régua de horário: quem estava trabalhando em quê, lado a lado. */
function teamLanes(people, range, d) {
  const wrap = document.createElement("div");
  wrap.className = "card t-lanes";
  const span = range.end - range.start;
  const pos = (m) => `${((m - range.start) / span) * 100}%`;
  const scale = document.createElement("div");
  scale.className = "t-lane t-lane-scale";
  scale.appendChild(document.createElement("span"));
  const sc = document.createElement("div");
  sc.className = "t-lane-track scale-only";
  for (let h = range.start; h <= range.end; h += 60) {
    const l = document.createElement("small");
    l.style.left = pos(h);
    l.textContent = `${h / 60}h`;
    sc.appendChild(l);
  }
  scale.append(sc, document.createElement("span"));
  wrap.appendChild(scale);
  const now = nowMin();
  for (const p of people) {
    const row = document.createElement("div");
    row.className = "t-lane" + (p.isMe ? " me" : "");
    const who = document.createElement("span");
    who.className = "t-lane-who";
    const av = document.createElement("span");
    av.className = "t-av sm";
    av.style.background = avatarColor(p.accountId);
    av.textContent = initials(p.name);
    who.append(av, document.createTextNode(p.isMe ? "Você" : p.name.split(" ").slice(0, 2).join(" ")));
    const tr = document.createElement("div");
    tr.className = "t-lane-track";
    for (let h = range.start + 60; h < range.end; h += 60) {
      const g = document.createElement("i");
      g.className = "g";
      g.style.left = pos(h);
      tr.appendChild(g);
    }
    for (const e of p.entries) {
      const b = document.createElement("span");
      b.className = "blk";
      b.style.left = pos(Math.max(range.start, e.start));
      b.style.width = `${(Math.min(e.end, range.end) - Math.max(range.start, e.start)) / span * 100}%`;
      b.style.background = keyColor(e.key);
      b.dataset.tip = `${p.name}\n${e.key} · ${e.summary || ""}\n${fmtHM(e.start)}–${fmtHM(e.end)} · ${fmtDur(e.minutes)}`;
      tr.appendChild(b);
    }
    if (d.live && now > range.start && now < range.end) {
      const n = document.createElement("i");
      n.className = "now";
      n.style.left = pos(now);
      tr.appendChild(n);
    }
    if (MTG_ON && p.isMe) attachMeetings({ track: tr, lo: range.start, hi: range.end }, { date: d.date || todayISO(), now: d.live ? now : null, onChange: rerenderMeetings });
    const tot = document.createElement("b");
    tot.className = `t-lane-tot ${p.state}`;
    tot.textContent = p.total ? fmtDur(p.total) : "—";
    row.append(who, tr, tot);
    row.addEventListener("click", () => { team.view = "cards"; team.open.add(p.accountId); renderTeam(); });
    wrap.appendChild(row);
  }
  return wrap;
}

/**
 * Visão Reuniões: na régua da equipe, as reuniões de cada pessoa. Vêm de dois lugares:
 *  - as que você marcou no + (ficam só neste navegador);
 *  - apontamentos em demandas do Jira que foram reuniões (Planning, Review, alinhamentos…),
 *    reconhecidas pelo título ou, sem pista no título, pela descrição. Só leitura.
 */
const MTG_KEY_RX = /^[A-Z][A-Z0-9_]*-\d+$/;
function teamMeetingsView(people, range, d, group = "reunioes") {
  const G = MEETING_GROUPS[group];
  const inGroup = (m) => G.types.includes(m.type);
  const word = group === "execucao" ? "execução" : "reuniões";
  const date = d.date || todayISO();
  const now = nowMin();
  const live = date === todayISO();
  const type = (team.mtgTypes || (team.mtgTypes = {}))[group] || "all";
  const cls = team.mtgClass || (team.mtgClass = new Map());   // chave -> { type, by, match } | null

  // demandas ainda não classificadas: pergunta ao serviço uma vez e redesenha
  const keys = [...new Set(people.flatMap((p) => p.entries.map((e) => e.key)))].filter((k) => MTG_KEY_RX.test(k) && !cls.has(k));
  if (keys.length && !team.mtgPending) {
    team.mtgPending = true;
    send("MEETING_CLASSIFY", { keys })
      .then((res) => { for (const k of keys) cls.set(k, res[k] || null); })
      .catch(() => { for (const k of keys) cls.set(k, null); })
      .finally(() => { team.mtgPending = false; if (state.mode === "team" && (team.view === "mtg" || team.view === "exec")) renderTeam(); });
  }

  const fromJira = (p) => p.entries.filter((e) => cls.get(e.key)).map((e) => ({
    type: cls.get(e.key).type, by: cls.get(e.key).by, title: e.summary || e.key, start: e.start, end: e.end, jiraKey: e.key, fromJira: true,
  }));
  const rows = people.map((p) => {
    const jira = fromJira(p);
    const local = p.isMe ? meetingsOn(date) : [];
    const linked = new Set(local.map((m) => m.jiraKey).filter(Boolean));
    return { id: p.accountId, name: p.name, isMe: p.isMe, local, jira: jira.filter((m) => !linked.has(m.jiraKey)) };
  });
  const pick = (m) => inGroup(m) && (type === "all" || m.type === type);
  rows.forEach((r) => { r.all = [...r.local, ...r.jira].filter(inGroup); r.list = r.all.filter(pick); });
  const allM = rows.flatMap((r) => r.list);
  const lo = Math.max(0, Math.min(range.start, ...allM.map((m) => Math.floor(m.start / 60) * 60)));
  const hi = Math.min(24 * 60, Math.max(range.end, ...allM.map((m) => Math.ceil(m.end / 60) * 60)));
  const span = hi - lo;
  const pos = (m) => `${((m - lo) / span) * 100}%`;
  const short = (r) => (r.isMe ? "Você" : r.name.split(" ").slice(0, 2).join(" "));
  const avatar = (r) => {
    const a = document.createElement("span");
    a.className = "t-av sm";
    a.style.background = avatarColor(r.id);
    a.textContent = initials(r.name);
    return a;
  };
  const block = (tr, m, who) => {
    const t = MEETING_TYPES[m.type] || MEETING_TYPES.outro;
    const b = document.createElement("span");
    b.className = "blk mt-blk" + (m.fromJira ? " jira" : "");
    b.style.left = pos(Math.max(lo, m.start));
    b.style.width = `${(Math.min(m.end, hi) - Math.max(lo, m.start)) / span * 100}%`;
    b.style.borderColor = t.color;
    b.style.background = mtgRgba(t.color, 0.24);
    b.dataset.tip = `${who}\n${t.label}: ${m.title}\n${fmtHM(m.start)}–${fmtHM(m.end)} · ${fmtDur(m.end - m.start)}${m.jiraKey ? ` · ${m.jiraKey}` : ""}`
      + (m.fromJira ? `\nReconhecida ${byLabel(m.by)} da demanda${m.category ? ` (Categoria: ${m.category})` : ""}` : "");
    tr.appendChild(b);
  };

  /* --- régua --- */
  const wrap = document.createElement("div");
  wrap.className = "card t-lanes mt-lanes";
  const busyNow = live ? rows.filter((r) => r.all.some((m) => m.start <= now && m.end > now)).length : 0;
  const total = allM.reduce((s, m) => s + m.end - m.start, 0);
  const head = document.createElement("div");
  head.className = "card-t";
  head.innerHTML = "<b></b><span></span>";
  head.querySelector("b").textContent = group === "execucao" ? "Execução da equipe" : "Reuniões da equipe";
  head.querySelector("span").textContent = [busyNow ? `${busyNow} ${group === "execucao" ? "em execução" : "em reunião"} agora` : "", allM.length ? `${fmtDur(total)} no dia` : "",
    team.mtgPending ? "lendo as demandas…" : ""].filter(Boolean).join(" · ");
  wrap.appendChild(head);
  const filt = document.createElement("div");
  filt.className = "mt-filt";
  for (const [id, t] of [["all", { label: "Todas", color: "#e3e8ee" }], ...G.types.map((k) => [k, MEETING_TYPES[k]])]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mt-f" + (type === id ? " on" : "");
    b.setAttribute("aria-pressed", String(type === id));
    const dot = document.createElement("i");
    dot.style.background = t.color;
    b.append(dot, t.label);
    b.addEventListener("click", () => { team.mtgTypes[group] = id; renderTeam(); });
    filt.appendChild(b);
  }
  wrap.appendChild(filt);
  const scale = document.createElement("div");
  scale.className = "t-lane t-lane-scale";
  scale.appendChild(document.createElement("span"));
  const sc = document.createElement("div");
  sc.className = "t-lane-track scale-only";
  for (let h = lo; h <= hi; h += 60) {
    const l = document.createElement("small");
    l.style.left = pos(h);
    l.textContent = `${h / 60}h`;
    sc.appendChild(l);
  }
  scale.append(sc, document.createElement("span"), document.createElement("span"));
  wrap.appendChild(scale);
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "t-lane" + (r.isMe ? " me" : "");
    const who = document.createElement("span");
    who.className = "t-lane-who";
    who.append(avatar(r), document.createTextNode(short(r)));
    const tr = document.createElement("div");
    tr.className = "t-lane-track";
    for (let h = lo + 60; h < hi; h += 60) {
      const g = document.createElement("i");
      g.className = "g";
      g.style.left = pos(h);
      tr.appendChild(g);
    }
    for (const m of r.jira.filter(pick)) block(tr, m, short(r));
    if (r.isMe && type === "all") {
      // as que você marcou continuam editáveis: arrastar, clicar para editar e a bolinha + para marcar
      attachMeetings({ track: tr, lo, hi }, { date, now: live ? now : null, onChange: rerenderMeetings, only: inGroup });
    } else {
      for (const m of r.local.filter(pick)) block(tr, m, short(r));
    }
    if (live && now > lo && now < hi) {
      const n = document.createElement("i");
      n.className = "now";
      n.style.left = pos(now);
      tr.appendChild(n);
    }
    const tot = document.createElement("b");
    tot.className = "t-lane-tot none";
    const mins = r.list.reduce((s, m) => s + m.end - m.start, 0);
    tot.textContent = mins ? fmtDur(mins) : "—";
    const hb = document.createElement("button");
    const open = team.mtgHist === r.id;
    hb.type = "button";
    hb.className = "hist-ic" + (open ? " on" : "");
    hb.innerHTML = ICON_HIST;
    hb.title = `Histórico de ${word}`;
    hb.setAttribute("aria-label", `Histórico de ${word} de ${short(r)}`);
    hb.setAttribute("aria-expanded", String(open));
    hb.addEventListener("click", () => { team.mtgHist = open ? null : r.id; renderTeam(); });
    row.append(who, tr, tot, hb);
    wrap.appendChild(row);
    if (open) wrap.appendChild(meetingHistPanel(r, short(r), group));
  }
  const foot = document.createElement("p");
  foot.className = "muted xs";
  foot.style.margin = "4px 0 0";
  foot.textContent = group === "execucao"
    ? "Inclui apontamentos em demandas de refinamento, deploy, configuração e testes: pela Categoria do Jira e, sem categoria, pelo título ou pela descrição. Nada é gravado no Jira."
    : "Inclui apontamentos em demandas que foram reuniões ou alinhamentos: pela Categoria do Jira e, sem categoria, pelo título ou pela descrição. Nada é gravado no Jira.";
  wrap.appendChild(foot);

  /* --- agenda: uma linha por reunião, juntando quem esteve na mesma (mesmo título e horário) --- */
  const agenda = document.createElement("div");
  agenda.className = "card mt-agenda";
  const byKey = new Map();
  for (const r of rows) {
    for (const m of r.list) {
      const k = m.jiraKey && m.fromJira ? `${m.jiraKey}|${m.start}` : `${m.type}|${String(m.title).trim().toLowerCase()}|${m.start}`;
      if (!byKey.has(k)) byKey.set(k, { m, who: [] });
      byKey.get(k).who.push(r);
    }
  }
  const items = [...byKey.values()].sort((a, b) => a.m.start - b.m.start || a.m.end - b.m.end);
  const at = document.createElement("div");
  at.className = "card-t";
  at.innerHTML = "<b>Agenda do dia</b><span></span>";
  at.querySelector("span").textContent = items.length ? `${items.length} ${pl(items.length, "item", "itens")}` : "";
  agenda.appendChild(at);
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "muted xs";
    p.style.margin = "0";
    p.textContent = type !== "all" ? "Nada desse tipo neste dia."
      : team.mtgPending ? "Lendo as demandas do dia…"
      : group === "execucao" ? "Nenhuma demanda de refinamento, deploy, configuração ou testes apontada neste dia."
      : "Nenhuma reunião neste dia. Arraste a bolinha + da sua linha até o horário.";
    agenda.appendChild(p);
  }
  for (const { m, who } of items) {
    const t = MEETING_TYPES[m.type] || MEETING_TYPES.outro;
    const on = live && m.start <= now && m.end > now;
    const r = document.createElement("div");
    r.className = "mt-row" + (on ? " is-now" : "") + (live && m.end <= now ? " past" : "");
    r.innerHTML = "<time></time><i class=\"mark\"></i><div class=\"mt-txt\"><b></b><small></small></div><span class=\"mt-avs\"></span>";
    r.querySelector("time").textContent = fmtHM(m.start);
    r.querySelector(".mark").style.background = t.color;
    r.querySelector("b").textContent = m.title;
    const everyone = who.length > 3 && who.length >= rows.length;
    r.querySelector("small").textContent = [on ? `agora, até ${fmtHM(m.end)}` : `${t.label}, ${fmtDur(m.end - m.start)}`,
      everyone ? "toda a equipe" : who.map(short).join(", ")].join(" · ");
    if (m.jiraKey) {
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = ` · ${m.jiraKey}`;
      r.querySelector("small").appendChild(k);
    }
    const avs = r.querySelector(".mt-avs");
    for (const w of who.slice(0, 4)) { const a = avatar(w); a.title = w.isMe ? "Você" : w.name; avs.appendChild(a); }
    agenda.appendChild(r);
  }

  /* --- últimas alterações (as que você marcou) --- */
  const changes = meetingLog().filter((e) => groupOfType(e.type) === group).sort((a, b) => b.at - a.at).slice(0, 6);
  const out = [wrap, agenda];
  if (changes.length) {
    const ch = document.createElement("div");
    ch.className = "card mt-changes";
    ch.innerHTML = "<div class=\"card-t\"><b>Suas últimas alterações</b><span>só neste navegador</span></div>";
    for (const e of changes) {
      const r = document.createElement("div");
      r.className = "mt-chg";
      r.innerHTML = "<time></time><span></span>";
      r.querySelector("time").textContent = ago(e.at);
      r.querySelector("span").textContent = describeChange(e);
      ch.appendChild(r);
    }
    out.push(ch);
  }
  return out;
}

/**
 * Histórico de reuniões de uma pessoa (botão na linha da visão Reuniões): os apontamentos dela em
 * demandas que foram reuniões nos últimos 7 ou 30 dias, e, se for você, também as que marcou no +.
 */
function meetingHistPanel(r, who, group = "reunioes") {
  const G = MEETING_GROUPS[group];
  const days = team.mtgHistDays || 7;
  const to = todayISO();
  const from = addDaysIso(to, -(days - 1));
  const cache = team.mtgHistData || (team.mtgHistData = new Map());
  const ck = `${r.id}|${from}`;
  const got = cache.get(ck);
  if (!got) {
    cache.set(ck, { loading: true });
    send("PERSON_MEETINGS", { accountId: r.isMe ? undefined : r.id, from, to })
      .then((d) => cache.set(ck, { items: d.items || [] }))
      .catch((e) => cache.set(ck, { error: e.message }))
      .finally(() => { if (state.mode === "team" && (team.view === "mtg" || team.view === "exec") && team.mtgHist === r.id) renderTeam(); });
  }
  const st = cache.get(ck);
  const type = team.mtgTypes?.[group] || "all";
  const local = r.isMe ? meetingsBetween(from, to) : [];
  const linked = new Set(local.map((m) => m.jiraKey).filter(Boolean));
  const items = [...local, ...(st.items || []).filter((m) => !linked.has(m.jiraKey))]
    .filter((m) => G.types.includes(m.type) && (type === "all" || m.type === type));

  const box = document.createElement("div");
  box.className = "mt-hist";
  const head = document.createElement("div");
  head.className = "mt-hist-head";
  const t = document.createElement("b");
  const word = group === "execucao" ? "execução" : "reuniões";
  t.textContent = r.isMe ? `Seu histórico de ${word}` : `Histórico de ${word} de ${who}`;
  const seg = document.createElement("div");
  seg.className = "seg";
  for (const n of [7, 30]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `${n} dias`;
    b.classList.toggle("on", days === n);
    b.addEventListener("click", () => { team.mtgHistDays = n; renderTeam(); });
    seg.appendChild(b);
  }
  head.append(t, seg);
  box.appendChild(head);

  const sum = document.createElement("p");
  sum.className = "mt-hist-sum";
  const total = items.reduce((s, m) => s + m.end - m.start, 0);
  const byDay = new Map();
  for (const m of items) (byDay.get(m.date) || byDay.set(m.date, []).get(m.date)).push(m);
  sum.textContent = st.loading ? `Procurando nas demandas apontadas as de ${word}…`
    : st.error ? `Não deu para ler as demandas: ${st.error}`
    : items.length ? `${fmtDur(total)} em ${items.length} ${group === "execucao" ? pl(items.length, "atividade", "atividades") : pl(items.length, "reunião", "reuniões")}, em ${byDay.size} ${pl(byDay.size, "dia", "dias")}.`
    : `Nada de ${word} reconhecido nas demandas apontadas neste período.`;
  box.appendChild(sum);

  const lo = 8 * 60, span = 11 * 60;
  for (const day of [...byDay.keys()].sort().reverse()) {
    const ms = byDay.get(day).sort((a, b) => a.start - b.start);
    const g = document.createElement("div");
    g.className = "mt-hist-day";
    const h = document.createElement("header");
    h.innerHTML = "<b></b><span></span>";
    h.querySelector("b").textContent = `${dayShort(day)}${day === to ? ", hoje" : day === addDaysIso(to, -1) ? ", ontem" : ""}`;
    h.querySelector("span").textContent = `${fmtDur(ms.reduce((s, m) => s + m.end - m.start, 0))}, ${ms.length} ${pl(ms.length, "item", "itens")}`;
    const strip = document.createElement("div");
    strip.className = "mt-hist-strip";
    strip.setAttribute("aria-hidden", "true");
    for (const m of ms) {
      const b = document.createElement("i");
      b.style.left = `${Math.max(0, (m.start - lo) / span) * 100}%`;
      b.style.width = `${Math.max(1, ((m.end - m.start) / span) * 100)}%`;
      b.style.background = (MEETING_TYPES[m.type] || MEETING_TYPES.outro).color;
      strip.appendChild(b);
    }
    g.append(h, strip);
    for (const m of ms) {
      const ty = MEETING_TYPES[m.type] || MEETING_TYPES.outro;
      const it = document.createElement("div");
      it.className = "mt-hist-item";
      it.innerHTML = "<time></time><i class=\"mark\"></i><div class=\"mt-txt\"><b></b><small></small></div>";
      it.querySelector("time").innerHTML = `${fmtHM(m.start)}<small>${fmtHM(m.end)}</small>`;
      it.querySelector(".mark").style.background = ty.color;
      it.querySelector(".mt-txt b").textContent = m.title;
      it.querySelector(".mt-txt small").textContent = [ty.label, fmtDur(m.end - m.start),
        m.fromJira ? `reconhecida ${byLabel(m.by)}` : "marcada no QuickFill"].join(", ");
      if (m.jiraKey) it.appendChild(jiraLink(m.jiraKey, { base: team.data?.url, label: m.jiraKey }));
      g.appendChild(it);
    }
    box.appendChild(g);
  }
  return box;
}

/** Últimos apontamentos da equipe (ao vivo). */
function teamFeed(people) {
  const items = people.flatMap((p) => p.entries.map((e) => ({ ...e, person: p })))
    .sort((a, b) => b.end - a.end || b.start - a.start).slice(0, 6);
  if (!items.length) return null;
  const card = document.createElement("div");
  card.className = "card t-feed";
  const t = document.createElement("div");
  t.className = "card-t";
  t.innerHTML = "<b>Últimos apontamentos</b><span>ao vivo</span>";
  card.appendChild(t);
  for (const e of items) {
    const r = document.createElement("div");
    r.className = "t-feed-row";
    const av = document.createElement("span");
    av.className = "t-av sm";
    av.style.background = avatarColor(e.person.accountId);
    av.textContent = initials(e.person.name);
    const txt = document.createElement("span");
    txt.className = "t-feed-txt";
    const nm = document.createElement("b");
    nm.textContent = e.person.isMe ? "Você" : e.person.name.split(" ")[0];
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = e.key;
    txt.append(nm, document.createTextNode(" apontou "), document.createTextNode(fmtDur(e.minutes)), document.createTextNode(" em "), k,
      document.createTextNode(e.summary ? ` · ${e.summary}` : ""));
    const when = document.createElement("small");
    when.textContent = `${fmtHM(e.start)}–${fmtHM(e.end)}`;
    r.append(av, txt, when, jiraLink(e.key, { base: team.data?.url, label: "" }));
    card.appendChild(r);
  }
  return card;
}

function personCard(p, d, range) {
  const card = document.createElement("div");
  const open = team.open.has(p.accountId);
  card.className = `person tcard st-${p.state}` + (open ? " open" : "") + (p.changed ? " flash" : "") + (p.isMe ? " me" : "");

  const head = document.createElement("div");
  head.className = "p-head t-head";
  const name = document.createElement("span");
  name.className = "p-name";
  name.textContent = p.isMe ? `${p.name.split(" ")[0]} (você)` : p.name.split(" ").slice(0, 2).join(" ");
  name.title = p.name;
  if (p.pinned) { const em = document.createElement("em"); em.textContent = "📌"; name.appendChild(em); }
  if (p.hidden) { const em = document.createElement("em"); em.textContent = "oculto"; em.style.color = "var(--faint)"; name.appendChild(em); }

  const tot = document.createElement("div");
  tot.className = "t-tot";
  const big = document.createElement("b");
  big.textContent = fmtDur(p.total);
  const of = document.createElement("small");
  of.textContent = `/ ${fmtDur(p.goal)}`;
  tot.append(big, of);
  const [lbl, cls] = STATE_LABEL[p.state];
  const st = document.createElement("span");
  st.className = `t-state ${cls}`;
  st.textContent = p.state === "under" ? `faltam ${fmtDur(p.goal - p.total)}` : lbl;

  const info = document.createElement("div");
  info.className = "t-info";
  info.append(name, tot, st);

  // o que está fazendo / fez por último
  const last = p.entries[p.entries.length - 1];
  const now = document.createElement("div");
  now.className = "t-now";
  if (last) {
    const dot = document.createElement("i");
    dot.style.background = keyColor(last.key);
    const live = d.live && nowMin() - last.end < 45;
    now.append(dot, document.createTextNode(`${live ? "agora há pouco" : "último"} ${fmtHM(last.end)} · `));
    const kk = document.createElement("b");
    kk.textContent = last.key;
    now.append(kk, document.createTextNode(p.issues.length > 1 ? ` +${p.issues.length - 1}` : ""));
    if (live) now.classList.add("live");
  } else {
    now.textContent = p.lastLog && p.lastLog !== d.date ? `último apontamento ${brDate(p.lastLog)}` : "sem apontamento no dia";
  }

  // mini histórico dos últimos dias úteis
  const spark = document.createElement("div");
  spark.className = "t-spark";
  const top = Math.max(p.cap, ...p.history.map((h) => h.total));
  for (const h of p.history) {
    const b = document.createElement("i");
    b.className = h.total > p.cap ? "over" : h.total >= p.goal ? "met" : h.total ? "part" : "";
    b.style.height = `${Math.max(8, (h.total / top) * 100)}%`;
    b.dataset.tip = `${dayShort(h.date)} · ${fmtDur(h.total)}`;
    spark.appendChild(b);
  }
  if (p.changed && p.delta) {
    const dl = document.createElement("span");
    dl.className = "p-delta";
    dl.textContent = `${p.delta > 0 ? "+" : "−"}${fmtDur(Math.abs(p.delta))}`;
    info.appendChild(dl);
  }

  head.append(avatarRing(p), info);
  const foot = document.createElement("div");
  foot.className = "t-foot";
  foot.append(now);
  if (p.history.length) foot.appendChild(spark);
  head.appendChild(foot);

  if (p.isMe && d.meCheck) {
    const w = document.createElement("div");
    w.className = "p-warn";
    w.textContent = `Você tem ${fmtDur(d.meCheck.allTotal)} no dia; ${fmtDur(d.meCheck.allTotal - d.meCheck.scoped)} em ${d.meCheck.outside.join(", ") || "outros projetos"}, fora desta visão.`;
    head.appendChild(w);
  }
  head.dataset.tip = `${p.name}\nmeta ${fmtDur(p.goal)} · teto ${fmtDur(p.cap)}${p.custom ? "" : " (padrão)"}\nclique para ${open ? "fechar" : "ver detalhes"}`;
  head.addEventListener("click", () => {
    team.open.has(p.accountId) ? team.open.delete(p.accountId) : team.open.add(p.accountId);
    renderTeam();
  });
  card.appendChild(head);

  if (open) card.appendChild(personBody(p, d, range));
  return card;
}

function personBody(p, d, range) {
  const body = document.createElement("div");
  body.className = "p-body";

  /* meta e teto individuais */
  const goals = document.createElement("div");
  goals.className = "p-goals";
  const field = (label, value) => {
    const l = document.createElement("label");
    l.textContent = label;
    const i = document.createElement("input");
    i.className = "inp mono";
    i.type = "number"; i.min = "0.5"; i.max = "24"; i.step = "0.5";
    i.value = String(value / 60);
    i.addEventListener("blur", () => { if (team.pendingRender) setTimeout(renderTeam, 0); });
    l.appendChild(i);
    return [l, i];
  };
  const [gl, gi] = field("Meta (h)", p.goal);
  const [cl, ci] = field("Teto (h)", p.cap);
  const save = document.createElement("button");
  save.className = "btn primary";
  save.textContent = "Salvar";
  save.addEventListener("click", () => savePerson(p, { goal: Number(gi.value), cap: Number(ci.value) }));
  [gi, ci].forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") save.click(); }));
  const reset = document.createElement("button");
  reset.className = "btn";
  reset.textContent = "Padrão";
  reset.title = "Voltar à meta e ao teto padrão";
  reset.addEventListener("click", () => savePerson(p, { goal: null, cap: null }));
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  const pin = document.createElement("button");
  pin.className = "btn";
  pin.textContent = p.pinned ? "Desafixar" : "Fixar";
  pin.title = "Fixada, a pessoa aparece mesmo sem apontar nos últimos dias";
  pin.addEventListener("click", () => savePerson(p, { pinned: !p.pinned }));
  const hide = document.createElement("button");
  hide.className = "btn";
  hide.textContent = p.hidden ? "Mostrar" : "Ocultar";
  hide.addEventListener("click", () => savePerson(p, { hidden: !p.hidden }));
  goals.append(gl, cl, save, reset, spacer, pin, hide);
  body.appendChild(goals);

  /* linha do tempo do dia */
  if (p.entries.length || (MTG_ON && p.isMe)) {
    const colorOf = new Map(p.issues.map((it, i) => [it.key, ISSUE_COLORS[i % ISSUE_COLORS.length]]));
    const tr = track(range, p.entries.map((e) => ({
      start: e.start, minutes: e.minutes, color: colorOf.get(e.key),
      title: `${e.key} · ${fmtHM(e.start)}–${fmtHM(e.end)} · ${fmtDur(e.minutes)}`,
    })));
    if (MTG_ON && p.isMe) attachMeetings(tr, { date: d.date || todayISO(), now: (d.date || todayISO()) === todayISO() ? nowMin() : null, onChange: rerenderMeetings });
    body.append(tr.track, tr.scale);

    /* demandas */
    for (const it of p.issues) {
      const a = document.createElement("a");
      a.className = "work";
      a.href = `${d.url}/browse/${it.key}`;
      a.target = "_blank";
      a.innerHTML = `<span class="dot"></span><span class="k"></span><span class="t"></span><span class="s"></span><span class="h"></span>`;
      a.querySelector(".dot").style.background = colorOf.get(it.key);
      const kk = a.querySelector(".k");
      kk.textContent = it.key;
      const stx = document.createElement("em");
      stx.className = "stx" + (it.statusCategory === "done" ? " done" : "");
      stx.textContent = it.status;
      kk.appendChild(stx);
      a.querySelector(".t").textContent = fmtDur(it.minutes);
      a.querySelector(".s").textContent = it.summary || it.key;
      a.querySelector(".h").textContent = it.slots.map((x) => `${fmtHM(x.start)}–${fmtHM(x.end)}`).join("  ") + (it.parentKey ? `  ·  ${it.parentKey}` : "");
      body.appendChild(a);
    }
  } else {
    const e = document.createElement("div");
    e.className = "empty";
    e.innerHTML = "<b>⏳</b>Nenhum apontamento neste dia.";
    body.appendChild(e);
  }

  /* últimos dias úteis */
  const hist = document.createElement("div");
  hist.className = "p-hist";
  const top = Math.max(p.cap, ...p.history.map((h) => h.total));
  const gline = document.createElement("div");
  gline.className = "gl";
  gline.style.bottom = `${14 + 26 * (p.goal / top)}px`;
  gline.title = `meta ${fmtDur(p.goal)}`;
  hist.appendChild(gline);
  for (const h of p.history) {
    const hb = document.createElement("div");
    hb.className = "hb" + (h.total > p.cap ? " over" : h.total >= p.goal ? " met" : h.total ? " part" : "");
    hb.title = `${dayShort(h.date)} · ${fmtDur(h.total)}`;
    const bar = document.createElement("span");
    bar.style.height = `${Math.max(2, 26 * (h.total / top))}px`;
    const lab = document.createElement("small");
    lab.textContent = `${h.date.slice(8, 10)}/${h.date.slice(5, 7)}`;
    hb.append(bar, lab);
    hb.addEventListener("click", () => { team.date = h.date; loadTeam(); });
    hist.appendChild(hb);
  }
  body.appendChild(hist);
  return body;
}

async function savePerson(p, changes) {
  try {
    await send("TEAM_SAVE_PERSON", { accountId: p.accountId, name: p.name, ...changes });
    toast(`${p.name}: salvo.`, "ok");
    if (document.activeElement) document.activeElement.blur();
    team.pendingRender = false;
    await loadTeam({ silent: true });
  } catch (e) { toast(e.message); }
}

/* ---------- controles da aba ---------- */

document.querySelectorAll("#teamScope button").forEach((b) => b.addEventListener("click", () => {
  if (team.scope === b.dataset.scope) return;
  team.scope = b.dataset.scope;
  document.querySelectorAll("#teamScope button").forEach((x) => x.classList.toggle("on", x === b));
  team.data = null;
  loadTeam();
}));

const setTeamDate = (d) => { team.date = d > todayISO() ? todayISO() : d; team.data = null; team.lastOk = 0; loadTeam(); };
$("teamPrev").addEventListener("click", () => setTeamDate(businessStep(team.date, -1)));
$("teamNext").addEventListener("click", () => { const n = businessStep(team.date, 1); if (n <= todayISO()) setTeamDate(n); });
$("teamToday").addEventListener("click", () => setTeamDate(todayISO()));
$("teamDate").addEventListener("change", () => { if ($("teamDate").value) setTeamDate($("teamDate").value); });
$("teamPause").addEventListener("click", () => {
  team.paused = !team.paused;
  updateTeamLive();
  if (!team.paused) loadTeam({ silent: true });
});
document.querySelectorAll("#teamSort button").forEach((b) => b.addEventListener("click", () => {
  team.sort = b.dataset.sort;
  document.querySelectorAll("#teamSort button").forEach((x) => x.classList.toggle("on", x === b));
  renderTeam();
}));
let teamSearchTimer = null;
$("teamSearch").addEventListener("input", () => {
  clearTimeout(teamSearchTimer);
  teamSearchTimer = setTimeout(() => { team.q = $("teamSearch").value; renderTeam(); }, 120);
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pollTeam(); });

/* acompanhar alguém que ainda não apareceu */
$("btnTeamAdd").addEventListener("click", () => {
  $("teamAddBody").classList.toggle("hidden");
  if (!$("teamAddBody").classList.contains("hidden")) $("teamUserQuery").focus();
});
let teamUserTimer = null;
$("teamUserQuery").addEventListener("input", () => {
  clearTimeout(teamUserTimer);
  teamUserTimer = setTimeout(async () => {
    const box = $("teamUserResults");
    box.innerHTML = "";
    const q = $("teamUserQuery").value.trim();
    if (q.length < 2) return;
    try {
      const users = await send("TEAM_USER_SEARCH", { query: q });
      for (const u of users) {
        const b = document.createElement("button");
        b.className = "item";
        b.innerHTML = `<span class="p-av" style="width:22px;height:22px;font-size:9px"></span><span class="s"></span><span class="st">fixar</span>`;
        b.firstChild.style.background = avatarColor(u.accountId);
        b.firstChild.textContent = initials(u.name);
        b.querySelector(".s").textContent = u.name;
        b.addEventListener("click", async () => {
          await savePerson(u, { pinned: true, hidden: false });
          $("teamUserQuery").value = "";
          box.innerHTML = "";
          $("teamAddBody").classList.add("hidden");
        });
        box.appendChild(b);
      }
      if (!users.length) box.innerHTML = `<p class="muted xs">Ninguém encontrado.</p>`;
    } catch (e) { box.innerHTML = ""; note(box, "err", e.message); }
  }, 300);
});

/* =====================================================================
   Tamanho da tela
   ===================================================================== */

const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];
let uiScale = 1;

function applyScale(z, { save = true } = {}) {
  uiScale = ZOOM_STEPS.reduce((best, s) => (Math.abs(s - z) < Math.abs(best - z) ? s : best), 1);
  document.documentElement.style.setProperty("--z", String(uiScale));
  $("zoomVal").textContent = `${Math.round(uiScale * 100)}%`;
  $("zoomOut").disabled = uiScale <= ZOOM_STEPS[0];
  $("zoomIn").disabled = uiScale >= ZOOM_STEPS[ZOOM_STEPS.length - 1];
  // No overlay do Jira, a moldura acompanha o tamanho.
  if (inIframe) window.parent.postMessage({ type: "QUICKFILL_SCALE", scale: uiScale }, "*");
  if (save) { try { chrome.storage.local.set({ uiScale }); } catch { /* conveniência */ } }
}
const stepScale = (dir) => {
  const i = ZOOM_STEPS.indexOf(uiScale);
  applyScale(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))]);
};
$("zoomIn").addEventListener("click", () => stepScale(1));
$("zoomOut").addEventListener("click", () => stepScale(-1));
$("zoomVal").addEventListener("click", () => applyScale(1));
$("zoomVal").title = "Clique para voltar a 100%";
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key === "=" || e.key === "+") { e.preventDefault(); stepScale(1); }
  else if (e.key === "-") { e.preventDefault(); stepScale(-1); }
  else if (e.key === "0") { e.preventDefault(); applyScale(1); }
});

/* =====================================================================
   Meu dia
   ===================================================================== */

let daySeq = 0;
async function loadDay(date, { force = false } = {}) {
  state.dayDate = date;
  $("dayDate").value = date;
  $("dayNext").disabled = date >= todayISO();
  const seq = ++daySeq;
  $("dayBox").innerHTML = `<p class="muted xs">Carregando ${dayShort(date)}…</p>`;
  try {
    const rep = await send("DAY_REPORT", { date, days: qpDays(), force });
    if (seq === daySeq) renderDay(rep);
  } catch (e) {
    if (seq !== daySeq) return;
    $("dayBox").innerHTML = "";
    note($("dayBox"), "err", e.message);
  }
}

function renderDay(rawRep) {
  state.dayRep = rawRep;
  const rep = scopedDay(rawRep);
  const box = $("dayBox");
  box.innerHTML = "";
  const { goal, cap, start, end } = rep.workday;
  const tot = rep.total + mtgMin(rep.date);   // apontado + reuniões marcadas
  state.dayView = { date: rep.date, total: tot, goal };   // janela flutuante: o minimizado mostra o dia filtrado
  const colorOf = new Map(rep.issues.map((it, i) => [it.key, ISSUE_COLORS[i % ISSUE_COLORS.length]]));

  /* --- destaque: total x meta --- */
  const hero = document.createElement("div");
  hero.className = "hero";
  const top = document.createElement("div");
  top.className = "hero-top";
  const num = document.createElement("div");
  const lbl = document.createElement("div");
  lbl.className = "muted xs";
  lbl.textContent = `${dayShort(rep.date)}${rep.date === todayISO() ? " · hoje" : ""}`;
  const big = document.createElement("div");
  big.className = "hero-num";
  big.textContent = fmtDur(tot);
  const small = document.createElement("small");
  small.textContent = `de ${fmtDur(goal)}`;
  big.appendChild(small);
  num.append(lbl, big);

  const badge = document.createElement("span");
  if (tot > cap) { badge.className = "badge err"; badge.textContent = `Passou do teto de ${fmtDur(cap)}`; }
  else if (tot >= goal) { badge.className = "badge ok"; badge.textContent = tot > goal ? `✓ Meta batida · +${fmtDur(tot - goal)}` : "✓ Meta batida"; }
  else if (tot) { badge.className = "badge warn"; badge.textContent = `Faltam ${fmtDur(goal - tot)} para a meta`; }
  else { badge.className = "badge warn"; badge.textContent = "Nada apontado"; }
  top.append(num, badge);
  hero.appendChild(top);
  hero.appendChild(meter({ before: tot, add: 0, cap, goal, doneColor: true }));

  const segs = rep.entries.map((e) => ({
    start: e.start, minutes: e.minutes, color: colorOf.get(e.key),
    title: `${e.key} · ${fmtHM(e.start)}–${fmtHM(e.end)} · ${fmtDur(e.minutes)}`,
  }));
  const tr = track({ start, end }, segs);
  if (MTG_ON) attachMeetings(tr, { date: rep.date, now: rep.date === todayISO() ? nowMin() : null, onChange: rerenderMeetings });
  hero.append(tr.track, tr.scale);
  const sub = document.createElement("div");
  sub.className = "legend";
  const mtgD = tot - rep.total;
  sub.textContent = `${rep.issues.length} demanda${rep.issues.length === 1 ? "" : "s"}${mtgD ? ` · ${fmtDur(mtgD)} em reuniões` : ""} · teto ${fmtDur(cap)} · livre ${fmtDur(Math.max(0, cap - tot))}`;
  hero.appendChild(sub);
  if (tr.outside) note(hero, "info", `${fmtDur(tr.outside)} fora da jornada ${fmtHM(start)}–${fmtHM(end)} (área hachurada).`);
  box.appendChild(hero);
  if (MTG_ON) box.appendChild(meetingsCard(rep.date, { onChange: rerenderMeetings }));

  /* --- demandas do dia --- */
  const list = document.createElement("div");
  list.className = "card";
  const lt = document.createElement("div");
  lt.className = "card-t";
  lt.append(document.createTextNode("Demandas trabalhadas"));
  const lts = document.createElement("span");
  lts.textContent = rep.issues.length ? `${fmtDur(rep.total)} no total` : "";
  lt.appendChild(lts);
  list.appendChild(lt);

  if (!rep.issues.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.innerHTML = `<b>☕</b>Nenhum apontamento seu neste dia.`;
    list.appendChild(e);
  }
  for (const it of rep.issues) {
    const a = document.createElement("a");
    a.className = "work";
    a.href = `${rep.url}/browse/${it.key}`;
    a.target = "_blank";
    a.innerHTML = `<span class="dot"></span><span class="k"></span><span class="t"></span><span class="s"></span><span class="h"></span>`;
    a.querySelector(".dot").style.background = colorOf.get(it.key);
    const k = a.querySelector(".k");
    k.textContent = it.key;
    const st = document.createElement("em");
    st.className = "stx" + (it.statusCategory === "done" ? " done" : "");
    st.textContent = it.status;
    k.appendChild(st);
    a.querySelector(".t").textContent = fmtDur(it.minutes);
    a.querySelector(".s").textContent = it.summary || it.key;
    a.querySelector(".h").textContent =
      it.slots.map((s) => `${fmtHM(s.start)}–${fmtHM(s.end)}`).join("  ") + (it.parentKey ? `  ·  ${it.parentKey}` : "");
    list.appendChild(a);
  }
  box.appendChild(list);

  /* --- histórico dos dias úteis --- */
  const h = document.createElement("div");
  h.className = "card";
  const ht = document.createElement("div");
  ht.className = "card-t";
  if (rep.history.length <= 1) {   // período "Hoje": só o dia
    if (rep.date === todayISO()) updateDayPill(rawRep.total, goal);
    if (rep.scopedTo) note(box, "info", `Mostrando só ${rep.scopedTo}. A pílula do topo soma todos os espaços.`);
    return;
  }
  const histTotal = rep.history.reduce((s, x) => s + x.total, 0);
  ht.append(document.createTextNode(`Últimos ${rep.history.length} dias úteis${rep.scopedTo ? ` · ${rep.scopedTo}` : ""}`));
  const hts = document.createElement("span");
  hts.textContent = `${fmtDur(histTotal)} · média ${fmtDur(histTotal / rep.history.length)} · meta em ${rep.metDays} de ${rep.history.length}`;
  ht.appendChild(hts);
  h.appendChild(ht);

  const chart = document.createElement("div");
  const dense = rep.history.length > 12;   // 14/30 dias: colunas finas e rótulo só com o dia
  chart.className = `hist${dense ? " dense" : ""}${rep.history.length > 20 ? " xdense" : ""}`;
  // Mesma escala para barras e linha da meta: BAR_PX de área útil acima de LABEL_PX de rótulo.
  const BAR_PX = 80, LABEL_PX = 17;
  const gl = document.createElement("div");
  gl.className = "goal-line";
  gl.style.bottom = `${LABEL_PX + BAR_PX * (goal / cap)}px`;
  const gls = document.createElement("span");
  gls.textContent = `meta ${fmtDur(goal)}`;
  gl.appendChild(gls);
  chart.appendChild(gl);
  for (const d of rep.history) {
    const col = document.createElement("button");
    col.className = "hcol" + (d.goalMet ? " met" : d.total ? " part" : "") + (d.date === rep.date ? " cur" : "");
    col.title = `${dayShort(d.date)} · ${fmtDur(d.total)} · ${d.issues} ${pl(d.issues, "demanda", "demandas")}`;
    const bar = document.createElement("span");
    bar.className = "b";
    bar.style.height = `${Math.max(2, BAR_PX * Math.min(1, d.total / cap))}px`;
    const lab = document.createElement("small");
    lab.textContent = dense ? d.date.slice(8, 10) : `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}`;
    col.append(bar, lab);
    col.addEventListener("click", () => loadDay(d.date));
    chart.appendChild(col);
  }
  h.appendChild(chart);
  h.appendChild(legend([["var(--ok)", "meta batida"], ["var(--data)", "abaixo da meta"], ["var(--surface-3)", "sem apontamento"]]));
  box.appendChild(h);

  if (rep.date === todayISO()) updateDayPill(rawRep.total, goal);
  if (rep.scopedTo) note(box, "info", `Mostrando só ${rep.scopedTo}. A pílula do topo soma todos os espaços.`);
}

$("dayPrev").addEventListener("click", () => loadDay(businessStep(state.dayDate, -1)));
$("dayNext").addEventListener("click", () => { const n = businessStep(state.dayDate, 1); if (n <= todayISO()) loadDay(n); });
$("dayToday").addEventListener("click", () => loadDay(todayISO()));
$("dayRefresh").addEventListener("click", () => loadDay(state.dayDate, { force: true }));
$("dayDate").addEventListener("change", () => { const v = $("dayDate").value; if (v) loadDay(v > todayISO() ? todayISO() : v); });

/* ---------- pílula do topo ---------- */

/* Reuniões na linha do tempo (teste, nos 4 perfis): contam na meta do dia se a opção estiver ligada. */
const MTG_ON = true;
const mtgMin = (date) => (MTG_ON ? meetingMinutes(date) : 0);
function rerenderMeetings(item) {
  const fromJira = !!item?.jiraKey;   // virou demanda com apontamento: recarrega do Jira
  if (state.mode === "day" && state.dayRep) { if (fromJira) loadDay(state.dayDate, { force: true }); else renderDay(state.dayRep); }
  if (state.mode === "today" && DV.prog) { if (fromJira) loadToday({ force: true }); else renderToday(); }
  if (state.mode === "team" && typeof renderTeam === "function") renderTeam();
  if (state.mode === "single") refreshPreviews();
  refreshDayPill(fromJira);
}
if (MTG_ON) { setMeetingApi({ send }); loadMeetings().then(() => rerenderMeetings()); onMeetingsChange(() => rerenderMeetings()); }

function updateDayPill(total, goal) {
  total += mtgMin(todayISO());
  const C = 94.25;
  $("ringFg").style.strokeDashoffset = String(C * (1 - Math.min(1, total / goal)));
  $("dayPillVal").textContent = fmtDur(total);
  $("dayPillGoal").textContent = total >= goal ? "meta batida" : `meta ${fmtDur(goal)}`;
  $("dayPill").classList.toggle("met", total >= goal);
  $("dayPill").title = `Hoje: ${fmtDur(total)} de ${fmtDur(goal)} (meta) · teto ${fmtDur(DEF.workday.cap)}`;
}

async function refreshDayPill(force = false) {
  try {
    const rep = await send("DAY_REPORT", { date: todayISO(), days: 1, force });
    updateDayPill(rep.total, rep.workday.goal);
  } catch { $("dayPillVal").textContent = "—"; }
}
$("dayPill").addEventListener("click", () => {
  if (HAS_PROG) { DV.date = todayISO(); setMode("today"); return; }
  if (IS_DASH) { setMode("team"); return; }   // SCRUM: sem "Hoje" — a pílula leva à Equipe
  state.dayDate = todayISO(); setMode("day");
});

/* =====================================================================
   Aplicar
   ===================================================================== */

const commonPayload = () => ({
  dueDate: $("dueDate").value || null,
  startDate: $("startDate").value || null,
  startTime: $("startTime").value || "",
  originalEstimate: $("estimate").value.trim(),
  timeSpent: $("spent").value.trim(),
  worklogComment: $("worklogComment").value.trim(),
  storyPoints: state.storyPoints,
});

async function apply() {
  if (VIEW_TABS.includes(state.mode) || $("formCard").classList.contains("hidden")) return;
  toast(null);
  return isSpace(state.mode) ? applyBatch() : applySingle();
}

async function afterApply() {
  $("spent").value = "";      // já apontado: evita lançar duas vezes sem querer
  setFormValues({ startTime: "", ...defaultEnd() });
  refreshPreviews();
  refreshWorkday({ force: true, delay: 0 });
  refreshDayPill(true);
  state.panel.data = null;    // horas e status mudaram: o painel recarrega na próxima abertura
  $("result").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function applySingle() {
  if (!state.selected) return toast("Escolha uma subtarefa primeiro.");
  const ctx = state.selected;
  const sel = $("statusSel");
  busy(true);
  try {
    const res = await send("APPLY", {
      ...commonPayload(),
      key: ctx.key,
      startFieldId: ctx.startField?.id || null,
      startFieldType: ctx.startField?.type || "date",
      currentStartDate: ctx.current.startDate || null,
      currentEstimate: ctx.current.originalEstimate || null,
      currentSpent: ctx.current.timeSpent || null,
      storyFieldId: ctx.storyField?.id || null,
      transitionId: sel.value || null,
      transitionName: sel.selectedOptions[0]?.dataset.name || "",
      finalize: sel.selectedOptions[0]?.dataset.cat === "done",
    });
    // Mantém o "trabalhado" e a estimativa atuais em dia para o próximo apontamento na mesma tarefa.
    const payload = commonPayload();
    const added = parseDuration(payload.timeSpent).minutes || 0;
    if (added) ctx.current.timeSpent = fmtDur((parseDuration(ctx.current.timeSpent).minutes || 0) + added);
    const wrote = (res.steps || []).find((s) => s.step === "Campos" && s.ok)?.detail?.match(/estimativa ([\dhmdw ]+)/);
    if (wrote) ctx.current.originalEstimate = wrote[1].trim();
    const curStart = (ctx.current.startDate || "").slice(0, 10);
    if (ctx.startField && payload.startDate && (!curStart || payload.startDate < curStart)) ctx.current.startDate = payload.startDate;
    state.lastResult = { kind: "single", data: res };
    renderSingleResult(res);
    toast(res.ok ? `${res.key} atualizada.` : `${res.key}: algumas etapas falharam.`, res.ok ? "ok" : "err");
    await afterApply();
    touch();
  } catch (e) { toast(e.message); } finally { busy(false); }
}

async function applyBatch() {
  const sp = space();
  const checked = new Set(sp.checked);
  const targets = sp.targets.filter((t) => checked.has(t.key));
  if (!targets.length) return toast("Marque ao menos uma subtarefa.");
  const c = commonPayload();
  if (!c.dueDate && !c.originalEstimate && !c.timeSpent && !$("statusSel").value && c.storyPoints == null) {
    return toast("Preencha ao menos um campo para aplicar.");
  }
  busy(true);
  $("batchProgress").classList.remove("hidden");
  try {
    const res = await send("APPLY_BATCH", {
      ...c,
      statusName: $("statusSel").value || "",
      targets: targets.map((t) => ({
        key: t.key, summary: t.summary, status: t.status,
        startField: t.startField, storyField: t.storyField, transitions: t.transitions,
        currentStartDate: t.current?.startDate || null,
        currentEstimate: t.current?.originalEstimate || null,
        currentSpent: t.current?.timeSpent || null,
      })),
    });
    state.lastResult = { kind: "batch", data: res };
    renderBatchResult(res);
    toast(`${res.succeeded} de ${res.total} subtarefas atualizadas.`, res.succeeded === res.total ? "ok" : "err");
    await afterApply();
    touch();
  } catch (e) { toast(e.message); } finally { busy(false); $("batchProgress").classList.add("hidden"); }
}

/* ---------- resultados ---------- */

function stepLine(s) {
  const l = document.createElement("div");
  l.className = "line";
  const i = document.createElement("span");
  i.className = `ico ${s.ok ? "ok" : "err"}`;
  i.textContent = s.ok ? "✓" : "✕";
  const m = document.createElement("span");
  m.className = "m";
  m.textContent = `${s.step}${s.detail ? ` — ${s.detail}` : ""}`;
  l.append(i, m);
  return l;
}

function resultHead(ok, text) {
  const h = document.createElement("div");
  h.className = `res-head ${ok ? "ok" : "err"}`;
  h.textContent = text;
  return h;
}

function link(href, text) {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.textContent = text;
  return a;
}

function renderSingleResult(res) {
  const box = $("result");
  box.innerHTML = "";
  box.appendChild(resultHead(res.ok, res.ok ? `✓ ${res.key} atualizada` : `${res.key}: algumas etapas falharam`));
  res.steps.forEach((s) => box.appendChild(stepLine(s)));
  if (res.url) box.appendChild(link(res.url, `Abrir ${res.key} no Jira ↗`));
  box.classList.remove("hidden");
}

function renderBatchResult(res) {
  const box = $("result");
  box.innerHTML = "";
  box.appendChild(resultHead(res.succeeded === res.total, `${res.succeeded} de ${res.total} subtarefas atualizadas sem erros`));
  for (const r of res.results) {
    const d = document.createElement("details");
    d.className = "res-item";
    if (!r.ok) d.open = true;
    const s = document.createElement("summary");
    const i = document.createElement("span");
    i.className = `ico ${r.ok ? "ok" : "err"}`;
    i.textContent = r.ok ? "✓" : "✕";
    const b = document.createElement("b");
    b.textContent = r.key;
    const m = document.createElement("span");
    m.className = "m";
    m.textContent = r.summary || "";
    s.append(i, b, m);
    d.appendChild(s);
    r.steps.forEach((x) => d.appendChild(stepLine(x)));
    if (r.url) d.appendChild(link(r.url, "Abrir no Jira ↗"));
    box.appendChild(d);
  }
  box.classList.remove("hidden");
}

function renderCreateResult(res) {
  const box = $("result");
  box.innerHTML = "";
  box.appendChild(resultHead(!res.failed, `${res.created} ${pl(res.created, "criada", "criadas")} · ${res.reused} ${pl(res.reused, "já existia", "já existiam")} · ${res.failed} com erro`));
  for (const r of res.results) {
    box.appendChild(stepLine({ ok: r.ok, step: `${r.parentKey}${r.key ? ` → ${r.key}` : ""}`, detail: r.detail }));
  }
  box.classList.remove("hidden");
  state.lastResult = { kind: "create", data: res };
}

/* =====================================================================
   Rascunho: restaurar / descartar
   ===================================================================== */

async function restore(defaults) {
  const draft = await loadDraft();
  if (!draft) return false;

  $("parentKey").value = draft.parentKey || "";
  state.parent = draft.parent || null;
  // Rascunhos antigos guardavam "batch"/"sustentacao" como aba.
  if (SPACES.includes(draft.mode)) { state.spaceId = draft.mode; draft.mode = "lote"; }
  else if (SPACES.includes(draft.spaceId)) state.spaceId = draft.spaceId;
  state.subtasks = draft.subtasks || [];
  state.selected = draft.selected || null;
  state.lastResult = draft.lastResult || null;
  for (const id of SPACES) {
    state.spaces[id] = { ...blankSpace(), ...(draft.spaces?.[id] || {}) };
    state.spaces[id].project = defaults?.spaces?.[id]?.project || "";
    if (!state.spaces[id].columns) state.spaces[id].columns = defaults?.spaces?.[id]?.columns || "";
    if (!state.spaces[id].boardId) state.spaces[id].boardId = defaults?.spaces?.[id]?.boardId || "";
  }
  const c = draft.create || {};
  for (const id of CREATE_IDS) if (c[id] !== undefined) ($(id).type === "checkbox" ? ($(id).checked = !!c[id]) : ($(id).value = c[id]));

  setMode(draft.mode || "single", { restoring: true });
  if (state.subtasks.length) renderSubtasks();
  if (state.mode === "single" && state.selected) {
    applySingleContext(state.selected, {
      storyPoints: DEF.defaultStoryPoints,
      ...(draft.form?.timeMode ? {} : defaultEnd()),
      ...(draft.form || {}),
    });
  }

  if (state.lastResult) {
    const { kind, data } = state.lastResult;
    kind === "batch" ? renderBatchResult(data) : kind === "create" ? renderCreateResult(data) : renderSingleResult(data);
  }
  $("restored").querySelector("span").textContent = `Rascunho restaurado (salvo ${since(draft.savedAt)}).`;
  $("restored").classList.remove("hidden");
  setTimeout(() => $("restored").classList.add("hidden"), 6000);
  return true;
}

async function discardAll() {
  await clearDraft();
  const defaults = await send("GET_DEFAULTS").catch(() => null);
  state.subtasks = [];
  state.parent = null;
  state.selected = null;
  state.lastResult = null;
  for (const id of SPACES) {
    state.spaces[id] = blankSpace();
    state.spaces[id].project = defaults?.spaces?.[id]?.project || "";
    state.spaces[id].columns = defaults?.spaces?.[id]?.columns || "";
    state.spaces[id].boardId = defaults?.spaces?.[id]?.boardId || "";
  }
  $("parentKey").value = "";
  $("subtaskList").innerHTML = "";
  $("batchErrors").classList.add("hidden");
  $("result").classList.add("hidden");
  $("restored").classList.add("hidden");
  $("ctxLine").textContent = "Subtarefas do Jira";
  setFormValues(blankForm());
  state.panel.data = null;
  setMode(state.mode);
  if (isSpace(state.mode)) initBoards();
  toast("Rascunho descartado.", "info");
}

/* =====================================================================
   Espaço global (QA): Todos · MEED · SUS — vale para todas as abas
   ===================================================================== */

const gspace = { project: "", projects: [] };

function setGlobalSpace(project) {
  gspace.project = project;
  document.querySelectorAll("#globalSpace button").forEach((b) => b.classList.toggle("on", b.dataset.project === project));
  try { localStorage.setItem("qf.gspace", project); } catch { /* sem storage */ }
  if (state.mode === "today") renderToday();
  if (state.mode === "progress") renderProgress();
  if (state.mode === "demands") renderDemands();
  if (["sprint", "people", "risks"].includes(state.mode)) renderScrum();
  if (state.mode === "hus") renderHus();
  if (state.mode === "qaq") renderQaQueue();
  if (state.mode === "panel") { renderPanel(); renderSprints(); }
  if (state.mode === "team") renderTeam();
  if (state.mode === "day" && state.dayRep) renderDay(state.dayRep);
}

function renderGlobalSpace(projects) {
  gspace.projects = projects;
  const seg = $("globalSpace");
  seg.innerHTML = "";
  // DESIGN com um único projeto: só ele (o "Todos" seria o mesmo recorte)
  const single = ROLE === "design" && projects.length === 1;
  if (single) gspace.project = projects[0];
  for (const p of single ? projects : ["", ...projects]) {
    const b = document.createElement("button");
    b.dataset.project = p;
    b.textContent = p || "Todos";
    b.classList.toggle("on", gspace.project === p);
    b.addEventListener("click", () => setGlobalSpace(p));
    seg.appendChild(b);
  }
  $("spaceInfo").textContent = "";
}

/** DESIGN com espaço próprio: "Todos" = só os projetos de Design (Opções), nunca MEED/SUS. */
const designOnly = () => (ROLE === "design" && DEF.designProjects?.length ? new Set(DEF.designProjects) : null);
const inSpace = (key) => {
  const p = String(key).split("-")[0];
  if (gspace.project) return p === gspace.project;
  const only = designOnly();
  return !only || only.has(p);
};

/** Equipe só com o que é do espaço escolhido (totais e estado recalculados). */
/** Equipe só com o que é do espaço escolhido (totais e estado recalculados). */
function scopedTeam(d) {
  if (!d || (!gspace.project && !designOnly())) return d;
  const people = d.people.map((p) => {
    const entries = p.entries.filter((e) => inSpace(e.key));
    const issues = p.issues.filter((i) => inSpace(i.key));
    const total = entries.reduce((sum, e) => sum + e.minutes, 0);
    return { ...p, entries, issues, total,
      state: total === 0 ? "none" : total > p.cap ? "over" : total >= p.goal ? "met" : "under" };
  });
  return { ...d, people };
}

function scopedDay(rep) {
  if (!rep || (!gspace.project && !designOnly())) return rep;
  const entries = rep.entries.filter((e) => inSpace(e.key));
  const issues = rep.issues.filter((i) => inSpace(i.key));
  const total = entries.reduce((sum, e) => sum + e.minutes, 0);
  const { goal, cap } = rep.workday;
  // Histórico também por espaço (o serviço manda a divisão por projeto de cada dia)
  const history = (rep.history || []).map((h) => {
    if (!h.projects) return h;
    const t = Object.entries(h.projects).filter(([p]) => inSpace(`${p}-0`)).reduce((s, [, m]) => s + m, 0);
    return { ...h, total: t, goalMet: t >= goal, issues: (h.keys || []).filter((k) => inSpace(k)).length };
  });
  return { ...rep, entries, issues, total, history, metDays: history.filter((h) => h.goalMet).length,
    goalMet: total >= goal, overCap: total > cap, scopedTo: gspace.project || (designOnly() ? [...designOnly()].join("+") : "") };
}

/* =====================================================================
   Peças visuais compartilhadas (DEV)
   ===================================================================== */

function fmtSpan(ms) {
  const h = ms / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))}m`;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  return `${d < 10 ? d.toFixed(1).replace(".", ",") : Math.round(d)}d`;
}
const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const brShort = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function mCard(title, sub) {
  const c = el("section", "card m-card");
  const t = el("div", "card-t");
  t.append(el("b", null, title));
  if (sub) t.append(el("span", null, sub));
  c.appendChild(t);
  return c;
}

function issueLine(issue, right, sub, base = DEF.baseUrl) {
  const r = el("div", "m-row");
  const main = el("div", "m-row-main");
  const top = el("div", "m-row-top");
  top.append(el("span", "k", issue.key), el("span", "s", issue.summary));
  main.appendChild(top);
  if (sub) main.appendChild(el("div", "m-row-sub", sub));
  r.append(main);
  if (right != null) r.appendChild(typeof right === "string" ? el("span", "m-row-r", right) : right);
  r.append(histLink(issue.key, { base, label: "" }), jiraLink(issue.key, { base, label: "" }));
  return r;
}

/* ---------- Dica flutuante (hover) ---------- */

const tipEl = el("div", "tip hidden");
document.body.appendChild(tipEl);
document.addEventListener("mouseover", (e) => {
  const t = e.target.closest?.("[data-tip]");
  if (!t) { tipEl.classList.add("hidden"); return; }
  tipEl.textContent = t.dataset.tip;
  tipEl.classList.remove("hidden");
  const z = uiScale || 1;
  const br = t.getBoundingClientRect();
  const r = { left: br.left / z, top: br.top / z, bottom: br.bottom / z, width: br.width / z };
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  const vw = window.innerWidth / z;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(6, Math.min(vw - w - 6, x));
  let y = r.top - h - 6;
  if (y < 4) y = r.bottom + 6;
  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${y}px`;
});
document.addEventListener("scroll", () => tipEl.classList.add("hidden"), true);



/* =====================================================================
   QuickFill DEV — Hoje · Progresso · Demandas
   ===================================================================== */

const PREFS_DEFAULT = { pace: true, streak: true, history: true, timeline: true, issues: true, team: true, week: true, where: true,
  autoRefresh: true, refreshMin: 1 };
const PREF_GROUPS = [
  ["Hoje", [
    ["streak", "🔥 Sequência e média (chips)"],
    ["pace", "Ritmo do dia (você x sua média até esta hora)"],
    ["timeline", "Linha do tempo do dia"],
    ["issues", "No que você atuou"],
    ["history", "Seus últimos dias (barras)"],
    ["team", "Equipe no dia"],
  ]],
  ["Progresso", [
    ["week", "Esta semana x semana passada"],
    ["where", "Onde foi seu tempo"],
  ]],
];
const DV = { prog: null, date: todayISO(), team: null, teamDate: null, prefs: { ...PREFS_DEFAULT }, period: "14", sprints: null,
  dm: null, dmPeriod: "today", dmPrio: "", poll: null, seq: 0, sprintSel: "", onlySprint: true, sprintKeys: new Map() };
const PROG_CACHE_DAYS = 62;
const TODAY_POLL_MS = 60 * 1000;

async function loadPrefs() {
  try {
    const { devPrefs, devPeriod, devDmPeriod, devOnlySprint } = await chrome.storage.local.get({ devPrefs: {}, devPeriod: "14", devDmPeriod: "today", devOnlySprint: true });
    DV.prefs = { ...PREFS_DEFAULT, ...devPrefs };
    DV.period = devPeriod;
    DV.dmPeriod = devDmPeriod;
    DV.onlySprint = devOnlySprint !== false;
  } catch { /* sem storage */ }
  document.querySelectorAll("#pgPeriod button").forEach((b) => b.classList.toggle("on", b.dataset.period === DV.period));
  document.querySelectorAll("#dmPeriod button").forEach((b) => b.classList.toggle("on", b.dataset.period === DV.dmPeriod));
}
const savePrefs = () => chrome.storage.local.set({ devPrefs: DV.prefs, devPeriod: DV.period, devDmPeriod: DV.dmPeriod, devOnlySprint: DV.onlySprint }).catch(() => {});

/** Junta dias buscados ao que já está carregado. */
function mergeProg(fresh) {
  if (!DV.prog || DV.prog.me?.accountId !== fresh.me?.accountId) { DV.prog = fresh; return; }
  for (const d of daysOfRange(fresh.from, fresh.to)) {
    if (fresh.days[d]) DV.prog.days[d] = fresh.days[d]; else delete DV.prog.days[d];
  }
  DV.prog.from = fresh.from < DV.prog.from ? fresh.from : DV.prog.from;
  DV.prog.to = fresh.to > DV.prog.to ? fresh.to : DV.prog.to;
  DV.prog.workday = fresh.workday;
  DV.prog.skipWeekends = fresh.skipWeekends;
  DV.prog.url = fresh.url;
  DV.prog.fetchedAt = fresh.fetchedAt;
}
const daysOfRange = (a, b) => { const out = []; for (let d = a; d <= b; d = addDaysIso(d, 1)) out.push(d); return out; };

/** Guarda o histórico no navegador: ao abrir de novo, aparece na hora e só o recente é relido. */
function persistProg() {
  if (!DV.prog) return;
  const min = addDaysIso(todayISO(), -PROG_CACHE_DAYS);
  const days = Object.fromEntries(Object.entries(DV.prog.days).filter(([d]) => d >= min));
  chrome.storage.local.set({ devProg: { ...DV.prog, from: DV.prog.from < min ? min : DV.prog.from, days } }).catch(() => {});
}

/**
 * Garante apontamentos de `from` até hoje, buscando SÓ o que falta
 * (antes: qualquer mudança relia o intervalo inteiro).
 */
async function ensureProg(from, { force = false } = {}) {
  const today = todayISO();
  if (force || !DV.prog) {
    mergeProg(await send("MY_PROGRESS", { from, to: today, force }));
  } else {
    const jobs = [];
    if (from < DV.prog.from) jobs.push(send("MY_PROGRESS", { from, to: addDaysIso(DV.prog.from, -1) }));
    if (DV.prog.to < today) jobs.push(send("MY_PROGRESS", { from: addDaysIso(DV.prog.to, 1), to: today }));
    for (const r of await Promise.all(jobs)) mergeProg(r);
  }
  persistProg();
  return DV.prog;
}

/** Na abertura: mostra o que está guardado e relê os últimos dias em segundo plano. */
async function warmProg() {
  try {
    const { devProg } = await chrome.storage.local.get({ devProg: null });
    if (devProg?.days && devProg.to) DV.prog = devProg;
  } catch { /* sem cache */ }
  if (!DV.prog) return false;
  const recentFrom = addDaysIso(todayISO(), -3) > DV.prog.from ? addDaysIso(todayISO(), -3) : DV.prog.from;
  send("MY_PROGRESS", { from: recentFrom, to: todayISO(), force: true })
    .then((r) => { mergeProg(r); persistProg(); if (state.mode === "today") renderToday(); if (state.mode === "progress") renderProgress(); refreshDayPill(); })
    .catch(() => {});
  return true;
}

/** Atualiza só o dia de hoje e junta ao que já está carregado. */
async function refreshTodayOnly() {
  if (!DV.prog) return;
  const t = todayISO();
  const fresh = await send("MY_PROGRESS", { from: t, to: t, force: true });
  DV.prog.days[t] = fresh.days[t] || [];
  DV.prog.workday = fresh.workday;
  DV.prog.fetchedAt = fresh.fetchedAt;
  DV.prog.to = t;
  persistProg();
}

function scopeEntries(list) { return (list || []).filter((e) => inSpace(e.key)); }

/** Visão do progresso já filtrada pelo espaço escolhido. */
function scopedProg() {
  const p = DV.prog;
  if (!p || !gspace.project) return p;
  return { ...p, days: Object.fromEntries(Object.entries(p.days).map(([d, l]) => [d, scopeEntries(l)])) };
}

/* ---------------- Hoje ---------------- */

async function loadToday({ force = false } = {}) {
  const seq = ++DV.seq;
  const d = DV.date;
  $("tdDate").value = d;
  $("tdDate").max = todayISO();
  $("tdNext").disabled = d >= todayISO();
  const need = addDaysIso(d, -20);   // 10 dias úteis para média e sequência
  const ready = DV.prog && DV.prog.from <= need && DV.prog.to >= d;
  if (ready && !force) {
    renderToday();                     // já carregado: troca de dia instantânea
  } else if (!DV.prog) {
    $("todayBox").innerHTML = `<p class="muted xs">Carregando seus apontamentos…</p>`;
  } else {
    $("todayBox").classList.add("loading");
  }
  if (DV.prefs.team) loadTeamFor(d, { force });
  if (ready && !force) return;
  try {
    await ensureProg(need, { force });
    if (seq !== DV.seq) return;
    renderToday();
  } catch (e) {
    if (seq !== DV.seq) return;
    $("todayBox").innerHTML = "";
    note($("todayBox"), "err", e.message);
  } finally {
    if (seq === DV.seq) $("todayBox").classList.remove("loading");
  }
}

let teamSeq = 0;
async function loadTeamFor(date, { force = false } = {}) {
  const seq = ++teamSeq;
  try {
    const rep = await send("TEAM_REPORT", { date, scope: "cfg", projects: gspace.projects, light: true, force });
    if (seq !== teamSeq) return;
    DV.team = rep;
    DV.teamDate = date;
    if (state.mode === "today" && DV.date === date) renderTeamToday();
  } catch { /* equipe é complementar */ }
}

function startTodayPolling() {
  stopTodayPolling();
  const every = Math.max(1, Number(DV.prefs.refreshMin) || 1) * 60 * 1000;
  DV.poll = setInterval(async () => {
    if (!DV.prefs.autoRefresh || DV.date !== todayISO() || document.hidden) return;
    if (Date.now() < (DV.backoffUntil || 0)) return;   // o Jira pediu pausa
    try {
      await refreshTodayOnly();
      DV.backoff = 0; DV.backoffUntil = 0;
      if (state.mode === "today") { renderToday(); if (DV.prefs.team) loadTeamFor(DV.date); }
      if (ROLE !== "scrum") refreshDayPill();   // SCRUM não acompanha as próprias horas
    } catch (e) {
      if (isRateLimited(e?.message)) { DV.backoff = nextBackoff(DV.backoff); DV.backoffUntil = Date.now() + DV.backoff; }
    }
  }, every);
}
function stopTodayPolling() { if (DV.poll) clearInterval(DV.poll); DV.poll = null; }

/** Anel de progresso do dia: arco até o teto, marca na meta. */
function bigRing(total, goal, cap) {
  const R = 52, C = 2 * Math.PI * R;
  const frac = Math.min(1, total / cap);
  const color = total > cap ? "var(--err)" : total >= goal ? "var(--ok)" : "var(--data)";
  const g = goal / cap;
  const ang = g * 2 * Math.PI - Math.PI / 2;
  const tx = 60 + Math.cos(ang) * R, ty = 60 + Math.sin(ang) * R;
  const wrap = el("div", "bigring");
  wrap.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="11"/>
    <circle cx="60" cy="60" r="${R}" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"
      stroke-dasharray="${(frac * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/>
    <circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="4.5" fill="var(--warn)" stroke="var(--surface)" stroke-width="2"/>
  </svg>`;
  const mid = el("div", "bigring-mid");
  mid.append(el("b", null, fmtDur(total)), el("small", null, `de ${fmtDur(goal)}`));
  wrap.appendChild(mid);
  wrap.dataset.tip = `${fmtDur(total)} apontados · meta ${fmtDur(goal)} (ponto amarelo) · teto ${fmtDur(cap)} (volta completa)`;
  return wrap;
}

function chip(text, tone, tip) {
  const c = el("span", `chip ${tone || ""}`, text);
  if (tip) c.dataset.tip = tip;
  return c;
}

function renderToday() {
  const box = $("todayBox");
  const prog = scopedProg();
  if (!prog) return;
  box.innerHTML = "";
  const d = DV.date, today = todayISO(), isToday = d === today;
  const { goal, cap, start: ws, end: we } = prog.workday;
  const entries = prog.days[d] || [];
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  const issues = byIssue(entries);
  const colorOf = new Map(issues.map((it, i) => [it.key, ISSUE_COLORS[i % ISSUE_COLORS.length]]));
  const avg = averageBefore(prog, d, 10);
  const streak = streakAt(prog, d);
  const mtg = mtgMin(d);                  // reuniões marcadas na linha do tempo
  const gt = total + mtg;                 // o que conta na meta
  DV.view = { date: d, total: gt, goal };   // janela flutuante: o minimizado mostra o dia filtrado

  /* --- herói --- */
  const hero = el("div", "card dv-hero");
  hero.appendChild(bigRing(gt, goal, cap));
  const side = el("div", "dv-hero-side");
  side.appendChild(el("div", "muted xs", `${dayShort(d)}${isToday ? " · hoje" : d === addDaysIso(today, -1) ? " · ontem" : ""}${gspace.project ? ` · só ${gspace.project}` : ""}`));
  let title, sub, tone = "";
  const now = nowMin();
  if (gt > cap) { title = "Passou do teto"; sub = `${fmtDur(gt - cap)} acima de ${fmtDur(cap)}.`; tone = "err"; }
  else if (gt >= goal) { title = isToday ? "Meta batida! 🎉" : "Meta batida ✓"; sub = gt > goal ? `${fmtDur(gt - goal)} além da meta.` : "Na medida certa."; tone = "ok"; }
  else if (!gt) { title = isToday ? (now < ws ? "O dia ainda não começou" : "Nada apontado ainda") : "Dia sem apontamento"; sub = isToday ? `Meta de hoje: ${fmtDur(goal)}.` : ""; tone = isToday ? "" : "warn"; }
  else if (isToday) {
    const left = goal - gt;
    const rest = Math.max(0, we - Math.max(now, ws));
    title = `Faltam ${fmtDur(left)}`;
    sub = rest >= left ? `Dá tempo: restam ${fmtDur(rest)} de jornada (até ${fmtHM(we)}).` : rest ? `Restam só ${fmtDur(rest)} de jornada até ${fmtHM(we)}.` : `A jornada terminou às ${fmtHM(we)}.`;
    tone = rest >= left ? "" : "warn";
  } else { title = `Ficou ${fmtDur(goal - gt)} abaixo`; sub = `Meta ${fmtDur(goal)}.`; tone = "warn"; }
  side.append(el("div", `dv-title ${tone}`, title));
  if (sub) side.append(el("div", "dv-sub", sub));
  if (mtg) side.append(el("div", "dv-sub", `${fmtDur(total)} apontadas + ${fmtDur(mtg)} em reuniões`));

  const chips = el("div", "chips-row");
  if (DV.prefs.streak) {
    chips.appendChild(streak.days
      ? chip(`🔥 ${streak.days} dia${streak.days > 1 ? "s" : ""} seguido${streak.days > 1 ? "s" : ""}`, "hot", streak.includesToday ? "Dias seguidos batendo a meta, contando hoje" : "Dias seguidos batendo a meta até ontem — bata hoje para continuar")
      : chip("Sequência zerada", "", "Bata a meta para começar uma sequência"));
  }
  if (avg) {
    const diff = total - avg;
    chips.appendChild(chip(`média ${fmtDur(avg)}`, "", "Média dos seus últimos 10 dias úteis"));
    if (!isToday && total) chips.appendChild(chip(`${diff >= 0 ? "+" : "−"}${fmtDur(Math.abs(diff))} vs média`, diff >= 0 ? "ok" : "warn"));
  }
  chips.appendChild(chip(`${issues.length} demanda${issues.length === 1 ? "" : "s"}`));
  side.appendChild(chips);
  hero.appendChild(side);
  box.appendChild(hero);

  /* --- ritmo (só hoje) --- */
  if (DV.prefs.pace && isToday && now > ws) {
    const until = averageUntil(prog, d, now, 10);
    const sofar = entries.reduce((s, e) => s + Math.max(0, Math.min(e.start + e.minutes, now) - e.start), 0);
    if (until > 0) {
      const ahead = sofar - until;
      const pace = el("div", `dv-pace ${ahead >= 0 ? "up" : "down"}`);
      pace.append(el("b", null, ahead >= 0 ? "▲" : "▼"),
        el("span", null, `Até ${fmtHM(now)} você costuma ter ${fmtDur(until)} — hoje está com ${fmtDur(sofar)} (${ahead >= 0 ? "+" : "−"}${fmtDur(Math.abs(ahead))}).`));
      box.appendChild(pace);
    }
  }

  /* --- linha do tempo --- */
  if (DV.prefs.timeline && (entries.length || MTG_ON)) {
    const card = mCard("Linha do tempo", `${fmtHM(ws)}–${fmtHM(we)}`);
    const tr = track({ start: ws, end: we }, entries.map((e) => ({
      start: e.start, minutes: e.minutes, color: colorOf.get(e.key),
      title: `${e.key} · ${fmtHM(e.start)}–${fmtHM(e.start + e.minutes)} · ${fmtDur(e.minutes)}`,
    })));
    if (isToday && now > ws && now < Math.max(we, ...entries.map((e) => e.start + e.minutes))) {
      const lo = Math.min(ws, ...entries.map((e) => Math.floor(e.start / 60) * 60));
      const hi = Math.max(we, ...entries.map((e) => Math.ceil((e.start + e.minutes) / 60) * 60));
      const nowLine = el("span", "now-line");
      nowLine.style.left = `${((now - lo) / (hi - lo)) * 100}%`;
      nowLine.dataset.tip = `agora · ${fmtHM(now)}`;
      tr.track.appendChild(nowLine);
    }
    if (MTG_ON) attachMeetings(tr, { date: d, now: isToday ? now : null, onChange: rerenderMeetings });
    card.append(tr.track, tr.scale);
    box.appendChild(card);
    if (MTG_ON) box.appendChild(meetingsCard(d, { onChange: rerenderMeetings }));
  }

  /* --- demandas do dia --- */
  if (DV.prefs.issues) {
    const card = mCard("No que você atuou", total ? `${fmtDur(total)} em ${issues.length}` : "");
    card.classList.add("half");
    if (!issues.length) card.appendChild(el("p", "muted xs", isToday ? "Assim que você apontar no Jira, aparece aqui." : "Nenhum apontamento neste dia."));
    for (const it of issues) {
      const share = el("span", "dv-share");
      const bar = el("i");
      bar.style.width = `${(it.minutes / Math.max(1, total)) * 100}%`;
      bar.style.background = colorOf.get(it.key);
      share.appendChild(bar);
      const right = el("span", "m-row-r", fmtDur(it.minutes));
      const line = issueLine(it, right, `${it.status}${it.parentKey ? ` · ↳ ${it.parentKey}` : ""} · ${it.slots.map((s) => `${fmtHM(s.start)}–${fmtHM(s.end)}`).join(", ")}`);
      line.querySelector(".m-row-main").appendChild(share);
      const dot = el("i", "dv-dot"); dot.style.background = colorOf.get(it.key);
      line.prepend(dot);
      card.appendChild(line);
    }
    box.appendChild(card);
  }

  /* --- últimos dias --- */
  if (DV.prefs.history) {
    const days = countedDays(prog, addDaysIso(d, -20), d).slice(-10);
    const card = mCard("Seus últimos dias", `${days.filter((x) => totalOf(prog, x) >= goal).length}/${days.length} com meta`);
    card.classList.add("half");
    const strip = el("div", "dv-strip");
    const max = Math.max(cap, ...days.map((x) => totalOf(prog, x)));
    for (const x of days) {
      const t = totalOf(prog, x);
      const col = el("button", "dv-col" + (x === d ? " cur" : "") + (t >= goal ? " met" : t ? " part" : ""));
      const b = el("i");
      b.style.height = `${Math.max(3, (t / max) * 100)}%`;
      col.append(b, el("small", null, DOW[new Date(`${x}T12:00:00Z`).getUTCDay()].slice(0, 3)));
      col.dataset.tip = `${dayShort(x)} · ${t ? fmtDur(t) : "sem apontamento"}${t >= goal ? " · meta ✓" : ""}`;
      col.addEventListener("click", () => { DV.date = x; loadToday(); });
      strip.appendChild(col);
    }
    const gl = el("span", "dv-goal");
    gl.style.bottom = `calc(16px + (100% - 16px) * ${goal / max})`;
    strip.appendChild(gl);
    card.appendChild(strip);
    box.appendChild(card);
  }

  /* --- equipe --- */
  if (DV.prefs.team) {
    const card = mCard("Equipe no dia", "");
    card.classList.add("half");
    card.id = "dvTeam";
    card.appendChild(el("p", "muted xs", "Carregando a equipe…"));
    box.appendChild(card);
    if (DV.team && DV.teamDate === d) renderTeamToday();
  }

  const every = Math.max(1, Number(DV.prefs.refreshMin) || 1);
  const foot = el("p", "muted xs m-foot", `Atualizado ${since(DV.prog.fetchedAt)}${isToday && DV.prefs.autoRefresh ? ` · atualiza sozinho a cada ${every === 1 ? "minuto" : `${every} minutos`}` : ""}.`);
  box.appendChild(foot);
  if (isToday) updateDayPill(totalOf(DV.prog, d), goal);
}

function renderTeamToday() {
  const card = $("dvTeam");
  if (!card || !DV.team) return;
  const rep = scopedTeam(DV.team);
  const people = rep.people.filter((p) => !p.hidden);
  const me = people.find((p) => p.isMe);
  const logged = people.filter((p) => p.total > 0);
  const avg = logged.length ? logged.reduce((s, p) => s + p.total, 0) / logged.length : 0;
  card.innerHTML = "";
  const t = el("div", "card-t");
  t.append(el("b", null, "Equipe no dia"), el("span", null, `${logged.length}/${people.length} apontaram · ${people.filter((p) => p.state === "met" || p.state === "over").length} bateram a meta`));
  card.appendChild(t);

  const summary = el("div", "dv-team-sum");
  summary.append(chip(`média ${fmtDur(avg)}`, "", "Média de quem já apontou no dia"));
  if (me) summary.append(chip(`você ${fmtDur(me.total)}`, me.total >= avg ? "ok" : "", me.total >= avg ? "Acima da média de quem apontou" : "Abaixo da média de quem apontou"));
  card.appendChild(summary);

  // Quem atuou nas mesmas demandas que você
  const mine = new Set((me?.entries || []).map((e) => e.key));
  const together = [];
  for (const p of people) {
    if (p.isMe) continue;
    const shared = [...new Set(p.entries.filter((e) => mine.has(e.key)).map((e) => e.key))];
    if (shared.length) together.push(`${p.name.split(" ")[0]} (${shared.join(", ")})`);
  }
  if (together.length) card.appendChild(el("p", "dv-together", `🤝 Junto com você: ${together.join(" · ")}`));

  const grid = el("div", "dv-people");
  for (const p of people.sort((a, b) => (b.isMe - a.isMe) || a.name.localeCompare(b.name))) {
    const row = el("div", "dv-person" + (p.isMe ? " me" : ""));
    const av = el("span", "dv-av", p.name.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase());
    av.style.background = avatarColor(p.accountId);
    const bar = el("span", "dv-pbar");
    const fill = el("i");
    fill.style.width = `${Math.min(100, (p.total / Math.max(1, p.goal)) * 100)}%`;
    fill.className = p.state;
    bar.appendChild(fill);
    row.append(av, el("span", "dv-pname", p.isMe ? "Você" : p.name.split(" ").slice(0, 2).join(" ")), bar, el("b", null, p.total ? fmtDur(p.total) : "—"));
    row.dataset.tip = `${p.name}\n${fmtDur(p.total)} de ${fmtDur(p.goal)} (meta)${p.issues.length ? `\n${p.issues.slice(0, 4).map((i) => `${i.key} ${fmtDur(i.minutes)}`).join("\n")}` : ""}`;
    grid.appendChild(row);
  }
  card.appendChild(grid);
  const more = el("button", "link", "Ver equipe completa →");
  more.addEventListener("click", () => { team.date = DV.date; setMode("team"); });
  card.appendChild(more);
}

/* ---------- Personalizar ---------- */

function renderCustom() {
  const box = $("customBox");
  box.innerHTML = "";
  const head = el("div", "card-t");
  head.append(el("b", null, "Personalizar"), el("span", null, "vale só para você, neste navegador"));
  box.appendChild(head);

  /* meta diária (salva nas Opções, vale para a pílula, o Hoje, o Progresso e a Equipe) */
  const goalRow = el("div", "cu-goal");
  const goalH = () => (DV.prog?.workday.goal ?? DEF.workday.goal) / 60;
  const capH = (DV.prog?.workday.cap ?? DEF.workday.cap) / 60;
  const val = el("b", null, `${String(goalH()).replace(".", ",")}h`);
  const step = async (delta) => {
    const next = Math.min(capH, Math.max(0.5, goalH() + delta));
    if (next === goalH()) return toast(delta > 0 ? `A meta não passa do teto de ${fmtDur(capH * 60)}.` : "A meta mínima é 30m.", "info");
    try {
      const r = await send("SAVE_GOAL", { goalHours: next });
      DEF.workday.goal = r.goal;
      if (DV.prog) { DV.prog.workday.goal = r.goal; persistProg(); }
      val.textContent = `${String(r.goal / 60).replace(".", ",")}h`;
      $("dayPillGoal").textContent = `meta ${fmtDur(r.goal)}`;
      if (state.mode === "today") renderToday();
      refreshDayPill();
      toast(`Meta diária: ${fmtDur(r.goal)}.`, "ok");
    } catch (e) { toast(e.message); }
  };
  const minus = el("button", "ic bordered", "−"); minus.addEventListener("click", () => step(-0.5));
  const plus = el("button", "ic bordered", "+"); plus.addEventListener("click", () => step(0.5));
  goalRow.append(el("span", null, "Meta diária"), minus, val, plus, el("small", "muted", `teto ${fmtDur(capH * 60)}`));
  box.appendChild(goalRow);

  /* blocos de cada tela — aplicam na hora */
  for (const [title, items] of PREF_GROUPS) {
    box.appendChild(el("div", "m-sub", title));
    const list = el("div", "cu-list");
    for (const [k, label] of items) {
      const l = el("label", "cu-item");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!DV.prefs[k];
      cb.addEventListener("change", () => {
        DV.prefs[k] = cb.checked;
        savePrefs();
        if (state.mode === "today") renderToday();
        if (state.mode === "progress") renderProgress();
        if (k === "team" && cb.checked) loadTeamFor(DV.date);
      });
      l.append(cb, el("span", null, label));
      list.appendChild(l);
    }
    box.appendChild(list);
  }

  /* atualização automática */
  const ar = el("div", "cu-goal");
  const cb = document.createElement("input");
  cb.type = "checkbox"; cb.checked = !!DV.prefs.autoRefresh;
  const sel = el("select", "inp sm num");
  for (const m of [1, 2, 5, 10]) sel.appendChild(new Option(m === 1 ? "1 min" : `${m} min`, String(m)));
  sel.value = String(DV.prefs.refreshMin || 1);
  sel.disabled = !cb.checked;
  const apply = () => {
    DV.prefs.autoRefresh = cb.checked;
    DV.prefs.refreshMin = Number(sel.value);
    sel.disabled = !cb.checked;
    savePrefs();
    if (state.mode === "today") { startTodayPolling(); renderToday(); }
  };
  cb.addEventListener("change", apply);
  sel.addEventListener("change", apply);
  const lab = el("label", "cu-item grow");
  lab.append(cb, el("span", null, "Atualizar o Hoje sozinho a cada"));
  ar.append(lab, sel);
  box.appendChild(ar);

  const bar = el("div", "row-end");
  const reset = el("button", "btn sm", "Restaurar padrão");
  reset.addEventListener("click", () => {
    DV.prefs = { ...PREFS_DEFAULT };
    savePrefs();
    renderCustom();
    if (state.mode === "today") { startTodayPolling(); renderToday(); }
    toast("Blocos restaurados.", "ok");
  });
  bar.appendChild(reset);
  box.appendChild(bar);
}

/* ---------------- Progresso ---------------- */

/** Sprints disponíveis no espaço escolhido: ativas + 3 últimas encerradas de cada quadro. */
function sprintOptions() {
  const out = [];
  for (const sp of DV.sprints?.spaces || []) {
    if (gspace.project && sp.project !== gspace.project) continue;
    for (const a of sp.active || []) if (a.start) out.push({ ...a, space: sp.label || sp.project, project: sp.project, current: true });
    for (const c of sp.recent || []) if (c.start) out.push({ ...c, space: sp.label || sp.project, project: sp.project, current: false });
  }
  return out;
}

/**
 * Sprint escolhida. "all" = todas as sprints atuais juntas (MEED + SUS): o período vai do início
 * da primeira ao fim da última e só contam as horas em demandas dessas sprints.
 */
function selectedSprint() {
  const opts = sprintOptions();
  const current = opts.filter((o) => o.current);
  const wantAll = DV.sprintSel === "all" || (!DV.sprintSel && !gspace.project && current.length > 1);
  if (wantAll && current.length > 1) {
    const start = current.map((o) => o.start).sort()[0];
    const end = current.map((o) => o.end || todayISO()).sort().at(-1);
    return { id: "all", all: true, parts: current, name: "Sprints atuais", space: current.map((o) => o.space).join(" + "),
      project: "", start, end, current: true, goal: "" };
  }
  return opts.find((o) => String(o.id) === String(DV.sprintSel)) || current[0] || opts[0] || null;
}

function progressRange() {
  const today = todayISO();
  if (DV.period === "week") {
    const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    return { from: addDaysIso(today, -dow), to: today, label: "esta semana" };
  }
  if (DV.period === "sprint") {
    const sp = selectedSprint();
    if (sp) {
      const end = sp.end || today;
      return { from: sp.start, to: end < today ? end : today, end, label: `${sp.space} · ${sp.name}`, sprint: sp };
    }
    return { from: addDaysIso(today, -13), to: today, label: "sem sprint encontrada — últimos 14 dias" };
  }
  const n = Number(DV.period);
  return { from: addDaysIso(today, -(n - 1)), to: today, label: `últimos ${n} dias` };
}

function renderSprintPicker() {
  const box = $("pgSprintBar");
  box.classList.toggle("hidden", DV.period !== "sprint");
  $("pgSprintErr").textContent = "";
  if (DV.period !== "sprint") return;
  const sel = $("pgSprint");
  const opts = sprintOptions();
  const current = opts.filter((o) => o.current);
  const cur = selectedSprint();
  sel.innerHTML = "";
  if (current.length > 1) sel.appendChild(new Option(`Todas as sprints atuais (${current.map((o) => o.space).join(" + ")})`, "all"));
  for (const o of opts) {
    sel.appendChild(new Option(`${o.space} · ${o.name} · ${brShort(o.start)}→${o.end ? brShort(o.end) : "?"}${o.current ? " · atual" : ""}`, String(o.id)));
  }
  if (!opts.length) sel.appendChild(new Option("Nenhuma sprint encontrada", ""));
  const errs = (DV.sprints?.spaces || []).filter((x) => (!gspace.project || x.project === gspace.project) && x.error).map((x) => x.error);
  $("pgSprintErr").textContent = !opts.length && errs.length ? errs.join(" · ") : "";
  if (cur) sel.value = String(cur.id);
}

async function loadProgress({ force = false } = {}) {
  const seq = ++DV.seq;
  if (!DV.prog) $("progressBox").innerHTML = `<p class="muted xs">Carregando seu histórico…</p>`;
  else $("progressBox").classList.add("loading");
  try {
    if (DV.period === "sprint" && (!DV.sprints || force)) DV.sprints = await send("SPRINT_INFO", { force, ...sprintScope() }).catch(() => ({ spaces: [] }));
    renderSprintPicker();
    const r = progressRange();
    if (r.sprint) await sprintKeysFor(r.sprint);
    // período anterior do mesmo tamanho, para comparar
    const len = Math.round((Date.parse(r.to) - Date.parse(r.from)) / DAY_MS) + 1;
    await ensureProg(addDaysIso(r.from, -len), { force });
    if (seq !== DV.seq) return;
    renderProgress();
  } catch (e) {
    if (seq !== DV.seq) return;
    $("progressBox").innerHTML = "";
    note($("progressBox"), "err", e.message);
  } finally {
    if (seq === DV.seq) $("progressBox").classList.remove("loading");
  }
}

/** DESIGN lê as sprints do próprio espaço; DEV, as de MEED e SUS. */
const sprintScope = () => (ROLE === "design" && DEF.designProjects?.length ? { projects: DEF.designProjects } : {});

/** Chaves das demandas da sprint (ou da união das sprints atuais, em "Todas"). */
async function sprintKeysFor(sp) {
  const parts = sp.all ? sp.parts : [sp];
  for (const p of parts) {
    if (DV.sprintKeys.has(String(p.id))) continue;
    const k = await send("SPRINT_KEYS", { sprintId: p.id }).catch(() => null);
    if (k) DV.sprintKeys.set(String(p.id), new Set(k.keys));
  }
  if (sp.all) DV.sprintKeys.set("all", new Set(parts.flatMap((p) => [...(DV.sprintKeys.get(String(p.id)) || [])])));
  return DV.sprintKeys.get(String(sp.id)) || null;
}

const PROJ_COLORS = ["var(--data)", "#9f8fef", "#6cc3e0", "#fea362"];
const projColor = (p) => PROJ_COLORS[Math.max(0, gspace.projects.indexOf(p)) % PROJ_COLORS.length];

function sprintCard(r, st) {
  const sp = r.sprint;
  const today = todayISO();
  const card = el("div", "card pg-sprint");
  const parts = sp.all ? sp.parts : [sp];
  const top = el("div", "pg-sprint-top");
  if (sp.all) top.append(el("b", null, "Todas as sprints atuais"), el("span", "pg-sprint-st on", parts.map((p) => p.space).join(" + ")));
  else {
    const all = daysOfRange(sp.start, r.end).filter((d) => !isWeekendIso(d));
    const done = all.filter((d) => d <= today).length;
    top.append(el("span", "sp-space", sp.space), el("b", null, sp.name),
      el("span", `pg-sprint-st ${sp.current ? "on" : ""}`, sp.current ? (today > r.end ? "encerra hoje" : `faltam ${all.length - done} ${pl(all.length - done, "dia útil", "dias úteis")}`) : "encerrada"));
  }
  card.appendChild(top);
  for (const p of parts) {
    const end = p.end || today;
    const all = daysOfRange(p.start, end).filter((d) => !isWeekendIso(d));
    const done = all.filter((d) => d <= today).length;
    const row = el("div", "pg-sprint-row");
    if (sp.all) row.append(el("span", "sp-space", p.space), el("b", "xs", p.name));
    row.append(el("span", "muted xs", `${brShort(p.start)} → ${brShort(end)} · dia ${Math.min(done, all.length)} de ${all.length} úteis`));
    card.appendChild(row);
    const bar = el("div", "meter-line");
    const fill = el("i");
    fill.style.width = `${(Math.min(done, all.length) / Math.max(1, all.length)) * 100}%`;
    bar.appendChild(fill);
    card.appendChild(bar);
    const info = (DV.sprints?.spaces || []).find((x) => x.project === p.project)?.active?.find((a) => String(a.id) === String(p.id));
    if (info?.stats) card.appendChild(el("div", "pg-sprint-bits", `${info.stats.done} de ${info.stats.total} concluídas na sprint · suas: ${info.stats.mineDone}/${info.stats.mine}`));
    if (p.goal) card.appendChild(el("div", "muted xs", `Objetivo: ${p.goal}`));
  }
  card.appendChild(el("div", "pg-sprint-bits", `Você: ${fmtDur(st.total)} em ${st.activeIssues} ${pl(st.activeIssues, "demanda", "demandas")} da${sp.all ? "s" : ""} sprint${sp.all ? "s" : ""}.`));
  return card;
}

function renderProgress() {
  const box = $("progressBox");
  const prog = scopedProg();
  if (!prog) return;
  const r = progressRange();
  if (r.from < prog.from) { loadProgress(); return; }
  box.innerHTML = "";
  // Sprint: só as horas em demandas da(s) sprint(s) — metas, média, sequência e gráficos refletem isso.
  const keys = r.sprint ? DV.sprintKeys.get(String(r.sprint.id)) || null : null;
  const only = ROLE === "design" && DEF.designProjects?.length && !gspace.project ? new Set(DEF.designProjects) : null;
  const st = periodStats(prog, r.from, r.to, { keys, projects: only });
  const whole = keys ? periodStats(prog, r.from, r.to, { projects: only }) : st;
  const len = st.series.length;
  const prevFrom = addDaysIso(r.from, -len), prevTo = addDaysIso(r.from, -1);
  const prev = !r.sprint && prevFrom >= prog.from ? periodStats(prog, prevFrom, prevTo, { projects: only }) : null;
  const streakNow = streakAt(prog, todayISO());
  let streak = 0;
  for (const x of st.series.filter((y) => y.counted && y.date <= todayISO()).reverse()) { if (x.total >= st.goal) streak++; else break; }

  if (r.sprint) box.appendChild(sprintCard(r, st));
  else {
    const head = el("div", "m-head");
    head.append(el("b", null, `${brShort(r.from)} → ${brShort(r.to)}${gspace.project ? ` · ${gspace.project}` : ""}`),
      el("span", null, `${r.label} · ${st.counted === 1 ? "1 dia útil" : `${st.counted} dias úteis`}`));
    box.appendChild(head);
  }

  /* --- destaques --- */
  const k = el("div", "m-kpis");
  const tile = (value, label, sub, tone, tip) => {
    const t = el("div", `m-kpi ${tone || ""}`);
    t.append(el("b", null, value), el("span", null, label));
    if (sub) t.append(el("small", null, sub));
    if (tip) t.dataset.tip = tip;
    return t;
  };
  const dTot = prev ? st.total - prev.total : null;
  k.append(
    tile(fmtDur(st.total), keys ? "na sprint" : "apontadas",
      keys ? (whole.total > st.total ? `${fmtDur(whole.total - st.total)} fora da sprint` : "todas em demandas da sprint")
        : dTot == null ? "" : `${dTot >= 0 ? "▲ +" : "▼ −"}${fmtDur(Math.abs(dTot))} vs anterior`, "",
      keys ? "Horas em demandas da(s) sprint(s) e nas subtarefas delas" : "Soma no período"),
    tile(fmtDur(st.avg), "por dia útil", `meta ${fmtDur(st.goal)}`, st.avg >= st.goal ? "ok" : "", "Média por dia útil (fim de semana só conta se tiver apontamento)"),
    tile(`${st.metDays}/${st.counted}`, "dias com meta", st.counted ? pct(st.metDays / st.counted) : "", st.counted && st.metDays / st.counted >= 0.8 ? "ok" : "", "Dias em que você bateu a meta diária"),
    tile(`🔥 ${keys ? streak : streakNow.days}`, "sequência atual", `melhor no período: ${st.bestStreak}`, (keys ? streak : streakNow.days) >= 3 ? "ok" : "", "Dias úteis seguidos batendo a meta"),
  );
  box.appendChild(k);

  /* --- dia a dia (empilhado por espaço; na sprint, até o último dia dela) --- */
  const projs = [...new Set(st.series.flatMap((x) => Object.keys(x.projects || {})))].sort((a, b) => gspace.projects.indexOf(a) - gspace.projects.indexOf(b));
  const card = mCard("Dia a dia", projs.length > 1 ? "por espaço · clique num dia para abrir" : "clique num dia para abrir");
  const chart = el("div", "pg-chart");
  const future = r.end && r.end > r.to ? daysOfRange(addDaysIso(r.to, 1), r.end).filter((d) => !isWeekendIso(d)).map((d) => ({ date: d, total: 0, projects: {}, future: true })) : [];
  const days = [...st.series.filter((x) => x.counted || x.total), ...future];
  const max = Math.max(st.cap, ...days.map((x) => x.total));
  for (const x of days) {
    const col = el("button", "pg-col" + (x.date === todayISO() ? " cur" : "") + (x.future ? " fut" : ""));
    const stack = el("span", `pg-stack ${x.total > st.cap ? "over" : x.total >= st.goal ? "met" : ""}`);
    stack.style.height = `${Math.max(x.total ? 3 : 0, (x.total / max) * 100)}%`;
    if (projs.length > 1) {
      for (const p of projs) {
        const m = x.projects?.[p] || 0;
        if (!m) continue;
        const sg = el("i"); sg.style.flex = String(m); sg.style.background = projColor(p);
        stack.appendChild(sg);
      }
    } else {
      const sg = el("i", x.total > st.cap ? "over" : x.total >= st.goal ? "met" : x.total ? "part" : ""); sg.style.flex = "1";
      stack.appendChild(sg);
    }
    const lab = el("small", null, days.length > 12 ? x.date.slice(8, 10) : `${DOW[new Date(`${x.date}T12:00:00Z`).getUTCDay()]} ${x.date.slice(8, 10)}`);
    col.append(stack, lab);
    const split = projs.length > 1 && x.total ? `\n${projs.filter((p) => x.projects?.[p]).map((p) => `${p} ${fmtDur(x.projects[p])}`).join(" · ")}` : "";
    col.dataset.tip = x.future ? `${dayShort(x.date)} · ainda vem` : `${dayShort(x.date)}\n${x.total ? fmtDur(x.total) : "sem apontamento"}${x.total >= st.goal ? " · meta ✓" : ""}${x.total > st.cap ? " · acima do teto" : ""}${split}`;
    if (!x.future) col.addEventListener("click", () => { DV.date = x.date; setMode("today"); });
    chart.appendChild(col);
  }
  const gl = el("span", "pg-goal");
  gl.style.bottom = `calc(16px + (100% - 16px) * ${st.goal / max})`;
  gl.dataset.label = `meta ${fmtDur(st.goal)}`;
  chart.appendChild(gl);
  card.appendChild(chart);
  card.appendChild(projs.length > 1
    ? legend(projs.map((p) => [projColor(p), `${p} ${fmtDur(st.projects[p] || 0)}`]))
    : legend([["var(--ok)", "meta batida"], ["var(--data)", "abaixo da meta"], ["var(--err)", "acima do teto"]]));
  if (st.best?.total) card.appendChild(el("p", "muted xs", `Seu melhor dia: ${dayShort(st.best.date)} com ${fmtDur(st.best.total)}.${st.emptyDays ? ` ${st.emptyDays} ${pl(st.emptyDays, "dia útil", "dias úteis")} sem apontamento${keys ? " em demandas da sprint" : ""}.` : ""}`));
  box.appendChild(card);

  /* --- semana x semana --- */
  if (DV.prefs.week && !r.sprint) {
    const w = weekCompare(prog, todayISO());
    if (w.prev != null) {
      const wc = el("div", `dv-pace ${w.delta >= 0 ? "up" : "down"}`);
      wc.append(el("b", null, w.delta >= 0 ? "▲" : "▼"), el("span", null,
        `Esta semana: ${fmtDur(w.cur)} · na semana passada, até o mesmo dia: ${fmtDur(w.prev)} (${w.delta >= 0 ? "+" : "−"}${fmtDur(Math.abs(w.delta))}).`));
      box.appendChild(wc);
    }
  }

  /* --- onde foi seu tempo (segue o filtro: período ou sprint) --- */
  if (DV.prefs.where && st.issues.length) {
    const c = mCard("Onde foi seu tempo", `${st.activeIssues} ${pl(st.activeIssues, "demanda", "demandas")} · ${r.sprint ? (r.sprint.all ? "sprints atuais" : r.sprint.name) : r.label}`);
    const proj = Object.entries(st.projects).sort((a, b) => b[1] - a[1]);
    if (proj.length > 1) {
      const pb = el("div", "stackbar tall");
      for (const [p, m] of proj) {
        const sg = el("i", null, `${p} ${pct(m / st.total)}`); sg.style.flex = String(m / st.total); sg.style.background = projColor(p);
        sg.dataset.tip = `${p}: ${fmtDur(m)} (${pct(m / st.total)})`;
        pb.appendChild(sg);
      }
      c.append(el("div", "m-sub", "Por espaço"), pb, el("div", "m-sub", "Por demanda"));
    }
    const top = st.issues.slice(0, 8);
    const rest = st.issues.slice(8).reduce((sum, x) => sum + x.minutes, 0);
    const bar = el("div", "stackbar tall");
    top.forEach((it, i) => {
      const sg = el("i");
      sg.style.flex = String(it.minutes / st.total);
      sg.style.background = ISSUE_COLORS[i % ISSUE_COLORS.length];
      sg.dataset.tip = `${it.key} · ${it.summary}\n${fmtDur(it.minutes)} (${pct(it.minutes / st.total)}) em ${it.days} ${pl(it.days, "dia", "dias")}`;
      bar.appendChild(sg);
    });
    if (rest) { const sg = el("i"); sg.style.flex = String(rest / st.total); sg.style.background = "var(--surface-3)"; sg.dataset.tip = `Outras ${st.issues.length - 8}: ${fmtDur(rest)}`; bar.appendChild(sg); }
    c.appendChild(bar);
    // Para cada demanda, a atuação dia a dia no período (um quadrinho por dia útil)
    const cols = st.series.filter((x) => x.counted).map((x) => x.date);
    top.forEach((it, i) => {
      const line = issueLine(it, `${fmtDur(it.minutes)} · ${pct(it.minutes / st.total)}`, `${it.status}${it.parentKey ? ` · ↳ ${it.parentKey}` : ""} · ${it.days} ${pl(it.days, "dia", "dias")}`);
      const dot = el("i", "dv-dot"); dot.style.background = ISSUE_COLORS[i % ISSUE_COLORS.length];
      line.prepend(dot);
      const strip = el("div", "pg-days");
      const peak = Math.max(...Object.values(it.byDay));
      for (const d of cols.slice(-31)) {
        const m = it.byDay[d] || 0;
        const cell = el("i");
        if (m) { cell.style.background = ISSUE_COLORS[i % ISSUE_COLORS.length]; cell.style.opacity = String(0.35 + 0.65 * (m / peak)); }
        cell.dataset.tip = `${dayShort(d)} · ${m ? fmtDur(m) : "—"}`;
        strip.appendChild(cell);
      }
      line.querySelector(".m-row-main").appendChild(strip);
      c.appendChild(line);
    });
    box.appendChild(c);
  }
}

/* ---------------- Demandas ---------------- */

async function loadDemands({ force = false } = {}) {
  force = force || takeFresh("demands");
  const seq = ++DV.seq;
  if (!DV.dm) {
    try {
      const { devDemands: cached } = await chrome.storage.local.get({ devDemands: null });
      if (cached?.issues && !DV.dm) { DV.dm = cached; renderDemands(); }
    } catch { /* sem cache */ }
  }
  if (canSkipFetch(DV.dm, force)) { renderDemands(); return; }
  if (!DV.dm) $("demandsBox").innerHTML = `<p class="muted xs">Lendo suas demandas…</p>`;
  $("dmInfo").textContent = DV.dm ? "atualizando…" : "";
  try {
    const dm = await send("MY_DEMANDS", { days: 30, force });
    if (seq !== DV.seq) return;
    DV.dm = dm;
    chrome.storage.local.set({ devDemands: dm }).catch(() => {});
    renderDemands();
  } catch (e) {
    if (seq !== DV.seq) return;
    if (!DV.dm) { $("demandsBox").innerHTML = ""; note($("demandsBox"), "err", e.message); }
    else toast(e.message);
  }
}

/** Prioridade do Jira → tom (pela posição na lista de prioridades do site, com reforço pelo nome). */
function prioTone(p) {
  if (!p) return "none";
  const n = p.name.toLowerCase();
  if (/highest|blocker|cr[ií]tic|urgent|bloque|alt[ií]ssima|mais alta/.test(n)) return "p1";
  if (/high|alta|major|maior/.test(n)) return "p2";
  if (/medium|m[eé]dia|normal|moderad/.test(n)) return "p3";
  if (/lowest|trivial|m[ií]nima|mais baixa/.test(n)) return "p5";
  if (/low|baixa|minor|menor/.test(n)) return "p4";
  return ["p1", "p2", "p3", "p4", "p5"][Math.min(4, p.rank ?? 2)];
}
function prioPill(p) {
  const s = el("span", `prio ${prioTone(p)}`, p ? p.name : "—");
  s.dataset.tip = p ? `Prioridade no Jira: ${p.name}` : "Sem prioridade";
  return s;
}

function renderDemands() {
  const dm = DV.dm;
  if (!dm) return;
  const box = $("demandsBox");
  box.innerHTML = "";
  const b = demandBoard(dm, { mode: DV.dmPeriod, project: gspace.project });
  const deployName = deployLabel(gspace.project, { batch: DEF.spaces?.batch?.label, sustentacao: DEF.spaces?.sustentacao?.label });
  const feitoName = feitoLabel(gspace.project, { batch: DEF.spaces?.batch?.label, sustentacao: DEF.spaces?.sustentacao?.label });
  const label = (g) => (g.id === "deploy" ? deployName : g.id === "feito" ? feitoName : g.label);
  $("dmInfo").textContent = `${DV.dmPeriod === "today" ? "colunas: o que entrou hoje" : `colunas: o que entrou desde ${brShort(b.since)}`} · atualizado ${since(dm.generatedAt)}`;

  /* --- resumo por coluna (Em andamento, Impedido, Reaberto, Feito, Deploy, Validação, Finalizados) --- */
  const sum = el("div", "dm-sum seven");
  for (const g of DEMAND_GROUPS) {
    const n = b.groups[g.id].length;
    const t = el("button", `dm-tile k-${g.id} ${n ? "has" : ""} ${g.id === "blocked" && n ? "err" : ""}`);
    t.append(el("b", null, String(n)), el("span", null, `${g.icon} ${label(g)}`));
    t.addEventListener("click", () => document.getElementById(`dm-${g.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    sum.appendChild(t);
  }
  box.appendChild(sum);

  /* --- prioridades (clique para filtrar) --- */
  if (b.priorities.length) {
    const pr = el("div", "dm-prios");
    pr.appendChild(el("span", "muted xs", "Prioridade:"));
    for (const p of b.priorities) {
      const c = el("button", `prio ${prioTone(p.id === "-" ? null : p)} ${DV.dmPrio === p.id ? "on" : ""}`, `${p.name} ${p.count}`);
      c.addEventListener("click", () => { DV.dmPrio = DV.dmPrio === p.id ? "" : p.id; renderDemands(); });
      pr.appendChild(c);
    }
    if (DV.dmPrio) { const x = el("button", "link", "limpar"); x.addEventListener("click", () => { DV.dmPrio = ""; renderDemands(); }); pr.appendChild(x); }
    box.appendChild(pr);
  }

  const est = (i) => (i.estimate ? `${fmtDur(i.spent)} / ${fmtDur(i.estimate)}` : i.myMinutes ? `${fmtDur(i.myMinutes)} seus` : "");
  const matchPrio = (r) => !DV.dmPrio || (r.issue.priority?.id || "-") === DV.dmPrio;
  const KIND_TXT = { other: "Em andamento", blocked: "Impedido", reopen: "Reaberto", todo: "A fazer" };

  /* --- 1º: em seu nome agora (pendentes), com a demanda em que você está atuando em destaque --- */
  const pend = b.pending.filter(matchPrio);
  if (pend.length) {
    const c = mCard("📌 Em seu nome agora", `${pend.length} ${pl(pend.length, "pendente", "pendentes")}`);
    c.id = "dm-doing";
    for (const r of pend.slice(0, 20)) {
      const i = r.issue;
      const right = el("span", "dm-right");
      right.append(prioPill(i.priority), el("span", "m-row-r", r.today ? `hoje ${fmtDur(r.today)}` : fmtSpan(r.ageMs)));
      const sub = [`${KIND_TXT[r.kind] || i.status.name}${KIND_TXT[r.kind] && i.status.name !== KIND_TXT[r.kind] ? ` (${i.status.name})` : ""}`];
      if (r.kind !== "todo") sub.push(`há ${fmtSpan(r.ageMs)}`);
      if (r.returns) sub.push(`reaberta ${r.returns}×`);
      if (i.estimate && i.spent > i.estimate) sub.push("passou da estimativa");
      const line = issueLine(i, right, `${sub.join(" · ")}${i.parentKey ? ` · ↳ ${i.parentKey}` : ""}`, dm.url);
      if (r.acting) {
        line.classList.add("acting");
        line.querySelector(".m-row-top").prepend(el("span", "acting-tag", "▶ atuando agora"));
      }
      if (r.kind === "blocked") line.classList.add("blocked");
      if (r.kind === "reopen") line.classList.add("late");
      c.appendChild(line);
    }
    if (pend.length > 20) c.appendChild(el("p", "muted xs", `+ ${pend.length - 20}`));
    box.appendChild(c);
  }

  /* --- em andamento com outras pessoas (você apontou ou moveu) --- */
  const others = ["doing", "blocked", "reopen"].flatMap((id) => b.groups[id]).filter((r) => !r.mine && matchPrio(r));
  if (others.length) {
    const c = mCard("🤝 Em andamento com outras pessoas", String(others.length));
    for (const r of others.slice(0, 10)) {
      const right = el("span", "dm-right");
      right.append(prioPill(r.issue.priority), el("span", "m-row-r", est(r.issue) || fmtSpan(r.ageMs)));
      c.appendChild(issueLine(r.issue, right, `${r.issue.status.name}${r.issue.assignee ? ` · ${r.issue.assignee.name}` : ""}`, dm.url));
    }
    box.appendChild(c);
  }

  /* --- 2º: status das suas demandas no período (Feito, Reaberto, Deploy, Validação, Finalizados) --- */
  const SECTIONS = [["feito"], ["reopen"], ["deploy"], ["qa"], ["shipped"]];
  let shown = pend.length + others.length;
  for (const [id] of SECTIONS) {
    const g = DEMAND_GROUPS.find((x) => x.id === id);
    const rows = (id === "reopen" ? b.groups.reopen.filter((r) => r.enteredInPeriod) : b.groups[id]).filter(matchPrio);
    if (!rows.length) continue;
    shown += rows.length;
    const c = mCard(`${g.icon} ${label(g)}`, `${rows.length} · ${DV.dmPeriod === "today" ? "entraram hoje" : "no período"}`);
    if (id !== "reopen") c.id = `dm-${id}`;
    else c.id = "dm-reopen";
    c.classList.add("dm-card", `k-${id}`);
    for (const r of rows.slice(0, 15)) {
      const i = r.issue;
      let sub;
      if (id === "reopen") sub = `${r.lastReturn ? `reaberta ${dayShort(isoOfMs(r.lastReturn))}${r.lastReturnBy ? ` por ${r.lastReturnBy}` : ""}` : "reaberta"}${r.returns > 1 ? ` · ${r.returns}ª vez` : ""} · ${i.status.name}`;
      else if (id === "shipped") sub = `${est(i)}${r.returns ? ` · reaberta ${r.returns}×` : " · de primeira"}`;
      else sub = `${r.validated ? "✔ validado · " : ""}${i.status.name} desde ${dayShort(isoOfMs(r.since))}${i.assignee && !r.mine ? ` · ${i.assignee.name}` : ""}`;
      if (i.myToday) sub += ` · hoje ${fmtDur(i.myToday)}`;
      const right = el("span", "dm-right");
      right.append(prioPill(i.priority), el("span", "m-row-r", id === "shipped" || id === "feito" ? dayShort(isoOfMs(r.since)) : (est(i) || fmtSpan(r.ageMs))));
      const line = issueLine(i, right, `${sub}${i.parentKey ? ` · ↳ ${i.parentKey}` : ""}`, dm.url);
      if (id === "reopen") line.classList.add("late");
      c.appendChild(line);
    }
    if (rows.length > 15) c.appendChild(el("p", "muted xs", `+ ${rows.length - 15}`));
    box.appendChild(c);
  }
  // âncoras dos contadores que não têm seção própria
  for (const id of ["blocked"]) if (!document.getElementById(`dm-${id}`)) { const a = el("span"); a.id = `dm-${id}`; box.querySelector("#dm-doing")?.before(a); }

  if (!shown) {
    const e = el("div", "empty");
    e.innerHTML = DV.dmPrio ? "<b>🔎</b>Nada com essa prioridade." : `<b>🗂</b>${DV.dmPeriod === "today" ? "Nada em seu nome e nenhuma das suas demandas mudou de coluna hoje." : "Nenhuma demanda sua neste período."}`;
    box.appendChild(e);
  }
  const parts = [];
  if (b.worked) parts.push(`você apontou em ${b.worked} ${pl(b.worked, "demanda", "demandas")} ${DV.dmPeriod === "today" ? "hoje" : "no período"}`);
  if (b.groups.shipped.length) parts.push(`${b.firstPass} de ${b.groups.shipped.length} finalizadas sem reabrir`);
  if (parts.length) box.appendChild(el("p", "muted xs", `${parts.join(" · ")}.`));
  if (b.extra.prd.length) box.appendChild(el("p", "muted xs", `${b.extra.prd.length} ${pl(b.extra.prd.length, "demanda foi", "demandas foram")} para deploy de produção no período (fora dos cartões).`));
  if (dm.truncated) note(box, "warn", "Mais de 300 demandas: mostrando as atualizadas mais recentemente.");
}

const isoOfMs = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/* ---------- ligações DEV ---------- */

$("tdPrev").addEventListener("click", () => { DV.date = addDaysIso(DV.date, -1); while (isWeekendIso(DV.date) && !(DV.prog?.days[DV.date]?.length)) DV.date = addDaysIso(DV.date, -1); loadToday(); });
$("tdNext").addEventListener("click", () => { let n = addDaysIso(DV.date, 1); while (isWeekendIso(n) && n < todayISO() && !(DV.prog?.days[n]?.length)) n = addDaysIso(n, 1); if (n <= todayISO()) { DV.date = n; loadToday(); } });
$("tdToday").addEventListener("click", () => { DV.date = todayISO(); loadToday(); });
$("tdDate").addEventListener("change", () => { if ($("tdDate").value) { DV.date = $("tdDate").value; loadToday(); } });
$("tdRefresh").addEventListener("click", async () => {
  try { await refreshTodayOnly(); } catch { /* segue com o recarregamento */ }
  loadToday({ force: DV.date !== todayISO() });
});
$("tdCustom").addEventListener("click", () => {
  const box = $("customBox");
  const open = box.classList.toggle("hidden") === false;
  $("tdCustom").classList.toggle("on", open);
  if (open) renderCustom();
});
$("pgPeriod").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  DV.period = b.dataset.period;
  document.querySelectorAll("#pgPeriod button").forEach((x) => x.classList.toggle("on", x === b));
  savePrefs();
  loadProgress();
});
$("pgRefresh").addEventListener("click", () => loadProgress({ force: true }));
$("dmPeriod").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  DV.dmPeriod = b.dataset.period;
  document.querySelectorAll("#dmPeriod button").forEach((x) => x.classList.toggle("on", x === b));
  savePrefs();
  renderDemands();
});
$("pgSprint").addEventListener("change", () => { DV.sprintSel = $("pgSprint").value; loadProgress(); });
$("dmRefresh").addEventListener("click", () => loadDemands({ force: true }));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.mode === "today" && DV.date === todayISO() && DV.prog && DV.prefs.autoRefresh) {
    refreshTodayOnly().then(() => state.mode === "today" && renderToday()).catch(() => {});
  }
});

/* =====================================================================
   QuickFill SCRUM — Sprint · Pessoas · Riscos
   ===================================================================== */

const SC_PREFS_DEFAULT = { types: true, forecast: true, deploy: true, stages: true, period: true, flow: true, burndown: true, tree: true, velocity: true };
const SC_PREF_LABELS = [
  ["types", "HUs · Tarefas · Bugs"], ["forecast", "Previsão no ritmo atual"], ["deploy", "Aviso de Feito / card de deploy"],
  ["stages", "Onde estão os itens"], ["period", "Resumo do período"], ["flow", "Métricas de fluxo"],
  ["burndown", "Burndown"], ["tree", "Itens e subtarefas"], ["velocity", "Velocidade das últimas sprints"],
];
const SC = { data: null, seq: 0, unit: "items", sort: "load", q: "", users: new Map(), treeAll: false, period: "sprint", sprintId: "", prefs: { ...SC_PREFS_DEFAULT },
  pOpen: new Set(), pStage: new Map(), unOpen: true };
try { SC.unOpen = localStorage.getItem("qf.unOpen") !== "0"; } catch { /* sem storage */ }
try {
  SC.period = localStorage.getItem("qf.scPeriod") || "sprint";
  SC.prefs = { ...SC_PREFS_DEFAULT, ...JSON.parse(localStorage.getItem("qf.scPrefs") || "{}") };
  SC.unit = localStorage.getItem("qf.scUnit") || "items";
} catch { /* sem storage */ }
const STAGE_COLOR = { todo: "var(--surface-3)", doing: "var(--data)", blocked: "var(--err)", feito: "#9f8fef", deploy: "#6cc3e0", qa: "var(--warn)", validated: "#94d2b4", done: "var(--ok)" };
const PERIOD_LABEL = { sprint: "na sprint", today: "hoje", 7: "nos últimos 7 dias", 14: "nos últimos 14 dias" };

/** Início do período escolhido (Sprint · Hoje · 7 · 14 dias). */
function scFrom(sprint) {
  if (SC.period === "sprint" || SC.data?.past) return sprint?.start ? Date.parse(`${sprint.start}T00:00:00`) : 0;
  const n = SC.period === "today" ? 1 : Number(SC.period);
  return Date.parse(`${addDaysIso(todayISO(), -(n - 1))}T00:00:00`);
}
const scSettings = () => SC.data?.settings || {};
const isHighPrio = (p) => ["p1", "p2"].includes(prioTone(p));

/** Sprints ativas dentro do espaço escolhido (Todos · MEED · SUS). */
/**
 * Sprints visíveis com o Espaço escolhido.
 * `cross`: em Pessoas e Riscos, os itens do projeto escolhido que estão na sprint de outro quadro
 * também entram (ex.: SUS-2368 na sprint do MEED aparece em "SUS").
 */
function scSprints({ cross = false } = {}) {
  const out = [];
  for (const sp of SC.data?.spaces || []) {
    if (gspace.project && sp.project !== gspace.project && !cross) continue;
    for (const s of sp.sprints || []) {
      // Espaço escolhido = só os itens daquele projeto: a sprint de um quadro pode trazer cards de
      // outro projeto (ex.: SUS-2368 na sprint do MEED), que não devem aparecer com "MEED" selecionado.
      const sprint = gspace.project ? { ...s, issues: (s.issues || []).filter((i) => (i.project || i.key.split("-")[0]) === gspace.project) } : s;
      if (sp.project !== gspace.project && gspace.project && !sprint.issues.length) continue;
      out.push({ space: sp, sprint });
    }
  }
  return out;
}

const withScrumDefaults = (d) => {
  // subtarefas seguem o pai concluído/validado (ver stageOf)
  for (const sp of d.spaces || []) for (const s of sp.sprints || []) linkParents(s.issues || []);
  return withScrumSettings(d);
};
const withScrumSettings = (d) => ({ ...d, settings: { staleDays: 3, wipLimit: 2, feitoThreshold: 3, deploySummary: "Realizando Deploy", deployers: [], qaPeople: [], smPeople: [], designPeople: [], ignorePeople: [], ...d.settings } });
const scBoxes = () => ["scSprintBox", "peopleBox", "risksBox"].map($);

async function loadScrum({ force = false } = {}) {
  force = force || takeFresh("scrum");
  const seq = ++SC.seq;
  if (!SC.data) {
    try {
      const { scrumData } = await chrome.storage.local.get({ scrumData: null });
      if (scrumData?.spaces && !SC.data) { SC.data = withScrumDefaults(scrumData); renderScrum(); }
    } catch { /* sem cache */ }
  }
  if (String(SC.data?.past || "") === SC.sprintId && canSkipFetch(SC.data, force)) { renderScrum(); return; }   // voltando de onde parou: usa o que já estava
  for (const id of ["scInfo", "rkInfo"]) $(id).textContent = SC.data ? "atualizando…" : "";
  if (!SC.data) scBoxes().forEach((b) => { b.innerHTML = `<p class="muted xs">Lendo as sprints do Jira…</p>`; });
  try {
    const data = await send("SCRUM_SPRINT", { force, sprint: SC.sprintId || undefined });
    if (seq !== SC.seq) return;
    SC.data = withScrumDefaults(data);
    if (!data.past) chrome.storage.local.set({ scrumData: data }).catch(() => {});   // o cache guarda só a sprint atual
    renderScrum();
  } catch (e) {
    if (seq !== SC.seq) return;
    if (!SC.data) scBoxes().forEach((b) => { b.innerHTML = ""; note(b, "err", e.message); });
    else toast(e.message);
  }
}

function renderScrum() {
  if (!SC.data) return;
  paintSprintPick();
  const past = scPastSprint();
  const info = past ? `${past.name}, encerrada em ${dayShort(past.end || past.start)} · situação de agora dos itens` : `atualizado ${since(SC.data.generatedAt)}`;
  $("scInfo").textContent = info;
  $("rkInfo").textContent = info;
  if (state.mode === "sprint") renderSprint();
  if (state.mode === "people") renderPeople();
  if (state.mode === "risks") renderRisks();
}

function scEmpty(box) {
  const errs = (SC.data?.spaces || []).filter((s) => s.error && (!gspace.project || s.project === gspace.project));
  for (const s of errs) note(box, "warn", `${s.project}: ${s.error}`);
  const e = el("div", "empty");
  e.innerHTML = SC.data?.past ? "<b>🗓</b>A sprint escolhida não é deste espaço. Troque o Espaço ou volte para a Sprint atual."
    : "<b>🗓</b>Nenhuma sprint ativa neste espaço.";
  box.appendChild(e);
}

const kpiTile = (v, l, sub, tone, tip) => { const t = el("div", `m-kpi ${tone || ""}`); t.append(el("b", null, v), el("span", null, l)); if (sub) t.append(el("small", null, sub)); if (tip) t.dataset.tip = tip; return t; };

/* ---------- Ajustes da Scrum Master (⋯) ---------- */

/* ---------- Ajustes da Scrum Master (⋯) — tudo aplica na hora ---------- */

function renderScrumSettings() {
  const box = $("scSetBox");
  box.innerHTML = "";
  const st = scSettings();
  const head = el("div", "card-t");
  head.append(el("b", null, "Ajustes da sprint"), el("span", null, "mudam na hora"));
  box.appendChild(head);

  box.appendChild(el("div", "m-sub", "Regras (valem para todos os QuickFill SCRUM desta conta)"));
  const fields = [
    ["staleDays", "Dias úteis para considerar “parada”", 1, 30],
    ["wipLimit", "Itens em andamento por pessoa (WIP)", 1, 20],
    ["feitoThreshold", "Cards em Feito para sugerir o deploy", 1, 50],
  ];
  let saveTimer = null;
  const saved = el("span", "muted xs", "");
  for (const [k, label, min, max] of fields) {
    const row = el("label", "cu-goal");
    const inp = el("input", "inp sm num");
    inp.type = "number"; inp.min = min; inp.max = max; inp.value = st[k];
    inp.addEventListener("input", () => {
      const v = Math.min(max, Math.max(min, Math.round(Number(inp.value) || 0)));
      if (!Number(inp.value)) return;
      SC.data.settings[k] = v;            // aplica já na tela
      renderScrum();
      saved.textContent = "salvando…";
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try { await send("SAVE_SCRUM_SETTINGS", { [k]: v }); saved.textContent = "✓ salvo"; chrome.storage.local.set({ scrumData: SC.data }).catch(() => {}); }
        catch (e) { saved.textContent = ""; toast(e.message); }
      }, 500);
    });
    row.append(el("span", null, label), inp);
    box.appendChild(row);
  }
  box.appendChild(saved);

  box.appendChild(el("div", "m-sub", "O que aparece na aba Sprint (só neste navegador)"));
  const list = el("div", "cu-list");
  for (const [k, label] of SC_PREF_LABELS) {
    const l = el("label", "cu-item");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = !!SC.prefs[k];
    cb.addEventListener("change", () => {
      SC.prefs[k] = cb.checked;
      try { localStorage.setItem("qf.scPrefs", JSON.stringify(SC.prefs)); } catch { /* sem storage */ }
      renderSprint();
    });
    l.append(cb, el("span", null, label));
    list.appendChild(l);
  }
  box.appendChild(list);
  const qa = (st.qaPeople || []).map((p) => p.name).join(", ");
  const des = (st.designPeople || []).map((p) => p.name).join(", ");
  box.appendChild(el("p", "muted xs", `Fora das regras de WIP e de atribuição — QA: ${qa || "ninguém"} · Design: ${des || "ninguém"}. Ajuste nas Opções › Equipe.`));
  const bar = el("div", "row-end");
  const reset = el("button", "btn sm", "Mostrar tudo");
  reset.addEventListener("click", () => { SC.prefs = { ...SC_PREFS_DEFAULT }; try { localStorage.setItem("qf.scPrefs", JSON.stringify(SC.prefs)); } catch { /* sem storage */ } renderScrumSettings(); renderSprint(); });
  bar.appendChild(reset);
  box.appendChild(bar);
}

/* ---------- Sprint ---------- */

function burnChart(h, unit) {
  const W = 520, H = 150, P = { l: 28, r: 8, t: 8, b: 20 };
  const key = unit === "points" ? "remainingPts" : "remaining";
  const ikey = unit === "points" ? "idealPts" : "ideal";
  const max = Math.max(1, unit === "points" ? h.totalPts : h.total);
  const n = Math.max(1, h.series.length - 1);
  const x = (i) => P.l + (i / n) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - v / max) * (H - P.t - P.b);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.classList.add("burn");
  const add = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.appendChild(e); return e; };
  for (const f of [0, 0.5, 1]) {
    add("line", { x1: P.l, x2: W - P.r, y1: y(max * f), y2: y(max * f), class: "burn-grid" });
    add("text", { x: P.l - 5, y: y(max * f) + 3, class: "burn-lab", "text-anchor": "end" }).textContent = String(Math.round(max * f));
  }
  add("polyline", { points: h.series.map((p, i) => `${x(i)},${y(p[ikey])}`).join(" "), class: "burn-ideal" });
  const real = h.series.map((p, i) => [i, p]).filter(([, p]) => !p.future);
  if (real.length) {
    add("polyline", { points: real.map(([i, p]) => `${x(i)},${y(p[key])}`).join(" "), class: "burn-real" });
    const [li, lp] = real[real.length - 1];
    add("circle", { cx: x(li), cy: y(lp[key]), r: 3.5, class: "burn-dot" });
  }
  const step = Math.ceil(h.series.length / 10);
  h.series.forEach((p, i) => {
    if (i % step && i !== h.series.length - 1) return;
    add("text", { x: x(i), y: H - 5, class: "burn-lab", "text-anchor": "middle" }).textContent = p.date.slice(8, 10);
  });
  return svg;
}

function stageBar(byStage, total, onPick = null, picked = "") {
  const bar = el("div", `stackbar tall${onPick ? " pickable" : ""}`);
  for (const s of STAGES) {
    const n = byStage[s.id].length;
    if (!n) continue;
    const sg = el("i", picked === s.id ? "on" : "", n >= 2 ? String(n) : "");
    sg.style.flex = String(n / Math.max(1, total));
    sg.style.background = STAGE_COLOR[s.id];
    if (s.id === "todo") sg.style.color = "var(--txt)";
    if (s.id === "qa" || s.id === "deploy" || s.id === "validated") sg.style.color = "#1d2125";
    sg.dataset.tip = `${s.label}: ${n}${onPick ? " · clique para listar" : ""}`;
    // dentro de <summary> o clique abriria/fecharia o cartão: a barra trata o clique sozinha
    if (onPick) sg.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onPick(s.id); });
    bar.appendChild(sg);
  }
  return bar;
}

const stageLabel = (i) => STAGES.find((s) => s.id === stageOf(i))?.label || i.status.name;
const typeTag = (i) => {
  if (i.isSubtask) { const t = el("span", "tt tt-sub", "Sub"); t.dataset.tip = i.type || "Subtarefa"; return t; }
  const g = typeGroup(i.type); const t = el("span", `tt tt-${g}`, g === "hu" ? "HU" : g === "bug" ? "Bug" : "Tarefa"); t.dataset.tip = i.type; return t;
};

function renderSprint() {
  const box = $("scSprintBox");
  box.innerHTML = "";
  const list = scSprints();
  if (!list.length) return scEmpty(box);
  const today = SC.data.today;
  const canPts = SC.data.fields.points;
  document.querySelector('#scUnit [data-unit="points"]').disabled = !canPts;
  const unit = canPts ? SC.unit : "items";
  const P = SC.prefs;

  /* --- busca: HUs, tarefas, bugs e subtarefas da(s) sprint(s) --- */
  const q = normName(SC.search || "");
  if (q.length >= 2) {
    const all = list.flatMap(({ space: sp, sprint: s }) => s.issues.map((i) => ({ i, sp })));
    const hits = all.filter(({ i }) => [i.key, i.summary, i.assignee?.name, i.parentKey, i.parentSummary, i.status.name, i.type]
      .some((v) => normName(v).includes(q)));
    const c = mCard(`🔎 “${SC.search.trim()}”`, `${hits.length} ${pl(hits.length, "resultado", "resultados")}`);
    c.classList.add("search-card");
    for (const { i, sp } of hits.slice(0, 40)) {
      const right = el("span", "dm-right");
      right.append(typeTag(i), prioPill(i.priority), el("span", "m-row-r", stageLabel(i)));
      const sub = [i.status.name, i.assignee ? i.assignee.name : "sem responsável"];
      if (i.isSubtask) sub.push(`subtarefa de ${i.parentKey}${i.parentSummary ? ` · ${i.parentSummary}` : ""}`);
      if (list.length > 1) sub.push(sp.project);
      c.appendChild(issueLine(i, right, sub.join(" · "), SC.data.url));
    }
    if (!hits.length) c.appendChild(el("p", "muted xs", "Nada na sprint com esse texto."));
    if (hits.length > 40) c.appendChild(el("p", "muted xs", `+ ${hits.length - 40} — refine a busca.`));
    box.appendChild(c);
  }

  for (const { space: sp, sprint: s } of list) {
    const h = sprintHealth(s, today);
    const fromMs = scFrom(s);
    const card = el("div", "card pg-sprint");
    const top = el("div", "pg-sprint-top");
    top.append(el("span", "sp-space", sp.project), el("b", null, s.name),
      el("span", `pg-sprint-st on`, h.left ? `faltam ${h.left} ${pl(h.left, "dia útil", "dias úteis")} além de hoje` : today > (s.end || today) ? "passou do fim" : "último dia"));
    card.appendChild(top);
    card.appendChild(el("div", "muted xs", `${s.start ? brShort(s.start) : "?"} → ${s.end ? brShort(s.end) : "?"} · dia ${h.elapsed} de ${h.days.length} úteis`));
    if (s.goal) card.appendChild(el("div", "sc-goal", `🎯 ${s.goal}`));

    if (P.types) {
      const types = el("div", "chips-row");
      for (const g of ["hu", "task", "bug"]) {
        const all = h.items.filter((i) => typeGroup(i.type) === g);
        if (!all.length) continue;
        const done = all.filter((i) => stageOf(i) === "done").length;
        types.appendChild(chip(`${TYPE_LABEL[g]} ${done}/${all.length}`, done === all.length ? "ok" : "", `${done} de ${all.length} ${TYPE_LABEL[g].toLowerCase()} concluídas`));
      }
      const subs = s.issues.filter((i) => i.isSubtask);
      if (subs.length) types.appendChild(chip(`Subtarefas ${subs.filter((i) => stageOf(i) === "done").length}/${subs.length}`, "", "Subtarefas das demandas da sprint (não entram na contagem da sprint)"));
      if (h.byStage.blocked.length) types.appendChild(chip(`⛔ ${h.byStage.blocked.length} ${pl(h.byStage.blocked.length, "impedida", "impedidas")}`, "warn", "Em Impedido / Aguardando"));
      card.appendChild(types);
    }

    const bars = el("div", "sc-bars");
    const line = (label, value, tone, tip) => {
      const r = el("div", "sc-bar");
      r.dataset.tip = tip;
      const m = el("div", "meter-line");
      const f = el("i", tone);
      f.style.width = `${Math.round(value * 100)}%`;
      m.appendChild(f);
      r.append(el("span", null, label), m, el("b", null, pct(value)));
      return r;
    };
    bars.append(
      line("Tempo", h.timePct, "", "Dias úteis decorridos da sprint"),
      line("Itens", h.workPct, h.workPct + 0.1 < h.timePct ? "warn" : "ok", `${h.done} de ${h.total} HUs, tarefas e bugs concluídos (subtarefas não contam)`),
    );
    if (canPts && h.totalPts) bars.append(line("Pontos", h.donePts / h.totalPts, h.donePts / h.totalPts + 0.1 < h.timePct ? "warn" : "ok", `${h.donePts} de ${h.totalPts} pontos concluídos`));
    card.appendChild(bars);

    if (P.forecast) {
      const fc = el("div", `dv-pace ${h.onTrack ? "up" : "down"}`);
      fc.append(el("b", null, h.onTrack ? "▲" : "▼"), el("span", null, h.onTrack
        ? `No ritmo atual a sprint fecha completa (${h.done} concluídas, ~${(h.elapsed ? h.done / h.elapsed : 0).toFixed(1).replace(".", ",")} por dia útil).`
        : `No ritmo atual devem sair ~${h.forecast} de ${h.total} até o fim. Faltam ${h.total - h.done} em ${h.left} ${pl(h.left, "dia útil", "dias úteis")}.`));
      card.appendChild(fc);
    }
    box.appendChild(card);

    /* --- Feito acumulado → card de deploy --- */
    const feito = s.issues.filter((i) => !i.isSubtask && stageOf(i) === "feito");   // como no quadro: só os cards, sem subtarefas
    if (P.deploy && feito.length) {
      const over = feito.length >= scSettings().feitoThreshold;
      const w = el("div", `dv-pace ${over ? "down" : "up"} sc-deploy`);
      const txt = el("span", null, `${feito.length} ${pl(feito.length, "card", "cards")} em Feito/PR esperando deploy${over ? ` — passou do limite de ${scSettings().feitoThreshold}` : ""}.`);
      const b = el("button", `btn sm ${over ? "primary" : ""}`, "Criar card “Realizando Deploy”");
      b.addEventListener("click", () => openDeployForm(sp, s, feito));
      w.append(el("b", null, "☑"), txt, b);
      box.appendChild(w);
    }

    /* --- etapas (com Impedido / Aguardando e Validado) --- */
    if (P.stages) {
      const st = mCard("Onde estão os itens", `${h.total} itens · clique numa etapa`);
      const picked = SC.stageSel?.sprint === s.id ? SC.stageSel.stage : "";
      const pick = (id) => { SC.stageSel = picked === id ? null : { sprint: s.id, stage: id }; renderSprint(); };
      st.appendChild(stageBar(h.byStage, h.total, pick, picked));
      const lg = el("div", "legend pick-legend");
      for (const x of STAGES.filter((y) => h.byStage[y.id].length || ["todo", "doing", "done"].includes(y.id))) {
        const b = el("button", picked === x.id ? "on" : "");
        const dot = el("i"); dot.style.background = STAGE_COLOR[x.id];
        b.append(dot, document.createTextNode(`${x.label} ${h.byStage[x.id].length}`));
        b.disabled = !h.byStage[x.id].length;
        b.addEventListener("click", () => pick(x.id));
        lg.appendChild(b);
      }
      st.appendChild(lg);
      if (h.added.length) st.appendChild(el("p", "muted xs", `➕ ${h.added.length} entraram depois do início da sprint.`));
      /* lista da etapa escolhida */
      if (picked) {
        const g = STAGES.find((y) => y.id === picked);
        const rows = h.byStage[picked].slice().sort((a, b) => (a.priority?.rank ?? 99) - (b.priority?.rank ?? 99) || (lastMove(a) || 0) - (lastMove(b) || 0));
        const lst = el("div", "stage-list");
        const head = el("div", "stage-list-h");
        head.append(el("b", null, `${g.icon} ${g.label} · ${rows.length}`));
        const x = el("button", "link", "fechar"); x.addEventListener("click", () => pick(picked));
        head.appendChild(x);
        lst.appendChild(head);
        const subsOf = (k) => s.issues.filter((i) => i.isSubtask && i.parentKey === k);
        for (const i of rows) {
          const age = businessAge(lastMove(i));
          const subs = subsOf(i.key);
          const right = el("span", "dm-right");
          right.append(typeTag(i), prioPill(i.priority), el("span", "m-row-r", age ? `${age}d` : "hoje"));
          const sub = [`${i.status.name}`, i.assignee ? i.assignee.name : "sem responsável"];
          if (subs.length) sub.push(`${subs.filter((y) => stageOf(y) === "done").length}/${subs.length} subtarefas`);
          lst.appendChild(issueLine(i, right, sub.join(" · "), SC.data.url));
        }
        st.appendChild(lst);
      }
      box.appendChild(st);
    }

    /* --- resumo do período --- */
    if (P.period && SC.period !== "sprint") {
      const moves = s.issues.flatMap((i) => (i.transitions || []).filter((t) => t.at >= fromMs));
      const doneP = h.items.filter((i) => stageOf(i) === "done" && (i.catChanged || 0) >= fromMs).length;
      const reopenP = s.issues.reduce((n, i) => n + reopenEvents(i, fromMs).length, 0);
      const toQa = moves.filter((t) => t.toStage === "qa").length;
      const createdP = s.issues.filter((i) => (i.created || 0) >= fromMs).length;
      const pc = mCard(`Resumo ${PERIOD_LABEL[SC.period]}`, `${moves.length} movimentação(ões)`);
      pc.classList.add("half");
      const k = el("div", "m-kpis four");
      k.append(kpiTile(String(doneP), "concluídas"), kpiTile(String(toQa), "foram para validação"),
        kpiTile(String(reopenP), "reaberturas", "", reopenP ? "warn" : "ok"), kpiTile(String(createdP), "criadas"));
      pc.appendChild(k);
      box.appendChild(pc);
    }

    /* --- métricas de fluxo --- */
    if (P.flow) {
      const f = flowMetrics(s, { today, fromMs: SC.period === "sprint" ? 0 : fromMs });
      const fc = mCard("Métricas de fluxo", "HUs, tarefas e bugs");
      fc.classList.add("half");
      const k = el("div", "m-kpis four");
      k.append(
        kpiTile(f.cycleAvg ? fmtSpan(f.cycleAvg) : "—", "cycle time", "1º andamento → concluído", "", "Tempo médio entre começar e concluir"),
        kpiTile(f.qaWaitAvg ? fmtSpan(f.qaWaitAvg) : "—", "na validação", "tempo médio por item", f.qaWaitAvg > 2 * 864e5 ? "warn" : "", "Tempo médio que um item fica na coluna Validação"),
        kpiTile(pct(f.reopenRate), "reabertas", `${f.reopened} ${pl(f.reopened, "item", "itens")}`, f.reopenRate > 0.2 ? "warn" : "", "Itens que entraram em Reaberto ao menos uma vez"),
        kpiTile(f.firstPassRate == null ? "—" : pct(f.firstPassRate), "aprovadas de 1ª", "passaram pelo QA sem reabrir", f.firstPassRate != null && f.firstPassRate >= 0.8 ? "ok" : ""),
      );
      fc.appendChild(k);
      const bits = [`vazão: ${f.throughput.toFixed(1).replace(".", ",")} ${pl(f.throughput, "concluída", "concluídas")} por dia útil ${PERIOD_LABEL[SC.period]}`, `${f.wipNow} em andamento agora`];
      if (f.blockedNow) bits.push(`${f.blockedNow} ${pl(f.blockedNow, "impedida", "impedidas")}${f.blockedAvg ? ` · tempo médio impedido ${fmtSpan(f.blockedAvg)}` : ""}`);
      fc.appendChild(el("p", "muted xs", `${bits.join(" · ")}.`));
      box.appendChild(fc);
    }

    if (P.burndown) {
      const bc = mCard(`Burndown · ${unit === "points" ? "pontos" : "itens"}`, "tracejado = ideal");
      bc.appendChild(burnChart(h, unit));
      bc.appendChild(legend([["var(--data)", "restante"], ["var(--faint)", "ideal"]]));
      box.appendChild(bc);
    }

    if (P.tree) box.appendChild(treeCard(s));

    if (P.velocity && sp.velocity?.length) {
      const vc = mCard("Velocidade das últimas sprints", unit === "points" ? "pontos" : "itens");
      vc.classList.add("half");
      const vals = sp.velocity.map((v) => (unit === "points" ? { done: v.pointsDone, total: v.points } : { done: v.done, total: v.total }));
      const max = Math.max(1, ...vals.map((v) => v.total), unit === "points" ? h.totalPts : h.total);
      const rowsBox = el("div", "sc-vel");
      sp.velocity.forEach((v, idx) => {
        const r = el("div", "sc-vel-row");
        const m = el("div", "sc-vel-bar");
        const tot = el("i", "tot"); tot.style.width = `${(vals[idx].total / max) * 100}%`;
        const dn = el("i", "done"); dn.style.width = `${(vals[idx].done / max) * 100}%`;
        m.append(tot, dn);
        r.append(el("span", null, v.name), m, el("b", null, `${vals[idx].done}/${vals[idx].total}`));
        r.dataset.tip = `${v.name} · ${v.start ? brShort(v.start) : ""} → ${v.end ? brShort(v.end) : ""}\nentregue ${vals[idx].done} de ${vals[idx].total} comprometidos`;
        rowsBox.appendChild(r);
      });
      vc.appendChild(rowsBox);
      const avgV = vals.reduce((sum, v) => sum + v.done, 0) / vals.length;
      const now = unit === "points" ? h.totalPts : h.total;
      vc.appendChild(el("p", `muted xs ${now > avgV * 1.15 ? "sc-alert" : ""}`,
        `Média entregue: ${Math.round(avgV)} · compromisso desta sprint: ${now}${now > avgV * 1.15 ? " — acima do que o time costuma entregar" : ""}.`));
      box.appendChild(vc);
    }
    if (s.truncated) note(box, "warn", "Sprint com mais de 400 itens: os números consideram os 400 primeiros.");
  }
  if (sprintNext()) box.appendChild(el("p", "muted xs", sprintNext()));
}

/** HUs/tarefas/bugs da sprint com as subtarefas de cada uma. */
function treeCard(s) {
  const tree = sprintTree(s.issues);
  const withSubs = tree.filter((t) => t.subs.length);
  const c = mCard("Itens e subtarefas", `${withSubs.length} com subtarefas`);
  const seg = el("div", "seg sc-tree-seg");
  for (const [v, label] of [[false, "Com subtarefas"], [true, "Todos"]]) {
    const b = el("button", SC.treeAll === v ? "on" : "", label);
    b.addEventListener("click", () => { SC.treeAll = v; renderSprint(); });
    seg.appendChild(b);
  }
  c.querySelector(".card-t").appendChild(seg);
  const shown = (SC.treeAll ? tree : withSubs)
    .sort((a, b) => STAGES.findIndex((x) => x.id === stageOf(a.issue)) - STAGES.findIndex((x) => x.id === stageOf(b.issue)));
  for (const t of shown.slice(0, 40)) {
    const det = document.createElement("details");
    det.className = "tree";
    const sm = document.createElement("summary");
    const done = t.subs.filter((i) => stageOf(i) === "done").length;
    const main = el("div", "tree-main");
    const head = el("div", "m-row-top");
    if (!t.issue.outside) head.appendChild(typeTag(t.issue));
    head.append(el("span", "k", t.issue.key), el("span", "s", t.issue.summary));
    main.appendChild(head);
    const people = [...new Set(t.subs.map((i) => i.assignee?.name.split(" ")[0]).filter(Boolean))];
    main.appendChild(el("div", "m-row-sub", `${t.issue.outside ? "fora da sprint" : stageLabel(t.issue)}${t.issue.assignee ? ` · ${t.issue.assignee.name}` : ""}${people.length ? ` · subtarefas com ${people.join(", ")}` : ""}`));
    const prog = el("span", "tree-prog");
    if (t.subs.length) {
      const m = el("span", "tree-bar"); const f = el("i"); f.style.width = `${(done / t.subs.length) * 100}%`; m.appendChild(f);
      prog.append(m, el("b", null, `${done}/${t.subs.length}`));
    }
    sm.append(main, prog);
    det.appendChild(sm);
    for (const i of t.subs) {
      const right = el("span", "dm-right");
      right.append(el("span", "m-row-r", stageLabel(i)));
      det.appendChild(issueLine(i, right, `${i.status.name}${i.assignee ? ` · ${i.assignee.name}` : " · sem responsável"}`, SC.data.url));
    }
    if (!t.subs.length) det.appendChild(el("p", "muted xs", "Sem subtarefas."));
    c.appendChild(det);
  }
  if (!shown.length) c.appendChild(el("p", "muted xs", "Nenhum item da sprint foi dividido em subtarefas."));
  if (shown.length > 40) c.appendChild(el("p", "muted xs", `+ ${shown.length - 40}`));
  return c;
}

const sprintNext = () => (SC.data?.spaces || [])
  .filter((s) => s.next && (!gspace.project || s.project === gspace.project))
  .map((s) => `Próxima em ${s.project}: ${s.next.name}${s.next.start ? ` (${brShort(s.next.start)}${s.next.end ? ` → ${brShort(s.next.end)}` : ""})` : ""}`)
  .join(" · ");

/* ---------- Atribuir (grava no Jira) ---------- */

async function usersFor(project) {
  if (!SC.users.has(project)) SC.users.set(project, send("ASSIGNABLE_USERS", { project }).catch(() => []));
  return SC.users.get(project);
}

/** Botão "Atribuir" → escolhe a pessoa (sugestão pré-selecionada) → confirma. */
/** Botão "Atribuir" → escolhe a pessoa (sugestão pré-selecionada) → confirma. */
function assignControl(issue, suggested) {
  const wrap = el("span", "assign");
  const btn = el("button", "btn sm", suggested ? `Atribuir a ${suggested.name.split(" ")[0]}` : "Atribuir");
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    wrap.innerHTML = "";
    const sel = el("select", "inp sm");
    sel.appendChild(new Option("Carregando…", ""));
    const ok = el("button", "btn sm primary", "Confirmar");
    const no = el("button", "ic sm", "✕");
    no.title = "Cancelar";
    wrap.append(sel, ok, no);
    no.addEventListener("click", (ev) => { ev.stopPropagation(); wrap.replaceWith(assignControl(issue, suggested)); });
    const load = peopleLoad(scSprints().flatMap((x) => x.sprint.issues), scSettings());
    const all = await usersFor(issue.project);
    const isQa = qaMatcher(scSettings().qaPeople || []);
    sel.innerHTML = "";
    const g1 = document.createElement("optgroup"); g1.label = "Desenvolvimento (na sprint)";
    for (const p of load.devs) g1.appendChild(new Option(`${p.name} · WIP ${p.wip}`, p.id));
    const g2 = document.createElement("optgroup"); g2.label = "Outras pessoas do projeto";
    const g3 = document.createElement("optgroup"); g3.label = "QA";
    for (const p of load.qa) g3.appendChild(new Option(p.name, p.id));
    const g4 = document.createElement("optgroup"); g4.label = "Design UI/UX";
    for (const p of load.design) g4.appendChild(new Option(p.name, p.id));
    const isDesign = qaMatcher(scSettings().designPeople || []);
    for (const u of all) {
      if (load.people.some((p) => p.id === u.accountId)) continue;
      (isDesign(u.accountId, u.name) ? g4 : isQa(u.accountId, u.name) ? g3 : g2).appendChild(new Option(u.name, u.accountId));
    }
    for (const g of [g1, g2, g4, g3]) if (g.children.length) sel.appendChild(g);
    if (suggested) sel.value = suggested.id;
    ok.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (!sel.value) return toast("Escolha a pessoa.");
      const name = sel.options[sel.selectedIndex].text.split(" · ")[0];
      ok.disabled = true;
      try {
        await send("ASSIGN_ISSUE", { key: issue.key, accountId: sel.value });
        toast(`${issue.key} atribuída a ${name}.`, "ok");
        loadScrum({ force: true });
      } catch (err) { ok.disabled = false; toast(err.message); }
    });
  });
  wrap.appendChild(btn);
  return wrap;
}

/**
 * Linha "aberta" de demanda: título inteiro (quebra linha), resumo da descrição
 * e as ações numa linha própria — para decidir sem precisar abrir o Jira.
 */
function taskRow(i, { meta = "", actions = [] } = {}) {
  const r = el("div", "tr-row");
  const head = el("div", "tr-head");
  head.append(el("span", "k", i.key), typeTag(i), el("b", "tr-title", i.summary || "(sem título)"));
  r.appendChild(head);
  if (i.desc) {
    const d = el("p", "tr-desc", i.desc);
    d.title = "Clique para ver mais / menos";
    d.addEventListener("click", () => d.classList.toggle("open"));
    r.appendChild(d);
  } else {
    r.appendChild(el("p", "tr-desc empty", "Sem descrição na demanda."));
  }
  const foot = el("div", "tr-foot");
  foot.append(el("span", "tr-meta", meta));
  const act = el("span", "tr-actions");
  act.append(...actions, histLink(i.key, { base: SC.data?.url }), jiraLink(i.key, { base: SC.data?.url, label: "" }));
  foot.appendChild(act);
  r.appendChild(foot);
  return r;
}

/* ---------- Card "Realizando Deploy" ---------- */

async function openDeployForm(sp, sprint, feito, draft = null) {
  if (state.mode !== "sprint") setMode("sprint");
  const box = $("scDeploy");
  box.innerHTML = "";
  box.classList.remove("hidden");
  const labels = { batch: DEF.spaces?.batch?.label, sustentacao: DEF.spaces?.sustentacao?.label };
  const col = feitoLabel(sp.project, labels), env = deployLabel(sp.project, labels).replace("Deploy ", "");
  const c = mCard(`☑ Card de deploy · ${sp.project}`, `${feito.length} em ${col}`);
  c.classList.add("deploy-form");
  const title = el("input", "inp");
  title.value = draft?.title ?? (SC.data.settings.deploySummary || "Realizando Deploy");
  const who = el("select", "inp");
  who.appendChild(new Option("Carregando pessoas…", ""));
  const desc = el("textarea", "inp ta");
  desc.rows = 3;
  desc.value = draft?.desc ?? `Deploy em ${env} dos cards que estão em ${col} na ${sprint.name}.`;
  const field = (label, input) => { const l = el("label", "field"); l.append(el("span", null, label), input); return l; };
  c.append(field("Título", title), field("Quem vai realizar o deploy", who), field("Descrição", desc));

  const list = el("div", "deploy-list");
  const checks = [];
  for (const i of feito) {
    const row = el("label", "chk");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = !(draft?.unchecked || []).includes(i.key); cb.value = i.key;
    checks.push(cb);
    row.append(cb, el("span", null, `${i.key} — ${i.summary}${i.assignee ? ` (${i.assignee.name.split(" ")[0]})` : ""}`));
    list.appendChild(row);
  }
  c.append(el("div", "m-sub", "Cards incluídos"), list);
  const opt = (label, on) => { const l = el("label", "tgl"); const cb = el("input"); cb.type = "checkbox"; cb.checked = on; l.append(cb, el("span", null, label)); return [l, cb]; };
  const [lLink, cLink] = opt("Vincular os cards", draft?.link ?? true);
  const [lSprint, cSprint] = opt("Colocar na sprint ativa", draft?.sprint ?? true);
  const tg = el("div", "toggles"); tg.append(lLink, lSprint);
  c.appendChild(tg);
  const bar = el("div", "row-end");
  const cancel = el("button", "btn sm", "Cancelar");
  const go = el("button", "btn sm primary", "Criar card");
  bar.append(cancel, go);
  c.appendChild(bar);
  box.appendChild(c);
  if (!draft) box.scrollIntoView({ behavior: "smooth", block: "start" });
  // Rascunho do formulário: volta preenchido se você sair da extensão no meio
  const track = () => {
    SC.deployDraft = { project: sp.project, sprintId: sprint.id, title: title.value, desc: desc.value, who: who.value,
      unchecked: checks.filter((x) => !x.checked).map((x) => x.value), link: cLink.checked, sprint: cSprint.checked };
    saveViewSoon();
  };
  c.addEventListener("input", track);
  c.addEventListener("change", track);
  track();
  cancel.addEventListener("click", () => { box.classList.add("hidden"); box.innerHTML = ""; SC.deployDraft = null; saveViewSoon(); });

  const deployers = SC.data.settings.deployers || [];
  const all = await usersFor(sp.project);
  who.innerHTML = "";
  who.appendChild(new Option("Escolha…", ""));
  if (deployers.length) {
    const g = document.createElement("optgroup"); g.label = "Quem faz deploy (Opções)";
    for (const d of deployers) g.appendChild(new Option(d.name, d.accountId));
    who.appendChild(g);
  }
  const g2 = document.createElement("optgroup"); g2.label = "Outras pessoas do projeto";
  for (const u of all) if (!deployers.some((d) => d.accountId === u.accountId)) g2.appendChild(new Option(u.name, u.accountId));
  who.appendChild(g2);
  if (deployers.length === 1) who.value = deployers[0].accountId;
  if (draft?.who) who.value = draft.who;
  track();

  go.addEventListener("click", async () => {
    const keys = checks.filter((x) => x.checked).map((x) => x.value);
    if (!who.value) return toast("Escolha quem vai realizar o deploy.");
    if (!title.value.trim()) return toast("Informe o título.");
    go.disabled = true;
    try {
      const res = await send("CREATE_DEPLOY_CARD", {
        project: sp.project, summary: title.value.trim(), description: desc.value, assigneeId: who.value,
        keys, items: feito.map((i) => ({ key: i.key, summary: i.summary })), link: cLink.checked, sprintId: cSprint.checked ? sprint.id : null,
      });
      box.innerHTML = "";
      SC.deployDraft = null;
      saveViewSoon();
      const done = mCard(`✓ ${res.key} criado`, "");
      for (const s of res.steps) done.appendChild(el("div", `wd-note ${s.ok ? "info" : "err"}`, `${s.ok ? "✓" : "✕"} ${s.step}${s.detail ? ` — ${s.detail}` : ""}`));
      done.appendChild(issueLine({ key: res.key, summary: title.value.trim() }, null, "abrir no Jira", SC.data.url));
      box.appendChild(done);
      setTimeout(() => box.classList.add("hidden"), 12000);
      loadScrum({ force: true });
    } catch (e) { go.disabled = false; toast(e.message); }
  });
}

/* ---------- Pessoas ---------- */

function renderPeople() {
  const box = $("peopleBox");
  box.innerHTML = "";
  const list = scSprints({ cross: true });
  if (!list.length) return scEmpty(box);
  const issues = list.flatMap((x) => x.sprint.issues);
  const fromMs = SC.period === "sprint" ? 0 : scFrom(null);
  const filtered = SC.period !== "sprint";
  const { people, devs, qa, sm, design, unassigned } = peopleLoad(issues, { ...scSettings(), fromMs });
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const q = SC.q.trim().toLowerCase();
  const sortFn = SC.sort === "name" ? (a, b) => a.name.localeCompare(b.name) : SC.sort === "wip" ? (a, b) => b.wip - a.wip || b.open - a.open : () => 0;
  const match = (p) => (!q || p.name.toLowerCase().includes(q)) && (!filtered || p.active.size || p.moves);

  const k = el("div", "m-kpis four");
  const wipTot = devs.reduce((s, p) => s + p.wip, 0);
  const over = devs.filter((p) => p.overWip).length;
  const free = devs.filter((p) => p.free).length;
  k.append(
    kpiTile(String(devs.length), "desenvolvedores", [qa.length && `+ ${qa.length} QA`, design.length && `${design.length} Design`].filter(Boolean).join(" · ") || "na sprint"),
    kpiTile(String(wipTot), "em andamento", `limite ${scSettings().wipLimit}/pessoa`),
    kpiTile(String(over), "acima do WIP", over ? "foco em terminar" : "tudo ok", over ? "warn" : "ok", "Desenvolvedores com mais itens em andamento que o limite"),
    kpiTile(String(unassigned.length), "sem responsável", free ? `${free} ${pl(free, "dev livre", "devs livres")}` : "", unassigned.length ? "warn" : "ok"),
  );
  box.appendChild(k);
  if (filtered) box.appendChild(el("p", "muted xs", `Mostrando quem teve movimento ${PERIOD_LABEL[SC.period]} e só os itens que se moveram no período.`));

  /* --- sem responsável: sugestão (só desenvolvedores) + Atribuir --- */
  if (unassigned.length) {
    const c = mCard("👤 Sem responsável", `${unassigned.length} · sugestão entre os desenvolvedores`);
    {   // recolher/expandir: seta padrão de todos os cards (ver enhanceCards)
    for (const u of unassigned.slice(0, 15)) {
      const sug = u.suggestion ? `sugestão: ${u.suggestion.person.name} — ${u.suggestion.why}` : "nenhum dev com folga no momento";
      c.appendChild(taskRow(u.issue, {
        meta: `${stageLabel(u.issue)} · ${sug}${u.issue.parentKey ? ` · ↳ ${u.issue.parentKey}` : ""}`,
        actions: [prioPill(u.issue.priority), assignControl(u.issue, u.suggestion?.person)],
      }));
    }
    if (unassigned.length > 15) c.appendChild(el("p", "muted xs", `+ ${unassigned.length - 15}`));
    box.appendChild(c);
    }
  }

  const personCardSc = (p) => {
    const det = document.createElement("details");
    det.className = `card pp-card ${p.overWip ? "over" : ""}`;
    det.open = SC.pOpen.has(p.id);
    det.addEventListener("toggle", () => { if (det.open) SC.pOpen.add(p.id); else { SC.pOpen.delete(p.id); SC.pStage.delete(p.id); } });
    const picked = SC.pStage.get(p.id) || "";
    const sm = document.createElement("summary");
    const av = el("span", "dv-av", initials(p.name));
    av.style.background = avatarColor(p.id);
    const main = el("div", "pp-main");
    const name = el("div", "pp-name");
    name.append(el("b", null, p.name));
    if (p.id === SC.data.me.accountId) name.append(el("span", "chip", "você"));
    if (p.isQa) name.append(chip("QA", "", "Equipe de QA — fora das regras de WIP e de atribuição"));
    if (p.isSm) name.append(chip("Scrum Master", "hot", "Liderança — Opções › Equipe"));
    if (p.isDesign) name.append(chip("Design UI", "design", "Design UI/UX — fora das sugestões de implementação e das regras de WIP"));
    if (p.overWip) name.append(chip(`WIP ${p.wip}`, "warn", `Mais de ${scSettings().wipLimit} itens em andamento ao mesmo tempo`));
    if (p.free) name.append(chip("livre", "ok", "Nenhum item aberto na sprint — pode receber demanda"));
    main.appendChild(name);
    const total = STAGES.reduce((n, s) => n + p.stages[s.id].length, 0);
    // Clique numa etapa da barra: abre o cartão só com as demandas dessa etapa
    if (total) main.appendChild(stageBar(p.stages, total, (id) => {
      if (picked === id) SC.pStage.delete(p.id); else { SC.pStage.set(p.id, id); SC.pOpen.add(p.id); }
      const y = $("scroll").scrollTop; renderPeople(); $("scroll").scrollTop = y;
    }, picked));
    const bits = [];
    if (filtered || p.isSm) bits.push(`${p.moves} movimentação(ões) ${PERIOD_LABEL[SC.period]}`);
    if (filtered && p.doneInPeriod) bits.push(`✓ ${p.doneInPeriod} ${pl(p.doneInPeriod, "concluída", "concluídas")} no período`);
    if (p.wip) bits.push(`◐ ${p.wip} em andamento${p.oldest ? ` (mais antigo há ${p.oldest}d)` : ""}`);
    if (p.stages.blocked.length) bits.push(`⛔ ${p.stages.blocked.length} ${pl(p.stages.blocked.length, "impedida", "impedidas")}`);
    if (p.stages.todo.length) bits.push(`○ ${p.stages.todo.length} a fazer`);
    if (p.stages.feito.length) bits.push(`☑ ${p.stages.feito.length} em Feito/PR`);
    if (p.stages.qa.length) bits.push(`🔍 ${p.stages.qa.length} em validação`);
    if (!filtered && p.stages.done.length) bits.push(`✓ ${p.stages.done.length}${SC.data.fields.points && p.donePts ? ` (${p.donePts} pts)` : ""}`);
    if (p.stalled) bits.push(`⏳ ${p.stalled} ${pl(p.stalled, "parada", "paradas")}`);
    if (p.returns) bits.push(`🔁 ${p.returns} ${pl(p.returns, "reabertura", "reaberturas")}`);
    main.appendChild(el("div", "m-row-sub", bits.join(" · ") || "sem itens"));
    sm.append(av, main);
    det.appendChild(sm);
    if (picked) {
      const g = STAGES.find((x) => x.id === picked);
      const head = el("div", "stage-list-h pp-pick");
      head.append(el("b", null, `${g.icon} ${g.label} · ${p.stages[picked].length}`));
      const all = el("button", "link", "mostrar todas");
      all.addEventListener("click", (e) => { e.preventDefault(); SC.pStage.delete(p.id); const y = $("scroll").scrollTop; renderPeople(); $("scroll").scrollTop = y; });
      head.appendChild(all);
      det.appendChild(head);
    }
    for (const s of STAGES.filter((x) => (picked ? x.id === picked : x.id !== "done" || filtered))) {
      for (const i of p.stages[s.id]) {
        if (filtered && !picked && !p.active.has(i.key)) continue;
        const age = businessAge(lastMove(i));
        const right = el("span", "dm-right");
        right.append(prioPill(i.priority), el("span", "m-row-r", age ? `${age}d` : "hoje"));
        det.appendChild(issueLine(i, right, `${s.icon} ${i.status.name}${i.isSubtask ? " · subtarefa" : ""}${i.parentKey ? ` · ↳ ${i.parentKey}` : ""}`, SC.data.url));
      }
    }
    // Scrum Master: os cards que ela movimentou no período (mesmo sem estar atribuída)
    if (p.isSm) {
      const moved = [...p.active].map((k) => byKey.get(k)).filter((i) => i && i.assignee?.id !== p.id);
      if (moved.length) det.appendChild(el("div", "m-sub pp-sub", `Cards que movimentou ${PERIOD_LABEL[SC.period]}`));
      for (const i of moved.slice(0, 20)) {
        const last = [...(i.transitions || [])].reverse().find((t) => t.by === p.id);
        const right = el("span", "dm-right");
        right.append(prioPill(i.priority), el("span", "m-row-r", last ? dayShort(isoOfMs(last.at)) : ""));
        det.appendChild(issueLine(i, right, `${last ? `${last.fromName} → ${last.toName}` : i.status.name}${i.assignee ? ` · ${i.assignee.name}` : ""}`, SC.data.url));
      }
    }
    return det;
  };

  const shownSm = sm.filter((p) => !q || p.name.toLowerCase().includes(q));
  if (shownSm.length) {
    box.appendChild(el("div", "m-sub", "Scrum Master"));
    for (const p of shownSm) box.appendChild(personCardSc(p));
    box.appendChild(el("div", "m-sub", "Desenvolvimento"));
  }
  const shownDevs = devs.filter(match).sort(sortFn);
  for (const p of shownDevs) box.appendChild(personCardSc(p));
  const shownDesign = design.filter(match).sort(sortFn);
  if (shownDesign.length) {
    box.appendChild(el("div", "m-sub", "Design UI/UX (fora das sugestões de implementação e das regras de WIP)"));
    for (const p of shownDesign) box.appendChild(personCardSc(p));
  }
  const shownQa = qa.filter(match).sort(sortFn);
  if (shownQa.length) {
    box.appendChild(el("div", "m-sub", "QA — validação (fora das regras de WIP e de atribuição)"));
    for (const p of shownQa) box.appendChild(personCardSc(p));
  }
  if (!shownDevs.length && !shownQa.length && !shownDesign.length) { const e = el("div", "empty"); e.innerHTML = filtered ? `<b>🔎</b>Ninguém com movimento ${PERIOD_LABEL[SC.period]}.` : "<b>🔎</b>Ninguém com esse nome na sprint."; box.appendChild(e); }
}

/* ---------- Riscos ---------- */

function scRisks() {
  return scSprints({ cross: true }).map(({ space: sp, sprint: s }) => ({ sp, s,
    r: sprintRisks(s, { staleDays: scSettings().staleDays, today: SC.data.today, isHigh: isHighPrio, fromMs: scFrom(s), qaPeople: scSettings().qaPeople || [] }) }));
}

function renderRisks() {
  const box = $("risksBox");
  box.innerHTML = "";
  const all = scRisks();
  if (!all.length) return scEmpty(box);
  const merged = Object.fromEntries(RISKS.map((x) => [x.id, all.flatMap((a) => a.r[x.id])]));

  const sum = el("div", "dm-sum rk-sum");
  for (const x of RISKS) {
    const n = merged[x.id].length;
    const hot = ["flagged", "overdue", "highTodo"].includes(x.id) || (x.id === "returned" && merged.returned.some((r) => r.count > 1))
      || (x.id === "feitoQueue" && n >= scSettings().feitoThreshold);
    const t = el("button", `dm-tile ${n && hot ? "err" : ""} ${n ? "has" : ""}`);
    t.append(el("b", null, String(n)), el("span", null, `${x.icon} ${x.label}`));
    t.dataset.tip = `${x.tip}${x.state ? " · situação atual" : ` · ${PERIOD_LABEL[SC.period]}`}`;
    t.disabled = !n;
    t.addEventListener("click", () => document.getElementById(`rk-${x.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    sum.appendChild(t);
  }
  box.appendChild(sum);
  box.appendChild(el("p", "muted xs", `Reabertas, fila do QA, aguardando deploy e entradas seguem o período (${PERIOD_LABEL[SC.period]}); impedidas, paradas, atrasadas e sem responsável mostram a situação de agora.`));

  const qaQ = merged.qaQueue;
  if (qaQ.length >= 3) {
    const p = el("div", "dv-pace down");
    p.append(el("b", null, "!"), el("span", null, `${qaQ.length} itens na coluna Validação — o mais antigo há ${qaQ[0].age} ${pl(qaQ[0].age, "dia útil", "dias úteis")}. Vale combinar prioridade com o QA na daily.`));
    box.appendChild(p);
  }

  /* causas de reabertura registradas pelo QA */
  const causes = {};
  for (const r of merged.returned) for (const c of returnCauses(r.issue)) causes[c] = (causes[c] || 0) + 1;
  if (Object.keys(causes).length) {
    const c = mCard("Retrabalho por causa", "registrada pelo QA na reprovação");
    const row = el("div", "chips-row");
    for (const [k, n] of Object.entries(causes).sort((a, b) => b[1] - a[1])) row.appendChild(chip(`${k} · ${n}`, "warn"));
    c.appendChild(row);
    box.appendChild(c);
  }

  let any = false;
  for (const x of RISKS) {
    const rows = merged[x.id];
    if (!rows.length) continue;
    any = true;
    const c = mCard(`${x.icon} ${x.label}`, String(rows.length));
    c.id = `rk-${x.id}`;
    if (x.id === "feitoQueue") {
      for (const { sp, s, r } of all) {
        if (!r.feitoQueue.length) continue;
        const b = el("button", "btn sm", `Criar card “Realizando Deploy” · ${sp.project}`);
        b.addEventListener("click", () => openDeployForm(sp, s, r.feitoQueue.map((y) => y.issue)));
        c.appendChild(b);
      }
    }
    for (const r of rows.slice(0, 15)) {
      const i = r.issue;
      let sub = `${i.status.name}${i.assignee ? ` · ${i.assignee.name}` : " · sem responsável"}`;
      let right = r.age ? `${r.age}d` : "hoje";
      if (x.id === "flagged" && r.why) sub = `${r.why}${i.assignee ? ` · ${i.assignee.name}` : ""}`;
      if (x.id === "returned") {
        const cs = returnCauses(i);
        sub = `reaberta ${r.count}× · última: ${r.last.fromName} → ${r.last.toName}${r.last.byName ? ` por ${r.last.byName}${r.byQa ? " (QA)" : ""}` : ""}${cs.length ? ` · causa: ${cs.join(", ")}` : ""}`;
        right = `${r.count}×`;
      }
      if (x.id === "overdue") right = `${r.late}d atrasada`;
      if (x.id === "overEstimate") right = `+${fmtDur(r.over)}`;
      if (x.id === "orphanSubs") { sub = `subtarefa em ${r.own} · pai ${i.parentKey} já ${stageLabel(i).toLowerCase()}${i.assignee ? ` · ${i.assignee.name}` : ""}`; right = r.own; }
      if (x.id === "unassigned") {
        c.appendChild(taskRow(i, { meta: `${stageLabel(i)}${r.age ? ` · parada há ${r.age}d` : ""}${i.parentKey ? ` · ↳ ${i.parentKey}` : ""}`,
          actions: [prioPill(i.priority), assignControl(i, null)] }));
        continue;
      }
      const rr = el("span", "dm-right");
      rr.append(prioPill(i.priority));
      rr.append(el("span", "m-row-r", right));
      const line = issueLine(i, rr, `${sub}${i.parentKey ? ` · ↳ ${i.parentKey}` : ""}`, SC.data.url);
      if (["flagged", "overdue"].includes(x.id) || (x.id === "returned" && r.count > 1)) line.classList.add("late");
      c.appendChild(line);
    }
    if (rows.length > 15) c.appendChild(el("p", "muted xs", `+ ${rows.length - 15}`));
    box.appendChild(c);
  }
  if (!any) { const e = el("div", "empty"); e.innerHTML = "<b>✓</b>Nenhum risco na sprint agora."; box.appendChild(e); }
  if (!SC.data.fields.flagged) box.appendChild(el("p", "muted xs", "O campo Flagged não foi encontrado neste Jira — “Impedidas” usa só a coluna Impedido/Aguardando."));
}

/** Texto curto para levar à daily (Teams ou presencial). */
function dailySummary() {
  if (!SC.data) return "";
  const out = [];
  for (const { sp, s, r } of scRisks()) {
    const h = sprintHealth(s, SC.data.today);
    out.push(`${s.name} (${sp.project}) — dia ${h.elapsed}/${h.days.length} · ${h.done}/${h.total} concluídas (${pct(h.workPct)}) · tempo ${pct(h.timePct)}${h.onTrack ? "" : ` · previsão ~${h.forecast}/${h.total}`}`);
    for (const x of RISKS) {
      if (x.id === "added" || x.id === "overEstimate") continue;
      const rows = r[x.id];
      if (!rows.length) continue;
      out.push(`${x.icon} ${x.label} (${rows.length}): ${rows.slice(0, 5).map((y) => `${y.issue.key}${y.issue.assignee ? ` (${y.issue.assignee.name.split(" ")[0]})` : ""}`).join(", ")}${rows.length > 5 ? "…" : ""}`);
    }
    out.push("");
  }
  return out.join("\n").trim();
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* iframe sem permissão: cai no execCommand */ }
  const ta = el("textarea");
  ta.value = text;
  ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  return ok;
}

async function copyDaily() {
  const t = dailySummary();
  if (!t) return toast("Nada para copiar ainda.", "info");
  const ok = await copyText(t);
  toast(ok ? "Resumo copiado." : "Não foi possível copiar.", ok ? "ok" : "err");
}

$("scRefresh").addEventListener("click", () => loadScrum({ force: true }));
$("ppRefresh").addEventListener("click", () => loadScrum({ force: true }));
$("rkRefresh").addEventListener("click", () => loadScrum({ force: true }));
$("scCopy").addEventListener("click", copyDaily);
$("rkCopy").addEventListener("click", copyDaily);
$("scSettings").addEventListener("click", () => {
  const box = $("scSetBox");
  const open = box.classList.toggle("hidden") === false;
  $("scSettings").classList.toggle("on", open);
  if (open) renderScrumSettings();
});
$("scUnit").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  SC.unit = b.dataset.unit;
  try { localStorage.setItem("qf.scUnit", SC.unit); } catch { /* sem storage */ }
  document.querySelectorAll("#scUnit button").forEach((x) => x.classList.toggle("on", x === b));
  renderSprint();
});
$("ppSort").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  SC.sort = b.dataset.sort;
  document.querySelectorAll("#ppSort button").forEach((x) => x.classList.toggle("on", x === b));
  renderPeople();
});
$("ppFilter").addEventListener("input", () => { SC.q = $("ppFilter").value; renderPeople(); });
let scSearchTimer = null;
$("scSearch").addEventListener("input", () => {
  clearTimeout(scSearchTimer);
  scSearchTimer = setTimeout(() => { SC.search = $("scSearch").value; renderSprint(); $("scroll").scrollTop = 0; }, 150);
});
document.querySelectorAll("#scPeriod button").forEach((b) => b.classList.toggle("on", b.dataset.p === SC.period));
document.querySelectorAll("#scUnit button").forEach((b) => b.classList.toggle("on", b.dataset.unit === SC.unit));
/* Sprint anterior: escolhe no seletor ao lado do Período; "Sprint atual" volta ao padrão. */
function scPastSprint() {
  if (!SC.data?.past) return null;
  for (const sp of SC.data.spaces || []) for (const s of sp.closed || []) if (String(s.id) === String(SC.data.past)) return s;
  return { name: "Sprint anterior" };
}
function paintSprintPick() {
  const sel = $("scSprintPick");
  if (!sel) return;
  const spaces = (SC.data?.spaces || []).filter((sp) => !gspace.project || sp.project === gspace.project);
  const many = spaces.filter((sp) => (sp.closed || []).length).length > 1;
  const seen = new Set();
  sel.innerHTML = "";
  sel.append(new Option("Sprint atual", ""));
  for (const sp of spaces) {
    for (const s of sp.closed || []) {
      if (seen.has(String(s.id))) continue;   // quadro compartilhado: a mesma sprint em dois espaços
      seen.add(String(s.id));
      const when = s.start ? ` · ${dayShort(s.start)} a ${dayShort(s.end || s.start)}` : "";
      sel.append(new Option(`${many ? `${sp.label} · ` : ""}${s.name}${when}`, String(s.id)));
    }
  }
  if (SC.sprintId && !seen.has(SC.sprintId)) sel.append(new Option(scPastSprint()?.name || "Sprint anterior", SC.sprintId));
  sel.value = SC.sprintId;
  sel.classList.toggle("on", !!SC.sprintId);
  // numa sprint anterior, Hoje / 7 / 14 dias não fazem sentido: vale a sprint inteira
  document.querySelectorAll("#scPeriod button").forEach((b) => {
    b.disabled = !!SC.sprintId && b.dataset.p !== "sprint";
    b.classList.toggle("on", SC.sprintId ? b.dataset.p === "sprint" : b.dataset.p === SC.period);
  });
}
$("scSprintPick").addEventListener("change", (e) => {
  SC.sprintId = e.target.value;
  paintSprintPick();
  loadScrum({ force: false });
});

$("scPeriod").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  SC.period = b.dataset.p;
  document.querySelectorAll("#scPeriod button").forEach((x) => x.classList.toggle("on", x === b));
  try { localStorage.setItem("qf.scPeriod", SC.period); } catch { /* sem storage */ }
  renderScrum();
});

/* =====================================================================
   QuickFill DESIGN — HUs (prototipação → entregue ao dev)
   ===================================================================== */

const DS = { data: null, seq: 0, who: "all", figma: null, handoff: {}, open: new Set(), drafts: {} };

async function loadHus({ force = false } = {}) {
  force = force || takeFresh("design");
  const seq = ++DS.seq;
  if (!DS.data) {
    try {
      const { designData } = await chrome.storage.local.get({ designData: null });
      if (designData?.issues && !DS.data) { DS.data = designData; renderHus(); }
    } catch { /* sem cache */ }
  }
  if (canSkipFetch(DS.data, force)) { renderHus(); return; }
  $("huInfo").textContent = DS.data ? "atualizando…" : "";
  if (!DS.data) $("husBox").innerHTML = `<p class="muted xs">Lendo suas HUs…</p>`;
  try {
    const data = await send("DESIGN_HUS", { force });
    if (seq !== DS.seq) return;
    DS.data = data;
    chrome.storage.local.set({ designData: data }).catch(() => {});
    renderHus();
    if (data.figmaApi && (!DS.figma || force)) {
      DS.figma = await send("FIGMA_FRAMES", { force }).catch((e) => ({ frames: [], error: e.message }));
      if (seq === DS.seq) renderHus();
    }
    const keys = designBoard(data).rows.filter((r) => ["doing", "review", "handoff"].includes(r.stage)).map((r) => r.issue.key);
    if (keys.length) {
      DS.handoff = await send("HANDOFF_GET", { keys }).catch(() => DS.handoff);
      if (seq === DS.seq) renderHus();
    }
  } catch (e) {
    if (seq !== DS.seq) return;
    if (!DS.data) { $("husBox").innerHTML = ""; note($("husBox"), "err", e.message); }
    else toast(e.message);
  }
}

/* ---------- Figma ---------- */

const toProto = (url) => String(url).replace(/figma\.com\/(file|design)\//, "figma.com/proto/");
const huNumber = (s) => String(s || "").match(/\bHU\s*[-#]?\s*(\d+)/i)?.[1] || null;

/**
 * Onde está a tela da HU no Figma: 1) link colado na descrição; 2) frame do arquivo do projeto
 * cujo nome tem a chave (MEED-123) ou o número da HU ("HU 12"), via API do Figma.
 */
function figmaFor(i) {
  if (i.figmaLinks?.length) return { design: i.figmaLinks[0], proto: toProto(i.figmaLinks[0]), via: "link na HU" };
  const f = DS.figma;
  if (!f?.fileKey || !f.frames?.length) return null;
  const key = normName(i.key), hu = huNumber(i.summary);
  const hit = f.frames.find((x) => normName(x.name).includes(key))
    || (hu && f.frames.find((x) => huNumber(x.name) === hu));
  if (!hit) return null;
  const node = encodeURIComponent(hit.id.replace(/:/g, "-"));
  return { design: `https://www.figma.com/design/${f.fileKey}/?node-id=${node}`, proto: `https://www.figma.com/proto/${f.fileKey}/?node-id=${node}`, via: `tela “${hit.name}” (${hit.page})` };
}

function linkBtn(label, url, tip) {
  const b = el("button", "btn xs-btn", label);
  b.dataset.tip = tip;
  b.addEventListener("click", (e) => { e.stopPropagation(); openIssue(url, e); });
  return b;
}

/* ---------- Checklist de handoff ---------- */

function handoffCount(key) {
  const v = DS.handoff[key];
  return v ? HANDOFF_ITEMS.filter(([id]) => v.items?.[id]).length : 0;
}

function handoffPanel(r) {
  const i = r.issue;
  const cur = DS.drafts[i.key] || DS.handoff[i.key] || { items: {}, notes: "" };
  const box = el("div", "handoff");
  const items = {};
  for (const [id, label] of HANDOFF_ITEMS) {
    const row = el("label", "chk");
    const cb = el("input"); cb.type = "checkbox";
    cb.checked = id === "figma" ? !!(cur.items?.[id] ?? figmaFor(i)) : !!cur.items?.[id];
    items[id] = cb;
    row.append(cb, el("span", null, label));
    box.appendChild(row);
  }
  const notes = el("textarea", "inp ta");
  notes.rows = 2; notes.placeholder = "Observações para o dev (opcional)";
  notes.value = cur.notes || "";
  box.appendChild(notes);
  if (cur.by) box.appendChild(el("p", "muted xs", `Última atualização: ${cur.by}, ${since(cur.at)}${cur.published ? " · handoff publicado na HU" : ""}.`));
  const bar = el("div", "row-end");
  const save = el("button", "btn sm", "Salvar");
  const pub = el("button", "btn sm primary", "Concluir handoff (comenta na HU)");
  bar.append(save, pub);
  box.appendChild(bar);
  const collect = () => Object.fromEntries(Object.entries(items).map(([k, cb]) => [k, cb.checked]));
  // Rascunho do checklist enquanto não salva
  box.addEventListener("change", () => { DS.drafts[i.key] = { ...cur, items: collect(), notes: notes.value }; saveViewSoon(); });
  notes.addEventListener("input", () => { DS.drafts[i.key] = { ...cur, items: collect(), notes: notes.value }; saveViewSoon(); });
  const run = async (publish) => {
    const its = collect();
    if (publish && Object.values(its).some((v) => !v) && !confirm("Há itens desmarcados. Publicar o handoff assim mesmo?")) return;
    save.disabled = pub.disabled = true;
    try {
      delete DS.drafts[i.key];
      DS.handoff[i.key] = await send("HANDOFF_SAVE", { key: i.key, items: its, notes: notes.value, publish,
        labels: Object.fromEntries(HANDOFF_ITEMS), figma: figmaFor(i)?.design || "" });
      toast(publish ? `Handoff de ${i.key} publicado na HU.` : "Checklist salvo.", "ok");
      if (publish) DS.open.delete(i.key);
      renderHus();
    } catch (e) { save.disabled = pub.disabled = false; toast(e.message); }
  };
  save.addEventListener("click", () => run(false));
  pub.addEventListener("click", () => run(true));
  return box;
}

function huLine(r, d) {
  const i = r.issue;
  const bits = [i.status.name];
  if (i.assignee && !i.mine) bits.push(i.assignee.name);
  if (r.inSprint) bits.push("na sprint");
  if (r.cycle.rounds) bits.push(`${r.cycle.rounds}× revisão`);
  if (r.stage === "delivered" || r.stage === "handoff") { if (r.cycle.lead) bits.push(`protótipo em ${fmtSpan(r.cycle.lead)}`); }
  else if (r.age) bits.push(`há ${r.age}d nesta etapa`);
  const fg = figmaFor(i);
  if (!fg && ["doing", "review", "handoff"].includes(r.stage)) bits.push("sem Figma");
  if (r.blocked) bits.unshift("⛔ impedida");
  const right = el("span", "dm-right");
  if (fg) {
    right.append(linkBtn("Figma", fg.design, `Abrir no Figma — ${fg.via}`), linkBtn("▶ Protótipo", fg.proto, `Ver o protótipo navegável — ${fg.via}`));
  }
  if (["doing", "review", "handoff"].includes(r.stage)) {
    const n = handoffCount(i.key);
    const b = el("button", `btn xs-btn ${n === HANDOFF_ITEMS.length ? "ok" : ""} ${DS.open.has(i.key) ? "on" : ""}`, `Handoff ${n}/${HANDOFF_ITEMS.length}`);
    b.dataset.tip = "Checklist de handoff Design → DEV";
    b.addEventListener("click", (e) => { e.stopPropagation(); DS.open.has(i.key) ? DS.open.delete(i.key) : DS.open.add(i.key); renderHus(); });
    right.append(b);
  }
  right.append(prioPill(i.priority));
  const line = issueLine(i, right, `${bits.join(" · ")}${i.parentKey ? ` · ↳ ${i.parentKey}` : ""}`, d.url);
  if (r.inSprint && ["queue", "doing", "review"].includes(r.stage) && isHighPrio(i.priority)) line.classList.add("late");
  if (!DS.open.has(i.key)) return line;
  const wrap = el("div", "hu-wrap");
  wrap.append(line, handoffPanel(r));
  return wrap;
}

function renderHus() {
  const d = DS.data;
  if (!d) return;
  const box = $("husBox");
  box.innerHTML = "";
  $("huFigma").classList.toggle("hidden", !d.figmaUrl);
  const data = DS.who === "mine" ? { ...d, issues: d.issues.filter((i) => i.mine) } : d;
  const b = designBoard(data, { project: gspace.project });
  $("huInfo").textContent = `${d.ownSpace ? `espaço ${(d.projects || []).join(", ")}` : `etiquetas: ${d.labels.join(", ") || "—"}`} · atualizado ${since(d.generatedAt)}`;

  const k = el("div", "m-kpis four");
  const inSprintQueue = b.waiting.filter((r) => r.stage === "queue").length;
  k.append(
    kpiTile(String(b.groups.queue.length), "na fila", inSprintQueue ? `${inSprintQueue} já na sprint` : ""),
    kpiTile(String(b.groups.doing.length), "prototipando"),
    kpiTile(String(b.groups.review.length), "em revisão", b.rounds ? `${b.rounds} ${pl(b.rounds, "retorno", "retornos")} de revisão` : ""),
    kpiTile(`${b.thisWeek}/${d.weeklyGoal}`, "entregues na semana", "protótipo pronto → backlog do dev", b.thisWeek >= d.weeklyGoal ? "ok" : "", "HUs cujo protótipo foi concluído e seguiram para o backlog da sprint do dev nesta semana"),
  );
  box.appendChild(k);

  if (d.figmaApi && DS.figma?.error) note(box, "warn", `Figma: ${DS.figma.error}`);
  if (b.blocked.length) {
    const c = mCard("⛔ Impedidas / aguardando", String(b.blocked.length));
    c.classList.add("hu-wait");
    for (const r of b.blocked.slice(0, 10)) c.appendChild(huLine(r, d));
    box.appendChild(c);
  }

  if (b.waiting.length) {
    const c = mCard("⏰ Devs aguardando design", "HUs da sprint ativa que ainda não saíram da prototipação");
    c.classList.add("hu-wait");
    for (const r of b.waiting.slice(0, 10)) c.appendChild(huLine(r, d));
    box.appendChild(c);
  }

  const wc = mCard("Entregas por semana", `meta ${d.weeklyGoal}`);
  const chart = el("div", "pg-chart hu-chart");
  const max = Math.max(d.weeklyGoal * 1.3, ...b.series.map((x) => x.count), 1);
  for (const w of b.series) {
    const col = el("div", `pg-col${w.current ? " cur" : ""}`);
    const bar = el("i", w.count >= d.weeklyGoal ? "met" : w.count ? "part" : "");
    bar.style.height = `${Math.max(w.count ? 4 : 0, (w.count / max) * 100)}%`;
    col.append(bar, el("small", null, brShort(w.week)));
    col.dataset.tip = `Semana de ${brShort(w.week)}: ${w.count} ${pl(w.count, "HU entregue", "HUs entregues")}`;
    chart.appendChild(col);
  }
  const gl = el("span", "pg-goal");
  gl.style.bottom = `calc(16px + (100% - 16px) * ${d.weeklyGoal / max})`;
  gl.dataset.label = `meta ${d.weeklyGoal}`;
  chart.appendChild(gl);
  wc.appendChild(chart);
  const bits = [];
  if (b.avgLead) bits.push(`tempo médio de prototipação: ${fmtSpan(b.avgLead)}`);
  if (b.rounds) bits.push(`${b.rounds} ${pl(b.rounds, "volta", "voltas")} da revisão`);
  if (bits.length) wc.appendChild(el("p", "muted xs", `${bits.join(" · ")}.`));
  box.appendChild(wc);

  for (const s of DESIGN_STAGES) {
    const rows = b.groups[s.id];
    if (!rows.length) continue;
    const c = mCard(`${s.icon} ${s.label}`, String(rows.length));
    c.classList.add("dm-card");
    const limit = s.id === "delivered" || s.id === "handoff" ? 8 : 15;
    for (const r of rows.slice(0, limit)) c.appendChild(huLine(r, d));
    if (rows.length > limit) c.appendChild(el("p", "muted xs", `+ ${rows.length - limit}`));
    box.appendChild(c);
  }

  const noFig = b.rows.filter((r) => ["doing", "review", "handoff"].includes(r.stage) && !figmaFor(r.issue));
  if (noFig.length) {
    const det = document.createElement("details");
    det.className = "card dm-idle";
    const sm = document.createElement("summary");
    sm.textContent = `Sem tela do Figma vinculada · ${noFig.length}`;
    det.appendChild(sm);
    det.appendChild(el("p", "muted xs", d.figmaApi
      ? "Cole o link do Figma na HU ou coloque a chave (ex.: MEED-123) ou “HU 12” no nome do frame no Figma."
      : "Cole o link do Figma na descrição da HU. Com o token do Figma nas Opções, a extensão também acha a tela pelo nome do frame."));
    for (const r of noFig.slice(0, 20)) det.appendChild(huLine(r, d));
    box.appendChild(det);
  }
  if (!b.rows.length) { const e = el("div", "empty"); e.innerHTML = `<b>🎨</b>Nenhuma HU ${DS.who === "mine" ? "atribuída a você" : "com as etiquetas de design"} neste espaço.`; box.appendChild(e); }
  if (d.truncated) note(box, "warn", "Mais de 300 HUs: mostrando as atualizadas mais recentemente.");
}

$("huRefresh").addEventListener("click", () => loadHus({ force: true }));
$("huFigma").addEventListener("click", (e) => DS.data?.figmaUrl && openIssue(DS.data.figmaUrl, e));
$("huWho").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  DS.who = b.dataset.who;
  document.querySelectorAll("#huWho button").forEach((x) => x.classList.toggle("on", x === b));
  try { localStorage.setItem("qf.huWho", DS.who); } catch { /* sem storage */ }
  renderHus();
});

/* =====================================================================
   QuickFill QA — fila de validação e evidência de teste
   ===================================================================== */

const QQ = { data: null, seq: 0, who: "all" };

async function loadQaQueue({ force = false } = {}) {
  const seq = ++QQ.seq;
  $("qqInfo").textContent = QQ.data ? "atualizando…" : "";
  if (!QQ.data) $("qaqBox").innerHTML = `<p class="muted xs">Lendo a fila de validação…</p>`;
  try {
    const data = await send("QA_QUEUE", { force });
    if (seq !== QQ.seq) return;
    QQ.data = data;
    renderQaQueue();
  } catch (e) {
    if (seq !== QQ.seq) return;
    $("qaqBox").innerHTML = "";
    note($("qaqBox"), "err", e.message);
  }
}

function renderQaQueue() {
  const d = QQ.data;
  if (!d) return;
  const box = $("qaqBox");
  box.innerHTML = "";
  $("qqInfo").textContent = `atualizado ${since(d.generatedAt)}`;
  const rows = d.issues.filter((i) => (QQ.who === "all" || i.mine) && inSpace(i.key))
    .map((i) => ({ i, age: businessAge(i.waitingSince), recent: inQp(i.waitingSince) }))
    .sort((a, b) => (a.i.priority?.rank ?? 99) - (b.i.priority?.rank ?? 99) || b.age - a.age);
  const recent = rows.filter((r) => r.recent), older = rows.filter((r) => !r.recent);
  const k = el("div", "m-kpis four");
  const high = rows.filter((r) => isHighPrio(r.i.priority)).length;
  k.append(
    kpiTile(String(rows.length), "aguardando validação", gspace.project || "todos os espaços"),
    kpiTile(String(recent.length), `chegaram ${QP_LABEL[QP.period]}`, older.length ? `${older.length} ${pl(older.length, "mais antiga", "mais antigas")}` : ""),
    kpiTile(String(high), "alta / crítica", "", high ? "warn" : "ok"),
    kpiTile(rows.length ? `${Math.max(...rows.map((r) => r.age))}d` : "—", "mais antiga", "dias úteis na fila", rows.some((r) => r.age >= 3) ? "warn" : ""),
  );
  box.appendChild(k);
  const section = (title, sub, list) => {
    const c = mCard(title, sub);
    for (const { i, age } of list.slice(0, 40)) {
      const right = el("span", "dm-right");
      const test = el("button", "btn xs-btn", "Testar");
      test.dataset.tip = "Abre na aba Tarefa para apontar e registrar a evidência";
      test.addEventListener("click", (e) => { e.stopPropagation(); openFromPanel({ key: i.key, parentKey: i.isSubtask ? i.parentKey : null }); });
      right.append(test, prioPill(i.priority), el("span", "m-row-r", age ? `${age}d` : "hoje"));
      const line = issueLine(i, right, `${i.status.name}${i.sentBy ? ` · enviado por ${i.sentBy}` : ""}${i.assignee ? ` · ${i.assignee.name}` : ""}${i.parentKey ? ` · ↳ ${i.parentKey}` : ""}`, d.url);
      if (age >= 3) line.classList.add("late");
      c.appendChild(line);
    }
    if (list.length > 40) c.appendChild(el("p", "muted xs", `+ ${list.length - 40}`));
    return c;
  };
  if (recent.length) box.appendChild(section(`Chegaram ${QP_LABEL[QP.period]}`, "prioridade, depois tempo esperando", recent));
  if (older.length) box.appendChild(section(QP.period === "yesterday" ? "Fora de ontem" : "Esperando há mais tempo", `fora do período · ${older.length}`, older));
  if (!rows.length) box.appendChild(el("div", "empty", "Nada esperando validação 🎉"));
  if (d.truncated) note(box, "warn", "Mais de 200 itens: mostrando os primeiros.");
}

$("qqRefresh").addEventListener("click", () => loadQaQueue({ force: true }));
$("qqWho").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  QQ.who = b.dataset.who;
  document.querySelectorAll("#qqWho button").forEach((x) => x.classList.toggle("on", x === b));
  renderQaQueue();
});

/* ---------- Evidência de teste (aba Tarefa) ---------- */

const EV = { result: "approved" };

function renderEvidenceTargets() {
  const sel = $("evTarget");
  const prev = sel.value;
  sel.innerHTML = "";
  if (state.parent?.key) sel.appendChild(new Option(`Tarefa pai · ${state.parent.key}`, state.parent.key));
  if (state.selected?.key && state.selected.key !== state.parent?.key) sel.appendChild(new Option(`Selecionada · ${state.selected.key}`, state.selected.key));
  if (!sel.options.length) sel.appendChild(new Option("Busque uma tarefa primeiro", ""));
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function setEvResult(r) {
  EV.result = r;
  document.querySelectorAll("#evResult button").forEach((b) => b.classList.toggle("on", b.dataset.r === r));
  $("evReject").classList.toggle("hidden", r !== "rejected");
  $("btnEvidence").textContent = r === "rejected" ? "Registrar reprovação" : "Registrar aprovação";
}

$("btnShowEvidence").addEventListener("click", () => {
  const body = $("evidenceBody");
  body.classList.toggle("hidden");
  if (!body.classList.contains("hidden")) {
    renderEvidenceTargets();
    const sel = $("evCategory");
    if (!sel.options.length) for (const c of String(DEF.qaRejectCategories || "").split(",").map((x) => x.trim()).filter(Boolean)) sel.appendChild(new Option(c, c));
  }
});
$("evResult").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setEvResult(b.dataset.r); });
$("btnEvidence").addEventListener("click", async () => {
  const key = $("evTarget").value;
  if (!key) return toast("Busque uma tarefa primeiro.");
  if (EV.result === "rejected" && !$("evReason").value.trim()) return toast("Descreva o motivo da reprovação.");
  busy(true);
  try {
    const res = await send("POST_EVIDENCE", {
      key, result: EV.result, env: $("evEnv").value.trim(), steps: $("evSteps").value, link: $("evLink").value.trim(),
      category: $("evCategory").value, reason: $("evReason").value.trim(),
    });
    const bad = res.steps.filter((s) => !s.ok);
    toast(bad.length ? `${key}: comentário registrado, mas ${bad.map((s) => `${s.step} — ${s.detail}`).join("; ")}` : `Evidência registrada em ${key}.`, bad.length ? "err" : "ok");
    $("evSteps").value = ""; $("evReason").value = ""; $("evLink").value = "";
  } catch (e) { toast(e.message); } finally { busy(false); }
});

/* =====================================================================
   Ligações
   ===================================================================== */

/* ---------- Voltar de onde parou ----------
 * Sair clicando fora, com Esc, abrindo uma demanda ou trocando de aba guarda a tela (aba, rolagem,
 * filtros, cartões abertos e campos digitados) na sessão do Chrome; ao reabrir, tudo volta do jeito
 * que estava, com os dados já carregados. O X fecha "de verdade": limpa isso e recarrega do Jira. */
const VIEW_KEY = `qfView:${ROLE}`;
const FRESH_KEY = `qfFresh:${ROLE}`;
const RESUME = { active: false, fresh: new Set(), maxAge: 10 * 60 * 1000, quitting: false };
const takeFresh = (k) => RESUME.fresh.delete(k);
const canSkipFetch = (data, force) => !force && RESUME.active && !!data && Date.now() - (data.generatedAt || data.fetchedAt || 0) < RESUME.maxAge;
const EV_IDS = ["evEnv", "evSteps", "evLink", "evReason", "evCategory", "evTarget"];

function viewSnapshot() {
  const v = { savedAt: Date.now(), mode: state.mode, scroll: $("scroll").scrollTop, teamDate: team.date };
  if (ROLE === "scrum") v.sc = { search: SC.search || "", q: SC.q || "", stageSel: SC.stageSel || null, pOpen: [...SC.pOpen],
    pStage: [...SC.pStage], treeAll: SC.treeAll, deploy: SC.deployDraft || null };
  if (ROLE === "design") { v.ds = { open: [...DS.open], drafts: DS.drafts }; v.ux = uxViewState(); }
  if (HAS_PROG) v.dv = { date: DV.date };
  if (ROLE === "qa") v.qa = { qqWho: QQ.who, dayDate: state.dayDate, evOpen: !$("evidenceBody").classList.contains("hidden"),
    evResult: EV.result, ev: Object.fromEntries(EV_IDS.map((id) => [id, $(id).value])) };
  return v;
}
async function saveView() {
  if (RESUME.quitting) return;
  try { await chrome.storage.session.set({ [VIEW_KEY]: viewSnapshot() }); } catch { /* sem storage */ }
}
let viewTimer = null;
function saveViewSoon() { clearTimeout(viewTimer); viewTimer = setTimeout(saveView, 300); }

/** Lê a tela salva (ou o pedido de recomeçar do zero, deixado pelo X). */
async function resumeView() {
  try {
    const got = await chrome.storage.session.get({ [VIEW_KEY]: null, [FRESH_KEY]: false });
    if (got[FRESH_KEY]) {
      await chrome.storage.session.remove(FRESH_KEY);
      RESUME.fresh = new Set(["scrum", "design", "demands", "panel"]);
      return null;
    }
    const v = got[VIEW_KEY];
    if (!v || Date.now() - v.savedAt > 12 * 3600 * 1000) return null;
    RESUME.active = true;
    return v;
  } catch { return null; }
}

/** Antes de desenhar: filtros, buscas e cartões abertos. */
function applyViewState(v) {
  if (v.sc) {
    SC.search = v.sc.search || ""; $("scSearch").value = SC.search;
    SC.q = v.sc.q || ""; $("ppFilter").value = SC.q;
    SC.stageSel = v.sc.stageSel; SC.treeAll = !!v.sc.treeAll;
    SC.pOpen = new Set(v.sc.pOpen || []); SC.pStage = new Map(v.sc.pStage || []);
    SC.deployDraft = v.sc.deploy || null;
  }
  if (v.ds) { DS.open = new Set(v.ds.open || []); DS.drafts = v.ds.drafts || {}; }
  if (v.ux) uxApplyViewState(v.ux);
  if (v.dv?.date) DV.date = v.dv.date;
  if (v.teamDate) team.date = v.teamDate;
  if (v.qa) {
    QQ.who = v.qa.qqWho || "all";
    document.querySelectorAll("#qqWho button").forEach((b) => b.classList.toggle("on", b.dataset.who === QQ.who));
    if (v.qa.dayDate) state.dayDate = v.qa.dayDate;
  }
}

/** Depois de desenhar: rolagem, formulário de deploy e evidência. */
function applyViewAfter(v) {
  let tries = 0;
  let waiting = !!v.sc?.deploy;   // o formulário de deploy reabre antes de rolar (senão a tela desloca)
  const sc = $("scroll");
  const tick = () => {
    if ((!waiting && sc.scrollHeight - sc.clientHeight >= v.scroll) || ++tries > 50) { sc.style.overflowAnchor = "none"; sc.scrollTop = v.scroll; setTimeout(() => { sc.style.overflowAnchor = ""; }, 500); return; }
    setTimeout(tick, 100);
  };
  if (v.scroll) tick();
  if (v.sc?.deploy) {
    let n = 0;
    const reopen = () => {
      if (!SC.data) { if (++n < 50) setTimeout(reopen, 100); else waiting = false; return; }
      const d = v.sc.deploy;
      const sp = (SC.data.spaces || []).find((x) => x.project === d.project);
      const sprint = sp?.sprints?.find((s) => String(s.id) === String(d.sprintId));
      if (sp && sprint) openDeployForm(sp, sprint, sprint.issues.filter((i) => stageOf(i) === "feito"), d).finally(() => { waiting = false; });
      else waiting = false;
    };
    reopen();
  }
  if (v.qa) {
    for (const [id, val] of Object.entries(v.qa.ev || {})) if (val != null && id !== "evTarget" && id !== "evCategory") $(id).value = val;
    if (v.qa.evOpen) {
      $("btnShowEvidence").click();
      if (v.qa.ev?.evCategory) $("evCategory").value = v.qa.ev.evCategory;
      if (v.qa.ev?.evTarget) $("evTarget").value = v.qa.ev.evTarget;
    }
    if (v.qa.evResult) setEvResult(v.qa.evResult);
  }
}

/* ---------- Setas de recolher/expandir em todos os cards ----------
 * Cada card com título ganha uma seta à direita; o estado fica salvo por tela e título. */
const FOLD_KEY = `qf.fold.${ROLE}`;
let folded = new Set();
try { folded = new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || "[]")); } catch { /* sem storage */ }
const cardKey = (card) => {
  const t = card.querySelector(":scope > .card-t");
  const raw = (t.querySelector("b")?.textContent || t.firstChild?.textContent || "").replace(/[\d·:()%“”"]+/g, "").trim();
  return `${card.closest("[data-pane]")?.dataset.pane || ""}:${raw}`;
};
function enhanceCards(root = $("scroll")) {
  for (const t of root.querySelectorAll(".card > .card-t")) {
    const card = t.parentElement;
    if (card.dataset.fold || card.tagName === "DETAILS" || card.classList.contains("deploy-form") || card.classList.contains("nofold")) continue;
    card.dataset.fold = "1";
    const key = cardKey(card);
    if (folded.has(key)) card.classList.add("folded");
    const b = el("button", "fold-btn");
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    b.title = "Recolher / expandir";
    b.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      const on = card.classList.toggle("folded");
      if (on) folded.add(key); else folded.delete(key);
      try { localStorage.setItem(FOLD_KEY, JSON.stringify([...folded])); } catch { /* sem storage */ }
    });
    t.appendChild(b);
  }
}
let foldRaf = 0;
new MutationObserver(() => { cancelAnimationFrame(foldRaf); foldRaf = requestAnimationFrame(() => enhanceCards()); })
  .observe($("scroll"), { childList: true, subtree: true });

/* ---------- Painel lateral ⇄ modal grande ---------- */
$("btnLayout").textContent = inPanel ? "⤢" : "◧";
$("btnLayout").title = inPanel ? "Abrir como modal grande sobre o Jira" : "Abrir no painel lateral do Chrome";
$("btnLayout").addEventListener("click", async () => {
  await saveView();   // o outro formato abre exatamente onde você está
  if (inPanel) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { type: "QUICKFILL_OPEN_MODAL" });
      window.close();
    } catch { toast("O modal abre sobre uma página do Jira — abra o Jira nesta aba e tente de novo."); }
    return;
  }
  try {
    const w = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: w.id });
    close();
  } catch {
    try { await send("OPEN_SIDE_PANEL"); close(); }
    catch { toast("Não deu para abrir o painel daqui — clique no ícone da extensão na barra do Chrome.", "info"); }
  }
});

/* ---------- Janela flutuante (teste, nos 4 perfis) ---------- */
{
  $("btnPop")?.addEventListener("click", () => popOutFromPanel({ saveView, toast }));
  initFloat({
    mode: () => state.mode, booting: () => !BOOT.done, toast, saveView, fmt: fmtDur, dayShort, today: todayISO,
    day: () => (state.mode === "day" ? state.dayView : state.mode === "today" ? DV.view : null),
  });
}

/* ---------- Aviso de nova versão (repositório da equipe) ---------- */
/** Comando de instalação com o id desta extensão: além de atualizar, libera o botão "Atualizar agora". */
function activationCommand(base = INSTALL_CMD) {
  if (!base) return "";
  return base.replace('-Command "', `-Command "$env:QF_EXT_ID='${chrome.runtime.id}'; `);
}

/** Atualiza pelo ajudante nativo e recarrega a extensão (voltando no mesmo ponto). */
async function updateNow(btn) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Atualizando…";
  toast("Baixando e instalando a versão nova…", "info");
  try {
    await send("NATIVE_UPDATE");
    await Promise.all([flushDraft(snapshot), saveView()]);
    toast("Atualizado! Recarregando o QuickFill…", "ok");
    setTimeout(() => chrome.runtime.reload(), 600);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = label;
    toast(`Não deu para atualizar sozinho: ${e.message}. Use “Copiar comando de atualização”.`);
  }
}

async function checkForUpdate() {
  try {
    const u = await send("CHECK_UPDATE", {});
    if (!u?.newer) return;
    const { updateDismissed } = await chrome.storage.local.get({ updateDismissed: "" });
    if (updateDismissed === u.latest) return;
    const box = $("updateBox");
    box.querySelector("span").textContent = `Nova versão ${u.latest} disponível — você está na ${u.current}.${u.notes ? ` ${u.notes}` : ""}`;
    box.classList.remove("hidden");
    // Repositório privado: quem baixa é o instalador (com o token); o botão abre o repositório no GitHub
    $("btnUpdateGet").textContent = "Ver o que mudou";
    $("btnUpdateGet").onclick = (e) => {
      const url = u.guide || u.repo;
      return url ? openIssue(url, e) : toast("O update.json não tem o link.");
    };
    // Com o ajudante ativado: "Atualizar agora" (um clique). Sem ele: copiar o comando — que também ativa o botão.
    const nat = await send("NATIVE_PING").catch(() => ({ available: false }));
    const cmd = activationCommand(u.installCommand);
    $("btnUpdateHow").textContent = nat.available ? "Atualizar agora" : cmd ? "Copiar comando de atualização" : "Como atualizar";
    $("btnUpdateHow").classList.toggle("primary", !!nat.available);
    $("btnUpdateHow").onclick = async () => {
      if (nat.available) return updateNow($("btnUpdateHow"));
      if (!cmd) return toast("Rode o atualizar-quickfill.bat de novo. Depois clique em “Recarregar extensão” que aparece aqui no topo.", "info");
      const ok = await copyText(cmd);
      toast(ok ? "Comando copiado! Tecle Win+R, cole (Ctrl+V) e Enter. Ao terminar, clique em “Recarregar extensão” aqui no topo — e das próximas vezes já aparece “Atualizar agora”."
        : `Copie e rode: ${cmd}`, ok ? "ok" : "info");
    };
    $("updateClose").onclick = () => { box.classList.add("hidden"); chrome.storage.local.set({ updateDismissed: u.latest }).catch(() => {}); };
  } catch { /* sem aviso: segue normal */ }
}

async function close() {
  await Promise.all([flushDraft(snapshot), saveView()]);
  if (inIframe) window.parent.postMessage({ type: "QUICKFILL_CLOSE" }, "*");
  else window.close();
}

/** X: fecha de verdade — sem rascunho nem tela salva; na próxima vez tudo vem do Jira. */
async function quit() {
  RESUME.quitting = true;
  clearTimeout(viewTimer);
  try {
    await chrome.storage.session.remove(VIEW_KEY);
    await chrome.storage.session.set({ [FRESH_KEY]: true });
    await chrome.storage.local.remove(["scrumData", "designData", "devDemands", "panelData"]);
  } catch { /* segue fechando */ }
  if (ROLE === "qa") await clearDraft();
  if (inIframe) window.parent.postMessage({ type: "QUICKFILL_CLOSE" }, "*");
  else window.close();
}

$("btnFind").addEventListener("click", findSubtasks);
$("parentKey").addEventListener("keydown", (e) => { if (e.key === "Enter") findSubtasks(); });
$("btnCreateSingle").addEventListener("click", createSingleSubtask);
$("btnCreateBatch").addEventListener("click", createBatchSubtasks);
$("btnFromBoard").addEventListener("click", loadFromBoard);
$("btnUseSelected").addEventListener("click", () => resolveBatch());
$("btnResolve").addEventListener("click", () => resolveBatch());
$("boardAll").addEventListener("click", () => pickBoard("all"));
$("boardMine").addEventListener("click", () => pickBoard("mine"));
$("boardNone").addEventListener("click", () => pickBoard("none"));
$("btnApply").addEventListener("click", apply);
$("btnClose").addEventListener("click", quit);
$("btnClose").title = "Fechar e recomeçar (na próxima vez recarrega tudo do Jira). Clicar fora ou Esc fecha guardando onde você parou.";
$("btnOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("btnDiscard").addEventListener("click", discardAll);
$("restoredClose").addEventListener("click", () => $("restored").classList.add("hidden"));
$("btnReloadExt").addEventListener("click", async () => {
  try { await flushDraft(snapshot); } catch { /* segue */ }
  $("staleBox").querySelector("span").textContent = "Recarregando… abra o modal de novo em seguida.";
  chrome.runtime.reload();
});

$("btnPickAll").addEventListener("click", () => { const sp = space(); sp.checked = sp.targets.map((t) => t.key); renderBatchList(); updateTimeHint(); refreshWorkday(); touch(); });
$("btnPickMine").addEventListener("click", () => {
  const sp = space();
  sp.checked = sp.targets.filter((t) => t.assigneeId && t.assigneeId === sp.me?.accountId).map((t) => t.key);
  renderBatchList(); updateTimeHint(); refreshWorkday(); touch();
  if (!sp.checked.length) toast("Nenhuma subtarefa está atribuída a você.", "info");
});

$("btnReset").addEventListener("click", () => { setFormValues(blankForm()); refreshWorkday({ delay: 0 }); touch(); });

["parentKey", "batchKeys", "statusColumns", "onlyMineBoard", "excludeSubBoard", ...FORM_IDS, ...CREATE_IDS]
  .forEach((id) => { $(id).addEventListener("input", touch); $(id).addEventListener("change", touch); });

$("estimate").addEventListener("input", () => { updatePreview("estimate", "prevEstimate"); updateEstimateMatch(); });
$("spent").addEventListener("input", () => { updatePreview("spent", "prevSpent"); updateEstimateMatch(); updateTimeHint(); refreshWorkday(); });
$("startDate").addEventListener("change", () => { updateTimeHint(); refreshWorkday(); updateStartHint(); });
$("startTime").addEventListener("input", () => {
  if (!$("startTime").value || $("startTime").value === state.echo.start) return;   // eco do cálculo
  state.startAnchor = hmToMin($("startTime").value);
  setTimeMode("start");
});
$("endTime").addEventListener("input", () => {
  if (!$("endTime").value || $("endTime").value === state.echo.end) return;         // eco do ajuste à jornada
  state.endAnchor = hmToMin($("endTime").value);
  setTimeMode("end");
});
$("btnAutoTime").addEventListener("click", () => setTimeMode("auto"));
$("btnNow").addEventListener("click", () => {
  const prevDay = $("startDate").value;
  $("startDate").value = todayISO();
  state.endAnchor = nowMin();
  $("endTime").value = fmtHM(nowEnd());
  if (prevDay !== todayISO()) toast("Dia ajustado para hoje.", "info");
  setTimeMode("end");
});

document.querySelectorAll(".chips").forEach((g) => g.addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  e.preventDefault();
  $(g.dataset.target).value = e.target.textContent;
  refreshPreviews();
  if (g.dataset.target === "spent") { updateTimeHint(); refreshWorkday({ delay: 0 }); }
  touch();
}));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") close();
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") apply();
});
window.addEventListener("message", (e) => { if (e.data?.type === "QUICKFILL_REQUEST_CLOSE") close(); });
window.addEventListener("pagehide", () => { if (!RESUME.quitting) { flushDraft(snapshot); saveView(); } });
window.addEventListener("blur", () => { if (!RESUME.quitting) { flushDraft(snapshot); saveView(); } });
document.addEventListener("visibilitychange", () => { if (document.hidden && !RESUME.quitting) saveView(); });
document.addEventListener("input", saveViewSoon, true);
document.addEventListener("change", saveViewSoon, true);
$("scroll").addEventListener("scroll", saveViewSoon, { passive: true });

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "BATCH_PROGRESS") return;
  const { phase, done, total, current } = msg.payload || {};
  const LABEL = { resolve: "Lendo tarefas", context: "Lendo subtarefas", apply: "Aplicando", create: "Criando subtarefas" };
  $("batchProgress").classList.remove("hidden");
  $("bar").style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  $("progressLabel").textContent = `${LABEL[phase] || phase} ${done}/${total}${current ? ` · ${current}` : ""}`;
});

/* =====================================================================
   Início
   ===================================================================== */

(async function boot() {
  try {
    const { uiScale: saved } = await chrome.storage.local.get({ uiScale: 1 });
    applyScale(Number(saved) || 1, { save: false });
  } catch { applyScale(1, { save: false }); }
  $("startDate").value = todayISO();
  $("teamDate").value = todayISO();
  $("teamDate").max = todayISO();
  $("dayDate").max = todayISO();
  renderFib();
  updateTimeHint();
  checkService();

  let defaults = null;
  try {
    defaults = await send("GET_DEFAULTS");
    DEF = { ...DEF, ...defaults, workday: { ...DEF.workday, ...(defaults.workday || {}) } };
    // Reuniões e atividades: onde a demanda é criada (o DESIGN cria no espaço UX; MEED e SUS ficam no seletor)
    const mtgProjects = [defaults.spaces?.batch?.label, defaults.spaces?.sustentacao?.label];
    if (ROLE === "design" && defaults.uxProject) mtgProjects.unshift(defaults.uxProject);
    setMeetingApi({ project: ROLE === "design" && defaults.uxProject ? defaults.uxProject : (defaults.defaultProject || defaults.spaces?.batch?.label || ""),
      projects: [...new Set(mtgProjects.filter(Boolean))] });
    state.storyPoints = DEF.defaultStoryPoints;
    renderFib();
    updateTimeHint();
    $("newSubtaskName").placeholder = defaults.subtaskName || "Testes Manuais";
    $("newSubtaskNameBatch").placeholder = defaults.subtaskName || "Testes Manuais";
    $("assignSelfSingle").checked = defaults.assignSelf !== false;
    $("assignSelfBatch").checked = defaults.assignSelf !== false;
    for (const id of SPACES) {
      state.spaces[id].project = defaults.spaces?.[id]?.project || "";
      state.spaces[id].columns = defaults.spaces?.[id]?.columns || "";
      state.spaces[id].boardId = defaults.spaces?.[id]?.boardId || "";
      if (defaults.spaces?.[id]?.label) SPACE_LABEL[id] = defaults.spaces[id].label;
    }
    document.querySelectorAll("#spaceSeg button").forEach((b) => { b.textContent = SPACE_LABEL[b.dataset.space]; });
    const [ab] = String(defaults.aliases || "M=MEED").split(",")[0].split("=");
    if (ab) $("parentKey").placeholder = `${ab.trim()}1653`;
    $("dayPillGoal").textContent = `meta ${fmtDur(DEF.workday.goal)}`;
  } catch { /* sem configuração ainda */ }

  if (ROLE !== "scrum") refreshDayPill();
  checkForUpdate();

  document.querySelector(".brand h1").textContent = ROLE_NAME;
  document.title = `Jira ${ROLE_NAME}`;

  if (IS_DASH) {
    // DEV / SCRUM / DESIGN: painéis só de leitura — sem Tarefa/Lote e sem rascunho.
    await loadPrefs();
    try { gspace.project = localStorage.getItem("qf.gspace") || ""; } catch { /* sem storage */ }
    try { DS.who = localStorage.getItem("qf.huWho") || "all"; } catch { /* sem storage */ }
    document.querySelectorAll("#huWho button").forEach((b) => b.classList.toggle("on", b.dataset.who === DS.who));
    const projects = ROLE === "design" && defaults?.designProjects?.length
      ? defaults.designProjects
      : [defaults?.spaces?.batch?.label || "MEED", defaults?.spaces?.sustentacao?.label || "SUS"];
    if (!projects.includes(gspace.project)) gspace.project = "";
    renderGlobalSpace([...new Set(projects)]);
    if (ROLE === "design") await initUx({ send, toast, jiraLink, rerender: rerenderUx });
    const TABS = { dev: ["today", "progress", "demands", "team"], scrum: ["sprint", "people", "risks", "team"], design: ["today", "uxboard", "uxdeliv", "uxdemand", "progress", "team"] }[ROLE];
    $("ctxLine").textContent = { dev: "Seu dia, seu progresso e sua equipe", scrum: "Sprint, pessoas, riscos e equipe", design: "Espaço UX: seu dia, quadro, entregas e demanda" }[ROLE] || "";
    if (HAS_PROG) await warmProg();
    const want = params.get("tab");
    const view = await resumeView();
    if (view) applyViewState(view);
    setMode(view && TABS.includes(view.mode) ? view.mode : TABS.includes(want) ? want : TABS[0], { restoring: true });
    if (view) applyViewAfter(view);
    return;
  }

  // QA: o mesmo filtro de Espaço dos outros QuickFill (Painel, Validação, Meu dia, Equipe)
  try { gspace.project = localStorage.getItem("qf.gspace") || ""; } catch { /* sem storage */ }
  const qaSpaces = [...new Set([defaults?.spaces?.batch?.label || "MEED", defaults?.spaces?.sustentacao?.label || "SUS"])];
  if (!qaSpaces.includes(gspace.project)) gspace.project = "";
  renderGlobalSpace(qaSpaces);
  document.querySelectorAll("#qaPeriod button").forEach((b) => b.classList.toggle("on", b.dataset.p === QP.period));
  $("qaPeriod").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setQaPeriod(b.dataset.p); });
  $("spaceBar").classList.toggle("hidden", !["panel", "qaq", "day", "team"].includes(state.mode));
  $("qaPeriodBar").classList.toggle("hidden", !["panel", "qaq", "day"].includes(state.mode));

  renderRecent();
  initBoards();
  const restored = await restore(defaults);
  const view = await resumeView();
  if (view) {
    applyViewState(view);
    if (VIEW_TABS.includes(view.mode)) setMode(view.mode, { restoring: true });
    applyViewAfter(view);
  }
  if (restored || view) return;
  setMode("day", { restoring: true });   // primeira aba do QA: Meu dia

  const fromParam = params.get("key");
  if (fromParam) { $("parentKey").value = fromParam; return findSubtasks(); }
  if (inIframe) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const m = tab?.url?.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)/i) || tab?.url?.match(/selectedIssue=([A-Z][A-Z0-9_]*-\d+)/i);
    if (m) { $("parentKey").value = m[1].toUpperCase(); findSubtasks(); }
  } catch { /* sem permissão de aba */ }
})().finally(() => { BOOT.done = true; });
