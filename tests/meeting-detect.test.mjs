import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIssue, meetingTypeOf } from "../src/lib/meeting-detect.js";

const adf = (text) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

test("título decide primeiro", () => {
  assert.deepEqual(classifyIssue({ summary: "Planning da sprint 18" }), { type: "reuniao", match: "planning", by: "título" });
  assert.equal(classifyIssue({ summary: "Planing sprint 17" }).type, "reuniao");
  assert.equal(classifyIssue({ summary: "Retrospectiva" }).type, "reuniao");
  assert.equal(classifyIssue({ summary: "Reunião com o cliente" }).type, "reuniao");
  assert.equal(classifyIssue({ summary: "Refinamento HU de pagamentos" }).type, "refinamento");
  assert.equal(classifyIssue({ summary: "Reunião de alinhamento com o QA" }).type, "alinhamento");
  assert.equal(classifyIssue({ summary: "Daily" }).type, "outro");
});

test("sem pista no título, usa a descrição", () => {
  const r = classifyIssue({ summary: "Sprint 18", description: adf("Cerimônia de review com o PO") });
  assert.equal(r.type, "reuniao");
  assert.equal(r.by, "descrição");
  assert.equal(classifyIssue({ summary: "MEED-2050", description: "Alinhar critérios com o QA" }).type, "alinhamento");
});

test("sem informação suficiente, fica de fora", () => {
  assert.equal(classifyIssue({ summary: "Cadastro de fornecedor", description: adf("Criar tela de listagem") }), null);
  assert.equal(classifyIssue({ summary: "", description: null }), null);
  assert.equal(classifyIssue({ summary: "Ajuste no botão" }), null);
});

test("tarefas de trabalho não viram reunião por engano", () => {
  assert.equal(meetingTypeOf("Code review do PR 431"), null);
  assert.equal(meetingTypeOf("Retroativo de cálculo"), null);
  assert.equal(meetingTypeOf("Planilha de custos"), null);
});

test("demandas dos quadros: deploy, configuração e reuniões", () => {
  const t = (summary) => classifyIssue({ summary })?.type ?? null;
  assert.equal(t("Refinamento de Demandas para Desenvolvimento."), "refinamento");
  assert.equal(t("Configurar backup do banco"), "config");
  assert.equal(t("Configuração Jenkins: Develop"), "config");
  assert.equal(t("Deploy e aprovação de PRs em DES - 08/10"), "deploy");
  assert.equal(t("Reunião Alinhamento com Marília → Apresentação e Mudanças no Barramento"), "alinhamento");
  assert.equal(t("Deploys DES 13/10"), "deploy");
  assert.equal(t("Deploy DES 14/10"), "deploy");
  assert.equal(t("Reunião sobre o deploy de sexta"), "reuniao");
});
