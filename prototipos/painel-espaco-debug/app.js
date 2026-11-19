import {
  PERSONAS,
  TEAM,
  SPACES,
  COLUMNS,
  PROCESS_STEPS,
  INITIAL_TIMELINE,
  INITIAL_ISSUES,
  DEBUG_ZONES,
} from "./data.js";

const STORAGE_KEY = "qf_space_proto_v1";

const DEFAULT_LAYOUT = {
  zoneOrder: DEBUG_ZONES.map((z) => z.id),
  visibleZones: Object.fromEntries(DEBUG_ZONES.map((z) => [z.id, z.visibleDefault])),
  timelinePosition: "top", // top | right | bottom | compact
  cardDensity: "comfortable", // comfortable | compact | detailed
  entryPoints: "all", // all | sidebar | header | dock
  keepSidebarInRefactored: false,
  modules: {
    goalCard: true,
    timelineBar: true,
    execBar: true,
    processStepper: true,
    confluenceChips: true,
    figmaChips: true,
    gitChips: true,
    cardQuickActions: true,
    noiseComparison: true,
  },
  notes: [
    {
      id: "n-1",
      view: "refactored",
      xPct: 97,
      yPct: 36,
      zone: "ZONA-02 · Linha do Tempo",
      text: "Ponto inicial de referência: testar se a Linha do Tempo fica melhor no Topo (full-width) ou ancorada no Rodapé Fixo.",
    },
  ],
};

function loadSavedLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_LAYOUT);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_LAYOUT),
      ...parsed,
      visibleZones: { ...DEFAULT_LAYOUT.visibleZones, ...(parsed.visibleZones || {}) },
      modules: { ...DEFAULT_LAYOUT.modules, ...(parsed.modules || {}) },
      notes: Array.isArray(parsed.notes) ? parsed.notes : DEFAULT_LAYOUT.notes,
    };
  } catch {
    return structuredClone(DEFAULT_LAYOUT);
  }
}

const state = {
  view: "jira", // jira | refactored
  debugMode: true,
  studioOpen: true,
  qfSidebarOpen: true,
  pinMode: false,
  persona: "dev",
  space: "SUS",
  wsTab: "board", // board | list | process | hub
  filter: "all", // all | mine | overrun | blocked | confluence | figma
  selectedPerson: "",
  search: "",
  jiraSearch: "",
  inspectedZone: "zone-timeline",
  dbgTab: "layout", // layout | modules | inspect | notes
  drawerIssueKey: null,
  drawerTab: "process", // process | time | confluence | figma
  pendingPin: null,
  issues: structuredClone(INITIAL_ISSUES),
  timeline: structuredClone(INITIAL_TIMELINE),
  layout: loadSavedLayout(),
};

function saveLayout() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.layout));
  } catch { /* ignore quota */ }
}

/* =====================================================================
   HELPERS
   ===================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtDur(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function fmtHM(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseHM(str) {
  const m = String(str || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function personById(id) {
  return TEAM.find((p) => p.id === id) || TEAM[0];
}

function spaceById(id) {
  return SPACES.find((s) => s.id === id) || SPACES[0];
}

function issueByKey(key) {
  return state.issues.find((i) => i.key === key);
}

let toastTimer;
function showToast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
}

function timelineStats() {
  const persona = PERSONAS[state.persona];
  const logged = state.timeline.blocks.reduce((acc, b) => acc + Math.max(0, b.endMin - b.startMin), 0);
  const goal = persona.goalMinutes;
  const avg = persona.avgMinutes;
  const distinctIssues = new Set(state.timeline.blocks.map((b) => b.issueKey)).size;
  const overGoal = logged - goal;
  const vsAvg = logged - avg;
  const pct = Math.min(100, Math.round((logged / goal) * 100));
  const spaceIssues = state.issues.filter((i) => i.space === state.space);
  const overrunCount = spaceIssues.filter((i) => i.spentMin > i.estimateMin).length;
  return { logged, goal, avg, distinctIssues, overGoal, vsAvg, pct, streak: persona.streakDays, overrunCount };
}

function findBestFreeGap() {
  const sorted = [...state.timeline.blocks].sort((a, b) => a.startMin - b.startMin);
  let best = { start: state.timeline.workStart, end: state.timeline.workStart + 30, size: 0 };
  let cursor = state.timeline.workStart;
  for (const b of sorted) {
    if (b.startMin > cursor) {
      const size = b.startMin - cursor;
      if (size > best.size) best = { start: cursor, end: b.startMin, size };
    }
    cursor = Math.max(cursor, b.endMin);
  }
  if (state.timeline.workEnd > cursor) {
    const size = state.timeline.workEnd - cursor;
    if (size > best.size) best = { start: cursor, end: state.timeline.workEnd, size };
  }
  if (best.size < 10) return { start: cursor, end: cursor + 30 };
  return { start: best.start, end: Math.min(best.end, best.start + 30) };
}

/* =====================================================================
   RENDER: ESTADO GERAL & ENTRADAS
   ===================================================================== */
function syncChrome() {
  document.body.classList.toggle("debug-on", state.debugMode);
  document.body.classList.toggle("pin-mode", state.debugMode && state.pinMode);
  document.body.dataset.persona = state.persona;
  document.body.dataset.view = state.view;

  $("#jiraNativeView").classList.toggle("hidden", state.view !== "jira");
  $("#refactoredView").classList.toggle("hidden", state.view !== "refactored");

  $("#debugStudio").classList.toggle("hidden", !(state.debugMode && state.studioOpen));
  $("#qfSidePanel").classList.toggle("hidden", !state.qfSidebarOpen);

  // Botões topbar
  $$("#viewSwitch button").forEach((b) => b.classList.toggle("active", b.dataset.setView === state.view));
  $$("#personaSwitch button").forEach((b) => b.classList.toggle("active", b.dataset.persona === state.persona));
  $$("#debugModeSwitch button").forEach((b) => b.classList.toggle("active", (b.dataset.debug === "on") === state.debugMode));
  $("#btnTogglePinMode").classList.toggle("active", state.pinMode);
  $("#pinModeLabel").textContent = state.pinMode ? "Clique na tela…" : "Marcar ponto";
  $("#btnToggleStudio").classList.toggle("active", state.studioOpen);
  $("#btnToggleQfSidebar").classList.toggle("active", state.qfSidebarOpen);

  // Pontos de entrada no Jira Nativo (controláveis no Debug Studio)
  const ep = state.layout.entryPoints;
  const showHeader = ep === "all" || ep === "header";
  const showDock = ep === "all" || ep === "dock";
  const showSidebarCta = ep === "all" || ep === "sidebar";
  $('[data-entry="header"]')?.classList.toggle("hidden", !showHeader);
  $('[data-entry="dock"]')?.classList.toggle("hidden", !showDock);
  $('[data-entry="sidebar"]')?.classList.toggle("hidden", !showSidebarCta);
}

function setView(nextView, { silent = false } = {}) {
  state.view = nextView;
  if (nextView === "refactored" && !state.layout.keepSidebarInRefactored) {
    state.qfSidebarOpen = false;
  } else if (nextView === "jira") {
    state.qfSidebarOpen = true;
  }
  renderAll();
  if (!silent) {
    showToast(nextView === "refactored"
      ? "✨ Novo Painel QuickFill ativado no espaço " + spaceById(state.space).name
      : "↩ Retornou à visualização nativa do Jira");
  }
}

/* =====================================================================
   RENDER: VISTA A — JIRA NATIVO (REPLICA DO PRINT 1)
   ===================================================================== */
function renderJiraNative() {
  const sp = spaceById(state.space);
  $("#jiraSpaceBadge").textContent = sp.icon;
  $("#jiraSpaceBadge").style.background = sp.color;
  $("#jiraSpaceTitle").textContent = sp.name;
  $("#jiraNativeSprint").textContent = `🏃 ${sp.sprint}`;

  // Lista de espaços na sidebar esquerda do Jira
  $("#jiraSpaceList").innerHTML = SPACES.map((s) => `
    <button class="jira-space-btn ${s.id === state.space ? "active" : ""}" data-select-space="${s.id}">
      <span>${s.icon}</span>
      <span>${esc(s.name)}</span>
    </button>
  `).join("");

  // Avatares
  $("#jiraNativeAvatars").innerHTML = TEAM.slice(0, 5).map((p) => `
    <span class="av" style="background:${p.color}" title="${esc(p.name)}">${esc(p.initials)}</span>
  `).join("") + `<span class="av" style="background:#38414a">+${TEAM.length - 5}</span>`;

  // Colunas e cards nativos
  const q = state.jiraSearch.trim().toLowerCase();
  const spaceIssues = state.issues.filter((i) => i.space === state.space && (!q || `${i.key} ${i.title} ${i.epic}`.toLowerCase().includes(q)));

  $("#jiraNativeBoard").innerHTML = COLUMNS.map((col) => {
    const list = spaceIssues.filter((i) => i.status === col.id);
    return `
      <div class="jira-col">
        <div class="jira-col-head">
          <span>${esc(col.jiraName)}</span>
          <span class="mono">${list.length}</span>
        </div>
        <div class="jira-col-body">
          ${list.map((i) => {
            const owner = personById(i.assignee);
            const prioGlyph = i.priority === "critical" ? "▲▲" : i.priority === "high" ? "▲" : i.priority === "low" ? "▼" : "=";
            const prioColor = i.priority === "critical" ? "#f87168" : i.priority === "high" ? "#faa53d" : "#94a3b4";
            return `
              <article class="jira-card" data-open-issue="${esc(i.key)}">
                <div class="jira-card-title">${esc(i.title)}</div>
                <div class="jira-card-meta">
                  ${i.due ? `<span class="jira-due-tag ${i.overdue ? "overdue" : ""}">📅 ${esc(i.due)}</span>` : ""}
                  <span class="jira-epic-tag">${esc(i.epic)}</span>
                </div>
                <div class="jira-card-foot">
                  <span class="mono">${i.type === "bug" ? "🐞" : "☑"} ${esc(i.key)}</span>
                  <span style="display:flex;align-items:center;gap:6px">
                    <span class="mono">${i.points}</span>
                    <span style="color:${prioColor};font-weight:700">${prioGlyph}</span>
                    <span class="av-sm" style="background:${owner.color}" title="${esc(owner.name)}">${esc(owner.initials)}</span>
                  </span>
                </div>
              </article>
            `;
          }).join("") || `<div style="padding:14px 6px;font-size:11px;color:#626f86;text-align:center">Sem demandas</div>`}
        </div>
      </div>
    `;
  }).join("");
}

