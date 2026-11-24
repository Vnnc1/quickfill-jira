/* DashFill DEV: o quadro continua sendo do Jira (navegação, cliques e arraste).
 * Por cima dele: a lateral "Meu dia" (com o cronômetro da demanda em andamento), a barra de baixo com o
 * contexto da demanda e os modos de trabalho do DEV (Foco e Deploy). */
(async () => {
  if (document.getElementById('quickfill-dev-dashfill')) return;
  const url = (file) => chrome.runtime.getURL(file);
  const [
    { extractLinks, formatMinutes, formatHM, timelineMetrics, issueKey },
    { developmentDetails, branchCommands, isDevelopmentField },
    { renderHistory },
    { loadAccent },
    { clockText, autoStartCandidate, addSkip, worklogFor, isDoingStatus, enteredStatusAt },
  ] = await Promise.all([
    import(url('lib/board-rules.js')),
    import(url('lib/dashfill-development.js')),
    import(url('lib/history-view.js')),
    import(url('lib/theme.js')),
    import(url('lib/focus-timer.js')),
  ]);

  /* ================================================================ */
  /* Estrutura                                                         */
  /* ================================================================ */
  const host = document.createElement('div');
  host.id = 'quickfill-dev-dashfill';
  host.dataset.qfOwned = 'true';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<link rel="stylesheet" href="${url('dashfill.css')}">
    <button class="launch" aria-pressed="false" hidden><span class="mark">QF</span><span>DashFill</span><span class="sw" aria-hidden="true"><i></i></span></button>
    <div class="colbtns"></div>
    <aside class="day" aria-label="Meu dia no QuickFill DEV" hidden></aside>
    <aside class="mside" aria-label="QuickFill DEV: cronômetro da demanda aberta" hidden></aside>
    <section class="dock" aria-label="DashFill" hidden>
      <div class="grip" title="Arraste para mudar a altura" aria-hidden="true"></div>
      <header class="bar">
        <span class="mark">QF</span>
        <div class="who"></div>
        <nav class="modes" aria-label="Modos do DashFill"></nav>
        <button class="btn compact-day" data-action="day">Meu dia</button>
        <div class="sizes" role="group" aria-label="Altura da barra"></div>
        <button class="ic" data-action="refresh" title="Atualizar" aria-label="Atualizar">↻</button>
        <button class="btn fold" data-action="fold" aria-expanded="false" aria-controls="df-panel"><span aria-hidden="true"></span><b>Abrir painel</b></button>
      </header>
      <nav class="tabs" aria-label="Contexto da demanda" hidden></nav>
      <div class="body" id="df-panel" hidden></div>
    </section>`;
  document.documentElement.append(host);
  loadAccent('dev', host);

  // Marcas sobre os cards do Jira (fora do shadow): lista de deploy, card escolhido e o que sai de foco.
  const pageCss = document.createElement('style');
  pageCss.dataset.qfOwned = 'true';
  pageCss.textContent = `[data-qf-deploy]{outline:2px solid #4bce97!important;outline-offset:-2px;border-radius:6px}
    [data-qf-sel]{outline:2px solid rgba(87,157,255,.9)!important;outline-offset:-2px;border-radius:6px}
    [data-qf-dim]{opacity:.32;transition:opacity .2s}
    [data-qf-dim]:hover{opacity:.8}
    [data-qf-card]{position:relative}
    /* Ações do DashFill: dentro do próprio card, na lateral direita, só ao passar o mouse (ou com o teclado).
       Ficam por cima do card, sem mudar a altura dele nem invadir os cards vizinhos. */
    .qf-card-actions{position:absolute;z-index:3;top:50%;right:6px;display:flex;flex-direction:column;gap:5px;padding:4px;border-radius:999px;background:rgba(22,26,29,.72);backdrop-filter:blur(3px);box-shadow:0 4px 14px rgba(0,0,0,.35);opacity:0;pointer-events:none;transform:translate(8px,-50%);transition:opacity .16s ease,transform .18s cubic-bezier(.2,.8,.2,1)}
    [data-qf-card]:hover>.qf-card-actions,.qf-card-actions:focus-within{opacity:1;pointer-events:auto;transform:translate(0,-50%)}
    .qf-card-action{box-sizing:border-box;width:26px;height:26px;display:grid;place-items:center;padding:0;border-radius:50%;border:1px solid #467060;background:#1d2a24;color:#b6f1d5;cursor:pointer;transition:background .15s,color .15s,transform .15s,border-color .15s}
    .qf-card-action svg{width:14px;height:14px;display:block}
    .qf-card-action:hover,.qf-card-action:focus-visible{background:#4bce97;border-color:#4bce97;color:#102018;transform:scale(1.08)}
    .qf-card-action:focus-visible{outline:2px solid #4bce97;outline-offset:2px}
    .qf-card-action[aria-pressed="true"]{background:#4bce97;border-color:#4bce97;color:#102018}
    /* Na lista do deploy: o ⇪ fica à vista mesmo sem o mouse, para mostrar que o card está na lista. */
    [data-qf-deploy]>.qf-card-actions{opacity:1;pointer-events:auto;transform:translate(0,-50%);background:transparent;box-shadow:none;backdrop-filter:none}
    [data-qf-deploy]:not(:hover)>.qf-card-actions:not(:focus-within) .qf-open{opacity:0;pointer-events:none}
    [data-qf-deploy]:hover>.qf-card-actions{background:rgba(22,26,29,.72);box-shadow:0 4px 14px rgba(0,0,0,.35)}
    @media(prefers-reduced-motion:reduce){.qf-card-actions,.qf-card-action{transition:none}}
    /* Faixa "rodando agora" embaixo do card da demanda com o cronômetro ligado. */
    .qf-run{display:flex;flex-wrap:wrap;align-items:center;gap:3px 8px;margin:8px 0 0;padding:7px 9px;border-radius:7px;background:rgba(75,206,151,.12);border:1px solid rgba(75,206,151,.45);color:#dee4ea;font:600 11.5px/1.35 -apple-system,'Segoe UI',sans-serif;animation:qfRunIn .2s ease-out}
    .qf-run-rec{width:7px;height:7px;border-radius:50%;background:#f87168;flex:none;animation:qfRec 1.6s ease-out infinite}
    .qf-run-clock{font-size:13px;font-weight:750;font-variant-numeric:tabular-nums;color:#b6f1d5}
    .qf-run-k::before{content:attr(data-k);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#85b8ff}
    .qf-run-due{margin-left:auto;color:#c7d1db;white-space:nowrap}
    .qf-run-due.today{color:#f5cd47}.qf-run-due.late{color:#ffa69e}
    .qf-run-bar{flex:1 1 100%;height:4px;border-radius:2px;background:rgba(255,255,255,.1);overflow:hidden}
    .qf-run-bar i{display:block;height:100%;border-radius:2px;background:#4bce97;transition:width .4s ease}
    .qf-run-bar.over i{background:#f87168}
    .qf-run-t{flex:1 1 100%;color:#9fadbc;font-weight:500}
    .qf-run-t b{color:#dee4ea;font-weight:650}.qf-run-t .over{color:#ffa69e}
    @keyframes qfRec{50%{opacity:.35}}
    @keyframes qfRunIn{from{opacity:0;transform:translateY(-3px)}}
    @media(prefers-reduced-motion:reduce){.qf-run,.qf-run-rec,.qf-run-bar i{animation:none;transition:none}}`;
  document.head.append(pageCss);

  const $ = (s) => root.querySelector(s);
  const launch = $('.launch'), day = $('.day'), dock = $('.dock'), colBox = $('.colbtns'), sideEl = $('.mside');
  const body = $('.body'), tabsEl = $('.tabs'), whoEl = $('.who'), modesEl = $('.modes'), sizesEl = $('.sizes');

  /* ================================================================ */
  /* Utilitários                                                       */
  /* ================================================================ */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const note = (m, cls = '') => `<p class="note ${cls}" role="status">${esc(m)}</p>`;
  const validKey = (k) => /^[A-Z][A-Z0-9_]*-\d+$/.test(k || '');
  const safeUrl = (v) => { if (!v) return ''; try { const u = new URL(v, location.origin); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
  const W = (ms) => new Promise((r) => setTimeout(r, ms));
  const ago = (iso) => {
    const d = (Date.now() - Date.parse(iso)) / 60000;
    if (!isFinite(d)) return '';
    if (d < 60) return `há ${Math.max(1, Math.round(d))} min`;
    if (d < 1440) return `há ${Math.round(d / 60)} h`;
    return `há ${Math.round(d / 1440)} d`;
  };
  const initials = (n = '') => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const hue = (n = '') => [...n].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  const avatar = (name) => `<span class="av" style="--h:${hue(name)}" title="${esc(name)}">${esc(initials(name))}</span>`;
  const statusTone = (cat, name = '') => (cat === 'done' ? 'ok' : /impedid|bloque|aguard/i.test(name) ? 'warn' : cat === 'indeterminate' ? 'data' : 'muted');
  const prLabel = (s) => (s === 'MERGED' ? 'merged' : s === 'OPEN' ? 'aberto' : s === 'DECLINED' ? 'recusado' : String(s || '—').toLowerCase());
  const prTone = (s) => (s === 'MERGED' ? 'ok' : s === 'OPEN' ? 'warn' : 'muted');
  async function mapLimit(list, n, fn) {
    const out = new Array(list.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; try { out[k] = await fn(list[k], k); } catch (e) { out[k] = { error: e.message, key: list[k] }; } } }));
    return out;
  }
  async function send(type, payload = {}) {
    const { baseUrl } = await chrome.storage.sync.get({ baseUrl: '' });
    if (!baseUrl || new URL(baseUrl).origin !== location.origin) throw Error('Confira a URL deste Jira nas Opções do QuickFill DEV.');
    const res = await chrome.runtime.sendMessage({ type, payload });
    if (!res?.ok) throw Error(res?.error || 'O serviço do QuickFill não respondeu.');
    return res.data;
  }
  async function api(path, options = {}) {
    const r = await fetch(path.startsWith('/') ? path : '/rest/api/3/' + path, {
      credentials: 'same-origin', signal: AbortSignal.timeout(15000), ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    });
    if (r.status === 204) return null;
    if (!r.ok) throw Error(`Jira respondeu HTTP ${r.status}.`);
    return r.json();
  }
  const jql = (q, fields, max = 50, extra = {}) => api('search/jql', { method: 'POST', body: JSON.stringify({ jql: q, fields, maxResults: max, ...extra }) }).then((r) => r.issues || []);
  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); flash(btn, 'Copiado ✓'); } catch { flash(btn, 'Não deu para copiar'); }
  }
  function flash(btn, txt) {
    if (!btn) return;
    const old = btn.dataset.label || btn.innerHTML;
    btn.dataset.label = old;
    btn.textContent = txt;
    setTimeout(() => { if (btn.isConnected) { btn.innerHTML = old; delete btn.dataset.label; } }, 1400);
  }

  /* ---------- texto do Jira (ADF) → HTML, e editor → ADF ---------- */
  const COLORS = /^#[0-9a-f]{3,8}$/i;
  function marksWrap(text, marks = []) {
    let h = esc(text);
    for (const m of marks) {
      if (m.type === 'strong') h = `<strong>${h}</strong>`;
      else if (m.type === 'em') h = `<em>${h}</em>`;
      else if (m.type === 'underline') h = `<u>${h}</u>`;
      else if (m.type === 'strike') h = `<s>${h}</s>`;
      else if (m.type === 'code') h = `<code class="ic-code">${h}</code>`;
      else if (m.type === 'subsup') h = m.attrs?.type === 'sub' ? `<sub>${h}</sub>` : `<sup>${h}</sup>`;
      else if (m.type === 'textColor' && COLORS.test(m.attrs?.color || '')) h = `<span style="color:${m.attrs.color}">${h}</span>`;
      else if (m.type === 'link') { const u = safeUrl(m.attrs?.href); h = u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${h}</a>` : h; }
    }
    return h;
  }
  function adf(node) {
    if (!node) return '';
    if (typeof node === 'string') return esc(node).replace(/\n/g, '<br>');
    if (Array.isArray(node)) return node.map(adf).join('');
    const kids = () => adf(node.content || []);
    switch (node.type) {
      case 'doc': return kids();
      case 'paragraph': return `<p>${kids() || '&nbsp;'}</p>`;
      case 'text': return marksWrap(node.text || '', node.marks);
      case 'hardBreak': return '<br>';
      case 'heading': { const l = Math.min(6, Math.max(1, node.attrs?.level || 2)); return `<h${l + 2 > 6 ? 6 : l + 2} class="h${l}">${kids()}</h${l + 2 > 6 ? 6 : l + 2}>`; }
      case 'bulletList': return `<ul>${kids()}</ul>`;
      case 'orderedList': return `<ol>${kids()}</ol>`;
      case 'listItem': return `<li>${kids()}</li>`;
      case 'taskList': return `<ul class="tasks">${kids()}</ul>`;
      case 'taskItem': return `<li class="${node.attrs?.state === 'DONE' ? 'done' : ''}">${kids()}</li>`;
      case 'blockquote': return `<blockquote>${kids()}</blockquote>`;
      case 'codeBlock': return `<pre><code>${esc((node.content || []).map((c) => c.text || '').join(''))}</code></pre>`;
      case 'rule': return '<hr>';
      case 'panel': return `<div class="panel ${esc(node.attrs?.panelType || 'info')}">${kids()}</div>`;
      case 'mention': return `<span class="mention">@${esc(String(node.attrs?.text || '').replace(/^@/, ''))}</span>`;
      case 'emoji': return esc(node.attrs?.text || node.attrs?.shortName || '');
      case 'status': return `<span class="pill muted">${esc(node.attrs?.text || '')}</span>`;
      case 'date': return esc(new Date(Number(node.attrs?.timestamp)).toLocaleDateString('pt-BR'));
      case 'inlineCard': case 'blockCard': case 'embedCard': { const u = safeUrl(node.attrs?.url); return u ? `<a class="card-link" href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//, '').slice(0, 70))}</a>` : ''; }
      case 'mediaSingle': case 'mediaGroup': case 'media': return '<span class="media">anexo (abra no Jira para ver)</span>';
      case 'table': return `<div class="tbl-wrap"><table class="adf-t">${kids()}</table></div>`;
      case 'tableRow': return `<tr>${kids()}</tr>`;
      case 'tableHeader': return `<th>${kids()}</th>`;
      case 'tableCell': return `<td>${kids()}</td>`;
      case 'expand': case 'nestedExpand': return `<details><summary>${esc(node.attrs?.title || 'Mais')}</summary>${kids()}</details>`;
      default: return kids();
    }
  }
  const plain = (node) => {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(plain).join(' ');
    return node.text || node.attrs?.text || plain(node.content || []);
  };
  /** Editor (contenteditable) → ADF: negrito, itálico, sublinhado, riscado, código, link, títulos, listas, citação. */
  function htmlToAdf(el) {
    const inline = (n, marks = []) => {
      if (n.nodeType === 3) return n.textContent ? [{ type: 'text', text: n.textContent, ...(marks.length ? { marks } : {}) }] : [];
      if (n.nodeType !== 1) return [];
      const t = n.tagName.toLowerCase();
      if (t === 'br') return [{ type: 'hardBreak' }];
      const add = { b: 'strong', strong: 'strong', i: 'em', em: 'em', u: 'underline', s: 'strike', strike: 'strike', code: 'code' }[t];
      let next = add ? [...marks, { type: add }] : marks;
      if (t === 'a' && safeUrl(n.getAttribute('href'))) next = [...marks, { type: 'link', attrs: { href: safeUrl(n.getAttribute('href')) } }];
      if (t === 'span' && /font-weight:\s*(bold|[6-9]00)/.test(n.getAttribute('style') || '')) next = [...next, { type: 'strong' }];
      return [...n.childNodes].flatMap((c) => inline(c, next));
    };
    const blocks = [];
    let para = [];
    const flush = () => { if (para.length) blocks.push({ type: 'paragraph', content: para }); para = []; };
    const block = (n) => {
      if (n.nodeType === 3) { if (n.textContent.trim() || para.length) para.push(...inline(n)); return; }
      if (n.nodeType !== 1) return;
      const t = n.tagName.toLowerCase();
      if (/^h[1-6]$/.test(t)) { flush(); blocks.push({ type: 'heading', attrs: { level: Number(t[1]) }, content: inline(n) }); return; }
      if (t === 'ul' || t === 'ol') {
        flush();
        blocks.push({ type: t === 'ul' ? 'bulletList' : 'orderedList', content: [...n.children].filter((li) => li.tagName === 'LI').map((li) => ({ type: 'listItem', content: [{ type: 'paragraph', content: inline(li) }] })) });
        return;
      }
      if (t === 'blockquote') { flush(); blocks.push({ type: 'blockquote', content: [{ type: 'paragraph', content: inline(n) }] }); return; }
      if (t === 'pre') { flush(); blocks.push({ type: 'codeBlock', content: [{ type: 'text', text: n.textContent }] }); return; }
      if (t === 'div' || t === 'p') { flush(); const c = [...n.childNodes].flatMap((x) => inline(x)); blocks.push({ type: 'paragraph', content: c }); return; }
      para.push(...inline(n));
    };
    [...el.childNodes].forEach(block);
    flush();
    return { type: 'doc', version: 1, content: blocks.filter((b) => b.type !== 'paragraph' || b.content.length) };
  }

  /* ================================================================ */
  /* Estado                                                            */
  /* ================================================================ */
  const PREF = 'qf.dev.dashfill.active', DEPLOY = 'qf.dev.dashfill.deploy', SIZE = 'qf.dev.dashfill.size', FOCUS = 'qf.dev.dashfill.focus', SKIP = 'qf.dev.dashfill.focus.skip';
  const MODES = [
    ['issue', 'Demanda', 'O contexto da demanda escolhida no quadro'],
    ['focus', 'Foco', 'Só o que é seu, com o cronômetro do Meu dia'],
    ['deploy', 'Deploy', 'Lista de demandas para subir juntas'],
  ];
  const TABS = [['resumo', 'Resumo'], ['git', 'Branches e SQL'], ['envs', 'ENVs'], ['docs', 'Docs e Figma'], ['comments', 'Comentários'], ['history', 'Histórico']];
  const SIZES = { s: 230, m: 360, l: Math.round(innerHeight * 0.58) };
  let active = false, expandedDay = false, folded = true, view = 'issue', tab = 'resumo', size = 'm';
  let key = '', current = null, colView = null, route = '', refreshedAt = 0, confirmBox = null;
  let seq = 0, daySeq = 0, sessionOn = false, deployList = [], focus = null, myKeys = null, skip = null;
  const reserved = new Map();
  let dialogOpen = false;
  try {
    const saved = sessionStorage.getItem(PREF);
    sessionOn = saved === null ? sessionStorage.getItem('quickfill-board-active') === 'true' : saved === '1';
    deployList = JSON.parse(sessionStorage.getItem(DEPLOY) || '[]').filter(validKey);
    size = localStorage.getItem(SIZE) || 'm';
    focus = JSON.parse(localStorage.getItem(FOCUS) || 'null');
    skip = JSON.parse(localStorage.getItem(SKIP) || 'null');
  } catch { /* sem storage */ }
  const applySize = (px) => host.style.setProperty('--dock-h', (px || SIZES[size] || 360) + 'px');
  applySize();
  const saveDeploy = () => { try { sessionStorage.setItem(DEPLOY, JSON.stringify(deployList)); } catch { /* sem storage */ } };
  const saveFocus = () => { try { localStorage.setItem(FOCUS, JSON.stringify(focus)); } catch { /* sem storage */ } };
  const saveSkip = () => { try { localStorage.setItem(SKIP, JSON.stringify(skip)); } catch { /* sem storage */ } };
  // O cronômetro é um só para todas as abas do Jira: sempre lê o que está gravado antes de mexer.
  const storedFocus = () => { try { return JSON.parse(localStorage.getItem(FOCUS) || 'null'); } catch { return focus; } };
  const drafts = new Map(), posting = new Set(), cache = new Map();

  /* ================================================================ */
  /* Dados de uma demanda: campos, links, branch e PR (dev-status)     */
  /* ================================================================ */
  let fieldIdsP = null;
  const developmentFields = () => (fieldIdsP ||= api('field')
    .then(fields => fields.filter(isDevelopmentField))
    .catch(error => { fieldIdsP = null; throw error; }));
  async function devStatus(issueId) {
    const out = { branches: [], prs: [], builds: 0, error: '' };
    try {
      const s = (await api(`/rest/dev-status/latest/issue/summary?issueId=${issueId}`))?.summary || {};
      const types = new Set([...Object.keys(s.branch?.byInstanceType || {}), ...Object.keys(s.pullrequest?.byInstanceType || {})]);
      out.builds = s.build?.overall?.count || 0;
      for (const app of types) {
        const [br, pr] = await Promise.all(['branch', 'pullrequest'].map((t) => api(`/rest/dev-status/latest/issue/detail?issueId=${issueId}&applicationType=${encodeURIComponent(app)}&dataType=${t}`).catch(() => null)));
        for (const d of br?.detail || []) for (const b of d.branches || []) out.branches.push({ name: b.name, url: safeUrl(b.url), repo: b.repository?.name || '', commit: b.lastCommit?.displayId || '', commitMsg: b.lastCommit?.message || '', at: b.lastCommit?.authorTimestamp || '' });
        for (const d of pr?.detail || []) for (const p of d.pullRequests || []) out.prs.push({ id: p.id, title: p.name, url: safeUrl(p.url), state: String(p.status || '').toUpperCase(), from: p.source?.branch || '', to: p.destination?.branch || '', repo: p.repositoryName || '', reviewers: (p.reviewers || []).map((r) => ({ name: r.name, ok: !!r.approved })), at: p.lastUpdate || '', comments: p.commentCount || 0 });
      }
    } catch (e) { out.error = e.message; }
    return out;
  }
  async function issueData(k, force = false) {
    const hit = cache.get(k);
    if (!force && hit && Date.now() - hit.at < 120000) return hit.data;
    const definitions = await developmentFields().catch(() => null);
    const fields = ['summary', 'status', 'assignee', 'reporter', 'priority', 'duedate', 'timetracking', 'issuetype', 'parent', 'description', 'updated', 'created', 'labels', 'issuelinks', 'comment', ...(definitions || []).map(field => field.id)];
    const [issue, remote] = await Promise.all([api(`issue/${k}?fields=${fields.join(',')}`), api(`issue/${k}/remotelink`).catch(() => [])]);
    const dev = await devStatus(issue.id);
    const f = issue.fields || {};
    const development = developmentDetails(dev.branches, f, definitions || []);
    const data = { key: k, id: issue.id, f, dev, ...development, fieldsUnavailable: !definitions, links: extractLinks(issue, remote || []), summary: f.summary || '', status: f.status?.name || '', cat: f.status?.statusCategory?.key || '', comments: f.comment?.total ?? (f.comment?.comments || []).length };
    cache.set(k, { at: Date.now(), data });
    return data;
  }
  function readiness(d) {
    const open = d.dev.prs.filter((p) => p.state === 'OPEN'), merged = d.dev.prs.filter((p) => p.state === 'MERGED');
    if (!d.branches.length && !d.dev.prs.length) return { tone: 'warn', txt: 'sem branch' };
    if (open.length) return { tone: 'warn', txt: open.length > 1 ? `${open.length} PRs abertos` : 'PR aberto' };
    if (merged.length) return { tone: 'ok', txt: 'PR merged' };
    return { tone: 'muted', txt: 'branch sem PR' };
  }
  function timeOf(tt = {}) {
    const est = tt.originalEstimateSeconds || 0, spent = tt.timeSpentSeconds || 0;
    return { est, spent, pct: est ? Math.min(100, Math.round((spent / est) * 100)) : spent ? 100 : 0, over: est && spent > est,
      txt: spent ? formatMinutes(Math.round(spent / 60)) : '0m', estTxt: est ? formatMinutes(Math.round(est / 60)) : 'sem estimativa' };
  }

  /* ================================================================ */
  /* Quadro do Jira: cards, colunas, rota e espaço para a barra        */
  /* ================================================================ */
  const CARD_SEL = '[data-testid*="board-kit.ui.card"],[data-testid*="card.container"],[data-rbd-draggable-id],[data-issue-key]';
  const ITEM_SEL = 'li,[role="listitem"],article';
  const ISSUE_LINK = 'a[href*="/browse/"],a[href*="selectedIssue="],a[href*="selectedIssueKey="]';
  const COL_SEL = '[data-testid*="board-kit.ui.column"],[data-rbd-droppable-id^="column"],[data-testid*="board-column"]';
  const boardRoute = () => /\/boards?\/\d+(?:\/|$)|\/projects\/[^/]+\/board\/?$|\/secure\/RapidBoard\.jspa$/i.test(location.pathname) || !!document.querySelector(COL_SEL);
  function cardAt(el) {
    const node = el?.closest?.(ITEM_SEL) || el?.closest?.('[data-rbd-draggable-id],[data-issue-key]') || el?.closest?.(CARD_SEL);
    if (!node || node.closest('dialog,[role="dialog"],[aria-modal="true"],nav,[role="navigation"]') || host.contains(node)) return null;
    const direct = node.getAttribute('data-issue-key') || node.getAttribute('data-rbd-draggable-id');
    const link = node.matches(ISSUE_LINK) ? node : node.querySelector(ISSUE_LINK);
    const fromText = () => node.matches(CARD_SEL) && node.textContent.match(/\b[A-Z][A-Z0-9_]*-\d+\b/)?.[0];
    const k = validKey(direct) ? direct : (link && issueKey(link.href)) || fromText();
    return validKey(k) ? { node, key: k } : null;
  }
  function cardNodes(scope = document) {
    const map = new Map();
    const board = scope === document ? document.querySelector('#jira-page-layout-main,main,[role="main"]') || scope : scope;
    for (const n of board.querySelectorAll(`${CARD_SEL},${ISSUE_LINK}`)) {
      if (n.matches(ISSUE_LINK) && !n.closest(ITEM_SEL) && !n.closest(CARD_SEL)) continue;
      const c = cardAt(n);
      if (c && !map.has(c.key)) map.set(c.key, c.node);
    }
    return map;
  }
  function columns() {
    const out = [];
    for (const col of document.querySelectorAll(COL_SEL)) {
      if (out.some((o) => o.el.contains(col) || col.contains(o.el))) continue;
      const head = col.querySelector('h2,h3,[data-testid*="column-header"],[data-testid*="title"]');
      const name = (head?.textContent || col.getAttribute('aria-label') || '').replace(/\d+\s*$/, '').trim();
      out.push({ el: col, head: head || col, name, keys: [...cardNodes(col).keys()] });
    }
    return out;
  }
  const boardProjects = () => [...new Set([...cardNodes().keys()].map((k) => k.split('-')[0]))];
  const isPrCol = (name) => /^(pr|pull request|feito|done|code review|revis)/i.test(name);

  const ICON_OPEN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const ICON_DEPLOY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5V3.5M4 7.5l4-4 4 4M3.5 13h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const cardButtons = new Map();
  function paintCards() {
    const cards = active ? cardNodes() : new Map();
    for (const [node, actions] of cardButtons) {
      if (cards.get(actions.dataset.key) === node && actions.parentNode === node) continue;
      actions.remove();
      node.removeAttribute('data-qf-sel');
      node.removeAttribute('data-qf-dim');
      node.removeAttribute('data-qf-deploy');
      node.removeAttribute('data-qf-card');
      cardButtons.delete(node);
    }
    for (const [k, node] of cards) {
      const listed = deployList.includes(k);
      node.toggleAttribute('data-qf-sel', k === key && view === 'issue');
      node.toggleAttribute('data-qf-dim', view === 'focus' && !!myKeys && !myKeys.has(k));
      node.toggleAttribute('data-qf-deploy', listed);
      node.setAttribute('data-qf-card', '');
      let actions = cardButtons.get(node);
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'qf-card-actions';
        actions.dataset.key = k;
        actions.innerHTML = `<button type="button" class="qf-card-action qf-open" title="Abrir no DashFill">${ICON_OPEN}</button><button type="button" class="qf-card-action qf-dep" data-deploy>${ICON_DEPLOY}</button>`;
        actions.firstElementChild.setAttribute('aria-label', 'Abrir ' + k + ' no DashFill');
        for (const type of ['pointerdown', 'mousedown', 'keydown', 'keyup']) actions.addEventListener(type, e => e.stopPropagation());
        actions.onclick = e => {
          const button = e.target.closest('button');
          if (!button) return;
          e.preventDefault();
          e.stopPropagation();
          const selected = cardAt(node);
          if (dialogOpen || !selected) return;
          if (button.hasAttribute('data-deploy') || e.shiftKey) toggleDeploy(selected.key);
          else openIssue(selected.key);
        };
        node.append(actions);
        cardButtons.set(node, actions);
      }
      const deployButton = actions.lastElementChild;
      const label = listed ? 'Tirar do deploy' : 'Colocar no deploy';
      if (deployButton.title !== label) {
        deployButton.title = label;
        deployButton.setAttribute('aria-label', label + ' · ' + k);
        deployButton.setAttribute('aria-pressed', String(listed));
      }
    }
  }
  document.addEventListener('click', (e) => {
    if (!active || dialogOpen || !e.shiftKey || e.target.closest?.('.qf-card-action')) return;
    const found = cardAt(e.target);
    if (!found || !cardButtons.has(found.node)) return;
    e.preventDefault(); e.stopPropagation();
    toggleDeploy(found.key);
  }, true);

  /* ---------------- Faixa "rodando agora" no card ----------------
   * Embaixo do card da demanda com o cronômetro ligado: o tempo correndo, a data limite e a estimativa
   * (o que já foi apontado, mais o tempo rodando, contra a estimativa original). Se o cronômetro está numa
   * subtarefa, a faixa vai no card da demanda-mãe, com a chave da subtarefa. */
  let runInfo = null, runLoading = '', runStrip = null;
  async function loadRunInfo(k) {
    if (runLoading === k) return;
    runLoading = k;
    try {
      const i = await api(`issue/${k}?fields=duedate,timetracking,parent`);
      const f = i?.fields || {}, tt = f.timetracking || {}, min = (sec) => (Number.isFinite(sec) ? Math.round(sec / 60) : null);
      runInfo = { key: k, parentKey: f.parent?.key || '', due: f.duedate || '', est: min(tt.originalEstimateSeconds) || 0,
        spent: min(tt.timeSpentSeconds) || 0, remaining: min(tt.remainingEstimateSeconds), at: Date.now() };
    } catch { runInfo = { key: k, parentKey: '', due: '', est: 0, spent: 0, remaining: null, at: Date.now(), failed: true }; }
    finally { runLoading = ''; }
    paintRunStrip();
  }
  function runStripHtml(f, info, onParent) {
    const running = Math.max(0, Math.floor((Date.now() - f.start) / 60000));
    const today = new Date(), iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let due = '<span class="qf-run-due">sem data limite</span>';
    if (info?.due) {
      const late = info.due < iso(today), isToday = info.due === iso(today);
      const dm = `${info.due.slice(8, 10)}/${info.due.slice(5, 7)}`;
      due = `<span class="qf-run-due ${late ? 'late' : isToday ? 'today' : ''}" title="Data limite: ${esc(dm)}">${late ? `⚠ venceu ${esc(dm)}` : isToday ? 'vence hoje' : `até ${esc(dm)}`}</span>`;
    }
    let bar = '', tempo = '';
    if (info && !info.failed) {
      const used = info.spent + running;
      if (info.est) {
        const left = (info.remaining ?? Math.max(0, info.est - info.spent)) - running;
        const over = left < 0;
        bar = `<span class="qf-run-bar ${over ? 'over' : ''}" aria-hidden="true"><i style="width:${Math.min(100, Math.round((used / info.est) * 100))}%"></i></span>`;
        tempo = `<span class="qf-run-t"><b>${esc(formatMinutes(used))}</b> de ${esc(formatMinutes(info.est))} estimado · ${over ? `<span class="over">passou ${esc(formatMinutes(-left))}</span>` : `restam ${esc(formatMinutes(left))}`}</span>`;
      } else {
        tempo = `<span class="qf-run-t"><b>${esc(formatMinutes(used))}</b> no total, contando o de agora · sem estimativa</span>`;
      }
    }
    return `<span class="qf-run-rec" aria-hidden="true"></span>${onParent ? `<span class="qf-run-k" data-k="${esc(f.key)}"></span>` : ''}<b class="qf-run-clock" data-since="${f.start}">${esc(clockText(f.start))}</b>${due}${bar}${tempo}`;
  }
  function paintRunStrip(cards) {
    const f = active && !dialogOpen ? focus : null;
    if (!f) { runStrip?.remove(); runStrip = null; return; }
    if (!runLoading && (runInfo?.key !== f.key || Date.now() - runInfo.at > 120000)) loadRunInfo(f.key);
    const info = runInfo?.key === f.key ? runInfo : null;
    cards ||= cardNodes();
    const own = cards.get(f.key), node = own || (info?.parentKey && cards.get(info.parentKey));
    if (!node) { runStrip?.remove(); runStrip = null; return; }
    if (!runStrip) {
      runStrip = document.createElement('div');
      runStrip.className = 'qf-run';
      runStrip.dataset.qfOwned = 'true';
      runStrip.setAttribute('role', 'status');
      runStrip.setAttribute('aria-label', `Cronômetro rodando em ${f.key}`);
      for (const type of ['pointerdown', 'mousedown', 'click']) runStrip.addEventListener(type, (e) => e.stopPropagation());
    }
    if (runStrip.parentNode !== node) node.append(runStrip);
    // Redesenha só quando muda algo além do relógio (que o tick atualiza a cada segundo).
    const sig = [f.key, f.start, info?.at, Math.floor((Date.now() - f.start) / 60000), !own].join('|');
    if (runStrip.dataset.sig !== sig) { runStrip.innerHTML = runStripHtml(f, info, !own); runStrip.dataset.sig = sig; }
  }

  /* Botões sobre as colunas: listar todas as demandas da coluna na barra. */
  function placeColButtons() {
    if (!active || dialogOpen) { colBox.replaceChildren(); return; }
    const cols = columns(), top = dock.hidden ? innerHeight : dock.getBoundingClientRect().top;
    const html = cols.map((c, i) => {
      const r = c.head.getBoundingClientRect();
      if (r.width < 60 || r.bottom < 0 || r.top > top - 20 || r.right < 0 || r.left > innerWidth) return '';
      const pr = isPrCol(c.name);
      return `<button class="colbtn ${pr ? 'pr' : ''} ${colView?.name === c.name && view === 'column' ? 'on' : ''}" data-col="${i}" style="left:${Math.round(r.right - (pr ? 92 : 30))}px;top:${Math.round(r.top + r.height / 2 - 12)}px" title="Listar as ${c.keys.length} demandas de ${esc(c.name)} no DashFill" aria-label="Listar ${esc(c.name)} no DashFill">${pr ? `Listar <b>${c.keys.length}</b>` : '≡'}</button>`;
    }).join('');
    if (colBox.innerHTML !== html) colBox.innerHTML = html;
  }

  function geometry() {
    if (!active) return;
    let rail;
    for (const n of document.querySelectorAll('[data-testid*="side-navigation"],[data-testid*="sidebar"],nav,aside,[role="navigation"]')) {
      if (host.contains(n)) continue;
      const r = n.getBoundingClientRect();
      if (r.left >= -2 && r.left < 65 && r.width >= 100 && r.width <= 400 && r.height > innerHeight * 0.4) { rail = r; break; }
    }
    host.style.setProperty('--rail', (rail?.width || Math.min(200, innerWidth * 0.24)) + 'px');
    host.style.setProperty('--left', (rail?.left || 0) + 'px');
    // Alguns quadros usam uma trilha horizontal independente, fixada no rodapé.
    let clearance = 0;
    const tracks = new Set(document.querySelectorAll('[role="scrollbar"],[data-testid*="scrollbar" i],[data-testid*="horizontal-scroll" i]'));
    // Trilhas nativas sincronizadas podem ser irmãs do quadro sem role ou testid.
    for (let y = innerHeight - 2; y >= innerHeight - 96; y -= 8) {
      for (const el of document.elementsFromPoint(innerWidth * .66, y)) {
        if (el.clientHeight <= 32 && el.scrollWidth > el.clientWidth && /(scroll|auto)/.test(getComputedStyle(el).overflowX)) tracks.add(el);
      }
    }
    for (const track of tracks) {
      if ([...reserved.keys()].some(scroller => scroller.contains(track))) continue;
      const r = track.getBoundingClientRect();
      if (r.height > 0 && r.height <= 32 && r.width > 100 && r.top >= innerHeight - 100 && r.top < innerHeight) {
        clearance = Math.max(clearance, innerHeight - r.top + 2);
      }
    }
    host.style.setProperty('--scroll-clearance', clearance + 'px');
    placeColButtons();
  }
  /* Reserva espaço para a barra: limita a altura das áreas de rolagem do quadro (vertical e horizontal)
   * para que nenhuma barra de rolagem do Jira fique escondida atrás do DashFill. */
  function restoreScroller(node, saved) {
    for (const [prop, limit] of Object.entries(saved)) {
      if (node.style.getPropertyValue(prop) === limit.applied) {
        node.style.setProperty(prop, limit.original, limit.priority);
      }
    }
    reserved.delete(node);
  }
  function releaseBoard() {
    for (const [node, saved] of reserved) restoreScroller(node, saved);
  }
  function reserveBoard() {
    const col = active && !dialogOpen && !dock.hidden && (document.querySelector(COL_SEL) || cardButtons.keys().next().value || document.querySelector(CARD_SEL));
    if (!col) return releaseBoard();
    const ceiling = dock.getBoundingClientRect().top - 4;
    const wanted = new Set();
    // O scroll vertical pode estar dentro do horizontal. Inclui também o próprio main.
    for (let node = col; node && node !== document.documentElement; node = node.parentElement) {
      if (node === document.scrollingElement) break;
      const css = getComputedStyle(node), rect = node.getBoundingClientRect();
      const horizontal = /(auto|scroll|overlay)/.test(css.overflowX) && node.scrollWidth > node.clientWidth;
      const vertical = /(auto|scroll|overlay)/.test(css.overflowY) && rect.width > innerWidth * .45;
      if ((!horizontal && !vertical) || (!reserved.has(node) && rect.bottom <= ceiling)) continue;
      wanted.add(node);
      let saved = reserved.get(node);
      if (!saved) { saved = {}; reserved.set(node, saved); }
      const chromeHeight = css.boxSizing === 'border-box' ? 0 : parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
      const available = Math.max(0, Math.floor(ceiling - rect.top - chromeHeight));
      for (const prop of ['max-height', 'min-height']) {
        const currentValue = node.style.getPropertyValue(prop);
        if (!saved[prop] || currentValue !== saved[prop].applied) {
          saved[prop] = { original: currentValue, priority: node.style.getPropertyPriority(prop), computed: css.getPropertyValue(prop) };
        }
        const initial = saved[prop].computed;
        const value = prop === 'min-height' ? '0px' : initial === 'none' ? available + 'px' : 'min(' + initial + ', ' + available + 'px)';
        if (currentValue !== value) node.style.setProperty(prop, value, 'important');
        saved[prop].applied = node.style.getPropertyValue(prop);
      }
    }
    for (const [node, saved] of reserved) if (!wanted.has(node)) restoreScroller(node, saved);
  }

  /* ================================================================ */
  /* Lateral: Meu dia                                                  */
  /* ================================================================ */
  let doingNow = [], dayData = null, dayMsg = null;
  const dayHead = () => `<div class="d-h"><span class="mark">QF</span><b>Meu dia</b><small>${new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</small><button class="ic sm" data-action="day-refresh" aria-label="Atualizar meu dia" title="Atualizar">↻</button></div>`;
  const hhmm = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  async function refreshDay() {
    if (!active || expandedDay) return;
    const s = ++daySeq;
    refreshedAt = Date.now();
    if (!dayData) day.innerHTML = dayHead() + note('Consultando a meta…');
    try {
      const [rep, doing] = await Promise.all([
        send('DAY_REPORT', { days: 10 }),
        // A categoria "Em andamento" também traz PR, Deploy e Validação: filtra pelo status de desenvolvimento.
        jql('assignee = currentUser() AND statusCategory = "In Progress" ORDER BY updated DESC', ['summary', 'status'], 12, { expand: 'changelog' }).catch(() => []),
      ]);
      if (s !== daySeq || !active || expandedDay) return;
      doingNow = doing.filter((i) => isDoingStatus(i.fields?.status?.name, i.fields?.status?.statusCategory?.key))
        .map((i) => ({ key: i.key, summary: i.fields?.summary || '', status: i.fields?.status?.name || '', enteredAt: enteredStatusAt(i.changelog?.histories) }))
        .sort((a, b) => (b.enteredAt || 0) - (a.enteredAt || 0));
      dayData = { rep };
      await followDoing();
      paintDay();
    } catch (e) {
      if (s === daySeq && active && !expandedDay) day.innerHTML = dayHead() + note(e.message);
    }
  }
  /* O cronômetro acompanha o quadro: começa sozinho quando uma demanda sua entra em andamento
   * e, se a demanda que está rodando sair de andamento, para e aponta até aquele momento. */
  async function followDoing() {
    focus = storedFocus();
    if (focus?.doing && !doingNow.some((d) => d.key === focus.key)) {
      const t = focus;
      const iss = await api(`issue/${t.key}?fields=status&expand=changelog`).catch(() => null);
      const f = iss?.fields;
      if (f && !isDoingStatus(f.status?.name, f.status?.statusCategory?.key)) {
        const leftAt = enteredStatusAt(iss.changelog?.histories);
        await pauseTimer({ end: leftAt > t.start ? Math.min(leftAt, Date.now()) : Date.now(), why: `Foi para ${f.status?.name || 'outro status'}` });
      }
    }
    const cand = autoStartCandidate(doingNow, storedFocus(), skip);
    if (cand) {
      focus = { ...cand, doing: true };
      saveFocus();
      showMsg(`Cronômetro iniciado: ${cand.key} entrou em andamento às ${hhmm(cand.start)}.`);
      if (view === 'focus') renderFocus();
      drawBar();
    }
  }
  function timerCard() {
    if (!focus) return '';
    return `<div class="tmr" role="group" aria-label="Cronômetro de ${esc(focus.key)}">
      <div class="tmr-h"><i class="rec" aria-hidden="true"></i><small>${focus.auto ? 'Começou sozinho' : 'Em foco'} · desde ${esc(hhmm(focus.start))}</small></div>
      <button class="lnk tmr-k" data-key="${esc(focus.key)}" title="Abrir ${esc(focus.key)} na barra"><span class="k">${esc(focus.key)}</span><span class="tmr-t">${esc(focus.title || '')}</span></button>
      <b class="clock" data-since="${focus.start}" aria-live="off">${esc(clockText(focus.start))}</b>
      <div class="tmr-a"><button class="btn sm pri" data-pause title="Para o cronômetro e aponta no Jira o tempo até agora">⏸ Pausar e apontar</button><button class="ic sm" data-discard title="Descartar sem apontar" aria-label="Descartar o cronômetro sem apontar">✕</button></div>
    </div>`;
  }
  function paintDay() {
    paintSide();
    if (!active || expandedDay || !dayData) return;
    const rep = dayData.rep;
    const m = timelineMetrics(rep), done = m.total >= m.goal, wd = rep.workday, width = wd.end - wd.start;
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    const seg = (rep.entries || []).map((e) => {
      const a = Math.max(wd.start, e.start), b = Math.min(wd.end, e.end);
      if (b <= a || width <= 0) return '';
      return `<i class="${e.key === focus?.key ? 'cur' : ''}" style="left:${(100 * (a - wd.start)) / width}%;width:${(100 * (b - a)) / width}%" title="${esc(e.key)} · ${formatHM(e.start)}–${formatHM(e.end)}"></i>`;
    }).join('');
    const nowPct = nowMin > wd.start && nowMin < wd.end ? (100 * (nowMin - wd.start)) / width : -1;
    const pct = Math.min(100, Math.round(m.percent));
    const rows = doingNow.slice(0, 4).map((d) => {
      const on = focus?.key === d.key;
      return `<div class="now-r ${on ? 'on' : ''}"><button class="now" data-key="${esc(d.key)}" title="${esc(d.key)} · ${esc(d.summary)}"><span class="k">${esc(d.key)}</span><span class="t">${esc(d.summary)}</span></button>${on
        ? `<button class="play on" data-pause aria-label="Pausar e apontar ${esc(d.key)}" title="Pausar e apontar">⏸</button>`
        : `<button class="play" data-play="${esc(d.key)}" data-title="${esc(d.summary)}" data-doing="1" aria-label="Iniciar o cronômetro em ${esc(d.key)}" title="${focus ? `Pausa ${esc(focus.key)} (aponta) e começa aqui` : 'Iniciar o cronômetro'}">▶</button>`}</div>`;
    }).join('');
    day.innerHTML = dayHead() + `
      <div class="goal">
        <span class="df-ring" style="--p:${pct}" role="img" aria-label="${esc(formatMinutes(m.total))} apontadas de ${esc(formatMinutes(m.goal))}"><span class="ring-v"><b>${esc(formatMinutes(m.total))}</b><small>${pct}%</small></span></span>
        <div class="goal-t"><b class="${done ? 'met' : ''}">${done ? 'Meta batida' : 'Faltam ' + esc(formatMinutes(m.goal - m.total))}</b><small>meta de ${esc(formatMinutes(m.goal))}</small></div>
      </div>
      <div class="tl" aria-label="Linha do tempo de hoje">${seg}${nowPct >= 0 ? `<em style="left:${nowPct}%"></em>` : ''}</div>
      <div class="tl-h"><span>${formatHM(wd.start)}</span><span>${formatHM(wd.end)}</span></div>
      ${timerCard()}
      ${dayMsg ? `<div class="d-msg ${dayMsg.cls || ''}" role="status"><span>${esc(dayMsg.text)}</span>${dayMsg.undo ? '<button class="lnk" data-undo>Desfazer</button>' : ''}</div>` : ''}
      ${rows ? `<div class="sub">Em andamento</div>${rows}` : '<div class="sub">Nada em andamento no seu nome</div>'}
      <div class="quick">
        <button data-mode="focus">Foco</button>
        <button data-mode="deploy" class="dq">Deploy <b>${deployList.length}</b></button>
      </div>
      <button class="lnk" data-action="day" aria-expanded="false">Abrir meu dia completo ›</button>`;
  }
  let msgTimer = 0;
  function showMsg(text, cls = '', undo = false) {
    dayMsg = { text, cls, undo };
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { dayMsg = null; lastLog = undo ? null : lastLog; paintDay(); paintSide(); }, undo ? 30000 : 12000);
    paintDay(); paintSide();
  }
  async function setDay(open) {
    expandedDay = open; daySeq++;
    day.classList.toggle('expanded', open);
    if (!open) { refreshDay(); return; }
    day.innerHTML = '<button class="lnk" data-action="day" aria-expanded="true">‹ Voltar para a lateral</button>';
    const frame = document.createElement('iframe');
    frame.title = 'QuickFill DEV · Hoje';
    frame.src = url('modal.html?dashfill=day&tab=today');
    day.append(frame);
  }
  window.addEventListener('message', (e) => {
    if (expandedDay && e.source === day.querySelector('iframe')?.contentWindow && e.origin === new URL(url('')).origin && e.data?.type === 'DASHFILL_COLLAPSE') setDay(false);
  });

  /* ================================================================ */
  /* Painel ao lado do modal da demanda: Meu dia da demanda e das subtarefas */
  /* ================================================================ */
  const SIDE_OPEN = 'qf.dev.dashfill.side.open';
  const side = { key: '', data: null, at: 0, seq: 0, loading: false, error: '', expanded: false };
  try { side.expanded = localStorage.getItem(SIDE_OPEN) === '1'; } catch { /* sem storage */ }
  /* O modal da demanda do Jira: o maior diálogo visível (ignora menus e confirmações pequenas). */
  function issueDialog() {
    let best = null, area = 0;
    for (const el of document.querySelectorAll('[role="dialog"],[aria-modal="true"]')) {
      if (host.contains(el) || el.closest('[hidden],[aria-hidden="true"]') || !el.checkVisibility?.({ visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 420 || r.height < 300) continue;
      if (r.width * r.height > area) { area = r.width * r.height; best = el; }
    }
    return best;
  }
  /* Qual demanda está aberta: ?selectedIssue= no quadro, ou a chave no topo do modal. */
  function dialogKey(dlg) {
    const q = new URLSearchParams(location.search);
    const fromUrl = q.get('selectedIssue') || q.get('selectedIssueKey');
    if (validKey(fromUrl)) return fromUrl;
    const m = location.pathname.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)/);
    if (m) return m[1];
    for (const a of dlg.querySelectorAll(ISSUE_LINK)) {
      const k = issueKey(a.href);
      if (validKey(k) && a.textContent.trim() === k) return k;
    }
    return '';
  }
  async function loadSide(k) {
    const s = ++side.seq;
    side.loading = true; side.error = '';
    try {
      const iss = await api(`issue/${k}?fields=summary,status,parent,issuetype,timetracking`);
      const f = iss.fields || {};
      const parentKey = f.issuetype?.subtask ? f.parent?.key : '';
      // Demanda: as subtarefas dela. Subtarefa: as irmãs (subtarefas da mesma demanda).
      const subs = await jql(`parent = ${parentKey || k} ORDER BY created ASC`, ['summary', 'status', 'timetracking', 'assignee'], 40).catch(() => []);
      if (s !== side.seq) return;
      const item = (key, ff = {}) => ({ key, summary: ff.summary || '', status: ff.status?.name || '', cat: ff.status?.statusCategory?.key || '',
        spent: Math.round((ff.timetracking?.timeSpentSeconds || 0) / 60), who: ff.assignee?.displayName || '' });
      side.data = { main: item(k, f), parent: parentKey ? { key: parentKey, summary: f.parent?.fields?.summary || '' } : null,
        subs: subs.map((i) => item(i.key, i.fields)).filter((i) => i.key !== k) };
      side.at = Date.now();
    } catch (e) { if (s === side.seq) side.error = e.message; }
    finally { if (s === side.seq) { side.loading = false; paintSide(); } }
  }
  /* Minutos apontados hoje por demanda, pela linha do tempo do Meu dia. */
  function todayByKey() {
    const out = {};
    for (const e of dayData?.rep?.entries || []) out[e.key] = (out[e.key] || 0) + Math.max(0, (e.end || 0) - (e.start || 0));
    return out;
  }
  function sideRow(it, today, main = false) {
    const on = focus?.key === it.key;
    const doing = isDoingStatus(it.status, it.cat);
    const t = today[it.key] || 0;
    return `<div class="ms-it ${main ? 'main' : ''} ${on ? 'on' : ''}">
      <div class="ms-top"><span class="k">${esc(it.key)}</span><span class="pill ${statusTone(it.cat, it.status)}">${esc(it.status || '—')}</span></div>
      <span class="ms-t" title="${esc(it.summary)}">${esc(it.summary)}</span>
      <div class="ms-ft">${on
        ? `<b class="clock" data-since="${focus.start}">${esc(clockText(focus.start))}</b><button class="play on" data-pause aria-label="Pausar e apontar ${esc(it.key)}" title="Pausar e apontar">⏸</button>`
        : `<small class="muted">${t ? `hoje ${esc(formatMinutes(t))}` : 'nada hoje'}${side.expanded && it.spent ? ` · total ${esc(formatMinutes(it.spent))}` : ''}</small><button class="play" data-play="${esc(it.key)}" data-title="${esc(it.summary)}" data-doing="${doing ? '1' : ''}" aria-label="Iniciar o cronômetro em ${esc(it.key)}" title="${focus ? `Pausa ${esc(focus.key)} (aponta) e começa aqui` : 'Iniciar o cronômetro'}">▶</button>`}</div>
    </div>`;
  }
  function paintSide() {
    if (sideEl.hidden && !side.key) return;
    const d = side.data, today = todayByKey();
    const narrow = sideEl.classList.contains('tab');
    if (narrow) {
      sideEl.innerHTML = `<button class="ms-tab" data-action="ms-toggle" aria-expanded="false" title="Abrir o Meu dia desta demanda"><span class="mark">QF</span>${focus ? `<b class="clock" data-since="${focus.start}">${esc(clockText(focus.start))}</b>` : '<span>⏱</span>'}</button>`;
      return;
    }
    const goal = dayData ? timelineMetrics(dayData.rep) : null;
    const pct = goal ? Math.min(100, Math.round(goal.percent)) : 0;
    const otherRunning = focus && d && focus.key !== d.main.key && !d.subs.some((x) => x.key === focus.key);
    sideEl.innerHTML = `<div class="ms-h"><span class="mark">QF</span><b>Meu dia</b>
        <button class="ic sm" data-action="ms-refresh" title="Atualizar" aria-label="Atualizar">↻</button>
        <button class="ic sm" data-action="ms-toggle" aria-expanded="${side.expanded}" title="${side.expanded ? 'Recolher' : 'Expandir'}" aria-label="${side.expanded ? 'Recolher o painel' : 'Expandir o painel'}">${side.expanded ? '⇤' : '⇥'}</button></div>
      ${goal ? `<div class="ms-goal" title="${esc(formatMinutes(goal.total))} apontadas de ${esc(formatMinutes(goal.goal))}"><div class="ms-bar"><i style="width:${pct}%"></i></div><small>${esc(formatMinutes(goal.total))} de ${esc(formatMinutes(goal.goal))} hoje</small></div>` : ''}
      ${otherRunning ? `<div class="ms-other"><small>Rodando em <b>${esc(focus.key)}</b></small><b class="clock" data-since="${focus.start}">${esc(clockText(focus.start))}</b><button class="play on" data-pause aria-label="Pausar e apontar ${esc(focus.key)}" title="Pausar e apontar">⏸</button></div>` : ''}
      ${dayMsg ? `<div class="d-msg ${dayMsg.cls || ''}" role="status"><span>${esc(dayMsg.text)}</span>${dayMsg.undo ? '<button class="lnk" data-undo>Desfazer</button>' : ''}</div>` : ''}
      ${!d ? (side.error ? note(side.error, 'err') : '<div class="skel"><i></i><i></i></div>') : `
        ${d.parent ? `<small class="muted ms-par">Subtarefa de <b>${esc(d.parent.key)}</b></small>` : ''}
        ${sideRow(d.main, today, true)}
        ${focus?.key === d.main.key ? '<button class="lnk ms-disc" data-discard>Descartar sem apontar</button>' : ''}
        ${d.subs.length ? `<div class="sub">${d.parent ? 'Outras subtarefas' : 'Subtarefas'} <span class="muted">${d.subs.length}</span></div>
          <div class="ms-subs">${d.subs.map((x) => sideRow(x, today)).join('')}</div>` : ''}
        ${side.expanded ? `<div class="ms-acts">
          <button class="btn sm" data-toggle-deploy="${esc(d.main.key)}">${deployList.includes(d.main.key) ? '✓ Na lista do deploy' : '⇪ Colocar no deploy'}</button>
          <button class="btn sm" data-copy="${esc(d.main.key)} — ${esc(d.main.summary)}">Copiar chave e título</button>
          <a class="btn sm" href="/browse/${esc(d.main.key)}" target="_blank" rel="noopener">Abrir em nova aba ↗</a></div>` : ''}`}`;
  }
  function updateSide() {
    const dlg = active && dialogOpen ? issueDialog() : null;
    const k = dlg ? dialogKey(dlg) : '';
    if (!k) {
      if (!sideEl.hidden) { sideEl.hidden = true; sideEl.replaceChildren(); }
      side.key = ''; side.data = null; side.seq++;
      return;
    }
    const r = dlg.getBoundingClientRect(), space = r.left;
    const fits = space >= 132;
    const narrow = !fits && !side.expanded;
    // Recolhido: cabe no vazio à esquerda do modal. Expandido: mais largo, pode passar por cima da borda do modal.
    const width = narrow ? 0 : side.expanded ? Math.min(360, Math.max(300, space - 20)) : Math.min(260, space - 16);
    sideEl.classList.toggle('tab', narrow);
    sideEl.classList.toggle('wide', side.expanded);
    const css = `top:${Math.round(Math.max(r.top, 8))}px;max-height:${Math.round(Math.min(r.height, innerHeight - 16))}px;${narrow ? '' : `width:${Math.round(width)}px;`}`;
    if (sideEl.style.cssText !== css) sideEl.style.cssText = css;
    const changed = k !== side.key, wasHidden = sideEl.hidden;
    sideEl.hidden = false;
    if (changed) { side.key = k; side.data = null; paintSide(); loadSide(k); }
    else if (wasHidden || sideEl.dataset.mode !== String(narrow)) paintSide();
    else if (!side.loading && Date.now() - side.at > 60000) loadSide(k);
    sideEl.dataset.mode = String(narrow);
  }
  // O modal do Jira fecha com clique "fora" dele: os cliques no painel não podem chegar ao Jira.
  // Para no host (depois do handler do shadow, que já tratou o clique).
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'keydown']) host.addEventListener(type, (e) => { if (dialogOpen) e.stopPropagation(); });

  /* ================================================================ */
  /* Barra de baixo                                                    */
  /* ================================================================ */
  function drawBar() {
    const fold = $('[data-action=fold]');
    fold.querySelector('b').textContent = folded ? 'Abrir painel' : 'Recolher';
    sizesEl.hidden = folded;
    fold.setAttribute('aria-expanded', String(!folded));
    body.hidden = folded;
    dock.classList.toggle('open', !folded);
    dock.dataset.view = view;
    modesEl.innerHTML = MODES.map(([id, label, tip]) => `<button class="mode ${view === id || (id === 'issue' && view === 'column') ? 'on' : ''}" data-mode="${id}" title="${esc(tip)}" aria-pressed="${view === id || (id === 'issue' && view === 'column')}">${label}${id === 'deploy' ? ` <b>${deployList.length}</b>` : id === 'focus' && focus ? ' <i class="dot"></i>' : ''}</button>`).join('');
    sizesEl.innerHTML = [['s', 'Baixa'], ['m', 'Média'], ['l', 'Alta']].map(([id, l]) => `<button class="sz ${size === id ? 'on' : ''}" data-size="${id}" title="Altura ${l.toLowerCase()}" aria-label="Altura ${l.toLowerCase()}" aria-pressed="${size === id}"><i class="${id}"></i></button>`).join('');
    const dq = day.querySelector('.dq b');
    if (dq) dq.textContent = deployList.length;
    if (view === 'issue') {
      whoEl.innerHTML = key
        ? `<span class="k">${esc(key)}</span>${current ? `<span class="pill ${statusTone(current.cat, current.status)}">${esc(current.status)}</span><b class="ttl" title="${esc(current.summary)}">${esc(current.summary)}</b>` : '<span class="hint">carregando…</span>'}`
        : '<span class="hint">Passe o mouse em um card do quadro e clique em <b>+</b>.</span>';
      tabsEl.hidden = !key || folded;
      tabsEl.innerHTML = TABS.map(([id, l]) => {
        const n = !current ? '' : id === 'envs' ? current.envs.length : id === 'git' ? current.branches.length + current.sql.length + current.dev.prs.length : id === 'docs' ? current.links.figma.length + current.links.confluence.length + current.links.other.length + (current.f.issuelinks || []).length : id === 'comments' ? current.comments : '';
        return `<button class="tab ${id === tab ? 'on' : ''}" data-tab="${id}" aria-pressed="${id === tab}">${l}${n !== '' ? ` <i class="n">${n}</i>` : ''}</button>`;
      }).join('');
    } else {
      tabsEl.hidden = true;
      const label = view === 'column' ? `Coluna ${esc(colView?.name || '')}` : MODES.find((m) => m[0] === view)?.[1];
      const tip = view === 'column' ? `${colView?.keys.length || 0} demandas` : MODES.find((m) => m[0] === view)?.[2];
      whoEl.innerHTML = `<b class="ttl">${label}</b><span class="hint">${esc(tip || '')}</span>`;
    }
    $('[data-action=refresh]').hidden = view === 'issue' && !key;
    requestAnimationFrame(() => { reserveBoard(); placeColButtons(); });
  }

  function setView(v) {
    view = v; confirmBox = null; folded = false;
    drawBar(); render(); paintCards();
  }
  async function openIssue(k, force = false, nextTab) {
    if (!validKey(k)) return;
    if (k !== key || nextTab) { tab = nextTab || 'resumo'; body.scrollTop = 0; }
    key = k; view = 'issue'; folded = false; confirmBox = null;
    current = !force && cache.has(k) ? cache.get(k).data : null;
    drawBar(); paintCards();
    const s = ++seq;
    if (!current) body.innerHTML = skeleton();
    try {
      const result = await issueData(k, force);
      if (s !== seq || view !== 'issue') return;
      current = result;
      drawBar(); render();
    } catch (e) { if (s === seq) body.innerHTML = note(e.message + ' Use ↻ para tentar de novo.', 'err'); }
  }
  const skeleton = () => '<div class="skel"><i></i><i></i><i></i></div>';

  function render() {
    if (folded) return;
    if (view === 'issue') return renderIssue();
    if (view === 'column') return renderColumn();
    if (view === 'focus') return renderFocus();
    if (view === 'deploy') return renderDeploy();
  }

  /* ---------------- Demanda ---------------- */
  function renderIssue() {
    if (!key) {
      body.innerHTML = `<div class="empty"><b>Escolha uma demanda no quadro</b><p>Passe o mouse no card e clique em <b>+</b> para ler a descrição, consultar branches e ver os comentários.</p></div>`;
      return;
    }
    if (!current) return;
    const d = current, f = d.f;
    if (tab === 'resumo') {
      const t = timeOf(f.timetracking), r = readiness(d);
      const due = f.duedate ? new Date(f.duedate + 'T12:00') : null, late = due && due < new Date() && d.cat !== 'done';
      const comment = (f.comment?.comments || []).at(-1);
      body.innerHTML = `<div class="summary-tools">
        ${focus?.key === d.key
          ? '<button class="btn pri" data-pause title="Para o cronômetro e aponta o tempo até agora">⏸ Pausar e apontar</button>'
          : `<button class="btn pri" data-play="${esc(d.key)}" data-title="${esc(d.summary)}" data-doing="${isDoingStatus(d.status, d.cat) ? '1' : ''}">▶ Iniciar cronômetro</button>`}
        <button class="btn" data-toggle-deploy="${esc(d.key)}">${deployList.includes(d.key) ? 'Retirar do deploy' : 'Adicionar ao deploy'}</button>
        <a class="btn" href="/browse/${esc(d.key)}" target="_blank" rel="noopener">Abrir no Jira ↗</a>
        <button class="btn" data-copy="${esc(d.key)} — ${esc(d.summary)}">Copiar chave e título</button>
      </div><div class="sum">
        <section class="s-main">
          <h3>Descrição da demanda</h3><div class="chips">
            ${f.issuetype?.name ? `<span class="chip">${esc(f.issuetype.name)}</span>` : ''}
            ${f.priority?.name ? `<span class="chip pr-${esc(f.priority.name.toLowerCase())}">Prioridade ${esc(f.priority.name)}</span>` : ''}
            ${(f.labels || []).slice(0, 4).map((l) => `<span class="chip">${esc(l)}</span>`).join('')}
            ${f.parent ? `<span class="chip">Pai: ${esc(f.parent.key)}</span>` : ''}
          </div>
          <div class="rich desc">${f.description ? adf(f.description) : '<p class="muted">Sem descrição.</p>'}</div>
        </section>
        <aside class="s-side">
          <section class="summary-comments">
            <div class="section-head"><h3>Comentários <span>${d.comments}</span></h3><button class="btn sm" data-tab="comments">${d.comments ? 'Ver comentários' : 'Comentar'}</button></div>
            ${comment ? `<b>${esc(comment.author?.displayName || 'Comentário')}</b><p>${esc(plain(comment.body))}</p>` : note(d.comments ? 'Consulte os comentários da demanda.' : 'Ainda não há comentários.')}
          </section>
          <div class="facts">
            <div class="fact">${avatar(f.assignee?.displayName || 'Sem responsável')}<span><small>Responsável</small><b>${esc(f.assignee?.displayName || 'Sem responsável')}</b></span></div>
            <div class="fact"><span class="fi ${late ? 'bad' : ''}">◷</span><span><small>Data limite</small><b class="${late ? 'bad-t' : ''}">${due ? esc(due.toLocaleDateString('pt-BR')) + (late ? ' · atrasada' : '') : 'sem data'}</b></span></div>
            <div class="fact"><span class="fi">↻</span><span><small>Atualizada</small><b>${esc(ago(f.updated))}</b></span></div>
          </div>
          <div class="tt"><div class="row"><small>Controle de tempo</small><b>${esc(t.txt)}</b><span class="muted">de ${esc(t.estTxt)}</span></div><div class="meter ${t.over ? 'over' : ''}"><i style="width:${t.pct}%"></i></div></div>
          <div class="section-head"><span class="pill ${r.tone}">${esc(r.txt)}</span><button class="btn sm" data-tab="git">Ver branches e SQL</button></div>
        </aside>
      </div>`;
      return;
    }
    if (tab === 'git') { body.innerHTML = developmentHtml(d); return; }
    if (tab === 'envs') {
      body.innerHTML = `<div class="development">${commandSection(d.envs, true)}${originalFields(d)}</div>`;
      return;
    }
    if (tab === 'docs') {
      const L = d.links;
      const tile = (l, kind) => { const u = safeUrl(l.url); return u ? `<a class="doc ${kind}" href="${esc(u)}" target="_blank" rel="noopener"><span class="doc-ic">${kind === 'figma' ? 'F' : kind === 'conf' ? 'C' : '↗'}</span><span class="doc-t">${esc(l.title || u)}</span><small>${esc(new URL(u).hostname)}</small></a>` : ''; };
      const linked = (f.issuelinks || []).map((l) => { const o = l.outwardIssue || l.inwardIssue; if (!o) return ''; const st = o.fields?.status; return `<button class="lk" data-key="${esc(o.key)}"><span class="k">${esc(o.key)}</span><span class="lk-t">${esc(o.fields?.summary || '')}</span><span class="muted">${esc(l.outwardIssue ? l.type?.outward : l.type?.inward)}</span><span class="pill ${statusTone(st?.statusCategory?.key, st?.name)}">${esc(st?.name || '')}</span></button>`; }).join('');
      const any = L.figma.length + L.confluence.length + L.other.length;
      body.innerHTML = `<div class="cols2">
        <section><h3>Figma e documentos <span class="muted">${any}</span></h3>${any ? `<div class="docs">${L.figma.map((l) => tile(l, 'figma')).join('')}${L.confluence.map((l) => tile(l, 'conf')).join('')}${L.other.map((l) => tile(l, 'oth')).join('')}</div>` : '<div class="empty sm"><p>Nenhum Figma, Confluence ou link na demanda.</p></div>'}</section>
        <section><h3>Demandas ligadas <span class="muted">${(f.issuelinks || []).length}</span></h3>${linked ? `<div class="lks">${linked}</div>` : '<div class="empty sm"><p>Nenhuma demanda ligada.</p></div>'}</section>
      </div>`;
      return;
    }
    if (tab === 'comments') return renderComments(d);
    if (tab === 'history') {
      const s = seq;
      body.innerHTML = skeleton();
      send('ISSUE_HISTORY', { key: d.key }).then((data) => {
        if (s !== seq || tab !== 'history' || view !== 'issue') return;
        // O histórico usa o CSS do QuickFill: fica num shadow próprio para não misturar com o do DashFill.
        body.innerHTML = '<div class="hist-host"></div>';
        const sh = body.firstChild.attachShadow({ mode: 'open' });
        sh.innerHTML = `<link rel="stylesheet" href="${url('modal.css')}"><style>:host{display:block;color:#e3e8ee;font:13px/1.45 -apple-system,'Segoe UI',sans-serif}.hist-dlg{max-width:none;max-height:none;box-shadow:none;background:transparent;border:0}.hist-body{max-height:none;overflow:visible}</style><div class="hist-dlg"></div>`;
        loadAccent('dev', body.firstChild);
        renderHistory(sh.querySelector('.hist-dlg'), data, { key: d.key, base: location.origin, openIssue: () => window.open('/browse/' + d.key, '_blank', 'noopener'), onClose: () => { folded = true; drawBar(); } });
      }).catch((e) => { if (s === seq && view === 'issue' && tab === 'history') body.innerHTML = note(e.message, 'err'); });
    }
  }

  function commandSection(entries, env) {
    const noun = env ? 'ENV' : 'SQL', title = env ? 'Variáveis de ambiente' : 'Comandos SQL';
    const all = entries.map(entry => entry.command).join(env ? '\n' : '\n\n');
    const rows = entries.map(({ section, command }, i) => {
      const heading = section && section !== entries[i - 1]?.section ? `<li class="env-group">${esc(section)}</li>` : '';
      return heading + `<li class="sql-row"><pre>${esc(command)}</pre><button class="btn sm" data-copy="${esc(command)}">Copiar ${noun}</button></li>`;
    }).join('');
    return `<div class="section-head"><h3>${title} <span>${entries.length}</span></h3>${entries.length > 1 ? `<button class="btn sm" data-copy="${esc(all)}">${env ? 'Copiar todas as ENVs' : 'Copiar todo o SQL'}</button>` : ''}</div>
      ${rows ? `<ul class="ref-list">${rows}</ul>` : note(env ? 'Nenhuma ENV identificada nesta demanda.' : 'Nenhum comando SQL identificado nesta demanda.')}`;
  }

  function originalFields(d) {
    const fields = d.sources.map(({ name, value, text }) =>
      `<section class="source-field"><h4>${esc(name)}</h4>${value?.type === 'doc' ? `<div class="rich">${adf(value)}</div>` : `<pre>${esc(text)}</pre>`}</section>`).join('');
    const warning = d.fieldsUnavailable ? note('Não foi possível carregar os campos de desenvolvimento. Use Atualizar para tentar novamente.', 'err') : '';
    return `${warning}<details class="source-fields"><summary>Ver texto original da demanda <span class="k">${esc(d.key)}</span></summary>${fields || note('Nenhum campo de desenvolvimento ou descrição preenchido.')}</details>`;
  }

  function developmentHtml(d, deploy = false) {
    const prs = d.dev.prs.map((p) => {
      const ok = p.reviewers.filter((x) => x.ok).length;
      return `<article class="g-card pr-card ${p.state.toLowerCase()}">
        <div class="row"><span class="pill ${prTone(p.state)}">${esc(prLabel(p.state))}</span><a class="g-t" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a><span class="muted">${esc(p.id)}</span></div>
        <div class="flow"><code>${esc(p.from)}</code><span class="arr">→</span><code>${esc(p.to)}</code></div>
        <div class="row gap muted">${esc(p.repo)}${p.at ? ' · atualizado ' + esc(ago(p.at)) : ''}<span class="grow"></span>${p.reviewers.length ? `<span class="revs">${p.reviewers.map((x) => `<span class="rev ${x.ok ? 'ok' : ''}" title="${esc(x.name)}${x.ok ? ' aprovou' : ' ainda não aprovou'}">${esc(initials(x.name))}</span>`).join('')}</span><span>${ok}/${p.reviewers.length} aprovações</span>` : '<span>sem revisores</span>'}</div>
      </article>`;
    }).join('');
    const branchText = d.branches.map(b => {
      const { checkout, merge } = branchCommands(b.name);
      return [b.repo ? b.repo + ' · ' + b.name : b.name, checkout, merge].join('\n');
    });
    const all = [...branchText, ...d.sql, ...(deploy ? d.envs.map(e => e.command) : [])].join('\n\n');
    const brs = d.branches.map(b => {
      const { checkout, merge } = branchCommands(b.name);
      return `<li class="branch-row"><div class="ref-name">${b.repo ? `<small>${esc(b.repo)}</small>` : ''}<code>${esc(b.name)}</code></div>
        <div class="row gap"><button class="btn sm" data-copy="${esc(b.name)}">Copiar nome</button><button class="btn sm" data-copy="${esc(checkout)}" title="${esc(checkout)}">Copiar checkout</button><button class="btn sm" data-copy="${esc(merge)}" title="${esc(merge)}">Copiar merge</button></div></li>`;
    }).join('');
    return `<div class="development">
      <div class="section-head"><h3>Branches <span>${d.branches.length}</span></h3>${all ? `<button class="btn pri" data-copy="${esc(all)}" title="Copiar os comandos e nomes desta demanda">Copiar tudo</button>` : ''}</div>
      ${brs ? `<ul class="ref-list">${brs}</ul>` : note('Nenhuma branch vinculada.')}
      ${!deploy || d.sql.length ? commandSection(d.sql.map(command => ({ command })), false) : ''}
      ${deploy && d.envs.length ? commandSection(d.envs, true) : ''}
      ${!deploy || prs ? `<div class="section-head"><h3>Pull requests <span>${d.dev.prs.length}</span></h3></div>
      ${prs || note('Nenhum pull request vinculado.')}` : ''}
      ${d.dev.builds ? note(d.dev.builds + ' build(s) no painel Desenvolvimento.') : ''}${d.dev.error ? note('Painel Desenvolvimento indisponível: ' + d.dev.error) : ''}
      ${originalFields(d)}
    </div>`;
  }

  async function renderComments(d) {
    const s = seq;
    body.innerHTML = skeleton();
    try {
      const r = await api(`issue/${d.key}/comment?maxResults=40&orderBy=-created&expand=renderedBody`);
      if (s !== seq || tab !== 'comments' || view !== 'issue') return;
      const list = (r.comments || []).map((c) => `<article class="cm">${avatar(c.author?.displayName || '')}<div class="cm-b"><div class="row"><b>${esc(c.author?.displayName)}</b><small class="muted" title="${esc(new Date(c.created).toLocaleString('pt-BR'))}">${esc(ago(c.created))}</small>${c.updated !== c.created ? '<small class="muted">· editado</small>' : ''}</div><div class="rich">${adf(c.body)}</div></div></article>`).join('');
      body.innerHTML = `<div class="cm-grid">
        <section class="cms">${list || '<div class="empty sm"><p>Ainda não há comentários.</p></div>'}</section>
        <form class="cmf" aria-label="Novo comentário">
          <b>Comentar em ${esc(d.key)}</b>
          <div class="tb" role="toolbar" aria-label="Formatação">
            <button type="button" data-fmt="bold" title="Negrito (Ctrl+B)"><b>B</b></button>
            <button type="button" data-fmt="italic" title="Itálico (Ctrl+I)"><i>I</i></button>
            <button type="button" data-fmt="underline" title="Sublinhado (Ctrl+U)"><u>U</u></button>
            <button type="button" data-fmt="strikeThrough" title="Riscado"><s>S</s></button>
            <span class="sep"></span>
            <button type="button" data-fmt="h2" title="Título">T</button>
            <button type="button" data-fmt="h3" title="Subtítulo">t</button>
            <button type="button" data-fmt="insertUnorderedList" title="Lista">•</button>
            <button type="button" data-fmt="insertOrderedList" title="Lista numerada">1.</button>
            <button type="button" data-fmt="quote" title="Citação">❝</button>
            <button type="button" data-fmt="code" title="Código">&lt;/&gt;</button>
            <button type="button" data-fmt="link" title="Link">Link</button>
          </div>
          <div class="editor rich" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Comentário" data-ph="Escreva como no Jira: negrito, títulos, listas, código…"></div>
          <div class="row gap"><button class="btn sm pri" ${posting.has(d.key) ? 'disabled' : ''}>Publicar no Jira</button><span class="muted small">Sai formatado no Jira, como aparece aqui.</span><span class="feedback" role="status"></span></div>
        </form>
      </div>`;
      const ed = body.querySelector('.editor');
      ed.innerHTML = drafts.get(d.key) || '';
    } catch (e) { if (s === seq && view === 'issue' && tab === 'comments') body.innerHTML = note(e.message + ' Use ↻ para tentar de novo.', 'err'); }
  }

  /* ---------------- Coluna ---------------- */
  async function openColumn(c) {
    colView = { name: c.name, keys: c.keys };
    setView('column');
  }
  async function renderColumn() {
    const s = ++seq, cv = colView;
    if (!cv?.keys.length) { body.innerHTML = `<div class="empty"><b>Coluna ${esc(cv?.name || '')} vazia</b></div>`; return; }
    body.innerHTML = skeleton();
    const rows = await mapLimit(cv.keys.slice(0, 40), 4, (k) => issueData(k));
    if (s !== seq || view !== 'column') return;
    const ok = rows.filter((r) => !r.error);
    const warn = ok.filter((r) => readiness(r).tone === 'warn').length;
    body.innerHTML = `<div class="list-h"><b>${cv.keys.length} ${cv.keys.length === 1 ? 'demanda' : 'demandas'} em ${esc(cv.name)}</b><span class="muted">${warn ? `<span class="warn-t">${warn} pedem atenção</span>` : 'todas com branch e PR em ordem'}</span><span class="grow"></span>
      <button class="btn sm" data-copy="${esc(ok.map((r) => r.branches[0]?.name).filter(Boolean).join('\n'))}">Copiar branches</button>
      <button class="btn sm pri" data-action="col-to-deploy">Tudo para o Deploy</button></div>
      <div class="rows">${rows.map((r) => r.error ? `<div class="rw err"><span class="k">${esc(r.key)}</span><span class="err-t">${esc(r.error)}</span></div>` : rowHtml(r)).join('')}</div>`;
  }
  function rowHtml(r, extra = '') {
    const rd = readiness(r), b = r.branches[0], p = r.dev.prs[0], t = timeOf(r.f.timetracking);
    return `<div class="rw">
      <button class="rw-main" data-key="${esc(r.key)}" title="Abrir ${esc(r.key)}"><span class="k">${esc(r.key)}</span><span class="rw-t">${esc(r.summary)}</span></button>
      <span class="rw-who">${avatar(r.f.assignee?.displayName || '—')}</span>
      <span class="rw-br">${b ? `<code title="${esc(b.name)}">${esc(b.name)}</code>` : '<span class="warn-t">sem branch</span>'}</span>
      <span class="rw-pr"><span class="pill ${p ? prTone(p.state) : rd.tone}">${esc(p ? prLabel(p.state) : rd.txt)}</span></span>
      <span class="rw-tm" title="Apontado de ${esc(t.estTxt)}">${esc(t.txt)}</span>
      ${extra}
      <button class="ic sm ${deployList.includes(r.key) ? 'on' : ''}" data-toggle-deploy="${esc(r.key)}" title="${deployList.includes(r.key) ? 'Tirar do deploy' : 'Colocar no deploy'}" aria-label="Deploy ${esc(r.key)}">${deployList.includes(r.key) ? '✓' : '+'}</button>
    </div>`;
  }

  /* ---------------- Modo Foco ---------------- */
  async function renderFocus() {
    const s = ++seq;
    body.innerHTML = skeleton();
    try {
      const projects = boardProjects();
      const scope = projects.length ? `project in (${projects.join(',')}) AND ` : '';
      const mine = await jql(`${scope}assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, updated DESC`, ['summary', 'status', 'priority', 'duedate', 'timetracking'], 30);
      if (s !== seq || view !== 'focus') return;
      myKeys = new Set(mine.map((i) => i.key));
      paintCards();
      const doing = mine.filter((i) => i.fields?.status?.statusCategory?.key === 'indeterminate' && !/impedid|aguard|bloque/i.test(i.fields?.status?.name || ''));
      body.innerHTML = `<div class="focus">
        <section class="f-now">
          ${focus ? `<div class="timer"><small>${focus.auto ? 'Começou sozinho' : 'Em foco'} desde ${esc(hhmm(focus.start))}</small><b class="clock" data-since="${focus.start}">${esc(clockText(focus.start))}</b><button class="lnk k" data-key="${esc(focus.key)}">${esc(focus.key)}</button><span class="f-t">${esc(focus.title || '')}</span>
            <div class="row gap"><button class="btn sm pri" data-pause>⏸ Pausar e apontar</button><button class="btn sm" data-discard>Descartar</button></div></div>`
            : `<div class="timer idle"><b>Escolha no que focar</b><p>O cronômetro também roda no Meu dia e começa sozinho quando uma demanda sua entra em andamento. Ao pausar, o tempo até ali é apontado na demanda.</p></div>`}
          <div class="wip ${doing.length > 2 ? 'bad' : ''}"><b>${doing.length}</b><span>em andamento no seu nome${doing.length > 2 ? ' · acima do WIP de 2' : ''}</span></div>
        </section>
        <section class="f-list"><h3>Suas demandas abertas <span class="muted">${mine.length}</span></h3>
          ${mine.length ? mine.map((i) => { const f = i.fields || {}, t = timeOf(f.timetracking), due = f.duedate ? new Date(f.duedate + 'T12:00') : null, late = due && due < new Date();
            return `<div class="rw ${focus?.key === i.key ? 'cur' : ''}"><button class="rw-main" data-key="${esc(i.key)}"><span class="k">${esc(i.key)}</span><span class="rw-t">${esc(f.summary)}</span></button>
              <span class="pill ${statusTone(f.status?.statusCategory?.key, f.status?.name)}">${esc(f.status?.name)}</span>
              <span class="rw-tm ${late ? 'bad-t' : ''}">${due ? esc(due.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })) : '—'}</span>
              <span class="rw-tm">${esc(t.txt)}</span>
              ${focus?.key === i.key
                ? '<button class="btn sm pri" data-pause title="Pausar e apontar">⏸ Pausar</button>'
                : `<button class="btn sm" data-play="${esc(i.key)}" data-title="${esc(f.summary)}" data-doing="${isDoingStatus(f.status?.name, f.status?.statusCategory?.key) ? '1' : ''}" title="${focus ? `Pausa ${esc(focus.key)} (aponta) e começa aqui` : 'Iniciar o cronômetro'}">▶ Focar</button>`}</div>`; }).join('') : '<div class="empty sm"><p>Nada aberto no seu nome neste quadro.</p></div>'}
        </section></div>`;
    } catch (e) { if (s === seq) body.innerHTML = note(e.message, 'err'); }
  }
  /* Cronômetro: começar (pausando e apontando o que estava rodando), pausar e apontar, descartar e desfazer. */
  let lastLog = null, timerBusy = false;
  const redrawTimer = () => { paintDay(); paintSide(); drawBar(); paintRunStrip(); if (view === 'focus') renderFocus(); };
  async function startTimer(k, title, doing = false) {
    if (!validKey(k) || timerBusy) return;
    if (storedFocus()?.key === k) return;
    if (storedFocus()) await pauseTimer({ why: 'Trocou de demanda' });
    focus = { key: k, title: title || cache.get(k)?.data?.summary || doingNow.find((d) => d.key === k)?.summary || '', start: Date.now(), doing: !!doing };
    saveFocus();
    redrawTimer();
  }
  async function pauseTimer({ end = Date.now(), why = '' } = {}) {
    const t = storedFocus();
    if (!t || timerBusy) return;
    timerBusy = true;
    // Libera o cronômetro antes de apontar: outra aba do Jira não aponta o mesmo trecho de novo.
    focus = null; saveFocus();
    skip = addSkip(skip, t.key); saveSkip();
    const log = worklogFor(t, end);
    try {
      if (!log) { showMsg(`${why ? why + ': menos' : 'Menos'} de 1 minuto em ${t.key}, nada apontado.`); return; }
      const res = await api(`issue/${t.key}/worklog?adjustEstimate=auto`, { method: 'POST', body: JSON.stringify(log.body) });
      lastLog = { key: t.key, id: res?.id, timer: t };
      runInfo = null;
      cache.delete(t.key);
      showMsg(`${why ? why + ': apontado' : 'Apontado'} ${formatMinutes(log.minutes)} em ${t.key} (${hhmm(t.start)}–${hhmm(Math.min(end, t.start + log.minutes * 60000))}).`, 'ok', !!res?.id);
      refreshedAt = 0;   // a meta do dia muda: relê na próxima volta
      if (dialogOpen) { refreshDay(); if (side.key) loadSide(side.key); }
    } catch (err) {
      focus = t; saveFocus();
      showMsg(`Não deu para apontar em ${t.key}: ${err.message} O cronômetro continua rodando.`, 'err');
    } finally {
      timerBusy = false;
      redrawTimer();
    }
  }
  function discardTimer() {
    const t = storedFocus();
    if (!t) return;
    focus = null; saveFocus();
    skip = addSkip(skip, t.key); saveSkip();
    showMsg(`Cronômetro de ${t.key} descartado, nada apontado.`);
    redrawTimer();
  }
  async function undoLog() {
    const l = lastLog;
    if (!l?.id) return;
    lastLog = null;
    try {
      await api(`issue/${l.key}/worklog/${l.id}?adjustEstimate=auto`, { method: 'DELETE' });
      cache.delete(l.key);
      if (!storedFocus()) { focus = l.timer; saveFocus(); }   // volta a rodar de onde estava
      runInfo = null;
      showMsg(`Apontamento em ${l.key} desfeito${focus?.key === l.key ? '; o cronômetro voltou a rodar' : ''}.`);
      refreshedAt = 0;
    } catch (err) { showMsg(`Não deu para desfazer em ${l.key}: ${err.message}`, 'err'); }
    redrawTimer();
  }

  /* ---------------- Modo Deploy ---------------- */
  function toggleDeploy(k) {
    if (!validKey(k)) return;
    deployList = deployList.includes(k) ? deployList.filter((x) => x !== k) : [...deployList, k];
    saveDeploy(); paintCards(); drawBar(); paintSide();
    if (view === 'deploy') renderDeploy();
    else if (view === 'column' || (view === 'issue' && tab === 'resumo')) render();
  }
  async function renderDeploy() {
    const s = ++seq;
    if (!deployList.length) {
      body.innerHTML = `<div class="empty"><b>Monte a lista do deploy</b><p>Passe o mouse no card e clique em <b>⇪</b>, ou Shift+clique no card. O QuickFill junta branch e PR de cada demanda e prepara o comando, as notas e o card "Realizando Deploy".</p>
        <button class="btn sm pri" data-action="add-feito">Adicionar tudo de Feito / PR</button></div>`;
      return;
    }
    body.innerHTML = skeleton();
    const rows = await mapLimit(deployList, 4, (k) => issueData(k));
    if (s !== seq || view !== 'deploy') return;
    const ok = rows.filter((r) => !r.error);
    const branches = [...new Set(ok.flatMap(r => r.branches.map(b => b.name)))];
    const warn = ok.filter((r) => readiness(r).tone === 'warn');
    const repos = new Map();
    for (const r of ok) for (const b of r.branches) {
      const repo = b.repo || '';
      if (!repos.has(repo)) repos.set(repo, new Set());
      repos.get(repo).add(b.name);
    }
    const gitActions = [...repos].map(([repo, names]) => {
      const commands = ['git fetch origin', ...[...names].map(name => branchCommands(name).mergeOnly)];
      return `<button class="act" data-copy="${esc(commands.join('\n'))}"><b>Copiar comando Git</b><span>${esc(repo || 'Repositório não informado')} · ${names.size} branch(es)</span></button>`;
    }).join('');
    const notes = ok.map((r) => `- [${r.key}] ${r.summary}`).join('\n');
    body.innerHTML = `<div class="dep">
      <section class="dep-l">
        <div class="list-h"><b>${deployList.length} ${deployList.length === 1 ? 'demanda' : 'demandas'}</b><span class="muted">${branches.length} ${branches.length === 1 ? 'branch' : 'branches'}${warn.length ? ` · <span class="warn-t">${warn.length} pedem atenção</span>` : ' · tudo pronto'}</span><span class="grow"></span><button class="btn sm" data-action="add-feito">+ Tudo de Feito / PR</button><button class="btn sm" data-action="clear-deploy">Limpar</button></div>
        <div class="rows">${rows.map((r) => r.error ? `<div class="rw err"><span class="k">${esc(r.key)}</span><span class="err-t">${esc(r.error)}</span><button class="ic sm" data-toggle-deploy="${esc(r.key)}">✕</button></div>` : `<article class="deploy-issue">${rowHtml(r)}${developmentHtml(r, true)}</article>`).join('')}</div>
      </section>
      <aside class="dep-a">
        <h3>Preparar</h3>
        <button class="act" data-copy="${esc(branches.join('\n'))}" ${branches.length ? '' : 'disabled'}><b>Copiar branches</b><span>uma por linha</span></button>
        ${gitActions}
        <button class="act" data-copy="${esc(notes)}"><b>Copiar notas da release</b><span>chave e título, em lista</span></button>
        <h3>No Jira</h3>
        <button class="act" data-action="ask-card"><b>Criar card "Realizando Deploy"</b><span>ligado às demandas da lista</span></button>
        <button class="act" data-action="ask-move"><b>Mover para Deploy</b><span>todas que puderem ir</span></button>
        ${confirmBox ? `<div class="confirm" role="alertdialog" aria-label="Confirmar">${confirmBox}</div>` : ''}
      </aside></div>`;
  }
  async function deployersList() {
    try { const { deployers } = await chrome.storage.sync.get({ deployers: '' }); const l = JSON.parse(deployers || '[]'); return Array.isArray(l) ? l.filter((p) => p.accountId) : []; } catch { return []; }
  }
  async function askCard() {
    const people = await deployersList(), project = deployList[0]?.split('-')[0] || '';
    confirmBox = people.length
      ? `<b>Criar "Realizando Deploy" em ${esc(project)}?</b><p>Ligado às ${deployList.length} demandas da lista.</p><label for="df-dep">Quem faz o deploy</label><select id="df-dep" class="inp">${people.map((p) => `<option value="${esc(p.accountId)}">${esc(p.name)}</option>`).join('')}</select><div class="row gap"><button class="btn sm pri" data-action="do-card">Criar no Jira</button><button class="btn sm" data-action="cancel">Cancelar</button></div>`
      : '<b>Ninguém cadastrado para o deploy</b><p>Cadastre quem faz o deploy em Opções › Deploy.</p><button class="btn sm" data-action="cancel">Entendi</button>';
    renderDeploy();
  }
  async function doCard() {
    const assigneeId = root.getElementById('df-dep')?.value;
    confirmBox = note('Criando o card…'); renderDeploy();
    try {
      const items = deployList.map((k) => ({ key: k, summary: cache.get(k)?.data?.summary || '' }));
      const res = await send('CREATE_DEPLOY_CARD', { project: deployList[0].split('-')[0], keys: deployList, items, assigneeId, link: true });
      confirmBox = `<b>Card criado: <a href="${esc(safeUrl(res.url))}" target="_blank" rel="noopener">${esc(res.key)} ↗</a></b><p>${(res.steps || []).map((x) => esc(x.step) + (x.ok ? ' ✓' : ' ✕')).join(' · ')}</p><button class="btn sm" data-action="cancel">Fechar</button>`;
    } catch (e) { confirmBox = `<b>Não deu para criar</b><p>${esc(e.message)}</p><button class="btn sm" data-action="cancel">Fechar</button>`; }
    renderDeploy();
  }
  let movePlan = [];
  async function askMove() {
    confirmBox = note('Conferindo as transições…'); renderDeploy();
    const plan = await mapLimit(deployList, 4, async (k) => ({ key: k, t: ((await api(`issue/${k}/transitions`)).transitions || []).find((x) => /deploy/i.test(x.to?.name || x.name)) }));
    movePlan = plan.filter((p) => p && p.t);
    const risky = movePlan.filter((p) => { const d = cache.get(p.key)?.data; return d && readiness(d).tone === 'warn'; }).map((p) => `${esc(p.key)} (${esc(readiness(cache.get(p.key).data).txt)})`);
    confirmBox = movePlan.length
      ? `<b>Mover ${movePlan.length} de ${plan.length} para ${esc(movePlan[0].t.to?.name || movePlan[0].t.name)}?</b><p>${movePlan.map((p) => esc(p.key)).join(', ')}${plan.length > movePlan.length ? `. Sem transição para Deploy: ${plan.filter((p) => !p?.t).map((p) => esc(p?.key)).join(', ')}` : ''}.</p>${risky.length ? `<p class="warn-t">Atenção: ${risky.join(', ')}. Confira antes de subir.</p>` : ''}<div class="row gap"><button class="btn sm pri" data-action="do-move">Mover no Jira</button><button class="btn sm" data-action="cancel">Cancelar</button></div>`
      : '<b>Nenhuma demanda pode ir para Deploy agora</b><p>O fluxo do Jira não oferece essa transição a partir do status atual.</p><button class="btn sm" data-action="cancel">Entendi</button>';
    renderDeploy();
  }
  async function doMove() {
    confirmBox = note(`Movendo ${movePlan.length}…`); renderDeploy();
    const res = await mapLimit(movePlan, 3, async (p) => { await api(`issue/${p.key}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: p.t.id } }) }); cache.delete(p.key); return { key: p.key, ok: true }; });
    const bad = res.filter((r) => !r?.ok);
    confirmBox = `<b>${res.length - bad.length} de ${res.length} movidas para Deploy</b>${bad.length ? `<p>Falharam: ${bad.map((b) => esc(b.key) + ' (' + esc(b.error) + ')').join(', ')}</p>` : '<p>O quadro do Jira atualiza sozinho em instantes.</p>'}<button class="btn sm" data-action="cancel">Fechar</button>`;
    renderDeploy();
  }

  /* ================================================================ */
  /* Eventos da interface                                              */
  /* ================================================================ */
  body.addEventListener('input', (e) => { if (e.target.classList?.contains('editor')) drafts.set(key, e.target.innerHTML); });
  body.addEventListener('keydown', (e) => {
    if (!e.target.classList?.contains('editor') || !(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (['b', 'i', 'u'].includes(k)) { e.preventDefault(); document.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[k]); }
    if (k === 'enter') { e.preventDefault(); e.target.closest('form')?.requestSubmit(); }
  });
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const item = key, form = e.target, ed = form.querySelector('.editor');
    if (!ed || !ed.textContent.trim() || posting.has(item)) return;
    posting.add(item);
    form.querySelector('.btn.pri').disabled = true;
    try {
      await api(`issue/${item}/comment`, { method: 'POST', body: JSON.stringify({ body: htmlToAdf(ed) }) });
      drafts.delete(item);
      cache.delete(item);
      if (key === item && tab === 'comments') { current = await issueData(item, true).catch(() => current); drawBar(); render(); }
    } catch (err) {
      if (form.isConnected) form.querySelector('.feedback').textContent = err.message + ' Confira a demanda antes de repetir.';
    } finally {
      posting.delete(item);
      body.querySelector('form .btn.pri')?.removeAttribute('disabled');
    }
  });

  function formatCmd(fmt) {
    const ed = body.querySelector('.editor');
    if (!ed) return;
    ed.focus();
    if (fmt === 'h2' || fmt === 'h3') document.execCommand('formatBlock', false, fmt);
    else if (fmt === 'quote') document.execCommand('formatBlock', false, 'blockquote');
    else if (fmt === 'code') { const sel = root.getSelection?.() || getSelection(); const t = sel?.toString() || 'código'; document.execCommand('insertHTML', false, `<code>${esc(t)}</code>&nbsp;`); }
    else if (fmt === 'link') { const u = prompt('Endereço do link (https://…)'); if (u && safeUrl(u)) document.execCommand('createLink', false, safeUrl(u)); }
    else document.execCommand(fmt);
    drafts.set(key, ed.innerHTML);
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const a = b.dataset.action;
    if (b.dataset.fmt) { e.preventDefault(); formatCmd(b.dataset.fmt); return; }
    if (b.dataset.mode) {
      const m = b.dataset.mode;
      if (m === 'issue' && key) openIssue(key); else setView(m);
      modesEl.querySelector('.on')?.focus({ preventScroll: true });
      return;
    }
    if (b.dataset.size) { size = b.dataset.size; try { localStorage.setItem(SIZE, size); } catch { /* sem storage */ } applySize(); folded = false; drawBar(); render(); return; }
    if (b.dataset.col !== undefined) { const c = columns()[Number(b.dataset.col)]; if (c) openColumn(c); return; }
    if (a === 'ms-toggle') {
      side.expanded = !side.expanded;
      try { localStorage.setItem(SIDE_OPEN, side.expanded ? '1' : '0'); } catch { /* sem storage */ }
      updateSide(); paintSide();
      return;
    }
    if (a === 'ms-refresh') { loadSide(side.key); refreshDay(); return; }
    if (a === 'day') setDay(!expandedDay);
    else if (a === 'day-refresh') refreshDay();
    else if (a === 'refresh') { if (view === 'issue') openIssue(key, true); else { cache.clear(); render(); } }
    else if (a === 'fold') { folded = !folded; drawBar(); render(); }
    else if (a === 'add-feito') {
      const keys = columns().filter((c) => isPrCol(c.name)).flatMap((c) => c.keys);
      if (!keys.length) flash(b, 'Nenhum card em Feito/PR visível');
      else { deployList = [...new Set([...deployList, ...keys])]; saveDeploy(); paintCards(); drawBar(); renderDeploy(); }
    }
    else if (a === 'col-to-deploy') { deployList = [...new Set([...deployList, ...(colView?.keys || [])])]; saveDeploy(); paintCards(); setView('deploy'); }
    else if (a === 'clear-deploy') { deployList = []; saveDeploy(); paintCards(); drawBar(); renderDeploy(); }
    else if (a === 'ask-card') askCard();
    else if (a === 'do-card') doCard();
    else if (a === 'ask-move') askMove();
    else if (a === 'do-move') doMove();
    else if (a === 'cancel') { confirmBox = null; render(); }
    if (b.dataset.tab) { body.scrollTop = 0; tab = b.dataset.tab; drawBar(); render(); tabsEl.querySelector('.on')?.focus({ preventScroll: true }); }
    if (b.dataset.copy !== undefined) copy(b.dataset.copy, b);
    if (b.dataset.toggleDeploy) toggleDeploy(b.dataset.toggleDeploy);
    if (b.dataset.play) { startTimer(b.dataset.play, b.dataset.title, b.dataset.doing === '1'); return; }
    if (b.hasAttribute('data-pause')) { pauseTimer(); return; }
    if (b.hasAttribute('data-discard')) { discardTimer(); return; }
    if (b.hasAttribute('data-undo')) { undoLog(); return; }
    if (b.dataset.key) openIssue(b.dataset.key, false, b.dataset.openTab);
  });

  // Altura livre: arrastar a borda de cima da barra
  $('.grip').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = body.getBoundingClientRect().height || 300;
    const move = (ev) => { applySize(Math.max(160, Math.min(innerHeight * 0.75, h0 + (y0 - ev.clientY)))); reserveBoard(); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });

  /* ================================================================ */
  /* Liga/desliga e acompanhamento do Jira                             */
  /* ================================================================ */
  function enable(next) {
    active = next;
    launch.setAttribute('aria-pressed', String(next));
    launch.title = next ? 'Desligar o DashFill' : 'Ligar o DashFill neste quadro';
    day.hidden = dock.hidden = !next;
    pageCss.disabled = !next;
    if (next) {
      drawBar(); geometry(); refreshDay(); paintCards();
    } else {
      seq++; daySeq++; dayData = null;
      key = ''; current = null; colView = null; expandedDay = false; folded = true; view = 'issue'; confirmBox = null; myKeys = null;
      day.classList.remove('expanded'); day.replaceChildren(); body.replaceChildren(); colBox.replaceChildren();
      sideEl.hidden = true; sideEl.replaceChildren(); side.key = ''; side.data = null;
      releaseBoard(); paintCards(); paintRunStrip();
    }
  }
  launch.onclick = () => {
    sessionOn = !active;
    try { sessionStorage.setItem(PREF, sessionOn ? '1' : '0'); } catch { /* sem storage */ }
    enable(sessionOn);
  };
  document.addEventListener('keydown', (e) => {
    if (!active || e.target?.closest?.('input,textarea,[contenteditable="true"]') || host.matches(':focus-within') && e.composedPath()[0]?.closest?.('.editor')) return;
    if (e.key === 'Escape' && !folded) { folded = true; drawBar(); }
  });

  function tick() {
    for (const c of root.querySelectorAll('.clock[data-since]')) c.textContent = clockText(Number(c.dataset.since));
    if (runStrip?.isConnected) { const c = runStrip.querySelector('.qf-run-clock'); if (c) c.textContent = clockText(Number(c.dataset.since)); }
  }
  setInterval(() => { if (active) tick(); }, 1000);
  // Outra aba do Jira começou, pausou ou descartou o cronômetro: acompanha aqui.
  addEventListener('storage', (e) => {
    if (e.key !== FOCUS && e.key !== SKIP) return;
    focus = storedFocus();
    try { skip = JSON.parse(localStorage.getItem(SKIP) || 'null'); } catch { /* sem storage */ }
    if (active) redrawTimer();
  });
  function sync() {
    const path = location.pathname, allowed = boardRoute();
    if (path !== route || launch.hidden === allowed) {
      route = path; enable(false); launch.hidden = !allowed;
      if (allowed && sessionOn) enable(true);
    }
    updateDialog();
    if (!active || dialogOpen) return;

    geometry(); reserveBoard(); paintCards(); paintRunStrip(); tick();
    if (!document.hidden && !expandedDay && Date.now() - refreshedAt > 60000) refreshDay();
  }
  const dialogSelector = 'dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"],.jqf-backdrop';
  function updateDialog() {
    const visible = [...document.querySelectorAll(dialogSelector)].some(el =>
      !el.closest('[hidden],[aria-hidden="true"]') && el.checkVisibility({ visibilityProperty: true }));
    if (visible === dialogOpen) { updateSide(); return; }
    dialogOpen = visible;
    // Com o modal aberto só o painel da demanda aparece; lateral, barra e botões de coluna somem.
    host.toggleAttribute('data-dialog', visible);
    reserveBoard();
    updateSide();
  }
  new MutationObserver(records => {
    if (dialogOpen || records.some(record => record.type === 'attributes' ||
      [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches(dialogSelector) || node.querySelector(dialogSelector))))) updateDialog();
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['role', 'aria-modal', 'aria-hidden', 'open', 'hidden'] });
  new ResizeObserver(() => { reserveBoard(); placeColButtons(); }).observe(dock);
  addEventListener('resize', () => { geometry(); if (dialogOpen) updateSide(); }, { passive: true });
  addEventListener('scroll', placeColButtons, { passive: true, capture: true });
  sync();
  setInterval(sync, 1200);
})().catch((error) => console.warn('QuickFill DEV: não foi possível abrir o DashFill.', error));
