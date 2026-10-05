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
  not know yet (IberoJet `OB`) is still read instead of dropped.
- **`AI FIX` — the repair button, not the default path**: pasting converts on its own, no click needed.
  When that automatic offline pass cannot read an image (handwritten, cropped, garbage-scanned) or only
  half-reads it, `AI FIX` re-reads the same input with Gemini and repairs the result; the deterministic
  answer still wins whenever both succeed. (The previous label read like a mode switch, which made
  people wait for an "auto" that had already run and come back empty.)
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
- **Weekly report**: One-click weekly performance and enhancement reports sent to `adhambadraan@gmail.com` to improve and enhance the tool to the max. Each report covers one week (Monday 00:00 UTC → now), compares it with the previous week, and keeps a separate lifetime total — a closed week is archived, never mixed into the current one. A *conversion* is a result shown to the user: live re-renders while typing and AI replies the direct read beat are counted as neither.
- **About, in one click**: the `About` link leads the status row (`About / Booking Link / Generate Api /
  Weekly Report / Seat Map / Report a bug`) and opens a dialog that says what the engine does, what it
  deliberately refuses to do, and who built it — no marketing, no fluff, `Esc` closes it and
  focus goes back where it was.
- **Booking checkout links**: a `BOOKING LINK` control sits next to About and lights green for a
  complete, certain itinerary on one bookable airline — American, Delta, Alaska, United or
  British Airways, one or several legs — using `spicy_links.js`, the link engine ported from the
  production Spicy Link Generator. American links pin every flight through aa.com metasearch;
  Delta trip summaries and Alaska planbook links carry every leg (plus an estimated price);
  United and British Airways links carry the route(s) and dates without pinning exact flights.
  A mixed-airline itinerary links only when exactly one of its airlines is bookable, and the
  disclosure says that only that airline's legs are linked. One click copies the URL and opens
  the external search or prefilled summary for one adult in one tab; it never books or
  purchases, and stays disabled for partial, invalid, uncertain, unsupported, mixed-bookable,
  or stale input. There is no Google Flights fallback.
- **Seat Map preview**: the status-row link sits between Weekly Report and Report a bug, deliberately dimmed while the feature is under development — it only opens `/seatmap` (with the under-development notice) after ten consecutive clicks, and a slower click restarts the count. The viewer uses static aircraft layouts and browser-generated sample availability; the 30-second refresh is simulated, no airline API is called, and selecting a seat never reserves it.
- **Terminal boot animation**: the workspace panes slide in with a quick scanline sweep, the
  ready indicator gently pulses, and the motion automatically turns off for reduced-motion users.
- **Per-line glow bars**: both windows light up line by line — every visible line of INPUT
  carries a cool-blue glowing bar and every line of OUTPUT a terminal-green one. A change
  (keystroke, paste, drop, new result) ignites them one after another so the light visibly
  walks the window, and between changes the same bars keep drifting in a slow wave, so the
  panes stay alive instead of going dark. A strip on an empty line only shimmers, and the
  bars follow resize, rotation, the phone keyboard and scrolling. Reduced-motion users get
  a quiet static glow instead of any animated sweep.
- **OUTPUT always scrolls**: a long itinerary scrolls inside its own window — wheel, keys,
  touch and drag-select. The result's print animation used to leave a text-clipped
  background (`background-clip:text`) on that window, which is the browser bug that can stop
  a scrolling element dead. The whole print is now carried by a short-lived class that app.js
  takes off again the moment the effect ends — and the glyph streak inside it is skipped
  entirely while the window can scroll, and for reduced-motion users — so what you scroll is
  a plain, native scrollport with no clipped paint or leftover filter on it.
- **INPUT wears the OUTPUT scrollbar**: both windows speak one scrollbar language — thin,
  terminal green, on a dark track (the INPUT textarea used to keep whatever bar the browser
  ships). Both bars are always drawn: there is no switch to hide them, and scrolling itself
  is plain native behaviour — wheel, arrow keys, PageUp/PageDown, drag-select and touch.
