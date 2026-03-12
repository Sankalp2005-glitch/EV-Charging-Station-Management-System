const API_BASE = "http://127.0.0.1:5000";

async function parseJsonSafe(response) {
    try {
        return await response.json();
    } catch (_err) {
        return null;
    }
}

function resolveErrorMessage(payload, fallback = "Request failed") {
    if (!payload || typeof payload !== "object") {
        return fallback;
    }
    return payload.error || payload.message || fallback;
}

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

async function handleRegister(event) {
    event.preventDefault();
    setAuthFeedback("");

    const payload = {
        name: document.getElementById("name").value.trim(),
        email: document.getElementById("email").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        password: document.getElementById("password").value,
        role: document.getElementById("role").value,
    };

    try {
        setSubmitState("registerSubmitBtn", true, "Creating account...");
        const result = await apiRequest("/api/auth/register", {
            method: "POST",
            body: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
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
            headers: { "Content-Type": "application/json" },
        });

        localStorage.setItem("token", result.token);
        localStorage.setItem("role", result.role);
        if (result.user_id) {
            localStorage.setItem("user_id", String(result.user_id));
        }

        setAuthFeedback(result.message || "Login successful. Opening EVgo...", "success");
        window.setTimeout(() => {
            window.location.href = "dashboard.html";
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
}

document.addEventListener("DOMContentLoaded", bindAuthForms);
