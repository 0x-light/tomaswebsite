// Baseline JPEG encoder for Medici's full-resolution export.
//
// Images too large for a browser canvas are encoded a strip at a time. The
// file uses restart markers with an interval of one MCU row, so every 8-pixel
// row of blocks is an independent segment: several of these workers encode
// rows in parallel and the page stitches the segments together in order.
//
// Messages in:
//   { type: "init", quality }                     set up tables (1–100)
//   { type: "header", id, width, height }         -> { id, bytes } SOI…SOS
//   { type: "rows", id, width, rows, rgba }       -> { id, bytes } one MCU row (8 lines, RGBA)
// 4:4:4 sampling (no chroma subsampling), standard Huffman tables.

"use strict";

var ZIGZAG = [
  0, 1, 5, 6, 14, 15, 27, 28, 2, 4, 7, 13, 16, 26, 29, 42,
  3, 8, 12, 17, 25, 30, 41, 43, 9, 11, 18, 24, 31, 40, 44, 53,
  10, 19, 23, 32, 39, 45, 52, 54, 20, 22, 33, 38, 46, 51, 55, 60,
  21, 34, 37, 47, 50, 56, 59, 61, 35, 36, 48, 49, 57, 58, 62, 63
];

var Y_QT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99
];

var C_QT = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99
];

// Standard luminance tables (ITU T.81 Annex K), used for all three components.
var DC_COUNTS = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
var DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
var AC_COUNTS = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
var AC_VALUES = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa
];

var AAN = [1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.541196100, 0.275899379];

var yTable = new Uint8Array(64);   // zigzag order, for DQT
var cTable = new Uint8Array(64);
var yDivisors = new Float64Array(64);
var cDivisors = new Float64Array(64);
var dcCodes = buildCodes(DC_COUNTS, DC_VALUES);
var acCodes = buildCodes(AC_COUNTS, AC_VALUES);
var category = new Uint8Array(65535);
var bitValue = new Uint16Array(65535);

(function buildCategories() {
  var lower = 1, upper = 2;
  for (var cat = 1; cat <= 15; cat += 1) {
    for (var n = lower; n < upper; n += 1) {
      category[32767 + n] = cat;
      bitValue[32767 + n] = n;
    }
    for (var m = -(upper - 1); m <= -lower; m += 1) {
      category[32767 + m] = cat;
      bitValue[32767 + m] = upper - 1 + m;
    }
    lower <<= 1;
    upper <<= 1;
  }
})();

function buildCodes(counts, values) {
  var codes = [];
  var code = 0, k = 0;
  for (var len = 1; len <= 16; len += 1) {
    for (var i = 0; i < counts[len]; i += 1) {
      codes[values[k]] = { code: code, length: len };
      k += 1;
      code += 1;
    }
    code <<= 1;
  }
  return codes;
}

