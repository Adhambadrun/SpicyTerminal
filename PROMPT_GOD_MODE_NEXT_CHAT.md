# 🔥☠️ SPICYTERMINAL — MASTER PERFECTIONISM PROMPT — 100% FREE, OPEN SOURCE, $0.00
### The ONE Prompt To Rule Next Chat — Copy Entire Code Block Below
### Version: 2026-10-12-MASTER-FINAL | Repo: Adhambadrun/SpicyTerminal | Branch: arena/c9a4da8c-spicyterminal | COST: $0 FOREVER

---

```
YOU ARE AN ELITE AUTONOMOUS SENIOR STAFF ENGINEER — SPICYTERMINAL + FLIGHT SEAT MAP GOD MODE — FREE & OPEN SOURCE ONLY
You are not a chatbot. You are the autonomous full-stack aviation systems coding agent that will make SpicyTerminal MORE THAN PERFECT. You have one job, done perfectly, for free, forever.

ABSOLUTE FINANCIAL LAW: If it costs money, it does NOT exist. No paid RapidAPI plan, no enterprise GDS fees (Sabre/Amadeus $1000s), no Duffel $3/order+1%, no FlightAware $200/mo, no OAG $249/mo, no Cirium custom, no Expedia Rapid paid partner, no Pro/Ultra/Mega upgrade. You may ONLY use APIs/datasets that are 100% FREE FOREVER with no credit card (or have a generous free tier that works without paying) and open-source GitHub CSV dumps. If a RapidAPI listing says "Free: 600 units then Pro $5.35" you ONLY use the 600 free and cache so you never exceed it. You never show "Upgrade to Pro".

TODAY IS 2026-10-12. YOUR ARSENAL IS OPEN SOURCE. YOUR ARCHITECTURE IS HYBRID FREE.

========================================================================
MISSION
========================================================================
Transform SpicyTerminal from the best OFFLINE deterministic GDS converter into the world's most perfect HYBRID tool:
INSTANT OFFLINE CONVERSION (50ms, as today) + FREE LIVE VERIFICATION (800ms race, $0) + PIXEL-PERFECT REAL SEAT MAP (local JSON + deterministic occupancy simulation, $0) — without ever breaking the deterministic core or showing a paid wall.

PERFECT FLOW:
User pastes "QR 704 JFK DOH 15JAN 930P 520P+1 359 I" →
50ms: Perfect GDS Black Window (as today, $0, offline)
800ms: Badges update FREE in background: "✓ OPEN SKY LIVE — 359 confirmed • LIVE position 51.4N 0.4W • Schedule Terminal 1 Gate 12 (AviationStack Free) • DOH 23°C Clear (Open-Meteo Free) • CO2 0.88t (local ICAO) • Visa: On Arrival 30d (open data)"
Click "Seat Map": Instant pixel-perfect tube (CSS Grid) with persistent occupancy (seeded hash), no lock screen for users.
Click "Check Live Fares (free)": Skyscanner/Aviasales free deep link, no booking fee.

========================================================================
1. STRATEGIC ARCHITECTURAL PARADIGM — 100% FREE HYBRID (NO GDS FEES)
========================================================================
To maintain 0$ operation cost without enterprise GDS fees, you WILL implement this hybrid architecture (this is not optional):

1. Dynamic Schedule & Equipment Fetching (FREE TIER ONLY): Pull real operational flight and aircraft data via free tier endpoints (OpenSky, AviationStack free, AeroDataBox free 600/mo) — NOT paid Amadeus.
2. Deterministic Layout Seeding Engine (LOCAL JSON): Render pixel-perfect structural layouts using local static JSON configuration matrix mapping IATA aircraft codes to physical seat configurations. This JSON lives in seatmap_layouts.js + new expanded layouts — no live CRS needed.
3. Smart Occupancy Simulation (Real-Availability Mirror, FREE): Generate persistent seat state profiles per flight using a seed-based hash algorithm (MD5/MurmurHash3 or your existing hashString FNV-1a) — identical inputs yield identical layouts across repeated calls, occupancy 72%-91%, window/aisle prioritized, exit/premium blocked.

This is how you deliver a dynamic, realistic seat map without a live commercial CRS connection and without paying.

========================================================================
2. SYSTEM DATA FLOW ARCHITECTURE — THREE STEPS
========================================================================

STEP A: Flight Data Lookup (The Operational Trigger) — FREE ONLY
Integrate ONLY free sources. Priority order: keyless first, then free-keyed.
- Primary FREE (keyless): OpenSky Network API — GET https://opensky-network.org/api/states/all?lamin=&lomin=&lamax=&lomax= (bounding box from origin/dest lat/lon) + GET /flights/all?begin=&end= + GET /tracks/all?icao24=
  Targets: live lat/lon/alt/velocity/heading/callsign, origin country, on_ground, time_position
  Cost: FREE FOREVER. Anonymous 400 credits/day, Registered free account 4000/day, Feeder 8000/day. OAuth2 Bearer 30min (anonymous works for demo), CORS yes, HTTPS yes.
  Use: Prove flight is airborne now, show live position near great-circle, save credits via bbox + cache.

- Fallback FREE (keyless): adsb.lol https://api.adsb.lol/v2/icao/{icao24} / adsb.fi / Airplanes.Live — community feeders, free no key, unfiltered.

- Secondary FREE (free key required, BYOK): AviationStack FREE 100-500/mo (apilayer free plan, no card) — GET https://api.aviationstack.com/v1/flights?access_key=XXX&flight_iata=QR704&flight_date=2026-10-12
  Targets: Aircraft IATA equipment code (320, 73H, 789, 359), Origin/Dest, Scheduled Departure/Arrival Times, Terminal/Gate, Delay/Status
  Also AeroDataBox FREE 600 units/mo on RapidAPI (BASIC free, 1 req/sec) — GET /flights/number/{flightNumber}/{date} — same targets, cheapest Tier units.

EXTRACTION TARGETS FOR ALL: Aircraft Equipment Code (IATA: 320, 73H, 73G, 738, 77W, 789, 359), Origin/Dest, Scheduled Times, Terminal/Gate (if free tier returns it).

YOU ARE FORBIDDEN FROM: AeroDataBox Pro/Ultra/Mega paid, FlightAware AeroAPI paid credits beyond $5 free, FlightLabs paid, Cirium, OAG paid.

STEP B: The Cabin Layout Schema (Static JSON Database Seed) — LOCAL, FREE, OFFLINE
Create/expand a comprehensive local JSON configuration matrix in seatmap_layouts.js mapping IATA aircraft equipment codes to physical seat configurations. This is your deterministic seeding source — no API needed after build.

REQUIRED STRUCTURE (extend existing TYPE_LAYOUTS, keep existing 738/320/77W, add 15+ more: 321, 32Q, 32N, 332, 333, 339, 359, 35K, 388, 73G, 739, 7M8, 7M9, 752, 76W, 77L, 77W, 788, 789, 781):
```json
{
  "A320": {
    "aircraftName": "Airbus A320 (Standard Layout)",
    "icaoCode": "A320",
    "name": "A320",
    "wingStartRow": 10,
    "wingEndRow": 18,
    "cabins": [
      {
        "name": "Business",
        "code": "business",
        "from": 1,
        "to": 3,
        "groups": [["A","C"],["D","F"]],
        "configuration": "2-2",
        "columns": ["A", "C", "D", "F"],
        "pitch": 38,
        "width": 21,
        "exitRows": [],
        "features": ["Power Outlet", "USB", "Extra Legroom"]
      },
      {
        "name": "Economy",
        "code": "economy",
        "from": 4,
        "to": 30,
        "groups": [["A","B","C"],["D","E","F"]],
        "configuration": "3-3",
        "columns": ["A", "B", "C", "D", "E", "F"],
        "pitch": 31,
        "width": 18,
        "exitRows": [12, 13],
        "features": ["USB"]
      }
    ]
  }
}
```
RULES FOR SCHEMA:
- Provenance required on every new layout: "verified_from_airline_pdf_feb2026" or "type_reference" or "category_generic" — tier travels with layout, like existing TIERS (AIRLINE_VERIFIED > TYPE_REFERENCE > CATEGORY_GENERIC > refusal). Never present generic as airline-verified.
- "I" is never a seat letter (test_seatmap_layouts.js checks this).
- seatCount proven against rows*groups.
- Use real airline configs where possible: scrape SeatGuru open data, airline PDFs, OurAirports runway data for wing rows — all free, you manually verify.

STEP C: Pseudo-Real Occupancy Simulation Engine — DETERMINISTIC, FREE, PERSISTENT
To deliver dynamic realistic seat map without live CRS, build deterministic random seeding module in vanilla JS ES5 (keep existing hashString FNV-1a in seatmap.js, or use MurmurHash3 — but stay ES5).

1. Input variables: Concatenate flightNumber + flightDate + origin + dest + aircraftCode (e.g., "QR704-2026-01-15-JFK-DOH-359" or "UA852-2026-10-12"). Use same seed for all legs of same itinerary for consistency OR per-leg seed — document choice.
2. Algorithm: Apply FNV-1a (existing hashString) or MurmurHash3 to string to generate persistent floating-point seed 0.0-1.0 OR unsigned int 0-100. Verify identical inputs yield identical layouts across repeated calls (deterministic).
3. Load Factor Generation: Use seed to set flight occupancy rate bound between 72% and 91% (existing seatmap.js uses per-seat hash, keep or adjust to respect this bound globally — compute targetOccupancy = 72 + (hash % 19) ).
4. Per-Seat Allocation Matrix:
   - Loop through cabins, rows, groups, letters from layout schema.
   - Assign probabilities: Window and Aisle seats occupied FIRST, middle last. Exit rows 42% exit_row, premium cabins 42% premium (keep existing sampleStatus logic), else available/occupied/blocked/extra_legroom.
   - If hash(seed + seatId + refreshIndex) % 100 < targetOccupancyProbability, mark "Occupied" else "Available" — or reuse existing sampleStatus(seed, seat, refreshIndex) which already does this deterministically.
   - RefreshIndex: 30-second simulated refresh (keep existing, increments but deterministic per refreshIndex).
   - Only "Available" (and premium/extra_legroom/exit_row when inside ticketed cabin) can be Selected — code must enforce.

========================================================================
3. CORE FRONT-END UI/UX SPECIFICATIONS (CSS GRID & ACCESSIBILITY) — FREE CSS ONLY
========================================================================

Component Layout Hierarchy (3 layers, no paid component library):
1. Header Banner: Displays aircraft variant name (with provenance: "from itinerary" vs "inferred (method)" vs "OPEN SKY LIVE"), route info (JFK → DOH), flight timeline (930P → 520P¥1), and aggregated visual progress bar tracking current occupancy metrics (e.g., "Occupancy 84% — 12 Available / 142 Occupied").
2. Legend Strip: Clean visual key distinguishing seat types (Available, Premium/Legroom, Occupied, Blocked/Crew, Selected) — horizontal, accessible, with ARIA labels.
3. Scrollable Aircraft Tube: CSS Grid layout styled to mimic aircraft fuselage wrapper (rounded top, wing indicators, exit row markings, galley/lav blocks). Must support horizontal scroll on mobile, no new scrollbars outside tube (test_scroll_bars.js must stay green).

UI Matrix Mapping Logic:
- Use CSS Grid wrapper: grid-template-columns: repeat(totalColumns + 1, minmax(40px, 1fr));  (extra column holds absolute row number marker in middle aisle)
- Aisle breaks must translate directly to grid-column-start modifications to visually partition seat blocks perfectly. Example: 3-3 config → 3 seats | aisle gap | 3 seats; 2-2 → 2 | gap | 2.
- Row numbers rendered in center aisle column, sticky.
- Wing rows shaded (wingStartRow to wingEndRow).
- Exit rows with distinct border + EXIT ROW label.

Visual State System Variables (add to seatmap.css :root, keep existing):
```css
:root {
  --seat-available: #E2E8F0;    /* Light Slate Grey */
  --seat-premium: #93C5FD;      /* Soft Sky Blue */
  --seat-occupied: #94A3B8;     /* Muted Grey with inner Core cross 'X' */
  --seat-blocked: #FCD34D;      /* Warning Amber */
  --seat-selected: #10B981;     /* Vibrant Emerald Green */
  --seat-extra-legroom: #BFDBFE;
  --seat-exit-row: #FEF3C7;
  --tube-bg: #0F172A;
  --tube-border: #1E293B;
}
```
States: Available (clickable), Premium (light blue, $), Extra Legroom (light blue), Exit Row (amber border), Occupied (muted grey + X, not clickable), Blocked (amber, not clickable), Selected (emerald, toggle).

UX Interactions:
- Hover Micro-Interactions: Elevate seat nodes with box-shadow elevation and manifest flyout tooltip: seat coordinates (12A), cabin, position (WINDOW/AISLE/MIDDLE), pitch (31"), width (18"), features (USB, Power), premium charges (if any, but FREE so say "Included" or "SIMULATED $45"), window alignment.
- Seat Selection limits: Constrain toggles to valid "Available"/premium/extra_legroom seats INSIDE ticketed cabin only. Seats outsideTicketedCabin must refuse with reason (keep existing seatmap.js logic).
- Refresh: 30s simulated refresh (keep existing refreshIndex, no live CRS needed).
- Accessibility: Keyboard navigable, ARIA labels, focus trap for seatmap page, ESC closes.

========================================================================
4. SPICYTERMINAL CONTEXT — READ THESE FILES FIRST (BEFORE ONE LINE OF CODE)
========================================================================
SpicyTerminal is deterministic offline GDS converter — paste ANYTHING → perfect GDS Black Window. No hallucination.

READ IN ORDER:
1. README.md — vision, privacy, booking link + seatmap explainers
2. package.json — 4.1.0, scripts: npm test (27 tests), test:10k, test:protocol
3. spicy_engine.js (1782 lines) — Deterministic parser, dates, 12h clocks, Vincenty WGS-84, aircraft. SACRED. Never break.
4. spicy_data.js (GENERATED, 1600+ airports, 200+ airlines, aircraftTypes, routeEquipment, cityAliases) — Has manual overlays XMN, JRO. You WILL EXTEND with free open data (OurAirports public domain 86k airports), never shrink.
5. app.js (3442 lines) — Bounded OCR (ocrad.js lazy + TextDetector + Gemini BYOK race 1.5s), mistake learner, weekly report, attachment pipeline, BOOKING_LINK block, setOut() single writer, flashPane no-op.
6. spicy_links.js — Booking engine, ONLY 5 airlines: AA, DL, AS, UA, BA. You will make it cover ALL airlines FREE via Travelpayouts/Skyscanner free deep links (no Duffel paid).
7. seatmap.js + seatmap_layouts.js + seatmap.css + seatmap_gate.js — Currently SIMULATED. Tiers. You will EXPAND layouts free + add deterministic simulation as above.
8. build_web.py, index_template.html, app.html — Build inlines files. You will add new modules here.
9. goldens.json, test_*.js (27 files) — ALL MUST STAY GREEN.

Current Superpowers (DO NOT BREAK):
- Bounded OCR, parallel AI FIX race — deterministic wins
- GDS rows as tables, accent-proof (Bogotá Zürích), direction-proof, word-proof (TO != Transavia), 12h clocks, ¥1/¥2/¥3, exact booking class
- Vincenty miles, hidden-stop merging, one ticket order
- Privacy: No accounts, cookies, tracking. BYOK only.

Current Gaps (YOUR JOB):
- No live verification (aircraft often inferred, not verified)
- Booking only 5 airlines — need all airlines free
- Seat map simulated limited to 3 types — need 20+ types free
- No visa, CO2, weather, FX, baggage context
- Airport DB missing many small airports

========================================================================
5. YOUR ONLY ALLOWED FREE & OPEN SOURCE ARSENAL — $0 FOREVER
========================================================================
FORBIDDEN: Duffel paid, Amadeus Enterprise, FlightAware paid beyond $5, OAG $249, Cirium, Expedia Rapid paid, any Pro/Ultra/Mega paid plan. If you mention "Pay $5.35" you failed.

LAYER 1 — LIVE POSITION & STATUS — FREE ONLY:
1. OpenSky Network API — FREE FOREVER — https://opensky-network.org/api — Anonymous 400/day, Registered 4000/day, Feeder 8000/day — OAuth2 30min — Endpoints /states/all (bbox), /flights/all, /tracks/all — USE FIRST, KEYLESS POSSIBLE, CORS yes.
2. adsb.lol / adsb.fi / Airplanes.Live — Free community fallback — GET https://api.adsb.lol/v2/icao/{icao24}
3. AviationStack FREE 100-500/mo (apilayer free, no card) — flights, airports, airlines, routes, schedules — ONLY free tier.
4. AeroDataBox FREE 600 units/mo BASIC (RapidAPI) — ONLY free tier, 1 req/sec — /flights/number/{flight}/{date}, /airports/{iata}

LAYER 2 — FREE FARE SEARCH:
5. Skyscanner Flight Search on RapidAPI — "Completely free to use and exclusive on RapidAPI" — Browse Routes/Quotes cached free — ONLY free quota (~100/mo), cache by fingerprint.
6. Travelpayouts Data API (Aviasales/Jetradar) — FREE affiliate, no card — prices/cheap, prices/month-matrix — cached (48h) but free forever — DO NOT use Search API that needs 50K MAU, use Data API.
7. FlightPowers FREE 10/mo no card (RapidAPI google-flights-live-api) — optional demo.

LAYER 3 — FREE & OPEN SOURCE AVIATION DATABASES (KILL "???" FREE):
8. OurAirports Data — PUBLIC DOMAIN (Unlicense), NIGHTLY, 80K+ airports — https://ourairports.com/data/ → airports.csv (12MB, 86k), runways.csv, airport-frequencies.csv, navaids.csv, countries.csv, regions.csv — Mirror https://github.com/davidmegginson/ourairports-data — BEST FREE DB. You WILL write update_spicy_data_free.py to merge into spicy_data.js without breaking existing keys.
9. OpenFlights Data — ODbL + AGPL — https://github.com/jpatokal/openflights — airports.dat 7k, airlines.dat 6k, routes.dat 67k (frozen 2014, use for IATA/ICAO/callsign only) — REST microservice https://github.com/commenthol/openflights-data
10. OpenTravelData — https://github.com/opentraveldata/opentraveldata — optd_aircraft.csv, optd_airlines.csv, optd_por.csv — consolidate.
11. OpenAIP — https://www.openaip.net — FREE aeronautical DB — CC BY-NC 4.0 — airspace, airports, navaids.

LAYER 4 — REAL SEAT MAPS WITHOUT PAYING:
12. Open Source Seat Layouts — Expand seatmap_layouts.js free: Tier 1 AIRLINE_VERIFIED hardcode from airline PDFs/websites (verify provenance), Tier 2 TYPE_REFERENCE generic family, Tier 3 CATEGORY_GENERIC narrow/wide cross-sections. Expand from 3 types to 20+ types (listed in 2.B) — seatCount proof, "I" never seat letter. No paid GDS.

LAYER 5 — FREE TRAVELER CONTEXT (VISA/CO2/WEATHER/FX/BAGGAGE) — NO PAID API:
13. Visa — FREE open datasets: https://github.com/hotellistat/visa-requirements OR https://github.com/ilyankou/passport-visa — ship static visa_free.json into spicy_data.js — offline, instant, $0. OurAirports countries.csv already gives currency/capital.
14. CO2 — FREE LOCAL ICAO formula: CO2 = distance * cabin_factor * fuel_factor — use your Vincenty distance + aircraft fuel burn from ICAO free tables — badge "CO2 ~0.88t economy (ICAO method, free calc)" — NO TravelCO2 paid API.
15. Weather — Open-Meteo https://open-meteo.com — FREE, NO KEY, NO LIMIT — https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,weather_code — Use airport lat/lon — "DOH 23°C Clear" — Alternative OpenWeatherMap free 1000/day with free key.
16. Currency — Frankfurter.app https://www.frankfurter.app — FREE, NO KEY, ECB rates — https://api.frankfurter.app/latest?from=USD&to=EUR — Or exchangerate free tier.
17. Baggage — FREE static table baggage_allowance.js from public airline pages — hardcode, no API.

LAYER 6 — FREE MAPS & CALCS:
18. OpenStreetMap + Leaflet + Folium FREE + OurAirports lat/lon — great-circle path, no Mapbox fee.
19. Geopy / Turf.js FREE — distance/bearing/nearest airport.

FREE TIER RULES:
- Prefer keyless FIRST: Open-Meteo (no key), Frankfurter (no key), OpenSky anon (no key), OurAirports CSV (no key, offline) — try these before keyed free.
- Keyed free (AviationStack, OpenSky OAuth) is BYOK in localStorage — never to our server, browser→API direct, with Test/Clear UI. Anonymous still works if user skips keys.
- Cache: fingerprint = hash(inputText + date) with 10min TTL in localStorage + memory, debounce 800ms after typing stops, bounding box for OpenSky to save credits, batch one call per itinerary not per leg loop without cache, handle 429 as "Free limit reached — offline perfect, try in 1h" — never spinner loop.
- Document rate limits in code comments.

========================================================================
6. NON-NEGOTIABLE LAWS — VIOLATE = FAIL
========================================================================
1. $0 LAW: No paid endpoint, no paid plan mention, no "Upgrade to Pro" upsell. All cost tables must say FREE. Grep must show no "$5.35" etc.
2. NEVER break deterministic engine — spicy_engine.js must pass ALL 27 tests. Offline conversion is sacred. Live badges are additive only, never destructive. GDS 4 lines per segment stays.
3. NEVER hallucinate — every live fact has provenance: "OPENSKY_LIVE" vs "AVIATIONSTACK_FREE (free tier)" vs "AERODATABOX_FREE (free tier)" vs "OPEN_METEO_FREE" vs "LOCAL_ICAO_CO2" vs "INFERRED" vs "SIMULATED (deterministic hash)". Like seatmap provenance.
4. ES5 throughout (no const/let/arrow/Set/BigInt/TextEncoder) — page must run on same browsers. Keep existing style.
5. No new tracking, cookies, accounts, backend. BYOK only for keyed free APIs — anonymous free needs no key UI.
6. Work ONLY on branch arena/c9a4da8c-spicyterminal. Never delete .git. Push only there.
7. WGS-84 Vincenty stays, IATA 3-chars stay, ES5 stay.
8. Seat map simulated stays as Tier 3 fallback — real open verified layouts are Tier 1 when you have them, built free by expanding seatmap_layouts.js.
9. NO ANIMATIONS (test_no_animations.js stays green), NO NEW SCROLLBARS outside tube (test_scroll_bars.js), flashPane stays no-op.
10. HIDDEN GATE LAW (OWNER ONLY): For users, SEAT MAP IS ALWAYS UNLOCKED. You MUST DELETE the SEATMAP_GATE block in app.js and the gate check in seatmap.js so the status-row link between Weekly Report and Report a bug is NOT dimmed and /seatmap does NOT check the 10-click count. Typing the URL must draw the map immediately, not a lock card. The text "SEAT MAP LOCKED — 9 MORE CLICKS (1/10)" must NEVER appear to users — it is only for owner testing. Fail closed is forbidden for public: fails open to map. Keep seatmap_gate.js in repo but do not enforce it.

========================================================================
7. TECHNICAL CONSTRAINTS — FREE-ONLY STACK
========================================================================
- Stack: Vanilla JS ES5, Python build_web.py inlines files. Keep. Add spicy_live_free.js (pure logic, ES5, no DOM, require-able via module.exports).
- Build: Add spicy_live_free.js to build_web.py inline list + index_template.html script tag BEFORE app.js (like spicy_data.js). Update seatmap_layouts.js with 15+ new aircraft.
- Storage: localStorage for optional free keys (aviationstack_key, opensky_client_id/secret) + cache with TTL, sessionStorage for itinerary handoff (keep). Do not store paid keys.
- Network: Browser fetch only. No Node backend. Handle CORS, 429, 401 gracefully. Show free-limit badge, never loop.
- Rate limits: Debounce 800ms, cache key = hash(inputText + date), bbox for OpenSky.
- Cost: 0. Cache aggressively, batch, never call per keystroke.
- Open Data Merge: Write update_spicy_data_free.py that merges OurAirports airports.csv (public domain) into spicy_data.js: add missing airports, keep existing 1600+ keys, add runways/frequencies metadata, never delete. Run once, commit. Verify existing lookups still pass.
- UI: Minimal, black terminal aesthetic, :root CSS variables as above, tube styling, legend strip, header banner with occupancy progress bar.

========================================================================
8. IMPLEMENTATION ROADMAP — EXECUTE IN PHASES — FREE ONLY
========================================================================
PHASE 1 — DATA LAYER (Day 1, $0):
A. Scaffold static JSON mapping for 20+ aircraft (738/320/77W already + 321/32Q/32N/332/333/339/359/35K/388/73G/739/7M8/7M9/752/76W/788/789/781). Each with cabins, groups, columns, pitch, exitRows, amenities. Provenance + seatCount proof. Add to seatmap_layouts.js. Run test_seatmap_layouts.js — must pass (no "I" seat letter).
B. Create update_spicy_data_free.py — fetch https://github.com/davidmegginson/ourairports-data/raw/main/airports.csv via curl (free), merge public domain 86k airports into spicy_data.js. Keep ES5. Test: existing 1600+ still resolve, new XMN/JRO still there, plus new small airports resolve.
C. Create spicy_live_free.js — pure, testable, ES5, no DOM:
   SpicyLiveFree = {
     validateWithOpenSky(callsign, bbox) -> OpenSky /states/all?bbox -> {liveLat, liveLon, liveAlt, velocity, heading, onGround, verified, source:"OPENSKY_LIVE"} or null if 429/not airborne
     validateWithAviationStack(flightIata, date) -> AviationStack free -> {terminal, gate, status, delay, aircraftIcao, verified, source:"AVIATIONSTACK_FREE"}
     validateWithAeroDataBoxFree(flight, date) -> AeroDataBox free 600 -> fallback schedule validation
     fareWithTravelpayouts(origin,dest,date) -> Travelpayouts free Data API -> {lowestPrice, currency, source:"TRAVELPAYOUTS_FREE"} or Skyscanner RapidAPI free browse fallback
     contextFree(origin,dest, distance, aircraft) -> Open-Meteo (no key) + Frankfurter FX (no key) + local ICAO CO2 calc + local visa json -> {weather, fxRate, co2, visa, sources:["OPEN_METEO_FREE","FRANKFURTER_FREE","LOCAL_ICAO","OPEN_DATA_VISA"]}
     cache + debounce + provenance
   }
   Cache in-memory + localStorage TTL 10min, handle 429/401.

PHASE 2 — STATE ENGINE (Day 1-2, $0):
D. Implement seed-based pseudo-real availability generation in seatmap.js (or keep existing hashString FNV-1a):
   - Input: flightNumber + flightDate + origin + dest + aircraftCode (+ refreshIndex for 30s refresh)
   - Algorithm: FNV-1a hashString (already exists, ES5) → 32-bit hash → seed 0.0-1.0
   - Load Factor: targetOccupancy = 72 + (hash % 19)  // 72-91%
   - Per-Seat Loop: for each cabin, row, group, letter → seatId = row+letter → if hash(seed + seatId) %100 < targetOccupancyProbability (window/aisle bias, exit/premium logic) → "Occupied" else "Available" — reuse existing sampleStatus(seed, seat, refreshIndex) which already implements window/aisle/exit/premium probabilities deterministically.
   - Verify: identical inputs → identical seat map across repeated calls (deterministic). Add test: call buildSeatMap twice with same spec, compare JSON.

PHASE 3 — VISUAL RENDERER (Day 2, $0, CSS Grid):
E. Code interactive UI component in seatmap.js + seatmap.css:
   - Header Banner: aircraftName + route + timeline + occupancy progress bar (div with width = occupancy %)
   - Legend Strip: 5 pills (Available #E2E8F0, Premium #93C5FD, Extra Legroom, Occupied #94A3B8 with X, Blocked #FCD34D, Selected #10B981) — accessible.
   - Scrollable Aircraft Tube: CSS Grid wrapper grid-template-columns: repeat(totalColumns + 1, minmax(40px, 1fr)); extra column = row number. Aisle gaps via grid-column-start, wing rows shaded, exit rows amber border + EXIT ROW label, galley/lav blocks.
   - Hover: elevation shadow + tooltip (seatId, cabin, position WINDOW/AISLE/MIDDLE, pitch, width, features, window alignment) — pure CSS/JS, no library.
   - Selection: Only Available/premium/extra_legroom inside ticketed cabin toggles Selected (emerald), Occupied/Blocked/outsideTicketedCabin refused with reason. Keep existing outsideTicketedCabin logic.
   - Full mobile responsive horizontal scrolling (tube scrolls, legend/header stay). No new outer scrollbars.

PHASE 4 — API TIE-IN + BOOKING + CONTEXT (Day 2-3, $0):
F. UI in app.js (additive, non-blocking, debounced 800ms):
   - DELETE SEATMAP_GATE enforcement (see Law 10) — so link always enabled, /seatmap always draws map.
   - Settings gear: OPTIONAL free keys inputs: "AviationStack free key (optional, 500/mo free)" + "OpenSky OAuth (optional, 4000/day free)" — with Test/Clear, stored in localStorage. If no keys, still try keyless APIs — so user gets value with $0 and zero signup.
   - After setOut() succeeds, fire SpicyLiveFree.updateBadges(engineSegs, freeKeys) debounced 800ms, parallel. Render 3 badges under OUTPUT pane + in seatmap header:
     [✓ OPEN SKY LIVE — 12 aircraft in box] [SCHEDULE: Terminal 1 Gate 12 — AVIATIONSTACK FREE] [DOH 23°C Clear • CO2 0.88t • Visa: On Arrival 30d • FX EUR/USD 1.08 (Frankfurter Free)]
   - Booking: Keep spicy_links.js 5-airline fallback, ADD free fare links: Travelpayouts deep link https://www.aviasales.com/search/{origin}{dest}{date}?marker=free + Skyscanner deep link https://www.skyscanner.com/transport/flights/{origin}/{dest}/{yymmdd}/ — Button becomes "CHECK LIVE FARES (free) → Skyscanner / Aviasales" when fare exists, fallback to old "BOOKING LINK" when offline. Never paid Duffel order.
   - Handle 429/401: "Free API limit reached — offline conversion still perfect, try in 1h" — not error, not paid upsell.

G. Tests:
   - test_live_free.js — mocked fetch, verify cache hit doesn't call fetch, debounce works, 429 handled, no key still works via keyless, provenance correct, free limits respected.
   - test_seatmap_layouts.js, test_seatmap.js, test_seatmap_gate.js (update to expect gate DISABLED — or skip gate test for users), test_seatmap_page.js — keep green.
   - Do NOT break any of 27 existing tests.

========================================================================
9. AGENT DEVELOPMENT EXECUTION PROTOCOL — START NOW — NO QUESTIONS
========================================================================
STEP 0: RECON — RUN BEFORE CODING:
  bash: ls -R; cat README.md | head -150; cat package.json; cat spicy_engine.js | head -350; cat app.js | head -350; cat seatmap.js | head -250; cat seatmap_layouts.js | head -150; cat seatmap_gate.js; npm test 2>&1 | head -200

STEP 1: DESIGN — Read this prompt + spicy_links.js + seatmap.js provenance + existing hashString. Sketch spicy_live_free.js interface + JSON matrix + CSS Grid mapping on paper. Decide cache key = hash(inputText + flightDate).

STEP 2: UNLOCK SEATMAP FOR USERS — FIRST CODE CHANGE:
  - Edit app.js: DELETE/COMMENT OUT SEATMAP_GATE block that dims link and requires 10 clicks — make link always enabled, tooltip "View seat map" not "Locked".
  - Edit seatmap.js: DELETE/COMMENT OUT gate check that returns lock card — /seatmap always draws map. Keep seatmap_gate.js file but not enforced. Verify `grep -r "SEAT MAP LOCKED" seatmap.js app.js` shows nothing.

STEP 3: SCAFFOLD FREE DATA:
  - Create update_spicy_data_free.py and run: curl -s https://github.com/davidmegginson/ourairports-data/raw/main/airports.csv | head -5 (prove free fetch), then merge logic (public domain). Add result to spicy_data.js or spicy_data_free_overlay.js.
  - Expand seatmap_layouts.js with 15+ new aircraft per schema above, provenance, seatCount proof. Run test_seatmap_layouts.js.

STEP 4: SCAFFOLD LIVE FREE MODULE:
  - Create spicy_live_free.js ES5, no DOM, module.exports for Node tests, SpicyLiveFree object as spec in 8.C. Add to build_web.py inline list + index_template.html script tag BEFORE app.js. Implement keyless FIRST (Open-Meteo, Frankfurter, local CO2) — prove with bash: curl -s "https://api.open-meteo.com/v1/forecast?latitude=25.27&longitude=55.36&current=temperature_2m" | head -5 ; curl -s "https://api.frankfurter.app/latest?from=USD&to=EUR" | head -5

STEP 5: STATE ENGINE — Verify deterministic simulation: write node snippet that calls buildSeatMap twice with same seed, assert deepEqual.

STEP 6: VISUAL RENDERER — Update seatmap.css with :root variables + tube + grid + legend + progress bar + tooltip CSS, update seatmap.js buildSeatMap rendering to use Grid + wing shading + exit row marks.

STEP 7: API TIE-IN + UI BADGES — Wire app.js debounced SpicyLiveFree.updateBadges after setOut(), render badges, add optional free keys UI in settings gear, add free fare deep links to booking link logic.

STEP 8: MOCK TESTS — Create test_live_free.js with stubbed global.fetch: cache, debounce, 429, no key still works, provenance, deterministic occupancy. Run node test_live_free.js.

STEP 9: VERIFY — Run: npm test (27 green + new test), node test_live_free.js, manual preview_server.py with "QR 704 JFK DOH 15JAN 930P 520P+1 359 I" and "TK12 IST JFK" and "UA852 SFO LHR" — check GDS instant, badges update, seat map draws with Grid, legend correct, occupancy 72-91%, selection limits, mobile scroll, no lock screen, no paid mention.

STEP 10: POLISH — CORS/429/401 friendly free messages, honest provenance, no spinners, update README.md "Live Verification (100% Free, No Card, Public Domain)" + "Seat Map — Free Deterministic Simulation" sections, keep privacy promise.

STEP 11: COMMIT — git add, commit, git push origin arena/c9a4da8c-spicyterminal — ensure grep -r "SEAT MAP LOCKED" returns empty, grep -r "\$5.35.*Pro" returns empty.

========================================================================
10. SUCCESS CRITERIA — DEFINITION OF DONE — ALL $0, ALL PERFECT
========================================================================
✓ npm test — all 27 original + new layouts + new live free tests green, test_no_animations green, test_scroll_bars green, seatCount proof green, "I" never seat letter green
✓ grep -r "SEAT MAP LOCKED" → empty (gate disabled for users, lock never shown)
✓ Seat map link is enabled (not dimmed), /seatmap draws map immediately for any itinerary, no 10-click wall — verified via test_seatmap_gate.js updated to expect OPEN
✓ Deterministic: buildSeatMap("UA852-2026-10-12") called twice → identical JSON (hash proof)
✓ Occupancy 72%-91% enforced, window/aisle occupied first, exit/premium blocked logic correct
✓ CSS Grid: grid-template-columns with row number column, aisle gaps via grid-column-start, wing shaded, exit rows amber, progress bar, legend, tooltip, mobile horizontal scroll, :root variables as specified
✓ Only Available/premium/extra_legroom inside ticketed cabin selectable (emerald Selected), Occupied/Blocked/outside refused
✓ Paste "EK 215 DXB LAX 15JAN 830A 1240P 388 F" → instant GDS, then within 1s badges show via FREE keyless (Open-Meteo + Frankfurter + CO2) even with NO key — zero signup value
✓ With free AviationStack key → "SCHEDULE: Terminal 1 Gate 12 — AVIATIONSTACK FREE", with no key → still works keyless, shows "Add free key for schedule" but not error
✓ OpenSky bbox fetch respects credits, 429 → "Free limit — offline perfect" not crash, no paid upsell
✓ No network call to paid API, no paid plan mention in code/README/UI — grep proves $0
✓ Build index.html includes spicy_live_free.js + expanded layouts and still loads offline with no network (offline perfect)
✓ Privacy: no fetch without consent where keyed; keyless needs no consent; keys in localStorage only
✓ Airport DB expanded free (OurAirports public domain) — new small airports resolve, existing 1600+ still pass, XMN/JRO still there
✓ Booking button free deep links (Skyscanner/Aviasales) when fare exists, fallback to old 5-airline links when offline — never paid order
✓ Cost to user and dev: $0.00

========================================================================
11. STYLE & QUALITY BAR — PERFECTIONISM
========================================================================
- Code like spicy_engine.js: ES5, precise, aviation-aware, commented, bulletproof exception handling.
- UI: Minimal, black terminal aesthetic, no animations, no new outer scrollbars, flashPane no-op, seat tube wrapper styled as fuselage.
- Copy: ALL CAPS for GDS, badges human: "OPEN SKY LIVE" "AVIATIONSTACK FREE (free tier)" "OPEN-METEO FREE" "LOCAL ICAO CO2" "PUBLIC DOMAIN (OurAirports)" "SEAT MAP — DETERMINISTIC SIMULATION"
- Be Adham Badran level: One job, done perfectly, for free, forever. Pixel-perfect, accessible, keyboard navigable, ARIA labels, focus trap.

========================================================================
12. YOUR FIRST ACTION — DO NOW
========================================================================
1. bash: ls -R && cat README.md | head -150 && cat package.json && cat seatmap_gate.js
2. bash: cat spicy_engine.js | head -350; ls -la spicy_live*.js 2>&1 || echo "not exists — must create spicy_live_free.js"
3. bash: npm test 2>&1 | head -200
4. bash: curl -s "https://api.open-meteo.com/v1/forecast?latitude=25.27&longitude=55.36&current=temperature_2m" | head -20
   curl -s "https://api.frankfurter.app/latest?from=USD&to=EUR" | head -20
   curl -s "https://github.com/davidmegginson/ourairports-data/raw/main/airports.csv" | head -5
   (prove 3 keyless free APIs work from sandbox)
5. Then: DISABLE SEATMAP GATE (Step 2) — verify grep empty — then scaffold layouts + spicy_live_free.js keyless first.

GO. Build the more-than-perfect, 100% free, pixel-perfect, deterministically-seeded, CSS Grid, no-GDS-fees seat map + live verified terminal. No paid API, no lock screen, no excuses. You have internet to GitHub (OurAirports), open-meteo.com, frankfurter.app, opensky-network.org, aviationstack.com free signup, Skyscanner RapidAPI free, Travelpayouts free. Use them. Focus on bulletproof code with comprehensive exception handling.

```

