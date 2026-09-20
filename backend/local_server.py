"""Local development server.

Standard library only, so `python3 local_server.py` works on a clean machine
with no pip install at all (demo mode needs nothing else). It is a thin
transport shim over app.api.dispatch - the same function API Gateway calls in
production.

    python3 local_server.py [--port 8000]
"""

import argparse
import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import api, config  # noqa: E402

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("change-detective")

MAX_BODY_BYTES = 1_000_000


class Handler(BaseHTTPRequestHandler):
    server_version = "ChangeDetective/1.0"

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", config.CORS_ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802
        self._handle("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._handle("POST")

    def _handle(self, method: str) -> None:
        parsed = urlparse(self.path)
        query = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        body: dict = {}
        if method == "POST":
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0

            if length > MAX_BODY_BYTES:
                self._send(413, {"error": {"code": "payload_too_large",
                                           "message": "Request body is too large."}})
                return

            if length:
                raw = self.rfile.read(length)
                try:
                    body = json.loads(raw)
                except json.JSONDecodeError:
                    self._send(400, {"error": {"code": "invalid_json",
                                               "message": "Request body is not valid JSON."}})
                    return
                if not isinstance(body, dict):
                    self._send(400, {"error": {"code": "invalid_json",
                                               "message": "Request body must be a JSON object."}})
                    return

        status, payload = api.dispatch(method, parsed.path, query, body)
        self._send(status, payload)

    def log_message(self, fmt: str, *args) -> None:
        log.info("%s %s", self.address_string(), fmt % args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Impact Guard dev server")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    args = parser.parse_args()

    # Bind before announcing, so a failure does not print a URL that never
    # worked. A busy port is the commonest first-run problem and used to fail
    # with a fourteen-frame traceback; say what happened and how to move on.
    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as exc:
        if exc.errno in (48, 98):          # EADDRINUSE on macOS / Linux
            sys.exit(
                f"\nPort {args.port} is already in use.\n"
                f"  Use another one:   python3 local_server.py --port 8001\n"
                f"  Or free it:        lsof -ti :{args.port} | xargs kill\n"
                f"  If you use another port, point the UI at it with\n"
                f"  VITE_API_BASE=http://localhost:<port>\n"
            )
        raise

    log.info("Impact Guard API on http://%s:%s", args.host, args.port)
    log.info("data source: %s   bedrock: %s (%s)",
             config.DATA_SOURCE,
             "enabled" if config.BEDROCK_ENABLED else "disabled",
             config.BEDROCK_MODEL_ID)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down")
        server.server_close()


if __name__ == "__main__":
    main()
