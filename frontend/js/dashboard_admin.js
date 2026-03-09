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

    const revenueSupported = stats?.revenue_estimate_supported !== false;
    const revenueText = revenueSupported ? formatMoney(Number(stats?.total_revenue || 0)) : "N/A";

    container.innerHTML = `
        <div class="col-md-2">
            <div class="card border-0 bg-body-tertiary h-100">
                <div class="card-body">
                    <div class="text-muted small">Users</div>
                    <div class="fs-5 fw-semibold">${Number(stats?.total_users || 0)}</div>
                </div>
            </div>
        </div>
        <div class="col-md-2">
            <div class="card border-0 bg-body-tertiary h-100">
                <div class="card-body">
                    <div class="text-muted small">Stations</div>
                    <div class="fs-5 fw-semibold">${Number(stats?.total_stations || 0)}</div>
                </div>
            </div>
        </div>
        <div class="col-md-2">
            <div class="card border-0 bg-body-tertiary h-100">
                <div class="card-body">
                    <div class="text-muted small">Bookings</div>
                    <div class="fs-5 fw-semibold">${Number(stats?.total_bookings || 0)}</div>
                </div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card border-0 bg-body-tertiary h-100">
                <div class="card-body">
                    <div class="text-muted small">Revenue</div>
                    <div class="fs-5 fw-semibold">${revenueText}</div>
                    ${
                        revenueSupported
                            ? ""
                            : '<div class="small text-muted">Estimated with fallback defaults.</div>'
                    }
                </div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card border-0 bg-body-tertiary h-100">
                <div class="card-body">
                    <div class="text-muted small">Active Sessions</div>
                    <div class="fs-5 fw-semibold">${Number(stats?.active_sessions || 0)}</div>
                </div>
            </div>
        </div>
    `;
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
    } catch (error) {
        container.innerHTML = `<p class="text-danger mb-0">${error.message}</p>`;
    }
}

function renderAdminStationApprovals(stations) {
    const container = document.getElementById("adminStationsApprovalList");
    if (!container) {
        return;
    }

    if (!Array.isArray(stations) || stations.length === 0) {
        container.innerHTML = "<p class='text-muted mb-0'>No stations found for this view.</p>";
        return;
    }

    const rows = stations
        .map((station) => {
            const status = station.approval_status || "pending";
            const statusBadgeClass =
                status === "approved"
                    ? "text-bg-success"
                    : status === "rejected"
                    ? "text-bg-danger"
                    : "text-bg-warning";

            const actions = `
                <button class="btn btn-outline-success btn-sm me-1"
                    ${status === "approved" ? "disabled" : ""}
                    onclick="updateAdminStationApproval(${station.station_id}, 'approved')">Approve</button>
                <button class="btn btn-outline-danger btn-sm"
                    ${status === "rejected" ? "disabled" : ""}
                    onclick="updateAdminStationApproval(${station.station_id}, 'rejected')">Reject</button>
            `;

            return `
                <tr>
                    <td>${station.station_id}</td>
                    <td>${station.station_name}</td>
                    <td>${station.location}</td>
                    <td>${station.owner_name}<br><span class="text-muted small">${station.owner_email}</span></td>
                    <td>${station.total_slots} (F:${station.fast_slots} / N:${station.normal_slots})</td>
                    <td><span class="badge ${statusBadgeClass}">${status}</span></td>
                    <td>${station.reviewed_by_name || "-"}</td>
                    <td>${station.reviewed_at || "-"}</td>
                    <td>${actions}</td>
                </tr>
            `;
        })
        .join("");

    container.innerHTML = `
        <table class="table table-striped table-sm align-middle">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Station</th>
                    <th>Location</th>
                    <th>Owner</th>
                    <th>Slots</th>
                    <th>Status</th>
                    <th>Reviewed By</th>
                    <th>Reviewed At</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
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
        container.innerHTML = `<p class="text-danger mb-0">${error.message}</p>`;
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
        await loadAdminStationApprovals(adminViewState.stationStatus);
        await loadStations();
        await loadOwnerStations();
    } catch (error) {
        alert(error.message);
    }
}

window.updateAdminStationApproval = updateAdminStationApproval;
