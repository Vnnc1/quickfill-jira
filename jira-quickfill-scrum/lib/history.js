/**
 * Histórico da demanda (teste, nos 4 perfis): modal com a linha do tempo horizontal do caminho
 * da demanda no quadro. Etapas em faixas (de cima para baixo), tempo da esquerda para a direita;
 * avanço = linha cheia na cor da etapa, volta = arco tracejado vermelho por cima ("voltou").
 * Os dados vêm do changelog do Jira (ISSUE_HISTORY no serviço).
 */

import { STAGES, isReturn } from "./teamstats.js";

const COLORS = {
  todo: "#8590a2", doing: "#579dff", blocked: "#fea362", feito: "#9f8fef",
  deploy: "#6cc3e0", qa: "#f5cd47", validated: "#7ee2b8", done: "#4bce97",
};
const CORE = ["todo", "doing", "feito", "deploy", "qa", "done"];
const RET = "#f87168";
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const pad = (n) => String(n).padStart(2, "0");
const day = (ms) => { const d = new Date(ms); return `${DOW[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const hour = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dur = (ms) => {
  const h = Math.round(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))}m`;
  const d = Math.floor(h / 24), r = h % 24;
  return d ? (r ? `${d}d ${r}h` : `${d}d`) : `${h}h`;
};
const label = (id) => STAGES.find((s) => s.id === id)?.label || id;
const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let api = { send: null, open: null };
/** send: ponte com o serviço; open(url, e): abre no Jira como o resto do QuickFill. */
export function setHistoryApi(a) { Object.assign(api, a); }