/* =====================================================================
   RENDER: BARRA LATERAL DA EXTENSÃO QUICKFILL (CHROME SIDE PANEL)
   ===================================================================== */
function renderQfSidebar() {
  const persona = PERSONAS[state.persona];
  const sp = spaceById(state.space);
  const stats = timelineStats();
  $("#qfsRoleBadge").textContent = persona.label;
  $("#qfsSpaceSub").textContent = `Espaço ${sp.name} · ${sp.sprint}`;

  const inRef = state.view === "refactored";
  $("#qfsModeStatus").textContent = inRef ? "● Novo Painel ativo" : "Jira nativo ativo";
  const ctaBtn = $("#btnSideEnterRefactored");
  ctaBtn.textContent = inRef ? "← Voltar ao Jira Nativo" : "⚡ Entrar no Novo Painel";
  ctaBtn.classList.toggle("active-mode", inRef);

  const circ = 2 * Math.PI * 36;
  const offset = circ * (1 - stats.pct / 100);
  $("#qfsDaySummary").innerHTML = `
    <div style="display:flex;align-items:center;gap:12px">
      <div class="goal-ring-wrap" style="width:70px;height:70px">
        <svg viewBox="0 0 88 88" class="goal-ring-svg" style="width:70px;height:70px">
          <circle cx="44" cy="44" r="36" class="goal-ring-bg"></circle>
          <circle cx="44" cy="44" r="36" class="goal-ring-fg" style="stroke-dasharray:${circ};stroke-dashoffset:${offset}"></circle>
        </svg>
        <div class="goal-ring-center">
          <strong style="font-size:13px">${fmtDur(stats.logged)}</strong>
          <small style="font-size:9.5px">de ${fmtDur(stats.goal)}</small>
        </div>
      </div>
      <div style="min-width:0">
        <div style="font-size:10.5px;color:var(--muted)">${esc(state.timeline.dateLabel)}</div>
        <div style="font-size:14px;font-weight:800;color:var(--accent)">${stats.overGoal >= 0 ? "Meta batida ✓" : `Faltam ${fmtDur(-stats.overGoal)}`}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px">${stats.overGoal > 0 ? `${fmtDur(stats.overGoal)} além da meta` : "Dentro da meta"}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          <span class="g-pill streak" style="font-size:10px;padding:2px 6px">🔥 ${stats.streak}d</span>
          <span class="g-pill delta-pos" style="font-size:10px;padding:2px 6px">${stats.vsAvg >= 0 ? "+" : "-"}${fmtDur(Math.abs(stats.vsAvg))} vs média</span>
        </div>
      </div>
    </div>
  `;

  $("#qfsMiniTimeline").innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:11.5px;font-weight:700">Linha do tempo</span>
      <span class="mono" style="font-size:10.5px;color:var(--muted)">11:00–17:00</span>
    </div>
    ${buildTimelineTrackHtml({ compact: true })}
  `;
}

/* =====================================================================
   RENDER: COMPONENTES DAS ZONAS DO NOVO PAINEL REFATORADO
   ===================================================================== */
function wrapZone(zoneId, innerHtml) {
  const meta = DEBUG_ZONES.find((z) => z.id === zoneId);
  const idx = state.layout.zoneOrder.indexOf(zoneId);
  const isFirst = idx === 0;
  const isLast = idx === state.layout.zoneOrder.length - 1;
  return `
    <div class="rf-zone ${state.inspectedZone === zoneId ? "inspected" : ""}" data-zone-id="${zoneId}">
      <div class="zone-debug-bar">
        <div class="zdb-left">
          <span class="zdb-code">${meta.code}</span>
          <span class="zdb-title">${esc(meta.title)}</span>
          <span class="zdb-dim" data-dim-for="${zoneId}">—</span>
          <span class="zdb-src">${esc(meta.sources.slice(0, 2).join(" · "))}</span>
        </div>
        <div class="zdb-actions">
          <button data-zone-move="${zoneId}" data-dir="-1" ${isFirst ? "disabled" : ""} title="Mover zona para cima">↑</button>
          <button data-zone-move="${zoneId}" data-dir="1" ${isLast ? "disabled" : ""} title="Mover zona para baixo">↓</button>
          <button data-zone-inspect="${zoneId}" title="Inspecionar APIs e módulos QuickFill">ℹ API</button>
          <button data-zone-note="${zoneId}" title="Adicionar nota de ajuste nesta zona">📌</button>
          <button data-zone-hide="${zoneId}" title="Ocultar esta zona">👁</button>
        </div>
      </div>
      ${innerHtml}
    </div>
  `;
}

function buildHeaderZoneHtml() {
  const sp = spaceById(state.space);
  const persona = PERSONAS[state.persona];
  const spaceIssues = state.issues.filter((i) => i.space === state.space);
  const blocked = spaceIssues.filter((i) => i.status === "blocked").length;
  const overrun = spaceIssues.filter((i) => i.spentMin > i.estimateMin).length;
  const confCount = spaceIssues.filter((i) => i.confluence).length;
  const figmaCount = spaceIssues.filter((i) => i.figma).length;
  const sprintPct = Math.round((sp.donePoints / sp.totalPoints) * 100);

  return `
    <div class="rf-header">
      <div class="rf-header-top">
        <div class="rf-space-switcher">
          ${SPACES.map((s) => `
            <button class="rf-space-pill ${s.id === state.space ? "active" : ""}" data-select-space="${s.id}">
              <span>${s.icon}</span>
              <span>${esc(s.name)}</span>
              <span class="mono" style="font-size:10.5px;color:var(--muted)">${state.issues.filter((i) => i.space === s.id).length}</span>
            </button>
          `).join("")}
        </div>

        <div class="rf-sprint-meta">
          <span class="kpi-chip ok">🏃 ${esc(sp.sprint)} · ${sprintPct}% (${sp.donePoints}/${sp.totalPoints} pts)</span>
          <span class="kpi-chip ${blocked ? "err" : "ok"}">🚫 ${blocked} impedidas</span>
          <span class="kpi-chip ${overrun ? "warn" : "ok"}">⏱ ${overrun} excedentes</span>
          <span class="kpi-chip blue">📘 ${confCount} Docs</span>
          <span class="kpi-chip pink">🎨 ${figmaCount} Figma</span>
        </div>

        <div class="rf-header-actions">
          <button class="btn-accent" id="btnHeaderLog">＋ Apontar tempo</button>
          <button class="btn-back-jira" data-action="exit-refactored">← Jira Nativo</button>
        </div>
      </div>

      <div class="rf-header-sub">
        <span>
          <strong style="color:var(--accent)">Modo ${persona.label}:</strong> ${esc(persona.tagline)}
        </span>
        ${state.layout.modules.noiseComparison ? `
          <span class="rf-compare-badge" title="Comparado às 12 abas e painéis dispersos do Jira nativo">
            ✦ Interface simplificada: 12 abas nativas → 4 visões focadas + Linha do tempo integrada
          </span>
        ` : ""}
      </div>
    </div>
  `;
}

function buildTimelineTrackHtml({ compact = false } = {}) {
  const start = state.timeline.workStart;
  const end = state.timeline.workEnd;
  const span = end - start;
  const gap = findBestFreeGap();
  const gapCenterPct = Math.min(94, Math.max(6, (((gap.start + gap.end) / 2 - start) / span) * 100));

  const segs = state.timeline.blocks.map((b) => {
    const left = Math.max(0, ((b.startMin - start) / span) * 100);
    const width = Math.max(2.2, ((Math.min(end, b.endMin) - Math.max(start, b.startMin)) / span) * 100);
    const dur = fmtDur(b.endMin - b.startMin);
    const label = compact ? "" : width > 17 ? `${esc(b.issueKey)} · ${dur}` : width > 10 ? esc(b.issueKey) : "";
    return `
      <div
        class="tl-seg"
        style="left:${left}%;width:${width}%;background:${b.color}"
        data-open-issue="${esc(b.issueKey)}"
        data-open-tab="time"
        title="${esc(b.issueKey)} · ${fmtHM(b.startMin)}–${fmtHM(b.endMin)} (${dur}) — ${esc(b.title)}"
      >${label}</div>
    `;
  }).join("");

  return `
    <div class="tl-track-wrap">
      <div class="tl-track">
        ${segs}
        <button
          class="tl-add-gap"
          style="left:${gapCenterPct}%"
          data-open-log-gap="${fmtHM(gap.start)}-${fmtHM(gap.end)}"
          title="Registrar trabalho no horário livre (${fmtHM(gap.start)}–${fmtHM(gap.end)})"
        >+</button>
      </div>
      <div class="tl-ticks">
        <span>11h</span><span>12h</span><span>13h</span><span>14h</span><span>15h</span><span>16h</span><span>17h</span>
      </div>
    </div>
  `;
}

function buildTimelineZoneHtml() {
  const stats = timelineStats();
  const m = state.layout.modules;
  const pos = state.layout.timelinePosition;
  const circ = 2 * Math.PI * 38;
  const offset = circ * (1 - stats.pct / 100);

  const goalHtml = m.goalCard ? `
    <div class="journey-card">
      <div class="goal-card-inner">
        <div class="goal-ring-wrap">
          <svg viewBox="0 0 92 92" class="goal-ring-svg">
            <circle cx="46" cy="46" r="38" class="goal-ring-bg"></circle>
            <circle cx="46" cy="46" r="38" class="goal-ring-fg" style="stroke-dasharray:${circ};stroke-dashoffset:${offset}"></circle>
          </svg>
          <div class="goal-ring-center">
            <strong>${fmtDur(stats.logged)}</strong>
            <small>de ${fmtDur(stats.goal)}</small>
          </div>
        </div>
        <div class="goal-info">
          <div class="goal-date-row">
            <span>${esc(state.timeline.dateLabel)}</span>
            <span class="mono" style="color:var(--accent)">${stats.pct}% da meta</span>
          </div>
          <h3 class="goal-headline">${stats.overGoal >= 0 ? "Meta batida ✓" : `Faltam ${fmtDur(-stats.overGoal)}`}</h3>
          <p class="goal-sub">
            ${stats.overGoal > 0 ? `${fmtDur(stats.overGoal)} além da meta diária.` : stats.overGoal === 0 ? "Meta diária concluída no ponto exato." : "Continue apontando na linha do tempo ao lado."}
          </p>
          <div class="goal-pills">
            <span class="g-pill streak">🔥 ${stats.streak} dias seguidos</span>
            <span class="g-pill">média ${fmtDur(stats.avg)}</span>
            <span class="g-pill delta-pos">${stats.vsAvg >= 0 ? "+" : "-"}${fmtDur(Math.abs(stats.vsAvg))} vs média</span>
            <span class="g-pill">${stats.distinctIssues} demandas</span>
            ${stats.overrunCount ? `<span class="g-pill overrun" data-quick-filter="overrun">⚠ ${stats.overrunCount} com excedente</span>` : ""}
          </div>
        </div>
      </div>
    </div>
  ` : "";

  const tlHtml = m.timelineBar ? `
    <div class="journey-card">
      <div class="tl-head">
        <div class="tl-head-l">
          <strong>Linha do tempo · Execuções integradas</strong>
          <span class="tl-hours-tag">11:00–17:00</span>
        </div>
        <div class="tl-nav">
          <button data-shift-day="-1" title="Dia anterior">‹</button>
          <button data-shift-day="0">18/11/2026</button>
          <button data-shift-day="1" title="Próximo dia">›</button>
          <button class="btn-accent" style="padding:3px 9px;font-size:11px" data-open-log-gap="">＋ Apontar</button>
        </div>
      </div>
      ${buildTimelineTrackHtml({ compact: pos === "compact" })}
      <div class="tl-legend">
        ${state.timeline.blocks.map((b) => `
          <span class="tl-chip" data-open-issue="${esc(b.issueKey)}" data-open-tab="time">
            <i class="tl-dot" style="background:${b.color}"></i>
            <strong class="mono">${esc(b.issueKey)}</strong>
            <span>${fmtHM(b.startMin)}–${fmtHM(b.endMin)} (${fmtDur(b.endMin - b.startMin)})</span>
          </span>
        `).join("")}
      </div>
    </div>
  ` : "";

  if (!goalHtml && !tlHtml) {
    return `<div class="journey-card"><span class="muted">Ative "Meta & Média" ou "Linha do Tempo" na aba Módulos do Studio Debug.</span></div>`;
  }

  return `<div class="journey-grid ${pos === "compact" ? "compact" : ""}">${goalHtml}${tlHtml}</div>`;
}

function buildTeamZoneHtml() {
  const spaceIssues = state.issues.filter((i) => i.space === state.space);
  return `
    <div class="team-strip">
      <div class="section-bar">
        <h2>
          👥 Pulso da Equipe no Espaço
          <span class="muted" style="font-size:11.5px;font-weight:500">Clique em uma pessoa para focar nas demandas dela</span>
        </h2>
        <div style="display:flex;align-items:center;gap:6px">
          ${state.selectedPerson ? `<button class="flt-chip active" id="btnClearPerson">✕ Filtrando: ${esc(personById(state.selectedPerson).short)}</button>` : ""}
          <span class="kpi-chip ok">● Ao vivo · ${TEAM.length} pessoas</span>
        </div>
      </div>
      <div class="team-cards">
        ${TEAM.slice(0, 7).map((p) => {
          const pct = Math.min(100, Math.round((p.loggedMin / p.goalMin) * 100));
          const cls = p.loggedMin > p.goalMin + 20 ? "over" : p.loggedMin < p.goalMin * 0.8 ? "low" : "";
          const count = spaceIssues.filter((i) => i.assignee === p.id).length;
          return `
            <div class="person-card ${state.selectedPerson === p.id ? "selected" : ""}" data-select-person="${p.id}">
              <div class="pc-top">
                <span class="pc-av" style="background:${p.color}">${esc(p.initials)}</span>
                <div>
                  <div class="pc-name">${esc(p.short)}</div>
                  <div class="pc-role">${esc(p.role)} · ${count} no espaço</div>
                </div>
                <span class="pc-hours">${fmtDur(p.loggedMin)}</span>
              </div>
              <div class="pc-bar"><span class="${cls}" style="width:${pct}%"></span></div>
              <div class="pc-foot">
                <span class="pc-key">${esc(p.activeKey)}</span>
                <span>${esc(p.status)}</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function filteredSpaceIssues() {
  const me = PERSONAS[state.persona].userId;
  const q = state.search.trim().toLowerCase();
  return state.issues.filter((i) => {
    if (i.space !== state.space) return false;
    if (state.selectedPerson && i.assignee !== state.selectedPerson) return false;
    if (state.filter === "mine" && i.assignee !== me) return false;
    if (state.filter === "overrun" && !(i.spentMin > i.estimateMin)) return false;
    if (state.filter === "blocked" && i.status !== "blocked" && !i.overdue) return false;
    if (state.filter === "confluence" && !i.confluence) return false;
    if (state.filter === "figma" && !i.figma) return false;
    if (q && !`${i.key} ${i.title} ${i.epic} ${personById(i.assignee).name}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function buildSmartCardHtml(issue) {
  const m = state.layout.modules;
  const owner = personById(issue.assignee);
  const overrunMin = issue.spentMin - issue.estimateMin;
  const ratio = issue.estimateMin ? Math.min(100, Math.round((issue.spentMin / issue.estimateMin) * 100)) : 0;
  const barCls = overrunMin > 0 ? "over" : ratio >= 85 ? "near" : "";
  const col = COLUMNS.find((c) => c.id === issue.status) || COLUMNS[0];
  const doneSub = issue.subtasks.filter((s) => s.done).length;

  const stepDots = PROCESS_STEPS.map((st, idx) => {
    let cls = "";
    if (issue.status === "blocked" && idx === 1) cls = "blocked";
    else if (idx < col.stepIndex) cls = "done";
    else if (idx === col.stepIndex) cls = "now";
    return `<i class="${cls}" title="${st.label}"></i>`;
  }).join("");

  return `
    <article
      class="rf-card prio-${issue.priority} density-${state.layout.cardDensity}"
      draggable="true"
      data-card-key="${esc(issue.key)}"
      data-open-issue="${esc(issue.key)}"
    >
      <div class="rf-c-head">
        <span class="rf-c-key">${issue.type === "bug" ? "🐞" : issue.type === "story" ? "✦" : "☑"} ${esc(issue.key)}</span>
        <div class="rf-c-badges">
          ${overrunMin > 0 ? `<span class="badge-mini over">+${fmtDur(overrunMin)} exc.</span>` : ""}
          ${issue.reopens > 0 ? `<span class="badge-mini reopen">↺ ${issue.reopens}x</span>` : ""}
          <span class="badge-mini pts">${issue.points} pts</span>
        </div>
      </div>

      <div class="rf-c-title">${esc(issue.title)}</div>
      <span class="rf-c-epic">${esc(issue.epic)}</span>

      ${m.execBar ? `
        <div class="exec-meter">
          <div class="exec-meter-row">
            <span>Exec: <strong>${fmtDur(issue.spentMin)}</strong> / Est: ${fmtDur(issue.estimateMin)}</span>
            ${overrunMin > 0
              ? `<span class="over-txt">Excedeu +${fmtDur(overrunMin)}</span>`
              : `<span>${ratio}%</span>`}
          </div>
          <div class="exec-bar"><i class="${barCls}" style="width:${overrunMin > 0 ? 100 : ratio}%"></i></div>
        </div>
      ` : ""}

      ${m.processStepper ? `
        <div class="rf-card-stepper">
          <div class="step-dots">${stepDots}</div>
          <span>${esc(issue.currentStageLabel)}</span>
        </div>
      ` : ""}

      <div class="rf-c-links">
        ${m.confluenceChips && issue.confluence ? `<span class="res-chip conf" data-open-issue="${esc(issue.key)}" data-open-tab="confluence" title="Abrir documentação Confluence">📘 ${esc(issue.confluence.id)}</span>` : ""}
        ${m.figmaChips && issue.figma ? `<span class="res-chip figma" data-open-issue="${esc(issue.key)}" data-open-tab="figma" title="Ver telas Figma">🎨 ${issue.figma.frames.length} tela(s) · ${esc(issue.figma.status)}</span>` : ""}
        ${m.gitChips && issue.git ? `<span class="res-chip git">🔀 ${esc(issue.git.pr)} · ${esc(issue.git.prStatus)}</span>` : ""}
        ${issue.subtasks.length ? `<span class="res-chip sub">☑ ${doneSub}/${issue.subtasks.length}</span>` : ""}
      </div>

      <div class="rf-c-foot">
        <div class="rf-c-owner">
          <span class="av" style="background:${owner.color}">${esc(owner.initials)}</span>
          <span>${esc(owner.short)}</span>
          ${issue.overdue ? `<span style="color:var(--err);font-weight:700">· Atrasada</span>` : ""}
        </div>
        ${m.cardQuickActions ? `
          <div class="rf-card-actions">
            <button data-quick-log="${esc(issue.key)}" title="Apontar +30m rápido na linha do tempo">+30m</button>
            <button data-quick-advance="${esc(issue.key)}" title="Avançar para próxima etapa">→</button>
          </div>
        ` : ""}
      </div>
    </article>
  `;
}

function buildWorkspaceZoneHtml() {
  const list = filteredSpaceIssues();
  let contentHtml = "";

  if (state.wsTab === "board") {
    const visibleCols = COLUMNS.filter((c) => c.id !== "reopen" || list.some((i) => i.status === "reopen"));
    contentHtml = `
      <div class="rf-board">
        ${visibleCols.map((col) => {
          const cards = list.filter((i) => i.status === col.id);
          return `
            <div class="rf-col" data-drop-col="${col.id}">
              <div class="rf-col-head">
                <span class="rf-col-title">
                  <i class="rf-col-dot" style="background:${col.color}"></i>
                  ${esc(col.shortName)}
                </span>
                <span class="rf-col-cnt">${cards.length}</span>
              </div>
              <div class="rf-col-cards">
                ${cards.map(buildSmartCardHtml).join("") || `<div class="muted" style="font-size:11.5px;text-align:center;padding:18px 6px;border:1px dashed #2b333b;border-radius:8px">Arraste uma demanda para cá</div>`}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  } else if (state.wsTab === "list") {
    contentHtml = `
      <div class="exec-table-wrap">
        <table class="exec-table">
          <thead>
            <tr>
              <th>Demanda</th>
              <th>Etapa &amp; Tempo</th>
              <th>Responsável</th>
              <th>Estimado</th>
              <th>Executado</th>
              <th>Excedente</th>
              <th>Integrações</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((i) => {
              const owner = personById(i.assignee);
              const col = COLUMNS.find((c) => c.id === i.status);
              const over = i.spentMin - i.estimateMin;
              return `
                <tr data-open-issue="${esc(i.key)}">
                  <td>
                    <strong class="mono" style="color:var(--accent)">${esc(i.key)}</strong>
                    <div style="font-weight:600;margin-top:2px">${esc(i.title)}</div>
                  </td>
                  <td>
                    <span class="kpi-chip" style="border-color:${col.color};color:${col.color}">${esc(col.shortName)}</span>
                    <div class="muted" style="font-size:10.5px;margin-top:3px">${esc(i.currentStageLabel)}</div>
                  </td>
                  <td>${esc(owner.short)}</td>
                  <td class="mono">${fmtDur(i.estimateMin)}</td>
                  <td class="mono"><strong>${fmtDur(i.spentMin)}</strong></td>
                  <td class="mono" style="color:${over > 0 ? "var(--err)" : "var(--ok)"};font-weight:700">
                    ${over > 0 ? `+${fmtDur(over)}` : "No prazo"}
                  </td>
                  <td>
                    <div style="display:flex;gap:4px;flex-wrap:wrap">
                      ${i.confluence ? `<span class="res-chip conf">📘 Docs</span>` : ""}
                      ${i.figma ? `<span class="res-chip figma">🎨 Figma</span>` : ""}
                      ${i.git ? `<span class="res-chip git">🔀 ${esc(i.git.pr)}</span>` : ""}
                    </div>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  } else if (state.wsTab === "process") {
    const allSp = state.issues.filter((i) => i.space === state.space);
    const totalEst = allSp.reduce((a, b) => a + b.estimateMin, 0);
    const totalSpent = allSp.reduce((a, b) => a + b.spentMin, 0);
    const overTotal = allSp.reduce((a, b) => a + Math.max(0, b.spentMin - b.estimateMin), 0);
    const blockedCount = allSp.filter((i) => i.status === "blocked").length;
    const reopenTotal = allSp.reduce((a, b) => a + b.reopens, 0);

    contentHtml = `
      <div class="process-grid">
        <div class="proc-card">
          <h3>Execução vs Estimativa</h3>
          <div class="proc-big" style="color:var(--blue)">${fmtDur(totalSpent)} <span style="font-size:13px;color:var(--muted)">/ ${fmtDur(totalEst)}</span></div>
          <div class="muted">Acurácia de planejamento da sprint atual</div>
        </div>
        <div class="proc-card">
          <h3>Total de Excedentes</h3>
          <div class="proc-big" style="color:var(--err)">+${fmtDur(overTotal)}</div>
          <div class="muted">${allSp.filter((i) => i.spentMin > i.estimateMin).length} demandas ultrapassaram a estimativa</div>
        </div>
        <div class="proc-card">
          <h3>Gargalo Principal</h3>
          <div class="proc-big" style="color:var(--amber)">${blockedCount} impedidas</div>
          <div class="muted">Média de 5,1 dias paradas em Impedido/Aguardando</div>
        </div>
        <div class="proc-card">
          <h3>Retrabalho / Reaberturas</h3>
          <div class="proc-big" style="color:var(--purple)">${reopenTotal} retornos</div>
          <div class="muted">Concentrados em bugs de assinatura e cabeçalho PDF</div>
        </div>
      </div>
      <div class="dr-card" style="margin-top:4px">
        <h4>Fluxo de Etapas do Espaço (Tempo médio por fase)</h4>
        <div class="big-stepper">
          <div class="bs-step done">Fila<small>1.4d média</small></div>
          <div class="bs-step now">Execução<small>2.1d média</small></div>
          <div class="bs-step" style="border-color:rgba(248,113,104,.5);color:var(--err)">Impedido<small>5.1d gargalo!</small></div>
          <div class="bs-step done">Validação QA<small>0.7d média</small></div>
          <div class="bs-step done">Deploy HMP<small>0.5d média</small></div>
        </div>
      </div>
    `;
  } else if (state.wsTab === "hub") {
    const confItems = state.issues.filter((i) => i.space === state.space && i.confluence);
    const figmaItems = state.issues.filter((i) => i.space === state.space && i.figma);
    contentHtml = `
      <div class="hub-grid">
        <div class="hub-col">
          <h3>📘 Documentação Confluence vinculada (${confItems.length})</h3>
          ${confItems.map((i) => `
            <div class="hub-item" data-open-issue="${esc(i.key)}" data-open-tab="confluence">
              <div class="hub-item-head">
                <strong style="color:#85b8ff">${esc(i.confluence.title)}</strong>
                <span class="mono" style="font-size:11px;color:var(--accent)">${esc(i.key)}</span>
              </div>
              <div class="muted" style="font-size:11px">${esc(i.confluence.space)} · ${esc(i.confluence.author)} · ${esc(i.confluence.updated)}</div>
              <p>${esc(i.confluence.summary)}</p>
            </div>
          `).join("") || `<p class="muted">Nenhum documento vinculado neste espaço.</p>`}
        </div>
        <div class="hub-col">
          <h3>🎨 Designs Figma vinculados (${figmaItems.length})</h3>
          ${figmaItems.map((i) => `
            <div class="hub-item" data-open-issue="${esc(i.key)}" data-open-tab="figma">
              <div class="hub-item-head">
                <strong style="color:#f49fd3">${esc(i.figma.fileName)}</strong>
                <span class="mono" style="font-size:11px;color:var(--accent)">${esc(i.key)}</span>
              </div>
              <div class="muted" style="font-size:11px">${esc(i.figma.status)} · ${i.figma.frames.length} tela(s) · node ${esc(i.figma.nodeId)}</div>
              <p>Telas: ${esc(i.figma.frames.map((f) => f.name).join(" · "))}</p>
            </div>
          `).join("") || `<p class="muted">Nenhum protótipo Figma vinculado neste espaço.</p>`}
        </div>
      </div>
    `;
  }

  return `
    <div class="workspace-shell">
      <div class="ws-toolbar">
        <div class="ws-tabs">
          <button data-ws-tab="board" class="${state.wsTab === "board" ? "active" : ""}">▦ Quadro Inteligente</button>
          <button data-ws-tab="list" class="${state.wsTab === "list" ? "active" : ""}">≡ Lista &amp; Execuções</button>
          <button data-ws-tab="process" class="${state.wsTab === "process" ? "active" : ""}">📈 Processo &amp; Gargalos</button>
          <button data-ws-tab="hub" class="${state.wsTab === "hub" ? "active" : ""}">📘 Confluence &amp; Figma</button>
        </div>

        <div class="ws-filters">
          <input class="ws-search" id="rfSearch" value="${esc(state.search)}" placeholder="Buscar chave, título, pessoa…" />
          <button class="flt-chip ${state.filter === "all" ? "active" : ""}" data-filter="all">Todas (${state.issues.filter((i) => i.space === state.space).length})</button>
          <button class="flt-chip ${state.filter === "mine" ? "active" : ""}" data-filter="mine">Minhas</button>
          <button class="flt-chip ${state.filter === "overrun" ? "active" : ""}" data-filter="overrun">⚠ Excedentes</button>
          <button class="flt-chip ${state.filter === "blocked" ? "active" : ""}" data-filter="blocked">🚫 Impedidas</button>
          <button class="flt-chip ${state.filter === "confluence" ? "active" : ""}" data-filter="confluence">📘 Confluence</button>
          <button class="flt-chip ${state.filter === "figma" ? "active" : ""}" data-filter="figma">🎨 Figma</button>
        </div>
      </div>

      ${contentHtml}
    </div>
  `;
}

function renderRefactored() {
  const container = $("#rfZonesContainer");
  const rightRail = $("#rfRightRail");
  const bottomDock = $("#rfBottomDock");
  rightRail.innerHTML = "";
  bottomDock.innerHTML = "";
  rightRail.classList.add("hidden");
  bottomDock.classList.add("hidden");

  const builders = {
    "zone-header": buildHeaderZoneHtml,
    "zone-timeline": buildTimelineZoneHtml,
    "zone-team": buildTeamZoneHtml,
    "zone-workspace": buildWorkspaceZoneHtml,
  };

  const mainChunks = [];
  for (const zoneId of state.layout.zoneOrder) {
    if (!state.layout.visibleZones[zoneId]) continue;
    const html = wrapZone(zoneId, builders[zoneId]());
    if (zoneId === "zone-timeline" && state.layout.timelinePosition === "right") {
      rightRail.innerHTML = html;
      rightRail.classList.remove("hidden");
    } else if (zoneId === "zone-timeline" && state.layout.timelinePosition === "bottom") {
      bottomDock.innerHTML = html;
      bottomDock.classList.remove("hidden");
    } else {
      mainChunks.push(html);
    }
  }
  container.innerHTML = mainChunks.join("");
  bindDragAndDrop();
  requestAnimationFrame(updateZoneDimensions);
}

function updateZoneDimensions() {
  if (!state.debugMode) return;
  $$(".rf-zone[data-zone-id]").forEach((el) => {
    const dimEl = el.querySelector("[data-dim-for]");
    if (!dimEl) return;
    const r = el.getBoundingClientRect();
    dimEl.textContent = `${Math.round(r.width)}×${Math.round(r.height)}px`;
  });
}

/* =====================================================================
   RENDER: DRAWER "RAIO-X DA DEMANDA"
   ===================================================================== */
function renderIssueDrawer() {
  const drawer = $("#issueDrawer");
  const back = $("#issueDrawerBack");
  if (!state.drawerIssueKey) {
    drawer.classList.add("hidden");
    back.classList.add("hidden");
    return;
  }
  const issue = issueByKey(state.drawerIssueKey);
  if (!issue) return;
  const owner = personById(issue.assignee);
  const col = COLUMNS.find((c) => c.id === issue.status) || COLUMNS[0];
  const over = issue.spentMin - issue.estimateMin;

  let tabContent = "";
  if (state.drawerTab === "process") {
    tabContent = `
      <div class="dr-card">
        <h4>Processo &amp; Ciclo de Vida</h4>
        <div class="big-stepper">
          ${PROCESS_STEPS.map((st, idx) => {
            const cls = idx < col.stepIndex ? "done" : idx === col.stepIndex ? "now" : "";
            const days = issue.stageDays[st.label];
            return `<div class="bs-step ${cls}">${st.label}<small>${days ? `${days}d` : idx === col.stepIndex ? "atual" : "—"}</small></div>`;
          }).join("")}
        </div>
        <div class="move-row">
          ${COLUMNS.map((c) => `
            <button class="move-btn ${c.id === issue.status ? "current" : ""}" data-move-issue="${esc(issue.key)}" data-move-to="${c.id}">
              ${esc(c.shortName)}
            </button>
          `).join("")}
        </div>
      </div>

      ${issue.git ? `
        <div class="dr-card">
          <h4>Desenvolvimento / Git</h4>
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <span class="mono" style="font-size:12px;color:#c4b5fd">🔀 ${esc(issue.git.branch)}</span>
            <span class="kpi-chip purple">PR ${esc(issue.git.pr)} · ${esc(issue.git.prStatus)} · Checks ${esc(issue.git.checks)}</span>
          </div>
        </div>
      ` : ""}

      <div class="dr-card">
        <h4>Subtarefas (${issue.subtasks.filter((s) => s.done).length}/${issue.subtasks.length})</h4>
        ${issue.subtasks.length ? issue.subtasks.map((st) => `
          <label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #283038;cursor:pointer">
            <input type="checkbox" ${st.done ? "checked" : ""} data-toggle-subtask="${esc(issue.key)}::${esc(st.id)}" />
            <span style="flex:1;${st.done ? "text-decoration:line-through;color:var(--muted)" : ""}">${esc(st.title)}</span>
            <span class="muted" style="font-size:11px">${esc(personById(st.owner).short)}</span>
          </label>
        `).join("") : `<p class="muted" style="margin:0;font-size:12px">Nenhuma subtarefa cadastrada.</p>`}
      </div>

      <div class="dr-card">
        <h4>Comentários recentes</h4>
        ${issue.comments.map((c) => `
          <div style="padding:7px 0;border-bottom:1px solid #283038">
            <div style="font-size:11px;color:var(--muted)"><strong>${esc(personById(c.who).name)}</strong> · ${esc(c.when)}</div>
            <div style="margin-top:3px;font-size:12.5px">${esc(c.text)}</div>
          </div>
        `).join("") || `<p class="muted" style="margin:0 0 8px;font-size:12px">Sem comentários ainda.</p>`}
        <form id="drawerCommentForm" style="display:flex;gap:6px;margin-top:8px">
          <input type="text" name="comment" placeholder="Adicionar comentário rápido no Jira…" style="flex:1;background:#12161a;border:1px solid var(--line-strong);border-radius:7px;padding:6px 10px" required />
          <button type="submit" class="btn-accent">Enviar</button>
        </form>
      </div>
    `;
  } else if (state.drawerTab === "time") {
    const pct = issue.estimateMin ? Math.min(100, Math.round((issue.spentMin / issue.estimateMin) * 100)) : 0;
    tabContent = `
      <div class="dr-card">
        <h4>Execução, Estimativa &amp; Excedente</h4>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
          <div style="background:var(--surface-2);padding:10px;border-radius:8px">
            <div class="muted" style="font-size:11px">Estimativa</div>
            <strong class="mono" style="font-size:18px">${fmtDur(issue.estimateMin)}</strong>
          </div>
          <div style="background:var(--surface-2);padding:10px;border-radius:8px">
            <div class="muted" style="font-size:11px">Executado</div>
            <strong class="mono" style="font-size:18px;color:var(--blue)">${fmtDur(issue.spentMin)}</strong>
          </div>
          <div style="background:var(--surface-2);padding:10px;border-radius:8px">
            <div class="muted" style="font-size:11px">Saldo / Excedente</div>
            <strong class="mono" style="font-size:18px;color:${over > 0 ? "var(--err)" : "var(--ok)"}">
              ${over > 0 ? `+${fmtDur(over)}` : `-${fmtDur(-over)}`}
            </strong>
          </div>
        </div>
        <div class="exec-bar" style="height:8px"><i class="${over > 0 ? "over" : ""}" style="width:${over > 0 ? 100 : pct}%"></i></div>
        <div style="margin-top:10px;display:flex;justify-content:flex-end">
          <button class="btn-accent" data-open-log-issue="${esc(issue.key)}">＋ Apontar tempo na Linha do Tempo</button>
        </div>
      </div>

      <div class="dr-card">
        <h4>Apontamentos registrados (${issue.worklogs.length})</h4>
        ${issue.worklogs.map((w) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #283038;gap:10px">
            <div>
              <div style="font-weight:600;font-size:12.5px">${esc(w.note)}</div>
              <div class="muted" style="font-size:11px">${esc(personById(w.who).name)} · ${esc(w.when)}</div>
            </div>
            <span class="kpi-chip blue mono">${fmtDur(w.minutes)}</span>
          </div>
        `).join("") || `<p class="muted" style="margin:0;font-size:12px">Nenhum worklog registrado ainda.</p>`}
      </div>
    `;
  } else if (state.drawerTab === "confluence") {
    tabContent = issue.confluence ? `
      <div class="conf-doc">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div>
            <span class="kpi-chip blue">📘 Confluence · ${esc(issue.confluence.id)}</span>
            <h3 style="margin:8px 0 4px;font-size:15px">${esc(issue.confluence.title)}</h3>
          </div>
          <a href="${esc(issue.confluence.url)}" target="_blank" rel="noreferrer" class="move-btn" style="text-decoration:none">Abrir ↗</a>
        </div>
        <div class="conf-meta">
          <span>Espaço: <strong>${esc(issue.confluence.space)}</strong></span>
          <span>· Autor: <strong>${esc(issue.confluence.author)}</strong></span>
          <span>· Atualizado: ${esc(issue.confluence.updated)}</span>
        </div>
        <p style="margin:0;color:#d6e4f2;line-height:1.5">${esc(issue.confluence.summary)}</p>
        ${issue.confluence.sections.map((sec) => `
          <div class="conf-sec">
            <strong>${esc(sec.heading)}</strong>
            <p>${esc(sec.text)}</p>
          </div>
        `).join("")}
      </div>
    ` : `
      <div class="dr-card" style="text-align:center;padding:28px">
        <div style="font-size:24px;margin-bottom:6px">📘</div>
        <strong>Nenhuma página do Confluence vinculada</strong>
        <p class="muted" style="font-size:12px">Na extensão real, o QuickFill lê <code>/remotelink</code> e links na descrição para exibir a spec aqui sem sair do espaço.</p>
      </div>
    `;
  } else if (state.drawerTab === "figma") {
    tabContent = issue.figma ? `
      <div class="dr-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">
          <div>
            <span class="kpi-chip pink">🎨 Figma · ${esc(issue.figma.status)}</span>
            <h3 style="margin:6px 0 2px;font-size:14.5px">${esc(issue.figma.fileName)}</h3>
            <small class="muted mono">node-id=${esc(issue.figma.nodeId)} · atualizado ${esc(issue.figma.updated)}</small>
          </div>
          <a href="${esc(issue.figma.url)}" target="_blank" rel="noreferrer" class="move-btn" style="text-decoration:none">Figma ↗</a>
        </div>

        <div class="figma-grid">
          ${issue.figma.frames.map((f) => `
            <div class="figma-frame">
              <div class="figma-canvas">
                <div class="wf-bar accent"></div>
                <div class="wf-bar"></div>
                <div class="wf-row">
                  <div class="wf-box"><div class="wf-line ok"></div><div class="wf-line"></div><div class="wf-line"></div></div>
                  <div class="wf-box"><div class="wf-line warn"></div><div class="wf-line"></div></div>
                </div>
              </div>
              <div class="figma-cap">
                <strong>${esc(f.name)}</strong>
                <span class="muted">${esc(f.tag)}</span>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
      <div class="dr-card">
        <h4>Checklist de Handoff Design → DEV</h4>
        ${issue.figma.checklist.map((item) => `
          <div style="padding:5px 0;font-size:12px;color:var(--ok)">✓ ${esc(item)}</div>
        `).join("")}
      </div>
    ` : `
      <div class="dr-card" style="text-align:center;padding:28px">
        <div style="font-size:24px;margin-bottom:6px">🎨</div>
        <strong>Nenhum protótipo Figma vinculado</strong>
        <p class="muted" style="font-size:12px">Demanda puramente backend/infra ou sem tela vinculada no painel Designs / API Figma (<code>FIGMA_LINKS</code> + <code>FIGMA_PREVIEW</code>).</p>
      </div>
    `;
  }

  drawer.innerHTML = `
    <div class="dr-head">
      <div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span class="mono" style="font-weight:800;color:var(--accent)">${esc(issue.key)}</span>
          <span class="kpi-chip" style="border-color:${col.color};color:${col.color}">${esc(col.jiraName)}</span>
          <span class="kpi-chip">${esc(owner.name)}</span>
          <span class="kpi-chip purple">${esc(issue.epic)}</span>
        </div>
        <h2>${esc(issue.title)}</h2>
      </div>
      <button class="ic-btn" id="btnCloseDrawer" title="Fechar (Esc)">✕</button>
    </div>

    <nav class="dr-tabs">
      <button data-dr-tab="process" class="${state.drawerTab === "process" ? "active" : ""}">Processo &amp; Subtarefas</button>
      <button data-dr-tab="time" class="${state.drawerTab === "time" ? "active" : ""}">Tempo &amp; Excedentes</button>
      <button data-dr-tab="confluence" class="${state.drawerTab === "confluence" ? "active" : ""}">📘 Confluence ${issue.confluence ? "●" : ""}</button>
      <button data-dr-tab="figma" class="${state.drawerTab === "figma" ? "active" : ""}">🎨 Figma ${issue.figma ? "●" : ""}</button>
    </nav>

    <div class="dr-body">${tabContent}</div>
  `;

  drawer.classList.remove("hidden");
  back.classList.remove("hidden");
}

/* =====================================================================
   RENDER: STUDIO DEBUG & PINOS DE ANOTAÇÃO
   ===================================================================== */
function renderDebugStudio() {
  $("#notesCount").textContent = String(state.layout.notes.length);
  $$("#dbgTabs button").forEach((b) => b.classList.toggle("active", b.dataset.dbgTab === state.dbgTab));

  const body = $("#dbgBody");
  if (state.dbgTab === "layout") {
    body.innerHTML = `
      <div class="dbg-group">
        <h4>1. Ordem e visibilidade das zonas</h4>
        ${state.layout.zoneOrder.map((zId, idx) => {
          const z = DEBUG_ZONES.find((x) => x.id === zId);
          const vis = state.layout.visibleZones[zId];
          return `
            <div class="dbg-zone-row" style="opacity:${vis ? 1 : 0.48}">
              <span class="code">${z.code}</span>
              <span class="name" title="${esc(z.title)}">${esc(z.title)}</span>
              <button data-zone-move="${zId}" data-dir="-1" ${idx === 0 ? "disabled" : ""}>↑</button>
              <button data-zone-move="${zId}" data-dir="1" ${idx === state.layout.zoneOrder.length - 1 ? "disabled" : ""}>↓</button>
              <button data-zone-toggle="${zId}" title="Mostrar/Ocultar">${vis ? "👁" : "🚫"}</button>
            </div>
          `;
        }).join("")}
      </div>

      <div class="dbg-group">
        <h4>2. Onde ancorar a Linha do Tempo?</h4>
        <div class="dbg-choice-grid">
          ${[
            ["top", "⬆ Topo (Full-width)"],
            ["right", "➡ Lateral Direita"],
            ["bottom", "⬇ Rodapé Fixo"],
            ["compact", "▣ Empilhada Compacta"],
          ].map(([val, lbl]) => `
            <button class="dbg-choice ${state.layout.timelinePosition === val ? "active" : ""}" data-set-tlpos="${val}">${lbl}</button>
          `).join("")}
        </div>
      </div>

      <div class="dbg-group">
        <h4>3. Densidade dos cards do espaço</h4>
        <div class="dbg-choice-grid">
          ${[
            ["comfortable", "Confortável (Padrão)"],
            ["compact", "Compacta (Alta densidade)"],
            ["detailed", "Detalhada (Completa)"],
          ].map(([val, lbl]) => `
            <button class="dbg-choice ${state.layout.cardDensity === val ? "active" : ""}" data-set-density="${val}">${lbl}</button>
          `).join("")}
        </div>
      </div>

      <div class="dbg-group">
        <h4>4. Botão de entrada no Jira Nativo</h4>
        <div class="dbg-choice-grid">
          ${[
            ["all", "Todos os 3 pontos"],
            ["sidebar", "Só Barra Lateral QF"],
            ["header", "Só Header Jira"],
            ["dock", "Só Dock Flutuante"],
          ].map(([val, lbl]) => `
            <button class="dbg-choice ${state.layout.entryPoints === val ? "active" : ""}" data-set-entry="${val}">${lbl}</button>
          `).join("")}
        </div>
        <label class="dbg-toggle-row" style="margin-top:4px">
          <span>Manter barra lateral QuickFill aberta no Novo Painel</span>
          <input type="checkbox" id="chkKeepSidebar" ${state.layout.keepSidebarInRefactored ? "checked" : ""} />
        </label>
      </div>
    `;
  } else if (state.dbgTab === "modules") {
    const items = [
      ["goalCard", "Card Meta do Dia, Média & Streak"],
      ["timelineBar", "Barra interativa Linha do Tempo (11h–17h)"],
      ["execBar", "Barra Execução vs Estimativa / Excedente nos cards"],
      ["processStepper", "Stepper visual de Processo nos cards"],
      ["confluenceChips", "Chips clicáveis de Documentação Confluence"],
      ["figmaChips", "Chips clicáveis de Telas Figma"],
      ["gitChips", "Status de PR / Branch nos cards"],
      ["cardQuickActions", "Ações rápidas (+30m / Avançar) nos cards"],
      ["noiseComparison", "Badge comparativo (12 abas → 4 visões)"],
    ];
    body.innerHTML = `
      <div class="dbg-group">
        <h4>Ligar / Desligar blocos visuais</h4>
        ${items.map(([k, lbl]) => `
          <label class="dbg-toggle-row">
            <span>${lbl}</span>
            <input type="checkbox" data-toggle-mod="${k}" ${state.layout.modules[k] ? "checked" : ""} />
          </label>
        `).join("")}
      </div>
    `;
  } else if (state.dbgTab === "inspect") {
    const z = DEBUG_ZONES.find((x) => x.id === state.inspectedZone) || DEBUG_ZONES[0];
    body.innerHTML = `
      <div class="dbg-group">
        <h4>Selecionar zona para inspecionar</h4>
        <div class="dbg-choice-grid">
          ${DEBUG_ZONES.map((item) => `
            <button class="dbg-choice ${item.id === z.id ? "active" : ""}" data-zone-inspect="${item.id}">${item.code}</button>
          `).join("")}
        </div>
      </div>

      <div class="dbg-group dbg-api-box">
        <h4>${z.code} · ${esc(z.title)}</h4>
        <p style="margin:0;color:var(--muted);line-height:1.45">${esc(z.description)}</p>
        <strong style="color:#e0f2fe;margin-top:4px">Módulos / Handlers QuickFill:</strong>
        ${z.sources.map((s) => `<code>${esc(s)}</code>`).join("")}
        <strong style="color:#e0f2fe;margin-top:4px">Endpoints Jira / Confluence / Figma:</strong>
        ${z.endpoints.map((e) => `<code>${esc(e)}</code>`).join("")}
      </div>
    `;
  } else if (state.dbgTab === "notes") {
    body.innerHTML = `
      <div class="dbg-group">
        <h4>Pontos de ajuste anotados (${state.layout.notes.length})</h4>
        <p style="margin:0;font-size:11.5px;color:var(--muted)">
          Use <strong>📌 Marcar ponto</strong> na barra superior ou o ícone 📌 de qualquer zona para registrar mudanças de posição e comportamento.
        </p>
        ${state.layout.notes.map((n, idx) => `
          <div class="dbg-note-item">
            <div class="dbg-note-head">
              <span>#${idx + 1} · ${esc(n.zone)} (${n.view === "jira" ? "Jira" : "Novo Painel"})</span>
              <button data-del-note="${esc(n.id)}" style="border:0;background:transparent;color:var(--err);font-size:11px">✕</button>
            </div>
            <div>${esc(n.text)}</div>
          </div>
        `).join("") || `<div class="muted" style="font-size:11.5px">Nenhuma anotação ainda.</div>`}
      </div>
    `;
  }
}

function renderPins() {
  const layer = $("#pinLayer");
  const pins = state.layout.notes.filter((n) => n.view === state.view);
  layer.innerHTML = pins.map((n, idx) => `
    <div class="debug-pin ${n.xPct > 68 ? "tip-left" : ""}" style="left:${n.xPct}%;top:${n.yPct}%" data-pin-id="${esc(n.id)}">
      ${idx + 1}
      <div class="pin-tip">
        <strong style="color:var(--debug)">${esc(n.zone)}</strong><br/>
        ${esc(n.text)}
      </div>
    </div>
  `).join("");
}

function renderAll() {
  syncChrome();
  renderJiraNative();
  renderQfSidebar();
  if (state.view === "refactored") renderRefactored();
  renderIssueDrawer();
  renderDebugStudio();
  renderPins();
}

/* =====================================================================
   DRAG & DROP NO QUADRO INTELIGENTE
   ===================================================================== */
function bindDragAndDrop() {
  let draggedKey = null;
  $$(".rf-card[draggable]").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      draggedKey = card.dataset.cardKey;
      card.classList.add("dragging");
      e.dataTransfer.setData("text/plain", draggedKey);
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      $$(".rf-col.drag-over").forEach((c) => c.classList.remove("drag-over"));
    });
  });

  $$(".rf-col[data-drop-col]").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("drag-over");
    });
    col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const key = e.dataTransfer.getData("text/plain") || draggedKey;
      const target = col.dataset.dropCol;
      moveIssueStatus(key, target);
    });
  });
}

