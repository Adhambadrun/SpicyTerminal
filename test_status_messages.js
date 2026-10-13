"use strict";
/* test_status_messages.js — regression for the status-bar bug report:
 *
 *   "AI CONVERTED (DEPARTURE TIME MISSING ????)" — on almost every itinerary
 *
 * A paste whose offline read leaves a field unreadable ("departure time
 * missing -> ????") is repaired by AI without being asked — that is the design.
 * What was wrong is what the status bar then said: the AI request carries an
 * internal `reason` (an engine warning, or a token such as "learned pattern",
 * "PDF attachment", "AI correction"), and the success line printed it:
 *
 *     AI CONVERTED (departure time missing -> ????)        <- user-facing text
 *
 * So a finished, repaired itinerary reported itself as still missing a time,
 * with the `????` placeholder the app exists to remove, on nearly every paste
 * that needed a repair. The reason is an internal value — `learnRecord` and
 * `detectMistakesAndLearn` still read it — but the status bar reports only the
 * outcome: "AI CONVERTED".
 *
 * Covered:
 *   1. Text paste -> offline read leaves ???? -> AI repairs it: the status bar
 *      says exactly "AI CONVERTED", with no warning text, no "????", no arrows,
 *      no parentheses and no internal token — executed against the real app.js
 *      in a stub DOM, one :generateContent call, repaired itinerary on screen
 *   2. No `setStatus(...)` argument anywhere in app.js can carry a placeholder
 *      or an engine warning (the guard that keeps this class of leak dead)
 *   3. The fix did not blind the self-learner: the raw reason still reaches
 *      `learnRecord` / `detectMistakesAndLearn`
 *   4. An AI reply that is still incomplete never claims success
 *   5. The built pages ship the same status line
 *
 * Run: node test_status_messages.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("PASS:", msg); }
  else { FAIL++; console.error("FAIL:", msg); }
}

const REPO = __dirname;
const APP = fs.readFileSync(path.join(REPO, "app.js"), "utf8");

/* ---------- a stub DOM just big enough to run the real app.js ---------- */
function makeEl(id) {
  const el = {
    id, value: "", _html: "", _text: "", title: "", className: "", files: null,
    disabled: false, style: {}, _attrs: {}, href: "",
    _kids: [], _listeners: {}, _classes: new Set(),
  };
  el.classList = {
    add: c => el._classes.add(c),
    remove: c => el._classes.delete(c),
    contains: c => el._classes.has(c),
    toggle: (c, on) => { if (on === undefined) on = !el._classes.has(c); if (on) el._classes.add(c); else el._classes.delete(c); return on; },
  };
  el.addEventListener = (t, fn) => { (el._listeners[t] = el._listeners[t] || []).push(fn); };
  el.fire = (t, ev) => { (el._listeners[t] || []).slice().forEach(fn => fn.call(el, ev || {})); };
  el.setAttribute = (k, v) => { el._attrs[k] = String(v); };
  el.getAttribute = k => (k in el._attrs ? el._attrs[k] : null);
  el.removeAttribute = k => { delete el._attrs[k]; };
  el.appendChild = c => { if (c) c.parentNode = el; el._kids.push(c); return c; };
  el.removeChild = c => { const i = el._kids.indexOf(c); if (i >= 0) el._kids.splice(i, 1); if (c) c.parentNode = null; return c; };
  el.focus = () => {}; el.select = () => {}; el.click = () => {};
  el.remove = () => { if (el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el); };
  Object.defineProperty(el, "innerHTML", { get: () => (el._html !== "" ? el._html : el._text), set: v => { el._html = String(v); } });
  Object.defineProperty(el, "textContent", { get: () => el._text, set: v => { el._text = String(v); } });
  return el;
}

function makeCanvas() {
  const ctx = {
    drawImage() {}, fillRect() {}, clearRect() {}, getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    putImageData() {}, save() {}, restore() {}, scale() {}, translate() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
  };
  return { width: 0, height: 0, getContext: () => ctx, toDataURL: () => "data:image/png;base64," };
}

class FakeImage {
  constructor() { this.width = 0; this.height = 0; this.naturalWidth = 0; this.naturalHeight = 0; }
  set src(v) { this._src = v; queueMicrotask(() => { if (this.onerror) this.onerror(); }); }
  get src() { return this._src; }
}
class FakeFileReader {
  readAsDataURL() { queueMicrotask(() => { if (this.onerror) this.onerror(new Error("no bytes")); }); }
  readAsText() { queueMicrotask(() => { if (this.onload) this.onload({ target: this }); }); }
}

