/* test_no_animations.js — the interface is completely animation-free.
 *
 * The app used to play entrance, change-sweep, per-line glow, spinning edge
 * glow and result-print effects.  They are all gone: a content change simply
 * updates the text.  This test pins that down so no effect creeps back in.
 *
 *   - CSS:  no @keyframes, no `animation:`, no `transition:` in the page's own
 *           stylesheet, and no @property angle driving a spinning gradient;
 *   - HTML: the .lineglow/.edgeglow decoration layers are gone from the markup;
 *   - JS:   no glow builder, no print state machine, no animationend listener,
 *           no forced reflows; flashPane() is an explicit no-op seam so every
 *           existing write path (typing, paste, drop, clear, result) still
 *           compiles and simply does not animate;
 *   - OUTPUT is still written through setOut() only;
 *   - the committed single-file artifacts carry the same animation-free page.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const REPO = __dirname;
const APP = fs.readFileSync(path.join(REPO, "app.js"), "utf8");
const TPL = fs.readFileSync(path.join(REPO, "index_template.html"), "utf8");
const BUILT = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
const CSS = TPL.slice(TPL.indexOf("<style>"), TPL.indexOf("</style>"));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log("PASS: " + msg); }
  else { failed++; console.error("FAIL: " + msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

section("1. the stylesheet declares no motion");
assert(!/@keyframes/.test(CSS), "no @keyframes anywhere in the page stylesheet");
assert(!/animation\s*:/.test(CSS), "no animation declarations (entrance, sweep, glow, pulse, blink)");
assert(!/transition\s*:/.test(CSS), "no transitions either — hover states change instantly");
assert(!/@property --edge-ang/.test(CSS) && !/conic-gradient\(from var\(--edge-ang\)/.test(CSS),
       "the spinning edge-glow angle and its conic gradient are gone");
for (const name of ["chrome-enter", "pane-enter", "terminal-scan", "change-sweep", "label-flare",
                    "out-print", "out-shine", "cursor-blink", "status-pulse", "aboutIn",
                    "lg-breathe", "lg-ignite", "lg-sweep", "edge-spin"]) {
  assert(!new RegExp(name).test(CSS), "the '" + name + "' effect is gone");
}

section("2. the decoration layers are gone from the markup");
assert(!/class="lineglow"/.test(TPL) && !/class="edgeglow"/.test(TPL),
       "no .lineglow / .edgeglow layers in the panes");
assert(!/\.lgline|\.lineglow|\.edgeglow/.test(CSS), "and no CSS left behind for them");
assert(!/\.pane\.changed|\.pane\.out\.printing|\.shine/.test(CSS),
       "the trigger classes (.changed, .printing, .shine) no longer style anything");

section("3. app.js runs no effect code");
assert(/function flashPane\(pane\) \{ \/\* no animation \*\/ \}/.test(APP),
       "flashPane() is a no-op seam kept so every write path stays unchanged");
assert(!/classList\.(add|remove)\("(changed|printing|shine|lit)"\)/.test(APP),
       "no animation trigger class is ever added or removed");
assert(!/void pane\.offsetWidth|void layer\.offsetWidth/.test(APP),
       "no forced reflows are needed any more");
for (const fn of ["igniteLineGlow", "buildLineGlow", "refreshLineGlows", "syncLineGlow",
                  "markGlowLines", "printGlyphs", "endPrint", "PRINT_MS"]) {
  assert(!new RegExp(fn).test(APP), fn + " is gone from app.js");
}
assert(!/addEventListener\("animationend"/.test(APP), "nothing listens for animationend");
assert(!/requestAnimationFrame/.test(APP), "no animation frame loops");

section("4. OUTPUT is still written through one place");
assert(/function setOut\(text\) \{[\s\S]*?out\.textContent = text;/.test(APP),
       "setOut() remains the single writer of the OUTPUT pane");
assert(/flashPane\(outPane\);/.test(APP), "it still calls the (now inert) flashPane seam");

section("5. the built artifacts match");
assert(!/@keyframes (chrome-enter|pane-enter|terminal-scan|change-sweep|out-print|lg-breathe|edge-spin)/.test(BUILT),
       "built index.html ships none of the removed keyframes");
assert(!/class="lineglow"|class="edgeglow"/.test(BUILT), "built index.html ships no glow layers");
const APP_HTML = fs.readFileSync(path.join(REPO, "app.html"), "utf8");
assert(APP_HTML === BUILT, "app.html is the same freshly built page as index.html");

console.log("\n=== SUMMARY: " + passed + " passed, " + failed + " failed ===");
process.exit(failed ? 1 : 0);
