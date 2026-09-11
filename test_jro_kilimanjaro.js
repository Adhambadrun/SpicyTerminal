"use strict";
/* Regression for Joe Green's bug report (2026-09-10, TK IST-JRO-IST safari trip).

   Shape of the failure:
   - a GDS Black Window re-paste (or GDS-style export) with four TK legs,
     legs 2 (IST->JRO) and 3 (JRO->IST) flying to/from Kilimanjaro
   - JRO was absent from the baked airport data, so the GDS table scanner
     dropped BOTH rows at the AIRPORTS[apA]/AIRPORTS[apB] gate
   - the prose fallback then rebuilt them wrong: it borrowed leg 4's route
     (IST-AMS), left leg 2 with ARR-???, read the flight-time column
     (9.25 / 7.35) as an arrival clock (925A / 735A), lost the 7M8
     equipment, printed 0.00/0, and reset booking class D -> C
   - the mistake learner logged "no matching AI leg" for flights 2/3

   Fix: JRO joins the supplemental airport overlay (like XMN), and a
   NUMBERED GDS table row now keeps any well-formed 3-letter airport code
   it names - even one newer than the data file - with a disclosed warning,
   instead of dropping the row into the prose fallback. */
const E = require("./spicy_engine.js");

let PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("PASS:", msg); }
  else { FAIL++; console.error("FAIL:", msg); }
}

const INPUT = [
  "1 TK 1952 07JAN AMS IST 1145A  515P   D    359  3.30  1360  N",
  "DEP-NOT PRE-DETERMINED         ARR-NOT PRE-DETERMINED        ",
  "STAR",
  "CABIN-BUSINESS",
  "2 TK  563 07JAN IST JRO  730P  455A\u00a51 D    7M8  9.25  3576  N",
  "DEP-NOT PRE-DETERMINED         ARR-NOT PRE-DETERMINED        ",
  "STAR",
  "CABIN-BUSINESS",
  "3 TK  568 14JAN JRO IST  555A  130P   D    7M8  7.35  3119  N",
  "DEP-NOT PRE-DETERMINED         ARR-NOT PRE-DETERMINED        ",
  "STAR",
  "CABIN-BUSINESS",
  "4 TK 1953 14JAN IST AMS  325P  505P   D    333  3.40  1360  N",
  "DEP-NOT PRE-DETERMINED         ARR-NOT PRE-DETERMINED        ",
  "STAR",
  "CABIN-BUSINESS"
].join("\n");

const WANT = [
  "1 TK 1952 07JAN AMS IST 1145A 515P D 359 3.30 1360 N",
  "DEP-AMSTERDAM SCHIPHOL",
  "ARR-ISTANBUL AIRPORT",
  "CABIN-BUSINESS",
  "",
  "2 TK 563 07JAN IST JRO 730P 455A\u00a51 D 7M8 9.25 3576 N",
  "DEP-ISTANBUL AIRPORT",
  "ARR-KILIMANJARO INTL",
  "CABIN-BUSINESS",
  "",
  "3 TK 568 14JAN JRO IST 555A 130P D 7M8 7.35 3119 N",
  "DEP-KILIMANJARO INTL",
  "ARR-ISTANBUL AIRPORT",
  "CABIN-BUSINESS",
  "",
  "4 TK 1953 14JAN IST AMS 325P 505P D 333 3.40 1360 N",
  "DEP-ISTANBUL AIRPORT",
  "ARR-AMSTERDAM SCHIPHOL",
  "CABIN-BUSINESS",
  "",
  "<--additional-->",
  "1 TK 1952D 07JAN",
  "2 TK 563D 07JAN",
  "3 TK 568D 14JAN",
  "4 TK 1953D 14JAN"
].join("\n");

