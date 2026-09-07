"use strict";
/* test_weekly_report.js — the weekly report must report a week, and must count
 * conversions the user was actually shown.
 *
 * What the report got wrong before this test existed:
 *   - a speculative Gemini call that LOST the race to the direct read was
 *     counted as a conversion, so one screenshot reported as two: 5 real
 *     conversions printed "Total Conversions: 6 (83% instant rate)";
 *   - the debounced re-render fired while the user was still typing counted one
 *     "text_direct" per 55ms pause, inflating the same total;
 *   - a fresh install printed "0 (100% instant rate)";
 *   - the counters never reset, so a lifetime total was printed under a heading
 *     that says WEEKLY, and the mistake log mixed every week together;
 *   - a blocked pop-up returned null from window.open and the click looked dead.
 *
 * Everything below runs the REAL app.js code in a vm sandbox (the same slicing
 * test_mistake_learner.js uses), so the assertions cover the browser's path.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = __dirname;
const APP = fs.readFileSync(path.join(REPO, "app.js"), "utf8");
const EMAIL = (APP.match(/var AUTHOR_EMAIL = "([^"]+)"/) || [])[1];

let PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("PASS:", msg); }
  else { FAIL++; console.error("FAIL:", msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

/* ---------- source extraction from the real app.js ---------- */
function fnSrc(name) {
  const start = APP.indexOf("function " + name + "(");
  if (start < 0) throw new Error("function not found in app.js: " + name);
  let i = APP.indexOf("{", start), depth = 0;
  for (; i < APP.length; i++) {
    if (APP[i] === "{") depth++;
    else if (APP[i] === "}") { depth--; if (!depth) return APP.slice(start, i + 1); }
  }
  throw new Error("unbalanced braces in " + name);
}
function between(a, b) {
  const start = APP.indexOf(a), end = APP.indexOf(b);
  if (start < 0 || end < 0 || end < start) throw new Error("markers not found: " + a);
  return APP.slice(start + (a === "" ? 0 : 0), end);
}
const STATS_MARK = "/* LEARNER:STATS */";
/* stats + learner + cleaner + everything else up to the report generator */
const RUNTIME_SRC = APP.slice(APP.indexOf(STATS_MARK) + STATS_MARK.length, APP.indexOf("/* REPORT:BEGIN */"));
const REPORT_SRC = APP.slice(APP.indexOf("/* REPORT:BEGIN */"), APP.indexOf("/* REPORT:END */"));
const CACHE_SRC = APP.slice(APP.indexOf("var TCACHE_KEY ="), APP.indexOf("function imgCacheAll"));
/* the subject + URL guard that live between the report generator and its opener */
const MAIL_MARK = "/* REPORT:END */";
const MAIL_CONSTS_SRC = APP.slice(APP.indexOf(MAIL_MARK) + MAIL_MARK.length, APP.indexOf("function openWeeklyReport"));
const DOLLAR_AT = APP.indexOf("var $ = function");
const DOLLAR_SRC = APP.slice(DOLLAR_AT, APP.indexOf("};", DOLLAR_AT) + 2);

function makeStore(seed) {
  const data = Object.create(null);
  Object.assign(data, seed || {});
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    stats: () => JSON.parse(data.spicy_weekly_stats_v1 || "null"),
    mistakes: () => JSON.parse(data.spicy_mistakes_log_v1 || "[]")
  };
}

function utcMonday(now) {
  const d = new Date(now || Date.now());
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
}
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const TODAY = dayKey(Date.now());
const THIS_WEEK = dayKey(utcMonday(Date.now()));
const LAST_WEEK = dayKey(utcMonday(Date.now() - 7 * 864e5));

/* The app runtime: stats/learner/cleaner + the cache, render and report code,
 * with a DOM exactly as small as the functions under test need. */
