# SpicyTerminal

Paste flights from Google Flights, airline sites, emails or screenshots —
get a perfect, copy-paste-ready **GDS Black Window itinerary**.

**[Open / Deploy](#deploy)** · Made by **Adham Badran** — SpicyTerminal

## Why

One job, done perfectly. A deterministic offline engine — real IATA
aircraft codes, 12-hour GDS clocks, overnight markers, exact booking-class
handling, hidden-stop merging, one chronological ticket order. No
hallucinations, no re-rolling the dice.

- **Fast, bounded offline screenshots**: OCR is lazy-loaded, uses a worker where available, caps oversized frames, and has a short native-OCR deadline—so a stalled scanner cannot leave the app spinning forever.
- **AI mistake detection & self-learning**: AI detects discrepancies and teaches the tool to fix them automatically on future conversions.
- **Smart fallback**: Only falls back to AI in case an unreadable or handwritten screenshot cannot be detected offline.
- **Reliable attachments**: `+ ATTACH`, drag-and-drop, and clipboard screenshots share one queue; image extensions are detected even when a browser supplies no MIME type, multiple images are parsed together in order, and stale work cannot overwrite a cleared request. Each screenshot has a small red `×` remove button, can be clicked to review full-size, and can also be removed from the review screen.
- **Text and PDF attachments**: `.txt`, `.eml`, `.csv`, `.json`, `.html`, `.ics`, and similar text exports are read instantly; PDFs are passed to AI only when the user explicitly supplies a Gemini key.
- **Weekly report**: One-click weekly performance and enhancement reports sent to `adhambadraan@gmail.com` to improve and enhance the tool to the max.
- 100% offline, private — itineraries and screenshots never leave the browser.
- `???` never appears as an aircraft; inferred values are disclosed.
- Never drops a flight row silently.

## Deploy

The whole app is one static file, built by `npm run build` into
`public/index.html` (an offline copy is also written to the repo root).

- **Vercel**: import this repo — `vercel.json` already sets the build command
  and output directory, so every `git push` to `main` deploys automatically.
- **Netlify from Git**: connect this repo — `netlify.toml` builds and
  publishes `public/`.
- **Netlify Drop**: drag the generated `index.html` onto <https://app.netlify.com/drop>

Only the single built file is ever deployed; repository screenshots, sources
and archives are never shipped.

## Structure

| file | role |
|---|---|
| `index.html` | the app (everything inlined, offline build artifact) |
| `public/` | deploy output (built, git-ignored) |
| `vercel.json` | Vercel build + output-directory config |
| `netlify.toml` | Netlify build + publish config |
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
| `test_offline_images.js` | OCR cleaner + real-image OCR speed tests |
| `test_attachment_pipeline.js` | end-to-end attachment pipeline tests (drop / paste / picker / PDF / HEIC / cache) |

## Privacy

No accounts, no cookies, no tracking, nothing is sent anywhere unless the
user explicitly uses the AI fallback with their own Gemini key.
Weekly reports and bug reports open directly in the user's email client to `adhambadraan@gmail.com`.
