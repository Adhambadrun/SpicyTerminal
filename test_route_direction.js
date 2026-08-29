"use strict";
/* test_route_direction.js — regression for the JFK/DUB bug report (2026-08-29).

   TWO bugs, one report:

   1. REVERSED OUTBOUND.  "New York (JFK) to Dublin (DUB) on Sun, Mar 7 -
      Nonstop - 6 hr 30 min - American Airlines - Business" is how a Google
      Flights / confirmation card writes a route line, and it is longer than the
      90 characters findSideHeaders allowed.  The leg's own header was therefore
      invisible, the leg borrowed the NEXT leg's header, and the outbound was
      printed as "AA 8330 07MAR DUB JFK" with DEP-DUBLIN INTL / ARR-JOHN F
      KENNEDY INTL — no warning, nothing to tell the user the direction flipped.

   2. WRONG DISTANCE.  The same itinerary printed 3171 miles.  That is the
      spherical great-circle value; the published flight distance for JFK-DUB
      (and what a GDS shows) is the WGS-84 geodesic 3179.3 -> 3179.

   Everything here runs through the REAL app.js cleanOcrText, so the assertions
   cover the path a paste actually takes in the browser.
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

/* ---------- the real cleanOcrText from app.js (evaluated in a sandbox) ---------- */
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

/* ---------- what the reporter expected, byte for byte ---------- */
const EXPECTED = [
  "1 AA 8330 07MAR JFK DUB 500P 430A\u00a51 I 333 6.30 3179 N",
  "DEP-JOHN F KENNEDY INTL",
  "ARR-DUBLIN INTL",
  "CABIN-BUSINESS",
  "",
  "2 AA 8331 28MAR DUB JFK 1110A 140P I 333 7.30 3179 N",
  "DEP-DUBLIN INTL",
  "ARR-JOHN F KENNEDY INTL",
  "CABIN-BUSINESS",
  "",
  "<--additional-->",
  "1 AA 8330I 07MAR",
  "2 AA 8331I 28MAR"
].join("\n");

const RETURN_BLOCK = [
  "Dublin (DUB) to New York (JFK) on Sun, Mar 28",
  "11:10 AM to 1:40 PM (7h 30m)",
  "American 8331 (operated by Aer Lingus)",
  "Airbus A330",
  "Business (I)"
].join("\n");

console.log("=== 1. The reported itinerary ===");

/* The paste exactly as the bug report captured it. */
const AS_EMAILED = [
  "New York (JFK) to Dublin (DUB) on Sun, Mar 7",
  "",
  "New York (JFK) to Dublin (DUB) on Sun, Mar 7",
  "5:00 PM to 4:30 AM (6h 30m)",
  "American 8330 (operated by Aer Lingus)",
  "Airbus A330",
  "Business (I)",
  "Dublin (DUB) to New York (JFK) on Sun, Mar 28",
  "",
  RETURN_BLOCK
].join("\n");
const [segsA, warnsA] = checkOut("reported paste -> JFK DUB out / DUB JFK back, 3179 mi", AS_EMAILED, EXPECTED);
assert(warnsA.length === 0, "reported paste raises no warnings (got " + JSON.stringify(warnsA) + ")");
assert(segsA.length === 2 && segsA[0].orig === "JFK" && segsA[0].dest === "DUB"
  && segsA[1].orig === "DUB" && segsA[1].dest === "JFK", "each leg keeps its own direction");
assert(segsA.length === 2 && segsA[0].date_ddmmm === "07MAR" && segsA[1].date_ddmmm === "28MAR",
  "outbound keeps 07MAR, return keeps 28MAR");

/* The shape that actually triggered the report: the outbound route line is a
   full Google-Flights card, so it runs past 90 characters. */
