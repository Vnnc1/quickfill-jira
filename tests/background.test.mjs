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
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  globalThis.chrome = {
    storage: { sync: { get: async (defaults) => ({ ...structuredClone(defaults), ...config }) } },
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
