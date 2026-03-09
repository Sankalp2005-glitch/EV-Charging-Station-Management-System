from flask_mysqldb import MySQL

try:
    from flask_socketio import SocketIO
except ImportError:  # pragma: no cover - exercised only when dependency missing.
    SocketIO = None


mysql = MySQL()


class _SocketIOStub:
    def init_app(self, _app, **_kwargs):
        return None

    def emit(self, *_args, **_kwargs):
        return None

    def on(self, *_args, **_kwargs):
        def decorator(func):
            return func

        return decorator

    def run(self, app, **kwargs):
        app.run(**kwargs)


socketio = (
    SocketIO(cors_allowed_origins="*", async_mode="threading")
    if SocketIO is not None
    else _SocketIOStub()
)
SOCKETIO_ENABLED = SocketIO is not None
