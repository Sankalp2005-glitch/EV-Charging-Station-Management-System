const API_BASE = "http://127.0.0.1:5000";
const CUSTOMER_ROLE = "customer";
const OWNER_ROLE = "owner";
const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 480;
const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const ACTIVITY_EVENTS = ["click", "keydown", "mousemove", "scroll", "touchstart"];

const dashboardState = {
    openStationId: null,
    openStationName: "",
};
const bookingViewState = {
    customer: "upcoming",
    owner: "upcoming",
};
const ownerStationScheduleState = {
    view: "upcoming",
    stationId: null,
};
const adminViewState = {
    stationStatus: "pending",
};

let inactivityTimer = null;
let inactivityTrackingStarted = false;
let realtimeSocket = null;
let realtimeRefreshTimer = null;

function getToken() {
    return localStorage.getItem("token");
}

function getRole() {
    return localStorage.getItem("role");
}

function isDashboardPage() {
    return window.location.pathname.toLowerCase().includes("dashboard.html");
}

function buildAuthHeaders() {
    const token = getToken();
    if (!token) {
        throw new Error("Please login again.");
    }
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
    };
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

function setBookingViewButtons(prefix, activeView) {
    const upcomingBtn = document.getElementById(`${prefix}UpcomingBtn`);
    const pastBtn = document.getElementById(`${prefix}PastBtn`);
    if (upcomingBtn) {
        upcomingBtn.classList.toggle("btn-primary", activeView === "upcoming");
        upcomingBtn.classList.toggle("btn-outline-primary", activeView !== "upcoming");
    }
    if (pastBtn) {
        pastBtn.classList.toggle("btn-primary", activeView === "past");
        pastBtn.classList.toggle("btn-outline-primary", activeView !== "past");
    }
}

function parseOptionalNumber(rawValue) {
    if (rawValue === undefined || rawValue === null) {
        return null;
    }
    const text = String(rawValue).trim();
    if (!text) {
        return null;
    }
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : NaN;
}

function formatMoney(value) {
    return `\u20B9 ${Number(value).toFixed(2)}`;
}

function isValidPhone(phone) {
    return /^[0-9]{10,13}$/.test(phone);
}

function calculateChargingEstimate({
    batteryCapacityKwh,
    currentBatteryPercent,
    targetBatteryPercent,
    powerKw,
    pricePerKwh,
    pricePerMinute,
}) {
    if (
        !Number.isFinite(batteryCapacityKwh) ||
        !Number.isFinite(currentBatteryPercent) ||
        !Number.isFinite(targetBatteryPercent) ||
        !Number.isFinite(powerKw) ||
        powerKw <= 0
    ) {
        return null;
    }
    if (
        batteryCapacityKwh <= 0 ||
        currentBatteryPercent < 0 ||
        currentBatteryPercent >= 100 ||
        targetBatteryPercent <= currentBatteryPercent ||
        targetBatteryPercent > 100
    ) {
        return null;
    }

    const energyRequiredKwh =
        batteryCapacityKwh * ((targetBatteryPercent - currentBatteryPercent) / 100);
    const durationMinutes = Math.max(MIN_DURATION_MINUTES, Math.ceil((energyRequiredKwh / powerKw) * 60));

    let pricingModel = "per_kwh";
    let rate = Number(pricePerKwh);
    let estimatedCost = energyRequiredKwh * rate;

    if (!Number.isFinite(rate) || rate <= 0) {
        pricingModel = "per_minute";
        rate = Number(pricePerMinute);
        if (!Number.isFinite(rate) || rate <= 0) {
            return {
                energyRequiredKwh,
                durationMinutes,
                pricingModel: "unpriced",
                rate: null,
                estimatedCost: null,
            };
        }
        estimatedCost = durationMinutes * rate;
    }

    return {
        energyRequiredKwh,
        durationMinutes,
        pricingModel,
        rate,
        estimatedCost,
    };
}

