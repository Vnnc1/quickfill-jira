/* Período dos filtros (Hoje, Ontem, dia, 7/14/30, Sprint) e o quadro de Demandas no período — npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { periodRange, prevBusinessDay, normPeriod } from "../src/lib/period.js";
import { demandBoard } from "../src/lib/devstats.js";

const ms = (iso, h = 12) => Date.parse(`${iso}T${String(h).padStart(2, "0")}:00:00`);

test("períodos: hoje, ontem útil, dia escolhido, N dias e sprint", () => {
  const today = "2026-10-19";   // segunda
  assert.equal(prevBusinessDay(today), "2026-10-16");
  const y = periodRange("yesterday", { today });
  assert.deepEqual([y.from, y.to, y.single, y.now], ["2026-10-16", "2026-10-16", true, false]);
  assert.match(y.label, /ontem \(sex 16\/10\)/);
  const d = periodRange("day", { today, day: "2026-10-08" });
  assert.deepEqual([d.from, d.to, d.title], ["2026-10-08", "2026-10-08", "qui 08/10"]);
  assert.equal(periodRange("day", { today, day: "" }).period, "today");          // sem dia: volta para hoje
  const w = periodRange("7", { today });
  assert.deepEqual([w.from, w.to, w.days, w.now], ["2026-10-13", "2026-10-19", 7, true]);
  const s = periodRange("sprint", { today, sprint: { name: "Sprint 16", start: "2026-10-06T10:00:00.000Z", end: "2026-10-24T00:00:00.000Z" } });
  assert.deepEqual([s.from, s.to, s.title], ["2026-10-06", "2026-10-19", "Sprint 16"]);
  const old = periodRange("sprint", { today, sprint: { name: "Sprint 15", start: "2026-09-22", end: "2026-10-03" } });
  assert.deepEqual([old.from, old.to, old.now], ["2026-09-22", "2026-10-03", false]);
  assert.equal(periodRange("sprint", { today }).period, "today");                // sem sprint: hoje
  assert.equal(normPeriod("30"), 30);
  assert.equal(normPeriod("x"), "today");
});

const me = "d1";
const t = (at, h, from, to, by = me) => ({ at: ms(at, h), from, to, fromName: from, toName: to, by, byName: by === me ? "Você" : "QA" });
const dm = () => ({
  today: "2026-10-15", me: { accountId: me }, spaces: [{ project: "MEED", kinds: {} }],
  statuses: { A: { name: "Em andamento", cat: "indeterminate" }, C: { name: "Feito", cat: "indeterminate" },
    Q: { name: "Validação", cat: "indeterminate" }, R: { name: "Reaberto", cat: "indeterminate" }, D: { name: "A fazer", cat: "new" } },
  issues: [
    // Feito ontem (14), foi para Validação hoje (15)
    { key: "MEED-1", project: "MEED", status: { id: "Q", name: "Validação" }, assignee: { id: me }, myMinutes: 60, myByDay: { "2026-10-14": 60 },
      transitions: [t("2026-10-13", 10, "D", "A"), t("2026-10-14", 16, "A", "C"), t("2026-10-15", 9, "C", "Q", "qa")] },
    // reaberto no dia 13 pelo QA e já voltou para Feito no 14
    { key: "MEED-2", project: "MEED", status: { id: "C", name: "Feito" }, assignee: { id: me }, myMinutes: 30, myByDay: {},
      transitions: [t("2026-10-10", 10, "A", "C"), t("2026-10-13", 11, "C", "R", "qa"), t("2026-10-13", 14, "R", "A"), t("2026-10-14", 10, "A", "C")] },
  ],
});

test("Ontem mostra a coluna de ontem, não a de agora", () => {
  const range = periodRange("yesterday", { today: "2026-10-15" });
  const b = demandBoard(dm(), { range, now: ms("2026-10-15", 15) });
  assert.deepEqual(b.groups.feito.map((r) => r.issue.key).sort(), ["MEED-1", "MEED-2"]);   // os dois entraram em Feito no dia 14
  assert.equal(b.groups.qa.length, 0);                                                  // MEED-1 só foi para Validação hoje
  assert.equal(b.pending.length, 0);                                                     // "em seu nome agora" só quando chega até hoje
  const hoje = demandBoard(dm(), { range: periodRange("today", { today: "2026-10-15" }), now: ms("2026-10-15", 15) });
  assert.deepEqual(hoje.groups.qa.map((r) => r.issue.key), ["MEED-1"]);
});

test("Reaberto segue o período: conta as reaberturas que aconteceram nele", () => {
  const now = ms("2026-10-15", 15);
  const today = demandBoard(dm(), { range: periodRange("today", { today: "2026-10-15" }), now });
  assert.equal(today.groups.reopen.length, 0);                                           // nada reaberto hoje
  const d13 = demandBoard(dm(), { range: periodRange("day", { today: "2026-10-15", day: "2026-10-13" }), now });
  assert.deepEqual(d13.groups.reopen.map((r) => r.issue.key), ["MEED-2"]);
  assert.equal(d13.groups.reopen[0].returnsInPeriod, 1);
  const w7 = demandBoard(dm(), { range: periodRange("7", { today: "2026-10-15" }), now });
  assert.deepEqual(w7.groups.reopen.map((r) => r.issue.key), ["MEED-2"]);
});
