/* ==========================================================================
   spicy_links.js — SpicyTerminal booking-link engine (offline, no DOM).

   Turns the CURRENT converted itinerary into a direct airline checkout /
   booking link, the same links SpicyLinkGenerator builds — but fed with
   SpicyEngine segments directly, so no GDS text is re-parsed and no leg can
   be silently dropped or mis-read on the way in.

   One entry point:  SpicyLinks.linkFor(engineSegs) ->
     { eligible:true,  carrier:"DL", kind:"delta", url:"...", label:"..." }
     { eligible:false, reason:"why not (shown in the status line)" }

   Booking checkouts supported (one marketing carrier per link):
     AA -> aa.com metasearch (embeds every flight)      kind "aa-meta"
     DL -> delta.com completepurchase trip summary      kind "delta"
     AS -> alaskaair.com planbook shoppingstart         kind "alaska"
     UA -> united.com choose-flights (first leg+dates)  kind "united"
     BA -> britishairways.com processOffer              kind "ba"

   Deliberate deviations from the SpicyLinkGenerator source this was ported
   from (SpicyLinkGenerator-main.zip, app.html):
     * ES5 throughout (no const/let/arrow/Set/BigInt/TextEncoder), matching
       spicy_engine.js, so the single-file page runs on the same browsers.
     * Passengers are fixed at 1 adult — SpicyTerminal has no passenger UI.
     * DDMMM years roll to the next year only when the DATE (not the time) is
       past; the source rolled same-day trips a year forward by accident.
     * Time-zone offsets and coordinates fall back to SPICY_DATA (1,600+
       airports) when the ported 40-airport table has no entry, instead of
       silently assuming +00:00 / a 500-mile leg.
     * Search-only builders (Google Flights, ITA Matrix, AA find-flights) and
       the BookWithMatrix JSON are NOT ported: this module builds ONLY the
       booking link, nothing else.

   Requires: spicy_data.js (SPICY_DATA) for the tz/coordinate fallback.
   Pure logic — safe to require() from node tests.
   ========================================================================== */
