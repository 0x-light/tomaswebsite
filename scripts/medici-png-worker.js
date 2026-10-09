// Streaming PNG encoder for Medici's lossless full-resolution export.
//
// Rows arrive in order; each is filtered (Paeth) and fed to the browser's
// built-in deflate (CompressionStream), and every compressed piece is posted
// back immediately as an IDAT chunk, so the whole image never sits in memory.
//
// Messages in:
//   { type: "start", width, height }         -> { kind: "data", bytes } signature + IHDR
//   { type: "rows", id, rows, rgba }         -> { kind: "ack", id } once accepted
//   { type: "end" }                          -> { kind: "data" } … then { kind: "done" }
// Output is 8-bit RGB (no alpha).

"use strict";

var CRC_TABLE = (function () {
  var table = new Uint32Array(256);
  for (var n = 0; n < 256; n += 1) {
    var c = n;
    for (var k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes, crc) {
  crc = crc === undefined ? 0xffffffff : crc;
  for (var i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}

function chunk(type, data) {
  var out = new Uint8Array(12 + data.length);
  var view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (var i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

function post(bytes) {
  self.postMessage({ kind: "data", bytes: bytes.buffer }, [bytes.buffer]);
}

var width = 0;
var writer = null;
var reading = null;
var previous = null;   // previous row, RGB

function start(w, h) {
  width = w;
  previous = new Uint8Array(w * 3);
  var signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  var ihdr = new Uint8Array(13);
  var view = new DataView(ihdr.buffer);
  view.setUint32(0, w);
  view.setUint32(4, h);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // RGB
  var head = chunk("IHDR", ihdr);
  var first = new Uint8Array(signature.length + head.length);
  first.set(signature);
  first.set(head, signature.length);
  post(first);

  var stream = new CompressionStream("deflate");   // zlib format, as PNG expects
  writer = stream.writable.getWriter();
  var reader = stream.readable.getReader();
  reading = (async function () {
    for (;;) {
      var result = await reader.read();
      if (result.done) break;
      post(chunk("IDAT", result.value));
    }
  })();
}

function paeth(a, b, c) {
  var p = a + b - c;
  var pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

async function rows(count, rgba) {
  var stride = width * 3;
  var filtered = new Uint8Array(count * (stride + 1));
  var current = new Uint8Array(stride);
  for (var r = 0; r < count; r += 1) {
    var src = r * width * 4;
    for (var x = 0, j = 0; x < width; x += 1, j += 3) {
      current[j] = rgba[src + x * 4];
      current[j + 1] = rgba[src + x * 4 + 1];
      current[j + 2] = rgba[src + x * 4 + 2];
    }
    var o = r * (stride + 1);
    filtered[o] = 4;   // Paeth
    for (var i = 0; i < stride; i += 1) {
      var left = i >= 3 ? current[i - 3] : 0;
      var upLeft = i >= 3 ? previous[i - 3] : 0;
      filtered[o + 1 + i] = (current[i] - paeth(left, previous[i], upLeft)) & 0xff;
    }
    var swap = previous; previous = current; current = swap;
  }
  await writer.write(filtered);
}

self.onmessage = async function (event) {
  var msg = event.data;
  if (msg.type === "start") {
    start(msg.width, msg.height);
  } else if (msg.type === "rows") {
    await rows(msg.rows, new Uint8Array(msg.rgba));
    self.postMessage({ kind: "ack", id: msg.id });
  } else if (msg.type === "end") {
    await writer.close();
    await reading;
    post(chunk("IEND", new Uint8Array(0)));
    self.postMessage({ kind: "done" });
  }
};
