"use strict";
/* Regression for Salma Wilson's Google Flights vertical-card report (2026-09-07).

   Shape of the failure:
   - no explicit "A to B" route header; airports are listed under each clock
   - first departure date is only in the card heading: "Depart • Tue, Nov 17"
   - arrival date appears later: "Arrives Thu, Nov 19"
   - XMN was absent from the local airport data

   The old deterministic path either lost XMN entirely or picked the arrival date
   as the departure date, then the AI correction mangled routes/times further.
*/
const E = require("./spicy_engine.js");

let PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("PASS:", msg); }
  else { FAIL++; console.error("FAIL:", msg); }
}

const INPUT = [
  "Depart • Tue, Nov 17",
  "21h 30m",
  "XiamenAir",
  "XiamenAir 830",
  "Boeing 787-9 Dreamliner",
  "10:45 pm",
  "Los Angeles (LAX)",
  "15h 15m",
  "Overnight flight",
  "6:00 am",
  "Xiamen Gaoqi Intl (XMN)",
  "Arrives Thu, Nov 19",
  "Wi-Fi available",
  "2h 40m•Change planes in Xiamen (XMN)",
  "XiamenAir",
  "XiamenAir 853",
  "Boeing 737-800",
  "8:40 am",
  "Xiamen Gaoqi Intl (XMN)",
  "3h 35m",
  "11:15 am",
  "Bangkok Suvarnabhumi (BKK)"
].join("\n");

const WANT = [
  "1 MF 830 17NOV LAX XMN 1045P 600A\u00a52 Y 789 15.15 6964 N",
  "DEP-LOS ANGELES INTL",
  "ARR-XIAMEN GAOQI INTL",
  "CABIN-ECONOMY",
  "",
  "2 MF 853 19NOV XMN BKK 840A 1115A Y 738 3.35 1357 N",
  "DEP-XIAMEN GAOQI INTL",
  "ARR-SUVARNABHUMI INTL",
  "CABIN-ECONOMY",
  "",
  "<--additional-->",
  "1 MF 830Y 17NOV",
  "2 MF 853Y 19NOV"
].join("\n");

const [segs, warns] = E.parse(INPUT);
const got = E.renderItinerary(segs);
assert(got === WANT, "XiamenAir vertical Google Flights card renders exactly");
if (got !== WANT) {
  const a = got.split("\n"), b = WANT.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) console.error("  line " + i + "\n   got:  " + JSON.stringify(a[i]) + "\n   want: " + JSON.stringify(b[i]));
  }
}
assert(warns.length === 0, "no warnings emitted (got " + JSON.stringify(warns) + ")");
assert(segs.length === 2, "exactly two segments");
assert(segs[0] && segs[0].date_ddmmm === "17NOV" && segs[0].orig === "LAX" && segs[0].dest === "XMN",
  "MF 830 keeps 17NOV and route LAX-XMN");
assert(segs[0] && segs[0].dep_time === "1045P" && segs[0].arr_time === "600A" && segs[0].arr_day_shift === 2,
  "MF 830 keeps 1045P/600A with ¥2 calendar arrival marker");
assert(segs[0] && segs[0].aircraft === "789", "Boeing 787-9 Dreamliner maps to 789");
assert(segs[1] && segs[1].date_ddmmm === "19NOV" && segs[1].orig === "XMN" && segs[1].dest === "BKK",
  "MF 853 inherits connection date 19NOV and route XMN-BKK");
assert(segs[1] && segs[1].dep_time === "840A" && segs[1].arr_time === "1115A",
  "MF 853 keeps 840A/1115A");

console.log(`\n=== SUMMARY: ${PASS} passed, ${FAIL} failed ===`);
process.exit(FAIL ? 1 : 0);
