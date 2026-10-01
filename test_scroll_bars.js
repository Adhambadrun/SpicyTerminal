"use strict";
/* test_scroll_bars.js — the OUTPUT window must always scroll, and the INPUT
 * window gets the OUTPUT scrollbar (with a switch).
 *
 * What this pins down:
 *   - OUTPUT stays a native scrollport (overflow-y:auto, overscroll-behavior:
 *     contain, -webkit-overflow-scrolling:touch, tabindex) — a long itinerary
 *     scrolls inside its own window, never off the page;
 *   - the glyph shine is the one effect that can take that scrolling away: a
 *     background-clip:text paint on a SCROLLING element is the browser bug
 *     where the window refuses to scroll (the clipped paint does not travel
 *     with the text).  It therefore lives on a short-lived `.printing` class
 *     that app.js (a) never applies while OUTPUT can scroll, (b) never applies
 *     for reduced-motion users, and (c) removes on the animation's own
 *     `animationend` with a timer as the safety net — so a clipped background
 *     is never left behind on a window the user can scroll;
 *   - both windows wear one scrollbar: the INPUT textarea shares the OUTPUT's
 *     thin green bar (standard properties + ::-webkit-scrollbar rules);
 *   - the INPUT header carries a real switch (role=switch, aria-checked wired
 *     by app.js and remembered per device) that hides only the BAR — the
 *     textarea keeps overflow:auto, so wheel/keys/touch keep scrolling;
 *   - the committed single-file artifact carries all of it.
 *
 * Behaviour runs the REAL SCROLLBARS block of app.js in a vm sandbox with a DOM
 * exactly as small as it needs (same approach as test_about_dialog.js).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = __dirname;
const APP = fs.readFileSync(path.join(REPO, "app.js"), "utf8");
const TPL = fs.readFileSync(path.join(REPO, "index_template.html"), "utf8");
const BUILT = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
const README = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
const CSS = TPL.slice(TPL.indexOf("<style>"), TPL.indexOf("</style>"));

let PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("PASS:", msg); }
  else { FAIL++; console.error("FAIL:", msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

/* ---------- 1. OUTPUT is still a real scrollport ---------- */
section("1. OUTPUT keeps a bounded, native scrollport");
assert(/textarea,pre\.out\{flex:1 1 0%;[^}]*overflow:auto;[^}]*overscroll-behavior:contain;-webkit-overflow-scrolling:touch\}/.test(CSS),
       "both windows keep overflow:auto plus touch-friendly scrolling");
assert(/pre\.out\{display:block;color:var\(--out\);overflow-x:auto;overflow-y:auto\}/.test(CSS),
       "OUTPUT declares its own vertical (and horizontal) scrolling");
assert(/<pre class="out" id="out"[^>]*tabindex="0"/.test(TPL),
       "OUTPUT stays keyboard-focusable so PageUp/PageDown reach the window");

/* ---------- 2. the clipped shine can never sit on a window that scrolls ---------- */
section("2. the glyph shine is scroll-safe by construction");
const PRINT_RULE = (CSS.match(/\.pane\.out\.printing\.shine pre\.out\{[^}]*\}/) || [""])[0];
const CSS_NO_PRINT = CSS.replace(PRINT_RULE, "").replace("@supports ((background-clip:text) or (-webkit-background-clip:text))", "");
assert(/@supports \(\(background-clip:text\) or \(-webkit-background-clip:text\)\)/.test(CSS) &&
       /background-attachment:local/.test(PRINT_RULE) && /background-clip:text/.test(PRINT_RULE) &&
       !/background-clip:text/.test(CSS_NO_PRINT),
       "the .printing.shine streak is the only clipped paint in the whole stylesheet, pinned with background-attachment:local");
