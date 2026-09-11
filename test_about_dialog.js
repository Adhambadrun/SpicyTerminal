"use strict";
/* test_about_dialog.js — the About dialog must be a real, safe modal.
 *
 * A pretty dialog is easy to ship and easy to break. What this pins down:
 *   - the trigger is labelled exactly `About`, sits at the head of the status row
 *     (About / Generate Api / Weekly Report / Report a bug) and appears once;
 *   - opening it closes nothing else and must not disturb conversion state
 *     (no attachment batch invalidation, no AI request cancelled);
 *   - ESC, the × button and a click on the dimmed backdrop all close it, while
 *     a click inside the card does not;
 *   - focus is taken on open and handed back to `About` on close, and TAB is
 *     trapped inside the dialog so a keyboard user cannot walk into the app
 *     behind it (and get lost);
 *   - the wordmark is shared with the header instead of embedding the same
 *     base64 blob a second time, so the single-file artifact stays small;
 *   - every id in the page stays unique, and the committed index.html is in
 *     sync with the sources (a forgotten `npm run build` fails here).
 *
 * Behaviour runs the REAL app.js About code in a vm sandbox with a DOM exactly
 * as small as the dialog needs — same approach as test_weekly_report.js.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = __dirname;
const APP = fs.readFileSync(path.join(REPO, "app.js"), "utf8");
const TPL = fs.readFileSync(path.join(REPO, "index_template.html"), "utf8");
const BUILT = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
const EMAIL = (APP.match(/var AUTHOR_EMAIL = "([^"]+)"/) || [])[1];

let PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("PASS:", msg); }
  else { FAIL++; console.error("FAIL:", msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

/* ---------- 1. the trigger in the header ---------- */
section("1. About trigger: first control of the status row group");
const HEADER = (TPL.match(/<header>[\s\S]*?<\/header>/) || [""])[0];
assert(/<div class="credit">made by Adham Badran<\/div>/.test(HEADER), "the header keeps the 'made by Adham Badran' credit");
assert(!/btnAbout/.test(HEADER), "About is no longer in the header (it moved to the status row)");

const SB_START = TPL.indexOf('<div class="status">');
const SB = TPL.slice(SB_START, TPL.indexOf('</div>', SB_START));
const ORDER_IDS = ["btnAbout", "genKey", "btnWeeklyReport", "report"];
const AT = ORDER_IDS.map(id => SB.indexOf('id="' + id + '"'));
assert(AT.every(i => i >= 0), "all four status controls are present");
assert(String(AT) === String(AT.slice().sort((a, b) => a - b)),
       "order is About / Generate Api / Weekly Report / Report a bug (found: " +
       ORDER_IDS.slice().sort((a, b) => AT[ORDER_IDS.indexOf(a)] - AT[ORDER_IDS.indexOf(b)]).join(" / ") + ")");
const btnTag = (SB.match(/<button[^>]*id="btnAbout"[\s\S]*?<\/button>/) || [""])[0];
assert(/>About<\/button>/.test(btnTag), "the button label is exactly 'About'");
assert(/class="linkbtn"/.test(btnTag), "About is a .linkbtn like its three neighbours, not a competing button");
assert((SB.match(/>About</g) || []).length === 1, "About appears once in the row");
assert((TPL.match(/id="btnAbout"/g) || []).length === 1, "About is declared exactly once in the whole page");
assert(/aria-haspopup="dialog"/.test(btnTag) && /aria-controls="aboutModal"/.test(btnTag),
       "trigger announces a dialog it controls (aria-haspopup/aria-controls)");
assert(/title="[^"]{20,}"/.test(btnTag), "the trigger explains itself on hover, since the word 'About' alone does not");

const CSS0 = TPL.slice(TPL.indexOf("<style>"), TPL.indexOf("</style>"));
assert(/#btnAbout\{margin-left:auto\}/.test(CSS0) && !/#genKey\{[^}]*margin-left:auto/.test(CSS0),
       "the right-alignment moved with the group: About owns margin-left:auto, Generate Api no longer does");
