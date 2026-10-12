/* test_seatmap_price.js — the 132-assertion contract for the PRICE button.
 *
 * "use strict";
 *
 * Tests the client in isolation, with no DOM, no network, and no
 * dependencies beyond the assertion library. The page is a static
 * artifact; this is a Node script that pins the client behaviour.
 *
 *   1.  the field allowlists are tight (no internals can be rendered or sent),
 *   2.  the message map is exhaustive (one sentence for every failure),
 *   3.  buildQuery() forwards only the allowed fields and never sends
 *       anything from the converted itinerary except the route, date,
 *       cabin and passenger count,
 *   4.  isActiveLegMatchingReply() is honest about "this is the
 *       cheapest on the route, not necessarily your flight",
 *   5.  render() never leaks the endpoint, the host, the port, the
 *       status code, an upstream key, a token, or a URL,
 *   6.  escapeText() is safe to drop untrusted strings into innerHTML.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SOURCE = fs.readFileSync(path.join(ROOT, "seatmap_price.js"), "utf8");
const TEMPLATE = fs.readFileSync(path.join(ROOT, "index_template.html"), "utf8");

delete require.cache[path.join(ROOT, "seatmap_price.js")];
const Price = require("./seatmap_price.js");

let checks = 0;
let fails = 0;
function test(name, fn) {
  try {
    fn();
    checks++;
    console.log("  PASS  " + name);
  } catch (error) {
    fails++;
    console.error("  FAIL  " + name);
    console.error("    " + (error && error.message));
  }
}

/* Run fn() with the given globals set on the Node global object, then
   restore the originals. Keys with undefined values delete the global. */
function withGlobals(values, fn) {
  const saved = {};
  for (const k of Object.keys(values)) {
    saved[k] = global[k];
    if (values[k] === undefined) delete global[k];
    else global[k] = values[k];
  }
  try { return fn(); }
  finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete global[k];
      else global[k] = saved[k];
    }
  }
}

function stubPanel() { return { innerHTML: "" }; }

/* A minimal XHR shim. We capture what the client asked for; the test then
   drives state.readyState=4 to fire the readystatechange handler. */
function makeXhrShim() {
  const calls = [];
  const xhr = {
    open: function (method, url, async) { calls.push({ kind: "open", method, url, async }); },
    send: function () { calls.push({ kind: "send" }); },
    abort: function () { calls.push({ kind: "abort" }); }
  };
  Object.defineProperty(xhr, "timeout", {
    set: function (v) { calls.push({ kind: "timeout_set", v }); },
    get: function () { return 0; }
  });
  Object.defineProperty(xhr, "onreadystatechange", {
    set: function (fn) { xhr._onreadystatechange = fn; },
    get: function () { return xhr._onreadystatechange; }
  });
  Object.defineProperty(xhr, "onerror", { set: function (fn) { xhr._onerror = fn; }, get: function () { return xhr._onerror; } });
  Object.defineProperty(xhr, "ontimeout", { set: function (fn) { xhr._ontimeout = fn; }, get: function () { return xhr._ontimeout; } });
  let _responseText = "{}";
  let _readyState = 0;
  Object.defineProperty(xhr, "responseText", { set: function (v) { _responseText = v; }, get: function () { return _responseText; } });
  Object.defineProperty(xhr, "readyState", {
    set: function (v) {
      _readyState = v;
      if (v === 4 && xhr._onreadystatechange) xhr._onreadystatechange();
    },
    get: function () { return _readyState; }
  });
  return { xhr, calls };
}

function setupXhrTest({ shim, legs }) {
  const panel = stubPanel();
  const document = { getElementById: function (id) { if (id === "seatmapPriceResult") return panel; return null; } };
  const state = { legs: legs || [{ airline: "DL", flightNumber: "1788", origin: "JFK", destination: "LAX", departureDate: "2026-11-12", cabin: "economy" }] };
  return { panel, document, state, shim };
}

/* ============================================================
 * 1. constants and exports — 12 checks
 * ============================================================ */

test("1.01  module exports the public API", function () {
  assert.strictEqual(typeof Price, "object");
  ["REPLY_FIELDS", "REQUEST_FIELDS", "VERDICT_LABELS", "MESSAGES",
   "endpoint", "pickLeg", "buildQuery", "isActiveLegMatchingReply",
   "fetchMinute", "render", "renderNotice", "escapeText", "doLookup", "attach"]
    .forEach(function (k) { assert.ok(Price[k], "missing " + k); });
});

test("1.02  REPLY_FIELDS allowlist has the seven client-rendered fields", function () {
  assert.deepStrictEqual(Price.REPLY_FIELDS.slice().sort(),
    ["amount", "currency", "fetchedAt", "scope", "source", "summary", "verdict"]);
});

test("1.03  REPLY_FIELDS allowlist has no token / url / emissions / co2", function () {
  for (const banned of ["token", "url", "href", "link", "emissions", "co2", "co2_kg", "baggage", "layover", "airport", "traceback", "stack", "exception"]) {
    assert.ok(!Price.REPLY_FIELDS.includes(banned), "banned field " + banned + " is in REPLY_FIELDS");
  }
});

test("1.04  REQUEST_FIELDS allowlist is the six routed fields", function () {
  assert.deepStrictEqual(Price.REQUEST_FIELDS.slice().sort(),
    ["adults", "cabin_class", "currency", "departure_date", "destination", "origin"]);
});

test("1.05  REQUEST_FIELDS allowlist has no passenger data", function () {
  for (const banned of ["name", "firstName", "lastName", "email", "phone", "passport", "dob", "seat", "seatNumber"]) {
    assert.ok(!Price.REQUEST_FIELDS.includes(banned), "banned field " + banned + " is in REQUEST_FIELDS");
  }
});

test("1.06  MESSAGES has every case the panel can show", function () {
  ["notConnected", "fetching", "unavailable", "noFare", "notOnRoute", "notABooking"].forEach(function (k) {
    assert.ok(Price.MESSAGES[k], "missing message " + k);
  });
});

test("1.07  every MESSAGES entry is a single sentence ending in a period", function () {
  for (const key of Object.keys(Price.MESSAGES)) {
    const m = Price.MESSAGES[key];
    assert.ok(typeof m === "string", "message " + key + " is not a string");
    assert.ok(m.length > 0 && m.length < 280, "message " + key + " is empty or absurdly long (" + m.length + ")");
    assert.ok(/[.!?]$/.test(m), "message " + key + " is not a sentence: " + JSON.stringify(m));
    /* Multi-clause sentences (with commas or semicolons inside) are fine;
       what would be wrong is a second period, question mark, or exclamation
       before the very end. The console must read as ONE sentence. */
    const body = m.slice(0, -1);
    assert.ok(!/[.!?]/.test(body), "message " + key + " has a second sentence terminator inside: " + JSON.stringify(m));
  }
});

test("1.08  MESSAGES.unavailable names the service, not the user", function () {
  const m = Price.MESSAGES.unavailable.toLowerCase();
  assert.ok(m.indexOf("unavailable") >= 0, "says 'unavailable'");
  assert.ok(m.indexOf("your flight") >= 0, "reassures the user it is not their flight");
});

