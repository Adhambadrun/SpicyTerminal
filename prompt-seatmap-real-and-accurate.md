# PROMPT — Make the SpicyTerminal Seat Map real and accurate for the flight just generated

Copy everything below the line into the next chat, then attach/link the `Adhambadrun/SpicyTerminal` repo.

---

## TASK

Turn the in-development `/seatmap` preview into a **real, accurate seat map for the flight the user just converted** — not a demo that ignores the itinerary. The converter already knows airline, flight number, route, date, cabin, booking class and IATA aircraft type for every segment. The seat map must be driven by *that* data, show the *actual* cabin layout of that aircraft on that airline, and never pretend to know anything it does not know.

Work in the existing repo. Read the code before proposing anything. Do not introduce frameworks, bundlers, or build steps — this app is a hand-written, dependency-light, single-file static artifact and must stay that way.

## REPO CONTEXT (verified — do not waste turns re-deriving it)

- `spicy_engine.js` — deterministic conversion engine. Per segment it produces `airline`, `flight_no`, `orig`, `dest`, `date_ddmmm`, `dep_time`, `arr_time`, `booking_class`, `cabin`, `aircraft` (IATA type code, or `"???"`), `flight_time`, `miles`, `warnings[]`.
- Equipment resolution already exists: `inferAircraft(airline, flightNo, orig, dest, distanceMi) → [code, source]` where `source ∈ {"flight table", "route database", "route estimate"}`; user-supplied equipment from the pasted GDS/screenshot wins over inference. `rangeAdvisory()` produces "range check" warnings.
- `spicy_data.js` holds `aircraftTypes[code] = [icaoCode, name, family, manufacturer, category, rangeNm]` (79 types), plus `airlineEquipment`, `routeEquipment`, `flightEquipment`, `genericEquipment`.
- `seatmap.js` — current preview. Three hardcoded layouts in `AIRCRAFT_LAYOUTS` (`738`, `320`, `77W`), `createDemoSeatMap(input, refreshIndex)` validates a **hand-typed** flight (`AS100 / SEA / LAX / date / aircraft`), and `sampleStatus(seed, seat, refreshIndex)` fabricates every seat status from an FNV-1a hash. Exports via `root.SpicySeatMap` + CommonJS. `AIRCRAFT_LAYOUTS`, `AVAILABLE_STATUSES`, `createDemoSeatMap`, `flattenSeats`, `countStatuses`, `filterSeats`, `calculateLayout`, `exportAscii`, `exportCsv`, `exportSummary` are the public API surface (tests depend on them).
- `index_template.html` — the `#seatmapPage` block, `#seatmapForm`, `#seatmapAircraft` (3 options), `#seatmapNotice` "IN DEVELOPMENT" dialog, disclosure copy ("SIMULATED REFRESH…", "SAMPLE STATUS KEY", "SIMULATED / NOT LIVE" pill).
- `app.js` — main UI. `wireSeatMapGate()` + `seatmapGate()`: the dimmed Seat Map link only navigates after ten consecutive clicks. The BOOKING LINK path (`spicy_links.js`) is the existing model for "read the converted segments and hand off", and `bookingLinkDateYmd` / the `read`-sourced segment array is the pattern to imitate.
- `build_web.py` inlines `spicy_data.js`, `spicy_engine.js`, `spicy_links.js`, `app.js`, `seatmap.css`, `seatmap.js` into `index.html`, `app.html` (committed) and `public/{index,app,seatmap}.html` (git-ignored). **Never hand-edit `index.html`/`app.html`; edit sources and run `npm run build`.**
- Routes: `/seatmap` → `seatmap.html` via `vercel.json` rewrites, `netlify.toml` redirect, and `preview_server.py`. Deploy targets are Vercel + Netlify (serverless functions are available on both), but Netlify-Drop deploys ship static files only — the page must work with zero backend.
- Tests: `npm test` runs everything; `test_seatmap.js` (layout counts 738=198 / 320=186 / 77W=523, determinism, simulated-refresh, disclosure markup, `/seatmap` route, built-page inlining) and `test_seatmap_gate.js` (the ten-click gate) both read `public/` output, so **`npm run build` must run before `npm test`**.

