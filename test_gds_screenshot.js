"use strict";
/* test_gds_screenshot.js — regression test for the 2026-08-28 bug report:
 *
 *   "AI CONVERTING (attachment)… taking a very long time"
 *   "1 FM 107   ???? ???? Y 738 0.00 0 N / DEP-??? / ARR-??? / CABIN-ECONOMY"
 *   "Segment count discrepancy: direct found 0, AI found 6"
 *
 * A GDS / Black-Screen-style screenshot (3 flights, amber monospace on black,
 * phone resolution) must convert OFFLINE and instantly. Previously the
 * deterministic engine could not repair the OCR glyph confusions on that
 * class of image (AUC=AUG, OISEP=01SEP, sosP=505P, +1 read as +_, E7S=E75),
 * so the app fell back to a slow AI network call that returned garbage.
 *
 * Covered:
 *   1. Engine: OCR-mangled GDS lines parse to correct segments
 *   2. E2E: drop a realistic GDS phone screenshot -> 3 correct segments,
 *      offline, fast (the attachment pipeline is the real app.js code)
 *   3. E2E rescue: full-frame OCR failing -> overlapping band re-scan
 *      still recovers all 3 segments offline
 *   4. AI fallback speed: a previously saved model is tried immediately
 *      (no blocking model-list round trip) and model fallback is bounded
 *   5. AI garbage reply is flagged, not dressed up as success
 *   6. Speculative AI fallback: when direct OCR is still grinding, the AI
 *      call starts in PARALLEL (~1.5s) instead of after the full ~14.5s
 *      serial gauntlet (passes + rescue) — and whichever side produces the
 *      trustworthy answer first wins:
 *        6a. undetected image  -> AI paints early, exactly one AI call,
 *            still-running direct passes abort at the next boundary
 *        6b. slow direct read  -> direct paints, the late speculative AI
 *            reply is ignored
 *        6c. junk direct read (???? placeholders) -> AI auto re-reads and
 *            replaces the placeholders without a manual press
 *   7. Welcome screen asks for the API-generated key first (save+start,
 *      nudge without a key, offline escape hatch, built markup)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execSync, execFileSync } = require("child_process");

let PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("PASS:", msg); }
  else { FAIL++; console.error("FAIL:", msg); }
}

const REPO = __dirname;
const E = require(path.join(REPO, "spicy_engine.js"));
const REAL_OCRAD = require(path.join(REPO, "ocrad.js"));

/* ---------- the real cleanOcrText from app.js (evaluated in a sandbox) ---------- */
function loadCleaner() {
  const appSrc = fs.readFileSync(path.join(REPO, "app.js"), "utf8");
  const start = appSrc.indexOf("var _cleanAirlines = []");
  const end = appSrc.indexOf("/* ---------- bounded, non-blocking screenshot OCR ---------- */");
  if (start < 0 || end < 0) throw new Error("cleaner markers not found in app.js");
  const sandbox = {
    console,
    window: {},
    SPICY_DATA: require(path.join(REPO, "spicy_data.js")),
    document: { createElement: () => ({ textContent: "", innerHTML: "" }) },
    localStorage: { getItem: () => null, setItem: () => {} },
    loadLearnedRules: () => [],
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(appSrc.slice(start, end), sandbox, { filename: "cleaner.js" });
  vm.runInContext("this.__clean = cleanOcrText;", sandbox);
  return sandbox.__clean;
}
const cleanOcrText = loadCleaner();

/* ================= 1. Engine: OCR-mangled GDS lines ================= */
console.log("=== 1. Engine: OCR-mangled GDS rows from real screenshots ===");

function checkRow(label, raw, want) {
  const [segs, warns] = E.parse(cleanOcrText(raw));
  assert(segs.length >= 1, `${label}: parsed ${segs.length} segment(s)`);
  if (!segs.length) return null;
  const s = segs[0];
  for (const k of Object.keys(want)) {
    assert(s[k] === want[k], `${label}: ${k} = ${JSON.stringify(s[k])} (want ${JSON.stringify(want[k])})`);
  }
  return s;
}

checkRow("UA mangled flight + month + clock + acft",
  "l UA s9l8 31AUC ORD YYZ 43sP 737P N E7S z.\nCABIN-ECONOMY",
  { airline: "UA", flight_no: "5918", date_ddmmm: "31AUG", orig: "ORD", dest: "YYZ",
    dep_time: "435P", arr_time: "737P", booking_class: "N", aircraft: "E75", flight_time: "2.02" });

checkRow("AC +_ overnight marker + 9z0 flight",
  "z AC 9z0 31AUC YYZ ATH 910P 140P+_ D 789 9\nCABIN-BUSINESS",
  { airline: "AC", flight_no: "920", date_ddmmm: "31AUG", orig: "YYZ", dest: "ATH",
    dep_time: "910P", arr_time: "140P", arr_day_shift: 1, booking_class: "D", aircraft: "789" });

checkRow("A3 OISEP date + sosP clock + z class + 3ZN acft + z.o duration",
  "3 A3 934 OISEP ATH CAI sosP 70sP z 3ZN z.o\nCABIN-BUSINESS",
  { airline: "A3", flight_no: "934", date_ddmmm: "01SEP", orig: "ATH", dest: "CAI",
    dep_time: "505P", arr_time: "705P", booking_class: "Z", aircraft: "32N", flight_time: "2.00" });

checkRow("previous-day marker 925P¥-1 still works",
  "1 CX 888 14MAY HKG YVR 1245A 925P¥-1 I 359 11.40 6381 N",
  { airline: "CX", flight_no: "888", date_ddmmm: "14MAY", orig: "HKG", dest: "YVR",
    dep_time: "1245A", arr_time: "925P", arr_day_shift: -1, booking_class: "I" });

checkRow("three mangled rows together, chronological",
  "l UA s9l8 31AUC ORD YYZ 43sP 737P N E7S z.\nDEP-CHICAGO O HARE INTL\nARR-TORONTO PEARSON INTL\n<ABIN-ECONOMY\n\n" +
  "z AC 9z0 31AUC YYZ ATH 910P 140P+_ D 789 9\nDEP-TORONTO PEARSON INTL\nARR-ATHENS ELEFTHERIOS VENIZELOS\n<ABIN-BUSINESS\n\n" +
  "3 A3 934 OISEP ATH CAI sosP 70sP z 3ZN z.o\nDEP-ATHENS ELEFTHERIOS VENIZELOS\nARR-CAIRO INTL\n<ABIN-BUSINESS",
  { airline: "UA", flight_no: "5918" });
{
  const [segs] = E.parse(cleanOcrText(
    "l UA s9l8 31AUC ORD YYZ 43sP 737P N E7S z.\n\nz AC 9z0 31AUC YYZ ATH 910P 140P+_ D 789 9\n\n3 A3 934 OISEP ATH CAI sosP 70sP z 3ZN z.o"));
  assert(segs.length === 3, `three mangled rows: 3 segments (got ${segs.length})`);
  if (segs.length === 3) {
    assert(segs.map(s => s.airline + " " + s.flight_no).join(" | ") === "UA 5918 | AC 920 | A3 934",
      "three mangled rows: order + identity " + segs.map(s => s.airline + " " + s.flight_no).join(" | "));
    const rendered = E.renderItinerary(segs);
    assert(rendered.includes("140P\u00a51"), "three mangled rows: +1 day rendered as ¥1");
    assert(!/DEP-\?{3}|ARR-\?{3}/.test(rendered), "three mangled rows: no ??? airports");
  }
}

/* ================= image fixture ================= */
const IMG = "/tmp/spicy_gds_phone.png";
function buildGdsScreenshot() {
  const lines = [
    [120, "1 UA 5918 31AUG ORD YYZ 435P 737P N E75 2.02 437"],
    [200, "DEP-CHICAGO O HARE INTL"],
    [280, "ARR-TORONTO PEARSON INTL"],
    [360, "CABIN-ECONOMY"],
    [520, "2 AC 920 31AUG YYZ ATH 910P 140P+1 D 789 9.30 4968"],
    [600, "DEP-TORONTO PEARSON INTL"],
    [680, "ARR-ATHENS ELEFTHERIOS VENIZELOS"],
    [760, "CABIN-BUSINESS"],
    [920, "3 A3 934 01SEP ATH CAI 505P 705P Z 32N 2.00 694"],
    [1000, "DEP-ATHENS ELEFTHERIOS VENIZELOS"],
    [1080, "ARR-CAIRO INTL"],
    [1160, "CABIN-BUSINESS"],
  ];
  const args = ["-size", "1080x2340", "xc:black", "-font", "DejaVu-Sans-Mono", "-pointsize", "42",
    "-fill", "#ffb000", "-antialias", "-gravity", "NorthWest"];
  for (const [y, t] of lines) args.push("-draw", `text 30,${y} "${t}"`);
  args.push("-depth", "8", IMG);
  execFileSync("convert", args);
}
buildGdsScreenshot();

/* ---------- PNG decoder (8-bit, from test_attachment_pipeline.js) ---------- */
function decodePng(buf) {
  const zlib = require("zlib");
  let pos = 8, w = 0, h = 0, colorType = 0, plte = null, trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[10] !== 0 || data[12] !== 0) throw new Error("unsupported PNG");
      colorType = data[9];
    } else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error("unsupported PNG color type " + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const outLines = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0, p = 0; y < h; y++, p += stride + 1) {
    const filter = raw[p];
    const cur = outLines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = raw[p + 1 + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
    prev = cur;
  }
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r = 0, g = 0, b = 0, al = 255;
    if (colorType === 0) r = g = b = outLines[i];
    else if (colorType === 2) { r = outLines[i * 3]; g = outLines[i * 3 + 1]; b = outLines[i * 3 + 2]; }
    else if (colorType === 6) { r = outLines[i * 4]; g = outLines[i * 4 + 1]; b = outLines[i * 4 + 2]; al = outLines[i * 4 + 3]; }
    else { const ix = outLines[i] * 3; r = plte[ix]; g = plte[ix + 1]; b = plte[ix + 2]; if (trns && trns[outLines[i]] !== undefined) al = trns[outLines[i]]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = al;
  }
  return { w, h, rgba };
}