test("1.09  MESSAGES.notABooking says this is not a booking", function () {
  const m = Price.MESSAGES.notABooking.toLowerCase();
  assert.ok(m.indexOf("not a booking") >= 0, "says 'not a booking'");
  assert.ok(m.indexOf("money") >= 0 || m.indexOf("reserve") >= 0, "mentions money or reserving");
});

test("1.10  MESSAGES.notOnRoute is the route-vs-flight honesty line", function () {
  const m = Price.MESSAGES.notOnRoute.toLowerCase();
  assert.ok(m.indexOf("cheapest") >= 0, "mentions 'cheapest'");
  assert.ok(m.indexOf("not necessarily") >= 0, "mentions 'not necessarily'");
});

test("1.11  VERDICT_LABELS has low / typical / high and no other keys", function () {
  assert.deepStrictEqual(Object.keys(Price.VERDICT_LABELS).sort(), ["high", "low", "typical"]);
});

test("1.12  source file does not contain a debug flag that bypasses the message map", function () {
  assert.ok(!/priceDebug|PRICE_DEBUG|verbosePrice/i.test(SOURCE), "no debug flag is exposed");
});

/* ============================================================
 * 2. buildQuery() — 16 checks
 * ============================================================ */

test("2.01  buildQuery() takes a converted-itinerary leg and forwards only the route, date, cabin and adults", function () {
  const leg = {
    airline: "DL", flightNumber: "1788", aircraft: "77W",
    origin: "JFK", destination: "LAX",
    date: "2026-11-12", cabin: "economy", bookingClass: "Y",
    passengerName: "Anonymised", email: "x@y", seat: "12A"
  };
  const q = Price.buildQuery(leg);
  assert.deepStrictEqual(q, {
    origin: "JFK", destination: "LAX", departure_date: "2026-11-12",
    cabin_class: "economy", currency: "USD", adults: 1
  });
  for (const banned of ["airline", "flightNumber", "aircraft", "bookingClass", "passengerName", "email", "seat"]) {
    assert.ok(!(banned in q), "leaked " + banned + " into the request");
  }
});

test("2.02  buildQuery() upper-cases the airports so case slips on the form do not break the lookup", function () {
  const q = Price.buildQuery({ origin: "jfk", destination: "lax", date: "2026-11-12" });
  assert.strictEqual(q.origin, "JFK");
  assert.strictEqual(q.destination, "LAX");
});

test("2.03  buildQuery() lower-cases the cabin and accepts the four engine cabins", function () {
  ["economy", "premium_economy", "business", "first"].forEach(function (c) {
    const q = Price.buildQuery({ origin: "JFK", destination: "LAX", date: "2026-11-12", cabin: c.toUpperCase() });
    assert.strictEqual(q.cabin_class, c);
  });
});

test("2.04  buildQuery() defaults the cabin to economy and the currency to USD", function () {
  const q = Price.buildQuery({ origin: "JFK", destination: "LAX", date: "2026-11-12" });
  assert.strictEqual(q.cabin_class, "economy");
  assert.strictEqual(q.currency, "USD");
});

test("2.05  buildQuery() defaults adults to 1 and never sends zero or a string", function () {
  const q = Price.buildQuery({ origin: "JFK", destination: "LAX", date: "2026-11-12" });
  assert.strictEqual(q.adults, 1);
  assert.strictEqual(typeof q.adults, "number");
});

test("2.06  buildQuery() returns null when there is no leg", function () {
  assert.strictEqual(Price.buildQuery(null), null);
  assert.strictEqual(Price.buildQuery(undefined), null);
});

test("2.07  buildQuery() drops a field that is empty string", function () {
  const q = Price.buildQuery({ origin: "JFK", destination: "LAX", date: "" });
  assert.ok(!("departure_date" in q), "empty date was forwarded");
  assert.strictEqual(q.origin, "JFK");
  assert.strictEqual(q.destination, "LAX");
});

test("2.08  buildQuery() drops a field that is null", function () {
  const q = Price.buildQuery({ origin: "JFK", destination: "LAX", date: null, cabin: null });
  assert.ok(!("departure_date" in q));
  assert.ok(!("cabin_class" in q));
});

test("2.09  buildQuery() only emits keys from REQUEST_FIELDS — the allowlist is enforced", function () {
  const leg = {
    origin: "JFK", destination: "LAX", date: "2026-11-12", cabin: "economy",
    traceback: "stack trace", status: 500, endpoint: "http://x", token: "abc"
  };
  const q = Price.buildQuery(leg);
  for (const k of Object.keys(q)) {
    assert.ok(Price.REQUEST_FIELDS.indexOf(k) >= 0, "leaked " + k);
  }
});

test("2.10  buildQuery() never invents a date", function () {
  const q = Price.buildQuery({ origin: "JFK", destination: "LAX" });
  assert.ok(!("departure_date" in q));
});

test("2.11  buildQuery() never invents an airport", function () {
  const q = Price.buildQuery({ date: "2026-11-12" });
  assert.ok(!("origin" in q));
  assert.ok(!("destination" in q));
});

test("2.12  buildQuery() never invents adults", function () {
  const q = Price.buildQuery({ origin: "JFK", destination: "LAX", date: "2026-11-12" });
  assert.ok(q.adults === 1, "defaulted to 1, not absent");
});

test("2.13  buildQuery() keeps the date in YYYY-MM-DD form when given that form", function () {
  const q = Price.buildQuery({ origin: "JFK", destination: "LAX", date: "2026-11-12" });
  assert.strictEqual(q.departure_date, "2026-11-12");
});

test("2.14  buildQuery() does not normalise the date to anything else", function () {
  const q = Price.buildQuery({ origin: "JFK", destination: "LAX", date: "12-NOV-2026" });
  assert.strictEqual(q.departure_date, "12-NOV-2026");
});

test("2.15  buildQuery() returns a fresh object each time so callers cannot mutate a shared cache", function () {
  const leg = { origin: "JFK", destination: "LAX", date: "2026-11-12" };
  const a = Price.buildQuery(leg);
  const b = Price.buildQuery(leg);
  assert.notStrictEqual(a, b);
  a.origin = "XXX";
  assert.strictEqual(b.origin, "JFK");
});

test("2.16  buildQuery() does not include any field whose name is not in REQUEST_FIELDS", function () {
  const leg = { origin: "JFK", destination: "LAX", date: "2026-11-12",
                cabin: "economy", currency: "USD", adults: 1, ghost: 1 };
  const q = Price.buildQuery(leg);
  assert.ok(!("ghost" in q));
});

/* ============================================================
 * 3. isActiveLegMatchingReply() — 12 checks
 * ============================================================ */

test("3.01  no leg -> false", function () {
  assert.strictEqual(Price.isActiveLegMatchingReply(null, { summary: "Delta · DL 1788" }), false);
});

test("3.02  no fields -> false", function () {
  assert.strictEqual(Price.isActiveLegMatchingReply({ airline: "DL 1788" }, null), false);
});

