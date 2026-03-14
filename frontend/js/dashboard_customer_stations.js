function buildStationCard(station, preview = false) {
    const compatibleChargers = Number(station.matching_slots ?? station.total_slots ?? 0) || 0;
    const availableChargers = Number(station.available_slots ?? 0) || 0;
    const occupiedChargers = Number(station.occupied_slots ?? 0) || 0;
    const chargingChargers = Number(station.charging_slots ?? 0) || 0;
    const pricing = normalizePriceInfo(station.price_info);
    const availabilityStatus = station.availability_status || "unknown";
    const badgeClass = getAvailabilityBadgeClass(availabilityStatus);

    return `
        <div class="col-12 ${preview ? "col-xl-6" : "col-md-6 col-xxl-4"}">
            <article class="station-card-shell">
                <div class="station-card__header">
                    <div>
                        <span class="station-card__eyebrow">Charging station</span>
                        <h5 class="station-card__title">${escapeHtml(station.station_name)}</h5>
                    </div>
                    <span class="${badgeClass}">${escapeHtml(normalizeStatusLabel(availabilityStatus))}</span>
                </div>

                <p class="station-card__location">
                    <i class="bi bi-geo-alt-fill"></i>
                    <span>${escapeHtml(station.location || "Location unavailable")}</span>
                </p>

                <div class="station-metric-grid">
                    <div class="station-metric">
                        <span class="station-metric__label">Chargers</span>
                        <span class="station-metric__value">${compatibleChargers}</span>
                    </div>
                    <div class="station-metric">
                        <span class="station-metric__label">Available</span>
                        <span class="station-metric__value">${availableChargers}</span>
                    </div>
                    <div class="station-metric">
                        <span class="station-metric__label">Occupied</span>
                        <span class="station-metric__value">${occupiedChargers}</span>
                    </div>
                    <div class="station-metric">
                        <span class="station-metric__label">Charging</span>
                        <span class="station-metric__value">${chargingChargers}</span>
                    </div>
                </div>

                <div class="station-card__footer">
                    <div>
                        <span class="station-card__price-label">Pricing</span>
                        <div class="station-card__price-value">${escapeHtml(pricing)}</div>
                    </div>
                    <button
                        type="button"
                        class="btn btn-primary btn-sm"
                        data-station-action="open-slots"
                        data-station-id="${Number(station.station_id) || 0}"
                        data-station-name="${escapeHtml(station.station_name)}"
                    >
                        Book
                    </button>
                </div>
            </article>
        </div>
    `;
}

function renderStationCollection(containerId, stations, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) {
        return;
    }

    if (!Array.isArray(stations) || stations.length === 0) {
        container.innerHTML = `<div class="col-12"><div class="empty-state">${escapeHtml(
            options.emptyMessage || "No stations available."
        )}</div></div>`;
        return;
    }

    const items = options.limit ? stations.slice(0, options.limit) : stations;
    container.innerHTML = items.map((station) => buildStationCard(station, Boolean(options.preview))).join("");

    container.querySelectorAll("[data-station-action='open-slots']").forEach((button) => {
        button.addEventListener("click", () => {
            const stationId = Number(button.dataset.stationId || 0);
            const stationName = button.dataset.stationName || "";
            switchTab("stations");
            toggleSlots(stationId, stationName, true);
        });
    });
}

function renderStations(stations) {
    renderStationCollection("stationsList", stations, {
        preview: true,
        limit: 4,
        emptyMessage: "No stations found for the current filter set.",
    });
    renderStationCollection("stationsFullList", stations, {
        emptyMessage: "No stations found for the current filter set.",
    });
}

async function loadStations() {
    const locationFilter = document.getElementById("locationFilter")?.value.trim() || "";
    const slotTypeFilter = document.getElementById("slotTypeFilter")?.value.trim() || "";
    const vehicleCategoryFilter = normalizeVehicleCategory(
        document.getElementById("vehicleCategoryFilter")?.value.trim() || ""
    );

    const query = new URLSearchParams();
    if (locationFilter) {
        query.append("location", locationFilter);
    }
    if (slotTypeFilter) {
        query.append("slot_type", slotTypeFilter);
    }
    if (vehicleCategoryFilter) {
        query.append("vehicle_category", vehicleCategoryFilter);
    }

    const suffix = query.toString() ? `?${query.toString()}` : "";

    try {
        const stations = await apiRequest(`/api/bookings/stations${suffix}`, { method: "GET" }, true);
        renderStations(stations);
        updateDashboardSummaryState({ stations });
    } catch (error) {
        const errorMessage = error.message || "Failed to load stations.";
        renderStationCollection("stationsList", [], { preview: true, emptyMessage: errorMessage });
        renderStationCollection("stationsFullList", [], { emptyMessage: errorMessage });
    }
}

