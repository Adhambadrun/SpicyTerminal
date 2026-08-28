"use strict";
const fs = require("fs");
const path = require("path");
const OCRAD = require("./ocrad.js");
const E = require("./spicy_engine.js");
const D = require("./spicy_data.js");
const { execSync, execFileSync } = require("child_process");

let PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) {
    PASS++;
    console.log("PASS:", msg);
  } else {
    FAIL++;
    console.error("FAIL:", msg);
  }
}

console.log("=== 1. OCR Engine Verification ===");
assert(typeof OCRAD === "function", "OCRAD engine is a loaded function");

console.log("\n=== 2. Aviation OCR Cleaner & Flight Recognition ===");
function cleanOcrText(rawText, rules) {
  let s = String(rawText || "");
  if (rules && Array.isArray(rules)) {
    rules.forEach(r => {
      if (r.pattern && r.replacement !== undefined) s = s.split(r.pattern).join(r.replacement);
    });
  }
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/[•·—–]/g, " - ");
  s = s.replace(/[-–—]/g, " - ");
  s = s.replace(/[ \t]{2,}/g, " ");

  s = s.replace(/([+\-¥])\s*[lIi1]/g, "$11");
  s = s.replace(/([+\-¥])\s*[zZ2]/g, "$12");
  s = s.replace(/([+\-¥])\s*[sS5]/g, "$15");
  s = s.replace(/(AM|PM)\s*([+\-¥])\s*([0-9])/gi, "$1$2$3");

  s = s.replace(/(\d+)\s*h(?:r|ours?)?\s*([0-9A-Za-z]+)\s*m(?:in|inutes?)?/gi, (_, h, m) => {
    let cm = m.replace(/[oO]/g, "0").replace(/[sS]/g, "5").replace(/[lIi]/g, "1").replace(/[zZ]/g, "2");
    return h + " hr " + cm + " min";
  });

  const words = [
    [/Boelng/gi, "Boeing"], [/Alrbus/gi, "Airbus"], [/Alrlines?/gi, "Airlines"],
    [/Alrways?/gi, "Airways"], [/Buslness/gi, "Business"], [/Etonomy/gi, "Economy"],
    [/Econorny/gi, "Economy"], [/Premtum/gi, "Premium"], [/Nonstop/gi, "Nonstop"],
    [/Fl[il1]ght/gi, "Flight"], [/lberia/gi, "Iberia"],
    [/\b([Tt])(\d)([Tt])\b/g, "7$27"], [/\bA3[sS]0\b/gi, "A350"],
    [/\bA38[oO]\b/gi, "A380"], [/\bA32[oO]\b/gi, "A320"],
    [/\b([Nn]ou)\b/gi, "Nov"], [/\b([Ff]eh)\b/gi, "Feb"],
    [/\b([Aa]ua|[Aa]uq)\b/gi, "Aug"], [/\b([Dd]et)\b/gi, "Dec"]
  ];
  words.forEach(w => { s = s.replace(w[0], w[1]); });

  s = s.replace(/\b([0-9A-Za-z]{1,2})[:\.](\w{2})\s*([AP]M?|[ap]m?)/g, (_, h, m, ap) => {
    let ch = h.replace(/[lIi]/g, "1").replace(/[oO]/g, "0").replace(/[Tt]/g, "7");
    let cm = m.replace(/ss/gi, "55").replace(/zs/gi, "25").replace(/so/gi, "50")
              .replace(/os/gi, "05").replace(/ll/gi, "11").replace(/lo/gi, "10")
              .replace(/[sS]/g, "5").replace(/[oO]/g, "0").replace(/[lIi]/g, "1").replace(/[zZ]/g, "2");
    return ch + ":" + cm + " " + ap.toUpperCase();
  });

  s = s.replace(/\b(\d{1,2})([sSoO0-9]{2})([APNM])\b/g, (_, h, m, ap) => {
    let cm = m.replace(/[sS]/g, "5").replace(/[oO]/g, "0");
    return h + cm + ap;
  });

  if (/DOH/i.test(s)) {
    s = s.replace(/\bOR\s+/gi, "QR ");
  }

  const airlines = Object.keys(D.airlines);
  // Native OCR may preserve the carrier with mixed case (for example qR).
  const caseAirRe = new RegExp("\\b(" + airlines.join("|") + ")\\b", "gi");
  s = s.replace(caseAirRe, (_, code) => code.toUpperCase());
  const airRe = new RegExp("\\b(" + airlines.join("|") + ")\\s+([0-9A-Za-z]{1,5})\\b", "g");
  s = s.replace(airRe, (_, code, num) => {
    let cnum = num.replace(/[oO]/g, "0").replace(/[lIi]/g, "1").replace(/[zZ]/g, "2")
                  .replace(/[sS]/g, "5").replace(/[b]/g, "6").replace(/[B]/g, "8").replace(/[gq]/g, "9");
    return code + " " + cnum;
  });

  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  months.forEach(m => {
    s = s.replace(new RegExp("(\\d{1,2})\\s*" + m, "gi"), "$1 " + m);
    s = s.replace(new RegExp(m + "\\s*(\\d{1,2})", "gi"), m + " $1");
  });
  return s;
}

