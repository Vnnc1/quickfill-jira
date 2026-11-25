// Campos do Jira podem ser texto simples, ADF ou uma lista de valores.
function fieldText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(fieldText).join('\n');
  if (value.type === 'hardBreak') return '\n';
  if (value.filename) return [value.filename, typeof value.content === 'string' ? value.content : ''].filter(Boolean).join(' ');
  if (value.type === 'text') return value.text;
  if (Array.isArray(value.content)) {
    const inline = ['paragraph', 'heading', 'codeBlock'].includes(value.type);
    return value.content.map(fieldText).join(inline ? '' : '\n');
  }
  return fieldText(value.value || value.name || value.attrs?.url || value.url);
}

const sqlStart = /^(?:SELECT|WITH|INSERT\s+INTO|UPDATE|DELETE\s+FROM|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|MERGE\s+INTO|BEGIN|COMMIT|ROLLBACK|SET|CALL|EXEC(?:UTE)?)\b/i;
const envLabel = /\b(?:envs?|dotenv|environment variables?|vari[aá]ve(?:is|l)\s+de\s+ambiente)\b/i;
const branchLabel = /\bbranch(?:es)?\b/i;
const sqlLabel = /\bsql\b/i;

export function isDevelopmentField({ id, name }) {
  return /^customfield_\d+$/.test(id) && (branchLabel.test(name) || sqlLabel.test(name) || envLabel.test(name));
}

function envCommand(line, inEnvSection) {
  return /^(?:export\s+)?[A-Za-z_]\w*=/.test(line)
    || /^\$env:[A-Za-z_]\w*\s*=/i.test(line)
    || /^(?:kubectl|oc)\s+.*\bset\s+env\b/.test(line)
    || /^set\s+"[A-Za-z_]\w*=/i.test(line)
    || (inEnvSection && /^(?:set\s+[A-Za-z_]\w*\s*=|[A-Za-z_]\w*\s*[:=])/i.test(line));
}

