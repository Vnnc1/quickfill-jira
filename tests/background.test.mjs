import test from "node:test";
import assert from "node:assert/strict";

let sequence = 0;
const json = (body, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

/** Executa o roteador real do service worker; nenhuma chamada sai para a rede. */
async function worker(t, fetchHandler) {
  const config = { baseUrl: "https://test.atlassian.net", email: "test@example.com", apiToken: "fake" };
  let listener;
  const calls = [];
  const local = {};
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  globalThis.chrome = {
    storage: { sync: { get: async (defaults) => ({ ...structuredClone(defaults), ...config }) },
      local: { get: async (defaults) => ({ ...structuredClone(defaults), ...local }), set: async (values) => Object.assign(local, values) } },
    runtime: {
      getManifest: () => ({ version: "0.0.0" }),
      onMessage: { addListener: (fn) => { listener = fn; } },
      sendMessage: async () => {},
    },
    commands: { onCommand: { addListener() {} } },
  };
  globalThis.fetch = async (url, options = {}) => {
    const call = { url: new URL(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    return fetchHandler(call, config);
  };
  t.after(() => { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; });
  await import(`../src/background.js?test=${sequence++}`);
  return { config, calls, send: (type, payload = {}) => new Promise((resolve) => {
    listener({ type, payload }, { id: "test-extension" }, resolve);
  }) };
}

const me = (accountId = "me") => ({ accountId, displayName: accountId });
const truncatedIssue = { key: "TEST-1", fields: { summary: "Teste", worklog: { total: 2, worklogs: [] } } };
const progressParams = { from: "2026-10-22", to: "2026-10-22" };

test("aviso de atualização entrega o histórico do perfil e preserva os dados no cache", async (t) => {
  const changelog = [{ version: "5.0.0", date: "2026-10-22", changes: ["Ajudante opcional"] },
    { version: "4.9.0", date: "2026-10-21", changes: ["Correção intermediária"] }];
  const env = await worker(t, ({ url }) => {
    assert.equal(url.pathname, "/update.json");
    return json({ version: "9.0.0", notes: "Nota de outro perfil", packages: {
      qa: { version: "5.0.0", notes: "Nota do QA", changelog }, dev: { version: "9.0.0", notes: "Nota do DEV" },
    } });
  });
  env.config.updateUrl = "https://updates.example.com/update.json";
  const first = await env.send("CHECK_UPDATE");
  assert.equal(first.ok, true, first.error);
  assert.equal(first.data.latest, "5.0.0");
  assert.equal(first.data.notes, "Nota do QA");
  assert.equal(first.data.newer, true);
  assert.deepEqual(first.data.changelog, changelog);
  assert.deepEqual((await env.send("CHECK_UPDATE")).data.changelog, changelog);
  assert.equal(env.calls.length, 1);
  await env.send("CHECK_UPDATE", { force: true });
  assert.equal(env.calls.length, 2);
});

const adfContentText = (node) => typeof node === "string" ? node
  : [node?.text || "", ...(node?.content || []).map(adfContentText)].filter(Boolean).join("\n");

test("clonagem DESIGN mantém a referência à HU sem assinatura, inclusive no fallback de prioridade", async (t) => {
  let rejectPriority = true;
  const env = await worker(t, ({ url, method, body }) => {
    if (url.pathname.endsWith("/issuetypes")) return json({ issueTypes: [{ id: "1", name: "HU" }] });
    if (url.pathname.endsWith("/TEST-1") && method === "GET") return json({ fields: { summary: "Refinamento do QuickFill", priority: { id: "3" } } });
    if (url.pathname === "/rest/api/3/issue" && method === "POST") {
      if (rejectPriority) { rejectPriority = false; return json({ errorMessages: ["priority inválida"] }, 400); }
      return json({ key: "UX-1" }, 201);
    }
    if (url.pathname.endsWith("/issueLinkType")) return json({ issueLinkTypes: [{ name: "Cloners" }] });
    if (url.pathname.endsWith("/issueLink")) return json(null, 204);
    assert.fail(`requisição inesperada: ${method} ${url}`);
  });
  const res = await env.send("UX_ACTION", { op: "clone", hu: "TEST-1" });
  assert.equal(res.ok, true, res.error);
  const creates = env.calls.filter((c) => c.url.pathname === "/rest/api/3/issue");
  assert.equal(creates.length, 2);
  for (const c of creates) {
    assert.equal(c.body.fields.summary, "HU: Refinamento do QuickFill");
    assert.equal(c.body.fields.description.content.length, 1);
    assert.equal(adfContentText(c.body.fields.description), "Protótipo da HU \nTEST-1\n.");
    assert.equal(c.body.fields.description.content[0].content[1].marks[0].attrs.href, "https://test.atlassian.net/browse/TEST-1");
  }
  assert.ok(env.calls.some((c) => c.url.pathname.endsWith("/issueLink")));
});

test("Execuções DESIGN publica descrição, horas e resumo sem assinaturas e preserva o conteúdo", async (t) => {
  const env = await worker(t, ({ url, method }) => {
    if (url.pathname.endsWith("/myself")) return json(me());
    if (method === "PUT") return json(null, 204);
    if (method === "POST" && /\/(worklog|comment)$/.test(url.pathname)) return json({ id: "1" }, 201);
    assert.fail(`requisição inesperada: ${method} ${url}`);
  });
  const title = "Refinamento do QuickFill";
  const res = await env.send("EXEC_SAVE", { key: "TEST-1", descChanged: true, desc: "Projeto QuickFill\nRevisar os quatro perfis",
    items: [{ id: "1", t: "horas", title, tier: "feito", field: "30m" },
      { id: "2", t: "nota", title: "Validação", tier: "agora", detail: "Ajuste do QuickFill concluído" }] });
  assert.equal(res.ok, true, res.error);
  const description = env.calls.find((c) => c.body?.fields?.description).body.fields.description;
  assert.equal(adfContentText(description), "Projeto QuickFill\nRevisar os quatro perfis");
  const log = env.calls.find((c) => c.url.pathname.endsWith("/worklog"));
  assert.equal(adfContentText(log.body.comment), title);
  assert.equal(log.body.timeSpent, "30m");
  const summary = env.calls.find((c) => c.url.pathname.endsWith("/comment")).body.body;
  const text = adfContentText(summary);
  assert.match(text, /Execuções da demanda/);
  assert.ok(text.includes(title));
  assert.match(text, /Ajuste do QuickFill concluído/);
  assert.doesNotMatch(text, /Atualizado por|pelo QuickFill|\(QuickFill DESIGN\)/);
  const prop = env.calls.find((c) => c.url.pathname.includes("/properties/"));
  assert.equal(prop.body.by, "me");
  assert.equal(prop.body.items[0].logged, true);
});

test("deploy SCRUM preserva descrição, cards e vínculos sem assinatura ou ADF vazio", async (t) => {
  const env = await worker(t, ({ url, method }) => {
    if (url.pathname.endsWith("/issuetypes")) return json({ issueTypes: [{ id: "1", name: "Tarefa" }] });
    if (url.pathname === "/rest/api/3/issue") return json({ key: "TEST-10" }, 201);
    if (url.pathname.endsWith("/issueLinkType")) return json({ issueLinkTypes: [{ name: "Relates" }] });
    if (method === "POST") return json(null, 204);
    assert.fail(`requisição inesperada: ${method} ${url}`);
  });
  for (const filled of [true, false]) {
    const res = await env.send("CREATE_DEPLOY_CARD", { project: "TEST", summary: "Deploy do QuickFill", assigneeId: "dev",
      description: filled ? "Publicar melhorias do QuickFill" : "", keys: filled ? ["TEST-2"] : [],
      items: [{ key: "TEST-2", summary: "Ajustes do QuickFill" }], link: true, sprintId: 17 });
    assert.equal(res.ok, true, res.error);
    const fields = env.calls.filter((c) => c.url.pathname === "/rest/api/3/issue").at(-1).body.fields;
    assert.equal(fields.summary, "Deploy do QuickFill");
    assert.equal(fields.assignee.accountId, "dev");
    if (filled) {
      assert.equal(fields.description.content.length, 3);
      const text = adfContentText(fields.description);
      assert.match(text, /Publicar melhorias do QuickFill/);
      assert.match(text, /TEST-2/);
      assert.doesNotMatch(text, /Criado pelo QuickFill/);
    } else assert.equal(fields.description, undefined);
  }
  assert.ok(env.calls.some((c) => c.url.pathname.endsWith("/issueLink")));
  assert.ok(env.calls.some((c) => c.url.pathname === "/rest/agile/1.0/sprint/17/issue"));
});

test("handoff DESIGN publica checklist, notas e link sem assinatura", async (t) => {
  const env = await worker(t, ({ url, method }) => {
    if (url.pathname.endsWith("/myself")) return json(me());
    if (method === "PUT") return json(null, 204);
    if (url.pathname.endsWith("/comment")) return json({ id: "1" }, 201);
    assert.fail(`requisição inesperada: ${method} ${url}`);
  });
  const res = await env.send("HANDOFF_SAVE", { key: "TEST-1", publish: true, items: { layout: true },
    labels: { layout: "Layout validado" }, notes: "Revisão do QuickFill concluída", figma: "https://figma.com/design/test" });
  assert.equal(res.ok, true, res.error);
  const text = adfContentText(env.calls.find((c) => c.url.pathname.endsWith("/comment")).body.body);
  assert.match(text, /Handoff de design concluído/);
  assert.match(text, /Layout validado/);
  assert.match(text, /Revisão do QuickFill concluída/);
  assert.match(text, /https:\/\/figma.com\/design\/test/);
  assert.doesNotMatch(text, /Registrado por|pelo QuickFill DESIGN/);
  assert.equal(res.data.by, "me");
});

test("ação de evidência retirada não aceita publicação nem faz chamadas ao Jira", async (t) => {
  const env = await worker(t, ({ url }) => assert.fail(`requisição inesperada: ${url}`));
  const res = await env.send("POST_EVIDENCE", { key: "TEST-1", result: "rejected", category: "Layout", steps: "Teste antigo" });
  assert.equal(res.ok, false);
  assert.match(res.error, /desconhecida/);
  assert.equal(env.calls.length, 0);
});

test("atividade da linha do tempo cria descrição sem assinatura e preserva texto do usuário", async (t) => {
  let created = 0;
  const env = await worker(t, ({ url, method }) => {
    if (url.pathname.endsWith("/issuetypes")) return json({ issueTypes: [{ id: "1", name: "Tarefa", subtask: false }] });
    if (url.pathname.endsWith("/myself")) return json(me());
    if (url.pathname === "/rest/api/3/issue" && method === "POST") return json({ key: `TEST-${++created}` }, 201);
    if (url.pathname.endsWith("/editmeta")) return json({ fields: {} });
    if (url.pathname.endsWith("/transitions")) return json({ transitions: [] });
    if (/\/issue\/TEST-\d+$/.test(url.pathname) && method === "GET") return json({ key: `TEST-${created}`, fields: { summary: "Refinamento do QuickFill" } });
    if (url.pathname.endsWith("/search/jql")) return json({ issues: [] });
    if (url.pathname.endsWith("/worklog") && method === "POST") return json({ id: "1" }, 201);
    if (method === "PUT") return json(null, 204);
    assert.fail(`requisição inesperada: ${method} ${url}`);
  });
  const desc = "Avançando no projeto do QuickFill\nAjustes para quatro perfis";
  for (const text of [desc, ""]) {
    const res = await env.send("CREATE_MEETING_ISSUE", { project: "TEST", title: "Refinamento do QuickFill",
      desc: text, date: "2026-10-22", start: 660, end: 690 });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.ok, true, JSON.stringify(res.data.steps));
    const fields = env.calls.filter((c) => c.url.pathname === "/rest/api/3/issue" && c.method === "POST").at(-1).body.fields;
    if (text) assert.deepEqual(fields.description, { type: "doc", version: 1,
      content: text.split("\n").map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })) });
    else assert.equal(fields.description, undefined);
    assert.equal(fields.assignee.accountId, "me");
    const log = env.calls.filter((c) => c.url.pathname.endsWith("/worklog") && c.method === "POST").at(-1);
    assert.equal(log.body.timeSpent, "30m");
    assert.equal(log.body.comment.content[0].content[0].text, "Refinamento do QuickFill");
  }
});

