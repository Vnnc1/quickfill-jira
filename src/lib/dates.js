/** Utilidades de data (dias "YYYY-MM-DD" no fuso local). Puras. */

export const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, "0");

export function isoOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDaysIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const isWeekendIso = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return [0, 6].includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay());
};

/** Início do dia local (ms) de "YYYY-MM-DD". */
export function startOfIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function daysOf(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}
