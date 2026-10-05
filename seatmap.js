/* Seat Map demo for SpicyTerminal.
 *
 * This is intentionally a static, local-only viewer. It does not call an
 * airline, inventory provider, or backend. Every seat status is generated
 * deterministically from the entered demo flight and refresh counter.
 */
(function (root) {
  "use strict";

  /** Static aircraft outlines used only by the clearly labelled demo viewer. */
  var AIRCRAFT_LAYOUTS = {
    "738": {
      name: "Boeing 737-800",
      iataCode: "738",
      icaoCode: "B738",
      wingStartRow: 12,
      wingEndRow: 23,
      facilities: ["GALLEY", "LAVATORY", "EXIT"],
      cabins: [
        { name: "Business", code: "business", from: 1, to: 4, groups: [["A", "B", "C"], ["D", "E", "F"]], pitch: 38, width: 21, features: ["RECLINE", "POWER — SAMPLE"] },
        { name: "Economy", code: "economy", from: 5, to: 33, groups: [["A", "B", "C"], ["D", "E", "F"]], exitRows: [16, 17], pitch: 31, width: 17, features: ["STANDARD LEGROOM — SAMPLE"] }
      ]
    },
    "320": {
      name: "Airbus A320",
      iataCode: "320",
      icaoCode: "A320",
      wingStartRow: 11,
      wingEndRow: 20,
      facilities: ["GALLEY", "LAVATORY", "EXIT"],
      cabins: [
        { name: "Business", code: "business", from: 1, to: 3, groups: [["A", "B", "C"], ["D", "E", "F"]], pitch: 37, width: 21, features: ["RECLINE", "POWER — SAMPLE"] },
        { name: "Economy", code: "economy", from: 4, to: 31, groups: [["A", "B", "C"], ["D", "E", "F"]], exitRows: [14, 15], pitch: 30, width: 18, features: ["STANDARD LEGROOM — SAMPLE"] }
      ]
    },
    "77W": {
      name: "Boeing 777-300ER",
      iataCode: "77W",
      icaoCode: "B77W",
      wingStartRow: 28,
      wingEndRow: 43,
      facilities: ["GALLEY", "LAVATORY", "EXIT"],
      cabins: [
        { name: "First", code: "first", from: 1, to: 4, groups: [["A"], ["D", "G"], ["K"]], pitch: 80, width: 34, features: ["LIE-FLAT — SAMPLE", "POWER — SAMPLE"] },
        { name: "Business", code: "business", from: 5, to: 15, groups: [["A", "C"], ["D", "E", "G"], ["H", "K"]], pitch: 44, width: 22, features: ["LIE-FLAT — SAMPLE", "POWER — SAMPLE"] },
        { name: "Premium Economy", code: "premium_economy", from: 16, to: 26, groups: [["A", "B", "C"], ["D", "E", "F", "G"], ["H", "J", "K"]], pitch: 38, width: 19, features: ["EXTRA LEGROOM — SAMPLE", "POWER — SAMPLE"] },
        { name: "Economy", code: "economy", from: 27, to: 58, groups: [["A", "B", "C"], ["D", "E", "F", "G"], ["H", "J", "K"]], exitRows: [38, 39], pitch: 32, width: 17, features: ["STANDARD LEGROOM — SAMPLE"] }
      ]
    }
  };

  var AVAILABLE_STATUSES = ["available", "premium", "extra_legroom", "exit_row"];
  var STATUS_LABELS = {
    available: "Available",
    occupied: "Occupied",
    blocked: "Unavailable",
    premium: "Premium",
    extra_legroom: "Extra legroom",
    exit_row: "Exit row"
  };

  /** Normalize and validate an airline flight number without inventing a carrier. */
  function normalizeFlightNumber(value) {
    var normalized = String(value == null ? "" : value).toUpperCase().replace(/[\s-]+/g, "");
    if (!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(normalized)) {
      throw new TypeError("Enter a flight number such as AS100 or BA72.");
    }
    return normalized;
  }

  /** Normalize a three-letter airport code. */
  function normalizeAirport(value, fieldName) {
    var normalized = String(value == null ? "" : value).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
      throw new TypeError((fieldName || "Airport") + " must be a three-letter IATA code.");
    }
    return normalized;
  }

  /** Validate a strict YYYY-MM-DD date without relying on locale parsing. */
  function normalizeDate(value) {
    var normalized = String(value == null ? "" : value).trim();
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
    if (!match) throw new TypeError("Choose a valid departure date.");
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new TypeError("Choose a valid departure date.");
    }
    return normalized;
  }

  /** Return an unsigned deterministic hash used for sample statuses. */
  function hashString(value) {
    var hash = 2166136261;
    var text = String(value);
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /** Choose a visibly varied but reproducible status for a sample seat. */
  function sampleStatus(seed, seat, refreshIndex) {
    var score = hashString(seed + "|" + seat.id + "|" + refreshIndex) % 100;
    var premiumCabin = seat.cabinCode === "first" || seat.cabinCode === "business" || seat.cabinCode === "premium_economy";
    if (seat.isExitRow) {
      if (score < 42) return "exit_row";
      if (score < 69) return "occupied";
      if (score < 77) return "blocked";
      return "available";
    }
    if (premiumCabin) {
      if (score < 42) return "premium";
      if (score < 70) return "occupied";
      if (score < 77) return "blocked";
      return "available";
    }
    if (score < 53) return "available";
    if (score < 78) return "occupied";
    if (score < 87) return "blocked";
    if (score < 94) return "extra_legroom";
    return "premium";
  }

  /** Determine whether a seat is at a window, aisle, or middle position. */
  function seatPosition(groupIndex, groupCount, seatIndex, groupLength) {
    var isOuterGroup = groupIndex === 0 || groupIndex === groupCount - 1;
    var isOuterSeat = seatIndex === 0 || seatIndex === groupLength - 1;
    if (isOuterGroup && isOuterSeat) {
      return (groupIndex === 0 && seatIndex === 0) || (groupIndex === groupCount - 1 && seatIndex === groupLength - 1)
        ? "window"
        : "aisle";
    }
    if (!isOuterGroup && isOuterSeat) return "aisle";
    return "middle";
  }

  /** Build a full local demo map; no network request or provider data is used. */
  function createDemoSeatMap(input, refreshIndex) {
    var details = input || {};
    var flightNumber = normalizeFlightNumber(details.flightNumber);
    var origin = normalizeAirport(details.origin, "Origin");
    var destination = normalizeAirport(details.destination, "Destination");
    var departureDate = normalizeDate(details.date);
    var aircraftCode = String(details.aircraftCode || "").toUpperCase();
    var layout = AIRCRAFT_LAYOUTS[aircraftCode];
    if (!layout) throw new TypeError("Choose one of the sample aircraft layouts.");
    var refresh = Number.isFinite(Number(refreshIndex)) ? Math.max(0, Math.floor(Number(refreshIndex))) : 0;
    var seed = [flightNumber, origin, destination, departureDate, aircraftCode].join("|");
    var cabins = [];
    var totalSeats = 0;

    layout.cabins.forEach(function (cabin) {
      var rows = [];
      for (var rowNumber = cabin.from; rowNumber <= cabin.to; rowNumber++) {
        var isExitRow = (cabin.exitRows || []).indexOf(rowNumber) !== -1;
        var seats = [];
        cabin.groups.forEach(function (group, groupIndex) {
          group.forEach(function (letter, seatIndex) {
            var id = String(rowNumber) + letter;
            var seat = {
              id: id,
              row: rowNumber,
              letter: letter,
              cabin: cabin.name,
              cabinCode: cabin.code,
              position: seatPosition(groupIndex, cabin.groups.length, seatIndex, group.length),
              status: "available",
              isExitRow: isExitRow,
              pitchInches: cabin.pitch,
              widthInches: cabin.width,
              features: cabin.features.slice()
            };
            if (isExitRow) seat.features.push("EXIT ROW — SAMPLE");
            if (seat.position === "window") seat.features.push("WINDOW POSITION");
            if (seat.position === "aisle") seat.features.push("AISLE POSITION");
            seat.status = sampleStatus(seed, seat, refresh);
            seats.push(seat);
            totalSeats++;
          });
        });
        rows.push({ rowNumber: rowNumber, isExitRow: isExitRow, seats: seats });
      }
      cabins.push({ name: cabin.name, code: cabin.code, rows: rows, features: cabin.features.slice() });
    });

    return {
      flightNumber: flightNumber,
      origin: origin,
      destination: destination,
      departureDate: departureDate,
      aircraftCode: aircraftCode,
      aircraftName: layout.name,
      icaoCode: layout.icaoCode,
      source: "SIMULATED SAMPLE DATA",
      refreshIndex: refresh,
      generatedAt: new Date().toISOString(),
      wingStartRow: layout.wingStartRow,
      wingEndRow: layout.wingEndRow,
      facilities: layout.facilities.slice(),
      cabins: cabins,
      totalSeats: totalSeats
    };
  }

  /** Flatten all cabins into a stable row-major seat array. */
  function flattenSeats(map) {
    var seats = [];
    (map && map.cabins || []).forEach(function (cabin) {
      cabin.rows.forEach(function (row) {
        row.seats.forEach(function (seat) { seats.push(seat); });
      });
    });
    return seats;
  }

  /** Count sample statuses, treating premium and exit seats as selectable. */
  function countStatuses(map) {
    var counts = { total: 0, available: 0, selectable: 0, occupied: 0, blocked: 0, premium: 0, extra_legroom: 0, exit_row: 0 };
    flattenSeats(map).forEach(function (seat) {
      counts.total++;
      if (Object.prototype.hasOwnProperty.call(counts, seat.status)) counts[seat.status]++;
      if (AVAILABLE_STATUSES.indexOf(seat.status) !== -1) counts.selectable++;
    });
    return counts;
  }

  /** Filter sample seats by status, cabin, and position without mutating the map. */
  function filterSeats(map, filters) {
    var options = filters || {};
    return flattenSeats(map).filter(function (seat) {
      if (options.availableOnly && AVAILABLE_STATUSES.indexOf(seat.status) === -1) return false;
      if (options.windowOnly && seat.position !== "window") return false;
      if (options.aisleOnly && seat.position !== "aisle") return false;
      if (options.exitOnly && !seat.isExitRow) return false;
      if (options.cabin && options.cabin !== "all" && seat.cabinCode !== options.cabin) return false;
      return true;
    });
  }

  /** Calculate consistent SVG coordinates for every seat and cabin label. */
  function calculateLayout(map) {
    var width = 720;
    var seatWidth = 30;
    var seatHeight = 25;
    var seatGap = 4;
    var aisleGap = 22;
    var rowStep = 32;
    var y = 58;
    var rows = [];
    var cabins = [];
    var seats = [];

    (map && map.cabins || []).forEach(function (cabin) {
      var cabinStart = y;
      y += 28;
      cabin.rows.forEach(function (row) {
        var sourceLayout = AIRCRAFT_LAYOUTS[map.aircraftCode].cabins.filter(function (item) { return item.code === cabin.code; })[0];
        var groups = sourceLayout.groups;
        var rowWidth = 0;
        groups.forEach(function (group, groupIndex) {
          rowWidth += group.length * seatWidth + Math.max(0, group.length - 1) * seatGap;
          if (groupIndex < groups.length - 1) rowWidth += aisleGap;
        });
        var x = (width - rowWidth) / 2;
        var rowY = y;
        var rowSeats = [];
        groups.forEach(function (group, groupIndex) {
          group.forEach(function (letter, seatIndex) {
            var seat = row.seats.filter(function (candidate) { return candidate.letter === letter; })[0];
            var placed = {
              seat: seat,
              x: x,
              y: rowY,
              width: seatWidth,
              height: seatHeight,
              groupIndex: groupIndex,
              seatIndex: seatIndex
            };
            rowSeats.push(placed);
            seats.push(placed);
            x += seatWidth + seatGap;
          });
          if (groupIndex < groups.length - 1) x += aisleGap - seatGap;
        });
        rows.push({ rowNumber: row.rowNumber, y: rowY, x: (width - rowWidth) / 2, width: rowWidth, isExitRow: row.isExitRow, seats: rowSeats, cabin: cabin.name });
        y += rowStep;
      });
      cabins.push({ name: cabin.name, code: cabin.code, y: cabinStart + 5, startY: cabinStart, endY: y - rowStep });
      y += 20;
    });

    return {
      width: width,
      height: y + 28,
      seatWidth: seatWidth,
      seatHeight: seatHeight,
      rows: rows,
      cabins: cabins,
      seats: seats,
      wingStart: rows.filter(function (row) { return row.rowNumber === map.wingStartRow; })[0] || null,
      wingEnd: rows.filter(function (row) { return row.rowNumber === map.wingEndRow; })[0] || null
    };
  }

  /** Return a short human-readable status label. */
  function statusLabel(status) {
    return STATUS_LABELS[status] || "Unknown";
  }

  /** Create a plain-text map suitable for clipboard export. */
  function exportAscii(map) {
    var symbols = { available: "○", occupied: "●", blocked: "×", premium: "◇", extra_legroom: "⬡", exit_row: "△" };
    var lines = ["SEAT MAP DEMO — SIMULATED DATA", map.flightNumber + " " + map.origin + "-" + map.destination + " | " + map.departureDate + " | " + map.aircraftName, ""];
    map.cabins.forEach(function (cabin) {
      lines.push("[ " + cabin.name.toUpperCase() + " ]");
      cabin.rows.forEach(function (row) {
        var cells = row.seats.map(function (seat) { return seat.letter + symbols[seat.status]; });
        lines.push(String(row.rowNumber).padStart(2, "0") + "  " + cells.join(" ") + (row.isExitRow ? "  EXIT ROW" : ""));
      });
      lines.push("");
    });
    lines.push("○ available  ● occupied  × unavailable  ◇ premium  ⬡ extra legroom  △ exit row");
    lines.push("Sample statuses only; no airline inventory or booking is connected.");
    return lines.join("\n");
  }

  /** Export all sample seats as RFC-style escaped CSV rows. */
  function exportCsv(map) {
    function quote(value) { return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"'; }
    var rows = [["flight", "origin", "destination", "date", "aircraft", "seat", "cabin", "position", "status", "pitch_in", "width_in", "sample_data"]];
    flattenSeats(map).forEach(function (seat) {
      rows.push([map.flightNumber, map.origin, map.destination, map.departureDate, map.aircraftName, seat.id, seat.cabin, seat.position, statusLabel(seat.status), seat.pitchInches, seat.widthInches, "simulated"]);
    });
    return rows.map(function (row) { return row.map(quote).join(","); }).join("\r\n");
  }

  /** Build a short text status summary for copy/export. */
  function exportSummary(map) {
    var counts = countStatuses(map);
    return [
      "SPICYTERMINAL SEAT MAP — DEMO SUMMARY",
      "Flight: " + map.flightNumber + "  " + map.origin + " → " + map.destination,
      "Date: " + map.departureDate,
      "Aircraft: " + map.aircraftName + " (" + map.aircraftCode + ")",
      "Seats in sample layout: " + counts.total,
      "Sample selectable: " + counts.selectable + " · occupied: " + counts.occupied + " · unavailable: " + counts.blocked,
      "Data source: SIMULATED SAMPLE DATA — not live airline inventory.",
      "No seat was reserved or booked."
    ].join("\n");
  }

  /** Convert untrusted text to safe HTML for the few generated SVG/details nodes. */
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  /** Check whether a status belongs in the sample available-seat count. */
  function isSelectableStatus(status) {
    return AVAILABLE_STATUSES.indexOf(status) !== -1;
  }

  var API = {
    AIRCRAFT_LAYOUTS: AIRCRAFT_LAYOUTS,
    AVAILABLE_STATUSES: AVAILABLE_STATUSES.slice(),
    normalizeFlightNumber: normalizeFlightNumber,
    normalizeAirport: normalizeAirport,
    normalizeDate: normalizeDate,
    createDemoSeatMap: createDemoSeatMap,
    flattenSeats: flattenSeats,
    countStatuses: countStatuses,
    filterSeats: filterSeats,
    calculateLayout: calculateLayout,
    statusLabel: statusLabel,
    exportAscii: exportAscii,
    exportCsv: exportCsv,
    exportSummary: exportSummary,
    isSelectableStatus: isSelectableStatus
  };

  if (typeof module === "object" && module && module.exports) module.exports = API;
  if (!root) return;
  root.SpicySeatMap = API;

  /** Escape markup values used in the generated, static seat-map UI. */
  function escapeUi(value) {
    return escapeHtml(value);
  }

  /** Create the SVG plane, cabin labels, row numbers, exits, and seat buttons. */
  function renderSvg(state, svg) {
    var geometry = state.geometry;
    var width = geometry.width;
    var height = geometry.height;
    var markup = [];
    var availableSet = {};
    filterSeats(state.map, state.filters).forEach(function (seat) { availableSet[seat.id] = true; });
    var center = width / 2;
    var fuselageLeft = 118;
    var fuselageRight = width - fuselageLeft;
    var top = 18;
    var bottom = height - 10;

    markup.push('<title>Interactive simulated seat map for ' + escapeUi(state.map.flightNumber) + '</title>');
    markup.push('<g id="seatmapPlane" transform="translate(' + state.panX.toFixed(1) + ' ' + state.panY.toFixed(1) + ') scale(' + state.zoom.toFixed(2) + ')">');
    if (geometry.wingStart && geometry.wingEnd) {
      var wingTop = geometry.wingStart.y + 8;
      var wingBottom = geometry.wingEnd.y + 26;
      markup.push('<path class="seatmap-wing" d="M ' + (center - 16) + ' ' + (wingTop - 22) + ' L ' + (fuselageLeft - 62) + ' ' + (wingTop + 78) + ' L ' + (fuselageLeft - 45) + ' ' + (wingBottom + 42) + ' L ' + (center - 22) + ' ' + (wingBottom + 4) + ' L ' + center + ' ' + (wingBottom + 22) + ' L ' + (center + 22) + ' ' + (wingBottom + 4) + ' L ' + (fuselageRight + 45) + ' ' + (wingBottom + 42) + ' L ' + (fuselageRight + 62) + ' ' + (wingTop + 78) + ' L ' + (center + 16) + ' ' + (wingTop - 22) + ' Z"/>');
    }
    markup.push('<path class="seatmap-fuselage" d="M ' + center + ' ' + top + ' C ' + (center - 74) + ' ' + top + ' ' + fuselageLeft + ' ' + (top + 44) + ' ' + fuselageLeft + ' ' + (top + 104) + ' L ' + fuselageLeft + ' ' + (bottom - 96) + ' C ' + fuselageLeft + ' ' + (bottom - 35) + ' ' + (center - 62) + ' ' + bottom + ' ' + center + ' ' + bottom + ' C ' + (center + 62) + ' ' + bottom + ' ' + fuselageRight + ' ' + (bottom - 35) + ' ' + fuselageRight + ' ' + (bottom - 96) + ' L ' + fuselageRight + ' ' + (top + 104) + ' C ' + fuselageRight + ' ' + (top + 44) + ' ' + (center + 74) + ' ' + top + ' ' + center + ' ' + top + ' Z"/>');
    markup.push('<path class="seatmap-centerline" d="M ' + center + ' ' + (top + 34) + ' L ' + center + ' ' + (bottom - 28) + '"/>');
    markup.push('<text class="seatmap-facility" x="' + center + '" y="' + (top + 25) + '" text-anchor="middle">FRONT · GALLEY / LAVATORY</text>');
    markup.push('<text class="seatmap-facility" x="' + center + '" y="' + (bottom - 12) + '" text-anchor="middle">REAR · LAVATORY</text>');

    geometry.cabins.forEach(function (cabin) {
      markup.push('<text class="seatmap-cabin-label" x="' + center + '" y="' + cabin.y + '" text-anchor="middle">' + escapeUi(cabin.name.toUpperCase()) + '</text>');
    });
    geometry.rows.forEach(function (row) {
      var leftX = row.x - 14;
      var rightX = row.x + row.width + 14;
      markup.push('<text class="seatmap-row-label" x="' + leftX + '" y="' + (row.y + 17) + '" text-anchor="end">' + row.rowNumber + '</text>');
      markup.push('<text class="seatmap-row-label" x="' + rightX + '" y="' + (row.y + 17) + '" text-anchor="start">' + row.rowNumber + '</text>');
      if (row.isExitRow) {
        markup.push('<text class="seatmap-exit-label" x="' + (row.x + row.width / 2) + '" y="' + (row.y - 3) + '" text-anchor="middle">EXIT ROW · SAMPLE</text>');
      }
    });

    geometry.seats.forEach(function (placed) {
      var seat = placed.seat;
      var isShownByFilter = !!availableSet[seat.id];
      var isSelected = state.selectedSeatId === seat.id;
      var isDemoChoice = state.demoSeatId === seat.id;
      var label = "Seat " + seat.id + ", " + statusLabel(seat.status) + ", " + seat.cabin + ", " + seat.position;
      var className = "seatmap-seat status-" + seat.status + (isSelected ? " is-selected" : "") + (isDemoChoice ? " is-demo-choice" : "") + (isShownByFilter ? "" : " is-filtered-out");
      markup.push('<g class="' + className + '" data-seat-id="' + escapeUi(seat.id) + '" tabindex="0" role="button" aria-label="' + escapeUi(label) + '">');
      markup.push('<rect class="seatmap-seat-box" x="' + placed.x + '" y="' + placed.y + '" width="' + placed.width + '" height="' + placed.height + '" rx="1"/>');
      markup.push('<text class="seatmap-seat-letter" x="' + (placed.x + placed.width / 2) + '" y="' + (placed.y + 17) + '" text-anchor="middle">' + escapeUi(seat.letter) + '</text>');
      if (seat.isExitRow) markup.push('<path class="seatmap-seat-mark" d="M ' + (placed.x + 4) + ' ' + (placed.y + 4) + ' l 4 4 -4 4"/>');
      markup.push('</g>');
    });
    markup.push('</g>');
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("aria-label", "Interactive simulated seat map for " + state.map.flightNumber + ", " + state.map.aircraftName);
    svg.innerHTML = markup.join("");
  }

  /** Fill the selected-seat details panel using text-safe DOM updates. */
  function renderDetails(doc, state) {
    var panel = doc.getElementById("seatmapSeatDetails");
    var action = doc.getElementById("seatmapDemoSelect");
    if (!panel || !action) return;
    var seat = state.selectedSeatId ? state.seatsById[state.selectedSeatId] : null;
    if (!seat) {
      panel.innerHTML = '<p class="seatmap-empty-detail">Choose a seat to inspect its sample status and layout features.</p>';
      action.disabled = true;
      action.textContent = "SELECT A SAMPLE SEAT";
      return;
    }
    var features = seat.features.slice();
    var status = statusLabel(seat.status);
    panel.innerHTML = '<div class="seatmap-detail-name">' + escapeUi(seat.id) + '</div>' +
      '<div class="seatmap-detail-status status-text-' + escapeUi(seat.status) + '">' + escapeUi(status.toUpperCase()) + ' · SIMULATED</div>' +
      '<dl class="seatmap-detail-list">' +
      '<div><dt>CABIN</dt><dd>' + escapeUi(seat.cabin) + '</dd></div>' +
      '<div><dt>POSITION</dt><dd>' + escapeUi(seat.position) + '</dd></div>' +
      '<div><dt>PITCH</dt><dd>' + escapeUi(seat.pitchInches) + ' in · sample</dd></div>' +
      '<div><dt>WIDTH</dt><dd>' + escapeUi(seat.widthInches) + ' in · sample</dd></div>' +
      '<div><dt>FEATURES</dt><dd>' + escapeUi(features.join(" · ")) + '</dd></div>' +
      '<div><dt>PRICE</dt><dd>Not connected in demo</dd></div>' +
      '</dl>';
    action.disabled = !isSelectableStatus(seat.status);
    if (!isSelectableStatus(seat.status)) {
      action.textContent = "SAMPLE SEAT NOT AVAILABLE";
    } else if (state.demoSeatId === seat.id) {
      action.textContent = "REMOVE DEMO SELECTION";
    } else {
      action.textContent = "ADD TO DEMO SELECTION";
    }
  }

  /** Render the simulated availability totals and source labels. */
  function renderStats(doc, state) {
    var counts = countStatuses(state.map);
    var count = doc.getElementById("seatmapAvailableCount");
    var total = doc.getElementById("seatmapTotalCount");
    var selection = doc.getElementById("seatmapSelectionStatus");
    var update = doc.getElementById("seatmapLastUpdated");
    if (count) count.textContent = String(counts.selectable);
    if (total) total.textContent = String(counts.total);
    if (selection) selection.textContent = state.demoSeatId
      ? "DEMO SELECTION: " + state.demoSeatId + " — NO RESERVATION MADE"
      : "NO SEAT SELECTED";
    if (update) update.textContent = "SIMULATED UPDATE " + new Date(state.map.generatedAt).toLocaleTimeString();
    var statusCounts = doc.getElementById("seatmapStatusCounts");
    if (statusCounts) {
      statusCounts.textContent = "SELECTABLE " + counts.selectable + " · OCCUPIED " + counts.occupied + " · UNAVAILABLE " + counts.blocked;
    }
  }

  /** Update the countdown until the next local-only sample refresh. */
  function updateCountdown(doc, state) {
    var element = doc.getElementById("seatmapRefreshCountdown");
    if (!element || !state.nextRefreshAt) return;
    var seconds = Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
    var mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    var ss = String(seconds % 60).padStart(2, "0");
    element.textContent = "NEXT SIMULATED UPDATE 00:" + mm + ":" + ss;
  }

  /** Render seat SVG, details, and status counters in a single update. */
  function renderViewer(doc, state) {
    if (!state.map) return;
    state.seatsById = {};
    flattenSeats(state.map).forEach(function (seat) { state.seatsById[seat.id] = seat; });
    state.geometry = calculateLayout(state.map);
    var flightName = doc.getElementById("seatmapFlightName");
    var flightMeta = doc.getElementById("seatmapFlightMeta");
    if (flightName) flightName.textContent = state.map.flightNumber + " · " + state.map.origin + " → " + state.map.destination;
    if (flightMeta) flightMeta.textContent = state.map.departureDate + " · " + state.map.aircraftName + " (" + state.map.aircraftCode + ") · " + state.map.totalSeats + " seats in static sample layout";
    var svg = doc.getElementById("seatmapSvg");
    if (svg) renderSvg(state, svg);
    var zoomLabel = doc.getElementById("seatmapZoomValue");
    if (zoomLabel) zoomLabel.textContent = Math.round(state.zoom * 100) + "%";
    renderDetails(doc, state);
    renderStats(doc, state);
    updateCountdown(doc, state);
  }

  /** Generate the next deterministic demo refresh and preserve the inspected seat. */
  function refreshSample(doc, state) {
    if (!state.currentInput) return;
    state.refreshTick++;
    state.map = createDemoSeatMap(state.currentInput, state.refreshTick);
    if (state.demoSeatId) {
      var updatedChoice = flattenSeats(state.map).filter(function (seat) { return seat.id === state.demoSeatId; })[0];
      if (!updatedChoice || !isSelectableStatus(updatedChoice.status)) state.demoSeatId = null;
    }
    state.nextRefreshAt = Date.now() + 30000;
    renderViewer(doc, state);
    var live = doc.getElementById("seatmapRefreshStatus");
    if (live) live.textContent = "SIMULATED SAMPLE REFRESH " + new Date(state.map.generatedAt).toLocaleTimeString() + " — NO AIRLINE DATA REQUESTED";
  }

  /** Set accessible status text without inserting any user-provided markup. */
  function setNotice(doc, message, isError) {
    var status = doc.getElementById("seatmapFormStatus");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", !!isError);
  }

  /** Download text locally using a short-lived object URL. */
  function downloadText(text, fileName, type) {
    if (!root.Blob || !root.URL || !root.URL.createObjectURL) return false;
    var blob = new root.Blob([text], { type: type || "text/plain;charset=utf-8" });
    var url = root.URL.createObjectURL(blob);
    var anchor = root.document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.hidden = true;
    root.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    root.URL.revokeObjectURL(url);
    return true;
  }

  /** Copy demo text with Clipboard API and a browser fallback. */
  function copyText(text) {
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      return root.navigator.clipboard.writeText(text);
    }
    var textarea = root.document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    root.document.body.appendChild(textarea);
    textarea.select();
    var copied = false;
    try { copied = root.document.execCommand("copy"); } catch (error) { copied = false; }
    textarea.remove();
    return copied ? Promise.resolve() : Promise.reject(new Error("Clipboard access is unavailable."));
  }

  /** Bind the /seatmap preview page and all of its local demo interactions. */
  function initializeSeatMapPage(doc) {
    if (!root.location || root.location.pathname.replace(/\/+$/, "") !== "/seatmap") return;
    var page = doc.getElementById("seatmapPage");
    if (!page) return;
    doc.body.classList.add("seatmap-active");
    page.classList.remove("hidden");

    var notice = doc.getElementById("seatmapNotice");
    var content = doc.getElementById("seatmapContent");
    var continueButton = doc.getElementById("seatmapNoticeContinue");
    var form = doc.getElementById("seatmapForm");
    var demo = doc.getElementById("seatmapDemo");
    var searchButton = doc.getElementById("seatmapSearchButton");
    var state = {
      map: null,
      currentInput: null,
      refreshTick: 0,
      nextRefreshAt: 0,
      timer: null,
      selectedSeatId: null,
      demoSeatId: null,
      seatsById: {},
      geometry: null,
      filters: { availableOnly: false, windowOnly: false, aisleOnly: false, exitOnly: false, cabin: "all" },
      zoom: 1,
      panX: 0,
      panY: 0,
      pointers: new Map(),
      drag: null
    };

    function closeNotice() {
      if (!notice) return;
      notice.classList.add("hidden");
      if (content) {
        content.removeAttribute("aria-hidden");
        if ("inert" in content) content.inert = false;
      }
      if (form) {
        var firstInput = doc.getElementById("seatmapFlightNumber");
        if (firstInput) firstInput.focus();
      }
    }

    if (notice) {
      notice.classList.remove("hidden");
      if (content) {
        content.setAttribute("aria-hidden", "true");
        if ("inert" in content) content.inert = true;
      }
      if (continueButton) continueButton.focus();
    }
    if (continueButton) continueButton.addEventListener("click", closeNotice);
    if (notice) {
      notice.addEventListener("click", function (event) {
        if (event.target === notice) closeNotice();
      });
    }
    doc.addEventListener("keydown", function (event) {
      if (!notice || notice.classList.contains("hidden")) return;
      if (event.key === "Escape") {
        closeNotice();
        return;
      }
      if (event.key !== "Tab") return;
      var focusable = notice.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && (doc.activeElement === first || !notice.contains(doc.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (doc.activeElement === last || !notice.contains(doc.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    });

    var dateInput = doc.getElementById("seatmapDate");
    if (dateInput && !dateInput.value) {
      var tomorrow = new Date(Date.now() + 86400000);
      dateInput.value = tomorrow.toISOString().slice(0, 10);
    }

    var quickButtons = doc.querySelectorAll("[data-seatmap-example]");
    Array.prototype.forEach.call(quickButtons, function (button) {
      button.addEventListener("click", function () {
        var flight = doc.getElementById("seatmapFlightNumber");
        var origin = doc.getElementById("seatmapOrigin");
        var destination = doc.getElementById("seatmapDestination");
        var aircraft = doc.getElementById("seatmapAircraft");
        if (flight) flight.value = button.getAttribute("data-flight");
        if (origin) origin.value = button.getAttribute("data-origin");
        if (destination) destination.value = button.getAttribute("data-destination");
        if (aircraft) aircraft.value = button.getAttribute("data-aircraft");
        setNotice(doc, "SAMPLE FLIGHT DETAILS FILLED — STILL SIMULATED DATA", false);
      });
    });

    if (form) form.addEventListener("submit", function (event) {
      event.preventDefault();
      var input;
      try {
        input = {
          flightNumber: doc.getElementById("seatmapFlightNumber").value,
          origin: doc.getElementById("seatmapOrigin").value,
          destination: doc.getElementById("seatmapDestination").value,
          date: doc.getElementById("seatmapDate").value,
          aircraftCode: doc.getElementById("seatmapAircraft").value
        };
        input.flightNumber = normalizeFlightNumber(input.flightNumber);
        input.origin = normalizeAirport(input.origin, "Origin");
        input.destination = normalizeAirport(input.destination, "Destination");
        input.date = normalizeDate(input.date);
        if (!AIRCRAFT_LAYOUTS[input.aircraftCode]) throw new TypeError("Choose a sample aircraft layout.");
      } catch (error) {
        setNotice(doc, error.message, true);
        return;
      }
      state.currentInput = input;
      state.refreshTick = 0;
      state.demoSeatId = null;
      state.selectedSeatId = null;
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      state.map = createDemoSeatMap(input, state.refreshTick);
      if (demo) demo.classList.remove("hidden");
      if (searchButton) searchButton.textContent = "UPDATE SAMPLE MAP";
      setNotice(doc, "SAMPLE MAP GENERATED LOCALLY — NO AIRLINE INVENTORY REQUESTED", false);
      renderViewer(doc, state);
      if (demo) demo.scrollIntoView({ behavior: "smooth", block: "start" });
      if (state.timer) root.clearInterval(state.timer);
      state.nextRefreshAt = Date.now() + 30000;
      state.timer = root.setInterval(function () {
        if (Date.now() >= state.nextRefreshAt) refreshSample(doc, state);
        else updateCountdown(doc, state);
      }, 1000);
    });

    var canvas = doc.getElementById("seatmapCanvas");
    var svg = doc.getElementById("seatmapSvg");
    function updateTransform() {
      var plane = doc.getElementById("seatmapPlane");
      if (plane) plane.setAttribute("transform", "translate(" + state.panX.toFixed(1) + " " + state.panY.toFixed(1) + ") scale(" + state.zoom.toFixed(2) + ")");
    }
    function setZoom(next) {
      state.zoom = Math.max(0.55, Math.min(2.3, next));
      updateTransform();
      var label = doc.getElementById("seatmapZoomValue");
      if (label) label.textContent = Math.round(state.zoom * 100) + "%";
    }
    function filteredRender() {
      renderViewer(doc, state);
      updateTransform();
    }

    var zoomIn = doc.getElementById("seatmapZoomIn");
    var zoomOut = doc.getElementById("seatmapZoomOut");
    var zoomReset = doc.getElementById("seatmapZoomReset");
    if (zoomIn) zoomIn.addEventListener("click", function () { setZoom(state.zoom + 0.15); });
    if (zoomOut) zoomOut.addEventListener("click", function () { setZoom(state.zoom - 0.15); });
    if (zoomReset) zoomReset.addEventListener("click", function () { state.panX = 0; state.panY = 0; setZoom(1); });

    ["availableOnly", "windowOnly", "aisleOnly", "exitOnly"].forEach(function (filterName) {
      var control = doc.getElementById("seatmapFilter" + filterName.charAt(0).toUpperCase() + filterName.slice(1));
      if (control) control.addEventListener("change", function () {
        state.filters[filterName] = control.checked;
        filteredRender();
      });
    });
    var cabinFilter = doc.getElementById("seatmapFilterCabin");
    if (cabinFilter) cabinFilter.addEventListener("change", function () {
      state.filters.cabin = cabinFilter.value;
      filteredRender();
    });

    if (svg) {
      function findSeat(target) { return target && target.closest ? target.closest("[data-seat-id]") : null; }
      function chooseSeat(seatId) {
        if (!state.seatsById[seatId]) return;
        state.selectedSeatId = seatId;
        filteredRender();
      }
      svg.addEventListener("click", function (event) {
        var seatElement = findSeat(event.target);
        if (seatElement) chooseSeat(seatElement.getAttribute("data-seat-id"));
      });
      svg.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        var seatElement = findSeat(event.target);
        if (seatElement) {
          event.preventDefault();
          chooseSeat(seatElement.getAttribute("data-seat-id"));
        }
      });
      svg.addEventListener("pointerdown", function (event) {
        if (event.button !== 0 && event.pointerType === "mouse") return;
        var seatElement = findSeat(event.target);
        if (seatElement && state.pointers.size === 0) return;
        state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (svg.setPointerCapture) svg.setPointerCapture(event.pointerId);
        if (state.pointers.size === 1) {
          state.drag = { startX: event.clientX, startY: event.clientY, panX: state.panX, panY: state.panY, scale: state.zoom };
        } else if (state.pointers.size === 2) {
          var points = Array.from(state.pointers.values());
          state.drag = { pinchDistance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), scale: state.zoom, panX: state.panX, panY: state.panY };
        }
      });
      svg.addEventListener("pointermove", function (event) {
        if (state.pointers.has(event.pointerId)) {
          state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (state.pointers.size === 1 && state.drag && state.drag.startX != null) {
            var rect = svg.getBoundingClientRect();
            var unit = rect.width ? geometryUnit(state, rect.width) : 1;
            state.panX = state.drag.panX + (event.clientX - state.drag.startX) * unit;
            state.panY = state.drag.panY + (event.clientY - state.drag.startY) * unit;
            updateTransform();
          } else if (state.pointers.size === 2 && state.drag && state.drag.pinchDistance) {
            var points = Array.from(state.pointers.values());
            var distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            setZoom(state.drag.scale * (distance / state.drag.pinchDistance));
          }
        }
        var seatElement = findSeat(event.target);
        var tooltip = doc.getElementById("seatmapTooltip");
        if (seatElement && tooltip && state.seatsById[seatElement.getAttribute("data-seat-id")]) {
          var seat = state.seatsById[seatElement.getAttribute("data-seat-id")];
          tooltip.textContent = seat.id + " · " + statusLabel(seat.status).toUpperCase() + " · " + seat.cabin.toUpperCase();
          tooltip.classList.remove("hidden");
          var box = canvas.getBoundingClientRect();
          tooltip.style.left = Math.max(8, event.clientX - box.left + 12) + "px";
          tooltip.style.top = Math.max(8, event.clientY - box.top + 12) + "px";
        } else if (tooltip) {
          tooltip.classList.add("hidden");
        }
      });
      function pointerEnd(event) {
        state.pointers.delete(event.pointerId);
        if (state.pointers.size === 1) {
          var point = Array.from(state.pointers.values())[0];
          state.drag = { startX: point.x, startY: point.y, panX: state.panX, panY: state.panY, scale: state.zoom };
        } else if (state.pointers.size === 0) state.drag = null;
      }
      svg.addEventListener("pointerup", pointerEnd);
      svg.addEventListener("pointercancel", pointerEnd);
      svg.addEventListener("pointerleave", function () {
        var tooltip = doc.getElementById("seatmapTooltip");
        if (tooltip) tooltip.classList.add("hidden");
      });
    }

    function geometryUnit(currentState, renderedWidth) {
      return currentState.geometry && renderedWidth ? currentState.geometry.width / renderedWidth : 1;
    }

    var action = doc.getElementById("seatmapDemoSelect");
    if (action) action.addEventListener("click", function () {
      var seat = state.seatsById[state.selectedSeatId];
      if (!seat || !isSelectableStatus(seat.status)) return;
      state.demoSeatId = state.demoSeatId === seat.id ? null : seat.id;
      renderViewer(doc, state);
      updateTransform();
      var message = doc.getElementById("seatmapSelectionStatus");
      if (message) message.textContent = state.demoSeatId
        ? "DEMO SELECTION: " + state.demoSeatId + " — NO RESERVATION MADE"
        : "NO SEAT SELECTED";
    });

    var refreshButton = doc.getElementById("seatmapRefreshNow");
    if (refreshButton) refreshButton.addEventListener("click", function () { refreshSample(doc, state); });

    var exportAsciiButton = doc.getElementById("seatmapCopyAscii");
    if (exportAsciiButton) exportAsciiButton.addEventListener("click", function () {
      if (!state.map) return;
      copyText(exportAscii(state.map)).then(function () { setNotice(doc, "SAMPLE MAP COPIED — SIMULATED DATA", false); }, function () { setNotice(doc, "Clipboard unavailable; use an export button instead.", true); });
    });
    var exportJsonButton = doc.getElementById("seatmapDownloadJson");
    if (exportJsonButton) exportJsonButton.addEventListener("click", function () {
      if (state.map) downloadText(JSON.stringify(state.map, null, 2), "seatmap-demo.json", "application/json;charset=utf-8");
    });
    var exportCsvButton = doc.getElementById("seatmapDownloadCsv");
    if (exportCsvButton) exportCsvButton.addEventListener("click", function () {
      if (state.map) downloadText(exportCsv(state.map), "seatmap-demo.csv", "text/csv;charset=utf-8");
    });

    var summary = doc.getElementById("seatmapSummaryDialog");
    var summaryText = doc.getElementById("seatmapSummaryText");
    var summaryButton = doc.getElementById("seatmapShowSummary");
    var summaryClose = doc.getElementById("seatmapSummaryClose");
    function closeSummary() {
      if (summary) summary.classList.add("hidden");
      if (content) {
        content.removeAttribute("aria-hidden");
        if ("inert" in content) content.inert = false;
      }
      if (summaryButton) summaryButton.focus();
    }
    if (summaryButton) summaryButton.addEventListener("click", function () {
      if (!state.map || !summary || !summaryText) return;
      summaryText.textContent = exportSummary(state.map);
      if (content) {
        content.setAttribute("aria-hidden", "true");
        if ("inert" in content) content.inert = true;
      }
      summary.classList.remove("hidden");
      if (summaryClose) summaryClose.focus();
    });
    if (summaryClose) summaryClose.addEventListener("click", closeSummary);
    if (summary) {
      summary.addEventListener("click", function (event) {
        if (event.target === summary) closeSummary();
      });
      doc.addEventListener("keydown", function (event) {
        if (summary.classList.contains("hidden")) return;
        if (event.key === "Escape") {
          closeSummary();
          return;
        }
        if (event.key !== "Tab") return;
        var focusable = summary.querySelectorAll('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && (doc.activeElement === first || !summary.contains(doc.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (doc.activeElement === last || !summary.contains(doc.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      });
    }

    var backLink = doc.getElementById("seatmapBackLink");
    if (backLink) backLink.addEventListener("click", function () {
      if (state.timer) root.clearInterval(state.timer);
    });
  }

  if (root.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", function () { initializeSeatMapPage(root.document); }, { once: true });
    } else {
      initializeSeatMapPage(root.document);
    }
  }
})(typeof window !== "undefined" ? window : null);
