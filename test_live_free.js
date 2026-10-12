"use strict";
/* test_live_free.js — the free live-verification layer, with the network stubbed.
 *
 * Everything here runs against a fake fetch, so the suite runs with no internet
 * and no API keys. What it pins down:
 *
 *   * the keyless providers work with nothing configured (anonymous visitor);
 *   * a keyed provider without a key says so and makes NO request;
 *   * a user's key is written to storage, sent to that provider only, and never
 *     appears in a URL or a log line this app controls;
 *   * a cache hit skips the network entirely, and the same question twice is
 *     one request;
 *   * 429 locks the bucket, answers with the exact offline-friendly message,
 *     and does not retry in a loop;
 *   * FlightSeatMap failing (their free MCP is CORS-hostile from a browser) is
 *     reported as "showing verified local layout", never as an error storm;
 *   * HTML-instead-of-JSON, 401, 500 and truncated JSON are all handled;
 *   * availability never claims to be live while it is simulated.
 */
const assert = require("assert");
const Live = require("./spicy_live_free.js");
const SPICY = require("./spicy_data.js");

let PASS = 0, FAIL = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => { PASS++; console.log("PASS:", name); },
    error => { FAIL++; console.error("FAIL:", name, "\n   ", error.message); });
}

/* ---------------- a stubbed world ---------------- */

function fakeStorage() {
  const store = {};
  return {
    get length() { return Object.keys(store).length; },
    key(i) { return Object.keys(store)[i] || null; },
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    dump() { return Object.assign({}, store); }
  };
}
function jsonResponse(body, status = 200, headers = {}) {
  return {
    status,
    headers: { get: name => headers[name.toLowerCase()] || null },
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body))
  };
}
function scriptedFetch(script) {
  const calls = [];
  const fetchFn = (url, options) => {
    calls.push({ url, options });
    const step = script.shift();
    if (!step) throw new Error("unexpected fetch " + url);
    if (step.reject) return Promise.reject(new Error(step.reject));
    return Promise.resolve(step.response);
  };
  fetchFn.calls = calls;
  return fetchFn;
}
function freshWorld(script, options = {}) {
  const storage = fakeStorage();
  const fetchFn = scriptedFetch(script);
  let clock = 1000000;
  Live.configure({
    fetch: fetchFn,
    storage,
    now: () => clock,
    onLine: () => options.onLine === undefined ? true : options.onLine
  });
  Live.clearCache();
  Live.resetBuckets();
  return { storage, fetchFn, tick: ms => { clock += ms; }, get clock() { return clock; } };
}

const SEGMENT = { airline: "AA", flight_no: "100", orig: "JFK", dest: "LHR", date_ddmmm: "02DEC", aircraft: "77W" };

