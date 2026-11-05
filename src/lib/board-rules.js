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
  const u = new URL(url);
  const candidate = u.searchParams.get('selectedIssue') || u.searchParams.get('selectedIssueKey') || u.pathname.match(/\/browse\/([^/]+)/)?.[1];
  return /^[A-Z][A-Z0-9_]*-\d+$/i.test(candidate || '') ? candidate.toUpperCase() : null;
}
