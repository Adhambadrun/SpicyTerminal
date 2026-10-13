# SpicyTerminal

> **Status: online.** The full flight-conversion app is served from the homepage.

Paste flights from Google Flights, airline sites, emails or screenshots —
get a perfect, copy-paste-ready **GDS Black Window itinerary**.

**[Open / Deploy](#deploy)** · Made by **Adham Badran** — SpicyTerminal

## Why

One job, done perfectly. A deterministic offline engine — real IATA
aircraft codes, 12-hour GDS clocks, overnight markers, exact booking-class
handling, hidden-stop merging, one chronological ticket order. No
hallucinations, no re-rolling the dice.

- **Fast, bounded offline screenshots**: OCR is lazy-loaded, uses a worker where available, caps oversized frames, and has a short native-OCR deadline—so a stalled scanner cannot leave the app spinning forever.
- **Parallel AI fallback**: when the fast direct OCR passes have not found flights after ~1.5s, the Gemini fallback starts *immediately* and races the remaining bounded direct re-reads instead of running after them serially — a screenshot the offline engine cannot read answers in AI-time (not 14.5s-of-local-grinding + AI-time). The deterministic result always wins when both succeed; a junk direct read full of `????` placeholders is auto re-read by AI without a manual press.
- **AI mistake detection & self-learning — that refuses to learn nonsense**: the
  AI's answer is compared to the deterministic one **leg by leg** (same carrier,
  same flight-number digits after look-alike folding, same route, same day), never
  by row position, so a differently-segmented answer can no longer "correct" the
  wrong leg. A rule is only stored when the difference is a genuine scanner
  confusion (`O/0`, `I/1`, `S/5`, `Z/2`, `B/8`, `G/6`, `C/0`, `T/7`), and a rule
  that reverses an existing one cancels both instead of making the tool oscillate.
  Learned rules are applied to **screenshot OCR only** — a typed or pasted
  itinerary is ground truth and is never rewritten.
  A rule store written by the older learner is swept once on load, so already-
  poisoned devices self-heal instead of keeping their contradictory rules.
- **GDS rows are read as tables**: a screenshot of a terminal (or a re-paste of
  this tool's own output) keeps its columns. `15SEP` is no longer split into
  `15 SEP`, the flight-time column `6.10` is no longer mistaken for a clock, the
  sell-status column `HK2`/`TK2` no longer becomes a phantom Turkish leg, a glued
  `MIAVVI` is unrolled into its two airports, and a carrier the data file does
  not know yet (IberoJet `OB`, or alphanumeric `H4`) is still read in a numbered
  row. Explicit three-character equipment such as `330` and published mileage
  are preserved even when the local equipment table does not list the code.
- **`AI FIX` — the repair button, not the default path**: pasting converts on its own, no click needed.
  When that automatic offline pass cannot read an image (handwritten, cropped, garbage-scanned) or only
  half-reads it, `AI FIX` re-reads the same input with Gemini and repairs the result; the deterministic
  answer still wins whenever both succeed. (The previous label read like a mode switch, which made
  people wait for an "auto" that had already run and come back empty.)
  The status bar reports the outcome — `AI CONVERTED` when the repair lands — never the engine's
  own warning text or a `????` placeholder; why the AI was needed stays internal (it still feeds
  the mistake learner and the self-learning rules).
- **Reliable attachments**: `+ ATTACH`, drag-and-drop, and clipboard screenshots share one queue; image extensions are detected even when a browser supplies no MIME type, multiple images are parsed together in order, and stale work cannot overwrite a cleared request. Each screenshot has a small red `×` remove button, can be clicked to review full-size, and can also be removed from the review screen.
- **Word-proof carriers**: English words that are also IATA codes (`to`, `by`,
  `at`…) stay words. `to London` / `to Los Angeles` is no longer rewritten as
  a phantom Transavia `TO 105`, and bare `Manchester` is MAN (UK), not MHT.
- **Direction-proof routes**: every leg keeps the origin/destination it was
  pasted with. A route is read whether it sits on a short line or on a long
  Google-Flights card line, whether it is written `(JFK) to Dublin (DUB)`,
  `(JFK) TO Dublin (DUB)`, bare `SZX to DMM`, or after the flight number — so an
  outbound can no longer be printed with the return's airports.
- **Accent-proof cities**: cities are read the way their country spells them —
  `Bogotá`, `Zürich`, `São Paulo`, `Malmö`, `Kraków` — composed or decomposed
  (macOS pastes the latter). An accented letter used to hide a leg's route
  header, so the outbound silently borrowed the return's airports *and* the
  return's date; it no longer can.
- **Card lists keep their clocks**: on a Google-Flights-style card the time pair
  (`3:45 PM to 10:15 AM`) is printed *above* the flight number and below the
  previous leg. One leg used to get it right and every leg after it printed
  `????`; now that standalone line belongs to the flight under it, and only a
  whole line — never the tail of a neighbouring leg's own line.
- **Round-trip returns stay themselves**: `to 105 PM` — a Google-Flights clock
  pair with its colon lost — is a time again, not a phantom Transavia `TO 105`
  that stole the real flight's clocks into `????` (the engine never anchors a
  flight number with a meridiem glued to it). And a return whose own route
  header failed to publish no longer silently wears the outbound's direction:
  when the pasted clocks only add up on the opposite airport pair (1:05 PM →
  6:00 AM in 9h 55m printed as LAX→HND with a nonsense `¥2`), the pair is
  reversed and the row discloses it.
