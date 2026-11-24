// Cronômetro do Meu dia (DEV): quanto tempo passou, quando começar sozinho e o que apontar no Jira.
// Funções puras: recebem o estado e o "agora", não leem a tela nem o storage.

/** Minutos inteiros entre o início e o fim (o Jira não aceita apontamento abaixo de 1 minuto). */
export function elapsedMinutes(start, end = Date.now()) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.floor((end - start) / 60000);
}

/** Relógio corrido: "0:07:05", "1:32:40". */
export function clockText(start, end = Date.now()) {
  const s = Math.max(0, Math.floor((end - start) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/**
 * O DEV está atuando? No Jira, PR, Deploy e Validação também são da categoria "Em andamento",
 * então vale o nome do status: só desenvolvimento (Em andamento, Reaberto, Em desenvolvimento…).
 */
const NOT_DEV = /\b(pr|pull request|feito|code review|review|revis|deploy|valida|homolog|qa|teste|release|produ|impedid|aguard|bloque|done|conclu|pendente|a fazer|to do|backlog)/i;
export const isDoingStatus = (name = '', category = 'indeterminate') => category === 'indeterminate' && !!name && !NOT_DEV.test(name);

/** Quando a demanda entrou no status atual: a última mudança de status no histórico (changelog) do Jira. */
export function enteredStatusAt(histories = []) {
  let last = NaN;
  for (const h of histories || []) {
    if (!(h.items || []).some((it) => it.field === 'status')) continue;
    const at = Date.parse(h.created);
    if (Number.isFinite(at) && !(at <= last)) last = at;
  }
  return last;
}

/** "AAAA-MM-DD" no fuso local. */
export const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Começa sozinho? Só quando nada está rodando, a demanda entrou em andamento há pouco
 * (até `windowMin` minutos) e você não pausou nem descartou essa demanda hoje.
 * @param doing  [{ key, summary, enteredAt }] do Jira, mais recentes primeiro
 * @param skip   { day, keys: [] } com o que você parou hoje
 * @returns { key, title, start } ou null
 */
export function autoStartCandidate(doing, running, skip, now = Date.now(), windowMin = 15) {
  if (running) return null;
  const skipped = new Set(skip?.day === dayOf(now) ? skip.keys || [] : []);
  for (const d of doing || []) {
    if (!d?.key || skipped.has(d.key) || !Number.isFinite(d.enteredAt)) continue;
    if (d.enteredAt > now || now - d.enteredAt > windowMin * 60000) continue;
    return { key: d.key, title: d.summary || '', start: d.enteredAt, auto: true };
  }
  return null;
}

/** Marca a demanda como parada hoje: ela não volta a começar sozinha até amanhã. */
export function addSkip(skip, key, now = Date.now()) {
  const day = dayOf(now);
  const keys = skip?.day === day ? skip.keys || [] : [];
  return { day, keys: keys.includes(key) ? keys : [...keys, key] };
}

/** Horário no formato que o Jira pede para o apontamento: 2026-11-24T09:05:00.000-0300. */
export function jiraStarted(ms) {
  const d = new Date(ms), z = -d.getTimezoneOffset(), p = (n) => String(Math.abs(n)).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00.000${z >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(z) / 60))}${p(Math.abs(z) % 60)}`;
}

/**
 * Apontamento de um trecho do cronômetro. Abaixo de 1 minuto não há o que apontar (null).
 * Um trecho que virou o dia é cortado na meia-noite: o Jira registra o apontamento no dia do início.
 */
export function worklogFor(timer, end = Date.now()) {
  if (!timer?.key || !Number.isFinite(timer.start)) return null;
  const midnight = new Date(timer.start); midnight.setHours(24, 0, 0, 0);
  const until = Math.min(end, midnight.getTime());
  const minutes = elapsedMinutes(timer.start, until);
  if (minutes < 1) return null;
  return { key: timer.key, minutes, body: { timeSpentSeconds: minutes * 60, started: jiraStarted(timer.start) } };
}