test("estimativa automática preserva a existente no envio individual e em lote", async (t) => {
  const env = await worker(t, ({ url, method }) => {
    if (url.pathname.endsWith("/myself")) return json(me());
    if (url.pathname.endsWith("/search/jql")) return json({ issues: [] });
    if (url.pathname.endsWith("/worklog") && method === "POST") return json({ id: "1" }, 201);
    if (method === "PUT") return json(null, 204);
    assert.fail(`requisição inesperada: ${url}`);
  });
  for (const type of ["APPLY", "APPLY_BATCH"]) {
    const before = env.calls.length;
    const res = await env.send(type, { key: "TEST-1", timeSpent: "30m", startDate: "2026-10-22",
      originalEstimate: "30m", currentEstimate: "1h 4m", preserveExistingEstimate: true,
      targets: [{ key: "TEST-1", currentEstimate: "1h 4m" }, { key: "TEST-2", currentEstimate: null }] });
    assert.equal(res.ok, true, res.error);
    const writes = env.calls.slice(before).filter((c) => c.method === "PUT" && c.body?.fields?.timetracking);
    if (type === "APPLY") assert.equal(writes.length, 0);
    else {
      assert.equal(writes.length, 1);
      assert.ok(writes[0].url.pathname.endsWith("/TEST-2"));
      assert.equal(writes[0].body.fields.timetracking.originalEstimate, "30m");
    }
    assert.ok(env.calls.slice(before).some((c) => c.method === "POST" && c.url.pathname.endsWith("/worklog")));
  }
});

