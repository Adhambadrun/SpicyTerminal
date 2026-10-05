"use strict";
/* test_seatmap_gate.js — the Seat Map button stays dimmed and only opens the
 * preview after ten consecutive clicks. The tests execute the real
 * SEATMAP_GATE block from app.js and check the template/built artifacts keep
 * the button dimmed, in place, and still pointing at /seatmap.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;
const APP = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const TEMPLATE = fs.readFileSync(path.join(ROOT, "index_template.html"), "utf8");
const BUILT = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const BUILT_APP = fs.readFileSync(path.join(ROOT, "app.html"), "utf8");

const START = APP.indexOf("/* SEATMAP_GATE:BEGIN */");
const END = APP.indexOf("/* SEATMAP_GATE:END */");
if (START < 0 || END < START) throw new Error("SEATMAP_GATE block markers are missing from app.js");
const GATE_SRC = APP.slice(START, END + "/* SEATMAP_GATE:END */".length);

function embeddedGateBlock(html) {
  const start = html.indexOf("/* SEATMAP_GATE:BEGIN */");
  const end = html.indexOf("/* SEATMAP_GATE:END */", start);
  return start < 0 || end < start ? "" : html.slice(start, end + "/* SEATMAP_GATE:END */".length);
}

let PASS = 0, FAIL = 0;
function assert(cond, message) {
  if (cond) { PASS++; console.log("PASS:", message); }
  else { FAIL++; console.error("FAIL:", message); }
}
function section(title) { console.log("\n=== " + title + " ==="); }

function makeGate() {
  const statuses = [];
  const prevented = [];
  const listeners = {};
  const button = {
    id: "btnSeatMap",
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
  };
  const sandbox = {
    console,
    setStatus(msg, warn) { statuses.push({ msg: String(msg), warn: !!warn }); },
    $(id) { return id === "btnSeatMap" ? button : null; }
  };
  vm.createContext(sandbox);
  vm.runInContext(GATE_SRC, sandbox, { filename: "seatmap-gate.js" });
  function click(now) {
    const event = { preventDefault() { prevented.push(now); } };
    const unlocked = vm.runInContext("seatmapGate(__event, __now)", Object.assign(sandbox, { __event: event, __now: now }));
    return { unlocked, event };
  }
  return { statuses, prevented, listeners, button, click };
}

section("ten consecutive clicks open the seat map");
(function () {
  const gate = makeGate();
  assert((gate.listeners.click || []).length === 1, "the gate wires exactly one click handler onto #btnSeatMap");
  let unlockedAt = -1;
  for (let i = 1; i <= 10; i++) {
    const { unlocked } = gate.click(1000 + (i - 1) * 120); // comfortably inside the 1.5s gap
    if (unlocked) unlockedAt = i;
    assert(!unlocked || i === 10, "click " + i + (i === 10 ? " unlocks" : " stays on the main page"));
  }
  assert(unlockedAt === 10, "only the 10th consecutive click unlocks the navigation");
  assert(gate.prevented.length === 9, "the first nine clicks each prevent the default navigation");
  assert(gate.statuses.length === 1, "the first nine clicks leave the status line unchanged");
  assert(gate.statuses[0].msg === "SEAT MAP UNLOCKED — OPENING PREVIEW", "the tenth click announces the unlock");
})();

section("a slow click restarts the count");
(function () {
  const gate = makeGate();
  for (let i = 1; i <= 9; i++) gate.click(1000 + (i - 1) * 100); // nine quick clicks
  gate.click(1000 + 9 * 100 + 5000); // then a pause longer than the gap window
  let unlocked = false;
  for (let i = 1; i <= 8; i++) { unlocked = gate.click(1000 + 9 * 100 + 5000 + i * 100).unlocked || unlocked; }
  assert(!unlocked, "after the pause eight more clicks are not enough (the count restarted)");
  assert(gate.statuses.length === 0, "blocked clicks stay silent when the count restarts after a pause");
})();

section("the unlock itself resets the knock");
(function () {
  const gate = makeGate();
  for (let i = 1; i <= 10; i++) gate.click(1000 + (i - 1) * 100);
  const again = gate.click(1000 + 10 * 100);
  assert(!again.unlocked, "the click after an unlock starts a fresh count");
  assert(gate.statuses.length === 1, "the fresh count does not publish a countdown");
})();

section("clicks at the edge of the gap stay consecutive");
(function () {
  const gate = makeGate();
  let unlockedAt = -1;
  for (let i = 1; i <= 10; i++) {
    const { unlocked } = gate.click(1000 + (i - 1) * 1400); // under the 1500ms gap
    if (unlocked) unlockedAt = i;
  }
  assert(unlockedAt === 10, "ten clicks spaced just under the gap window still unlock");
})();

section("the button is dimmed and still routes to /seatmap");
(function () {
  assert(/<a[^>]*id="btnSeatMap"[^>]*class="linkbtn"[^>]*href="\/seatmap"/.test(TEMPLATE),
    "the template keeps the Seat Map anchor before the gate");
  assert((TEMPLATE.match(/id="btnSeatMap"/g) || []).length === 1, "exactly one Seat Map button exists");
  assert(/#btnSeatMap\{opacity:\.35/.test(TEMPLATE), "the template dims the Seat Map button");
  assert(/#btnSeatMap:hover,#btnSeatMap:focus-visible\{opacity:\.6\}/.test(TEMPLATE),
    "hover and focus only lift the button partway");
  assert(/id="btnSeatMap"[^>]*title="Seat Map preview"/.test(TEMPLATE), "the tooltip no longer invites a normal open");
})();

section("the built pages ship the gate without a countdown");
(function () {
  assert(!GATE_SRC.includes("SEAT MAP PREVIEW — "), "the gate source contains no countdown copy");
  for (const [name, html] of [["index.html", BUILT], ["app.html", BUILT_APP]]) {
    assert(embeddedGateBlock(html) === GATE_SRC, name + " embeds the identical SEATMAP_GATE block");
    assert(/#btnSeatMap\{opacity:\.35/.test(html), name + " ships the dimmed Seat Map style");
    assert(!html.includes("SEAT MAP PREVIEW — ") && !html.includes(" MORE CLICKS"),
      name + " does not ship the hidden countdown copy");
    assert(html.indexOf("SEAT MAP UNLOCKED — OPENING PREVIEW") >= 0, name + " ships the unlock copy");
  }
  const publicIndex = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  assert(publicIndex === BUILT, "public/index.html matches the built gate");
})();

console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
if (FAIL > 0) process.exit(1);
