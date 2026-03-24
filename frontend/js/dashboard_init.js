function setupDashboardRoleSections() {
    const role = getRole();
    const openProfileBtn = document.getElementById("openProfileBtn");
    const customerDashboardSection = document.getElementById("customerDashboardSection");
    const ownerDashboardSection = document.getElementById("ownerDashboardSection");
    const adminDashboardSection = document.getElementById("adminDashboardSection");
    const customerBookingsSection = document.getElementById("customerBookingsSection");
    const ownerBookingsSection = document.getElementById("ownerBookingsSection");
    const adminStationBookingsSection = document.getElementById("adminStationBookingsSection");
    const ownerStationsSection = document.getElementById("ownerStationsSection");

    if (openProfileBtn) {
        openProfileBtn.style.display = role ? "inline-flex" : "none";
    }

    if (customerDashboardSection) {
        customerDashboardSection.style.display = role === "admin" ? "none" : "block";
    }
    if (ownerDashboardSection) {
        ownerDashboardSection.style.display = role === OWNER_ROLE ? "block" : "none";
    }
    if (adminDashboardSection) {
        adminDashboardSection.style.display = role === "admin" ? "block" : "none";
    }
    if (customerBookingsSection) {
        customerBookingsSection.style.display = role === CUSTOMER_ROLE ? "block" : "none";
    }
    if (ownerBookingsSection) {
        ownerBookingsSection.style.display = role === OWNER_ROLE ? "block" : "none";
    }
    if (adminStationBookingsSection) {
        adminStationBookingsSection.style.display = role === "admin" ? "block" : "none";
    }
    if (ownerStationsSection) {
        ownerStationsSection.style.display = role === OWNER_ROLE ? "block" : "none";
    }

    document.querySelectorAll(".admin-only").forEach((element) => {
        element.style.display = role === "admin" ? "" : "none";
    });
}

