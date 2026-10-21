/**
 * Métricas do QuickFill SCRUM (sprint, pessoas, riscos) e do QuickFill DESIGN (HUs).
 * Funções puras sobre as issues que o serviço devolve (boardIssue), testáveis isoladamente.
 */

import { addDaysIso, isWeekendIso, DAY_MS } from "./dates.js";

/* ------------------------------------------------------------------ */
/* Etapas do fluxo (SCRUM)                                              */
/* ------------------------------------------------------------------ */

export const STAGES = [
  { id: "todo", label: "A fazer", icon: "○" },
  { id: "doing", label: "Em andamento", icon: "◐" },
  { id: "blocked", label: "Impedido / Aguardando", icon: "⛔" },
  { id: "feito", label: "Feito / PR", icon: "☑" },
  { id: "deploy", label: "Deploy", icon: "⇪" },
  { id: "qa", label: "Validação", icon: "🔍" },
  { id: "validated", label: "Validado", icon: "✔" },
  { id: "done", label: "Concluído", icon: "✓" },
];
const ORDER = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));

/**
 * Etapa a partir do tipo da coluna (columnKind do serviço) e da categoria do status.
 * Colunas sem nome conhecido caem pela categoria: "new" = a fazer, o resto = em andamento.
 * Impedido/Aguardando não é "em andamento": é uma etapa própria nos quatro QuickFill.
 */
export function stageFrom(kind, cat) {
  if (cat === "done" || kind === "done") return "done";
  if (kind === "validated") return "validated";
  if (kind === "qa") return "qa";
  if (kind === "feito") return "feito";
  if (kind === "deploy" || kind === "prd") return "deploy";
  if (kind === "blocked") return "blocked";
  if (kind === "reopen") return "doing";
  if (cat === "new") return "todo";
  return "doing";
}
/** Etapa da própria coluna da demanda. */
export const ownStage = (i) => stageFrom(i.kind, i.status?.cat);
/**
 * Etapa considerada: subtarefa cuja tarefa pai já foi concluída ou validada segue o pai
 * (ex.: pai concluído e subtarefas esquecidas em PR não contam como "em andamento").
 */
export const stageOf = (i) => (i.isSubtask && (i.parentStage === "done" || i.parentStage === "validated") ? i.parentStage : ownStage(i));
/** Anota em cada subtarefa a etapa da tarefa pai (quando o pai está na lista). */
export function linkParents(issues) {
  const parents = new Map(issues.filter((i) => !i.isSubtask).map((i) => [i.key, i]));
  for (const i of issues) if (i.isSubtask && parents.has(i.parentKey)) i.parentStage = ownStage(parents.get(i.parentKey));
  return issues;
}
/** Subtarefa ainda aberta no Jira, mas com o pai concluído/validado. */
export const orphanOpen = (i) => i.isSubtask && stageOf(i) !== ownStage(i) && ownStage(i) !== "done";

/** Voltou no fluxo: saiu de Feito/Validação/Validado/Concluído para A fazer/Em andamento. */
export const isReturn = (t) => t.fromStage && t.toStage && ORDER[t.fromStage] >= ORDER.feito && ["todo", "doing"].includes(t.toStage);

/**
 * Reaberturas: cada vez que a demanda ENTRA em "Reaberto" conta uma volta
 * (Validação → Reaberto → Em andamento → Validação → Reaberto = 2 voltas).
 * Sem a coluna Reaberto no histórico (dados antigos), cai na regra geral de retorno.
 */
export function reopenEvents(i, fromMs = 0, toMs = Infinity) {
  const tr = i.transitions || [];
  const known = tr.some((t) => t.toKind !== undefined);
  const list = known ? tr.filter((t) => t.toKind === "reopen" && t.fromKind !== "reopen") : tr.filter(isReturn);
  return list.filter((t) => t.at >= fromMs && t.at <= toMs);
}

