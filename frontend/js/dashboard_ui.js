const DASHBOARD_TITLES = {
    dashboard: "Dashboard",
    stations: "Stations",
    bookings: "Bookings",
    profile: "Profile",
    "admin-users": "User Management",
    "admin-stations": "Station Management",
    "admin-bookings": "Booking Administration",
    "admin-revenue": "Revenue Analytics",
};

const EVGO_WORDMARK_HTML =
    '<span class="evgo-wordmark evgo-wordmark--inline">EV<span class="evgo-wordmark__go">go</span></span>';
let activeDashboardTab = null;

const dashboardSummaryState = {
    stations: [],
    customerBookings: [],
    ownerStations: [],
    ownerBookings: [],
    adminBookings: [],
    ownerStats: null,
    adminStats: null,
};

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function buildLoadingState(message = "Loading...") {
    return `
        <div class="loading-state" role="status" aria-live="polite">
            <span class="spinner-border spinner-border-sm loading-state__spinner" aria-hidden="true"></span>
            <span class="loading-state__text">${escapeHtml(message)}</span>
        </div>
    `;
}

function renderLoadingState(targetOrId, message = "Loading...") {
    const target =
        typeof targetOrId === "string"
            ? document.getElementById(targetOrId)
            : targetOrId instanceof HTMLElement
            ? targetOrId
            : null;
    if (!target) {
        return;
    }
    target.innerHTML = buildLoadingState(message);
}

function normalizeStatusLabel(value) {
    const text = String(value || "unknown").replace(/[_-]+/g, " ").trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
}

function normalizeChargerStatusLabel(value) {
    const normalized = String(value || "").toLowerCase();
    if (["occupied", "waiting_to_start", "reserved", "confirmed"].includes(normalized)) {
        return "Reserved";
    }
    if (["charging", "charging_started"].includes(normalized)) {
        return "Charging";
    }
    if (["out_of_service", "disabled"].includes(normalized)) {
        return "Out of service";
    }
    if (normalized === "available") {
        return "Available";
    }
    return normalizeStatusLabel(value);
}

function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatCount(value) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(toFiniteNumber(value));
}

function formatEnergyKwh(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return "0 kWh";
    }
    return `${parsed.toFixed(1)} kWh`;
}

function countActiveBookings(bookings) {
    if (!Array.isArray(bookings)) {
        return 0;
    }
    const activeStatuses = new Set(["charging_started", "charging"]);
    return bookings.filter((booking) => activeStatuses.has(String(booking.status || "").toLowerCase())).length;
}

function applyEvgoWordmark(text) {
    return String(text || "").replace(/EVgo/g, EVGO_WORDMARK_HTML);
}

function normalizePriceInfo(priceInfo) {
    if (!priceInfo) {
        return "Pricing on request";
    }
    const asciiText = String(priceInfo)
        .replace(/[^\x20-\x7E]/g, "")
        .trim();
    if (!asciiText) {
        return "Pricing on request";
    }
    if (/^rs\b/i.test(asciiText)) {
        return asciiText;
    }
    return /^\d/.test(asciiText) ? `Rs ${asciiText}` : asciiText;
}

function getAvailabilityBadgeClass(status) {
    const normalized = String(status || "").toLowerCase();
    if (["out_of_service", "disabled", "rejected", "cancelled"].includes(normalized)) {
        return "availability-badge availability-badge--danger";
    }
    if (["charging", "charging_started"].includes(normalized)) {
        return "availability-badge availability-badge--info";
    }
    if (normalized === "available" || normalized === "approved") {
        return "availability-badge availability-badge--success";
    }
    if (["busy", "pending", "occupied", "waiting_to_start", "reserved", "confirmed"].includes(normalized)) {
        return "availability-badge availability-badge--warning";
    }
    if (["completed", "charging_completed"].includes(normalized)) {
        return "availability-badge availability-badge--info";
    }
    return "availability-badge availability-badge--muted";
}

