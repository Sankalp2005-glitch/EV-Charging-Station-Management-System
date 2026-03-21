let adminRevenueStationChart = null;
let adminRevenueTrendChart = null;
let adminRevenuePageStationChart = null;
let adminRevenuePageMonthlyChart = null;
let adminRevenueDailyChart = null;
let adminSessionDistributionChart = null;

const adminManagementState = {
    users: [],
    usersLoaded: false,
    userSortKey: "registration_date",
    userSortDirection: "desc",
    stations: [],
    stationsLoaded: false,
    stationStatus: "all",
    bookings: [],
    bookingsLoaded: false,
    revenue: null,
    revenueLoaded: false,
};

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
        typeof window.truncateChartLabel === "function" ? window.truncateChartLabel(item.station_name, 16) : item.station_name
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
                    <td class="cell-number">${escapeHtml(station.charger_count || 0)}</td>
                    <td class="cell-number">${escapeHtml(station.paid_bookings || 0)}</td>
                    <td class="cell-currency">${escapeHtml(formatMoney(station.total_revenue || 0))}</td>
                </tr>
            `
        )
        .join("");

    container.innerHTML = `
        <div class="table-shell">
            <table class="table booking-table booking-table--revenue align-middle">
                <thead>
                    <tr>
                        <th>Station</th>
                        <th class="cell-number">Chargers</th>
                        <th class="cell-number">Paid bookings</th>
                        <th class="cell-currency">Revenue</th>
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
            tabTarget: "admin-users",
        },
        {
            tone: "blue",
            icon: "bi-ev-station-fill",
            label: "Stations",
            value: Number(stats?.total_stations || 0),
            meta: "Tracked network locations",
            tabTarget: "admin-stations",
        },
        {
            tone: "amber",
            icon: "bi-calendar2-check-fill",
            label: "Bookings",
            value: Number(stats?.total_bookings || 0),
            meta: `${Number(stats?.active_sessions || 0)} active sessions`,
            tabTarget: "admin-bookings",
        },
        {
            tone: "rose",
            icon: "bi-lightning-charge",
            label: "Energy delivered today",
            value: formatEnergyKwh(stats?.energy_delivered_kwh || 0),
            meta: "Active + completed charging sessions",
        },
        {
            tone: "emerald",
            icon: "bi-cash-stack",
            label: "Revenue",
            value: formatMoney(Number(stats?.total_revenue || 0)),
            meta: "Paid booking revenue",
            tabTarget: "admin-revenue",
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
                        callback: function (value) {
                            const label = this.getLabelForValue(value);
                            return typeof window.truncateChartLabel === "function"
                                ? window.truncateChartLabel(label, 16)
                                : label;
                        },
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
            <table class="table booking-table booking-table--admin-approvals align-middle">
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
        if (typeof loadAdminStationsManagement === "function") {
            await loadAdminStationsManagement(true);
        }
        await loadStations();
        await loadOwnerStations();
    } catch (error) {
        alert(error.message);
    }
}

window.updateAdminStationApproval = updateAdminStationApproval;
window.loadAdminRevenueAnalytics = loadAdminRevenueAnalytics;

function getCurrentUserId() {
    return Number(localStorage.getItem("user_id") || 0) || null;
}

function formatAdminRoleLabel(role) {
    const normalized = String(role || "").toLowerCase();
    if (normalized === "admin") {
        return "Admin";
    }
    if (normalized === "owner") {
        return "Station Owner";
    }
    if (normalized === "customer") {
        return "Customer";
    }
    return normalizeStatusLabel(role);
}

function formatAdminUserStatusLabel(status) {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "disabled") {
        return "Disabled";
    }
    if (normalized === "suspended") {
        return "Suspended";
    }
    return "Active";
}

function formatAdminStationStatusLabel(status) {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "rejected") {
        return "Disabled";
    }
    return normalizeStatusLabel(status);
}

function compareAdminValues(a, b) {
    if (typeof a === "number" && typeof b === "number") {
        return a - b;
    }
    return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
}

function sortAdminUsers(users) {
    const key = adminManagementState.userSortKey;
    const direction = adminManagementState.userSortDirection === "asc" ? 1 : -1;
    return [...users].sort((a, b) => {
        let valueA = a[key];
        let valueB = b[key];
        if (key === "registration_date") {
            valueA = parseApiDateTime(a.registration_date) || new Date(0);
            valueB = parseApiDateTime(b.registration_date) || new Date(0);
            return direction * (valueA - valueB);
        }
        return direction * compareAdminValues(valueA, valueB);
    });
}