function envEntries(command) {
  // Se o Jira juntou atribuições na mesma linha, só separe quando toda a linha for inequívoca.
  const parts = command.trim().match(/[A-Za-z_]\w*=(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s"'\\]*)/g) || [];
  let rest = command.trim();
  for (const part of parts) {
    if (!rest.startsWith(part)) return [command];
    rest = rest.slice(part.length);
    if (rest && !/^\s/.test(rest)) return [command];
    rest = rest.trimStart();
  }
  return !rest && parts.length > 1 ? parts : [command];
}

function sqlStatements(text) {
  // O ponto e vírgula só encerra uma instrução fora de literais, comentários e blocos PostgreSQL.
  const tokens = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|\\.|[^'])*'|"(?:""|[^"])*"|\x60(?:\x60\x60|[^\x60])*\x60|(\$(?:[a-z_]\w*)?\$)[\s\S]*?\1|;/gi;
  const commands = [];
  let start = 0;
  for (const match of text.matchAll(tokens)) {
    if (match[0] !== ';') continue;
    commands.push(text.slice(start, match.index + 1).trim());
    start = match.index + 1;
  }
  commands.push(text.slice(start).trim());
  return commands.filter(Boolean);
}

function descriptionSql(node, addSql) {
  if (!node) return;
  if (typeof node === 'string') {
    for (const match of node.matchAll(/^```(?:sql|postgresql|mysql|tsql)\s*\n([\s\S]*?)^```/gim)) addSql(match[1]);
    if (sqlStart.test(node.trim()) && !envCommand(node.trim(), false)) addSql(node);
    return;
  }
  if (node.type === 'codeBlock' || node.type === 'paragraph') {
    const text = fieldText(node).trim();
    const language = node.attrs?.language;
    if (/sql/i.test(language || '') || (!language && sqlStart.test(text) && !envCommand(text, false))) addSql(text);
    return;
  }
  for (const child of node.content || []) descriptionSql(child, addSql);
}

function addBranch(branches, branch) {
  const same = branches.find(b => b.name === branch.name &&
    (!branch.repo || !b.repo || b.repo.toLowerCase() === branch.repo.toLowerCase()));
  if (!same) branches.push(branch);
  else if (!same.repo && branch.repo) same.repo = branch.repo;
}

function readField(text, name, kind) {
  const result = { branches: [], scripts: [], envs: [], unparsed: [] };
  if (kind === 'sql') { result.scripts.push(text); return result; }
  let repo = '', envSection = kind === 'env' ? name : '', pendingSql = '';
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) { if (pendingSql) pendingSql += '\n'; continue; }
    if (/^(?:(?:novas?|novos?|adicionar|inserir|configurar)\s+)?(?:\.?envs?|vari[aá]ve(?:is|l) de ambiente|environment variables?)\b/i.test(line) && !line.includes('=')) {
      if (pendingSql) { result.scripts.push(pendingSql); pendingSql = ''; }
      envSection = line.replace(/:\s*$/, '');
      continue;
    }
    if ((!pendingSql || pendingSql.trimEnd().endsWith(';')) && envCommand(line, !!envSection)) {
      if (pendingSql) { result.scripts.push(pendingSql); pendingSql = ''; }
      let command = raw;
      while (command.endsWith('\\') && i + 1 < lines.length) command += '\n' + lines[++i];
      for (const entry of envEntries(command)) result.envs.push({ section: envSection, command: entry });
      continue;
    }
    if (kind === 'env') {
      result.envs.push({ section: envSection, command: raw, note: true });
      continue;
    }
    if (kind === 'description') continue;
    // Um campo Branch também pode trazer SQL, notas de ambiente e nomes de repositório.
    if ((pendingSql && !pendingSql.trimEnd().endsWith(';')) || sqlStart.test(line) || /^(--|\/\*)/.test(line)) {
      envSection = '';
      pendingSql += (pendingSql ? '\n' : '') + raw;
      continue;
    }
    if (pendingSql) { result.scripts.push(pendingSql); pendingSql = ''; }
    if (/^[\wÀ-ÿ ,.-]+:$/.test(line)) { repo = line.slice(0, -1); envSection = ''; continue; }
    const labeled = line.match(/^([\wÀ-ÿ .,/-]+?)\s+(?:-|–|—)\s+(.+)$/) || line.match(/^([\wÀ-ÿ ,.-]+):\s+(.+)$/);
    const value = labeled ? labeled[2] : line;
    const names = value.split(/\s*[,;]\s*|\s+(?=[\w.-]+\/)/).filter(Boolean);
    let partial = false;
    for (let ref of names) {
      if (/^https?:\/\//i.test(ref)) {
        const path = ref.match(/\/(?:tree|branch|src)\/([^?#]+)/);
        if (!path) { partial = true; continue; }
        try { ref = decodeURIComponent(path[1]); } catch { partial = true; continue; }
      }
      if (!/^[\p{L}\p{N}_][\p{L}\p{N}._+@/-]*$/u.test(ref) || ref.endsWith('/') || ref.includes('..') ||
          (envSection && !labeled && !ref.includes('/'))) { partial = true; continue; }
      envSection = '';
      result.branches.push({ name: ref, repo: labeled ? labeled[1] : repo });
    }
    if (partial) result.unparsed.push(raw);
  }
  if (pendingSql) result.scripts.push(pendingSql);
  return result;
}

export function developmentDetails(devBranches, fields, definitions) {
  const branches = [], sql = [], envs = [], sources = [], scripts = new Set();
  const deploy = { branches: [], sql: [], envs: [] };
  const legacy = { sql: [], envs: [] };
  function addSql(text) {
    const script = text.trim();
    const commands = sqlStatements(script);
    if (!scripts.has(script)) {
      scripts.add(script);
      sql.push(...commands);
    }
    return commands;
  }
  devBranches.forEach(b => { if (b.name) addBranch(branches, { ...b }); });
  for (const { id, name } of definitions) {
    const text = fieldText(fields[id]);
    if (!text.trim() && !fields[id]?.content?.length) continue;
    let kind = 'mixed';
    if (!branchLabel.test(name)) {
      if (envLabel.test(name) && !sqlLabel.test(name)) kind = 'env';
      if (sqlLabel.test(name) && !envLabel.test(name)) kind = 'sql';
    }
    const parsed = readField(text, name, kind);
    sources.push({ name, value: fields[id], text, unparsed: parsed.unparsed });
    for (const ref of parsed.branches) {
      addBranch(deploy.branches, { ...ref });
      addBranch(branches, ref);
    }
    for (const script of parsed.scripts) (kind === 'sql' ? deploy : legacy).sql.push(...addSql(script));
    (kind === 'env' ? deploy : legacy).envs.push(...parsed.envs);
    envs.push(...parsed.envs.filter(e => !e.note));
  }
  if (fields.description) {
    const text = fieldText(fields.description);
    sources.push({ name: 'Descrição', value: fields.description, text });
    envs.push(...readField(text, 'Descrição', 'description').envs);
    descriptionSql(fields.description, addSql);
  }
  if (!deploy.sql.length) deploy.sql = legacy.sql;
  if (!deploy.envs.length) deploy.envs = legacy.envs;
  return { branches, sql, envs, sources, deploy };
}

export function branchCommands(name) {
  // Preserve os nomes vindos da integração Git como um único argumento de shell.
  const quote = ref => /^[a-z0-9_./-]+$/i.test(ref) ? ref : "'" + ref.replaceAll("'", "'\\''") + "'";
  const mergeOnly = 'git merge --no-ff ' + quote('origin/' + name);
  return {
    checkout: 'git fetch origin && git checkout ' + quote(name),
    merge: 'git fetch origin && ' + mergeOnly,
    mergeOnly,
  };
}

export function deployFields({ deploy }) {
  return [
    { label: 'Branches', entries: deploy.branches.map(b => ({ group: b.repo, text: b.name })) },
    { label: 'SQL', entries: deploy.sql.map(text => ({ text })) },
    { label: 'ENVs', entries: deploy.envs.map(e => ({ group: e.section, text: e.command })) },
  ];
}

export function deployReport(issues) {
  return issues.map(issue => {
    const title = [issue.key, issue.summary].filter(Boolean).join(' — ');
    if (issue.error) return title + '\nNão foi possível carregar a demanda. ' + issue.error;
    const sections = deployFields(issue).map(({ label, entries }) => {
      const lines = entries.map(({ group, text }, index) =>
        group && entries[index - 1]?.group !== group ? group + ':\n' + text : text);
      return label + '\n' + (lines.join('\n') || 'Nenhum item identificado.');
    });
    for (const field of issue.sources || []) {
      if (field.unparsed?.length) sections.push('Observações · ' + field.name + '\n' + field.unparsed.join('\n'));
    }
    if (issue.fieldsUnavailable) sections.unshift('Campos do Jira indisponíveis.');
    return [title, ...sections].join('\n\n');
  }).join('\n\n────────────────────\n\n');
}
