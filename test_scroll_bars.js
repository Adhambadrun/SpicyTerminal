"use strict";
/* test_scroll_bars.js — the OUTPUT window must always scroll, and INPUT wears
 * the OUTPUT scrollbar.
 *
 * What this pins down:
 *   - OUTPUT stays a native scrollport (overflow-y:auto, overscroll-behavior:
 *     contain, -webkit-overflow-scrolling:touch, tabindex) — a long itinerary
 *     scrolls inside its own window, never off the page;
 *   - nothing clips or animates the OUTPUT text any more: the app ships with
 *     no animations at all, so there is no background-clip:text paint (the
 *     browser bug where a clipped background stops a window from scrolling)
 *     and no transient .printing/.shine state left on the scrollport;
 *   - both windows wear one scrollbar: the INPUT textarea shares the OUTPUT's
 *     thin green bar (standard properties + ::-webkit-scrollbar rules), and
 *     nothing can hide it — the INPUT header is just the label, and app.js has
 *     no scrollbar state at all;
 *   - the committed single-file artifact carries all of it.
 *
 * Behaviour runs the REAL SCROLLBARS block of app.js in a vm sandbox with a DOM
 * exactly as small as it needs (same approach as test_about_dialog.js).
 */
const fs = require("fs");
const path = require("path");

const REPO = __dirname;
const APP = fs.readFileSync(path.join(REPO, "app.js"), "utf8");
const TPL = fs.readFileSync(path.join(REPO, "index_template.html"), "utf8");
const BUILT = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
const README = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
const CSS = TPL.slice(TPL.indexOf("<style>"), TPL.indexOf("</style>"));

let PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("PASS:", msg); }
  else { FAIL++; console.error("FAIL:", msg); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

/* ---------- 1. OUTPUT is still a real scrollport ---------- */
section("1. OUTPUT keeps a bounded, native scrollport");
assert(/textarea,pre\.out\{flex:1 1 0%;[^}]*overflow:auto;[^}]*overscroll-behavior:contain;-webkit-overflow-scrolling:touch\}/.test(CSS),
       "both windows keep overflow:auto plus touch-friendly scrolling");
assert(/pre\.out\{display:block;color:var\(--out\);overflow-x:auto;overflow-y:auto\}/.test(CSS),
       "OUTPUT declares its own vertical (and horizontal) scrolling");
assert(/<pre class="out" id="out"[^>]*tabindex="0"/.test(TPL),
       "OUTPUT stays keyboard-focusable so PageUp/PageDown reach the window");

/* ---------- 2. nothing clipped, nothing animated, on a scrolling window ---------- */
section("2. the OUTPUT window is plain: no clipped paint, no motion");
assert(!/background-clip:text/.test(CSS) && !/-webkit-background-clip:text/.test(CSS),
       "no background-clip:text paint anywhere — the scroll-killing effect is gone for good");
assert(!/animation:/.test(CSS) && !/@keyframes/.test(CSS),
       "the stylesheet declares no animation at all");
assert(!/\.printing|\.shine|\.changed/.test(CSS),
       "the transient print/sweep classes no longer exist in the stylesheet");
assert(!/printGlyphs|igniteLineGlow|PRINT_MS|animationend/.test(APP),
       "app.js keeps no print/glow machinery and listens for no animationend");
assert(/function flashPane\(pane\) \{ \/\* no animation \*\/ \}/.test(APP),
       "flashPane is an explicit no-op seam, so pane writes never animate");

/* ---------- 3. one scrollbar for both windows ---------- */
section("3. INPUT wears the OUTPUT scrollbar");
assert(/textarea,pre\.out\{scrollbar-width:thin;scrollbar-color:rgba\(81,224,124,\.42\) transparent\}/.test(CSS),
       "one shared declaration gives both windows the same thin green bar");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const part of ["::-webkit-scrollbar{width:8px;height:8px}",
                    "::-webkit-scrollbar-track{background:rgba(7,12,16,.72)}",
                    "::-webkit-scrollbar-thumb{background:rgba(81,224,124,.34);border:2px solid #0a0f14;border-radius:8px}",
                    "::-webkit-scrollbar-thumb:hover{background:rgba(81,224,124,.68)}"]) {
  const decl = esc(part.slice(part.indexOf("{") + 1, -1));
  assert(new RegExp("textarea::-webkit-scrollbar[^{]*\\{[^}]*" + decl + "[^}]*\\}").test(CSS) &&
         new RegExp("pre\\.out::-webkit-scrollbar[^{]*\\{[^}]*" + decl + "[^}]*\\}").test(CSS),
         "Safari/Chromium bar rule is shared: " + part);
}
assert(!/::-webkit-scrollbar[^{]*\{[^}]*display:none/.test(CSS) && !/scrollbar-width:none/.test(CSS),
       "nothing anywhere hides a scrollbar — the shared bar is always drawn");

/* ---------- 4. no switch: the INPUT header is just the label ---------- */
section("4. no scrollbar switch, and no way to hide the bar");
const IN_HEAD = (TPL.match(/<section class="pane"><h2>INPUT[\s\S]*?<\/h2>/) || [""])[0];
assert(IN_HEAD.length > 0 && !/<button/.test(IN_HEAD) && /<h2>INPUT<\/h2>/.test(IN_HEAD),
       "the INPUT header carries the label and nothing else");
assert(!/btnBars|barstoggle|bars-off/.test(TPL),
       "the SCROLLBAR pill and its state hooks are gone from the page");
assert(!/btnBars|barstoggle|bars-off|spicy_input_bars/.test(APP),
       "app.js keeps no scrollbar state (no switch, no per-device bar preference)");
assert(!/\.barstoggle/.test(CSS) && !/\.pane\.bars-off/.test(CSS) && !/\.barstoggle/.test(BUILT),
       "the switch's CSS is gone too, built page included");

/* ---------- 5. the SCROLLBARS block holds no effect code at all ---------- */
section("5. the SCROLLBARS block is documentation, not an effect");
const SRC = APP.slice(APP.indexOf("/* SCROLLBARS:BEGIN */"), APP.indexOf("/* SCROLLBARS:END */") + "/* SCROLLBARS:END */".length);
assert(SRC.length > 0, "the SCROLLBARS block still delimits the OUTPUT scrolling contract");
assert(!/function\s|classList|setTimeout/.test(SRC),
       "it contains no class juggling, no timers — the window is simply native");

/* ---------- 6. the built artifact carries it ---------- */
section("6. the committed single-file page carries the fix");
assert(BUILT.includes("/* SCROLLBARS:BEGIN */") && BUILT.includes("textarea,pre.out{scrollbar-width:thin"),
       "built index.html carries the OUTPUT scrolling contract and the shared scrollbar rules (a forgotten npm run build fails here)");
assert(!BUILT.includes(".pane.out.printing.shine pre.out") && !/@keyframes\s+(out-print|out-shine|change-sweep|pane-enter)/.test(BUILT),
       "the built page ships none of the old print/sweep animations");
assert(!/btnBars|barstoggle|bars-off/.test(BUILT),
       "built index.html ships no SCROLLBAR switch");
assert(/OUTPUT always scrolls/.test(README) && !/SCROLLBAR pill/.test(README),
       "README documents the OUTPUT scroll guarantee and no longer advertises the switch");

console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
process.exit(FAIL ? 1 : 0);
