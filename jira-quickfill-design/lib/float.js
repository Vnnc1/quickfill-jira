/**
 * Janela flutuante do QuickFill (teste, nos 4 perfis).
 *
 * A mesma página modal.html roda em três lugares:
 *   - barra lateral do Chrome      → botão "Soltar como janela" abre uma janela popup e fecha a barra
 *   - janela popup (?float=window) → janela comum; o alfinete a fixa por cima de tudo
 *   - janela fixada (?float=pip)   → Document Picture-in-Picture aberta pela janela popup, que fica
 *                                    minimizada como "dona" dela (a janela fixada fecha se a dona fechar)
 *
 * Tamanhos: minimizado e compacto. O compacto pode ser redimensionado pelas bordas da janela;
 * o tamanho escolhido fica guardado. As janelas conversam por BroadcastChannel.
 *
 * Abrindo: a janela nova (solta ou fixada) começa com o último resumo guardado e um indicador de
 * "atualizando" até os dados chegarem do Jira, em vez de ficar alguns segundos com a tela vazia.
 */

import { parseDuration, formatJira } from "./duration.js";

export const FLOAT_SIZES = {
  mini: { w: 520, h: 62 },
  compact: { w: 380, h: 560 },   // padrão; vale o último tamanho que você deixou
};
const CORNER_NAME = { tl: "superior esquerdo", tr: "superior direito", bl: "inferior esquerdo", br: "inferior direito" };
const MARGIN = 16;
const channel = () => new BroadcastChannel("quickfill-float");

const SNAP_KEY = "qf.floatSnap";
const readSnap = () => { try { return JSON.parse(localStorage.getItem(SNAP_KEY) || "null"); } catch { return null; } };
let snapNow = () => {};   // barra lateral: guarda o resumo na hora de soltar a janela

const params = new URLSearchParams(location.search);
const KIND = params.get("float");            // "window" | "pip" | null
const $ = (id) => document.getElementById(id);

async function corner() {
  try { return (await chrome.storage.local.get({ floatCorner: "tr" })).floatCorner; } catch { return "tr"; }
}

/** Posição (left/top de tela) para um canto, dado o tamanho externo da janela. */
function cornerXY(c, outerW, outerH, scr = window.screen) {
  const left = scr.availLeft ?? 0, top = scr.availTop ?? 0;
  return {
    left: Math.round(c[1] === "l" ? left + MARGIN : left + scr.availWidth - outerW - MARGIN),
    top: Math.round(c[0] === "t" ? top + MARGIN : top + scr.availHeight - outerH - MARGIN),
  };
}

/** Tamanho do compacto: o último que você ajustou pelas bordas, ou o padrão. */
async function compactSize() {
  try {
    const { floatCompact } = await chrome.storage.local.get({ floatCompact: null });
    if (floatCompact?.w >= 300 && floatCompact?.h >= 320) return floatCompact;
  } catch { /* segue no padrão */ }
  return FLOAT_SIZES.compact;
}

const floatUrl = (kind, size, win) =>
  chrome.runtime.getURL(`modal.html?float=${kind}&size=${size}${win ? `&win=${win}` : ""}`);

/* ------------------------------------------------------------------ */
/* Barra lateral: soltar como janela                                   */
/* ------------------------------------------------------------------ */

