/* Cronômetro do Meu dia (DEV): começa sozinho, pausa e aponta — npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elapsedMinutes, clockText, autoStartCandidate, addSkip, worklogFor, dayOf, isDoingStatus, enteredStatusAt } from '../profiles/dev/files/lib/focus-timer.js';

const at = (h, m = 0, s = 0) => new Date(2026, 10, 24, h, m, s).getTime();

test('relógio corrido e minutos inteiros', () => {
  assert.equal(clockText(at(9), at(9, 7, 5)), '0:07:05');
  assert.equal(clockText(at(9), at(10, 32, 40)), '1:32:40');
  assert.equal(elapsedMinutes(at(9), at(9, 0, 59)), 0);
  assert.equal(elapsedMinutes(at(9), at(9, 35, 10)), 35);
  assert.equal(elapsedMinutes(at(10), at(9)), 0);
});

test('começa sozinho só com a demanda que acabou de entrar em andamento', () => {
  const doing = [
    { key: 'MEED-2557', summary: 'WEB - DASHBOARD QA', enteredAt: at(13, 50) },
    { key: 'MEED-2556', summary: 'DOCTOR - DASHBOARD QA', enteredAt: at(9) },
  ];
  const c = autoStartCandidate(doing, null, null, at(14));
  assert.deepEqual(c, { key: 'MEED-2557', title: 'WEB - DASHBOARD QA', start: at(13, 50), auto: true });
  assert.equal(autoStartCandidate(doing, null, null, at(14, 20)), null);                 // passou da janela de 15 min
  assert.equal(autoStartCandidate(doing, { key: 'X-1', start: at(13) }, null, at(14)), null);   // já tem um rodando
});

test('o que você pausou ou descartou hoje não volta a começar sozinho', () => {
  const doing = [{ key: 'MEED-2557', summary: '', enteredAt: at(13, 55) }];
  const skip = addSkip(null, 'MEED-2557', at(13, 58));
  assert.equal(skip.day, dayOf(at(14)));
  assert.equal(autoStartCandidate(doing, null, skip, at(14)), null);
  assert.deepEqual(addSkip(skip, 'MEED-2557', at(14)).keys, ['MEED-2557']);              // sem repetir
  const tomorrow = new Date(2026, 10, 25, 9, 5).getTime();
  const next = [{ key: 'MEED-2557', summary: '', enteredAt: tomorrow - 60000 }];
  assert.equal(autoStartCandidate(next, null, skip, tomorrow).key, 'MEED-2557');        // outro dia, vale de novo
});

test('apontamento: minutos inteiros, abaixo de 1 min não aponta, e corta na meia-noite', () => {
  const log = worklogFor({ key: 'MEED-2557', start: at(14, 5) }, at(14, 40, 30));
  assert.equal(log.minutes, 35);
  assert.equal(log.body.timeSpentSeconds, 2100);
  assert.match(log.body.started, /^2026-11-24T14:05:00\.000[+-]\d{4}$/);
  assert.equal(worklogFor({ key: 'MEED-2557', start: at(14) }, at(14, 0, 40)), null);
  const late = worklogFor({ key: 'MEED-2557', start: at(23, 30) }, new Date(2026, 10, 25, 1, 0).getTime());
  assert.equal(late.minutes, 30);
  assert.equal(worklogFor(null), null);
});

test('em andamento é o status de desenvolvimento, não a categoria do Jira', () => {
  assert.ok(isDoingStatus('Em Andamento'));
  assert.ok(isDoingStatus('Reaberto'));
  for (const name of ['PR', 'Feito', 'Deploy em DES', 'Validação', 'Validado', 'Impedido/Aguardando', 'release']) assert.ok(!isDoingStatus(name), name);
  assert.ok(!isDoingStatus('Em Andamento', 'done'));
  assert.ok(!isDoingStatus('Itens Pendentes', 'new'));
});

test('entrada no status atual vem da última mudança de status do histórico', () => {
  const histories = [
    { created: '2026-11-24T10:00:00.000-0300', items: [{ field: 'status', toString: 'Em Andamento' }] },
    { created: '2026-11-24T11:30:00.000-0300', items: [{ field: 'assignee' }] },
    { created: '2026-11-24T09:00:00.000-0300', items: [{ field: 'status', toString: 'Itens Pendentes' }] },
  ];
  assert.equal(enteredStatusAt(histories), Date.parse('2026-11-24T10:00:00.000-0300'));
  assert.ok(Number.isNaN(enteredStatusAt([])));
});
