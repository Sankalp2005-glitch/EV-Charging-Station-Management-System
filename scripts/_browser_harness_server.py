import os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

FRONTEND_ROOT = Path(r'''C:\Projects\ev_charging_system\frontend''')
REPORT_PATH = Path(r'''C:\Projects\ev_charging_system\scripts\_browser_check_report.json''')
PROXY_LOG = Path(r'''C:\Projects\ev_charging_system\scripts\_browser_proxy.log''')
API_PORT = int(os.environ.get("EVGO_BROWSER_API_PORT", "5000"))
HARNESS_PORT = int(os.environ.get("EVGO_BROWSER_HARNESS_PORT", "8123"))
API_BASE = f"http://127.0.0.1:{API_PORT}"
RUNTIME_CONFIG = (
    f'''(() => {{ window.__EVGO_CONFIG__ = {{ API_BASE: "", SOCKET_BASE: "{API_BASE}" }}; }})();'''.encode("utf-8")
)
CLIENT_DISCONNECT_ERRORS = (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)


def log_line(message):
    with PROXY_LOG.open('a', encoding='utf-8') as fh:
        fh.write(message + '\n')


def write_payload(handler, payload):
    try:
        handler.wfile.write(payload)
        return True
    except CLIENT_DISCONNECT_ERRORS:
        log_line('  -> client disconnected before response finished')
        return False


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND_ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_OPTIONS(self):
        if self.path.startswith('/api/'):
            self.send_response(204)
            self.end_headers()
            return
        self.send_error(404)

    def do_POST(self):
        if self.path == '/report':
            length = int(self.headers.get('Content-Length', '0'))
            body = self.rfile.read(length)
            REPORT_PATH.write_bytes(body)
            self.send_response(204)
            self.end_headers()
            return
        if self.path.startswith('/api/'):
            return self.proxy_request('POST')
        self.send_error(404)

    def do_PUT(self):
        if self.path.startswith('/api/'):
            return self.proxy_request('PUT')
        self.send_error(404)

    def do_PATCH(self):
        if self.path.startswith('/api/'):
            return self.proxy_request('PATCH')
        self.send_error(404)

    def do_DELETE(self):
        if self.path.startswith('/api/'):
            return self.proxy_request('DELETE')
        self.send_error(404)

    def do_GET(self):
        if self.path == '/report':
            if REPORT_PATH.exists():
                payload = REPORT_PATH.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                write_payload(self, payload)
                return
            self.send_error(404)
            return
        if self.path == '/js/runtime-config.js':
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(RUNTIME_CONFIG)))
            self.end_headers()
            write_payload(self, RUNTIME_CONFIG)
            return
        if self.path.startswith('/api/'):
            return self.proxy_request('GET')
        return super().do_GET()

    def proxy_request(self, method):
        target_url = API_BASE + self.path
        length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(length) if length else None
        headers = {key: value for key, value in self.headers.items() if key.lower() not in {'host', 'content-length'}}
        request = Request(target_url, data=body, headers=headers, method=method)
        log_line(f'{method} {self.path}')
        try:
            with urlopen(request, timeout=60) as response:
                payload = response.read()
                self.send_response(response.status)
                for key, value in response.headers.items():
                    if key.lower() in {'content-length', 'connection', 'server', 'date'}:
                        continue
                    self.send_header(key, value)
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                if write_payload(self, payload):
                    log_line(f'  -> {response.status} {payload[:200]!r}')
                return
        except HTTPError as error:
            payload = error.read()
            self.send_response(error.code)
            for key, value in error.headers.items():
                if key.lower() in {'content-length', 'connection', 'server', 'date'}:
                    continue
                self.send_header(key, value)
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            if write_payload(self, payload):
                log_line(f'  -> {error.code} {payload[:200]!r}')
            return


server = ThreadingHTTPServer(('127.0.0.1', HARNESS_PORT), Handler)
server.serve_forever()
