/* test_fare_backend.js — the contract for api/flights/price + api/healthz.
 *
 * The fare backend is the one part of the PRICE feature that talks to the
 * outside world, so this suite pins the things that must never drift:
 *
 *   1.  validation — only the six routed fields, only sane values,
 *   2.  the exact wire contract — ok:true with the seven rendered fields,
 *       or {ok:false, kind:"no_fare"} / {kind:"bad_request"},
 *   3.  no live provider -> no_fare, never a remembered or estimated number,
 *   4.  a provider that errors or 500s -> no_fare, never a fake price,
 *   5.  provider offers are only ever returned fresh (fetched at call time),
 *   6.  the health probe gates the page: configured -> ok, none -> unavailable,
 *   7.  nothing internal is ever put on the wire (tokens, urls, upstream text,
 *       booking tokens, emissions, co2, baggage, layovers, airport names).
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const FARE_SOURCE = fs.readFileSync(path.join(ROOT, "api", "_fare.js"), "utf8");
const PRICE_SOURCE = fs.readFileSync(path.join(ROOT, "api", "flights", "price.js"), "utf8");
const HEALTH_SOURCE = fs.readFileSync(path.join(ROOT, "api", "healthz.js"), "utf8");

delete require.cache[path.join(ROOT, "api", "_fare.js")];
const fare = require("./api/_fare.js");

let checks = 0;
let fails = 0;
/* Tests run strictly one at a time: several swap process.env and global.fetch,
   so running them concurrently would let one test's restore clobber another's
   setup. */
let chain = Promise.resolve();
function test(name, fn) {
  chain = chain.then(function () {
    return new Promise(function (resolve) {
      const done = (error) => {
        if (error) {
          fails++;
          console.error("  FAIL  " + name);
          console.error("    " + (error && error.message));
        } else {
          checks++;
          console.log("  PASS  " + name);
        }
        resolve();
      };
      let result;
      try {
        result = fn();
      } catch (error) {
        done(error);
        return;
      }
      if (result && typeof result.then === "function") {
        result.then(() => done(null), done);
      } else {
        done(null);
      }
    });
  });
  return chain;
}

/* Run fn() with the given env vars / globals set, then restore them. */
function withEnv(values, fn) {
  const saved = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  const finish = () => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") return result.then((v) => { finish(); return v; }, (e) => { finish(); throw e; });
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}

