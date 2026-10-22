/** Transporte do Jira, sem dependência de chrome.*; relógio e rede injetáveis nos testes. */
export function createJiraClient({
  fetchFn = (...args) => fetch(...args),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  random = Math.random,
  concurrency = 6,
  timeoutMs = 30_000,
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Concorrência inválida.");
  let active = 0;
  const queue = [];
  const cooldowns = new Map();
  const acquire = () => active < concurrency
    ? (active++, Promise.resolve())
    : new Promise((resolve) => queue.push(resolve));
  const release = () => {
    if (queue.length) queue.shift()();
    else active--;
  };
  const waitForRateLimit = async (scope) => {
    while ((cooldowns.get(scope) || 0) > now()) {
      await sleep(Math.min(cooldowns.get(scope) - now(), 30_000));
    }
    cooldowns.delete(scope);
  };

  return async function request(path, { method = "GET", body, cfg, retries = 4, readOnly = false } = {}) {
    method = method.toUpperCase();
    const safeToRetry = readOnly || ["GET", "HEAD"].includes(method);
    const scope = cfg.baseUrl;
    for (let attempt = 0; ; attempt++) {
      await waitForRateLimit(scope);
      await acquire();
      let res, responseText;
      const controller = new AbortController();
      let timer;
      try {
        // Outra chamada pode receber 429 enquanto esta aguardava na fila.
        await waitForRateLimit(scope);
        timer = setTimeout(() => controller.abort(), timeoutMs);
        res = await fetchFn(`${cfg.baseUrl}${path}`, {
          method, signal: controller.signal,
          headers: { Authorization: "Basic " + btoa(`${cfg.email}:${cfg.apiToken}`), Accept: "application/json",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        // O timeout e o limite de concorrência incluem a leitura do corpo.
        responseText = res.status === 204 ? "" : await res.text();
        if (res.status === 429) {
          const header = res.headers?.get("Retry-After");
          const seconds = Number(header);
          const delay = header && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000
            : Math.max(0, Date.parse(header) - now()) || 2000 * 2 ** attempt;
          cooldowns.set(scope, Math.max(cooldowns.get(scope) || 0, now() + delay));
        }
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error("O Jira demorou demais para responder. Tente novamente.", { cause: error });
        }
        throw error;
      } finally {
        clearTimeout(timer);
        release();
      }

      if (safeToRetry && [429, 502, 503, 504].includes(res.status) && attempt < retries) {
        if (res.status !== 429) await sleep(400 * 2 ** attempt + random() * 200);
        continue;
      }
      if (res.status === 204) return null;
      let data = null;
      let invalidJson = false;
      try { data = responseText ? JSON.parse(responseText) : null; } catch { invalidJson = true; }
      if (!res.ok) {
        const detail = data?.errorMessages?.join(" | ")
          || (data?.errors && Object.entries(data.errors).map(([key, value]) => `${key}: ${value}`).join(" | "))
          || responseText.slice(0, 300) || res.statusText;
        const error = new Error(`Jira ${res.status}: ${detail}`);
        error.status = res.status;
        throw error;
      }
      // Uma resposta HTML com HTTP 200 não pode virar uma lista vazia ou zero horas.
      if (invalidJson) throw new Error("O Jira devolveu uma resposta JSON inválida.");
      return data;
    }
  };
}