/** Botão "Histórico" para as linhas de demanda (span com role, pode ficar dentro de <button>). */
export function historyButton(key) {
  const b = h("span", "hist-btn");
  b.setAttribute("role", "button");
  b.tabIndex = 0;
  b.title = `Histórico de ${key}: por onde passou no quadro, quando e quem moveu`;
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="6" cy="19" r="2"/><path d="M8 5c6 0 8 3 8 5M16 14c0 2-2 5-8 5"/></svg><span class="hist-txt">Histórico</span>`;
  const go = (e) => { e.preventDefault(); e.stopPropagation(); openHistory(key); };
  b.addEventListener("click", go);
  b.addEventListener("mousedown", (e) => e.stopPropagation());
  b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") go(e); });
  return b;
}

/* ------------------------------------------------------------------ */

export async function openHistory(key) {
  document.querySelector(".hist-modal")?.remove();
  const wrap = h("div", "hist-modal");
  const box = h("div", "hist-box");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", `Histórico de ${key}`);
  box.innerHTML = `<div class="hist-head"><div class="hist-title"><span class="k">${key}</span><b>Carregando o histórico…</b></div><button class="ic" data-x aria-label="Fechar">✕</button></div>`;
  wrap.appendChild(box);
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    if (e.key === "ArrowLeft") wrap.querySelector("[data-prev]")?.click();
    if (e.key === "ArrowRight") wrap.querySelector("[data-next]")?.click();
  };
  document.addEventListener("keydown", onKey, true);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  box.querySelector("[data-x]").addEventListener("click", close);
  try {
    const data = await api.send("ISSUE_HISTORY", { key });
    render(box, data, close);
  } catch (e) {
    box.querySelector(".hist-title b").textContent = `Não deu para carregar: ${e.message}`;
  }
}

function render(box, d, close) {
  // pontos: criação + cada mudança de status
  const nodes = [{ at: d.created, stage: d.createdStage, status: d.createdStatus, title: `Criada em ${d.createdStatus || label(d.createdStage)}`, by: d.createdBy, back: false, note: "" }];
  for (const t of d.transitions) {
    const back = isReturn(t);
    nodes.push({ at: t.at, stage: t.toStage, status: t.toName, from: t.fromName, title: `${t.fromName} → ${t.toName}${back ? " (voltou)" : ""}`, by: t.byName, back, note: t.note });
  }
  nodes.forEach((n, i) => { n.end = i + 1 < nodes.length ? nodes[i + 1].at : d.now; });
  const loops = nodes.filter((n) => n.back).length;
  const people = new Set([d.createdBy, ...d.transitions.map((t) => t.byName)].filter(Boolean)).size;
  const spent = {};
  for (const n of nodes) spent[n.stage] = (spent[n.stage] || 0) + Math.max(0, n.end - n.at);
  const used = new Set(nodes.map((n) => n.stage));
  const lanes = STAGES.filter((s) => CORE.includes(s.id) || used.has(s.id));
  const laneIdx = Object.fromEntries(lanes.map((s, i) => [s.id, i]));
  const color = (id) => COLORS[id] || "#94a3b4";
  const state = { sel: nodes.length - 1, only: false };

  box.innerHTML = "";
  /* cabeçalho */
  const head = h("div", "hist-head");
  const title = h("div", "hist-title");
  const k = h("div", "hist-k");
  k.append(h("span", "k", d.key), h("span", "muted xs", [d.type, d.parentKey && `↳ ${d.parentKey}`].filter(Boolean).join(" · ")));
  title.append(k, h("b", null, d.summary));
  const jira = h("a", "ic hist-jira");
  jira.href = d.url; jira.target = "_blank"; jira.rel = "noopener"; jira.title = "Abrir no Jira"; jira.setAttribute("aria-label", "Abrir no Jira");
  jira.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (api.open) jira.addEventListener("click", (e) => { e.preventDefault(); api.open(d.url, e); });
  const x = h("button", "ic", "✕"); x.setAttribute("aria-label", "Fechar"); x.addEventListener("click", close);
  head.append(title, jira, x);
  box.appendChild(head);

  const top = h("div", "hist-top");
  const chips = h("div", "hist-chips");
  const chip = (txt, strong, cls = "") => { const c = h("span", `chip ${cls}`); c.append(document.createTextNode(txt + " ")); const b = h("b", null, strong); c.appendChild(b); return c; };
  const nowC = chip("agora", d.status.name || label(d.status.stage)); nowC.querySelector("b").style.color = color(d.status.stage);
  chips.append(nowC, chip("criada há", dur(d.now - d.created)), chip(loops === 1 ? "volta" : "voltas", String(loops), loops ? "hot" : ""), chip("pessoas", String(people)));
  top.appendChild(chips);
  const bar = h("div", "hist-bar");
  const total = Object.values(spent).reduce((a, b) => a + b, 0) || 1;
  const legend = h("div", "hist-legend");
  for (const s of lanes.filter((s) => spent[s.id])) {
    const seg = h("i"); seg.style.flex = String(Math.max(1, spent[s.id] / total * 100)); seg.style.background = color(s.id); seg.title = `${s.label}: ${dur(spent[s.id])}`;
    bar.appendChild(seg);
    const lg = h("span"); const sw = h("i"); sw.style.background = color(s.id);
    lg.append(sw, document.createTextNode(`${s.label} `), h("b", null, dur(spent[s.id])));
    legend.appendChild(lg);
  }
  bar.setAttribute("role", "img"); bar.setAttribute("aria-label", "Tempo em cada etapa");
  top.append(bar, legend);
  const tools = h("div", "hist-tools");
  const seg = h("span", "seg");
  const bAll = h("button", "on", "Tudo"), bRet = h("button", null, "Só as voltas");
  seg.append(bAll, bRet);
  tools.append(seg, h("span", "grow"), h("span", "muted xs", "mais antigo à esquerda"));
  top.appendChild(tools);
  box.appendChild(top);

  /* linha do tempo */
  const body = h("div", "hist-body");
  const chart = h("div", "hist-chart");
  const names = h("div", "hist-lanes");
  const RH = 30, TOP = 26, DX = 66, X0 = 24;
  const rowY = (i) => TOP + i * RH + RH / 2;
  const axisY = TOP + lanes.length * RH + 14;
  const H = axisY + 20;
  names.style.height = `${H}px`;
  lanes.forEach((s, i) => {
    const l = h("span", null, s.label); l.style.top = `${TOP + i * RH}px`; l.style.color = color(s.id);
    const sw = h("i"); sw.style.background = color(s.id); l.prepend(sw);
    names.appendChild(l);
  });
  const scroll = h("div", "hist-scroll");
  const W = X0 + (nodes.length - 1) * DX + 34;
  const g = svg("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Caminho de ${d.key} no quadro` });
  lanes.forEach((s, i) => g.appendChild(svg("line", { x1: 0, y1: rowY(i), x2: W, y2: rowY(i), stroke: color(s.id), "stroke-opacity": ".16", "stroke-width": 2 })));
  const pts = nodes.map((n, i) => ({ x: X0 + i * DX, y: rowY(laneIdx[n.stage] ?? 0) }));
  pts.forEach((p) => g.appendChild(svg("line", { x1: p.x, y1: TOP, x2: p.x, y2: axisY - 12, stroke: "#2d353c", "stroke-dasharray": "2 3" })));
  const linkEls = [], dotEls = [], labelEls = [];
  for (let i = 1; i < nodes.length; i++) {
    const a = pts[i - 1], b = pts[i], back = nodes[i].back;
    let dPath;
    if (back) {
      const peak = Math.min(a.y, b.y) - 22 - Math.abs(a.y - b.y) * 0.25;
      dPath = `M${a.x} ${a.y} C${a.x + 6} ${peak} ${b.x - 6} ${peak} ${b.x} ${b.y}`;
      const t = svg("text", { x: (a.x + b.x) / 2, y: peak + 4, "font-size": 10.5, "font-weight": 700, fill: RET, "text-anchor": "middle" });
      t.textContent = "voltou";
      g.appendChild(t);
      labelEls.push([i, t]);
    } else if (a.y === b.y) dPath = `M${a.x} ${a.y} L${b.x} ${b.y}`;
    else dPath = `M${a.x} ${a.y} C${a.x + DX * 0.55} ${a.y} ${b.x - DX * 0.55} ${b.y} ${b.x} ${b.y}`;
    const path = svg("path", { d: dPath, fill: "none", stroke: back ? RET : color(nodes[i].stage), "stroke-width": back ? 2 : 2.5, "stroke-linecap": "round", ...(back ? { "stroke-dasharray": "5 5" } : {}) });
    if (!back) path.classList.add("hist-flow");
    g.appendChild(path);
    linkEls.push([i, path]);
  }
  nodes.forEach((n, i) => {
    const p = pts[i];
    const c = svg("circle", { cx: p.x, cy: p.y, r: 5, fill: "#1b1f23", stroke: n.back ? RET : color(n.stage), "stroke-width": 2.5 });
    c.classList.add("hist-dot");
    const hit = svg("circle", { cx: p.x, cy: p.y, r: 13, fill: "transparent", tabindex: 0 });
    hit.classList.add("hist-hit");
    const tt = svg("title"); tt.textContent = `${n.title} · ${day(n.at)} ${hour(n.at)} · ${n.by}`; hit.appendChild(tt);
    hit.addEventListener("click", () => { state.sel = i; paint(); });
    hit.addEventListener("keydown", (e) => { if (e.key === "Enter") { state.sel = i; paint(); } });
    const t1 = svg("text", { x: p.x, y: axisY, "font-size": 10.5, fill: "#94a3b4", "text-anchor": "middle" }); t1.textContent = day(n.at);
    const t2 = svg("text", { x: p.x, y: axisY + 13, "font-size": 10, fill: "#8593a4", "text-anchor": "middle" }); t2.textContent = hour(n.at);
    g.append(c, hit, t1, t2);
    dotEls.push({ c, t1, n, i });
  });
  scroll.appendChild(g);
  chart.append(names, scroll);
  body.appendChild(chart);

  /* detalhes da ação escolhida */
  const det = h("div", "hist-det");
  const dh = h("div", "hist-det-h");
  const prev = h("button", "ic", "‹"); prev.dataset.prev = ""; prev.setAttribute("aria-label", "Ação anterior");
  const next = h("button", "ic", "›"); next.dataset.next = ""; next.setAttribute("aria-label", "Próxima ação");
  const dt = h("b"), pos = h("span", "muted xs");
  dh.append(prev, dt, pos, next);
  const dw = h("span", "hist-det-w"), dn = h("span", "hist-det-n");
  det.append(dh, dw, dn);
  body.appendChild(det);
  box.appendChild(body);

  const shown = (i) => !state.only || nodes[i].back || (i + 1 < nodes.length && nodes[i + 1].back) || i === 0;
  function paint() {
    const i = state.sel, n = nodes[i], last = i === nodes.length - 1, p = nodes[i - 1];
    dotEls.forEach(({ c, t1, n: m, i: j }) => {
      const on = j === i, isLast = j === nodes.length - 1;
      c.setAttribute("r", on ? 8 : isLast ? 7 : m.back ? 6 : 5);
      c.setAttribute("fill", on || isLast ? color(m.stage) : "#1b1f23");
      c.setAttribute("stroke-width", on ? 3.5 : 2.5);
      c.style.opacity = shown(j) ? 1 : 0.25;
      t1.setAttribute("fill", on ? "#e3e8ee" : "#94a3b4");
      t1.setAttribute("font-weight", on ? 700 : 400);
    });
    linkEls.forEach(([j, path]) => { path.style.opacity = state.only && !nodes[j].back ? 0.2 : 1; });
    labelEls.forEach(([j, t]) => { t.style.opacity = shown(j) ? 1 : 0.25; });
    dt.textContent = n.title + (last ? " · agora" : "");
    dt.style.color = n.back ? RET : "";
    pos.textContent = `${i + 1} de ${nodes.length}`;
    dw.textContent = `${day(n.at)} ${hour(n.at)} · ${n.by || "—"}${p ? ` · ficou ${dur(n.at - p.at)} em ${p.status || label(p.stage)}` : ""}`;
    dn.textContent = n.note ? `“${n.note}”` : last ? `há ${dur(d.now - n.at)} em ${n.status || label(n.stage)}` : "Sem comentário nesta ação.";
    dn.classList.toggle("muted", !n.note);
    det.classList.toggle("back", n.back);
    prev.disabled = i === 0; next.disabled = last;
  }
  prev.addEventListener("click", () => { if (state.sel > 0) { state.sel--; paint(); keepVisible(); } });
  next.addEventListener("click", () => { if (state.sel < nodes.length - 1) { state.sel++; paint(); keepVisible(); } });
  const keepVisible = () => {
    const x = pts[state.sel].x;
    if (x < scroll.scrollLeft + 20 || x > scroll.scrollLeft + scroll.clientWidth - 20) scroll.scrollTo({ left: x - scroll.clientWidth / 2, behavior: "smooth" });
  };
  bAll.addEventListener("click", () => { state.only = false; bAll.classList.add("on"); bRet.classList.remove("on"); paint(); });
  bRet.addEventListener("click", () => { state.only = true; bRet.classList.add("on"); bAll.classList.remove("on"); paint(); });
  paint();
  requestAnimationFrame(() => { scroll.scrollLeft = scroll.scrollWidth; });   // abre no mais recente
}