export async function popOutFromPanel({ saveView, toast }) {
  try {
    snapNow();          // a janela já abre com o resumo atual
    await saveView();   // a janela abre exatamente onde você está
    const browser = await chrome.windows.getCurrent();
    const size = "compact", { w, h } = await compactSize();
    const outerW = w + 16, outerH = h + 39;   // borda e barra de título; a janela corrige ao abrir
    const pos = cornerXY(await corner(), outerW, outerH);
    await chrome.windows.create({ url: floatUrl("window", size, browser.id), type: "popup", width: outerW, height: outerH, ...pos, focused: true });
    window.close();     // fecha a barra lateral
  } catch (e) {
    toast(`Não deu para abrir a janela: ${e.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Dentro da janela (popup ou fixada)                                  */
/* ------------------------------------------------------------------ */

export function initFloat(a) {
  api = a;
  if (!$("floatMini")) return;   // sem a marcação nova (cache antigo), fica como painel comum
  const bootAt = Date.now();
  const saveSnap = (mode) => {
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify({
        mode, key: $("fmKey").textContent, title: $("fmTitle").textContent, sub: $("fmSub").textContent,
        ring: $("fmRing").style.strokeDashoffset, badge: $("fmRingSvg").classList.contains("hidden") ? $("fmBadge").textContent : "", at: Date.now(),
      }));
    } catch { /* sem storage */ }
  };
  const dropSnap = (mode) => { try { if (readSnap()?.mode === mode) localStorage.removeItem(SNAP_KEY); } catch { /* sem storage */ } };

  if (!KIND) {
    // barra lateral: só mantém o resumo guardado para a janela abrir já com ele
    const tick = () => {
      const mode = api.mode();
      if (paintMini()) saveSnap(mode);
      else if (Date.now() - bootAt > 20000) dropSnap(mode);
    };
    snapNow = tick;
    setInterval(() => { if (!document.hidden) tick(); }, 4000);
    return;
  }
  const root = document.documentElement;
  root.classList.add("float", `float-${KIND}`);
  const win = Number(params.get("win")) || null;
  let size = params.get("size") === "mini" ? "mini" : "compact";
  let pip = null;            // (popup) janela fixada aberta por esta página
  let unpinning = false;
  const bc = channel();
  let compactDims = FLOAT_SIZES.compact;   // em memória: fixar precisa abrir na hora do clique, sem esperar o storage
  compactSize().then((d) => { compactDims = d; });

  /* ---- tamanho da janela que nos contém ---- */
  async function resizeHost(s) {
    const { w, h } = s === "mini" ? FLOAT_SIZES.mini : compactDims;
    if (KIND === "pip") {
      const host = window.parent;   // documento da janela fixada (mesma origem)
      try { host.resizeTo(w + (host.outerWidth - host.innerWidth), h + (host.outerHeight - host.innerHeight)); } catch { /* sem gesto: fica como está */ }
      return;
    }
    try {
      const me = await chrome.windows.getCurrent();
      const outerW = w + (window.outerWidth - window.innerWidth), outerH = h + (window.outerHeight - window.innerHeight);
      const c = await corner();
      await chrome.windows.update(me.id, { width: outerW, height: outerH, ...cornerXY(c, outerW, outerH) });
    } catch { /* a janela continua no tamanho atual */ }
  }

  /** Guarda o tamanho do compacto quando você o ajusta pelas bordas. */
  let saveTimer = 0;
  window.addEventListener("resize", () => {
    if (size !== "compact") return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const w = window.innerWidth, h = window.innerHeight;
      if (w >= 300 && h >= 320) { compactDims = { w, h }; chrome.storage.local.set({ floatCompact: compactDims }).catch(() => {}); }
    }, 400);
  });

  function setSize(s, { resize = true } = {}) {
    size = s;
    root.dataset.size = s;
    if (s === "mini") fillMini();
    // transição curta do conteúdo (a moldura quem redimensiona é o sistema)
    const app = $("app");
    app.classList.remove("float-in"); void app.offsetWidth; app.classList.add("float-in");
    if (resize) resizeHost(s);
    if (KIND === "pip") bc.postMessage({ t: "pip-size", size: s });
  }

  /* ---- minimizado: resumo da aba atual (o desenho fica em paintMini, no fim do arquivo) ---- */
  let settled = false;
  /** Pinta o resumo; enquanto os dados não chegam, mostra o último resumo (ou "Carregando…") girando. */
  function fillMini() {
    const mode = api.mode(), mini = $("floatMini");
    const real = paintMini();
    if (real) { settled = true; mini.classList.remove("loading"); saveSnap(mode); return; }
    const snap = readSnap(), same = snap?.mode === mode && (snap.title || snap.key);
    // a tela salva já voltou e não há subtarefa escolhida: "Nenhuma subtarefa" é a tela de verdade
    if (!settled && mode === "single" && !api.booting?.()) { settled = true; if (same) dropSnap(mode); }
    if (!settled && Date.now() - bootAt > (same ? 20000 : 10000)) { settled = true; if (same) dropSnap(mode); }
    if (settled) { mini.classList.remove("loading"); return; }
    mini.classList.add("loading");
    $("fmQuick").classList.add("hidden");
    $("fmAction").textContent = "Abrir"; $("fmAction").dataset.do = "open"; $("fmAction").disabled = false;
    if (same) {
      if (snap.badge) { $("fmRingSvg").classList.add("hidden"); $("fmBadge").classList.remove("hidden"); $("fmBadge").textContent = snap.badge; }
      else { $("fmRingSvg").classList.remove("hidden"); $("fmBadge").classList.add("hidden"); $("fmRing").style.strokeDashoffset = snap.ring || "94.25"; }
      $("fmKey").textContent = snap.key; $("fmTitle").textContent = snap.title; $("fmSub").textContent = `${snap.sub} · atualizando…`;
    } else {
      $("fmRingSvg").classList.remove("hidden"); $("fmBadge").classList.add("hidden");
      $("fmKey").textContent = tabLabel(mode); $("fmTitle").textContent = "Carregando…"; $("fmSub").textContent = "buscando os dados no Jira";
    }
  }
  // no começo confere a cada meio segundo; depois, a cada 5s
  const fast = setInterval(() => { if (settled) clearInterval(fast); else if (size === "mini") fillMini(); }, 500);
  setInterval(() => { if (size === "mini" && !document.hidden) fillMini(); }, 5000);
  $("fmQuick").addEventListener("click", () => {
    // +15m soma ao que já está em "Apontar" (os atalhos do formulário trocam o valor)
    const inp = $("spent"), cur = parseDuration(inp.value);
    inp.value = formatJira((cur.ok ? cur.minutes : 0) + 15);
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    fillMini();
  });
  $("fmAction").addEventListener("click", (e) => {
    if (e.currentTarget.dataset.do === "apply" && !$("btnApply").disabled) { $("btnApply").click(); setTimeout(fillMini, 1500); return; }
    setSize("compact");
  });
  $("fmGrow").addEventListener("click", () => setSize("compact"));
  $("btnMin").addEventListener("click", () => setSize("mini"));

  /* ---- fixar por cima de tudo ---- */
  const pinned = KIND === "pip";
  for (const id of ["btnPin", "fmPin"]) {
    $(id).classList.toggle("on", pinned);
    $(id).setAttribute("aria-pressed", String(pinned));
    $(id).title = pinned ? "Desafixar (volta a ser uma janela comum)" : "Fixar por cima de tudo";
    $(id).addEventListener("click", async () => {
      if (!pinned) return pinNow();
      await api.saveView();   // a janela comum reabre onde você parou
      bc.postMessage({ t: "unpin", size });
    });
  }

  async function pinNow() {
    if (!("documentPictureInPicture" in window)) return api.toast("Este Chrome não tem janela fixável (Picture-in-Picture). Atualize o Chrome.");
    if (pip) { pip.focus?.(); return; }
    fillMini();   // a janela fixada já abre com este resumo
    try {
      const { w, h } = size === "mini" ? FLOAT_SIZES.mini : compactDims;
      pip = await window.documentPictureInPicture.requestWindow({ width: w, height: h });
      const d = pip.document;
      d.title = document.title;
      d.body.style.cssText = "margin:0;background:#14171a;overflow:hidden";
      // enquanto a página carrega: o logo girando, em vez de uma tela vazia
      const load = d.createElement("div");
      load.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;gap:10px;color:#94a3b4;font:600 12.5px -apple-system,'Segoe UI',sans-serif";
      load.innerHTML = `<svg width="22" height="22" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="#2d353c" stroke-width="4"/><circle cx="18" cy="18" r="15" fill="none" stroke="${getComputedStyle(root).getPropertyValue("--accent").trim() || "#579dff"}" stroke-width="4" stroke-linecap="round" stroke-dasharray="94.25" stroke-dashoffset="70"><animateTransform attributeName="transform" type="rotate" from="0 18 18" to="360 18 18" dur=".9s" repeatCount="indefinite"/></circle></svg>Carregando o QuickFill…`;
      d.body.appendChild(load);
      const f = d.createElement("iframe");
      f.src = floatUrl("pip", size, win);
      f.style.cssText = "border:0;width:100vw;height:100vh;display:block;position:relative;opacity:0;transition:opacity .18s";
      f.allow = "clipboard-write";
      f.addEventListener("load", () => { f.style.opacity = "1"; setTimeout(() => load.remove(), 200); }, { once: true });
      d.body.appendChild(f);
      pip.addEventListener("pagehide", () => {
        pip = null;
        if (unpinning) { unpinning = false; restoreWindow(); }
        else window.close();     // fechou a janela fixada no X: fecha tudo
      });
      root.classList.add("float-owner");
      await hideOwner();
    } catch (e) {
      pip = null;
      api.toast(`Não deu para fixar: ${e.message}`);
    }
  }

  /** Esconde esta janela comum enquanto a fixada estiver aberta (ela precisa continuar existindo). */
  async function hideOwner() {
    const me = await chrome.windows.getCurrent();
    const minimize = () => chrome.windows.update(me.id, { state: "minimized", focused: false }).catch(() => {});
    await minimize();
    await new Promise((r) => setTimeout(r, 350));
    let w = await chrome.windows.get(me.id).catch(() => null);
    if (w && w.state !== "minimized") { await minimize(); await new Promise((r) => setTimeout(r, 350)); w = await chrome.windows.get(me.id).catch(() => null); }
    if (w && w.state !== "minimized") {
      chrome.windows.update(me.id, { state: "normal", left: -32000, top: -32000, width: 120, height: 60, focused: false }).catch(() => {});
    }
  }

  async function restoreWindow() {
    try {
      const me = await chrome.windows.getCurrent();
      await chrome.windows.update(me.id, { state: "normal", focused: true });
    } catch { /* segue */ }
    location.replace(floatUrl("window", size, win));   // recarrega com o que foi feito na janela fixada
  }

  /* ---- canto da tela ---- */
  async function paintCorners() {
    const c = await corner();
    document.querySelectorAll("#floatPin [data-corner]").forEach((b) => b.classList.toggle("on", b.dataset.corner === c));
    $("floatPinTxt").textContent = `Canto ${CORNER_NAME[c]}`;
  }
  document.querySelectorAll("#floatPin [data-corner]").forEach((b) => b.addEventListener("click", async () => {
    const c = b.dataset.corner;
    try { await chrome.storage.local.set({ floatCorner: c }); } catch { /* segue */ }
    paintCorners();
    if (KIND === "window") return resizeHost(size);
    // janela fixada: tenta mover; o Chrome pode não deixar
    const host = window.parent, before = [host.screenX, host.screenY];
    try { const p = cornerXY(c, host.outerWidth, host.outerHeight, host.screen); host.moveTo(p.left, p.top); } catch { /* sem suporte */ }
    setTimeout(() => {
      if (host.screenX === before[0] && host.screenY === before[1]) $("floatPinTxt").textContent = "Arraste a janela até o canto; o Chrome lembra o lugar";
    }, 250);
  }));
  paintCorners();

  /* ---- voltar para a barra lateral ---- */
  $("btnSide").addEventListener("click", async () => {
    await api.saveView();
    try {
      const target = win || (await chrome.windows.getLastFocused({ windowTypes: ["normal"] })).id;
      await chrome.sidePanel.open({ windowId: target });
    } catch (e) {
      api.toast("Não deu para abrir a barra lateral daqui — clique no ícone da extensão na barra do Chrome.", "info");
      return;
    }
    bc.postMessage({ t: "close" });
    if (KIND === "window") window.close();
  });

  /* ---- mensagens entre a janela comum e a fixada ---- */
  bc.onmessage = (e) => {
    const m = e.data || {};
    if (KIND === "window") {
      if (m.t === "unpin" && pip) { size = m.size || size; unpinning = true; pip.close(); }
      if (m.t === "close") { pip?.close(); window.close(); }
      if (m.t === "pip-size") size = m.size;
    }
  };
  setSize(size, { resize: KIND === "window" });
}

