/**
 * Reuniões na linha do tempo (teste, nos 4 perfis).
 *
 * Daily, alinhamentos e reuniões marcados direto na linha do tempo do dia: arraste a bolinha
 * até o horário, solte, preencha título/início/fim/descrição. Ficam guardados só no navegador
 * (chrome.storage.local) e contam na meta do dia se a opção estiver ligada.
 * As Opções mostram o histórico (lib/meetings-options.js).
 */

export const MEETING_TYPES = {
  daily: { label: "Daily", color: "#9f8fef" },
  alinhamento: { label: "Alinhamento", color: "#6cc3e0" },
  reuniao: { label: "Reunião", color: "#fea362" },
  outro: { label: "Outro", color: "#94a3b4" },
};

export const MEETING_DEFAULTS = { meetingsDot: true, meetingsGoal: true, meetingsDur: 30 };

const cache = { list: [], settings: { dot: true, goal: true, dur: 30 } };

const pad = (n) => String(n).padStart(2, "0");
export const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const fmtMin = (m) => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };
const parseHM = (s) => { const [h, m] = String(s || "").split(":").map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
const rgba = (hex, a) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")},${a})`;

export async function loadMeetings() {
  try {
    const [l, s] = await Promise.all([chrome.storage.local.get({ qfMeetings: [] }), chrome.storage.sync.get(MEETING_DEFAULTS)]);
    cache.list = Array.isArray(l.qfMeetings) ? l.qfMeetings : [];
    cache.settings = { dot: s.meetingsDot !== false, goal: s.meetingsGoal !== false, dur: Number(s.meetingsDur) || 30 };
  } catch { /* sem storage: segue vazio */ }
  return cache;
}

/** Avisa quando reuniões ou ajustes mudarem (em outra janela, nas Opções…). */
export function onMeetingsChange(cb) {
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if ((area === "local" && ch.qfMeetings) || (area === "sync" && (ch.meetingsDot || ch.meetingsGoal || ch.meetingsDur))) loadMeetings().then(cb);
    });
  } catch { /* segue */ }
}

export const meetingsOn = (date) => cache.list.filter((m) => m.date === date).sort((a, b) => a.start - b.start);
/** Minutos de reunião que contam na meta do dia (0 se a opção estiver desligada). */
export const meetingMinutes = (date) => (cache.settings.goal ? meetingsOn(date).reduce((s, m) => s + (m.end - m.start), 0) : 0);
export const meetingSettings = () => cache.settings;

export async function saveMeeting(m) {
  const list = cache.list.filter((x) => x.id !== m.id);
  list.push(m);
  cache.list = list;
  await chrome.storage.local.set({ qfMeetings: list });
}
export async function deleteMeeting(id) {
  cache.list = cache.list.filter((x) => x.id !== id);
  await chrome.storage.local.set({ qfMeetings: cache.list });
}

/* ------------------------------------------------------------------ */
/* Modal: marcar ou editar                                             */
/* ------------------------------------------------------------------ */

