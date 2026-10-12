/* seatmap_layouts.js — aircraft cabin layouts for the SpicyTerminal seat map.
 *
 * WHY THIS FILE IS HONEST RATHER THAN "REAL"
 * ------------------------------------------
 * A seat map answers three different questions and they do not have the same
 * answer:
 *
 *   1. WHICH AIRCRAFT operates this flight?   The itinerary's own IATA type
 *      code when the reader found one; otherwise the converter's inference
 *      (spicy_engine.js inferAircraft: flight table -> route database ->
 *      route estimate). The seat map shows that provenance.
 *
 *   2. WHAT LAYOUT does that aircraft have?   Airlines configure the same
 *      type differently (a 737-800 flies 160 seats at one carrier and 189 at
 *      another), so the layout is only exact when it is the airline's own
 *      configuration. This file therefore has TWO tiers:
 *        - AIRLINE_LAYOUTS  : verified (airline + type), each entry carrying
 *                             the airline's own published map as its source.
 *                             Empty until an entry is verified — never
 *                             guessed.
 *        - TYPE_LAYOUTS     : a reference configuration for the aircraft type,
 *                             structurally realistic (real cabin cross-
 *                             sections, real exit zones, real premium
 *                             placement) but explicitly labelled in the UI as
 *                             NOT verified for the airline that is flying it.
 *
 *   3. WHICH SEATS are free right now?   Only a live airline/GDS seat-
 *      availability feed can answer that, and this app converts pasted
 *      itineraries without booking them, so it has no such feed. Availability
 *      stays SIMULATED and labelled as such.
 *
 * ADDING A VERIFIED AIRLINE CONFIGURATION (10 minutes)
 * ---------------------------------------------------
 *   1. Open the airline's own seat-map / fleet page for the type.
 *   2. Add an entry to AIRLINE_LAYOUTS:
 *        { airline:"AA", iataType:"738", configLabel:"737-800 · 172 seats",
 *          seatCount:172, sourceName:"American Airlines seat maps",
 *          sourceUrl:"https://...", verifiedOn:"2026-10-12",
 *          wingStartRow:.., wingEndRow:.., facilities:[...], cabins:[...] }
 *   3. Run `node test_seatmap_layouts.js` — the integrity suite checks row
 *      ranges, unique seats, exit rows inside the cabin, seatCount against the
 *      enumerated seats, and that every entry carries its provenance.
 * A verified entry then wins over the type reference automatically.
 */