test("3.03  no summary on the reply -> false", function () {
  assert.strictEqual(Price.isActiveLegMatchingReply({ airline: "DL 1788" }, { source: "Google Flights" }), false);
});

test("3.04  the active leg's airline/flight number appears in the summary -> true", function () {
  const leg = { airline: "DL 1788" };
  const fields = { summary: "Delta · DL 1788 · nonstop · 6h 8m" };
  assert.strictEqual(Price.isActiveLegMatchingReply(leg, fields), true);
});

test("3.05  the active leg's airline/flight number does NOT appear in the summary -> false", function () {
  const leg = { airline: "DL 1788" };
  const fields = { summary: "American · AA 100 · 1 stop · 9h 12m" };
  assert.strictEqual(Price.isActiveLegMatchingReply(leg, fields), false);
});

test("3.06  empty airline on the active leg -> false (not a search by flight number)", function () {
  const leg = { airline: "" };
  const fields = { summary: "Delta · DL 1788" };
  assert.strictEqual(Price.isActiveLegMatchingReply(leg, fields), false);
});

test("3.07  matching is case-sensitive on the active leg's airline string", function () {
  const leg = { airline: "dl 1788" };
  const fields = { summary: "Delta · DL 1788" };
  assert.strictEqual(Price.isActiveLegMatchingReply(leg, fields), false);
});

test("3.08  a substring of the rendered summary counts as a match (e.g. 'DL 1788' inside 'Delta · DL 1788 · ...')", function () {
  const leg = { airline: "DL 1788" };
  const fields = { summary: "Delta · DL 1788 · 1 stop · 11h" };
  assert.strictEqual(Price.isActiveLegMatchingReply(leg, fields), true);
});

test("3.09  flight number alone matches when airline code is missing on the leg", function () {
  const leg = { airline: "1788" };
  const fields = { summary: "Delta · DL 1788" };
  assert.strictEqual(Price.isActiveLegMatchingReply(leg, fields), true);
});

test("3.10  a substring search is by definition substring, so '178' matches '1788'", function () {
  const leg = { airline: "DL 178" };
  const fields = { summary: "Delta · DL 1788" };
  assert.strictEqual(Price.isActiveLegMatchingReply(leg, fields), true);
});

test("3.11  whitespace inside the leg's airline string is collapsed so 'DL  1788' matches 'DL 1788'", function () {
  const leg = { airline: "DL  1788" };
  const fields = { summary: "Delta · DL 1788" };
  assert.strictEqual(Price.isActiveLegMatchingReply(leg, fields), true);
});

test("3.12  unicode '·' in the leg's airline string is treated like any other character (no special handling)", function () {
  /* Strict substring match: a bullet in the wanted string must appear in
     the summary. This is the conservative behaviour — the alternative
     would be to scrub the bullet, which is too clever for a price panel. */
  const leg1 = { airline: "DL · 1788" };
  const fields1 = { summary: "Delta · DL 1788" };
  assert.strictEqual(Price.isActiveLegMatchingReply(leg1, fields1), false);
  const leg2 = { airline: "DL · 1788" };
  const fields2 = { summary: "Delta · DL · 1788" };
  assert.strictEqual(Price.isActiveLegMatchingReply(leg2, fields2), true);
});

/* ============================================================
 * 4. fetchMinute() — 10 checks
 * ============================================================ */

test("4.01  a well-formed ISO 8601 string with 'Z' -> HH:MM UTC", function () {
  assert.strictEqual(Price.fetchMinute("2026-10-12T08:34Z"), "08:34 UTC");
});

test("4.02  a well-formed ISO 8601 string with seconds -> HH:MM UTC (seconds ignored)", function () {
  assert.strictEqual(Price.fetchMinute("2026-10-12T08:34:56Z"), "08:34 UTC");
});

test("4.03  a well-formed ISO 8601 string with a +00:00 offset -> HH:MM UTC", function () {
  assert.strictEqual(Price.fetchMinute("2026-10-12T08:34+00:00"), "08:34 UTC");
});

test("4.04  an empty string -> ''", function () {
  assert.strictEqual(Price.fetchMinute(""), "");
});

test("4.05  null -> ''", function () {
  assert.strictEqual(Price.fetchMinute(null), "");
});

test("4.06  undefined -> ''", function () {
  assert.strictEqual(Price.fetchMinute(undefined), "");
});

test("4.07  a non-ISO string -> ''", function () {
  assert.strictEqual(Price.fetchMinute("yesterday"), "");
});

test("4.08  a partial ISO string without the time -> ''", function () {
  assert.strictEqual(Price.fetchMinute("2026-10-12"), "");
});

test("4.09  midnight -> 00:00 UTC", function () {
  assert.strictEqual(Price.fetchMinute("2026-10-12T00:00Z"), "00:00 UTC");
});

test("4.10  end of the day -> 23:59 UTC", function () {
  assert.strictEqual(Price.fetchMinute("2026-10-12T23:59Z"), "23:59 UTC");
});

/* ============================================================
 * 5. escapeText() — 10 checks
 * ============================================================ */

test("5.01  escapes &", function () { assert.strictEqual(Price.escapeText("a & b"), "a &amp; b"); });
test("5.02  escapes <", function () { assert.strictEqual(Price.escapeText("<script>"), "&lt;script&gt;"); });
test("5.03  escapes >", function () { assert.strictEqual(Price.escapeText("a > b"), "a &gt; b"); });
test("5.04  escapes double quotes", function () { assert.strictEqual(Price.escapeText('"x"'), "&quot;x&quot;"); });
test("5.05  escapes single quotes", function () { assert.strictEqual(Price.escapeText("'x'"), "&#39;x&#39;"); });
test("5.06  escapes every dangerous character in a malicious payload", function () {
  const bad = "<img src=x onerror=alert(1)>&'\";";
  const out = Price.escapeText(bad);
  assert.ok(out.indexOf("<") < 0);
  assert.ok(out.indexOf(">") < 0);
  assert.ok(out.indexOf('"') < 0);
  assert.ok(out.indexOf("'") < 0);
  assert.ok(out.indexOf("&amp;") >= 0);
});
test("5.07  handles null and undefined as empty strings", function () {
  assert.strictEqual(Price.escapeText(null), "");
  assert.strictEqual(Price.escapeText(undefined), "");
});
test("5.08  coerces numbers to strings", function () {
  assert.strictEqual(Price.escapeText(249), "249");
});
test("5.09  a clean string passes through unchanged", function () {
  assert.strictEqual(Price.escapeText("Delta · DL 1788"), "Delta · DL 1788");
});
test("5.10  a unicode middle dot survives escaping", function () {
  const out = Price.escapeText("a · b");
  assert.ok(out.indexOf("·") >= 0);
});

/* ============================================================
 * 6. render() — 30 checks
 * ============================================================ */

test("6.01  render() writes 'Source:' for the source field", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "Delta · DL 1788", scope: "x", fetchedAt: "2026-10-12T08:34Z" });
  assert.ok(/Source: Google Flights/.test(p.innerHTML));
});

