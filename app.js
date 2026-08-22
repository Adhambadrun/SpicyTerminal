/* app.js — SpicyTerminal Web UI (auto-convert, learn loop, fast image path). */
(function () {
"use strict";
var $ = function (id) { return document.getElementById(id); };
var inp = $("inp"), out = $("out"), st = $("st");
var images = [];          // attached/pasted screenshots (downscaled JPEG b64)
var lastOut = "";
var converting = false;

function setStatus(msg, warn) {
  st.textContent = msg;
  st.title = msg; /* full text on hover — status truncates, links never get pushed off */
  st.className = warn ? "warn" : "";
}
function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function gemKey() { return localStorage.getItem("spicy_gem_key") || ""; }

/* ================= learn loop =================
   When offline fails but AI converts, we fingerprint the paste. Same paste
   later goes straight to AI (no wasted offline attempt), and the learn log
   rides inside every bug report so the engine gets the permanent fix.    */
var LKEY = "spicy_learn_v1";
function learnAll() { try { return JSON.parse(localStorage.getItem(LKEY) || "[]"); } catch (e) { return []; } }
function fp(text) {
  var t = (text || "").toLowerCase().replace(/\s+/g, " ").trim(), h = 5381;
  for (var i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
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

/* ================= offline convert ================= */
function offlineIncomplete(warns, segs) {
  if (!segs.length) return "no segments read";
  for (var i = 0; i < warns.length; i++)
    if (/NOT read|missing|unknown/i.test(warns[i])) return warns[i];
  return null;
}
function renderOffline(text, fromAuto) {
  var res = window.SpicyEngine.parse(text);
  var segs = res[0], warns = res[1];
  if (!segs.length) { lastOut = ""; out.innerHTML = ""; return { segs: segs, warns: warns }; }
  lastOut = window.SpicyEngine.renderItinerary(segs);
  out.innerHTML = esc(lastOut);
  var msg = "OFFLINE ENGINE — " + segs.length + " segment(s)";
  if (warns.length) msg += "  ·  " + warns.join(" · ");
  setStatus(msg, warns.length > 0);
  return { segs: segs, warns: warns };
}
function convert(auto) {
  if (converting) return;
  var text = (inp.value || "").replace(/\[screenshot attached[^\n]*\]\n?/g, "");
  var hasImg = images.length > 0;
  if (!text.trim() && !hasImg) { out.innerHTML = ""; lastOut = ""; setStatus("READY"); return; }
  // image-only paste -> straight to AI (fast path, one round trip)
  if (hasImg && !text.trim()) { convertAi(true); return; }
  // learned: this exact paste needed AI before -> go straight to AI
  if (text.trim() && gemKey() && learnKnows(text)) { convertAi(auto, "learned pattern"); return; }

  setStatus("CONVERTING…");
  setTimeout(function () {
    var r;
    try { r = renderOffline(text); }
    catch (e) { r = { segs: [], warns: ["engine error"] }; }
    var lack = offlineIncomplete(r.warns, r.segs);
    if (!lack) return;                                  // clean offline result, stop
    if (gemKey()) { convertAi(auto, lack); return; }    // auto AI rescue
    if (!r.segs.length) {                               // never leave OUTPUT empty
      out.textContent = "Couldn't read this paste offline.\n" +
        (r.warns[0] || "") + "\n\nPress AI AUTO (add a Gemini key first if asked).";
      setStatus("OFFLINE INCOMPLETE — needs AI", true);
    } else {
      setStatus(st.textContent + "  ·  partial — AI AUTO can finish", true);
    }
  }, 20);
}

/* ================= AI convert (Gemini) ================= */
function convertAi(fromAuto, reason) {
  if (converting) return;
  var key = gemKey();
  if (!key) { $("setModal").classList.remove("hidden"); setStatus("AI needs a Gemini key", true); return; }
  var text = (inp.value || "").replace(/\[screenshot attached[^\n]*\]\n?/g, "");
  var fallback = lastOut, fallbackStatus = st.textContent;
  converting = true;
  setStatus(images.length ? "AI CONVERTING (image)…" : "AI CONVERTING…");
  var task = text.trim()
    ? "Convert the following flight data into GDS Black Window format. If anything is missing " +
      "or ambiguous, fill it from aviation knowledge — never leave fields blank or ???.\n\n" + text
    : "Convert the flight data in the attached image(s) into GDS Black Window format. " +
      "Convert ALL options shown. Fill any missing field from aviation knowledge — never blank, never ???.";
  var parts = [{ text: task }];
  images.forEach(function (im) { parts.push({ inline_data: { mime_type: im.mime, data: im.b64 } }); });
  var body = {
    system_instruction: { parts: [{ text: window.SpicyEngine.MASTER_PROMPT }] },
    contents: [{ role: "user", parts: parts }],
    generationConfig: { temperature: 0.0, maxOutputTokens: 4096 }
  };
  fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(key), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  }).then(function (r) { return r.json(); }).then(function (j) {
    converting = false;
    var ps = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    var t = ps.map(function (p) { return p.text || ""; }).join("").trim();
    if (!t) throw new Error((j.error && j.error.message) || "empty AI reply");
    t = t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
    // engine fix-pass: run AI text back through the offline engine — fills any
    // residual ??? (aircraft ladder) and normalizes spacing/ordering
    var rr;
    try { rr = window.SpicyEngine.parse(t); } catch (e) { rr = null; }
    if (rr && rr[0].length && rr[0].length >= (t.split("\n").filter(function (l) { return / N$/.test(l); }).length)) {
      t = window.SpicyEngine.renderItinerary(rr[0]);
    }
    lastOut = t;
    out.innerHTML = esc(t);
    setStatus("AI CONVERTED" + (reason ? " (" + reason + ")" : ""));
    if (reason && text.trim()) learnRecord(text, t, reason);   // offline failed, AI won -> learn
  }).catch(function (e) {
    converting = false;
    if (fallback) { lastOut = fallback; out.innerHTML = esc(fallback); setStatus("AI failed — offline result kept", true); }
    else { setStatus("AI failed: " + String(e.message || e).slice(0, 70), true); }
  });
}

/* ================= images: attach + fast downscale ================= */
function addImage(file, thenConvert) {
  var img = new Image(), rd = new FileReader();
  rd.onload = function (ev) {
    img.onload = function () {
      var max = 1280, w = img.width, h = img.height, sc = Math.min(1, max / Math.max(w, h));
      var cv = document.createElement("canvas");
      cv.width = Math.round(w * sc); cv.height = Math.round(h * sc);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      var b64 = cv.toDataURL("image/jpeg", 0.82).split(",")[1];
      images.push({ mime: "image/jpeg", b64: b64 });
      setStatus(images.length + " screenshot(s) attached");
      if (thenConvert !== false) convert(true);
    };
    img.src = ev.target.result;
  };
  rd.readAsDataURL(file);
}
$("btnAttach").addEventListener("click", function () { $("filePick").click(); });
$("filePick").addEventListener("change", function () {
  var fs = Array.prototype.slice.call(this.files || []);
  this.value = "";
  if (!fs.length) return;
  fs.forEach(function (f, i) { addImage(f, i === fs.length - 1); });
});

/* ================= paste → auto convert ================= */
inp.addEventListener("paste", function (e) {
  var items = (e.clipboardData || {}).items || [], hasImg = false;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf("image/") === 0) {
      var f = items[i].getAsFile();
      if (f) { hasImg = true; addImage(f, false); }
      e.preventDefault();
    }
  }
  if (hasImg) { if (images.length) setTimeout(function(){ convert(true); }, 350); return; }
  setTimeout(function () { convert(true); }, 60);   // after the text lands
});

