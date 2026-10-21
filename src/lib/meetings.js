/**
 * Reuniões na linha do tempo (teste, nos 4 perfis).
 *
 * Alinhamentos, reuniões e outros (daily inclusive) marcados direto na linha do tempo do dia:
 * arraste a bolinha até o horário, solte, preencha título/início/fim/descrição. Ficam guardados
 * só no navegador (chrome.storage.local), junto com o registro de alterações, e contam na meta do
 * dia se a opção estiver ligada. Podem virar uma Tarefa no Jira (com o tempo apontado) se a pessoa
 * marcar essa opção; fora isso, nada é gravado no Jira.
 *
 * Modelos: atalhos do perfil (DEV, QA, SCRUM, DESIGN) que preenchem tipo, título, duração e Jira
 * de uma vez; a pessoa edita, cria e apaga os seus nas Opções ou com "Salvar como modelo".
 * As Opções mostram o histórico (lib/meetings-options.js).
 */

import { ROLE } from "./role.js";
import { MEETING_GROUPS, groupOfType } from "./meeting-detect.js";
export { MEETING_GROUPS, groupOfType };

export const MEETING_TYPES = {
  alinhamento: { label: "Alinhamento", color: "#6cc3e0" },
  reuniao: { label: "Reunião", color: "#fea362" },
  outro: { label: "Outro", color: "#94a3b4" },
  refinamento: { label: "Refinamento", color: "#f5cd47" },
  deploy: { label: "Deploy", color: "#e774bb" },
  config: { label: "Configuração", color: "#9f8fef" },
  testes: { label: "Testes", color: "#4bce97" },
  outroexec: { label: "Outro", color: "#94a3b4" },   // "Outro" do grupo Execução
};

export const MEETING_DEFAULTS = { meetingsDot: true, meetingsGoal: true, meetingsDur: 30, meetingTemplates: null };

/** Modelos de partida por perfil: o que cada um mais marca no dia. */
const T = (name, type, dur, extra = {}) => ({ id: `t-${name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-")}`, name, type, dur, title: name, desc: "", jira: false, sp: null, status: "done", ...extra });
export const ROLE_TEMPLATES = {
  dev: [T("Alinhamento com QA", "alinhamento", 15, { desc: "Cenário, ambiente e o que testar." }),
    T("Dúvida com o PO", "alinhamento", 10), T("Code review em par", "alinhamento", 30, { jira: true, sp: 1 }),
    T("Refinamento técnico", "refinamento", 60, { jira: true, sp: 2 })],
  qa: [T("Alinhamento com DEV", "alinhamento", 15, { desc: "Bug, passos para reproduzir e evidência." }),
    T("Reteste com o DEV", "alinhamento", 30, { jira: true, sp: 1 }), T("Critérios de aceite", "reuniao", 45, { jira: true, sp: 1 })],
  scrum: [T("Planning", "reuniao", 120, { jira: true, sp: 3 }), T("Review", "reuniao", 60, { jira: true, sp: 2 }),
    T("Retrospectiva", "reuniao", 60, { jira: true, sp: 2 }), T("1:1", "alinhamento", 30)],
  design: [T("Handoff com DEV", "alinhamento", 30, { desc: "Telas, estados e o link do Figma." }),
    T("Validação com o PO", "reuniao", 30, { jira: true, sp: 1 }), T("Pesquisa com usuário", "outro", 60, { jira: true, sp: 2 })],
};
export const defaultTemplates = () => (ROLE_TEMPLATES[ROLE] || ROLE_TEMPLATES.qa).map((t) => ({ ...t }));

const cache = { list: [], log: [], settings: { dot: true, goal: true, dur: 30, templates: defaultTemplates() } };
/** Ponte com o modal.js: enviar ao serviço (criar no Jira) e o projeto padrão. */
const api = { send: null, project: "", projects: [] };
export function setMeetingApi(a) { Object.assign(api, a); }
const SP = [1, 2, 3, 5, 8, 13, 21];
/** Opções do campo Categoria do Jira (lidas uma vez por janela, quando a pessoa marca "Criar a demanda"). */
const catStates = {};   // por projeto: MEED e SUS podem ter categorias diferentes
const catOf = (project) => (catStates[project || ""] ||= { loading: false, loaded: false, fieldId: null, options: null, error: null });

