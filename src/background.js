import { parseDuration, formatJira, pickEstimate } from "./lib/duration.js";
import { buildPlan, parseHM, addDays, fmtHM, fmtDur, DEFAULT_WORKDAY } from "./lib/schedule.js";
import { ROLE, UPDATE_URL } from "./lib/role.js";
import { stageFrom, termsRx, normName } from "./lib/teamstats.js";
import { classifyIssue, categoryText, meetingTypeOf } from "./lib/meeting-detect.js";

/* ------------------------------------------------------------------ */
/* Configuração                                                        */
/* ------------------------------------------------------------------ */

const DEFAULTS = {
  baseUrl: "",            // https://suaempresa.atlassian.net
  email: "",              // e-mail da conta Atlassian
  apiToken: "",           // API token (id.atlassian.com/manage-profile/security/api-tokens)
  startDateFieldId: "",   // opcional: força um customfield_XXXXX para "Data de início"
  logWorkComment: "",     // comentário padrão do worklog (opcional)
  subtaskName: "Testes Manuais",  // nome padrão da subtarefa criada pela extensão
  assignSelf: true,       // atribuir a subtarefa criada a você
  subtaskTypeId: "",      // opcional: força o id do tipo de issue "Subtarefa"
  defaultProject: "MEED",        // projeto usado quando você digita só o número
  projectAliases: "M=MEED",      // abreviações: "M=MEED, P=PORTAL" (uma por linha ou vírgula)
  statusColumns: "Validação, Deploy",  // colunas do espaço principal
  sustProject: "",                     // projeto do espaço de Sustentação (vazio = todos)
  sustColumns: "Deploy, Validação Meeds All",  // colunas do espaço de Sustentação
  workStart: "11:00",                  // início da jornada
  workEnd: "17:00",                    // fim da jornada
  dailyCapHours: 6,                    // teto de horas apontadas por dia
  dailyGoalHours: 4,                   // meta diária (o "bati a meta?" do relatório)
  storyPointsFieldId: "",              // opcional: força o customfield de story points
  teamProjects: "",                    // projetos acompanhados na aba Equipe (vazio = padrão + SUS)
  teamGoalHours: 4,                    // meta padrão de cada pessoa (ajustável por pessoa)
  teamCapHours: 6,                     // teto padrão de cada pessoa (ajustável por pessoa)
  teamPeople: {},                      // { accountId: { name, goal, cap, pinned, hidden } }
  defaultStoryPoints: 1,               // valor pré-selecionado (Fibonacci)
  skipWeekends: true,                  // não aponta em sábado/domingo
  estimateFromSpent: true,             // estimativa vazia = tempo trabalhado
  zeroRemainingOnDone: true,           // ao concluir, tempo restante vai a 0m
  overflowMode: "sameDay",             // não coube até o fim da jornada: "sameDay" passa da hora no mesmo dia · "nextDay" vai ao próximo dia útil
  batchBoardId: "",                    // quadro do espaço "Em lote"
  sustBoardId: "",                     // quadro do espaço de Sustentação
  scrumStaleDays: 3,                   // SCRUM: dias úteis sem mudar de status para considerar "parada"
  scrumWipLimit: 2,                    // SCRUM: itens em andamento por pessoa antes de alertar
  designLabels: "design, ux, ui",      // DESIGN: etiquetas que marcam uma HU como "precisa de design"
  designWeeklyGoal: 3,                 // DESIGN: HUs entregues (handoff) por semana
  uxProject: "UX",                     // DESIGN: chave do espaço da Design no Jira
  uxHuProject: "",                     // DESIGN: projeto das HUs (vazio = projeto padrão)
  uxWeeklyGoal: 8,                     // DESIGN: itens do UX feitos por semana
  uxHiddenFronts: "Instagram",         // DESIGN: frentes (épicos) que não aparecem no filtro
  uxIssueType: "HU",                   // DESIGN: tipo do item criado ao clonar uma HU para o UX
  // Etapas do quadro (vazio = padrão). Listas separadas por vírgula, sem acento/caixa.
  stageFeito: "",                      // ex.: "Feito, Dev OK"
  stageDeploy: "",                     // ex.: "Deploy, Deploy HMP"
  stagePrd: "",                        // ex.: "PRD, Produção"
  stageQa: "",                         // ex.: "Validação, Homologação"
  stageReopen: "",                     // ex.: "Reaberto"
  // Etapas do Design (nomes de status)
  designDoing: "",                     // ex.: "Em design, Prototipação"
  designReview: "",                    // ex.: "Revisão de design, Aprovação"
  designDelivered: "",                 // ex.: "Pronto para dev, Sprint backlog"
  // SCRUM: Feito acumulado → card "Realizando Deploy"
  feitoThreshold: 3,                   // a partir de quantos cards em Feito sugerir o deploy
  deployers: "",                       // JSON [{accountId,name}] de quem faz deploy
  deployIssueType: "Tarefa",           // tipo do card criado
  deploySummary: "Realizando Deploy",  // título padrão
  // DESIGN: Figma
  figmaUrl: "",                        // arquivo do Figma do Meeds V2 (atalho)
  figmaToken: "",                      // token pessoal do Figma (opcional) para achar a tela da HU
  stageValidated: "",                  // ex.: "Validado"
  stageBlocked: "",                    // ex.: "Impedido, Aguardando"
  qaPeople: '[{"name":"Almir Vinicius"},{"name":"Jhonathan Pinheiro"}]',   // equipe de QA (fora das regras de WIP/atribuição)
  openMode: "panel",                   // "panel" = painel lateral do Chrome · "modal" = modal grande sobre o Jira
  accentColor: "",                     // cor de destaque (vazio = a do perfil)
  updateUrl: "",                       // endereço do update.json (vazio = o do pacote)
  updateToken: "",                     // token de leitura do repositório privado (opcional; o instalador já cuida)
  designPeople: '[{"name":"Amanda Saraiva"}]',   // Design UI/UX (fora das sugestões de implementação)
  smPeople: '[{"name":"Marjorie Pinheiro"}]',   // Scrum Master / liderança (coluna própria em Pessoas)
  ignorePeople: '[{"name":"Teste Novetech"}]',  // contas de teste/automação que não entram em Pessoas
  designProjects: "",                  // DESIGN: projeto(s) do espaço de Design (vazio = MEED/SUS)
  qaRejectCategories: "Bug funcional, Layout/UI, Regra de negócio, Ambiente/Dados, Critério de aceite incompleto, Performance",
};

/**
 * Abreviações de projeto. `normalizeKey` é síncrono e chamado em muitos pontos,
 * então o mapa fica aqui, recarregado a cada `getConfig()` — e todo handler
 * chama `getConfig()` antes de despachar.
 */
let _aliases = { map: new Map([["M", "MEED"]]), fallback: "MEED" };

function parseAliases(raw, fallback) {
  const map = new Map();
  for (const pair of String(raw || "").split(/[\n,;]+/)) {
    const m = pair.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*([A-Za-z][A-Za-z0-9_]*)$/);
    if (m) map.set(m[1].toUpperCase(), m[2].toUpperCase());
  }
  const fb = String(fallback || "").trim().toUpperCase();
  if (fb && !map.has(fb[0])) map.set(fb[0], fb);   // "MEED" já dá o atalho "M"
  return { map, fallback: fb };
}

async function getConfig() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  cfg.baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
  _aliases = parseAliases(cfg.projectAliases, cfg.defaultProject);
  return cfg;
}

function assertConfigured(cfg) {
  if (!cfg.baseUrl || !cfg.email || !cfg.apiToken) {
    throw new Error(
      "Configuração incompleta. Abra as Opções da extensão e informe URL do Jira, e-mail e API token."
    );
  }
}

/* ------------------------------------------------------------------ */
/* Cliente REST                                                        */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chamada à API do Jira com nova tentativa automática quando o Jira pede para
 * esperar (429) ou está instável (502/503/504). Antes, essas respostas viravam
 * erro e a tarefa sumia das somas da Equipe sem ninguém perceber.
 * POST/PUT só repetem em 429 — que garante que nada foi gravado.
 */
async function jira(path, { method = "GET", body, cfg, retries = 4 } = {}) {
  const conf = cfg || (await getConfig());
  assertConfigured(conf);

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${conf.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: "Basic " + btoa(`${conf.email}:${conf.apiToken}`),
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const retryable = res.status === 429 || (method === "GET" && [502, 503, 504].includes(res.status));
    if (retryable && attempt < retries) {
      const after = Number(res.headers?.get?.("Retry-After"));
      await sleep(after > 0 ? Math.min(after, 10) * 1000 : 400 * 2 ** attempt + Math.random() * 200);
      continue;
    }

    if (res.status === 204) return null;

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* resposta não-JSON */ }

    if (!res.ok) {
      const detail =
        data?.errorMessages?.join(" | ") ||
        (data?.errors && Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`).join(" | ")) ||
        text.slice(0, 300) ||
        res.statusText;
      const err = new Error(`Jira ${res.status}: ${detail}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
}

/* ------------------------------------------------------------------ */
/* Descoberta de campos                                                */
/* ------------------------------------------------------------------ */

const START_DATE_PATTERNS = [
  /^start date$/i,
  /^data de in[ií]cio$/i,
  /^data in[ií]cio$/i,
  /^in[ií]cio$/i,
  /^target start$/i,
  /^data de comec?o$/i,
];

/**
 * Lê o editmeta da issue: diz exatamente quais campos são editáveis por você,
 * com nome e schema. É a forma mais confiável de achar o "Data de início".
 */
async function getEditMeta(issueKey, cfg) {
  const meta = await jira(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/editmeta`, { cfg });
  return meta?.fields || {};
}

function findStartDateField(fields, forcedId) {
  if (forcedId && fields[forcedId]) {
    return { id: forcedId, type: fields[forcedId]?.schema?.type || "date", name: fields[forcedId].name };
  }
  const entries = Object.entries(fields);
  for (const pattern of START_DATE_PATTERNS) {
    const hit = entries.find(([, f]) => pattern.test((f.name || "").trim()));
    if (hit) return { id: hit[0], type: hit[1]?.schema?.type || "date", name: hit[1].name };
  }
  return null;
}

/* --- Story points ---------------------------------------------------- */

/** Valores aceitos: sequência de Fibonacci usada em planning poker. */
const FIBONACCI = [1, 2, 3, 5, 8, 13, 21];

const STORY_PATTERNS = [
  /^story point estimate$/i,
  /^story points?$/i,
  /^pontos? de hist[oó]ria$/i,
  /^estimativa de pontos/i,
  /^story point/i,
];

/** O nome muda entre projetos (team-managed x company-managed); o editmeta diz qual existe aqui. */
function findStoryPointsField(fields, forcedId) {
  if (forcedId && fields[forcedId]) return { id: forcedId, name: fields[forcedId].name };
  const entries = Object.entries(fields);
  for (const pattern of STORY_PATTERNS) {
    const hit = entries.find(([, f]) => pattern.test((f.name || "").trim()));
    if (hit) return { id: hit[0], name: hit[1].name };
  }
  return null;
}

function validateStoryPoints(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!FIBONACCI.includes(n)) {
    throw new Error(`Story points precisa ser da sequência de Fibonacci (${FIBONACCI.join(", ")}). Recebido: ${value}.`);
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Operações de alto nível                                             */
/* ------------------------------------------------------------------ */

/**
 * Normaliza qualquer forma de escrever a chave para "MEED-1653":
 *
 *   MEED-1653   meed-1653   MEED 1653   .../browse/MEED-1653   (forma completa)
 *   M1653       m-1653      M 1653                             (abreviação)
 *   1653                                                        (só o número)
 *
 * A abreviação usa o mapa das Opções ("M=MEED"); o número puro usa o projeto
 * padrão. Um prefixo que não está no mapa é mantido como veio, então projetos
 * novos continuam funcionando sem configurar nada.
 */
function normalizeKey(input) {
  const raw = String(input || "").trim();

  const fromUrl = raw.match(/\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/) ||
                  raw.match(/selectedIssue=([A-Za-z][A-Za-z0-9_]*-\d+)/i);
  const candidate = (fromUrl ? fromUrl[1] : raw).replace(/\s+/g, "");

  // Só o número: usa o projeto padrão.
  const onlyNumber = candidate.match(/^#?(\d+)$/);
  if (onlyNumber) {
    if (!_aliases.fallback) {
      throw new Error(`Informe o projeto (ex.: M${onlyNumber[1]}) ou defina o projeto padrão nas Opções.`);
    }
    return `${_aliases.fallback}-${onlyNumber[1]}`;
  }

  // Com hífen, o corte é o próprio hífen (projetos podem ter dígitos: "ABC2-15").
  // Sem hífen, o prefixo é só de letras — senão "M1653" viraria "M165-3".
  const m = candidate.includes("-")
    ? candidate.match(/^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/)
    : candidate.match(/^([A-Za-z]+)(\d+)$/);
  if (!m) throw new Error(`Chave inválida: "${input}". Use MEED-1653, M1653 ou 1653.`);

  const prefix = m[1].toUpperCase();
  const project = _aliases.map.get(prefix) || prefix;
  return `${project}-${m[2]}`;
}

/** Dada a chave do pai, devolve o pai + suas subtarefas. Se a chave já for
 *  uma subtarefa, devolve ela mesma como única opção. */
async function loadIssueTree(rawKey) {
  const cfg = await getConfig();
  const key = normalizeKey(rawKey);
  const issue = await jira(
    `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,subtasks,issuetype,status,parent`,
    { cfg }
  );

  const isSubtask = !!issue.fields?.issuetype?.subtask;
  const [me, withAssignee] = await Promise.all([
    getMyself(cfg).catch(() => null),
    isSubtask ? Promise.resolve([]) : runJql(`parent = ${key}`, ["assignee"], 100, cfg).catch(() => []),
  ]);
  const who = new Map(withAssignee.map((i) => [i.key, i.fields?.assignee || null]));
  const subtasks = (issue.fields?.subtasks || []).map((s) => {
    const a = who.get(s.key);
    return {
      key: s.key,
      summary: s.fields?.summary || "",
      status: s.fields?.status?.name || "",
      assignee: a ? { id: a.accountId, name: a.displayName } : null,
      mine: !!(a && me && a.accountId === me.accountId),
    };
  });

  return {
    parent: {
      key: issue.key,
      summary: issue.fields?.summary || "",
      isSubtask,
      status: issue.fields?.status?.name || "",
    },
    subtasks: isSubtask
      ? [{ key: issue.key, summary: issue.fields?.summary || "", status: issue.fields?.status?.name || "" }]
      : subtasks,
  };
}

/** Contexto necessário para montar o formulário de uma subtarefa. */
async function loadSubtaskContext(rawKey) {
  const cfg = await getConfig();
  const key = normalizeKey(rawKey);

  const [issue, meta, transitions] = await Promise.all([
    jira(
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,duedate,timetracking,status,issuetype,assignee,parent`,
      { cfg }
    ),
    getEditMeta(key, cfg),
    jira(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { cfg }),
  ]);

  const startField = findStartDateField(meta, cfg.startDateFieldId);
  const storyField = findStoryPointsField(meta, cfg.storyPointsFieldId);

  let currentStart = null;
  let currentStory = null;
  const extra = [startField?.id, storyField?.id].filter(Boolean);
  if (extra.length) {
    const more = await jira(
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${extra.join(",")}`,
      { cfg }
    );
    const v = startField ? more.fields?.[startField.id] : null;
    currentStart = typeof v === "string" ? v.slice(0, 10) : null;
    const sp = storyField ? more.fields?.[storyField.id] : null;
    currentStory = typeof sp === "number" ? sp : null;
  }

  return {
    key: issue.key,
    summary: issue.fields?.summary || "",
    status: issue.fields?.status?.name || "",
    parentKey: issue.fields?.parent?.key || null,
    parentSummary: issue.fields?.parent?.fields?.summary || "",
    assigneeId: issue.fields?.assignee?.accountId || null,
    assigneeName: issue.fields?.assignee?.displayName || "",
    current: {
      dueDate: issue.fields?.duedate || null,
      startDate: currentStart,
      originalEstimate: issue.fields?.timetracking?.originalEstimate || null,
      timeSpent: issue.fields?.timetracking?.timeSpent || null,
      storyPoints: currentStory,
    },
    startField,
    storyField,
    canEditTimeTracking: !!meta.timetracking,
    canEditDueDate: !!meta.duedate,
    transitions: (transitions?.transitions || []).map((t) => ({
      id: t.id,
      name: t.name,
      to: t.to?.name || "",
      toCategory: t.to?.statusCategory?.key || "",   // "done" = conclui a issue
    })),
  };
}

/**
 * "2026-10-13" + 660 (min) -> "2026-10-13T11:00:00.000-0300", no fuso do navegador.
 * Antes era 09:00 UTC fixo, o que no Brasil caía às 06:00 — fora da jornada.
 */
function toJiraLocal(dateStr, minutes = DEFAULT_WORKDAY.start) {
  const [y, m, d] = (dateStr || todayLocal()).split("-").map(Number);
  const dt = new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, 0, 0);
  const off = -dt.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const pad = (n) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:00.000` +
         `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

/** Campo de data/hora de início: abre no começo da jornada. */
const toJiraDateTime = (dateStr) => toJiraLocal(dateStr, DEFAULT_WORKDAY.start);

function todayLocal() {
  const n = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}

/** Data de início desejada: o Dia escolhido, salvo se a tarefa já começou antes dele. */
function wantedStart(p) {
  if (!p.startDate || !p.startFieldId) return null;
  const cur = String(p.currentStartDate || "").slice(0, 10);
  return cur && cur < p.startDate ? cur : p.startDate;
}

/** Relê a Data de início depois das automações e regrava se o Jira trocou. */
async function keepStartDate(key, fieldId, wanted, value, cfg) {
  const read = async () => {
    const r = await jira(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fieldId}`, { cfg });
    const v = r.fields?.[fieldId];
    return typeof v === "string" ? v.slice(0, 10) : null;
  };
  let rewrote = false;
  try {
    for (const wait of [2500, 4000]) {
      await new Promise((r) => setTimeout(r, wait));
      const now = await read();
      if (now === wanted) break;
      await jira(`/rest/api/3/issue/${encodeURIComponent(key)}`, { method: "PUT", body: { fields: { [fieldId]: value } }, cfg });
      rewrote = now || "vazio";
    }
    if (!rewrote) return null;
    const final = await read();
    return final === wanted
      ? { ok: true, detail: `mantida em ${brDay(wanted)} (o Jira tinha trocado para ${rewrote === "vazio" ? rewrote : brDay(rewrote)})` }
      : { ok: false, detail: `o Jira continua trocando para ${final ? brDay(final) : "vazio"} — confira a automação do quadro` };
  } catch (e) {
    return { ok: false, detail: `não deu para conferir: ${e.message}` };
  }
}

const brDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Aplica tudo na subtarefa. Cada etapa é independente e reportada
 * separadamente — assim uma falha de permissão não esconde o que deu certo.
 */
