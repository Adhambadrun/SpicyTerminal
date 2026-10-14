/* test_update_notice.js — a tab that stayed open learns that a newer build is
 * live, and says so with ONE small notice: "NEW VERSION LIVE · REFRESH".
 *
 * How it works, and what this pins down:
 *   - build_web.py stamps one id into the page (window.SPICY_BUILD_ID) and the
 *     same id into public/version.json. The id is a hash of the finished page,
 *     so an identical rebuild gives an identical id (no churn in the committed
 *     offline copies) and any merge that changes the shipped page gives a new
 *     one — a README-only merge nags nobody.
 *   - app.js polls /version.json (first look after 45 s, then once a minute
 *     while visible, plus a look on focus / visibility / online, at most once
 *     per 15 s from those) and shows the notice when the id has moved on.
 *   - It never reloads on its own; REFRESH does. × keeps the notice away for
 *     that build only — a later build shows it again.
 *   - Offline, file://, a 404, bad JSON or an unstamped page: nothing is shown,
 *     nothing reaches the status bar, and failed looks back off (≤ 10 min).
 *   - The notice is still: no animation or transition, like the rest of the UI.
 *   - /version.json is served with Cache-Control: no-store on both hosts.
 *
 * Behaviour runs the REAL app.js UPDATE_NOTICE block in a vm sandbox with a
 * DOM exactly as small as the notice needs — same approach as the About test.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = __dirname;
const APP = fs.readFileSync(path.join(REPO, "app.js"), "utf8");
const TPL = fs.readFileSync(path.join(REPO, "index_template.html"), "utf8");
const BUILT = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
const BUILD_PY = fs.readFileSync(path.join(REPO, "build_web.py"), "utf8");
const README = fs.readFileSync(path.join(REPO, "README.md"), "utf8");

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log("PASS: " + msg); }
  else { failed++; console.error("FAIL: " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

/* ---------- 1. markup ---------- */
section("1. the notice markup: small, hidden by default, two buttons");
const CARD = (TPL.match(/<div class="update-notice hidden" id="updateNotice"[\s\S]*?<\/div>/) || [""])[0];
assert(CARD.length > 0, "the notice card exists and starts hidden");
assert(/role="status"/.test(CARD) && /aria-live="polite"/.test(CARD), "it is announced politely, never as an alert");
assert(/>NEW VERSION LIVE</.test(CARD), "the text is three words: NEW VERSION LIVE");
assert(/id="updateNoticeRefresh"[^>]*>REFRESH</.test(CARD), "one REFRESH button");
assert(/id="updateNoticeClose"[^>]*aria-label="[^"]*Dismiss[^"]*"/.test(CARD) && />×</.test(CARD), "one × to dismiss, labelled for screen readers");
assert((CARD.match(/<button/g) || []).length === 2, "exactly two controls — nothing else to read");
assert(CARD.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().length < 40, "the whole card reads in under 40 characters");
assert(TPL.indexOf('id="updateNotice"') < TPL.indexOf("__APP_JS__"), "the card is in the page before app.js runs");
for (const id of ["updateNotice", "updateNoticeRefresh", "updateNoticeClose"]) {
  assert((TPL.match(new RegExp('id="' + id + '"', "g")) || []).length === 1, "id " + id + " is declared once");
}
const STAMP = '<script>window.SPICY_BUILD_ID="__SPICY_BUILD_ID__";</script>';
assert(TPL.includes(STAMP), "the template carries the build-stamp slot");
assert(TPL.indexOf(STAMP) < TPL.indexOf("<script>__APP_JS__</script>"), "the stamp is set before app.js reads it");