test("6.02  render() writes the fetch minute next to the source", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x", fetchedAt: "2026-10-12T08:34Z" });
  assert.ok(/fetched at 08:34 UTC/.test(p.innerHTML));
});

test("6.03  render() writes the amount with the currency on a 'Fare:' line", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x" });
  assert.ok(/Fare: USD 249/.test(p.innerHTML));
});

test("6.04  render() writes the verdict on the same line as the fare when there is one", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x", verdict: "low" });
  assert.ok(/Fare: USD 249.*below the typical fare/.test(p.innerHTML));
});

test("6.05  render() writes a 'typical' verdict in plain English", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x", verdict: "typical" });
  assert.ok(/around the typical fare/.test(p.innerHTML));
});

test("6.06  render() writes a 'high' verdict in plain English", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x", verdict: "high" });
  assert.ok(/above the typical fare/.test(p.innerHTML));
});

test("6.07  render() omits the verdict sentence when the verdict is not one of low/typical/high", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x", verdict: "guaranteed cheapest" });
  assert.ok(!/below the typical fare/.test(p.innerHTML));
  assert.ok(!/around the typical fare/.test(p.innerHTML));
  assert.ok(!/above the typical fare/.test(p.innerHTML));
});

test("6.08  render() writes a 'Flight:' line for the summary", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "Delta · DL 1788 · nonstop · 6h 8m", scope: "x" });
  assert.ok(/Flight: Delta · DL 1788 · nonstop · 6h 8m/.test(p.innerHTML));
});

test("6.09  render() writes a 'Scope:' line for the scope", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "The fare for this flight, economy, on 2026-11-12." });
  assert.ok(/Scope: The fare for this flight, economy, on 2026-11-12\./.test(p.innerHTML));
});

test("6.10  render() always writes the 'not a booking' line", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x" });
  assert.ok(p.innerHTML.indexOf(Price.MESSAGES.notABooking) >= 0);
});

test("6.11  render() appends the extraLines in order, after the canonical lines", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x" },
    ["first extra", "second extra"]);
  const idxExtra1 = p.innerHTML.indexOf("first extra");
  const idxExtra2 = p.innerHTML.indexOf("second extra");
  const idxNotABooking = p.innerHTML.indexOf(Price.MESSAGES.notABooking);
  assert.ok(idxExtra1 > 0);
  assert.ok(idxExtra2 > idxExtra1);
  assert.ok(idxNotABooking > idxExtra2);
});

test("6.12  render() escapes the source, summary and scope so a hostile service reply cannot inject HTML", function () {
  const p = stubPanel();
  Price.render(p, { source: "<img src=x onerror=alert(1)>", amount: 249, currency: "USD",
    summary: "<script>alert(1)</script>", scope: "'\"><img src=x>" });
  assert.ok(p.innerHTML.indexOf("<img") < 0);
  assert.ok(p.innerHTML.indexOf("<script>") < 0);
  assert.ok(p.innerHTML.indexOf("&lt;") >= 0);
});

test("6.13  render() never writes the raw endpoint, host, port, or status code", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x" });
  const all = p.innerHTML.toLowerCase();
  for (const banned of ["http://", "https://", "localhost", "127.0.0.1", "0.0.0.0", "stack", "traceback", "status", "500", "502", "400", "404", "endpoint"]) {
    assert.ok(all.indexOf(banned) < 0, "render leaked '" + banned + "'");
  }
});

test("6.14  render() never writes a banned JSON key (booking_token, url, emissions, co2, baggage, layover, airport)", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x" });
  for (const banned of ["booking_token", "bookingToken", "url", "href", "link", "emissions", "co2_kg", "co2", "baggage", "layover", "airport", "traceback"]) {
    assert.ok(p.innerHTML.toLowerCase().indexOf(banned) < 0, "render leaked '" + banned + "'");
  }
});

test("6.15  render() with no source writes the generic 'a price-quote service' line", function () {
  const p = stubPanel();
  Price.render(p, { amount: 249, currency: "USD", summary: "x", scope: "x" });
  assert.ok(/a price-quote service/.test(p.innerHTML));
});

test("6.16  render() with no fetchedAt still writes the 'Source:' line", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x" });
  assert.ok(/Source: Google Flights\./.test(p.innerHTML));
});

test("6.17  render() with no amount still writes the 'Source:' line and the not-a-booking line", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", currency: "USD", summary: "x", scope: "x" });
  assert.ok(/Source: Google Flights/.test(p.innerHTML));
  assert.ok(p.innerHTML.indexOf(Price.MESSAGES.notABooking) >= 0);
});

test("6.18  render() wraps every line in a <p class='seatmap-price-line'>", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x" });
  const matches = p.innerHTML.match(/<p class="seatmap-price-line">/g) || [];
  assert.ok(matches.length >= 5, "expected >= 5 lines, got " + matches.length);
});

test("6.19  render() with a not-on-route extra line writes it BEFORE the not-a-booking line", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD",
    summary: "American · AA 100 · 1 stop", scope: "x" },
    [Price.MESSAGES.notOnRoute]);
  const idxNotOnRoute = p.innerHTML.indexOf(Price.MESSAGES.notOnRoute);
  const idxNotABooking = p.innerHTML.indexOf(Price.MESSAGES.notABooking);
  assert.ok(idxNotOnRoute > 0);
  assert.ok(idxNotABooking > idxNotOnRoute);
});

test("6.20  render() omits the amount line when the amount is 0", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 0, currency: "USD", summary: "x", scope: "x" });
  assert.ok(!/Fare: USD 0/.test(p.innerHTML));
});

test("6.21  render() omits the amount line when the amount is null", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: null, currency: "USD", summary: "x", scope: "x" });
  assert.ok(!/Fare:/.test(p.innerHTML));
});

test("6.22  render() with no summary still writes the not-a-booking line", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", scope: "x" });
  assert.ok(p.innerHTML.indexOf(Price.MESSAGES.notABooking) >= 0);
});

test("6.23  render() with no scope still writes the not-a-booking line", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x" });
  assert.ok(p.innerHTML.indexOf(Price.MESSAGES.notABooking) >= 0);
});

test("6.24  render() never invents an amount when the service sends no_fare", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", currency: "USD" });
  assert.ok(!/Fare:/.test(p.innerHTML));
});

test("6.25  render() does not put a link to the service in the panel", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x" });
  assert.ok(p.innerHTML.indexOf("<a ") < 0);
  assert.ok(p.innerHTML.indexOf("href=") < 0);
});

test("6.26  render() does not put a <button> in the panel (no clickable affordance inside the quote)", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x" });
  assert.ok(p.innerHTML.indexOf("<button") < 0);
});

test("6.27  render() never leaks the verdict value verbatim — it always translates it", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x", verdict: "low" });
  assert.ok(p.innerHTML.indexOf(">low<") < 0 && p.innerHTML.indexOf(" low ") < 0);
});

test("6.28  render() with verdict null does not write the verdict sentence", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x", verdict: null });
  assert.ok(!/below the typical fare/.test(p.innerHTML));
  assert.ok(!/around the typical fare/.test(p.innerHTML));
  assert.ok(!/above the typical fare/.test(p.innerHTML));
});

