"use strict";
/* test_booking_link.js — a booking link is offered only for one complete
 * converted flight segment, and it opens the matching supported booking site.
 * The tests execute the real BOOKING_LINK block from app.js and use the real
 * SpicyEngine parser/renderer so no parser stub can make an invalid row green.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Engine = require("./spicy_engine.js");

const APP = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const TEMPLATE = fs.readFileSync(path.join(__dirname, "index_template.html"), "utf8");
const BUILT = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const BUILT_APP = fs.readFileSync(path.join(__dirname, "app.html"), "utf8");
const START = APP.indexOf("/* BOOKING_LINK:BEGIN */");
const END = APP.indexOf("/* BOOKING_LINK:END */");
if (START < 0 || END < START) throw new Error("booking-link block markers are missing");
const BOOKING_SRC = APP.slice(START, END + "/* BOOKING_LINK:END */".length);
function embeddedBookingBlock(html) {
  const start = html.indexOf("/* BOOKING_LINK:BEGIN */");
  const end = html.indexOf("/* BOOKING_LINK:END */", start);
  return start < 0 || end < start ? "" : html.slice(start, end + "/* BOOKING_LINK:END */".length);
}

let PASS = 0, FAIL = 0;
function assert(cond, message) {
  if (cond) { PASS++; console.log("PASS:", message); }
  else { FAIL++; console.error("FAIL:", message); }
}
function section(title) { console.log("\n=== " + title + " ==="); }