function getStatusBadgeClass(status) {
    const normalized = String(status || "").toLowerCase();
    if (["charging", "charging_started", "completed", "charging_completed"].includes(normalized)) {
        return "status-badge status-badge--info";
    }
    if (["available", "approved", "paid", "active"].includes(normalized)) {
        return "status-badge status-badge--success";
    }
    if (["pending", "busy", "occupied", "waiting_to_start", "reserved", "confirmed", "suspended"].includes(normalized)) {
        return "status-badge status-badge--warning";
    }
    if (["out_of_service", "disabled", "cancelled", "rejected", "failed"].includes(normalized)) {
        return "status-badge status-badge--danger";
    }
    return "status-badge status-badge--muted";
}

function buildStatusBadge(status, label) {
    return `<span class="${getStatusBadgeClass(status)}">${escapeHtml(label || normalizeStatusLabel(status))}</span>`;
}

function buildChargerStatusBadge(status) {
    return buildStatusBadge(status, normalizeChargerStatusLabel(status));
}

function buildMetricCard(metric) {
    const valueLabel =
        typeof metric.value === "number"
            ? formatCount(metric.value)
            : String(metric.value === undefined || metric.value === null ? "N/A" : metric.value);
    const valueText = escapeHtml(valueLabel);
    const isCompactValue = valueLabel.length >= 8;
    const isCurrencyValue = /[\u20B9$€£]|(?:rs\.?\s*)?\d[\d,.]*\.\d{2}/i.test(valueLabel);
    const valueClass = `${isCompactValue ? " metric-card__value--compact" : ""}${isCurrencyValue ? " metric-card__value--currency" : ""}`;
    const metaHtml = metric.meta ? `<p class="metric-card__meta">${escapeHtml(metric.meta)}</p>` : "";
    const tabTarget = metric.tabTarget ? escapeHtml(metric.tabTarget) : "";
    const isInteractive = Boolean(tabTarget);
    const wrapperTag = isInteractive ? "button" : "div";
    const interactiveAttrs = isInteractive
        ? `type="button" class="metric-card metric-card--${escapeHtml(
              metric.tone || "blue"
          )} metric-card--interactive metric-card--button" data-tab-target="${tabTarget}"`
        : `class="metric-card metric-card--${escapeHtml(metric.tone || "blue")}"`;

    return `
        <div class="metric-card-shell">
            <${wrapperTag} ${interactiveAttrs}>
                <div class="metric-card__icon">
                    <i class="bi ${escapeHtml(metric.icon || "bi-activity")}"></i>
                </div>
                <div class="metric-card__body">
                    <span class="metric-card__label">${escapeHtml(metric.label || "Metric")}</span>
                    <div class="metric-card__value${valueClass}">${valueText}</div>
                    ${metaHtml}
                </div>
            </${wrapperTag}>
        </div>
    `;
}

function buildInsightItem(insight) {
    return `
        <div class="insight-item">
            <div class="insight-item__icon">
                <i class="bi ${escapeHtml(insight.icon || "bi-lightning-charge")}"></i>
            </div>
            <div>
                <span class="insight-item__label">${escapeHtml(insight.label || "Insight")}</span>
                <span class="insight-item__value">${escapeHtml(insight.value || "N/A")}</span>
            </div>
        </div>
    `;
}

function formatCompactCurrencyTick(value) {
    const amount = toFiniteNumber(value);
    try {
        const compact = new Intl.NumberFormat("en-IN", {
            notation: "compact",
            maximumFractionDigits: amount >= 100000 ? 1 : 0,
        }).format(amount);
        return `\u20B9${compact}`;
    } catch (_error) {
        if (amount >= 1000) {
            return `\u20B9${(amount / 1000).toFixed(amount >= 10000 ? 0 : 1)}k`;
        }
        return `\u20B9${amount.toFixed(0)}`;
    }
}

function wrapChartLabel(label, maxCharsPerLine = 14) {
    const words = String(label || "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
        return "Unknown";
    }

    const lines = [];
    let currentLine = "";

    words.forEach((rawWord) => {
        let word = rawWord;
        while (word.length > maxCharsPerLine) {
            if (currentLine) {
                lines.push(currentLine);
                currentLine = "";
            }
            lines.push(word.slice(0, maxCharsPerLine));
            word = word.slice(maxCharsPerLine);
        }

        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (candidate.length > maxCharsPerLine && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = candidate;
        }
    });

    if (currentLine) {
        lines.push(currentLine);
    }

    return lines.length > 1 ? lines : lines[0];
}

