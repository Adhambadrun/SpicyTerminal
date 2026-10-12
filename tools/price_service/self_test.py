"""tools/price_service/self_test.py — 31 checks, no network, no files.

Run with:  python3 price_api.py --self-test
"""
from __future__ import annotations

import json
import sys
import urllib.error
from http import HTTPStatus
from io import BytesIO

import price_api as api


PASSED = 0
FAILED = 0


def check(name, cond, detail=""):
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print("  PASS  " + name)
    else:
        FAILED += 1
        print("  FAIL  " + name + ("  (" + detail + ")" if detail else ""))


# ---------------------------------------------------------------------------
# 1. validation: the happy path (3 checks)
# ---------------------------------------------------------------------------

ok, params, err = api._parse_query(
    "origin=JFK&destination=LAX&departure_date=2026-11-12&cabin_class=economy&currency=USD&adults=2"
)
check("01 good query parses and upper-cases airports", ok and err is None
      and params["origin"] == "JFK" and params["destination"] == "LAX")
check("02 cabin defaults to economy and currency to USD",
      ok and params["cabin_class"] == "economy" and params["currency"] == "USD")
check("03 adults are parsed as an integer", ok and params["adults"] == 2)


# ---------------------------------------------------------------------------
# 2. validation: the bad paths (4 checks across 11 cases — no network)
# ---------------------------------------------------------------------------

bad_cases = [
    ("",                                                       "empty query"),
    ("origin=JFK&destination=LAX",                             "missing departure_date"),
    ("origin=12X&destination=LAX&departure_date=2026-11-12",   "bad origin (digit)"),
    ("origin=JFK&destination=1A2&departure_date=2026-11-12",   "bad destination (digit)"),
    ("origin=JFK&destination=JFK&departure_date=2026-11-12",   "same airport"),
    ("origin=JFK&destination=LAX&departure_date=11-12-2026",   "bad date format"),
    ("origin=JFK&destination=LAX&departure_date=2026-13-40",   "impossible date"),
    ("origin=JFK&destination=LAX&departure_date=2026-11-12&cabin_class=presidential", "bad cabin"),
    ("origin=JFK&destination=LAX&departure_date=2026-11-12&currency=dollar",         "bad currency"),
    ("origin=JFK&destination=LAX&departure_date=2026-11-12&adults=zero",           "bad adults"),
    ("origin=JFK&destination=LAX&departure_date=2026-11-12&adults=12",             "too many adults"),
]
all_bad = all(not api._parse_query(qs)[0] for qs, _ in bad_cases)
check("04 every malformed query is refused", all_bad,
      detail="11 cases: " + ", ".join(label for _, label in bad_cases))


# ---------------------------------------------------------------------------
# 3. trimming: a real-looking scraper reply (5 checks)
# ---------------------------------------------------------------------------

scraper_payload = {
    "best_flights": [
        {
            "price": 249,
            "currency": "USD",
            "airline": "DL",
            "airline_name": "Delta",
            "flight_number": "DL 1788",
            "stops": 0,
            "duration": 368,
            "departure_airport": {"name": "John F. Kennedy International"},
            "arrival_airport": {"name": "Los Angeles International"},
            "booking_token": "TOKEN-NEVER-LEAK-12345",
            "url": "https://www.google.com/travel/flights/buy?t=TOKEN",
            "emissions": {"co2_kg": 234.5},
            "layovers": [],
            "baggage": {"included": 1},
        }
    ],
    "price_insights": {"lowestPrice": 230, "typicalPrice": 280, "priceLevel": "low"},
}
trimmed = api._trim_payload(scraper_payload, {
    "origin": "JFK", "destination": "LAX",
    "departure_date": "2026-11-12",
    "cabin_class": "economy", "currency": "USD", "adults": 1,
})
check("05 trimmed payload has ok=true with the integer amount",
      trimmed.get("ok") is True and trimmed.get("amount") == 249
      and trimmed.get("source") == "Google Flights")
check("06 verdict is translated to 'low' from price_insights", trimmed.get("verdict") == "low")
check("07 summary mentions the airline, flight, nonstop, and duration",
      "Delta" in trimmed.get("summary", "")
      and "DL 1788" in trimmed.get("summary", "")
      and "nonstop" in trimmed.get("summary", "")
      and "6h 8m" in trimmed.get("summary", ""))
check("08 scope line names the cabin and the date",
      "economy" in trimmed.get("scope", "") and "2026-11-12" in trimmed.get("scope", ""))
check("09 trimmed payload is the only thing on the wire "
      "(no booking_token / url / emissions / co2 / baggage / layovers / airport names)",
      all(k not in json.dumps(trimmed, ensure_ascii=False) for k in
          ("booking_token", "url", "emissions", "co2_kg", "baggage", "layovers",
           "John F. Kennedy", "Los Angeles")))