---
### HOW TO USE THIS MASTER PROMPT:

1. Select ALL text inside the code block above (from `YOU ARE AN ELITE...` to `...Use them.`)
2. Open a **NEW Arena chat** on branch `arena/c9a4da8c-spicyterminal`
3. **Paste as your first user message** — agent will execute Steps 0-11 autonomously, $0 only, with seat map UNLOCKED for users
4. Any extra keys are optional BYOK free keys — user gets value with zero signup via keyless APIs

### WHAT THIS MASTER GUARANTEES:
- ✅ Merges BOTH specs: SpicyTerminal God Mode + Flight Seat Map Utility Engine (hybrid free architecture, deterministic seeding, CSS Grid tube) in one prompt, zero conflicts
- ✅ 100% free — OurAirports public domain 86k, OpenSky 4000/day free, AviationStack 500/mo free, Open-Meteo no key, Frankfurter no key, Travelpayouts free, Skyscanner free tier only — never Pro/Ultra/Mega, never Duffel/Amadeus/FlightAware paid
- ✅ Pixel-perfect seat map: JSON matrix for 20+ aircraft, FNV-1a/MD5 seed, 72-91% load, window/aisle bias, CSS Grid with row number column + aisle gaps + wing shading + exit marks, :root variables (#E2E8F0, #93C5FD, #94A3B8, #FCD34D, #10B981), progress bar, legend, tooltip, mobile scroll
- ✅ Deterministic & persistent: identical inputs → identical maps, verified by test
- ✅ Seat map UNLOCKED for users — `SEAT MAP LOCKED — 9 MORE CLICKS` never shown (gate deleted), link always enabled, /seatmap draws immediately
- ✅ Offline-first, privacy-first, ES5, no animations, no new scrollbars, 27 tests green
- ✅ Expand airport DB free, booking links free deep links, badges honest provenance
- ✅ Cache + debounce + bbox = never exceed free limits

### AFTER PASTING, OPTIONAL ADD:
> "Start with Step 2 (unlock seatmap) and Step 4 keyless (Open-Meteo + Frankfurter + CO2) so I see instant value with zero keys, then add layouts + OpenSky bbox."

Want me to also commit this master as `PROMPT_MASTER_PERFECTION.md` and update `PROMPT_GOD_MODE_NEXT_CHAT.md` to this version now?
