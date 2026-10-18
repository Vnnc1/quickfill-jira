/**
 * Janela flutuante do QuickFill (teste, só no QA).
 *
 * A mesma página modal.html roda em três lugares:
 *   - barra lateral do Chrome      → botão "Soltar como janela" abre uma janela popup e fecha a barra
 *   - janela popup (?float=window) → janela comum; o alfinete a fixa por cima de tudo
 *   - janela fixada (?float=pip)   → Document Picture-in-Picture aberta pela janela popup, que fica
 *                                    minimizada como "dona" dela (a janela fixada fecha se a dona fechar)
 *
 * Tamanhos: ícone → minimizado → compacto → expandido. As janelas conversam por BroadcastChannel.
 */

import { parseDuration, formatJira } from "./duration.js";

export const FLOAT_SIZES = {
  icon: { w: 64, h: 64 },
  mini: { w: 520, h: 62 },
  compact: { w: 380, h: 560 },
  full: { w: 480, h: 740 },
};
const CORNER_NAME = { tl: "superior esquerdo", tr: "superior direito", bl: "inferior esquerdo", br: "inferior direito" };
const MARGIN = 16;
const channel = () => new BroadcastChannel("quickfill-float");

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

const floatUrl = (kind, size, win) =>
  chrome.runtime.getURL(`modal.html?float=${kind}&size=${size}${win ? `&win=${win}` : ""}`);

/* ------------------------------------------------------------------ */
/* Barra lateral: soltar como janela                                   */
/* ------------------------------------------------------------------ */

export async function popOutFromPanel({ saveView, toast }) {
  try {
    await saveView();   // a janela abre exatamente onde você está
    const browser = await chrome.windows.getCurrent();
    const size = "compact", { w, h } = FLOAT_SIZES[size];
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

export function initFloat(api) {
  if (!KIND || !$("floatMini")) return;   // sem a marcação nova (cache antigo), fica como painel comum
  const root = document.documentElement;
  root.classList.add("float", `float-${KIND}`);
  const win = Number(params.get("win")) || null;
  let size = FLOAT_SIZES[params.get("size")] ? params.get("size") : "compact";
  let pip = null;            // (popup) janela fixada aberta por esta página
  let unpinning = false;
  const bc = channel();

  /* ---- tamanho da janela que nos contém ---- */
  async function resizeHost(s) {
    const { w, h } = FLOAT_SIZES[s];
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

  function setSize(s, { resize = true } = {}) {
    size = s;
    root.dataset.size = s;
    $("btnGrow").title = s === "full" ? "Compactar" : "Expandir";
    $("btnGrow").setAttribute("aria-label", $("btnGrow").title);
    $("btnGrow").classList.toggle("is-full", s === "full");
    if (s === "mini") fillMini();
    // transição curta do conteúdo (a moldura quem redimensiona é o sistema)
    const app = $("app");
    app.classList.remove("float-in"); void app.offsetWidth; app.classList.add("float-in");
    if (resize) resizeHost(s);
    if (KIND === "pip") bc.postMessage({ t: "pip-size", size: s });
  }

  /* ---- minimizado: resumo da aba atual ---- */
  function fillMini() {
    $("fmRing").style.strokeDashoffset = $("ringFg").style.strokeDashoffset || "94.25";
    const day = $("dayPillVal").textContent.trim();
    const mode = api.mode();
    const quick = $("fmQuick"), act = $("fmAction");
    quick.classList.add("hidden");
    if (mode === "single") {
      const sel = document.querySelector("#subtaskList .item.sel");
      const spent = $("spent")?.value.trim();
      $("fmKey").textContent = sel?.querySelector(".k")?.textContent.trim() || "";
      $("fmTitle").textContent = sel ? sel.querySelector(".s")?.textContent.trim() || "" : "Nenhuma subtarefa escolhida";
      $("fmSub").textContent = sel ? (spent ? `${spent} para apontar` : `Hoje: ${day}`) : "Abra para buscar a tarefa";
      if (sel) { quick.classList.remove("hidden"); act.textContent = "Aplicar"; act.dataset.do = "apply"; act.disabled = $("btnApply").disabled; }
      else { act.textContent = "Buscar"; act.dataset.do = "open"; act.disabled = false; }
    } else {
      const label = document.querySelector(`.tab[data-mode="${mode}"]`)?.textContent.trim() || "QuickFill";
      $("fmKey").textContent = "";
      $("fmTitle").textContent = mode === "day" ? `${day} hoje` : label;
      $("fmSub").textContent = mode === "day" ? $("dayPillGoal").textContent : `Hoje: ${day}`;
      act.textContent = "Abrir"; act.dataset.do = "open"; act.disabled = false;
    }
  }
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
  $("fmIcon").addEventListener("click", () => setSize("icon"));
  $("fmGrow").addEventListener("click", () => setSize("compact"));
  $("floatIcon").addEventListener("click", () => setSize("mini"));
  $("btnMin").addEventListener("click", () => setSize("mini"));
  $("btnGrow").addEventListener("click", () => setSize(size === "full" ? "compact" : "full"));

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
    try {
      const { w, h } = FLOAT_SIZES[size];
      pip = await window.documentPictureInPicture.requestWindow({ width: w, height: h });
      const d = pip.document;
      d.title = "QuickFill QA";
      d.body.style.cssText = "margin:0;background:#14171a;overflow:hidden";
      const f = d.createElement("iframe");
      f.src = floatUrl("pip", size, win);
      f.style.cssText = "border:0;width:100vw;height:100vh;display:block";
      f.allow = "clipboard-write";
      d.body.appendChild(f);
      pip.addEventListener("pagehide", () => {
        pip = null;
        if (unpinning) { unpinning = false; restoreWindow(); }
        else window.close();     // fechou a janela fixada no X: fecha tudo
      });
      const me = await chrome.windows.getCurrent();
      await chrome.windows.update(me.id, { state: "minimized" });
      root.classList.add("float-owner");
    } catch (e) {
      pip = null;
      api.toast(`Não deu para fixar: ${e.message}`);
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