function makeSandbox(overrides) {
  overrides = overrides || {};
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
    SPICY_DATA: require(path.join(REPO, "spicy_data.js")),
    SpicyEngine: require(path.join(REPO, "spicy_engine.js")),
    Image: FakeImage,
    FileReader: FakeFileReader,
    OCRAD: function () { return { run() { return ""; } }; },
    createImageBitmap: () => Promise.reject(new Error("no images in this suite")),
    fetch(url) {
      fetchLog.push(String(url));
      return Promise.resolve(overrides.fetch ? overrides.fetch(String(url)) : null);
    },
    window: null,
    document: null,
  };
  sandbox.window = sandbox;
  sandbox.document = {
    getElementById: id => elements[id] || (elements[id] = makeEl(id)),
    createElement: tag => (tag === "canvas" ? makeCanvas() : makeEl("")),
    addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
    body: { appendChild() {}, removeChild() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(APP, sandbox, { filename: "app.js" });
  return {
    sandbox, elements,
    el: id => elements[id] || sandbox.document.getElementById(id),
    status: () => (elements.st ? elements.st._text : ""),
    out: () => (elements.out ? (elements.out._html !== "" ? elements.out._html : elements.out._text) : ""),
    fetchLog,
    store,
  };
}

async function waitUntil(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 15000)) {
    if (fn()) return true;
    await new Promise(r => setTimeout(r, 10));
  }
  return false;
}

/* The offline read of this paste cannot find a clock (mistake-log shape:
   "departure time missing -> ????") — exactly the itinerary class that made
   the bug show up on almost every conversion. */
const PARTIAL_PASTE = "American Airlines 100 JFK to LHR on 03MAR";

/* What the AI answers for it: the same flight, clocks read from the source. */
const AI_REPAIR = [
  "1 AA 100 03MAR JFK LHR 700P 700A\u00a51 Y 77W 6.55 3452 N",
  "DEP-JOHN F KENNEDY INTL",
  "ARR-LONDON HEATHROW",
  "CABIN-ECONOMY",
].join("\n");

function aiReplyBody(textReply) {
  return {
    json: () => Promise.resolve({
      candidates: [{ content: { parts: [{ text: textReply }] } }],
    }),
  };
}

function withKey(s) {
  s.store.set("spicy_gem_key", "test-key");
  s.store.set("spicy_gem_model", "gemini-test-model");
}

