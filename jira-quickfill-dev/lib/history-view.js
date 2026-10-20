/**
 * Modal "Histórico da demanda": o caminho da demanda no quadro, na horizontal (tempo da
 * esquerda para a direita, etapas em faixas) ou na vertical (uma ação por linha).
 * Aberto pelo botão "Histórico" das listas de demandas nos quatro perfis.
 */

import { LANES, buildHistory, onlyReturns, fmtSpan } from "./history.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const dayOf = (ms) => { const d = new Date(ms); return `${DOW[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const hourOf = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const whenOf = (ms) => `${dayOf(ms)} ${hourOf(ms)}`;
const RED = "#f87168";

const PREF = "qf.history";
const pref = () => { try { return { layout: "h", ...JSON.parse(localStorage.getItem(PREF) || "{}") }; } catch { return { layout: "h" }; } };
const savePref = (p) => { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* sem storage */ } };

const ICON_JIRA = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const ICON_HIST = `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="6" cy="5" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="6" cy="19" r="2"/><path d="M8 5c6 0 8 3 8 5M16 14c0 2-2 5-8 5"/></g></svg>`;

let current = null;   // { root, onKey }

export function closeHistory() {
  if (!current) return;
  document.removeEventListener("keydown", current.onKey, true);
  current.root.remove();
  current.back?.focus?.();
  current = null;
}

/**
 * Abre o histórico de `key`. `send` fala com o serviço; `openIssue(url, e)` abre no Jira.
 */
