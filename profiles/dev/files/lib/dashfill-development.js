// Campos do Jira podem ser texto simples, ADF ou uma lista de valores.
function fieldText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(fieldText).join('\n');
  if (value.type === 'hardBreak') return '\n';
  if (value.type === 'text') return value.text;
  if (value.content) {
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

export function developmentDetails(devBranches, fields, definitions) {
  const branches = [], sql = [], envs = [], sources = [], scripts = new Set();
  function addBranch(branch) {
    const same = branches.find(b => b.name === branch.name &&
      (!branch.repo || !b.repo || b.repo.toLowerCase() === branch.repo.toLowerCase()));
    if (!same) branches.push(branch);
    else if (!same.repo && branch.repo) same.repo = branch.repo;
  }
  function addSql(text) {
    const script = text.trim();
    if (!script || scripts.has(script)) return;
    scripts.add(script);
    sql.push(...sqlStatements(script));
  }
  devBranches.forEach(b => { if (b.name) addBranch({ ...b }); });
  function readField(text, name, description = false) {
    const envOnly = envLabel.test(name) && !branchLabel.test(name) && !sqlLabel.test(name);
    if (sqlLabel.test(name) && !branchLabel.test(name) && !envLabel.test(name)) { addSql(text); return; }
    let repo = '', envSection = envOnly ? name : '', pendingSql = '';
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();
      if (!line) { if (pendingSql) pendingSql += '\n'; continue; }
      if (/^(?:(?:novas?|novos?|adicionar|inserir|configurar)\s+)?(?:\.?envs?|vari[aá]ve(?:is|l) de ambiente|environment variables?)\b/i.test(line) && !line.includes('=')) {
        if (pendingSql) { addSql(pendingSql); pendingSql = ''; }
        envSection = line.replace(/:\s*$/, '');
        continue;
      }
      if ((!pendingSql || pendingSql.trimEnd().endsWith(';')) && envCommand(line, !!envSection)) {
        if (pendingSql) { addSql(pendingSql); pendingSql = ''; }
        let command = raw;
        while (command.endsWith('\\') && i + 1 < lines.length) command += '\n' + lines[++i];
        for (const entry of envEntries(command)) envs.push({ section: envSection, command: entry });
        continue;
      }
      if (description || envOnly) continue;
      // Um campo Branch também pode trazer SQL, notas de ambiente e nomes de repositório.
      if ((pendingSql && !pendingSql.trimEnd().endsWith(';')) || sqlStart.test(line) || /^(--|\/\*)/.test(line)) {
        envSection = '';
        pendingSql += (pendingSql ? '\n' : '') + raw;
        continue;
      }
      if (pendingSql) { addSql(pendingSql); pendingSql = ''; }
      if (/^[\wÀ-ÿ ,.-]+:$/.test(line)) { repo = line.slice(0, -1); envSection = ''; continue; }
      const labeled = line.match(/^([\wÀ-ÿ .,/-]+?)\s+(?:-|–|—)\s+(.+)$/) || line.match(/^([\wÀ-ÿ ,.-]+):\s+(.+)$/);
      const value = labeled ? labeled[2] : line;
      const names = value.split(/\s*[,;]\s*|\s+(?=[\w.-]+\/)/).filter(Boolean);
      for (let ref of names) {
        if (/^https?:\/\//i.test(ref)) {
          const path = ref.match(/\/(?:tree|branch|src)\/([^?#]+)/);
          if (!path) continue;
          try { ref = decodeURIComponent(path[1]); } catch { continue; }
        }
        if (!/^[\p{L}\p{N}_][\p{L}\p{N}._+@/-]*$/u.test(ref) || ref.endsWith('/') || ref.includes('..')) continue;
        if (envSection && !labeled && !ref.includes('/')) continue;
        envSection = '';
        addBranch({ name: ref, repo: labeled ? labeled[1] : repo });
      }
    }
    if (pendingSql) addSql(pendingSql);
  }
  for (const { id, name } of definitions) {
    const text = fieldText(fields[id]);
    if (!text.trim() && !fields[id]?.content?.length) continue;
    sources.push({ name, value: fields[id], text });
    readField(text, name);
  }
  if (fields.description) {
    const text = fieldText(fields.description);
    sources.push({ name: 'Descrição', value: fields.description, text });
    readField(text, 'Descrição', true);
  }
  descriptionSql(fields.description, addSql);
  return { branches, sql, envs, sources };
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
