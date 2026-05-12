const HELPER_FEATURES = ["proxy", "reader", "google-arts"];
const KEY = [91, 99, 219, 17, 59, 122, 243, 224, 177, 67, 85, 86, 200, 249, 83, 12];
const IV = [113, 231, 4, 5, 53, 58, 119, 139, 250, 111, 188, 48, 50, 27, 149, 146];
const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
const MUL_9 = new Uint8Array(256);
const MUL_11 = new Uint8Array(256);
const MUL_13 = new Uint8Array(256);
const MUL_14 = new Uint8Array(256);

initAesTables();
const GOOGLE_ROUND_KEYS = expandAes128Key(KEY);

export async function onRequest(context) {
  var request = context.request;
  var url = new URL(request.url);
  var route = url.pathname.replace(/^\/__medici__\/?/, "").split("/")[0] || "health";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return textResponse(request, 405, "Method not allowed");
  }
  if (route === "health") {
    return jsonResponse(request, { ok: true, version: 3, features: HELPER_FEATURES });
  }
  if (route === "proxy") {
    return serveProxy(request, url);
  }
  if (route === "reader") {
    return serveReader(request, url);
  }
  return textResponse(request, 404, "Not found");
}

function corsHeaders(request, extra) {
  var headers = new Headers(extra || {});
  var origin = allowedOrigin(request.headers.get("Origin"));

  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Range, User-Agent, Accept");
  headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Type, Content-Disposition, X-Medici-Reader, X-Medici-Upstream-Status");
  headers.set("Vary", "Origin");
  return headers;
}

function allowedOrigin(origin) {
  if (!origin) {
    return "*";
  }
  if (origin === "null") {
    return origin;
  }

  try {
    var url = new URL(origin);
    if (/^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname) ||
      url.hostname === "palmeirim.com" ||
      url.hostname.endsWith(".palmeirim.com")) {
      return origin;
    }
  } catch (_error) {
    return "";
  }

  return "";
}

function textResponse(request, status, body, headers) {
  return new Response(body, {
    status: status,
    headers: corsHeaders(request, Object.assign({ "Content-Type": "text/plain; charset=utf-8" }, headers || {}))
  });
}

function jsonResponse(request, body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: corsHeaders(request, { "Content-Type": "application/json; charset=utf-8" })
  });
}

function proxyHeaders(request, target) {
  var headers = {
    "Accept": request.headers.get("Accept") || "*/*",
    "Referer": target.origin + "/",
    "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0 Medici/1.0"
  };
  var range = request.headers.get("Range");

  if (range) {
    headers.Range = range;
  }

  return headers;
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
  if (isPrivateHostname(target.hostname)) {
    return { error: "Only public web URLs are supported" };
  }

  return { target: target };
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

async function serveProxy(request, url) {
  var validation = validatePublicHttpTarget(url.searchParams.get("url"));
  if (validation.error) {
    return textResponse(request, 400, validation.error);
  }

  var target = validation.target;
  try {
    var upstream = await fetch(target.href, {
      headers: proxyHeaders(request, target),
      method: request.method === "HEAD" ? "HEAD" : "GET",
      redirect: "follow"
    });

    if (request.method !== "HEAD" && upstream.ok && shouldDecryptGoogleTile(target)) {
      var body = new Uint8Array(await upstream.arrayBuffer());
      var decrypted = decryptGoogleTile(body);
      return new Response(decrypted, {
        status: upstream.status,
        headers: corsHeaders(request, {
          "Content-Type": upstream.headers.get("Content-Type") || "image/jpeg",
          "Content-Length": String(decrypted.byteLength),
          "X-Medici-Upstream-Status": String(upstream.status)
        })
      });
    }

    var headers = {
      "X-Medici-Upstream-Status": String(upstream.status)
    };
    ["Cache-Control", "Content-Disposition", "Content-Type", "Etag", "Last-Modified"].forEach(function (header) {
      var value = upstream.headers.get(header);
      if (value) {
        headers[header] = value;
      }
    });

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: corsHeaders(request, headers)
    });
  } catch (error) {
    return textResponse(request, 502, "Proxy fetch failed: " + error.message);
  }
}

async function serveReader(request, url) {
  var validation = validatePublicHttpTarget(url.searchParams.get("url"));
  if (validation.error) {
    return textResponse(request, 400, validation.error);
  }

  var target = validation.target;
  try {
    var upstream = await fetch("https://r.jina.ai/" + target.href, {
      headers: {
        "Accept": "text/html,text/plain,*/*",
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0 Medici/1.0",
        "X-Return-Format": "html"
      },
      method: request.method === "HEAD" ? "HEAD" : "GET",
      redirect: "follow"
    });
    var headers = {
      "X-Medici-Reader": "r.jina.ai",
      "X-Medici-Upstream-Status": String(upstream.status)
    };

    ["Cache-Control", "Content-Type", "Etag", "Last-Modified"].forEach(function (header) {
      var value = upstream.headers.get(header);
      if (value) {
        headers[header] = value;
      }
    });

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: corsHeaders(request, headers)
    });
  } catch (error) {
    return textResponse(request, 502, "Reader fetch failed: " + error.message);
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

  return concatBytes(
    buffer.subarray(4, encryptedSizeOffset),
    aesCbcDecrypt(buffer.subarray(encryptedStart, encryptedEnd), GOOGLE_ROUND_KEYS, IV),
    buffer.subarray(encryptedEnd, end)
  );
}

