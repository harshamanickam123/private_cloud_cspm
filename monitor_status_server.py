#!/usr/bin/env python3
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote

BASE_DIR = Path(__file__).resolve().parent
REPORT_DIR = BASE_DIR / "reports" / "monitoring"

class Handler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        name = Path(unquote(urlparse(self.path).path)).name

        if name != "monitor_status.json" and not (
            name.startswith("monitor_") and name.endswith(".json")
        ):
            self.send_error(404)
            return

        target = REPORT_DIR / name
        if not target.is_file():
            self.send_error(404)
            return

        try:
            body = target.read_bytes()
            json.loads(body)
        except (OSError, json.JSONDecodeError):
            self.send_error(500, "Monitoring JSON is unavailable or invalid")
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass

if __name__ == "__main__":
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 5001), Handler)
    print("SENTINELFORGE monitoring status service: http://127.0.0.1:5001")
    server.serve_forever()
