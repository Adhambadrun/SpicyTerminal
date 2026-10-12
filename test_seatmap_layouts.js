"use strict";

/* test_seatmap_layouts.js — the layout registry behind the seat map.
 *
 * The seat map may only ever draw a layout it can prove is one of:
 *   - an airline-verified configuration (provenance fields required), or
 *   - a labelled reference layout for the aircraft type, or
 *   - a generic cabin cross-section, or
 *   - nothing at all, with an honest reason.
 * These tests fail if a layout stops being internally consistent, if an entry
 * ships without its source, or if any flight the engine can produce would end
 * up with an unlabelled guess.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Layouts = require("./seatmap_layouts.js");
const SeatMap = require("./seatmap.js");
const ROOT = __dirname;

const dataSrc = fs.readFileSync(path.join(ROOT, "spicy_data.js"), "utf8");
const SPICY_DATA = JSON.parse(/const SPICY_DATA = (\{.*\});/s.exec(dataSrc)[1]);

let checks = 0;
function test(name, callback) {
  try {
    callback();
    checks++;
    console.log("PASS:", name);
  } catch (error) {
    console.error("FAIL:", name);
    throw error;
  }
}

test("every reference layout is internally consistent", () => {
  const codes = Object.keys(Layouts.TYPE_LAYOUTS);
  assert(codes.length >= 25, "the registry should cover the common fleet types, found " + codes.length);
  codes.forEach(code => {
    assert.deepStrictEqual(Layouts.layoutProblems(Layouts.TYPE_LAYOUTS[code], code), [], code + " has structural problems");
  });
});

test("seat letters are real airline letters (I is never used)", () => {
  Object.keys(Layouts.TYPE_LAYOUTS).forEach(code => {
    Layouts.TYPE_LAYOUTS[code].cabins.forEach(cabin => {
      cabin.groups.forEach(group => group.forEach(letter => {
        assert.notStrictEqual(letter, "I", code + " uses the seat letter I, which airlines never print");
        assert(Layouts.SEAT_LETTERS.indexOf(letter) >= 0, code + " uses a letter outside the airline alphabet");
      }));
    });
  });
});

test("seatCount always equals the seats the cabins actually contain", () => {
  Object.keys(Layouts.TYPE_LAYOUTS).forEach(code => {
    const layout = Layouts.TYPE_LAYOUTS[code];
    const enumerated = layout.cabins.reduce((sum, cabin) => {
      const perRow = cabin.groups.reduce((count, group) => count + group.length, 0);
      return sum + (cabin.to - cabin.from + 1) * perRow;
    }, 0);
    assert.strictEqual(layout.seatCount, enumerated, code + " seatCount disagrees with its rows");
    assert(layout.configLabel && layout.configLabel.length > 10, code + " must describe its configuration");
  });
});

test("a verified airline entry without provenance is impossible", () => {
  const incomplete = { airline: "AA", iataType: "738", configLabel: "737-800 · 172 seats", seatCount: 172 };
  const problems = Layouts.provenanceProblems(incomplete);
  ["sourceName", "sourceUrl", "verifiedOn"].forEach(field => {
    assert(problems.some(problem => problem.includes(field)), "a verified entry must demand " + field);
  });
  assert(problems.some(problem => problem.includes("sourceUrl")), "sourceUrl is required");
  assert.deepStrictEqual(Layouts.provenanceProblems({
    airline: "AA", iataType: "738", configLabel: "737-800 · 172 seats", seatCount: 172,
    sourceName: "Airline seat map", sourceUrl: "https://example.com/map", verifiedOn: "2026-10-12"
  }), [], "a fully sourced entry passes");
  assert(Layouts.provenanceProblems({
    airline: "AA", iataType: "738", configLabel: "x", seatCount: 1,
    sourceName: "n", sourceUrl: "not-a-url", verifiedOn: "12 Oct 2026"
  }).length >= 2, "bad URL and bad date are both rejected");
});

test("the shipped airline-verified list is either empty or fully sourced", () => {
  assert(Array.isArray(Layouts.AIRLINE_LAYOUTS), "the verified list is an array");
  Layouts.AIRLINE_LAYOUTS.forEach(entry => {
    assert.deepStrictEqual(Layouts.provenanceProblems(entry), [], "verified entry for " + entry.airline + " " + entry.iataType + " lacks provenance");
    assert.deepStrictEqual(Layouts.layoutProblems(entry, entry.airline + "|" + entry.iataType), [], "verified entry has structural problems");
  });
});

test("a verified airline entry wins over the type reference", () => {
  const entry = {
    airline: "ZZ", iataType: "738", configLabel: "test-only configuration", seatCount: 8,
    sourceName: "test source", sourceUrl: "https://example.com/zz738", verifiedOn: "2026-10-12",
    wingStartRow: 1, wingEndRow: 2, facilities: ["EXIT"],
    cabins: [{ code: "economy", name: "Economy", from: 1, to: 2, groups: [["A", "B"], ["C", "D"]], exitRows: [], pitch: 30, width: 17, features: [] }]
  };
  Layouts.AIRLINE_LAYOUTS.push(entry);
  try {
    const resolved = Layouts.resolveLayout("ZZ", "738", SPICY_DATA.aircraftTypes);
    assert.strictEqual(resolved.tier, Layouts.TIERS.AIRLINE_VERIFIED);
    assert.strictEqual(resolved.layout.seatCount, 8);
    assert.strictEqual(resolved.sourceUrl, "https://example.com/zz738");
    const other = Layouts.resolveLayout("YY", "738", SPICY_DATA.aircraftTypes);
    assert.strictEqual(other.tier, Layouts.TIERS.TYPE_REFERENCE, "another airline still gets the labelled reference");
  } finally {
    Layouts.AIRLINE_LAYOUTS.pop();
  }
});

test("resolution falls back honestly, never silently", () => {
  const types = SPICY_DATA.aircraftTypes;
  const reference = Layouts.resolveLayout("QR", "359", types);
  assert.strictEqual(reference.tier, Layouts.TIERS.TYPE_REFERENCE);
  assert.strictEqual(reference.layout.seatCount, 328);

  const freight = Layouts.resolveLayout("EK", "77F", types);
  assert.strictEqual(freight.tier, Layouts.TIERS.NO_PASSENGER_CABIN);
  assert.strictEqual(freight.layout, null, "a freighter has no passenger cabin to draw");

  const unknown = Layouts.resolveLayout("AA", "ZZZ", types);
  assert.strictEqual(unknown.tier, Layouts.TIERS.UNKNOWN_TYPE);
  assert.strictEqual(unknown.layout, null);

  const empty = Layouts.resolveLayout("AA", "", types);
  assert.strictEqual(empty.tier, Layouts.TIERS.UNKNOWN_TYPE, "no type code means no layout");
});

test("a type without a reference still gets a labelled generic cross-section", () => {
  const types = SPICY_DATA.aircraftTypes;
  const genericCodes = Object.keys(types).filter(code => !Layouts.TYPE_LAYOUTS[code] && types[code][4] !== "freighter");
  assert(genericCodes.length > 0, "the table has types the registry deliberately does not cover");
  genericCodes.forEach(code => {
    const resolved = Layouts.resolveLayout("AA", code, types);
    assert.strictEqual(resolved.tier, Layouts.TIERS.CATEGORY_GENERIC, code + " must fall back to the generic tier");
    assert(resolved.layout, code + " still gets a drawable generic shape");
    assert.deepStrictEqual(Layouts.layoutProblems(resolved.layout, code), [], code + " generic layout is malformed");
    assert(/generic/i.test(resolved.layout.configLabel), code + " generic layout must say it is generic");
    // The generic shape follows the real cross-section for the category.
    const category = types[code][4];
    const expected = Layouts.CATEGORY_FAMILIES[category];
    expected.groups.forEach((group, index) => {
      assert.strictEqual(group.length, resolved.layout.cabins[0].groups[index].length,
        code + " generic cabin does not match the real " + category + " cross-section");
    });
  });
});

test("every code the converter's own equipment tables can emit is registered", () => {
  const used = new Set();
  [SPICY_DATA.airlineEquipment, SPICY_DATA.routeEquipment, SPICY_DATA.flightEquipment].forEach(table => {
    Object.keys(table).forEach(key => {
      const value = table[key];
      if (Array.isArray(value)) value.forEach(code => used.add(code));
      else used.add(value);
    });
  });
  (SPICY_DATA.genericEquipment || []).forEach(code => used.add(code));
  const unregistered = [...used].filter(code => !Layouts.TYPE_LAYOUTS[code] && !SPICY_DATA.aircraftTypes[code]);
  assert.deepStrictEqual(unregistered, [], "no flight can end up with a type the seat map knows nothing about");
  const referenceable = [...used].filter(code => !Layouts.TYPE_LAYOUTS[code]);
  assert.deepStrictEqual(referenceable, [], "every type the engine can hand the seat map has a reference layout");
});

test("the manual demo presets are the registry's own layouts", () => {
  ["738", "320", "77W"].forEach(code => {
    assert.strictEqual(SeatMap.AIRCRAFT_LAYOUTS[code], Layouts.TYPE_LAYOUTS[code],
      code + " demo preset must be the same object as the registry entry, never a copy that can drift");
  });
});

test("the registry is versioned and dates its own review", () => {
  assert(/^\d+$/.test(Layouts.LAYOUT_VERSION), "registry carries a version");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(Layouts.LAYOUT_UPDATED), "registry carries the date it was last reviewed");
});

/* ---------- four-class variants: a cabin the aircraft does fly ---------- */
/* A two-class reference layout is not proof that the type has no First cabin:
   the same 787-9 flies four cabins at another operator. Drawing "no First" for
   a First ticket would be a silent lie, so those configurations ship too. */

