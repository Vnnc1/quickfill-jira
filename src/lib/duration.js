/**
 * Parser de duração no formato M / H / D (Jira).
 *
 * Aceita, por exemplo:
 *   "10m"      -> 10m
 *   "20"       -> 20m   (número puro = minutos)
 *   "2h"       -> 2h
 *   "1h30"     -> 1h 30m
 *   "1h30m"    -> 1h 30m
 *   "1,5h"     -> 1h 30m
 *   "1.5d"     -> 9h     (1 dia = 6h de jornada)
 *   "1d 2h 30m"-> 8h 30m
 *   "2D3H"     -> 15h    (case-insensitive)
 *
 * Retorna { ok, minutes, jira, error }.
 *  - minutes: total em minutos
 *  - jira: string normalizada aceita pela API do Jira ("1d 2h 30m")
 */

/**
 * 1 dia = 6 horas: a jornada é 11:00–17:00. Isso vale só para INTERPRETAR o que
 * você digita ("1d" = 6h). Para o Jira a extensão sempre envia horas e minutos,
 * nunca "d" — senão o Jira aplicaria o expediente dele (geralmente 8h).
 */
export const HOURS_PER_DAY = 6;

const UNIT_MINUTES = {
  m: 1,
  h: 60,
  d: 60 * HOURS_PER_DAY,
  w: 60 * HOURS_PER_DAY * 5,
};

export function parseDuration(raw) {
  if (raw === null || raw === undefined) return { ok: true, minutes: 0, jira: "" };
  const input = String(raw).trim().toLowerCase().replace(/,/g, ".");
  if (!input) return { ok: true, minutes: 0, jira: "" };

  // Número puro => minutos
  if (/^\d+(\.\d+)?$/.test(input)) {
    const minutes = Math.round(parseFloat(input));
    return finish(minutes);
  }

  // Caso "1h30" (sem sufixo no último bloco) => trata o resto como minutos
  const trailing = input.match(/^(.*[hd])\s*(\d+(\.\d+)?)$/);
  const normalized = trailing ? `${trailing[1]} ${trailing[2]}m` : input;

  const tokenRe = /(\d+(?:\.\d+)?)\s*([mhdw])/g;
  let total = 0;
  let matched = 0;
  let consumed = 0;
  let match;
  while ((match = tokenRe.exec(normalized)) !== null) {
    total += parseFloat(match[1]) * UNIT_MINUTES[match[2]];
    matched += 1;
    consumed += match[0].length;
  }

  const leftovers = normalized.replace(tokenRe, "").replace(/[\s]/g, "");
  if (!matched || leftovers.length) {
    return {
      ok: false,
      minutes: 0,
      jira: "",
      error: `Formato inválido: "${raw}". Use algo como 10m, 2h, 1h30m ou 1d.`,
    };
  }
  void consumed;
  return finish(Math.round(total));
}

function finish(minutes) {
  if (minutes <= 0) return { ok: true, minutes: 0, jira: "" };
  return { ok: true, minutes, jira: formatJira(minutes) };
}

/** Converte minutos para o formato enviado ao Jira: só horas e minutos ("8h 30m"). */
export function formatJira(totalMinutes) {
  const rest = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(rest / 60);
  const m = rest % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Rótulo amigável para o preview do modal ("1h 30m = 90 minutos"). */
export function humanize(minutes) {
  if (!minutes) return "—";
  return `${formatJira(minutes)} (${minutes} min)`;
}

/**
 * Qual estimativa gravar. Estimativa existente nunca muda sozinha:
 * - digitou um valor diferente da atual → grava o novo;
 * - digitou o mesmo valor, ou deixou vazio e a tarefa já tem estimativa → não mexe ("");
 * - vazio e a tarefa sem estimativa → usa o trabalhado (se fromSpent).
 * - preserveExisting: uma sugestão automática nunca substitui a estimativa existente.
 */
export function pickEstimate({ typed = "", current = "", spent = "", fromSpent = true, preserveExisting = false } = {}) {
  const t = String(typed || "").trim();
  const cur = parseDuration(current);
  const hasCurrent = cur.ok && cur.minutes > 0;
  if (preserveExisting && hasCurrent) return "";
  if (t) {
    const p = parseDuration(t);
    return hasCurrent && p.ok && p.minutes === cur.minutes ? "" : t;
  }
  if (hasCurrent) return "";
  return fromSpent && String(spent || "").trim() ? String(spent).trim() : "";
}
