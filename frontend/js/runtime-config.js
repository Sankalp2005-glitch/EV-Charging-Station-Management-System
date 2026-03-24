(() => {
    const isLocalHost = ["127.0.0.1", "localhost"].includes(window.location.hostname);

    window.__EVGO_CONFIG__ = {
        API_BASE: "" || (isLocalHost ? "http://127.0.0.1:5000" : ""),
        SOCKET_BASE: "" || (isLocalHost ? "http://127.0.0.1:5000" : ""),
        ...(window.__EVGO_CONFIG__ || {}),
    };
})();
