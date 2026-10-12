"use strict";

/* Focused safety/contract tests for the local-only Seat Map preview. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = __dirname;
/* The page carries SPICY_DATA as a page-level const; under Node it is handed
   to the viewer the same way, so airport/airline names resolve identically. */
global.SPICY_DATA = JSON.parse(
  /const SPICY_DATA = (\{.*\});/s.exec(fs.readFileSync(path.join(ROOT, "spicy_data.js"), "utf8"))[1]
);
const SeatMap = require("./seatmap.js");
const source = fs.readFileSync(path.join(ROOT, "seatmap.js"), "utf8");
const template = fs.readFileSync(path.join(ROOT, "index_template.html"), "utf8");
const built = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const publicIndex = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
const publicRoute = fs.readFileSync(path.join(ROOT, "public", "seatmap.html"), "utf8");

let checks = 0;
function test(name, callback) {
  try {
    callback();
    checks++;
    console.log("PASS:", name);
  } catch (error) {
    console.error("FAIL:", name);
    throw error;
  }
}

const input = {
  flightNumber: "as 100",
  origin: "sea",
  destination: "lax",
  date: "2026-10-12",
  aircraftCode: "738"
};
const map = SeatMap.createDemoSeatMap(input, 0);

 test("input is normalized and all user-facing source labels are explicitly simulated", () => {
  assert.strictEqual(map.flightNumber, "AS100");
  assert.strictEqual(map.origin, "SEA");
  assert.strictEqual(map.destination, "LAX");
  assert.strictEqual(map.source, "SIMULATED SAMPLE DATA");
  assert.strictEqual(map.aircraftName, "Boeing 737-800");
});

test("sample layouts produce stable seat counts and unique seat IDs", () => {
  const expected = { "738": 160, "320": 162, "77W": 390 };
  Object.keys(expected).forEach(code => {
    const result = SeatMap.createDemoSeatMap({ ...input, aircraftCode: code }, 0);
    const seats = SeatMap.flattenSeats(result);
    assert.strictEqual(seats.length, expected[code]);
    assert.strictEqual(new Set(seats.map(seat => seat.id)).size, seats.length);
    assert.strictEqual(SeatMap.countStatuses(result).total, expected[code]);
  });
});

test("same sample inputs and refresh counter generate the same statuses", () => {
  const second = SeatMap.createDemoSeatMap(input, 0);
  assert.deepStrictEqual(
    SeatMap.flattenSeats(map).map(seat => [seat.id, seat.status]),
    SeatMap.flattenSeats(second).map(seat => [seat.id, seat.status])
  );
});

test("the 30-second demo refresh changes sample statuses without changing seats", () => {
  const refreshed = SeatMap.createDemoSeatMap(input, 1);
  const firstSeats = SeatMap.flattenSeats(map);
  const nextSeats = SeatMap.flattenSeats(refreshed);
  assert.deepStrictEqual(firstSeats.map(seat => seat.id), nextSeats.map(seat => seat.id));
  assert(firstSeats.some((seat, index) => seat.status !== nextSeats[index].status));
  assert.strictEqual(refreshed.source, "SIMULATED SAMPLE DATA");
});

test("availability totals include premium, extra-legroom, and exit-row sample seats", () => {
  const counts = SeatMap.countStatuses(map);
  assert.strictEqual(counts.total, counts.available + counts.occupied + counts.blocked + counts.premium + counts.extra_legroom + counts.exit_row);
  assert.strictEqual(counts.selectable, SeatMap.filterSeats(map, { availableOnly: true }).length);
  assert(counts.selectable >= counts.available);
  assert.strictEqual(SeatMap.AVAILABLE_STATUSES.includes("premium"), true);
  assert.strictEqual(SeatMap.AVAILABLE_STATUSES.includes("extra_legroom"), true);
  assert.strictEqual(SeatMap.AVAILABLE_STATUSES.includes("exit_row"), true);
});

