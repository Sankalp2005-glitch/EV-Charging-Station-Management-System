function setupDashboardRoleSections() {
    const role = getRole();
    const openProfileBtn = document.getElementById("openProfileBtn");
    const openSupportBtn = document.getElementById("openSupportBtn");
    const customerDashboardSection = document.getElementById("customerDashboardSection");
    const ownerDashboardSection = document.getElementById("ownerDashboardSection");
    const adminDashboardSection = document.getElementById("adminDashboardSection");
    const dashboardStatsCards = document.getElementById("dashboardStatsCards");
    const customerBookingsSection = document.getElementById("customerBookingsSection");
    const ownerBookingsSection = document.getElementById("ownerBookingsSection");
    const adminStationBookingsSection = document.getElementById("adminStationBookingsSection");
    const ownerStationsSection = document.getElementById("ownerStationsSection");

    if (openProfileBtn) {
        openProfileBtn.style.display = role ? "inline-flex" : "none";
    }
    if (openSupportBtn) {
        openSupportBtn.style.display = role === CUSTOMER_ROLE || role === OWNER_ROLE ? "inline-flex" : "none";
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
    if (dashboardStatsCards) {
        dashboardStatsCards.style.display = role === CUSTOMER_ROLE ? "grid" : "none";
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
    document.querySelectorAll(".member-only").forEach((element) => {
        element.style.display = role === CUSTOMER_ROLE || role === OWNER_ROLE ? "" : "none";
    });
}

const dashboardDataGroupLoaded = Object.create(null);
const dashboardDataGroupPending = new Map();

function getDashboardDataGroupsForTab(role, tabName) {
    if (role === CUSTOMER_ROLE) {
        if (tabName === "dashboard") {
            return ["customerStations", "customerBookings"];
        }
        if (tabName === "stations") {
            return ["customerStations"];
        }
        if (tabName === "bookings") {
            return ["customerBookings"];
        }
        if (tabName === "support") {
            return ["memberSupport"];
        }
        return [];
    }

    if (role === OWNER_ROLE) {
        if (tabName === "dashboard") {
            return ["ownerOverview", "ownerStations"];
        }
        if (tabName === "stations") {
            return ["ownerStations"];
        }
        if (tabName === "bookings") {
            return ["ownerStations", "ownerBookings", "ownerBookingPane"];
        }
        if (tabName === "support") {
            return ["memberSupport"];
        }
        return [];
    }

    if (role === "admin") {
        if (tabName === "dashboard") {
            return ["adminOverview"];
        }
        if (tabName === "bookings") {
            return ["adminApprovals"];
        }
        if (tabName === "admin-users") {
            return ["adminUsers"];
        }
        if (tabName === "admin-stations") {
            return ["adminStations"];
        }
        if (tabName === "admin-bookings") {
            return ["adminBookings"];
        }
        if (tabName === "admin-revenue") {
            return ["adminRevenue"];
        }
    }

    return [];
}

function runDashboardDataGroupLoad(groupKey) {
    switch (groupKey) {
        case "customerStations":
            return Promise.resolve(loadStations());
        case "customerBookings":
            return Promise.resolve(loadMyBookings(bookingViewState.customer));
        case "ownerOverview":
            return Promise.allSettled([loadOwnerStats(), loadOwnerRevenueAnalytics()]);
        case "ownerStations":
            return Promise.resolve(loadOwnerStations());
        case "ownerBookings":
            return Promise.resolve(loadOwnerBookings(bookingViewState.owner));
        case "ownerBookingPane":
            return typeof window.loadVisibleOwnerBookingPane === "function"
                ? Promise.resolve(window.loadVisibleOwnerBookingPane())
                : Promise.resolve();
        case "adminOverview":
            return Promise.allSettled([loadAdminStats(), loadAdminRevenueAnalytics()]);
        case "adminApprovals":
            return Promise.resolve(loadAdminStationApprovals(adminViewState.stationStatus));
        case "adminUsers":
            return Promise.resolve(loadAdminUsers());
        case "adminStations":
            return Promise.resolve(loadAdminStationsManagement());
        case "adminBookings":
            return Promise.resolve(loadAdminBookings());
        case "adminRevenue":
            return Promise.resolve(loadAdminRevenuePage());
        case "memberSupport":
            return typeof window.loadSupportRequests === "function"
                ? Promise.resolve(window.loadSupportRequests())
                : Promise.resolve();
        default:
            return Promise.resolve();
    }
}

function loadDashboardDataGroup(groupKey, options = {}) {
    const { force = false } = options;
    const pendingLoad = dashboardDataGroupPending.get(groupKey);
    if (pendingLoad) {
        return pendingLoad;
    }
    if (!force && dashboardDataGroupLoaded[groupKey]) {
        return Promise.resolve();
    }

    const loadPromise = Promise.resolve(runDashboardDataGroupLoad(groupKey)).finally(() => {
        dashboardDataGroupPending.delete(groupKey);
        dashboardDataGroupLoaded[groupKey] = true;
    });

    dashboardDataGroupPending.set(groupKey, loadPromise);
    return loadPromise;
}

function getActiveDashboardTabName() {
    const activeTab = document.querySelector(".dashboard-tab.active");
    const activeId = String(activeTab?.id || "").trim();
    return activeId.endsWith("Tab") ? activeId.slice(0, -3) : "dashboard";
}

function maybePrimeCustomerStationsLocation() {
    if (getRole() !== CUSTOMER_ROLE || typeof window.primeStationCurrentLocation !== "function") {
        return;
    }

    Promise.resolve(window.primeStationCurrentLocation()).catch(() => {
        // Location priming is best-effort and should never block tab rendering.
    });
}

function loadDashboardTabData(tabName, options = {}) {
    const role = getRole();
    const dataGroups = getDashboardDataGroupsForTab(role, tabName);

    if (role === CUSTOMER_ROLE && tabName === "stations") {
        maybePrimeCustomerStationsLocation();
    }

    if (dataGroups.length === 0) {
        return Promise.resolve();
    }

    return Promise.allSettled(dataGroups.map((groupKey) => loadDashboardDataGroup(groupKey, options)));
}

async function initDashboard() {
    if (!getToken() || !getRole()) {
        window.location.href = "login.html";
        return;
    }

    if (typeof window.markAuthSessionActive === "function") {
        window.markAuthSessionActive();
    }

    const role = getRole();
    const initialTab =
        typeof readDashboardTabFromLocation === "function" ? readDashboardTabFromLocation() : "dashboard";

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
    document.getElementById("ownerScopeStationBtn")?.addEventListener("click", () => {
        switchOwnerBookingScope("station");
        if (typeof window.loadVisibleOwnerBookingPane === "function") {
            window.loadVisibleOwnerBookingPane();
        }
    });
    document.getElementById("ownerScopeMineBtn")?.addEventListener("click", () => {
        switchOwnerBookingScope("mine");
        if (typeof window.loadVisibleOwnerBookingPane === "function") {
            window.loadVisibleOwnerBookingPane();
        }
    });
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
    document.getElementById("supportRequestForm")?.addEventListener("submit", submitSupportRequest);
    document.getElementById("refreshSupportRequestsBtn")?.addEventListener("click", () =>
        loadSupportRequests()
    );
    document.getElementById("openProfileBtn")?.addEventListener("click", () => {
        openProfileSection(false);
        loadMyProfile();
    });
    document.getElementById("profileEditBtn")?.addEventListener("click", () => {
        openProfileSection(true);
        loadMyProfile();
    });
    document.getElementById("profileCancelBtn")?.addEventListener("click", () => {
        setProfileEditMode(false);
        openProfileSection(false);
        loadMyProfile();
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

    const startupTasks = [loadMyProfile()];

    if (role === CUSTOMER_ROLE) {
        if (initialTab === "stations") {
            maybePrimeCustomerStationsLocation();
        }
    }
    if (role === OWNER_ROLE) {
        switchOwnerBookingScope("station");
    }
    if (role === "admin") {
        if (typeof window.initAdminManagement === "function") {
            window.initAdminManagement();
        }
    }

    startupTasks.push(loadDashboardTabData(initialTab));
    await Promise.allSettled(startupTasks);
}

function logout() {
    if (typeof window.markAuthSessionEnding === "function") {
        window.markAuthSessionEnding();
    }
    stopInactivityTracking();
    disconnectRealtimeUpdates();
    if (typeof window.abortPendingAuthRequests === "function") {
        window.abortPendingAuthRequests();
    }
    hideBookingQrSection();
    closeDashboardSidebar?.();
    localStorage.clear();
    window.location.replace("login.html");
}

window.logout = logout;

window.handleDashboardTabChange = (tabName) => {
    loadDashboardTabData(tabName).catch(() => {});
};

window.loadDashboardTabData = loadDashboardTabData;
window.getActiveDashboardTabName = getActiveDashboardTabName;

document.addEventListener("DOMContentLoaded", () => {
    if (isDashboardPage()) {
        initDashboard();
    }
});


