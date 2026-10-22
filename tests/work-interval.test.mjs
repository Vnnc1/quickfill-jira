import test from "node:test";
import assert from "node:assert/strict";
import { workInterval } from "../src/lib/work-interval.js";

test("início e fim calculam o tempo no mesmo dia, inclusive fora da jornada", () => {
  assert.deepEqual(workInterval("11:00", "12:30"), { ok: true, total: 90, minutes: 90, count: 1, jira: "1h 30m" });
  assert.equal(workInterval("00:00", "00:01").jira, "1m");
  assert.equal(workInterval("18:00", "20:15").jira, "2h 15m");
});

test("horários incompletos, iguais ou invertidos não geram apontamento", () => {
  for (const [start, end] of [["", "12:30"], ["11:00", ""], ["11:00", "11:00"], ["12:30", "11:00"],
    ["23:30", "00:30"], ["24:00", "25:00"], ["11:60", "12:30"], ["x", "12:30"]]) {
    const interval = workInterval(start, end);
    assert.equal(interval.ok, false);
    assert.ok(interval.error);
    assert.equal(interval.jira, undefined);
  }
});

test("intervalo de lote é dividido sem duplicar ou arredondar minutos", () => {
  const interval = workInterval("11:00", "12:30", 3);
  assert.equal(interval.jira, "30m");
  assert.equal(interval.minutes * interval.count, interval.total);
  assert.equal(workInterval("11:00", "12:01", 2).ok, false);
  assert.equal(workInterval("11:00", "12:00", 0).ok, false);
});
