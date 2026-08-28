"use strict";
/* test_attachment_pipeline.js — end-to-end test of the REAL browser
   attachment pipeline inside app.js, executed headlessly.

   The app.js bundle is evaluated in a vm sandbox with DOM, canvas, Image,
   FileReader, clipboard and createImageBitmap stubs.  The tests then drive
   the exact event handlers the browser uses (drop, file-picker change,
   paste, Convert, Clear) and assert on the produced output text, the status
   bar and the attachment thumbnails.

   Covered:
     1. single screenshot drop  -> offline OCR -> rendered itinerary
     2. multiple images in one drop -> merged in attachment order
     3. reversed order           -> order still follows attachment order
     4. clipboard screenshot paste
     5. repeated image           -> served from the instant image cache
     6. text file attachment     -> appended and converted
     7. nameless file (no MIME, no extension, PNG magic) -> signature route
     8. PDF without a Gemini key -> clear guidance, never a hang
     9. image + PDF without key  -> offline image result, PDF never blocks it
    10. HEIC screenshot          -> explicit failure, no permanent "attaching"
    11. second drop while images from the first are attached -> merged batch
    12. convert pressed mid-decode -> "still loading", then converts
    13. thumbnail click -> review modal; modal remove -> attachment disappears
    14. thumbnail red × -> direct remove; stale output is cleared
    15. pending screenshot × -> cancels before decode is done
    16. hanging native TextDetector -> bounded fallback OCR, never a permanent spinner
    17. clear -> full reset, later attachments still work (generation token)
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

/* ---------- 1. render the test tickets (Pillow, else ImageMagick) ---------- */
function buildTickets() {
  const qr = "/tmp/spicy_pipe_qr.png";
  const ib = "/tmp/spicy_pipe_ib.png";
  const script = `
from PIL import Image, ImageDraw, ImageFont
def mk(txt, out):
    im = Image.new('RGB', (800, 200), 'white')
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
    for y, t in zip((20, 80, 140), txt):
        d.text((25, y), t, font=f, fill='black')
    im.save(out)
mk(['QR 1059 DOH - CAI', '18 Nov 7:55 PM - 11:25 PM', 'Boeing 787 Economy'], ${JSON.stringify(qr)})
mk(['IB 4237 LAX - LHR', '16 Sep 6:05 PM - 12:45 PM', 'Boeing 777 Business'], ${JSON.stringify(ib)})
`;
  try {
    fs.writeFileSync("/tmp/spicy_pipe_gen.py", script);
    execSync("python3 /tmp/spicy_pipe_gen.py", { stdio: "ignore" });
  } catch (e) {
    const mk = (a, b, c, out) => execFileSync("convert",
      ["-size", "800x200", "xc:white", "-font", "DejaVu-Sans-Bold", "-pointsize", "26",
        "-fill", "black", "-draw", `text 25,50 "${a}"`, "-draw", `text 25,110 "${b}"`,
        "-draw", `text 25,170 "${c}"`, "PNG:" + out], { stdio: ["ignore", "ignore", "ignore"] });
    mk("QR 1059 DOH - CAI", "18 Nov 7:55 PM - 11:25 PM", "Boeing 787 Economy", qr);
    mk("IB 4237 LAX - LHR", "16 Sep 6:05 PM - 12:45 PM", "Boeing 777 Business", ib);
  }
  if (!fs.existsSync(qr) || !fs.existsSync(ib)) throw new Error("test ticket images were not created");
  return {
    qrPixels: decodePng(fs.readFileSync(qr)),
    ibPixels: decodePng(fs.readFileSync(ib)),
    qrPngMagic: fs.readFileSync(qr).slice(0, 32), // real PNG magic bytes
  };
}

/* minimal PNG decoder: 8-bit gray / RGB / palette / RGBA, non-interlaced.
   Node's built-in zlib keeps the harness dependency-free. */
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
      if (data[8] !== 8 || data[10] !== 0 || data[12] !== 0)
        throw new Error("unsupported PNG (need 8-bit, non-interlaced)");
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
  const lines = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0, p = 0; y < h; y++, p += stride + 1) {
    const filter = raw[p];
    const cur = lines.subarray(y * stride, (y + 1) * stride);
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
    if (colorType === 0) r = g = b = lines[i];
    else if (colorType === 4) { r = g = b = lines[i * 2]; al = lines[i * 2 + 1]; }
    else if (colorType === 2) { r = lines[i * 3]; g = lines[i * 3 + 1]; b = lines[i * 3 + 2]; }
    else if (colorType === 6) { r = lines[i * 4]; g = lines[i * 4 + 1]; b = lines[i * 4 + 2]; al = lines[i * 4 + 3]; }
    else { const ix = lines[i] * 3; r = plte[ix]; g = plte[ix + 1]; b = plte[ix + 2]; if (trns && trns[lines[i]] !== undefined) al = trns[lines[i]]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = al;
  }
  return { w, h, rgba };
}