test("roteador bloqueia aplicação individual e em lote quando há apontamentos ilegíveis", async (t) => {
  const env = await worker(t, async ({ url }) => {
    if (url.pathname.endsWith("/myself")) return json(me());
    if (url.pathname.endsWith("/search/jql")) return json({ issues: [truncatedIssue] });
    if (url.pathname.endsWith("/worklog")) return json({ errorMessages: ["sem permissão"] }, 403);
    assert.fail(`requisição inesperada: ${url}`);
  });
  const payload = { key: "TEST-1", timeSpent: "1h", startDate: "2026-10-22" };
  for (const type of ["APPLY", "APPLY_BATCH"]) {
    const result = await env.send(type, { ...payload, targets: [{ key: "TEST-1" }] });
    assert.equal(result.ok, false);
    assert.match(result.error, /conferir os horários ocupados/);
  }
  assert.equal(env.calls.filter((c) => c.method !== "GET" && !c.url.pathname.endsWith("/search/jql")).length, 0);
});

test("prévia expõe falha e próxima leitura busca novamente em vez de usar totais parciais", async (t) => {
  let failing = true;
  const env = await worker(t, async ({ url }) => {
    if (url.pathname.endsWith("/myself")) return json(me());
    if (url.pathname.endsWith("/search/jql")) return json({ issues: [truncatedIssue] });
    if (url.pathname.endsWith("/worklog")) return failing
      ? json({ errorMessages: ["sem permissão"] }, 403)
      : json({ total: 1, worklogs: [{ id: "1", author: me(), started: "2026-10-22T11:00:00", timeSpentSeconds: 3600 }] });
    assert.fail(`requisição inesperada: ${url}`);
  });
  const preview = await env.send("PLAN_PREVIEW", { startDate: "2026-10-22", timeSpent: "30m" });
  assert.equal(preview.ok, true);
  assert.match(preview.data.busyError, /conferir os apontamentos/);
  const failed = await env.send("MY_PROGRESS", progressParams);
  assert.equal(failed.ok, false);
  failing = false;
  const recovered = await env.send("MY_PROGRESS", progressParams);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.data.days["2026-10-22"][0].minutes, 60);
});