function withFetch(impl, fn) {
  const saved = global.fetch;
  global.fetch = impl;
  const finish = () => { if (saved === undefined) delete global.fetch; else global.fetch = saved; };
  try {
    const result = fn();
    if (result && typeof result.then === "function") return result.then((v) => { finish(); return v; }, (e) => { finish(); throw e; });
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}

const NO_PROVIDERS = { AMADEUS_CLIENT_ID: undefined, AMADEUS_CLIENT_SECRET: undefined, DUFFEL_TOKEN: undefined };
const AMADEUS_ENV = { AMADEUS_CLIENT_ID: "id", AMADEUS_CLIENT_SECRET: "secret", DUFFEL_TOKEN: undefined };
const DUFFEL_ENV = { AMADEUS_CLIENT_ID: undefined, AMADEUS_CLIENT_SECRET: undefined, DUFFEL_TOKEN: "duffel_test" };

const GOOD_QUERY = {
  origin: "JFK", destination: "LAX", departure_date: "2026-11-12",
  cabin_class: "economy", currency: "USD", adults: "1"
};

const RESPONSE_FIELDS = ["source", "amount", "currency", "fetchedAt", "verdict", "summary", "scope"];

/* ============================================================
 * 1. validation — 8 checks
 * ============================================================ */

test("1.01  readRequest() accepts the six routed fields and normalises them", function () {
  const request = fare.readRequest({ origin: "jfk", destination: "lax", departure_date: "2026-11-12", cabin_class: "ECONOMY", currency: "usd", adults: "2" });
  assert.deepStrictEqual(request, {
    origin: "JFK", destination: "LAX", departure_date: "2026-11-12",
    cabin_class: "economy", currency: "USD", adults: 2
  });
});

test("1.02  readRequest() refuses a non-IATA airport", function () {
  assert.strictEqual(fare.readRequest(Object.assign({}, GOOD_QUERY, { origin: "JF" })), null);
  assert.strictEqual(fare.readRequest(Object.assign({}, GOOD_QUERY, { destination: "LAXX" })), null);
  assert.strictEqual(fare.readRequest(Object.assign({}, GOOD_QUERY, { origin: "12A" })), null);
});

test("1.03  readRequest() refuses a date that is not YYYY-MM-DD", function () {
  assert.strictEqual(fare.readRequest(Object.assign({}, GOOD_QUERY, { departure_date: "12NOV26" })), null);
  assert.strictEqual(fare.readRequest(Object.assign({}, GOOD_QUERY, { departure_date: "2026-11" })), null);
  assert.strictEqual(fare.readRequest(Object.assign({}, GOOD_QUERY, { departure_date: "" })), null);
});

test("1.04  readRequest() refuses a currency that is not a three-letter code", function () {
  assert.strictEqual(fare.readRequest(Object.assign({}, GOOD_QUERY, { currency: "DOLLARS" })), null);
  assert.strictEqual(fare.readRequest(Object.assign({}, GOOD_QUERY, { currency: "US" })), null);
});

test("1.05  readRequest() falls back to economy for an unknown cabin", function () {
  const request = fare.readRequest(Object.assign({}, GOOD_QUERY, { cabin_class: "presidential" }));
  assert.strictEqual(request.cabin_class, "economy");
});

test("1.06  readRequest() clamps adults to 1..9 and defaults to 1", function () {
  assert.strictEqual(fare.readRequest(Object.assign({}, GOOD_QUERY, { adults: "0" })).adults, 1);
  assert.strictEqual(fare.readRequest(Object.assign({}, GOOD_QUERY, { adults: "42" })).adults, 9);
  assert.strictEqual(fare.readRequest(Object.assign({}, GOOD_QUERY, { adults: "abc" })).adults, 1);
  assert.strictEqual(fare.readRequest({ origin: "JFK", destination: "LAX", departure_date: "2026-11-12" }).adults, 1);
});

test("1.07  readRequest() ignores every field that is not one of the six", function () {
  const request = fare.readRequest(Object.assign({}, GOOD_QUERY, {
    token: "leak", url: "http://leak", fare: 1, seat: "12A", passenger: "x"
  }));
  assert.deepStrictEqual(Object.keys(request).sort(),
    ["adults", "cabin_class", "currency", "departure_date", "destination", "origin"]);
});

test("1.08  verdcit bands are low / typical / high and nothing else", function () {
  assert.strictEqual(fare.verdictFor(1), "low");
  assert.strictEqual(fare.verdictFor(299), "low");
  assert.strictEqual(fare.verdictFor(300), "typical");
  assert.strictEqual(fare.verdictFor(800), "typical");
  assert.strictEqual(fare.verdictFor(801), "high");
});

/* ============================================================
 * 2. no provider -> no fare, never a number — 6 checks
 * ============================================================ */

test("2.01  lookupPrice() with no provider configured answers no_fare", async function () {
  await withEnv(NO_PROVIDERS, async () => {
    const result = await fare.lookupPrice(GOOD_QUERY);
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.body, { ok: false, kind: "no_fare" });
  });
});

test("2.02  lookupPrice() with a bad query answers 400 bad_request", async function () {
  await withEnv(NO_PROVIDERS, async () => {
    const result = await fare.lookupPrice({ origin: "XX" });
    assert.strictEqual(result.status, 400);
    assert.deepStrictEqual(result.body, { ok: false, kind: "bad_request" });
  });
});

test("2.03  the no-provider reply carries no amount at all", async function () {
  await withEnv(NO_PROVIDERS, async () => {
    const result = await fare.lookupPrice(GOOD_QUERY);
    assert.ok(!("amount" in result.body), "an amount leaked into a no_fare reply");
    assert.ok(!("source" in result.body), "a source leaked into a no_fare reply");
  });
});