test("filters compose and never mutate the sample map", () => {
  const before = JSON.stringify(map);
  const all = SeatMap.filterSeats(map, {});
  const available = SeatMap.filterSeats(map, { availableOnly: true });
  const windows = SeatMap.filterSeats(map, { windowOnly: true });
  const exits = SeatMap.filterSeats(map, { exitOnly: true });
  const business = SeatMap.filterSeats(map, { cabin: "business" });
  assert.strictEqual(all.length, map.totalSeats);
  assert(available.length < all.length);
  assert(windows.every(seat => seat.position === "window"));
  assert(exits.every(seat => seat.isExitRow));
  assert(business.every(seat => seat.cabinCode === "business"));
  assert.strictEqual(JSON.stringify(map), before);
});

test("SVG layout coordinates are finite and seats do not overlap within a row", () => {
  const geometry = SeatMap.calculateLayout(map);
  assert(geometry.width > 0 && geometry.height > 0);
  geometry.rows.forEach(row => {
    const ordered = row.seats.slice().sort((a, b) => a.x - b.x);
    for (let i = 1; i < ordered.length; i++) {
      assert(ordered[i].x >= ordered[i - 1].x + ordered[i - 1].width);
    }
    row.seats.forEach(seat => {
      assert(Number.isFinite(seat.x) && Number.isFinite(seat.y));
      assert(seat.x >= 0 && seat.y >= 0);
    });
  });
});

test("flight, airport, date, and aircraft validation reject uncertain input", () => {
  assert.throws(() => SeatMap.normalizeFlightNumber(""), /flight number/i);
  assert.throws(() => SeatMap.normalizeFlightNumber("AS100 OR DL200"), /flight number/i);
  assert.throws(() => SeatMap.normalizeAirport("SEA/LAX", "Origin"), /three-letter/i);
  assert.throws(() => SeatMap.normalizeDate("2026-02-30"), /valid departure date/i);
  assert.throws(() => SeatMap.createDemoSeatMap({ ...input, aircraftCode: "UNKNOWN" }, 0), /sample aircraft/i);
});

test("text, CSV, and summary exports identify the simulated source", () => {
  const ascii = SeatMap.exportAscii(map);
  const csv = SeatMap.exportCsv(map);
  const summary = SeatMap.exportSummary(map);
  assert(ascii.includes("SIMULATED DATA") && ascii.includes("no airline inventory"));
  assert(csv.startsWith('"flight","origin","destination"'));
  assert(csv.includes('"simulated"'));
  assert(summary.includes("SIMULATED SAMPLE DATA — not live airline inventory"));
  assert(summary.includes("No seat was reserved or booked."));
});

test("navbar places the .linkbtn Seat Map route between Weekly Report and Report a bug", () => {
  const weekly = template.indexOf('id="btnWeeklyReport"');
  const seat = template.indexOf('id="btnSeatMap"');
  const report = template.indexOf('id="report"');
  assert(weekly >= 0 && seat > weekly && report > seat);
  assert(/<a[^>]*id="btnSeatMap"[^>]*class="linkbtn"[^>]*href="\/seatmap"/.test(template));
  assert.strictEqual((template.match(/id="btnSeatMap"/g) || []).length, 1);
});

test("route notice separates real flight data, layout tier, and simulated seats", () => {
  assert(/real flight, reference layout, simulated seats/i.test(template));
  assert(/airline-verified configuration when one has been checked/i.test(template));
  assert(/seat availability is simulated in this browser/i.test(template));
  assert(/not live airline data/i.test(template));
  assert(/selecting a seat reserves nothing/i.test(template));
  assert(/role="dialog" aria-modal="true" aria-labelledby="seatmapNoticeTitle"/.test(template));
  assert(template.includes("CONTINUE TO THE SEAT MAP"));
  assert(!/fetch\s*\(/i.test(source), "the local viewer should not call a remote data service");
});

test("static build emits the same self-contained page at /seatmap", () => {
  assert(built.includes('id="seatmapPage"'));
  assert(built.includes("SEAT MAP VIEWER"));
  assert(publicRoute.includes("real flight, reference layout, simulated seats"));
  assert.strictEqual(publicRoute, publicIndex);
  assert.strictEqual(publicRoute, built);
  assert(!built.includes("__SEATMAP_JS__") && !built.includes("__SEATMAP_CSS__") && !built.includes("__SEATMAP_LAYOUTS__"));
  assert(built.includes('id="seatmapFlightStrip"') && built.includes('id="seatmapLegs"'),
    "the real-flight strip and the leg switcher ship in the built page");
  assert(built.includes("SpicySeatMapLayouts"), "the layout registry is inlined ahead of the viewer");
});

test("Vercel and Netlify map the /seatmap URL to the generated route", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  const netlify = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
  assert(vercel.rewrites.some(rule => rule.source === "/seatmap" && rule.destination === "/seatmap.html"));
  assert(/from\s*=\s*"\/seatmap"[\s\S]*to\s*=\s*"\/seatmap\.html"[\s\S]*status\s*=\s*200/.test(netlify));
});