function renderAdminUsersTable(users) {
    const container = document.getElementById("adminUsersTable");
    if (!container) {
        return;
    }

    if (!Array.isArray(users) || users.length === 0) {
        container.innerHTML = "<div class='empty-state'>No users found for this view.</div>";
        return;
    }

    const sortedUsers = sortAdminUsers(users);
    const sortKey = adminManagementState.userSortKey;
    const sortDir = adminManagementState.userSortDirection;
    const sortIcon = sortDir === "asc" ? "bi-arrow-up" : "bi-arrow-down";

    const rows = sortedUsers
        .map((user) => {
            const normalizedStatus = String(user.status || "").toLowerCase();
            const statusLabel = formatAdminUserStatusLabel(normalizedStatus);
            const statusBadge = buildStatusBadge(normalizedStatus, statusLabel);
            const isSelf = getCurrentUserId() === Number(user.user_id);
            const actions = [];
            const phoneDisplay =
                typeof window.formatPhoneDisplay === "function"
                    ? window.formatPhoneDisplay(user.phone || "")
                    : user.phone || "-";

            actions.push(
                `<button class="btn btn-outline-primary btn-sm admin-user-view" type="button" data-user-id="${user.user_id}">View</button>`
            );

            if (normalizedStatus === "active") {
                actions.push(
                    `<button class="btn btn-outline-warning btn-sm admin-user-suspend" type="button" data-user-id="${user.user_id}" ${
                        isSelf ? "disabled" : ""
                    }>Suspend</button>`
                );
                actions.push(
                    `<button class="btn btn-outline-danger btn-sm admin-user-disable" type="button" data-user-id="${user.user_id}" ${
                        isSelf ? "disabled" : ""
                    }>Disable</button>`
                );
            } else {
                actions.push(
                    `<button class="btn btn-outline-success btn-sm admin-user-activate" type="button" data-user-id="${user.user_id}" ${
                        isSelf ? "disabled" : ""
                    }>Activate</button>`
                );
            }

            actions.push(
                `<button class="btn btn-outline-danger btn-sm admin-user-delete" type="button" data-user-id="${user.user_id}" ${
                    isSelf ? "disabled" : ""
                }>Delete</button>`
            );

            return `
                <tr>
                    <td>
                        <span class="booking-table__primary">${escapeHtml(user.name || "-")}</span>
                        <span class="booking-table__secondary">${escapeHtml(user.email || "-")}</span>
                    </td>
                    <td>${escapeHtml(formatAdminRoleLabel(user.role))}</td>
                    <td>${escapeHtml(phoneDisplay)}</td>
                    <td>${statusBadge}</td>
                    <td>${escapeHtml(formatDateTimeShort(user.registration_date))}</td>
                    <td>
                        <div class="booking-table__actions">${actions.join("")}</div>
                    </td>
                </tr>
            `;
        })
        .join("");

    container.innerHTML = `
        <div class="table-shell">
            <table class="table booking-table booking-table--admin-users align-middle">
                <thead>
                    <tr>
                        <th class="is-sortable ${sortKey === "name" ? "is-sorted" : ""}" data-sort="name">
                            <button class="table-sort" type="button" data-sort="name">
                                User
                                <i class="bi ${sortKey === "name" ? sortIcon : "bi-arrow-down-up"}"></i>
                            </button>
                        </th>
                        <th class="is-sortable ${sortKey === "role" ? "is-sorted" : ""}" data-sort="role">
                            <button class="table-sort" type="button" data-sort="role">
                                Role
                                <i class="bi ${sortKey === "role" ? sortIcon : "bi-arrow-down-up"}"></i>
                            </button>
                        </th>
                        <th>Phone</th>
                        <th class="is-sortable ${sortKey === "status" ? "is-sorted" : ""}" data-sort="status">
                            <button class="table-sort" type="button" data-sort="status">
                                Status
                                <i class="bi ${sortKey === "status" ? sortIcon : "bi-arrow-down-up"}"></i>
                            </button>
                        </th>
                        <th class="is-sortable ${sortKey === "registration_date" ? "is-sorted" : ""}" data-sort="registration_date">
                            <button class="table-sort" type="button" data-sort="registration_date">
                                Registered
                                <i class="bi ${sortKey === "registration_date" ? sortIcon : "bi-arrow-down-up"}"></i>
                            </button>
                        </th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function renderAdminUserDetails(user) {
    const panel = document.getElementById("adminUserDetails");
    if (!panel || !user) {
        return;
    }
    const phoneDisplay =
        typeof window.formatPhoneDisplay === "function"
            ? window.formatPhoneDisplay(user.phone || "")
            : user.phone || "-";

    panel.innerHTML = `
        <div class="details-panel__header">
            <div>
                <h5 class="mb-1">User #${escapeHtml(user.user_id)}</h5>
                <p class="text-muted mb-0">${escapeHtml(user.name || "User details")}</p>
            </div>
            <button class="btn btn-outline-secondary btn-sm admin-detail-close" type="button" data-target="adminUserDetails">Close</button>
        </div>
        <div class="details-grid">
            <div>
                <span class="details-item__label">Role</span>
                <span class="details-item__value">${escapeHtml(formatAdminRoleLabel(user.role))}</span>
            </div>
            <div>
                <span class="details-item__label">Email</span>
                <span class="details-item__value">${escapeHtml(user.email || "-")}</span>
            </div>
            <div>
                <span class="details-item__label">Phone</span>
                <span class="details-item__value">${escapeHtml(phoneDisplay)}</span>
            </div>
            <div>
                <span class="details-item__label">Status</span>
                <span class="details-item__value">${escapeHtml(formatAdminUserStatusLabel(user.status))}</span>
            </div>
            <div>
                <span class="details-item__label">Registered</span>
                <span class="details-item__value">${escapeHtml(formatDateTimeShort(user.registration_date))}</span>
            </div>
            <div>
                <span class="details-item__label">Status updated</span>
                <span class="details-item__value">${escapeHtml(formatDateTimeShort(user.status_updated_at))}</span>
            </div>
        </div>
        ${user.status_reason ? `<p class="text-muted mt-3 mb-0">Reason: ${escapeHtml(user.status_reason)}</p>` : ""}
    `;
    panel.style.display = "block";
}

async function loadAdminUsers(force = false) {
    if (getRole() !== "admin") {
        return;
    }
    if (adminManagementState.usersLoaded && !force) {
        renderAdminUsersTable(adminManagementState.users);
        return;
    }

    const search = document.getElementById("adminUserSearch")?.value || "";
    const role = document.getElementById("adminUserRoleFilter")?.value || "all";
    const status = document.getElementById("adminUserStatusFilter")?.value || "all";

    try {
        const users = await apiRequest(
            `/api/admin/users?search=${encodeURIComponent(search)}&role=${encodeURIComponent(
                role
            )}&status=${encodeURIComponent(status)}`,
            { method: "GET" },
            true
        );
        adminManagementState.users = Array.isArray(users) ? users : [];
        adminManagementState.usersLoaded = true;
        renderAdminUsersTable(adminManagementState.users);
    } catch (error) {
        const container = document.getElementById("adminUsersTable");
        if (container) {
            container.innerHTML = `<div class="empty-state text-danger">${escapeHtml(error.message)}</div>`;
        }
    }
}

async function updateAdminUserStatus(userId, status) {
    if (!window.confirm(`Set user ${userId} as ${status}?`)) {
        return;
    }
    try {
        await apiRequest(
            `/api/admin/users/${userId}/status`,
            { method: "PUT", body: JSON.stringify({ status }) },
            true
        );
        await loadAdminUsers(true);
    } catch (error) {
        alert(error.message);
    }
}

async function deleteAdminUser(userId) {
    if (!window.confirm(`Delete user ${userId}? This action cannot be undone.`)) {
        return;
    }
    try {
        await apiRequest(`/api/admin/users/${userId}`, { method: "DELETE" }, true);
        await loadAdminUsers(true);
    } catch (error) {
        alert(error.message);
    }
}

function renderAdminStationsTable(stations) {
    const container = document.getElementById("adminStationsTable");
    if (!container) {
        return;
    }
    if (!Array.isArray(stations) || stations.length === 0) {
        container.innerHTML = "<div class='empty-state'>No stations found for this view.</div>";
        return;
    }

    const rows = stations
        .map((station) => {
            const status = String(station.approval_status || "pending").toLowerCase();
            const badge = buildStatusBadge(status, formatAdminStationStatusLabel(status));
            const contactDisplay =
                typeof window.formatPhoneDisplay === "function"
                    ? window.formatPhoneDisplay(station.contact_number || "")
                    : station.contact_number || "-";
            const actions = [];

            actions.push(
                `<button class="btn btn-outline-primary btn-sm admin-station-view" type="button" data-station-id="${station.station_id}">View</button>`
            );
            actions.push(
                `<button class="btn btn-outline-secondary btn-sm admin-station-edit" type="button" data-station-id="${station.station_id}">Edit</button>`
            );
            actions.push(
                `<button class="btn btn-outline-info btn-sm admin-station-chargers" type="button" data-station-id="${station.station_id}">Chargers</button>`
            );
            if (status !== "approved") {
                actions.push(
                    `<button class="btn btn-outline-success btn-sm admin-station-approve" type="button" data-station-id="${station.station_id}">Approve</button>`
                );
            }
            if (status !== "rejected") {
                actions.push(
                    `<button class="btn btn-outline-danger btn-sm admin-station-disable" type="button" data-station-id="${station.station_id}">Disable</button>`
                );
            }

            return `
                <tr>
                    <td>
                        <span class="booking-table__primary">${escapeHtml(station.station_name)}</span>
                        <span class="booking-table__secondary">${escapeHtml(station.location || "-")}</span>
                    </td>
                    <td>
                        <span class="booking-table__primary">${escapeHtml(station.owner_name || "-")}</span>
                        <span class="booking-table__secondary">${escapeHtml(station.owner_email || "-")}</span>
                    </td>
                    <td>${escapeHtml(contactDisplay)}</td>
                    <td class="cell-number">${escapeHtml(station.total_slots || 0)}</td>
                    <td>${badge}</td>
                    <td>
                        <div class="booking-table__actions">${actions.join("")}</div>
                    </td>
                </tr>
            `;
        })
        .join("");

    container.innerHTML = `
        <div class="table-shell">
            <table class="table booking-table booking-table--admin-stations align-middle">
                <thead>
                    <tr>
                        <th>Station</th>
                        <th>Owner</th>
                        <th>Contact</th>
                        <th class="cell-number">Chargers</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function renderAdminStationDetails(station, chargers = null, mode = "view") {
    const panel = document.getElementById("adminStationDetails");
    if (!panel || !station) {
        return;
    }

    const phoneParts = typeof window.splitPhoneNumber === "function"
        ? window.splitPhoneNumber(station.contact_number || "")
        : { countryCode: "91", localNumber: station.contact_number || "" };
    const contactDisplay =
        typeof window.formatPhoneDisplay === "function"
            ? window.formatPhoneDisplay(station.contact_number || "")
            : station.contact_number || "-";
    const contactCodeValue = phoneParts?.countryCode ? `+${phoneParts.countryCode}` : "+91";
    const contactLocalValue = phoneParts?.localNumber || "";

    let bodyContent = `
        <div class="details-grid">
            <div>
                <span class="details-item__label">Station</span>
                <span class="details-item__value">${escapeHtml(station.station_name)}</span>
            </div>
            <div>
                <span class="details-item__label">Location</span>
                <span class="details-item__value">${escapeHtml(station.location || "-")}</span>
            </div>
            <div>
                <span class="details-item__label">Owner</span>
                <span class="details-item__value">${escapeHtml(station.owner_name || "-")}</span>
            </div>
            <div>
                <span class="details-item__label">Contact</span>
                <span class="details-item__value">${escapeHtml(contactDisplay)}</span>
            </div>
            <div>
                <span class="details-item__label">Chargers</span>
                <span class="details-item__value">${escapeHtml(station.total_slots || 0)}</span>
            </div>
            <div>
                <span class="details-item__label">Status</span>
                <span class="details-item__value">${escapeHtml(formatAdminStationStatusLabel(station.approval_status))}</span>
            </div>
        </div>
    `;

    if (mode === "edit") {
        bodyContent = `
            <form id="adminStationEditForm" data-station-id="${station.station_id}">
                <div class="row g-3">
                    <div class="col-md-6">
                        <label class="form-label">Station name</label>
                        <input class="form-control" name="station_name" value="${escapeHtml(station.station_name)}" required>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label">Contact number</label>
                        <div class="phone-input-group">
                            <input class="form-control phone-code" name="contact_country_code" type="tel" inputmode="numeric" placeholder="+91" maxlength="4" value="${escapeHtml(
                                contactCodeValue
                            )}">
                            <input class="form-control phone-number" name="contact_number" type="tel" inputmode="numeric" maxlength="10" pattern="[0-9]{10}" value="${escapeHtml(
                                contactLocalValue
                            )}" placeholder="Enter your 10 digit phone number">
                        </div>
                    </div>
                    <div class="col-12">
                        <label class="form-label">Location</label>
                        <input class="form-control" name="location" value="${escapeHtml(station.location || "")}" required>
                    </div>
                </div>
                <div class="details-actions">
                    <button class="btn btn-success btn-sm" type="submit">Save changes</button>
                    <button class="btn btn-outline-secondary btn-sm admin-station-edit-cancel" type="button" data-station-id="${station.station_id}">Cancel</button>
                </div>
            </form>
        `;
    }

    if (Array.isArray(chargers)) {
        if (chargers.length === 0) {
            bodyContent += "<p class='text-muted mt-3 mb-0'>No chargers found for this station.</p>";
        } else {
            const chargerRows = chargers
                .map((charger) => {
                    const normalizedStatus = String(charger.status || "").toLowerCase();
                    const isOutOfService = normalizedStatus === "out_of_service";
                    const actionLabel = isOutOfService ? "Enable" : "Disable";
                    const actionTone = isOutOfService ? "btn-outline-success" : "btn-outline-danger";
                    const nextStatus = isOutOfService ? "available" : "out_of_service";
                    return `
                        <tr>
                            <td>
                                <span class="booking-table__primary">Slot ${escapeHtml(charger.slot_number)}</span>
                                <span class="booking-table__secondary">${escapeHtml(charger.charger_name || "-")}</span>
                            </td>
                            <td>${escapeHtml(normalizeStatusLabel(charger.slot_type))}</td>
                            <td>${escapeHtml(charger.vehicle_category || "-")}</td>
                            <td>${escapeHtml(charger.power_kw ?? "-")}</td>
                            <td>${buildChargerStatusBadge(charger.status)}</td>
                            <td>
                                <button class="btn btn-sm ${actionTone} admin-charger-toggle" type="button" data-slot-id="${charger.slot_id}" data-next-status="${nextStatus}">
                                    ${actionLabel}
                                </button>
                            </td>
                        </tr>
                    `;
                })
                .join("");
            bodyContent += `
                <div class="mt-4">
        <div class="table-shell">
            <table class="table booking-table booking-table--admin-stations align-middle">
                            <thead>
                                <tr>
                                    <th>Charger</th>
                                    <th>Type</th>
                                    <th>Vehicle</th>
                                    <th>Power (kW)</th>
                                    <th>Status</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>${chargerRows}</tbody>
                        </table>
                    </div>
                </div>
            `;
        }
    }

    panel.innerHTML = `
        <div class="details-panel__header">
            <div>
                <h5 class="mb-1">Station #${escapeHtml(station.station_id)}</h5>
                <p class="text-muted mb-0">${escapeHtml(station.station_name)}</p>
            </div>
            <button class="btn btn-outline-secondary btn-sm admin-detail-close" type="button" data-target="adminStationDetails">Close</button>
        </div>
        ${bodyContent}
    `;
    panel.dataset.stationId = station.station_id;
    panel.style.display = "block";
}

async function loadAdminStationsManagement(force = false) {
    if (getRole() !== "admin") {
        return;
    }
    if (adminManagementState.stationsLoaded && !force) {
        renderAdminStationsTable(adminManagementState.stations);
        return;
    }
    const statusFilter = document.getElementById("adminStationStatusFilter")?.value || "all";
    const apiStatus = statusFilter === "disabled" ? "rejected" : statusFilter;
    try {
        const stations = await apiRequest(
            `/api/admin/stations?status=${encodeURIComponent(apiStatus)}`,
            { method: "GET" },
            true
        );
        adminManagementState.stations = Array.isArray(stations) ? stations : [];
        adminManagementState.stationsLoaded = true;
        adminManagementState.stationStatus = statusFilter;
        renderAdminStationsTable(adminManagementState.stations);
    } catch (error) {
        const container = document.getElementById("adminStationsTable");
        if (container) {
            container.innerHTML = `<div class="empty-state text-danger">${escapeHtml(error.message)}</div>`;
        }
    }
}

async function loadAdminStationChargers(stationId) {
    try {
        return await apiRequest(`/api/admin/stations/${stationId}/chargers`, { method: "GET" }, true);
    } catch (error) {
        alert(error.message);
        return [];
    }
}

async function updateAdminChargerStatus(slotId, status) {
    const normalizedStatus = String(status || "").toLowerCase();
    if (!["available", "out_of_service"].includes(normalizedStatus)) {
        return;
    }
    const actionLabel = normalizedStatus === "out_of_service" ? "mark this charger as out of service" : "enable this charger";
    if (!window.confirm(`Do you want to ${actionLabel}?`)) {
        return;
    }
    try {
        await apiRequest(
            `/api/admin/chargers/${slotId}/status`,
            { method: "PUT", body: JSON.stringify({ status: normalizedStatus }) },
            true
        );
        const detailsPanel = document.getElementById("adminStationDetails");
        const stationId = Number(detailsPanel?.dataset.stationId || 0) || null;
        const station = stationId
            ? adminManagementState.stations.find((item) => Number(item.station_id) === Number(stationId))
            : null;
        if (stationId && station) {
            const chargers = await loadAdminStationChargers(stationId);
            renderAdminStationDetails(station, chargers, "view");
        }
    } catch (error) {
        alert(error.message);
    }
}

async function saveAdminStationEdit(form) {
    const stationId = Number(form.dataset.stationId || 0);
    const contactRaw = form.contact_number?.value || "";
    const contactCodeRaw = form.contact_country_code?.value || "";
    const contactNumber =
        typeof window.normalizeDigits === "function" ? window.normalizeDigits(contactRaw) : contactRaw.replace(/\D/g, "");
    let contactCode =
        typeof window.normalizeDigits === "function" ? window.normalizeDigits(contactCodeRaw) : contactCodeRaw.replace(/\D/g, "");
    if (contactNumber) {
        const isCodeValid =
            typeof window.isValidCountryCode === "function"
                ? window.isValidCountryCode(contactCode)
                : /^[1-9][0-9]{0,2}$/.test(contactCode);
        if (!isCodeValid) {
            alert("Country code must be 1 to 3 digits.");
            return;
        }
        if (typeof window.isValidPhone === "function" ? !window.isValidPhone(contactNumber) : !/^[0-9]{10}$/.test(contactNumber)) {
            alert("Contact number must be 10 digits.");
            return;
        }
    } else {
        contactCode = "";
    }
    const payload = {
        station_name: form.station_name?.value || "",
        location: form.location?.value || "",
        contact_number: contactNumber,
        contact_country_code: contactNumber && contactCode ? `+${contactCode}` : "",
    };
    try {
        await apiRequest(`/api/admin/stations/${stationId}`, { method: "PUT", body: JSON.stringify(payload) }, true);
        await loadAdminStationsManagement(true);
        const station = adminManagementState.stations.find((item) => Number(item.station_id) === stationId);
        if (station) {
            station.station_name = payload.station_name;
            station.location = payload.location;
            station.contact_number = contactCode ? `${contactCode}${contactNumber}` : contactNumber;
            renderAdminStationDetails(station);
        }
    } catch (error) {
        alert(error.message);
    }
}

function renderAdminBookingsTable(bookings) {
    const container = document.getElementById("adminBookingsTable");
    if (!container) {
        return;
    }
    if (!Array.isArray(bookings) || bookings.length === 0) {
        container.innerHTML = "<div class='empty-state'>No bookings found for this view.</div>";
        return;
    }

    const rows = bookings
        .map((booking) => {
            const actions = [];
            actions.push(
                `<button class="btn btn-outline-primary btn-sm admin-booking-view" type="button" data-booking-id="${booking.booking_id}">View</button>`
            );
            if (booking.can_cancel) {
                actions.push(
                    `<button class="btn btn-outline-danger btn-sm admin-booking-cancel" type="button" data-booking-id="${booking.booking_id}">Cancel</button>`
                );
            }
            return `
                <tr>
                    <td>#${escapeHtml(booking.booking_id)}</td>
                    <td>
                        <span class="booking-table__primary">${escapeHtml(booking.user_name || "-")}</span>
                        <span class="booking-table__secondary">${escapeHtml(booking.user_email || "-")}</span>
                    </td>
                    <td>
                        <span class="booking-table__primary">${escapeHtml(booking.station_name || "-")}</span>
                        <span class="booking-table__secondary">${escapeHtml(booking.station_location || "-")}</span>
                    </td>
                    <td>
                        <span class="booking-table__primary">Slot ${escapeHtml(booking.slot_number || "-")}</span>
                        <span class="booking-table__secondary">${escapeHtml(booking.charger_name || "-")}</span>
                    </td>
                    <td>${escapeHtml(normalizeVehicleCategoryLabel(booking.vehicle_category || "-"))}</td>
                    <td>${escapeHtml(formatDateTimeShort(booking.start_time))}</td>
                    <td>${escapeHtml(formatDateTimeShort(booking.end_time))}</td>
                    <td class="cell-currency">${booking.price !== null && booking.price !== undefined ? escapeHtml(formatMoney(booking.price)) : "-"}</td>
                    <td>${buildChargerStatusBadge(booking.status)}</td>
                    <td>${typeof buildBookingChargingCell === "function" ? buildBookingChargingCell(booking) : "-"}</td>
                    <td>
                        <div class="booking-table__actions">${actions.join("")}</div>
                    </td>
                </tr>
            `;
        })
        .join("");

    container.innerHTML = `
        <div class="table-shell">
            <table class="table booking-table booking-table--admin-bookings align-middle">
                <thead>
                    <tr>
                        <th>Booking ID</th>
                        <th>User</th>
                        <th>Station</th>
                        <th>Charger</th>
                        <th>Vehicle type</th>
                        <th>Start time</th>
                        <th>End time</th>
                        <th>Price</th>
                        <th>Status</th>
                        <th>Charging</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
    refreshChargingProgressWidgets(container);
}

function openAdminBookingModal() {
    const modal = document.getElementById("adminBookingModal");
    if (!modal) {
        return;
    }
    modal.classList.add("is-visible");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
}

function closeAdminBookingModal() {
    const modal = document.getElementById("adminBookingModal");
    if (!modal) {
        return;
    }
    modal.classList.remove("is-visible");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
}

function renderAdminBookingDetails(booking) {
    const modal = document.getElementById("adminBookingModal");
    const modalBody = document.getElementById("adminBookingModalBody");
    const modalTitle = document.getElementById("adminBookingModalTitle");
    if (!modal || !modalBody || !booking) {
        return;
    }

    const progressWidget = buildChargingProgressWidget(
        {
            status: booking.status,
            charging_started_at: booking.charging_started_at,
            charging_completed_at: booking.charging_completed_at,
            duration_minutes: booking.estimated_duration_minutes,
            current_battery_percent: booking.current_battery_percent,
            target_battery_percent: booking.target_battery_percent,
            estimated_completion_time: booking.estimated_completion_time,
            charging_progress_percent: booking.charging_progress_percent,
            estimated_current_battery_percent: booking.estimated_current_battery_percent,
            remaining_minutes: booking.remaining_minutes,
        },
        { title: "Charging progress" }
    );

    if (modalTitle) {
        modalTitle.textContent = `Booking #${booking.booking_id}`;
    }

    modalBody.innerHTML = `
        <p class="modal-subtitle mb-3">${escapeHtml(booking.station_name || "-")} - Slot ${escapeHtml(
        booking.slot_number || "-"
    )}</p>
        <div class="details-grid">
            <div>
                <span class="details-item__label">User</span>
                <span class="details-item__value">${escapeHtml(booking.user_name || "-")}</span>
            </div>
            <div>
                <span class="details-item__label">Email</span>
                <span class="details-item__value">${escapeHtml(booking.user_email || "-")}</span>
            </div>
            <div>
                <span class="details-item__label">Vehicle</span>
                <span class="details-item__value">${escapeHtml(normalizeVehicleCategoryLabel(booking.vehicle_category || "-"))}</span>
            </div>
            <div>
                <span class="details-item__label">Status</span>
                <span class="details-item__value">${escapeHtml(normalizeChargerStatusLabel(booking.status))}</span>
            </div>
            <div>
                <span class="details-item__label">Start</span>
                <span class="details-item__value">${escapeHtml(formatDateTimeShort(booking.start_time))}</span>
            </div>
            <div>
                <span class="details-item__label">Estimated end</span>
                <span class="details-item__value">${escapeHtml(formatDateTimeShort(booking.end_time))}</span>
            </div>
            <div>
                <span class="details-item__label">Price</span>
                <span class="details-item__value">${
                    booking.price !== null && booking.price !== undefined ? escapeHtml(formatMoney(booking.price)) : "-"
                }</span>
            </div>
            <div>
                <span class="details-item__label">Payment</span>
                <span class="details-item__value">${escapeHtml(booking.payment_status || "-")}</span>
            </div>
        </div>
        <div class="mt-4">${progressWidget}</div>
    `;
    refreshChargingProgressWidgets(modalBody);
    openAdminBookingModal();
    startChargingProgressTicker();
}

