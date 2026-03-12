const CONNECTOR_OPTIONS_BY_CATEGORY = {
    bike_scooter: ["Portable Socket", "LECCS"],
    car: ["Type 2", "CCS2", "CHAdeMO", "GB/T"],
};

const DEFAULT_POWER_BY_CATEGORY_AND_TYPE = {
    bike_scooter: { normal: 3.3, fast: 7.4 },
    car: { normal: 7.4, fast: 60 },
};

function getConnectorOptions(vehicleCategory) {
    return CONNECTOR_OPTIONS_BY_CATEGORY[normalizeVehicleCategory(vehicleCategory)] || CONNECTOR_OPTIONS_BY_CATEGORY.car;
}

function getRecommendedPowerKw(vehicleCategory, chargerType) {
    const normalizedVehicleCategory = normalizeVehicleCategory(vehicleCategory) || VEHICLE_CATEGORY_CAR;
    const normalizedChargerType = String(chargerType || "normal").trim().toLowerCase() === "fast" ? "fast" : "normal";
    return DEFAULT_POWER_BY_CATEGORY_AND_TYPE[normalizedVehicleCategory]?.[normalizedChargerType] || 7.4;
}

function buildConnectorOptionsHtml(vehicleCategory, selectedValue) {
    return getConnectorOptions(vehicleCategory)
        .map(
            (option) =>
                `<option value="${escapeHtml(option)}" ${option === selectedValue ? "selected" : ""}>${escapeHtml(option)}</option>`
        )
        .join("");
}

