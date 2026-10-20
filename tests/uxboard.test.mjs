import { test } from "node:test";
import assert from "node:assert/strict";
import { uxCol, uxType, baseTitle, uxBoard, uxHandoff, uxDemand, uxProgress, uxFronts, huStage } from "../jira-quickfill-qa/lib/uxboard.js";

const NOW = Date.parse("2026-10-20T15:00:00");
const D = 24 * 60 * 60 * 1000;
const item = (key, summary, status, cat, extra = {}) => ({ key, summary, status: { name: status, cat }, links: [], front: "Meeds All", created: NOW - 40 * D, statusAt: NOW - 2 * D, ...extra });

const DATA = {
  now: NOW, today: "2026-10-20", me: { accountId: "me" },
  items: [
    item("UX-428", "HU: Chat interno", "Itens pendentes", "new", { created: NOW - 3600e3, statusAt: NOW - 3600e3 }),
    item("UX-173", "Protótipo - Registro Tardio de Atendimento", "Itens pendentes", "new", { statusAt: NOW - 145 * D }),
    item("UX-264", "Especificação Funcional - Perfil Paciente", "Aguardando informações", "indeterminate", { statusAt: NOW - 131 * D, waitBy: { id: "po", name: "PO" } }),
    item("UX-427", "Versão Mobile Admin - Fluxo de Prescrições", "Em andamento", "indeterminate", { mine: true, assignee: { id: "me", name: "Eu" } }),
    item("UX-426", "Versão Mobile Admin - Relatório", "Feito", "done", { doneAt: NOW - 3600e3, spent: 120, links: [{ key: "MEED-2115" }] }),
    item("UX-364", "Painel de Desempenho", "Feito", "done", { doneAt: NOW - 24 * D, links: [{ key: "MEED-2115" }] }),
    item("UX-100", "Post do Instagram", "Itens pendentes", "new", { front: "Instagram" }),
  ],
  linked: [{ key: "MEED-2115", summary: "Painel", status: { name: "Itens Pendentes", cat: "new" } }],
  hus: [
    { key: "MEED-753", summary: "Registro Tardio de Atendimento", status: { name: "Itens Pendentes", cat: "new" }, created: NOW - 265 * D, labels: ["tiflux"] },
    { key: "MEED-981", summary: "MeedsV2 - Backend For Frontend | Web", status: { name: "Itens Pendentes", cat: "new" }, created: NOW - 217 * D, labels: [] },
    { key: "MEED-2278", summary: "Relatório de satisfação", status: { name: "Pronto Para Desenvolvimento", cat: "new" }, created: NOW - 10 * D, labels: [] },
  ],
};

test("coluna pelo status", () => {
  assert.equal(uxCol("Aguardando informações", "indeterminate"), "info");
  assert.equal(uxCol("Aguardando aprovação", "indeterminate"), "appr");
  assert.equal(uxCol("Itens pendentes", "new"), "pend");
  assert.equal(uxCol("Em andamento", "indeterminate"), "doing");
  assert.equal(uxCol("Feito", "done"), "done");
});

test("tipo pelo título", () => {
  assert.equal(uxType("Versão Mobile Admin - Fluxo X"), "mob");
  assert.equal(uxType("Reunião Planning"), "meet");
  assert.equal(uxType("HU: Chat interno"), "hu");
  assert.equal(uxType("Protótipo - Termos"), "proto");
  assert.equal(baseTitle("Protótipo - Registro Tardio de Atendimento"), "registro tardio de atendimento");
});

test("Frente oculta (Instagram) não aparece nem conta", () => {
  const b = uxBoard(DATA, { hiddenFronts: ["Instagram"] });
  assert.deepEqual(b.fronts.map((f) => f.name), ["Meeds All"]);
  assert.ok(!b.cols.flatMap((c) => c.items).some((i) => i.key === "UX-100"));
});

test("alertas: aguardando há muito tempo e par sem vínculo", () => {
  const b = uxBoard(DATA, { hiddenFronts: ["Instagram"] });
  assert.ok(b.alerts.some((a) => a.kind === "ask" && a.item.key === "UX-264"));
  const link = b.alerts.find((a) => a.kind === "link");
  assert.equal(link.item.key, "UX-173");
  assert.equal(link.hu.key, "MEED-753");
});

test("feito nesta semana só conta a semana atual", () => {
  const b = uxBoard(DATA, { hiddenFronts: ["Instagram"] });
  assert.deepEqual(b.cols.find((c) => c.id === "done").items.map((i) => i.key), ["UX-426"]);
});

test("entregas: protótipo feito com HU parada no backlog", () => {
  const h = uxHandoff(DATA, { hiddenFronts: ["Instagram"] });
  assert.equal(h.groups.find((g) => g.id === "wait").items.length, 2);
  assert.deepEqual(h.noProto.map((x) => x.key), ["MEED-2278"]);
  assert.equal(huStage({ status: { name: "Pronto Para Desenvolvimento", cat: "new" } }), "ready");
});

test("demanda: cliente, sem tela, par e Sem tela marcado", () => {
  const d = uxDemand(DATA, { filter: "client" });
  assert.deepEqual(d.list.map((x) => x.key), ["MEED-753"]);
  assert.equal(d.list[0].pair.key, "UX-173");
  assert.deepEqual(uxDemand(DATA, { filter: "noscreen" }).list.map((x) => x.key), ["MEED-981"]);
  assert.equal(uxDemand(DATA, { filter: "client", skipped: ["MEED-753"] }).list.length, 0);
});

test("progresso: semanas e HUs prototipadas por mês", () => {
  const p = uxProgress(DATA, { goal: 8, hiddenFronts: ["Instagram"] });
  assert.equal(p.series.length, 9);
  assert.equal(p.thisWeek.count, 1);
  assert.equal(p.months[p.months.length - 1].n, 1);
  assert.equal(uxFronts([{ front: "A", col: "done" }]).length, 0);
});
