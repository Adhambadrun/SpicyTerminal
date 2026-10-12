/* seatmap_flights.js — the Seat Map's local flight lookup.
 *
 * WHAT THIS IS
 * ------------
 * A small, offline answer to "which aircraft is flight BA 117, and what does
 * its cabin look like?" — the question seatmaps.com answers against a live
 * schedule. There is no schedule here: SpicyTerminal is a converter that runs
 * in one tab with no backend, no airline feed and no API key. So the lookup is
 * layered, and every layer says out loud how much it knows:
 *
 *   1. LOCAL FLIGHT TABLE  — the flight number's published route and the type
 *      usually assigned to it. Short on purpose: only entries we are willing
 *      to stand behind. Labelled as reference, never as a live assignment.
 *   2. THE CONVERTER'S OWN TABLE — `flightEquipment` in spicy_data.js: types
 *      this converter has actually read out of real itineraries. It gives the
 *      aircraft without a route, which is enough to draw the cabin.
 *   3. ROUTE / AIRLINE FALLBACK — `routeEquipment` then `airlineEquipment`
 *      from spicy_data.js: the type we would infer for that airline on that
 *      route, or that airline's typical type. Presented as an inference.
 *   4. NOTHING — then the page says so and hands the user the full aircraft
 *      list to pick from, instead of inventing a flight.
 *
 * WHAT IT NEVER IS
 * ----------------
 * A live schedule, a tail-number assignment, or a promise that the aircraft
 * flying today is the one drawn. Airlines substitute aircraft daily; the page
 * repeats that, and links to the airline where the real seat map lives.
 *
 * ADDING AN ENTRY: `f(airline, number, origin, destination, iataType)` — the
 * flight number's published route and the type normally assigned to it. Five
 * fields, no guessing: an entry nobody can stand behind is worse than a
 * fallback that says "inferred".
 */
