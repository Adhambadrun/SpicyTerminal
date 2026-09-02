// Regression: MIA->BOG round trip on Avianca (Lamar Garcia bug report 2026-09-02).
//
// The user pasted a Google-Flights round trip whose city is spelled the way
// Colombia spells it — "Bogotá".  Every route/city pattern in the engine was
// built from ASCII-only letter classes ([A-Za-z ,.'-]), so the single accented
// letter made the OUTBOUND header invisible:
//
//   "Miami (MIA) to Bogotá (BOG)"   -> not a header (á is not in [A-Za-z])
//   "Bogotá (BOG) to Miami (MIA)"   -> IS a header (the á sits before the "(",
//                                      outside the matched city span)
//
// so AV 127 found no header of its own, fell through to the return leg's
// header, and printed with the RETURN's airports and the RETURN's date:
//
//   1 AV 126 14SEP BOG MIA ...      <- wrong order
//   2 AV 127 14SEP BOG MIA ...      <- wrong route AND wrong date (11SEP)
//
// Separately, MIA and BOG carried coordinates that were off the published
// airport reference points, so the leg printed 1506 mi where every airline,
// GDS and Great Circle Mapper publishes 1507 mi.
//
// This suite locks all of it down, plus the wider class of accented cities
// (Zürich, São Paulo, Düsseldorf, Kraków, Malmö, Medellín) and guarantees the
// fold never eats the non-ASCII characters the format actually depends on
// (the ¥ overnight marker).
const E = require("./spicy_engine.js");

let pass = 0, fail = 0;
function check(name, actual, expected) {
  if (actual === expected) { pass++; console.log("PASS", name); return; }
  fail++;
  console.log("FAIL", name);
  const a = String(actual).split("\n"), b = String(expected).split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (a[i] !== b[i])
      console.log("  line " + i + "\n   got:  " + JSON.stringify(a[i]) +
                  "\n   want: " + JSON.stringify(b[i]));
}
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, detail === undefined ? "" : "-> " + detail); }
}

/* ------------------------------------------------------------------ *
 * 1. The exact paste from the bug report                              *
 * ------------------------------------------------------------------ */
const INPUT =
`Miami (MIA) to Bogotá (BOG) on Fri, Sep 11

AV
Miami (MIA) to Bogotá (BOG)

Fri, Sep 11

AV 127 (Operated by Avianca)

2:00 PM
to4:45 PM
(3h 45m)

Airbus A320-100/200 | Business Class (F)


AV
Avianca

7:35 AM

Sep 14, 2026

12:25 PM

Sep 14, 2026

3h 50m

BOG to MIA

Bogotá (BOG) to Miami (MIA) on Mon, Sep 14

AV
Bogotá (BOG) to Miami (MIA)

Mon, Sep 14

AV 126 (Operated by Avianca)

7:35 AM
to12:25 PM
(3h 50m)

Airbus A320-100/200 | Business Class (F)`;

const EXPECTED = [
  "1 AV 127 11SEP MIA BOG 200P 445P F 320 3.45 1507 N",
  "DEP-MIAMI INTL",
  "ARR-BOGOTA EL DORADO INTL",
  "CABIN-BUSINESS",
  "",
  "2 AV 126 14SEP BOG MIA 735A 1225P F 320 3.50 1507 N",
  "DEP-BOGOTA EL DORADO INTL",
  "ARR-MIAMI INTL",
  "CABIN-BUSINESS",
  "",
  "<--additional-->",
  "1 AV 127F 11SEP",
  "2 AV 126F 14SEP"
].join("\n");

const [segs, warns] = E.parse(INPUT);
check("MIA-BOG round trip matches the reported expected output", E.renderItinerary(segs), EXPECTED);
check("no warnings emitted", JSON.stringify(warns), "[]");

// Invariants, asserted directly so a future regression names itself.
const av127 = segs.find(s => s.airline === "AV" && s.flight_no === "127");
const av126 = segs.find(s => s.airline === "AV" && s.flight_no === "126");
ok("AV 127 exists", !!av127);
ok("AV 126 exists", !!av126);
if (av127) {
  ok("AV 127 is the OUTBOUND MIA->BOG (not the return's route)",
     av127.orig === "MIA" && av127.dest === "BOG", av127.orig + "->" + av127.dest);
  ok("AV 127 keeps its own date 11SEP (not the return's 14SEP)",
     av127.date_ddmmm === "11SEP", av127.date_ddmmm);
  ok("AV 127 is segment 1 (chronological order)", av127.seg === 1, av127.seg);
}
if (av126) {
  ok("AV 126 is the RETURN BOG->MIA", av126.orig === "BOG" && av126.dest === "MIA",
     av126.orig + "->" + av126.dest);
  ok("AV 126 keeps 14SEP", av126.date_ddmmm === "14SEP", av126.date_ddmmm);
  ok("AV 126 is segment 2", av126.seg === 2, av126.seg);
}

/* ------------------------------------------------------------------ *
 * 2. Published distance                                               *
 * ------------------------------------------------------------------ */
// Great Circle Mapper / airline-published MIA-BOG is 1,507 statute miles.
ok("MIA-BOG geodesic distance is the published 1507 mi",
   E.geodesicMiles("MIA", "BOG") === 1507, E.geodesicMiles("MIA", "BOG"));
ok("distance is symmetric", E.geodesicMiles("BOG", "MIA") === E.geodesicMiles("MIA", "BOG"));

// Distances already locked by other suites must not move.
const FIXED = { "JFK|DUB": 3179, "JFK|LHR": 3452, "LAX|SFO": 337, "SFO|SGN": 7838,
                "JFK|LIS": 3367, "LIS|CPH": 1538, "MCO|MUC": 4921, "ATH|LHR": 1510 };