test("service worker compartilha consultas simultâneas de progresso e identidade", async (t) => {
  const env = await worker(t, async ({ url }) => {
    await tick();
    if (url.pathname.endsWith("/myself")) return json(me());
    if (url.pathname.endsWith("/search/jql")) return json({ issues: [] });
    assert.fail(`requisição inesperada: ${url}`);
  });
  const results = await Promise.all(Array.from({ length: 20 }, () => env.send("MY_PROGRESS", progressParams)));
  assert.ok(results.every((r) => r.ok));
  assert.equal(env.calls.filter((c) => c.url.pathname.endsWith("/myself")).length, 1);
  assert.equal(env.calls.filter((c) => c.url.pathname.endsWith("/search/jql")).length, 1);
});

test("troca de conexão não reutiliza identidade nem progresso da conta anterior", async (t) => {
  const env = await worker(t, async ({ url }, config) => {
    if (url.pathname.endsWith("/myself")) return json(me(config.email));
    if (url.pathname.endsWith("/search/jql")) return json({ issues: [] });
    assert.fail(`requisição inesperada: ${url}`);
  });
  const first = await env.send("MY_PROGRESS", progressParams);
  env.config.email = "other@example.com";
  const second = await env.send("MY_PROGRESS", progressParams);
  assert.notEqual(first.data.me.accountId, second.data.me.accountId);
  assert.equal(env.calls.filter((c) => c.url.pathname.endsWith("/myself")).length, 2);
  assert.equal(env.calls.filter((c) => c.url.pathname.endsWith("/search/jql")).length, 2);
});

