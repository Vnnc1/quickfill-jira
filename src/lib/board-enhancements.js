import { ROLE } from './role.js';
import { ROLE_ACCENT, applyAccent } from './theme.js';
import {
  normalize,
  priorityTone,
  allowedColumns,
  issueKey,
  formatMinutes,
  timeSummary,
  isOverdue,
  extractLinks,
} from './board-rules.js';
import { mountPortableTimeline } from './board-timeline.js';

const CARD_STYLE_CSS = `
  .qf-card-panel {
    margin-top: 6px;
    padding: 5px 6px 4px;
    border-top: 1px solid rgba(130, 148, 168, 0.22);
    border-radius: 0 0 6px 6px;
    font: 11px/1.38 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
    color: var(--ds-text-subtle, #9fadbc);
    display: flex;
    flex-direction: column;
    gap: 4px;
    pointer-events: none;
  }
  .qf-card-time {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .qf-card-time-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }
  .qf-card-time-row b {
    color: var(--ds-text, #dee4ea);
    font-weight: 650;
  }
  .qf-card-time-over {
    color: #f87168;
    font-weight: 700;
    background: rgba(248, 113, 104, 0.14);
    border: 1px solid rgba(248, 113, 104, 0.34);
    border-radius: 99px;
    padding: 0 6px;
    font-size: 10px;
  }
  .qf-card-bar {
    height: 4px;
    border-radius: 99px;
    background: rgba(130, 148, 168, 0.2);
    overflow: hidden;
  }
  .qf-card-bar i {
    display: block;
    height: 100%;
    border-radius: 99px;
    background: #4bce97;
  }
  .qf-card-bar i.near { background: #f5cd47; }
  .qf-card-bar i.over { background: #f87168; }
  .qf-card-chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  .qf-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1.5px 6px;
    border-radius: 5px;
    font-size: 10.5px;
    font-weight: 600;
    line-height: 1.35;
    border: 1px solid rgba(130, 148, 168, 0.24);
    background: rgba(130, 148, 168, 0.1);
    color: var(--ds-text-subtle, #b6c2cf);
  }
  .qf-chip.critical { background: rgba(248, 113, 104, 0.15); border-color: rgba(248, 113, 104, 0.4); color: #ff9e96; }
  .qf-chip.high { background: rgba(250, 165, 61, 0.14); border-color: rgba(250, 165, 61, 0.38); color: #fbc174; }
  .qf-chip.low { background: rgba(133, 184, 255, 0.12); border-color: rgba(133, 184, 255, 0.32); color: #9ec5ff; }
  .qf-chip.overdue { background: rgba(248, 113, 104, 0.16); border-color: rgba(248, 113, 104, 0.42); color: #ff9c94; }
  .qf-chip.conf { background: rgba(87, 157, 255, 0.14); border-color: rgba(87, 157, 255, 0.36); color: #85b8ff; }
  .qf-chip.figma { background: rgba(231, 116, 187, 0.14); border-color: rgba(231, 116, 187, 0.38); color: #f49fd3; }
  .qf-chip.blocked { background: rgba(248, 113, 104, 0.18); border-color: rgba(248, 113, 104, 0.45); color: #ff8f87; }
  .qf-chip.link { background: rgba(159, 143, 239, 0.14); border-color: rgba(159, 143, 239, 0.34); color: #c4b5fd; }
  .qf-card-detail-row {
    font-size: 10.5px;
    color: var(--ds-text-subtle, #9fadbc);
    padding-top: 4px;
    border-top: 1px dashed rgba(130, 148, 168, 0.18);
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .qf-card-dim {
    opacity: 0.22 !important;
    filter: grayscale(0.55) !important;
    transition: opacity 0.16s ease, filter 0.16s ease !important;
  }
  .qf-card-match {
    outline: 1.5px solid rgba(75, 206, 151, 0.55) !important;
    outline-offset: 1px !important;
    transition: opacity 0.16s ease, outline-color 0.16s ease !important;
  }
`;

