const http = require("http");
const fs = require("fs");
const path = require("path");
const { handleApi } = require("./lib/api");
const { runDailyRollover, millisecondsUntilNextBusinessDay } = require("./lib/repository");
const { closeDb } = require("./lib/db");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function serveStatic(req, res) {
  let pathname = decodeURIComponent(req.url.split("?")[0]);
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[".html"],
          "Cache-Control": "no-cache"
        });
        res.end(fallback);
      });
      return;
    }

    const extension = path.extname(filePath);
    const headers = { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" };
    if (extension === ".html" || extension === ".js") headers["Cache-Control"] = "no-cache";
    res.writeHead(200, headers);
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const startedAt = process.hrtime.bigint();
  res.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1000000;
    if (durationMs >= 1000) {
      console.warn(`Slow request: ${req.method} ${req.url.split("?")[0]} ${res.statusCode} ${Math.round(durationMs)}ms`);
    }
  });
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.requestTimeout = 30000;
server.headersTimeout = 35000;
server.keepAliveTimeout = 5000;

server.listen(PORT, HOST, () => {
  console.log(`Restaurant ordering app listening on ${HOST}:${PORT}`);
  runDailyRollover().catch(error => console.error("Daily rollover failed:", error));
  scheduleDailyRollover();
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; shutting down gracefully.`);
  server.close(async error => {
    try {
      await closeDb();
    } catch (dbError) {
      console.error("Database shutdown failed:", dbError);
    }
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

function scheduleDailyRollover() {
  const timer = setTimeout(async () => {
    try {
      await runDailyRollover();
    } catch (error) {
      console.error("Daily rollover failed:", error);
    } finally {
      scheduleDailyRollover();
    }
  }, millisecondsUntilNextBusinessDay());
  timer.unref();
}
