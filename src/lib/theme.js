/**
 * Cor de destaque de cada QuickFill. Padrão por perfil (QA azul, DEV verde, SCRUM âmbar,
 * DESIGN rosa) e uma paleta igual para todos, escolhida nas Opções.
 */

export const ROLE_ACCENT = { qa: "#579dff", dev: "#4bce97", scrum: "#f5b73b", design: "#e774bb" };

export const PALETTE = [
  { id: "azul", name: "Azul", hex: "#579dff" },
  { id: "verde", name: "Verde", hex: "#4bce97" },
  { id: "ambar", name: "Âmbar", hex: "#f5b73b" },
  { id: "rosa", name: "Rosa", hex: "#e774bb" },
  { id: "roxo", name: "Roxo", hex: "#9f8fef" },
  { id: "ciano", name: "Ciano", hex: "#6cc3e0" },
  { id: "laranja", name: "Laranja", hex: "#fea362" },
  { id: "vermelho", name: "Coral", hex: "#f87168" },
];

const hexRgb = (hex) => {
  const m = String(hex).trim().replace("#", "").match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

/** Aplica a cor nos tokens do tema (texto sobre a cor fica escuro ou claro conforme o contraste). */
export function applyAccent(hex, root = document.documentElement) {
  const rgb = hexRgb(hex) || hexRgb(ROLE_ACCENT.qa);
  const [r, g, b] = rgb;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const s = root.style;
  s.setProperty("--accent", `rgb(${r}, ${g}, ${b})`);
  s.setProperty("--accent-rgb", `${r}, ${g}, ${b}`);
  s.setProperty("--accent-soft", `rgba(${r}, ${g}, ${b}, .13)`);
  s.setProperty("--accent-line", `rgba(${r}, ${g}, ${b}, .38)`);
  s.setProperty("--accent-tint", `rgba(${r}, ${g}, ${b}, .07)`);
  s.setProperty("--accent-ink", lum > 0.55 ? "#111518" : "#ffffff");
}

/** Cor salva nas Opções (vazia = a do perfil). Acompanha mudanças feitas com a tela aberta. */
export async function loadAccent(role, root = document.documentElement) {
  const fallback = ROLE_ACCENT[role] || ROLE_ACCENT.qa;
  try {
    const { accentColor } = await chrome.storage.sync.get({ accentColor: "" });
    applyAccent(accentColor || fallback, root);
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === "sync" && ch.accentColor) applyAccent(ch.accentColor.newValue || fallback, root);
    });
  } catch { applyAccent(fallback, root); }
}
