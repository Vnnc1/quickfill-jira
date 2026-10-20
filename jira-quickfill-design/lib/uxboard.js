/* QuickFill DESIGN — espaço UX: quadro, entregas (item do UX → HU), demanda e progresso.
 * Funções puras: recebem o que o background leu do Jira e devolvem o que cada aba mostra. */

import { addDaysIso } from "./dates.js";

const DAY = 24 * 60 * 60 * 1000;
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const isoOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Colunas do quadro UX, na ordem do quadro. */
export const UX_COLS = [
  { id: "pend", label: "Itens pendentes", color: "#8590a2" },
  { id: "info", label: "Aguardando informações", color: "#f5cd47" },
  { id: "doing", label: "Em andamento", color: "#579dff" },
  { id: "appr", label: "Aguardando aprovação", color: "#fea362" },
  { id: "done", label: "Feito nesta semana", color: "#4bce97" },
];

/** Coluna pelo status: nome primeiro (aguardando…), depois a categoria. */
export function uxCol(name, cat) {
  const n = norm(name);
  if (cat === "done") return "done";
  if (/aguard\w* (de |por )?inform|aguard\w* info|pendente de inform/.test(n)) return "info";
  if (/aprova/.test(n)) return "appr";
  if (cat === "new") return "pend";
  return "doing";
}

/** Tipos de item do UX (chip colorido), pelo título e pelo tipo de issue. */
export const UX_TYPES = {
  hu: { label: "HU", color: "#9f8fef" },
  proto: { label: "Protótipo", color: "#e774bb" },
  mob: { label: "Mobile Admin", color: "#6cc3e0" },
  doc: { label: "Documentação", color: "#f5cd47" },
  meet: { label: "Reunião", color: "#8590a2" },
  spec: { label: "Especificação", color: "#fea362" },
  other: { label: "Ajuste", color: "#94a3b4" },
};

export function uxType(summary, issueType = "") {
  const s = norm(summary), t = norm(issueType);
  if (/mobile admin/.test(s)) return "mob";
  if (/reuniao|planning|retro|refinamento|alinhamento|daily|weekly/.test(s)) return "meet";
  if (/especificac/.test(s)) return "spec";
  if (/^hu\b|^hu[:\s-]|historia de usuario/.test(s) || /^hu$|historia|story/.test(t)) return "hu";
  if (/prototip/.test(s)) return "proto";
  if (/document|folder|manual|apresentac/.test(s)) return "doc";
  return "other";
}

