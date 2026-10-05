"use strict";
/* test_booking_link.js — a booking link is offered only for a complete,
 * certain itinerary on one bookable airline (AA / DL / AS / UA / BA, one or
 * several legs), and it opens that airline's own checkout handoff built by
 * the real spicy_links.js engine. The tests execute the real BOOKING_LINK
 * block from app.js and use the real SpicyEngine parser/renderer so no parser
 * stub can make an invalid row green.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Engine = require("./spicy_engine.js");
const Links = require("./spicy_links.js");

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
function makeMultiOutput(rows) {
  const parsed = Engine.parse(rows);
  if (parsed[0].length !== rows.trim().split(/\r?\n/).length) {
    throw new Error("fixture rows did not all parse: " + parsed[1].join("; "));
  }
  return { text: Engine.renderItinerary(parsed[0]), segments: parsed[0], warnings: parsed[1] };
}
function makeSandbox(withLinks) {
  if (withLinks === undefined) withLinks = true;
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
  if (withLinks) win.SpicyLinks = Links;
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
assert(/window\.SpicyLinks/.test(BUILT) && BUILT.indexOf("function linkFor(engineSegs, nowMs)") >= 0,
       "the built page inlines the spicy_links.js checkout engine ahead of the app");
assert(/shares the itinerary details/i.test(TEMPLATE) &&
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

section("4. each bookable airline gets its own checkout handoff, described honestly");
const sample = makeOutput("AS", "10OCT", "100", "SEA", "LHR");
const asDetails = env.sandbox.bookingLinkFromOutput(sample.text, sample.warnings, NOW);
assert(asDetails.eligible && asDetails.site === "Alaska Airlines" && asDetails.carrier === "AS",
       "one complete Alaska segment qualifies");
const alaskaUrl = new URL(asDetails.url);
const f1 = alaskaUrl.searchParams.get("F1").split("|");
assert(alaskaUrl.hostname === "www.alaskaair.com" && alaskaUrl.pathname === "/planbook/shoppingstart",
       "the Alaska link opens Alaska's booking-search handoff");
assert(f1.join("|") === "SEA|LHR|10/10/2026|100|f" && alaskaUrl.searchParams.get("DEST") === "LHR",
       "Alaska's F1 field carries the exact flight number, origin, destination, and travel date");
assert(alaskaUrl.searchParams.get("FT") === "ow" && alaskaUrl.searchParams.get("A") === "1" &&
       alaskaUrl.searchParams.get("C") === "0",
       "the Alaska search defaults disclosed to the user are one-way, one adult, and no children");
assert(/^\d+(\.\d+)?$/.test(alaskaUrl.searchParams.get("FARE") || ""),
       "the Alaska handoff carries an estimated total, disclosed as an estimate");
assert(!alaskaUrl.searchParams.has("departureTime") && !alaskaUrl.searchParams.has("cabin"),
       "unverified time and cabin parameters are still not appended or claimed as prefilled");
assert(asDetails.exact === true && asDetails.sharedFields.join(",").includes("flight numbers"),
       "the Alaska metadata reports the airline and the details it shares");

const aaOutput = makeOutput("AA", "10OCT", "123", "JFK", "LAX");
const aaDetails = env.sandbox.bookingLinkFromOutput(aaOutput.text, aaOutput.warnings, NOW);
assert(aaDetails.eligible && aaDetails.site === "American Airlines", "a complete American segment qualifies");
const aaUrl = new URL(aaDetails.url);
const iten = decodeURIComponent(aaUrl.searchParams.get("ITEN") || "");
assert(aaUrl.hostname === "www.aa.com" && aaUrl.pathname === "/goto/metasearch",
       "the American link opens aa.com metasearch");
assert(iten.includes("#AA|123|Y|JFK|LAX|") && iten.includes("#JFK|LAX|0|0|"),
       "the ITEN payload pins the exact American flight, route and departure stamp");

const dlOutput = makeOutput("DL", "10OCT", "456", "JFK", "LAX");
const dlDetails = env.sandbox.bookingLinkFromOutput(dlOutput.text, dlOutput.warnings, NOW);
assert(dlDetails.eligible && dlDetails.site === "Delta", "a complete Delta segment qualifies");
const dlUrl = new URL(dlDetails.url);
assert(dlUrl.hostname === "www.delta.com" && dlUrl.pathname === "/completepurchase/trip-summary",
       "the Delta link opens Delta's trip summary");
assert((dlUrl.searchParams.get("itinSegment[0]") || "").includes("JFK:LAX:DL:456"),
       "the Delta summary carries the exact flight");
assert(/^\d+(\.\d+)?$/.test(dlUrl.searchParams.get("price") || ""),
       "the Delta summary's price parameter is a disclosed estimate");

const uaOutput = makeOutput("UA", "10OCT", "789", "SFO", "ORD");
const uaDetails = env.sandbox.bookingLinkFromOutput(uaOutput.text, uaOutput.warnings, NOW);
assert(uaDetails.eligible && uaDetails.site === "United", "a complete United segment qualifies");
const uaUrl = new URL(uaDetails.url);
assert(uaUrl.hostname === "www.united.com" && uaUrl.searchParams.get("f") === "SFO" &&
       uaUrl.searchParams.get("t") === "ORD" && uaUrl.searchParams.get("d") === "2026-10-10",
       "the United link searches the first leg and date");
assert(uaDetails.exact === false, "the United disclosure admits exact flights are not pinned");

const baOutput = makeOutput("BA", "10OCT", "117", "LHR", "JFK");
const baDetails = env.sandbox.bookingLinkFromOutput(baOutput.text, baOutput.warnings, NOW);
assert(baDetails.eligible && baDetails.site === "British Airways", "a complete British Airways segment qualifies");
const baUrl = new URL(baDetails.url);
assert(baUrl.hostname === "www.britishairways.com" &&
       (baUrl.searchParams.get("onds") || "").startsWith("LHR-JFK_2026-10-10"),
       "the BA link carries the route and date");
assert(baDetails.exact === false, "the BA disclosure admits exact flights are not pinned");

const tkOutput = makeOutput("TK", "10OCT", "615", "IST", "JFK");
const tkDetails = env.sandbox.bookingLinkFromOutput(tkOutput.text, tkOutput.warnings, NOW);
assert(!tkDetails.eligible && /isn't bookable here/.test(tkDetails.reason),
       "an unsupported airline stays disabled with a plain reason");
const noLinks = makeSandbox(false);
const engineGone = noLinks.sandbox.bookingLinkFromOutput(sample.text, sample.warnings, NOW);
assert(!engineGone.eligible && /engine is unavailable/.test(engineGone.reason),
       "a missing link engine degrades to a clear refusal instead of a fake link");

section("5. multi-leg trips on one bookable airline qualify; mixed bookable airlines do not");
const multi = makeMultiOutput(
  "1 AS 100 10OCT SEA LHR 730A 800P Y 77W 9.30 4800 N\n" +
  "2 AS 200 12OCT LHR SEA 900A 1200P Y 77W 9.30 4800 N");
const multiDetails = env.sandbox.bookingLinkFromOutput(multi.text, multi.warnings, NOW);
assert(multiDetails.eligible && multiDetails.carrier === "AS" && multiDetails.legs === 2,
       "a two-leg Alaska round trip qualifies as one checkout");
const multiUrl = new URL(multiDetails.url);
assert(multiUrl.searchParams.get("FT") === "rt" &&
       multiUrl.searchParams.get("F2") === "LHR|SEA|10/12/2026|200|f",
       "both legs ride in the Alaska handoff (F1 + F2, round trip)");
assert(multiDetails.flight === "AS 100, AS 200", "the disclosure lists every linked flight");

const mixed = makeMultiOutput(
  "1 AA 100 10OCT JFK LAX 730A 1100A Y 321 5.30 2475 N\n" +
  "2 DL 456 12OCT LAX JFK 900A 530P Y 321 5.30 2475 N");
const mixedDetails = env.sandbox.bookingLinkFromOutput(mixed.text, mixed.warnings, NOW);
assert(!mixedDetails.eligible && /Mixed bookable airlines/.test(mixedDetails.reason),
       "two bookable airlines in one itinerary cannot share a checkout");

const mixedOne = makeMultiOutput(
  "1 TK 615 10OCT IST JFK 900A 1100A Y 77W 10.10 5000 N\n" +
  "2 BA 178 15OCT JFK LHR 700P 700A J 77W 6.50 3450 N");
const mixedOneDetails = env.sandbox.bookingLinkFromOutput(mixedOne.text, mixedOne.warnings, NOW);
assert(mixedOneDetails.eligible && mixedOneDetails.carrier === "BA" && mixedOneDetails.flight === "BA 178",
       "a mixed itinerary with exactly one bookable airline links that airline's legs only");
assert(/BA segments only/.test(mixedOneDetails.note || ""),
       "the disclosure says only the BA legs are linked");

assert(!env.sandbox.bookingLinkFromOutput(sample.text, ["flight row(s) NOT read"], NOW).eligible,
       "a conversion warning about a dropped segment blocks booking");
assert(!env.sandbox.bookingLinkFromOutput(sample.text, ["unknown airport code(s) XXX"], NOW).eligible,
       "an unknown airport blocks booking");
assert(!env.sandbox.bookingLinkFromOutput(sample.text, ["hidden stop EWR — same flight continues"], NOW).eligible,
       "a hidden stop that represents another leg blocks the action");
assert(!env.sandbox.bookingLinkFromOutput(sample.text, ["departure time missing"], NOW).eligible,
       "an incomplete itinerary warning blocks booking");
const invalidOutput = sample.text.replace("730A 800P", "???? ????");
assert(!env.sandbox.bookingLinkFromOutput(invalidOutput, [], NOW).eligible,
       "a visible placeholder cannot enable the button");
assert(!env.sandbox.bookingLinkFromOutput("", [], NOW).eligible,
       "an empty output cannot enable the button");

section("6. the green state follows fresh input; one click opens and copies one whole-itinerary search");
const ui = makeSandbox();
ui.out.textContent = sample.text;
ui.sandbox.refreshBookingLinkButton(sample.text);
assert(!ui.button.disabled && ui.button._classes.has("booking-link-ready") && ui.button._attrs["aria-disabled"] === "false",
       "a qualified output enables and lights the existing green button");
assert(/alaskaair\.com search/i.test(ui.button.title) &&
       /route, date and flight number/i.test(ui.button.title) &&
       /No booking or purchase is made/i.test(ui.button.title),
       "the enabled-button disclosure names the external site, shared details, and no-purchase behavior");
assert(/AS 100/.test(ui.button._attrs["aria-label"]) && /SEA to LHR/.test(ui.button._attrs["aria-label"]) &&
       /2026-10-10/.test(ui.button._attrs["aria-label"]),
       "the button label names the linked flight, route and date");
assert(/route, date and flight number/.test(ui.button._attrs["aria-description"]),
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
       "the single copied/opened URL is the exact flight link for the entire itinerary");
assert(ui.opened[0].finalUrl.indexOf("/planbook/shoppingstart") >= 0 &&
       !/checkout|purchase|payment/i.test(ui.opened[0].finalUrl),
       "the Alaska click opens a search only and never submits a purchase");
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
