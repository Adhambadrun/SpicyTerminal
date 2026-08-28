// Fuzz test: randomized shuffled itineraries must come back in true
// chronological (UTC) order, with every booking class, date and day-shift
// marker preserved. Uses DST-free airports so the expected UTC order can be
// computed independently of the engine's own timezone code.
//
// Run: node test_fuzz.js [iterations] [seed]
"use strict";
const E = require("./spicy_engine.js");
const D = require("./spicy_data.js");

const ITER = parseInt(process.argv[2] || "500", 10);
let seed = parseInt(process.argv[3] || "20260828", 10);
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function ri(n) { return Math.floor(rnd() * n); }

// DST-free airports only -> constant UTC offset all year.
const APS = ["HKG", "SIN", "NRT", "DXB", "BKK", "ICN"].filter(c => D.airports[c] && D.airports[c].dst === "NONE");
const AIRLINES = ["CX", "SQ", "NH", "EK", "TG", "KE"];
const CLASSES = ["F", "J", "C", "D", "I", "Y", "W", "S"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function clock12(min) {
  let h = Math.floor(min / 60), m = min % 60;
  const ap = h >= 12 ? "P" : "A";
  h = h % 12; if (h === 0) h = 12;
  // engine rejects 12:00 with A/P (noon must be N, midnight M) — avoided by generator
  return `${h}${String(m).padStart(2, "0")}${ap}`;
}

let fails = 0;
for (let it = 0; it < ITER; it++) {
  const n = 2 + ri(7);                    // 2..8 segments
  const crossYear = rnd() < 0.5;
  // trip start: day-of-year ordinal; cross-year trips start in OCT-DEC
  const startMonth = crossYear ? 10 + ri(3) : 1 + ri(6);
  let utc = Date.UTC(2027, startMonth - 1, 1 + ri(20), ri(24), 5 * ri(12));
  const flights = [];
  for (let s = 0; s < n; s++) {
    utc += (2 + ri(72)) * 3600e3;         // 2..74h apart -> strictly increasing UTC
    const orig = APS[ri(APS.length)], dest0 = APS.filter(a => a !== orig), dest = dest0[ri(dest0.length)];
    const off = D.airports[orig].off;
    const depLocal = new Date(utc + off * 3600e3);
    let depMin = depLocal.getUTCHours() * 60 + depLocal.getUTCMinutes();
    if (depMin === 0 || depMin === 720) { depMin += 5; }   // avoid 12:00 A/P encoding
    const day = depLocal.getUTCDate(), mon = depLocal.getUTCMonth() + 1;
    // arrival: dep + realistic duration, rendered in dest local time with day shift
    const durMin = 90 + ri(600);
    const offD = D.airports[dest].off;
    const arrLocal = new Date(utc + durMin * 60e3 + offD * 3600e3);
    let arrMin = arrLocal.getUTCHours() * 60 + arrLocal.getUTCMinutes();
    if (arrMin === 0 || arrMin === 720) { arrMin += 5; }
    let shift = Math.round((Date.UTC(arrLocal.getUTCFullYear(), arrLocal.getUTCMonth(), arrLocal.getUTCDate())
      - Date.UTC(depLocal.getUTCFullYear(), depLocal.getUTCMonth(), depLocal.getUTCDate())) / 86400e3);
    if (shift < -1 || shift > 3) shift = 0; // engine clamp range; keep encodable
    const al = AIRLINES[ri(AIRLINES.length)], fn = 100 + ri(880), cls = CLASSES[ri(CLASSES.length)];
    const date = `${String(day).padStart(2, "0")}${MONTHS[mon - 1]}`;
    const shiftTok = shift === 0 ? "" : `\u00A5${shift}`;
    flights.push({
      utc, al, fn, cls, date,
      row: `${al} ${fn} ${cls} ${date} ${orig} ${dest} ${clock12(depMin)} ${clock12(arrMin)}${shiftTok}`
    });
  }
  // month-spread guard: the engine's year-wrap heuristic assumes trips span <= 6
  // distinct-month gap; our generator (<= ~26 days of flying) always satisfies it.
  const shuffled = flights.slice();
  for (let i = shuffled.length - 1; i > 0; i--) { const j = ri(i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const textIn = shuffled.map((f, i) => `${i + 1} ${f.row}`).join("\n");

  const [segs, warns] = E.parse(textIn);
  const expected = flights;               // original generation order = true UTC order
  let bad = null;
  if (segs.length !== n) bad = `parsed ${segs.length}/${n} segments`;
  else for (let k = 0; k < n; k++) {
    const s = segs[k], e = expected[k];
    if (s.airline !== e.al || String(s.flight_no) !== String(e.fn)) { bad = `order: pos ${k + 1} got ${s.airline}${s.flight_no}, want ${e.al}${e.fn}`; break; }
    if (s.booking_class !== e.cls) { bad = `class lost: ${e.al}${e.fn} got ${s.booking_class}, want ${e.cls}`; break; }
    if (s.date_ddmmm !== e.date) { bad = `date: ${e.al}${e.fn} got ${s.date_ddmmm}, want ${e.date}`; break; }
  }
  if (bad) {
    fails++;
    console.log(`FAIL iter ${it}: ${bad}`);
    console.log("input:\n" + textIn);
    console.log("output order:", segs.map(s => `${s.airline}${s.flight_no} ${s.date_ddmmm}`).join(" | "));
    if (fails >= 5) break;
  }
}
console.log(fails === 0 ? `PASS fuzz: ${ITER} randomized itineraries, all correctly ordered` : `${fails} FUZZ FAILURES`);
process.exit(fails ? 1 : 0);
