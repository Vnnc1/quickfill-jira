/**
 * Opções › Reuniões e alinhamentos, Modelos de reunião e Histórico da linha do tempo.
 *
 * Ajustes e modelos salvam na hora. O histórico tem duas visões:
 *  - Minhas: o que você marcou, dia a dia, com a faixa do dia, os totais e o que virou demanda,
 *    mais os seus apontamentos em demandas do Jira que foram reuniões (Planning, Review…),
 *    reconhecidas pela Categoria do Jira ou, sem ela, pelo título ou pela descrição
 *    (background.js › MY_MEETINGS, só leitura). Filtros por grupo (Reuniões, Execução) e por tipo.
 *  - Alterações: o que você criou, moveu, editou ou excluiu, em ordem.
 */

import {
  MEETING_TYPES, MEETING_DEFAULTS, loadMeetings, onMeetingsChange, deleteMeeting, fmtMin, hhmm, rgba,
  meetingTemplates, saveTemplates, resetTemplates, roleLabel, meetingLog, describeChange, ago,
  MEETING_GROUPS, groupOfType,
} from "./meetings.js";
import { byLabel } from "./meeting-detect.js";

const $ = (id) => document.getElementById(id);
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayLabel = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  const w = new Date(y, m - 1, d).getDay();
  const today = iso(new Date()), yest = iso(new Date(Date.now() - 864e5));
  return `${DOW[w]} ${pad(d)}/${pad(m)}${s === today ? ", hoje" : s === yest ? ", ontem" : ""}`;
};
const tOf = (k) => MEETING_TYPES[k] || MEETING_TYPES.outro;

let data = { list: [] };
/** Reuniões reconhecidas nas suas demandas do Jira, para o período escolhido. */
const jira = { items: [], loading: false, error: null, key: "" };
const bg = (type, payload = {}) => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage({ type, payload }, (res) => {
    const err = chrome.runtime.lastError?.message;
    if (err || !res) return reject(new Error(err || "Sem resposta da extensão."));
    res.ok ? resolve(res.data) : reject(new Error(res.error));
  });
});
const view = { tab: "mine", type: "all" };

const fromDate = () => {
  const p = $("mtgPeriod").value;
  return p === "all" ? "" : iso(new Date(Date.now() - (Number(p) - 1) * 864e5));
};

/** Reuniões no período e no tipo escolhidos: as que você marcou e as reconhecidas no Jira. */
function rows() {
  const from = fromDate();
  const linked = new Set(data.list.map((m) => m.jiraKey).filter(Boolean));   // já marcadas aqui: não repete
  return [...data.list, ...jira.items.filter((m) => !linked.has(m.jiraKey))].filter((m) => (!from || m.date >= from) && (view.type === "all" || m.type === view.type || (view.type.startsWith("g:") && groupOfType(m.type) === view.type.slice(2))));
}

/* ------------------------------------------------------------------ */
/* Abas e filtros                                                      */
/* ------------------------------------------------------------------ */

function paintTabs() {
  document.querySelectorAll(".hist-tabs [data-tab]").forEach((b) => {
    const on = b.dataset.tab === view.tab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  });
  $("mtgTypes").hidden = view.tab === "log";
  $("mtgCsv").textContent = view.tab === "log" ? "Exportar alterações" : "Exportar CSV";
}

function paintTypes() {
  const types = $("mtgTypes");
  types.innerHTML = "";
  const groups = Object.entries(MEETING_GROUPS).map(([g, x]) => [`g:${g}`, { label: x.label, color: g === "execucao" ? "#4bce97" : "#fea362", group: true }]);
  for (const [k, t] of [["all", { label: "Todos", color: "#e3e8ee" }], ...groups, ...Object.entries(MEETING_TYPES)]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `mtg-filter${view.type === k ? " on" : ""}${t.group ? " grp" : ""}`;
    b.setAttribute("aria-pressed", String(view.type === k));
    b.innerHTML = `<i></i>${t.label}`;
    b.querySelector("i").style.background = t.color;
    if (view.type === k) { b.style.borderColor = t.color; b.style.background = rgba(t.color, 0.14); }
    b.addEventListener("click", () => { view.type = k; render(); });
    types.appendChild(b);
  }
}