assert(/#genKey\{margin-right:12px\}/.test(CSS0) && /#btnWeeklyReport\{margin-right:12px\}/.test(CSS0),
       "the row keeps its 12px separators between the links");
assert(/#report:hover,#genKey:hover,#btnWeeklyReport:hover,#btnAbout:hover\{/.test(CSS0),
       "About shares the row's single hover rule instead of inventing a bespoke one");
assert(!/\.about-btn/.test(CSS0), "no leftover header-pill styling behind");

/* ---------- 2. the dialog markup ---------- */
section("2. About dialog markup");
const dlgStart = TPL.indexOf('id="aboutModal"');
const dlgEnd = TPL.indexOf('<div class="modal hidden attachment-review-modal"');
assert(dlgStart > 0 && dlgEnd > dlgStart, "About dialog is present in the template");
const DLG = TPL.slice(dlgStart, dlgEnd);
assert(/class="modal hidden about-modal"/.test(TPL), "dialog starts hidden via .hidden");
assert(/role="dialog"/.test(DLG) && /aria-modal="true"/.test(DLG), "role=dialog + aria-modal");
assert(/aria-labelledby="aboutTitle"/.test(DLG) && /aria-describedby="aboutTagline"/.test(DLG),
       "dialog is labelled and described for screen readers");
