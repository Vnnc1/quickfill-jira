/**
 * QuickFill DESIGN — Execuções da demanda: uma tier list do que falta fazer numa demanda do UX.
 *
 * Faixas: Agora · Próximo · Depois · Aguardando · Feito. Cada execução tem um tipo (Figma, demanda
 * ligada, etapa, checklist de handoff, revisão, reunião, horas, bloqueio, evidência, comentário);
 * arraste entre as faixas ou use ↑ ↓ no card. A lista fica numa propriedade da demanda no Jira
 * (background.js › EXEC_GET / EXEC_SAVE), então todo QuickFill DESIGN vê a mesma.
 * "Salvar no Jira" também troca a descrição (se "Sobre a demanda" mudou), cria os vínculos das
 * demandas ligadas, aponta as Horas e comenta o resumo das faixas.
 */

import { parseDuration } from "./duration.js";

export const EXEC_TIERS = [
  { id: "agora", label: "Agora", note: "fazendo hoje", color: "#e774bb" },
  { id: "prox", label: "Próximo", note: "esta semana", color: "#579dff" },
  { id: "depois", label: "Depois", note: "quando der", color: "#94a3b4" },
  { id: "aguard", label: "Aguardando", note: "depende de alguém", color: "#f5cd47" },
  { id: "feito", label: "Feito", note: "concluído", color: "#4bce97" },
];