/* ------------------------------------------------------------------ */
/* Resumo: uma frase e uma barra com o tempo por tipo                  */
/* ------------------------------------------------------------------ */

function paintSummary(items) {
  const sum = $("mtgSum");
  sum.innerHTML = "";
  if (view.tab === "log" || !items.length) return;
  const total = items.reduce((s, m) => s + m.end - m.start, 0);
  const days = new Set(items.map((m) => m.date)).size;
  const byType = Object.keys(MEETING_TYPES).map((k) => {
    const l = items.filter((m) => m.type === k);
    return { k, n: l.length, min: l.reduce((s, m) => s + m.end - m.start, 0) };
  }).filter((x) => x.n);
  const top = [...byType].sort((a, b) => b.min - a.min)[0];
  const made = items.filter((m) => m.jiraKey && !m.fromJira).length;
  const found = items.filter((m) => m.fromJira).length;

  const p = document.createElement("p");
  p.className = "hist-sentence";
  p.textContent = `Você passou ${fmtMin(total)} em ${items.length} ${items.length === 1 ? "registro" : "registros"} de reuniões e execução, em ${days} ${days === 1 ? "dia" : "dias"} (média de ${fmtMin(total / days)} por dia).`
    + (byType.length > 1 ? ` ${tOf(top.k).label} foi o que mais tomou tempo.` : "")
    + (made ? ` ${made} ${made === 1 ? "virou demanda" : "viraram demanda"} no Jira.` : "")
    + (found ? ` ${found} ${found === 1 ? "veio" : "vieram"} de demandas do Jira (reuniões, deploys ou configurações).` : "");
  const bar = document.createElement("div");
  bar.className = "hist-bar-type";
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", byType.map((x) => `${tOf(x.k).label}: ${fmtMin(x.min)}`).join(", "));
  const legend = document.createElement("div");
  legend.className = "hist-legend";
  for (const x of byType) {
    const seg = document.createElement("span");
    seg.style.flexGrow = String(x.min);
    seg.style.background = tOf(x.k).color;
    bar.appendChild(seg);
    const l = document.createElement("span");
    l.innerHTML = `<i></i><b></b><small></small>`;
    l.querySelector("i").style.background = tOf(x.k).color;
    l.querySelector("b").textContent = tOf(x.k).label;
    l.querySelector("small").textContent = `${fmtMin(x.min)}, ${x.n}×`;
    legend.appendChild(l);
  }
  sum.append(p, bar, legend);
}

/* ------------------------------------------------------------------ */
/* Lista por dia, com a faixa do dia                                   */
/* ------------------------------------------------------------------ */

/** Faixa 8h–19h (ou mais, se precisar) com os blocos do dia: dá para ver o dia de relance. */
function dayStrip(ms) {
  const lo = Math.min(8 * 60, ...ms.map((m) => Math.floor(m.start / 60) * 60));
  const hi = Math.max(19 * 60, ...ms.map((m) => Math.ceil(m.end / 60) * 60));
  const span = hi - lo;
  const s = document.createElement("div");
  s.className = "hist-strip";
  s.setAttribute("aria-hidden", "true");
  for (let h = lo + 60; h < hi; h += 60) {
    const g = document.createElement("i");
    g.style.left = `${((h - lo) / span) * 100}%`;
    if (h % 180 === 0) g.dataset.h = `${h / 60}h`;
    s.appendChild(g);
  }
  for (const m of ms) {
    const b = document.createElement("span");
    b.style.left = `${((m.start - lo) / span) * 100}%`;
    b.style.width = `${Math.max(0.8, ((m.end - m.start) / span) * 100)}%`;
    b.style.background = tOf(m.type).color;
    s.appendChild(b);
  }
  return s;
}