/* ---------- DOM / canvas / browser stubs (drawImage supports 9-arg crops) ---------- */
const pixelRegistry = new Map();
const canvasSources = new WeakMap();

function parseColor(css) {
  if (typeof css === "string" && css[0] === "#") {
    const v = css.length === 4
      ? css.slice(1).split("").map(c => parseInt(c + c, 16))
      : [parseInt(css.slice(1, 3), 16), parseInt(css.slice(3, 5), 16), parseInt(css.slice(5, 7), 16)];
    return v;
  }
  return [0, 0, 0];
}

function makeCanvas(w, h) {
  const cv = { width: w || 0, height: h || 0, style: {} };
  let buf = new Uint8ClampedArray(0);
  const ensure = () => {
    const n = Math.max(0, (cv.width | 0) * (cv.height | 0) * 4);
    if (buf.length !== n) buf = new Uint8ClampedArray(n);
  };
  canvasSources.set(cv, () => { ensure(); return { w: cv.width, h: cv.height, rgba: buf }; });
  const ctx = {
    canvas: cv,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
    fillStyle: "#000000",
    fillRect(x, y, ww, hh) {
      ensure();
      const px = parseColor(this.fillStyle);
      for (let yy = Math.max(0, y | 0); yy < Math.min(cv.height, (y + hh) | 0); yy++)
        for (let xx = Math.max(0, x | 0); xx < Math.min(cv.width, (x + ww) | 0); xx++) {
          const o = (yy * cv.width + xx) * 4;
          buf[o] = px[0]; buf[o + 1] = px[1]; buf[o + 2] = px[2]; buf[o + 3] = 255;
        }
    },
    drawImage(src, ...args) {
      ensure();
      let sp = null;
      if (src && src.__pixels) sp = src.__pixels;
      else if (src && canvasSources.has(src)) sp = canvasSources.get(src)();
      if (!sp) throw new Error("drawImage: source has no pixels");
      // canvas API: drawImage(img, dx, dy, dw, dh) or
      // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) — `args` excludes img.
      let sx = 0, sy = 0, sw = sp.w, sh = sp.h, dx = 0, dy = 0, dw = sp.w, dh = sp.h;
      if (args.length === 4) { dx = args[0]; dy = args[1]; dw = args[2]; dh = args[3]; }
      else if (args.length === 8) { sx = args[0]; sy = args[1]; sw = args[2]; sh = args[3]; dx = args[4]; dy = args[5]; dw = args[6]; dh = args[7]; }
      const x0o = Math.max(0, dx | 0), y0o = Math.max(0, dy | 0);
      const x1o = Math.min(cv.width, (dx + dw) | 0), y1o = Math.min(cv.height, (dy + dh) | 0);
      for (let yy = y0o; yy < y1o; yy++) {
        for (let xx = x0o; xx < x1o; xx++) {
          // Source coord: sx + scaled offset, clamped to the source image.
          const fx = Math.min(sp.w - 1, sx + Math.max(0, Math.min(sw - 1, ((xx - dx) + 0.5) * sw / dw - 0.5)));
          const fy = Math.min(sp.h - 1, sy + Math.max(0, Math.min(sh - 1, ((yy - dy) + 0.5) * sh / dh - 0.5)));
          const x0 = fx | 0, y0 = fy | 0, x1 = x0 + 1, y1 = y0 + 1;
          const ax = fx - x0, ay = fy - y0, bx = 1 - ax, by = 1 - ay;
          const o00 = (y0 * sp.w + x0) * 4, o10 = (y0 * sp.w + x1) * 4, o01 = (y1 * sp.w + x0) * 4, o11 = (y1 * sp.w + x1) * 4;
          const o = (yy * cv.width + xx) * 4;
          for (let c = 0; c < 4; c++) {
            const top = sp.rgba[o00 + c] * bx + sp.rgba[o10 + c] * ax;
            const bot = sp.rgba[o01 + c] * bx + sp.rgba[o11 + c] * ax;
            buf[o + c] = top * by + bot * ay;
          }
        }
      }
    },
    getImageData(x, y, ww, hh) {
      ensure();
      // The app only reads the whole canvas; keep that fast and honest.
      return { width: ww, height: hh, data: buf };
    },
    putImageData(img) {
      ensure();
      if (img && img.data) buf.set(img.data.length > buf.length ? img.data.subarray(0, buf.length) : img.data);
    },
  };
  cv.getContext = function () { return ctx; };
  cv.toDataURL = function (mime) {
    ensure();
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum = (sum * 31 + buf[i]) >>> 0;
    const b64 = Buffer.from("pix" + sum.toString(16) + "-" + cv.width + "x" + cv.height + "-" + (mime || "png")).toString("base64");
    const url = "data:" + (mime || "image/png") + ";base64," + b64;
    pixelRegistry.set(url, { w: cv.width, h: cv.height, rgba: new Uint8ClampedArray(buf) });
    return url;
  };
  return cv;
}

