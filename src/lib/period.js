/**
 * Período dos filtros (Demandas do DEV, Painel/Validação do QA, SCRUM): um só jeito de dizer
 * de onde até onde olhar.
 *
 *   "today"      hoje (o padrão)
 *   "yesterday"  o dia útil anterior (na segunda, a sexta)
 *   "day"        um dia escolhido no calendário
 *   7 | 14 | 30  os últimos N dias, contando hoje
 *   "sprint"     do início da sprint até hoje (ou até o fim dela, se já acabou)
 *
 * Funções puras: recebem hoje, o dia escolhido e a sprint; não leem nada da tela.
 */

import { addDaysIso, isWeekendIso } from "./dates.js";

const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const dow = (d) => { const [y, m, da] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, da)).getUTCDay(); };
export const dayShort = (d) => `${DOW[dow(d)]} ${d.slice(8, 10)}/${d.slice(5, 7)}`;
const brShort = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** O dia útil anterior a `iso` (pula sábado e domingo). */
export function prevBusinessDay(iso) {
  let d = addDaysIso(iso, -1);
  while (isWeekendIso(d)) d = addDaysIso(d, -1);
  return d;
}

const startMs = (iso) => Date.parse(`${iso}T00:00:00`);
const endMs = (iso) => Date.parse(`${iso}T23:59:59.999`);

/** Normaliza o valor salvo ("7", 7, "today"…) para um período conhecido; desconhecido vira "today". */
export function normPeriod(p) {
  if (p === "today" || p === "yesterday" || p === "day" || p === "sprint") return p;
  const n = Number(p);
  return [7, 14, 30].includes(n) ? n : "today";
}

/**
 * Intervalo do período.
 * @returns {{ period, from, to, fromMs, toMs, days, single, now, label, title }}
 *   from/to: ISO (inclusive) · fromMs/toMs: começo do primeiro dia e fim do último (ou agora, se termina hoje)
 *   days: quantos dias corridos · single: um dia só · now: o período inclui hoje
 *   label: para frases ("hoje", "ontem", "em ter 14/10", "em 7 dias", "na sprint")
 *   title: o texto do botão/estado ("Hoje", "Ontem", "ter 14/10", "7 dias", "Sprint 16")
 */
export function periodRange(period, { today, day = "", sprint = null, nowMs = Date.now() } = {}) {
  const p = normPeriod(period);
  let from, to, label, title;
  if (p === "yesterday") { from = to = prevBusinessDay(today); label = `ontem (${dayShort(from)})`; title = "Ontem"; }
  else if (p === "day" && day && day <= today) { from = to = day; label = day === today ? "hoje" : `em ${dayShort(day)}`; title = dayShort(day); }
  else if (p === "sprint" && sprint?.start) {
    from = String(sprint.start).slice(0, 10);
    const end = sprint.end ? String(sprint.end).slice(0, 10) : today;
    to = end < today ? end : today;
    if (from > to) from = to;
    label = `na ${sprint.name || "sprint"} (desde ${brShort(from)})`; title = sprint.name || "Sprint";
  } else if (typeof p === "number") { from = addDaysIso(today, -(p - 1)); to = today; label = `em ${p} dias`; title = `${p} dias`; }
  else { from = to = today; label = "hoje"; title = "Hoje"; }
  const now = to === today;
  const days = Math.round((startMs(to) - startMs(from)) / 86400000) + 1;
  return { period: p === "day" && !(day && day <= today) ? "today" : p === "sprint" && !sprint?.start ? "today" : p,
    from, to, fromMs: startMs(from), toMs: now ? Math.max(nowMs, startMs(to)) : endMs(to),
    days, single: from === to, now, label, title };
}

/** O instante `ms` cai dentro do período? */
export const inRange = (r, ms) => !!ms && ms >= r.fromMs && ms <= r.toMs;
/** O dia ISO cai dentro do período? */
export const dayInRange = (r, iso) => !!iso && iso >= r.from && iso <= r.to;