function renderDays(items) {
  const list = $("mtgList");
  const byDay = new Map();
  for (const m of items) (byDay.get(m.date) || byDay.set(m.date, []).get(m.date)).push(m);
  for (const day of [...byDay.keys()].sort().reverse()) {
    const ms = byDay.get(day).sort((a, b) => a.start - b.start);
    const group = document.createElement("section");
    group.className = "hist-day";
    const head = document.createElement("header");
    head.innerHTML = `<b></b><span></span>`;
    head.querySelector("b").textContent = dayLabel(day);
    head.querySelector("span").textContent = `${fmtMin(ms.reduce((s, m) => s + m.end - m.start, 0))}, ${ms.length} ${ms.length === 1 ? "item" : "itens"}`;
    group.append(head, dayStrip(ms));
    for (const m of ms) {
      const t = tOf(m.type);
      const row = document.createElement("div");
      row.className = "hist-item";
      row.innerHTML = `<time></time><i class="mark"></i><div class="txt"><b></b><small></small></div><span class="acts"></span>`;
      row.querySelector("time").innerHTML = `${hhmm(m.start)}<small>${hhmm(m.end)}</small>`;
      row.querySelector(".mark").style.background = t.color;
      row.querySelector(".txt b").textContent = m.title;
      const meta = [t.label, fmtMin(m.end - m.start), m.fromJira ? `reconhecida ${byLabel(m.by)} da demanda${m.category ? ` (Categoria: ${m.category})` : ""}` : null].filter(Boolean);
      row.querySelector(".txt small").textContent = meta.join(", ");
      if (m.desc) { const d = document.createElement("p"); d.textContent = m.desc; row.querySelector(".txt").appendChild(d); }
      const acts = row.querySelector(".acts");
      if (m.jiraKey) {
        const a = document.createElement("a");
        a.className = "jira"; a.href = m.jiraUrl || "#"; a.target = "_blank"; a.rel = "noopener";
        a.textContent = m.jiraKey;
        a.title = "Abrir a demanda no Jira";
        acts.appendChild(a);
      }
      if (!m.fromJira) {
        const del = document.createElement("button");
        del.className = "del"; del.type = "button"; del.textContent = "Excluir";
        del.setAttribute("aria-label", `Excluir ${m.title}`);
        del.addEventListener("click", async () => {
          if (!confirm(`Excluir "${m.title}" de ${dayLabel(m.date)}?`)) return;
          await deleteMeeting(m.id);
          await refresh();
        });
        acts.appendChild(del);
      }
      group.appendChild(row);
    }
    list.appendChild(group);
  }
}

/** Alterações no período, as mais recentes primeiro. */
function changes() {
  const from = fromDate();
  return meetingLog().map((e) => ({ ...e, who: "Você" })).filter((e) => !from || iso(new Date(e.at)) >= from).sort((a, b) => b.at - a.at);
}

function renderLog() {
  const list = $("mtgList");
  const all = changes();
  if (!all.length) {
    list.innerHTML = `<p class="mtg-empty">Nenhuma alteração neste período. Cada vez que você marca, muda de horário, edita ou exclui uma reunião, aparece aqui.</p>`;
    return;
  }
  const byDay = new Map();
  for (const e of all) { const d = iso(new Date(e.at)); (byDay.get(d) || byDay.set(d, []).get(d)).push(e); }
  for (const [day, es] of byDay) {
    const group = document.createElement("section");
    group.className = "hist-day";
    const head = document.createElement("header");
    head.innerHTML = `<b></b><span></span>`;
    head.querySelector("b").textContent = dayLabel(day);
    head.querySelector("span").textContent = `${es.length} ${es.length === 1 ? "alteração" : "alterações"}`;
    group.appendChild(head);
    for (const e of es) {
      const r = document.createElement("div");
      r.className = `hist-chg mine act-${e.action.replace(/\s+/g, "-")}`;
      r.innerHTML = `<time></time><i></i><span></span>`;
      const d = new Date(e.at);
      r.querySelector("time").textContent = hhmm(d.getHours() * 60 + d.getMinutes());
      r.querySelector("i").style.background = tOf(e.type).color;
      r.querySelector("span").textContent = describeChange(e) + (e.date && e.date !== day ? `, na linha de ${dayLabel(e.date)}` : "");
      r.title = ago(e.at);
      group.appendChild(r);
    }
    list.appendChild(group);
  }
}