async function initDashboard() {
    if (!getToken() || !getRole()) {
        window.location.href = "login.html";
        return;
    }

    const role = getRole();

    setRoleDisplay();
    startInactivityTracking();
    initRealtimeUpdates();
    startChargingProgressTicker();
    setupDashboardRoleSections();

    document.getElementById("applyStationFilters")?.addEventListener("click", async () => {
        await loadStations();
        const stationsResultsSection = document.getElementById("stationsResultsSection");
        stationsResultsSection?.scrollIntoView({
            behavior: "smooth",
            block: "start",
        });
    });
    document.getElementById("refreshStationsBtn")?.addEventListener("click", loadStations);
    document.getElementById("stationNearbySearchBtn")?.addEventListener("click", handleStationNearbySearch);
    document.getElementById("stationUseLocationBtn")?.addEventListener("click", handleStationUseMyLocation);
    document.getElementById("stationClearNearbyBtn")?.addEventListener("click", handleStationClearNearby);
    document.getElementById("stationNearbySearch")?.addEventListener("keydown", (event) => {
        if (typeof handleStationSearchKeydown === "function") {
            handleStationSearchKeydown(event);
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            handleStationNearbySearch();
        }
    });
    document.getElementById("stationRadiusFilter")?.addEventListener("change", () => {
        const parsedRadius = Number(document.getElementById("stationRadiusFilter")?.value);
        dashboardState.nearbyRadiusKm = Number.isFinite(parsedRadius) && parsedRadius >= 0 ? parsedRadius : 0;
        if (dashboardState.stationNearbyOnly && dashboardState.nearbyOrigin) {
            loadStations();
        }
        if (dashboardState.bookingNearbyOnly && dashboardState.nearbyOrigin) {
            loadMyBookings(bookingViewState.customer);
        }
        if (dashboardState.ownerNearbyOnly && typeof window.applyOwnerNearbyStationFilter === "function") {
            window.applyOwnerNearbyStationFilter();
        }
    });
    document.getElementById("nearbyStationsToggle")?.addEventListener("change", (event) => {
        dashboardState.stationNearbyOnly = Boolean(event.target.checked);
        loadStations();
    });
    document.getElementById("customerUpcomingBtn")?.addEventListener("click", () => loadMyBookings("upcoming"));
    document.getElementById("customerPastBtn")?.addEventListener("click", () => loadMyBookings("past"));
    document.getElementById("nearbyBookingsToggle")?.addEventListener("change", (event) => {
        dashboardState.bookingNearbyOnly = Boolean(event.target.checked);
        loadMyBookings(bookingViewState.customer);
    });
    document.getElementById("refreshMyBookings")?.addEventListener("click", () =>
        loadMyBookings(bookingViewState.customer)
    );
    document.getElementById("ownerBookingsUpcomingBtn")?.addEventListener("click", () =>
        loadOwnerBookings("upcoming")
    );
    document.getElementById("ownerBookingsPastBtn")?.addEventListener("click", () => loadOwnerBookings("past"));
    document.getElementById("refreshOwnerBookings")?.addEventListener("click", () =>
        loadOwnerBookings(bookingViewState.owner)
    );
    document.getElementById("ownerMyBookingsUpcomingBtn")?.addEventListener("click", () =>
        loadOwnerMyBookings("upcoming")
    );
    document.getElementById("ownerMyBookingsPastBtn")?.addEventListener("click", () =>
        loadOwnerMyBookings("past")
    );
    document.getElementById("refreshOwnerMyBookings")?.addEventListener("click", () =>
        loadOwnerMyBookings(bookingViewState.ownerMine)
    );
    document.getElementById("ownerScopeStationBtn")?.addEventListener("click", () =>
        switchOwnerBookingScope("station")
    );
    document.getElementById("ownerScopeMineBtn")?.addEventListener("click", () =>
        switchOwnerBookingScope("mine")
    );
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
    document.getElementById("ownerNearbyStationsToggle")?.addEventListener("change", (event) => {
        dashboardState.ownerNearbyOnly = Boolean(event.target.checked);
        if (typeof window.applyOwnerNearbyStationFilter === "function") {
            window.applyOwnerNearbyStationFilter();
        }
    });
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
    document.getElementById("downloadBookingQrBtn")?.addEventListener("click", downloadBookingQrImage);
    document.getElementById("copyBookingQrValueBtn")?.addEventListener("click", copyBookingQrValue);
    document.getElementById("closeOwnerQrVerificationBtn")?.addEventListener("click", hideOwnerQrVerification);
    document.getElementById("ownerVerifyQrBtn")?.addEventListener("click", submitOwnerQrVerification);

    const ownerTotalSlotsInput = document.getElementById("ownerTotalSlots");
    ownerTotalSlotsInput?.addEventListener("input", () => {
        renderOwnerSlotTypeInputs(ownerTotalSlotsInput.value);
    });
    renderOwnerSlotTypeInputs(ownerTotalSlotsInput?.value || "1");

    await loadMyProfile();
    await loadStations();

    if (role === CUSTOMER_ROLE) {
        await loadMyBookings(bookingViewState.customer);
    }
    if (role === OWNER_ROLE) {
        await loadOwnerStats();
        await loadOwnerRevenueAnalytics();
        await loadOwnerStations();
        await loadOwnerBookings(bookingViewState.owner);
        await loadOwnerMyBookings(bookingViewState.ownerMine);
        switchOwnerBookingScope("station");
    }
    if (role === "admin") {
        await loadAdminStats();
        await loadAdminRevenueAnalytics();
        await loadAdminStationApprovals(adminViewState.stationStatus);
        if (typeof window.initAdminManagement === "function") {
            window.initAdminManagement();
        }
    }
}

function logout() {
    stopInactivityTracking();
    disconnectRealtimeUpdates();
    hideBookingQrSection();
    closeDashboardSidebar?.();
    localStorage.clear();
    window.location.href = "login.html";
}

window.logout = logout;

document.addEventListener("DOMContentLoaded", () => {
    if (isDashboardPage()) {
        initDashboard();
    }
});
