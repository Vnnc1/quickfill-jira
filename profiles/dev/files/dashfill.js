/* DashFill DEV: o quadro continua sendo do Jira (navegação, cliques e arraste).
 * Por cima dele: a lateral "Meu dia", a barra de baixo com o contexto da demanda e os modos de trabalho
 * do DEV (Foco, PRs, Retornos do QA, Daily e Deploy). */
(async () => {
  if (document.getElementById('quickfill-dev-dashfill')) return;
  const url = (file) => chrome.runtime.getURL(file);
  const [
    { extractLinks, formatMinutes, formatHM, timelineMetrics, issueKey },
    { renderHistory },
    { loadAccent },
  ] = await Promise.all([
    import(url('lib/board-rules.js')),
    import(url('lib/history-view.js')),
    import(url('lib/theme.js')),
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
    <button class="side-tab" hidden><span class="st-ic" aria-hidden="true">›</span><span class="st-t"></span></button>
    <div class="colbtns"></div>
    <aside class="day" aria-label="Meu dia no QuickFill DEV" hidden></aside>
    <section class="dock" aria-label="DashFill" hidden>
      <div class="grip" title="Arraste para mudar a altura" aria-hidden="true"></div>
      <header class="bar">
        <span class="mark">QF</span>
        <div class="who"></div>
        <nav class="modes" aria-label="Modos do DashFill"></nav>
        <div class="sizes" role="group" aria-label="Altura da barra"></div>
        <button class="ic" data-action="refresh" title="Atualizar" aria-label="Atualizar">↻</button>
        <button class="ic" data-action="fold" aria-expanded="false" aria-label="Abrir ou fechar a barra">⌃</button>
      </header>
      <nav class="tabs" aria-label="Contexto da demanda" hidden></nav>
      <div class="body" hidden></div>
    </section>`;
  document.documentElement.append(host);
  loadAccent('dev', host);

  // Marcas sobre os cards do Jira (fora do shadow): lista de deploy, card escolhido e o que sai de foco.
  const pageCss = document.createElement('style');
  pageCss.dataset.qfOwned = 'true';
  pageCss.textContent = `[data-qf-deploy]{outline:2px solid #4bce97!important;outline-offset:-2px;border-radius:6px;position:relative}
    [data-qf-deploy]::after{content:"Deploy";position:absolute;right:30px;top:6px;z-index:2;font:700 10.5px/1.6 -apple-system,'Segoe UI',sans-serif;padding:0 6px;border-radius:999px;background:#4bce97;color:#0f1a14;pointer-events:none}
    [data-qf-sel]{outline:2px solid rgba(87,157,255,.9)!important;outline-offset:-2px;border-radius:6px}
    [data-qf-dim]{opacity:.32;transition:opacity .2s}
    [data-qf-dim]:hover{opacity:.8}`;
  document.head.append(pageCss);

  const $ = (s) => root.querySelector(s);
  const launch = $('.launch'), day = $('.day'), dock = $('.dock'), sideTab = $('.side-tab'), colBox = $('.colbtns');
  const body = $('.body'), tabsEl = $('.tabs'), whoEl = $('.who'), modesEl = $('.modes'), sizesEl = $('.sizes');

  /* ================================================================ */
  /* Utilitários                                                       */
  /* ================================================================ */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const note = (m, cls = '') => `<p class="note ${cls}" role="status">${esc(m)}</p>`;
  const validKey = (k) => /^[A-Z][A-Z0-9_]*-\d+$/.test(k || '');
  const safeUrl = (v) => { try { const u = new URL(v, location.origin); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
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
  const PREF = 'qf.dev.dashfill.active', DEPLOY = 'qf.dev.dashfill.deploy', SIZE = 'qf.dev.dashfill.size', FOCUS = 'qf.dev.dashfill.focus';
  const MODES = [
    ['issue', 'Demanda', 'O contexto da demanda escolhida no quadro'],
    ['focus', 'Foco', 'Só o que é seu, com cronômetro para apontar'],
    ['prs', 'PRs', 'Pull requests do quadro: revisão, aprovação e merge'],
    ['returns', 'Retornos', 'O que voltou do QA ou do deploy nos últimos 14 dias'],
    ['daily', 'Daily', 'Ontem, hoje e impedimentos, prontos para a daily'],
    ['deploy', 'Deploy', 'Lista de demandas para subir juntas'],
  ];
  const TABS = [['resumo', 'Resumo'], ['git', 'Branch e PR'], ['docs', 'Docs e Figma'], ['comments', 'Comentários'], ['history', 'Histórico']];
  const SIZES = { s: 230, m: 360, l: Math.round(innerHeight * 0.58) };
  let active = false, expandedDay = false, folded = true, view = 'issue', tab = 'resumo', size = 'm';
  let key = '', current = null, colView = null, card = null, route = '', refreshedAt = 0, confirmBox = null;
  let seq = 0, daySeq = 0, sessionOn = false, deployList = [], focus = null, myKeys = null;
  const reserved = new Map();
  try {
    const saved = sessionStorage.getItem(PREF);
    sessionOn = saved === null ? sessionStorage.getItem('quickfill-board-active') === 'true' : saved === '1';
    deployList = JSON.parse(sessionStorage.getItem(DEPLOY) || '[]').filter(validKey);
    size = localStorage.getItem(SIZE) || 'm';
    focus = JSON.parse(localStorage.getItem(FOCUS) || 'null');
  } catch { /* sem storage */ }
  const applySize = (px) => host.style.setProperty('--dock-h', (px || SIZES[size] || 360) + 'px');
  applySize();
  const saveDeploy = () => { try { sessionStorage.setItem(DEPLOY, JSON.stringify(deployList)); } catch { /* sem storage */ } };
  const saveFocus = () => { try { localStorage.setItem(FOCUS, JSON.stringify(focus)); } catch { /* sem storage */ } };
  const drafts = new Map(), posting = new Set(), cache = new Map();

  /* ================================================================ */
  /* Dados de uma demanda: campos, links, branch e PR (dev-status)     */
  /* ================================================================ */
  let fieldIdsP = null;
  const branchFieldIds = () => (fieldIdsP ||= api('field').then((fs) => fs.filter((f) => /\bbranch(?:es)?\b/i.test(f.name) && /^customfield_\d+$/.test(f.id)).map((f) => f.id)).catch((e) => { fieldIdsP = null; throw e; }));
  function branchValues(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.flatMap(branchValues);
    if (typeof v === 'string') return v.split(/[\s,;]+/).filter(Boolean).map((name) => ({ name: name.replace(/^[A-Z ]+:\s*/, ''), url: safeUrl(name) && /^https?:/.test(name) ? name : '' }));
    if (v.type === 'text') { const href = safeUrl(v.marks?.find((m) => m.type === 'link')?.attrs?.href); return href ? [{ name: v.text, url: href }] : branchValues(v.text); }
    if (v.content) return branchValues(v.content);
    const href = v.url || v.attrs?.url;
    return href ? [{ name: v.name || v.value || href, url: safeUrl(href) }] : branchValues(v.value || v.name);
  }
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
    const ids = await branchFieldIds().catch(() => []);
    const fields = ['summary', 'status', 'assignee', 'reporter', 'priority', 'duedate', 'timetracking', 'issuetype', 'parent', 'description', 'updated', 'created', 'labels', 'issuelinks', 'comment', ...ids];
    const [issue, remote] = await Promise.all([api(`issue/${k}?fields=${fields.join(',')}`), api(`issue/${k}/remotelink`).catch(() => [])]);
    const dev = await devStatus(issue.id);
    const f = issue.fields || {};
    const names = new Set(dev.branches.map((b) => b.name));
    const fb = ids.flatMap((id) => branchValues(f[id])).filter((b) => !names.has(b.name)).map((b) => ({ ...b, repo: '', fromField: true }));
    const data = { key: k, id: issue.id, f, dev, branches: [...dev.branches, ...fb], links: extractLinks(issue, remote || []), summary: f.summary || '', status: f.status?.name || '', cat: f.status?.statusCategory?.key || '', comments: f.comment?.total ?? (f.comment?.comments || []).length };
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
  const COL_SEL = '[data-testid*="board-kit.ui.column"],[data-rbd-droppable-id^="column"],[data-testid*="board-column"]';
  const boardRoute = () => /\/boards?\/\d+(?:\/|$)|\/projects\/[^/]+\/board\/?$|\/secure\/RapidBoard\.jspa$/i.test(location.pathname) || !!document.querySelector(COL_SEL);
  function cardAt(el) {
    const node = el?.closest?.(`${CARD_SEL},article,a[href*="/browse/"]`);
    if (!node || node.closest('[role="dialog"]') || host.contains(node)) return null;
    const direct = node.getAttribute('data-issue-key') || node.getAttribute('data-rbd-draggable-id');
    const link = node.matches('a[href]') ? node : node.querySelector('a[href*="/browse/"],a[href*="selectedIssue="]');
    const k = validKey(direct) ? direct : link ? issueKey(link.href) : node.textContent.match(/\b[A-Z][A-Z0-9_]*-\d+\b/)?.[0];
    return validKey(k) ? { node, key: k } : null;
  }
  function cardNodes(scope = document) {
    const map = new Map();
    for (const n of scope.querySelectorAll(CARD_SEL)) { const c = cardAt(n); if (c && !map.has(c.key)) map.set(c.key, c.node); }
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

  function paintCards() {
    const nodes = cardNodes();
    for (const el of document.querySelectorAll('[data-qf-deploy],[data-qf-sel],[data-qf-dim]')) { el.removeAttribute('data-qf-deploy'); el.removeAttribute('data-qf-sel'); el.removeAttribute('data-qf-dim'); }
    if (!active) return;
    for (const k of deployList) nodes.get(k)?.setAttribute('data-qf-deploy', '1');
    if (key && view === 'issue') nodes.get(key)?.setAttribute('data-qf-sel', '1');
    if (view === 'focus' && myKeys) for (const [k, n] of nodes) if (!myKeys.has(k)) n.setAttribute('data-qf-dim', '1');
  }

  /* Aba lateral no card: aparece ao passar o mouse, na borda direita do card. */
  function hideTab() { card = null; sideTab.hidden = true; }
  function placeTab() {
    if (!card?.node.isConnected || !active) return hideTab();
    const r = card.node.getBoundingClientRect(), top = dock.hidden ? innerHeight : dock.getBoundingClientRect().top;
    if (r.bottom < 0 || r.top > innerHeight || r.top >= top - 12) return hideTab();
    const h = Math.max(36, Math.min(r.height - 6, top - r.top - 6));
    Object.assign(sideTab.style, { left: r.right - 30 + 'px', top: r.top + 3 + 'px', height: h + 'px' });
    sideTab.classList.toggle('short', h < 84);
  }
  function labelTab() {
    if (!card) return;
    const inList = deployList.includes(card.key);
    const dep = view === 'deploy';
    sideTab.classList.toggle('dep', dep);
    sideTab.classList.toggle('in', dep && inList);
    $('.st-ic').textContent = dep ? (inList ? '−' : '+') : '›';
    $('.st-t').textContent = dep ? (inList ? 'Tirar' : 'Deploy') : 'DashFill';
    sideTab.title = dep ? `${inList ? 'Tirar' : 'Colocar'} ${card.key} na lista de deploy (ou Shift+clique no card)` : `Ver ${card.key} no DashFill`;
    sideTab.setAttribute('aria-label', sideTab.title);
  }
  function preview(e) {
    if (!active || host.contains(e.target)) return;
    const found = cardAt(e.target);
    if (!found) return;
    card = found; sideTab.hidden = false; labelTab(); placeTab();
  }
  document.addEventListener('pointerover', preview, true);
  document.addEventListener('focusin', preview, true);
  document.addEventListener('dragstart', hideTab, true);
  document.addEventListener('click', (e) => {
    if (!active || !e.shiftKey) return;
    const found = cardAt(e.target);
    if (!found) return;
    e.preventDefault(); e.stopPropagation();
    toggleDeploy(found.key);
  }, true);
  sideTab.onclick = () => {
    if (!card) return;
    if (view === 'deploy') { toggleDeploy(card.key); labelTab(); return; }
    openIssue(card.key);
  };

  /* Botões sobre as colunas: listar todas as demandas da coluna na barra. */
  function placeColButtons() {
    if (!active) { colBox.replaceChildren(); return; }
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
    placeTab();
    placeColButtons();
  }
  /* Reserva espaço para a barra: limita a altura das áreas de rolagem do quadro (vertical e horizontal)
   * para que nenhuma barra de rolagem do Jira fique escondida atrás do DashFill. */
  function releaseBoard() {
    for (const [node, r] of reserved) { if (node.style.maxHeight === r.ours) node.style.maxHeight = r.original; }
    reserved.clear();
  }
  function reserveBoard() {
    if (!active || dock.hidden) return releaseBoard();
    const col = document.querySelector(COL_SEL);
    if (!col) return releaseBoard();
    const top = dock.getBoundingClientRect().top;
    const want = new Set();
    for (let n = col.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (n.matches('main,[role=main]')) break;
      const css = getComputedStyle(n), r = n.getBoundingClientRect();
      const scrollsY = /(auto|scroll)/.test(css.overflowY) && r.width > innerWidth * 0.45;
      const scrollsX = /(auto|scroll)/.test(css.overflowX) && n.scrollWidth > n.clientWidth + 2;
      if ((scrollsY || scrollsX) && r.bottom > top - 4) want.add(n);
      if (scrollsY && !scrollsX) break;
    }
    for (const [node] of reserved) if (!want.has(node)) { const r = reserved.get(node); if (node.style.maxHeight === r.ours) node.style.maxHeight = r.original; reserved.delete(node); }
    for (const node of want) {
      if (!reserved.has(node)) reserved.set(node, { original: node.style.maxHeight, ours: null });
      const r = reserved.get(node);
      r.ours = Math.max(120, Math.floor(top - node.getBoundingClientRect().top - 6)) + 'px';
      if (node.style.maxHeight !== r.ours) node.style.maxHeight = r.ours;
    }
  }

  /* ================================================================ */
  /* Lateral: Meu dia                                                  */
  /* ================================================================ */
  let doingNow = [];
  const dayHead = () => `<div class="d-h"><span class="mark">QF</span><b>Meu dia</b><small>${new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</small><button class="ic sm" data-action="day-refresh" aria-label="Atualizar meu dia" title="Atualizar">↻</button></div>`;
  async function refreshDay() {
    if (!active || expandedDay) return;
    const s = ++daySeq;
    refreshedAt = Date.now();
    if (!day.querySelector('.goal')) day.innerHTML = dayHead() + note('Consultando a meta…');
    try {
      const [rep, doing] = await Promise.all([
        send('DAY_REPORT', { days: 10 }),
        jql('assignee = currentUser() AND statusCategory = "In Progress" ORDER BY updated DESC', ['summary', 'status'], 3).catch(() => []),
      ]);
      doingNow = doing.map((i) => ({ key: i.key, summary: i.fields?.summary || '', status: i.fields?.status?.name || '' }));
      if (s !== daySeq || !active || expandedDay) return;
      const m = timelineMetrics(rep), done = m.total >= m.goal, wd = rep.workday, width = wd.end - wd.start;
      const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
      const seg = (rep.entries || []).map((e) => {
        const a = Math.max(wd.start, e.start), b = Math.min(wd.end, e.end);
        if (b <= a || width <= 0) return '';
        return `<i class="${e.key === doingNow[0]?.key ? 'cur' : ''}" style="left:${(100 * (a - wd.start)) / width}%;width:${(100 * (b - a)) / width}%" title="${esc(e.key)} · ${formatHM(e.start)}–${formatHM(e.end)}"></i>`;
      }).join('');
      const nowPct = nowMin > wd.start && nowMin < wd.end ? (100 * (nowMin - wd.start)) / width : -1;
      const pct = Math.min(100, Math.round(m.percent));
      const running = focus ? `<button class="now run" data-key="${esc(focus.key)}"><span class="k">${esc(focus.key)}</span><span class="t">Foco: ${esc(formatMinutes(Math.max(1, Math.round((Date.now() - focus.start) / 60000))))}</span></button>` : '';
      const doingHtml = doingNow.slice(0, 2).map((d) => `<button class="now" data-key="${esc(d.key)}" title="${esc(d.key)} · ${esc(d.summary)}"><span class="k">${esc(d.key)}</span><span class="t">${esc(d.summary)}</span></button>`).join('');
      day.innerHTML = dayHead() + `
        <div class="goal">
          <span class="df-ring" style="--p:${pct}" role="img" aria-label="${esc(formatMinutes(m.total))} apontadas de ${esc(formatMinutes(m.goal))}"><span class="ring-v"><b>${esc(formatMinutes(m.total))}</b><small>${pct}%</small></span></span>
          <div class="goal-t"><b class="${done ? 'met' : ''}">${done ? 'Meta batida' : 'Faltam ' + esc(formatMinutes(m.goal - m.total))}</b><small>meta de ${esc(formatMinutes(m.goal))}</small></div>
        </div>
        <div class="tl" aria-label="Linha do tempo de hoje">${seg}${nowPct >= 0 ? `<em style="left:${nowPct}%"></em>` : ''}</div>
        <div class="tl-h"><span>${formatHM(wd.start)}</span><span>${formatHM(wd.end)}</span></div>
        ${running}
        ${doingHtml ? `<div class="sub">Em andamento</div>${doingHtml}` : '<div class="sub">Nada em andamento no seu nome</div>'}
        <div class="quick">
          <button data-mode="focus">Foco</button><button data-mode="prs">PRs</button><button data-mode="returns">Retornos</button><button data-mode="daily">Daily</button>
          <button data-mode="deploy" class="dq">Deploy <b>${deployList.length}</b></button>
        </div>
        <button class="lnk" data-action="day" aria-expanded="false">Abrir meu dia completo ›</button>`;
    } catch (e) {
      if (s === daySeq && active && !expandedDay) day.innerHTML = dayHead() + note(e.message);
    }
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
  /* Barra de baixo                                                    */
  /* ================================================================ */
  function drawBar() {
    const fold = $('[data-action=fold]');
    fold.textContent = folded ? '⌃' : '⌄';
    fold.setAttribute('aria-expanded', String(!folded));
    body.hidden = folded;
    dock.classList.toggle('open', !folded);
    dock.dataset.view = view;
    modesEl.innerHTML = MODES.map(([id, label, tip]) => `<button class="mode ${view === id || (id === 'issue' && view === 'column') ? 'on' : ''} ${id}" data-mode="${id}" title="${esc(tip)}" aria-pressed="${view === id}">${label}${id === 'deploy' ? ` <b>${deployList.length}</b>` : id === 'focus' && focus ? ' <i class="dot"></i>' : ''}</button>`).join('');
    sizesEl.innerHTML = [['s', 'Baixa'], ['m', 'Média'], ['l', 'Alta']].map(([id, l]) => `<button class="sz ${size === id ? 'on' : ''}" data-size="${id}" title="Altura ${l.toLowerCase()}" aria-label="Altura ${l.toLowerCase()}" aria-pressed="${size === id}"><i class="${id}"></i></button>`).join('');
    const dq = day.querySelector('.dq b');
    if (dq) dq.textContent = deployList.length;
    if (view === 'issue') {
      whoEl.innerHTML = key
        ? `<span class="k">${esc(key)}</span>${current ? `<span class="pill ${statusTone(current.cat, current.status)}">${esc(current.status)}</span><b class="ttl" title="${esc(current.summary)}">${esc(current.summary)}</b>` : '<span class="hint">carregando…</span>'}`
        : '<span class="hint">Passe o mouse num card e clique na aba <b>DashFill</b> que aparece na borda dele</span>';
      tabsEl.hidden = !key || folded;
      tabsEl.innerHTML = TABS.map(([id, l]) => {
        const n = !current ? '' : id === 'git' ? current.branches.length + current.dev.prs.length : id === 'docs' ? current.links.figma.length + current.links.confluence.length + current.links.other.length + (current.f.issuelinks || []).length : id === 'comments' ? current.comments : '';
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
    view = v; confirmBox = null; folded = false; hideTab();
    drawBar(); render(); paintCards();
  }
  async function openIssue(k, force = false) {
    if (!validKey(k)) return;
    if (k !== key) tab = 'resumo';
    key = k; view = 'issue'; folded = false; confirmBox = null;
    current = !force && cache.has(k) ? cache.get(k).data : null;
    drawBar(); paintCards();
    const s = ++seq;
    if (!current) body.innerHTML = skeleton();
    try {
      current = await issueData(k, force);
      if (s !== seq) return;
      drawBar(); render();
    } catch (e) { if (s === seq) body.innerHTML = note(e.message + ' Use ↻ para tentar de novo.', 'err'); }
  }
  const skeleton = () => '<div class="skel"><i></i><i></i><i></i></div>';

  function render() {
    if (folded) return;
    if (view === 'issue') return renderIssue();
    if (view === 'column') return renderColumn();
    if (view === 'focus') return renderFocus();
    if (view === 'prs') return renderPrs();
    if (view === 'returns') return renderReturns();
    if (view === 'daily') return renderDaily();
    if (view === 'deploy') return renderDeploy();
  }

  /* ---------------- Demanda ---------------- */
  function renderIssue() {
    if (!key) {
      body.innerHTML = `<div class="empty"><b>Escolha uma demanda no quadro</b><p>Passe o mouse num card e clique na aba <b>DashFill</b> na borda dele. Ou use os modos acima: <b>Foco</b>, <b>PRs</b>, <b>Retornos</b>, <b>Daily</b> e <b>Deploy</b>.</p></div>`;
      return;
    }
    if (!current) return;
    const d = current, f = d.f;
    if (tab === 'resumo') {
      const t = timeOf(f.timetracking), r = readiness(d), main = d.branches[0], pr = d.dev.prs[0];
      const due = f.duedate ? new Date(f.duedate + 'T12:00') : null, late = due && due < new Date() && d.cat !== 'done';
      body.innerHTML = `<div class="sum">
        <section class="s-main">
          <div class="chips">
            ${f.issuetype?.name ? `<span class="chip">${esc(f.issuetype.name)}</span>` : ''}
            ${f.priority?.name ? `<span class="chip pr-${esc(f.priority.name.toLowerCase())}">Prioridade ${esc(f.priority.name)}</span>` : ''}
            ${(f.labels || []).slice(0, 4).map((l) => `<span class="chip">${esc(l)}</span>`).join('')}
            ${f.parent ? `<span class="chip">Pai: ${esc(f.parent.key)}</span>` : ''}
          </div>
          <div class="rich desc">${f.description ? adf(f.description) : '<p class="muted">Sem descrição.</p>'}</div>
        </section>
        <aside class="s-side">
          <div class="facts">
            <div class="fact">${avatar(f.assignee?.displayName || 'Sem responsável')}<span><small>Responsável</small><b>${esc(f.assignee?.displayName || 'Sem responsável')}</b></span></div>
            <div class="fact"><span class="fi ${late ? 'bad' : ''}">◷</span><span><small>Data limite</small><b class="${late ? 'bad-t' : ''}">${due ? esc(due.toLocaleDateString('pt-BR')) + (late ? ' · atrasada' : '') : 'sem data'}</b></span></div>
            <div class="fact"><span class="fi">↻</span><span><small>Atualizada</small><b>${esc(ago(f.updated))}</b></span></div>
          </div>
          <div class="tt"><div class="row"><small>Controle de tempo</small><b>${esc(t.txt)}</b><span class="muted">de ${esc(t.estTxt)}</span></div><div class="meter ${t.over ? 'over' : ''}"><i style="width:${t.pct}%"></i></div></div>
          <div class="ready ${r.tone}">
            <div class="row"><b>Para o deploy</b><span class="pill ${r.tone}">${esc(r.txt)}</span></div>
            ${main ? `<div class="br"><code title="${esc(main.name)}">${esc(main.name)}</code><button class="btn sm" data-copy="${esc(main.name)}">Copiar</button></div>` : '<p class="note">Nenhuma branch ligada.</p>'}
            ${pr ? `<a class="pr" href="${esc(pr.url)}" target="_blank" rel="noopener"><span class="pill ${prTone(pr.state)}">${esc(prLabel(pr.state))}</span><span class="pr-t">${esc(pr.title)}</span><small>${esc(pr.from)} → ${esc(pr.to)}</small></a>` : ''}
            <div class="row gap"><button class="btn sm ${deployList.includes(d.key) ? '' : 'pri'}" data-toggle-deploy="${esc(d.key)}">${deployList.includes(d.key) ? 'Tirar do deploy' : '+ Deploy'}</button>${main ? `<button class="btn sm" data-copy="git fetch origin && git checkout ${esc(main.name)}">Copiar checkout</button>` : ''}<button class="btn sm" data-focus="${esc(d.key)}">${focus?.key === d.key ? 'Em foco' : 'Focar'}</button></div>
          </div>
          <div class="row gap"><a class="btn sm" href="/browse/${esc(d.key)}" target="_blank" rel="noopener">Abrir no Jira ↗</a><button class="btn sm" data-copy="${esc(d.key)} — ${esc(d.summary)}">Copiar chave e título</button></div>
        </aside>
      </div>`;
      return;
    }
    if (tab === 'git') {
      const prs = d.dev.prs.map((p) => {
        const ok = p.reviewers.filter((x) => x.ok).length;
        return `<article class="g-card pr-card ${p.state.toLowerCase()}">
          <div class="row"><span class="pill ${prTone(p.state)}">${esc(prLabel(p.state))}</span><a class="g-t" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a><span class="muted">${esc(p.id)}</span></div>
          <div class="flow"><code>${esc(p.from)}</code><span class="arr">→</span><code>${esc(p.to)}</code></div>
          <div class="row gap muted">${esc(p.repo)}${p.at ? ' · atualizado ' + esc(ago(p.at)) : ''}<span class="grow"></span>${p.reviewers.length ? `<span class="revs">${p.reviewers.map((x) => `<span class="rev ${x.ok ? 'ok' : ''}" title="${esc(x.name)}${x.ok ? ' aprovou' : ' ainda não aprovou'}">${esc(initials(x.name))}</span>`).join('')}</span><span>${ok}/${p.reviewers.length} aprovações</span>` : '<span>sem revisores</span>'}</div>
        </article>`;
      }).join('');
      const brs = d.branches.map((b) => `<article class="g-card">
          <div class="row"><span class="g-ic">⎇</span><code class="g-name" title="${esc(b.name)}">${esc(b.name)}</code></div>
          <div class="muted small">${esc(b.repo || (b.fromField ? 'campo Branch do Jira' : ''))}${b.commit ? ` · último commit <code>${esc(b.commit)}</code>` : ''}${b.at ? ' · ' + esc(ago(b.at)) : ''}</div>
          ${b.commitMsg ? `<div class="small">${esc(b.commitMsg.slice(0, 120))}</div>` : ''}
          <div class="row gap"><button class="btn sm" data-copy="${esc(b.name)}">Copiar nome</button><button class="btn sm" data-copy="git fetch origin && git checkout ${esc(b.name)}">Copiar checkout</button><button class="btn sm" data-copy="git fetch origin && git merge --no-ff origin/${esc(b.name)}">Copiar merge</button>${b.url ? `<a class="btn sm" href="${esc(b.url)}" target="_blank" rel="noopener">Abrir ↗</a>` : ''}</div>
        </article>`).join('');
      body.innerHTML = `<div class="cols2">
        <section><h3>Pull requests <span class="muted">${d.dev.prs.length}</span></h3>${prs || `<div class="empty sm"><p>Nenhum PR ligado a ${esc(d.key)}.</p></div>`}</section>
        <section><h3>Branches <span class="muted">${d.branches.length}</span></h3>${brs || `<div class="empty sm"><p>Nenhuma branch. Use a chave no nome da branch (ex.: <code>feat/${esc(d.key.toLowerCase())}/…</code>) para o Jira ligar sozinho.</p></div>`}
        ${d.dev.builds ? `<p class="muted small">${d.dev.builds} build(s) no painel Desenvolvimento.</p>` : ''}${d.dev.error ? note('Painel Desenvolvimento indisponível: ' + d.dev.error) : ''}</section>
      </div>`;
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
      }).catch((e) => { if (s === seq) body.innerHTML = note(e.message, 'err'); });
    }
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
    } catch (e) { if (s === seq) body.innerHTML = note(e.message + ' Use ↻ para tentar de novo.', 'err'); }
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
      const el = focus ? Math.max(1, Math.round((Date.now() - focus.start) / 60000)) : 0;
      body.innerHTML = `<div class="focus">
        <section class="f-now">
          ${focus ? `<div class="timer"><small>Em foco desde ${esc(new Date(focus.start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}</small><b class="clock" data-since="${focus.start}">${esc(formatMinutes(el))}</b><button class="lnk k" data-key="${esc(focus.key)}">${esc(focus.key)}</button><span class="f-t">${esc(focus.title || '')}</span>
            <div class="row gap"><button class="btn sm pri" data-action="focus-stop">Parar e apontar</button><button class="btn sm" data-action="focus-cancel">Descartar</button></div>${confirmBox ? `<div class="confirm">${confirmBox}</div>` : ''}</div>`
            : `<div class="timer idle"><b>Escolha no que focar</b><p>O quadro apaga o que não é seu. O cronômetro roda mesmo fechando o Jira e, ao parar, você aponta o tempo na demanda com um clique.</p></div>`}
          <div class="wip ${doing.length > 2 ? 'bad' : ''}"><b>${doing.length}</b><span>em andamento no seu nome${doing.length > 2 ? ' · acima do WIP de 2' : ''}</span></div>
        </section>
        <section class="f-list"><h3>Suas demandas abertas <span class="muted">${mine.length}</span></h3>
          ${mine.length ? mine.map((i) => { const f = i.fields || {}, t = timeOf(f.timetracking), due = f.duedate ? new Date(f.duedate + 'T12:00') : null, late = due && due < new Date();
            return `<div class="rw ${focus?.key === i.key ? 'cur' : ''}"><button class="rw-main" data-key="${esc(i.key)}"><span class="k">${esc(i.key)}</span><span class="rw-t">${esc(f.summary)}</span></button>
              <span class="pill ${statusTone(f.status?.statusCategory?.key, f.status?.name)}">${esc(f.status?.name)}</span>
              <span class="rw-tm ${late ? 'bad-t' : ''}">${due ? esc(due.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })) : '—'}</span>
              <span class="rw-tm">${esc(t.txt)}</span>
              <button class="btn sm ${focus?.key === i.key ? 'pri' : ''}" data-focus="${esc(i.key)}" data-title="${esc(f.summary)}">${focus?.key === i.key ? 'Em foco' : 'Focar'}</button></div>`; }).join('') : '<div class="empty sm"><p>Nada aberto no seu nome neste quadro.</p></div>'}
        </section></div>`;
    } catch (e) { if (s === seq) body.innerHTML = note(e.message, 'err'); }
  }
  function startFocus(k, title) {
    focus = { key: k, title: title || cache.get(k)?.data?.summary || '', start: Date.now() };
    saveFocus(); confirmBox = null;
    if (view === 'focus') renderFocus(); else drawBar();
    refreshDay();
  }
  const jiraStarted = (ms) => { const d = new Date(ms), z = -d.getTimezoneOffset(), p = (n) => String(Math.abs(n)).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00.000${z >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(z) / 60))}${p(Math.abs(z) % 60)}`; };

  /* ---------------- Modo PRs ---------------- */
  async function renderPrs() {
    const s = ++seq;
    body.innerHTML = skeleton();
    const cols = columns().filter((c) => !/pendente|backlog|to do|a fazer/i.test(c.name));
    const keys = [...new Set(cols.flatMap((c) => c.keys))].slice(0, 30);
    const colOf = Object.fromEntries(cols.flatMap((c) => c.keys.map((k) => [k, c.name])));
    const rows = (await mapLimit(keys, 4, (k) => issueData(k))).filter((r) => r && !r.error);
    if (s !== seq || view !== 'prs') return;
    const items = rows.flatMap((r) => r.dev.prs.map((p) => ({ r, p, ok: p.reviewers.filter((x) => x.ok).length })));
    const groups = [
      ['Esperando revisão', 'warn', items.filter((x) => x.p.state === 'OPEN' && !x.ok), 'PRs abertos sem nenhuma aprovação'],
      ['Aprovados, falta o merge', 'data', items.filter((x) => x.p.state === 'OPEN' && x.ok), 'Já aprovados: dá para fazer o merge'],
      ['Merged, mas o card não avançou', 'ok', items.filter((x) => x.p.state === 'MERGED' && /andamento|progress|desenvolv/i.test(x.r.status)), 'O código entrou e o card ainda está em andamento'],
    ];
    const noPr = rows.filter((r) => !r.dev.prs.length && /andamento|progress|feito|pr\b|review/i.test(r.status));
    body.innerHTML = `<div class="list-h"><b>${items.length} ${items.length === 1 ? 'PR' : 'PRs'} em ${rows.length} ${rows.length === 1 ? 'card' : 'cards'} do quadro</b><span class="muted">olhando as colunas depois de Itens Pendentes (até 30 cards)</span></div>
      <div class="groups">${groups.map(([t, tone, list, tip]) => `<section class="grp ${tone}"><h3>${t} <span class="muted">${list.length}</span></h3><p class="muted small">${tip}</p>
        ${list.length ? list.map((x) => `<div class="rw"><button class="rw-main" data-key="${esc(x.r.key)}"><span class="k">${esc(x.r.key)}</span><span class="rw-t">${esc(x.p.title)}</span></button>
          <span class="rw-tm">${esc(colOf[x.r.key] || x.r.status)}</span>
          <span class="revs">${x.p.reviewers.map((v) => `<span class="rev ${v.ok ? 'ok' : ''}" title="${esc(v.name)}">${esc(initials(v.name))}</span>`).join('') || '<span class="muted small">sem revisor</span>'}</span>
          <span class="rw-tm">${esc(ago(x.p.at))}</span>${x.p.url ? `<a class="btn sm" href="${esc(x.p.url)}" target="_blank" rel="noopener">PR ↗</a>` : ''}</div>`).join('') : '<p class="note">Nenhum.</p>'}</section>`).join('')}
        <section class="grp muted"><h3>Em andamento sem PR <span class="muted">${noPr.length}</span></h3><p class="muted small">Pode faltar abrir o PR</p>${noPr.length ? noPr.map((r) => rowHtml(r)).join('') : '<p class="note">Nenhum.</p>'}</section>
      </div>`;
  }

  /* ---------------- Modo Retornos ---------------- */
  async function renderReturns() {
    const s = ++seq;
    body.innerHTML = skeleton();
    try {
      const projects = boardProjects();
      if (!projects.length) { body.innerHTML = note('Nenhum card no quadro para saber o espaço.'); return; }
      const issues = await jql(`project in (${projects.join(',')}) AND updated >= -14d ORDER BY updated DESC`, ['summary', 'status', 'assignee', 'comment'], 80, { expand: 'changelog' });
      if (s !== seq || view !== 'returns') return;
      const ahead = /valida|homolog|deploy|qa\b|teste|feito|pr\b|review|done/i, behind = /reabert|andamento|progress|pendente|a fazer|to do|impedid/i;
      const rows = [];
      for (const i of issues) {
        const tr = (i.changelog?.histories || []).flatMap((h) => (h.items || []).filter((x) => x.field === 'status').map((x) => ({ at: h.created, by: h.author?.displayName || '', from: x.fromString || '', to: x.toString || '' })));
        const back = tr.filter((t) => ahead.test(t.from) && behind.test(t.to) && Date.now() - Date.parse(t.at) < 14 * 864e5).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
        if (!back.length) continue;
        const last = back[0];
        const comments = (i.fields?.comment?.comments || []).filter((c) => Date.parse(c.created) >= Date.parse(last.at) - 6 * 36e5).slice(-1)[0];
        rows.push({ i, last, n: back.length, comment: comments, mine: !!i.fields?.assignee && myKeysHas(i) });
      }
      rows.sort((a, b) => Number(b.mine) - Number(a.mine) || Date.parse(b.last.at) - Date.parse(a.last.at));
      body.innerHTML = `<div class="list-h"><b>${rows.length} ${rows.length === 1 ? 'demanda voltou' : 'demandas voltaram'} nos últimos 14 dias</b><span class="muted">de Validação, Deploy ou Feito para trás · as suas primeiro</span></div>
        <div class="rets">${rows.length ? rows.map((x) => `<article class="ret ${x.mine ? 'mine' : ''}">
          <div class="row"><button class="lnk k" data-key="${esc(x.i.key)}">${esc(x.i.key)}</button><b class="ret-t">${esc(x.i.fields?.summary)}</b>${x.n > 1 ? `<span class="pill err">voltou ${x.n}×</span>` : ''}</div>
          <div class="flow small"><span class="pill muted">${esc(x.last.from)}</span><span class="arr">→</span><span class="pill warn">${esc(x.last.to)}</span><span class="muted">por ${esc(x.last.by)} · ${esc(ago(x.last.at))}</span></div>
          ${x.comment ? `<div class="ret-cm">${avatar(x.comment.author?.displayName || '')}<div class="rich">${adf(x.comment.body)}</div></div>` : '<p class="note">Sem comentário junto do retorno. Vale pedir o motivo ao QA.</p>'}
          <div class="row gap"><button class="btn sm" data-key="${esc(x.i.key)}" data-open-tab="comments">Responder</button><button class="btn sm" data-focus="${esc(x.i.key)}" data-title="${esc(x.i.fields?.summary)}">Focar</button></div>
        </article>`).join('') : '<div class="empty"><b>Nada voltou nos últimos 14 dias</b><p>Quando uma demanda sair de Validação, Deploy ou Feito para trás, ela aparece aqui com o comentário do QA.</p></div>'}</div>`;
    } catch (e) { if (s === seq) body.innerHTML = note(e.message, 'err'); }
  }
  let meId = null;
  const myKeysHas = (i) => (meId ? i.fields.assignee.accountId === meId : false);

  /* ---------------- Modo Daily ---------------- */
  async function renderDaily() {
    const s = ++seq;
    body.innerHTML = skeleton();
    try {
      const fields = ['summary', 'status'];
      const [moved, logged, doing, stuck] = await Promise.all([
        jql('status CHANGED BY currentUser() AFTER startOfDay(-1) ORDER BY updated DESC', fields, 20, { expand: 'changelog' }).catch(() => []),
        jql('worklogAuthor = currentUser() AND worklogDate >= startOfDay(-1) ORDER BY updated DESC', fields, 20).catch(() => []),
        jql('assignee = currentUser() AND statusCategory = "In Progress" ORDER BY priority DESC', fields, 10).catch(() => []),
        jql('assignee = currentUser() AND statusCategory != Done AND status in (Impedido, "Impedido/Aguardando", Aguardando, Bloqueado) ORDER BY updated DESC', fields, 10).catch(() => []),
      ]);
      if (s !== seq || view !== 'daily') return;
      const line = (i) => `${i.key} — ${i.fields?.summary || ''}`;
      const movedTxt = moved.map((i) => {
        const t = (i.changelog?.histories || []).flatMap((h) => (h.items || []).filter((x) => x.field === 'status').map((x) => ({ at: h.created, to: x.toString }))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
        return `${line(i)}${t ? ` (foi para ${t.to})` : ''}`;
      });
      const ontem = [...new Set([...movedTxt, ...logged.filter((i) => !moved.some((m) => m.key === i.key)).map((i) => line(i) + ' (horas apontadas)')])];
      const hoje = doing.filter((i) => !stuck.some((x) => x.key === i.key)).map(line);
      const imp = stuck.map(line);
      const text = `Ontem:\n${ontem.map((l) => '- ' + l).join('\n') || '- nada registrado'}\n\nHoje:\n${hoje.map((l) => '- ' + l).join('\n') || '- a definir'}\n\nImpedimentos:\n${imp.map((l) => '- ' + l).join('\n') || '- nenhum'}`;
      const block = (t, list, tone) => `<section class="dl ${tone}"><h3>${t} <span class="muted">${list.length}</span></h3>${list.length ? `<ul>${list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="note">Nada aqui.</p>'}</section>`;
      body.innerHTML = `<div class="daily"><div class="dls">${block('Ontem', ontem, 'muted')}${block('Hoje', hoje, 'data')}${block('Impedimentos', imp, imp.length ? 'warn' : 'muted')}</div>
        <aside class="dl-out"><b>Texto para a daily</b><textarea class="inp" rows="9" aria-label="Texto da daily">${esc(text)}</textarea><button class="btn sm pri" data-copy-from="textarea">Copiar para o Teams</button><p class="muted small">Ajuste o texto antes de copiar.</p></aside></div>`;
    } catch (e) { if (s === seq) body.innerHTML = note(e.message, 'err'); }
  }

  /* ---------------- Modo Deploy ---------------- */
  function toggleDeploy(k) {
    if (!validKey(k)) return;
    deployList = deployList.includes(k) ? deployList.filter((x) => x !== k) : [...deployList, k];
    saveDeploy(); paintCards(); drawBar();
    if (view === 'deploy') renderDeploy();
    else if (view === 'column' || (view === 'issue' && tab === 'resumo')) render();
  }
  async function renderDeploy() {
    const s = ++seq;
    if (!deployList.length) {
      body.innerHTML = `<div class="empty"><b>Monte a lista do deploy</b><p>Passe o mouse num card e clique na aba <b>+ Deploy</b> na borda dele, ou Shift+clique no card. O QuickFill junta branch e PR de cada demanda e prepara o comando, as notas e o card "Realizando Deploy".</p>
        <button class="btn sm pri" data-action="add-feito">Adicionar tudo de Feito / PR</button></div>`;
      return;
    }
    body.innerHTML = skeleton();
    const rows = await mapLimit(deployList, 4, (k) => issueData(k));
    if (s !== seq || view !== 'deploy') return;
    const ok = rows.filter((r) => !r.error);
    const branches = [...new Set(ok.map((r) => r.branches[0]?.name).filter(Boolean))];
    const warn = ok.filter((r) => readiness(r).tone === 'warn');
    const cmd = branches.length ? ['git fetch origin', ...branches.map((b) => `git merge --no-ff origin/${b}`)].join('\n') : '';
    const notes = ok.map((r) => `- [${r.key}] ${r.summary}`).join('\n');
    body.innerHTML = `<div class="dep">
      <section class="dep-l">
        <div class="list-h"><b>${deployList.length} ${deployList.length === 1 ? 'demanda' : 'demandas'}</b><span class="muted">${branches.length} ${branches.length === 1 ? 'branch' : 'branches'}${warn.length ? ` · <span class="warn-t">${warn.length} pedem atenção</span>` : ' · tudo pronto'}</span><span class="grow"></span><button class="btn sm" data-action="add-feito">+ Tudo de Feito / PR</button><button class="btn sm" data-action="clear-deploy">Limpar</button></div>
        <div class="rows">${rows.map((r) => r.error ? `<div class="rw err"><span class="k">${esc(r.key)}</span><span class="err-t">${esc(r.error)}</span><button class="ic sm" data-toggle-deploy="${esc(r.key)}">✕</button></div>` : rowHtml(r)).join('')}</div>
      </section>
      <aside class="dep-a">
        <h3>Preparar</h3>
        <button class="act" data-copy="${esc(branches.join('\n'))}" ${branches.length ? '' : 'disabled'}><b>Copiar branches</b><span>uma por linha</span></button>
        <button class="act" data-copy="${esc(cmd)}" ${cmd ? '' : 'disabled'}><b>Copiar comando git</b><span>fetch e merge de cada branch</span></button>
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
      if (m === 'issue') { view = 'issue'; folded = false; drawBar(); render(); paintCards(); } else setView(m);
      return;
    }
    if (b.dataset.size) { size = b.dataset.size; try { localStorage.setItem(SIZE, size); } catch { /* sem storage */ } applySize(); folded = false; drawBar(); render(); return; }
    if (b.dataset.col !== undefined) { const c = columns()[Number(b.dataset.col)]; if (c) openColumn(c); return; }
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
    else if (a === 'focus-stop') {
      const min = Math.max(1, Math.round((Date.now() - focus.start) / 60000));
      confirmBox = `<b>Apontar ${esc(formatMinutes(min))} em ${esc(focus.key)}?</b><p>De ${esc(new Date(focus.start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))} até agora.</p><div class="row gap"><button class="btn sm pri" data-action="focus-log">Apontar no Jira</button><button class="btn sm" data-action="cancel">Continuar focando</button></div>`;
      renderFocus();
    }
    else if (a === 'focus-log') {
      const f = focus, min = Math.max(1, Math.round((Date.now() - f.start) / 60000));
      try {
        await api(`issue/${f.key}/worklog?adjustEstimate=auto`, { method: 'POST', body: JSON.stringify({ timeSpentSeconds: min * 60, started: jiraStarted(f.start) }) });
        focus = null; saveFocus(); cache.delete(f.key);
        confirmBox = null; renderFocus(); refreshDay(); drawBar();
      } catch (err) { confirmBox = `<b>Não deu para apontar</b><p>${esc(err.message)}</p><button class="btn sm" data-action="cancel">Voltar</button>`; renderFocus(); }
    }
    else if (a === 'focus-cancel') { focus = null; saveFocus(); confirmBox = null; renderFocus(); refreshDay(); drawBar(); }
    if (b.dataset.tab) { tab = b.dataset.tab; drawBar(); render(); tabsEl.querySelector('.on')?.focus({ preventScroll: true }); }
    if (b.dataset.copy !== undefined) copy(b.dataset.copy, b);
    if (b.dataset.copyFrom) copy(body.querySelector(b.dataset.copyFrom)?.value || '', b);
    if (b.dataset.toggleDeploy) toggleDeploy(b.dataset.toggleDeploy);
    if (b.dataset.focus) startFocus(b.dataset.focus, b.dataset.title);
    if (b.dataset.key) { if (b.dataset.openTab) tab = b.dataset.openTab; const t = tab; await openIssue(b.dataset.key); if (b.dataset.openTab) { tab = t; drawBar(); render(); } }
  });

  // Altura livre: arrastar a borda de cima da barra
  $('.grip').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = body.getBoundingClientRect().height || 300;
    const move = (ev) => { applySize(Math.max(160, Math.min(innerHeight * 0.75, h0 + (y0 - ev.clientY)))); reserveBoard(); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
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
      api('myself').then((m) => { meId = m.accountId; }).catch(() => {});
    } else {
      seq++; daySeq++;
      key = ''; current = null; colView = null; expandedDay = false; folded = true; view = 'issue'; confirmBox = null; myKeys = null;
      day.classList.remove('expanded'); day.replaceChildren(); body.replaceChildren(); colBox.replaceChildren();
      hideTab(); releaseBoard(); paintCards();
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
    const c = body.querySelector('.clock[data-since]');
    if (c) c.textContent = formatMinutes(Math.max(1, Math.round((Date.now() - Number(c.dataset.since)) / 60000)));
  }
  function sync() {
    const path = location.pathname, allowed = boardRoute();
    if (path !== route || launch.hidden === allowed) {
      route = path; enable(false); launch.hidden = !allowed;
      if (allowed && sessionOn) enable(true);
    }
    if (!active) return;
    const dialog = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some((el) => el.getClientRects().length && !host.contains(el));
    dock.hidden = day.hidden = dialog;
    colBox.hidden = dialog;
    if (dialog) hideTab();
    geometry(); reserveBoard(); paintCards(); tick();
    if (!document.hidden && !expandedDay && Date.now() - refreshedAt > 60000) refreshDay();
  }
  new ResizeObserver(() => { reserveBoard(); placeColButtons(); }).observe(dock);
  addEventListener('resize', geometry, { passive: true });
  addEventListener('scroll', () => { placeTab(); placeColButtons(); }, { passive: true, capture: true });
  sync();
  setInterval(sync, 1200);
})().catch((error) => console.warn('QuickFill DEV: não foi possível abrir o DashFill.', error));
