import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(DIR, "..", "..");
const EXT_DIR = join(ROOT, "jira-quickfill-dev");
const PORT = Number(process.env.PORT || 4174);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const ME = { accountId: "acc-sm", displayName: "Samuel Martins" };

const ISSUES = {
  "MEED-2587": {
    key: "MEED-2587",
    fields: {
      summary: "Análise e alterações para atualização de Memed (link das prescrições) - 11/12",
      status: { id: "1", name: "Itens Pendentes", statusCategory: { key: "new" } },
      priority: { name: "Medium" },
      assignee: { accountId: "acc-gn", displayName: "Gabriel Nogueira" },
      duedate: "2026-11-28",
      timetracking: { originalEstimateSeconds: 7200, timeSpentSeconds: 3600, remainingEstimateSeconds: 3600 },
      subtasks: [],
      issuelinks: [],
      comment: { total: 1, comments: [{ created: "2026-11-18T14:20:00.000-0300", author: { displayName: "Gabriel Nogueira" }, body: "Link da doc Memed conferido." }] },
      description: "Atualizar integração Memed SDK v4.",
    },
    remoteLinks: [{ object: { url: "https://novetech.atlassian.net/wiki/spaces/ENG/pages/401", title: "Spec Memed SDK v4" } }],
  },
  "MEED-1188": {
    key: "MEED-1188",
    fields: {
      summary: "DASHBOARD DE PRÉ-ANÁLISE DO BPA-I",
      status: { id: "1", name: "Itens Pendentes", statusCategory: { key: "new" } },
      priority: { name: "High" },
      assignee: { accountId: "acc-gn", displayName: "Gabriel Nogueira" },
      duedate: "2026-11-25",
      timetracking: { originalEstimateSeconds: 10800, timeSpentSeconds: 0, remainingEstimateSeconds: 10800 },
      subtasks: [{ fields: { status: { statusCategory: { key: "done" } } } }, { fields: { status: { statusCategory: { key: "new" } } } }],
      issuelinks: [],
      comment: { total: 2, comments: [] },
      description: "Ver protótipo https://www.figma.com/design/bpa123/BPA-I?node-id=12-44",
    },
    remoteLinks: [{ object: { url: "https://www.figma.com/design/bpa123/BPA-I?node-id=12-44", title: "Figma · Dashboard BPA-I" } }],
  },
  "MEED-1330": {
    key: "MEED-1330",
    fields: {
      summary: "Integração e Visualização do Histórico Clínico do PEC no Prontuário",
      status: { id: "2", name: "Pronto Para Desenvolvimento", statusCategory: { key: "new" } },
      priority: { name: "High" },
      assignee: { accountId: "acc-gn", displayName: "Gabriel Nogueira" },
      duedate: "2026-11-26",
      timetracking: { originalEstimateSeconds: 14400, timeSpentSeconds: 5400, remainingEstimateSeconds: 9000 },
      subtasks: [{ fields: { status: { statusCategory: { key: "done" } } } }],
      issuelinks: [{ type: { outward: "relacionado a" }, outwardIssue: { key: "MEED-2535", fields: { summary: "Número de prontuário", status: { name: "Pronto", statusCategory: { key: "new" } } } } }],
      comment: { total: 3, comments: [] },
      description: "",
    },
    remoteLinks: [
      { object: { url: "https://novetech.atlassian.net/wiki/spaces/ENG/pages/512", title: "RFC Integração PEC" } },
      { object: { url: "https://www.figma.com/design/pec99/Prontuario?node-id=8-12", title: "Telas Histórico PEC" } },
    ],
  },
  "MEED-2535": {
    key: "MEED-2535",
    fields: {
      summary: "Número de prontuário do paciente e busca por prontuário",
      status: { id: "2", name: "Pronto Para Desenvolvimento", statusCategory: { key: "new" } },
      priority: { name: "Medium" },
      assignee: { accountId: "acc-jd", displayName: "João Duarte" },
      duedate: "2026-11-25",
      timetracking: { originalEstimateSeconds: 7200, timeSpentSeconds: 1800, remainingEstimateSeconds: 5400 },
      subtasks: [],
      issuelinks: [],
      comment: { total: 0, comments: [] },
      description: "",
    },
    remoteLinks: [{ object: { url: "https://www.figma.com/design/pront5/Busca?node-id=2-1", title: "Busca por Prontuário" } }],
  },
  "MEED-1290": {
    key: "MEED-1290",
    fields: {
      summary: "Cronômetro Persistente de Tempo de Consulta (Semáforo Visual Flutuante)",
      status: { id: "3", name: "Em Andamento", statusCategory: { key: "indeterminate" } },
      priority: { name: "High" },
      assignee: { accountId: "acc-sm", displayName: "Samuel Martins" },
      duedate: "2026-11-23",
      timetracking: { originalEstimateSeconds: 7200, timeSpentSeconds: 9900, remainingEstimateSeconds: 0 }, // +45m exc!
      subtasks: [{ fields: { status: { statusCategory: { key: "done" } } } }, { fields: { status: { statusCategory: { key: "indeterminate" } } } }],
      issuelinks: [],
      comment: { total: 4, comments: [{ created: "2026-11-19T11:30:00.000-0300", author: { displayName: "Amanda Saraiva" }, body: "Tokens do semáforo verde/amarelo/vermelho aprovados no Figma." }] },
      description: "",
    },
    remoteLinks: [
      { object: { url: "https://novetech.atlassian.net/wiki/spaces/PROD/pages/622", title: "Spec Semáforo de Consulta" } },
      { object: { url: "https://www.figma.com/design/crono/Semaforo?node-id=30-9", title: "Semáforo Visual Flutuante" } },
    ],
  },
  "MEED-2534": {
    key: "MEED-2534",
    fields: {
      summary: "Módulo Marcações e Exportação PDF",
      status: { id: "3", name: "Em Andamento", statusCategory: { key: "indeterminate" } },
      priority: { name: "Medium" },
      assignee: { accountId: "acc-sm", displayName: "Samuel Martins" },
      duedate: "2026-11-27",
      timetracking: { originalEstimateSeconds: 14400, timeSpentSeconds: 10800, remainingEstimateSeconds: 3600 },
      subtasks: [{ fields: { status: { statusCategory: { key: "done" } } } }, { fields: { status: { statusCategory: { key: "done" } } } }, { fields: { status: { statusCategory: { key: "indeterminate" } } } }],
      issuelinks: [],
      comment: { total: 2, comments: [] },
      description: "",
    },
    remoteLinks: [{ object: { url: "https://novetech.atlassian.net/wiki/spaces/ENG/pages/699", title: "Template PDF Marcações" } }],
  },
  "MEED-2490": {
    key: "MEED-2490",
    fields: {
      summary: "Configuração do Infisical - Gerenciamento de Envs",
      status: { id: "3", name: "Em Andamento", statusCategory: { key: "indeterminate" } },
      priority: { name: "Medium" },
      assignee: { accountId: "acc-gn", displayName: "Gabriel Nogueira" },
      duedate: "2026-11-04", // vencida!
      timetracking: { originalEstimateSeconds: 7200, timeSpentSeconds: 8700, remainingEstimateSeconds: 0 }, // +25m exc!
      subtasks: [{ fields: { status: { statusCategory: { key: "done" } } } }, { fields: { status: { statusCategory: { key: "done" } } } }, { fields: { status: { statusCategory: { key: "new" } } } }],
      issuelinks: [],
      comment: { total: 3, comments: [] },
      description: "",
    },
    remoteLinks: [{ object: { url: "https://novetech.atlassian.net/wiki/spaces/INFRA/pages/204", title: "Runbook Infisical Envs" } }],
  },
  "MEED-1072": {
    key: "MEED-1072",
    fields: {
      summary: "[OPERACIONAL] - Pronto Atendimento Restrito por Estabelecimento",
      status: { id: "4", name: "Impedido/Aguardando", statusCategory: { key: "indeterminate" } },
      priority: { name: "Critical" },
      assignee: { accountId: "acc-ma", displayName: "Matheus Alves" },
      duedate: "2026-11-18",
      timetracking: { originalEstimateSeconds: 10800, timeSpentSeconds: 14400, remainingEstimateSeconds: 0 }, // +1h exc!
      subtasks: [],
      issuelinks: [{ type: { inward: "is blocked by" }, inwardIssue: { key: "MEED-2490", fields: { summary: "Infisical Envs", status: { name: "Em Andamento", statusCategory: { key: "indeterminate" } } } } }],
      comment: { total: 5, comments: [] },
      description: "",
    },
    remoteLinks: [{ object: { url: "https://novetech.atlassian.net/wiki/spaces/PROD/pages/333", title: "Regras PA por Unidade" } }],
  },
  "MEED-2478": {
    key: "MEED-2478",
    fields: {
      summary: "Integração com TytoCare — Dispositivos de Telemedicina",
      status: { id: "4", name: "Impedido/Aguardando", statusCategory: { key: "indeterminate" } },
      priority: { name: "High" },
      assignee: { accountId: "acc-sm", displayName: "Samuel Martins" },
      duedate: "2026-09-24",
      timetracking: { originalEstimateSeconds: 10800, timeSpentSeconds: 12600, remainingEstimateSeconds: 0 }, // +30m exc!
      subtasks: [{ fields: { status: { statusCategory: { key: "done" } } } }],
      issuelinks: [{ type: { inward: "is blocked by" }, inwardIssue: { key: "MEED-1072", fields: { summary: "PA Restrito", status: { name: "Impedido", statusCategory: { key: "indeterminate" } } } } }],
      comment: { total: 6, comments: [{ created: "2026-11-18T15:10:00.000-0300", author: { displayName: "Samuel Martins" }, body: "Aguardando credencial sandbox TytoCare para homologar webhook." }] },
      description: "",
    },
    remoteLinks: [
      { object: { url: "https://novetech.atlassian.net/wiki/spaces/INT/pages/710", title: "Guia API TytoCare" } },
      { object: { url: "https://www.figma.com/design/tyto/TelaExame?node-id=19-4", title: "Modal Exame TytoCare" } },
    ],
  },
  "MEED-2014": {
    key: "MEED-2014",
    fields: {
      summary: "Indicador de Presença Online do Paciente na Sala de Espera",
      status: { id: "5", name: "PR", statusCategory: { key: "indeterminate" } },
      priority: { name: "Medium" },
      assignee: { accountId: "acc-jd", displayName: "João Duarte" },
      duedate: "2026-11-18",
      timetracking: { originalEstimateSeconds: 7200, timeSpentSeconds: 6300, remainingEstimateSeconds: 900 },
      subtasks: [],
      issuelinks: [],
      comment: { total: 2, comments: [] },
      description: "",
    },
    remoteLinks: [{ object: { url: "https://www.figma.com/design/sala/Presenca?node-id=41-2", title: "Badge Online Sala de Espera" } }],
  },
  "MEED-1971": {
    key: "MEED-1971",
    fields: {
      summary: "Notificação de Chegada do Paciente na Sala de Espera (Agendamento)",
      status: { id: "5", name: "PR", statusCategory: { key: "indeterminate" } },
      priority: { name: "Low" },
      assignee: { accountId: "acc-jd", displayName: "João Duarte" },
      duedate: "2026-11-17",
      timetracking: { originalEstimateSeconds: 7200, timeSpentSeconds: 7200, remainingEstimateSeconds: 0 },
      subtasks: [
        { fields: { status: { statusCategory: { key: "done" } } } },
        { fields: { status: { statusCategory: { key: "done" } } } },
        { fields: { status: { statusCategory: { key: "done" } } } },
        { fields: { status: { statusCategory: { key: "done" } } } },
      ],
      issuelinks: [],
      comment: { total: 1, comments: [] },
      description: "",
    },
    remoteLinks: [],
  },
};