const pad = (n) => String(n).padStart(2, "0");
export const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const fmtMin = (m) => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };
const parseHM = (s) => { const [h, m] = String(s || "").split(":").map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
export const rgba = (hex, a) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")},${a})`;
const brDay = (iso) => `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}`;
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** A daily deixou de ser um tipo próprio: o que foi marcado como daily passa a ser "Outro". */
const noDaily = (x) => (x?.type === "daily" ? { ...x, type: "outro" } : x);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export async function loadMeetings() {
  try {
    const [l, s] = await Promise.all([chrome.storage.local.get({ qfMeetings: [], qfMeetingsLog: [] }), chrome.storage.sync.get(MEETING_DEFAULTS)]);
    cache.list = Array.isArray(l.qfMeetings) ? l.qfMeetings.map(noDaily) : [];
    cache.log = Array.isArray(l.qfMeetingsLog) ? l.qfMeetingsLog.map(noDaily) : [];
    cache.settings = {
      dot: s.meetingsDot !== false, goal: s.meetingsGoal !== false, dur: Number(s.meetingsDur) || 30,
      templates: Array.isArray(s.meetingTemplates) ? s.meetingTemplates.map(noDaily) : defaultTemplates(),
    };
  } catch { /* sem storage: segue vazio */ }
  return cache;
}

/** Avisa quando reuniões ou ajustes mudarem (em outra janela, nas Opções…). */
export function onMeetingsChange(cb) {
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if ((area === "local" && (ch.qfMeetings || ch.qfMeetingsLog))
        || (area === "sync" && (ch.meetingsDot || ch.meetingsGoal || ch.meetingsDur || ch.meetingTemplates))) loadMeetings().then(cb);
    });
  } catch { /* segue */ }
}

/* ------------------------------------------------------------------ */
/* Modelos                                                             */
/* ------------------------------------------------------------------ */

export const meetingTemplates = () => cache.settings.templates;
export async function saveTemplates(list) {
  cache.settings.templates = list;
  await chrome.storage.sync.set({ meetingTemplates: list });
}
export async function resetTemplates() {
  cache.settings.templates = defaultTemplates();
  await chrome.storage.sync.set({ meetingTemplates: null });
}
export const ROLE_LABEL = { qa: "QA", dev: "DEV", scrum: "SCRUM", design: "DESIGN" };
export const roleLabel = () => ROLE_LABEL[ROLE] || "";

/* ------------------------------------------------------------------ */
/* Registro de alterações                                               */
/* ------------------------------------------------------------------ */

const LOG_MAX = 300;
const brief = (m) => ({ mid: m.id, type: m.type, title: m.title, date: m.date, start: m.start, end: m.end, jiraKey: m.jiraKey || null });

/** O que mudou entre a versão anterior e a nova de uma reunião. */
function changeOf(prev, next) {
  if (!prev) return next.jiraKey ? { action: "criou", detail: `virou ${next.jiraKey}` } : { action: "criou" };
  if (next.jiraKey && !prev.jiraKey) return { action: "virou demanda", detail: next.jiraKey };
  if (prev.date !== next.date || prev.start !== next.start || prev.end !== next.end) {
    return { action: "moveu", from: { date: prev.date, start: prev.start, end: prev.end } };
  }
  const what = [prev.title !== next.title && "título", prev.type !== next.type && "tipo", (prev.desc || "") !== (next.desc || "") && "descrição"].filter(Boolean);
  return what.length ? { action: "editou", detail: what.join(", ") } : null;
}

async function pushLog(entry) {
  cache.log = [...cache.log, { id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: Date.now(), ...entry }].slice(-LOG_MAX);
  await chrome.storage.local.set({ qfMeetingsLog: cache.log });
}
export const meetingLog = () => cache.log;

/** Frase da alteração ("Você moveu…"). */
export function describeChange(e, who = "Você") {
  const t = (MEETING_TYPES[e.type] || MEETING_TYPES.outro).label.toLowerCase();
  const name = `“${e.title}”`;
  const when = `${hhmm(e.start)}–${hhmm(e.end)}`;
  switch (e.action) {
    case "criou": return `${who} marcou ${t} ${name} às ${hhmm(e.start)}${e.detail ? ` e ${e.detail}` : ""}`;
    case "moveu": return `${who} mudou ${name} ${e.from && e.from.date !== e.date ? `para outro dia, ${when}` : `de ${hhmm(e.from?.start ?? e.start)} para ${hhmm(e.start)}`}`;
    case "editou": return `${who} editou ${name} (${e.detail})`;
    case "virou demanda": return `${who} transformou ${name} na demanda ${e.detail}`;
    case "excluiu": return `${who} excluiu ${t} ${name} de ${when}`;
    default: return `${who} alterou ${name}`;
  }
}

export const meetingsOn = (date) => cache.list.filter((m) => m.date === date).sort((a, b) => a.start - b.start);
/** As que você marcou entre duas datas (inclusive). */
export const meetingsBetween = (from, to) => cache.list.filter((m) => m.date >= from && m.date <= to);
/** Minutos de reunião que contam na meta do dia (0 se a opção estiver desligada).
 *  As que viraram demanda no Jira com tempo apontado já entram pelo apontamento: não contam de novo. */
