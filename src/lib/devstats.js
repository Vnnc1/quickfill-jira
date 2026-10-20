/**
 * QuickFill DEV — números do "meu progresso". Tudo puro (testável no Node).
 *
 * `prog` é a resposta do MY_PROGRESS:
 *   { from, to, workday: { start, end, cap, goal }, skipWeekends,
 *     days: { "YYYY-MM-DD": [{ key, summary, status, statusCategory, parentKey, start, minutes }] } }
 */
import { addDaysIso, isWeekendIso, daysOf, startOfIso, DAY_MS } from "./dates.js";

export const totalOf = (prog, d) => (prog.days[d] || []).reduce((s, e) => s + e.minutes, 0);

/** Dias que contam (úteis, ou todos se o fim de semana não é pulado — fim de semana com apontamento sempre conta). */
export function countedDays(prog, from, to) {
  return daysOf(from, to).filter((d) => !prog.skipWeekends || !isWeekendIso(d) || totalOf(prog, d) > 0);
}

/** Agrupa os apontamentos de um dia por demanda. */
export function byIssue(entries) {
  const map = new Map();
  for (const e of entries) {
    const cur = map.get(e.key) || { key: e.key, summary: e.summary, status: e.status, statusCategory: e.statusCategory,
      parentKey: e.parentKey, project: e.key.split("-")[0], minutes: 0, slots: [] };
    cur.minutes += e.minutes;
    cur.slots.push({ start: e.start, end: e.start + e.minutes });
    map.set(e.key, cur);
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes);
}

/**
 * Sequência de dias batendo a meta que termina em `date`.
 * O dia `date` só entra se já bateu; se ainda não bateu, a sequência "vem de ontem" e continua viva.
 */
export function streakAt(prog, date) {
  const goal = prog.workday.goal;
  let n = 0;
  let d = date;
  const todayMet = totalOf(prog, d) >= goal;
  if (!todayMet) d = addDaysIso(d, -1);
  for (let guard = 0; guard < 400 && d >= prog.from; guard++, d = addDaysIso(d, -1)) {
    if (prog.skipWeekends && isWeekendIso(d) && !totalOf(prog, d)) continue;
    if (totalOf(prog, d) >= goal) n++;
    else break;
  }
  return { days: n, includesToday: todayMet };
}

/** Média dos `n` dias contados antes de `date` (sem contar o próprio dia). */
export function averageBefore(prog, date, n = 10) {
  const list = countedDays(prog, prog.from, addDaysIso(date, -1)).slice(-n);
  if (!list.length) return 0;
  return list.reduce((s, d) => s + totalOf(prog, d), 0) / list.length;
}

/** Quanto, em média, você já tinha apontado até este minuto do dia nos dias anteriores. */
export function averageUntil(prog, date, minuteOfDay, n = 10) {
  const list = countedDays(prog, prog.from, addDaysIso(date, -1)).slice(-n);
  if (!list.length) return 0;
  const sum = list.reduce((s, d) => s + (prog.days[d] || [])
    .reduce((t, e) => t + Math.max(0, Math.min(e.start + e.minutes, minuteOfDay) - e.start), 0), 0);
  return sum / list.length;
}

/** Resumo do período para a aba Progresso. */
export function periodStats(prog, from, to, { project = "", projects: onlyProjects = null, keys = null } = {}) {
  const goal = prog.workday.goal, cap = prog.workday.cap;
  // keys: só demandas da sprint (a própria chave ou a tarefa pai dela)
  const inScope = (e) => (!project || e.key.split("-")[0] === project) && (!onlyProjects || onlyProjects.has(e.key.split("-")[0]))
    && (!keys || keys.has(e.key) || (e.parentKey && keys.has(e.parentKey)));
  const tot = (d) => (prog.days[d] || []).filter(inScope).reduce((s, e) => s + e.minutes, 0);
  const all = daysOf(from, to);
  const counted = all.filter((d) => !prog.skipWeekends || !isWeekendIso(d) || tot(d) > 0);
  // Por dia: total e a divisão por espaço (MEED, SUS…) — para empilhar as barras
  const byProj = (d) => (prog.days[d] || []).filter(inScope).reduce((acc, e) => { const p = e.key.split("-")[0]; acc[p] = (acc[p] || 0) + e.minutes; return acc; }, {});
  const series = all.map((d) => ({ date: d, total: tot(d), projects: byProj(d), weekend: isWeekendIso(d), counted: counted.includes(d) }));
  const total = series.reduce((s, x) => s + x.total, 0);
  const metDays = counted.filter((d) => tot(d) >= goal).length;
  const best = series.reduce((b, x) => (x.total > (b?.total || 0) ? x : b), null);

  let bestStreak = 0, run = 0;
  for (const d of counted) { if (tot(d) >= goal) { run++; bestStreak = Math.max(bestStreak, run); } else run = 0; }

  const issues = byIssue(all.flatMap((d) => (prog.days[d] || []).filter(inScope)));
  // Em que dias você atuou em cada demanda (minutos por dia)
  for (const it of issues) {
    it.byDay = {};
    for (const d of all) {
      const m = (prog.days[d] || []).filter((e) => e.key === it.key && inScope(e)).reduce((sum, e) => sum + e.minutes, 0);
      if (m) it.byDay[d] = m;
    }
    it.days = Object.keys(it.byDay).length;
  }
  const projects = {};
  for (const it of issues) projects[it.project] = (projects[it.project] || 0) + it.minutes;

  return {
    from, to, series, total, goal, cap,
    counted: counted.length,
    avg: counted.length ? total / counted.length : 0,
    metDays, overDays: counted.filter((d) => tot(d) > cap).length,
    emptyDays: counted.filter((d) => !tot(d)).length,
    best, bestStreak,
    issues, projects,
    activeIssues: issues.length,
  };
}

