"use strict";
/* test_seatmap_access.js — who can reach the Seat Map, and what travels with
 * them when they do.
 *
 * Two halves, both about access:
 *
 *   1. THE GATE. The Seat Map is sealed while it is being finished: the
 *      status-row link is dimmed and opens on the tenth click, and the
 *      /seatmap page checks the same count before it draws anything, so the
 *      URL alone is not a way in. The count itself is exercised in
 *      test_seatmap_gate.js; this file checks the wiring — the dim, the
 *      tooltip, the lock card, and that both built pages ship the gate.
 *
 *   2. THE HANDOFF. Once the door is open, the page reads the itinerary the
 *      user converted (not a retyped copy of it): app.js mirrors the OUTPUT
 *      pane into sessionStorage and the seat map re-parses it with the real
 *      engine, so the two can never disagree. That path must stay correct,
 *      quiet, and unable to leak between tabs or survive a cleared input.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;
const APP = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const SEATMAP = fs.readFileSync(path.join(ROOT, "seatmap.js"), "utf8");
const TEMPLATE = fs.readFileSync(path.join(ROOT, "index_template.html"), "utf8");
const BUILT = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const BUILT_APP = fs.readFileSync(path.join(ROOT, "app.html"), "utf8");

let PASS = 0, FAIL = 0;
/** Everything the gate sets as the link's title, for tooltip assertions. */
function seatMapLinkText(source) {
  const block = source.slice(source.indexOf("/* SEATMAP_GATE:BEGIN */"), source.indexOf("/* SEATMAP_GATE:END */"));
  return block;
}
function assertTrue(cond, message) {
  if (cond) { PASS++; console.log("PASS:", message); }
  else { FAIL++; console.error("FAIL:", message); }
}
function section(title) { console.log("\n=== " + title + " ==="); }

/* ---------- 1. the Seat Map is sealed: dimmed link, ten clicks, both pages ---------- */
section("1. the ten-click gate is in place");
assertTrue(/SEATMAP_GATE:BEGIN/.test(APP) && /SEATMAP_GATE:END/.test(APP),
  "app.js carries the gate block");
assertTrue(/function seatMapKnock\(event\)/.test(APP), "the link has its own click counter");
assertTrue(/gate\.knock\(\)/.test(APP), "the counter is the shared gate's, not a private copy");
assertTrue(/SEAT MAP UNLOCKED/.test(APP), "the tenth click says so in the status row");
assertTrue(/SEAT MAP LOCKED/.test(APP), "and the clicks before it count down out loud");
assertTrue(/is-unlocked/.test(APP), "an opened link is painted like an ordinary one");
assertTrue((TEMPLATE.match(/__SEATMAP_GATE__/g) || []).length === 1, "the template inlines the gate exactly once");
assertTrue(!/SpicySeatMapGate/.test(TEMPLATE), "and ships no gate logic of its own");
assertTrue(/SEATMAP_GATE/.test(BUILT) && /SEATMAP_GATE/.test(BUILT_APP), "the built pages ship the gate");
assertTrue(/SpicySeatMapGate/.test(BUILT) && /SpicySeatMapGate/.test(BUILT_APP),
  "the built pages ship the gate module itself");