export const meetingMinutes = (date) => (cache.settings.goal
  ? meetingsOn(date).filter((m) => !(m.jiraKey && m.logged)).reduce((s, m) => s + (m.end - m.start), 0) : 0);
export const meetingSettings = () => cache.settings;

export async function saveMeeting(m) {
  const prev = cache.list.find((x) => x.id === m.id);
  const list = cache.list.filter((x) => x.id !== m.id);
  list.push(m);
  cache.list = list;
  await chrome.storage.local.set({ qfMeetings: list });
  const ch = changeOf(prev, m);
  if (ch) await pushLog({ ...brief(m), ...ch });
}
export async function deleteMeeting(id) {
  const prev = cache.list.find((x) => x.id === id);
  cache.list = cache.list.filter((x) => x.id !== id);
  await chrome.storage.local.set({ qfMeetings: cache.list });
  if (prev) await pushLog({ ...brief(prev), action: "excluiu" });
}

/* ------------------------------------------------------------------ */
/* Modal: marcar ou editar                                             */
/* ------------------------------------------------------------------ */

export function openMeetingModal(m, { onDone } = {}) {
  document.querySelector(".mtg-modal")?.remove();
  const editing = !!m.id;
  const heading = () => (groupOfType(cur.type) === "execucao" ? (editing ? "Editar atividade" : "Marcar atividade") : (editing ? "Editar reunião" : "Marcar reunião"));
  const cur = { type: "reuniao", title: "", desc: "", jira: false, startDate: m.date, dueDate: m.date, sp: null, status: "done", project: api.project, ...noDaily(m) };
  if (!cur.title && !editing) cur.title = MEETING_TYPES[cur.type].label;
  let group = groupOfType(cur.type);
  // Barra lateral dos modelos: aberta ou fechada, lembrada entre as vezes (fechada em janelas estreitas)
  let sideOpen = window.innerWidth >= 560;
  try { const v = localStorage.getItem("qf.mtgSide"); if (v != null) sideOpen = v === "1"; } catch { /* sem storage */ }
  const projects = [...new Set([cur.project, ...(api.projects || [])].filter(Boolean))];

  const wrap = document.createElement("div");
  wrap.className = "mtg-modal";
  wrap.innerHTML = `
    <div class="mtg-box${editing ? "" : " has-side"}${sideOpen ? " side-open" : ""}" role="dialog" aria-modal="true" aria-labelledby="mtgTitleH">
      ${editing ? "" : `<aside class="mtg-side" aria-label="Modelos">
        <button type="button" class="mtg-side-tog" data-side-tog aria-expanded="${sideOpen}" title="Mostrar ou ocultar os modelos">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Modelos ${esc(roleLabel())}</span><small data-tpl-n></small>
        </button>
        <div class="mtg-side-body">
          <div class="mtg-tpls" data-tpls role="group" aria-label="Modelos"></div>
          <button type="button" class="mtg-link" data-tpl-edit>Editar modelos</button>
        </div>
      </aside>`}
      <div class="mtg-main">
      <div class="mtg-head"><b id="mtgTitleH">${editing ? "Editar reunião" : "Marcar reunião"}</b><button class="ic" data-x aria-label="Fechar">✕</button></div>
      <div class="seg mtg-grp" data-grp role="group" aria-label="Grupo">${Object.entries(MEETING_GROUPS).map(([g, x]) => `<button type="button" data-g="${g}">${esc(x.label)}</button>`).join("")}</div>
      <div class="mtg-types" role="group" aria-label="Tipo"></div>
      <label class="mtg-f"><span>Título</span><input class="inp" data-title maxlength="120" /></label>
      <div class="mtg-row mtg-row3">
        <label class="mtg-f"><span>Dia</span><input class="inp" type="date" data-date /></label>
        <label class="mtg-f"><span>Começou</span><input class="inp" type="time" step="300" data-start /></label>
        <label class="mtg-f"><span>Terminou</span><input class="inp" type="time" step="300" data-end /></label>
      </div>
      <div class="mtg-dur muted xs"></div>
      <label class="mtg-f"><span>Descrição <em>(opcional)</em></span><textarea class="inp" rows="3" data-desc placeholder="O que foi combinado"></textarea></label>
      <div class="mtg-jira" data-jira-wrap>
        <div class="mtg-jira-top">
          <label class="mtg-chk"><input type="checkbox" data-jira /><span>Criar a demanda no Jira</span></label>
          <label class="mtg-proj" data-proj-wrap><span>em</span><select class="inp" data-proj aria-label="Projeto da demanda"></select></label>
        </div>
        <div class="mtg-jira-fields" data-jira-fields>
          <div class="mtg-row">
            <label class="mtg-f"><span>Data de início</span><input class="inp" type="date" data-sdate /></label>
            <label class="mtg-f"><span>Data limite</span><input class="inp" type="date" data-ddate /></label>
          </div>
          <label class="mtg-f" data-cat-wrap><span>Categoria no Jira</span><select class="inp" data-cat></select></label>
          <p class="muted xs mtg-note" data-cat-note></p>
          <div class="mtg-f"><span>Story points</span><div class="mtg-sp" data-sp></div></div>
          <label class="mtg-f"><span>Status</span><select class="inp" data-status><option value="done">Concluído</option><option value="doing">Em andamento</option><option value="keep">Não alterar</option></select></label>
          <p class="muted xs mtg-note" data-jira-note></p>
        </div>
      </div>
      <div class="mtg-linked" data-linked></div>
      <p class="mtg-err" data-err></p>
      <div class="mtg-actions">
        ${editing ? '<button class="btn sm mtg-del" data-del>Excluir</button>' : '<button type="button" class="mtg-link" data-tpl-save>Salvar como modelo</button>'}
        <span class="grow"></span>
        <button class="btn sm ghost" data-x>Cancelar</button>
        <button class="btn sm primary" data-save>Salvar</button>
      </div>
      </div>
    </div>`;
  const $ = (s) => wrap.querySelector(s);
  const types = $(".mtg-types");
  /* Reuniões | Execução: o botão escolhe o grupo e só os tipos dele aparecem */
  const pickType = (k) => {
    const t = MEETING_TYPES[k];
    const auto = !cur.title || Object.values(MEETING_TYPES).some((x) => x.label === cur.title);
    cur.type = k;
    if (auto) { cur.title = k === "outro" || k === "outroexec" ? "" : t.label; $("[data-title]").value = cur.title; }
    paintTypes(); paintJira(); pickCategory();
  };
  $("[data-grp]").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-g]");
    if (!b || b.dataset.g === group) return;
    group = b.dataset.g;
    pickType(MEETING_GROUPS[group].types[0]);
  });
  const paintTypes = () => {
    types.innerHTML = "";
    $("#mtgTitleH").textContent = heading();
    $("[data-grp]").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.g === group));
    for (const k of MEETING_GROUPS[group].types) {
      const t = MEETING_TYPES[k];
      const b = document.createElement("button");
      b.type = "button";
      b.className = `mtg-type${cur.type === k ? " on" : ""}`;
      b.setAttribute("aria-pressed", String(cur.type === k));
      b.innerHTML = `<i></i>${t.label}`;
      b.querySelector("i").style.background = t.color;
      if (cur.type === k) { b.style.borderColor = t.color; b.style.background = rgba(t.color, 0.18); }
      b.addEventListener("click", () => pickType(k));
      types.appendChild(b);
    }
  };
  const paintDur = () => { $(".mtg-dur").textContent = `${fmtMin(cur.end - cur.start)}${cache.settings.goal ? " que contam na meta do dia" : ""}`; paintJira(); };

  /* Jira: só para alinhamento, reunião e outro; a Daily fica local */
  const sp = $("[data-sp]");
  for (const v of [...SP, null]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mtg-spb";
    b.textContent = v == null ? "sem" : String(v);
    b.dataset.v = v == null ? "" : String(v);
    b.addEventListener("click", () => { cur.sp = v; paintJira(); });
    sp.appendChild(b);
  }
  /* categoria do Jira: o tipo escolhido sugere a opção; a pessoa pode trocar */
  const catSel = $("[data-cat]");
  const cs = () => catOf(cur.project);
  let catTouched = !!cur.categoryId;
  function pickCategory() {
    if (catTouched || !cs().options) return;
    const o = cs().options.find((x) => x.type === cur.type);
    cur.categoryId = o ? o.id : "";
    catSel.value = cur.categoryId;
  }
  function paintCategory() {
    const st = cs();
    $("[data-cat-wrap]").hidden = !st.options?.length;
    $("[data-cat-note]").textContent = st.loading ? "Lendo as categorias do Jira…"
      : st.error ? `Não deu para ler o campo Categoria: ${st.error}`
      : st.loaded && !st.fieldId ? "Este projeto não tem o campo Categoria na Tarefa: a demanda é criada sem ele." : "";
    if (!st.options?.length) return;
    catSel.innerHTML = "";
    catSel.append(new Option("Sem categoria", ""));
    for (const o of st.options) catSel.append(new Option(o.value, o.id));
    pickCategory();
    catSel.value = cur.categoryId || "";
  }
  catSel.addEventListener("change", (e) => { cur.categoryId = e.target.value; catTouched = true; });
  function loadCategories() {
    const st0 = cs();
    if (st0.loaded || st0.loading || !api.send) { paintCategory(); return; }
    st0.loading = true; paintCategory();
    api.send("MEETING_CATEGORY_OPTIONS", { project: cur.project })
      .then((r) => Object.assign(st0, { fieldId: r.fieldId, options: r.options || [], error: null }))
      .catch((e) => Object.assign(st0, { error: e.message }))
      .finally(() => { st0.loading = false; st0.loaded = !st0.error; if (wrap.isConnected) paintCategory(); });
  }

  function paintJira() {
    const linked = !!cur.jiraKey;
    $("[data-jira-wrap]").hidden = linked || !api.send;
    $("[data-jira]").checked = !!cur.jira;
    $("[data-jira-fields]").hidden = !cur.jira;
    if (cur.jira && !linked) loadCategories();
    $("[data-proj-wrap]").hidden = !cur.project;
    sp.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === (cur.sp == null ? "" : String(cur.sp))));
    $("[data-jira-note]").textContent = `Cria uma Tarefa${cur.project ? ` em ${cur.project}` : ""} atribuída a você e aponta ${fmtMin(cur.end - cur.start)} em ${brDay(cur.date)} a partir das ${hhmm(cur.start)}.`;
    const lk = $("[data-linked]");
    lk.innerHTML = "";
    if (linked) {
      const a = document.createElement("a");
      a.href = cur.jiraUrl || "#"; a.target = "_blank"; a.rel = "noopener";
      a.textContent = `${cur.jiraKey} no Jira ↗`;
      const small = document.createElement("span");
      small.className = "muted xs";
      small.textContent = " Mudanças aqui não alteram a demanda no Jira.";
      lk.append(a, small);
    }
    $("[data-save]").textContent = cur.jira && !linked ? "Salvar e criar no Jira" : "Salvar";
  }
  $("[data-jira]").addEventListener("change", (e) => { cur.jira = e.target.checked; paintJira(); });
  /* Projeto da demanda: MEED ou SUS (começa no Espaço/projeto padrão) */
  const projSel = $("[data-proj]");
  for (const pk of projects) projSel.append(new Option(pk, pk));
  projSel.value = cur.project || "";
  projSel.addEventListener("change", (e) => {
    cur.project = e.target.value; catTouched = false; cur.categoryId = "";
    paintJira(); paintCategory();
  });
  /* Dia: muda o dia da atividade (ex.: lançar ontem); as datas do Jira acompanham se estavam iguais */
  $("[data-date]").value = cur.date;
  $("[data-date]").addEventListener("change", (e) => {
    const v = e.target.value; if (!v) return;
    if (cur.startDate === cur.date) { cur.startDate = v; $("[data-sdate]").value = v; }
    if (cur.dueDate === cur.date) { cur.dueDate = v; $("[data-ddate]").value = v; }
    cur.date = v; paintJira();
  });
  $("[data-sdate]").addEventListener("change", (e) => { cur.startDate = e.target.value || cur.date; });
  $("[data-ddate]").addEventListener("change", (e) => { cur.dueDate = e.target.value || cur.date; });
  $("[data-status]").addEventListener("change", (e) => { cur.status = e.target.value; });
  $("[data-sdate]").value = cur.startDate || cur.date;
  $("[data-ddate]").value = cur.dueDate || cur.date;
  $("[data-status]").value = cur.status;
  paintTypes();
  $("[data-title]").value = cur.title;
  $("[data-start]").value = hhmm(cur.start);
  $("[data-end]").value = hhmm(cur.end);
  $("[data-desc]").value = cur.desc || "";
  paintDur();
  $("[data-title]").addEventListener("input", (e) => { cur.title = e.target.value; });
  $("[data-desc]").addEventListener("input", (e) => { cur.desc = e.target.value; });
  $("[data-start]").addEventListener("change", (e) => {
    const v = parseHM(e.target.value); if (v == null) return;
    const dur = cur.end - cur.start;
    cur.start = v; cur.end = Math.min(24 * 60, v + Math.max(5, dur));
    $("[data-end]").value = hhmm(cur.end); paintDur();
  });
  $("[data-end]").addEventListener("change", (e) => {
    const v = parseHM(e.target.value); if (v == null) return;
    cur.end = Math.max(cur.start + 5, v); e.target.value = hhmm(cur.end); paintDur();
  });

  /* modelos: um clique preenche tipo, título, duração e Jira */
  const tpls = $("[data-tpls]");
  const fill = () => {
    $("[data-title]").value = cur.title;
    $("[data-desc]").value = cur.desc || "";
    $("[data-end]").value = hhmm(cur.end);
    $("[data-status]").value = cur.status;
    paintTypes(); paintDur();
    const box = $(".mtg-box");
    box.classList.remove("mtg-filled"); void box.offsetWidth; box.classList.add("mtg-filled");
  };
  function paintTpls() {
    if (!tpls) return;
    tpls.innerHTML = "";
    for (const t of cache.settings.templates) {
      const c = (MEETING_TYPES[t.type] || MEETING_TYPES.outro).color;
      const b = document.createElement("button");
      b.type = "button";
      b.className = `mtg-tpl${cur.tpl === t.id ? " on" : ""}`;
      b.setAttribute("aria-pressed", String(cur.tpl === t.id));
      b.innerHTML = `<i></i><span></span><small>${fmtMin(t.dur)}</small>`;
      b.querySelector("i").style.background = c;
      b.querySelector("span").textContent = t.name;
      b.title = `${MEETING_TYPES[t.type]?.label || "Outro"}, ${fmtMin(t.dur)}${t.jira ? ", cria a demanda no Jira" : ""}`;
      if (cur.tpl === t.id) { b.style.borderColor = c; b.style.background = rgba(c, 0.16); }
      b.addEventListener("click", () => {
        Object.assign(cur, { tpl: t.id, type: t.type, title: t.title || t.name, desc: t.desc || "", sp: t.sp ?? null, status: t.status || "done",
          jira: !!t.jira, end: Math.min(24 * 60, cur.start + Math.max(5, Number(t.dur) || 30)) });
        group = groupOfType(cur.type);
        paintTpls(); fill();
      });
      tpls.appendChild(b);
    }
    const n = $("[data-tpl-n]"); if (n) n.textContent = String(cache.settings.templates.length);
    if (!cache.settings.templates.length) tpls.innerHTML = `<span class="muted xs">Nenhum modelo. Preencha abaixo e use “Salvar como modelo”.</span>`;
  }
  paintTpls();
  $("[data-side-tog]")?.addEventListener("click", (e) => {
    sideOpen = !sideOpen;
    $(".mtg-box").classList.toggle("side-open", sideOpen);
    e.currentTarget.setAttribute("aria-expanded", String(sideOpen));
    try { localStorage.setItem("qf.mtgSide", sideOpen ? "1" : "0"); } catch { /* sem storage */ }
  });
  $("[data-tpl-edit]")?.addEventListener("click", () => {
    const url = chrome.runtime.getURL("options.html#modelos");
    try { chrome.tabs.create({ url }); } catch { window.open(url, "_blank"); }
  });
  $("[data-tpl-save]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const name = (cur.title || "").trim() || MEETING_TYPES[cur.type].label;
    const t = { id: `t${Date.now().toString(36)}`, name, type: cur.type, dur: cur.end - cur.start, title: name, desc: (cur.desc || "").trim(),
      jira: !!cur.jira, sp: cur.sp ?? null, status: cur.status || "done" };
    const list = cache.settings.templates.filter((x) => x.name.toLowerCase() !== name.toLowerCase());
    await saveTemplates([...list, t]);
    cur.tpl = t.id;
    paintTpls();
    btn.textContent = `Modelo “${name}” salvo`;
    setTimeout(() => { btn.textContent = "Salvar como modelo"; }, 1800);
  });

  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  wrap.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  $("[data-save]").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const item = { ...cur, title: (cur.title || "").trim() || MEETING_TYPES[cur.type].label, desc: (cur.desc || "").trim(),
      id: cur.id || `m${Date.now().toString(36)}`, savedAt: Date.now() };
    $("[data-err]").textContent = "";
    if (item.jira && !item.jiraKey && api.send) {
      btn.disabled = true; btn.textContent = "Criando no Jira…";
      try {
        const res = await api.send("CREATE_MEETING_ISSUE", {
          project: cur.project || api.project,
          title: item.title, desc: item.desc, date: item.date, start: item.start, end: item.end,
          startDate: item.startDate || item.date, dueDate: item.dueDate || item.date, storyPoints: item.sp, status: item.status,
          categoryId: item.categoryId || "",
        });
        Object.assign(item, { jiraKey: res.key, jiraUrl: res.url, logged: res.logged || 0, jiraOk: res.ok,
          category: cs().options?.find((o) => o.id === item.categoryId)?.value || "" });
        if (!res.ok) item.jiraIssues = (res.steps || []).filter((x) => x.ok === false).map((x) => `${x.step}: ${x.detail || "falhou"}`);
      } catch (err) {
        btn.disabled = false; paintJira();
        $("[data-err]").textContent = `Não deu para criar no Jira: ${err.message}`;
        return;
      }
    }
    delete item.jira;
    await saveMeeting(item);
    close(); onDone?.(item);
  });
  $("[data-del]")?.addEventListener("click", async () => { await deleteMeeting(cur.id); close(); onDone?.(); });
  document.body.appendChild(wrap);
  $("[data-title]").focus();
  $("[data-title]").select();
}

