const MIN_PASSWORD_LENGTH = 8;
const {
    API_BASE,
    bindPhoneInputGuards,
    isValidCountryCode,
    isValidPhoneNumber,
    normalizeDigits,
    parseJsonSafe,
    resolveErrorMessage,
} = window.EVgoShared;
const MOBILE_AUTH_MEDIA_QUERY = window.matchMedia("(max-width: 767.98px)");

function setAuthFeedback(message = "", tone = "danger") {
    const feedback = document.getElementById("authFeedback");
    if (!feedback) {
        if (message) {
            alert(message);
        }
        return;
    }
    feedback.className = `auth-feedback auth-feedback--${tone}${message ? " is-visible" : ""}`;
    feedback.innerText = message;
}

function setSubmitState(buttonId, isLoading, loadingLabel) {
    const button = document.getElementById(buttonId);
    if (!button) {
        return;
    }
    if (!button.dataset.defaultLabel) {
        button.dataset.defaultLabel = button.innerHTML;
    }
    button.disabled = Boolean(isLoading);
    button.innerHTML = isLoading
        ? `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>${loadingLabel}`
        : button.dataset.defaultLabel;
}

async function apiRequest(path, options = {}) {
    const requestOptions = { ...options };
    requestOptions.headers = requestOptions.headers || {};

    if (requestOptions.body && !requestOptions.headers["Content-Type"]) {
        requestOptions.headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${API_BASE}${path}`, requestOptions);
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
        const error = new Error(resolveErrorMessage(payload, `Request failed (${response.status})`));
        error.status = response.status;
        error.payload = payload;
        throw error;
    }
    return payload;
}

function bindPasswordToggles() {
    document.querySelectorAll("[data-password-toggle]").forEach((button) => {
        button.addEventListener("click", () => {
            const targetId = button.dataset.target;
            const input = targetId ? document.getElementById(targetId) : null;
            if (!input) {
                return;
            }
            const shouldShow = input.type === "password";
            input.type = shouldShow ? "text" : "password";
            button.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
            button.setAttribute("aria-pressed", shouldShow ? "true" : "false");
            button.innerHTML = `<i class="bi ${shouldShow ? "bi-eye-slash" : "bi-eye"}"></i>`;
        });
    });
}

function storeSession({ token, role, user_id: userId } = {}) {
    if (token) {
        localStorage.setItem("token", token);
    }
    if (role) {
        localStorage.setItem("role", role);
    }
    if (userId) {
        localStorage.setItem("user_id", String(userId));
    }
}

function clearSession() {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("user_id");
}

function navigateBackWithFallback(fallbackPath) {
    const referrer = document.referrer ? new URL(document.referrer, window.location.href) : null;
    const hasInAppHistory = Boolean(referrer && referrer.origin === window.location.origin && window.history.length > 1);
    if (hasInAppHistory) {
        window.history.back();
        return;
    }
    window.location.href = fallbackPath || "login.html";
}

function isAuthEntryPage() {
    return Boolean(document.getElementById("loginForm") || document.getElementById("registerForm"));
}

async function redirectIfAuthenticated() {
    if (!isAuthEntryPage()) {
        return;
    }
    const token = localStorage.getItem("token");
    if (!token) {
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/api/auth/me`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        if (response.ok) {
            const payload = await parseJsonSafe(response);
            storeSession({ token, ...payload });
            window.location.replace("dashboard.html");
            return;
        }
    } catch (_error) {
        // Best-effort check before forcing a redirect.
    }
    clearSession();
}

function setRecoveryStep(identifyVisible) {
    const identifyForm = document.getElementById("recoveryIdentifyForm");
    const resetForm = document.getElementById("recoveryResetForm");
    if (!identifyForm || !resetForm) {
        return;
    }
    identifyForm.style.display = identifyVisible ? "flex" : "none";
    resetForm.style.display = identifyVisible ? "none" : "flex";
}

function updateRecoveryVerificationCopy(details = {}) {
    const note = document.getElementById("recoveryVerificationNote");
    const label = document.getElementById("recoveryVerificationLabel");
    if (!note || !label) {
        return;
    }
    const typeLabel = details.type === "email" ? "email address" : "phone number";
    const masked = details.masked ? ` (${details.masked})` : "";
    note.textContent = `Confirm your registered ${typeLabel}${masked} to continue.`;
    label.textContent = `Registered ${typeLabel}`;
}

async function handleRecoveryIdentify(event) {
    event.preventDefault();
    setAuthFeedback("");

    const identifierInput = document.getElementById("recoveryIdentifier");
    const identifier = identifierInput?.value.trim() || "";
    if (!identifier) {
        setAuthFeedback("Please enter your registered email or phone number.", "danger");
        return;
    }

    try {
        setSubmitState("recoveryIdentifyBtn", true, "Checking account...");
        const result = await apiRequest("/api/auth/password-reset/identify", {
            method: "POST",
            body: JSON.stringify({ identifier }),
        });
        const resetForm = document.getElementById("recoveryResetForm");
        if (resetForm) {
            resetForm.dataset.identifier = identifier;
            resetForm.dataset.verificationType = result?.verification?.type || "";
        }
        updateRecoveryVerificationCopy(result?.verification || {});
        setRecoveryStep(false);
        setAuthFeedback(result.message || "Account verified. Continue to reset your password.", "success");
    } catch (error) {
        setAuthFeedback(error.message, "danger");
    } finally {
        setSubmitState("recoveryIdentifyBtn", false, "Checking account...");
    }
}

