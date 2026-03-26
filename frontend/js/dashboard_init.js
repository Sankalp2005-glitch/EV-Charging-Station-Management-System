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
        if (initialTab === "dashboard" || initialTab === "stations") {
            startupTasks.push(loadStations());
        }
        if (initialTab === "dashboard" || initialTab === "bookings") {
            startupTasks.push(loadMyBookings(bookingViewState.customer));
        }
        if ((initialTab === "dashboard" || initialTab === "stations") && typeof window.primeStationCurrentLocation === "function") {
            window.primeStationCurrentLocation({ refreshStations: true });
        }
    }
    if (role === OWNER_ROLE) {
        switchOwnerBookingScope("station");
        if (initialTab === "dashboard") {
            startupTasks.push(loadOwnerStats(), loadOwnerRevenueAnalytics(), loadOwnerStations());
        }
        if (initialTab === "stations") {
            startupTasks.push(loadOwnerStations());
        }
        if (initialTab === "bookings") {
            startupTasks.push(loadOwnerStations(), loadOwnerBookings(bookingViewState.owner));
        }
    }
    if (role === "admin") {
        if (typeof window.initAdminManagement === "function") {
            window.initAdminManagement();
        }
        if (initialTab === "dashboard") {
            startupTasks.push(loadAdminStats(), loadAdminRevenueAnalytics());
        }
        if (initialTab === "bookings") {
            startupTasks.push(loadAdminStationApprovals(adminViewState.stationStatus));
        }
        if (initialTab === "admin-users") {
            startupTasks.push(loadAdminUsers());
        }
        if (initialTab === "admin-stations") {
            startupTasks.push(loadAdminStationsManagement());
        }
        if (initialTab === "admin-bookings") {
            startupTasks.push(loadAdminBookings());
        }
        if (initialTab === "admin-revenue") {
            startupTasks.push(loadAdminRevenuePage());
        }
    }

    await Promise.allSettled(startupTasks);

    const scheduleBackgroundWork =
        typeof window.requestIdleCallback === "function"
            ? (callback) => window.requestIdleCallback(callback, { timeout: 1200 })
            : (callback) => window.setTimeout(callback, 450);

    scheduleBackgroundWork(() => {
        if (role === CUSTOMER_ROLE) {
            if (initialTab === "bookings") {
                loadStations().catch(() => {});
            }
            if (initialTab === "stations") {
                loadMyBookings(bookingViewState.customer).catch(() => {});
            }
            return;
        }

        if (role === OWNER_ROLE) {
            if (initialTab === "stations" || initialTab === "bookings") {
                Promise.allSettled([loadOwnerStats(), loadOwnerRevenueAnalytics()]);
            }
            if (initialTab === "bookings") {
                loadOwnerStations().catch(() => {});
            }
            if (initialTab === "dashboard" || initialTab === "stations") {
                loadOwnerBookings(bookingViewState.owner).catch(() => {});
            }
            return;
        }

        if (role === "admin") {
            if (initialTab !== "admin-users") {
                loadAdminUsers().catch(() => {});
            }
            if (initialTab !== "admin-stations") {
                loadAdminStationsManagement().catch(() => {});
            }
            if (initialTab !== "admin-bookings") {
                loadAdminBookings().catch(() => {});
            }
            if (initialTab !== "admin-revenue") {
                loadAdminRevenuePage().catch(() => {});
            }
        }
    });
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

const existingDashboardTabChangeHandler =
    typeof window.handleDashboardTabChange === "function" ? window.handleDashboardTabChange : null;

window.handleDashboardTabChange = (tabName) => {
    if (getRole() === CUSTOMER_ROLE && tabName === "stations" && typeof window.primeStationCurrentLocation === "function") {
        window.primeStationCurrentLocation({ refreshStations: true });
    }
    if (getRole() === OWNER_ROLE) {
        if (tabName === "dashboard") {
            if (typeof window.shouldLoadOwnerDashboardInsights === "function" && window.shouldLoadOwnerDashboardInsights()) {
                Promise.allSettled([loadOwnerStats(), loadOwnerRevenueAnalytics()]);
            } else if (typeof window.ownerDashboardInsightsPrimed === "function") {
                window.ownerDashboardInsightsPrimed();
            }
        }
        if (tabName === "bookings") {
            Promise.allSettled([
                loadOwnerBookings(bookingViewState.owner),
                typeof window.loadVisibleOwnerBookingPane === "function"
                    ? window.loadVisibleOwnerBookingPane()
                    : Promise.resolve(),
            ]);
        }
    }
    if (getRole() === "admin" && tabName === "bookings") {
        Promise.allSettled([loadAdminStationApprovals(adminViewState.stationStatus)]);
    }

    if (typeof existingDashboardTabChangeHandler === "function") {
        existingDashboardTabChangeHandler(tabName);
    }
};

document.addEventListener("DOMContentLoaded", () => {
    if (isDashboardPage()) {
        initDashboard();
    }
});
