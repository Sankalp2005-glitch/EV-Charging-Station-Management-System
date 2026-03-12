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

async function handleRegister(event) {
    event.preventDefault();

    const payload = {
        name: document.getElementById("name").value.trim(),
        email: document.getElementById("email").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        password: document.getElementById("password").value,
        role: document.getElementById("role").value,
    };

    try {
        const result = await apiRequest("/api/auth/register", {
            method: "POST",
            body: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
        });
        alert(result.message || "Registration successful");
        window.location.href = "login.html";
    } catch (error) {
        alert(error.message);
    }
}

async function handleLogin(event) {
    event.preventDefault();

    const payload = {
        email: document.getElementById("loginEmail").value.trim(),
        password: document.getElementById("loginPassword").value,
    };

    try {
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

        window.location.href = "dashboard.html";
    } catch (error) {
        alert(error.message);
    }
}

async function handleForgotPassword(event) {
    event.preventDefault();

    const email = document.getElementById("resetEmail").value.trim();
    const newPassword = document.getElementById("resetNewPassword").value;
    const confirmPassword = document.getElementById("resetConfirmPassword").value;

    if (!email || !newPassword || !confirmPassword) {
        alert("All fields are required");
        return;
    }
    if (newPassword !== confirmPassword) {
        alert("Passwords do not match");
        return;
    }
    if (newPassword.length < 8) {
        alert("Password must be at least 8 characters");
        return;
    }

    try {
        const result = await apiRequest("/api/auth/forgot-password", {
            method: "POST",
            body: JSON.stringify({ email, new_password: newPassword }),
            headers: { "Content-Type": "application/json" },
        });
        alert(result.message || "Password reset successful");
        document.getElementById("forgotPasswordSection").style.display = "none";
        document.getElementById("loginForm").style.display = "block";
    } catch (error) {
        alert(error.message);
    }
}

function bindAuthForms() {
    document.getElementById("registerForm")?.addEventListener("submit", handleRegister);
    document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
    document.getElementById("forgotPasswordForm")?.addEventListener("submit", handleForgotPassword);

    document.getElementById("forgotPasswordLink")?.addEventListener("click", function (e) {
        e.preventDefault();
        document.getElementById("loginForm").style.display = "none";
        document.getElementById("forgotPasswordSection").style.display = "block";
    });
    document.getElementById("backToLoginLink")?.addEventListener("click", function (e) {
        e.preventDefault();
        document.getElementById("forgotPasswordSection").style.display = "none";
        document.getElementById("loginForm").style.display = "block";
    });
}

document.addEventListener("DOMContentLoaded", bindAuthForms);
