import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const API_BASE_URL = String(process.env.LOG_API_BASE_URL || "https://contra-city-api-production.up.railway.app").replace(/\/+$/, "");
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".ico", "image/x-icon"]
]);

function securityHeaders(contentType) {
  return {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cross-origin-resource-policy": "same-origin",
    "content-security-policy": "default-src 'self'; connect-src 'self' https:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  };
}

function send(res, status, body, type, cache = "no-store") {
  res.writeHead(status, {
    ...securityHeaders(type),
    "cache-control": cache,
    "content-length": String(Buffer.byteLength(body))
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/health") {
    send(res, 200, JSON.stringify({ ok: true, service: "contra-city-log-panel", api: API_BASE_URL }), "application/json; charset=utf-8");
    return;
  }
  if (url.pathname === "/config.js") {
    const body = `window.__LOG_PANEL_CONFIG__=${JSON.stringify({ apiBaseUrl: API_BASE_URL })};`;
    send(res, 200, body, "text/javascript; charset=utf-8");
    return;
  }
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const resolved = path.resolve(PUBLIC_DIR, requested);
  if (!resolved.startsWith(`${path.resolve(PUBLIC_DIR)}${path.sep}`) && resolved !== path.join(path.resolve(PUBLIC_DIR), "index.html")) {
    send(res, 403, "forbidden", "text/plain; charset=utf-8");
    return;
  }
  fs.readFile(resolved, (error, body) => {
    if (error) {
      if (!path.extname(requested)) {
        fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallbackBody) => {
          if (fallbackError) send(res, 404, "not found", "text/plain; charset=utf-8");
          else send(res, 200, fallbackBody, "text/html; charset=utf-8");
        });
        return;
      }
      send(res, 404, "not found", "text/plain; charset=utf-8");
      return;
    }
    const type = CONTENT_TYPES.get(path.extname(resolved).toLowerCase()) || "application/octet-stream";
    send(res, 200, body, type, /\.(css|js|png|ico)$/.test(resolved) ? "public, max-age=3600" : "no-store");
  });
});

server.listen(PORT, () => console.log(`Contra City log panel listening on ${PORT}; api=${API_BASE_URL}`));
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 48;
