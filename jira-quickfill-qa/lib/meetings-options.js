/**
 * Opções › Reuniões e alinhamentos: ajustes (salvam na hora) e o histórico do que foi marcado
 * na linha do tempo, com filtro por tipo e período, totais e exportação em CSV.
 */

import { MEETING_TYPES, MEETING_DEFAULTS, loadMeetings, onMeetingsChange, deleteMeeting, fmtMin, hhmm } from "./meetings.js";

const $ = (id) => document.getElementById(id);
const rgba = (hex, a) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")},${a})`;
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayLabel = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  const w = new Date(y, m - 1, d).getDay();
  return `${DOW[w]} ${pad(d)}/${pad(m)}${s === iso(new Date()) ? ", hoje" : ""}`;
};

let data = { list: [] };
let type = "all";

function filtered() {
  const p = $("mtgPeriod").value;
  const from = p === "all" ? "" : iso(new Date(Date.now() - (Number(p) - 1) * 864e5));
  return data.list.filter((m) => (!from || m.date >= from) && (type === "all" || m.type === type));
}

function render() {
  if (!$("mtgList")) return;
  // filtros por tipo
  const types = $("mtgTypes");
  types.innerHTML = "";
  for (const [k, t] of [["all", { label: "Todos", color: "#e3e8ee" }], ...Object.entries(MEETING_TYPES)]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `mtg-filter${type === k ? " on" : ""}`;
    b.innerHTML = `<i></i>${t.label}`;
    b.querySelector("i").style.background = t.color;
    if (type === k) { b.style.borderColor = t.color; b.style.background = rgba(t.color, 0.14); }
    b.addEventListener("click", () => { type = k; render(); });
    types.appendChild(b);
  }

  // totais por tipo no período
  const p = $("mtgPeriod").value;
  const from = p === "all" ? "" : iso(new Date(Date.now() - (Number(p) - 1) * 864e5));
  const inPeriod = data.list.filter((m) => !from || m.date >= from);
  const sum = $("mtgSum");
  sum.innerHTML = "";
  for (const [k, t] of Object.entries(MEETING_TYPES)) {
    const l = inPeriod.filter((m) => m.type === k);
    const box = document.createElement("div");
    box.innerHTML = `<b></b><span></span><small></small>`;
    box.querySelector("b").textContent = fmtMin(l.reduce((s, m) => s + m.end - m.start, 0));
    box.querySelector("span").textContent = t.label;
    box.querySelector("span").style.color = t.color;
    box.querySelector("small").textContent = `${l.length} ${l.length === 1 ? "registro" : "registros"}`;
    sum.appendChild(box);
  }

  // lista por dia
  const list = $("mtgList");
  list.innerHTML = "";
  const items = filtered();
  if (!items.length) {
    list.innerHTML = `<p class="mtg-empty">Nada marcado neste período. Arraste a bolinha azul da linha do tempo até o horário da reunião.</p>`;
    return;
  }
  const byDay = new Map();
  for (const m of items) (byDay.get(m.date) || byDay.set(m.date, []).get(m.date)).push(m);
  for (const day of [...byDay.keys()].sort().reverse()) {
    const ms = byDay.get(day).sort((a, b) => a.start - b.start);
    const head = document.createElement("div");
    head.className = "mtg-day";
    head.innerHTML = `<span></span><span></span>`;
    head.children[0].textContent = dayLabel(day);
    head.children[1].textContent = fmtMin(ms.reduce((s, m) => s + m.end - m.start, 0));
    list.appendChild(head);
    for (const m of ms) {
      const t = MEETING_TYPES[m.type] || MEETING_TYPES.outro;
      const row = document.createElement("div");
      row.className = "mtg-item";
      row.innerHTML = `<span class="pill"></span><div class="txt"><b></b><small></small></div><button class="del" type="button">Excluir</button>`;
      const pill = row.querySelector(".pill");
      pill.textContent = t.label; pill.style.color = t.color; pill.style.background = rgba(t.color, 0.2);
      row.querySelector("b").textContent = m.title;
      row.querySelector("small").textContent = `${hhmm(m.start)} às ${hhmm(m.end)}, ${fmtMin(m.end - m.start)}`;
      if (m.desc) { const d = document.createElement("p"); d.textContent = m.desc; row.querySelector(".txt").appendChild(d); }
      row.querySelector(".del").addEventListener("click", async () => {
        if (!confirm(`Excluir "${m.title}" de ${dayLabel(m.date)}?`)) return;
        await deleteMeeting(m.id);
        data = await loadMeetings(); render();
      });
      list.appendChild(row);
    }
  }
}

function csv() {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Data", "Tipo", "Título", "Início", "Fim", "Minutos", "Descrição"]];
  for (const m of filtered().sort((a, b) => (a.date + hhmm(a.start)).localeCompare(b.date + hhmm(b.start)))) {
    rows.push([m.date, (MEETING_TYPES[m.type] || MEETING_TYPES.outro).label, m.title, hhmm(m.start), hhmm(m.end), m.end - m.start, m.desc || ""]);
  }
  const blob = new Blob(["﻿" + rows.map((r) => r.map(q).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `reunioes-quickfill-${iso(new Date())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
  $("mtgPeriod").addEventListener("change", render);
  $("mtgCsv").addEventListener("click", csv);
  data = await loadMeetings();
  render();
  onMeetingsChange((d) => { data = d; render(); });
  if (location.hash === "#reunioes") $("reunioes").scrollIntoView();
}

init();
