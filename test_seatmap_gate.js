"use strict";
/* test_seatmap_gate.js — the retired ten-click lock: still a working counter,
 * and provably not wired into anything a visitor loads.
 *
 * THE DOOR IS OPEN. seatmap_gate.js used to seal the Seat Map: a dimmed link,
 * ten clicks to open it, and a /seatmap page that refused to draw until the
 * same count was heard. That is over. This file now checks two separate
 * things:
 *
 *   1. THE MODULE STILL WORKS, so a private door can be re-hung later. A
 *      fresh tab is sealed, nine clicks do not open it, the tenth does, a
 *      new tab starts over, damaged storage locks rather than opens, and the
 *      payload carries a count and nothing else. Every one of those runs
 *      against the real module, not against a copy of it.
 *
 *   2. NOTHING SHIPS IT. No CLICKS_REQUIRED, no knockout handler, no dimmed
 *      link, no sealed card, no gate module in the built pages, and no code
 *      path that can fail closed on a visitor. The map draws for everyone.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const GATE_PATH = path.join(ROOT, "seatmap_gate.js");
const GATE_JS = fs.readFileSync(GATE_PATH, "utf8");
const APP = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const TEMPLATE = fs.readFileSync(path.join(ROOT, "index_template.html"), "utf8");
const BUILT = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const BUILT_APP = fs.readFileSync(path.join(ROOT, "app.html"), "utf8");
const BUILT_SEATMAP = fs.readFileSync(path.join(ROOT, "public", "seatmap.html"), "utf8");
const SEATMAP = fs.readFileSync(path.join(ROOT, "seatmap.js"), "utf8");

let PASS = 0, FAIL = 0;
function assertTrue(cond, message) {
  if (cond) { PASS++; console.log("PASS:", message); }
  else { FAIL++; console.error("FAIL:", message); }
}
function section(title) { console.log("\n=== " + title + " ==="); }

/** A sessionStorage stand-in backed by a Map. */
function makeStorage(seed) {
  const store = new Map(Object.entries(seed || {}));
  return {
    data: store,
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };
}

/** Load the gate module fresh, the way a fresh page load would. */
function loadGate(storage) {
  delete require.cache[require.resolve(GATE_PATH)];
  if (storage === undefined) global.window = undefined;          // no window at all
  else if (storage === null) global.window = {};                 // window, no sessionStorage
  else global.window = { sessionStorage: storage };
  return require(GATE_PATH);
}

function knockTimes(gate, times) {
  let last = null;
  for (let i = 0; i < times; i++) last = gate.knock();
  return last;
}

/* ---------- 1. a sealed tab ---------- */
section("1. a fresh tab is sealed");
{
  const storage = makeStorage();
  const gate = loadGate(storage);
  assertTrue(gate.CLICKS_REQUIRED === 10, "the gate asks for ten clicks");
  assertTrue(gate.STORE_KEY === "spicy_seatmap_gate", "the flag is stored under the documented key");
  assertTrue(gate.isUnlocked() === false, "a fresh tab is locked");
  assertTrue(gate.clicksLeft() === 10, "and owes all ten clicks");
}

/* ---------- 2. nine is not ten ---------- */
section("2. nine clicks do not open it");
{
  const storage = makeStorage();
  const gate = loadGate(storage);
  const ninth = knockTimes(gate, 9);
  assertTrue(ninth.unlocked === false, "nine clicks leave it locked");
  assertTrue(ninth.remaining === 1, "the tenth is still owed");
  assertTrue(ninth.clicks === 9, "the count is nine");
  assertTrue(gate.isUnlocked() === false, "asking again still says locked");
  assertTrue(gate.clicksLeft() === 1, "and one click is left");

  const tenth = gate.knock();
  assertTrue(tenth.unlocked === true, "the tenth click opens it");
  assertTrue(tenth.remaining === 0, "nothing is owed once it is open");
  assertTrue(gate.isUnlocked() === true, "it stays open");
}

/* ---------- 3. an open tab stays open ---------- */
section("3. the unlock survives a reload in the same tab");
{
  const storage = makeStorage();
  knockTimes(loadGate(storage), 10);
  const reloaded = loadGate(storage);           // F5: same sessionStorage, new module
  assertTrue(reloaded.isUnlocked() === true, "a reload does not re-lock the tab");
  const extra = reloaded.knock();
  assertTrue(extra.unlocked === true && extra.remaining === 0, "a further click is a no-op, not a reset");
  assertTrue(reloaded.clicksLeft() === 0, "nothing is owed after the unlock");
}

/* ---------- 4. a new tab starts over ---------- */
section("4. a new tab starts over");
{
  const opened = makeStorage();
  knockTimes(loadGate(opened), 10);
  const freshTab = loadGate(makeStorage());     // new tab: its own sessionStorage
  assertTrue(freshTab.isUnlocked() === false, "the next tab is sealed again");
  assertTrue(freshTab.clicksLeft() === 10, "and owes all ten");
  assertTrue(loadGate(opened).isUnlocked() === true, "while the first tab is still open");
}

/* ---------- 5. re-sealing ---------- */
section("5. it can be sealed again");
{
  const storage = makeStorage();
  const gate = loadGate(storage);
  knockTimes(gate, 10);
  gate.lock();
  assertTrue(gate.isUnlocked() === false, "lock() re-seals it");
  assertTrue(gate.clicksLeft() === 10, "and resets the count");
  assertTrue(loadGate(storage).isUnlocked() === false, "the re-seal is stored too");
}

