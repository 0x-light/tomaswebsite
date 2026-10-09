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
  // The helper is a Cloudflare Pages Function deployed with the site. A page
  // served from anywhere else (a file, a plain local server) borrows the
  // deployed one, so nothing has to run locally.
  var HOSTED_HELPER_ORIGIN = "https://palmeirim.com";
  var helperOrigin = null;
  var helperReady = resolveHelperOrigin();
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
    save: document.getElementById("medici-save"),
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
      els.stop.hidden = !isWorking;
      els.stop.disabled = !isWorking;
    }
    if (els.save && isWorking) {
      els.save.hidden = true;
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
    return els.output ? els.output.value : "image/jpeg";
  }

  function getQuality() {
    return els.quality ? Number(els.quality.value) || 0.95 : 0.95;
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
    if (mimeType === "image/tiff") {
      return ".tif";
    }
    if (mimeType === "image/gif") {
      return ".gif";
    }
    if (mimeType === "image/webp") {
      return ".webp";
    }
    return ".png";
  }

  function getFileName(plan) {
    var name = plan.name || "medici";
    return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
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
    return /\.(?:avif|gif|jpe?g|png|webp|tiff?)(?:[?#].*)?$/i.test(source);
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
    if (helperOrigin) {
      return helperOrigin;
    }
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
      return window.location.origin;
    }
    return HOSTED_HELPER_ORIGIN;
  }

  // Use this page's own helper when it has one; otherwise the deployed one.
  async function resolveHelperOrigin() {
    var own = window.location.protocol === "http:" || window.location.protocol === "https:" ? window.location.origin : null;
    if (!own || own === HOSTED_HELPER_ORIGIN || window.MEDICI_HELPER_ORIGIN) {
      return;
    }
    try {
      var response = await fetch(own + HELPER_PATH + "/health", { cache: "no-store" });
      var status = response.ok ? await response.json() : null;
      if (status && status.ok) {
        return;
      }
    } catch (_error) {
      // No helper here; fall through to the deployed one.
    }
    helperOrigin = HOSTED_HELPER_ORIGIN;
  }

  // Some museums turn away automated visits. There's usually still a way:
  // the image itself, copied from the page in your own browser.
  function blockedSiteMessage(url) {
    var host = "";
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch (_error) {
      host = "";
    }
    var tips = {
      "museodelprado.es": "On the museum's page, right-click the painting, choose Copy Image Address, and paste it here. Medici rebuilds the full zoom image from it.",
      "britishmuseum.org": "On the museum's page, right-click the image, choose Copy Image Address, and paste it here. Medici fetches the largest public version (1,600 pixels).",
      "loc.gov": "On the item's page, open the largest download (JPEG or TIFF), copy that file's address, and paste it here.",
      "musee-orsay.fr": "On the museum's page, use its download button, copy that image's address, and paste it here. Orsay publishes images up to about 850 pixels.",
      "mauritshuis.nl": "Use the Download Image link on the museum's page instead."
    };
    var tip = "Copy the image's address from the museum's page (right-click the picture) and paste that here instead.";
    Object.keys(tips).forEach(function (key) {
      if (host === key || host.slice(-key.length - 1) === "." + key) {
        tip = tips[key];
      }
    });
    return (host || "This site") + " blocks automated visits, so Medici can't read the page. " + tip;
  }

  function helperMissingMessage(label) {
    return label + " needs the Medici helper at " + getHelperOrigin() + HELPER_PATH + ", which could not be reached. Check your connection and try again.";
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
          if ((proxied.status === 403 || proxied.status === 429 || proxied.status === 503) &&
            /cloudflare|just a moment|attention required|security checkpoint|captcha|cf-|vercel/i.test(helperBody)) {
            throw new Error(blockedSiteMessage(normalized));
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
        if (/blocks automated visits/.test(helperMessage)) {
          throw helperError;
        }
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
      await helperReady;
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

    var known = await planFromKnownSite(normalized, signal);
    if (known) {
      return known;
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
    var found = null;

    try {
      found = await planFromScannedResponse(url, await fetchText(url, signal), signal, seen);
      if (!isSmallImage(found)) {
        return found;
      }
      writeLog("Only found a " + formatNumber(found.width) + " × " + formatNumber(found.height) + " image; checking the rendered page.");
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
      scanError = error;
      writeLog("Direct scan failed: " + (error && error.message ? error.message : String(error)));
    }

    if (canUseExternalReader(url)) {
      try {
        var rendered = await planFromScannedResponse(url, await fetchReaderText(url, signal), signal, seen);
        if (!found || !isOriginalFile(rendered) || rendered.width * rendered.height > found.width * found.height) {
          found = rendered;
        }
      } catch (readerError) {
        if (readerError.name === "AbortError") {
          throw readerError;
        }
        readerFailure = readerError;
        writeLog("Reader fallback failed: " + (readerError && readerError.message ? readerError.message : String(readerError)));
      }
    }

    if (found) {
      if (isSmallImage(found)) {
        found.note = "Only found a " + formatNumber(found.width) + " × " + formatNumber(found.height) +
          " image on this page. That may be all the museum publishes, or its zoom viewer loads the full image in a way Medici can't see yet.";
      }
      return found;
    }

    if (readerFailure && /reader fallback needs|needs to be restarted/i.test(String(readerFailure.message || readerFailure))) {
      throw readerFailure;
    }

    throw scanError || new Error("No tile manifest found. Use Template mode for sources with custom URL patterns.");
  }

  function isSmallImage(plan) {
    return !!plan && isOriginalFile(plan) && Math.max(plan.width, plan.height) < 2000;
  }

  // The artwork's title from a page, for the file name. Drops a trailing
  // " | Museum name".
  function pageTitle(text) {
    var head = String(text || "").slice(0, 200000);
    var match = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(head) ||
      /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(head) ||
      /<title[^>]*>([^<]+)<\/title>/i.exec(head);
    if (!match) {
      return "";
    }
    var title = decodeHtmlText(match[1]).replace(/\s+/g, " ").trim();
    var trimmed = title.replace(/\s+\|\s+[^|]+$/, "").trim();
    return trimmed || title;
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
          return await planFromIiifPresentationData(data, url, signal);
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

    var title = /<html|<head|<title|<meta/i.test(text.slice(0, 5000)) ? pageTitle(text) : "";
    var best = null;

    writeLog("Found " + candidates.length + " candidate" + (candidates.length === 1 ? "" : "s") + ".");
    for (var i = 0; i < candidates.length && i < MAX_SCAN_CANDIDATES; i += 1) {
      try {
        writeLog("Trying " + candidates[i].mode + ": " + candidates[i].url);
        var plan = await detectPlan(candidates[i].url, candidates[i].mode, signal, seen.slice());
        if (title) {
          plan.name = title;
        }
        // A zoomable source is the real thing. A single image might be a
        // thumbnail, so keep looking and take the largest.
        if (!isOriginalFile(plan)) {
          return plan;
        }
        if (!best || plan.width * plan.height > best.width * best.height) {
          best = plan;
        }
      } catch (error) {
        if (error.name === "AbortError") {
          throw error;
        }
        writeLog("Skipped candidate: " + error.message);
      }
    }

    if (best) {
      writeLog("Largest image found: " + formatNumber(best.width) + " × " + formatNumber(best.height) + ".");
      return best;
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
        inferWordPressOriginalImageUrl(absolute),
        inferBritishMuseumSizedImageUrl(absolute, "huge"),
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

  function inferWordPressOriginalImageUrl(url) {
    try {
      var parsed = new URL(url);
      if (!looksLikeImage(parsed.href)) {
        return null;
      }

      var originalPath = parsed.pathname.replace(/-\d+x\d+(\.(?:avif|gif|jpe?g|png|webp))$/i, "$1");
      if (originalPath === parsed.pathname) {
        return null;
      }

      parsed.pathname = originalPath;
      return parsed.href;
    } catch (_error) {
      return null;
    }
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
      var match = parsed.pathname.match(/^(.*\/)(?:(?:preview|mid|large|huge)_)?([^/]+\.(?:avif|gif|jpe?g|png|webp))$/i);
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
      if (isLikelyDecorativeImage(parsed)) {
        return 0;
      }
      if (/d1hhug17qm51in\.cloudfront\.net$/i.test(parsed.hostname) && /\/www-media\//i.test(parsed.pathname)) {
        if (/-\d+x\d+\.(?:avif|gif|jpe?g|png|webp)$/i.test(parsed.pathname)) {
          return 45;
        }
        return /\/artwork\//i.test(parsed.pathname) || /_[0-9]{2}_[A-Z0-9]+/i.test(parsed.pathname) ? 85 : 70;
      }
      if (/\/wp-content\/uploads\//i.test(parsed.pathname)) {
        return /-\d+x\d+\.(?:avif|gif|jpe?g|png|webp)$/i.test(parsed.pathname) ? 35 : 65;
      }
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

  function isLikelyDecorativeImage(parsed) {
    var path = decodeURIComponent(parsed.pathname || "").toLowerCase();
    var filename = path.split("/").pop() || "";

    return /(?:^|[-_.])(favicon|apple-touch-icon|touch|icon|logo|sprite|placeholder|loader|loading)(?:[-_.]|$)/i.test(filename) ||
      /\/(?:icons?|logos?|sprites?)\//i.test(path) ||
      /\/wp-content\/themes\//i.test(path);
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
        var priority = imageCandidatePriority(absolute);
        if (priority <= 0) {
          return null;
        }
        return { mode: "image", url: absolute, priority: priority };
      }
    } catch (_error) {
      return null;
    }

    return null;
  }

  // ── Museum adapters ──
  // Many collection pages are built with JavaScript or sit behind bot checks,
  // but the museum also publishes the same images through a public API or
  // image server. Each adapter goes from an artwork page URL to that source.
  // Every route here is a public endpoint the museum provides.

  var SITE_ADAPTERS = [
    { name: "The Met", test: /metmuseum\.org\/art\/collection\/search\/(\d+)/i, plan: planFromMet },
    { name: "Getty", test: /getty\.edu\/art\/collection\/object\/([A-Za-z0-9-]+)/i, plan: planFromGetty },
    { name: "SMK", test: /open\.smk\.dk\/(?:[a-z]{2}\/)?artwork\/image\/([^/?#]+)/i, plan: planFromSmk },
    { name: "National Gallery", test: /nationalgallery\.org\.uk\/paintings\/([a-z0-9-]+)/i, plan: planFromNationalGallery },
    { name: "National Gallery of Art", test: /nga\.gov\/(?:collection\/art-object-page\.|artworks\/)(\d+)/i, plan: planFromNga },
    { name: "Louvre", test: /collections\.louvre\.fr\/(?:[a-z]{2}\/)?ark:\/53355\/(cl\d+)/i, plan: planFromLouvre },
    { name: "Wikimedia Commons", test: /(?:wikimedia|wikipedia)\.org\/wiki\/((?:File|Image|Datei|Fichier|Archivo|Bestand):[^?#]+)/i, plan: planFromCommons },
    { name: "Wikimedia Commons", test: /upload\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/i, plan: planFromCommonsFile },
    { name: "Europeana", test: /europeana\.eu\/(?:[a-z]{2}\/)?item\/(\d+)\/([^/?#]+)/i, plan: planFromEuropeana },
    { name: "Kunsthistorisches Museum", test: /khm\.at\/(?:objektdb\/detail|kunstwerke)\//i, plan: planFromKhm },
    { name: "Belvedere", test: /sammlung\.belvedere\.at\/objects\/(\d+)/i, plan: planFromBelvedere },
    { name: "Uffizi", test: /uffizi\.it\/(?:[a-z]{2}\/)?(?:artworks|opere)\//i, plan: planFromUffizi },
    { name: "Tate", test: /tate\.org\.uk\/art\/artworks\/[^?#]*-([a-z]{1,2}\d{5})(?:[/?#]|$)/i, plan: planFromTate },
    { name: "Smithsonian", test: /(?:americanart\.si\.edu\/artwork\/|asia\.si\.edu\/object\/|collections\.si\.edu\/search\/detail\/edanmdm:)/i, plan: planFromSmithsonian },
    { name: "Prado", test: /cdnprado\.net\/imagenes\/Documentos\/imgsem\//i, plan: planFromPradoImage },
    { name: "British Museum", test: /media\.britishmuseum\.org\/media\//i, plan: planFromBritishMuseumImage },
    { name: "Mauritshuis", test: /mauritshuis\.nl\/.*\/artworks\/(\d+)-/i, plan: planFromMauritshuis }
  ];

  async function planFromKnownSite(url, signal) {
    for (var i = 0; i < SITE_ADAPTERS.length; i += 1) {
      var match = SITE_ADAPTERS[i].test.exec(url);
      if (match) {
        writeLog("Recognized " + SITE_ADAPTERS[i].name + ".");
        var plan = await SITE_ADAPTERS[i].plan(match, url, signal);
        if (plan && !plan.site) {
          plan.site = SITE_ADAPTERS[i].name;
        }
        return plan;
      }
    }
    return null;
  }

  async function fetchJson(url, signal) {
    var response = await fetchText(url, signal);
    return JSON.parse(response.text.trim());
  }

  function named(plan, title, extra) {
    var parts = [title, extra].filter(function (part) { return part && String(part).trim(); });
    if (parts.length) {
      plan.name = parts.join(" - ");
    }
    return plan;
  }

  function withNote(plan, note) {
    plan.note = plan.note ? plan.note + " " + note : note;
    return plan;
  }

  // The Met's Collection API links the original, full-size file for
  // public-domain works. Its website blocks automated visits; the API doesn't.
  async function planFromMet(match, url, signal) {
    var data = await fetchJson("https://collectionapi.metmuseum.org/public/collection/v1/objects/" + match[1], signal);
    if (!data.primaryImage) {
      throw new Error(data.isPublicDomain === false ?
        "The Met only shares full images of public-domain works, and this one isn't." :
        "The Met has no image for this object.");
    }
    var plan = await planFromImage(data.primaryImage, signal);
    plan.type = "The Met Open Access";
    return named(plan, data.title, data.artistDisplayName);
  }

  // Getty: page → Linked Art record → IIIF manifest (full-resolution image service).
  async function planFromGetty(match, url, signal) {
    var id = match[1];
    var indexedId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? "object/" + id : null;
    if (!indexedId) {
      var page = await fetchText(url, signal);
      var manager = /<script[^>]+id=["']local_id_manager["'][^>]*>([\s\S]*?)<\/script>/i.exec(page.text);
      if (manager) {
        indexedId = JSON.parse(manager[1]).indexedId;
      }
    }
    if (!indexedId) {
      throw new Error("Could not find this Getty object's record.");
    }
    var record = await fetchJson("https://data.getty.edu/museum/collection/" + indexedId, signal);
    var manifests = (record.subject_of || []).filter(function (item) {
      return (item.classified_as || []).some(function (c) { return c._label === "IIIF Manifest"; });
    }).map(function (item) { return item.id; });
    manifests.sort(function (a, b) { return (/\/manifest\/3\//.test(b) ? 1 : 0) - (/\/manifest\/3\//.test(a) ? 1 : 0); });

    var plan;
    if (manifests.length) {
      plan = await planFromIiifPresentationData(await fetchJson(manifests[0], signal), manifests[0], signal);
    } else if (record.representation && record.representation[0]) {
      plan = await planFromIiif(record.representation[0].id.replace(/\/full\/.*$/, "") + "/info.json", signal);
    } else {
      throw new Error("This Getty object has no published image.");
    }
    plan.type = "Getty IIIF";
    return named(plan, record._label);
  }

  // SMK (Statens Museum for Kunst): open API with IIIF for each artwork.
  async function planFromSmk(match, url, signal) {
    var objectNumber = decodeURIComponent(match[1]);
    var data = await fetchJson("https://api.smk.dk/api/v1/art/?object_number=" + encodeURIComponent(objectNumber), signal);
    var item = data.items && data.items[0];
    if (!item) {
      throw new Error("SMK has no record for " + objectNumber + ".");
    }
    var plan;
    if (item.image_iiif_info) {
      plan = await planFromIiif(item.image_iiif_info, signal);
    } else if (item.image_native) {
      plan = await planFromImage(item.image_native, signal);
    } else {
      throw new Error("SMK has no image for this artwork.");
    }
    plan.type = "SMK IIIF";
    var title = item.titles && item.titles[0] && item.titles[0].title;
    var artist = item.production && item.production[0] && item.production[0].creator;
    return named(plan, title, artist);
  }

  // National Gallery, London: each painting has a IIIF manifest. Its image
  // server caps any single response at 800 pixels, so the plan stitches 800-pixel regions.
  async function planFromNationalGallery(match, url, signal) {
    var manifestUrl = "https://www.nationalgallery.org.uk/paintings/" + match[1] + "?altTemplate=PaintingManifest&zoomImageType=Front";
    var plan = await planFromIiifPresentationData(await fetchJson(manifestUrl, signal), manifestUrl, signal);
    plan.type = "National Gallery IIIF";
    return plan;
  }

  // National Gallery of Art, Washington: its pages are behind a bot check, but
  // images are open at api.nga.gov. The object → image lookup comes from NGA's
  // open data (scripts/build_nga_index.py).
  async function planFromNga(match, url, signal) {
    var id = match[1];
    var origin = /^https?:$/.test(window.location.protocol) ? "" : HOSTED_HELPER_ORIGIN;
    var shard = await fetchJson(origin + "/data/nga/" + (Number(id) % 100) + ".json", signal);
    var entry = shard[id];
    if (!entry) {
      throw new Error("NGA has no open-access image for object " + id + ". Only open-access works have full-resolution images.");
    }
    var plan = await planFromIiif("https://api.nga.gov/iiif/" + entry[0] + "/info.json", signal);
    plan.type = "National Gallery of Art IIIF";
    return named(plan, "nga-" + id);
  }

  // Louvre: the collection publishes JSON for each work. It doesn't offer
  // anything larger than about 1,500 pixels, and Medici says so.
  async function planFromLouvre(match, url, signal) {
    var data = await fetchJson("https://collections.louvre.fr/ark:/53355/" + match[1] + ".json", signal);
    var images = (data.image || []).slice().sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
    if (!images.length || !images[0].urlImage) {
      throw new Error("The Louvre has no image for this work.");
    }
    var plan = await planFromImage(absoluteUrl(images[0].urlImage, "https://collections.louvre.fr/"), signal);
    plan.type = "Louvre";
    withNote(plan, "The Louvre publishes this work at up to " + formatNumber(plan.width) + " × " + formatNumber(plan.height) + "; that's the largest version it offers.");
    return named(plan, data.title);
  }

  // Wikimedia Commons: the API gives the original file and its size, so even a
  // 44,567-pixel original is saved as-is without decoding.
  async function planFromCommons(match, url, signal) {
    var title = decodeURIComponent(match[1]).replace(/_/g, " ").replace(/^[^:]+:/, "File:");
    return planFromCommonsTitle(title, signal);
  }

  async function planFromCommonsFile(match, url, signal) {
    return planFromCommonsTitle("File:" + decodeURIComponent(match[1]).replace(/_/g, " "), signal);
  }

  async function planFromCommonsTitle(title, signal) {
    var api = "https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|size|mime&format=json&formatversion=2&origin=*&titles=" +
      encodeURIComponent(title);
    var data = await fetchJson(api, signal);
    var page = data.query && data.query.pages && data.query.pages[0];
    var info = page && page.imageinfo && page.imageinfo[0];
    if (!info) {
      throw new Error("Wikimedia Commons has no file called " + title.replace(/^File:/, "") + ".");
    }
    var fileUrl = info.url.split("?")[0];
    return {
      type: "Wikimedia Commons original",
      source: fileUrl,
      name: title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""),
      width: info.width,
      height: info.height,
      original: true,
      mimeType: info.mime,
      bytes: info.size,
      tiles: [{ url: fileUrl, dx: 0, dy: 0, dw: info.width, dh: info.height }]
    };
  }

  // Europeana aggregates Europe's collections: prefer a IIIF image service,
  // otherwise the file the holding institution shares.
  async function planFromEuropeana(match, url, signal) {
    var record = await fetchJson("https://api.europeana.eu/record/v2/" + match[1] + "/" + match[2] + ".json?wskey=api2demo", signal);
    var object = record.object || {};
    var aggregation = object.aggregations && object.aggregations[0];
    if (!aggregation || !aggregation.edmIsShownBy) {
      throw new Error("Europeana has no image for this record.");
    }
    var resource = (aggregation.webResources || []).filter(function (r) { return r.about === aggregation.edmIsShownBy; })[0] || {};
    var service = resource.svcsHasService && resource.svcsHasService[0];
    var plan = service ?
      await planFromIiif(service.replace(/\/$/, "") + "/info.json", signal) :
      await planFromImage(aggregation.edmIsShownBy, signal);
    plan.type = "Europeana" + (service ? " IIIF" : "");
    var title = object.title && object.title[0];
    return named(plan, title);
  }

  // Kunsthistorisches Museum: the page's OpenSeadragon element lists its sources.
  async function planFromKhm(match, url, signal) {
    var page = await fetchText(url, signal);
    var element = /<div[^>]+id=["']openseadragon["'][^>]*>/i.exec(page.text);
    var base = element && /data-base=["']([^"']+)["']/i.exec(element[0]);
    var sources = element && /data-sources=["']([^"']+)["']/i.exec(element[0]);
    var plan = null;
    if (sources) {
      var first = decodeHtmlText(sources[1]).split(",")[0].trim();
      var resolved = first.charAt(0) === "/" ? "https://www.khm.at" + first : (base ? decodeHtmlText(base[1]) : "https://imageapi.khm.at/") + first;
      plan = /\.dzi(?:[?#].*)?$/i.test(resolved) ? await planFromDeepZoom(resolved, signal) : await planFromImage(resolved, signal);
    } else {
      plan = await planFromScannedResponse(url, page, signal, []);
    }
    return named(plan, pageTitle(page.text));
  }

  // Belvedere: eMuseum IIIF manifest by object id.
  async function planFromBelvedere(match, url, signal) {
    var manifestUrl = "https://sammlung.belvedere.at/apis/iiif/presentation/v2/1-objects-" + match[1] + "/manifest";
    var plan = await planFromIiifPresentationData(await fetchJson(manifestUrl, signal), manifestUrl, signal);
    plan.type = "Belvedere IIIF";
    if (Math.max(plan.width, plan.height) < 2000) {
      withNote(plan, "The Belvedere publishes its images at up to about " + formatNumber(Math.max(plan.width, plan.height)) + " pixels.");
    }
    return plan;
  }

  // Uffizi: the page data lists the original image files.
  async function planFromUffizi(match, url, signal) {
    var page = await fetchText(url, signal);
    var nextData = /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(page.text);
    var images = [];
    try {
      var data = JSON.parse(nextData[1]);
      images = ((data.props.pageProps.page || {}).images || []).map(function (item) { return item.image && item.image.url; }).filter(Boolean);
    } catch (_error) {
      images = [];
    }
    if (!images.length) {
      return named(await planFromScannedResponse(url, page, signal, []), pageTitle(page.text));
    }
    var plan = await planFromImage(images[0].split("?")[0], signal);
    plan.type = "Uffizi";
    return named(plan, pageTitle(page.text));
  }

  // Tate: the artwork API lists each image's sizes; take the largest.
  async function planFromTate(match, url, signal) {
    var acno = match[1].toUpperCase();
    var data = await fetchJson("https://www.tate.org.uk/api/v2/artworks/?acno=" + acno + "&fields=*", signal);
    var item = data.items && data.items[0];
    var master = item && item.master_images && item.master_images[0];
    var sizes = master && master.sizes;
    if (!sizes || !sizes.length) {
      throw new Error("Tate has no image for " + acno + ".");
    }
    var largest = sizes[sizes.length - 1];
    var plan = await planFromImage(largest[2] || largest.url, signal);
    plan.type = "Tate";
    return named(plan, item.title, item.all_artists || item.contributors);
  }

  // Smithsonian Open Access: originals (often over 10,000 pixels) for CC0 works.
  async function planFromSmithsonian(match, url, signal) {
    var recordId = null;
    var edan = /edanmdm:([^/?#&]+)/i.exec(url);
    var freer = /asia\.si\.edu\/object\/([^/?#]+)/i.exec(url);
    var media = null;

    if (edan) {
      recordId = edan[1];
    } else if (freer) {
      recordId = "fsg_" + decodeURIComponent(freer[1]);
    } else {
      // SAAM pages aren't blocked; they name the IDS image directly.
      var page = await fetchText(url, signal);
      var ids = /ids\.si\.edu\/ids\/(?:deliveryService|iiif|download)[^"'\s]*?(?:id=|\/)([A-Za-z0-9._-]+?)(?:\.jpg|\/|&|["'\s])/i.exec(page.text);
      if (ids) {
        media = ids[1];
      }
      var saam = /\/artwork\/[^?#]*?-(\d+)/i.exec(url);
      if (!media && !saam) {
        throw new Error("Could not find this Smithsonian object's image.");
      }
    }

    if (!media && recordId) {
      var data = await fetchJson("https://api.si.edu/openaccess/api/v1.0/content/edanmdm:" + encodeURIComponent(recordId) + "?api_key=DEMO_KEY", signal);
      var content = data.response && data.response.content;
      var items = content && content.descriptiveNonRepeating && content.descriptiveNonRepeating.online_media && content.descriptiveNonRepeating.online_media.media;
      var first = items && items[0];
      if (!first || !first.idsId) {
        throw new Error("The Smithsonian has no open-access image for this object.");
      }
      media = first.idsId;
    }

    // The download link redirects to the original JPEG on Smithsonian's open-access storage.
    var plan = await planFromImage("https://ids.si.edu/ids/download?id=" + encodeURIComponent(media) + ".jpg", signal);
    plan.type = "Smithsonian Open Access";
    return named(plan, media);
  }

  // Prado: its pages are blocked to automated visits, but its zoom viewer uses
  // Deep Zoom tiles on cdnprado.net. Paste any image link from the page (the
  // picture's address) and Medici finds the tiles and measures them.
  async function planFromPradoImage(match, url, signal) {
    var base = url.split("?")[0].replace(/(?:_\d+)?\.jpg$/i, "").replace(/\/\d+\/\d+_\d+$/, "");
    var tileSize = 256;
    var overlap = 1;
    async function exists(path) {
      try {
        var response = await fetchResource(base + "/" + path, signal, "Tile request");
        return response.ok;
      } catch (error) {
        if (error.name === "AbortError") {
          throw error;
        }
        return false;
      }
    }

    var level = 8;
    while (level < 18 && await exists((level + 1) + "/0_0.jpg")) {
      level += 1;
    }
    if (!(await exists(level + "/0_0.jpg"))) {
      throw new Error("Could not find the Prado zoom tiles for this image.");
    }
    async function lastIndex(axis) {
      var low = 0, high = 1;
      while (await exists(level + "/" + (axis === "x" ? high + "_0" : "0_" + high) + ".jpg")) {
        low = high;
        high *= 2;
      }
      while (high - low > 1) {
        var mid = Math.floor((low + high) / 2);
        if (await exists(level + "/" + (axis === "x" ? mid + "_0" : "0_" + mid) + ".jpg")) {
          low = mid;
        } else {
          high = mid;
        }
      }
      return low;
    }
    var first = await loadTileWithFetch(base + "/" + level + "/0_0.jpg", signal);
    var firstWidth = first.image.naturalWidth || first.image.width;
    cleanupLoadedImage(first.image);
    var lastCol = await lastIndex("x");
    var lastRow = await lastIndex("y");
    if (lastCol > 0) {
      tileSize = firstWidth - overlap;
    }
    var edge = await loadTileWithFetch(base + "/" + level + "/" + lastCol + "_" + lastRow + ".jpg", signal);
    var edgeWidth = (edge.image.naturalWidth || edge.image.width) - (lastCol > 0 ? overlap : 0);
    var edgeHeight = (edge.image.naturalHeight || edge.image.height) - (lastRow > 0 ? overlap : 0);
    cleanupLoadedImage(edge.image);
    var width = lastCol * tileSize + edgeWidth;
    var height = lastRow * tileSize + edgeHeight;
    var xml = '<Image TileSize="' + tileSize + '" Overlap="' + overlap + '" Format="jpg"><Size Width="' + width + '" Height="' + height + '"/></Image>';
    var plan = planFromDeepZoomXml(xml, base + ".dzi");
    plan.tiles.forEach(function (tile) {
      tile.url = tile.url.replace(base + "_files/", base + "/");
    });
    plan.type = "Prado Deep Zoom";
    return plan;
  }

  async function planFromBritishMuseumImage(match, url, signal) {
    var tries = [
      inferBritishMuseumSizedImageUrl(url, "huge"),
      britishMuseumHttpMirrorUrl(inferBritishMuseumSizedImageUrl(url, "huge")),
      inferBritishMuseumSizedImageUrl(url, "large"),
      britishMuseumHttpMirrorUrl(inferBritishMuseumSizedImageUrl(url, "large")),
      url,
      britishMuseumHttpMirrorUrl(url)
    ].filter(function (candidate, index, list) { return candidate && list.indexOf(candidate) === index; });
    var lastError = null;
    for (var i = 0; i < tries.length; i += 1) {
      try {
        var plan = await planFromImage(tries[i], signal);
        plan.type = "British Museum";
        return withNote(plan, "1,600 pixels is the largest size the British Museum makes public.");
      } catch (error) {
        if (error.name === "AbortError") {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError || new Error("Could not fetch this British Museum image.");
  }

  // Mauritshuis: Europeana knows the original file, but mauritshuis.nl blocks
  // automated downloads; explain rather than fail mysteriously.
  async function planFromMauritshuis(match, url, signal) {
    try {
      return await planFromEuropeana([null, "2021672", "resource_document_mauritshuis_" + match[1]], url, signal);
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
      throw new Error("The Mauritshuis blocks automated downloads, so Medici can't fetch this image. Use the Download Image link on the museum's page.");
    }
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

  async function planFromIiifPresentationData(data, url, signal) {
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
    var label = iiifLabel(data.label);

    if (!service || !(service.id || service["@id"])) {
      // No image service: the manifest may still point at a plain image file.
      var direct = resource && (resource.id || resource["@id"]);
      if (direct && looksLikeImage(direct)) {
        var imagePlan = await planFromImage(direct, signal);
        imagePlan.name = label || imagePlan.name;
        return imagePlan;
      }
      throw new Error("The IIIF manifest does not include an image service.");
    }

    // The service's info.json has the true size, tile layout, and server limits.
    var base = service.id || service["@id"];
    try {
      var plan = await planFromIiif(normalizeIiifBase(base) + "/info.json", signal);
      plan.type = "IIIF Manifest";
      plan.source = url;
      plan.name = label || plan.name;
      return plan;
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
      writeLog("Image service info failed (" + error.message + "); using the manifest's dimensions.");
    }

    return planFromIiifService(base, Number(canvas.width || resource.width), Number(canvas.height || resource.height), {
      type: "IIIF Manifest",
      source: url,
      name: label || nameFromUrl(url, "iiif-manifest"),
      tileSize: 512,
      format: "jpg"
    });
  }

  // IIIF labels: a string (v2) or a language map like { "en": ["Irises"] } (v3).
  function iiifLabel(label) {
    if (!label) {
      return "";
    }
    if (typeof label === "string") {
      return label;
    }
    if (Array.isArray(label)) {
      return iiifLabel(label[0] && (label[0]["@value"] || label[0]));
    }
    if (typeof label === "object") {
      var values = label.en || label.none || label[Object.keys(label)[0]];
      return Array.isArray(values) ? String(values[0] || "") : String(values || "");
    }
    return "";
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
    var profile = JSON.stringify(data.profile || "");
    var level2 = /level2/i.test(profile) || /(?:^|\/\/)api\.nga\.gov\//i.test(base);
    var maxSide = Math.min(
      Number(data.maxWidth) || Infinity,
      Number(data.maxHeight) || Number(data.maxWidth) || Infinity,
      data.maxArea ? Math.floor(Math.sqrt(Number(data.maxArea))) : Infinity
    );

    if (level2 && (width > 2048 || height > 2048 || maxSide < Math.max(width, height))) {
      // Level 2 servers accept any region, so ask for large ones: far fewer
      // requests than 256-pixel tiles. Stay within the server's size limits.
      var region = Math.max(256, Math.min(2048, maxSide));
      for (var ry2 = 0; ry2 < height; ry2 += region) {
        for (var rx2 = 0; rx2 < width; rx2 += region) {
          var rw2 = Math.min(region, width - rx2);
          var rh2 = Math.min(region, height - ry2);
          tiles.push({
            url: base + "/" + [rx2, ry2, rw2, rh2].join(",") + "/" + rw2 + ",/0/default." + format,
            dx: rx2,
            dy: ry2,
            dw: rw2,
            dh: rh2
          });
        }
      }
    } else if (!tilesInfo.length) {
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
    var absolute = absoluteUrl(url);
    var size = null;
    try {
      size = await readImageSize(absolute, signal);
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
    }

    if (!size) {
      // Unusual format: decode it to measure.
      var loaded = await loadTileWithFetch(absolute, signal);
      size = { width: loaded.image.naturalWidth || loaded.image.width, height: loaded.image.naturalHeight || loaded.image.height };
      cleanupLoadedImage(loaded.image);
    }

    if (!size.width || !size.height) {
      throw new Error("Could not read image dimensions.");
    }

    return {
      type: "Image",
      source: url,
      name: nameFromUrl(url, "image"),
      width: size.width,
      height: size.height,
      original: true,
      mimeType: size.mimeType,
      bytes: size.bytes,
      tiles: [{
        url: absolute,
        dx: 0,
        dy: 0,
        dw: size.width,
        dh: size.height
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
    els.memory.textContent = formatPixels(plan.width, plan.height);
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
    if (activePlan.note) {
      showAlert(activePlan.note, "neutral");
    }
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

  // ── Full-resolution export ──
  // A browser canvas can't hold a gigapixel image, so large images are built a
  // band of tiles at a time: each band is drawn in narrow chunks, turned into
  // rows, and encoded straight into the output file (JPEG across several
  // workers, or lossless PNG). Where the browser allows it, the file is written
  // to disk as it's made, so memory stays flat however big the artwork is.

  var STREAM_ABOVE_PIXELS = 50000000;
  var CHUNK_WIDTH = 4096;
  var MAX_BAND_HEIGHT = 1024;
  var PREVIEW_MAX_SIDE = 2400;
  var JPEG_QUALITY = 95;

  function isOriginalFile(plan) {
    return !!(plan && plan.original && plan.tiles.length === 1);
  }

  function needsStreaming(plan) {
    if (!plan || isOriginalFile(plan)) {
      return false;
    }
    var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    var limit = coarse ? 16000000 : STREAM_ABOVE_PIXELS;
    return plan.width * plan.height > limit || plan.width > MAX_CANVAS_SIDE || plan.height > MAX_CANVAS_SIDE;
  }

  function formatPixels(width, height) {
    var pixels = width * height;
    if (pixels >= 1e9) {
      return (pixels / 1e9).toFixed(2) + " gigapixels";
    }
    return (pixels / 1e6).toFixed(pixels >= 1e7 ? 0 : 1) + " megapixels";
  }

  function sleep(ms, signal) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener("abort", function () {
          clearTimeout(timer);
          reject(new DOMException("Stopped", "AbortError"));
        }, { once: true });
      }
    });
  }

  async function loadTileRetrying(tile, signal) {
    var url = tile.fetchUrl || tile.url;
    for (var attempt = 0; ; attempt += 1) {
      try {
        return await loadTileWithFetch(url, signal);
      } catch (error) {
        if (error.name === "AbortError" || attempt >= 3) {
          throw error;
        }
        await sleep(400 * Math.pow(3, attempt), signal);
      }
    }
  }

  // Where the output goes: straight to a file on disk when the browser can
  // (File System Access), otherwise into memory for a normal download.
  async function openSink(fileName, mimeType) {
    if (window.showSaveFilePicker) {
      var accept = {};
      accept[mimeType] = [fileName.slice(fileName.lastIndexOf("."))];
      var handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: mimeType === "image/png" ? "PNG image" : "JPEG image", accept: accept }]
      });
      var writable = await handle.createWritable();
      return {
        streamed: true,
        write: function (bytes) { return writable.write(bytes); },
        close: async function () { await writable.close(); return null; },
        abort: function () { return writable.abort().catch(function () {}); }
      };
    }
    var parts = [];
    return {
      streamed: false,
      write: function (bytes) { parts.push(bytes); },
      close: function () { return new Blob(parts, { type: mimeType }); },
      abort: function () { parts = []; }
    };
  }

  function enableDownloadFile(blob, fileName) {
    revokeDownload();
    activeDownloadUrl = URL.createObjectURL(blob);
    els.download.href = activeDownloadUrl;
    els.download.download = fileName;
    els.download.setAttribute("aria-disabled", "false");
    setVisible(els.outputActions, true);
    if (els.downloadSize) {
      els.downloadSize.textContent = formatCompactBytes(blob.size);
      els.downloadSize.hidden = false;
    }
  }

  // Bands follow the tile rows. Tiles are fetched once per band; very tall
  // bands are drawn in slices so the working buffer stays small.
  function planBands(plan) {
    var starts = [];
    plan.tiles.forEach(function (tile) {
      var y = Math.max(0, Math.round(tile.dy));
      if (starts.indexOf(y) === -1) {
        starts.push(y);
      }
    });
    starts.sort(function (a, b) { return a - b; });
    if (starts[0] !== 0) {
      starts.unshift(0);
    }

    var bands = [];
    for (var i = 0; i < starts.length; i += 1) {
      var y0 = starts[i];
      var y1 = i + 1 < starts.length ? starts[i + 1] : plan.height;
      if (y1 <= y0) {
        continue;
      }
      bands.push({
        y0: y0,
        y1: y1,
        tiles: plan.tiles.filter(function (tile) { return tile.dy < y1 && tile.dy + tile.dh > y0; })
      });
    }
    return bands;
  }

  async function fetchBand(band, signal, onTile) {
    var images = new Array(band.tiles.length);
    var next = 0;

    async function worker() {
      while (next < band.tiles.length) {
        var index = next;
        next += 1;
        images[index] = (await loadTileRetrying(band.tiles[index], signal)).image;
        onTile();
      }
    }

    var count = Math.min(getWorkerCount(band.tiles.length), band.tiles.length);
    var workers = [];
    for (var i = 0; i < count; i += 1) {
      workers.push(worker());
    }
    try {
      await Promise.all(workers);
    } catch (error) {
      images.forEach(function (image) { cleanupLoadedImage(image); });
      throw error;
    }
    return images;
  }

  function createJpegEncoder(width, height, write) {
    var count = Math.max(2, Math.min(navigator.hardwareConcurrency || 4, 8));
    var workers = [];
    var results = {};
    var sequence = 0;
    var nextWrite = 0;
    var waiters = [];
    var failure = null;

    function wake() {
      var pending = waiters;
      waiters = [];
      pending.forEach(function (resolve) { resolve(); });
    }

    function onMessage(event) {
      if (event.data.id === "header") {
        write(new Uint8Array(event.data.bytes));
        return;
      }
      results[event.data.id] = new Uint8Array(event.data.bytes);
      while (results[nextWrite]) {
        // Segments are independent restart intervals; RSTn goes between them.
        if (nextWrite > 0) {
          write(new Uint8Array([0xff, 0xd0 + ((nextWrite - 1) % 8)]));
        }
        write(results[nextWrite]);
        delete results[nextWrite];
        nextWrite += 1;
      }
      wake();
    }

    for (var i = 0; i < count; i += 1) {
      var worker = new Worker("/scripts/medici-jpeg-worker.js");
      worker.onmessage = onMessage;
      worker.onerror = function (event) {
        failure = new Error("The JPEG encoder stopped: " + (event.message || "unknown error"));
        wake();
      };
      worker.postMessage({ type: "init", quality: JPEG_QUALITY });
      workers.push(worker);
    }
    workers[0].postMessage({ type: "header", id: "header", width: width, height: height });

    return {
      rowsPerGroup: 8,
      push: async function (buffer, rows) {
        while (!failure && sequence - nextWrite >= count * 3) {
          await new Promise(function (resolve) { waiters.push(resolve); });
        }
        if (failure) {
          throw failure;
        }
        var id = sequence;
        sequence += 1;
        workers[id % count].postMessage({ type: "rows", id: id, width: width, rows: rows, rgba: buffer }, [buffer]);
      },
      finish: async function () {
        while (!failure && nextWrite < sequence) {
          await new Promise(function (resolve) { waiters.push(resolve); });
        }
        if (failure) {
          throw failure;
        }
        write(new Uint8Array([0xff, 0xd9]));
        this.close();
      },
      close: function () {
        workers.forEach(function (w) { w.terminate(); });
      }
    };
  }

  function createPngEncoder(width, height, write) {
    var worker = new Worker("/scripts/medici-png-worker.js");
    var inFlight = 0;
    var waiters = [];
    var failure = null;
    var finished = null;
    var sequence = 0;

    function wake() {
      var pending = waiters;
      waiters = [];
      pending.forEach(function (resolve) { resolve(); });
    }

    worker.onmessage = function (event) {
      if (event.data.kind === "data") {
        write(new Uint8Array(event.data.bytes));
      } else if (event.data.kind === "ack") {
        inFlight -= 1;
        wake();
      } else if (event.data.kind === "done" && finished) {
        finished();
      }
    };
    worker.onerror = function (event) {
      failure = new Error("The PNG encoder stopped: " + (event.message || "unknown error"));
      wake();
      if (finished) {
        finished();
      }
    };
    worker.postMessage({ type: "start", width: width, height: height });

    return {
      rowsPerGroup: 16,
      push: async function (buffer, rows) {
        while (!failure && inFlight >= 4) {
          await new Promise(function (resolve) { waiters.push(resolve); });
        }
        if (failure) {
          throw failure;
        }
        inFlight += 1;
        sequence += 1;
        worker.postMessage({ type: "rows", id: sequence, rows: rows, rgba: buffer }, [buffer]);
      },
      finish: async function () {
        await new Promise(function (resolve) {
          finished = resolve;
          worker.postMessage({ type: "end" });
        });
        if (failure) {
          throw failure;
        }
        this.close();
      },
      close: function () {
        worker.terminate();
      }
    };
  }

  // Gathers full-width rows from a band's chunks and hands the encoder a group
  // at a time (8 rows for JPEG's block rows, 16 for PNG).
  function createRowGrouper(width, encoder) {
    var stride = width * 4;
    var groupRows = encoder.rowsPerGroup;
    var buffer = new Uint8Array(stride * groupRows);
    var count = 0;

    async function emit() {
      var full = buffer;
      var rows = count;
      buffer = new Uint8Array(stride * groupRows);
      count = 0;
      await encoder.push(full.buffer, rows);
    }

    return {
      add: async function (chunks, row) {
        var offset = count * stride;
        for (var i = 0; i < chunks.length; i += 1) {
          var chunk = chunks[i];
          var rowBytes = chunk.width * 4;
          buffer.set(chunk.data.subarray(row * rowBytes, (row + 1) * rowBytes), offset + chunk.x0 * 4);
        }
        count += 1;
        if (count === groupRows) {
          await emit();
        }
      },
      flush: async function () {
        if (count) {
          await emit();
        }
      }
    };
  }

  function drawTileOffset(ctx, image, tile, ox, oy) {
    ctx.setTransform(1, 0, 0, 1, -ox, -oy);
    drawTile(ctx, image, tile, 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function offerFullResolution(plan) {
    var where = window.showSaveFilePicker ?
      "Medici builds images this large straight into a file on your disk." :
      "Medici builds images this large piece by piece. For the very largest, Chrome, Edge, or Arc can also write straight to disk.";
    showAlert(formatNumber(plan.width) + " × " + formatNumber(plan.height) + ", " + formatPixels(plan.width, plan.height) + ". " + where, "neutral");
    setVisible(els.progressWrap, false);
    if (els.save) {
      els.save.textContent = "Save full resolution · " + (getOutputType() === "image/png" ? "PNG" : "JPEG");
      els.save.hidden = false;
    }
  }

  async function exportFullResolution() {
    if (!activePlan) {
      return;
    }
    var plan = activePlan;
    var png = getOutputType() === "image/png";
    var mimeType = png ? "image/png" : "image/jpeg";
    var fileName = getFileName(plan) + (png ? ".png" : ".jpg");

    // Ask where to save first, while the click still counts as a user gesture.
    var sink;
    try {
      sink = await openSink(fileName, mimeType);
    } catch (error) {
      if (error.name !== "AbortError") {
        showAlert(toFriendlyError(error), "warning");
      }
      return;
    }

    if (activeController) {
      activeController.abort();
    }
    activeController = new AbortController();
    var signal = activeController.signal;

    clearAlert();
    revokeDownload();
    if (els.save) {
      els.save.hidden = true;
    }
    setVisible(els.status, true);
    setVisible(els.progressWrap, true);
    setVisible(els.preview, true);
    setVisible(els.outputActions, false);
    setWorking(true);

    var width = plan.width;
    var height = plan.height;
    var previewScale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(width, height));
    var preview = els.canvas;
    preview.width = Math.max(1, Math.round(width * previewScale));
    preview.height = Math.max(1, Math.round(height * previewScale));
    preview.style.aspectRatio = width + " / " + height;
    var previewCtx = preview.getContext("2d");
    previewCtx.fillStyle = "#ffffff";
    previewCtx.fillRect(0, 0, preview.width, preview.height);
    previewCtx.imageSmoothingQuality = "high";

    var bands = planBands(plan);
    var totalTiles = bands.reduce(function (sum, band) { return sum + band.tiles.length; }, 0);
    var doneTiles = 0;
    var writeQueue = Promise.resolve();
    var writeFailure = null;

    function write(bytes) {
      writeQueue = writeQueue.then(function () { return sink.write(bytes); }).catch(function (error) {
        writeFailure = writeFailure || error;
      });
    }

    var startedAt = Date.now();

    function onTile() {
      doneTiles += 1;
      var label = formatNumber(doneTiles) + " / " + formatNumber(totalTiles) + " tiles";
      var elapsed = (Date.now() - startedAt) / 1000;
      if (doneTiles >= 20 && elapsed > 5) {
        var left = (totalTiles - doneTiles) / (doneTiles / elapsed);
        label += left >= 90 ? " · about " + Math.round(left / 60) + " min left" : left >= 15 ? " · under a minute left" : "";
      }
      setProgress(doneTiles, totalTiles, label);
    }

    var encoder = png ? createPngEncoder(width, height, write) : createJpegEncoder(width, height, write);
    var grouper = createRowGrouper(width, encoder);
    var chunkCanvas = document.createElement("canvas");
    var chunkCtx = chunkCanvas.getContext("2d", { willReadFrequently: true });
    var pendingFetch = null;

    writeLog("Building " + formatNumber(width) + " × " + formatNumber(height) + " " + (png ? "PNG" : "JPEG") + " in " +
      formatNumber(bands.length) + " band" + (bands.length === 1 ? "" : "s") + (sink.streamed ? ", writing straight to disk." : "."));
    setProgress(0, totalTiles, "0 / " + formatNumber(totalTiles) + " tiles");

    try {
      var nextFetch = fetchBand(bands[0], signal, onTile);
      for (var b = 0; b < bands.length; b += 1) {
        var band = bands[b];
        var images = await nextFetch;
        // Fetch the next band while this one is drawn and encoded.
        nextFetch = b + 1 < bands.length ? fetchBand(bands[b + 1], signal, onTile) : null;
        pendingFetch = nextFetch;
        if (nextFetch) {
          nextFetch.catch(function () {});
        }

        for (var sliceY = band.y0; sliceY < band.y1; sliceY += MAX_BAND_HEIGHT) {
          var sliceEnd = Math.min(band.y1, sliceY + MAX_BAND_HEIGHT);
          var sliceHeight = sliceEnd - sliceY;
          var chunks = [];

          for (var x0 = 0; x0 < width; x0 += CHUNK_WIDTH) {
            var chunkWidth = Math.min(CHUNK_WIDTH, width - x0);
            chunkCanvas.width = chunkWidth;
            chunkCanvas.height = sliceHeight;
            chunkCtx.fillStyle = "#ffffff";
            chunkCtx.fillRect(0, 0, chunkWidth, sliceHeight);
            for (var t = 0; t < band.tiles.length; t += 1) {
              var tile = band.tiles[t];
              if (tile.dx < x0 + chunkWidth && tile.dx + tile.dw > x0 && tile.dy < sliceEnd && tile.dy + tile.dh > sliceY) {
                drawTileOffset(chunkCtx, images[t], tile, x0, sliceY);
              }
            }
            chunks.push({ x0: x0, width: chunkWidth, data: chunkCtx.getImageData(0, 0, chunkWidth, sliceHeight).data });
            var px0 = Math.floor(x0 * previewScale);
            var py0 = Math.floor(sliceY * previewScale);
            var px1 = Math.ceil((x0 + chunkWidth) * previewScale);
            var py1 = Math.ceil(sliceEnd * previewScale);
            previewCtx.drawImage(chunkCanvas, 0, 0, chunkWidth, sliceHeight, px0, py0, Math.max(1, px1 - px0), Math.max(1, py1 - py0));
          }

          for (var row = 0; row < sliceHeight; row += 1) {
            await grouper.add(chunks, row);
          }
          if (writeFailure) {
            throw writeFailure;
          }
          if (signal.aborted) {
            throw new DOMException("Stopped", "AbortError");
          }
        }
        images.forEach(function (image) { cleanupLoadedImage(image); });
      }

      setProgress(totalTiles, totalTiles, "Finishing the file");
      await grouper.flush();
      await encoder.finish();
      await writeQueue;
      if (writeFailure) {
        throw writeFailure;
      }

      var blob = await sink.close();
      if (blob) {
        enableDownloadFile(blob, fileName);
        writeLog("Download ready: " + formatBytes(blob.size) + ".");
      } else {
        showAlert("Saved " + fileName + " at full resolution, " + formatNumber(width) + " × " + formatNumber(height) + ".", "neutral");
        writeLog("Saved " + fileName + ".");
      }
      setProgress(totalTiles, totalTiles, "Done");
    } catch (error) {
      encoder.close();
      if (pendingFetch) {
        pendingFetch.then(function (list) { list.forEach(cleanupLoadedImage); }, function () {});
      }
      await sink.abort();
      if (error.name === "AbortError") {
        setProgress(doneTiles, totalTiles, "Stopped");
        writeLog("Stopped.");
      } else {
        setProgress(doneTiles, totalTiles, "Failed");
        showAlert(toFriendlyError(error), "warning");
        writeLog(toFriendlyError(error));
      }
      if (els.save) {
        els.save.hidden = false;
      }
    } finally {
      activeController = null;
      setWorking(false);
    }
  }

  // A single image file: save the original bytes as they are. No decoding or
  // re-encoding, so nothing is lost and size doesn't matter.
  async function saveOriginal(toDisk) {
    if (!activePlan) {
      return;
    }
    var plan = activePlan;
    var type0 = plan.mimeType || "image/jpeg";
    var sink = null;
    if (toDisk === true) {
      // Ask first, while the click still counts as a user gesture.
      try {
        sink = await openSink(getFileName(plan) + getExtension(type0), type0);
      } catch (error) {
        if (error.name !== "AbortError") {
          showAlert(toFriendlyError(error), "warning");
        }
        return;
      }
      if (els.save) {
        els.save.hidden = true;
      }
    }

    if (activeController) {
      activeController.abort();
    }
    activeController = new AbortController();
    var signal = activeController.signal;

    clearAlert();
    if (plan.note) {
      showAlert(plan.note, "neutral");
    }
    revokeDownload();
    setVisible(els.status, true);
    setVisible(els.progressWrap, true);
    setVisible(els.outputActions, false);
    setWorking(true);
    setProgress(0, 1, "Downloading the original");

    try {
      var response = await fetchResource(plan.tiles[0].url, signal, "Image request");
      var total = Number(response.headers.get("content-length")) || 0;
      var type = (response.headers.get("content-type") || "").split(";")[0].trim();
      var parts = [];
      var received = 0;

      if (response.body && response.body.getReader) {
        var reader = response.body.getReader();
        for (;;) {
          var result = await reader.read();
          if (result.done) {
            break;
          }
          if (sink) {
            await sink.write(result.value);
          } else {
            parts.push(result.value);
          }
          received += result.value.length;
          setProgress(received, total || received * 2, formatBytes(received) + (total ? " of " + formatBytes(total) : ""));
        }
      } else if (sink) {
        await sink.write(new Uint8Array(await response.arrayBuffer()));
      } else {
        parts.push(new Uint8Array(await response.arrayBuffer()));
      }

      if (sink) {
        var saved = await sink.close();
        if (saved) {
          enableDownloadFile(saved, getFileName(plan) + getExtension(type0));
        } else {
          showAlert("Saved the original file, " + formatNumber(plan.width) + " × " + formatNumber(plan.height) + ".", "neutral");
        }
        setProgress(1, 1, "Done");
        writeLog("Original saved: " + formatBytes(received) + ".");
        return;
      }

      if (!/^image\//.test(type)) {
        type = plan.mimeType || "image/jpeg";
      }
      var blob = new Blob(parts, { type: type });
      enableDownloadFile(blob, getFileName(plan) + getExtension(type));
      setProgress(1, 1, "Done");
      writeLog("Original ready: " + formatBytes(blob.size) + ".");

      // Show it, when it's small enough for the browser to decode.
      if (plan.width * plan.height <= MAX_CANVAS_PIXELS) {
        setVisible(els.preview, true);
        try {
          var bitmap = await createImageBitmap(blob);
          var scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
          els.canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          els.canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          els.canvas.style.aspectRatio = bitmap.width + " / " + bitmap.height;
          var ctx = els.canvas.getContext("2d");
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(bitmap, 0, 0, els.canvas.width, els.canvas.height);
          bitmap.close();
        } catch (_previewError) {
          setVisible(els.preview, false);
        }
      }
      setVisible(els.outputActions, true);
      setVisible(els.preview, true);
    } catch (error) {
      if (sink) {
        await sink.abort();
      }
      if (error.name === "AbortError") {
        setProgress(0, 1, "Stopped");
      } else {
        setProgress(0, 1, "Failed");
        showAlert(toFriendlyError(error), "warning");
        writeLog(toFriendlyError(error));
      }
    } finally {
      activeController = null;
      setWorking(false);
    }
  }

  // ── Image dimensions from file headers ──
  // Reading the size from the first bytes means a 30,000-pixel original never
  // has to be decoded (which browsers often can't do) just to measure it.

  async function readImageSize(url, signal) {
    var response = await fetchResource(url, signal, "Image request");
    if (!response.body || !response.body.getReader) {
      return null;
    }
    var reader = response.body.getReader();
    var bytes = new Uint8Array(0);
    var type = (response.headers.get("content-type") || "").split(";")[0].trim();
    try {
      while (bytes.length < 4 * 1024 * 1024) {
        var result = await reader.read();
        if (result.done) {
          break;
        }
        var merged = new Uint8Array(bytes.length + result.value.length);
        merged.set(bytes);
        merged.set(result.value, bytes.length);
        bytes = merged;
        var size = parseImageSize(bytes);
        if (size) {
          size.mimeType = size.mimeType || type;
          size.bytes = Number(response.headers.get("content-length")) || 0;
          return size;
        }
      }
      return null;
    } finally {
      reader.cancel().catch(function () {});
    }
  }

  function parseImageSize(b) {
    function u16be(i) { return (b[i] << 8) | b[i + 1]; }
    function u32be(i) { return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; }
    function u16le(i) { return b[i] | (b[i + 1] << 8); }
    function u24le(i) { return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16); }

    if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      return { width: u32be(16), height: u32be(20), mimeType: "image/png" };
    }
    if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
      return { width: u16le(6), height: u16le(8), mimeType: "image/gif" };
    }
    if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
      var kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (kind === "VP8 ") {
        return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff, mimeType: "image/webp" };
      }
      if (kind === "VP8L") {
        return {
          width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
          height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
          mimeType: "image/webp"
        };
      }
      if (kind === "VP8X") {
        return { width: 1 + u24le(24), height: 1 + u24le(27), mimeType: "image/webp" };
      }
    }
    if (b.length >= 16 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 42))) {
      var little = b[0] === 0x49;
      var r16 = function (i) { return little ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]; };
      var r32 = function (i) { return little ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 16777216 : b[i] * 16777216 + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]); };
      var ifd = r32(4);
      if (ifd + 2 <= b.length) {
        var entries = r16(ifd);
        var tiffWidth = 0, tiffHeight = 0;
        for (var e = 0; e < entries && ifd + 2 + e * 12 + 12 <= b.length; e += 1) {
          var at = ifd + 2 + e * 12;
          var tag = r16(at);
          var value = r16(at + 2) === 3 ? r16(at + 8) : r32(at + 8);
          if (tag === 256) tiffWidth = value;
          if (tag === 257) tiffHeight = value;
        }
        if (tiffWidth && tiffHeight) {
          return { width: tiffWidth, height: tiffHeight, mimeType: "image/tiff" };
        }
      }
    }
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
      var i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) {
          i += 1;
          continue;
        }
        var marker = b[i + 1];
        if (marker === 0xff) {
          i += 1;
          continue;
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: u16be(i + 7), height: u16be(i + 5), mimeType: "image/jpeg" };
        }
        i += 2 + u16be(i + 2);
      }
    }
    return null;
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
      if (!plan) {
        return;
      }
      if (isOriginalFile(plan) && plan.bytes > 300 * 1024 * 1024) {
        showAlert("The original file is " + formatBytes(plan.bytes) + ". " + (window.showSaveFilePicker ?
          "Medici will write it straight to a file on your disk." :
          "Your browser will hold it in memory while it downloads."), "neutral");
        setVisible(els.progressWrap, false);
        if (els.save) {
          els.save.textContent = "Save original · " + formatBytes(plan.bytes);
          els.save.hidden = false;
        }
      } else if (isOriginalFile(plan)) {
        saveOriginal();
      } else if (needsStreaming(plan)) {
        offerFullResolution(plan);
      } else {
        assemble();
      }
    });
  });

  if (els.assemble) {
    els.assemble.addEventListener("click", assemble);
  }

  if (els.save) {
    els.save.addEventListener("click", function () {
      if (isOriginalFile(activePlan)) {
        saveOriginal(true);
      } else {
        exportFullResolution();
      }
    });
  }

  if (els.output) {
    els.output.addEventListener("change", function () {
      if (els.save && !els.save.hidden && !isOriginalFile(activePlan)) {
        els.save.textContent = "Save full resolution · " + (getOutputType() === "image/png" ? "PNG" : "JPEG");
      }
    });
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
