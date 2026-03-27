function buildStationCard(station, preview = false) {
    const compatibleChargers = Number(station.matching_slots ?? station.total_slots ?? 0) || 0;
    const availableChargers = Number(station.available_slots ?? 0) || 0;
    const occupiedChargers = Number(station.occupied_slots ?? 0) || 0;
    const chargingChargers = Number(station.charging_slots ?? 0) || 0;
    const pricing = normalizePriceInfo(station.price_info);
    const availabilityStatus = station.availability_status || "unknown";
    const badgeClass = getAvailabilityBadgeClass(availabilityStatus);
    const distanceLabel = formatDistanceKm(station.distance_km);

    return `
        <div class="col-12 ${preview ? "col-xl-6" : "col-md-6 col-xxl-4"}">
            <article class="station-card-shell">
                <div class="station-card__header">
                    <div>
                        <span class="station-card__eyebrow">Charging station</span>
                        <h5 class="station-card__title">${escapeHtml(station.station_name)}</h5>
                    </div>
                    <span class="${badgeClass}">${escapeHtml(normalizeStatusLabel(availabilityStatus))}</span>
                </div>

                <p class="station-card__location">
                    <i class="bi bi-geo-alt-fill"></i>
                    <span>${escapeHtml(station.location || "Location unavailable")}${distanceLabel ? ` | ${escapeHtml(distanceLabel)}` : ""}</span>
                </p>

                <div class="station-metric-grid">
                    <div class="station-metric">
                        <span class="station-metric__label">Chargers</span>
                        <span class="station-metric__value">${compatibleChargers}</span>
                    </div>
                    <div class="station-metric">
                        <span class="station-metric__label">Available</span>
                        <span class="station-metric__value">${availableChargers}</span>
                    </div>
                    <div class="station-metric">
                        <span class="station-metric__label">Reserved</span>
                        <span class="station-metric__value">${occupiedChargers}</span>
                    </div>
                    <div class="station-metric">
                        <span class="station-metric__label">Charging</span>
                        <span class="station-metric__value">${chargingChargers}</span>
                    </div>
                </div>

                <div class="station-card__footer">
                    <div>
                        <span class="station-card__price-label">Pricing</span>
                        <div class="station-card__price-value">${escapeHtml(pricing)}</div>
                    </div>
                    <button
                        type="button"
                        class="btn btn-primary btn-sm"
                        data-station-action="open-slots"
                        data-station-id="${Number(station.station_id) || 0}"
                        data-station-name="${escapeHtml(station.station_name)}"
                    >
                        Book
                    </button>
                </div>
            </article>
        </div>
    `;
}

function renderStationCollection(containerId, stations, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) {
        return;
    }

    if (!Array.isArray(stations) || stations.length === 0) {
        container.innerHTML = `<div class="col-12"><div class="empty-state">${escapeHtml(
            options.emptyMessage || "No stations available."
        )}</div></div>`;
        return;
    }

    const items = options.limit ? stations.slice(0, options.limit) : stations;
    container.innerHTML = items.map((station) => buildStationCard(station, Boolean(options.preview))).join("");

    container.querySelectorAll("[data-station-action='open-slots']").forEach((button) => {
        button.addEventListener("click", () => {
            const stationId = Number(button.dataset.stationId || 0);
            const stationName = button.dataset.stationName || "";
            switchTab("stations");
            toggleSlots(stationId, stationName, true);
        });
    });
}

function renderStations(stations) {
    renderStationCollection("stationsList", stations, {
        preview: true,
        limit: 4,
        emptyMessage: "No stations found for the current filter set.",
    });
    renderStationCollection("stationsFullList", stations, {
        emptyMessage: "No stations found for the current filter set.",
    });
}

const STATION_MAP_DEFAULT_CENTER = { lat: 20.2961, lng: 85.8245 };
const STATION_MAP_DEFAULT_LABEL = "Bhubaneswar, Odisha";
const STATION_MAP_DEFAULT_ZOOM = 12;
const STATION_MAP_NEARBY_ZOOM = 12;
const STATION_MAP_SUGGESTION_LIMIT = 5;
const STATION_MAP_MIN_SEARCH_LENGTH = 2;
const STATION_MAP_AUTO_NEARBY_RADIUS_KM = 50;

const stationMapState = {
    map: null,
    markers: [],
    pendingStations: [],
    pendingMapStations: [],
    searchMarker: null,
    searchCircle: null,
    syncingStationIds: new Set(),
    geocodeCache: new Map(),
    searchQueryCache: new Map(),
    reverseGeocodeCache: new Map(),
    searchSuggestions: [],
    highlightedSuggestionIndex: -1,
    suggestionAbortController: null,
    suggestionDebounceTimer: null,
    searchUiBound: false,
    stationsTabClickBound: false,
    searchBusy: false,
    distanceOriginPromise: null,
    distanceOriginUnavailable: false,
    autoLocateTriggered: false,
};

function getStationMapContainer() {
    return document.getElementById("stationMap");
}

function getStationMapMessage() {
    return document.getElementById("stationMapMessage");
}

function getStationMapSearchInput() {
    return document.getElementById("stationNearbySearch");
}

function getStationMapSearchMeta() {
    return document.getElementById("stationMapSearchMeta");
}

function getStationSearchSuggestionsContainer() {
    return document.getElementById("stationNearbySuggestions");
}

function getStationRadiusFilter() {
    return document.getElementById("stationRadiusFilter");
}

function getStationSearchButton() {
    return document.getElementById("stationNearbySearchBtn");
}

function getStationUseLocationButton() {
    return document.getElementById("stationUseLocationBtn");
}

function getStationClearNearbyButton() {
    return document.getElementById("stationClearNearbyBtn");
}

function getNearbyStationsToggle() {
    return document.getElementById("nearbyStationsToggle");
}

function formatDistanceKm(distanceKm) {
    if (distanceKm === null || distanceKm === undefined || distanceKm === "") {
        return "";
    }
    const parsed = Number(distanceKm);
    if (!Number.isFinite(parsed)) {
        return "";
    }
    if (parsed < 0.05) {
        return "Less than 0.1 km away";
    }
    return `${parsed.toFixed(parsed >= 10 ? 0 : 1)} km away`;
}

function haversineDistanceKm(latitudeA, longitudeA, latitudeB, longitudeB) {
    const lat1 = Number(latitudeA);
    const lon1 = Number(longitudeA);
    const lat2 = Number(latitudeB);
    const lon2 = Number(longitudeB);
    if (![lat1, lon1, lat2, lon2].every((value) => Number.isFinite(value))) {
        return null;
    }

    const toRadians = (value) => (value * Math.PI) / 180;
    const deltaLat = toRadians(lat2 - lat1);
    const deltaLon = toRadians(lon2 - lon1);
    const originLat = toRadians(lat1);
    const targetLat = toRadians(lat2);
    const haversine =
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(originLat) * Math.cos(targetLat) * Math.sin(deltaLon / 2) ** 2;

    return 6371 * 2 * Math.asin(Math.sqrt(haversine));
}

function setStationMapSearchMeta(message, isError = false) {
    const metaEl = getStationMapSearchMeta();
    if (!metaEl) {
        return;
    }
    metaEl.style.display = message ? "block" : "none";
    metaEl.textContent = message || "";
    metaEl.classList.toggle("is-error", Boolean(message) && isError);
}

function setStationMapMessage(message, isError = false) {
    const messageEl = getStationMapMessage();
    if (!messageEl) {
        return;
    }
    messageEl.style.display = message ? "block" : "none";
    messageEl.textContent = message || "";
    messageEl.classList.toggle("is-error", Boolean(message) && isError);
}

