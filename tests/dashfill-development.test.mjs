import test from 'node:test';
import assert from 'node:assert/strict';
import { branchCommands, developmentDetails, isDevelopmentField } from '../profiles/dev/files/lib/dashfill-development.js';

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
  assert.deepEqual(developmentDetails([], {}, []), { branches: [], sql: [], envs: [], sources: [] });
  const { branches } = developmentDetails([], { branch: [{ value: 'main' }, { url: 'https://example.org/team/repo/tree/feat%2Fapp-5' }] }, defs);
  assert.deepEqual(branches.map(b => b.name), ['main', 'feat/app-5']);
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

