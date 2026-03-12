let adminRevenueStationChart = null;
let adminRevenueTrendChart = null;

function destroyAdminChart(chart) {
    if (chart && typeof chart.destroy === "function") {
        chart.destroy();
    }
    return null;
}

function formatAdminRevenueAxisLabel(value) {
    if (typeof window.formatCompactCurrencyTick === "function") {
        return window.formatCompactCurrencyTick(value);
    }
    return formatMoney(Number(value || 0));
}

function formatAdminRevenueStationLabels(stations) {
    return stations.map((item) =>
        typeof window.wrapChartLabel === "function" ? window.wrapChartLabel(item.station_name) : item.station_name
    );
}

function renderAdminRevenueBreakdown(stations) {
    const container = document.getElementById("adminRevenueBreakdown");
    if (!container) {
        return;
    }

    if (!Array.isArray(stations) || stations.length === 0) {
        container.innerHTML = "<div class='empty-state'>No system revenue data available yet.</div>";
        return;
    }

    const rows = stations
        .map(
            (station) => `
                <tr>
                    <td>
                        <span class="booking-table__primary">${escapeHtml(station.station_name)}</span>
                        <span class="booking-table__secondary">${escapeHtml(station.location || "Location unavailable")}</span>
                    </td>
                    <td>${escapeHtml(station.charger_count || 0)}</td>
                    <td>${escapeHtml(station.paid_bookings || 0)}</td>
                    <td>${escapeHtml(formatMoney(station.total_revenue || 0))}</td>
                </tr>
            `
        )
        .join("");

    container.innerHTML = `
        <div class="table-shell">
            <table class="table booking-table align-middle">
                <thead>
                    <tr>
                        <th>Station</th>
                        <th>Chargers</th>
                        <th>Paid bookings</th>
                        <th>Revenue</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function setAdminStationStatusButtons(activeStatus) {
    const mapping = {
        pending: "adminPendingStationsBtn",
        approved: "adminApprovedStationsBtn",
        rejected: "adminRejectedStationsBtn",
        all: "adminAllStationsBtn",
    };

    Object.entries(mapping).forEach(([status, buttonId]) => {
        const button = document.getElementById(buttonId);
        if (!button) {
            return;
        }
        button.classList.toggle("btn-primary", activeStatus === status);
        button.classList.toggle("btn-outline-primary", activeStatus !== status);
    });
}

function renderAdminStats(stats) {
    const container = document.getElementById("adminStatsCards");
    if (!container) {
        return;
    }

    const cards = [
        {
            tone: "cyan",
            icon: "bi-people-fill",
            label: "Users",
            value: Number(stats?.total_users || 0),
            meta: "Registered system users",
        },
        {
            tone: "blue",
            icon: "bi-ev-station-fill",
            label: "Stations",
            value: Number(stats?.total_stations || 0),
            meta: "Tracked network locations",
        },
        {
            tone: "amber",
            icon: "bi-calendar2-check-fill",
            label: "Bookings",
            value: Number(stats?.total_bookings || 0),
            meta: `${Number(stats?.active_sessions || 0)} active sessions`,
        },
        {
            tone: "emerald",
            icon: "bi-cash-stack",
            label: "Revenue",
            value: formatMoney(Number(stats?.total_revenue || 0)),
            meta: "Paid booking revenue",
        },
    ];

    container.innerHTML = cards.map(buildMetricCard).join("");
}

function renderAdminRevenueAnalytics(analytics) {
    const stationCanvas = document.getElementById("adminRevenueStationChart");
    const trendCanvas = document.getElementById("adminRevenueTrendChart");
    if (!stationCanvas || !trendCanvas || typeof window.Chart !== "function") {
        return;
    }

    const stationRevenue = Array.isArray(analytics?.station_revenue) ? analytics.station_revenue : [];
    const monthlyTrend = Array.isArray(analytics?.monthly_trend) ? analytics.monthly_trend : [];

    adminRevenueStationChart = destroyAdminChart(adminRevenueStationChart);
    adminRevenueTrendChart = destroyAdminChart(adminRevenueTrendChart);
    if (typeof window.setAnalyticsChartShellHeight === "function") {
        window.setAnalyticsChartShellHeight(stationCanvas, stationRevenue.length, {
            minHeight: 300,
            maxHeight: 400,
            perItemHeight: 58,
            fallbackHeight: 320,
        });
        window.setAnalyticsChartShellHeight(trendCanvas, monthlyTrend.length, {
            minHeight: 300,
            maxHeight: 340,
            perItemHeight: 42,
            fallbackHeight: 320,
        });
    }

    adminRevenueStationChart = new window.Chart(stationCanvas, {
        type: "bar",
        data: {
            labels: formatAdminRevenueStationLabels(stationRevenue),
            datasets: [
                {
                    label: "Revenue",
                    data: stationRevenue.map((item) => Number(item.total_revenue || 0)),
                    backgroundColor: "#0f9f8f",
                    borderRadius: 12,
                    borderSkipped: false,
                    maxBarThickness: 24,
                },
            ],
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            resizeDelay: 150,
            layout: {
                padding: { top: 8, right: 10, bottom: 0, left: 2 },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `Revenue: ${formatMoney(Number(context.raw || 0))}`,
                    },
                },
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: {
                        color: "rgba(148, 163, 184, 0.16)",
                        drawBorder: false,
                    },
                    ticks: {
                        color: "#64748b",
                        font: { family: "Manrope", size: 11, weight: "700" },
                        callback: (value) => formatAdminRevenueAxisLabel(value),
                    },
                },
                y: {
                    grid: {
                        display: false,
                        drawBorder: false,
                    },
                    ticks: {
                        color: "#334155",
                        font: { family: "Manrope", size: 11, weight: "700" },
                    },
                },
            },
        },
    });

    adminRevenueTrendChart = new window.Chart(trendCanvas, {
        type: "line",
        data: {
            labels: monthlyTrend.map((item) => item.label),
            datasets: [
                {
                    label: "Monthly revenue",
                    data: monthlyTrend.map((item) => Number(item.total_revenue || 0)),
                    borderColor: "#2563eb",
                    backgroundColor: "rgba(37, 99, 235, 0.15)",
                    tension: 0.3,
                    fill: true,
                    borderWidth: 3,
                    pointRadius: 3,
                    pointHoverRadius: 4,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            resizeDelay: 150,
            layout: {
                padding: { top: 8, right: 10, bottom: 0, left: 2 },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `Revenue: ${formatMoney(Number(context.raw || 0))}`,
                    },
                },
            },
            scales: {
                x: {
                    grid: {
                        display: false,
                        drawBorder: false,
                    },
                    ticks: {
                        color: "#64748b",
                        font: { family: "Manrope", size: 11, weight: "700" },
                        maxRotation: 0,
                        minRotation: 0,
                    },
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: "rgba(148, 163, 184, 0.16)",
                        drawBorder: false,
                    },
                    ticks: {
                        color: "#64748b",
                        font: { family: "Manrope", size: 11, weight: "700" },
                        callback: (value) => formatAdminRevenueAxisLabel(value),
                    },
                },
            },
        },
    });

    renderAdminRevenueBreakdown(stationRevenue);
}

async function loadAdminRevenueAnalytics() {
    if (getRole() !== "admin") {
        return;
    }

    try {
        const analytics = await apiRequest("/api/admin/revenue-analytics", { method: "GET" }, true);
        renderAdminRevenueAnalytics(analytics);
    } catch (error) {
        const container = document.getElementById("adminRevenueBreakdown");
        if (container) {
            container.innerHTML = `<div class="empty-state text-danger">${escapeHtml(error.message)}</div>`;
        }
    }
}

async function loadAdminStats() {
    if (getRole() !== "admin") {
        return;
    }

    const container = document.getElementById("adminStatsCards");
    if (!container) {
        return;
    }

    try {
        const stats = await apiRequest("/api/admin/stats", { method: "GET" }, true);
        renderAdminStats(stats);
        updateDashboardSummaryState({ adminStats: stats });
    } catch (error) {
        container.innerHTML = `<div class="col-12"><div class="empty-state text-danger">${escapeHtml(
            error.message
        )}</div></div>`;
    }
}

function renderAdminStationApprovals(stations) {
    const container = document.getElementById("adminStationsApprovalList");
    if (!container) {
        return;
    }

    if (!Array.isArray(stations) || stations.length === 0) {
        container.innerHTML = "<div class='empty-state'>No stations found for this view.</div>";
        return;
    }

    const rows = stations
        .map((station) => {
            const status = station.approval_status || "pending";
            const actions = `
                <div class="booking-table__actions">
                    <button
                        class="btn btn-outline-success btn-sm"
                        type="button"
                        ${status === "approved" ? "disabled" : ""}
                        onclick="updateAdminStationApproval(${station.station_id}, 'approved')"
                    >
                        Approve
                    </button>
                    <button
                        class="btn btn-outline-danger btn-sm"
                        type="button"
                        ${status === "rejected" ? "disabled" : ""}
                        onclick="updateAdminStationApproval(${station.station_id}, 'rejected')"
                    >
                        Reject
                    </button>
                </div>
            `;

            return `
                <tr>
                    <td>
                        <span class="booking-table__primary">#${escapeHtml(station.station_id)}</span>
                        <span class="booking-table__secondary">${escapeHtml(station.location)}</span>
                    </td>
                    <td>
                        <span class="booking-table__primary">${escapeHtml(station.station_name)}</span>
                        <span class="booking-table__secondary">${escapeHtml(
                            `${station.total_slots} chargers (F:${station.fast_slots} / N:${station.normal_slots})`
                        )}</span>
                    </td>
                    <td>
                        <span class="booking-table__primary">${escapeHtml(station.owner_name)}</span>
                        <span class="booking-table__secondary">${escapeHtml(station.owner_email)}</span>
                    </td>
                    <td>${buildStatusBadge(status)}</td>
                    <td>
                        <span class="booking-table__primary">${escapeHtml(station.reviewed_by_name || "-")}</span>
                        <span class="booking-table__secondary">${escapeHtml(station.reviewed_at || "Pending review")}</span>
                    </td>
                    <td>${actions}</td>
                </tr>
            `;
        })
        .join("");

    container.innerHTML = `
        <div class="table-shell">
            <table class="table booking-table align-middle">
                <thead>
                    <tr>
                        <th>Station ID</th>
                        <th>Station</th>
                        <th>Owner</th>
                        <th>Status</th>
                        <th>Review</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

async function loadAdminStationApprovals(status = adminViewState.stationStatus) {
    if (getRole() !== "admin") {
        return;
    }

    const container = document.getElementById("adminStationsApprovalList");
    if (!container) {
        return;
    }

    adminViewState.stationStatus = status;
    setAdminStationStatusButtons(adminViewState.stationStatus);

    try {
        const stations = await apiRequest(
            `/api/admin/stations?status=${encodeURIComponent(adminViewState.stationStatus)}`,
            { method: "GET" },
            true
        );
        renderAdminStationApprovals(stations);
    } catch (error) {
        container.innerHTML = `<div class="empty-state text-danger">${escapeHtml(error.message)}</div>`;
    }
}

async function updateAdminStationApproval(stationId, status) {
    if (getRole() !== "admin") {
        return;
    }
    if (!window.confirm(`Mark station ${stationId} as ${status}?`)) {
        return;
    }

    try {
        const result = await apiRequest(
            `/api/admin/stations/${stationId}/approval`,
            {
                method: "PUT",
                body: JSON.stringify({ status }),
            },
            true
        );
        alert(result.message || "Station approval updated.");
        await loadAdminStats();
        await loadAdminRevenueAnalytics();
        await loadAdminStationApprovals(adminViewState.stationStatus);
        await loadStations();
        await loadOwnerStations();
    } catch (error) {
        alert(error.message);
    }
}

window.updateAdminStationApproval = updateAdminStationApproval;
window.loadAdminRevenueAnalytics = loadAdminRevenueAnalytics;