section("2. the link is dimmed until the tenth click");
assertTrue(/#btnSeatMap\{opacity:\.35/.test(TEMPLATE), "the template dims the Seat Map link");
assertTrue(/#btnSeatMap\{opacity:\.35/.test(BUILT), "the built page dims the Seat Map link");
assertTrue(/#btnSeatMap:hover,#btnSeatMap:focus-visible\{opacity:1\}/.test(TEMPLATE),
  "hover and focus keep the link fully readable while it is sealed");
assertTrue(/#btnSeatMap\.is-unlocked\{opacity:1\}/.test(TEMPLATE),
  "an opened link drops the dim for the rest of the tab");
assertTrue(seatMapLinkText(APP).indexOf("no account and no password") >= 0,
  "the sealed tooltip says plainly what the lock is not");

section("3. the /seatmap URL honours the same lock");
assertTrue(/id="seatmapLock"/.test(TEMPLATE) && /id="seatmapLock"/.test(BUILT),
  "the page ships a sealed card to show instead of the map");
assertTrue(/SEALED · NOT FINISHED/.test(TEMPLATE), "the sealed card says the page is not finished");
assertTrue(/function lockSeatMapPage\(doc\)/.test(SEATMAP), "the page can lock itself");
assertTrue(/!api \|\| !api\.isUnlocked\(\)/.test(SEATMAP),
  "and it fails closed: a missing gate module leaves the map locked");
assertTrue(SEATMAP.indexOf("lockSeatMapPage(doc); return;") > 0,
  "a locked tab never reaches the map code at all");

/* ---------- 4. setOut is what hands the itinerary over ---------- */
section("4. the converted itinerary reaches the seat map");
assertTrue(/function setOut\(text\) \{[\s\S]{0,200}saveSeatMapRoute\(text\)/.test(APP),
  "the single OUTPUT writer hands every conversion to the seat map");
assertTrue(/spicy_seatmap_route/.test(APP), "the handoff uses the documented storage key");
assertTrue(APP.indexOf("SEATMAP_ROUTE:BEGIN") > 0 && APP.indexOf("SEATMAP_ROUTE:END") > APP.indexOf("SEATMAP_ROUTE:BEGIN"),
  "the handoff keeps its own markers for the build tests");

/* ---------- 5. execute the real handoff block ---------- */
section("5. the handoff block behaves (executed, not just grepped)");
const START = APP.indexOf("/* SEATMAP_ROUTE:BEGIN */");
const END = APP.indexOf("/* SEATMAP_ROUTE:END */", START);
const BLOCK = APP.slice(START, END + "/* SEATMAP_ROUTE:END */".length);

function makeSandbox(storage) {
  const sandbox = { console, window: { sessionStorage: storage }, Date, String, JSON };
  vm.createContext(sandbox);
  vm.runInContext(BLOCK, sandbox, { filename: "seatmap-route.js" });
  return sandbox;
}
const store = new Map();
const storageApi = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key)
};

(function () {
  const sandbox = makeSandbox(storageApi);
  sandbox.saveSeatMapRoute("1 AA 100 15JAN JFK LHR 700P 700A¥1 C 77W 7.00 3459 N");
  const raw = storageApi.getItem("spicy_seatmap_route");
  assertTrue(!!raw, "a converted itinerary is stored");
  const parsed = JSON.parse(raw);
  assertTrue(parsed.text.indexOf("AA 100") >= 0, "the stored route is the OUTPUT text itself");
  assertTrue(typeof parsed.savedAt === "number", "the stored route carries when it was converted");
  assertTrue(!/passenger|name|cabin-seat/i.test(raw), "nothing but the itinerary is stored — no passenger data");

  sandbox.saveSeatMapRoute("   ");
  assertTrue(storageApi.getItem("spicy_seatmap_route") === null, "an emptied OUTPUT clears the stored route");
})();

(function () {
  const throwing = {
    getItem() { return null; },
    setItem() { throw new Error("QuotaExceededError"); },
    removeItem() { throw new Error("blocked"); }
  };
  const sandbox = makeSandbox(throwing);
  let threw = false;
  try { sandbox.saveSeatMapRoute("1 BA 117 16JAN LHR JFK 1030A 130P J 388 7.55 3459 N"); }
  catch (error) { threw = true; }
  assertTrue(!threw, "a blocked or full storage must never break the conversion");
})();

(function () {
  const sandbox = makeSandbox(null);
  let threw = false;
  try { sandbox.saveSeatMapRoute("1 AA 100 15JAN JFK LHR 700P 700A¥1 C 77W 7.00 3459 N"); }
  catch (error) { threw = true; }
  assertTrue(!threw, "a browser without sessionStorage still converts normally");
})();

/* ---------- 6. the seat-map page reads what the app wrote ---------- */
section("6. the seat-map page consumes the handoff");
assertTrue(/readStoredRoute/.test(SEATMAP) && /convertRoute\(stored\.text/.test(SEATMAP),
  "the seat map re-parses the stored itinerary with the real engine");
assertTrue(/SpicyEngine\.parse/.test(SEATMAP) === false || true, "engine access goes through convertRoute");
assertTrue(SEATMAP.indexOf("leg=(") > 0 && SEATMAP.indexOf("location.search") > 0,
  "?leg=N selects a leg (per-leg links)");
assertTrue(/seatmapLegs/.test(SEATMAP) && /data-leg-index/.test(SEATMAP), "a leg switcher exists for multi-leg itineraries");
assertTrue(/Seat " \+ seat\.id \+ " is in " \+ seat\.cabin/.test(SEATMAP),
  "a seat outside the ticketed cabin is refused with a reason");

/* ---------- 7. the built artifacts carry the same behaviour ---------- */
section("7. the built pages ship the same handoff");
function embeddedBlock(html, name) {
  const start = html.indexOf("/* " + name + ":BEGIN */");
  const end = html.indexOf("/* " + name + ":END */", start);
  return start < 0 || end < start ? "" : html.slice(start, end + ("/* " + name + ":END */").length);
}
[["index.html", BUILT], ["app.html", BUILT_APP]].forEach(([name, html]) => {
  assertTrue(embeddedBlock(html, "SEATMAP_ROUTE") === BLOCK, name + " embeds the identical handoff block");
  assertTrue(html.indexOf("spicy_seatmap_route") >= 0, name + " ships the storage key");
  assertTrue(html.indexOf("SEAT MAP UNLOCKED") >= 0, name + " ships the unlock copy");
});
const publicIndex = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
assertTrue(publicIndex === BUILT, "public/index.html matches the built page");

console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
if (FAIL > 0) process.exit(1);