async function main() {
  /* ================= 1. The reported case, executed ================= */
  console.log("=== 1. A partial paste repaired by AI reports the outcome only ===");
  {
    const s = makeSandbox({
      fetch(url) {
        if (url.indexOf(":generateContent") >= 0) return aiReplyBody(AI_REPAIR);
        throw new Error("unexpected fetch: " + url);
      },
    });
    withKey(s);
    s.el("inp").value = PARTIAL_PASTE;
    s.el("btnConvert").fire("click");
    const settled = await waitUntil(() => /AI CONVERTED|AI failed|CONVERSION DONE/.test(s.status()), 20000);
    assert(settled, `1a: the conversion settled (status: "${s.status()}")`);
    const genCalls = s.fetchLog.filter(u => u.indexOf(":generateContent") >= 0);
    assert(genCalls.length === 1, `1b: the incomplete offline read was repaired by AI (${genCalls.length} request(s))`);
    const status = s.status();
    assert(status === "AI CONVERTED", `1c: the status bar reports the outcome only (got "${status}")`);
    assert(!/\?\?\?/.test(status), `1d: no placeholder in the status bar (got "${status}")`);
    assert(!/->|departure time missing|arrival time missing|unknown airport/i.test(status),
      `1e: no engine warning in the status bar (got "${status}")`);
    assert(!/[()]/.test(status), `1f: no parenthesised internal reason (got "${status}")`);
    for (const token of ["learned pattern", "duplicated segment guard", "AI correction", "undetected attachment", "attachment parse error", "PDF attachment", "image+PDF attachment"]) {
      assert(status.indexOf(token) < 0, `1g: internal token "${token}" stays internal (got "${status}")`);
    }
    const out = s.out();
    assert(out.indexOf("AA 100") >= 0 && out.indexOf("700P") >= 0 && out.indexOf("700A") >= 0,
      "1h: the repaired itinerary is what is on screen");
    assert(out.indexOf("????") < 0, "1i: the repaired itinerary carries no placeholder");
  }

  /* ================= 2. Source guard: the status bar is not a log ================= */
  console.log("\n=== 2. No status message can carry an engine warning or a placeholder ===");
  {
    const calls = statusArguments(APP);
    assert(calls.length >= 50, `${calls.length} setStatus(...) call sites scanned`);
    let leaks = 0;
    for (const { line, arg } of calls) {
      const bad = [/\?\?\?/, /->/, /departure time missing|arrival time missing/i, /unknown airport code/i]
        .some(re => re.test(arg));
      if (bad) { leaks++; console.error(`   leak at app.js:${line}: ${arg}`); }
    }
    assert(leaks === 0, "no setStatus(...) argument is an engine warning or a placeholder");
    const warningVars = calls.filter(c => /\bwarns\b|\black\b/.test(c.arg));
    assert(warningVars.length === 0, "no setStatus(...) call interpolates the parser's warnings");
    /* `details.reason` is a written-for-the-user booking-link sentence; the AI
       request's `reason` is the internal value that must never be printed. */
    const aiReason = calls.filter(c => /\breason\b/.test(c.arg.replace(/details\.reason/g, "")));
    assert(aiReason.length === 0, "no setStatus(...) call interpolates the AI request reason");
    assert(/setStatus\("AI CONVERTED"\)/.test(APP), "the AI success line is a plain outcome");
    assert(!/setStatus\("AI CONVERTED"\+/.test(APP), "it is not built by concatenating the reason");
  }

  /* ================= 3. The self-learner still gets the raw reason ================= */
  console.log("\n=== 3. The reason stays internal — for the learner ===");
  {
    assert(/learnRecord\(text,t,reason\)/.test(APP),
      "learnRecord still receives the internal reason");
    assert(/detectMistakesAndLearn\(text \|\| "\[screenshot\]", previousDirect, t, reason\)/.test(APP),
      "detectMistakesAndLearn still receives the internal reason");
    assert(/function learnRecord\(text, aiOut, reason\)/.test(APP), "learnRecord's contract is unchanged");
    assert(/function detectMistakesAndLearn\(inputText, directText, aiText, reason\)/.test(APP),
      "detectMistakesAndLearn's contract is unchanged");
  }

  /* ================= 4. Incomplete AI replies never claim success ================= */
  console.log("\n=== 4. An unknown-airport reply is still reported honestly ===");
  {
    const s = makeSandbox({
      fetch(url) {
        if (url.indexOf(":generateContent") >= 0) {
          return aiReplyBody("1 FM 107 ??? ??? Y 738 0.00 0 N\nDEP-???\nARR-???\nCABIN-ECONOMY");
        }
        throw new Error("unexpected fetch: " + url);
      },
    });
    withKey(s);
    s.el("inp").value = PARTIAL_PASTE;
    s.el("btnConvert").fire("click");
    await waitUntil(() => /AI CONVERTED|AI failed|AI REPLY INCOMPLETE|CONVERSION DONE/.test(s.status()), 20000);
    const status = s.status();
    assert(/^AI REPLY INCOMPLETE\b/.test(status), `4a: an incomplete reply is not called a conversion (got "${status}")`);
    assert(!/^AI CONVERTED\b/.test(status), "4b: it never starts with AI CONVERTED");
    assert(/press AI FIX again/.test(status), "4c: it says what to do next");
  }

  /* ================= 5. The built pages ship the fixed line ================= */
  console.log("\n=== 5. The built pages carry the same status line ===");
  {
    const pages = ["index.html", "app.html", "public/index.html", "public/app.html", "public/seatmap.html"];
    let checked = 0;
    for (const page of pages) {
      const file = path.join(REPO, page);
      if (!fs.existsSync(file)) continue;
      const html = fs.readFileSync(file, "utf8");
      checked++;
      assert(html.indexOf('setStatus("AI CONVERTED")') >= 0, `${page}: ships the outcome-only status line`);
      assert(html.indexOf('setStatus("AI CONVERTED"+(reason') < 0, `${page}: ships no reason concatenation`);
    }
    assert(checked >= 2, `${checked} built page(s) checked`);
  }

  console.log(`\n=== SUMMARY: ${PASS} passed, ${FAIL} failed ===`);
  if (FAIL > 0) process.exit(1);
}

/* Extract every setStatus(...) argument with its line number, balanced-paren
   aware, so the guard reads the real call sites rather than a grep. */
function statusArguments(src) {
  const out = [];
  let i = 0;
  while ((i = src.indexOf("setStatus(", i)) >= 0) {
    const start = i + "setStatus(".length;
    let depth = 1, j = start;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      j++;
    }
    const arg = src.slice(start, j - 1).replace(/\s+/g, " ").trim();
    const line = src.slice(0, i).split("\n").length;
    out.push({ line, arg });
    i = j;
  }
  return out;
}

main().catch(error => { console.error("FAIL: suite crashed —", error && error.stack || error); process.exit(1); });
