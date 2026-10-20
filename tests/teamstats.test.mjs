/* Testes das métricas do SCRUM e do DESIGN — rode com: npm test (ou node --test "tests/*.test.mjs") */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scrum, design } from "./fixture.mjs";
import {
  stageFrom, stageOf, isReturn, termsRx, normName, typeGroup, returnCauses, sprintTree,
  sprintHealth, peopleLoad, sprintRisks, designBoard, designStageOf, designRules,
} from "../src/lib/teamstats.js";

const sprint = scrum.spaces[0].sprints[0];

test("Feito e Deploy são etapas diferentes, na ordem do quadro", () => {
  assert.equal(stageFrom("feito", "indeterminate"), "feito");
  assert.equal(stageFrom("deploy", "indeterminate"), "deploy");
  assert.equal(stageFrom("prd", "indeterminate"), "deploy");
  assert.equal(stageFrom("qa", "indeterminate"), "qa");
  assert.equal(stageFrom("other", "new"), "todo");
  assert.equal(stageFrom("other", "done"), "done");
  assert.ok(isReturn({ fromStage: "feito", toStage: "doing" }));
  assert.ok(!isReturn({ fromStage: "doing", toStage: "feito" }));
});

test("nomes configuráveis ignoram acento/caixa e casam no começo da palavra", () => {
  const rx = termsRx("Validação, Homologação");
  assert.ok(rx.test(normName("VALIDACAO MEEDS ALL")));
  assert.ok(rx.test(normName("Em homologação")));
  assert.ok(!rx.test(normName("Invalidado")));
  assert.equal(termsRx("", "padrão"), "padrão");
});

test("tipos: HU, Bug e Tarefa", () => {
  assert.equal(typeGroup("História"), "hu");
  assert.equal(typeGroup("Story"), "hu");
  assert.equal(typeGroup("Bug"), "bug");
  assert.equal(typeGroup("Tarefa"), "task");
});

test("saúde da sprint conta só HUs/tarefas/bugs (subtarefas à parte)", () => {
  const h = sprintHealth(sprint, scrum.today);
  assert.equal(h.total, 15);
  assert.equal(h.done, 3);
  assert.equal(h.days.length, 9);       // 06/10/2026 é terça → 9 dias úteis até 17/10
  assert.equal(h.elapsed, 8);
  assert.equal(h.byStage.feito.length, 2);
  assert.equal(h.byStage.deploy.length, 1);
  assert.equal(h.series[0].remaining, 15);
  assert.equal(h.series.at(-1).future, true);
});

test("árvore da sprint mostra as subtarefas de cada demanda", () => {
  const t = sprintTree(sprint.issues).find((x) => x.issue.key === "MEED-106");
  assert.equal(t.subs.length, 2);
  assert.deepEqual(t.subs.map((i) => i.summary).sort(), ["Backend", "Testes Manuais"]);
});

test("pessoas: WIP, livre e sugestão para itens sem responsável", () => {
  const { people, unassigned } = peopleLoad(sprint.issues, scrum.settings);
  const bruno = people.find((p) => p.name === "Bruno Lima");
  assert.equal(bruno.overWip, true);
  assert.equal(people.find((p) => p.name === "Carla QA").free, false);   // tem itens em validação
  assert.equal(unassigned.length, 2);
  assert.ok(unassigned.every((u) => u.suggestion && !u.suggestion.person.overWip));
});

test("riscos da sprint, incluindo Feito aguardando deploy e causa do retorno", () => {
  const r = sprintRisks(sprint, { staleDays: 3, today: scrum.today, isHigh: (p) => p && p.rank <= 1 });
  assert.equal(r.flagged.length, 1);
  assert.equal(r.qaQueue.length, 3);
  assert.equal(r.feitoQueue.length, 2);
  assert.equal(r.overdue.length, 1);
  assert.equal(r.highTodo.length, 1);
  assert.equal(r.returned.length, 2);
  const withCause = r.returned.find((x) => returnCauses(x.issue).length);
  assert.deepEqual(returnCauses(withCause.issue), ["layout ui"]);
});

test("design: etapas, entregue ao dev e meta semanal", () => {
  const b = designBoard(design);
  assert.equal(b.groups.queue.length, 2);
  assert.equal(b.groups.doing.length, 1);
  assert.equal(b.groups.review.length, 1);
  assert.equal(b.groups.handoff.length, 2);   // "Pronto para dev" e "Em andamento" (dev)
  assert.equal(b.groups.delivered.length, 1);
  assert.equal(b.thisWeek, 1);
  assert.equal(b.rounds, 1);
  assert.equal(b.waiting.length, 3);
});

test("design: nomes de status das Opções substituem o padrão", () => {
  const R = designRules({ doing: "Criando tela", delivered: "Liberado" });
  assert.equal(designStageOf("Criando tela", "indeterminate", false, R), "doing");
  assert.equal(designStageOf("Liberado", "indeterminate", false, R), "handoff");
  assert.equal(designStageOf("Concluído", "done", false, R), "delivered");
});
