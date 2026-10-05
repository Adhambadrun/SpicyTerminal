"use strict";

/* Focused safety/contract tests for the local-only Seat Map preview. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const SeatMap = require("./seatmap.js");
const ROOT = __dirname;
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
  const expected = { "738": 198, "320": 186, "77W": 523 };
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

test("route notice discloses development status and simulated seat availability", () => {
  assert(/Seat Map is still under development/i.test(template));
  assert(/simulated seat availability/i.test(template));
  assert(/not live airline data/i.test(template));
  assert(/role="dialog" aria-modal="true" aria-labelledby="seatmapNoticeTitle"/.test(template));
  assert(template.includes("CONTINUE TO SAMPLE VIEWER"));
  assert(!/fetch\s*\(/i.test(source), "the local viewer should not call a remote data service");
});

test("static build emits the same self-contained page at /seatmap", () => {
  assert(built.includes('id="seatmapPage"'));
  assert(built.includes("SEAT MAP VIEWER"));
  assert(publicRoute.includes("Seat Map is still under development"));
  assert.strictEqual(publicRoute, publicIndex);
  assert.strictEqual(publicRoute, built);
  assert(!built.includes("__SEATMAP_JS__") && !built.includes("__SEATMAP_CSS__"));
});

test("Vercel and Netlify map the /seatmap URL to the generated route", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  const netlify = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
  assert(vercel.rewrites.some(rule => rule.source === "/seatmap" && rule.destination === "/seatmap.html"));
  assert(/from\s*=\s*"\/seatmap"[\s\S]*to\s*=\s*"\/seatmap\.html"[\s\S]*status\s*=\s*200/.test(netlify));
});

console.log("\nSeat Map checks: " + checks + " passed.");
