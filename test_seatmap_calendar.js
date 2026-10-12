"use strict";

/* Civil-date arithmetic and the real dropdown controller, without a runtime
 * dependency or a network call. Browser smoke coverage also checks the built
 * page at desktop/mobile sizes; these tests pin the interaction contracts. */
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const { execFileSync } = require("child_process");
const Calendar = require("./seatmap_calendar.js");
const SOURCE = fs.readFileSync(__dirname + "/seatmap_calendar.js", "utf8");
let checks = 0;
function test(name, run) { run(); checks++; console.log("PASS:", name); }
const iso = date => date.toISOString().slice(0, 10);

test("civil dates reject invalid days and accept leap years", () => {
  ["", "tomorrow", "2026-2-01", "2026-02-29", "2028-02-30", "2026-13-01", "2026-00-01", "2026-12-00", "0099-12-01"].forEach(value => assert.strictEqual(Calendar.parse(value), null, value));
  ["2028-02-29", "2026-12-31", "0100-01-01", "9999-12-31"].forEach(value => assert.strictEqual(iso(Calendar.parse(value)), value));
});

test("month and year navigation clamps the day without skipping February", () => {
  assert.strictEqual(iso(Calendar.addMonths(Calendar.parse("2026-01-31"), 1)), "2026-02-28");
  assert.strictEqual(iso(Calendar.addMonths(Calendar.parse("2028-01-31"), 1)), "2028-02-29");
  assert.strictEqual(iso(Calendar.addMonths(Calendar.parse("2028-02-29"), 12)), "2029-02-28");
  assert.strictEqual(iso(Calendar.addMonths(Calendar.parse("2027-01-31"), -1)), "2026-12-31");
  assert.strictEqual(iso(Calendar.addDays(Calendar.parse("2026-12-31"), 1)), "2027-01-01");
});

test("every calendar month has six complete Sunday-first weeks", () => {
  for (const year of [2026, 2028]) for (let month = 1; month <= 12; month++) {
    const date = Calendar.parse(`${year}-${String(month).padStart(2, "0")}-15`);
    const days = Calendar.monthDays(date);
    assert.strictEqual(days.length, 42);
    assert.strictEqual(new Set(days).size, 42);
    assert.strictEqual(Calendar.parse(days[0]).getUTCDay(), 0);
    days.forEach((day, index) => assert.strictEqual(iso(Calendar.addDays(Calendar.parse(days[0]), index)), day));
  }
});

test("today follows the visitor's date on both sides of UTC midnight", () => {
  function local(tz, value) {
    return execFileSync(process.execPath, ["-e", `process.stdout.write(require('./seatmap_calendar.js').localDate(new Date('${value}')))`], {
      cwd: __dirname, env: { ...process.env, TZ: tz }, encoding: "utf8"
    });
  }
  assert.strictEqual(local("Pacific/Kiritimati", "2026-10-12T22:30:00Z"), "2026-10-13");
  assert.strictEqual(local("America/Los_Angeles", "2026-10-12T00:30:00Z"), "2026-10-11");
  assert.strictEqual(local("Africa/Cairo", "2026-10-12T22:30:00Z"), "2026-10-13");
});

/* Small DOM harness: parse only the controls the dropdown itself emits so
 * focus, selected-day state, and delegated events run through the real code. */
