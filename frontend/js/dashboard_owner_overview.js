let ownerRevenueStationChart = null;
let ownerRevenueTrendChart = null;

const ownerBookingScopeState = {
    active: "station",
};

const ownerQrVerificationState = {
    bookingId: null,
    description: "",
};

function destroyChart(chart) {
    if (chart && typeof chart.destroy === "function") {
        chart.destroy();
    }
    return null;
}

function formatRevenueAxisLabel(value) {
    if (typeof window.formatCompactCurrencyTick === "function") {
        return window.formatCompactCurrencyTick(value);
    }
    return formatMoney(Number(value || 0));
}

function formatRevenueStationLabels(stations) {
    return stations.map((item) =>
        typeof window.wrapChartLabel === "function" ? window.wrapChartLabel(item.station_name) : item.station_name
    );
}

function renderRevenueBreakdownTable(containerId, stations, emptyMessage) {
    const container = document.getElementById(containerId);
    if (!container) {
        return;
    }

    if (!Array.isArray(stations) || stations.length === 0) {
        container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
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

function setOwnerBookingScopeButtons(activeScope) {
    const stationBtn = document.getElementById("ownerScopeStationBtn");
    const mineBtn = document.getElementById("ownerScopeMineBtn");
    if (stationBtn) {
        stationBtn.classList.toggle("btn-primary", activeScope === "station");
        stationBtn.classList.toggle("btn-outline-primary", activeScope !== "station");
    }
    if (mineBtn) {
        mineBtn.classList.toggle("btn-primary", activeScope === "mine");
        mineBtn.classList.toggle("btn-outline-primary", activeScope !== "mine");
    }
}

function switchOwnerBookingScope(scope = ownerBookingScopeState.active) {
    ownerBookingScopeState.active = scope === "mine" ? "mine" : "station";
    setOwnerBookingScopeButtons(ownerBookingScopeState.active);

    const stationPane = document.getElementById("ownerStationBookingsPane");
    const minePane = document.getElementById("ownerMyBookingsPane");
    if (stationPane) {
        stationPane.style.display = ownerBookingScopeState.active === "station" ? "block" : "none";
    }
    if (minePane) {
        minePane.style.display = ownerBookingScopeState.active === "mine" ? "block" : "none";
    }
}

function renderOwnerStations(stations) {
    const container = document.getElementById("ownerStationsList");
    if (!container) {
        return;
    }

    container.innerHTML = "";

    if (!Array.isArray(stations) || stations.length === 0) {
        container.innerHTML = "<div class='col-12'><div class='empty-state'>No stations created yet.</div></div>";
        return;
    }

    container.innerHTML = stations
        .map((station) => {
            const approvalStatus = station.approval_status || "pending";

            return `
                <div class="col-12 col-lg-6 col-xxl-4">
                    <article class="owner-station-card">
                        <div class="owner-station-card__header">
                            <div>
                                <span class="owner-station-card__eyebrow">My station</span>
                                <h6 class="owner-station-card__title">${escapeHtml(station.station_name)}</h6>
                            </div>
                            <span class="${getAvailabilityBadgeClass(approvalStatus)}">${escapeHtml(
                                normalizeStatusLabel(approvalStatus)
                            )}</span>
                        </div>

                        <p class="owner-station-card__location">
                            <i class="bi bi-geo-alt-fill"></i>
                            <span>${escapeHtml(station.location || "Location unavailable")}</span>
                        </p>

                        <div class="owner-station-card__stats">
                            <div class="owner-station-card__stat">
                                <span>Total chargers</span>
                                <strong>${escapeHtml(station.total_slots)}</strong>
                            </div>
                            <div class="owner-station-card__stat">
                                <span>Available now</span>
                                <strong>${escapeHtml(station.available_slots)}</strong>
                            </div>
                            <div class="owner-station-card__stat">
                                <span>Occupied</span>
                                <strong>${escapeHtml(station.occupied_slots)}</strong>
                            </div>
                            <div class="owner-station-card__stat">
                                <span>Charging</span>
                                <strong>${escapeHtml(station.charging_slots || 0)}</strong>
                            </div>
                        </div>

                        <div>
                            <span class="station-card__price-label">Contact</span>
                            <div class="station-card__price-value">${escapeHtml(station.contact_number || "-")}</div>
                        </div>

                        <div class="station-action-group">
                            <button
                                type="button"
                                class="btn btn-outline-primary btn-sm owner-view-slots-btn"
                                data-station-id="${Number(station.station_id) || 0}"
                                data-station-name="${escapeHtml(station.station_name)}"
                            >
                                View slots / book
                            </button>
                            <button type="button" class="btn btn-outline-secondary btn-sm owner-edit-station-btn">
                                Edit details
                            </button>
                        </div>

                        <div class="owner-slot-editor" style="display:none;"></div>
                    </article>
                </div>
            `;
        })
        .join("");

    container.querySelectorAll(".owner-view-slots-btn").forEach((button) => {
        button.addEventListener("click", () => {
            const stationId = Number(button.dataset.stationId || 0);
            const stationName = button.dataset.stationName || "";
            switchTab("stations");
            toggleSlots(stationId, stationName, true);
        });
    });

    container.querySelectorAll(".owner-edit-station-btn").forEach((button, index) => {
        button.addEventListener("click", () => toggleOwnerStationEditor(stations[index], button.closest(".owner-station-card")));
    });
}

function setOwnerStationScheduleViewButtons(activeView) {
    const views = ["upcoming", "past", "all"];
    views.forEach((view) => {
        const button = document.getElementById(`ownerStationBookings${view.charAt(0).toUpperCase()}${view.slice(1)}Btn`);
        if (!button) {
            return;
        }
        button.classList.toggle("btn-primary", activeView === view);
        button.classList.toggle("btn-outline-primary", activeView !== view);
    });
}

function renderOwnerStats(stats) {
    const container = document.getElementById("ownerStatsCards");
    if (!container) {
        return;
    }

    const mostUsed = stats?.most_used_slot;
    const mostUsedValue = mostUsed ? `${mostUsed.charger_name || `Slot ${mostUsed.slot_number}`}` : "N/A";
    const mostUsedMeta = mostUsed
        ? `${mostUsed.station_name} - ${mostUsed.usage_count} bookings`
        : "No booking data yet";

    const cards = [
        {
            tone: "amber",
            icon: "bi-calendar2-check-fill",
            label: "Total Bookings",
            value: Number(stats?.total_bookings || 0),
            meta: "Customer bookings across your stations",
        },
        {
            tone: "emerald",
            icon: "bi-cash-stack",
            label: "Revenue",
            value: formatMoney(Number(stats?.total_revenue || 0)),
            meta: "Paid booking revenue",
        },
        {
            tone: "blue",
            icon: "bi-lightning-charge-fill",
            label: "Charging Started",
            value: Number(stats?.active_bookings || 0),
            meta: "Sessions currently in progress",
        },
        {
            tone: "cyan",
            icon: "bi-star-fill",
            label: "Most Used Charger",
            value: mostUsedValue,
            meta: mostUsedMeta,
        },
    ];

    container.innerHTML = cards.map(buildMetricCard).join("");
}

function renderOwnerRevenueAnalytics(analytics) {
    const stationCanvas = document.getElementById("ownerRevenueStationChart");
    const trendCanvas = document.getElementById("ownerRevenueTrendChart");
    if (!stationCanvas || !trendCanvas || typeof window.Chart !== "function") {
        return;
    }

    const stationRevenue = Array.isArray(analytics?.station_revenue) ? analytics.station_revenue : [];
    const monthlyTrend = Array.isArray(analytics?.monthly_trend) ? analytics.monthly_trend : [];

    ownerRevenueStationChart = destroyChart(ownerRevenueStationChart);
    ownerRevenueTrendChart = destroyChart(ownerRevenueTrendChart);
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

    ownerRevenueStationChart = new window.Chart(stationCanvas, {
        type: "bar",
        data: {
            labels: formatRevenueStationLabels(stationRevenue),
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
                        callback: (value) => formatRevenueAxisLabel(value),
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

    ownerRevenueTrendChart = new window.Chart(trendCanvas, {
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
                        callback: (value) => formatRevenueAxisLabel(value),
                    },
                },
            },
        },
    });

    renderRevenueBreakdownTable(
        "ownerRevenueBreakdown",
        stationRevenue,
        "No revenue data available for your stations yet."
    );
}

async function loadOwnerRevenueAnalytics() {
    if (getRole() !== OWNER_ROLE) {
        return;
    }

    try {
        const analytics = await apiRequest("/api/owner/revenue-analytics", { method: "GET" }, true);
        renderOwnerRevenueAnalytics(analytics);
    } catch (error) {
        renderRevenueBreakdownTable("ownerRevenueBreakdown", [], error.message);
    }
}

async function loadOwnerStats() {
    if (getRole() !== OWNER_ROLE) {
        return;
    }

    const container = document.getElementById("ownerStatsCards");
    if (!container) {
        return;
    }

    try {
        const stats = await apiRequest("/api/owner/stats", { method: "GET" }, true);
        renderOwnerStats(stats);
        updateDashboardSummaryState({ ownerStats: stats });
    } catch (error) {
        container.innerHTML = `<div class="col-12"><div class="empty-state text-danger">${escapeHtml(
            error.message
        )}</div></div>`;
    }
}

function populateOwnerStationScheduleOptions(stations) {
    const select = document.getElementById("ownerStationScheduleFilter");
    if (!select) {
        return;
    }

    const stationList = Array.isArray(stations) ? stations : [];
    const previousValue = ownerStationScheduleState.stationId ? String(ownerStationScheduleState.stationId) : select.value;

    if (stationList.length === 0) {
        select.innerHTML = `<option value="">No stations available</option>`;
        ownerStationScheduleState.stationId = null;
        return;
    }

    const options = stationList
        .map(
            (station) =>
                `<option value="${station.station_id}">${escapeHtml(station.station_name)} (${escapeHtml(
                    station.location
                )})</option>`
        )
        .join("");
    select.innerHTML = options;

    const hasPrevious = stationList.some((station) => String(station.station_id) === String(previousValue));
    select.value = hasPrevious ? String(previousValue) : String(stationList[0].station_id);
    ownerStationScheduleState.stationId = Number(select.value);
}

function renderOwnerStationSchedule(data) {
    const container = document.getElementById("ownerStationScheduleList");
    if (!container) {
        return;
    }

    const slots = Array.isArray(data?.slots) ? data.slots : [];
    if (slots.length === 0) {
        container.innerHTML = "<div class='empty-state'>No customer bookings found for this station.</div>";
        return;
    }

    const cards = slots
        .map((slot) => {
            const bookings = Array.isArray(slot.bookings) ? slot.bookings : [];
            const bookingItems =
                bookings.length === 0
                    ? "<li class='text-muted'>No bookings for this view.</li>"
                    : bookings
                          .map(
                              (booking) => `
                                  <li>
                                      ${buildStatusBadge(booking.status)}
                                      <span>${escapeHtml(booking.start_time)} - ${escapeHtml(booking.end_time)}</span>
                                      <span class="text-muted">(${escapeHtml(booking.customer_name)})</span>
                                  </li>
                              `
                          )
                          .join("");

            return `
                <div class="col-12 col-lg-6">
                    <article class="schedule-card">
                        <h6 class="schedule-card__title">Slot ${escapeHtml(slot.slot_number)} (${escapeHtml(
                            normalizeStatusLabel(slot.slot_type)
                        )})</h6>
                        <div class="schedule-card__meta">
                            Current status:
                            <span class="${getAvailabilityBadgeClass(slot.current_status)}">${escapeHtml(
                                normalizeStatusLabel(slot.current_status)
                            )}</span>
                        </div>
                        <ul class="schedule-card__list">${bookingItems}</ul>
                    </article>
                </div>
            `;
        })
        .join("");

    container.innerHTML = `<div class="row g-3">${cards}</div>`;
}

async function loadOwnerStationSchedule(view = ownerStationScheduleState.view) {
    if (getRole() !== OWNER_ROLE) {
        return;
    }

    const container = document.getElementById("ownerStationScheduleList");
    const stationSelect = document.getElementById("ownerStationScheduleFilter");
    if (!container || !stationSelect) {
        return;
    }

    ownerStationScheduleState.view = view;
    setOwnerStationScheduleViewButtons(ownerStationScheduleState.view);

    const selectedStationId = Number(stationSelect.value || ownerStationScheduleState.stationId || 0);
    if (!Number.isInteger(selectedStationId) || selectedStationId <= 0) {
        container.innerHTML = "<div class='empty-state'>Select a station to view customer bookings.</div>";
        return;
    }

    ownerStationScheduleState.stationId = selectedStationId;

    try {
        const data = await apiRequest(
            `/api/owner/stations/${selectedStationId}/bookings?view=${encodeURIComponent(ownerStationScheduleState.view)}`,
            { method: "GET" },
            true
        );
        renderOwnerStationSchedule(data);
    } catch (error) {
        container.innerHTML = `<div class="empty-state text-danger">${escapeHtml(error.message)}</div>`;
    }
}

async function loadOwnerStations() {
    if (getRole() !== OWNER_ROLE) {
        return;
    }

    try {
        const stations = await apiRequest("/api/owner/stations", { method: "GET" }, true);
        renderOwnerStations(stations);
        populateOwnerStationScheduleOptions(stations);
        updateDashboardSummaryState({ ownerStations: stations });
        await loadOwnerStationSchedule(ownerStationScheduleState.view);
    } catch (error) {
        const container = document.getElementById("ownerStationsList");
        if (container) {
            container.innerHTML = `<div class="col-12"><div class="empty-state text-danger">${escapeHtml(
                error.message
            )}</div></div>`;
        }
    }
}

function openOwnerQrVerification(bookingId, description) {
    const section = document.getElementById("ownerQrVerificationSection");
    const meta = document.getElementById("ownerQrVerificationMeta");
    const input = document.getElementById("ownerQrTokenInput");
    if (!section || !meta || !input) {
        return;
    }

    ownerQrVerificationState.bookingId = bookingId;
    ownerQrVerificationState.description = description || `Booking #${bookingId}`;
    meta.innerText = ownerQrVerificationState.description;
    input.value = "";
    section.style.display = "block";
    input.focus();
    window.scrollTo({ top: section.offsetTop - 20, behavior: "smooth" });
}

function hideOwnerQrVerification() {
    const section = document.getElementById("ownerQrVerificationSection");
    const meta = document.getElementById("ownerQrVerificationMeta");
    const input = document.getElementById("ownerQrTokenInput");
    ownerQrVerificationState.bookingId = null;
    ownerQrVerificationState.description = "";
    if (section) {
        section.style.display = "none";
    }
    if (meta) {
        meta.innerText = "";
    }
    if (input) {
        input.value = "";
    }
}

async function submitOwnerQrVerification() {
    const tokenInput = document.getElementById("ownerQrTokenInput");
    const qrToken = String(tokenInput?.value || "").trim();
    if (!qrToken) {
        alert("Paste the scanned QR token or QR value first.");
        return;
    }

    try {
        const result = await apiRequest(
            "/api/bookings/scan-qr",
            {
                method: "POST",
                body: JSON.stringify({ qr_token: qrToken }),
            },
            true
        );
        alert(result.message || "Charging session started.");
        hideOwnerQrVerification();
        await loadStations();
        await loadOwnerBookings(bookingViewState.owner);
        await loadOwnerStationSchedule(ownerStationScheduleState.view);
        await loadOwnerStations();
        await loadOwnerStats();
        await loadOwnerRevenueAnalytics();
        await loadOwnerMyBookings(bookingViewState.ownerMine);
        if (dashboardState.openStationId) {
            await toggleSlots(dashboardState.openStationId, dashboardState.openStationName, true);
        }
    } catch (error) {
        alert(error.message);
    }
}

function renderOwnerBookings(bookings) {
    const container = document.getElementById("ownerBookingsList");
    if (!container) {
        return;
    }

    if (!Array.isArray(bookings) || bookings.length === 0) {
        container.innerHTML = "<div class='empty-state'>No customer station bookings found for this view.</div>";
        return;
    }

    const rows = bookings
        .map((booking) => {
            const actions = [];
            if (booking.can_verify_qr) {
                actions.push(
                    `<button
                        class="btn btn-success btn-sm owner-verify-qr-btn"
                        type="button"
                        data-booking-id="${Number(booking.booking_id) || 0}"
                        data-description="${escapeHtml(
                            `${booking.customer_name} | ${booking.station_name} | ${booking.charger_name || `Slot ${booking.slot_number}`}`
                        )}"
                    >Verify QR</button>`
                );
            }
            if (booking.can_cancel) {
                actions.push(
                    `<button class="btn btn-outline-danger btn-sm" type="button" onclick="cancelOwnerBooking(${booking.booking_id})">Cancel</button>`
                );
            }
            const actionHtml = actions.length > 0 ? actions.join("") : "<span class='text-muted'>Locked</span>";
            const chargingLabel = booking.charging_started_at
                ? `Started ${booking.charging_started_at}`
                : booking.status === "waiting_to_start"
                ? "Waiting for verification"
                : booking.status === "charging_completed"
                ? "Charging completed"
                : "Not started";
            const chargingWidget = buildChargingProgressWidget(
                {
                    status: booking.status,
                    charging_started_at: booking.charging_started_at,
                    charging_completed_at: booking.charging_completed_at,
                    duration_minutes: booking.duration_minutes,
                    current_battery_percent: booking.current_battery_percent,
                    target_battery_percent: booking.target_battery_percent,
                    charging_progress_percent: booking.charging_progress_percent,
                    estimated_current_battery_percent: booking.estimated_current_battery_percent,
                    estimated_completion_time: booking.estimated_completion_time,
                    remaining_minutes: booking.remaining_minutes,
                },
                { title: "Charging progress" }
            );

            return `
                <tr>
                    <td>
                        <span class="booking-table__primary">#${escapeHtml(booking.booking_id)}</span>
                        <span class="booking-table__secondary">${escapeHtml(booking.customer_email)}</span>
                    </td>
                    <td>
                        <span class="booking-table__primary">${escapeHtml(booking.customer_name)}</span>
                        <span class="booking-table__secondary">${escapeHtml(booking.station_name)}</span>
                    </td>
                    <td>
                        <span class="booking-table__primary">${escapeHtml(booking.charger_name || `Slot ${booking.slot_number}`)}</span>
                        <span class="booking-table__secondary">${escapeHtml(normalizeVehicleCategoryLabel(booking.vehicle_category))}</span>
                    </td>
                    <td>
                        <span class="booking-table__primary">${escapeHtml(booking.start_time)}</span>
                        <span class="booking-table__secondary">${escapeHtml(booking.duration_display || formatDurationHuman(booking.duration_minutes || 0))}</span>
                    </td>
                    <td>${buildStatusBadge(booking.status)}</td>
                    <td>${buildStatusBadge(booking.payment_status || "pending")}</td>
                    <td>
                        <div class="charging-cell">
                            <div class="charging-cell__label">${escapeHtml(chargingLabel)}</div>
                            ${chargingWidget}
                        </div>
                    </td>
                    <td>
                        <div class="booking-table__actions">${actionHtml}</div>
                    </td>
                </tr>
            `;
        })
        .join("");

    container.innerHTML = `
        <div class="table-shell">
            <table class="table booking-table align-middle">
                <thead>
                    <tr>
                        <th>Booking</th>
                        <th>Customer</th>
                        <th>Charger</th>
                        <th>Schedule</th>
                        <th>Status</th>
                        <th>Payment</th>
                        <th>Charging</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;

    container.querySelectorAll(".owner-verify-qr-btn").forEach((button) => {
        button.addEventListener("click", () => {
            const bookingId = Number(button.dataset.bookingId || 0);
            const description = button.dataset.description || "";
            openOwnerQrVerification(bookingId, description);
        });
    });
    refreshChargingProgressWidgets(container);
}

async function loadOwnerBookings(view = bookingViewState.owner) {
    if (getRole() !== OWNER_ROLE) {
        return;
    }

    bookingViewState.owner = view;
    setBookingViewButtons("ownerBookings", bookingViewState.owner);

    try {
        const bookings = await apiRequest(
            `/api/owner/bookings?view=${encodeURIComponent(bookingViewState.owner)}`,
            { method: "GET" },
            true
        );
        renderOwnerBookings(bookings);
    } catch (error) {
        const container = document.getElementById("ownerBookingsList");
        if (container) {
            container.innerHTML = `<div class="empty-state text-danger">${escapeHtml(error.message)}</div>`;
        }
    }
}

async function cancelOwnerBooking(bookingId) {
    if (!window.confirm("Cancel this booking?")) {
        return;
    }

    try {
        const result = await apiRequest(`/api/owner/cancel-booking/${bookingId}`, { method: "PUT" }, true);
        alert(result.message || "Booking cancelled.");
        await loadStations();
        await loadOwnerStations();
        await loadOwnerBookings(bookingViewState.owner);
        await loadOwnerStationSchedule(ownerStationScheduleState.view);
        await loadOwnerStats();
        await loadOwnerRevenueAnalytics();
        if (dashboardState.openStationId) {
            await toggleSlots(dashboardState.openStationId, dashboardState.openStationName, true);
        }
    } catch (error) {
        alert(error.message);
    }
}

window.cancelOwnerBooking = cancelOwnerBooking;
window.openOwnerQrVerification = openOwnerQrVerification;
window.hideOwnerQrVerification = hideOwnerQrVerification;
window.submitOwnerQrVerification = submitOwnerQrVerification;
window.switchOwnerBookingScope = switchOwnerBookingScope;
window.loadOwnerRevenueAnalytics = loadOwnerRevenueAnalytics;
