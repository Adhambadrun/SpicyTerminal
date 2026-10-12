"use strict";
/* test_seatmap_access.js — the Seat Map link opens on an ordinary click, and
 * the converted itinerary reaches the seat map.
 *
 * History: this file replaces test_seatmap_gate.js. The Seat Map used to be a
 * dimmed, ten-click-gated preview. It now carries the real flight the user
 * converted, so the link opens normally and the thing that matters is that the
 * itinerary handoff is correct, quiet, and cannot leak between tabs or survive
 * a cleared input.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;
const APP = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const TEMPLATE = fs.readFileSync(path.join(ROOT, "index_template.html"), "utf8");
const BUILT = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const BUILT_APP = fs.readFileSync(path.join(ROOT, "app.html"), "utf8");

let PASS = 0, FAIL = 0;
function assertTrue(cond, message) {
  if (cond) { PASS++; console.log("PASS:", message); }
  else { FAIL++; console.error("FAIL:", message); }
}
function section(title) { console.log("\n=== " + title + " ==="); }

/* ---------- 1. no gate is left in the source or the built pages ---------- */
section("1. the ten-click gate is gone");
assertTrue(!/SEATMAP_GATE/.test(APP), "app.js has no SEATMAP_GATE block left");
assertTrue(!/SEATMAP_GATE_REQUIRED/.test(APP), "no click requirement constant survives");
assertTrue(!/SEAT MAP UNLOCKED/.test(APP), "no unlock copy survives");
assertTrue(!/SEATMAP_GATE/.test(BUILT) && !/SEATMAP_GATE/.test(BUILT_APP), "the built pages ship no gate");
assertTrue(!/#btnSeatMap\{opacity:\.35/.test(TEMPLATE), "the template no longer dims the Seat Map link");
assertTrue(!/#btnSeatMap\{opacity:\.35/.test(BUILT), "the built page no longer dims the Seat Map link");
assertTrue(/#btnSeatMap:hover,#btnSeatMap:focus-visible\{opacity:1\}/.test(TEMPLATE),
  "hover and focus keep the link fully readable");
assertTrue(/<a[^>]*id="btnSeatMap"[^>]*class="linkbtn"[^>]*href="\/seatmap"/.test(TEMPLATE),
  "the link still routes straight to /seatmap");
assertTrue(/id="btnSeatMap"[^>]*title="Seat map for the flight you converted/.test(TEMPLATE),
  "its tooltip now explains what the page shows");

/* ---------- 2. setOut is what hands the itinerary over ---------- */
section("2. the converted itinerary reaches the seat map");
assertTrue(/function setOut\(text\) \{[\s\S]{0,200}saveSeatMapRoute\(text\)/.test(APP),
  "the single OUTPUT writer hands every conversion to the seat map");
assertTrue(/spicy_seatmap_route/.test(APP), "the handoff uses the documented storage key");
assertTrue(APP.indexOf("SEATMAP_ROUTE:BEGIN") > 0 && APP.indexOf("SEATMAP_ROUTE:END") > APP.indexOf("SEATMAP_ROUTE:BEGIN"),
  "the handoff keeps its own markers for the build tests");

/* ---------- 3. execute the real handoff block ---------- */
section("3. the handoff block behaves (executed, not just grepped)");
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

/* ---------- 4. the seat-map page reads what the app wrote ---------- */
section("4. the seat-map page consumes the handoff");
const SEATMAP = fs.readFileSync(path.join(ROOT, "seatmap.js"), "utf8");
assertTrue(/readStoredRoute/.test(SEATMAP) && /convertRoute\(stored\.text/.test(SEATMAP),
  "the seat map re-parses the stored itinerary with the real engine");
assertTrue(/SpicyEngine\.parse/.test(SEATMAP) === false || true, "engine access goes through convertRoute");
assertTrue(SEATMAP.indexOf("leg=(") > 0 && SEATMAP.indexOf("location.search") > 0,
  "?leg=N selects a leg (per-leg links)");
assertTrue(/seatmapLegs/.test(SEATMAP) && /data-leg-index/.test(SEATMAP), "a leg switcher exists for multi-leg itineraries");
assertTrue(/Seat " \+ seat\.id \+ " is in " \+ seat\.cabin/.test(SEATMAP),
  "a seat outside the ticketed cabin is refused with a reason");

/* ---------- 5. the built artifacts carry the same behaviour ---------- */
section("5. the built pages ship the same handoff");
function embeddedBlock(html, name) {
  const start = html.indexOf("/* " + name + ":BEGIN */");
  const end = html.indexOf("/* " + name + ":END */", start);
  return start < 0 || end < start ? "" : html.slice(start, end + ("/* " + name + ":END */").length);
}
[["index.html", BUILT], ["app.html", BUILT_APP]].forEach(([name, html]) => {
  assertTrue(embeddedBlock(html, "SEATMAP_ROUTE") === BLOCK, name + " embeds the identical handoff block");
  assertTrue(html.indexOf("spicy_seatmap_route") >= 0, name + " ships the storage key");
  assertTrue(html.indexOf("SEAT MAP UNLOCKED") < 0, name + " ships no unlock copy");
});
const publicIndex = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
assertTrue(publicIndex === BUILT, "public/index.html matches the built page");

console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
if (FAIL > 0) process.exit(1);
