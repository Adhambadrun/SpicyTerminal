"use strict";
/* test_month_airports.js — the airport codes that are also something else.
 *
 * A bigger airport table buys coverage and costs ambiguity: several real IATA
 * codes double as a month (AUG Augusta, JAN Jackson, MAR Maracaibo, MAY
 * Clarence Bain, DEC Decatur, JUL Juliaca, NOV Novo Progresso), a duration
 * (HRS Harrismith) or an airline name (JAL Jalapa / Japan Airlines, PIA Peoria
 * / Pakistan International).  Each of those collisions is pinned here in both
 * directions — the reading that must change and the reading that must not.
 *
 * Getting it wrong is not cosmetic: reading a route's own airport as a date
 * moves the flight to the wrong airport, and reading a date's month as an
 * airport invents a leg the passenger is not flying.
 */
const assert = require("assert");
const E = require("./spicy_engine.js");
const D = require("./spicy_data.js");

let PASS = 0, FAIL = 0;
function check(name, fn) {
  try { fn(); PASS++; console.log("PASS:", name); }
  catch (error) { FAIL++; console.error("FAIL:", name, "\n   ", error.message); }
}
/* "AA|100|02DEC|JFK|LHR" — one string per segment, fields separated so a
   missing airport cannot hide behind whitespace. */
function parseOne(text) {
  const [segs] = E.parse(text);
  return segs.map(s => [s.airline, s.flight_no, s.date_ddmmm, s.orig, s.dest].join("|"));
}

/* ---------- the collision is real, so the test earns its place ---------- */
check("month codes that are also airports are in the shipped table", () => {
  const collisions = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]
    .filter(code => !!D.airports[code]);
  assert(collisions.length >= 5, "expected several month codes to be airports, found " + collisions.join(","));
  ["AUG","JAN","MAR","DEC","JUL","NOV","MAY"].forEach(code => {
    assert(!!D.airports[code], code + " should be in the airport table");
  });
  assert(!!D.airports.HRS, "HRS (Harrismith) should be in the airport table");
});

/* ---------- a date's month is not an airport ---------- */
check("a month written as a date is not read as an airport", () => {
  assert.deepStrictEqual(parseOne("AA 100 DEC 2 JFK to LHR 7:00 PM to 7:00 AM"),
    ["AA|100|02DEC|JFK|LHR"], "DEC 2 must not anchor a route on Decatur");
  assert.deepStrictEqual(parseOne("1 AA 100 2 AUG JFK LHR 700P 700A"),
    ["AA|100|02AUG|JFK|LHR"], "2 AUG must not anchor a route on Augusta");
  assert.deepStrictEqual(parseOne("1 AA 100 15 DEC JFK LHR 700P 700A"),
    ["AA|100|15DEC|JFK|LHR"], "15 DEC must not anchor a route on Decatur");
  assert.deepStrictEqual(parseOne("1 AA 100 02AUG JFK LHR 700P 700A"),
    ["AA|100|02AUG|JFK|LHR"], "the glued form 02AUG is a date, not a route");
  assert.deepStrictEqual(parseOne("DL 5 AF 3 hrs"),
    ["DL|5|||"], "a real duration keeps the row but invents no route");
});

/* ---------- a route's airport is not a date ---------- */
check("an airport standing in a route is not read as a month", () => {
  assert.deepStrictEqual(parseOne("2 AUG to AVB on Dec 1\n4:37 PM to 10:14 PM (5h 37m)\nOV 8675\nBusiness (J)"),
    ["OV|8675|01DEC|AUG|AVB"], "row 2, Augusta to Al Baha, dated 1 December");
  assert.deepStrictEqual(parseOne("1 MAR to JFK on Dec 1\n1:00 PM to 3:00 PM\nAA 100"),
    ["AA|100|01DEC|MAR|JFK"], "Maracaibo to New York, dated 1 December");
  assert.deepStrictEqual(parseOne("1 DEC to JFK on Dec 1\n1:00 PM to 3:00 PM\nAA 100"),
    ["AA|100|01DEC|DEC|JFK"], "Decatur to New York, dated 1 December");
  assert.deepStrictEqual(parseOne("1 AA 100 15 DEC to JFK 100P 300P"),
    ["AA|100|15DEC|DEC|JFK"], "a date on the same line as a route leaves the airport alone");
});

/* ---------- the ordinary readings survive ---------- */
check("GDS rows, dates with years and airports on their own keep their reading", () => {
  assert.deepStrictEqual(parseOne("1 LH 728 W 26NOV DEB HQQ 226P 414P"),
    ["LH|728|26NOV|DEB|HQQ"], "26NOV is a date and DEB-HQQ is the route");
  assert.deepStrictEqual(parseOne("1 AA 100 2 AUG 2026 JFK LHR 700P 700A"),
    ["AA|100|02AUG|JFK|LHR"], "a date with a year is still a date");
  assert.deepStrictEqual(parseOne("1 AA 100 15JAN AUG JFK 700P 700A"),
    ["AA|100|15JAN|AUG|JFK"], "15JAN is the date; AUG is the origin airport");
  assert.deepStrictEqual(parseOne("AA 100 JFK LHR 700P 700A 02DEC"),
    ["AA|100|02DEC|JFK|LHR"], "a trailing date still belongs to the row");
});

/* ---------- one token, two readings, same line ---------- */
check("a date and an airport that share a month token are told apart on one line", () => {
  assert.deepStrictEqual(parseOne("1 AA 100 2 DEC DEC JFK 700P 700A"),
    ["AA|100|02DEC|DEC|JFK"], "the first DEC is the date, the second is Decatur");
});

/* ---------- an airport code that reads as a duration ---------------------- */
check("an airport code that reads as a duration keeps its route", () => {
  // HRS (Harrismith) also spells "hrs". The duration guard used to swallow the
  // whole row and print nothing.
  assert.deepStrictEqual(parseOne("UA 6447 HRS-DPS"), ["UA|6447||HRS|DPS"]);
  assert.deepStrictEqual(parseOne("Flight UA 6447 HRS-DPS 12DEC 7:15 AM - 11:30 AM A350-900"),
    ["UA|6447|12DEC|HRS|DPS"]);
});

/* ---------- airline names that are also airports -------------------------- */
check("a route destination is not read as an airline name", () => {
  // JAL resolves to Japan Airlines; PIA to Pakistan International. Both are
  // real airports, and "BWH to JAL" is Butterworth to Jalapa — the old reading
  // printed an invented "JL 14 14SEP BWH JAL" leg beside the real row.
  assert.deepStrictEqual(parseOne("DY 8076 BWH to JAL\n14 September\n11:45 PM to 6:30 AM+1\nAirbus A350-900 · Economy (K)"),
    ["DY|8076|14SEP|BWH|JAL"]);
  assert.deepStrictEqual(parseOne("UO 8666 BLL to PIA\n14 September\n11:45 PM to 6:30 AM+1\nAirbus A350-900 · Economy (K)"),
    ["UO|8666|14SEP|BLL|PIA"]);
});

check("an airline name in front of a flight number is still the airline", () => {
  assert.deepStrictEqual(parseOne("1 JAL 14 14SEP JFK NRT 1145A 630P+1 K 359"),
    ["JL|14|14SEP|JFK|NRT"], "JAL 14 is flight 14, and JFK-NRT is the route");
  // a clock after the airport keeps the airport reading ("JAL 1015P")
  assert.deepStrictEqual(parseOne("1 AA 100 JFK JAL 1015P 115P"),
    ["AA|100||JFK|JAL"]);
});

console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
if (FAIL > 0) process.exit(1);
