/* test_change_animation.js — INPUT and OUTPUT panes animate on every change.
 *
 * The app plays a moving scan on a pane whenever its content changes:
 *   - CSS:  .pane::after sweep + the top scan line, re-triggered by .changed
 *   - JS:   flashPane() restarts the CSS animation on every single change
 *           (remove class -> forced reflow -> add), so back-to-back edits replay
 *           it instead of only the first change animating.
 *   - CSS:  .lineglow/.lgline — every visible LINE of the window carries its own
 *           glowing bar, so the light walks the pane line by line, not just the
 *           top edge.  JS builds one strip per real text line and re-arms them
 *           (.lit) on each change; between changes they keep drifting.
 *   - JS:   buildLineGlow() sizes the strips from the pane's own line-height,
 *           refreshLineGlows() follows resizes/keyboard, syncLineGlow() keeps
 *           the bars glued to the text while a pane scrolls.
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
assert(/\.pane\.out\.printing pre\.out\{animation:out-print/.test(CSS) &&
       /@keyframes out-print\{0%\{opacity:\.12;transform:translateY\(8px\);filter:blur\(1\.4px\)\}/.test(CSS) &&
       !/\.pane\.out\.changed pre\.out\{animation:out-print/.test(CSS),
       "the itinerary materializes (fade + rise + blur-to-sharp) when output changes — on the short-lived .printing, never on .changed");
assert(/@supports \(\(background-clip:text\) or \(-webkit-background-clip:text\)\)\{[\s\S]*?\.pane\.out\.printing\.shine pre\.out\{color:transparent;[\s\S]*?out-shine/.test(CSS),
       "a light streak travels through the glyphs (background-clip:text, @supports-guarded)");
assert(!/\.pane\.out\.(changed|printing) pre\.out\{[^}]*background-clip/.test(CSS) &&
       /\.pane\.out\.printing\.shine pre\.out\{[^}]*background-attachment:local/.test(CSS),
       "the clipped paint lives on the short-lived .shine class (never on .changed/.printing alone), pinned to the contents");
assert(/@keyframes out-shine\{0%\{background-position:135% 0\}100%\{background-position:-45% 0\}\}/.test(CSS),
       "the glyph shine sweeps across and settles clean");
assert(/\.pane\.out\.changed h2\{animation:label-flare/.test(CSS) &&
       /@keyframes label-flare\{0%\{color:var\(--green\)\}/.test(CSS),
       "the OUTPUT label flares and returns on every result");
assert(/pre\.out:empty::before\{content:"[▍█]";[^}]*animation:cursor-blink/.test(CSS),
       "an empty OUTPUT pane keeps a blinking terminal cursor");

section("2c. every visible line of the window gets its own glowing bar");
assert(/\.lineglow\{[^}]*position:absolute[^}]*pointer-events:none/.test(CSS),
       "the per-line glow layer is a decoration overlay (never intercepts clicks)");
assert((TPL.match(/class="lineglow"/g) || []).length === 2 &&
       /<section class="pane"><h2>INPUT[\s\S]*?<\/h2>[\s\S]*?class="lineglow"/.test(TPL) &&
       /<section class="pane out"><h2[^>]*>OUTPUT<\/h2>[\s\S]*?class="lineglow"/.test(TPL),
       "one glow layer inside each pane — INPUT and OUTPUT both animate per line");
assert(/line\.style\.top = \(padTop \+ i \* lh\)\.toFixed\(2\) \+ "px";/.test(APP) &&
       /line\.style\.height = lh\.toFixed\(2\) \+ "px";/.test(APP),
       "each strip is placed and sized in JS from the pane's real line-height (no unsupported CSS multiplication)");
assert(/@keyframes lg-breathe\{/.test(CSS) && /\.lgline\{[^}]*animation:lg-breathe/.test(CSS),
       "every line's bar keeps a slow idle drift, so both windows stay alive between changes");
assert(/@keyframes lg-ignite\{/.test(CSS) && /\.lineglow\.lit \.lgline\{animation:lg-ignite/.test(CSS) &&
       /@keyframes lg-sweep\{/.test(CSS) && /\.lineglow\.lit \.lgline::before\{animation:lg-sweep/.test(CSS),
       "a change ignites every line: the bar flares with a left-to-right light sweep");
assert(/\.lgline\{[^}]*animation-delay:var\(--lgdrift-delay,0ms\)/.test(CSS) &&
       /\.lineglow\.lit \.lgline\{[^}]*animation-delay:var\(--lgignite-delay,0ms\)/.test(CSS) &&
       /line\.style\.setProperty\("--lgdrift-delay"/.test(APP) &&
       /line\.style\.setProperty\("--lgignite-delay"/.test(APP) &&
       !/calc\([^)]*\*/.test(CSS),
       "the wave staggers per line using JS-computed delays (compatible with older mobile browsers)");
