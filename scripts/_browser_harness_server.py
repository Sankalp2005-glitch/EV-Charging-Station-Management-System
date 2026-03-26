from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

FRONTEND_ROOT = Path(r'''C:\Projects\ev_charging_system\frontend''')
REPORT_PATH = Path(r'''C:\Projects\ev_charging_system\scripts\_browser_check_report.json''')
PROXY_LOG = Path(r'''C:\Projects\ev_charging_system\scripts\_browser_proxy.log''')
RUNTIME_CONFIG = b'''(() => { window.__EVGO_CONFIG__ = { API_BASE: "", SOCKET_BASE: "http://127.0.0.1:5001" }; })();'''

def log_line(message):
    with PROXY_LOG.open('a', encoding='utf-8') as fh:
        fh.write(message + '\n')

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
    def do_GET(self):
        if self.path == '/report':
            if REPORT_PATH.exists():
                payload = REPORT_PATH.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            self.send_error(404)
            return
        if self.path == '/js/runtime-config.js':
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(RUNTIME_CONFIG)))
            self.end_headers()
            self.wfile.write(RUNTIME_CONFIG)
            return
        if self.path.startswith('/api/'):
            return self.proxy_request('GET')
        return super().do_GET()
    def proxy_request(self, method):
        target_url = 'http://127.0.0.1:5001' + self.path
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
                self.wfile.write(payload)
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
            self.wfile.write(payload)
            log_line(f'  -> {error.code} {payload[:200]!r}')
            return

server = ThreadingHTTPServer(('127.0.0.1', 8123), Handler)
server.serve_forever()