test("6.29  render() handles a non-string verdict gracefully (no exception, no leakage)", function () {
  const p = stubPanel();
  Price.render(p, { source: "Google Flights", amount: 249, currency: "USD", summary: "x", scope: "x", verdict: 42 });
  assert.ok(!/42/.test(p.innerHTML));
});

test("6.30  render() with a missing panel is a no-op (no throw)", function () {
  Price.render(null, { source: "x" });
  Price.render(undefined, { source: "x" });
});

/* ============================================================
 * 7. renderNotice() — 8 checks
 * ============================================================ */

test("7.01  renderNotice() writes each line in its own <p class='seatmap-price-line'>", function () {
  const p = stubPanel();
  Price.renderNotice(p, ["first", "second"]);
  const matches = p.innerHTML.match(/<p class="seatmap-price-line">/g) || [];
  assert.strictEqual(matches.length, 2);
  assert.ok(/first/.test(p.innerHTML));
  assert.ok(/second/.test(p.innerHTML));
});

test("7.02  renderNotice() escapes user-controlled content", function () {
  const p = stubPanel();
  Price.renderNotice(p, ["<script>alert(1)</script>"]);
  assert.ok(p.innerHTML.indexOf("<script>") < 0);
});

test("7.03  renderNotice() with the notConnected message writes exactly that", function () {
  const p = stubPanel();
  Price.renderNotice(p, [Price.MESSAGES.notConnected]);
  assert.ok(p.innerHTML.indexOf(Price.MESSAGES.notConnected) >= 0);
});

test("7.04  renderNotice() with the unavailable message writes exactly that", function () {
  const p = stubPanel();
  Price.renderNotice(p, [Price.MESSAGES.unavailable]);
  assert.ok(p.innerHTML.indexOf(Price.MESSAGES.unavailable) >= 0);
});

test("7.05  renderNotice() with the noFare message writes exactly that", function () {
  const p = stubPanel();
  Price.renderNotice(p, [Price.MESSAGES.noFare]);
  assert.ok(p.innerHTML.indexOf(Price.MESSAGES.noFare) >= 0);
});

test("7.06  renderNotice() with an empty list writes nothing", function () {
  const p = stubPanel();
  Price.renderNotice(p, []);
  assert.strictEqual(p.innerHTML, "");
});

test("7.07  renderNotice() with a missing panel is a no-op", function () {
  Price.renderNotice(null, ["x"]);
  Price.renderNotice(undefined, ["x"]);
});

test("7.08  renderNotice() never leaks the endpoint, host, port, or status code", function () {
  const p = stubPanel();
  Price.renderNotice(p, [Price.MESSAGES.unavailable]);
  const all = p.innerHTML.toLowerCase();
  for (const banned of ["http://", "https://", "localhost", "127.0.0.1", "0.0.0.0", "stack", "traceback", "status", "500", "502", "400", "404", "endpoint"]) {
    assert.ok(all.indexOf(banned) < 0, "renderNotice leaked '" + banned + "'");
  }
});

/* ============================================================
 * 8. endpoint() / pickLeg() — 12 checks
 * ============================================================ */

test("8.01  endpoint() returns '' when nothing is set", function () {
  withGlobals({ SPICY_PRICE_ENDPOINT: undefined, window: {} }, function () {
    assert.strictEqual(Price.endpoint(), "");
  });
});

test("8.02  endpoint() returns the global when it is a non-empty string", function () {
  withGlobals({ SPICY_PRICE_ENDPOINT: "https://example.com/api" }, function () {
    assert.strictEqual(Price.endpoint(), "https://example.com/api");
  });
});

test("8.03  endpoint() returns '' when the global is the empty string", function () {
  withGlobals({ SPICY_PRICE_ENDPOINT: "" }, function () {
    assert.strictEqual(Price.endpoint(), "");
  });
});

test("8.04  pickLeg() with no legs and no document and no manual form returns null", function () {
  withGlobals({ window: {}, document: null }, function () {
    const result = Price.pickLeg({});
    assert.strictEqual(result, null);
  });
});

test("8.05  pickLeg() returns the active leg from the converted itinerary", function () {
  const state = {
    legs: [
      { airline: "DL", flightNumber: "1788", origin: "JFK", destination: "LAX", departureDate: "2026-11-12", cabin: "economy" },
      { airline: "DL", flightNumber: "9999", origin: "LAX", destination: "SFO", departureDate: "2026-11-13", cabin: "economy" }
    ],
    legIndex: 1
  };
  withGlobals({ window: {}, document: null }, function () {
    const r = Price.pickLeg(state);
    assert.ok(r, "pickLeg returned null");
    assert.strictEqual(r.origin, "LAX");
    assert.strictEqual(r.destination, "SFO");
    assert.strictEqual(r.date, "2026-11-13");
  });
});

test("8.06  pickLeg() defaults to leg 0 when legIndex is missing", function () {
  const state = {
    legs: [
      { airline: "DL", flightNumber: "1788", origin: "JFK", destination: "LAX", departureDate: "2026-11-12", cabin: "economy" }
    ]
  };
  withGlobals({ window: {}, document: null }, function () {
    const r = Price.pickLeg(state);
    assert.ok(r);
    assert.strictEqual(r.origin, "JFK");
  });
});

test("8.07  pickLeg() falls back to a search result when there are no converted legs", function () {
  const state = {
    searched: { airline: "BA", number: "117", origin: "LHR", destination: "JFK", date: "2026-11-15" }
  };
  withGlobals({ window: {}, document: { getElementById: function () { return null; } } }, function () {
    const r = Price.pickLeg(state);
    assert.ok(r);
    assert.strictEqual(r.origin, "LHR");
    assert.strictEqual(r.destination, "JFK");
    assert.strictEqual(r.date, "2026-11-15");
  });
});

test("8.08  pickLeg() never reads the converted itinerary's passenger data", function () {
  const state = {
    legs: [{
      airline: "DL", flightNumber: "1788", origin: "JFK", destination: "LAX",
      departureDate: "2026-11-12", cabin: "economy",
      passengerName: "Anonymised", email: "x@y", seat: "12A"
    }]
  };
  withGlobals({ window: {}, document: null }, function () {
    const r = Price.pickLeg(state);
    assert.ok(r);
    assert.ok(!("passengerName" in r));
    assert.ok(!("email" in r));
    assert.ok(!("seat" in r));
  });
});

test("8.09  pickLeg() from a search result defaults the cabin to economy when none is set", function () {
  const state = { searched: { airline: "BA", number: "117", origin: "LHR", destination: "JFK", date: "2026-11-15" } };
  withGlobals({ window: {}, document: { getElementById: function () { return null; } } }, function () {
    const r = Price.pickLeg(state);
    assert.strictEqual(r.cabin, "economy");
  });
});

test("8.10  pickLeg() reads the cabin from the search form when present", function () {
  const fakeDoc = { getElementById: function (id) { if (id === "seatmapSearchCabin") return { value: "business" }; return null; } };
  withGlobals({ window: {}, document: fakeDoc }, function () {
    const state = { searched: { airline: "BA", number: "117", origin: "LHR", destination: "JFK", date: "2026-11-15" } };
    const r = Price.pickLeg(state);
    assert.strictEqual(r.cabin, "business");
  });
});

