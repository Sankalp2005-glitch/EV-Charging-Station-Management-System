const {
    API_BASE,
    bindPhoneInputGuards,
    isValidCountryCode,
    normalizeDigits,
    parseJsonSafe,
    resolveErrorMessage,
    SOCKET_BASE,
} = window.EVgoShared;
const CUSTOMER_ROLE = "customer";
const OWNER_ROLE = "owner";
const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 480;
const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const ACTIVITY_EVENTS = ["click", "keydown", "mousemove", "scroll", "touchstart"];
const VEHICLE_CATEGORY_BIKE = "bike_scooter";
const VEHICLE_CATEGORY_CAR = "car";
const DEFAULT_BATTERY_BY_CATEGORY = {
    [VEHICLE_CATEGORY_BIKE]: 3.5,
    [VEHICLE_CATEGORY_CAR]: 45,
};
const BATTERY_LIMITS_BY_CATEGORY = {
    [VEHICLE_CATEGORY_BIKE]: { min: 1, max: 8 },
    [VEHICLE_CATEGORY_CAR]: { min: 10, max: 120 },
};

const dashboardState = {
    openStationId: null,
    openStationName: "",
    nearbyOrigin: null,
    deviceDistanceOrigin: null,
    nearbyLabel: "",
    nearbyRadiusKm: 0,
    stationNearbyOnly: true,
    bookingNearbyOnly: false,
    ownerNearbyOnly: false,
    ownerStationsCache: [],
};
const bookingViewState = {
    customer: "upcoming",
    owner: "upcoming",
    ownerMine: "upcoming",
};
const ownerStationScheduleState = {
    view: "upcoming",
    stationId: null,
};
const adminViewState = {
    stationStatus: "all",
};

let inactivityTimer = null;
let inactivityTrackingStarted = false;
let realtimeSocket = null;
let realtimeRefreshTimer = null;
let chargingProgressTimer = null;
let authSessionEnding = false;
const activeAuthRequestControllers = new Set();

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
        const error = new Error("Please login again.");
        error.code = "AUTH_MISSING";
        error.silent = authSessionEnding;
        throw error;
    }
    authSessionEnding = false;
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
    };
}

function markAuthSessionActive() {
    authSessionEnding = false;
}

function markAuthSessionEnding() {
    authSessionEnding = true;
}

function abortPendingAuthRequests() {
    if (activeAuthRequestControllers.size === 0) {
        return;
    }
    for (const controller of Array.from(activeAuthRequestControllers)) {
        controller.abort();
        activeAuthRequestControllers.delete(controller);
    }
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
    return `\u20B9\u00A0${Number(value).toFixed(2)}`;
}

function normalizeVehicleCategory(value) {
    const normalized = String(value || "").trim().toLowerCase().replace(/[/-]+/g, "_").replace(/\s+/g, "_");
    if (["bike", "scooter", "bike_scooter"].includes(normalized)) {
        return VEHICLE_CATEGORY_BIKE;
    }
    if (normalized === VEHICLE_CATEGORY_CAR) {
        return VEHICLE_CATEGORY_CAR;
    }
    return "";
}

function normalizeVehicleCategoryLabel(value) {
    const normalized = normalizeVehicleCategory(value);
    if (normalized === VEHICLE_CATEGORY_BIKE) {
        return "Bike / Scooter";
    }
    if (normalized === VEHICLE_CATEGORY_CAR) {
        return "Car";
    }
    return normalizeStatusLabel(value || "Unknown");
}

function formatDurationHuman(value) {
    const totalMinutes = Math.max(0, Math.ceil(Number(value) || 0));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const parts = [];
    if (hours > 0) {
        parts.push(`${hours} ${hours === 1 ? "Hour" : "Hours"}`);
    }
    if (minutes > 0 || parts.length === 0) {
        parts.push(`${minutes} ${minutes === 1 ? "Minute" : "Minutes"}`);
    }
    return parts.join(" ");
}

function classifyChargingSpeed(powerKw, vehicleCategory) {
    const power = Number(powerKw);
    const normalizedCategory = normalizeVehicleCategory(vehicleCategory);
    if (!Number.isFinite(power) || power <= 0) {
        return "Unknown";
    }
    if (normalizedCategory === VEHICLE_CATEGORY_BIKE) {
        if (power >= 6) {
            return "Rapid";
        }
        if (power >= 3) {
            return "Standard";
        }
        return "Slow";
    }
    if (power >= 120) {
        return "Ultra-fast";
    }
    if (power >= 40) {
        return "Fast";
    }
    if (power >= 11) {
        return "Standard";
    }
    return "Slow";
}

