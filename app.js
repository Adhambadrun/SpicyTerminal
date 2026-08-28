/* app.js — SpicyTerminal Web UI — Instant Conversion & AI Self-Learner
   Features:
   - Instant screenshots: fast conversion with zero AI needed (<1s)
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
var engineWorker = null;
var lastTextFp = "";

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

  // Underscore and glyph airport repairs
  s = s.replace(/_F[KC]\b/g, "JFK");
  s = s.replace(/\b[lI1]FK\b/g, "JFK");
  s = s.replace(/\bCAl\b/g, "CAI");
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

  // Route-specific airline OCR confusion (e.g. QR read as OR when DOH is present)
  if (/DOH/i.test(s)) {
    s = s.replace(/\bOR\s+/gi, "QR ");
  }

  // 8. Glued flight numbers + airport: e.g. 114lFK -> 114 JFK, ZO4lFK -> 204 JFK
  s = s.replace(/\b([0-9A-Za-z]{1,4})[lI1]FK\b/gi, "$1 JFK");
  s = s.replace(/\b([0-9]{1,4})([A-Z]{3})\b/g, "$1 $2");

  // 9. Airline code + Flight number:
  // e.g. "IB 4z37", "QR los9", "BA ll4", "LH 4OO", "DL 001"
  var dAir = (window.SPICY_DATA && window.SPICY_DATA.airlines) ? Object.keys(window.SPICY_DATA.airlines) : [];
  if (dAir.length) {
    // OCR often returns a valid carrier in the wrong case (qR) and turns the
    // leading 1 of a flight number into an underscore or vertical bar
    // (qR _os9). Repair only the token immediately after a known carrier.
    var airLeadRe = new RegExp("\\b(" + dAir.join("|") + ")\\s+[_|Il]([0-9A-Za-z]{2,5})\\b", "gi");
    s = s.replace(airLeadRe, function(_, code, num) {
      var repaired = num.replace(/[oO]/g, "0").replace(/[sS]/g, "5")
        .replace(/[lIi|]/g, "1").replace(/[zZ]/g, "2").replace(/[gq]/g, "9");
      if (!/^1/.test(repaired)) repaired = "1" + repaired;
      return code.toUpperCase() + " " + repaired;
    });
    var caseAirRe = new RegExp("\\b(" + dAir.join("|") + ")\\b", "gi");
    s = s.replace(caseAirRe, function(_, code) { return code.toUpperCase(); });
    var airRe = new RegExp("\\b(" + dAir.join("|") + ")[ \\t]+([0-9A-Za-z]{1,5})\\b", "g");
    s = s.replace(airRe, function(match, code, num, offset) {
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

  // 9. Dates: "16 sep", "18nov", etc.
  var months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  months.forEach(function(m) {
    var re1 = new RegExp("(\\d{1,2})\\s*" + m, "gi");
    s = s.replace(re1, "$1 " + m);
    var re2 = new RegExp(m + "\\s*(\\d{1,2})", "gi");
    s = s.replace(re2, m + " $1");
  });

  return s;
}

/* ---------- high-speed image preprocessing (<100ms) ---------- */
function preprocessCanvasForOcr(srcCanvas, mode, thresholdVal) {
  var w = srcCanvas.width, h = srcCanvas.height;
  var targetW = w, targetH = h;

  // Glyph height needs to be ~25-35px for clean OCRAD recognition.
  // If height is small (e.g. < 280px for a flight card row), upscale up to 3x!
  if (h < 260) {
    var scale = Math.min(3.0, 480 / h);
    targetW = Math.round(w * scale);
    targetH = Math.round(h * scale);
  } else if (w < 800) {
    var factor = Math.min(2.0, 1000 / w);
    targetW = Math.round(w * factor);
    targetH = Math.round(h * factor);
  } else if (w > 1600) {
    var factor = 1400 / w;
    targetW = Math.round(w * factor);
    targetH = Math.round(h * factor);
  }

  var cv = document.createElement("canvas");
  cv.width = targetW;
  cv.height = targetH;
  var ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(srcCanvas, 0, 0, targetW, targetH);

  var imgData = ctx.getImageData(0, 0, targetW, targetH);
  var data = imgData.data;
  var len = data.length;

  // 1. Full image luminance histogram to accurately detect background mode
  var hist = new Uint32Array(256);
  var minLum = 255, maxLum = 0;
  for (var i = 0; i < len; i += 4) {
    var lum = (data[i] * 299 + data[i+1] * 587 + data[i+2] * 114) / 1000 | 0;
    hist[lum]++;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }
  var bgLum = 0, maxCount = 0;
  for (var k = 0; k < 256; k++) {
    if (hist[k] > maxCount) { maxCount = hist[k]; bgLum = k; }
  }

  // Determine whether to invert:
  // If mode === "invert", force invert. If mode === "normal", force normal.
  // If mode === "auto", dark background (bgLum < 128) -> invert so text is black on white.
  var isDark = (mode === "invert") ? true : (mode === "normal") ? false : (bgLum < 128);

  // 2. Grayscale & conditional inversion
  var grays = new Uint8ClampedArray(targetW * targetH);
  var p = 0;
  for (var i = 0; i < len; i += 4) {
    var r = data[i], g = data[i+1], b = data[i+2];
    if (isDark) { r = 255 - r; g = 255 - g; b = 255 - b; }
    var gl = (r * 299 + g * 587 + b * 114) / 1000;
    grays[p++] = gl;
  }

  if (mode === "gray") {
    var range = Math.max(1, maxLum - minLum);
    p = 0;
    for (var i = 0; i < len; i += 4) {
      var gNorm = Math.round(((grays[p++] - minLum) / range) * 255);
      data[i] = gNorm; data[i+1] = gNorm; data[i+2] = gNorm; data[i+3] = 255;
    }
  } else {
    var thresh = thresholdVal || 150;
    p = 0;
    for (var i = 0; i < len; i += 4) {
      var val = grays[p++] > thresh ? 255 : 0;
      data[i] = val; data[i+1] = val; data[i+2] = val; data[i+3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return cv;
}

/* ---------- instant image parsing engine (<1 second) ---------- */
function parseImageDirect(im) {
  return new Promise(function(resolve) {
    var t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    var settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    function begin(srcCv) {
      if (!srcCv || !srcCv.width || !srcCv.height) {
        finish({ segs: [], warns: ["Image has no readable pixels"], text: "", method: "none", dur: 0 });
        return;
      }

      // Pass 1: native TextDetector where available (usually hardware
      // accelerated).  It is optional and never allowed to block OCRAD.
      if (window.TextDetector) {
        try {
          var td = new window.TextDetector();
          Promise.resolve(td.detect(srcCv)).then(function(detected) {
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
          }, function() { runOcradPasses(); });
          return;
        } catch (e) { /* fall through to OCRAD */ }
      }
      runOcradPasses();

      function elapsed() {
        return Math.round(((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t0);
      }
      function runOcradPasses() {
        if (typeof window.OCRAD !== "function") {
          finish({ segs: [], warns: ["OCR engine not available"], text: "", method: "none", dur: elapsed() });
          return;
        }

        // The first pass handles normal screenshots.  More expensive passes
        // only run when the fast path cannot produce a flight, keeping the
        // common case very quick without sacrificing difficult screenshots.
        var passes = [
          { mode: "auto", thresh: 150, label: "auto (150)" },
          { mode: "auto", thresh: 175, label: "auto (175)" },
          { mode: "auto", thresh: 125, label: "auto (125)" },
          { mode: "invert", thresh: 150, label: "inverted" },
          { mode: "normal", thresh: 150, label: "normal" },
          { mode: "gray", thresh: 0, label: "grayscale" }
        ];
        var bestRaw = "";
        for (var pIdx = 0; pIdx < passes.length; pIdx++) {
          try {
            var cfg = passes[pIdx];
            var procCv = preprocessCanvasForOcr(srcCv, cfg.mode, cfg.thresh);
            var raw = window.OCRAD(procCv) || "";
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
          } catch (passErr) { /* try the next preprocessing mode */ }
        }

        if (bestRaw.trim().length > 5) {
          var cleanedFinal = cleanOcrText(bestRaw);
          var resFinal = window.SpicyEngine.parse(cleanedFinal);
          if (resFinal[0] && resFinal[0].length > 0) {
            finish({ segs: resFinal[0], warns: resFinal[1], text: cleanedFinal,
              rawOcr: bestRaw, method: "OCRAD (best text)", dur: elapsed() });
            return;
          }
        }
        finish({ segs: [], warns: ["Could not detect flights"], text: bestRaw,
          method: "OCRAD (failed)", dur: elapsed() });
      }
    }

    // fastDownscale retains the canvas, avoiding a second base64 decode in
    // the normal path.  The data URL fallback keeps this function reusable.
    if (im.canvas) {
      begin(im.canvas);
      return;
    }
    var img = new Image();
    img.onload = function() {
      var srcCv = document.createElement("canvas");
      srcCv.width = img.naturalWidth || img.width;
      srcCv.height = img.naturalHeight || img.height;
      var ctx = srcCv.getContext("2d");
      if (!ctx) { finish({ segs: [], warns: ["Canvas is not available"], text: "", method: "none", dur: 0 }); return; }
      ctx.drawImage(img, 0, 0);
      begin(srcCv);
    };
    img.onerror = function() { finish({ segs: [], warns: ["Image load failed"], text: "", method: "none", dur: 0 }); };
    img.src = "data:" + im.mime + ";base64," + im.b64;
  });
}

/* ---------- attachment helpers ---------- */
function readyImages() { return images.filter(function(im) { return !!im; }); }
function readyDocuments() { return documents.filter(function(doc) { return !!doc; }); }
function hasAttachments() { return readyImages().length > 0 || readyDocuments().length > 0 || pendingImageJobs > 0 || pendingDocumentJobs > 0; }
function fileName(file) { return String((file && file.name) || "attachment"); }
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
        var b64 = cv.toDataURL(outMime, outMime === "image/png" ? 1 : quality).split(",")[1];
        ok({ mime: outMime, b64: b64, w: cv.width, h: cv.height, canvas: cv,
          _hash: hashStr(outMime + "|" + cv.width + "x" + cv.height + "|" + b64.slice(0, 2000)) });
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

function addThumb(im, slot) {
  var img = new Image();
  img.onload = function() {
    var ts = Math.min(26 / img.height, 56 / img.width);
    var th = document.createElement("canvas");
    th.width = Math.max(1, Math.round(img.width * ts));
    th.height = Math.max(1, Math.round(img.height * ts));
    var ctx = th.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, th.width, th.height);
    var ti = document.createElement("img");
    ti.src = th.toDataURL("image/jpeg", 0.5);
    ti.alt = fileName(im);
    ti.title = fileName(im) + " attached";
    $("thumbs").appendChild(ti);
  };
  img.src = "data:" + im.mime + ";base64," + im.b64;
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
  images.push(null); // reserves picker order while decoding happens asynchronously
  pendingImageJobs++;
  setStatus("IMAGE ATTACHING…");
  return fastDownscale(file, 1600, 0.88).then(function(im) {
    if (token !== attachmentVersion) return null;
    im.name = fileName(file);
    images[slot] = im;
    addThumb(im, slot);
    return im;
  }, function(err) {
    if (token === attachmentVersion) setStatus("IMAGE FAILED — " + fileName(file) + " — " + String(err.message || err).slice(0, 70), true);
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

  if (allSegs.length) {
    var outText = window.SpicyEngine.renderItinerary(allSegs);
    lastOut = outText;
    out.innerHTML = esc(outText);
    var ms = Math.round(((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - started);
    setStatus("IMAGE PARSED — " + allSegs.length + " seg(s) (" + ms + "ms)" + (warns.length ? "  ·  " + warns.join(" · ") : ""), warns.length > 0);
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
      out.innerHTML = esc(cached.out);
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
    if (readyImages().length) {
      if (pendingImageJobs === 0) convertImageAttachments(latestAttachmentBatch);
    } else if (gemKey()) {
      convertAi(true, "PDF attachment");
    } else {
      setStatus("PDF ATTACHED — AI AUTO needs a Gemini key", true);
    }
  }));
  if (imageJobs.length) tasks.push(Promise.all(imageJobs).then(function() {
    if (token === attachmentVersion && pendingImageJobs === 0) convertImageAttachments(latestAttachmentBatch);
  }));
  var unsupported = arr.filter(function(_, i) { return kinds[i] === "unsupported"; });
  if (unsupported.length) setStatus("UNSUPPORTED ATTACHMENT — " + fileName(unsupported[0]), true);
  if (!tasks.length && !unsupported.length) setStatus("NO READABLE ATTACHMENTS", true);
}
function handleFiles(fileList) {
  var arr = Array.prototype.slice.call(fileList || []);
  if (!arr.length) return;
  var token = attachmentVersion;
  var batch = ++latestAttachmentBatch;
  // A new attachment is a new conversion request; never leave the previous
  // itinerary copyable while the replacement is being decoded.
  out.innerHTML = "";
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
  if(!segs.length) { lastOut=""; out.innerHTML=""; return {segs:segs,warns:warns,out:""}; }
  var outText = window.SpicyEngine.renderItinerary(segs);
  lastOut = outText;
  out.innerHTML = esc(outText);
  var msg = "CONVERTED — "+segs.length+" segment(s)";
  if(warns.length) msg+="  ·  "+warns.join(" · ");
  setStatus(msg, warns.length>0);
  tCacheSet(fp(text), outText);
  recordStat("text_direct");
  return {segs:segs,warns:warns,out:outText};
}

function convert(auto) {
  if (converting) return;
  var raw = inp.value || "";
  var text = raw.replace(/\[screenshot attached[^\n]*\]\n?/g, "");
  var imgs = readyImages();
  var docs = readyDocuments();
  var hasImg = imgs.length > 0;
  var hasAnyAttachment = hasAttachments();
  if (!text.trim() && !hasAnyAttachment) {
    out.innerHTML = "";
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
      out.innerHTML = esc(tc.out);
      lastTextFp = h;
      setStatus("CACHED TEXT — instant — " + (tc.out.split("\n").filter(function(l) { return / N$/.test(l); }).length) + " segs");
      return;
    }
  }

  // Images are parsed together, in attachment order. This fixes the old
  // first-image-only behavior and prevents concurrent OCR callbacks from
  // overwriting each other.
  if (hasImg) {
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
  return fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key="+encodeURIComponent(key))
    .then(function(r){return r.json();}).then(function(j){
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
function geminiPost(key, model, body){ return fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent?key="+encodeURIComponent(key),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json();}); }
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
function convertAi(fromAuto, reason){
  if(converting) return;
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
  var aiImages=readyImages(), aiDocuments=readyDocuments();
  converting=true;
  setStatus((aiImages.length||aiDocuments.length)?"AI CONVERTING (attachment)…":"AI CONVERTING…");
  var task=text.trim() ? "Convert the following flight data into GDS Black Window format. If anything is missing or ambiguous, fill it from aviation knowledge — never leave fields blank or ???.\n\n"+text
    : "Convert the attached image(s) and document(s) into GDS Black Window format. Convert ALL options shown. Fill any missing field from aviation knowledge — never blank, never ???.";
  var parts=[{text: task}];
  aiImages.forEach(function(im){ parts.push({inline_data:{mime_type:im.mime,data:im.b64}}); });
  aiDocuments.forEach(function(doc){ parts.push({inline_data:{mime_type:doc.mime,data:doc.b64}}); });
  var body={ system_instruction:{parts:[{text: window.SpicyEngine.MASTER_PROMPT}]}, contents:[{role:"user",parts:parts}], generationConfig:{temperature:0.0,maxOutputTokens:4096} };
  geminiGenerate(key, body).then(function(j){
    converting=false;
    if(requestAttachmentVersion!==attachmentVersion || requestAttachmentBatch!==latestAttachmentBatch) return;
    var ps=(((j.candidates||[])[0]||{}).content||{}).parts||[];
    var t=ps.map(function(p){return p.text||"";}).join("").trim();
    if(!t) throw new Error((j.error&&j.error.message)||"empty AI reply");
    t=t.replace(/^```[a-z]*\s*/i,"").replace(/```\s*$/,"").trim();
    var rr; try{ rr=window.SpicyEngine.parse(t); }catch(e){ rr=null; }
    if(rr&&rr[0].length&&rr[0].length >= (t.split("\n").filter(function(l){return / N$/.test(l);}).length)){ t=window.SpicyEngine.renderItinerary(rr[0]); }
    var previousDirect = lastOut;
    lastOut=t; out.innerHTML=esc(t);
    setStatus("AI CONVERTED"+(reason?" ("+reason+")":""));
    if(aiImages.length===1&&aiDocuments.length===0&&aiImages[0]._hash) imgCacheSet(aiImages[0]._hash, t);
    if(text.trim()){ tCacheSet(fp(text), t); lastTextFp=fp(text); }
    if(reason&&text.trim()) learnRecord(text,t,reason);

    // AI Mistake Detection & Self-Learning: detect mistakes and teach tool to fix it
    detectMistakesAndLearn(text || "[screenshot]", previousDirect, t, reason);
  }).catch(function(e){
    converting=false;
    if(fallback){ lastOut=fallback; out.innerHTML=esc(fallback); setStatus("AI failed — previous result kept", true); }
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
    avgImgSpeed = Math.round(sum / stats.durations.length) + "ms (< 1s)";
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
  lines.push("1. Direct Image Engine is operational with zero AI dependency and under-a-second parsing.");
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
var typeTimer = null;
inp.addEventListener("input", function() {
  if (typeTimer) clearTimeout(typeTimer);
  var len = inp.value.length;
  if (len < 2000) {
    if (!hasAttachments()) {
      try { renderDirectSync(inp.value); } catch (e) {}
    }
  } else {
    typeTimer = setTimeout(function() { convert(true); }, 80);
  }
});

$("btnConvert").addEventListener("click", function() { convert(false); });
$("btnAi").addEventListener("click", function() { convertAi(false); });
$("btnClear").addEventListener("click", function() {
  // Invalidate all in-flight image/OCR/AI callbacks before releasing their
  // canvases. They may finish later, but can no longer repaint the cleared UI.
  attachmentVersion++;
  latestAttachmentBatch++;
  pendingImageJobs = 0;
  pendingDocumentJobs = 0;
  imageParseVersion = -1;
  imageParsePromise = null;
  inp.value = "";
  out.innerHTML = "";
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

})();