/* ---------- 2. DOM / canvas / browser stubs ---------- */
const pixelRegistry = new Map();   // dataURL -> {w,h,rgba}
const canvasSources = new WeakMap(); // canvas -> () => {w,h,rgba}

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
      // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) — args excludes img.
      let sx = 0, sy = 0, sw = sp.w, sh = sp.h, dx = 0, dy = 0, dw = sp.w, dh = sp.h;
      if (args.length === 4) { dx = args[0]; dy = args[1]; dw = args[2]; dh = args[3]; }
      else if (args.length === 8) { sx = args[0]; sy = args[1]; sw = args[2]; sh = args[3]; dx = args[4]; dy = args[5]; dw = args[6]; dh = args[7]; }
      dw = dw === undefined ? sp.w : dw; dh = dh === undefined ? sp.h : dh;
      const x0o = Math.max(0, dx | 0), y0o = Math.max(0, dy | 0);
      const x1o = Math.min(cv.width, (dx + dw) | 0), y1o = Math.min(cv.height, (dy + dh) | 0);
      for (let yy = y0o; yy < y1o; yy++) {
        for (let xx = x0o; xx < x1o; xx++) {
          // Source coord: sx + scaled offset, clamped to the source image.
          const fx = Math.min(sp.w - 1, sx + Math.max(0, Math.min(sw - 1, ((xx - dx) + 0.5) * sw / dw - 0.5)));
          const fy = Math.min(sp.h - 1, sy + Math.max(0, Math.min(sh - 1, ((yy - dy) + 0.5) * sh / dh - 0.5)));
          const px0 = fx | 0, py0 = fy | 0, px1 = px0 + 1, py1 = py0 + 1;
          const ax = fx - px0, ay = fy - py0, bx = 1 - ax, by = 1 - ay;
          const o00 = (py0 * sp.w + px0) * 4, o10 = (py0 * sp.w + px1) * 4;
          const o01 = (py1 * sp.w + px0) * 4, o11 = (py1 * sp.w + px1) * 4;
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
  el.classList = {
    add: c => el._classes.add(c),
    remove: c => el._classes.delete(c),
    contains: c => el._classes.has(c),
  };
  el.addEventListener = (t, fn) => { (el._listeners[t] = el._listeners[t] || []).push(fn); };
  el.fire = (t, ev) => { (el._listeners[t] || []).slice().forEach(fn => fn.call(el, ev || {})); };
  el.appendChild = c => {
    if (c && c.parentNode && c.parentNode.removeChild) c.parentNode.removeChild(c);
    if (c) c.parentNode = el;
    el._kids.push(c);
    return c;
  };
  el.removeChild = c => {
    const i = el._kids.indexOf(c);
    if (i >= 0) el._kids.splice(i, 1);
    if (c) c.parentNode = null;
    return c;
  };
  el.focus = () => {}; el.select = () => {}; el.remove = () => { if (el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el); }; el.click = () => {};
  Object.defineProperty(el, "innerHTML", {
    // DOM semantics: after setting textContent, innerHTML returns that text
    get: () => (el._html !== "" ? el._html : el._text),
    set: v => {
      el._html = String(v);
      if (el._html === "") { el._kids.forEach(c => { if (c) c.parentNode = null; }); el._kids.length = 0; }
    },
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

function toAb(buf) {
  const ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  return ab;
}

function fakeFile(o) {
  const bytes = o.bytes || Buffer.from(String(o.text == null ? "" : o.text), "utf8");
  const f = {
    name: o.name || "attachment",
    type: o.type || "",
    size: bytes.length,
    __bytes: bytes,
    __pixels: o.pixels,
    __decodeDelayMs: o.decodeDelayMs || 0,
    arrayBuffer() { return Promise.resolve(toAb(bytes.subarray(0, 32))); },
    slice(start, end) {
      const s = Math.max(0, start || 0), e = Math.min(bytes.length, end == null ? bytes.length : end);
      const part = bytes.subarray(s, e);
      return {
        size: e - s,
        arrayBuffer() { return Promise.resolve(toAb(part)); },
        text() { return Promise.resolve(Buffer.from(part).toString("utf8")); },
      };
    },
  };
  return f;
}

/* ---------- 3. load app.js into the sandbox ---------- */
const tickets = buildTickets();
const qrPixels = tickets.qrPixels;
const ibPixels = tickets.ibPixels;

const elements = {};
const docListeners = {};
const store = new Map();

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
  SPICY_DATA: require("./spicy_data.js"),
  Image: FakeImage,
  FileReader: FakeFileReader,
  OCRAD: require("./ocrad.js"),
  SpicyEngine: require("./spicy_engine.js"),
  createImageBitmap(file) {
    if (!file || !file.__pixels) return Promise.reject(new Error("no pixels"));
    return new Promise(resolve =>
      setTimeout(() => resolve({ width: file.__pixels.w, height: file.__pixels.h, __pixels: file.__pixels, close() {} }),
        file.__decodeDelayMs || 0));
  },
  fetch() { return Promise.reject(new Error("offline test: no network")); },
  window: null,
  document: null,
};
sandbox.window = sandbox;
sandbox.document = {
  getElementById: id => elements[id] || (elements[id] = makeEl(id)),
  createElement: tag => (tag === "canvas" ? makeCanvas(0, 0) : makeEl("")),
  addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
  body: { appendChild() {}, removeChild() {} },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "app.js"), "utf8"), sandbox, { filename: "app.js" });

const el = id => sandbox.document.getElementById(id);
const drop = files => (docListeners.drop || []).slice()
  .forEach(fn => fn.call(sandbox.document, { preventDefault() {}, dataTransfer: { files, getData: () => "" } }));
const picker = files => { const fp = el("filePick"); fp.files = files; fp.fire("change"); };
const pasteImage = file => el("inp").fire("paste", {
  preventDefault() {},
  clipboardData: { items: [{ type: "image/png", getAsFile: () => file }], getData: () => "" },
});
const clearAll = () => el("btnClear").fire("click");
const status = () => el("st")._text;
const outText = () => el("out").innerHTML;
const thumbs = () => el("thumbs")._kids.length;
const settled = () => !/ATTACHING|CHECKING|PARSING|LOADING/.test(status());

async function waitUntil(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 30000)) {
    if (fn()) return true;
    await new Promise(r => setTimeout(r, 15));
  }
  return false;
}
async function settle(label) {
  const ok = await waitUntil(settled, 30000);
  assert(ok, `${label}: pipeline settled (status: "${status()}")`);
}