async function loadAdminBookings(force = false) {
    if (getRole() !== "admin") {
        return;
    }
    if (adminManagementState.bookingsLoaded && !force) {
        renderAdminBookingsTable(adminManagementState.bookings);
        return;
    }

    const status = document.getElementById("adminBookingStatusFilter")?.value || "all";
    const stationId = document.getElementById("adminBookingStationFilter")?.value || "all";
    const location = document.getElementById("adminBookingLocationFilter")?.value.trim() || "";
    const startTime = document.getElementById("adminBookingStartTime")?.value || "";
    const endTime = document.getElementById("adminBookingEndTime")?.value || "";
    const sort = document.getElementById("adminBookingSort")?.value || "date_desc";

    const query = new URLSearchParams();
    if (status && status !== "all") {
        query.set("status", status);
    }
    if (stationId && stationId !== "all") {
        query.set("station_id", stationId);
    }
    if (location) {
        query.set("location", location);
    }
    if (startTime) {
        query.set("start_time", startTime);
    }
    if (endTime) {
        query.set("end_time", endTime);
    }
    if (sort) {
        query.set("sort", sort);
    }

    try {
        const bookings = await apiRequest(`/api/admin/bookings?${query.toString()}`, { method: "GET" }, true);
        adminManagementState.bookings = Array.isArray(bookings) ? bookings : [];
        adminManagementState.bookingsLoaded = true;
        if (typeof window.updateDashboardSummaryState === "function") {
            window.updateDashboardSummaryState({ adminBookings: adminManagementState.bookings });
        }
        renderAdminBookingsTable(adminManagementState.bookings);
    } catch (error) {
        const container = document.getElementById("adminBookingsTable");
        if (container) {
            container.innerHTML = `<div class="empty-state text-danger">${escapeHtml(error.message)}</div>`;
        }
    }
}

