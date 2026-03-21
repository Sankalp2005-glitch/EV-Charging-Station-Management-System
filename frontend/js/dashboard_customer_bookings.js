let currentQrToken = null;
let currentQrBookingId = null;

function setNearbyBookingsMeta(message, isError = false) {
    const meta = document.getElementById("nearbyBookingsMeta");
    if (!meta) {
        return;
    }
    meta.textContent = message || "";
    meta.classList.toggle("text-danger", Boolean(message) && isError);
}

function resolveBookingChargingLabel(booking) {
    const normalizedStatus = String(booking.status || "").toLowerCase();
    if (booking.charging_completed_at) {
        return `Completed ${booking.charging_completed_at}`;
    }
    if (booking.charging_started_at) {
        return `Started ${booking.charging_started_at}`;
    }
    if (normalizedStatus === "waiting_to_start") {
        return "Waiting for QR verification";
    }
    if (normalizedStatus === "cancelled") {
        return "Not applicable";
    }
    if (normalizedStatus === "charging_completed" || normalizedStatus === "completed") {
        return "Charging completed";
    }
    return "Not started";
}

function buildBookingChargingCell(booking) {
    const normalizedStatus = String(booking.status || "").toLowerCase();
    const shouldRenderProgress =
        normalizedStatus === "waiting_to_start" ||
        normalizedStatus === "charging_started" ||
        normalizedStatus === "charging_completed" ||
        normalizedStatus === "completed" ||
        Boolean(booking.charging_started_at) ||
        Boolean(booking.charging_completed_at);

    const progressHtml = shouldRenderProgress
        ? buildChargingProgressWidget(
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
              { title: "Charging session" }
          )
        : "";

    return `
        <div class="charging-cell">
            <div class="charging-cell__label">${escapeHtml(resolveBookingChargingLabel(booking))}</div>
            ${progressHtml}
        </div>
    `;
}