async function applyToSubtask(payload) {
  const cfg = await getConfig();
  const key = normalizeKey(payload.key);
  const steps = [];

  const est = parseDuration(payload.originalEstimate);
  if (!est.ok) throw new Error(`Estimativa original — ${est.error}`);
  const spent = parseDuration(payload.timeSpent);
  if (!spent.ok) throw new Error(`Controle de tempo — ${spent.error}`);

  /* 1. Campos de data + estimativa original (uma única chamada) */
  const fields = {};
  if (payload.dueDate) fields.duedate = payload.dueDate;
  // "Data de início" da tarefa = primeiro dia de trabalho: grava se estiver vazia ou se o Dia for anterior.
  // O dia escolhido no modal continua valendo para o apontamento (worklog).
  const startWanted = wantedStart(payload);
  const startValue = startWanted && (payload.startFieldType === "datetime"
    ? toJiraLocal(startWanted, parseHM(payload.startTime, DEFAULT_WORKDAY.start))
    : startWanted);
  if (startWanted && startWanted !== String(payload.currentStartDate || "").slice(0, 10)) {
    fields[payload.startFieldId] = startValue;
  }
  if (est.jira) fields.timetracking = { originalEstimate: est.jira };

  const sp = validateStoryPoints(payload.storyPoints);
  let storySkipped = false;
  if (sp != null) {
    if (payload.storyFieldId) fields[payload.storyFieldId] = sp;
    else storySkipped = true;
  }

  if (Object.keys(fields).length) {
    try {
      await jira(`/rest/api/3/issue/${encodeURIComponent(key)}`, { method: "PUT", body: { fields }, cfg });
      const names = Object.keys(fields).map((f) =>
        f === "duedate" ? "data limite"
        : f === "timetracking" ? `estimativa ${est.jira}`
        : f === payload.storyFieldId ? `${sp} story point${sp === 1 ? "" : "s"}`
        : f === payload.startFieldId ? "data de início"
        : f);
      steps.push({ step: "Campos", ok: true, detail: names.join(" · ") });
    } catch (e) {
      steps.push({ step: "Campos", ok: false, detail: e.message });
    }
  }
  if (storySkipped) {
    steps.push({ step: "Story points", ok: false, detail: "Esta subtarefa não tem campo de story points editável na tela." });
  }
  if (!est.jira && spent.minutes && payload.currentEstimate) {
    const before = parseDuration(payload.currentSpent).minutes || 0;
    steps.push({ step: "Estimativa", ok: true,
      detail: `mantida (${payload.currentEstimate}) · trabalhado ${formatJira(before)} + ${formatJira(spent.minutes)} = ${formatJira(before + spent.minutes)}` });
  }

  /* 2. Worklog — o "controle de tempo" real, já encaixado na jornada.
   *    Cada fatia do plano vira um apontamento com horário próprio.
   *    Ao concluir, a última fatia zera o tempo restante. */
  const chunks = payload.worklogChunks || [];
  if (chunks.length) {
    const comment = payload.worklogComment || cfg.logWorkComment;
    const done = [];
    let failed = null;

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const last = i === chunks.length - 1;
      const adjust = last && payload.finalize && cfg.zeroRemainingOnDone
        ? "adjustEstimate=new&newEstimate=0m"
        : "adjustEstimate=auto";
      try {
        await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/worklog?${adjust}`, {
          method: "POST",
          cfg,
          body: {
            timeSpent: formatJira(c.minutes),
            started: toJiraLocal(c.date, c.start),
            ...(comment ? {
              comment: { type: "doc", version: 1,
                content: [{ type: "paragraph", content: [{ type: "text", text: comment }] }] },
            } : {}),
          },
        });
        done.push(`${c.date.slice(8, 10)}/${c.date.slice(5, 7)} ${fmtHM(c.start)}–${fmtHM(c.start + c.minutes)}`);
      } catch (e) {
        failed = e.message;
        break;   // não segue apontando fatias depois de uma falha
      }
    }

    if (done.length) {
      steps.push({
        step: "Controle de tempo (worklog)",
        ok: !failed,
        detail: `${fmtDur(chunks.reduce((s, c) => s + c.minutes, 0))} em ${done.join(", ")}` +
                (payload.finalize && cfg.zeroRemainingOnDone ? " · restante 0m" : ""),
      });
    }
    if (failed) steps.push({ step: "Controle de tempo (worklog)", ok: false, detail: failed });
  } else if (spent.minutes) {
    steps.push({ step: "Controle de tempo (worklog)", ok: false, detail: "Sem horário livre na jornada para apontar." });
  }

  /* 3. Transição de status */
  if (payload.transitionId) {
    try {
      await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
        method: "POST",
        cfg,
        body: { transition: { id: String(payload.transitionId) } },
      });
      steps.push({ step: "Status", ok: true, detail: payload.transitionName || payload.transitionId });
    } catch (e) {
      steps.push({ step: "Status", ok: false, detail: e.message });
    }
  }

  /* 4. Automações do Jira (ex.: "iniciar" grava a data de hoje no início) podem sobrescrever
   *    a Data de início logo depois. Confere e, se mudou, grava de novo o Dia escolhido. */
  if (startWanted && (payload.transitionId || chunks.length)) {
    const fixed = await keepStartDate(key, payload.startFieldId, startWanted, startValue, cfg);
    if (fixed) steps.push({ step: "Data de início", ok: fixed.ok, detail: fixed.detail });
  }

  if (!steps.length) throw new Error("Nada para aplicar — preencha ao menos um campo.");

  return {
    key,
    url: `${cfg.baseUrl}/browse/${key}`,
    steps,
    ok: steps.every((s) => s.ok),
  };
}

/* ------------------------------------------------------------------ */
/* Busca por colunas do quadro (status)                                */
/* ------------------------------------------------------------------ */

/** Escapa aspas e barras para interpolar um nome de status dentro do JQL. */
const jqlString = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const splitList = (raw) =>
  String(raw || "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);

/**
 * Busca as issues que estão nas colunas informadas. "Coluna" de quadro é, no
 * fundo, um conjunto de status — então a busca é por `status in (...)`, que
 * funciona para qualquer quadro sem precisar saber o id dele.
 */
/* --- Quadros (Agile API) ------------------------------------------- */

/**
 * Lista os quadros visíveis. O nome da COLUNA de um quadro quase nunca é igual
 * ao nome do STATUS — "Validação Meeds All" é rótulo de coluna e pode agrupar
 * vários status. Por isso a extensão lê a configuração do quadro em vez de
 * adivinhar nomes de status.
 */
async function listBoards(payload = {}) {
  const cfg = await getConfig();
  const out = [];
  let startAt = 0;

  for (;;) {
    const qs = new URLSearchParams({ startAt: String(startAt), maxResults: "50" });
    if (payload.query) qs.set("name", payload.query);
    const page = await jira(`/rest/agile/1.0/board?${qs}`, { cfg });
    out.push(...(page?.values || []));
    if (page?.isLast !== false || out.length >= 200) break;
    startAt += (page.values || []).length || 50;
  }

  return out.map((b) => ({
    id: b.id,
    name: b.name,
    type: b.type,
    projectKey: b.location?.projectKey || "",
    projectName: b.location?.projectName || "",
  }));
}

const _boardConfigCache = new Map();

/** Colunas do quadro, cada uma com os ids de status que ela agrupa. */
async function getBoardColumns(payload) {
  const cfg = await getConfig();
  const boardId = payload.boardId;
  if (!boardId) throw new Error("Selecione um quadro.");
  if (!payload.refresh && _boardConfigCache.has(boardId)) return _boardConfigCache.get(boardId);

  const conf = await jira(`/rest/agile/1.0/board/${encodeURIComponent(boardId)}/configuration`, { cfg });

  const columns = (conf?.columnConfig?.columns || []).map((c) => ({
    name: c.name,
    statusIds: (c.statuses || []).map((s) => String(s.id)),
  }));

  const entry = {
    boardId,
    name: conf?.name || "",
    filterId: conf?.filter?.id ? String(conf.filter.id) : null,
    columns,
  };
  _boardConfigCache.set(boardId, entry);
  return entry;
}

/** Nomes de status parecidos — usado para explicar uma busca que voltou vazia. */
async function suggestStatuses(names, cfg) {
  try {
    const all = await jira("/rest/api/3/status", { cfg });
    const wanted = names.map(slug);
    const hits = all
      .map((s) => s.name)
      .filter((n, i, arr) => arr.indexOf(n) === i)
      .filter((n) => wanted.some((w) => slug(n).includes(w) || w.includes(slug(n))));
    return hits.slice(0, 8);
  } catch {
    return [];
  }
}

async function searchByColumns(payload) {
  const cfg = await getConfig();
  const me = await getMyself(cfg);

  const clauses = [];
  let statuses = [];
  let scope = "";

  if (payload.boardId) {
    /* Caminho preferido: colunas reais do quadro → ids de status. */
    const conf = await getBoardColumns({ boardId: payload.boardId });
    const wanted = (payload.columns || []).map(slug);
    const picked = conf.columns.filter((c) => wanted.includes(slug(c.name)));

    if (!picked.length) {
      throw new Error(
        `Nenhuma das colunas informadas existe no quadro "${conf.name}". ` +
        `Colunas disponíveis: ${conf.columns.map((c) => c.name).join(", ") || "(nenhuma)"}.`
      );
    }

    const statusIds = [...new Set(picked.flatMap((c) => c.statusIds))];
    if (!statusIds.length) {
      throw new Error(`As colunas selecionadas do quadro "${conf.name}" não têm status mapeado.`);
    }

    statuses = picked.map((c) => c.name);
    scope = `quadro ${conf.name}`;
    clauses.push(`status in (${statusIds.join(", ")})`);
    if (conf.filterId) clauses.push(`filter = ${conf.filterId}`);   // mantém o recorte do quadro
  } else {
    /* Caminho alternativo: nomes de status digitados. */
    statuses = payload.statuses?.length ? payload.statuses : splitList(cfg.statusColumns);
    if (!statuses.length) throw new Error("Selecione um quadro ou informe ao menos um status.");
    clauses.push(`status in (${statuses.map(jqlString).join(", ")})`);

    const projects = Array.isArray(payload.projects)
      ? payload.projects.filter(Boolean).map((p) => p.trim().toUpperCase())
      : (cfg.defaultProject ? [cfg.defaultProject.toUpperCase()] : []);
    if (projects.length) {
      clauses.push(`project in (${projects.map(jqlString).join(", ")})`);
      scope = `projeto ${projects.join(", ")}`;
    }
  }

  if (payload.onlyMine) clauses.push("assignee = currentUser()");
  if (payload.excludeSubtasks) clauses.push("issuetype not in subTaskIssueTypes()");

  const jql = `${clauses.join(" AND ")} ORDER BY updated DESC`;
  const fields = ["summary", "status", "assignee", "issuetype", "parent"];
  const max = Math.min(payload.limit || 100, 200);

  const issues = await runJql(jql, fields, max, cfg);

  // Busca vazia por nome de status: provavelmente o nome é de coluna, não de status.
  const hint = (!issues.length && !payload.boardId)
    ? await suggestStatuses(statuses, cfg)
    : [];

  return {
    jql,
    statuses,
    scope,
    hint,
    me: { accountId: me.accountId, displayName: me.displayName },
    me: { accountId: me.accountId, displayName: me.displayName },
    issues: issues.map((i) => ({
      key: i.key,
      summary: i.fields?.summary || "",
      status: i.fields?.status?.name || "",
      assignee: i.fields?.assignee?.displayName || "",
      assigneeId: i.fields?.assignee?.accountId || null,
      isSubtask: !!i.fields?.issuetype?.subtask,
      parentKey: i.fields?.parent?.key || null,
    })),
  };
}

/**
 * Executa JQL paginando. Usa o endpoint novo (`/search/jql`, com nextPageToken)
 * e cai para o clássico (`/search`, com startAt) em instâncias que ainda não o têm.
 */
async function runJql(jql, fields, max, cfg) {
  const out = [];

  try {
    let token = null;
    do {
      const page = await jira("/rest/api/3/search/jql", {
        method: "POST",
        cfg,
        body: { jql, fields, maxResults: Math.min(100, max - out.length), ...(token ? { nextPageToken: token } : {}) },
      });
      out.push(...(page?.issues || []));
      token = page?.nextPageToken || null;
    } while (token && out.length < max);
    return out.slice(0, max);
  } catch (e) {
    if (!/40[45]/.test(e.message)) throw e;   // erro real de JQL/permissão: propaga
  }

  // Fallback: endpoint clássico
  let startAt = 0;
  for (;;) {
    const qs = new URLSearchParams({
      jql,
      startAt: String(startAt),
      maxResults: String(Math.min(100, max - out.length)),
      fields: fields.join(","),
    });
    const page = await jira(`/rest/api/3/search?${qs}`, { cfg });
    const batch = page?.issues || [];
    out.push(...batch);
    startAt += batch.length;
    if (!batch.length || out.length >= max || startAt >= (page?.total ?? 0)) break;
  }
  return out.slice(0, max);
}

/* ------------------------------------------------------------------ */
/* Criação de subtarefa                                                */
/* ------------------------------------------------------------------ */

/** Quem sou eu no Jira. Cacheado enquanto o service worker viver. */
let _myself = null;
async function getMyself(cfg) {
  if (_myself) return _myself;
  _myself = await jira("/rest/api/3/myself", { cfg });
  return _myself;
}

/**
 * Descobre o tipo de issue "Subtarefa" do projeto. O nome varia por idioma e
 * por projeto ("Subtarefa", "Sub-task", "Subtask"), então a busca é pela flag
 * `subtask` do próprio Jira, nunca pelo texto.
 */
const _subtaskTypeCache = new Map();   // projectKey -> { id, name }

async function getSubtaskIssueType(projectKey, cfg) {
  if (cfg.subtaskTypeId) return { id: cfg.subtaskTypeId, name: "(forçado nas Opções)" };
  if (_subtaskTypeCache.has(projectKey)) return _subtaskTypeCache.get(projectKey);

  let types = [];
  try {
    const meta = await jira(
      `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes?maxResults=100`,
      { cfg }
    );
    types = meta?.issueTypes || meta?.values || [];
  } catch {
    // Instâncias mais antigas: cai para o createmeta clássico.
    const legacy = await jira(
      `/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&expand=projects.issuetypes`,
      { cfg }
    );
    types = legacy?.projects?.[0]?.issuetypes || [];
  }

  const found = types.find((t) => t.subtask === true);
  if (!found) {
    throw new Error(
      `O projeto ${projectKey} não expõe um tipo de subtarefa para você criar. ` +
      `Verifique a permissão de criação ou informe o id do tipo nas Opções.`
    );
  }
  const entry = { id: found.id, name: found.name };
  _subtaskTypeCache.set(projectKey, entry);
  return entry;
}

const projectOf = (key) => normalizeKey(key).split("-")[0];

/** Compara nomes de subtarefa ignorando acento, caixa e espaços extras. */
const sameName = (a, b) => slug(a).replace(/\s+/g, " ") === slug(b).replace(/\s+/g, " ");

/**
 * Cria uma subtarefa na tarefa pai informada.
 *
 * - `summary` vazio usa o nome padrão das Opções ("Testes Manuais").
 * - `assignToMe` atribui a você; se a tela de criação não aceitar o campo
 *   assignee, a criação é refeita sem ele e a atribuição vai por PUT — assim
 *   uma configuração de tela restritiva não impede a criação.
 * - `skipIfExists` evita duplicar quando já existe subtarefa com o mesmo nome.
 */
async function createSubtask(payload) {
  const cfg = await getConfig();
  const parentKey = normalizeKey(payload.parentKey);
  const summary = (payload.summary || cfg.subtaskName || "Testes Manuais").trim();
  const assignToMe = payload.assignToMe ?? cfg.assignSelf;
  const skipIfExists = payload.skipIfExists ?? true;

  if (!summary) throw new Error("Informe o nome da subtarefa.");

  const parent = await jira(
    `/rest/api/3/issue/${encodeURIComponent(parentKey)}?fields=summary,subtasks,issuetype,project`,
    { cfg }
  );
  if (parent.fields?.issuetype?.subtask) {
    throw new Error(`${parentKey} já é uma subtarefa — não é possível criar subtarefa dentro dela.`);
  }

  if (skipIfExists) {
    const dup = (parent.fields?.subtasks || []).find((s) => sameName(s.fields?.summary, summary));
    if (dup) {
      return {
        key: dup.key,
        parentKey,
        summary: dup.fields?.summary || summary,
        url: `${cfg.baseUrl}/browse/${dup.key}`,
        created: false,
        detail: "Já existia uma subtarefa com esse nome.",
      };
    }
  }

  const projectKey = parent.fields?.project?.key || projectOf(parentKey);
  const type = await getSubtaskIssueType(projectKey, cfg);
  const me = assignToMe ? await getMyself(cfg) : null;

  const baseFields = {
    project: { key: projectKey },
    parent: { key: parentKey },
    issuetype: { id: type.id },
    summary,
  };

  let created;
  let assigneeFallback = false;
  try {
    created = await jira("/rest/api/3/issue", {
      method: "POST",
      cfg,
      body: { fields: me ? { ...baseFields, assignee: { accountId: me.accountId } } : baseFields },
    });
  } catch (e) {
    // Tela de criação sem o campo assignee: cria e atribui depois.
    if (!me || !/assignee/i.test(e.message)) throw e;
    created = await jira("/rest/api/3/issue", { method: "POST", cfg, body: { fields: baseFields } });
    assigneeFallback = true;
  }

  let assignedTo = me?.displayName || null;
  if (me && assigneeFallback) {
    try {
      await jira(`/rest/api/3/issue/${created.key}/assignee`, {
        method: "PUT",
        cfg,
        body: { accountId: me.accountId },
      });
    } catch {
      assignedTo = null;   // criada, mas sem atribuição — reportado ao usuário
    }
  }

  return {
    key: created.key,
    parentKey,
    summary,
    url: `${cfg.baseUrl}/browse/${created.key}`,
    created: true,
    issueType: type.name,
    assignedTo,
    detail: assignedTo
      ? `Criada como ${type.name} e atribuída a ${assignedTo}.`
      : `Criada como ${type.name}, mas não foi possível atribuir — atribua manualmente.`,
  };
}

/** Cria a mesma subtarefa em várias tarefas pai, com progresso. */
async function createSubtasksBatch(payload) {
  const parents = [...new Set((payload.parentKeys || []).map((k) => {
    try { return normalizeKey(k); } catch { return null; }
  }).filter(Boolean))];

  if (!parents.length) throw new Error("Informe ao menos uma tarefa pai.");

  progress({ phase: "create", done: 0, total: parents.length });
  let done = 0;

  const out = await mapLimit(parents, 3, async (parentKey) => {
    const res = await createSubtask({ ...payload, parentKey });
    progress({ phase: "create", done: ++done, total: parents.length, current: parentKey, ok: true });
    return res;
  });

  const results = out.map((r, i) =>
    r.ok ? { ...r.value, ok: true }
         : { key: null, parentKey: parents[i], ok: false, detail: r.error }
  );

  return {
    total: results.length,
    created: results.filter((r) => r.ok && r.created).length,
    reused: results.filter((r) => r.ok && !r.created).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

/* ------------------------------------------------------------------ */
/* Jornada de trabalho: apontamentos existentes + plano                */
/* ------------------------------------------------------------------ */

function workdayFromConfig(cfg) {
  const start = parseHM(cfg.workStart, DEFAULT_WORKDAY.start);
  const end = parseHM(cfg.workEnd, DEFAULT_WORKDAY.end);
  const capHours = Number(cfg.dailyCapHours) > 0 ? Number(cfg.dailyCapHours) : 6;
  if (end <= start) throw new Error("Jornada inválida nas Opções: o fim precisa ser depois do início.");
  return {
    start,
    end,
    // O teto nunca passa do tamanho da janela: 11–17 comporta no máximo 6h.
    capMinutes: Math.min(Math.round(capHours * 60), end - start),
    skipWeekends: cfg.skipWeekends !== false,
    overflow: cfg.overflowMode === "nextDay" ? "nextDay" : "sameDay",
  };
}

/** Converte o "started" de um worklog para dia/minuto no fuso local. */
function localSlot(startedIso) {
  const dt = new Date(startedIso);
  const pad = (x) => String(x).padStart(2, "0");
  return {
    date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
    start: dt.getHours() * 60 + dt.getMinutes(),
  };
}

/**
 * Apontamentos que já vêm na busca (campo `worklog`). O Jira manda até 20 por issue;
 * se a issue tem mais, devolve null e quem chamou busca no endpoint próprio.
 * Isso evita uma chamada por issue na grande maioria dos casos (subtarefas têm poucos apontamentos).
 */
function inlineWorklogs(issue) {
  const wl = issue?.fields?.worklog;
  if (!wl || !Array.isArray(wl.worklogs) || (wl.total ?? 0) > wl.worklogs.length) return null;
  return wl.worklogs;
}

const _busyCache = new Map();   // "from|to" -> { at, data }
const BUSY_TTL_MS = 60 * 1000;

/**
 * Seus apontamentos entre duas datas, agrupados por dia:
 *   { "2026-10-13": [{ key, start, minutes }] }
 * 1) JQL acha as issues onde você apontou no período;
 * 2) o /worklog de cada uma traz os horários, filtrados pelo seu accountId.
 */
async function fetchMyBusy(from, to, cfg, { force = false } = {}) {
  const cacheKey = `${from}|${to}`;
  const hit = _busyCache.get(cacheKey);
  if (!force && hit && Date.now() - hit.at < BUSY_TTL_MS) return hit.data;

  const me = await getMyself(cfg);
  const jql = `worklogAuthor = currentUser() AND worklogDate >= "${from}" AND worklogDate <= "${to}"`;
  const issues = await runJql(jql, ["summary", "status", "parent", "worklog"], 300, cfg);

  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = addDays(to, 1).split("-").map(Number);
  const after = new Date(fy, fm - 1, fd).getTime();
  const before = new Date(ty, tm - 1, td).getTime();

  const byDay = {};
  const push = (iss, w) => {
    if (w.author?.accountId !== me.accountId) return;
    const slot = localSlot(w.started);
    if (slot.date < from || slot.date > to) return;
    (byDay[slot.date] ||= []).push({
      key: iss.key,
      summary: iss.fields?.summary || "",
      status: iss.fields?.status?.name || "",
      statusCategory: iss.fields?.status?.statusCategory?.key || "",
      parentKey: iss.fields?.parent?.key || null,
      parentSummary: iss.fields?.parent?.fields?.summary || "",
      start: slot.start,
      minutes: Math.round((w.timeSpentSeconds || 0) / 60),
    });
  };
  const truncated = [];
  for (const iss of issues) {
    const inline = inlineWorklogs(iss);
    if (inline) inline.forEach((w) => push(iss, w));
    else truncated.push(iss);
  }
  await mapLimit(truncated, 6, async (iss) => {
    let startAt = 0;
    for (;;) {
      const page = await jira(
        `/rest/api/3/issue/${encodeURIComponent(iss.key)}/worklog?startedAfter=${after}&startedBefore=${before}&startAt=${startAt}&maxResults=1000`,
        { cfg }
      );
      const logs = page?.worklogs || [];
      for (const w of logs) push(iss, w);
      startAt += logs.length;
      if (!logs.length || startAt >= (page?.total ?? 0)) break;
    }
  });

  _busyCache.set(cacheKey, { at: Date.now(), data: byDay });
  return byDay;
}

const clearBusyCache = () => _busyCache.clear();

/**
 * Plano de apontamento: encaixa cada item na jornada, depois do que já está
 * no Jira, sem passar do teto diário. Procura até 30 dias à frente.
 */
/**
 * Hora de início escolhida ("HH:MM"). Vazio = automático (primeiro horário
 * livre a partir do início da jornada).
 *  - modo "mesmo dia": qualquer hora do dia vale — você informou, é respeitado;
 *  - modo "próximo dia": fora da jornada é recusado.
 */
function resolveStartTime(startTime, workday) {
  if (!startTime) return null;
  const min = parseHM(startTime, null);
  if (min == null) throw new Error(`Hora de início inválida: "${startTime}". Use HH:MM.`);
  if (workday.overflow === "sameDay") return min;
  if (min < workday.start || min >= workday.end) {
    throw new Error(
      `A hora de início ${fmtHM(min)} está fora da jornada (${fmtHM(workday.start)}–${fmtHM(workday.end)}).`
    );
  }
  return min;
}

async function planWorklogs({ startDate, startTime = "", items, force = false }) {
  const cfg = await getConfig();
  const workday = workdayFromConfig(cfg);
  const from = startDate || todayLocal();
  const to = addDays(from, 30);
  const notBefore = resolveStartTime(startTime, workday);

  let busyByDay = {};
  let busyError = null;
  try {
    busyByDay = await fetchMyBusy(from, to, cfg, { force });
  } catch (e) {
    // Sem conseguir ler seus apontamentos, o plano ainda respeita janela e teto,
    // mas pode sobrepor algo já registrado — isso é avisado na tela.
    busyError = e.message;
  }

  const plan = buildPlan({ startDate: from, items: items || [], busyByDay, workday, notBefore });

  // Hora escolhida que já está ocupada: o plano empurra para o próximo livre — avisa.
  const firstChunk = plan.items.find((i) => i.chunks.length)?.chunks[0];
  const shifted = notBefore != null && firstChunk &&
    (firstChunk.date !== from || firstChunk.start !== notBefore)
    ? `${fmtHM(notBefore)} já está ocupado ou sem saldo; o primeiro horário livre é ${firstChunk.date === from ? "" : firstChunk.date.split("-").reverse().slice(0, 2).join("/") + " "}${fmtHM(firstChunk.start)}.`
    : null;

  return {
    ...plan,
    busyError,
    shifted,
    startTime: notBefore != null ? fmtHM(notBefore) : null,
    workdayLabel: `${fmtHM(workday.start)}–${fmtHM(workday.end)}`,
  };
}

/**
 * Painel: tudo o que está atribuído a você e ainda não foi resolvido, com
 * agregados para os indicadores (atrasadas, vencendo, horas, por status).
 */
async function myDashboard(p = {}) {
  const cfg = await getConfig();
  const today = todayLocal();
  const weekEnd = addDays(today, 7);

  const projects = (p.projects || []).filter(Boolean).map((x) => String(x).toUpperCase());
  const scope = projects.length ? ` AND project in (${projects.map(jqlString).join(", ")})` : "";

  const fields = ["summary", "status", "issuetype", "parent", "duedate", "priority", "timetracking", "project", "updated"];
  if (cfg.storyPointsFieldId) fields.push(cfg.storyPointsFieldId);

  const [open, doneRecent] = await Promise.all([
    runJql(`assignee = currentUser() AND resolution = Unresolved${scope} ORDER BY duedate ASC, updated DESC`, fields, 200, cfg),
    runJql(`assignee = currentUser() AND statusCategory = Done AND statusCategoryChangedDate >= -30d${scope} ORDER BY updated DESC`,
      ["summary", "status", "issuetype", "parent", "project", "statuscategorychangedate"], 200, cfg).catch(() => []),
  ]);

  const map = (i) => {
    const f = i.fields || {};
    const tt = f.timetracking || {};
    const due = f.duedate || null;
    return {
      key: i.key,
      summary: f.summary || "",
      status: f.status?.name || "",
      statusCategory: f.status?.statusCategory?.key || "",
      isSubtask: !!f.issuetype?.subtask,
      type: f.issuetype?.name || "",
      parentKey: f.parent?.key || null,
      parentSummary: f.parent?.fields?.summary || "",
      project: f.project?.key || i.key.split("-")[0],
      priority: f.priority?.name || "",
      due,
      overdue: !!due && due < today,
      dueToday: due === today,
      dueWeek: !!due && due > today && due <= weekEnd,
      estimate: Math.round((tt.originalEstimateSeconds || 0) / 60),
      spent: Math.round((tt.timeSpentSeconds || 0) / 60),
      storyPoints: cfg.storyPointsFieldId ? (f[cfg.storyPointsFieldId] ?? null) : null,
      updated: f.updated || null,
    };
  };

  const issues = open.map(map);

  const statusMap = new Map();
  for (const it of issues) {
    const e = statusMap.get(it.status) || { name: it.status, category: it.statusCategory, count: 0 };
    e.count += 1;
    statusMap.set(it.status, e);
  }
  const catOrder = { new: 0, indeterminate: 1, done: 2 };

  return {
    today,
    url: cfg.baseUrl,
    issues,
    projects: [...new Set(issues.map((i) => i.project))].sort(),
    statuses: [...statusMap.values()].sort((a, b) =>
      (catOrder[a.category] ?? 1) - (catOrder[b.category] ?? 1) || b.count - a.count),
    kpi: {
      open: issues.length,
      overdue: issues.filter((i) => i.overdue).length,
      dueToday: issues.filter((i) => i.dueToday).length,
      dueWeek: issues.filter((i) => i.dueWeek).length,
      noDue: issues.filter((i) => !i.due).length,
      parents: issues.filter((i) => !i.isSubtask).length,
      subtasks: issues.filter((i) => i.isSubtask).length,
      spent: issues.reduce((s, i) => s + i.spent, 0),
      estimate: issues.reduce((s, i) => s + i.estimate, 0),
      doneWeek: doneRecent.filter((i) => Date.parse(i.fields?.statuscategorychangedate) >= Date.now() - 7 * 864e5).length,
    },
    done: doneRecent.map((i) => ({ key: i.key, project: i.fields?.project?.key || i.key.split("-")[0],
      at: Date.parse(i.fields?.statuscategorychangedate) || null })),
  };
}

/**
 * "Meu dia": o que você apontou numa data, por horário e por demanda, contra a
 * meta (4h) e o teto (6h) — mais o histórico dos dias úteis anteriores.
 */
async function dayReport(p = {}) {
  const cfg = await getConfig();
  const wd = workdayFromConfig(cfg);
  const goal = Math.min(Math.round((Number(cfg.dailyGoalHours) || 4) * 60), wd.capMinutes);
  const date = p.date || todayLocal();
  const span = Math.min(Math.max(Number(p.days) || 10, 1), 31);   // dias úteis no histórico

  // Volta no calendário até juntar `span` dias úteis (fim de semana não conta).
  const days = [];
  for (let d = date, guard = 0; days.length < span && guard < 62; d = addDays(d, -1), guard++) {
    if (wd.skipWeekends && [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) continue;
    days.push(d);
  }
  const from = days[days.length - 1];
  const busy = await fetchMyBusy(from, date, cfg, { force: !!p.force });

  const entries = (busy[date] || [])
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((e) => ({ ...e, end: e.start + e.minutes, outside: e.start < wd.start || e.start + e.minutes > wd.end }));

  // Agrupa por demanda: a mesma subtarefa pode ter vários apontamentos no dia.
  const byIssue = new Map();
  for (const e of entries) {
    const cur = byIssue.get(e.key) || { key: e.key, summary: e.summary, status: e.status,
      statusCategory: e.statusCategory, parentKey: e.parentKey, parentSummary: e.parentSummary,
      minutes: 0, slots: [] };
    cur.minutes += e.minutes;
    cur.slots.push({ start: e.start, end: e.end });
    byIssue.set(e.key, cur);
  }

  const total = entries.reduce((s, e) => s + e.minutes, 0);
  const history = days.slice().reverse().map((d) => {
    const t = (busy[d] || []).reduce((s, e) => s + e.minutes, 0);
    const projects = {};
    for (const e of busy[d] || []) { const pr = e.key.split("-")[0]; projects[pr] = (projects[pr] || 0) + e.minutes; }
    return { date: d, total: t, goalMet: t >= goal, issues: new Set((busy[d] || []).map((e) => e.key)).size, projects,
      keys: [...new Set((busy[d] || []).map((e) => e.key))] };
  });

  return {
    date,
    url: cfg.baseUrl,
    workday: { start: wd.start, end: wd.end, cap: wd.capMinutes, goal },
    total,
    goalMet: total >= goal,
    overCap: total > wd.capMinutes,
    entries,
    issues: [...byIssue.values()].sort((a, b) => b.minutes - a.minutes),
    history,
    metDays: history.filter((h) => h.goalMet).length,
  };
}

/** QuickFill DEV: meus apontamentos dia a dia no intervalo (todos os projetos). */
async function myProgress(p = {}) {
  const cfg = await getConfig();
  const wd = workdayFromConfig(cfg);
  const goal = Math.min(Math.round((Number(cfg.dailyGoalHours) || 4) * 60), wd.capMinutes);
  const to = p.to || todayLocal();
  const from = p.from || addDays(to, -44);
  const busy = await fetchMyBusy(from, to, cfg, { force: !!p.force });
  const days = {};
  for (const [d, list] of Object.entries(busy)) days[d] = list.slice().sort((a, b) => a.start - b.start);
  const me = await getMyself(cfg);
  return {
    from, to, url: cfg.baseUrl, me: { accountId: me.accountId, name: me.displayName },
    workday: { start: wd.start, end: wd.end, cap: wd.capMinutes, goal },
    skipWeekends: wd.skipWeekends,
    days,
    fetchedAt: Date.now(),
  };
}

/** Meta diária ajustada direto no modal (QuickFill DEV). */
async function saveGoal(p = {}) {
  const cfg = await getConfig();
  const wd = workdayFromConfig(cfg);
  const h = Math.round(Number(p.goalHours) * 4) / 4;
  if (!(h > 0)) throw new Error("Meta inválida.");
  if (h * 60 > wd.capMinutes) throw new Error(`A meta não pode passar do teto de ${fmtDur(wd.capMinutes)}.`);
  await chrome.storage.sync.set({ dailyGoalHours: h });
  return { goal: Math.round(h * 60) };
}

/** Prévia para a barra de jornada do modal. */
async function previewWorkday(p) {
  const minutes = parseDuration(p.timeSpent).minutes || 0;
  const keys = p.keys?.length ? p.keys : ["(novo)"];
  const items = minutes ? keys.map((key) => ({ key, minutes })) : [];
  return planWorklogs({ startDate: p.startDate, startTime: p.startTime, items, force: !!p.force });
}

/** Estimativa a gravar — a existente nunca muda sozinha (ver pickEstimate). */
function resolveEstimate(payload, cfg, current = payload.currentEstimate) {
  return pickEstimate({
    typed: payload.originalEstimate,
    current,
    spent: payload.timeSpent,
    fromSpent: cfg.estimateFromSpent !== false,
  });
}

/** Aplicação de uma única subtarefa, já com o plano da jornada. */
async function applySingle(payload) {
  const cfg = await getConfig();
  const spent = parseDuration(payload.timeSpent);
  if (!spent.ok) throw new Error(`Controle de tempo — ${spent.error}`);

  let chunks = [];
  if (spent.minutes) {
    const plan = await planWorklogs({
      startDate: payload.startDate,
      startTime: payload.startTime,
      items: [{ key: payload.key, minutes: spent.minutes }],
      force: true,
    });
    if (plan.unplaced) {
      throw new Error(plan.workday.overflow === "sameDay"
        ? `Não cabe no dia: ${fmtDur(plan.unplaced)} passariam da meia-noite. Ajuste o horário ou o tempo.`
        : `Não há espaço na jornada para ${fmtDur(plan.unplaced)} nos próximos 30 dias.`);
    }
    chunks = plan.items[0].chunks;
  }

  const res = await applyToSubtask({
    ...payload,
    originalEstimate: resolveEstimate(payload, cfg),
    worklogChunks: chunks,
  });
  clearBusyCache();
  return res;
}

/* ------------------------------------------------------------------ */
/* Equipe: apontamentos de todas as pessoas, com meta e teto individuais */
/* ------------------------------------------------------------------ */

/**
 * Estratégia para atualizar a cada 5 s sem sobrecarregar o Jira:
 *  - CARGA COMPLETA (ao abrir, ao trocar de dia e a cada 3 min): JQL das issues com
 *    worklog nos últimos ~10 dias + worklogs de cada uma. Dá o dia, o histórico e a
 *    lista de quem costuma apontar (inclusive quem ainda não apontou hoje).
 *  - DELTA (a cada 5 s, só para hoje): JQL das issues ATUALIZADAS nos últimos 2 min
 *    que têm worklog no dia ou já estavam no cache → rebusca só os worklogs delas.
 *    Registrar/editar/excluir um apontamento atualiza a issue, então nada escapa.
 */
const _team = new Map();          // date -> estado do cache
const TEAM_FULL_MS = 3 * 60 * 1000;
const TEAM_HISTORY_DAYS = 7;      // dias corridos para histórico e lista de pessoas

function teamProjects(cfg) {
  const list = splitList(cfg.teamProjects);
  if (list.length) return list.map((x) => x.toUpperCase());
  return [...new Set([cfg.defaultProject, cfg.sustProject || "SUS"].filter(Boolean).map((x) => x.toUpperCase()))];
}

/** scope = "cfg" (projetos configurados) ou "all" (todos os projetos visíveis). */
function teamScope(cfg, scope = "cfg", projects = null) {
  if (scope === "all") return "";
  const pr = projects?.length ? projects : teamProjects(cfg);
  return pr.length ? ` AND project in (${pr.map(jqlString).join(", ")})` : "";
}

const TEAM_FIELDS = ["summary", "status", "parent", "project", "issuetype", "worklog"];

const issueInfo = (i) => ({
  key: i.key,
  summary: i.fields?.summary || "",
  status: i.fields?.status?.name || "",
  statusCategory: i.fields?.status?.statusCategory?.key || "",
  parentKey: i.fields?.parent?.key || null,
  project: i.fields?.project?.key || i.key.split("-")[0],
  isSubtask: !!i.fields?.issuetype?.subtask,
});

/** Busca os worklogs de uma issue no intervalo e devolve no formato do cache. */
async function issueWorklogs(key, from, to, cfg) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = addDays(to, 1).split("-").map(Number);
  const after = new Date(fy, fm - 1, fd).getTime();
  const before = new Date(ty, tm - 1, td).getTime();
  const out = [];
  let startAt = 0;
  for (;;) {
    const page = await jira(
      `/rest/api/3/issue/${encodeURIComponent(key)}/worklog?startedAfter=${after}&startedBefore=${before}&startAt=${startAt}&maxResults=1000`,
      { cfg }
    );
    const logs = page?.worklogs || [];
    for (const w of logs) {
      const slot = localSlot(w.started);
      if (slot.date < from || slot.date > to || !w.author?.accountId) continue;
      out.push({
        id: String(w.id),
        key,
        accountId: w.author.accountId,
        name: w.author.displayName || "—",
        date: slot.date,
        start: slot.start,
        minutes: Math.round((w.timeSpentSeconds || 0) / 60),
      });
    }
    startAt += logs.length;
    if (!logs.length || startAt >= (page?.total ?? 0)) break;
  }
  return out;
}

async function teamFullLoad(date, cfg, scope, { projects = null, light = false } = {}) {
  const startedAt = Date.now();
  // Modo leve (QuickFill DEV, cartão "Equipe no dia"): só o dia, sem os 7 dias de histórico.
  const from = light ? date : addDays(date, -TEAM_HISTORY_DAYS);
  const sc = teamScope(cfg, scope, projects);

  // O dia escolhido vem numa consulta própria e completa; o histórico (só para a lista
  // de pessoas e os mini-gráficos) vem em outra, com limite menor.
  const [dayIssues, histIssues] = await Promise.all([
    runJql(`worklogDate = "${date}"${sc}`, TEAM_FIELDS, 1000, cfg),
    light ? [] : runJql(`worklogDate >= "${from}" AND worklogDate < "${date}"${sc}`, TEAM_FIELDS, 500, cfg),
  ]);
  const all = new Map([...histIssues, ...dayIssues].map((i) => [i.key, i]));

  const state = {
    date, from, scope, loadedAt: startedAt, syncedAt: startedAt,
    issues: new Map(), byIssue: new Map(),
    roster: new Map(),     // quem apontou no período — continua na lista mesmo se excluir tudo
    prevTotals: new Map(), // totais do último relatório, para marcar quem mudou
    failed: new Set(),     // tarefas que não puderam ser lidas: relidas na próxima rodada
    truncated: dayIssues.length >= 1000,
  };
  state.projects = projects;
  state.light = light;
  for (const i of all.values()) state.issues.set(i.key, issueInfo(i));
  await readIssues(state, [...all.keys()], cfg, all);
  return state;
}

/** Converte worklogs crus do Jira para o formato do cache, filtrando o intervalo. */
function toCacheLogs(key, raw, from, to) {
  const out = [];
  for (const w of raw) {
    if (!w.author?.accountId) continue;
    const slot = localSlot(w.started);
    if (slot.date < from || slot.date > to) continue;
    out.push({ id: String(w.id), key, accountId: w.author.accountId, name: w.author.displayName || "—",
      date: slot.date, start: slot.start, minutes: Math.round((w.timeSpentSeconds || 0) / 60) });
  }
  return out;
}

/** Lê (ou relê) os apontamentos das tarefas; falhas ficam marcadas em state.failed.
 *  Quando a busca já trouxe todos os apontamentos da issue (`raw`), não chama o Jira de novo. */
async function readIssues(state, keys, cfg, raw = null) {
  const pending = [];
  for (const key of keys) {
    const inline = raw?.get(key) ? inlineWorklogs(raw.get(key)) : null;
    if (!inline) { pending.push(key); continue; }
    const logs = toCacheLogs(key, inline, state.from, state.date);
    state.failed.delete(key);
    state.byIssue.set(key, logs);
    for (const w of logs) state.roster.set(w.accountId, w.name);
  }
  keys = pending;
  const res = await mapLimit(keys, 6, (k) => issueWorklogs(k, state.from, state.date, cfg));
  res.forEach((r, idx) => {
    const key = keys[idx];
    if (!r.ok) { state.failed.add(key); return; }
    state.failed.delete(key);
    state.byIssue.set(key, r.value);   // substitui: cobre inclusão, edição e exclusão
    for (const w of r.value) state.roster.set(w.accountId, w.name);
  });
}

async function teamDelta(state, cfg) {
  const startedAt = Date.now();
  // Janela = todo o tempo desde a última leitura (+1 min de folga), não um valor fixo:
  // se a aba ficou fechada 10 min, a próxima leitura cobre os 10 min.
  const mins = Math.max(2, Math.ceil((startedAt - state.syncedAt) / 60000) + 1);
  const known = [...state.issues.keys()];
  const keyClause = known.length ? ` OR key in (${known.slice(0, 300).join(", ")})` : "";
  const jql = `(worklogDate = "${state.date}"${keyClause}) AND updated >= "-${mins}m"${teamScope(cfg, state.scope, state.projects)}`;
  const touched = await runJql(jql, TEAM_FIELDS, 200, cfg);
  for (const i of touched) state.issues.set(i.key, issueInfo(i));

  const keys = [...new Set([...touched.map((i) => i.key), ...state.failed])];
  if (keys.length) await readIssues(state, keys, cfg, new Map(touched.map((i) => [i.key, i])));
  state.syncedAt = startedAt;   // início da rodada: nada que aconteceu durante ela fica de fora
  return state;
}

async function teamReport(p = {}) {
  const cfg = await getConfig();
  const today = todayLocal();
  const date = p.date || today;
  const live = date === today;

  const scope = p.scope === "all" ? "all" : "cfg";
  const projects = Array.isArray(p.projects) && p.projects.length ? p.projects.map((x) => String(x).toUpperCase()) : null;
  const light = !!p.light;
  const cacheKey = `${date}|${scope}|${projects ? projects.join("+") : ""}|${light ? "l" : "f"}`;
  // Um relatório completo do mesmo dia também atende o pedido leve.
  let state = _team.get(cacheKey) || (light ? _team.get(`${date}|${scope}|${projects ? projects.join("+") : ""}|f`) : null);
  const prevTotals = state?.prevTotals || new Map();
  if (!state || p.force || Date.now() - state.loadedAt > TEAM_FULL_MS) {
    state = await teamFullLoad(date, cfg, scope, { projects, light });
    state.prevTotals = prevTotals;
    _team.set(cacheKey, state);
  } else if (live) {
    await teamDelta(state, cfg);
  } else if (state.failed.size) {
    await readIssues(state, [...state.failed], cfg);
  }

  const me = await getMyself(cfg);
  const people = cfg.teamPeople || {};
  const defGoal = Math.round((Number(cfg.teamGoalHours) || 4) * 60);
  const defCap = Math.round((Number(cfg.teamCapHours) || 6) * 60);

  // Dias úteis do histórico (mais antigo → mais recente)
  const histDays = [];
  for (let d = date; histDays.length < 5 && d >= state.from; d = addDays(d, -1)) {
    if (![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) histDays.unshift(d);
  }

  const byPerson = new Map();
  const ensure = (accountId, name) => {
    if (!byPerson.has(accountId)) {
      const conf = people[accountId] || {};
      byPerson.set(accountId, {
        accountId,
        name: conf.name || name || "—",
        isMe: accountId === me.accountId,
        goal: Math.round((Number(conf.goal) || defGoal / 60) * 60),
        cap: Math.round((Number(conf.cap) || defCap / 60) * 60),
        custom: !!(conf.goal || conf.cap),
        pinned: !!conf.pinned,
        hidden: !!conf.hidden,
        total: 0,
        entries: [],
        history: Object.fromEntries(histDays.map((d) => [d, 0])),
        lastLog: null,
      });
    }
    return byPerson.get(accountId);
  };

  for (const [key, logs] of state.byIssue) {
    const info = state.issues.get(key) || { key };
    for (const w of logs) {
      const person = ensure(w.accountId, w.name);
      if (w.date in person.history) person.history[w.date] += w.minutes;
      if (!person.lastLog || w.date > person.lastLog) person.lastLog = w.date;
      if (w.date !== date) continue;
      person.total += w.minutes;
      person.entries.push({ ...w, end: w.start + w.minutes, summary: info.summary, status: info.status,
        statusCategory: info.statusCategory, parentKey: info.parentKey, project: info.project });
    }
  }
  // Continuam na lista: quem apontou no período, os fixados e você — mesmo com 0h no dia.
  for (const [id, name] of state.roster) ensure(id, name);
  for (const [id, conf] of Object.entries(people)) if (conf.pinned) ensure(id, conf.name);
  ensure(me.accountId, me.displayName);

  const list = [...byPerson.values()].map((pp) => {
    pp.entries.sort((a, b) => a.start - b.start);
    const byIssue = new Map();
    for (const e of pp.entries) {
      const cur = byIssue.get(e.key) || { key: e.key, summary: e.summary, status: e.status,
        statusCategory: e.statusCategory, parentKey: e.parentKey, minutes: 0, slots: [] };
      cur.minutes += e.minutes;
      cur.slots.push({ start: e.start, end: e.end });
      byIssue.set(e.key, cur);
    }
    pp.issues = [...byIssue.values()].sort((a, b) => b.minutes - a.minutes);
    pp.state = pp.total === 0 ? "none" : pp.total > pp.cap ? "over" : pp.total >= pp.goal ? "met" : "under";
    pp.history = histDays.map((d) => ({ date: d, total: pp.history[d] || 0 }));
    const before = state.prevTotals.get(pp.accountId);
    pp.changed = before !== undefined && before !== pp.total;
    pp.delta = before !== undefined ? pp.total - before : 0;
    return pp;
  });
  state.prevTotals = new Map(list.map((pp) => [pp.accountId, pp.total]));

  // Conferência com a pílula do topo: seu total em TODOS os projetos x o total no escopo.
  let meCheck = null;
  if (scope !== "all") {
    try {
      const mine = (await fetchMyBusy(date, date, cfg, { force: live }))[date] || [];
      const allTotal = mine.reduce((sum, e) => sum + e.minutes, 0);
      const scoped = list.find((pp) => pp.isMe)?.total || 0;
      const inScope = new Set(projects || teamProjects(cfg));
      const outside = [...new Set(mine.map((e) => e.key.split("-")[0]).filter((k) => !inScope.has(k)))];
      if (allTotal > scoped) meCheck = { allTotal, scoped, outside };
    } catch { /* conferência é auxiliar */ }
  }

  return {
    date,
    live,
    url: cfg.baseUrl,
    syncedAt: state.syncedAt,
    loadedAt: state.loadedAt,
    projects: scope === "all" ? [] : (projects || teamProjects(cfg)),
    scope,
    defaults: { goal: defGoal, cap: defCap },
    people: list,
    partial: state.failed.size,
    truncated: state.truncated,
    meCheck,
  };
}

async function teamSavePerson(p) {
  if (!p?.accountId) throw new Error("Pessoa inválida.");
  const { teamPeople = {} } = await chrome.storage.sync.get({ teamPeople: {} });
  const cur = teamPeople[p.accountId] || {};
  const next = { ...cur };
  if (p.name) next.name = p.name;
  for (const k of ["goal", "cap"]) {
    if (p[k] === null) delete next[k];
    else if (p[k] !== undefined) {
      const v = Number(p[k]);
      if (!(v > 0 && v <= 24)) throw new Error("Meta e teto precisam estar entre 0 e 24 horas.");
      next[k] = v;
    }
  }
  if (next.goal && next.cap && next.goal > next.cap) throw new Error("A meta não pode passar do teto.");
  for (const k of ["pinned", "hidden"]) if (p[k] !== undefined) next[k] = !!p[k];
  teamPeople[p.accountId] = next;
  await chrome.storage.sync.set({ teamPeople });
  return next;
}

async function teamUserSearch(p) {
  const cfg = await getConfig();
  const q = String(p.query || "").trim();
  if (q.length < 2) return [];
  const users = await jira(`/rest/api/3/user/search?query=${encodeURIComponent(q)}&maxResults=10`, { cfg });
  return (users || [])
    .filter((u) => u.accountType === "atlassian" && u.active !== false)
    .map((u) => ({ accountId: u.accountId, name: u.displayName }));
}

/* ------------------------------------------------------------------ */
/* Sprints de cada espaço (MEED / SUS)                                 */
/* ------------------------------------------------------------------ */

const _sprintCache = { at: 0, data: null };
const SPRINT_TTL_MS = 60 * 1000;

/** Quadro com sprints (scrum) do espaço: o escolhido no Lote, se for scrum; senão o 1º scrum do projeto. */
/** O quadro aceita sprints? (kanban responde erro em /sprint). */
async function boardHasSprints(boardId, cfg) {
  try { await jira(`/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint?maxResults=1`, { cfg, retries: 1 }); return true; }
  catch { return false; }
}

/**
 * Quadro com sprints do espaço. Aceita quadros "scrum" e também os dos projetos gerenciados
 * pela equipe (tipo "simple"), que antes ficavam de fora e davam "nenhuma sprint encontrada".
 */
async function findScrumBoard(space, cfg) {
  if (space.boardId && await boardHasSprints(space.boardId, cfg)) {
    try { return await jira(`/rest/agile/1.0/board/${encodeURIComponent(space.boardId)}`, { cfg }); } catch { /* segue */ }
  }
  if (!space.project) return null;
  const page = await jira(`/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(space.project)}&maxResults=50`, { cfg });
  const boards = (page?.values || []).sort((x, y) =>
    (y.type === "scrum") - (x.type === "scrum")
    || new RegExp(`\\b${space.project}\\b`, "i").test(y.name) - new RegExp(`\\b${space.project}\\b`, "i").test(x.name));
  for (const b of boards.slice(0, 6)) if (b.type !== "kanban" && await boardHasSprints(b.id, cfg)) return b;
  for (const b of boards.slice(0, 6)) if (b.type === "kanban" && await boardHasSprints(b.id, cfg)) return b;
  return null;
}

/** Id do campo "Sprint" (customfield) — para descobrir sprints pelas próprias demandas. */
let _sprintField;
async function sprintFieldId(cfg) {
  if (_sprintField !== undefined) return _sprintField;
  try {
    const fields = await jira("/rest/api/3/field", { cfg });
    const f = (fields || []).find((x) => x.schema?.custom === "com.pyxis.greenhopper.jira:gh-sprint")
      || (fields || []).find((x) => /^sprint$/i.test(x.name));
    _sprintField = f?.id || null;
  } catch { _sprintField = null; }
  return _sprintField;
}

const toSprint = (x) => ({ id: x.id, name: x.name, state: x.state, goal: x.goal || "", boardId: x.boardId || null,
  start: sprintDate(x.startDate), end: sprintDate(x.state === "closed" ? (x.completeDate || x.endDate) : x.endDate) });

/**
 * Plano B: sprints a partir das demandas do projeto (campo Sprint). Funciona mesmo quando
 * a sprint está num quadro de outro projeto ou o quadro não é encontrado.
 */
async function sprintsByJql(project, cfg) {
  const sf = await sprintFieldId(cfg);
  if (!sf) return { active: [], future: [], recent: [] };
  const collect = (issues, map) => {
    for (const i of issues) for (const sp of i.fields?.[sf] || []) if (sp?.id) map.set(sp.id, sp);
  };
  const open = new Map(), closed = new Map();
  const [o, c] = await Promise.all([
    runJql(`project = ${jqlString(project)} AND sprint in openSprints()`, [sf], 100, cfg).catch(() => []),
    runJql(`project = ${jqlString(project)} AND sprint in closedSprints() AND updated >= -120d`, [sf], 200, cfg).catch(() => []),
  ]);
  collect(o, open);
  collect([...o, ...c], closed);
  const all = [...new Map([...closed, ...open]).values()].map(toSprint);
  return {
    active: all.filter((x) => x.state === "active"),
    future: all.filter((x) => x.state === "future").sort((a, b) => (a.start || "9999").localeCompare(b.start || "9999")),
    recent: all.filter((x) => x.state === "closed" && x.start).sort((a, b) => (b.end || "").localeCompare(a.end || "")).slice(0, 12),
  };
}

/** Últimas 3 sprints encerradas do quadro (cache de 10 min: só mudam quando uma sprint fecha). */
const _closedCache = new Map();
async function closedSprints(boardId, cfg) {
  const hit = _closedCache.get(boardId);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  const all = [];
  for (let startAt = 0; startAt < 1000; ) {
    const page = await jira(`/rest/agile/1.0/board/${boardId}/sprint?state=closed&startAt=${startAt}&maxResults=50`, { cfg });
    const vals = page?.values || [];
    all.push(...vals);
    startAt += vals.length;
    if (!vals.length || page?.isLast) break;
  }
  const data = all
    .map((x) => ({ id: x.id, name: x.name, state: "closed", start: sprintDate(x.startDate), end: sprintDate(x.completeDate || x.endDate) }))
    .filter((x) => x.start)
    .sort((a, b) => (b.end || "").localeCompare(a.end || ""))
    .slice(0, 12);
  _closedCache.set(boardId, { at: Date.now(), data });
  return data;
}

async function sprintIssues(sprintId, me, cfg) {
  const out = [];
  for (let startAt = 0; startAt < 1000; ) {
    const page = await jira(
      `/rest/agile/1.0/sprint/${sprintId}/issue?fields=status,assignee,issuetype,summary&startAt=${startAt}&maxResults=100`,
      { cfg }
    );
    const list = page?.issues || [];
    out.push(...list);
    startAt += list.length;
    if (!list.length || startAt >= (page?.total ?? 0)) break;
  }
  const cat = (i) => i.fields?.status?.statusCategory?.key || "new";
  const mine = out.filter((i) => i.fields?.assignee?.accountId === me.accountId);
  return {
    keys: out.map((i) => i.key),
    stats: {
      total: out.length,
      done: out.filter((i) => cat(i) === "done").length,
      doing: out.filter((i) => cat(i) === "indeterminate").length,
      todo: out.filter((i) => cat(i) === "new").length,
      mine: mine.length,
      mineDone: mine.filter((i) => cat(i) === "done").length,
    },
  };
}

const sprintDate = (iso) => (iso ? localSlot(iso).date : null);

async function sprintInfo(p = {}) {
  const projs = (p.projects || []).map((x) => String(x).toUpperCase()).filter(Boolean);
  const ckey = projs.join(",");
  if (!p.force && _sprintCache.data && _sprintCache.key === ckey && Date.now() - _sprintCache.at < SPRINT_TTL_MS) return _sprintCache.data;
  const cfg = await getConfig();
  const me = await getMyself(cfg);
  const spaces = projs.length ? projs.map((pr) => ({ id: pr, label: pr, project: pr, boardId: "" })) : [
    { id: "batch", label: (cfg.defaultProject || "MEED").toUpperCase(), project: (cfg.defaultProject || "MEED").toUpperCase(), boardId: cfg.batchBoardId },
    { id: "sustentacao", label: (cfg.sustProject || "SUS").toUpperCase(), project: (cfg.sustProject || "SUS").toUpperCase(), boardId: cfg.sustBoardId },
  ];

  const result = await Promise.all(spaces.map(async (sp) => {
    try {
      let board = null, active = [], future = [], recent = [], source = "quadro";
      try { board = await findScrumBoard(sp, cfg); } catch { board = null; }
      if (board) {
        const page = await jira(`/rest/agile/1.0/board/${board.id}/sprint?state=active,future&maxResults=50`, { cfg });
        const sprints = (page?.values || []).map(toSprint);
        active = sprints.filter((x) => x.state === "active");
        future = sprints.filter((x) => x.state === "future").sort((a, b) => (a.start || "9999").localeCompare(b.start || "9999"));
        recent = await closedSprints(board.id, cfg).catch(() => []);
      }
      if (!active.length) {
        // Plano B: pelas demandas do projeto (campo Sprint)
        const viaJql = await sprintsByJql(sp.project, cfg);
        if (viaJql.active.length || viaJql.recent.length) {
          source = "demandas";
          active = viaJql.active;
          future = future.length ? future : viaJql.future;
          recent = recent.length ? recent : viaJql.recent;
        }
      }
      if (!active.length && !recent.length) return { ...sp, active: [], recent: [], closed: [], next: future[0] || null, error: `Nenhuma sprint encontrada para ${sp.project} (nem no quadro, nem nas demandas).` };
      for (const a of active) Object.assign(a, await sprintIssues(a.id, me, cfg));
      // recent: as 3 últimas (velocidade); closed: até 12, para ver uma sprint anterior no SCRUM
      return { ...sp, board: board ? { id: board.id, name: board.name } : null, source, active, next: future[0] || null, recent: recent.slice(0, 3), closed: recent };
    } catch (e) {
      return { ...sp, active: [], recent: [], error: e.message };
    }
  }));

  const data = { today: todayLocal(), spaces: result };
  _sprintCache.at = Date.now();
  _sprintCache.key = ckey;
  _sprintCache.data = data;
  return data;
}

/* ------------------------------------------------------------------ */
/* Modo em lote                                                        */
/* ------------------------------------------------------------------ */

/** Executa `fn` sobre `items` com no máximo `limit` chamadas simultâneas,
 *  preservando a ordem dos resultados. Evita estourar o rate limit do Jira. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        out[i] = { ok: true, value: await fn(items[i], i) };
      } catch (e) {
        out[i] = { ok: false, error: e?.message || String(e), item: items[i] };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

function progress(payload) {
  // Broadcast para o modal/popup. Ignora "sem receptor" (modal fechado).
  chrome.runtime.sendMessage({ type: "BATCH_PROGRESS", payload }).catch(() => {});
}

/** Remove acentos e caixa para comparar nomes de status entre issues. */
function slug(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Recebe uma lista de chaves (pais e/ou subtarefas) e devolve todas as
 * subtarefas candidatas, já com contexto completo (campos, transições).
 */
/**
 * level = "sub"    → expande cada chave nas subtarefas (padrão)
 * level = "parent" → aplica nas próprias chaves informadas (tarefas pai)
 */
async function resolveBatch({ keys, level = "sub" }) {
  const cfg = await getConfig();
  const me = await jira("/rest/api/3/myself", { cfg });

  const unique = [...new Set((keys || []).map((k) => {
    try { return normalizeKey(k); } catch { return null; }
  }).filter(Boolean))];

  const invalid = (keys || []).filter((k) => {
    try { normalizeKey(k); return false; } catch { return true; }
  });

  const errors = [];
  const wanted = [];

  if (level === "parent") {
    // Sem expansão: as próprias tarefas recebem horas, datas, pontos e status.
    for (const key of unique) wanted.push({ key, parentKey: null, parentSummary: "" });
  } else {
  progress({ phase: "resolve", done: 0, total: unique.length });

  // 1. Expande cada chave nas suas subtarefas
  let doneTrees = 0;
  const trees = await mapLimit(unique, 4, async (key) => {
    const tree = await loadIssueTree(key);
    progress({ phase: "resolve", done: ++doneTrees, total: unique.length, current: key });
    return tree;
  });

  trees.forEach((r, i) => {
    if (!r.ok) return errors.push({ key: unique[i], error: r.error });
    const t = r.value;
    if (!t.subtasks.length) {
      errors.push({ key: t.parent.key, error: "Sem subtarefas." });
      return;
    }
    for (const s of t.subtasks) {
      wanted.push({ key: s.key, parentKey: t.parent.key, parentSummary: t.parent.summary });
    }
  });
  }

  // 2. Carrega o contexto de cada subtarefa (campos editáveis + transições)
  progress({ phase: "context", done: 0, total: wanted.length });
  let doneCtx = 0;
  const ctxs = await mapLimit(wanted, 4, async (w) => {
    const ctx = await loadSubtaskContext(w.key);
    progress({ phase: "context", done: ++doneCtx, total: wanted.length, current: w.key });
    return { ...ctx, parentKey: ctx.parentKey || w.parentKey, parentSummary: w.parentSummary };
  });

  const targets = [];
  ctxs.forEach((r, i) => {
    if (r.ok) targets.push(r.value);
    else errors.push({ key: wanted[i].key, error: r.error });
  });

  // 3. Status disponíveis: nomes que aparecem nas transições, com contagem
  const statusMap = new Map();
  for (const t of targets) {
    const seen = new Set();
    for (const tr of t.transitions) {
      const name = tr.to || tr.name;
      const id = slug(name);
      if (seen.has(id)) continue;
      seen.add(id);
      const entry = statusMap.get(id) || { name, count: 0 };
      entry.count += 1;
      statusMap.set(id, entry);
    }
  }

  return {
    me: { accountId: me.accountId, displayName: me.displayName },
    targets,
    statuses: [...statusMap.values()].sort((a, b) => b.count - a.count),
    errors: [...errors, ...invalid.map((k) => ({ key: k, error: "Chave inválida." }))],
  };
}

/**
 * Aplica os mesmos parâmetros a várias subtarefas.
 * O status é casado POR NOME em cada issue, porque o id da transição
 * muda de workflow para workflow.
 */
async function applyBatch(payload) {
  const { targets = [], statusName = "" } = payload;
  if (!targets.length) throw new Error("Nenhuma subtarefa selecionada.");

  // Validação única antes de escrever qualquer coisa — falha rápido.
  const est = parseDuration(payload.originalEstimate);
  if (!est.ok) throw new Error(`Estimativa original — ${est.error}`);
  const spent = parseDuration(payload.timeSpent);
  if (!spent.ok) throw new Error(`Controle de tempo — ${spent.error}`);

  const cfg = await getConfig();
  validateStoryPoints(payload.storyPoints);

  // Plano ÚNICO para o lote inteiro: as subtarefas entram em sequência na
  // jornada (11:00–11:20, 11:20–11:40…) e nunca se sobrepõem, mesmo rodando
  // em paralelo depois — o horário de cada uma já está decidido aqui.
  const chunksByKey = {};
  if (spent.minutes) {
    const plan = await planWorklogs({
      startDate: payload.startDate,
      startTime: payload.startTime,
      items: targets.map((t) => ({ key: t.key, minutes: spent.minutes })),
      force: true,
    });
    if (plan.unplaced) {
      throw new Error(plan.workday.overflow === "sameDay"
        ? `O lote não cabe no dia: ${fmtDur(plan.unplaced)} passariam da meia-noite. Reduza o tempo por subtarefa ou a quantidade selecionada.`
        : `O lote não cabe na jornada: faltam ${fmtDur(plan.unplaced)} de espaço nos próximos 30 dias. ` +
          `Reduza o tempo por subtarefa ou a quantidade selecionada.`);
    }
    for (const it of plan.items) chunksByKey[it.key] = it.chunks;
  }

  progress({ phase: "apply", done: 0, total: targets.length });
  let done = 0;

  const results = await mapLimit(targets, 3, async (t) => {
    let transitionId = null;
    let transitionName = "";
    let finalize = false;
    if (statusName) {
      const match = (t.transitions || []).find(
        (tr) => slug(tr.to) === slug(statusName) || slug(tr.name) === slug(statusName)
      );
      if (match) {
        transitionId = match.id;
        transitionName = match.to || match.name;
        finalize = match.toCategory === "done";
      }
    }

    const res = await applyToSubtask({
      key: t.key,
      dueDate: payload.dueDate,
      startDate: payload.startDate,
      startFieldId: t.startField?.id || null,
      startFieldType: t.startField?.type || "date",
      startTime: payload.startTime,
      currentStartDate: t.currentStartDate || null,
      storyPoints: payload.storyPoints,
      storyFieldId: t.storyField?.id || null,
      originalEstimate: resolveEstimate(payload, cfg, t.currentEstimate),
      currentEstimate: t.currentEstimate || null,
      currentSpent: t.currentSpent || null,
      timeSpent: payload.timeSpent,
      worklogChunks: chunksByKey[t.key] || [],
      finalize,
      worklogComment: payload.worklogComment,
      transitionId,
      transitionName,
    });

    if (statusName && !transitionId) {
      res.ok = false;
      res.steps.push({
        step: "Status",
        ok: false,
        detail: `"${statusName}" não é uma transição válida a partir de "${t.status}".`,
      });
    }

    progress({ phase: "apply", done: ++done, total: targets.length, current: t.key, ok: res.ok });
    return { ...res, summary: t.summary };
  });

  const flat = results.map((r, i) =>
    r.ok
      ? r.value
      : { key: targets[i].key, summary: targets[i].summary, ok: false, steps: [{ step: "Falha geral", ok: false, detail: r.error }] }
  );

  clearBusyCache();
  return {
    total: flat.length,
    succeeded: flat.filter((r) => r.ok).length,
    results: flat,
  };
}

async function testConnection() {
  const cfg = await getConfig();
  const me = await jira("/rest/api/3/myself", { cfg });
  return { displayName: me.displayName, email: me.emailAddress, accountId: me.accountId };
}

/* ------------------------------------------------------------------ */
/* Roteamento de mensagens                                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Status, colunas dos quadros e histórico (usados pelo QuickFill DEV)  */
/* ------------------------------------------------------------------ */

let _statusMeta = null;

const QA_RX = /valida|homolog|teste|\bqa\b|review|revis/i;
const DEPLOY_RX = /deploy|produ[cç]|publica|release|libera/i;
const PRD_RX = /\bprd\b|produ[cç][aã]o|production/i;
const FEITO_RX = /\bfeito\b|\bpronto\b|\bdone\b|dev ok|\bpr\b|pull request/i;   // MEED: PR (pull request) = Feito do SUS
const REOPEN_RX = /reab|reopen/i;
const VALIDATED_RX = /\bvalidad|\baprovad|homologad|\bverified/i;
const BLOCKED_RX = /impedi|bloquead|blocked|aguardando|\bparad|on hold|em espera|waiting/i;

/**
 * Regras de coluna → etapa. Cada lista das Opções (ex.: "Feito, Dev OK") substitui o padrão;
 * vazia, vale o padrão acima. A comparação ignora acento e caixa.
 */
function stageRules(cfg = {}) {
  return {
    deploy: termsRx(cfg.stageDeploy, DEPLOY_RX),
    prd: termsRx(cfg.stagePrd, PRD_RX),
    reopen: termsRx(cfg.stageReopen, REOPEN_RX),
    qa: termsRx(cfg.stageQa, QA_RX),
    feito: termsRx(cfg.stageFeito, FEITO_RX),
    validated: termsRx(cfg.stageValidated, VALIDATED_RX),
    blocked: termsRx(cfg.stageBlocked, BLOCKED_RX),
  };
}

/** Tipo da coluna/status para o QuickFill DEV. */
function columnKind(name, R = stageRules()) {
  const n = normName(name);
  if (R.prd.test(n)) return "prd";
  if (R.deploy.test(n)) return "deploy";
  if (R.reopen.test(n)) return "reopen";
  if (R.validated.test(n)) return "validated";   // antes de "qa": "Validado" não é fila do QA
  if (R.qa.test(n)) return "qa";
  if (R.feito.test(n)) return "feito";
  if (R.blocked.test(n)) return "blocked";       // depois de deploy/qa: "Aguardando deploy" continua deploy
  return "other";
}
const _spacesCache = { at: 0, data: null };

async function statusMeta(cfg) {
  if (_statusMeta) return _statusMeta;
  const all = await jira("/rest/api/3/status", { cfg });
  _statusMeta = {};
  for (const st of all || []) {
    _statusMeta[String(st.id)] = { name: st.name, cat: st.statusCategory?.key || "indeterminate" };
  }
  return _statusMeta;
}

/** Espaços acompanhados (MEED e SUS) com os status de validação e de deploy de cada um. */
async function qaSpaces(cfg, meta) {
  const sig = [cfg.stageFeito, cfg.stageDeploy, cfg.stagePrd, cfg.stageQa, cfg.stageReopen, cfg.stageValidated, cfg.stageBlocked, cfg.statusColumns, cfg.sustColumns].join("|");
  if (_spacesCache.data && _spacesCache.sig === sig && Date.now() - _spacesCache.at < 10 * 60 * 1000) return _spacesCache.data;
  const data = await qaSpacesLoad(cfg, meta);
  _spacesCache.sig = sig;
  _spacesCache.at = Date.now();
  _spacesCache.data = data;
  return data;
}

async function qaSpacesLoad(cfg, meta) {
  const R = stageRules(cfg);
  const defs = [
    { id: "batch", project: (cfg.defaultProject || "MEED").toUpperCase(), boardId: cfg.batchBoardId, columns: cfg.statusColumns },
    { id: "sustentacao", project: (cfg.sustProject || "SUS").toUpperCase(), boardId: cfg.sustBoardId, columns: cfg.sustColumns },
  ];
  return Promise.all(defs.map(async (sp) => {
    const out = { id: sp.id, project: sp.project, label: sp.project, qaIds: [], deployIds: [], board: null, source: "nomes", kinds: {} };
    const wanted = splitList(sp.columns).map(slug);
    try {
      let boardId = sp.boardId;
      if (!boardId) {
        const page = await jira(`/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(sp.project)}&maxResults=50`, { cfg });
        const boards = page?.values || [];
        const b = boards.find((x) => new RegExp(`\\b${sp.project}\\b`, "i").test(x.name)) || boards[0];
        boardId = b?.id;
      }
      if (boardId) {
        const conf = await getBoardColumns({ boardId: String(boardId) });
        out.board = { id: conf.boardId, name: conf.name };
        for (const c of conf.columns) {
          const kind = columnKind(c.name, R);
          for (const id of c.statusIds) out.kinds[id] = { kind, column: c.name };
          const n = slug(c.name);
          const listed = wanted.some((w) => w === n);
          if (kind === "deploy" || kind === "prd") out.deployIds.push(...c.statusIds);
          else if (kind === "qa" || (listed && !["feito", "validated", "blocked"].includes(kind))) out.qaIds.push(...c.statusIds);
        }
        if (out.qaIds.length || out.deployIds.length) out.source = "quadro";
      }
    } catch { /* sem quadro: cai nos nomes de status */ }
    if (!out.qaIds.length && !out.deployIds.length) {
      for (const [id, st] of Object.entries(meta)) {
        if (st.cat === "done") continue;
        const kind = columnKind(st.name, R);
        if (kind === "deploy" || kind === "prd") out.deployIds.push(id);
        else if (kind === "qa") out.qaIds.push(id);
      }
    }
    // Status sem coluna no quadro: classificados pelo próprio nome
    for (const [id, st] of Object.entries(meta)) {
      if (!out.kinds[id]) out.kinds[id] = { kind: st.cat === "done" ? "done" : columnKind(st.name, R), column: null };
      else if (st.cat === "done" && out.kinds[id].kind === "other") out.kinds[id].kind = "done";
    }
    out.qaIds = [...new Set(out.qaIds)];
    out.deployIds = [...new Set(out.deployIds)];
    return out;
  }));
}

/** Busca com changelog; tenta o endpoint novo e cai para o clássico. */
async function searchWithChangelog(jql, fields, max, cfg) {
  const out = [];
  try {
    let token = null;
    do {
      const page = await jira("/rest/api/3/search/jql", {
        method: "POST", cfg,
        body: { jql, fields, expand: "changelog", maxResults: Math.min(100, max - out.length), ...(token ? { nextPageToken: token } : {}) },
      });
      out.push(...(page?.issues || []));
      token = page?.nextPageToken || null;
    } while (token && out.length < max);
    return out.slice(0, max);
  } catch (e) {
    if (!/40[45]/.test(e.message)) throw e;
  }
  for (let startAt = 0; out.length < max; ) {
    const qs = new URLSearchParams({ jql, startAt: String(startAt), maxResults: "100", fields: fields.join(","), expand: "changelog" });
    const page = await jira(`/rest/api/3/search?${qs}`, { cfg });
    const batch = page?.issues || [];
    out.push(...batch);
    startAt += batch.length;
    if (!batch.length || startAt >= (page?.total ?? 0)) break;
  }
  return out.slice(0, max);
}

async function fullChangelog(key, cfg) {
  const out = [];
  for (let startAt = 0; startAt < 2000; ) {
    const page = await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/changelog?startAt=${startAt}&maxResults=100`, { cfg });
    const vals = page?.values || [];
    out.push(...vals);
    startAt += vals.length;
    if (!vals.length || page?.isLast || startAt >= (page?.total ?? 0)) break;
  }
  return out;
}