/* ---------- real converted flights ---------- */

const GDS_ROUTE = [
  "1 QR 704 15JAN JFK DOH 930P 520P\u00a51 I 359 12.50 6702 N",
  "DEP-JOHN F KENNEDY INTL",
  "ARR-HAMAD INTL",
  "CABIN-BUSINESS",
  "",
  "2 QR 812 16JAN DOH CMB 715A 330P I 788 8.15 2820 N",
  "DEP-HAMAD INTL",
  "ARR-BANDARANAIKE INTL",
  "CABIN-BUSINESS"
].join("\n");

const November = new Date(Date.UTC(2026, 9, 12));

test("a converted itinerary becomes seat-map legs with real flight facts", () => {
  const route = SeatMap.convertRoute(GDS_ROUTE, { now: November });
  assert.strictEqual(route.legs.length, 2);
  const first = route.legs[0];
  assert.strictEqual(first.airline, "QR");
  assert.strictEqual(first.flightNumber, "704");
  assert.strictEqual(first.origin, "JFK");
  assert.strictEqual(first.destination, "DOH");
  assert.strictEqual(first.equipment, "359");
  assert(/stated in the itinerary/.test(first.equipmentNote), "a stated type is never called inferred");
  assert.strictEqual(first.cabinCode, "business");
  assert.strictEqual(first.bookingClass, "I");
  assert.strictEqual(first.originName, "JOHN F KENNEDY INTL", "real airport names come from the data table");
  assert.strictEqual(first.airlineName, "Qatar Airways");
});

test("the GDS calendar has no year, so the year is resolved forward and disclosed", () => {
  const resolved = SeatMap.resolveFlightDate("15JAN", November);
  assert.strictEqual(resolved.iso, "2027-01-15", "a January date seen in October belongs to the next year");
  assert.strictEqual(resolved.inferredYear, true);
  const later = SeatMap.resolveFlightDate("15DEC", November);
  assert.strictEqual(later.iso, "2026-12-15", "a date still ahead stays in this year");
  assert.strictEqual(SeatMap.resolveFlightDate("nonsense", November).iso, null);
});

test("an inferred aircraft type carries its method into the seat map", () => {
  const segment = {
    airline: "AA", flight_no: "100", orig: "JFK", dest: "LHR", date_ddmmm: "15JAN",
    dep_time: "700P", arr_time: "700A", booking_class: "C", aircraft: "77W", cabin: "BUSINESS",
    warnings: ["aircraft inferred 77W (AA 100, route estimate)"]
  };
  const leg = SeatMap.legFromSegment(segment, { now: November });
  assert(/inferred \(route estimate\)/.test(leg.equipmentNote));
});

test("a real flight renders with the airline's identity and an honest tier", () => {
  const route = SeatMap.convertRoute(GDS_ROUTE, { now: November });
  const map = SeatMap.createFlightSeatMap({ ...route.legs[0], legIndex: 0, legCount: 2 }, 0);
  assert.strictEqual(map.airline, "QR");
  assert.strictEqual(map.flightNumber, "704", "the flight number is stored bare, the way the itinerary prints it after the carrier");
  assert.strictEqual(map.airline + " " + map.flightNumber, "QR 704");
  assert.strictEqual(map.aircraftName, "Airbus A350-900");
  assert.strictEqual(map.layoutTier, "type_reference");
  assert(/NOT VERIFIED FOR THIS AIRLINE/.test(map.layoutLabel), "the tier is stated, not implied");
  assert.strictEqual(map.availability, "SIMULATED");
  assert.strictEqual(map.source, "REAL FLIGHT DATA \u00b7 SIMULATED SEAT STATUS");
  assert.strictEqual(map.ticketedCabin, "business");
  assert.strictEqual(map.seatPageUrl, "https://www.qatarairways.com/");
  assert.strictEqual(map.layoutSourceName, null, "a reference layout has no airline source to name");
});

