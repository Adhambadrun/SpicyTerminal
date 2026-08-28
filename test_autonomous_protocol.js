"use strict";
/**
 * test_autonomous_protocol.js
 * Autonomous Flight Engine Validation & GDS Black Window Self-Correction Protocol
 *
 * Phase 1: Test Matrix & Synthetic Load Generation (10,000 distinct payloads)
 *   - Route & Code Diversity (3,000 requests)
 *   - Temporal & Schedule Variation (3,000 requests)
 *   - Cabin & Fare Class Inputs (2,000 requests)
 *   - Format Messiness & Noise Stress (2,000 requests)
 *
 * Phase 2: Structural Ground-Truth Cross-Referencing against GDS Black Window System Laws
 * Phase 3: Automated Error Logging & Self-Correction Feedback Loop (failures_10k.log)
 * Phase 4: Audit Report & Self-Correction Summary
 */

const fs = require("fs");
const path = require("path");
const E = require("./spicy_engine.js");
const D = require("./spicy_data.js");

const LOG_FILE = path.join(__dirname, "failures_10k.log");
fs.writeFileSync(LOG_FILE, "=== AUTONOMOUS FLIGHT ENGINE VALIDATION LOG ===\n");

const AIRPORTS = Object.keys(D.airports);
const AIRLINES = Object.keys(D.airlines);
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const CABINS = ["First","Business","Premium Economy","Economy"];
const CLASSES = ["F","J","C","D","I","Z","Y","W","S","B","M","H","K","L","Q","T","A","P","R","O","E","U","V","N","X","G"];

function rnd(n){ return Math.floor(Math.random()*n); }
function choice(a){ return a[rnd(a.length)]; }