const WORKLOGS = [
  { key: "MEED-1290", summary: ISSUES["MEED-1290"].fields.summary, start: 11 * 60, end: 13 * 60, minutes: 120 },
  { key: "MEED-2534", summary: ISSUES["MEED-2534"].fields.summary, start: 13 * 60 + 2, end: 13 * 60 + 42, minutes: 40 },
  { key: "MEED-2478", summary: ISSUES["MEED-2478"].fields.summary, start: 13 * 60 + 44, end: 13 * 60 + 54, minutes: 10 },
  { key: "MEED-1290", summary: ISSUES["MEED-1290"].fields.summary, start: 14 * 60 + 35, end: 15 * 60 + 25, minutes: 50 },
  { key: "MEED-2534", summary: ISSUES["MEED-2534"].fields.summary, start: 15 * 60 + 35, end: 16 * 60 + 20, minutes: 45 },
];

const BOARD_CONFIG = {
  columnConfig: {
    columns: [
      { name: "Itens Pendentes", statuses: [{ id: "1" }] },
      { name: "Pronto Para Desenvolvimento", statuses: [{ id: "2" }] },
      { name: "Em Andamento", statuses: [{ id: "3" }] },
      { name: "Impedido/Aguardando", statuses: [{ id: "4" }] },
      { name: "PR", statuses: [{ id: "5" }] },
      { name: "Deploy em DES", statuses: [{ id: "6" }] },
    ],
  },
};

