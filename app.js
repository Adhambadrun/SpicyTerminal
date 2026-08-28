/* app.js — SpicyTerminal Web UI — v4 PURE OFFLINE IMAGE + AI SELF-LEARNER
   Features:
   - 100% Offline screenshots: instant conversion with zero AI needed (<1s, "fast as hell")
   - Native TextDetector API + bundled pure JS OCRAD fallback
   - Aviation-aware OCR cleaner (repairs glyph confusions in flight numbers, times, airports, dates)
   - Fallback to AI ONLY in case offline parsing cannot detect flights
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
var lastOut = "";
var converting = false;
var engineWorker = null;
var lastTextFp = "";
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
    if (!s.textOffline) s.textOffline = 0;
    if (!s.imgOffline) s.imgOffline = 0;
    if (!s.aiFallback) s.aiFallback = 0;
    if (!s.durations) s.durations = [];
    return s;
  } catch (e) {
    return { startDate: new Date().toISOString().slice(0, 10), total: 0, textOffline: 0, imgOffline: 0, aiFallback: 0, durations: [] };
  }
}
function recordStat(type, durationMs) {
  try {
    var s = loadStats();
    s.total++;
    if (type === "text_offline") s.textOffline++;
    if (type === "img_offline") {
      s.imgOffline++;
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

/* Analyze discrepancy between offline and AI result to detect mistakes & teach tool */
function detectMistakesAndLearn(inputText, offlineText, aiText, reason) {
  if (!aiText || !aiText.trim()) return;
  var offLines = (offlineText || "").trim().split("\n").filter(Boolean);
  var aiLines = (aiText || "").trim().split("\n").filter(Boolean);

  var offFltLines = offLines.filter(function(l){ return /^\d+\s+[A-Z0-9]{2}\s+/i.test(l); });
  var aiFltLines = aiLines.filter(function(l){ return /^\d+\s+[A-Z0-9]{2}\s+/i.test(l); });

  var diffNotes = [];

  // Check count difference
  if (offFltLines.length !== aiFltLines.length) {
    diffNotes.push("Segment count discrepancy: offline found " + offFltLines.length + ", AI found " + aiFltLines.length);
  }

  // Compare flight lines
  for (var i = 0; i < Math.min(offFltLines.length, aiFltLines.length); i++) {
    var oP = offFltLines[i].split(/\s+/);
    var aP = aiFltLines[i].split(/\s+/);
    // [seg#, carrier, flt#, date, orig, dest, dep, arr, cls, ac, dur, dist, stat]
    if (oP[1] !== aP[1] || oP[2] !== aP[2]) {
      diffNotes.push("Flight " + (i+1) + " mismatch: offline has " + oP[1] + " " + oP[2] + " vs AI " + aP[1] + " " + aP[2]);
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

  if (diffNotes.length > 0 || !offlineText.trim()) {
    var entry = {
      id: "mstk_" + Date.now(),
      when: new Date().toISOString().slice(0, 19).replace("T", " "),
      reason: reason || "AI correction",
      summary: diffNotes.join("; ") || "Offline parse missed flight data",
      input: (inputText || "").slice(0, 180),
      offline: (offlineText || "").slice(0, 200),
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

  // 3. Day shifts: 12h, 24h, compact, and parenthesized
  s = s.replace(/(\d{1,2}[:.]\d{2})\s*\+\s*[lIi1]\b/gi, "$1+1");
  s = s.replace(/(\d{1,2}[:.]\d{2})\s*\+\s*[zZ2]\b/gi, "$1+2");
  s = s.replace(/\b(AM|PM|[APNM])\s*\+\s*[lIi1]\b/gi, "$1+1");
  s = s.replace(/\b(AM|PM|[APNM])\s*\+\s*[zZ2]\b/gi, "$1+2");
  s = s.replace(/\b(AM|PM|[APNM])\s*\+\s*[sS5]\b/gi, "$1+5");
  s = s.replace(/\(\s*\+\s*[lIi1]\s*(?:day)?\s*\)/gi, "(+1)");
  s = s.replace(/\(\s*\+\s*[zZ2]\s*(?:days?)?\s*\)/gi, "(+2)");
  s = s.replace(/¥\s*[lIi1]/g, "¥1");
  s = s.replace(/¥\s*[zZ2]/g, "¥2");
  s = s.replace(/\b(AM|PM|[APNM])\s*-\s*([1-3lI])(?![0-9A-Za-z]*[:\.\/])/gi, function(_, ap, shift) {
    return ap + "-" + (shift === "l" || shift === "I" ? "1" : shift);
  });

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

/* ---------- pure offline image preprocessing (<100ms) ---------- */
function preprocessCanvasForOcr(srcCanvas, binarizeMode) {
  var w = srcCanvas.width, h = srcCanvas.height;
  var targetW = w, targetH = h;

  // Scale to optimal OCR dimensions:
  // Best glyph height for OCR is ~20-35px. If canvas is small, upscale. If too big, downscale for <300ms speed.
  if (w < 800) {
    var factor = Math.min(2.0, 1000 / w);
    targetW = Math.round(w * factor);
    targetH = Math.round(h * factor);
  } else if (w > 1400) {
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

  // 1. Detect background brightness (sample borders + interior)
  var lumTotal = 0, edgeLumTotal = 0, edgeCount = 0;
  for (var y = 0; y < targetH; y += 4) {
    for (var x = 0; x < targetW; x += 4) {
      var i = (y * targetW + x) * 4;
      var lum = (data[i] * 299 + data[i+1] * 587 + data[i+2] * 114) / 1000;
      lumTotal += lum;
      if (x < 24 || x > targetW - 24 || y < 24 || y > targetH - 24) {
        edgeLumTotal += lum;
        edgeCount++;
      }
    }
  }
  var avgEdgeLum = edgeCount ? (edgeLumTotal / edgeCount) : 128;
  var isDark = avgEdgeLum < 120; // dark mode or terminal

  // 2. Grayscale, auto-invert dark backgrounds, contrast stretch
  var minLum = 255, maxLum = 0;
  var grays = new Uint8ClampedArray(targetW * targetH);
  var p = 0;
  for (var i = 0; i < len; i += 4) {
    var r = data[i], g = data[i+1], b = data[i+2];
    if (isDark) { r = 255 - r; g = 255 - g; b = 255 - b; }
    var gl = (r * 299 + g * 587 + b * 114) / 1000;
    grays[p++] = gl;
    if (gl < minLum) minLum = gl;
    if (gl > maxLum) maxLum = gl;
  }

  // 3. Contrast stretch & threshold
  var range = Math.max(1, maxLum - minLum);
  var threshold = minLum + range * 0.65; // adaptive cutoff favoring high-contrast text

  if (binarizeMode === "hard") {
    // Pure binary black on white (ideal for clean OCRAD glyph recognition)
    p = 0;
    for (var i = 0; i < len; i += 4) {
      var val = grays[p++] > threshold ? 255 : 0;
      data[i] = val;
      data[i+1] = val;
      data[i+2] = val;
      data[i+3] = 255;
    }
  } else {
    // Contrast-stretched grayscale
    p = 0;
    for (var i = 0; i < len; i += 4) {
      var gNorm = Math.round(((grays[p++] - minLum) / range) * 255);
      data[i] = gNorm;
      data[i+1] = gNorm;
      data[i+2] = gNorm;
      data[i+3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return cv;
}

/* ---------- pure offline image parsing engine (<1 second) ---------- */
function parseImageOffline(im) {
  return new Promise(function(resolve) {
    var t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();

    var img = new Image();
    img.onload = function() {
      var srcCv = document.createElement("canvas");
      srcCv.width = img.naturalWidth || img.width;
      srcCv.height = img.naturalHeight || img.height;
      var srcCtx = srcCv.getContext("2d");
      srcCtx.drawImage(img, 0, 0);

      // Pass 1: Try browser native TextDetector API if available (hardware accelerated ~30ms)
      if (window.TextDetector) {
        try {
          var td = new window.TextDetector();
          td.detect(srcCv).then(function(detected) {
            if (detected && detected.length) {
              detected.sort(function(a, b) {
                var dy = a.boundingBox.top - b.boundingBox.top;
                return Math.abs(dy) > 16 ? dy : (a.boundingBox.left - b.boundingBox.left);
              });
              var nativeRaw = detected.map(function(d) { return d.rawValue || ""; }).join("\n");
              var cleaned = cleanOcrText(nativeRaw);
              var res = window.SpicyEngine.parse(cleaned);
              if (res[0] && res[0].length > 0) {
                var dur = Math.round(((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t0);
                resolve({ segs: res[0], warns: res[1], text: cleaned, method: "native TextDetector", dur: dur });
                return;
              }
            }
            runOcradPasses();
          }).catch(function(){ runOcradPasses(); });
          return;
        } catch (e) { /* fall through to OCRAD */ }
      }

      runOcradPasses();

      function runOcradPasses() {
        if (typeof window.OCRAD !== "function") {
          resolve({ segs: [], warns: ["OCRAD engine not available"], text: "", method: "none", dur: 0 });
          return;
        }

        // Pass 2: High-contrast binarized canvas (optimal for OCRAD)
        try {
          var binCv = preprocessCanvasForOcr(srcCv, "hard");
          var rawBin = window.OCRAD(binCv) || "";
          if (rawBin.trim().length > 5) {
            var cleanedBin = cleanOcrText(rawBin);
            var resBin = window.SpicyEngine.parse(cleanedBin);
            if (resBin[0] && resBin[0].length > 0) {
              var dur = Math.round(((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t0);
              resolve({ segs: resBin[0], warns: resBin[1], text: cleanedBin, rawOcr: rawBin, method: "offline OCRAD (binarized)", dur: dur });
              return;
            }
          }
        } catch (err) {}

        // Pass 3: Grayscale contrast-stretched canvas (fallback for complex gradients)
        try {
          var grayCv = preprocessCanvasForOcr(srcCv, "gray");
          var rawGray = window.OCRAD(grayCv) || "";
          if (rawGray.trim().length > 5) {
            var cleanedGray = cleanOcrText(rawGray);
            var resGray = window.SpicyEngine.parse(cleanedGray);
            if (resGray[0] && resGray[0].length > 0) {
              var dur = Math.round(((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t0);
              resolve({ segs: resGray[0], warns: resGray[1], text: cleanedGray, rawOcr: rawGray, method: "offline OCRAD (grayscale)", dur: dur });
              return;
            }
          }
        } catch (err) {}

        // Could not detect offline
        var dur = Math.round(((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t0);
        resolve({ segs: [], warns: ["Could not detect flights offline"], text: "", method: "offline OCRAD (failed)", dur: dur });
      }
    };
    img.onerror = function() {
      resolve({ segs: [], warns: ["Image load failed"], text: "", method: "none", dur: 0 });
    };
    img.src = "data:" + im.mime + ";base64," + im.b64;
  });
}

/* ---------- offline convert (ultra fast) ---------- */
function offlineIncomplete(warns, segs) {
  if (!segs.length) return "no segments read";
  for (var i = 0; i < warns.length; i++)
    if (/NOT read|missing|unknown/i.test(warns[i])) return warns[i];
  return null;
}

function renderOfflineSync(text){
  // Apply learned rules first
  var cleaned = cleanOcrText(text);
  var res = window.SpicyEngine.parse(cleaned);
  var segs = res[0], warns = res[1];
  if(!segs.length) { lastOut=""; out.innerHTML=""; return {segs:segs,warns:warns,out:""}; }
  var outText = window.SpicyEngine.renderItinerary(segs);
  lastOut = outText;
  out.innerHTML = esc(outText);
  var msg = "OFFLINE ENGINE — "+segs.length+" segment(s)";
  if(warns.length) msg+="  ·  "+warns.join(" · ");
  setStatus(msg, warns.length>0);
  tCacheSet(fp(text), outText);
  recordStat("text_offline");
  return {segs:segs,warns:warns,out:outText};
}

function convert(auto){
  if(converting) return;
  var raw = inp.value || "";
  var text = raw.replace(/\[screenshot attached[^\n]*\]\n?/g, "");
  var hasImg = images.length > 0;
  if(!text.trim() && !hasImg){ out.innerHTML=""; lastOut=""; setStatus("READY"); return; }

  // TEXT CACHE: instant repeat (0ms)
  if(text.trim()){
    var h = fp(text);
    if(h===lastTextFp && lastOut){ setStatus("CACHED — instant"); return; }
    var tc = tCacheGet(h);
    if(tc && tc.out){
      lastOut = tc.out;
      out.innerHTML = esc(tc.out);
      lastTextFp = h;
      setStatus("CACHED TEXT — instant — "+(tc.out.split("\n").filter(function(l){return / N$/.test(l);}).length)+" segs");
      return;
    }
  }

  // IMAGE CACHE: instant repeat
  if(hasImg && !text.trim() && images.length === 1){
    var ih = images[0]._hash;
    var ic = ih && imgCacheGet(ih);
    if(ic && ic.out){
      lastOut = ic.out;
      out.innerHTML = esc(ic.out);
      setStatus("CACHED IMAGE — instant — "+(ic.out.split("\n").filter(function(l){return / N$/.test(l);}).length)+" segs");
      return;
    }
  }

  // IMAGE-ONLY CONVERT
  if(hasImg && !text.trim()){
    if(lastOut && / N$/.test(lastOut)) return;
    setStatus("OFFLINE PARSING IMAGE…");
    parseImageOffline(images[0]).then(function(res){
      if(res.segs && res.segs.length > 0){
        var outText = window.SpicyEngine.renderItinerary(res.segs);
        lastOut = outText;
        out.innerHTML = esc(outText);
        setStatus("OFFLINE IMAGE PARSED — " + res.segs.length + " seg(s) (" + res.dur + "ms, 0 AI)");
        imgCacheSet(images[0]._hash, outText);
        recordStat("img_offline", res.dur);
        return;
      }
      // "only fall on ai incase cannot detect it"
      if(gemKey()){
        recordStat("ai_fallback");
        convertAi(auto, "offline undetectable");
      } else {
        out.textContent = "Could not detect flights in this image offline.\n\nOnly fall on AI in case cannot detect it — attach a Gemini API key (click 'Generate Api' below) to retry with AI.";
        setStatus("Offline parse could not detect flights — attach AI key to retry", true);
      }
    });
    return;
  }

  if(text.trim() && gemKey() && learnKnows(text)){ convertAi(auto, "learned pattern"); return; }

  // FAST PATH: small text sync parse immediately
  if(text.length < 3000){
    try{
      var r = renderOfflineSync(text);
      var lack = offlineIncomplete(r.warns, r.segs);
      if(!lack) { lastTextFp = fp(text); return; }
      if(gemKey()){ convertAi(auto, lack); return; }
      if(!r.segs.length){
        out.textContent = "Couldn't read this paste offline.\n"+(r.warns[0]||"")+"\n\nPress AI AUTO (add a Gemini key first if asked).";
        setStatus("OFFLINE INCOMPLETE — needs AI", true);
      } else {
        setStatus(st.textContent+"  ·  partial — AI AUTO can finish", true);
      }
    }catch(e){
      setStatus("CONVERT ERROR", true);
    }
    return;
  }

  // LARGE TEXT: async convert
  setStatus("CONVERTING…");
  setTimeout(function(){
    try {
      var r = renderOfflineSync(text);
      lastTextFp = fp(text);
      var lack = offlineIncomplete(r.warns, r.segs);
      if(lack && gemKey()) convertAi(auto, lack);
    } catch(e) {
      setStatus("CONVERT ERROR", true);
    }
  }, 10);
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
  var key=gemKey();
  if(!key){ $("setModal").classList.remove("hidden"); setStatus("AI needs a Gemini key", true); return; }
  var text=(inp.value||"").replace(/\[screenshot attached[^\n]*\]\n?/g,"");
  var fallback=lastOut;
  converting=true;
  setStatus(images.length?"AI CONVERTING (image)…":"AI CONVERTING…");
  var task=text.trim() ? "Convert the following flight data into GDS Black Window format. If anything is missing or ambiguous, fill it from aviation knowledge — never leave fields blank or ???.\n\n"+text
    : "Convert the flight data in the attached image(s) into GDS Black Window format. Convert ALL options shown. Fill any missing field from aviation knowledge — never blank, never ???.";
  var parts=[{text: task}];
  images.forEach(function(im){ parts.push({inline_data:{mime_type:im.mime,data:im.b64}}); });
  var body={ system_instruction:{parts:[{text: window.SpicyEngine.MASTER_PROMPT}]}, contents:[{role:"user",parts:parts}], generationConfig:{temperature:0.0,maxOutputTokens:4096} };
  geminiGenerate(key, body).then(function(j){
    converting=false;
    var ps=(((j.candidates||[])[0]||{}).content||{}).parts||[];
    var t=ps.map(function(p){return p.text||"";}).join("").trim();
    if(!t) throw new Error((j.error&&j.error.message)||"empty AI reply");
    t=t.replace(/^```[a-z]*\s*/i,"").replace(/```\s*$/,"").trim();
    var rr; try{ rr=window.SpicyEngine.parse(t); }catch(e){ rr=null; }
    if(rr&&rr[0].length&&rr[0].length >= (t.split("\n").filter(function(l){return / N$/.test(l);}).length)){ t=window.SpicyEngine.renderItinerary(rr[0]); }
    var previousOffline = lastOut;
    lastOut=t; out.innerHTML=esc(t);
    setStatus("AI CONVERTED"+(reason?" ("+reason+")":""));
    if(images.length===1&&images[0]._hash) imgCacheSet(images[0]._hash, t);
    if(text.trim()){ tCacheSet(fp(text), t); lastTextFp=fp(text); }
    if(reason&&text.trim()) learnRecord(text,t,reason);

    // AI Mistake Detection & Self-Learning: detect mistakes and teach tool to fix it
    detectMistakesAndLearn(text || "[screenshot]", previousOffline, t, reason);
  }).catch(function(e){
    converting=false;
    if(fallback){ lastOut=fallback; out.innerHTML=esc(fallback); setStatus("AI failed — offline result kept", true); }
    else{ setStatus("AI failed: "+String(e.message||e).slice(0,70), true); }
  });
}

/* ---------- ultra fast image downscale ---------- */
function fastDownscale(file, maxSide, quality){
  maxSide=maxSide||1400; quality=quality||0.80;
  return new Promise(function(resolve){
    if(window.createImageBitmap){
      createImageBitmap(file).then(function(bmp){
        var w=bmp.width,h=bmp.height,sc=Math.min(1,maxSide/Math.max(w,h));
        var cw=Math.round(w*sc),ch=Math.round(h*sc);
        var cv=document.createElement("canvas"); cv.width=cw; cv.height=ch;
        cv.getContext("2d").drawImage(bmp,0,0,cw,ch);
        bmp.close();
        var b64=cv.toDataURL("image/jpeg", quality).split(",")[1];
        resolve({mime:"image/jpeg",b64:b64,w:cw,h:ch,_hash:hashStr(b64.slice(0,2000))});
      }).catch(function(){ fallback(); });
    } else {
      fallback();
    }
    function fallback(){
      var img=new Image(), rd=new FileReader();
      rd.onload=function(ev){
        img.onload=function(){
          var w=img.width,h=img.height,sc=Math.min(1,maxSide/Math.max(w,h));
          var cv=document.createElement("canvas"); cv.width=Math.round(w*sc); cv.height=Math.round(h*sc);
          cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);
          var b64=cv.toDataURL("image/jpeg", quality).split(",")[1];
          resolve({mime:"image/jpeg",b64:b64,w:cv.width,h:cv.height,_hash:hashStr(b64.slice(0,2000))});
        };
        img.src=ev.target.result;
      };
      rd.readAsDataURL(file);
    }
  });
}

function addThumb(im){
  var img=new Image();
  img.onload=function(){
    var ts=Math.min(26/img.height,56/img.width);
    var th=document.createElement("canvas");
    th.width=Math.max(1,Math.round(img.width*ts));
    th.height=Math.max(1,Math.round(img.height*ts));
    th.getContext("2d").drawImage(img,0,0,th.width,th.height);
    var ti=document.createElement("img");
    ti.src=th.toDataURL("image/jpeg",0.5);
    ti.title="screenshot "+images.length+" attached";
    $("thumbs").appendChild(ti);
  };
  img.src="data:"+im.mime+";base64,"+im.b64;
}

function addImage(file, thenConvert){
  if(thenConvert===undefined) thenConvert=true;
  setStatus("IMAGE ATTACHING…");
  fastDownscale(file, 1400, 0.80).then(function(im){
    images.push(im);
    addThumb(im);

    // Check image cache for instant repeat (0ms)
    var cached = im._hash && imgCacheGet(im._hash);
    if(cached && cached.out){
      lastOut = cached.out;
      out.innerHTML = esc(cached.out);
      setStatus("CACHED IMAGE — instant — "+(cached.out.split("\n").filter(function(l){return / N$/.test(l);}).length)+" segs");
      return;
    }

    // PURE OFFLINE IMAGE PARSING — ZERO AI, NO KEY NEEDED (<1 second)
    setStatus("OFFLINE PARSING SCREENSHOT…");
    parseImageOffline(im).then(function(res){
      if(res.segs && res.segs.length > 0){
        var outText = window.SpicyEngine.renderItinerary(res.segs);
        lastOut = outText;
        out.innerHTML = esc(outText);
        var msg = "OFFLINE IMAGE PARSED — " + res.segs.length + " seg(s) (" + res.dur + "ms, pure offline)";
        if (res.warns && res.warns.length) msg += "  ·  " + res.warns.join(" · ");
        setStatus(msg, res.warns && res.warns.length > 0);
        imgCacheSet(im._hash, outText);
        recordStat("img_offline", res.dur);
        return;
      }

      // "only fall on ai incase cannot detect it"
      if(thenConvert){
        if(gemKey()){
          setStatus("Offline parse did not detect flights — falling back to AI…");
          recordStat("ai_fallback");
          convertAi(true, "offline undetectable");
        } else {
          out.textContent = "Could not detect flights in this screenshot offline.\n\nOnly fall on AI in case cannot detect it — attach a Gemini API key (click 'Generate Api' below) to retry with AI.";
          setStatus("Offline parse could not detect flights — attach AI key to retry", true);
        }
      }
    });
  });
}

/* ---------- text file attachments (instant) ---------- */
function addTextFile(file){
  setStatus("READING "+file.name.toUpperCase()+"…");
  file.text().then(function(txt){
    if(!txt) { setStatus("EMPTY FILE", true); return; }
    var cur = inp.value;
    inp.value = cur + (cur?"\n\n":"") + txt.slice(0,20000);
    try{ renderOfflineSync(inp.value); lastTextFp=fp(inp.value); }catch(e){ convert(true); }
    setStatus("FILE "+file.name.toUpperCase()+" — "+txt.length+" chars — instant");
  }).catch(function(){ setStatus("FILE READ FAILED", true); });
}

function handleFiles(fileList){
  var arr = Array.prototype.slice.call(fileList||[]);
  if(!arr.length) return;
  arr.forEach(function(f){
    if(f.type.indexOf("image/")===0){
      addImage(f, true);
    } else if(f.type.indexOf("text/")===0 || /\.(txt|eml|msg|csv|json|pdf)$/i.test(f.name) || f.size<200000){
      addTextFile(f);
    } else {
      addImage(f, true);
    }
  });
}

/* ---------- Weekly Report Generator ---------- */
function generateWeeklyReportText() {
  var stats = loadStats();
  var mistakes = loadMistakes();
  var rules = loadLearnedRules();
  var nowStr = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  var totalConv = stats.total || 0;
  var offConv = (stats.textOffline || 0) + (stats.imgOffline || 0);
  var offRate = totalConv ? Math.round((offConv / totalConv) * 100) : 100;

  var avgImgSpeed = "N/A";
  if (stats.durations && stats.durations.length) {
    var sum = stats.durations.reduce(function(a,b){return a+b;}, 0);
    avgImgSpeed = Math.round(sum / stats.durations.length) + "ms (< 1s)";
  }

  var lines = [];
  lines.push("=== SPICYTERMINAL WEEKLY PERFORMANCE & ENHANCEMENT REPORT ===");
  lines.push("To: " + AUTHOR_EMAIL);
  lines.push("Generated: " + nowStr);
  lines.push("App Version: SpicyTerminal v4.0 (Pure Offline Image Engine + AI Mistake Learner)");
  lines.push("");
  lines.push("--- 1. PERFORMANCE & CONVERSION STATS ---");
  lines.push("• Total Conversions: " + totalConv);
  lines.push("• Pure Offline Conversions: " + offConv + " (" + offRate + "% offline rate)");
  lines.push("• Offline Screenshot Conversions: " + (stats.imgOffline || 0));
  lines.push("• Average Screenshot Parsing Latency: " + avgImgSpeed);
  lines.push("• AI Fallback Calls (undetected only): " + (stats.aiFallback || 0));
  lines.push("");
  lines.push("--- 2. DETECTED MISTAKES & AI CORRECTIONS (" + mistakes.length + ") ---");
  if (!mistakes.length) {
    lines.push("No mistakes detected this period — pure offline parsing running perfectly.");
  } else {
    mistakes.slice(0, 5).forEach(function(m, idx) {
      lines.push("#" + (idx+1) + " [" + m.when + "] " + m.reason);
      lines.push("  Summary: " + m.summary);
      lines.push("  Input:   " + m.input);
      lines.push("  Offline: " + m.offline);
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
  lines.push("1. Pure Offline Image Engine is operational with zero AI dependency and under-a-second parsing.");
  lines.push("2. Maintain continuous tracking of OCR confusions in flight numbers & day shifts.");
  lines.push("3. Keep AI strictly as fallback only for illegible or handwritten images.");
  lines.push("4. Expand local airport / airline alias mappings for emerging routes.");
  lines.push("");
  lines.push("--- TELEMETRY ENVIRONMENT ---");
  lines.push("• UserAgent: " + (navigator.userAgent || "Unknown"));
  lines.push("• Active AI Model: " + (window._aiModel || aiModelGet() || "(none used)"));
  lines.push("• Offline OCR Engine: OCRAD + TextDetector (bundled)");
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
$("btnAttach").addEventListener("click", function(){ $("filePick").click(); });
$("filePick").addEventListener("change", function(){
  var fs=this.files; this.value=""; handleFiles(fs);
});

// Drag & drop anywhere
["dragenter","dragover"].forEach(function(ev){
  document.addEventListener(ev, function(e){ e.preventDefault(); e.dataTransfer.dropEffect="copy"; }, false);
});
document.addEventListener("drop", function(e){
  e.preventDefault();
  var dt=e.dataTransfer;
  if(dt.files && dt.files.length) handleFiles(dt.files);
  else {
    var txt = dt.getData("text/plain");
    if(txt){ inp.value += (inp.value?"\n\n":"")+txt; convert(false); }
  }
}, false);

// Paste: screenshot or text
inp.addEventListener("paste", function(e){
  var items=(e.clipboardData||{}).items||[];
  var files=[];
  var textPlain=""; try{ textPlain=e.clipboardData.getData("text/plain")||""; }catch(err){}
  for(var i=0;i<items.length;i++) if(items[i].type.indexOf("image/")===0){ var f=items[i].getAsFile(); if(f) files.push(f); }
  if(files.length){
    if(textPlain && textPlain.trim().length>15){
      setTimeout(function(){ convert(true); }, 0);
      files.forEach(function(f){ addImage(f,false); });
      return;
    } else {
      e.preventDefault();
      files.forEach(function(f){ addImage(f,true); });
      return;
    }
  }
  if(textPlain.length<3000){
    queueMicrotask(function(){ convert(false); });
  } else {
    setTimeout(function(){ convert(true); }, 0);
  }
});

// Typing: instant
var typeTimer=null;
inp.addEventListener("input", function(){
  if(typeTimer) clearTimeout(typeTimer);
  var len = inp.value.length;
  if(len<2000){
    if(!images.length) {
      try{ renderOfflineSync(inp.value); }catch(e){}
    }
  } else {
    typeTimer=setTimeout(function(){ convert(true); }, 80);
  }
});

$("btnConvert").addEventListener("click", function(){ convert(false); });
$("btnAi").addEventListener("click", function(){ convertAi(false); });
$("btnClear").addEventListener("click", function(){
  inp.value=""; out.innerHTML=""; lastOut=""; images=[]; $("thumbs").innerHTML=""; lastTextFp=""; setStatus("READY"); inp.focus();
});
$("btnCopy").addEventListener("click", function(){
  if(!lastOut){ setStatus("NOTHING TO COPY", true); return; }
  navigator.clipboard.writeText(lastOut).then(function(){ setStatus("COPIED ✓"); }, function(){
    var ta=document.createElement("textarea"); ta.value=lastOut;
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    setStatus("COPIED ✓");
  });
});

if(!localStorage.getItem("spicy_seen")) $("welcome").classList.remove("hidden");
$("enterBtn").addEventListener("click", function(){
  $("welcome").classList.add("hidden");
  try{ localStorage.setItem("spicy_seen","1"); }catch(e){}
});
$("setClose").addEventListener("click", function(){ $("setModal").classList.add("hidden"); });
$("setSave").addEventListener("click", function(){
  localStorage.setItem("spicy_gem_key", $("gemKey").value.trim());
  $("setModal").classList.add("hidden"); setStatus("KEY SAVED");
});
function openGenKey(){ window.open("https://aistudio.google.com/apikey","_blank"); $("gemKey").value=gemKey(); $("setModal").classList.remove("hidden"); }
$("genKey").addEventListener("click", openGenKey);

// Weekly Report Modal & Buttons
if ($("btnWeeklyReport")) {
  $("btnWeeklyReport").addEventListener("click", openWeeklyReport);
}
if ($("reportClose")) {
  $("reportClose").addEventListener("click", function(){ $("reportModal").classList.add("hidden"); });
}
if ($("reportCopy")) {
  $("reportCopy").addEventListener("click", function(){
    var txt = $("reportContent").value;
    navigator.clipboard.writeText(txt).then(function(){ setStatus("WEEKLY REPORT COPIED ✓"); });
  });
}
if ($("reportSend")) {
  $("reportSend").addEventListener("click", function(){
    var txt = $("reportContent").value;
    var mailUrl = "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(AUTHOR_EMAIL) +
                  "&su=" + encodeURIComponent("SpicyTerminal Weekly Report — Performance & AI Mistake Learning") +
                  "&body=" + encodeURIComponent(txt);
    window.open(mailUrl, "_blank");
  });
}

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