const LONG_CARD = "New York (JFK) to Dublin (DUB) on Sun, Mar 7 - Nonstop - 6 hr 30 min - American Airlines - Business";
assert(LONG_CARD.length > 90, "the card line really is longer than the old 90-char cap (" + LONG_CARD.length + ")");
checkOut("long card line (>90 chars) -> same itinerary", [
  "New York (JFK) to Dublin (DUB) on Sun, Mar 7",
  "",
  LONG_CARD,
  "5:00 PM to 4:30 AM (6h 30m)",
  "American 8330 (operated by Aer Lingus)",
  "Airbus A330",
  "Business (I)",
  "Dublin (DUB) to New York (JFK) on Sun, Mar 28",
  "",
  RETURN_BLOCK
].join("\n"), EXPECTED);

/* A whole itinerary on one line: both routes are past the cap, and each leg must
   still take the route stated in front of it (the outbound used to be printed
   with the return's route AND the return's times). */
checkOut("both legs on one line -> each keeps its own route and times",
  "New York (JFK) to Dublin (DUB) on Sun, Mar 7 5:00 PM to 4:30 AM (6h 30m) American 8330 (operated by Aer Lingus) Airbus A330 Business (I) "
  + "Dublin (DUB) to New York (JFK) on Sun, Mar 28 11:10 AM to 1:40 PM (7h 30m) American 8331 (operated by Aer Lingus) Airbus A330 Business (I)",
  EXPECTED);

/* A route written with bare codes on a long line is not a published header, but
   the leg still states its own direction — so the next leg's header must not be
   borrowed for it. */
const [segsD] = checkOut("bare-code route on a long line -> own direction kept", [
  "Departing New York JFK to Dublin DUB on Sunday March 7 at 5:00 PM arriving 4:30 AM the next day on American Airlines flight 8330 operated by Aer Lingus with an Airbus A330 in Business class booking class I",
  "Dublin (DUB) to New York (JFK) on Sun, Mar 28",
  "11:10 AM to 1:40 PM (7h 30m)",
  "American 8331 (operated by Aer Lingus)",
  "Airbus A330",
  "Business (I)"
].join("\n"), EXPECTED);

console.log("\n=== 2. Borrowing a later header is still allowed when it belongs to the leg ===");
/* ET-style: the route is printed AFTER the flight number and there is no route
   in front of it.  That borrow is correct and must survive the guard above. */
const etSegs = E.parse(cleanOcrText([
  "ET 575",
  "ORD to ADD",
  "Jan 12 10:20 PM to 8:15 AM+1",
  "Boeing 787-9",
  "Economy (Y)"
].join("\n")))[0];
assert(etSegs.length === 1 && etSegs[0].orig === "ORD" && etSegs[0].dest === "ADD",
  "header after the flight row is still used (ORD ADD, got "
  + (etSegs[0] ? etSegs[0].orig + " " + etSegs[0].dest : "nothing") + ")");

console.log("\n=== 3. WGS-84 geodesic distances ===");
assert(E.geodesicMiles("JFK", "DUB") === 3179, "JFK-DUB is 3179 mi (published 3179.3), got " + E.geodesicMiles("JFK", "DUB"));
assert(E.geodesicMiles("DUB", "JFK") === E.geodesicMiles("JFK", "DUB"), "distance is symmetric");
assert(E.geodesicMiles("JFK", "LHR") === 3452, "JFK-LHR is 3452 mi, got " + E.geodesicMiles("JFK", "LHR"));
assert(E.haversineMiles("JFK", "DUB") === E.geodesicMiles("JFK", "DUB"),
  "legacy haversineMiles() name returns the same geodesic miles");
assert(E.geodesicMiles("JFK", "JFK") === 0, "same airport is 0 mi");
assert(E.geodesicMiles("JFK", "ZZZ") === null, "unknown airport is null, not a number");
// Near-antipodal pairs are where Vincenty can fail to converge; the fallback must
// still return a sane great-circle value rather than NaN.
const antipodal = E.geodesicMiles("AKL", "MAD");
assert(typeof antipodal === "number" && antipodal > 11000 && antipodal < 13000,
  "near-antipodal AKL-MAD converges to a sane distance (" + antipodal + ")");