const TRANSITIONS = [
  { id: "t-2", name: "Pronto Para Desenvolvimento", to: { id: "2", name: "Pronto Para Desenvolvimento" }, fields: {} },
  { id: "t-3", name: "Iniciar trabalho", to: { id: "3", name: "Em Andamento" }, fields: {} },
  { id: "t-4", name: "Marcar impedido", to: { id: "4", name: "Impedido/Aguardando" }, fields: {} },
  { id: "t-5", name: "Enviar para PR", to: { id: "5", name: "PR" }, fields: {} },
  { id: "t-6", name: "Deploy em DES", to: { id: "6", name: "Deploy em DES" }, fields: {} },
];

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const txt = Buffer.concat(chunks).toString("utf8");
  return txt ? JSON.parse(txt) : null;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    const p = u.pathname;

    // Mock API: /rest/api/3/myself
    if (p === "/rest/api/3/myself") return sendJson(res, 200, ME);

    // Mock API: /rest/agile/1.0/board/:id/configuration
    if (/^\/rest\/agile\/1\.0\/board\/\d+\/configuration$/.test(p)) return sendJson(res, 200, BOARD_CONFIG);

    // Mock API: /api/day-report (alimenta o chrome.runtime.sendMessage mock)
    if (p === "/api/day-report") {
      const date = u.searchParams.get("date") || new Date().toISOString().slice(0, 10);
      const total = WORKLOGS.reduce((s, e) => s + e.minutes, 0);
      return sendJson(res, 200, {
        date,
        workday: { start: 11 * 60, end: 17 * 60, cap: 360, goal: 240 },
        total,
        goalMet: total >= 240,
        overCap: total > 360,
        entries: WORKLOGS,
        history: [
          { date: "2026-11-12", total: 245, goalMet: true, issues: 4 },
          { date: "2026-11-13", total: 250, goalMet: true, issues: 5 },
          { date: "2026-11-16", total: 240, goalMet: true, issues: 4 },
          { date: "2026-11-17", total: 242, goalMet: true, issues: 5 },
          { date, total, goalMet: total >= 240, issues: new Set(WORKLOGS.map(w => w.key)).size },
        ],
      });
    }

    // Mock API: /rest/api/3/issue/:key...
    const m = p.match(/^\/rest\/api\/3\/issue\/([^/]+)(\/.*)?$/);
    if (m) {
      const key = decodeURIComponent(m[1]).toUpperCase();
      const sub = m[2] || "";
      const item = ISSUES[key];
      if (!item) return sendJson(res, 404, { errorMessages: [`Issue ${key} não encontrada`] });

      if (sub === "" && req.method === "GET") return sendJson(res, 200, { key: item.key, fields: item.fields });
      if (sub === "/remotelink" && req.method === "GET") return sendJson(res, 200, item.remoteLinks || []);
      if (sub === "/transitions" && req.method === "GET") return sendJson(res, 200, { transitions: TRANSITIONS.filter(t => t.to.id !== item.fields.status.id) });
      if (sub === "/transitions" && req.method === "POST") {
        const body = await readBody(req);
        const found = TRANSITIONS.find(t => t.id === body?.transition?.id);
        if (found) item.fields.status = { id: found.to.id, name: found.to.name, statusCategory: { key: found.to.id === "6" ? "done" : "indeterminate" } };
        res.writeHead(204);
        return res.end();
      }
      if (sub === "/worklog" && req.method === "POST") {
        const body = await readBody(req);
        const sec = Number(body?.timeSpentSeconds) || 0;
        const min = Math.max(1, Math.round(sec / 60));
        item.fields.timetracking.timeSpentSeconds = (item.fields.timetracking.timeSpentSeconds || 0) + sec;
        const dt = new Date(body?.started || Date.now());
        const startMin = Number.isFinite(dt.getTime()) ? dt.getHours() * 60 + dt.getMinutes() : 14 * 60;
        WORKLOGS.push({ key, summary: item.fields.summary, start: startMin, end: startMin + min, minutes: min });
        return sendJson(res, 201, { id: String(Date.now()), timeSpentSeconds: sec });
      }
      if (sub === "/comment" && req.method === "GET") {
        return sendJson(res, 200, { comments: item.fields.comment?.comments || [] });
      }
      if (sub === "/comment" && req.method === "POST") {
        const body = await readBody(req);
        item.fields.comment.comments.unshift({ created: new Date().toISOString(), author: ME, body: body?.body });
        item.fields.comment.total = item.fields.comment.comments.length;
        return sendJson(res, 201, { id: String(Date.now()) });
      }
      if (sub === "/changelog" && req.method === "GET") {
        return sendJson(res, 200, { total: 1, values: [{ created: "2026-11-18T16:10:00.000-0300", author: ME, items: [{ field: "status", fromString: "Pronto Para Desenvolvimento", toString: item.fields.status.name }] }] });
      }
    }

    // Serve os arquivos REAIS da extensão em /ext/*
    if (p.startsWith("/ext/")) {
      const rel = normalize(p.slice(5)).replace(/^(\.\.(\/|\\|$))+/, "");
      const filePath = join(EXT_DIR, rel);
      if (!filePath.startsWith(EXT_DIR)) { res.writeHead(403); return res.end("Forbidden"); }
      const content = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
      return res.end(content);
    }

    // Página principal do Jira MEEDS simulado
    const html = await readFile(join(DIR, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  } catch (err) {
    res.writeHead(err?.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(err?.message || "Erro interno");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`QuickFill Modo Suspenso v2 (Preview com código REAL de src/) rodando em:`);
  console.log(`  → http://suspenso.localhost:${PORT}/jira/boards/18`);
  console.log(`  → http://localhost:${PORT}/jira/boards/18`);
});