function moveIssueStatus(key, nextStatus) {
  const issue = issueByKey(key);
  if (!issue || issue.status === nextStatus) return;
  issue.status = nextStatus;
  const col = COLUMNS.find((c) => c.id === nextStatus);
  issue.currentStageLabel = `Movido agora para ${col.shortName}`;
  renderAll();
  showToast(`${issue.key} movida para ${col.jiraName}`);
}

/* =====================================================================
   MODAL: APONTAR TEMPO NA LINHA DO TEMPO
   ===================================================================== */
function openLogModal({ issueKey = "", gap = "" } = {}) {
  const sel = $("#logIssueSelect");
  const spIssues = state.issues.filter((i) => i.space === state.space);
  sel.innerHTML = spIssues.map((i) => `<option value="${esc(i.key)}">${esc(i.key)} — ${esc(i.title.slice(0, 56))}</option>`).join("");
  if (issueKey && spIssues.some((i) => i.key === issueKey)) sel.value = issueKey;

  if (gap && gap.includes("-")) {
    const [a, b] = gap.split("-");
    $("#logStart").value = a;
    $("#logEnd").value = b;
  } else {
    const best = findBestFreeGap();
    $("#logStart").value = fmtHM(best.start);
    $("#logEnd").value = fmtHM(best.end);
  }
  updateLogDurationPreview();
  $("#logTitle").value = "";
  $("#logModalBack").classList.remove("hidden");
  $("#logTitle").focus();
}

