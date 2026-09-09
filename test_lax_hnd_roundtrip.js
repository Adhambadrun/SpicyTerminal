"use strict";
/* test_lax_hnd_roundtrip.js — regression for bug report 2026-09-09 00:54 UTC.

   A Google-Flights round trip pasted as duplicated per-leg cards:

     Los Angeles (LAX) to Tokyo (HND) on Fri, Dec 4
     9:40 AM to 3:05 PM on Sat, Dec 5 (12h 25m)
     American 27 ...
     Tokyo (HND) to Los Angeles (LAX) on Sat, Dec 19 Warning Icon
     1:05 PM to 6:00 AM (9h 55m)
     American 170 ...

   printed FOUR segments instead of two:

     2 TO 105 19DEC LAX HND ???? ???? ...
     3 TO 105 19DEC LAX HND 105P 600A¥2 W 789 ...
     4 AA 170 19DEC LAX HND 105P 600A¥2 ...

   Three root causes, all covered here:

   1. cleanOcrText uppercased the route connector `to` when a number followed
      it, and the number was the pasted clock with its colon lost ("to 105
      PM") — the engine then anchored a phantom Transavia `TO 105`, which
      swallowed the time line and left the REAL leg (AA 170) with `????`.
      (The learn log shows the same "departure time missing -> ????" three
      times in the week before the report.)
   2. The engine accepted carrier+number anchors with a meridiem right after
      the number — "105 PM" is a clock, "170 19DEC" is a flight.
   3. A leg whose own route header failed to publish borrowed the outbound's
      header, printing the return as LAX-HND with a nonsense `¥2` day shift —
      only the reversed (wrong) airport pair needs +2 days to explain 9h 55m.

   Everything runs through the REAL app.js cleanOcrText, so the assertions
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
  "1 AA 27 04DEC LAX HND 940A 305P\u00a51 P 788 12.25 5488 N",
  "DEP-LOS ANGELES INTL",
  "ARR-TOKYO HANEDA",
  "CABIN-PREMIUM ECONOMY",
  "",
  "2 AA 170 19DEC HND LAX 105P 600A P 788 9.55 5488 N",
  "DEP-TOKYO HANEDA",
  "ARR-LOS ANGELES INTL",
  "CABIN-PREMIUM ECONOMY",
  "",
  "<--additional-->",
  "1 AA 27P 04DEC",
  "2 AA 170P 19DEC"
].join("\n");

/* The paste EXACTLY as captured by the bug report (trailing spaces and the
   "Warning Icon" copy artefact included). */
const REPORT_PASTE =
"Los Angeles (LAX) to Tokyo (HND) on Fri, Dec 4\n" +
"\n" +
"Los Angeles (LAX) to Tokyo (HND) on Fri, Dec 4\n" +
"9:40 AM to 3:05 PM on Sat, Dec 5 (12h 25m)\n" +
"American 27\n" +
"Boeing 787\n" +
"Premium Economy (P)   \n" +
"Tokyo (HND) to Los Angeles (LAX) on Sat, Dec 19 Warning Icon  \n" +
"\n" +
"Tokyo (HND) to Los Angeles (LAX) on Sat, Dec 19\n" +
"1:05 PM to 6:00 AM (9h 55m)\n" +
"American 170\n" +
"Boeing 787\n" +
"Premium Economy (P)";

/* The same cards with the clocks' colons lost — the shape an OCR pass or a
   different Google-Flights surface produces. */
const COLON_LOSS_PASTE =
"Los Angeles (LAX) to Tokyo (HND) on Fri, Dec 4\n" +
"\n" +
"Los Angeles (LAX) to Tokyo (HND) on Fri, Dec 4\n" +
"940 AM to 305 PM on Sat, Dec 5 (12h 25m)\n" +
"American 27\n" +
"Boeing 787\n" +
"Premium Economy (P)\n" +
"Tokyo (HND) to Los Angeles (LAX) on Sat, Dec 19 Warning Icon\n" +
"\n" +
"Tokyo (HND) to Los Angeles (LAX) on Sat, Dec 19\n" +
"105 PM to 600 AM (9h 55m)\n" +
"American 170\n" +
"Boeing 787\n" +
"Premium Economy (P)";

/* A summary card: only the trip header, no per-leg route lines at all.  The
   return has no route of its own to find — it must not silently wear the
   outbound's direction, and must not print the nonsense +2 shift. */
const HEADERLESS_RETURN_PASTE =
"Los Angeles (LAX) to Tokyo (HND) on Fri, Dec 4\n" +
"9:40 AM to 3:05 PM on Sat, Dec 5 (12h 25m)\n" +
"American 27\n" +
"Boeing 787\n" +
"Premium Economy (P)\n" +
"\n" +
"1:05 PM to 6:00 AM on Sat, Dec 19 (9h 55m)\n" +
"American 170\n" +
"Boeing 787\n" +
"Premium Economy (P)";

function convert(text) {
  const [segs, warns] = E.parse(cleanOcrText(text, { learned: false }));
  return { out: E.renderItinerary(segs), segs, warns };
}