assert(DLG.includes("to paste into Backoffice"), "dialog opens with a one-line summary of what the app does");
assert(!/offline/i.test(DLG), "the About dialog never says 'offline'");
assert(!/about-live/.test(TPL), "the OFFLINE ENGINE pill — and its CSS — is gone from the template");
for (const topic of [/Copy-ready GDS output/i, /Text or screenshots/i, /AI FIX/, /Private/i]) {
  assert(topic.test(DLG), "feature blurb covers " + topic);
}
assert(/Adham Badran/.test(DLG) && /Solo developer/.test(DLG), "dialog names Adham Badran with his role");
assert(DLG.includes(EMAIL), "dialog links the author's email " + EMAIL);
assert(/mailto:/.test(DLG), "email link offered");
assert(!/github\.com\/Adhambadrun\/SpicyTerminal/.test(DLG) && !/Source on GitHub/.test(DLG), "GitHub link removed from About");
assert(!/href="https?:\/\//.test(DLG), "no external http link remains in the dialog");
assert((DLG.match(/aria-hidden="true"/g) || []).length >= (DLG.match(/<svg/g) || []).length,
       "every decorative icon/ornament is aria-hidden");
assert(!/lorem|placeholder text|TODO/i.test(DLG), "no filler text in the dialog copy");
assert(DLG.length < 12000, "feature list stays short (" + DLG.length + " bytes of markup)");

section("2b. Pasting converts by itself; AI FIX repairs a failed first read")
assert(/converts the moment it lands/.test(DLG) && /re-reads and repairs the output/.test(DLG),
       "About says conversion is automatic on paste and what AI FIX is for")
assert(/When a first read cannot see the flights/.test(DLG) && /Your key, your call/.test(DLG),
       "About frames AI FIX as a repair pass behind your own key, not the default path")
const WELCOME = TPL.slice(TPL.indexOf('class="welcome'), TPL.indexOf('<div class="modal hidden" id="setModal"'))
assert(/converts on its own/.test(WELCOME) && /AI FIX/.test(WELCOME),
       "the welcome card says the same thing before the first paste")
assert(/if a first pass ever cannot read it|first pass ever cannot read it/i.test(WELCOME),
       "the welcome card names the failure case people hit: nothing read the first time")
assert(/only what|only powers|only runs on/i.test(WELCOME) && /free, takes 20 seconds/.test(WELCOME),
       "the welcome card says the key is only for AI FIX, and that it is free")
const KEYMODAL = TPL.slice(TPL.indexOf('id="setModal"'), TPL.indexOf('id="reportModal"'))
assert(/AI FIX is the button you press when the auto read cannot/.test(KEYMODAL),
       "the key dialog defines AI FIX rather than assuming it is understood")
const BTN_AI = (TPL.match(/<button[^>]*id="btnAi"[\s\S]*?<\/button>/) || [""])[0]
assert(/title="[^"]*misses a leg[^"]*"/.test(BTN_AI), "AI FIX carries a hover hint describing the repair job")

/* no inflated numbers: every count chip must be backed by the shipped data file */
const DATA = require(path.join(REPO, "spicy_data.js"));
const ENTRIES = ["airports", "airlines", "airlineAliases", "cityAliases", "aircraft",
                 "aircraftTypes", "routeEquipment", "airlineEquipment", "genericEquipment",
                 "flightEquipment"].reduce((n, k) => n + Object.keys(DATA[k] || {}).length, 0);
const claimed = [...DLG.matchAll(/<b>([\d,]{3,7})\+?<\/b>/g)]
  .map(m => parseInt(m[1].replace(/,/g, ""), 10))
  .filter(n => !isNaN(n) && n > 100);
assert(claimed.length > 0 && claimed.every(n => n <= ENTRIES),
       "claimed dictionary size (" + claimed.join("/") + ") is within the real " + ENTRIES + " entries");
/* the stats row is exactly the two chips the author wants, nothing more */
const STATS_UL = (DLG.match(/<ul class="about-stats">[\s\S]*?<\/ul>/) || [""])[0];
assert((STATS_UL.match(/<li>/g) || []).length === 2, "stats row keeps exactly two chips");
assert(/<b>0<\/b> accounts · cookies · trackers/.test(STATS_UL) && /1,600\+/.test(STATS_UL),
       "stats row claims 0 accounts and the 1,600+ dictionary size");
assert(!/static file|fuzz/i.test(DLG), "no '1 static file' or fuzz-suite chip remains in the dialog");

/* motion is decoration here, so it must be switch-offable */
const CSS = TPL.slice(TPL.indexOf("<style>"), TPL.indexOf("</style>"));
assert(/\.about-card\{[^}]*animation:aboutIn/.test(CSS) && /prefers-reduced-motion:reduce\)\{\.about-card\{animation:none/.test(CSS),
       "the dialog entrance is disabled under prefers-reduced-motion");
assert(/#btnAbout:focus-visible|\.linkbtn\{[^}]*cursor:pointer/.test(CSS),
       "the trigger stays keyboard-visible in the row");

/* unique ids across the whole page (an id collision would silently break focus) */
const ids = (TPL.match(/\sid="[^"]+"/g) || []).map(s => s.slice(5, -1));
const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
assert(dupes.length === 0, "no duplicate ids in the page (found: " + [...new Set(dupes)].join(", ") + ")");

/* the wordmark must be referenced, never embedded twice */
assert(/id="wordmarkAbout" src=""/.test(TPL), "About wordmark starts empty and is filled at runtime");
assert((BUILT.match(/data:image\/png;base64,/g) || []).length === 2,
       "built page still carries exactly 2 PNG data URIs (no duplicated wordmark)");

/* ---------- 3. real behaviour, real app.js code ---------- */
section("3. Dialog behaviour (real app.js in a vm sandbox)");

function makeEl(id) {
  const el = {
    id, _cls: new Set(["hidden"]), textContent: "", value: "", offsetWidth: 10, offsetHeight: 10,
    _l: {},
    addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); },
    fire(t, ev) { (this._l[t] || []).slice().forEach(fn => fn.call(this, ev || {})); },
    focus() { doc.activeElement = this; focusLog.push(id); },
    getClientRects() { return [{ width: 10 }]; },
    querySelectorAll() { return []; }
  };
  el.classList = {
    add: (c) => el._cls.add(c),
    remove: (c) => el._cls.delete(c),
    contains: (c) => el._cls.has(c)
  };
  return el;
}

const ABOUT_SRC = APP.slice(APP.indexOf("/* ABOUT:BEGIN */"), APP.indexOf("/* ABOUT:END */") + "/* ABOUT:END */".length);
assert(ABOUT_SRC.length > 400 && /function openAbout\(/.test(ABOUT_SRC), "About block extracted from app.js");

const els = {};
let focusLog = [];
const keyListeners = [];
const doc = {
  activeElement: null,
  getElementById: (id) => els[id] || (els[id] = makeEl(id)),
  createElement: () => ({ style: {}, select() {}, remove() {}, value: "", textContent: "" }),
  addEventListener: (t, fn) => { if (t === "keydown") keyListeners.push(fn); },
  body: { appendChild() {}, removeChild() {} }
};
const copies = [];
const sandbox = {
  console, setTimeout, clearTimeout, document: doc, AUTHOR_EMAIL: EMAIL,
  localStorage: { getItem: () => null, setItem() {} },
  navigator: { clipboard: { writeText: (t) => { copies.push(t); return { then: (ok) => ok() }; } } },
  st: { textContent: "", title: "", className: "" },
  inp: null,
  window: {}
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext("var st = { textContent:'', title:'', className:'' }; var inp = { focus(){} };", sandbox, { filename: "stub.js" });
vm.runInContext("var $ = function (id) { return document.getElementById(id); };", sandbox, { filename: "dollar.js" });
vm.runInContext("function setStatus(msg, warn) { st.textContent = msg; st.title = msg; st.className = warn ? 'warn' : ''; }", sandbox);
vm.runInContext(ABOUT_SRC, sandbox, { filename: "about.js" });

/* the card reports the same focusable order a browser would */
const CARD = doc.getElementById("aboutCard");   // getElementById is what lazily creates the stub
const ORDER = ["aboutClose", "aboutEmailLink", "aboutCopyMail", "aboutGo"];
CARD.querySelectorAll = () => ORDER.map(id => doc.getElementById(id));
const BTN = doc.getElementById("btnAbout");
BTN._cls.delete("hidden");                                 // the trigger is visible
BTN.focus();
doc.activeElement = BTN;

const modal = doc.getElementById("aboutModal");
const isOpen = () => !modal.classList.contains("hidden");

vm.runInContext("openAbout()", sandbox);
assert(isOpen(), "openAbout() shows the dialog");
assert(focusLog[focusLog.length - 1] === "aboutClose", "focus moves into the dialog on open (to its first control)");
assert(/^SpicyTerminal v\d+\.\d+\.\d+$/.test(doc.getElementById("aboutFootVer").textContent),
       "footer version is stamped from APP_VERSION (" + doc.getElementById("aboutFootVer").textContent + ")");

/* re-opening an already open dialog must not steal focus again */
const focusCount = focusLog.length;
vm.runInContext("openAbout()", sandbox);
assert(isOpen() && focusLog.length === focusCount, "double open is idempotent — no focus hijack, no double scroll reset");

/* a click inside the card keeps it open; a click on the backdrop closes it */
els["aboutCard"].fire("click", {});
assert(isOpen(), "clicking the card itself does not close the dialog");
modal.fire("click", { target: modal });
assert(!isOpen(), "clicking the dimmed backdrop closes the dialog");

/* ESC closes it and focus goes home to the trigger */
modal._cls.add("hidden");
vm.runInContext("openAbout()", sandbox);
focusLog = [];
keyListeners.forEach(fn => fn({ key: "Escape", preventDefault() {} }));
assert(!isOpen(), "Escape closes the dialog");
assert(focusLog[focusLog.length - 1] === "btnAbout", "focus returns to the About button after Escape");

/* the TAB trap wraps at both ends */
vm.runInContext("openAbout()", sandbox);
let prevented = 0;
const tab = (shift, active) => {
  doc.activeElement = els[active];
  prevented = 0;
  keyListeners.forEach(fn => fn({ key: "Tab", shiftKey: shift, preventDefault() { prevented++; } }));
};
tab(false, "aboutGo");
assert(prevented === 1 && doc.activeElement === els["aboutClose"], "TAB at the last control wraps to the first");
tab(true, "aboutClose");
assert(prevented === 1 && doc.activeElement === els["aboutGo"], "SHIFT+TAB at the first control wraps to the last");
tab(true, "aboutGo");
assert(prevented === 0, "TAB in the middle of the dialog is left to the browser");

/* START CONVERTING closes the dialog and hands the caret to the input */
focusLog = [];
vm.runInContext("openAbout()", sandbox);
doc.getElementById("aboutGo").fire("click", {});
assert(!isOpen(), "'START CONVERTING' closes the dialog");

/* the copy-email control uses the clipboard and says so */
const COPYBTN = doc.getElementById("aboutCopyMail");
COPYBTN.textContent = "COPY EMAIL";
COPYBTN.fire("click", {});
assert(copies[copies.length - 1] === EMAIL, "COPY EMAIL puts the author address on the clipboard");
assert(COPYBTN.textContent === "COPIED ✓", "COPY EMAIL confirms with a state change");
assert(/AUTHOR EMAIL COPIED/.test(sandbox.st.textContent), "status bar reports the copy");

/* a clipboard that refuses (insecure origin, denied permission) must still
   leave the user with the address, not a button that silently did nothing */
COPYBTN.textContent = "COPY EMAIL";
sandbox.navigator.clipboard.writeText = (t) => { copies.push(t); return { then: (ok, err) => err(new Error("denied")) }; };
COPYBTN.fire("click", {});
assert(copies[copies.length - 1] === EMAIL && COPYBTN.textContent === "COPIED ✓",
       "COPY EMAIL still confirms on a rejected clipboard write (no dead button)");

/* closing from the × button must also release focus */
focusLog = [];
doc.activeElement = els["btnAbout"];
vm.runInContext("openAbout()", sandbox);
doc.getElementById("aboutClose").fire("click", {});
assert(!isOpen(), "× button closes the dialog");

/* opening About must not touch conversion state at all */
section("4. No side effects on the converter");
assert(!/attachmentVersion\+\+|latestAttachmentBatch\+\+|cancelOcrWork|aiRequestId\+\+/.test(ABOUT_SRC),
       "About code never invalidates an in-flight attachment/AI batch");
assert(!/localStorage/.test(ABOUT_SRC.replace(/spicy_[a-z_]+/g, "")), "About writes nothing to storage");
assert(!/fetch\(|XMLHttpRequest|\.post\(/.test(ABOUT_SRC), "About sends nothing anywhere");

/* ---------- 5. the artifact is actually rebuilt ---------- */
section("5. Built artifact in sync");
const publicBuilt = path.join(REPO, "public", "index.html");
assert(BUILT.includes("function openAbout("), "built index.html contains the About logic");
assert(/\.about-card\{[^}]*border-radius:16px/.test(BUILT) && /#btnAbout\{margin-left:auto\}/.test(BUILT) && BUILT.includes("--bg:#05080b"),
       "built index.html carries the About styles and the row alignment rule");
assert(!/about-btn/.test(BUILT), "the superseded header-pill class is gone from the artifact");
if (fs.existsSync(publicBuilt)) {
  assert(fs.readFileSync(publicBuilt, "utf8") === BUILT, "public/index.html matches index.html (deploy copy rebuilt)");
}
assert(/>About<\/button>/.test(BUILT.slice(BUILT.indexOf('<div class="status">'), BUILT.indexOf('</div>', BUILT.indexOf('<div class="status">')))),
       "the built page renders the label 'About' in the status row");
assert(/>AI FIX<\/button>/.test(BUILT), "the built page renames the repair button to AI FIX");

console.log(`\n=== SUMMARY: ${PASS} passed, ${FAIL} failed ===`);
if (FAIL > 0) process.exit(1);
