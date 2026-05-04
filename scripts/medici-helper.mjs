#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createDecipheriv } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.MEDICI_HOST || "127.0.0.1";
const port = Number(process.env.MEDICI_PORT || 8787);
const browserHost = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
const origin = "http://" + formatHost(browserHost) + ":" + port;
const helperFeatures = ["proxy", "reader", "google-arts"];

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8"
};

function formatHost(value) {
  if (value.includes(":") && !value.startsWith("[")) {
    return "[" + value + "]";
  }
  return value;
}

async function getRunningHelperStatus() {
  try {
    var response = await fetch(origin + "/__medici__/health");
    if (!response.ok) {
      return null;
    }
    var data = await response.json();
    return data && data.ok === true ? data : null;
  } catch (_error) {
    return null;
  }
}

function corsOrigin(req) {
  var origin = req.headers.origin;
  if (!origin) {
    return "*";
  }
  if (origin === "null" || /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin)) {
    return origin;
  }
  return "";
}

function setCors(req, res) {
  var origin = corsOrigin(req);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, User-Agent, Accept");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Type, Content-Disposition, X-Medici-Reader, X-Medici-Upstream-Status");
  res.setHeader("Vary", "Origin");
}

function send(req, res, status, body, contentType) {
  setCors(req, res);
  res.writeHead(status, { "Content-Type": contentType || "text/plain; charset=utf-8" });
  res.end(body);
}

function staticPath(requestPath) {
  var pathname = decodeURIComponent(requestPath.split("?")[0]);
  if (pathname === "/") {
    pathname = "/medici.html";
  }

  var candidate = path.resolve(root, "." + pathname);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    return null;
  }
  return candidate;
}