function makeEl(id) {
  const el = {
    id, value: "", _html: "", _text: "", title: "", className: "", files: null,
    _kids: [], _listeners: {}, _classes: new Set(),
  };
  el.classList = { add: c => el._classes.add(c), remove: c => el._classes.delete(c), contains: c => el._classes.has(c) };
  el.addEventListener = (t, fn) => { (el._listeners[t] = el._listeners[t] || []).push(fn); };
  el.fire = (t, ev) => { (el._listeners[t] || []).slice().forEach(fn => fn.call(el, ev || {})); };
  el.appendChild = c => { if (c) c.parentNode = el; el._kids.push(c); return c; };
  el.removeChild = c => { const i = el._kids.indexOf(c); if (i >= 0) el._kids.splice(i, 1); if (c) c.parentNode = null; return c; };
  el.focus = () => {}; el.select = () => {}; el.remove = () => { if (el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el); }; el.click = () => {};
  Object.defineProperty(el, "innerHTML", {
    get: () => (el._html !== "" ? el._html : el._text),
    set: v => { el._html = String(v); },
  });
  Object.defineProperty(el, "textContent", { get: () => el._text, set: v => { el._text = String(v); } });
  return el;
}

class FakeImage {
  constructor() { this.width = 0; this.height = 0; this.naturalWidth = 0; this.naturalHeight = 0; }
  set src(v) {
    this._src = v;
    const px = pixelRegistry.get(v);
    queueMicrotask(() => {
      if (px) {
        this.width = this.naturalWidth = px.w;
        this.height = this.naturalHeight = px.h;
        this.__pixels = px;
        if (this.onload) this.onload();
      } else if (this.onerror) this.onerror();
    });
  }
  get src() { return this._src; }
}

