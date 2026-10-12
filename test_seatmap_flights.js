"use strict";
/* test_seatmap_flights.js — the Seat Map's flight lookup.
 *
 * seatmaps.com answers "which aircraft is BA 117?" against a live schedule.
 * This app has no schedule, so the lookup is layered and every answer says
 * which layer it came from. What this file pins down:
 *
 *   - a typed query is understood the way people type it (BA117, ba 117,
 *     BA 117 LHR JFK, CAI LHR, CAI to LHR) and nonsense is not guessed at;
 *   - a flight number in the local table gives its published route and type;
 *   - a number the converter has read before gives the type without a route,
 *     and is labelled that way;
 *   - beyond that it infers from the route, then from the airline's fleet,
 *     and both are labelled as inferences;
 *   - and when nothing is known it says nothing is known — no invented flight,
 *     no invented aircraft.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const Flights = require("./seatmap_flights.js");
const Layouts = require("./seatmap_layouts.js");
const DATA = require("./spicy_data.js");
const SOURCE = fs.readFileSync(path.join(ROOT, "seatmap_flights.js"), "utf8");

let PASS = 0, FAIL = 0;
function assertTrue(cond, message) {
  if (cond) { PASS++; console.log("PASS:", message); }
  else { FAIL++; console.error("FAIL:", message); }
}
function section(title) { console.log("\n=== " + title + " ==="); }

/* ---------- 1. reading what the user typed ---------- */
section("1. the query is read the way people type it");
{
  const cases = [
    ["BA117", { kind: "flight", airline: "BA", number: "117" }],
    ["ba 117", { kind: "flight", airline: "BA", number: "117" }],
    ["BA-117", { kind: "flight", airline: "BA", number: "117" }],
    ["  ms777  ", { kind: "flight", airline: "MS", number: "777" }],
    ["BA 117 LHR JFK", { kind: "flight", airline: "BA", number: "117", origin: "LHR", destination: "JFK" }],
    ["CAI LHR", { kind: "route", origin: "CAI", destination: "LHR" }],
    ["CAI-LHR", { kind: "route", origin: "CAI", destination: "LHR" }],
    ["CAI to LHR", { kind: "route", origin: "CAI", destination: "LHR" }]
  ];
  cases.forEach(([input, expected]) => {
    const parsed = Flights.parseQuery(input);
    const got = parsed && {
      kind: parsed.kind, airline: parsed.airline, number: parsed.number,
      origin: parsed.origin, destination: parsed.destination
    };
    Object.keys(expected).forEach(key => {
      assertTrue(got && got[key] === expected[key],
        JSON.stringify(input) + " reads as " + key + "=" + expected[key] + (got ? "" : " (nothing parsed)"));
    });
  });
  ["", "   ", "hello", "117", "CAI", "BA117XYZ", "!@#"].forEach(input => {
    assertTrue(Flights.parseQuery(input) === null, JSON.stringify(input) + " is refused instead of guessed");
  });
}

/* ---------- 2. the local flight table ---------- */
section("2. a flight number in the table gives its route and type");
{
  const found = Flights.find("BA", "117");
  assertTrue(!!found && found.length === 1, "BA117 is in the table");
  assertTrue(found[0].origin === "LHR" && found[0].destination === "JFK", "with its published route");
  assertTrue(found[0].equipment === "77W", "and the type usually assigned to it");
  assertTrue(Flights.find("ba", "0117") === null, "a padded number is not matched by luck");
  assertTrue(Flights.find("ZZ", "999") === null, "an unknown flight is not invented");

  const both = Flights.byRoute("LHR", "JFK");
  assertTrue(both.length >= 2, "a route search returns every flight on it");
  assertTrue(both.some(entry => entry.airline === "BA") && both.some(entry => entry.airline === "AA"),
    "in both directions of the pairing");
  assertTrue(Flights.byRoute("JFK", "LHR").length === both.length, "and from the other end too");
  assertTrue(Flights.byRoute("AAA", "BBB").length === 0, "a route nobody flies returns nothing");
}

