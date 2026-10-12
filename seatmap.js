/* Seat Map for SpicyTerminal.
 *
 * It does not call an airline, inventory provider, or backend. Its three data
 * sources are kept strictly apart, on screen and in this code:
 *
 *   1. FLIGHT IDENTITY (real) — airline, flight number, route, date, cabin,
 *      booking class and the aircraft type come from the itinerary the user
 *      just converted (the OUTPUT pane is written to sessionStorage by
 *      app.js; this file re-reads it with the real engine, so the seat map
 *      and the itinerary can never disagree). The aircraft type's provenance
 *      travels with it: "from the itinerary" when the source stated a type,
 *      "inferred (<method>)" when the converter inferred it.
 *
 *   2. LAYOUT (verified > reference > generic) — resolved by
 *      seatmap_layouts.js: an airline-verified configuration when one has
 *      been checked against the airline's own map, otherwise a reference
 *      layout for the type, otherwise a generic cross-section, each labelled
 *      as what it is. Never presented as the airline's own config unless it is.
 *
 *   3. SEAT STATUS (simulated) — generated deterministically from the flight
 *      and the refresh counter. Real seat availability needs an airline/GDS
 *      inventory feed, which this app (a converter, not a booking tool) has
 *      no access to, so statuses are labelled SIMULATED everywhere they
 *      appear.
 */