/** Pessoa da equipe de QA (Opções): pelo accountId ou pelo começo do nome. */
export function qaMatcher(qaPeople = []) {
  const ids = new Set(qaPeople.map((p) => p.accountId).filter(Boolean));
  const names = qaPeople.map((p) => normName(p.name)).filter(Boolean);
  return (id, name) => ids.has(id) || (!!name && names.some((n) => normName(name).startsWith(n)));
}

/** Quando a demanda entrou na etapa atual (última transição para ela). */
export const enteredStageAt = (i, stage) => [...(i.transitions || [])].reverse().find((t) => t.toStage === stage)?.at || null;

/* ---------- nomes configuráveis (Opções) ---------- */

/** Sem acento e em minúsculas — para casar nomes de status/coluna. */
export const normName = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Lista "Feito, Dev OK" → regex que casa qualquer um dos termos no começo de uma palavra
 * (sobre o nome já normalizado). Lista vazia devolve o `fallback`.
 */
export function termsRx(raw, fallback = null) {
  const terms = String(raw || "").split(/[\n,;]+/).map(normName).filter(Boolean);
  if (!terms.length) return fallback;
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(^|[^a-z0-9])(${esc.join("|")})`, "i");
}

/** Tipo da issue agrupado: HU (história), Bug ou Tarefa. */
export function typeGroup(type) {
  const n = normName(type);
  if (/hist|story|\bhu\b/.test(n)) return "hu";
  if (/bug|defeito|erro|incidente/.test(n)) return "bug";
  return "task";
}
export const TYPE_LABEL = { hu: "HUs", bug: "Bugs", task: "Tarefas" };

/** Causa do retorno registrada pelo QA (etiqueta "retorno-<categoria>"). */
export const returnCauses = (i) => (i.labels || []).filter((l) => /^retorno-/i.test(l)).map((l) => l.slice(8).replace(/-/g, " "));

/** Itens da sprint com as subtarefas de cada um (inclusive pais fora da sprint). */
export function sprintTree(issues) {
  const parents = new Map();
  for (const i of issues) if (!i.isSubtask) parents.set(i.key, { issue: i, subs: [] });
  for (const i of issues) {
    if (!i.isSubtask) continue;
    const k = i.parentKey || "?";
    if (!parents.has(k)) parents.set(k, { issue: { key: k, summary: i.parentSummary || "(tarefa pai fora da sprint)", type: "", status: { name: "", cat: "" }, outside: true }, subs: [] });
    parents.get(k).subs.push(i);
  }
  return [...parents.values()];
}

const isoOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Dias úteis de a até b (inclusive nos dois lados). */
export function businessDays(a, b) {
  const out = [];
  if (!a || !b || a > b) return out;
  for (let d = a; d <= b; d = addDaysIso(d, 1)) if (!isWeekendIso(d)) out.push(d);
  return out;
}

/** Dias úteis desde `ms` até agora (0 = hoje). */
export function businessAge(ms, now = Date.now()) {
  if (!ms) return 0;
  return Math.max(0, businessDays(isoOf(ms), isoOf(now)).length - 1);
}

/** Último momento em que a issue mudou de status (ou foi criada). */
export const lastMove = (i) => (i.transitions?.length ? i.transitions[i.transitions.length - 1].at : i.created);

/* ------------------------------------------------------------------ */
/* Saúde da sprint                                                      */
/* ------------------------------------------------------------------ */

/**
 * Totais por etapa, burndown (itens e pontos) e previsão de fim no ritmo atual.
 * Subtarefas ficam de fora da contagem: o compromisso da sprint são as tarefas pai.
 */
export function sprintHealth(sprint, today) {
  const items = sprint.issues.filter((i) => !i.isSubtask);
  const byStage = Object.fromEntries(STAGES.map((s) => [s.id, []]));
  for (const i of items) byStage[stageOf(i)].push(i);
  const pts = (list) => list.reduce((s, i) => s + (i.points || 0), 0);

  const end = sprint.end || today;
  const days = businessDays(sprint.start, end);
  const elapsed = days.filter((d) => d <= today).length;
  const doneDate = (i) => {
    if (stageOf(i) !== "done") return null;
    const d = i.catChanged ? isoOf(i.catChanged) : today;
    return d < sprint.start ? sprint.start : d;
  };
  const doneDates = items.map((i) => [i, doneDate(i)]).filter(([, d]) => d);
  const totalPts = pts(items);
  const series = days.map((d, idx) => {
    const doneBy = doneDates.filter(([, dd]) => dd <= d);
    const ideal = days.length > 1 ? items.length * (1 - idx / (days.length - 1)) : 0;
    const idealPts = days.length > 1 ? totalPts * (1 - idx / (days.length - 1)) : 0;
    return d > today
      ? { date: d, future: true, ideal, idealPts }
      : { date: d, remaining: items.length - doneBy.length, remainingPts: totalPts - pts(doneBy.map(([i]) => i)), ideal, idealPts };
  });

  const done = byStage.done.length;
  const rate = elapsed ? done / elapsed : 0;                 // itens por dia útil
  const left = Math.max(0, days.length - elapsed);
  const forecast = Math.min(items.length, Math.round(done + rate * left));
  const startMs = Date.parse(`${sprint.start}T23:59:59`);
  const added = items.filter((i) => i.created && i.created > startMs);

  return {
    items, byStage, total: items.length, done, totalPts, donePts: pts(byStage.done),
    days, elapsed, left, timePct: days.length ? elapsed / days.length : 0,
    workPct: items.length ? done / items.length : 0,
    series, forecast, onTrack: forecast >= items.length,
    added,
  };
}

/* ------------------------------------------------------------------ */
/* Pessoas: quem está com o quê                                         */
/* ------------------------------------------------------------------ */

/**
 * Carga por pessoa na sprint. `wipLimit` marca quem está com itens demais em andamento;
 * para o que está sem responsável sugere quem já atua na mesma tarefa pai e tem menos WIP.
 */
export function peopleLoad(issues, { wipLimit = 2, staleDays = 3, qaPeople = [], smPeople = [], designPeople = [], ignorePeople = [], fromMs = 0, toMs = Infinity, now = Date.now() } = {}) {
  const inP = (ms) => !!ms && ms >= fromMs && ms <= toMs;
  const isQa = qaMatcher(qaPeople);
  const isSm = qaMatcher(smPeople);
  const isDesign = qaMatcher(designPeople);
  const ignored = qaMatcher(ignorePeople);
  const people = new Map();
  const unassigned = [];
  const person = (a) => {
    if (!people.has(a.id)) people.set(a.id, { id: a.id, name: a.name, isSm: isSm(a.id, a.name), isDesign: !isSm(a.id, a.name) && isDesign(a.id, a.name),
      isQa: !isSm(a.id, a.name) && !isDesign(a.id, a.name) && isQa(a.id, a.name),
      stages: Object.fromEntries(STAGES.map((s) => [s.id, []])),
      points: 0, donePts: 0, returns: 0, stalled: 0, parents: new Set(), moves: 0, doneInPeriod: 0, active: new Set() });
    return people.get(a.id);
  };
  for (const i of issues) {
    const st = stageOf(i);
    // Movimentos no período feitos por qualquer pessoa da sprint (quem moveu o card)
    for (const t of i.transitions || []) {
      if (t.at < fromMs || t.at > toMs || !t.by || ignored(t.by, t.byName)) continue;
      const mover = person({ id: t.by, name: t.byName });
      mover.moves++;
      mover.active.add(i.key);
    }
    if (i.assignee && ignored(i.assignee.id, i.assignee.name)) continue;   // conta de teste/automação
    if (!i.assignee) { if (st !== "done") unassigned.push(i); continue; }
    const p = person(i.assignee);
    p.stages[st].push(i);
    p.points += i.points || 0;
    if (st === "done") {
      p.donePts += i.points || 0;
      if (inP(i.catChanged) || (!fromMs && toMs === Infinity)) p.doneInPeriod++;
    }
    p.returns += reopenEvents(i, fromMs, toMs).length;
    if (st === "doing" && businessAge(lastMove(i), now) >= staleDays) p.stalled++;
    if (toMs === Infinity ? (lastMove(i) || 0) >= fromMs : (i.transitions || []).some((t) => inP(t.at))) p.active.add(i.key);
    p.parents.add(i.parentKey || i.key);
  }
  const list = [...people.values()]
    // Sem itens: só aparece quem moveu cards no período filtrado (e a Scrum Master, sempre)
    .filter((p) => STAGES.some((s) => p.stages[s.id].length) || p.isSm || ((fromMs > 0 || toMs !== Infinity) && p.moves))
    .map((p) => {
      const wip = p.stages.doing.length;
      const open = STAGES.filter((s) => s.id !== "done").reduce((n, s) => n + p.stages[s.id].length, 0);
      const oldest = p.stages.doing.reduce((m, i) => Math.max(m, businessAge(lastMove(i), now)), 0);
      // Regras de WIP e de "livre" valem para quem desenvolve; a equipe de QA fica de fora.
      const dev = !p.isQa && !p.isSm && !p.isDesign;
      return { ...p, wip, open, oldest, overWip: dev && wip > wipLimit, free: dev && open === 0 };
    }).sort((a, b) => a.isQa - b.isQa || b.open - a.open || a.name.localeCompare(b.name));

  const devs = list.filter((p) => !p.isQa && !p.isSm && !p.isDesign);
  const suggest = (i) => {
    const fam = i.parentKey || i.key;
    const near = devs.filter((p) => p.parents.has(fam) && !p.overWip).sort((a, b) => a.wip - b.wip || a.open - b.open);
    if (near.length) return { person: near[0], why: `já atua em ${fam}` };
    const light = devs.filter((p) => !p.overWip).sort((a, b) => a.wip - b.wip || a.open - b.open);
    return light.length ? { person: light[0], why: light[0].wip ? `menor WIP (${light[0].wip})` : "sem nada em andamento" } : null;
  };
  return { people: list, devs, qa: list.filter((p) => p.isQa), sm: list.filter((p) => p.isSm), design: list.filter((p) => p.isDesign), unassigned: unassigned.map((i) => ({ issue: i, suggestion: suggest(i) })) };
}

/* ------------------------------------------------------------------ */
/* Riscos da sprint                                                     */
/* ------------------------------------------------------------------ */

export const RISKS = [
  { id: "flagged", label: "Impedidas", icon: "🚩", tip: "Na coluna Impedido/Aguardando ou sinalizadas como impedimento no Jira", state: true },
  { id: "returned", label: "Reabertas", icon: "🔁", tip: "Cada entrada em Reaberto conta uma volta (Validação → Reaberto → … → Reaberto = 2×)" },
  { id: "stalled", label: "Paradas", icon: "⏳", tip: "Em andamento sem mudar de status há vários dias úteis", state: true },
  { id: "feitoQueue", label: "Aguardando deploy", icon: "☑", tip: "Em Feito esperando quem faz o deploy mover para Deploy" },
  { id: "qaQueue", label: "Fila do QA", icon: "🔍", tip: "Na coluna Validação esperando o QA (Validado já saiu da fila)" },
  { id: "overdue", label: "Atrasadas", icon: "📅", tip: "Data limite já passou e ainda não concluíram", state: true },
  { id: "highTodo", label: "Prioridade alta parada", icon: "⚠", tip: "Prioridade alta ou crítica ainda em A fazer", state: true },
  { id: "unassigned", label: "Sem responsável", icon: "👤", tip: "Itens abertos da sprint sem ninguém atribuído", state: true },
  { id: "overEstimate", label: "Passaram da estimativa", icon: "⌛", tip: "Tempo apontado maior que a estimativa original", state: true },
  { id: "added", label: "Entraram depois do início", icon: "➕", tip: "Criadas depois do primeiro dia da sprint (mudança de escopo)" },
  { id: "orphanSubs", label: "Subtarefas esquecidas", icon: "🧹", tip: "Subtarefas ainda abertas (ex.: em PR) com a tarefa pai já concluída ou validada — não contam como em andamento; vale fechar no Jira", state: true },
];

/**
 * Riscos da sprint. `fromMs`/`toMs` (filtro de período) valem para os eventos — reabertas, entradas em
 * Feito/Validação e itens criados; os riscos de estado (impedidas, paradas, atrasadas…) são sempre "agora".
 */
export function sprintRisks(sprint, { staleDays = 3, today, now = Date.now(), isHigh = () => false, fromMs = 0, toMs = Infinity, qaPeople = [] } = {}) {
  const isQa = qaMatcher(qaPeople);
  const startMs = Date.parse(`${sprint.start}T00:00:00`);
  const evFrom = Math.max(fromMs, 0);
  const out = Object.fromEntries(RISKS.map((r) => [r.id, []]));
  for (const i of sprint.issues) {
    const st = stageOf(i);
    const open = st !== "done";
    const age = businessAge(lastMove(i), now);
    // Riscos de coluna seguem o quadro: só os cards da sprint (HU, tarefa, bug), como o Jira mostra.
    // As subtarefas ficam dentro do card e não entram nessas contagens.
    const card = !i.isSubtask;
    if (card && open && (i.flagged || st === "blocked")) out.flagged.push({ issue: i, age, why: st === "blocked" ? i.status.name : "sinalizada" });
    const reopens = reopenEvents(i, Math.max(startMs, evFrom), toMs);
    if (reopens.length) {
      const last = reopens[reopens.length - 1];
      out.returned.push({ issue: i, count: reopens.length, last, byQa: reopens.some((t) => isQa(t.by, t.byName)) });
    }
    if (card && st === "doing" && age >= staleDays) out.stalled.push({ issue: i, age });
    const entered = (stage) => { const at = enteredStageAt(i, stage) || lastMove(i) || 0; return at >= evFrom && at <= toMs; };
    if (card && st === "qa" && entered("qa")) out.qaQueue.push({ issue: i, age });
    if (card && st === "feito" && entered("feito")) out.feitoQueue.push({ issue: i, age });
    if (open && i.due && i.due < today) out.overdue.push({ issue: i, age, late: businessDays(i.due, today).length - 1 });
    if (card && st === "todo" && isHigh(i.priority)) out.highTodo.push({ issue: i, age });
    if (open && !i.assignee && !i.isSubtask) out.unassigned.push({ issue: i, age });
    if (i.estimate && i.spent > i.estimate) out.overEstimate.push({ issue: i, age, over: i.spent - i.estimate });
    if (!i.isSubtask && i.created && i.created > startMs + DAY_MS && i.created >= evFrom && i.created <= toMs) out.added.push({ issue: i, age });
    if (orphanOpen(i)) out.orphanSubs.push({ issue: i, age, own: i.status.name });
  }
  for (const k of ["stalled", "qaQueue", "feitoQueue", "flagged"]) out[k].sort((a, b) => b.age - a.age);
  out.returned.sort((a, b) => b.count - a.count || b.last.at - a.last.at);
  return out;
}

/* ------------------------------------------------------------------ */
/* Métricas de fluxo da sprint                                          */
/* ------------------------------------------------------------------ */

/** Tempo (ms) que a demanda passou em cada etapa, pelas transições. */
export function timeInStages(i, now = Date.now()) {
  const out = {};
  const tr = i.transitions || [];
  for (let k = 0; k < tr.length; k++) {
    const st = tr[k].toStage;
    if (!st) continue;
    const end = k + 1 < tr.length ? tr[k + 1].at : now;
    out[st] = (out[st] || 0) + Math.max(0, end - tr[k].at);
  }
  return out;
}

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/**
 * Cycle time (1ª vez em andamento → concluído), tempo médio na fila do QA, tempo impedido,
 * taxa de reabertura, vazão e aprovação de primeira — sobre HUs, tarefas e bugs da sprint.
 */
export function flowMetrics(sprint, { today, fromMs = 0, toMs = Infinity, now = Date.now() } = {}) {
  const items = sprint.issues.filter((i) => !i.isSubtask);
  const done = items.filter((i) => stageOf(i) === "done");
  const cycles = done.map((i) => {
    const start = (i.transitions || []).find((t) => t.toStage === "doing")?.at;
    return start && i.catChanged && i.catChanged > start ? i.catChanged - start : null;
  }).filter(Boolean);
  const stageTimes = items.map((i) => timeInStages(i, now));
  const qaTimes = stageTimes.map((t) => t.qa).filter(Boolean);
  const blockedTimes = stageTimes.map((t) => t.blocked).filter(Boolean);
  const reopened = items.filter((i) => reopenEvents(i).length);
  const passedQa = items.filter((i) => (i.transitions || []).some((t) => t.fromStage === "qa"));
  const firstPass = passedQa.filter((i) => !reopenEvents(i).length);
  const lastDay = toMs === Infinity ? today : isoOf(toMs);
  const days = businessDays(fromMs ? isoOf(fromMs) : sprint.start, lastDay).length || 1;
  const doneInPeriod = done.filter((i) => (i.catChanged || 0) >= fromMs && (i.catChanged || 0) <= toMs);
  return {
    cycleAvg: avg(cycles),
    qaWaitAvg: avg(qaTimes),
    blockedAvg: avg(blockedTimes),
    blockedNow: items.filter((i) => stageOf(i) === "blocked").length,
    reopenRate: items.length ? reopened.length / items.length : 0,
    reopened: reopened.length,
    firstPassRate: passedQa.length ? firstPass.length / passedQa.length : null,
    throughput: doneInPeriod.length / days,
    doneInPeriod: doneInPeriod.length,
    wipNow: items.filter((i) => stageOf(i) === "doing").length,
  };
}


/* ------------------------------------------------------------------ */
/* DESIGN: etapas da HU                                                 */
/* ------------------------------------------------------------------ */

/** Checklist de handoff Design → DEV (salvo na propriedade "quickfill.handoff" da HU). */
export const HANDOFF_ITEMS = [
  ["figma", "Link do Figma (tela e protótipo) na HU"],
  ["states", "Estados: vazio, carregando, erro e sucesso"],
  ["responsive", "Responsivo (desktop e mobile)"],
  ["a11y", "Acessibilidade: contraste, foco e textos alternativos"],
  ["copy", "Textos finais revisados"],
  ["ds", "Componentes do Design System identificados"],
  ["proto", "Protótipo navegável do fluxo"],
  ["criteria", "Critérios de aceite alinhados com o PO"],
];

export const DESIGN_STAGES = [
  { id: "queue", label: "Na fila", icon: "○" },
  { id: "doing", label: "Prototipando", icon: "✎" },
  { id: "review", label: "Em revisão", icon: "👁" },
  { id: "handoff", label: "Entregue (backlog do dev)", icon: "⇢" },
  { id: "delivered", label: "Implementadas", icon: "✓" },
];

const D_REVIEW = /revis|review|aprova|feedback|validacao (de )?(design|ux|ui|layout|prototipo)/i;
const D_DOING = /design|prototip|wirefram|\bux\b|\bui\b|layout|figma|discovery|descoberta|pesquisa|research|ideac|benchmark/i;
const D_DELIVERED = /pronto (para|p\/) ?dev|ready for dev|sprint backlog|refinad|entregue/i;
const D_DEV = /dev|desenvolv|codig|code|deploy|feito|valida|homolog|teste|\bqa\b|pronto|ready/i;
const D_BLOCKED = /impedi|bloquead|blocked|aguardando|parad|on hold|em espera/;
const D_DONE = /conclu|\bdone\b|fechad|resolvid|closed/i;

/** Regras de nome de status do Design: as listas das Opções substituem o padrão. */
export function designRules(raw = {}) {
  return {
    doing: termsRx(raw.doing, D_DOING),
    review: termsRx(raw.review, D_REVIEW),
    delivered: termsRx(raw.delivered, D_DELIVERED),
  };
}
const DEFAULT_DR = designRules();

/**
 * Etapa de design pelo nome do status. "Entregue" = protótipo concluído e a HU seguiu para o
 * backlog da sprint do dev; depois disso, qualquer status de desenvolvimento conta como entregue,
 * e só a categoria Concluído vira "Implementada".
 */
export function designStageOf(name, cat, mine = false, R = DEFAULT_DR) {
  const n = normName(name);
  if (cat === "done" || (!cat && D_DONE.test(n))) return "delivered";
  if (R.delivered.test(n)) return "handoff";
  if (R.review.test(n) && !/codigo|code/.test(n)) return "review";
  if (R.doing.test(n)) return "doing";
  if (cat === "new") return "queue";
  if (D_DEV.test(n)) return "handoff";
  return mine ? "doing" : "handoff";
}

/**
 * Ciclo de cada HU: quando entrou em prototipação, quando foi entregue ao dev (handoff),
 * quantas vezes voltou da revisão e o lead time do design.
 */
export function designCycle(i, R = DEFAULT_DR) {
  let started = null, handoff = null, rounds = 0;
  for (const t of i.transitions || []) {
    const from = designStageOf(t.fromName, null, i.mine, R), to = designStageOf(t.toName, null, i.mine, R);
    if (to === "doing" && !started) started = t.at;
    if (from === "review" && to === "doing") rounds++;
    if ((from === "doing" || from === "review") && (to === "handoff" || to === "delivered") && !handoff) handoff = t.at;
  }
  return { started, handoff, rounds, lead: started && handoff && handoff > started ? handoff - started : null };
}


/** Segunda-feira da semana de `iso`. */
export function weekStart(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7;
  return addDaysIso(iso, -dow);
}

export function designBoard(data, { project = "", weeks = 6 } = {}) {
  const issues = data.issues.filter((i) => !project || i.project === project);
  const groups = Object.fromEntries(DESIGN_STAGES.map((s) => [s.id, []]));
  const R = designRules(data.designRules || {});
  const rows = issues.map((i) => {
    let stage = designStageOf(i.status.name, i.status.cat, i.mine, R);
    const cycle = designCycle(i, R);
    const inSprint = (i.sprints || []).some((s) => s.state === "active");
    // Protótipo já trabalhado e HU colocada numa sprint (ativa ou futura) = entregue ao dev.
    if (stage === "queue" && cycle.started && (i.sprints || []).some((s) => s.state === "active" || s.state === "future")) stage = "handoff";
    const blocked = i.kind === "blocked" || D_BLOCKED.test(normName(i.status.name)) || !!i.flagged;
    return { issue: i, stage, cycle, inSprint, blocked, age: businessAge(lastMove(i)) };
  });
  for (const r of rows) groups[r.stage].push(r);
  for (const g of Object.values(groups)) g.sort((a, b) => (a.issue.priority?.rank ?? 99) - (b.issue.priority?.rank ?? 99) || b.age - a.age);

  // Entregas por semana (pelo momento do handoff)
  const thisWeek = weekStart(data.today);
  const series = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const ws = addDaysIso(thisWeek, -7 * k), we = addDaysIso(ws, 6);
    const n = rows.filter((r) => r.cycle.handoff && isoOf(r.cycle.handoff) >= ws && isoOf(r.cycle.handoff) <= we).length;
    series.push({ week: ws, count: n, current: k === 0 });
  }
  const leads = rows.map((r) => r.cycle.lead).filter(Boolean);
  const avgLead = leads.length ? leads.reduce((s, x) => s + x, 0) / leads.length : null;
  const waiting = rows.filter((r) => r.inSprint && ["queue", "doing", "review"].includes(r.stage));
  const noFigma = rows.filter((r) => ["doing", "review", "handoff"].includes(r.stage) && !r.issue.hasFigma);
  const rounds = rows.reduce((s, r) => s + r.cycle.rounds, 0);

  const blockedRows = rows.filter((r) => r.blocked && r.stage !== "delivered");
  return { rows, groups, series, blocked: blockedRows, thisWeek: series[series.length - 1].count, avgLead, waiting, noFigma, rounds };
}