function render() {
  if (!$("mtgList")) return;
  paintTabs();
  paintTypes();
  const list = $("mtgList");
  list.innerHTML = "";
  if (view.tab === "log") { paintSummary([]); renderLog(); return; }
  const items = rows();
  paintSummary(items);
  if (jira.loading || jira.error) {
    const p = document.createElement("p");
    p.className = "mtg-empty";
    p.textContent = jira.loading ? "Procurando nas suas demandas do Jira as que foram reuniões, deploys ou configurações…" : `Não deu para ler as demandas do Jira: ${jira.error}`;
    list.appendChild(p);
  }
  if (!items.length) {
    if (jira.loading) return;
    list.insertAdjacentHTML("beforeend", `<p class="mtg-empty">Nada marcado neste período. Arraste a bolinha + da linha do tempo até o horário da reunião, ou comece por um modelo.</p>`);
    return;
  }
  renderDays(items);
}

/* ------------------------------------------------------------------ */
/* Modelos                                                             */
/* ------------------------------------------------------------------ */

const DURS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
function renderTemplates() {
  const box = $("tplList");
  if (!box) return;
  box.innerHTML = "";
  const list = meetingTemplates();
  $("tplReset").textContent = `Voltar aos modelos do ${roleLabel() || "perfil"}`;
  if (!list.length) box.innerHTML = `<p class="mtg-empty">Nenhum modelo. Use “Novo modelo” ou “Salvar como modelo” no + da linha do tempo.</p>`;
  const update = async (i, patch) => {
    const next = meetingTemplates().map((t, j) => (j === i ? { ...t, ...patch } : t));
    await saveTemplates(next);
  };
  list.forEach((t, i) => {
    const row = document.createElement("div");
    row.className = "tpl-row";
    row.style.setProperty("--tc", tOf(t.type).color);
    row.innerHTML = `
      <input class="inp tpl-name" aria-label="Nome do modelo" maxlength="60" />
      <select class="inp tpl-type" aria-label="Tipo">${Object.entries(MEETING_TYPES).map(([k, x]) => `<option value="${k}">${x.label}</option>`).join("")}</select>
      <select class="inp tpl-dur" aria-label="Duração">${DURS.map((d) => `<option value="${d}">${fmtMin(d)}</option>`).join("")}</select>
      <label class="tpl-jira" title="Cria a demanda no Jira ao salvar"><input type="checkbox" /><span>Jira</span></label>
      <span class="tpl-moves">
        <button type="button" class="ic" data-up aria-label="Subir">↑</button>
        <button type="button" class="ic" data-down aria-label="Descer">↓</button>
        <button type="button" class="ic del" data-rm aria-label="Remover modelo">✕</button>
      </span>
      <input class="inp tpl-desc" aria-label="Descrição que já vem preenchida" maxlength="280" placeholder="Descrição que já vem preenchida (opcional)" />`;
    const q = (s) => row.querySelector(s);
    q(".tpl-name").value = t.name;
    q(".tpl-type").value = t.type;
    if (!DURS.includes(Number(t.dur))) q(".tpl-dur").insertAdjacentHTML("afterbegin", `<option value="${t.dur}">${fmtMin(t.dur)}</option>`);
    q(".tpl-dur").value = String(t.dur);
    q(".tpl-jira input").checked = !!t.jira;
    q(".tpl-desc").value = t.desc || "";
    q(".tpl-name").addEventListener("change", (e) => { const v = e.target.value.trim() || tOf(t.type).label; update(i, { name: v, title: v }); });
    q(".tpl-type").addEventListener("change", (e) => update(i, { type: e.target.value }));
    q(".tpl-dur").addEventListener("change", (e) => update(i, { dur: Number(e.target.value) }));
    q(".tpl-jira input").addEventListener("change", (e) => update(i, { jira: e.target.checked }));
    q(".tpl-desc").addEventListener("change", (e) => update(i, { desc: e.target.value.trim() }));
    const move = async (d) => {
      const next = [...meetingTemplates()];
      const j = i + d;
      if (j < 0 || j >= next.length) return;
      [next[i], next[j]] = [next[j], next[i]];
      await saveTemplates(next);
    };
    q("[data-up]").disabled = i === 0;
    q("[data-down]").disabled = i === list.length - 1;
    q("[data-up]").addEventListener("click", () => move(-1));
    q("[data-down]").addEventListener("click", () => move(1));
    q("[data-rm]").addEventListener("click", () => saveTemplates(meetingTemplates().filter((_, j) => j !== i)));
    box.appendChild(row);
  });
}