# ---------------------------------------------------------------------------
# 4. trimming: empty / no-fare inputs (3 checks)
# ---------------------------------------------------------------------------

check("10 empty scraper reply becomes an empty payload", api._trim_payload({}, params) == {})
check("11 no best_flights becomes an empty payload",
      api._trim_payload({"best_flights": []}, params) == {})
check("12 best_flights with no prices becomes an empty payload",
      api._trim_payload({"best_flights": [{"airline": "DL", "flight_number": "9"}]}, params) == {})


# ---------------------------------------------------------------------------
# 5. verdict heuristic (4 checks)
# ---------------------------------------------------------------------------

check("13 insights with no usable signal -> None", api._verdict({}) is None)
check("14 priceLevel 'low'/'TYPICAL'/'high' are lower-cased and pass through",
      api._verdict({"priceLevel": "low"}) == "low"
      and api._verdict({"priceLevel": "TYPICAL"}) == "typical"
      and api._verdict({"priceLevel": "high"}) == "high")
check("15 lowestPrice/typicalPrice ratio <= 0.85 -> low",
      api._verdict({"lowestPrice": 100, "typicalPrice": 200}) == "low")
check("16 lowestPrice/typicalPrice ratio >= 1.15 -> high",
      api._verdict({"lowestPrice": 230, "typicalPrice": 200}) == "high")


# ---------------------------------------------------------------------------
# 6. summary builder (2 checks)
# ---------------------------------------------------------------------------

flight = {
    "airline": "DL", "airlineName": "Delta", "flightNumber": "1788",
    "stops": 0, "durationLabel": "6h 8m", "durationMinutes": 368,
}
summary = api._build_summary(flight)
check("17 summary uses the airline name, not the IATA code, when both exist",
      summary.split(" · ")[0] == "Delta")
check("18 summary lists nonstop and a 6h 8m duration",
      "nonstop" in summary and "6h 8m" in summary)


# ---------------------------------------------------------------------------
# 7. HTTP handler, end-to-end with a stubbed scraper (13 checks)
# ---------------------------------------------------------------------------

def _run_request(path, scraper_json=None, scraper_exc=None, origins=("http://localhost:4173",)):
    """Run a real PriceHandler.do_GET against a stubbed scraper, with a
    stubbed socket so the writes are captured in memory.
    """
    api.make_handler(origins, "http://stub")
    handler = api.PriceHandler.__new__(api.PriceHandler)
    captured_headers = []
    response_status = []
    handler.send_response = lambda code, *a, **k: response_status.append(code)
    handler.send_header = lambda name, value: captured_headers.append((name, value))
    handler.end_headers = lambda: None
    handler.wfile = BytesIO()
    handler.path = path
    handler.headers = {"Origin": origins[0] if origins else ""}
    handler.client_address = ("127.0.0.1", 0)
    handler.request_version = "HTTP/1.1"
    handler.command = "GET"
    handler.requestline = "GET " + path + " HTTP/1.1"

    if scraper_exc:
        original = api._scraper_get
        api._scraper_get = lambda *a, **k: (_ for _ in ()).throw(scraper_exc)
    else:
        original = api._scraper_get
        api._scraper_get = lambda *a, **k: scraper_json

    try:
        handler.do_GET()
    finally:
        api._scraper_get = original

    body_bytes = handler.wfile.getvalue()
    captured = {}
    captured["status"] = response_status[0] if response_status else None
    try:
        captured["body"] = json.loads(body_bytes.decode("utf-8")) if body_bytes else None
    except (ValueError, UnicodeDecodeError):
        captured["body"] = None
    captured["headers"] = {name: value for name, value in captured_headers}
    return captured


class _HTTPError(urllib.error.HTTPError):
    def __init__(self, code):
        self.code = code
    def read(self): return b"{}"

res = _run_request("/api/flights/price?origin=12X&destination=LAX&departure_date=2026-11-12")
check("19 bad airport -> 400 with body {}", res["status"] == HTTPStatus.BAD_REQUEST and res["body"] == {})

res = _run_request("/no/such/route")
check("20 wrong path -> 404 with body {}", res["status"] == HTTPStatus.NOT_FOUND and res["body"] == {})

res = _run_request("/api/flights/price?origin=JFK&destination=LAX&departure_date=2026-11-12",
                   scraper_exc=urllib.error.URLError("connection refused"))
check("21 scraper down -> 502 with body {}", res["status"] == HTTPStatus.BAD_GATEWAY and res["body"] == {})

