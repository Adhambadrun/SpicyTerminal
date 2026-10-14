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
    """Static file handler that mirrors the deployment's Seat Map rewrite,
    proxies the fare-service routes to the backend, and keeps every response
    out of the browser cache so a stale local page can never be mistaken for
    the deployed one."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        """Every response leaves here carrying Cache-Control: no-store.

        The deployed hosts pin the app pages to revalidate (vercel.json,
        netlify.toml) and /version.json to no-store. A local preview that lets
        the browser keep yesterday's 2.4 MB page cannot be used to try the
        update notice at all — REFRESH would look broken here while working in
        production, which is the worst kind of bug to chase. One header on the
        way out covers the static pages, the rewrites and the proxied fare
        routes alike.
        """
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

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
        self.end_headers()   # adds Cache-Control: no-store, as it does for all
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