(function (root) {
  "use strict";

  /* Aircraft layouts come from seatmap_layouts.js (inlined ahead of this file
   * by build_web.py; required directly under Node). */
  var LAYOUT_API = (typeof module === "object" && module && module.exports)
    ? require("./seatmap_layouts.js")
    : (root && root.SpicySeatMapLayouts) || null;

  /* The local flight lookup (seatmap_flights.js): "which aircraft is BA 117?".
     Inlined ahead of this file by build_web.py, required directly under Node. */
  var FLIGHT_API = (typeof module === "object" && module && module.exports)
    ? require("./seatmap_flights.js")
    : (root && root.SpicySeatMapFlights) || null;

  var CALENDAR_API = (typeof module === "object" && module && module.exports)
    ? require("./seatmap_calendar.js")
    : (root && root.SpicySeatMapCalendar) || null;

  function localDateValue(date) {
    return CALENDAR_API ? CALENDAR_API.localDate(date)
      : date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  var TIERS = (LAYOUT_API && LAYOUT_API.TIERS) || {
    AIRLINE_VERIFIED: "airline_verified",
    TYPE_REFERENCE: "type_reference",
    CATEGORY_GENERIC: "category_generic",
    NO_PASSENGER_CABIN: "no_passenger_cabin",
    UNKNOWN_TYPE: "unknown_type"
  };

  /** Compact demo presets — real reference layouts, chosen for the three
   *  aircraft the manual form offers. */
  var AIRCRAFT_LAYOUTS = (function () {
    var presets = {};
    if (LAYOUT_API) {
      ["738", "320", "77W"].forEach(function (code) {
        var layout = LAYOUT_API.TYPE_LAYOUTS[code];
        if (layout) presets[code] = layout;
      });
    }
    return presets;
  })();

  /** The aircraft-type table (IATA code -> [icao, name, family, maker, class, range]). */
  function aircraftTypes() {
    if (typeof SPICY_DATA !== "undefined" && SPICY_DATA && SPICY_DATA.aircraftTypes) return SPICY_DATA.aircraftTypes;
    if (root && root.SPICY_DATA && root.SPICY_DATA.aircraftTypes) return root.SPICY_DATA.aircraftTypes;
    return null;
  }

  /** The whole data file (flight/route/airline equipment tables). */
  function dataTable() {
    if (typeof SPICY_DATA !== "undefined" && SPICY_DATA) return SPICY_DATA;
    if (root && root.SPICY_DATA) return root.SPICY_DATA;
    return null;
  }

  function airlineNames() {
    if (typeof SPICY_DATA !== "undefined" && SPICY_DATA && SPICY_DATA.airlines) return SPICY_DATA.airlines;
    if (root && root.SPICY_DATA && root.SPICY_DATA.airlines) return root.SPICY_DATA.airlines;
    return null;
  }

  function airportNames() {
    if (typeof SPICY_DATA !== "undefined" && SPICY_DATA && SPICY_DATA.airports) return SPICY_DATA.airports;
    if (root && root.SPICY_DATA && SPICY_DATA.airports) return root.SPICY_DATA.airports;
    return null;
  }

  function airportLabel(code) {
    var table = airportNames();
    var entry = table && table[code];
    return (entry && entry.name) ? entry.name : "";
  }

  function airlineLabel(code) {
    var table = airlineNames();
    return (table && table[code]) ? table[code] : "";
  }

  var AVAILABLE_STATUSES = ["available", "premium", "extra_legroom", "exit_row"];
  var STATUS_LABELS = {
    available: "Available",
    occupied: "Occupied",
    blocked: "Unavailable",
    premium: "Premium",
    extra_legroom: "Extra legroom",
    exit_row: "Exit row"
  };

  /** Normalize and validate an airline flight number without inventing a carrier. */
  function normalizeFlightNumber(value) {
    var normalized = String(value == null ? "" : value).toUpperCase().replace(/[\s-]+/g, "");
    if (!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(normalized)) {
      throw new TypeError("Enter a flight number such as AS100 or BA72.");
    }
    return normalized;
  }

  /** Normalize a three-letter airport code. */
  function normalizeAirport(value, fieldName) {
    var normalized = String(value == null ? "" : value).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
      throw new TypeError((fieldName || "Airport") + " must be a three-letter IATA code.");
    }
    return normalized;
  }

  /** Normalize a two-letter IATA airline code. */
  function normalizeAirline(value) {
    var normalized = String(value == null ? "" : value).trim().toUpperCase();
    return /^[A-Z0-9]{2}$/.test(normalized) ? normalized : "";
  }

  /** Validate a strict YYYY-MM-DD date without relying on locale parsing. */
  function normalizeDate(value) {
    var normalized = String(value == null ? "" : value).trim();
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
    if (!match) throw new TypeError("Choose a valid departure date.");
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new TypeError("Choose a valid departure date.");
    }
    return normalized;
  }

  /** Return an unsigned deterministic hash used for sample statuses. */
  function hashString(value) {
    var hash = 2166136261;
    var text = String(value);
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /** Choose a visibly varied but reproducible status for a sample seat. */
  function sampleStatus(seed, seat, refreshIndex) {
    var score = hashString(seed + "|" + seatKey(seat) + "|" + refreshIndex) % 100;
    var premiumCabin = seat.cabinCode === "first" || seat.cabinCode === "business" || seat.cabinCode === "premium_economy";
    if (seat.isExitRow) {
      if (score < 42) return "exit_row";
      if (score < 69) return "occupied";
      if (score < 77) return "blocked";
      return "available";
    }
    if (premiumCabin) {
      if (score < 42) return "premium";
      if (score < 70) return "occupied";
      if (score < 77) return "blocked";
      return "available";
    }
    if (score < 53) return "available";
    if (score < 78) return "occupied";
    if (score < 87) return "blocked";
    if (score < 94) return "extra_legroom";
    return "premium";
  }

  /** Determine whether a seat is at a window, aisle, or middle position. */
  function seatPosition(groupIndex, groupCount, seatIndex, groupLength) {
    var isOuterGroup = groupIndex === 0 || groupIndex === groupCount - 1;
    var isOuterSeat = seatIndex === 0 || seatIndex === groupLength - 1;
    if (isOuterGroup && isOuterSeat) {
      return (groupIndex === 0 && seatIndex === 0) || (groupIndex === groupCount - 1 && seatIndex === groupLength - 1)
        ? "window"
        : "aisle";
    }
    if (!isOuterGroup && isOuterSeat) return "aisle";
    return "middle";
  }

  /** Every status is derived from these facts; nothing about the seat itself
   *  is invented. */
  function buildSeatMap(spec, refreshIndex) {
    var layout = spec.layout;
    var refresh = Number.isFinite(Number(refreshIndex)) ? Math.max(0, Math.floor(Number(refreshIndex))) : 0;
    var seed = spec.seed.join("|");
    var sample = !!spec.sampleWording;
    var cabins = [];
    var totalSeats = 0;
    var multiDeck = layout.cabins.some(function (cabin) { return cabin.deck === 1; })
      && layout.cabins.some(function (cabin) { return !cabin.deck; });

    layout.cabins.forEach(function (cabin) {
      var rows = [];
      var deck = cabin.deck || 0;
      var outsideTicketedCabin = !!(spec.ticketedCabin && spec.ticketedCabin !== cabin.code);
      for (var rowNumber = cabin.from; rowNumber <= cabin.to; rowNumber++) {
        var isExitRow = (cabin.exitRows || []).indexOf(rowNumber) !== -1;
        var seats = [];
        cabin.groups.forEach(function (group, groupIndex) {
          group.forEach(function (letter, seatIndex) {
            var id = String(rowNumber) + letter;
            var seat = {
              id: id,
              key: multiDeck ? deck + ":" + id : id,
              deck: deck,
              deckName: deckName(deck),
              row: rowNumber,
              letter: letter,
              cabin: cabin.name,
              cabinCode: cabin.code,
              position: seatPosition(groupIndex, cabin.groups.length, seatIndex, group.length),
              status: "available",
              isExitRow: isExitRow,
              outsideTicketedCabin: outsideTicketedCabin,
              pitchInches: cabin.pitch,
              widthInches: cabin.width,
              features: cabin.features.slice()
            };
            if (isExitRow) seat.features.push(sample ? "EXIT ROW — SAMPLE" : "EXIT ROW");
            if (seat.position === "window") seat.features.push("WINDOW POSITION");
            if (seat.position === "aisle") seat.features.push("AISLE POSITION");
            seat.status = sampleStatus(seed, seat, refresh);
            seats.push(seat);
            totalSeats++;
          });
        });
        rows.push({ rowNumber: rowNumber, deck: deck, isExitRow: isExitRow, seats: seats });
      }
      cabins.push({
        name: cabin.name,
        code: cabin.code,
        deck: deck,
        rows: rows,
        features: cabin.features.slice(),
        groups: cabin.groups.map(function (group) { return group.slice(); }),
        pitch: cabin.pitch,
        width: cabin.width,
        exitRows: (cabin.exitRows || []).slice()
      });
    });

    var map = {
      flightNumber: spec.flightNumber,
      origin: spec.origin,
      destination: spec.destination,
      departureDate: spec.departureDate,
      aircraftCode: spec.aircraftCode,
      aircraftName: layout.name,
      icaoCode: layout.icaoCode,
      source: spec.source,
      availability: "SIMULATED",
      refreshIndex: refresh,
      generatedAt: new Date().toISOString(),
      wingStartRow: layout.wingStartRow,
      wingEndRow: layout.wingEndRow,
      facilities: layout.facilities.slice(),
      cabins: cabins,
      decks: getDecks({ cabins: cabins }),
      totalSeats: totalSeats,
      ticketedCabin: spec.ticketedCabin || null,
      ticketedCabinLabel: spec.ticketedCabinLabel || null,
      cabinShown: spec.cabinShown || null,
      cabinNote: spec.cabinNote || null,
      layoutVariantFor: spec.layoutVariantFor || null,
      layoutConfig: layout.configLabel || null,
      layoutTier: spec.layoutTier || null,
      layoutLabel: spec.layoutLabel || null
    };
    if (spec.flight) {
      map.airline = spec.flight.airline;
      map.airlineName = spec.flight.airlineName;
      map.originName = spec.flight.originName;
      map.destinationName = spec.flight.destinationName;
      map.depTime = spec.flight.depTime;
      map.arrTime = spec.flight.arrTime;
      map.bookingClass = spec.flight.bookingClass;
      map.cabin = spec.flight.cabin;
      map.miles = spec.flight.miles;
      map.distance = spec.flight.distance;
      map.legIndex = spec.flight.legIndex;
      map.legCount = spec.flight.legCount;
      map.flightSource = spec.flight.flightSource || "converted";
      map.searchSourceLabel = spec.flight.searchSourceLabel || "";
      map.equipmentSource = spec.flight.equipmentSource;
      map.equipmentNote = spec.flight.equipmentNote;
      map.warnings = (spec.flight.warnings || []).slice();
      map.layoutTier = spec.layoutTier;
      map.layoutLabel = spec.layoutLabel;
      map.layoutConfig = layout.configLabel || null;
      map.layoutSourceName = spec.layoutSourceName || null;
      map.layoutSourceUrl = spec.layoutSourceUrl || null;
      map.layoutVerifiedOn = spec.layoutVerifiedOn || null;
      map.seatPageUrl = seatPageUrl(spec.flight.airline) || null;
    }
    return map;
  }

  /** Build a full local demo map; no network request or provider data is used. */
  function createDemoSeatMap(input, refreshIndex) {
    var details = input || {};
    var flightNumber = normalizeFlightNumber(details.flightNumber);
    var origin = normalizeAirport(details.origin, "Origin");
    var destination = normalizeAirport(details.destination, "Destination");
    var departureDate = normalizeDate(details.date);
    var aircraftCode = String(details.aircraftCode || "").toUpperCase();
    /* Any type the registry can draw is offered, not just the three presets:
       the manual form is how you look at a type you picked yourself. */
    var layout = AIRCRAFT_LAYOUTS[aircraftCode] || (LAYOUT_API ? LAYOUT_API.TYPE_LAYOUTS[aircraftCode] : null);
    if (!layout) throw new TypeError("Choose one of the sample aircraft layouts.");
    var wantedCabin = details.cabinCode || null;
    if (wantedCabin && LAYOUT_API && !LAYOUT_API.hasCabin(layout, wantedCabin)) {
      var variant = LAYOUT_API.pickVariant(aircraftCode, wantedCabin);
      if (variant) layout = variant;
    }
    return buildSeatMap({
      layout: layout,
      sampleWording: true,
      source: "SIMULATED SAMPLE DATA",
      seed: [flightNumber, origin, destination, departureDate, aircraftCode],
      flightNumber: flightNumber,
      origin: origin,
      destination: destination,
      departureDate: departureDate,
      aircraftCode: aircraftCode
    }, refreshIndex);
  }

  /* ------------------------------------------------------------------ *
   * Real flight data (from the itinerary the user just converted)
   * ------------------------------------------------------------------ */

  var ROUTE_STORE_KEY = "spicy_seatmap_route";

  /** Airline home pages, used only for an honest "check on the airline"
   *  outbound link. No seat data is ever taken from them. */
  var AIRLINE_SITES = {
    AA: "https://www.aa.com/", DL: "https://www.delta.com/", UA: "https://www.united.com/",
    AS: "https://www.alaskaair.com/", BA: "https://www.britishairways.com/", AC: "https://www.aircanada.com/",
    LH: "https://www.lufthansa.com/", AF: "https://www.airfrance.com/", KL: "https://www.klm.com/",
    EK: "https://www.emirates.com/", QR: "https://www.qatarairways.com/", TK: "https://www.turkishairlines.com/",
    SQ: "https://www.singaporeair.com/", CX: "https://www.cathaypacific.com/", NH: "https://www.ana.co.jp/",
    JL: "https://www.jal.co.jp/", EY: "https://www.etihad.com/", MS: "https://www.egyptair.com/",
    ET: "https://www.ethiopianairlines.com/", SV: "https://www.saudia.com/", QF: "https://www.qantas.com/",
    NZ: "https://www.airnewzealand.com/", IB: "https://www.iberia.com/", AZ: "https://www.ita-airways.com/",
    LX: "https://www.swiss.com/", OS: "https://www.austrian.com/", SK: "https://www.flysas.com/",
    EI: "https://www.aerlingus.com/", AY: "https://www.finnair.com/", TP: "https://www.flytap.com/",
    AV: "https://www.avianca.com/", LA: "https://www.latamairlines.com/", AM: "https://www.aeromexico.com/",
    CM: "https://www.copaair.com/", AT: "https://www.royalairmaroc.com/", KQ: "https://www.kenya-airways.com/",
    AI: "https://www.airindia.com/", MH: "https://www.malaysiaairlines.com/", GA: "https://www.garuda-indonesia.com/",
    PR: "https://www.philippineairlines.com/", TG: "https://www.thaiairways.com/", VN: "https://www.vietnamairlines.com/",
    CI: "https://www.china-airlines.com/", BR: "https://www.evaair.com/", KE: "https://www.koreanair.com/",
    OZ: "https://flyasiana.com/", CA: "https://www.airchina.com/", MU: "https://www.ceair.com/",
    CZ: "https://www.csair.com/", JX: "https://www.starlux-airlines.com/"
  };

  function seatPageUrl(airline) {
    var code = String(airline || "").toUpperCase();
    return AIRLINE_SITES[code] || null;
  }

  /** Map the converter's cabin wording onto the layout's cabin codes. */
  function cabinCodeFromName(name) {
    var text = String(name == null ? "" : name).toUpperCase();
    if (!text) return null;
    if (text.indexOf("FIRST") >= 0) return "first";
    if (text.indexOf("PREMIUM") >= 0) return "premium_economy";
    if (text.indexOf("BUSINESS") >= 0) return "business";
    if (text.indexOf("ECONOMY") >= 0 || text.indexOf("COACH") >= 0) return "economy";
    return null;
  }

  function cabinLabel(code) {
    return { first: "First", business: "Business", premium_economy: "Premium Economy", economy: "Economy" }[code] || null;
  }

  var MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

  /** Turn the engine's DDMMM into an ISO date. The GDS format carries no
   *  year, so the year is resolved to the next occurrence and disclosed. */
  function resolveFlightDate(dateDDMMM, now) {
    var text = String(dateDDMMM == null ? "" : dateDDMMM).toUpperCase().replace(/\s+/g, "");
    var match = /^(\d{2})([A-Z]{3})$/.exec(text) || /^([A-Z]{3})(\d{2})$/.exec(text);
    if (!match) return { iso: null, inferredYear: false };
    var day, month;
    if (/^\d/.test(match[1])) { day = Number(match[1]); month = MONTHS.indexOf(match[2]); }
    else { month = MONTHS.indexOf(match[1]); day = Number(match[2]); }
    if (month < 0 || !(day >= 1 && day <= 31)) return { iso: null, inferredYear: false };
    var base = (now && typeof now.getTime === "function") ? new Date(now.getTime()) : new Date();
    var year = base.getUTCFullYear();
    var candidate = new Date(Date.UTC(year, month, day));
    if (candidate.getUTCMonth() !== month || candidate.getUTCDate() !== day) return { iso: null, inferredYear: false };
    var today = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
    var inferredYear = true;
    if (candidate.getTime() < today) candidate = new Date(Date.UTC(year + 1, month, day));
    return { iso: candidate.toISOString().slice(0, 10), inferredYear: inferredYear };
  }

  /** Read one engine segment into the flight facts the seat map shows. */
  function legFromSegment(segment, options) {
    var opts = options || {};
    var warnings = Array.isArray(segment.warnings) ? segment.warnings.slice() : [];
    var inferred = null;
    var equipmentNote = "stated in the itinerary";
    for (var i = 0; i < warnings.length; i++) {
      /* The engine's note reads "aircraft inferred 32Q (QR 812, route estimate)":
         the flight number comes first, the method we want is the last part. */
      var match = /aircraft inferred\s+(\S+)\s*\((.+)\)/i.exec(String(warnings[i]));
      if (match) {
        var detail = match[2].split(",");
        inferred = { code: match[1], method: detail[detail.length - 1].trim() };
      }
    }
    var equipment = String(segment.aircraft || "").toUpperCase();
    if (inferred) equipmentNote = "inferred (" + inferred.method + ")";
    else if (!equipment || equipment === "???") { equipmentNote = "not stated and not inferable"; equipment = ""; }
    var date = resolveFlightDate(segment.date_ddmmm, opts.now);
    var cabin = cabinCodeFromName(segment.cabin);
    return {
      airline: String(segment.airline || "").toUpperCase(),
      airlineName: airlineLabel(String(segment.airline || "").toUpperCase()),
      flightNumber: String(segment.flight_no || "").trim(),
      origin: String(segment.orig || "").toUpperCase(),
      destination: String(segment.dest || "").toUpperCase(),
      originName: airportLabel(String(segment.orig || "").toUpperCase()),
      destinationName: airportLabel(String(segment.dest || "").toUpperCase()),
      dateDDMMM: String(segment.date_ddmmm || "").toUpperCase(),
      departureDate: date.iso,
      dateYearInferred: date.inferredYear,
      depTime: segment.dep_time || "",
      arrTime: segment.arr_time || "",
      arrDayShift: segment.arr_day_shift || 0,
      bookingClass: segment.booking_class || "",
      cabin: segment.cabin || "",
      cabinCode: cabin,
      equipment: equipment,
      equipmentNote: equipmentNote,
      miles: segment.distance == null ? null : segment.distance,
      warnings: warnings
    };
  }

  /** The conversion engine, however this build happens to carry it: the
   *  browser page exposes window.SpicyEngine, the tests load it directly. */
  function engineApi() {
    if (root && root.SpicyEngine && typeof root.SpicyEngine.parse === "function") return root.SpicyEngine;
    if (typeof module === "object" && module && module.exports) {
      try { return require("./spicy_engine.js"); } catch (error) { return null; }
    }
    return null;
  }

  /** Parse the OUTPUT text of a conversion into seat-map legs. */
  function convertRoute(text, options) {
    var engine = engineApi();
    var opts = options || {};
    if (!engine || typeof engine.parse !== "function") {
      return { legs: [], warnings: [], reason: "The conversion engine is unavailable." };
    }
    var body = String(text == null ? "" : text);
    if (!body.trim()) return { legs: [], warnings: [], reason: "There is no converted itinerary to read." };
    var read;
    try { read = engine.parse(body); } catch (error) { read = null; }
    var segments = (read && Array.isArray(read[0])) ? read[0] : [];
    if (!segments.length) return { legs: [], warnings: (read && read[1]) || [], reason: "No flight could be read from the converted itinerary." };
    return {
      legs: segments.map(function (segment) { return legFromSegment(segment, opts); }),
      warnings: (read && read[1]) || []
    };
  }

  /** Read the itinerary the converter stored for this tab. */
  function readStoredRoute(storage) {
    var store = storage || (root && root.sessionStorage);
    if (!store || typeof store.getItem !== "function") return null;
    try {
      var raw = store.getItem(ROUTE_STORE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.text !== "string" || !parsed.text.trim()) return null;
      return parsed;
    } catch (error) { return null; }
  }

  /** Resolve the layout for one real flight, with its honest tier. */
  function resolveFlightLayout(airline, equipmentCode, cabin) {
    if (!LAYOUT_API) {
      return { tier: TIERS.UNKNOWN_TYPE, label: "NO LAYOUT DATA LOADED", layout: null, message: "The aircraft layout data is unavailable." };
    }
    var resolved = LAYOUT_API.resolveLayout(airline, equipmentCode, aircraftTypes(), cabin ? { cabin: cabin } : null);
    return {
      tier: resolved.tier,
      label: resolved.label,
      layout: resolved.layout,
      meta: resolved.meta,
      sourceName: resolved.sourceName,
      sourceUrl: resolved.sourceUrl,
      verifiedOn: resolved.verifiedOn,
      variantFor: resolved.variantFor || null,
      variantNote: resolved.variantNote || null,
      configLabel: resolved.layout ? resolved.layout.configLabel : null,
      message: resolved.layout
        ? null
        : (resolved.reason ? resolved.reason.charAt(0).toUpperCase() + resolved.reason.slice(1) + "." : "No layout is available for this aircraft.")
    };
  }

  /** Build the seat map for a real converted flight. */
  function createFlightSeatMap(flight, refreshIndex) {
    var facts = flight || {};
    var carrier = normalizeAirline(facts.airline);
    if (!carrier) throw new TypeError("The itinerary does not name an airline for this leg.");
    /* The flight number is stored bare ("704"); every display site prints the
       carrier in front of it ("QR 704") exactly the way the itinerary does. */
    var combined = normalizeFlightNumber(carrier + String(facts.flightNumber || ""));
    var flightNumber = combined.slice(carrier.length);
    var origin = normalizeAirport(facts.origin, "Origin");
    var destination = normalizeAirport(facts.destination, "Destination");
    var departureDate = normalizeDate(facts.departureDate);
    var equipment = String(facts.equipment || "").toUpperCase();
    /* A ticketed cabin is a hard fact; a cabin preference (the box a searcher
       ticks) only chooses which configuration of this type to draw. Both can
       ask for a cabin the default reference does not have — and when the type
       does fly one, the four-class variant answers instead of a shrug. */
    var ticketed = facts.cabinCode || null;
    var preference = facts.cabinPreference || ticketed;
    var resolved = resolveFlightLayout(facts.airline, equipment, preference);
    if (!resolved.layout) throw new TypeError(resolved.message || "No layout is available for this aircraft.");

    var hasCabin = !ticketed || resolved.layout.cabins.some(function (cabin) { return cabin.code === ticketed; });
    var cabinNote = null;
    if (ticketed && !hasCabin) {
      cabinNote = "This reference layout has no " + (cabinLabel(ticketed) || ticketed) + " cabin, so the whole aircraft is shown.";
      ticketed = null;
    } else if (resolved.variantNote) {
      cabinNote = resolved.variantNote;
    }

    return buildSeatMap({
      layout: resolved.layout,
      sampleWording: false,
      source: "REAL FLIGHT DATA · SIMULATED SEAT STATUS",
      seed: [combined, origin, destination, departureDate, equipment, facts.cabin || "", facts.depTime || ""],
      flightNumber: flightNumber,
      origin: origin,
      destination: destination,
      departureDate: departureDate,
      aircraftCode: equipment,
      ticketedCabin: ticketed,
      ticketedCabinLabel: ticketed ? cabinLabel(ticketed) : null,
      cabinShown: preference || null,
      cabinNote: cabinNote,
      layoutVariantFor: resolved.variantFor || null,
      layoutTier: resolved.tier,
      layoutLabel: resolved.label,
      layoutSourceName: resolved.sourceName || null,
      layoutSourceUrl: resolved.sourceUrl || null,
      layoutVerifiedOn: resolved.verifiedOn || null,
      flight: {
        airline: normalizeAirline(facts.airline),
        airlineName: facts.airlineName || airlineLabel(normalizeAirline(facts.airline)),
        originName: facts.originName || airportLabel(origin),
        destinationName: facts.destinationName || airportLabel(destination),
        depTime: facts.depTime || "",
        arrTime: facts.arrTime || "",
        bookingClass: facts.bookingClass || "",
        cabin: facts.cabin || "",
        miles: facts.miles == null ? null : facts.miles,
        distance: facts.distance == null ? null : facts.distance,
        legIndex: facts.legIndex == null ? 0 : facts.legIndex,
        legCount: facts.legCount == null ? 1 : facts.legCount,
        equipmentSource: facts.equipmentNote || "",
        equipmentNote: facts.equipmentNote || "",
        flightSource: facts.search ? "search" : "converted",
        searchSourceLabel: facts.searchSourceLabel || "",
        warnings: facts.warnings || []
      }
    }, refreshIndex);
  }

  function deckName(index) { return index === 1 ? "Upper deck" : "Main deck"; }
  function seatKey(seat) { return seat.key || seat.id; }
  function seatLabel(seat, map) {
    return seat.id + (map.decks.length > 1 ? " · " + deckName(seat.deck) : "");
  }

  /** Deck eligibility comes from actual passenger cabins, not a name match.
   *  The full map always retains both decks for refreshes and exports. */
  function getDecks(map) {
    var decks = [];
    (map && map.cabins || []).forEach(function (cabin, cabinIndex) {
      var index = cabin.deck || 0;
      var deck = decks.filter(function (item) { return item.index === index; })[0];
      if (!deck) {
        deck = { index: index, name: deckName(index), cabins: [], seatCount: 0 };
        decks.push(deck);
      }
      deck.cabins.push(cabinIndex);
      (cabin.rows || []).forEach(function (row) { deck.seatCount += row.seats.length; });
    });
    return decks.sort(function (a, b) { return a.index - b.index; });
  }

  function initialDeck(map, cabinCode) {
    var cabin = (map.cabins || []).filter(function (item) { return item.code === cabinCode; })[0];
    return cabin ? cabin.deck || 0 : getDecks(map)[0].index;
  }

  /** Flatten all cabins (or one deck) into a stable row-major seat array. */
  function flattenSeats(map, deck) {
    var seats = [];
    (map && map.cabins || []).forEach(function (cabin) {
      if (deck != null && (cabin.deck || 0) !== Number(deck)) return;
      cabin.rows.forEach(function (row) {
        row.seats.forEach(function (seat) { seats.push(seat); });
      });
    });
    return seats;
  }

  /** Count sample statuses, treating premium and exit seats as selectable. */
  function countStatuses(map, deck) {
    var counts = { total: 0, available: 0, selectable: 0, occupied: 0, blocked: 0, premium: 0, extra_legroom: 0, exit_row: 0 };
    flattenSeats(map, deck).forEach(function (seat) {
      counts.total++;
      if (Object.prototype.hasOwnProperty.call(counts, seat.status)) counts[seat.status]++;
      if (AVAILABLE_STATUSES.indexOf(seat.status) !== -1) counts.selectable++;
    });
    return counts;
  }

  /** Filter sample seats by status, cabin, and position without mutating the map. */
  function filterSeats(map, filters) {
    var options = filters || {};
    return flattenSeats(map, options.deck).filter(function (seat) {
      if (options.availableOnly && AVAILABLE_STATUSES.indexOf(seat.status) === -1) return false;
      if (options.windowOnly && seat.position !== "window") return false;
      if (options.aisleOnly && seat.position !== "aisle") return false;
      if (options.exitOnly && !seat.isExitRow) return false;
      if (options.cabin && options.cabin !== "all" && seat.cabinCode !== options.cabin) return false;
      return true;
    });
  }

  /** Calculate consistent SVG coordinates for every seat and cabin label. */
  function calculateLayout(map, deck) {
    var width = 720;
    var seatWidth = 30;
    var seatHeight = 25;
    var seatGap = 4;
    var aisleGap = 22;
    var rowStep = 32;
    var y = 58;
    var rows = [];
    var cabins = [];
    var seats = [];

    (map && map.cabins || []).forEach(function (cabin) {
      if (deck != null && (cabin.deck || 0) !== Number(deck)) return;
      var cabinStart = y;
      y += 28;
      var groups = cabin.groups || cabin.rows.reduce(function (list, row) {
        return list.length ? list : [row.seats.map(function (seat) { return seat.letter; })];
      }, []);
      cabin.rows.forEach(function (row) {
        var rowWidth = 0;
        groups.forEach(function (group, groupIndex) {
          rowWidth += group.length * seatWidth + Math.max(0, group.length - 1) * seatGap;
          if (groupIndex < groups.length - 1) rowWidth += aisleGap;
        });
        var x = (width - rowWidth) / 2;
        var rowY = y;
        var rowSeats = [];
        groups.forEach(function (group, groupIndex) {
          group.forEach(function (letter, seatIndex) {
            var seat = row.seats.filter(function (candidate) { return candidate.letter === letter; })[0];
            var placed = {
              seat: seat,
              x: x,
              y: rowY,
              width: seatWidth,
              height: seatHeight,
              groupIndex: groupIndex,
              seatIndex: seatIndex
            };
            rowSeats.push(placed);
            seats.push(placed);
            x += seatWidth + seatGap;
          });
          if (groupIndex < groups.length - 1) x += aisleGap - seatGap;
        });
        rows.push({ rowNumber: row.rowNumber, y: rowY, x: (width - rowWidth) / 2, width: rowWidth, isExitRow: row.isExitRow, seats: rowSeats, cabin: cabin.name });
        y += rowStep;
      });
      cabins.push({ name: cabin.name, code: cabin.code, y: cabinStart + 5, startY: cabinStart, endY: y - rowStep });
      y += 20;
    });

    return {
      width: width,
      height: y + 28,
      seatWidth: seatWidth,
      seatHeight: seatHeight,
      rows: rows,
      cabins: cabins,
      seats: seats,
      wingStart: rows.filter(function (row) { return row.rowNumber === map.wingStartRow; })[0] || null,
      wingEnd: rows.filter(function (row) { return row.rowNumber === map.wingEndRow; })[0] || null
    };
  }

  /** Return a short human-readable status label. */
  function statusLabel(status) {
    return STATUS_LABELS[status] || "Unknown";
  }

  /** Create a plain-text map suitable for clipboard export. */
  function exportAscii(map) {
    var symbols = { available: "○", occupied: "●", blocked: "×", premium: "◇", extra_legroom: "⬡", exit_row: "△" };
    var header = map.airline
      ? ["SEAT MAP — SIMULATED DATA",
         map.airline + (map.airlineName ? " (" + map.airlineName + ")" : "") + " " + map.flightNumber + " " + map.origin + "-" + map.destination
           + " | " + map.departureDate + " | " + map.aircraftName + " (" + map.aircraftCode + ")",
         "AIRCRAFT TYPE: " + (map.equipmentSource || "provenance unknown") + " · LAYOUT: " + (map.layoutLabel || "") + (map.layoutConfig ? " · " + map.layoutConfig : ""),
         "SEAT STATUS: SIMULATED — no airline inventory is connected; nothing is reserved.",
         ""]
      : ["SEAT MAP DEMO — SIMULATED DATA", map.flightNumber + " " + map.origin + "-" + map.destination + " | " + map.departureDate + " | " + map.aircraftName, ""];
    var lines = header;
    var decks = getDecks(map);
    decks.forEach(function (deck) {
      if (decks.length > 1) lines.push("=== " + deck.name.toUpperCase() + " ===");
      deck.cabins.forEach(function (index) {
        var cabin = map.cabins[index];
        lines.push("[ " + cabin.name.toUpperCase() + " ]");
        cabin.rows.forEach(function (row) {
          var cells = row.seats.map(function (seat) { return seat.letter + symbols[seat.status]; });
          lines.push(String(row.rowNumber).padStart(2, "0") + "  " + cells.join(" ") + (row.isExitRow ? "  EXIT ROW" : ""));
        });
        lines.push("");
      });
    });
    lines.push("○ available  ● occupied  × unavailable  ◇ premium  ⬡ extra legroom  △ exit row");
    lines.push("Sample statuses only; no airline inventory or booking is connected.");
    return lines.join("\n");
  }

  /** Export all sample seats as RFC-style escaped CSV rows. */
  function exportCsv(map) {
    function quote(value) { return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"'; }
    var rows = [["flight", "origin", "destination", "date", "aircraft", "seat", "cabin", "position", "status", "pitch_in", "width_in", "sample_data", "layout_tier", "deck", "seat_key"]];
    var tier = map.layoutTier || "simulated_sample";
    flattenSeats(map).forEach(function (seat) {
      rows.push([map.flightNumber, map.origin, map.destination, map.departureDate, map.aircraftName, seat.id, seat.cabin, seat.position, statusLabel(seat.status), seat.pitchInches, seat.widthInches, "simulated", tier, deckName(seat.deck || 0), seatKey(seat)]);
    });
    return rows.map(function (row) { return row.map(quote).join(","); }).join("\r\n");
  }

  /** Build a short text status summary for copy/export. */
  function exportSummary(map) {
    var counts = countStatuses(map);
    var lines = [
      "SPICYTERMINAL SEAT MAP — DEMO SUMMARY",
      "Flight: " + (map.airline ? map.airline + " " : "") + map.flightNumber + "  " + map.origin + " → " + map.destination,
      "Date: " + map.departureDate,
      "Aircraft: " + map.aircraftName + " (" + map.aircraftCode + ")"
    ];
    if (map.airline) {
      lines.push("Aircraft type source: " + (map.equipmentSource || "provenance unknown"));
      lines.push("Layout: " + (map.layoutLabel || "unknown tier") + (map.layoutConfig ? " — " + map.layoutConfig : ""));
      if (map.layoutSourceUrl) lines.push("Layout source: " + map.layoutSourceName + " " + map.layoutSourceUrl + " (verified " + map.layoutVerifiedOn + ")");
      lines.push("Ticketed cabin: " + (map.ticketedCabinLabel || "not stated in the itinerary"));
    }
    var decks = getDecks(map);
    if (decks.length > 1) lines.push(decks.map(function (deck) { return deck.name + ": " + deck.seatCount + " seats"; }).join(" · "));
    lines.push(
      "Seats in sample layout: " + counts.total,
      "Sample selectable: " + counts.selectable + " · occupied: " + counts.occupied + " · unavailable: " + counts.blocked,
      "Data source: SIMULATED SAMPLE DATA — not live airline inventory.",
      "No seat was reserved or booked."
    );
    return lines.join("\n");
  }

  /** Convert untrusted text to safe HTML for the few generated SVG/details nodes. */
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  /** Check whether a status belongs in the sample available-seat count. */
  function isSelectableStatus(status) {
    return AVAILABLE_STATUSES.indexOf(status) !== -1;
  }

  var API = {
    AIRCRAFT_LAYOUTS: AIRCRAFT_LAYOUTS,
    AVAILABLE_STATUSES: AVAILABLE_STATUSES.slice(),
    TIERS: TIERS,
    ROUTE_STORE_KEY: ROUTE_STORE_KEY,
    AIRCRAFT_SITES: AIRLINE_SITES,
    resolveFlightLayout: resolveFlightLayout,
    createFlightSeatMap: createFlightSeatMap,
    legFromSegment: legFromSegment,
    convertRoute: convertRoute,
    readStoredRoute: readStoredRoute,
    resolveFlightDate: resolveFlightDate,
    cabinCodeFromName: cabinCodeFromName,
    seatPageUrl: seatPageUrl,
    normalizeFlightNumber: normalizeFlightNumber,
    normalizeAirport: normalizeAirport,
    normalizeDate: normalizeDate,
    createDemoSeatMap: createDemoSeatMap,
    getDecks: getDecks,
    initialDeck: initialDeck,
    flattenSeats: flattenSeats,
    countStatuses: countStatuses,
    filterSeats: filterSeats,
    calculateLayout: calculateLayout,
    statusLabel: statusLabel,
    exportAscii: exportAscii,
    exportCsv: exportCsv,
    exportSummary: exportSummary,
    isSelectableStatus: isSelectableStatus,
    /* the flight lookup and the picker that feeds it */
    drawableTypes: drawableTypes,
    populateAircraftSelect: populateAircraftSelect,
    runFlightSearch: runFlightSearch,
    renderSearchResults: renderSearchResults,
    loadSearchedFlight: loadSearchedFlight,
    loadConvertedRoute: loadConvertedRoute,
    /* The live page state (legs, active leg, current lookup) that the PRICE
       module reads so it prices exactly the flight on screen. Set when the
       /seatmap page initialises; null on every other page. */
    pageState: null
  };

  if (typeof module === "object" && module && module.exports) module.exports = API;
  if (!root) return;
  root.SpicySeatMap = API;

  /** Escape markup values used in the generated, static seat-map UI. */
  function escapeUi(value) {
    return escapeHtml(value);
  }

  /** Create the SVG plane, cabin labels, row numbers, exits, and seat buttons. */
  function renderSvg(state, svg) {
    var geometry = state.geometry;
    var width = geometry.width;
    var height = geometry.height;
    var markup = [];
    var deckLabel = state.map.decks.length > 1 ? " · " + deckName(state.activeDeck) : "";
    var availableSet = {};
    filterSeats(state.map, state.filters).forEach(function (seat) { availableSet[seatKey(seat)] = true; });
    var center = width / 2;
    var fuselageLeft = 118;
    var fuselageRight = width - fuselageLeft;
    var top = 18;
    var bottom = height - 10;

    markup.push('<title>' + (state.map.airline ? 'Seat map for ' + escapeUi(state.map.airline + ' ' + state.map.flightNumber) + ' — ' + escapeUi(state.map.aircraftName) : 'Interactive simulated seat map for ' + escapeUi(state.map.flightNumber)) + escapeUi(deckLabel) + '</title>');
    markup.push('<g id="seatmapPlane" transform="translate(' + state.panX.toFixed(1) + ' ' + state.panY.toFixed(1) + ') scale(' + state.zoom.toFixed(2) + ')">');
    if (geometry.wingStart && geometry.wingEnd) {
      var wingTop = geometry.wingStart.y + 8;
      var wingBottom = geometry.wingEnd.y + 26;
      markup.push('<path class="seatmap-wing" d="M ' + (center - 16) + ' ' + (wingTop - 22) + ' L ' + (fuselageLeft - 62) + ' ' + (wingTop + 78) + ' L ' + (fuselageLeft - 45) + ' ' + (wingBottom + 42) + ' L ' + (center - 22) + ' ' + (wingBottom + 4) + ' L ' + center + ' ' + (wingBottom + 22) + ' L ' + (center + 22) + ' ' + (wingBottom + 4) + ' L ' + (fuselageRight + 45) + ' ' + (wingBottom + 42) + ' L ' + (fuselageRight + 62) + ' ' + (wingTop + 78) + ' L ' + (center + 16) + ' ' + (wingTop - 22) + ' Z"/>');
    }
    markup.push('<path class="seatmap-fuselage" d="M ' + center + ' ' + top + ' C ' + (center - 74) + ' ' + top + ' ' + fuselageLeft + ' ' + (top + 44) + ' ' + fuselageLeft + ' ' + (top + 104) + ' L ' + fuselageLeft + ' ' + (bottom - 96) + ' C ' + fuselageLeft + ' ' + (bottom - 35) + ' ' + (center - 62) + ' ' + bottom + ' ' + center + ' ' + bottom + ' C ' + (center + 62) + ' ' + bottom + ' ' + fuselageRight + ' ' + (bottom - 35) + ' ' + fuselageRight + ' ' + (bottom - 96) + ' L ' + fuselageRight + ' ' + (top + 104) + ' C ' + fuselageRight + ' ' + (top + 44) + ' ' + (center + 74) + ' ' + top + ' ' + center + ' ' + top + ' Z"/>');
    markup.push('<path class="seatmap-centerline" d="M ' + center + ' ' + (top + 34) + ' L ' + center + ' ' + (bottom - 28) + '"/>');
    markup.push('<text class="seatmap-facility" x="' + center + '" y="' + (top + 25) + '" text-anchor="middle">FRONT · GALLEY / LAVATORY</text>');
    markup.push('<text class="seatmap-facility" x="' + center + '" y="' + (bottom - 12) + '" text-anchor="middle">REAR · LAVATORY</text>');

    geometry.cabins.forEach(function (cabin) {
      markup.push('<text class="seatmap-cabin-label" x="' + center + '" y="' + cabin.y + '" text-anchor="middle">' + escapeUi(cabin.name.toUpperCase()) + '</text>');
    });
    geometry.rows.forEach(function (row) {
      var leftX = row.x - 14;
      var rightX = row.x + row.width + 14;
      markup.push('<text class="seatmap-row-label" x="' + leftX + '" y="' + (row.y + 17) + '" text-anchor="end">' + row.rowNumber + '</text>');
      markup.push('<text class="seatmap-row-label" x="' + rightX + '" y="' + (row.y + 17) + '" text-anchor="start">' + row.rowNumber + '</text>');
      if (row.isExitRow) {
        markup.push('<text class="seatmap-exit-label" x="' + (row.x + row.width / 2) + '" y="' + (row.y - 3) + '" text-anchor="middle">' + (state.map.airline ? 'EXIT ROW' : 'EXIT ROW · SAMPLE') + '</text>');
      }
    });

    geometry.seats.forEach(function (placed) {
      var seat = placed.seat;
      var key = seatKey(seat);
      var isShownByFilter = !!availableSet[key];
      var isSelected = state.selectedSeatId === key;
      var isDemoChoice = state.demoSeatId === key;
      var label = "Seat " + seatLabel(seat, state.map) + ", " + seat.cabin + ", " + seat.position + ", " + statusLabel(seat.status)
        + (state.map.airline ? ", " + (seat.outsideTicketedCabin ? "outside your ticketed cabin" : "in your ticketed cabin") : "");
      var outside = !!seat.outsideTicketedCabin;
      var className = "seatmap-seat status-" + seat.status + (isSelected ? " is-selected" : "") + (isDemoChoice ? " is-demo-choice" : "") + (isShownByFilter ? "" : " is-filtered-out") + (outside ? " is-outside-cabin" : "");
      markup.push('<g class="' + className + '" data-seat-id="' + escapeUi(key) + '" data-deck-index="' + seat.deck + '" tabindex="0" role="button" aria-label="' + escapeUi(label) + '">');
      markup.push('<rect class="seatmap-seat-box" x="' + placed.x + '" y="' + placed.y + '" width="' + placed.width + '" height="' + placed.height + '" rx="1"/>');
      markup.push('<text class="seatmap-seat-letter" x="' + (placed.x + placed.width / 2) + '" y="' + (placed.y + 17) + '" text-anchor="middle">' + escapeUi(seat.letter) + '</text>');
      if (seat.isExitRow) markup.push('<path class="seatmap-seat-mark" d="M ' + (placed.x + 4) + ' ' + (placed.y + 4) + ' l 4 4 -4 4"/>');
      markup.push('</g>');
    });
    markup.push('</g>');
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("aria-label", (state.map.airline
      ? "Seat map for " + state.map.airline + " " + state.map.flightNumber + ", " + state.map.aircraftName
      : "Interactive simulated seat map for " + state.map.flightNumber + ", " + state.map.aircraftName) + deckLabel);
    svg.innerHTML = markup.join("");
  }

  /** Fill the selected-seat details panel using text-safe DOM updates. */
  function renderDetails(doc, state) {
    var panel = doc.getElementById("seatmapSeatDetails");
    var action = doc.getElementById("seatmapDemoSelect");
    if (!panel || !action) return;
    var seat = state.selectedSeatId ? state.seatsById[state.selectedSeatId] : null;
    if (!seat) {
      panel.innerHTML = '<p class="seatmap-empty-detail">Click a seat. I will tell you what it is, what it is not, and nothing at all about who is sitting in it.</p>';
      action.disabled = true;
      action.textContent = "SELECT A SAMPLE SEAT";
      return;
    }
    var features = seat.features.slice();
    var status = statusLabel(seat.status);
    var real = !!state.map.airline;
    if (real) {
      features.unshift(seat.outsideTicketedCabin ? "OUTSIDE YOUR TICKETED CABIN" : "IN YOUR TICKETED CABIN");
      panel.innerHTML = '<div class="seatmap-detail-name">' + escapeUi(seatLabel(seat, state.map)) + '</div>' +
        '<div class="seatmap-detail-status status-text-' + escapeUi(seat.status) + '">' + escapeUi(status.toUpperCase()) + ' · SIMULATED STATUS</div>' +
        '<dl class="seatmap-detail-list">' +
        '<div><dt>FLIGHT</dt><dd>' + escapeUi(state.map.airline + " " + state.map.flightNumber + " · " + state.map.origin + " → " + state.map.destination) + '</dd></div>' +
        '<div><dt>AIRCRAFT</dt><dd>' + escapeUi(state.map.aircraftName + " (" + state.map.aircraftCode + ")") + '</dd></div>' +
        '<div><dt>CABIN</dt><dd>' + escapeUi(seat.cabin) + (state.map.ticketedCabinLabel ? ' · your ticket: ' + escapeUi(state.map.ticketedCabinLabel) : '') + '</dd></div>' +
        '<div><dt>POSITION</dt><dd>' + escapeUi(seat.position) + '</dd></div>' +
        '<div><dt>PITCH</dt><dd>' + escapeUi(seat.pitchInches) + ' in · reference layout</dd></div>' +
        '<div><dt>WIDTH</dt><dd>' + escapeUi(seat.widthInches) + ' in · reference layout</dd></div>' +
        '<div><dt>FEATURES</dt><dd>' + escapeUi(features.join(" · ")) + '</dd></div>' +
        '<div><dt>FARE</dt><dd>Not connected — no seat prices are shown</dd></div>' +
        '</dl>';
    } else {
      panel.innerHTML = '<div class="seatmap-detail-name">' + escapeUi(seatLabel(seat, state.map)) + '</div>' +
        '<div class="seatmap-detail-status status-text-' + escapeUi(seat.status) + '">' + escapeUi(status.toUpperCase()) + ' · SIMULATED</div>' +
        '<dl class="seatmap-detail-list">' +
        '<div><dt>CABIN</dt><dd>' + escapeUi(seat.cabin) + '</dd></div>' +
        '<div><dt>POSITION</dt><dd>' + escapeUi(seat.position) + '</dd></div>' +
        '<div><dt>PITCH</dt><dd>' + escapeUi(seat.pitchInches) + ' in · sample</dd></div>' +
        '<div><dt>WIDTH</dt><dd>' + escapeUi(seat.widthInches) + ' in · sample</dd></div>' +
        '<div><dt>FEATURES</dt><dd>' + escapeUi(features.join(" · ")) + '</dd></div>' +
        '<div><dt>PRICE</dt><dd>Not connected in demo</dd></div>' +
        '</dl>';
    }
    var refuses = real && seat.outsideTicketedCabin;
    action.disabled = refuses || !isSelectableStatus(seat.status);
    if (refuses) {
      action.textContent = "NOT THIS ITINERARY'S CABIN";
    } else if (!isSelectableStatus(seat.status)) {
      action.textContent = real ? "STATUS SIMULATED — NOT SELECTABLE" : "SAMPLE SEAT NOT AVAILABLE";
    } else if (state.demoSeatId === seatKey(seat)) {
      action.textContent = "REMOVE SAMPLE SELECTION";
    } else {
      action.textContent = real ? "MARK SAMPLE SEAT (RESERVES NOTHING)" : "ADD TO DEMO SELECTION";
    }
  }

  /** Render the simulated availability totals and source labels. */
  function renderStats(doc, state) {
    var counts = countStatuses(state.map, state.activeDeck);
    var multiDeck = state.map && state.map.decks.length > 1;
    var count = doc.getElementById("seatmapAvailableCount");
    var total = doc.getElementById("seatmapTotalCount");
    var selection = doc.getElementById("seatmapSelectionStatus");
    var update = doc.getElementById("seatmapLastUpdated");
    if (count) count.textContent = String(counts.selectable);
    if (total) total.textContent = String(counts.total);
    var chosen = state.seatsById[state.demoSeatId];
    if (selection) selection.textContent = chosen
      ? "DEMO SELECTION: " + seatLabel(chosen, state.map) + " — NO RESERVATION MADE"
      : "NO SEAT SELECTED";
    var scope = doc.getElementById("seatmapCountScope");
    if (scope) scope.textContent = multiDeck
      ? " seats on the " + deckName(state.activeDeck).toLowerCase() + " (" + state.map.totalSeats + " across both decks). Counts are not inventory."
      : " seats in this illustrative layout. Counts are not inventory.";
    if (update) update.textContent = state.map
      ? (state.map.airline ? "FLIGHT DATA REAL · SEAT STATUS SIMULATED " : "SIMULATED UPDATE ") + new Date(state.map.generatedAt).toLocaleTimeString()
      : "NO MAP LOADED";
    var statusCounts = doc.getElementById("seatmapStatusCounts");
    if (statusCounts) {
      statusCounts.textContent = (multiDeck ? deckName(state.activeDeck).toUpperCase() + " · " : "") + "SELECTABLE " + counts.selectable + " · OCCUPIED " + counts.occupied + " · UNAVAILABLE " + counts.blocked;
    }
  }

  /** Update the countdown until the next local-only sample refresh. */
  function updateCountdown(doc, state) {
    var element = doc.getElementById("seatmapRefreshCountdown");
    if (!element) return;
    if (!state.map || !state.nextRefreshAt) { element.textContent = "NEXT SIMULATED UPDATE —"; return; }
    var seconds = Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
    var mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    var ss = String(seconds % 60).padStart(2, "0");
    element.textContent = "NEXT SIMULATED UPDATE 00:" + mm + ":" + ss;
  }

  /** Show where the flight data came from and exactly what is real. */
  function renderFlightStrip(doc, state) {
    var strip = doc.getElementById("seatmapFlightStrip");
    if (!strip) return;
    var map = state.map;
    if (!map || !map.airline) {
      strip.classList.add("hidden");
      return;
    }
    strip.classList.remove("hidden");
    var source = doc.getElementById("seatmapStripSource");
    var identity = doc.getElementById("seatmapStripIdentity");
    var equipment = doc.getElementById("seatmapStripEquipment");
    var cabin = doc.getElementById("seatmapStripCabin");
    var layout = doc.getElementById("seatmapStripLayout");
    var link = doc.getElementById("seatmapStripLink");
    if (source) {
      var searched = map.flightSource === "search";
      var prefix = searched ? (map.searchSourceLabel || "FROM THE LOCAL FLIGHT TABLE") : "FROM YOUR CONVERTED ITINERARY";
      var legPart = (!searched && map.legCount > 1) ? " · LEG " + (map.legIndex + 1) + " OF " + map.legCount : "";
      var when = (!searched && state.routeStoredAt) ? " · CONVERTED " + new Date(state.routeStoredAt).toLocaleString() : "";
      source.textContent = prefix + legPart + when;
    }
    if (identity) {
      identity.textContent = map.airline + " " + map.flightNumber
        + (map.airlineName ? " (" + map.airlineName + ")" : "")
        + " · " + map.origin + " → " + map.destination
        + (map.originName || map.destinationName ? " — " + map.originName + " to " + map.destinationName : "");
    }
    if (equipment) {
      equipment.textContent = "AIRCRAFT " + (map.aircraftCode || "???") + " · " + map.aircraftName
        + " · " + (map.equipmentSource || "provenance unknown");
    }
    if (cabin) {
      if (map.flightSource === "search") {
        cabin.textContent = "CABIN SHOWN: " + (map.cabinShown ? String(cabinLabel(map.cabinShown) || map.cabinShown).toUpperCase() : "ALL CABINS")
          + (map.departureDate ? " · " + map.departureDate : "")
          + " · NO TICKET — SEAT STATUSES BELOW ARE SIMULATED";
      } else {
        cabin.textContent = "TICKET: " + (map.cabin || "cabin not stated")
          + (map.bookingClass ? " · CLASS " + map.bookingClass : "")
          + (map.depTime ? " · DEPARTS " + map.depTime : "")
          + (map.departureDate ? " · " + map.departureDate + (map.dateYearInferred ? " (year inferred)" : "") : "");
      }
    }
    if (layout) {
      layout.textContent = (map.layoutConfig || "") + (map.layoutConfig ? " — " : "") + (map.layoutLabel || "");
      layout.className = "seatmap-strip-layout tier-" + (map.layoutTier || "unknown");
    }
    if (link) {
      if (map.seatPageUrl) {
        link.href = map.seatPageUrl;
        link.textContent = "OPEN " + (map.airlineName || map.airline).toUpperCase() + " — LIVE SEATS ARE IN YOUR BOOKING";
        link.classList.remove("hidden");
      } else {
        link.classList.add("hidden");
      }
    }
    var note = doc.getElementById("seatmapStripNote");
    if (note) {
      var parts = [];
      if (map.cabinNote) parts.push(map.cabinNote);
      if (map.miles) parts.push("Published distance " + map.miles + " mi.");
      if (map.warnings && map.warnings.length) parts.push(map.warnings.join(" · "));
      parts.push(map.flightSource === "search"
        ? "The aircraft type comes from " + String(map.searchSourceLabel || "the local flight table").toLowerCase()
          + " — airlines swap aircraft, so check the airline for today's; the seat statuses below are simulated — no airline inventory is connected."
        : "The aircraft type comes from your itinerary; the seat statuses below are simulated — no airline inventory is connected.");
      note.textContent = parts.join(" ");
    }
  }

  /** One button per converted leg; the map re-renders for the chosen leg. */
  function renderLegSwitcher(doc, state) {
    var holder = doc.getElementById("seatmapLegs");
    if (!holder) return;
    if (state.searched || !state.legs || state.legs.length < 2) {
      holder.classList.add("hidden");
      holder.innerHTML = "";
      return;
    }
    holder.classList.remove("hidden");
    var markup = '<span class="seatmap-legs-label">LEGS IN YOUR ITINERARY</span>';
    state.legs.forEach(function (leg, index) {
      var active = index === state.legIndex;
      markup += '<button type="button" class="seatmap-leg' + (active ? " is-active" : "") + '" data-leg-index="' + index + '"'
        + (active ? ' aria-current="true"' : "")
        + ' title="' + escapeUi(leg.airline + " " + leg.flightNumber + " " + leg.origin + "-" + leg.destination) + '">'
        + '<span class="seatmap-leg-flight">' + escapeUi(leg.airline + " " + leg.flightNumber) + '</span>'
        + '<span class="seatmap-leg-route">' + escapeUi(leg.origin + "→" + leg.destination) + '</span>'
        + '<span class="seatmap-leg-equipment">' + escapeUi(leg.equipment || "???") + (leg.equipmentNote && leg.equipmentNote.indexOf("inferred") >= 0 ? " ·inf" : "") + '</span>'
        + '</button>';
    });
    holder.innerHTML = markup;
  }

  /** The deck controls are offered only when this layout contains both decks.
   *  Static buttons keep keyboard focus while the drawing changes. */
  function renderDeckSwitcher(doc, state) {
    var holder = doc.getElementById("seatmapDecks");
    if (!holder) return;
    var decks = getDecks(state.map);
    holder.classList.toggle("hidden", decks.length < 2);
    ["Main", "Upper"].forEach(function (name, index) {
      var deck = decks.filter(function (item) { return item.index === index; })[0];
      var button = doc.getElementById("seatmapDeck" + name);
      var count = doc.getElementById("seatmapDeck" + name + "Count");
      if (button) {
        button.disabled = !deck;
        button.setAttribute("aria-pressed", String(!!deck && state.activeDeck === index));
      }
      if (count) count.textContent = deck ? deck.seatCount + " seats" : "";
    });
    var status = doc.getElementById("seatmapDeckStatus");
    if (status) status.textContent = decks.length > 1
      ? "Viewing " + deckName(state.activeDeck).toLowerCase() + " · 2 passenger decks" : "";
  }

  function renderCabinFilter(doc, state) {
    var control = doc.getElementById("seatmapFilterCabin");
    var codes = [];
    state.map.cabins.forEach(function (cabin) {
      if (cabin.deck === state.activeDeck && codes.indexOf(cabin.code) < 0) codes.push(cabin.code);
    });
    if (codes.indexOf(state.filters.cabin) < 0) state.filters.cabin = "all";
    if (!control) return;
    control.setAttribute("aria-label", "Cabin filter" + (state.map.decks.length > 1 ? " · " + deckName(state.activeDeck) : ""));
    control.innerHTML = '<option value="all">All cabins</option>'
      + codes.map(function (code) { return '<option value="' + escapeUi(code) + '">' + escapeUi(cabinLabel(code) || code) + '</option>'; }).join("");
    control.value = state.filters.cabin;
  }

  function prepareMap(state, map, preserveView, preferredCabin) {
    state.map = map;
    if (!preserveView) {
      state.activeDeck = initialDeck(map, preferredCabin || map.ticketedCabin || map.cabinShown);
      state.refreshTick = 0;
      state.selectedSeatId = null;
      state.demoSeatId = null;
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
    }
    state.nextRefreshAt = Date.now() + 30000;
  }

  /** Render seat SVG, details, and status counters in a single update. */
  function renderViewer(doc, state) {
    if (!state.map) { renderDeckSwitcher(doc, state); return; }
    if (!state.map.decks.some(function (deck) { return deck.index === state.activeDeck; })) state.activeDeck = initialDeck(state.map);
    renderDeckSwitcher(doc, state);
    state.seatsById = {};
    flattenSeats(state.map).forEach(function (seat) { state.seatsById[seatKey(seat)] = seat; });
    state.geometry = calculateLayout(state.map, state.activeDeck);
    renderCabinFilter(doc, state);
    var flightName = doc.getElementById("seatmapFlightName");
    var flightMeta = doc.getElementById("seatmapFlightMeta");
    if (state.map.airline) {
      if (flightName) flightName.textContent = state.map.airline + " " + state.map.flightNumber
        + " · " + state.map.origin + " → " + state.map.destination;
      if (flightMeta) flightMeta.textContent = (state.map.departureDate || "date not stated")
        + " · " + state.map.aircraftName + " (" + state.map.aircraftCode + ")"
        + " · " + state.map.totalSeats + " seats" + (state.map.decks.length > 1 ? " across 2 decks" : "") + " · " + (state.map.layoutConfig || "");
    } else {
      if (flightName) flightName.textContent = state.map.flightNumber + " · " + state.map.origin + " → " + state.map.destination;
      if (flightMeta) flightMeta.textContent = state.map.departureDate + " · " + state.map.aircraftName + " (" + state.map.aircraftCode + ") · "
        + state.map.totalSeats + " seats" + (state.map.decks.length > 1 ? " across 2 decks" : "") + (state.map.layoutConfig ? " · " + state.map.layoutConfig : " in static sample layout");
    }
    var svg = doc.getElementById("seatmapSvg");
    if (svg) renderSvg(state, svg);
    var zoomLabel = doc.getElementById("seatmapZoomValue");
    if (zoomLabel) zoomLabel.textContent = Math.round(state.zoom * 100) + "%";
    renderFlightStrip(doc, state);
    renderLegSwitcher(doc, state);
    renderDetails(doc, state);
    renderStats(doc, state);
    updateCountdown(doc, state);
  }

  /* ------------------------------------------------------------------ *
   * Flight search — "which aircraft is BA 117, and what is its cabin?"
   *
   * There is no schedule feed here and no airline to ask, so the lookup is
   * layered and every layer says where its answer came from: the local flight
   * table, the converter's own table, what we can infer for the airline, or
   * nothing (and then the user picks the type by hand). The page never
   * pretends a lookup is an assignment: airlines swap aircraft daily.
   * ------------------------------------------------------------------ */

  function flightsApi() {
    if (FLIGHT_API) return FLIGHT_API;
    return (root && root.SpicySeatMapFlights) || null;
  }

  /** Every aircraft type this page can actually draw. */
  function drawableTypes() {
    return LAYOUT_API ? Object.keys(LAYOUT_API.TYPE_LAYOUTS).sort() : [];
  }

  function typeLabel(code) {
    var table = aircraftTypes();
    var entry = table && table[code];
    return entry && entry[1] ? entry[1] : String(code);
  }

  /** Fill the manual aircraft picker with every drawable type. */
  function populateAircraftSelect(doc, selected) {
    var select = doc.getElementById("seatmapAircraft");
    if (!select) return;
    var markup = ['<option value="">Choose an aircraft type…</option>'];
    drawableTypes().forEach(function (code) {
      markup.push('<option value="' + escapeUi(code) + '"' + (code === selected ? " selected" : "") + ">"
        + escapeUi(code + " · " + typeLabel(code)) + "</option>");
    });
    select.innerHTML = markup.join("");
  }

  /** Where the searched flight's aircraft type came from, in one line. */
  function sourceLine(result) {
    return result ? (result.sourceLabel || "LOCAL FLIGHT TABLE") : "LOCAL FLIGHT TABLE";
  }

  /** Draw a flight the user looked up. No ticket, so no cabin is dimmed: the
   *  whole aircraft is shown, and the cabin the user asked for — if the type
   *  flies one — is the configuration drawn. */
  function loadSearchedFlight(doc, state, flight, preserveView) {
    var map;
    try {
      map = createFlightSeatMap({
        airline: flight.airline,
        flightNumber: flight.number,
        origin: flight.origin,
        destination: flight.destination,
        /* A lookup does not need a date to draw a cabin — the layout is the
           type's, and no schedule is involved — so an empty date box falls
           back to today instead of refusing to draw. */
        departureDate: flight.date || localDateValue(new Date()),
        equipment: flight.equipment,
        cabinPreference: flight.cabin || null,
        airlineName: airlineLabel(flight.airline),
        originName: airportLabel(flight.origin),
        destinationName: airportLabel(flight.destination),
        equipmentNote: sourceLine(flight.result) + " — the type usually assigned, not a live assignment",
        searchSourceLabel: sourceLine(flight.result),
        search: true,
        legIndex: 0,
        legCount: 1
      }, preserveView ? state.refreshTick : 0);
    } catch (error) {
      setNotice(doc, error.message + " No cabin is invented to fill the gap.", true);
      return null;
    }
    /* The converted itinerary is kept, not discarded: "back to the flight I
       converted" has to still work after a lookup. What changes is what the
       viewer is showing, and the leg switcher stands down while it does. */
    state.searched = Object.assign({}, flight, { date: map.departureDate });
    state.currentInput = { manual: false, search: true };
    prepareMap(state, map, preserveView);
    var demoPanel = doc.getElementById("seatmapDemo");
    if (demoPanel) demoPanel.classList.remove("hidden");
    var useConvertedAfterSearch = doc.getElementById("seatmapUseConverted");
    if (useConvertedAfterSearch && state.legs) useConvertedAfterSearch.classList.remove("hidden");
    var searchButton = doc.getElementById("seatmapSearchButton");
    if (searchButton) searchButton.textContent = "DRAW THIS TYPE";
    var legsHolder = doc.getElementById("seatmapLegs");
    if (legsHolder) { legsHolder.classList.add("hidden"); legsHolder.innerHTML = ""; }
    setNotice(doc, map.airline + " " + map.flightNumber + " · " + map.aircraftName + " (" + map.aircraftCode + ") · "
      + map.totalSeats + " seats · " + sourceLine(flight.result) + " · SEAT STATUSES SIMULATED", false);
    renderViewer(doc, state);
    return map;
  }

  /** Render what a lookup found: the flights themselves, or the honest reason
   *  nothing was found plus the way forward. */
  function renderSearchResults(doc, state, result, label) {
    var holder = doc.getElementById("seatmapSearchResults");
    if (!holder) return;
    if (!result) { holder.innerHTML = ""; holder.classList.add("hidden"); return; }
    holder.classList.remove("hidden");
    var markup = "";

    if (result.flights && result.flights.length) {
      markup += '<p class="seatmap-search-note"><span class="seatmap-search-tag">' + escapeUi(result.sourceLabel)
        + '</span> ' + escapeUi(label) + " — pick one to draw its cabin.</p>";
      result.flights.forEach(function (entry) {
        markup += '<button type="button" class="seatmap-result" data-airline="' + escapeUi(entry.airline)
          + '" data-number="' + escapeUi(entry.number) + '" data-origin="' + escapeUi(entry.origin)
          + '" data-destination="' + escapeUi(entry.destination) + '" data-aircraft="' + escapeUi(entry.equipment)
          + '" data-source="' + escapeUi(result.sourceLabel) + '">'
          + '<span class="seatmap-result-flight">' + escapeUi(entry.airline + " " + entry.number) + '</span>'
          + '<span class="seatmap-result-route">' + escapeUi(entry.origin + " → " + entry.destination) + '</span>'
          + '<span class="seatmap-result-aircraft">' + escapeUi(entry.equipment + " · " + typeLabel(entry.equipment)) + '</span>'
          + "</button>";
      });
      markup += '<p class="seatmap-search-foot">The type is the one usually assigned to this flight number. Airlines swap aircraft — check the airline for today’s.</p>';
      holder.innerHTML = markup;
      return;
    }

    if (result.kind === "type-only") {
      markup += '<p class="seatmap-search-note"><span class="seatmap-search-tag">' + escapeUi(result.sourceLabel)
        + "</span> " + escapeUi(label) + " is on file as a " + escapeUi(result.equipment + " · " + typeLabel(result.equipment))
        + ", but no route is. Add the airports (for example " + escapeUi(label.replace(/\s+$/, "") + " LHR JFK") + "), or pick a route and I will draw that type.</p>";
      markup += '<button type="button" class="seatmap-result" data-aircraft="' + escapeUi(result.equipment)
        + '" data-source="' + escapeUi(result.sourceLabel) + '" data-airline="' + escapeUi(result.airline || "")
        + '" data-number="' + escapeUi(result.number || "") + '">'
        + '<span class="seatmap-result-flight">USE ' + escapeUi(result.equipment) + " IN THE FORM BELOW</span>"
        + '<span class="seatmap-result-aircraft">' + escapeUi(typeLabel(result.equipment)) + "</span></button>";
      holder.innerHTML = markup;
      return;
    }

    if (result.equipment) {
      var routeLabel = (result.origin || "") + " → " + (result.destination || "");
      markup += '<p class="seatmap-search-note"><span class="seatmap-search-tag">' + escapeUi(result.sourceLabel)
        + "</span> " + escapeUi(label) + " is not in the local flight table. For " + escapeUi(routeLabel)
        + " I would expect a " + escapeUi((result.equipment || "") + (result.equipment ? " · " + typeLabel(result.equipment) : ""))
        + " — an inference, not a schedule.</p>";
      {
        markup += '<button type="button" class="seatmap-result" data-aircraft="' + escapeUi(result.equipment)
          + '" data-origin="' + escapeUi(result.origin || "") + '" data-destination="' + escapeUi(result.destination || "")
          + '" data-airline="' + escapeUi(result.airline || "") + '" data-number="' + escapeUi(result.number || "")
          + '" data-source="' + escapeUi(result.sourceLabel) + '">'
          + '<span class="seatmap-result-flight">DRAW ' + escapeUi(result.equipment) + " ON THIS ROUTE</span>"
          + '<span class="seatmap-result-route">' + escapeUi(routeLabel) + "</span>"
          + '<span class="seatmap-result-aircraft">' + escapeUi(typeLabel(result.equipment)) + "</span></button>";
      }
      holder.innerHTML = markup;
      return;
    }

    markup += '<p class="seatmap-search-note"><span class="seatmap-search-tag">NOT IN THE LOCAL TABLES</span> '
      + escapeUi(label) + " is not in the local flight table — there is no schedule feed in this tab and I will not guess a flight. "
      + "Give me the route and the aircraft type below and the cabin is drawn from that.</p>";
    holder.innerHTML = markup;
  }

  /** Run one lookup and show what it found. */
  function runFlightSearch(doc, state) {
    var api = flightsApi();
    var input = doc.getElementById("seatmapFlightQuery");
    var raw = input ? input.value : "";
    var dateInput = doc.getElementById("seatmapFindDate") || doc.getElementById("seatmapDate");
    var date = dateInput ? dateInput.value : "";
    var cabinSelect = doc.getElementById("seatmapSearchCabin");
    var cabin = cabinSelect ? cabinSelect.value : "";
    try { if (date) date = normalizeDate(date); }
    catch (error) { setNotice(doc, error.message, true); return null; }
    if (!api) {
      setNotice(doc, "The local flight table is unavailable.", true);
      return null;
    }
    var parsed = api.parseQuery(raw);
    if (!parsed) {
      setNotice(doc, "Type a flight number (BA117), a flight with its route (BA 117 LHR JFK), or two airports (CAI LHR).", true);
      renderSearchResults(doc, state, { kind: "unparsed", sourceLabel: "NOTHING TO LOOK UP" }, String(raw || "").trim());
      return null;
    }

    if (parsed.kind === "route") {
      var byRoute = api.searchRoute(parsed.origin, parsed.destination, { data: dataTable() });
      byRoute.airline = "";
      renderSearchResults(doc, state, byRoute, parsed.origin + " → " + parsed.destination);
      setNotice(doc, byRoute.flights.length
        ? byRoute.flights.length + " flight(s) on " + parsed.origin + " → " + parsed.destination + " in the local table."
        : "No flight on that route in the local table — here is what I can infer.", false);
      return byRoute;
    }

    var result = api.lookup(parsed.airline, parsed.number, {
      origin: parsed.origin, destination: parsed.destination, data: dataTable()
    });
    result.airline = parsed.airline;
    result.number = parsed.number;
    renderSearchResults(doc, state, result, parsed.airline + " " + parsed.number);

    if (result.kind === "flight") {
      var entry = result.flights[0];
      return loadSearchedFlight(doc, state, {
        airline: entry.airline, number: entry.number, origin: entry.origin, destination: entry.destination,
        equipment: entry.equipment, date: date, cabin: cabin, result: result
      });
    }
    if (result.equipment && parsed.origin && parsed.destination) {
      return loadSearchedFlight(doc, state, {
        airline: parsed.airline, number: parsed.number, origin: parsed.origin, destination: parsed.destination,
        equipment: result.equipment, date: date, cabin: cabin, result: result
      });
    }
    if (result.equipment) {
      populateAircraftSelect(doc, result.equipment);
      setNotice(doc, parsed.airline + " " + parsed.number + ": type " + result.equipment + " is on file (" + result.sourceLabel
        + ") but no route is — add the airports and it draws.", false);
      return result;
    }
    setNotice(doc, parsed.airline + " " + parsed.number + " is not in the local tables. No schedule feed here — pick the route and the type below.", true);
    return result;
  }

  /** Back to the itinerary the user converted (after looking something up). */
  function loadConvertedRoute(doc, state) {
    if (!state.legs || !state.legs.length) {
      setNotice(doc, "Nothing converted in this tab yet — paste an itinerary on the terminal and it lands here.", true);
      return null;
    }
    state.searched = null;
    setNotice(doc, "", false);
    var results = doc.getElementById("seatmapSearchResults");
    if (results) { results.innerHTML = ""; results.classList.add("hidden"); }
    return loadLeg(doc, state, state.legIndex || 0);
  }

  /** Load one leg of the stored itinerary into the viewer. */
  function loadLeg(doc, state, index, preserveView) {
    if (!state.legs || !state.legs.length) return null;
    var leg = state.legs[index];
    if (!leg) return null;
    var flight = {
      airline: leg.airline,
      airlineName: leg.airlineName,
      flightNumber: leg.flightNumber,
      origin: leg.origin,
      destination: leg.destination,
      originName: leg.originName,
      destinationName: leg.destinationName,
      departureDate: leg.departureDate,
      equipment: leg.equipment,
      cabin: leg.cabin,
      cabinCode: leg.cabinCode,
      bookingClass: leg.bookingClass,
      depTime: leg.depTime,
      arrTime: leg.arrTime,
      miles: leg.miles,
      equipmentNote: leg.equipmentNote,
      warnings: leg.warnings,
      legIndex: index,
      legCount: state.legs.length
    };
    var map;
    try {
      map = createFlightSeatMap(flight, preserveView ? state.refreshTick : 0);
    } catch (error) {
      state.map = null;
      state.legIndex = index;
      state.activeDeck = null;
      state.currentInput = null;
      state.selectedSeatId = null;
      state.demoSeatId = null;
      state.seatsById = {};
      state.geometry = null;
      state.nextRefreshAt = 0;
      updateCountdown(doc, state);
      renderDeckSwitcher(doc, state);
      renderDetails(doc, state);
      renderStats(doc, state);
      var demo = doc.getElementById("seatmapDemo");
      if (demo) demo.classList.remove("hidden");
      var badge = doc.getElementById("seatmapFlightName");
      if (badge) badge.textContent = leg.airline + " " + leg.flightNumber + " · " + leg.origin + " → " + leg.destination;
      var meta = doc.getElementById("seatmapFlightMeta");
      if (meta) meta.textContent = "No seat map can be drawn for this leg.";
      setNotice(doc, error.message + " The flight data is real; no layout is invented to fill the gap.", true);
      var svgEmpty = doc.getElementById("seatmapSvg");
      if (svgEmpty) svgEmpty.innerHTML = "";
      var strip = doc.getElementById("seatmapFlightStrip");
      if (strip) strip.classList.remove("hidden");
      var layoutNote = doc.getElementById("seatmapStripLayout");
      if (layoutNote) {
        layoutNote.textContent = error.message;
        layoutNote.className = "seatmap-strip-layout tier-" + TIERS.UNKNOWN_TYPE;
      }
      var identity = doc.getElementById("seatmapStripIdentity");
      if (identity) identity.textContent = leg.airline + " " + leg.flightNumber + " · " + leg.origin + " → " + leg.destination + " · AIRCRAFT " + (leg.equipment || "???") + " (" + leg.equipmentNote + ")";
      var link = doc.getElementById("seatmapStripLink");
      if (link) {
        var url = seatPageUrl(leg.airline);
        if (url) { link.href = url; link.textContent = "OPEN " + (leg.airlineName || leg.airline).toUpperCase() + " FOR THE REAL SEAT MAP"; link.classList.remove("hidden"); }
        else link.classList.add("hidden");
      }
      renderLegSwitcher(doc, state);
      return null;
    }
    state.legIndex = index;
    state.searched = null;
    state.currentInput = { manual: false };
    prepareMap(state, map, preserveView);
    var demoPanel = doc.getElementById("seatmapDemo");
    if (demoPanel) demoPanel.classList.remove("hidden");
    var search = doc.getElementById("seatmapSearchButton");
    if (search) search.textContent = "GENERATE SAMPLE MAP";
    setNotice(doc, "SEAT MAP LOADED FROM YOUR CONVERTED ITINERARY — LEG " + (index + 1) + " OF " + state.legs.length
      + " · " + map.layoutLabel, false);
    var backToConverted = doc.getElementById("seatmapUseConverted");
    if (backToConverted) backToConverted.classList.add("hidden");
    renderViewer(doc, state);
    return map;
  }

  /** Generate the next deterministic sample refresh and preserve the inspected
   *  seat. A real flight is never re-generated from the manual form: its legs
   *  are re-loaded instead, so the flight identity can never drift. */
  function refreshSample(doc, state) {
    if (!state.currentInput || !state.map) return;
    state.refreshTick++;
    if (state.searched) {
      loadSearchedFlight(doc, state, state.searched, true);
    } else if (state.currentInput.manual === false && state.legs) {
      loadLeg(doc, state, state.legIndex == null ? 0 : state.legIndex, true);
    } else {
      state.map = createDemoSeatMap(state.currentInput, state.refreshTick);
    }
    if (!state.map) return;
    if (state.demoSeatId) {
      var updatedChoice = flattenSeats(state.map).filter(function (seat) { return seatKey(seat) === state.demoSeatId; })[0];
      if (!updatedChoice || !isSelectableStatus(updatedChoice.status)) state.demoSeatId = null;
    }
    state.nextRefreshAt = Date.now() + 30000;
    renderViewer(doc, state);
    var live = doc.getElementById("seatmapRefreshStatus");
    if (live) {
      live.textContent = "SEAT STATUSES RESAMPLED " + new Date(state.map.generatedAt).toLocaleTimeString()
        + " — STILL SIMULATED, NO AIRLINE DATA REQUESTED";
    }
  }

  /** Set accessible status text without inserting any user-provided markup. */
  function setNotice(doc, message, isError) {
    var status = doc.getElementById("seatmapFormStatus");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", !!isError);
  }

  /** Download text locally using a short-lived object URL. */
  function downloadText(text, fileName, type) {
    if (!root.Blob || !root.URL || !root.URL.createObjectURL) return false;
    var blob = new root.Blob([text], { type: type || "text/plain;charset=utf-8" });
    var url = root.URL.createObjectURL(blob);
    var anchor = root.document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.hidden = true;
    root.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    root.URL.revokeObjectURL(url);
    return true;
  }

  /** Copy demo text with Clipboard API and a browser fallback. */
  function copyText(text) {
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      return root.navigator.clipboard.writeText(text);
    }
    var textarea = root.document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    root.document.body.appendChild(textarea);
    textarea.select();
    var copied = false;
    try { copied = root.document.execCommand("copy"); } catch (error) { copied = false; }
    textarea.remove();
    return copied ? Promise.resolve() : Promise.reject(new Error("Clipboard access is unavailable."));
  }

  /* THE DOOR IS OPEN. The Seat Map used to fail closed behind a ten-click
     knock: a missing gate module left the page locked on purpose. That is
     retired. Nothing here consults a counter any more — the page draws the
     map on arrival for every visitor, and there is no sealed card to land on. */

  /** Bind the /seatmap preview page and all of its local demo interactions. */
  function initializeSeatMapPage(doc) {
    if (!root.location || root.location.pathname.replace(/\/+$/, "") !== "/seatmap") return;
    var page = doc.getElementById("seatmapPage");
    if (!page) return;
    doc.body.classList.add("seatmap-active");
    page.classList.remove("hidden");

    var notice = doc.getElementById("seatmapNotice");
    var content = doc.getElementById("seatmapContent");
    var continueButton = doc.getElementById("seatmapNoticeContinue");
    var form = doc.getElementById("seatmapForm");
    var demo = doc.getElementById("seatmapDemo");
    var searchButton = doc.getElementById("seatmapSearchButton");
    var state = {
      map: null,
      legs: null,
      legIndex: 0,
      routeStoredAt: null,
      currentInput: null,
      refreshTick: 0,
      nextRefreshAt: 0,
      timer: null,
      selectedSeatId: null,
      demoSeatId: null,
      seatsById: {},
      geometry: null,
      activeDeck: null,
      filters: { availableOnly: false, windowOnly: false, aisleOnly: false, exitOnly: false, cabin: "all" },
      zoom: 1,
      panX: 0,
      panY: 0,
      pointers: new Map(),
      drag: null
    };
    /* Hand the live state to whoever needs to know which flight is on
       screen — the PRICE module prices exactly this one. */
    API.pageState = state;

    function closeNotice() {
      if (!notice) return;
      notice.classList.add("hidden");
      if (content) {
        content.removeAttribute("aria-hidden");
        if ("inert" in content) content.inert = false;
      }
      if (form) {
        var firstInput = doc.getElementById("seatmapFlightNumber");
        if (firstInput) firstInput.focus();
      }
    }

    if (notice) {
      notice.classList.remove("hidden");
      if (content) {
        content.setAttribute("aria-hidden", "true");
        if ("inert" in content) content.inert = true;
      }
      if (continueButton) continueButton.focus();
    }
    if (continueButton) continueButton.addEventListener("click", closeNotice);
    if (notice) {
      notice.addEventListener("click", function (event) {
        if (event.target === notice) closeNotice();
      });
    }
    doc.addEventListener("keydown", function (event) {
      if (!notice || notice.classList.contains("hidden")) return;
      if (event.key === "Escape") {
        closeNotice();
        return;
      }
      if (event.key !== "Tab") return;
      var focusable = notice.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && (doc.activeElement === first || !notice.contains(doc.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (doc.activeElement === last || !notice.contains(doc.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    });

    ["seatmapDate", "seatmapFindDate"].forEach(function (id) {
      var field = doc.getElementById(id);
      if (field && !field.value) {
        var tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        field.value = localDateValue(tomorrow);
      }
    });

    if (CALENDAR_API) CALENDAR_API.initialize(doc);

    /* ---------- the flight lookup ---------- */
    populateAircraftSelect(doc, "");

    var findForm = doc.getElementById("seatmapFindForm");
    if (findForm) findForm.addEventListener("submit", function (event) {
      event.preventDefault();
      runFlightSearch(doc, state);
    });
    var findButton = doc.getElementById("seatmapFindButton");
    if (findButton) findButton.addEventListener("click", function (event) {
      event.preventDefault();
      runFlightSearch(doc, state);
    });

    /* Results are buttons: one click draws that flight's cabin. */
    var resultsHolder = doc.getElementById("seatmapSearchResults");
    if (resultsHolder) resultsHolder.addEventListener("click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest(".seatmap-result") : null;
      if (!button) return;
      var dateField = doc.getElementById("seatmapFindDate");
      var cabinField = doc.getElementById("seatmapSearchCabin");
      var airline = button.getAttribute("data-airline") || "";
      var number = button.getAttribute("data-number") || "";
      var origin = button.getAttribute("data-origin") || "";
      var destination = button.getAttribute("data-destination") || "";
      var aircraft = button.getAttribute("data-aircraft") || "";
      var source = button.getAttribute("data-source") || "LOCAL FLIGHT TABLE";
      var result = { sourceLabel: source, equipment: aircraft };
      if (!origin || !destination) {
        /* No route on file: the type is still useful — offer it in the form. */
        populateAircraftSelect(doc, aircraft);
        var query = doc.getElementById("seatmapFlightQuery");
        if (query && airline && number) query.value = airline + " " + number;
        setNotice(doc, aircraft + " is selected below — add the two airports and it draws.", false);
        return;
      }
      var flightField = doc.getElementById("seatmapFlightNumber");
      var originField = doc.getElementById("seatmapOrigin");
      var destinationField = doc.getElementById("seatmapDestination");
      if (flightField && airline) flightField.value = airline + number;
      if (originField) originField.value = origin;
      if (destinationField) destinationField.value = destination;
      loadSearchedFlight(doc, state, {
        airline: airline, number: number, origin: origin, destination: destination,
        equipment: aircraft, date: dateField ? dateField.value : "",
        cabin: cabinField ? cabinField.value : "", result: result
      });
    });

    /* Back from a lookup to the itinerary the user actually converted. */
    var useConverted = doc.getElementById("seatmapUseConverted");
    if (useConverted) useConverted.addEventListener("click", function () { loadConvertedRoute(doc, state); });

    /* The converted itinerary: the OUTPUT pane is stored by app.js under
       `spicy_seatmap_route`; re-reading it with the real engine here means the
       seat map and the itinerary are always the same flight. `?leg=N` selects
       a leg directly (used by the per-leg SEAT MAP links). */
    var stored = readStoredRoute();
    if (stored) {
      var route = convertRoute(stored.text, { now: new Date() });
      if (route.legs && route.legs.length) {
        state.legs = route.legs;
        state.routeStoredAt = stored.savedAt || null;
        var requested = 0;
        if (root.location && root.location.search) {
          var match = /[?&]leg=(\d+)/.exec(root.location.search);
          if (match) requested = Math.max(0, Math.min(route.legs.length - 1, Number(match[1])));
        }
        var legsHolder = doc.getElementById("seatmapLegs");
        if (legsHolder) {
          legsHolder.addEventListener("click", function (event) {
            var button = event.target && event.target.closest ? event.target.closest("[data-leg-index]") : null;
            if (!button || !state.legs) return;
            var index = Number(button.getAttribute("data-leg-index"));
            if (!Number.isFinite(index) || index === state.legIndex) return;
            state.selectedSeatId = null;
            state.demoSeatId = null;
            loadLeg(doc, state, index);
          });
        }
        loadLeg(doc, state, requested);
      } else {
        setNotice(doc, "No readable flight in the last conversion — enter a flight below, or convert an itinerary first.", false);
      }
    }

    if (form) form.addEventListener("submit", function (event) {
      event.preventDefault();
      var input;
      var map;
      try {
        input = {
          flightNumber: doc.getElementById("seatmapFlightNumber").value,
          origin: doc.getElementById("seatmapOrigin").value,
          destination: doc.getElementById("seatmapDestination").value,
          date: doc.getElementById("seatmapDate").value,
          aircraftCode: doc.getElementById("seatmapAircraft").value,
          cabinCode: (doc.getElementById("seatmapManualCabin") || {}).value || ""
        };
        input.flightNumber = normalizeFlightNumber(input.flightNumber);
        input.origin = normalizeAirport(input.origin, "Origin");
        input.destination = normalizeAirport(input.destination, "Destination");
        input.date = normalizeDate(input.date);
        if (!input.aircraftCode) throw new TypeError("Choose an aircraft type to draw.");
        map = createDemoSeatMap(input, 0);
      } catch (error) {
        setNotice(doc, error.message, true);
        return;
      }
      state.legs = null;
      state.legIndex = 0;
      state.routeStoredAt = null;
      state.searched = null;
      input.manual = true;
      state.currentInput = input;
      prepareMap(state, map, false, input.cabinCode);
      if (demo) demo.classList.remove("hidden");
      if (searchButton) searchButton.textContent = "UPDATE SAMPLE MAP";
      var strip = doc.getElementById("seatmapFlightStrip");
      if (strip) strip.classList.add("hidden");
      var legsHolder = doc.getElementById("seatmapLegs");
      if (legsHolder) { legsHolder.classList.add("hidden"); legsHolder.innerHTML = ""; }
      setNotice(doc, "SAMPLE MAP GENERATED LOCALLY — NO AIRLINE INVENTORY REQUESTED", false);
      renderViewer(doc, state);
      if (demo) demo.scrollIntoView({ behavior: "smooth", block: "start" });
      if (state.timer) root.clearInterval(state.timer);
      state.nextRefreshAt = Date.now() + 30000;
      state.timer = root.setInterval(function () {
        if (Date.now() >= state.nextRefreshAt) refreshSample(doc, state);
        else updateCountdown(doc, state);
      }, 1000);
    });

    var canvas = doc.getElementById("seatmapCanvas");
    var svg = doc.getElementById("seatmapSvg");
    function updateTransform() {
      var plane = doc.getElementById("seatmapPlane");
      if (plane) plane.setAttribute("transform", "translate(" + state.panX.toFixed(1) + " " + state.panY.toFixed(1) + ") scale(" + state.zoom.toFixed(2) + ")");
    }
    function setZoom(next) {
      state.zoom = Math.max(0.55, Math.min(2.3, next));
      updateTransform();
      var label = doc.getElementById("seatmapZoomValue");
      if (label) label.textContent = Math.round(state.zoom * 100) + "%";
    }
    function filteredRender() {
      renderViewer(doc, state);
      updateTransform();
    }

    var zoomIn = doc.getElementById("seatmapZoomIn");
    var zoomOut = doc.getElementById("seatmapZoomOut");
    var zoomReset = doc.getElementById("seatmapZoomReset");
    if (zoomIn) zoomIn.addEventListener("click", function () { setZoom(state.zoom + 0.15); });
    if (zoomOut) zoomOut.addEventListener("click", function () { setZoom(state.zoom - 0.15); });
    if (zoomReset) zoomReset.addEventListener("click", function () { state.panX = 0; state.panY = 0; setZoom(1); });

    ["Main", "Upper"].forEach(function (name, index) {
      var button = doc.getElementById("seatmapDeck" + name);
      if (button) button.addEventListener("click", function () {
        if (!state.map || state.activeDeck === index || !state.map.decks.some(function (deck) { return deck.index === index; })) return;
        state.activeDeck = index;
        state.selectedSeatId = null;
        state.zoom = 1;
        state.panX = 0;
        state.panY = 0;
        state.drag = null;
        state.pointers.clear();
        if (canvas) { canvas.scrollTop = 0; canvas.scrollLeft = 0; }
        var tooltip = doc.getElementById("seatmapTooltip");
        if (tooltip) tooltip.classList.add("hidden");
        filteredRender();
      });
    });

    ["availableOnly", "windowOnly", "aisleOnly", "exitOnly"].forEach(function (filterName) {
      var control = doc.getElementById("seatmapFilter" + filterName.charAt(0).toUpperCase() + filterName.slice(1));
      if (control) control.addEventListener("change", function () {
        state.filters[filterName] = control.checked;
        filteredRender();
      });
    });
    var cabinFilter = doc.getElementById("seatmapFilterCabin");
    if (cabinFilter) cabinFilter.addEventListener("change", function () {
      state.filters.cabin = cabinFilter.value;
      filteredRender();
    });

    if (svg) {
      function findSeat(target) { return target && target.closest ? target.closest("[data-seat-id]") : null; }
      function chooseSeat(seatId) {
        var seat = state.seatsById[seatId];
        if (!seat || seat.deck !== state.activeDeck) return;
        if (state.map && state.map.airline && seat.outsideTicketedCabin && state.map.ticketedCabinLabel) {
          state.selectedSeatId = null;
          filteredRender();
          setNotice(doc, "Seat " + seat.id + " is in " + seat.cabin + ". This itinerary is ticketed in "
            + state.map.ticketedCabinLabel + " — pick a seat inside your own cabin.", true);
          return;
        }
        state.selectedSeatId = seatId;
        filteredRender();
      }
      svg.addEventListener("click", function (event) {
        var seatElement = findSeat(event.target);
        if (seatElement) chooseSeat(seatElement.getAttribute("data-seat-id"));
      });
      svg.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        var seatElement = findSeat(event.target);
        if (seatElement) {
          event.preventDefault();
          chooseSeat(seatElement.getAttribute("data-seat-id"));
        }
      });
      svg.addEventListener("pointerdown", function (event) {
        if (event.button !== 0 && event.pointerType === "mouse") return;
        var seatElement = findSeat(event.target);
        if (seatElement && state.pointers.size === 0) return;
        state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (svg.setPointerCapture) svg.setPointerCapture(event.pointerId);
        if (state.pointers.size === 1) {
          state.drag = { startX: event.clientX, startY: event.clientY, panX: state.panX, panY: state.panY, scale: state.zoom };
        } else if (state.pointers.size === 2) {
          var points = Array.from(state.pointers.values());
          state.drag = { pinchDistance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), scale: state.zoom, panX: state.panX, panY: state.panY };
        }
      });
      svg.addEventListener("pointermove", function (event) {
        if (state.pointers.has(event.pointerId)) {
          state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (state.pointers.size === 1 && state.drag && state.drag.startX != null) {
            var rect = svg.getBoundingClientRect();
            var unit = rect.width ? geometryUnit(state, rect.width) : 1;
            state.panX = state.drag.panX + (event.clientX - state.drag.startX) * unit;
            state.panY = state.drag.panY + (event.clientY - state.drag.startY) * unit;
            updateTransform();
          } else if (state.pointers.size === 2 && state.drag && state.drag.pinchDistance) {
            var points = Array.from(state.pointers.values());
            var distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            setZoom(state.drag.scale * (distance / state.drag.pinchDistance));
          }
        }
        var seatElement = findSeat(event.target);
        var tooltip = doc.getElementById("seatmapTooltip");
        if (seatElement && tooltip && state.seatsById[seatElement.getAttribute("data-seat-id")]) {
          var seat = state.seatsById[seatElement.getAttribute("data-seat-id")];
          tooltip.textContent = seatLabel(seat, state.map) + " · " + statusLabel(seat.status).toUpperCase() + " · " + seat.cabin.toUpperCase();
          tooltip.classList.remove("hidden");
          var box = canvas.getBoundingClientRect();
          tooltip.style.left = Math.max(8, event.clientX - box.left + 12) + "px";
          tooltip.style.top = Math.max(8, event.clientY - box.top + 12) + "px";
        } else if (tooltip) {
          tooltip.classList.add("hidden");
        }
      });
      function pointerEnd(event) {
        state.pointers.delete(event.pointerId);
        if (state.pointers.size === 1) {
          var point = Array.from(state.pointers.values())[0];
          state.drag = { startX: point.x, startY: point.y, panX: state.panX, panY: state.panY, scale: state.zoom };
        } else if (state.pointers.size === 0) state.drag = null;
      }
      svg.addEventListener("pointerup", pointerEnd);
      svg.addEventListener("pointercancel", pointerEnd);
      svg.addEventListener("pointerleave", function () {
        var tooltip = doc.getElementById("seatmapTooltip");
        if (tooltip) tooltip.classList.add("hidden");
      });
    }

    function geometryUnit(currentState, renderedWidth) {
      return currentState.geometry && renderedWidth ? currentState.geometry.width / renderedWidth : 1;
    }

    var action = doc.getElementById("seatmapDemoSelect");
    if (action) action.addEventListener("click", function () {
      var seat = state.seatsById[state.selectedSeatId];
      if (!seat || seat.deck !== state.activeDeck || seat.outsideTicketedCabin || !isSelectableStatus(seat.status)) return;
      state.demoSeatId = state.demoSeatId === seatKey(seat) ? null : seatKey(seat);
      renderViewer(doc, state);
      updateTransform();
    });

    var refreshButton = doc.getElementById("seatmapRefreshNow");
    if (refreshButton) refreshButton.addEventListener("click", function () { refreshSample(doc, state); });

    var exportAsciiButton = doc.getElementById("seatmapCopyAscii");
    if (exportAsciiButton) exportAsciiButton.addEventListener("click", function () {
      if (!state.map) return;
      copyText(exportAscii(state.map)).then(function () { setNotice(doc, "SAMPLE MAP COPIED — SIMULATED DATA", false); }, function () { setNotice(doc, "Clipboard unavailable; use an export button instead.", true); });
    });
    var exportJsonButton = doc.getElementById("seatmapDownloadJson");
    if (exportJsonButton) exportJsonButton.addEventListener("click", function () {
      if (state.map) downloadText(JSON.stringify(state.map, null, 2), "seatmap-demo.json", "application/json;charset=utf-8");
    });
    var exportCsvButton = doc.getElementById("seatmapDownloadCsv");
    if (exportCsvButton) exportCsvButton.addEventListener("click", function () {
      if (state.map) downloadText(exportCsv(state.map), "seatmap-demo.csv", "text/csv;charset=utf-8");
    });

    var summary = doc.getElementById("seatmapSummaryDialog");
    var summaryText = doc.getElementById("seatmapSummaryText");
    var summaryButton = doc.getElementById("seatmapShowSummary");
    var summaryClose = doc.getElementById("seatmapSummaryClose");
    function closeSummary() {
      if (summary) summary.classList.add("hidden");
      if (content) {
        content.removeAttribute("aria-hidden");
        if ("inert" in content) content.inert = false;
      }
      if (summaryButton) summaryButton.focus();
    }
    if (summaryButton) summaryButton.addEventListener("click", function () {
      if (!state.map || !summary || !summaryText) return;
      summaryText.textContent = exportSummary(state.map);
      if (content) {
        content.setAttribute("aria-hidden", "true");
        if ("inert" in content) content.inert = true;
      }
      summary.classList.remove("hidden");
      if (summaryClose) summaryClose.focus();
    });
    if (summaryClose) summaryClose.addEventListener("click", closeSummary);
    if (summary) {
      summary.addEventListener("click", function (event) {
        if (event.target === summary) closeSummary();
      });
      doc.addEventListener("keydown", function (event) {
        if (summary.classList.contains("hidden")) return;
        if (event.key === "Escape") {
          closeSummary();
          return;
        }
        if (event.key !== "Tab") return;
        var focusable = summary.querySelectorAll('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && (doc.activeElement === first || !summary.contains(doc.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (doc.activeElement === last || !summary.contains(doc.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      });
    }

    var backLink = doc.getElementById("seatmapBackLink");
    if (backLink) backLink.addEventListener("click", function () {
      if (state.timer) root.clearInterval(state.timer);
    });
  }

  if (root.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", function () { initializeSeatMapPage(root.document); }, { once: true });
    } else {
      initializeSeatMapPage(root.document);
    }
  }
})(typeof window !== "undefined" ? window : null);