test("períodos simultâneos de Demandas e mudança de projeto mantêm o escopo correto", async (t) => {
  let searchCount = 0;
  const env = await worker(t, async ({ url, body }) => {
    if (url.pathname.endsWith("/myself")) return json(me());
    if (url.pathname.endsWith("/status") || url.pathname.endsWith("/priority")) return json([]);
    if (url.pathname.endsWith("/board")) return json({ values: [] });
    if (url.pathname.endsWith("/search/jql")) {
      searchCount++;
      // A busca com período menor termina depois da maior.
      if (searchCount === 1) await new Promise((resolve) => setTimeout(resolve, 15));
      return json({ issues: [{ key: "TEST-1", fields: { summary: body.jql, worklog: { total: 0, worklogs: [] } } }] });
    }
    assert.fail(`requisição inesperada: ${url}`);
  });
  const [short, long] = await Promise.all([env.send("MY_DEMANDS", { days: 15 }), env.send("MY_DEMANDS", { days: 45 })]);
  assert.equal(short.data.days, 15);
  assert.equal(long.data.days, 45);
  const again = await env.send("MY_DEMANDS", { days: 45 });
  assert.equal(again.data.days, 45);
  assert.equal(searchCount, 2);
  env.config.defaultProject = "OTHER";
  const changed = await env.send("MY_DEMANDS", { days: 45 });
  assert.equal(changed.data.spaces[0].project, "OTHER");
  assert.match(changed.data.issues[0].summary, /"OTHER"/);
});

test("horas de Execuções invalidam o progresso em cache", async (t) => {
  let searches = 0;
  const env = await worker(t, async ({ url }) => {
    if (url.pathname.endsWith("/myself")) return json(me());
    if (url.pathname.endsWith("/search/jql")) { searches++; return json({ issues: [] }); }
    if (url.pathname.endsWith("/worklog")) return json({ id: "123" }, 201);
    if (url.pathname.includes("/properties/")) return json(null, 204);
    assert.fail(`requisição inesperada: ${url}`);
  });
  assert.equal((await env.send("MY_PROGRESS", progressParams)).ok, true);
  const saved = await env.send("EXEC_SAVE", { key: "TEST-1", comment: false,
    items: [{ id: 1, t: "horas", title: "Protótipo", tier: "feito", field: "30m" }] });
  assert.equal(saved.ok, true);
  assert.equal(saved.data.value.items[0].logged, true);
  assert.equal((await env.send("MY_PROGRESS", progressParams)).ok, true);
  assert.equal(searches, 2);
});