const statusTransitions = (histories) => {
  const out = [];
  for (const h of histories || []) {
    for (const it of h.items || []) {
      if (it.field !== "status") continue;
      out.push({
        at: Date.parse(h.created),
        from: String(it.from ?? ""), fromName: it.fromString || "",
        to: String(it.to ?? ""), toName: it.toString || "",
        by: h.author?.accountId || "", byName: h.author?.displayName || "",
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
};

/**
 * Histórico da demanda (botão "Histórico" das listas): todas as mudanças de status com a etapa
 * de cada uma no quadro do espaço, quem fez e os comentários (para explicar as voltas).
 */
async function issueHistory(p = {}) {
  const cfg = await getConfig();
  assertConfigured(cfg);
  const key = normalizeKey(p.key);
  const fields = "summary,issuetype,parent,created,creator,reporter,status,project";
  const [issue, logs, meta, comments] = await Promise.all([
    jira(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}`, { cfg }),
    fullChangelog(key, cfg),
    statusMeta(cfg),
    jira(`/rest/api/3/issue/${encodeURIComponent(key)}/comment?maxResults=100&orderBy=created`, { cfg }).catch(() => null),
  ]);
  const f = issue?.fields || {};
  const project = f.project?.key || key.split("-")[0];
  const spaces = await qaSpaces(cfg, meta).catch(() => []);
  const kinds = spaces.find((s) => s.project === project)?.kinds || {};
  const R = stageRules(cfg);
  const kindOf = (id, name) => kinds[id]?.kind || (meta[id]?.cat === "done" ? "done" : columnKind(name || meta[id]?.name || "", R));
  const stageOfId = (id, name) => stageFrom(kindOf(id, name), meta[id]?.cat);
  const st = f.status || {};
  const who = f.creator || f.reporter;
  return {
    key, url: `${cfg.baseUrl}/browse/${key}`,
    summary: f.summary || "", type: f.issuetype?.name || "", parentKey: f.parent?.key || null,
    created: Date.parse(f.created) || null,
    creator: who ? { id: who.accountId || "", name: who.displayName || "" } : null,
    status: { name: st.name || "", stage: stageOfId(String(st.id || ""), st.name) },
    transitions: statusTransitions(logs).map((t) => ({ ...t,
      fromKind: kindOf(t.from, t.fromName), toKind: kindOf(t.to, t.toName),
      fromStage: stageOfId(t.from, t.fromName), toStage: stageOfId(t.to, t.toName) })),
    comments: (comments?.comments || []).map((c) => ({
      at: Date.parse(c.created), by: c.author?.accountId || "", byName: c.author?.displayName || "", text: adfExcerpt(c.body, 220),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* QuickFill DEV — minhas demandas                                     */
/* ------------------------------------------------------------------ */

const _myDemands = { key: "", at: 0, data: null, pending: null };
let _priorities = null;

async function priorityList(cfg) {
  if (_priorities) return _priorities;
  try {
    const list = await jira("/rest/api/3/priority", { cfg });
    _priorities = (list || []).map((p, i) => ({ id: String(p.id), name: p.name, rank: i, color: p.statusColor || null }));
  } catch { _priorities = []; }
  return _priorities;
}

async function myDemands(p = {}) {
  const cfg = await getConfig();
  const days = Math.max(1, Math.min(60, Number(p.days) || 30));
  const today = todayLocal();
  const from = addDays(today, -(days - 1));
  const key = `${from}`;
  if (!p.force && _myDemands.data && _myDemands.key === key && Date.now() - _myDemands.at < 90 * 1000) return _myDemands.data;
  if (_myDemands.pending && _myDemands.key === key) return _myDemands.pending;
  _myDemands.key = key;
  _myDemands.pending = (async () => {
    const [meta, me, prios] = await Promise.all([statusMeta(cfg), getMyself(cfg), priorityList(cfg)]);
    const spaces = await qaSpaces(cfg, meta);
    const projects = spaces.map((s) => s.project);
    const jql = `project in (${projects.map(jqlString).join(", ")}) AND (assignee = currentUser() OR worklogAuthor = currentUser()`
      + ` OR status CHANGED BY currentUser() AFTER "${from}") AND (statusCategory != Done OR updated >= "${from}") ORDER BY updated DESC`;
    const fields = ["summary", "status", "issuetype", "assignee", "project", "parent", "priority", "created",
      "timeoriginalestimate", "timespent", "worklog"];
    const raw = await searchWithChangelog(jql, fields, 300, cfg);
    const needLog = raw.filter((i) => (i.changelog?.total ?? 0) > (i.changelog?.histories?.length ?? 0));
    const logs = new Map();
    (await mapLimit(needLog, 6, (i) => fullChangelog(i.key, cfg))).forEach((r, idx) => { if (r.ok) logs.set(needLog[idx].key, r.value); });
    const needWl = raw.filter((i) => !inlineWorklogs(i));
    const wls = new Map();
    (await mapLimit(needWl, 6, (i) => issueWorklogs(i.key, from, today, cfg))).forEach((r, idx) => { if (r.ok) wls.set(needWl[idx].key, r.value); });
    const rankOf = new Map(prios.map((x) => [x.id, x.rank]));

    const issues = raw.map((i) => {
      const f = i.fields || {};
      const st = f.status || {};
      const mine = wls.has(i.key)
        ? wls.get(i.key).filter((w) => w.accountId === me.accountId)
        : toCacheLogs(i.key, inlineWorklogs(i) || [], from, today).filter((w) => w.accountId === me.accountId);
      return {
        key: i.key,
        project: f.project?.key || i.key.split("-")[0],
        summary: f.summary || "",
        isSubtask: !!f.issuetype?.subtask,
        type: f.issuetype?.name || "",
        parentKey: f.parent?.key || null,
        status: { id: String(st.id || ""), name: st.name || "", cat: st.statusCategory?.key || "" },
        assignee: f.assignee ? { id: f.assignee.accountId, name: f.assignee.displayName } : null,
        priority: f.priority ? { id: String(f.priority.id), name: f.priority.name, rank: rankOf.get(String(f.priority.id)) ?? 99 } : null,
        estimate: f.timeoriginalestimate ? Math.round(f.timeoriginalestimate / 60) : 0,
        spent: f.timespent ? Math.round(f.timespent / 60) : 0,
        created: Date.parse(f.created) || null,
        transitions: statusTransitions(logs.get(i.key) || i.changelog?.histories),
        myMinutes: mine.reduce((sum, w) => sum + w.minutes, 0),
        myToday: mine.filter((w) => w.date === today).reduce((sum, w) => sum + w.minutes, 0),
        myByDay: mine.reduce((acc, w) => { acc[w.date] = (acc[w.date] || 0) + w.minutes; return acc; }, {}),
      };
    });
    const data = { generatedAt: Date.now(), today, from, days, url: cfg.baseUrl,
      me: { accountId: me.accountId, name: me.displayName },
      spaces: spaces.map((s) => ({ project: s.project, kinds: s.kinds, board: s.board })),
      statuses: meta, priorities: prios, issues, truncated: raw.length >= 300 };
    _myDemands.at = Date.now();
    _myDemands.data = data;
    return data;
  })();
  try { return await _myDemands.pending; } finally { _myDemands.pending = null; }
}

/** Chaves das demandas de uma sprint (inclui encerradas) — para filtrar horas pela sprint. */
const _sprintKeys = new Map();
async function sprintKeys(p = {}) {
  const cfg = await getConfig();
  const id = String(p.sprintId || "");
  if (!id) throw new Error("Sprint inválida.");
  const hit = _sprintKeys.get(id);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.data;
  const keys = [];
  for (let startAt = 0; startAt < 2000; ) {
    const page = await jira(`/rest/agile/1.0/sprint/${encodeURIComponent(id)}/issue?fields=parent&startAt=${startAt}&maxResults=100`, { cfg });
    const list = page?.issues || [];
    for (const i of list) { keys.push(i.key); if (i.fields?.parent?.key) keys.push(i.fields.parent.key); }
    startAt += list.length;
    if (!list.length || startAt >= (page?.total ?? 0)) break;
  }
  const data = { sprintId: id, keys: [...new Set(keys)] };
  _sprintKeys.set(id, { at: Date.now(), data });
  return data;
}

/* ------------------------------------------------------------------ */
/* Campos extras (story points, impedimento, sprint) — uma leitura só  */
/* ------------------------------------------------------------------ */

let _extraFields = null;
async function extraFields(cfg) {
  if (!_extraFields) {
    let fields = [];
    try { fields = await jira("/rest/api/3/field", { cfg }); } catch { fields = []; }
    const find = (...tests) => { for (const t of tests) { const f = (fields || []).find(t); if (f) return f.id; } return null; };
    _extraFields = {
      points: find((x) => /story point estimate/i.test(x.name), (x) => /^story ?points?$|pontos de hist[oó]ria/i.test(x.name)),
      flagged: find((x) => /^flagged$|^sinalizad|^impedi/i.test(x.name)),
      sprint: await sprintFieldId(cfg),
    };
  }
  return { ..._extraFields, points: cfg.storyPointsFieldId || _extraFields.points };
}

const BOARD_FIELDS = ["summary", "status", "issuetype", "assignee", "project", "parent", "priority", "created", "updated",
  "duedate", "statuscategorychangedate", "labels", "timeoriginalestimate", "timespent"];

/** Issue no formato enxuto usado pelos painéis SCRUM e DESIGN. */
/** Texto puro de um documento ADF (descrição do Jira), resumido em `max` caracteres. */
function adfExcerpt(doc, max = 280) {
  if (!doc) return "";
  if (typeof doc === "string") return doc.replace(/\s+/g, " ").trim().slice(0, max);
  const out = [];
  const walk = (n) => {
    if (!n || out.join(" ").length > max * 2) return;
    if (n.type === "text" && n.text) out.push(n.text);
    else if (n.type === "mention") out.push(n.attrs?.text || "");
    else if (n.type === "inlineCard" || n.type === "blockCard") out.push(n.attrs?.url || "");
    for (const c of n.content || []) walk(c);
    if (["paragraph", "heading", "listItem", "codeBlock"].includes(n.type)) out.push(" · ");
  };
  walk(doc);
  const txt = out.join(" ").replace(/\s+/g, " ").replace(/\s*·\s*(·\s*)*/g, " · ").replace(/^\s*·\s*|\s*·\s*$/g, "").trim();
  return txt.length > max ? `${txt.slice(0, max).replace(/\s+\S*$/, "")}…` : txt;
}

function boardIssue(i, { fx, rankOf, kinds = {}, logs, meta = {} }) {
  const f = i.fields || {};
  const st = f.status || {};
  const flag = fx.flagged ? f[fx.flagged] : null;
  return {
    key: i.key,
    project: f.project?.key || i.key.split("-")[0],
    summary: f.summary || "",
    type: f.issuetype?.name || "",
    isSubtask: !!f.issuetype?.subtask,
    parentKey: f.parent?.key || null,
    parentSummary: f.parent?.fields?.summary || "",
    status: { id: String(st.id || ""), name: st.name || "", cat: st.statusCategory?.key || "" },
    kind: kinds[String(st.id)]?.kind || null,
    column: kinds[String(st.id)]?.column || null,
    assignee: f.assignee ? { id: f.assignee.accountId, name: f.assignee.displayName } : null,
    priority: f.priority ? { id: String(f.priority.id), name: f.priority.name, rank: rankOf.get(String(f.priority.id)) ?? 99 } : null,
    points: fx.points ? Number(f[fx.points]) || 0 : 0,
    flagged: Array.isArray(flag) ? flag.length > 0 : !!flag,
    due: f.duedate || null,
    created: Date.parse(f.created) || null,
    updated: Date.parse(f.updated) || null,
    catChanged: Date.parse(f.statuscategorychangedate) || null,
    labels: f.labels || [],
    estimate: f.timeoriginalestimate ? Math.round(f.timeoriginalestimate / 60) : 0,
    spent: f.timespent ? Math.round(f.timespent / 60) : 0,
    sprints: fx.sprint ? (f[fx.sprint] || []).map((s) => ({ id: s.id, name: s.name, state: s.state })) : [],
    desc: f.description ? adfExcerpt(f.description) : "",
    transitions: statusTransitions(logs?.get(i.key) || i.changelog?.histories).map((t) => ({ ...t,
      fromKind: kinds[t.from]?.kind || null, toKind: kinds[t.to]?.kind || null,
      fromStage: stageFrom(kinds[t.from]?.kind, meta[t.from]?.cat), toStage: stageFrom(kinds[t.to]?.kind, meta[t.to]?.cat) })),
  };
}

/** Changelog completo só para quem veio cortado na busca (no máximo `limit` issues). */
async function completeLogs(raw, cfg, limit = 40) {
  const need = raw.filter((i) => (i.changelog?.total ?? 0) > (i.changelog?.histories?.length ?? 0)).slice(0, limit);
  const logs = new Map();
  (await mapLimit(need, 6, (i) => fullChangelog(i.key, cfg))).forEach((r, idx) => { if (r.ok) logs.set(need[idx].key, r.value); });
  return logs;
}

/* ------------------------------------------------------------------ */
/* QuickFill SCRUM — sprint, pessoas e riscos                          */
/* ------------------------------------------------------------------ */

const _scrum = { at: 0, data: null, pending: null };
const _scrumPast = new Map();   // id da sprint encerrada -> { at, data }: não muda mais, guarda por 10 min
/** Lista de pessoas salva nas Opções (JSON). `byName`: aceita entradas só com o nome. */
const parseDeployers = (raw, byName = false) => { try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v.filter((x) => x?.accountId || (byName && x?.name)) : []; } catch { return []; } };
const _velocity = new Map();   // sprintId -> { at, data } (sprints encerradas quase não mudam)

async function closedSprintStats(sprint, fx, cfg) {
  const hit = _velocity.get(sprint.id);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.data;
  const raw = await runJql(`sprint = ${Number(sprint.id)}`, ["status", ...(fx.points ? [fx.points] : [])], 500, cfg).catch(() => []);
  const isDone = (i) => i.fields?.status?.statusCategory?.key === "done";
  const pts = (i) => (fx.points ? Number(i.fields?.[fx.points]) || 0 : 0);
  const data = {
    id: sprint.id, name: sprint.name, start: sprint.start, end: sprint.end,
    total: raw.length, done: raw.filter(isDone).length,
    points: raw.reduce((s, i) => s + pts(i), 0), pointsDone: raw.filter(isDone).reduce((s, i) => s + pts(i), 0),
  };
  _velocity.set(sprint.id, { at: Date.now(), data });
  return data;
}

/**
 * Sprint ativa de cada espaço (padrão) ou, com `p.sprint`, uma sprint anterior: os mesmos dados
 * (itens, subtarefas, histórico), só que da sprint encerrada escolhida. Os outros espaços vêm vazios.
 */
async function scrumSprint(p = {}) {
  const pastId = p.sprint ? String(p.sprint) : "";
  if (pastId) {
    const hit = _scrumPast.get(pastId);
    if (!p.force && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
    const data = await scrumSprintLoad({ ...p, sprint: pastId });
    _scrumPast.set(pastId, { at: Date.now(), data });
    return data;
  }
  if (!p.force && _scrum.data && Date.now() - _scrum.at < 60 * 1000) return _scrum.data;
  if (_scrum.pending) return _scrum.pending;
  _scrum.pending = scrumSprintLoad(p);
  try {
    const data = await _scrum.pending;
    _scrum.at = Date.now();
    _scrum.data = data;
    return data;
  } finally { _scrum.pending = null; }
}

async function scrumSprintLoad(p = {}) {
  const pastId = p.sprint ? String(p.sprint) : "";
  return (async () => {
    const cfg = await getConfig();
    const [info, meta, prios, fx, me] = await Promise.all([
      sprintInfo({ force: p.force }), statusMeta(cfg), priorityList(cfg), extraFields(cfg), getMyself(cfg)]);
    const qa = await qaSpaces(cfg, meta);
    const rankOf = new Map(prios.map((x) => [x.id, x.rank]));
    const fields = [...BOARD_FIELDS, "description", ...[fx.points, fx.flagged].filter(Boolean)];

    const spaces = await Promise.all(info.spaces.map(async (sp) => {
      const kinds = qa.find((s) => s.project === sp.project)?.kinds || {};
      try {
        const chosen = pastId ? (sp.closed || []).filter((x) => String(x.id) === pastId) : (sp.active || []);
        const sprints = await Promise.all(chosen.map(async (a) => {
          const raw = await searchWithChangelog(`sprint = ${Number(a.id)} ORDER BY rank ASC`, fields, 400, cfg);
          const have = new Set(raw.map((i) => i.key));
          const parents = raw.filter((i) => !i.fields?.issuetype?.subtask).map((i) => i.key);
          for (let k = 0; k < parents.length; k += 50) {
            const chunk = parents.slice(k, k + 50);
            const subs = await searchWithChangelog(`parent in (${chunk.join(", ")})`, fields, 500, cfg).catch(() => []);
            for (const sub of subs) if (!have.has(sub.key)) { have.add(sub.key); raw.push(sub); }
          }
          const logs = await completeLogs(raw, cfg);
          return {
            id: a.id, name: a.name, goal: a.goal || "", start: a.start, end: a.end, closed: !!pastId,
            issues: raw.map((i) => boardIssue(i, { fx, rankOf, kinds, logs, meta })),
            truncated: raw.length >= 400,
          };
        }));
        const velocity = await Promise.all((sp.recent || []).map((r) => closedSprintStats(r, fx, cfg)));
        return { project: sp.project, label: sp.label, board: sp.board || null, source: sp.source || null,
          error: sp.error || null, next: sp.next || null, sprints, velocity, closed: sp.closed || [] };
      } catch (e) {
        return { project: sp.project, label: sp.label, error: e.message, sprints: [], velocity: [], closed: sp.closed || [] };
      }
    }));

    return {
      generatedAt: Date.now(), today: todayLocal(), url: cfg.baseUrl, past: pastId || null,
      me: { accountId: me.accountId, name: me.displayName },
      fields: { points: !!fx.points, flagged: !!fx.flagged },
      settings: {
        staleDays: Math.max(1, Number(cfg.scrumStaleDays) || 3),
        wipLimit: Math.max(1, Number(cfg.scrumWipLimit) || 2),
        feitoThreshold: Math.max(1, Number(cfg.feitoThreshold) || 3),
        deploySummary: cfg.deploySummary || "Realizando Deploy",
        deployers: parseDeployers(cfg.deployers),
        qaPeople: parseDeployers(cfg.qaPeople, true),
        smPeople: parseDeployers(cfg.smPeople, true),
        designPeople: parseDeployers(cfg.designPeople, true),
        ignorePeople: parseDeployers(cfg.ignorePeople, true),
      },
      priorities: prios, spaces,
    };
  })();
}

/* ------------------------------------------------------------------ */
/* QuickFill DESIGN — HUs de design                                     */
/* ------------------------------------------------------------------ */

const _design = { at: 0, data: null, pending: null };

async function designHus(p = {}) {
  if (!p.force && _design.data && Date.now() - _design.at < 90 * 1000) return _design.data;
  if (_design.pending) return _design.pending;
  _design.pending = (async () => {
    const cfg = await getConfig();
    const days = 60;
    const today = todayLocal();
    const from = addDays(today, -(days - 1));
    const [meta, prios, fx, me] = await Promise.all([statusMeta(cfg), priorityList(cfg), extraFields(cfg), getMyself(cfg)]);
    const qa = await qaSpaces(cfg, meta);
    const own = splitList(cfg.designProjects).map((x) => x.toUpperCase());
    const projects = own.length ? own : qa.map((s) => s.project).filter(Boolean);
    const labels = splitList(cfg.designLabels || "design, ux, ui");
    const who = [`assignee = currentUser()`, `status CHANGED BY currentUser() AFTER "${from}"`];
    if (labels.length) who.push(`labels in (${labels.map(jqlString).join(", ")})`);
    const jql = `project in (${projects.map(jqlString).join(", ")}) AND (${who.join(" OR ")})`
      + ` AND (statusCategory != Done OR updated >= "${from}") ORDER BY updated DESC`;
    const fields = [...BOARD_FIELDS, "description", ...[fx.points, fx.flagged, fx.sprint].filter(Boolean)];
    const raw = await searchWithChangelog(jql, fields, 300, cfg);
    const logs = await completeLogs(raw, cfg);
    const rankOf = new Map(prios.map((x) => [x.id, x.rank]));
    const labelSet = new Set(labels.map((l) => l.toLowerCase()));
    const issues = raw.map((i) => {
      const kinds = qa.find((s) => s.project === (i.fields?.project?.key || i.key.split("-")[0]))?.kinds || {};
      const it = boardIssue(i, { fx, rankOf, kinds, logs, meta });
      const links = [...new Set(JSON.stringify(i.fields?.description || "").match(/https?:\/\/(?:www\.)?figma\.com\/[^\s"\\<>)\]]+/gi) || [])];
      it.figmaLinks = links.slice(0, 3);
      it.hasFigma = links.length > 0;
      it.designLabel = it.labels.some((l) => labelSet.has(String(l).toLowerCase()));
      it.mine = it.assignee?.id === me.accountId;
      return it;
    });
    return {
      generatedAt: Date.now(), today, from, url: cfg.baseUrl,
      me: { accountId: me.accountId, name: me.displayName },
      labels, projects, ownSpace: own.length > 0, weeklyGoal: Math.max(1, Number(cfg.designWeeklyGoal) || 3),
      designRules: { doing: cfg.designDoing, review: cfg.designReview, delivered: cfg.designDelivered },
      figmaUrl: cfg.figmaUrl || "", figmaApi: !!(cfg.figmaToken && figmaFileKey(cfg.figmaUrl)),
      priorities: prios, issues, truncated: raw.length >= 300,
    };
  })();
  try {
    const data = await _design.pending;
    _design.at = Date.now();
    _design.data = data;
    return data;
  } finally { _design.pending = null; }
}

/* ------------------------------------------------------------------ */
/* QuickFill DESIGN — espaço UX (quadro, entregas, demanda)             */
/* ------------------------------------------------------------------ */

const _ux = { at: 0, data: null, pending: null };
const uxProjectOf = (cfg) => String(cfg.uxProject || splitList(cfg.designProjects)[0] || "UX").toUpperCase();
const uxHuProjectOf = (cfg) => String(cfg.uxHuProject || cfg.defaultProject || "MEED").toUpperCase();

async function searchPlain(jql, fields, max, cfg) {
  const out = [];
  let token = null;
  do {
    const page = await jira("/rest/api/3/search/jql", {
      method: "POST", cfg, body: { jql, fields, maxResults: Math.min(100, max - out.length), ...(token ? { nextPageToken: token } : {}) },
    });
    out.push(...(page?.issues || []));
    token = page?.nextPageToken || null;
  } while (token && out.length < max);
  return out;
}

const linkKeys = (links) => (links || []).map((l) => {
  const other = l.outwardIssue || l.inwardIssue;
  return other ? { key: other.key, type: l.outwardIssue ? l.type?.outward : l.type?.inward, status: other.fields?.status?.name || "" } : null;
}).filter(Boolean);

/**
 * Espaço UX: itens do quadro (abertos + feitos nos últimos ~6 meses, com histórico de status),
 * as HUs ligadas a eles e as HUs abertas do projeto do dev (para Demanda e "sem protótipo").
 */
async function uxBoardData(p = {}) {
  if (!p.force && _ux.data && Date.now() - _ux.at < 90 * 1000) return _ux.data;
  if (_ux.pending) return _ux.pending;
  _ux.pending = (async () => {
    const cfg = await getConfig();
    const ux = uxProjectOf(cfg), huProject = uxHuProjectOf(cfg);
    const me = await getMyself(cfg);
    const uxFields = ["summary", "status", "issuetype", "assignee", "priority", "created", "updated", "parent", "issuelinks", "timespent", "labels", "duedate", "description"];
    const raw = await searchWithChangelog(`project = ${jqlString(ux)} AND (statusCategory != Done OR updated >= -190d) ORDER BY updated DESC`, uxFields, 600, cfg);
    const items = raw.map((i) => {
      const f = i.fields || {};
      const tr = statusTransitions(i.changelog?.histories);
      const isDone = f.status?.statusCategory?.key === "done";
      const doneT = [...tr].reverse().find((t) => t.toName === f.status?.name) || [...tr].reverse().find((t) => /feito|conclu|done|entregue|finaliz/i.test(t.toName));
      const waitT = [...tr].reverse().find((t) => /aguard/i.test(t.toName));
      const startT = tr.find((t) => /andamento|progress|fazendo|doing/i.test(t.toName));
      const parent = f.parent;
      return {
        key: i.key, summary: f.summary || "", type: f.issuetype?.name || "",
        status: { name: f.status?.name || "", cat: f.status?.statusCategory?.key || "" },
        assignee: f.assignee ? { id: f.assignee.accountId, name: f.assignee.displayName } : null,
        mine: f.assignee?.accountId === me.accountId,
        priority: f.priority?.name || "",
        created: Date.parse(f.created) || null,
        statusAt: tr.length ? tr[tr.length - 1].at : Date.parse(f.created) || null,
        startedAt: startT?.at || null,
        doneAt: isDone ? (doneT?.at || Date.parse(f.updated) || null) : null,
        doneBy: isDone ? (doneT?.by || null) : null,
        waitBy: waitT && /aguard/i.test(f.status?.name || "") ? { id: waitT.by, name: waitT.byName } : null,
        front: parent?.fields?.summary || "",
        spent: Math.round((f.timespent || 0) / 60),
        due: f.duedate || null,
        links: linkKeys(f.issuelinks).filter((l) => !l.key.startsWith(`${ux}-`)),
        figma: figmaUrlsIn(f.description).length,
      };
    });

    // HUs ligadas aos itens do UX (status atual)
    const linkedKeys = [...new Set(items.flatMap((i) => i.links.map((l) => l.key)))];
    const linked = [];
    for (let k = 0; k < linkedKeys.length; k += 100) {
      const chunk = linkedKeys.slice(k, k + 100);
      const page = await searchPlain(`key in (${chunk.join(",")})`, ["summary", "status", "project", "issuetype", "resolutiondate"], 100, cfg).catch(() => []);
      for (const h of page) linked.push({
        key: h.key, summary: h.fields?.summary || "", project: h.fields?.project?.key || "",
        status: { name: h.fields?.status?.name || "", cat: h.fields?.status?.statusCategory?.key || "" },
        resolvedAt: Date.parse(h.fields?.resolutiondate) || null,
      });
    }

    // HUs abertas do projeto do dev (Demanda e "no dev sem protótipo")
    const husRaw = await searchPlain(
      `project = ${jqlString(huProject)} AND statusCategory != Done AND issuetype not in subTaskIssueTypes() ORDER BY created ASC`,
      ["summary", "status", "issuetype", "labels", "components", "created", "issuelinks"], 800, cfg).catch(() => []);
    const hus = husRaw.filter((h) => !/bug|defeito/i.test(h.fields?.issuetype?.name || "")).map((h) => {
      const links = linkKeys(h.fields?.issuelinks);
      return {
        key: h.key, summary: h.fields?.summary || "", type: h.fields?.issuetype?.name || "",
        status: { name: h.fields?.status?.name || "", cat: h.fields?.status?.statusCategory?.key || "" },
        labels: h.fields?.labels || [], components: (h.fields?.components || []).map((c) => c.name),
        created: Date.parse(h.fields?.created) || null,
        uxLinked: links.some((l) => l.key.startsWith(`${ux}-`)) || items.some((i) => i.links.some((l) => l.key === h.key)),
      };
    });

    return {
      generatedAt: Date.now(), now: Date.now(), today: todayLocal(), url: cfg.baseUrl,
      me: { accountId: me.accountId, name: me.displayName },
      ux, huProject, items, linked, hus,
      goal: Math.max(1, Number(cfg.uxWeeklyGoal) || 8),
      hiddenFronts: splitList(cfg.uxHiddenFronts),
      truncated: raw.length >= 600,
    };
  })();
  try {
    const data = await _ux.pending;
    _ux.at = Date.now();
    _ux.data = data;
    return data;
  } finally { _ux.pending = null; }
}

/** Primeira transição para a categoria pedida (doing evita "Aguardando…"). */
async function transitionTo(key, want, cfg) {
  const page = await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { cfg });
  const list = page?.transitions || [];
  const pick = want === "done"
    ? list.find((t) => t.to?.statusCategory?.key === "done" && /feito|conclu|done/i.test(t.to?.name || "")) || list.find((t) => t.to?.statusCategory?.key === "done")
    : list.find((t) => t.to?.statusCategory?.key === "indeterminate" && !/aguard|aprova/i.test(t.to?.name || ""));
  if (!pick) throw new Error(`${key}: nenhuma transição para ${want === "done" ? "Feito" : "Em andamento"}.`);
  await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { method: "POST", cfg, body: { transition: { id: pick.id } } });
  return pick.to?.name || pick.name;
}

/** Vínculo "a <tipo> b" (ex.: UX-430 clona MEED-482). */
async function linkIssues(a, b, cfg, prefer = /relat|relacion/i) {
  const page = await jira("/rest/api/3/issueLinkType", { cfg });
  const types = page?.issueLinkTypes || [];
  const t = types.find((x) => prefer.test(`${x.name} ${x.inward} ${x.outward}`))
    || types.find((x) => /relat|relacion/i.test(`${x.name} ${x.inward} ${x.outward}`)) || types[0];
  if (!t) throw new Error("Não há tipo de vínculo no Jira.");
  await jira("/rest/api/3/issueLink", { method: "POST", cfg, body: { type: { name: t.name }, outwardIssue: { key: b }, inwardIssue: { key: a } } });
  return t;
}

/** Ações do espaço UX: assumir, mover para Feito, cobrar, ligar a uma HU e clonar HU para o UX. */
async function uxAction(p = {}) {
  const cfg = await getConfig();
  const ux = uxProjectOf(cfg);
  _ux.at = 0;
  if (p.op === "take") {
    const me = await getMyself(cfg);
    const key = normalizeKey(p.key);
    await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/assignee`, { method: "PUT", cfg, body: { accountId: me.accountId } });
    const to = await transitionTo(key, "doing", cfg);
    return { key, message: `${key} atribuída a você e movida para ${to}.` };
  }
  if (p.op === "done") {
    const key = normalizeKey(p.key);
    const to = await transitionTo(key, "done", cfg);
    return { key, message: `${key} movida para ${to}.` };
  }
  if (p.op === "ask") {
    const key = normalizeKey(p.key);
    const text = String(p.text || "Ainda aguardando as informações para seguir. Pode me passar?");
    const content = p.mention?.id
      ? [{ type: "mention", attrs: { id: p.mention.id, text: `@${p.mention.name || ""}` } }, adfText(` ${text}`)]
      : [adfText(text)];
    await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { method: "POST", cfg, body: { body: adfDoc({ type: "paragraph", content }) } });
    return { key, message: `Comentário em ${key}${p.mention?.name ? ` para ${p.mention.name}` : ""}.` };
  }
  if (p.op === "link") {
    const a = normalizeKey(p.ux), b = normalizeKey(p.hu);
    const t = await linkIssues(a, b, cfg);
    return { key: a, message: `${a} ligado a ${b} (${t.outward || t.name}). Agora aparece em Entregas.` };
  }
  if (p.op === "clone") {
    const hu = normalizeKey(p.hu);
    const src = await jira(`/rest/api/3/issue/${encodeURIComponent(hu)}?fields=summary,priority`, { cfg });
    const type = await issueTypeByName(ux, cfg.uxIssueType || "HU", cfg);
    if (!type) throw new Error(`Não encontrei um tipo de issue para criar em ${ux}.`);
    const fields = {
      project: { key: ux }, issuetype: { id: type.id },
      summary: `HU: ${src.fields?.summary || hu}`.slice(0, 250),
      description: adfDoc(adfPara("Protótipo da HU ", adfLink(hu, `${cfg.baseUrl}/browse/${hu}`), "."),
        adfPara(adfText("Criado pelo QuickFill DESIGN (aba Demanda).", [{ type: "em" }]))),
      ...(src.fields?.priority?.id ? { priority: { id: src.fields.priority.id } } : {}),
    };
    let created;
    try { created = await jira("/rest/api/3/issue", { method: "POST", cfg, body: { fields } }); }
    catch (e) {
      if (!/priority/i.test(e.message)) throw e;
      delete fields.priority;
      created = await jira("/rest/api/3/issue", { method: "POST", cfg, body: { fields } });
    }
    let linkNote = "";
    try { await linkIssues(created.key, hu, cfg, /clon/i); } catch (e) { linkNote = ` (vínculo falhou: ${e.message})`; }
    return { key: created.key, url: `${cfg.baseUrl}/browse/${created.key}`, message: `${hu} clonada para o UX como ${created.key}, em Itens pendentes, ligada à HU${linkNote}.` };
  }
  throw new Error("Ação desconhecida.");
}

/* ------------------------------------------------------------------ */
/* Documento ADF (comentários e descrições)                             */
/* ------------------------------------------------------------------ */

const adfText = (text, marks) => ({ type: "text", text: String(text), ...(marks ? { marks } : {}) });
const adfPara = (...parts) => ({ type: "paragraph", content: parts.filter(Boolean).map((p) => (typeof p === "string" ? adfText(p) : p)) });
const adfList = (items) => ({ type: "bulletList", content: items.map((it) => ({ type: "listItem", content: [adfPara(...[].concat(it))] })) });
const adfLink = (text, href) => adfText(text, [{ type: "link", attrs: { href } }]);
const adfBold = (text) => adfText(text, [{ type: "strong" }]);
const adfDoc = (...content) => ({ type: "doc", version: 1, content: content.filter(Boolean) });
/** Texto livre com quebras de linha → parágrafos. */
const adfLines = (text) => String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => adfPara(l));

async function addComment(key, body, cfg) {
  return jira(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { method: "POST", cfg, body: { body } });
}

/* ------------------------------------------------------------------ */
/* SCRUM — ações (atribuir, card de deploy, ajustes)                    */
/* ------------------------------------------------------------------ */

const _assignable = new Map();   // projeto -> { at, data }
async function assignableUsers(p = {}) {
  const cfg = await getConfig();
  const project = String(p.project || "").toUpperCase();
  if (!project) throw new Error("Projeto não informado.");
  const hit = _assignable.get(project);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  const users = await jira(`/rest/api/3/user/assignable/search?project=${encodeURIComponent(project)}&maxResults=200`, { cfg });
  const data = (users || []).filter((u) => u.accountType === "atlassian" && u.active !== false)
    .map((u) => ({ accountId: u.accountId, name: u.displayName })).sort((a, b) => a.name.localeCompare(b.name));
  _assignable.set(project, { at: Date.now(), data });
  return data;
}

async function assignIssue(p = {}) {
  const cfg = await getConfig();
  const key = normalizeKey(p.key);
  if (!p.accountId) throw new Error("Escolha a pessoa.");
  await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/assignee`, { method: "PUT", cfg, body: { accountId: p.accountId } });
  _scrum.at = 0;   // próxima leitura já mostra a atribuição
  return { key, accountId: p.accountId, url: `${cfg.baseUrl}/browse/${key}` };
}

async function saveScrumSettings(p = {}) {
  const clamp = (v, lo, hi, d) => String(Math.min(hi, Math.max(lo, Math.round(Number(v) || d))));
  const data = {};
  if (p.staleDays !== undefined) data.scrumStaleDays = clamp(p.staleDays, 1, 30, 3);
  if (p.wipLimit !== undefined) data.scrumWipLimit = clamp(p.wipLimit, 1, 20, 2);
  if (p.feitoThreshold !== undefined) data.feitoThreshold = clamp(p.feitoThreshold, 1, 50, 3);
  await chrome.storage.sync.set(data);
  if (_scrum.data) Object.assign(_scrum.data.settings, {
    ...(data.scrumStaleDays ? { staleDays: Number(data.scrumStaleDays) } : {}),
    ...(data.scrumWipLimit ? { wipLimit: Number(data.scrumWipLimit) } : {}),
    ...(data.feitoThreshold ? { feitoThreshold: Number(data.feitoThreshold) } : {}),
  });
  return data;
}

/** Tipo de issue do projeto pelo nome (sem acento/caixa); senão o primeiro tipo que não é subtarefa. */
async function issueTypeByName(project, name, cfg) {
  let types = [];
  try {
    const page = await jira(`/rest/api/3/issue/createmeta/${encodeURIComponent(project)}/issuetypes?maxResults=100`, { cfg });
    types = page?.issueTypes || page?.values || [];
  } catch {
    const proj = await jira(`/rest/api/3/project/${encodeURIComponent(project)}`, { cfg });
    types = proj?.issueTypes || [];
  }
  const want = slug(name);
  return types.find((t) => slug(t.name) === want)
    || types.find((t) => !t.subtask && /tarefa|task/i.test(t.name))
    || types.find((t) => !t.subtask);
}

async function relatesLinkType(cfg) {
  try {
    const page = await jira("/rest/api/3/issueLinkType", { cfg });
    const list = page?.issueLinkTypes || [];
    return list.find((t) => /relat|relacion/i.test(`${t.name} ${t.inward} ${t.outward}`)) || list[0] || null;
  } catch { return null; }
}

/**
 * Cria o card "Realizando Deploy" para quem faz o deploy, com os cards que estão em Feito
 * listados na descrição, vinculados ("relacionado a") e, se pedido, na sprint ativa.
 */
/**
 * Reunião/alinhamento marcado na linha do tempo → cria uma Tarefa no Jira atribuída a você
 * e aplica datas, story points, status e o tempo da reunião como apontamento (mesmo fluxo do QA).
 */
async function createMeetingIssue(p = {}) {
  const cfg = await getConfig();
  // Mesmo projeto que o modal mostra ("em MEED"); sem nada nas Opções, o MEED de sempre.
  const project = String(p.project || cfg.defaultProject || "MEED").toUpperCase();
  const summary = String(p.title || "").trim() || "Reunião";
  const minutes = Math.max(0, Math.round((p.end ?? 0) - (p.start ?? 0)));
  const type = await issueTypeByName(project, "Tarefa", cfg);
  if (!type) throw new Error(`Não encontrei um tipo de issue para criar em ${project}.`);
  const me = await getMyself(cfg);
  const description = adfDoc(
    ...adfLines(p.desc),
    adfPara(adfText(`Marcado no QuickFill: ${p.date} das ${fmtHM(p.start)} às ${fmtHM(p.end)}.`, [{ type: "em" }])),
  );
  const fields = { project: { key: project }, issuetype: { id: type.id }, summary, description };
  const steps = [];
  let created;
  try {
    created = await jira("/rest/api/3/issue", { method: "POST", cfg, body: { fields: { ...fields, assignee: { accountId: me.accountId } } } });
    steps.push({ step: `Demanda criada (${type.name}) e atribuída a você`, ok: true });
  } catch (e) {
    if (!/assignee/i.test(e.message)) throw e;
    created = await jira("/rest/api/3/issue", { method: "POST", cfg, body: { fields } });
    steps.push({ step: `Demanda criada (${type.name})`, ok: true });
    try { await jira(`/rest/api/3/issue/${created.key}/assignee`, { method: "PUT", cfg, body: { accountId: me.accountId } }); }
    catch (e2) { steps.push({ step: "Atribuição", ok: false, detail: e2.message }); }
  }

  if (p.categoryId) {
    const cat = await categoryField(cfg);
    if (!cat) steps.push({ step: "Categoria", ok: false, detail: "Campo Categoria não encontrado no Jira." });
    else {
      try {
        await jira(`/rest/api/3/issue/${created.key}`, { method: "PUT", cfg, body: { fields: { [cat.id]: cat.multi ? [{ id: String(p.categoryId) }] : { id: String(p.categoryId) } } } });
        steps.push({ step: "Categoria preenchida", ok: true });
      } catch (e) { steps.push({ step: "Categoria", ok: false, detail: e.message }); }
    }
  }

  const ctx = await loadSubtaskContext(created.key);
  const want = p.status === "done" ? "done" : p.status === "doing" ? "indeterminate" : null;
  const target = want ? ctx.transitions.find((t) => t.toCategory === want) : null;
  if (want && !target) steps.push({ step: "Status", ok: false, detail: "Nenhuma transição disponível para esse status." });
  let res = { steps: [] };
  try {
    res = await applySingle({
      key: created.key,
      startDate: p.startDate || p.date,
      startTime: fmtHM(p.start),
      dueDate: p.dueDate || p.date,
      originalEstimate: "",
      timeSpent: minutes ? `${minutes}m` : "",
      worklogComment: summary,
      storyPoints: p.storyPoints ?? null,
      startFieldId: ctx.startField?.id || null,
      startFieldType: ctx.startField?.type || "date",
      currentStartDate: null, currentEstimate: null, currentSpent: null,
      storyFieldId: ctx.storyField?.id || null,
      transitionId: target?.id || null,
      transitionName: target?.name || "",
      finalize: target?.toCategory === "done",
    });
  } catch (e) { steps.push({ step: "Apontamento e campos", ok: false, detail: e.message }); }
  const all = [...steps, ...(res.steps || [])];
  return { key: created.key, url: `${cfg.baseUrl}/browse/${created.key}`, project, logged: minutes, steps: all, ok: all.every((s) => s.ok !== false) };
}

async function createDeployCard(p = {}) {
  const cfg = await getConfig();
  const project = String(p.project || "").toUpperCase();
  const summary = String(p.summary || cfg.deploySummary || "Realizando Deploy").trim();
  if (!project) throw new Error("Projeto não informado.");
  if (!p.assigneeId) throw new Error("Escolha quem vai realizar o deploy.");
  const keys = (p.keys || []).map(normalizeKey).filter(Boolean);
  const type = await issueTypeByName(project, cfg.deployIssueType || "Tarefa", cfg);
  if (!type) throw new Error(`Não encontrei um tipo de issue para criar em ${project}.`);

  const items = (p.items || []).filter((x) => keys.includes(x.key));
  const description = adfDoc(
    ...adfLines(p.description),
    keys.length ? adfPara(adfBold(`Cards em Feito para o deploy (${keys.length}):`)) : null,
    keys.length ? adfList(keys.map((k) => {
      const it = items.find((x) => x.key === k);
      return [adfLink(k, `${cfg.baseUrl}/browse/${k}`), it?.summary ? ` — ${it.summary}` : ""];
    })) : null,
    adfPara(adfText("Criado pelo QuickFill SCRUM.", [{ type: "em" }])),
  );
  const fields = { project: { key: project }, issuetype: { id: type.id }, summary, description };
  const steps = [];
  let created;
  try {
    created = await jira("/rest/api/3/issue", { method: "POST", cfg, body: { fields: { ...fields, assignee: { accountId: p.assigneeId } } } });
    steps.push({ step: `Card criado (${type.name}) e atribuído`, ok: true });
  } catch (e) {
    if (!/assignee/i.test(e.message)) throw e;
    created = await jira("/rest/api/3/issue", { method: "POST", cfg, body: { fields } });
    try {
      await jira(`/rest/api/3/issue/${created.key}/assignee`, { method: "PUT", cfg, body: { accountId: p.assigneeId } });
      steps.push({ step: `Card criado (${type.name}) e atribuído`, ok: true });
    } catch (e2) { steps.push({ step: "Atribuição", ok: false, detail: e2.message }); }
  }
  if (p.sprintId) {
    try {
      await jira(`/rest/agile/1.0/sprint/${Number(p.sprintId)}/issue`, { method: "POST", cfg, body: { issues: [created.key] } });
      steps.push({ step: "Adicionado à sprint ativa", ok: true });
    } catch (e) { steps.push({ step: "Sprint", ok: false, detail: e.message }); }
  }
  if (p.link && keys.length) {
    const lt = await relatesLinkType(cfg);
    if (!lt) steps.push({ step: "Vínculos", ok: false, detail: "Nenhum tipo de vínculo disponível." });
    else {
      const res = await mapLimit(keys, 3, (k) => jira("/rest/api/3/issueLink", { method: "POST", cfg,
        body: { type: { name: lt.name }, inwardIssue: { key: created.key }, outwardIssue: { key: k } } }));
      const bad = res.filter((r) => !r.ok).length;
      steps.push({ step: `Vinculado a ${keys.length - bad} de ${keys.length} cards`, ok: !bad, detail: bad ? res.find((r) => !r.ok)?.error : "" });
    }
  }
  _scrum.at = 0;
  return { key: created.key, url: `${cfg.baseUrl}/browse/${created.key}`, steps };
}

/* ------------------------------------------------------------------ */
/* QA — fila de validação, evidência de teste e retorno ao DEV          */
/* ------------------------------------------------------------------ */

const _qaQueue = { at: 0, data: null };
async function qaQueue(p = {}) {
  if (!p.force && _qaQueue.data && Date.now() - _qaQueue.at < 60 * 1000) return _qaQueue.data;
  const cfg = await getConfig();
  const [meta, prios, fx, me] = await Promise.all([statusMeta(cfg), priorityList(cfg), extraFields(cfg), getMyself(cfg)]);
  const spaces = await qaSpaces(cfg, meta);
  const ids = [...new Set(spaces.flatMap((s) => s.qaIds))];
  if (!ids.length) throw new Error("Nenhuma coluna de validação encontrada. Confira “Etapas do quadro” nas Opções.");
  const projects = spaces.map((s) => s.project).filter(Boolean);
  const jql = `project in (${projects.map(jqlString).join(", ")}) AND status in (${ids.join(", ")}) AND statusCategory != Done ORDER BY priority DESC, updated ASC`;
  const raw = await searchWithChangelog(jql, [...BOARD_FIELDS, ...[fx.points, fx.sprint].filter(Boolean)], 200, cfg);
  const logs = await completeLogs(raw, cfg, 20);
  const rankOf = new Map(prios.map((x) => [x.id, x.rank]));
  const issues = raw.map((i) => {
    const kinds = spaces.find((s) => s.project === (i.fields?.project?.key || i.key.split("-")[0]))?.kinds || {};
    const it = boardIssue(i, { fx, rankOf, kinds, logs, meta });
    const inQa = [...it.transitions].reverse().find((t) => t.toStage === "qa");
    it.waitingSince = inQa?.at || it.catChanged || it.updated;
    it.sentBy = inQa?.byName || "";
    it.mine = it.assignee?.id === me.accountId;
    return it;
  });
  const data = { generatedAt: Date.now(), today: todayLocal(), url: cfg.baseUrl, issues, truncated: raw.length >= 200 };
  _qaQueue.at = Date.now();
  _qaQueue.data = data;
  return data;
}

/**
 * Evidência de teste: comentário padronizado na demanda. Reprovado também ganha a etiqueta
 * "retorno-<categoria>", que o SCRUM e o DEV usam para mostrar a causa do retrabalho.
 */
async function postEvidence(p = {}) {
  const cfg = await getConfig();
  const key = normalizeKey(p.key);
  const approved = p.result === "approved";
  if (!approved && !String(p.category || "").trim()) throw new Error("Escolha a categoria da reprovação.");
  const head = approved ? "✅ QA — Aprovado" : `❌ QA — Reprovado · ${p.category}`;
  const body = adfDoc(
    adfPara(adfBold(head)),
    p.env ? adfPara(adfBold("Ambiente: "), String(p.env)) : null,
    !approved && p.reason ? adfPara(adfBold("Motivo: "), String(p.reason)) : null,
    p.steps ? adfPara(adfBold(approved ? "Evidência:" : "Como reproduzir:")) : null,
    ...adfLines(p.steps),
    p.link ? adfPara(adfBold("Evidência anexa: "), adfLink(String(p.link), String(p.link))) : null,
    adfPara(adfText("Registrado pelo QuickFill QA.", [{ type: "em" }])),
  );
  const steps = [];
  await addComment(key, body, cfg);
  steps.push({ step: "Comentário de evidência", ok: true });
  if (!approved && p.label !== false) {
    const label = `retorno-${slug(p.category).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    try {
      await jira(`/rest/api/3/issue/${encodeURIComponent(key)}`, { method: "PUT", cfg, body: { update: { labels: [{ add: label }] } } });
      steps.push({ step: `Etiqueta ${label}`, ok: true });
    } catch (e) { steps.push({ step: "Etiqueta de retorno", ok: false, detail: e.message }); }
  }
  return { key, url: `${cfg.baseUrl}/browse/${key}`, steps };
}

/* ------------------------------------------------------------------ */
/* DESIGN — checklist de handoff e Figma                                */
/* ------------------------------------------------------------------ */

const HANDOFF_PROP = "quickfill.handoff";

async function handoffGet(p = {}) {
  const cfg = await getConfig();
  const keys = (p.keys || []).slice(0, 40);
  const res = await mapLimit(keys, 6, async (k) => {
    try { return (await jira(`/rest/api/3/issue/${encodeURIComponent(k)}/properties/${HANDOFF_PROP}`, { cfg, retries: 1 }))?.value || null; }
    catch (e) { if (/404/.test(e.message)) return null; throw e; }
  });
  return Object.fromEntries(keys.map((k, i) => [k, res[i].ok ? res[i].value : null]));
}

/**
 * Salva o checklist como propriedade da issue (todos os QuickFill leem) e, ao publicar,
 * comenta na HU para o dev ver no próprio Jira.
 */
async function handoffSave(p = {}) {
  const cfg = await getConfig();
  const key = normalizeKey(p.key);
  const me = await getMyself(cfg);
  const value = { items: p.items || {}, notes: String(p.notes || ""), by: me.displayName, at: Date.now(), published: !!p.publish };
  await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/properties/${HANDOFF_PROP}`, { method: "PUT", cfg, body: value });
  if (p.publish) {
    const labels = p.labels || {};
    await addComment(key, adfDoc(
      adfPara(adfBold("🎨 Handoff de design concluído")),
      adfList(Object.entries(labels).map(([id, label]) => `${value.items[id] ? "✓" : "✗"} ${label}`)),
      ...adfLines(value.notes),
      p.figma ? adfPara(adfBold("Figma: "), adfLink(p.figma, p.figma)) : null,
      adfPara(adfText(`Registrado por ${me.displayName} pelo QuickFill DESIGN.`, [{ type: "em" }])),
    ), cfg);
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Reuniões reconhecidas nas demandas do Jira (só leitura)             */
/* ------------------------------------------------------------------ */

/**
 * Demandas que foram reuniões ou execução (Planning, alinhamentos, deploy, testes…) reconhecidas pela
 * Categoria do Jira e, sem categoria, pelo título ou,
 * sem pista no título, pela descrição (lib/meeting-detect.js). Nada é gravado no Jira.
 */
/** Campo "Categoria" das demandas (customfield), achado pelo nome. null se o Jira não tiver. */
let _catField;
async function categoryField(cfg) {
  if (_catField !== undefined) return _catField;
  try {
    const fields = await jira("/rest/api/3/field", { cfg });
    const n = (x) => slug(x.name);
    const f = (fields || []).find((x) => x.custom && ["categoria", "category", "categoria da demanda"].includes(n(x)))
      || (fields || []).find((x) => x.custom && /^categoria/.test(n(x)));
    _catField = f ? { id: f.id, name: f.name, multi: f.schema?.type === "array" } : null;
  } catch { _catField = null; }
  return _catField;
}

/** Opções do campo Categoria na Tarefa do projeto (para o modal de marcar), cada uma com o tipo que representa. */
async function meetingCategoryOptions(p = {}) {
  const cfg = await getConfig();
  const project = String(p.project || cfg.defaultProject || "MEED").toUpperCase();
  const cat = await categoryField(cfg);
  if (!cat || !project) return { fieldId: null, options: [] };
  const type = await issueTypeByName(project, "Tarefa", cfg);
  let meta = [];
  try {
    for (let startAt = 0; ; ) {
      const page = await jira(`/rest/api/3/issue/createmeta/${encodeURIComponent(project)}/issuetypes/${type.id}?maxResults=200&startAt=${startAt}`, { cfg });
      const list = page?.fields || page?.values || [];
      meta = meta.concat(list);
      startAt += list.length;
      if (!list.length || startAt >= (page?.total ?? 0)) break;
    }
  } catch { meta = []; }
  const f = meta.find((x) => (x.fieldId || x.key) === cat.id);
  if (!f) return { fieldId: null, options: [] };
  return {
    fieldId: cat.id, name: cat.name, required: !!f.required,
    options: (f.allowedValues || []).filter((o) => !o.disabled).map((o) => ({ id: String(o.id), value: o.value ?? o.name ?? "", type: meetingTypeOf(o.value ?? o.name)?.type || null })),
  };
}

const _mtgClass = new Map();   // key -> { at, res }
const MTG_CLASS_TTL = 10 * 60 * 1000;

async function meetingClassify(p = {}) {
  const cfg = await getConfig();
  const keys = [...new Set((p.keys || []).map(String))].slice(0, 600);
  const fresh = (k) => { const c = _mtgClass.get(k); return c && Date.now() - c.at < MTG_CLASS_TTL; };
  const missing = keys.filter((k) => !fresh(k));
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const cat = await categoryField(cfg);
    const issues = await runJql(`key in (${chunk.join(", ")})`, ["summary", "description", ...(cat ? [cat.id] : [])], chunk.length, cfg);
    const found = new Set();
    for (const it of issues) {
      found.add(it.key);
      const r = classifyIssue({ summary: it.fields?.summary, description: it.fields?.description, category: cat ? it.fields?.[cat.id] : null });
      _mtgClass.set(it.key, { at: Date.now(), res: r ? { ...r, summary: it.fields?.summary || "" } : null });
    }
    for (const k of chunk) if (!found.has(k)) _mtgClass.set(k, { at: Date.now(), res: null });
  }
  const out = {};
  for (const k of keys) { const r = _mtgClass.get(k)?.res; if (r) out[k] = r; }
  return out;
}

const _personMtg = new Map();   // "conta|de|até" -> { at, data }

/**
 * Apontamentos de uma pessoa (você, se não vier accountId) em demandas que foram reuniões, no
 * período: alimenta o histórico das Opções e o histórico de cada pessoa na aba Equipe › Reuniões.
 */
async function myMeetings(p = {}) {
  const cfg = await getConfig();
  const me = await getMyself(cfg);
  const who = String(p.accountId || me.accountId);
  const to = p.to || todayLocal();
  const from = p.from || addDays(to, -29);
  const ck = `${who}|${from}|${to}`;
  const hit = _personMtg.get(ck);
  if (!p.force && hit && Date.now() - hit.at < 2 * 60 * 1000) return hit.data;
  const author = who === me.accountId ? "currentUser()" : jqlString(who);
  const cat = await categoryField(cfg);
  const issues = await runJql(`worklogAuthor = ${author} AND worklogDate >= "${from}" AND worklogDate <= "${to}"`,
    ["summary", "description", "status", "worklog", ...(cat ? [cat.id] : [])], 500, cfg);
  const items = [];
  const matched = issues.map((it) => ({ it, r: classifyIssue({ summary: it.fields?.summary, description: it.fields?.description, category: cat ? it.fields?.[cat.id] : null }) })).filter((x) => x.r);
  const res = await mapLimit(matched, 6, async ({ it }) => {
    const raw = inlineWorklogs(it);
    return raw ? toCacheLogs(it.key, raw, from, to) : issueWorklogs(it.key, from, to, cfg);
  });
  matched.forEach(({ it, r }, i) => {
    if (!res[i].ok) return;
    for (const w of res[i].value) {
      if (w.accountId !== who) continue;
      items.push({ id: `j${w.id}`, type: r.type, by: r.by, title: it.fields?.summary || it.key, date: w.date, start: w.start,
        end: Math.min(24 * 60, w.start + w.minutes), jiraKey: it.key, jiraUrl: `${cfg.baseUrl}/browse/${it.key}`,
        status: it.fields?.status?.name || "", category: r.category || (cat ? categoryText(it.fields?.[cat.id]) : ""), fromJira: true });
    }
  });
  const data = { from, to, accountId: who, items, truncated: issues.length >= 500 };
  _personMtg.set(ck, { at: Date.now(), data });
  return data;
}

/** Chave do arquivo a partir do link do Figma (file/design/proto/board). */
const figmaFileKey = (url) => String(url || "").match(/figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/)?.[1] || null;
const _figma = { key: "", at: 0, data: null };

/** Telas (frames do 1º nível de cada página) do arquivo do Figma — precisa do token pessoal. */
/* ---------- Figma nas demandas (modal "Visualizar" e "Protótipo") ---------- */

const FIGMA_URL_RX = /https?:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|board)\/[^\s"\\<>)\]]+/gi;
const figmaUrlsIn = (obj) => [...new Set(JSON.stringify(obj || "").match(FIGMA_URL_RX) || [])].map((u) => u.replace(/&amp;/g, "&").replace(/[.,;]+$/, ""));

/** Nome amigável do link: o node-name da URL, o título do arquivo ou o tipo. */
function figmaLabel(url) {
  const m = url.match(/figma\.com\/(file|design|proto|board)\/[^/]+\/([^?#]+)/);
  const name = m ? decodeURIComponent(m[2]).replace(/-/g, " ") : "Figma";
  return { kind: m?.[1] === "proto" ? "proto" : "design", name };
}

/* Painel "Designs" da demanda (Figma for Jira): vem do GraphQL do Jira, campo experimental
 * JiraIssue.designs (ExternalDesign/DevOpsDesign). Precisa do cloudId do site no X-Query-Context. */
const _cloud = { base: "", id: null };
async function cloudIdOf(cfg) {
  if (_cloud.base === cfg.baseUrl && _cloud.id) return _cloud.id;
  const info = await fetch(`${cfg.baseUrl}/_edge/tenant_info`).then((r) => r.json()).catch(() => null);
  _cloud.base = cfg.baseUrl; _cloud.id = info?.cloudId || null;
  return _cloud.id;
}

const DESIGNS_GQL = `query QuickFillDesigns($key: String!, $cloudId: ID!) {
  jira { issueByKey(key: $key, cloudId: $cloudId) { key
    designs(first: 20) @optIn(to: "GraphStoreIssueAssociatedDesign") { edges { node { __typename
      ... on DevOpsDesign { displayName url liveEmbedUrl status }
      ... on ExternalDesign { extName: displayName extUrl: url extEmbed: liveEmbedUrl extStatus: status }
    } } }
  } }
}`;

const mapDesigns = (conn) => (conn.edges || []).map((e) => {
  const n = e.node || {};
  return { name: n.displayName || n.extName || "", url: n.url || n.extUrl || "", embed: n.liveEmbedUrl || n.extEmbed || "", status: n.status || n.extStatus || "" };
}).filter((d) => d.url);

/** Roda a consulta do painel Designs dentro de uma aba do Jira já aberta (mesma origem e sessão). */
async function designsInJiraTab(cfg, body, headers) {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: `${cfg.baseUrl.replace(/\/+$/, "")}/*` }); } catch { /* sem permissão */ }
  const tab = tabs.find((t) => t.status === "complete" && !t.discarded) || tabs[0];
  if (!tab) return { err: "nenhuma aba do Jira aberta" };
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      args: [body, headers],
      func: async (b, h) => {
        try {
          const r = await fetch("/gateway/api/graphql", { method: "POST", headers: h, body: b, credentials: "same-origin" });
          const j = await r.json().catch(() => null);
          return { status: r.status, conn: j?.data?.jira?.issueByKey?.designs || null, msg: j?.errors?.[0]?.message || "" };
        } catch (e) { return { status: 0, conn: null, msg: String(e?.message || e) }; }
      },
    });
    const out = res?.result || {};
    return out.conn ? { conn: out.conn } : { err: `${out.status || "?"}${out.msg ? ` ${out.msg.slice(0, 100)}` : ""}` };
  } catch (e) { return { err: e.message }; }
}

