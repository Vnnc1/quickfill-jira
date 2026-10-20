/**
 * Agendador de jornada.
 *
 * Distribui apontamentos (worklogs) na janela de trabalho — por padrão
 * 11:00–17:00 — encaixando cada um no primeiro horário livre, DEPOIS do que já
 * está apontado no Jira, sem nunca sobrepor apontamentos.
 *
 * Dois modos para quando o tempo não cabe na janela:
 *  - "sameDay" (padrão): fica no MESMO dia e passa das 17:00; horário informado é
 *    respeitado mesmo fora da janela. Passar da janela ou do teto é sinalizado.
 *  - "nextDay": o restante vai para o próximo dia útil, sem passar do teto.
 *
 * Tudo aqui é puro (sem chrome.*, sem fetch) para poder ser testado isolado.
 * Datas são "YYYY-MM-DD"; horários são minutos desde 00:00 no fuso local.
 */

export const DEFAULT_WORKDAY = {
  start: 11 * 60,      // 11:00
  end: 17 * 60,        // 17:00
  capMinutes: 6 * 60,  // teto diário
  skipWeekends: true,
  overflow: "sameDay", // "sameDay" | "nextDay"
};

const DAY_END = 24 * 60;

/* ---------- utilidades de data/hora ---------- */

export function parseHM(text, fallback) {
  const m = String(text || "").trim().match(/^(\d{1,2})(?::|h)?(\d{2})?$/);
  if (!m) return fallback;
  const h = Number(m[1]);
  const mi = Number(m[2] || 0);
  if (h > 23 || mi > 59) return fallback;
  return h * 60 + mi;
}

export const fmtHM = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Soma dias a "YYYY-MM-DD" usando UTC, imune a horário de verão. */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function weekday(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
}

export const isWeekend = (dateStr) => [0, 6].includes(weekday(dateStr));

/** Duração legível só em horas e minutos ("1h 30m"), sem "d". */
export function fmtDur(min) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* ---------- intervalos ---------- */

function mergeIntervals(list) {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ start: cur.start, end: cur.end });
  }
  return out;
}

/** Janela [start, end) menos os intervalos ocupados. */
function freeSlots(start, end, busy) {
  const out = [];
  let cursor = start;
  for (const b of mergeIntervals(busy)) {
    if (b.end <= cursor) continue;
    if (b.start >= end) break;
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, end) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= end) break;
  }
  if (cursor < end) out.push({ start: cursor, end });
  return out;
}

/* ---------- plano ---------- */

/**
 * @param {object}   o
 * @param {string}   o.startDate   dia inicial ("YYYY-MM-DD")
 * @param {Array}    o.items       [{ key, minutes }] na ordem de encaixe
 * @param {object}   o.busyByDay   { "YYYY-MM-DD": [{ start, minutes, key }] } — já apontado
 * @param {object}   o.workday     { start, end, capMinutes, skipWeekends }
 * @param {number}   o.maxDays     limite de dias para procurar espaço
 * @param {number}   o.notBefore   minuto mínimo no dia inicial (ex.: agora), opcional
 */
export function buildPlan({ startDate, items, busyByDay = {}, workday = DEFAULT_WORKDAY, maxDays = 30, notBefore = null }) {
  const wd = { ...DEFAULT_WORKDAY, ...workday };
  if (wd.overflow === "sameDay") return buildSameDay({ startDate, items, busyByDay, wd, notBefore });
  const days = {};

  const day = (date) => {
    if (days[date]) return days[date];
    const existing = (busyByDay[date] || []).map((b) => ({
      start: b.start, end: b.start + b.minutes, minutes: b.minutes, key: b.key, kind: "existing",
    }));
    days[date] = {
      date,
      weekend: isWeekend(date),
      usedBefore: existing.reduce((s, b) => s + b.minutes, 0), // tudo o que já foi apontado conta no teto
      planned: 0,
      existing,
      plannedSlots: [],
    };
    return days[date];
  };

  const used = (d) => d.usedBefore + d.planned;

  const result = [];
  let cursorDate = startDate;
  let unplaced = 0;

  for (const item of items) {
    let remaining = Math.max(0, Math.round(item.minutes || 0));
    const chunks = [];
    let guard = 0;

    while (remaining > 0 && guard < maxDays) {
      const d = day(cursorDate);
      const capLeft = wd.capMinutes - used(d);
      const skip = (wd.skipWeekends && d.weekend) || capLeft <= 0;

      if (!skip) {
        const occupied = [
          ...d.existing.map((e) => ({ start: e.start, end: e.end })),
          ...d.plannedSlots.map((p) => ({ start: p.start, end: p.end })),
        ];
        // No dia inicial, não agenda no passado se foi pedido
        const windowStart = (cursorDate === startDate && notBefore != null)
          ? Math.max(wd.start, notBefore)
          : wd.start;

        let left = capLeft;
        for (const slot of freeSlots(windowStart, wd.end, occupied)) {
          if (remaining <= 0 || left <= 0) break;
          const take = Math.min(remaining, slot.end - slot.start, left);
          const chunk = { date: cursorDate, start: slot.start, end: slot.start + take, minutes: take };
          chunks.push(chunk);
          d.plannedSlots.push({ ...chunk, key: item.key, kind: "planned" });
          d.planned += take;
          remaining -= take;
          left -= take;
        }
      }

      if (remaining > 0) {
        cursorDate = addDays(cursorDate, 1);
        guard += 1;
      }
    }

    if (remaining > 0) unplaced += remaining;
    result.push({ key: item.key, minutes: item.minutes, chunks });
  }

  const dayList = Object.values(days)
    .filter((d) => d.usedBefore || d.planned || d.date === startDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      weekend: d.weekend,
      usedBefore: d.usedBefore,
      planned: d.planned,
      total: d.usedBefore + d.planned,
      cap: wd.capMinutes,
      existing: d.existing,
      plannedSlots: d.plannedSlots,
    }));

  return {
    items: result,
    days: dayList,
    workday: wd,
    unplaced,
    spills: dayList.filter((d) => d.planned > 0).length > 1,
  };
}