function getNearbyOrigin() {
    const origin = dashboardState.nearbyOrigin;
    if (!origin) {
        return null;
    }
    const latitude = Number(origin.latitude);
    const longitude = Number(origin.longitude);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function getDeviceDistanceOrigin() {
    const origin = dashboardState.deviceDistanceOrigin;
    if (!origin) {
        return null;
    }
    const latitude = Number(origin.latitude);
    const longitude = Number(origin.longitude);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function getDistanceOrigin() {
    return getNearbyOrigin() || getDeviceDistanceOrigin();
}

function getCurrentDistanceOriginLabel() {
    if (dashboardState.nearbyOrigin) {
        return dashboardState.nearbyLabel || "Current location";
    }
    if (dashboardState.deviceDistanceOrigin) {
        return "Current location";
    }
    return "";
}

function applyStationFallbackOrigin() {
    updateNearbyOrigin(
        STATION_MAP_DEFAULT_CENTER.lat,
        STATION_MAP_DEFAULT_CENTER.lng,
        STATION_MAP_DEFAULT_LABEL
    );
    dashboardState.deviceDistanceOrigin = {
        latitude: STATION_MAP_DEFAULT_CENTER.lat,
        longitude: STATION_MAP_DEFAULT_CENTER.lng,
    };
    const searchInput = getStationMapSearchInput();
    if (searchInput && !searchInput.value.trim()) {
        searchInput.value = STATION_MAP_DEFAULT_LABEL;
    }
    return {
        latitude: STATION_MAP_DEFAULT_CENTER.lat,
        longitude: STATION_MAP_DEFAULT_CENTER.lng,
    };
}

async function ensureStationDistanceOrigin() {
    const existingOrigin = getDistanceOrigin();
    if (existingOrigin) {
        return existingOrigin;
    }
    if (stationMapState.distanceOriginUnavailable || !navigator.geolocation) {
        return applyStationFallbackOrigin();
    }
    if (stationMapState.distanceOriginPromise) {
        return stationMapState.distanceOriginPromise;
    }

    stationMapState.distanceOriginPromise = new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                dashboardState.deviceDistanceOrigin = {
                    latitude: Number(position.coords.latitude),
                    longitude: Number(position.coords.longitude),
                };
                stationMapState.distanceOriginPromise = null;
                resolve(getDeviceDistanceOrigin());
            },
            () => {
                stationMapState.distanceOriginUnavailable = true;
                stationMapState.distanceOriginPromise = null;
                resolve(applyStationFallbackOrigin());
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 300000,
            }
        );
    });

    return stationMapState.distanceOriginPromise;
}

function renderStationsLoadingState() {
    const previewContainer = document.getElementById("stationsList");
    const fullContainer = document.getElementById("stationsFullList");

    if (previewContainer) {
        previewContainer.innerHTML = `<div class="col-12">${buildLoadingState("Loading nearby stations...")}</div>`;
    }
    if (fullContainer) {
        fullContainer.innerHTML = `<div class="col-12">${buildLoadingState("Loading station results...")}</div>`;
    }

    setStationMapMessage("Loading station coverage...");
}

async function primeStationCurrentLocation(options = {}) {
    const { refreshStations = false } = options;
    const existingOrigin = getDistanceOrigin();
    if (existingOrigin) {
        return existingOrigin;
    }
    if (stationMapState.distanceOriginUnavailable || !navigator.geolocation) {
        stationMapState.autoLocateTriggered = true;
        return applyStationFallbackOrigin();
    }

    stationMapState.autoLocateTriggered = true;

    const origin = await ensureStationDistanceOrigin();
    if (!origin) {
        return null;
    }

    if (!dashboardState.nearbyOrigin) {
        updateNearbyOrigin(origin.latitude, origin.longitude, "Current location");
        const searchInput = getStationMapSearchInput();
        if (searchInput && !searchInput.value.trim()) {
            searchInput.value = "Current location";
        }
    }

    reverseGeocodeStationLocation(origin.latitude, origin.longitude)
        .then((resolvedLabel) => {
            if (!resolvedLabel) {
                return;
            }
            if (dashboardState.nearbyOrigin) {
                dashboardState.nearbyLabel = resolvedLabel;
            }
            const searchInput = getStationMapSearchInput();
            if (searchInput && (!searchInput.value.trim() || searchInput.value.trim() === "Current location")) {
                searchInput.value = resolvedLabel;
            }
        })
        .catch(() => {
            // Best-effort label enhancement for the current location.
        });

    if (refreshStations) {
        window.setTimeout(() => {
            loadStations().catch(() => {
                // The regular stations loader will surface any user-facing errors.
            });
        }, 0);
    }

    return origin;
}

