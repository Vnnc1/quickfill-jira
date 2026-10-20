/* Testes do histórico da demanda — rode com: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHistory, onlyReturns, fmtSpan, LANES } from "../jira-quickfill-qa/lib/history.js";

const H = (h) => Date.parse(`2026-10-${h}`);
const tr = (at, fromName, toName, fromStage, toStage, extra = {}) =>
  ({ at: H(at), fromName, toName, fromStage, toStage, fromKind: null, toKind: null, by: "g", byName: "Gabriel", ...extra });

const data = {
  key: "MEED-1918", summary: "Fila", type: "História", created: H("01T09:00"), creator: { id: "s", name: "Silvio" },
  status: { name: "Em andamento", stage: "doing" },
  transitions: [
    tr("02T10:00", "A fazer", "Em andamento", "todo", "doing"),
    tr("03T10:00", "Em andamento", "PR", "doing", "feito"),
    tr("06T10:00", "PR", "Validação", "feito", "qa"),
    tr("07T10:00", "Validação", "Reaberto", "qa", "doing", { toKind: "reopen", by: "m", byName: "Marjorie" }),
    tr("08T10:00", "Reaberto", "Em andamento", "doing", "doing", { fromKind: "reopen" }),
  ],
  comments: [
    { at: H("07T10:05"), by: "m", byName: "Marjorie", text: "Notificação não dispara" },
    { at: H("07T10:01"), by: "g", byName: "Gabriel", text: "de outra pessoa" },
  ],
};

test("um nó por ação, com a criação primeiro e as faixas do quadro", () => {
  const r = buildHistory(data, H("09T10:00"));
  assert.equal(r.nodes.length, 6);
  assert.equal(r.nodes[0].title, "Criada em A fazer");
  assert.deepEqual(r.nodes.map((n) => LANES[n.lane].id), ["todo", "doing", "feito", "qa", "doing", "doing"]);
});

test("conta a volta (entrou em Reaberto) e não a saída do Reaberto", () => {
  const r = buildHistory(data, H("09T10:00"));
  assert.equal(r.loops, 1);
  assert.ok(r.nodes[4].back);
  assert.ok(!r.nodes[5].back);
  assert.match(r.nodes[4].title, /voltou/);
});

test("o comentário da volta é o do mesmo autor, perto da ação", () => {
  const r = buildHistory(data, H("09T10:00"));
  assert.equal(r.nodes[4].note, "Notificação não dispara");
  assert.equal(r.nodes[3].note, "");
});

test("tempo por etapa soma até agora; pessoas distintas", () => {
  const r = buildHistory(data, H("09T10:00"));
  const sum = r.share.reduce((s, x) => s + x.ms, 0);
  assert.equal(sum, H("09T10:00") - H("01T09:00"));
  assert.equal(r.people, 3);
  assert.equal(r.nowStatus, "Em andamento");
});

test("voltar de Validação direto para Em andamento também é volta", () => {
  const r = buildHistory({ ...data, transitions: [tr("06T10:00", "Validação", "Em andamento", "qa", "doing")] }, H("07T10:00"));
  assert.equal(r.loops, 1);
});

test("Impedido fica na faixa onde estava", () => {
  const r = buildHistory({ ...data, transitions: [
    tr("02T10:00", "A fazer", "Em andamento", "todo", "doing"),
    tr("03T10:00", "Em andamento", "Impedido", "doing", "blocked"),
  ] }, H("04T10:00"));
  assert.equal(LANES[r.nodes[2].lane].id, "doing");
});

test("Só as voltas mantém a criação, a volta e de onde voltou", () => {
  const r = buildHistory(data, H("09T10:00"));
  assert.deepEqual([...onlyReturns(r.nodes)].sort(), [0, 3, 4]);
});

test("durações curtas", () => {
  assert.equal(fmtSpan(30 * 60000), "30m");
  assert.equal(fmtSpan(5 * 3600000), "5h");
  assert.equal(fmtSpan(50 * 3600000), "2d 2h");
  assert.equal(fmtSpan(48 * 3600000), "2d");
});