export async function openHistory(key, { send, openIssue, base = "" } = {}) {
  closeHistory();
  const root = document.createElement("div");
  root.className = "hist-ov";
  root.innerHTML = `<div class="hist-dlg" role="dialog" aria-modal="true" aria-label="Histórico de ${esc(key)}" tabindex="-1">
    <div class="hist-load"><span class="k">${esc(key)}</span> Lendo o caminho da demanda no Jira…</div></div>`;
  document.body.appendChild(root);
  const dlg = root.querySelector(".hist-dlg");
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeHistory(); } };
  current = { root, onKey, back: document.activeElement };
  document.addEventListener("keydown", onKey, true);
  root.addEventListener("mousedown", (e) => { if (e.target === root) closeHistory(); });
  dlg.focus();

  let data;
  try {
    data = await send("ISSUE_HISTORY", { key });
  } catch (e) {
    if (current?.root !== root) return;
    dlg.innerHTML = `<div class="hist-load err"><b>Não deu para ler o histórico de ${esc(key)}.</b><span>${esc(e.message)}</span>
      <button type="button" class="hist-ic" data-close aria-label="Fechar">✕</button></div>`;
    dlg.querySelector("[data-close]").addEventListener("click", closeHistory);
    return;
  }
  if (current?.root !== root) return;   // fechou enquanto carregava
  const H = buildHistory(data, Date.now());
  const url = data.url || (base && key ? `${base}/browse/${key}` : "");
  const st = { ...pref(), only: false, sel: H.nodes.length - 1 };

  // A animação de desenho roda ao abrir e ao trocar de layout; clicar num ponto só troca o detalhe.
  let animate = true;
  const render = () => {
    const keep = st.only ? onlyReturns(H.nodes) : null;
    const dim = (i) => keep && !keep.has(i);
    const nowLane = LANES[H.nowLane];
    dlg.innerHTML = `
      <div class="hist-top">
        <div class="hist-title">
          <div class="hist-id"><div class="hist-kt"><span class="k">${esc(H.key)}</span><span>${esc(H.type)}${H.parentKey ? ` · ↳ ${esc(H.parentKey)}` : ""}</span></div>
            <b>${esc(H.summary)}</b></div>
          <button type="button" class="hist-ic" data-jira aria-label="Abrir no Jira" title="Abrir no Jira">${ICON_JIRA}</button>
          <button type="button" class="hist-ic" data-close aria-label="Fechar" title="Fechar (Esc)">✕</button>
        </div>
        <div class="hist-chips">
          <span class="chip">agora <b style="color:${nowLane.c}">${esc(H.nowStatus)}</b></span>
          <span class="chip">criada há <b>${fmtSpan(H.age)}</b></span>
          <span class="chip${H.loops ? " bad" : ""}"><b>${H.loops} ${H.loops === 1 ? "volta" : "voltas"}</b></span>
          <span class="chip"><b>${H.people}</b> ${H.people === 1 ? "pessoa mexeu" : "pessoas mexeram"}</span>
        </div>
        <div class="hist-share" role="img" aria-label="Tempo em cada etapa">${H.share.map((s) =>
          `<i style="flex:${s.w};background:${s.c}" title="${esc(s.label)}: ${fmtSpan(s.ms)}"></i>`).join("")}</div>
        <div class="hist-legend">${H.share.map((s) =>
          `<span><i style="background:${s.c}"></i>${esc(s.label)} <b>${fmtSpan(s.ms)}</b></span>`).join("")}</div>
        <div class="hist-ctl">
          <span class="seg"><button type="button" data-layout="h" class="${st.layout === "h" ? "on" : ""}">Horizontal</button><button type="button" data-layout="v" class="${st.layout === "v" ? "on" : ""}">Vertical</button></span>
          <span class="seg"><button type="button" data-only="0" class="${st.only ? "" : "on"}">Tudo</button><button type="button" data-only="1" class="${st.only ? "on" : ""}"${H.loops ? "" : " disabled title=\"Esta demanda não voltou nenhuma vez\""}>Só as voltas</button></span>
          <span class="hist-hint">${st.layout === "h" ? "mais antigo à esquerda" : "mais antigo em cima"}</span>
        </div>
      </div>
      <div class="hist-body${animate ? " hist-anim" : ""}">${st.layout === "h" ? horizontal(H, st, dim) : vertical(H, st, dim)}</div>`;

    dlg.querySelector("[data-close]").addEventListener("click", closeHistory);
    dlg.querySelector("[data-jira]").addEventListener("click", (e) => openIssue?.(url, e));
    dlg.querySelectorAll("[data-layout]").forEach((b) => b.addEventListener("click", () => {
      st.layout = b.dataset.layout; savePref({ layout: st.layout }); animate = true; render();
    }));
    dlg.querySelectorAll("[data-only]").forEach((b) => b.addEventListener("click", () => { st.only = b.dataset.only === "1"; render(); }));
    const pick = (i) => { st.sel = Math.max(0, Math.min(H.nodes.length - 1, i)); render(); };
    animate = false;
    dlg.querySelectorAll("[data-pick]").forEach((n) => n.addEventListener("click", () => pick(Number(n.dataset.pick))));
    dlg.querySelector("[data-prev]")?.addEventListener("click", () => pick(st.sel - 1));
    dlg.querySelector("[data-next]")?.addEventListener("click", () => pick(st.sel + 1));
    dlg.querySelectorAll(".hist-ev").forEach((r) => r.addEventListener("mouseenter", () => {
      dlg.querySelectorAll(".hist-ev.sel").forEach((x) => x.classList.remove("sel"));
      r.classList.add("sel");
    }));
    // Horizontal: começa mostrando o fim (o agora) e a ação escolhida
    const sc = dlg.querySelector(".hist-scroll");
    const on = dlg.querySelector(`[data-pick="${st.sel}"]`);
    if (sc && on) sc.scrollLeft = Math.max(0, Number(on.getAttribute("cx")) - sc.clientWidth / 2);
  };
  render();
}

/** Texto do detalhe de uma ação: quem fez e quanto ficou na etapa anterior. */
const byLine = (H, i) => {
  const n = H.nodes[i], prev = i ? H.nodes[i - 1] : null;
  return [n.by, prev ? `ficou ${fmtSpan(n.stayedPrev)} em ${prev.status || LANES[prev.lane].label}` : ""].filter(Boolean).join(" · ");
};
const noteLine = (H, i) => {
  const n = H.nodes[i], last = i === H.nodes.length - 1;
  if (n.note) return { txt: `“${n.note}”`, strong: true };
  if (last) return { txt: `há ${fmtSpan(n.dur)} em ${n.status || LANES[n.lane].label}`, strong: false };
  return { txt: "", strong: false };
};
const pathLen = (a, b) => Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 1.15) + 1;

/* ---------- horizontal: tempo da esquerda para a direita ---------- */