function updateLogDurationPreview() {
  const s = parseHM($("#logStart").value);
  const e = parseHM($("#logEnd").value);
  $("#logDurPreview").value = s != null && e != null && e > s ? fmtDur(e - s) : "Intervalo inválido";
}

function closeLogModal() {
  $("#logModalBack").classList.add("hidden");
}

function addWorklogEntry({ issueKey, startMin, endMin, kind, title }) {
  const colors = { exec: "#4bce97", bug: "#f87168", meeting: "#9f8fef", review: "#579dff" };
  const minutes = endMin - startMin;
  state.timeline.blocks.push({
    id: `wl-${Date.now()}`,
    issueKey,
    title,
    startMin,
    endMin,
    color: colors[kind] || "#4bce97",
    kind,
    category: kind,
  });
  const issue = issueByKey(issueKey);
  if (issue) {
    issue.spentMin += minutes;
    issue.worklogs.unshift({
      who: PERSONAS[state.persona].userId,
      when: `Hoje · ${fmtHM(startMin)}–${fmtHM(endMin)}`,
      minutes,
      note: title,
    });
  }
  const me = personById(PERSONAS[state.persona].userId);
  if (me) me.loggedMin += minutes;
  renderAll();
  showToast(`⏱ +${fmtDur(minutes)} registrados em ${issueKey} na Linha do Tempo`);
}