/* ------------------------------------------------------------------ */
/* Linha do tempo: blocos, bolinhas e arrastar                          */
/* ------------------------------------------------------------------ */

/**
 * Coloca as reuniões e atividades do dia na linha do tempo e a bolinha de marcar.
 * @param tr  retorno de track(): { track, lo, hi }
 * @param opts { date, now (minutos, só hoje), onChange, readOnly (só mostra, sem bolinhas),
 *               list + who (reuniões de outra pessoa da equipe, só leitura) }
 */
export function attachMeetings(tr, { date, now = null, onChange, readOnly = false, list = null, who = "", only = null }) {
  if (list) readOnly = true;
  const t = tr.track, lo = tr.lo, span = tr.hi - tr.lo;
  t.classList.add(readOnly ? "has-mtg-ro" : "has-mtg");
  const pct = (m) => `${((m - lo) / span) * 100}%`;
  const snap = (m) => Math.round(m / 5) * 5;
  const toMin = (clientX) => {
    const r = t.getBoundingClientRect();
    return snap(lo + ((clientX - r.left) / r.width) * span);
  };
  const tip = document.createElement("span");
  tip.className = "mtg-tip hidden";
  t.appendChild(tip);
  const showTip = (m) => { tip.textContent = hhmm(m); tip.style.left = pct(m); tip.classList.remove("hidden"); };

  /** Arrastar com o ponteiro; clique sem mover chama onClick. */
  function draggable(handle, { onMove, onDrop, onClick }) {
    handle.addEventListener("click", (e) => e.stopPropagation());   // não abre o que estiver por trás (linha da pessoa etc.)
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const x0 = e.clientX;
      let moved = false;
      const move = (ev) => { if (Math.abs(ev.clientX - x0) > 3) moved = true; if (moved) onMove(toMin(ev.clientX)); };
      const up = (ev) => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        tip.classList.add("hidden");
        if (moved) onDrop(toMin(ev.clientX)); else onClick?.();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }

  for (const m of (list || meetingsOn(date)).filter((x) => !only || only(x))) {
    if (m.end <= lo || m.start >= tr.hi) continue;
    const t0 = MEETING_TYPES[m.type] || MEETING_TYPES.outro;
    const blk = document.createElement("span");
    blk.className = "mtg-blk";
    blk.style.left = pct(m.start);
    blk.style.width = pct(lo + (m.end - m.start));
    blk.style.borderColor = t0.color;
    blk.style.background = rgba(t0.color, 0.22);
    blk.title = `${who ? `${who} · ` : ""}${t0.label}: ${m.title} · ${hhmm(m.start)}–${hhmm(m.end)} · ${fmtMin(m.end - m.start)}${m.jiraKey ? ` · ${m.jiraKey}` : ""}`;
    if (readOnly) { blk.classList.add("ro"); t.appendChild(blk); continue; }
    blk.addEventListener("click", (e) => { e.stopPropagation(); openMeetingModal(m, { onDone: onChange }); });
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "mtg-dot";
    dot.style.left = pct(m.start);
    dot.style.background = t0.color;
    dot.title = `${m.title}: arraste para mudar o horário; clique para editar`;
    dot.setAttribute("aria-label", `${m.title}, ${hhmm(m.start)} às ${hhmm(m.end)}`);
    const dur = m.end - m.start;
    const clampStart = (v) => Math.max(lo, Math.min(tr.hi - dur, v));
    draggable(dot, {
      onMove: (v) => { v = clampStart(v); dot.style.left = blk.style.left = pct(v); showTip(v); },
      onDrop: async (v) => { v = clampStart(v); await saveMeeting({ ...m, start: v, end: v + dur }); onChange?.(); },
      onClick: () => openMeetingModal(m, { onDone: onChange }),
    });
    t.append(blk, dot);
  }

  if (readOnly || !cache.settings.dot) return;
  const start0 = now != null && now > lo && now < tr.hi ? snap(now) : snap(lo + span / 2);
  const add = document.createElement("button");
  add.type = "button";
  add.className = "mtg-add";
  add.style.left = pct(start0);
  add.title = "Arraste até o horário e solte para marcar uma reunião, alinhamento ou atividade";
  add.setAttribute("aria-label", "Marcar reunião ou atividade na linha do tempo");
  add.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;
  let at = start0;
  const clampAdd = (v) => Math.max(lo, Math.min(tr.hi - 5, v));
  const open = () => openMeetingModal({ date, start: at, end: Math.min(tr.hi, at + cache.settings.dur), type: "reuniao" }, { onDone: onChange });
  draggable(add, {
    onMove: (v) => { at = clampAdd(v); add.style.left = pct(at); showTip(at); },
    onDrop: (v) => { at = clampAdd(v); open(); },
    onClick: open,
  });
  t.appendChild(add);
}