export function mountBoardEnhancements({ host, root, isEnabled, findCard, closePopover, onMetaToggleSync }) {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plain = v => typeof v === 'string' ? v : [v?.text, ...(v?.content || []).map(plain)].filter(Boolean).join(' ');
  const hours = v => v == null ? 'Não informado' : formatMinutes(Math.round(v / 60));
  const adf = text => ({ type: 'doc', version: 1, content: text.split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) });
  const visible = node => node.isConnected && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  const railColors = { critical: '#f87168', high: '#faa53d', low: '#85b8ff', normal: '' };

  // Aplica a cor do perfil atual no host do Shadow DOM
  const roleAccent = ROLE_ACCENT[ROLE] || ROLE_ACCENT.dev;
  applyAccent(roleAccent, host);
  host.style.setProperty('--qf-accent', roleAccent);

  const cache = new Map();
  const decorations = new Map();
  const scannedNodes = new Map();
  let myself = null;
  let generation = 0;
  let signature = '';
  let detailed = false;
  let peopleOpen = false;
  let hudCollapsed = false;
  let activeFilter = 'all'; // all | mine | overrun | overdue | docs | figma | person:<id>
  let boardBusy = false;
  let lastRows = [];

  let panelHost, panel, selected = null, collapsed = false, saving = false, detailGeneration = 0;
  let pointer, drag, dragGeneration = 0, heldTimer, lastActive = false, lastRoute = location.href, nativeDragging = false;

  const guides = document.createElement('div');
  guides.className = 'qf-guides';
  root.append(guides);

  const hud = document.createElement('div');
  hud.className = 'qf-board-hud';
  hud.hidden = true;

  // Injeta a barra do QuickFill dentro do fluxo nativo acima das colunas do quadro (em Shadow DOM!)
  // evitando cobrir cabeçalho/abas do Jira; cai em dock inferior se o container não existir.
  let hudHost = null;
  let hudShadow = null;
  function attachHudHost(items = []) {
    const board = items[0]?.node?.closest('[data-testid*="board-container"],[data-testid*="board.area"],[data-testid*="board-content"]')
      || document.querySelector('[data-testid*="board-container"],[data-testid*="board.area"],[data-testid*="board-content"]');
    if (board && board.parentNode) {
      if (!hudHost || !hudHost.isConnected || hudHost.nextElementSibling !== board) {
        hudHost?.remove();
        hudHost = document.createElement('div');
        hudHost.dataset.qfOwned = 'hud';
        hudHost.style.cssText = 'display:block;padding:0 18px 8px;flex:none;min-width:0;';
        hudShadow = hudHost.attachShadow({ mode: 'open' });
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = chrome.runtime.getURL('board-mode.css');
        hudShadow.append(link, hud);
        hud.classList.add('is-inline');
        board.before(hudHost);
      }
      hudHost.dataset.theme = host.dataset.theme || 'dark';
      hudHost.style.setProperty('--qf-accent', roleAccent);
      return;
    }
    hud.classList.remove('is-inline');
    if (hud.parentNode !== root) root.append(hud);
  }
  root.append(hud);

  const peoplePopover = document.createElement('section');
  peoplePopover.className = 'qf-people-pop';
  peoplePopover.setAttribute('aria-label', 'Demandas por responsável');
  peoplePopover.hidden = true;
  root.append(peoplePopover);

  let cardStyleEl = null;
  function ensureCardStyle() {
    if (cardStyleEl?.isConnected) return;
    cardStyleEl = document.createElement('style');
    cardStyleEl.dataset.qfOwned = 'card-style';
    cardStyleEl.textContent = CARD_STYLE_CSS;
    document.head.append(cardStyleEl);
  }
  function removeCardStyle() {
    cardStyleEl?.remove();
    cardStyleEl = null;
  }

  async function json(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        ...options,
        signal: controller.signal,
        headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : null; } catch { throw Error('Resposta inválida do Jira. Confira sua sessão.'); }
      if (!response.ok) throw Error(data?.errorMessages?.join(' ') || Object.values(data?.errors || {}).join(' ') || `Jira: HTTP ${response.status}`);
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw Error(options.method ? 'Sem confirmação da gravação. Confira a tarefa antes de repetir.' : 'O Jira demorou para responder. Tente novamente.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  const request = (key, path = '', options) => json(`/rest/api/3/issue/${encodeURIComponent(key)}${path}`, options);
  const write = (key, path, body) => request(key, path, { method: 'POST', body: JSON.stringify(body) });

  async function loadMyself() {
    if (myself) return myself;
    try { myself = await json('/rest/api/3/myself'); } catch { myself = null; }
    return myself;
  }

  async function fetchIssueBundle(key, { force = false } = {}) {
    const cached = cache.get(key);
    if (!force && cached && Date.now() - cached.at < 45000) return cached.data;
    const fields = 'summary,assignee,priority,duedate,status,timetracking,issuelinks,subtasks,comment,labels,description';
    const [issue, remoteLinks] = await Promise.all([
      request(key, `?fields=${fields}`),
      request(key, '/remotelink').catch(() => []),
    ]);
    const links = extractLinks(issue, remoteLinks);
    const time = timeSummary(issue?.fields?.timetracking);
    const due = isOverdue(issue?.fields?.duedate, issue?.fields?.status?.statusCategory?.key);
    const bundle = { issue, remoteLinks, links, time, due };
    cache.set(key, { at: Date.now(), data: bundle });
    return bundle;
  }

  // Modal portátil "Meta + Linha do Tempo" (independente, arrastável e fixável)
  const timelineHud = mountPortableTimeline({
    root,
    getBoardCards: () => lastRows.map(r => ({ key: r.item.key, title: r.data.issue?.fields?.summary || '' })),
    onWorklogSaved: (key) => {
      cache.delete(key);
      signature = '';
      if (selected === key) loadDetails();
    },
    onOpenIssue: (key) => {
      const targetNode = scannedNodes.get(key);
      if (targetNode?.isConnected) {
        targetNode.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        targetNode.classList.add('qf-card-match');
        setTimeout(() => applyCardFilters(), 1400);
      } else {
        window.open(`/browse/${encodeURIComponent(key)}`, '_blank', 'noopener');
      }
    },
    onToggleChange: (open) => {
      onMetaToggleSync?.(open);
      renderBoardHud();
    },
  });

  function cards() {
    const found = new Map();
    for (const node of document.querySelectorAll('[data-issue-key],[data-testid*="card"],[data-rbd-draggable-id],article')) {
      if (node.closest('[data-qf-owned]') || !visible(node)) continue;
      const item = findCard(node);
      if (item && !item.node.closest('[role="dialog"]') && !found.has(item.key)) found.set(item.key, item);
    }
    return [...found.values()];
  }

  function clearBoard() {
    generation++;
    signature = '';
    lastRows = [];
    hud.hidden = true;
    hudHost?.remove();
    hudHost = hudShadow = null;
    peoplePopover.hidden = true;
    peopleOpen = false;
    for (const [node, old] of decorations) {
      node.style.boxShadow = old.shadow;
      node.classList.remove('qf-card-dim', 'qf-card-match');
      old.badge.remove();
    }
    decorations.clear();
    scannedNodes.clear();
    removeCardStyle();
  }

  function matchesFilter(row) {
    if (activeFilter === 'all') return true;
    const f = row.data.issue?.fields || {};
    if (activeFilter === 'mine') return Boolean(myself?.accountId && f.assignee?.accountId === myself.accountId);
    if (activeFilter === 'overrun') return row.data.time.hasOverrun;
    if (activeFilter === 'overdue') return row.data.due.overdue;
    if (activeFilter === 'docs') return row.data.links.confluence.length > 0;
    if (activeFilter === 'figma') return row.data.links.figma.length > 0;
    if (activeFilter.startsWith('person:')) {
      const pid = activeFilter.slice(7);
      return (f.assignee?.accountId || 'unassigned') === pid;
    }
    return true;
  }

  function applyCardFilters() {
    for (const row of lastRows) {
      const node = row.item.node;
      if (!node?.isConnected) continue;
      if (activeFilter === 'all') {
        node.classList.remove('qf-card-dim', 'qf-card-match');
      } else {
        const hit = matchesFilter(row);
        node.classList.toggle('qf-card-dim', !hit);
        node.classList.toggle('qf-card-match', hit);
      }
    }
  }

  function decorate(item, bundle) {
    ensureCardStyle();
    const { issue, links, time, due } = bundle;
    const f = issue.fields || {};
    const tone = priorityTone(f.priority?.name);
    const old = decorations.get(item.node);
    if (old) {
      old.badge.remove();
      item.node.style.boxShadow = old.shadow;
    }

    const panelEl = document.createElement('div');
    panelEl.className = 'qf-card-panel';
    panelEl.dataset.qfOwned = 'badge';

    const parts = [];

    // 1. Barra de Tempo / Estimativa / Excedente
    if (time.hasTime) {
      const barCls = time.hasOverrun ? 'over' : time.percent >= 85 ? 'near' : '';
      const label = time.estimateMin > 0
        ? `<span>⏱ <b>${formatMinutes(time.spentMin)}</b> / ${formatMinutes(time.estimateMin)}</span>`
        : `<span>⏱ <b>${formatMinutes(time.spentMin)}</b> apontado</span>`;
      const right = time.hasOverrun
        ? `<span class="qf-card-time-over">+${formatMinutes(time.overrunMin)} exc.</span>`
        : (time.estimateMin > 0 ? `<span>${time.percent}%</span>` : '');
      parts.push(`
        <div class="qf-card-time">
          <div class="qf-card-time-row">${label}${right}</div>
          <div class="qf-card-bar"><i class="${barCls}" style="width:${time.hasOverrun ? 100 : time.percent}%"></i></div>
        </div>
      `);
    }

    // 2. Chips limpos de sinais (Prioridade notável, Prazo vencido, Confluence, Figma, Bloqueios/Vínculos, Subtarefas, Comentários)
    const chips = [];
    if (tone === 'critical') chips.push(`<span class="qf-chip critical">▲ ${esc(f.priority?.name || 'Crítica')}</span>`);
    else if (tone === 'high') chips.push(`<span class="qf-chip high">▲ ${esc(f.priority?.name || 'Alta')}</span>`);
    else if (tone === 'low') chips.push(`<span class="qf-chip low">↓ ${esc(f.priority?.name || 'Baixa')}</span>`);

    if (due.overdue) chips.push(`<span class="qf-chip overdue">⚠ Vencida ${due.daysLate}d</span>`);
    if (links.blockedBy > 0) chips.push(`<span class="qf-chip blocked">🚫 Bloq. (${links.blockedBy})</span>`);
    if (links.confluence.length > 0) chips.push(`<span class="qf-chip conf">📘 Docs${links.confluence.length > 1 ? ` (${links.confluence.length})` : ''}</span>`);
    if (links.figma.length > 0) chips.push(`<span class="qf-chip figma">🎨 Figma${links.figma.length > 1 ? ` (${links.figma.length})` : ''}</span>`);
    if (links.issueLinks.length > 0 && links.blockedBy === 0) chips.push(`<span class="qf-chip link">🔗 ${links.issueLinks.length}</span>`);

    const subs = f.subtasks || [];
    if (subs.length > 0) {
      const doneSubs = subs.filter(s => s.fields?.status?.statusCategory?.key === 'done').length;
      chips.push(`<span class="qf-chip">☑ ${doneSubs}/${subs.length}</span>`);
    }
    const commentsCount = f.comment?.total || f.comment?.comments?.length || 0;
    if (commentsCount > 0) chips.push(`<span class="qf-chip">💬 ${commentsCount}</span>`);

    if (chips.length) {
      parts.push(`<div class="qf-card-chips">${chips.join('')}</div>`);
    }

    // 3. Linha detalhada opcional (Responsável, Etapa, Prazo, Restante)
    if (detailed) {
      const remTxt = time.remainingMin != null ? `Restante: ${formatMinutes(time.remainingMin)}` : '';
      const dueTxt = f.duedate ? `Prazo: ${f.duedate}` : '';
      parts.push(`
        <div class="qf-card-detail-row">
          <span>👤 ${esc(f.assignee?.displayName || 'Sem responsável')}</span>
          <span>· ${esc(f.status?.name || 'Sem etapa')}</span>
          ${dueTxt ? `<span>· ${esc(dueTxt)}</span>` : ''}
          ${remTxt ? `<span>· ${esc(remTxt)}</span>` : ''}
        </div>
      `);
    }

    // Só injeta o bloco no card se houver alguma informação útil a acrescentar (evita poluir com "= Medium")
    if (!parts.length) {
      decorations.set(item.node, { shadow: item.node.style.boxShadow, badge: panelEl });
      return;
    }

    panelEl.innerHTML = parts.join('');
    decorations.set(item.node, { shadow: item.node.style.boxShadow, badge: panelEl });
    const rail = time.hasOverrun ? '#f87168' : railColors[tone];
    if (rail) item.node.style.boxShadow = `inset 3px 0 ${rail}`;
    item.node.append(panelEl);
  }

  function renderPeoplePopover() {
    if (!peopleOpen || !isEnabled()) {
      peoplePopover.hidden = true;
      return;
    }
    const groups = new Map();
    for (const row of lastRows) {
      const person = row.data.issue?.fields?.assignee;
      const id = person?.accountId || 'unassigned';
      if (!groups.has(id)) {
        groups.set(id, { id, name: person?.displayName || 'Sem responsável', rows: [], spentMin: 0, overdue: 0, overrun: 0 });
      }
      const g = groups.get(id);
      g.rows.push(row);
      g.spentMin += row.data.time.spentMin;
      if (row.data.due.overdue) g.overdue++;
      if (row.data.time.hasOverrun) g.overrun++;
    }

    const sorted = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length);
    peoplePopover.innerHTML = `
      <header class="qf-pp-head">
        <strong>👥 Equipe neste recorte (${lastRows.length})</strong>
        <button type="button" data-hud-act="close-people" aria-label="Fechar">✕</button>
      </header>
      <div class="qf-pp-list">
        ${sorted.map(g => {
          const isSel = activeFilter === `person:${g.id}`;
          return `
            <div class="qf-pp-row ${isSel ? 'active' : ''}">
              <button type="button" class="qf-pp-main" data-filter="person:${esc(g.id)}">
                <div class="qf-pp-top">
                  <b>${esc(g.name)}</b>
                  <span class="mono">${g.rows.length} ${g.rows.length === 1 ? 'card' : 'cards'} · ${formatMinutes(g.spentMin)}</span>
                </div>
                <div class="qf-pp-sub">
                  ${g.overrun ? `<span class="err">⚠ ${g.overrun} exc.</span>` : ''}
                  ${g.overdue ? `<span class="warn">🔥 ${g.overdue} venc.</span>` : ''}
                  <span>${isSel ? 'Clique para mostrar todos' : 'Clique para destacar no quadro'}</span>
                </div>
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
    peoplePopover.hidden = false;
  }

  function renderBoardHud() {
    if (!isEnabled() || selected) {
      hud.hidden = true;
      peoplePopover.hidden = true;
      return;
    }

    const total = lastRows.length;
    const mine = lastRows.filter(r => myself?.accountId && r.data.issue?.fields?.assignee?.accountId === myself.accountId).length;
    const overrun = lastRows.filter(r => r.data.time.hasOverrun).length;
    const overdue = lastRows.filter(r => r.data.due.overdue).length;
    const docs = lastRows.filter(r => r.data.links.confluence.length > 0).length;
    const figma = lastRows.filter(r => r.data.links.figma.length > 0).length;
    const metaOpen = timelineHud.isOpen();

    if (hudCollapsed) {
      hud.innerHTML = `
        <div class="qf-hud-pill-collapsed">
          <button type="button" data-hud-act="expand-hud">⚡ QuickFill · ${esc(ROLE.toUpperCase())} (${total}) ▾</button>
          <button type="button" class="${metaOpen ? 'on' : ''}" data-hud-act="toggle-meta">🎯 Meta+Linha</button>
        </div>
      `;
      hud.hidden = false;
      return;
    }

    const chip = (id, label, count, tone = '') => `
      <button type="button" class="qf-hchip ${tone} ${activeFilter === id ? 'on' : ''}" data-filter="${id}">
        ${label}${count != null ? ` <span>${count}</span>` : ''}
      </button>
    `;

    hud.innerHTML = `
      <div class="qf-hud-bar">
        <span class="qf-hud-brand">⚡ <b>${esc(ROLE.toUpperCase())}</b>${boardBusy ? ' <small>lendo…</small>' : ''}</span>
        <div class="qf-hud-filters">
          ${chip('all', 'Todos', total)}
          ${myself ? chip('mine', 'Minhas', mine) : ''}
          ${chip('overrun', '⏱ Excedentes', overrun, overrun ? 'err' : '')}
          ${chip('overdue', '⚠ Vencidas', overdue, overdue ? 'warn' : '')}
          ${chip('docs', '📘 Docs', docs, docs ? 'blue' : '')}
          ${chip('figma', '🎨 Figma', figma, figma ? 'pink' : '')}
        </div>
        <div class="qf-hud-sep"></div>
        <div class="qf-hud-ctrls">
          <button type="button" class="qf-hbtn ${detailed ? 'on' : ''}" data-hud-act="details" title="Mostrar ou resumir detalhes nos cards">${detailed ? 'Resumir' : 'Detalhar'}</button>
          <button type="button" class="qf-hbtn ${peopleOpen ? 'on' : ''}" data-hud-act="people" title="Destacar cards por responsável">👥 Pessoas</button>
          <button type="button" class="qf-hbtn accent ${metaOpen ? 'on' : ''}" data-hud-act="toggle-meta" title="Abrir modal portátil com Meta e Linha do Tempo">🎯 Meta+Linha</button>
          <button type="button" class="qf-hbtn icon" data-hud-act="refresh" title="Atualizar dados dos cards">↻</button>
          <button type="button" class="qf-hbtn icon" data-hud-act="collapse-hud" title="Recolher barra">▴</button>
        </div>
      </div>
    `;
    hud.hidden = false;
    renderPeoplePopover();
  }

  hud.addEventListener('click', (e) => {
    const flt = e.target.closest('[data-filter]');
    if (flt) {
      const next = flt.dataset.filter;
      activeFilter = activeFilter === next && next !== 'all' ? 'all' : next;
      applyCardFilters();
      renderBoardHud();
      return;
    }
    const btn = e.target.closest('[data-hud-act]');
    if (!btn) return;
    const act = btn.dataset.hudAct;
    if (act === 'details') {
      detailed = !detailed;
      for (const row of lastRows) if (visible(row.item.node)) decorate(row.item, row.data);
      applyCardFilters();
      renderBoardHud();
    } else if (act === 'people') {
      peopleOpen = !peopleOpen;
      renderBoardHud();
    } else if (act === 'toggle-meta') {
      timelineHud.toggle();
    } else if (act === 'refresh') {
      cache.clear();
      signature = '';
    } else if (act === 'collapse-hud') {
      hudCollapsed = true;
      peopleOpen = false;
      renderBoardHud();
    } else if (act === 'expand-hud') {
      hudCollapsed = false;
      renderBoardHud();
    }
  });

  peoplePopover.addEventListener('click', (e) => {
    if (e.target.closest('[data-hud-act="close-people"]')) {
      peopleOpen = false;
      renderBoardHud();
      return;
    }
    const flt = e.target.closest('[data-filter]');
    if (flt) {
      const next = flt.dataset.filter;
      activeFilter = activeFilter === next ? 'all' : next;
      applyCardFilters();
      renderBoardHud();
    }
  });

  async function enrich(items) {
    clearBoard();
    const current = generation;
    boardBusy = true;
    attachHudHost(items);
    renderBoardHud();
    await loadMyself();

    const results = [];
    const queue = [...items];
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length && current === generation && isEnabled()) {
        const item = queue.shift();
        try {
          const data = await fetchIssueBundle(item.key);
          if (current !== generation || !isEnabled()) return;
          if (visible(item.node)) {
            decorate(item, data);
            results.push({ item, data });
          }
        } catch {
          /* contagem parcial reportada no HUD */
        }
      }
    }));

    boardBusy = false;
    if (current !== generation) return;
    lastRows = results;
    signature = items.map(i => i.key).join('|');
    for (const item of items) scannedNodes.set(item.key, item.node);
    applyCardFilters();
    renderBoardHud();
  }

  /* ---------- Painel acoplado na visão nativa da demanda (Modal ou /browse/KEY) ---------- */

  function nativeContext() {
    const dialog = [...document.querySelectorAll('[role="dialog"],[data-testid*="issue-detail"]')].filter(visible).find(n => n.querySelector('[data-testid*="issue.views"],a[href*="/browse/"]'));
    const key = issueKey(location.href) || dialog?.textContent.match(/\b[A-Z][A-Z0-9_]*-\d+\b/)?.[0];
    if (!key) return null;
    const context = [...(dialog || document).querySelectorAll('[data-testid*="context.context-items"],[data-testid*="issue-layout.right"],[data-testid="native-issue-context"]')].find(visible);
    return { key, context, dialog };
  }

  function removePanel() {
    detailGeneration++;
    panelHost?.remove();
    panelHost = panel = null;
    selected = null;
    host.removeAttribute('data-qf-detail');
    renderBoardHud();
  }

  function createPanel(info) {
    removePanel();
    selected = info.key;
    collapsed = false;
    closePopover();
    host.dataset.qfDetail = 'true';
    hud.hidden = true;
    peoplePopover.hidden = true;

    panelHost = document.createElement('aside');
    panelHost.dataset.qfOwned = 'issue';
    panelHost.style.cssText = info.context
      ? 'display:block;margin:0 0 16px;width:100%;min-width:0;'
      : 'position:fixed;right:20px;top:110px;width:min(340px,calc(100vw - 40px));z-index:2147483643;';
    panel = panelHost.attachShadow({ mode: 'open' });
    panel.innerHTML = `
      <link rel="stylesheet" href="${chrome.runtime.getURL('board-detail.css')}">
      <section aria-label="QuickFill: ações da demanda">
        <header>
          <div><strong>⚡ QuickFill <small>${esc(info.key)}</small></strong></div>
          <div class="head-acts">
            <button data-do="meta" title="Abrir Meta + Linha do Tempo">🎯 Meta</button>
            <button data-do="collapse" aria-label="Recolher ações rápidas" aria-expanded="true">−</button>
          </div>
        </header>
        <div class="body">
          <div class="facts" role="status">Carregando demanda…</div>
          <div class="links-box"></div>
          <nav>
            <button data-do="move" class="pri">Mover →</button>
            <button data-do="hours">⏱ Horas</button>
            <button data-do="comment">💬 Comentar</button>
            <button data-do="copy">🔗 Copiar</button>
            <button data-do="refresh" title="Atualizar">↻</button>
          </nav>
          <div class="editor"></div>
          <div class="feedback" role="status"></div>
          <details><summary>Atividade recente</summary><div class="activity"></div></details>
        </div>
      </section>
    `;
    (info.context || document.body).prepend(panelHost);
    panel.addEventListener('click', handlePanelClick);
    panel.addEventListener('submit', handleSubmit);
    loadDetails();
  }

  async function loadDetails() {
    const key = selected;
    const current = ++detailGeneration;
    if (!panel) return;
    panel.querySelector('.feedback').textContent = 'Atualizando…';
    const results = await Promise.allSettled([
      fetchIssueBundle(key, { force: true }),
      request(key, '/comment?orderBy=-created&maxResults=5'),
      request(key, '/changelog?maxResults=1').then(data => request(key, `/changelog?startAt=${Math.max(0, (data.total || 0) - 5)}&maxResults=5`)),
    ]);
    if (current !== detailGeneration || selected !== key || !panel) return;
    if (results[0].status === 'rejected') {
      panel.querySelector('.feedback').textContent = results[0].reason.message;
      return;
    }

    const { issue, links, time, due } = results[0].value;
    const f = issue.fields || {};
    const comments = results[1].value?.comments || [];
    const history = results[2].value?.values || [];
    const barCls = time.hasOverrun ? 'over' : time.percent >= 85 ? 'near' : '';

    panel.querySelector('.facts').innerHTML = `
      <p class="summary">${esc(f.summary)}</p>
      ${time.hasTime ? `
        <div class="time-card">
          <div class="time-row">
            <span>Executado <b>${formatMinutes(time.spentMin)}</b> ${time.estimateMin ? `/ Est. ${formatMinutes(time.estimateMin)}` : ''}</span>
            ${time.hasOverrun ? `<span class="over-pill">+${formatMinutes(time.overrunMin)} excedente</span>` : (time.estimateMin ? `<span>${time.percent}%</span>` : '')}
          </div>
          <div class="bar"><i class="${barCls}" style="width:${time.hasOverrun ? 100 : time.percent}%"></i></div>
        </div>
      ` : ''}
      <dl>
        <dt>Etapa</dt><dd>${esc(f.status?.name)}</dd>
        <dt>Responsável</dt><dd>${esc(f.assignee?.displayName || 'Sem responsável')}</dd>
        <dt>Prioridade</dt><dd class="${priorityTone(f.priority?.name)}">${esc(f.priority?.name || 'Não informada')}</dd>
        <dt>Prazo</dt><dd class="${due.overdue ? 'critical' : ''}">${esc(f.duedate || 'Não definido')}${due.overdue ? ` (vencida há ${due.daysLate}d)` : ''}</dd>
        <dt>Restante</dt><dd>${hours(f.timetracking?.remainingEstimateSeconds)}</dd>
      </dl>
    `;

    const linkItems = [];
    for (const c of links.confluence) linkItems.push(`<a class="link-pill conf" href="${esc(c.url)}" target="_blank" rel="noopener">📘 ${esc(c.title)}</a>`);
    for (const fg of links.figma) linkItems.push(`<a class="link-pill figma" href="${esc(fg.url)}" target="_blank" rel="noopener">🎨 ${esc(fg.title)}</a>`);
    for (const il of links.issueLinks.slice(0, 4)) linkItems.push(`<a class="link-pill ${il.isBlocker && !il.done ? 'blocked' : 'rel'}" href="/browse/${encodeURIComponent(il.key)}" target="_blank" rel="noopener">${il.isBlocker && !il.done ? '🚫' : '🔗'} ${esc(il.key)} · ${esc(il.relation)}</a>`);
    panel.querySelector('.links-box').innerHTML = linkItems.length ? `<div class="links-wrap">${linkItems.join('')}</div>` : '';

    const events = [
      ...comments.map(c => ({ date: c.created, text: `${c.author?.displayName || 'Usuário'}: ${plain(c.body)}` })),
      ...history.map(h => ({ date: h.created, text: `${h.author?.displayName || 'Usuário'}: ${(h.items || []).map(i => `${i.field}: ${i.fromString || '—'} → ${i.toString || '—'}`).join('; ')}` })),
    ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 8);
    panel.querySelector('.activity').innerHTML = events.map(e => `<article><small>${esc(new Date(e.date).toLocaleString('pt-BR'))}</small><p>${esc(e.text)}</p></article>`).join('') || '<p>Nenhuma atividade disponível.</p>';
    panel.querySelector('.feedback').textContent = results.some(r => r.status === 'rejected') ? 'Algumas atividades não puderam ser consultadas.' : '';
  }

  async function handlePanelClick(event) {
    const quickDur = event.target.closest('[data-quick-min]');
    if (quickDur && panel) {
      const inp = panel.querySelector('input[name="minutes"]');
      if (inp) inp.value = quickDur.dataset.quickMin;
      return;
    }
    const button = event.target.closest('button');
    if (!button || saving) return;
    const action = button.dataset.do;
    const key = selected;
    const current = detailGeneration;
    const target = panel;
    if (action === 'meta') { timelineHud.openLogFor(key); return; }
    if (action === 'collapse') {
      collapsed = !collapsed;
      panel.querySelector('.body').hidden = collapsed;
      button.textContent = collapsed ? '+' : '−';
      button.setAttribute('aria-expanded', String(!collapsed));
      return;
    }
    if (action === 'refresh') return loadDetails();
    if (action === 'copy') {
      try {
        await navigator.clipboard.writeText(`${location.origin}/browse/${key}`);
        if (panel === target) panel.querySelector('.feedback').textContent = 'Link copiado.';
      } catch {
        if (panel === target) panel.querySelector('.feedback').textContent = 'Não foi possível copiar o link.';
      }
      return;
    }
    const editor = panel.querySelector('.editor');
    if (action === 'cancel') { editor.replaceChildren(); return; }
    if (action === 'comment') editor.innerHTML = '<form data-kind="comment"><label>Comentário<textarea name="comment" required maxlength="10000"></textarea></label><div class="form-btns"><button class="pri">Publicar no Jira</button><button type="button" data-do="cancel">Cancelar</button></div></form>';
    if (action === 'hours') {
      editor.innerHTML = `
        <form data-kind="hours">
          <div class="dur-chips">
            <button type="button" data-quick-min="15">15m</button>
            <button type="button" data-quick-min="30">30m</button>
            <button type="button" data-quick-min="60">1h</button>
            <button type="button" data-quick-min="120">2h</button>
          </div>
          <label>Tempo em minutos<input name="minutes" type="number" min="1" max="1440" value="30" required></label>
          <label>Início<input name="started" type="datetime-local" required></label>
          <label>Descrição<textarea name="comment" maxlength="2000" placeholder="O que foi feito?"></textarea></label>
          <div class="form-btns"><button class="pri">Registrar no Jira</button><button type="button" data-do="cancel">Cancelar</button></div>
        </form>
      `;
      editor.querySelector('[name=started]').value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
    if (action === 'move') {
      editor.textContent = 'Consultando destinos permitidos…';
      try {
        const data = await request(key, '/transitions?expand=transitions.fields');
        if (current !== detailGeneration || panel !== target) return;
        editor.replaceChildren();
        for (const transition of data.transitions || []) {
          const btn = document.createElement('button');
          btn.textContent = `${transition.name} → ${transition.to?.name || ''}`;
          btn.addEventListener('click', () => move(key, transition));
          editor.append(btn);
        }
        if (!data.transitions?.length) editor.textContent = 'Nenhuma transição disponível para sua conta.';
      } catch (error) {
        if (panel === target) editor.textContent = error.message;
      }
    }
    editor.querySelector('input,textarea')?.focus();
  }

  async function save(key, operation, isWorklog = false) {
    if (saving || selected !== key) return;
    const target = panel;
    saving = true;
    target.querySelectorAll('button,input,textarea').forEach(n => { n.disabled = true; });
    try {
      await operation();
      cache.delete(key);
      signature = '';
      if (isWorklog) timelineHud.refresh({ force: true });
      if (panel === target) {
        panel.querySelector('.editor').replaceChildren();
        await loadDetails();
        if (panel === target) panel.querySelector('.feedback').textContent = 'Salvo no Jira. Os campos nativos podem exigir atualização da página.';
      }
    } catch (error) {
      if (panel === target) panel.querySelector('.feedback').textContent = error.message;
    } finally {
      saving = false;
      if (panel === target) target.querySelectorAll('button,input,textarea').forEach(n => { n.disabled = false; });
    }
  }

  function move(key, transition) {
    if (Object.values(transition.fields || {}).some(f => f.required && !f.hasDefaultValue)) {
      panel.querySelector('.feedback').textContent = 'Esta transição exige campos adicionais. Use o seletor de status nativo da demanda.';
      return;
    }
    return save(key, () => write(key, '/transitions', { transition: { id: String(transition.id) } }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    if (!form.reportValidity() || saving) return;
    const data = new FormData(form);
    const text = String(data.get('comment') || '').trim();
    const key = selected;
    if (form.dataset.kind === 'comment') {
      if (!text) { panel.querySelector('.feedback').textContent = 'Escreva um comentário.'; return; }
      return save(key, () => write(key, '/comment', { body: adf(text) }));
    }
    const minutes = Number(data.get('minutes'));
    const started = new Date(String(data.get('started')));
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440 || !Number.isFinite(started.getTime())) return;
    return save(key, () => write(key, '/worklog?adjustEstimate=leave', {
      timeSpentSeconds: minutes * 60,
      started: started.toISOString().replace('Z', '+0000'),
      ...(text ? { comment: adf(text) } : {}),
    }), true);
  }

  /* ---------- Guias tracejadas de colunas permitidas no arraste nativo ---------- */

  function endDrag() {
    clearTimeout(heldTimer);
    if (drag) { cache.delete(drag.item.key); signature = ''; }
    nativeDragging = false;
    pointer = null;
    drag = null;
    dragGeneration++;
    guides.replaceChildren();
    host.removeAttribute('data-qf-dragging');
  }

  async function beginDrag(item) {
    if (drag || !isEnabled()) return;
    closePopover();
    host.dataset.qfDragging = 'true';
    const current = ++dragGeneration;
    drag = { item, columns: [], message: 'Consultando fluxo do Jira…' };
    drawGuides();
    try {
      const id = location.pathname.match(/\/boards\/(\d+)/)?.[1] || new URLSearchParams(location.search).get('rapidView');
      const [data, config] = await Promise.all([
        request(item.key, '/transitions'),
        id ? json(`/rest/agile/1.0/board/${encodeURIComponent(id)}/configuration`).catch(() => null) : null,
      ]);
      if (current !== dragGeneration || !drag) return;
      const transitions = data.transitions || [];
      const configured = config?.columnConfig?.columns;
      const names = configured ? allowedColumns(configured, transitions).map(c => normalize(c.name)) : transitions.map(t => normalize(t.to?.name));
      const candidates = [...document.querySelectorAll('[data-testid*="column"],[data-rbd-droppable-id],[data-drop-target-for-element]')].filter(visible);
      const seen = new Set();
      drag.columns = candidates.filter(node => {
        const heading = node.querySelector('h2,h3,[data-testid*="column-header"],[data-testid*="column.title"],[data-testid*="column-name"]');
        const name = normalize(heading?.textContent).replace(/\s+\d+$/, '');
        if (!name || !names.includes(name) || seen.has(name)) return false;
        seen.add(name);
        return true;
      });
      drag.message = drag.columns.length
        ? 'Destinos permitidos destacados · solte usando o arraste do Jira'
        : transitions.length
          ? 'Destinos: ' + transitions.map(t => t.to?.name || t.name).join(' · ')
          : 'Nenhuma transição disponível para esta demanda.';
      drawGuides();
    } catch (error) {
      if (current === dragGeneration && drag) { drag.message = error.message; drawGuides(); }
    }
  }

  function drawGuides() {
    if (!drag) return;
    guides.innerHTML = `<div class="qf-drag-message" role="status">${esc(drag.item.key)} · ${esc(drag.message)}</div>`;
    for (const column of drag.columns) {
      const r = column.getBoundingClientRect();
      if (r.right < 0 || r.left > innerWidth) continue;
      const outline = document.createElement('div');
      outline.className = 'qf-drop-guide';
      outline.style.cssText = `left:${Math.max(0, r.left)}px;top:${Math.max(0, r.top)}px;width:${Math.min(r.right, innerWidth) - Math.max(r.left, 0)}px;height:${Math.max(50, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0))}px;`;
      outline.innerHTML = '<span>Destino permitido ↓</span>';
      guides.append(outline);
    }
  }

  document.addEventListener('pointerdown', e => {
    if (!isEnabled() || e.button !== 0 || e.target.closest('[data-qf-owned]')) return;
    const found = findCard(e.target);
    if (!found) return;
    pointer = { item: found, x: e.clientX, y: e.clientY };
    heldTimer = setTimeout(() => { if (pointer) beginDrag(pointer.item); }, 350);
  }, true);
  document.addEventListener('pointermove', e => {
    if (pointer && Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 6) beginDrag(pointer.item);
  }, true);
  document.addEventListener('dragstart', e => {
    if (!isEnabled()) return;
    const found = findCard(e.target);
    if (found) { nativeDragging = true; beginDrag(found); }
  }, true);
  for (const name of ['pointerup', 'dragend', 'drop']) document.addEventListener(name, endDrag, true);
  document.addEventListener('pointercancel', () => { if (!nativeDragging) endDrag(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') endDrag(); }, true);
  window.addEventListener('blur', endDrag);
  window.addEventListener('scroll', drawGuides, { capture: true, passive: true });
  window.addEventListener('resize', drawGuides);
  // Never prevent or replace the native card click.
  document.addEventListener('click', e => { if (isEnabled() && findCard(e.target)) closePopover(); }, true);

  setInterval(() => {
    const active = isEnabled() && !host.hidden;
    if (!active) {
      if (lastActive) { clearBoard(); removePanel(); endDrag(); }
      lastActive = false;
      return;
    }
    lastActive = true;
    if (lastRoute !== location.href) { lastRoute = location.href; signature = ''; endDrag(); }
    const info = nativeContext();
    if (info) {
      if (selected !== info.key || !panelHost?.isConnected) createPanel(info);
      else if (info.context && panelHost.parentNode !== info.context) {
        panelHost.style.cssText = 'display:block;margin:0 0 16px;width:100%;min-width:0;';
        info.context.prepend(panelHost);
      }
    } else if (selected) {
      removePanel();
    }
    if (drag || selected || boardBusy) return;
    const items = cards();
    const next = items.map(i => i.key).join('|');
    if (signature && next !== signature && items.length < signature.split('|').length && items.every(i => scannedNodes.has(i.key))) detailed = true;
    if (next !== signature || items.some(i => scannedNodes.get(i.key) !== i.node || (decorations.has(i.node) && !decorations.get(i.node).badge.isConnected))) {
      enrich(items);
    }
  }, 900);

  return {
    getCachedIssue: (key) => cache.get(key)?.data || null,
    fetchIssueBundle,
    notifyMutation: (key, { worklog = false } = {}) => {
      cache.delete(key);
      signature = '';
      if (worklog) timelineHud.refresh({ force: true });
      if (selected === key) loadDetails();
    },
    toggleMetaHud: () => timelineHud.toggle(),
    isMetaHudOpen: () => timelineHud.isOpen(),
    openMetaLogFor: (key) => timelineHud.openLogFor(key),
  };
}