## THE THREE FACTS — keep them strictly separate in code, data, and UI

"Real and accurate" is three independent questions. Answering one never implies the others.

| Axis | Question | Real source | Achievable offline? |
|---|---|---|---|
| **A. Equipment** | Which aircraft actually operates this flight on this date? | Airline schedule/booking data; a flight-status provider (FlightAware AeroAPI, AeroDataBox, Aviationstack) for a real, dated lookup | Partly — the itinerary's own equipment code when the user supplied one, else `inferAircraft()` (labelled inferred) |
| **B. Layout** | What cabin configuration does that airline's sub-fleet of that type have? | Airline's own published seat map / fleet page (primary), cross-checked against published seat counts and an independent curated source | **Yes** — a curated, versioned, source-cited layout registry |
| **C. Availability** | Which specific seats are free, blocked, or chargeable right now? | Real inventory only: GDS/NDC seat-availability (Amadeus SeatMap Display, Duffel `/air/seat_maps`, Travelport) — all of which need a live offer/PNR in that provider's system, i.e. enterprise credentials or a booking flow this app does not have | **No** — must be `UNAVAILABLE`/`SIMULATED` and labelled as such |

Consequence to accept up front: **this app converts pasted itineraries; it never books them.** No provider will return seat-level inventory for an arbitrary flight number the app did not shop in that provider. So the honest target is:

