#!/usr/bin/env node
// Local server that behaves like the Cloudflare Pages deployment:
// clean URLs (/work → work.html), 404.html for missing pages, and the
// Medici helper at /__medici__ running the same function that's deployed.
//
//   node scripts/dev-server.mjs            # http://localhost:4173
//   PORT=5000 node scripts/dev-server.mjs

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 4173;

const { onRequest: medici } = await import(pathToFileURL(path.join(ROOT, "functions/__medici__/[path].js")).href);

const TYPES = {
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

function sendFile(res, status, file) {
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(status, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  });
}

async function serveMedici(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
  }
  try {
    const response = await medici({ request: new Request(url, { method: req.method, headers }) });
    const body = Buffer.from(await response.arrayBuffer());
    const out = Object.fromEntries(response.headers);
    // Node's fetch has already decompressed the body.
    delete out["content-encoding"];
    out["content-length"] = String(body.length);
    res.writeHead(response.status, out);
    res.end(body);
  } catch (error) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(String(error && error.message || error));
  }
}

http.createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);

  if (pathname === "/__medici__" || pathname.startsWith("/__medici__/")) {
    serveMedici(req, res);
    return;
  }

  if (pathname.endsWith("/")) pathname += "index.html";
  const file = path.join(ROOT, path.normalize(pathname));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }

  const candidates = path.extname(file) ? [file] : [file, file + ".html"];
  const hit = candidates.find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  if (hit) sendFile(res, 200, hit);
  else sendFile(res, 404, path.join(ROOT, "404.html"));
}).listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