- Conversion and screenshot OCR run in the browser. A `BOOKING LINK` click opens an external airline search or prefilled summary for one adult and shares the itinerary details with that site — flight numbers, routes and dates (American, Delta and Alaska links; Delta and Alaska also carry an estimated price), or routes and dates only (United, British Airways). It never books or purchases automatically.
- `???` never appears as an aircraft; inferred values are disclosed.
- Never drops a flight row silently.

## Deploy

The app remains static and is built by `npm run build` into self-contained
`public/index.html` and `public/seatmap.html` pages (`index.html` and `app.html`
are also written to the repo root). The `/seatmap` rewrite is configured for Vercel and Netlify. For a local preview, run `npm run build && npm run dev`; the lightweight Python server mirrors the same route.

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
| `seatmap.js` / `seatmap.css` | local Seat Map preview; static aircraft layouts and visibly simulated seat statuses, inlined by the build |
| `spicy_engine.js` | the conversion engine |
| `spicy_links.js` | booking checkout link engine (AA / DL / AS / UA / BA), ported from the Spicy Link Generator; feeds the BOOKING LINK button |
| `spicy_data.js` | airports / airlines / aircraft data |
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
| `test_lax_man.js` | LAX–MAN round-trip regression (no phantom TO 105, Manchester is MAN not MHT) — `node test_lax_man.js` |
| `test_mistake_learner.js` | self-learning safety + GDS re-paste regression for the 2026-09-07 weekly report — `node test_mistake_learner.js` |
| `test_about_dialog.js` | About dialog: exact `About` label, focus trap, ESC/backdrop close, and that opening it cannot disturb a conversion — `node test_about_dialog.js` |
| `test_booking_link.js` | per-airline checkout handoffs (AA / DL / AS / UA / BA), multi-leg and mixed-airline gating, unsupported-carrier refusals, stale-input/warning protections, and one-tab/one-copy behavior — `node test_booking_link.js` |
| `test_seatmap.js` | sample layout counts, deterministic simulated availability, accessibility/disclosure markup, `/seatmap` route, and local exports — `node test_seatmap.js` |
| `test_seatmap_gate.js` | the dimmed Seat Map button only opens after ten consecutive clicks: countdown copy, gap reset, unlock reset, and the gate/dim shipping in the built pages — `node test_seatmap_gate.js` |
| `test_ai_fix_label.js` | the AI FIX label is on the button and in every user-facing hint, with no legacy name left in the chrome, and the id stays `btnAi` — `node test_ai_fix_label.js` |
| `test_jro_kilimanjaro.js` | TK AMS–IST–JRO–IST–AMS GDS re-paste regression (2026-09-10 report): Kilimanjaro `JRO` overlay, glued `¥1` marker, `7M8` equipment, and unknown-code numbered table rows surviving instead of being mangled — `node test_jro_kilimanjaro.js` |
| `test_weekly_report.js` | weekly-report counters: week rollover, what counts as a conversion, blocked pop-up — `node test_weekly_report.js` |

## Privacy

No accounts, no cookies, no tracking. Text conversion and screenshot OCR run in the browser;
those inputs are not uploaded by the local conversion path. A `BOOKING LINK` click explicitly
opens an external airline search or prefilled summary for one adult and shares the itinerary
details with that site — flight numbers, routes and dates (American, Delta and Alaska links;
Delta and Alaska also carry an estimated price), or routes and dates only (United, British
Airways). The links never book or purchase automatically. The AI fallback sends the user-selected content only when
the user explicitly provides and uses their own Gemini key. Weekly reports and bug reports open
in the user's email client to `adhambadraan@gmail.com`. The Seat Map is an in-development preview: it calls no airline API, and layouts, seat statuses, and 30-second refreshes are simulated locally. Selecting a sample seat never reserves or books anything.
