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
const SEATMAP_JS = fs.readFileSync(path.join(ROOT, "seatmap.js"), "utf8");
const GATE_JS = fs.readFileSync(path.join(ROOT, "seatmap_gate.js"), "utf8");
const LAYOUTS_JS = fs.readFileSync(path.join(ROOT, "seatmap_layouts.js"), "utf8");
const DATA_JS = fs.readFileSync(path.join(ROOT, "spicy_data.js"), "utf8");
const Engine = require("./spicy_engine.js");

/** The gate's stored flag: {clicks, unlocked} — what the browser would hold
 *  after a tab has knocked ten times (or not). */
function gateFlag(options) {
  const opts = options || {};
  return JSON.stringify({
    clicks: opts.unlocked === false ? 0 : 10,
    unlocked: opts.unlocked !== false
  });
}

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
  /* The Seat Map is sealed behind the ten-click gate. Every page in this file
     arrives through the open door unless a test asks for a locked tab, so the
     seat-map behaviour under test is the same as the owner's. */
  if (opts.unlocked !== false) store.set("spicy_seatmap_gate", gateFlag(opts));
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
  vm.runInContext(GATE_JS, sandbox, { filename: "seatmap_gate.js" });
  vm.runInContext(DATA_JS, sandbox, { filename: "spicy_data.js" });
  vm.runInContext(LAYOUTS_JS, sandbox, { filename: "seatmap_layouts.js" });
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

/* ---------- a tab that has not knocked ten times ---------- */

test("a sealed tab gets the locked card, not the map", () => {
  const page = openPage({ unlocked: false });
  assert(!page.el("seatmapLock").classList.contains("hidden"), "the sealed card is shown");
  assert(page.el("seatmapContent").classList.contains("hidden"), "the map itself is not");
  assert(page.el("seatmapContent").attributes["aria-hidden"] === "true", "and it is hidden from assistive tech too");
  assert(page.el("seatmapNotice").classList.contains("hidden"), "no 'what this page knows' dialog behind the lock");
  assert(page.el("seatmapSvg").innerHTML === "", "nothing is drawn — no seats, no cabin, no legend");
  assert(page.el("seatmapStripSource").textContent === "", "and the converted flight is not leaked into the lock screen");
  assert(/SEALED/.test(page.doc.body.className) === false, "the page still owns the screen (seatmap-active)");
});

test("the locked card counts the clicks this tab has already made", () => {
  const page = openPage({ unlocked: false });
  const count = page.el("seatmapLockCount").textContent;
  assert(count === "0 / 10", "a fresh tab has knocked zero times (found: " + count + ")");
});

test("a missing gate module leaves the page locked, never open", () => {
  const doc = makeDocument();
  const sandbox = {
    console, document: doc, location: { pathname: "/seatmap", search: "" }, navigator: {},
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {},
    SpicyEngine: Engine, Date, JSON, Math, Number, String, Array, Object, RegExp, Set, Map,
    isFinite, parseInt, parseFloat, encodeURIComponent
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(LAYOUTS_JS, sandbox, { filename: "seatmap_layouts.js" });
  vm.runInContext(SEATMAP_JS, sandbox, { filename: "seatmap.js" });   // no gate module at all
  assert(!doc.getElementById("seatmapLock").classList.contains("hidden"), "the lock wins when the gate is absent");
  assert(doc.getElementById("seatmapSvg").innerHTML === "", "and no map is drawn");
});

test("the gate's flag holds a count and nothing else", () => {
  const page = openPage({});
  const raw = page.store.get("spicy_seatmap_gate") || "";
  assert(raw.indexOf("spicy") < 0 && raw.indexOf("QR 704") < 0, "no itinerary is written to the gate key");
  assert(Object.keys(JSON.parse(raw)).sort().join(",") === "clicks,unlocked", "only clicks and unlocked live there");
});

console.log("\nSeat Map page checks: " + checks + " passed.");