async function cancelAdminBooking(bookingId) {
    if (!window.confirm(`Cancel booking ${bookingId}?`)) {
        return;
    }
    try {
        await apiRequest(`/api/admin/bookings/${bookingId}/cancel`, { method: "PUT" }, true);
        await loadAdminBookings(true);
    } catch (error) {
        alert(error.message);
    }
}

function renderAdminRevenueSummary(analytics) {
    const container = document.getElementById("adminRevenueSummaryCards");
    if (!container) {
        return;
    }

    const summary = analytics?.summary || {};
    const stationCount = Number(summary.station_count || 0);
    const totalRevenue = Number(summary.total_revenue || 0);
    const chargerCount = Array.isArray(analytics?.charger_revenue) ? analytics.charger_revenue.length : 0;
    const revenuePerStation = stationCount > 0 ? totalRevenue / stationCount : 0;
    const revenuePerCharger = chargerCount > 0 ? totalRevenue / chargerCount : 0;

    const cards = [
        {
            tone: "emerald",
            icon: "bi-cash-stack",
            label: "Total Revenue",
            value: formatMoney(totalRevenue),
            meta: `${summary.paid_bookings || 0} paid bookings`,
        },
        {
            tone: "blue",
            icon: "bi-geo-alt-fill",
            label: "Revenue / Station",
            value: formatMoney(revenuePerStation),
            meta: `${stationCount} stations`,
        },
        {
            tone: "cyan",
            icon: "bi-lightning-charge-fill",
            label: "Revenue / Charger",
            value: formatMoney(revenuePerCharger),
            meta: `${chargerCount} chargers`,
        },
        {
            tone: "amber",
            icon: "bi-graph-up-arrow",
            label: "Avg Booking",
            value: formatMoney(Number(summary.average_booking_revenue || 0)),
            meta: "Paid booking average",
        },
    ];

    container.innerHTML = cards.map(buildMetricCard).join("");
}