function setQuality(quality) {
  var q = Math.max(1, Math.min(100, Math.round(quality)));
  var scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  for (var i = 0; i < 64; i += 1) {
    yTable[ZIGZAG[i]] = clamp(Math.floor((Y_QT[i] * scale + 50) / 100), 1, 255);
    cTable[ZIGZAG[i]] = clamp(Math.floor((C_QT[i] * scale + 50) / 100), 1, 255);
  }
  var k = 0;
  for (var row = 0; row < 8; row += 1) {
    for (var col = 0; col < 8; col += 1) {
      yDivisors[k] = 1 / (yTable[ZIGZAG[k]] * AAN[row] * AAN[col] * 8);
      cDivisors[k] = 1 / (cTable[ZIGZAG[k]] * AAN[row] * AAN[col] * 8);
      k += 1;
    }
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ── Bit writer ──

var out = new Uint8Array(1 << 20);
var outLength = 0;
var bitBuffer = 0;
var bitCount = 0;

function ensure(extra) {
  if (outLength + extra <= out.length) return;
  var bigger = new Uint8Array(Math.max(out.length * 2, outLength + extra));
  bigger.set(out.subarray(0, outLength));
  out = bigger;
}

function writeByte(b) {
  ensure(1);
  out[outLength++] = b;
}

function writeBits(code, length) {
  bitBuffer = (bitBuffer << length) | code;
  bitCount += length;
  while (bitCount >= 8) {
    var b = (bitBuffer >>> (bitCount - 8)) & 0xff;
    writeByte(b);
    if (b === 0xff) writeByte(0);
    bitCount -= 8;
  }
  bitBuffer &= (1 << bitCount) - 1;
}

function flushBits() {
  if (bitCount > 0) writeBits((1 << (8 - bitCount)) - 1, 8 - bitCount);
}

function takeOutput() {
  var bytes = out.slice(0, outLength);
  outLength = 0;
  bitBuffer = 0;
  bitCount = 0;
  return bytes;
}

// ── Blocks ──

var block = new Float64Array(64);
var quantized = new Int32Array(64);
var zz = new Int32Array(64);

function fdctQuantize(data, divisors) {
  var i, o, t0, t1, t2, t3, t4, t5, t6, t7, t10, t11, t12, t13, z1, z2, z3, z4, z5, z11, z13;
  for (i = 0; i < 8; i += 1) {
    o = i * 8;
    t0 = data[o] + data[o + 7]; t7 = data[o] - data[o + 7];
    t1 = data[o + 1] + data[o + 6]; t6 = data[o + 1] - data[o + 6];
    t2 = data[o + 2] + data[o + 5]; t5 = data[o + 2] - data[o + 5];
    t3 = data[o + 3] + data[o + 4]; t4 = data[o + 3] - data[o + 4];
    t10 = t0 + t3; t13 = t0 - t3; t11 = t1 + t2; t12 = t1 - t2;
    data[o] = t10 + t11; data[o + 4] = t10 - t11;
    z1 = (t12 + t13) * 0.707106781;
    data[o + 2] = t13 + z1; data[o + 6] = t13 - z1;
    t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
    z5 = (t10 - t12) * 0.382683433;
    z2 = 0.541196100 * t10 + z5; z4 = 1.306562965 * t12 + z5; z3 = t11 * 0.707106781;
    z11 = t7 + z3; z13 = t7 - z3;
    data[o + 5] = z13 + z2; data[o + 3] = z13 - z2; data[o + 1] = z11 + z4; data[o + 7] = z11 - z4;
  }
  for (i = 0; i < 8; i += 1) {
    t0 = data[i] + data[i + 56]; t7 = data[i] - data[i + 56];
    t1 = data[i + 8] + data[i + 48]; t6 = data[i + 8] - data[i + 48];
    t2 = data[i + 16] + data[i + 40]; t5 = data[i + 16] - data[i + 40];
    t3 = data[i + 24] + data[i + 32]; t4 = data[i + 24] - data[i + 32];
    t10 = t0 + t3; t13 = t0 - t3; t11 = t1 + t2; t12 = t1 - t2;
    data[i] = t10 + t11; data[i + 32] = t10 - t11;
    z1 = (t12 + t13) * 0.707106781;
    data[i + 16] = t13 + z1; data[i + 48] = t13 - z1;
    t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
    z5 = (t10 - t12) * 0.382683433;
    z2 = 0.541196100 * t10 + z5; z4 = 1.306562965 * t12 + z5; z3 = t11 * 0.707106781;
    z11 = t7 + z3; z13 = t7 - z3;
    data[i + 40] = z13 + z2; data[i + 24] = z13 - z2; data[i + 8] = z11 + z4; data[i + 56] = z11 - z4;
  }
  for (i = 0; i < 64; i += 1) {
    var v = data[i] * divisors[i];
    quantized[i] = v > 0 ? (v + 0.5) | 0 : (v - 0.5) | 0;
  }
}

function encodeBlock(divisors, previousDc) {
  fdctQuantize(block, divisors);
  for (var i = 0; i < 64; i += 1) zz[ZIGZAG[i]] = quantized[i];

  var diff = zz[0] - previousDc;
  if (diff === 0) {
    writeBits(dcCodes[0].code, dcCodes[0].length);
  } else {
    var c = category[32767 + diff];
    writeBits(dcCodes[c].code, dcCodes[c].length);
    writeBits(bitValue[32767 + diff], c);
  }

  var end = 63;
  while (end > 0 && zz[end] === 0) end -= 1;
  if (end === 0) {
    writeBits(acCodes[0].code, acCodes[0].length);
    return zz[0];
  }

  var k = 1;
  while (k <= end) {
    var start = k;
    while (zz[k] === 0 && k <= end) k += 1;
    var zeros = k - start;
    while (zeros >= 16) {
      writeBits(acCodes[0xf0].code, acCodes[0xf0].length);
      zeros -= 16;
    }
    var value = zz[k];
    var cat = category[32767 + value];
    var symbol = (zeros << 4) + cat;
    writeBits(acCodes[symbol].code, acCodes[symbol].length);
    writeBits(bitValue[32767 + value], cat);
    k += 1;
  }
  if (end !== 63) writeBits(acCodes[0].code, acCodes[0].length);
  return zz[0];
}

// One MCU row: 8 lines of RGBA (fewer on the last row; repeated to fill).
function encodeRows(width, rows, rgba) {
  var blocksAcross = Math.ceil(width / 8);
  var dcY = 0, dcCb = 0, dcCr = 0;
  var yBlock = new Float64Array(64), cbBlock = new Float64Array(64), crBlock = new Float64Array(64);

  for (var bx = 0; bx < blocksAcross; bx += 1) {
    var x0 = bx * 8;
    var k = 0;
    for (var y = 0; y < 8; y += 1) {
      var row = y < rows ? y : rows - 1;
      var rowStart = row * width * 4;
      for (var x = 0; x < 8; x += 1) {
        var px = x0 + x < width ? x0 + x : width - 1;
        var p = rowStart + px * 4;
        var r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
        yBlock[k] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
        cbBlock[k] = -0.16874 * r - 0.33126 * g + 0.5 * b;
        crBlock[k] = 0.5 * r - 0.41869 * g - 0.08131 * b;
        k += 1;
      }
    }
    block.set(yBlock); dcY = encodeBlock(yDivisors, dcY);
    block.set(cbBlock); dcCb = encodeBlock(cDivisors, dcCb);
    block.set(crBlock); dcCr = encodeBlock(cDivisors, dcCr);
  }
  flushBits();
  return takeOutput();
}

function header(width, height) {
  var bytes = [];
  function word(v) { bytes.push((v >> 8) & 0xff, v & 0xff); }

  bytes.push(0xff, 0xd8);                                   // SOI
  bytes.push(0xff, 0xe0); word(16);                          // APP0 JFIF
  bytes.push(0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0); word(1); word(1); bytes.push(0, 0);

  bytes.push(0xff, 0xdb); word(132);                         // DQT
  bytes.push(0); for (var i = 0; i < 64; i += 1) bytes.push(yTable[i]);
  bytes.push(1); for (var j = 0; j < 64; j += 1) bytes.push(cTable[j]);

  bytes.push(0xff, 0xc0); word(17); bytes.push(8);           // SOF0
  word(height); word(width); bytes.push(3);
  bytes.push(1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1);

  bytes.push(0xff, 0xc4); word(2 + 17 + DC_VALUES.length + 17 + AC_VALUES.length);   // DHT
  bytes.push(0x00); for (var a = 1; a <= 16; a += 1) bytes.push(DC_COUNTS[a]); DC_VALUES.forEach(function (v) { bytes.push(v); });
  bytes.push(0x10); for (var b = 1; b <= 16; b += 1) bytes.push(AC_COUNTS[b]); AC_VALUES.forEach(function (v) { bytes.push(v); });

  bytes.push(0xff, 0xdd); word(4); word(Math.ceil(width / 8)); // DRI: one MCU row

  bytes.push(0xff, 0xda); word(12); bytes.push(3);           // SOS
  bytes.push(1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0);
  return new Uint8Array(bytes);
}

self.onmessage = function (event) {
  var msg = event.data;
  if (msg.type === "init") {
    setQuality(msg.quality || 95);
    return;
  }
  if (msg.type === "header") {
    var h = header(msg.width, msg.height);
    self.postMessage({ id: msg.id, bytes: h.buffer }, [h.buffer]);
    return;
  }
  if (msg.type === "rows") {
    var bytes = encodeRows(msg.width, msg.rows, new Uint8ClampedArray(msg.rgba));
    self.postMessage({ id: msg.id, bytes: bytes.buffer }, [bytes.buffer]);
  }
};

setQuality(95);