/* =====================================================================
   EVENTOS GLOBAIS
   ===================================================================== */
document.addEventListener("click", (e) => {
  // Modo anotação de ponto (Pin Mode) no stage
  if (state.debugMode && state.pinMode && e.target.closest("#stage") && !e.target.closest(".zone-debug-bar") && !e.target.closest(".debug-pin")) {
    const stageRect = $("#stage").getBoundingClientRect();
    const xPct = Math.round(((e.clientX - stageRect.left) / stageRect.width) * 100);
    const yPct = Math.round(((e.clientY - stageRect.top) / stageRect.height) * 100);
    const zoneEl = e.target.closest("[data-zone-id]");
    const zMeta = zoneEl ? DEBUG_ZONES.find((z) => z.id === zoneEl.dataset.zoneId) : null;
    openPinModal({
      xPct,
      yPct,
      zone: zMeta ? `${zMeta.code} · ${zMeta.title}` : state.view === "jira" ? "Jira Nativo" : "Painel Refatorado",
    });
    return;
  }

  // Troca de vista pela barra superior
  const setViewBtn = e.target.closest("[data-set-view]");
  if (setViewBtn) {
    setView(setViewBtn.dataset.setView);
    return;
  }

  // Troca de persona (somente botões do seletor, nunca o <body data-persona>)
  const personaBtn = e.target.closest("#personaSwitch button[data-persona]");
  if (personaBtn) {
    state.persona = personaBtn.dataset.persona;
    renderAll();
    showToast(`Perfil simulado: QuickFill ${PERSONAS[state.persona].label}`);
    return;
  }

  // Toggle Modo Debug vs Visão Usuário
  const dbgBtn = e.target.closest("[data-debug]");
  if (dbgBtn) {
    state.debugMode = dbgBtn.dataset.debug === "on";
    if (!state.debugMode) state.pinMode = false;
    renderAll();
    showToast(state.debugMode ? "🛠 Modo Debug ativado — arranje zonas e anote pontos" : "👁 Visão limpa do Usuário ativada");
    return;
  }

  // Ações de entrada/saída do Novo Painel
  const actionEl = e.target.closest("[data-action]");
  if (actionEl) {
    const act = actionEl.dataset.action;
    if (act === "enter-refactored") { setView("refactored"); return; }
    if (act === "exit-refactored") { setView("jira"); return; }
    if (act === "toggle-refactored") { setView(state.view === "refactored" ? "jira" : "refactored"); return; }
    if (act === "jump-hub") {
      state.wsTab = "hub";
      setView("refactored", { silent: true });
      showToast("📘 Abrindo Hub Confluence & Figma do espaço");
      return;
    }
    if (act === "filter-overrun") {
      state.wsTab = "board";
      state.filter = "overrun";
      setView("refactored", { silent: true });
      showToast("⚠ Filtrando demandas com excedente de tempo");
      return;
    }
  }

  // Selecionar espaço
  const spBtn = e.target.closest("[data-select-space]");
  if (spBtn) {
    state.space = spBtn.dataset.selectSpace;
    state.selectedPerson = "";
    renderAll();
    return;
  }

  // Abas do Workspace Refatorado
  const wsTabBtn = e.target.closest("[data-ws-tab]");
  if (wsTabBtn) {
    state.wsTab = wsTabBtn.dataset.wsTab;
    renderRefactored();
    return;
  }

  // Filtros do Workspace
  const fltBtn = e.target.closest("[data-filter]");
  if (fltBtn) {
    state.filter = fltBtn.dataset.filter;
    renderRefactored();
    return;
  }
  const qfBtn = e.target.closest("[data-quick-filter]");
  if (qfBtn) {
    state.filter = qfBtn.dataset.quickFilter;
    state.wsTab = "board";
    renderRefactored();
    return;
  }

  // Selecionar pessoa no Pulso da Equipe
  const personEl = e.target.closest("[data-select-person]");
  if (personEl) {
    const pid = personEl.dataset.selectPerson;
    state.selectedPerson = state.selectedPerson === pid ? "" : pid;
    renderRefactored();
    return;
  }
  if (e.target.id === "btnClearPerson") {
    state.selectedPerson = "";
    renderRefactored();
    return;
  }

  // Ações rápidas no card (antes de abrir drawer!)
  const qLog = e.target.closest("[data-quick-log]");
  if (qLog) {
    e.stopPropagation();
    const gap = findBestFreeGap();
    addWorklogEntry({
      issueKey: qLog.dataset.quickLog,
      startMin: gap.start,
      endMin: gap.start + 30,
      kind: "exec",
      title: "Execução rápida (+30m via card)",
    });
    return;
  }
  const qAdv = e.target.closest("[data-quick-advance]");
  if (qAdv) {
    e.stopPropagation();
    const issue = issueByKey(qAdv.dataset.quickAdvance);
    const order = ["todo", "doing", "done", "deploy"];
    const next = order[(order.indexOf(issue.status) + 1) % order.length];
    moveIssueStatus(issue.key, next);
    return;
  }

  // Abrir modal de apontamento de tempo
  const gapBtn = e.target.closest("[data-open-log-gap]");
  if (gapBtn) {
    openLogModal({ gap: gapBtn.dataset.openLogGap });
    return;
  }
  const logIssueBtn = e.target.closest("[data-open-log-issue]");
  if (logIssueBtn) {
    openLogModal({ issueKey: logIssueBtn.dataset.openLogIssue });
    return;
  }
  if (e.target.id === "btnHeaderLog" || e.target.id === "btnSideQuickLog") {
    openLogModal({});
    return;
  }

  // Abrir Raio-X da Demanda (card, timeline, hub ou chip Confluence/Figma)
  const openIssueEl = e.target.closest("[data-open-issue]");
  if (openIssueEl) {
    state.drawerIssueKey = openIssueEl.dataset.openIssue;
    state.drawerTab = openIssueEl.dataset.openTab || "process";
    renderIssueDrawer();
    return;
  }

  // Abas do Drawer
  const drTab = e.target.closest("[data-dr-tab]");
  if (drTab) {
    state.drawerTab = drTab.dataset.drTab;
    renderIssueDrawer();
    return;
  }
  if (e.target.id === "btnCloseDrawer" || e.target.id === "issueDrawerBack") {
    state.drawerIssueKey = null;
    renderIssueDrawer();
    return;
  }
  const moveBtn = e.target.closest("[data-move-issue]");
  if (moveBtn) {
    moveIssueStatus(moveBtn.dataset.moveIssue, moveBtn.dataset.moveTo);
    return;
  }

  // Controles de Debug Studio e Zonas
  const dbgTabBtn = e.target.closest("[data-dbg-tab]");
  if (dbgTabBtn) {
    state.dbgTab = dbgTabBtn.dataset.dbgTab;
    renderDebugStudio();
    return;
  }
  const moveZone = e.target.closest("[data-zone-move]");
  if (moveZone) {
    const id = moveZone.dataset.zoneMove;
    const dir = Number(moveZone.dataset.dir);
    const arr = state.layout.zoneOrder;
    const i = arr.indexOf(id);
    const j = i + dir;
    if (i >= 0 && j >= 0 && j < arr.length) {
      [arr[i], arr[j]] = [arr[j], arr[i]];
      saveLayout();
      renderAll();
      showToast("Ordem das zonas atualizada");
    }
    return;
  }
  const toggleZone = e.target.closest("[data-zone-toggle], [data-zone-hide]");
  if (toggleZone) {
    const id = toggleZone.dataset.zoneToggle || toggleZone.dataset.zoneHide;
    state.layout.visibleZones[id] = !state.layout.visibleZones[id];
    saveLayout();
    renderAll();
    return;
  }
  const inspectZone = e.target.closest("[data-zone-inspect]");
  if (inspectZone) {
    state.inspectedZone = inspectZone.dataset.zoneInspect;
    state.dbgTab = "inspect";
    state.studioOpen = true;
    renderAll();
    return;
  }
  const noteZone = e.target.closest("[data-zone-note]");
  if (noteZone) {
    const z = DEBUG_ZONES.find((x) => x.id === noteZone.dataset.zoneNote);
    openPinModal({ xPct: 50, yPct: 30, zone: `${z.code} · ${z.title}` });
    return;
  }
  const tlPosBtn = e.target.closest("[data-set-tlpos]");
  if (tlPosBtn) {
    state.layout.timelinePosition = tlPosBtn.dataset.setTlpos;
    saveLayout();
    renderAll();
    showToast(`Linha do Tempo ancorada: ${tlPosBtn.textContent}`);
    return;
  }
  const densBtn = e.target.closest("[data-set-density]");
  if (densBtn) {
    state.layout.cardDensity = densBtn.dataset.setDensity;
    saveLayout();
    renderAll();
    return;
  }
  const entryBtn = e.target.closest("[data-set-entry]");
  if (entryBtn) {
    state.layout.entryPoints = entryBtn.dataset.setEntry;
    saveLayout();
    renderAll();
    return;
  }
  const delNote = e.target.closest("[data-del-note]");
  if (delNote) {
    state.layout.notes = state.layout.notes.filter((n) => n.id !== delNote.dataset.delNote);
    saveLayout();
    renderDebugStudio();
    renderPins();
    return;
  }

  // Controles de painéis laterais
  if (e.target.closest("#btnToggleStudio") || e.target.closest("#btnCloseStudio")) {
    state.studioOpen = !state.studioOpen;
    syncChrome();
    requestAnimationFrame(updateZoneDimensions);
    return;
  }
  if (e.target.closest("#btnToggleQfSidebar") || e.target.closest("#btnCloseQfSide") || e.target.closest("#dockOpenSide")) {
    state.qfSidebarOpen = !state.qfSidebarOpen;
    syncChrome();
    requestAnimationFrame(updateZoneDimensions);
    return;
  }
  if (e.target.closest("#btnTogglePinMode")) {
    state.pinMode = !state.pinMode;
    syncChrome();
    return;
  }
  if (e.target.closest("#btnExportJson")) {
    const blueprint = {
      exportedAt: new Date().toISOString(),
      personaTested: state.persona,
      spaceTested: state.space,
      layout: state.layout,
    };
    const txt = JSON.stringify(blueprint, null, 2);
    navigator.clipboard?.writeText(txt).then(
      () => showToast("📋 Blueprint JSON copiado! Cole no chat para implementar igual."),
      () => {
        console.log("BLUEPRINT:", txt);
        showToast("Blueprint impresso no console do navegador (F12).");
      }
    );
    return;
  }
  if (e.target.closest("#btnResetLayout")) {
    state.layout = structuredClone(DEFAULT_LAYOUT);
    saveLayout();
    renderAll();
    showToast("↺ Layout restaurado para o padrão inicial");
  }
});

