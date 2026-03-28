function setSupportFeedback(message = "", tone = "success") {
    const feedback = document.getElementById("supportFeedback");
    if (!feedback) {
        return;
    }
    feedback.className = `support-feedback support-feedback--${tone}${message ? " is-visible" : ""}`;
    feedback.innerText = message;
}

function normalizeSupportLabel(value) {
    const text = String(value || "").replace(/[_-]+/g, " ").trim();
    if (!text) {
        return "-";
    }
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function normalizeSupportDeliveryLabel(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "sent") {
        return "Admin notified";
    }
    if (normalized === "pending") {
        return "Queued";
    }
    if (normalized === "failed" || normalized === "skipped") {
        return "Logged";
    }
    return normalizeSupportLabel(value);
}

function getSupportChipClass(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) {
        return "support-chip--pending";
    }
    return `support-chip--${normalized.replace(/[^a-z0-9]+/g, "_")}`;
}

function formatSupportDateTime(value) {
    const raw = String(value || "").trim();
    if (!raw) {
        return "-";
    }
    const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
    const utcCandidate =
        /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) || /(?:Z|[+-]\d{4})$/i.test(normalized)
            ? normalized
            : `${normalized}Z`;
    const parsed = new Date(utcCandidate);
    if (Number.isNaN(parsed.getTime())) {
        return "-";
    }
    return new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
    }).format(parsed);
}

function buildSupportRequestCard(requestItem = {}) {
    return `
        <article class="support-request-card">
            <div class="support-request-card__top">
                <span class="support-request-card__ticket">${escapeHtml(requestItem.ticket_number || "Pending")}</span>
                <div class="support-request-card__labels">
                    <span class="support-chip ${getSupportChipClass(requestItem.status)}">${escapeHtml(
                        normalizeSupportLabel(requestItem.status || "open")
                    )}</span>
                    <span class="support-chip ${getSupportChipClass(requestItem.admin_email_status)}">${escapeHtml(
                        normalizeSupportDeliveryLabel(requestItem.admin_email_status || "pending")
                    )}</span>
                </div>
            </div>
            <h5 class="support-request-card__subject">${escapeHtml(requestItem.subject || "Support request")}</h5>
            <div class="support-request-card__meta">
                <span class="support-request-card__time">${escapeHtml(normalizeSupportLabel(requestItem.category))} | ${escapeHtml(
                    normalizeSupportLabel(requestItem.priority)
                )}</span>
                <span class="support-request-card__delivery">Created ${escapeHtml(
                    formatSupportDateTime(requestItem.created_at)
                )}</span>
            </div>
        </article>
    `;
}

function renderSupportRequests(requests) {
    const container = document.getElementById("supportRequestsList");
    if (!container) {
        return;
    }
    if (!Array.isArray(requests) || requests.length === 0) {
        container.innerHTML = "<div class='empty-state'>No support requests yet. Your latest tickets will appear here.</div>";
        return;
    }
    container.innerHTML = `<div class="support-request-list">${requests.map(buildSupportRequestCard).join("")}</div>`;
}

async function loadSupportRequests() {
    const container = document.getElementById("supportRequestsList");
    if (!container || getRole() === "admin") {
        return;
    }
    renderLoadingState(container, "Loading support requests...");
    try {
        const requests = await apiRequest("/api/support/requests", { method: "GET" }, true);
        renderSupportRequests(requests);
    } catch (error) {
        if (error?.silent) {
            return;
        }
        container.innerHTML = `<div class="empty-state text-danger">${escapeHtml(error.message || "Failed to load support requests.")}</div>`;
    }
}

async function submitSupportRequest(event) {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
        return;
    }

    const payload = {
        category: String(form.category?.value || "").trim(),
        priority: String(form.priority?.value || "").trim(),
        subject: String(form.subject?.value || "").trim(),
        message: String(form.message?.value || "").trim(),
    };

    const bookingIdText = String(form.booking_id?.value || "").trim();
    const stationIdText = String(form.station_id?.value || "").trim();
    if (bookingIdText) {
        payload.booking_id = Number(bookingIdText);
    }
    if (stationIdText) {
        payload.station_id = Number(stationIdText);
    }

    const submitButton = document.getElementById("supportSubmitBtn");
    if (submitButton) {
        submitButton.disabled = true;
    }
    setSupportFeedback("Sending your request to the system admin...", "success");

    try {
        const result = await apiRequest(
            "/api/support/requests",
            {
                method: "POST",
                body: JSON.stringify(payload),
            },
            true
        );
        form.reset();
        if (form.priority) {
            form.priority.value = "normal";
        }
        if (form.category) {
            form.category.value = "charging";
        }
        setSupportFeedback(
            `${result.message} Ticket: ${result?.request?.ticket_number || "Support request created"}.`,
            "success"
        );
        await loadSupportRequests();
    } catch (error) {
        if (error?.silent) {
            return;
        }
        setSupportFeedback(error.message || "Failed to submit support request.", "danger");
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
        }
    }
}

window.loadSupportRequests = loadSupportRequests;
window.submitSupportRequest = submitSupportRequest;