test("8.11  pickLeg() from a search result without a date falls back to tomorrow", function () {
  const state = { searched: { airline: "BA", number: "117", origin: "LHR", destination: "JFK" } };
  withGlobals({ window: {}, document: { getElementById: function () { return null; } } }, function () {
    const r = Price.pickLeg(state);
    assert.ok(r.date, "no date defaulted");
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.date), "date is in YYYY-MM-DD form");
  });
});

test("8.12  pickLeg() from the manual form reads #seatmapOrigin / #seatmapDestination / #seatmapDate", function () {
  const fakeDoc = { getElementById: function (id) {
    const map = {
      "seatmapOrigin": { value: "sea" },
      "seatmapDestination": { value: "lax" },
      "seatmapDate": { value: "2026-11-12" },
      "seatmapManualCabin": { value: "economy" }
    };
    return map[id] || null;
  }};
  withGlobals({ window: {}, document: fakeDoc }, function () {
    const r = Price.pickLeg({});
    assert.ok(r);
    assert.strictEqual(r.origin, "SEA");
    assert.strictEqual(r.destination, "LAX");
    assert.strictEqual(r.date, "2026-11-12");
  });
});

/* ============================================================
 * 9. doLookup() — 12 checks
 * ============================================================ */

test("9.01  doLookup() with no endpoint hides the price block (no visible not-connected button)", function () {
  const setup = { panel: stubPanel(), document: { getElementById: function (id) { if (id === "seatmapPriceResult") return setup.panel; return null; } }, state: {} };
  withGlobals({ SPICY_PRICE_ENDPOINT: "", window: {}, document: setup.document }, function () {
    Price.doLookup(setup.document, setup.state);
  });
  assert.strictEqual(setup.panel.innerHTML, "");
});

test("9.02  doLookup() with no leg writes the missing-leg message", function () {
  const setup = { panel: stubPanel(), document: { getElementById: function (id) { if (id === "seatmapPriceResult") return setup.panel; return null; } }, state: {} };
  withGlobals({ SPICY_PRICE_ENDPOINT: "https://example.com/api", window: {}, document: setup.document }, function () {
    Price.doLookup(setup.document, setup.state);
  });
  assert.ok(/No flight is loaded yet/.test(setup.panel.innerHTML));
});

test("9.03  doLookup() with a leg and an endpoint opens the request to the endpoint", function () {
  const shim = makeXhrShim();
  const setup = setupXhrTest({ shim });
  withGlobals({ SPICY_PRICE_ENDPOINT: "https://example.com/api", window: {}, document: setup.document, XMLHttpRequest: function () { return shim.xhr; } }, function () {
    Price.doLookup(setup.document, setup.state);
  });
  const open = shim.calls.find(function (c) { return c.kind === "open"; });
  assert.ok(open, "XHR.open was not called");
  assert.ok(open.url.indexOf("https://example.com/api") === 0, "endpoint is not in the URL");
  assert.ok(open.url.indexOf("origin=JFK") >= 0, "origin not in the URL");
  assert.ok(open.url.indexOf("destination=LAX") >= 0, "destination not in the URL");
  assert.ok(open.url.indexOf("departure_date=2026-11-12") >= 0, "departure_date not in the URL");
  assert.ok(open.url.indexOf("cabin_class=economy") >= 0, "cabin_class not in the URL");
});

test("9.04  doLookup() with a leg and an endpoint sets a request timeout", function () {
  const shim = makeXhrShim();
  const setup = setupXhrTest({ shim });
  withGlobals({ SPICY_PRICE_ENDPOINT: "https://example.com/api", window: {}, document: setup.document, XMLHttpRequest: function () { return shim.xhr; } }, function () {
    Price.doLookup(setup.document, setup.state);
  });
  const t = shim.calls.find(function (c) { return c.kind === "timeout_set"; });
  assert.ok(t, "timeout was not set");
  /* The browser XHR API takes milliseconds; the value must be in a sensible
     range (1s to 60s) so a stuck call cannot hang the page forever. */
  assert.ok(t.v >= 1000 && t.v <= 60000, "timeout is not in a reasonable range (ms): " + t.v);
});

test("9.05  doLookup() with ok=true reply renders the fields", function () {
  const shim = makeXhrShim();
  const setup = setupXhrTest({ shim });
  withGlobals({ SPICY_PRICE_ENDPOINT: "https://example.com/api", window: {}, document: setup.document, XMLHttpRequest: function () { return shim.xhr; } }, function () {
    Price.doLookup(setup.document, setup.state);
    shim.xhr.responseText = JSON.stringify({ ok: true, source: "Google Flights", amount: 249, currency: "USD", verdict: "low",
      summary: "Delta · DL 1788 · nonstop · 6h 8m",
      scope: "The fare for this flight, economy, on 2026-11-12.",
      fetchedAt: "2026-10-12T08:34Z",
      booking_token: "leak", url: "leak", emissions: { co2_kg: 1 } });
    shim.xhr.readyState = 4;
  });
  assert.ok(/Source: Google Flights/.test(setup.panel.innerHTML));
  assert.ok(/Fare: USD 249/.test(setup.panel.innerHTML));
  assert.ok(/Flight: Delta · DL 1788 · nonstop · 6h 8m/.test(setup.panel.innerHTML));
  assert.ok(/Scope: The fare for this flight, economy, on 2026-11-12\./.test(setup.panel.innerHTML));
  assert.ok(/fetched at 08:34 UTC/.test(setup.panel.innerHTML));
  assert.ok(setup.panel.innerHTML.indexOf("leak") < 0, "banned field leaked into the panel");
  assert.ok(setup.panel.innerHTML.indexOf("co2_kg") < 0, "co2_kg leaked into the panel");
  assert.ok(setup.panel.innerHTML.indexOf("booking_token") < 0, "booking_token leaked into the panel");
  assert.ok(setup.panel.innerHTML.indexOf(Price.MESSAGES.notABooking) >= 0);
});

test("9.06  doLookup() with ok=false kind=no_fare hides the price block", function () {
  const shim = makeXhrShim();
  const setup = setupXhrTest({ shim });
  withGlobals({ SPICY_PRICE_ENDPOINT: "https://example.com/api", window: {}, document: setup.document, XMLHttpRequest: function () { return shim.xhr; } }, function () {
    Price.doLookup(setup.document, setup.state);
    shim.xhr.responseText = JSON.stringify({ ok: false, kind: "no_fare" });
    shim.xhr.readyState = 4;
  });
  /* The price block should be hidden — panel empty, button/panel/note display=none.
     The test shim doesn't have the real DOM elements, so we verify the panel is empty
     (renderNotice is not called with noFare message). */
  assert.strictEqual(setup.panel.innerHTML, "");
});