export const EXEC_TYPES = {
  figma: { label: "Figma", color: "#e774bb", hint: "Tela ou protótipo da demanda", field: "Link do Figma", ph: "https://www.figma.com/design/…", titlePh: "Meeds V2 › Prescrições" },
  link: { label: "Demanda ligada", color: "#579dff", hint: "HU do MEED, SUS ou outro espaço", field: "Chave da demanda", ph: "MEED-1234 ou SUS-2122", titlePh: "Chat interno" },
  etapa: { label: "Etapa", color: "#94a3b4", hint: "Parte do trabalho: um fluxo, um estado", field: "", titlePh: "Estados de erro da nova prescrição" },
  check: { label: "Checklist de handoff", color: "#9f8fef", hint: "O que o dev precisa para começar", field: "Itens", ph: "Estados · Responsivo · Acessibilidade · Textos", titlePh: "Handoff para o dev" },
  revisao: { label: "Revisão", color: "#fea362", hint: "Pedir aprovação da PO ou do dev", field: "Quem revisa", ph: "Nome de quem revisa", titlePh: "Revisão com a PO" },
  reuniao: { label: "Reunião", color: "#8590a2", hint: "Alinhamento ligado à demanda", field: "Quando", ph: "qui 23/10 · 30m", titlePh: "Alinhamento com o dev" },
  horas: { label: "Horas", color: "#4bce97", hint: "Apontar tempo nesta demanda", field: "Tempo", ph: "1h 30m", titlePh: "Protótipo da tela de dose" },
  bloqueio: { label: "Bloqueio", color: "#f87168", hint: "O que está travando e com quem", field: "Aguardando quem", ph: "Nome de quem destrava", titlePh: "Regra de dose máxima" },
  evid: { label: "Evidência", color: "#6cc3e0", hint: "Print, vídeo ou arquivo", field: "Arquivo ou link", ph: "print-prescricao.png", titlePh: "Print da validação" },
  nota: { label: "Comentário", color: "#94a3b4", hint: "Vai para os comentários no Jira", field: "", titlePh: "Decisão sobre o campo frequência" },
};
const typeOf = (t) => EXEC_TYPES[t] || EXEC_TYPES.etapa;
/** Faixa em que cada tipo entra ao ser criado. */
const DEFAULT_TIER = { horas: "feito", bloqueio: "aguard" };

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmtH = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`; };
const minutesOf = (i) => (i.t === "horas" ? (parseDuration(i.field || "").minutes || 0) : 0);

/** O que mostrar abaixo do título do card. */
function metaOf(i) {
  const T = typeOf(i.t);
  const parts = [i.field ? (T.field ? `${T.field}: ${i.field}` : i.field) : (i.meta || "")];
  if (i.t === "link" && i.linked) parts.push("ligada no Jira");
  if (i.t === "horas") parts.push(i.logged ? "apontado no Jira" : "aponta ao salvar");
  return parts.filter(Boolean).join(" · ");
}

/** Lista de partida quando a demanda ainda não tem execuções: entender a HU, o Figma e o que já está ligado. */
function seedItems(info, figma) {
  let id = 0;
  const items = [
    { id: ++id, tier: "agora", t: "etapa", title: "Entender a HU e os critérios", field: "", detail: "Ler a HU ligada, os anexos e os critérios de aceite." },
    { id: ++id, tier: "prox", t: "figma", title: "Protótipo no Figma", field: figma || "", detail: "" },
  ];
  for (const l of info.links || []) {
    items.push({ id: ++id, tier: "depois", t: "link", title: `${l.key}${l.summary ? ` · ${l.summary}` : ""}`, field: l.key, detail: [l.rel, l.status].filter(Boolean).join(" · "), linked: true });
  }
  return items;
}

let EX = null;   // modal aberto
const drafts = new Map();   // chave -> rascunho não salvo (reabrir não perde o que foi arrumado)

function closeExec({ force = false } = {}) {
  if (!EX) return;
  if (!force && EX.dirty && !confirm("Fechar sem salvar no Jira? O que você arrumou fica guardado aqui até fechar o QuickFill.")) return;
  if (EX.dirty) drafts.set(EX.key, { items: EX.items, desc: EX.desc }); else drafts.delete(EX.key);
  document.removeEventListener("keydown", EX.onKey, true);
  EX.back.remove();
  EX.opener?.focus?.();
  EX = null;
}

/**
 * Abre o modal de Execuções.
 * @param D     helpers do modal.js: { send, toast, jiraLink }
 * @param opts  { key, title, figma (link conhecido), onSaved }
 */
export async function openExec(D, { key, title, figma = "", onSaved } = {}) {
  closeExec({ force: true });
  const back = el("div", "fx-back ex-back");
  const modal = el("div", "ex-modal");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", `Execuções de ${key}`);
  back.append(modal);
  back.addEventListener("mousedown", (e) => { if (e.target === back) closeExec(); });
  document.body.append(back);
  EX = { D, key, title, back, modal, opener: document.activeElement, items: [], desc: "", desc0: "", info: null, dirty: false,
    sel: null, drag: null, cmp: null, saving: false, onSaved,
    onKey: (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); if (EX?.cmp) { EX.cmp = null; draw(); } else closeExec(); } } };
  document.addEventListener("keydown", EX.onKey, true);
  modal.replaceChildren(el("p", "muted xs fx-msg", `Lendo as execuções de ${key}…`));

  let info;
  try { info = await D.send("EXEC_GET", { key }); } catch (e) {
    if (!EX) return;
    modal.replaceChildren(head(), el("p", "muted xs fx-msg", `Não deu para ler ${key}: ${e.message}`));
    return;
  }
  if (!EX || EX.key !== key) return;
  const draft = drafts.get(key);
  EX.info = info;
  EX.title = info.summary || title;
  EX.desc0 = info.desc || "";
  EX.items = draft?.items || (info.data?.items?.length ? info.data.items : seedItems(info, figma));
  EX.desc = draft ? draft.desc : EX.desc0;
  EX.dirty = !!draft;
  draw();
  modal.querySelector(".ex-head .ic")?.focus();
}

const touch = () => { EX.dirty = true; draw(); };
const setItems = (items) => { EX.items = items; touch(); };
const move = (id, tier) => setItems(EX.items.map((i) => (i.id === id ? { ...i, tier } : i)));

function head() {
  const h = el("div", "ex-head");
  const t = el("div", "ex-ttl");
  const top = el("div", "ex-ttl-top");
  top.append(el("span", "ux-k ux", EX.key), el("h2", null, "Execuções"));
  t.append(top, el("p", null, EX.title || ""));
  const x = el("button", "ic", "✕");
  x.setAttribute("aria-label", "Fechar");
  x.addEventListener("click", () => closeExec());
  h.append(t, x);
  return h;
}

function draw() {
  if (!EX) return;
  const keepScroll = EX.modal.querySelector(".ex-tiers")?.scrollTop || 0;
  const focusId = document.activeElement?.dataset?.exFocus;
  EX.modal.replaceChildren(head(), descBox(), progress(), main(), foot());
  const tiers = EX.modal.querySelector(".ex-tiers");
  if (tiers) tiers.scrollTop = keepScroll;
  if (focusId) EX.modal.querySelector(`[data-ex-focus="${focusId}"]`)?.focus();
}

function descBox() {
  const box = el("div", "ex-desc");
  const lab = el("label", null, "Sobre a demanda");
  lab.htmlFor = "exDesc";
  const ta = el("textarea", "inp");
  ta.id = "exDesc";
  ta.dataset.exFocus = "desc";
  ta.placeholder = "O que esta demanda precisa entregar, para quem e com quais limites";
  ta.value = EX.desc;
  ta.addEventListener("input", () => {
    EX.desc = ta.value;
    EX.dirty = true;
    note.hidden = EX.desc.trim() === EX.desc0.trim();
    hint();
  });
  const note = el("p", "muted xs ex-note", "Ao salvar, a descrição da demanda no Jira passa a ser este texto.");
  note.hidden = EX.desc.trim() === EX.desc0.trim();
  box.append(lab, ta, note);
  return box;
}

function progress() {
  const p = el("div", "ex-prog");
  const strip = el("div", "ex-strip");
  strip.setAttribute("role", "img");
  const total = EX.items.length;
  const done = EX.items.filter((i) => i.tier === "feito").length;
  strip.setAttribute("aria-label", `${done} de ${total} execuções feitas`);
  for (const T of EXEC_TIERS) {
    const n = EX.items.filter((i) => i.tier === T.id).length;
    if (!n) continue;
    const s = el("i");
    s.style.flex = String(n);
    s.style.background = T.color;
    s.title = `${T.label}: ${n}`;
    strip.append(s);
  }
  const mins = EX.items.reduce((s, i) => s + minutesOf(i), 0);
  const txt = el("span");
  txt.append(el("b", null, String(done)), " de ", el("b", null, String(total)), " feitas · ", el("b", null, mins ? fmtH(mins) : "0h"), " em Horas");
  p.append(strip, txt);
  return p;
}

function main() {
  const m = el("div", "ex-main");
  const col = el("div", "ex-tiers");
  if (EX.cmp) col.append(composer());
  EXEC_TIERS.forEach((T, k) => col.append(tier(T, k)));
  m.append(col, rail());
  return m;
}

function tier(T, k) {
  const sec = el("section", "ex-tier");
  sec.setAttribute("aria-label", `Faixa ${T.label}`);
  const items = EX.items.filter((i) => i.tier === T.id);
  const h = el("div", "ex-tier-h");
  h.style.background = T.color;
  h.append(el("b", null, T.label), el("span", null, T.note), el("em", null, String(items.length)));
  const c = el("div", "ex-tier-c");
  if (!items.length) c.append(el("span", "ex-tier-empty", "Arraste uma execução para cá"));
  for (const i of items) c.append(cardOf(i, k));
  sec.append(h, c);
  sec.addEventListener("dragover", (e) => { if (EX.drag == null) return; e.preventDefault(); sec.classList.add("over"); });
  sec.addEventListener("dragleave", (e) => { if (!sec.contains(e.relatedTarget)) sec.classList.remove("over"); });
  sec.addEventListener("drop", (e) => {
    e.preventDefault();
    sec.classList.remove("over");
    const id = EX.drag;
    EX.drag = null;
    if (id != null && EX.items.find((i) => i.id === id)?.tier !== T.id) move(id, T.id);
  });
  return sec;
}

function cardOf(i, k) {
  const T = typeOf(i.t);
  const open = EX.sel === i.id;
  const card = el("div", `ex-card${open ? " sel" : ""}`);
  card.draggable = true;
  card.addEventListener("dragstart", (e) => {
    EX.drag = i.id;
    card.classList.add("drag");
    try { e.dataTransfer.setData("text/plain", String(i.id)); e.dataTransfer.effectAllowed = "move"; } catch { /* segue */ }
  });
  card.addEventListener("dragend", () => { card.classList.remove("drag"); EX.drag = null; });
  const top = el("button", "ex-card-top");
  top.type = "button";
  top.dataset.exFocus = `card-${i.id}`;
  top.setAttribute("aria-expanded", String(open));
  const chip = el("span", "ux-chip", T.label);
  chip.style.setProperty("--c", T.color);
  top.append(chip, el("span", "ex-card-t", i.title));
  top.addEventListener("click", () => { EX.sel = open ? null : i.id; draw(); });
  card.append(top);
  const meta = metaOf(i);
  if (meta) card.append(el("div", "ex-card-m", meta));
  if (open) {
    if (i.detail) card.append(el("div", "ex-card-d", i.detail));
    const acts = el("div", "ex-card-acts");
    const btn = (label, fn, cls = "") => { const b = el("button", cls, label); b.type = "button"; b.addEventListener("click", fn); acts.append(b); };
    if (k > 0) btn(`↑ ${EXEC_TIERS[k - 1].label}`, () => move(i.id, EXEC_TIERS[k - 1].id));
    if (k < EXEC_TIERS.length - 1) btn(`↓ ${EXEC_TIERS[k + 1].label}`, () => move(i.id, EXEC_TIERS[k + 1].id));
    if (i.tier !== "feito") btn("Feito ✓", () => move(i.id, "feito"));
    if (i.t === "figma" && /^https?:\/\//.test(i.field || "")) btn("Abrir ↗", () => window.open(i.field, "_blank", "noopener"));
    btn("Remover", () => { EX.sel = null; setItems(EX.items.filter((x) => x.id !== i.id)); }, "rm");
    card.append(acts);
  }
  return card;
}

function rail() {
  const r = el("aside", "ex-rail");
  r.setAttribute("aria-label", "Adicionar execução");
  r.append(el("h3", null, "Adicionar"));
  for (const [id, T] of Object.entries(EXEC_TYPES)) {
    const b = el("button", `ex-ra${EX.cmp?.t === id ? " on" : ""}`);
    b.type = "button";
    const name = el("b");
    const dot = el("i");
    dot.style.background = T.color;
    name.append(dot, T.label);
    b.append(name, el("span", null, T.hint));
    b.addEventListener("click", () => {
      EX.sel = null;
      EX.cmp = { t: id, title: "", field: id === "check" ? T.ph : "", detail: "", tier: DEFAULT_TIER[id] || "agora" };
      draw();
      EX.modal.querySelector(".ex-cmp input")?.focus();
    });
    r.append(b);
  }
  return r;
}

function composer() {
  const C = EX.cmp, T = typeOf(C.t);
  const box = el("div", "ex-cmp");
  const t = el("div", "ex-cmp-t");
  const dot = el("i", "ux-dot");
  dot.style.background = T.color;
  t.append(dot, T.label);
  box.append(t);
  const field = (label, value, ph, on, multi = false) => {
    const l = el("label");
    l.append(label);
    const inp = el(multi ? "textarea" : "input", "inp sm");
    if (!multi) inp.type = "text";
    inp.value = value || "";
    inp.placeholder = ph || "";
    inp.addEventListener("input", () => on(inp.value));
    l.append(inp);
    box.append(l);
    return inp;
  };
  field("Título", C.title, T.titlePh, (v) => { C.title = v; });
  let fieldInp = null;
  if (T.field) fieldInp = field(T.field, C.field, T.ph, (v) => { C.field = v; });
  if (C.t === "link") {
    const keys = (EX.info?.links || []).map((l) => l.key);
    if (keys.length) {
      const sugs = el("div", "ex-sugs");
      for (const k of keys) {
        const s = el("button", `ex-sug${C.field === k ? " on" : ""}`, k);
        s.type = "button";
        s.addEventListener("click", () => {
          C.field = k;
          const l = EX.info.links.find((x) => x.key === k);
          if (!C.title) C.title = `${k}${l?.summary ? ` · ${l.summary}` : ""}`;
          draw();
        });
        sugs.append(s);
      }
      box.append(sugs);
    }
  }
  field("Detalhe", C.detail, "O que fazer, decisões, links", (v) => { C.detail = v; }, true);
  const tl = el("div", "ex-cmp-tier");
  tl.append(el("span", "muted xs", "Faixa"));
  const s = el("div", "seg");
  for (const T2 of EXEC_TIERS) {
    const b = el("button", C.tier === T2.id ? "on" : "", T2.label);
    b.type = "button";
    b.addEventListener("click", () => { C.tier = T2.id; draw(); });
    s.append(b);
  }
  tl.append(s);
  box.append(tl);
  const err = el("p", "ex-err");
  const acts = el("div", "ex-cmp-acts");
  const add = el("button", "btn sm primary", "Adicionar");
  add.type = "button";
  add.addEventListener("click", () => {
    if (C.t === "horas") {
      const d = parseDuration(C.field);
      if (!d.ok || !d.minutes) { err.textContent = "Informe o tempo, por exemplo 1h 30m."; fieldInp?.focus(); return; }
    }
    if (C.t === "link" && !/[A-Z][A-Z0-9_]*-\d+/i.test(C.field || "")) { err.textContent = "Informe a chave da demanda, por exemplo MEED-1234."; fieldInp?.focus(); return; }
    const id = Math.max(0, ...EX.items.map((i) => i.id)) + 1;
    const title = (C.title || C.field || T.titlePh).trim();
    const field = C.t === "link" ? String(C.field).trim().toUpperCase() : (C.field || "").trim();
    EX.items = [...EX.items, { id, tier: C.tier, t: C.t, title, field, detail: (C.detail || "").trim() }];
    EX.cmp = null;
    EX.sel = id;
    EX.D.toast(`${T.label} adicionada em ${EXEC_TIERS.find((x) => x.id === C.tier).label}.`, "ok");
    touch();
  });
  const cancel = el("button", "btn sm", "Cancelar");
  cancel.type = "button";
  cancel.addEventListener("click", () => { EX.cmp = null; draw(); });
  acts.append(add, cancel);
  box.append(err, acts);
  return box;
}

function hint() {
  const span = EX?.modal.querySelector(".ex-foot > span");
  if (span) span.textContent = EX.dirty ? "Alterações ainda não salvas no Jira" : "Arraste entre as faixas ou use ↑ ↓ no card";
}

function foot() {
  const f = el("div", "ex-foot");
  f.append(el("span"));
  const close = el("button", "btn sm", "Fechar");
  close.type = "button";
  close.addEventListener("click", () => closeExec());
  const save = el("button", "btn sm primary", EX.saving ? "Salvando…" : "Salvar no Jira");
  save.type = "button";
  save.disabled = EX.saving;
  save.title = "Grava a lista na demanda, troca a descrição se mudou, cria os vínculos, aponta as Horas e comenta o resumo";
  save.addEventListener("click", saveExec);
  f.append(close, save);
  queueMicrotask(hint);
  return f;
}

async function saveExec() {
  if (!EX || EX.saving) return;
  EX.saving = true;
  draw();
  const ex = EX;
  try {
    const res = await ex.D.send("EXEC_SAVE", {
      key: ex.key,
      items: ex.items.map((i) => ({ ...i, typeLabel: typeOf(i.t).label })),
      desc: ex.desc, descChanged: ex.desc.trim() !== ex.desc0.trim(),
      linked: (ex.info?.links || []).map((l) => l.key),
    });
    if (EX !== ex) return;
    ex.items = res.value?.items || ex.items;
    ex.desc0 = ex.desc;
    ex.dirty = false;
    drafts.delete(ex.key);
    ex.D.toast(res.message, "ok");
    ex.onSaved?.(res);
  } catch (e) {
    ex.D.toast(`Não deu para salvar: ${e.message}`);
  } finally {
    ex.saving = false;
    if (EX === ex) draw();
  }
}
