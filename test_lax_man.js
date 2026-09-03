"use strict";
/* test_lax_man.js — regression for the LAX/MAN bug report (2026-09-02).

   A Google-Flights paste of LAX-LHR-MAN / MAN-LHR-LAX was rewritten by
   cleanOcrText before the engine ever saw it:

     "to London"       -> "TO 10nd0n"   (TO is Transavia; L matched [_|Il]
                                         under the `i` flag, "ondon" became
                                         "10nd0n")
     "to Los Angeles"  -> "TO 105 Angeles"  (L+os -> 1 + 05)

   Those phantom TO 105 anchors then inherited "Manchester (MAN)" via the
   city-alias table, which mapped bare "manchester" to MHT (Manchester-Boston
   Regional) instead of MAN (Manchester UK).  Result: six segments, two
   invented Transavia flights, every return leg printed MHT-MAN.

   Everything here runs through the REAL app.js cleanOcrText, so the
   assertions cover the path a paste actually takes in the browser.
*/
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = __dirname;
const E = require(path.join(REPO, "spicy_engine.js"));

let PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("PASS:", msg); }
  else { FAIL++; console.error("FAIL:", msg); }
}
function checkOut(label, text, want) {
  const [segs, warns] = E.parse(cleanOcrText(text));
  const out = E.renderItinerary(segs);
  if (out === want) { PASS++; console.log("PASS:", label); }
  else {
    FAIL++;
    console.error("FAIL:", label);
    const a = out.split("\n"), b = want.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++)
      if (a[i] !== b[i])
        console.error("  line " + i + "\n   got:  " + JSON.stringify(a[i]) + "\n   want: " + JSON.stringify(b[i]));
  }
  return [segs, warns];
}