class FakeFileReader {
  readAsDataURL(file) {
    queueMicrotask(() => {
      const bytes = file && file.__bytes;
      if (!bytes) { if (this.onerror) this.onerror(new Error("no bytes")); return; }
      this.result = "data:" + ((file && file.type) || "application/octet-stream") + ";base64," + bytes.toString("base64");
      if (this.onload) this.onload({ target: this });
    });
  }
  readAsText(file) {
    queueMicrotask(() => {
      this.result = file && file.__bytes ? file.__bytes.toString("utf8") : "";
      if (this.onload) this.onload({ target: this });
    });
  }
}

function toAb(buf) { const ab = new ArrayBuffer(buf.length); new Uint8Array(ab).set(buf); return ab; }
function fakeFile(o) {
  const bytes = o.bytes || Buffer.from(String(o.text == null ? "" : o.text), "utf8");
  return {
    name: o.name || "attachment", type: o.type || "", size: bytes.length,
    __bytes: bytes, __pixels: o.pixels, __decodeDelayMs: o.decodeDelayMs || 0,
    arrayBuffer() { return Promise.resolve(toAb(bytes.subarray(0, 32))); },
    slice(start, end) {
      const s = Math.max(0, start || 0), e = Math.min(bytes.length, end == null ? bytes.length : end);
      const part = bytes.subarray(s, e);
      return { size: e - s, arrayBuffer() { return Promise.resolve(toAb(part)); }, text() { return Promise.resolve(Buffer.from(part).toString("utf8")); } };
    },
  };
}

