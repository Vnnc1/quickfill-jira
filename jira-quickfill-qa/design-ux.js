/* QuickFill DESIGN — telas do espaço UX: Quadro, Entregas, Demanda e as partes do Hoje e do Progresso.
 * O modal.js chama initUx() com os helpers dele (send, toast, jiraLink…). */

import { UX_COLS, UX_TYPES, DEMAND_FILTERS, uxBoard, uxHandoff, uxDemand, uxProgress, uxToday } from "./lib/uxboard.js";

const UX = { data: null, loading: null, front: "", demFilter: "client", closed: { done: true }, done: {}, skipped: [], q: {} };
let D = null;   // helpers do modal

const SKIP_KEY = "qf.ux.semTela";
const PREF_KEY = "qf.ux.prefs";

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmtH = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`; };
const ageColor = (d) => (d >= 30 ? "var(--err)" : d >= 7 ? "var(--warn)" : "var(--muted)");
const ageTxt = (d) => (d ? `${d}d` : "hoje");
const brDate = (ms) => new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

export async function initUx(helpers) {
  D = helpers;
  try {
    const st = await chrome.storage.local.get([SKIP_KEY]);
    UX.skipped = Array.isArray(st[SKIP_KEY]) ? st[SKIP_KEY] : [];
  } catch { /* sem storage */ }
  try { Object.assign(UX, JSON.parse(localStorage.getItem(PREF_KEY) || "{}")); } catch { /* sem storage */ }
}

const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify({ front: UX.front, demFilter: UX.demFilter, closed: UX.closed })); } catch { /* sem storage */ } };

export function uxViewState() { return { front: UX.front, demFilter: UX.demFilter }; }
export function uxApplyViewState(v = {}) { if (v.front !== undefined) UX.front = v.front; if (v.demFilter) UX.demFilter = v.demFilter; }

/** Carrega (ou reaproveita) os dados do UX e redesenha a aba atual. */
export async function loadUx({ force = false, render } = {}) {
  if (!force && UX.data && Date.now() - UX.data.generatedAt < 90 * 1000) { render?.(); return UX.data; }
  if (UX.loading) return UX.loading;
  UX.loading = D.send("UX_BOARD", { force })
    .then((data) => { UX.data = data; render?.(); return data; })
    .catch((e) => { D.toast(e.message); throw e; })
    .finally(() => { UX.loading = null; });
  return UX.loading;
}

export const uxData = () => UX.data;

/* ---------- peças ---------- */

function chip(t) {
  const ty = UX_TYPES[t] || UX_TYPES.other;
  const c = el("span", "ux-chip", ty.label);
  c.style.setProperty("--c", ty.color);
  return c;
}

function keyEl(key, ux = true) {
  const k = el("span", `ux-k${ux ? " ux" : ""}`, key);
  return k;
}

function row({ key, title, sub, ux = true, right = [], dim = false }) {
  const r = el("div", `ux-row${dim ? " dim" : ""}`);
  const body = el("div", "ux-body");
  const line = el("div", "ux-line");
  line.append(keyEl(key, ux), el("span", "ux-ttl", title));
  line.title = `${key} · ${title}`;
  body.append(line);
  if (sub) body.append(el("div", "ux-sub", sub));
  r.append(body, ...right.filter(Boolean), D.jiraLink(key, { label: "" }));
  return r;
}

function age(d, color) {
  const a = el("span", "ux-age", ageTxt(d));
  a.style.color = color || ageColor(d);
  return a;
}

function actBtn(label, fn, { pri = false, title } = {}) {
  const b = el("button", `btn sm${pri ? " primary" : ""}`, label);
  if (title) b.title = title;
  b.addEventListener("click", async (e) => {
    e.stopPropagation();
    b.disabled = true;
    const old = b.textContent;
    b.textContent = "…";
    try { await fn(b); } catch (err) { D.toast(err.message); b.textContent = old; b.disabled = false; }
  });
  return b;
}

function card(title, right, { tone = "" } = {}) {
  const c = el("section", `card ux-card${tone ? ` ${tone}` : ""}`);
  const h = el("div", "ux-card-t");
  h.append(el("b", null, title));
  if (right != null) h.append(el("span", null, right));
  c.append(h);
  return c;
}

function tiles(list, cols) {
  const g = el("div", "ux-tiles");
  g.style.gridTemplateColumns = `repeat(${cols || list.length}, minmax(0, 1fr))`;
  for (const t of list) {
    const d = el("div", "ux-tile");
    const n = el("b", null, String(t.n));
    if (t.c) n.style.color = t.c;
    d.append(n, el("span", null, t.label));
    if (t.tip) d.title = t.tip;
    g.append(d);
  }
  return g;
}

function seg(options, value, onPick, label) {
  const wrap = el("div", "ux-segline");
  if (label) wrap.append(el("span", "ux-lbl", label));
  const s = el("div", "seg");
  for (const o of options) {
    const b = el("button", o.id === value ? "on" : "", o.label);
    if (o.title) b.title = o.title;
    b.addEventListener("click", () => onPick(o.id));
    s.append(b);
  }
  wrap.append(s);
  return wrap;
}

async function act(payload, after) {
  const res = await D.send("UX_ACTION", payload);
  D.toast(res.message, "ok");
  after?.(res);
  loadUx({ force: true, render: D.rerender });
  return res;
}

function empty(box, text) { box.replaceChildren(el("p", "muted xs", text)); }

function header(box, info, rerender) {
  const bar = el("div", "m-tools");
  bar.append(el("span", "muted xs grow", info));
  const r = el("button", "ic bordered", "↻");
  r.title = "Atualizar do Jira";
  r.addEventListener("click", () => loadUx({ force: true, render: D.rerender }));
  bar.append(r);
  box.append(bar);
  if (rerender) box.append(searchBox(box, rerender));
}

/* ---------- busca (por aba) ---------- */

const PLACEHOLDER = {
  uxBoardBox: "Buscar no quadro: chave, título, pessoa, frente ou HU…",
  uxDelivBox: "Buscar nas entregas: item do UX, HU, título ou status…",
  uxDemandBox: "Buscar nas HUs: chave, título, status ou etiqueta…",
};
const normTxt = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const query = (box) => UX.q[box.id] || "";
/** Todas as palavras da busca aparecem em algum dos campos. */
function hit(q, ...parts) {
  if (!q) return true;
  const hay = normTxt(parts.flat().filter(Boolean).join(" "));
  return normTxt(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

function searchBox(box, rerender) {
  const wrap = el("div", "ux-search");
  const inp = el("input", "inp sm search-in");
  inp.type = "search";
  inp.placeholder = PLACEHOLDER[box.id] || "Buscar…";
  inp.value = query(box);
  inp.autocomplete = "off";
  inp.setAttribute("aria-label", inp.placeholder);
  inp.addEventListener("input", () => {
    const pos = inp.selectionStart;
    UX.q[box.id] = inp.value;
    rerender(box);
    const again = box.querySelector(".ux-search input");   // a tela foi redesenhada: devolve o foco
    if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch { /* type=search */ } }
  });
  inp.addEventListener("keydown", (e) => { if (e.key === "Escape" && inp.value) { e.stopPropagation(); inp.value = ""; inp.dispatchEvent(new Event("input")); } });
  wrap.append(inp);
  return wrap;
}

function searchNote(box, n) {
  const q = query(box);
  if (q) box.append(el("p", "muted xs", n ? `${n} ${n === 1 ? "resultado" : "resultados"} para “${q}”` : `Nada encontrado para “${q}”.`));
}

const infoLine = (data) => `Espaço ${data.ux} · atualizado ${new Date(data.generatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}${data.truncated ? " · lista cortada em 600" : ""}`;

/* ---------- Quadro ---------- */

export function renderUxBoard(box) {
  const data = UX.data;
  if (!data) return empty(box, "Carregando o quadro do UX…");
  box.replaceChildren();
  header(box, infoLine(data), renderUxBoard);
  const q = query(box);
  const itemHit = (i) => hit(q, i.key, i.summary, i.front, i.assignee?.name, i.status?.name, (i.links || []).map((l) => l.key), i.waitBy?.name, (UX_TYPES[i.t] || {}).label);
  const b0 = uxBoard(data, { hiddenFronts: data.hiddenFronts });
  if (UX.front && !b0.fronts.some((f) => f.name === UX.front)) UX.front = "";
  const b = UX.front ? uxBoard(data, { front: UX.front, hiddenFronts: data.hiddenFronts }) : b0;

  if (b0.fronts.length > 1) {
    box.append(seg([{ id: "", label: "Todas" }, ...b0.fronts.map((f) => ({ id: f.name, label: f.name, title: `${f.open} abertos` }))],
      UX.front, (id) => { UX.front = id; savePrefs(); renderUxBoard(box); }, "Frente"));
  }

  box.append(tiles(b.cols.map((c) => ({
    n: c.items.length, label: c.id === "done" ? "Feitos na semana" : c.label,
    c: c.id === "done" ? "var(--ok)" : c.id === "doing" ? "var(--data)" : c.id === "info" && c.items.length ? "var(--warn)" : c.items.length ? "" : "var(--faint)",
  }))));

  const alerts = b.alerts.filter((a) => itemHit(a.item) || (a.hu && hit(q, a.hu.key, a.hu.summary)));
  const cols = b.cols.map((c) => ({ ...c, items: c.items.filter(itemHit) }));
  searchNote(box, cols.reduce((n, c) => n + c.items.length, 0));
  if (alerts.length) {
    const c = card("Precisa de atenção", String(alerts.length), { tone: "bad" });
    for (const a of alerts) {
      const did = UX.done[`${a.kind}:${a.item.key}`];
      const btn = a.kind === "ask"
        ? actBtn(did ? "Comentado" : "Cobrar", () => act({ op: "ask", key: a.item.key, mention: a.item.waitBy }, () => { UX.done[`ask:${a.item.key}`] = 1; }),
          { title: `Comenta em ${a.item.key}${a.item.waitBy ? ` mencionando ${a.item.waitBy.name}` : ""}: "Ainda aguardando as informações para seguir. Pode me passar?"` })
        : actBtn(did ? "Ligado" : `Ligar a ${a.hu.key}`, () => act({ op: "link", ux: a.item.key, hu: a.hu.key }, () => { UX.done[`link:${a.item.key}`] = 1; }),
          { title: `Cria o vínculo "relaciona" entre ${a.item.key} e ${a.hu.key}` });
      if (did) btn.disabled = true;
      c.append(row({ key: a.item.key, title: a.item.summary, sub: a.why, dim: !!did, right: [age(a.age), btn] }));
    }
    box.append(c);
  }

  for (const col of cols) {
    if (q && !col.items.length) continue;
    const c = el("section", "card ux-card");
    const open = q ? true : !UX.closed[col.id];
    const h = el("button", "ux-colh");
    const dot = el("i", "ux-dot"); dot.style.background = col.color;
    h.append(dot, el("b", null, col.label), el("span", null, `${col.items.length} ${open ? "▾" : "▸"}`));
    h.addEventListener("click", () => { UX.closed[col.id] = open; savePrefs(); renderUxBoard(box); });
    c.append(h);
    if (open) {
      if (!col.items.length) c.append(el("p", "muted xs", col.id === "appr" ? "Nada esperando aprovação." : "Nada aqui."));
      for (const i of col.items) {
        const sub = [i.front, i.assignee ? i.assignee.name : "sem responsável",
          col.id === "done" ? `feito ${brDate(i.doneAt)}${i.spent ? ` · ${fmtH(i.spent)}` : ""}` : i.spent ? `${fmtH(i.spent)} apontadas` : "",
          (i.links || []).length ? `→ ${i.links.map((l) => l.key).join(", ")}` : ""].filter(Boolean).join(" · ");
        c.append(row({ key: i.key, title: i.summary, sub, right: [chip(i.t), age(i.age, col.id === "done" ? "var(--ok)" : null)] }));
      }
    }
    box.append(c);
  }
}

/* ---------- Entregas ---------- */

export function renderUxDeliveries(box) {
  const data = UX.data;
  if (!data) return empty(box, "Carregando as entregas…");
  box.replaceChildren();
  header(box, infoLine(data), renderUxDeliveries);
  const q = query(box);
  box.append(el("p", "muted xs", `Cada item do UX ligado a uma HU (clona, duplica, relaciona…) e onde essa HU está no ${data.huProject} ou no SUS.`));
  const h0 = uxHandoff(data, { hiddenFronts: data.hiddenFronts });
  const h = {
    groups: h0.groups.map((g) => ({ ...g, items: g.items.filter((r) => hit(q, r.ux.key, r.ux.summary, r.hu.key, r.hu.summary, r.hu.status?.name, r.link)) })),
    noProto: h0.noProto.filter((x) => hit(q, x.key, x.summary, x.status?.name)),
  };
  if (q) searchNote(box, h.groups.reduce((n, g) => n + g.items.length, 0) + h.noProto.length);
  box.append(tiles(h.groups.map((g) => ({ n: g.items.length, label: g.id === "wait" ? "Prontos, HU parada no backlog" : g.label, c: g.color }))));
  for (const g of h.groups) {
    if (q && !g.items.length) continue;
    const c = card(g.label, String(g.items.length), { tone: g.tone || "" });
    const dot = el("i", "ux-dot"); dot.style.background = g.color;
    c.firstChild.prepend(dot);
    if (g.note && g.items.length) c.append(el("p", "muted xs", g.note));
    if (!g.items.length) c.append(el("p", "muted xs", "Nada aqui."));
    for (const r of g.items) {
      const line = el("div", "ux-row");
      const body = el("div", "ux-body");
      const top = el("div", "ux-line");
      top.append(keyEl(r.ux.key), el("span", "ux-arrow", "→"), keyEl(r.hu.key, false), el("span", "ux-ttl", r.hu.summary || r.ux.summary));
      body.append(top, el("div", "ux-sub", [r.hu.status.name, r.link, r.ux.doneAt ? `protótipo feito em ${brDate(r.ux.doneAt)}` : r.ux.status.name].filter(Boolean).join(" · ")));
      line.append(body);
      if (r.age) line.append(age(r.age));
      line.append(D.jiraLink(r.hu.key, { label: "" }));
      c.append(line);
    }
    box.append(c);
  }
  if (q && !h.noProto.length) return;
  const np = card("No dev sem protótipo do UX", String(h.noProto.length), { tone: "warn" });
  np.append(el("p", "muted xs", "HUs em Pronto Para Desenvolvimento sem nenhum item ligado no UX. Vale olhar se têm tela."));
  if (!h.noProto.length) np.append(el("p", "muted xs", "Nenhuma. Tudo que está pronto para o dev tem protótipo ligado."));
  for (const hu of h.noProto.slice(0, 12)) {
    const did = UX.done[`tela:${hu.key}`];
    const btn = actBtn(did ? "Perguntado" : "Tem tela?", () => act({ op: "ask", key: hu.key, text: "Esta HU tem tela nova? Se tiver, abro o protótipo no UX." }, () => { UX.done[`tela:${hu.key}`] = 1; }));
    if (did) btn.disabled = true;
    np.append(row({ key: hu.key, title: hu.summary, ux: false, dim: !!did, right: [btn] }));
  }
  box.append(np);
}

/* ---------- Demanda ---------- */

async function setSkipped(list) {
  UX.skipped = list;
  try { await chrome.storage.local.set({ [SKIP_KEY]: list }); } catch { /* sem storage */ }
}

export function renderUxDemand(box) {
  const data = UX.data;
  if (!data) return empty(box, "Carregando as HUs…");
  box.replaceChildren();
  header(box, infoLine(data), renderUxDemand);
  const q = query(box);
  box.append(el("p", "muted xs", `HUs do ${data.huProject} em Itens Pendentes que ainda não têm item no UX: o que pode chegar para a Design.`));
  const d0 = uxDemand(data, { filter: UX.demFilter, skipped: UX.skipped });
  // Com busca, procura em todas as HUs sem protótipo (qualquer filtro de "Mostrar")
  const d = q ? { ...d0, list: uxDemand(data, { filter: "any", skipped: UX.skipped }).list.filter((h) => hit(q, h.key, h.summary, h.status?.name, h.labels, h.components, h.pair?.key)) } : d0;
  box.append(tiles([
    { n: d.counts.total, label: "HUs sem protótipo" },
    { n: d.counts.client, label: "Do cliente (tiflux)", c: "var(--accent)" },
    { n: d.counts.noScreen, label: "Provável sem tela", c: "var(--faint)" },
    { n: d.counts.pair, label: "Já tem item no UX sem vínculo", c: d.counts.pair ? "var(--warn)" : "var(--faint)" },
  ]));
  box.append(seg(DEMAND_FILTERS, UX.demFilter, (id) => { UX.demFilter = id; savePrefs(); renderUxDemand(box); }, "Mostrar"));
  const title = q ? `Busca em todas as HUs sem protótipo` : { client: "Pedidas pelo cliente (tiflux)", screen: "Todas as HUs com tela", pair: "Item no UX com o mesmo nome, sem vínculo", noscreen: "Provável sem tela (backend, infra, integração)" }[UX.demFilter];
  const c = card(title, String(d.list.length));
  if (!d.list.length && q) c.append(el("p", "muted xs", `Nada encontrado para “${q}”.`));
  else if (!d.list.length) c.append(el("p", "muted xs", UX.demFilter === "client" ? "Nenhuma HU do cliente sem protótipo. Veja \"Todas com tela\"." : "Nada aqui."));
  for (const hu of d.list.slice(0, 40)) {
    const sub = [hu.client ? "tiflux" : "interna", hu.status.name, hu.noScreen ? "parece não ter tela" : "", hu.pair ? `já existe ${hu.pair.key} com o mesmo nome` : "", UX.skipped.includes(hu.key) ? "marcada como sem tela" : ""].filter(Boolean).join(" · ");
    const did = UX.done[`dem:${hu.key}`];
    const right = [age(hu.age)];
    if (did) right.push(el("span", "ux-chip ok", did));
    else {
      right.push(hu.pair
        ? actBtn(`Ligar a ${hu.pair.key}`, () => act({ op: "link", ux: hu.pair.key, hu: hu.key }, () => { UX.done[`dem:${hu.key}`] = `ligado a ${hu.pair.key}`; }), { pri: true })
        : actBtn("Clonar para UX", () => act({ op: "clone", hu: hu.key }, (res) => { UX.done[`dem:${hu.key}`] = `virou ${res.key}`; }), { pri: true, title: `Cria "HU: ${hu.summary}" no ${data.ux}, em Itens pendentes, ligada a ${hu.key}` }));
      if (UX.skipped.includes(hu.key)) {
        right.push(actBtn("Tem tela", async () => { await setSkipped(UX.skipped.filter((k) => k !== hu.key)); renderUxDemand(box); }, { title: "Volta para as listas com tela" }));
      } else if (!hu.noScreen) {
        right.push(actBtn("Sem tela", async () => { await setSkipped([...UX.skipped, hu.key]); D.toast(`${hu.key} marcada como sem tela. Não aparece mais aqui (veja em "Provável sem tela").`, "ok"); renderUxDemand(box); }, { title: "Marcar como sem tela: sai desta lista" }));
      }
    }
    c.append(row({ key: hu.key, title: hu.summary, sub, ux: false, dim: !!did, right }));
  }
  if (d.list.length > 40) c.append(el("p", "muted xs", `e mais ${d.list.length - 40}, das mais antigas para as mais novas`));
  box.append(c);
}

/* ---------- Hoje (parte do UX) ---------- */

export function renderUxToday(box) {
  const data = UX.data;
  if (!box) return;
  if (!data) return empty(box, "Carregando o quadro do UX…");
  box.replaceChildren();
  const t = uxToday(data, { hiddenFronts: data.hiddenFronts });
  const c1 = card("Em andamento agora", `${t.doing.length}`);
  if (!t.doing.length) c1.append(el("p", "muted xs", "Nada em andamento no seu nome. Assuma um item que chegou ou do quadro."));
  for (const i of t.doing) {
    const did = UX.done[`done:${i.key}`];
    const btn = actBtn(did ? "Feito ✓" : "Mover para Feito", () => act({ op: "done", key: i.key }, () => { UX.done[`done:${i.key}`] = 1; }), { pri: true });
    if (did) btn.disabled = true;
    c1.append(row({ key: i.key, title: i.summary, sub: [`desde ${brDate(i.statusAt)}`, i.spent ? `${fmtH(i.spent)} apontadas` : "", i.due ? `vence ${i.due.slice(8, 10)}/${i.due.slice(5, 7)}` : ""].filter(Boolean).join(" · "), right: [chip(i.t), btn] }));
  }
  box.append(c1);
  if (t.arrived.length) {
    const c2 = card("Chegou para a Design", `${t.arrived.length}`, { tone: "warn" });
    for (const i of t.arrived) {
      const did = UX.done[`take:${i.key}`];
      const btn = actBtn(did ? "É sua" : "Assumir", () => act({ op: "take", key: i.key }, () => { UX.done[`take:${i.key}`] = 1; }), { title: "Atribui a você e move para Em andamento" });
      if (did) btn.disabled = true;
      c2.append(row({ key: i.key, title: i.summary, sub: [`criado ${brDate(i.created)}`, (i.links || []).length ? `ligado a ${i.links[0].key}` : "", i.priority, "sem responsável"].filter(Boolean).join(" · "), right: [btn] }));
    }
    box.append(c2);
  }
  if (t.doneToday.length) {
    const mins = t.doneToday.reduce((s, i) => s + (i.spent || 0), 0);
    const c3 = card("Feito hoje", `${t.doneToday.length} ${t.doneToday.length === 1 ? "item" : "itens"}${mins ? ` · ${fmtH(mins)}` : ""}`);
    for (const i of t.doneToday) c3.append(row({ key: i.key, title: i.summary, right: [age(0, "var(--ok)")] }));
    box.append(c3);
  }
}

/* ---------- Progresso (parte do UX) ---------- */

export function renderUxProgress(box) {
  const data = UX.data;
  if (!box) return;
  if (!data) return empty(box, "Carregando o progresso do UX…");
  box.replaceChildren();
  const p = uxProgress(data, { goal: data.goal, hiddenFronts: data.hiddenFronts, meId: data.me?.accountId });
  box.append(tiles([
    { n: p.thisWeek.count, label: `Feitos na semana · meta ${p.goal}`, c: p.thisWeek.count >= p.goal ? "var(--ok)" : "" },
    { n: fmtH(p.thisWeek.minutes), label: "Apontadas nos itens da semana" },
    { n: p.medianDays ? `${p.medianDays} ${p.medianDays === 1 ? "dia" : "dias"}` : "–", label: p.p90Days ? `Tempo típico por item (9 em 10 até ${p.p90Days}d)` : "Tempo típico por item" },
    { n: p.linkedTotal, label: "HUs prototipadas (6 meses)", c: "#9f8fef" },
  ]));
  const max = Math.max(p.goal, ...p.series.map((s) => s.count), 1);
  const c1 = card("Itens feitos por semana", `últimas ${p.series.length} semanas`);
  const bars = el("div", "ux-bars");
  bars.style.gridTemplateColumns = `repeat(${p.series.length}, minmax(0, 1fr))`;
  for (const s of p.series) {
    const b = el("div", `ux-bar${s.count >= p.goal ? " meet" : ""}${s.current ? " cur" : ""}`);
    b.title = `semana de ${s.week.slice(8, 10)}/${s.week.slice(5, 7)}: ${s.count} itens, ${fmtH(s.minutes)}`;
    const i = el("i"); i.style.height = `${Math.round((s.count / max) * 78)}px`;
    b.append(el("b", null, String(s.count)), i, el("span", null, `${s.week.slice(8, 10)}/${s.week.slice(5, 7)}`));
    bars.append(b);
  }
  c1.append(bars, el("div", "ux-legend", `Meta: ${p.goal} itens por semana (ajuste nas Opções) · barra cheia = bateu a meta`));
  box.append(c1);
  if (p.mix.length) {
    const c2 = card("Onde foram as horas", `últimos 30 dias · ${fmtH(p.minutes30)}`);
    const stack = el("div", "ux-stack");
    for (const m of p.mix) { const i = el("i"); i.style.flex = String(m.minutes || m.n); i.style.background = m.color; i.title = `${m.label}: ${fmtH(m.minutes)}`; stack.append(i); }
    const lg = el("div", "ux-legend");
    for (const m of p.mix) { const s = el("span"); const dot = el("i", "ux-dot"); dot.style.background = m.color; s.append(dot, `${m.label} `, el("b", null, fmtH(m.minutes)), ` · ${m.n} ${m.n === 1 ? "item" : "itens"}`); lg.append(s); }
    c2.append(stack, lg);
    box.append(c2);
  }
  const c3 = card("HUs prototipadas por mês");
  const lg = el("div", "ux-legend");
  for (const m of p.months) { const s = el("span"); s.append(`${m.label} `, el("b", null, String(m.n)), m.current ? " até agora" : ""); lg.append(s); }
  c3.append(lg);
  box.append(c3);
}