function splitPhoneNumber(value, defaultCountryCode = "91") {
    const digits = normalizeDigits(value);
    if (digits.length > 10) {
        return {
            countryCode: digits.slice(0, digits.length - 10),
            localNumber: digits.slice(-10),
        };
    }
    return {
        countryCode: defaultCountryCode,
        localNumber: digits,
    };
}

function formatPhoneDisplay(value, defaultCountryCode = "91") {
    const digits = normalizeDigits(value);
    if (!digits) {
        return "-";
    }
    if (digits.length > 10) {
        const country = digits.slice(0, digits.length - 10);
        const local = digits.slice(-10);
        return `+${country} ${local}`;
    }
    if (digits.length === 10 && defaultCountryCode) {
        return `+${defaultCountryCode} ${digits}`;
    }
    return digits;
}

function calculateChargingEstimate({
    vehicleCategory,
    batteryCapacityKwh,
    currentBatteryPercent,
    targetBatteryPercent,
    powerKw,
    pricePerKwh,
    pricePerMinute,
}) {
    const normalizedVehicleCategory = normalizeVehicleCategory(vehicleCategory);
    const limits = BATTERY_LIMITS_BY_CATEGORY[normalizedVehicleCategory];
    if (
        !normalizedVehicleCategory ||
        !Number.isFinite(batteryCapacityKwh) ||
        !Number.isFinite(currentBatteryPercent) ||
        !Number.isFinite(targetBatteryPercent) ||
        !Number.isFinite(powerKw) ||
        powerKw <= 0
    ) {
        return null;
    }
    if (
        !limits ||
        batteryCapacityKwh < limits.min ||
        batteryCapacityKwh > limits.max ||
        currentBatteryPercent < 0 ||
        currentBatteryPercent >= 100 ||
        targetBatteryPercent <= currentBatteryPercent ||
        targetBatteryPercent > 100
    ) {
        return null;
    }

    const energyRequiredKwh =
        batteryCapacityKwh * ((targetBatteryPercent - currentBatteryPercent) / 100);
    const efficiency = normalizedVehicleCategory === VEHICLE_CATEGORY_BIKE ? 0.9 : 0.92;
    const taperFactor = normalizedVehicleCategory === VEHICLE_CATEGORY_BIKE ? 0.75 : 0.82;
    const preTaperTarget = Math.min(targetBatteryPercent, 80);
    const preTaperEnergy =
        preTaperTarget > currentBatteryPercent
            ? batteryCapacityKwh * ((preTaperTarget - currentBatteryPercent) / 100)
            : 0;
    const postTaperEnergy = Math.max(0, energyRequiredKwh - preTaperEnergy);
    const preTaperHours = preTaperEnergy / Math.max(powerKw * efficiency, 0.1);
    const postTaperHours = postTaperEnergy / Math.max(powerKw * efficiency * taperFactor, 0.1);
    const durationMinutes = Math.max(MIN_DURATION_MINUTES, Math.ceil((preTaperHours + postTaperHours) * 60));

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
        durationDisplay: formatDurationHuman(durationMinutes),
        chargingSpeed: classifyChargingSpeed(powerKw, normalizedVehicleCategory),
        vehicleCategory: normalizedVehicleCategory,
        pricingModel,
        rate,
        estimatedCost,
    };
}

function updateSlotEstimateDisplay(slotId, powerKw, pricePerKwh, pricePerMinute, vehicleCategory) {
    const batteryCapacity = parseOptionalNumber(document.getElementById(`battery-${slotId}`)?.value);
    const currentPercent = parseOptionalNumber(document.getElementById(`current-${slotId}`)?.value);
    const targetPercent = parseOptionalNumber(document.getElementById(`target-${slotId}`)?.value);
    const estimateDiv = document.getElementById(`estimate-${slotId}`);

    if (!estimateDiv) {
        return;
    }

    const estimate = calculateChargingEstimate({
        vehicleCategory,
        batteryCapacityKwh: batteryCapacity,
        currentBatteryPercent: currentPercent,
        targetBatteryPercent: targetPercent,
        powerKw,
        pricePerKwh,
        pricePerMinute,
    });

    if (!estimate) {
        estimateDiv.innerText = "Enter a compatible vehicle type and valid battery values to see the estimate.";
        return;
    }

    if (estimate.estimatedCost === null) {
        estimateDiv.innerText = `Estimated time: ${estimate.durationDisplay} | Speed: ${estimate.chargingSpeed} | Pricing not configured`;
        return;
    }

    const rateLabel =
        estimate.pricingModel === "per_kwh"
            ? `${formatMoney(estimate.rate)} / kWh`
            : `${formatMoney(estimate.rate)} / min`;

    estimateDiv.innerText =
        `Estimated time: ${estimate.durationDisplay} | Speed: ${estimate.chargingSpeed} | Estimated cost: ${formatMoney(estimate.estimatedCost)} | Rate: ${rateLabel}`;
}