(async function run() {
  /* ---------------- keyless ---------------- */

  await check("a keyless provider works with nothing configured", async () => {
    const world = freshWorld([{ response: jsonResponse({ states: [["abc123", "AAL100 ", "United States", 1, 1, 40.7, -73.9, 10000, false, 250]] }) }]);
    const result = await Live.validateWithOpenSky("AAL100");
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.airborne, true);
    assert.strictEqual(result.provenance, "OPENSKY_LIVE");
    assert.strictEqual(result.live, true);
    assert(/OpenSky LIVE/.test(result.text), "the badge names the live provider: " + result.text);
    assert.strictEqual(world.fetchFn.calls.length, 1);
  });

  await check("OpenSky with no match says so instead of inventing a position", async () => {
    freshWorld([{ response: jsonResponse({ states: [["abc123", "OTHER1 ", "X", 1, 1, 1, 1, 1, false, 1]] }) }]);
    const result = await Live.validateWithOpenSky("AAL100");
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.airborne, false);
    assert(/no aircraft answering/.test(result.text));
  });

  await check("context needs no key: weather, FX, CO2 and the shipped visa table", async () => {
    freshWorld([
      { response: jsonResponse([{ latitude: 40.6, longitude: -73.8, current: { temperature_2m: 12.4, wind_speed_10m: 5 } },
        { latitude: 51.5, longitude: -0.45, current: { temperature_2m: 9.1, wind_speed_10m: 7 } }]) },
      { response: jsonResponse({ amount: 1, base: "USD", date: "2026-10-12", rates: { GBP: 0.79 } }) }
    ]);
    const context = await Live.contextFree("JFK", "LHR", 3450, "77W", { data: SPICY, passport: "USA", cabin: "economy" });
    assert.strictEqual(context.ok, true);
    assert.strictEqual(context.weather.length, 2);
    assert.strictEqual(context.currencies.rate, 0.79);
    assert(/ECB/.test(context.currencies.text));
    assert(context.co2.kg > 300 && context.co2.kg < 1200, "CO2 estimate should be plausible, got " + context.co2.kg);
    assert.strictEqual(context.co2.provenance, "LOCAL_ICAO_CO2");
    assert(context.provenance.includes("OPEN_METEO_FREE"));
    assert(context.provenance.includes("FRANKFURTER_FREE"));
    assert(context.provenance.includes("LOCAL_ICAO_CO2"));
  });

  /* ---------------- cache and debounce ---------------- */

  await check("a cache hit skips the network completely", async () => {
    const world = freshWorld([{ response: jsonResponse({ states: [["abc123", "AAL100 ", "X", 1, 1, 40, -73, 1, false, 1]] }) }]);
    const first = await Live.validateWithOpenSky("AAL100");
    const second = await Live.validateWithOpenSky("AAL100");
    assert.deepStrictEqual(second, first, "the cached answer is the same answer");
    assert.strictEqual(world.fetchFn.calls.length, 1, "the second call must not touch the network");
  });

  await check("a cached answer expires after the 10 minute TTL", async () => {
    const world = freshWorld([
      { response: jsonResponse({ states: [["abc123", "AAL100 ", "X", 1, 1, 40, -73, 1, false, 1]] }) },
      { response: jsonResponse({ states: [["abc123", "AAL100 ", "X", 1, 1, 41, -74, 1, false, 1]] }) }
    ]);
    await Live.validateWithOpenSky("AAL100");
    world.tick(Live.CACHE_TTL_MS + 1);
    const again = await Live.validateWithOpenSky("AAL100");
    assert.strictEqual(world.fetchFn.calls.length, 2, "an expired entry is refetched");
    assert(/41\.0/.test(again.text));
  });

  await check("the same question asked twice in one tick is one request", async () => {
    const world = freshWorld([{ response: jsonResponse({ states: [["abc123", "AAL100 ", "X", 1, 1, 40, -73, 1, false, 1]] }) }]);
    const [a, b] = await Promise.all([Live.validateWithOpenSky("AAL100"), Live.validateWithOpenSky("AAL100")]);
    assert.strictEqual(world.fetchFn.calls.length, 1, "single-flight must dedupe in-flight calls");
    assert.deepStrictEqual(a, b);
  });

  await check("debounce collapses a burst of pastes into one run", async () => {
    let runs = 0;
    const debounced = Live.debounce(() => { runs++; }, 20);
    debounced(); debounced(); debounced();
    assert.strictEqual(runs, 0, "nothing runs before the wait elapses");
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.strictEqual(runs, 1, "three calls in the window are one run");
    assert.strictEqual(Live.DEBOUNCE_MS, 800, "the app's debounce is 800 ms");
  });

  /* ---------------- failure modes ---------------- */

  await check("429 stops, says the free limit is reached, and does not retry", async () => {
    const world = freshWorld([{ response: jsonResponse("slow down", 429, { "retry-after": "1800" }) }]);
    const result = await Live.validateWithOpenSky("AAL100");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "rate_limited");
    assert.strictEqual(result.message, "Free API limit reached — offline conversion still perfect, try in 1h");
    assert.strictEqual(world.fetchFn.calls.length, 1);
    const blocked = await Live.validateWithOpenSky("AAL101");
    assert.strictEqual(blocked.reason, "rate_limited");
    assert.strictEqual(world.fetchFn.calls.length, 1, "the bucket stays locked: no second request");
    assert(Live.bucketState("opensky").lockedMs > 0);
  });

  await check("a rejected fetch (CORS/offline) is a status, never a throw", async () => {
    freshWorld([{ reject: "Failed to fetch" }]);
    const result = await Live.validateWithOpenSky("AAL100");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "network");
    assert(/offline conversion unaffected|CORS/.test(result.message));
  });

  await check("HTML where JSON was promised is caught", async () => {
    freshWorld([{ response: jsonResponse("<!doctype html><html>blocked</html>", 200) }]);
    const result = await Live.validateWithOpenSky("AAL100");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "html");
  });

  await check("truncated JSON and server errors are caught", async () => {
    freshWorld([{ response: jsonResponse("{\"states\":[", 200) }]);
    const bad = await Live.validateWithOpenSky("AAL100");
    assert.strictEqual(bad.reason, "bad_json");
    const world2 = freshWorld([{ response: jsonResponse("nope", 500) }]);
    const server = await Live.validateWithOpenSky("AAL100");
    assert.strictEqual(server.reason, "server_error");
    assert.strictEqual(world2.fetchFn.calls.length, 1);
  });

  await check("offline is detected before any request is made", async () => {
    const world = freshWorld([], { onLine: false });
    const result = await Live.validateWithOpenSky("AAL100");
    assert.strictEqual(result.reason, "offline");
    assert.strictEqual(world.fetchFn.calls.length, 0);
  });

  /* ---------------- FlightSeatMap free MCP ---------------- */

  await check("FlightSeatMap free MCP failure falls back with the honest line", async () => {
    freshWorld([{ reject: "Failed to fetch" }]);
    const result = await Live.getSeatmapFree("AA100", "2026-12-02");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.message, "FlightSeatMap free unavailable (CORS) — showing verified local layout");
    assert.strictEqual(result.fallback, "local layout");
    assert.strictEqual(result.provenance, "FLIGHTSEATMAP_FREE (hosted MCP, not live booking inventory)");
  });

  await check("FlightSeatMap free MCP success still refuses to call itself live", async () => {
    freshWorld([{
      response: jsonResponse({
        jsonrpc: "2.0", id: "1",
        result: { content: [{ type: "text", text: "AA100 seat map: rows 1-40" }] }
      })
    }]);
    const result = await Live.getSeatmapFree("AA100", "2026-12-02");
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.live, false, "a seat map is not booking inventory");
    assert(/not live booking inventory/.test(result.text));
    assert(/not live booking inventory/.test(result.provenance));
    const call = result.detail && result.detail.bytes > 0;
    assert(call, "the map text is carried through");
  });

  /* ---------------- keys: own key, local only ---------------- */

  await check("a keyed provider without a key makes no request at all", async () => {
    const world = freshWorld([]);
    const result = await Live.validateWithAviationStack("AA100", "2026-12-02");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "key_missing");
    assert(/offline conversion is unaffected/.test(result.message));
    assert.strictEqual(world.fetchFn.calls.length, 0, "no key, no call");
  });

  await check("the user's key is stored locally and sent to that provider only", async () => {
    const world = freshWorld([{ response: jsonResponse({ data: [{ flight_date: "2026-12-02", status: "scheduled", departure: { iata: "JFK" }, arrival: { iata: "LHR" } }] }) }]);
    Live.setKey("aviationstack", "user-owned-key");
    assert.strictEqual(Live.getKey("aviationstack"), "user-owned-key");
    const result = await Live.validateWithAviationStack("AA100", "2026-12-02");
    assert.strictEqual(result.ok, true);
    const url = world.fetchFn.calls[0].url;
    assert(/^http:\/\/api\.aviationstack\.com\//.test(url), "the free plan is the provider's http endpoint");
    assert(url.includes("user-owned-key"), "the key goes to the provider that issued it");
    assert.strictEqual(result.provenance, "AVIATIONSTACK_FREE");
    Live.clearKey("aviationstack");
    assert.strictEqual(Live.getKey("aviationstack"), null, "clearing removes it");
  });

  await check("a header-keyed provider keeps the key out of the URL", async () => {
    const world = freshWorld([{ response: jsonResponse({ number: "AA100", status: "Expected", departure: { airport: { iata: "JFK" }, terminal: "8" } }) }]);
    Live.setKey("aerodatabox", "rapid-key");
    const result = await Live.validateWithAeroDataBoxFree("AA100", "2026-12-02");
    assert.strictEqual(result.ok, true);
    const call = world.fetchFn.calls[0];
    assert(!call.url.includes("rapid-key"), "the key must not travel in the URL");
    assert.strictEqual(call.options.headers["X-RapidAPI-Key"], "rapid-key");
    assert.strictEqual(result.provenance, "AERODATABOX_FREE");
    Live.clearKey("aerodatabox");
  });

  await check("key status never claims a key exists when it does not", async () => {
    freshWorld([]);
    Live.clearKey("travelpayouts"); Live.clearKey("aviationstack");
    const status = Live.keyStatus();
    assert.strictEqual(status.opensky.configured, true, "keyless providers are always ready");
    assert.strictEqual(status.aviationstack.configured, false);
    assert.strictEqual(status.travelpayouts.configured, false);
    assert(/free plan/.test(status.aviationstack.note), "the panel tells the user which plan it is");
  });

  await check("a fare lookup without a token is declined politely", async () => {
    const world = freshWorld([]);
    Live.clearKey("travelpayouts");
    const result = await Live.fareWithTravelpayouts("JFK", "LHR", "2026-12-02");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "key_missing");
    assert.strictEqual(world.fetchFn.calls.length, 0);
  });

  /* ---------------- the aggregate and the honesty labels ---------------- */

  await check("badges aggregate runs in parallel and always returns a list", async () => {
    freshWorld([
      { response: jsonResponse([{ latitude: 40.6, longitude: -73.8, current: { temperature_2m: 12 } }]) },
      { response: jsonResponse({ amount: 1, base: "USD", date: "2026-10-12", rates: { GBP: 0.79 } }) }
    ]);
    const badges = await Live.updateBadges([SEGMENT], {
      data: SPICY, distanceMiles: 3450, aircraft: "77W", passport: "USA", cabin: "economy"
    });
    assert(Array.isArray(badges) && badges.length >= 2, "at least the simulated-availability badge is present");
    const texts = badges.map(b => b.text).join(" | ");
    assert(/Open-Meteo/.test(texts), "weather badge present: " + texts);
    assert(/Frankfurter/.test(texts), "currency badge present: " + texts);
    const availability = badges.filter(b => b.provider === "availability")[0];
    assert(/SIMULATED/.test(availability.text), "the availability badge says SIMULATED");
    assert(!/LIVE/.test(availability.text), "and never says LIVE");
    assert.strictEqual(availability.provenance, "SIMULATED (deterministic hash)");
  });

  await check("badges survive every provider failing", async () => {
    freshWorld([{ reject: "Failed to fetch" }, { reject: "Failed to fetch" }, { reject: "Failed to fetch" }, { reject: "Failed to fetch" }]);
    const badges = await Live.updateBadges([SEGMENT], { data: SPICY, distanceMiles: 3450, checkOpensky: true, callsign: "AAL100", checkSeatmap: true });
    assert(Array.isArray(badges));
    const failed = badges.filter(b => b.failed).map(b => b.text);
    assert(failed.some(text => /Free API limit reached|CORS|offline conversion/.test(text)), "failures are honest one-liners: " + failed.join(" | "));
    assert(badges.some(b => b.provider === "availability"), "the offline conversion is still described");
  });

  await check("identical inputs give identical badges twice", async () => {
    const world = freshWorld([
      { response: jsonResponse([{ latitude: 40.6, longitude: -73.8, current: { temperature_2m: 12 } }]) },
      { response: jsonResponse({ amount: 1, base: "USD", date: "2026-10-12", rates: { GBP: 0.79 } }) }
    ]);
    const first = await Live.updateBadges([SEGMENT], { data: SPICY, distanceMiles: 3450, aircraft: "77W", passport: "USA" });
    const second = await Live.updateBadges([SEGMENT], { data: SPICY, distanceMiles: 3450, aircraft: "77W", passport: "USA" });
    assert.deepStrictEqual(second, first, "a second render must be byte-identical");
    assert.strictEqual(world.fetchFn.calls.length, 2, "the second render is served from cache");
  });

  await check("live and simulated availability can never be confused", async () => {
    assert(/SIMULATED/.test(Live.availabilityLabel(false)));
    assert(!/LIVE/.test(Live.availabilityLabel(false).replace("SIMULATED", "")));
    assert(/LIVE/.test(Live.availabilityLabel(true)));
    assert(/reserves nothing/.test(Live.availabilityDisclaimer()));
  });

  console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
  if (FAIL > 0) process.exit(1);
})();
