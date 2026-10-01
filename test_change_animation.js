/* test_change_animation.js — INPUT and OUTPUT panes animate on every change.
 *
 * The app plays a moving scan on a pane whenever its content changes:
 *   - CSS:  .pane::after sweep + the top scan line, re-triggered by .changed
 *   - JS:   flashPane() restarts the CSS animation on every single change
 *           (remove class -> forced reflow -> add), so back-to-back edits replay
 *           it instead of only the first change animating.
 *   - OUTPUT is written through setOut() only, which animates exactly when the
 *     text actually changes.
 *   - INPUT flashes from the `input` listener and from every programmatic
 *     inp.value write (clear, drop, paste, attached text files) — those do not
 *     fire an `input` event.
 *   - All decorative motion is disabled under prefers-reduced-motion.
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

section("1. the panes carry a moving change animation");
assert(/\.pane::after\{[^}]*background:linear-gradient/.test(CSS) &&
       /\.pane\.changed::after\{animation:change-sweep/.test(CSS),
       "a change sweep overlay exists and plays while .changed is on the pane");
assert(/@keyframes change-sweep\{[^}]*background-position:[^}]*\}/.test(CSS),
       "change-sweep moves the highlight across the pane (animated background-position)");
assert(/\.pane\.changed::before\{animation:terminal-scan/.test(CSS),
       "the top scan line re-runs with the change too");
assert(/\.pane\.changed::after\{animation:change-sweep [^}]*\}/.test(CSS) &&
       /\.pane\.changed::before\{animation:terminal-scan [^}]*\}/.test(CSS),
       "both change animations replay on the trigger class");

section("2. INPUT and OUTPUT each have their own moving animation");
assert(/\.pane\.changed::after/.test(CSS) && /\.pane\.changed::before/.test(CSS),
       "every pane animates on change (INPUT and OUTPUT share the .changed rules)");
assert(/\.pane:not\(\.out\)::after\{/.test(CSS),
       "the INPUT pane has its own sweep tint instead of the OUTPUT green");
assert(/\.pane:not\(\.out\)\.changed::after\{animation:change-sweep \.5s/.test(CSS),
       "INPUT's scan is shorter/quieter so per-keystroke changes stay gentle");

section("2b. OUTPUT change is a full result print");
assert(/\.pane\.out\.changed pre\.out\{animation:out-print/.test(CSS) &&
       /@keyframes out-print\{0%\{opacity:\.12;transform:translateY\(8px\);filter:blur\(1\.4px\)\}/.test(CSS),
       "the itinerary materializes (fade + rise + blur-to-sharp) when output changes");
assert(/@supports \(\(background-clip:text\) or \(-webkit-background-clip:text\)\)\{[\s\S]*?\.pane\.out\.changed pre\.out\{color:transparent;[\s\S]*?out-shine/.test(CSS),
       "a light streak travels through the glyphs (background-clip:text, @supports-guarded)");
assert(/@keyframes out-shine\{0%\{background-position:135% 0\}100%\{background-position:-45% 0\}\}/.test(CSS),
       "the glyph shine sweeps across and settles clean");
assert(/\.pane\.out\.changed h2\{animation:label-flare/.test(CSS) &&
       /@keyframes label-flare\{0%\{color:var\(--green\)\}/.test(CSS),
       "the OUTPUT label flares and returns on every result");
assert(/pre\.out:empty::before\{content:"[▍█]";[^}]*animation:cursor-blink/.test(CSS),
       "an empty OUTPUT pane keeps a blinking terminal cursor");

section("3. every OUTPUT repaint animates (setOut is the single writer)");
const rawWrites = APP.match(/out\.textContent\s*=(?!=)/g) || [];
assert(rawWrites.length === 1 && /function setOut\(text\)/.test(APP),
       "app.js has exactly one raw out.textContent write, inside setOut()");
assert(/if \(out\.textContent === text\) return;/.test(APP),
       "setOut animates only when the output text actually changed");
assert(/out\.textContent = text;\s*\n\s*flashPane\(outPane\);/.test(APP),
       "setOut flashes the OUTPUT pane right after writing it");
const setOutCalls = (APP.match(/[^n]setOut\(/g) || []).length;
assert(setOutCalls >= 13, "all " + setOutCalls + " output writes go through setOut()");

section("4. every INPUT change animates");
assert(/inp\.addEventListener\("input", function\(\) \{\s*\n\s*flashPane\(inpPane\);/.test(APP),
       "typing/pasting flashes the INPUT pane on every input event");
assert((APP.match(/flashInput\(\);/g) || []).length >= 4,
       "programmatic inp.value writes (clear, drop, paste, text file) flash INPUT too");

section("5. the animation restarts on consecutive changes");
assert(/pane\.classList\.remove\("changed"\);[\s\S]{0,120}void pane\.offsetWidth;[\s\S]{0,120}pane\.classList\.add\("changed"\);/.test(APP),
       "flashPane re-adds .changed after a forced reflow so every change replays the sweep");

section("6. reduced motion switches the change animation off");
assert(/prefers-reduced-motion:reduce\)\{[^}]*\.pane\.changed::after[^}]*\.about-card\{animation:none!important/.test(CSS),
       "the change animations are in the prefers-reduced-motion:reduce off-switch");
assert(/prefers-reduced-motion:reduce\)\{[^}]*\.pane\.out\.changed pre\.out[^}]*\.about-card\{animation:none!important/.test(CSS),
       "the output print, label flare and cursor blink are switched off too");
assert(/prefers-reduced-motion:reduce\)\{[^}]*\.about-card\{animation:none!important/.test(CSS) &&
       /prefers-reduced-motion:reduce\)\{[^}]*#st::before/.test(CSS),
       "the pinned reduced-motion rules (about card, status pulse) stay intact");

section("7. the built single-file page carries the feature");
assert(BUILT.includes("@keyframes change-sweep") && BUILT.includes("function flashPane(") &&
       BUILT.includes("function setOut("),
       "built index.html contains the change animation CSS and JS");

console.log("\n=== SUMMARY: " + passed + " passed, " + failed + " failed ===");
process.exit(failed ? 1 : 0);
