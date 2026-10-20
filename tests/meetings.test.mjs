import { test } from "node:test";
import assert from "node:assert/strict";
import { describeChange, ROLE_TEMPLATES, defaultTemplates, MEETING_TYPES } from "../jira-quickfill-qa/lib/meetings.js";

const base = { type: "alinhamento", title: "Alinhamento com QA", date: "2026-10-20", start: 600, end: 615 };

test("alterações da linha do tempo viram frases legíveis", () => {
  assert.equal(describeChange({ ...base, action: "criou" }, "Wallace"), "Wallace marcou alinhamento “Alinhamento com QA” às 10:00");
  assert.equal(describeChange({ ...base, action: "moveu", start: 630, end: 645, from: { date: "2026-10-20", start: 600, end: 615 } }), "Você mudou “Alinhamento com QA” de 10:00 para 10:30");
  assert.equal(describeChange({ ...base, action: "moveu", date: "2026-10-21", from: { date: "2026-10-20", start: 600, end: 615 } }), "Você mudou “Alinhamento com QA” para outro dia, 10:00–10:15");
  assert.equal(describeChange({ ...base, action: "virou demanda", detail: "MEED-12" }, "Almir"), "Almir transformou “Alinhamento com QA” na demanda MEED-12");
  assert.equal(describeChange({ ...base, action: "excluiu" }), "Você excluiu alinhamento “Alinhamento com QA” de 10:00–10:15");
});

test("cada perfil tem modelos próprios, com ids únicos e sem o tipo daily", () => {
  for (const [role, list] of Object.entries(ROLE_TEMPLATES)) {
    assert.ok(list.length >= 3, role);
    assert.equal(new Set(list.map((t) => t.id)).size, list.length, `${role}: ids repetidos`);
    for (const t of list) {
      assert.ok(t.dur > 0 && t.name && t.type, `${role}: ${t.name}`);
      assert.notEqual(t.type, "daily");
    }
  }
  const a = defaultTemplates(); a[0].name = "x";
  assert.notEqual(defaultTemplates()[0].name, "x", "defaultTemplates devolve cópias");
});

test("não existe mais o tipo daily", () => {
  assert.equal(MEETING_TYPES.daily, undefined);
  assert.deepEqual(Object.keys(MEETING_TYPES), ["alinhamento", "reuniao", "outro", "refinamento", "deploy", "config", "testes"]);
});