function buildOwnerChargerCardHtml(slotNumber, charger = {}, isEdit = false) {
    const chargerType = String(charger.charger_type || charger.slot_type || "normal").trim().toLowerCase() === "fast" ? "fast" : "normal";
    const vehicleCategory = normalizeVehicleCategory(charger.vehicle_category) || VEHICLE_CATEGORY_CAR;
    const connectorType = charger.connector_type || getConnectorOptions(vehicleCategory)[0];
    const powerKwValue =
        Number.isFinite(Number(charger.power_kw)) && Number(charger.power_kw) > 0
            ? Number(charger.power_kw)
            : getRecommendedPowerKw(vehicleCategory, chargerType);
    const parsedPricePerKwh = Number(charger.price_per_kwh);
    const parsedPricePerMinute = Number(charger.price_per_minute);
    const pricePerKwhValue = Number.isFinite(parsedPricePerKwh) && parsedPricePerKwh > 0 ? parsedPricePerKwh : "";
    const pricePerMinuteValue =
        Number.isFinite(parsedPricePerMinute) && parsedPricePerMinute > 0 ? parsedPricePerMinute : "";
    const slotIdInput = isEdit
        ? `<input type="hidden" class="owner-charger-slot-id" value="${Number(charger.slot_id) || 0}">`
        : "";

    return `
        <div class="col-12 col-xl-6">
            <div class="charger-config-card">
                ${slotIdInput}
                <div class="charger-config-card__header">
                    <span class="section-heading__eyebrow">Charger ${escapeHtml(slotNumber)}</span>
                    <strong>${escapeHtml(charger.charger_name || `Charger ${slotNumber}`)}</strong>
                </div>
                <div class="row g-2">
                    <div class="col-md-6">
                        <label class="form-label mb-1">Charger name</label>
                        <input type="text" class="form-control owner-charger-name-input" value="${escapeHtml(
                            charger.charger_name || `Charger ${slotNumber}`
                        )}" placeholder="Charger name" required>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label mb-1">Charger type</label>
                        <select class="form-select owner-charger-type-input" required>
                            <option value="normal" ${chargerType === "normal" ? "selected" : ""}>Normal</option>
                            <option value="fast" ${chargerType === "fast" ? "selected" : ""}>Fast</option>
                        </select>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label mb-1">Vehicle category</label>
                        <select class="form-select owner-vehicle-category-input" required>
                            <option value="bike_scooter" ${vehicleCategory === VEHICLE_CATEGORY_BIKE ? "selected" : ""}>Bike / Scooter</option>
                            <option value="car" ${vehicleCategory === VEHICLE_CATEGORY_CAR ? "selected" : ""}>Car</option>
                        </select>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label mb-1">Power rating (kW)</label>
                        <input type="number" class="form-control owner-charger-power-input" min="0.1" step="0.1" value="${escapeHtml(
                            powerKwValue
                        )}" placeholder="Power rating" required>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label mb-1">Connector type</label>
                        <select class="form-select owner-connector-type-input" required>
                            ${buildConnectorOptionsHtml(vehicleCategory, connectorType)}
                        </select>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label mb-1">Price / kWh</label>
                        <input type="number" class="form-control owner-price-kwh-input" min="0.01" step="0.01" value="${escapeHtml(
                            pricePerKwhValue
                        )}" placeholder="Optional">
                        <p class="form-helper-text form-helper-text--optional">Optional. Use this when billing by delivered energy.</p>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label mb-1">Price / minute</label>
                        <input type="number" class="form-control owner-price-minute-input" min="0.01" step="0.01" value="${escapeHtml(
                            pricePerMinuteValue
                        )}" placeholder="Optional">
                        <p class="form-helper-text form-helper-text--optional">Optional. Use this when billing by charging time.</p>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function wireChargerCard(card) {
    const vehicleSelect = card.querySelector(".owner-vehicle-category-input");
    const chargerTypeSelect = card.querySelector(".owner-charger-type-input");
    const connectorSelect = card.querySelector(".owner-connector-type-input");
    const powerInput = card.querySelector(".owner-charger-power-input");

    const syncRecommendedValues = () => {
        const vehicleCategory = normalizeVehicleCategory(vehicleSelect?.value || "");
        const chargerType = String(chargerTypeSelect?.value || "normal").trim().toLowerCase();
        const optionsHtml = buildConnectorOptionsHtml(vehicleCategory, connectorSelect?.value);
        if (connectorSelect) {
            connectorSelect.innerHTML = optionsHtml;
            if (!connectorSelect.value) {
                connectorSelect.value = getConnectorOptions(vehicleCategory)[0];
            }
        }
        if (powerInput && !String(powerInput.value || "").trim()) {
            powerInput.value = String(getRecommendedPowerKw(vehicleCategory, chargerType));
        }
    };

    vehicleSelect?.addEventListener("change", syncRecommendedValues);
    chargerTypeSelect?.addEventListener("change", syncRecommendedValues);
}

function collectChargerPayload(rootSelector) {
    const cards = Array.from(document.querySelectorAll(rootSelector));
    const chargers = [];

    for (const card of cards) {
        const chargerName = String(card.querySelector(".owner-charger-name-input")?.value || "").trim();
        const chargerType = String(card.querySelector(".owner-charger-type-input")?.value || "").trim().toLowerCase();
        const vehicleCategory = normalizeVehicleCategory(card.querySelector(".owner-vehicle-category-input")?.value || "");
        const connectorType = String(card.querySelector(".owner-connector-type-input")?.value || "").trim();
        const powerKw = parseOptionalNumber(card.querySelector(".owner-charger-power-input")?.value);
        const pricePerKwh = parseOptionalNumber(card.querySelector(".owner-price-kwh-input")?.value);
        const pricePerMinute = parseOptionalNumber(card.querySelector(".owner-price-minute-input")?.value);
        const slotId = Number(card.querySelector(".owner-charger-slot-id")?.value || 0) || null;

        if (!chargerName) {
            alert("Every charger must have a charger name.");
            return null;
        }
        if (chargerType !== "fast" && chargerType !== "normal") {
            alert("Every charger must have a valid charger type.");
            return null;
        }
        if (!vehicleCategory) {
            alert("Every charger must have a vehicle category.");
            return null;
        }
        if (!connectorType) {
            alert("Every charger must have a connector type.");
            return null;
        }
        if (!Number.isFinite(powerKw) || powerKw <= 0) {
            alert("Every charger must have a positive power rating.");
            return null;
        }
        if (Number.isNaN(pricePerKwh) || (pricePerKwh !== null && pricePerKwh <= 0)) {
            alert("Price per kWh must be positive when provided.");
            return null;
        }
        if (Number.isNaN(pricePerMinute) || (pricePerMinute !== null && pricePerMinute <= 0)) {
            alert("Price per minute must be positive when provided.");
            return null;
        }
        if (pricePerKwh !== null && pricePerMinute !== null) {
            alert("Set either price per kWh or price per minute for each charger, not both.");
            return null;
        }

        const chargerPayload = {
            charger_name: chargerName,
            charger_type: chargerType,
            vehicle_category: vehicleCategory,
            power_kw: powerKw,
            connector_type: connectorType,
        };
        if (slotId) {
            chargerPayload.slot_id = slotId;
            chargerPayload.slot_type = chargerType;
        }
        if (pricePerKwh !== null) {
            chargerPayload.price_per_kwh = pricePerKwh;
        }
        if (pricePerMinute !== null) {
            chargerPayload.price_per_minute = pricePerMinute;
        }
        chargers.push(chargerPayload);
    }

    return chargers;
}

function buildOwnerStationEditorHtml(station, slots) {
    const rows = slots
        .map((slot) => buildOwnerChargerCardHtml(slot.slot_number, slot, true))
        .join("");

    return `
        <div class="border rounded p-3 bg-white">
            <div class="small fw-semibold mb-2">Edit Station Details</div>
            <small class="text-muted d-block mb-3">Each charger requires a name, type, vehicle category, power rating, connector, and station assignment. Pricing remains at the charger level.</small>
            <div class="row g-2 mb-3">
                <div class="col-md-4">
                    <input type="text" class="form-control form-control-sm owner-station-name-edit" value="${escapeHtml(
                        station.station_name || ""
                    )}" placeholder="Station name">
                </div>
                <div class="col-md-4">
                    <input type="text" class="form-control form-control-sm owner-station-location-edit" value="${escapeHtml(
                        station.location || ""
                    )}" placeholder="Location">
                </div>
                <div class="col-md-4">
                    <input type="text" class="form-control form-control-sm owner-station-contact-edit" value="${escapeHtml(
                        station.contact_number || ""
                    )}" placeholder="Contact number (optional)">
                </div>
            </div>
            <div class="row g-3 owner-edit-charger-grid">${rows}</div>
            <div class="d-flex gap-2 mt-3">
                <button class="btn btn-primary btn-sm owner-save-station-btn">Save</button>
                <button class="btn btn-outline-secondary btn-sm owner-cancel-slot-editor-btn">Close</button>
            </div>
        </div>
    `;
}

async function toggleOwnerStationEditor(station, stationCard) {
    const editor = stationCard.querySelector(".owner-slot-editor");
    if (!editor) {
        return;
    }

    const isOpen = editor.style.display === "block";
    if (isOpen) {
        editor.style.display = "none";
        editor.innerHTML = "";
        return;
    }

    editor.style.display = "block";
    editor.innerHTML = "<p class='text-muted mb-0'>Loading station details...</p>";

    try {
        const slots = await apiRequest(`/api/owner/stations/${station.station_id}/slots`, { method: "GET" }, true);
        if (!Array.isArray(slots) || slots.length === 0) {
            editor.innerHTML = "<p class='text-muted mb-0'>No chargers found for this station.</p>";
            return;
        }

        editor.innerHTML = buildOwnerStationEditorHtml(station, slots);
        editor.querySelectorAll(".charger-config-card").forEach(wireChargerCard);

        const closeButton = editor.querySelector(".owner-cancel-slot-editor-btn");
        closeButton?.addEventListener("click", () => {
            editor.style.display = "none";
            editor.innerHTML = "";
        });

        const saveButton = editor.querySelector(".owner-save-station-btn");
        saveButton?.addEventListener("click", async () => {
            const stationName = String(editor.querySelector(".owner-station-name-edit")?.value || "").trim();
            const stationLocation = String(editor.querySelector(".owner-station-location-edit")?.value || "").trim();
            const stationContact = String(editor.querySelector(".owner-station-contact-edit")?.value || "").trim();

            if (!stationName || !stationLocation) {
                alert("Station name and location are required.");
                return;
            }
            if (stationContact && !isValidPhone(stationContact)) {
                alert("Contact number must be 10 to 13 digits.");
                return;
            }

            const slotPayload = collectChargerPayload(".owner-edit-charger-grid .charger-config-card");
            if (!slotPayload) {
                return;
            }

            try {
                saveButton.disabled = true;
                const result = await apiRequest(
                    `/api/owner/stations/${station.station_id}`,
                    {
                        method: "PUT",
                        body: JSON.stringify({
                            station_name: stationName,
                            location: stationLocation,
                            contact_number: stationContact,
                            slots: slotPayload,
                        }),
                    },
                    true
                );
                alert(result.message || "Station updated.");
                editor.style.display = "none";
                editor.innerHTML = "";
                await loadStations();
                await loadOwnerStations();
                await loadOwnerBookings(bookingViewState.owner);
                await loadOwnerStats();
                await loadOwnerRevenueAnalytics();
                if (dashboardState.openStationId === station.station_id) {
                    await toggleSlots(station.station_id, station.station_name, true);
                }
            } catch (error) {
                alert(error.message);
            } finally {
                saveButton.disabled = false;
            }
        });
    } catch (error) {
        editor.innerHTML = `<p class="text-danger mb-0">${escapeHtml(error.message)}</p>`;
    }
}

function renderOwnerSlotTypeInputs(totalSlotsRaw) {
    const container = document.getElementById("ownerSlotTypeRows");
    if (!container) {
        return;
    }

    const totalSlots = Number(totalSlotsRaw);
    container.innerHTML = "";

    if (!Number.isInteger(totalSlots) || totalSlots <= 0) {
        return;
    }

    for (let slotNumber = 1; slotNumber <= totalSlots; slotNumber += 1) {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = buildOwnerChargerCardHtml(slotNumber, {}, false);
        const card = wrapper.firstElementChild;
        if (card) {
            container.appendChild(card);
            const chargerCard = card.querySelector(".charger-config-card");
            if (chargerCard) {
                wireChargerCard(chargerCard);
            }
        }
    }
}

async function handleCreateStation(event) {
    event.preventDefault();

    const totalSlots = Number(document.getElementById("ownerTotalSlots").value);

    if (!Number.isInteger(totalSlots) || totalSlots <= 0) {
        alert("Total slots must be a positive integer.");
        return;
    }

    const chargers = collectChargerPayload("#ownerSlotTypeRows .charger-config-card");
    if (!chargers || chargers.length !== totalSlots) {
        return;
    }

    const payload = {
        station_name: document.getElementById("ownerStationName").value.trim(),
        location: document.getElementById("ownerLocation").value.trim(),
        contact_number: document.getElementById("ownerContact").value.trim(),
        total_slots: totalSlots,
        chargers,
    };

    try {
        const result = await apiRequest(
            "/api/owner/create-station",
            {
                method: "POST",
                body: JSON.stringify(payload),
            },
            true
        );
        alert(result.message || "Station created.");
        event.target.reset();
        const totalSlotsInput = document.getElementById("ownerTotalSlots");
        if (totalSlotsInput) {
            totalSlotsInput.value = "1";
            renderOwnerSlotTypeInputs(totalSlotsInput.value);
        }
        await loadStations();
        await loadOwnerStations();
        await loadOwnerBookings(bookingViewState.owner);
        await loadOwnerStats();
        await loadOwnerRevenueAnalytics();
    } catch (error) {
        alert(error.message);
    }
}