async function handleRecoveryReset(event) {
    event.preventDefault();
    setAuthFeedback("");

    const resetForm = document.getElementById("recoveryResetForm");
    const identifier = resetForm?.dataset.identifier || "";
    const verification = document.getElementById("recoveryVerification")?.value.trim() || "";
    const newPassword = document.getElementById("recoveryNewPassword")?.value || "";
    const confirmPassword = document.getElementById("recoveryConfirmPassword")?.value || "";

    if (!identifier) {
        setAuthFeedback("Start with your registered email or phone number first.", "danger");
        setRecoveryStep(true);
        return;
    }
    if (!verification) {
        setAuthFeedback("Please provide the requested verification detail.", "danger");
        return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
        setAuthFeedback(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, "danger");
        return;
    }
    if (newPassword !== confirmPassword) {
        setAuthFeedback("Passwords do not match. Please re-enter them.", "danger");
        return;
    }

    try {
        setSubmitState("recoveryResetBtn", true, "Updating password...");
        const result = await apiRequest("/api/auth/password-reset/complete", {
            method: "POST",
            body: JSON.stringify({
                identifier,
                verification,
                new_password: newPassword,
            }),
        });
        setAuthFeedback(result.message || "Password updated. Redirecting to sign in...", "success");
        window.setTimeout(() => {
            window.location.href = "login.html";
        }, 800);
    } catch (error) {
        setAuthFeedback(error.message, "danger");
    } finally {
        setSubmitState("recoveryResetBtn", false, "Updating password...");
    }
}

async function handleRegister(event) {
    event.preventDefault();
    setAuthFeedback("");

    const countryCodeRaw = document.getElementById("countryCode")?.value.trim() || "";
    const phoneRaw = document.getElementById("phone")?.value.trim() || "";
    const countryCode = normalizeDigits(countryCodeRaw);
    const phone = normalizeDigits(phoneRaw);

    if (!isValidCountryCode(countryCode)) {
        setAuthFeedback("Country code must be 1 to 3 digits.", "danger");
        return;
    }
    if (!isValidPhoneNumber(phone)) {
        setAuthFeedback("Phone number must be exactly 10 digits.", "danger");
        return;
    }

    const payload = {
        name: document.getElementById("name").value.trim(),
        email: document.getElementById("email").value.trim(),
        phone,
        country_code: `+${countryCode}`,
        password: document.getElementById("password").value,
        role: document.getElementById("role").value,
    };

    try {
        setSubmitState("registerSubmitBtn", true, "Creating account...");
        const result = await apiRequest("/api/auth/register", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        setAuthFeedback(result.message || "Registration successful. Redirecting to sign in...", "success");
        window.setTimeout(() => {
            window.location.href = "login.html";
        }, 700);
    } catch (error) {
        setAuthFeedback(error.message, "danger");
    } finally {
        setSubmitState("registerSubmitBtn", false, "Creating account...");
    }
}

async function handleLogin(event) {
    event.preventDefault();
    setAuthFeedback("");

    const payload = {
        email: document.getElementById("loginEmail").value.trim(),
        password: document.getElementById("loginPassword").value,
    };

    try {
        setSubmitState("loginSubmitBtn", true, "Signing in...");
        const result = await apiRequest("/api/auth/login", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        storeSession(result);

        setAuthFeedback(result.message || "Login successful. Opening EVgo...", "success");
        window.setTimeout(() => {
            window.location.replace("dashboard.html");
        }, 300);
    } catch (error) {
        setAuthFeedback(error.message, "danger");
    } finally {
        setSubmitState("loginSubmitBtn", false, "Signing in...");
    }
}

function bindAuthForms() {
    bindPasswordToggles();
    document.getElementById("registerForm")?.addEventListener("submit", handleRegister);
    document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
    document.getElementById("recoveryIdentifyForm")?.addEventListener("submit", handleRecoveryIdentify);
    document.getElementById("recoveryResetForm")?.addEventListener("submit", handleRecoveryReset);
}

function bindBackButtons() {
    document.querySelectorAll("[data-back-fallback]").forEach((button) => {
        button.addEventListener("click", () => {
            navigateBackWithFallback(button.dataset.backFallback);
        });
    });
}

function syncIntegratedAuthCardState() {
    const card = document.querySelector(".auth-layout--integrated .auth-card");
    if (!card) {
        return;
    }

    card.classList.toggle("auth-card--mobile-inline", MOBILE_AUTH_MEDIA_QUERY.matches);
}

document.addEventListener("DOMContentLoaded", () => {
    redirectIfAuthenticated();
    bindAuthForms();
    bindPhoneInputGuards();
    bindBackButtons();
    syncIntegratedAuthCardState();
    MOBILE_AUTH_MEDIA_QUERY.addEventListener("change", syncIntegratedAuthCardState);
});

window.addEventListener("pageshow", () => {
    redirectIfAuthenticated();
});