/* ---------- app.js sandbox factory ---------- */
function makeSandbox(overrides) {
  const elements = {};
  const docListeners = {};
  const store = new Map();
  const fetchLog = [];
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    performance: { now: () => Date.now() },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    navigator: {},
    // The real page loads spicy_data.js before app.js; the cleaner's
    // airline/flight repair IIFE reads it at startup.
    SPICY_DATA: require(path.join(REPO, "spicy_data.js")),
    Image: FakeImage,
    FileReader: FakeFileReader,
    OCRAD: overrides.ocrad || REAL_OCRAD,
    SpicyEngine: E,
    createImageBitmap(file) {
      if (!file || !file.__pixels) return Promise.reject(new Error("no pixels"));
      return new Promise(resolve =>
        setTimeout(() => resolve({ width: file.__pixels.w, height: file.__pixels.h, __pixels: file.__pixels, close() {} }),
          file.__decodeDelayMs || 0));
    },
    fetch(url, opts) {
      fetchLog.push({ url: String(url), opts });
      return Promise.resolve(overrides.fetch ? overrides.fetch(String(url), opts || {}, fetchLog) : null);
    },
    window: null,
    document: null,
    _fetchLog: fetchLog,
    _store: store,
  };
  sandbox.window = sandbox;
  sandbox.document = {
    getElementById: id => elements[id] || (elements[id] = makeEl(id)),
    createElement: tag => (tag === "canvas" ? makeCanvas(0, 0) : makeEl("")),
    addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
    body: { appendChild() {}, removeChild() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(REPO, "app.js"), "utf8"), sandbox, { filename: "app.js" });
  return {
    sandbox, elements, docListeners,
    _store: store, _fetchLog: fetchLog,
    el: id => elements[id] || sandbox.document.getElementById(id),
    drop: files => (docListeners.drop || []).slice().forEach(fn => fn.call(sandbox.document,
      { preventDefault() {}, dataTransfer: { files, getData: () => "" } })),
    status: () => el_text("st"),
    out: () => el_text("out"),
  };
  function el_text(id) {
    const e = elements[id];
    return e ? (e._html !== "" ? e._html : e._text) : "";
  }
}

const gdsPixels = decodePng(fs.readFileSync(IMG));
const gdsFile = () => fakeFile({ name: "gds_screenshot.png", type: "image/png", pixels: gdsPixels });

async function waitUntil(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 30000)) {
    if (fn()) return true;
    await new Promise(r => setTimeout(r, 15));
  }
  return false;
}

const EXPECT_FLIGHTS = [
  ["UA 5918", "31AUG", "ORD", "YYZ", "435P", "737P", "E75", "2.02"],
  ["AC 920", "31AUG", "YYZ", "ATH", "910P", "140P\u00a51", "789", "9.30"],
  ["A3 934", "01SEP", "ATH", "CAI", "505P", "705P", "32N", "2.00"],
];

async function checkParsed(label) {
  const out = makeSandboxGlobal.out();
  for (const row of EXPECT_FLIGHTS) for (const piece of row) assert(out.includes(piece), `${label}: output has "${piece}"`);
  assert(!/DEP-\?{3}/.test(out), `${label}: no ??? airports`);
  assert(out.includes("<--additional-->"), `${label}: additional block present`);
}

let makeSandboxGlobal;

