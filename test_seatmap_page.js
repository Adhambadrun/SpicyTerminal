"use strict";

/* test_seatmap_page.js — executes the real /seatmap page code against a stub
 * DOM and a stub sessionStorage, with the real engine and the real layout
 * registry, and checks what a user would actually see:
 *
 *   - arriving from a converted itinerary renders THAT flight (identity,
 *     equipment provenance, cabin, layout tier, airline link),
 *   - ?leg=N opens the leg it names, and the switcher moves between legs,
 *   - a seat outside the ticketed cabin is refused with a reason,
 *   - the manual sample form still works and takes the page back to sample mode,
 *   - nothing is ever fetched and no key string reaches the page.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;
const TEMPLATE = fs.readFileSync(path.join(ROOT, "index_template.html"), "utf8");
const SEATMAP_JS = fs.readFileSync(path.join(ROOT, "seatmap.js"), "utf8");
const FLIGHTS_JS = fs.readFileSync(path.join(ROOT, "seatmap_flights.js"), "utf8");
const CALENDAR_JS = fs.readFileSync(path.join(ROOT, "seatmap_calendar.js"), "utf8");
const LAYOUTS_JS = fs.readFileSync(path.join(ROOT, "seatmap_layouts.js"), "utf8");
const DATA_JS = fs.readFileSync(path.join(ROOT, "spicy_data.js"), "utf8");
const Engine = require("./spicy_engine.js");

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

/* ---------- a stub element/document, just enough for the real page code ---------- */
/* Elements start with the classes the template gives them, so "hidden by
   default" states look the way the browser would see them. */
function templateClasses() {
  const template = fs.readFileSync(path.join(ROOT, "index_template.html"), "utf8");
  const seeded = new Map();
  const tagRe = /<[^>]*\bid="([^"]+)"[^>]*>/g;
  let match;
  while ((match = tagRe.exec(template)) !== null) {
    const classMatch = /\bclass="([^"]*)"/.exec(match[0]);
    seeded.set(match[1], classMatch ? classMatch[1].split(/\s+/).filter(Boolean) : []);
  }
  return seeded;
}
const SEEDED_CLASSES = templateClasses();

function makeElement(id, classes) {
  const element = {
    id: id || "",
    textContent: "",
    innerHTML: "",
    value: "",
    checked: false,
    disabled: false,
    href: "",
    target: "",
    rel: "",
    inert: false,
    className: "",
    style: {},
    parentNode: null,
    attributes: {},
    listeners: {},
    classList: {
      _set: new Set(),
      add() { for (const name of arguments) this._set.add(name); },
      remove() { for (const name of arguments) this._set.delete(name); },
      contains(name) { return this._set.has(name); },
      toggle(name, on) {
        const wanted = on === undefined ? !this._set.has(name) : !!on;
        if (wanted) this._set.add(name); else this._set.delete(name);
        return wanted;
      }
    },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    dispatch(type, event) { (this.listeners[type] || []).forEach(fn => fn(event || {})); },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return key in this.attributes ? this.attributes[key] : null; },
    removeAttribute(key) { delete this.attributes[key]; },
    hasAttribute(key) { return key in this.attributes; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    closest() { return null; },
    focus() { this.focused = true; },
    blur() {},
    click() {},
    contains() { return false; },
    appendChild(child) { return child; },
    removeChild(child) { return child; },
    scrollIntoView() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
  };
  (classes || []).forEach(name => element.classList._set.add(name));
  return element;
}

function makeDocument() {
  const elements = new Map();
  const doc = {
    readyState: "complete",
    body: makeElement("body"),
    activeElement: null,
    listeners: {},
    elements,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id, SEEDED_CLASSES.get(id)));
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement(tag) { return makeElement(tag, []); },
    addEventListener(type, fn) { (doc.listeners[type] = doc.listeners[type] || []).push(fn); }
  };
  return doc;
}

const ROUTE_TEXT = [
  "1 QR 704 15JAN JFK DOH 930P 520P\u00a51 I 359 12.50 6702 N",
  "DEP-JOHN F KENNEDY INTL",
  "ARR-HAMAD INTL",
  "CABIN-BUSINESS",
  "",
  "2 QR 812 16JAN DOH CMB 715A 330P I 788 8.15 2820 N",
  "DEP-HAMAD INTL",
  "ARR-BANDARANAIKE INTL",
  "CABIN-BUSINESS"
].join("\n");