/** Esta semana (seg→hoje) x mesmo trecho da semana passada. */
export function weekCompare(prog, today) {
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;   // 0 = segunda
  const monday = addDaysIso(today, -dow);
  const sum = (a, b) => daysOf(a, b).reduce((s, d) => s + totalOf(prog, d), 0);
  const cur = sum(monday, today);
  const prevMonday = addDaysIso(monday, -7);
  const prev = prevMonday >= prog.from ? sum(prevMonday, addDaysIso(today, -7)) : null;
  return { cur, prev, delta: prev == null ? null : cur - prev, weekday: dow };
}

export { DAY_MS };

/* ------------------------------------------------------------------ */
/* Quadro das minhas demandas (MY_DEMANDS)                              */
/* ------------------------------------------------------------------ */

const KIND_RX = [
  ["deploy", /deploy|publica|release|libera/i], ["reopen", /reab|reopen/i],
  ["validated", /\bvalidad|\baprovad|homologad/i],
  ["qa", /valida|homolog|teste|\bqa\b|review|revis/i], ["feito", /\bfeito\b|\bpronto\b|\bdone\b|dev ok|\bpr\b|pull request/i],
  ["blocked", /impedi|bloquead|blocked|aguardando|\bparad|on hold|em espera|waiting/i],
];
const PRD_RX = /\bprd\b|produ[cç][aã]o|production/i;

/** Tipo do status atual: other | reopen | blocked | feito | deploy | prd | qa | validated | done | todo. */
export function kindResolver(dm) {
  const bySpace = new Map(dm.spaces.map((s) => [s.project, s.kinds || {}]));
  return (statusId, project, name = "") => {
    const id = String(statusId);
    let k = bySpace.get(project)?.[id]?.kind;
    if (!k) {
      const nm = name || dm.statuses?.[id]?.name || "";
      k = KIND_RX.find(([, rx]) => rx.test(nm))?.[0] || "other";
      if (k === "deploy" && PRD_RX.test(nm)) k = "prd";
    }
    const cat = dm.statuses?.[id]?.cat;
    if (cat === "done" && (k === "other" || k === "validated")) return "done";
    if (k === "other" && cat === "new") return "todo";
    return k;
  };
}

export const DEMAND_GROUPS = [
  { id: "doing", label: "Em andamento", icon: "●" },
  { id: "blocked", label: "Impedido", icon: "⛔" },
  { id: "reopen", label: "Reaberto", icon: "↩" },
  { id: "feito", label: "Feito", icon: "☑" },
  { id: "deploy", label: "Deploy DES/HMP", icon: "⇪" },
  { id: "qa", label: "Validação", icon: "⏳" },
  { id: "shipped", label: "Finalizados", icon: "✓" },
];

/** Nome do card "Feito": no MEED a coluna é PR (pull request); no SUS, Feito (hotfix). */
export function feitoLabel(project, labels = {}) {
  if (!project) return "Feito / PR";
  if (labels.batch && project === labels.batch) return "PR";
  if (labels.sustentacao && project === labels.sustentacao) return "Feito";
  return /sus/i.test(project) ? "Feito" : "PR";
}

/** Nome do card de deploy conforme o espaço: MEED faz deploy em DES, SUS em HMP. */
export function deployLabel(project, labels = {}) {
  if (!project) return "Deploy DES/HMP";
  if (labels.batch && project === labels.batch) return "Deploy DES";
  if (labels.sustentacao && project === labels.sustentacao) return "Deploy HMP";
  return /sus/i.test(project) ? "Deploy HMP" : "Deploy DES";
}

/**
 * @param dm    resposta do MY_DEMANDS
 * @param mode  "today" (o que mudou hoje) ou número de dias
 *
 * Devolve:
 *   pending — em seu nome agora (em andamento, impedido, reaberto, a fazer), com a demanda em que
 *             você está atuando primeiro (`acting`); não depende do período;
 *   groups  — Feito, Deploy, Validação e Finalizados que ENTRARAM nessa coluna no período
 *             (Hoje = só o que entrou hoje), além de Em andamento/Impedido/Reaberto para os totais.
 */
