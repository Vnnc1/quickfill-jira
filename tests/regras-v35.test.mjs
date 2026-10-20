/* Regras da 3.5: Impedido/Validado, reaberturas, QA fora do WIP, período e Demandas do DEV. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stageFrom, reopenEvents, qaMatcher, peopleLoad, sprintRisks, flowMetrics, sprintHealth } from "../src/lib/teamstats.js";
import { demandBoard, deployLabel, periodStats, DEMAND_GROUPS } from "../src/lib/devstats.js";

const ms = (iso, h = 12) => Date.parse(`${iso}T${String(h).padStart(2, "0")}:00:00`);
const T = (at, fromKind, toKind, fromStage, toStage, fromName, toName, by = "q1", byName = "Almir Vinicius") =>
  ({ at: ms(at), from: fromName, to: toName, fromName, toName, fromKind, toKind, fromStage, toStage, by, byName });
const ANA = { id: "d1", name: "Ana Dev" }, ALMIR = { id: "q1", name: "Almir Vinicius" }, JHON = { id: "q2", name: "Jhonathan Pinheiro" };
let n = 1;
const issue = (o) => ({ key: `MEED-${n++}`, project: "MEED", summary: "x", type: "Tarefa", isSubtask: false, parentKey: null,
  status: { id: "1", name: "Em andamento", cat: "indeterminate" }, kind: "other", assignee: ANA, priority: null, points: 0,
  flagged: false, due: null, created: ms("2026-10-06", 9), updated: ms("2026-10-15"), catChanged: null, labels: [], estimate: 0, spent: 0,
  sprints: [], transitions: [], ...o });

test("Impedido/Aguardando e Validado são etapas próprias", () => {
  assert.equal(stageFrom("blocked", "indeterminate"), "blocked");
  assert.equal(stageFrom("validated", "indeterminate"), "validated");
  assert.equal(stageFrom("validated", "done"), "done");
});

test("reaberturas contam cada entrada em Reaberto", () => {
  const i = issue({ transitions: [
    T("2026-10-07", "other", "qa", "doing", "qa", "Em andamento", "Validação", "d1", "Ana Dev"),
    T("2026-10-08", "qa", "reopen", "qa", "doing", "Validação", "Reaberto"),
    T("2026-10-09", "reopen", "other", "doing", "doing", "Reaberto", "Em andamento", "d1", "Ana Dev"),
    T("2026-10-10", "other", "qa", "doing", "qa", "Em andamento", "Validação", "d1", "Ana Dev"),
    T("2026-10-13", "qa", "reopen", "qa", "doing", "Validação", "Reaberto", "q2", "Jhonathan Pinheiro"),
  ] });
  assert.equal(reopenEvents(i).length, 2);
  assert.equal(reopenEvents(i, ms("2026-10-12")).length, 1);   // filtro de período
  // Validação → Em andamento direto (sem Reaberto) não conta quando o quadro tem a coluna Reaberto
  const j = issue({ transitions: [T("2026-10-08", "qa", "other", "qa", "doing", "Validação", "Em andamento")] });
  assert.equal(reopenEvents(j).length, 0);
});

test("equipe de QA casa por nome e fica fora do WIP e das sugestões", () => {
  const isQa = qaMatcher([{ name: "Almir Vinicius" }, { accountId: "q2", name: "Jhonathan" }]);
  assert.ok(isQa("x", "Almir Vinicius Souza"));
  assert.ok(isQa("q2", "Outro Nome"));
  assert.ok(!isQa("d1", "Ana Dev"));
  const issues = [
    issue({ assignee: ALMIR }), issue({ assignee: ALMIR }), issue({ assignee: ALMIR }),
    issue({ assignee: ANA, status: { id: "9", name: "A fazer", cat: "new" } }),
    issue({ assignee: null, status: { id: "9", name: "A fazer", cat: "new" } }),
  ];
  const r = peopleLoad(issues, { wipLimit: 2, qaPeople: [{ name: "Almir Vinicius" }] });
  const almir = r.people.find((p) => p.name === "Almir Vinicius");
  assert.equal(almir.isQa, true);
  assert.equal(almir.overWip, false);                 // 3 em andamento, mas é QA
  assert.equal(r.unassigned[0].suggestion.person.name, "Ana Dev");
  assert.deepEqual(r.qa.map((p) => p.name), ["Almir Vinicius"]);
});

test("fila do QA: só Validação (Validado sai da fila); Impedido entra em Impedidas", () => {
  const sprint = { start: "2026-10-06", end: "2026-10-17", issues: [
    issue({ kind: "qa", status: { id: "2", name: "Validação", cat: "indeterminate" }, transitions: [T("2026-10-14", "other", "qa", "doing", "qa", "Em andamento", "Validação", "d1", "Ana")] }),
    issue({ kind: "validated", status: { id: "3", name: "Validado", cat: "indeterminate" } }),
    issue({ kind: "blocked", status: { id: "4", name: "Impedido", cat: "indeterminate" } }),
  ] };
  const r = sprintRisks(sprint, { today: "2026-10-15" });
  assert.equal(r.qaQueue.length, 1);
  assert.equal(r.flagged.length, 1);
  assert.equal(r.flagged[0].why, "Impedido");
  const h = sprintHealth(sprint, "2026-10-15");
  assert.equal(h.byStage.validated.length, 1);
  assert.equal(h.byStage.blocked.length, 1);
  assert.equal(r.stalled.length, 0);                 // impedida não é "parada em andamento"
  const f = flowMetrics(sprint, { today: "2026-10-15" });
  assert.equal(f.blockedNow, 1);
});

test("DEV › Demandas: em seu nome primeiro, atuando agora, Feito só do período e nomes dos cards", () => {
  assert.deepEqual(DEMAND_GROUPS.map((g) => g.label), ["Em andamento", "Impedido", "Reaberto", "Feito", "Deploy DES/HMP", "Validação", "Finalizados"]);
  assert.equal(deployLabel("MEED", { batch: "MEED", sustentacao: "SUS" }), "Deploy DES");
  assert.equal(deployLabel("SUS", { batch: "MEED", sustentacao: "SUS" }), "Deploy HMP");
  const me = "d1";
  const t = (at, from, to, by = me) => ({ at: ms(at), from, to, fromName: from, toName: to, by, byName: "" });
  const dm = {
    today: "2026-10-15", me: { accountId: me }, spaces: [{ project: "MEED", kinds: {} }],
    statuses: { A: { name: "Em andamento", cat: "indeterminate" }, B: { name: "Impedido", cat: "indeterminate" }, C: { name: "Feito", cat: "indeterminate" }, D: { name: "A fazer", cat: "new" } },
    issues: [
      { key: "MEED-1", project: "MEED", summary: "", status: { id: "A", name: "Em andamento" }, assignee: { id: me }, transitions: [t("2026-10-10", "D", "A")], myMinutes: 60, myToday: 0, myByDay: {} },
      { key: "MEED-2", project: "MEED", summary: "", status: { id: "A", name: "Em andamento" }, assignee: { id: me }, transitions: [t("2026-10-12", "D", "A")], myMinutes: 90, myToday: 90, myByDay: { "2026-10-15": 90 } },
      { key: "MEED-3", project: "MEED", summary: "", status: { id: "B", name: "Impedido" }, assignee: { id: me }, transitions: [t("2026-10-11", "A", "B")], myMinutes: 0, myByDay: {} },
      { key: "MEED-4", project: "MEED", summary: "", status: { id: "C", name: "Feito" }, assignee: { id: me }, transitions: [t("2026-10-14", "A", "C")], myMinutes: 30, myByDay: {} },
      { key: "MEED-5", project: "MEED", summary: "", status: { id: "C", name: "Feito" }, assignee: { id: me }, transitions: [t("2026-10-15", "A", "C")], myMinutes: 30, myByDay: {} },
    ],
  };
  const b = demandBoard(dm, { mode: "today", now: ms("2026-10-15", 15) });
  assert.equal(b.acting.issue.key, "MEED-2");                  // mais horas hoje
  assert.equal(b.pending[0].issue.key, "MEED-2");
  assert.ok(b.pending.some((r) => r.kind === "blocked"));     // Impedido não vira "Em andamento"
  assert.deepEqual(b.groups.feito.map((r) => r.issue.key), ["MEED-5"]);   // Hoje: só o que entrou em Feito hoje
  const b7 = demandBoard(dm, { mode: "7", now: ms("2026-10-15", 15) });
  assert.equal(b7.groups.feito.length, 2);
});

test("Progresso: horas por espaço em cada dia e dias de atuação por demanda", () => {
  const prog = { from: "2026-10-13", to: "2026-10-15", skipWeekends: true, workday: { goal: 240, cap: 360 }, days: {
    "2026-10-13": [{ key: "MEED-1", minutes: 120, start: 660 }, { key: "SUS-9", minutes: 60, start: 800 }],
    "2026-10-15": [{ key: "MEED-1", minutes: 30, start: 660 }],
  } };
  const st = periodStats(prog, "2026-10-13", "2026-10-15", { keys: new Set(["MEED-1", "SUS-9"]) });
  assert.deepEqual(st.series[0].projects, { MEED: 120, SUS: 60 });
  const m1 = st.issues.find((i) => i.key === "MEED-1");
  assert.equal(m1.days, 2);
  assert.deepEqual(m1.byDay, { "2026-10-13": 120, "2026-10-15": 30 });
  const onlySprint = periodStats(prog, "2026-10-13", "2026-10-15", { keys: new Set(["SUS-9"]) });
  assert.equal(onlySprint.total, 60);
});

test("Pessoas: Scrum Master em coluna própria e contas de teste fora", () => {
  const MARJ = { id: "sm1", name: "Marjorie Pinheiro" }, TESTE = { id: "t1", name: "Teste Novetech" };
  const issues = [
    issue({ assignee: ANA, transitions: [T("2026-10-14", "other", "qa", "doing", "qa", "Em andamento", "Validação", "sm1", "Marjorie Pinheiro")] }),
    issue({ assignee: TESTE }),
    issue({ assignee: null, status: { id: "9", name: "A fazer", cat: "new" }, transitions: [T("2026-10-14", "other", "other", "todo", "todo", "A", "B", "t1", "Teste Novetech")] }),
  ];
  const r = peopleLoad(issues, { smPeople: [{ name: "Marjorie Pinheiro" }], ignorePeople: [{ name: "Teste Novetech" }] });
  assert.deepEqual(r.sm.map((p) => p.name), ["Marjorie Pinheiro"]);
  assert.equal(r.sm[0].moves, 1);
  assert.ok(!r.people.some((p) => p.name === "Teste Novetech"));
  assert.ok(!r.devs.some((p) => p.isSm));
  assert.equal(r.unassigned[0].suggestion.person.name, "Ana Dev");
});

test("Pessoas: Design UI fica fora das sugestões e das regras de WIP", () => {
  const AMANDA = { id: "ds1", name: "Amanda Saraiva Passos" };
  const issues = [
    issue({ assignee: ANA }), issue({ assignee: ANA }), issue({ assignee: ANA }),   // Ana acima do WIP
    issue({ assignee: AMANDA, status: { id: "9", name: "A fazer", cat: "new" } }),
    issue({ assignee: null, status: { id: "9", name: "A fazer", cat: "new" } }),
  ];
  const r = peopleLoad(issues, { wipLimit: 2, designPeople: [{ name: "Amanda Saraiva" }] });
  assert.deepEqual(r.design.map((p) => p.name), ["Amanda Saraiva Passos"]);
  assert.ok(!r.devs.some((p) => p.isDesign));
  assert.equal(r.design[0].free, false);
  assert.equal(r.unassigned[0].suggestion, null);   // só a Ana é dev, e está acima do WIP
});

test("subtarefa em PR com o pai concluído/validado não conta como em andamento", async () => {
  const { linkParents, stageOf: st, orphanOpen } = await import("../src/lib/teamstats.js");
  const pai = issue({ key: "MEED-2222", kind: "done", status: { id: "d", name: "Concluído", cat: "done" } });
  const sub = issue({ key: "MEED-2338", isSubtask: true, parentKey: "MEED-2222", kind: "feito", status: { id: "p", name: "PR", cat: "indeterminate" } });
  const sub2 = issue({ key: "MEED-2330", isSubtask: true, parentKey: "MEED-2222", kind: "other", status: { id: "a", name: "Em Andamento", cat: "indeterminate" } });
  const pai2 = issue({ key: "MEED-2262", kind: "other" });
  const sub3 = issue({ key: "MEED-2264", isSubtask: true, parentKey: "MEED-2262", kind: "feito", status: { id: "p", name: "PR", cat: "indeterminate" } });
  linkParents([pai, sub, sub2, pai2, sub3]);
  assert.equal(st(sub), "done");
  assert.equal(st(sub2), "done");
  assert.ok(orphanOpen(sub2));
  assert.equal(st(sub3), "feito");                 // pai ainda em andamento: PR = aguardando deploy
  const r = peopleLoad([pai, sub, sub2], {});
  assert.equal(r.people[0].wip, 0);
  const risks = sprintRisks({ start: "2026-10-06", issues: [pai, sub, sub2] }, { today: "2026-10-15" });
  assert.equal(risks.orphanSubs.length, 2);
});

test("PR (pull request) é a coluna de Feito do MEED; PRD continua deploy de produção", async () => {
  const { feitoLabel } = await import("../src/lib/devstats.js");
  assert.equal(feitoLabel("MEED", { batch: "MEED", sustentacao: "SUS" }), "PR");
  assert.equal(feitoLabel("SUS", { batch: "MEED", sustentacao: "SUS" }), "Feito");
  assert.equal(feitoLabel("", {}), "Feito / PR");
  const src = (await import("node:fs")).readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  const FEITO = eval(src.match(/const FEITO_RX = (\/.*?\/i);/)[1]);
  const PRD = eval(src.match(/const PRD_RX = (\/.*?\/i);/)[1]);
  assert.ok(FEITO.test("pr") && FEITO.test("pull request"));
  assert.ok(!FEITO.test("deploy prd") && PRD.test("deploy prd"));
});

test("Filas do quadro (Feito/PR, Validação, Impedidas) contam só os cards da sprint, como o Jira", async () => {
  const { linkParents } = await import("../src/lib/teamstats.js");
  const pai = issue({ key: "SUS-2290", kind: "feito", status: { id: "f", name: "Feito", cat: "indeterminate" } });
  const subFeito = issue({ key: "SUS-2291", isSubtask: true, parentKey: "SUS-2290", kind: "feito", status: { id: "f", name: "Feito", cat: "indeterminate" } });
  const pai2 = issue({ key: "MEED-2262", kind: "other" });
  const subPr = issue({ key: "MEED-2264", isSubtask: true, parentKey: "MEED-2262", kind: "feito", status: { id: "p", name: "PR", cat: "indeterminate" } });
  const subQa = issue({ key: "MEED-2265", isSubtask: true, parentKey: "MEED-2262", kind: "qa", status: { id: "q", name: "Validação", cat: "indeterminate" } });
  const subImp = issue({ key: "MEED-2266", isSubtask: true, parentKey: "MEED-2262", kind: "blocked", status: { id: "b", name: "Impedido", cat: "indeterminate" } });
  linkParents([pai, subFeito, pai2, subPr, subQa, subImp]);
  const r = sprintRisks({ start: "2026-10-06", issues: [pai, subFeito, pai2, subPr, subQa, subImp] }, { today: "2026-10-15" });
  assert.deepEqual(r.feitoQueue.map((x) => x.issue.key), ["SUS-2290"]);   // subtarefas em Feito/PR não viram "cards"
  assert.equal(r.qaQueue.length, 0);
  assert.equal(r.flagged.length, 0);
});