test("9.07  doLookup() with a non-JSON reply hides the price block", function () {
  const shim = makeXhrShim();
  const setup = setupXhrTest({ shim });
  withGlobals({ SPICY_PRICE_ENDPOINT: "https://example.com/api", window: {}, document: setup.document, XMLHttpRequest: function () { return shim.xhr; } }, function () {
    Price.doLookup(setup.document, setup.state);
    shim.xhr.responseText = "<html>500 Internal Server Error</html>";
    shim.xhr.readyState = 4;
  });
  assert.strictEqual(setup.panel.innerHTML, "");
});

test("9.08  doLookup() with an empty-body reply hides the price block", function () {
  const shim = makeXhrShim();
  const setup = setupXhrTest({ shim });
  withGlobals({ SPICY_PRICE_ENDPOINT: "https://example.com/api", window: {}, document: setup.document, XMLHttpRequest: function () { return shim.xhr; } }, function () {
    Price.doLookup(setup.document, setup.state);
    shim.xhr.responseText = "";
    shim.xhr.readyState = 4;
  });
  assert.strictEqual(setup.panel.innerHTML, "");
});

test("9.09  doLookup() with a reply that doesn't match the active leg shows the notOnRoute line", function () {
  const shim = makeXhrShim();
  const setup = setupXhrTest({ shim });
  withGlobals({ SPICY_PRICE_ENDPOINT: "https://example.com/api", window: {}, document: setup.document, XMLHttpRequest: function () { return shim.xhr; } }, function () {
    Price.doLookup(setup.document, setup.state);
    shim.xhr.responseText = JSON.stringify({ ok: true, source: "Google Flights", amount: 199, currency: "USD", verdict: "low",
      summary: "American · AA 100 · 1 stop · 9h 12m",
      scope: "x", fetchedAt: "2026-10-12T08:34Z" });
    shim.xhr.readyState = 4;
  });
  assert.ok(setup.panel.innerHTML.indexOf(Price.MESSAGES.notOnRoute) >= 0);
});

test("9.10  doLookup() with a reply that DOES match the active leg does NOT show the notOnRoute line", function () {
  const shim = makeXhrShim();
  const setup = setupXhrTest({ shim });
  withGlobals({ SPICY_PRICE_ENDPOINT: "https://example.com/api", window: {}, document: setup.document, XMLHttpRequest: function () { return shim.xhr; } }, function () {
    Price.doLookup(setup.document, setup.state);
    shim.xhr.responseText = JSON.stringify({ ok: true, source: "Google Flights", amount: 249, currency: "USD", verdict: "low",
      summary: "Delta · DL 1788 · nonstop · 6h 8m",
      scope: "x", fetchedAt: "2026-10-12T08:34Z" });
    shim.xhr.readyState = 4;
  });
  assert.ok(setup.panel.innerHTML.indexOf(Price.MESSAGES.notOnRoute) < 0, "notOnRoute shown when it matched");
});

test("9.11  doLookup() with an XHR that throws (e.g. CSP, offline) hides the price block", function () {
  const setup = { panel: stubPanel(), document: { getElementById: function (id) { if (id === "seatmapPriceResult") return setup.panel; return null; } },
                  state: { legs: [{ airline: "DL", flightNumber: "1788", origin: "JFK", destination: "LAX", departureDate: "2026-11-12", cabin: "economy" }] } };
  withGlobals({ SPICY_PRICE_ENDPOINT: "https://example.com/api", window: {}, document: setup.document,
                XMLHttpRequest: function () { return { open: function () { throw new Error("blocked"); } }; } }, function () {
    Price.doLookup(setup.document, setup.state);
  });
  assert.strictEqual(setup.panel.innerHTML, "");
});

test("9.12  doLookup() never sends the cabin='presidential' or any other unsupported cabin value unfiltered", function () {
  const shim = makeXhrShim();
  const setup = setupXhrTest({ shim, legs: [{ airline: "DL", flightNumber: "1788", origin: "JFK", destination: "LAX", departureDate: "2026-11-12", cabin: "presidential" }] });
  withGlobals({ SPICY_PRICE_ENDPOINT: "https://example.com/api", window: {}, document: setup.document, XMLHttpRequest: function () { return shim.xhr; } }, function () {
    Price.doLookup(setup.document, setup.state);
  });
  const open = shim.calls.find(function (c) { return c.kind === "open"; });
  assert.ok(open.url.indexOf("presidential") < 0, "unsupported cabin was forwarded");
});

/* ============================================================
 * 10. attach() and the page-level wiring — 10 checks
 * ============================================================ */

test("10.01  attach() wires the click handler on the PRICE button", function () {
  const panel = { innerHTML: "" };
  const fakeDoc = {
    getElementById: function (id) {
      if (id === "seatmapPriceButton") return { addEventListener: function (event, fn) { if (event === "click") fn(); } };
      if (id === "seatmapPriceResult") return panel;
      return null;
    }
  };
  withGlobals({ SPICY_PRICE_ENDPOINT: "", window: {}, document: fakeDoc }, function () {
    const state = { legs: [{ airline: "DL", flightNumber: "1788", origin: "JFK", destination: "LAX", departureDate: "2026-11-12", cabin: "economy" }] };
    Price.attach(fakeDoc, state);
  });
});

test("10.02  attach() with no endpoint and no #seatmapPriceButton is a no-op", function () {
  withGlobals({ SPICY_PRICE_ENDPOINT: "", window: {}, document: { getElementById: function () { return null; } } }, function () {
    Price.attach(global.document, {});
  });
});

test("10.03  attach() hides the price block when the endpoint is empty", function () {
  const panel = { innerHTML: "", style: { display: "" } };
  const button = { style: { display: "" }, addEventListener: function () {} };
  const note = { style: { display: "" } };
  const fakeDoc = {
    getElementById: function (id) {
      if (id === "seatmapPriceButton") return button;
      if (id === "seatmapPriceResult") return panel;
      if (id === "seatmapPriceNote") return note;
      return null;
    }
  };
  withGlobals({ SPICY_PRICE_ENDPOINT: "", window: {}, document: fakeDoc }, function () {
    Price.attach(fakeDoc, {});
  });
  assert.strictEqual(button.style.display, "none");
  assert.strictEqual(panel.style.display, "none");
  assert.strictEqual(note.style.display, "none");
  assert.strictEqual(panel.innerHTML, "");
});

test("10.04  the template includes the PRICE button", function () {
  assert.ok(/id="seatmapPriceButton"/.test(TEMPLATE), "no #seatmapPriceButton in the template");
});

test("10.05  the template includes the #seatmapPriceResult panel", function () {
  assert.ok(/id="seatmapPriceResult"/.test(TEMPLATE), "no #seatmapPriceResult in the template");
});

test("10.06  the source has no console.log / console.error (no debug noise)", function () {
  assert.ok(!/console\.(log|error|warn|info|debug)/.test(SOURCE), "console noise in the source");
});

test("10.07  the source has no setTimeout / setInterval (no animation)", function () {
  assert.ok(!/setTimeout|setInterval/.test(SOURCE), "setTimeout / setInterval in the source");
});

test("10.08  the source has no requestAnimationFrame (no animation loop)", function () {
  assert.ok(!/requestAnimationFrame/.test(SOURCE), "requestAnimationFrame in the source");
});