assert(/\.pane:not\(\.out\) \.lineglow\{--lg:106,170,212/.test(CSS) &&
       /\.lineglow\{[^}]*--lg:83,217,119/.test(CSS),
       "INPUT glows cool blue and OUTPUT terminal green (matching each pane)");
assert(/\.lgline::before\{[^}]*rgba\(255,255,255,\.9\)/.test(CSS) && /@keyframes lg-sweep\{[^}]*background-position/.test(CSS),
       "each line's bar carries a bright head that sweeps across it");
assert(/\.lgline\.ghost\{filter:opacity\(\.3\)\}/.test(CSS) && /strip\.classList\.add\("ghost"\)/.test(APP) &&
       /var lines = Math\.min\(text\.split\("\\n"\)\.length, layer\._rows\)/.test(APP),
       "a stem with no text in it only shimmers — the light belongs to the words");

section("2d. app.js walks the window line by line (real geometry, no thrash)");
assert(/function buildLineGlow\(pane\)/.test(APP) && /line\.className = "lgline"/.test(APP),
       "app.js builds one glow strip per line of the pane");
assert(/function igniteLineGlow\(pane\)[\s\S]{0,320}layer\.classList\.add\("lit"\);/.test(APP) &&
       /pane\.classList\.add\("changed"\);\s*\n\s*igniteLineGlow\(pane\);/.test(APP),
       "flashPane() re-arms the per-line wave on every change, right after .changed");
assert(/if \(layer\._sig !== sig\)/.test(APP) && /var sig = \[rows, lh, bodyTop, bodyH, padTop, padBottom\]\.join\("\|"\)/.test(APP),
       "strips are rebuilt only when the pane geometry actually moved (typing never thrashes the DOM)");
assert(/rows > GLOW_MAX_LINES/.test(APP) && /GLOW_MAX_LINES = 80/.test(APP),
       "the strip count is capped so a very tall window cannot build thousands of nodes");
assert(/function refreshLineGlows\(\)/.test(APP) &&
       /window\.addEventListener\("resize", refreshLineGlows\)/.test(APP) &&
       /window\.addEventListener\("orientationchange", refreshLineGlows\)/.test(APP) &&
       /new window\.ResizeObserver/.test(APP),
       "the bars follow window resize, rotation and pane reflow (phone keyboard)");
assert(/function syncLineGlow\(pane\)/.test(APP) &&
       /inp\.addEventListener\("scroll", function \(\) \{ syncLineGlow\(inpPane\); \}\)/.test(APP) &&
       /out\.addEventListener\("scroll", function \(\) \{ syncLineGlow\(outPane\); \}\)/.test(APP),
       "scrolling a pane slides the bars with the text instead of drifting off the lines");
assert(/setTimeout\(function \(\) \{\s*\n\s*layer\._litTimer = null;\s*\n\s*layer\.classList\.remove\("lit"\);/.test(APP),
       "when the wave ends the pane hands itself back to the idle drift");
assert(/function glowIgniteStep\(layer\)/.test(APP) && /getPropertyValue\("--lgstep"\)/.test(APP),
       "each pane's own CSS stagger drives its wave length (INPUT faster than OUTPUT)");

section("2e. OUTPUT has a bounded, touch-friendly scrollport");
assert(/main\{flex:1 1 0%;[^}]*grid-template-rows:minmax\(0,1fr\)/.test(CSS) &&
       /@media \(max-width:840px\)\{main\{grid-template-columns:1fr;grid-template-rows:repeat\(2,minmax\(0,1fr\)\)\}\}/.test(CSS),
       "the pane grid is bounded at desktop and mobile sizes so long content scrolls inside its pane");
assert(/textarea,pre\.out\{flex:1 1 0%;[^}]*min-height:0;min-width:0;overscroll-behavior:contain;-webkit-overflow-scrolling:touch\}/.test(CSS) &&
       /pre\.out\{[^}]*overflow-y:auto/.test(CSS) && /tabindex="0"/.test(TPL),
       "OUTPUT is a native touch/keyboard scrollport instead of expanding past its window");

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
assert(/prefers-reduced-motion:reduce\)\{[^}]*\.pane\.out\.printing pre\.out[^}]*\.about-card\{animation:none!important/.test(CSS),
       "the output print, label flare and cursor blink are switched off too");
assert(/prefers-reduced-motion:reduce\)\{[^}]*\.about-card\{animation:none!important/.test(CSS) &&
       /prefers-reduced-motion:reduce\)\{[^}]*#st::before/.test(CSS),
       "the pinned reduced-motion rules (about card, status pulse) stay intact");
