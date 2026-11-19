import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedColumns,
  issueKey,
  priorityTone,
  timeSummary,
  isOverdue,
  extractLinks,
  timelineMetrics,
  bestFreeGap,
  formatMinutes,
} from '../src/lib/board-rules.js';

test('destinos usam IDs de status e suportam múltiplos status por coluna', () => {
  const columns = [{ name: 'Feito', statuses: [{ id: '3' }, { id: '4' }] }, { name: 'Andamento', statuses: [{ id: '2' }] }, { name: 'Pendente', statuses: [{ id: '1' }] }];
  assert.deepEqual(allowedColumns(columns, [{ to: { id: '4' } }]), [columns[0]]);
  assert.deepEqual(allowedColumns(columns, []), []);
  assert.deepEqual(allowedColumns(columns, [{ to: { id: '99', name: 'Andamento' } }]), []);
});

test('prioridades altas e baixas têm distinção sem classificar desconhecidas', () => {
  for (const name of ['Highest', 'Máxima', 'Crítica']) assert.equal(priorityTone(name), 'critical');
  for (const name of ['High', 'Alta']) assert.equal(priorityTone(name), 'high');
  for (const name of ['Lowest', 'Low', 'Baixa']) assert.equal(priorityTone(name), 'low');
  assert.equal(priorityTone('Personalizada'), 'normal');
  assert.equal(priorityTone(null), 'normal');
});

test('a mesma demanda é reconhecida nos modos nativos e valores inválidos são ignorados', () => {
  assert.equal(issueKey('https://x.atlassian.net/browse/MEED-2312'), 'MEED-2312');
  assert.equal(issueKey('https://x.atlassian.net/jira/boards/1?selectedIssue=MEED-2312'), 'MEED-2312');
  assert.equal(issueKey('https://x.atlassian.net/jira/boards/1?selectedIssueKey=MEED-2312'), 'MEED-2312');
  assert.equal(issueKey('https://x.atlassian.net/jira/boards/1'), null);
  assert.equal(issueKey('https://x.atlassian.net/browse/%3Cscript%3E'), null);
});

test('resumo de tempo identifica excedente e formatação amigável', () => {
  const ok = timeSummary({ timeSpentSeconds: 5400, originalEstimateSeconds: 7200, remainingEstimateSeconds: 1800 });
  assert.equal(ok.spentMin, 90);
  assert.equal(ok.estimateMin, 120);
  assert.equal(ok.hasOverrun, false);
  assert.equal(ok.percent, 75);

  const over = timeSummary({ timeSpentSeconds: 9900, originalEstimateSeconds: 7200, remainingEstimateSeconds: 0 });
  assert.equal(over.hasOverrun, true);
  assert.equal(over.overrunMin, 45);
  assert.equal(formatMinutes(over.overrunMin), '45m');
  assert.equal(formatMinutes(over.spentMin), '2h 45m');
});

test('extração de vínculos reconhece Confluence, Figma e bloqueios ativos', () => {
  const issue = {
    fields: {
      description: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ver https://www.figma.com/design/abc123/Tela?node-id=1-2' }] }],
      },
      issuelinks: [
        { type: { inward: 'is blocked by' }, inwardIssue: { key: 'MEED-100', fields: { summary: 'Auth', status: { name: 'Em Andamento', statusCategory: { key: 'indeterminate' } } } } },
        { type: { inward: 'is blocked by' }, inwardIssue: { key: 'MEED-101', fields: { summary: 'Done', status: { name: 'Feito', statusCategory: { key: 'done' } } } } },
      ],
    },
  };
  const remoteLinks = [
    { object: { url: 'https://empresa.atlassian.net/wiki/spaces/ENG/pages/42', title: 'RFC Storage' } },
  ];
  const links = extractLinks(issue, remoteLinks);
  assert.equal(links.confluence.length, 1);
  assert.equal(links.confluence[0].title, 'RFC Storage');
  assert.equal(links.figma.length, 1);
  assert.equal(links.issueLinks.length, 2);
  assert.equal(links.blockedBy, 1);
});

test('prazo vencido calcula dias de atraso e ignora demandas concluídas', () => {
  assert.deepEqual(isOverdue('2026-11-15', 'indeterminate', '2026-11-19'), { overdue: true, daysLate: 4 });
  assert.deepEqual(isOverdue('2026-11-15', 'done', '2026-11-19'), { overdue: false, daysLate: 0 });
  assert.deepEqual(isOverdue('2026-11-22', 'indeterminate', '2026-11-19'), { overdue: false, daysLate: 0 });
});

test('métricas da linha do tempo e maior janela livre funcionam corretamente', () => {
  const metrics = timelineMetrics({
    date: '2026-11-18',
    total: 265,
    workday: { goal: 240 },
    entries: [{ key: 'MEED-1' }, { key: 'MEED-2' }, { key: 'MEED-1' }],
    history: [
      { date: '2026-11-16', total: 240, goalMet: true },
      { date: '2026-11-17', total: 224, goalMet: false },
      { date: '2026-11-18', total: 265, goalMet: true },
    ],
  });
  assert.equal(metrics.streak, 1);
  assert.equal(metrics.avgMinutes, 232);
  assert.equal(metrics.vsAvgMinutes, 33);
  assert.equal(metrics.distinctIssues, 2);

  const gap = bestFreeGap(
    [{ start: 11 * 60, end: 13 * 60 }, { start: 14 * 60 + 30, end: 16 * 60 }],
    11 * 60,
    17 * 60,
  );
  assert.equal(gap.start, 13 * 60);
  assert.equal(gap.end, 13 * 60 + 30);
  assert.equal(gap.center, 13 * 60 + 45);
});