function buildSlotBookingForm(slot, minDatetime) {
    const role = getRole();
    if (role !== CUSTOMER_ROLE && role !== OWNER_ROLE) {
        return "";
    }

    const vehicleCategory = normalizeVehicleCategory(slot.vehicle_category) || VEHICLE_CATEGORY_CAR;
    const defaultBattery = DEFAULT_BATTERY_BY_CATEGORY[vehicleCategory] || "";

    return `
        <div class="slot-booking-form">
            <input type="datetime-local" id="start-${slot.slot_id}" class="form-control" min="${minDatetime}">
            <input type="hidden" id="vehicle-category-${slot.slot_id}" value="${escapeHtml(vehicleCategory)}">
            <div class="slot-booking-form__meta">
                Compatible vehicle: <strong>${escapeHtml(normalizeVehicleCategoryLabel(vehicleCategory))}</strong>
            </div>
            <input
                type="number"
                id="battery-${slot.slot_id}"
                class="form-control"
                min="1"
                step="0.1"
                required
                placeholder="Battery capacity (kWh, e.g. ${defaultBattery})"
            >
            <input
                type="number"
                id="current-${slot.slot_id}"
                class="form-control"
                min="0"
                max="99"
                step="0.1"
                required
                placeholder="Current battery (%)"
            >
            <input
                type="number"
                id="target-${slot.slot_id}"
                class="form-control"
                min="1"
                max="100"
                step="0.1"
                required
                placeholder="Target battery (%)"
            >
            <select id="payment-method-${slot.slot_id}" class="form-select">
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
            </select>
            <div class="form-check mb-3">
                <input class="form-check-input" type="checkbox" id="payment-ok-${slot.slot_id}" checked>
                <label class="form-check-label" for="payment-ok-${slot.slot_id}">
                    Payment successful (simulated)
                </label>
            </div>
            <div id="estimate-${slot.slot_id}" class="small text-muted mb-3">Enter battery details to see estimate.</div>
            <button type="button" class="btn btn-success btn-sm w-100" data-slot-action="book" data-slot-id="${slot.slot_id}">
                Book slot
            </button>
        </div>
    `;
}

let slotAutoRefreshInFlight = false;

function captureSlotBookingFormState(container) {
    if (!container) {
        return null;
    }

    const state = {};
    const elements = container.querySelectorAll(
        "input[id^='start-'], input[id^='battery-'], input[id^='current-'], input[id^='target-'], input[id^='vehicle-category-'], select[id^='payment-method-'], input[id^='payment-ok-']"
    );

    elements.forEach((element) => {
        const match = element.id.match(/^(start|battery|current|target|vehicle-category|payment-method|payment-ok)-(\d+)$/);
        if (!match) {
            return;
        }
        const field = match[1];
        const slotId = match[2];
        if (!state[slotId]) {
            state[slotId] = {};
        }
        state[slotId][field] = element.type === "checkbox" ? element.checked : element.value;
    });

    const active = document.activeElement;
    if (active && active.id) {
        const match = active.id.match(/^(start|battery|current|target|vehicle-category|payment-method|payment-ok)-(\d+)$/);
        if (match) {
            state.__active = {
                slotId: match[2],
                field: match[1],
            };
            if (typeof active.selectionStart === "number" && typeof active.selectionEnd === "number") {
                state.__active.selection = [active.selectionStart, active.selectionEnd];
            }
        }
    }

    return state;
}