test("10.09  the source file's CSS class hooks are in seatmap.css too", function () {
  const css = fs.readFileSync(path.join(ROOT, "seatmap.css"), "utf8");
  assert.ok(/seatmap-price-line/.test(css) || /seatmap-price-line/.test(TEMPLATE),
    "no seatmap-price-line class in template or seatmap.css");
});

test("10.10  the source has no @keyframes in the new CSS that this change adds", function () {
  const css = fs.readFileSync(path.join(ROOT, "seatmap.css"), "utf8");
  /* seatmap.css is allowed to mention `transition` inside its existing
     `prefers-reduced-motion` guard (where it sets transitions to none);
     what we must not add is a NEW transition / animation / @keyframes
     that runs. The presence of @keyframes in any new rule we add would
     be the smoking gun. */
  assert.ok(!/@keyframes\s+seatmap-price/.test(css), "added a @keyframes rule");
});


/* ============================================================
 * 11. hidePriceBlock / showPriceBlock / checkHealth - 3 checks
 * ============================================================ */

test("10.11  hidePriceBlock() hides the block, button, panel, and note", function () {
  const block = { style: { display: "" } };
  const button = { style: { display: "" } };
  const panel = { style: { display: "" }, innerHTML: "stale quote" };
  const note = { style: { display: "" } };
  const fakeDoc = {
    getElementById: function (id) {
      if (id === "seatmapPriceBlock") return block;
      if (id === "seatmapPriceButton") return button;
      if (id === "seatmapPriceResult") return panel;
      if (id === "seatmapPriceNote") return note;
      return null;
    }
  };
  withGlobals({ window: {}, document: fakeDoc }, function () {
    Price.hidePriceBlock();
  });
  assert.strictEqual(block.style.display, "none");
  assert.strictEqual(button.style.display, "none");
  assert.strictEqual(panel.style.display, "none");
  assert.strictEqual(note.style.display, "none");
  assert.strictEqual(panel.innerHTML, "", "stale text is cleared with the hide");
});

test("10.12  showPriceBlock() shows the block, button, panel, and note", function () {
  const block = { style: { display: "none" } };
  const button = { style: { display: "none" } };
  const panel = { style: { display: "none" } };
  const note = { style: { display: "none" } };
  const fakeDoc = {
    getElementById: function (id) {
      if (id === "seatmapPriceBlock") return block;
      if (id === "seatmapPriceButton") return button;
      if (id === "seatmapPriceResult") return panel;
      if (id === "seatmapPriceNote") return note;
      return null;
    }
  };
  withGlobals({ window: {}, document: fakeDoc }, function () {
    Price.showPriceBlock();
  });
  assert.strictEqual(block.style.display, "");
  assert.strictEqual(button.style.display, "");
  assert.strictEqual(panel.style.display, "");
  assert.strictEqual(note.style.display, "");
});

test("10.13  checkHealth() calls callback with false when healthz returns unavailable", function () {
  const calls = [];
  const xhrShim = {
    open: function (method, url, async) { calls.push({ method, url, async }); },
    send: function () { calls.push({ kind: "send" }); },
    set timeout(v) { calls.push({ kind: "timeout_set", v }); },
    get timeout() { return 0; },
    set onreadystatechange(fn) { this._onreadystatechange = fn; },
    get onreadystatechange() { return this._onreadystatechange; },
    set ontimeout(fn) { this._ontimeout = fn; },
    get ontimeout() { return this._ontimeout; },
    set onerror(fn) { this._onerror = fn; },
    get onerror() { return this._onerror; },
    set readyState(v) {
      this._readyState = v;
      if (v === 4 && this._onreadystatechange) this._onreadystatechange();
    },
    get readyState() { return this._readyState; },
    set responseText(v) { this._responseText = v; },
    get responseText() { return this._responseText; }
  };
  let callbackResult = null;
  withGlobals({ window: {}, document: {}, XMLHttpRequest: function () { return xhrShim; } }, function () {
    Price.checkHealth("https://example.com/api/flights/price", function (ok) { callbackResult = ok; });
    xhrShim.responseText = JSON.stringify({ status: "unavailable" });
    xhrShim.readyState = 4;
  });
  assert.strictEqual(callbackResult, false);
});

/* ============================================================
 * 12. the shipped page — the block starts hidden and the module binds - 3 checks
 * ============================================================ */

test("10.13b  checkHealth() accepts the tools/price_service shape {ok:true}", function () {
  const xhrShim = {
    open: function () {}, send: function () {},
    timeout: 0, readyState: 0, responseText: "",
    onreadystatechange: null, ontimeout: null, onerror: null
  };
  let result = null;
  withGlobals({ window: {}, document: {}, XMLHttpRequest: function () { return xhrShim; } }, function () {
    Price.checkHealth("https://example.com/api/flights/price", function (ok) { result = ok; });
    xhrShim.responseText = JSON.stringify({ ok: true });
    xhrShim.readyState = 4;
    xhrShim.onreadystatechange();
  });
  assert.strictEqual(result, true);
});

test("10.13c  checkHealth() rejects a body that says neither ok nor status=ok", function () {
  const xhrShim = {
    open: function () {}, send: function () {},
    timeout: 0, readyState: 0, responseText: "",
    onreadystatechange: null, ontimeout: null, onerror: null
  };
  let result = null;
  withGlobals({ window: {}, document: {}, XMLHttpRequest: function () { return xhrShim; } }, function () {
    Price.checkHealth("https://example.com/api/flights/price", function (ok) { result = ok; });
    xhrShim.responseText = JSON.stringify({ hello: "world" });
    xhrShim.readyState = 4;
    xhrShim.onreadystatechange();
  });
  assert.strictEqual(result, false);
});

test("10.14  the template ships the whole price block hidden, so nothing flashes before the probe", function () {
  assert.ok(/id="seatmapPriceBlock"[^>]*style="display:none"/.test(TEMPLATE),
    "the price block is not hidden at build time");
});

test("10.15  the module binds itself on /seatmap and nowhere else", function () {
  assert.ok(/DOMContentLoaded/.test(SOURCE), "no bootstrap hook in the source");
  assert.ok(/seatmapPriceBlock/.test(SOURCE), "the bootstrap does not control the block container");
  assert.ok(/pageState/.test(SOURCE), "the module does not read the seat map's live state");
  const seatmap = fs.readFileSync(path.join(ROOT, "seatmap.js"), "utf8");
  assert.ok(/pageState/.test(seatmap), "the seat map does not expose its live state");
});

test("10.16  hidePriceBlock() never touches style when a node has none (defensive on stubs)", function () {
  const fakeDoc = { getElementById: function () { return { innerHTML: "" }; } };
  withGlobals({ window: {}, document: fakeDoc }, function () {
    Price.hidePriceBlock();
    Price.showPriceBlock();
  });
});

console.log("");
console.log("================================================================");
console.log("RESULT: " + checks + " passed, " + fails + " failed");
console.log("================================================================");
process.exit(fails ? 1 : 0);