// Checkboxes (Módulos Debug, Subtarefas, Manter Sidebar)
document.addEventListener("change", (e) => {
  if (e.target.dataset.toggleMod) {
    state.layout.modules[e.target.dataset.toggleMod] = e.target.checked;
    saveLayout();
    renderAll();
    return;
  }
  if (e.target.id === "chkKeepSidebar") {
    state.layout.keepSidebarInRefactored = e.target.checked;
    saveLayout();
    if (state.view === "refactored") {
      state.qfSidebarOpen = e.target.checked;
      syncChrome();
    }
    return;
  }
  if (e.target.dataset.toggleSubtask) {
    const [key, stId] = e.target.dataset.toggleSubtask.split("::");
    const issue = issueByKey(key);
    const sub = issue?.subtasks.find((s) => s.id === stId);
    if (sub) {
      sub.done = e.target.checked;
      renderAll();
    }
  }
});

// Buscas e inputs de hora
document.addEventListener("input", (e) => {
  if (e.target.id === "rfSearch") {
    state.search = e.target.value;
    renderRefactored();
    const inp = $("#rfSearch");
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  } else if (e.target.id === "jiraBoardSearch" || e.target.id === "jiraNativeSearch") {
    state.jiraSearch = e.target.value;
    renderJiraNative();
  } else if (e.target.id === "logStart" || e.target.id === "logEnd") {
    updateLogDurationPreview();
  }
});

