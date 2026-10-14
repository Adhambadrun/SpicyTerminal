"use strict";
/* test_adv_pax_gds.js — regression for the 2026-10-14 bug report:
 *
 *   === WHAT I PASTED ===  (a real Sabre-style itinerary with OSI remarks)
 *   1 UA2414P 06APR T JAXORD*SS1   749A  923A /DCUA /E
 *   ADV PAX FLT ARRIVES TERMINAL-1
 *    2 UA 867P 06APR T ORDNRT*SS1  1120A  225P  07APR W /DCUA /E
 *   ...
 *    3 KE 704Z 12APR M NRTICN SS1   200P  430P /DCKE /E
 *   ...
 *
 *   === WHAT THE APP PRODUCED ===
 *   3 KE 7042 12APR PAX  ???? ???? Y 752 0.00 0 N
 *   DEP-PORT-DE-PAIX AIRPORT
 *   4 SS 1 12APR PAX ICN 200P 430P¥1 Y 752 13.30 8289 N
 *   ...
 *   5 UA 2862 20APR ICN EWR ...
 *
 *   "Why AI keep failing?? and keep the wrong converted format without
 *    correcting it??"
 *
 * Three corruptions stacked up in the app pipeline (cleanOcrText -> engine):
 *
 *   1. The `Flight`-word rules in cleanOcrText matched across the newline at
 *      the end of "BUSINESSFIRST OFFERED THIS FLIGHT" and glued that remark to
 *      the GDS row beneath it. Row 3 lost its segment number and fell through
 *      to the prose fallback.
 *   2. The carrier+number glyph repair folded a GDS booking-class suffix into
 *      the flight number: "KE 704Z" -> "KE 7042", "UA 286Z" -> "UA 2862"
 *      (and "AA 913I" -> "AA 9131", "AA 112O" -> "AA 1120"). A trailing class
 *      letter is not a misread digit — the GDS table scanner splits it itself.
 *   3. The prose fallback invented legs out of the wreckage: the sell-status
 *      column "SS1" anchored a phantom Corsair "SS 1" flight (the four "SS 1"
 *      rows in the mistake log), and the word "PAX" in "ADV PAX FLT …" remarks
 *      became Port-de-Paix airport, so the phantom legs sprouted Haiti.
 *
 * Everything here runs the REAL app.js cleaner and the REAL engine — the exact
 * path a browser takes for a paste.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = __dirname;
const E = require(path.join(REPO, "spicy_engine.js"));
const APP = fs.readFileSync(path.join(REPO, "app.js"), "utf8");

let PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("PASS:", msg); }
  else { FAIL++; console.error("FAIL:", msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

/* ---------- the real cleanOcrText, evaluated the way test_mistake_learner does ---------- */
function loadCleaner(rules) {
  const start = APP.indexOf("var _cleanAirlines = []");
  const end = APP.indexOf("/* ---------- bounded, non-blocking screenshot OCR ---------- */");
  if (start < 0 || end < 0) throw new Error("cleaner markers not found in app.js");
  const sandbox = {
    console,
    window: {},
    SPICY_DATA: require(path.join(REPO, "spicy_data.js")),
    document: { createElement: () => ({ textContent: "", innerHTML: "" }) },
    localStorage: { getItem: () => null, setItem: () => {} },
    loadLearnedRules: () => rules || []
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(APP.slice(start, end), sandbox, { filename: "cleaner.js" });
  vm.runInContext("this.__clean = cleanOcrText;", sandbox);
  return sandbox.__clean;
}

const BUG_INPUT = [
  "1 UA2414P 06APR T JAXORD*SS1   749A  923A /DCUA /E",
  "ADV PAX FLT ARRIVES TERMINAL-1",
  " 2 UA 867P 06APR T ORDNRT*SS1  1120A  225P  07APR W /DCUA /E",
  "ADV PAX FLT ARRIVES TERMINAL-1",
  "ADV PAX FLT DEPARTS TERMINAL-1",
  "TFC SUBJ GOVT APPROVAL",
  " BUSINESSFIRST OFFERED THIS FLIGHT",
  " 3 KE 704Z 12APR M NRTICN SS1   200P  430P /DCKE /E",
  " 4 UA 286Z 20APR T ICNEWR*SS1   515P  610P /DCUA /E",
  "ADV PAX FLT ARRIVES TERMINAL-B",
  "ADV PAX FLT DEPARTS TERMINAL-1",
  " BUSINESSFIRST OFFERED THIS FLIGHT",
  "CITY TERMINAL CHECK-IN SERVICE AVAILABLE IN SEOUL",
  " 5 UA2811Z 20APR T EWRJAX*SS1   800P 1030P /DCUA /E",
  "ADV PAX FLT DEPARTS TERMINAL-C"
].join("\n");

/* ================= 1. the cleaner must not rewrite lines ================= */
section("1. cleanOcrText keeps the input's line structure and class suffixes");
{
  const clean = loadCleaner([]);
  const cleaned = clean(BUG_INPUT, { learned: false });
  const lines = cleaned.split("\n");
  assert(lines.length === 15, "all 15 input lines survive (got " + lines.length + ")");
  assert(/BUSINESSFIRST OFFERED THIS Flight\s*$/.test(lines[6]),
    "the remark line does not swallow the next row: " + JSON.stringify(lines[6]));
  assert(/^\s*3 KE 704Z 12APR/.test(lines[7]),
    "row 3 keeps its own line, flight number and booking class: " + JSON.stringify(lines[7]));
  assert(/KE 704Z/.test(cleaned), "'KE 704Z' is flight 704 class Z, not flight 7042");
  assert(/UA 286Z/.test(cleaned), "'UA 286Z' is flight 286 class Z, not flight 2862");
  assert(!/7042|2862/.test(cleaned), "no flight number invented by folding a class letter");
  // The same guard protects OCR'd screenshots and other GDS class suffixes.
  assert(clean("2 AA 913I 16APR F MIABOG SS1  1018A  105P /DCAA /E").indexOf("AA 913I") >= 0,
    "'AA 913I' keeps class I (was rewritten to 'AA 9131')");
  assert(clean("3 AA 112O 16MAY S MIABCN*SS1   750P 1055A  17MAY M /DCAA /E").indexOf("AA 112O") >= 0,
    "'AA 112O' keeps class O (was rewritten to 'AA 1120')");
  // Real OCR glyph repair still works for genuine confusions.
  assert(clean("OZ SO5 12OCT ICN JFK 100A 900A", { learned: false }).indexOf("OZ 505") >= 0,
    "a mid-number glyph ('SO5') is still repaired to a flight number");
  // A prose line ending in the word FLIGHT must not eat the following line.
  assert(clean("BUSINESSFIRST OFFERED THIS FLIGHT\n3 KE 704Z 12APR").split("\n").length === 2,
    "'…THIS FLIGHT' + next line stay two lines");
}

/* ================= 2. the full pipeline converts the paste correctly ================= */
section("2. cleanOcrText + engine: the five real legs, nothing else");
{
  const clean = loadCleaner([]);
  const [segs, warns] = E.parse(clean(BUG_INPUT, { learned: false }));
  const ids = segs.map(s => s.airline + " " + s.flight_no + " " + s.date_ddmmm + " " +
    s.orig + "-" + s.dest + " " + s.dep_time + "/" + s.arr_time + " " + s.booking_class);
  assert(segs.length === 5, "5 legs read (got " + segs.length + ": " + ids.join(" | ") + ")");
  assert(ids.join(" | ") ===
    "UA 2414 06APR JAX-ORD 749A/923A P | UA 867 06APR ORD-NRT 1120A/225P P | " +
    "KE 704 12APR NRT-ICN 200P/430P Z | UA 286 20APR ICN-EWR 515P/610P Z | " +
    "UA 2811 20APR EWR-JAX 800P/1030P Z",
    "every leg keeps its identity, route, clocks and booking class: " + ids.join(" | "));
  assert(segs[1].arr_day_shift === 1, "UA 867 lands 07APR (¥1) — the arrival date on its row is read");
  assert(!segs.some(s => s.airline === "SS"), "no phantom 'SS 1' leg from the sell-status column");
  assert(!segs.some(s => s.orig === "PAX" || s.dest === "PAX"),
    "'PAX' in 'ADV PAX FLT …' remarks is not Port-de-Paix airport");
  const out = E.renderItinerary(segs);
  assert(out.indexOf("PORT-DE-PAIX") < 0 && out.indexOf("???") < 0,
    "the rendered itinerary has no placeholder airports");
  assert(!/NOT read/i.test(warns.join(" | ")), "no row dropped: " + JSON.stringify(warns));
  // The app only calls the AI when the deterministic read is incomplete —
  // this read is complete, so the answer above is the conversion. No AI.
  const lacks = warns.some(w => /NOT read|missing|unknown/i.test(w));
  assert(!lacks, "direct read is complete (no /NOT read|missing|unknown/ warning) — AI FIX is not needed");
}

/* ================= 3. the engine alone: sell-status is not a flight ================= */
section("3. a sell-status column never anchors a leg, remarks never publish airports");
{
  // Row context: glued route pair + SS1 + clocks. The prose scanner inherits
  // rows like these whenever the table scanner cannot read them.
  const anchors = E._findAnchors(BUG_INPUT);
  assert(!anchors.some(a => a.code === "SS"), "_findAnchors: no 'SS 1' anchor anywhere in the paste");
  // Spaced route pair form ("MIABOG SS1") and the TK2 shape from the old reports.
  const spaced = E._findAnchors("1 AA 913I 16APR F MIABOG SS1  1018A  105P /DCAA /E");
  assert(!spaced.some(a => a.code === "SS"), "spaced route + SS1 status: no SS anchor");
  const tk = E._findAnchors("2 OB 708S 16SEP W VVIEZE TK2  1000A  155P /DCOB /E");
  assert(!tk.some(a => a.code === "TK"), "'VVIEZE TK2' is a route and a status, not a Turkish leg");
  // A real Corsair-style flight number (3 digits) is untouched.
  const real = E._findAnchors("SS 951 30OCT ORY FDF 1015A 325P");
  assert(real.some(a => a.code === "SS" && a.num === "951"), "a real 'SS 951' still anchors");
  // Remarks: parse a text where the only airport-like word is PAX in a remark.
  const [seg2] = E.parse("ADV PAX FLT ARRIVES TERMINAL-1\nUA 100 01JAN ORD SFO 100A 1230P");
  assert(seg2.length === 1 && seg2[0].orig === "ORD" && seg2[0].dest === "SFO",
    "remark lines contribute no airports (got " + (seg2[0] ? seg2[0].orig + "-" + seg2[0].dest : "none") + ")");
  const [seg3] = E.parse("CITY TERMINAL CHECK-IN SERVICE AVAILABLE IN SEOUL\nKE 704 12APR NRT ICN 200P 430P");
  assert(seg3.length === 1 && seg3[0].orig === "NRT" && seg3[0].dest === "ICN",
    "'…AVAILABLE IN SEOUL' does not publish ICN/GMP as a route");
}

console.log(`\n${PASS}/${PASS + FAIL} checks`);
process.exit(FAIL ? 1 : 0);
