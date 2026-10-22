import { formatJira } from "./duration.js";

/** Intervalo do mesmo dia. No lote, a duração é dividida entre as demandas selecionadas. */
export function workInterval(start, end, count = 1) {
  const minutesOf = (value) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || "")) return null;
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const from = minutesOf(start), to = minutesOf(end);
  if (from == null || to == null) return { ok: false, error: "Informe o início e o fim para calcular o tempo automaticamente." };
  if (to <= from) return { ok: false, error: "O fim deve ser depois do início, no mesmo dia." };
  if (!Number.isInteger(count) || count < 1) return { ok: false, error: "Selecione ao menos uma demanda." };
  const total = to - from;
  if (total % count) return { ok: false, error: `O intervalo de ${formatJira(total)} não se divide em minutos inteiros entre ${count} demandas. Ajuste os horários ou informe o tempo por demanda.` };
  const minutes = total / count;
  return { ok: true, total, minutes, count, jira: formatJira(minutes) };
}