function parseApiDateTime(value) {
    const text = String(value || "").trim();
    if (!text) {
        return null;
    }
    const normalized = text.includes("T") ? text : text.replace(" ", "T");
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTimeShort(value) {
    const date = value instanceof Date ? value : parseApiDateTime(value);
    if (!date) {
        return "-";
    }
    return new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

function getLiveChargingProgressSnapshot(entity = {}) {
    const now = new Date();
    const status = String(entity.status || "").trim().toLowerCase();
    const startedAt = parseApiDateTime(entity.charging_started_at);
    const completedAt = parseApiDateTime(entity.charging_completed_at);
    const durationMinutes = Math.max(
        0,
        Math.ceil(
            Number(entity.duration_minutes ?? entity.estimated_duration_minutes ?? entity.remaining_minutes ?? 0) || 0
        )
    );
    const currentBatteryPercent = Number(entity.current_battery_percent);
    const targetBatteryPercent = Number(entity.target_battery_percent);

    let progressPercent = Number(entity.charging_progress_percent);
    if (!Number.isFinite(progressPercent)) {
        progressPercent = 0;
    }

    let remainingMinutes = Number(entity.remaining_minutes);
    if (!Number.isFinite(remainingMinutes)) {
        remainingMinutes = null;
    }

    let estimatedCompletionTime = parseApiDateTime(entity.estimated_completion_time);
    if (!estimatedCompletionTime && startedAt && durationMinutes > 0) {
        estimatedCompletionTime = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);
    }

    let state = "waiting";
    if (status === "charging_completed" || completedAt) {
        state = "completed";
        progressPercent = 100;
        remainingMinutes = 0;
        estimatedCompletionTime = completedAt || estimatedCompletionTime;
    } else if ((status === "charging_started" || status === "confirmed") && startedAt && durationMinutes > 0) {
        state = "charging";
        const elapsedMinutes = Math.max((now.getTime() - startedAt.getTime()) / 60000, 0);
        progressPercent = Math.min((elapsedMinutes / durationMinutes) * 100, 100);
        remainingMinutes = Math.max(Math.ceil(durationMinutes - elapsedMinutes), 0);
    } else if (status === "charging_started" || status === "confirmed") {
        state = "charging";
    } else if (status === "charging_completed") {
        state = "completed";
    }

    let estimatedBatteryPercent = Number(entity.estimated_current_battery_percent);
    if (!Number.isFinite(estimatedBatteryPercent)) {
        estimatedBatteryPercent = null;
    }
    if (
        estimatedBatteryPercent === null &&
        Number.isFinite(currentBatteryPercent) &&
        Number.isFinite(targetBatteryPercent)
    ) {
        estimatedBatteryPercent = Math.min(
            currentBatteryPercent + (targetBatteryPercent - currentBatteryPercent) * (progressPercent / 100),
            targetBatteryPercent
        );
    }

    return {
        state,
        progressPercent: Math.max(0, Math.min(progressPercent, 100)),
        remainingMinutes,
        estimatedCompletionTime,
        estimatedBatteryPercent,
        currentBatteryPercent: Number.isFinite(currentBatteryPercent) ? currentBatteryPercent : null,
        targetBatteryPercent: Number.isFinite(targetBatteryPercent) ? targetBatteryPercent : null,
        durationMinutes,
    };
}

function buildChargingProgressWidget(entity = {}, options = {}) {
    const title = options.title || "Charging progress";
    return `
        <div
            class="charging-progress-card"
            data-charging-progress
            data-status="${escapeHtml(entity.status || "")}"
            data-started-at="${escapeHtml(entity.charging_started_at || "")}"
            data-completed-at="${escapeHtml(entity.charging_completed_at || "")}"
            data-duration-minutes="${escapeHtml(entity.duration_minutes ?? entity.estimated_duration_minutes ?? 0)}"
            data-current-battery="${escapeHtml(entity.current_battery_percent ?? "")}"
            data-target-battery="${escapeHtml(entity.target_battery_percent ?? "")}"
            data-estimated-completion="${escapeHtml(entity.estimated_completion_time || "")}"
            data-progress-percent="${escapeHtml(entity.charging_progress_percent ?? "")}"
            data-estimated-battery="${escapeHtml(entity.estimated_current_battery_percent ?? "")}"
            data-remaining-minutes="${escapeHtml(entity.remaining_minutes ?? "")}"
        >
            <div class="charging-progress__header">
                <span class="charging-progress__title">${escapeHtml(title)}</span>
                <strong class="charging-progress__percent">0%</strong>
            </div>
            <div class="charging-progress__track">
                <span class="charging-progress__fill"></span>
            </div>
            <div class="charging-progress__meta">
                <span class="charging-progress__battery">Waiting for live data</span>
                <span class="charging-progress__eta">Estimating...</span>
            </div>
        </div>
    `;
}

function refreshChargingProgressWidgets(root = document) {
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    scope.querySelectorAll("[data-charging-progress]").forEach((card) => {
        const snapshot = getLiveChargingProgressSnapshot({
            status: card.dataset.status,
            charging_started_at: card.dataset.startedAt,
            charging_completed_at: card.dataset.completedAt,
            duration_minutes: card.dataset.durationMinutes,
            current_battery_percent: card.dataset.currentBattery,
            target_battery_percent: card.dataset.targetBattery,
            estimated_completion_time: card.dataset.estimatedCompletion,
            charging_progress_percent: card.dataset.progressPercent,
            estimated_current_battery_percent: card.dataset.estimatedBattery,
            remaining_minutes: card.dataset.remainingMinutes,
        });

        const percentEl = card.querySelector(".charging-progress__percent");
        const fillEl = card.querySelector(".charging-progress__fill");
        const batteryEl = card.querySelector(".charging-progress__battery");
        const etaEl = card.querySelector(".charging-progress__eta");

        card.classList.toggle("charging-progress-card--waiting", snapshot.state === "waiting");
        card.classList.toggle("charging-progress-card--charging", snapshot.state === "charging");
        card.classList.toggle("charging-progress-card--completed", snapshot.state === "completed");

        if (fillEl) {
            fillEl.style.width = `${snapshot.progressPercent}%`;
        }

        if (snapshot.state === "completed") {
            if (percentEl) {
                percentEl.innerText = "100%";
            }
            if (batteryEl) {
                batteryEl.innerText =
                    snapshot.targetBatteryPercent !== null
                        ? `Reached ${Math.round(snapshot.targetBatteryPercent)}% target`
                        : "Charging completed";
            }
            if (etaEl) {
                etaEl.innerText = snapshot.estimatedCompletionTime
                    ? `Completed ${formatDateTimeShort(snapshot.estimatedCompletionTime)}`
                    : "Session completed";
            }
            return;
        }

        if (snapshot.state === "charging") {
            if (percentEl) {
                percentEl.innerText = `${Math.round(snapshot.progressPercent)}%`;
            }
            if (batteryEl) {
                batteryEl.innerText =
                    snapshot.estimatedBatteryPercent !== null && snapshot.targetBatteryPercent !== null
                        ? `${Math.round(snapshot.estimatedBatteryPercent)}% now | target ${Math.round(
                              snapshot.targetBatteryPercent
                          )}%`
                        : "Charging in progress";
            }
            if (etaEl) {
                etaEl.innerText = snapshot.estimatedCompletionTime
                    ? `Estimated complete ${formatDateTimeShort(snapshot.estimatedCompletionTime)}`
                    : snapshot.remainingMinutes !== null
                    ? `${formatDurationHuman(snapshot.remainingMinutes)} remaining`
                    : "Live session active";
            }
            return;
        }

        if (percentEl) {
            percentEl.innerText = "0%";
        }
        if (batteryEl) {
            batteryEl.innerText =
                snapshot.targetBatteryPercent !== null
                    ? `Ready to charge to ${Math.round(snapshot.targetBatteryPercent)}%`
                    : "Waiting for owner verification";
        }
        if (etaEl) {
            etaEl.innerText = snapshot.durationMinutes > 0
                ? `Estimated duration ${formatDurationHuman(snapshot.durationMinutes)}`
                : "Waiting for owner verification";
        }
    });
}

function startChargingProgressTicker() {
    refreshChargingProgressWidgets();
    if (chargingProgressTimer) {
        return;
    }
    chargingProgressTimer = window.setInterval(() => {
        refreshChargingProgressWidgets();
        if (typeof window.refreshOpenStationSlotsIfVisible === "function") {
            window.refreshOpenStationSlotsIfVisible().catch(() => {
                // Best-effort refresh for the open slot panel.
            });
        }
    }, 15000);
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
    if (realtimeRefreshTimer) {
        clearTimeout(realtimeRefreshTimer);
        realtimeRefreshTimer = null;
    }
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

    const activeTab =
        typeof window.getActiveDashboardTabName === "function" ? window.getActiveDashboardTabName() : "dashboard";

    if (typeof window.loadDashboardTabData === "function") {
        await window.loadDashboardTabData(activeTab, { force: true });
    } else {
        await loadStations();
        if (role === CUSTOMER_ROLE || role === OWNER_ROLE) {
            await loadMyBookings(bookingViewState.customer);
        }
        if (role === OWNER_ROLE) {
            await loadOwnerStations();
            await loadOwnerBookings(bookingViewState.owner);
            await loadOwnerMyBookings(bookingViewState.ownerMine);
            await loadOwnerStats();
            await loadOwnerRevenueAnalytics();
        }
        if (role === "admin") {
            await loadAdminStats();
            await loadAdminRevenueAnalytics();
        }
    }

    if (dashboardState.openStationId) {
        await toggleSlots(dashboardState.openStationId, dashboardState.openStationName, true);
    }
    refreshChargingProgressWidgets();
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

    const resolvedSocketUrl = SOCKET_BASE || window.location.origin;
    let usePollingOnly = false;
    try {
        const socketUrl = new URL(resolvedSocketUrl, window.location.href);
        usePollingOnly = ["127.0.0.1", "localhost"].includes(socketUrl.hostname);
    } catch (_error) {
        usePollingOnly = ["127.0.0.1", "localhost"].includes(window.location.hostname);
    }

    disconnectRealtimeUpdates();
    realtimeSocket = window.io(SOCKET_BASE || undefined, {
        transports: usePollingOnly ? ["polling"] : ["websocket", "polling"],
        upgrade: !usePollingOnly,
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
    let authRequestController = null;

    if (useAuth) {
        requestOptions.headers = {
            ...buildAuthHeaders(),
            ...requestOptions.headers,
        };
        if (!requestOptions.signal) {
            authRequestController = new AbortController();
            activeAuthRequestControllers.add(authRequestController);
            requestOptions.signal = authRequestController.signal;
        }
    }

    if (requestOptions.body && !requestOptions.headers["Content-Type"]) {
        requestOptions.headers["Content-Type"] = "application/json";
    }

    try {
        const response = await fetch(`${API_BASE}${path}`, requestOptions);
        const payload = await parseJsonSafe(response);

        if (useAuth) {
            const refreshedToken = response.headers.get("X-Session-Token");
            if (refreshedToken) {
                localStorage.setItem("token", refreshedToken);
            }
        }

        if (!response.ok) {
            if (useAuth && response.status === 401 && !authSessionEnding) {
                authSessionEnding = true;
                stopInactivityTracking();
                disconnectRealtimeUpdates();
                abortPendingAuthRequests();
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
    } catch (error) {
        const errorMessage = String(error?.message || "").toLowerCase();
        if (error?.name === "AbortError" || errorMessage.includes("signal is aborted")) {
            error.silent = true;
        }
        throw error;
    } finally {
        if (authRequestController) {
            activeAuthRequestControllers.delete(authRequestController);
        }
    }
}

function formatDateTimeLocalInputValue(value) {
    const date = value instanceof Date ? value : parseApiDateTime(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return "";
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

document.addEventListener("DOMContentLoaded", () => {
    bindPhoneInputGuards();
});

window.DEFAULT_BATTERY_BY_CATEGORY = DEFAULT_BATTERY_BY_CATEGORY;
window.BATTERY_LIMITS_BY_CATEGORY = BATTERY_LIMITS_BY_CATEGORY;
window.normalizeVehicleCategory = normalizeVehicleCategory;
window.normalizeVehicleCategoryLabel = normalizeVehicleCategoryLabel;
window.formatDurationHuman = formatDurationHuman;
window.classifyChargingSpeed = classifyChargingSpeed;
window.parseApiDateTime = parseApiDateTime;
window.formatDateTimeLocalInputValue = formatDateTimeLocalInputValue;
window.formatDateTimeShort = formatDateTimeShort;
window.getLiveChargingProgressSnapshot = getLiveChargingProgressSnapshot;
window.buildChargingProgressWidget = buildChargingProgressWidget;
window.refreshChargingProgressWidgets = refreshChargingProgressWidgets;
window.startChargingProgressTicker = startChargingProgressTicker;
window.normalizeDigits = normalizeDigits;
window.isValidCountryCode = isValidCountryCode;
window.splitPhoneNumber = splitPhoneNumber;
window.formatPhoneDisplay = formatPhoneDisplay;
window.bindPhoneInputGuards = bindPhoneInputGuards;
window.markAuthSessionActive = markAuthSessionActive;
window.markAuthSessionEnding = markAuthSessionEnding;
window.abortPendingAuthRequests = abortPendingAuthRequests;