function updateSlotEstimateDisplay(slotId, powerKw, pricePerKwh, pricePerMinute) {
    const batteryCapacity = parseOptionalNumber(document.getElementById(`battery-${slotId}`)?.value);
    const currentPercent = parseOptionalNumber(document.getElementById(`current-${slotId}`)?.value);
    const targetPercent = parseOptionalNumber(document.getElementById(`target-${slotId}`)?.value);
    const estimateDiv = document.getElementById(`estimate-${slotId}`);

    if (!estimateDiv) {
        return;
    }

    const estimate = calculateChargingEstimate({
        batteryCapacityKwh: batteryCapacity,
        currentBatteryPercent: currentPercent,
        targetBatteryPercent: targetPercent,
        powerKw,
        pricePerKwh,
        pricePerMinute,
    });

    if (!estimate) {
        estimateDiv.innerText = "Enter valid battery values to see estimate.";
        return;
    }

    if (estimate.estimatedCost === null) {
        estimateDiv.innerText = `Estimated time: ${estimate.durationMinutes} min | Pricing not configured`;
        return;
    }

    const rateLabel =
        estimate.pricingModel === "per_kwh"
            ? `${formatMoney(estimate.rate)} / kWh`
            : `${formatMoney(estimate.rate)} / min`;

    estimateDiv.innerText =
        `Estimated time: ${estimate.durationMinutes} min | Estimated cost: ${formatMoney(estimate.estimatedCost)} | Rate: ${rateLabel}`;
}

function stopInactivityTracking() {
    if (!inactivityTrackingStarted) {
        return;
    }
    ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, handleUserActivity);
    });
    inactivityTrackingStarted = false;
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
    }
}

function resetInactivityTimer() {
    if (!getToken()) {
        return;
    }
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
    }
    inactivityTimer = setTimeout(() => {
        alert("Your session expired after 15 minutes of inactivity. Please login again.");
        logout();
    }, SESSION_IDLE_TIMEOUT_MS);
}

function handleUserActivity() {
    resetInactivityTimer();
}

function startInactivityTracking() {
    if (inactivityTrackingStarted || !getToken()) {
        return;
    }
    ACTIVITY_EVENTS.forEach((eventName) => {
        window.addEventListener(eventName, handleUserActivity, { passive: true });
    });
    inactivityTrackingStarted = true;
    resetInactivityTimer();
}

function disconnectRealtimeUpdates() {
    if (realtimeSocket) {
        realtimeSocket.off("booking_update");
        realtimeSocket.disconnect();
        realtimeSocket = null;
    }
}

async function refreshRealtimeViews() {
    const role = getRole();
    if (!role || !getToken()) {
        return;
    }

    await loadStations();
    if (dashboardState.openStationId) {
        await toggleSlots(dashboardState.openStationId, dashboardState.openStationName, true);
    }
    if (role === CUSTOMER_ROLE || role === OWNER_ROLE) {
        await loadMyBookings(bookingViewState.customer);
    }
    if (role === OWNER_ROLE) {
        await loadOwnerStations();
        await loadOwnerBookings(bookingViewState.owner);
        await loadOwnerStats();
    }
    if (role === "admin") {
        await loadAdminStats();
    }
}

function scheduleRealtimeRefresh() {
    if (realtimeRefreshTimer) {
        return;
    }

    realtimeRefreshTimer = setTimeout(async () => {
        realtimeRefreshTimer = null;
        try {
            await refreshRealtimeViews();
        } catch (_error) {
            // Realtime sync is best-effort.
        }
    }, 400);
}

function initRealtimeUpdates() {
    if (!isDashboardPage() || !getToken() || typeof window.io !== "function") {
        return;
    }

    disconnectRealtimeUpdates();
    realtimeSocket = window.io(API_BASE, {
        transports: ["websocket", "polling"],
        reconnectionAttempts: 3,
        timeout: 2500,
        auth: {
            token: getToken(),
        },
    });
    realtimeSocket.on("booking_update", () => {
        scheduleRealtimeRefresh();
    });
    realtimeSocket.on("connect_error", () => {
        disconnectRealtimeUpdates();
    });
}

async function apiRequest(path, options = {}, useAuth = false) {
    const requestOptions = { ...options };
    requestOptions.headers = requestOptions.headers || {};

    if (useAuth) {
        requestOptions.headers = {
            ...buildAuthHeaders(),
            ...requestOptions.headers,
        };
    }

    if (requestOptions.body && !requestOptions.headers["Content-Type"]) {
        requestOptions.headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${API_BASE}${path}`, requestOptions);
    const payload = await parseJsonSafe(response);

    if (useAuth) {
        const refreshedToken = response.headers.get("X-Session-Token");
        if (refreshedToken) {
            localStorage.setItem("token", refreshedToken);
        }
    }

    if (!response.ok) {
        if (useAuth && response.status === 401) {
            stopInactivityTracking();
            localStorage.clear();
            window.location.href = "login.html";
        }
        const error = new Error(resolveErrorMessage(payload, `Request failed (${response.status})`));
        error.status = response.status;
        error.payload = payload;
        throw error;
    }

    if (useAuth) {
        resetInactivityTimer();
    }

    return payload;
}