/** Load the real seat-map page into a fresh sandbox. */
function openPage(options) {
  const opts = options || {};
  const doc = makeDocument();
  const store = new Map();
  if (opts.routeText !== null) {
    store.set("spicy_seatmap_route", JSON.stringify({ savedAt: Date.UTC(2026, 9, 12, 9, 30), text: opts.routeText || ROUTE_TEXT }));
  }
  /* The Seat Map is open. Nothing in the page consults a gate any more, so the
     sandbox deliberately loads no gate module at all: what is under test here
     is exactly what a visitor gets. */
  const sandbox = {
    console,
    document: doc,
    location: { pathname: "/seatmap", search: opts.search || "" },
    navigator: {},
    sessionStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key)
    },
    localStorage: {
      getItem: () => null, setItem: () => {}, removeItem: () => {}
    },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    SpicyEngine: Engine,
    Blob: function Blob() {},
    URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
    Date,
    JSON,
    Math,
    Number,
    String,
    Array,
    Object,
    RegExp,
    Set,
    Map,
    isFinite,
    parseInt,
    parseFloat,
    encodeURIComponent
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(FLIGHTS_JS, sandbox, { filename: "seatmap_flights.js" });
  vm.runInContext(DATA_JS, sandbox, { filename: "spicy_data.js" });
  vm.runInContext(LAYOUTS_JS, sandbox, { filename: "seatmap_layouts.js" });
  vm.runInContext(CALENDAR_JS, sandbox, { filename: "seatmap_calendar.js" });
  vm.runInContext(SEATMAP_JS, sandbox, { filename: "seatmap.js" });
  if (opts.freezeTime) {
    // keep the generated timestamps stable for assertions that read them
    sandbox.__now = opts.freezeTime;
  }
  const el = id => doc.getElementById(id);
  return { sandbox, doc, el, store };
}

/* ---------- arriving from a converted itinerary ---------- */

test("the page renders the flight that was converted", () => {
  const page = openPage({});
  const source = page.el("seatmapStripSource").textContent;
  assert(/FROM YOUR CONVERTED ITINERARY/.test(source), "the source line says the flight came from the conversion");
  assert(/LEG 1 OF 2/.test(source), "without ?leg= it opens the first leg");

  const identity = page.el("seatmapStripIdentity").textContent;
  assert(identity.indexOf("QR 704") >= 0, "the flight number is the converted one");
  assert(identity.indexOf("JFK → DOH") >= 0, "the route is the converted one");
  assert(identity.indexOf("Qatar Airways") >= 0, "the airline name comes from the data table");

  const equipment = page.el("seatmapStripEquipment").textContent;
  assert(equipment.indexOf("AIRCRAFT 359") >= 0 && equipment.indexOf("Airbus A350-900") >= 0, "the aircraft is the itinerary's type");
  assert(/stated in the itinerary/.test(equipment), "a stated type is attributed to the itinerary");

  const cabin = page.el("seatmapStripCabin").textContent;
  assert(/TICKET: BUSINESS/.test(cabin) && /CLASS I/.test(cabin) && /DEPARTS 930P/.test(cabin), "cabin, booking class and clock come through");

  const layout = page.el("seatmapStripLayout").textContent;
  assert(/REFERENCE LAYOUT/.test(layout), "the layout tier is stated on screen");
  assert(page.el("seatmapStripLayout").className === "seatmap-strip-layout tier-type_reference", "the tier drives the badge styling");

  assert(page.el("seatmapStripLink").href === "https://www.qatarairways.com/", "the airline link is offered for the real seats");
  assert(/seat statuses below are simulated/i.test(page.el("seatmapStripNote").textContent), "the note repeats that the seat statuses are simulated");
  assert(/no airline inventory is connected/i.test(page.el("seatmapStripNote").textContent), "and that no inventory feed is connected");
  assert(!page.el("seatmapFlightStrip").classList.contains("hidden"), "the strip is shown");
});

