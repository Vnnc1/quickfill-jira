import { test } from "node:test";
import assert from "node:assert/strict";
import { pickEstimate } from "../src/lib/duration.js";

test("estimativa existente não muda quando o campo fica vazio", () => {
  assert.equal(pickEstimate({ typed: "", current: "2m", spent: "30m" }), "");
});
test("mesmo valor digitado (formato diferente) não regrava", () => {
  assert.equal(pickEstimate({ typed: "60m", current: "1h", spent: "30m" }), "");
});
test("valor diferente digitado altera", () => {
  assert.equal(pickEstimate({ typed: "1h", current: "2m", spent: "30m" }), "1h");
});
test("sem estimativa: vazio usa o trabalhado", () => {
  assert.equal(pickEstimate({ typed: "", current: null, spent: "30m" }), "30m");
});
test("sem estimativa e opção desligada: não grava", () => {
  assert.equal(pickEstimate({ typed: "", current: null, spent: "30m", fromSpent: false }), "");
});