function horizontal(H, st, dim) {
  const RH = 30, TOP = 26, DX = 66, X0 = 22;
  const rowY = (c) => TOP + c * RH + RH / 2;
  const axisY = TOP + LANES.length * RH + 14;
  const N = H.nodes.length;
  const w = X0 + (N - 1) * DX + 30, h = axisY + 20;
  const pts = H.nodes.map((n, i) => ({ x: X0 + i * DX, y: rowY(n.lane) }));
  let svg = LANES.map((l, c) => `<line x1="0" y1="${rowY(c)}" x2="${w}" y2="${rowY(c)}" stroke="${l.c}" stroke-opacity=".16" stroke-width="2"/>`).join("");
  svg += pts.map((p) => `<line x1="${p.x}" y1="${TOP}" x2="${p.x}" y2="${axisY - 12}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 3"/>`).join("");
  for (let i = 1; i < N; i++) {
    const a = pts[i - 1], b = pts[i], n = H.nodes[i], delay = `${(i * 0.04).toFixed(2)}s`;
    if (n.back) {
      const peak = Math.min(a.y, b.y) - 22 - Math.abs(a.y - b.y) * 0.25;
      svg += `<path d="M${a.x} ${a.y} C${a.x + 6} ${peak} ${b.x - 6} ${peak} ${b.x} ${b.y}" fill="none" stroke="${RED}" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round" opacity="${dim(i) ? 0.25 : 1}"/>`;
      svg += `<text x="${(a.x + b.x) / 2}" y="${peak + 4}" font-size="10.5" font-weight="700" fill="${RED}" text-anchor="middle" opacity="${dim(i) ? 0.25 : 1}">voltou</text>`;
    } else {
      const d = a.y === b.y ? `M${a.x} ${a.y} L${b.x} ${b.y}` : `M${a.x} ${a.y} C${a.x + DX * 0.55} ${a.y} ${b.x - DX * 0.55} ${b.y} ${b.x} ${b.y}`;
      const len = DX + Math.abs(a.y - b.y);
      svg += `<path class="hist-flow" d="${d}" fill="none" stroke="${LANES[n.lane].c}" stroke-width="2.5" stroke-linecap="round" style="--len:${len};stroke-dasharray:${len};animation-delay:${delay}" opacity="${st.only ? 0.2 : 1}"/>`;
    }
  }
  H.nodes.forEach((n, i) => {
    const p = pts[i], on = i === st.sel, last = i === N - 1, c = n.back ? RED : LANES[n.lane].c;
    const r = on ? 8 : last ? 7 : n.back ? 6 : 5;
    svg += `<circle class="hist-dot" cx="${p.x}" cy="${p.y}" r="${r}" fill="${on || last ? LANES[n.lane].c : "var(--surface)"}" stroke="${c}" stroke-width="${on ? 3.5 : 2.5}" style="animation-delay:${(i * 0.04).toFixed(2)}s" opacity="${dim(i) ? 0.25 : 1}"/>`;
    svg += `<circle class="hist-hit" data-pick="${i}" cx="${p.x}" cy="${p.y}" r="13" fill="transparent"><title>${esc(`${n.title} · ${whenOf(n.at)}${n.by ? ` · ${n.by}` : ""}`)}</title></circle>`;
    svg += `<text x="${p.x}" y="${axisY}" font-size="10.5" fill="${on ? "var(--txt)" : "var(--muted)"}" font-weight="${on ? 700 : 400}" text-anchor="middle">${dayOf(n.at)}</text>`;
    svg += `<text x="${p.x}" y="${axisY + 13}" font-size="10" fill="var(--faint)" text-anchor="middle">${hourOf(n.at)}</text>`;
  });
  const lanes = LANES.map((l, c) => `<span style="top:${TOP + c * RH}px;color:${l.c}"><i style="background:${l.c}"></i>${esc(l.label)}</span>`).join("");
  const n = H.nodes[st.sel], last = st.sel === N - 1, note = noteLine(H, st.sel);
  return `
    <div class="hist-h">
      <div class="hist-lanes" style="height:${h}px">${lanes}</div>
      <div class="hist-scroll"><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Caminho da demanda no quadro, da esquerda (mais antigo) para a direita">${svg}</svg></div>
    </div>
    <div class="hist-det${n.back ? " back" : ""}">
      <div class="hist-det-top">
        <button type="button" class="hist-ic" data-prev aria-label="Ação anterior"${st.sel ? "" : " disabled"}>‹</button>
        <b>${esc(n.title)}${last ? " · agora" : ""}</b>
        <span>${st.sel + 1} de ${N}</span>
        <button type="button" class="hist-ic" data-next aria-label="Próxima ação"${last ? " disabled" : ""}>›</button>
      </div>
      <span class="hist-when">${whenOf(n.at)}${byLine(H, st.sel) ? ` · ${esc(byLine(H, st.sel))}` : ""}</span>
      <span class="hist-note${note.strong ? " strong" : ""}">${esc(note.txt || "Sem comentário nesta ação.")}</span>
    </div>`;
}

