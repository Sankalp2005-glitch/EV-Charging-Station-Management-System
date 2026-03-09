let currentQrToken = null;
let currentQrBookingId = null;

function renderMyBookings(bookings) {
    const container = document.getElementById("myBookingsList");

    if (!Array.isArray(bookings) || bookings.length === 0) {
        container.innerHTML = "<p class='text-muted mb-0'>No bookings yet.</p>";
        return;
    }

    const rows = bookings
        .map((booking) => {
            const actionButtons = [];
            if (booking.can_cancel) {
                actionButtons.push(
                    `<button class="btn btn-outline-danger btn-sm" onclick="cancelBooking(${booking.booking_id})">Cancel</button>`
                );
            }
            if (booking.can_show_qr) {
                actionButtons.push(
                    `<button class="btn btn-outline-primary btn-sm" onclick="showBookingQr(${booking.booking_id})">Show QR</button>`
                );
            }
            const chargingState = booking.charging_started_at
                ? `Started at ${booking.charging_started_at}`
                : "Not started";
            const paymentText = booking.payment_status
                ? `${booking.payment_status}${booking.payment_method ? ` (${booking.payment_method})` : ""}`
                : "-";
            const actions = actionButtons.length > 0 ? actionButtons.join(" ") : "-";

            return `
                <tr>
                    <td>${booking.booking_id}</td>
                    <td>${booking.station_name}</td>
                    <td>${booking.slot_number} (${booking.slot_type})</td>
                    <td>${booking.start_time}</td>
                    <td>${booking.end_time}</td>
                    <td>${booking.duration_minutes} min</td>
                    <td>${booking.status}</td>
                    <td>${paymentText}</td>
                    <td>${chargingState}</td>
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
                    <th>Slot</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Charging</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

async function loadMyBookings(view = bookingViewState.customer) {
    const section = document.getElementById("customerBookingsSection");
    const role = getRole();
    if (!section || (role !== CUSTOMER_ROLE && role !== OWNER_ROLE)) {
        return;
    }
    bookingViewState.customer = view;
    setBookingViewButtons("customer", bookingViewState.customer);

    try {
        const bookings = await apiRequest(
            `/api/bookings/my-bookings?view=${encodeURIComponent(bookingViewState.customer)}`,
            { method: "GET" },
            true
        );
        renderMyBookings(bookings);
    } catch (error) {
        document.getElementById("myBookingsList").innerHTML = `<p class="text-danger mb-0">${error.message}</p>`;
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

async function showBookingQr(bookingId) {
    try {
        const qrPayload = await apiRequest(`/api/bookings/${bookingId}/qr`, { method: "GET" }, true);
        const section = document.getElementById("bookingQrSection");
        const meta = document.getElementById("bookingQrMeta");
        const value = document.getElementById("bookingQrValue");
        const canvas = document.getElementById("bookingQrCanvas");

        if (!section || !meta || !value || !canvas) {
            alert("QR section is not available on this page.");
            return;
        }

        currentQrToken = qrPayload.qr_token;
        currentQrBookingId = bookingId;
        section.style.display = "block";
        meta.innerText = `Booking #${bookingId} | Valid until ${qrPayload.end_time}`;
        value.innerText = qrPayload.qr_value || "";

        if (window.QRCode && typeof window.QRCode.toCanvas === "function") {
            await window.QRCode.toCanvas(canvas, qrPayload.qr_value || qrPayload.qr_token || "", {
                width: 220,
                margin: 1,
            });
        }
        window.scrollTo({ top: section.offsetTop - 20, behavior: "smooth" });
    } catch (error) {
        alert(error.message);
    }
}

async function scanCurrentQrBooking() {
    if (!currentQrToken) {
        alert("Open a booking QR first.");
        return;
    }

    try {
        const result = await apiRequest(
            "/api/bookings/scan-qr",
            {
                method: "POST",
                body: JSON.stringify({ qr_token: currentQrToken }),
            },
            true
        );
        alert(result.message || "Charging session started.");
        await loadStations();
        await loadMyBookings(bookingViewState.customer);
        if (getRole() === OWNER_ROLE) {
            await loadOwnerBookings(bookingViewState.owner);
            await loadOwnerStations();
            await loadOwnerStats();
        }
        if (dashboardState.openStationId) {
            await toggleSlots(dashboardState.openStationId, dashboardState.openStationName, true);
        }
    } catch (error) {
        alert(error.message);
    }
}

window.cancelBooking = cancelBooking;
window.showBookingQr = showBookingQr;
