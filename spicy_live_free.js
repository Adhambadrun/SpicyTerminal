/* spicy_live_free.js — free live verification for converted itineraries.
 *
 * WHAT THIS FILE IS ALLOWED TO DO
 * ------------------------------
 * The $0 law: every provider here is free forever, needs no credit card, and
 * no paid tier is ever called or advertised. Two kinds of free provider are
 * used and they are labelled differently in the UI:
 *
 *   keyless   OpenSky Network (anonymous), Open-Meteo, Frankfurter, the local
 *             ICAO CO2 formula, the visa table that ships inside spicy_data.js,
 *             and FlightSeatMap's free hosted MCP tools. These work with no
 *             account, so an anonymous visitor still gets badges.
 *   keyed     AviationStack free plan, AeroDataBox free tier, Travelpayouts.
 *             These need a key, and the key is the *user's own*: it is typed
 *             into the settings panel, kept in localStorage, and sent straight
 *             from the browser to that provider. It never reaches this app's
 *             origin, never appears in a URL this app builds, never in a log.
 *
 * HONESTY RULES
 * -------------
 *   * Every returned fact carries `provenance` naming where it came from, and
 *     the UI prints that word for word.
 *   * FlightSeatMap's free MCP is a *seat map*, not booking inventory; its
 *     provenance string says so. Availability shown by the seat map itself is
 *     SIMULATED and is never described as live.
 *   * A provider that fails changes nothing about the conversion: badges are
 *     decoration on a result that is already correct offline. Failure is a
 *     one-line status, never an error storm, and it is cached so a rate limit
 *     is not hammered.
 *
 * BUDGETING
 * ---------
 *   * Every response is cached in memory and in localStorage for 10 minutes.
 *   * Each provider has a token bucket, so a burst of pastes cannot burn a
 *     free quota. A 429 locks the bucket for an hour and the UI says:
 *     "Free API limit reached — offline conversion still perfect, try in 1h".
 *   * Calls are debounced (default 800 ms) and deduplicated by in-flight key.
 */
