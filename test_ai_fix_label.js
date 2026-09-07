"use strict";
/* test_ai_fix_label.js — the repair button must be called AI FIX everywhere.
 *
 * `AI AUTO` described a mechanism nobody asked for; the button's job is to fix a
 * conversion the automatic offline pass could not finish, and users kept waiting
 * for an "auto" that had in fact already run and come back empty. So:
 *   - the label says AI FIX, in the artifact, in every status hint, in the
 *     welcome card, in the key dialog, in the About dialog and in the README;
 *   - the id stays `btnAi`, because the attachment/GDS suites fire `btnAi`
 *     directly and a renamed id would silently skip those tests;
 *   - the rename stopped at the labels: the machine-visible status strings the
 *     other suites pin (AI CONVERTED / AI REPLY IGNORED — direct result kept /
 *     AI failed) were NOT touched;
 *   - `✦ AI`, the older name for the same control, is gone.
 */
const fs = require("fs");
const path = require("path");

const REPO = __dirname;
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const APP = read("app.js");
const TPL = read("index_template.html");
const BUILT = read("index.html");
const README = read("README.md");

let PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("PASS:", msg); }
  else { FAIL++; console.error("FAIL:", msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

section("1. the button itself");
const BTN = (TPL.match(/<button[^>]*id="btnAi"[\s\S]*?<\/button>/) || [""])[0];
assert(BTN.length > 0, "the AI button exists in the template");
assert(/>AI FIX<\/button>/.test(BTN), "it is labelled exactly 'AI FIX'");
assert(/class="ai"/.test(BTN), "its .ai styling (green, secondary to CONVERT) is unchanged");
assert(/id="btnAi"/.test(BTN), "the id stays btnAi so the existing suites still drive the real button");
assert(/title="[^"]*"/.test(BTN), "it carries a hover hint, because the two words alone cannot explain it");
assert(/repair/i.test(BTN) && /misses a leg|failed/i.test(BTN),
       "the hint says what it repairs: a conversion that did not land the first time");
assert(/id="btnAi"[\s\S]{0,200}>AI FIX<\/button>/.test(BUILT), "the built artifact shows AI FIX");

section("2. no stale name anywhere");
const UI = BUILT.slice(0, BUILT.indexOf("<script"));   // the markup, before the inlined scripts
assert(UI.length > 4000, "isolated the artifact's UI region to check");
for (const [name, src] of [["app.js", APP], ["index_template.html", TPL], ["README.md", README], ["index.html (UI markup)", UI]]) {
  assert(!/AI AUTO|AI Auto|AI auto/.test(src), name + " never says 'AI AUTO'");
  assert(!/✦ AI/.test(src), name + " never says the older '✦ AI'");
}
/* The one place the old wording may survive is the Gemini master prompt inlined
   from spicy_data.js: that is an instruction to a model, not chrome for a user,
   and rewriting it would silently move the conversion goldens. */
assert(BUILT.length > UI.length + 100000, "the inlined prompt/engine region is still present and deliberately unscanned");
assert(!/AI AUTO|AI auto|✦ AI/.test(APP + TPL), "no user-facing string still points at a button that does not exist");

section("3. every hint points at the real label");
const hints = APP.match(/"(?:[^"\\]|\\.)*AI FIX[^"]*"/g) || [];
assert(hints.length >= 10, hints.length + " runtime strings tell the user to press AI FIX");
for (const need of [
  /ATTACHMENT NOT READ — AI FIX can re-read it/,
  /ATTACHMENT PARSE FAILED — AI FIX can re-read it/,
  /PDF ATTACHED — AI FIX needs a Gemini key/,
  /press AI FIX to re-read it with Gemini/,
  /partial — AI FIX can finish/,
  /press AI FIX again/
]) {
  assert(need.test(APP), "failure path is explained by the button name: " + need);
}
assert(/AI FIX/.test(TPL.slice(TPL.indexOf('class="welcome'), TPL.indexOf('id="setModal"'))),
       "the welcome card introduces AI FIX before the first paste");
assert(/Couldn't read this paste/.test(APP) && /could not make sense of it/.test(APP),
       "the empty-result message admits the offline read failed instead of going quiet");

section("4. the rename did not break what other suites pin");
for (const pinned of [/setStatus\("AI CONVERTED"/, /AI REPLY IGNORED — direct result kept/, /AI failed — previous result kept/]) {
  assert(pinned.test(APP), "left intact for the suites that assert it: " + pinned);
}
assert(/st\.title = msg/.test(APP),
       "setStatus mirrors the message into title, so a hint clipped by the nowrap bar is still readable");

section("5. README tells the same story");
assert(/AI FIX/.test(README), "the README names the button the reader will actually see");
assert(/About/.test(README) && /status row/.test(README),
       "the README places About where it lives now (status row, not header)");

console.log(`\n=== SUMMARY: ${PASS} passed, ${FAIL} failed ===`);
if (FAIL > 0) process.exit(1);