(function (root) {
  "use strict";

  var DB_VERSION = "1";
  var DB_UPDATED = "2026-10-12";

  function f(airline, number, origin, destination, type) {
    return {
      airline: String(airline).toUpperCase(),
      number: String(number),
      origin: String(origin).toUpperCase(),
      destination: String(destination).toUpperCase(),
      equipment: String(type).toUpperCase()
    };
  }

  /* ------------------------------------------------------------------ *
   * TIER 1 — the local flight table.
   * Flight number -> published route + the type usually assigned to it.
   * ------------------------------------------------------------------ */
  var FLIGHTS = [
    /* British Airways */
    f("BA", "117", "LHR", "JFK", "77W"),
    f("BA", "116", "JFK", "LHR", "77W"),
    /* Emirates */
    f("EK", "1", "DXB", "LHR", "388"),
    f("EK", "2", "LHR", "DXB", "388"),
    f("EK", "3", "DXB", "LHR", "388"),
    f("EK", "4", "LHR", "DXB", "388"),
    f("EK", "201", "DXB", "JFK", "388"),
    f("EK", "202", "JFK", "DXB", "388"),
    f("EK", "203", "DXB", "JFK", "388"),
    f("EK", "204", "JFK", "DXB", "388"),
    f("EK", "225", "DXB", "SFO", "388"),
    f("EK", "226", "SFO", "DXB", "388"),
    /* Qantas */
    f("QF", "1", "SYD", "LHR", "388"),
    f("QF", "2", "LHR", "SYD", "388"),
    f("QF", "9", "PER", "LHR", "789"),
    f("QF", "10", "LHR", "PER", "789"),
    f("QF", "11", "SYD", "LAX", "388"),
    f("QF", "12", "LAX", "SYD", "388"),
    /* American */
    f("AA", "100", "JFK", "LHR", "77W"),
    f("AA", "101", "LHR", "JFK", "77W"),
    f("AA", "1", "JFK", "LAX", "321"),
    /* Turkish */
    f("TK", "1", "IST", "JFK", "77W"),
    f("TK", "2", "JFK", "IST", "77W"),
    /* EgyptAir */
    f("MS", "777", "CAI", "LHR", "77W"),
    f("MS", "778", "LHR", "CAI", "77W"),
    f("MS", "985", "CAI", "JFK", "789"),
    f("MS", "986", "JFK", "CAI", "789")
  ];

  var SOURCE_LABELS = {
    table: "LOCAL FLIGHT TABLE",
    converter: "CONVERTER'S OWN FLIGHT TABLE",
    route: "INFERRED FROM THIS AIRLINE ON THIS ROUTE",
    airline: "INFERRED FROM THIS AIRLINE'S FLEET",
    none: "NOT IN THE LOCAL TABLES"
  };

  function normalizeCode(value, max) {
    var text = String(value == null ? "" : value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return max ? text.slice(0, max) : text;
  }

  function data_() {
    if (typeof SPICY_DATA !== "undefined" && SPICY_DATA) return SPICY_DATA;
    if (root && root.SPICY_DATA) return root.SPICY_DATA;
    return null;
  }

  /** The flight number as the user typed it, split into carrier + digits.
   *  Accepts "BA117", "ba 117", "BA-117", "117" (with an airline supplied). */
  function parseFlightNumber(text, airlineHint) {
    var raw = String(text == null ? "" : text).trim().toUpperCase();
    if (!raw) return null;
    var m = /^([A-Z]{2}|[A-Z][0-9])\s*[-\s]?\s*([0-9]{1,4}[A-Z]?)$/.exec(raw);
    if (m) return { airline: m[1], number: m[2] };
    var n = /^([0-9]{1,4}[A-Z]?)$/.exec(raw);
    if (n && airlineHint) return { airline: normalizeCode(airlineHint, 2), number: n[1] };
    return null;
  }

  /** Two airport codes, in any of the ways people type them: "CAI LHR",
   *  "CAI-LHR", "CAI to LHR", "CAI>LHR". */
  function parseRoute(text) {
    var raw = String(text == null ? "" : text).trim().toUpperCase().replace(/\s+/g, " ");
    var m = /^([A-Z]{3})\s*(?:-|\/|>|TO|→|\s)\s*([A-Z]{3})$/.exec(raw);
    if (!m) return null;
    return { origin: m[1], destination: m[2] };
  }

  /** One free-text query -> what the user meant, or null. */
  function parseQuery(text, airlineHint) {
    var raw = String(text == null ? "" : text).trim().toUpperCase().replace(/\s+/g, " ");
    if (!raw) return null;
    var withRoute = /^([A-Z]{2}|[A-Z][0-9])\s*[-\s]?\s*([0-9]{1,4}[A-Z]?)\s+([A-Z]{3})\s*(?:-|\/|>|TO|→|\s)\s*([A-Z]{3})$/.exec(raw);
    if (withRoute) {
      return { kind: "flight", airline: withRoute[1], number: withRoute[2], origin: withRoute[3], destination: withRoute[4] };
    }
    var flight = parseFlightNumber(raw, airlineHint);
    if (flight) return { kind: "flight", airline: flight.airline, number: flight.number };
    var route = parseRoute(raw);
    if (route) return { kind: "route", origin: route.origin, destination: route.destination };
    return null;
  }

  /** Exact match in the local flight table. */
  function find(airline, number, origin, destination) {
    var carrier = normalizeCode(airline, 2);
    var digits = String(number == null ? "" : number).trim().toUpperCase();
    if (!carrier || !digits) return null;
    var from = normalizeCode(origin, 3);
    var to = normalizeCode(destination, 3);
    var matches = FLIGHTS.filter(function (entry) {
      return entry.airline === carrier && entry.number === digits
        && (!from || entry.origin === from)
        && (!to || entry.destination === to);
    });
    return matches.length ? matches : null;
  }

  /** Every flight in the table on a route (either direction unless told). */
  function byRoute(origin, destination, airline) {
    var from = normalizeCode(origin, 3);
    var to = normalizeCode(destination, 3);
    var carrier = normalizeCode(airline, 2);
    if (!from || !to) return [];
    return FLIGHTS.filter(function (entry) {
      if (carrier && entry.airline !== carrier) return false;
      return (entry.origin === from && entry.destination === to)
        || (entry.origin === to && entry.destination === from);
    });
  }

  /** Tier 2: the aircraft this converter has read for that flight number. */
  function converterType(airline, number, data) {
    var table = (data || data_()) && (data || data_()).flightEquipment;
    if (!table) return null;
    var carrier = normalizeCode(airline, 2);
    var digits = String(number == null ? "" : number).trim();
    var key = carrier + "|" + digits;
    var type = table[key];
    if (!type) {
      /* Some tables carry the carrier inside the number ("AA100"). */
      type = table[carrier + digits];
    }
    return type ? String(type).toUpperCase() : null;
  }

  /** Tier 3: the type we would infer for an airline on a route. */
  function routeType(airline, origin, destination, data) {
    var source = data || data_();
    if (!source) return null;
    var carrier = normalizeCode(airline, 2);
    var from = normalizeCode(origin, 3);
    var to = normalizeCode(destination, 3);
    var table = source.routeEquipment || {};
    var both = table[carrier + "|" + from + "|" + to] || table[carrier + "|" + to + "|" + from];
    if (both) return { equipment: String(both).toUpperCase(), source: "route" };
    var fleet = source.airlineEquipment || {};
    var list = fleet[carrier];
    if (list && list.length) return { equipment: String(list[0]).toUpperCase(), source: "airline" };
    return null;
  }

  /**
   * The layered lookup: flight number first, then the converter's own table,
   * then what we can infer from the route or the airline.
   * @returns {{kind:string, equipment:?string, source:string, sourceLabel:string,
   *            origin:?string, destination:?string, flights:Array}}
   */
  function lookup(airline, number, options) {
    var opts = options || {};
    var carrier = normalizeCode(airline, 2);
    var digits = String(number == null ? "" : number).trim().toUpperCase();
    if (!carrier || !digits) return { kind: "empty", equipment: null, source: "none", sourceLabel: SOURCE_LABELS.none, flights: [] };

    var exact = find(carrier, digits, opts.origin, opts.destination);
    if (exact && exact.length) {
      return {
        kind: "flight",
        equipment: exact[0].equipment,
        origin: exact[0].origin,
        destination: exact[0].destination,
        source: "table",
        sourceLabel: SOURCE_LABELS.table,
        flights: exact
      };
    }

    var known = converterType(carrier, digits, opts.data);
    if (known) {
      return {
        kind: "type-only",
        equipment: known,
        origin: normalizeCode(opts.origin, 3) || null,
        destination: normalizeCode(opts.destination, 3) || null,
        source: "converter",
        sourceLabel: SOURCE_LABELS.converter,
        flights: []
      };
    }

    if (opts.origin && opts.destination) {
      var inferred = routeType(carrier, opts.origin, opts.destination, opts.data);
      if (inferred) {
        return {
          kind: "inferred",
          equipment: inferred.equipment,
          origin: normalizeCode(opts.origin, 3),
          destination: normalizeCode(opts.destination, 3),
          source: inferred.source,
          sourceLabel: SOURCE_LABELS[inferred.source],
          flights: []
        };
      }
    }

    return { kind: "unknown", equipment: null, source: "none", sourceLabel: SOURCE_LABELS.none, flights: [] };
  }

  /** Everything a route search can honestly offer: the flights on that route
   *  in the table, plus the type we would infer for it. */
  function searchRoute(origin, destination, options) {
    var opts = options || {};
    var from = normalizeCode(origin, 3);
    var to = normalizeCode(destination, 3);
    var flights = byRoute(from, to, opts.airline);
    var inferred = routeType(opts.airline || "", from, to, opts.data);
    return {
      kind: flights.length ? "route" : (inferred ? "inferred" : "unknown"),
      flights: flights,
      equipment: inferred ? inferred.equipment : (flights.length ? flights[0].equipment : null),
      source: flights.length ? "table" : (inferred ? inferred.source : "none"),
      sourceLabel: flights.length ? SOURCE_LABELS.table : (inferred ? SOURCE_LABELS[inferred.source] : SOURCE_LABELS.none),
      origin: from,
      destination: to
    };
  }

  var API = {
    DB_VERSION: DB_VERSION,
    DB_UPDATED: DB_UPDATED,
    FLIGHTS: FLIGHTS,
    SOURCE_LABELS: SOURCE_LABELS,
    parseQuery: parseQuery,
    parseFlightNumber: parseFlightNumber,
    parseRoute: parseRoute,
    find: find,
    byRoute: byRoute,
    converterType: converterType,
    routeType: routeType,
    lookup: lookup,
    searchRoute: searchRoute
  };

  if (typeof module === "object" && module && module.exports) module.exports = API;
  if (root) root.SpicySeatMapFlights = API;
})(typeof window !== "undefined" ? window : null);
