// Regression: LAX->SGN via SFO on Vietnam Airlines (Lamar Garcia bug report 2026-08-30).
// The engine used to:
//   (a) pick the ARRIVAL date "Oct 3" instead of the departure date "Oct 1"
//       for VN 99 SFO->SGN;
//   (b) compute only +1 day shift instead of +2 (crossing the date line on a
//       15h40m westbound long-haul);
//   (c) hallucinate "TO 105" phantom flights in AI mode (not deterministic).
const E = require("./spicy_engine.js");

const INPUT =
`Los Angeles (LAX) to Ho Chi Minh City (SGN) on Thu, Oct 1 Warning Icon

Los Angeles (LAX) to San Francisco (SFO) on Thu, Oct 1
2:35 PM to 3:54 PM (1h 19m)
Delta 2267
Boeing 737
First (Z)
Layover in SFO (6h 56m)

San Francisco (SFO) to Ho Chi Minh City (SGN) on Thu, Oct 1
10:50 PM to 4:30 AM on Sat, Oct 3 (15h 40m)
Vietnam Airlines 99
Airbus A350
Business (D)
Ho Chi Minh City (SGN) to Los Angeles (LAX) on Sat, Oct 31 Warning Icon

Ho Chi Minh City (SGN) to San Francisco (SFO) on Sat, Oct 31
6:30 PM to 6:00 PM on Sat, Oct 31 (13h 30m)
Vietnam Airlines 98
Airbus A350
Business (I)
Layover in SFO (1h 51m)

San Francisco (SFO) to Los Angeles (LAX) on Sat, Oct 31
7:51 PM to 9:26 PM (1h 35m)
United 2409
Boeing 737
First (P)`;

const EXPECTED = [
  "1 DL 2267 01OCT LAX SFO 235P 354P Z 738 1.19 337 N",
  "DEP-LOS ANGELES INTL",
  "ARR-SAN FRANCISCO INTL",
  "CABIN-FIRST",
  "",
  "2 VN 99 01OCT SFO SGN 1050P 430A\u00a52 D 359 15.40 7838 N",
  "DEP-SAN FRANCISCO INTL",
  "ARR-TAN SON NHAT INTL",
  "CABIN-BUSINESS",
  "",
  "3 VN 98 31OCT SGN SFO 630P 600P I 359 13.30 7838 N",
  "DEP-TAN SON NHAT INTL",
  "ARR-SAN FRANCISCO INTL",
  "CABIN-BUSINESS",
  "",
  "4 UA 2409 31OCT SFO LAX 751P 926P P 738 1.35 337 N",
  "DEP-SAN FRANCISCO INTL",
  "ARR-LOS ANGELES INTL",
  "CABIN-FIRST",
  "",
  "<--additional-->",
  "1 DL 2267Z 01OCT",
  "2 VN 99D 01OCT",
  "3 VN 98I 31OCT",
  "4 UA 2409P 31OCT"
].join("\n");

let pass=0, fail=0;
function check(name, actual, expected) {
  if (actual === expected) { pass++; console.log("PASS", name); return; }
  fail++;
  console.log("FAIL", name);
  const a = actual.split("\n"), b = expected.split("\n");
  for (let i=0;i<Math.max(a.length,b.length);i++)
    if(a[i]!==b[i]) console.log("  line "+i+"\n   got:  "+JSON.stringify(a[i])+"\n   want: "+JSON.stringify(b[i]));
}

const [segs, warns] = E.parse(INPUT);
const out = E.renderItinerary(segs);
check("LAX-SGN via SFO produces 4 segments, no phantom legs", out, EXPECTED);
check("no warnings emitted", warns.length, 0);

// Also verify key invariants directly
const vn99 = segs.find(s => s.airline==="VN" && s.flight_no==="99");
if (vn99) {
  if (vn99.date_ddmmm === "01OCT") { pass++; console.log("PASS: VN 99 departs on 01OCT (not arrival date)"); }
  else { fail++; console.log("FAIL: VN 99 date is", vn99.date_ddmmm, "expected 01OCT"); }
  if (vn99.arr_day_shift === 2) { pass++; console.log("PASS: VN 99 arr_day_shift=2 (crosses date line, arrives +2 days)"); }
  else { fail++; console.log("FAIL: VN 99 arr_day_shift=", vn99.arr_day_shift, "expected 2"); }
  if (vn99.orig==="SFO" && vn99.dest==="SGN") { pass++; console.log("PASS: VN 99 route is SFO->SGN"); }
  else { fail++; console.log("FAIL: VN 99 route", vn99.orig+"->"+vn99.dest); }
} else { fail++; console.log("FAIL: VN 99 segment missing"); }

const dl2267 = segs.find(s => s.airline==="DL" && s.flight_no==="2267");
if (dl2267) {
  if (dl2267.distance==="337") { pass++; console.log("PASS: DL 2267 LAX-SFO distance is 337 mi"); }
  else { fail++; console.log("FAIL: DL 2267 distance is", dl2267.distance, "expected 337"); }
}

const ua2409 = segs.find(s => s.airline==="UA" && s.flight_no==="2409");
if (ua2409) {
  if (ua2409.orig==="SFO" && ua2409.dest==="LAX") { pass++; console.log("PASS: UA 2409 return is SFO->LAX (not reversed)"); }
  else { fail++; console.log("FAIL: UA 2409 route", ua2409.orig+"->"+ua2409.dest); }
}

console.log("\n=== SUMMARY: "+pass+" passed, "+fail+" failed ===");
process.exit(fail ? 1 : 0);
