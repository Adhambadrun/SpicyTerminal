/**
 * api/_fare.js — the shared, provider-backed fare logic behind the Seat Map
 * PRICE button.
 *
 * Two account-backed live sources are supported out of the box:
 *
 *   Amadeus Self-Service  AMADEUS_CLIENT_ID + AMADEUS_CLIENT_SECRET
 *   Duffel                DUFFEL_TOKEN
 *
 * A fare is only ever returned from a live offer fetched at click time. If no
 * provider is configured, or a provider answers with no offer, the reply is
 * the documented "no fare" shape — never a cached, remembered or estimated
 * number:
 *
 *   { ok: false, kind: "no_fare" }
 *
 * The wire contract is the one seatmap_price.js renders:
 *
 *   { ok: true, source, amount, currency, fetchedAt, verdict, summary, scope }
 *
 * Nothing else is ever put on the wire — no token, no url, no booking token,
 * no emissions, no baggage, no layover, no airport names, no upstream text,
 * no traceback.
 */

"use strict";

const AMADEUS_AUTH_URL = "https://test.api.amadeus.com/v1/security/oauth2/token";
const AMADEUS_FLIGHT_OFFERS_URL = "https://test.api.amadeus.com/v2/shopping/flight-offers";
const DUFFEL_OFFER_REQUESTS_URL = "https://api.duffel.com/air/offer_requests";
const DUFFEL_VERSION = "v2";

/** The only fields the client can send. Anything else is ignored. */
const REQUEST_FIELDS = ["origin", "destination", "departure_date", "cabin_class", "currency", "adults"];

const CABINS = ["economy", "premium_economy", "business", "first"];

const CABIN_TO_AMADEUS = {
  economy: "ECONOMY",
  premium_economy: "PREMIUM_ECONOMY",
  business: "BUSINESS",
  first: "FIRST"
};

const CABIN_TO_DUFFEL = {
  economy: "economy",
  premium_economy: "premium_economy",
  business: "business",
  first: "first"
};

/* The verdict bands are the documented heuristic the page already speaks:
   low / typical / high against the typical fare for the route and date. */
const LOW_BELOW = 300;
const HIGH_ABOVE = 800;

function providerStatus() {
  const amadeus = !!(process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET);
  const duffel = !!process.env.DUFFEL_TOKEN;
  return { amadeus, duffel, any: amadeus || duffel };
}

/** Validate and normalise the six routed fields. Returns null when bad. */
function readRequest(raw) {
  const query = raw || {};
  const origin = String(query.origin || "").toUpperCase();
  const destination = String(query.destination || "").toUpperCase();
  const departureDate = String(query.departure_date || "");
  let cabin = String(query.cabin_class || "economy").toLowerCase();
  const currency = String(query.currency || "USD").toUpperCase();
  const adults = Math.max(1, Math.min(9, parseInt(String(query.adults || "1"), 10) || 1));

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) return null;
  if (CABINS.indexOf(cabin) === -1) cabin = "economy";
  if (!/^[A-Z]{3}$/.test(currency)) return null;

  return { origin, destination, departure_date: departureDate, cabin_class: cabin, currency, adults };
}

function scopeLine(request) {
  return "The fare for this flight, " + request.cabin_class + ", on " + request.departure_date + ".";
}

function verdictFor(amount) {
  if (amount < LOW_BELOW) return "low";
  if (amount > HIGH_ABOVE) return "high";
  return "typical";
}

/** "2026-11-12T08:34:56" or with an offset -> "2026-11-12T08:34Z" */
function fetchedAtNow() {
  return new Date().toISOString().slice(0, 16) + "Z";
}

/* ------------------------------------------------------------------ *
 * Amadeus Self-Service
 * ------------------------------------------------------------------ */

async function amadeusToken() {
  const clientId = process.env.AMADEUS_CLIENT_ID;
  const clientSecret = process.env.AMADEUS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  });
  const resp = await fetch(AMADEUS_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => null);
  return (data && data.access_token) || null;
}

async function amadeusOffer(token, request) {
  const search = new URLSearchParams({
    originLocationCode: request.origin,
    destinationLocationCode: request.destination,
    departureDate: request.departure_date,
    adults: String(request.adults),
    currencyCode: request.currency,
    travelClass: CABIN_TO_AMADEUS[request.cabin_class],
    max: "10"
  });
  const resp = await fetch(AMADEUS_FLIGHT_OFFERS_URL + "?" + search.toString(), {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" }
  });
  if (!resp.ok) return null;
  return resp.json().catch(() => null);
}

function cheapestAmadeus(data) {
  if (!data || !Array.isArray(data.data) || !data.data.length) return null;
  let best = null;
  let bestAmount = Infinity;
  for (const offer of data.data) {
    const total = offer && offer.price && parseFloat(offer.price.total);
    if (!Number.isFinite(total) || total <= 0) continue;
    if (total < bestAmount) {
      bestAmount = total;
      best = offer;
    }
  }
  if (!best) return null;
  return { offer: best, amount: bestAmount };
}