/* ------------------------------------------------------------------ */
/* Resumo do minimizado (aba atual, com o filtro e a data da tela)     */
/* ------------------------------------------------------------------ */

const C = 94.25;
let api = null;
// "visível" pela marcação (no minimizado o resto da tela está escondido de propósito)
const visible = (el) => el && !el.closest(".hidden, .role-off, [hidden]");
const tabLabel = (mode) => document.querySelector(`.tab[data-mode="${mode}"]`)?.textContent.trim() || "QuickFill";

/** Filtros ativos: Espaço/Período do topo e o primeiro seletor da aba. */
function filters(mode) {
  const out = [];
  for (const bar of document.querySelectorAll(".spacebar")) if (visible(bar)) { const on = bar.querySelector(".seg button.on"); if (on) out.push(on.textContent.trim()); }
  const pane = document.querySelector(`[data-pane="${mode}"]`);
  const own = pane && [...pane.querySelectorAll(".seg button.on:not([data-sort])")].find(visible);
  if (own) out.push(own.textContent.trim());
  return [...new Set(out)].join(", ");
}

function showRing(total, goal) {
  $("fmRingSvg").classList.remove("hidden"); $("fmBadge").classList.add("hidden");
  $("fmRing").style.strokeDashoffset = String(C * (1 - Math.min(1, goal ? total / goal : 0)));
}
function showBadge(text) {
  $("fmRingSvg").classList.add("hidden"); $("fmBadge").classList.remove("hidden");
  $("fmBadge").textContent = text;
}