- **Published mileages**: distances are WGS-84 geodesic miles (Vincenty), which
  is what airlines and GDS systems quote. A spherical great circle runs up to
  ~0.5% short on east/west routes — JFK-DUB read 3171 instead of the published
  3179 — and near-antipodal pairs fall back to the spherical value rather than
  failing.
- **Text and PDF attachments**: `.txt`, `.eml`, `.csv`, `.json`, `.html`, `.ics`, and similar text exports are read instantly; PDFs are passed to AI only when the user explicitly supplies a Gemini key.
- **Weekly report, no button**: the counters refresh on their own with every conversion the user was
  shown, and a weekly snapshot (Monday 00:00 UTC → now, previous week compared, lifetime total kept
  separately, closed weeks archived — never mixed into the current one) is stored in `localStorage`
  (`spicy_weekly_report_v1`, throttled to one write a minute). The `Report a bug` email carries that
  snapshot to `adhambadraan@gmail.com` automatically — nothing to press, nothing to remember. A
  *conversion* is a result shown to the user: live re-renders while typing and AI replies the direct read
  beat are counted as neither.
- **About, in one click**: the `About` link leads the status row (`About / Booking Link / Generate Api /
  Seat Map / Report a bug`) and opens a dialog that says what the engine does, what it
  deliberately refuses to do, and who built it — no marketing, no fluff, `Esc` closes it and
  focus goes back where it was.
- **Booking checkout links**: a `BOOKING LINK` control sits next to About and lights green for a
  complete, certain itinerary on one bookable airline — American, Delta, Alaska, United or
  British Airways, one or several legs — using `spicy_links.js`, the link engine ported from the
  production Spicy Link Generator. American links pin every flight through aa.com metasearch;
  Delta trip summaries and Alaska planbook links carry every leg (plus an estimated price);
  United and British Airways links carry the route(s) and dates without pinning exact flights.
  A mixed-airline itinerary links only when exactly one of its airlines is bookable, and the
  disclosure says that only that airline's legs are linked. A compact passenger selector beside
  `BOOKING LINK` sets 1–9 travelers on the airline handoff; it does not assign seats. One click
  copies the URL and opens the external search or prefilled summary in one tab; it never books
  or purchases, and stays disabled for partial, invalid, uncertain, unsupported, mixed-bookable,
  or stale input. There is no Google Flights fallback.
