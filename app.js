/* app.js — SpicyTerminal Web UI — Instant Conversion & AI Self-Learner
   Features:
   - Bounded screenshot OCR: lazy-loaded worker path plus a no-hang fallback
   - Native TextDetector API + bundled pure JS OCRAD fallback
   - Aviation-aware OCR cleaner (repairs glyph confusions in flight numbers, times, airports, dates)
   - Fallback to AI ONLY in case direct parsing cannot detect flights
   - Continuous AI mistake detection & self-healing engine ("teaches the tool to fix it")
   - Weekly performance & enhancement report generator sent to adhambadraan@gmail.com
   - Text cache (fingerprint -> output) & Image cache (hash -> output) for instant repeat
   - Clean, lightweight, zero telemetry sent to external tracking servers
*/
(function () {
"use strict";
var $ = function (id) { return document.getElementById(id); };
var inp = $("inp"), out = $("out"), st = $("st");
var images = [];
var documents = [];
var lastOut = "";
var converting = false;
var aiRequestId = 0;
var lastTextFp = "";
var nextAttachmentId = 0;
var activeReviewImageId = null;

// Attachment state is deliberately separate from the input text.  A file
// picker can return an empty/incorrect MIME type and several files can finish
// decoding in a different order, so relying on File.type or Promise timing
// makes the converter appear to randomly do nothing.
var attachmentVersion = 0; // clear-generation; old callbacks cannot repaint after clear
var latestAttachmentBatch = 0;
var pendingImageJobs = 0;

var pendingDocumentJobs = 0;
var imageParseVersion = -1;
var imageParsePromise = null;
var AUTHOR_EMAIL = "adhambadraan@gmail.com";

/* ---------- utils ---------- */
function setStatus(msg, warn) { st.textContent = msg; st.title = msg; st.className = warn ? "warn" : ""; }
function nowMs() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
function invalidateAiForAttachmentChange() {
  // The network request itself cannot be reliably cancelled in every browser,
  // but its response must never repaint a newer attachment set.
  if (converting) {
    aiRequestId++;
    converting = false;
    window._aiStartedAt = 0;
  }
}
function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function gemKey() { return localStorage.getItem("spicy_gem_key") || ""; }
function hashStr(s){
  var h=5381;
  for(var i=0;i<s.length;i++) h=((h<<5)+h + s.charCodeAt(i))>>>0;
  return h.toString(36)+"-"+s.length.toString(36);
}
function fp(text) {
  var t = (text || "").toLowerCase().replace(/\s+/g, " ").trim(), h = 5381;
  for (var i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* ---------- telemetry & weekly stats ---------- */
var STATS_KEY = "spicy_weekly_stats_v1";
function loadStats() {
  try {
    var s = JSON.parse(localStorage.getItem(STATS_KEY) || "{}");
    if (!s.startDate) s.startDate = new Date().toISOString().slice(0, 10);
    if (!s.total) s.total = 0;
    if (!s.textDirect) s.textDirect = s.textOffline || 0;
    if (!s.imgDirect) s.imgDirect = s.imgOffline || 0;
    if (!s.aiFallback) s.aiFallback = 0;
    if (!s.durations) s.durations = [];
    return s;
  } catch (e) {
    return { startDate: new Date().toISOString().slice(0, 10), total: 0, textDirect: 0, imgDirect: 0, aiFallback: 0, durations: [] };
  }
}
function recordStat(type, durationMs) {
  try {
    var s = loadStats();
    s.total++;
    if (type === "text_direct" || type === "text_offline") s.textDirect++;
    if (type === "img_direct" || type === "img_offline") {
      s.imgDirect++;
      if (typeof durationMs === "number" && durationMs > 0) {
        s.durations.push(Math.round(durationMs));
        if (s.durations.length > 50) s.durations.shift();
      }
    }
    if (type === "ai_fallback") s.aiFallback++;
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  } catch (e) {}
}

/* ---------- AI mistake detection & self-learning log ---------- */
var MISTAKES_KEY = "spicy_mistakes_log_v1";
var RULES_KEY = "spicy_learned_rules_v1";

function loadMistakes() {
  try { return JSON.parse(localStorage.getItem(MISTAKES_KEY) || "[]"); } catch (e) { return []; }
}
function recordMistake(entry) {
  try {
    var list = loadMistakes();
    list.unshift(entry);
    localStorage.setItem(MISTAKES_KEY, JSON.stringify(list.slice(0, 50)));
  } catch (e) {}
}

function loadLearnedRules() {
  try { return JSON.parse(localStorage.getItem(RULES_KEY) || "[]"); } catch (e) { return []; }
}
function teachRule(rule) {
  try {
    var rules = loadLearnedRules();
    // Avoid duplicate rules
    var exists = rules.some(function(r){ return r.pattern === rule.pattern && r.replacement === rule.replacement; });
    if (!exists) {
      rules.unshift(rule);
      localStorage.setItem(RULES_KEY, JSON.stringify(rules.slice(0, 60)));
    }
  } catch (e) {}
}

/* Analyze discrepancy between direct engine and AI result to detect mistakes & teach tool */
function detectMistakesAndLearn(inputText, directText, aiText, reason) {
  if (!aiText || !aiText.trim()) return;
  var dirLines = (directText || "").trim().split("\n").filter(Boolean);
  var aiLines = (aiText || "").trim().split("\n").filter(Boolean);

  var dirFltLines = dirLines.filter(function(l){ return /^\d+\s+[A-Z0-9]{2}\s+/i.test(l); });
  var aiFltLines = aiLines.filter(function(l){ return /^\d+\s+[A-Z0-9]{2}\s+/i.test(l); });

  var diffNotes = [];

  // Check count difference
  if (dirFltLines.length !== aiFltLines.length) {
    diffNotes.push("Segment count discrepancy: direct found " + dirFltLines.length + ", AI found " + aiFltLines.length);
  }

  // Compare flight lines
  for (var i = 0; i < Math.min(dirFltLines.length, aiFltLines.length); i++) {
    var oP = dirFltLines[i].split(/\s+/);
    var aP = aiFltLines[i].split(/\s+/);
    // [seg#, carrier, flt#, date, orig, dest, dep, arr, cls, ac, dur, dist, stat]
    if (oP[1] !== aP[1] || oP[2] !== aP[2]) {
      diffNotes.push("Flight " + (i+1) + " mismatch: direct has " + oP[1] + " " + oP[2] + " vs AI " + aP[1] + " " + aP[2]);
      // If carrier matched but flight number had glyph error: teach rule!
      if (oP[1] === aP[1] && oP[2] && aP[2]) {
        teachRule({
          type: "flight_num",
          pattern: oP[1] + " " + oP[2],
          replacement: aP[1] + " " + aP[2],
          why: "AI corrected flight number glyph error"
        });
      }
    }
    if (oP[3] !== aP[3]) diffNotes.push("Flight " + (i+1) + " date: " + oP[3] + " vs " + aP[3]);
    if (oP[4] !== aP[4] || oP[5] !== aP[5]) diffNotes.push("Flight " + (i+1) + " route: " + oP[4] + "-" + oP[5] + " vs " + aP[4] + "-" + aP[5]);
    if (oP[6] !== aP[6] || oP[7] !== aP[7]) diffNotes.push("Flight " + (i+1) + " times: " + oP[6] + "/" + oP[7] + " vs " + aP[6] + "/" + aP[7]);
  }

  if (diffNotes.length > 0 || !directText.trim()) {
    var entry = {
      id: "mstk_" + Date.now(),
      when: new Date().toISOString().slice(0, 19).replace("T", " "),
      reason: reason || "AI correction",
      summary: diffNotes.join("; ") || "Direct parse missed flight data",
      input: (inputText || "").slice(0, 180),
      direct: (directText || "").slice(0, 200),
      ai: (aiText || "").slice(0, 200)
    };
    recordMistake(entry);
  }
}

/* ---------- caches ---------- */
var LKEY = "spicy_learn_v1";
function learnAll() { try { return JSON.parse(localStorage.getItem(LKEY) || "[]"); } catch (e) { return []; } }
function learnRecord(text, aiOut, reason) {
  var all = learnAll();
  all.unshift({ fp: fp(text), when: new Date().toISOString().slice(0, 10),
                why: reason, in: (text || "").slice(0, 160), out: (aiOut || "").slice(0, 200) });
  try { localStorage.setItem(LKEY, JSON.stringify(all.slice(0, 40))); } catch (e) {}
}
function learnKnows(text) {
  var f = fp(text), all = learnAll();
  for (var i = 0; i < all.length; i++) if (all[i].fp === f) return all[i];
  return null;
}

var TCACHE_KEY = "spicy_text_cache_v2";
function tCacheAll(){ try{ return JSON.parse(localStorage.getItem(TCACHE_KEY)||"{}"); }catch(e){return{};} }
function tCacheGet(h){ var c=tCacheAll(); return c[h]||null; }
function tCacheSet(h, outText){
  try{
    var c=tCacheAll();
    c[h]={out: outText.slice(0,3000), when: Date.now()};
    var keys=Object.keys(c).sort(function(a,b){return c[b].when-c[a].when;});
    var nc={}; for(var i=0;i<Math.min(80,keys.length);i++) nc[keys[i]]=c[keys[i]];
    localStorage.setItem(TCACHE_KEY, JSON.stringify(nc));
  }catch(e){}
}

var ICACHE_KEY = "spicy_img_cache_v2";
function imgCacheAll(){ try{ return JSON.parse(localStorage.getItem(ICACHE_KEY)||"{}"); }catch(e){return{};} }
function imgCacheGet(hash){ var c=imgCacheAll(); return c[hash]||null; }
function imgCacheSet(hash, outText){
  try{
    var c=imgCacheAll();
    c[hash]={out: outText.slice(0,3000), when: Date.now()};
    var keys=Object.keys(c).sort(function(a,b){return c[b].when-c[a].when;});
    var nc={}; for(var i=0;i<Math.min(30,keys.length);i++) nc[keys[i]]=c[keys[i]];
    localStorage.setItem(ICACHE_KEY, JSON.stringify(nc));
  }catch(e){}
}

/* ---------- pre-warm engine ---------- */
(function prewarm(){
  try{
    if(window.SpicyEngine) window.SpicyEngine.parse("AA 100 01JAN JFK LHR 100P 200P Y 738 N");
  }catch(e){}
})();

/* ---------- aviation-specific OCR text cleaner & repair ---------- */
// These expensive regexes used to be rebuilt on every call (and every
// keystroke / OCR pass). Build them once at startup.
var _cleanAirlines = [];
var _cleanAirLeadRe = null, _cleanCaseAirRe = null, _cleanAirRe = null;
function _ensureCleanAirRegexes() {
  if (_cleanAirLeadRe || !_cleanAirlines.length) return;
  var alt = _cleanAirlines.map(function(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|");
  if (!alt) return;
  _cleanAirLeadRe = new RegExp("\\b(" + alt + ")\\s+[_|Il]([0-9A-Za-z]{2,5})\\b", "gi");
  _cleanCaseAirRe = new RegExp("\\b(" + alt + ")\\b", "gi");
  _cleanAirRe = new RegExp("\\b(" + alt + ")[ \\t]+([0-9A-Za-z]{1,5})\\b", "g");
}
(function() {
  try {
    var d = window.SPICY_DATA || SPICY_DATA;
    if (d && d.airlines) _cleanAirlines = Object.keys(d.airlines);
  } catch (e) {}
  _ensureCleanAirRegexes();
})();
var _cleanMonthRes = [];
(function() {
  var months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  months.forEach(function(m) {
    _cleanMonthRes.push([new RegExp("(\\d{1,2})\\s*" + m, "gi"), "$1 " + m]);
    _cleanMonthRes.push([new RegExp(m + "\\s*(\\d{1,2})", "gi"), m + " $1"]);
  });
})();

function cleanOcrText(rawText) {
  if (!rawText) return "";
  var s = String(rawText);

  // 1. Apply user-learned rules first (self-healing)
  var rules = loadLearnedRules();
  if (rules && rules.length) {
    rules.forEach(function(r) {
      if (r.pattern && r.replacement !== undefined) {
        s = s.split(r.pattern).join(r.replacement);
      }
    });
  }

  // 2. Line breaks and separators
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/[•·—–]/g, " - ");
  s = s.replace(/[-–—]/g, " - ");
  s = s.replace(/[ \t]{2,}/g, " ");

  // Glued airports e.g. DOHtoCAI -> DOH to CAI, JFK-LHR -> JFK - LHR
  s = s.replace(/\b([A-Za-z]{3})\s*to\s*([A-Za-z]{3})\b/gi, "$1 to $2");
  s = s.replace(/\b([A-Za-z]{3})to([A-Za-z]{3})\b/gi, "$1 to $2");

  // Underscore and glyph airport repairs – expanded from weekly report failure (ET ORD-ADD-CAI)
  s = s.replace(/_F[KC]\b/g, "JFK");
  s = s.replace(/\b[lI1]FK\b/g, "JFK");
  s = s.replace(/\bCAl\b/g, "CAI");
  s = s.replace(/\bCA1\b/g, "CAI");
  s = s.replace(/\bLNR\b/g, "LHR");
  s = s.replace(/\bIHR\b/g, "LHR");
  s = s.replace(/\b0RD\b/g, "ORD");
  s = s.replace(/\bA0D\b/g, "ADD");
  s = s.replace(/\bAD0\b/g, "ADD");
  s = s.replace(/\bSlN\b/g, "SIN");
  s = s.replace(/\blST\b/g, "IST");
  s = s.replace(/\bLAx\b/g, "LAX");

  // 3. Day shifts: 12h, 24h, compact, and parenthesized
  s = s.replace(/(\d{1,2}[:._]\d{2})\s*\+\s*[lIi1tT]\b/gi, "$1+1");
  s = s.replace(/(\d{1,2}[:._]\d{2})\s*\+\s*[zZ2]\b/gi, "$1+2");
  s = s.replace(/\b(AM|PM|[APNM])\s*\+\s*[lIi1tT]\b/gi, "$1+1");
  s = s.replace(/\b(AM|PM|[APNM])\s*\+\s*[zZ2]\b/gi, "$1+2");
  s = s.replace(/\b(AM|PM|[APNM])\s*\+\s*[sS5]\b/gi, "$1+5");
  s = s.replace(/\(\s*\+\s*[lIi1tT]\s*(?:day)?\s*\)/gi, "(+1)");
  s = s.replace(/\(\s*\+\s*[zZ2]\s*(?:days?)?\s*\)/gi, "(+2)");
  s = s.replace(/¥\s*[lIi1tT]/g, "¥1");
  s = s.replace(/¥\s*[zZ2]/g, "¥2");
  s = s.replace(/\b(AM|PM|[APNM])\s*-\s*([1-3lItT])(?![0-9A-Za-z]*[:\.\/])/gi, function(_, ap, shift) {
    return ap + "-" + (shift === "l" || shift === "I" || shift === "t" ? "1" : shift);
  });

  // Airline typos & OCR confusions
  s = s.replace(/Brltlsh\s+Alrways/gi, "British Airways");
  s = s.replace(/Brltlsh/gi, "British");
  s = s.replace(/Emirales/gi, "Emirates");
  s = s.replace(/Uniled/gi, "United");
  s = s.replace(/Delia/gi, "Delta");
  s = s.replace(/Amerlcan/gi, "American");
  s = s.replace(/Lufihansa/gi, "Lufthansa");
  s = s.replace(/Qaiar/gi, "Qatar");
  s = s.replace(/Turklsh/gi, "Turkish");
  s = s.replace(/Slngapore/gi, "Singapore");

  // Airline + Flight prefix handling: e.g. "BA · Flight 114" -> "BA 114", "Flight AA 123" -> "AA 123"
  s = s.replace(/\b([A-Z0-9]{2})\s*[-·•.]*\s*Flight\s*([0-9A-Za-z]{1,5})\b/gi, "$1 $2");
  s = s.replace(/\bFlight\s+([A-Za-z]{2}|[0-9][A-Za-z]|[A-Za-z][0-9])[ \t]+([0-9A-Za-z]{1,5})\b/gi, "$1 $2");
  s = s.replace(/\bFlight\s+([0-9A-Za-z]{1,5})\b/gi, "$1");

  // Full month names to 3-letter month (e.g. September -> SEP)
  var monthMap = {
    january:"JAN", february:"FEB", march:"MAR", april:"APR", may:"MAY", june:"JUN",
    july:"JUL", august:"AUG", september:"SEP", october:"OCT", november:"NOV", december:"DEC"
  };
  Object.keys(monthMap).forEach(function(m) {
    s = s.replace(new RegExp("\\b" + m + "\\b", "gi"), monthMap[m]);
  });

  // Day number OCR repairs before/after month (e.g. l Sep -> 1 Sep, ls Sep -> 15 Sep, lo -> 10)
  // ET image test showed OCRAD reading 1 as l, 15 as ls, 10 as lo, 31 as 3l etc
  s = s.replace(/\b[lI]\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/gi, "1 $1");
  s = s.replace(/\b[lI]s\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/gi, "15 $1");
  s = s.replace(/\b[lI][oO]\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/gi, "10 $1");
  s = s.replace(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+[lI]\b/gi, "$1 1");
  s = s.replace(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+[lI]s\b/gi, "$1 15");
  s = s.replace(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+[lI][oO]\b/gi, "$1 10");
  // 31 often read as 3l
  s = s.replace(/\b3[lI]\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/gi, "31 $1");
  s = s.replace(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+3[lI]\b/gi, "$1 31");


  // 4. Durations: e.g. 10 hr4O min, 2h 3Om, 4 hr 30 min (must not match GDS booking class / dates / airports)
  s = s.replace(/\b([0-9]{1,2})\s*h(?:r|ours?)?[ \t]*([0-9oOsSlIzZ]{1,2})\s*(?:m|min|minutes?)\b/gi, function(_, h, m) {
    var cm = m.replace(/[oO]/g, "0").replace(/[sS]/g, "5").replace(/[lIi]/g, "1").replace(/[zZ]/g, "2");
    return h + " hr " + cm + " min";
  });

  // 5. Common aviation word & aircraft typos
  var dictWords = [
    [/Boelng/gi, "Boeing"],
    [/Alrbus/gi, "Airbus"],
    [/Alrlines?/gi, "Airlines"],
    [/Alrways?/gi, "Airways"],
    [/Buslness/gi, "Business"],
    [/Etonomy/gi, "Economy"],
    [/Econorny/gi, "Economy"],
    [/Premtum/gi, "Premium"],
    [/Nonstop/gi, "Nonstop"],
    [/Fl[il1]ght/gi, "Flight"],
    [/Operated\s+by/gi, "Operated by"],
    [/Departs?/gi, "Departs"],
    [/Arr[il1]ves?/gi, "Arrives"],
    [/Term[il1]nal/gi, "Terminal"],
    [/lberia/gi, "Iberia"],
    [/\b([Tt])(\d)([Tt])\b/g, "7$27"],
    [/Boeing\s+TTT/gi, "Boeing 777"],
    [/\bA3[sS]0\b/gi, "A350"],
    [/\bA38[oO]\b/gi, "A380"],
    [/\bA32[oO]\b/gi, "A320"],
    [/(?<![:\d])([0-2]?[1-9]|[123]0|31)[ \t]*([Nn]ou)\b/gi, "$1 NOV"],
    [/\b([Nn]ou)[ \t]+([0-2]?[1-9]|[123]0|31)\b(?![:\.\d])/gi, "NOV $2"],
    [/(?<![:\d])([0-2]?[1-9]|[123]0|31)[ \t]*([Aa]uq)\b/gi, "$1 AUG"],
    [/\b([Aa]uq)[ \t]+([0-2]?[1-9]|[123]0|31)\b(?![:\.\d])/gi, "AUG $2"],
    [/(?<![:\d])([0-2]?[1-9]|[123]0|31)[ \t]*([Ff]eh)\b/gi, "$1 FEB"],
    [/\b([Ff]eh)[ \t]+([0-2]?[1-9]|[123]0|31)\b(?![:\.\d])/gi, "FEB $2"],
    [/(?<![:\d])([0-2]?[1-9]|[123]0|31)[ \t]*([Dd]et)\b/gi, "$1 DEC"],
    [/\b([Dd]et)[ \t]+([0-2]?[1-9]|[123]0|31)\b(?![:\.\d])/gi, "DEC $2"]
  ];
  dictWords.forEach(function(pair) { s = s.replace(pair[0], pair[1]); });

  // 6. Times with colons (both 12h with AM/PM and 24h clocks): e.g. 7:ss PM, ll:39, T:SS PM, 12:4s PM
  s = s.replace(/\b([0-9A-Za-z]{1,2})[:\.](\w{2})(?:\s*([AP]M?|[ap]m?))?\b/g, function(match, h, m, ap) {
    var ch = h.replace(/[lIi]/g, "1").replace(/[oO]/g, "0").replace(/[Tt]/g, "7").replace(/[zZ]/g, "2").replace(/[sS]/g, "5");
    var cm = m.replace(/ss/gi, "55")
              .replace(/zs/gi, "25")
              .replace(/so/gi, "50")
              .replace(/os/gi, "05")
              .replace(/ll/gi, "11")
              .replace(/lo/gi, "10")
              .replace(/oo/gi, "00")
              .replace(/[sS]/g, "5")
              .replace(/[oO]/g, "0")
              .replace(/[lIi]/g, "1")
              .replace(/[zZ]/g, "2")
              .replace(/[tT]/g, "7");
    var hNum = parseInt(ch, 10), mNum = parseInt(cm, 10);
    if (hNum > 23 || mNum > 59) return match;
    return ch + ":" + cm + (ap ? " " + ap.toUpperCase() : "");
  });

  // 7. Compact GDS clocks: 9s0P, 94SA, 1120A, etc.
  s = s.replace(/\b(\d{1,2})([sSoO0-9]{2})([APNM])\b/g, function(_, h, m, ap) {
    var cm = m.replace(/[sS]/g, "5").replace(/[oO]/g, "0");
    return h + cm + ap;
  });

  // Route-specific airline OCR confusion (e.g. QR read as OR when DOH is present, ET read as E7 etc)
  if (/DOH/i.test(s)) {
    s = s.replace(/\bOR\s+/gi, "QR ");
  }
  // Ethiopian ET – OCR often reads ET as E7 or E7, and ADD as A0D
  if (/ADD/i.test(s) || /BOLE/i.test(s)) {
    s = s.replace(/\bE7\s+/gi, "ET ");
    s = s.replace(/\bE\s*7\s+/gi, "ET ");
  }

  // 8. Glued flight numbers + airport: e.g. 114lFK -> 114 JFK, ZO4lFK -> 204 JFK
  s = s.replace(/\b([0-9A-Za-z]{1,4})[lI1]FK\b/gi, "$1 JFK");
  s = s.replace(/\b([0-9]{1,4})([A-Z]{3})\b/g, "$1 $2");

  // 9. Airline code + Flight number:
  // e.g. "IB 4z37", "QR los9", "BA ll4", "LH 4OO", "DL 001"
  if (_cleanAirlines.length) {
    _ensureCleanAirRegexes();
    // OCR often returns a valid carrier in the wrong case (qR) and turns the
    // leading 1 of a flight number into an underscore or vertical bar
    // (qR _os9). Repair only the token immediately after a known carrier.
    if (_cleanAirLeadRe) {
      _cleanAirLeadRe.lastIndex = 0;
      s = s.replace(_cleanAirLeadRe, function(_, code, num) {
        var repaired = num.replace(/[oO]/g, "0").replace(/[sS]/g, "5")
          .replace(/[lIi|]/g, "1").replace(/[zZ]/g, "2").replace(/[gq]/g, "9");
        if (!/^1/.test(repaired)) repaired = "1" + repaired;
        return code.toUpperCase() + " " + repaired;
      });
    }
    if (_cleanCaseAirRe) {
      _cleanCaseAirRe.lastIndex = 0;
      s = s.replace(_cleanCaseAirRe, function(_, code) { return code.toUpperCase(); });
    }
    if (_cleanAirRe) {
      _cleanAirRe.lastIndex = 0;
      s = s.replace(_cleanAirRe, function(match, code, num, offset) {
      if (/^(AM|PM)$/i.test(code)) {
        var before = s.slice(Math.max(0, offset - 8), offset);
        if (/\d\s*$/i.test(before)) return match;
      }
      if (!/[0-9]/.test(num) && !/^[loszbBtT]+$/i.test(num)) return match;
      var cnum = num.replace(/[oO]/g, "0")
                    .replace(/[lIi]/g, "1")
                    .replace(/[zZ]/g, "2")
                    .replace(/[sS]/g, "5")
                    .replace(/[b]/g, "6")
                    .replace(/[B]/g, "8")
                    .replace(/[gq]/g, "9")
                    .replace(/[tT]/g, "7");
      return code + " " + cnum;
      });
    }
  }

  // 9. Dates: "16 sep", "18nov", etc.
  for (var mi = 0; mi < _cleanMonthRes.length; mi++) {
    var _mr = _cleanMonthRes[mi];
    _mr[0].lastIndex = 0;
    s = s.replace(_mr[0], _mr[1]);
  }

  return s;
}

/* ---------- bounded, non-blocking screenshot OCR ---------- */
// OCRAD is reliable but can become very expensive on a full-resolution phone
// screenshot. Keep every pass inside a predictable pixel/time budget and run
// the heavy recognizer off the UI thread whenever the browser supports it.
// Screenshot handling is tuned for speed first: reduce the amount of pixels
// OCRAD has to chew on, keep the native/text-detector pause tiny, and prewarm
// the worker on page idle so a real drop does not start with a 2-second boot.
var OCR_MAX_PIXELS = 850000;
var OCR_MAX_SIDE = 1680;
var OCR_MAX_TOTAL_MS = 2200;
var OCR_NATIVE_TIMEOUT_MS = 250;
var OCR_WORKER_BOOT_MS = 1200;
var OCR_WORKER_PASS_MS = 2200;
var ocrWorkerState = null;
var ocrWorkerDisabled = false;

function ocrError(code, message) {
  var err = new Error(message || code || "OCR error");
  err.code = code || "ocr_error";
  return err;
}
function ocradSourceText() {
  var sourceNode = $("ocradSource");
  return sourceNode ? String(sourceNode.textContent || sourceNode.text || "") : "";
}
function canUseOcrad() {
  return typeof window.OCRAD === "function" || !!ocradSourceText();
}
function ensureOcradOnMain() {
  if (typeof window.OCRAD === "function") return true;
  var source = ocradSourceText();
  if (!source) return false;
  try {
    // `ocradSource` deliberately has type=text/plain so first paint does not
    // compile a megabyte of OCR code. Only older browsers that cannot use the
    // worker evaluate it on the main thread, and only when OCR is requested.
    if (window.eval) window.eval(source);
    else eval(source); // eslint-disable-line no-eval
  } catch (e) { return false; }
  return typeof window.OCRAD === "function";
}
function fitOcrDimensions(width, height) {
  var w = Math.max(1, Math.round(width || 1));
  var h = Math.max(1, Math.round(height || 1));
  var scale = Math.min(1, OCR_MAX_SIDE / Math.max(w, h), Math.sqrt(OCR_MAX_PIXELS / (w * h)));
  if (scale < 1) {
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
  }
  return { w: w, h: h };
}

/* ---------- high-speed image preprocessing ---------- */
function preprocessCanvasForOcr(srcCanvas, mode, thresholdVal) {
  var w = srcCanvas.width, h = srcCanvas.height;
  var targetW = w, targetH = h;

  // Glyph height needs to be ~25-35px for clean OCRAD recognition. Upscale
  // compact flight cards, then cap the final work area so a dense screenshot
  // cannot turn one attachment into several seconds of synchronous work.
  if (h < 260) {
    var smallScale = Math.min(3.0, 480 / h);
    targetW = Math.round(w * smallScale);
    targetH = Math.round(h * smallScale);
  } else if (w < 800) {
    var narrowScale = Math.min(2.0, 1000 / w);
    targetW = Math.round(w * narrowScale);
    targetH = Math.round(h * narrowScale);
  }
  var bounded = fitOcrDimensions(targetW, targetH);
  targetW = bounded.w;
  targetH = bounded.h;

  var cv = document.createElement("canvas");
  cv.width = targetW;
  cv.height = targetH;
  // willReadFrequently keeps the backing store in CPU memory: getImageData
  // below is substantially faster than reading back a GPU texture. Browsers
  // without the option simply ignore it.
  var ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(srcCanvas, 0, 0, targetW, targetH);

  var imgData = ctx.getImageData(0, 0, targetW, targetH);
  var data = imgData.data;
  var len = data.length;

  // One histogram pass determines whether a dark UI should be inverted.
  var hist = new Uint32Array(256);
  var minLum = 255, maxLum = 0;
  for (var i = 0; i < len; i += 4) {
    var lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000 | 0;
    hist[lum]++;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }
  var bgLum = 0, maxCount = 0;
  for (var k = 0; k < 256; k++) {
    if (hist[k] > maxCount) { maxCount = hist[k]; bgLum = k; }
  }

  // If mode === "auto", dark background -> invert so text is black on white.
  var isDark = (mode === "invert") ? true : (mode === "normal") ? false : (bgLum < 128);

  if (mode === "gray") {
    // Contrast-stretched grayscale (no hard threshold). For an inverted image
    // the range must be inverted too; otherwise dark screenshots lose detail.
    var low = isDark ? 255 - maxLum : minLum;
    var high = isDark ? 255 - minLum : maxLum;
    var range = Math.max(1, high - low);
    for (var g = 0; g < len; g += 4) {
      var gl = (data[g] * 299 + data[g + 1] * 587 + data[g + 2] * 114) / 1000;
      if (isDark) gl = 255 - gl;
      var gNorm = Math.max(0, Math.min(255, Math.round(((gl - low) / range) * 255)));
      data[g] = gNorm; data[g + 1] = gNorm; data[g + 2] = gNorm; data[g + 3] = 255;
    }
  } else {
    // Fuse grayscale, conditional inversion and threshold into one pass.
    var thresh = thresholdVal || 150;
    var invCut = 255 - thresh;
    for (var p = 0; p < len; p += 4) {
      var valueLum = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
      var value = (isDark ? valueLum < invCut : valueLum > thresh) ? 255 : 0;
      data[p] = value; data[p + 1] = value; data[p + 2] = value; data[p + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return cv;
}

/* ---------- OCR worker: keep OCRAD from freezing controls ---------- */
function releaseOcrWorker(state) {
  if (!state) return;
  if (state.bootTimer) clearTimeout(state.bootTimer);
  if (state.active && state.active.timer) clearTimeout(state.active.timer);
  try { if (state.worker) state.worker.terminate(); } catch (e) {}
  try {
    var api = window.URL || window.webkitURL;
    if (state.url && api && api.revokeObjectURL) api.revokeObjectURL(state.url);
  } catch (e) {}
}
function rejectOcrWorkerJobs(state, err) {
  if (!state) return;
  if (state.active) {
    var active = state.active;
    state.active = null;
    if (active.timer) clearTimeout(active.timer);
    active.reject(err);
  }
  while (state.queue && state.queue.length) state.queue.shift().reject(err);
}
function stopOcrWorker(code, message, disable) {
  var state = ocrWorkerState;
  if (!state) return;
  ocrWorkerState = null;
  if (disable) ocrWorkerDisabled = true;
  var err = ocrError(code, message);
  releaseOcrWorker(state);
  rejectOcrWorkerJobs(state, err);
}
function cancelOcrWork() {
  // A new attachment set or a removed screenshot makes *active/queued* OCR
  // obsolete, so terminate only then. Keep a prewarmed idle worker alive
  // between attachments; destroying it on a new drop re-introduced the 1-2s
  // worker boot delay that prewarming was meant to eliminate.
  var state = ocrWorkerState;
  if (!state || (!state.active && !state.queue.length)) return;
  stopOcrWorker("cancelled", "OCR cancelled because attachments changed", false);
}
function pumpOcrWorker() {
  var state = ocrWorkerState;
  if (!state || !state.ready || state.active || !state.queue.length) return;
  var job = state.queue.shift();
  state.active = job;
  job.timer = setTimeout(function() {
    if (ocrWorkerState === state && state.active === job) {
      stopOcrWorker("timeout", "OCR pass took too long — try a tighter screenshot crop", false);
    }
  }, OCR_WORKER_PASS_MS);
  try {
    var message = { type: "ocr", id: job.id, width: job.width, height: job.height, pixels: job.pixels.buffer };
    try { state.worker.postMessage(message, [job.pixels.buffer]); }
    catch (transferError) { state.worker.postMessage(message); }
  } catch (postError) {
    stopOcrWorker("unavailable", "OCR worker could not start", true);
  }
}
function makeOcrWorker() {
  if (ocrWorkerDisabled || ocrWorkerState) return ocrWorkerState;
  var WorkerCtor = window.Worker || (typeof Worker !== "undefined" ? Worker : null);
  var BlobCtor = window.Blob || (typeof Blob !== "undefined" ? Blob : null);
  var urlApi = window.URL || window.webkitURL;
  var source = ocradSourceText();
  if (!WorkerCtor || !BlobCtor || !urlApi || !urlApi.createObjectURL || !source) {
    ocrWorkerDisabled = true;
    return null;
  }

  // The already-inlined OCRAD source is reused rather than fetched. That keeps
  // the single-file/offline build working while moving recognition off-thread.
  var bridge = "\n;self.onmessage=function(event){var m=event.data||{};if(m.type!==\"ocr\")return;try{var pixels=new Uint8ClampedArray(m.pixels);var text=OCRAD({width:m.width,height:m.height,data:pixels});self.postMessage({id:m.id,text:text||\"\"});}catch(error){self.postMessage({id:m.id,error:String((error&&error.message)||error||\"OCR worker failed\")});}};self.postMessage({type:\"spicy-ocr-ready\"});";
  var state = { worker: null, url: "", ready: false, queue: [], active: null, nextId: 0, bootTimer: null };
  try {
    state.url = urlApi.createObjectURL(new BlobCtor([source, bridge], { type: "application/javascript" }));
    state.worker = new WorkerCtor(state.url);
  } catch (e) {
    releaseOcrWorker(state);
    ocrWorkerDisabled = true;
    return null;
  }
  ocrWorkerState = state;
  state.worker.onmessage = function(event) {
    var msg = event.data || {};
    if (msg.type === "spicy-ocr-ready") {
      state.ready = true;
      if (state.bootTimer) { clearTimeout(state.bootTimer); state.bootTimer = null; }
      pumpOcrWorker();
      return;
    }
    var job = state.active;
    if (!job || msg.id !== job.id) return;
    state.active = null;
    if (job.timer) clearTimeout(job.timer);
    if (msg.error) job.reject(ocrError("failed", msg.error));
    else job.resolve(String(msg.text || ""));
    pumpOcrWorker();
  };
  state.worker.onerror = function() { stopOcrWorker("unavailable", "OCR worker is unavailable in this browser", true); };
  state.worker.onmessageerror = function() { stopOcrWorker("unavailable", "OCR worker returned an unreadable response", true); };
  state.bootTimer = setTimeout(function() {
    if (ocrWorkerState === state && !state.ready) stopOcrWorker("unavailable", "OCR worker did not start", true);
  }, OCR_WORKER_BOOT_MS);
  return state;
}
function queueOcrWorker(canvas) {
  var state = makeOcrWorker();
  if (!state) return null;
  var ctx, frame;
  try {
    ctx = canvas && canvas.getContext && canvas.getContext("2d", { willReadFrequently: true });
    frame = ctx && ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch (e) { return null; }
  if (!frame || !frame.data || !frame.data.buffer) return null;
  return new Promise(function(resolve, reject) {
    state.queue.push({ id: ++state.nextId, width: frame.width || canvas.width, height: frame.height || canvas.height,
      pixels: frame.data, resolve: resolve, reject: reject, timer: null });
    pumpOcrWorker();
  });
}
function runOcradOnMain(canvas) {
  // Yield once before the compatibility path, allowing the PARSING state to
  // paint even in browsers that disallow blob workers.
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      try {
        if (!ensureOcradOnMain()) throw new Error("OCR engine not available");
        resolve(window.OCRAD(canvas) || "");
      } catch (e) { reject(e); }
    }, 0);
  });
}
function recognizeOcrCanvas(canvas) {
  var workerTask = queueOcrWorker(canvas);
  if (!workerTask) return runOcradOnMain(canvas);
  return workerTask.then(function(text) { return text; }, function(err) {
    // A blocked/unsupported worker should not make screenshots fail. Fall back
    // to the bundled OCRAD path; timeout/cancel errors remain bounded instead.
    if (err && err.code === "unavailable") return runOcradOnMain(canvas);
    throw err;
  });
}
function prewarmOcrWorker(ms) {
  // Spawn the OCR worker during page idle instead of waiting until the first
  // screenshot. The worker compiles the bundled OCRAD engine off-thread, so
  // assembling it now removes the biggest single delay from a real drop.
  if (ocrWorkerState || ocrWorkerDisabled) return;
  setTimeout(function() {
    try { makeOcrWorker(); } catch (e) {}
  }, ms || 400);
}

/* ---------- instant image parsing engine ---------- */
function parseImageDirect(im) {
  return new Promise(function(resolve) {
    var t0 = nowMs();
    var settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      resolve(result);
    }
    function elapsed() { return Math.round(nowMs() - t0); }

    function begin(srcCv) {
      if (!srcCv || !srcCv.width || !srcCv.height) {
        finish({ segs: [], warns: ["Image has no readable pixels"], text: "", method: "none", dur: 0 });
        return;
      }

      function runOcradPasses() {
        // With an OCR worker, OCRAD stays uncompiled on the UI thread until it
        // is actually needed as a compatibility fallback.
        if (!canUseOcrad()) {
          finish({ segs: [], warns: ["OCR engine not available"], text: "", method: "none", dur: elapsed() });
          return;
        }

        // A normal screenshot is found on the first pass. Three carefully
        // chosen variants retain a useful fallback without the old six-pass
        // worst case; large frames get just two bounded attempts.
        var passes = [
          { mode: "auto", thresh: 150, label: "auto (150)" },
          { mode: "auto", thresh: 175, label: "auto (175)" },
          { mode: "gray", thresh: 0, label: "grayscale" }
        ];
        if (srcCv.width * srcCv.height > 850000) passes = passes.slice(0, 2);
        var bestRaw = "";
        var pIdx = 0;

        function finishBest(reason) {
          if (bestRaw.trim().length > 5) {
            var cleanedFinal = cleanOcrText(bestRaw);
            var resFinal = window.SpicyEngine.parse(cleanedFinal);
            if (resFinal[0] && resFinal[0].length > 0) {
              finish({ segs: resFinal[0], warns: resFinal[1], text: cleanedFinal,
                rawOcr: bestRaw, method: "OCRAD (best text)", dur: elapsed() });
              return;
            }
          }
          finish({ segs: [], warns: [reason || "Could not detect flights"], text: bestRaw,
            method: "OCRAD (failed)", dur: elapsed() });
        }
        function step() {
          if (settled) return;
          if (pIdx >= passes.length) { finishBest(); return; }
          if (elapsed() >= OCR_MAX_TOTAL_MS) {
            finishBest("OCR stopped after " + Math.round(OCR_MAX_TOTAL_MS / 1000) + "s — try a tighter screenshot crop");
            return;
          }
          var cfg = passes[pIdx++], procCv;
          try { procCv = preprocessCanvasForOcr(srcCv, cfg.mode, cfg.thresh); }
          catch (passErr) { setTimeout(step, 0); return; }
          recognizeOcrCanvas(procCv).then(function(raw) {
            if (settled) return;
            raw = String(raw || "");
            if (raw.trim().length > bestRaw.trim().length) bestRaw = raw;
            if (raw.trim().length > 5) {
              var cleaned = cleanOcrText(raw);
              var res = window.SpicyEngine.parse(cleaned);
              if (res[0] && res[0].length > 0) {
                finish({ segs: res[0], warns: res[1], text: cleaned, rawOcr: raw,
                  method: "OCRAD (" + cfg.label + ")", dur: elapsed() });
                return;
              }
            }
            // Yield between passes so UI events and attachment removal remain
            // responsive even when the browser has no Worker support.
            setTimeout(step, 0);
          }, function(err) {
            if (settled) return;
            if (err && err.code === "cancelled") {
              finish({ segs: [], warns: ["OCR cancelled"], text: bestRaw, method: "OCRAD (cancelled)", dur: elapsed() });
              return;
            }
            if (err && err.code === "timeout") {
              finishBest("OCR timed out — try a tighter screenshot crop");
              return;
            }
            setTimeout(step, 0);
          });
        }
        step();
      }

      // Native TextDetector is the quickest route when present, but some
      // browser implementations can stall. Race it against a short deadline
      // so it never leaves the attachment pipeline on PARSING forever.
      if (window.TextDetector) {
        var nativeSettled = false;
        var nativeTimer = null;
        function nativeFallback() {
          if (nativeSettled || settled) return;
          nativeSettled = true;
          if (nativeTimer) clearTimeout(nativeTimer);
          runOcradPasses();
        }
        try {
          var td = new window.TextDetector();
          nativeTimer = setTimeout(nativeFallback, OCR_NATIVE_TIMEOUT_MS);
          Promise.resolve(td.detect(srcCv)).then(function(detected) {
            if (nativeSettled || settled) return;
            nativeSettled = true;
            if (nativeTimer) clearTimeout(nativeTimer);
            if (detected && detected.length) {
              detected.sort(function(a, b) {
                var ab = a.boundingBox || {}, bb = b.boundingBox || {};
                var dy = (ab.top || 0) - (bb.top || 0);
                return Math.abs(dy) > 16 ? dy : ((ab.left || 0) - (bb.left || 0));
              });
              var nativeRaw = detected.map(function(d) { return d.rawValue || ""; }).join("\n");
              var cleaned = cleanOcrText(nativeRaw);
              var res = window.SpicyEngine.parse(cleaned);
              if (res[0] && res[0].length > 0) {
                finish({ segs: res[0], warns: res[1], text: cleaned,
                  rawOcr: nativeRaw, method: "native TextDetector", dur: elapsed() });
                return;
              }
            }
            runOcradPasses();
          }, nativeFallback);
          return;
        } catch (e) {
          nativeFallback();
          return;
        }
      }
      runOcradPasses();
    }

    // fastDownscale retains the canvas, avoiding a second base64 decode in
    // the normal path. The data URL fallback keeps this function reusable.
    if (im.canvas) {
      begin(im.canvas);
      return;
    }
    var img = new Image();
    img.onload = function() {
      var srcCv = document.createElement("canvas");
      srcCv.width = img.naturalWidth || img.width;
      srcCv.height = img.naturalHeight || img.height;
      var ctx = srcCv.getContext("2d", { willReadFrequently: true });
      if (!ctx) { finish({ segs: [], warns: ["Canvas is not available"], text: "", method: "none", dur: 0 }); return; }
      ctx.drawImage(img, 0, 0);
      begin(srcCv);
    };
    img.onerror = function() { finish({ segs: [], warns: ["Image load failed"], text: "", method: "none", dur: 0 }); };
    img.src = "data:" + im.mime + ";base64," + im.b64;
  });
}

/* ---------- attachment helpers ---------- */
function readyImages() { return images.filter(function(im) { return !!im && !im._pending && !im._removed; }); }
function readyDocuments() { return documents.filter(function(doc) { return !!doc; }); }
function hasAttachments() { return readyImages().length > 0 || readyDocuments().length > 0 || pendingImageJobs > 0 || pendingDocumentJobs > 0; }
function fileName(file) { return String((file && file.name) || "attachment"); }
function imageById(id) {
  for (var i = 0; i < images.length; i++) {
    if (images[i] && images[i]._attachmentId === id && !images[i]._removed) return images[i];
  }
  return null;
}
function hashCanvasSample(cv) {
  if (!cv || !cv.width || !cv.height) return "";
  try {
    // A cheap, content-derived fingerprint for the image cache. Reading a few
    // sampled pixels is far faster than base64-encoding the entire downscaled
    // photo, which is what made attachment drops feel slow on mobile.
    var ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "";
    var data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    var step = Math.max(16, (data.length / 20000) | 0);
    if (step % 4) step = (step + 3) & ~3;
    var h = 5381;
    for (var i = 0; i < data.length; i += step) {
      h = ((h << 5) + h + data[i] + data[i + 1] * 3 + data[i + 2] * 7 + data[i + 3] * 11) >>> 0;
    }
    return h.toString(36) + "-" + cv.width + "x" + cv.height;
  } catch (e) { return ""; }
}
function ensureImageDataUrl(im) {
  if (!im) return "";
  if (typeof im.b64 === "string" && im.b64) return im.b64;
  if (im.canvas && im.canvas.getContext && im.canvas.toDataURL) {
    try {
      var mime = (im.mime === "image/png") ? "image/png" : "image/jpeg";
      var url = im.canvas.toDataURL(mime, mime === "image/png" ? 1 : 0.88);
      var comma = url.indexOf(",");
      im.b64 = comma >= 0 ? url.slice(comma + 1) : url;
    } catch (e) { im.b64 = ""; }
  }
  return im.b64 || "";
}
function imageDataUrl(im) {
  if (im && typeof im.b64 === "string" && im.b64) return "data:" + im.mime + ";base64," + im.b64;
  var b64 = ensureImageDataUrl(im);
  return b64 ? "data:" + im.mime + ";base64," + b64 : "";
}
function revokeImagePreview(im) {
  if (!im || !im._reviewUrl || !im._reviewUrlIsObjectUrl) return;
  try {
    var api = window.URL || window.webkitURL;
    if (api && api.revokeObjectURL) api.revokeObjectURL(im._reviewUrl);
  } catch (e) {}
  im._reviewUrl = "";
  im._reviewUrlIsObjectUrl = false;
}
function makeImagePreviewUrl(file) {
  try {
    var api = window.URL || window.webkitURL;
    if (api && api.createObjectURL) return api.createObjectURL(file);
  } catch (e) {}
  return "";
}
function fileExtension(file) {
  var name = fileName(file).toLowerCase();
  var dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}
function isImageFile(file) {
  var type = String((file && file.type) || "").toLowerCase();
  return type.indexOf("image/") === 0 || /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(fileName(file));
}
function isPdfFile(file) {
  return String((file && file.type) || "").toLowerCase() === "application/pdf" || fileExtension(file) === ".pdf";
}
function isTextFile(file) {
  var type = String((file && file.type) || "").toLowerCase();
  return type.indexOf("text/") === 0 || /\.(csv|eml|htm|html|ics|json|log|md|text|tsv|txt|xml)$/i.test(fileName(file));
}
function readTextFile(file, maxBytes) {
  maxBytes = maxBytes || 1000000;
  var part = file && file.slice ? file.slice(0, maxBytes) : file;
  if (part && typeof part.text === "function") {
    return part.text().then(function(text) { return String(text || ""); });
  }
  return new Promise(function(resolve, reject) {
    var rd = new FileReader();
    rd.onload = function(e) { resolve(String(e.target.result || "")); };
    rd.onerror = reject;
    rd.readAsText(part);
  });
}
function readFilePrefix(file, maxBytes) {
  var part = file && file.slice ? file.slice(0, maxBytes || 32) : file;
  if (!part || typeof part.arrayBuffer !== "function") return Promise.resolve(null);
  return part.arrayBuffer().then(function(buf) { return new Uint8Array(buf); }, function() { return null; });
}
function signatureKind(bytes) {
  if (!bytes || !bytes.length) return "";
  function ascii(offset, value) {
    if (bytes.length < offset + value.length) return false;
    for (var i = 0; i < value.length; i++) if (bytes[offset + i] !== value.charCodeAt(i)) return false;
    return true;
  }
  if ((bytes[0] === 0x89 && ascii(1, "PNG")) || ascii(0, "JFIF") || ascii(0, "Exif") ||
      (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
      ascii(0, "GIF8") || ascii(0, "BM") || (ascii(0, "RIFF") && ascii(8, "WEBP"))) return "image";
  if (ascii(0, "%PDF")) return "pdf";
  return "";
}
function classifyFile(file) {
  if (isImageFile(file)) return Promise.resolve("image");
  if (isPdfFile(file)) return Promise.resolve("pdf");
  if (isTextFile(file)) return Promise.resolve("text");

  // Some browsers and downloaded files expose an empty MIME type and no
  // extension. Check magic bytes before probing text so a nameless PNG/JPEG
  // is still an image, while binary files never enter the text parser.
  if (!file || typeof file.size !== "number" || file.size > 1000000) return Promise.resolve("unsupported");
  return readFilePrefix(file, 32).then(function(bytes) {
    var signature = signatureKind(bytes);
    if (signature) return signature;
    return readTextFile(file, 4096).then(function(sample) {
      if (!sample || sample.indexOf("\u0000") >= 0) return "unsupported";
      var bad = 0;
      for (var i = 0; i < sample.length; i++) {
        var c = sample.charCodeAt(i);
        if (c < 9 || (c > 13 && c < 32)) bad++;
      }
      return bad / Math.max(1, sample.length) < 0.02 ? "text" : "unsupported";
    }, function() { return "unsupported"; });
  });
}
/* ---------- high-speed image downscale ---------- */
function fastDownscale(file, maxSide, quality) {
  maxSide = maxSide || 1600;
  quality = typeof quality === "number" ? quality : 0.88;
  var ext = fileExtension(file);
  var sourceType = String((file && file.type) || "").toLowerCase();
  // Keep the encoded MIME aligned with the bytes returned by canvas. Several
  // browsers silently fall back to PNG for AVIF/SVG/TIFF/WebP output; telling
  // Gemini that those bytes are still AVIF makes AI attachment conversion fail.
  var outMime = (sourceType === "image/png" || ext === ".png") ? "image/png" : "image/jpeg";
  // Browsers cannot draw HEIC/HEIF without a decoder.  Rejecting it cleanly
  // is much better than leaving the user on a permanent "attaching" state.
  if (outMime === "image/heic" || outMime === "image/heif" || ext === ".heic" || ext === ".heif") {
    return Promise.reject(new Error("HEIC/HEIF is not supported by this browser"));
  }

  return new Promise(function(resolve, reject) {
    var settled = false;
    function ok(value) { if (!settled) { settled = true; resolve(value); } }
    function fail(err) { if (!settled) { settled = true; reject(err instanceof Error ? err : new Error(String(err || "image decode failed"))); } }
    function canvasResult(cv) {
      if (!cv || !cv.width || !cv.height) { fail("image has no pixels"); return; }
      try {
        // Keep base64 lazily generated. Offline OCR only needs the canvas (and
        // a cheap pixel hash); doing a full synchronised toDataURL on every
        // attachment was the largest single stall in the drop/paste path.
        ok({ mime: outMime, b64: "", w: cv.width, h: cv.height, canvas: cv,
          _hash: hashStr(outMime + "|" + cv.width + "x" + cv.height + "|" + hashCanvasSample(cv)) });
      } catch (e) { fail(e); }
    }
    function drawBitmap(bmp) {
      try {
        var w = bmp.width, h = bmp.height;
        if (!w || !h) { fail("image has no dimensions"); return; }
        var sc = Math.min(1, maxSide / Math.max(w, h));
        var cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(w * sc));
        cv.height = Math.max(1, Math.round(h * sc));
        var ctx = cv.getContext("2d");
        if (!ctx) { fail("Canvas is not available"); return; }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        // Transparent screenshots are common when copied from a browser;
        // flatten them on white so OCR does not mistake alpha for black text.
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
        if (bmp.close) bmp.close();
        canvasResult(cv);
      } catch (e) { fail(e); }
    }
    function fallback() {
      var rd = new FileReader(), img = new Image();
      rd.onload = function(ev) {
        img.onload = function() {
          try {
            var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            var sc = Math.min(1, maxSide / Math.max(w, h));
            var cv = document.createElement("canvas");
            cv.width = Math.max(1, Math.round(w * sc));
            cv.height = Math.max(1, Math.round(h * sc));
            var ctx = cv.getContext("2d");
            if (!ctx) { fail("Canvas is not available"); return; }
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, cv.width, cv.height);
            ctx.drawImage(img, 0, 0, cv.width, cv.height);
            canvasResult(cv);
          } catch (e) { fail(e); }
        };
        img.onerror = function() { fail("image could not be decoded"); };
        img.src = ev.target.result;
      };
      rd.onerror = function() { fail("image could not be read"); };
      rd.readAsDataURL(file);
    }
    if (window.createImageBitmap) {
      var bitmapPromise;
      try { bitmapPromise = window.createImageBitmap(file, { imageOrientation: "from-image" }); }
      catch (e) { bitmapPromise = window.createImageBitmap(file); }
      Promise.resolve(bitmapPromise).then(drawBitmap, fallback);
    } else fallback();
  });
}

function closeAttachmentReview() {
  activeReviewImageId = null;
  var modal = $("attachmentReviewModal");
  if (modal) modal.classList.add("hidden");
  var reviewImage = $("attachmentReviewImage");
  if (reviewImage) {
    if (reviewImage.removeAttribute) reviewImage.removeAttribute("src");
    else reviewImage.src = "";
  }
}
function openAttachmentReview(id) {
  var im = imageById(id);
  if (!im || im._pending) {
    if (im && im._pending) setStatus("SCREENSHOT STILL LOADING…");
    return;
  }
  activeReviewImageId = id;
  var reviewImage = $("attachmentReviewImage");
  var fallback = imageDataUrl(im);
  if (reviewImage) {
    reviewImage.alt = "Attached screenshot: " + fileName(im);
    reviewImage.onerror = function() {
      // Object URLs preserve the original screenshot for review. If a browser
      // cannot render that source, the already-decoded attachment still works.
      if (fallback && reviewImage.src !== fallback) reviewImage.src = fallback;
    };
    reviewImage.src = im._reviewUrl || fallback;
  }
  var meta = $("attachmentReviewMeta");
  if (meta) meta.textContent = fileName(im) + (im.w && im.h ? " · " + im.w + " × " + im.h : "");
  var modal = $("attachmentReviewModal");
  if (modal) modal.classList.remove("hidden");
  var close = $("attachmentReviewClose");
  if (close && close.focus) setTimeout(function() { close.focus(); }, 0);
}
function detachAttachmentThumb(im) {
  var node = im && im._thumbEl;
  if (!node) return;
  try {
    if (node.parentNode && node.parentNode.removeChild) node.parentNode.removeChild(node);
    else if (node.remove) node.remove();
  } catch (e) {}
  im._thumbEl = null;
}
function paintAttachmentThumb(im) {
  var thumb = im && im._thumbEl;
  var open = im && im._thumbOpen;
  if (!im || !thumb || !open || im._pending || im._thumbImage) return;
  if (thumb.classList) thumb.classList.remove("is-loading");
  if (im._thumbLoading) {
    try {
      if (im._thumbLoading.parentNode && im._thumbLoading.parentNode.removeChild) im._thumbLoading.parentNode.removeChild(im._thumbLoading);
      else if (im._thumbLoading.remove) im._thumbLoading.remove();
    } catch (e) {}
    im._thumbLoading = null;
  }
  open.disabled = false;
  open.title = "Review " + fileName(im);
  open.setAttribute && open.setAttribute("aria-label", "Review screenshot " + fileName(im));

  function paintFrom(src, w, h) {
    if (!imageById(im._attachmentId) || !im._thumbEl || !w || !h) return;
    var ts = Math.min(32 / h, 60 / w);
    var th = document.createElement("canvas");
    th.width = Math.max(1, Math.round(w * ts));
    th.height = Math.max(1, Math.round(h * ts));
    var ctx = th.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(src, 0, 0, th.width, th.height);
    var image = document.createElement("img");
    image.className = "attachment-preview-img";
    image.src = th.toDataURL("image/jpeg", 0.5);
    image.alt = "";
    im._thumbImage = image;
    open.appendChild(image);
  }
  if (im.canvas && im.canvas.width && im.canvas.height) {
    paintFrom(im.canvas, im.canvas.width, im.canvas.height);
    return;
  }
  var image = new Image();
  image.onload = function() { paintFrom(image, image.width || image.naturalWidth, image.height || image.naturalHeight); };
  image.src = imageDataUrl(im);
}
function addThumb(im) {
  // Create the control immediately, including while a large screenshot is
  // decoding. This means the red × can cancel a slow attachment straight away.
  if (!im || !im._attachmentId) return;
  var thumb = document.createElement("span");
  thumb.className = "attachment-thumb";
  var open = document.createElement("button");
  open.type = "button";
  open.className = "attachment-open";
  open.title = im._pending ? "Screenshot is loading" : "Review " + fileName(im);
  open.setAttribute && open.setAttribute("aria-label", "Review screenshot " + fileName(im));
  var remove = document.createElement("button");
  remove.type = "button";
  remove.className = "attachment-remove";
  remove.textContent = "×";
  remove.title = "Remove " + fileName(im);
  remove.setAttribute && remove.setAttribute("aria-label", "Remove screenshot " + fileName(im));
  open.addEventListener("click", function() { openAttachmentReview(im._attachmentId); });
  remove.addEventListener("click", function(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (event && event.stopPropagation) event.stopPropagation();
    removeImage(im._attachmentId);
  });
  thumb.appendChild(open);
  thumb.appendChild(remove);
  $("thumbs").appendChild(thumb);
  im._thumbEl = thumb;
  im._thumbOpen = open;
  if (im._pending) {
    open.disabled = true;
    var loading = document.createElement("span");
    loading.className = "attachment-loading";
    loading.textContent = "…";
    open.appendChild(loading);
    im._thumbLoading = loading;
    if (thumb.classList) thumb.classList.add("is-loading");
    return;
  }
  paintAttachmentThumb(im);
}
function removeImage(id) {
  var removed = null;
  for (var i = 0; i < images.length; i++) {
    if (images[i] && images[i]._attachmentId === id) {
      removed = images[i];
      removed._removed = true;
      images[i] = null;
      break;
    }
  }
  if (!removed) return;

  detachAttachmentThumb(removed);
  revokeImagePreview(removed);
  if (activeReviewImageId === id) closeAttachmentReview();

  // Invalidates queued/active OCR and AI replies without discarding other
  // decoded attachments. The remaining screenshots are re-read as one set.
  latestAttachmentBatch++;
  imageParseVersion = -1;
  imageParsePromise = null;
  cancelOcrWork();
  invalidateAiForAttachmentChange();
  out.textContent = "";
  lastOut = "";
  var remaining = readyImages();
  var label = fileName(removed);
  if (pendingImageJobs > 0 || pendingDocumentJobs > 0) {
    setStatus("SCREENSHOT REMOVED — updating attachments…");
    return;
  }
  if (remaining.length) {
    setStatus("SCREENSHOT REMOVED — re-reading " + remaining.length + " image" + (remaining.length === 1 ? "" : "s") + "…");
    convertImageAttachments(latestAttachmentBatch);
    return;
  }
  if (readyDocuments().length) {
    setStatus("SCREENSHOT REMOVED — checking remaining attachment…");
    finishAttachmentConversion(attachmentVersion);
    return;
  }
  var typed = (inp.value || "").trim();
  if (typed) {
    setStatus("SCREENSHOT REMOVED — converting text…");
    convert(false);
  } else {
    setStatus("SCREENSHOT REMOVED — " + label);
  }
}
function addFileBadge(file, kind) {
  var badge = document.createElement("span");
  badge.className = "attachment-badge";
  badge.textContent = (kind === "pdf" ? "PDF" : "FILE") + " · " + fileName(file);
  badge.title = fileName(file);
  $("thumbs").appendChild(badge);
}
function addImage(file, token) {
  var slot = images.length;
  var attachmentId = "img_" + (++nextAttachmentId);
  var reviewUrl = makeImagePreviewUrl(file);
  var pending = { _attachmentId: attachmentId, _pending: true, name: fileName(file),
    _reviewUrl: reviewUrl, _reviewUrlIsObjectUrl: !!reviewUrl };
  images.push(pending); // reserve picker order while decoding happens asynchronously
  addThumb(pending);
  pendingImageJobs++;
  setStatus("IMAGE ATTACHING…");
  return fastDownscale(file, 1440, 0.86).then(function(im) {
    // A just-removed image or a cleared generation must not pop back into the
    // strip when its decoder eventually resolves.
    if (token !== attachmentVersion || images[slot] !== pending || pending._removed) {
      revokeImagePreview(pending);
      return null;
    }
    im.name = fileName(file);
    im._attachmentId = attachmentId;
    im._reviewUrl = pending._reviewUrl || reviewUrl;
    im._reviewUrlIsObjectUrl = !!im._reviewUrl;
    pending._reviewUrl = "";
    pending._reviewUrlIsObjectUrl = false;
    // Keep the loading control in place; only its image and click state change.
    im._thumbEl = pending._thumbEl;
    im._thumbOpen = pending._thumbOpen;
    pending._thumbEl = null;
    pending._thumbOpen = null;
    images[slot] = im;
    paintAttachmentThumb(im);
    return im;
  }, function(err) {
    revokeImagePreview(pending);
    if (token === attachmentVersion && images[slot] === pending) {
      images[slot] = null;
      detachAttachmentThumb(pending);
      setStatus("IMAGE FAILED — " + fileName(file) + " — " + String(err.message || err).slice(0, 70), true);
    }
    return null;
  }).then(function(im) {
    if (token === attachmentVersion) pendingImageJobs = Math.max(0, pendingImageJobs - 1);
    return im;
  });
}
function addPdf(file, token) {
  var slot = documents.length;
  documents.push(null);
  pendingDocumentJobs++;
  addFileBadge(file, "pdf");
  return readFileAsBase64(file).then(function(data) {
    if (token !== attachmentVersion) return null;
    documents[slot] = { mime: "application/pdf", b64: data, name: fileName(file) };
    return documents[slot];
  }, function(err) {
    if (token === attachmentVersion) {
      documents[slot] = null;
      setStatus("PDF FAILED — " + fileName(file), true);
    }
    return null;
  }).then(function(doc) {
    if (token === attachmentVersion) pendingDocumentJobs = Math.max(0, pendingDocumentJobs - 1);
    return doc;
  });
}
function readFileAsBase64(file) {
  return new Promise(function(resolve, reject) {
    var rd = new FileReader();
    rd.onload = function(e) {
      var value = String(e.target.result || ""), comma = value.indexOf(",");
      resolve(comma >= 0 ? value.slice(comma + 1) : value);
    };
    rd.onerror = reject;
    rd.readAsDataURL(file);
  });
}
function renderAttachmentResults(results, token, batch, started) {
  if (token !== attachmentVersion || batch !== latestAttachmentBatch) return;
  var allSegs = [], warns = [];
  results.forEach(function(res) {
    if (!res) return;
    if (res.segs && res.segs.length) allSegs = allSegs.concat(res.segs);
    if (res.warns) res.warns.forEach(function(w) { if (warns.indexOf(w) < 0) warns.push(w); });
  });

  // If the user attached a text file as well as a screenshot, include the
  // text in the same deterministic output instead of silently choosing one.
  var typed = (inp.value || "").replace(/\[screenshot attached[^\n]*\]\n?/g, "").trim();
  if (typed) {
    try {
      var typedResult = window.SpicyEngine.parse(typed);
      if (typedResult[0] && typedResult[0].length) allSegs = allSegs.concat(typedResult[0]);
      typedResult[1].forEach(function(w) { if (warns.indexOf(w) < 0) warns.push(w); });
    } catch (e) {}
  }
  allSegs.forEach(function(seg, i) { seg.seg = i + 1; });

  // Safety net: two different flights that came out with an identical route,
  // date and departure time are not a real itinerary — a field from the first
  // leg leaked onto the second.  Never present that silently as a result.
  var bled = false, seen = {};
  allSegs.forEach(function(seg) {
    var k = seg.orig + "|" + seg.dest + "|" + seg.date_ddmmm + "|" + seg.dep_time;
    if (seen[k] && seen[k] !== seg.airline + seg.flight_no) bled = true;
    seen[k] = seg.airline + seg.flight_no;
  });
  if (bled) {
    if (gemKey()) {
      setStatus("SEGMENTS LOOK DUPLICATED — re-reading with AI…", true);
      convertAi(true, "duplicated segment guard");
      return;
    }
    warns.push("segments repeat the same route/date — verify legs 2+ (add a Gemini key and press ✦ AI for a re-read)");
  }

  if (allSegs.length) {
    var outText = window.SpicyEngine.renderItinerary(allSegs);
    lastOut = outText;
    out.textContent = outText;
    var ms = Math.round(((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - started);
    // An attached PDF cannot be read offline; say so instead of letting the
    // user assume it was part of this result.
    var pdfNote = (readyDocuments().length && !gemKey()) ? "  ·  PDF needs Gemini (AI AUTO)" : "";
    setStatus("IMAGE PARSED — " + allSegs.length + " seg(s) (" + ms + "ms)" + (warns.length ? "  ·  " + warns.join(" · ") : "") + pdfNote, warns.length > 0);
    var imgs = readyImages();
    if (imgs.length === 1 && imgs[0]._hash) imgCacheSet(imgs[0]._hash, outText);
    recordStat("img_direct", ms);
    return;
  }

  if (gemKey()) {
    recordStat("ai_fallback");
    setStatus("Image parse did not detect flights — trying AI…");
    convertAi(true, "undetected attachment");
  } else {
    out.textContent = "Could not detect flights in the attachment.\n\nSupported images are converted offline. For a difficult image or PDF, save a Gemini key and press AI AUTO.";
    setStatus("ATTACHMENT NOT READ — AI AUTO can retry", true);
  }
}
function convertImageAttachments(batch) {
  if (batch !== latestAttachmentBatch) return;
  var token = attachmentVersion;
  var list = readyImages();
  if (!list.length) return;
  if (imageParseVersion === batch && imageParsePromise) return;
  imageParseVersion = batch;
  var started = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  setStatus("PARSING " + list.length + " IMAGE" + (list.length === 1 ? "" : "S") + "…");

  // A repeated single attachment is served directly from the local cache.
  // Do not use it when another source is attached: the combined request must
  // still include the typed itinerary or PDF.
  if (list.length === 1 && list[0]._hash && !(inp.value || "").trim() && !readyDocuments().length) {
    var cached = imgCacheGet(list[0]._hash);
    if (cached && cached.out) {
      lastOut = cached.out;
      out.textContent = cached.out;
      setStatus("CACHED IMAGE — instant");
      imageParsePromise = null;
      return;
    }
  }
  imageParsePromise = Promise.all(list.map(parseImageDirect)).then(function(results) {
    renderAttachmentResults(results, token, batch, started);
  }, function() {
    if (token === attachmentVersion && batch === latestAttachmentBatch) {
      setStatus("ATTACHMENT PARSE FAILED — AI AUTO can retry", true);
      if (gemKey()) convertAi(true, "attachment parse error");
    }
  }).then(function() {
    // An older batch may still finish after a newer one starts. Only that
    // batch may release the shared promise reference.
    if (imageParseVersion === batch) imageParsePromise = null;
  });
}
function appendTextFiles(files, token) {
  return Promise.all(files.map(function(file) {
    return readTextFile(file, 1000000).then(function(txt) { return { file: file, text: txt }; });
  })).then(function(items) {
    if (token !== attachmentVersion) return;
    var added = 0;
    items.forEach(function(item) {
      if (!item.text) return;
      inp.value += (inp.value ? "\n\n" : "") + item.text.slice(0, 20000);
      added += item.text.length;
    });
    if (!added) { setStatus("EMPTY TEXT ATTACHMENT", true); return; }
    setStatus("TEXT ATTACHED — " + added + " chars — converting…");
    convert(false);
  }, function() {
    if (token === attachmentVersion) setStatus("TEXT FILE READ FAILED", true);
  });
}
function processAttachments(arr, kinds, token, batch) {
  if (token !== attachmentVersion) return;
  var imageJobs = [], textFiles = [], pdfJobs = [];
  arr.forEach(function(file, i) {
    if (kinds[i] === "image") imageJobs.push(addImage(file, token));
    else if (kinds[i] === "text") textFiles.push(file);
    else if (kinds[i] === "pdf") pdfJobs.push(addPdf(file, token));
  });
  var tasks = [];
  if (textFiles.length) tasks.push(appendTextFiles(textFiles, token));
  if (pdfJobs.length) tasks.push(Promise.all(pdfJobs).then(function() {
    if (token !== attachmentVersion || pendingDocumentJobs > 0) return;
    // Images may still be decoding.  Their completion path owns the combined
    // conversion so AI is never fired with only half of the attachments.
    if (pendingImageJobs > 0) return;
    finishAttachmentConversion(token);
  }));
  if (imageJobs.length) tasks.push(Promise.all(imageJobs).then(function() {
    if (token === attachmentVersion && pendingImageJobs === 0) finishAttachmentConversion(token);
  }));
  var unsupported = arr.filter(function(_, i) { return kinds[i] === "unsupported"; });
  if (unsupported.length) setStatus("UNSUPPORTED ATTACHMENT — " + fileName(unsupported[0]), true);
  if (!tasks.length && !unsupported.length) setStatus("NO READABLE ATTACHMENTS", true);
}
// Single decision point once every attachment of the current generation has
// finished loading.  Keeps image+PDF combos deterministic: exactly one
// conversion, with every attachment included.
function finishAttachmentConversion(token) {
  if (token !== attachmentVersion) return;
  var imgs = readyImages(), docs = readyDocuments();
  if (imgs.length) {
    // Offline OCR cannot read PDFs.  When one is attached and a key exists,
    // send images and documents to AI together instead of dropping the PDF
    // from an offline-only render.
    if (docs.length && gemKey()) { convertAi(true, "image+PDF attachment"); return; }
    convertImageAttachments(latestAttachmentBatch);
    return;
  }
  if (docs.length) {
    if (gemKey()) convertAi(true, "PDF attachment");
    else setStatus("PDF ATTACHED — AI AUTO needs a Gemini key", true);
    return;
  }
  // This is reachable when an image is removed while it was still decoding.
  // Do not leave the status bar stuck on an updating/loading message.
  if ((inp.value || "").trim()) convert(false);
  else if (/UPDATING ATTACHMENTS/i.test(st.textContent || "")) setStatus("SCREENSHOT REMOVED");
}
function handleFiles(fileList) {
  var arr = Array.prototype.slice.call(fileList || []);
  if (!arr.length) return;
  var token = attachmentVersion;
  var batch = ++latestAttachmentBatch;
  // Stop obsolete local/AI work as soon as another attachment arrives. The
  // new batch will parse the complete, merged attachment list once decoding ends.
  cancelOcrWork();
  invalidateAiForAttachmentChange();
  // A new attachment is a new conversion request; never leave the previous
  // itinerary copyable while the replacement is being decoded.
  out.textContent = "";
  lastOut = "";
  setStatus("CHECKING ATTACHMENTS…");
  Promise.all(arr.map(classifyFile)).then(function(kinds) {
    processAttachments(arr, kinds, token, batch);
  }, function() { if (token === attachmentVersion && batch === latestAttachmentBatch) setStatus("ATTACHMENT CHECK FAILED", true); });
}

/* ---------- instant convert ---------- */
function directIncomplete(warns, segs) {
  if (!segs.length) return "no segments read";
  for (var i = 0; i < warns.length; i++)
    if (/NOT read|missing|unknown/i.test(warns[i])) return warns[i];
  return null;
}

function renderDirectSync(text){
  // Apply learned rules first
  var cleaned = cleanOcrText(text);
  var res = window.SpicyEngine.parse(cleaned);
  var segs = res[0], warns = res[1];
  if(!segs.length) { lastOut=""; out.textContent=""; return {segs:segs,warns:warns,out:""}; }
  var outText = window.SpicyEngine.renderItinerary(segs);
  lastOut = outText;
  out.textContent = outText;
  var msg = "CONVERTED — "+segs.length+" segment(s)";
  if(warns.length) msg+="  ·  "+warns.join(" · ");
  setStatus(msg, warns.length>0);
  tCacheSet(fp(text), outText);
  recordStat("text_direct");
  return {segs:segs,warns:warns,out:outText};
}

function convert(auto) {
  // Never let a stuck AI call freeze CONVERT. AI uses `converting`; text parse is sync.
  var raw = inp.value || "";
  var text = raw.replace(/\[screenshot attached[^\n]*\]\n?/g, "");
  var imgs = readyImages();
  var docs = readyDocuments();
  var hasImg = imgs.length > 0;
  var hasAnyAttachment = hasAttachments();
  if (!text.trim() && !hasAnyAttachment) {
    out.textContent = "";
    lastOut = "";
    setStatus("READY");
    return;
  }

  // A file may still be decoding.  Wait for the single attachment pipeline
  // rather than trying to parse an empty slot and reporting a false failure.
  if (pendingImageJobs > 0 || pendingDocumentJobs > 0) {
    setStatus("ATTACHMENT STILL LOADING…");
    return;
  }

  // TEXT CACHE: instant repeat (0ms). Do not use it when an image/PDF is also
  // attached, otherwise the attachment would be silently ignored.
  if (text.trim() && !hasImg && !docs.length) {
    var h = fp(text);
    if (h === lastTextFp && lastOut) { setStatus("CACHED — instant"); return; }
    var tc = tCacheGet(h);
    if (tc && tc.out) {
      lastOut = tc.out;
      out.textContent = tc.out;
      lastTextFp = h;
      setStatus("CACHED TEXT — instant — " + (tc.out.split("\n").filter(function(l) { return / N$/.test(l); }).length) + " segs");
      return;
    }
  }

  // Images are parsed together, in attachment order. This fixes the old
  // first-image-only behavior and prevents concurrent OCR callbacks from
  // overwriting each other.  A PDF rides along through the AI path when a
  // key exists, because offline OCR cannot read it.
  if (hasImg) {
    if (docs.length && gemKey()) { convertAi(auto, "image+PDF attachment"); return; }
    convertImageAttachments(latestAttachmentBatch);
    return;
  }

  // PDFs can be sent to AI as a document, but there is no PDF decoder in this
  // static offline bundle. Never silently ignore one just because the user
  // also pasted readable text.
  if (docs.length) {
    if (gemKey()) convertAi(auto, "PDF attachment");
    else setStatus("PDF ATTACHED — AI AUTO needs a Gemini key", true);
    return;
  }

  if (text.trim() && gemKey() && learnKnows(text)) { convertAi(auto, "learned pattern"); return; }

  // FAST PATH: small text sync parse immediately.
  if (text.length < 3000) {
    try {
      var r = renderDirectSync(text);
      var lack = directIncomplete(r.warns, r.segs);
      if (!lack) { lastTextFp = fp(text); return; }
      if (gemKey()) { convertAi(auto, lack); return; }
      if (!r.segs.length) {
        out.textContent = "Couldn't read this paste.\n" + (r.warns[0] || "") + "\n\nPress AI AUTO (add a Gemini key first if asked).";
        setStatus("INCOMPLETE — needs AI", true);
      } else {
        setStatus(st.textContent + "  ·  partial — AI AUTO can finish", true);
      }
    } catch (e) { setStatus("CONVERT ERROR", true); }
    return;
  }

  // LARGE TEXT: yield once so the browser can paint before parsing a large
  // email/export. The deterministic parser remains synchronous and local.
  setStatus("CONVERTING…");
  setTimeout(function() {
    try {
      var r = renderDirectSync(text);
      lastTextFp = fp(text);
      var lack = directIncomplete(r.warns, r.segs);
      if (lack && gemKey()) convertAi(auto, lack);
    } catch (e) { setStatus("CONVERT ERROR", true); }
  }, 0);
}

/* ---------- AI ---------- */
function aiModelSet(m){ window._aiModel=m; try{localStorage.setItem("spicy_gem_model",m);}catch(e){} }
function aiModelGet(){ try{return localStorage.getItem("spicy_gem_model")||"";}catch(e){return"";} }
function discoverModel(key){
  return fetchJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key="+encodeURIComponent(key), {}, 25000)
    .then(function(j){
      if(j.error) throw new Error(String(j.error.message||"model list failed"));
      var ms=(j.models||[]).filter(function(m){
        var n=(m.name||"").toLowerCase();
        return (m.supportedGenerationMethods||[]).indexOf("generateContent")>=0 &&
          n.indexOf("models/gemini")===0 &&
          !/embedding|tts|-image|live|native-audio|aqa|robotics|computer-use|banana/.test(n);
      }).map(function(m){return m.name.replace(/^models\//,"");});
      function score(n){ var s=0, v=n.match(/(\d+(?:\.\d+)?)/), ln=n.toLowerCase(); if(ln.indexOf("flash")>=0)s+=1000; if(ln.indexOf("lite")>=0)s-=30; if(/latest/.test(ln))s+=10; if(v)s+=parseFloat(v[1])*10; return s; }
      ms.sort(function(a,b){return score(b)-score(a);});
      if(!ms.length) throw new Error("no supported Gemini model on this key");
      window._aiModelList=ms; aiModelSet(ms[0]); return ms[0];
    });
}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function modelQueue(key){
  function build(list){ var fav=aiModelGet(), q=[]; if(fav&&list.indexOf(fav)>=0)q.push(fav); list.forEach(function(m){if(q.indexOf(m)<0)q.push(m);}); if(!q.length&&fav)q.push(fav); return q; }
  if(window._aiModelList&&window._aiModelList.length) return Promise.resolve(build(window._aiModelList));
  return discoverModel(key).then(function(){return build(window._aiModelList);}, function(){ var fav=aiModelGet(); return fav?[fav]:Promise.reject(new Error("could not list models on this key")); });
}
/* Every Gemini call is time-boxed.  Without this a stalled connection leaves
   the UI sitting on "AI CONVERTING…" forever, which looks exactly like the
   button doing nothing at all. */
function fetchJson(url, opts, ms){
  var ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
  var o = {}; for(var k in (opts||{})) o[k]=opts[k];
  if(ctl) o.signal = ctl.signal;
  var timedOut = false, timer = setTimeout(function(){ timedOut = true; if(ctl) try{ctl.abort();}catch(e){} }, ms || 60000);
  return fetch(url, o).then(function(r){
    clearTimeout(timer);
    return r.json().catch(function(){ throw new Error("AI sent an unreadable reply (HTTP "+r.status+")"); });
  }, function(err){
    clearTimeout(timer);
    if(timedOut) throw new Error("AI timed out after "+Math.round((ms||60000)/1000)+"s — press ✦ AI again");
    throw new Error("network error reaching Gemini — check the connection");
  });
}
function geminiPost(key, model, body){ return fetchJson("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent?key="+encodeURIComponent(key),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}, 75000); }
function geminiGenerate(key, body){
  return modelQueue(key).then(function(q){
    var i=0, lastMsg="";
    function tryModel(model, tries){
      window._aiModel=model;
      return geminiPost(key,model,body).then(function(j){
        if(!j.error) return j;
        var msg=String(j.error.message||"AI error"), code=j.error.status||j.error.code;
        lastMsg=msg;
        if(/api key not valid|key invalid|API_KEY_INVALID/i.test(msg)||code==="PERMISSION_DENIED"||code===403) throw Object.assign(new Error(msg),{fatal:true});
        var transient=code===503||code===429||code==="UNAVAILABLE"||code==="RESOURCE_EXHAUSTED"||/high demand|currently experiencing|try again|overload|rate limit|quota/i.test(msg);
        if(transient&&tries<2) return sleep(1400*(tries+1)).then(function(){return tryModel(model,tries+1);});
        if(/not found|no longer available|deprecat|not supported/i.test(msg)){ try{localStorage.removeItem("spicy_gem_model");}catch(e){} delete window._aiModelList; }
        throw new Error(msg);
      });
    }
    function attempt(){ return tryModel(q[i],0).then(null,function(e){ if(e.fatal) throw e; i++; if(i>=q.length) throw new Error(lastMsg.slice(0,90)+" — try again shortly"); return attempt(); }); }
    return attempt();
  });
}
var AI_SEGMENT_RULES =
  "\n\nREAD EVERY LEG SEPARATELY. Each flight in the source has its OWN date, "+
  "own origin, own destination, own departure and arrival times, own aircraft, "+
  "own flight time and own distance. NEVER copy any field from one leg onto "+
  "another leg: if leg 2 is a different route or a different day, it must show "+
  "that different route and day. Output the legs in the order they are flown, "+
  "one segment per flight, and count them before you answer — the number of "+
  "segments must equal the number of flights shown in the source.";

function convertAi(fromAuto, reason){
  if(converting){
    if(!window._aiStartedAt || Date.now()-window._aiStartedAt < 12000){
      setStatus("AI ALREADY RUNNING — one moment…"); return;
    }
    aiRequestId++; // invalidate the old reply before allowing a retry
    converting=false; // stale lock (network never returned) — allow retry
  }
  if(pendingImageJobs > 0 || pendingDocumentJobs > 0){
    setStatus("ATTACHMENT STILL LOADING…");
    return;
  }
  var key=gemKey();
  if(!key){ $("setModal").classList.remove("hidden"); setStatus("AI needs a Gemini key", true); return; }
  var text=(inp.value||"").replace(/\[screenshot attached[^\n]*\]\n?/g,"");
  var fallback=lastOut;
  var requestAttachmentVersion=attachmentVersion;
  var requestAttachmentBatch=latestAttachmentBatch;
  var requestId=++aiRequestId;
  var aiImages=readyImages(), aiDocuments=readyDocuments();
  converting=true;
  window._aiStartedAt=Date.now();
  setStatus((aiImages.length||aiDocuments.length)?"AI CONVERTING (attachment)…":"AI CONVERTING…");
  var task=text.trim() ? "Convert the following flight data into GDS Black Window format. If anything is missing or ambiguous, fill it from aviation knowledge — never leave fields blank or ???."+AI_SEGMENT_RULES+"\n\n"+text
    : "Convert the attached image(s) and document(s) into GDS Black Window format. Convert ALL options shown. Fill any missing field from aviation knowledge — never blank, never ???."+AI_SEGMENT_RULES;
  var parts=[{text: task}];
  aiImages.forEach(function(im){ parts.push({inline_data:{mime_type:im.mime,data:ensureImageDataUrl(im)}}); });
  aiDocuments.forEach(function(doc){ parts.push({inline_data:{mime_type:doc.mime,data:doc.b64}}); });
  var body={ system_instruction:{parts:[{text: window.SpicyEngine.MASTER_PROMPT}]}, contents:[{role:"user",parts:parts}], generationConfig:{temperature:0.0,maxOutputTokens:4096} };
  geminiGenerate(key, body).then(function(j){
    // A newer retry or attachment edit owns the UI now. Ignore this reply
    // entirely rather than clearing its status or restoring an old itinerary.
    if(requestId!==aiRequestId) return;
    converting=false; window._aiStartedAt=0;
    if(requestAttachmentVersion!==attachmentVersion || requestAttachmentBatch!==latestAttachmentBatch){
      setStatus("AI REPLY IGNORED — attachment changed, press ✦ AI again", true);
      return;
    }
    var ps=(((j.candidates||[])[0]||{}).content||{}).parts||[];
    var t=ps.map(function(p){return p.text||"";}).join("").trim();
    if(!t) throw new Error((j.error&&j.error.message)||"empty AI reply");
    t=t.replace(/^```[a-z]*\s*/i,"").replace(/```\s*$/,"").trim();
    var rr; try{ rr=window.SpicyEngine.parse(t); }catch(e){ rr=null; }
    if(rr&&rr[0].length&&rr[0].length >= (t.split("\n").filter(function(l){return / N$/.test(l);}).length)){ t=window.SpicyEngine.renderItinerary(rr[0]); }
    var previousDirect = lastOut;
    lastOut=t; out.textContent=t;
    setStatus("AI CONVERTED"+(reason?" ("+reason+")":""));
    if(aiImages.length===1&&aiDocuments.length===0&&aiImages[0]._hash) imgCacheSet(aiImages[0]._hash, t);
    if(text.trim()){ tCacheSet(fp(text), t); lastTextFp=fp(text); }
    if(reason&&text.trim()) learnRecord(text,t,reason);

    // AI Mistake Detection & Self-Learning: detect mistakes and teach tool to fix it
    detectMistakesAndLearn(text || "[screenshot]", previousDirect, t, reason);
  }).catch(function(e){
    if(requestId!==aiRequestId || requestAttachmentVersion!==attachmentVersion || requestAttachmentBatch!==latestAttachmentBatch) return;
    converting=false; window._aiStartedAt=0;
    if(fallback){ lastOut=fallback; out.textContent=fallback; setStatus("AI failed — previous result kept", true); }
    else{ setStatus("AI failed: "+String(e.message||e).slice(0,70), true); }
  });
}

/* ---------- Weekly Report Generator ---------- */
function generateWeeklyReportText() {
  var stats = loadStats();
  var mistakes = loadMistakes();
  var rules = loadLearnedRules();
  var nowStr = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  var totalConv = stats.total || 0;
  var dirConv = (stats.textDirect || stats.textOffline || 0) + (stats.imgDirect || stats.imgOffline || 0);
  var dirRate = totalConv ? Math.round((dirConv / totalConv) * 100) : 100;

  var avgImgSpeed = "N/A";
  if (stats.durations && stats.durations.length) {
    var sum = stats.durations.reduce(function(a,b){return a+b;}, 0);
    var average = Math.round(sum / stats.durations.length);
    avgImgSpeed = average + "ms" + (average < 1000 ? " (< 1s)" : "");
  }

  var lines = [];
  lines.push("=== SPICYTERMINAL WEEKLY PERFORMANCE & ENHANCEMENT REPORT ===");
  lines.push("To: " + AUTHOR_EMAIL);
  lines.push("Generated: " + nowStr);
  lines.push("App Version: SpicyTerminal v4.0 (Instant Engine + AI Mistake Learner)");
  lines.push("");
  lines.push("--- 1. PERFORMANCE & CONVERSION STATS ---");
  lines.push("• Total Conversions: " + totalConv);
  lines.push("• Instant Conversions: " + dirConv + " (" + dirRate + "% instant rate)");
  lines.push("• Direct Screenshot Conversions: " + (stats.imgDirect || stats.imgOffline || 0));
  lines.push("• Average Screenshot Parsing Latency: " + avgImgSpeed);
  lines.push("• AI Fallback Calls (undetected only): " + (stats.aiFallback || 0));
  lines.push("");
  lines.push("--- 2. DETECTED MISTAKES & AI CORRECTIONS (" + mistakes.length + ") ---");
  if (!mistakes.length) {
    lines.push("No mistakes detected this period — direct parsing running smoothly.");
  } else {
    mistakes.slice(0, 5).forEach(function(m, idx) {
      lines.push("#" + (idx+1) + " [" + m.when + "] " + m.reason);
      lines.push("  Summary: " + m.summary);
      lines.push("  Input:   " + m.input);
      lines.push("  Direct:  " + (m.direct || m.offline || ""));
      lines.push("  AI Fix:  " + m.ai);
      lines.push("");
    });
  }
  lines.push("--- 3. ACTIVE SELF-LEARNED RULES (" + rules.length + ") ---");
  if (!rules.length) {
    lines.push("Standard aviation dictionary rules active (0 custom override rules).");
  } else {
    rules.slice(0, 10).forEach(function(r, idx) {
      lines.push("#" + (idx+1) + " [" + (r.type || "rule") + "] '" + r.pattern + "' -> '" + r.replacement + "' (" + (r.why || "") + ")");
    });
  }
  lines.push("");
  lines.push("--- 4. RECOMMENDATIONS TO ENHANCE THE TOOL TO THE MAX ---");
  lines.push("1. Direct Image Engine is operational with bounded, worker-backed offline parsing.");
  lines.push("2. Maintain continuous tracking of OCR confusions in flight numbers & day shifts.");
  lines.push("3. Keep AI strictly as fallback only for illegible or handwritten images.");
  lines.push("4. Expand local airport / airline alias mappings for emerging routes.");
  lines.push("");
  lines.push("--- TELEMETRY ENVIRONMENT ---");
  lines.push("• UserAgent: " + (navigator.userAgent || "Unknown"));
  lines.push("• Active AI Model: " + (window._aiModel || aiModelGet() || "(none used)"));
  lines.push("• OCR Engine: OCRAD + TextDetector (bundled)");
  lines.push("=============================================================");

  return lines.join("\n");
}

function openWeeklyReport() {
  var reportText = generateWeeklyReportText();
  $("reportContent").value = reportText;
  $("reportModal").classList.remove("hidden");

  // Also pre-open Gmail compose in new tab
  var mailUrl = "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(AUTHOR_EMAIL) +
                "&su=" + encodeURIComponent("SpicyTerminal Weekly Report — Performance & AI Mistake Learning") +
                "&body=" + encodeURIComponent(reportText);
  window.open(mailUrl, "_blank");
}

/* ---------- UI events ---------- */
$("btnAttach").addEventListener("click", function() { $("filePick").click(); });
$("filePick").addEventListener("change", function() {
  // Copy the FileList before resetting the input.  Resetting first is what
  // allows selecting the same attachment twice in a row in every browser.
  var fs = Array.prototype.slice.call(this.files || []);
  this.value = "";
  handleFiles(fs);
});

$("attachmentReviewClose").addEventListener("click", closeAttachmentReview);
$("attachmentReviewDone").addEventListener("click", closeAttachmentReview);
$("attachmentReviewRemove").addEventListener("click", function() {
  var id = activeReviewImageId;
  if (id) removeImage(id);
});
$("attachmentReviewModal").addEventListener("click", function(event) {
  if (event && event.target === this) closeAttachmentReview();
});
document.addEventListener("keydown", function(event) {
  if (event && event.key === "Escape" && activeReviewImageId) closeAttachmentReview();
});

// Drag & drop anywhere.  Guard dataTransfer because synthetic drag events
// and some mobile browsers omit it.
["dragenter", "dragover"].forEach(function(ev) {
  document.addEventListener(ev, function(e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }, false);
});
document.addEventListener("drop", function(e) {
  e.preventDefault();
  var dt = e.dataTransfer;
  if (!dt) return;
  if (dt.files && dt.files.length) {
    handleFiles(Array.prototype.slice.call(dt.files));
    return;
  }
  var txt = dt.getData("text/plain");
  if (txt) {
    inp.value += (inp.value ? "\n\n" : "") + txt;
    convert(false);
  }
}, false);

// Paste: screenshots are real clipboard files, not text. Always prevent the
// textarea's default image insertion and send the files through the same
// reliable attachment pipeline as the picker and drop zone.
inp.addEventListener("paste", function(e) {
  var clip = e.clipboardData || {};
  var items = clip.items || [];
  var files = [];
  var textPlain = "";
  try { textPlain = clip.getData("text/plain") || ""; } catch (err) {}
  for (var i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.indexOf("image/") === 0) {
      var f = items[i].getAsFile && items[i].getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    e.preventDefault();
    // A few clipboard providers include both OCR text and the screenshot.
    // Keep meaningful text, then parse both sources together.
    if (textPlain && textPlain.trim().length > 15) {
      inp.value += (inp.value ? "\n\n" : "") + textPlain;
    }
    handleFiles(files);
    return;
  }
  setTimeout(function() { convert(textPlain.length >= 3000); }, 0);
});

// Typing: direct text stays instant. An attachment is parsed by its own
// pipeline, so it must not be overwritten by an input event.
// Rendering is debounced instead of re-parsing/re-rendering on every keystroke;
// that cost (engine parse + DOM write + localStorage cache writes) was what
// made typing feel slow, not the converter itself.
var typeTimer = null;
inp.addEventListener("input", function() {
  if (typeTimer) clearTimeout(typeTimer);
  var len = inp.value.length;
  if (!hasAttachments()) {
    typeTimer = setTimeout(function() {
      typeTimer = null;
      try { renderDirectSync(inp.value); } catch (e) {}
    }, len < 2000 ? 55 : 80);
  }
});

$("btnConvert").addEventListener("click", function() { convert(false); });
$("btnAi").addEventListener("click", function() { convertAi(false); });
$("btnClear").addEventListener("click", function() {
  // Invalidate all in-flight image/OCR/AI callbacks before releasing their
  // canvases. They may finish later, but can no longer repaint the cleared UI.
  attachmentVersion++;
  latestAttachmentBatch++;
  cancelOcrWork();
  invalidateAiForAttachmentChange();
  images.forEach(revokeImagePreview);
  closeAttachmentReview();
  pendingImageJobs = 0;
  pendingDocumentJobs = 0;
  imageParseVersion = -1;
  imageParsePromise = null;
  inp.value = "";
  out.textContent = "";
  lastOut = "";
  images = [];
  documents = [];
  $("thumbs").innerHTML = "";
  lastTextFp = "";
  setStatus("READY");
  inp.focus();
});
$("btnCopy").addEventListener("click", function() {
  if (!lastOut) { setStatus("NOTHING TO COPY", true); return; }
  var done = function() { setStatus("COPIED ✓"); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(lastOut).then(done, function() {
      var ta = document.createElement("textarea");
      ta.value = lastOut;
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      ta.remove(); done();
    });
  } else {
    var fallback = document.createElement("textarea");
    fallback.value = lastOut; document.body.appendChild(fallback); fallback.select();
    try { document.execCommand("copy"); } catch (e) {}
    fallback.remove(); done();
  }
});

if(!localStorage.getItem("spicy_seen")) $("welcome").classList.remove("hidden");
$("enterBtn").addEventListener("click", function(){
  $("welcome").classList.add("hidden");
  try { localStorage.setItem("spicy_seen", "1"); } catch (e) {}
});
$("setClose").addEventListener("click", function(){ $("setModal").classList.add("hidden"); });
$("setSave").addEventListener("click", function(){
  try { localStorage.setItem("spicy_gem_key", $("gemKey").value.trim()); } catch (e) {}
  $("setModal").classList.add("hidden");
  setStatus("KEY SAVED");
});
function openGenKey(){
  window.open("https://aistudio.google.com/apikey", "_blank");
  $("gemKey").value = gemKey();
  $("setModal").classList.remove("hidden");
}
$("genKey").addEventListener("click", openGenKey);

// Weekly Report Modal & Buttons
if ($("btnWeeklyReport")) $("btnWeeklyReport").addEventListener("click", openWeeklyReport);
if ($("reportClose")) $("reportClose").addEventListener("click", function(){ $("reportModal").classList.add("hidden"); });
if ($("reportCopy")) $("reportCopy").addEventListener("click", function(){
  var txt = $("reportContent").value;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(function(){ setStatus("WEEKLY REPORT COPIED ✓"); });
  }
});
if ($("reportSend")) $("reportSend").addEventListener("click", function(){
  var txt = $("reportContent").value;
  var mailUrl = "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(AUTHOR_EMAIL) +
                "&su=" + encodeURIComponent("SpicyTerminal Weekly Report — Performance & AI Mistake Learning") +
                "&body=" + encodeURIComponent(txt);
  window.open(mailUrl, "_blank");
});

// Bug Report: Send to adhambadraan@gmail.com
$("report").addEventListener("click", function(){
  var input=(inp.value||"").trim(), output=lastOut||"";
  function cap(s,n){ return s.length>n ? s.slice(0,n)+"\n…[trimmed]" : s; }
  var learn=learnAll();
  var learnTxt=learn.length ? "\n=== ENGINE LEARN LOG ("+learn.length+") ===\n"+ learn.slice(0,3).map(function(l,i){ return (i+1)+") "+l.when+" — "+l.why+"\nIN : "+l.in+"\nOUT: "+l.out; }).join("\n") : "";
  var mistakes = loadMistakes();
  var mistakeTxt = mistakes.length ? "\n=== RECENT DETECTED MISTAKES ("+mistakes.length+") ===\n" + mistakes.slice(0, 3).map(function(m, i){ return (i+1)+") "+m.when+" — "+m.summary; }).join("\n") : "";

  var body="=== SPICY TERMINAL BUG REPORT ===\nTO: "+AUTHOR_EMAIL+"\nWHEN: "+new Date().toISOString().replace("T"," ").slice(0,19)+" UTC\nAI MODEL: "+(window._aiModel||aiModelGet()||"(none used)")+"\n\n=== WHAT I PASTED ===\n"+(cap(input,1300)||"(empty)")+"\n\n=== WHAT THE APP PRODUCED ===\n"+(cap(output,1300)||"(empty)")+"\n\n=== WHAT I EXPECTED INSTEAD ===\n\n\n=== ANY OTHER DETAILS ===\n"+learnTxt+mistakeTxt;
  window.open("https://mail.google.com/mail/?view=cm&fs=1&to="+encodeURIComponent(AUTHOR_EMAIL)+"&su="+encodeURIComponent("SpicyTerminal bug report")+"&body="+encodeURIComponent(body), "_blank");
});

// Boot the OCR worker during page idle (not on the first screenshot) so the
// first drop/paste converts much faster.
try {
  if (window.addEventListener) {
    window.addEventListener("load", function() { prewarmOcrWorker(250); }, { once: true });
  }
  // Safety net in case the script is injected after `load` already fired.
  setTimeout(function() { prewarmOcrWorker(0); }, 900);
} catch (e) {}
// Share the single inlined wordmark with the welcome card instead of embedding
// the same ~300KB base64 twice in the static page.
try {
  var _wmH = $("wordmarkHeader"), _wmW = $("wordmarkWelcome");
  if (_wmH && _wmW && !_wmW.getAttribute("src")) {
    _wmW.setAttribute("src", _wmH.getAttribute("src") || _wmH.src);
  }
} catch (e) {}

})();
