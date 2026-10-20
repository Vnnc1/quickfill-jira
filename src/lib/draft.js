/**
 * Persistência do rascunho do modal.
 *
 * O popup do Chrome é destruído toda vez que perde o foco — não existe
 * "minimizar". Então tudo que você digitou (e as listas já carregadas do Jira)
 * é gravado aqui e restaurado na próxima abertura.
 *
 * Usa chrome.storage.session: vive enquanto o Chrome estiver aberto e nunca
 * toca o disco — apropriado para dados de trabalho em andamento. Se a área
 * session não existir (Chrome antigo), cai para storage.local.
 */

const area = chrome.storage.session || chrome.storage.local;
const KEY = "quickfill_draft";

/** Rascunhos mais velhos que isto são ignorados (datas ficam obsoletas). */
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12h

let timer = null;

/** Grava com debounce — digitar não dispara uma escrita por tecla. */
export function saveDraft(getSnapshot, delay = 250) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const snapshot = getSnapshot();
      await area.set({ [KEY]: { ...snapshot, savedAt: Date.now() } });
    } catch { /* cota ou contexto inválido — o rascunho é conveniência, não bloqueia */ }
  }, delay);
}

/** Grava imediatamente (usado antes de fechar a janela). */
export async function flushDraft(getSnapshot) {
  clearTimeout(timer);
  try {
    await area.set({ [KEY]: { ...getSnapshot(), savedAt: Date.now() } });
  } catch { /* idem */ }
}

export async function loadDraft() {
  try {
    const bag = await area.get(KEY);
    const draft = bag?.[KEY];
    if (!draft) return null;
    if (Date.now() - (draft.savedAt || 0) > MAX_AGE_MS) {
      await clearDraft();
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export async function clearDraft() {
  clearTimeout(timer);
  try { await area.remove(KEY); } catch { /* ignora */ }
}

/** "há 3 min" — para o aviso de rascunho restaurado. */
export function since(ts) {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return `há ${h}h`;
}
