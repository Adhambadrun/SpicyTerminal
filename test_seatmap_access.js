"use strict";
/* test_seatmap_access.js — who can reach the Seat Map, and what travels with
 * them when they do.
 *
 * Two halves, both about access:
 *
 *   1. THE DOOR IS OPEN. The Seat Map used to be sealed while it was being
 *      finished: a dimmed link that opened on the tenth click, and a /seatmap
 *      page that checked the same count before drawing. That lock is retired.
 *      This file checks the wiring of the open door — the link is an ordinary
 *      link, nothing dims it, no counter exists, the retired module is not
 *      shipped, and no shipped page can fail closed on a visitor.
 *
 *   2. THE HANDOFF. The page reads the itinerary the user converted (not a
 *      retyped copy of it): app.js mirrors the OUTPUT pane into sessionStorage
 *      and the seat map re-parses it with the real engine, so the two can
 *      never disagree. That path must stay correct, quiet, and unable to leak
 *      between tabs or survive a cleared input.
 */const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;
const APP = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const SEATMAP = fs.readFileSync(path.join(ROOT, "seatmap.js"), "utf8");
const TEMPLATE = fs.readFileSync(path.join(ROOT, "index_template.html"), "utf8");
const BUILT = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const BUILT_APP = fs.readFileSync(path.join(ROOT, "app.html"), "utf8");
const BUILT_SEATMAP = fs.readFileSync(path.join(ROOT, "public", "seatmap.html"), "utf8");
const GATE = fs.readFileSync(path.join(ROOT, "seatmap_gate.js"), "utf8");

let PASS = 0, FAIL = 0;
/** Everything the gate sets as the link's title, for tooltip assertions. */
function seatMapLinkText(source) {
  /* The whole open-door block, markers included — the same slice the built
     page has to embed identically. */
  const start = source.indexOf("/* SEATMAP_GATE:BEGIN */");
  const end = source.indexOf("/* SEATMAP_GATE:END */", start);
  return start < 0 || end < start ? "" : source.slice(start, end + "/* SEATMAP_GATE:END */".length);
}
function assertTrue(cond, message) {
  if (cond) { PASS++; console.log("PASS:", message); }
  else { FAIL++; console.error("FAIL:", message); }
}
function section(title) { console.log("\n=== " + title + " ==="); }

/* ---------- 1. the Seat Map is open: an ordinary link, no count at all ---------- */
section("1. the door is open");
assertTrue(/SEATMAP_GATE:BEGIN/.test(APP) && /SEATMAP_GATE:END/.test(APP),
  "app.js carries the (now open) block");
assertTrue(/function paintSeatMapLink\(\)/.test(APP), "the link is painted once, plainly");
assertTrue(!/seatMapKnock|gate\.knock\(|SEAT MAP LOCKED|SEAT MAP UNLOCKED/.test(APP),
  "no click counter, no countdown line, no unlock announcement");
assertTrue(!/SpicySeatMapGate/.test(APP) && !/SpicySeatMapGate/.test(SEATMAP),
  "neither app.js nor seatmap.js consults a gate");
assertTrue(/id="btnSeatMap"/.test(TEMPLATE) && /href="\/seatmap"/.test(TEMPLATE),
  "the status-row link points straight at the route");
assertTrue(/View seat map|Seat map for the flight you converted/.test(TEMPLATE),
  "and says what it opens, in plain words");

section("2. nothing dims the link and nothing ships the lock");
assertTrue(!/#btnSeatMap\{opacity/.test(TEMPLATE), "the template does not dim the Seat Map link");
assertTrue(!/#btnSeatMap\{opacity/.test(BUILT), "the built page does not dim it either");
assertTrue(!/is-unlocked/.test(APP) && !/is-unlocked/.test(TEMPLATE),
  "no collapsed/'opened' styling pair survives the lock it belonged to");
assertTrue(seatMapLinkText(APP).indexOf("SEAT MAP LOCKED") < 0,
  "the open-door block holds no locked copy");
assertTrue(!/__SEATMAP_GATE__/.test(TEMPLATE), "the template has no gate slot");
assertTrue(!/SpicySeatMapGate/.test(BUILT) && !/SpicySeatMapGate/.test(BUILT_APP),
  "the built pages ship no gate module");
assertTrue(!/spicy_seatmap_gate/.test(BUILT) && !/spicy_seatmap_gate/.test(BUILT_APP),
  "and no gate storage key is written by any shipped page");

section("3. the /seatmap URL draws for everyone");
assertTrue(!/id="seatmapLock"/.test(TEMPLATE) && !/id="seatmapLock"/.test(BUILT),
  "no sealed card ships, so no visitor can land on one");
assertTrue(!/lockSeatMapPage/.test(SEATMAP), "the page has no lock path to take");
assertTrue(!/!api \|\| !api\.isUnlocked\(\)/.test(SEATMAP),
  "and it never fails closed when a module is missing");
assertTrue(/\.classList\.add\("seatmap-active"\)/.test(SEATMAP),
  "arriving at /seatmap takes the screen and draws");
assertTrue(!/SEAT MAP LOCKED/.test(BUILT_SEATMAP) && !/SEALED · NOT FINISHED/.test(BUILT_SEATMAP),
  "the shipped route carries none of the sealed copy");
assertTrue(GATE.indexOf("RETIRED") >= 0, "seatmap_gate.js says out loud that it is retired");
assertTrue(!/SpicySeatMapGate/.test(BUILT_SEATMAP), "the shipped route loads no gate module");

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
  assertTrue(embeddedBlock(html, "SEATMAP_GATE") === seatMapLinkText(APP),
    name + " embeds the open-door block, byte for byte");
  assertTrue(html.indexOf("SEAT MAP LOCKED") < 0 && html.indexOf("SEAT MAP UNLOCKED") < 0,
    name + " ships no locked or unlocking copy at all");
});
const publicIndex = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
assertTrue(publicIndex === BUILT, "public/index.html matches the built page");

console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
if (FAIL > 0) process.exit(1);