test("2.04  a provider that throws answers no_fare, never a cached price", async function () {
  await withEnv(AMADEUS_ENV, () => withFetch(() => { throw new Error("network down"); }, async () => {
    const result = await fare.lookupPrice(GOOD_QUERY);
    assert.deepStrictEqual(result.body, { ok: false, kind: "no_fare" });
  }));
});

test("2.05  a provider that 500s answers no_fare", async function () {
  await withEnv(AMADEUS_ENV, () => withFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }), async () => {
    const result = await fare.lookupPrice(GOOD_QUERY);
    assert.deepStrictEqual(result.body, { ok: false, kind: "no_fare" });
  }));
});

test("2.06  a provider that returns an empty offer list answers no_fare", async function () {
  await withEnv(AMADEUS_ENV, () => withFetch(async (url) => {
    if (String(url).indexOf("oauth2/token") >= 0) {
      return { ok: true, json: async () => ({ access_token: "tok" }) };
    }
    return { ok: true, json: async () => ({ data: [] }) };
  }, async () => {
    const result = await fare.lookupPrice(GOOD_QUERY);
    assert.deepStrictEqual(result.body, { ok: false, kind: "no_fare" });
  }));
});

/* ============================================================
 * 3. a live Amadeus offer -> the exact rendered contract — 7 checks
 * ============================================================ */

function amadeusFetch(offer) {
  const offers = Array.isArray(offer) ? offer : [offer];
  return async (url) => {
    if (String(url).indexOf("oauth2/token") >= 0) {
      return { ok: true, json: async () => ({ access_token: "tok", expires_in: 1799 }) };
    }
    return { ok: true, json: async () => ({ data: offers }) };
  };
}

const AMADEUS_OFFER = {
  price: { total: "249.30", currency: "USD" },
  itineraries: [{
    segments: [{
      carrierCode: "DL", number: "1788",
      departure: { at: "2026-11-12T08:34:00" },
      arrival: { at: "2026-11-12T11:42:00" }
    }]
  }],
  booking_token: "leak", emissions: { co2_kg: 1 }, baggage: "leak", layover: "leak"
};

test("3.01  a live Amadeus offer returns ok:true and the seven rendered fields", async function () {
  await withEnv(AMADEUS_ENV, () => withFetch(amadeusFetch(AMADEUS_OFFER), async () => {
    const result = await fare.lookupPrice(GOOD_QUERY);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.ok, true);
    assert.deepStrictEqual(Object.keys(result.body).sort(), ["amount", "currency", "fetchedAt", "ok", "scope", "source", "summary", "verdict"].sort());
    for (const field of RESPONSE_FIELDS) assert.ok(field in result.body, "missing " + field);
  }));
});

test("3.02  the amount is a number and the currency is echoed back", async function () {
  await withEnv(AMADEUS_ENV, () => withFetch(amadeusFetch(AMADEUS_OFFER), async () => {
    const result = await fare.lookupPrice(GOOD_QUERY);
    assert.strictEqual(typeof result.body.amount, "number");
    assert.strictEqual(result.body.amount, 249);
    assert.strictEqual(result.body.currency, "USD");
  }));
});

test("3.03  the verdict comes from the live amount", async function () {
  await withEnv(AMADEUS_ENV, () => withFetch(amadeusFetch(AMADEUS_OFFER), async () => {
    const result = await fare.lookupPrice(GOOD_QUERY);
    assert.strictEqual(result.body.verdict, "low");
  }));
});

test("3.04  the summary names the live flight, not the one that was asked about", async function () {
  await withEnv(AMADEUS_ENV, () => withFetch(amadeusFetch(AMADEUS_OFFER), async () => {
    const result = await fare.lookupPrice(GOOD_QUERY);
    assert.ok(/DL1788/.test(result.body.summary), "summary does not name the live flight: " + result.body.summary);
    assert.ok(/nonstop/.test(result.body.summary), "summary does not state the stop count");
  }));
});

