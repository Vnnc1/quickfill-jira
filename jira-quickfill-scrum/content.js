/**
 * Injeta o modal do QuickFill sobre a página do Jira.
 * O formulário roda dentro de um <iframe> da própria extensão, então o CSS
 * do Jira não interfere e vice-versa.
 */

const HOST_ID = "jira-quickfill-scrum-host";

function currentIssueKey() {
  const m =
    location.pathname.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/i) ||
    location.search.match(/selectedIssue=([A-Z][A-Z0-9_]+-\d+)/i) ||
    location.pathname.match(/\/issues\/([A-Z][A-Z0-9_]+-\d+)/i);
  return m ? m[1].toUpperCase() : "";
}

function open() {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.className = "jqf-backdrop";

  const frame = document.createElement("iframe");
  const key = currentIssueKey();
  frame.className = "jqf-frame jqf-frame-scrum";
  frame.src = chrome.runtime.getURL("modal.html") + (key ? `?key=${encodeURIComponent(key)}` : "");
  frame.setAttribute("allowtransparency", "true");

  host.appendChild(frame);
  try { chrome.storage.local.get({ uiScale: 1 }, (v) => sizeFrame(v?.uiScale)); } catch { /* segue no tamanho padrão */ }
  host.addEventListener("click", (e) => { if (e.target === host) close(); });
  document.documentElement.appendChild(host);
}

/** Remove o overlay imediatamente. */
function destroy() {
  document.getElementById(HOST_ID)?.remove();
}

/**
 * Fecha pedindo antes que o modal grave o rascunho. O iframe responde com
 * QUICKFILL_CLOSE; se não responder em 400ms, fecha assim mesmo.
 */
function close() {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  const frame = host.querySelector("iframe");
  if (!frame?.contentWindow) return destroy();
  frame.contentWindow.postMessage({ type: "QUICKFILL_REQUEST_CLOSE" }, "*");
  setTimeout(destroy, 400);
}

function toggle() {
  document.getElementById(HOST_ID) ? close() : open();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "QUICKFILL_TOGGLE") toggle();
  if (msg?.type === "QUICKFILL_OPEN_MODAL") open();
});

/* Tamanho escolhido no modal (−/+): a moldura cresce ou encolhe junto. */
const BASE_W = 1000, BASE_H = 860;
function sizeFrame(scale) {
  const frame = document.querySelector(`#${HOST_ID} iframe`);
  if (!frame) return;
  const z = Math.min(1.5, Math.max(0.8, Number(scale) || 1));
  frame.style.width = `min(${Math.round(BASE_W * z)}px, 96vw)`;
  frame.style.height = `min(${Math.round(BASE_H * z)}px, 94vh)`;
}

window.addEventListener("message", (e) => {
  if (e.data?.type === "QUICKFILL_CLOSE") destroy();
  if (e.data?.type === "QUICKFILL_SCALE") sizeFrame(e.data.scale);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") close();
});

/* Os botões no canto do Jira saíram: o QuickFill abre pelo ícone da extensão ou pelo atalho.
   Tira os que ficaram de uma versão anterior nesta aba. */
document.querySelectorAll(".jqf-launcher").forEach((b) => b.remove());