section("3. the lookup says which layer answered");
{
  const table = Flights.lookup("BA", "117", { data: DATA });
  assertTrue(table.kind === "flight", "BA117 comes from the local table");
  assertTrue(table.equipment === "77W" && table.origin === "LHR" && table.destination === "JFK",
    "with its type and route");
  assertTrue(table.sourceLabel === "LOCAL FLIGHT TABLE", "labelled as the local table");

  /* the converter's own table: types it has read out of real itineraries */
  const converterKeys = Object.keys(DATA.flightEquipment || {});
  assertTrue(converterKeys.length > 0, "the converter carries flight numbers of its own");
  const [carrier, digits] = converterKeys[0].split("|");
  const seen = Flights.lookup(carrier, digits, { data: DATA });
  assertTrue(seen.kind === "type-only", carrier + digits + " is known by type");
  assertTrue(seen.equipment === String(DATA.flightEquipment[converterKeys[0]]).toUpperCase(),
    "and the type is the one the converter read");
  assertTrue(seen.sourceLabel === "CONVERTER'S OWN FLIGHT TABLE", "labelled as the converter's own table");
  assertTrue(seen.origin === null && seen.destination === null, "with no route claimed for it");

  /* an inference from the airline on a route */
  const routeKey = Object.keys(DATA.routeEquipment || {})[0];
  const [rCarrier, rFrom, rTo] = routeKey.split("|");
  const inferred = Flights.lookup(rCarrier, "4444", { origin: rFrom, destination: rTo, data: DATA });
  assertTrue(inferred.kind === "inferred", "an unknown number on a known route is inferred, not guessed silently");
  assertTrue(inferred.equipment === String(DATA.routeEquipment[routeKey]).toUpperCase(),
    "using the type on file for that airline and route");
  assertTrue(inferred.sourceLabel === "INFERRED FROM THIS AIRLINE ON THIS ROUTE", "and says it is an inference");

  /* an inference from the airline's fleet */
  const fleetCarrier = Object.keys(DATA.airlineEquipment || {})[0];
  const fleet = Flights.lookup(fleetCarrier, "5555", { origin: "AAA", destination: "BBB", data: DATA });
  assertTrue(fleet.kind === "inferred" || fleet.kind === "unknown", "a fleet fallback is allowed, an invention is not");
  assertTrue(fleet.kind !== "inferred" || fleet.equipment === String(DATA.airlineEquipment[fleetCarrier][0]).toUpperCase(),
    "and it is that airline's own typical type");
  assertTrue(fleet.kind !== "inferred" || /INFERRED/.test(fleet.sourceLabel), "labelled as inferred");

  const unknown = Flights.lookup("ZZ", "9999", { origin: "AAA", destination: "BBB", data: DATA });
  assertTrue(unknown.kind === "unknown" && unknown.equipment === null,
    "nothing known means nothing claimed — no aircraft is invented");
  assertTrue(unknown.sourceLabel === "NOT IN THE LOCAL TABLES", "and the page can say so");
}

section("4. a route search offers what the tables hold");
{
  const result = Flights.searchRoute("LHR", "JFK", { data: DATA });
  assertTrue(result.flights.length >= 2, "the route search finds the flights on file");
  assertTrue(result.source === "table", "and knows those came from the table");
  const empty = Flights.searchRoute("AAA", "BBB", { data: DATA });
  assertTrue(empty.flights.length === 0, "a route with nothing on file returns nothing");
  assertTrue(empty.source === "none" || empty.source === "route" || empty.source === "airline",
    "or at most an inference, never a flight");
}

/* ---------- 5. the data itself ---------- */
section("5. every entry is a flight somebody can check");
{
  assertTrue(Flights.DB_VERSION && Flights.DB_UPDATED, "the table is versioned and dated");
  assertTrue(Flights.FLIGHTS.length >= 20, "it carries a real set of flights (" + Flights.FLIGHTS.length + ")");
  const airports = DATA.airports || {};
  const airlines = DATA.airlines || {};
  Flights.FLIGHTS.forEach(entry => {
    const label = entry.airline + entry.number + " " + entry.origin + "-" + entry.destination;
    assertTrue(/^[A-Z0-9]{2}$/.test(entry.airline), label + " has a two-character airline code");
    assertTrue(/^[0-9]{1,4}$/.test(entry.number), label + " has a numeric flight number");
    assertTrue(!!airports[entry.origin] && !!airports[entry.destination], label + " uses airports the app knows");
    assertTrue(entry.origin !== entry.destination, label + " actually goes somewhere");
    assertTrue(!!Layouts.TYPE_LAYOUTS[entry.equipment], label + " names a type this page can draw (" + entry.equipment + ")");
    assertTrue(!!airlines[entry.airline], label + " uses an airline the app knows");
  });
  const numbers = Flights.FLIGHTS.map(entry => entry.airline + entry.number);
  assertTrue(new Set(numbers).size === numbers.length, "no flight number is listed twice");
}

section("6. the lookup asks nothing of the network");
assertTrue(!/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/.test(SOURCE), "it makes no network request");
assertTrue(!/api[_-]?key|secret|token/i.test(SOURCE), "and holds no credential-shaped string");
assertTrue(!/localStorage|document\.cookie/.test(SOURCE), "and stores nothing outside the page");

console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
if (FAIL > 0) process.exit(1);