function concatBytes() {
  var parts = Array.prototype.slice.call(arguments);
  var total = parts.reduce(function (sum, part) {
    return sum + part.length;
  }, 0);
  var output = new Uint8Array(total);
  var offset = 0;

  parts.forEach(function (part) {
    output.set(part, offset);
    offset += part.length;
  });

  return output;
}

function aesCbcDecrypt(input, roundKeys, iv) {
  if (input.length % 16 !== 0) {
    throw new Error("AES-CBC payload length is invalid");
  }

  var output = new Uint8Array(input.length);
  var previous = Uint8Array.from(iv);

  for (var offset = 0; offset < input.length; offset += 16) {
    var block = input.subarray(offset, offset + 16);
    var decrypted = decryptAesBlock(block, roundKeys);
    for (var i = 0; i < 16; i += 1) {
      output[offset + i] = decrypted[i] ^ previous[i];
    }
    previous = block;
  }

  return output;
}

function expandAes128Key(key) {
  var expanded = new Uint8Array(176);
  var rcon = 1;
  var temp = new Uint8Array(4);

  expanded.set(key);
  for (var offset = 16; offset < 176; offset += 4) {
    temp.set(expanded.subarray(offset - 4, offset));

    if (offset % 16 === 0) {
      var first = temp[0];
      temp[0] = SBOX[temp[1]] ^ rcon;
      temp[1] = SBOX[temp[2]];
      temp[2] = SBOX[temp[3]];
      temp[3] = SBOX[first];
      rcon = gfMul(rcon, 2);
    }

    for (var i = 0; i < 4; i += 1) {
      expanded[offset + i] = expanded[offset - 16 + i] ^ temp[i];
    }
  }

  return expanded;
}

function decryptAesBlock(block, roundKeys) {
  var state = Uint8Array.from(block);

  addRoundKey(state, roundKeys, 10);
  for (var round = 9; round > 0; round -= 1) {
    invShiftRows(state);
    invSubBytes(state);
    addRoundKey(state, roundKeys, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  invSubBytes(state);
  addRoundKey(state, roundKeys, 0);

  return state;
}

function addRoundKey(state, roundKeys, round) {
  var offset = round * 16;
  for (var i = 0; i < 16; i += 1) {
    state[i] ^= roundKeys[offset + i];
  }
}

function invSubBytes(state) {
  for (var i = 0; i < 16; i += 1) {
    state[i] = INV_SBOX[state[i]];
  }
}

function invShiftRows(state) {
  var copy = Uint8Array.from(state);
  state[1] = copy[13];
  state[5] = copy[1];
  state[9] = copy[5];
  state[13] = copy[9];
  state[2] = copy[10];
  state[6] = copy[14];
  state[10] = copy[2];
  state[14] = copy[6];
  state[3] = copy[7];
  state[7] = copy[11];
  state[11] = copy[15];
  state[15] = copy[3];
}

function invMixColumns(state) {
  for (var column = 0; column < 4; column += 1) {
    var offset = column * 4;
    var a0 = state[offset];
    var a1 = state[offset + 1];
    var a2 = state[offset + 2];
    var a3 = state[offset + 3];

    state[offset] = MUL_14[a0] ^ MUL_11[a1] ^ MUL_13[a2] ^ MUL_9[a3];
    state[offset + 1] = MUL_9[a0] ^ MUL_14[a1] ^ MUL_11[a2] ^ MUL_13[a3];
    state[offset + 2] = MUL_13[a0] ^ MUL_9[a1] ^ MUL_14[a2] ^ MUL_11[a3];
    state[offset + 3] = MUL_11[a0] ^ MUL_13[a1] ^ MUL_9[a2] ^ MUL_14[a3];
  }
}

function initAesTables() {
  for (var value = 0; value < 256; value += 1) {
    var inverse = value ? gfPow(value, 254) : 0;
    var s = inverse ^ rotateByte(inverse, 1) ^ rotateByte(inverse, 2) ^ rotateByte(inverse, 3) ^ rotateByte(inverse, 4) ^ 0x63;
    SBOX[value] = s & 255;
    INV_SBOX[SBOX[value]] = value;
    MUL_9[value] = gfMul(9, value);
    MUL_11[value] = gfMul(11, value);
    MUL_13[value] = gfMul(13, value);
    MUL_14[value] = gfMul(14, value);
  }
}

function rotateByte(value, amount) {
  return ((value << amount) | (value >> (8 - amount))) & 255;
}

function gfPow(value, power) {
  var result = 1;
  var base = value;

  while (power > 0) {
    if (power & 1) {
      result = gfMul(result, base);
    }
    base = gfMul(base, base);
    power >>= 1;
  }

  return result;
}

function gfMul(a, b) {
  var result = 0;
  var left = a;
  var right = b;

  while (right > 0) {
    if (right & 1) {
      result ^= left;
    }
    left <<= 1;
    if (left & 0x100) {
      left ^= 0x11b;
    }
    right >>= 1;
  }

  return result & 255;
}
