/** QuickFill suspenso v2: enriquece o espaço original do Jira sem reconstruir o quadro.
 * Ações usam a sessão do Jira da aba atual; nenhuma credencial sai dessa origem.
 * Isolado em Shadow DOM e limitado às URLs de espaços/quadros do Jira Cloud.
 */
(() => {
  const isJiraCloud = /(^|\.)atlassian\.net$/i.test(location.hostname);
  const isLocalPreview = window.__QF_LOCAL_PREVIEW__ === true && /^(localhost|127\.0\.0\.1|.+\.localhost)$/i.test(location.hostname);
  if (!isJiraCloud && !isLocalPreview) return;

  const HOST = 'quickfill-board-mode';
  if (document.getElementById(HOST)) return; // Uma camada, mesmo com vários perfis instalados.

  const onBoard = () => isLocalPreview || /\/projects\/[^/?#]+|\/jira\/boards\/|\/secure\/RapidBoard\.jspa|\/browse\/[A-Z][A-Z0-9_]*-\d+/i.test(location.pathname);

  const glyphs = {
    bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z"/>',
    right: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    left: '<path d="M20 12H4m6-6-6 6 6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    comment: '<path d="M21 11a8 8 0 0 1-8 8H7l-5 3V10a8 8 0 0 1 8-8h3a8 8 0 0 1 8 9Z"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3v.1"/>',
    pin: '<path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6ZM12 15v7"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name] || glyphs.right}</svg>`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtMin = m => {
    const v = Math.max(0, Math.round(Number(m) || 0));
    const h = Math.floor(v / 60), r = v % 60;
    return !h ? `${r}m` : (r ? `${h}h ${r}m` : `${h}h`);
  };

  const host = document.createElement('div');
  host.id = HOST;
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = chrome.runtime.getURL('board-mode.css');
  root.append(style);

  const container = document.createElement('div');
  root.append(container);
  container.innerHTML = `
    <div class="outline" hidden></div>
    <section class="popover" hidden aria-label="QuickFill: ações do card"></section>
    <div class="launcher" hidden>
      <button class="toggle" role="switch" aria-checked="false" aria-label="Ativar modo QuickFill">
        <span class="mark">${icon('bolt')}</span>
        <span class="toggle-label">QuickFill</span>
        <span class="switch" aria-hidden="true"></span>
      </button>
      <button class="launcher-meta" data-launcher="meta" aria-pressed="false" title="Abrir modal portátil Meta + Linha do Tempo">
        ${icon('target')}<span>Meta+Linha</span>
      </button>
      <button class="launcher-menu" title="Como usar" aria-label="Como usar QuickFill">${icon('help')}</button>
    </div>
    <div class="notice" role="status" hidden></div>
  `;
  document.documentElement.append(host);

  const $ = s => root.querySelector(s);
  let enabled = false, card = null, key = '', pinned = false, page = 'actions', busy = false, revision = 0, timer, frame = 0, lastUrl = '', controller = null;
  const transitionCache = new Map();
  let transitions = [], bundle = null, enhancements = null;

  function theme() {
    const bg = getComputedStyle(document.body).backgroundColor;
    const rgb = bg.match(/\d+/g)?.slice(0, 3).map(Number);
    host.dataset.theme = rgb && rgb[0] + rgb[1] + rgb[2] > 430 ? 'light' : 'dark';
  }

  function showNotice(message, refresh = false) {
    clearTimeout(timer);
    $('.notice').innerHTML = `<p>${esc(message)}</p>${refresh ? '<button data-action="refresh">Atualizar quadro</button>' : ''}<button class="icon-button" data-action="dismiss" aria-label="Fechar aviso">${icon('close')}</button>`;
    $('.notice').hidden = false;
    if (!refresh) timer = setTimeout(() => { $('.notice').hidden = true; }, 5500);
  }

  function closePopover() {
    revision++;
    controller?.abort();
    controller = null;
    card = null;
    key = '';
    bundle = null;
    pinned = false;
    page = 'actions';
    $('.popover').hidden = true;
    $('.outline').hidden = true;
  }

  function syncMetaLauncher(isOpen) {
    const btn = $('.launcher-meta');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(!!isOpen));
    btn.classList.toggle('on', !!isOpen);
  }

  function toggle() {
    if (busy) { showNotice('Aguarde o Jira confirmar a ação em andamento.'); return; }
    enabled = !enabled;
    try { sessionStorage.setItem('quickfill-board-active', String(enabled)); } catch { /* ignore */ }
    $('.toggle').setAttribute('aria-checked', String(enabled));
    $('.toggle').setAttribute('aria-label', enabled ? 'Desativar modo QuickFill' : 'Ativar modo QuickFill');
    $('.toggle-label').textContent = enabled ? 'QuickFill ativo' : 'QuickFill';
    if (!enabled) {
      closePopover();
      $('.notice').hidden = true;
    } else {
      theme();
      showNotice('QuickFill ativo no espaço: tempo, vínculos, filtros rápidos e ações no hover.');
    }
  }

  function cardKey(el) {
    if (!el) return '';
    const direct = el.getAttribute('data-issue-key');
    if (/^[A-Z][A-Z0-9_]*-\d+$/.test(direct || '')) return direct;
    const a = el.matches('a[href]') ? el : el.querySelector('a[href*="/browse/"],a[href*="selectedIssue="],a[href*="selectedIssueKey="]');
    const href = a?.getAttribute('href') || '';
    return (href.match(/(?:\/browse\/|selectedIssue(?:Key)?=)([A-Z][A-Z0-9_]*-\d+)/i)?.[1] || el.textContent?.match(/\b[A-Z][A-Z0-9_]*-\d+\b/)?.[0] || '').toUpperCase();
  }

  function findCard(target) {
    if (!(target instanceof Element) || target === host) return null;
    let node = target;
    for (let i = 0; node && node !== document.body && i < 9; i++, node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      if (rect.width < 115 || rect.width > 640 || rect.height < 45 || rect.height > 540) continue;
      if (!node.matches('[data-issue-key],[data-testid*="card"],[data-rbd-draggable-id],[draggable="true"],article,[role="button"],li')) continue;
      const found = cardKey(node);
      if (!found) continue;
      const keys = new Set((node.textContent.match(/\b[A-Z][A-Z0-9_]*-\d+\b/g) || []));
      if (keys.size > 1) continue;
      return { node, key: found };
    }
    return null;
  }

  function cardSummary() {
    if (bundle?.issue?.fields?.summary) return bundle.issue.fields.summary;
    const el = card?.querySelector('[data-testid*="summary"],[data-testid*="title"],h4,h3');
    if (el?.textContent?.trim()) return el.textContent.trim();
    const lines = (card?.innerText || '')
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 10 && !s.includes(key) && !/^(⏱|⚠|📘|🎨|🔗|☑|💬|▲|↓|=)/.test(s));
    return lines[0] || `Demanda ${key}`;
  }

  function buildPopoverSummaryHtml() {
    const f = bundle?.issue?.fields;
    if (!f) return '';
    const time = bundle.time;
    const links = bundle.links;
    const due = bundle.due;
    const barCls = time.hasOverrun ? 'over' : time.percent >= 85 ? 'near' : '';

    const metaChips = [
      f.status?.name ? `<span class="meta-pill">${esc(f.status.name)}</span>` : '',
      f.assignee?.displayName ? `<span class="meta-pill">👤 ${esc(f.assignee.displayName)}</span>` : '<span class="meta-pill">Sem responsável</span>',
      due.overdue ? `<span class="meta-pill err">⚠ Vencida ${due.daysLate}d</span>` : (f.duedate ? `<span class="meta-pill">📅 ${esc(f.duedate)}</span>` : ''),
    ].filter(Boolean).join('');

    const timeHtml = time.hasTime ? `
      <div class="pop-time">
        <div class="pop-time-row">
          <span>⏱ <b>${fmtMin(time.spentMin)}</b> ${time.estimateMin ? `/ Est. ${fmtMin(time.estimateMin)}` : 'apontado'}</span>
          ${time.hasOverrun ? `<span class="over-tag">+${fmtMin(time.overrunMin)} exc.</span>` : (time.estimateMin ? `<span>${time.percent}%</span>` : '')}
        </div>
        <div class="pop-bar"><i class="${barCls}" style="width:${time.hasOverrun ? 100 : time.percent}%"></i></div>
      </div>
    ` : '';

    const resLinks = [
      ...links.confluence.slice(0, 2).map(c => `<a class="res-link conf" href="${esc(c.url)}" target="_blank" rel="noopener">📘 ${esc(c.title)}</a>`),
      ...links.figma.slice(0, 2).map(fg => `<a class="res-link figma" href="${esc(fg.url)}" target="_blank" rel="noopener">🎨 ${esc(fg.title)}</a>`),
      ...links.issueLinks.slice(0, 2).map(il => `<a class="res-link ${il.isBlocker && !il.done ? 'blocked' : 'rel'}" href="/browse/${encodeURIComponent(il.key)}" target="_blank" rel="noopener">${il.isBlocker && !il.done ? '🚫' : '🔗'} ${esc(il.key)}</a>`),
    ].join('');

    return `
      <div class="pop-meta">${metaChips}</div>
      ${timeHtml}
      ${resLinks ? `<div class="pop-links">${resLinks}</div>` : ''}
    `;
  }

  function paint() {
    const pop = $('.popover');
    const heading = page === 'help'
      ? '<span class="key">⚡ QuickFill no Jira</span>'
      : `<span class="key">${esc(key)}</span><span>·</span><span>${pinned ? 'Fixado no card' : 'Raio-X rápido'}</span>`;

    pop.innerHTML = `
      <div class="popover-head">
        ${heading}
        <span class="spacer"></span>
        ${page !== 'help' ? `<button class="icon-button ${pinned ? 'active' : ''}" data-action="pin" title="${pinned ? 'Soltar card' : 'Fixar neste card'}" aria-label="${pinned ? 'Soltar card' : 'Fixar neste card'}" aria-pressed="${pinned}">${icon('pin')}</button>` : ''}
        <button class="icon-button" data-action="close" aria-label="Fechar ações">${icon('close')}</button>
      </div>
      ${page === 'help' ? `
        <h2>Seu espaço Jira, muito mais claro.</h2>
        <div class="help">
          <p><strong>1. QuickFill ativo:</strong> mantém o espaço original do Jira e enriquece cada card com barra de tempo/excedente, prazo, Confluence, Figma e bloqueios.</p>
          <p><strong>2. Filtros na barra superior:</strong> clique em <em>Minhas</em>, <em>Excedentes</em>, <em>Vencidas</em>, <em>Docs</em>, <em>Figma</em> ou <em>Pessoas</em> para destacar no quadro sem alterar filtros do Jira.</p>
          <p><strong>3. Modal portátil Meta + Linha:</strong> clique em <strong>Meta+Linha</strong> para abrir sua meta diária e linha do tempo. Você pode arrastar pela barra de título, encaixar nos cantos, minimizar ou <strong>fixar</strong> na tela.</p>
          <p><strong>4. Hover nos cards:</strong> passe o mouse para apontar <strong>+30m</strong>, registrar horas, comentar, abrir links Confluence/Figma ou mover etapa.</p>
        </div>
      ` : `
        <h2>${esc(cardSummary())}</h2>
        ${buildPopoverSummaryHtml()}
        <div class="actions">
          <button class="action" data-action="quick30" title="Apontar +30m agora neste card">+30m</button>
          <button class="action" data-action="hours" title="Apontar horas">${icon('clock')}</button>
          <button class="action" data-action="comment" title="Comentar">${icon('comment')}</button>
          <button class="action" data-action="copy" title="Copiar link do card">${icon('link')}</button>
          <button class="action advance" data-action="next">Mover ${icon('right')}</button>
        </div>
        <div class="content"></div>
        <div class="pop-foot">
          <button class="link-btn" data-action="open-meta-log">🎯 Apontar na Linha do Tempo</button>
          <button class="link-btn" data-action="open-issue">Abrir demanda ↗</button>
        </div>
      `}
    `;
    pop.hidden = false;
    position();
  }

  function position() {
    frame = 0;
    const pop = $('.popover'), outline = $('.outline');
    if (pop.hidden) return;
    if (page === 'help') {
      pop.style.left = `${Math.max(12, innerWidth - pop.offsetWidth - 24)}px`;
      pop.style.top = `${Math.max(12, innerHeight - pop.offsetHeight - 145)}px`;
      outline.hidden = true;
      return;
    }
    if (!card?.isConnected) { closePopover(); return; }
    const r = card.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) { closePopover(); return; }
    outline.hidden = false;
    Object.assign(outline.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let x = r.right + 14, y = r.top;
    if (x + w > innerWidth - 12) x = r.left - w - 14;
    if (x < 12) {
      x = Math.min(innerWidth - w - 12, Math.max(12, r.left));
      y = r.bottom + 14;
      if (y + h > innerHeight - 12) y = r.top - h - 14;
    }
    pop.style.left = `${Math.max(12, x)}px`;
    pop.style.top = `${Math.max(12, Math.min(y, innerHeight - h - 12))}px`;
  }

  function queuePosition() { if (!frame) frame = requestAnimationFrame(position); }

  function activate(found) {
    if (key === found.key && card === found.node) return;
    if (busy) return;
    controller?.abort();
    const myRev = ++revision;
    card = found.node;
    key = found.key;
    bundle = enhancements?.getCachedIssue(key) || null;
    page = 'actions';
    pinned = false;
    transitions = [];
    paint();
    if (!bundle && enhancements?.fetchIssueBundle) {
      enhancements.fetchIssueBundle(key).then((loaded) => {
        if (revision === myRev && key === found.key && page === 'actions') {
          bundle = loaded;
          paint();
        }
      }).catch(() => { /* mantém resumo do DOM */ });
    }
  }

  async function api(path, { method = 'GET', body, signal } = {}) {
    const request = new AbortController();
    const abort = () => request.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 25000);
    try {
      const res = await fetch(`/rest/api/3/issue/${encodeURIComponent(key)}${path}`, {
        method,
        credentials: 'same-origin',
        signal: request.signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      let data = null;
      const text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch { throw new Error('O Jira retornou uma resposta inválida. Verifique se sua sessão está ativa.'); }
      if (!res.ok) {
        const detail = data?.errorMessages?.join(' ') || Object.values(data?.errors || {}).join(' ');
        throw new Error(detail || (res.status === 401 ? 'Sua sessão do Jira expirou. Entre novamente.' : res.status === 403 ? 'Você não tem permissão para esta ação nesta tarefa.' : `O Jira não concluiu a ação (HTTP ${res.status}).`));
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError' && !signal?.aborted) {
        throw new Error(method === 'GET' ? 'O Jira demorou para responder. Tente novamente.' : 'Não foi possível confirmar a gravação. Confira a tarefa no Jira antes de repetir.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  function content(html) {
    const el = $('.content');
    if (el) { el.innerHTML = html; position(); }
  }

  async function destinations() {
    if (busy) return;
    pinned = true;
    page = 'transitions';
    paint();
    content('<h3 class="subheading">Mover tarefa</h3><p class="empty" role="status">Consultando as transições do Jira…</p>');
    const version = revision;
    controller?.abort();
    controller = new AbortController();
    try {
      const data = await api('/transitions?expand=transitions.fields', { signal: controller.signal });
      if (version !== revision) return;
      transitions = data?.transitions || [];
      transitionCache.set(key, transitions);
      if (!transitions.length) {
        content('<h3 class="subheading">Mover tarefa</h3><p class="empty">Nenhuma transição disponível para sua conta nesta tarefa.</p>');
        return;
      }
      content(`<h3 class="subheading">Para qual etapa?</h3>${transitions.map((t, i) => `<button class="transition" data-action="transition" data-index="${i}">${icon('right')}<span>${esc(t.to?.name || t.name)}${t.to?.name && t.name !== t.to.name ? `<small>${esc(t.name)}</small>` : ''}</span>${icon('chevron')}</button>`).join('')}<p class="required-note">Somente destinos permitidos pelo fluxo do Jira.</p>`);
    } catch (error) {
      if (version !== revision || error.name === 'AbortError') return;
      content(`<p class="error" role="alert">${esc(error.message)}</p><button class="secondary" data-action="next">Tentar novamente</button>`);
    }
  }

  function form(kind) {
    if (busy) return;
    pinned = true;
    page = kind;
    paint();
    const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    content(kind === 'comment'
      ? '<h3 class="subheading">Adicionar comentário</h3><form data-kind="comment"><label>Comentário<textarea name="comment" maxlength="10000" required placeholder="O que a equipe precisa saber?"></textarea></label><div class="form-actions"><button type="button" class="secondary" data-action="cancel">Cancelar</button><button class="primary" type="submit">Publicar no Jira</button></div><p class="form-error error" role="alert" hidden></p></form>'
      : `<h3 class="subheading">Apontar horas</h3><form data-kind="hours"><div class="dur-chips"><button type="button" data-fill-dur="15m">15m</button><button type="button" data-fill-dur="30m">30m</button><button type="button" data-fill-dur="1h">1h</button><button type="button" data-fill-dur="2h">2h</button></div><label>Tempo trabalhado<input type="text" name="duration" value="30m" required placeholder="Ex.: 1h 30m" pattern="(?:(?:[0-9]+h)(?: [0-9]+m)?|[0-9]+m)" title="Use 1h, 30m ou 1h 30m"></label><label>Início do trabalho<input type="datetime-local" name="started" required value="${localDate}"></label><label>Descrição<textarea name="comment" maxlength="2000" placeholder="Descreva o trabalho realizado"></textarea></label><div class="form-actions"><button type="button" class="secondary" data-action="cancel">Cancelar</button><button class="primary" type="submit">Registrar no Jira</button></div><p class="form-error error" role="alert" hidden></p></form>`);
    $('.content input, .content textarea')?.focus();
  }

  const adf = text => ({ type: 'doc', version: 1, content: text.split(/\r?\n/).map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) });

  function setBusy(value) {
    busy = value;
    root.querySelectorAll('.popover button,.popover input,.popover textarea').forEach(el => { el.disabled = value; });
    $('.toggle').disabled = value;
  }

  async function quickLog30() {
    if (busy || !key) return;
    const targetKey = key;
    const started = new Date(Date.now() - 30 * 60000).toISOString().replace('Z', '+0000');
    setBusy(true);
    try {
      await api('/worklog?adjustEstimate=leave', { method: 'POST', body: { timeSpentSeconds: 1800, started } });
      enhancements?.notifyMutation(targetKey, { worklog: true });
      showNotice(`⏱ +30m registrados em ${targetKey}. Meta e linha do tempo atualizadas.`);
      page = 'actions';
      paint();
    } catch (error) {
      showNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function transition(index) {
    const t = transitions[index];
    if (!t || busy) return;
    const required = Object.entries(t.fields || {}).filter(([name, field]) => field.required && !field.hasDefaultValue && name !== 'status');
    if (required.length) {
      content(`<h3 class="subheading">Dados obrigatórios no Jira</h3><p class="empty">Essa transição exige: ${esc(required.map(([name, f]) => f.name || name).join(', '))}. Preencha esses campos na tarefa para continuar.</p><button class="secondary" data-action="open-issue">Abrir tarefa no Jira</button>`);
      return;
    }
    const targetKey = key;
    setBusy(true);
    try {
      await api('/transitions', { method: 'POST', body: { transition: { id: String(t.id) } } });
      transitionCache.delete(targetKey);
      enhancements?.notifyMutation(targetKey);
      showNotice(`${targetKey} movida para ${t.to?.name || t.name}.`, true);
      closePopover();
    } catch (error) {
      content(`<p class="error" role="alert">${esc(error.message)}</p><button class="secondary" data-action="next">Consultar destinos novamente</button>`);
    } finally {
      setBusy(false);
    }
  }

  root.addEventListener('click', event => {
    const durChip = event.target.closest('[data-fill-dur]');
    if (durChip) {
      const inp = root.querySelector('.popover input[name="duration"]');
      if (inp) { inp.value = durChip.dataset.fillDur; inp.setCustomValidity(''); }
      return;
    }
    const button = event.target.closest('button');
    if (!button) return;
    event.stopPropagation();
    if (button.matches('.toggle')) return toggle();
    if (button.dataset.launcher === 'meta') {
      enhancements?.toggleMetaHud();
      return;
    }
    if (button.matches('.launcher-menu')) {
      if (busy) return;
      closePopover();
      page = 'help';
      paint();
      return;
    }
    const action = button.dataset.action;
    if (!action) return;
    if (action === 'dismiss') { $('.notice').hidden = true; return; }
    if (action === 'refresh') { location.reload(); return; }
    if (busy) return;
    if (action === 'close') return closePopover();
    if (action === 'pin') { pinned = !pinned; paint(); return; }
    if (action === 'next' || action === 'previous') return destinations();
    if (action === 'comment' || action === 'hours') return form(action);
    if (action === 'quick30') return quickLog30();
    if (action === 'copy') {
      navigator.clipboard?.writeText(`${location.origin}/browse/${key}`).then(
        () => showNotice(`🔗 Link de ${key} copiado.`),
        () => showNotice('Não foi possível copiar o link.'),
      );
      return;
    }
    if (action === 'open-meta-log') {
      const target = key;
      closePopover();
      enhancements?.openMetaLogFor(target);
      return;
    }
    if (action === 'transition') return transition(Number(button.dataset.index));
    if (action === 'cancel') { page = 'actions'; paint(); return; }
    if (action === 'open-issue') location.assign(`/browse/${encodeURIComponent(key)}`);
  });

  root.addEventListener('submit', async event => {
    const el = event.target;
    if (!el.closest('.popover')) return;
    event.preventDefault();
    if (busy || !(el instanceof HTMLFormElement) || !el.reportValidity()) return;
    const fd = new FormData(el);
    const comment = String(fd.get('comment') || '').trim();
    if (el.dataset.kind === 'comment' && !comment) {
      el.querySelector('textarea').setCustomValidity('Escreva um comentário antes de publicar.');
      el.reportValidity();
      return;
    }
    let body, path;
    if (el.dataset.kind === 'comment') {
      path = '/comment';
      body = { body: adf(comment) };
    } else {
      const duration = String(fd.get('duration'));
      const parts = duration.match(/^(?:(\d+)h(?: (\d+)m)?|(\d+)m)$/);
      const minutes = parts ? Number(parts[1] || 0) * 60 + Number(parts[2] || parts[3] || 0) : 0;
      if (!minutes || minutes > 1440) {
        el.querySelector('input').setCustomValidity('Informe um tempo entre 1m e 24h.');
        el.reportValidity();
        return;
      }
      const started = new Date(String(fd.get('started')));
      if (!Number.isFinite(started.getTime())) return;
      path = '/worklog?adjustEstimate=leave';
      body = { timeSpentSeconds: minutes * 60, started: started.toISOString().replace('Z', '+0000'), ...(comment ? { comment: adf(comment) } : {}) };
    }
    const targetKey = key;
    setBusy(true);
    try {
      await api(path, { method: 'POST', body });
      enhancements?.notifyMutation(targetKey, { worklog: el.dataset.kind !== 'comment' });
      showNotice(`${targetKey}: ${el.dataset.kind === 'comment' ? 'comentário publicado' : 'horas registradas'} no Jira.`);
      page = 'actions';
      paint();
    } catch (error) {
      const err = $('.form-error');
      if (err) { err.textContent = error.message; err.hidden = false; position(); }
    } finally {
      setBusy(false);
    }
  });

  root.addEventListener('input', e => { if ('setCustomValidity' in e.target) e.target.setCustomValidity(''); });
  document.addEventListener('pointerover', event => {
    if (!enabled || pinned || busy || host.hasAttribute('data-qf-dragging') || host.hasAttribute('data-qf-detail') || event.target === host) return;
    const found = findCard(event.target);
    if (found) activate(found);
  }, true);
  document.addEventListener('focusin', event => {
    if (!enabled || pinned || busy || host.hasAttribute('data-qf-dragging') || host.hasAttribute('data-qf-detail') || event.target === host) return;
    const found = findCard(event.target);
    if (found) activate(found);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !busy && !$('.popover').hidden) { closePopover(); $('.toggle').focus(); }
  });
  window.addEventListener('scroll', queuePosition, { capture: true, passive: true });
  window.addEventListener('resize', queuePosition, { passive: true });

  function syncRoute() {
    const url = location.pathname;
    if (lastUrl !== url) {
      lastUrl = url;
      closePopover();
      $('.notice').hidden = true;
      if (!onBoard()) {
        enabled = false;
        $('.toggle').setAttribute('aria-checked', 'false');
        $('.toggle').setAttribute('aria-label', 'Ativar modo QuickFill');
        $('.toggle-label').textContent = 'QuickFill';
      }
    }
    $('.launcher').hidden = !onBoard();
    host.hidden = !onBoard();
    if (onBoard()) theme();
    if (card && !card.isConnected) closePopover();
  }

  import(chrome.runtime.getURL('lib/board-enhancements.js')).then(({ mountBoardEnhancements }) => {
    enhancements = mountBoardEnhancements({
      host,
      root,
      isEnabled: () => enabled,
      findCard,
      closePopover,
      onMetaToggleSync: syncMetaLauncher,
    });
    syncMetaLauncher(enhancements.isMetaHudOpen());
  }).catch(error => console.warn('QuickFill: detalhes do quadro indisponíveis', error));

  syncRoute();
  try { if (onBoard() && sessionStorage.getItem('quickfill-board-active') === 'true') toggle(); } catch { /* ignore */ }
  setInterval(syncRoute, 750);
})();