- **Seat Map for the flight you converted** — open for every tab: the status-row `Seat Map` link (and
  `/seatmap` directly) draws immediately, no clicks to earn. The page reads the itinerary you just
  converted (`app.js` mirrors the OUTPUT pane into `sessionStorage`, and the seat map re-parses it with
  the real engine, so the two can never disagree) and shows the airline, flight number, route, date,
  departure clock, cabin, booking class and aircraft type; the badge on the map says how well the cabin
  layout is verified. Multi-leg itineraries get a leg switcher (`?leg=N` opens a leg directly). The
  `PRICE` block appears only while a live fare service answers its health probe: the fare is a real,
  account-backed offer (Amadeus Self-Service or Duffel) fetched at click time, and the whole block —
  button, panel and note — stays hidden whenever a real fare is not possible, so there is never a
  visible "not connected" button.
- **Seat Map date and deck controls** — both date fields have an offline calendar dropdown with
  month/year selectors and keyboard navigation (Alt+Down to open, arrows to move, Enter to select,
  Escape to close). Dates use the visitor's local calendar; a clicked flight-search result uses
  the search date, not the manual form's date. Layouts with both passenger decks (A380-800,
  747-400 and 747-8I references) show Main deck / Upper deck controls; single-deck and missing
  layouts do not. A requested/ticketed cabin opens its deck, counts and filters follow the deck
  being viewed, and refreshes preserve that view. Exports still include **all** decks, with deck
  labels and deck-qualified seat keys so repeated seat numbers cannot collide. The header is
  simplified and the quick-example buttons are removed; layout/source labels remain on the map.