const NOW = new Date(2026, 9, 5, 12, 0, 0);
function makeOutput(carrier, date, flight, origin, destination, depTime, arrTime) {
  const row = "1 " + (carrier || "AS") + " " + (flight || "100") + " " + (date || "10OCT") + " " +
    (origin || "SEA") + " " + (destination || "LHR") + " " + (depTime || "730A") + " " +
    (arrTime || "800P") + " Y 77W 9.30 4800 N";
  const parsed = Engine.parse(row);
  if (!parsed[0].length) throw new Error("fixture did not parse: " + row + " / " + parsed[1].join("; "));
  return { text: Engine.renderItinerary(parsed[0]), segments: parsed[0], warnings: parsed[1] };
}
function makeSandbox() {
  const classes = new Set();
  const attrs = {};
  const button = {
    disabled: true, title: "", classList: {
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    setAttribute(name, value) { attrs[name] = String(value); },
    _classes: classes, _attrs: attrs
  };
  const opened = [];
  const copied = [];
  const statuses = [];
  const out = { textContent: "" };
  const win = {
    SpicyEngine: Engine,
    open(url, target) {
      const request = { url, target };
      opened.push(request);
      if (!url || url === "about:blank") {
        const tab = { opener: {}, location: { replace(value) { request.finalUrl = value; } } };
        return tab;
      }
      return null;
    }
  };
  const document = {
    body: { appendChild() {}, removeChild() {} },
    createElement() { return { style: {}, value: "", select() {}, remove() {} }; },
    execCommand() { return true; }
  };
  const sandbox = {
    Date, Array, String, Number, Math, RegExp, Object, parseInt, encodeURIComponent,
    window: win,
    navigator: { clipboard: { writeText(value) { copied.push(value); return { catch() {} }; } } },
    document,
    out,
    $: (id) => id === "btnBookingLink" ? button : null,
    setStatus(message, warn) { statuses.push({ message, warn: !!warn }); },
    console
  };
  vm.createContext(sandbox);
  vm.runInContext("var bookingSourceWarnings = []; var bookingSourceDirty = false;", sandbox);
  vm.runInContext(BOOKING_SRC, sandbox, { filename: "booking-link.js" });
  return { sandbox, button, opened, copied, statuses, out, win };
}

section("1. the status-row booking button is safe and eligibility-gated");
const statusStart = TEMPLATE.indexOf('<div class="status">');
const statusEnd = TEMPLATE.indexOf("</div>", statusStart);
const status = TEMPLATE.slice(statusStart, statusEnd);
const aboutAt = status.indexOf('id="btnAbout"');
const bookingAt = status.indexOf('id="btnBookingLink"');
assert(aboutAt >= 0 && bookingAt > aboutAt && status.indexOf('id="genKey"') > bookingAt,
       "BOOKING LINK sits directly beside About, before the existing status actions");
assert(/id="btnBookingLink" class="linkbtn" type="button" disabled/.test(status),
       "the button is a quiet status link and starts disabled");
assert(/#btnBookingLink\.booking-link-ready\{[^}]*color:#72f39b[^}]*box-shadow:[^}]*rgba\(83,217,119/.test(TEMPLATE),
       "an eligible booking link is visibly lit green");
assert(/#btnBookingLink:disabled\{[^}]*cursor:not-allowed/.test(TEMPLATE),
       "ineligible booking links are muted and cannot be clicked");
assert(/if \(\$\("btnBookingLink"\)\) \$\("btnBookingLink"\)\.addEventListener\("click", openBookingLink\)/.test(APP),
       "the real button invokes the link opener");
assert(BUILT.includes('id="btnBookingLink"') && BUILT.includes("function openBookingLink()"),
       "the generated index contains both markup and behavior");
assert(BUILT === BUILT_APP && embeddedBookingBlock(BUILT) === BOOKING_SRC && embeddedBookingBlock(BUILT_APP) === BOOKING_SRC,
       "index.html and app.html both contain the current source booking behavior");
assert(/shares the flight number, origin, destination, and departure date/i.test(TEMPLATE) &&
       /never books or purchases a ticket automatically/i.test(TEMPLATE),
       "the About disclosure names the shared itinerary details and says no booking is automatic");
assert(!BOOKING_SRC.includes("google.com/travel/flights"),
       "unsupported airlines do not fall back to Google Flights");

section("2. dates are valid, future, and resolved safely when GDS omits the year");
const env = makeSandbox();
const ymd = (d) => env.sandbox.bookingLinkDateYmd(d, NOW);
assert(ymd("10OCT") === "2026-10-10", "a future DDMMM date remains in the current year");
assert(ymd("01JAN") === "2027-01-01", "a passed month rolls into the next year");
assert(ymd("29FEB") === "2028-02-29", "leap-day dates resolve to the next real leap year");
assert(ymd("31FEB") === "", "impossible calendar dates are rejected");
assert(env.sandbox.bookingClockValid("730A") && env.sandbox.bookingClockValid("1200N"),
       "valid GDS clocks, including noon, are accepted");
assert(!env.sandbox.bookingClockValid("????") && !env.sandbox.bookingClockValid("1365P"),
       "placeholder and impossible clocks cannot qualify");

section("3. warnings survive caches, and mixed-source results are not reused as single-source conversions");
const cacheStore = Object.create(null);
const cacheSandbox = {
  Date, JSON, Object, Array, Math,
  localStorage: {
    getItem(key) { return Object.prototype.hasOwnProperty.call(cacheStore, key) ? cacheStore[key] : null; },
    setItem(key, value) { cacheStore[key] = String(value); }
  }
};
vm.createContext(cacheSandbox);
const cacheStart = APP.indexOf("var TCACHE_KEY =");
const cacheEnd = APP.indexOf("/* ---------- pre-warm engine ---------- */", cacheStart);
vm.runInContext(APP.slice(cacheStart, cacheEnd), cacheSandbox, { filename: "cache-functions.js" });
vm.runInContext('tCacheSet("text", "gds text", ["unknown airport code XYZ"]); imgCacheSet("image", "gds image", ["flight row NOT read"]);', cacheSandbox);
assert(vm.runInContext('tCacheGet("text").warnings[0]', cacheSandbox) === "unknown airport code XYZ",
       "text-cache entries keep their source warnings");
assert(vm.runInContext('imgCacheGet("image").warnings[0]', cacheSandbox) === "flight row NOT read",
       "image-cache entries keep their source warnings");
const handleFilesCode = APP.slice(APP.indexOf("function handleFiles(fileList)"), APP.indexOf("/* ---------- instant convert ---------- */"));
assert(/lastTextFp = ""/.test(handleFilesCode), "a new attachment invalidates the text-only fast-cache fingerprint");
assert(APP.includes('if (imgs.length === 1 && imgs[0]._hash && !(inp.value || "").trim() && !readyDocuments().length)'),
       "direct image results are cached only when no other source contributed");
assert(APP.includes('if (aiImages.length === 1 && aiDocuments.length === 0 && aiImages[0]._hash && !(text || "").trim())'),
       "AI image results are cached only when no text or document was mixed in");
assert(APP.includes('if (text.trim() && !aiImages.length && !aiDocuments.length)'),
       "AI text results do not pollute the text-only cache when an attachment was present");
assert(/bookingSourceWarnings = aiInputWarnings\.concat\(rr && Array\.isArray\(rr\[1\]\) \? rr\[1\] : \[\]\)/.test(APP),
       "AI output eligibility retains warnings from both the repaired source and AI response");
const attachmentRenderStart = APP.indexOf("function renderAttachmentResults(");
const attachmentRenderEnd = APP.indexOf("function convertImageAttachments(", attachmentRenderStart);
const attachmentRender = APP.slice(attachmentRenderStart, attachmentRenderEnd);
assert(attachmentRender.indexOf("bookingSourceWarnings = warns.slice()") >= 0 &&
       attachmentRender.indexOf("bookingSourceWarnings = warns.slice()") < attachmentRender.indexOf("if (allSegs.length)"),
       "attachment parse warnings are retained before either display or AI fallback");
const inputHandlerStart = APP.indexOf('inp.addEventListener("input"');
const inputHandlerEnd = APP.indexOf('$("btnConvert")', inputHandlerStart);
assert(APP.slice(inputHandlerStart, inputHandlerEnd).includes("invalidateBookingLinkButton();"),
       "any edit immediately makes the old booking action stale");
assert(/if \(currentText !== text\)[\s\S]{0,260}refreshBookingLinkButton/.test(APP),
       "an AI reply for an older text snapshot cannot restore booking eligibility");
assert(/bookingSourceWarnings = \[\];\s*bookingSourceDirty = false;\s*setOut\(""\)/.test(APP),
       "clear resets warning and dirty state before emptying the result");

section("4. only an airline URL carrying an exact flight remains supported")
const sample = makeOutput("AS", "10OCT", "100", "SEA", "LHR");
const carrierLink = env.sandbox.buildSingleSegmentBookingLink(sample.segments[0], "2026-10-10");
const alaskaUrl = new URL(carrierLink.url);
const f1 = alaskaUrl.searchParams.get("F1").split("|");
assert(alaskaUrl.hostname === "www.alaskaair.com" && alaskaUrl.pathname === "/planbook/shoppingstart",
       "the supported link opens Alaska's booking-search handoff");
assert(f1.join("|") === "SEA|LHR|10/10/2026|100|f" && alaskaUrl.searchParams.get("DEST") === "LHR",
       "Alaska's F1 field carries the exact flight number, origin, destination, and travel date");
assert(alaskaUrl.searchParams.get("FT") === "ow" && alaskaUrl.searchParams.get("A") === "1" &&
       alaskaUrl.searchParams.get("C") === "0",
       "the external search defaults disclosed to the user are one-way, one adult, and no children");
assert(carrierLink.site === "Alaska Airlines" && carrierLink.carrier === "AS" &&
       carrierLink.sharedFields.join(",") === "flight number,origin,destination,departure date",
       "the link metadata accurately reports the airline and details passed to it");
assert(!alaskaUrl.searchParams.has("departureTime") && !alaskaUrl.searchParams.has("arrivalTime") &&
       !alaskaUrl.searchParams.has("cabin"),
       "unverified time and cabin parameters are not appended or claimed as prefilled");
assert(!/[?&](?:FARE|price)=/i.test(carrierLink.url),
       "the flight-search link contains no estimated fare or fabricated price");
for (const carrier of ["AA", "BA", "DL", "UA", "ZZ"]) {
  const segment = Object.assign({}, sample.segments[0], { airline: carrier });
  const unsupported = env.sandbox.buildSingleSegmentBookingLink(segment, "2026-10-10");
  assert(!unsupported.eligible && !unsupported.url,
         carrier + " is not misrepresented by a generic route/date link");
}

section("5. one complete, fully-read Alaska segment qualifies; uncertain and unsupported itineraries do not")
const eligible = env.sandbox.bookingLinkFromOutput(sample.text, sample.warnings, NOW);
assert(eligible.eligible && eligible.site === "Alaska Airlines" && eligible.carrier === "AS",
       "one complete Alaska segment qualifies");
assert(new URL(eligible.url).searchParams.get("F1") === "SEA|LHR|10/10/2026|100|f",
       "the eligible URL identifies the flight, route, and exact departure date together");
assert(!env.sandbox.bookingLinkFromOutput(sample.text, ["flight row(s) NOT read"], NOW).eligible,
       "a conversion warning about a dropped segment blocks booking");
assert(!env.sandbox.bookingLinkFromOutput(sample.text, ["unknown airport code(s) XXX"], NOW).eligible,
       "an unknown airport blocks booking");
assert(!env.sandbox.bookingLinkFromOutput(sample.text, ["hidden stop EWR — same flight continues"], NOW).eligible,
       "a hidden stop that represents another leg blocks the single-leg action");
assert(!env.sandbox.bookingLinkFromOutput(sample.text, ["departure time missing"], NOW).eligible,
       "an incomplete itinerary warning blocks booking");
const unsupportedOutput = makeOutput("AA");
assert(!env.sandbox.bookingLinkFromOutput(unsupportedOutput.text, unsupportedOutput.warnings, NOW).eligible,
       "a complete flight on an unsupported airline remains ineligible");
const multiRaw = "1 AS 100 10OCT SEA LHR 730A 800P Y 77W 9.30 4800 N\n" +
                 "2 AS 200 12OCT LHR SEA 900A 1200P Y 77W 9.30 4800 N";
const multiParsed = Engine.parse(multiRaw);
const multiOutput = Engine.renderItinerary(multiParsed[0]);
assert(!env.sandbox.bookingLinkFromOutput(multiOutput, multiParsed[1], NOW).eligible,
       "two flight segments remain ineligible even when both parse");
const invalidOutput = sample.text.replace("730A 800P", "???? ????");
assert(!env.sandbox.bookingLinkFromOutput(invalidOutput, [], NOW).eligible,
       "a visible placeholder cannot enable the button");
assert(!env.sandbox.bookingLinkFromOutput("", [], NOW).eligible,
       "an empty output cannot enable the button");

section("6. the green state follows fresh input; one click opens and copies one whole-itinerary search")
const ui = makeSandbox();
ui.out.textContent = sample.text;
ui.sandbox.refreshBookingLinkButton(sample.text);
assert(!ui.button.disabled && ui.button._classes.has("booking-link-ready") && ui.button._attrs["aria-disabled"] === "false",
       "a qualified output enables and lights the existing green button");
assert(/one-way search for one adult and no children/i.test(ui.button.title) && /Alaska Airlines/.test(ui.button.title) &&
       /sharing flight number 100/.test(ui.button.title) && /No booking or purchase is made/.test(ui.button.title),
       "the enabled-button disclosure names the external site, shared details, and no-purchase behavior");
assert(/flight number 100/.test(ui.button._attrs["aria-description"]),
       "the itinerary-sharing disclosure is also available to assistive technology");
ui.sandbox.invalidateBookingLinkButton();
assert(ui.button.disabled && !ui.button._classes.has("booking-link-ready"),
       "an input edit immediately clears the green state until reconverted");
assert(ui.sandbox.openBookingLink() === false && ui.opened.length === 0 && ui.copied.length === 0,
       "a stale click stays disabled and cannot open or copy the previous itinerary");
vm.runInContext("bookingSourceDirty = false; bookingSourceWarnings = []", ui.sandbox);
ui.sandbox.refreshBookingLinkButton(sample.text);
assert(ui.sandbox.openBookingLink() === true, "one valid click opens the airline search");
assert(ui.opened.length === 1 && ui.opened[0].url === "about:blank" && ui.opened[0].target === "_blank",
       "one itinerary click creates exactly one new tab");
assert(ui.copied.length === 1,
       "one itinerary click performs exactly one copy action");
const openedInfo = ui.sandbox.bookingLinkFromOutput(sample.text, [], NOW);
assert(ui.opened[0].finalUrl === ui.copied[0] && ui.copied[0] === openedInfo.url &&
       new URL(ui.copied[0]).searchParams.get("F1") === "SEA|LHR|10/10/2026|100|f",
       "the single copied/opened URL is the exact flight link for the entire one-segment itinerary");
assert(ui.opened[0].finalUrl.indexOf("/planbook/shoppingstart") >= 0 &&
       !/checkout|purchase|payment/i.test(ui.opened[0].finalUrl),
       "the click opens a search only and never submits a purchase");
assert(ui.statuses[ui.statuses.length - 1].message.includes("FLIGHT DETAILS SHARED") &&
       ui.statuses[ui.statuses.length - 1].message.includes("NO BOOKING OR PURCHASE MADE"),
       "the open status confirms data sharing and that no booking was made");

const blocked = makeSandbox();
blocked.out.textContent = sample.text;
blocked.win.open = () => null;
assert(blocked.sandbox.openBookingLink() === false && blocked.copied.length === 1 &&
       blocked.statuses[blocked.statuses.length - 1].warn,
       "a blocked popup still copies only the one search URL and warns without booking");

console.log(`\n=== SUMMARY: ${PASS} passed, ${FAIL} failed ===`);
if (FAIL) process.exit(1);
