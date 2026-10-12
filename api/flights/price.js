/**
 * GET /api/flights/price — the fare backend behind the Seat Map PRICE button.
 *
 * Query (the exact six routed fields seatmap_price.js can send):
 *   origin, destination, departure_date, cabin_class, currency, adults
 *
 * Replies (the exact contract the page renders — nothing else):
 *   { ok: true, source, amount, currency, fetchedAt, verdict, summary, scope }
 *   { ok: false, kind: "no_fare" }        no live offer came back
 *   { ok: false, kind: "bad_request" }    400, malformed query
 *
 * A fare is only ever a live, account-backed offer (Amadeus Self-Service or
 * Duffel) fetched at click time. Without provider credentials the endpoint
 * answers no_fare — it never invents, caches or estimates a price.
 *
 * Set these in the Vercel/Netlify project environment (either pair works):
 *   AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET
 *   DUFFEL_TOKEN
 *
 * Runs on Vercel (req.query pre-parsed) and on Netlify / plain Node http
 * (query read from req.url).
 */
"use strict";

const fare = require("../_fare.js");

function readQuery(req) {
  if (req.query && typeof req.query === "object") return req.query;
  const url = String(req.url || "");
  const question = url.indexOf("?");
  if (question < 0) return {};
  const params = new URLSearchParams(url.slice(question + 1));
  const out = {};
  params.forEach(function (value, key) { out[key] = value; });
  return out;
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  if (typeof res.status === "function" && typeof res.send === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(status).send(payload);
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

module.exports = async function handler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, { ok: false, kind: "method_not_allowed" });
  }

  let result;
  try {
    result = await fare.lookupPrice(readQuery(req));
  } catch (error) {
    /* One flat sentence on the page: any unexpected failure is "unavailable",
       which the client renders as a hide. No upstream text ever leaves. */
    return send(res, 502, { ok: false, kind: "unavailable" });
  }
  return send(res, result.status, result.body);
};
