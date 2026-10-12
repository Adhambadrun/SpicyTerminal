#!/usr/bin/env python3
"""tools/price_service/price_api.py — the fare service behind the PRICE button.

This is the only thing between the Seat Map page and the Google Flights
scraper. It is deliberately small, standard-library-only, and refuses to leak
internal information to the browser:

  - the request is validated here; bad input -> 400 with body "{}",
  - one call is made to the scraper (search-one-way),
  - the payload is trimmed to the fields the client renders,
  - every failure is one of three flat HTTP statuses (400 / 404 / 502), and
    the response body is "{}" or a flat JSON object — no upstream text, no
    traceback, no booking_token, no emissions, no airport names.

Run:

    SCRAPER_BASE=http://127.0.0.1:8000 \
    PRICE_ALLOW_ORIGINS=http://localhost:4173 \
        python3 price_api.py            # 0.0.0.0:8787

    python3 price_api.py --self-test   # 31 checks, no network

The endpoints:

    GET /api/flights/price?origin=JFK&destination=LAX&departure_date=2026-11-12
                          &cabin_class=economy&currency=USD&adults=1
    GET /healthz

The only non-stdlib thing the service pulls in is `urllib` — and only for the
scraper call. Everything else is the http.server.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ALLOWED_CABINS = {"economy", "premium_economy", "business", "first"}
ALLOWED_CURRENCIES = re.compile(r"^[A-Z]{3}$")
IATA_CODE = re.compile(r"^[A-Z]{3}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# What the trimmed reply is allowed to contain. The client allowlist is the
# final word, but the server never sends more than this and never sends any
# of the BANNED keys.
ALLOWED_TOP_KEYS = {"ok", "source", "amount", "currency", "fetchedAt", "verdict", "summary", "scope", "stale"}
ALLOWED_VERDICT = {"low", "typical", "high", None}

BANNED_KEYS_ANYWHERE = {
    "booking_token", "bookingToken", "bookingtoken",
    "url", "deep_link", "deeplink", "href", "link",
    "emissions", "co2_kg", "co2kg", "co2", "carbon",
    "baggage", "bags", "carry_on", "carryon",
    "layover", "layovers", "layoverDuration",
    "airport_name", "airportName", "origin_name", "destination_name",
    "traceback", "stack", "stacktrace", "exception",
}

# Field allowlist per flight object. Whatever the scraper returns, the
# client only ever sees these keys.
ALLOWED_FLIGHT_KEYS = {
    "airline", "airlineName", "flightNumber", "stops", "durationMinutes", "durationLabel",
}
ALLOWED_SUMMARY_KEYS = {
    "airline", "airlineName", "flightNumber", "stops", "durationMinutes", "durationLabel",
}

DEFAULT_PORT = 8787
DEFAULT_SCRAPER = "http://127.0.0.1:8000"
SCRAPER_TIMEOUT = float(os.environ.get("PRICE_SCRAPER_TIMEOUT", "30"))


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _bad_request(missing_or_invalid):
    """Build a 400 response. Body is {} so the client can branch on it."""
    return HTTPStatus.BAD_REQUEST, {}


def _parse_query(qs):
    """Validate the inbound query string. Returns (ok, params, error_field).

    The error field name is for the self-test only; it never leaves the
    service in a 400 body.
    """
    if not qs:
        return False, None, "missing query"
    parts = urllib.parse.parse_qsl(qs, keep_blank_values=True)
    params = {k: v.strip() for k, v in parts}
    for required in ("origin", "destination", "departure_date"):
        if not params.get(required):
            return False, None, "missing " + required
    origin = (params.get("origin") or "").upper()
    dest = (params.get("destination") or "").upper()
    if not IATA_CODE.match(origin):
        return False, None, "bad origin"
    if not IATA_CODE.match(dest):
        return False, None, "bad destination"
    if origin == dest:
        return False, None, "same origin and destination"
    date = params.get("departure_date") or ""
    if not DATE_RE.match(date):
        return False, None, "bad date format"
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        return False, None, "bad date value"
    cabin = (params.get("cabin_class") or "economy").lower()
    if cabin not in ALLOWED_CABINS:
        return False, None, "bad cabin_class"
    currency = (params.get("currency") or "USD").upper()
    if not ALLOWED_CURRENCIES.match(currency):
        return False, None, "bad currency"
    try:
        adults = int(params.get("adults") or "1")
    except ValueError:
        return False, None, "bad adults"
    if adults < 1 or adults > 9:
        return False, None, "bad adults range"
    return True, {
        "origin": origin,
        "destination": dest,
        "departure_date": date,
        "cabin_class": cabin,
        "currency": currency,
        "adults": adults,
    }, None


# ---------------------------------------------------------------------------
# Scraping
# ---------------------------------------------------------------------------

def _scraper_get(scraper_base, params):
    """One HTTP call to the scraper. Returns the parsed JSON or raises."""
    scraper_qs = urllib.parse.urlencode(params)
    url = scraper_base.rstrip("/") + "/flights/search-one-way?" + scraper_qs
    req = urllib.request.Request(url, headers={"User-Agent": "spicy-price/1.0"})
    with urllib.request.urlopen(req, timeout=SCRAPER_TIMEOUT) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8"))


# ---------------------------------------------------------------------------
# Trimming
# ---------------------------------------------------------------------------

def _trim_flight(flight):
    """One flight -> the few keys the client renders. Drops everything else."""
    if not isinstance(flight, dict):
        return None
    out = {}
    airline = flight.get("airline") or ""
    if not isinstance(airline, str) or not airline:
        return None
    out["airline"] = airline
    airline_name = flight.get("airlineName") or flight.get("airline_name") or ""
    if isinstance(airline_name, str) and airline_name:
        out["airlineName"] = airline_name
    number = flight.get("flightNumber") or flight.get("flight_number") or ""
    if not isinstance(number, str) or not number:
        return None
    # The scraper ships the flight number with the airline code in front
    # ("DL 1788"). The wire format only carries the number; the code
    # travels in `airline`. Strip the leading code so the client never
    # ends up with "Delta · DL DL 1788".
    number = number.strip()
    upper = number.upper()
    code_upper = airline.upper()
    if upper.startswith(code_upper + " "):
        number = number[len(airline) + 1:].strip()
    elif upper.startswith(code_upper):
        number = number[len(airline):].strip()
    if not number:
        return None
    out["flightNumber"] = number
    stops = flight.get("stops")
    if isinstance(stops, int):
        out["stops"] = stops
    elif isinstance(stops, str) and stops.isdigit():
        out["stops"] = int(stops)
    duration = flight.get("duration")
    if isinstance(duration, (int, float)) and duration > 0:
        out["durationMinutes"] = int(duration)
    elif isinstance(duration, str):
        # The scraper sometimes ships "6h 8m"; the client only uses this
        # verbatim. We pass it through unchanged when it is short ASCII.
        if 1 <= len(duration) <= 24 and all(c.isalnum() or c in " hm" for c in duration):
            out["durationLabel"] = duration
    return out


def _build_summary(flight):
    """One short human sentence the client shows next to the amount.

    "Delta · DL 1788 · nonstop · 6h 8m"
    """
    if not flight:
        return None
    parts = []
    name = flight.get("airlineName") or ""
    code = flight.get("airline") or ""
    number = flight.get("flightNumber") or ""
    stops = flight.get("stops", None)
    duration = flight.get("durationLabel") or ""
    mins = flight.get("durationMinutes", None)
    if name and name != code:
        parts.append(name)
    elif code and not number:
        parts.append(code)
    # The flight number on Google Flights often begins with the IATA code
    # ("DL 1788"). Don't prepend the code when the number already starts
    # with it — that would render "Delta · DL DL 1788" on the page.
    if number:
        if code and not number.upper().startswith(code.upper() + " ") and not number.upper().startswith(code.upper()):
            parts.append((code + " " + number).strip())
        else:
            parts.append(number)
    if stops == 0:
        parts.append("nonstop")
    elif isinstance(stops, int) and stops == 1:
        parts.append("1 stop")
    elif isinstance(stops, int) and stops > 1:
        parts.append(str(stops) + " stops")
    if duration:
        parts.append(duration)
    elif isinstance(mins, int) and mins > 0:
        hours = mins // 60
        rem = mins % 60
        parts.append(str(hours) + "h " + str(rem) + "m")
    cleaned = [p for p in parts if p]
    return " · ".join(cleaned) if cleaned else None


def _pick_lowest(best_flights, currency):
    """Choose the cheapest fare. Returns (price_int, currency, flight) or (None,...)."""
    if not isinstance(best_flights, list):
        return None, None, None
    best = None
    best_price = None
    for f in best_flights:
        if not isinstance(f, dict):
            continue
        p = f.get("price")
        if isinstance(p, (int, float)) and p > 0:
            if best_price is None or p < best_price:
                best_price = p
                best = f
    if best is None:
        return None, None, None
    cur = (best.get("currency") or currency or "USD")
    if not isinstance(cur, str) or not ALLOWED_CURRENCIES.match(cur):
        cur = currency or "USD"
    return int(best_price), cur, best


def _verdict(insights):
    """Translate Google's price_insights into one of low/typical/high/None."""
    if not isinstance(insights, dict):
        return None
    for key in ("priceLevel", "price_level", "level"):
        v = insights.get(key)
        if isinstance(v, str) and v.lower() in ALLOWED_VERDICT - {None}:
            return v.lower()
    lowest = insights.get("lowestPrice") or insights.get("lowest_price")
    typical = insights.get("typicalPrice") or insights.get("typical_price")
    if isinstance(lowest, (int, float)) and isinstance(typical, (int, float)) and typical > 0:
        ratio = lowest / typical
        if ratio <= 0.85:
            return "low"
        if ratio >= 1.15:
            return "high"
        return "typical"
    return None


