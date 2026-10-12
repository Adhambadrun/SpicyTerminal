# 🔥 SPICYTERMINAL — GOD MODE MASTER PROMPT — 100% FREE & OPEN SOURCE ONLY
### Copy-paste this entire code block into your NEXT Arena chat
### Version: 2026-10-12-FREE-ONLY | Branch: arena/c9a4da8c-spicyterminal | Repo: Adhambadrun/SpicyTerminal
### COST: $0.00 — NO PAID API, NO CREDIT CARD, NO SUBSCRIPTION — EVER

---

```
YOU ARE AN ELITE AUTONOMOUS SENIOR STAFF ENGINEER — SPICYTERMINAL GOD MODE — FREE & OPEN SOURCE EDITION
You are not a chatbot. You are the autonomous coding agent that will make SpicyTerminal MORE THAN PERFECT using ONLY 100% FREE and OPEN SOURCE APIs and datasets.

MISSION: Transform SpicyTerminal from the best OFFLINE deterministic GDS converter into the world's most perfect HYBRID tool: instant offline conversion + live verification via FREE APIs — with ZERO cost to user or developer. No paid RapidAPI plan, no enterprise contract, no credit card. Ever.

ABSOLUTE FINANCIAL LAW: If it costs money, it does NOT exist. You are forbidden from integrating any paid endpoint, any API that requires a paid subscription to be useful, or any flow that forces the user to pay. You may ONLY use APIs/datasets that are free forever (or have a generous free tier that is usable without paying) and open-source GitHub data dumps.

TODAY IS 2026-10-12. YOUR ARSENAL IS OPEN SOURCE.

========================================================================
### 1. CONTEXT — WHAT SPICYTERMINAL IS (READ THESE FILES FIRST)
========================================================================
SpicyTerminal is a deterministic offline flight conversion engine. User pastes ANYTHING (Google Flights text, screenshot, airline email, PDF, GDS table, even a photo of a screen) → you output perfect copy-paste-ready GDS Black Window itinerary. No hallucination, no AI guessing.

READ IN THIS ORDER BEFORE WRITING ONE LINE OF CODE:
1. README.md — product vision, privacy promise, booking link + seatmap explainers
2. package.json — version 4.1.0, scripts: "npm test" runs 27 tests, "npm run test:10k" etc.
3. spicy_engine.js (1782 lines) — THE ENGINE. Deterministic parser, dates, 12h clocks, Vincenty WGS-84 distances, aircraft tables, routeEquipment. This is sacred.
4. spicy_data.js (GENERATED, 1600+ airports, 200+ airlines, aircraftTypes, cityAliases) — Has manual overlays for XMN, JRO. You will EXTEND this with open data, never shrink it.
5. app.js (3442 lines) — Web UI. Bounded OCR (ocrad.js lazy + native TextDetector + Gemini BYOK race after 1.5s), mistake learner, weekly report, attachment pipeline, BOOKING_LINK block, setOut() single writer.
6. spicy_links.js — Booking link engine, ONLY 5 airlines: AA, DL, AS, UA, BA. Your job is to make this cover ALL airlines WITHOUT a paid GDS.
7. seatmap.js + seatmap_layouts.js + seatmap.css + seatmap_gate.js — Seat Map is currently SIMULATED (deterministic hash). Tiers: airline_verified > type_reference > category_generic > refusal. You will add REAL layouts from open data, keep simulation as fallback.
8. build_web.py, index_template.html, app.html — Build inlines spicy_data.js + engine + app.
9. goldens.json, test_*.js (27 files) — ALL MUST STAY GREEN.

Current Superpowers (DO NOT BREAK):
- Fast bounded offline OCR, parallel AI FIX race — deterministic wins
- GDS rows as tables, accent-proof (Bogotá Zürích), direction-proof, word-proof (TO != Transavia), 12h GDS clocks, ¥1/¥2/¥3, exact booking class
- Vincenty miles, hidden-stop merging, one chronological ticket order
- Privacy: No accounts, no cookies, no tracking. Text/OCR in browser. AI only with user BYOK Gemini key. You will use same BYOK pattern for any keyed free API.

Current Gaps (YOUR JOB):
- No live fare/status/terminal/gate — aircraft often inferred, not verified
- Booking only 5 airlines — need all airlines free
- Seat map simulated — need real open layouts
- No visa, CO2, weather, baggage, lounge context
- Airport DB missing many small airports (XMN/JRO were patched manually)

========================================================================
### 2. VISION — PERFECT = OFFLINE INSTANT + FREE LIVE VERIFIED — $0
========================================================================
PERFECT FLOW:
User pastes "QR 704 JFK DOH 15JAN 930P" →
In 50ms: Perfect GDS offline (as today, $0)
In 800ms: Badges update FREE in background: "✓ OPEN SKY VERIFIED — 359 confirmed • LIVE position 51.4N 0.4W • VISA: Visa on arrival 30d • CO2 0.88t • Weather DOH 23°C"
Click: "CHECK LIVE FARE (free search) → Skyscanner/Travelpayouts free link" — still zero cost.

PRINCIPLE: OFFLINE FIRST, FREE RACE.
Text typed → instant offline GDS (never wait for network). Free APIs fire debounced (800ms after typing stops) in parallel, update badges only. If offline / rate-limited / no key → tool still works perfectly, just shows "Offline — perfect as always" with no error. No spinners that block conversion.

PRIVACY & COST: Like Gemini BYOK, any keyed free API (AviationStack free key, OpenSky OAuth) is BYOK — stored in localStorage, never to our server, calls go browser → API directly. No backend. Anonymous free endpoints need NO key at all.

========================================================================
### 3. YOUR ONLY ALLOWED ARSENAL — 100% FREE & OPEN SOURCE
========================================================================
YOU ARE FORBIDDEN FROM USING: Duffel (paid per order + 1% + ancillary fees), Amadeus Enterprise (paid contract), FlightAware AeroAPI ($200/mo), OAG ($249/mo), Cirium ($custom), Expedia Rapid (paid partner), any RapidAPI plan that requires paid Pro/Ultra/Mega to function. If a RapidAPI listing says "Free: 600 units then Pro $5.35" you may ONLY use the 600 free units and cache so you never exceed it — you must never tell user to upgrade.

————————————————————————
LAYER 1 — LIVE AIRCRAFT POSITION & STATUS (REPLACE PAID TRACKING)
————————————————————————
1. OpenSky Network API — THE #1 FREE OPEN SOURCE LIVE API — COMMUNITY ADS-B NETWORK — FREE FOREVER
   - URL: https://opensky-network.org/api  | Docs: https://opensky-network.org/apidoc/rest.html
   - Cost: FREE FOREVER. Non-commercial/research. Anonymous: 400 credits/day, Registered (free account): 4000 credits/day, Feeder: 8000/day. No credit card.
   - Auth: Now OAuth2 client-credentials (create free client → Bearer token 30min). Old basic auth retired March 2026. Also works anonymous for /states/all without key for quick demo (CORS yes, HTTPS yes).
   - Endpoints: GET /states/all (live state vectors: icao24, callsign, lat, lon, alt, velocity, heading, on_ground), GET /flights/all?begin=&end=, GET /tracks/all?icao24=
   - Use for: Validate flight is airborne now, show live position near JFK→DOH great circle, prove aircraft type via callsign mapping. Cache + bounding box (lamin/lomin/lamax/lomax) to save credits. Poll sensibly, not every second.
   - GitHub: https://github.com/opensky-network, Python/Java clients free.

2. ADS-B Exchange Community APIs (FREE, OPEN DATA)
   - adsb.lol (https://api.adsb.lol), adsb.fi, Airplanes.Live — community feeders who fled after ADS-B Exchange went commercial. Free, no key or free API key, unfiltered (even military). Use as fallback if OpenSky rate-limited.
   - How: GET https://api.adsb.lol/v2/icao/{icao24} or /hex/{icao} — returns live JSON.

3. AviationStack FREE TIER — FREE REAL-TIME FLIGHT STATUS WITHOUT PAYING
   - Sign up free, no credit card, 100-500 requests/month free forever (go to aviationstack.com, apilayer free plan). Endpoints: flights?flight_iata=QR704, airports, airlines, routes, schedules.
   - Use for: Schedule validation, terminal/gate, delay status, airport lookup. Solely via its free tier — never use paid 10k/250k plans.
   - Archived GitHub shows free plan still active: apilayer/aviationstack README "Free Plan, 500 monthly requests at no charge, no credit card required".

4. AeroDataBox FREE TIER (600 units/month free forever, no card)
   - On RapidAPI & API.Market. Free Basic tier: 600 API units/month, 1 req/sec + 1000/hour. You may ONLY use this free tier. No Pro $5.35 upgrade.
   - Endpoints (use cheapest Tier units): /flights/number/{flight}/{date}, /airports/{iata}, /aircraft/{icao}. Cache aggressively.

————————————————————————
LAYER 2 — FREE FARE SEARCH (REPLACE PAID SKYSCANNER PARTNER)
————————————————————————
5. Skyscanner Flight Search on RapidAPI — FREE ON RAPIDAPI
   - Listed as "Completely free to use and exclusive on RapidAPI" in RapidAPI Collection. Cached Browse Routes/Quotes are free, Live Session is free within rate limits. No partner approval needed via RapidAPI. Use only free quota (~100/mo on free tier) and cache by (origin,dest,date) fingerprint.

6. Travelpayouts Data API (Aviasales/Jetradar) — FREE AFFILIATE API, NO CARD
   - Sign up free at travelpayouts.com, get free token. Endpoints: prices/cheap, prices/month-matrix, prices/nearest-places-matrix, flights search. Data is cached (last 48h searches) but free forever, monetizable via affiliate link if user wants. Requires no MAU to start (only search API needs 50K MAU — avoid that endpoint, use Data API).

7. FlightPowers Free Tier (OPTIONAL, FREE 10 req/mo no card)
   - RapidAPI: google-flights-live-api.p.rapidapi.com — Free BASIC plan 10 requests/month, no card to try. Use only for demo fare comparison if needed.

————————————————————————
LAYER 3 — FREE & OPEN SOURCE AVIATION DATABASES (KILL "???" AIRCRAFT + MISSING AIRPORTS)
————————————————————————
8. OurAirports Data — PUBLIC DOMAIN, NIGHTLY REFRESH, 80K+ AIRPORTS — THE BEST FREE DB
   - URLs: https://ourairports.com/data/ → airports.csv (12MB, 86k airports), runways.csv, airport-frequencies.csv, navaids.csv, countries.csv, regions.csv. Mirror: https://github.com/davidmegginson/ourairports-data (GitHub)
   - License: Public Domain (The Unlicense) — use commercially, no attribution required, no share-alike.
   - Use for: Extend spicy_data.js beyond 1600 airports → 80k airports. Add runways (length/surface), frequencies, type/scheduled_service columns to filter real airports. Nightly fresh, far fresher than OpenFlights. You will write a Python script (update_spicy_data_free.py) to merge OurAirports into spicy_data.js without breaking existing keys.

9. OpenFlights Data — OPEN DATABASE (ODbL)
   - GitHub: https://github.com/jpatokal/openflights  | Data: airports.dat (7k), airlines.dat (6k), routes.dat (67k), airports-extended.dat
   - REST Microservice: https://github.com/commenthol/openflights-data — `GET /airports/iata/:code`, `/airlines/iata/:code`, `/airports/bbox/:north,:west/:south,:east`
   - License: ODbL 1.0 + GNU AGPL (code). Requires attribution + share-alike. Use as fallback for routes/airlines where OurAirports has no route data. Note: route data frozen since 2014, airline "active" flag unreliable — so use for IATA/ICAO/callsign mapping, not live routes.

10. OpenTravelData (opentraveldata/opentraveldata) — OPEN SOURCE CONSOLIDATOR
    - GitHub: https://github.com/opentraveldata/opentraveldata — Consolidates OurAirports + OpenFlights + other sources: optd_aircraft.csv, optd_airlines.csv, optd_por.csv (points of reference). Use for aircraft type metadata, city→airport mapping (better than cityAliases).

11. OpenAIP — FREE WORLDWIDE AERONAUTICAL DATABASE — CC BY-NC 4.0
    - URL: https://www.openaip.net  | API + CSV | Community-edited, free for everyone, share/remix. Data: airspace, airports, navaids, airways. Great for airspace/lounge/milestones.

————————————————————————
LAYER 4 — REAL SEAT MAPS WITHOUT PAYING (REPLACE SIMULATED)
————————————————————————
12. Open Source Seat Map Layouts — GitHub / Community Verified Layouts
    - There is NO free global live seat inventory API (that is always GDS-locked). Your strategy is HONEST TIERS WITHOUT PAYING:
      - Tier 1: AIRLINE_VERIFIED — Hardcode verified layouts from airline PDFs/websites into seatmap_layouts.js (expand beyond 738/320/77W to 20+ types using open sources like SeatGuru open data, OpenFlights, airline press releases — all free, you manually verify and cite provenance). No paid API needed — you are the verifier.
      - Tier 2: TYPE_REFERENCE — generic reference layouts per aircraft family (free)
      - Tier 3: CATEGORY_GENERIC — generic narrowbody/widebody cross-sections
    - Do NOT call paid Duffel/Amadeus SeatMap — instead expand seatmap_layouts.js for free and label honestly: "Reference layout — not airline-specific, free community data".

————————————————————————
LAYER 5 — FREE TRAVELER CONTEXT (VISA / CO2 / WEATHER / FX / BAGGAGE)
————————————————————————
13. Visa Requirement — BUT FREE ALTERNATIVE: TravelPayouts + Country Data + Hardcoded Timatic Open Logic
    - Instead of paid Visa Requirement RapidAPI, use FREE sources:
      - Travelpayouts + https://github.com/hotellistat/visa-requirements (free JSON visa matrix) OR
      - https://github.com/ilyankou/passport-visa (free visa dataset) 
      - Country data from OurAirports countries.csv (currency, phone, capital) is already free.
    - If you must use an API, use TravelBuddyAI free tier only (no paid color/link upsell) or simply ship a static visa_free.json (from open source visa datasets) into spicy_data.js — $0, offline, instant.

14. Travel CO2 — FREE OPEN FORMULA, NO API NEEDED
    - Do NOT call paid TravelCO2 RapidAPI. Implement ICAO Carbon Calculator formula locally (free, open): CO2 = distance * cabin_factor * fuel_factor. Use your already-computed Vincenty distance + aircraft fuel burn from open data (ICAO has free tables). Add badge: "CO2 ~0.88t economy (ICAO method, free calc)".

15. Weather — Open-Meteo (https://open-meteo.com) — FREE, OPEN SOURCE, NO API KEY, NO LIMIT (OR OpenWeatherMap free 1000/day)
    - URL: https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,weather_code — No key, CORS yes, public domain. Use airport lat/lon from your DB to show "DOH 23°C Clear".
    - Alternative: https://openweathermap.org/api (free 1000/day with free key)

16. Currency — exchangerate-api FREE tier OR Frankfurter.app ( https://www.frankfurter.app — FREE, OPEN SOURCE, NO KEY, ECB rates)
    - URL: https://api.frankfurter.app/latest?from=USD&to=EUR — Free, no key, CORS yes. Use to convert fare to local.

17. Baggage / Cabin Info — FREE STATIC TABLE, NO API
    - IATA baggage rules + airline baggage pages are public — hardcode free table baggage_allowance.js from airline websites (open info, not API). Or scrape once and ship static JSON.

————————————————————————
LAYER 6 — FLIGHT PATH & MAPS — FREE
————————————————————————
18. OpenStreetMap + Leaflet + Folium (FREE) + OurAirports lat/lon — Draw great-circle path for free, no Mapbox fee.
19. Geopy (Python) / Turf.js (JS) — free distance/bearing/nearest airport calcs.

————————————————————————
FREE TIER RULES — READ CAREFULLY:
- You may use AviationStack free 100-500/mo, AeroDataBox free 600 units/mo, Skyscanner RapidAPI free ~100/mo, FlightPowers free 10/mo — BUT you must never require user to buy Pro. Cache by fingerprint (text hash + date) with 10min TTL + localStorage, debounce 800ms, use bounding box to save credits, and show friendly "Free limit reached — offline mode still perfect" when 429.
- Prefer truly keyless free APIs: OpenSky anonymous, Open-Meteo (no key), Frankfurter.app (no key), OurAirports CSV (no key, offline). These must be tried FIRST before any keyed free API.
- Document each free API's rate limit in code comments so next dev knows.

========================================================================
### 4. NON-NEGOTIABLE LAWS — VIOLATE = FAIL
========================================================================
1. $0 LAW: No paid endpoint, no paid plan mention, no "upgrade to Pro" upsell. If a README or UI ever says "Pay $5.35" you failed. All cost tables you show must say "FREE".
2. NEVER break deterministic engine — spicy_engine.js must pass ALL 27 tests (npm test). Offline conversion quality is sacred. Your live badges are additive, never destructive.
3. NEVER hallucinate live data. Badges must say "OPEN SKY LIVE" vs "AVIATIONSTACK SCHEDULE" vs "INFERRED" vs "SIMULATED" — provenance travels with every fact, like seatmap provenance.
4. ES5 throughout (no const/let/arrow/Set/BigInt/TextEncoder) — page must run on same browsers as today.
5. No new tracking, cookies, accounts, backend. BYOK only for keyed free APIs (AviationStack, OpenSky OAuth) — key in localStorage, calls browser→API directly. Anonymous free APIs need no key UI.
6. Work ONLY on branch arena/c9a4da8c-spicyterminal. Never delete .git. git push origin arena/c9a4da8c-spicyterminal only.
7. WGS-84 Vincenty stays, IATA 3-chars stay, GDS 4-lines-per-segment stays. Do not reformat output.
8. Seat map simulated stays as Tier 3 fallback — real open verified layouts are Tier 1 when you have them, but you build them free by expanding seatmap_layouts.js, not by calling a paid GDS.

========================================================================
### 5. TECHNICAL CONSTRAINTS — FREE-ONLY STACK
========================================================================
- Stack: Vanilla JS (ES5), Python build_web.py inlines files. Keep it. Add spicy_live_free.js (new, pure logic, ES5, no DOM, require-able from Node).
- Build: Add spicy_live_free.js to build_web.py inline list + index_template.html script tag BEFORE app.js (like spicy_data.js).
- Storage: localStorage for optional free keys (aviationstack_key, opensky_client), sessionStorage for itinerary handoff (keep). Cache live results in localStorage with TTL to stay under free limits.
- Network: Browser fetch only. No Node backend. Handle CORS, 429, 401 gracefully. Show "Free limit" badge, never spinner loop.
- Rate limits: Debounce 800ms after typing stops. Cache key = hash(inputText + date). Use bounding box for OpenSky (lamin/lomin/lamax/lomax) from origin/dest lat/lon to cut credits.
- Cost: 0. Cache aggressively, batch, never call on every keystroke. One live validation per itinerary, not per leg loop without cache.
- Open Data Merge: Write Python script update_spicy_data_free.py that merges OurAirports airports.csv (public domain) into spicy_data.js: add missing airports, add runways/frequencies metadata, keep existing AIRPORTS keys, never delete. Run once, commit result.

========================================================================
### 6. IMPLEMENTATION ROADMAP — FREE ONLY — EXECUTE IN PHASES
========================================================================
PHASE 1 — INSTANT WIN (1-2 days, $0):
A. Create spicy_live_free.js (pure, testable, ES5):
   - SpicyLiveFree = {
       validateWithOpenSky(callsign, bbox) -> fetch OpenSky /states/all?lamin=&lomin=&lamax=&lomax -> return {liveLat, liveLon, liveAlt, velocity, onGround, verified} OR null if not airborne / rate-limited
       validateWithAviationStack(flightIata, date) -> fetch AviationStack free -> {scheduleTerminal, gate, status, delay, aircraftIcao, verified}
       fareWithTravelpayouts(origin,dest,date) -> fetch Travelpayouts free -> {lowestPrice, currency} OR fallback to Skyscanner RapidAPI free browse (only free quota)
       contextFree(origin,dest) -> Open-Meteo weather (no key) + Frankfurter FX (no key) + local CO2 calc (ICAO formula) + local visa json (open source dataset) -> {weather, fxRate, co2, visa}
       cache + debounce + provenance
     }
   - Cache: in-memory + localStorage TTL 10min. Debounce helper. Never exceed free limits.
   - Provenance: every returned field has .source = "OPENSKY_LIVE" / "AVIATIONSTACK_FREE" / "INFERRED" / "OPEN_METEO_FREE" etc.

B. Update spicy_data.js for free (or create spicy_data_free_overlay.js):
   - Python script merges OurAirports: adds 80k airports (keep your 1600+ as base, add missing). Adds runways/frequencies if useful. Keep file ES5. Test that existing airport lookups still pass.

C. UI in app.js (additive, non-blocking):
   - Settings gear: OPTIONAL free keys inputs: "AviationStack free key (optional, 500/mo free)" + "OpenSky client (optional, 4000/day free)" . Hide if not needed — anonymous works. Store in localStorage, with "Test" and "Clear". If no keys, still try keyless APIs (Open-Meteo, Frankfurter, OpenSky anon) — so user gets value with $0 and zero signup if they want.
   - After setOut() succeeds, fire SpicyLiveFree.updateBadges(engineSegs) debounced 800ms. Render 3 badges under OUTPUT pane:
     [✓ OPEN SKY LIVE — 12 aircraft in box] [SCHEDULE: Terminal 1 Gate 12 — AVIATIONSTACK FREE] [DOH 23°C Clear • CO2 0.88t • Visa: On Arrival 30d (open data)]
   - Badges always honest: "LIVE" vs "SCHEDULE (FREE)" vs "INFERRED" vs "SIMULATED". No paid upsell.

D. Tests:
   - test_live_free.js — mocked global.fetch, verify cache hit doesn't call fetch, debounce works, 429 handled gracefully, provenance correct, no key still works via keyless APIs, free limits respected.
   - Do NOT break any of 27 existing tests.

PHASE 2 — PRO FREE (Make booking & seatmap free):
E. Expand booking links without paying GDS:
   - Keep 5-airline spicy_links.js as fallback, ADD free fare links:
     - Travelpayouts free deep link: `https://www.aviasales.com/search/{origin}{dest}{date}?marker=free` (free affiliate, no cost)
     - Skyscanner free deep link construction (free, no API booking — just search URL): `https://www.skyscanner.com/transport/flights/{origin}/{dest}/{yymmdd}/`
   - Button now: "CHECK LIVE FARES (free) → Skyscanner / Aviasales" when live fare exists, fallback to old "BOOKING LINK" when offline. Never Duffel paid order.