/** Último motivo de falha do painel Designs (vai para o modal quando não acha nada). */
let _designsErr = "";

async function issueDesigns(key, cfg) {
  const cloudId = await cloudIdOf(cfg);
  if (!cloudId) { _designsErr = "não achei o cloudId do site"; return []; }
  const body = JSON.stringify({ query: DESIGNS_GQL, variables: { key, cloudId }, operationName: "QuickFillDesigns" });
  const base = { Accept: "application/json", "Content-Type": "application/json", "X-Query-Context": `ari:cloud:jira::site/${cloudId}` };
  const errs = [];
  // 1º dentro de uma aba do Jira aberta neste Chrome: é a mesma chamada que o painel faz (mesma origem,
  // sessão logada). O campo é experimental e recusa token de API e chamadas vindas da extensão.
  const viaTab = await designsInJiraTab(cfg, body, base);
  if (viaTab.conn) { _designsErr = ""; return mapDesigns(viaTab.conn); }
  errs.push(`aba do Jira: ${viaTab.err}`);
  const tries = [
    { headers: { ...base, Authorization: "Basic " + btoa(`${cfg.email}:${cfg.apiToken}`) }, credentials: "omit", label: "token" },
  ];
  for (const t of tries) {
    try {
      const res = await fetch(`${cfg.baseUrl}/gateway/api/graphql`, { method: "POST", headers: t.headers, credentials: t.credentials, body });
      const json = await res.json().catch(() => null);
      const conn = json?.data?.jira?.issueByKey?.designs;
      if (res.ok && conn) { _designsErr = ""; return mapDesigns(conn); }
      errs.push(`${t.label}: ${res.status}${json?.errors?.[0]?.message ? ` ${json.errors[0].message.slice(0, 120)}` : ""}`);
    } catch (e) { errs.push(`${t.label}: ${e.message}`); }
  }
  _designsErr = errs.join(" · ");
  return [];
}

