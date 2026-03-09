function renderStations(stations) {
    const stationsDiv = document.getElementById("stationsList");
    stationsDiv.innerHTML = "";

    if (!Array.isArray(stations) || stations.length === 0) {
        stationsDiv.innerHTML = "<p class='text-muted'>No stations found for current filters.</p>";
        return;
    }

    stations.forEach((station) => {
        const col = document.createElement("div");
        col.className = "col-md-4";

        const statusClass = station.availability_status === "available" ? "text-bg-success" : "text-bg-secondary";

        col.innerHTML = `
            <div class="card shadow mb-3 h-100">
                <div class="card-body">
                    <h5>${station.station_name}</h5>
                    <p class="mb-1">Location: ${station.location}</p>
                    <p class="mb-1">Configured Slots: ${station.matching_slots ?? station.total_slots}</p>
                    <p class="mb-1">Available Now: ${station.available_slots ?? 0}</p>
                    <p class="mb-1">Occupied Now: ${station.occupied_slots ?? 0}</p>
                    <span class="badge ${statusClass} mb-3">${station.availability_status || "unknown"}</span>
                    <div>
                        <button class="btn btn-primary btn-sm w-100">View Slots</button>
                    </div>
                </div>
            </div>
        `;

        const viewButton = col.querySelector("button");
        viewButton.addEventListener("click", () => {
            toggleSlots(station.station_id, station.station_name);
        });

        stationsDiv.appendChild(col);
    });
}

async function loadStations() {
    const locationFilter = document.getElementById("locationFilter")?.value.trim() || "";
    const slotTypeFilter = document.getElementById("slotTypeFilter")?.value.trim() || "";

    const query = new URLSearchParams();
    if (locationFilter) {
        query.append("location", locationFilter);
    }
    if (slotTypeFilter) {
        query.append("slot_type", slotTypeFilter);
    }

    const suffix = query.toString() ? `?${query.toString()}` : "";

    try {
        const stations = await apiRequest(`/api/bookings/stations${suffix}`, { method: "GET" }, true);
        renderStations(stations);
    } catch (error) {
        document.getElementById("stationsList").innerHTML = `<p class="text-danger">${error.message}</p>`;
    }
}