function buildUserBookingsTable(bookings, options = {}) {
    if (!Array.isArray(bookings) || bookings.length === 0) {
        return `<div class='empty-state'>${escapeHtml(
            options.emptyMessage || "No bookings found for this view."
        )}</div>`;
    }

    const rows = bookings
        .map((booking) => {
            const actionButtons = [];
            if (booking.can_cancel) {
                actionButtons.push(
                    `<button class="btn btn-outline-danger btn-sm" type="button" onclick="cancelBooking(${booking.booking_id})">Cancel</button>`
                );
            }
            if (booking.can_show_qr) {
                actionButtons.push(
                    `<button class="btn btn-outline-primary btn-sm" type="button" onclick="showBookingQr(${booking.booking_id})">Show QR</button>`
                );
            }

            const normalizedStatus = String(booking.status || "").toLowerCase();
            const paymentLabel = booking.payment_status
                ? `${normalizeStatusLabel(booking.payment_status)}${booking.payment_method ? ` (${booking.payment_method})` : ""}`
                : "Pending";
            const distanceLabel = formatDistanceKm(booking.distance_km);
            const durationLabel = booking.duration_display || formatDurationHuman(booking.duration_minutes || 0);
            const durationNote =
                normalizedStatus === "cancelled"
                    ? "Cancelled booking"
                    : normalizedStatus === "charging_completed" || normalizedStatus === "completed"
                    ? "Completed session"
                    : booking.is_future_booking
                    ? "Upcoming session"
                    : "In progress / recent";
            const fallbackActionLabel =
                normalizedStatus === "cancelled" || normalizedStatus === "charging_completed" || normalizedStatus === "completed"
                    ? "Closed"
                    : "No actions";

            return `
                <tr>
                    <td>
                        <span class="booking-table__primary">#${escapeHtml(booking.booking_id)}</span>
                        <span class="booking-table__secondary">${escapeHtml(booking.location || "Location unavailable")}${distanceLabel ? ` | ${escapeHtml(distanceLabel)}` : ""}</span>
                    </td>
                    <td>
                        <span class="booking-table__primary">${escapeHtml(booking.station_name)}</span>
                        <span class="booking-table__secondary">${escapeHtml(
                            booking.charger_name || `Slot ${booking.slot_number}`
                        )} | ${escapeHtml(normalizeVehicleCategoryLabel(booking.vehicle_category))}</span>
                    </td>
                    <td>
                        <span class="booking-table__primary">${escapeHtml(booking.start_time)}</span>
                        <span class="booking-table__secondary">${escapeHtml(booking.end_time)}</span>
                    </td>
                    <td>
                        <span class="booking-table__primary">${escapeHtml(durationLabel)}</span>
                        <span class="booking-table__secondary">${escapeHtml(durationNote)}</span>
                    </td>
                    <td>${buildChargerStatusBadge(booking.status)}</td>
                    <td>${buildStatusBadge(booking.payment_status || "pending", paymentLabel)}</td>
                    <td>${buildBookingChargingCell(booking)}</td>
                    <td>
                        <div class="booking-table__actions">
                            ${actionButtons.length > 0 ? actionButtons.join("") : `<span class='text-muted'>${fallbackActionLabel}</span>`}
                        </div>
                    </td>
                </tr>
            `;
        })
        .join("");

    return `
        <div class="table-shell">
            <table class="table booking-table booking-table--sessions align-middle">
                <thead>
                    <tr>
                        <th>Booking</th>
                        <th>Station / Charger</th>
                        <th>Schedule</th>
                        <th>Duration</th>
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
}

function renderMyBookings(bookings) {
    const container = document.getElementById("myBookingsList");
    if (!container) {
        return;
    }
    container.innerHTML = buildUserBookingsTable(bookings, {
        emptyMessage: "No bookings yet. Book a charger to see your sessions here.",
    });
    refreshChargingProgressWidgets(container);
}

function renderOwnerMyBookings(bookings) {
    const container = document.getElementById("ownerMyBookingsList");
    if (!container) {
        return;
    }
    container.innerHTML = buildUserBookingsTable(bookings, {
        emptyMessage: "No personal bookings found for this view.",
    });
    refreshChargingProgressWidgets(container);
}

async function loadMyBookings(view = bookingViewState.customer) {
    const section = document.getElementById("customerBookingsSection");
    const role = getRole();
    if (!section || role !== CUSTOMER_ROLE) {
        return;
    }

    bookingViewState.customer = view;
    setBookingViewButtons("customer", bookingViewState.customer);

    const query = new URLSearchParams();
    query.set("view", bookingViewState.customer);

    if (dashboardState.bookingNearbyOnly && dashboardState.nearbyOrigin && Number(dashboardState.nearbyRadiusKm) > 0) {
        query.set("latitude", dashboardState.nearbyOrigin.latitude);
        query.set("longitude", dashboardState.nearbyOrigin.longitude);
        query.set("radius", dashboardState.nearbyRadiusKm);
        setNearbyBookingsMeta(
            `Nearby bookings filter active for ${dashboardState.nearbyLabel || "your search"} within ${dashboardState.nearbyRadiusKm} km.`
        );
    } else if (dashboardState.bookingNearbyOnly && dashboardState.nearbyOrigin) {
        setNearbyBookingsMeta("Enter a radius greater than 0 km on the stations tab before filtering bookings nearby.", true);
    } else if (dashboardState.bookingNearbyOnly) {
        setNearbyBookingsMeta("Search for a place or use your location on the stations tab before filtering bookings nearby.", true);
    } else {
        setNearbyBookingsMeta("Uses the active map search or current location from the stations tab.");
    }

    try {
        const bookings = await apiRequest(
            `/api/bookings/my-bookings?${query.toString()}`,
            { method: "GET" },
            true
        );
        renderMyBookings(bookings);
        updateDashboardSummaryState({ customerBookings: bookings });
    } catch (error) {
        document.getElementById("myBookingsList").innerHTML = `<div class="empty-state text-danger">${escapeHtml(
            error.message
        )}</div>`;
    }
}

async function loadOwnerMyBookings(view = bookingViewState.ownerMine) {
    if (getRole() !== OWNER_ROLE) {
        return;
    }

    bookingViewState.ownerMine = view;
    setBookingViewButtons("ownerMyBookings", bookingViewState.ownerMine);

    try {
        const bookings = await apiRequest(
            `/api/bookings/my-bookings?view=${encodeURIComponent(bookingViewState.ownerMine)}`,
            { method: "GET" },
            true
        );
        renderOwnerMyBookings(bookings);
    } catch (error) {
        const container = document.getElementById("ownerMyBookingsList");
        if (container) {
            container.innerHTML = `<div class="empty-state text-danger">${escapeHtml(error.message)}</div>`;
        }
    }
}

async function cancelBooking(bookingId) {
    if (!window.confirm("Cancel this booking?")) {
        return;
    }

    try {
        const result = await apiRequest(`/api/bookings/cancel/${bookingId}`, { method: "PUT" }, true);
        alert(result.message || "Booking cancelled.");
        if (currentQrBookingId === bookingId) {
            hideBookingQrSection();
        }
        await loadStations();
        await loadMyBookings(bookingViewState.customer);
        if (getRole() === OWNER_ROLE) {
            await loadOwnerMyBookings(bookingViewState.ownerMine);
            await loadOwnerBookings(bookingViewState.owner);
            await loadOwnerStations();
            await loadOwnerStats();
            await loadOwnerRevenueAnalytics();
        }
        if (dashboardState.openStationId) {
            await toggleSlots(dashboardState.openStationId, dashboardState.openStationName, true);
        }
    } catch (error) {
        alert(error.message);
    }
}

function hideBookingQrSection() {
    const section = document.getElementById("bookingQrSection");
    const meta = document.getElementById("bookingQrMeta");
    const value = document.getElementById("bookingQrValue");
    const canvas = document.getElementById("bookingQrCanvas");

    currentQrToken = null;
    currentQrBookingId = null;
    if (section) {
        section.style.display = "none";
    }
    if (meta) {
        meta.innerText = "";
    }
    if (value) {
        value.innerText = "";
    }
    if (canvas) {
        const context = canvas.getContext("2d");
        if (context) {
            context.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
}

function renderBookingQrPayload(qrPayload, bookingIdOverride = null) {
    const section = document.getElementById("bookingQrSection");
    const meta = document.getElementById("bookingQrMeta");
    const value = document.getElementById("bookingQrValue");
    const canvas = document.getElementById("bookingQrCanvas");
    const bookingId = Number(bookingIdOverride || qrPayload?.booking_id || 0);

    if (!section || !meta || !value || !canvas) {
        alert("QR section is not available on this page.");
        return;
    }

    currentQrToken = qrPayload?.qr_token || null;
    currentQrBookingId = bookingId || null;
    section.style.display = "block";
    meta.innerText = `Booking #${bookingId} | Valid until ${qrPayload?.end_time || "-"} | Show this QR to the station owner`;
    value.innerText = qrPayload?.qr_value || "";

    if (window.QRCode && typeof window.QRCode.toCanvas === "function") {
        window.QRCode.toCanvas(canvas, qrPayload?.qr_value || qrPayload?.qr_token || "", {
            width: 220,
            margin: 1,
        }).catch(() => {
            value.innerText = qrPayload?.qr_value || "";
        });
    }

    window.scrollTo({ top: section.offsetTop - 20, behavior: "smooth" });
}

async function showBookingQr(bookingId) {
    try {
        const qrPayload = await apiRequest(`/api/bookings/${bookingId}/qr`, { method: "GET" }, true);
        renderBookingQrPayload(qrPayload, bookingId);
    } catch (error) {
        alert(error.message);
    }
}

window.cancelBooking = cancelBooking;
window.showBookingQr = showBookingQr;
window.renderBookingQrPayload = renderBookingQrPayload;
window.loadOwnerMyBookings = loadOwnerMyBookings;