/* ------------------------------------------------------------------ */

function csv() {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  let rowsOut;
  if (view.tab === "log") {
    rowsOut = [["Quando", "Quem", "Ação", "Tipo", "Título", "Dia da reunião", "Início", "Fim", "Detalhe"],
      ...changes().map((e) => [new Date(e.at).toLocaleString("pt-BR"), e.who, e.action, tOf(e.type).label, e.title, e.date, hhmm(e.start), hhmm(e.end), e.detail || ""])];
  } else {
    rowsOut = [["Data", "Pessoa", "Tipo", "Título", "Início", "Fim", "Minutos", "Jira", "Descrição"],
      ...rows().sort((a, b) => (a.date + hhmm(a.start)).localeCompare(b.date + hhmm(b.start)))
        .map((m) => [m.date, "Você", tOf(m.type).label, m.title, hhmm(m.start), hhmm(m.end), m.end - m.start, m.jiraKey || "", m.desc || ""])];
  }
  const blob = new Blob(["﻿" + rowsOut.map((r) => r.map(q).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${view.tab === "log" ? "alteracoes" : "reunioes"}-quickfill-${iso(new Date())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Lê do Jira (só leitura) as suas demandas que foram reuniões no período escolhido. */
async function loadJira() {
  const to = iso(new Date());
  const from = fromDate() || iso(new Date(Date.now() - 179 * 864e5));   // "Tudo": até 6 meses
  const key = `${from}|${to}`;
  if (jira.key === key && !jira.error) return;
  jira.key = key; jira.loading = true; jira.error = null;
  render();
  try {
    const r = await bg("MY_MEETINGS", { from, to });
    if (jira.key !== key) return;
    jira.items = r.items || [];
  } catch (e) {
    if (jira.key !== key) return;
    jira.items = []; jira.error = e.message;
  }
  jira.loading = false;
  render();
}

async function refresh() {
  data = await loadMeetings();
  render(); renderTemplates();
}

async function init() {
  if (!$("reunioes")) return;
  const s = await chrome.storage.sync.get(MEETING_DEFAULTS);
  $("mtgDot").checked = s.meetingsDot !== false;
  $("mtgGoal").checked = s.meetingsGoal !== false;
  $("mtgDur").value = String(s.meetingsDur || 30);
  $("mtgDot").addEventListener("change", (e) => chrome.storage.sync.set({ meetingsDot: e.target.checked }));
  $("mtgGoal").addEventListener("change", (e) => chrome.storage.sync.set({ meetingsGoal: e.target.checked }));
  $("mtgDur").addEventListener("change", (e) => chrome.storage.sync.set({ meetingsDur: Number(e.target.value) }));
  $("mtgPeriod").addEventListener("change", () => { render(); loadJira(); });
  $("mtgCsv").addEventListener("click", csv);
  document.querySelectorAll(".hist-tabs [data-tab]").forEach((b) => b.addEventListener("click", () => {
    view.tab = b.dataset.tab;
    render();
  }));
  $("tplAdd").addEventListener("click", async () => {
    const t = { id: `t${Date.now().toString(36)}`, name: "Novo modelo", type: "alinhamento", dur: 15, title: "Novo modelo", desc: "", jira: false, sp: null, status: "done" };
    await saveTemplates([...meetingTemplates(), t]);
    renderTemplates();
    const names = document.querySelectorAll("#tplList .tpl-name");
    names[names.length - 1]?.select();
  });
  $("tplReset").addEventListener("click", async () => {
    if (!confirm(`Trocar os seus modelos pelos modelos do ${roleLabel() || "perfil"}?`)) return;
    await resetTemplates();
    renderTemplates();
  });
  await refresh();
  loadJira();
  onMeetingsChange((d) => {
    data = d;
    // não redesenha os modelos enquanto alguém digita num deles
    if (!$("tplList").contains(document.activeElement)) renderTemplates();
    render();
  });
  const hash = location.hash.slice(1);
  if (["reunioes", "modelos", "historico"].includes(hash)) $(hash).scrollIntoView();
}

init();