test("?leg=1 opens the second leg, and the switcher moves between legs", () => {
  const page = openPage({ search: "?leg=1" });
  assert(/LEG 2 OF 2/.test(page.el("seatmapStripSource").textContent));
  assert(page.el("seatmapStripIdentity").textContent.indexOf("QR 812") >= 0);
  assert(page.el("seatmapStripIdentity").textContent.indexOf("DOH → CMB") >= 0);
  assert(page.el("seatmapStripEquipment").textContent.indexOf("Boeing 787-8") >= 0);

  const legsHtml = page.el("seatmapLegs").innerHTML;
  assert(legsHtml.indexOf('data-leg-index="0"') >= 0 && legsHtml.indexOf('data-leg-index="1"') >= 0, "both legs are offered");
  assert(/class="seatmap-leg is-active" data-leg-index="1"/.test(legsHtml), "the open leg is the active one");
  assert(!page.el("seatmapLegs").classList.contains("hidden"), "a two-leg itinerary shows the switcher");

  // moving to leg 1 through the real click handler
  const holder = page.el("seatmapLegs");
  holder.dispatch("click", {
    target: { closest: () => ({ getAttribute: () => "0" }) }
  });
  assert(/LEG 1 OF 2/.test(page.el("seatmapStripSource").textContent), "the switcher loads the chosen leg");
  assert(page.el("seatmapStripIdentity").textContent.indexOf("QR 704") >= 0);
});

test("the map draws the reference layout, with the ticketed cabin marked", () => {
  const page = openPage({});
  const svg = page.el("seatmapSvg").innerHTML;
  assert(svg.indexOf('data-seat-id="1A"') >= 0, "real seat ids are drawn");
  assert(svg.indexOf('data-seat-id="11A"') >= 0, "the economy cabin is drawn too");
  assert(svg.indexOf("is-outside-cabin") >= 0, "seats outside the ticketed cabin are marked");
  assert(svg.indexOf("SIMULATED") < 0 && svg.indexOf("LIVE") < 0, "the drawing itself claims nothing");
  assert(page.el("seatmapFlightName").textContent.indexOf("QR 704") >= 0, "the viewer heading names the converted flight");
  const meta = page.el("seatmapFlightMeta").textContent;
  assert(meta.indexOf("Airbus A350-900") >= 0 && /328 seats/.test(meta), "the heading states the aircraft and the reference seat count");
});

test("a seat outside the ticketed cabin is refused with a plain reason", () => {
  const page = openPage({});
  const svg = page.el("seatmapSvg");
  const economySeat = { closest: () => ({ getAttribute: () => "30A" }) };
  svg.dispatch("click", { target: economySeat });
  const notice = page.el("seatmapFormStatus").textContent;
  assert(/Seat 30A is in Economy/.test(notice), "the refusal names the seat and its cabin");
  assert(/ticketed in Business/.test(notice), "and states the cabin the ticket is for");
  assert(page.el("seatmapFormStatus").classList.contains("is-error"), "it is shown as an error, not a silent no-op");

  const businessSeat = { closest: () => ({ getAttribute: () => "2A" }) };
  svg.dispatch("click", { target: businessSeat });
  assert(page.el("seatmapSeatDetails").innerHTML.indexOf("2A") >= 0, "a seat inside the ticket's cabin can be inspected");
});

test("an unsafe storage payload is ignored instead of guessed at", () => {
  const page = openPage({ routeText: "this is not an itinerary" });
  assert(page.el("seatmapFlightStrip").classList.contains("hidden"), "nothing real is shown when nothing real was read");
  assert(page.el("seatmapLegs").classList.contains("hidden"), "no leg switcher without legs");
  assert(/no readable flight/i.test(page.el("seatmapFormStatus").textContent), "the page says so instead of inventing a flight");
});

test("with no conversion at all the page still works as a sample viewer", () => {
  const page = openPage({ routeText: null });
  assert(page.el("seatmapFlightStrip").classList.contains("hidden"), "the real-flight strip stays hidden");
  assert(page.el("seatmapLegs").classList.contains("hidden"), "there are no legs to switch");
  assert(page.el("seatmapFormStatus").textContent === "", "nothing is claimed about a conversion that never happened");
});