test("3.05  fetchedAt is a fresh ISO minute, not a stored one", async function () {
  await withEnv(AMADEUS_ENV, () => withFetch(amadeusFetch(AMADEUS_OFFER), async () => {
    const before = Date.now();
    const result = await fare.lookupPrice(GOOD_QUERY);
    const stamp = Date.parse(result.body.fetchedAt.replace(/Z$/, ":00Z"));
    assert.ok(Math.abs(stamp - before) < 120000, "fetchedAt is not from this call: " + result.body.fetchedAt);
  }));
});

test("3.06  the scope states cabin and date, both from the request", async function () {
  await withEnv(AMADEUS_ENV, () => withFetch(amadeusFetch(AMADEUS_OFFER), async () => {
    const result = await fare.lookupPrice(Object.assign({}, GOOD_QUERY, { cabin_class: "business" }));
    assert.ok(result.body.scope.indexOf("business") >= 0);
    assert.ok(result.body.scope.indexOf("2026-11-12") >= 0);
  }));
});

test("3.07  the cheapest live offer wins when several come back", async function () {
  const cheap = Object.assign({}, AMADEUS_OFFER, { price: { total: "199.00", currency: "USD" } });
  await withEnv(AMADEUS_ENV, () => withFetch(amadeusFetch([AMADEUS_OFFER, cheap]), async () => {
    const result = await fare.lookupPrice(GOOD_QUERY);
    assert.strictEqual(result.body.amount, 199);
  }));
});

/* ============================================================
 * 4. a live Duffel offer — 3 checks
 * ============================================================ */

const DUFFEL_OFFER = {
  total_amount: "412.00", total_currency: "USD",
  slices: [{
    segments: [{
      marketing_carrier: { iata_code: "BA", flight_number: "117" },
      departing_at: "2026-11-15T09:10:00",
      arriving_at: "2026-11-15T12:20:00"
    }]
  }]
};

test("4.01  a live Duffel offer returns ok:true with the seven rendered fields", async function () {
  await withEnv(DUFFEL_ENV, () => withFetch(async () => ({ ok: true, json: async () => ({ data: { offers: [DUFFEL_OFFER] } }) }), async () => {
    const result = await fare.lookupPrice(GOOD_QUERY);
    assert.strictEqual(result.body.ok, true);
    for (const field of RESPONSE_FIELDS) assert.ok(field in result.body, "missing " + field);
    assert.strictEqual(result.body.amount, 412);
    assert.strictEqual(result.body.source, "Duffel");
  }));
});

test("4.02  a Duffel reply without offers answers no_fare", async function () {
  await withEnv(DUFFEL_ENV, () => withFetch(async () => ({ ok: true, json: async () => ({ data: { offers: [] } }) }), async () => {
    const result = await fare.lookupPrice(GOOD_QUERY);
    assert.deepStrictEqual(result.body, { ok: false, kind: "no_fare" });
  }));
});

test("4.03  Duffel is never called when no token is configured", async function () {
  let called = 0;
  await withEnv(NO_PROVIDERS, () => withFetch(async () => { called++; return { ok: true, json: async () => ({}) }; }, async () => {
    await fare.lookupPrice(GOOD_QUERY);
  }));
  assert.strictEqual(called, 0, "a request left the building without a provider");
});

/* ============================================================
 * 5. the health probe — 5 checks
 * ============================================================ */

test("5.01  health is unavailable when nothing is configured", async function () {
  await withEnv(NO_PROVIDERS, async () => {
    const result = await fare.checkHealth();
    assert.strictEqual(result.status, 503);
    assert.deepStrictEqual(result.body, { status: "unavailable" });
  });
});

test("5.02  health is ok when Amadeus answers the token call", async function () {
  await withEnv(AMADEUS_ENV, () => withFetch(async () => ({ ok: true, json: async () => ({ access_token: "tok" }) }), async () => {
    const result = await fare.checkHealth();
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.body, { status: "ok" });
  }));
});