function restoreSlotBookingFormState(container, state) {
    if (!container || !state) {
        return;
    }

    Object.keys(state).forEach((slotId) => {
        if (slotId === "__active") {
            return;
        }
        const values = state[slotId];
        if (!values) {
            return;
        }

        const startField = container.querySelector(`#start-${slotId}`);
        if (startField && "start" in values) {
            startField.value = values.start ?? "";
        }
        const batteryField = container.querySelector(`#battery-${slotId}`);
        if (batteryField && "battery" in values) {
            batteryField.value = values.battery ?? "";
        }
        const currentField = container.querySelector(`#current-${slotId}`);
        if (currentField && "current" in values) {
            currentField.value = values.current ?? "";
        }
        const targetField = container.querySelector(`#target-${slotId}`);
        if (targetField && "target" in values) {
            targetField.value = values.target ?? "";
        }
        const vehicleField = container.querySelector(`#vehicle-category-${slotId}`);
        if (vehicleField && "vehicle-category" in values) {
            vehicleField.value = values["vehicle-category"] ?? vehicleField.value;
        }
        const paymentField = container.querySelector(`#payment-method-${slotId}`);
        if (paymentField && "payment-method" in values) {
            paymentField.value = values["payment-method"] ?? paymentField.value;
        }
        const paymentOkField = container.querySelector(`#payment-ok-${slotId}`);
        if (paymentOkField && "payment-ok" in values) {
            paymentOkField.checked = Boolean(values["payment-ok"]);
        }

        ["battery", "current", "target"].forEach((field) => {
            const input = container.querySelector(`#${field}-${slotId}`);
            if (input) {
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
    });

    if (state.__active) {
        const { slotId, field, selection } = state.__active;
        const target = container.querySelector(`#${field}-${slotId}`);
        if (target) {
            target.focus();
            if (selection && typeof target.setSelectionRange === "function") {
                target.setSelectionRange(selection[0], selection[1]);
            }
        }
    }
}

function renderSlots(slots, stationName, options = {}) {
    const slotsSection = document.getElementById("slotsSection");
    const slotsDiv = document.getElementById("slotsList");
    const slotsTitle = document.getElementById("slotsTitle");

    if (!slotsSection || !slotsDiv || !slotsTitle) {
        return;
    }

    slotsTitle.innerText = `Chargers at ${stationName}`;
    slotsDiv.innerHTML = "";

    if (!Array.isArray(slots) || slots.length === 0) {
        slotsDiv.innerHTML = "<div class='col-12'><div class='empty-state'>No chargers found for this station.</div></div>";
        slotsSection.style.display = "block";
        return;
    }

    const minDatetime = new Date(Date.now() + 60 * 1000).toISOString().slice(0, 16);

    slotsDiv.innerHTML = slots
        .map((slot) => {
            const currentStatus = slot.current_status || slot.status || "available";
            const activeSession = slot.active_session || null;
            const powerKw = Number(slot.power_kw);
            const pricePerKwh = slot.price_per_kwh === null ? null : Number(slot.price_per_kwh);
            const pricePerMinute = slot.price_per_minute === null ? null : Number(slot.price_per_minute);
            const vehicleCategory = normalizeVehicleCategory(slot.vehicle_category) || VEHICLE_CATEGORY_CAR;
            const chargingSpeed = slot.charging_speed || classifyChargingSpeed(powerKw, vehicleCategory);
            const pricingText =
                Number.isFinite(pricePerKwh) && pricePerKwh > 0
                    ? `${formatMoney(pricePerKwh)} / kWh`
                    : Number.isFinite(pricePerMinute) && pricePerMinute > 0
                    ? `${formatMoney(pricePerMinute)} / min`
                    : "Not configured";
            const bookingsHtml =
                Array.isArray(slot.bookings) && slot.bookings.length > 0
                    ? slot.bookings
                          .map(
                              (booking) =>
                                  `<li>${escapeHtml(booking.start_time)} - ${escapeHtml(booking.end_time)}</li>`
                          )
                           .join("")
                    : "<li class='text-muted'>No upcoming reservations</li>";
            const liveSessionHtml = activeSession
                ? buildChargingProgressWidget(
                      {
                          status: "charging_started",
                          charging_started_at: activeSession.charging_started_at,
                          charging_completed_at: activeSession.charging_completed_at,
                          duration_minutes: activeSession.duration_minutes,
                          current_battery_percent: activeSession.current_battery_percent,
                          target_battery_percent: activeSession.target_battery_percent,
                          charging_progress_percent: activeSession.progress_percent,
                          estimated_current_battery_percent: activeSession.estimated_current_battery_percent,
                          estimated_completion_time: activeSession.estimated_completion_time,
                          remaining_minutes: activeSession.remaining_minutes,
                      },
                      { title: "Live charging" }
                  )
                : currentStatus === "occupied" && slot.active_booking
                ? `<div class="slot-session-note">Reserved until ${escapeHtml(slot.active_booking.end_time)}</div>`
                : `<div class="slot-session-note">Ready for the next <span class="evgo-wordmark evgo-wordmark--inline">EV<span class="evgo-wordmark__go">go</span></span> session.</div>`;

            return `
                <div class="col-12 col-lg-6 col-xxl-4">
                    <article class="slot-card">
                        <div class="slot-card__header">
                            <div>
                                <span class="station-card__eyebrow">Slot ${escapeHtml(slot.slot_number)}</span>
                                <h6 class="slot-card__title">${escapeHtml(slot.charger_name || `Charger ${slot.slot_number}`)}</h6>
                                <div class="slot-card__subtitle">${escapeHtml(normalizeStatusLabel(slot.slot_type))} charger</div>
                            </div>
                            <span class="${getAvailabilityBadgeClass(currentStatus)}">${escapeHtml(
                                normalizeStatusLabel(currentStatus)
                            )}</span>
                        </div>

                        <div class="slot-metric-grid">
                            <div class="slot-metric">
                                <span class="slot-metric__label">Power</span>
                                <span class="slot-metric__value">${Number.isFinite(powerKw) ? `${powerKw.toFixed(2)} kW` : "N/A"}</span>
                            </div>
                            <div class="slot-metric">
                                <span class="slot-metric__label">Vehicle</span>
                                <span class="slot-metric__value">${escapeHtml(normalizeVehicleCategoryLabel(vehicleCategory))}</span>
                            </div>
                            <div class="slot-metric">
                                <span class="slot-metric__label">Pricing</span>
                                <span class="slot-metric__value">${escapeHtml(pricingText)}</span>
                            </div>
                            <div class="slot-metric">
                                <span class="slot-metric__label">Connector</span>
                                <span class="slot-metric__value">${escapeHtml(slot.connector_type || "N/A")}</span>
                            </div>
                            <div class="slot-metric">
                                <span class="slot-metric__label">Charging speed</span>
                                <span class="slot-metric__value">${escapeHtml(chargingSpeed)}</span>
                            </div>
                            <div class="slot-metric">
                                <span class="slot-metric__label">Available now</span>
                                <span class="slot-metric__value">${slot.is_available_now ? "Yes" : "No"}</span>
                            </div>
                        </div>

                        <div>
                            <span class="slot-price-label">Upcoming reservations</span>
                            <ul class="slot-card__list">${bookingsHtml}</ul>
                        </div>

                        ${liveSessionHtml}

                        ${buildSlotBookingForm(slot, minDatetime)}
                    </article>
                </div>
            `;
        })
        .join("");

    slotsDiv.querySelectorAll("[data-slot-action='book']").forEach((button) => {
        button.addEventListener("click", () => {
            const slotId = Number(button.dataset.slotId || 0);
            bookSlot(slotId);
        });
    });

    slots.forEach((slot) => {
        const powerKw = Number(slot.power_kw);
        const pricePerKwh = slot.price_per_kwh === null ? null : Number(slot.price_per_kwh);
        const pricePerMinute = slot.price_per_minute === null ? null : Number(slot.price_per_minute);
        const vehicleCategory = normalizeVehicleCategory(slot.vehicle_category) || VEHICLE_CATEGORY_CAR;
        const estimateHandler = () =>
            updateSlotEstimateDisplay(slot.slot_id, powerKw, pricePerKwh, pricePerMinute, vehicleCategory);

        slotsDiv.querySelector(`#battery-${slot.slot_id}`)?.addEventListener("input", estimateHandler);
        slotsDiv.querySelector(`#current-${slot.slot_id}`)?.addEventListener("input", estimateHandler);
        slotsDiv.querySelector(`#target-${slot.slot_id}`)?.addEventListener("input", estimateHandler);
        estimateHandler();
    });

    slotsSection.style.display = "block";
    refreshChargingProgressWidgets(slotsDiv);
    if (options.preserveFormState) {
        restoreSlotBookingFormState(slotsDiv, options.preserveFormState);
    }
    if (!options.skipScroll) {
        window.scrollTo({ top: slotsSection.offsetTop - 90, behavior: "smooth" });
    }
}

async function toggleSlots(stationId, stationName, forceOpen = false) {
    const slotsSection = document.getElementById("slotsSection");
    const slotsDiv = document.getElementById("slotsList");

    if (!slotsSection || !slotsDiv) {
        return;
    }

    if (!forceOpen && dashboardState.openStationId === stationId && slotsSection.style.display === "block") {
        slotsSection.style.display = "none";
        slotsDiv.innerHTML = "";
        dashboardState.openStationId = null;
        dashboardState.openStationName = "";
        return;
    }

    try {
        const preserveFormState =
            slotsSection.style.display === "block" && dashboardState.openStationId === stationId
                ? captureSlotBookingFormState(slotsDiv)
                : null;
        const slots = await apiRequest(`/api/bookings/stations/${stationId}/slots`, { method: "GET" }, true);
        dashboardState.openStationId = stationId;
        dashboardState.openStationName = stationName || `Station ${stationId}`;
        renderSlots(slots, dashboardState.openStationName, { preserveFormState });
    } catch (error) {
        alert(error.message);
    }
}

async function refreshOpenStationSlotsIfVisible() {
    const slotsSection = document.getElementById("slotsSection");
    const slotsDiv = document.getElementById("slotsList");
    if (
        slotAutoRefreshInFlight ||
        !dashboardState.openStationId ||
        !slotsSection ||
        !slotsDiv ||
        slotsSection.style.display !== "block"
    ) {
        return;
    }

    const preserveFormState = captureSlotBookingFormState(slotsDiv);
    slotAutoRefreshInFlight = true;
    try {
        const slots = await apiRequest(
            `/api/bookings/stations/${dashboardState.openStationId}/slots`,
            { method: "GET" },
            true
        );
        renderSlots(slots, dashboardState.openStationName, {
            skipScroll: true,
            preserveFormState,
        });
    } catch (_error) {
        // Keep auto-refresh silent to avoid repeated alerts while the panel is open.
    } finally {
        slotAutoRefreshInFlight = false;
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
    const vehicleCategoryField = document.getElementById(`vehicle-category-${slotId}`);
    const paymentMethodField = document.getElementById(`payment-method-${slotId}`);
    const paymentOkField = document.getElementById(`payment-ok-${slotId}`);

    const startTime = startField?.value;
    const batteryCapacityKwh = parseOptionalNumber(batteryField?.value);
    const currentBatteryPercent = parseOptionalNumber(currentField?.value);
    const targetBatteryPercent = parseOptionalNumber(targetField?.value);
    const vehicleCategory = normalizeVehicleCategory(vehicleCategoryField?.value || "");
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
    if (!vehicleCategory) {
        alert("This charger is missing vehicle compatibility details.");
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
                    vehicle_category: vehicleCategory,
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
            `Booking successful.\nEstimated duration: ${booking.duration_display || formatDurationHuman(booking.duration_minutes)}\nEstimated cost: ${costText}\nPayment: ${booking.payment_status || "paid"}`
        );

        if (typeof renderBookingQrPayload === "function") {
            renderBookingQrPayload(booking, booking.booking_id);
        } else {
            await showBookingQr(booking.booking_id);
        }

        await loadStations();
        if (dashboardState.openStationId) {
            await toggleSlots(dashboardState.openStationId, dashboardState.openStationName, true);
        }
        await loadMyBookings();
        if (role === OWNER_ROLE) {
            await loadOwnerStations();
            await loadOwnerBookings(bookingViewState.owner);
            await loadOwnerMyBookings(bookingViewState.ownerMine);
            await loadOwnerStats();
            await loadOwnerRevenueAnalytics();
        }
    } catch (error) {
        alert(error.message);
    }
}

window.toggleSlots = toggleSlots;
window.bookSlot = bookSlot;
window.refreshOpenStationSlotsIfVisible = refreshOpenStationSlotsIfVisible;