/* ================= 2. E2E: real pipeline, realistic screenshot ================= */
(async function main() {
  console.log("\n=== 2. E2E: GDS phone screenshot through the real attachment pipeline ===");
  makeSandboxGlobal = makeSandbox({});
  const t0 = Date.now();
  makeSandboxGlobal.drop([gdsFile()]);
  const ok = await waitUntil(() => /IMAGE PARSED|CACHED|FAILED|AI /.test(makeSandboxGlobal.status()), 60000);
  const ms = Date.now() - t0;
  assert(ok, `pipeline settled (status: "${makeSandboxGlobal.status()}")`);
  assert(/IMAGE PARSED/.test(makeSandboxGlobal.status()), `offline parse (status: "${makeSandboxGlobal.status()}")`);
  assert(!/AI/.test(makeSandboxGlobal.status()), `no AI fallback used (status: "${makeSandboxGlobal.status()}")`);
  assert(ms < 15000, `finished fast: ${ms}ms (< 15s)`);
  await checkParsed("e2e");

  console.log("\n=== 3. E2E rescue: full-frame OCR failing -> band re-scan ===");
  // Simulate an image OCRAD cannot read at full-frame size (the user's actual
  // failure: "direct found 0"). Bands are shorter -> the wrapper reads them.
  const rescueOcrad = function (image) {
    const h = image.height || (image.canvas && image.canvas.height) || 0;
    if (h >= 1000) return "";
    return REAL_OCRAD(image);
  };
  const rb = makeSandbox({ ocrad: rescueOcrad });
  rb.drop([gdsFile()]);
  const rok = await waitUntil(() => /IMAGE PARSED|CACHED|FAILED|AI /.test(rb.status()), 90000);
  assert(rok, `rescue pipeline settled (status: "${rb.status()}")`);
  assert(/IMAGE PARSED/.test(rb.status()), `rescue: offline band re-scan parsed (status: "${rb.status()}")`);
  assert(!/AI/.test(rb.status()), `rescue: still no AI fallback (status: "${rb.status()}")`);
  {
    const out = rb.out();
    for (const piece of ["UA 5918", "AC 920", "A3 934", "31AUG", "01SEP"]) assert(out.includes(piece), `rescue: output has "${piece}"`);
    assert(!/DEP-\?{3}/.test(out), "rescue: no ??? airports");
  }

  /* ================= 4. AI fallback speed ================= */
  console.log("\n=== 4. AI fallback: saved model first, bounded model walk ===");

  const gemOkBody = {
    candidates: [{ content: { parts: [{ text:
      "1 UA 5918 31AUG ORD YYZ 435P 737P N E75 2.02 437 N\nDEP-CHICAGO O HARE INTL\nARR-TORONTO PEARSON INTL\nCABIN-ECONOMY" }] } }],
  };
  const modelsList = {
    models: [
      { name: "models/gemini-3.7-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.4-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.3-flash", supportedGenerationMethods: ["generateContent"] },
    ],
  };

  // 4a. Saved model is used immediately — exactly one generateContent call,
  //     and no model-list request at all.
  {
    const s = makeSandbox({
      fetch(url, opts, log) {
        if (url.indexOf(":generateContent") >= 0) return { json: () => Promise.resolve(gemOkBody) };
        throw new Error("unexpected fetch: " + url);
      },
    });
    s._store.set("spicy_gem_key", "test-key");
    s._store.set("spicy_gem_model", "gemini-3.7-flash");
    s.el("inp").value = "UA 5918 31AUG ORD YYZ 435P 737P N E75 2.02 437 N";
    s.el("btnAi").fire("click");
    const done = await waitUntil(() => /AI CONVERTED|AI failed|INCOMPLETE/.test(s.status()), 30000);
    assert(done, `AI path settled (status: "${s.status()}")`);
    assert(/AI CONVERTED/.test(s.status()), `saved model converted (status: "${s.status()}")`);
    const genCalls = s._fetchLog.filter(f => f.url.indexOf(":generateContent") >= 0);
    const listCalls = s._fetchLog.filter(f => f.url.indexOf("pageSize") >= 0);
    assert(genCalls.length === 1, `exactly one generateContent call (got ${genCalls.length})`);
    assert(listCalls.length === 0, `no model-list round trip (got ${listCalls.length})`);
    assert(genCalls[0] && genCalls[0].url.indexOf("gemini-3.7-flash:generateContent") >= 0, "saved model was the one called");
  }

  // 4b. Saved model dead -> model list fetched once, fallback capped at 3 models.
  {
    const s = makeSandbox({
      fetch(url, opts, log) {
        if (url.indexOf("pageSize") >= 0) return { json: () => Promise.resolve(modelsList) };
        if (url.indexOf("gemini-3.7-flash:generateContent") >= 0)
          return { json: () => Promise.resolve({ error: { code: 404, message: "models/gemini-3.7-flash was not found" } }) };
        return { json: () => Promise.resolve(gemOkBody) }; // gemini-3.6-flash succeeds
      },
    });
    s._store.set("spicy_gem_key", "test-key");
    s._store.set("spicy_gem_model", "gemini-3.7-flash");
    s.el("inp").value = "UA 5918 31AUG ORD YYZ 435P 737P N E75 2.02 437 N";
    s.el("btnAi").fire("click");
    const done = await waitUntil(() => /AI CONVERTED|AI failed|INCOMPLETE/.test(s.status()), 30000);
    assert(done, `fallback path settled (status: "${s.status()}")`);
    assert(/AI CONVERTED/.test(s.status()), `fallback model converted (status: "${s.status()}")`);
    const genCalls = s._fetchLog.filter(f => f.url.indexOf(":generateContent") >= 0);
    const listCalls = s._fetchLog.filter(f => f.url.indexOf("pageSize") >= 0);
    assert(listCalls.length === 1, `model list fetched once (got ${listCalls.length})`);
    assert(genCalls.length <= 3, `model walk bounded to 3 (got ${genCalls.length})`);
    assert(genCalls[genCalls.length - 1].url.indexOf("gemini-3.6-flash") >= 0, "second model (3.6-flash) used");
  }

  /* ================= 5. AI garbage guard ================= */
  console.log("\n=== 5. AI garbage reply is flagged, not dressed up as success ===");
  {
    const s = makeSandbox({
      fetch(url, opts, log) {
        return { json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: "1 FM 107 ??? ??? Y 738 0.00 0 N\nDEP-???\nARR-???\nCABIN-ECONOMY" }] } }],
        }) };
      },
    });
    s._store.set("spicy_gem_key", "test-key");
    s._store.set("spicy_gem_model", "gemini-3.7-flash");
    s.el("inp").value = "some unreadable screenshot text";
    s.el("btnAi").fire("click");
    const done = await waitUntil(() => /AI CONVERTED|AI failed|INCOMPLETE/.test(s.status()), 30000);
    assert(done, `garbage path settled (status: "${s.status()}")`);
    assert(/INCOMPLETE/.test(s.status()), `garbage reply flagged (status: "${s.status()}")`);
    assert(!/^AI CONVERTED\b/.test(s.status()), "garbage reply not reported as clean success");
  }

  /* ================= 6. Speculative AI fallback race ================= */
  console.log("\n=== 6. Speculative AI fallback: AI starts in parallel with direct OCR ===");

  const busyWait = ms => { const t = Date.now(); while (Date.now() - t < ms) {} };
  const statsOf = s => { try { return JSON.parse(s._store.get("spicy_weekly_stats_v1") || "{}"); } catch (e) { return {}; } };
  const genCallsOf = s => s._fetchLog.filter(f => f.url.indexOf(":generateContent") >= 0);
  const GDS_CLEAN_TEXT = [
    "1 UA 5918 31AUG ORD YYZ 435P 737P N E75 2.02 437",
    "DEP-CHICAGO O HARE INTL",
    "ARR-TORONTO PEARSON INTL",
    "CABIN-ECONOMY",
    "",
    "2 AC 920 31AUG YYZ ATH 910P 140P+1 D 789 9.30 4968",
    "DEP-TORONTO PEARSON INTL",
    "ARR-ATHENS ELEFTHERIOS VENIZELOS",
    "CABIN-BUSINESS",
    "",
    "3 A3 934 01SEP ATH CAI 505P 705P Z 32N 2.00 694",
    "DEP-ATHENS ELEFTHERIOS VENIZELOS",
    "ARR-CAIRO INTL",
    "CABIN-BUSINESS",
  ].join("\n");

  // 6a. The weekly-report failure mode: "undetected attachment / direct found
  //     0". OCR grinds slowly and finds nothing; the AI call must START while
  //     direct is still working (t_gen well under the ~14.5s serial path),
  //     paint as soon as it returns, and remain the ONLY AI call.
  {
    const genAt = [];
    const s = makeSandbox({
      ocrad() { busyWait(1500); return ""; }, // slow, hopeless direct read
      fetch(url) {
        if (url.indexOf(":generateContent") >= 0) {
          genAt.push(Date.now());
          return { json: () => new Promise(r => setTimeout(() => r(gemOkBody), 1000)) };
        }
        throw new Error("unexpected fetch: " + url);
      },
    });
    s._store.set("spicy_gem_key", "test-key");
    s._store.set("spicy_gem_model", "gemini-3.7-flash");
    const tDrop = Date.now();
    s.drop([gdsFile()]);
    const done = await waitUntil(() => /AI CONVERTED|AI failed|IMAGE PARSED|NOT READ/.test(s.status()), 30000);
    assert(done, `6a: settled (status: "${s.status()}")`);
    assert(/AI CONVERTED/.test(s.status()), `6a: AI answered (status: "${s.status()}")`);
    const tGen = genAt[0] ? genAt[0] - tDrop : Infinity;
    assert(genAt.length === 1, `6a: exactly one generateContent call (got ${genAt.length})`);
    assert(tGen < 5000, `6a: AI call started in parallel after ${tGen}ms (< 5s; serial path was ~14.5s+)`);
    const totalMs = Date.now() - tDrop;
    assert(totalMs < 10000, `6a: whole conversion finished in ${totalMs}ms (< 10s; serial path was ~15s+)`);
    assert(s.out().includes("UA 5918"), "6a: AI itinerary painted");
    assert(!/IMAGE PARSED/.test(s.status()), `6a: no fake offline success (status: "${s.status()}")`);
    await new Promise(r => setTimeout(r, 2500)); // direct pipeline fully settles
    assert(genCallsOf(s).length === 1, `6a: still exactly one AI call after direct settled (got ${genCallsOf(s).length})`);
    assert(s.out().includes("UA 5918"), "6a: AI itinerary not overwritten by the failed direct re-read");
    const st = statsOf(s);
    assert((st.aiFallback || 0) === 1, `6a: ai_fallback stat recorded once (got ${st.aiFallback})`);
    assert(!(st.imgDirect > 0), "6a: no img_direct stat (direct never produced segments)");
  }

  // 6b. Direct re-read succeeds late (after the speculative call fired): the
  //     deterministic result must win and the late AI reply must be ignored.
  {
    let ocrCalls = 0;
    const s = makeSandbox({
      ocrad() { ocrCalls++; return ocrCalls <= 2 ? (busyWait(800), "") : GDS_CLEAN_TEXT; },
      fetch(url) {
        if (url.indexOf(":generateContent") >= 0)
          return { json: () => new Promise(r => setTimeout(() => r({
            candidates: [{ content: { parts: [{ text:
              "1 XX 9999 31AUG ORD YYZ 435P 737P N E75 2.02 437\nDEP-CHICAGO O HARE INTL\nARR-TORONTO PEARSON INTL\nCABIN-ECONOMY" }] } }], // must never appear
          }), 2000)) };
        throw new Error("unexpected fetch: " + url);
      },
    });
    s._store.set("spicy_gem_key", "test-key");
    s._store.set("spicy_gem_model", "gemini-3.7-flash");
    s.drop([gdsFile()]);
    const ignored = await waitUntil(() => /AI REPLY IGNORED — direct result kept/.test(s.status()), 30000);
    assert(ignored, `6b: late speculative reply ignored (status: "${s.status()}")`);
    assert(s.out().includes("UA 5918"), "6b: deterministic itinerary kept");
    assert(!s.out().includes("XX 9999"), "6b: AI duplicate never painted");
    assert(genCallsOf(s).length === 1, `6b: exactly one speculative AI call (got ${genCallsOf(s).length})`);
  }

  // 6c. Direct reads junk placeholders (mistake log: "1 FM 107 ???? ???? Y
  //     0.00 0 N / DEP-???"): AI re-reads automatically instead of waiting
  //     for the user to notice and press the button.
  {
    const s = makeSandbox({
      ocrad() { return "1 FM 107 ???? ???? Y 738 0.00 0 N\nDEP-???\nARR-???\nCABIN-ECONOMY"; },
      fetch(url) {
        if (url.indexOf(":generateContent") >= 0)
          return { json: () => Promise.resolve(gemOkBody) };
        throw new Error("unexpected fetch: " + url);
      },
    });
    s._store.set("spicy_gem_key", "test-key");
    s._store.set("spicy_gem_model", "gemini-3.7-flash");
    s.drop([gdsFile()]);
    const done = await waitUntil(() => /AI CONVERTED|AI failed/.test(s.status()), 30000);
    assert(done, `6c: settled (status: "${s.status()}")`);
    assert(/AI CONVERTED/.test(s.status()), `6c: auto AI re-read happened (status: "${s.status()}")`);
    assert(s.out().includes("UA 5918"), "6c: placeholders replaced by real itinerary");
    assert(!/DEP-\?{3}/.test(s.out()), "6c: no ??? airports remain");
    assert(genCallsOf(s).length === 1, `6c: exactly one AI call (got ${genCallsOf(s).length})`);
  }

  /* ================= 7. Welcome screen: API key first ================= */
  console.log("\n=== 7. Welcome screen asks for the API key first ===");

  // 7a. START without a key -> the card stays, a nudge appears (never a silent enter).
  {
    const s = makeSandbox({});
    s.el("enterBtn").fire("click");
    assert(!s.el("welcome")._classes.has("hidden"), "7a: welcome stays visible without a key");
    assert(/ADD YOUR API KEY FIRST/.test(s.status()), `7a: nudge shown (status: "${s.status()}")`);
    assert(/free and takes 20 seconds/.test(s.el("welcomeKeyWarn")._text), "7a: inline guidance points at Generate Api");
    assert(!s._store.has("spicy_seen"), "7a: not marked as seen");
  }

  // 7b. Paste the generated key -> saved, card closes, ready.
  {
    const s = makeSandbox({});
    s.el("gemKeyWelcome").value = "AIza-test-key-123";
    s.el("enterBtn").fire("click");
    assert(s._store.get("spicy_gem_key") === "AIza-test-key-123", "7b: key saved from the welcome card");
    assert(s.el("welcome")._classes.has("hidden"), "7b: welcome closed after saving");
    assert(s._store.get("spicy_seen") === "1", "7b: marked as seen");
    assert(/KEY SAVED/.test(s.status()), `7b: confirmed (status: "${s.status()}")`);
  }

  // 7c. Offline escape hatch -> app stays usable without a key.
  {
    const s = makeSandbox({});
    s.el("enterOffline").fire("click");
    assert(s.el("welcome")._classes.has("hidden"), "7c: welcome closed via offline link");
    assert(!s._store.has("spicy_gem_key"), "7c: no key stored");
    assert(/OFFLINE MODE/.test(s.status()), `7c: offline status (status: "${s.status()}")`);
  }

  // 7d. Built artifact carries the new welcome markup (key input + made-with-love).
  {
    const built = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
    assert(built.includes("gemKeyWelcome"), "7d: built index.html has the welcome key input");
    assert(/SAVE KEY &amp; START|SAVE KEY & START/.test(built), "7d: built index.html has SAVE KEY & START");
    assert(built.includes("enterOffline"), "7d: built index.html has the offline link");
    assert(/Made with .*love.* by Adham Badran/.test(built), "7d: built index.html mentions made with love");
    assert(built.includes("♥"), "7d: built index.html has the heart");
  }

  console.log(`\n=== SUMMARY: ${PASS} passed, ${FAIL} failed ===`);
  if (FAIL > 0) process.exit(1);
})().catch(e => { console.error("HARNESS ERROR:", e); process.exit(1); });