function truncateChartLabel(label, maxChars = 18) {
    const text = String(label || "").trim();
    if (!text) {
        return "Unknown";
    }
    if (text.length <= maxChars) {
        return text;
    }
    if (maxChars <= 3) {
        return text.slice(0, maxChars);
    }
    return `${text.slice(0, maxChars - 3)}...`;
}

function setAnalyticsChartShellHeight(canvas, itemCount, options = {}) {
    const shell = canvas?.closest(".analytics-chart-shell");
    if (!shell) {
        return;
    }

    const {
        minHeight = 300,
        maxHeight = 400,
        perItemHeight = 46,
        fallbackHeight = 320,
    } = options;
    const normalizedCount = Number(itemCount) || 0;
    const calculatedHeight =
        normalizedCount > 0
            ? Math.min(Math.max(normalizedCount * perItemHeight, minHeight), maxHeight)
            : fallbackHeight;
    shell.style.height = `${calculatedHeight}px`;
}

function renderDashboardHeroMetrics(role, stations, customerBookings, ownerStations, ownerStats, adminStats, adminBookings) {
    const primaryLabel = document.getElementById("heroPrimaryLabel");
    const primaryValue = document.getElementById("heroPrimaryValue");
    const primaryMeta = document.getElementById("heroPrimaryMeta");
    const secondaryLabel = document.getElementById("heroSecondaryLabel");
    const secondaryValue = document.getElementById("heroSecondaryValue");
    const secondaryMeta = document.getElementById("heroSecondaryMeta");

    if (!primaryLabel || !primaryValue || !primaryMeta || !secondaryLabel || !secondaryValue || !secondaryMeta) {
        return;
    }

    let heroMetrics;

    if (role === "admin") {
        const availableChargers = stations.reduce((sum, station) => sum + toFiniteNumber(station.available_slots), 0);
        const activeSessionCount =
            Array.isArray(adminBookings) && adminBookings.length > 0
                ? countActiveBookings(adminBookings)
                : toFiniteNumber(adminStats.active_sessions);
        heroMetrics = {
            primary: {
                label: "Chargers in use",
                value: formatCount(activeSessionCount),
                meta: `${formatCount(availableChargers)} chargers currently available across the network`,
            },
            secondary: {
                label: "Tracked stations",
                value: formatCount(adminStats.total_stations),
                meta: "Approved and pending locations across the network",
            },
        };
    } else if (role === OWNER_ROLE) {
        const availableChargers = ownerStations.reduce((sum, station) => sum + toFiniteNumber(station.available_slots), 0);
        const chargingChargers = ownerStations.reduce((sum, station) => sum + toFiniteNumber(station.charging_slots), 0);
        heroMetrics = {
            primary: {
                label: "Active charging sessions",
                value: formatCount(ownerStats.active_bookings),
                meta: `${formatCount(chargingChargers)} chargers are currently marked charging`,
            },
            secondary: {
                label: "Available chargers",
                value: formatCount(availableChargers),
                meta: `${formatCount(ownerStations.length)} stations in your portfolio`,
            },
        };
    } else {
        const availableChargers = stations.reduce((sum, station) => sum + toFiniteNumber(station.available_slots), 0);
        const chargingChargers = stations.reduce((sum, station) => sum + toFiniteNumber(station.charging_slots), 0);
        heroMetrics = {
            primary: {
                label: "Chargers charging now",
                value: formatCount(chargingChargers),
                meta: `${formatCount(stations.length)} visible stations across the network`,
            },
            secondary: {
                label: "Available chargers",
                value: formatCount(availableChargers),
                meta: `${formatCount(customerBookings.length)} bookings on your account`,
            },
        };
    }

    primaryLabel.textContent = heroMetrics.primary.label;
    primaryValue.textContent = heroMetrics.primary.value;
    primaryMeta.textContent = heroMetrics.primary.meta;
    secondaryLabel.textContent = heroMetrics.secondary.label;
    secondaryValue.textContent = heroMetrics.secondary.value;
    secondaryMeta.textContent = heroMetrics.secondary.meta;
}

