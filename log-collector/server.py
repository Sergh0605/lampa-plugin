#!/usr/bin/env python3
"""Tiny log collector for Lampa plugin manual tests.

Browser (another machine in LAN) POSTs plugin logs here because
`docker logs lampa` cannot see browser console output.
Agent reads the host file ./logs/lampa-plugin.log (user never reads it).

Endpoints:
  POST /log   JSON or plain text body -> appended as one JSON line
  GET  /logs?tail=N   last N lines (plain text)
  GET  /health        {"ok":true}
CORS: * (Lampa origin http://192.168.1.1:9100 and plugin origin differ).
"""
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

LOG_FILE = os.environ.get("LOG_FILE", "/logs/lampa-plugin.log")
MAX_BODY = 64 * 1024


def _cors(handler):
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header(
        "Access-Control-Allow-Headers", "Content-Type, X-Requested-With, Origin, Accept"
    )


class Handler(BaseHTTPRequestHandler):
    server_version = "LampaLogCollector/1.0"

    def log_message(self, format, *args):  # keep container logs quiet
        pass

    def _send(self, code, body: bytes, ctype="application/json"):
        self.send_response(code)
        _cors(self)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        _cors(self)
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            self._send(200, b'{"ok":true}')
            return
        if path in ("/logs", "/log"):
            tail = 200
            try:
                tail = max(1, int(parse_qs(urlparse(self.path).query).get("tail", ["200"])[0]))
            except (ValueError, TypeError):
                pass
            try:
                with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
                    lines = f.readlines()[-tail:]
            except FileNotFoundError:
                lines = []
            self._send(200, "".join(lines).encode("utf-8"), "text/plain; charset=utf-8")
            return
        self._send(404, b'{"ok":false}')

    def do_POST(self):
        if urlparse(self.path).path not in ("/log", "/logs"):
            self._send(404, b'{"ok":false}')
            return
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
        except ValueError:
            length = 0
        raw = self.rfile.read(min(length, MAX_BODY)) if length > 0 else b""
        text = raw.decode("utf-8", errors="replace")[:8000]
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(
                json.dumps(
                    {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "body": text},
                    ensure_ascii=False,
                )
                + "\n"
            )
        self._send(200, b'{"ok":true}')


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "9101"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