function destroyRevenueChart(chart) {
    if (chart && typeof chart.destroy === "function") {
        chart.destroy();
    }
    return null;
}

function renderAdminRevenueCharts(analytics) {
    const stationData = Array.isArray(analytics?.station_revenue) ? analytics.station_revenue : [];
    const monthlyTrend = Array.isArray(analytics?.monthly_trend) ? analytics.monthly_trend : [];
    const dailyTrend = Array.isArray(analytics?.daily_trend) ? analytics.daily_trend : [];
    const sessionDistribution = Array.isArray(analytics?.session_distribution) ? analytics.session_distribution : [];

    const stationCanvas = document.getElementById("adminRevenuePageStationChart");
    const monthlyCanvas = document.getElementById("adminRevenuePageMonthlyChart");
    const dailyCanvas = document.getElementById("adminRevenueDailyChart");
    const sessionCanvas = document.getElementById("adminSessionDistributionChart");

    if (stationCanvas && typeof window.setAnalyticsChartShellHeight === "function") {
        window.setAnalyticsChartShellHeight(stationCanvas, stationData.length, {
            minHeight: 300,
            maxHeight: 420,
            perItemHeight: 56,
            fallbackHeight: 320,
        });
    }

    if (stationCanvas && typeof window.Chart === "function") {
        adminRevenuePageStationChart = destroyRevenueChart(adminRevenuePageStationChart);
        adminRevenuePageStationChart = new window.Chart(stationCanvas, {
            type: "bar",
            data: {
                labels: formatAdminRevenueStationLabels(stationData),
                datasets: [
                    {
                        label: "Revenue",
                        data: stationData.map((item) => Number(item.total_revenue || 0)),
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
                plugins: { legend: { display: false } },
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
                        grid: { display: false, drawBorder: false },
                        ticks: {
                            color: "#334155",
                            font: { family: "Manrope", size: 11, weight: "700" },
                            callback: function (value) {
                                const label = this.getLabelForValue(value);
                                return typeof window.truncateChartLabel === "function"
                                    ? window.truncateChartLabel(label, 16)
                                    : label;
                            },
                        },
                    },
                },
            },
        });
    }

    if (monthlyCanvas && typeof window.Chart === "function") {
        adminRevenuePageMonthlyChart = destroyRevenueChart(adminRevenuePageMonthlyChart);
        adminRevenuePageMonthlyChart = new window.Chart(monthlyCanvas, {
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
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false, drawBorder: false }, ticks: { color: "#64748b", font: { family: "Manrope", size: 11, weight: "700" } } },
                    y: {
                        beginAtZero: true,
                        grid: { color: "rgba(148, 163, 184, 0.16)", drawBorder: false },
                        ticks: {
                            color: "#64748b",
                            font: { family: "Manrope", size: 11, weight: "700" },
                            callback: (value) => formatAdminRevenueAxisLabel(value),
                        },
                    },
                },
            },
        });
    }

    if (dailyCanvas && typeof window.Chart === "function") {
        adminRevenueDailyChart = destroyRevenueChart(adminRevenueDailyChart);
        adminRevenueDailyChart = new window.Chart(dailyCanvas, {
            type: "line",
            data: {
                labels: dailyTrend.map((item) => item.label),
                datasets: [
                    {
                        label: "Daily revenue",
                        data: dailyTrend.map((item) => Number(item.total_revenue || 0)),
                        borderColor: "#14b8a6",
                        backgroundColor: "rgba(20, 184, 166, 0.2)",
                        tension: 0.35,
                        fill: true,
                        borderWidth: 3,
                        pointRadius: 3,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                resizeDelay: 150,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false, drawBorder: false }, ticks: { color: "#64748b", font: { family: "Manrope", size: 11, weight: "700" } } },
                    y: {
                        beginAtZero: true,
                        grid: { color: "rgba(148, 163, 184, 0.16)", drawBorder: false },
                        ticks: {
                            color: "#64748b",
                            font: { family: "Manrope", size: 11, weight: "700" },
                            callback: (value) => formatAdminRevenueAxisLabel(value),
                        },
                    },
                },
            },
        });
    }

    if (sessionCanvas && typeof window.Chart === "function") {
        adminSessionDistributionChart = destroyRevenueChart(adminSessionDistributionChart);
        adminSessionDistributionChart = new window.Chart(sessionCanvas, {
            type: "doughnut",
            data: {
                labels: sessionDistribution.map((item) => normalizeStatusLabel(item.status)),
                datasets: [
                    {
                        data: sessionDistribution.map((item) => Number(item.count || 0)),
                        backgroundColor: ["#0f9f8f", "#f59e0b", "#2563eb", "#ef4444", "#8b5cf6", "#64748b"],
                        borderWidth: 0,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: {
                            color: "#475569",
                            font: { family: "Manrope", size: 11, weight: "700" },
                            boxWidth: 8,
                            padding: 12,
                            generateLabels: (chart) => {
                                const generate = window.Chart?.defaults?.plugins?.legend?.labels?.generateLabels;
                                const labels = generate ? generate(chart) : chart.legend?.legendItems || [];
                                return labels.map((label) => ({
                                    ...label,
                                    text:
                                        typeof window.truncateChartLabel === "function"
                                            ? window.truncateChartLabel(label.text, 16)
                                            : label.text,
                                }));
                            },
                        },
                    },
                },
            },
        });
    }
}