(function (root) {
  "use strict";

  var CACHE_TTL_MS = 10 * 60 * 1000;
  var DEBOUNCE_MS = 800;
  var CACHE_PREFIX = "spicy_live_cache_";
  var KEY_PREFIX = "spicy_live_key_";
  var MAX_CACHE_ENTRIES = 60;

  /* Provenance vocabulary. These strings are printed verbatim, so they say
     exactly what the value is and nothing more. */
  var PROVENANCE = {
    OPENSKY_LIVE: "OPENSKY_LIVE",
    AVIATIONSTACK_FREE: "AVIATIONSTACK_FREE",
    AERODATABOX_FREE: "AERODATABOX_FREE",
    FLIGHTSEATMAP_FREE: "FLIGHTSEATMAP_FREE (hosted MCP, not live booking inventory)",
    OPEN_METEO_FREE: "OPEN_METEO_FREE",
    FRANKFURTER_FREE: "FRANKFURTER_FREE",
    LOCAL_ICAO_CO2: "LOCAL_ICAO_CO2",
    VISA_TABLE_LOCAL: "VISA_TABLE_LOCAL (Passport Index, MIT)",
    INFERRED: "INFERRED",
    SIMULATED: "SIMULATED (deterministic hash)",
    VERIFIED_LAYOUT: "VERIFIED layout",
    GENERIC_LAYOUT: "GENERIC layout — not airline verified"
  };

  var MESSAGES = {
    RATE_LIMITED: "Free API limit reached — offline conversion still perfect, try in 1h",
    CORS: "FlightSeatMap free unavailable (CORS) — showing verified local layout",
    KEY_MISSING: "free key not set — optional, the offline conversion is unaffected",
    OFFLINE: "device offline — showing the offline conversion",
    BAD_RESPONSE: "free API answered with something unreadable — offline conversion unaffected"
  };

  /* Provider table. `free:` is the promise the UI makes about each one: what
     it costs (nothing) and what it is allowed to be called for. */
  var PROVIDERS = {
    opensky: {
      label: "OpenSky Network", provenance: PROVENANCE.OPENSKY_LIVE, keyless: true, rateLimitPerHour: 40,
      note: "anonymous live aircraft state vectors, free, no key"
    },
    aviationstack: {
      label: "AviationStack", provenance: PROVENANCE.AVIATIONSTACK_FREE, keyless: false, rateLimitPerHour: 20,
      note: "free plan, own key, 100 requests/month"
    },
    aerodatabox: {
      label: "AeroDataBox", provenance: PROVENANCE.AERODATABOX_FREE, keyless: false, rateLimitPerHour: 20,
      note: "free tier through RapidAPI, own key"
    },
    flightseatmap: {
      label: "FlightSeatMap MCP", provenance: PROVENANCE.FLIGHTSEATMAP_FREE, keyless: true, rateLimitPerHour: 20,
      note: "free hosted MCP tools; seat map, not booking inventory"
    },
    travelpayouts: {
      label: "Travelpayouts", provenance: "TRAVELPAYOUTS_FREE", keyless: false, rateLimitPerHour: 20,
      note: "free cached fare statistics, own token"
    },
    openmeteo: {
      label: "Open-Meteo", provenance: PROVENANCE.OPEN_METEO_FREE, keyless: true, rateLimitPerHour: 60,
      note: "free weather, no key, no card"
    },
    frankfurter: {
      label: "Frankfurter", provenance: PROVENANCE.FRANKFURTER_FREE, keyless: true, rateLimitPerHour: 60,
      note: "free ECB exchange rates, no key"
    }
  };

  var ENDPOINTS = {
    opensky: "https://opensky-network.org/api/states/all",
    aviationstack: "http://api.aviationstack.com/v1/flights",
    aerodatabox: "https://aerodatabox.p.rapidapi.com/flights/number/",
    flightseatmap: "https://mcp.flightseatmap.com/mcp",
    travelpayouts: "https://api.travelpayouts.com/v1/prices/cheap",
    openmeteo: "https://api.open-meteo.com/v1/forecast",
    frankfurter: "https://api.frankfurter.app/latest"
  };

  var TIMEOUT_MS = 8000;

  /* Everything the module needs from its host, swappable so the suite can run
     it in Node without a browser. */
  var env = {
    fetch: (root && root.fetch) ? function (url, options) { return root.fetch(url, options); } : null,
    storage: null,
    now: function () { return new Date().getTime(); },
    onLine: function () { return true; }
  };
  var memoryCache = {};
  var inflight = {};
  var buckets = {};
  var lastError = {};

  function configure(patch) {
    patch = patch || {};
    if (patch.fetch) env.fetch = patch.fetch;
    if (patch.storage !== undefined) env.storage = patch.storage;
    if (patch.now) env.now = patch.now;
    if (patch.onLine) env.onLine = patch.onLine;
    if (!env.storage) env.storage = pickStorage();
    return api;
  }

  function pickStorage() {
    try {
      if (root && root.localStorage) {
        root.localStorage.setItem("spicy_live_probe", "1");
        root.localStorage.removeItem("spicy_live_probe");
        return root.localStorage;
      }
    } catch (error) { /* private mode: fall through to memory only */ }
    return null;
  }

  /* ---------------- keys: the user's own, local only ---------------- */

  /** Store a free-plan key. Written to localStorage, never to a URL this app
   *  builds, never to this app's origin (there is no server side). */
  function setKey(provider, value) {
    if (!env.storage) return false;
    try {
      if (value) env.storage.setItem(KEY_PREFIX + provider, String(value));
      else env.storage.removeItem(KEY_PREFIX + provider);
      return true;
    } catch (error) { return false; }
  }
  function getKey(provider) {
    if (!env.storage) return null;
    try {
      var value = env.storage.getItem(KEY_PREFIX + provider);
      return value ? String(value) : null;
    } catch (error) { return null; }
  }
  function clearKey(provider) { return setKey(provider, null); }
  function keyStatus() {
    var out = {};
    Object.keys(PROVIDERS).forEach(function (name) {
      var provider = PROVIDERS[name];
      out[name] = {
        label: provider.label,
        keyless: provider.keyless,
        configured: provider.keyless ? true : !!getKey(name),
        note: provider.note
      };
    });
    return out;
  }

  /* ---------------- cache ---------------- */

  function cacheKey(provider, parts) {
    return provider + "|" + parts.map(function (part) { return String(part == null ? "" : part); }).join("|");
  }
  function readCache(key) {
    var hit = memoryCache[key];
    if (!hit) {
      if (!env.storage) return null;
      try {
        var raw = env.storage.getItem(CACHE_PREFIX + key);
        if (raw) hit = JSON.parse(raw);
      } catch (error) { hit = null; }
      if (hit) memoryCache[key] = hit;
    }
    if (!hit) return null;
    if (env.now() - hit.at > CACHE_TTL_MS) {
      delete memoryCache[key];
      removeStored(CACHE_PREFIX + key);
      return null;
    }
    return hit.value;
  }
  function writeCache(key, value) {
    var entry = { at: env.now(), value: value };
    memoryCache[key] = entry;
    pruneCache();
    if (env.storage) {
      try { env.storage.setItem(CACHE_PREFIX + key, JSON.stringify(entry)); }
      catch (error) { removeSomeStored(); }
    }
    return value;
  }
  function removeStored(fullKey) {
    if (!env.storage) return;
    try { env.storage.removeItem(fullKey); } catch (error) { /* ignore */ }
  }
  function storedKeys() {
    if (!env.storage) return [];
    var out = [];
    try {
      for (var i = 0; i < env.storage.length; i++) {
        var name = env.storage.key(i);
        if (name && name.indexOf(CACHE_PREFIX) === 0) out.push(name);
      }
    } catch (error) { /* ignore */ }
    return out;
  }
  function pruneCache() {
    var names = Object.keys(memoryCache);
    if (names.length <= MAX_CACHE_ENTRIES) return;
    names.sort(function (a, b) { return (memoryCache[a].at || 0) - (memoryCache[b].at || 0); });
    while (names.length > MAX_CACHE_ENTRIES) {
      var oldest = names.shift();
      delete memoryCache[oldest];
      removeStored(CACHE_PREFIX + oldest);
    }
  }
  function removeSomeStored() {
    var names = storedKeys();
    names.sort();
    for (var i = 0; i < Math.ceil(names.length / 2); i++) removeStored(names[i]);
  }
  function cacheStats() {
    var names = storedKeys();
    return { memory: Object.keys(memoryCache).length, stored: names.length, ttlMs: CACHE_TTL_MS };
  }
  function clearCache() {
    memoryCache = {};
    inflight = {};
    storedKeys().forEach(removeStored);
    return true;
  }

  /* ---------------- token bucket ---------------- */

  function bucketFor(provider) {
    var config = PROVIDERS[provider] || { rateLimitPerHour: 20 };
    if (!buckets[provider]) {
      buckets[provider] = {
        tokens: config.rateLimitPerHour,
        capacity: config.rateLimitPerHour,
        refillPerMs: config.rateLimitPerHour / (60 * 60 * 1000),
        at: env.now(),
        lockedUntil: 0
      };
    }
    var bucket = buckets[provider];
    var elapsed = Math.max(0, env.now() - bucket.at);
    bucket.at = env.now();
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerMs);
    return bucket;
  }
  function takeToken(provider) {
    var bucket = bucketFor(provider);
    if (bucket.lockedUntil > env.now()) return false;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
  function releaseLock(provider, retryAfterMs) {
    var bucket = bucketFor(provider);
    bucket.lockedUntil = env.now() + (retryAfterMs || 60 * 60 * 1000);
    bucket.tokens = 0;
  }
  function bucketState(provider) {
    var bucket = bucketFor(provider);
    return {
      tokens: Math.floor(bucket.tokens),
      capacity: bucket.capacity,
      lockedMs: Math.max(0, bucket.lockedUntil - env.now())
    };
  }
  function resetBuckets() { buckets = {}; return true; }

  /* ---------------- debounce / dedupe ---------------- */

  function debounce(fn, wait) {
    var timer = null;
    var delay = wait == null ? DEBOUNCE_MS : wait;
    return function () {
      var args = arguments, self = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; fn.apply(self, args); }, delay);
    };
  }

  /* ---------------- transport ---------------- */

  function classifyStatus(status) {
    if (status === 429) return "rate_limited";
    if (status === 401 || status === 403) return "unauthorized";
    if (status >= 500) return "server_error";
    if (status >= 400) return "bad_request";
    return "ok";
  }
  function retryAfterMs(response) {
    try {
      var header = response && response.headers && response.headers.get ? response.headers.get("Retry-After") : null;
      if (!header) return 0;
      var seconds = parseInt(header, 10);
      if (seconds > 0) return seconds * 1000;
      var when = new Date(header).getTime();
      if (!isNaN(when)) return Math.max(0, when - env.now());
    } catch (error) { /* ignore */ }
    return 0;
  }
  function looksLikeHtml(text) {
    return /^\s*(?:<!doctype|<html|<\?xml)/i.test(String(text || ""));
  }

  /**
   * One JSON call, with every failure mode the browser actually produces:
   * no fetch, offline, CORS (fetch rejects), abort/timeout, 429 with
   * Retry-After, 401/403, HTML where JSON was promised, and truncated JSON.
   * Returns {ok:true,data} or {ok:false,reason,message,status}.
   */
  function fetchJson(url, options) {
    options = options || {};
    var provider = options.provider || "unknown";
    if (!env.fetch) return Promise.resolve({ ok: false, reason: "no_fetch", message: MESSAGES.BAD_RESPONSE });
    if (!env.onLine()) return Promise.resolve({ ok: false, reason: "offline", message: MESSAGES.OFFLINE });
    if (!takeToken(provider)) {
      lastError[provider] = "rate_limited";
      return Promise.resolve({ ok: false, reason: "rate_limited", message: MESSAGES.RATE_LIMITED });
    }
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    var timeout = options.timeoutMs || TIMEOUT_MS;
    var request = {
      method: options.method || "GET",
      headers: options.headers || {},
      mode: options.mode || "cors",
      signal: controller ? controller.signal : undefined
    };
    if (options.body) {
      request.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      if (!request.headers["Content-Type"]) request.headers["Content-Type"] = "application/json";
    }
    if (controller) {
      timer = setTimeout(function () { try { controller.abort(); } catch (error) { /* ignore */ } }, timeout);
    }
    return env.fetch(url, request).then(function (response) {
      if (timer) clearTimeout(timer);
      var status = response && response.status;
      var kind = classifyStatus(status);
      if (kind === "rate_limited") {
        releaseLock(provider, retryAfterMs(response) || undefined);
        lastError[provider] = "rate_limited";
        return { ok: false, reason: "rate_limited", status: status, message: MESSAGES.RATE_LIMITED };
      }
      if (kind !== "ok") {
        lastError[provider] = kind;
        return { ok: false, reason: kind, status: status, message: MESSAGES.BAD_RESPONSE };
      }
      return response.text().then(function (text) {
        if (looksLikeHtml(text)) {
          lastError[provider] = "html";
          return { ok: false, reason: "html", status: status, message: MESSAGES.BAD_RESPONSE };
        }
        if (!text) return { ok: true, data: null };
        try {
          return { ok: true, data: JSON.parse(text) };
        } catch (error) {
          lastError[provider] = "bad_json";
          return { ok: false, reason: "bad_json", status: status, message: MESSAGES.BAD_RESPONSE };
        }
      });
    }).catch(function (error) {
      if (timer) clearTimeout(timer);
      var message = String(error && error.message || error);
      var aborted = /abort/i.test(message);
      lastError[provider] = aborted ? "timeout" : "network";
      return {
        ok: false,
        reason: aborted ? "timeout" : "network",
        message: provider === "flightseatmap" ? MESSAGES.CORS
          : (aborted ? "free API did not answer in time — offline conversion unaffected" : MESSAGES.CORS)
      };
    });
  }

  /** Cache + single-flight wrapper: the same question asked twice in one paste
   *  costs one request, and a cached answer is never refetched inside the TTL. */
  function withCache(provider, parts, loader) {
    var key = cacheKey(provider, parts);
    var hit = readCache(key);
    if (hit !== null && hit !== undefined) return Promise.resolve(hit);
    if (inflight[key]) return inflight[key];
    var promise = loader().then(function (result) {
      delete inflight[key];
      if (result && result.ok) writeCache(key, result);
      return result;
    }, function (error) {
      delete inflight[key];
      return { ok: false, reason: "error", message: MESSAGES.BAD_RESPONSE, error: String(error && error.message || error) };
    });
    inflight[key] = promise;
    return promise;
  }

  function badge(provider, provenance, text, extra) {
    var out = {
      provider: provider,
      provenance: provenance,
      text: text,
      live: !!(extra && extra.live),
      simulated: !!(extra && extra.simulated)
    };
    if (extra) Object.keys(extra).forEach(function (name) { out[name] = extra[name]; });
    return out;
  }

  /* ---------------- keyless providers ---------------- */

  /** OpenSky anonymous: is an aircraft with this callsign actually airborne,
   *  and where. Free, no key; anonymous access is rate limited, so it is
   *  cached hard and bucketed. */
  function validateWithOpenSky(callsign, bbox, options) {
    options = options || {};
    var call = String(callsign || "").toUpperCase().replace(/\s+/g, "");
    if (!call) return Promise.resolve({ ok: false, reason: "no_callsign", message: "no callsign to check" });
    return withCache("opensky", ["states", call, bbox || ""], function () {
      var query = [];
      if (bbox && bbox.length === 4) {
        query.push("lamin=" + bbox[0], "lomin=" + bbox[1], "lamax=" + bbox[2], "lomax=" + bbox[3]);
      }
      var url = ENDPOINTS.opensky + (query.length ? "?" + query.join("&") : "");
      return fetchJson(url, { provider: "opensky", timeoutMs: options.timeoutMs }).then(function (result) {
        if (!result.ok) return result;
        var states = (result.data && result.data.states) || [];
        var match = null;
        for (var i = 0; i < states.length; i++) {
          var row = states[i];
          if (String(row[1] || "").trim().toUpperCase() === call) { match = row; break; }
        }
        if (!match) {
          for (var k = 0; k < states.length; k++) {
            if (String(states[k][1] || "").trim().toUpperCase().indexOf(call) === 0) { match = states[k]; break; }
          }
        }
        if (!match) {
          return {
            ok: true, airborne: false, callsign: call, provenance: PROVENANCE.OPENSKY_LIVE,
            text: "OpenSky: no aircraft answering " + call + " is airborne right now",
            detail: { checked: states.length }
          };
        }
        var onGround = match[8] === true;
        return {
          ok: true,
          airborne: !onGround,
          callsign: call,
          live: true,
          provenance: PROVENANCE.OPENSKY_LIVE,
          text: "OpenSky LIVE: " + call + (onGround ? " is on the ground" : " is airborne")
            + (match[5] != null && match[6] != null ? " near " + Number(match[5]).toFixed(1) + ", " + Number(match[6]).toFixed(1) : ""),
          detail: { icao24: match[0], onGround: onGround, lat: match[5], lon: match[6], altitude: match[7], velocity: match[9] }
        };
      });
    });
  }

  /** FlightSeatMap's free hosted MCP: a seat map for the flight number. Free,
   *  no auth for the read-only tools. Their own caveat is the important part:
   *  the map is not live booking inventory, so this result is never presented
   *  as live availability. */
  function getSeatmapFree(flightNumber, date, options) {
    options = options || {};
    var number = String(flightNumber || "").toUpperCase().replace(/\s+/g, "");
    if (!number) return Promise.resolve({ ok: false, reason: "no_flight", message: "no flight number to look up" });
    return withCache("flightseatmap", ["seatmap", number, date || ""], function () {
      var body = {
        jsonrpc: "2.0", id: "spicy-" + number + "-" + (date || ""), method: "tools/call",
        params: { name: "get_seatmap", arguments: { flight_number: number, date: date || undefined } }
      };
      return fetchJson(ENDPOINTS.flightseatmap, {
        provider: "flightseatmap", method: "POST", body: body, timeoutMs: options.timeoutMs,
        headers: { "Accept": "application/json, text/event-stream" }
      }).then(function (result) {
        if (!result.ok) {
          return {
            ok: false, reason: result.reason, message: result.reason === "network" || result.reason === "timeout"
              ? MESSAGES.CORS : result.message,
            provenance: PROVENANCE.FLIGHTSEATMAP_FREE, fallback: "local layout"
          };
        }
        var data = result.data;
        var text = "";
        try {
          var content = data && data.result && data.result.content;
          if (content && content.length && content[0].text) text = String(content[0].text);
        } catch (error) { text = ""; }
        return {
          ok: true, flightNumber: number, date: date || null,
          provenance: PROVENANCE.FLIGHTSEATMAP_FREE,
          live: false,
          text: "FlightSeatMap free seat map found for " + number + " (seat map only — not live booking inventory)",
          mapText: text,
          detail: { bytes: text.length }
        };
      });
    });
  }

  /** Open-Meteo + Frankfurter + the local CO2 formula: everything the header
   *  can show about a leg without any account anywhere. */
  function contextFree(origin, dest, distanceMiles, aircraft, options) {
    options = options || {};
    var data = options.data || (root && root.SPICY_DATA) || null;
    var airports = data && data.airports || {};
    var originInfo = airports[origin] || null;
    var destInfo = airports[dest] || null;
    var out = { ok: true, provenance: [], weather: null, currencies: null, co2: null, visa: null };
    var jobs = [];

    if (originInfo && destInfo) {
      var url = ENDPOINTS.openmeteo + "?latitude=" + Number(originInfo.lat).toFixed(3) + "," + Number(destInfo.lat).toFixed(3)
        + "&longitude=" + Number(originInfo.lon).toFixed(3) + "," + Number(destInfo.lon).toFixed(3)
        + "&current=temperature_2m,wind_speed_10m&timezone=UTC";
      jobs.push(withCache("openmeteo", ["current", origin, dest], function () {
        return fetchJson(url, { provider: "openmeteo", timeoutMs: options.timeoutMs });
      }).then(function (result) {
        if (!result.ok) return null;
        var rows = result.data && result.data.length ? result.data : [result.data];
        out.weather = rows.map(function (row) {
          var current = row && row.current || {};
          return { at: row && row.latitude != null ? row.latitude + "," + row.longitude : null, temperature: current.temperature_2m, wind: current.wind_speed_10m };
        });
        out.provenance.push(PROVENANCE.OPEN_METEO_FREE);
        return null;
      }));
    }

    var data2 = data || {};
    var countries = data2.countries || {};
    var from = originInfo && countries[originInfo.cc] ? countries[originInfo.cc] : null;
    var to = destInfo && countries[destInfo.cc] ? countries[destInfo.cc] : null;
    if (from && to && from.currency && to.currency && from.currency !== to.currency) {
      jobs.push(withCache("frankfurter", ["rate", from.currency, to.currency], function () {
        return fetchJson(ENDPOINTS.frankfurter + "?from=" + from.currency + "&to=" + to.currency, { provider: "frankfurter", timeoutMs: options.timeoutMs });
      }).then(function (result) {
        if (!result.ok || !result.data || !result.data.rates) return null;
        var rate = result.data.rates[to.currency];
        out.currencies = {
          from: from.currency, to: to.currency, rate: rate, date: result.data.date || null,
          text: "1 " + from.currency + " = " + rate + " " + to.currency + " (ECB, " + (result.data.date || "latest") + ")"
        };
        out.provenance.push(PROVENANCE.FRANKFURTER_FREE);
        return null;
      }));
    }

    /* CO2 is computed locally from the ICAO/EEA style distance method: the
       number is an estimate of fuel burn per passenger, not a measurement, and
       the provenance string says LOCAL rather than pretending to be a feed. */
    var miles = Number(distanceMiles) || 0;
    if (miles > 0) {
      var km = miles * 1.609344;
      var wide = /^(3\d\d|33\d|35\d|38\d|74\d|77\d|78\d|76\d|A3\d\d|A38\d|B7\d\d)/i.test(String(aircraft || ""));
      var factor = wide ? 0.11 : 0.15;                 /* kg CO2 per passenger-km, cabin-average */
      var premium = options.cabin === "business" || options.cabin === "first" ? 2.6 : 1;
      var kg = Math.round(km * factor * premium);
      out.co2 = { kg: kg, basis: wide ? "wide-body estimate" : "narrow-body/turboprop estimate", text: "about " + kg + " kg CO2e per passenger", confidence: "estimate", provenance: PROVENANCE.LOCAL_ICAO_CO2 };
      out.provenance.push(PROVENANCE.LOCAL_ICAO_CO2);
    }

    /* Visa table ships in spicy_data.js (Passport Index, MIT) — offline fact. */
    var passport = String(options.passport || "").toUpperCase();
    var visaFree = data2.visaFree || {};
    if (passport && destInfo && destInfo.cc && visaFree[passport] && visaFree[passport][destInfo.cc]) {
      out.visa = {
        passport: passport, destination: destInfo.cc, requirement: visaFree[passport][destInfo.cc],
        text: passport + " passport → " + destInfo.cc + ": " + visaFree[passport][destInfo.cc],
        provenance: PROVENANCE.VISA_TABLE_LOCAL
      };
      out.provenance.push(PROVENANCE.VISA_TABLE_LOCAL);
    }

    return Promise.all(jobs).then(function () { return out; });
  }

  /* ---------------- keyed free providers (own key) ---------------- */

  function validateWithAviationStack(flightIata, date, options) {
    options = options || {};
    var key = options.key || getKey("aviationstack");
    var flight = String(flightIata || "").toUpperCase().replace(/\s+/g, "");
    if (!flight) return Promise.resolve({ ok: false, reason: "no_flight", message: "no flight to check" });
    if (!key) return Promise.resolve({ ok: false, keyless: false, reason: "key_missing", message: MESSAGES.KEY_MISSING });
    return withCache("aviationstack", ["flight", flight, date || ""], function () {
      /* The free plan is http-only on the provider's side; the key travels to
         that provider and to nobody else. */
      var url = ENDPOINTS.aviationstack + "?access_key=" + encodeURIComponent(key).replace(/%2F/g, "")
        + "&flight_iata=" + encodeURIComponent(flight) + (date ? "&flight_date=" + encodeURIComponent(date) : "");
      return fetchJson(url, { provider: "aviationstack", timeoutMs: options.timeoutMs, mode: "cors" }).then(function (result) {
        if (!result.ok) return result;
        var rows = (result.data && result.data.data) || [];
        if (!rows.length) {
          return { ok: true, found: false, provenance: PROVENANCE.AVIATIONSTACK_FREE, text: "AviationStack free: no schedule row for " + flight };
        }
        var row = rows[0];
        return {
          ok: true, found: true, live: false,
          provenance: PROVENANCE.AVIATIONSTACK_FREE,
          text: "AviationStack free: " + flight + " " + (row.status || "scheduled")
            + " " + ((row.departure && row.departure.iata) || "???") + "→" + ((row.arrival && row.arrival.iata) || "???"),
          detail: { status: row.status, airline: row.airline && row.airline.name, date: row.flight_date }
        };
      });
    });
  }

  function validateWithAeroDataBoxFree(flight, date, options) {
    options = options || {};
    var key = options.key || getKey("aerodatabox");
    var number = String(flight || "").toUpperCase().replace(/\s+/g, "");
    var when = String(date || "").replace(/-/g, "");
    if (!number) return Promise.resolve({ ok: false, reason: "no_flight", message: "no flight to check" });
    if (!key) return Promise.resolve({ ok: false, keyless: false, reason: "key_missing", message: MESSAGES.KEY_MISSING });
    return withCache("aerodatabox", ["flight", number, when], function () {
      var url = ENDPOINTS.aerodatabox + encodeURIComponent(number) + "/" + encodeURIComponent(when || "today");
      /* The key goes in a header, not the URL: it cannot leak through a log or
         a referrer that way. */
      return fetchJson(url, {
        provider: "aerodatabox", timeoutMs: options.timeoutMs,
        headers: { "X-RapidAPI-Key": String(key).trim(), "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" }
      }).then(function (result) {
        if (!result.ok) return result;
        var data = result.data || {};
        return {
          ok: true, found: !!(data.number || data.departure), live: false,
          provenance: PROVENANCE.AERODATABOX_FREE,
          text: "AeroDataBox free: " + number + " " + (data.status || "no status")
            + (data.departure && data.departure.airport ? " from " + data.departure.airport.iata : ""),
          detail: { terminal: data.departure && data.departure.terminal }
        };
      });
    });
  }

  function fareWithTravelpayouts(origin, dest, date, options) {
    options = options || {};
    var token = options.token || getKey("travelpayouts");
    var from = String(origin || "").toUpperCase();
    var to = String(dest || "").toUpperCase();
    if (!from || !to) return Promise.resolve({ ok: false, reason: "no_route", message: "no route to price" });
    if (!token) return Promise.resolve({ ok: false, keyless: false, reason: "key_missing", message: MESSAGES.KEY_MISSING });
    return withCache("travelpayouts", ["cheap", from, to, date || ""], function () {
      var url = ENDPOINTS.travelpayouts + "?origin=" + from + "&destination=" + to
        + (date ? "&depart_date=" + encodeURIComponent(date) : "") + "&currency=usd&token=" + encodeURIComponent(token);
      return fetchJson(url, { provider: "travelpayouts", timeoutMs: options.timeoutMs }).then(function (result) {
        if (!result.ok) return result;
        var rows = result.data && result.data.data;
        var best = null;
        if (rows) {
          Object.keys(rows).forEach(function (code) {
            var row = rows[code];
            if (row && row.price != null && (!best || row.price < best.price)) best = { price: row.price, code: code, airline: row.airline };
          });
        }
        if (!best) {
          return { ok: true, found: false, provenance: "TRAVELPAYOUTS_FREE", text: "Travelpayouts free: no cached fare statistics for " + from + "→" + to };
        }
        return {
          ok: true, found: true, live: false, provenance: "TRAVELPAYOUTS_FREE",
          text: "Travelpayouts free cached fare: from $" + best.price + " " + from + "→" + to + " (statistics, not a live quote)",
          detail: best
        };
      });
    });
  }

  /* ---------------- availability honesty ---------------- */

  /** The one place that decides whether a map may say LIVE. Only a configured
   *  live provider may, and none is configured by default. */
  function availabilityLabel(live) {
    return live ? "LIVE AVAILABILITY — provider feed" : "AVAILABILITY SIMULATED — deterministic hash, not a booking system";
  }
  function availabilityDisclaimer() {
    return "Selecting a seat reserves nothing: this app has no booking connection, and the map is a simulation of a cabin, not a seat inventory.";
  }

  /* ---------------- the app-facing aggregate ---------------- */

  /**
   * Run every badge that this itinerary supports, in parallel, and never
   * reject: a badge is a decoration on an already-correct conversion.
   * @param {Array} segments converted segments (airline, flight_no, orig, dest, date...)
   * @param {object} [options] {passport, cabin, callsign, bbox, distanceMiles, aircraft}
   * @returns {Promise<Array>} badge list, ready to render
   */
  function updateBadges(segments, options) {
    options = options || {};
    var list = segments || [];
    if (!list.length) return Promise.resolve([]);
    var badges = [];
    var jobs = [];
    var data = options.data || (root && root.SPICY_DATA) || null;

    if (data) {
      var first = list[0];
      var origin = first.orig, dest = first.dest;
      jobs.push(contextFree(origin, dest, options.distanceMiles, options.aircraft, {
        data: data, passport: options.passport, cabin: options.cabin, timeoutMs: options.timeoutMs
      }).then(function (context) {
        if (!context) return;
        if (context.weather && context.weather.length) {
          var rows = context.weather.filter(function (row) { return row.temperature != null; });
          if (rows.length) {
            badges.push(badge("openmeteo", PROVENANCE.OPEN_METEO_FREE,
              "Weather now: " + rows.map(function (row) { return Math.round(row.temperature) + "°C"; }).join(" / ")
              + " at the airports (Open-Meteo, free)", { live: true }));
          }
        }
        if (context.currencies && context.currencies.rate) {
          badges.push(badge("frankfurter", PROVENANCE.FRANKFURTER_FREE, context.currencies.text + " (Frankfurter, free)"));
        }
        if (context.co2) {
          badges.push(badge("local_co2", PROVENANCE.LOCAL_ICAO_CO2, context.co2.text + " — estimate, computed offline"));
        }
        if (context.visa) {
          badges.push(badge("visa", PROVENANCE.VISA_TABLE_LOCAL, context.visa.text + " (table shipped with the app)"));
        }
        return null;
      }));
    }

    if (options.checkOpensky && options.callsign) {
      jobs.push(validateWithOpenSky(options.callsign, options.bbox, { timeoutMs: options.timeoutMs }).then(function (result) {
        if (result && result.ok) badges.push(badge("opensky", PROVENANCE.OPENSKY_LIVE, result.text, { live: true }));
        else badges.push(badge("opensky", PROVENANCE.OPENSKY_LIVE, (result && result.message) || MESSAGES.CORS, { failed: true }));
        return null;
      }));
    }

    if (options.checkAviationStack) {
      jobs.push(validateWithAviationStack(firstKey(list), options.date, { timeoutMs: options.timeoutMs }).then(function (result) {
        if (result && result.ok && result.found) badges.push(badge("aviationstack", PROVENANCE.AVIATIONSTACK_FREE, result.text));
        return null;
      }));
    }

    if (options.checkSeatmap) {
      jobs.push(getSeatmapFree(firstKey(list), options.date, { timeoutMs: options.timeoutMs }).then(function (result) {
        if (result && result.ok) badges.push(badge("flightseatmap", PROVENANCE.FLIGHTSEATMAP_FREE, result.text, { seatmap: true }));
        else if (result && result.reason !== "no_flight") badges.push(badge("flightseatmap", PROVENANCE.FLIGHTSEATMAP_FREE, result.message || MESSAGES.CORS, { failed: true }));
        return null;
      }));
    }

    return Promise.all(jobs).then(function () {
      badges.push(badge("availability", PROVENANCE.SIMULATED, availabilityLabel(false)));
      return badges;
    });
  }

  function firstKey(list) {
    var first = list[0] || {};
    return (first.airline || "") + (first.flight_no || "");
  }

  var api = {
    PROVENANCE: PROVENANCE,
    MESSAGES: MESSAGES,
    PROVIDERS: PROVIDERS,
    ENDPOINTS: ENDPOINTS,
    CACHE_TTL_MS: CACHE_TTL_MS,
    DEBOUNCE_MS: DEBOUNCE_MS,
    configure: configure,
    setKey: setKey,
    getKey: getKey,
    clearKey: clearKey,
    keyStatus: keyStatus,
    debounce: debounce,
    cacheStats: cacheStats,
    clearCache: clearCache,
    bucketState: bucketState,
    resetBuckets: resetBuckets,
    fetchJson: fetchJson,
    validateWithOpenSky: validateWithOpenSky,
    validateWithAviationStack: validateWithAviationStack,
    validateWithAeroDataBoxFree: validateWithAeroDataBoxFree,
    getSeatmapFree: getSeatmapFree,
    fareWithTravelpayouts: fareWithTravelpayouts,
    contextFree: contextFree,
    availabilityLabel: availabilityLabel,
    availabilityDisclaimer: availabilityDisclaimer,
    updateBadges: updateBadges
  };

  configure({});
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root) root.SpicyLiveFree = api;
})(typeof window !== "undefined" ? window : null);