function getStationRadiusKm() {
    const rawValue = getStationRadiusFilter()?.value;
    const parsed = rawValue !== undefined && rawValue !== null && rawValue !== ""
        ? Number(rawValue)
        : Number(dashboardState.nearbyRadiusKm);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function shouldUseNearbyStations() {
    return Boolean(getNearbyStationsToggle()?.checked);
}

function syncNearbyUiState() {
    const radiusFilter = getStationRadiusFilter();
    const nearbyToggle = getNearbyStationsToggle();
    const searchInput = getStationMapSearchInput();

    if (radiusFilter) {
        const radiusValue = Number(dashboardState.nearbyRadiusKm);
        radiusFilter.value = Number.isFinite(radiusValue) && radiusValue > 0 ? String(radiusValue) : "";
    }
    if (nearbyToggle) {
        nearbyToggle.checked = Boolean(dashboardState.stationNearbyOnly);
    }
    if (searchInput && dashboardState.nearbyLabel && !searchInput.value.trim()) {
        searchInput.value = dashboardState.nearbyLabel;
    }
}

function updateNearbyOrigin(latitude, longitude, label = "") {
    dashboardState.nearbyOrigin = {
        latitude: Number(latitude),
        longitude: Number(longitude),
    };
    dashboardState.nearbyLabel = label || "";
    dashboardState.nearbyRadiusKm = getStationRadiusKm();
    dashboardState.stationNearbyOnly = true;
    syncNearbyUiState();
}

function clearNearbyOrigin() {
    dashboardState.nearbyOrigin = null;
    dashboardState.nearbyLabel = "";
}

function setStationSearchBusy(isBusy, contextLabel = "") {
    stationMapState.searchBusy = Boolean(isBusy);
    const searchButton = getStationSearchButton();
    const useLocationButton = getStationUseLocationButton();
    const clearButton = getStationClearNearbyButton();
    const searchInput = getStationMapSearchInput();

    [searchButton, useLocationButton, clearButton, searchInput].forEach((element) => {
        if (!element) {
            return;
        }
        element.disabled = Boolean(isBusy);
    });

    if (searchButton) {
        searchButton.innerHTML = isBusy
            ? `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>${contextLabel || "Working"}`
            : `<i class="bi bi-search"></i>Search`;
    }
    if (useLocationButton) {
        useLocationButton.innerHTML = isBusy
            ? `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>Locating`
            : `<i class="bi bi-crosshair"></i>Use my location`;
    }
}

function normalizeStationSearchResult(result) {
    const latitude = Number(result?.lat);
    const longitude = Number(result?.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
    }

    const displayName = String(result?.display_name || "").trim();
    const segments = displayName
        .split(",")
        .map((segment) => segment.trim())
        .filter(Boolean);
    const primaryLabel = segments[0] || result?.name || "Selected location";
    const secondaryLabel = segments.slice(1).join(", ");

    return {
        latitude,
        longitude,
        label: displayName || primaryLabel,
        primaryLabel,
        secondaryLabel,
    };
}

function hideStationSearchSuggestions() {
    const suggestionsContainer = getStationSearchSuggestionsContainer();
    if (!suggestionsContainer) {
        return false;
    }
    suggestionsContainer.hidden = true;
    suggestionsContainer.innerHTML = "";
    stationMapState.searchSuggestions = [];
    stationMapState.highlightedSuggestionIndex = -1;
    return true;
}

function updateStationSearchSuggestionHighlight() {
    const suggestionsContainer = getStationSearchSuggestionsContainer();
    if (!suggestionsContainer) {
        return;
    }

    suggestionsContainer.querySelectorAll(".station-search-suggestion").forEach((button, index) => {
        const isActive = index === stationMapState.highlightedSuggestionIndex;
        button.classList.toggle("is-active", isActive);
        if (isActive) {
            button.scrollIntoView({ block: "nearest" });
        }
    });
}

function renderStationSearchSuggestions(suggestions) {
    const suggestionsContainer = getStationSearchSuggestionsContainer();
    if (!suggestionsContainer) {
        return;
    }

    if (!Array.isArray(suggestions) || suggestions.length === 0) {
        hideStationSearchSuggestions();
        return;
    }

    stationMapState.searchSuggestions = suggestions;
    stationMapState.highlightedSuggestionIndex = -1;
    suggestionsContainer.innerHTML = suggestions
        .map(
            (suggestion, index) => `
                <button
                    type="button"
                    class="station-search-suggestion"
                    data-station-suggestion-index="${index}"
                    role="option"
                >
                    <span class="station-search-suggestion__title">${escapeHtml(suggestion.primaryLabel || suggestion.label)}</span>
                    ${
                        suggestion.secondaryLabel
                            ? `<span class="station-search-suggestion__meta">${escapeHtml(suggestion.secondaryLabel)}</span>`
                            : ""
                    }
                </button>
            `
        )
        .join("");
    suggestionsContainer.hidden = false;
    suggestionsContainer.querySelectorAll("[data-station-suggestion-index]").forEach((button) => {
        button.addEventListener("click", async () => {
            const suggestionIndex = Number(button.dataset.stationSuggestionIndex || -1);
            const suggestion = stationMapState.searchSuggestions[suggestionIndex];
            if (suggestion) {
                await applyStationSearchSelection(suggestion);
            }
        });
    });
}

function initializeStationMap() {
    const container = getStationMapContainer();
    if (!container || stationMapState.map) {
        return;
    }

    stationMapState.map = L.map(container, {
        zoomControl: true,
        attributionControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
    }).addTo(stationMapState.map);
    stationMapState.map.setView([STATION_MAP_DEFAULT_CENTER.lat, STATION_MAP_DEFAULT_CENTER.lng], STATION_MAP_DEFAULT_ZOOM);
}

function refreshStationMapLayout() {
    if (!stationMapState.map) {
        return;
    }
    window.requestAnimationFrame(() => {
        stationMapState.map.invalidateSize(false);
    });
}

function bindStationTabRefresh() {
    if (stationMapState.stationsTabClickBound) {
        return;
    }

    document.addEventListener("click", (event) => {
        const trigger = event.target.closest("[data-tab], [data-tab-trigger], [data-tab-target]");
        if (!trigger) {
            return;
        }
        const targetTab = trigger.dataset.tab || trigger.dataset.tabTrigger || trigger.dataset.tabTarget;
        if (targetTab === "stations") {
            window.setTimeout(refreshStationMapLayout, 140);
        }
    });
    window.addEventListener("resize", refreshStationMapLayout);
    stationMapState.stationsTabClickBound = true;
}

function initializeStationSearchUi() {
    const searchInput = getStationMapSearchInput();
    if (!searchInput || stationMapState.searchUiBound) {
        return;
    }

    searchInput.setAttribute("autocomplete", "off");
    searchInput.setAttribute("spellcheck", "false");
    searchInput.addEventListener("input", handleStationSearchInputEvent);
    searchInput.addEventListener("focus", () => {
        if (stationMapState.searchSuggestions.length > 0) {
            renderStationSearchSuggestions(stationMapState.searchSuggestions);
        }
    });
    document.addEventListener("click", (event) => {
        if (!event.target.closest(".station-search-shell")) {
            hideStationSearchSuggestions();
        }
    });
    bindStationTabRefresh();
    stationMapState.searchUiBound = true;
}

function ensureLeafletLoaded() {
    initializeStationSearchUi();
    if (window.L?.map) {
        if (!stationMapState.map) {
            initializeStationMap();
        }
        refreshStationMapLayout();
        return true;
    }

    setStationMapMessage("Map library is unavailable right now. Reload the page and check your network access.", true);
    setStationMapSearchMeta("Nearby filtering works without API keys, but the visual map still needs the Leaflet assets to load.", true);
    return false;
}

async function fetchStationLocationSearch(queryText, limit = STATION_MAP_SUGGESTION_LIMIT, signal = undefined) {
    const trimmedQuery = String(queryText || "").trim();
    if (!trimmedQuery) {
        return [];
    }

    const cacheKey = `${trimmedQuery.toLowerCase()}::${limit}`;
    if (!signal && stationMapState.searchQueryCache.has(cacheKey)) {
        return stationMapState.searchQueryCache.get(cacheKey);
    }

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("q", trimmedQuery);

    const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
            Accept: "application/json",
        },
        signal,
    });
    if (!response.ok) {
        throw new Error("Location search is unavailable right now.");
    }

    const results = await response.json();
    const normalizedResults = (Array.isArray(results) ? results : []).map(normalizeStationSearchResult).filter(Boolean);
    if (!signal) {
        stationMapState.searchQueryCache.set(cacheKey, normalizedResults);
    }
    return normalizedResults;
}

async function reverseGeocodeStationLocation(latitude, longitude) {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
    }

    const cacheKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (stationMapState.reverseGeocodeCache.has(cacheKey)) {
        return stationMapState.reverseGeocodeCache.get(cacheKey);
    }

    const requestPromise = (async () => {
        const url = new URL("https://nominatim.openstreetmap.org/reverse");
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("lat", String(lat));
        url.searchParams.set("lon", String(lon));

        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                Accept: "application/json",
            },
        });
        if (!response.ok) {
            return null;
        }

        const result = await response.json();
        const displayName = String(result?.display_name || "").trim();
        return displayName || null;
    })().catch(() => null);

    stationMapState.reverseGeocodeCache.set(cacheKey, requestPromise);
    return requestPromise;
}

async function handleStationSearchInputEvent(event) {
    const queryText = event.target.value.trim();
    if (queryText.length < STATION_MAP_MIN_SEARCH_LENGTH) {
        if (stationMapState.suggestionDebounceTimer) {
            window.clearTimeout(stationMapState.suggestionDebounceTimer);
            stationMapState.suggestionDebounceTimer = null;
        }
        if (stationMapState.suggestionAbortController) {
            stationMapState.suggestionAbortController.abort();
        }
        hideStationSearchSuggestions();
        return;
    }

    if (stationMapState.suggestionDebounceTimer) {
        window.clearTimeout(stationMapState.suggestionDebounceTimer);
    }

    stationMapState.suggestionDebounceTimer = window.setTimeout(async () => {
        if (stationMapState.suggestionAbortController) {
            stationMapState.suggestionAbortController.abort();
        }
        stationMapState.suggestionAbortController = new AbortController();

        try {
            const suggestions = await fetchStationLocationSearch(
                queryText,
                STATION_MAP_SUGGESTION_LIMIT,
                stationMapState.suggestionAbortController.signal
            );
            renderStationSearchSuggestions(suggestions);
        } catch (error) {
            if (error.name !== "AbortError") {
                hideStationSearchSuggestions();
            }
        }
    }, 220);
}

function handleStationSearchKeydown(event) {
    const suggestions = stationMapState.searchSuggestions;
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
        if (event.key === "Enter") {
            event.preventDefault();
            handleStationNearbySearch();
        }
        return;
    }

    if (event.key === "ArrowDown") {
        event.preventDefault();
        stationMapState.highlightedSuggestionIndex =
            (stationMapState.highlightedSuggestionIndex + 1 + suggestions.length) % suggestions.length;
        updateStationSearchSuggestionHighlight();
        return;
    }

    if (event.key === "ArrowUp") {
        event.preventDefault();
        stationMapState.highlightedSuggestionIndex =
            (stationMapState.highlightedSuggestionIndex - 1 + suggestions.length) % suggestions.length;
        updateStationSearchSuggestionHighlight();
        return;
    }

    if (event.key === "Escape") {
        hideStationSearchSuggestions();
        return;
    }

    if (event.key === "Enter") {
        event.preventDefault();
        const selectedSuggestion =
            stationMapState.highlightedSuggestionIndex >= 0
                ? suggestions[stationMapState.highlightedSuggestionIndex]
                : suggestions[0];
        if (selectedSuggestion) {
            applyStationSearchSelection(selectedSuggestion);
        } else {
            handleStationNearbySearch();
        }
    }
}

