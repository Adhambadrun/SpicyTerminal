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
const START = APP.indexOf("/* BOOKING_LINK:BEGIN */");
const END = APP.indexOf("/* BOOKING_LINK:END */");
if (START < 0 || END < START) throw new Error("booking-link block markers are missing");
const BOOKING_SRC = APP.slice(START, END + "/* BOOKING_LINK:END */".length);

let PASS = 0, FAIL = 0;
function assert(cond, message) {
  if (cond) { PASS++; console.log("PASS:", message); }
  else { FAIL++; console.error("FAIL:", message); }
}
function section(title) { console.log("\n=== " + title + " ==="); }

const NOW = new Date(2026, 9, 5, 12, 0, 0);
function makeOutput(carrier, date, flight) {
  const row = "1 " + (carrier || "AA") + " " + (flight || "100") + " " + (date || "10OCT") +
    " JFK LHR 730A 800P Y 77W 7.30 3452 N";
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
       "the committed single-file app contains both markup and behavior");

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

section("4. booking links use a vetted site per supported carrier, with a search fallback");
const sample = makeOutput("AA");
const providers = [
  ["AA", "www.aa.com", "tripType=oneWay"],
  ["BA", "www.britishairways.com", "processOffer"],
  ["DL", "www.delta.com", "tripType=ONE_WAY"],
  ["UA", "www.united.com", "choose-flights"],
  ["AS", "www.alaskaair.com", "FT=ow"]
];
for (const [carrier, domain, marker] of providers) {
  const segment = Object.assign({}, sample.segments[0], { airline: carrier });
  const carrierLink = env.sandbox.buildSingleSegmentBookingLink(segment, "2026-10-10");
  assert(new URL(carrierLink.url).hostname === domain && carrierLink.url.includes(marker),
         carrier + " routes to its supported booking website");
  assert(!/[?&](?:FARE|price)=/i.test(carrierLink.url), carrier + " link contains no estimated fare or fabricated price");
}
const fallback = env.sandbox.buildSingleSegmentBookingLink(
  Object.assign({}, sample.segments[0], { airline: "ZZ" }), "2026-10-10"
);
assert(new URL(fallback.url).hostname === "www.google.com" && fallback.url.includes("travel/flights"),
       "an airline without a direct-site adapter falls back only to Google Flights");
assert(fallback.url.includes("JFK") && fallback.url.includes("LHR") && fallback.url.includes("2026-10-10"),
       "the fallback retains both airports and the exact departure date");

section("5. only one complete, fully-read segment turns the action green");
const eligible = env.sandbox.bookingLinkFromOutput(sample.text, sample.warnings, NOW);
assert(eligible.eligible && eligible.site === "American Airlines", "one complete AA segment qualifies");
assert(eligible.url.includes("JFK") && eligible.url.includes("LHR") && eligible.url.includes("2026-10-10"),
       "the airline link is populated with route and date");
assert(!env.sandbox.bookingLinkFromOutput(sample.text, ["flight row(s) NOT read"], NOW).eligible,
       "a conversion warning about a dropped segment blocks booking");
assert(!env.sandbox.bookingLinkFromOutput(sample.text, ["unknown airport code(s) XXX"], NOW).eligible,
       "an unknown airport blocks booking");
const multiRaw = "1 AA 100 10OCT JFK LHR 730A 800P Y 77W 7.30 3452 N\n" +
                 "2 BA 200 12OCT LHR JFK 900A 1200P Y 77W 7.30 3452 N";
const multiParsed = Engine.parse(multiRaw);
const multiOutput = Engine.renderItinerary(multiParsed[0]);
assert(!env.sandbox.bookingLinkFromOutput(multiOutput, multiParsed[1], NOW).eligible,
       "two flight segments remain ineligible even when both parse");
const invalidOutput = sample.text.replace("730A 800P", "???? ????");
assert(!env.sandbox.bookingLinkFromOutput(invalidOutput, [], NOW).eligible,
       "a visible placeholder cannot enable the button");
assert(!env.sandbox.bookingLinkFromOutput("", [], NOW).eligible,
       "an empty output cannot enable the button");

section("6. button state follows conversion freshness and click opens/copies the website link");
const ui = makeSandbox();
ui.out.textContent = sample.text;
ui.sandbox.refreshBookingLinkButton(sample.text);
assert(!ui.button.disabled && ui.button._classes.has("booking-link-ready") && ui.button._attrs["aria-disabled"] === "false",
       "a qualified output enables and lights the real button");
assert(/American Airlines/.test(ui.button.title), "the enabled-button hint names the booking destination");
vm.runInContext("bookingSourceDirty = true", ui.sandbox);
ui.sandbox.refreshBookingLinkButton(sample.text);
assert(ui.button.disabled && !ui.button._classes.has("booking-link-ready"),
       "editing the input immediately clears the green state until it is converted again");
vm.runInContext("bookingSourceDirty = false; bookingSourceWarnings = []", ui.sandbox);
assert(ui.sandbox.openBookingLink() === true, "a valid click opens the destination in a new tab");
assert(ui.opened[0].url === "about:blank" && ui.opened[0].target === "_blank", "the popup starts safely in a new tab");
const openedInfo = ui.sandbox.bookingLinkFromOutput(sample.text, [], new Date());
assert(ui.opened[0].finalUrl === ui.copied[0] && ui.copied[0] === openedInfo.url,
       "the exact generated booking URL is opened and copied");
assert(ui.statuses[ui.statuses.length - 1].message.includes("AMERICAN AIRLINES BOOKING SEARCH"),
       "the app reports which booking website opened");

ui.win.open = () => null;
assert(ui.sandbox.openBookingLink() === false && ui.statuses[ui.statuses.length - 1].warn,
       "a blocked popup is disclosed and the generated link remains copied");

console.log(`\n=== SUMMARY: ${PASS} passed, ${FAIL} failed ===`);
if (FAIL) process.exit(1);