export function demandBoard(dm, { mode = "today", project = "", now = Date.now() } = {}) {
  const me = dm.me.accountId;
  const kindOf = kindResolver(dm);
  const today = dm.today;
  const sinceIso = mode === "today" ? today : addDaysIso(today, -(Number(mode) - 1));
  const sinceMs = startOfIso(sinceIso);
  const groups = Object.fromEntries(DEMAND_GROUPS.map((g) => [g.id, []]));
  const extra = { todo: [], prd: [], idle: [] };
  const pending = [];

  for (const i of dm.issues) {
    if (project && i.project !== project) continue;
    const kind = kindOf(i.status.id, i.project, i.status.name);
    const last = i.transitions[i.transitions.length - 1];
    const since = last ? last.at : i.created || now;
    const mineNow = i.assignee?.id === me;
    const workedMin = Object.entries(i.myByDay || {}).filter(([d]) => d >= sinceIso && d <= today).reduce((sum, [, m]) => sum + m, 0);
    const movedByMe = i.transitions.some((t) => t.by === me && t.at >= sinceMs);
    const active = since >= sinceMs || workedMin > 0 || movedByMe;
    const touchedEver = mineNow || i.myMinutes > 0 || i.transitions.some((t) => t.by === me);

    // Reaberturas: cada entrada em "Reaberto" (ou volta de feito/deploy/validação para desenvolvimento)
    let returns = 0, lastReturn = null, lastReturnBy = "";
    for (const t of i.transitions) {
      const a = kindOf(t.from, i.project, t.fromName), b = kindOf(t.to, i.project, t.toName);
      const reopened = b === "reopen" ? a !== "reopen"
        : ["qa", "validated", "deploy", "prd", "feito", "done"].includes(a) && ["other", "todo"].includes(b);
      if (reopened) { returns++; lastReturn = t.at; lastReturnBy = t.byName; }
    }
    const row = { issue: i, kind, since, ageMs: now - since, returns, lastReturn, lastReturnBy, mine: mineNow, workedMin,
      today: i.myToday || 0, enteredInPeriod: since >= sinceMs };

    if (!touchedEver) continue;
    if (mineNow && ["other", "blocked", "reopen", "todo"].includes(kind)) pending.push(row);
    if (kind === "prd") { if (active) extra.prd.push(row); continue; }
    if (kind === "todo") { if (mineNow) extra.todo.push(row); continue; }
    if (kind === "other") { if (active || mineNow) groups.doing.push(row); continue; }
    if (kind === "blocked") { if (active || mineNow) groups.blocked.push(row); continue; }
    if (kind === "reopen") { if (active || mineNow) groups.reopen.push(row); continue; }
    // Feito, Deploy, Validação e Finalizados: só o que entrou na coluna no período
    if (!row.enteredInPeriod) {
      if (mineNow && kind !== "done") extra.idle.push(row);
      continue;
    }
    if (kind === "done") { groups.shipped.push(row); continue; }
    if (kind === "validated") { row.validated = true; groups.qa.push(row); continue; }
    groups[kind]?.push(row);
  }

  const byPrio = (a, b) => (a.issue.priority?.rank ?? 99) - (b.issue.priority?.rank ?? 99) || b.ageMs - a.ageMs;
  for (const g of Object.values(groups)) g.sort(byPrio);
  groups.shipped.sort((a, b) => b.since - a.since);
  groups.feito.sort((a, b) => b.since - a.since);
  extra.todo.sort(byPrio);
  extra.idle.sort(byPrio);

  // Onde você está atuando: mais horas suas hoje; sem horas hoje, o último card em andamento que você moveu.
  const order = { other: 0, reopen: 1, blocked: 2, todo: 3 };
  const lastMine = (r) => Math.max(0, ...r.issue.transitions.filter((t) => t.by === me).map((t) => t.at));
  const acting = pending.filter((r) => r.kind === "other" || r.kind === "reopen")
    .sort((a, b) => b.today - a.today || lastMine(b) - lastMine(a))[0] || null;
  if (acting) acting.acting = true;
  pending.sort((a, b) => (b.acting ? 1 : 0) - (a.acting ? 1 : 0) || order[a.kind] - order[b.kind] || byPrio(a, b));

  const open = ["doing", "blocked", "reopen", "feito", "deploy", "qa"].flatMap((k) => groups[k]);
  const prioCount = new Map();
  for (const r of open) {
    const p = r.issue.priority;
    const k = p ? p.id : "-";
    const cur = prioCount.get(k) || { id: k, name: p?.name || "Sem prioridade", rank: p?.rank ?? 99, count: 0 };
    cur.count++;
    prioCount.set(k, cur);
  }
  return {
    since: sinceIso, groups, extra, pending, acting,
    priorities: [...prioCount.values()].sort((a, b) => a.rank - b.rank),
    firstPass: groups.shipped.filter((r) => !r.returns).length,
    worked: dm.issues.filter((i) => (!project || i.project === project)
      && Object.entries(i.myByDay || {}).some(([d, m]) => d >= sinceIso && m > 0)).length,
  };
}