(async function main() {
  console.log("=== Attachment pipeline: single screenshot drop ===");
  clearAll();
  drop([fakeFile({ name: "qatar.png", type: "image/png", pixels: qrPixels })]);
  assert(await waitUntil(() => /IMAGE PARSED|CACHED IMAGE|FAILED/.test(status())), true, "drop: reached a terminal state");
  await settle("drop");
  assert(/IMAGE PARSED/.test(status()), `drop: offline OCR parsed (status: "${status()}")`);
  assert(/QR/.test(outText()) && /1059/.test(outText()), "drop: output contains QR 1059");
  assert(thumbs() === 1, `drop: one thumbnail rendered (${thumbs()})`);

  console.log("\n=== Screenshot thumbnail review and modal remove ===");
  const firstThumb = el("thumbs")._kids[0];
  const firstOpen = firstThumb && firstThumb._kids[0];
  assert(!!firstOpen && firstThumb._kids.length === 2, "reviewable thumbnail has separate open and red remove controls");
  firstOpen.fire("click");
  assert(!el("attachmentReviewModal").classList.contains("hidden"), "thumbnail click opens the screenshot review modal");
  assert(/qatar\.png/.test(el("attachmentReviewMeta")._text), "review modal identifies the selected screenshot");
  assert(!!el("attachmentReviewImage").src, "review modal receives an image source");
  el("attachmentReviewRemove").fire("click");
  assert(el("attachmentReviewModal").classList.contains("hidden"), "modal remove closes the larger review");
  assert(thumbs() === 0 && outText() === "", "modal remove deletes only that screenshot and clears its result");
  assert(/SCREENSHOT REMOVED/.test(status()), `modal remove reports completion (status: "${status()}")`);

  console.log("\n=== Screenshot thumbnail red × direct remove ===");
  drop([fakeFile({ name: "direct_remove.png", type: "image/png", pixels: qrPixels })]);
  await waitUntil(() => /IMAGE PARSED|CACHED IMAGE|FAILED/.test(status()));
  const directThumb = el("thumbs")._kids[0];
  const directRemove = directThumb && directThumb._kids[1];
  directRemove.fire("click", { preventDefault() {}, stopPropagation() {} });
  assert(thumbs() === 0 && outText() === "", "small thumbnail × removes the screenshot without opening review");
  assert(el("attachmentReviewModal").classList.contains("hidden"), "thumbnail × does not leave a review modal open");

  console.log("\n=== Pending screenshot red × cancellation ===");
  drop([fakeFile({ name: "cancel_before_decode.png", type: "image/png", pixels: qrPixels, decodeDelayMs: 250 })]);
  await new Promise(r => setTimeout(r, 25));
  const pendingThumb = el("thumbs")._kids[0];
  assert(!!pendingThumb, "loading screenshot exposes its remove control immediately");
  pendingThumb._kids[1].fire("click", { preventDefault() {}, stopPropagation() {} });
  assert(thumbs() === 0, "pending screenshot disappears immediately after its red × click");
  await waitUntil(() => /SCREENSHOT REMOVED/.test(status()) && !/UPDATING/i.test(status()), 1000);
  assert(/SCREENSHOT REMOVED/.test(status()) && outText() === "", `pending screenshot never repaints after removal (status: "${status()}")`);

  console.log("\n=== Hanging native TextDetector falls back without a permanent spinner ===");
  const timeoutPixels = { w: qrPixels.w, h: qrPixels.h, rgba: new Uint8ClampedArray(qrPixels.rgba) };
  timeoutPixels.rgba[0] = 254; // avoids the local image cache while preserving the ticket text
  sandbox.TextDetector = class { detect() { return new Promise(() => {}); } };
  const timeoutStarted = Date.now();
  drop([fakeFile({ name: "native_timeout.png", type: "image/png", pixels: timeoutPixels })]);
  await waitUntil(() => /IMAGE PARSED|FAILED|ATTACHMENT NOT READ/.test(status()), 5000);
  const nativeElapsed = Date.now() - timeoutStarted;
  assert(/IMAGE PARSED/.test(status()) && /1059/.test(outText()), `hung TextDetector falls back to OCRAD (status: "${status()}")`);
  assert(nativeElapsed >= 150 && nativeElapsed < 3000, `native OCR deadline bounds the wait (${nativeElapsed}ms)`);
  sandbox.TextDetector = undefined;

  console.log("\n=== Attachment pipeline: two images in one drop keep order ===");
  clearAll();
  drop([fakeFile({ name: "a_qatar.png", type: "image/png", pixels: qrPixels }),
        fakeFile({ name: "b_iberia.png", type: "image/png", pixels: ibPixels })]);
  await waitUntil(() => /IMAGE PARSED|FAILED/.test(status()));
  await settle("two images");
  assert(/2 seg/.test(status()), `two images: both segments parsed (status: "${status()}")`);
  assert(outText().indexOf("1059") < outText().indexOf("4237"), "two images: QR seg rendered before IB seg");
  assert(thumbs() === 2, `two images: two thumbnails (${thumbs()})`);

  console.log("\n=== Attachment pipeline: reversed drop order ===");
  clearAll();
  drop([fakeFile({ name: "b_iberia.png", type: "image/png", pixels: ibPixels }),
        fakeFile({ name: "a_qatar.png", type: "image/png", pixels: qrPixels })]);
  await waitUntil(() => /IMAGE PARSED|FAILED/.test(status()));
  await settle("reversed");
  assert(outText().indexOf("4237") < outText().indexOf("1059"), "reversed: IB seg rendered before QR seg");

  console.log("\n=== Attachment pipeline: clipboard screenshot paste ===");
  clearAll();
  pasteImage(fakeFile({ name: "image.png", type: "image/png", pixels: qrPixels }));
  await waitUntil(() => /IMAGE PARSED|CACHED IMAGE|FAILED/.test(status()));
  await settle("paste");
  assert(/CACHED IMAGE|IMAGE PARSED/.test(status()), `paste: screenshot converted (status: "${status()}")`);
  assert(/1059/.test(outText()), "paste: output contains the flight");

  console.log("\n=== Attachment pipeline: repeated image served from cache ===");
  clearAll();
  drop([fakeFile({ name: "qatar_again.png", type: "image/png", pixels: qrPixels })]);
  await waitUntil(() => /CACHED IMAGE|IMAGE PARSED|FAILED/.test(status()));
  assert(/CACHED IMAGE/.test(status()), `cache: repeated screenshot is instant (status: "${status()}")`);

  console.log("\n=== Attachment pipeline: text file attachment ===");
  clearAll();
  drop([fakeFile({ name: "itinerary.txt", type: "text/plain", text: "QR 1059 18NOV DOH CAI 755P 1125P Y 787 N" })]);
  await waitUntil(() => /CONVERTED|ATTACHED|FAILED|EMPTY/.test(status()));
  await settle("text file");
  assert(/1059/.test(outText()), `text file: itinerary converted (status: "${status()}")`);

  console.log("\n=== Attachment pipeline: nameless PNG (empty MIME, no extension) ===");
  clearAll();
  drop([fakeFile({ name: "attachment", type: "", bytes: tickets.qrPngMagic, pixels: qrPixels })]);
  await waitUntil(() => /CACHED IMAGE|IMAGE PARSED|FAILED|UNSUPPORTED/.test(status()));
  await settle("signature");
  assert(!/UNSUPPORTED/.test(status()), `signature: file was not rejected (status: "${status()}")`);

  console.log("\n=== Attachment pipeline: PDF without a Gemini key ===");
  clearAll();
  drop([fakeFile({ name: "ticket.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.4 test") })]);
  await waitUntil(() => /PDF/.test(status()));
  await settle("pdf");
  assert(/Gemini key/.test(status()), `pdf: clear guidance instead of a hang (status: "${status()}")`);

  console.log("\n=== Attachment pipeline: image + PDF without a key ===");
  clearAll();
  drop([fakeFile({ name: "shot.png", type: "image/png", pixels: ibPixels }),
        fakeFile({ name: "ticket.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.4 test") })]);
  await waitUntil(() => /IMAGE PARSED|FAILED/.test(status()));
  await settle("image+pdf");
  assert(/4237/.test(outText()), `image+pdf: offline image result still produced (status: "${status()}")`);
  assert(/PDF/.test(status()), `image+pdf: PDF presence is reported (status: "${status()}")`);

  console.log("\n=== Attachment pipeline: HEIC rejected explicitly ===");
  clearAll();
  drop([fakeFile({ name: "iphone.heic", type: "image/heic", bytes: Buffer.alloc(64) })]);
  await waitUntil(() => /FAILED|ATTACHING/.test(status()));
  await settle("heic");
  assert(/IMAGE FAILED/.test(status()) && /HEIC/i.test(status()), `heic: explicit failure, no hang (status: "${status()}")`);

  console.log("\n=== Attachment pipeline: second drop merges with earlier images ===");
  clearAll();
  drop([fakeFile({ name: "one.png", type: "image/png", pixels: qrPixels })]);
  await waitUntil(() => /CACHED IMAGE|IMAGE PARSED|FAILED/.test(status()));
  picker([fakeFile({ name: "two.png", type: "image/png", pixels: ibPixels })]);
  await waitUntil(() => /IMAGE PARSED/.test(status()));
  await settle("second batch");
  assert(/2 seg/.test(status()), `second batch: merged conversion (status: "${status()}")`);
  assert(outText().indexOf("1059") < outText().indexOf("4237"), "second batch: picker order preserved");

  console.log("\n=== Attachment pipeline: convert pressed while still decoding ===");
  clearAll();
  drop([fakeFile({ name: "slow.png", type: "image/png", pixels: ibPixels, decodeDelayMs: 250 })]);
  await new Promise(r => setTimeout(r, 80));
  el("btnConvert").fire("click");
  assert(/STILL LOADING/.test(status()), `mid-decode: convert waits (status: "${status()}")`);
  await waitUntil(() => /IMAGE PARSED|CACHED IMAGE|FAILED/.test(status()));
  await settle("slow decode");
  assert(/4237/.test(outText()), `mid-decode: converted after decode finished (status: "${status()}")`);
  assert(/IMAGE PARSED|CACHED IMAGE/.test(status()), "mid-decode: terminal conversion state reached");

  console.log("\n=== Attachment pipeline: clear resets everything ===");
  clearAll();
  assert(status() === "READY", `clear: status READY (${status()})`);
  assert(outText() === "" && thumbs() === 0 && el("inp").value === "", "clear: output, thumbs and input emptied");
  drop([fakeFile({ name: "after_clear.png", type: "image/png", pixels: ibPixels })]);
  await waitUntil(() => /IMAGE PARSED|CACHED IMAGE|FAILED/.test(status()));
  assert(/IMAGE PARSED|CACHED IMAGE/.test(status()), `clear: attachments still work afterwards (status: "${status()}")`);

  console.log(`\n=== SUMMARY: ${PASS} passed, ${FAIL} failed ===`);
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(e => {
  console.error("HARNESS EXCEPTION:", e);
  process.exit(1);
});