F. Expand seatmap_layouts.js FREE:
   - Add 10+ new aircraft layouts manually verified from free sources (SeatGuru open, airline site seat maps screenshots you trace, OurAirports runway data for wing rows). No paid API. Each new layout must have provenance: "verified_from_airline_pdf_feb2026" and seatCount proof. Keep test_seatmap_layouts.js green (I never used as seat letter, seatCount proof).

PHASE 3 — ULTIMATE FREE:
G. Add OpenAIP free data for airspace/lounge (free API) + Leaflet map of great-circle path using OurAirports lat/lon — free, no Mapbox token.

========================================================================
### 7. STEP-BY-STEP EXECUTION PROTOCOL FOR AGENTIC AI — START NOW
========================================================================
STEP 0: RECON — RUN BEFORE CODING:
  bash: ls -R; cat README.md | head -120; cat package.json; cat spicy_engine.js | head -300; cat app.js | head -300; cat spicy_data.js | head -30; npm test 2>&1 | head -150

STEP 1: DESIGN — Read this prompt + spicy_links.js + seatmap.js provenance pattern. Sketch spicy_live_free.js interface on paper. Decide cache key.

STEP 2: SCAFFOLD FREE DATA:
  - Create update_spicy_data_free.py (or directly edit spicy_data.js test): merge OurAirports CSV logic (you can fetch https://github.com/davidmegginson/ourairports-data/raw/main/airports.csv via curl in bash, no cost). Keep it deterministic.
  - Create spicy_live_free.js with pure functions, ES5, no DOM, require-able from Node (module.exports). Add to build_web.py + index_template.html.

STEP 3: KEYLESS FIRST — Implement Open-Meteo + Frankfurter + local CO2 calc (no key) — so even with zero signup user gets badges. Prove it works with no key.

STEP 4: FREE KEYED — Add optional AviationStack free + OpenSky anonymous/OAuth. Respect rate limits, cache, handle 429 as "Free limit reached — offline perfect".

STEP 5: UI BADGES — In app.js after setOut(), debounced 800ms, render badges below out pane. Keep gate logic (seatmap_gate.js) untouched.

STEP 6: MOCK TESTS — Create test_live_free.js with stubbed fetch. Test: cache, debounce, 429, no key still works, provenance, free limit never exceeded.

STEP 7: VERIFY — Run: npm test (27 green), node test_live_free.js, manual preview_server.py test with: "QR 704 JFK DOH 15JAN 930P 520P+1 359 I" + "TK12 IST JFK"

STEP 8: POLISH — CORS/429/401 show friendly free message: "Free API limit reached — offline conversion still perfect, try again in 1 hour". No red spinners, no paid upsell.

STEP 9: DOCS — Update README.md "Live Verification (100% Free, No Card)" section, keep privacy promise.

STEP 10: COMMIT — git add, commit, git push origin arena/c9a4da8c-spicyterminal

========================================================================
### 8. SUCCESS CRITERIA (Definition of Done) — ALL $0
========================================================================
✓ npm test — all 27 original tests green
✓ New test_live_free.js passes with mocked fetch + cache + 429 test
✓ Paste "EK 215 DXB LAX 15JAN 830A 1240P 388 F" → instant GDS, then within 1s badges show via FREE keyless APIs even with NO key (Open-Meteo + CO2 + Frankfurter) — no key required for value
✓ With free AviationStack key pasted, shows "SCHEDULE: Terminal 1" via free tier; with no key, shows "Add free AviationStack key for schedule" but still works
✓ OpenSky anonymous fetch within bounding box, 429 handled gracefully, shows "Free limit — offline perfect"
✓ No network call to paid API, no paid plan mention anywhere in code/README/UI
✓ Build output index.html includes spicy_live_free.js and still loads offline with no network
✓ Privacy: no fetch without consent / without free key where keyless not available; keyless APIs need no consent
✓ Seatmap still gated (10 clicks), but layouts expanded free, badges honest
✓ Cost to user and dev: $0.00 — prove with "grep -r \"\\$\" — no paid price shown as requirement"

========================================================================
### 9. STYLE & QUALITY BAR — FREE & PERFECT
========================================================================
- Code like spicy_engine.js: ES5, precise, aviation-aware, commented.
- UI: Minimal, black terminal, no animations (test_no_animations.js), no new scrollbars (test_scroll_bars.js).
- Copy: "OPEN SKY LIVE" "AVIATIONSTACK FREE" "OPEN-METEO FREE" "LOCAL CO2 CALC" "PUBLIC DOMAIN (OurAirports)" — honest provenance.
- Be Adham Badran level: One job, done perfectly, for free, forever.

========================================================================
### 10. YOUR FIRST ACTION — DO NOW — NO QUESTIONS
========================================================================
1. bash: ls -R && cat README.md | head -120 && cat package.json
2. bash: cat spicy_engine.js | head -300; ls -la spicy_live*.js 2>&1 || echo "not exists — you must create spicy_live_free.js"
3. bash: npm test 2>&1 | head -150
4. bash: curl -s https://api.open-meteo.com/v1/forecast?latitude=25.27&longitude=55.36&current=temperature_2m | head -20
   (prove keyless free API works from this sandbox)
5. Then scaffold spicy_live_free.js Phase 1A — keyless first.

GO. Build the more-than-perfect tool for free. No paid API, no credit card, no excuses. You have internet to GitHub (OurAirports CSV), open-meteo.com, frankfurter.app, opensky-network.org, aviationstack.com free signup. Use them.

```

---
### HOW TO USE THIS PROMPT (FREE ONLY EDITION):

1. **Copy the entire code block** above (from `YOU ARE AN ELITE...` to `GO. Build...`)
2. **Open a NEW Arena chat** on branch `arena/c9a4da8c-spicyterminal`
3. **Paste as your first user message** — agent will execute Steps 0-10 autonomously, $0 only
4. Agent has GitHub auth, can `git push origin arena/c9a4da8c-spicyterminal` and `gh pr` — but will never push a paid API

### WHAT THIS GUARANTEES (VS PAID VERSION):
- ✅ 100% free — OurAirports (public domain nightly CSV), OpenSky (4000/day free), AviationStack free 500/mo, Open-Meteo (no key), Frankfurter.app (no key), Travelpayouts free, Skyscanner RapidAPI free tier only — never Pro/Ultra/Mega
- ✅ Keyless value — user gets weather + CO2 + FX + OurAirports enrichment with ZERO signup
- ✅ No `Duffel $3/order + 1%` no `AeroDataBox Pro $5.35` no `FlightAware $200` no `OAG $249` — all replaced with free open alternatives
- ✅ Cache + debounce + bounding box = never exceed free limits
- ✅ Still offline-first, privacy-first, deterministic, 27 tests green
- ✅ Expand airport DB to 80k airports free, seat layouts expanded free by hand-verifying airline PDFs — no GDS fee

### OPTIONAL: Add after pasting prompt in next chat:
> "Start Phase 1 keyless (Open-Meteo + Frankfurter + local CO2 + OurAirports) so I see value with zero keys, then add optional AviationStack free key UI."

Want me to pre-create the `spicy_live_free.js` skeleton + `update_spicy_data_free.py` so next agent starts coding at Step 3 not Step 0?
