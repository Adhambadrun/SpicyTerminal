// Byte-for-byte parity test: spicy_engine.js (JS) vs python engine goldens.
const E = require("./spicy_engine.js");
const G = JSON.parse(require("fs").readFileSync(__dirname + "/goldens.json", "utf8"));
let pass = 0, fail = 0;
for (const [name, c] of Object.entries(G)) {
  const [segs, warns] = E.parse(c.text);
  const out = E.renderItinerary(segs);
  const okOut = out === c.output;
  const okW = JSON.stringify(warns) === JSON.stringify(c.warnings);
  if (okOut && okW) { pass++; console.log("PASS", name); }
  else {
    fail++;
    console.log("FAIL", name);
    if (!okOut) {
      const a = out.split("\n"), b = c.output.split("\n");
      for (let i = 0; i < Math.max(a.length, b.length); i++)
        if (a[i] !== b[i]) { console.log("  line", i, "\n   JS:", JSON.stringify(a[i]), "\n   PY:", JSON.stringify(b[i])); }
    }
    if (!okW) { console.log("  JS warns:", JSON.stringify(warns)); console.log("  PY warns:", JSON.stringify(c.warnings)); }
  }
}
console.log(`${pass}/${pass + fail} parity`);
process.exit(fail ? 1 : 0);
