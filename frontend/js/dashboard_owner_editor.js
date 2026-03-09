function buildOwnerStationEditorHtml(station, slots) {
    const rows = slots
        .map(
            (slot) => `
                <div class="col-md-6 border rounded p-2">
                    <label class="form-label mb-1">Slot ${slot.slot_number}</label>
                    <select class="form-select form-select-sm mb-2 owner-slot-type-edit-input" data-slot-id="${slot.slot_id}">
                        <option value="normal" ${slot.slot_type === "normal" ? "selected" : ""}>Normal</option>
                        <option value="fast" ${slot.slot_type === "fast" ? "selected" : ""}>Fast</option>
                    </select>
                    <input type="number"
                           class="form-control form-control-sm mb-2 owner-slot-power-edit-input"
                           data-slot-id="${slot.slot_id}"
                           min="0.1"
                           step="0.1"
                           value="${Number.isFinite(Number(slot.power_kw)) ? Number(slot.power_kw) : ""}"
                           placeholder="Power kW">
                    <input type="number"
                           class="form-control form-control-sm mb-2 owner-slot-price-kwh-edit-input"
                           data-slot-id="${slot.slot_id}"
                           min="0.01"
                           step="0.01"
                           value="${Number.isFinite(Number(slot.price_per_kwh)) ? Number(slot.price_per_kwh) : ""}"
                           placeholder="Price per kWh">
                    <input type="number"
                           class="form-control form-control-sm owner-slot-price-minute-edit-input"
                           data-slot-id="${slot.slot_id}"
                           min="0.01"
                           step="0.01"
                           value="${Number.isFinite(Number(slot.price_per_minute)) ? Number(slot.price_per_minute) : ""}"
                           placeholder="Price per minute (leave blank to use per kWh)">
                </div>
            `
        )
        .join("");

    return `
        <div class="border rounded p-2 bg-white">
            <div class="small fw-semibold mb-2">Edit Station Details</div>
            <small class="text-muted d-block mb-2">For each slot: set either price per kWh or price per minute.</small>
            <div class="row g-2 mb-2">
                <div class="col-md-4">
                    <input type="text" class="form-control form-control-sm owner-station-name-edit" value="${station.station_name || ""}"
                        placeholder="Station name">
                </div>
                <div class="col-md-4">
                    <input type="text" class="form-control form-control-sm owner-station-location-edit" value="${station.location || ""}"
                        placeholder="Location">
                </div>
                <div class="col-md-4">
                    <input type="text" class="form-control form-control-sm owner-station-contact-edit"
                        value="${station.contact_number || ""}" placeholder="Contact number (optional)">
                </div>
            </div>
            <div class="row g-2">${rows}</div>
            <div class="d-flex gap-2 mt-2">
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
            editor.innerHTML = "<p class='text-muted mb-0'>No slots found for this station.</p>";
            return;
        }

        editor.innerHTML = buildOwnerStationEditorHtml(station, slots);

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

            const typeInputs = Array.from(editor.querySelectorAll(".owner-slot-type-edit-input"));
            if (typeInputs.length !== slots.length) {
                alert("Slot list mismatch. Reload and try again.");
                return;
            }

            try {
                saveButton.disabled = true;
                const slotPayload = [];
                for (const typeInput of typeInputs) {
                    const slotId = Number(typeInput.dataset.slotId);
                    const slotType = String(typeInput.value || "").trim().toLowerCase();
                    const powerInput = editor.querySelector(`.owner-slot-power-edit-input[data-slot-id="${slotId}"]`);
                    const priceKwhInput = editor.querySelector(
                        `.owner-slot-price-kwh-edit-input[data-slot-id="${slotId}"]`
                    );
                    const priceMinuteInput = editor.querySelector(
                        `.owner-slot-price-minute-edit-input[data-slot-id="${slotId}"]`
                    );

                    if (!Number.isInteger(slotId) || slotId <= 0) {
                        alert("Invalid slot id.");
                        return;
                    }
                    if (slotType !== "fast" && slotType !== "normal") {
                        alert("Each slot must be either fast or normal.");
                        return;
                    }

                    const powerKw = parseOptionalNumber(powerInput?.value);
                    const pricePerKwh = parseOptionalNumber(priceKwhInput?.value);
                    const pricePerMinute = parseOptionalNumber(priceMinuteInput?.value);

                    if (!Number.isFinite(powerKw) || powerKw <= 0) {
                        alert(`Power kW must be positive for slot ${slotId}.`);
                        return;
                    }
                    if (Number.isNaN(pricePerKwh) || (pricePerKwh !== null && pricePerKwh <= 0)) {
                        alert(`Price per kWh must be positive for slot ${slotId}.`);
                        return;
                    }
                    if (Number.isNaN(pricePerMinute) || (pricePerMinute !== null && pricePerMinute <= 0)) {
                        alert(`Price per minute must be positive for slot ${slotId}.`);
                        return;
                    }
                    if (pricePerKwh !== null && pricePerMinute !== null) {
                        alert(`Set either price per kWh or price per minute for slot ${slotId}.`);
                        return;
                    }

                    const slotItem = {
                        slot_id: slotId,
                        slot_type: slotType,
                        power_kw: powerKw,
                    };
                    if (pricePerKwh !== null) {
                        slotItem.price_per_kwh = pricePerKwh;
                    }
                    if (pricePerMinute !== null) {
                        slotItem.price_per_minute = pricePerMinute;
                    }
                    slotPayload.push(slotItem);
                }

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
                const warning = result.pricing_columns_supported === false
                    ? "\nNote: slot power/pricing columns are not present in DB, so only slot type was updated."
                    : "";
                alert((result.message || "Station updated.") + warning);
                editor.style.display = "none";
                editor.innerHTML = "";
                await loadStations();
                await loadOwnerStations();
                await loadOwnerBookings(bookingViewState.owner);
                await loadOwnerStats();
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
        editor.innerHTML = `<p class="text-danger mb-0">${error.message}</p>`;
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
        const col = document.createElement("div");
        col.className = "col-md-4";
        col.innerHTML = `
            <label class="form-label mb-1">Slot ${slotNumber}</label>
            <select class="form-select owner-slot-type-input" data-slot-number="${slotNumber}">
                <option value="normal">Normal</option>
                <option value="fast">Fast</option>
            </select>
        `;
        container.appendChild(col);
    }
}

function getOwnerSlotTypes(totalSlots) {
    const inputs = Array.from(document.querySelectorAll("#ownerSlotTypeRows .owner-slot-type-input"));
    if (inputs.length !== totalSlots) {
        return null;
    }
    const slotTypes = [];
    for (const input of inputs) {
        const slotType = String(input.value || "").trim().toLowerCase();
        if (slotType !== "fast" && slotType !== "normal") {
            return null;
        }
        slotTypes.push(slotType);
    }
    return slotTypes;
}

async function handleCreateStation(event) {
    event.preventDefault();

    const totalSlots = Number(document.getElementById("ownerTotalSlots").value);
    const powerKw = parseOptionalNumber(document.getElementById("ownerPowerKw").value);
    const pricePerKwh = parseOptionalNumber(document.getElementById("ownerPricePerKwh").value);
    const pricePerMinute = parseOptionalNumber(document.getElementById("ownerPricePerMinute").value);
    const slotTypes = getOwnerSlotTypes(totalSlots);

    if (!Number.isInteger(totalSlots) || totalSlots <= 0) {
        alert("Total slots must be a positive integer.");
        return;
    }
    if (!slotTypes) {
        alert("Configure slot type for every charger.");
        return;
    }

    if (Number.isNaN(powerKw) || (powerKw !== null && powerKw <= 0)) {
        alert("Power kW must be a positive number.");
        return;
    }
    if (Number.isNaN(pricePerKwh) || (pricePerKwh !== null && pricePerKwh <= 0)) {
        alert("Price per kWh must be a positive number.");
        return;
    }
    if (Number.isNaN(pricePerMinute) || (pricePerMinute !== null && pricePerMinute <= 0)) {
        alert("Price per minute must be a positive number.");
        return;
    }
    if (pricePerKwh !== null && pricePerMinute !== null) {
        alert("Set either price per kWh or price per minute, not both.");
        return;
    }

    const payload = {
        station_name: document.getElementById("ownerStationName").value.trim(),
        location: document.getElementById("ownerLocation").value.trim(),
        contact_number: document.getElementById("ownerContact").value.trim(),
        total_slots: totalSlots,
        slot_types: slotTypes,
    };
    if (powerKw !== null) {
        payload.power_kw = powerKw;
    }
    if (pricePerKwh !== null) {
        payload.price_per_kwh = pricePerKwh;
    }
    if (pricePerMinute !== null) {
        payload.price_per_minute = pricePerMinute;
    }

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
    } catch (error) {
        alert(error.message);
    }
}