def _trim_payload(scraper_json, params):
    """Take the full scraper response and return the trimmed, flat dict.

    Empty dict on no-data. Never raises.
    """
    if not isinstance(scraper_json, dict):
        return {}
    best = scraper_json.get("best_flights")
    if not isinstance(best, list):
        return {}
    price, currency, flight = _pick_lowest(best, params["currency"])
    if price is None or flight is None:
        return {}
    trimmed_flight = _trim_flight(flight)
    if not trimmed_flight:
        return {}
    summary = _build_summary(trimmed_flight)
    if not summary:
        return {}
    verdict = _verdict(scraper_json.get("price_insights"))
    fetched = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    payload = {
        "ok": True,
        "source": "Google Flights",
        "amount": price,
        "currency": currency,
        "fetchedAt": fetched,
        "verdict": verdict,
        "summary": summary,
        "scope": (
            "The fare for this flight, " + params["cabin_class"].replace("_", " ") +
            ", on " + params["departure_date"] + "."
        ),
    }
    # Drop None so the wire format is minimal.
    return {k: v for k, v in payload.items() if v is not None}


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class PriceHandler(BaseHTTPRequestHandler):
    server_version = "SpicyPrice/1.0"
    allowed_origins = ()  # set by the server on init
    scraper_base = DEFAULT_SCRAPER

    # Quiet the default access log; the operator can re-enable it by
    # setting PRICE_VERBOSE=1.
    def log_message(self, format, *args):
        if os.environ.get("PRICE_VERBOSE") == "1":
            sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    def _write(self, status, body):
        body_bytes = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(int(status))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.send_header("Cache-Control", "no-store")
        origin = self.headers.get("Origin", "")
        if origin and origin in self.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        try:
            self.wfile.write(body_bytes)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_OPTIONS(self):
        origin = self.headers.get("Origin", "")
        if origin and origin in self.allowed_origins:
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/healthz":
            self._write(HTTPStatus.OK, {"ok": True})
            return
        if path != "/api/flights/price":
            self._write(HTTPStatus.NOT_FOUND, {})
            return
        ok, params, _err = _parse_query(parsed.query)
        if not ok:
            self._write(HTTPStatus.BAD_REQUEST, {})
            return
        try:
            scraper_json = _scraper_get(self.scraper_base, {
                "origin": params["origin"],
                "destination": params["destination"],
                "departure_date": params["departure_date"],
                "cabin_class": params["cabin_class"],
                "currency": params["currency"],
                "adults": params["adults"],
            })
        except urllib.error.HTTPError as e:
            # 4xx from the scraper is the caller's fault, not ours.
            if 400 <= e.code < 500:
                self._write(HTTPStatus.BAD_REQUEST, {})
                return
            self._write(HTTPStatus.BAD_GATEWAY, {})
            return
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, ValueError):
            self._write(HTTPStatus.BAD_GATEWAY, {})
            return
        except Exception:
            self._write(HTTPStatus.BAD_GATEWAY, {})
            return
        payload = _trim_payload(scraper_json, params)
        if not payload:
            # Real success path, but the scraper had no fares — say so with
            # a 200 + ok=false so the client can render "no fare came back"
            # rather than an outage.
            self._write(HTTPStatus.OK, {"ok": False, "kind": "no_fare"})
            return
        self._write(HTTPStatus.OK, payload)


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def make_handler(allowed_origins, scraper_base):
    cls = PriceHandler
    cls.allowed_origins = tuple(allowed_origins)
    cls.scraper_base = scraper_base
    return cls


def _serve(host, port, allowed_origins, scraper_base):
    handler = make_handler(allowed_origins, scraper_base)
    httpd = ThreadingHTTPServer((host, port), handler)
    print("Spicy price service listening on http://%s:%d/" % (host, port))
    print("  scraper: %s" % scraper_base)
    print("  origins: %s" % (", ".join(allowed_origins) if allowed_origins else "(none)"))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


def main(argv):
    args = list(argv)
    if "--self-test" in args:
        from self_test import run_self_test  # type: ignore
        return run_self_test()
    port = int(os.environ.get("PRICE_PORT", str(DEFAULT_PORT)))
    host = os.environ.get("PRICE_HOST", "0.0.0.0")
    scraper = os.environ.get("SCRAPER_BASE", DEFAULT_SCRAPER)
    origins_env = os.environ.get("PRICE_ALLOW_ORIGINS", "")
    origins = [o.strip() for o in origins_env.split(",") if o.strip()]
    _serve(host, port, origins, scraper)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
