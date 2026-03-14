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
const DASHBOARD_ACTIVE_TAB_KEY = "evgo.activeTab";
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

function normalizeStatusLabel(value) {
    const text = String(value || "unknown").replace(/[_-]+/g, " ").trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
}

function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatCount(value) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(toFiniteNumber(value));
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
    if (normalized === "available" || normalized === "approved" || normalized === "charging") {
        return "availability-badge availability-badge--success";
    }
    if (normalized === "busy" || normalized === "pending" || normalized === "occupied" || normalized === "waiting_to_start") {
        return "availability-badge availability-badge--warning";
    }
    if (normalized === "rejected" || normalized === "cancelled") {
        return "availability-badge availability-badge--danger";
    }
    if (normalized === "completed" || normalized === "confirmed" || normalized === "charging_completed") {
        return "availability-badge availability-badge--info";
    }
    if (normalized === "charging_started") {
        return "availability-badge availability-badge--success";
    }
    return "availability-badge availability-badge--muted";
}

function getStatusBadgeClass(status) {
    const normalized = String(status || "").toLowerCase();
    if (["confirmed", "approved", "paid", "active", "available", "charging_started", "charging"].includes(normalized)) {
        return "status-badge status-badge--success";
    }
    if (["pending", "busy", "occupied", "waiting_to_start"].includes(normalized)) {
        return "status-badge status-badge--warning";
    }
    if (["suspended"].includes(normalized)) {
        return "status-badge status-badge--warning";
    }
    if (["disabled"].includes(normalized)) {
        return "status-badge status-badge--danger";
    }
    if (["completed", "charging_completed"].includes(normalized)) {
        return "status-badge status-badge--info";
    }
    if (["cancelled", "rejected", "failed"].includes(normalized)) {
        return "status-badge status-badge--danger";
    }
    return "status-badge status-badge--muted";
}

function buildStatusBadge(status, label) {
    return `<span class="${getStatusBadgeClass(status)}">${escapeHtml(label || normalizeStatusLabel(status))}</span>`;
}

function buildMetricCard(metric) {
    const valueText =
        typeof metric.value === "number"
            ? formatCount(metric.value)
            : escapeHtml(metric.value === undefined || metric.value === null ? "N/A" : metric.value);
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
        <div class="col-12 col-md-6 col-xl-3">
            <${wrapperTag} ${interactiveAttrs}>
                <div class="metric-card__icon">
                    <i class="bi ${escapeHtml(metric.icon || "bi-activity")}"></i>
                </div>
                <div class="metric-card__body">
                    <span class="metric-card__label">${escapeHtml(metric.label || "Metric")}</span>
                    <div class="metric-card__value">${valueText}</div>
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

function switchTab(tabName) {
    const selectedTab = resolveInitialTab(tabName);
    if (selectedTab === activeDashboardTab) {
        return;
    }
    activeDashboardTab = selectedTab;
    try {
        localStorage.setItem(DASHBOARD_ACTIVE_TAB_KEY, selectedTab);
    } catch (_error) {
        // Non-blocking if storage is unavailable.
    }
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

    window.addEventListener("resize", () => {
        if (window.innerWidth >= 992) {
            closeDashboardSidebar();
        }
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

    let lastScrollY = window.scrollY || 0;
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
        const currentY = window.scrollY || 0;
        const delta = currentY - lastScrollY;

        if (Math.abs(delta) >= deltaThreshold) {
            if (currentY <= 10) {
                setHidden(false);
            } else if (delta > 0 && currentY > hideOffset) {
                setHidden(true);
            } else if (delta < 0) {
                setHidden(false);
            }
            lastScrollY = currentY;
        }
    };

    window.addEventListener(
        "scroll",
        () => {
            if (!ticking) {
                window.requestAnimationFrame(() => {
                    handleScroll();
                    ticking = false;
                });
                ticking = true;
            }
        },
        { passive: true }
    );

    window.addEventListener("resize", updateTopNavbarHeight);
    if (window.ResizeObserver) {
        const observer = new ResizeObserver(() => {
            updateTopNavbarHeight();
        });
        observer.observe(topNavbar);
    }
    updateTopNavbarHeight();
    setHidden(false);
}

document.addEventListener("DOMContentLoaded", () => {
    bindDashboardUi();
    let initialTab = "dashboard";
    try {
        initialTab = resolveInitialTab(localStorage.getItem(DASHBOARD_ACTIVE_TAB_KEY));
    } catch (_error) {
        initialTab = "dashboard";
    }
    switchTab(initialTab);
    renderDashboardSummary();
    setupTopNavbarScrollBehavior();
});

window.escapeHtml = escapeHtml;
window.normalizeStatusLabel = normalizeStatusLabel;
window.normalizePriceInfo = normalizePriceInfo;
window.getAvailabilityBadgeClass = getAvailabilityBadgeClass;
window.getStatusBadgeClass = getStatusBadgeClass;
window.buildStatusBadge = buildStatusBadge;
window.buildMetricCard = buildMetricCard;
window.updateDashboardSummaryState = updateDashboardSummaryState;
window.formatCompactCurrencyTick = formatCompactCurrencyTick;
window.wrapChartLabel = wrapChartLabel;
window.truncateChartLabel = truncateChartLabel;
window.setAnalyticsChartShellHeight = setAnalyticsChartShellHeight;
window.switchTab = switchTab;
window.closeDashboardSidebar = closeDashboardSidebar;