Object.keys(FIXED).forEach(function (k) {
  const p = k.split("|");
  ok("distance unchanged " + p[0] + "-" + p[1] + " = " + FIXED[k],
     E.geodesicMiles(p[0], p[1]) === FIXED[k], E.geodesicMiles(p[0], p[1]));
});

/* ------------------------------------------------------------------ *
 * 3. The wider class: accented city names anywhere in a route header  *
 * ------------------------------------------------------------------ */
function routeOf(text) {
  const r = E.parse(text)[0];
  return r.length ? r.map(s => s.orig + "-" + s.dest).join(",") : "(none)";
}
const ACCENTED = [
  ["Bogotá",      "Miami (MIA) to Bogotá (BOG) on Fri, Sep 11\nAV 127\n2:00 PM to 4:45 PM\nAirbus A320\nBusiness (F)", "MIA-BOG"],
  ["Zürich",      "London (LHR) to Zürich (ZRH) on Fri, Sep 11\nLX 345\n2:00 PM to 4:45 PM\nAirbus A320\nBusiness (J)", "LHR-ZRH"],
  ["São Paulo",   "Miami (MIA) to São Paulo (GRU) on Fri, Sep 11\nAA 929\n2:00 PM to 4:45 PM\nBoeing 777\nBusiness (J)", "MIA-GRU"],
  ["Düsseldorf",  "London (LHR) to Düsseldorf (DUS) on Fri, Sep 11\nBA 938\n2:00 PM to 4:45 PM\nAirbus A320\nEconomy (Y)", "LHR-DUS"],
  ["Kraków",      "London (LHR) to Kraków (KRK) on Fri, Sep 11\nBA 852\n2:00 PM to 4:45 PM\nAirbus A320\nEconomy (Y)", "LHR-KRK"],
  ["Málaga",      "London (LHR) to Málaga (AGP) on Fri, Sep 11\nBA 456\n2:00 PM to 4:45 PM\nAirbus A320\nEconomy (Y)", "LHR-AGP"],
  ["Medellín",    "Miami (MIA) to Medellín (MDE) on Fri, Sep 11\nAV 201\n2:00 PM to 4:45 PM\nAirbus A320\nBusiness (J)", "MIA-MDE"],
  ["Göteborg",    "London (LHR) to Göteborg (GOT) on Fri, Sep 11\nBA 777\n2:00 PM to 4:45 PM\nAirbus A320\nEconomy (Y)", "LHR-GOT"]
];
ACCENTED.forEach(function (t) {
  const got = routeOf(t[1]);
  ok("accented city keeps its route direction: " + t[0] + " -> " + t[2], got === t[2], got);
});

// Reversed direction must stay reversed (the header is not simply "first two codes").
check("accented return leg keeps its own direction",
      routeOf("Bogotá (BOG) to Miami (MIA) on Mon, Sep 14\nAV 126\n7:35 AM to 12:25 PM\nAirbus A320\nBusiness (F)"),
      "BOG-MIA");

/* ------------------------------------------------------------------ *
 * 4. Accented city names with NO airport code (alias lookup)          *
 * ------------------------------------------------------------------ */
check("accented city name alone still resolves via the city alias table",
      routeOf("Bogotá to Miami on Mon, Sep 14\nAV 126\n7:35 AM to 12:25 PM\nAirbus A320\nBusiness (F)"),
      "BOG-MIA");

/* ------------------------------------------------------------------ *
 * 5. Decomposed (NFD) input — macOS / some exports paste this way     *
 * ------------------------------------------------------------------ */
const NFD = INPUT.normalize("NFD");
ok("NFD input is genuinely decomposed (test is meaningful)", NFD !== INPUT);
check("decomposed 'Bogota' + combining accent parses identically",
      E.renderItinerary(E.parse(NFD)[0]), EXPECTED);

/* ------------------------------------------------------------------ *
 * 6. The fold must NOT eat meaningful non-ASCII                       *
 * ------------------------------------------------------------------ */
// ¥ is the GDS overnight marker and must survive on input AND output.
const GDS_YEN =
`1 4Y  481 13OCT MCO MUC  945P  120P¥1 D    333  9.35  4921  N
2 LH  109 14OCT MUC FRA  300P  400P   D    320   1.0   186  N`;
const yenOut = E.renderItinerary(E.parse(GDS_YEN)[0]);
ok("¥1 overnight marker survives parsing", yenOut.indexOf("120P\u00a51") >= 0, yenOut.split("\n")[0]);

// An accented city AND an overnight marker in the same paste.
const both = E.parse(
`1 AV 127 11SEP MIA BOG 200P 445P¥1 F 320 3.45 1507 N
DEP-MIAMI INTL
ARR-Bogotá EL DORADO INTL
CABIN-BUSINESS`)[0];
ok("accent + ¥ together: overnight marker kept", both.length === 1 && both[0].arr_day_shift === 1,
   both.length ? both[0].arr_day_shift : "no segment");

/* ------------------------------------------------------------------ *
 * 7. Plain ASCII input must be byte-for-byte untouched                *
 * ------------------------------------------------------------------ */
const ASCII_IN = INPUT.replace(/á/g, "a");
check("ASCII spelling produces the same output as the accented spelling",
      E.renderItinerary(E.parse(ASCII_IN)[0]), EXPECTED);

console.log("\n=== SUMMARY: " + pass + " passed, " + fail + " failed ===");
process.exit(fail ? 1 : 0);