const [segs, warns] = E.parse(INPUT);
const got = E.renderItinerary(segs);
assert(got === WANT, "full TK AMS-IST-JRO-IST-AMS GDS paste renders exactly");
if (got !== WANT) {
  const a = got.split("\n"), b = WANT.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) console.error("  line " + i + "\n   got:  " + JSON.stringify(a[i]) + "\n   want: " + JSON.stringify(b[i]));
  }
}
assert(warns.length === 0, "no warnings for a fully-known itinerary (got " + JSON.stringify(warns) + ")");
assert(segs.length === 4, "all four legs read (none silently dropped)");

const s2 = segs[1], s3 = segs[2];
assert(s2.orig === "IST" && s2.dest === "JRO", "leg 2 keeps route IST-JRO (was IST-???)");
assert(s2.dep_time === "730P" && s2.arr_time === "455A" && s2.arr_day_shift === 1,
  "leg 2 keeps 730P/455A with glued \u00a51 overnight marker (flight-time 9.25 is no longer a clock)");
assert(s2.aircraft === "7M8", "leg 2 keeps Boeing 737 MAX 8 code 7M8 (was inferred 32Q)");
assert(s2.flight_time === "9.25" && s2.distance === "3576", "leg 2 keeps printed 9.25 block time and 3576 mileage");
assert(s2.booking_class === "D", "leg 2 keeps booking class D (was reset to C)");

assert(s3.orig === "JRO" && s3.dest === "IST", "leg 3 keeps route JRO-IST (was borrowed as IST-AMS)");
assert(s3.dep_time === "555A" && s3.arr_time === "130P" && s3.arr_day_shift === 0,
  "leg 3 keeps 555A/130P (flight-time 7.35 is no longer a clock)");
assert(s3.aircraft === "7M8", "leg 3 keeps 7M8");
assert(s3.flight_time === "7.35" && s3.distance === "3119", "leg 3 keeps printed 7.35 block time and 3119 mileage");
assert(s3.booking_class === "D", "leg 3 keeps booking class D");
assert(segs[0].date_ddmmm === "07JAN" && segs[3].date_ddmmm === "14JAN",
  "dates stay on their own legs");

/* Defense in depth: a numbered GDS table row naming a brand-new airport the
   data file does not know yet must still come through as a leg - keeping the
   unknown code, the printed clocks/equipment/mileage - with a disclosed
   warning, instead of being mangled by the prose fallback. */
const UNK = "1 XX 123 07JAN ZZZ JRO 1000A 1100A D 7M8 5.00 1000 N\nCABIN-BUSINESS";
const [uSegs, uWarns] = E.parse(UNK);
assert(uSegs.length === 1, "unknown-code numbered table row still produces one leg");
assert(uSegs[0] && uSegs[0].orig === "ZZZ" && uSegs[0].dest === "JRO",
  "unknown airport code is kept verbatim in its column");
assert(uSegs[0] && uSegs[0].aircraft === "7M8" && uSegs[0].flight_time === "5.00" &&
       uSegs[0].distance === "1000", "unknown-code row keeps printed equipment/block/mileage columns");
assert(/unknown airport code\(s\) ZZZ/.test(uWarns.join("; ")),
  "unknown code is disclosed in a warning (" + JSON.stringify(uWarns) + ")");

/* Without the leading segment number there is no table guarantee, so a line
   full of unknown 3-letter tokens must still be refused rather than guessed. */
const FREE = "XX 123 07JAN ZZZ QQQ 1000A 1100A D 7M8 5.00 1000 N";
const [fSegs] = E.parse(FREE);
assert(fSegs.length === 0, "un-numbered free text with unknown codes is not forced into a leg");

/* City-name alias: prose that says "Kilimanjaro" resolves to JRO. */
const PROSE = "TK 563 07JAN IST to Kilimanjaro 730P 455A\u00a51 business";
const [pSegs] = E.parse(PROSE);
assert(pSegs.length === 1 && pSegs[0].orig === "IST" && pSegs[0].dest === "JRO",
  "\"Kilimanjaro\" city mention routes to JRO (" + JSON.stringify(pSegs.map(function (s) { return s.orig + "-" + s.dest; })) + ")");

console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
process.exit(FAIL ? 1 : 0);