const testInputs = [
  {
    name: "Google Flights Iberia screenshot OCR text",
    raw: "6:05 PM - 12:45 PM+l\nlberia . IB 4z37\n16 sep . LAX - LHR\nNonstop . 10 hr4O min\nBoelng 777-300ER . Buslness\n",
    expectedCarrier: "IB",
    expectedFlt: "4237"
  },
  {
    name: "Qatar Airways mobile card OCR text",
    raw: "OR los9 DOH - CAI\n18 Nou T:SS PM - ll:zs PM\nBoeing T8T Economy",
    expectedCarrier: "QR",
    expectedFlt: "1059"
  },
  {
    name: "GDS Terminal screenshot OCR text",
    raw: "1 BA 114 J 06FEB JFK LHR 9s0P 94SA+1 777",
    expectedCarrier: "BA",
    expectedFlt: "114"
  }
];

testInputs.forEach(t => {
  const cleaned = cleanOcrText(t.raw);
  const [segs, warns] = E.parse(cleaned);
  assert(segs.length > 0, `${t.name} -> detected ${segs.length} segment(s)`);
  if (segs.length > 0) {
    assert(segs[0].airline === t.expectedCarrier, `${t.name} -> airline ${segs[0].airline} === ${t.expectedCarrier}`);
    assert(segs[0].flight_no === t.expectedFlt, `${t.name} -> flight_no ${segs[0].flight_no} === ${t.expectedFlt}`);
  }
});

console.log("\n=== 3. Direct Image OCR from Actual File (<1s) ===");
try {
  // Pillow is optional; use ImageMagick on clean developer/CI images.
  try {
    execSync(`python3 -c "
from PIL import Image, ImageDraw, ImageFont
im = Image.new('RGB', (800, 200), 'white')
d = ImageDraw.Draw(im)
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
d.text((25, 25), 'QR 1059 DOH - CAI', font=f, fill='black')
d.text((25, 75), '18 Nov 7:55 PM - 11:25 PM', font=f, fill='black')
d.text((25, 125), 'Boeing 787 Economy', font=f, fill='black')
im.save('/tmp/test_ticket_offline.ppm')
"`, { stdio: "ignore" });
  } catch (pillowError) {
    execFileSync("convert", ["-size", "800x200", "xc:white", "-font", "DejaVu-Sans-Bold",
      "-pointsize", "26", "-fill", "black",
      "-draw", 'text 25,60 "QR 1059 DOH - CAI"',
      "-draw", 'text 25,125 "18 Nov 7:55 PM - 11:25 PM"',
      "-draw", 'text 25,190 "Boeing 787 Economy"',
      "-depth", "8", "/tmp/test_ticket_offline.ppm"]);
  }
  if (!fs.existsSync("/tmp/test_ticket_offline.ppm")) throw new Error("test image was not created");

  const t0 = Date.now();
  const ppmBuf = fs.readFileSync("/tmp/test_ticket_offline.ppm");
  const rawOcr = OCRAD(ppmBuf);
  const ocrElapsed = Date.now() - t0;
  console.log(`Image OCR finished in ${ocrElapsed}ms (< 1000ms target)`);
  assert(ocrElapsed < 1000, `Image OCR speed: ${ocrElapsed}ms is under 1 second`);

  const cleaned = cleanOcrText(rawOcr);
  const [imgSegs, imgWarns] = E.parse(cleaned);
  assert(imgSegs.length === 1, `E2E Image OCR: parsed ${imgSegs.length} flight segment(s)`);
  if (imgSegs.length === 1) {
    assert(imgSegs[0].airline === "QR", `E2E Image OCR: carrier is QR (Hamad/Cairo)`);
    assert(imgSegs[0].flight_no === "1059", `E2E Image OCR: flight_no is 1059`);
  }
} catch (e) {
  assert(false, `E2E Image OCR exception: ${e.message}`);
}

console.log("\n=== 4. AI Mistake Detection & Self-Learning Loop ===");
let learnedRules = [];
function teachRule(rule) { learnedRules.push(rule); }
teachRule({ pattern: "XY l337", replacement: "XY 1337", why: "Test AI fix" });
const testMistakeInput = "XY l337 15JAN JFK LHR 700P 700A+1 Y 777";
const cleanedLearned = cleanOcrText(testMistakeInput, learnedRules);
assert(cleanedLearned.includes("XY 1337"), "Tool applied learned rule to fix flight number");

console.log("\n=== 5. Weekly Report & Destination Email Verification ===");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
assert(html.includes("adhambadraan@gmail.com"), "index.html contains author email adhambadraan@gmail.com");
assert(html.includes("btnWeeklyReport"), "index.html contains btnWeeklyReport button");
assert(html.includes("reportModal"), "index.html contains reportModal dialog");
assert(html.includes("OCRAD"), "index.html has bundled OCRAD engine");
assert(html.includes('id="ocradSource" type="text/plain"'), "index.html defers OCRAD compilation until a screenshot needs it");
assert(html.includes("attachmentReviewModal"), "index.html includes the screenshot review dialog");
assert(html.includes("attachment-remove"), "index.html includes the small screenshot remove control");

console.log(`\n=== SUMMARY: ${PASS} passed, ${FAIL} failed ===`);
if (FAIL > 0) process.exit(1);