// Formulários (Log na Linha do Tempo, Comentário no Drawer, Pin de Anotação)
document.addEventListener("submit", (e) => {
  if (e.target.id === "logForm") {
    e.preventDefault();
    const fd = new FormData(e.target);
    const s = parseHM(fd.get("start"));
    const en = parseHM(fd.get("end"));
    if (s == null || en == null || en <= s) {
      showToast("⚠ O horário de fim deve ser maior que o início.");
      return;
    }
    addWorklogEntry({
      issueKey: String(fd.get("issueKey")),
      startMin: s,
      endMin: en,
      kind: String(fd.get("kind")),
      title: String(fd.get("title")).trim(),
    });
    closeLogModal();
  } else if (e.target.id === "drawerCommentForm") {
    e.preventDefault();
    const text = String(new FormData(e.target).get("comment") || "").trim();
    const issue = issueByKey(state.drawerIssueKey);
    if (issue && text) {
      issue.comments.unshift({ who: PERSONAS[state.persona].userId, when: "Agora", text });
      renderIssueDrawer();
      showToast(`💬 Comentário publicado em ${issue.key}`);
    }
  } else if (e.target.id === "pinForm") {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.layout.notes.push({
      id: `n-${Date.now()}`,
      view: state.view,
      xPct: state.pendingPin?.xPct ?? 50,
      yPct: state.pendingPin?.yPct ?? 30,
      zone: String(fd.get("zone")).trim(),
      text: String(fd.get("text")).trim(),
    });
    state.pinMode = false;
    state.dbgTab = "notes";
    saveLayout();
    closePinModal();
    renderAll();
    showToast("📌 Ponto de ajuste fixado no Modo Debug");
  }
});

function openPinModal({ xPct, yPct, zone }) {
  state.pendingPin = { xPct, yPct };
  $("#pinZoneInput").value = zone;
  $("#pinTextInput").value = "";
  $("#pinTargetInfo").textContent = `Tela: ${state.view === "jira" ? "Jira Nativo" : "Novo Painel"} · Coordenadas ${xPct}%, ${yPct}%`;
  $("#pinModalBack").classList.remove("hidden");
  $("#pinTextInput").focus();
}

function closePinModal() {
  $("#pinModalBack").classList.add("hidden");
}

$("#btnCloseLogModal").addEventListener("click", closeLogModal);
$("#btnCancelLog").addEventListener("click", closeLogModal);
$("#btnClosePinModal").addEventListener("click", closePinModal);
$("#btnCancelPin").addEventListener("click", closePinModal);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (state.pinMode) { state.pinMode = false; syncChrome(); return; }
    closeLogModal();
    closePinModal();
    if (state.drawerIssueKey) { state.drawerIssueKey = null; renderIssueDrawer(); }
  }
});

window.addEventListener("resize", () => requestAnimationFrame(updateZoneDimensions));

// Inicializa o protótipo
renderAll();
