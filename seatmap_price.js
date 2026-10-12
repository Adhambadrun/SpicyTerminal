/* seatmap_price.js — the PRICE button on the Seat Map page.
 *
 * One button. One panel. One request. One flat sentence for every failure.
 *
 *   - the request is built from the active leg (converted itinerary or
 *     search result), only origin / destination / date / cabin / currency /
 *     adults. Nothing else from the converted itinerary is forwarded;
 *     conversion stays local;
 *   - the response is allowlisted: only source / amount / currency /
 *     fetchedAt / verdict / summary / scope make it onto the page;
 *   - every failure is mapped to a single flat sentence. The button never
 *     exposes the endpoint, the host, the port, the status code, the
 *     upstream body, the JSON key, or a traceback. If the page can't
 *     tell the user what is wrong in one human sentence, it says
 *     something general and stops.
 *   - the price block (button + panel) is fully hidden whenever a real
 *     fare isn't possible: no endpoint configured, health check fails,
 *     or the service returns no_fare. Never a visible "not connected"
 *     button.
 *
 * window.SPICY_PRICE_ENDPOINT is set at build time by build_web.py. The
 * empty string means "not connected on this site" — the price block is
 * hidden entirely.
 *
 * Exports as window.SpicySeatMapPrice (browser) and module.exports
 * (Node, for tests).
 */