async function applyStationSearchSelection(selection) {
    const searchInput = getStationMapSearchInput();
    const label = selection?.label || selection?.primaryLabel || "Selected location";
    if (searchInput) {
        searchInput.value = label;
    }

    hideStationSearchSuggestions();
    updateNearbyOrigin(selection.latitude, selection.longitude, label);
    setStationMapMessage("");
    setStationMapSearchMeta(`Centered on ${label}.`);
    await loadStations();
    if (dashboardState.bookingNearbyOnly && typeof loadMyBookings === "function") {
        await loadMyBookings(bookingViewState.customer);
    }
    if (dashboardState.ownerNearbyOnly && typeof window.applyOwnerNearbyStationFilter === "function") {
        window.applyOwnerNearbyStationFilter();
    }
}

function clearStationMarkers() {
    stationMapState.markers.forEach((marker) => {
        stationMapState.map?.removeLayer(marker);
    });
    stationMapState.markers = [];
}

function clearStationSearchOverlay() {
    if (stationMapState.searchMarker) {
        stationMapState.map?.removeLayer(stationMapState.searchMarker);
        stationMapState.searchMarker = null;
    }
    if (stationMapState.searchCircle) {
        stationMapState.map?.removeLayer(stationMapState.searchCircle);
        stationMapState.searchCircle = null;
    }
}

function updateStationSearchOverlay(origin) {
    if (!stationMapState.map) {
        return;
    }
    clearStationSearchOverlay();
    if (!origin) {
        return;
    }

    const center = [origin.latitude, origin.longitude];
    const radiusKm = getStationRadiusKm();
    if (radiusKm > 0) {
        stationMapState.searchCircle = L.circle(center, {
            radius: radiusKm * 1000,
            color: "#0f9f8f",
            weight: 1.5,
            fillColor: "#14b8a6",
            fillOpacity: 0.12,
        }).addTo(stationMapState.map);
    }
    stationMapState.searchMarker = L.circleMarker(center, {
        radius: 7,
        color: "#ffffff",
        weight: 3,
        fillColor: "#0f9f8f",
        fillOpacity: 1,
    })
        .bindTooltip(getCurrentDistanceOriginLabel() || "Current location", {
            direction: "top",
            offset: [0, -8],
        })
        .addTo(stationMapState.map);
}

function getStationMarkerPresentation(station) {
    const availabilityStatus = String(station.availability_status || "").toLowerCase();
    if (availabilityStatus === "available") {
        return {
            fillColor: "#16a34a",
            statusLabel: "Available",
        };
    }
    if (availabilityStatus === "out_of_service") {
        return {
            fillColor: "#dc2626",
            statusLabel: "Out of service",
        };
    }
    if (availabilityStatus === "busy") {
        return {
            fillColor: "#f59e0b",
            statusLabel: "Busy",
        };
    }
    return {
        fillColor: "#2563eb",
        statusLabel: normalizeStatusLabel(availabilityStatus || "station"),
    };
}

function parseStationCoordinates(station) {
    const latitude = Number(station.latitude ?? station.lat);
    const longitude = Number(station.longitude ?? station.lng);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

async function persistStationCoordinates(stationId, position) {
    const numericStationId = Number(stationId || 0);
    if (!numericStationId || !position || stationMapState.syncingStationIds.has(numericStationId)) {
        return;
    }

    stationMapState.syncingStationIds.add(numericStationId);
    try {
        await apiRequest(
            `/api/stations/${numericStationId}/coordinates`,
            {
                method: "PUT",
                body: JSON.stringify({
                    latitude: position.lat,
                    longitude: position.lng,
                }),
            },
            true
        );
    } catch (_error) {
        // Coordinate sync is best-effort.
    } finally {
        stationMapState.syncingStationIds.delete(numericStationId);
    }
}

function resolveStationPosition(station) {
    const coordinates = parseStationCoordinates(station);
    if (coordinates) {
        return Promise.resolve({ lat: coordinates.latitude, lng: coordinates.longitude });
    }
    const address = station.location || station.station_name;
    if (!address) {
        return Promise.resolve(null);
    }
    const cacheKey = String(address).trim().toLowerCase();
    if (!stationMapState.geocodeCache.has(cacheKey)) {
        stationMapState.geocodeCache.set(
            cacheKey,
            fetchStationLocationSearch(address, 1)
                .then((results) => {
                    const [match] = results;
                    if (!match) {
                        return null;
                    }
                    const resolvedPosition = { lat: match.latitude, lng: match.longitude };
                    persistStationCoordinates(station.station_id, resolvedPosition);
                    return resolvedPosition;
                })
                .catch(() => null)
        );
    }
    return stationMapState.geocodeCache.get(cacheKey);
}

function buildMapInfoWindow(station, distanceLabel) {
    const chargerCount = Number(station.charger_count ?? station.total_slots ?? station.matching_slots ?? 0) || 0;
    const meta = [distanceLabel, `${chargerCount} chargers`].filter(Boolean).join(" | ");
    const markerPresentation = getStationMarkerPresentation(station);
    return `<div class="map-infowindow"><strong>${escapeHtml(station.station_name || "EV Station")}</strong><br>${escapeHtml(
        station.location || "Location unavailable"
    )}${meta ? `<div class="map-infowindow__meta">${escapeHtml(meta)}</div>` : ""}<div class="map-infowindow__status" style="color:${escapeHtml(
        markerPresentation.fillColor
    )};"><span class="map-infowindow__status-dot" aria-hidden="true"></span>${escapeHtml(markerPresentation.statusLabel)}</div></div>`;
}

async function geocodeStationSearch(queryText) {
    const results = await fetchStationLocationSearch(queryText, 1);
    if (!results.length) {
        throw new Error("Location not found.");
    }
    return results[0];
}

async function resolveMapStations(mapStations, fallbackStations) {
    const mergedStations = new Map();
    const origin = getDistanceOrigin();

    (Array.isArray(mapStations) ? mapStations : []).forEach((station) => {
        mergedStations.set(Number(station.station_id), { ...station });
    });

    for (const station of Array.isArray(fallbackStations) ? fallbackStations : []) {
        const stationId = Number(station.station_id || 0);
        const existing = mergedStations.get(stationId);
        if (existing) {
            mergedStations.set(stationId, { ...station, ...existing });
            continue;
        }

        const position = await resolveStationPosition(station);
        if (!position) {
            continue;
        }

        const fallbackDistanceKm =
            station.distance_km === null || station.distance_km === undefined || station.distance_km === ""
                ? null
                : Number(station.distance_km);
        const distanceKm = origin
            ? haversineDistanceKm(origin.latitude, origin.longitude, position.lat, position.lng)
            : fallbackDistanceKm;
        mergedStations.set(stationId, {
            ...station,
            latitude: position.lat,
            longitude: position.lng,
            distance_km: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(2)) : null,
            charger_count: Number(station.total_slots ?? station.matching_slots ?? 0) || 0,
        });
    }

    return Array.from(mergedStations.values());
}

async function applyDistanceOriginToStations(stations, origin) {
    if (!Array.isArray(stations) || stations.length === 0 || !origin) {
        return Array.isArray(stations) ? stations : [];
    }

    const resolvedStations = await resolveMapStations([], stations);
    const resolvedById = new Map(
        resolvedStations.map((station) => [Number(station.station_id || 0), station])
    );

    return stations.map((station) => {
        const resolvedStation = resolvedById.get(Number(station.station_id || 0)) || station;
        const position = parseStationCoordinates(resolvedStation);
        if (!position) {
            return resolvedStation;
        }

        const distanceKm = haversineDistanceKm(origin.latitude, origin.longitude, position.latitude, position.longitude);
        return {
            ...resolvedStation,
            latitude: position.latitude,
            longitude: position.longitude,
            distance_km: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(2)) : null,
        };
    });
}