test("5.03  health is unavailable when the only configured provider refuses", async function () {
  await withEnv(AMADEUS_ENV, () => withFetch(async () => ({ ok: false, status: 401, json: async () => ({}) }), async () => {
    const result = await fare.checkHealth();
    assert.strictEqual(result.status, 503);
    assert.deepStrictEqual(result.body, { status: "unavailable" });
  }));
});

test("5.04  a configured Duffel token is enough for healthy", async function () {
  await withEnv(DUFFEL_ENV, async () => {
    const result = await fare.checkHealth();
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.body, { status: "ok" });
  });
});

test("5.05  health never leaks which provider is configured", async function () {
  await withEnv(AMADEUS_ENV, () => withFetch(async () => ({ ok: true, json: async () => ({ access_token: "tok" }) }), async () => {
    const result = await fare.checkHealth();
    const wire = JSON.stringify(result.body).toLowerCase();
    for (const banned of ["amadeus", "duffel", "token", "secret", "client"]) {
      assert.ok(wire.indexOf(banned) < 0, "health leaked '" + banned + "'");
    }
  }));
});

/* ============================================================
 * 6. nothing internal ever reaches the wire — 6 checks
 * ============================================================ */

test("6.01  no reply ever carries a token, url, or booking token", async function () {
  await withEnv(AMADEUS_ENV, () => withFetch(amadeusFetch(AMADEUS_OFFER), async () => {
    const result = await fare.lookupPrice(GOOD_QUERY);
    const wire = JSON.stringify(result.body).toLowerCase();
    for (const banned of ["booking_token", "token", "url", "http://", "https://", "traceback", "stack"]) {
      assert.ok(wire.indexOf(banned) < 0, "the wire carried '" + banned + "'");
    }
  }));
});

test("6.02  no reply ever carries emissions, co2, baggage or layovers", async function () {
  await withEnv(AMADEUS_ENV, () => withFetch(amadeusFetch(AMADEUS_OFFER), async () => {
    const result = await fare.lookupPrice(GOOD_QUERY);
    const wire = JSON.stringify(result.body).toLowerCase();
    for (const banned of ["emissions", "co2", "baggage", "layover"]) {
      assert.ok(wire.indexOf(banned) < 0, "the wire carried '" + banned + "'");
    }
  }));
});

test("6.03  the module source names no invented fallback fare", function () {
  for (const banned of ["DEFAULT_PRICE", "fallbackPrice", "cachedFare", "estimateFare", "FALLBACK_FARE", "hardcodedAmount"]) {
    assert.ok(FARE_SOURCE.indexOf(banned) < 0, "source mentions " + banned);
  }
});

test("6.04  the module never writes a price store of any kind", function () {
  for (const banned of ["localStorage", "sessionStorage", "writeFile", "fs.write", "redis", "sql"]) {
    assert.ok(FARE_SOURCE.toLowerCase().indexOf(banned.toLowerCase()) < 0, "source touches " + banned);
  }
});

test("6.05  the price handler never echoes the query back", async function () {
  await withEnv(NO_PROVIDERS, async () => {
    const result = await fare.lookupPrice({});
    const wire = JSON.stringify(result.body);
    assert.ok(wire.indexOf("origin") < 0 && wire.indexOf("destination") < 0, "the handler echoed the query");
  });
});

test("6.06  the handler files keep the documented routes and contracts", function () {
  assert.ok(/GET \/api\/flights\/price/.test(PRICE_SOURCE), "price.js does not document its route");
  assert.ok(/kind: "no_fare"/.test(PRICE_SOURCE) || /no_fare/.test(FARE_SOURCE), "no_fare contract is missing");
  assert.ok(/status: "ok"/.test(FARE_SOURCE) && /status: "unavailable"/.test(FARE_SOURCE),
    "health contract shapes are missing");
  assert.ok(/healthz/.test(HEALTH_SOURCE), "healthz.js does not document its route");
});

/* Every check runs first; the summary waits for the live-provider ones. */
chain.then(function () {
  console.log("");
  console.log("================================================================");
  console.log("RESULT: " + checks + " passed, " + fails + " failed");
  console.log("================================================================");
  process.exit(fails ? 1 : 0);
});
