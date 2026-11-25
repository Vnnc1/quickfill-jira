import test from 'node:test';
import assert from 'node:assert/strict';
import { branchCommands, deployReport, developmentDetails, isDevelopmentField } from '../profiles/dev/files/lib/dashfill-development.js';

const defs = [{ id: 'branch', name: 'Branch' }, { id: 'script', name: 'Comandos SQL' }];
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content) => ({ type: 'doc', content });

test('separa repositórios, branches e anotações no campo do Jira', () => {
  const fields = { branch: doc(...[
    'WEB - feat/app-1/presenca', 'DOCTOR - feat/app-1/presenca',
    'BFF, MS Atendimentos, Front-Doctor:', 'feat/app-1/espera',
    'NOVAS ENVS EM ANALYTICS', 'TIMEOUT_MS=9000 EXCHANGE=realtime',
  ].map(paragraph)) };
  const { branches, sql, envs } = developmentDetails([{ repo: 'WEB', name: 'feat/app-1/presenca' }], fields, defs);
  assert.deepEqual(branches, [
    { repo: 'WEB', name: 'feat/app-1/presenca' },
    { repo: 'DOCTOR', name: 'feat/app-1/presenca' },
    { repo: 'BFF, MS Atendimentos, Front-Doctor', name: 'feat/app-1/espera' },
  ]);
  assert.deepEqual(sql, []);
  assert.deepEqual(envs.map(e => [e.section, e.command]), [
    ['NOVAS ENVS EM ANALYTICS', 'TIMEOUT_MS=9000'],
    ['NOVAS ENVS EM ANALYTICS', 'EXCHANGE=realtime'],
  ]);
  assert.equal(branchCommands(branches[2].name).checkout, 'git fetch origin && git checkout feat/app-1/espera');
});

test('preserva SQL, quebras, literais e instruções repetidas na ordem do Jira', () => {
  const script = "SELECT 'um;dois';\nSELECT 2;\nSELECT 'um;dois';";
  const fields = {
    branch: "API: fix/app-2\nUPDATE contas\nSET ativo = true;\nWEB - fix/app-3",
    script: doc(paragraph(script)),
    description: doc(
      { type: 'codeBlock', attrs: { language: 'sql' }, content: [{ type: 'text', text: script }] },
      { type: 'codeBlock', attrs: { language: 'postgresql' }, content: [{ type: 'text', text: 'DO $$ BEGIN PERFORM 1; END $$;' }] },
    ),
  };
  const data = developmentDetails([], fields, defs);
  assert.deepEqual(data.sql, ['UPDATE contas\nSET ativo = true;', "SELECT 'um;dois';", 'SELECT 2;', "SELECT 'um;dois';", 'DO $$ BEGIN PERFORM 1; END $$;']);
  assert.deepEqual(data.branches.map(b => b.name), ['fix/app-2', 'fix/app-3']);
});

test('lê links de branch e listas, e aceita demanda sem campos de desenvolvimento', () => {
  assert.deepEqual(developmentDetails([], {}, []), { branches: [], sql: [], envs: [], sources: [], deploy: { branches: [], sql: [], envs: [] } });
  const { branches } = developmentDetails([], { branch: [{ value: 'main' }, { url: 'https://example.org/team/repo/tree/feat%2Fapp-5' }] }, defs);
  assert.deepEqual(branches.map(b => b.name), ['main', 'feat/app-5']);
});

test('Deploy usa BRANCH, .env e Arquivos SQL da demanda e dá preferência aos campos próprios', () => {
  const definitions = [
    { id: 'customfield_101', name: 'BRANCH' }, { id: 'customfield_524', name: '.env' },
    { id: 'customfield_892', name: 'Arquivos SQL' },
  ];
  assert.ok(definitions.every(isDevelopmentField));
  const fields = {
    customfield_101: doc(paragraph('Doctor:'), paragraph('fix/app-1'), paragraph('SELECT 100;'), paragraph('FLAG=antiga')),
    customfield_524: doc(paragraph('FLAG=nova')),
    customfield_892: doc(paragraph('SELECT 200;')),
    description: doc(paragraph('DESCRICAO=exemplo'), paragraph('SELECT 300;')),
  };
  const git = [{ name: 'branch-da-integracao' }];
  const parsed = developmentDetails(git, fields, definitions);
  assert.deepEqual(parsed.deploy, {
    branches: [{ name: 'fix/app-1', repo: 'Doctor' }], sql: ['SELECT 200;'], envs: [{ command: 'FLAG=nova', section: '.env' }],
  });
  const legacy = developmentDetails(git, { ...fields, customfield_524: null, customfield_892: null }, definitions).deploy;
  assert.deepEqual(legacy.sql, ['SELECT 100;']);
  assert.deepEqual(legacy.envs.map(e => e.command), ['FLAG=antiga']);
  assert.deepEqual(developmentDetails(git, { description: fields.description }, definitions).deploy, { branches: [], envs: [], sql: [] });
});

test('descobre campos ENV pelo nome e preserva fontes sem interpretação', () => {
  for (const name of ['ENVs', '.env', 'Variável de ambiente', 'Variáveis de Ambiente', 'Environment variables']) {
    assert.ok(isDevelopmentField({ id: 'customfield_987', name }));
  }
  assert.equal(isDevelopmentField({ id: 'environment', name: 'Ambiente' }), false);
  const envField = { id: 'customfield_987', name: 'ENVs' };
  const raw = '  Primeiro confirmar com a equipe.\nexport TITLE="teste A=B"\nset "PORT=3000"\n$env:MODE = "A"\nPORT: 3000\n';
  const description = doc(paragraph('Observar os campos abaixo.'), paragraph('QUEUE=qa LABEL="status ativo"'));
  const data = developmentDetails([], { customfield_987: raw, description }, [envField]);
  assert.deepEqual(data.envs.map(e => e.command), [
    'export TITLE="teste A=B"', 'set "PORT=3000"', '$env:MODE = "A"', 'PORT: 3000', 'QUEUE=qa', 'LABEL="status ativo"',
  ]);
  assert.deepEqual(data.sql, []);
  assert.equal(data.sources[0].text, raw);
  assert.deepEqual(data.sources[1].value, description);
});

test('cópia do deploy mantém demanda, campos, grupos e texto livre em um lote grande', () => {
  const issues = Array.from({ length: 12 }, (_, i) => {
    const fields = {
      branch: 'API: feat/teste-' + i, script: "SELECT 'a;b';\nSELECT 2;",
      env: Array.from({ length: 24 }, (_, n) => 'TESTE_' + n + '=' + i).join('\n') + '\n# confirmar no ambiente',
    };
    return { key: 'APP-' + i, summary: 'Demanda ' + i, ...developmentDetails([], fields, [...defs, { id: 'env', name: '.env' }]) };
  });
  const blocks = deployReport(issues).split('\n\n────────────────────\n\n');
  assert.equal(blocks.length, issues.length);
  for (const [i, text] of blocks.entries()) {
    assert.ok(text.startsWith(`APP-${i} — Demanda ${i}\n\nBranches\nAPI:\nfeat/teste-${i}\n\nSQL\nSELECT 'a;b';\nSELECT 2;\n\nENVs\n`));
    assert.ok(text.includes('TESTE_23=' + i));
    assert.ok(text.endsWith('# confirmar no ambiente'));
    assert.doesNotMatch(text, /git (checkout|merge)/);
  }
});

