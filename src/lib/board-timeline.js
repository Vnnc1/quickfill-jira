import { formatMinutes, formatHM, parseHM, timelineMetrics, bestFreeGap } from './board-rules.js';

const STORAGE_KEY = 'quickfill-meta-hud-v1';
const SEGMENT_COLORS = ['#579dff', '#4bce97', '#f87168', '#9f8fef', '#f5cd47', '#6cc3e0', '#e774bb'];

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function todayIsoLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function shiftIsoDate(iso, deltaDays) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function friendlyDateLabel(iso) {
  const today = todayIsoLocal();
  const yesterday = shiftIsoDate(today, -1);
  const d = new Date(`${iso}T12:00:00Z`);
  const wk = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getUTCDay()] || '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const suffix = iso === today ? ' · hoje' : iso === yesterday ? ' · ontem' : '';
  return `${wk} ${dd}/${mm}${suffix}`;
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { open: false, pinned: false, collapsed: false, corner: 'tr', x: null, y: null };
    return { open: false, pinned: false, collapsed: false, corner: 'tr', x: null, y: null, ...JSON.parse(raw) };
  } catch {
    return { open: false, pinned: false, collapsed: false, corner: 'tr', x: null, y: null };
  }
}

function savePrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* storage indisponível */ }
}

