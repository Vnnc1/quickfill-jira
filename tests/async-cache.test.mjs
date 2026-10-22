import test from "node:test";
import assert from "node:assert/strict";
import { createAsyncCache, connectionKey } from "../src/lib/async-cache.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test("cache compartilha leituras simultâneas da mesma chave", async () => {
  const cache = createAsyncCache({ ttlMs: 1000 });
  let calls = 0;
  const load = async () => { calls++; return 42; };
  assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => cache.get("a", load))), Array(20).fill(42));
  assert.equal(calls, 1);
});

test("períodos concorrentes mantêm seus resultados mesmo quando terminam fora de ordem", async () => {
  const cache = createAsyncCache({ ttlMs: 1000 });
  const a = deferred(), b = deferred();
  const first = cache.get("30 dias", () => a.promise);
  const second = cache.get("60 dias", () => b.promise);
  b.resolve("60");
  assert.equal(await second, "60");
  a.resolve("30");
  assert.equal(await first, "30");
  assert.equal(await cache.get("60 dias", () => assert.fail("cache perdido")), "60");
});

test("TTL começa no sucesso da leitura; force atualiza e LRU limita os valores", async () => {
  let clock = 0;
  const cache = createAsyncCache({ ttlMs: 100, maxEntries: 2, now: () => clock });
  const slow = deferred();
  const request = cache.get("a", () => slow.promise);
  clock = 200;
  slow.resolve(1);
  await request;
  clock = 299;
  assert.equal(await cache.get("a", () => 9), 1);
  clock = 300;
  assert.equal(await cache.get("a", () => 2), 2);
  assert.equal(await cache.get("a", () => 3, { force: true }), 3);
  await cache.get("b", () => 4);
  await cache.get("a", () => 9);
  await cache.get("c", () => 5);
  assert.equal(await cache.get("b", () => 6), 6);
});

test("falhas não são guardadas e podem ser recuperadas na próxima leitura", async () => {
  const cache = createAsyncCache({ ttlMs: 1000 });
  await assert.rejects(cache.get("a", () => { throw new Error("offline"); }), /offline/);
  assert.equal(await cache.get("a", () => "recuperado"), "recuperado");
});

test("invalidar durante uma leitura impede repopular o cache com dados antigos", async () => {
  const cache = createAsyncCache({ ttlMs: 1000 });
  const old = deferred(), fresh = deferred();
  const first = cache.get("a", () => old.promise);
  cache.clear();
  const second = cache.get("a", () => fresh.promise);
  old.resolve("antigo");
  await first;
  assert.equal(cache.get("a", () => assert.fail("perdeu a leitura nova")), second);
  fresh.resolve("novo");
  await second;
  assert.equal(await cache.get("a", () => 9), "novo");
});

test("identidade de cache muda com o site, conta ou token", () => {
  const cfg = { baseUrl: "https://a.atlassian.net", email: "a@a.com", apiToken: "fake" };
  for (const key of ["baseUrl", "email", "apiToken"]) {
    assert.notEqual(connectionKey(cfg), connectionKey({ ...cfg, [key]: "outro" }));
  }
});