test("every four-class variant is internally consistent", () => {
  const codes = Object.keys(Layouts.TYPE_LAYOUT_VARIANTS);
  assert(codes.length >= 10, "the wide bodies carry a four-class variant, found " + codes.length);
  codes.forEach(code => {
    const problems = Layouts.layoutProblems(Layouts.TYPE_LAYOUT_VARIANTS[code], code + "/4-class");
    assert.deepStrictEqual(problems, [], code + " four-class variant has structural problems");
  });
});

test("a variant only exists for a type, and only adds cabins the default lacks", () => {
  Object.keys(Layouts.TYPE_LAYOUT_VARIANTS).forEach(code => {
    const variant = Layouts.TYPE_LAYOUT_VARIANTS[code];
    const base = Layouts.TYPE_LAYOUTS[code];
    assert(base, code + " variant has no default layout to vary from");
    assert.strictEqual(variant.name, base.name, code + " variant is the same aircraft");
    assert.strictEqual(variant.icaoCode, base.icaoCode, code + " variant keeps the same ICAO code");
    ["first", "premium_economy"].forEach(cabin => {
      assert(Layouts.hasCabin(variant, cabin), code + " four-class variant carries a " + cabin + " cabin");
    });
    assert(!Layouts.hasCabin(variant, "business") === false, code + " four-class variant keeps a business cabin");
    /* The variant is only ever chosen when the default cannot answer, so it
       must actually answer something the default cannot. */
    const adds = ["first", "premium_economy"].filter(cabin => !Layouts.hasCabin(base, cabin));
    assert(adds.length > 0, code + " variant adds at least one cabin the default layout has not got");
  });
});