/** Filtro do card (Todas | Reuniões | Execução), lembrado entre as abas e as vezes. */
let cardGroup = "all";
try { cardGroup = localStorage.getItem("qf.mtgCardGroup") || "all"; } catch { /* sem storage */ }

/** Card "Atividades do dia": reuniões e execução marcadas na linha do tempo, com filtro por grupo. */
export function meetingsCard(date, { onChange } = {}) {
  const all = meetingsOn(date);
  const card = document.createElement("div");
  card.className = "card mtg-card";
  const sum = (arr) => arr.reduce((s, m) => s + m.end - m.start, 0);
  const byGroup = Object.fromEntries(Object.keys(MEETING_GROUPS).map((g) => [g, all.filter((m) => groupOfType(m.type) === g)]));
  if (cardGroup !== "all" && !byGroup[cardGroup]) cardGroup = "all";
  const list = cardGroup === "all" ? all : byGroup[cardGroup];
  card.innerHTML = `<div class="card-t">Atividades do dia<span></span></div>`;
  card.querySelector(".card-t span").textContent = all.length ? fmtMin(sum(all)) : "";
  if (all.length) {
    // Todas | Reuniões 30m | Execução 2h: o mesmo filtro de grupos da Equipe
    const bar = document.createElement("div");
    bar.className = "seg mtg-card-seg";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Mostrar");
    for (const [g, label] of [["all", "Todas"], ...Object.entries(MEETING_GROUPS).map(([g, x]) => [g, x.label])]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cardGroup === g ? "on" : "";
      b.setAttribute("aria-pressed", String(cardGroup === g));
      b.textContent = g === "all" ? label : `${label} ${fmtMin(sum(byGroup[g]))}`;
      b.addEventListener("click", () => {
        cardGroup = g;
        try { localStorage.setItem("qf.mtgCardGroup", g); } catch { /* sem storage */ }
        card.replaceWith(meetingsCard(date, { onChange }));
      });
      bar.appendChild(b);
    }
    card.appendChild(bar);
  }
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "muted xs";
    p.style.margin = "0";
    p.textContent = all.length ? `Nenhuma ${cardGroup === "execucao" ? "atividade de execução" : "reunião"} neste dia.`
      : cache.settings.dot ? "Nenhuma ainda. Arraste a bolinha + da linha do tempo até o horário da reunião ou da atividade."
      : "Nenhuma reunião ou atividade marcada neste dia.";
    card.appendChild(p);
    return card;
  }
  for (const m of list) {
    const t0 = MEETING_TYPES[m.type] || MEETING_TYPES.outro;
    const row = document.createElement("div");
    row.className = "mtg-row-item";
    row.innerHTML = `<span class="mtg-pill"></span><div class="mtg-txt"><b></b><small></small></div><span class="mtg-acts"></span>`;
    const pill = row.querySelector(".mtg-pill");
    pill.textContent = t0.label; pill.style.color = t0.color; pill.style.background = rgba(t0.color, 0.2);
    row.querySelector("b").textContent = m.title;
    row.querySelector("small").textContent = `${hhmm(m.start)} às ${hhmm(m.end)}, ${fmtMin(m.end - m.start)}${m.desc ? ` · ${m.desc}` : ""}`;
    const acts = row.querySelector(".mtg-acts");
    if (m.jiraKey) {
      const a = document.createElement("a");
      a.className = "btn sm ghost mtg-jira-link";
      a.href = m.jiraUrl || "#"; a.target = "_blank"; a.rel = "noopener";
      a.textContent = `${m.jiraKey} ↗`;
      a.title = m.jiraIssues?.length ? `Abrir no Jira. Avisos: ${m.jiraIssues.join("; ")}` : "Abrir no Jira";
      acts.appendChild(a);
    }
    const ed = document.createElement("button");
    ed.className = "btn sm ghost";
    ed.textContent = "Editar";
    ed.addEventListener("click", () => openMeetingModal(m, { onDone: onChange }));
    acts.appendChild(ed);
    card.appendChild(row);
  }
  return card;
}

/** "há 5 min", "há 2 h", "ontem 14:20"… */
export function ago(at) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  const d = new Date(at), today = isoDay(new Date()), day = isoDay(d);
  if (day === today) return `há ${Math.round(s / 3600)} h`;
  return `${day === isoDay(new Date(Date.now() - 864e5)) ? "ontem" : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`} ${hhmm(d.getHours() * 60 + d.getMinutes())}`;
}