export function openMeetingModal(m, { onDone } = {}) {
  document.querySelector(".mtg-modal")?.remove();
  const editing = !!m.id;
  const cur = { type: "daily", title: "", desc: "", ...m };
  if (!cur.title && !editing) cur.title = MEETING_TYPES[cur.type].label;

  const wrap = document.createElement("div");
  wrap.className = "mtg-modal";
  wrap.innerHTML = `
    <div class="mtg-box" role="dialog" aria-modal="true" aria-labelledby="mtgTitleH">
      <div class="mtg-head"><b id="mtgTitleH">${editing ? "Editar reunião" : "Marcar reunião"}</b><button class="ic" data-x aria-label="Fechar">✕</button></div>
      <div class="mtg-types"></div>
      <label class="mtg-f"><span>Título</span><input class="inp" data-title maxlength="120" /></label>
      <div class="mtg-row">
        <label class="mtg-f"><span>Começou</span><input class="inp" type="time" step="300" data-start /></label>
        <label class="mtg-f"><span>Terminou</span><input class="inp" type="time" step="300" data-end /></label>
      </div>
      <div class="mtg-dur muted xs"></div>
      <label class="mtg-f"><span>Descrição <em>(opcional)</em></span><textarea class="inp" rows="3" data-desc placeholder="O que foi combinado"></textarea></label>
      <div class="mtg-actions">
        ${editing ? '<button class="btn sm mtg-del" data-del>Excluir</button>' : ""}
        <span class="grow"></span>
        <button class="btn sm ghost" data-x>Cancelar</button>
        <button class="btn sm primary" data-save>Salvar</button>
      </div>
    </div>`;
  const $ = (s) => wrap.querySelector(s);
  const types = $(".mtg-types");
  const paintTypes = () => {
    types.innerHTML = "";
    for (const [k, t] of Object.entries(MEETING_TYPES)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `mtg-type${cur.type === k ? " on" : ""}`;
      b.innerHTML = `<i></i>${t.label}`;
      b.querySelector("i").style.background = t.color;
      if (cur.type === k) { b.style.borderColor = t.color; b.style.background = rgba(t.color, 0.18); }
      b.addEventListener("click", () => {
        const auto = !cur.title || Object.values(MEETING_TYPES).some((x) => x.label === cur.title);
        cur.type = k;
        if (auto) { cur.title = k === "outro" ? "" : t.label; $("[data-title]").value = cur.title; }
        paintTypes();
      });
      types.appendChild(b);
    }
  };
  const paintDur = () => { $(".mtg-dur").textContent = `${fmtMin(cur.end - cur.start)}${cache.settings.goal ? " que contam na meta do dia" : ""}`; };
  paintTypes();
  $("[data-title]").value = cur.title;
  $("[data-start]").value = hhmm(cur.start);
  $("[data-end]").value = hhmm(cur.end);
  $("[data-desc]").value = cur.desc || "";
  paintDur();
  $("[data-title]").addEventListener("input", (e) => { cur.title = e.target.value; });
  $("[data-desc]").addEventListener("input", (e) => { cur.desc = e.target.value; });
  $("[data-start]").addEventListener("change", (e) => {
    const v = parseHM(e.target.value); if (v == null) return;
    const dur = cur.end - cur.start;
    cur.start = v; cur.end = Math.min(24 * 60, v + Math.max(5, dur));
    $("[data-end]").value = hhmm(cur.end); paintDur();
  });
  $("[data-end]").addEventListener("change", (e) => {
    const v = parseHM(e.target.value); if (v == null) return;
    cur.end = Math.max(cur.start + 5, v); e.target.value = hhmm(cur.end); paintDur();
  });

  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  wrap.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  $("[data-save]").addEventListener("click", async () => {
    const item = { ...cur, title: (cur.title || "").trim() || MEETING_TYPES[cur.type].label, desc: (cur.desc || "").trim(),
      id: cur.id || `m${Date.now().toString(36)}`, savedAt: Date.now() };
    await saveMeeting(item);
    close(); onDone?.();
  });
  $("[data-del]")?.addEventListener("click", async () => { await deleteMeeting(cur.id); close(); onDone?.(); });
  document.body.appendChild(wrap);
  $("[data-title]").focus();
  $("[data-title]").select();
}

/* ------------------------------------------------------------------ */
/* Linha do tempo: blocos, bolinhas e arrastar                          */
/* ------------------------------------------------------------------ */

/**
 * Coloca as reuniões do dia na linha do tempo e a bolinha de marcar.
 * @param tr  retorno de track(): { track, lo, hi }
 * @param opts { date, now (minutos, só hoje), onChange, readOnly (só mostra, sem bolinhas) }
 */