test("a First or Premium Economy ticket finds the cabin this type flies", () => {
  const wideBodies = Object.keys(Layouts.TYPE_LAYOUTS).filter(code => Layouts.TYPE_LAYOUTS[code].category === "widebody");
  assert(wideBodies.length >= 12, "the registry covers the wide bodies, found " + wideBodies.length);
  wideBodies.forEach(code => {
    ["first", "premium_economy"].forEach(cabin => {
      const resolved = Layouts.resolveLayout("", code, SPICY_DATA.aircraftTypes, { cabin: cabin });
      assert(resolved.tier === Layouts.TIERS.TYPE_REFERENCE, code + "/" + cabin + " still resolves to a reference layout");
      assert(Layouts.hasCabin(resolved.layout, cabin),
        code + "/" + cabin + " resolves to a layout that actually has that cabin");
      if (!Layouts.hasCabin(Layouts.TYPE_LAYOUTS[code], cabin)) {
        assert(resolved.variantFor === cabin, code + "/" + cabin + " records that a variant was used");
        assert(/also flies a/.test(resolved.variantNote || ""), code + "/" + cabin + " explains the switch");
      }
    });
  });
});

test("a cabin the default already has is never swapped for a variant", () => {
  const defaults = [["77W", "first"], ["738", "economy"], ["763", "business"], ["388", "premium_economy"]];
  defaults.forEach(([code, cabin]) => {
    const resolved = Layouts.resolveLayout("", code, SPICY_DATA.aircraftTypes, { cabin: cabin });
    assert.strictEqual(resolved.layout, Layouts.TYPE_LAYOUTS[code], code + "/" + cabin + " keeps the default layout");
    assert.strictEqual(resolved.variantFor, undefined, code + "/" + cabin + " records no switch");
  });
});

test("no variant is ever presented as an airline's verified configuration", () => {
  Object.keys(Layouts.TYPE_LAYOUT_VARIANTS).forEach(code => {
    const resolved = Layouts.resolveLayout("BA", code, SPICY_DATA.aircraftTypes, { cabin: "first" });
    assert(resolved.tier === Layouts.TIERS.TYPE_REFERENCE, code + " variant stays a reference layout");
    assert.strictEqual(resolved.sourceName, undefined, code + " variant claims no airline source");
    assert.strictEqual(resolved.sourceUrl, undefined, code + " variant claims no source document");
  });
});

console.log("\nLayout registry checks: " + checks + " passed.");
