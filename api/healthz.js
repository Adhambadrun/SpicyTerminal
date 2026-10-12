/**
 * GET /healthz — the probe the Seat Map page asks before it will show the
 * PRICE block.
 *
 *   200 { status: "ok" }           at least one account-backed fare provider
 *                                  is configured and answering
 *   503 { status: "unavailable" }  no provider is configured (or the only
 *                                  provider cannot be reached)
 *
 * The block is hidden unless this probe answers 200, so a page deployed
 * without provider credentials never shows a PRICE button at all — and never
 * a visible "not connected" one.
 */
"use strict";

const fare = require("./_fare.js");

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
    return send(res, 405, { status: "unavailable" });
  }
  let result;
  try {
    result = await fare.checkHealth();
  } catch (error) {
    return send(res, 503, { status: "unavailable" });
  }
  return send(res, result.status, result.body);
};
