(function () {
  "use strict";

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
  var root = document.querySelector("[data-medici]");
  if (!root) {
    return;
  }

  var MAX_CANVAS_SIDE = 32767;
  var MAX_CANVAS_PIXELS = 120000000;
  var MAX_SCAN_CANDIDATES = 16;
  var DEFAULT_IIIF_TILE_SIZE = 1024;
  var HELPER_PATH = "/__medici__";
  var DEFAULT_HELPER_ORIGIN = "http://127.0.0.1:8787";
  var helperNoticeShown = false;

  var els = {
    form: document.getElementById("medici-form"),
    source: document.getElementById("medici-source"),
    mode: document.getElementById("medici-mode"),
    scale: document.getElementById("medici-scale"),
    workers: document.getElementById("medici-workers"),
    width: document.getElementById("medici-width"),
    height: document.getElementById("medici-height"),
    tileWidth: document.getElementById("medici-tile-width"),
    tileHeight: document.getElementById("medici-tile-height"),
    cols: document.getElementById("medici-cols"),
    rows: document.getElementById("medici-rows"),
    level: document.getElementById("medici-level"),
    origin: document.getElementById("medici-origin"),
    overlap: document.getElementById("medici-overlap"),
    tileGroup: document.getElementById("medici-tile-group"),
    output: document.getElementById("medici-output"),
    quality: document.getElementById("medici-quality"),
    fallback: document.getElementById("medici-fallback"),
    analyze: document.getElementById("medici-analyze"),
    assemble: document.getElementById("medici-assemble"),
    stop: document.getElementById("medici-stop"),
    status: document.getElementById("medici-status"),
    alert: document.getElementById("medici-alert"),
    stats: document.getElementById("medici-stats"),
    detected: document.getElementById("medici-detected"),
    size: document.getElementById("medici-size"),
    tiles: document.getElementById("medici-tiles"),
    memory: document.getElementById("medici-memory"),
    progressWrap: document.getElementById("medici-progress-wrap"),
    progressBar: document.getElementById("medici-progress-bar"),
    progressText: document.getElementById("medici-progress-text"),
    preview: document.getElementById("medici-preview"),
    canvas: document.getElementById("medici-canvas"),
    outputActions: document.getElementById("medici-output-actions"),
    download: document.getElementById("medici-download"),
    downloadSize: document.getElementById("medici-download-size"),
    copy: document.getElementById("medici-copy"),
    details: document.getElementById("medici-details"),
    log: document.getElementById("medici-log")
  };

  var activePlan = null;
  var activeController = null;
  var activeDownloadUrl = null;
  var logLines = ["Ready."];

  function setWorking(isWorking) {
    els.analyze.disabled = isWorking;
    if (els.assemble) {
      els.assemble.disabled = isWorking || !activePlan;
    }
    if (els.stop) {
      els.stop.disabled = !isWorking;
    }
    if (els.copy) {
      els.copy.disabled = !activePlan;
    }
  }

  function setVisible(element, visible) {
    if (element) {
      element.hidden = !visible;
    }
  }

  function showAlert(message, tone, showDetails) {
    setVisible(els.status, true);
    els.alert.hidden = false;
    els.alert.textContent = message;
    els.alert.dataset.tone = tone || "neutral";
    if (tone === "warning" && showDetails !== false) {
      setVisible(els.details, true);
    }
  }

  function clearAlert() {
    els.alert.hidden = true;
    els.alert.textContent = "";
    delete els.alert.dataset.tone;
  }

  function writeLog(message) {
    var stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    logLines.push(stamp + "  " + message);
    if (logLines.length > 80) {
      logLines = logLines.slice(logLines.length - 80);
    }
    els.log.textContent = logLines.join("\n");
    els.log.scrollTop = els.log.scrollHeight;
  }

  function resetLog(message) {
    logLines = [message || "Ready."];
    els.log.textContent = logLines.join("\n");
  }

  function readNumber(input, fallback) {
    if (!input) {
      return fallback;
    }
    var value = Number(input.value);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function readInteger(input, fallback) {
    if (!input) {
      return fallback;
    }
    var value = Math.floor(Number(input.value));
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function getMode() {
    return els.mode ? els.mode.value : "auto";
  }

  function getOutputType() {
    return els.output ? els.output.value : "image/png";
  }

  function getQuality() {
    return els.quality ? Number(els.quality.value) || 0.92 : 0.92;
  }

  function getWorkerCount(total) {
    return Math.max(1, Math.min(12, Math.floor(els.workers ? Number(els.workers.value) || 8 : 8), total));
  }

  function shouldUseFallbackPreview() {
    return !els.fallback || els.fallback.checked;
  }

  function formatNumber(value) {
    return Math.round(value).toLocaleString();
  }

  function formatBytes(bytes) {
    var units = ["B", "KB", "MB", "GB"];
    var value = bytes;
    var index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return (index === 0 ? String(value) : value.toFixed(value >= 10 ? 1 : 2)) + " " + units[index];
  }

  function formatCompactBytes(bytes) {
    return formatBytes(bytes).replace(/\s+/g, "");
  }

  function waitForPaint() {
    return new Promise(function (resolve) {
      if (document.visibilityState === "hidden") {
        setTimeout(resolve, 0);
        return;
      }
      requestAnimationFrame(function () {
        requestAnimationFrame(resolve);
      });
    });
  }

  function setProgress(done, total, label) {
    var percent = total ? Math.min(100, Math.max(0, (done / total) * 100)) : 0;
    els.progressBar.style.width = percent + "%";
    els.progressText.textContent = label || (total ? formatNumber(done) + " / " + formatNumber(total) : "Idle");
  }

  function clearDownloadPreparing() {
    els.download.removeAttribute("aria-busy");
  }

  function showDownloadPreparing() {
    if (!els.downloadSize) {
      return;
    }
    setVisible(els.outputActions, true);
    els.download.href = "#";
    els.download.removeAttribute("download");
    els.download.setAttribute("aria-disabled", "true");
    els.download.setAttribute("aria-busy", "true");
    els.downloadSize.textContent = "";
    els.downloadSize.hidden = true;
  }

  function revokeDownload() {
    if (activeDownloadUrl) {
      URL.revokeObjectURL(activeDownloadUrl);
      activeDownloadUrl = null;
    }
    clearDownloadPreparing();
    setVisible(els.outputActions, false);
    els.download.href = "#";
    els.download.removeAttribute("download");
    els.download.setAttribute("aria-disabled", "true");
    if (els.downloadSize) {
      els.downloadSize.textContent = "";
      els.downloadSize.hidden = true;
    }
  }

  function enableDownload(blob, plan) {
    revokeDownload();
    activeDownloadUrl = URL.createObjectURL(blob);
    els.download.href = activeDownloadUrl;
    els.download.download = getFileName(plan) + getExtension(getOutputType());
    els.download.setAttribute("aria-disabled", "false");
    setVisible(els.outputActions, true);
    if (els.downloadSize) {
      els.downloadSize.textContent = formatCompactBytes(blob.size);
      els.downloadSize.hidden = false;
    }
  }

  function getExtension(mimeType) {
    if (mimeType === "image/jpeg") {
      return ".jpg";
    }
    if (mimeType === "image/webp") {
      return ".webp";
    }
    return ".png";
  }

  function getFileName(plan) {
    var name = plan.name || "medici";
    return name.toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "medici";
  }

  function normalizeSource(value) {
    return value.trim().replace(/&amp;/g, "&");
  }

  function absoluteUrl(value, baseUrl) {
    var cleaned = String(value || "")
      .trim()
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    if (!cleaned || cleaned.indexOf("data:") === 0) {
      return cleaned;
    }

    return new URL(cleaned, baseUrl || window.location.href).href;
  }

  function removeQueryAndHash(url) {
    return url.split("#")[0].split("?")[0];
  }

  function dirname(url) {
    var clean = removeQueryAndHash(url);
    return clean.slice(0, clean.lastIndexOf("/") + 1);
  }

  function looksLikeTemplate(source) {
    return /\{(?:x|y|row|col|quadkey|tilegroup|tileindex)/i.test(source);
  }

  function looksLikeImage(source) {
    return /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(source);
  }

  function parseXml(text, label) {
    var doc = new DOMParser().parseFromString(text, "application/xml");
    var error = doc.querySelector("parsererror");
    if (error) {
      throw new Error("Could not parse " + label + ".");
    }
    return doc;
  }

  function getHelperOrigin() {
    if (window.MEDICI_HELPER_ORIGIN) {
      return String(window.MEDICI_HELPER_ORIGIN).replace(/\/$/, "");
    }
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
      return window.location.origin;
    }
    return DEFAULT_HELPER_ORIGIN;
  }

  function helperMissingMessage(label) {
    if (window.location.protocol === "file:") {
      return label + " needs the local Medici helper. Start it with: node scripts/medici-helper.mjs";
    }
    return label + " needs the Medici helper endpoint at " + getHelperOrigin() + HELPER_PATH + ". This production deployment is missing it.";
  }

  function proxyUrl(url) {
    return getHelperOrigin() + HELPER_PATH + "/proxy?url=" + encodeURIComponent(absoluteUrl(url));
  }

  function readerUrl(url) {
    return getHelperOrigin() + HELPER_PATH + "/reader?url=" + encodeURIComponent(absoluteUrl(url));
  }

  function isHelperUrl(url) {
    try {
      var parsed = new URL(url, window.location.href);
      return parsed.origin === getHelperOrigin() && parsed.pathname.indexOf(HELPER_PATH + "/") === 0;
    } catch (_error) {
      return false;
    }
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
    return /^(?:fc|fd|fe80):/i.test(host);
  }

  function canUseExternalReader(url) {
    try {
      var parsed = new URL(url, window.location.href);
      return (parsed.protocol === "http:" || parsed.protocol === "https:") && !isPrivateHostname(parsed.hostname);
    } catch (_error) {
      return false;
    }
  }

  function noteHelperUse() {
    if (!helperNoticeShown) {
      helperNoticeShown = true;
      writeLog("Using Medici helper for browser-blocked requests.");
    }
  }

  async function fetchResource(url, signal, label) {
    var normalized = absoluteUrl(url);
    try {
      var response = await fetch(normalized, { signal: signal, mode: "cors" });
      if (!response.ok) {
        throw new Error((label || "Request") + " failed with " + response.status + " for " + normalized);
      }
      return response;
    } catch (browserError) {
      if (isHelperUrl(normalized)) {
        throw browserError;
      }

      try {
        var proxied = await fetch(proxyUrl(normalized), { signal: signal, mode: "cors" });
        if (!proxied.ok) {
          var helperBody = "";
          try {
            helperBody = (await proxied.text()).replace(/\s+/g, " ").trim().slice(0, 180);
          } catch (_readError) {
            helperBody = "";
          }
          throw new Error("Medici helper request failed with " + proxied.status + (helperBody ? ": " + helperBody : ""));
        }
        if (!proxied.headers.get("x-medici-upstream-status")) {
          throw new Error("Medici helper endpoint did not handle the proxy request.");
        }
        noteHelperUse();
        return proxied;
      } catch (helperError) {
        var browserMessage = String(browserError && browserError.message || browserError);
        var helperMessage = String(helperError && helperError.message || helperError);
        if (/Failed to fetch|NetworkError|Load failed/i.test(browserMessage)) {
          if (/Failed to fetch|NetworkError|Load failed/i.test(helperMessage)) {
            throw new Error(helperMissingMessage("The browser could not fetch that source"));
          }
          throw new Error("The browser could not fetch that source, and the Medici helper could not fetch it either. " + helperMessage);
        }
        throw browserError;
      }
    }
  }

  async function fetchText(url, signal) {
    var response = await fetchResource(url, signal, "Request");
    if (!response.ok) {
      throw new Error("Request failed with " + response.status + " for " + url);
    }
    return {
      text: await response.text(),
      contentType: response.headers.get("content-type") || ""
    };
  }

  async function fetchReaderText(url, signal) {
    writeLog("Trying reader-rendered page fallback.");
    try {
      var response = await fetchResource(readerUrl(url), signal, "Reader fallback");
      return {
        text: await response.text(),
        contentType: response.headers.get("content-type") || ""
      };
    } catch (error) {
      var message = error && error.message ? error.message : String(error);
      if (/failed with 404|request failed with 404|(?:Local|Medici) helper request failed with 404/i.test(message)) {
        throw new Error("The Medici helper is running, but it needs to be updated to enable the reader fallback.");
      }
      if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
        throw new Error(helperMissingMessage("The reader fallback"));
      }
      throw error;
    }
  }

  async function getHelperStatus(signal) {
    var response;
    try {
      response = await fetch(getHelperOrigin() + HELPER_PATH + "/health", { signal: signal, mode: "cors" });
    } catch (_error) {
      return null;
    }
    if (!response.ok) {
      return null;
    }
    try {
      return await response.json();
    } catch (_error) {
      return null;
    }
  }

  async function requireHelperFeature(feature, label, signal) {
    var status = await getHelperStatus(signal);
    var features = status && Array.isArray(status.features) ? status.features : [];
    if (features.indexOf(feature) !== -1) {
      return;
    }
    if (status && status.ok) {
      throw new Error("The Medici helper is running, but it is too old for " + label + ". Update the helper and redeploy.");
    }
    throw new Error(helperMissingMessage(label));
  }

  async function analyze() {
    var source = normalizeSource(els.source.value);
    if (!source) {
      setVisible(els.status, true);
      setVisible(els.stats, false);
      setVisible(els.progressWrap, false);
      setVisible(els.preview, false);
      setVisible(els.outputActions, false);
      setVisible(els.details, false);
      showAlert("Paste a source URL or tile template first.", "warning", false);
      return;
    }

    if (activeController) {
      activeController.abort();
    }

    activeController = new AbortController();
    activePlan = null;
    clearAlert();
    revokeDownload();
    resetLog("Analyzing source.");
    helperNoticeShown = false;
    setVisible(els.status, true);
    setVisible(els.stats, false);
    setVisible(els.progressWrap, true);
    setVisible(els.preview, false);
    setVisible(els.outputActions, false);
    setVisible(els.details, false);
    setProgress(0, 0, "Analyzing");
    setWorking(true);
    renderEmptyPlan();

    try {
      activePlan = await detectPlan(source, getMode(), activeController.signal, []);
      renderPlan(activePlan);
      setProgress(0, activePlan.tiles.length, "Ready");
      writeLog("Detected " + activePlan.type + " at " + formatNumber(activePlan.width) + " x " + formatNumber(activePlan.height) + ".");
      if (activePlan.note) {
        showAlert(activePlan.note, "neutral");
      }
      return activePlan;
    } catch (error) {
      if (error.name !== "AbortError") {
        showAlert(toFriendlyError(error), "warning");
        writeLog(toFriendlyError(error));
      }
      setProgress(0, 0, error.name === "AbortError" ? "Stopped" : "Failed");
      return null;
    } finally {
      activeController = null;
      setWorking(false);
    }
  }

  async function detectPlan(source, mode, signal, seen) {
    var normalized = normalizeSource(source);
    var key = mode + ":" + normalized;
    if (seen.indexOf(key) !== -1) {
      throw new Error("Source detection looped on " + normalized);
    }
    seen.push(key);

    if (mode === "template" || (mode === "auto" && looksLikeTemplate(normalized))) {
      return planFromTemplate(normalized);
    }
    if (mode === "iiif") {
      return planFromIiif(normalized, signal);
    }
    if (mode === "deepzoom") {
      return planFromDeepZoom(normalized, signal);
    }
    if (mode === "zoomify") {
      return planFromZoomify(normalized, signal);
    }
    if (mode === "image") {
      return planFromImage(normalized, signal);
    }

    if (isArticArtworkUrl(normalized)) {
      return planFromArticArtwork(normalized, signal);
    }
    if (isGoogleArtsUrl(normalized)) {
      return planFromGoogleArts(normalized, signal);
    }
    if (/\/info\.json(?:[?#].*)?$/i.test(normalized)) {
      return planFromIiif(normalized, signal);
    }
    if (/\.dzi(?:[?#].*)?$/i.test(normalized)) {
      return planFromDeepZoom(normalized, signal);
    }
    if (/ImageProperties\.xml(?:[?#].*)?$/i.test(normalized)) {
      return planFromZoomify(normalized, signal);
    }
    if (looksLikeImage(normalized)) {
      return planFromImage(normalized, signal);
    }

    try {
      return await planFromScannedSource(normalized, signal, seen);
    } catch (scanError) {
      try {
        return await planFromZoomify(normalized, signal);
      } catch (_zoomifyError) {
        throw scanError;
      }
    }
  }

  async function planFromScannedSource(url, signal, seen) {
    writeLog("Scanning page or manifest.");
    var scanError = null;
    var readerFailure = null;

    try {
      return await planFromScannedResponse(url, await fetchText(url, signal), signal, seen);
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
      scanError = error;
      writeLog("Direct scan failed: " + (error && error.message ? error.message : String(error)));
    }

    if (canUseExternalReader(url)) {
      try {
        return await planFromScannedResponse(url, await fetchReaderText(url, signal), signal, seen);
      } catch (readerError) {
        if (readerError.name === "AbortError") {
          throw readerError;
        }
        readerFailure = readerError;
        writeLog("Reader fallback failed: " + (readerError && readerError.message ? readerError.message : String(readerError)));
      }
    }

    if (readerFailure && /reader fallback needs|needs to be restarted/i.test(String(readerFailure.message || readerFailure))) {
      throw readerFailure;
    }

    throw scanError || new Error("No tile manifest found. Use Template mode for sources with custom URL patterns.");
  }

  async function planFromScannedResponse(url, response, signal, seen) {
    var text = response.text.trim();
    var contentType = response.contentType.toLowerCase();

    if (looksLikeChallengePage(text)) {
      throw new Error("The source returned a bot-protection challenge instead of the page.");
    }

    if (contentType.indexOf("json") !== -1 || text.charAt(0) === "{") {
      try {
        var data = JSON.parse(text);
        if (looksLikeIiifInfo(data)) {
          return planFromIiifData(data, url);
        }
        if (looksLikeArticArtwork(data)) {
          return planFromArticArtworkData(data, signal);
        }
        if (looksLikeArticImage(data)) {
          return planFromArticImageData(data);
        }
        if (looksLikeIiifPresentation(data)) {
          return planFromIiifPresentationData(data, url);
        }
        var jsonCandidate = findCandidateInJson(data, url);
        if (jsonCandidate) {
          return detectPlan(jsonCandidate.url, jsonCandidate.mode, signal, seen);
        }
      } catch (_error) {
        // Fall through to text scanning.
      }
    }

    if (text.charAt(0) === "<") {
      if (/<ImageProperties\b/i.test(text)) {
        return planFromZoomifyXml(text, url);
      }
      if (/<Image\b/i.test(text) && /TileSize/i.test(text)) {
        return planFromDeepZoomXml(text, url);
      }
    }

    var candidates = extractCandidates(text, url);
    if (!candidates.length) {
      throw new Error("No tile manifest found. Use Template mode for sources with custom URL patterns.");
    }

    writeLog("Found " + candidates.length + " candidate" + (candidates.length === 1 ? "" : "s") + ".");
    for (var i = 0; i < candidates.length && i < MAX_SCAN_CANDIDATES; i += 1) {
      try {
        writeLog("Trying " + candidates[i].mode + ": " + candidates[i].url);
        return await detectPlan(candidates[i].url, candidates[i].mode, signal, seen.slice());
      } catch (error) {
        writeLog("Skipped candidate: " + error.message);
      }
    }

    throw new Error("Found candidates, but none could be loaded from this browser.");
  }

  function looksLikeChallengePage(text) {
    var content = String(text || "");
    if (/media\.britishmuseum\.org|iiif|openseadragon|\.dzi|ImageProperties\.xml|lh3\.googleusercontent|zoomifyImagePath/i.test(content)) {
      return false;
    }
    var sample = content.slice(0, 60000);
    return /cf-mitigated|challenges\.cloudflare\.com|<title>\s*Just a moment|security verification|enable JavaScript and cookies/i.test(sample);
  }

  function looksLikeIiifInfo(data) {
    return data && typeof data === "object" &&
      Number.isFinite(Number(data.width)) &&
      Number.isFinite(Number(data.height)) &&
      (data.tiles || data.id || data["@id"] || String(data["@context"] || "").indexOf("iiif") !== -1);
  }

  function findCandidateInJson(value, baseUrl) {
    var stack = [value];
    var visited = 0;

    while (stack.length && visited < 2000) {
      var current = stack.shift();
      visited += 1;

      if (typeof current === "string") {
        var expanded = expandCandidateValues(current, baseUrl);
        for (var i = 0; i < expanded.length; i += 1) {
          var candidate = classifyCandidate(expanded[i], baseUrl);
          if (candidate) {
            return candidate;
          }
        }
      } else if (current && typeof current === "object") {
        Object.keys(current).forEach(function (key) {
          stack.push(current[key]);
        });
      }
    }

    return null;
  }

  function extractCandidates(text, baseUrl) {
    var values = [];
    var quoted = /["']([^"']{4,1200})["']/g;
    var rawUrl = /\b(?:https?:)?\/\/[^\s"'<>\\]+/g;
    var zoomifyPath = /zoomifyImagePath\s*[:=]\s*["']([^"']+)["']/gi;
    var match;

    while ((match = quoted.exec(text))) {
      values.push(match[1]);
    }
    while ((match = rawUrl.exec(text))) {
      values.push(match[0]);
    }
    while ((match = zoomifyPath.exec(text))) {
      values.push(match[1]);
    }

    var seen = Object.create(null);
    var candidates = [];

    values.forEach(function (value) {
      expandCandidateValues(value, baseUrl).forEach(function (expandedValue) {
        var candidate = classifyCandidate(expandedValue, baseUrl);
        if (candidate && !seen[candidate.mode + candidate.url]) {
          seen[candidate.mode + candidate.url] = true;
          candidates.push(candidate);
        }
      });
    });

    return candidates.sort(function (a, b) {
      return (b.priority || 0) - (a.priority || 0);
    });
  }

  function expandCandidateValues(value, baseUrl) {
    var values = [value];

    try {
      var absolute = absoluteUrl(value, baseUrl);
      [
        inferBritishMuseumSizedImageUrl(absolute, "large"),
        britishMuseumHttpMirrorUrl(inferBritishMuseumSizedImageUrl(absolute, "large")),
        inferBritishMuseumOriginalImageUrl(absolute),
        britishMuseumHttpMirrorUrl(inferBritishMuseumOriginalImageUrl(absolute))
      ].forEach(function (candidate) {
        if (candidate && values.indexOf(candidate) === -1) {
          values.push(candidate);
        }
      });
    } catch (_error) {
      // Keep the original value; classification will discard invalid URLs.
    }

    return values;
  }

  function britishMuseumHttpMirrorUrl(url) {
    if (!url) {
      return null;
    }
    try {
      var parsed = new URL(url);
      if (parsed.protocol !== "https:" || !/media\.britishmuseum\.org$/i.test(parsed.hostname)) {
        return null;
      }
      parsed.protocol = "http:";
      return parsed.href;
    } catch (_error) {
      return null;
    }
  }

  function inferBritishMuseumOriginalImageUrl(url) {
    try {
      var parsed = new URL(url);
      if (!/media\.britishmuseum\.org$/i.test(parsed.hostname)) {
        return null;
      }
      var pathname = parsed.pathname.replace(/\/(?:preview|mid|large)_([^/]+\.(?:avif|gif|jpe?g|png|webp))$/i, "/$1");
      if (pathname === parsed.pathname) {
        return null;
      }
      parsed.protocol = "https:";
      parsed.pathname = pathname;
      parsed.search = "";
      parsed.hash = "";
      return parsed.href;
    } catch (_error) {
      return null;
    }
  }

  function inferBritishMuseumSizedImageUrl(url, size) {
    try {
      var parsed = new URL(url);
      if (!/media\.britishmuseum\.org$/i.test(parsed.hostname)) {
        return null;
      }
      var match = parsed.pathname.match(/^(.*\/)(?:(?:preview|mid|large)_)?([^/]+\.(?:avif|gif|jpe?g|png|webp))$/i);
      if (!match) {
        return null;
      }
      parsed.protocol = "https:";
      parsed.pathname = match[1] + size + "_" + match[2];
      parsed.search = "";
      parsed.hash = "";
      return parsed.href;
    } catch (_error) {
      return null;
    }
  }

  function inferFullImageFromIiifUrl(url) {
    var parsed = new URL(url);
    var parts = parsed.pathname.split("/").filter(Boolean);
    var iiifIndex = parts.indexOf("iiif");

    if (parsed.hostname === "iiif.micr.io" && parts.length >= 5) {
      return parsed.origin + "/" + parts[0] + "/full/max/0/default.jpg";
    }

    if (iiifIndex !== -1 && parts[iiifIndex + 1] === "2" && parts.length >= iiifIndex + 6) {
      return parsed.origin + "/" + parts.slice(0, iiifIndex + 3).join("/") + "/full/max/0/default.jpg";
    }

    return null;
  }

  function inferIiifInfoFromImageUrl(url) {
    var parsed = new URL(url);
    var parts = parsed.pathname.split("/").filter(Boolean);
    var iiifIndex = parts.indexOf("iiif");

    if (parsed.hostname === "iiif.micr.io" && parts.length >= 5) {
      return parsed.origin + "/" + parts[0] + "/info.json";
    }

    if (iiifIndex !== -1 && parts[iiifIndex + 1] === "2" && parts.length >= iiifIndex + 6) {
      return parsed.origin + "/" + parts.slice(0, iiifIndex + 3).join("/") + "/info.json";
    }

    return null;
  }

  function normalizeGoogleusercontentUrl(url) {
    var parsed = new URL(url);
    if (!/googleusercontent\.com$/i.test(parsed.hostname) || parsed.pathname.indexOf("/ci/") !== 0) {
      return null;
    }
    return parsed.origin + parsed.pathname + "=s0";
  }

  function imageCandidatePriority(url) {
    try {
      var parsed = new URL(url);
      if (/media\.britishmuseum\.org$/i.test(parsed.hostname)) {
        if (/\/preview_[^/]+\.(?:avif|gif|jpe?g|png|webp)$/i.test(parsed.pathname)) {
          return 20;
        }
        if (/\/mid_[^/]+\.(?:avif|gif|jpe?g|png|webp)$/i.test(parsed.pathname)) {
          return 45;
        }
        if (/\/large_[^/]+\.(?:avif|gif|jpe?g|png|webp)$/i.test(parsed.pathname)) {
          return 70;
        }
        return 85;
      }
    } catch (_error) {
      // Use the generic image priority below.
    }

    return 10;
  }

  function classifyCandidate(value, baseUrl) {
    var cleaned = String(value || "")
      .replace(/\\u002f/gi, "/")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&")
      .trim();

    if (!cleaned || cleaned.indexOf("data:") === 0 || cleaned.indexOf("blob:") === 0) {
      return null;
    }

    try {
      var absolute = absoluteUrl(cleaned, baseUrl);
      var iiifInfo = inferIiifInfoFromImageUrl(absolute);
      if (iiifInfo) {
        return { mode: "iiif", url: iiifInfo, priority: 100 };
      }
      var fullIiifImage = inferFullImageFromIiifUrl(absolute);
      if (fullIiifImage) {
        return { mode: "image", url: fullIiifImage, priority: 90 };
      }
      var googleImage = normalizeGoogleusercontentUrl(absolute);
      if (googleImage) {
        return { mode: "image", url: googleImage, priority: 40 };
      }
      if (/info\.json(?:[?#].*)?$/i.test(cleaned)) {
        return { mode: "iiif", url: absolute, priority: 100 };
      }
      if (/\.dzi(?:[?#].*)?$/i.test(cleaned)) {
        return { mode: "deepzoom", url: absolute, priority: 100 };
      }
      if (/ImageProperties\.xml(?:[?#].*)?$/i.test(cleaned)) {
        return { mode: "zoomify", url: absolute, priority: 100 };
      }
      if (/\/TileGroup\d+\/\d+-\d+-\d+\.(?:jpg|jpeg|png|webp)/i.test(cleaned)) {
        return { mode: "zoomify", url: absoluteUrl(cleaned.replace(/\/TileGroup\d+\/.*$/i, "/ImageProperties.xml"), baseUrl), priority: 95 };
      }
      if (/\/iiif\/2\/[^/]+$/i.test(cleaned)) {
        return { mode: "iiif-service", url: absolute + "/info.json", priority: 100 };
      }
      if (looksLikeImage(cleaned)) {
        return { mode: "image", url: absolute, priority: imageCandidatePriority(absolute) };
      }
    } catch (_error) {
      return null;
    }

    return null;
  }

  function isArticArtworkUrl(url) {
    return /^https?:\/\/(?:www\.)?artic\.edu\/artworks\/\d+(?:[/?#].*)?$/i.test(url) ||
      /^https?:\/\/api\.artic\.edu\/api\/v1\/artworks\/\d+(?:[/?#].*)?$/i.test(url);
  }

  function isGoogleArtsUrl(url) {
    return /^https?:\/\/artsandculture\.google\.com\/asset\//i.test(url);
  }

  async function planFromGoogleArts(url, signal) {
    writeLog("Loading Google Arts tile metadata.");
    await requireHelperFeature("google-arts", "Google Arts & Culture", signal);
    var page = null;
    var pageError = null;

    try {
      page = await fetchText(url, signal);
    } catch (error) {
      pageError = error;
    }

    if (!page && canUseExternalReader(url)) {
      try {
        page = await fetchReaderText(url, signal);
      } catch (readerError) {
        throw pageError || readerError;
      }
    }

    if (!page) {
      throw pageError || new Error("Could not load Google Arts page metadata.");
    }

    var info = parseGoogleArtsPageInfo(page.text, url);
    writeLog("Loading Google Arts tile pyramid.");
    var tileInfoResponse = await fetchText(info.baseUrl + "=g", signal);
    return planFromGoogleArtsTileInfo(info, tileInfoResponse.text);
  }

  function parseGoogleArtsPageInfo(text, url) {
    var source = String(text || "")
      .replace(/\\u003d/g, "=")
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/");
    var match = /\]\s*,\s*"((?:https?:)?\/\/(?:lh\d+\.)?(?:googleusercontent\.com|ggpht\.com)\/[a-zA-Z0-9./_-]+)"\s*,\s*(?:"([^"]*)"|null)/.exec(source);
    var fallback = /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i.exec(source);

    if (!match && !fallback) {
      throw new Error("Could not find Google Arts image metadata.");
    }

    var baseUrl = absoluteUrl(match ? match[1] : fallback[1], url).replace(/(?:=[^/?#]*)?$/, "");
    var token = match && match[2] ? match[2] : "";
    var title = decodeHtmlText(
      (/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i.exec(source) || [null, ""])[1] ||
      (/<title>([^<]+)<\/title>/i.exec(source) || [null, ""])[1] ||
      nameFromUrl(url, "google-arts")
    );

    return {
      baseUrl: baseUrl,
      name: title.replace(/\s+-\s+Google Arts.*$/i, "").trim() || "Google Arts and Culture Image",
      token: token
    };
  }

  function decodeHtmlText(value) {
    var textarea = document.createElement("textarea");
    textarea.innerHTML = String(value || "");
    return textarea.value;
  }

  function planFromGoogleArtsTileInfo(info, text) {
    var doc = parseXml(text, "Google Arts tile metadata");
    var root = doc.querySelector("TileInfo");
    if (!root) {
      throw new Error("This does not look like Google Arts tile metadata.");
    }

    var tileWidth = Math.max(1, Math.floor(Number(root.getAttribute("tile_width")) || 512));
    var tileHeight = Math.max(1, Math.floor(Number(root.getAttribute("tile_height")) || tileWidth));
    var levels = Array.prototype.slice.call(root.querySelectorAll("pyramid_level"));
    if (!levels.length) {
      throw new Error("Google Arts tile metadata did not include pyramid levels.");
    }

    var level = levels[levels.length - 1];
    var z = levels.length - 1;
    var cols = Math.max(1, Math.floor(Number(level.getAttribute("num_tiles_x")) || 1));
    var rows = Math.max(1, Math.floor(Number(level.getAttribute("num_tiles_y")) || 1));
    var emptyX = Math.max(0, Math.floor(Number(level.getAttribute("empty_pels_x")) || 0));
    var emptyY = Math.max(0, Math.floor(Number(level.getAttribute("empty_pels_y")) || 0));
    var width = cols * tileWidth - emptyX;
    var height = rows * tileHeight - emptyY;
    var tiles = [];

    for (var y = 0; y < rows; y += 1) {
      for (var x = 0; x < cols; x += 1) {
        var tileUrl = googleArtsTileUrl(info, x, y, z);
        var dx = x * tileWidth;
        var dy = y * tileHeight;
        tiles.push({
          url: tileUrl,
          fetchUrl: proxyUrl(tileUrl),
          dx: dx,
          dy: dy,
          dw: Math.min(tileWidth, width - dx),
          dh: Math.min(tileHeight, height - dy)
        });
      }
    }

    return {
      type: "Google Arts & Culture",
      source: info.baseUrl,
      name: info.name,
      width: width,
      height: height,
      tiles: tiles,
      note: "Google Arts tiles are decrypted through the Medici helper."
    };
  }

  function googleArtsTileUrl(info, x, y, z) {
    var suffix = "=x" + x + "-y" + y + "-z" + z + "-t";
    return info.baseUrl + suffix + googleArtsSignature(info, suffix);
  }

  function googleArtsSignature(info, suffix) {
    var path = new URL(info.baseUrl).pathname.replace(/^\/+/, "");
    var message = utf8Bytes(path + suffix + (info.token || ""));
    var digest = hmacSha1Bytes([123, 43, 78, 35, 222, 44, 197, 197], message);
    return base64GoogleArts(digest);
  }

  function utf8Bytes(value) {
    if (window.TextEncoder) {
      return Array.prototype.slice.call(new TextEncoder().encode(value));
    }

    var encoded = unescape(encodeURIComponent(value));
    var bytes = [];
    for (var i = 0; i < encoded.length; i += 1) {
      bytes.push(encoded.charCodeAt(i));
    }
    return bytes;
  }

  function base64GoogleArts(bytes) {
    var binary = "";
    for (var i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/[+/]/g, "_").replace(/=+$/g, "");
  }

  function hmacSha1Bytes(key, message) {
    var blockSize = 64;
    var normalizedKey = key.slice();
    if (normalizedKey.length > blockSize) {
      normalizedKey = sha1Bytes(normalizedKey);
    }
    while (normalizedKey.length < blockSize) {
      normalizedKey.push(0);
    }

    var inner = [];
    var outer = [];
    for (var i = 0; i < blockSize; i += 1) {
      inner.push(normalizedKey[i] ^ 0x36);
      outer.push(normalizedKey[i] ^ 0x5c);
    }

    return sha1Bytes(outer.concat(sha1Bytes(inner.concat(message))));
  }

  function sha1Bytes(bytes) {
    var words = [];
    var bitLength = bytes.length * 8;
    var i;

    for (i = 0; i < bytes.length; i += 1) {
      words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << (24 - (i % 4) * 8));
    }
    words[bitLength >> 5] = (words[bitLength >> 5] || 0) | (0x80 << (24 - bitLength % 32));
    words[(((bitLength + 64) >> 9) << 4) + 15] = bitLength;

    var h0 = 0x67452301;
    var h1 = 0xefcdab89;
    var h2 = 0x98badcfe;
    var h3 = 0x10325476;
    var h4 = 0xc3d2e1f0;

    for (i = 0; i < words.length; i += 16) {
      var w = [];
      for (var t = 0; t < 80; t += 1) {
        if (t < 16) {
          w[t] = words[i + t] || 0;
        } else {
          w[t] = rotateLeft(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
        }
      }

      var a = h0;
      var b = h1;
      var c = h2;
      var d = h3;
      var e = h4;

      for (t = 0; t < 80; t += 1) {
        var f;
        var k;
        if (t < 20) {
          f = (b & c) | ((~b) & d);
          k = 0x5a827999;
        } else if (t < 40) {
          f = b ^ c ^ d;
          k = 0x6ed9eba1;
        } else if (t < 60) {
          f = (b & c) | (b & d) | (c & d);
          k = 0x8f1bbcdc;
        } else {
          f = b ^ c ^ d;
          k = 0xca62c1d6;
        }

        var temp = (rotateLeft(a, 5) + f + e + k + w[t]) | 0;
        e = d;
        d = c;
        c = rotateLeft(b, 30);
        b = a;
        a = temp;
      }

      h0 = (h0 + a) | 0;
      h1 = (h1 + b) | 0;
      h2 = (h2 + c) | 0;
      h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0;
    }

    return wordsToBytes([h0, h1, h2, h3, h4]);
  }

  function rotateLeft(value, bits) {
    return (value << bits) | (value >>> (32 - bits));
  }

  function wordsToBytes(words) {
    var bytes = [];
    words.forEach(function (word) {
      bytes.push((word >>> 24) & 255, (word >>> 16) & 255, (word >>> 8) & 255, word & 255);
    });
    return bytes;
  }

  function getArticArtworkId(url) {
    var match = url.match(/\/artworks\/(\d+)/i);
    return match ? match[1] : null;
  }

  async function planFromArticArtwork(url, signal) {
    var id = getArticArtworkId(url);
    if (!id) {
      throw new Error("Could not read the Art Institute artwork id.");
    }

    writeLog("Loading Art Institute artwork metadata.");
    var apiUrl = "https://api.artic.edu/api/v1/artworks/" + id + "?fields=id,title,image_id";
    var response = await fetchText(apiUrl, signal);
    return planFromArticArtworkData(JSON.parse(response.text), signal);
  }

  async function planFromArticArtworkData(data, signal) {
    var artwork = data && data.data ? data.data : data;
    var imageId = artwork && artwork.image_id;
    if (!imageId) {
      throw new Error("This Art Institute artwork does not expose an image id.");
    }

    writeLog("Loading Art Institute image dimensions.");
    var imageUrl = "https://api.artic.edu/api/v1/images/" + encodeURIComponent(imageId) + "?fields=id,title,width,height,iiif_url";
    var response = await fetchText(imageUrl, signal);
    var imageData = JSON.parse(response.text);
    if (data && data.data && data.data.title && imageData && imageData.data) {
      imageData.data.title = data.data.title;
    }
    return planFromArticImageData(imageData);
  }

  function looksLikeArticArtwork(data) {
    return data && data.data && data.data.image_id &&
      (data.config && data.config.iiif_url || /^https?:\/\/api\.artic\.edu\//i.test(String(data.data.api_link || "")));
  }

  function looksLikeArticImage(data) {
    return data && data.data && data.data.id &&
      Number.isFinite(Number(data.data.width)) &&
      Number.isFinite(Number(data.data.height)) &&
      data.config && data.config.iiif_url;
  }

  function planFromArticImageData(data) {
    if (!looksLikeArticImage(data)) {
      throw new Error("This does not look like Art Institute image metadata.");
    }

    var image = data.data;
    var base = (data.config.iiif_url || "https://www.artic.edu/iiif/2").replace(/\/$/, "") + "/" + image.id;
    return planFromIiifService(base, Math.floor(Number(image.width)), Math.floor(Number(image.height)), {
      type: "Art Institute IIIF",
      source: base,
      name: image.title || image.id,
      tileSize: DEFAULT_IIIF_TILE_SIZE,
      format: "jpg"
    });
  }

  function looksLikeIiifPresentation(data) {
    return data && typeof data === "object" &&
      (data["@type"] === "sc:Manifest" || data.type === "Manifest" || Array.isArray(data.items) || Array.isArray(data.sequences));
  }

  function planFromIiifPresentationData(data, url) {
    var canvas = null;
    var resource = null;
    var service = null;

    if (Array.isArray(data.items) && data.items[0]) {
      canvas = data.items[0];
      if (canvas.items && canvas.items[0] && canvas.items[0].items && canvas.items[0].items[0]) {
        resource = canvas.items[0].items[0].body;
      }
    } else if (Array.isArray(data.sequences) && data.sequences[0] && data.sequences[0].canvases && data.sequences[0].canvases[0]) {
      canvas = data.sequences[0].canvases[0];
      if (canvas.images && canvas.images[0]) {
        resource = canvas.images[0].resource;
      }
    }

    if (resource) {
      service = Array.isArray(resource.service) ? resource.service[0] : resource.service;
    }
    if (!service || !(service.id || service["@id"])) {
      throw new Error("The IIIF manifest does not include an image service.");
    }

    return planFromIiifService(service.id || service["@id"], Number(canvas.width || resource.width), Number(canvas.height || resource.height), {
      type: "IIIF Manifest",
      source: url,
      name: data.label && typeof data.label === "string" ? data.label : nameFromUrl(url, "iiif-manifest"),
      tileSize: DEFAULT_IIIF_TILE_SIZE,
      format: "jpg",
      note: "Using manifest canvas dimensions. Use an image API endpoint for native dimensions when available."
    });
  }

  function normalizeIiifBase(base) {
    try {
      var url = new URL(base);
      if (url.hostname === "www.artic.edu" && url.pathname.indexOf("/iiif/2/") === 0) {
        url.hostname = "lakeimagesweb.artic.edu";
      }
      return url.href.replace(/\/$/, "");
    } catch (_error) {
      return String(base).replace(/\/$/, "");
    }
  }

  function planFromIiifService(base, width, height, options) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error("Could not determine IIIF image dimensions.");
    }

    var tileSize = Math.max(1, Math.floor(options.tileSize || DEFAULT_IIIF_TILE_SIZE));
    var cols = Math.ceil(width / tileSize);
    var rows = Math.ceil(height / tileSize);
    var format = options.format || "jpg";
    var tiles = [];
    var cleanBase = normalizeIiifBase(base);

    for (var y = 0; y < rows; y += 1) {
      for (var x = 0; x < cols; x += 1) {
        var rx = x * tileSize;
        var ry = y * tileSize;
        var rw = Math.min(tileSize, width - rx);
        var rh = Math.min(tileSize, height - ry);

        tiles.push({
          url: cleanBase + "/" + [rx, ry, rw, rh].map(Math.round).join(",") + "/" + Math.round(rw) + "," + "/0/default." + format,
          dx: rx,
          dy: ry,
          dw: rw,
          dh: rh
        });
      }
    }

    return {
      type: options.type || "IIIF",
      source: options.source || cleanBase,
      name: options.name || nameFromUrl(cleanBase, "iiif"),
      width: width,
      height: height,
      tiles: tiles,
      note: options.note
    };
  }

  async function planFromIiif(url, signal) {
    writeLog("Loading IIIF info.json.");
    var manifestUrl = absoluteUrl(url);
    if (/\/info\.json(?:[?#].*)?$/i.test(manifestUrl)) {
      manifestUrl = normalizeIiifBase(manifestUrl.replace(/\/info\.json(?:[?#].*)?$/i, "")) + "/info.json";
    }
    var response = await fetchText(manifestUrl, signal);
    var data = JSON.parse(response.text);
    return planFromIiifData(data, manifestUrl);
  }

  function planFromIiifData(data, url) {
    if (!looksLikeIiifInfo(data)) {
      throw new Error("This does not look like IIIF Image API info.");
    }

    var width = Math.floor(Number(data.width));
    var height = Math.floor(Number(data.height));
    var base = normalizeIiifBase(data.id || data["@id"] || url.replace(/\/info\.json(?:[?#].*)?$/i, ""));
    var tilesInfo = Array.isArray(data.tiles) ? data.tiles.slice() : [];
    var preferredFormats = Array.isArray(data.preferredFormats) ? data.preferredFormats : [];
    var format = preferredFormats.indexOf("webp") !== -1 ? "webp" : "jpg";
    var isV3 = String(data["@context"] || "").indexOf("/3/") !== -1 || data.type === "ImageService3";
    var tiles = [];

    if (!tilesInfo.length) {
      tiles.push({
        url: base + "/full/" + (isV3 ? "max" : "full") + "/0/default." + format,
        dx: 0,
        dy: 0,
        dw: width,
        dh: height
      });
    } else {
      tilesInfo.sort(function (a, b) {
        return Number(b.width || 0) - Number(a.width || 0);
      });

      var tileInfo = tilesInfo[0];
      var scaleFactors = Array.isArray(tileInfo.scaleFactors) && tileInfo.scaleFactors.length ? tileInfo.scaleFactors : [1];
      var scaleFactor = Math.min.apply(Math, scaleFactors.map(Number).filter(Number.isFinite));
      if (!Number.isFinite(scaleFactor) || scaleFactor < 1) {
        scaleFactor = 1;
      }

      var tileWidth = Math.max(1, Math.floor(Number(tileInfo.width) || 512));
      var tileHeight = Math.max(1, Math.floor(Number(tileInfo.height) || tileWidth));
      var regionWidth = tileWidth * scaleFactor;
      var regionHeight = tileHeight * scaleFactor;
      var cols = Math.ceil(width / regionWidth);
      var rows = Math.ceil(height / regionHeight);

      for (var y = 0; y < rows; y += 1) {
        for (var x = 0; x < cols; x += 1) {
          var rx = x * regionWidth;
          var ry = y * regionHeight;
          var rw = Math.min(regionWidth, width - rx);
          var rh = Math.min(regionHeight, height - ry);
          var dw = Math.ceil(rw / scaleFactor);
          var dh = Math.ceil(rh / scaleFactor);

          tiles.push({
            url: base + "/" + [rx, ry, rw, rh].map(Math.round).join(",") + "/" + dw + "," + "/0/default." + format,
            dx: Math.round(rx / scaleFactor),
            dy: Math.round(ry / scaleFactor),
            dw: dw,
            dh: dh
          });
        }
      }

      if (scaleFactor !== 1) {
        width = Math.ceil(width / scaleFactor);
        height = Math.ceil(height / scaleFactor);
      }
    }

    return {
      type: "IIIF",
      source: url,
      name: nameFromUrl(url, "iiif"),
      width: width,
      height: height,
      tiles: tiles
    };
  }

  async function planFromDeepZoom(url, signal) {
    writeLog("Loading Deep Zoom descriptor.");
    var response = await fetchText(absoluteUrl(url), signal);
    return planFromDeepZoomXml(response.text, url);
  }

  function planFromDeepZoomXml(text, url) {
    var doc = parseXml(text, "Deep Zoom descriptor");
    var image = doc.querySelector("Image");
    var size = doc.querySelector("Size");
    if (!image || !size) {
      throw new Error("This does not look like a Deep Zoom descriptor.");
    }

    var tileSize = Math.max(1, Math.floor(Number(image.getAttribute("TileSize")) || 256));
    var overlap = Math.max(0, Math.floor(Number(image.getAttribute("Overlap")) || 0));
    var format = image.getAttribute("Format") || "jpg";
    var width = Math.floor(Number(size.getAttribute("Width")));
    var height = Math.floor(Number(size.getAttribute("Height")));
    var level = Math.ceil(Math.log(Math.max(width, height)) / Math.log(2));
    var cols = Math.ceil(width / tileSize);
    var rows = Math.ceil(height / tileSize);
    var cleanUrl = removeQueryAndHash(url);
    var base = cleanUrl.replace(/\.[^/.]+$/i, "_files");
    var tiles = [];

    for (var y = 0; y < rows; y += 1) {
      for (var x = 0; x < cols; x += 1) {
        tiles.push(makeOverlapTile({
          url: base + "/" + level + "/" + x + "_" + y + "." + format,
          x: x,
          y: y,
          cols: cols,
          rows: rows,
          tileWidth: tileSize,
          tileHeight: tileSize,
          width: width,
          height: height,
          overlap: overlap
        }));
      }
    }

    return {
      type: "Deep Zoom",
      source: url,
      name: nameFromUrl(url, "deepzoom"),
      width: width,
      height: height,
      tiles: tiles
    };
  }

  async function planFromZoomify(url, signal) {
    var manifestUrl = /ImageProperties\.xml(?:[?#].*)?$/i.test(url) ?
      absoluteUrl(url) :
      absoluteUrl(url.replace(/\/?$/, "/") + "ImageProperties.xml");

    writeLog("Loading Zoomify ImageProperties.xml.");
    var response = await fetchText(manifestUrl, signal);
    return planFromZoomifyXml(response.text, manifestUrl);
  }

  function planFromZoomifyXml(text, url) {
    var doc = parseXml(text, "Zoomify ImageProperties.xml");
    var image = doc.querySelector("IMAGE_PROPERTIES");
    if (!image) {
      throw new Error("This does not look like Zoomify ImageProperties.xml.");
    }

    var width = Math.floor(Number(image.getAttribute("WIDTH")));
    var height = Math.floor(Number(image.getAttribute("HEIGHT")));
    var tileSize = Math.max(1, Math.floor(Number(image.getAttribute("TILESIZE")) || 256));
    var base = dirname(url).replace(/\/$/, "");
    var tiers = buildZoomifyTiers(width, height, tileSize);
    var fullLevel = tiers.length - 1;
    var fullTier = tiers[fullLevel];
    var priorTiles = 0;
    var tiles = [];

    for (var i = 0; i < fullLevel; i += 1) {
      priorTiles += tiers[i].cols * tiers[i].rows;
    }

    for (var y = 0; y < fullTier.rows; y += 1) {
      for (var x = 0; x < fullTier.cols; x += 1) {
        var tileIndex = priorTiles + y * fullTier.cols + x;
        tiles.push({
          url: base + "/TileGroup" + Math.floor(tileIndex / 256) + "/" + fullLevel + "-" + x + "-" + y + ".jpg",
          dx: x * tileSize,
          dy: y * tileSize,
          dw: Math.min(tileSize, width - x * tileSize),
          dh: Math.min(tileSize, height - y * tileSize)
        });
      }
    }

    return {
      type: "Zoomify",
      source: url,
      name: nameFromUrl(url, "zoomify"),
      width: width,
      height: height,
      tiles: tiles
    };
  }

  function buildZoomifyTiers(width, height, tileSize) {
    var tiers = [];
    var w = width;
    var h = height;

    tiers.push(makeTier(w, h, tileSize));
    while (w > tileSize || h > tileSize) {
      w = Math.ceil(w / 2);
      h = Math.ceil(h / 2);
      tiers.push(makeTier(w, h, tileSize));
    }

    return tiers.reverse();
  }

  function makeTier(width, height, tileSize) {
    return {
      width: width,
      height: height,
      cols: Math.ceil(width / tileSize),
      rows: Math.ceil(height / tileSize)
    };
  }

  async function planFromImage(url, signal) {
    writeLog("Reading image dimensions.");
    var loaded = await loadTileWithFetch(absoluteUrl(url), signal);
    var image = loaded.image;
    var width = image.naturalWidth || image.width;
    var height = image.naturalHeight || image.height;
    cleanupLoadedImage(image);

    if (!width || !height) {
      throw new Error("Could not read image dimensions.");
    }

    return {
      type: "Image",
      source: url,
      name: nameFromUrl(url, "image"),
      width: width,
      height: height,
      tiles: [{
        url: absoluteUrl(url),
        dx: 0,
        dy: 0,
        dw: width,
        dh: height
      }]
    };
  }

  function planFromTemplate(template) {
    var tileWidth = readNumber(els.tileWidth, 256);
    var tileHeight = readNumber(els.tileHeight, tileWidth);
    var width = readNumber(els.width, 0);
    var height = readNumber(els.height, 0);
    var cols = readNumber(els.cols, 0);
    var rows = readNumber(els.rows, 0);
    var level = readInteger(els.level, 0);
    var origin = readInteger(els.origin, 0);
    var overlap = readInteger(els.overlap, 0);
    var tileGroupSize = readNumber(els.tileGroup, 256);
    var tiles = [];

    if (!looksLikeTemplate(template)) {
      throw new Error("Template mode needs placeholders such as {x}, {y}, {z}, or {quadkey}.");
    }
    if (!width && cols) {
      width = cols * tileWidth;
    }
    if (!height && rows) {
      height = rows * tileHeight;
    }
    if (!cols && width) {
      cols = Math.ceil(width / tileWidth);
    }
    if (!rows && height) {
      rows = Math.ceil(height / tileHeight);
    }
    if (!width || !height || !cols || !rows) {
      throw new Error("Template mode needs width and height, or cols and rows.");
    }

    for (var y = 0; y < rows; y += 1) {
      for (var x = 0; x < cols; x += 1) {
        tiles.push(makeOverlapTile({
          url: renderTemplate(template, {
            x: x,
            y: y,
            cols: cols,
            rows: rows,
            level: level,
            origin: origin,
            tileGroupSize: tileGroupSize
          }),
          x: x,
          y: y,
          cols: cols,
          rows: rows,
          tileWidth: tileWidth,
          tileHeight: tileHeight,
          width: width,
          height: height,
          overlap: overlap
        }));
      }
    }

    return {
      type: "Template",
      source: template,
      name: nameFromUrl(template, "template"),
      width: width,
      height: height,
      tiles: tiles
    };
  }

  function makeOverlapTile(options) {
    var dx = options.x * options.tileWidth;
    var dy = options.y * options.tileHeight;
    var dw = Math.min(options.tileWidth, options.width - dx);
    var dh = Math.min(options.tileHeight, options.height - dy);
    var left = options.x === 0 ? 0 : options.overlap;
    var top = options.y === 0 ? 0 : options.overlap;

    return {
      url: options.url,
      dx: dx,
      dy: dy,
      dw: dw,
      dh: dh,
      sx: left,
      sy: top,
      sw: dw,
      sh: dh
    };
  }

  function renderTemplate(template, data) {
    return template.replace(/\{([a-z_]+)(?::(\d+))?\}/gi, function (_match, token, padding) {
      var value = templateValue(token.toLowerCase(), data);
      var text = String(value);
      var width = Number(padding);

      if (Number.isFinite(width) && width > 0) {
        while (text.length < width) {
          text = "0" + text;
        }
      }

      return text;
    });
  }

  function templateValue(token, data) {
    var index = data.y * data.cols + data.x;

    if (token === "x" || token === "col") {
      return data.x + data.origin;
    }
    if (token === "y" || token === "row") {
      return data.y + data.origin;
    }
    if (token === "reversey" || token === "tmsy") {
      return data.rows - 1 - data.y + data.origin;
    }
    if (token === "z" || token === "level" || token === "scale") {
      return data.level;
    }
    if (token === "tilegroup") {
      return Math.floor(index / data.tileGroupSize);
    }
    if (token === "tileindex") {
      return index;
    }
    if (token === "quadkey") {
      return quadKey(data.x, data.y, data.level);
    }

    return "";
  }

  function quadKey(x, y, level) {
    var key = "";
    for (var i = level; i > 0; i -= 1) {
      var digit = 0;
      var mask = 1 << (i - 1);
      if ((x & mask) !== 0) {
        digit += 1;
      }
      if ((y & mask) !== 0) {
        digit += 2;
      }
      key += String(digit);
    }
    return key;
  }

  function nameFromUrl(url, fallback) {
    try {
      var parsed = new URL(url, window.location.href);
      var parts = parsed.pathname.split("/").filter(Boolean);
      var last = parts[parts.length - 1] || parsed.hostname || fallback;
      return last.replace(/\.(?:dzi|xml|json|jpe?g|png|webp|gif|avif)$/i, "") || fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function renderEmptyPlan() {
    els.detected.textContent = "-";
    els.size.textContent = "-";
    els.tiles.textContent = "-";
    els.memory.textContent = "-";
    setVisible(els.stats, false);
    if (els.copy) {
      els.copy.disabled = true;
    }
  }

  function renderPlan(plan) {
    setVisible(els.stats, true);
    els.detected.textContent = plan.type;
    els.size.textContent = formatNumber(plan.width) + " x " + formatNumber(plan.height);
    els.tiles.textContent = formatNumber(plan.tiles.length);
    els.memory.textContent = formatBytes(plan.width * plan.height * 4);
    if (els.copy) {
      els.copy.disabled = false;
    }
    if (els.assemble) {
      els.assemble.disabled = false;
    }
  }

  function getOutputScale(plan) {
    var selected = els.scale ? els.scale.value : "auto";
    if (selected !== "auto") {
      return Number(selected) || 1;
    }

    return Math.min(
      1,
      MAX_CANVAS_SIDE / plan.width,
      MAX_CANVAS_SIDE / plan.height,
      Math.sqrt(MAX_CANVAS_PIXELS / (plan.width * plan.height))
    );
  }

  async function assemble() {
    if (!activePlan) {
      return;
    }

    if (activeController) {
      activeController.abort();
    }

    activeController = new AbortController();
    clearAlert();
    revokeDownload();
    setVisible(els.status, true);
    setVisible(els.preview, true);
    setVisible(els.outputActions, false);
    setWorking(true);

    var plan = activePlan;
    var signal = activeController.signal;
    var scale = getOutputScale(plan);
    var canvas = els.canvas;
    var outputType = getOutputType();
    var ctx = canvas.getContext("2d", { alpha: outputType !== "image/jpeg" });
    var width = Math.max(1, Math.floor(plan.width * scale));
    var height = Math.max(1, Math.floor(plan.height * scale));
    var total = plan.tiles.length;
    var completed = 0;
    var failed = [];
    var tainted = false;
    var fallbackCount = 0;
    var nextIndex = 0;
    var concurrency = getWorkerCount(total);

    canvas.width = width;
    canvas.height = height;
    canvas.style.aspectRatio = plan.width + " / " + plan.height;
    ctx.imageSmoothingEnabled = scale !== 1;
    if (ctx.imageSmoothingEnabled && "imageSmoothingQuality" in ctx) {
      ctx.imageSmoothingQuality = "high";
    }
    if (outputType === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.clearRect(0, 0, width, height);
    }

    setProgress(0, total, "0 / " + formatNumber(total));
    writeLog("Assembling with " + concurrency + " workers" + (scale < 1 ? " at " + Math.round(scale * 100) + "%" : "") + ".");

    async function worker() {
      while (nextIndex < total) {
        var tileIndex = nextIndex;
        nextIndex += 1;

        if (signal.aborted) {
          throw new DOMException("Stopped", "AbortError");
        }

        try {
          var result = await loadTile(plan.tiles[tileIndex].fetchUrl || plan.tiles[tileIndex].url, signal);
          drawTile(ctx, result.image, plan.tiles[tileIndex], scale);
          cleanupLoadedImage(result.image);
          if (!result.clean) {
            tainted = true;
          }
          if (result.fallback) {
            fallbackCount += 1;
          }
        } catch (error) {
          if (error.name === "AbortError") {
            throw error;
          }
          failed.push({ index: tileIndex, error: error });
          if (failed.length <= 8) {
            writeLog("Tile failed: " + plan.tiles[tileIndex].url);
          }
        }

        completed += 1;
        setProgress(completed, total, formatNumber(completed) + " / " + formatNumber(total));
      }
    }

    try {
      var workers = [];
      for (var i = 0; i < concurrency; i += 1) {
        workers.push(worker());
      }
      await Promise.all(workers);

      var messages = [];
      if (failed.length) {
        messages.push(formatNumber(failed.length) + " tile" + (failed.length === 1 ? "" : "s") + " failed. Download disabled.");
      } else if (scale < 1) {
        messages.push("Rendered at " + Math.round(scale * 100) + "% to stay within browser canvas limits.");
      }

      if (fallbackCount) {
        tainted = true;
        messages.push("Browser CORS blocked export for " + formatNumber(fallbackCount) + " tile" + (fallbackCount === 1 ? "" : "s") + ".");
      }

      if (messages.length) {
        showAlert(messages.join(" "), failed.length || fallbackCount ? "warning" : "neutral");
      }

      if (!tainted && !failed.length) {
        setProgress(total, total, "Preparing download");
        showDownloadPreparing();
        await waitForPaint();
        var blob = await canvasToBlob(canvas, outputType, getQuality());
        if (!blob) {
          throw new Error("The browser could not export this canvas.");
        }
        enableDownload(blob, plan);
        writeLog("Download ready: " + formatBytes(blob.size) + ".");
      } else {
        revokeDownload();
        writeLog("Download unavailable because one or more tiles could not be exported.");
      }

      setProgress(total, total, "Done");
    } catch (error) {
      if (error.name === "AbortError") {
        revokeDownload();
        setProgress(completed, total, "Stopped");
        writeLog("Stopped.");
      } else {
        revokeDownload();
        setProgress(completed, total, "Failed");
        showAlert(toFriendlyError(error), "warning");
        writeLog(toFriendlyError(error));
      }
    } finally {
      activeController = null;
      setWorking(false);
    }
  }

  function drawTile(ctx, image, tile, scale) {
    var imageWidth = image.naturalWidth || image.width;
    var imageHeight = image.naturalHeight || image.height;
    var sx = tile.sx || 0;
    var sy = tile.sy || 0;
    var sw = Number.isFinite(Number(tile.sw)) && Number(tile.sw) > 0 ?
      Number(tile.sw) :
      Math.min(Math.ceil(tile.dw), imageWidth - sx);
    var sh = Number.isFinite(Number(tile.sh)) && Number(tile.sh) > 0 ?
      Number(tile.sh) :
      Math.min(Math.ceil(tile.dh), imageHeight - sy);
    var dx = Math.round(tile.dx * scale);
    var dy = Math.round(tile.dy * scale);
    var dw = Math.max(1, Math.ceil(tile.dw * scale));
    var dh = Math.max(1, Math.ceil(tile.dh * scale));

    sw = Math.min(sw, imageWidth - sx);
    sh = Math.min(sh, imageHeight - sy);

    if (sw > 0 && sh > 0) {
      ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
    } else {
      ctx.drawImage(image, dx, dy, dw, dh);
    }
  }

  async function loadTile(url, signal) {
    try {
      return await loadTileWithFetch(url, signal);
    } catch (fetchError) {
      if (!shouldUseFallbackPreview()) {
        throw fetchError;
      }
      var image = await loadImageElement(url, signal, false);
      return { image: image, clean: false, fallback: true };
    }
  }

  async function loadTileWithFetch(url, signal) {
    var response = await fetchResource(url, signal, "Tile request");
    if (!response.ok) {
      throw new Error("Tile request failed with " + response.status);
    }

    var blob = await response.blob();
    if (window.createImageBitmap) {
      return {
        image: await createImageBitmap(blob),
        clean: true,
        fallback: false
      };
    }

    var objectUrl = URL.createObjectURL(blob);
    try {
      return {
        image: await loadImageElement(objectUrl, signal, false),
        clean: true,
        fallback: false
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function loadImageElement(url, signal, useCors) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      var settled = false;

      function finish(callback, value) {
        if (settled) {
          return;
        }
        settled = true;
        if (signal) {
          signal.removeEventListener("abort", abort);
        }
        callback(value);
      }

      function abort() {
        image.src = "";
        finish(reject, new DOMException("Stopped", "AbortError"));
      }

      if (useCors) {
        image.crossOrigin = "anonymous";
      }
      image.decoding = "async";
      image.onload = function () {
        finish(resolve, image);
      };
      image.onerror = function () {
        finish(reject, new Error("Image could not be loaded."));
      };
      if (signal) {
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener("abort", abort, { once: true });
      }
      image.src = url;
    });
  }

  function cleanupLoadedImage(image) {
    if (image && typeof image.close === "function") {
      image.close();
    } else if (image && image.tagName === "IMG") {
      image.src = "";
    }
  }

  function canvasToBlob(canvas, mimeType, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(resolve, mimeType, quality);
    });
  }

  function toFriendlyError(error) {
    if (error && error.name === "AbortError") {
      return "Stopped.";
    }
    var message = error && error.message ? error.message : String(error);
    if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
      return "The browser could not fetch that source. Try a manifest URL, Template mode, or a source with CORS enabled.";
    }
    return message;
  }

  async function copyTiles() {
    if (!activePlan) {
      return;
    }

    var text = activePlan.tiles.map(function (tile) {
      return tile.url;
    }).join("\n");

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        var textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      writeLog("Copied " + formatNumber(activePlan.tiles.length) + " tile URLs.");
    } catch (_error) {
      showAlert("Could not write to the clipboard.", "warning");
    }
  }

  els.form.addEventListener("submit", function (event) {
    event.preventDefault();
    analyze().then(function (plan) {
      if (plan) {
        assemble();
      }
    });
  });

  if (els.assemble) {
    els.assemble.addEventListener("click", assemble);
  }

  if (els.stop) {
    els.stop.addEventListener("click", function () {
      if (activeController) {
        activeController.abort();
      }
    });
  }

  els.download.addEventListener("click", function (event) {
    if (els.download.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
    }
  });

  if (els.copy) {
    els.copy.addEventListener("click", copyTiles);
  }

  window.addEventListener("beforeunload", revokeDownload);

  renderEmptyPlan();
  setProgress(0, 0, "Idle");
  setVisible(els.status, false);
  setVisible(els.progressWrap, false);
  setVisible(els.preview, false);
  setVisible(els.outputActions, false);
  setVisible(els.details, false);
  setWorking(false);
  }
})();
