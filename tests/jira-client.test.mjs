import test from "node:test";
import assert from "node:assert/strict";
import { createJiraClient } from "../src/lib/jira-client.js";

const cfg = { baseUrl: "https://example.atlassian.net", email: "test@example.com", apiToken: "fake-token" };
const response = (status, body = {}, headers) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers });

test("cliente preserva autenticação, corpo JSON e HTTP 204", async () => {
  const request = createJiraClient({ fetchFn: async (url, options) => {
    assert.equal(url, `${cfg.baseUrl}/issue`);
    assert.equal(options.headers.Authorization, `Basic ${btoa(`${cfg.email}:${cfg.apiToken}`)}`);
    assert.equal(options.body, JSON.stringify({ fields: {} }));
    return response(204);
  } });
  assert.equal(await request("/issue", { cfg, method: "PUT", body: { fields: {} } }), null);
});

test("Retry-After acima de 30s é respeitado integralmente", async () => {
  let clock = 0, calls = 0;
  const waits = [];
  const request = createJiraClient({ now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; },
    fetchFn: async () => ++calls === 1 ? response(429, {}, { "Retry-After": "75" }) : response(200, { ok: true }) });
  assert.deepEqual(await request("/read", { cfg }), { ok: true });
  assert.deepEqual(waits, [30_000, 30_000, 15_000]);
  assert.equal(clock, 75_000);
});

test("Retry-After em data HTTP e pausa compartilhada após escrita recusada", async () => {
  let clock = Date.parse("2026-10-22T12:00:00Z"), calls = 0;
  const request = createJiraClient({ now: () => clock, sleep: async (ms) => { clock += ms; },
    fetchFn: async () => ++calls === 1
      ? response(429, {}, { "Retry-After": "Thu, 22 Oct 2026 12:01:00 GMT" })
      : response(200, { ok: true }) });
  await assert.rejects(request("/worklog", { cfg, method: "POST", body: {} }), { status: 429 });
  assert.equal(calls, 1);
  await request("/read", { cfg });
  assert.equal(clock, Date.parse("2026-10-22T12:01:00Z"));
});

test("leituras POST podem repetir 503; escritas não são repetidas automaticamente", async () => {
  let calls = 0;
  const request = createJiraClient({ sleep: async () => {}, fetchFn: async () => ++calls === 1 ? response(503) : response(200, { issues: [] }) });
  assert.deepEqual(await request("/search/jql", { cfg, method: "POST", readOnly: true }), { issues: [] });
  assert.equal(calls, 2);
  for (const method of ["POST", "PUT", "DELETE"]) {
    calls = 0;
    await assert.rejects(request("/issue", { cfg, method }), { status: 503 });
    assert.equal(calls, 1);
  }
});

test("retry tem limite; erros HTTP mantêm status e detalhes", async () => {
  let calls = 0;
  const request = createJiraClient({ sleep: async () => {}, fetchFn: async () => {
    calls++;
    return response(503, { errors: { summary: "indisponível" } });
  } });
  await assert.rejects(request("/read", { cfg, retries: 2 }), (e) => e.status === 503 && /summary: indisponível/.test(e.message));
  assert.equal(calls, 3);
});

test("limite global de rede inclui leituras dos corpos das respostas", async () => {
  let active = 0, peak = 0;
  const request = createJiraClient({ concurrency: 3, fetchFn: async () => {
    active++;
    peak = Math.max(peak, active);
    return { ok: true, status: 200, text: async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return "{}";
    } };
  } });
  await Promise.all(Array.from({ length: 15 }, () => request("/read", { cfg })));
  assert.equal(peak, 3);
  assert.equal(active, 0);
});

test("timeout libera a fila sem repetir operação de resultado incerto", async () => {
  let calls = 0;
  const request = createJiraClient({ concurrency: 1, timeoutMs: 5, fetchFn: async (_url, { signal }) => {
    calls++;
    if (calls > 1) return response(200, { recovered: true });
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  } });
  const slow = request("/worklog", { cfg, method: "POST" });
  const queued = request("/read", { cfg });
  await assert.rejects(slow, /demorou demais/);
  assert.deepEqual(await queued, { recovered: true });
  assert.equal(calls, 2);
});

test("HTML com HTTP 200 é erro e não vira zero horas", async () => {
  const request = createJiraClient({ fetchFn: async () => new Response("<html>login</html>", { status: 200 }) });
  await assert.rejects(request("/read", { cfg }), /JSON inválida/);
});

test("resposta JSON null é válida e falha de rede não repete escrita", async () => {
  assert.equal(await createJiraClient({ fetchFn: async () => response(200, null) })("/read", { cfg }), null);
  let calls = 0;
  const request = createJiraClient({ fetchFn: async () => { calls++; throw new Error("offline"); } });
  await assert.rejects(request("/worklog", { cfg, method: "POST" }), /offline/);
  assert.equal(calls, 1);
});