function renderSlots(slots, stationName) {
    const slotsSection = document.getElementById("slotsSection");
    const slotsDiv = document.getElementById("slotsList");
    const slotsTitle = document.getElementById("slotsTitle");
    const role = getRole();

    slotsTitle.innerText = `Station Slots: ${stationName}`;
    slotsDiv.innerHTML = "";

    if (!Array.isArray(slots) || slots.length === 0) {
        slotsDiv.innerHTML = "<p class='text-muted'>No slots found for this station.</p>";
        slotsSection.style.display = "block";
        return;
    }

    const minDatetime = new Date(Date.now() + 60 * 1000).toISOString().slice(0, 16);

    slots.forEach((slot) => {
        const currentStatus = slot.current_status || slot.status || "available";
        const isOccupied = currentStatus === "occupied";
        const statusIndicator = isOccupied ? "Occupied" : "Available";
        const statusClass = isOccupied ? "text-danger" : "text-success";
        const powerKw = Number(slot.power_kw);
        const pricePerKwh = slot.price_per_kwh === null ? null : Number(slot.price_per_kwh);
        const pricePerMinute = slot.price_per_minute === null ? null : Number(slot.price_per_minute);
        const pricingText =
            Number.isFinite(pricePerKwh) && pricePerKwh > 0
                ? `${formatMoney(pricePerKwh)} / kWh`
                : Number.isFinite(pricePerMinute) && pricePerMinute > 0
                ? `${formatMoney(pricePerMinute)} / min`
                : "Not configured";

        const bookingsHtml =
            Array.isArray(slot.bookings) && slot.bookings.length > 0
                ? slot.bookings
                      .map((booking) => `<li>${booking.start_time} - ${booking.end_time}</li>`)
                      .join("")
                : "<li>No upcoming bookings</li>";

        const bookingFormHtml =
            role === CUSTOMER_ROLE || role === OWNER_ROLE
                ? `
                    <hr>
                    <input type="datetime-local" id="start-${slot.slot_id}" class="form-control mb-2" min="${minDatetime}">
                    <input type="number"
                           id="battery-${slot.slot_id}"
                           class="form-control mb-2"
                           min="1"
                           step="0.1"
                           required
                           placeholder="Battery capacity (kWh)">
                    <input type="number"
                           id="current-${slot.slot_id}"
                           class="form-control mb-2"
                           min="0"
                           max="99"
                           step="0.1"
                           required
                           placeholder="Current battery (%)">
                     <input type="number"
                            id="target-${slot.slot_id}"
                            class="form-control mb-2"
                            min="1"
                            max="100"
                            step="0.1"
                            required
                            placeholder="Target battery (%)">
                    <select id="payment-method-${slot.slot_id}" class="form-select mb-2">
                        <option value="upi">UPI</option>
                        <option value="card">Card</option>
                        <option value="cash">Cash</option>
                    </select>
                    <div class="form-check mb-2">
                        <input class="form-check-input" type="checkbox" id="payment-ok-${slot.slot_id}" checked>
                        <label class="form-check-label" for="payment-ok-${slot.slot_id}">
                            Payment successful (simulated)
                        </label>
                    </div>
                    <div id="estimate-${slot.slot_id}" class="small text-muted mb-2">Enter battery details to see estimate.</div>
                    <button class="btn btn-success btn-sm w-100">Book Slot</button>
                `
                : "";

        const col = document.createElement("div");
        col.className = "col-md-4";
        col.innerHTML = `
            <div class="card shadow mb-3 h-100">
                <div class="card-body">
                    <h6>Slot ${slot.slot_number}</h6>
                    <p class="mb-1">Type: ${slot.slot_type}</p>
                    <p class="mb-1">Power: ${Number.isFinite(powerKw) ? `${powerKw.toFixed(2)} kW` : "N/A"}</p>
                    <p class="mb-1">Rate: ${pricingText}</p>
                    <p class="mb-1">Current Status: <strong class="${statusClass}">${statusIndicator}</strong></p>
                    <p class="mb-2">Available Now: ${slot.is_available_now ? "Yes" : "No"}</p>
                    <p class="mb-1"><strong>Upcoming Reservations:</strong></p>
                    <ul class="mb-2">${bookingsHtml}</ul>
                    ${bookingFormHtml}
                </div>
            </div>
        `;

        const bookButton = col.querySelector("button");
        if (bookButton) {
            bookButton.addEventListener("click", () => bookSlot(slot.slot_id));
        }

        const estimateHandler = () =>
            updateSlotEstimateDisplay(slot.slot_id, powerKw, pricePerKwh, pricePerMinute);
        col.querySelector(`#battery-${slot.slot_id}`)?.addEventListener("input", estimateHandler);
        col.querySelector(`#current-${slot.slot_id}`)?.addEventListener("input", estimateHandler);
        col.querySelector(`#target-${slot.slot_id}`)?.addEventListener("input", estimateHandler);
        estimateHandler();

        slotsDiv.appendChild(col);
    });

    slotsSection.style.display = "block";
}

async function toggleSlots(stationId, stationName, forceOpen = false) {
    const slotsSection = document.getElementById("slotsSection");
    const slotsDiv = document.getElementById("slotsList");

    if (!forceOpen && dashboardState.openStationId === stationId && slotsSection.style.display === "block") {
        slotsSection.style.display = "none";
        slotsDiv.innerHTML = "";
        dashboardState.openStationId = null;
        dashboardState.openStationName = "";
        return;
    }

    try {
        const slots = await apiRequest(`/api/bookings/stations/${stationId}/slots`, { method: "GET" }, true);
        dashboardState.openStationId = stationId;
        dashboardState.openStationName = stationName || `Station ${stationId}`;
        renderSlots(slots, dashboardState.openStationName);
    } catch (error) {
        alert(error.message);
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
    const paymentMethodField = document.getElementById(`payment-method-${slotId}`);
    const paymentOkField = document.getElementById(`payment-ok-${slotId}`);

    const startTime = startField?.value;
    const batteryCapacityKwh = parseOptionalNumber(batteryField?.value);
    const currentBatteryPercent = parseOptionalNumber(currentField?.value);
    const targetBatteryPercent = parseOptionalNumber(targetField?.value);
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
    if (!paymentSuccess) {
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
        alert(
            `Booking successful.\nEstimated duration: ${booking.duration_minutes} min\nEstimated cost: ${costText}\nPayment: ${booking.payment_status || "paid"}`
        );
        await loadStations();
        if (dashboardState.openStationId) {
            await toggleSlots(dashboardState.openStationId, dashboardState.openStationName, true);
        }
        if (role === CUSTOMER_ROLE || role === OWNER_ROLE) {
            await loadMyBookings();
        }
        if (role === OWNER_ROLE) {
            await loadOwnerStations();
            await loadOwnerBookings(bookingViewState.owner);
            await loadOwnerStats();
        }
        await showBookingQr(booking.booking_id);
    } catch (error) {
        alert(error.message);
    }
}

window.toggleSlots = toggleSlots;
window.bookSlot = bookSlot;
