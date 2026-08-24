# SpicyTerminal

Paste flights from Google Flights, airline sites, emails or screenshots —
get a perfect, copy-paste-ready **GDS Black Window itinerary**.

**[Open / Deploy](#deploy)** · Made by **Lamar Garcia** — BCFlights

## Why

One job, done perfectly. A deterministic offline engine — real IATA
aircraft codes, 12-hour GDS clocks, overnight markers, exact booking-class
handling, hidden-stop merging, one chronological ticket order. No
hallucinations, no re-rolling the dice. Optional Gemini AI handles messy
screenshots.

- 100% offline, private — itineraries never leave the browser
- `???` never appears as an aircraft; inferred values are disclosed
- Never drops a flight row silently
- AI failures keep the offline result

## Deploy

The whole app is one static file: `index.html`.

- **Netlify Drop**: drag this folder onto <https://app.netlify.com/drop>
- **Netlify from Git**: connect this repo, no build command,
  publish directory `.`

## Structure

| file | role |
|---|---|
| `index.html` | the app (everything inlined, build artifact) |
| `netlify.toml` | publish config |
| `assets/` | original logo images (favicon tile + wordmark source) |
| `instructions/` | step-by-step picture guide for the team (how to use + how to add the AI key) — `READ_ME_FIRST.txt` inside |
| `src/app.js` | UI logic (auto-convert, learn loop, fast image path) |
| `src/spicy_engine.js` | the conversion engine |
| `src/spicy_data.js` | airports / airlines / aircraft data (generated) |
| `src/index_template.html` | page template |
| `src/wordmark_alpha.png` | transparent-background wordmark (header + welcome) |
| `src/build_web.py` | assembles `index.html` from the sources above — `python3 src/build_web.py` |
| `src/test_engine.js` + `src/goldens.json` | parity tests vs the reference outputs — `node src/test_engine.js` |

## Privacy

No accounts, no cookies, no tracking, nothing is sent anywhere unless the
user presses the AI button with their own Gemini key (calls Google
directly, key stored only in the user's browser).
