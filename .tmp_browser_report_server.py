import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


REPORT_PATH = Path(".tmp_browser_report.json")


class ReportHandler(BaseHTTPRequestHandler):
    def _set_headers(self, status_code=200):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(204)

    def do_POST(self):
        if self.path != "/report":
            self._set_headers(404)
            self.wfile.write(b'{"error":"Not found"}')
            return

        content_length = int(self.headers.get("Content-Length", "0") or 0)
        payload = self.rfile.read(content_length)
        try:
            data = json.loads(payload.decode("utf-8"))
        except json.JSONDecodeError:
            self._set_headers(400)
            self.wfile.write(b'{"error":"Invalid JSON"}')
            return

        REPORT_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
        self._set_headers(200)
        self.wfile.write(b'{"ok":true}')

    def log_message(self, format, *args):  # noqa: A003
        return


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8123), ReportHandler).serve_forever()