async function filterStationsByNearbyOrigin(stations, origin, radiusKm) {
    if (!Array.isArray(stations) || !origin) {
        return Array.isArray(stations) ? stations : [];
    }

    const effectiveRadiusKm = radiusKm > 0 ? radiusKm : STATION_MAP_AUTO_NEARBY_RADIUS_KM;
    const resolvedStations = await resolveMapStations([], stations);
    return resolvedStations
        .map((station) => {
            const position = parseStationCoordinates(station);
            if (!position) {
                return null;
            }

            const distanceKm = haversineDistanceKm(origin.latitude, origin.longitude, position.latitude, position.longitude);
            if (!Number.isFinite(distanceKm)) {
                return null;
            }
            if (distanceKm > effectiveRadiusKm) {
                return null;
            }

            return {
                ...station,
                latitude: position.latitude,
                longitude: position.longitude,
                distance_km: Number(distanceKm.toFixed(2)),
            };
        })
        .filter(Boolean)
        .sort((stationA, stationB) => Number(stationA.distance_km || 0) - Number(stationB.distance_km || 0));
}

async function renderStationsMap(mapStations, fallbackStations = []) {
    const container = getStationMapContainer();
    if (!container) {
        return;
    }
    initializeStationSearchUi();
    stationMapState.pendingStations = Array.isArray(fallbackStations) ? fallbackStations : [];
    stationMapState.pendingMapStations = Array.isArray(mapStations) ? mapStations : [];
    if (!ensureLeafletLoaded()) {
        return;
    }
    if (!stationMapState.map) {
        return;
    }
    clearStationMarkers();
    const origin = getDistanceOrigin();
    updateStationSearchOverlay(origin);
    const resolvedStations = await resolveMapStations(stationMapState.pendingMapStations, stationMapState.pendingStations);
    const markerPoints = [];

    for (const station of resolvedStations) {
        const position = parseStationCoordinates(station);
        if (!position) {
            continue;
        }

        const distanceLabel = formatDistanceKm(station.distance_km);
        const markerPresentation = getStationMarkerPresentation(station);
        const marker = L.circleMarker([position.latitude, position.longitude], {
            radius: 8,
            color: "#ffffff",
            weight: 2,
            fillColor: markerPresentation.fillColor,
            fillOpacity: 0.92,
        })
            .bindPopup(buildMapInfoWindow(station, distanceLabel))
            .addTo(stationMapState.map);
        stationMapState.markers.push(marker);
        markerPoints.push([position.latitude, position.longitude]);
    }

    refreshStationMapLayout();

    if (markerPoints.length > 0) {
        const boundsPoints = origin
            ? [[origin.latitude, origin.longitude], ...markerPoints]
            : markerPoints;
        if (boundsPoints.length === 1) {
            stationMapState.map.setView(boundsPoints[0], origin ? STATION_MAP_NEARBY_ZOOM : 13);
        } else {
            stationMapState.map.fitBounds(boundsPoints, {
                padding: [50, 50],
                maxZoom: 14,
            });
        }
        setStationMapMessage("");
        if (origin && resolvedStations.length > 0) {
            const radiusKm = getStationRadiusKm();
            const nearbyLabel = getCurrentDistanceOriginLabel() || "your current location";
            setStationMapSearchMeta(
                radiusKm > 0
                    ? `${resolvedStations.length} station${resolvedStations.length === 1 ? "" : "s"} within ${radiusKm} km of ${nearbyLabel}.`
                    : `${resolvedStations.length} station${resolvedStations.length === 1 ? "" : "s"} near ${nearbyLabel}.`
            );
        }
    } else {
        const fallbackCenter = origin
            ? [origin.latitude, origin.longitude]
            : [STATION_MAP_DEFAULT_CENTER.lat, STATION_MAP_DEFAULT_CENTER.lng];
        stationMapState.map.setView(fallbackCenter, origin ? STATION_MAP_NEARBY_ZOOM : STATION_MAP_DEFAULT_ZOOM);
        const radiusKm = getStationRadiusKm();
        const nearbyLabel = getCurrentDistanceOriginLabel() || "your current location";
        setStationMapMessage(
            origin && shouldUseNearbyStations()
                ? radiusKm > 0
                    ? `No stations within ${radiusKm} km of ${nearbyLabel}.`
                    : `No stations near ${nearbyLabel}.`
                : "No station locations found for the current filters."
        );
    }
}

async function loadStationMapLocations(query) {
    try {
        const suffix = query.toString() ? `?${query.toString()}` : "";
        return await apiRequest(`/api/stations/locations${suffix}`, { method: "GET" }, true);
    } catch (_error) {
        return [];
    }
}

async function loadStations() {
    syncNearbyUiState();
    renderStationsLoadingState();
    const locationFilter = document.getElementById("locationFilter")?.value.trim() || "";
    const slotTypeFilter = document.getElementById("slotTypeFilter")?.value.trim() || "";
    const vehicleCategoryFilter = normalizeVehicleCategory(
        document.getElementById("vehicleCategoryFilter")?.value.trim() || ""
    );
    let origin = getNearbyOrigin();
    const useNearby = shouldUseNearbyStations();
    const radiusKm = getStationRadiusKm();

    dashboardState.stationNearbyOnly = useNearby;
    dashboardState.nearbyRadiusKm = radiusKm;

    if (useNearby && !origin) {
        origin = await primeStationCurrentLocation();
    }

    const query = new URLSearchParams();
    if (locationFilter) {
        query.append("location", locationFilter);
    }
    if (slotTypeFilter) {
        query.append("slot_type", slotTypeFilter);
    }
    if (vehicleCategoryFilter) {
        query.append("vehicle_category", vehicleCategoryFilter);
    }

    if (useNearby && origin && radiusKm > 0) {
        setStationMapSearchMeta(
            `Using ${dashboardState.nearbyLabel || "your nearby search"} within ${radiusKm} km for station results.`
        );
    } else if (useNearby && origin) {
        setStationMapSearchMeta(`Showing nearby stations for ${dashboardState.nearbyLabel || "your selected location"}.`);
    } else if (useNearby) {
        setStationMapSearchMeta("Search for a location or use your current location to find nearby stations.");
    } else {
        setStationMapSearchMeta("");
    }

    try {
        const stations = await apiRequest(`/api/bookings/stations${query.toString() ? `?${query.toString()}` : ""}`, { method: "GET" }, true);
        let renderableStations = Array.isArray(stations) ? stations : [];
        const distanceOrigin = origin || getDeviceDistanceOrigin();

        if (useNearby && origin) {
            renderableStations = await filterStationsByNearbyOrigin(renderableStations, origin, radiusKm);
        } else if (distanceOrigin) {
            renderableStations = await applyDistanceOriginToStations(renderableStations, distanceOrigin);
        }

        renderStations(renderableStations);
        await renderStationsMap(renderableStations, renderableStations);
        updateDashboardSummaryState({ stations: renderableStations });
    } catch (error) {
        const errorMessage = error.message || "Failed to load stations.";
        renderStationCollection("stationsList", [], { preview: true, emptyMessage: errorMessage });
        renderStationCollection("stationsFullList", [], { emptyMessage: errorMessage });
        await renderStationsMap([], []);
        setStationMapMessage(errorMessage, true);
    }
}

async function syncRelatedNearbyViews() {
    if (dashboardState.bookingNearbyOnly && typeof loadMyBookings === "function") {
        await loadMyBookings(bookingViewState.customer);
    }
    if (dashboardState.ownerNearbyOnly && typeof window.applyOwnerNearbyStationFilter === "function") {
        window.applyOwnerNearbyStationFilter();
    }
}

async function handleStationNearbySearch() {
    const searchInput = getStationMapSearchInput();
    const queryText = searchInput?.value.trim() || "";
    if (!queryText) {
        setStationMapSearchMeta("Enter a location to search nearby stations.", true);
        return;
    }

    try {
        setStationSearchBusy(true, "Searching");
        const geocodedResult = await geocodeStationSearch(queryText);
        if (!geocodedResult) {
            return;
        }
        updateNearbyOrigin(geocodedResult.latitude, geocodedResult.longitude, geocodedResult.label);
        setStationMapSearchMeta(`Centered on ${geocodedResult.label}.`);
        await loadStations();
        await syncRelatedNearbyViews();
    } catch (error) {
        setStationMapSearchMeta(error.message || "Location not found.", true);
        setStationMapMessage("Location not found. Try a more specific city or address.", true);
    } finally {
        setStationSearchBusy(false);
    }
}