async function serveStatic(req, res, url) {
  var file = staticPath(url.pathname);
  if (!file) {
    send(req, res, 403, "Forbidden");
    return;
  }

  try {
    var info = await stat(file);
    if (!info.isFile()) {
      send(req, res, 404, "Not found");
      return;
    }

    setCors(req, res);
    res.writeHead(200, {
      "Content-Length": info.size,
      "Content-Type": mimeTypes[path.extname(file).toLowerCase()] || "application/octet-stream"
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    createReadStream(file).pipe(res);
  } catch (_error) {
    send(req, res, 404, "Not found");
  }
}

function proxyHeaders(req, target) {
  var headers = {
    "Accept": req.headers.accept || "*/*",
    "Referer": target.origin + "/",
    "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 Medici/1.0"
  };

  if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  return headers;
}

function isPrivateHostname(hostname) {
  var host = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  var parts = host.split(".").map(Number);

  if (!host || host === "localhost" || host === "::1" || host === "0.0.0.0" || host === "::" || host.endsWith(".local")) {
    return true;
  }
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) {
    return true;
  }
  if (parts.length === 4 && parts.every(Number.isFinite) && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }
  if (/^(?:fc|fd|fe80):/i.test(host)) {
    return true;
  }

  return false;
}

function validatePublicHttpTarget(rawTarget) {
  if (!rawTarget) {
    return { error: "Missing url" };
  }

  var target;
  try {
    target = new URL(rawTarget);
  } catch (_error) {
    return { error: "Invalid url" };
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { error: "Only http and https URLs are supported" };
  }

  return { target: target };
}

async function fetchUpstream(target, options) {
  try {
    return await fetch(target.href, options);
  } catch (error) {
    if (target.protocol === "https:" && /media\.britishmuseum\.org$/i.test(target.hostname)) {
      var fallbackTarget = new URL(target.href);
      fallbackTarget.protocol = "http:";
      var fallbackOptions = Object.assign({}, options, {
        headers: Object.assign({}, options.headers || {}, {
          "Referer": fallbackTarget.origin + "/"
        })
      });
      return fetch(fallbackTarget.href, fallbackOptions);
    }
    throw error;
  }
}

function shouldDecryptGoogleTile(target) {
  return /^(?:lh\d+\.)?(?:googleusercontent\.com|ggpht\.com)$/i.test(target.hostname) &&
    /=x\d+-y\d+-z\d+-t[^/?#]*/i.test(target.href);
}

function readUInt32LE(buffer, offset) {
  return buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16) |
    (buffer[offset + 3] << 24);
}

function decryptGoogleTile(buffer) {
  if (buffer.length < 12 || readUInt32LE(buffer, 0) !== 0x0a0a0a0a) {
    return buffer;
  }

  var end = buffer.length - 4;
  var headerSize = readUInt32LE(buffer, end);
  var encryptedSizeOffset = 4 + headerSize;
  if (encryptedSizeOffset + 4 > end) {
    throw new Error("Google Arts tile header is invalid");
  }

  var encryptedSize = readUInt32LE(buffer, encryptedSizeOffset);
  var encryptedStart = encryptedSizeOffset + 4;
  var encryptedEnd = encryptedStart + encryptedSize;
  if (encryptedEnd > end) {
    throw new Error("Google Arts tile payload is invalid");
  }

  var key = Buffer.from([91, 99, 219, 17, 59, 122, 243, 224, 177, 67, 85, 86, 200, 249, 83, 12]);
  var iv = Buffer.from([113, 231, 4, 5, 53, 58, 119, 139, 250, 111, 188, 48, 50, 27, 149, 146]);
  var decipher = createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(false);

  return Buffer.concat([
    buffer.subarray(4, encryptedSizeOffset),
    decipher.update(buffer.subarray(encryptedStart, encryptedEnd)),
    decipher.final(),
    buffer.subarray(encryptedEnd, end)
  ]);
}

async function serveProxy(req, res, url) {
  var rawTarget = url.searchParams.get("url");
  var validation = validatePublicHttpTarget(rawTarget);
  if (validation.error) {
    send(req, res, 400, validation.error);
    return;
  }
  var target = validation.target;

  try {
    var upstream = await fetchUpstream(target, {
      headers: proxyHeaders(req, target),
      method: req.method === "HEAD" ? "HEAD" : "GET",
      redirect: "follow"
    });

    if (req.method !== "HEAD" && upstream.ok && upstream.body && shouldDecryptGoogleTile(target)) {
      var body = Buffer.from(await upstream.arrayBuffer());
      var decrypted = decryptGoogleTile(body);
      setCors(req, res);
      res.setHeader("X-Medici-Upstream-Status", String(upstream.status));
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
      res.setHeader("Content-Length", String(decrypted.length));
      res.writeHead(upstream.status);
      res.end(decrypted);
      return;
    }

    setCors(req, res);
    res.setHeader("X-Medici-Upstream-Status", String(upstream.status));
    [
      "cache-control",
      "content-disposition",
      "content-type",
      "etag",
      "last-modified"
    ].forEach(function (header) {
      var value = upstream.headers.get(header);
      if (value) {
        res.setHeader(header, value);
      }
    });

    res.writeHead(upstream.status);
    if (req.method === "HEAD" || !upstream.body) {
      res.end();
      return;
    }

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    send(req, res, 502, "Proxy fetch failed: " + error.message);
  }
}

async function serveReader(req, res, url) {
  var rawTarget = url.searchParams.get("url");
  var validation = validatePublicHttpTarget(rawTarget);
  if (validation.error) {
    send(req, res, 400, validation.error);
    return;
  }

  var target = validation.target;
  if (isPrivateHostname(target.hostname)) {
    send(req, res, 400, "Reader fallback only supports public web URLs");
    return;
  }

  try {
    var readerTarget = "https://r.jina.ai/" + target.href;
    var upstream = await fetch(readerTarget, {
      headers: {
        "Accept": "text/html,text/plain,*/*",
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 Medici/1.0",
        "X-Return-Format": "html"
      },
      method: req.method === "HEAD" ? "HEAD" : "GET",
      redirect: "follow"
    });

    setCors(req, res);
    res.setHeader("X-Medici-Reader", "r.jina.ai");
    res.setHeader("X-Medici-Upstream-Status", String(upstream.status));
    [
      "cache-control",
      "content-type",
      "etag",
      "last-modified"
    ].forEach(function (header) {
      var value = upstream.headers.get(header);
      if (value) {
        res.setHeader(header, value);
      }
    });

    res.writeHead(upstream.status);
    if (req.method === "HEAD" || !upstream.body) {
      res.end();
      return;
    }

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    send(req, res, 502, "Reader fetch failed: " + error.message);
  }
}

const server = http.createServer(async function (req, res) {
  var url = new URL(req.url || "/", "http://" + req.headers.host);

  if (req.method === "OPTIONS") {
    setCors(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(req, res, 405, "Method not allowed");
    return;
  }

  if (url.pathname === "/__medici__/health") {
    send(req, res, 200, JSON.stringify({ ok: true, version: 3, features: helperFeatures }), "application/json; charset=utf-8");
    return;
  }

  if (url.pathname === "/__medici__/proxy") {
    await serveProxy(req, res, url);
    return;
  }

  if (url.pathname === "/__medici__/reader") {
    await serveReader(req, res, url);
    return;
  }

  await serveStatic(req, res, url);
});

server.on("error", async function (error) {
  if (error.code === "EADDRINUSE") {
    var runningHelper = await getRunningHelperStatus();
    if (runningHelper) {
      var runningFeatures = Array.isArray(runningHelper.features) ? runningHelper.features : [];
      var hasCurrentFeatures = helperFeatures.every(function (feature) {
        return runningFeatures.indexOf(feature) !== -1;
      });
      if (hasCurrentFeatures) {
        console.log("Medici helper is already running at " + origin + "/medici.html");
        console.log("Open that URL instead of starting a second helper.");
      } else {
        console.log("An older Medici helper is already running at " + origin + "/medici.html");
        console.log("Stop that process with Ctrl-C, then run this command again.");
        console.log("Or start the updated helper on another port with: MEDICI_PORT=8788 node scripts/medici-helper.mjs");
      }
      process.exit(0);
    }

    console.error("Port " + port + " is already in use on " + host + ".");
    console.error("Start Medici on another port with: MEDICI_PORT=8788 node scripts/medici-helper.mjs");
    process.exit(1);
  }

  console.error("Medici helper failed to start: " + error.message);
  process.exit(1);
});

server.listen(port, host, function () {
  console.log("Medici helper running at " + origin + "/medici.html");
});