function loadApp(store, opts) {
  opts = opts || {};
  const els = {
    reportContent: { value: "" },
    reportModal: { classList: { remove() {}, add() {} } }
  };
  const sandbox = {
    console, Date, JSON, Math, Object, Array, String, Number, RegExp, Boolean, isNaN, parseInt, parseFloat,
    AUTHOR_EMAIL: EMAIL,
    SPICY_DATA: require(path.join(REPO, "spicy_data.js")),
    document: {
      createElement: () => ({ textContent: "", innerHTML: "" }),
      getElementById: (id) => els[id] || null
    },
    localStorage: { getItem: store.getItem, setItem: store.setItem },
    performance: { now: () => Date.now() },
    out: { textContent: "" },
    st: { textContent: "", title: "", className: "" },
    window: {},
    _opened: []
  };
  sandbox.window = sandbox;
  sandbox.window.open = opts.open === undefined ? ((url) => { sandbox._opened.push(url); return {}; }) : opts.open;
  sandbox.window.SpicyEngine = require(path.join(REPO, "spicy_engine.js"));
  sandbox.__els = els;
  vm.createContext(sandbox);
  vm.runInContext("var navigator = { userAgent: 'ArenaTestAgent' };", sandbox);
  vm.runInContext(DOLLAR_SRC, sandbox, { filename: "dollar.js" });
  vm.runInContext(fnSrc("setStatus"), sandbox, { filename: "setStatus.js" });
  vm.runInContext(fnSrc("fp"), sandbox, { filename: "fp.js" });
  vm.runInContext("var lastOut = '';", sandbox);
  vm.runInContext(RUNTIME_SRC, sandbox, { filename: "runtime.js" });
  vm.runInContext(CACHE_SRC, sandbox, { filename: "cache.js" });
  vm.runInContext(fnSrc("renderDirectSync"), sandbox, { filename: "renderDirectSync.js" });
  vm.runInContext(REPORT_SRC, sandbox, { filename: "report.js" });
  vm.runInContext(MAIL_CONSTS_SRC, sandbox, { filename: "mailConsts.js" });
  vm.runInContext(fnSrc("openGmailCompose"), sandbox, { filename: "openGmailCompose.js" });
  vm.runInContext(fnSrc("openWeeklyReport"), sandbox, { filename: "openWeeklyReport.js" });
  vm.runInContext(
    "this.__api = { loadStats: loadStats, recordStat: recordStat, renderDirectSync: renderDirectSync," +
    " generateWeeklyReportText: generateWeeklyReportText, openWeeklyReport: openWeeklyReport," +
    " loadMistakes: loadMistakes, recordMistake: recordMistake, weekStart: statsWeekStart, dayKey: statsDayKey };",
    sandbox);
  return sandbox;
}

const PASTE = "1 AA 6935 12OCT LAX JFK 345P 1015A N\n2 AA 7037 13OCT JFK LAX 1205P 110P N";

section("1. an AI call the direct read beat is a call, not a conversion");
{
  const store = makeStore();
  const A = loadApp(store).__api;
  // exactly what one screenshot does when OCR takes longer than the
  // speculation threshold and the direct read then wins the race
  A.recordStat("ai_call");            // speculative timer fires (app.js)
  A.recordStat("img_direct", 1842);   // ...direct parse lands and paints
  A.recordStat("text_direct");
  const s = store.stats();
  assert(s.period.total === 2, "two results shown = two conversions (got " + s.period.total + ")");
  assert(s.period.imgDirect === 1 && s.period.textDirect === 1, "one screenshot + one paste, counted once each");
  assert(s.period.aiCalls === 1 && s.period.aiResolved === 0,
    "the discarded reply stays in the AI-call count, not the conversion count");
  assert(s.lifetime.total === 2, "lifetime agrees with the week for a fresh install");
  const report = A.generateWeeklyReportText();
  assert(/Total Conversions: 2 /.test(report), "the report prints the same 2: " +
    (report.match(/• Total Conversions:.*/) || ["(missing)"])[0]);
  assert(/\(100% instant rate\)/.test(report), "a week that was fully instant says 100%, not 83%");
  assert(/AI Calls Started: 1 /.test(report) && /Conversions Completed By AI: 0/.test(report),
    "AI calls and AI results are separate lines");
}

section("2. typing is not converting");
{
  const store = makeStore();
  const A = loadApp(store).__api;
  // the debounced re-render that keeps the pane live while the user types
  const typed = A.renderDirectSync(PASTE, { counted: false });
  assert(typed.segs.length === 2, "the live preview still parses (got " + typed.segs.length + " legs)");
  assert(A.loadStats().period.total === 0, "a keystroke pause adds no conversion (total " +
    A.loadStats().period.total + ")");
  // CONVERT on the same text is a conversion
  A.renderDirectSync(PASTE);
  assert(A.loadStats().period.total === 1, "pressing CONVERT on it counts once (total " +
    A.loadStats().period.total + ")");
  A.renderDirectSync(PASTE, { counted: false });
  A.renderDirectSync(PASTE, { counted: false });
  assert(A.loadStats().period.total === 1, "more typing still adds nothing (total " +
    A.loadStats().period.total + ")");
}