function renderAdminRevenueTables(analytics) {
    const stationContainer = document.getElementById("adminRevenueStationTable");
    const chargerContainer = document.getElementById("adminRevenueChargerTable");
    if (!stationContainer || !chargerContainer) {
        return;
    }

    const stations = Array.isArray(analytics?.station_revenue) ? analytics.station_revenue : [];
    const chargers = Array.isArray(analytics?.charger_revenue) ? analytics.charger_revenue : [];

    if (stations.length === 0) {
        stationContainer.innerHTML = "<div class='empty-state'>No station revenue data yet.</div>";
    } else {
        const rows = stations
            .map(
                (station) => `
                    <tr>
                        <td>
                            <span class="booking-table__primary">${escapeHtml(station.station_name)}</span>
                            <span class="booking-table__secondary">${escapeHtml(station.location || "-")}</span>
                        </td>
                    <td class="cell-number">${escapeHtml(station.charger_count || 0)}</td>
                    <td class="cell-number">${escapeHtml(station.paid_bookings || 0)}</td>
                    <td class="cell-currency">${escapeHtml(formatMoney(station.total_revenue || 0))}</td>
                </tr>
            `
        )
        .join("");
        stationContainer.innerHTML = `
            <div class="table-shell">
                <table class="table booking-table booking-table--revenue align-middle">
                    <thead>
                        <tr>
                            <th>Station</th>
                            <th class="cell-number">Chargers</th>
                            <th class="cell-number">Paid bookings</th>
                            <th class="cell-currency">Revenue</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    if (chargers.length === 0) {
        chargerContainer.innerHTML = "<div class='empty-state'>No charger revenue data yet.</div>";
    } else {
        const rows = chargers
            .slice(0, 10)
            .map(
                (charger) => `
                    <tr>
                        <td>
                            <span class="booking-table__primary">Slot ${escapeHtml(charger.slot_number)}</span>
                            <span class="booking-table__secondary">${escapeHtml(charger.station_name || "-")}</span>
                        </td>
                    <td>${escapeHtml(charger.charger_name || "-")}</td>
                    <td class="cell-number">${escapeHtml(charger.paid_bookings || 0)}</td>
                    <td class="cell-currency">${escapeHtml(formatMoney(charger.total_revenue || 0))}</td>
                </tr>
            `
        )
        .join("");
        chargerContainer.innerHTML = `
            <div class="table-shell">
                <table class="table booking-table booking-table--revenue align-middle">
                    <thead>
                        <tr>
                            <th>Slot</th>
                            <th>Charger</th>
                            <th class="cell-number">Paid bookings</th>
                            <th class="cell-currency">Revenue</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }
}

