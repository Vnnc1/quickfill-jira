import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = (req.url || "/").split("?")[0];
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const safePath = normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
    const filePath = join(DIR, safePath);
    if (!filePath.startsWith(DIR)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Acesso negado");
      return;
    }
    const content = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store",
    });
    res.end(content);
  } catch (err) {
    if (err?.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Arquivo não encontrado");
      return;
    }
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Erro interno no servidor local");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`QuickFill Painel Refatorado (Protótipo Debug) rodando em:`);
  console.log(`  → http://quickfill.localhost:${PORT}`);
  console.log(`  → http://localhost:${PORT}`);
});
