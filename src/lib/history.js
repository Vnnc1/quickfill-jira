/**
 * Histórico da demanda: o caminho que ela fez no quadro (etapas, voltas, quem mexeu e quanto
 * tempo ficou em cada etapa). Funções puras sobre o que o serviço devolve em ISSUE_HISTORY.
 */

import { isReturn } from "./teamstats.js";

/** Faixas do desenho, na ordem do quadro. Validado fica em Validação; Impedido fica onde estava. */
export const LANES = [
  { id: "todo", label: "A fazer", short: "AF", c: "#8590a2" },
  { id: "doing", label: "Em andamento", short: "EA", c: "#579dff" },
  { id: "feito", label: "Feito / PR", short: "PR", c: "#9f8fef" },
  { id: "deploy", label: "Deploy", short: "DP", c: "#6cc3e0" },
  { id: "qa", label: "Validação", short: "VL", c: "#f5cd47" },
  { id: "done", label: "Concluído", short: "OK", c: "#4bce97" },
];
const LANE_OF = { todo: 0, doing: 1, feito: 2, deploy: 3, qa: 4, validated: 4, done: 5 };
export const laneOf = (stage, prev = 0) => LANE_OF[stage] ?? prev;

/** Voltou: entrou em Reaberto, ou saiu de Feito/Validação/Concluído para A fazer/Em andamento. */
export const isBack = (t) => (t.toKind === "reopen" && t.fromKind !== "reopen") || isReturn(t);

/** Duração curta: 45m, 5h, 3d, 2d 4h. */
export function fmtSpan(ms) {
  if (ms < 3600000) return `${Math.max(1, Math.round(ms / 60000))}m`;
  const h = Math.round(ms / 3600000);
  const d = Math.floor(h / 24), r = h % 24;
  return d ? (r ? `${d}d ${r}h` : `${d}d`) : `${h}h`;
}

/** Comentário que explica uma volta: do mesmo autor, de 10 min antes até 2 h depois da ação. */
function noteFor(t, comments) {
  const near = (comments || []).filter((c) => c.at >= t.at - 10 * 60000 && c.at <= t.at + 2 * 3600000
    && (t.by ? c.by === t.by : c.byName === t.byName));
  near.sort((a, b) => Math.abs(a.at - t.at) - Math.abs(b.at - t.at));
  return near[0]?.text || "";
}

/**
 * Monta o histórico: um nó por ação (o primeiro é a criação), com a faixa, se voltou,
 * quem fez, quanto ficou na etapa anterior e o comentário da volta.
 */
export function buildHistory(h, now = Date.now()) {
  const tr = [...(h.transitions || [])].sort((a, b) => a.at - b.at);
  const firstStage = tr[0]?.fromStage || h.status?.stage || "todo";
  const nodes = [{
    at: h.created || tr[0]?.at || now, lane: laneOf(firstStage, 0), back: false, created: true,
    title: `Criada em ${tr[0]?.fromName || h.status?.name || "A fazer"}`,
    status: tr[0]?.fromName || h.status?.name || "", by: h.creator?.name || "", byId: h.creator?.id || "", note: "",
  }];
  for (const t of tr) {
    const back = isBack(t);
    nodes.push({
      at: t.at, lane: laneOf(t.toStage, nodes[nodes.length - 1].lane), back, created: false,
      title: `${t.fromName} → ${t.toName}${back ? " (voltou)" : ""}`, status: t.toName,
      by: t.byName || "", byId: t.by || "", note: back ? noteFor(t, h.comments) : "",
    });
  }
  const spent = {};
  nodes.forEach((n, i) => {
    const end = i + 1 < nodes.length ? nodes[i + 1].at : now;
    n.dur = Math.max(0, end - n.at);
    n.stayedPrev = i ? n.at - nodes[i - 1].at : 0;
    const id = LANES[n.lane].id;
    spent[id] = (spent[id] || 0) + n.dur;
  });
  const total = Object.values(spent).reduce((s, v) => s + v, 0) || 1;
  const last = nodes[nodes.length - 1];
  const people = new Set(nodes.map((n) => n.byId || n.by).filter(Boolean));
  return {
    key: h.key, summary: h.summary || "", type: h.type || "", parentKey: h.parentKey || null, url: h.url || "",
    nodes,
    loops: nodes.filter((n) => n.back).length,
    people: people.size,
    age: now - nodes[0].at,
    nowLane: last.lane,
    nowStatus: h.status?.name || last.status || LANES[last.lane].label,
    share: LANES.filter((l) => spent[l.id]).map((l) => ({ ...l, ms: spent[l.id], w: Math.max(1, Math.round((spent[l.id] / total) * 100)) })),
  };
}

/**
 * Índices visíveis em "Só as voltas": a criação, cada volta e a ação logo antes dela
 * (de onde a demanda voltou).
 */
export function onlyReturns(nodes) {
  const keep = new Set([0]);
  nodes.forEach((n, i) => { if (n.back) { keep.add(i); if (i) keep.add(i - 1); } });
  return keep;
}
