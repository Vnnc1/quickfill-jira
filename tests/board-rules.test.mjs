import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedColumns, issueKey, priorityTone} from '../src/lib/board-rules.js';

test('destinos usam IDs de status e suportam múltiplos status por coluna',()=>{
  const columns=[{name:'Feito',statuses:[{id:'3'},{id:'4'}]},{name:'Andamento',statuses:[{id:'2'}]},{name:'Pendente',statuses:[{id:'1'}]}];
  assert.deepEqual(allowedColumns(columns,[{to:{id:'4'}}]),[columns[0]]);
  assert.deepEqual(allowedColumns(columns,[]),[]);
  assert.deepEqual(allowedColumns(columns,[{to:{id:'99',name:'Andamento'}}]),[]);
});
test('prioridades altas e baixas têm distinção sem classificar desconhecidas',()=>{
  for(const name of ['Highest','Máxima','Crítica'])assert.equal(priorityTone(name),'critical');
  for(const name of ['High','Alta'])assert.equal(priorityTone(name),'high');
  for(const name of ['Lowest','Low','Baixa'])assert.equal(priorityTone(name),'low');
  assert.equal(priorityTone('Personalizada'),'normal');
  assert.equal(priorityTone(null),'normal');
});
test('a mesma demanda é reconhecida nos modos nativos e valores inválidos são ignorados',()=>{
  assert.equal(issueKey('https://x.atlassian.net/browse/MEED-2312'),'MEED-2312');
  assert.equal(issueKey('https://x.atlassian.net/jira/boards/1?selectedIssue=MEED-2312'),'MEED-2312');
  assert.equal(issueKey('https://x.atlassian.net/jira/boards/1?selectedIssueKey=MEED-2312'),'MEED-2312');
  assert.equal(issueKey('https://x.atlassian.net/jira/boards/1'),null);
  assert.equal(issueKey('https://x.atlassian.net/browse/%3Cscript%3E'),null);
});