export function attachMeetings(tr, { date, now = null, onChange, readOnly = false }) {
  const t = tr.track, lo = tr.lo, span = tr.hi - tr.lo;
  t.classList.add(readOnly ? "has-mtg-ro" : "has-mtg");
  const pct = (m) => `${((m - lo) / span) * 100}%`;
  const snap = (m) => Math.round(m / 5) * 5;
  const toMin = (clientX) => {
    const r = t.getBoundingClientRect();
    return snap(lo + ((clientX - r.left) / r.width) * span);
  };
  const tip = document.createElement("span");
  tip.className = "mtg-tip hidden";
  t.appendChild(tip);
  const showTip = (m) => { tip.textContent = hhmm(m); tip.style.left = pct(m); tip.classList.remove("hidden"); };

  /** Arrastar com o ponteiro; clique sem mover chama onClick. */
  function draggable(handle, { onMove, onDrop, onClick }) {
    handle.addEventListener("click", (e) => e.stopPropagation());   // não abre o que estiver por trás (linha da pessoa etc.)
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const x0 = e.clientX;
      let moved = false;
      const move = (ev) => { if (Math.abs(ev.clientX - x0) > 3) moved = true; if (moved) onMove(toMin(ev.clientX)); };
      const up = (ev) => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        tip.classList.add("hidden");
        if (moved) onDrop(toMin(ev.clientX)); else onClick?.();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }

  for (const m of meetingsOn(date)) {
    if (m.end <= lo || m.start >= tr.hi) continue;
    const t0 = MEETING_TYPES[m.type] || MEETING_TYPES.outro;
    const blk = document.createElement("span");
    blk.className = "mtg-blk";
    blk.style.left = pct(m.start);
    blk.style.width = pct(lo + (m.end - m.start));
    blk.style.borderColor = t0.color;
    blk.style.background = rgba(t0.color, 0.22);
    blk.title = `${t0.label}: ${m.title} · ${hhmm(m.start)}–${hhmm(m.end)} · ${fmtMin(m.end - m.start)}`;
    if (readOnly) { blk.classList.add("ro"); t.appendChild(blk); continue; }
    blk.addEventListener("click", (e) => { e.stopPropagation(); openMeetingModal(m, { onDone: onChange }); });
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "mtg-dot";
    dot.style.left = pct(m.start);
    dot.style.background = t0.color;
    dot.title = `${m.title}: arraste para mudar o horário; clique para editar`;
    dot.setAttribute("aria-label", `${m.title}, ${hhmm(m.start)} às ${hhmm(m.end)}`);
    const dur = m.end - m.start;
    const clampStart = (v) => Math.max(lo, Math.min(tr.hi - dur, v));
    draggable(dot, {
      onMove: (v) => { v = clampStart(v); dot.style.left = blk.style.left = pct(v); showTip(v); },
      onDrop: async (v) => { v = clampStart(v); await saveMeeting({ ...m, start: v, end: v + dur }); onChange?.(); },
      onClick: () => openMeetingModal(m, { onDone: onChange }),
    });
    t.append(blk, dot);
  }

  if (readOnly || !cache.settings.dot) return;
  const start0 = now != null && now > lo && now < tr.hi ? snap(now) : snap(lo + span / 2);
  const add = document.createElement("button");
  add.type = "button";
  add.className = "mtg-add";
  add.style.left = pct(start0);
  add.title = "Arraste até o horário e solte para marcar uma reunião, daily ou alinhamento";
  add.setAttribute("aria-label", "Marcar reunião na linha do tempo");
  add.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;
  let at = start0;
  const clampAdd = (v) => Math.max(lo, Math.min(tr.hi - 5, v));
  const open = () => openMeetingModal({ date, start: at, end: Math.min(tr.hi, at + cache.settings.dur), type: "daily" }, { onDone: onChange });
  draggable(add, {
    onMove: (v) => { at = clampAdd(v); add.style.left = pct(at); showTip(at); },
    onDrop: (v) => { at = clampAdd(v); open(); },
    onClick: open,
  });
  t.appendChild(add);
}

/** Card "Reuniões do dia" com a lista e o botão de editar. */
export function meetingsCard(date, { onChange } = {}) {
  const list = meetingsOn(date);
  const card = document.createElement("div");
  card.className = "card mtg-card";
  const total = list.reduce((s, m) => s + m.end - m.start, 0);
  card.innerHTML = `<div class="card-t">Reuniões do dia<span>${list.length ? fmtMin(total) : ""}</span></div>`;
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "muted xs";
    p.style.margin = "0";
    p.textContent = cache.settings.dot ? "Nenhuma ainda. Arraste a bolinha azul da linha do tempo até o horário da reunião." : "Nenhuma reunião marcada neste dia.";
    card.appendChild(p);
    return card;
  }
  for (const m of list) {
    const t0 = MEETING_TYPES[m.type] || MEETING_TYPES.outro;
    const row = document.createElement("div");
    row.className = "mtg-row-item";
    row.innerHTML = `<span class="mtg-pill"></span><div class="mtg-txt"><b></b><small></small></div><button class="btn sm ghost">Editar</button>`;
    const pill = row.querySelector(".mtg-pill");
    pill.textContent = t0.label; pill.style.color = t0.color; pill.style.background = rgba(t0.color, 0.2);
    row.querySelector("b").textContent = m.title;
    row.querySelector("small").textContent = `${hhmm(m.start)} às ${hhmm(m.end)}, ${fmtMin(m.end - m.start)}${m.desc ? ` · ${m.desc}` : ""}`;
    row.querySelector("button").addEventListener("click", () => openMeetingModal(m, { onDone: onChange }));
    card.appendChild(row);
  }
  return card;
}