function updateDashboardSummaryState(partialState = {}) {
    Object.assign(dashboardSummaryState, partialState);
    renderDashboardSummary();
}

function renderDashboardSummary() {
    const cardsContainer = document.getElementById("dashboardStatsCards");
    const insightsContainer = document.getElementById("quickStats");
    if (!cardsContainer || !insightsContainer) {
        return;
    }

    const role = getRole();
    const stations = Array.isArray(dashboardSummaryState.stations) ? dashboardSummaryState.stations : [];
    const customerBookings = Array.isArray(dashboardSummaryState.customerBookings)
        ? dashboardSummaryState.customerBookings
        : [];
    const ownerStations = Array.isArray(dashboardSummaryState.ownerStations) ? dashboardSummaryState.ownerStations : [];
    const ownerStats = dashboardSummaryState.ownerStats || {};
    const adminStats = dashboardSummaryState.adminStats || {};
    const adminBookings = Array.isArray(dashboardSummaryState.adminBookings) ? dashboardSummaryState.adminBookings : [];

    let cards = [];
    let insights = [];

    if (role === "admin") {
        const approvedStations = stations.length;
        const activeSessionCount =
            adminBookings.length > 0 ? countActiveBookings(adminBookings) : toFiniteNumber(adminStats.active_sessions);
        cards = [
            {
                tone: "cyan",
                icon: "bi-people-fill",
                label: "Users",
                value: toFiniteNumber(adminStats.total_users),
                meta: "Registered platform accounts",
                tabTarget: "admin-users",
            },
            {
                tone: "blue",
                icon: "bi-ev-station-fill",
                label: "Stations",
                value: toFiniteNumber(adminStats.total_stations),
                meta: `${approvedStations} approved and visible`,
                tabTarget: "admin-stations",
            },
            {
                tone: "amber",
                icon: "bi-calendar2-check-fill",
                label: "Bookings",
                value: toFiniteNumber(adminStats.total_bookings),
                meta: `${formatCount(activeSessionCount)} active sessions`,
                tabTarget: "admin-bookings",
            },
            {
                tone: "emerald",
                icon: "bi-cash-stack",
                label: "Revenue",
                value:
                    adminStats.revenue_estimate_supported === false
                        ? "N/A"
                        : formatMoney(toFiniteNumber(adminStats.total_revenue)),
                meta:
                    adminStats.revenue_estimate_supported === false
                        ? "Revenue estimate unavailable"
                        : "System-wide revenue",
                tabTarget: "admin-revenue",
            },
        ];

        insights = [
            {
                icon: "bi-shield-check",
                label: "Approvals",
                value: `${approvedStations} stations currently approved`,
            },
            {
                icon: "bi-activity",
                label: "Active sessions",
                value: `${formatCount(activeSessionCount)} chargers in use`,
            },
            {
                icon: "bi-graph-up-arrow",
                label: "Visibility",
                value: "Realtime platform monitoring enabled",
            },
        ];
    } else if (role === OWNER_ROLE) {
        const chargerCount = ownerStations.reduce((sum, station) => sum + toFiniteNumber(station.total_slots), 0);
        const pendingApprovals = ownerStations.filter(
            (station) => String(station.approval_status || "").toLowerCase() === "pending"
        ).length;
        const mostUsed = ownerStats.most_used_slot
            ? `${ownerStats.most_used_slot.station_name} - Slot ${ownerStats.most_used_slot.slot_number}`
            : "No booking trend yet";

        cards = [
            {
                tone: "blue",
                icon: "bi-ev-station-fill",
                label: "My Stations",
                value: ownerStations.length,
                meta: pendingApprovals > 0 ? `${pendingApprovals} pending approval` : "All tracked locations",
            },
            {
                tone: "cyan",
                icon: "bi-lightning-charge-fill",
                label: "Chargers",
                value: chargerCount,
                meta: "Configured across your portfolio",
            },
            {
                tone: "amber",
                icon: "bi-calendar2-check-fill",
                label: "Bookings",
                value: toFiniteNumber(ownerStats.total_bookings),
                meta: `${toFiniteNumber(ownerStats.active_bookings)} active bookings`,
            },
            {
                tone: "emerald",
                icon: "bi-cash-stack",
                label: "Revenue",
                value:
                    ownerStats.revenue_estimate_supported === false
                        ? "N/A"
                        : formatMoney(toFiniteNumber(ownerStats.total_revenue)),
                meta:
                    ownerStats.revenue_estimate_supported === false
                        ? "Pricing data unavailable"
                        : "Estimated network revenue",
            },
        ];

        insights = [
            {
                icon: "bi-star-fill",
                label: "Most used slot",
                value: mostUsed,
            },
            {
                icon: "bi-hourglass-split",
                label: "Live demand",
                value: `${toFiniteNumber(ownerStats.active_bookings)} sessions scheduled now`,
            },
            {
                icon: "bi-patch-check",
                label: "Approvals",
                value: pendingApprovals > 0 ? `${pendingApprovals} stations awaiting review` : "No pending approvals",
            },
        ];
    } else {
        const totalStations = stations.length;
        const totalChargers = stations.reduce(
            (sum, station) => sum + toFiniteNumber(station.matching_slots || station.total_slots),
            0
        );
        const availableChargers = stations.reduce((sum, station) => sum + toFiniteNumber(station.available_slots), 0);
        const occupiedChargers = stations.reduce((sum, station) => sum + toFiniteNumber(station.occupied_slots), 0);
        const chargingChargers = stations.reduce((sum, station) => sum + toFiniteNumber(station.charging_slots), 0);
        const availableStations = stations.filter(
            (station) => String(station.availability_status || "").toLowerCase() === "available"
        ).length;
        const firstPricedStation = stations.find((station) => station.price_info);
        const utilization = totalChargers > 0 ? Math.round(((occupiedChargers + chargingChargers) / totalChargers) * 100) : 0;

        cards = [
            {
                tone: "blue",
                icon: "bi-ev-station-fill",
                label: "Stations",
                value: totalStations,
                meta: `${availableStations} locations available now`,
            },
            {
                tone: "cyan",
                icon: "bi-lightning-charge-fill",
                label: "Chargers",
                value: totalChargers,
                meta: `${availableChargers} open | ${chargingChargers} charging`,
            },
            {
                tone: "amber",
                icon: "bi-calendar2-check-fill",
                label: "Bookings",
                value: customerBookings.length,
                meta: "Reservations on your account",
            },
            {
                tone: "emerald",
                icon: "bi-cash-coin",
                label: "Starting Rate",
                value: firstPricedStation ? normalizePriceInfo(firstPricedStation.price_info) : "Pricing on request",
                meta: "Lowest visible station pricing",
            },
        ];

        insights = [
            {
                icon: "bi-broadcast-pin",
                label: "Availability",
                value: `${availableChargers} available | ${chargingChargers} charging`,
            },
            {
                icon: "bi-bar-chart-line-fill",
                label: "Utilization",
                value: `${utilization}% of listed chargers occupied`,
            },
            {
                icon: "bi-geo-alt-fill",
                label: "Coverage",
                value: `${availableStations}/${totalStations || 0} stations currently open`,
            },
        ];
    }

    renderDashboardHeroMetrics(role, stations, customerBookings, ownerStations, ownerStats, adminStats, adminBookings);
    cardsContainer.innerHTML = cards.map(buildMetricCard).join("");
    insightsContainer.innerHTML = insights.map(buildInsightItem).join("");
}