res = _run_request("/api/flights/price?origin=JFK&destination=LAX&departure_date=2026-11-12",
                   scraper_exc=_HTTPError(500))
check("22 scraper HTTP 500 -> 502 with body {}", res["status"] == HTTPStatus.BAD_GATEWAY and res["body"] == {})

res = _run_request("/api/flights/price?origin=JFK&destination=LAX&departure_date=2026-11-12",
                   scraper_exc=_HTTPError(400))
check("23 scraper HTTP 400 -> 400 with body {}", res["status"] == HTTPStatus.BAD_REQUEST and res["body"] == {})

res = _run_request("/api/flights/price?origin=JFK&destination=LAX&departure_date=2026-11-12",
                   scraper_json=scraper_payload)
check("24 scraper success -> 200 with ok=true, the right amount, the right verdict",
      res["status"] == HTTPStatus.OK and res["body"].get("ok") is True
      and res["body"].get("amount") == 249 and res["body"].get("verdict") == "low")
check("25 trimmed body still has no booking_token / url / emissions / airport names",
      all(k not in json.dumps(res["body"]) for k in
          ("booking_token", "url", "emissions", "co2_kg", "baggage", "layovers",
           "John F. Kennedy", "Los Angeles")))

res = _run_request("/api/flights/price?origin=JFK&destination=LAX&departure_date=2026-11-12",
                   scraper_json={"best_flights": []})
check("26 scraper 200 with no fare -> 200 ok=false kind=no_fare",
      res["status"] == HTTPStatus.OK and res["body"] == {"ok": False, "kind": "no_fare"})

res = _run_request("/healthz")
check("27 /healthz returns 200 ok=true",
      res["status"] == HTTPStatus.OK and res["body"] == {"ok": True})

# CORS — allowed origin echoed, un-allowed origin NOT echoed.
res = _run_request("/api/flights/price?origin=JFK&destination=LAX&departure_date=2026-11-12",
                   scraper_json=scraper_payload,
                   origins=("http://localhost:4173",))
check("28 CORS echoes the allowed origin EXACTLY (no wildcard, no pattern match)",
      res["headers"].get("Access-Control-Allow-Origin") == "http://localhost:4173")

res = _run_request("/api/flights/price?origin=JFK&destination=LAX&departure_date=2026-11-12",
                   scraper_json=scraper_payload,
                   origins=("http://localhost:4173",))
# Browser sent the right origin; server still includes Vary: Origin so caches
# do not reuse the response for a different one.
check("29 server sets Vary: Origin on the success path",
      res["headers"].get("Vary") == "Origin")

# OPTIONS preflight
api.make_handler(("http://localhost:4173",), "http://stub")
handler = api.PriceHandler.__new__(api.PriceHandler)
handler.send_response = lambda *a, **k: None
handler.send_header = lambda *a, **k: None
handler.end_headers = lambda: None
handler.wfile = BytesIO()
handler.path = "/api/flights/price"
handler.headers = {"Origin": "http://localhost:4173"}
handler.client_address = ("127.0.0.1", 0)
handler.request_version = "HTTP/1.1"
handler.command = "OPTIONS"
handler.requestline = "OPTIONS /api/flights/price HTTP/1.1"
preflight = []
handler.send_response = lambda code, *a, **k: preflight.append(code)
handler.do_OPTIONS()
check("30 OPTIONS preflight answers 204 for an allowed origin", preflight == [HTTPStatus.NO_CONTENT])

# OPTIONS for an un-allowed origin still 204 but without CORS headers.
api.make_handler(("http://localhost:4173",), "http://stub")
handler = api.PriceHandler.__new__(api.PriceHandler)
preflight = []
headers = []
handler.send_response = lambda code, *a, **k: preflight.append(code)
handler.send_header = lambda name, value: headers.append((name, value))
handler.end_headers = lambda: None
handler.wfile = BytesIO()
handler.path = "/api/flights/price"
handler.headers = {"Origin": "https://evil.example"}
handler.client_address = ("127.0.0.1", 0)
handler.request_version = "HTTP/1.1"
handler.command = "OPTIONS"
handler.requestline = "OPTIONS /api/flights/price HTTP/1.1"
handler.do_OPTIONS()
check("31 OPTIONS preflight for an un-allowed origin is 204 with no CORS headers",
      preflight == [HTTPStatus.NO_CONTENT]
      and not any(name == "Access-Control-Allow-Origin" for name, _ in headers))


print()
print("=" * 60)
print("RESULT: %d passed, %d failed" % (PASSED, FAILED))
print("=" * 60)
sys.exit(0 if FAILED == 0 else 1)


def run_self_test():
    return main()


if __name__ == "__main__":
    main()