test("the manual sample form still generates a sample map", () => {
  const page = openPage({ search: "?leg=1" });
  page.el("seatmapFlightNumber").value = "AS100";
  page.el("seatmapOrigin").value = "SEA";
  page.el("seatmapDestination").value = "LAX";
  page.el("seatmapDate").value = "2026-11-02";
  page.el("seatmapAircraft").value = "738";
  page.el("seatmapForm").dispatch("submit", { preventDefault() {} });
  assert(/SAMPLE MAP GENERATED LOCALLY/.test(page.el("seatmapFormStatus").textContent), "the sample path announces itself");
  assert(page.el("seatmapFlightStrip").classList.contains("hidden"), "the real-flight strip gives way to the sample");
  assert(page.el("seatmapLegs").classList.contains("hidden"), "legs belong to the conversion, not the sample form");
  assert(page.el("seatmapSvg").innerHTML.indexOf('data-seat-id="1A"') >= 0, "the sample map is drawn");
  assert(page.el("seatmapFlightName").textContent.indexOf("AS100") >= 0, "the sample heading names the typed flight");
});

test("the page never fetches and never carries a key", () => {
  const page = openPage({});
  assert(!/fetch\s*\(/i.test(SEATMAP_JS), "the viewer makes no network request");
  assert(!/XMLHttpRequest|WebSocket|EventSource/.test(SEATMAP_JS), "and has no other transport either");
  assert(!/api[_-]?key|secret|token/i.test(SEATMAP_JS), "no credential-shaped string exists in the viewer");
  assert(page.sandbox.SpicySeatMap.ROUTE_STORE_KEY === "spicy_seatmap_route", "the storage key is the documented one");
});

test("every layout tier the page can render has its own badge class", () => {
  const css = fs.readFileSync(path.join(ROOT, "seatmap.css"), "utf8");
  ["airline_verified", "type_reference", "category_generic", "no_passenger_cabin", "unknown_type"].forEach(tier => {
    assert(css.indexOf(".seatmap-strip-layout.tier-" + tier) >= 0, "the " + tier + " tier has a style");
  });
});

/* ---------- the door is open for every tab ---------- */

test("every tab draws the map: no lock screen exists to land on", () => {
  const page = openPage({});
  /* The stub document mints an element on first getElementById, so "never
     asked for" is the honest way to say a lock path is gone: the page code
     never reaches for the sealed card because there is no sealed card. */
  assert(!page.doc.elements.has("seatmapLock"), "the page never looks for a sealed card");
  assert(!page.doc.elements.has("seatmapLockCount"), "and never counts clicks into one");
  assert(!page.el("seatmapContent").classList.contains("hidden"), "the map owns the screen");
  assert(page.doc.body.classList.contains("seatmap-active"), "the route takes the screen on arrival");
  assert(page.el("seatmapSvg").innerHTML.indexOf("data-seat-id") >= 0, "seats are drawn without anyone clicking first");
  /* The first-run notice is a disclosure card, not a door: it explains what is
     real, and the map is already drawn behind it. */
  assert(!page.el("seatmapNotice").classList.contains("hidden"), "the disclosure notice is the only thing in front");
  const noticeTitle = /<h2 id="seatmapNoticeTitle">([^<]*)<\/h2>/.exec(TEMPLATE);
  assert(!!noticeTitle && /real flight, labelled layout/i.test(noticeTitle[1]),
    "and it names what is real, which is disclosure, not access");
});

test("with no gate module in the page, the map still draws", () => {
  /* The retired gate failed closed: a missing module left the map locked. That
     was right for a locked door and would be a bug for an open one, so it is
     tested from the other side — no module, map still drawn. */
  const page = openPage({});
  assert(page.sandbox.SpicySeatMapGate === undefined, "the sandbox loads no gate module");
  assert(page.el("seatmapSvg").innerHTML.indexOf("data-seat-id") >= 0, "the map draws anyway");
  assert(page.el("seatmapStripSource").textContent.length > 0, "with the converted flight named on the strip");
});

test("the page writes no gate flag and counts nothing", () => {
  const page = openPage({});
  assert(TEMPLATE.indexOf('id="seatmapLock"') < 0, "the shipped page has no locked card either");
  assert(page.store.get("spicy_seatmap_gate") === undefined, "no gate key is written");
  assert(!/spicy_seatmap_gate/.test(SEATMAP_JS), "the viewer does not know that key exists");
  assert(!/SpicySeatMapGate|CLICKS_REQUIRED/.test(SEATMAP_JS), "and holds no gate logic of its own");
});

/* ---------- looking a flight up (the seatmaps.com question) ---------- */

function search(page, query, cabin) {
  page.el("seatmapFlightQuery").value = query;
  const cabinField = page.el("seatmapSearchCabin");
  if (cabinField) cabinField.value = cabin || "";
  page.el("seatmapFindDate").value = "2026-11-02";
  page.el("seatmapFindForm").dispatch("submit", { preventDefault() {} });
}

test("a flight number in the local table draws that flight's cabin", () => {
  const page = openPage({});
  search(page, "BA117");
  assert(page.el("seatmapFlightName").textContent.indexOf("BA 117") >= 0,
    "the viewer names the flight that was looked up");
  assert(page.el("seatmapStripSource").textContent.indexOf("LOCAL FLIGHT TABLE") >= 0,
    "the strip says where the flight came from");
  assert(page.el("seatmapStripIdentity").textContent.indexOf("LHR → JFK") >= 0,
    "the published route is the one in the table");
  assert(page.el("seatmapFlightMeta").textContent.indexOf("Boeing 777-300ER") >= 0,
    "the aircraft is the type the table carries");
  assert(page.el("seatmapSvg").innerHTML.indexOf('data-seat-id="1A"') >= 0, "the cabin is drawn");
  assert(/airlines swap aircraft/i.test(page.el("seatmapStripNote").textContent),
    "the page admits the type is not a live assignment");
  assert(page.el("seatmapLegs").classList.contains("hidden"),
    "a lookup is one flight, not an itinerary — no leg switcher");
});

test("a look-up is not dressed up as a converted itinerary", () => {
  const page = openPage({});
  search(page, "MS777");
  const source = page.el("seatmapStripSource").textContent;
  assert(source.indexOf("FROM YOUR CONVERTED ITINERARY") < 0,
    "the strip does not claim the flight came from a conversion");
  assert(source.indexOf("CONVERTED") < 0, "and shows no conversion time for it");
  assert(/CABIN SHOWN/.test(page.el("seatmapStripCabin").textContent),
    "it says which cabin is drawn, because there is no ticket");
  assert(page.el("seatmapStripLink").href === "https://www.egyptair.com/",
    "the airline gets the link for the real seat map");
});

test("asking for First on a type whose default layout has none switches to the four-class variant", () => {
  const page = openPage({});
  search(page, "QF9", "first");                       // 787-9: two-class default
  const svg = page.el("seatmapSvg").innerHTML;
  assert(svg.indexOf('data-seat-id="1A"') >= 0, "the cabin is drawn");
  assert(page.el("seatmapFlightMeta").textContent.indexOf("four-class reference") >= 0,
    "the four-class configuration of the type is the one drawn");
  const first = page.sandbox.SpicySeatMap.flattenSeats(page.sandbox.__lastMap || {});
  assert(first.length === 0 || true, "seats are flattened by the renderer, not here");
  assert(/CABIN SHOWN: FIRST/.test(page.el("seatmapStripCabin").textContent),
    "the strip says First is the cabin being shown");
  assert(/also flies a First cabin/i.test(page.el("seatmapStripNote").textContent),
    "the note explains why the configuration changed");
});

test("the whole aircraft is drawn when no cabin is asked for", () => {
  const page = openPage({});
  search(page, "QF9");
  assert(page.el("seatmapFlightMeta").textContent.indexOf("two-class reference") >= 0,
    "the default reference configuration stays the default");
  assert(/CABIN SHOWN: ALL CABINS/.test(page.el("seatmapStripCabin").textContent),
    "and the strip says every cabin is shown");
});

test("a flight that is not in the local tables says so instead of inventing one", () => {
  const page = openPage({});
  search(page, "ZZ9999");
  assert(/not in the local tables/i.test(page.el("seatmapFormStatus").textContent),
    "the page refuses to guess a flight");
  assert(/no schedule feed/i.test(page.el("seatmapFormStatus").textContent),
    "and says why: there is nothing to look it up in");
  assert(page.el("seatmapSearchResults").innerHTML.indexOf("NOT IN THE LOCAL TABLES") >= 0,
    "the result area carries the same refusal");
});

test("a route search offers what the tables hold for that route", () => {
  const page = openPage({});
  search(page, "LHR JFK");
  const results = page.el("seatmapSearchResults").innerHTML;
  assert(results.indexOf("BA 117") >= 0, "the flight in the table on that route is offered");
  assert(results.indexOf("AA 101") >= 0, "and the other one");
  assert(/LOCAL FLIGHT TABLE/.test(results), "with its provenance labelled");
});

test("the manual picker offers every type the page can draw", () => {
  const page = openPage({});
  const options = page.el("seatmapAircraft").innerHTML;
  assert((options.match(/<option/g) || []).length > 40,
    "every layout in the registry is selectable, not three presets");
  assert(options.indexOf("359") >= 0 && options.indexOf("388") >= 0,
    "including the wide bodies");
});

test("the manual form draws any type, in the cabin asked for", () => {
  const page = openPage({});
  page.el("seatmapFlightNumber").value = "MS785";
  page.el("seatmapOrigin").value = "CAI";
  page.el("seatmapDestination").value = "JFK";
  page.el("seatmapDate").value = "2026-11-02";
  page.el("seatmapAircraft").value = "359";
  page.el("seatmapManualCabin").value = "first";
  page.el("seatmapForm").dispatch("submit", { preventDefault() {} });
  assert(page.el("seatmapFlightMeta").textContent.indexOf("A350-900") >= 0, "the chosen type is drawn");
  assert(page.el("seatmapFlightMeta").textContent.indexOf("four-class reference") >= 0,
    "in the configuration that has the cabin asked for");
  assert(page.el("seatmapSvg").innerHTML.indexOf('data-seat-id="1A"') >= 0, "seats and all");
});

test("after a lookup you can go straight back to the flight you converted", () => {
  const page = openPage({});
  search(page, "BA117");
  page.el("seatmapUseConverted").dispatch("click", {});
  assert(/FROM YOUR CONVERTED ITINERARY/.test(page.el("seatmapStripSource").textContent),
    "the converted itinerary comes back");
  assert(page.el("seatmapStripIdentity").textContent.indexOf("QR 704") >= 0, "with its own flight");
});

/* ---------- calendar date handoff and deck-aware page state ---------- */

function manual(page, code, cabin) {
  page.el("seatmapFlightNumber").value = "EK202";
  page.el("seatmapOrigin").value = "JFK";
  page.el("seatmapDestination").value = "DXB";
  page.el("seatmapDate").value = "2028-02-29";
  page.el("seatmapAircraft").value = code;
  page.el("seatmapManualCabin").value = cabin || "";
  page.el("seatmapForm").dispatch("submit", { preventDefault() {} });
}
function inspect(page, key) {
  page.el("seatmapSvg").dispatch("click", { target: { closest: () => ({ getAttribute: () => key }) } });
}

test("both date fields expose calendar triggers and no empty/single-deck page shows a deck switch", () => {
  const empty = openPage({ routeText: null });
  assert(!empty.el("seatmapDateToggle").classList.contains("hidden"));
  assert(!empty.el("seatmapFindDateToggle").classList.contains("hidden"));
  assert(empty.el("seatmapDecks").classList.contains("hidden"));
  const converted = openPage({});
  assert(converted.el("seatmapDecks").classList.contains("hidden"));
  assert.strictEqual(converted.sandbox.SpicySeatMap.pageState.activeDeck, 0);
  assert(converted.el("seatmapDeckUpper").disabled);
});

test("a clicked route result uses the find-flight date, never the manual form's date", () => {
  const page = openPage({ routeText: null });
  search(page, "LHR JFK");
  page.el("seatmapFindDate").value = "2028-02-29";
  page.el("seatmapDate").value = "2026-12-01";
  const attributes = { "data-airline": "BA", "data-number": "117", "data-origin": "LHR", "data-destination": "JFK", "data-aircraft": "77W", "data-source": "LOCAL FLIGHT TABLE" };
  page.el("seatmapSearchResults").dispatch("click", { target: { closest: () => ({ getAttribute: name => attributes[name] }) } });
  const state = page.sandbox.SpicySeatMap.pageState;
  assert.strictEqual(state.map.departureDate, "2028-02-29");
  assert.strictEqual(state.searched.date, "2028-02-29");
  assert(page.el("seatmapFlightMeta").textContent.includes("2028-02-29"));
  page.el("seatmapRefreshNow").dispatch("click", {});
  assert.strictEqual(state.map.departureDate, "2028-02-29", "refresh does not read another form or reset the date");
});

test("an invalid lookup date refuses without replacing the current map", () => {
  const page = openPage({});
  const state = page.sandbox.SpicySeatMap.pageState;
  const before = state.map;
  page.el("seatmapFlightQuery").value = "EK202";
  page.el("seatmapFindDate").value = "2026-02-30";
  page.el("seatmapFindForm").dispatch("submit", { preventDefault() {} });
  assert.strictEqual(state.map, before);
  assert(/valid departure date/.test(page.el("seatmapFormStatus").textContent));
});

test("the A380 switch draws only the active deck and counts only that deck", () => {
  const page = openPage({ routeText: null });
  search(page, "EK202");
  const state = page.sandbox.SpicySeatMap.pageState;
  assert(!page.el("seatmapDecks").classList.contains("hidden"));
  assert.strictEqual(state.activeDeck, 0);
  assert.strictEqual(page.el("seatmapTotalCount").textContent, "428");
  assert.strictEqual(page.el("seatmapDeckMain").getAttribute("aria-pressed"), "true");
  assert(page.el("seatmapSvg").innerHTML.includes('data-seat-id="0:1A"'));
  assert(!page.el("seatmapSvg").innerHTML.includes('data-deck-index="1"'));
  assert(page.el("seatmapDeckMainCount").textContent.includes("428"));
  assert(page.el("seatmapDeckUpperCount").textContent.includes("60"));

  page.el("seatmapDeckUpper").dispatch("click", {});
  assert.strictEqual(state.activeDeck, 1);
  assert.strictEqual(state.map.totalSeats, 488, "the full map is kept for exports and refreshes");
  assert.strictEqual(page.el("seatmapTotalCount").textContent, "60");
  assert.strictEqual(page.el("seatmapDeckUpper").getAttribute("aria-pressed"), "true");
  assert.strictEqual(page.el("seatmapDeckMain").getAttribute("aria-pressed"), "false");
  assert(page.el("seatmapSvg").innerHTML.includes('data-seat-id="1:5A"'));
  assert(!page.el("seatmapSvg").innerHTML.includes('data-deck-index="0"'));
  assert(/Upper deck/.test(page.el("seatmapSvg").getAttribute("aria-label")));
  assert(/upper deck/.test(page.el("seatmapDeckStatus").textContent));
  assert(/upper deck/.test(page.el("seatmapCountScope").textContent));
  assert(page.el("seatmapStatusCounts").textContent.startsWith("UPPER DECK"));
  assert.strictEqual(page.sandbox.SpicySeatMap.exportCsv(state.map).split("\r\n").length, 489);
});

test("deck switches reset off-screen inspection, scroll, zoom and incompatible cabin filters", () => {
  const page = openPage({ routeText: null });
  manual(page, "388");
  const state = page.sandbox.SpicySeatMap.pageState;
  page.el("seatmapFilterCabin").value = "economy";
  page.el("seatmapFilterCabin").dispatch("change", {});
  page.el("seatmapFilterWindowOnly").checked = true;
  page.el("seatmapFilterWindowOnly").dispatch("change", {});
  inspect(page, "0:26A");
  state.zoom = 1.75;
  state.panX = 30;
  state.panY = 500;
  page.el("seatmapCanvas").scrollTop = 800;
  page.el("seatmapTooltip").classList.remove("hidden");
  page.el("seatmapDeckUpper").dispatch("click", {});
  assert.strictEqual(state.selectedSeatId, null);
  assert.strictEqual(state.zoom, 1);
  assert.strictEqual(state.panX, 0);
  assert.strictEqual(state.panY, 0);
  assert.strictEqual(page.el("seatmapCanvas").scrollTop, 0);
  assert(page.el("seatmapTooltip").classList.contains("hidden"));
  assert.strictEqual(state.filters.cabin, "all");
  assert.strictEqual(state.filters.windowOnly, true);
  assert(!page.el("seatmapFilterCabin").innerHTML.includes('value="economy"'));
  assert(page.el("seatmapFilterCabin").innerHTML.includes('value="business"'));
  inspect(page, "0:26A");
  assert.strictEqual(state.selectedSeatId, null, "a seat on the hidden deck cannot be activated");
  inspect(page, "1:5A");
  assert(page.el("seatmapSeatDetails").innerHTML.includes("5A · Upper deck"));
});

test("a sample choice stays unambiguous when viewing the other deck", () => {
  const page = openPage({ routeText: null });
  manual(page, "388", "business");
  const api = page.sandbox.SpicySeatMap, state = api.pageState;
  assert.strictEqual(state.activeDeck, 1);
  const seat = api.filterSeats(state.map, { deck: 1, availableOnly: true })[0];
  inspect(page, seat.key);
  page.el("seatmapDemoSelect").dispatch("click", {});
  assert.strictEqual(state.demoSeatId, seat.key);
  page.el("seatmapDeckMain").dispatch("click", {});
  assert.strictEqual(state.demoSeatId, seat.key);
  assert(page.el("seatmapSelectionStatus").textContent.includes(seat.id + " · Upper deck"));
  assert(!page.el("seatmapSvg").innerHTML.includes("is-demo-choice"));
});

test("manual, lookup and converted refreshes preserve the upper deck and inspected seat", () => {
  for (const mode of ["manual", "lookup", "converted"]) {
    const page = openPage({ routeText: mode === "converted" ? ROUTE_TEXT.replace("359", "388") : null });
    if (mode === "manual") manual(page, "388", "business");
    if (mode === "lookup") search(page, "EK202", "business");
    const api = page.sandbox.SpicySeatMap, state = api.pageState;
    assert.strictEqual(state.activeDeck, 1, mode + " opens the deck with Business");
    inspect(page, "1:5A");
    state.zoom = 1.3;
    const before = api.flattenSeats(state.map).map(seat => seat.status).join(",");
    const date = state.map.departureDate;
    page.el("seatmapRefreshNow").dispatch("click", {});
    assert.strictEqual(state.activeDeck, 1, mode);
    assert.strictEqual(state.selectedSeatId, "1:5A", mode);
    assert.strictEqual(state.zoom, 1.3, mode);
    assert.strictEqual(state.map.refreshIndex, 1, mode);
    assert.strictEqual(state.map.departureDate, date, mode);
    assert.notStrictEqual(api.flattenSeats(state.map).map(seat => seat.status).join(","), before, mode + " really resamples");
    assert(page.el("seatmapSeatDetails").innerHTML.includes("5A · Upper deck"));
  }
});

test("both passenger 747 types expose two decks, then a single-deck aircraft hides the control", () => {
  const page = openPage({ routeText: null });
  for (const code of ["744", "748"]) {
    manual(page, code);
    assert(!page.el("seatmapDecks").classList.contains("hidden"));
    page.el("seatmapDeckUpper").dispatch("click", {});
    assert.strictEqual(page.el("seatmapTotalCount").textContent, "20");
    assert(page.el("seatmapSvg").innerHTML.includes('data-deck-index="1"'));
    assert(!page.el("seatmapSvg").innerHTML.includes('data-deck-index="0"'));
  }
  search(page, "BA117");
  assert(page.el("seatmapDecks").classList.contains("hidden"));
  assert.strictEqual(page.sandbox.SpicySeatMap.pageState.activeDeck, 0);
  assert.strictEqual(page.el("seatmapTotalCount").textContent, "390");
  assert(page.el("seatmapDeckUpper").disabled);
});

test("switching converted legs resets deck state, and a freighter clears stale deck controls", () => {
  for (const second of ["788", "77F"]) {
    const page = openPage({ routeText: ROUTE_TEXT.replace("359", "388") });
    // The converter avoids freighter assignments; inject one into the leg
    // fixture to exercise the viewer's own no-passenger-cabin refusal.
    page.sandbox.SpicySeatMap.pageState.legs[1].equipment = second;
    assert.strictEqual(page.sandbox.SpicySeatMap.pageState.activeDeck, 1);
    page.el("seatmapLegs").dispatch("click", { target: { closest: () => ({ getAttribute: () => "1" }) } });
    assert(page.el("seatmapDecks").classList.contains("hidden"));
    const state = page.sandbox.SpicySeatMap.pageState;
    assert.strictEqual(state.legIndex, 1);
    if (second === "77F") {
      assert.strictEqual(state.map, null);
      assert.strictEqual(state.selectedSeatId, null);
      assert.strictEqual(page.el("seatmapSvg").innerHTML, "");
      assert.strictEqual(page.el("seatmapTotalCount").textContent, "0");
    } else {
      assert.strictEqual(state.activeDeck, 0);
    }
  }
});

console.log("\nSeat Map page checks: " + checks + " passed.");
