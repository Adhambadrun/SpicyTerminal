// Regression: a second leg must never inherit the first leg's date, route,
// times, aircraft or duration — the bug that turned an ORD-DXB + DXB-CAI
// Emirates trip into the same ORD-DXB leg printed twice.
const E = require("./spicy_engine.js");

// Distances are WGS-84 geodesic miles (ORD-DXB 7247, DXB-CAI 1503); the old
// spherical great-circle values read 7233/1501 and no longer match what the
// engine — or a GDS — reports for the same pair.
const EXPECTED = [
  "1 EK 236 31AUG ORD DXB 835P 800P\u00a51 C 77W 14.25 7247 N",
  "DEP-CHICAGO O HARE INTL",
  "ARR-DUBAI INTL",
  "CABIN-BUSINESS",
  "",
  "2 EK 927 02SEP DXB CAI 815A 1105A C 388 3.50 1503 N",
  "DEP-DUBAI INTL",
  "ARR-CAIRO INTL",
  "CABIN-BUSINESS",
  "",
  "<--additional-->",
  "1 EK 236C 31AUG",
  "2 EK 927C 02SEP"
].join("\n");

const CASES = {
  "blank-line separated blocks":
`Emirates
EK 236  31 Aug 2026
Chicago O'Hare (ORD) 8:35 PM
Dubai (DXB) 8:00 PM +1
Business
Boeing 777-300ER
14h 25m

EK 927  2 Sep 2026
Dubai (DXB) 8:15 AM
Cairo (CAI) 11:05 AM
Business
Airbus A380-800
3h 50m`,

  "one line per flight, no blank line":
`EK 236 31AUG ORD 835P DXB 800P+1 business
EK 927 02SEP DXB 815A CAI 1105A business`,

  "confirmation email prose":
`Your Emirates trip
Flight EK 236 - Sunday 31 August - Chicago (ORD) departs 20:35 - Dubai (DXB) arrives 20:00 next day - Business
Flight EK 927 - Tuesday 2 September - Dubai (DXB) departs 08:15 - Cairo (CAI) arrives 11:05 - Business`
};

// The GDS row form carries its own booking class, so it is checked separately.
const GDS_CASE =
`1 EK 236 31AUG ORD DXB 835P 800P\u00a51 O
2 EK 927 02SEP DXB CAI 815A 1105A O`;
const GDS_EXPECTED = EXPECTED.replace(/ C /g, " O ").replace(/236C/, "236O").replace(/927C/, "927O");

let pass = 0, fail = 0;
function check(name, text, expected) {
  const out = E.renderItinerary(E.parse(text)[0]);
  if (out === expected) { pass++; console.log("PASS", name); return; }
  fail++;
  console.log("FAIL", name);
  const a = out.split("\n"), b = expected.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (a[i] !== b[i]) console.log("  line " + i + "\n   got:  " + JSON.stringify(a[i]) + "\n   want: " + JSON.stringify(b[i]));
}

for (const [name, text] of Object.entries(CASES)) check(name, text, EXPECTED);
check("GDS rows", GDS_CASE, GDS_EXPECTED);

console.log("\n=== SUMMARY: " + pass + " passed, " + fail + " failed ===");
process.exit(fail ? 1 : 0);
