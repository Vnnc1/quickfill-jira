/** Paginação compartilhada por buscas simples, com histórico e pelo espaço UX. */
export async function searchIssues(request, { jql, fields, max, cfg, expand }) {
  if (!Number.isInteger(max) || max < 0) throw new Error("Limite de busca inválido.");
  if (!max) return [];
  const out = [];
  const seen = new Set();
  try {
    let token;
    do {
      const page = await request("/rest/api/3/search/jql", {
        method: "POST", cfg, readOnly: true,
        body: { jql, fields, maxResults: Math.min(100, max - out.length),
          ...(expand ? { expand } : {}), ...(token ? { nextPageToken: token } : {}) },
      });
      out.push(...(page?.issues || []));
      token = page?.isLast ? null : page?.nextPageToken;
      if (token && out.length < max) {
        if (seen.has(token)) throw new Error("O Jira repetiu a página da busca. Tente atualizar novamente.");
        seen.add(token);
      }
    } while (token && out.length < max);
    return out.slice(0, max);
  } catch (error) {
    // Não confundir números presentes na mensagem de um erro de JQL com HTTP 404/405.
    if (![404, 405].includes(error.status)) throw error;
  }

  // Compatibilidade com instâncias antigas: reinicia sem misturar páginas dos dois endpoints.
  out.length = 0;
  for (let startAt = 0; out.length < max;) {
    const qs = new URLSearchParams({ jql, fields: fields.join(","), startAt: String(startAt),
      maxResults: String(Math.min(100, max - out.length)), ...(expand ? { expand } : {}) });
    const page = await request(`/rest/api/3/search?${qs}`, { cfg });
    const batch = page?.issues || [];
    out.push(...batch);
    startAt += batch.length;
    if (!batch.length || page?.isLast || (page?.total != null && startAt >= page.total)) break;
  }
  return out.slice(0, max);
}
