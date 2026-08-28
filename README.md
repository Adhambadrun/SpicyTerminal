# SpicyTerminal

Paste flights from Google Flights, airline sites, emails or screenshots —
get a perfect, copy-paste-ready **GDS Black Window itinerary**.

**[Open / Deploy](#deploy)** · Made by **Adham Badran** — SpicyTerminal

## Why

One job, done perfectly. A deterministic offline engine — real IATA
aircraft codes, 12-hour GDS clocks, overnight markers, exact booking-class
handling, hidden-stop merging, one chronological ticket order. No
hallucinations, no re-rolling the dice.

- **Pics now 100% offline, no AI, instant fast as hell**: screenshots convert pure offline with zero AI key needed in under a second.
- **AI mistake detection & self-learning**: AI detects discrepancies and teaches the tool to fix them automatically on future conversions.
- **Smart fallback**: Only falls back to AI in case an unreadable or handwritten screenshot cannot be detected offline.
- **Reliable attachments**: `+ ATTACH`, drag-and-drop, and clipboard screenshots share one queue; image extensions are detected even when a browser supplies no MIME type, multiple images are parsed together in order, and stale work cannot overwrite a cleared request.
- **Text and PDF attachments**: `.txt`, `.eml`, `.csv`, `.json`, `.html`, `.ics`, and similar text exports are read instantly; PDFs are passed to AI only when the user explicitly supplies a Gemini key.
- **Weekly report**: One-click weekly performance and enhancement reports sent to `adhambadraan@gmail.com` to improve and enhance the tool to the max.
- 100% offline, private — itineraries and screenshots never leave the browser.
- `???` never appears as an aircraft; inferred values are disclosed.
- Never drops a flight row silently.

## Deploy

The whole app is one static file: `index.html`.

- **Netlify Drop**: drag this folder onto <https://app.netlify.com/drop>
- **Netlify from Git**: connect this repo, no build command, publish directory `.`

## Structure

| file | role |
|---|---|
| `index.html` | the app (everything inlined, build artifact) |
| `netlify.toml` | publish config |
| `ocrad.js` | pure offline OCR engine bundled locally |
| `app.js` | UI logic (offline image parser, auto-convert, AI mistake detector & self-learning) |
| `spicy_engine.js` | the conversion engine |
| `spicy_data.js` | airports / airlines / aircraft data |
| `index_template.html` | page template |
| `wordmark_alpha.png` | transparent-background wordmark (header + welcome) |
| `build_web.py` | assembles `index.html` from the sources above — `python3 build_web.py` |
| `test_engine.js` + `goldens.json` | parity tests vs the reference outputs — `node test_engine.js` |
| `test_big_wide.js` | wide test suite across 156 checks |
| `test_very_wide.js` | 5,000 random online flight test suite |

## Privacy

No accounts, no cookies, no tracking, nothing is sent anywhere unless the
user explicitly uses the AI fallback with their own Gemini key.
Weekly reports and bug reports open directly in the user's email client to `adhambadraan@gmail.com`.