const DESIGN_STATUS = { READY_FOR_DEVELOPMENT: "Pronto para desenvolvimento", NONE: "", UNKNOWN: "" };

/**
 * Links do Figma das demandas. Procura, em ordem, em cada chave pedida (o item do UX e as HUs ligadas):
 * painel Designs (Figma for Jira), links remotos, descrição e comentários. Se não achar nada,
 * segue um nível pelas ligações da demanda (vínculos e tarefa pai) e procura nelas também.
 */
async function figmaLinks(p = {}) {
  const cfg = await getConfig();
  const keys = [...new Set((p.keys || []).map(normalizeKey).filter(Boolean))].slice(0, 8);
  const out = [];
  const seen = new Set();
  const searched = new Set();
  const add = (url, from, where, title, extra = {}) => {
    const clean = String(url).replace(/&amp;/g, "&").split("#")[0];
    if (seen.has(clean)) return;
    seen.add(clean);
    out.push({ url: clean, from, where, title: title || figmaLabel(clean).name, kind: figmaLabel(clean).kind, ...extra });
  };
  const isFigma = (u) => /figma\.com\/(file|design|proto|board)\//i.test(String(u || ""));

  /** Procura numa demanda; devolve as chaves ligadas a ela (para o segundo nível). */
  async function scan(key) {
    if (searched.has(key)) return [];
    searched.add(key);
    const enc = encodeURIComponent(key);
    const [issue, remote, props] = await Promise.all([
      jira(`/rest/api/3/issue/${enc}?fields=description,summary,comment,issuelinks,parent`, { cfg }).catch(() => null),
      jira(`/rest/api/3/issue/${enc}/remotelink`, { cfg }).catch(() => []),
      jira(`/rest/api/3/issue/${enc}/properties`, { cfg }).catch(() => null),
    ]);
    // Painel "Designs" (Figma for Jira)
    for (const d of await issueDesigns(key, cfg).catch(() => [])) {
      add(d.url, key, "painel Designs", d.name, { status: DESIGN_STATUS[d.status] ?? d.status.toLowerCase().replace(/_/g, " ") });
    }
    for (const prop of (props?.keys || []).filter((k) => /figma|design/i.test(k.key)).slice(0, 4)) {
      const val = await jira(`/rest/api/3/issue/${enc}/properties/${encodeURIComponent(prop.key)}`, { cfg }).catch(() => null);
      for (const url of figmaUrlsIn(val?.value)) add(url, key, "painel Designs");
    }
    for (const r of remote || []) if (isFigma(r.object?.url)) add(r.object.url, key, "link remoto", r.object?.title);
    for (const url of figmaUrlsIn(issue?.fields?.description)) add(url, key, "descrição");
    for (const c of issue?.fields?.comment?.comments || []) {
      for (const url of figmaUrlsIn(c.body)) add(url, key, `comentário de ${c.author?.displayName || "alguém"}`);
    }
    const f = issue?.fields || {};
    return [
      ...(f.issuelinks || []).map((l) => (l.outwardIssue || l.inwardIssue)?.key),
      f.parent?.key,
    ].filter(Boolean);
  }

  const next = (await Promise.all(keys.map(scan))).flat();
  if (!out.length) {
    const linked = [...new Set(next)].filter((k) => !searched.has(k)).slice(0, 10);
    await Promise.all(linked.map(scan));
  }
  const order = new Map(keys.map((k, i) => [k, i]));
  const whereRank = (w) => (w === "painel Designs" ? 0 : w === "link remoto" ? 1 : w === "descrição" ? 2 : 3);
  out.sort((a, b) => (order.get(a.from) ?? 9) - (order.get(b.from) ?? 9) || whereRank(a.where) - whereRank(b.where) || (a.kind === "design" ? -1 : 1));
  return { links: out, searched: [...searched], designsError: out.length ? "" : _designsErr, figmaApi: !!cfg.figmaToken, figmaUrl: cfg.figmaUrl || "" };
}