assert(isFinite(E.geodesicMiles("SYD", "JFK")) && E.geodesicMiles("SYD", "JFK") === 9950,
  "longest-haul pairs stay finite (SYD-JFK " + E.geodesicMiles("SYD", "JFK") + ")");

console.log("\n=== 4. The two root causes stay fixed ===");
/* cleanOcrText uppercases every standalone token that matches a carrier code, and
   TO / BY are real carriers.  That is what rewrote the pasted route lines and
   started this bug, so the words must survive while carrier repair still works. */
const cleanedReport = cleanOcrText(AS_EMAILED);
assert(!/\)\s+TO\s/.test(cleanedReport), "cleanOcrText leaves the route connector as 'to'");
assert(!/Operated BY/.test(cleanedReport), "cleanOcrText leaves 'operated by' alone");
assert(/\bQR 704\b/.test(cleanOcrText("qR 704 DOH JFK")), "a lowercase carrier before a flight number is still repaired to QR 704");
assert(/\bTO 1234\b/.test(cleanOcrText("to 1234 JFK DUB")), "Transavia 'to 1234' in front of a flight number is still uppercased");
/* And if an uppercase connector arrives anyway (an all-caps paste, another tool's
   output), the engine must still read the route. */
const upperSegs = E.parse([
  "NEW YORK (JFK) TO DUBLIN (DUB) ON SUN, MAR 7",
  "5:00 PM TO 4:30 AM (6h 30m)",
  "AMERICAN 8330",
  "AIRBUS A330",
  "BUSINESS (I)"
].join("\n"))[0];
assert(upperSegs.length === 1 && upperSegs[0].orig === "JFK" && upperSegs[0].dest === "DUB",
  "an uppercase 'TO' connector still yields JFK DUB (got "
  + (upperSegs[0] ? upperSegs[0].orig + " " + upperSegs[0].dest : "nothing") + ")");

console.log("\n=== 5. One flight per line, route written AFTER the flight number ===");
/* Airline-website shape.  These lines run past 90 characters, so no header was
   published for them at all and every leg inherited whichever short line did
   publish one — four different flights all printed the same route.  Each leg
   must keep its own. */
const PER_LINE = [
  "Flight RJ 5979, 10 JUL, SZX to DMM, 9:01 PM - 10:41 PM, Airbus A320neo, Premium Economy (M)",
  "Flight KC 1777, 12 AUG, AKL to VVI, 4:55 AM - 7:42 AM, Boeing 777-300ER, Premium Economy (Q)",
  "Flight NK 8213, 14 JUL, IND to BWN, 3:19 AM - 1:05 PM, Embraer E190, First (Y)",
  "Flight DY 1390, 19 JUL, EBL to RAK, 4:36 AM - 6:42 AM, Boeing 777-300ER, Premium Economy (K)"
].join("\n");
const perLine = {};
E.parse(cleanOcrText(PER_LINE))[0].forEach(function(s) { perLine[s.airline + s.flight_no] = s; });
[["RJ5979", "SZX", "DMM", "901P", "1041P"],
 ["KC1777", "AKL", "VVI", "455A", "742A"],
 ["NK8213", "IND", "BWN", "319A", "105P"],
 ["DY1390", "EBL", "RAK", "436A", "642A"]].forEach(function(want) {
  const got = perLine[want[0]];
  const ok = got && got.orig === want[1] && got.dest === want[2]
    && got.dep_time === want[3] && got.arr_time === want[4];
  assert(ok, want[0] + " keeps its own route and times (" + want[1] + " " + want[2] + " " + want[3]
    + "/" + want[4] + "), got " + (got ? got.orig + " " + got.dest + " " + got.dep_time + "/" + got.arr_time : "no segment"));
});

console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
process.exit(FAIL ? 1 : 0);