- **Axis B real** (verified layouts, tied to the itinerary's equipment) — this is the deliverable.
- **Axis A** real when the itinerary states it, inferred-and-disclosed when the engine guesses, unknown otherwise.
- **Axis C** simulated (clearly labelled), or live **only** when a real provider is configured server-side — plus a plain "check live seat map" outbound link to the airline's own site/manage-booking for anyone who needs the truth right now.

## HARD RULES (the repo's DNA — violating any of these fails the task)

1. **Never fabricate.** No invented layouts, rows, exit rows, seat counts, pitches, amenities, prices, or availability. An unknown layout renders as *unknown/generic*, explicitly labelled — exactly the way the engine already refuses `???` aircraft and discloses inferred equipment.
2. **Every layout entry carries provenance**: `sourceName`, `sourceUrl`, `verifiedOn` (ISO date), `confidence`. No entry without all four.
3. **Never claim currency you don't have.** "LIVE" may appear only when a provider response is displayed, with an `as of HH:MM:SSZ` timestamp and the provider named. Hash-generated statuses must never be presented as live.
4. **Never invent a fleet config from memory.** Each `(airline, IATA type)` entry is verified against a named primary source this session (the airline's own seat-map/fleet page). If you cannot verify it, ship it as `GENERIC` with the family-level layout and say so in the disclosure — do not fill the gap with a plausible guess.
5. **Secrets never reach the browser.** Any provider key lives in a serverless env var and is used only by `/api/seatmap`. No key in `index.html`, no key in `localStorage`, no key in a query string, no client-side provider calls.
6. **No scraping forbidden consumer sites** (ExpertFlyer, AwardFares, seat-maps sites, airline booking APIs used outside their terms). Verify *facts* against published pages; link out; never proxy someone else's product.
7. **Selecting a seat reserves nothing.** Keep that sentence true and visible.
8. **Offline-first, no regressions.** With no backend and no keys, the page must still fully render layouts and exports; `npm test` must stay green; the ten-click gate, the notice dialog, the exports, keyboard/a11y behaviour, and the "no animations / native scrollbars" invariants must survive.
9. **Small, boring, dependency-free JS** in the existing style (ES5-ish, IIFE, no build-time transforms), matching the surrounding code.

## WHAT TO BUILD

### 1. Itinerary → seat map handoff (the missing link)
- When a conversion produces segments, persist the segments for the seat map: `sessionStorage["spicy_seatmap_handoff"] = {createdAt, segments:[{airline, flightNo, orig, dest, dateISO, depTime, arrTime, cabin, bookingClass, equipment, equipmentSource, aircraftName, warnings[]}], source:"converted itinerary"}`. Same-origin, no network, no PII (drop any passenger data), and it must be cleared when the input is cleared, mirroring the existing "stale work cannot overwrite" discipline.
- Add a `SEAT MAP` action per converted segment (next to the existing per-row controls, or in the Booking Link row) that opens `/seatmap?seg=N` (or `#seg=N`) and restores that segment.
- On `/seatmap`, resolve input in this order: explicit URL segment → `sessionStorage` handoff → manual form. Show which one was used: `SOURCE: CONVERTED ITINERARY (leg 2 of 3)` vs `SOURCE: MANUAL ENTRY`.
- Multi-leg itineraries get a segment switcher (airline, flight no, route, date, equipment badge) that re-renders the whole map per leg.
- Keep the manual form and quick examples working (they are tested). The manual path stays labelled as sample/manual.

### 2. Layout registry — the thing that makes it accurate
New file `seatmap_layouts.js` (inlined by `build_web.py` like `spicy_data.js`), exporting `SpicySeatMapLayouts`:

```js
{
  version: "1",
  updatedOn: "YYYY-MM-DD",
  layouts: {
    // key: AIRLINE|IATATYPE|CONFIGCODE   (configCode disambiguates sub-fleets, e.g. "V1"/"V2"/"SH" )
    "AA|738|V1": {
      airline: "AA", iataType: "738", icaoType: "B738",
      aircraftName: "Boeing 737-800",
      configCode: "V1",
      configLabel: "737-800 · 172 seats (16 First / 156 Main)",
      seatCount: 172,
      confidence: "VERIFIED",            // VERIFIED | GENERIC | UNVERIFIED
      sourceName: "American Airlines — seat maps (aa.com)",
      sourceUrl: "https://…",
      verifiedOn: "YYYY-MM-DD",
      notes: "Any caveat a reader needs (e.g. two sub-fleets share this type).",
      decks: [{
        deck: 1,
        overwingExitRows: [16, 17],
        doors: [1, 12, 25],              // row boundaries where exits/lavs interrupt the cabin
        cabins: [{
          code: "first",                 // first | business | premium_economy | economy
          name: "First",
          fromRow: 1, toRow: 4,
          seatGroups: [["A","B"], ["E","F"]],   // real lettering, real aisles, per row
          rowExceptions: [{ fromRow: 2, toRow: 4, seatGroups: [["A","B"],["E","F"]] }], // if the airline's rows differ
          pitchIn: 37, widthIn: 21,
          features: [{ kind: "recline", label: "Reclines" }],
          extraLegroomRows: [],          // airline products: AA Main Cabin Extra, DL Comfort+/Preferred, UA Economy Plus
          blockedRows: [],
          chargeable: true
        }]
      }]
    }
  },
  // Fallback when no verified entry exists: a family-level, obviously-generic outline.
  generics: { /* narrowbody_3_3, widebody_3_3_3, widebody_2_4_2, regional_2_2 … */ }
}
```

- Resolution order: exact `AIRLINE|TYPE|CONFIG` → `AIRLINE|TYPE` (single verified entry) → **GENERIC family layout with a visible `GENERIC LAYOUT — not the airline's verified config` badge** → refuse with a readable message. Never silently fall back to a different airline's layout.
- Registry integrity rules (enforce with tests): row numbers contiguous per cabin; `seatGroups` letters unique per row; `seatCount` equals the sum of real seats across cabins; exit rows exist and lie inside the cabin row range; every entry has provenance fields; no duplicate keys; no layout with a cabin that is not one of the four names.
- Sub-fleet ambiguity: when two verified configs exist for the same `AIRLINE|TYPE` and nothing in the itinerary distinguishes them, either show a chooser ("This type flies in two configurations — which one?") or default to the one with a documented majority share **and** disclose it. State which choice you made.
- Accuracy scope for this pass: cover the aircraft the app actually generates. Build the registry so it grows: start with the top ~25 `(airline, type)` pairs from `airlineEquipment`/`routeEquipment`/`flightEquipment` plus the three existing demo types (738, 320, 77W), and include at least one widebody wide-aisle case (777/787/A380 if verifiable), one regional jet, and one type that the engine has no layout for — that last one must degrade to GENERIC, provably.

### 3. Driving the map from the itinerary
- Use the segment's **own** equipment, and carry the equipment provenance into the UI: `EQUIPMENT 77W — from your itinerary`, `EQUIPMENT 738 — inferred (route database)`, `EQUIPMENT ??? — unknown`.
- If the engine emitted a range-check warning for the segment, surface it on the seat map too (`data.warnings`).
- Map the segment's **cabin / booking class** to the cabin shown: the ticketed cabin is highlighted, other cabins are dimmed, and selecting a seat outside the ticketed cabin is refused with a plain reason ("Seat 3A is in First; this itinerary is ticketed in Economy"). When the cabin is unknown, show all cabins and say so — never guess the passenger's cabin.
- `booking_class` letter → cabin must reuse the engine's own resolution, not a new invented table.
- Ancillary/extra-legroom seats are airline products; display them only from the layout's `extraLegroomRows`/`blockedRows`/`chargeable` data, never inferred from seat position alone.

### 4. Availability: honest by construction
- Introduce an explicit availability source on every rendered map: `SIMULATED` (hash mode, current behaviour, still labelled), `PROVIDER` (live), or `UNAVAILABLE` (layout only, no statuses). The legend title, the pill, the footer timestamp and the disclaimer copy must all follow the active source — a live map must not inherit "SIMULATED" wording, and a simulated map must never say "LIVE".
- Keep the hash-based simulator, but rename/refactor it as one implementation of the provider interface, clearly marked. It stays the default with no backend.
- Optional live path (build it so it can be switched on later, and so the app still runs without it):
  - `/api/seatmap` serverless endpoint (Vercel + Netlify function) reading `SEATMAP_PROVIDER` + provider credentials from **env vars**, proxying a provider such as Amadeus SeatMap Display or Duffel `/air/seat_maps` (both are offer/PNR-scoped; document exactly what identifier they need and fail loudly and honestly when the app has none).
  - Client adapter: request dedupe, `AbortController` timeouts, min-refresh interval + TTL cache keyed by `(airline, flightNo, date, orig, dest)`, exponential backoff on 429, and a visible `as of` timestamp. On any failure: fall back to layout-only and say `LIVE SEAT DATA UNAVAILABLE — showing layout and disclosure only`. Never silently show simulated data as if it were live.
  - Detect a missing backend (404/405/HTML response) and stay in offline mode without an error storm.
- Always offer **"Check live seat map on <airline>"** as an outbound link to the airline's own seat-selection/manage-booking page for that flight when a URL pattern is known — honest, useful, no data claim. Build the URL from a small, tested per-airline table; skip the link when unknown.
- Update the "IN DEVELOPMENT" notice, the README bullets and the on-page disclaimers to describe the new reality precisely (what is verified, what is inferred, what is simulated, what is live-if-configured). No marketing language, no overclaiming.

### 5. UI changes (keep the existing visual language and the no-animation / no-transition rules)
- Segment switcher (one tab per leg) + source/provenance strip: airline · flight no · route · date · equipment + provenance · layout confidence badge · availability source badge.
- Legend and filters must reflect the active source (e.g. "extra legroom" only when the layout actually declares such rows).
- Keep every existing element id that tests assert on, or update the tests in the same commit.
- Accessibility: badges/tooltips need text equivalents, `aria-live` for status changes, seat buttons keep descriptive labels, and the notice dialog's focus trap keeps working.

## TEST PLAN (all of this lands in the same change)

- New `test_seatmap_layouts.js`: registry integrity rules above; provenance required; generic fallback works; refusal path works; every `extraLegroomRows`/`exitRows` value is inside a real cabin range; no duplicate seat ids across a layout; `seatCount` matches enumeration for every entry.
- Extend `test_seatmap.js`:
  - handoff: converted segments → `sessionStorage` → `/seatmap?seg=2` renders leg 2's airline/route/date/equipment;
  - provenance: itinerary-supplied equipment renders `from your itinerary`, inferred renders `inferred (<source>)`, `???` renders an explicit unknown state and never a fabricated layout;
  - cabin gating: a seat outside the ticketed cabin is refused with the stated reason; unknown cabin ≠ invented cabin;
  - honesty: simulated render never contains the word LIVE; provider render never contains SIMULATED; layout-only render says so;
  - determinism preserved: same input + same refresh index → identical statuses.
- Extend `test_seatmap_gate.js` only if the gate/markup changes — the ten-click behaviour is a product decision, keep it.
- Add a built-artifact check: `seatmap_layouts.js` is inlined into `index.html`/`public/seatmap.html`, no provider key string appears in any built page (grep the output), and `/seatmap` still resolves.
- Run `npm run build && npm test` and report the real output. Do not claim green without showing it.

## DO NOT BREAK
Frame-by-frame parity of the GDS output; `test_engine.js` goldens; route/accent/round-trip/multi-leg suites; booking-link gating and its 1–9 adult selector; the weekly report counters; the About dialog; no-animation and native-scrollbar invariants; `AI FIX` labelling; OCR pipeline tests; the offline/no-key guarantee; the ten-click seat-map gate; the `/seatmap` route on all three deploy paths.

## ACCEPTANCE CRITERIA (the change is done when all are demonstrably true)

1. Convert a real itinerary containing explicit equipment (e.g. a GDS paste with `77W`), open the seat map for leg 2, and see that leg's airline/route/date/equipment with a layout that matches the airline's published configuration — badge `VERIFIED LAYOUT`, source named and dated on screen.
2. Convert an itinerary with **no** equipment, and see the inferred type labelled inferred, with the map still rendering (registry or clearly-marked generic).
3. Convert an itinerary whose type has no verified entry, and see `GENERIC LAYOUT — not verified for this airline` (or an honest refusal) — not a borrowed layout, not a made-up one.
4. No live provider configured → availability says simulated/unavailable; nothing on the page claims live data; no key string exists in any built file.
5. With a provider configured (documented, tested with mocks) → statuses come from the provider with a timestamp and the provider's name; provider failure degrades to layout-only with a visible reason.
6. Selecting a seat outside the ticketed cabin is refused with a reason; selecting any seat reserves nothing and the page says so.
7. `npm run build && npm test` green, new layout suite included; README updated to match reality.
8. Every new data entry has a real `sourceUrl` + `verifiedOn` you actually opened, and you list them in your final report.

## WORK ORDER
1. Read the code, then post a short plan naming the layouts you intend to verify and the sources you'll open.
2. Handoff + segment switcher + provenance plumbing (no visual invention).
3. `seatmap_layouts.js` schema, loader, resolver, generic fallback, integrity tests.
4. Verify and populate layouts from primary sources (record URL + date per entry).
5. Honest availability-source model + provider adapter scaffolding (+ optional `/api/seatmap`).
6. UI/disclosure/README updates.
7. Build, test, report — with the source list, the files changed, what is verified vs generic, and what is still explicitly not real.

## ANTI-GOALS
No seat *prices* invented; no "live" claims without a provider response; no scraping consumer seat-map sites; no passenger/PNR data in storage; no new npm dependency for the registry; no redesign of the terminal page; no silent fallback that makes a guess look authoritative; no removal of the honesty disclosures.