section("3. the week rolls over instead of accumulating forever");
{
  const store = makeStore({
    spicy_weekly_stats_v1: JSON.stringify({
      week: LAST_WEEK,
      period: { total: 9, textDirect: 7, imgDirect: 2, aiResolved: 1, aiCalls: 3, durations: [500, 700] },
      lifetime: { total: 40, textDirect: 33, imgDirect: 6, aiResolved: 1, aiCalls: 5 },
      history: []
    })
  });
  const A = loadApp(store).__api;
  const s = A.loadStats();
  assert(s.week === THIS_WEEK, "the store is re-keyed to this week (" + s.week + ")");
  assert(s.period.total === 0, "this week opens at zero (got " + s.period.total + ")");
  assert(s.lifetime.total === 49, "the closed week rolls into the lifetime total (40 + 9 = " + s.lifetime.total + ")");
  assert(s.history.length === 1 && s.history[0].week === LAST_WEEK && s.history[0].total === 9,
    "and is archived as last week: " + JSON.stringify(s.history[0]));
  assert(store.stats().period.total === 0, "the rollover is persisted, not just computed in memory");
  A.recordStat("text_direct");
  assert(A.loadStats().period.total === 1, "the next conversion lands in the new week");
  const report = A.generateWeeklyReportText();
  assert(new RegExp("Period: " + THIS_WEEK + " → " + TODAY).test(report),
    "the report names the period it covers: " + (report.match(/Period:.*/) || ["(missing)"])[0]);
  assert(new RegExp("Previous Week \\(" + LAST_WEEK + "\\): 9 conversion\\(s\\), 9 instant, 1 completed by AI")
    .test(report), "and compares against last week: " + (report.match(/• Previous Week.*/) || ["(missing)"])[0]);
  assert(/Since Install: 50 conversion/.test(report), "lifetime is its own line, not the weekly number");
}

section("4. a pre-weekly store is not relabelled as one week");
{
  const store = makeStore({
    spicy_weekly_stats_v1: JSON.stringify({
      startDate: "2026-01-04", total: 120, textDirect: 100, imgDirect: 18, aiFallback: 9, durations: [800]
    })
  });
  const A = loadApp(store).__api;
  const s = A.loadStats();
  assert(s.period.total === 0, "the old lifetime counters do not become this week's numbers");
  assert(s.lifetime.total === 120, "they are kept as the lifetime total (got " + s.lifetime.total + ")");
  assert(s.lifetime.aiCalls === 9, "the legacy aiFallback counter maps onto AI calls");
  const report = A.generateWeeklyReportText();
  assert(/Total Conversions: 0 /.test(report) && /Since Install: 120 conversion/.test(report),
    "the report says 0 this week and 120 since install, not 120 this week");
}

section("5. nothing converted is not a 100% instant rate");
{
  const A = loadApp(makeStore()).__api;
  const report = A.generateWeeklyReportText();
  assert(/Instant Conversions: 0 \(no conversions yet — nothing to rate\)/.test(report),
    "a fresh install says there is nothing to rate: " + (report.match(/• Instant Conversions:.*/) || ["(missing)"])[0]);
  assert(!/100% instant rate/.test(report), "and never claims a perfect rate it did not earn");
  assert(/N\/A — no screenshots parsed this week/.test(report), "latency says N/A instead of a fake number");
  assert(/No mistakes detected this period/.test(report), "and the mistake section still reads cleanly");
}

section("6. the mistake log is scoped to the week the report covers");
{
  const store = makeStore();
  const A = loadApp(store).__api;
  A.recordMistake({ when: LAST_WEEK + " 09:12:00", reason: "old", summary: "Flight 1 route: LAX-JFK vs LAX-SFO" });
  A.recordMistake({ when: TODAY + " 08:00:00", reason: "new", summary: "Flight 1 date: 12OCT vs 13OCT" });
  const report = A.generateWeeklyReportText();
  assert(/\(1 this week, 2 in the stored log\)/.test(report),
    "the heading separates the week from the log: " + (report.match(/--- 2\..*/) || ["(missing)"])[0]);
  assert(/Flight 1 date: 12OCT vs 13OCT/.test(report), "this week's mistake is listed");
  assert(!/LAX-SFO/.test(report), "last week's mistake is not mixed into this week's report");
}

section("7. a blocked pop-up says so instead of looking dead");
{
  const blocked = loadApp(makeStore(), { open: () => null });   // what a browser returns
  blocked.__api.openWeeklyReport();
  assert(blocked.st.className === "warn", "the status bar flags it: " + blocked.st.textContent);
  assert(/POP-UP BLOCKED/.test(blocked.st.textContent) && /COPY REPORT/.test(blocked.st.textContent),
    "and tells the user the way out: " + blocked.st.textContent);
  assert(blocked.__els.reportContent.value.indexOf("=== SPICYTERMINAL WEEKLY PERFORMANCE") === 0,
    "the report itself is still in the modal box");

  const allowed = loadApp(makeStore());
  allowed.__api.openWeeklyReport();
  assert(allowed.st.className !== "warn", "no warning when the tab opens");
  const url = allowed._opened[0] || "";
  assert(url.indexOf("https://mail.google.com/mail/?view=cm") === 0 &&
         url.indexOf("to=" + encodeURIComponent(EMAIL)) > 0, "compose opens addressed to " + EMAIL);
  assert(decodeURIComponent(url).indexOf("SPICYTERMINAL WEEKLY PERFORMANCE") > 0,
    "with the report in the body");
}

console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
process.exit(FAIL ? 1 : 0);