test("seats outside the ticketed cabin are marked, and the ticketed cabin is not", () => {
  const route = SeatMap.convertRoute(GDS_ROUTE, { now: November });
  const map = SeatMap.createFlightSeatMap({ ...route.legs[0], legIndex: 0, legCount: 2 }, 0);
  const seats = SeatMap.flattenSeats(map);
  const business = seats.filter(seat => seat.cabinCode === "business");
  const economy = seats.filter(seat => seat.cabinCode === "economy");
  assert(business.length > 0 && economy.length > 0);
  assert(business.every(seat => seat.outsideTicketedCabin === false));
  assert(economy.every(seat => seat.outsideTicketedCabin === true));
});

test("an unknown or freighter aircraft refuses instead of inventing a cabin", () => {
  const base = {
    airline: "AA", flightNumber: "10", origin: "JFK", destination: "LHR",
    departureDate: "2027-01-15", cabinCode: "economy", equipmentNote: "stated in the itinerary"
  };
  assert.throws(() => SeatMap.createFlightSeatMap({ ...base, equipment: "ZZZ" }, 0), /not in the local table/i);
  const freight = () => SeatMap.createFlightSeatMap({ ...base, airline: "FX", equipment: "77F" }, 0);
  assert.throws(freight, /freight/i);
  assert.throws(() => SeatMap.createFlightSeatMap({ ...base, equipment: "" }, 0), /does not state an aircraft type/i);
});

test("a cabin this reference layout does not have is disclosed, never faked", () => {
  const map = SeatMap.createFlightSeatMap({
    airline: "AA", flightNumber: "100", origin: "JFK", destination: "LHR",
    departureDate: "2027-01-15", equipment: "738", cabin: "FIRST", cabinCode: "first",
    equipmentNote: "stated in the itinerary"
  }, 0);
  assert.strictEqual(map.ticketedCabin, "first");
  const premium = SeatMap.createFlightSeatMap({
    airline: "AA", flightNumber: "100", origin: "JFK", destination: "LHR",
    departureDate: "2027-01-15", equipment: "738", cabin: "PREMIUM ECONOMY", cabinCode: "premium_economy",
    equipmentNote: "stated in the itinerary"
  }, 0);
  assert.strictEqual(premium.ticketedCabin, null);
  assert(/no Premium Economy cabin/.test(premium.cabinNote), "the missing cabin is stated out loud");
  assert.strictEqual(SeatMap.flattenSeats(premium).filter(seat => seat.outsideTicketedCabin).length, 0);
});

test("stored routes are read defensively", () => {
  const good = { getItem: () => JSON.stringify({ savedAt: 1, text: GDS_ROUTE }) };
  assert.strictEqual(SeatMap.readStoredRoute(good).text, GDS_ROUTE);
  assert.strictEqual(SeatMap.readStoredRoute({ getItem: () => "{not json" }), null);
  assert.strictEqual(SeatMap.readStoredRoute({ getItem: () => JSON.stringify({ savedAt: 1, text: "   " }) }), null);
  assert.strictEqual(SeatMap.readStoredRoute(null), null);
  const broken = { getItem() { throw new Error("blocked"); } };
  assert.strictEqual(SeatMap.readStoredRoute(broken), null);
});

test("exports still identify simulated status, real flight, and the layout tier", () => {
  const route = SeatMap.convertRoute(GDS_ROUTE, { now: November });
  const map = SeatMap.createFlightSeatMap({ ...route.legs[0], legIndex: 0, legCount: 2 }, 0);
  const ascii = SeatMap.exportAscii(map);
  const csv = SeatMap.exportCsv(map);
  const summary = SeatMap.exportSummary(map);
  assert(ascii.includes("SIMULATED DATA") && ascii.includes("no airline inventory"));
  assert(csv.startsWith('"flight","origin","destination"') && csv.includes('"simulated"'));
  assert(summary.includes("SIMULATED SAMPLE DATA — not live airline inventory"));
  assert(summary.includes("No seat was reserved or booked."));
  assert(summary.includes("QR 704") && /reference/i.test(summary), "the export names the real flight and the layout tier");
});

console.log("\nSeat Map checks: " + checks + " passed.");
