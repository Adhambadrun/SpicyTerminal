#!/usr/bin/env python3
"""Local test server for the fare backend (port 8787)."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs
import json
import os

class FareBackendHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/flights/price":
            self.handle_price_request()
        elif path == "/healthz":
            self.handle_health_check()
        else:
            self.send_response(404)
            self.end_headers()

    def handle_price_request(self):
        query = parse_qs(urlsplit(self.path).query)

        origin = query.get("origin", [""])[0].upper()
        destination = query.get("destination", [""])[0].upper()
        departure_date = query.get("departure_date", [""])[0]
        cabin_class = query.get("cabin_class", ["economy"])[0].lower()
        currency = query.get("currency", ["USD"])[0].upper()
        adults = int(query.get("adults", ["1"])[0])

        # Validate
        if not origin or not destination or not departure_date:
            self.send_json(400, {"ok": False, "kind": "bad_request", "message": "origin, destination, and departure_date are required"})
            return

        if not (len(origin) == 3 and origin.isalpha() and len(destination) == 3 and destination.isalpha()):
            self.send_json(400, {"ok": False, "kind": "bad_request", "message": "origin and destination must be 3-letter IATA codes"})
            return

        # No real API credentials - return no_fare
        self.send_json(200, {"ok": False, "kind": "no_fare"})

    def handle_health_check(self):
        # Healthy only when a provider is actually configured. Set
        # FARE_TEST_HEALTHY=1 to simulate a configured provider locally.
        if os.environ.get("FARE_TEST_HEALTHY") == "1":
            self.send_json(200, {"status": "ok"})
        else:
            self.send_json(503, {"status": "unavailable"})

    def send_json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Suppress default log messages
        pass

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8787"))
    server = ThreadingHTTPServer(("127.0.0.1", port), FareBackendHandler)
    print(f"Fare backend test server listening on 127.0.0.1:{port}")
    server.serve_forever()