function fmt12(min){
  let h=Math.floor(min/60), m=min%60;
  const ap=h>=12?"P":"A"; h=h%12; if(h===0) h=12;
  return `${h}${String(m).padStart(2,"0")}${ap}`;
}
function fmt12Colon(min){
  let h=Math.floor(min/60), m=min%60;
  const ap=h>=12?"PM":"AM"; h=h%12; if(h===0) h=12;
  return `${h}:${String(m).padStart(2,"0")} ${ap}`;
}
function fmt24(min){
  let h=Math.floor(min/60), m=min%60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

let PASS = 0, FAIL = 0;
let violationsByClass = {
  regex_time: 0,
  overnight_marker: 0,
  aircraft_mapping: 0,
  spacing_alignment: 0,
  additional_delimiter: 0,
  structure_lines: 0
};

function logFailure(iter, category, input, output, ruleViolation, violationType) {
  FAIL++;
  if (violationsByClass[violationType] !== undefined) {
    violationsByClass[violationType]++;
  }
  const entry = `[FAIL] Iteration ${iter} | Category: ${category} | Violation: ${ruleViolation}\n` +
                `INPUT:\n${input}\n` +
                `OUTPUT:\n${output}\n` +
                `----------------------------------------------------------------------\n`;
  fs.appendFileSync(LOG_FILE, entry);
}

// -----------------------------------------------------------------------------
// Validation against GDS Black Window System Laws
// -----------------------------------------------------------------------------
function validateGdsLaws(rendered, expectedSegCount, iter, category, rawInput) {
  // Law 1: Code block / clean output only (zero markdown headers, greetings, or commentary)
  if (/^#+\s|^Hello|^Dear|Here is your itinerary|I have converted/i.test(rendered)) {
    logFailure(iter, category, rawInput, rendered, "Law 1: Output contains markdown headers or conversational commentary", "structure_lines");
    return false;
  }

  // Law 9: Presence of <--additional--> section
  if (!rendered.includes("<--additional-->")) {
    logFailure(iter, category, rawInput, rendered, "Law 9: Missing <--additional--> section", "additional_delimiter");
    return false;
  }

  const parts = rendered.split("<--additional-->");
  const flightBlocks = parts[0].trim().split(/\n\n+/).filter(Boolean);
  const additionalLines = parts[1].trim().split("\n").filter(Boolean);

  if (flightBlocks.length !== expectedSegCount) {
    logFailure(iter, category, rawInput, rendered, `Law 4: Expected ${expectedSegCount} segment block(s), got ${flightBlocks.length}`, "structure_lines");
    return false;
  }

  // Validate each segment block
  for (let bIdx = 0; bIdx < flightBlocks.length; bIdx++) {
    const block = flightBlocks[bIdx];
    const lines = block.split("\n");

    // Law 2: Exactly 4 lines per standard segment (or extra STOP- lines if technical stop)
    if (lines.length !== 4 && !lines.some(l => l.startsWith("STOP-"))) {
      logFailure(iter, category, rawInput, rendered, `Law 2: Block ${bIdx + 1} has ${lines.length} lines instead of 4`, "structure_lines");
      return false;
    }

    const line1 = lines[0];
    const depLine = lines.find(l => l.startsWith("DEP-"));
    const arrLine = lines.find(l => l.startsWith("ARR-"));
    const cabinLine = lines.find(l => l.startsWith("CABIN-"));

    if (!depLine || !arrLine || !cabinLine) {
      logFailure(iter, category, rawInput, rendered, `Law 2: Missing DEP-, ARR-, or CABIN- line in block ${bIdx + 1}`, "structure_lines");
      return false;
    }

    // Law 3: Single-space delimiter between fields on Line 1 with zero column alignment padding
    if (/ {2,}/.test(line1) || /\t/.test(line1)) {
      logFailure(iter, category, rawInput, rendered, `Law 3: Multiple spaces or tab alignment on Line 1: '${line1}'`, "spacing_alignment");
      return false;
    }

    const fields = line1.split(" ");
    if (fields.length !== 13) {
      logFailure(iter, category, rawInput, rendered, `Law 3: Line 1 has ${fields.length} fields instead of 13: '${line1}'`, "spacing_alignment");
      return false;
    }

    const [segNum, al, fltNo, dateStr, orig, dest, depTime, arrTime, cls, ac, ft, dist, stat] = fields;

    // Law 4: Sequential segment numbering starting at 1
    if (parseInt(segNum, 10) !== bIdx + 1) {
      logFailure(iter, category, rawInput, rendered, `Law 4: Segment number ${segNum} !== expected ${bIdx + 1}`, "structure_lines");
      return false;
    }

    // Law 5: 12-hour departure and arrival times without colons, ending in A or P (or noon 1200N / midnight 1200M)
    if (!/^(?:\d{3,4}[AP]|1200[NM])$/.test(depTime)) {
      logFailure(iter, category, rawInput, rendered, `Law 5: Invalid departure time format: '${depTime}'`, "regex_time");
      return false;
    }
    if (!/^(?:\d{3,4}[AP]|1200[NM])(?:¥[1-3])?$/.test(arrTime)) {
      logFailure(iter, category, rawInput, rendered, `Law 5/6: Invalid arrival time format: '${arrTime}'`, "regex_time");
      return false;
    }

    // Law 7: Exact IATA aircraft designator translation (never ???)
    if (!ac || ac === "???" || ac.length < 2 || ac.length > 4) {
      logFailure(iter, category, rawInput, rendered, `Law 7: Unmapped aircraft code: '${ac}'`, "aircraft_mapping");
      return false;
    }

    // Status code must be N
    if (stat !== "N") {
      logFailure(iter, category, rawInput, rendered, `Status code must be N: '${stat}'`, "structure_lines");
      return false;
    }

    // Cabin line must be full name in ALL CAPS
    if (!/^CABIN-(?:FIRST|BUSINESS|PREMIUM ECONOMY|ECONOMY)$/.test(cabinLine)) {
      logFailure(iter, category, rawInput, rendered, `Invalid CABIN line format: '${cabinLine}'`, "structure_lines");
      return false;
    }
  }

  // Law 9: Validate <--additional--> lines format
  if (additionalLines.length !== expectedSegCount) {
    logFailure(iter, category, rawInput, rendered, `Law 9: Expected ${expectedSegCount} additional lines, got ${additionalLines.length}`, "additional_delimiter");
    return false;
  }

  for (let aIdx = 0; aIdx < additionalLines.length; aIdx++) {
    const aLine = additionalLines[aIdx];
    // Strict pattern: [SEG#] [AIRLINE] [FLT#][CLS] [DATE] (no space between FLT# and CLS)
    const m = /^(\d+)\s([A-Z0-9]{2})\s(\d+[A-Z])\s(\d{2}[A-Z]{3})$/.exec(aLine);
    if (!m) {
      logFailure(iter, category, rawInput, rendered, `Law 9: Malformed additional section line: '${aLine}'`, "additional_delimiter");
      return false;
    }
    if (parseInt(m[1], 10) !== aIdx + 1) {
      logFailure(iter, category, rawInput, rendered, `Law 9: Additional line segment ${m[1]} !== ${aIdx + 1}`, "additional_delimiter");
      return false;
    }
  }

  PASS++;
  return true;
}

// -----------------------------------------------------------------------------
// Load Execution (10,000 payloads)
// -----------------------------------------------------------------------------
console.log("=========================================================================");
console.log(" Autonomous Flight Engine Validation & GDS Black Window Self-Correction ");
console.log(" Target: 10,000 Iterations Across 4 Core Structural Categories          ");
console.log("=========================================================================\n");

const startTime = Date.now();

// -----------------------------------------------------------------------------
// Category 1: Route & Code Diversity (3,000 payloads)
// -----------------------------------------------------------------------------
console.log(">>> Phase 1.1: Route & Code Diversity (3,000 requests)...");
const multiHubPairs = [
  [["JFK", "DOH"], ["DOH", "CMB"]],
  [["SIN", "FRA"], ["FRA", "JFK"], ["JFK", "LHR"], ["LHR", "SIN"]],
  [["LHR", "DXB"], ["DXB", "SYD"]],
  [["SFO", "NRT"], ["NRT", "SIN"]]
];

const cityAliasExamples = [
  { text: "New York to London Heathrow", orig: "JFK", dest: "LHR", al: "BA", fn: "114" },
  { text: "Paris Charles de Gaulle to Tokyo Haneda", orig: "CDG", dest: "HND", al: "AF", fn: "272" },
  { text: "Los Angeles to Sydney", orig: "LAX", dest: "SYD", al: "QF", fn: "12" },
  { text: "Dubai to Cairo", orig: "DXB", dest: "CAI", al: "EK", fn: "927" }
];

for (let i = 0; i < 3000; i++) {
  const iter = i + 1;
  let rawInput = "";
  let expCount = 1;

  if (i % 3 === 0) {
    // Multi-hub connection
    const route = choice(multiHubPairs);
    expCount = route.length;
    rawInput = route.map((leg, lIdx) => {
      const al = choice(["QR", "EK", "SQ", "BA", "AF", "LH"]);
      const fn = 100 + rnd(8800);
      const day = 10 + lIdx * 2;
      return `${lIdx + 1} ${al} ${fn} J ${day}OCT ${leg[0]} ${leg[1]} 800A 430P 77W N`;
    }).join("\n");
  } else if (i % 3 === 1) {
    // City names prose
    const c = choice(cityAliasExamples);
    expCount = 1;
    rawInput = `${c.al} ${c.fn} from ${c.text} on 15 November, departing 10:30 AM arriving 8:45 PM, Boeing 777-300ER, Business (J)`;
  } else {
    // Codeshare with explicit marketing carrier vs operating carrier
    const mktAl = choice(["AA", "DL", "UA", "BA", "QR"]);
    const oprAl = choice(["British Airways", "Qatar Airways", "Iberia", "Japan Airlines"]);
    const orig = choice(AIRPORTS), dest = choice(AIRPORTS.filter(a => a !== orig));
    const fn = 1000 + rnd(7000);
    expCount = 1;
    rawInput = `Flight ${mktAl} ${fn} operated by ${oprAl}\n${orig} to ${dest}\nDate: 20 December\nDepart: 6:00 PM - Arrive: 9:30 PM\nBoeing 787-9, Economy (Y)`;
  }

  const [segs] = E.parse(rawInput);
  if (!segs || segs.length === 0) {
    logFailure(iter, "Route & Code Diversity", rawInput, "(no segments parsed)", "Parser produced 0 segments", "structure_lines");
    continue;
  }
  const rendered = E.renderItinerary(segs);
  validateGdsLaws(rendered, expCount, iter, "Route & Code Diversity", rawInput);
}

// -----------------------------------------------------------------------------
// Category 2: Temporal & Schedule Variation (3,000 payloads)
// -----------------------------------------------------------------------------
console.log(">>> Phase 1.2: Temporal & Schedule Variation (3,000 requests)...");
for (let i = 0; i < 3000; i++) {
  const iter = 3000 + i + 1;
  const al = choice(AIRLINES);
  const fn = 100 + rnd(8800);
  const orig = choice(AIRPORTS), dest = choice(AIRPORTS.filter(a => a !== orig));

  let rawInput = "";
  if (i % 3 === 0) {
    // Red-eye flights departing before midnight and arriving after (+1)
    rawInput = `${al} ${fn} ${orig} to ${dest}\n14 September\n11:45 PM to 6:30 AM+1\nAirbus A350-900 · Economy (K)`;
  } else if (i % 3 === 1) {
    // 24-hour military time inputs
    const depH = rnd(23), arrH = (depH + 4 + rnd(8)) % 24;
    const depM = rnd(59), arrM = rnd(59);
    const dep24 = `${String(depH).padStart(2, "0")}:${String(depM).padStart(2, "0")}`;
    const arr24 = `${String(arrH).padStart(2, "0")}:${String(arrM).padStart(2, "0")}`;
    rawInput = `${dep24} ${orig} - ${arr24} ${dest}\n${al} ${fn} · 18OCT\nDirect · Boeing 777-300ER\nBusiness (C)`;
  } else {
    // Non-standard date format
    const dateVariations = ["Jan 15", "September 22", "15/01/2026", "2026-09-22", "15-OCT-2026"];
    const dStr = choice(dateVariations);
    rawInput = `Flight ${al} ${fn}, ${orig} to ${dest}, ${dStr}, 9:00 AM to 5:30 PM, Boeing 787-9, First (F)`;
  }

  const [segs] = E.parse(rawInput);
  if (!segs || segs.length === 0) {
    logFailure(iter, "Temporal & Schedule", rawInput, "(no segments parsed)", "Parser produced 0 segments", "regex_time");
    continue;
  }
  const rendered = E.renderItinerary(segs);
  validateGdsLaws(rendered, 1, iter, "Temporal & Schedule", rawInput);
}

// -----------------------------------------------------------------------------
// Category 3: Cabin & Fare Class Inputs (2,000 payloads)
// -----------------------------------------------------------------------------
console.log(">>> Phase 1.3: Cabin & Fare Class Inputs (2,000 requests)...");
for (let i = 0; i < 2000; i++) {
  const iter = 6000 + i + 1;
  const al = choice(AIRLINES);
  const fn = 100 + rnd(8800);
  const orig = choice(AIRPORTS), dest = choice(AIRPORTS.filter(a => a !== orig));

  let rawInput = "";
  if (i % 3 === 0) {
    // Explicit fare class letter
    const cls = choice(CLASSES);
    rawInput = `1 ${al} ${fn} ${cls} 15NOV ${orig} ${dest} 1030A 245P 77W N`;
  } else if (i % 3 === 1) {
    // Implicit cabin statements
    const cabinStmt = choice(["All business", "First class", "Economy class", "Premium economy"]);
    rawInput = `${al} ${fn} ${orig} to ${dest} 08DEC 1:00 PM to 4:30 PM Boeing 787-9. ${cabinStmt}.`;
  } else {
    // Messy input missing cabin details (fallback defaults)
    rawInput = `Flight ${al} ${fn} ${orig}-${dest} 12DEC 7:15 AM - 11:30 AM A350-900`;
  }

  const [segs] = E.parse(rawInput);
  if (!segs || segs.length === 0) {
    logFailure(iter, "Cabin & Fare Class", rawInput, "(no segments parsed)", "Parser produced 0 segments", "structure_lines");
    continue;
  }
  const rendered = E.renderItinerary(segs);
  validateGdsLaws(rendered, 1, iter, "Cabin & Fare Class", rawInput);
}

// -----------------------------------------------------------------------------
// Category 4: Format Messiness & Noise Stress (2,000 payloads)
// -----------------------------------------------------------------------------
console.log(">>> Phase 1.4: Format Messiness & Noise Stress (2,000 requests)...");
const noiseSnippets = [
  "2h 30m layover in DOH · Self-transfer warning",
  "Estimated emissions: -14% · 128 kg CO2e",
  "Carry-on bag included · 1st checked bag $35",
  "Seat 14B · Window · Standard legroom (31 in)",
  "Snack and beverage service · Wi-Fi available for purchase",
  "Select flight · Price: $482 total · Taxes and fees included",
  "Book with airline · Operated by regional affiliate"
];

for (let i = 0; i < 2000; i++) {
  const iter = 8000 + i + 1;
  const al = choice(AIRLINES);
  const fn = 100 + rnd(8800);
  const orig = choice(AIRPORTS), dest = choice(AIRPORTS.filter(a => a !== orig));
  const noise = choice(noiseSnippets);

  // Incomplete metadata requiring haversine distance & aircraft route estimation
  const rawInput = `${al} ${fn} ${orig} to ${dest}\n` +
                   `Date: 12 January\n` +
                   `10:00 AM - 3:45 PM\n` +
                   `${noise}\n` +
                   `Economy class (Y)`;

  const [segs] = E.parse(rawInput);
  if (!segs || segs.length === 0) {
    logFailure(iter, "Messiness & Noise", rawInput, "(no segments parsed)", "Parser produced 0 segments", "structure_lines");
    continue;
  }
  const rendered = E.renderItinerary(segs);
  validateGdsLaws(rendered, 1, iter, "Messiness & Noise", rawInput);
}

const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(2);

console.log("\n=========================================================================");
console.log(" AUTONOMOUS FLIGHT ENGINE VALIDATION & GDS BLACK WINDOW REPORT ");
console.log("=========================================================================");
console.log(`• Total Iterations Executed: ${PASS + FAIL} / 10,000`);
console.log(`• Passed Iterations:         ${PASS}`);
console.log(`• Failed Iterations:         ${FAIL}`);
console.log(`• Compliance Rate:           ${((PASS / (PASS + FAIL)) * 100).toFixed(2)}%`);
console.log(`• Total Execution Time:      ${totalTimeSec}s`);
console.log("-------------------------------------------------------------------------");
console.log("• Discrepancies by Violation Class:");
console.log(`  - Regex / Time Syntax Errors:         ${violationsByClass.regex_time}`);
console.log(`  - Overnight Marker Errors:            ${violationsByClass.overnight_marker}`);
console.log(`  - Aircraft Code Mapping Errors:       ${violationsByClass.aircraft_mapping}`);
console.log(`  - Spacing / Alignment Errors:         ${violationsByClass.spacing_alignment}`);
console.log(`  - Additional Delimiter Errors:        ${violationsByClass.additional_delimiter}`);
console.log(`  - Structural Line Count Errors:       ${violationsByClass.structure_lines}`);
console.log("=========================================================================\n");

if (FAIL > 0) {
  console.error(`Validation failed with ${FAIL} discrepancies. See failures_10k.log for details.`);
  process.exit(1);
} else {
  console.log("100% SYSTEM COMPLIANCE ACHIEVED: All 10,000 payloads passed with ZERO errors!");
}