function sendBg(type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!chrome?.runtime?.sendMessage) return reject(new Error('runtime indisponível'));
    try {
      chrome.runtime.sendMessage({ type, payload }, (res) => {
        const err = chrome.runtime.lastError?.message;
        if (err) return reject(new Error(err));
        if (!res?.ok) return reject(new Error(res?.error || 'Falha no serviço'));
        resolve(res.data);
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function fetchJsonSameOrigin(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      ...options,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = data?.errorMessages?.join(' ') || Object.values(data?.errors || {}).join(' ') || `Jira HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Fallback same-origin caso o usuário ainda não tenha configurado o API token nas Opções. */
async function loadReportSameOrigin(date) {
  const me = await fetchJsonSameOrigin('/rest/api/3/myself');
  const from = shiftIsoDate(date, -6);
  const jql = `worklogAuthor = currentUser() AND worklogDate >= "${from}" AND worklogDate <= "${date}" ORDER BY updated DESC`;
  const search = await fetchJsonSameOrigin('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql, fields: ['summary', 'status', 'worklog'], maxResults: 50 }),
  }).catch(() => ({ issues: [] }));

  const byDay = new Map();
  const issues = search?.issues || [];
  for (const issue of issues) {
    let logs = issue.fields?.worklog?.worklogs || [];
    if ((issue.fields?.worklog?.total || 0) > logs.length) {
      const full = await fetchJsonSameOrigin(`/rest/api/3/issue/${encodeURIComponent(issue.key)}/worklog`).catch(() => null);
      if (full?.worklogs) logs = full.worklogs;
    }
    for (const w of logs) {
      if (w.author?.accountId !== me?.accountId) continue;
      const dt = new Date(w.started);
      if (!Number.isFinite(dt.getTime())) continue;
      const dIso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      if (dIso < from || dIso > date) continue;
      const startMin = dt.getHours() * 60 + dt.getMinutes();
      const minutes = Math.max(1, Math.round((Number(w.timeSpentSeconds) || 0) / 60));
      if (!byDay.has(dIso)) byDay.set(dIso, []);
      byDay.get(dIso).push({
        key: issue.key,
        summary: issue.fields?.summary || '',
        start: startMin,
        end: startMin + minutes,
        minutes,
      });
    }
  }

  const workday = { start: 11 * 60, end: 17 * 60, cap: 360, goal: 240 };
  const entries = (byDay.get(date) || []).sort((a, b) => a.start - b.start);
  const total = entries.reduce((sum, e) => sum + e.minutes, 0);
  const history = [];
  for (let i = 6; i >= 0; i--) {
    const d = shiftIsoDate(date, -i);
    const list = byDay.get(d) || [];
    const t = list.reduce((sum, e) => sum + e.minutes, 0);
    history.push({ date: d, total: t, goalMet: t >= workday.goal, issues: new Set(list.map(e => e.key)).size });
  }
  return { date, workday, total, goalMet: total >= workday.goal, entries, history, source: 'same-origin' };
}

export function mountPortableTimeline({ root, getBoardCards, onWorklogSaved, onOpenIssue, onToggleChange }) {
  const prefs = loadPrefs();
  const wrap = document.createElement('section');
  wrap.className = 'qf-meta-hud';
  wrap.setAttribute('aria-label', 'QuickFill: Meta e Linha do Tempo');
  wrap.hidden = !prefs.open;
  root.append(wrap);

  let currentDate = todayIsoLocal();
  let report = null;
  let loading = false;
  let errorMsg = '';
  let logOpen = false;
  let logDefaults = { key: '', start: '14:00', end: '14:30' };
  let savingLog = false;
  let dragState = null;

  function applyPosition() {
    wrap.classList.toggle('is-pinned', !!prefs.pinned);
    wrap.classList.toggle('is-collapsed', !!prefs.collapsed);
    if (typeof prefs.x === 'number' && typeof prefs.y === 'number') {
      const maxX = Math.max(12, window.innerWidth - Math.max(260, wrap.offsetWidth || 380) - 12);
      const maxY = Math.max(12, window.innerHeight - Math.max(64, wrap.offsetHeight || 210) - 12);
      const x = Math.max(12, Math.min(prefs.x, maxX));
      const y = Math.max(12, Math.min(prefs.y, maxY));
      wrap.style.left = `${x}px`;
      wrap.style.top = `${y}px`;
      wrap.style.right = 'auto';
      wrap.style.bottom = 'auto';
      return;
    }
    const c = prefs.corner || 'tr';
    wrap.style.left = c.includes('l') ? '20px' : 'auto';
    wrap.style.right = c.includes('r') ? '20px' : 'auto';
    wrap.style.top = c.includes('t') ? '56px' : 'auto';
    wrap.style.bottom = c.includes('b') ? '138px' : 'auto';
  }

  function colorForKey(key) {
    let hash = 0;
    for (const ch of String(key || '')) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    return SEGMENT_COLORS[Math.abs(hash) % SEGMENT_COLORS.length];
  }

  async function refresh({ force = false } = {}) {
    if (!prefs.open) return;
    loading = true;
    errorMsg = '';
    render();
    try {
      report = await sendBg('DAY_REPORT', { date: currentDate, days: 10, force });
    } catch {
      try {
        report = await loadReportSameOrigin(currentDate);
      } catch (err) {
        errorMsg = err?.message || 'Não foi possível consultar os apontamentos.';
      }
    } finally {
      loading = false;
      render();
      requestAnimationFrame(applyPosition);
    }
  }

  function buildTrack(entries, wd, compact = false) {
    const start = wd?.start ?? 11 * 60;
    const end = wd?.end ?? 17 * 60;
    const span = Math.max(60, end - start);
    const gap = bestFreeGap(entries, start, end);
    const gapPct = Math.min(94, Math.max(6, ((gap.center - start) / span) * 100));

    const segs = entries.map((e) => {
      const s = Math.max(start, Math.min(end, e.start));
      const en = Math.max(s + 3, Math.min(end, e.end));
      const left = ((s - start) / span) * 100;
      const width = Math.max(2.2, ((en - s) / span) * 100);
      const col = colorForKey(e.key);
      const label = !compact && width > 18 ? `${esc(e.key)}` : '';
      return `<button type="button" class="qf-tl-seg" style="left:${left}%;width:${width}%;background:${col}" data-hud-issue="${esc(e.key)}" title="${esc(e.key)} · ${formatHM(e.start)}–${formatHM(e.end)} (${formatMinutes(e.minutes)})${e.summary ? ` — ${esc(e.summary)}` : ''}">${label}</button>`;
    }).join('');

    const ticks = [];
    const startH = Math.floor(start / 60);
    const endH = Math.ceil(end / 60);
    for (let h = startH; h <= endH; h++) ticks.push(`<span>${h}h</span>`);

    return `
      <div class="qf-tl-wrap ${compact ? 'compact' : ''}">
        <div class="qf-tl-track">
          ${segs}
          ${!compact ? `<button type="button" class="qf-tl-plus" style="left:${gapPct}%" data-hud="open-log" data-start="${formatHM(gap.start)}" data-end="${formatHM(gap.end)}" title="Apontar no horário livre (${formatHM(gap.start)}–${formatHM(gap.end)})">+</button>` : ''}
        </div>
        ${!compact ? `<div class="qf-tl-ticks">${ticks.join('')}</div>` : ''}
      </div>
    `;
  }

  function render() {
    wrap.hidden = !prefs.open;
    if (!prefs.open) return;

    const wd = report?.workday || { start: 11 * 60, end: 17 * 60, goal: 240 };
    const entries = report?.entries || [];
    const m = timelineMetrics(report || { date: currentDate, total: 0, workday: wd, entries: [], history: [] });
    const circ = 2 * Math.PI * 33;
    const offset = circ * (1 - m.percent / 100);
    const met = m.overGoalMinutes >= 0;

    if (prefs.collapsed) {
      wrap.innerHTML = `
        <div class="qf-hud-mini" data-drag-handle="true">
          <div class="qf-mini-ring" title="${formatMinutes(m.total)} de ${formatMinutes(m.goal)}">
            <svg viewBox="0 0 76 76"><circle cx="38" cy="38" r="33" class="bg"/><circle cx="38" cy="38" r="33" class="fg ${met ? 'met' : ''}" style="stroke-dasharray:${circ};stroke-dashoffset:${offset}"/></svg>
            <span>${m.percent}%</span>
          </div>
          <div class="qf-mini-info">
            <strong>${formatMinutes(m.total)} <small>/ ${formatMinutes(m.goal)}</small></strong>
            <span class="${met ? 'ok' : ''}">${met ? 'Meta batida ✓' : `Faltam ${formatMinutes(-m.overGoalMinutes)}`}</span>
          </div>
          ${buildTrack(entries, wd, true)}
          <div class="qf-hud-tools">
            <button type="button" data-hud="pin" aria-pressed="${prefs.pinned}" title="${prefs.pinned ? 'Fixado na tela (clique para mover)' : 'Fixar posição na tela'}">${prefs.pinned ? '📌' : '📍'}</button>
            <button type="button" data-hud="collapse" title="Expandir Meta + Linha do Tempo">⤢</button>
            <button type="button" data-hud="close" title="Ocultar Meta + Linha">✕</button>
          </div>
        </div>
      `;
      applyPosition();
      return;
    }

    const cards = getBoardCards?.() || [];
    const boardOptions = cards.slice(0, 25).map(c => `<option value="${esc(c.key)}">${esc(c.key)}${c.title ? ` — ${esc(c.title.slice(0, 44))}` : ''}</option>`).join('');

    wrap.innerHTML = `
      <header class="qf-hud-head" data-drag-handle="true">
        <div class="qf-hud-title">
          <span class="qf-hud-grip" title="${prefs.pinned ? 'Posição fixa' : 'Arraste para mover'}">${prefs.pinned ? '📌' : '⋮⋮'}</span>
          <strong>Meta + Linha do Tempo</strong>
          ${loading ? '<span class="qf-hud-spin">atualizando…</span>' : ''}
        </div>
        <div class="qf-hud-tools">
          <div class="qf-snaps" title="Encaixar num canto da tela">
            <button type="button" data-snap="tl" aria-label="Canto superior esquerdo">↖</button>
            <button type="button" data-snap="tr" aria-label="Canto superior direito">↗</button>
            <button type="button" data-snap="bl" aria-label="Canto inferior esquerdo">↙</button>
            <button type="button" data-snap="br" aria-label="Canto inferior direito">↘</button>
          </div>
          <button type="button" data-hud="pin" class="${prefs.pinned ? 'on' : ''}" aria-pressed="${prefs.pinned}" title="${prefs.pinned ? 'Fixado na tela — clique para destravar movimento' : 'Fixar posição na tela'}">${prefs.pinned ? 'Fixo' : 'Mover'}</button>
          <button type="button" data-hud="collapse" title="Minimizar para barra compacta">−</button>
          <button type="button" data-hud="close" title="Fechar modal portátil">✕</button>
        </div>
      </header>

      <div class="qf-hud-scroll">
        <div class="qf-hud-datenav">
          <button type="button" data-hud="prev-day" title="Dia anterior">‹</button>
          <span class="qf-hud-date">${esc(friendlyDateLabel(currentDate))}</span>
          <button type="button" data-hud="next-day" title="Próximo dia">›</button>
          <button type="button" data-hud="today" class="qf-pill-btn">Hoje</button>
          <button type="button" data-hud="refresh" title="Atualizar apontamentos">↻</button>
        </div>

        ${errorMsg ? `<p class="qf-hud-err" role="alert">${esc(errorMsg)}</p>` : ''}

        <div class="qf-hud-goal">
          <div class="qf-goal-ring">
            <svg viewBox="0 0 76 76">
              <circle cx="38" cy="38" r="33" class="bg"/>
              <circle cx="38" cy="38" r="33" class="fg ${met ? 'met' : ''}" style="stroke-dasharray:${circ};stroke-dashoffset:${offset}"/>
            </svg>
            <div class="qf-goal-center">
              <strong>${formatMinutes(m.total)}</strong>
              <small>de ${formatMinutes(m.goal)}</small>
            </div>
          </div>

          <div class="qf-goal-meta">
            <div class="qf-goal-status ${met ? 'met' : ''}">${met ? 'Meta batida ✓' : `Faltam ${formatMinutes(-m.overGoalMinutes)}`}</div>
            <p class="qf-goal-sub">${m.overGoalMinutes > 0 ? `${formatMinutes(m.overGoalMinutes)} além da meta.` : met ? 'Meta do dia concluída.' : 'Aponte direto na barra abaixo.'}</p>
            <div class="qf-goal-pills">
              ${m.streak > 0 ? `<span class="qf-gpill streak">🔥 ${m.streak} ${m.streak === 1 ? 'dia seguido' : 'dias seguidos'}</span>` : ''}
              ${m.avgMinutes > 0 ? `<span class="qf-gpill">média ${formatMinutes(m.avgMinutes)}</span>` : ''}
              ${m.avgMinutes > 0 ? `<span class="qf-gpill ${m.vsAvgMinutes >= 0 ? 'pos' : ''}">${m.vsAvgMinutes >= 0 ? '+' : '-'}${formatMinutes(Math.abs(m.vsAvgMinutes))} vs média</span>` : ''}
              <span class="qf-gpill">${m.distinctIssues} ${m.distinctIssues === 1 ? 'demanda' : 'demandas'}</span>
            </div>
          </div>
        </div>

        <div class="qf-hud-timeline">
          <div class="qf-hud-tl-head">
            <span>Linha do tempo</span>
            <span class="mono">${formatHM(wd.start)}–${formatHM(wd.end)}</span>
          </div>
          ${buildTrack(entries, wd, false)}
          ${entries.length ? `
            <div class="qf-hud-entries">
              ${entries.slice(0, 6).map(e => `
                <button type="button" class="qf-entry-chip" data-hud-issue="${esc(e.key)}" title="${esc(e.summary || e.key)}">
                  <i style="background:${colorForKey(e.key)}"></i>
                  <b>${esc(e.key)}</b>
                  <span>${formatHM(e.start)}–${formatHM(e.end)} (${formatMinutes(e.minutes)})</span>
                </button>
              `).join('')}
            </div>
          ` : '<p class="qf-hud-empty">Nenhum apontamento neste dia. Clique no <b>+</b> para registrar.</p>'}
        </div>

        ${logOpen ? `
          <form class="qf-hud-form" data-hud-form="worklog">
            <div class="qf-hud-form-head">
              <strong>Apontar na linha do tempo</strong>
              <button type="button" data-hud="close-log">✕</button>
            </div>
            <label>
              Demanda (selecione do quadro ou digite a chave)
              <input name="key" list="qf-board-keys-list" value="${esc(logDefaults.key)}" placeholder="Ex.: MEED-2478" required />
              <datalist id="qf-board-keys-list">${boardOptions}</datalist>
            </label>
            <div class="qf-hud-row2">
              <label>Início<input type="time" name="start" value="${esc(logDefaults.start)}" required /></label>
              <label>Fim<input type="time" name="end" value="${esc(logDefaults.end)}" required /></label>
            </div>
            <label>Descrição (opcional)<input type="text" name="comment" placeholder="O que foi executado?" maxlength="500" /></label>
            <div class="qf-hud-form-actions">
              <button type="button" data-hud="close-log">Cancelar</button>
              <button type="submit" class="primary" ${savingLog ? 'disabled' : ''}>${savingLog ? 'Salvando…' : 'Registrar no Jira'}</button>
            </div>
          </form>
        ` : ''}
      </div>
    `;
    applyPosition();
  }

  // Arrastar pela barra de título (quando não estiver fixado)
  wrap.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-drag-handle]');
    if (!handle || prefs.pinned || e.target.closest('button,input,select')) return;
    const rect = wrap.getBoundingClientRect();
    dragState = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    wrap.classList.add('is-dragging');
    handle.setPointerCapture?.(e.pointerId);
  });

  wrap.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    prefs.x = Math.round(e.clientX - dragState.dx);
    prefs.y = Math.round(e.clientY - dragState.dy);
    prefs.corner = '';
    applyPosition();
  });

  const stopDrag = () => {
    if (!dragState) return;
    dragState = null;
    wrap.classList.remove('is-dragging');
    savePrefs(prefs);
  };
  wrap.addEventListener('pointerup', stopDrag);
  wrap.addEventListener('pointercancel', stopDrag);

  wrap.addEventListener('click', (e) => {
    const snap = e.target.closest('[data-snap]');
    if (snap) {
      prefs.corner = snap.dataset.snap;
      prefs.x = null;
      prefs.y = null;
      savePrefs(prefs);
      applyPosition();
      return;
    }
    const issueBtn = e.target.closest('[data-hud-issue]');
    if (issueBtn) {
      onOpenIssue?.(issueBtn.dataset.hudIssue);
      return;
    }
    const btn = e.target.closest('[data-hud]');
    if (!btn) return;
    const act = btn.dataset.hud;
    if (act === 'close') { setOpen(false); return; }
    if (act === 'pin') { prefs.pinned = !prefs.pinned; savePrefs(prefs); render(); return; }
    if (act === 'collapse') { prefs.collapsed = !prefs.collapsed; savePrefs(prefs); render(); return; }
    if (act === 'prev-day') { currentDate = shiftIsoDate(currentDate, -1); refresh(); return; }
    if (act === 'next-day') { currentDate = shiftIsoDate(currentDate, 1); refresh(); return; }
    if (act === 'today') { currentDate = todayIsoLocal(); refresh({ force: true }); return; }
    if (act === 'refresh') { refresh({ force: true }); return; }
    if (act === 'open-log') {
      const firstCard = (getBoardCards?.() || [])[0]?.key || '';
      logDefaults = { key: logDefaults.key || firstCard, start: btn.dataset.start || '14:00', end: btn.dataset.end || '14:30' };
      logOpen = true;
      render();
      wrap.querySelector('input[name="key"]')?.focus();
      return;
    }
    if (act === 'close-log') { logOpen = false; render(); return; }
  });

  wrap.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-hud-form="worklog"]');
    if (!form || savingLog) return;
    e.preventDefault();
    const fd = new FormData(form);
    const key = String(fd.get('key') || '').trim().toUpperCase();
    const startMin = parseHM(fd.get('start'));
    const endMin = parseHM(fd.get('end'));
    const comment = String(fd.get('comment') || '').trim();
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) { errorMsg = 'Informe uma chave válida (ex.: MEED-2478).'; render(); return; }
    if (startMin == null || endMin == null || endMin <= startMin) { errorMsg = 'O horário de fim precisa ser depois do início.'; render(); return; }
    const minutes = endMin - startMin;
    const startedDate = new Date(`${currentDate}T${formatHM(startMin)}:00`);
    const offsetMin = -startedDate.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    const tz = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
    const started = `${currentDate}T${formatHM(startMin)}:00.000${tz}`;
    const body = {
      timeSpentSeconds: minutes * 60,
      started,
      ...(comment ? { comment: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }] } } : {}),
    };

    savingLog = true;
    errorMsg = '';
    render();
    try {
      await fetchJsonSameOrigin(`/rest/api/3/issue/${encodeURIComponent(key)}/worklog?adjustEstimate=leave`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      logOpen = false;
      onWorklogSaved?.(key, minutes);
      await refresh({ force: true });
    } catch (err) {
      errorMsg = err?.message || 'Erro ao registrar apontamento no Jira.';
    } finally {
      savingLog = false;
      render();
    }
  });

  window.addEventListener('resize', applyPosition, { passive: true });

  function setOpen(next) {
    prefs.open = !!next;
    savePrefs(prefs);
    onToggleChange?.(prefs.open);
    render();
    if (prefs.open) refresh();
  }

  function openLogFor(issueKey) {
    if (!prefs.open) setOpen(true);
    prefs.collapsed = false;
    savePrefs(prefs);
    const wd = report?.workday || { start: 11 * 60, end: 17 * 60 };
    const gap = bestFreeGap(report?.entries || [], wd.start, wd.end);
    logDefaults = { key: issueKey, start: formatHM(gap.start), end: formatHM(gap.end) };
    logOpen = true;
    render();
  }

  if (prefs.open) refresh();

  return {
    isOpen: () => !!prefs.open,
    toggle: () => setOpen(!prefs.open),
    setOpen,
    refresh,
    openLogFor,
  };
}
