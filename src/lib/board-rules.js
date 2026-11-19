export const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export function priorityTone(name) {
  const value = normalize(name);
  if (/highest|critical|blocker|maxima|critica|urgente/.test(value)) return 'critical';
  if (/high|alta/.test(value)) return 'high';
  if (/lowest|low|baixa|minor|trivial/.test(value)) return 'low';
  return 'normal';
}

// Board order is not workflow order. One column can contain multiple statuses.
export function allowedColumns(columns, transitions) {
  const ids = new Set(transitions.map(t => String(t.to?.id || '')).filter(Boolean));
  return columns.filter(column => column.statuses?.some(status => ids.has(String(status.id))));
}

export function issueKey(url) {
  try {
    const u = new URL(url);
    const candidate = u.searchParams.get('selectedIssue') || u.searchParams.get('selectedIssueKey') || u.pathname.match(/\/browse\/([^/]+)/)?.[1];
    return /^[A-Z][A-Z0-9_]*-\d+$/i.test(candidate || '') ? candidate.toUpperCase() : null;
  } catch {
    return null;
  }
}

export function formatMinutes(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function formatHM(totalMin) {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(Number(totalMin) || 0)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function parseHM(value) {
  const match = String(value || '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function timeSummary(timetracking = {}) {
  const spentSec = Number(timetracking?.timeSpentSeconds) || 0;
  const estSec = Number(timetracking?.originalEstimateSeconds) || 0;
  const remSec = timetracking?.remainingEstimateSeconds != null ? Number(timetracking.remainingEstimateSeconds) : null;
  const spentMin = Math.round(spentSec / 60);
  const estimateMin = Math.round(estSec / 60);
  const remainingMin = remSec != null ? Math.round(remSec / 60) : null;
  const overrunMin = estimateMin > 0 && spentMin > estimateMin ? spentMin - estimateMin : 0;
  const percent = estimateMin > 0 ? Math.min(100, Math.round((spentMin / estimateMin) * 100)) : (spentMin > 0 ? 100 : 0);
  return {
    spentMin,
    estimateMin,
    remainingMin,
    overrunMin,
    hasOverrun: overrunMin > 0,
    hasTime: spentMin > 0 || estimateMin > 0,
    percent,
  };
}

export function isOverdue(duedate, statusCategoryKey, todayIso) {
  if (!duedate || statusCategoryKey === 'done') return { overdue: false, daysLate: 0 };
  const today = todayIso || (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  })();
  if (duedate >= today) return { overdue: false, daysLate: 0 };
  const diffMs = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${duedate}T00:00:00Z`);
  const daysLate = Number.isFinite(diffMs) ? Math.max(1, Math.round(diffMs / 86400000)) : 1;
  return { overdue: true, daysLate };
}

function collectUrlsFromAdf(node, out = []) {
  if (!node) return out;
  if (typeof node === 'string') {
    const matches = node.match(/https?:\/\/[^\s"'<>)\]]+/gi);
    if (matches) out.push(...matches);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectUrlsFromAdf(item, out);
    return out;
  }
  if (typeof node === 'object') {
    if (typeof node.attrs?.url === 'string') out.push(node.attrs.url);
    if (typeof node.attrs?.href === 'string') out.push(node.attrs.href);
    if (Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        if (typeof mark?.attrs?.href === 'string') out.push(mark.attrs.href);
      }
    }
    if (typeof node.text === 'string') collectUrlsFromAdf(node.text, out);
    if (Array.isArray(node.content)) collectUrlsFromAdf(node.content, out);
  }
  return out;
}

const isSafeHttp = url => /^https?:\/\//i.test(String(url || '').trim());
const isConfluenceUrl = url => /\/wiki\/|confluence/i.test(String(url || ''));
const isFigmaUrl = url => /^https?:\/\/(www\.)?figma\.com\/(file|design|proto|board|slides)\//i.test(String(url || ''));

/**
 * Extrai links de Confluence, Figma e vínculos entre issues (destacando bloqueios)
 * a partir dos campos da issue e dos remote links do Jira.
 */
export function extractLinks(issue = {}, remoteLinks = []) {
  const fields = issue?.fields || {};
  const confluence = [];
  const figma = [];
  const other = [];
  const seen = new Set();

  const pushUrl = (rawUrl, title = '', source = '') => {
    const url = String(rawUrl || '').trim();
    if (!isSafeHttp(url) || seen.has(url)) return;
    seen.add(url);
    const label = String(title || '').trim();
    if (isFigmaUrl(url)) {
      figma.push({ url, title: label || 'Protótipo Figma', source });
    } else if (isConfluenceUrl(url)) {
      confluence.push({ url, title: label || 'Documento Confluence', source });
    } else if (source === 'remotelink') {
      other.push({ url, title: label || url.replace(/^https?:\/\//i, '').slice(0, 42), source });
    }
  };

  for (const rl of remoteLinks || []) {
    pushUrl(rl?.object?.url, rl?.object?.title || rl?.relationship, 'remotelink');
  }
  for (const url of collectUrlsFromAdf(fields.description)) {
    pushUrl(url, '', 'descrição');
  }
  for (const c of (fields.comment?.comments || []).slice(-10)) {
    for (const url of collectUrlsFromAdf(c?.body)) {
      pushUrl(url, '', 'comentário');
    }
  }

  const issueLinks = [];
  let blockedBy = 0;
  for (const link of fields.issuelinks || []) {
    const target = link?.inwardIssue || link?.outwardIssue;
    if (!target?.key) continue;
    const relation = link?.inwardIssue
      ? (link?.type?.inward || 'Vinculado a')
      : (link?.type?.outward || 'Relacionado a');
    const isBlocker = /blocked by|bloquead[oa] por|depends on|depende de/i.test(normalize(relation));
    if (isBlocker && target.fields?.status?.statusCategory?.key !== 'done') blockedBy++;
    issueLinks.push({
      key: target.key,
      summary: target.fields?.summary || '',
      status: target.fields?.status?.name || '',
      done: target.fields?.status?.statusCategory?.key === 'done',
      relation,
      isBlocker,
    });
  }

  return { confluence, figma, other, issueLinks, blockedBy };
}

/** Calcula sequência de metas batidas e média a partir do histórico de DAY_REPORT. */
export function timelineMetrics(report = {}) {
  const history = Array.isArray(report.history) ? report.history : [];
  const total = Number(report.total) || 0;
  const goal = Number(report.workday?.goal) || 240;

  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const day = history[i];
    if (day.goalMet) {
      streak++;
    } else if (i === history.length - 1 && day.date === report.date && total < goal) {
      // Dia em andamento ainda não bateu meta: continua contando os dias anteriores fechados.
      continue;
    } else {
      break;
    }
  }

  const closedWithWork = history.filter(h => h.total > 0 && h.date !== report.date);
  const sample = closedWithWork.length ? closedWithWork : history.filter(h => h.total > 0);
  const avgMinutes = sample.length
    ? Math.round(sample.reduce((sum, h) => sum + (Number(h.total) || 0), 0) / sample.length)
    : 0;
  const vsAvgMinutes = avgMinutes > 0 ? total - avgMinutes : 0;
  const overGoalMinutes = total - goal;
  const percent = goal > 0 ? Math.min(100, Math.round((total / goal) * 100)) : 0;
  const distinctIssues = new Set((report.entries || []).map(e => e.key).filter(Boolean)).size;

  return { streak, avgMinutes, vsAvgMinutes, overGoalMinutes, percent, distinctIssues, goal, total };
}

/** Encontra a maior janela livre dentro da jornada para posicionar o botão "+". */
export function bestFreeGap(entries = [], workStart = 11 * 60, workEnd = 17 * 60) {
  const sorted = [...entries]
    .filter(e => Number.isFinite(e?.start) && Number.isFinite(e?.end) && e.end > e.start)
    .sort((a, b) => a.start - b.start);

  let cursor = workStart;
  let best = { start: workStart, end: Math.min(workEnd, workStart + 30), size: 0 };

  for (const item of sorted) {
    if (item.start > cursor) {
      const gapStart = Math.max(workStart, cursor);
      const gapEnd = Math.min(workEnd, item.start);
      const size = gapEnd - gapStart;
      if (size > best.size) best = { start: gapStart, end: gapEnd, size };
    }
    cursor = Math.max(cursor, item.end);
  }
  if (workEnd > cursor) {
    const size = workEnd - cursor;
    if (size > best.size) best = { start: cursor, end: workEnd, size };
  }
  if (best.size < 10) {
    const start = Math.min(workEnd - 15, cursor);
    return { start: Math.max(workStart, start), end: Math.min(23 * 60 + 55, Math.max(workStart, start) + 30), center: Math.min(workEnd, Math.max(workStart, start) + 15) };
  }
  return {
    start: best.start,
    end: Math.min(best.end, best.start + 30),
    center: Math.round((best.start + best.end) / 2),
  };
}