- **No animations**: the interface is completely still (the Seat Map's flight strip, leg switcher and tier badges are plain instant updates too). There are no pane entrance effects,
  change sweeps, per-line glow bars, spinning edge glow, result-print effects, pulsing status
  dot, blinking cursor or hover transitions — a change simply updates the text. Nothing is
  left for `prefers-reduced-motion` to switch off, because there is no motion to begin with.
- **OUTPUT always scrolls**: a long itinerary scrolls inside its own window — wheel, keys,
  touch and drag-select. Nothing clips or animates the text (the old result print painted a
  `background-clip:text` streak, the browser bug that can stop a scrolling element dead), so
  what you scroll is a plain, native scrollport with no clipped paint or leftover filter.
- **INPUT wears the OUTPUT scrollbar**: both windows speak one scrollbar language — thin,
  terminal green, on a dark track (the INPUT textarea used to keep whatever bar the browser
  ships). Both bars are always drawn: there is no switch to hide them, and scrolling itself
  is plain native behaviour — wheel, arrow keys, PageUp/PageDown, drag-select and touch.
- Conversion and screenshot OCR run in the browser. `BOOKING LINK` opens an external airline search or prefilled summary for the selected party of 1–9 passengers and shares the itinerary details with that site — flight numbers, routes and dates (American, Delta and Alaska links; Delta and Alaska also carry an estimated price), or routes and dates only (United, British Airways). The selector changes traveler count only; it does not choose assigned seats, and the link never books or purchases automatically.
- `???` never appears as an aircraft; inferred values are disclosed.
- Never drops a flight row silently.

## Deploy

The app remains static and is built by `npm run build` into self-contained
`public/index.html` and `public/seatmap.html` pages (`index.html` and `app.html`
are also written to the repo root). The `/seatmap` rewrite is configured for Vercel and Netlify. For a local preview, run `npm run build && npm run dev`; the lightweight Python server mirrors the same route.

The `PRICE` block is wired by one build-time value:

```bash
SPICY_PRICE_ENDPOINT=/api/flights/price python3 build_web.py
```

- On Vercel or Netlify, set `SPICY_PRICE_ENDPOINT` in the project environment and deploy: `api/flights/price.js` serves the fare and `api/healthz.js` serves the probe (Vercel rewrites `/healthz`; Netlify redirects both paths).
- The fare provider credentials live in the project environment too: `AMADEUS_CLIENT_ID` + `AMADEUS_CLIENT_SECRET`, or `DUFFEL_TOKEN`. Until one of those pairs is set, `/healthz` answers `unavailable` and the `PRICE` block never appears — there is no visible "not connected" button and no placeholder fare.
- For a Netlify Drop, run the build with `SPICY_PRICE_ENDPOINT` pointing at a deployed fare service (for example the `tools/price_service` host, whose `/healthz` answers `{"ok":true}`) and re-drop `public/`.
- To check the gate locally against a running service: `node verify_price_gate.js http://127.0.0.1:8787/api/flights/price`.

- **Vercel**: import this repo — `vercel.json` already sets the build command
  and output directory, so every `git push` to `main` deploys automatically.
- **Netlify from Git**: connect this repo — `netlify.toml` builds and
  publishes `public/`.
- **Netlify Drop**: drag the generated `public/` folder onto <https://app.netlify.com/drop> to include both pages and the `/seatmap` route.

Only the self-contained app pages are deployed; repository screenshots, source
files and archives are never shipped.

## Structure

| file | role |
|---|---|
| `index.html` | main app (everything inlined, generated build artifact) |
| `public/` | deploy output (`index.html`, `app.html`, and `seatmap.html`; built, git-ignored) |
| `vercel.json` | Vercel build + output-directory config |
| `netlify.toml` | Netlify build + publish config |
| `ocrad.js` | pure offline OCR engine bundled locally |
| `app.js` | UI logic (offline image parser, auto-convert, AI mistake detector & self-learning) |
| `seatmap_layouts.js` | aircraft cabin layouts for the Seat Map: tiered (airline-verified / type reference / generic), versioned, with an integrity + provenance suite; inlined by the build |
| `seatmap_calendar.js` | dependency-free Seat Map calendar dropdowns, local-date defaults and accessible keyboard navigation; inlined by the build |
| `seatmap.js` / `seatmap.css` | the Seat Map page: reads the converted itinerary, resolves the layout tier, marks the ticketed cabin, and keeps seat statuses visibly simulated; inlined by the build |
| `seatmap_gate.js` | retired: the Seat Map is unlocked for everyone (no click counter, no dimmed link, `/seatmap` draws immediately). The module stays in the repo, unenforced, and nothing in the app imports it |
| `seatmap_price.js` | the Seat Map's `PRICE` block: builds the request from the active leg (route / date / cabin / adults only), allowlists the reply to the seven rendered fields, hides the whole block whenever a real fare is not possible, and maps every failure to one flat sentence — inlined by the build |
| `api/flights/price.js` | the fare backend behind `PRICE`: `GET /api/flights/price` returns a live account-backed offer (Amadeus Self-Service or Duffel), or `{"ok":false,"kind":"no_fare"}` — never a cached or estimated number |
| `api/_fare.js` | the fare logic shared by both endpoints: request validation, the live provider calls, the trimmed wire contract |
| `api/healthz.js` | the probe that gates the `PRICE` block: `{"status":"ok"}` only while a provider is configured and answering, `{"status":"unavailable"}` otherwise |
| `test_seatmap_price.js` | the PRICE contract, 140 checks: field allowlists, request building, the message map, escaping, the hidden-block rule, the health probe (both `{"status":"ok"}` and `{"ok":true}` shapes) — `node test_seatmap_price.js` |
| `test_fare_backend.js` | the fare backend contract: validation, the exact reply shapes, no-provider/dead-provider/empty-offer all answering `no_fare`, a live offer landing as the seven rendered fields, and nothing internal (tokens, urls, emissions, baggage) ever on the wire — `node test_fare_backend.js` |
| `fare_backend_test.py` | a tiny local stand-in for the fare backend so `npm run dev` can be exercised end to end (set `FARE_TEST_HEALTHY=1` to simulate a configured provider) |
| `seatmap_flights.js` | the Seat Map's flight lookup: a local table of published flight numbers + the layered fallbacks (converter's own table → route → airline) behind the `BA117` search box; inlined by the build |
| `spicy_engine.js` | the conversion engine |
| `spicy_links.js` | booking checkout link engine (AA / DL / AS / UA / BA), ported from the Spicy Link Generator; feeds the BOOKING LINK button |
| `spicy_live_free.js` | the same provider layer for offline tooling: keyless-first providers (OpenSky, Open-Meteo, Frankfurter, FlightSeatMap's free MCP, the local ICAO CO2 formula and the shipped visa table) plus optional BYOK free keys (AviationStack, AeroDataBox, Travelpayouts); 10-minute cache, token buckets, 800 ms debounce, provenance on every value; **not inlined by the build** |
| `spicy_data.js` | airports / airlines / aircraft data, merged from free open data (see below) |
| `update_spicy_data_free.py` | the free-data merge into `spicy_data.js`: OurAirports (Unlicense) + OpenFlights (ODbL) + Passport Index (MIT) + mledoze/countries (ODbL) — `python3 update_spicy_data_free.py` |
| `index_template.html` | page template |
| `wordmark_alpha.png` | transparent-background wordmark (header + welcome) |
| `build_web.py` | assembles the self-contained app pages from the sources above — `python3 build_web.py` |
| `preview_server.py` | dependency-free local static preview with a `/seatmap` rewrite — `npm run dev` |
| `test_engine.js` + `goldens.json` | parity tests vs the reference outputs — `node test_engine.js` (distances are the WGS-84 geodesic miles described above) |
| `test_route_direction.js` | route-direction + distance regression suite for the JFK/DUB bug report — `node test_route_direction.js` |
| `test_accent_routes.js` | accented-city regression suite for the MIA/BOG bug report (Bogotá, Zürich, São Paulo…) — `node test_accent_routes.js` |
| `test_big_wide.js` | wide test suite across 156 checks |
| `test_very_wide.js` | 5,000 random online flight test suite |
| `test_10k_pic_convert.js` | 10,000-iteration screenshot-card fuzz (uses the real `cleanOcrText`) — `npm run test:10k`, add `--seed=N` for a reproducible run |
| `test_offline_images.js` | OCR cleaner + real-image OCR speed tests |
| `test_attachment_pipeline.js` | end-to-end attachment pipeline tests (drop / paste / picker / PDF / HEIC / cache) |
| `test_lamar_h4.js` | 2026-10-11 H4 GDS report regression: unknown alphanumeric carrier rows, supplied 330/mileage preservation, and re-paste safety — `node test_lamar_h4.js` |
| `test_lax_man.js` | LAX–MAN round-trip regression (no phantom TO 105, Manchester is MAN not MHT) — `node test_lax_man.js` |
| `test_mistake_learner.js` | self-learning safety + GDS re-paste regression for the 2026-09-07 weekly report — `node test_mistake_learner.js` |
| `test_about_dialog.js` | About dialog: exact `About` label, focus trap, ESC/backdrop close, and that opening it cannot disturb a conversion — `node test_about_dialog.js` |
| `test_booking_link.js` | per-airline checkout handoffs (AA / DL / AS / UA / BA), selected 1–9 passenger counts, multi-leg and mixed-airline gating, unsupported-carrier refusals, stale-input/warning protections, and one-tab/one-copy behavior — `node test_booking_link.js` |
| `test_booking_link.js` | per-airline checkout handoffs (AA / DL / AS / UA / BA), selected 1–9 adult counts, multi-leg and mixed-airline gating, unsupported-carrier refusals, stale-input/warning protections, and one-tab/one-copy behavior — `node test_booking_link.js` |
| `test_seatmap_flights.js` | the flight lookup: query parsing the way people type it, the local table, the converter's own table, route/airline inference, no invented flight or aircraft, and every entry checked against the airports, airlines and drawable types the app actually has — `node test_seatmap_flights.js` |
| `test_seatmap_layouts.js` | the layout registry (including the four-class variants: a First or Premium Economy ticket always finds the cabin that type flies, and no variant is dressed up as verified): structural integrity of every reference layout, `I` never used as a seat letter, `seatCount` proven against the rows, provenance required on verified entries, tier resolution (verified → reference → generic → refusal), and coverage of every type the engine's equipment tables can emit — `node test_seatmap_layouts.js` |
| `test_seatmap_calendar.js` | leap years, month/year boundaries, local time zones, keyboard navigation, date selection and focus/dismissal behavior — `node test_seatmap_calendar.js` |
| `test_seatmap.js` | per-deck layout counts, collision-safe seat identities and exports, deterministic simulated availability, disclosure copy, `/seatmap` route, local exports, and the real-flight path: converted itinerary → legs → aircraft provenance → cabin gating → honest refusal for unknown/freighter types — `node test_seatmap.js` |
| `test_seatmap_gate.js` | the ten-click gate itself, executed: a fresh tab is sealed, nine clicks do not open it, the tenth does, the unlock survives a reload but not a new tab, blocked/absent storage degrades to memory, a damaged flag locks, and the stored payload carries a count and nothing else — `node test_seatmap_gate.js` |
| `test_seatmap_access.js` | the gate's wiring (dimmed link, sealed tooltip, lock card, fails closed when the gate module is missing) plus the itinerary handoff to `sessionStorage`, executed and asserted (store / clear / blocked storage / no storage / no passenger data), and the built pages ship the same gate and handoff — `node test_seatmap_access.js` |
| `test_seatmap_page.js` | the page itself, executed against a stub DOM: calendar date handoff, deck eligibility/switching/refresh/selection, and the converted flight renders (identity, equipment provenance, cabin, tier badge, airline link), `?leg=N` and the switcher move between legs, a seat outside the ticketed cabin is refused with a reason, the flight lookup draws what it finds (and says where it found it), asking for First switches to the four-class variant, an unknown flight is refused instead of invented, and nothing is ever fetched — `node test_seatmap_page.js` |
| `test_ai_fix_label.js` | the AI FIX label is on the button and in every user-facing hint, with no legacy name left in the chrome, and the id stays `btnAi` — `node test_ai_fix_label.js` |
| `test_status_messages.js` | the status bar reports outcomes, never machinery: a paste the offline read only half-reads is repaired by AI and the bar says `AI CONVERTED`, with no engine warning, no `????` placeholder and no internal token; every `setStatus` call site is scanned for leaks, the raw reason still reaches the learner, an incomplete AI reply still refuses to claim success, and the built pages ship the same line — `node test_status_messages.js` |
| `test_jro_kilimanjaro.js` | TK AMS–IST–JRO–IST–AMS GDS re-paste regression (2026-09-10 report): Kilimanjaro `JRO` overlay, glued `¥1` marker, `7M8` equipment, and unknown-code numbered table rows surviving instead of being mangled — `node test_jro_kilimanjaro.js` |
| `test_weekly_report.js` | weekly-report counters: week rollover, what counts as a conversion, blocked pop-up — `node test_weekly_report.js` |
| `test_live_free.js` | the free live layer with a stubbed network: keyless providers work with nothing configured, a keyed provider without a key makes no request, a user's key is stored locally and kept out of URLs, a cache hit skips the network, 429 locks the bucket with the offline-friendly message, CORS/HTML/truncated-JSON/server-error/offline are handled, FlightSeatMap's free MCP is never called live availability, and identical inputs give identical badges — `node test_live_free.js` |
| `test_month_airports.js` | the airport codes that are also something else (AUG/JAN/MAR/MAY/DEC/JUL/NOV months, HRS hours, JAL/PIA airline names, a clock glued to a code), pinned in both directions — `node test_month_airports.js` |

## Free live verification ($0, no card, no account)

The converter never needs the network: an itinerary converts offline in about 50 ms and the GDS
block it prints is final. The optional `spicy_live_free.js` provider layer still lives in the repo
for tooling and its own test suite, but it is no longer inlined into the built page — the shipped
app renders no provider rows under the OUTPUT pane and asks for nothing.

Two kinds of free provider, labelled differently everywhere the module reports them:

| kind | providers | key | what it is |
|---|---|---|---|
| keyless | OpenSky Network (anonymous state vectors), Open-Meteo (weather), Frankfurter (ECB rates), FlightSeatMap's free hosted MCP (seat maps), the local ICAO-style CO2 estimate, the shipped visa table | none | works for an anonymous visitor |
| BYOK | AviationStack free plan, AeroDataBox free tier, Travelpayouts | the user's own, typed in the app | stored in `localStorage`, sent straight from the browser to that provider, never to this app and never in a URL this app builds |

Rules the module enforces:

* every value carries its `provenance` string, so a number can always be traced to its source;
* responses are cached 10 minutes in memory and `localStorage`, calls are debounced 800 ms and
  deduplicated, and each provider has a token bucket, so a free quota cannot be burned by pasting;
* a 429 stops that provider for an hour with the exact line
  “Free API limit reached — offline conversion still perfect, try in 1h”; a FlightSeatMap outage is
  reported as “FlightSeatMap free unavailable (CORS) — showing verified local layout”;
* availability stays local unless a live provider is configured, and none is configured by
  default;
* no paid endpoint, paid plan or paid feature is referenced anywhere in the code or the UI.

## Free airport data

`update_spicy_data_free.py` folds four free datasets into `spicy_data.js` without ever deleting or
rewriting an entry the app already had: OurAirports (public domain) for names, coordinates, IATA
codes and scheduled-service flags; OpenFlights (ODbL) for the IANA zone of each airport; the
Passport Index dataset (MIT) for passport → destination requirements; mledoze/countries (ODbL) for
country names and currencies. Every generated block carries its source, licence and the date it was
fetched, and the script refuses to add an airport whose UTC offset and DST rule it cannot *prove*
against the IANA database — an unknown airport is better than a wrong local time. Re-run it any
time; it reports what changed and merges in place.

## Privacy

No accounts, no cookies, no tracking. Text conversion and screenshot OCR run in the browser;
those inputs are not uploaded by the local conversion path. The free badges described above contact the keyless providers named on the badge (Open-Meteo, Frankfurter, OpenSky) from your browser; no account, cookie or identifier is sent, and BYOK keys stay in this browser's `localStorage`. A `BOOKING LINK` click explicitly
opens an external airline search or prefilled summary for the selected party of 1–9 passengers and shares
the itinerary details with that site — flight numbers, routes and dates (American, Delta and
Alaska links; Delta and Alaska also carry an estimated price), or routes and dates only (United,
British Airways). The passenger selector does not assign seats; links never book or purchase
automatically. The AI fallback sends the user-selected content only when the user explicitly
provides and uses their own Gemini key. Weekly reports and bug reports open
in the user's email client to `adhambadraan@gmail.com`. The Seat Map is a local viewer: flight identity comes from the itinerary you converted (kept in that tab's `sessionStorage`), cabin layouts ship with the page, and seat statuses, counts and the 30-second refresh are simulated locally. Seat prices are not simulated: the `PRICE` block only appears when a live fare service answers its health probe, and the fare it shows is a live account-backed offer (Amadeus Self-Service or Duffel) fetched at click time for the route, date, cabin and party size — nothing else from the itinerary is sent, and the block hides itself the moment a real fare is not possible. Selecting a seat never reserves or books anything, and a "check the airline" link opens that airline's own site so live seats can be seen in the real booking.