assert(/prefers-reduced-motion:reduce\)\{[^}]*\.lineglow,\.lgline,\.lgline::before,\.edgeglow,\.about-card\{animation:none!important/.test(CSS) &&
       /\.pane \.lineglow\{display:block!important\}\.pane \.lgline\{opacity:\.22!important\}\.pane \.lgline::before\{display:none!important\}/.test(CSS),
       "reduced-motion users still get a static glow bar without any animated sweep");

section("7. the built single-file page carries the feature");
assert(BUILT.includes("@keyframes change-sweep") && BUILT.includes("function flashPane(") &&
       BUILT.includes("function setOut("),
       "built index.html contains the change animation CSS and JS");
assert(BUILT.includes("@keyframes lg-ignite") && BUILT.includes("@keyframes lg-breathe") &&
       BUILT.includes("function buildLineGlow(") && BUILT.includes('class="lineglow"'),
       "built index.html carries the per-line glow bars (CSS, JS and markup)");

section("8. endless glow travelling around the full border of both frames");
assert(/@property --edge-ang\{syntax:"<angle>"/.test(CSS) && /@keyframes edge-spin\{to\{--edge-ang:360deg\}\}/.test(CSS),
       "a registered angle is animated a full turn (edge-spin)");
assert(/\.edgeglow\{[^}]*animation:edge-spin var\(--eg-speed\) linear infinite/.test(CSS),
       "the edge glow loops forever at constant speed");
assert(/\.edgeglow::before,\.edgeglow::after\{[^}]*conic-gradient\(from var\(--edge-ang\)/.test(CSS) &&
       /mask-composite:exclude/.test(CSS),
       "the light is a conic ring masked to the border, with a blurred bloom layer");
assert(/\.pane:not\(\.out\) \.edgeglow\{--eg:106,170,212/.test(CSS),
       "INPUT glows blue, OUTPUT green");
assert((TPL.match(/<div class="edgeglow" aria-hidden="true"><\/div>/g) || []).length === 2 &&
       BUILT.includes('class="edgeglow"') && BUILT.includes("@keyframes edge-spin"),
       "both frames carry the edge glow in the template and the built page");

console.log("\n=== SUMMARY: " + passed + " passed, " + failed + " failed ===");
process.exit(failed ? 1 : 0);
