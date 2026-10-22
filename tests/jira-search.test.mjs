import test from "node:test";
import assert from "node:assert/strict";
import { searchIssues } from "../src/lib/jira-search.js";

const query = { jql: "project = TEST", fields: ["summary"], max: 3, cfg: {} };
const httpError = (status, message = `HTTP ${status}`) => Object.assign(new Error(message), { status });

test("paginação com token preserva expand e limita a última página", async () => {
  const requests = [];
  const result = await searchIssues(async (path, options) => {
    requests.push({ path, ...options });
    return requests.length === 1
      ? { issues: [1, 2], nextPageToken: "next" }
      : { issues: [3, 4], isLast: true };
  }, { ...query, expand: "changelog" });
  assert.deepEqual(result, [1, 2, 3]);
  assert.equal(requests[1].body.maxResults, 1);
  assert.equal(requests[1].body.nextPageToken, "next");
  assert.equal(requests[1].body.expand, "changelog");
  assert.equal(requests[0].readOnly, true);
});

test("fallback após erro de segunda página reinicia sem duplicar resultados", async () => {
  let calls = 0;
  const legacy = [];
  const result = await searchIssues(async (path) => {
    calls++;
    if (calls === 1) return { issues: ["parcial"], nextPageToken: "next" };
    if (calls === 2) throw httpError(404);
    const params = new URL(path, "https://test").searchParams;
    legacy.push(params);
    return params.get("startAt") === "0" ? { issues: [1, 2], total: 3 } : { issues: [3], total: 3 };
  }, { ...query, expand: "changelog" });
  assert.deepEqual(result, [1, 2, 3]);
  assert.equal(legacy[0].get("startAt"), "0");
  assert.equal(legacy[1].get("maxResults"), "1");
  assert.equal(legacy[1].get("expand"), "changelog");
});

test("mensagem contendo 404 não esconde erro real de JQL ou permissão", async () => {
  let calls = 0;
  await assert.rejects(searchIssues(async () => {
    calls++;
    throw httpError(400, "Jira 400: issue TEST-404 inválida");
  }, query), { status: 400 });
  assert.equal(calls, 1);
});

test("endpoint antigo sem total continua até página vazia", async () => {
  let calls = 0;
  const result = await searchIssues(async (path) => {
    calls++;
    if (path.endsWith("/jql")) throw httpError(405);
    return { issues: calls === 2 ? [1] : calls === 3 ? [2] : [] };
  }, query);
  assert.deepEqual(result, [1, 2]);
  assert.equal(calls, 4);
});

test("token repetido interrompe paginação sem entrar em loop", async () => {
  let calls = 0;
  await assert.rejects(searchIssues(async () => {
    calls++;
    return { issues: [], nextPageToken: "same" };
  }, query), /repetiu a página/);
  assert.equal(calls, 2);
});

test("limite zero não consulta e limite inválido é rejeitado", async () => {
  assert.deepEqual(await searchIssues(() => assert.fail("consulta desnecessária"), { ...query, max: 0 }), []);
  await assert.rejects(searchIssues(() => {}, { ...query, max: Infinity }), /inválido/);
});