function openDashboardSidebar() {
    document.body.classList.add("sidebar-open");
}

function closeDashboardSidebar() {
    document.body.classList.remove("sidebar-open");
}

function resolveInitialTab(savedTab) {
    const candidate = savedTab && savedTab in DASHBOARD_TITLES ? savedTab : "dashboard";
    const tabSection = document.getElementById(`${candidate}Tab`);
    if (!tabSection) {
        return "dashboard";
    }
    const role = typeof getRole === "function" ? getRole() : null;
    if (tabSection.classList.contains("admin-only") && role !== "admin") {
        return "dashboard";
    }
    return candidate;
}

function buildDashboardUrl(tabName) {
    const selectedTab = resolveInitialTab(tabName);
    const hash = selectedTab === "dashboard" ? "" : `#${selectedTab}`;
    return `${window.location.pathname}${window.location.search}${hash}`;
}

function readDashboardTabFromLocation() {
    return resolveInitialTab(String(window.location.hash || "").replace(/^#/, "").trim() || "dashboard");
}

function writeDashboardHistoryState(tabName, replace = false) {
    const selectedTab = resolveInitialTab(tabName);
    const method = replace ? "replaceState" : "pushState";
    window.history[method]({ dashboardTab: selectedTab }, "", buildDashboardUrl(selectedTab));
}

function syncDashboardBackButton(selectedTab) {
    const backButton = document.getElementById("dashboardBackBtn");
    if (!backButton) {
        return;
    }
    const isDashboardHome = selectedTab === "dashboard";
    backButton.hidden = isDashboardHome;
    backButton.disabled = isDashboardHome;
}

function navigateToDashboardHome() {
    if (activeDashboardTab === "dashboard") {
        return;
    }
    const currentStateTab = resolveInitialTab(window.history.state?.dashboardTab || readDashboardTabFromLocation());
    if (currentStateTab !== "dashboard") {
        window.history.back();
        return;
    }
    switchTab("dashboard", { historyMode: "replace" });
}

function switchTab(tabName, options = {}) {
    const historyMode = options.historyMode || "auto";
    const selectedTab = resolveInitialTab(tabName);
    if (selectedTab === activeDashboardTab) {
        syncDashboardBackButton(selectedTab);
        return;
    }
    const previousTab = activeDashboardTab;
    activeDashboardTab = selectedTab;
    const tabs = document.querySelectorAll(".dashboard-tab");
    tabs.forEach((tab) => {
        const isActive = tab.id === `${selectedTab}Tab`;
        tab.classList.toggle("active", isActive);
        tab.style.display = isActive ? "block" : "none";
    });

    document.querySelectorAll(".sidebar-link[data-tab]").forEach((link) => {
        link.classList.toggle("active", link.dataset.tab === selectedTab);
    });

    const pageTitle = document.getElementById("pageTitle");
    if (pageTitle) {
        pageTitle.textContent = DASHBOARD_TITLES[selectedTab] || DASHBOARD_TITLES.dashboard;
    }

    syncDashboardBackButton(selectedTab);

    if (historyMode !== "none") {
        const shouldReplace = historyMode === "replace" || (historyMode === "auto" && previousTab && previousTab !== "dashboard");
        writeDashboardHistoryState(selectedTab, shouldReplace);
    }

    if (typeof window.handleDashboardTabChange === "function") {
        window.handleDashboardTabChange(selectedTab);
    }

    closeDashboardSidebar();
}

function bindDashboardUi() {
    document.addEventListener("click", (event) => {
        const trigger = event.target.closest("[data-tab], [data-tab-trigger], [data-tab-target]");
        if (!trigger) {
            return;
        }
        const nextTab = trigger.dataset.tab || trigger.dataset.tabTrigger || trigger.dataset.tabTarget;
        if (!nextTab) {
            return;
        }
        event.preventDefault();
        if (nextTab === "dashboard" && activeDashboardTab && activeDashboardTab !== "dashboard") {
            navigateToDashboardHome();
            return;
        }
        switchTab(nextTab);
    });

    const sidebarToggleBtn = document.getElementById("sidebarToggleBtn");
    const sidebarBackdrop = document.getElementById("sidebarBackdrop");
    const logoutBtn = document.getElementById("sidebarLogoutBtn");

    sidebarToggleBtn?.addEventListener("click", () => {
        document.body.classList.toggle("sidebar-open");
    });
    sidebarBackdrop?.addEventListener("click", closeDashboardSidebar);
    logoutBtn?.addEventListener("click", logout);
    document.getElementById("dashboardBackBtn")?.addEventListener("click", navigateToDashboardHome);

    window.addEventListener("resize", () => {
        if (window.innerWidth >= 992) {
            closeDashboardSidebar();
        }
    });

    window.addEventListener("popstate", (event) => {
        const requestedTab = resolveInitialTab(event.state?.dashboardTab || readDashboardTabFromLocation());
        switchTab(requestedTab, { historyMode: "none" });
    });
}

function updateTopNavbarHeight() {
    const topNavbar = document.querySelector(".top-navbar");
    if (!topNavbar) {
        return;
    }
    const height = topNavbar.getBoundingClientRect().height;
    document.documentElement.style.setProperty("--top-navbar-height", `${height}px`);
}

function setupTopNavbarScrollBehavior() {
    const topNavbar = document.querySelector(".top-navbar");
    if (!topNavbar) {
        return;
    }

    const getScrollTop = () =>
        Math.max(
            window.scrollY || 0,
            window.pageYOffset || 0,
            document.scrollingElement?.scrollTop || 0,
            document.documentElement?.scrollTop || 0,
            document.body?.scrollTop || 0
        );

    let lastScrollY = getScrollTop();
    let isHidden = false;
    let ticking = false;
    const deltaThreshold = 8;
    const hideOffset = 120;

    const setHidden = (nextHidden) => {
        if (nextHidden === isHidden) {
            return;
        }
        isHidden = nextHidden;
        topNavbar.classList.toggle("is-hidden", isHidden);
        document.body.classList.toggle("navbar-hidden", isHidden);
    };

    const handleScroll = () => {
        const currentY = getScrollTop();
        const delta = currentY - lastScrollY;

        if (Math.abs(delta) >= deltaThreshold) {
            if (currentY <= 10) {
                setHidden(false);
            } else if (delta > 0 && currentY > hideOffset) {
                setHidden(true);
            }
            lastScrollY = currentY;
        }
    };

    const queueScrollUpdate = () => {
        if (!ticking) {
            window.requestAnimationFrame(() => {
                handleScroll();
                ticking = false;
            });
            ticking = true;
        }
    };

    window.addEventListener("scroll", queueScrollUpdate, { passive: true });
    document.addEventListener("scroll", queueScrollUpdate, { passive: true });

    const scrollPollId = window.setInterval(handleScroll, 200);
    window.addEventListener(
        "beforeunload",
        () => {
            window.clearInterval(scrollPollId);
        },
        { once: true }
    );

    window.addEventListener(
        "resize",
        () => {
            lastScrollY = getScrollTop();
            updateTopNavbarHeight();
        },
    );
    if (window.ResizeObserver) {
        const observer = new ResizeObserver(() => {
            updateTopNavbarHeight();
        });
        observer.observe(topNavbar);
    }
    updateTopNavbarHeight();
    handleScroll();
    setHidden(false);
}

document.addEventListener("DOMContentLoaded", () => {
    bindDashboardUi();
    const initialTab = readDashboardTabFromLocation();
    writeDashboardHistoryState("dashboard", true);
    if (initialTab !== "dashboard") {
        writeDashboardHistoryState(initialTab, false);
    }
    switchTab(initialTab, { historyMode: "none" });
    renderDashboardSummary();
    setupTopNavbarScrollBehavior();
});

window.escapeHtml = escapeHtml;
window.normalizeStatusLabel = normalizeStatusLabel;
window.normalizeChargerStatusLabel = normalizeChargerStatusLabel;
window.buildChargerStatusBadge = buildChargerStatusBadge;
window.normalizePriceInfo = normalizePriceInfo;
window.getAvailabilityBadgeClass = getAvailabilityBadgeClass;
window.getStatusBadgeClass = getStatusBadgeClass;
window.buildStatusBadge = buildStatusBadge;
window.buildMetricCard = buildMetricCard;
window.updateDashboardSummaryState = updateDashboardSummaryState;
window.formatEnergyKwh = formatEnergyKwh;
window.formatCompactCurrencyTick = formatCompactCurrencyTick;
window.wrapChartLabel = wrapChartLabel;
window.truncateChartLabel = truncateChartLabel;
window.setAnalyticsChartShellHeight = setAnalyticsChartShellHeight;
window.switchTab = switchTab;
window.closeDashboardSidebar = closeDashboardSidebar;