/* ---------- 6. storage that will not hold still ---------- */
section("6. blocked, full or absent storage still behaves");
{
  const throwing = {
    getItem() { return null; },
    setItem() { throw new Error("QuotaExceededError"); },
    removeItem() { throw new Error("blocked"); }
  };
  const gate = loadGate(throwing);
  let threw = false;
  try { knockTimes(gate, 10); } catch (error) { threw = true; }
  assertTrue(!threw, "a full or blocked sessionStorage never throws at the link");
  assertTrue(gate.isUnlocked() === true, "and the ten clicks still count, in memory");
}
{
  const gate = loadGate(null);                 // window without sessionStorage
  let threw = false;
  try { knockTimes(gate, 9); } catch (error) { threw = true; }
  assertTrue(!threw, "a browser with no sessionStorage does not throw");
  assertTrue(gate.isUnlocked() === false, "and it is not quietly unlocked either");
  assertTrue(gate.knock().unlocked === true, "the tenth click still opens it");
}
{
  const gate = loadGate(undefined);            // not a browser at all
  let threw = false;
  try { knockTimes(gate, 10); } catch (error) { threw = true; }
  assertTrue(!threw, "the gate is safe to execute outside a browser");
  assertTrue(gate.isUnlocked() === true, "and keeps counting in memory");
}

/* ---------- 7. a damaged flag locks, never unlocks ---------- */
section("7. a damaged stored flag locks");
["{not json", "yes", "", "null", "[]", '{"unlocked":"true"}', '{"clicks":true,"unlocked":true}'].forEach(raw => {
  const storage = makeStorage({ spicy_seatmap_gate: raw });
  const gate = loadGate(storage);
  assertTrue(gate.isUnlocked() === false, "a flag that does not parse (" + JSON.stringify(raw) + ") stays locked");
});
{
  const storage = makeStorage({ spicy_seatmap_gate: JSON.stringify({ clicks: 3, unlocked: false }) });
  const gate = loadGate(storage);
  assertTrue(gate.clicksLeft() === 7, "a stored half-count is honoured");
  assertTrue(knockTimes(gate, 7).unlocked === true, "and finishes from there");
}

/* ---------- 8. the payload is a count and nothing else ---------- */
section("8. the stored payload carries a count and nothing else");
{
  const storage = makeStorage();
  knockTimes(loadGate(storage), 4);
  const raw = storage.getItem("spicy_seatmap_gate");
  const parsed = JSON.parse(raw);
  assertTrue(Object.keys(parsed).sort().join(",") === "clicks,unlocked", "only clicks and unlocked are stored");
  assertTrue(parsed.clicks === 4 && parsed.unlocked === false, "the stored state is the real one");
  assertTrue(!/passenger|name|seat|flight|@/i.test(raw), "no itinerary, passenger or seat data is written");
}

/* ---------- 9. the retired gate asks nothing of the network ---------- */
section("9. the module is self-contained: no network, no key, no cookie");
assertTrue(!/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/.test(GATE_JS), "the gate makes no network request");
assertTrue(!/api[_-]?key|secret|token/i.test(GATE_JS), "and holds no credential-shaped string");
assertTrue(!/localStorage|document\.cookie/.test(GATE_JS), "the flag is per-tab: no localStorage, no cookie");
assertTrue(/CLICKS_REQUIRED = 10/.test(GATE_JS), "the requirement is written in the source, not inferred");

/* ---------- 10. the door is open: nothing ships the lock ---------- */
section("10. nothing shipped can re-seal the Seat Map");
[["app.js", APP], ["seatmap.js", SEATMAP], ["index_template.html", TEMPLATE],
 ["index.html", BUILT], ["app.html", BUILT_APP], ["public/seatmap.html", BUILT_SEATMAP]].forEach(pair => {
  assertTrue(pair[1].indexOf("SEAT MAP LOCKED") < 0, pair[0] + " never says SEAT MAP LOCKED");
  assertTrue(pair[1].indexOf('id="seatmapLock"') < 0, pair[0] + " ships no sealed card");
});
assertTrue(!/SpicySeatMapGate/.test(TEMPLATE), "the template ships no gate logic");
assertTrue(TEMPLATE.indexOf("__SEATMAP_GATE__") < 0, "and has no gate slot left to fill");
assertTrue(!/SpicySeatMapGate/.test(APP), "app.js never calls the gate");
assertTrue(!/SpicySeatMapGate/.test(SEATMAP), "seatmap.js never calls the gate");
assertTrue(!/SpicySeatMapGate/.test(BUILT) && !/SpicySeatMapGate/.test(BUILT_APP),
  "the built pages do not carry the gate module at all");
assertTrue(BUILT.indexOf("spicy_seatmap_gate") < 0 && BUILT_APP.indexOf("spicy_seatmap_gate") < 0,
  "nor the gate's storage key");
assertTrue(!/lockSeatMapPage/.test(SEATMAP), "the page has no lock card to paint");
assertTrue(/SEATMAP_GATE:BEGIN/.test(APP) && /SEATMAP_GATE:END/.test(APP),
  "app.js keeps the block's markers, so the two call sites stay findable");
assertTrue(!/gate\.knock\(|seatMapKnock/.test(APP), "and the block holds no counter");
assertTrue(!/#btnSeatMap\{opacity/.test(TEMPLATE) && !/#btnSeatMap\{opacity/.test(BUILT),
  "the Seat Map link is never dimmed");
assertTrue(/paintSeatMapLink\(\)/.test(APP), "app.js paints the link once, plainly");
assertTrue(/function paintSeatMapLink\(\)/.test(APP), "and the paint is a plain ordinary-link paint");

console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
if (FAIL > 0) process.exit(1);