function page() {
  const nodes = new Map();
  const doc = { activeElement: null, documentElement: { clientWidth: 390 }, listeners: {} };
  function element(id, attributes = {}) {
    const classes = new Set(["hidden"]);
    return {
      id, attributes, value: "", innerHTML: "", style: {}, parentNode: null, listeners: {},
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      dispatchEvent(event) { (this.listeners[event.type] || []).forEach(fn => fn(event)); },
      getAttribute(name) { return this.attributes[name] ?? null; },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      contains(target) { return target === this || target.parentNode === this; },
      focus() { doc.activeElement = this; },
      closest() { return this; },
      getBoundingClientRect() { return { left: 200, top: 100, bottom: 136, width: 304, height: 400 }; }
    };
  }
  doc.getElementById = id => nodes.get(id) || null;
  doc.addEventListener = (type, fn) => (doc.listeners[type] ||= []).push(fn);
  const popup = element("seatmapCalendar");
  nodes.set(popup.id, popup);
  let lastMarkup, controls = [];
  function popupControls() {
    if (lastMarkup !== popup.innerHTML) {
      lastMarkup = popup.innerHTML;
      controls = [...lastMarkup.matchAll(/<(button|select)\b([^>]*)>/g)].map(match => {
        const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(attr => [attr[1], attr[2]]));
        const node = element(attrs.id || "", attrs);
        node.parentNode = popup;
        node.disabled = /\bdisabled\b/.test(match[2]);
        return node;
      });
    }
    return controls;
  }
  popup.querySelector = selector => popupControls().find(node => {
    if (selector.startsWith("#")) return node.id === selector.slice(1);
    const match = /\[([^=]+)="([^"]+)"\]/.exec(selector);
    return match && node.getAttribute(match[1]) === match[2];
  });
  popup.querySelectorAll = () => popupControls().filter(node => !node.disabled && node.getAttribute("tabindex") !== "-1");
  for (const id of ["seatmapFindDate", "seatmapDate"]) {
    const control = element(id + "Control");
    nodes.set(control.id, control);
    for (const suffix of ["", "Toggle"]) {
      const node = element(id + suffix);
      node.parentNode = control;
      node.value = "2028-02-29";
      nodes.set(node.id, node);
    }
  }
  const root = { document: doc, innerWidth: 390, innerHeight: 844, Date, Event, addEventListener() {} };
  root.window = root;
  vm.runInNewContext(SOURCE, root);
  root.SpicySeatMapCalendar.initialize(doc);
  const el = id => nodes.get(id);
  const click = (node, target = node) => node.dispatchEvent({ type: "click", target });
  const key = (target, name, extra = {}) => {
    const event = { type: "keydown", target, key: name, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra };
    popup.dispatchEvent(event);
    return event;
  };
  const action = name => popup.querySelector(`[data-calendar-action="${name}"]`);
  const day = value => popup.querySelector(`[data-calendar-date="${value}"]`);
  return { el, doc, popup, click, key, action, day };
}

test("both editable fields have a discoverable, shared calendar with the selected day focused", () => {
  const p = page();
  const trigger = p.el("seatmapFindDateToggle");
  assert(!trigger.classList.contains("hidden"));
  p.click(trigger);
  assert(!p.popup.classList.contains("hidden"));
  assert.strictEqual(trigger.getAttribute("aria-expanded"), "true");
  assert.strictEqual(p.doc.activeElement.getAttribute("data-calendar-date"), "2028-02-29");
  assert(/aria-selected="true"/.test(p.popup.innerHTML));
  assert.strictEqual(p.popup.style.left, "74px", "popover is clamped inside a small viewport");
  p.el("seatmapDate").value = "2027-01-01";
  p.click(p.el("seatmapDateToggle"));
  assert.strictEqual(trigger.getAttribute("aria-expanded"), "false");
  assert.strictEqual(p.el("seatmapDateToggle").getAttribute("aria-expanded"), "true");
  assert.strictEqual(p.doc.activeElement.getAttribute("data-calendar-date"), "2027-01-01");
});

test("choosing a day changes only the active field, dispatches input/change and restores focus", () => {
  const p = page();
  const field = p.el("seatmapFindDate"), events = [];
  field.addEventListener("input", () => events.push("input"));
  field.addEventListener("change", () => events.push("change"));
  p.click(p.el("seatmapFindDateToggle"));
  p.click(p.popup, p.day("2028-03-01"));
  assert.strictEqual(field.value, "2028-03-01");
  assert.strictEqual(p.el("seatmapDate").value, "2028-02-29");
  assert.deepStrictEqual(events, ["input", "change"]);
  assert(p.popup.classList.contains("hidden"));
  assert.strictEqual(p.doc.activeElement, p.el("seatmapFindDateToggle"));
});

