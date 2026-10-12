#!/usr/bin/env python3
"""Serve the built static site locally, including the /seatmap rewrite
and a same-origin reverse proxy to the fare service.

The preview is what the browser sees. The browser must NEVER have to
call 127.0.0.1 or any other internal address — every URL it follows
must be relative to the page's own origin. So the /api/flights/price
endpoint and the /healthz health check are proxied to the fare
service on 127.0.0.1:8787 (or wherever PRICE_BACKEND points).
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import json
import os
import urllib.request
import urllib.error


ROOT = Path(__file__).resolve().parent / "public"
PRICE_BACKEND = os.environ.get("PRICE_BACKEND", "http://127.0.0.1:8787")


class PreviewHandler(SimpleHTTPRequestHandler):
    """Static file handler that mirrors the deployment's Seat Map rewrite
    AND proxies the fare-service routes to the backend."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path):
        route = urlsplit(path).path.rstrip("/") or "/"
        if route == "/seatmap":
            path = "/seatmap.html"
        return super().translate_path(path)

    def _proxy(self, backend_path):
        """Forward this request to the fare service and return the body."""
        url = PRICE_BACKEND.rstrip("/") + backend_path
        req = urllib.request.Request(url, headers={"User-Agent": "spicy-preview/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read()
                status = resp.status
        except urllib.error.HTTPError as e:
            body = e.read() if e.fp else b"{}"
            status = e.code
        except (urllib.error.URLError, TimeoutError, OSError):
            body = b"{}"
            status = 502
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/flights/price" or path == "/healthz":
            self._proxy(self.path)
            return
        return super().do_GET()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "4173"))
    server = ThreadingHTTPServer(("0.0.0.0", port), PreviewHandler)
    print("SpicyTerminal preview listening on 0.0.0.0:%d" % port, flush=True)
    print("  fare backend: %s" % PRICE_BACKEND, flush=True)
    server.serve_forever()
