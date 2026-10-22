/** Cache de leituras: compartilha chamadas em andamento e só guarda sucessos. */
export function createAsyncCache({ ttlMs, maxEntries = 32, now = Date.now } = {}) {
  const values = new Map();
  const pending = new Map();

  return {
    get(key, load, { force = false } = {}) {
      if (pending.has(key)) return pending.get(key);
      const hit = values.get(key);
      if (!force && hit && now() - hit.at < ttlMs) {
        values.delete(key);
        values.set(key, hit);
        return Promise.resolve(hit.value);
      }
      values.delete(key);
      const request = Promise.resolve().then(load).then((value) => {
        // clear() durante uma leitura impede que a resposta antiga repovoe o cache.
        if (pending.get(key) === request) {
          values.set(key, { value, at: now() });
          while (values.size > maxEntries) values.delete(values.keys().next().value);
        }
        return value;
      }).finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
      pending.set(key, request);
      return request;
    },
    clear() {
      values.clear();
      pending.clear();
    },
  };
}

/** Identidade da conexão; a chave é interna e nunca deve ser exibida ou registrada. */
export const connectionKey = (cfg) => JSON.stringify([cfg.baseUrl, cfg.email, cfg.apiToken]);