(function (root) {
  "use strict";

  var LAYOUT_VERSION = "1";
  var LAYOUT_UPDATED = "2026-10-12";

  /* Seat letters follow the airline convention: "I" is never used, and the
   * wide-body lettering runs A B C / D E F G / H J K (10 abreast) exactly the
   * way the airlines print it. */
  var LETTERS = "ABCDEFGHJKLM";

  /** Build seat groups from abreast sizes, e.g. g(3, 3) -> [["A","B","C"],["D","E","F"]]. */
  function g() {
    var groups = [];
    var cursor = 0;
    for (var i = 0; i < arguments.length; i++) {
      var size = arguments[i];
      var group = [];
      for (var n = 0; n < size; n++) group.push(LETTERS.charAt(cursor++));
      groups.push(group);
    }
    return groups;
  }

  /** Build one cabin in the shape the seat-map renderer consumes. */
  function cab(code, name, from, to, groups, exitRows, pitch, width, features) {
    return {
      code: code,
      name: name,
      from: from,
      to: to,
      groups: groups,
      exitRows: exitRows || [],
      pitch: pitch,
      width: width,
      features: features || []
    };
  }

  /** Build one type-reference layout. */
  function lay(spec) {
    return {
      name: spec.name,
      iataCode: spec.iata || null,
      icaoCode: spec.icao,
      family: spec.family,
      manufacturer: spec.manufacturer,
      category: spec.category,
      seatCount: spec.seatCount,
      configLabel: spec.configLabel,
      wingStartRow: spec.wingStartRow,
      wingEndRow: spec.wingEndRow,
      facilities: spec.facilities || ["GALLEY", "LAVATORY", "EXIT"],
      cabins: spec.cabins
    };
  }

  /* ------------------------------------------------------------------ *
   * TIER 1 — verified airline configurations.
   * Every entry must be checked against the airline's own published map and
   * carry sourceName + sourceUrl + verifiedOn. This list ships EMPTY on
   * purpose: an unverified guess would be worse than an honest reference.
   * ------------------------------------------------------------------ */
  var AIRLINE_LAYOUTS = [];

  /* ------------------------------------------------------------------ *
   * TIER 2 — type reference layouts.
   * Structurally real (cross-section, aisle count, premium placement, exit
   * zones and door positions follow the type), labelled in the UI as a
   * reference rather than the airline's verified configuration.
   * ------------------------------------------------------------------ */
  var TYPE_LAYOUTS = {
    /* ---------------- narrowbody ---------------- */
    "738": lay({
      name: "Boeing 737-800", icao: "B738", family: "737", manufacturer: "Boeing", category: "narrowbody",
      seatCount: 160, configLabel: "two-class reference · 16 First / 144 Economy",
      wingStartRow: 14, wingEndRow: 22,
      cabins: [
        cab("first", "First", 1, 4, g(2, 2), [], 38, 21, ["RECLINE", "POWER"]),
        cab("economy", "Economy", 5, 28, g(3, 3), [15, 16], 31, 17, ["STANDARD LEGROOM"])
      ]
    }),
    "73G": lay({
      name: "Boeing 737-700", icao: "B737", family: "737", manufacturer: "Boeing", category: "narrowbody",
      seatCount: 132, configLabel: "two-class reference · 12 First / 120 Economy",
      wingStartRow: 11, wingEndRow: 18,
      cabins: [
        cab("first", "First", 1, 3, g(2, 2), [], 37, 21, ["RECLINE"]),
        cab("economy", "Economy", 4, 23, g(3, 3), [12, 13], 31, 17, ["STANDARD LEGROOM"])
      ]
    }),
    "739": lay({
      name: "Boeing 737-900ER", icao: "B739", family: "737", manufacturer: "Boeing", category: "narrowbody",
      seatCount: 176, configLabel: "two-class reference · 20 First / 156 Economy",
      wingStartRow: 17, wingEndRow: 25,
      cabins: [
        cab("first", "First", 1, 5, g(2, 2), [], 38, 21, ["RECLINE", "POWER"]),
        cab("economy", "Economy", 6, 31, g(3, 3), [18, 19], 31, 17, ["STANDARD LEGROOM"])
      ]
    }),
    "7M8": lay({
      name: "Boeing 737 MAX 8", icao: "B38M", family: "737 MAX", manufacturer: "Boeing", category: "narrowbody",
      seatCount: 172, configLabel: "two-class reference · 16 First / 156 Economy",
      wingStartRow: 15, wingEndRow: 23,
      cabins: [
        cab("first", "First", 1, 4, g(2, 2), [], 38, 21, ["RECLINE", "POWER"]),
        cab("economy", "Economy", 5, 30, g(3, 3), [16, 17], 31, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "320": lay({
      name: "Airbus A320", icao: "A320", family: "A320", manufacturer: "Airbus", category: "narrowbody",
      seatCount: 162, configLabel: "two-class reference · 12 Business / 150 Economy",
      wingStartRow: 12, wingEndRow: 19,
      cabins: [
        cab("business", "Business", 1, 3, g(2, 2), [], 37, 20, ["RECLINE", "POWER"]),
        cab("economy", "Economy", 4, 28, g(3, 3), [14, 15], 30, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "319": lay({
      name: "Airbus A319", icao: "A319", family: "A320", manufacturer: "Airbus", category: "narrowbody",
      seatCount: 138, configLabel: "two-class reference · 12 Business / 126 Economy",
      wingStartRow: 11, wingEndRow: 17,
      cabins: [
        cab("business", "Business", 1, 3, g(2, 2), [], 37, 20, ["RECLINE"]),
        cab("economy", "Economy", 4, 24, g(3, 3), [12, 13], 30, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "32N": lay({
      name: "Airbus A320neo", icao: "A20N", family: "A320neo", manufacturer: "Airbus", category: "narrowbody",
      seatCount: 168, configLabel: "two-class reference · 12 Business / 156 Economy",
      wingStartRow: 12, wingEndRow: 19,
      cabins: [
        cab("business", "Business", 1, 3, g(2, 2), [], 37, 20, ["RECLINE", "POWER"]),
        cab("economy", "Economy", 4, 29, g(3, 3), [15, 16], 30, 18, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "321": lay({
      name: "Airbus A321", icao: "A321", family: "A320", manufacturer: "Airbus", category: "narrowbody",
      seatCount: 196, configLabel: "two-class reference · 16 Business / 180 Economy",
      wingStartRow: 14, wingEndRow: 22,
      cabins: [
        cab("business", "Business", 1, 4, g(2, 2), [], 37, 20, ["RECLINE", "POWER"]),
        cab("economy", "Economy", 5, 34, g(3, 3), [15, 16], 30, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "32Q": lay({
      name: "Airbus A321neo", icao: "A21N", family: "A320neo", manufacturer: "Airbus", category: "narrowbody",
      seatCount: 202, configLabel: "two-class reference · 16 Business / 186 Economy",
      wingStartRow: 15, wingEndRow: 23,
      cabins: [
        cab("business", "Business", 1, 4, g(2, 2), [], 37, 20, ["RECLINE", "POWER"]),
        cab("economy", "Economy", 5, 35, g(3, 3), [16, 17], 30, 18, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "223": lay({
      name: "Airbus A220-300", icao: "BCS3", family: "A220", manufacturer: "Airbus", category: "narrowbody",
      seatCount: 147, configLabel: "two-class reference · 12 Business / 135 Economy (2-3)",
      wingStartRow: 13, wingEndRow: 20,
      cabins: [
        cab("business", "Business", 1, 3, g(2, 2), [], 36, 20, ["RECLINE"]),
        cab("economy", "Economy", 4, 30, g(3, 2), [15, 16], 32, 18, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "221": lay({
      name: "Airbus A220-100", icao: "BCS1", family: "A220", manufacturer: "Airbus", category: "narrowbody",
      seatCount: 110, configLabel: "single-class reference · 110 Economy (2-3)",
      wingStartRow: 10, wingEndRow: 16,
      cabins: [
        cab("economy", "Economy", 1, 22, g(3, 2), [10, 11], 32, 18, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "752": lay({
      name: "Boeing 757-200", icao: "B752", family: "757", manufacturer: "Boeing", category: "narrowbody",
      seatCount: 202, configLabel: "two-class reference · 16 First / 186 Economy",
      wingStartRow: 15, wingEndRow: 24,
      cabins: [
        cab("first", "First", 1, 4, g(2, 2), [], 39, 21, ["RECLINE", "POWER"]),
        cab("economy", "Economy", 5, 35, g(3, 3), [16, 17], 32, 17, ["STANDARD LEGROOM"])
      ]
    }),
    "753": lay({
      name: "Boeing 757-300", icao: "B753", family: "757", manufacturer: "Boeing", category: "narrowbody",
      seatCount: 240, configLabel: "single-class reference · 240 Economy",
      wingStartRow: 17, wingEndRow: 27,
      cabins: [
        cab("economy", "Economy", 1, 40, g(3, 3), [17, 18, 29], 32, 17, ["STANDARD LEGROOM"])
      ]
    }),
    "717": lay({
      name: "Boeing 717-200", icao: "B712", family: "717", manufacturer: "Boeing", category: "narrowbody",
      seatCount: 110, configLabel: "single-class reference · 110 Economy (2-3)",
      wingStartRow: 11, wingEndRow: 17,
      cabins: [
        cab("economy", "Economy", 1, 22, g(3, 2), [11, 12], 31, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "146": lay({
      name: "BAe 146 / Avro RJ", icao: "B461", family: "BAe 146", manufacturer: "British Aerospace", category: "narrowbody",
      seatCount: 102, configLabel: "single-class reference · 102 Economy (3-3)",
      wingStartRow: 8, wingEndRow: 14,
      cabins: [
        cab("economy", "Economy", 1, 17, g(3, 3), [8, 9], 31, 17, ["STANDARD LEGROOM"])
      ]
    }),
    "919": lay({
      name: "COMAC C919", icao: "C919", family: "C919", manufacturer: "COMAC", category: "narrowbody",
      seatCount: 168, configLabel: "two-class reference · 12 Business / 156 Economy",
      wingStartRow: 13, wingEndRow: 20,
      cabins: [
        cab("business", "Business", 1, 3, g(2, 2), [], 36, 20, ["RECLINE"]),
        cab("economy", "Economy", 4, 29, g(3, 3), [15, 16], 31, 18, ["STANDARD LEGROOM"])
      ]
    }),

    /* ---------------- widebody ---------------- */
    "763": lay({
      name: "Boeing 767-300ER", icao: "B763", family: "767", manufacturer: "Boeing", category: "widebody",
      seatCount: 195, configLabel: "two-class reference · 20 Business / 175 Economy (2-3-2)",
      wingStartRow: 13, wingEndRow: 21,
      cabins: [
        cab("business", "Business", 1, 5, g(1, 2, 1), [], 42, 20, ["LIE-FLAT", "POWER"]),
        cab("economy", "Economy", 6, 30, g(2, 3, 2), [16, 17], 32, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "764": lay({
      name: "Boeing 767-400ER", icao: "B764", family: "767", manufacturer: "Boeing", category: "widebody",
      seatCount: 245, configLabel: "two-class reference · 28 Business / 217 Economy (2-3-2)",
      wingStartRow: 14, wingEndRow: 23,
      cabins: [
        cab("business", "Business", 1, 7, g(1, 2, 1), [], 42, 20, ["LIE-FLAT", "POWER"]),
        cab("economy", "Economy", 8, 38, g(2, 3, 2), [19, 20], 32, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "772": lay({
      name: "Boeing 777-200ER", icao: "B772", family: "777", manufacturer: "Boeing", category: "widebody",
      seatCount: 320, configLabel: "two-class reference · 32 Business / 288 Economy (3-3-3)",
      wingStartRow: 17, wingEndRow: 27,
      cabins: [
        cab("business", "Business", 1, 8, g(1, 2, 1), [], 44, 21, ["LIE-FLAT", "POWER"]),
        cab("economy", "Economy", 9, 40, g(3, 3, 3), [19, 20], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "773": lay({
      name: "Boeing 777-300", icao: "B773", family: "777", manufacturer: "Boeing", category: "widebody",
      seatCount: 384, configLabel: "two-class reference · 42 Business / 342 Economy (3-3-3)",
      wingStartRow: 20, wingEndRow: 31,
      cabins: [
        cab("business", "Business", 1, 6, g(2, 3, 2), [], 44, 21, ["LIE-FLAT", "POWER"]),
        cab("economy", "Economy", 7, 44, g(3, 3, 3), [21, 22], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "77W": lay({
      name: "Boeing 777-300ER", icao: "B77W", family: "777", manufacturer: "Boeing", category: "widebody",
      seatCount: 390, configLabel: "three-class reference · 8 First / 42 Business / 340 Economy (3-3-3)",
      wingStartRow: 22, wingEndRow: 34,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 79, 23, ["LIE-FLAT", "SUITE", "POWER"]),
        cab("business", "Business", 3, 8, g(2, 3, 2), [], 44, 22, ["LIE-FLAT", "POWER"]),
        cab("economy", "Economy", 9, 42, g(3, 4, 3), [24, 25], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "77L": lay({
      name: "Boeing 777-200LR", icao: "B77L", family: "777", manufacturer: "Boeing", category: "widebody",
      seatCount: 326, configLabel: "two-class reference · 36 Business / 290 Economy (3-4-3)",
      wingStartRow: 17, wingEndRow: 27,
      cabins: [
        cab("business", "Business", 1, 9, g(1, 2, 1), [], 44, 21, ["LIE-FLAT", "POWER"]),
        cab("economy", "Economy", 10, 38, g(3, 4, 3), [20, 21], 32, 17, ["STANDARD LEGROOM"])
      ]
    }),
    "788": lay({
      name: "Boeing 787-8", icao: "B788", family: "787", manufacturer: "Boeing", category: "widebody",
      seatCount: 249, configLabel: "two-class reference · 24 Business / 225 Economy (3-3-3)",
      wingStartRow: 14, wingEndRow: 23,
      cabins: [
        cab("business", "Business", 1, 6, g(1, 2, 1), [], 46, 21, ["LIE-FLAT", "POWER"]),
        cab("economy", "Economy", 7, 31, g(3, 3, 3), [17, 18], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "789": lay({
      name: "Boeing 787-9", icao: "B789", family: "787", manufacturer: "Boeing", category: "widebody",
      seatCount: 302, configLabel: "two-class reference · 32 Business / 270 Economy (3-3-3)",
      wingStartRow: 16, wingEndRow: 26,
      cabins: [
        cab("business", "Business", 1, 8, g(1, 2, 1), [], 46, 21, ["LIE-FLAT", "POWER"]),
        cab("economy", "Economy", 9, 38, g(3, 3, 3), [20, 21], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "781": lay({
      name: "Boeing 787-10", icao: "B78X", family: "787", manufacturer: "Boeing", category: "widebody",
      seatCount: 338, configLabel: "two-class reference · 32 Business / 306 Economy (3-3-3)",
      wingStartRow: 17, wingEndRow: 27,
      cabins: [
        cab("business", "Business", 1, 8, g(1, 2, 1), [], 46, 21, ["LIE-FLAT", "POWER"]),
        cab("economy", "Economy", 9, 42, g(3, 3, 3), [22, 23], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "332": lay({
      name: "Airbus A330-200", icao: "A332", family: "A330", manufacturer: "Airbus", category: "widebody",
      seatCount: 253, configLabel: "two-class reference · 28 Business / 225 Economy (3-3-3)",
      wingStartRow: 14, wingEndRow: 22,
      cabins: [
        cab("business", "Business", 1, 7, g(1, 2, 1), [], 44, 21, ["LIE-FLAT", "POWER"]),
        cab("economy", "Economy", 8, 32, g(3, 3, 3), [16, 17], 32, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "333": lay({
      name: "Airbus A330-300", icao: "A333", family: "A330", manufacturer: "Airbus", category: "widebody",
      seatCount: 284, configLabel: "two-class reference · 32 Business / 252 Economy (3-3-3)",
      wingStartRow: 15, wingEndRow: 23,
      cabins: [
        cab("business", "Business", 1, 8, g(1, 2, 1), [], 44, 21, ["LIE-FLAT", "POWER"]),
        cab("economy", "Economy", 9, 36, g(3, 3, 3), [18, 19], 32, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "339": lay({
      name: "Airbus A330-900neo", icao: "A339", family: "A330neo", manufacturer: "Airbus", category: "widebody",
      seatCount: 302, configLabel: "two-class reference · 32 Business / 270 Economy (3-3-3)",
      wingStartRow: 16, wingEndRow: 24,
      cabins: [
        cab("business", "Business", 1, 8, g(1, 2, 1), [], 44, 21, ["LIE-FLAT", "POWER"]),
        cab("economy", "Economy", 9, 38, g(3, 3, 3), [19, 20], 32, 18, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "359": lay({
      name: "Airbus A350-900", icao: "A359", family: "A350", manufacturer: "Airbus", category: "widebody",
      seatCount: 328, configLabel: "two-class reference · 40 Business / 288 Economy (3-3-3)",
      wingStartRow: 17, wingEndRow: 27,
      cabins: [
        cab("business", "Business", 1, 10, g(1, 2, 1), [], 46, 21, ["LIE-FLAT", "POWER"]),
        cab("economy", "Economy", 11, 42, g(3, 3, 3), [23, 24], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "351": lay({
      name: "Airbus A350-1000", icao: "A35K", family: "A350", manufacturer: "Airbus", category: "widebody",
      seatCount: 350, configLabel: "two-class reference · 44 Business / 306 Economy (3-3-3)",
      wingStartRow: 18, wingEndRow: 28,
      cabins: [
        cab("business", "Business", 1, 11, g(1, 2, 1), [], 46, 21, ["LIE-FLAT", "POWER"]),
        cab("economy", "Economy", 12, 45, g(3, 3, 3), [25, 26], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "744": lay({
      name: "Boeing 747-400", icao: "B744", family: "747", manufacturer: "Boeing", category: "widebody",
      seatCount: 354, configLabel: "three-class reference · 8 First / 36 Business / 20 Premium Economy / 290 Economy (two decks, shown nose to tail)",
      wingStartRow: 21, wingEndRow: 33,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 79, 22, ["LIE-FLAT", "POWER"]),
        cab("business", "Business", 3, 8, g(2, 2, 2), [], 45, 21, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy · Upper Deck", 9, 13, g(2, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy · Main Deck", 20, 48, g(3, 4, 3), [34, 35], 32, 17, ["STANDARD LEGROOM"])
      ]
    }),
    "748": lay({
      name: "Boeing 747-8I", icao: "B748", family: "747", manufacturer: "Boeing", category: "widebody",
      seatCount: 370, configLabel: "three-class reference · 8 First / 42 Business / 20 Premium Economy / 300 Economy (two decks, shown nose to tail)",
      wingStartRow: 22, wingEndRow: 34,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 79, 22, ["LIE-FLAT", "POWER"]),
        cab("business", "Business", 3, 9, g(2, 2, 2), [], 45, 21, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy · Upper Deck", 10, 14, g(2, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy · Main Deck", 21, 50, g(3, 4, 3), [36, 37], 32, 17, ["STANDARD LEGROOM"])
      ]
    }),
    "388": lay({
      name: "Airbus A380-800", icao: "A388", family: "A380", manufacturer: "Airbus", category: "superjumbo",
      seatCount: 488, configLabel: "three-class reference · 16 First / 60 Business / 42 Premium Economy / 370 Economy (two decks, shown nose to tail)",
      wingStartRow: 26, wingEndRow: 44,
      cabins: [
        cab("first", "First · Main Deck", 1, 4, g(1, 2, 1), [], 81, 23, ["LIE-FLAT", "SUITE", "POWER"]),
        cab("business", "Business · Upper Deck", 5, 19, g(1, 2, 1), [], 48, 22, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy · Main Deck", 20, 25, g(2, 3, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy · Main Deck", 26, 62, g(3, 4, 3), [43, 44], 32, 18, ["STANDARD LEGROOM"])
      ]
    }),

    /* ---------------- regional / turboprop ---------------- */
    "E75": lay({
      name: "Embraer E175", icao: "E75L", family: "E-Jet", manufacturer: "Embraer", category: "regional_jet",
      seatCount: 76, configLabel: "two-class reference · 12 First / 64 Economy (2-2)",
      wingStartRow: 9, wingEndRow: 14,
      cabins: [
        cab("first", "First", 1, 4, g(1, 2), [], 37, 20, ["RECLINE"]),
        cab("economy", "Economy", 5, 20, g(2, 2), [11, 12], 32, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "E90": lay({
      name: "Embraer E190", icao: "E190", family: "E-Jet", manufacturer: "Embraer", category: "regional_jet",
      seatCount: 100, configLabel: "single-class reference · 100 Economy (2-2)",
      wingStartRow: 10, wingEndRow: 16,
      cabins: [
        cab("economy", "Economy", 1, 25, g(2, 2), [11, 12], 32, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "E70": lay({
      name: "Embraer E170", icao: "E170", family: "E-Jet", manufacturer: "Embraer", category: "regional_jet",
      seatCount: 78, configLabel: "two-class reference · 6 First / 72 Economy (2-2)",
      wingStartRow: 9, wingEndRow: 14,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2), [], 37, 20, ["RECLINE"]),
        cab("economy", "Economy", 4, 21, g(2, 2), [11, 12], 32, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "ER4": lay({
      name: "Embraer ERJ-145", icao: "E145", family: "ERJ", manufacturer: "Embraer", category: "regional_jet",
      seatCount: 51, configLabel: "single-class reference · 51 Economy (1-2)",
      wingStartRow: 8, wingEndRow: 13,
      cabins: [
        cab("economy", "Economy", 1, 17, g(1, 2), [9, 10], 31, 17, ["STANDARD LEGROOM"])
      ]
    }),
    "CR9": lay({
      name: "Bombardier CRJ-900", icao: "CRJ9", family: "CRJ", manufacturer: "Bombardier", category: "regional_jet",
      seatCount: 77, configLabel: "two-class reference · 9 First / 68 Economy (2-2)",
      wingStartRow: 10, wingEndRow: 16,
      cabins: [
        cab("first", "First", 1, 3, g(1, 2), [], 37, 19, ["RECLINE"]),
        cab("economy", "Economy", 4, 20, g(2, 2), [12, 13], 31, 17, ["STANDARD LEGROOM"])
      ]
    }),
    "CRA": lay({
      name: "Bombardier CRJ-1000", icao: "CRJX", family: "CRJ", manufacturer: "Bombardier", category: "regional_jet",
      seatCount: 100, configLabel: "single-class reference · 100 Economy (2-2)",
      wingStartRow: 11, wingEndRow: 17,
      cabins: [
        cab("economy", "Economy", 1, 25, g(2, 2), [12, 13], 31, 17, ["STANDARD LEGROOM"])
      ]
    }),
    "SU9": lay({
      name: "Sukhoi Superjet 100", icao: "SU95", family: "Superjet", manufacturer: "UAC", category: "regional_jet",
      seatCount: 90, configLabel: "single-class reference · 90 Economy (2-3)",
      wingStartRow: 10, wingEndRow: 16,
      cabins: [
        cab("economy", "Economy", 1, 18, g(3, 2), [11, 12], 32, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "AT7": lay({
      name: "ATR 72", icao: "AT76", family: "ATR", manufacturer: "ATR", category: "turboprop",
      seatCount: 72, configLabel: "single-class reference · 72 Economy (2-2)",
      wingStartRow: 8, wingEndRow: 13,
      cabins: [
        cab("economy", "Economy", 1, 18, g(2, 2), [], 30, 17, ["STANDARD LEGROOM"])
      ]
    }),
    "DH4": lay({
      name: "De Havilland Dash 8-400", icao: "DH8D", family: "Dash 8", manufacturer: "De Havilland", category: "turboprop",
      seatCount: 80, configLabel: "single-class reference · 80 Economy (2-2)",
      wingStartRow: 9, wingEndRow: 14,
      cabins: [
        cab("economy", "Economy", 1, 20, g(2, 2), [10, 11], 31, 17, ["STANDARD LEGROOM"])
      ]
    })
  };

  /* ------------------------------------------------------------------ *
   * TIER 2b — four-class reference variants.
   *
   * One reference layout per type cannot be right for every airline: the same
   * 787-9 flies two cabins at one carrier and four at another, and an A350
   * that is all Business and Economy at one operator has a First cabin at the
   * next. Drawing "no First cabin" for a First ticket would be a lie of
   * omission, so each wide body that is also operated with a First and a
   * Premium Economy cabin carries that configuration here as a VARIANT.
   *
   * A variant is used only when the cabin being asked for is missing from the
   * type's default layout, it keeps the same (reference) tier, and the page
   * says it switched. Nothing here is claimed as any airline's own
   * configuration — that is still what AIRLINE_LAYOUTS is for.
   * ------------------------------------------------------------------ */
  var TYPE_LAYOUT_VARIANTS = {
    "763": lay({
      name: "Boeing 767-300ER", icao: "B763", family: "767", manufacturer: "Boeing", category: "widebody",
      seatCount: 192, configLabel: "four-class reference · 8 First / 16 Business / 28 Premium Economy / 140 Economy (2-3-2)",
      wingStartRow: 13, wingEndRow: 21,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 62, 21, ["LIE-FLAT", "POWER"]),
        cab("business", "Business", 3, 6, g(1, 2, 1), [], 42, 20, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy", 7, 10, g(2, 3, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy", 11, 30, g(2, 3, 2), [16, 17], 32, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "764": lay({
      name: "Boeing 767-400ER", icao: "B764", family: "767", manufacturer: "Boeing", category: "widebody",
      seatCount: 242, configLabel: "four-class reference · 8 First / 24 Business / 35 Premium Economy / 175 Economy (2-3-2)",
      wingStartRow: 14, wingEndRow: 23,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 62, 21, ["LIE-FLAT", "POWER"]),
        cab("business", "Business", 3, 8, g(1, 2, 1), [], 42, 20, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy", 9, 13, g(2, 3, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy", 14, 38, g(2, 3, 2), [19, 20], 32, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "772": lay({
      name: "Boeing 777-200ER", icao: "B772", family: "777", manufacturer: "Boeing", category: "widebody",
      seatCount: 305, configLabel: "four-class reference · 8 First / 32 Business / 40 Premium Economy / 225 Economy (3-3-3)",
      wingStartRow: 17, wingEndRow: 27,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 79, 23, ["LIE-FLAT", "SUITE", "POWER"]),
        cab("business", "Business", 3, 10, g(1, 2, 1), [], 44, 21, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy", 11, 15, g(2, 4, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy", 16, 40, g(3, 3, 3), [19, 20], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "773": lay({
      name: "Boeing 777-300", icao: "B773", family: "777", manufacturer: "Boeing", category: "widebody",
      seatCount: 368, configLabel: "four-class reference · 8 First / 42 Business / 48 Premium Economy / 270 Economy (3-3-3)",
      wingStartRow: 20, wingEndRow: 31,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 79, 23, ["LIE-FLAT", "SUITE", "POWER"]),
        cab("business", "Business", 3, 8, g(2, 3, 2), [], 44, 21, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy", 9, 14, g(2, 4, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy", 15, 44, g(3, 3, 3), [21, 22], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "77W": lay({
      name: "Boeing 777-300ER", icao: "B77W", family: "777", manufacturer: "Boeing", category: "widebody",
      seatCount: 344, configLabel: "four-class reference · 8 First / 36 Business / 40 Premium Economy / 260 Economy (3-4-3)",
      wingStartRow: 22, wingEndRow: 34,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 79, 23, ["LIE-FLAT", "SUITE", "POWER"]),
        cab("business", "Business", 3, 11, g(1, 2, 1), [], 44, 22, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy", 12, 16, g(2, 4, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy", 17, 42, g(3, 4, 3), [24, 25], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "77L": lay({
      name: "Boeing 777-200LR", icao: "B77L", family: "777", manufacturer: "Boeing", category: "widebody",
      seatCount: 310, configLabel: "four-class reference · 8 First / 32 Business / 40 Premium Economy / 230 Economy (3-4-3)",
      wingStartRow: 17, wingEndRow: 27,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 79, 23, ["LIE-FLAT", "SUITE", "POWER"]),
        cab("business", "Business", 3, 10, g(1, 2, 1), [], 44, 21, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy", 11, 15, g(2, 4, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy", 16, 38, g(3, 4, 3), [20, 21], 32, 17, ["STANDARD LEGROOM"])
      ]
    }),
    "788": lay({
      name: "Boeing 787-8", icao: "B788", family: "787", manufacturer: "Boeing", category: "widebody",
      seatCount: 229, configLabel: "four-class reference · 8 First / 24 Business / 35 Premium Economy / 162 Economy (3-3-3)",
      wingStartRow: 14, wingEndRow: 23,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 76, 22, ["LIE-FLAT", "SUITE", "POWER"]),
        cab("business", "Business", 3, 8, g(1, 2, 1), [], 46, 21, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy", 9, 13, g(2, 3, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy", 14, 31, g(3, 3, 3), [17, 18], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "789": lay({
      name: "Boeing 787-9", icao: "B789", family: "787", manufacturer: "Boeing", category: "widebody",
      seatCount: 280, configLabel: "four-class reference · 8 First / 32 Business / 42 Premium Economy / 198 Economy (3-3-3)",
      wingStartRow: 16, wingEndRow: 26,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 76, 22, ["LIE-FLAT", "SUITE", "POWER"]),
        cab("business", "Business", 3, 10, g(1, 2, 1), [], 46, 21, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy", 11, 16, g(2, 3, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy", 17, 38, g(3, 3, 3), [20, 21], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "781": lay({
      name: "Boeing 787-10", icao: "B78X", family: "787", manufacturer: "Boeing", category: "widebody",
      seatCount: 316, configLabel: "four-class reference · 8 First / 32 Business / 42 Premium Economy / 234 Economy (3-3-3)",
      wingStartRow: 17, wingEndRow: 27,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 76, 22, ["LIE-FLAT", "SUITE", "POWER"]),
        cab("business", "Business", 3, 10, g(1, 2, 1), [], 46, 21, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy", 11, 16, g(2, 3, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy", 17, 42, g(3, 3, 3), [22, 23], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "332": lay({
      name: "Airbus A330-200", icao: "A332", family: "A330", manufacturer: "Airbus", category: "widebody",
      seatCount: 233, configLabel: "four-class reference · 8 First / 28 Business / 35 Premium Economy / 162 Economy (2-4-2 / 3-3-3)",
      wingStartRow: 14, wingEndRow: 22,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 76, 22, ["LIE-FLAT", "POWER"]),
        cab("business", "Business", 3, 9, g(1, 2, 1), [], 44, 21, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy", 10, 14, g(2, 3, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy", 15, 32, g(3, 3, 3), [16, 17], 32, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "333": lay({
      name: "Airbus A330-300", icao: "A333", family: "A330", manufacturer: "Airbus", category: "widebody",
      seatCount: 262, configLabel: "four-class reference · 8 First / 32 Business / 42 Premium Economy / 180 Economy (2-3-2 / 3-3-3)",
      wingStartRow: 15, wingEndRow: 23,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 76, 22, ["LIE-FLAT", "POWER"]),
        cab("business", "Business", 3, 10, g(1, 2, 1), [], 44, 21, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy", 11, 16, g(2, 3, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy", 17, 36, g(3, 3, 3), [18, 19], 32, 18, ["STANDARD LEGROOM"])
      ]
    }),
    "339": lay({
      name: "Airbus A330-900neo", icao: "A339", family: "A330neo", manufacturer: "Airbus", category: "widebody",
      seatCount: 280, configLabel: "four-class reference · 8 First / 32 Business / 42 Premium Economy / 198 Economy (2-3-2 / 3-3-3)",
      wingStartRow: 16, wingEndRow: 24,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 76, 22, ["LIE-FLAT", "SUITE", "POWER"]),
        cab("business", "Business", 3, 10, g(1, 2, 1), [], 44, 21, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy", 11, 16, g(2, 3, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy", 17, 38, g(3, 3, 3), [19, 20], 32, 18, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "359": lay({
      name: "Airbus A350-900", icao: "A359", family: "A350", manufacturer: "Airbus", category: "widebody",
      seatCount: 312, configLabel: "four-class reference · 8 First / 40 Business / 48 Premium Economy / 216 Economy (3-3-3)",
      wingStartRow: 17, wingEndRow: 27,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 79, 23, ["LIE-FLAT", "SUITE", "POWER"]),
        cab("business", "Business", 3, 12, g(1, 2, 1), [], 46, 21, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy", 13, 18, g(2, 4, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy", 19, 42, g(3, 3, 3), [23, 24], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    }),
    "351": lay({
      name: "Airbus A350-1000", icao: "A35K", family: "A350", manufacturer: "Airbus", category: "widebody",
      seatCount: 334, configLabel: "four-class reference · 8 First / 44 Business / 48 Premium Economy / 234 Economy (3-3-3)",
      wingStartRow: 18, wingEndRow: 28,
      cabins: [
        cab("first", "First", 1, 2, g(1, 2, 1), [], 79, 23, ["LIE-FLAT", "SUITE", "POWER"]),
        cab("business", "Business", 3, 13, g(1, 2, 1), [], 46, 21, ["LIE-FLAT", "POWER"]),
        cab("premium_economy", "Premium Economy", 14, 19, g(2, 4, 2), [], 38, 19, ["EXTRA LEGROOM"]),
        cab("economy", "Economy", 20, 45, g(3, 3, 3), [25, 26], 32, 17, ["STANDARD LEGROOM", "POWER"])
      ]
    })
  };

  var CABIN_NAMES = { first: "First", business: "Business", premium_economy: "Premium Economy", economy: "Economy" };

  /* Fallback shapes for types this file has no reference for. These describe
   * only the fuselage cross-section the type category really has — nothing
   * about rows, pitch or cabins, which are the airline's choice. */
  var CATEGORY_FAMILIES = {
    narrowbody: { groups: g(3, 3), rows: 28, pitch: 31, width: 17 },
    widebody: { groups: g(3, 3, 3), rows: 34, pitch: 32, width: 17 },
    superjumbo: { groups: g(3, 4, 3), rows: 40, pitch: 32, width: 18 },
    regional_jet: { groups: g(2, 2), rows: 20, pitch: 31, width: 17 },
    turboprop: { groups: g(2, 2), rows: 18, pitch: 30, width: 17 },
    freighter: null
  };

  var TIERS = {
    AIRLINE_VERIFIED: "airline_verified",
    TYPE_REFERENCE: "type_reference",
    CATEGORY_GENERIC: "category_generic",
    NO_PASSENGER_CABIN: "no_passenger_cabin",
    UNKNOWN_TYPE: "unknown_type"
  };

  var TIER_LABELS = {
    airline_verified: "VERIFIED AIRLINE CONFIGURATION",
    type_reference: "REFERENCE LAYOUT FOR THIS AIRCRAFT TYPE — NOT VERIFIED FOR THIS AIRLINE",
    category_generic: "GENERIC CABIN SHAPE — NO VERIFIED LAYOUT FOR THIS TYPE",
    no_passenger_cabin: "NO PASSENGER CABIN — FREIGHTER",
    unknown_type: "UNKNOWN AIRCRAFT TYPE — NO LAYOUT"
  };

  function normalizeType(code) {
    return String(code == null ? "" : code).trim().toUpperCase();
  }

  /** Does this layout contain the cabin code? */
  function hasCabin(layout, code) {
    return (layout && layout.cabins || []).some(function (cabin) { return cabin.code === code; });
  }

  /** The four-class variant of a type, when it offers a cabin the type's
   *  default reference layout does not have. */
  function pickVariant(typeCode, code) {
    var variant = TYPE_LAYOUT_VARIANTS[normalizeType(typeCode)];
    return variant && hasCabin(variant, code) ? variant : null;
  }

  function normalizeAirline(code) {
    return String(code == null ? "" : code).trim().toUpperCase();
  }

  function typeMeta(typeCode, types) {
    var map = types || (root && root.SPICY_DATA && root.SPICY_DATA.aircraftTypes) || null;
    var key = normalizeType(typeCode);
    if (!map) return null;
    var entry = map[key];
    if (!entry || !entry.length) return null;
    return { code: key, icao: entry[0], name: entry[1], family: entry[2], manufacturer: entry[3], category: entry[4], rangeNm: entry[5] };
  }

  /** Build the generic cross-section-only layout for a type category. */
  function buildGenericLayout(typeCode, meta) {
    var category = (meta && meta.category) || "narrowbody";
    var family = CATEGORY_FAMILIES[category];
    if (!family) return null;
    return lay({
      name: (meta && meta.name) || typeCode,
      icao: (meta && meta.icao) || null,
      family: (meta && meta.family) || category,
      manufacturer: (meta && meta.manufacturer) || null,
      category: category,
      seatCount: family.rows * family.groups.reduce(function (sum, group) { return sum + group.length; }, 0),
      configLabel: "no layout on file for " + typeCode + " — generic " + category.replace(/_/g, " ") + " cabin shape only",
      wingStartRow: Math.max(1, Math.round(family.rows / 2)),
      wingEndRow: Math.max(2, Math.round(family.rows / 2) + 6),
      facilities: ["GALLEY", "LAVATORY", "EXIT"],
      cabins: [cab("economy", "Economy (generic shape)", 1, family.rows, family.groups, [], family.pitch, family.width, ["GENERIC CABIN SHAPE"])]
    });
  }

  /**
   * Resolve the layout for a flight.
   * @param {string} airline   two-letter marketing carrier (may be "")
   * @param {string} typeCode  IATA aircraft type code from the itinerary
   * @param {object} [types]   aircraftTypes table (defaults to SPICY_DATA)
   * @param {object} [options] { cabin:"first" } asks for the configuration of
   *                           this type that carries that cabin, when the
   *                           default reference layout does not
   * @returns {{tier:string,label:string,layout:?object,meta:?object,sourceName:?string,sourceUrl:?string,verifiedOn:?string,reason:?string,variantFor:?string,variantNote:?string}}
   */
  function resolveLayout(airline, typeCode, types, options) {
    var carrier = normalizeAirline(airline);
    var key = normalizeType(typeCode);
    var meta = typeMeta(key, types);

    for (var i = 0; i < AIRLINE_LAYOUTS.length; i++) {
      var entry = AIRLINE_LAYOUTS[i];
      if (normalizeAirline(entry.airline) === carrier && normalizeType(entry.iataType) === key) {
        return {
          tier: TIERS.AIRLINE_VERIFIED,
          label: TIER_LABELS.airline_verified,
          layout: entry,
          meta: meta,
          sourceName: entry.sourceName,
          sourceUrl: entry.sourceUrl,
          verifiedOn: entry.verifiedOn
        };
      }
    }

    if (TYPE_LAYOUTS[key]) {
      var layout = TYPE_LAYOUTS[key];
      var wanted = options && options.cabin ? String(options.cabin) : null;
      /* A cabin the default reference does not have is not the same as a cabin
         the aircraft does not have: the same type flies four cabins at another
         operator, so the variant that has it is shown instead — same tier, and
         the switch is reported instead of being hidden. */
      if (wanted && !hasCabin(layout, wanted)) {
        var variant = pickVariant(key, wanted);
        if (variant) {
          return {
            tier: TIERS.TYPE_REFERENCE,
            label: TIER_LABELS.type_reference,
            layout: variant,
            meta: meta,
            variantFor: wanted,
            variantNote: "This type also flies a " + (CABIN_NAMES[wanted] || wanted)
              + " cabin, so the four-class configuration of this aircraft is shown."
              + " Reference layout — not verified for this airline."
          };
        }
      }
      return {
        tier: TIERS.TYPE_REFERENCE,
        label: TIER_LABELS.type_reference,
        layout: layout,
        meta: meta,
        reason: meta ? null : "type not in the local aircraft table"
      };
    }

    if (meta && meta.category === "freighter") {
      return { tier: TIERS.NO_PASSENGER_CABIN, label: TIER_LABELS.no_passenger_cabin, layout: null, meta: meta, reason: "this type carries freight, not passengers" };
    }

    if (meta) {
      var generic = buildGenericLayout(key, meta);
      if (generic) {
        return { tier: TIERS.CATEGORY_GENERIC, label: TIER_LABELS.category_generic, layout: generic, meta: meta };
      }
    }

    return { tier: TIERS.UNKNOWN_TYPE, label: TIER_LABELS.unknown_type, layout: null, meta: meta, reason: key ? "aircraft type " + key + " is not in the local table" : "the itinerary does not state an aircraft type" };
  }

  /** Structural integrity of one layout — used by the test suite and by any
   *  future tooling that adds a verified airline entry. */
  function layoutProblems(layout, key) {
    var problems = [];
    if (!layout) return [(key || "?") + ": missing layout"];
    var seen = {};
    var total = 0;
    var cabinCodes = { first: 1, business: 1, premium_economy: 1, economy: 1 };
    (layout.cabins || []).forEach(function (cabin, index) {
      var name = (cabin.code || "cabin" + index);
      if (!cabinCodes[cabin.code]) problems.push(key + ": unknown cabin code " + cabin.code);
      if (!(cabin.from >= 1) || !(cabin.to >= cabin.from)) problems.push(key + "/" + name + ": bad row range " + cabin.from + "-" + cabin.to);
      var letters = {};
      (cabin.groups || []).forEach(function (group) {
        group.forEach(function (letter) {
          if (letters[letter]) problems.push(key + "/" + name + ": letter " + letter + " repeats inside one row");
          letters[letter] = 1;
          if (String(letter).toUpperCase() === "I") problems.push(key + "/" + name + ": seat letter I is never used by airlines");
        });
      });
      (cabin.exitRows || []).forEach(function (row) {
        if (row < cabin.from || row > cabin.to) problems.push(key + "/" + name + ": exit row " + row + " lies outside the cabin");
      });
      if (cabin.to < cabin.from) problems.push(key + "/" + name + ": inverted range");
      total += (cabin.to - cabin.from + 1) * Object.keys(letters).length;
    });
    (layout.cabins || []).forEach(function (cabin) {
      for (var row = cabin.from; row <= cabin.to; row++) {
        var id = row + "|" + cabin.code;
        if (seen[id]) problems.push(key + ": row " + row + " is claimed by two cabins");
        seen[id] = 1;
      }
    });
    if (layout.seatCount != null && layout.seatCount !== total) {
      problems.push(key + ": seatCount " + layout.seatCount + " does not match the " + total + " seats the cabins contain");
    }
    if (typeof layout.wingStartRow !== "number" || typeof layout.wingEndRow !== "number" || layout.wingEndRow < layout.wingStartRow) {
      problems.push(key + ": wing rows are missing or inverted");
    }
    return problems;
  }

  /** Provenance rules for a verified airline entry. */
  function provenanceProblems(entry) {
    var problems = [];
    var required = ["airline", "iataType", "configLabel", "seatCount", "sourceName", "sourceUrl", "verifiedOn"];
    required.forEach(function (field) {
      if (!entry || entry[field] == null || entry[field] === "") problems.push("verified entry is missing " + field);
    });
    if (entry && entry.sourceUrl && !/^https?:\/\//.test(String(entry.sourceUrl))) problems.push("verified entry has a non-http sourceUrl");
    if (entry && entry.verifiedOn && !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.verifiedOn))) problems.push("verified entry verifiedOn is not an ISO date");
    if (entry && entry.seatCount != null && !(entry.seatCount > 0)) problems.push("verified entry seatCount must be positive");
    return problems;
  }

  var API = {
    LAYOUT_VERSION: LAYOUT_VERSION,
    LAYOUT_UPDATED: LAYOUT_UPDATED,
    SEAT_LETTERS: LETTERS,
    TIERS: TIERS,
    TIER_LABELS: TIER_LABELS,
    AIRLINE_LAYOUTS: AIRLINE_LAYOUTS,
    TYPE_LAYOUTS: TYPE_LAYOUTS,
    TYPE_LAYOUT_VARIANTS: TYPE_LAYOUT_VARIANTS,
    CABIN_NAMES: CABIN_NAMES,
    hasCabin: hasCabin,
    pickVariant: pickVariant,
    CATEGORY_FAMILIES: CATEGORY_FAMILIES,
    groupSpec: g,
    resolveLayout: resolveLayout,
    buildGenericLayout: buildGenericLayout,
    layoutProblems: layoutProblems,
    provenanceProblems: provenanceProblems,
    typeMeta: typeMeta
  };

  if (typeof module === "object" && module && module.exports) module.exports = API;
  if (root) root.SpicySeatMapLayouts = API;
})(typeof window !== "undefined" ? window : null);