(function (root) {
  "use strict";

  /* ---------------------------------------------------------------- *
   * Allowlists
   * ---------------------------------------------------------------- */

  /* The only fields the page can ever render. Anything else from the
     service is dropped silently. */
  var REPLY_FIELDS = ["source", "amount", "currency", "fetchedAt", "verdict", "summary", "scope"];

  /* The only fields the client can ever send. The service validates these
     too, but the client keeps the contract tight so a future build can
     never accidentally forward something. */
  var REQUEST_FIELDS = ["origin", "destination", "departure_date", "cabin_class", "currency", "adults"];

  /* The verdict values the page knows how to render. Anything else becomes
     "no verdict" and the panel still shows the amount. */
  var VERDICT_LABELS = {
    low:      "below the typical fare for this route and date",
    typical:  "around the typical fare for this route and date",
    high:     "above the typical fare for this route and date"
  };

  /* The same message in every case, the same shape on the page. The
     service returns ok=true / ok=false + kind, and the client never
     branches on the wire status. */
  var MESSAGES = {
    notConnected: "Price lookup is not connected on this site yet.",
    fetching:     "Looking up the fare now.",
    unavailable:  "The fare lookup is unavailable right now — it is not your flight, nothing is wrong with it.",
    noFare:       "No fare came back for this route and date — try a different date or check the airline.",
    notOnRoute:   "This is the cheapest on this route and date — not necessarily the flight drawn above.",
    notABooking:  "This is a quote, not a booking — no seat is reserved and no money changes hands here."
  };

  /* ---------------------------------------------------------------- *
   * Tiny helpers (no dependencies, no logging)
   * ---------------------------------------------------------------- */

  function $(id) { return (root.document || root).getElementById(id); }

  /* Read the endpoint at build-time. Empty string == not connected. */
  function endpoint() {
    if (typeof SPICY_PRICE_ENDPOINT !== "undefined" && SPICY_PRICE_ENDPOINT) return SPICY_PRICE_ENDPOINT;
    if (root && typeof root.SPICY_PRICE_ENDPOINT === "string") return root.SPICY_PRICE_ENDPOINT;
    return "";
  }

  function escapeText(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function cabinFor(cabinCode) {
    /* The engine writes cabins as "economy" / "premium_economy" /
       "business" / "first" already; unknown values become "economy"
       so the service still answers and the page still shows a fare. */
    var c = (cabinCode || "").toLowerCase();
    if (c === "economy" || c === "premium_economy" || c === "business" || c === "first") return c;
    return "economy";
  }

  function pickLeg(state) {
    /* The active source of truth: a converted itinerary leg, or a
       search-result flight, or the manual form. Only the identity is
       read; the converted itinerary's other fields never leave. */
    if (state && state.legs && state.legs.length) {
      var i = state.legIndex || 0;
      var leg = state.legs[i];
      if (leg && leg.origin && leg.destination && leg.departureDate) {
        return {
          source: "converted itinerary",
          airline: (leg.airline || "") + " " + (leg.flightNumber || ""),
          origin: leg.origin,
          destination: leg.destination,
          date: leg.departureDate,
          cabin: cabinFor(leg.cabin || leg.cabinCode),
          adults: 1
        };
      }
    }
    if (state && state.searched) {
      var f = state.searched;
      if (f.origin && f.destination) {
        var date = f.date || "";
        if (!date) {
          var t = new Date();
          t.setDate(t.getDate() + 1);
          date = t.toISOString().slice(0, 10);
        }
        var cabin = "";
        if (root.document) {
          var sel = root.document.getElementById("seatmapSearchCabin");
          if (sel) cabin = sel.value || "";
        }
        return {
          source: "search result",
          airline: (f.airline || "") + " " + (f.number || f.flightNumber || ""),
          origin: f.origin,
          destination: f.destination,
          date: date,
          cabin: cabinFor(cabin || "economy"),
          adults: 1
        };
      }
    }
    if (root.document) {
      var o = root.document.getElementById("seatmapOrigin");
      var d = root.document.getElementById("seatmapDestination");
      var dt = root.document.getElementById("seatmapDate");
      var cb = root.document.getElementById("seatmapManualCabin");
      if (o && d && o.value && d.value) {
        return {
          source: "manual form",
          airline: "",
          origin: (o.value || "").toUpperCase(),
          destination: (d.value || "").toUpperCase(),
          date: (dt && dt.value) || new Date().toISOString().slice(0, 10),
          cabin: cabinFor(cb && cb.value),
          adults: 1
        };
      }
    }
    return null;
  }

  function buildQuery(leg) {
    if (!leg) return null;
    var cabin = leg.cabin;
    /* A cabin value is one of "economy" / "premium_economy" / "business" /
       "first" when given. An explicit null means "do not send a cabin"
       (the field is dropped — the service refuses the request anyway).
       An undefined or missing value defaults to "economy" so the common
       case just works. */
    if (cabin === null) {
      cabin = null;
    } else if (typeof cabin === "string") {
      cabin = cabin.toLowerCase();
      if (cabin !== "economy" && cabin !== "premium_economy" && cabin !== "business" && cabin !== "first") {
        cabin = "economy";
      }
    } else {
      cabin = "economy";
    }
    var q = {
      origin: (leg.origin || "").toUpperCase(),
      destination: (leg.destination || "").toUpperCase(),
      departure_date: leg.date,
      cabin_class: cabin,
      currency: "USD",
      adults: leg.adults || 1
    };
    REQUEST_FIELDS.forEach(function (k) {
      if (q[k] == null || q[k] === "") delete q[k];
    });
    return q;
  }

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */

  function renderNotice(panel, lines) {
    if (!panel) return;
    panel.innerHTML = lines.map(function (line) {
      return "<p class=\"seatmap-price-line\">" + escapeText(line) + "</p>";
    }).join("");
  }

  function fetchMinute(fetchedAt) {
    /* "2026-10-12T08:34Z" -> "08:34 UTC". Anything weird -> "". */
    if (!fetchedAt || typeof fetchedAt !== "string") return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(fetchedAt);
    if (!m) return "";
    return m[4] + ":" + m[5] + " UTC";
  }

  function render(panel, fields, extraLines) {
    if (!panel) return;
    var amountNum = (typeof fields.amount === "number" && fields.amount > 0) ? fields.amount : null;
    var amount = amountNum != null ? String(amountNum) : "";
    var currency = fields.currency || "USD";
    var fmt = amount ? (currency + " " + amount) : "";
    var verdict = VERDICT_LABELS[fields.verdict] || "";
    var minute = fetchMinute(fields.fetchedAt);
    var lines = [];
    if (fields.source) {
      lines.push("Source: " + fields.source + (minute ? ", fetched at " + minute : "."));
    } else {
      lines.push("Source: a price-quote service, fetched just now.");
    }
    if (fmt) {
      lines.push("Fare: " + fmt + (verdict ? " — " + verdict + "." : "."));
    }
    if (fields.summary) {
      lines.push("Flight: " + fields.summary + ".");
    }
    if (fields.scope) {
      lines.push("Scope: " + fields.scope);
    }
    if (extraLines && extraLines.length) {
      extraLines.forEach(function (l) { lines.push(l); });
    }
    lines.push(MESSAGES.notABooking);
    panel.innerHTML = lines.map(function (line) {
      return "<p class=\"seatmap-price-line\">" + escapeText(line) + "</p>";
    }).join("");
  }

  /* ---------------------------------------------------------------- *
   * Price block visibility
   * ---------------------------------------------------------------- */

  function setDisplay(element, value) {
    /* The panel stub in the test harness has no style object, so this
       stays defensive: a node without .style is simply left alone. */
    if (element && element.style) element.style.display = value;
  }

  /* The whole price block — the wrapping card, the button, the panel and the
     one-line note — is hidden together whenever a real fare isn't possible.
     Never a visible "not connected" button. The panel text is cleared with it
     so a later re-show can never flash a stale quote. */
  function hidePriceBlock() {
    setDisplay($("seatmapPriceBlock"), "none");
    setDisplay($("seatmapPriceButton"), "none");
    setDisplay($("seatmapPriceResult"), "none");
    setDisplay($("seatmapPriceNote"), "none");
    var panel = $("seatmapPriceResult");
    if (panel && typeof panel.innerHTML === "string") panel.innerHTML = "";
  }

  function showPriceBlock() {
    setDisplay($("seatmapPriceBlock"), "");
    setDisplay($("seatmapPriceButton"), "");
    setDisplay($("seatmapPriceResult"), "");
    setDisplay($("seatmapPriceNote"), "");
  }

  /* ---------------------------------------------------------------- *
   * Health check
   * ---------------------------------------------------------------- */

  function checkHealth(url, callback) {
    /* Probe the /healthz endpoint to see if the fare service is live.
       Callback receives true (healthy) or false (unavailable).

       The probe is a plain GET on the service's own health route; the two
       shapes the account-backed backend answers with are both accepted:
       {"status":"ok"} (Vercel/Netlify function) and {"ok":true} (the
       tools/price_service host). Anything else means "no fare is possible
       here right now" and the block stays hidden. */
    var healthUrl = url.replace(/\/api\/flights\/price$/, "/healthz");
    var xhr = new XMLHttpRequest();
    var settled = false;
    try {
      xhr.open("GET", healthUrl, true);
    } catch (e) {
      callback(false);
      return;
    }
    xhr.timeout = 5000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || settled) return;
      settled = true;
      var ok = false;
      try {
        var body = JSON.parse(xhr.responseText);
        ok = !!(body && (body.status === "ok" || body.ok === true));
      } catch (e) {
        ok = false;
      }
      callback(ok);
    };
    xhr.ontimeout = function () {
      if (settled) return;
      settled = true;
      callback(false);
    };
    xhr.onerror = function () {
      if (settled) return;
      settled = true;
      callback(false);
    };
    try {
      xhr.send();
    } catch (e) {
      if (settled) return;
      settled = true;
      callback(false);
    }
  }

  /* ---------------------------------------------------------------- *
   * The button
   * ---------------------------------------------------------------- */

  function isActiveLegMatchingReply(leg, fields) {
    /* The service returns the cheapest fare on the route/date, not
       necessarily the flight the user is looking at. The page surfaces
       that honestly when the airline/flight number on the reply doesn't
       match the airline/flight number of the leg the user picked. */
    if (!leg || !fields || !fields.summary) return false;
    var wanted = ((leg.airline || "").replace(/\s+/g, " ")).trim();
    if (!wanted) return false;
    return fields.summary.indexOf(wanted) >= 0;
  }

  function doLookup(doc, state) {
    var panel = $("seatmapPriceResult");
    var button = $("seatmapPriceButton");
    var url = endpoint();
    if (!url) {
      hidePriceBlock();
      return;
    }
    var leg = pickLeg(state);
    if (!leg) {
      renderNotice(panel, ["No flight is loaded yet. Convert an itinerary or search by flight number, then try the price."]);
      return;
    }
    var query = buildQuery(leg);
    if (!query || !query.origin || !query.destination || !query.departure_date) {
      renderNotice(panel, ["The flight is missing a route or a date. Pick one above and try the price."]);
      return;
    }
    if (button) button.disabled = true;
    renderNotice(panel, [MESSAGES.fetching]);

    var qs = [];
    REQUEST_FIELDS.forEach(function (k) {
      if (query[k] != null) qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(query[k]));
    });
    var fullUrl = url + (url.indexOf("?") >= 0 ? "&" : "?") + qs.join("&");

    var xhr = new XMLHttpRequest();
    var settled = false;
    try {
      xhr.open("GET", fullUrl, true);
    } catch (e) {
      /* The request could not even be opened (CSP, offline, blocked):
         a real fare is impossible, so the whole block goes away. */
      if (button) button.disabled = false;
      hidePriceBlock();
      return;
    }
    xhr.timeout = 35000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || settled) return;
      settled = true;
      if (button) button.disabled = false;

      var ok = false;
      var body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch (e) {
        body = null;
      }
      /* The client never branches on the HTTP status. It only branches on
         the trimmed JSON the service promised to return. */
      if (body && typeof body === "object") {
        if (body.ok === true) {
          var fields = {};
          REPLY_FIELDS.forEach(function (k) {
            if (body[k] != null) fields[k] = body[k];
          });
          var extras = [];
          if (!isActiveLegMatchingReply(leg, fields)) {
            extras.push(MESSAGES.notOnRoute);
          }
          render(panel, fields, extras);
          ok = true;
        } else if (body.ok === false && body.kind === "no_fare") {
          /* No fare available — hide the price block entirely. */
          hidePriceBlock();
          ok = true;
        }
      }
      if (!ok) {
        /* Network error, non-JSON reply, or anything we don't recognise:
           the service is unavailable. Hide the price block. */
        hidePriceBlock();
      }
    };
    xhr.ontimeout = function () {
      if (settled) return;
      settled = true;
      if (button) button.disabled = false;
      hidePriceBlock();
    };
    xhr.onerror = function () {
      if (settled) return;
      settled = true;
      if (button) button.disabled = false;
      hidePriceBlock();
    };
    try {
      xhr.send();
    } catch (e) {
      if (settled) return;
      settled = true;
      if (button) button.disabled = false;
      hidePriceBlock();
    }
  }

  function attach(doc, state) {
    var button = $("seatmapPriceButton");
    var panel = $("seatmapPriceResult");
    if (!button || !panel) return;

    /* Start hidden and prove the service is there before the block is
       allowed on screen: no flash of a button that then disappears. */
    hidePriceBlock();

    /* If no endpoint is configured, the block stays hidden. */
    var url = endpoint();
    if (!url) return;

    /* Probe the health endpoint to verify the fare service is live.
       The block appears only while the service answers the probe. */
    checkHealth(url, function (healthy) {
      if (healthy) {
        showPriceBlock();
        button.addEventListener("click", function () { doLookup(doc, state); });
      } else {
        hidePriceBlock();
      }
    });
  }

  /* ---------------------------------------------------------------- *
   * Exposed surface (for tests under Node and for the page under the
   * browser). The test suite reads every method and every constant
   * below, so additions must keep the names.
   * ---------------------------------------------------------------- */

  var api = {
    REPLY_FIELDS: REPLY_FIELDS,
    REQUEST_FIELDS: REQUEST_FIELDS,
    VERDICT_LABELS: VERDICT_LABELS,
    MESSAGES: MESSAGES,
    endpoint: endpoint,
    pickLeg: pickLeg,
    buildQuery: buildQuery,
    isActiveLegMatchingReply: isActiveLegMatchingReply,
    fetchMinute: fetchMinute,
    render: render,
    renderNotice: renderNotice,
    escapeText: escapeText,
    doLookup: doLookup,
    attach: attach,
    hidePriceBlock: hidePriceBlock,
    showPriceBlock: showPriceBlock,
    checkHealth: checkHealth
  };

  /* ---------------------------------------------------------------- *
   * Page bootstrap — the /seatmap route only
   * ---------------------------------------------------------------- */

  function bootstrap(doc) {
    /* Only the Seat Map page carries the PRICE block. Every other route
       leaves the module loaded but idle. */
    var location = root.location;
    if (!location || String(location.pathname).replace(/\/+$/, "") !== "/seatmap") return;
    var seatmap = root.SpicySeatMap;
    var state = (seatmap && seatmap.pageState) || {};
    attach(doc, state);
  }

  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.SpicySeatMapPrice = api;
    if (root.document) {
      if (root.document.readyState === "loading") {
        root.document.addEventListener("DOMContentLoaded", function () { bootstrap(root.document); }, { once: true });
      } else {
        bootstrap(root.document);
      }
    }
  }
}(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this)));