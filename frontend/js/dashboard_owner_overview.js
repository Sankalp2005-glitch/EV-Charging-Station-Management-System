function renderOwnerStations(stations) {
    const container = document.getElementById("ownerStationsList");
    container.innerHTML = "";

    if (!Array.isArray(stations) || stations.length === 0) {
        container.innerHTML = "<p class='text-muted mb-0'>No stations created yet.</p>";
        return;
    }

    stations.forEach((station) => {
        const col = document.createElement("div");
        col.className = "col-md-4";
        const approvalStatus = station.approval_status || "pending";
        const approvalBadgeClass =
            approvalStatus === "approved"
                ? "text-bg-success"
                : approvalStatus === "rejected"
                ? "text-bg-danger"
                : "text-bg-warning";
        col.innerHTML = `
            <div class="card border-0 bg-body-tertiary mb-3 h-100">
                <div class="card-body">
                    <h6>${station.station_name}</h6>
                    <p class="mb-1">Location: ${station.location}</p>
                    <p class="mb-1">Contact: ${station.contact_number || "-"}</p>
                    <p class="mb-1">Total slots: ${station.total_slots}</p>
                    <p class="mb-1">Available now: ${station.available_slots}</p>
                    <p class="mb-0">Occupied now: ${station.occupied_slots}</p>
                    <div class="small mt-1 mb-2">Approval: <span class="badge ${approvalBadgeClass}">${approvalStatus}</span></div>
                    <div class="mt-2 d-flex gap-2 flex-wrap">
                        <button class="btn btn-sm btn-outline-primary owner-view-slots-btn">View Slots / Book</button>
                        <button class="btn btn-sm btn-outline-secondary owner-edit-station-btn">Edit Details</button>
                    </div>
                    <div class="owner-slot-editor mt-2" style="display:none;"></div>
                </div>
            </div>
        `;
        const viewButton = col.querySelector(".owner-view-slots-btn");
        viewButton?.addEventListener("click", () => {
            toggleSlots(station.station_id, station.station_name, true);
            window.scrollTo({ top: 0, behavior: "smooth" });
        });
        const editButton = col.querySelector(".owner-edit-station-btn");
        editButton?.addEventListener("click", () => toggleOwnerStationEditor(station, col));
        container.appendChild(col);
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
    const mostUsedLabel = mostUsed
        ? `${mostUsed.station_name} - Slot ${mostUsed.slot_number} (${mostUsed.usage_count})`
        : "No booking data yet";
    const revenueSupported = stats?.revenue_estimate_supported !== false;
    const revenueText = revenueSupported ? formatMoney(Number(stats?.total_revenue || 0)) : "N/A";

    container.innerHTML = `
        <div class="col-md-3">
            <div class="card border-0 bg-body-tertiary h-100">
                <div class="card-body">
                    <div class="text-muted small">Total Bookings</div>
                    <div class="fs-5 fw-semibold">${Number(stats?.total_bookings || 0)}</div>
                </div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card border-0 bg-body-tertiary h-100">
                <div class="card-body">
                    <div class="text-muted small">Total Revenue</div>
                    <div class="fs-5 fw-semibold">${revenueText}</div>
                    ${
                        revenueSupported
                            ? ""
                            : '<div class="small text-muted">Pricing columns unavailable in DB.</div>'
                    }
                </div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card border-0 bg-body-tertiary h-100">
                <div class="card-body">
                    <div class="text-muted small">Active Bookings</div>
                    <div class="fs-5 fw-semibold">${Number(stats?.active_bookings || 0)}</div>
                </div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card border-0 bg-body-tertiary h-100">
                <div class="card-body">
                    <div class="text-muted small">Most Used Slot</div>
                    <div class="small fw-semibold">${mostUsedLabel}</div>
                </div>
            </div>
        </div>
    `;
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
    } catch (error) {
        container.innerHTML = `<p class="text-danger mb-0">${error.message}</p>`;
    }
}

function populateOwnerStationScheduleOptions(stations) {
    const select = document.getElementById("ownerStationScheduleFilter");
    if (!select) {
        return;
    }

    const stationList = Array.isArray(stations) ? stations : [];
    const previousValue = ownerStationScheduleState.stationId
        ? String(ownerStationScheduleState.stationId)
        : select.value;

    if (stationList.length === 0) {
        select.innerHTML = `<option value="">No stations available</option>`;
        ownerStationScheduleState.stationId = null;
        return;
    }

    const options = stationList
        .map(
            (station) =>
                `<option value="${station.station_id}">${station.station_name} (${station.location})</option>`
        )
        .join("");
    select.innerHTML = options;

    const hasPrevious = stationList.some((station) => String(station.station_id) === String(previousValue));
    if (hasPrevious) {
        select.value = String(previousValue);
    } else {
        select.value = String(stationList[0].station_id);
    }

    ownerStationScheduleState.stationId = Number(select.value);
}

function renderOwnerStationSchedule(data) {
    const container = document.getElementById("ownerStationScheduleList");
    if (!container) {
        return;
    }

    const slots = Array.isArray(data?.slots) ? data.slots : [];
    if (slots.length === 0) {
        container.innerHTML = "<p class='text-muted mb-0'>No slots found for this station.</p>";
        return;
    }

    const cards = slots
        .map((slot) => {
            const statusClass = slot.current_status === "occupied" ? "text-danger" : "text-success";
            const bookings = Array.isArray(slot.bookings) ? slot.bookings : [];
            const bookingItems =
                bookings.length === 0
                    ? "<li class='text-muted'>No bookings for this view.</li>"
                    : bookings
                          .map((booking) => {
                              const statusBadgeClass =
                                  booking.status === "confirmed"
                                      ? "text-bg-primary"
                                      : booking.status === "completed"
                                      ? "text-bg-success"
                                      : "text-bg-secondary";
                              return `
                                  <li class="mb-1">
                                      <span class="badge ${statusBadgeClass} me-1">${booking.status}</span>
                                      ${booking.start_time} - ${booking.end_time}
                                      <span class="text-muted">(${booking.customer_name})</span>
                                  </li>
                              `;
                          })
                          .join("");

            return `
                <div class="col-md-6">
                    <div class="card border-0 bg-body-tertiary h-100">
                        <div class="card-body">
                            <h6 class="mb-1">Slot ${slot.slot_number} (${slot.slot_type})</h6>
                            <div class="small mb-2">Current: <span class="${statusClass}">${slot.current_status}</span></div>
                            <ul class="small mb-0 ps-3">${bookingItems}</ul>
                        </div>
                    </div>
                </div>
            `;
        })
        .join("");

    container.innerHTML = `<div class="row g-2">${cards}</div>`;
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
        container.innerHTML = "<p class='text-muted mb-0'>Select a station to view bookings.</p>";
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
        container.innerHTML = `<p class="text-danger mb-0">${error.message}</p>`;
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
        await loadOwnerStationSchedule(ownerStationScheduleState.view);
    } catch (error) {
        document.getElementById("ownerStationsList").innerHTML = `<p class="text-danger mb-0">${error.message}</p>`;
    }
}