/* ---------- vertical: uma ação por linha ---------- */

function vertical(H, st, dim) {
  const ROW = 60, X0 = 14, DX = 26;
  const N = H.nodes.length;
  const pts = H.nodes.map((n, i) => ({ x: X0 + n.lane * DX, y: 30 + i * ROW }));
  const hgt = 30 + (N - 1) * ROW + 34;
  let svg = LANES.map((l, c) => `<line x1="${X0 + c * DX}" y1="0" x2="${X0 + c * DX}" y2="${hgt}" stroke="${l.c}" stroke-opacity=".14" stroke-width="2"/>`).join("");
  for (let i = 1; i < N; i++) {
    const a = pts[i - 1], b = pts[i], n = H.nodes[i], op = dim(i) ? 0.25 : 1;
    if (n.back) {
      const bulge = Math.max(a.x, b.x) + 34 + Math.abs(a.x - b.x) * 0.15;
      svg += `<path d="M${a.x} ${a.y} C${bulge} ${a.y + 4} ${bulge} ${b.y - 4} ${b.x} ${b.y}" fill="none" stroke="${RED}" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round" opacity="${op}"/>`;
      svg += `<text x="${bulge - 4}" y="${(a.y + b.y) / 2 + 4}" font-size="10.5" font-weight="700" fill="${RED}" text-anchor="middle" opacity="${op}">voltou</text>`;
    } else {
      const d = a.x === b.x ? `M${a.x} ${a.y} L${b.x} ${b.y}` : `M${a.x} ${a.y} C${a.x} ${a.y + ROW * 0.55} ${b.x} ${b.y - ROW * 0.55} ${b.x} ${b.y}`;
      const len = pathLen(a, b) + ROW;
      svg += `<path class="hist-flow" d="${d}" fill="none" stroke="${LANES[n.lane].c}" stroke-width="2.5" stroke-linecap="round" style="--len:${len};stroke-dasharray:${len};animation-delay:${(i * 0.04).toFixed(2)}s" opacity="${st.only ? 0.2 : 1}"/>`;
    }
  }
  H.nodes.forEach((n, i) => {
    const p = pts[i], last = i === N - 1;
    svg += `<circle class="hist-dot" cx="${p.x}" cy="${p.y}" r="${last ? 7 : n.back ? 6 : 5}" fill="${last ? LANES[n.lane].c : "var(--surface)"}" stroke="${n.back ? RED : LANES[n.lane].c}" stroke-width="2.5" style="animation-delay:${(i * 0.04).toFixed(2)}s" opacity="${dim(i) ? 0.25 : 1}"/>`;
  });
  const rows = H.nodes.map((n, i) => {
    const note = noteLine(H, i), last = i === N - 1;
    return `<div class="hist-ev${n.back ? " back" : ""}" style="top:${pts[i].y - 27}px;opacity:${dim(i) ? 0.25 : 1}">
      <span class="t">${esc(n.title)}${last ? " · agora" : ""}</span>
      <span class="s">${whenOf(n.at)}${byLine(H, i) ? ` · ${esc(byLine(H, i))}` : ""}</span>
      ${note.txt ? `<span class="n${note.strong ? " strong" : ""}">${esc(note.txt)}</span>` : ""}</div>`;
  }).join("");
  const cols = LANES.map((l) => `<span title="${esc(l.label)}" style="color:${l.c}">${l.short}</span>`).join("");
  return `
    <div class="hist-v">
      <div class="hist-cols">${cols}</div>
      <div class="hist-vbox" style="height:${hgt}px">
        <svg width="184" height="${hgt}" viewBox="0 0 184 ${hgt}" aria-hidden="true">${svg}</svg>
        ${rows}
      </div>
    </div>`;
}
