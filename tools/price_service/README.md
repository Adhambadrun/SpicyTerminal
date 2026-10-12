# tools/price_service — the fare service behind the Seat Map PRICE button

The Seat Map page on the static site (no backend) shows a PRICE button on each
flight. Clicking it shows one short fare line, fetched from a small Python
service that lives in this directory. The service is stdlib-only, runs on
`http.server`, and is the only thing between the page and the Google Flights
scraper.

## What it does

- Validates `origin / destination / departure_date / cabin_class / currency / adults`
  server-side. Bad input → `400 {}`.
- One HTTP call to the scraper at `SCRAPER_BASE/flights/search-one-way?…`.
  Scraper down → `502 {}`. Scraper 4xx → `400 {}`. Scraper 5xx → `502 {}`.
- Trims the scraper reply to a small allowlist (the client never sees more).
- Translates Google's `price_insights` into one of `low` / `typical` / `high`.
- Returns `200 {ok:false, kind:"no_fare"}` when the scraper succeeded but had
  no fares, so the page can say "no fare came back" rather than "the service
  is broken".
- CORS is an exact-string match against `PRICE_ALLOW_ORIGINS`, comma-separated.
  No wildcards, no prefixes.
- No upstream text, no tracebacks, no booking_token, no emissions, no
  co2_kg, no baggage, no layovers, no airport names on the wire.

## Run

Local development, against the scraper on the same machine:

```bash
SCRAPER_BASE=http://127.0.0.1:8000 \
PRICE_ALLOW_ORIGINS=http://localhost:4173 \
    python3 price_api.py            # 0.0.0.0:8787
```

Health check:

```bash
curl -s http://127.0.0.1:8787/healthz
# {"ok":true}
```

A real fare (JFK → LAX, 12 Nov 2026, economy, 1 adult):

```bash
curl "http://127.0.0.1:8787/api/flights/price?origin=JFK&destination=LAX&departure_date=2026-11-12&cabin_class=economy&currency=USD&adults=1"
# {"ok":true,"source":"Google Flights","amount":249,"currency":"USD",
#  "fetchedAt":"2026-10-12T08:34Z","verdict":"low",
#  "summary":"Delta · DL 1788 · nonstop · 6h 8m",
#  "scope":"The fare for this flight, economy, on 2026-11-12."}
```

The reply is the entire surface a client can ever see. There is no other
endpoint.

## Self-test (no network)

```bash
python3 price_api.py --self-test
# RESULT: 31 passed, 0 failed
```

The 31 checks cover validation, trimming, the verdict heuristic, the summary
builder, and the HTTP handler in isolation (a stubbed scraper, stubbed socket,
real `BaseHTTPRequestHandler` method bodies). No outbound calls.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `SCRAPER_BASE` | `http://127.0.0.1:8000` | the Google Flights scraper URL |
| `PRICE_ALLOW_ORIGINS` | (none) | comma-separated exact origins that may call the service |
| `PRICE_HOST` | `0.0.0.0` | bind address |
| `PRICE_PORT` | `8787` | bind port |
| `PRICE_SCRAPER_TIMEOUT` | `30` | seconds before the scraper call gives up |
| `PRICE_VERBOSE` | (off) | `1` to log every request to stderr |

`PRICE_ALLOW_ORIGINS` is an exact-string allowlist, not a pattern. Set it to
the browser origin(s) the page actually loads from — for the local preview
that is `http://localhost:4173`, for the live preview host it is the
`https://<port>-<sandbox>.e2b.app` origin. Multiple origins are comma-separated.

## Deploy

The scraper wants an always-on container with Google Chrome and ~1 GB of
`/dev/shm`. The archive's `Dockerfile` / `docker-compose.yaml` already do this
(`shm_size: 1gb`). Render, Railway, Fly.io or a small VPS all work.

Do **not** use Netlify or Vercel functions — no Chrome, cold starts, hard
execution caps. The scraper cannot run on a function platform.

Run the scraper and `price_api.py` together in the container. Bind the scraper
to `127.0.0.1:8000` and bind `price_api.py` to the public interface on
`:8787` (or behind a TLS-terminating proxy on `:443`). Expose only
`price_api.py` to the internet; the scraper is internal.

`PRICE_ALLOW_ORIGINS` must list the real origins of the deployed site.

## Guarantees the service keeps

- It cannot take anyone's money. It has no `booking_token`, no `url`, no
  inventory — only the published price.
- It cannot leak the scraper's identity. Errors return `{}`, never an
  upstream message.
- It cannot leak internal information about itself. The endpoint URL, port,
  status codes and JSON keys never reach the user; every failure on the
  client is one flat sentence.
- Conversion stays local. The Seat Map's `buildQuery()` sends only
  `origin / destination / departure_date / cabin_class / currency / adults`.
  Nothing about the converted itinerary, the passenger, or the seat map is
  forwarded.
- Standard library only. No `pip install` to run the service; the only
  requirement is Python 3.10+ for the modern type-hint syntax.