(function () {
"use strict";

var D = (typeof SPICY_DATA !== "undefined") ? SPICY_DATA
        : require("./spicy_data.js");

/* ---------------- who can be booked ---------------- */
var BOOKABLE = { AA: 1, DL: 1, AS: 1, UA: 1, BA: 1 };
var BOOKABLE_LIST = ["AA", "DL", "AS", "UA", "BA"];
var KIND_OF = { AA: "aa-meta", DL: "delta", AS: "alaska", UA: "united", BA: "ba" };
var LABEL_OF = {
  AA: "American Airlines checkout (aa.com metasearch, exact flights)",
  DL: "Delta checkout (delta.com trip summary)",
  AS: "Alaska checkout (alaskaair.com)",
  UA: "United search (united.com, first leg + dates)",
  BA: "British Airways checkout (ba.com offer)"
};

/* ---------------- airport table (ported) ---------------- */
var AP_DB = {
  PHX: { city: "Phoenix", tz: "-07:00", lat: 33.4342, lon: -112.0116 },
  LHR: { city: "London", tz: "+00:00", lat: 51.47, lon: -0.4543 },
  LIS: { city: "Lisbon", tz: "+00:00", lat: 38.7813, lon: -9.1359 },
  PRG: { city: "Prague", tz: "+01:00", lat: 50.1008, lon: 14.2632 },
  DUB: { city: "Dublin", tz: "+00:00", lat: 53.4213, lon: -6.2701 },
  YYZ: { city: "Toronto", tz: "-05:00", lat: 43.6777, lon: -79.6248 },
  JFK: { city: "New York", tz: "-05:00", lat: 40.6413, lon: -73.7781 },
  CLT: { city: "Charlotte", tz: "-05:00", lat: 35.214, lon: -80.9431 },
  CUN: { city: "Cancun", tz: "-05:00", lat: 21.0365, lon: -86.877 },
  IST: { city: "Istanbul", tz: "+03:00", lat: 41.2753, lon: 28.7519 },
  FCO: { city: "Rome", tz: "+01:00", lat: 41.8003, lon: 12.2389 },
  IAH: { city: "Houston", tz: "-06:00", lat: 29.9902, lon: -95.3368 },
  LAX: { city: "Los Angeles", tz: "-08:00", lat: 33.9416, lon: -118.4085 },
  SFO: { city: "San Francisco", tz: "-08:00", lat: 37.6213, lon: -122.379 },
  SEA: { city: "Seattle", tz: "-08:00", lat: 47.4502, lon: -122.3088 },
  ORD: { city: "Chicago", tz: "-06:00", lat: 41.9742, lon: -87.9073 },
  DFW: { city: "Dallas", tz: "-06:00", lat: 32.8998, lon: -97.0403 },
  MIA: { city: "Miami", tz: "-05:00", lat: 25.7959, lon: -80.287 },
  BOS: { city: "Boston", tz: "-05:00", lat: 42.3656, lon: -71.0096 },
  DEN: { city: "Denver", tz: "-07:00", lat: 39.8561, lon: -104.6737 },
  LAS: { city: "Las Vegas", tz: "-08:00", lat: 36.084, lon: -115.1537 },
  MSP: { city: "Minneapolis", tz: "-06:00", lat: 44.8848, lon: -93.2223 },
  CDG: { city: "Paris", tz: "+01:00", lat: 49.0097, lon: 2.5479 },
  FRA: { city: "Frankfurt", tz: "+01:00", lat: 50.0379, lon: 8.5622 },
  AMS: { city: "Amsterdam", tz: "+01:00", lat: 52.3105, lon: 4.7683 },
  MAD: { city: "Madrid", tz: "+01:00", lat: 40.4983, lon: -3.5676 },
  BCN: { city: "Barcelona", tz: "+01:00", lat: 41.2974, lon: 2.0833 },
  MEX: { city: "Mexico City", tz: "-06:00", lat: 19.4363, lon: -99.0721 },
  SJD: { city: "San Jose del Cabo", tz: "-07:00", lat: 23.1518, lon: -109.7212 },
  ATH: { city: "Athens", tz: "+02:00", lat: 37.9364, lon: 23.9445 },
  PSP: { city: "Palm Springs", tz: "-08:00", lat: 33.8297, lon: -116.5067 },
  DCA: { city: "Washington", tz: "-05:00", lat: 38.8521, lon: -77.0377 },
  HPN: { city: "White Plains", tz: "-05:00", lat: 41.067, lon: -73.7076 },
  MCO: { city: "Orlando", tz: "-05:00", lat: 28.4294, lon: -81.309 },
  VIE: { city: "Vienna", tz: "+01:00", lat: 48.1103, lon: 16.5697 },
  CPH: { city: "Copenhagen", tz: "+01:00", lat: 55.618, lon: 12.6508 },
  CAI: { city: "Cairo", tz: "+02:00", lat: 30.1219, lon: 31.4056 }
};

function pad(n) { n = String(n); return n.length >= 2 ? n : "0" + n; }

function tzOffsetMin(code) {
  var row = AP_DB[code], tz = row ? row.tz : "";
  if (!tz && D && D.airports && D.airports[code] &&
      typeof D.airports[code].off === "number") {
    /* Standard offset hours (same approximation class as the ported table,
       which also ignores DST) — but covering every airport the engine knows
       instead of defaulting them all to +00:00. */
    var off = D.airports[code].off;
    var a = Math.abs(off);
    var hh = Math.floor(a), mm = Math.round((a - hh) * 60);
    if (mm === 60) { hh++; mm = 0; }
    tz = (off < 0 ? "-" : "+") + pad(hh) + ":" + pad(mm);
  }
  if (!tz) tz = "+00:00";
  var m = /^([+-])(\d{2}):?(\d{2})?/.exec(tz);
  if (!m) return 0;
  var v = (+m[2]) * 60 + (m[3] ? (+m[3]) : 0);
  return m[1] === "-" ? -v : v;
}

function coords(code) {
  var row = AP_DB[code];
  if (row && row.lat && row.lon) return row;
  if (D && D.airports && D.airports[code]) {
    var a = D.airports[code];
    if (a.lat && a.lon) return { lat: a.lat, lon: a.lon };
  }
  return null;
}

/* ---------------- cabins (ported) ---------------- */
var CABIN_MAP = {
  EI: { first: "FA", business: "JCDIZ", premium: "WE" },
  BA: { first: "FA", business: "JCDRI", premium: "WET" },
  AA: { first: "FAP", business: "JCDIR", premium: "W" },
  UA: { first: "FA", business: "JCDZP", premium: "OAR" },
  DL: { first: "FAPG", business: "JCDIZ", premium: "WSY" },
  LH: { first: "FA", business: "JCDZP", premium: "GEN" },
  EK: { first: "FAP", business: "JCDIOR", premium: "WE" }
};
function cabinForCarrier(carrier, cls) {
  if (!cls) return "COACH";
  var c = String(cls).toUpperCase().charAt(0);
  var m = CABIN_MAP[carrier];
  if (m) {
    if (m.first.indexOf(c) >= 0) return "FIRST";
    if (m.business.indexOf(c) >= 0) return "BUSINESS";
    if (m.premium.indexOf(c) >= 0) return "PREMIUM-COACH";
    return "COACH";
  }
  if ("FAP".indexOf(c) >= 0) return "FIRST";
  if ("JCDIZR".indexOf(c) >= 0) return "BUSINESS";
  if ("WE".indexOf(c) >= 0) return "PREMIUM-COACH";
  return "COACH";
}

/* ---------------- fare estimate (ported; feeds the price params) ---------------- */
var US_AP = { PHX: 1, JFK: 1, LGA: 1, EWR: 1, BOS: 1, DCA: 1, IAD: 1, ORD: 1, ATL: 1, MIA: 1, MCO: 1, CLT: 1, DFW: 1, IAH: 1, DEN: 1, LAX: 1, SFO: 1, SEA: 1, LAS: 1, SLC: 1, MSP: 1, DTW: 1, HPN: 1, SAN: 1, PDX: 1 };
var UK_AP = { LHR: 1, LGW: 1, LCY: 1, MAN: 1, EDI: 1, STN: 1 };
var EU_AP = { LIS: 1, PRG: 1, DUB: 1, MAD: 1, BCN: 1, FCO: 1, AMS: 1, CDG: 1, FRA: 1, MUC: 1, ZRH: 1, GVA: 1, BRU: 1, VIE: 1, CPH: 1, IST: 1, WAW: 1, ATH: 1 };
var LATAM_AP = { CUN: 1, MEX: 1, SJD: 1, GRU: 1, EZE: 1, SCL: 1, BOG: 1, LIM: 1, PTY: 1, PUJ: 1 };
var YQ_CARRIERS = { BA: 1, EI: 1, IB: 1, LH: 1, AF: 1, KL: 1, VS: 1, QR: 1, EK: 1, TK: 1, SQ: 1, CX: 1, AY: 1, SK: 1, LX: 1, OS: 1, SN: 1 };

function region(s) {
  var ou = !!US_AP[s.origin], du = !!US_AP[s.dest];
  var oe = !!(EU_AP[s.origin] || UK_AP[s.origin]);
  var de = !!(EU_AP[s.dest] || UK_AP[s.dest]);
  var ol = !!LATAM_AP[s.origin], dl = !!LATAM_AP[s.dest];
  if (ou && du) return "DOM_US";
  if (oe && de) return "DOM_EU";
  if ((ou && de) || (oe && du)) return "TRANSATL";
  if (ol || dl) return "LATAM";
  return "DEFAULT";
}
function baseFare(reg, cab) {
  var t = {
    DOM_US: { FIRST: 1200, BUSINESS: 750, "PREMIUM-COACH": 450 },
    DOM_EU: { FIRST: 900, BUSINESS: 500, "PREMIUM-COACH": 300 },
    TRANSATL: { FIRST: 5000, BUSINESS: 2500, "PREMIUM-COACH": 900 },
    LATAM: { FIRST: 2000, BUSINESS: 1200, "PREMIUM-COACH": 700 },
    DEFAULT: { FIRST: 3000, BUSINESS: 1500, "PREMIUM-COACH": 700 }
  };
  if (t[reg] && t[reg][cab]) return t[reg][cab];
  return reg === "DOM_US" ? 250 : reg === "DOM_EU" ? 150
       : reg === "TRANSATL" ? 500 : reg === "LATAM" ? 400 : 400;
}
function haversine(o, d) {
  var a = coords(o), b = coords(d);
  if (!a || !b) return 0;
  var R = 3958.8, rad = Math.PI / 180;
  var la1 = a.lat * rad, lo1 = a.lon * rad, la2 = b.lat * rad, lo2 = b.lon * rad;
  var s1 = Math.sin((la2 - la1) / 2), s2 = Math.sin((lo2 - lo1) / 2);
  var h = s1 * s1 + Math.cos(la1) * Math.cos(la2) * s2 * s2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}
function segmentFare(s) {
  var cab = cabinForCarrier(s.carrier, s.cls);
  var b = baseFare(region(s), cab);
  var d = haversine(s.origin, s.dest) || 500;
  var adj = 0.9 + 0.1 * Math.min(d, 6000) / 6000;
  return Math.round(b * adj * 100) / 100;
}
function estimate(segs) {
  var i, baseF = 0;
  for (i = 0; i < segs.length; i++) baseF += segmentFare(segs[i]);
  baseF = Math.round(baseF * 100) / 100;
  var transatl = false, usLegs = 0, usDep = 0, ukDep = 0, dub = false, mx = false, fuel = false;
  for (i = 0; i < segs.length; i++) {
    var s = segs[i];
    if (region(s) === "TRANSATL") transatl = true;
    if (US_AP[s.origin] || US_AP[s.dest]) usLegs++;
    if (US_AP[s.origin]) usDep++;
    if (UK_AP[s.origin]) ukDep++;
    if (s.origin === "DUB" || s.dest === "DUB") dub = true;
    if (s.dest === "CUN" || s.dest === "MEX" || s.dest === "SJD") mx = true;
    if (YQ_CARRIERS[s.carrier]) fuel = fuel || transatl;
  }
  /* `fuel` must mean "a YQ carrier on a transatlantic leg": the source checks
     `transatl && carrier` per segment, which is the same thing once any leg
     is transatlantic — recompute honestly instead of porting the order bug. */
  fuel = false;
  if (transatl) {
    for (i = 0; i < segs.length; i++)
      if (YQ_CARRIERS[segs[i].carrier]) { fuel = true; break; }
  }
  var taxes = [];
  function add(code, name, amount) {
    if (amount > 0) taxes.push({ code: code, name: name, amount: Math.round(amount * 100) / 100 });
  }
  if (usLegs > 0) {
    add("US", transatl ? "US International Departure Tax" : "US Transportation Tax",
        transatl ? 46.80 : Math.round(baseF * 0.075 * 100) / 100);
    add("AY", "US Passenger Civil Aviation Security Service Fee", 5.60 * usLegs);
    add("XF", "US Passenger Facility Charge", 4.50 * usDep);
  }
  if (ukDep > 0) {
    add("GB", "United Kingdom Air Passenger Duty", ukDep * (transatl ? 91 : 26));
    add("UB", "United Kingdom Passenger Service Charge", ukDep * 50.70);
  }
  if (dub) add("UP", "Ireland Passenger Charge", 13.00);
  if (mx) add("UK", "Mexico Tourism Tax", 56.24);
  if (fuel) add("YQ", "Carrier fuel surcharge", 262.00);
  taxes.sort(function (a, b) { return b.amount - a.amount; });
  var taxTotal = 0;
  for (i = 0; i < taxes.length; i++) taxTotal += taxes[i].amount;
  taxTotal = Math.round(taxTotal * 100) / 100;
  return { baseF: baseF, taxes: taxes, taxTotal: taxTotal,
           total: Math.round((baseF + taxTotal) * 100) / 100 };
}

/* Stable fare-basis filler for the Delta URL (the source used BigInt FNV-1a;
   this is the same idea in 32-bit arithmetic — the value is a filler either
   way, it just has to be deterministic per flight). */
function fareBasis(cls, carrier, num) {
  var src = String(carrier) + String(num);
  var h = 0x811c9dc5, i;
  for (i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = ((h * 0x01000193) >>> 0);
  }
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", out = "";
  for (i = 0; i < 6; i++) {
    out += chars.charAt(h % 36);
    h = ((h * 1664525 + 1013904223) >>> 0);
  }
  return (cls || "Y") + out;
}

/* ---------------- engine-segment adapter ---------------- */
var MONTH_IDX = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
                  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/* "26AUG" -> "YYYY-MM-DD": the upcoming occurrence of that day. nowMs is
   injectable so tests can freeze time. */
function ymdFromDdmmm(ddmmm, nowMs) {
  var m = /^(\d{1,2})([A-Z]{3})$/.exec(String(ddmmm || "").toUpperCase());
  if (!m || MONTH_IDX[m[2]] === undefined) return "";
  var d = +m[1], mo = MONTH_IDX[m[2]];
  if (d < 1 || d > 31) return "";
  var now = new Date(nowMs != null ? nowMs : Date.now());
  var y = now.getFullYear();
  var todayNum = y * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  var candNum = y * 10000 + (mo + 1) * 100 + d;
  if (candNum < todayNum) y++;
  return y + "-" + pad(mo + 1) + "-" + pad(d);
}

/* GDS clocks as the engine stores them: "1005P", "945P", "200A", "1200N"
   (noon), "1200M" (midnight). Anything else — including "????" — is null. */
function parseGdsClock(tok) {
  /* Engine segments store clean clocks; tolerate a glued overnight tail
     ("1015A\u00a51") but never a "????" pretending to be a time. */
  var t = String(tok || "").toUpperCase()
    .replace(/\s*[\u00a5\u2021]\d+$/, "").replace(/\s*\+\d+$/, "").trim();
  if (t === "1200N") return { h: 12, m: 0 };
  if (t === "1200M") return { h: 0, m: 0 };
  var m = /^(\d{1,2})(\d{2})([AP])$/.exec(t);
  if (!m) return null;
  var h12 = +m[1], mi = +m[2];
  if (h12 < 1 || h12 > 12 || mi > 59) return null;
  var h = h12 % 12;
  if (m[3] === "P") h += 12;
  return { h: h, m: mi };
}

function toLinkSeg(s, nowMs) {
  var dep = parseGdsClock(s.dep_time), arr = parseGdsClock(s.arr_time);
  if (!dep || !arr) return null;
  var ymd = ymdFromDdmmm(s.date_ddmmm, nowMs);
  if (!ymd) return null;
  var num = String(s.flight_no || "").replace(/^0+/, "");
  if (!/^\d{1,4}$/.test(num)) return null;
  return {
    carrier: String(s.airline || "").toUpperCase(),
    num: num,
    cls: String(s.booking_class || "Y").toUpperCase().charAt(0) || "Y",
    origin: String(s.orig || "").toUpperCase(),
    dest: String(s.dest || "").toUpperCase(),
    ymd: ymd,
    depH: dep.h, depM: dep.m, arrH: arr.h, arrM: arr.m,
    plus: (s.arr_day_shift || 0) >= 1
  };
}
function toLinkSegs(engineSegs, nowMs) {
  var out = [], i;
  for (i = 0; i < (engineSegs || []).length; i++) {
    var c = toLinkSeg(engineSegs[i], nowMs);
    if (!c) return null;
    out.push(c);
  }
  return out.length ? out : null;
}

/* ---------------- eligibility ---------------- */
function ineligible(reason) {
  return { eligible: false, reason: reason, carrier: "", kind: "" };
}
function qualify(engineSegs) {
  if (!engineSegs || !engineSegs.length)
    return ineligible("No itinerary — convert something first.");
  var carriers = [], i;
  for (i = 0; i < engineSegs.length; i++) {
    var s = engineSegs[i] || {};
    var leg = "Leg " + (s.seg || (i + 1));
    var al = String(s.airline || "").toUpperCase();
    if (!/^[A-Z0-9]{2}$/.test(al))
      return ineligible(leg + " has no airline code.");
    if (!/^\d{1,4}$/.test(String(s.flight_no || "").replace(/^0+/, "")))
      return ineligible(leg + " has no flight number.");
    var o = String(s.orig || "").toUpperCase(), dd = String(s.dest || "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(o) || !/^[A-Z]{3}$/.test(dd))
      return ineligible(leg + " has an unknown airport — fix the paste or press AI FIX.");
    if (!ymdFromDdmmm(s.date_ddmmm))
      return ineligible(leg + " has no usable date.");
    if (!parseGdsClock(s.dep_time) || !parseGdsClock(s.arr_time))
      return ineligible(leg + " has no usable time (????) — fix the paste or press AI FIX.");
    if (carriers.indexOf(al) < 0) carriers.push(al);
  }
  
  // If there are multiple carriers, check if we can book segments from a single supported airline
  if (carriers.length > 1) {
    // Find which supported carriers are present
    var bookableCarriers = [];
    for (i = 0; i < carriers.length; i++) {
      if (BOOKABLE[carriers[i]]) {
        bookableCarriers.push(carriers[i]);
      }
    }
    
    // If exactly one supported carrier is present, filter to only that carrier's segments
    if (bookableCarriers.length === 1) {
      var targetCarrier = bookableCarriers[0];
      var filteredSegs = [];
      for (i = 0; i < engineSegs.length; i++) {
        if (String(engineSegs[i].airline || "").toUpperCase() === targetCarrier) {
          filteredSegs.push(engineSegs[i]);
        }
      }
      if (filteredSegs.length > 0) {
        return { eligible: true, reason: "Booking " + targetCarrier + " segments only", carrier: targetCarrier, kind: KIND_OF[targetCarrier], 
                 filteredSegs: filteredSegs };
      }
    }
    
    // If multiple supported carriers or no supported carriers, reject
    if (bookableCarriers.length > 1) {
      return ineligible("Mixed bookable airlines (" + bookableCarriers.join(" + ") + ") — one checkout can't book them.");
    }
    return ineligible("Mixed airlines (" + carriers.join(" + ") + ") — one checkout can't book them.");
  }
  
  var c = carriers[0];
  if (!BOOKABLE[c])
    return ineligible(c + " isn't bookable here — checkout links support AA, DL, AS, UA, BA.");
  return { eligible: true, reason: "", carrier: c, kind: KIND_OF[c] };
}

/* ---------------- link builders (ported; pax fixed at 1 adult) ---------------- */
function enc(v) { return encodeURIComponent(v); }
function trunc(n) { return n >= 0 ? Math.floor(n) : Math.ceil(n); }

function unixMs(s) {
  var p = s.ymd.split("-");
  var off = tzOffsetMin(s.origin);
  return Date.UTC(+p[0], +p[1] - 1, +p[2],
                  s.depH - trunc(off / 60), s.depM - (off % 60));
}
function tripType(segs) {
  if (segs.length === 1) return "oneWay";
  if (segs.length === 2 && segs[0].origin === segs[segs.length - 1].dest) return "roundTrip";
  return "multiCity";
}
function cabin(segs) {
  var best = "COACH", p = 0, i;
  for (i = 0; i < segs.length; i++) {
    var c = cabinForCarrier(segs[i].carrier, segs[i].cls);
    var q = c === "FIRST" ? 3 : c === "BUSINESS" ? 2 : c === "PREMIUM-COACH" ? 1 : 0;
    if (q > p) { p = q; best = c; }
  }
  return best === "FIRST" ? "FIRST" : best === "BUSINESS" ? "BUSINESS"
       : best === "PREMIUM-COACH" ? "PREMIUM_ECONOMY" : "COACH";
}

function aaMetaUrl(segs) {
  var first = segs[0];
  var paxStr = "A1S0C0I0Y0L0"; /* 1 adult — SpicyTerminal has no passenger UI */
  var legs = "", flights = "", i;
  for (i = 0; i < segs.length; i++)
    legs += "#" + segs[i].origin + "|" + segs[i].dest + "|0|0|" + unixMs(segs[i]);
  for (i = 0; i < segs.length; i++) {
    var s = segs[i];
    flights += "#" + s.carrier + "|" + s.num + "|" + (s.cls || "Y") + "|" +
               s.origin + "|" + s.dest + "|" + unixMs(s) + "|" + i;
  }
  var parts = ["DIRECT", "0", "US", segs.length === 1 ? "oneWay" : "multi", "4",
               paxStr, "0", first.origin, "0", first.dest,
               "0", "0", "0", "0", "0", "0", "0", "0.00", "1", legs, flights];
  return "https://www.aa.com/goto/metasearch?ITEN=" + enc(parts.join(","));
}

function unitedUrl(segs) {
  var s0 = segs[0];
  var tt = tripType(segs) === "roundTrip" ? 2 : 1;
  var cb = cabin(segs);
  var sc = cb === "FIRST" ? 7 : cb === "BUSINESS" ? 4 : 1;
  var u = "https://www.united.com/en/us/fsr/choose-flights?f=" + enc(s0.origin) +
          "&t=" + enc(s0.dest) + "&d=" + enc(s0.ymd) +
          "&tt=" + tt + "&at=1&sc=" + sc + "&px=1";
  if (tt === 2) u += "&r=" + enc(segs[1].ymd);
  return u;
}

function baCabin(segs) {
  var counts = {}, i;
  for (i = 0; i < segs.length; i++) {
    var c = cabinForCarrier(segs[i].carrier, segs[i].cls);
    counts[c] = (counts[c] || 0) + 1;
  }
  var best = "COACH", bestCount = -1, bestRank = -1;
  for (var k in counts) {
    if (!counts.hasOwnProperty(k)) continue;
    var rank = k === "FIRST" ? 3 : k === "BUSINESS" ? 2 : k === "PREMIUM-COACH" ? 1 : 0;
    if (counts[k] > bestCount || (counts[k] === bestCount && rank > bestRank)) {
      bestCount = counts[k]; bestRank = rank; best = k;
    }
  }
  return best === "FIRST" ? "F" : best === "BUSINESS" ? "C"
       : best === "PREMIUM-COACH" ? "W" : "M";
}
function deltaSliceIndex(segs) {
  var idx = [], cur = 0, i;
  for (i = 0; i < segs.length; i++) {
    if (i > 0) {
      var p = segs[i - 1], s = segs[i];
      var routeBreaks = p.dest !== s.origin;
      var pa = new Date(p.ymd + "T00:00:00Z");
      pa.setUTCDate(pa.getUTCDate() + (p.plus ? 1 : 0));
      pa.setUTCHours(p.arrH, p.arrM, 0, 0);
      var dp = new Date(s.ymd + "T00:00:00Z");
      dp.setUTCHours(s.depH, s.depM, 0, 0);
      var gap = (dp - pa) / 60000;
      if (routeBreaks || gap > 1440) cur++;
    }
    idx.push(cur);
  }
  return idx;
}
function baUrl(segs) {
  if (!segs.length) return "";
  var idx = deltaSliceIndex(segs);
  var journeys = [], cur = -1, i;
  for (i = 0; i < segs.length; i++) {
    if (idx[i] !== cur) {
      cur = idx[i];
      journeys.push({ o: segs[i].origin, d: segs[i].dest, date: segs[i].ymd });
    } else {
      journeys[journeys.length - 1].d = segs[i].dest;
    }
  }
  var onds = [];
  for (i = 0; i < journeys.length; i++)
    onds.push(journeys[i].o + "-" + journeys[i].d + "_" + journeys[i].date);
  return "https://www.britishairways.com/travel/book/public/en_gb/processOffer?onds=" + onds.join(",") +
         "&ad=1&yad=0&ch=0&inf=0&cabin=" + baCabin(segs) + "&flex=LOWEST&ond=" + journeys.length;
}

function deltaTripUrl(segs) {
  if (!segs.length) return "";
  var months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  var idx = deltaSliceIndex(segs);
  var parts = [], i;
  for (i = 0; i < segs.length; i++) {
    var s = segs[i];
    var d = new Date(s.ymd + "T00:00:00Z");
    var mon = months[d.getUTCMonth()];
    var dd = pad(d.getUTCDate()), yyyy = d.getUTCFullYear();
    var cls = s.cls || "Y", h24 = s.depH;
    var mer = h24 < 12 ? "A" : "P", h12 = h24 % 12;
    parts.push(idx[i] + ":" + cls + ":" + s.origin + ":" + s.dest + ":" +
               s.carrier + ":" + s.num + ":" + mon + ":" + dd + ":" + yyyy +
               ":" + pad(h12) + mer);
  }
  var fb = fareBasis(segs[0].cls || "Y", segs[0].carrier, segs[0].num);
  var fbs = [];
  for (i = 0; i < segs.length; i++) fbs.push(fb);
  var total = estimate(segs).total.toFixed(2);
  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  var p = ["cartId=" + uuid(), "cacheKeySuffix=" + uuid(), "app=sl-sho"];
  for (i = 0; i < parts.length; i++)
    p.push(enc("itinSegment[" + i + "]") + "=" + enc(parts[i]));
  p.push("tripType=" + (segs.length === 1 ? "oneWay" : segs.length === 2 ? "roundTrip" : "multiCity"));
  p.push("paxCount=1", "currencyCd=USD", "fareBasis=" + enc(fbs.join(":")), "price=" + total);
  p.push("numOfSegments=" + segs.length, "exitCountry=US",
         "vendorReferrerUrl=" + enc("https://matrix.itasoftware.com"));
  return "https://www.delta.com/completepurchase/trip-summary?" + p.join("&");
}

function alaskaUrl(segs) {
  if (!segs.length) return "";
  var ft = segs.length === 1 ? "ow"
         : (segs[segs.length - 1].dest === segs[0].origin ? "rt" : "mc");
  var fs = [], i;
  for (i = 0; i < segs.length; i++) {
    var s = segs[i];
    var d = new Date(s.ymd + "T00:00:00Z");
    var mmddyyyy = pad(d.getUTCMonth() + 1) + "/" + pad(d.getUTCDate()) + "/" + d.getUTCFullYear();
    fs.push("F" + (i + 1) + "=" + enc(s.origin + "|" + s.dest + "|" + mmddyyyy + "|" + s.num + "|f"));
  }
  var dest;
  if (ft === "rt") {
    var idx = deltaSliceIndex(segs), last = 0;
    for (i = 0; i < segs.length; i++) if (idx[i] === 0) last = i;
    dest = segs[last].dest;
  } else {
    dest = segs[segs.length - 1].dest;
  }
  var total = estimate(segs).total.toFixed(2);
  var p = ["A=1", "C=0", "FT=" + ft].concat(fs);
  p.push("DEST=" + enc(dest), "FARE=" + total, "frm=cart", "META=GOO_CS");
  return "https://www.alaskaair.com/planbook/shoppingstart?" + p.join("&");
}

var BUILDERS = { AA: aaMetaUrl, DL: deltaTripUrl, AS: alaskaUrl, UA: unitedUrl, BA: baUrl };

/* ---------------- the one entry point ---------------- */
function linkFor(engineSegs, nowMs) {
  var q = qualify(engineSegs);
  if (!q.eligible) return q;
  // Use filtered segments if available (for mixed airline cases)
  var segsToUse = q.filteredSegs || engineSegs;
  var segs = toLinkSegs(segsToUse, nowMs);
  if (!segs)
    return ineligible("Could not read this trip for linking — fix the paste or press AI FIX.");
  var url = BUILDERS[q.carrier](segs);
  if (!url)
    return ineligible("Could not build the " + q.carrier + " link for this trip.");
  return { eligible: true, reason: q.reason || "", carrier: q.carrier, kind: q.kind,
           url: url, label: LABEL_OF[q.carrier], segs: segs };
}

var SpicyLinks = {
  linkFor: linkFor,
  qualify: qualify,
  toLinkSegs: toLinkSegs,
  ymdFromDdmmm: ymdFromDdmmm,
  parseGdsClock: parseGdsClock,
  cabinForCarrier: cabinForCarrier,
  BOOKABLE_LIST: BOOKABLE_LIST
};
if (typeof module !== "undefined") module.exports = SpicyLinks;
if (typeof window !== "undefined") window.SpicyLinks = SpicyLinks;
})();
