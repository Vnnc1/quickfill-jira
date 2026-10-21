import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIssue, groupOfType, MEETING_GROUPS, categoryText } from "../src/lib/meeting-detect.js";
import { MEETING_TYPES } from "../src/lib/meetings.js";

const t = (summary, category) => classifyIssue({ summary, category })?.type ?? null;

test("dois grupos: reuniões (com pessoas) e execução (trabalho individual longo)", () => {
  assert.deepEqual(MEETING_GROUPS.reunioes.types, ["alinhamento", "reuniao", "outro"]);
  assert.deepEqual(MEETING_GROUPS.execucao.types, ["refinamento", "deploy", "config", "testes", "outroexec"]);
  for (const g of Object.values(MEETING_GROUPS)) for (const k of g.types) assert.ok(MEETING_TYPES[k], k);
  assert.equal(groupOfType("deploy"), "execucao");
  assert.equal(groupOfType("alinhamento"), "reunioes");
});

test("refinamento sai de reunião e vai para execução", () => {
  assert.equal(t("Refinamento de Demandas para Desenvolvimento."), "refinamento");
  assert.equal(t("Planning"), "reuniao");
  assert.equal(t("Retrospectiva - 16/10"), "reuniao");
});

test("quem espera o deploy não fez o deploy", () => {
  assert.equal(t("Testes após o deploy de DES"), "testes");
  assert.equal(t("Teste exploratório no checkout"), "testes");
  assert.equal(t("Investigação de lentidão no login"), "testes");
  assert.equal(t("Aguardando deploy MEED-12"), null);
  assert.equal(t("Deploy DES 14/10"), "deploy");
});

test("a Categoria do Jira decide antes do título", () => {
  assert.equal(t("Deploy DES 14/10", { value: "Testes" }), "testes");
  assert.equal(t("Deploy DES 14/10", { value: "Deploy" }), "deploy");
  assert.equal(t("Validação pós-deploy", { value: "Desenvolvimento" }), null);
  assert.equal(t("Sem pista no título", [{ value: "Reunião" }]), "reuniao");
  assert.equal(classifyIssue({ summary: "x", category: { value: "Configuração" } }).by, "categoria");
  assert.equal(categoryText([{ value: "A" }, { name: "B" }]), "A, B");
  assert.equal(t("Planning", ""), "reuniao", "categoria vazia: usa o título");
});