async function loadAdminRevenuePage(force = false) {
    if (getRole() !== "admin") {
        return;
    }
    if (adminManagementState.revenueLoaded && !force) {
        renderAdminRevenueSummary(adminManagementState.revenue);
        renderAdminRevenueCharts(adminManagementState.revenue);
        renderAdminRevenueTables(adminManagementState.revenue);
        return;
    }
    try {
        const analytics = await apiRequest("/api/admin/revenue", { method: "GET" }, true);
        adminManagementState.revenue = analytics;
        adminManagementState.revenueLoaded = true;
        renderAdminRevenueSummary(analytics);
        renderAdminRevenueCharts(analytics);
        renderAdminRevenueTables(analytics);
    } catch (error) {
        const container = document.getElementById("adminRevenueSummaryCards");
        if (container) {
            container.innerHTML = `<div class="col-12"><div class="empty-state text-danger">${escapeHtml(
                error.message
            )}</div></div>`;
        }
    }
}

async function loadAdminBookingStations() {
    const stationSelect = document.getElementById("adminBookingStationFilter");
    if (!stationSelect) {
        return;
    }
    try {
        const stations = await apiRequest("/api/admin/stations?status=all", { method: "GET" }, true);
        const options = [
            `<option value="all">All stations</option>`,
            ...stations.map(
                (station) =>
                    `<option value="${escapeHtml(station.station_id)}">${escapeHtml(
                        station.station_name
                    )}</option>`
            ),
        ];
        stationSelect.innerHTML = options.join("");
    } catch (_error) {
        stationSelect.innerHTML = `<option value="all">All stations</option>`;
    }
}

function handleAdminManagementClick(event) {
    const target = event.target;
    if (!target) {
        return;
    }

    const sortTrigger = target.closest("[data-sort]");
    if (sortTrigger) {
        const sortKey = sortTrigger.dataset.sort;
        if (sortKey) {
            if (adminManagementState.userSortKey === sortKey) {
                adminManagementState.userSortDirection = adminManagementState.userSortDirection === "asc" ? "desc" : "asc";
            } else {
                adminManagementState.userSortKey = sortKey;
                adminManagementState.userSortDirection = "asc";
            }
            renderAdminUsersTable(adminManagementState.users);
        }
        return;
    }

    const detailClose = target.closest(".admin-detail-close");
    if (detailClose) {
        const panelId = detailClose.dataset.target;
        const panel = panelId ? document.getElementById(panelId) : null;
        if (panel) {
            panel.style.display = "none";
        }
        return;
    }

    const slotId = target.closest("[data-slot-id]")?.dataset.slotId;
    if (slotId && target.closest(".admin-charger-toggle")) {
        const nextStatus = target.closest(".admin-charger-toggle")?.dataset.nextStatus || "";
        updateAdminChargerStatus(Number(slotId), nextStatus);
        return;
    }

    const userId = target.closest("[data-user-id]")?.dataset.userId;
    if (userId) {
        const numericId = Number(userId);
        const user = adminManagementState.users.find((item) => Number(item.user_id) === numericId);
        if (target.closest(".admin-user-view")) {
            renderAdminUserDetails(user);
            return;
        }
        if (target.closest(".admin-user-suspend")) {
            updateAdminUserStatus(numericId, "suspended");
            return;
        }
        if (target.closest(".admin-user-disable")) {
            updateAdminUserStatus(numericId, "disabled");
            return;
        }
        if (target.closest(".admin-user-activate")) {
            updateAdminUserStatus(numericId, "active");
            return;
        }
        if (target.closest(".admin-user-delete")) {
            deleteAdminUser(numericId);
            return;
        }
    }

    const stationId = target.closest("[data-station-id]")?.dataset.stationId;
    if (stationId) {
        const numericId = Number(stationId);
        const station = adminManagementState.stations.find((item) => Number(item.station_id) === numericId);
        if (target.closest(".admin-station-view")) {
            renderAdminStationDetails(station);
            return;
        }
        if (target.closest(".admin-station-edit")) {
            renderAdminStationDetails(station, null, "edit");
            return;
        }
        if (target.closest(".admin-station-edit-cancel")) {
            renderAdminStationDetails(station);
            return;
        }
        if (target.closest(".admin-station-chargers")) {
            loadAdminStationChargers(numericId).then((chargers) => {
                renderAdminStationDetails(station, chargers, "view");
            });
            return;
        }
        if (target.closest(".admin-station-approve")) {
            updateAdminStationApproval(numericId, "approved");
            return;
        }
        if (target.closest(".admin-station-disable")) {
            updateAdminStationApproval(numericId, "rejected");
            return;
        }
    }

    const bookingId = target.closest("[data-booking-id]")?.dataset.bookingId;
    if (bookingId) {
        const numericId = Number(bookingId);
        const booking = adminManagementState.bookings.find((item) => Number(item.booking_id) === numericId);
        if (target.closest(".admin-booking-view")) {
            renderAdminBookingDetails(booking);
            return;
        }
        if (target.closest(".admin-booking-cancel")) {
            cancelAdminBooking(numericId);
            return;
        }
    }
}

