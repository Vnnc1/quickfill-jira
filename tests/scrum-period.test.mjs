/* SCRUM: período com fim (Ontem, um dia escolhido) nas pessoas, riscos e fluxo — npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { reopenEvents, peopleLoad, sprintRisks, flowMetrics } from "../src/lib/teamstats.js";

const ms = (iso, h = 12) => Date.parse(`${iso}T${String(h).padStart(2, "0")}:00:00`);
const day = (iso) => ({ fromMs: ms(iso, 0), toMs: Date.parse(`${iso}T23:59:59.999`) });
const tr = (at, fromStage, toStage, by, extra = {}) => ({ at: ms(at), fromStage, toStage, by, byName: by, ...extra });

const sprint = {
  start: "2026-10-06", end: "2026-10-17",
  issues: [
    // reaberta no dia 13 e de novo no 15; concluída no 16
    { key: "MEED-1", status: { name: "Concluído", cat: "done" }, kind: "done", assignee: { id: "dev", name: "Dev" }, catChanged: ms("2026-10-16"),
      transitions: [tr("2026-10-08", "todo", "doing", "dev"), tr("2026-10-12", "doing", "qa", "dev"),
        tr("2026-10-13", "qa", "doing", "qa", { toKind: "reopen", fromKind: "qa" }), tr("2026-10-14", "doing", "qa", "dev"),
        tr("2026-10-15", "qa", "doing", "qa", { toKind: "reopen", fromKind: "qa" }), tr("2026-10-16", "doing", "done", "qa", { toKind: "done", fromKind: "reopen" })] },
    // em Validação desde o dia 14; criada no dia 9 (depois do início)
    { key: "MEED-2", status: { name: "Validação", cat: "indeterminate" }, kind: "qa", assignee: { id: "dev", name: "Dev" }, created: ms("2026-10-09"),
      transitions: [tr("2026-10-10", "todo", "doing", "dev"), tr("2026-10-14", "doing", "qa", "dev", { toKind: "qa" })] },
  ],
};

test("reaberturas só dentro do período (início e fim)", () => {
  const i = sprint.issues[0];
  assert.equal(reopenEvents(i).length, 2);
  assert.equal(reopenEvents(i, day("2026-10-13").fromMs, day("2026-10-13").toMs).length, 1);
  assert.equal(reopenEvents(i, day("2026-10-14").fromMs, day("2026-10-14").toMs).length, 0);
});

test("pessoas: movimentos, concluídas e reaberturas de um dia passado", () => {
  const d = day("2026-10-14");
  const { people } = peopleLoad(sprint.issues, { ...d, now: ms("2026-10-17") });
  const dev = people.find((p) => p.id === "dev");
  assert.equal(dev.moves, 2);              // os dois foram para Validação no dia 14
  assert.equal(dev.doneInPeriod, 0);       // concluída só no dia 16
  assert.equal(dev.returns, 0);
  const d16 = peopleLoad(sprint.issues, { ...day("2026-10-16"), now: ms("2026-10-17") }).people.find((p) => p.id === "dev");
  assert.equal(d16.doneInPeriod, 1);
});

test("riscos e fluxo respeitam o fim do período", () => {
  const r13 = sprintRisks(sprint, { today: "2026-10-17", now: ms("2026-10-17"), ...day("2026-10-13") });
  assert.deepEqual(r13.returned.map((x) => x.issue.key), ["MEED-1"]);
  assert.equal(r13.qaQueue.length, 0);                // MEED-2 só entrou na Validação no dia 14
  const r14 = sprintRisks(sprint, { today: "2026-10-17", now: ms("2026-10-17"), ...day("2026-10-14") });
  assert.deepEqual(r14.qaQueue.map((x) => x.issue.key), ["MEED-2"]);
  assert.equal(r14.returned.length, 0);
  const f15 = flowMetrics(sprint, { today: "2026-10-17", ...day("2026-10-15") });
  assert.equal(f15.doneInPeriod, 0);
  const f16 = flowMetrics(sprint, { today: "2026-10-17", ...day("2026-10-16") });
  assert.equal(f16.doneInPeriod, 1);
  assert.equal(f16.throughput, 1);                    // 1 concluída em 1 dia útil
});