function renderOwnerBookings(bookings) {
    const container = document.getElementById("ownerBookingsList");

    if (!Array.isArray(bookings) || bookings.length === 0) {
        container.innerHTML = "<p class='text-muted mb-0'>No bookings found for this view.</p>";
        return;
    }

    const rows = bookings
        .map((booking) => {
            const cancelButton = booking.can_cancel
                ? `<button class="btn btn-outline-danger btn-sm" onclick="cancelOwnerBooking(${booking.booking_id})">Cancel</button>`
                : "-";
            const chargingState = booking.charging_started_at
                ? `Started at ${booking.charging_started_at}`
                : "Not started";

            return `
                <tr>
                    <td>${booking.booking_id}</td>
                    <td>${booking.customer_name}</td>
                    <td>${booking.customer_email}</td>
                    <td>${booking.station_name}</td>
                    <td>${booking.slot_number} (${booking.slot_type})</td>
                    <td>${booking.start_time}</td>
                    <td>${booking.end_time}</td>
                    <td>${booking.status}</td>
                    <td>${chargingState}</td>
                    <td>${cancelButton}</td>
                </tr>
            `;
        })
        .join("");

    container.innerHTML = `
        <table class="table table-striped table-sm align-middle">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Customer</th>
                    <th>Email</th>
                    <th>Station</th>
                    <th>Slot</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Status</th>
                    <th>Charging</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
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
        document.getElementById("ownerBookingsList").innerHTML = `<p class="text-danger mb-0">${error.message}</p>`;
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
        await loadOwnerStats();
        if (dashboardState.openStationId) {
            await toggleSlots(dashboardState.openStationId, dashboardState.openStationName, true);
        }
    } catch (error) {
        alert(error.message);
    }
}

window.cancelOwnerBooking = cancelOwnerBooking;