/* ---------- modo "mesmo dia" ---------- */

/**
 * Tudo fica no dia escolhido — nunca vai para outro dia:
 *  - horário informado (notBefore): começa exatamente ali, mesmo fora da jornada,
 *    e segue em sequência, pulando só o que já está apontado;
 *  - automático: procura um espaço contínuo dentro da jornada; se não houver, o
 *    primeiro espaço contínuo a partir do início da jornada (ou seja, passa das
 *    17:00); em último caso, divide nos buracos livres do dia.
 * Passar da janela ou do teto é permitido e vem sinalizado no resultado.
 */
function buildSameDay({ startDate, items, busyByDay, wd, notBefore }) {
  const existing = (busyByDay[startDate] || []).map((b) => ({
    start: b.start, end: b.start + b.minutes, minutes: b.minutes, key: b.key, kind: "existing",
  }));
  const d = {
    date: startDate,
    weekend: isWeekend(startDate),
    usedBefore: existing.reduce((sum, b) => sum + b.minutes, 0),
    planned: 0,
    existing,
    plannedSlots: [],
  };
  const occupied = () => [...d.existing, ...d.plannedSlots].map((x) => ({ start: x.start, end: x.end }));

  const place = (key, start, minutes, chunks) => {
    const chunk = { date: startDate, start, end: start + minutes, minutes };
    chunks.push(chunk);
    d.plannedSlots.push({ ...chunk, key, kind: "planned" });
    d.planned += minutes;
  };

  /** Primeiro espaço livre contínuo com `need` minutos em [from, to). */
  const contiguous = (from, to, need) => freeSlots(from, to, occupied()).find((sl) => sl.end - sl.start >= need);

  const result = [];
  let unplaced = 0;
  let cursor = notBefore;   // com horário informado, os itens seguem um após o outro

  for (const item of items) {
    let remaining = Math.max(0, Math.round(item.minutes || 0));
    const chunks = [];

    if (cursor != null) {
      for (const sl of freeSlots(cursor, DAY_END, occupied())) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, sl.end - sl.start);
        place(item.key, sl.start, take, chunks);
        remaining -= take;
        cursor = sl.start + take;
      }
    } else {
      const fit = contiguous(wd.start, wd.end, remaining) || contiguous(wd.start, DAY_END, remaining);
      if (fit) {
        place(item.key, fit.start, remaining, chunks);
        remaining = 0;
      } else {
        for (const sl of freeSlots(wd.start, DAY_END, occupied())) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, sl.end - sl.start);
          place(item.key, sl.start, take, chunks);
          remaining -= take;
        }
      }
    }

    if (remaining > 0) unplaced += remaining;   // só acontece se passar da meia-noite
    result.push({ key: item.key, minutes: item.minutes, chunks });
  }

  const total = d.usedBefore + d.planned;
  const afterWindow = d.plannedSlots.reduce((sum, x) => sum + Math.max(0, x.end - Math.max(x.start, wd.end)), 0);
  const beforeWindow = d.plannedSlots.reduce((sum, x) => sum + Math.max(0, Math.min(x.end, wd.start) - x.start), 0);

  return {
    items: result,
    days: [{
      date: d.date, weekend: d.weekend, usedBefore: d.usedBefore, planned: d.planned, total,
      cap: wd.capMinutes, existing: d.existing, plannedSlots: d.plannedSlots,
    }],
    workday: wd,
    unplaced,
    spills: false,
    afterWindow,
    beforeWindow,
    overCap: Math.max(0, total - wd.capMinutes),
  };
}
