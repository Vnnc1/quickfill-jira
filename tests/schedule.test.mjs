import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../src/lib/schedule.js";

test("lote respeita uma única janela de dias mesmo com vários itens grandes", () => {
  const plan = buildPlan({ startDate: "2026-10-19", maxDays: 2,
    workday: { overflow: "nextDay", start: 660, end: 720, capMinutes: 60 },
    items: [{ key: "A", minutes: 120 }, { key: "B", minutes: 120 }, { key: "C", minutes: 120 }] });
  assert.equal(plan.unplaced, 240);
  assert.equal(plan.days.reduce((sum, d) => sum + d.planned, 0), 120);
  assert.ok(plan.items.flatMap((i) => i.chunks).every((c) => c.date <= "2026-10-20"));
});

test("jornada desconta intervalos ocupados, teto e fim de semana", () => {
  const plan = buildPlan({ startDate: "2026-10-23", maxDays: 4,
    workday: { overflow: "nextDay", start: 660, end: 780, capMinutes: 90 },
    busyByDay: { "2026-10-23": [{ start: 690, minutes: 30 }] },
    items: [{ key: "A", minutes: 90 }, { key: "B", minutes: 30 }] });
  assert.equal(plan.unplaced, 0);
  assert.deepEqual(plan.items[0].chunks.map((c) => [c.date, c.start, c.minutes]), [
    ["2026-10-23", 660, 30], ["2026-10-23", 720, 30], ["2026-10-26", 660, 30],
  ]);
  assert.equal(plan.items[1].chunks[0].start, 690);
});

test("mesmo dia preserva horário informado e não ultrapassa meia-noite", () => {
  const plan = buildPlan({ startDate: "2026-10-22", notBefore: 1410,
    items: [{ key: "A", minutes: 60 }, { key: "B", minutes: 30 }] });
  assert.equal(plan.items[0].chunks[0].minutes, 30);
  assert.equal(plan.items[1].chunks.length, 0);
  assert.equal(plan.unplaced, 60);
});
