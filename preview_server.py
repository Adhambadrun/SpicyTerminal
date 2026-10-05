#!/usr/bin/env python3
"""Serve the built static site locally, including the /seatmap rewrite."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import os

ROOT = Path(__file__).resolve().parent / "public"


class PreviewHandler(SimpleHTTPRequestHandler):
    """Static file handler that mirrors the deployment's Seat Map rewrite."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path):
        route = urlsplit(path).path.rstrip("/") or "/"
        if route == "/seatmap":
            path = "/seatmap.html"
        return super().translate_path(path)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "4173"))
    server = ThreadingHTTPServer(("0.0.0.0", port), PreviewHandler)
    print("SpicyTerminal preview listening on 0.0.0.0:%d" % port, flush=True)
    server.serve_forever()