async function handleStationUseMyLocation() {
    if (!navigator.geolocation) {
        const fallbackOrigin = applyStationFallbackOrigin();
        setStationMapSearchMeta(`Location access is unavailable. Showing ${STATION_MAP_DEFAULT_LABEL}.`);
        await loadStations();
        await syncRelatedNearbyViews();
        return fallbackOrigin;
    }

    setStationMapSearchMeta("Detecting your current location...");
    setStationSearchBusy(true, "Locating");
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            try {
                const searchInput = getStationMapSearchInput();
                hideStationSearchSuggestions();
                const resolvedLabel =
                    (await reverseGeocodeStationLocation(position.coords.latitude, position.coords.longitude)) || "Current location";
                if (searchInput) {
                    searchInput.value = resolvedLabel;
                }
                updateNearbyOrigin(position.coords.latitude, position.coords.longitude, resolvedLabel);
                setStationMapSearchMeta(`Using ${resolvedLabel}.`);
                await loadStations();
                await syncRelatedNearbyViews();
            } catch (_error) {
                setStationMapSearchMeta("Unable to use your current location right now.", true);
            } finally {
                setStationSearchBusy(false);
            }
        },
        (error) => {
            applyStationFallbackOrigin();
            const message =
                error.code === error.PERMISSION_DENIED
                    ? `Location permission was denied. Showing ${STATION_MAP_DEFAULT_LABEL}.`
                    : `Unable to read your current location. Showing ${STATION_MAP_DEFAULT_LABEL}.`;
            setStationMapSearchMeta(message);
            Promise.resolve(loadStations())
                .then(() => syncRelatedNearbyViews())
                .finally(() => {
                    setStationSearchBusy(false);
                });
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000,
        }
    );
}

async function handleStationClearNearby() {
    const searchInput = getStationMapSearchInput();
    const radiusFilter = getStationRadiusFilter();
    const nearbyToggle = getNearbyStationsToggle();
    const nearbyBookingsToggle = document.getElementById("nearbyBookingsToggle");
    const ownerNearbyStationsToggle = document.getElementById("ownerNearbyStationsToggle");

    clearNearbyOrigin();
    dashboardState.nearbyRadiusKm = 0;
    dashboardState.stationNearbyOnly = true;
    dashboardState.bookingNearbyOnly = false;
    dashboardState.ownerNearbyOnly = false;
    if (searchInput) {
        searchInput.value = "";
    }
    if (radiusFilter) {
        radiusFilter.value = "";
    }
    if (nearbyToggle) {
        nearbyToggle.checked = true;
    }
    if (nearbyBookingsToggle) {
        nearbyBookingsToggle.checked = false;
    }
    if (ownerNearbyStationsToggle) {
        ownerNearbyStationsToggle.checked = false;
    }
    hideStationSearchSuggestions();
    setStationMapSearchMeta("");
    setStationMapMessage("");
    await loadStations();
    if (typeof loadMyBookings === "function") {
        await loadMyBookings(bookingViewState.customer);
    }
    if (typeof window.applyOwnerNearbyStationFilter === "function") {
        window.applyOwnerNearbyStationFilter();
    }
}

window.primeStationCurrentLocation = primeStationCurrentLocation;

window.haversineDistanceKm = haversineDistanceKm;

function syncSlotPaymentUi(slotId) {
    const paymentMethodField = document.getElementById(`payment-method-${slotId}`);
    const paymentOkField = document.getElementById(`payment-ok-${slotId}`);
    const paymentLabel = document.getElementById(`payment-ok-label-${slotId}`);
    const paymentNote = document.getElementById(`payment-note-${slotId}`);
    if (!paymentMethodField || !paymentOkField) {
        return;
    }

    const paymentMethod = String(paymentMethodField.value || "upi").trim().toLowerCase();
    const wasDisabled = paymentOkField.disabled;
    if (paymentMethod === "cash") {
        paymentOkField.checked = false;
        paymentOkField.disabled = true;
        if (paymentLabel) {
            paymentLabel.textContent = "Cash settles after charging completes";
        }
        if (paymentNote) {
            paymentNote.textContent = "Cash bookings stay pending until the charging session is completed.";
        }
        return;
    }

    paymentOkField.disabled = false;
    if (wasDisabled) {
        paymentOkField.checked = true;
    }
    if (paymentLabel) {
        paymentLabel.textContent = "Payment successful (simulated)";
    }
    if (paymentNote) {
        paymentNote.textContent = "Use this simulated confirmation for UPI or card before booking.";
    }
}

function buildSlotBookingForm(slot, minDatetime) {
    const role = getRole();
    if (role !== CUSTOMER_ROLE && role !== OWNER_ROLE) {
        return "";
    }

    const currentStatus = String(slot.current_status || slot.status || "").toLowerCase();
    if (currentStatus === "out_of_service") {
        return `<div class="slot-session-note slot-session-note--danger">Booking unavailable while this charger is out of service.</div>`;
    }

    const vehicleCategory = normalizeVehicleCategory(slot.vehicle_category) || VEHICLE_CATEGORY_CAR;
    const defaultBattery = DEFAULT_BATTERY_BY_CATEGORY[vehicleCategory] || "";

    return `
        <div class="slot-booking-form">
            <input type="datetime-local" id="start-${slot.slot_id}" class="form-control" min="${minDatetime}">
            <input type="hidden" id="vehicle-category-${slot.slot_id}" value="${escapeHtml(vehicleCategory)}">
            <div class="slot-booking-form__meta">
                Compatible vehicle: <strong>${escapeHtml(normalizeVehicleCategoryLabel(vehicleCategory))}</strong>
            </div>
            <input
                type="number"
                id="battery-${slot.slot_id}"
                class="form-control"
                min="1"
                step="0.1"
                required
                placeholder="Battery capacity (kWh, e.g. ${defaultBattery})"
            >
            <input
                type="number"
                id="current-${slot.slot_id}"
                class="form-control"
                min="0"
                max="99"
                step="0.1"
                required
                placeholder="Current battery (%)"
            >
            <input
                type="number"
                id="target-${slot.slot_id}"
                class="form-control"
                min="1"
                max="100"
                step="0.1"
                required
                placeholder="Target battery (%)"
            >
            <select id="payment-method-${slot.slot_id}" class="form-select">
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
            </select>
            <div class="form-check mb-2">
                <input class="form-check-input" type="checkbox" id="payment-ok-${slot.slot_id}" checked>
                <label class="form-check-label" id="payment-ok-label-${slot.slot_id}" for="payment-ok-${slot.slot_id}">
                    Payment successful (simulated)
                </label>
            </div>
            <div id="payment-note-${slot.slot_id}" class="small text-muted mb-3">Use this simulated confirmation for UPI or card before booking.</div>
            <div id="estimate-${slot.slot_id}" class="small text-muted mb-3">Enter battery details to see estimate.</div>
            <button type="button" class="btn btn-success btn-sm w-100" data-slot-action="book" data-slot-id="${slot.slot_id}">
                Book slot
            </button>
        </div>
    `;
}

let slotAutoRefreshInFlight = false;

function captureSlotBookingFormState(container) {
    if (!container) {
        return null;
    }

    const state = {};
    const elements = container.querySelectorAll(
        "input[id^='start-'], input[id^='battery-'], input[id^='current-'], input[id^='target-'], input[id^='vehicle-category-'], select[id^='payment-method-'], input[id^='payment-ok-']"
    );

    elements.forEach((element) => {
        const match = element.id.match(/^(start|battery|current|target|vehicle-category|payment-method|payment-ok)-(\d+)$/);
        if (!match) {
            return;
        }
        const field = match[1];
        const slotId = match[2];
        if (!state[slotId]) {
            state[slotId] = {};
        }
        state[slotId][field] = element.type === "checkbox" ? element.checked : element.value;
    });

    const active = document.activeElement;
    if (active && active.id) {
        const match = active.id.match(/^(start|battery|current|target|vehicle-category|payment-method|payment-ok)-(\d+)$/);
        if (match) {
            state.__active = {
                slotId: match[2],
                field: match[1],
            };
            if (typeof active.selectionStart === "number" && typeof active.selectionEnd === "number") {
                state.__active.selection = [active.selectionStart, active.selectionEnd];
            }
        }
    }

    return state;
}

