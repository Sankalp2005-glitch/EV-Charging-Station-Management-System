let profileEditMode = false;

function setRoleDisplay() {
    const roleDisplay = document.getElementById("roleDisplay");
    if (!roleDisplay) {
        return;
    }
    roleDisplay.innerText = `Logged in as: ${getRole() || "unknown"}`;
}

function setProfileEditMode(enabled) {
    profileEditMode = Boolean(enabled);

    const editableFields = ["profileName", "profileEmail", "profilePhone"];
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

function openProfileSection(enableEdit = false) {
    const role = getRole();
    if (role !== CUSTOMER_ROLE && role !== OWNER_ROLE) {
        return;
    }
    const section = document.getElementById("profileSection");
    if (!section) {
        return;
    }
    section.style.display = "block";
    setProfileEditMode(enableEdit);
    window.scrollTo({ top: section.offsetTop - 20, behavior: "smooth" });
}

async function loadMyProfile() {
    const section = document.getElementById("profileSection");
    if (!section) {
        return;
    }

    try {
        const profile = await apiRequest("/api/auth/me", { method: "GET" }, true);
        document.getElementById("profileName").value = profile.name || "";
        document.getElementById("profileEmail").value = profile.email || "";
        document.getElementById("profilePhone").value = profile.phone || "";
        if (!profileEditMode) {
            setProfileEditMode(false);
        }
    } catch (error) {
        alert(error.message);
    }
}

async function handleProfileUpdate(event) {
    event.preventDefault();

    const name = document.getElementById("profileName").value.trim();
    const email = document.getElementById("profileEmail").value.trim().toLowerCase();
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
    if (!phone || !isValidPhone(phone)) {
        alert("Phone must be 10 to 13 digits.");
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

    const payload = { name, email, phone };
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