assert(/\.pane\.out\.printing pre\.out\{animation:out-print/.test(CSS) &&
       /\.pane\.out\.printing pre\.out\{animation:out-print/.test(CSS) &&
       !/\.pane\.out\.changed pre\.out\{animation:out-print/.test(CSS),
       "even the plain print is transient — .changed (which stays on the pane) never animates the scroll window");
assert(!/\.pane\.out\.changed pre\.out\{[^}]*background-clip/.test(CSS),
       "no clipped background is attached to .changed (which stays on the pane after every result)");
assert(/\.pane\.out\.printing\.shine pre\.out\{[\s\S]*?out-shine/.test(CSS),
       "the streak itself is unchanged when it does run");
assert(/prefers-reduced-motion:reduce\)\{[\s\S]*?\.pane\.out\.printing pre\.out[^}]*animation:none!important/.test(CSS) &&
       /prefers-reduced-motion:reduce\)\{[\s\S]*?\.pane\.out\.printing\.shine pre\.out\{color:var\(--out\)!important;background:none!important/.test(CSS),
       "reduced-motion users never get the clipped paint at all");
assert(/function flashPane\(pane\)[\s\S]{0,400}igniteLineGlow\(pane\);\s*\/\/[^\n]*\n\s*printGlyphs\(pane\);/.test(APP),
       "every pane change runs the print through printGlyphs()");
assert(/var PRINT_MS = 900;/.test(APP) && /out\.addEventListener\("animationend"/.test(APP) &&
       /e\.animationName === "out-shine" \|\| e\.animationName === "out-print"/.test(APP),
       "the shine ends on animationend (out-shine/out-print), with a timer as the net");

/* ---------- 3. one scrollbar for both windows ---------- */
section("3. INPUT wears the OUTPUT scrollbar");
assert(/textarea,pre\.out\{scrollbar-width:thin;scrollbar-color:rgba\(81,224,124,\.42\) transparent\}/.test(CSS),
       "one shared declaration gives both windows the same thin green bar");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const part of ["::-webkit-scrollbar{width:8px;height:8px}",
                    "::-webkit-scrollbar-track{background:rgba(7,12,16,.72)}",
                    "::-webkit-scrollbar-thumb{background:rgba(81,224,124,.34);border:2px solid #0a0f14;border-radius:8px}",
                    "::-webkit-scrollbar-thumb:hover{background:rgba(81,224,124,.68)}"]) {
  const decl = esc(part.slice(part.indexOf("{") + 1, -1));
  assert(new RegExp("textarea::-webkit-scrollbar[^{]*\\{[^}]*" + decl + "[^}]*\\}").test(CSS) &&
         new RegExp("pre\\.out::-webkit-scrollbar[^{]*\\{[^}]*" + decl + "[^}]*\\}").test(CSS),
         "Safari/Chromium bar rule is shared: " + part);
}
assert(!/textarea::-webkit-scrollbar\{[^}]*display:none/.test(CSS.replace(/\.pane\.bars-off textarea::-webkit-scrollbar\{[^}]*\}/g, "")),
       "the default INPUT rule has no hidden-bar leftover (only the switch hides it)");

/* ---------- 4. the switch in the INPUT header ---------- */
section("4. the INPUT scrollbar switch");
const IN_HEAD = (TPL.match(/<section class="pane"><h2>INPUT[\s\S]*?<\/h2>/) || [""])[0];
const BTN = (IN_HEAD.match(/<button[^>]*id="btnBars"[\s\S]*?<\/button>/) || [""])[0];
assert(BTN.length > 0, "the switch sits inside the INPUT header, next to the INPUT label");
assert(/class="barstoggle"/.test(BTN) && />SCROLLBAR</.test(BTN),
       "it is labelled SCROLLBAR and wears the quiet .barstoggle chrome");
assert(/role="switch"/.test(BTN) && /aria-checked="true"/.test(BTN),
       "it announces itself as a switch (aria-checked), not as a mystery glyph");
assert(/title="[^"]{30,}"/.test(BTN) && /still scrolls/i.test(BTN),
       "the hover hint says hiding the bar does not stop the window scrolling");
assert((TPL.match(/id="btnBars"/g) || []).length === 1, "the switch is declared exactly once");
assert(/\.barstoggle\[aria-checked="true"\]\{color:var\(--green\)/.test(CSS) &&
       /\.barstoggle:focus-visible\{outline:2px solid var\(--green\)/.test(CSS),
       "ON reads green like the OUTPUT window, and the switch stays keyboard-visible");
assert(/\.pane h2\{[^}]*display:flex[^}]*justify-content:space-between/.test(CSS),
       "the header lays the label and the switch out without shifting either");
assert(/\.pane\.bars-off textarea\{scrollbar-width:none;-ms-overflow-style:none\}/.test(CSS) &&
       /\.pane\.bars-off textarea::-webkit-scrollbar\{width:0;height:0;display:none\}/.test(CSS),
       "OFF hides the bar only (scrollbar-width/::-webkit-scrollbar), never the scrolling");
assert(!/\.pane\.bars-off[^{]*\{[^}]*overflow:/.test(CSS),
       "nothing in the OFF state touches overflow — the window still scrolls");

/* ---------- 5. real behaviour: the SCROLLBARS block in a vm sandbox ---------- */
section("5. behaviour (real app.js code in a vm sandbox)");
const SRC = APP.slice(APP.indexOf("/* SCROLLBARS:BEGIN */"), APP.indexOf("/* SCROLLBARS:END */") + "/* SCROLLBARS:END */".length);
assert(SRC.length > 800 && /function printGlyphs\(/.test(SRC) && /function toggleInputBars\(/.test(SRC),
       "the SCROLLBARS block extracts cleanly from app.js");

function makePane(id) {
  const el = {
    id, _cls: new Set(), offsetWidth: 10, clientHeight: 100, scrollHeight: 100,
    clientWidth: 300, scrollWidth: 300, _l: {},
    addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); },
    fire(t, ev) { (this._l[t] || []).slice().forEach(fn => fn.call(this, ev || {})); },
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k]; }
  };
  el.classList = {
    add: (c) => el._cls.add(c),
    remove: (c) => el._cls.delete(c),
    contains: (c) => el._cls.has(c),
    toggle: (c, force) => {
      const want = force === undefined ? !el._cls.has(c) : !!force;
      if (want) el._cls.add(c); else el._cls.delete(c);
      return want;
    }
  };
  return el;
}

function makeApp(opts) {
  opts = opts || {};
  const outPane = makePane("outPane"), inpPane = makePane("inpPane");
  const els = { btnBars: makePane("btnBars") };
  const scheduled = [];
  const store = Object.assign({}, opts.store);
  const sandbox = {
    console,
    document: { getElementById: (id) => els[id] || (els[id] = makePane(id)) },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    window: { matchMedia: () => ({ matches: !!opts.reducedMotion }) },
    setTimeout: (fn, ms) => { scheduled.push({ fn, ms, cancelled: false }); return scheduled.length; },
    clearTimeout: (id) => { if (scheduled[id - 1]) scheduled[id - 1].cancelled = true; },
    out: makePane("out"),
    outPane: outPane,
    inpPane: inpPane
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.localStorage = sandbox.localStorage;
  vm.createContext(sandbox);
  vm.runInContext("var $ = function (id) { return document.getElementById(id); };", sandbox, { filename: "dollar.js" });
  vm.runInContext(SRC, sandbox, { filename: "scrollbars.js" });
  return {
    sandbox, out: sandbox.out, outPane, inpPane, btnBars: els.btnBars, store, scheduled,
    runTimers() { scheduled.forEach(t => { if (!t.cancelled) t.fn(); }); },
    print(pane) { vm.runInContext("printGlyphs(__pane)", Object.assign(sandbox, { __pane: pane || sandbox.outPane }), { filename: "call.js" }); }
  };
}

/* the switch: default ON, click toggles the class + aria + storage */
let app = makeApp();
assert(app.inpPane._cls.has("bars-off") === false, "INPUT starts with the bar shown");
assert(app.btnBars.getAttribute("aria-checked") === "true", "the switch starts checked");
app.btnBars.fire("click", {});
assert(app.inpPane._cls.has("bars-off") === true, "clicking the switch hides the INPUT bar");
assert(app.btnBars.getAttribute("aria-checked") === "false", "the switch reports aria-checked=false");
assert(app.store["spicy_input_bars"] === "0", "the choice is remembered on the device");
assert(/hidden/.test(app.btnBars.title) && /show it/.test(app.btnBars.title), "the hint explains the OFF state");
app.btnBars.fire("click", {});
assert(!app.inpPane._cls.has("bars-off"), "clicking again brings the bar back");
assert(app.store["spicy_input_bars"] === "1" && app.btnBars.getAttribute("aria-checked") === "true",
       "the switch round-trips to ON");
assert(/still scrolls by wheel, keys and touch/.test(app.btnBars.title),
       "the ON hint promises the window keeps scrolling without the bar");

/* a remembered choice is applied on the next visit */
app = makeApp({ store: { spicy_input_bars: "0" } });
assert(app.inpPane._cls.has("bars-off") && app.btnBars.getAttribute("aria-checked") === "false",
       "a remembered 'bar hidden' state is restored on load");

/* the print only runs where it cannot cost a scroll */
app = makeApp();
app.print();
assert(app.outPane._cls.has("printing"), "a result prints (fade/rise)");
assert(app.outPane._cls.has("shine"), "a short result also gets the glyph streak");
assert(app.outPane._printTimer, "the print is armed with its safety-net timer");
app.runTimers();
assert(!app.outPane._cls.has("printing") && !app.outPane._cls.has("shine"),
       "when the timer fires the window is left completely plain (no clipped paint, no filter)");

app = makeApp();
app.out.scrollHeight = 4000;              // the itinerary is longer than the window
app.print();
assert(app.outPane._cls.has("printing") && !app.outPane._cls.has("shine"),
       "a scrollable result NEVER gets the clipped paint (this is the scrolling bug)");
app.runTimers();

app = makeApp();
app.out.scrollWidth = 900;                // a long unbreakable token overflows sideways
app.print();
assert(app.outPane._cls.has("printing") && !app.outPane._cls.has("shine"),
       "horizontal overflow is treated the same way");

app = makeApp({ reducedMotion: true });
app.print();
assert(!app.outPane._cls.has("shine"), "reduced-motion users never get the clipped paint");

app = makeApp();
app.print(app.inpPane);
assert(!app.inpPane._cls.has("printing") && !app.outPane._cls.has("printing"),
       "INPUT text is never clipped (only OUTPUT prints)");

/* animationend ends the shine early and clears the pending timer */
app = makeApp();
app.print();
const before = app.scheduled.filter(t => !t.cancelled).length;
app.out.fire("animationend", { animationName: "out-shine" });
assert(!app.outPane._cls.has("printing") && !app.outPane._cls.has("shine"),
       "the print ends on its own animationend");
assert(app.scheduled.filter(t => !t.cancelled).length < before, "and the safety-net timer is released");
app.out.fire("animationend", { animationName: "lg-breathe" });
assert(!app.outPane._cls.has("printing"), "unrelated animations do not touch the print state");

/* back-to-back results replay the shine without leaking timers */
app = makeApp();
app.print(); app.print();
assert(app.outPane._cls.has("printing") && app.outPane._cls.has("shine"), "a second result replays the print");
app.runTimers();
assert(!app.outPane._cls.has("printing") && !app.outPane._cls.has("shine"),
       "and leaves exactly one clean state behind");

/* ---------- 6. the built artifact carries it ---------- */
section("6. the committed single-file page carries the fix");
assert(BUILT.includes("/* SCROLLBARS:BEGIN */") && BUILT.includes("function printGlyphs(") &&
       BUILT.includes("function toggleInputBars("),
       "built index.html inlines the SCROLLBARS block (a forgotten npm run build fails here)");
assert(BUILT.includes(".pane.out.printing.shine pre.out") && BUILT.includes("background-attachment:local") &&
       BUILT.includes("textarea,pre.out{scrollbar-width:thin"),
       "built index.html carries the scroll-safe shine and the shared scrollbar rules");
assert(/<button class="barstoggle" id="btnBars"[^>]*role="switch"/.test(BUILT),
       "built index.html ships the INPUT scrollbar switch");
assert(/OUTPUT always scrolls/.test(README) && /INPUT scrollbar switch/.test(README),
       "README documents the OUTPUT scroll guarantee and the INPUT scrollbar switch");

console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
process.exit(FAIL ? 1 : 0);
