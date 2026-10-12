/* Regression for Lamar García's 2026-10-11 H4 GDS report.
 * The direct parser used to reject H4 because it is an alphanumeric IATA
 * carrier missing from the bundled airline dictionary, leaving Gemini to
 * invent aircraft/equipment details. The numbered table must parse offline,
 * preserve explicit GDS equipment and mileage, and remain safely re-pastable.
 */
const Engine = require("./spicy_engine.js");

const INPUT =
`1 H4  102 10MAY JFK OTP  150P  540A¥1 D    330  8.50  4755  N
DEP-NOT PRE-DETERMINED          ARR-NOT PRE-DETERMINED
CABIN-BUSINESS
2 H4  235 11MAY OTP TLV 1030A  100P   D    ???  2.30   987  N
DEP-NOT PRE-DETERMINED          ARR-NOT PRE-DETERMINED
CABIN-ECONOMY`;

let pass = 0, fail = 0;
function check(name, condition) {
  if (condition) { pass++; console.log("PASS:", name); }
  else { fail++; console.error("FAIL:", name); }
}

const [segments, warnings] = Engine.parse(INPUT);
check("both numbered H4 legs are read by the direct parser", segments.length === 2);
check("unknown alphanumeric carrier and flight identity are retained",
  segments.map(s => s.airline + " " + s.flight_no).join("|") === "H4 102|H4 235");
check("explicit equipment 330, duration, and mileage survive unchanged",
  segments[0] && segments[0].aircraft === "330" && segments[0].flight_time === "8.50" && segments[0].distance === "4755");
check("the second leg's provided duration and mileage survive the ??? equipment placeholder",
  segments[1] && segments[1].flight_time === "2.30" && segments[1].distance === "987");
check("the overnight marker, booking class, cabin, and route remain attached to the first leg",
  segments[0] && segments[0].date_ddmmm === "10MAY" && segments[0].orig === "JFK" &&
  segments[0].dest === "OTP" && segments[0].dep_time === "150P" &&
  segments[0].arr_time === "540A" && segments[0].arr_day_shift === 1 &&
  segments[0].booking_class === "D" && segments[0].cabin === "BUSINESS");
check("the route and cabin are read for the second leg",
  segments[1] && segments[1].date_ddmmm === "11MAY" && segments[1].orig === "OTP" &&
  segments[1].dest === "TLV" && segments[1].cabin === "ECONOMY");
check("there is no no-flight-anchor or dropped-row warning",
  !warnings.some(w => /No flight anchors|NOT read/i.test(w)));

const rendered = Engine.renderItinerary(segments);
check("the output preserves the supplied H4 equipment and distance",
  rendered.indexOf("1 H4 102 10MAY JFK OTP 150P 540A¥1 D 330 8.50 4755 N") >= 0);
check("the additional booking commands contain exactly the two H4 flights",
  /<--additional-->\n1 H4 102D 10MAY\n2 H4 235D 11MAY$/.test(rendered));
const [roundTrip, roundTripWarnings] = Engine.parse(rendered);
check("rendered H4 GDS output can be pasted again without losing either leg",
  roundTrip.length === 2 && roundTrip.map(s => s.airline + " " + s.flight_no).join("|") === "H4 102|H4 235");
check("re-pasting does not report the additional command echo as an extra flight",
  !roundTripWarnings.some(w => /NOT read|No flight anchors/i.test(w)));

console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
if (fail) process.exit(1);
