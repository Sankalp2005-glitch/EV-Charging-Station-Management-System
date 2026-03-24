(() => {
    const runtimeConfig = window.__EVGO_CONFIG__ || {};
    const normalizeBase = (value) => {
        const text = String(value || "").trim();
        return text ? text.replace(/\/+$/, "") : "";
    };
    const API_BASE = normalizeBase(runtimeConfig.API_BASE);
    const SOCKET_BASE = normalizeBase(runtimeConfig.SOCKET_BASE) || API_BASE;

    function normalizeDigits(value) {
        return String(value || "").replace(/\D/g, "");
    }

    function isValidCountryCode(value) {
        return /^[1-9][0-9]{0,2}$/.test(value);
    }

    function isValidPhoneNumber(value) {
        return /^[0-9]{10}$/.test(value);
    }

    async function parseJsonSafe(response) {
        try {
            return await response.json();
        } catch (_err) {
            return null;
        }
    }

    function resolveErrorMessage(payload, fallback = "Request failed") {
        if (!payload || typeof payload !== "object") {
            return fallback;
        }
        return payload.error || payload.message || fallback;
    }

    function bindPhoneInputGuards(root = document) {
        if (!root || typeof root.addEventListener !== "function") {
            return;
        }
        root.addEventListener("input", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }
            if (target.classList.contains("phone-code")) {
                const digits = normalizeDigits(target.value).slice(0, 3);
                target.value = digits ? `+${digits}` : "";
            }
            if (target.classList.contains("phone-number")) {
                target.value = normalizeDigits(target.value).slice(0, 10);
            }
        });
    }

    window.EVgoShared = {
        API_BASE,
        bindPhoneInputGuards,
        isValidCountryCode,
        isValidPhoneNumber,
        normalizeDigits,
        parseJsonSafe,
        resolveErrorMessage,
        SOCKET_BASE,
    };
})();
