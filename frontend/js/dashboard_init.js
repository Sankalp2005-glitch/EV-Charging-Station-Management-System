function setupDashboardRoleSections() {
    const role = getRole();
    const profileSection = document.getElementById("profileSection");
    const openProfileBtn = document.getElementById("openProfileBtn");
    const customerSection = document.getElementById("customerBookingsSection");
    const ownerSection = document.getElementById("ownerSection");
    const adminSection = document.getElementById("adminSection");
    const customerBookingsTitle = document.querySelector("#customerBookingsSection h5");

    if ((role === CUSTOMER_ROLE || role === OWNER_ROLE) && profileSection) {
        profileSection.style.display = "none";
        setProfileEditMode(false);
        if (openProfileBtn) {
            openProfileBtn.style.display = "inline-block";
        }
    } else if (openProfileBtn) {
        openProfileBtn.style.display = "none";
    }
    if ((role === CUSTOMER_ROLE || role === OWNER_ROLE) && customerSection) {
        customerSection.style.display = "block";
        if (role === OWNER_ROLE && customerBookingsTitle) {
            customerBookingsTitle.innerText = "My Bookings (Owner)";
        }
    }
    if (role === OWNER_ROLE && ownerSection) {
        ownerSection.style.display = "block";
    }
    if (role === "admin" && adminSection) {
        adminSection.style.display = "block";
    }
}

async function initDashboard() {
    if (!getToken() || !getRole()) {
        window.location.href = "login.html";
        return;
    }

    setRoleDisplay();
    startInactivityTracking();
    initRealtimeUpdates();
    setupDashboardRoleSections();

    document.getElementById("applyStationFilters")?.addEventListener("click", loadStations);
    document.getElementById("customerUpcomingBtn")?.addEventListener("click", () => loadMyBookings("upcoming"));
    document.getElementById("customerPastBtn")?.addEventListener("click", () => loadMyBookings("past"));
    document.getElementById("refreshMyBookings")?.addEventListener("click", () =>
        loadMyBookings(bookingViewState.customer)
    );
    document.getElementById("ownerBookingsUpcomingBtn")?.addEventListener("click", () =>
        loadOwnerBookings("upcoming")
    );
    document.getElementById("ownerBookingsPastBtn")?.addEventListener("click", () =>
        loadOwnerBookings("past")
    );
    document.getElementById("refreshOwnerBookings")?.addEventListener("click", () =>
        loadOwnerBookings(bookingViewState.owner)
    );
    document.getElementById("refreshOwnerStats")?.addEventListener("click", loadOwnerStats);
    document.getElementById("ownerStationBookingsUpcomingBtn")?.addEventListener("click", () =>
        loadOwnerStationSchedule("upcoming")
    );
    document.getElementById("ownerStationBookingsPastBtn")?.addEventListener("click", () =>
        loadOwnerStationSchedule("past")
    );
    document.getElementById("ownerStationBookingsAllBtn")?.addEventListener("click", () =>
        loadOwnerStationSchedule("all")
    );
    document.getElementById("refreshOwnerStationBookings")?.addEventListener("click", () =>
        loadOwnerStationSchedule(ownerStationScheduleState.view)
    );
    document.getElementById("ownerStationScheduleFilter")?.addEventListener("change", (event) => {
        ownerStationScheduleState.stationId = Number(event.target.value || 0) || null;
        loadOwnerStationSchedule(ownerStationScheduleState.view);
    });
    document.getElementById("refreshAdminStats")?.addEventListener("click", loadAdminStats);
    document.getElementById("adminPendingStationsBtn")?.addEventListener("click", () =>
        loadAdminStationApprovals("pending")
    );
    document.getElementById("adminApprovedStationsBtn")?.addEventListener("click", () =>
        loadAdminStationApprovals("approved")
    );
    document.getElementById("adminRejectedStationsBtn")?.addEventListener("click", () =>
        loadAdminStationApprovals("rejected")
    );
    document.getElementById("adminAllStationsBtn")?.addEventListener("click", () =>
        loadAdminStationApprovals("all")
    );
    document.getElementById("refreshAdminStations")?.addEventListener("click", () =>
        loadAdminStationApprovals(adminViewState.stationStatus)
    );
    document.getElementById("refreshOwnerStations")?.addEventListener("click", loadOwnerStations);
    document.getElementById("createStationForm")?.addEventListener("submit", handleCreateStation);
    document.getElementById("profileForm")?.addEventListener("submit", handleProfileUpdate);
    document.getElementById("openProfileBtn")?.addEventListener("click", async () => {
        await loadMyProfile();
        openProfileSection(false);
    });
    document.getElementById("profileEditBtn")?.addEventListener("click", async () => {
        await loadMyProfile();
        openProfileSection(true);
    });
    document.getElementById("profileCancelBtn")?.addEventListener("click", async () => {
        await loadMyProfile();
        setProfileEditMode(false);
    });
    document.getElementById("closeBookingQrBtn")?.addEventListener("click", hideBookingQrSection);
    document.getElementById("scanBookingQrBtn")?.addEventListener("click", scanCurrentQrBooking);
    const ownerTotalSlotsInput = document.getElementById("ownerTotalSlots");
    ownerTotalSlotsInput?.addEventListener("input", () => {
        renderOwnerSlotTypeInputs(ownerTotalSlotsInput.value);
    });
    renderOwnerSlotTypeInputs(ownerTotalSlotsInput?.value || "1");

    await loadMyProfile();
    await loadStations();
    await loadMyBookings(bookingViewState.customer);
    await loadOwnerStats();
    await loadOwnerStations();
    await loadOwnerBookings(bookingViewState.owner);
    await loadAdminStats();
    await loadAdminStationApprovals(adminViewState.stationStatus);
}

function logout() {
    stopInactivityTracking();
    disconnectRealtimeUpdates();
    hideBookingQrSection();
    localStorage.clear();
    window.location.href = "login.html";
}

window.logout = logout;

document.addEventListener("DOMContentLoaded", () => {
    if (isDashboardPage()) {
        initDashboard();
    }
});