const figmaNodeOf = (url) => {
  const m = String(url).match(/[?&]node-id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]).replace(/-/g, ":") : null;
};

async function figmaGet(path, token) {
  const res = await fetch(`https://api.figma.com/v1/${path}`, { headers: { "X-Figma-Token": token } });
  if (!res.ok) throw new Error(`Figma respondeu ${res.status}${res.status === 403 ? " — o token não tem acesso a este arquivo" : res.status === 404 ? " — arquivo ou tela não encontrado" : ""}.`);
  return res.json();
}

const FRAME_TYPES = ["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "GROUP"];
const _figmaPrev = new Map();

/**
 * Imagens das telas de um link do Figma (API com o token das Opções): a tela do node-id,
 * ou as telas de dentro de uma seção/página, ou as da primeira página do arquivo (até 12).
 */
async function figmaPreview(p = {}) {
  const cfg = await getConfig();
  const url = String(p.url || "");
  const fileKey = figmaFileKey(url);
  if (!fileKey) throw new Error("Link do Figma inválido.");
  if (!cfg.figmaToken) return { fileKey, frames: [], needToken: true };
  const cacheKey = `${fileKey}|${figmaNodeOf(url) || ""}`;
  const hit = _figmaPrev.get(cacheKey);
  if (hit && Date.now() - hit.at < 20 * 60 * 1000) return hit.data;

  const node = figmaNodeOf(url);
  let fileName = "", frames = [];
  if (node) {
    const json = await figmaGet(`files/${fileKey}/nodes?ids=${encodeURIComponent(node)}&depth=2`, cfg.figmaToken);
    fileName = json.name || "";
    const doc = json.nodes?.[node]?.document;
    if (!doc) throw new Error("Tela não encontrada no arquivo (o node-id do link mudou?).");
    frames = ["CANVAS", "SECTION"].includes(doc.type)
      ? (doc.children || []).filter((c) => FRAME_TYPES.includes(c.type) || c.type === "SECTION").map((c) => ({ id: c.id, name: c.name }))
      : [{ id: doc.id, name: doc.name }];
  } else {
    const json = await figmaGet(`files/${fileKey}?depth=2`, cfg.figmaToken);
    fileName = json.name || "";
    const page = (json.document?.children || [])[0];
    frames = (page?.children || []).filter((c) => FRAME_TYPES.includes(c.type) || c.type === "SECTION").map((c) => ({ id: c.id, name: c.name }));
  }
  frames = frames.slice(0, 12);
  if (frames.length) {
    const imgs = await figmaGet(`images/${fileKey}?ids=${encodeURIComponent(frames.map((f) => f.id).join(","))}&format=png&scale=${frames.length > 1 ? 1 : 2}`, cfg.figmaToken);
    frames = frames.map((f) => ({ ...f, img: imgs.images?.[f.id] || null }));
  }
  const data = { fileKey, fileName, frames, needToken: false };
  _figmaPrev.set(cacheKey, { at: Date.now(), data });
  return data;
}

async function figmaFrames(p = {}) {
  const cfg = await getConfig();
  const fileKey = figmaFileKey(cfg.figmaUrl);
  if (!fileKey) return { fileKey: null, frames: [], error: "Link do Figma do projeto não configurado nas Opções." };
  if (!cfg.figmaToken) return { fileKey, frames: [], error: null };
  if (!p.force && _figma.key === fileKey && Date.now() - _figma.at < 10 * 60 * 1000) return _figma.data;
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=2`, { headers: { "X-Figma-Token": cfg.figmaToken } });
  if (!res.ok) return { fileKey, frames: [], error: `Figma respondeu ${res.status}${res.status === 403 ? " — confira o token" : ""}.` };
  const json = await res.json();
  const frames = [];
  for (const page of json.document?.children || []) {
    for (const f of page.children || []) {
      if (["FRAME", "SECTION", "COMPONENT", "COMPONENT_SET"].includes(f.type)) frames.push({ id: f.id, name: f.name, page: page.name });
    }
  }
  const data = { fileKey, name: json.name || "", frames, error: null };
  _figma.key = fileKey; _figma.at = Date.now(); _figma.data = data;
  return data;
}

async function statusMap() {
  const cfg = await getConfig();
  const meta = await statusMeta(cfg);
  _spacesCache.data = null;   // relê com as regras atuais
  const spaces = await qaSpaces(cfg, meta);
  return spaces.map((sp) => ({
    project: sp.project, board: sp.board,
    statuses: Object.entries(sp.kinds)
      .filter(([, k]) => k.column)
      .map(([id, k]) => ({ id, name: meta[id]?.name || id, column: k.column, kind: k.kind, cat: meta[id]?.cat || "", stage: stageFrom(k.kind, meta[id]?.cat) })),
  }));
}

const VERSION = chrome.runtime.getManifest?.().version || "dev";

const HANDLERS = {
  PING: async () => ({ version: VERSION }),
  TEST_CONNECTION: testConnection,
  LOAD_TREE: (p) => loadIssueTree(p.key),
  LOAD_SUBTASK: (p) => loadSubtaskContext(p.key),
  APPLY: (p) => applySingle(p),
  PLAN_PREVIEW: (p) => previewWorkday(p),
  DAY_REPORT: (p) => dayReport(p),
  TEAM_REPORT: (p) => teamReport(p),
  SPRINT_INFO: (p) => sprintInfo(p),
  MY_PROGRESS: (p) => myProgress(p),
  MY_DEMANDS: (p) => myDemands(p),
  ISSUE_HISTORY: (p) => issueHistory(p),
  SPRINT_KEYS: (p) => sprintKeys(p),
  SCRUM_SPRINT: (p) => scrumSprint(p),
  DESIGN_HUS: (p) => designHus(p),
  UX_BOARD: (p) => uxBoardData(p),
  UX_ACTION: (p) => uxAction(p),
  ASSIGNABLE_USERS: (p) => assignableUsers(p),
  ASSIGN_ISSUE: (p) => assignIssue(p),
  SAVE_SCRUM_SETTINGS: (p) => saveScrumSettings(p),
  CREATE_DEPLOY_CARD: (p) => createDeployCard(p),
  CREATE_MEETING_ISSUE: (p) => createMeetingIssue(p),
  MEETING_CLASSIFY: (p) => meetingClassify(p),
  MY_MEETINGS: (p) => myMeetings(p),
  PERSON_MEETINGS: (p) => myMeetings(p),
  MEETING_CATEGORY_OPTIONS: (p) => meetingCategoryOptions(p),
  QA_QUEUE: (p) => qaQueue(p),
  POST_EVIDENCE: (p) => postEvidence(p),
  HANDOFF_GET: (p) => handoffGet(p),
  HANDOFF_SAVE: (p) => handoffSave(p),
  FIGMA_FRAMES: (p) => figmaFrames(p),
  FIGMA_LINKS: (p) => figmaLinks(p),
  FIGMA_PREVIEW: (p) => figmaPreview(p),
  STATUS_MAP: () => statusMap(),
  CHECK_UPDATE: (p) => checkUpdate(p),
  MY_ACTIVITY: (p) => myActivity(p),
  NATIVE_PING: () => nativePing(),
  NATIVE_UPDATE: () => nativeUpdate(),
  SAVE_GOAL: (p) => saveGoal(p),
  TEAM_SAVE_PERSON: (p) => teamSavePerson(p),
  TEAM_USER_SEARCH: (p) => teamUserSearch(p),
  RESOLVE_BATCH: (p) => resolveBatch(p),
  MY_DASHBOARD: (p) => myDashboard(p),
  APPLY_BATCH: (p) => applyBatch(p),
  CREATE_SUBTASK: (p) => createSubtask(p),
  SEARCH_COLUMNS: (p) => searchByColumns(p),
  LIST_BOARDS: (p) => listBoards(p),
  BOARD_COLUMNS: (p) => getBoardColumns(p),
  CREATE_SUBTASKS_BATCH: (p) => createSubtasksBatch(p),
  SAVE_BOARD: async (p) => {
    const key = p.space === "sustentacao" ? "sustBoardId" : "batchBoardId";
    await chrome.storage.sync.set({ [key]: String(p.boardId || "") });
    return { saved: true };
  },
  GET_DEFAULTS: async () => {
    const cfg = await getConfig();
    const wd = workdayFromConfig(cfg);
    return {
      fibonacci: FIBONACCI,
      defaultStoryPoints: FIBONACCI.includes(Number(cfg.defaultStoryPoints)) ? Number(cfg.defaultStoryPoints) : 1,
      workday: {
        start: wd.start, end: wd.end, cap: wd.capMinutes, overflow: wd.overflow,
        goal: Math.min(Math.round((Number(cfg.dailyGoalHours) || 4) * 60), wd.capMinutes),
      },
      baseUrl: String(cfg.baseUrl || "").replace(/\/+$/, ""),
      subtaskName: cfg.subtaskName,
      designProjects: splitList(cfg.designProjects).map((x) => x.toUpperCase()),
      uxProject: uxProjectOf(cfg),
      qaPeople: parseDeployers(cfg.qaPeople, true),
      qaRejectCategories: cfg.qaRejectCategories,
      assignSelf: cfg.assignSelf,
      defaultProject: cfg.defaultProject,
      aliases: [..._aliases.map].map(([k, v]) => `${k}=${v}`).join(", "),
      spaces: {
        batch: {
          label: (cfg.defaultProject || "MEED").toUpperCase(),
          project: (cfg.defaultProject || "").toUpperCase(),
          columns: cfg.statusColumns,
          boardId: cfg.batchBoardId || "",
        },
        sustentacao: {
          label: (cfg.sustProject || "SUS").toUpperCase(),
          project: (cfg.sustProject || "").toUpperCase(),
          columns: cfg.sustColumns,
          boardId: cfg.sustBoardId || "",
        },
      },
    };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg?.type || msg.type === "BATCH_PROGRESS") return false;   // eventos, não pedidos
  if (msg.type === "QUICKFILL_LAUNCH" || msg.type === "OPEN_SIDE_PANEL") {
    const tabId = _sender?.tab?.id, windowId = _sender?.tab?.windowId;
    if (msg.type === "QUICKFILL_LAUNCH" && _openMode !== "panel") { sendResponse({ ok: true, data: { panel: false } }); return false; }
    openSidePanel({ tabId, windowId })
      .then(() => sendResponse({ ok: true, data: { panel: true } }))
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }
  const handler = HANDLERS[msg.type];
  if (!handler) {
    // Nunca deixa a porta fechar em silêncio: diz o que aconteceu.
    sendResponse({
      ok: false,
      error: `Ação "${msg.type}" desconhecida pelo serviço da extensão (v${VERSION}). Recarregue a extensão.`,
    });
    return false;
  }
  // getConfig() recarrega o mapa de abreviações antes de qualquer normalizeKey
  Promise.resolve(getConfig())
    .then(() => handler(msg.payload || {}))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true; // resposta assíncrona
});

/* Atalho de teclado -> abre o modal na aba do Jira */
/* ---------- Painel lateral x modal grande ---------- */

// Guardado em memória: sidePanel.open() só funciona dentro do gesto do usuário (sem esperar o storage).
// O modal grande sobre o Jira está desativado por enquanto: sempre abre no painel lateral.
const _openMode = "panel";
// Ícone da extensão na barra abre o painel lateral
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

function openSidePanel({ tabId, windowId }) {
  if (!chrome.sidePanel?.open) return Promise.reject(new Error("Painel lateral indisponível nesta versão do Chrome."));
  return chrome.sidePanel.open(tabId ? { tabId } : { windowId });
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "open-quickfill") return;
  if (_openMode === "panel" && (tab?.id || tab?.windowId)) {
    try { await openSidePanel({ tabId: tab.id, windowId: tab.windowId }); return; } catch { /* cai no modal */ }
  }
  const [active] = tab?.id ? [tab] : await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.id) return;
  try {
    await chrome.tabs.sendMessage(active.id, { type: "QUICKFILL_TOGGLE" });
  } catch {
    // Aba não é do Jira (content script ausente) — abre em janela própria.
    chrome.windows.create({ url: chrome.runtime.getURL("modal.html?standalone=1"), type: "popup", width: 1000, height: 860 });
  }
});

/* ------------------------------------------------------------------ */
/* QA — demandas em que você atuou (qualquer status)                    */
/* ------------------------------------------------------------------ */

const _activity = { at: 0, data: null, pending: null };

/**
 * Últimos 30 dias, em qualquer status: atribuídas a você (agora ou antes), com horas suas ou que você
 * moveu de status. Cada uma vem com a última mudança de status (de → para, quem, quando).
 */
async function myActivity(p = {}) {
  if (!p.force && _activity.data && Date.now() - _activity.at < 2 * 60 * 1000) return _activity.data;
  if (_activity.pending) return _activity.pending;
  _activity.pending = (async () => {
    const cfg = await getConfig();
    const [meta, me] = await Promise.all([statusMeta(cfg), getMyself(cfg)]);
    const spaces = await qaSpaces(cfg, meta);
    const projects = spaces.map((x) => x.project).filter(Boolean);
    const scope = projects.length ? `project in (${projects.map(jqlString).join(", ")}) AND ` : "";
    const jql = `${scope}(assignee = currentUser() OR assignee WAS currentUser() OR worklogAuthor = currentUser()`
      + ` OR status CHANGED BY currentUser() AFTER -30d) AND updated >= -30d ORDER BY updated DESC`;
    const raw = await searchWithChangelog(jql, ["summary", "status", "issuetype", "parent", "project", "priority", "updated", "assignee", "duedate"], 300, cfg);
    const issues = raw.map((i) => {
      const f = i.fields || {};
      const tr = statusTransitions(i.changelog?.histories);
      const last = tr[tr.length - 1] || null;
      const mineMoves = tr.filter((t) => t.by === me.accountId);
      return {
        key: i.key,
        summary: f.summary || "",
        project: f.project?.key || i.key.split("-")[0],
        isSubtask: !!f.issuetype?.subtask,
        type: f.issuetype?.name || "",
        parentKey: f.parent?.key || null,
        parentSummary: f.parent?.fields?.summary || "",
        status: f.status?.name || "",
        statusCategory: f.status?.statusCategory?.key || "",
        priority: f.priority?.name || "",
        assignee: f.assignee ? { id: f.assignee.accountId, name: f.assignee.displayName } : null,
        mine: f.assignee?.accountId === me.accountId,
        due: f.duedate || null,
        updated: Date.parse(f.updated) || null,
        lastMove: last ? { at: last.at, from: last.fromName, to: last.toName, by: last.byName, byMe: last.by === me.accountId } : null,
        myLastMove: mineMoves.length ? { at: mineMoves[mineMoves.length - 1].at, to: mineMoves[mineMoves.length - 1].toName } : null,
      };
    });
    return { generatedAt: Date.now(), url: cfg.baseUrl, issues, truncated: raw.length >= 300 };
  })();
  try {
    const data = await _activity.pending;
    _activity.at = Date.now();
    _activity.data = data;
    return data;
  } finally { _activity.pending = null; }
}

/* ---------- Botão "Atualizar agora" (ajudante nativo do Windows) ---------- */

const NATIVE_HOST = "com.quickfill.updater";
function nativeCall(msg) {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime.sendNativeMessage) return reject(new Error("Atualização nativa indisponível neste navegador."));
    chrome.runtime.sendNativeMessage(NATIVE_HOST, msg, (res) => {
      const err = chrome.runtime.lastError?.message;
      if (err) return reject(new Error(/not found|não encontrado|forbidden|proibido/i.test(err) ? "ajudante não ativado" : err));
      if (!res?.ok) return reject(new Error(res?.error || "O ajudante não respondeu."));
      resolve(res);
    });
  });
}
const nativePing = async () => { try { await nativeCall({ action: "ping" }); return { available: true }; } catch (e) { return { available: false, reason: e.message }; } };
/** Baixa e instala a versão nova deste pacote pelo ajudante; quem chama recarrega a extensão em seguida. */
const nativeUpdate = () => nativeCall({ action: "update", package: ROLE });

/* ---------- Notificação do Windows quando sair versão nova ----------
 * Verifica a cada 3 h (o update.json fica em cache por 6 h) e ao abrir o Chrome. Uma notificação por versão.
 * O botão da notificação atualiza pelo ajudante (um clique) ou, sem ele, abre as Opções para ativar. */

const ROLE_LABEL = { qa: "QA", dev: "DEV", scrum: "SCRUM", design: "DESIGN" }[ROLE] || "";
const NOTIF_ID = "qf-update";
chrome.alarms?.create("qf-update-check", { delayInMinutes: 1, periodInMinutes: 180 });
chrome.alarms?.onAlarm.addListener((a) => { if (a.name === "qf-update-check") notifyIfUpdate(); });
chrome.runtime.onStartup?.addListener(() => notifyIfUpdate());

const notify = (id, title, message, extra = {}) =>
  chrome.notifications?.create(id, { type: "basic", iconUrl: "icons/icon128.png", title, message, priority: 1, ...extra });

async function notifyIfUpdate() {
  try {
    const u = await checkUpdate({});
    if (!u?.newer) return;
    const { updateNotified } = await chrome.storage.local.get({ updateNotified: "" });
    if (updateNotified === u.latest) return;
    const nat = await nativePing();
    await chrome.storage.local.set({ updateNotified: u.latest });
    notify(NOTIF_ID, `QuickFill ${ROLE_LABEL} — versão ${u.latest} disponível`,
      u.notes || "Há uma versão nova do QuickFill.",
      { buttons: [{ title: nat.available ? "Atualizar agora" : "Como atualizar" }], requireInteraction: true });
  } catch { /* sem rede ou sem update.json: tenta na próxima */ }
}

/** Botão (ou clique) na notificação: atualiza pelo ajudante; sem ele, abre as Opções na parte de ativação. */
async function onUpdateNotification() {
  chrome.notifications.clear(NOTIF_ID);
  const nat = await nativePing();
  if (!nat.available) { chrome.tabs.create({ url: chrome.runtime.getURL("options.html#atualizacao") }); return; }
  notify("qf-updating", `QuickFill ${ROLE_LABEL}`, "Baixando e instalando a versão nova…");
  try {
    await nativeUpdate();
    chrome.notifications.clear("qf-updating");
    notify("qf-updated", `QuickFill ${ROLE_LABEL} atualizado`, "Pronto! A extensão foi recarregada com a versão nova.");
    setTimeout(() => chrome.runtime.reload(), 800);
  } catch (e) {
    chrome.notifications.clear("qf-updating");
    notify("qf-update-err", "Não deu para atualizar sozinho", `${e.message}. Abra o QuickFill e use “Copiar comando de atualização”.`);
  }
}
chrome.notifications?.onButtonClicked.addListener((id) => { if (id === NOTIF_ID) onUpdateNotification(); });
chrome.notifications?.onClicked.addListener((id) => { if (id === NOTIF_ID) onUpdateNotification(); });

/* ---------- Aviso de nova versão (repositório) ---------- */

const semver = (v) => String(v || "0").split(".").map((x) => parseInt(x, 10) || 0);
const newer = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

/**
 * Token de leitura do repositório privado: o instalador (atualizar-quickfill) grava em
 * update.local.json dentro da pasta da extensão; também pode ser colado nas Opções.
 */
async function updateToken(cfg) {
  if (cfg.updateToken) return String(cfg.updateToken).trim();
  try {
    const res = await fetch(chrome.runtime.getURL("update.local.json"), { cache: "no-store" });
    if (res.ok) return String((await res.json()).token || "").trim();
  } catch { /* arquivo não existe: instalado sem o instalador */ }
  return "";
}

/** Lê o update.json do repositório (no máximo a cada 6 h) e diz se há versão nova deste pacote. */
async function checkUpdate(p = {}) {
  const cfg = await getConfig();
  const url = (cfg.updateUrl || UPDATE_URL || "").trim();
  const current = chrome.runtime.getManifest().version;
  if (!url) return { configured: false, current };
  const { updateCheck } = await chrome.storage.local.get({ updateCheck: null });
  if (!p.force && updateCheck?.url === url && Date.now() - updateCheck.at < 6 * 3600 * 1000) return { ...updateCheck.data, current, newer: newer(updateCheck.data.latest, current) };
  const token = await updateToken(cfg);
  const headers = url.includes("api.github.com")
    ? { Accept: "application/vnd.github.raw+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    : {};
  if (url.includes("api.github.com") && !token) return { configured: true, needsToken: true, current };
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store", headers });
  if (res.status === 401 || res.status === 403 || res.status === 404) return { configured: true, badToken: true, current };
  if (!res.ok) throw new Error(`Não consegui ler o aviso de versão (${res.status}).`);
  const json = await res.json();
  const pkg = json.packages?.[ROLE] || {};
  // cada perfil tem a sua versão e as suas notas (o topo do update.json é só para versões antigas)
  const data = { configured: true, private: !!json.private, repo: json.repo || "", installCommand: json.installCommand || "", guide: json.guide || "", latest: pkg.version || json.version,
    notes: pkg.version ? pkg.notes || "" : json.notes || "", download: pkg.download || json.download || "", folder: pkg.folder || "", date: pkg.date || json.date || "" };
  await chrome.storage.local.set({ updateCheck: { url, at: Date.now(), data } });
  return { ...data, current, newer: newer(data.latest, current) };
}
