/**
 * Reconhece demandas do Jira que entram na linha do tempo, em dois grupos:
 *  - Reuniões: conversas e encontros com outras pessoas (alinhamentos, Planning, Review,
 *    Retrospectiva, treinamentos, daily…);
 *  - Execução: trabalho individual que toma bastante tempo (refinamento, deploy, configuração,
 *    testes e investigação).
 *
 * A ordem da decisão:
 *  1. o campo Categoria da demanda no Jira, quando preenchido: é ele que dá a certeza. Se a
 *     categoria não for de nenhum desses tipos (ex.: "Desenvolvimento"), a demanda fica de fora,
 *     mesmo que o título fale em deploy: o QA que testa depois do deploy não fez o deploy;
 *  2. sem categoria, o título;
 *  3. se o título não disser nada, a descrição;
 *  4. sem nenhum dos três, a demanda fica de fora (não há informação suficiente).
 * Só leitura: nada é gravado no Jira.
 */

/** Grupos de tipos, na ordem em que aparecem nos filtros e no modal. */
export const MEETING_GROUPS = {
  reunioes: { label: "Reuniões", types: ["alinhamento", "reuniao", "outro"] },
  execucao: { label: "Execução", types: ["refinamento", "deploy", "config", "testes", "outroexec"] },
};
export const groupOfType = (type) => (MEETING_GROUPS.execucao.types.includes(type) ? "execucao" : "reunioes");

/** Sem acento e em minúsculas, para as regras valerem com ou sem acento ("reunião" = "reuniao"). */
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Ordem importa: a primeira regra que bate decide.
 *  - "Reunião de alinhamento" é alinhamento; daily e stand-up ficam em Outro (grupo Reuniões).
 *  - Reuniões vêm antes da execução: "Reunião sobre o deploy" é reunião.
 *  - Testes vêm antes de deploy: "Testes após o deploy" é teste, não deploy; e "aguardando
 *    deploy" / "pós-deploy" nunca contam como deploy.
 */
export const MEETING_RULES = [
  { type: "outro", rx: /\b(daily|dailys|stand-?up|standup)\b/ },
  { type: "alinhamento", rx: /\b(alinhamentos?|alinhar|1:1|one[- ]on[- ]one|bate[- ]papo|handoff|hand-off)\b/ },
  { type: "reuniao", rx: /\b(reunioes|reuniao|meetings?|sprint planning|planning|planing|plannig|planejamento da sprint|(?<!code )review|sprint review|retro|retrospectiva|cerimonia|kick-?off|workshop|treinamento)\b/ },
  { type: "refinamento", rx: /\b(refinamentos?|refinar|refinement|grooming)\b/ },
  { type: "testes", rx: /\b(testes?|testar|exploratorios?|investigacao|investigar|reteste|regressao|validacao|validar)\b/ },
  { type: "deploy", rx: /(?<!aguardando |aguarda |apos |apos o |pos-|pos )\b(deploys?|deployment|implantacao|go-?live|aprovacao de prs?|subida para (?:producao|prod|hmp|homologacao|des))\b/ },
  { type: "config", rx: /\b(configuracao|configuracoes|configurar|backup|backups|jenkins|pipeline)\b/ },
];

/** Texto puro de uma descrição do Jira (ADF da API v3 ou texto simples). */
export function adfToText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(adfToText).join(" ");
  if (node.type === "text") return node.text || "";
  return adfToText(node.content || []);
}

/** Texto do campo Categoria, venha ele como opção, lista de opções ou texto. */
export function categoryText(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(categoryText).filter(Boolean).join(", ");
  return String(v.value ?? v.name ?? "");
}

/** Tipo de um texto, ou null. */
export function meetingTypeOf(text) {
  const t = norm(text);
  if (!t.trim()) return null;
  for (const r of MEETING_RULES) {
    const m = t.match(r.rx);
    if (m) return { type: r.type, match: m[0] };
  }
  return null;
}

/**
 * Classifica uma demanda: { type, by: "categoria" | "título" | "descrição", match } ou null
 * quando ela não é reunião nem execução (ou não há informação suficiente).
 */
export function classifyIssue({ summary, description, category }) {
  const cat = categoryText(category).trim();
  if (cat) {
    const byCat = meetingTypeOf(cat);
    return byCat ? { ...byCat, by: "categoria", category: cat } : null;
  }
  const byTitle = meetingTypeOf(summary);
  if (byTitle) return { ...byTitle, by: "título" };
  const byDesc = meetingTypeOf(adfToText(description));
  if (byDesc) return { ...byDesc, by: "descrição" };
  return null;
}

/** "pelo título", "pela descrição", "pela categoria". */
export const byLabel = (by) => (by === "título" ? "pelo título" : by === "categoria" ? "pela categoria" : "pela descrição");