/* ---------- 2. CSS: still, small, in the corner ---------- */
section("2. the notice CSS declares no motion");
const CSS = TPL.slice(TPL.indexOf("<style>"), TPL.indexOf("</style>"));
const NOTICE_CSS = CSS.slice(CSS.indexOf("UPDATE_NOTICE"), CSS.indexOf("__SEATMAP_CSS__"));
assert(NOTICE_CSS.length > 200 && /\.update-notice\{position:fixed/.test(NOTICE_CSS), "the card is a fixed corner element");
assert(!/animation\s*:|transition\s*:|@keyframes/.test(NOTICE_CSS), "no animation, no transition, no keyframes");
assert(/bottom:clamp\(/.test(NOTICE_CSS) && /right:clamp\(/.test(NOTICE_CSS), "it sits bottom-right, out of the way of both panes");
assert(/z-index:60/.test(NOTICE_CSS), "it rises above the welcome card (50) and key dialog (51)");
assert(/max-width:calc\(100vw - 20px\)/.test(NOTICE_CSS), "it cannot overflow a phone screen");

/* ---------- 3. the build stamps the page and writes version.json ---------- */
section("3. build_web.py stamps the page and emits public/version.json");
assert(/def build_id_for\(html\)/.test(BUILD_PY) && /hashlib\.sha1/.test(BUILD_PY), "the id is a hash of the finished page");
assert(/os\.environ\.get\("SPICY_BUILD_ID"/.test(BUILD_PY), "SPICY_BUILD_ID can force a stamp");
assert(/html\.replace\("__SPICY_BUILD_ID__", build_id\)/.test(BUILD_PY), "the stamp is filled into the page");
assert(/"version\.json"/.test(BUILD_PY) && /"build": build_id/.test(BUILD_PY), "public/version.json carries the same id");
const builtId = (BUILT.match(/window\.SPICY_BUILD_ID="([^"]*)"/) || [])[1] || "";
assert(/^[0-9a-f]{12}$/.test(builtId), "the committed index.html is stamped with a 12-hex build id (" + builtId + ")");
assert(!BUILT.includes("__SPICY_BUILD_ID__"), "no unfilled placeholder is left in the built page");
assert(BUILT.includes("/* UPDATE_NOTICE:BEGIN */") && BUILT.includes('id="updateNotice"'), "the built page carries the notice logic and markup");
assert(fs.readFileSync(path.join(REPO, "app.html"), "utf8") === BUILT, "app.html is the same freshly built page");
const PUB_INDEX = path.join(REPO, "public", "index.html"), PUB_VER = path.join(REPO, "public", "version.json");
if (fs.existsSync(PUB_INDEX) && fs.existsSync(PUB_VER)) {
  const pubId = (fs.readFileSync(PUB_INDEX, "utf8").match(/window\.SPICY_BUILD_ID="([^"]*)"/) || [])[1];
  let ver = null;
  try { ver = JSON.parse(fs.readFileSync(PUB_VER, "utf8")); } catch (e) { ver = null; }
  assert(ver && ver.build === pubId, "public/version.json.build equals the id stamped into public/index.html");
  assert(ver && typeof ver.version === "string" && typeof ver.builtAt === "string", "version.json also says the app version and build time");
} else {
  console.log("  (public/ not built here — run `npm run build` to check version.json against the deploy page)");
}
const VERCEL = JSON.parse(fs.readFileSync(path.join(REPO, "vercel.json"), "utf8"));
const vHeader = (VERCEL.headers || []).find(h => h.source === "/version.json");
assert(vHeader && vHeader.headers.some(h => /cache-control/i.test(h.key) && /no-store/.test(h.value)), "Vercel serves /version.json with no-store");
const NETLIFY = fs.readFileSync(path.join(REPO, "netlify.toml"), "utf8");
assert(/for = "\/version\.json"[\s\S]*?Cache-Control = "no-store/.test(NETLIFY), "Netlify serves /version.json with no-store");

/* ---------- 4. real behaviour, real app.js code ---------- */
section("4. behaviour (real app.js UPDATE_NOTICE block in a vm sandbox)");
const SRC = APP.slice(APP.indexOf("/* UPDATE_NOTICE:BEGIN */"), APP.indexOf("/* UPDATE_NOTICE:END */") + "/* UPDATE_NOTICE:END */".length);
assert(SRC.length > 1500 && /function checkForUpdate\(/.test(SRC) && /initUpdateNotice\(\);/.test(SRC), "UPDATE_NOTICE block extracted from app.js and self-starting");
assert(!/setStatus\(/.test(SRC), "the notice never writes to the status bar");
assert(!/__SPICY_BUILD_ID__/.test(SRC), "app.js never spells the placeholder (the build would fill it in)");
assert((SRC.match(/location\.reload\(\)/g) || []).length === 1 && /refresh\.addEventListener\("click"[\s\S]{0,80}location\.reload\(\)/.test(SRC),
       "the only reload in the block is behind the REFRESH button");

function makeEl(id) {
  const el = { id, _cls: new Set(["hidden"]), _l: {},
    addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); },
    fire(t) { (this._l[t] || []).slice().forEach(fn => fn.call(this, {})); } };
  el.classList = { add: c => el._cls.add(c), remove: c => el._cls.delete(c), contains: c => el._cls.has(c) };
  return el;
}

function boot(opts) {
  opts = opts || {};
  const els = {}, timers = [], fetches = [], docListeners = {}, winListeners = {};
  let reloads = 0, now = 1000000;
  const doc = {
    visibilityState: "visible",
    getElementById: id => els[id] || (els[id] = makeEl(id)),
    addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); }
  };
  const win = {
    SPICY_BUILD_ID: "stamp" in opts ? opts.stamp : "aaaaaaaaaaaa",
    location: { protocol: opts.protocol || "https:", reload() { reloads++; } },
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); }
  };
  const responses = [];
  const sandbox = {
    window: win, document: doc, console,
    Promise, Math, String, Error,
    Date: { now: () => now },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    fetch: (url, init) => {
      fetches.push({ url, init });
      const r = responses.length ? responses.shift() : { ok: true, status: 200, json: () => Promise.resolve({ build: win.SPICY_BUILD_ID }) };
      if (r instanceof Error) return Promise.reject(r);
      return Promise.resolve(r);
    },
    $: id => doc.getElementById(id)
  };
  if (opts.noFetch) delete sandbox.fetch;
  vm.createContext(sandbox);
  const ret = vm.runInContext(SRC + "\n;({ init: initUpdateNotice, check: checkForUpdate, failures: function(){ return updateNoticeFailures; }, delay: nextUpdateCheckDelay });", sandbox);
  return {
    els, timers, fetches, ret, sandbox,
    reloads: () => reloads,
    tick: () => now,
    advance: ms => { now += ms; },
    respond: r => responses.push(r),
    ok: build => ({ ok: true, status: 200, json: () => Promise.resolve({ build }) }),
    card: () => doc.getElementById("updateNotice"),
    visible: () => !doc.getElementById("updateNotice").classList.contains("hidden"),
    fireDoc: t => (docListeners[t] || []).forEach(fn => fn()),
    fireWin: t => (winListeners[t] || []).forEach(fn => fn()),
    runTimer: () => { const t = timers.shift(); if (t) t.fn(); return t; }
  };
}

(async function () {
  /* 4a. same build → silence */
  let w = boot();
  assert(w.timers.length === 1 && w.timers[0].ms === 45000, "the first look is scheduled 45 s after load, not on load");
  let t = w.runTimer();
  await new Promise(r => setImmediate(r));
  assert(w.fetches.length === 1 && /^\/version\.json\?_=\d+$/.test(w.fetches[0].url), "it asks /version.json with a cache-busting query (" + w.fetches[0].url + ")");
  assert(w.fetches[0].init.cache === "no-store" && w.fetches[0].init.credentials === "same-origin", "the request is no-store and same-origin");
  assert(!w.visible(), "same build id → the notice stays hidden");
  assert(w.timers.length === 1 && w.timers[0].ms === 60000, "then it looks again once a minute");

  /* 4b. new build → notice; REFRESH reloads */
  w.respond(w.ok("bbbbbbbbbbbb"));
  w.runTimer();
  await new Promise(r => setImmediate(r));
  assert(w.visible(), "a different build id shows the notice");
  assert(w.reloads() === 0, "nothing reloaded on its own");
  w.els.updateNoticeRefresh.fire("click");
  assert(w.reloads() === 1, "REFRESH reloads the page");

  /* 4c. × dismisses for that build only */
  w = boot();
  w.respond(w.ok("bbbbbbbbbbbb")); w.runTimer(); await new Promise(r => setImmediate(r));
  assert(w.visible(), "notice shown for build b");
  w.els.updateNoticeClose.fire("click");
  assert(!w.visible(), "× hides it");
  w.respond(w.ok("bbbbbbbbbbbb")); w.runTimer(); await new Promise(r => setImmediate(r));
  assert(!w.visible(), "build b again → still dismissed, no nagging");
  w.respond(w.ok("cccccccccccc")); w.runTimer(); await new Promise(r => setImmediate(r));
  assert(w.visible(), "a newer build c shows the notice again");
  w.respond(w.ok("aaaaaaaaaaaa")); w.runTimer(); await new Promise(r => setImmediate(r));
  assert(!w.visible(), "a rollback to the build this tab runs hides it again");

  /* 4d. failures: silence and back-off */
  w = boot();
  w.respond(new Error("offline")); w.runTimer(); await new Promise(r => setImmediate(r));
  assert(!w.visible() && w.ret.failures() === 1, "a failed fetch shows nothing and counts one failure");
  assert(w.timers[0].ms === 120000, "the next look backs off to 2 min");
  w.respond({ ok: false, status: 404, json: () => Promise.resolve({ build: "zzzzzzzzzzzz" }) }); w.runTimer(); await new Promise(r => setImmediate(r));
  assert(!w.visible() && w.ret.failures() === 2, "a 404 is a failure too, whatever the body says");
  w.respond({ ok: true, status: 200, json: () => Promise.reject(new Error("bad json")) }); w.runTimer(); await new Promise(r => setImmediate(r));
  assert(!w.visible() && w.ret.failures() === 3 && w.timers[0].ms === 480000, "bad JSON is a failure; back-off keeps growing (8 min)");
  w.respond(w.ok("")); w.runTimer(); await new Promise(r => setImmediate(r));
  assert(!w.visible() && w.ret.failures() === 0, "an empty build id shows nothing but resets the failure count");
  for (let i = 0; i < 6; i++) { w.respond(new Error("down")); w.runTimer(); await new Promise(r => setImmediate(r)); }
  assert(w.timers[0].ms === 600000, "back-off is capped at 10 minutes");

  /* 4e. focus / visibility / online look, but never more than once per 15 s */
  w = boot();
  w.fireWin("focus"); await new Promise(r => setImmediate(r));
  assert(w.fetches.length === 1, "focus triggers a look");
  w.advance(5000); w.fireDoc("visibilitychange"); w.fireWin("online"); await new Promise(r => setImmediate(r));
  assert(w.fetches.length === 1, "two more events 5 s later are folded into the same look");
  w.advance(16000); w.sandbox.document.visibilityState = "visible"; w.fireDoc("visibilitychange"); await new Promise(r => setImmediate(r));
  assert(w.fetches.length === 2, "after 15 s a visibility change looks again");
  w.sandbox.document.visibilityState = "hidden";
  const before = w.fetches.length;
  w.runTimer(); await new Promise(r => setImmediate(r));
  assert(w.fetches.length === before && w.timers.length === 1, "a hidden tab skips the timed look and simply re-arms");

  /* 4f. disabled: file://, no stamp, placeholder, no fetch */
  for (const [label, opts] of [["file://", { protocol: "file:" }], ["no stamp", { stamp: "" }], ["unfilled placeholder", { stamp: "__SPICY_BUILD" + "_ID__" }], ["no fetch API", { noFetch: true }]]) {
    const q = boot(opts);
    const started = q.ret.init();
    if (label === "no fetch API") {
      const r = await q.ret.check("focus");
      assert(r === false && q.fetches.length === 0, label + ": a check is a quiet no-op");
    } else {
      assert(started === false && q.fetches.length === 0, label + ": the feature stays off, nothing is fetched");
    }
  }

  /* ---------- 5. README ---------- */
  section("5. the README says what the notice does");
  assert(/NEW VERSION LIVE/.test(README) && /version\.json/.test(README), "README documents the refresh notice and /version.json");

  console.log("\n=== SUMMARY: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed ? 1 : 0);
})();