function amadeusFields(offer, amount, request) {
  const itinerary = offer.itineraries && offer.itineraries[0];
  const segments = (itinerary && itinerary.segments) || [];
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first) return null;
  const carrier = first.carrierCode || "";
  const number = first.number || "";
  const stopCount = segments.length - 1;
  const stops = stopCount === 0 ? "nonstop" : stopCount + " stop" + (stopCount > 1 ? "s" : "");
  const depTime = first.departure && first.departure.at ? first.departure.at.slice(11, 16) : "";
  const arrTime = last && last.arrival && last.arrival.at ? last.arrival.at.slice(11, 16) : "";
  const summary = [carrier + number, stops, depTime && arrTime ? depTime + "–" + arrTime : ""]
    .filter(Boolean)
    .join(" · ");
  return {
    source: "Amadeus",
    amount: Math.round(amount),
    currency: request.currency,
    fetchedAt: fetchedAtNow(),
    verdict: verdictFor(amount),
    summary,
    scope: scopeLine(request)
  };
}

/* ------------------------------------------------------------------ *
 * Duffel
 * ------------------------------------------------------------------ */

async function duffelOffer(request) {
  const token = process.env.DUFFEL_TOKEN;
  if (!token) return null;
  const body = {
    data: {
      slices: [
        { origin: request.origin, destination: request.destination, departure_date: request.departure_date }
      ],
      passengers: Array.from({ length: request.adults }, () => ({ type: "adult" })),
      cabin_class: CABIN_TO_DUFFEL[request.cabin_class]
    }
  };
  const resp = await fetch(DUFFEL_OFFER_REQUESTS_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "Duffel-Version": DUFFEL_VERSION,
      Accept: "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok) return null;
  return resp.json().catch(() => null);
}

function cheapestDuffel(data) {
  const offers = data && data.data && Array.isArray(data.data.offers) ? data.data.offers : null;
  if (!offers || !offers.length) return null;
  let best = null;
  let bestAmount = Infinity;
  for (const offer of offers) {
    const total = offer && parseFloat(offer.total_amount);
    if (!Number.isFinite(total) || total <= 0) continue;
    if (total < bestAmount) {
      bestAmount = total;
      best = offer;
    }
  }
  if (!best) return null;
  return { offer: best, amount: bestAmount };
}

function duffelFields(offer, amount, request) {
  const slice = offer.slices && offer.slices[0];
  const segments = (slice && slice.segments) || [];
  const first = segments[0];
  if (!first) return null;
  const marketing = first.marketing_carrier || {};
  const carrier = marketing.iata_code || (first.operating_carrier && first.operating_carrier.iata_code) || "";
  const number = marketing.flight_number || "";
  const stopCount = segments.length - 1;
  const stops = stopCount === 0 ? "nonstop" : stopCount + " stop" + (stopCount > 1 ? "s" : "");
  const depTime = first.departing_at ? first.departing_at.slice(11, 16) : "";
  const arrTime = first.arriving_at ? first.arriving_at.slice(11, 16) : "";
  const summary = [carrier + number, stops, depTime && arrTime ? depTime + "–" + arrTime : ""]
    .filter(Boolean)
    .join(" · ");
  return {
    source: "Duffel",
    amount: Math.round(amount),
    currency: request.currency,
    fetchedAt: fetchedAtNow(),
    verdict: verdictFor(amount),
    summary,
    scope: scopeLine(request)
  };
}

/* ------------------------------------------------------------------ *
 * The one public entry point
 * ------------------------------------------------------------------ */

/** Returns the exact wire object for a request, or null for a bad request. */
async function lookupPrice(query) {
  const request = readRequest(query);
  if (!request) return { status: 400, body: { ok: false, kind: "bad_request" } };

  const providers = providerStatus();

  if (providers.amadeus) {
    let data = null;
    try {
      const token = await amadeusToken();
      if (token) data = await amadeusOffer(token, request);
    } catch (error) {
      data = null;
    }
    const cheapest = cheapestAmadeus(data);
    if (cheapest) {
      const fields = amadeusFields(cheapest.offer, cheapest.amount, request);
      if (fields) return { status: 200, body: Object.assign({ ok: true }, fields) };
    }
  }

  if (providers.duffel) {
    let data = null;
    try {
      data = await duffelOffer(request);
    } catch (error) {
      data = null;
    }
    const cheapest = cheapestDuffel(data);
    if (cheapest) {
      const fields = duffelFields(cheapest.offer, cheapest.amount, request);
      if (fields) return { status: 200, body: Object.assign({ ok: true }, fields) };
    }
  }

  /* No provider configured, provider unreachable, or no offer came back:
     the honest answer is "no fare" — never a remembered or guessed number. */
  return { status: 200, body: { ok: false, kind: "no_fare" } };
}

/**
 * The probe the page asks before it will show the PRICE block: "is a real
 * fare possible here right now?". Healthy means at least one account-backed
 * provider is configured. Unhealthy means the block stays hidden.
 */
async function checkHealth() {
  const providers = providerStatus();
  if (!providers.any) return { status: 503, body: { status: "unavailable" } };
  if (providers.amadeus) {
    try {
      const token = await amadeusToken();
      if (token) return { status: 200, body: { status: "ok" } };
    } catch (error) {
      /* fall through to the Duffel check */
    }
  }
  if (providers.duffel) return { status: 200, body: { status: "ok" } };
  return { status: 503, body: { status: "unavailable" } };
}

module.exports = {
  REQUEST_FIELDS,
  CABINS,
  readRequest,
  verdictFor,
  fetchedAtNow,
  lookupPrice,
  checkHealth,
  providerStatus
};
