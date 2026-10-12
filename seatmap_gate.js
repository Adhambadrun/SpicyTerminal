/* seatmap_gate.js — a ten-click counter. RETIRED: nothing ships it.
 *
 * HISTORY. While the Seat Map was still being built it stayed sealed: the
 * status-row link was dimmed and only opened on the tenth click, and the
 * /seatmap URL checked the same count before drawing anything. Two places had
 * to agree on the lock — the link in app.js and the page in seatmap.js — which
 * is why the counter lived in one small module.
 *
 * TODAY the Seat Map is open to everyone. app.js paints the link as an
 * ordinary link, seatmap.js draws the map on arrival, and build_web.py does
 * not inline this file, so a shipped page cannot re-seal the map by accident
 * and the text "SEAT MAP LOCKED" appears nowhere in the app.
 *
 * The module is kept because it still works and it is still tested
 * (test_seatmap_gate.js executes it): if a private door is ever wanted again,
 * wire these two call sites and inline it in build_web.py. Until then it is
 * dead code in the repository, which is a deliberate choice, not an oversight.
 *
 * It is a local, in-tab annoyance, never a security control: it stores a click
 * count and a flag in sessionStorage, keeps the unlock across reloads in the
 * same tab, forgets in a new tab, falls back to memory when storage is blocked
 * or full, and treats a damaged flag as locked rather than open.
 */
(function (root) {
  "use strict";

  /** How many clicks on the Seat Map link open it. */
  var CLICKS_REQUIRED = 10;
  /** sessionStorage key: {"clicks":<n>,"unlocked":<bool>} for this tab only. */
  var STORE_KEY = "spicy_seatmap_gate";

  /* Used when sessionStorage is unavailable: the gate still works inside the
     page, it just forgets on reload. */
  var memory = null;

  function storage() {
    try {
      var store = root && root.sessionStorage;
      if (store && typeof store.getItem === "function" && typeof store.setItem === "function") return store;
    } catch (e) { /* access to sessionStorage can throw outright */ }
    return null;
  }

  function read() {
    var raw = null;
    var store = storage();
    if (store) { try { raw = store.getItem(STORE_KEY); } catch (e) { raw = null; } }
    if (raw == null) return memory ? { clicks: memory.clicks, unlocked: memory.unlocked } : { clicks: 0, unlocked: false };
    try {
      var parsed = JSON.parse(raw);
      /* A payload is only believed when both fields are exactly the shape
         written: a hand-edited or half-written flag locks, never unlocks. */
      if (!parsed || typeof parsed.clicks !== "number" || !Number.isFinite(parsed.clicks) || parsed.clicks < 0) {
        return { clicks: 0, unlocked: false };
      }
      return {
        clicks: Math.floor(parsed.clicks),
        unlocked: parsed.unlocked === true
      };
    } catch (e) {
      return { clicks: 0, unlocked: false };   /* a corrupted flag locks, never unlocks */
    }
  }

  function write(state) {
    memory = { clicks: state.clicks, unlocked: state.unlocked === true };
    var store = storage();
    if (!store) return;
    try { store.setItem(STORE_KEY, JSON.stringify(memory)); } catch (e) { /* full or blocked: memory holds */ }
  }

  /** True once the tenth click has landed in this tab. */
  function isUnlocked() {
    return read().unlocked === true;
  }

  /** Clicks still owed before the link opens (0 once unlocked). */
  function clicksLeft() {
    var state = read();
    return state.unlocked ? 0 : Math.max(0, CLICKS_REQUIRED - state.clicks);
  }

  /** Record one click. Returns {unlocked, clicks, remaining}. */
  function knock() {
    var state = read();
    if (state.unlocked) return { unlocked: true, clicks: state.clicks, remaining: 0 };
    state.clicks += 1;
    if (state.clicks >= CLICKS_REQUIRED) state.unlocked = true;
    write(state);
    return {
      unlocked: state.unlocked,
      clicks: state.clicks,
      remaining: Math.max(0, CLICKS_REQUIRED - state.clicks)
    };
  }

  /** Open without knocking (used by nothing on purpose — here for tests and
   *  for the console: `SpicySeatMapGate.unlock()`). */
  function unlock() {
    var state = read();
    write({ clicks: Math.max(state.clicks, CLICKS_REQUIRED), unlocked: true });
  }

  /** Back to sealed, first click owed again. */
  function lock() {
    write({ clicks: 0, unlocked: false });
  }

  var API = {
    CLICKS_REQUIRED: CLICKS_REQUIRED,
    STORE_KEY: STORE_KEY,
    isUnlocked: isUnlocked,
    clicksLeft: clicksLeft,
    knock: knock,
    unlock: unlock,
    lock: lock
  };

  if (typeof module === "object" && module && module.exports) module.exports = API;
  if (root) root.SpicySeatMapGate = API;
})(typeof window !== "undefined" ? window : null);
