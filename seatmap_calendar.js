/* Offline, keyboard-accessible calendar dropdowns for the Seat Map forms.
 * Date inputs remain editable and retain their native picker if this module
 * is unavailable. Calendar arithmetic uses UTC civil dates; "today" and the
 * initial departure date use the visitor's LOCAL calendar, never UTC midnight.
 */
(function (root) {
  "use strict";

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function pad(value) { return String(value).padStart(2, "0"); }
  function localDate(date) {
    return String(date.getFullYear()).padStart(4, "0") + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }
  function iso(date) {
    return String(date.getUTCFullYear()).padStart(4, "0") + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate());
  }
  function parse(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match || Number(match[1]) < 100) return null;
    var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return iso(date) === value ? date : null;
  }
  function addDays(date, amount) {
    var next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + amount);
    return next;
  }
  function addMonths(date, amount) {
    var next = new Date(date.getTime());
    var day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + amount);
    var last = new Date(next.getTime());
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    next.setUTCDate(Math.min(day, last.getUTCDate()));
    return next;
  }
  function monthDays(date) {
    var first = new Date(date.getTime());
    first.setUTCDate(1);
    var start = addDays(first, -first.getUTCDay());
    return Array.from({ length: 42 }, function (_, index) { return iso(addDays(start, index)); });
  }

  /** One shared dropdown, with an explicit trigger next to each date input. */
  function initialize(doc) {
    var popup = doc.getElementById("seatmapCalendar");
    if (!popup) return null;
    var active = null;
    var cursor = null;
    var today = null;

    function close(restoreFocus) {
      if (!active) return;
      var button = active.button;
      active = null;
      popup.classList.add("hidden");
      button.setAttribute("aria-expanded", "false");
      if (restoreFocus) button.focus({ preventScroll: true });
    }

    function position() {
      if (!active) return;
      var anchor = active.control.getBoundingClientRect();
      var bounds = popup.getBoundingClientRect();
      var width = (doc.documentElement && doc.documentElement.clientWidth) || root.innerWidth || 320;
      var height = root.innerHeight || 640;
      var left = Math.max(12, Math.min(anchor.left, width - bounds.width - 12));
      if (anchor.bottom < 0 || anchor.top > height) { close(popup.contains(doc.activeElement)); return; }
      var top = Math.max(12, anchor.bottom + 8);
      if (top + bounds.height > height - 12) top = Math.max(12, anchor.top - bounds.height - 8);
      popup.style.left = left + "px";
      popup.style.top = top + "px";
    }

    function render(focusSelector) {
      var year = cursor.getUTCFullYear();
      var month = cursor.getUTCMonth();
      var focused = iso(cursor);
      var markup = '<div class="seatmap-calendar-heading"><span id="seatmapCalendarLabel">CHOOSE DEPARTURE DATE</span>'
        + '<button type="button" data-calendar-action="close" aria-label="Close calendar">×</button></div>'
        + '<div class="seatmap-calendar-nav">'
        + '<button type="button" data-calendar-action="previous" aria-label="Previous month"' + (year === 100 && month === 0 ? ' disabled' : '') + '>‹</button>'
        + '<select id="seatmapCalendarMonth" aria-label="Month">';
      MONTHS.forEach(function (name, index) {
        markup += '<option value="' + index + '"' + (index === month ? ' selected' : '') + '>' + name + '</option>';
      });
      markup += '</select><select id="seatmapCalendarYear" aria-label="Year">';
      for (var y = Math.max(100, year - 10); y <= Math.min(9999, year + 10); y++) {
        markup += '<option value="' + y + '"' + (y === year ? ' selected' : '') + '>' + y + '</option>';
      }
      markup += '</select><button type="button" data-calendar-action="next" aria-label="Next month"' + (year === 9999 && month === 11 ? ' disabled' : '') + '>›</button></div>'
        + '<div class="seatmap-calendar-month" id="seatmapCalendarMonthLabel" aria-live="polite">' + MONTHS[month] + ' ' + year + '</div>'
        + '<table class="seatmap-calendar-grid" role="grid" aria-labelledby="seatmapCalendarMonthLabel"><thead><tr>';
      DAYS.forEach(function (day) { markup += '<th scope="col" abbr="' + day + '">' + day.slice(0, 2) + '</th>'; });
      markup += '</tr></thead><tbody>';
      monthDays(cursor).forEach(function (value, index) {
        if (index % 7 === 0) markup += '<tr>';
        var date = parse(value);
        var selected = value === active.input.value;
        markup += '<td role="gridcell" aria-selected="' + selected + '">';
        if (date) {
          markup += '<button type="button" data-calendar-date="' + value + '"'
            + ' class="seatmap-calendar-day' + (date.getUTCMonth() !== month ? ' is-adjacent' : '') + (selected ? ' is-selected' : '') + '"'
            + ' tabindex="' + (value === focused ? '0' : '-1') + '"'
            + (value === today ? ' aria-current="date"' : '')
            + ' aria-label="' + DAYS[date.getUTCDay()] + ', ' + MONTHS[date.getUTCMonth()] + ' ' + date.getUTCDate() + ', ' + date.getUTCFullYear() + '">'
            + date.getUTCDate() + '</button>';
        }
        markup += '</td>';
        if (index % 7 === 6) markup += '</tr>';
      });
      markup += '</tbody></table><div class="seatmap-calendar-footer"><button type="button" data-calendar-action="today">TODAY</button>'
        + '<span>Arrows move · Enter selects<br>Esc closes</span></div>';
      popup.innerHTML = markup;
      position();
      if (focusSelector) {
        var focusedElement = popup.querySelector(focusSelector);
        if (focusedElement) focusedElement.focus();
      }
    }

    function focusDay() { render('[data-calendar-date="' + iso(cursor) + '"]'); }
    function open(control) {
      if (active === control) { close(true); return; }
      close(false);
      active = control;
      today = localDate(new Date());
      cursor = parse(active.input.value) || parse(today);
      popup.classList.remove("hidden");
      active.button.setAttribute("aria-expanded", "true");
      focusDay();
    }
    function select(value) {
      if (!active || !parse(value)) return;
      var input = active.input;
      input.value = value;
      input.dispatchEvent(new root.Event("input", { bubbles: true }));
      input.dispatchEvent(new root.Event("change", { bubbles: true }));
      close(true);
    }
    function move(next, selector) {
      if (!parse(iso(next))) return;
      cursor = next;
      if (selector) render(selector); else focusDay();
    }

    ["seatmapFindDate", "seatmapDate"].forEach(function (id) {
      var input = doc.getElementById(id);
      var button = doc.getElementById(id + "Toggle");
      var control = doc.getElementById(id + "Control");
      if (!input || !button || !control) return;
      var binding = { input: input, button: button, control: control };
      control.classList.add("has-calendar");
      button.classList.remove("hidden");
      button.addEventListener("click", function () { open(binding); });
      input.addEventListener("keydown", function (event) {
        if (event.altKey && event.key === "ArrowDown") { event.preventDefault(); open(binding); }
      });
      input.addEventListener("change", function () {
        if (active === binding) { cursor = parse(input.value) || parse(today); render(); }
      });
    });

    popup.addEventListener("click", function (event) {
      if (!active) return;
      var target = event.target && event.target.closest ? event.target.closest("button") : null;
      if (!target) return;
      var value = target.getAttribute("data-calendar-date");
      if (value) { select(value); return; }
      var action = target.getAttribute("data-calendar-action");
      if (action === "close") close(true);
      if (action === "today") select(localDate(new Date()));
      if (action === "previous" || action === "next") {
        move(addMonths(cursor, action === "previous" ? -1 : 1), '[data-calendar-action="' + action + '"]');
      }
    });
    popup.addEventListener("change", function (event) {
      if (!active) return;
      if (event.target.id === "seatmapCalendarMonth") {
        move(addMonths(cursor, Number(event.target.value) - cursor.getUTCMonth()), "#seatmapCalendarMonth");
      }
      if (event.target.id === "seatmapCalendarYear") {
        move(addMonths(cursor, (Number(event.target.value) - cursor.getUTCFullYear()) * 12), "#seatmapCalendarYear");
      }
    });
    popup.addEventListener("keydown", function (event) {
      if (!active) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }
      /* Leaving either end with Tab closes the dropdown at its trigger;
         the next Tab continues through the form, never into a hidden popup. */
      if (event.key === "Tab") {
        var controls = popup.querySelectorAll('button:not([disabled]):not([tabindex="-1"]),select');
        var edge = event.shiftKey ? controls[0] : controls[controls.length - 1];
        if (doc.activeElement === edge) { event.preventDefault(); close(true); }
        return;
      }
      var value = event.target.getAttribute && event.target.getAttribute("data-calendar-date");
      if (!value) return;
      var next = parse(value);
      var offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (Object.prototype.hasOwnProperty.call(offsets, event.key)) next = addDays(next, offsets[event.key]);
      else if (event.key === "Home") next = addDays(next, -next.getUTCDay());
      else if (event.key === "End") next = addDays(next, 6 - next.getUTCDay());
      else if (event.key === "PageUp" || event.key === "PageDown") next = addMonths(next, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1));
      else return;
      event.preventDefault();
      move(next);
    });
    function outside(event) {
      if (active && !popup.contains(event.target) && !active.control.contains(event.target)) close(popup.contains(doc.activeElement));
    }
    doc.addEventListener("pointerdown", outside);
    doc.addEventListener("focusin", outside);
    doc.addEventListener("scroll", function (event) {
      // A scroll queued while the browser reveals a mobile trigger can arrive
      // after its click. Re-anchor instead of immediately closing a new picker.
      if (active && !popup.contains(event.target)) position();
    }, true);
    if (root.addEventListener) root.addEventListener("resize", position);
    return { close: close };
  }

  var api = { localDate: localDate, parse: parse, addDays: addDays, addMonths: addMonths, monthDays: monthDays, initialize: initialize };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else root.SpicySeatMapCalendar = api;
}(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this)));