function restoreSlotBookingFormState(container, state) {
    if (!container || !state) {
        return;
    }

    Object.keys(state).forEach((slotId) => {
        if (slotId === "__active") {
            return;
        }
        const values = state[slotId];
        if (!values) {
            return;
        }

        const startField = container.querySelector(`#start-${slotId}`);
        if (startField && "start" in values) {
            startField.value = values.start ?? "";
        }
        const batteryField = container.querySelector(`#battery-${slotId}`);
        if (batteryField && "battery" in values) {
            batteryField.value = values.battery ?? "";
        }
        const currentField = container.querySelector(`#current-${slotId}`);
        if (currentField && "current" in values) {
            currentField.value = values.current ?? "";
        }
        const targetField = container.querySelector(`#target-${slotId}`);
        if (targetField && "target" in values) {
            targetField.value = values.target ?? "";
        }
        const vehicleField = container.querySelector(`#vehicle-category-${slotId}`);
        if (vehicleField && "vehicle-category" in values) {
            vehicleField.value = values["vehicle-category"] ?? vehicleField.value;
        }
        const paymentField = container.querySelector(`#payment-method-${slotId}`);
        if (paymentField && "payment-method" in values) {
            paymentField.value = values["payment-method"] ?? paymentField.value;
        }
        const paymentOkField = container.querySelector(`#payment-ok-${slotId}`);
        if (paymentOkField && "payment-ok" in values) {
            paymentOkField.checked = Boolean(values["payment-ok"]);
        }
        syncSlotPaymentUi(slotId);

        ["battery", "current", "target"].forEach((field) => {
            const input = container.querySelector(`#${field}-${slotId}`);
            if (input) {
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
    });

    if (state.__active) {
        const { slotId, field, selection } = state.__active;
        const target = container.querySelector(`#${field}-${slotId}`);
        if (target) {
            target.focus();
            if (selection && typeof target.setSelectionRange === "function") {
                target.setSelectionRange(selection[0], selection[1]);
            }
        }
    }
}

function renderSlots(slots, stationName, options = {}) {
    const slotsSection = document.getElementById("slotsSection");
    const slotsDiv = document.getElementById("slotsList");
    const slotsTitle = document.getElementById("slotsTitle");

    if (!slotsSection || !slotsDiv || !slotsTitle) {
        return;
    }

    slotsTitle.innerText = `Chargers at ${stationName}`;
    slotsDiv.innerHTML = "";

    if (!Array.isArray(slots) || slots.length === 0) {
        slotsDiv.innerHTML = "<div class='col-12'><div class='empty-state'>No chargers found for this station.</div></div>";
        slotsSection.style.display = "block";
        return;
    }

    const minDatetime =
        typeof window.formatDateTimeLocalInputValue === "function"
            ? window.formatDateTimeLocalInputValue(new Date(Date.now() + 60 * 1000))
            : new Date(Date.now() + 60 * 1000).toISOString().slice(0, 16);

    slotsDiv.innerHTML = slots
        .map((slot) => {
            const currentStatus = String(slot.current_status || slot.status || "available").toLowerCase();
            const activeSession = slot.active_session || null;
            const powerKw = Number(slot.power_kw);
            const pricePerKwh = slot.price_per_kwh === null ? null : Number(slot.price_per_kwh);
            const pricePerMinute = slot.price_per_minute === null ? null : Number(slot.price_per_minute);
            const vehicleCategory = normalizeVehicleCategory(slot.vehicle_category) || VEHICLE_CATEGORY_CAR;
            const chargingSpeed = slot.charging_speed || classifyChargingSpeed(powerKw, vehicleCategory);
            const pricingText =
                Number.isFinite(pricePerKwh) && pricePerKwh > 0
                    ? `${formatMoney(pricePerKwh)} / kWh`
                    : Number.isFinite(pricePerMinute) && pricePerMinute > 0
                    ? `${formatMoney(pricePerMinute)} / min`
                    : "Not configured";
            const bookingsHtml =
                Array.isArray(slot.bookings) && slot.bookings.length > 0
                    ? slot.bookings
                          .map(
                              (booking) =>
                                  `<li>${escapeHtml(booking.start_time)} - ${escapeHtml(booking.end_time)}</li>`
                          )
                           .join("")
                    : "<li class='text-muted'>No upcoming reservations</li>";
            const isOutOfService = currentStatus === "out_of_service";
            const liveSessionHtml = isOutOfService
                ? `<div class="slot-session-note slot-session-note--danger">Out of service. This charger is temporarily offline.</div>`
                : activeSession
                ? buildChargingProgressWidget(
                      {
                          status: "charging_started",
                          charging_started_at: activeSession.charging_started_at,
                          charging_completed_at: activeSession.charging_completed_at,
                          duration_minutes: activeSession.duration_minutes,
                          current_battery_percent: activeSession.current_battery_percent,
                          target_battery_percent: activeSession.target_battery_percent,
                          charging_progress_percent: activeSession.progress_percent,
                          estimated_current_battery_percent: activeSession.estimated_current_battery_percent,
                          estimated_completion_time: activeSession.estimated_completion_time,
                          remaining_minutes: activeSession.remaining_minutes,
                      },
                      { title: "Live charging" }
                  )
                : currentStatus === "occupied" && slot.active_booking
                ? `<div class="slot-session-note">Reserved from ${escapeHtml(slot.active_booking.start_time)} to ${escapeHtml(
                      slot.active_booking.end_time
                  )}</div>`
                : `<div class="slot-session-note">Ready for the next <span class="evgo-wordmark evgo-wordmark--inline">EV<span class="evgo-wordmark__go">go</span></span> session.</div>`;

            return `
                <div class="col-12 col-lg-6 col-xxl-4">
                    <article class="slot-card">
                        <div class="slot-card__header">
                            <div>
                                <span class="station-card__eyebrow">Slot ${escapeHtml(slot.slot_number)}</span>
                                <h6 class="slot-card__title">${escapeHtml(slot.charger_name || `Charger ${slot.slot_number}`)}</h6>
                                <div class="slot-card__subtitle">${escapeHtml(normalizeStatusLabel(slot.slot_type))} charger</div>
                            </div>
                            <span class="${getAvailabilityBadgeClass(currentStatus)}">${escapeHtml(
                                normalizeChargerStatusLabel(currentStatus)
                            )}</span>
                        </div>

                        <div class="slot-metric-grid">
                            <div class="slot-metric">
                                <span class="slot-metric__label">Power</span>
                                <span class="slot-metric__value">${Number.isFinite(powerKw) ? `${powerKw.toFixed(2)} kW` : "N/A"}</span>
                            </div>
                            <div class="slot-metric">
                                <span class="slot-metric__label">Vehicle</span>
                                <span class="slot-metric__value">${escapeHtml(normalizeVehicleCategoryLabel(vehicleCategory))}</span>
                            </div>
                            <div class="slot-metric">
                                <span class="slot-metric__label">Pricing</span>
                                <span class="slot-metric__value">${escapeHtml(pricingText)}</span>
                            </div>
                            <div class="slot-metric">
                                <span class="slot-metric__label">Connector</span>
                                <span class="slot-metric__value">${escapeHtml(slot.connector_type || "N/A")}</span>
                            </div>
                            <div class="slot-metric">
                                <span class="slot-metric__label">Charging speed</span>
                                <span class="slot-metric__value">${escapeHtml(chargingSpeed)}</span>
                            </div>
                            <div class="slot-metric">
                                <span class="slot-metric__label">Available now</span>
                                <span class="slot-metric__value">${slot.is_available_now ? "Yes" : "No"}</span>
                            </div>
                        </div>

                        <div>
                            <span class="slot-price-label">Upcoming reservations</span>
                            <ul class="slot-card__list">${bookingsHtml}</ul>
                        </div>

                        ${liveSessionHtml}

                        ${buildSlotBookingForm(slot, minDatetime)}
                    </article>
                </div>
            `;
        })
        .join("");

    slotsDiv.querySelectorAll("[data-slot-action='book']").forEach((button) => {
        button.addEventListener("click", () => {
            const slotId = Number(button.dataset.slotId || 0);
            bookSlot(slotId);
        });
    });

    slots.forEach((slot) => {
        const powerKw = Number(slot.power_kw);
        const pricePerKwh = slot.price_per_kwh === null ? null : Number(slot.price_per_kwh);
        const pricePerMinute = slot.price_per_minute === null ? null : Number(slot.price_per_minute);
        const vehicleCategory = normalizeVehicleCategory(slot.vehicle_category) || VEHICLE_CATEGORY_CAR;
        const estimateHandler = () =>
            updateSlotEstimateDisplay(slot.slot_id, powerKw, pricePerKwh, pricePerMinute, vehicleCategory);

        slotsDiv.querySelector(`#battery-${slot.slot_id}`)?.addEventListener("input", estimateHandler);
        slotsDiv.querySelector(`#current-${slot.slot_id}`)?.addEventListener("input", estimateHandler);
        slotsDiv.querySelector(`#target-${slot.slot_id}`)?.addEventListener("input", estimateHandler);
        slotsDiv.querySelector(`#payment-method-${slot.slot_id}`)?.addEventListener("change", () => syncSlotPaymentUi(slot.slot_id));
        syncSlotPaymentUi(slot.slot_id);
        estimateHandler();
    });

    slotsSection.style.display = "block";
    refreshChargingProgressWidgets(slotsDiv);
    if (options.preserveFormState) {
        restoreSlotBookingFormState(slotsDiv, options.preserveFormState);
    }
    if (!options.skipScroll) {
        window.scrollTo({ top: slotsSection.offsetTop - 90, behavior: "smooth" });
    }
}

async function toggleSlots(stationId, stationName, forceOpen = false) {
    const slotsSection = document.getElementById("slotsSection");
    const slotsDiv = document.getElementById("slotsList");

    if (!slotsSection || !slotsDiv) {
        return;
    }

    if (!forceOpen && dashboardState.openStationId === stationId && slotsSection.style.display === "block") {
        slotsSection.style.display = "none";
        slotsDiv.innerHTML = "";
        dashboardState.openStationId = null;
        dashboardState.openStationName = "";
        return;
    }

    try {
        const preserveFormState =
            slotsSection.style.display === "block" && dashboardState.openStationId === stationId
                ? captureSlotBookingFormState(slotsDiv)
                : null;
        const slots = await apiRequest(`/api/bookings/stations/${stationId}/slots`, { method: "GET" }, true);
        dashboardState.openStationId = stationId;
        dashboardState.openStationName = stationName || `Station ${stationId}`;
        renderSlots(slots, dashboardState.openStationName, { preserveFormState });
    } catch (error) {
        alert(error.message);
    }
}

async function refreshOpenStationSlotsIfVisible() {
    const slotsSection = document.getElementById("slotsSection");
    const slotsDiv = document.getElementById("slotsList");
    if (
        slotAutoRefreshInFlight ||
        !dashboardState.openStationId ||
        !slotsSection ||
        !slotsDiv ||
        slotsSection.style.display !== "block"
    ) {
        return;
    }

    const preserveFormState = captureSlotBookingFormState(slotsDiv);
    slotAutoRefreshInFlight = true;
    try {
        const slots = await apiRequest(
            `/api/bookings/stations/${dashboardState.openStationId}/slots`,
            { method: "GET" },
            true
        );
        renderSlots(slots, dashboardState.openStationName, {
            skipScroll: true,
            preserveFormState,
        });
    } catch (_error) {
        // Keep auto-refresh silent to avoid repeated alerts while the panel is open.
    } finally {
        slotAutoRefreshInFlight = false;
    }
}

async function bookSlot(slotId) {
    const role = getRole();
    if (role !== CUSTOMER_ROLE && role !== OWNER_ROLE) {
        alert("Only customers and owners can create bookings.");
        return;
    }

    const startField = document.getElementById(`start-${slotId}`);
    const batteryField = document.getElementById(`battery-${slotId}`);
    const currentField = document.getElementById(`current-${slotId}`);
    const targetField = document.getElementById(`target-${slotId}`);
    const vehicleCategoryField = document.getElementById(`vehicle-category-${slotId}`);
    const paymentMethodField = document.getElementById(`payment-method-${slotId}`);
    const paymentOkField = document.getElementById(`payment-ok-${slotId}`);

    const startTime = startField?.value;
    const batteryCapacityKwh = parseOptionalNumber(batteryField?.value);
    const currentBatteryPercent = parseOptionalNumber(currentField?.value);
    const targetBatteryPercent = parseOptionalNumber(targetField?.value);
    const vehicleCategory = normalizeVehicleCategory(vehicleCategoryField?.value || "");
    const paymentMethod = String(paymentMethodField?.value || "upi").trim().toLowerCase();
    const paymentSuccess = Boolean(paymentOkField?.checked);

    if (!startTime) {
        alert("Select booking start time.");
        return;
    }
    if (!Number.isFinite(batteryCapacityKwh) || batteryCapacityKwh <= 0) {
        alert("Battery capacity must be a positive number.");
        return;
    }
    if (!vehicleCategory) {
        alert("This charger is missing vehicle compatibility details.");
        return;
    }
    if (!Number.isFinite(currentBatteryPercent) || currentBatteryPercent < 0 || currentBatteryPercent >= 100) {
        alert("Current battery must be between 0 and 99.");
        return;
    }
    if (
        !Number.isFinite(targetBatteryPercent) ||
        targetBatteryPercent <= currentBatteryPercent ||
        targetBatteryPercent > 100
    ) {
        alert("Target battery must be greater than current battery and at most 100.");
        return;
    }
    if (paymentMethod !== "upi" && paymentMethod !== "card" && paymentMethod !== "cash") {
        alert("Select a valid payment method.");
        return;
    }
    if (paymentMethod !== "cash" && !paymentSuccess) {
        alert("Complete payment (simulated) before booking.");
        return;
    }

    try {
        const booking = await apiRequest(
            "/api/bookings/book-slot",
            {
                method: "POST",
                body: JSON.stringify({
                    slot_id: slotId,
                    start_time: `${startTime.replace("T", " ")}:00`,
                    vehicle_category: vehicleCategory,
                    battery_capacity_kwh: batteryCapacityKwh,
                    current_battery_percent: currentBatteryPercent,
                    target_battery_percent: targetBatteryPercent,
                    payment_method: paymentMethod,
                    payment_success: paymentSuccess,
                }),
            },
            true
        );
        const estimatedCost = Number(booking.estimated_cost);
        const costText = Number.isFinite(estimatedCost) ? formatMoney(estimatedCost) : "N/A";
        const paymentSummary = booking.payment_method === "cash"
            ? `${booking.payment_status || "pending"} (cash settles after charging)`
            : booking.payment_status || "paid";
        const hasQrPayload = Boolean(booking.qr_value || booking.qr_token);
        alert(
            `Booking successful.\nEstimated duration: ${booking.duration_display || formatDurationHuman(booking.duration_minutes)}\nEstimated cost: ${costText}\nPayment: ${paymentSummary}\nQR: ${hasQrPayload ? "ready to show now" : "available when the booking window starts"}.`
        );

        if (hasQrPayload && typeof window.renderBookingQrPayload === "function") {
            window.renderBookingQrPayload(booking, booking.booking_id);
        } else if (typeof hideBookingQrSection === "function") {
            hideBookingQrSection();
        }

        await Promise.allSettled([
            loadStations(),
            loadMyBookings(),
            refreshOpenStationSlotsIfVisible(),
        ]);
    } catch (error) {
        alert(error.message);
    }
}

window.toggleSlots = toggleSlots;
window.bookSlot = bookSlot;
window.refreshOpenStationSlotsIfVisible = refreshOpenStationSlotsIfVisible;