console.log("=== 1. the reported paste converts to exactly two legs ===");
{
  const { out, segs, warns } = convert(REPORT_PASTE);
  assert(segs.length === 2, "exactly 2 segments (got " + segs.length + ")");
  assert(segs.every(s => !(s.airline === "TO")), "no phantom Transavia leg (got " +
    segs.map(s => s.airline + s.flight_no).join(",") + ")");
  assert(!/\bTO\s+\d+\b/.test(out), "no TO flight in the output");
  assert(!/\?\?\?\?/.test(out), "no ???? placeholder times");
  assert(segs[0].airline === "AA" && segs[0].flight_no === "27" &&
         segs[0].orig === "LAX" && segs[0].dest === "HND" &&
         segs[0].dep_time === "940A" && segs[0].arr_time === "305P" &&
         segs[0].arr_day_shift === 1 && segs[0].date_ddmmm === "04DEC",
         "leg 1 is AA 27 04DEC LAX-HND 940A 305P+1");
  assert(segs[1].airline === "AA" && segs[1].flight_no === "170" &&
         segs[1].orig === "HND" && segs[1].dest === "LAX" &&
         segs[1].dep_time === "105P" && segs[1].arr_time === "600A" &&
         segs[1].arr_day_shift === 0 && segs[1].date_ddmmm === "19DEC",
         "leg 2 is AA 170 19DEC HND-LAX 105P 600A (no shift)");
  assert(out === EXPECTED, "rendered itinerary matches the expected GDS text exactly");
  assert(warns.length === 0, "no warnings (got " + JSON.stringify(warns) + ")");
}

console.log("=== 2. colon-lost clocks keep every field ===");
{
  const { segs } = convert(COLON_LOSS_PASTE);
  assert(segs.length === 2, "still exactly 2 segments (got " + segs.length + ")");
  assert(segs.every(s => s.airline === "AA"), "both legs American (got " +
    segs.map(s => s.airline + s.flight_no).join(",") + ")");
  assert(segs[0].dep_time === "940A" && segs[0].arr_time === "305P" &&
         segs[0].date_ddmmm === "04DEC",
         "leg 1 kept its compact clocks and departure date (got " +
         segs[0].date_ddmmm + " " + segs[0].dep_time + "/" + segs[0].arr_time + ")");
  assert(segs[1].dep_time === "105P" && segs[1].arr_time === "600A" &&
         segs[1].orig === "HND" && segs[1].dest === "LAX",
         "leg 2 kept its compact clocks and direction (got " +
         segs[1].orig + "-" + segs[1].dest + " " + segs[1].dep_time + "/" + segs[1].arr_time + ")");
}

console.log("=== 3. a headerless return keeps its own direction ===");
{
  const { segs, warns } = convert(HEADERLESS_RETURN_PASTE);
  const ret = segs[segs.length - 1];
  assert(ret && ret.airline + ret.flight_no === "AA170",
         "the return is still read (got " + (ret ? ret.airline + ret.flight_no : "nothing") + ")");
  assert(ret.orig === "HND" && ret.dest === "LAX",
         "return prints HND-LAX, not the borrowed LAX-HND (got " + ret.orig + "-" + ret.dest + ")");
  assert(ret.arr_day_shift === 0, "no bogus +2 day shift (got +" + ret.arr_day_shift + ")");
  assert(warns.some(w => /route reversed/i.test(w)) || ret.warnings.some(w => /route reversed/i.test(w)),
         "the reversal is disclosed as a warning");
}

console.log("=== 4. the engine guard is surgical ===");
{
  // A number followed by a meridiem is a clock, never a flight.
  assert(E._findAnchors("to 105 PM to 600 AM").length === 0,
    "no anchor from 'to 105 PM' (clock pair)");
  assert(E._findAnchors("Transavia 105 PM").length === 0,
    "no anchor from 'Transavia 105 PM'");
  // A number followed by a date/airport is a flight and must survive.
  const real = E._findAnchors("TO 1234 19DEC AMS ORY 830A 955A");
  assert(real.length === 1 && real[0].code === "TO" && real[0].num === "1234",
    "a real Transavia row still anchors (got " + JSON.stringify(real) + ")");
  const segs = E.parse("1 TO 1234 19DEC AMS ORY 830A 955A Y 738 1.25 266 N")[0];
  assert(segs.length === 1 && segs[0].airline === "TO" && segs[0].orig === "AMS",
    "a real Transavia GDS row still converts");
  assert(/\bTO 1234\b/.test(cleanOcrText("to 1234 AMS ORY")),
    "a real lowercase Transavia carrier before a flight number is still uppercased");
  // The cleaner keeps the connector a word in front of a clock…
  assert(!/\bTO\s+105P?\b/.test(cleanOcrText("to 105 PM")),
    "cleaner leaves 'to 105 PM' lowercase (got " + JSON.stringify(cleanOcrText("to 105 PM")) + ")");
  // …and folds the colon-lost clock to its compact readable form.
  assert(/105P\b/.test(cleanOcrText("to 105 PM")),
    "cleaner folds '105 PM' to 105P (got " + JSON.stringify(cleanOcrText("to 105 PM")) + ")");
  assert(!/105P/.test(cleanOcrText("flight 105 in June")),
    "cleaner never touches a flight number without a meridiem");
}

console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
process.exit(FAIL ? 1 : 0);