function bindAdminManagementEvents() {
    const userSearch = document.getElementById("adminUserSearch");
    const userRole = document.getElementById("adminUserRoleFilter");
    const userStatus = document.getElementById("adminUserStatusFilter");
    const userRefresh = document.getElementById("adminUserRefreshBtn");
    const stationStatus = document.getElementById("adminStationStatusFilter");
    const stationRefresh = document.getElementById("adminStationsRefreshBtn");
    const bookingApply = document.getElementById("adminBookingApplyFilters");
    const bookingReset = document.getElementById("adminBookingResetFilters");
    const bookingStatus = document.getElementById("adminBookingStatusFilter");
    const bookingStation = document.getElementById("adminBookingStationFilter");
    const bookingLocation = document.getElementById("adminBookingLocationFilter");
    const bookingStart = document.getElementById("adminBookingStartTime");
    const bookingEnd = document.getElementById("adminBookingEndTime");
    const bookingSort = document.getElementById("adminBookingSort");
    const revenueRefresh = document.getElementById("adminRevenueRefreshBtn");
    const bookingModal = document.getElementById("adminBookingModal");

    let searchTimer = null;
    userSearch?.addEventListener("input", () => {
        if (searchTimer) {
            clearTimeout(searchTimer);
        }
        searchTimer = setTimeout(() => {
            adminManagementState.usersLoaded = false;
            loadAdminUsers(true);
        }, 350);
    });
    userRole?.addEventListener("change", () => {
        adminManagementState.usersLoaded = false;
        loadAdminUsers(true);
    });
    userStatus?.addEventListener("change", () => {
        adminManagementState.usersLoaded = false;
        loadAdminUsers(true);
    });
    userRefresh?.addEventListener("click", () => {
        adminManagementState.usersLoaded = false;
        loadAdminUsers(true);
    });

    stationStatus?.addEventListener("change", () => {
        adminManagementState.stationsLoaded = false;
        loadAdminStationsManagement(true);
    });
    stationRefresh?.addEventListener("click", () => {
        adminManagementState.stationsLoaded = false;
        loadAdminStationsManagement(true);
    });

    let bookingTimer = null;
    const scheduleBookingRefresh = () => {
        if (bookingTimer) {
            clearTimeout(bookingTimer);
        }
        bookingTimer = setTimeout(() => {
            adminManagementState.bookingsLoaded = false;
            loadAdminBookings(true);
        }, 300);
    };

    bookingStatus?.addEventListener("change", scheduleBookingRefresh);
    bookingStation?.addEventListener("change", scheduleBookingRefresh);
    bookingSort?.addEventListener("change", scheduleBookingRefresh);
    bookingStart?.addEventListener("change", scheduleBookingRefresh);
    bookingEnd?.addEventListener("change", scheduleBookingRefresh);
    bookingLocation?.addEventListener("input", scheduleBookingRefresh);

    bookingApply?.addEventListener("click", () => {
        adminManagementState.bookingsLoaded = false;
        loadAdminBookings(true);
    });
    bookingReset?.addEventListener("click", () => {
        const statusFilter = document.getElementById("adminBookingStatusFilter");
        const stationFilter = document.getElementById("adminBookingStationFilter");
        const locationFilter = document.getElementById("adminBookingLocationFilter");
        const startTime = document.getElementById("adminBookingStartTime");
        const endTime = document.getElementById("adminBookingEndTime");
        const sortFilter = document.getElementById("adminBookingSort");
        if (statusFilter) {
            statusFilter.value = "all";
        }
        if (stationFilter) {
            stationFilter.value = "all";
        }
        if (locationFilter) {
            locationFilter.value = "";
        }
        if (startTime) {
            startTime.value = "";
        }
        if (endTime) {
            endTime.value = "";
        }
        if (sortFilter) {
            sortFilter.value = "date_desc";
        }
        adminManagementState.bookingsLoaded = false;
        loadAdminBookings(true);
    });

    revenueRefresh?.addEventListener("click", () => {
        adminManagementState.revenueLoaded = false;
        loadAdminRevenuePage(true);
    });

    bookingModal?.addEventListener("click", (event) => {
        if (event.target === bookingModal) {
            closeAdminBookingModal();
        }
    });

    document.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("[data-modal-close='adminBookingModal']")) {
            closeAdminBookingModal();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeAdminBookingModal();
        }
    });

    document.addEventListener("click", handleAdminManagementClick);
    document.addEventListener("submit", (event) => {
        const form = event.target;
        if (!form || form.id !== "adminStationEditForm") {
            return;
        }
        event.preventDefault();
        saveAdminStationEdit(form);
    });
}

function initAdminManagement() {
    bindAdminManagementEvents();
    loadAdminBookingStations();
}

window.handleDashboardTabChange = (tabName) => {
    if (getRole() !== "admin") {
        return;
    }
    if (tabName === "admin-users") {
        loadAdminUsers();
    }
    if (tabName === "admin-stations") {
        loadAdminStationsManagement();
    }
    if (tabName === "admin-bookings") {
        loadAdminBookings();
    }
    if (tabName === "admin-revenue") {
        loadAdminRevenuePage();
    }
};

window.initAdminManagement = initAdminManagement;