function paintMini() {
  const mode = api.mode();
  const quick = $("fmQuick"), act = $("fmAction");
  quick.classList.add("hidden");
  act.textContent = "Abrir"; act.dataset.do = "open"; act.disabled = false;

  if (mode === "single") {
    $("fmRing").style.strokeDashoffset = $("ringFg").style.strokeDashoffset || String(C);
    $("fmRingSvg").classList.remove("hidden"); $("fmBadge").classList.add("hidden");
    const sel = document.querySelector("#subtaskList .item.sel");
    const spent = $("spent")?.value.trim();
    $("fmKey").textContent = sel?.querySelector(".k")?.textContent.trim() || "";
    $("fmTitle").textContent = sel ? sel.querySelector(".s")?.textContent.trim() || "" : "Nenhuma subtarefa escolhida";
    $("fmSub").textContent = sel ? (spent ? `${spent} para apontar` : `Hoje: ${$("dayPillVal").textContent.trim()}`) : "Abra para buscar a tarefa";
    if (sel) { quick.classList.remove("hidden"); act.textContent = "Aplicar"; act.dataset.do = "apply"; act.disabled = $("btnApply").disabled; }
    else act.textContent = "Buscar";
    return !!sel;
  }

  const day = api.day?.();
  if (day && (mode === "day" || mode === "today")) {
    showRing(day.total, day.goal);
    const when = day.date === api.today() ? "hoje" : api.dayShort(day.date);
    $("fmKey").textContent = tabLabel(mode);
    $("fmTitle").textContent = `${api.fmt(day.total)} de ${api.fmt(day.goal)}`;
    $("fmSub").textContent = `${when}, ${day.total >= day.goal ? "meta batida" : `faltam ${api.fmt(day.goal - day.total)}`}`;
    return true;
  }

  // SCRUM, Sprint: andamento da sprint (itens feitos x tempo decorrido)
  const sp = mode === "sprint" && document.querySelector('[data-pane="sprint"] .pg-sprint');
  if (sp) {
    const bars = [...sp.querySelectorAll(".sc-bar")].map((x) => [x.querySelector("span")?.textContent.trim(), x.querySelector("b")?.textContent.trim()]);
    const items = bars.find(([k]) => /itens/i.test(k))?.[1] || "", time = bars.find(([k]) => /tempo/i.test(k))?.[1] || "";
    showRing(parseFloat(items) || 0, 100);
    $("fmKey").textContent = sp.querySelector(".pg-sprint-top b")?.textContent.trim() || tabLabel(mode);
    $("fmTitle").textContent = sp.querySelector(".pg-sprint-st")?.textContent.trim() || "";
    $("fmSub").textContent = [items && `itens ${items} feitos`, time && `tempo ${time}`].filter(Boolean).join(", ") || filters(mode);
    return true;
  }

  // demais abas: o primeiro número de destaque da tela, com os filtros aplicados
  const pane = document.querySelector(`[data-pane="${mode}"]`);
  const hero = pane?.querySelector(".t-hero-l");
  const tile = hero ? null : [...(pane?.querySelectorAll(".quick.on, .m-kpi, .kpi, .dm-tile") || [])].find(visible);
  const value = (hero || tile)?.querySelector("b")?.textContent.trim();
  const label = hero ? hero.querySelector("span")?.textContent.trim() : tile?.querySelector("span")?.textContent.replace(/^[^\p{L}\d]+/u, "").trim();
  $("fmKey").textContent = tabLabel(mode);
  if (value) { showBadge(value.length > 7 ? value.split(" ")[0] : value); $("fmTitle").textContent = label || ""; }
  else { showRing(0, 1); $("fmTitle").textContent = "Abra para ver os detalhes"; }
  $("fmSub").textContent = filters(mode) || `Hoje: ${$("dayPillVal").textContent.trim()}`;
  return !!value;
}
