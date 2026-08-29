// Regression: BA ORD-LHR + LHR-CAI must keep distinct routes/times/aircraft.
const E = require("./spicy_engine.js");

const EXPECTED = [
  "1 BA 1543 31AUG ORD LHR 615P 805A\u00a51 R 788 7.50 3942 N",
  "DEP-CHICAGO O HARE INTL",
  "ARR-LONDON HEATHROW",
  "CABIN-BUSINESS",
  "",
  "2 BA 396 01SEP LHR CAI 1010A 520P J 32Q 5.10 2195 N",
  "DEP-LONDON HEATHROW",
  "ARR-CAIRO INTL",
  "CABIN-BUSINESS",
  "",
  "<--additional-->",
  "1 BA 1543R 31AUG",
  "2 BA 396J 01SEP"
].join("\n");

const CASES = {
  "gds rows":
`1 BA 1543 31AUG ORD LHR 615P 805A¥1 R 788 7.50 3942 N
2 BA 396 01SEP LHR CAI 1010A 520P J 32Q 5.10 2195 N
CABIN-BUSINESS`,

  "ocr LNR repaired":
`1 BA 1543 31AUG ORD LNR 615P 805A¥1 R
2 BA 396 01SEP LHR CAI 1010A 520P J
CABIN-BUSINESS`,

  "prose two legs":
`British Airways 1543 31 Aug Chicago (ORD) 6:15 PM London Heathrow (LHR) 8:05 AM +1 Business Boeing 787-8
British Airways 396 1 Sep London Heathrow (LHR) 10:10 AM Cairo (CAI) 5:20 PM Business A321neo`
};

// Distances the engine COMPUTES are WGS-84 geodesic miles (ORD-LHR 3953,
// LHR-CAI 2197).  The GDS-row case types its own distances, so it keeps the
// values from the input; the repaired-OCR and prose cases compute theirs.
const COMPUTED_EXPECTED = EXPECTED.replace(" 3942 N", " 3953 N").replace(" 2195 N", " 2197 N");
const PROSE_EXPECTED = COMPUTED_EXPECTED.replace(/ R /g, " C ").replace(/ J /g, " C ")
  .replace("1543R", "1543C").replace("396J", "396C");

let pass = 0, fail = 0;
function check(name, text, expected) {
  expected = expected || EXPECTED;
  const segs = E.parse(text)[0];
  const out = E.renderItinerary(segs);
  if (out === expected) { pass++; console.log("PASS", name); return; }
  fail++;
  console.log("FAIL", name);
  const a = out.split("\n"), b = expected.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (a[i] !== b[i]) console.log("  line " + i + "\n   got:  " + JSON.stringify(a[i]) + "\n   want: " + JSON.stringify(b[i]));
}

for (const [name, text] of Object.entries(CASES)) {
  const want = name === "gds rows" ? EXPECTED
    : name === "prose two legs" ? PROSE_EXPECTED : COMPUTED_EXPECTED;
  check(name, text, want);
}

console.log("\n=== SUMMARY: " + pass + " passed, " + fail + " failed ===");
process.exit(fail ? 1 : 0);