/* ================= buttons ================= */
$("btnConvert").addEventListener("click", function () { convert(false); });
$("btnAi").addEventListener("click", function () { convertAi(false); });
$("btnClear").addEventListener("click", function () {
  inp.value = ""; out.innerHTML = ""; lastOut = ""; images = []; setStatus("READY"); inp.focus();
});
$("btnCopy").addEventListener("click", function () {
  if (!lastOut) { setStatus("NOTHING TO COPY", true); return; }
  navigator.clipboard.writeText(lastOut).then(function () {
    setStatus("COPIED ✓");
  }, function () {
    var ta = document.createElement("textarea"); ta.value = lastOut;
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    setStatus("COPIED ✓");
  });
});

/* ================= welcome (first open only) ================= */
if (!localStorage.getItem("spicy_seen")) $("welcome").classList.remove("hidden");
$("enterBtn").addEventListener("click", function () {
  $("welcome").classList.add("hidden");
  try { localStorage.setItem("spicy_seen", "1"); } catch (e) {}
});

/* ================= settings ================= */
$("setClose").addEventListener("click", function () { $("setModal").classList.add("hidden"); });
$("setSave").addEventListener("click", function () {
  localStorage.setItem("spicy_gem_key", $("gemKey").value.trim());
  $("setModal").classList.add("hidden"); setStatus("KEY SAVED");
});

/* ================= generate api key ================= */
function openGenKey() {
  window.open("https://aistudio.google.com/apikey", "_blank");
  $("gemKey").value = gemKey();
  $("setModal").classList.remove("hidden");
}
$("genKey").addEventListener("click", openGenKey);

/* ================= report ================= */
$("report").addEventListener("click", function () {
  var input = (inp.value || "").trim(), output = lastOut || "";
  function cap(s, n) { return s.length > n ? s.slice(0, n) + "\n…[trimmed]" : s; }
  var learn = learnAll();
  var learnTxt = learn.length
    ? "\n=== ENGINE LEARN LOG (" + learn.length + ") ===\n" +
      learn.slice(0, 3).map(function (l, i) {
        return (i + 1) + ") " + l.when + " — " + l.why + "\nIN : " + l.in + "\nOUT: " + l.out;
      }).join("\n")
    : "";
  var body =
    "=== SPICY TERMINAL BUG REPORT ===\n" +
    "WHEN: " + new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC\n\n" +
    "=== WHAT I PASTED ===\n" + (cap(input, 1300) || "(empty)") + "\n\n" +
    "=== WHAT THE APP PRODUCED ===\n" + (cap(output, 1300) || "(empty)") + "\n\n" +
    "=== WHAT I EXPECTED INSTEAD ===\n\n\n=== ANY OTHER DETAILS ===\n" + learnTxt;
  window.open("https://mail.google.com/mail/?view=cm&fs=1&to=lamar@bcflights.com" +
    "&su=" + encodeURIComponent("SpicyTerminal bug report") +
    "&body=" + encodeURIComponent(body), "_blank");
});
})();