test("arrows, week boundaries, month/year jumps and Escape work without committing a date", () => {
  const p = page();
  p.click(p.el("seatmapFindDateToggle"));
  assert(p.key(p.doc.activeElement, "ArrowRight").prevented);
  assert.strictEqual(p.doc.activeElement.getAttribute("data-calendar-date"), "2028-03-01");
  p.key(p.doc.activeElement, "Home");
  assert.strictEqual(p.doc.activeElement.getAttribute("data-calendar-date"), "2028-02-27");
  p.key(p.doc.activeElement, "End");
  assert.strictEqual(p.doc.activeElement.getAttribute("data-calendar-date"), "2028-03-04");
  p.key(p.doc.activeElement, "PageUp");
  assert.strictEqual(p.doc.activeElement.getAttribute("data-calendar-date"), "2028-02-04");
  p.key(p.doc.activeElement, "PageDown", { shiftKey: true });
  assert.strictEqual(p.doc.activeElement.getAttribute("data-calendar-date"), "2029-02-04");
  p.key(p.doc.activeElement, "Escape");
  assert.strictEqual(p.el("seatmapFindDate").value, "2028-02-29");
  assert.strictEqual(p.doc.activeElement, p.el("seatmapFindDateToggle"));
  assert(p.popup.classList.contains("hidden"));
});

test("month/year menus and previous/next controls retain focus and clamp leap days", () => {
  const p = page();
  p.click(p.el("seatmapDateToggle"));
  const year = p.popup.querySelector("#seatmapCalendarYear");
  year.value = "2029";
  p.popup.dispatchEvent({ type: "change", target: year });
  assert.strictEqual(p.doc.activeElement.id, "seatmapCalendarYear");
  assert(p.day("2029-02-28"));
  assert(!p.day("2029-02-29"));
  p.click(p.popup, p.action("next"));
  assert.strictEqual(p.doc.activeElement.getAttribute("data-calendar-action"), "next");
  const month = p.popup.querySelector("#seatmapCalendarMonth");
  month.value = "0";
  p.popup.dispatchEvent({ type: "change", target: month });
  assert(p.popup.innerHTML.includes("January 2029"));
  p.click(p.popup, p.action("previous"));
  assert(p.popup.innerHTML.includes("December 2028"));
});

test("Tab boundaries and outside clicks dismiss without changing the field", () => {
  const p = page(), trigger = p.el("seatmapFindDateToggle");
  p.click(trigger);
  p.action("today").focus();
  assert(p.key(p.doc.activeElement, "Tab").prevented);
  assert(p.popup.classList.contains("hidden"));
  assert.strictEqual(p.doc.activeElement, trigger);
  p.click(trigger);
  p.doc.listeners.pointerdown.forEach(fn => fn({ target: { parentNode: null } }));
  assert(p.popup.classList.contains("hidden"));
  assert.strictEqual(p.el("seatmapFindDate").value, "2028-02-29");
});

test("Today and Alt+Down use the same picker without submitting a form", () => {
  const p = page();
  let prevented = false;
  p.el("seatmapDate").dispatchEvent({ type: "keydown", key: "ArrowDown", altKey: true, preventDefault() { prevented = true; } });
  assert(prevented);
  p.click(p.popup, p.action("today"));
  assert.strictEqual(p.el("seatmapDate").value, Calendar.localDate(new Date()));
  assert(p.popup.classList.contains("hidden"));
});

test("scroll events queued while revealing a trigger re-anchor the open dropdown", () => {
  const p = page();
  p.click(p.el("seatmapDateToggle"));
  p.doc.listeners.scroll.forEach(fn => fn({ target: { parentNode: null } }));
  assert(!p.popup.classList.contains("hidden"), "a mobile auto-scroll must not dismiss a newly opened picker");
  assert.strictEqual(p.el("seatmapDateToggle").getAttribute("aria-expanded"), "true");
});

console.log("\nSeat Map calendar checks: " + checks + " passed.");