/** Título sem prefixos ("Protótipo - ", "HU: ") para achar o par no MEED pelo nome. */
export function baseTitle(s) {
  return norm(s).replace(/^(prototipo|hu|historia de usuario|layout|tela)\s*[-:–]\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** "Do cliente": etiqueta, componente ou título com tiflux. */
export const isClient = (hu) => [...(hu.labels || []), ...(hu.components || []), hu.summary].some((x) => /tiflux/i.test(String(x || "")));

/** HU que provavelmente não tem tela (backend, infra, integração). */
export const noScreen = (summary) => /backend|back-end|micro ?servi|bucket|armazenamento|\bapi\b|infra|integra[cç]|auditoria|analytics|\bbff\b|for frontend|migra[cç]|banco de dados|log(s)? de|webhook|job|fila de processamento/i.test(String(summary || ""));

/** Segunda-feira da semana de `iso`. */
export function mondayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDaysIso(iso, -dow);
}

const ageDays = (ms, now) => (ms ? Math.max(0, Math.floor((now - ms) / DAY)) : 0);

/**
 * Frentes = épicos (pai) dos itens do UX. Esconde as das Opções (ex.: Instagram) e as sem item aberto.
 */
export function uxFronts(items, hidden = []) {
  const hide = hidden.map(norm).filter(Boolean);
  const map = new Map();
  for (const i of items) {
    if (!i.front) continue;
    if (hide.some((h) => norm(i.front).includes(h))) continue;
    const f = map.get(i.front) || { name: i.front, open: 0 };
    if (i.col !== "done") f.open++;
    map.set(i.front, f);
  }
  return [...map.values()].filter((f) => f.open > 0).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
}

/** Itens normalizados: coluna, tipo, idade na coluna e se a Frente está oculta. */
export function uxItems(data, { hiddenFronts = [] } = {}) {
  const hide = hiddenFronts.map(norm).filter(Boolean);
  return (data.items || []).map((i) => ({
    ...i,
    col: uxCol(i.status?.name, i.status?.cat),
    t: uxType(i.summary, i.type),
    age: ageDays(i.statusAt || i.created, data.now),
    hiddenFront: !!i.front && hide.some((h) => norm(i.front).includes(h)),
  })).filter((i) => !i.hiddenFront);
}

/** Aba Quadro: colunas, números do topo e o que precisa de atenção. */
export function uxBoard(data, { front = "", hiddenFronts = [], staleInfo = 7 } = {}) {
  const now = data.now;
  const week = mondayOf(data.today);
  const all = uxItems(data, { hiddenFronts });
  const items = all.filter((i) => !front || i.front === front);
  const cols = UX_COLS.map((c) => {
    let list = items.filter((i) => i.col === c.id);
    if (c.id === "done") list = list.filter((i) => i.doneAt && isoOf(i.doneAt) >= week).sort((a, b) => b.doneAt - a.doneAt);
    else list.sort((a, b) => b.age - a.age);
    return { ...c, items: list };
  });
  const huByName = new Map((data.hus || []).filter((h) => !h.uxLinked).map((h) => [baseTitle(h.summary), h]));
  const alerts = [];
  for (const i of items) {
    if (i.col === "info" && i.age >= staleInfo) {
      alerts.push({ kind: "ask", item: i, age: i.age, why: `Aguardando informações há ${i.age} dias${i.waitBy ? ` · moveu: ${i.waitBy.name}` : ""}` });
    }
    if (i.col !== "done" && !(i.links || []).length) {
      const pair = huByName.get(baseTitle(i.summary));
      if (pair) alerts.push({ kind: "link", item: i, hu: pair, age: i.age, why: `Mesmo nome de ${pair.key} (${pair.status?.name || "aberta"}), mas sem vínculo` });
    }
  }
  alerts.sort((a, b) => b.age - a.age);
  return { cols, alerts, fronts: uxFronts(all, hiddenFronts), total: items.filter((i) => i.col !== "done").length };
}

/** Etapa da HU ligada: Pronto Para Desenvolvimento, em desenvolvimento, implementada ou parada no backlog. */
export function huStage(hu) {
  const n = norm(hu?.status?.name);
  if (hu?.status?.cat === "done") return "live";
  if (/pronto (para|p\/) ?(o )?desenv|ready for dev/.test(n)) return "ready";
  if (hu?.status?.cat === "new") return "wait";
  return "dev";
}

export const HANDOFF_GROUPS = [
  { id: "wait", label: "Protótipo pronto, HU ainda em Itens Pendentes", color: "#f5cd47", tone: "warn", note: "Feitos e ainda sem ninguém do dev. Bom levar para o refinamento." },
  { id: "ready", label: "Pronto Para Desenvolvimento", color: "#9f8fef" },
  { id: "dev", label: "Em desenvolvimento", color: "#579dff" },
  { id: "live", label: "Implementados", color: "#4bce97" },
];

/** Aba Entregas: cada item do UX ligado a uma HU e onde a HU está. */
export function uxHandoff(data, { hiddenFronts = [], liveDays = 30 } = {}) {
  const now = data.now;
  const hus = new Map((data.linked || []).map((h) => [h.key, h]));
  const rows = [];
  for (const i of uxItems(data, { hiddenFronts })) {
    for (const l of i.links || []) {
      const hu = hus.get(l.key);
      if (!hu) continue;
      const stage = huStage(hu);
      if (stage === "wait" && i.col !== "done") continue;              // protótipo ainda em andamento: não é entrega
      if (stage === "live" && hu.resolvedAt && now - hu.resolvedAt > liveDays * DAY) continue;
      rows.push({ ux: i, hu, link: l.type, stage, age: stage === "wait" ? ageDays(i.doneAt || i.statusAt, now) : 0 });
    }
  }
  const groups = HANDOFF_GROUPS.map((g) => ({ ...g, items: rows.filter((r) => r.stage === g.id).sort((a, b) => b.age - a.age) }));
  const ready = (data.hus || []).filter((h) => huStage(h) === "ready" && !h.uxLinked && !noScreen(h.summary));
  return { groups, noProto: ready };
}

/** Aba Demanda: HUs do MEED em Itens Pendentes sem item no UX. */
export const DEMAND_FILTERS = [
  { id: "client", label: "Do cliente" },
  { id: "screen", label: "Todas com tela" },
  { id: "pair", label: "Sem vínculo" },
  { id: "noscreen", label: "Provável sem tela" },
];

export function uxDemand(data, { filter = "client", skipped = [] } = {}) {
  const now = data.now;
  const skip = new Set(skipped);
  const uxByName = new Map(uxItems(data).filter((i) => !(i.links || []).length).map((i) => [baseTitle(i.summary), i]));
  const base = (data.hus || []).filter((h) => huStage(h) === "wait" && !h.uxLinked).map((h) => ({
    ...h,
    age: ageDays(h.created, now),
    client: isClient(h),
    noScreen: noScreen(h.summary),
    pair: uxByName.get(baseTitle(h.summary)) || null,
  }));
  const counts = {
    total: base.filter((h) => !h.noScreen && !skip.has(h.key)).length,
    client: base.filter((h) => h.client && !h.noScreen && !skip.has(h.key)).length,
    noScreen: base.filter((h) => h.noScreen).length,
    pair: base.filter((h) => h.pair).length,
  };
  const pick = {
    client: (h) => h.client && !h.noScreen,
    screen: (h) => !h.noScreen,
    pair: (h) => !!h.pair,
    noscreen: (h) => h.noScreen,
  }[filter] || (() => true);
  const list = base.filter(pick).filter((h) => filter === "noscreen" || filter === "any" || !skip.has(h.key)).sort((a, b) => b.age - a.age);
  return { list, counts, skippedCount: base.filter((h) => skip.has(h.key)).length };
}

/** Aba Progresso: itens feitos por semana, horas por tipo e HUs prototipadas por mês. */
export function uxProgress(data, { weeks = 9, goal = 8, hiddenFronts = [], meId = null } = {}) {
  const items = uxItems(data, { hiddenFronts }).filter((i) => !meId || i.doneBy === meId || i.assignee?.id === meId);
  const done = items.filter((i) => i.doneAt);
  const week = mondayOf(data.today);
  const series = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const ws = addDaysIso(week, -7 * k), we = addDaysIso(ws, 6);
    const list = done.filter((i) => { const d = isoOf(i.doneAt); return d >= ws && d <= we; });
    series.push({ week: ws, count: list.length, minutes: list.reduce((s, i) => s + (i.spent || 0), 0), current: k === 0 });
  }
  const from30 = data.now - 30 * DAY;
  const recent = done.filter((i) => i.doneAt >= from30);
  const mix = Object.keys(UX_TYPES).map((t) => {
    const list = recent.filter((i) => i.t === t);
    return { t, ...UX_TYPES[t], n: list.length, minutes: list.reduce((s, i) => s + (i.spent || 0), 0) };
  }).filter((m) => m.n).sort((a, b) => b.minutes - a.minutes || b.n - a.n);
  const months = [];
  const [y, m] = data.today.split("-").map(Number);
  for (let k = 5; k >= 0; k--) {
    const dt = new Date(y, m - 1 - k, 1);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    const n = done.filter((i) => (i.links || []).length && isoOf(i.doneAt).startsWith(key)).length;
    months.push({ key, label: dt.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), n, current: k === 0 });
  }
  const leads = done.map((i) => (i.startedAt && i.doneAt > i.startedAt ? i.doneAt - i.startedAt : null)).filter(Boolean).sort((a, b) => a - b);
  const median = leads.length ? leads[Math.floor(leads.length / 2)] : null;
  const p90 = leads.length ? leads[Math.min(leads.length - 1, Math.floor(leads.length * 0.9))] : null;
  return {
    series, mix, months, goal,
    thisWeek: series[series.length - 1],
    minutes30: recent.reduce((s, i) => s + (i.spent || 0), 0),
    medianDays: median != null ? Math.max(1, Math.round(median / DAY)) : null,
    p90Days: p90 != null ? Math.max(1, Math.round(p90 / DAY)) : null,
    linkedTotal: done.filter((i) => (i.links || []).length).length,
  };
}

/** Aba Hoje (parte do UX): em andamento seu, o que chegou para a Design e o feito hoje. */
export function uxToday(data, { hiddenFronts = [], arrivedDays = 7 } = {}) {
  const items = uxItems(data, { hiddenFronts });
  const today = data.today;
  return {
    doing: items.filter((i) => i.col === "doing" && i.mine),
    arrived: items.filter((i) => i.col === "pend" && !i.assignee && i.created && data.now - i.created <= arrivedDays * DAY)
      .sort((a, b) => b.created - a.created),
    doneToday: items.filter((i) => i.col === "done" && i.doneAt && isoOf(i.doneAt) === today && (i.mine || i.doneBy === data.me?.accountId)),
  };
}