function loadCleaner() {
  const appSrc = fs.readFileSync(path.join(REPO, "app.js"), "utf8");
  const start = appSrc.indexOf("var _cleanAirlines = []");
  const end = appSrc.indexOf("/* ---------- bounded, non-blocking screenshot OCR ---------- */");
  if (start < 0 || end < 0) throw new Error("cleaner markers not found in app.js");
  const sandbox = {
    console,
    window: {},
    SPICY_DATA: require(path.join(REPO, "spicy_data.js")),
    document: { createElement: () => ({ textContent: "", innerHTML: "" }) },
    localStorage: { getItem: () => null, setItem: () => {} },
    loadLearnedRules: () => [],
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(appSrc.slice(start, end), sandbox, { filename: "cleaner.js" });
  vm.runInContext("this.__clean = cleanOcrText;", sandbox);
  return sandbox.__clean;
}
const cleanOcrText = loadCleaner();

const EXPECTED = [
  "1 AA 6935 12OCT LAX LHR 345P 1015A\u00a51 Q 77W 10.30 5456 N",
  "DEP-LOS ANGELES INTL",
  "ARR-LONDON HEATHROW",
  "CABIN-ECONOMY",
  "",
  "2 AA 7037 13OCT LHR MAN 1205P 110P S 320 1.05 151 N",
  "DEP-LONDON HEATHROW",
  "ARR-MANCHESTER INTL",
  "CABIN-ECONOMY",
  "",
  "3 AA 6618 22OCT MAN LHR 745A 900A O 320 1.15 151 N",
  "DEP-MANCHESTER INTL",
  "ARR-LONDON HEATHROW",
  "CABIN-ECONOMY",
  "",
  "4 AA 137 22OCT LHR LAX 455P 810P B 77W 11.15 5456 N",
  "DEP-LONDON HEATHROW",
  "ARR-LOS ANGELES INTL",
  "CABIN-ECONOMY",
  "",
  "<--additional-->",
  "1 AA 6935Q 12OCT",
  "2 AA 7037S 13OCT",
  "3 AA 6618O 22OCT",
  "4 AA 137B 22OCT"
].join("\n");

const AS_EMAILED = [
  "Los Angeles (LAX) to Manchester (MAN) on Mon, Oct 12 Warning Icon",
  "",
  "Los Angeles (LAX) to London (LHR) on Mon, Oct 12",
  "3:45 PM to 10:15 AM (10h 30m)",
  "American 6935 (operated by British Airways)",
  "Boeing 777",
  "Economy (Q)",
  "Layover in LHR (1h 50m)",
  "",
  "London (LHR) to Manchester (MAN) on Tue, Oct 13",
  "12:05 PM to 1:10 PM (1h 5m)",
  "American 7037 (operated by British Airways)",
  "Airbus A320",
  "Economy (S)",
  "Manchester (MAN) to Los Angeles (LAX) on Thu, Oct 22 Warning IconWarning Icon",
  "",
  "Manchester (MAN) to London (LHR) on Thu, Oct 22",
  "7:45 AM to 9:00 AM (1h 15m)",
  "American 6618 (operated by British Airways)",
  "Airbus A320",
  "Economy (O)",
  "Layover in LHR (7h 55m)",
  "",
  "London (LHR) to Los Angeles (LAX) on Thu, Oct 22",
  "4:55 PM to 8:10 PM on Thu, Oct 22 (11h 15m)",
  "American 137",
  "Boeing 777",
  "Economy (B)"
].join("\n");

console.log("=== 1. The reported itinerary ===");
const [segsA, warnsA] = checkOut(
  "reported paste -> 4 AA legs, LAX-LHR-MAN / MAN-LHR-LAX, no TO 105",
  AS_EMAILED, EXPECTED);
assert(warnsA.length === 0, "reported paste raises no warnings (got " + JSON.stringify(warnsA) + ")");
assert(segsA.length === 4, "exactly 4 segments (got " + segsA.length + ")");
assert(segsA.every(function(s) { return s.airline === "AA"; }), "every leg is American, no phantom TO");
assert(segsA[0].orig === "LAX" && segsA[0].dest === "LHR", "leg 1 is LAX-LHR");
assert(segsA[1].orig === "LHR" && segsA[1].dest === "MAN", "leg 2 is LHR-MAN (not MHT)");
assert(segsA[2].orig === "MAN" && segsA[2].dest === "LHR", "leg 3 is MAN-LHR (not MHT-MAN)");
assert(segsA[3].orig === "LHR" && segsA[3].dest === "LAX", "leg 4 is LHR-LAX");
assert(segsA.every(function(s) { return s.orig !== "MHT" && s.dest !== "MHT"; }),
  "Manchester-Boston (MHT) never appears");

console.log("\n=== 2. cleanOcrText must not invent Transavia flights ===");
const cleaned = cleanOcrText(AS_EMAILED);
assert(!/\bTO\s+105\b/.test(cleaned), "cleaner does not invent TO 105 from 'to Los'");
assert(!/TO 10nd0n/i.test(cleaned), "cleaner does not invent TO 10nd0n from 'to London'");
assert(/to London \(LHR\)/.test(cleaned), "route connector 'to London (LHR)' survives");
assert(/to Los Angeles \(LAX\)/.test(cleaned), "route connector 'to Los Angeles (LAX)' survives");
assert(/\bTO 1234\b/.test(cleanOcrText("to 1234 AMS ORY")),
  "Transavia 'to 1234' in front of a flight number is still uppercased");

console.log("\n=== 3. City alias + explicit code ===");
assert(E.geodesicMiles("LHR", "MAN") === 151,
  "LHR-MAN is the published 151 mi, got " + E.geodesicMiles("LHR", "MAN"));
const noCode = E.parse(cleanOcrText(
  "Manchester to London on Thu, Oct 22\nAmerican 6618\n7:45 AM to 9:00 AM\nAirbus A320\nEconomy (O)"
))[0];
assert(noCode.length === 1 && noCode[0].orig === "MAN" && noCode[0].dest === "LHR",
  "bare 'Manchester' resolves to MAN not MHT (got " +
  (noCode[0] ? noCode[0].orig + "-" + noCode[0].dest : "nothing") + ")");
const nh = E.parse(
  "Manchester Boston (MHT) to New York (JFK) on Thu, Oct 22\nAA 4400\n7:45 AM to 9:00 AM\nEmbraer E175\nEconomy (Y)"
)[0];
assert(nh.length === 1 && nh[0].orig === "MHT" && nh[0].dest === "JFK",
  "explicit MHT still reads as Manchester-Boston (got " +
  (nh[0] ? nh[0].orig + "-" + nh[0].dest : "nothing") + ")");

console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
process.exit(FAIL ? 1 : 0);
