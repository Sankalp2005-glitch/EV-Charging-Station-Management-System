let profileEditMode = false;

function setRoleDisplay() {
    const roleDisplay = document.getElementById("roleDisplay");
    if (!roleDisplay) {
        return;
    }
    const role = String(getRole() || "unknown");
    roleDisplay.innerText = `Signed in as ${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

function setProfileEditMode(enabled) {
    profileEditMode = Boolean(enabled);

    const editableFields = ["profileName", "profileEmail", "profileCountryCode", "profilePhone"];
    editableFields.forEach((fieldId) => {
        const field = document.getElementById(fieldId);
        if (!field) {
            return;
        }
        field.readOnly = !profileEditMode;
    });

    const currentPassword = document.getElementById("profileCurrentPassword");
    const newPassword = document.getElementById("profileNewPassword");
    if (currentPassword) {
        currentPassword.disabled = !profileEditMode;
        if (!profileEditMode) {
            currentPassword.value = "";
        }
    }
    if (newPassword) {
        newPassword.disabled = !profileEditMode;
        if (!profileEditMode) {
            newPassword.value = "";
        }
    }

    const saveButton = document.getElementById("profileSaveBtn");
    if (saveButton) {
        saveButton.disabled = !profileEditMode;
    }

    const editButton = document.getElementById("profileEditBtn");
    const cancelButton = document.getElementById("profileCancelBtn");
    const modeText = document.getElementById("profileModeText");
    if (editButton) {
        editButton.style.display = profileEditMode ? "none" : "inline-block";
    }
    if (cancelButton) {
        cancelButton.style.display = profileEditMode ? "inline-block" : "none";
    }
    if (modeText) {
        modeText.innerText = profileEditMode ? "Edit mode" : "View mode";
    }
}

function setProfileLoadingState(isLoading, message = "Loading profile...") {
    const section = document.getElementById("profileSection");
    const form = document.getElementById("profileForm");
    const modeText = document.getElementById("profileModeText");
    if (!section || !form || !modeText) {
        return;
    }

    section.classList.toggle("is-loading", Boolean(isLoading));
    if (isLoading) {
        form.querySelectorAll("input, button").forEach((field) => {
            if (!(field instanceof HTMLInputElement || field instanceof HTMLButtonElement)) {
                return;
            }
            field.disabled = true;
        });
        modeText.innerText = message;
        return;
    }

    setProfileEditMode(profileEditMode);
}

function openProfileSection(enableEdit = false) {
    const section = document.getElementById("profileSection");
    if (!section) {
        return;
    }
    switchTab("profile");
    setProfileEditMode(enableEdit);
    window.scrollTo({ top: section.offsetTop - 20, behavior: "smooth" });
}

async function loadMyProfile() {
    const section = document.getElementById("profileSection");
    if (!section) {
        return;
    }

    setProfileLoadingState(true);
    try {
        const profile = await apiRequest("/api/auth/me", { method: "GET" }, true);
        document.getElementById("profileName").value = profile.name || "";
        document.getElementById("profileEmail").value = profile.email || "";
        const phoneParts = typeof window.splitPhoneNumber === "function" ? window.splitPhoneNumber(profile.phone || "") : null;
        const countryField = document.getElementById("profileCountryCode");
        const phoneField = document.getElementById("profilePhone");
        if (countryField && phoneParts) {
            const code = phoneParts.countryCode ? `+${phoneParts.countryCode}` : "+91";
            countryField.value = code;
        } else if (countryField) {
            countryField.value = "+91";
        }
        if (phoneField) {
            phoneField.value = phoneParts ? phoneParts.localNumber : profile.phone || "";
        }
        if (!profileEditMode) {
            setProfileEditMode(false);
        }
    } catch (error) {
        alert(error.message);
    } finally {
        setProfileLoadingState(false);
    }
}

async function handleProfileUpdate(event) {
    event.preventDefault();

    const name = document.getElementById("profileName").value.trim();
    const email = document.getElementById("profileEmail").value.trim().toLowerCase();
    const countryCodeRaw = document.getElementById("profileCountryCode").value.trim();
    const phone = document.getElementById("profilePhone").value.trim();
    const currentPassword = document.getElementById("profileCurrentPassword").value;
    const newPassword = document.getElementById("profileNewPassword").value;

    if (!name) {
        alert("Name is required.");
        return;
    }
    if (!email) {
        alert("Email is required.");
        return;
    }
    const normalizedCountryCode =
        typeof window.normalizeDigits === "function" ? window.normalizeDigits(countryCodeRaw) : countryCodeRaw.replace(/\D/g, "");
    const countryCodeValid =
        typeof window.isValidCountryCode === "function" ? window.isValidCountryCode(normalizedCountryCode) : /^[1-9][0-9]{0,2}$/.test(normalizedCountryCode);
    if (!countryCodeValid) {
        alert("Country code must be 1 to 3 digits.");
        return;
    }
    if (!phone || !isValidPhone(phone)) {
        alert("Phone number must be exactly 10 digits.");
        return;
    }
    if ((currentPassword && !newPassword) || (!currentPassword && newPassword)) {
        alert("Provide both current and new password to change password.");
        return;
    }
    if (newPassword && newPassword.length < 8) {
        alert("New password must be at least 8 characters.");
        return;
    }

    const payload = { name, email, phone, country_code: `+${normalizedCountryCode}` };
    if (currentPassword && newPassword) {
        payload.current_password = currentPassword;
        payload.new_password = newPassword;
    }

    try {
        const result = await apiRequest(
            "/api/auth/me",
            {
                method: "PUT",
                body: JSON.stringify(payload),
            },
            true
        );
        alert(result.message || "Profile updated.");
        document.getElementById("profileCurrentPassword").value = "";
        document.getElementById("profileNewPassword").value = "";
        setProfileEditMode(false);
        await loadMyProfile();
    } catch (error) {
        alert(error.message);
    }
}
