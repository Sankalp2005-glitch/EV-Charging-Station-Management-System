/**
 * Dashboard UI - Tab Navigation, Sidebar Management, and Header Scroll
 */

// Tab switching functionality
function switchTab(tabName) {
    // Hide all tabs
    const tabs = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => tab.classList.remove('active'));
    
    // Show selected tab
    const selectedTab = document.getElementById(tabName + 'Tab');
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
    
    // Update navigation active state
    const navLinks = document.querySelectorAll('.sidebar-nav .nav-link');
    navLinks.forEach(link => link.classList.remove('active'));
    
    const activeLink = document.querySelector(`.sidebar-nav .nav-link[onclick*="switchTab('${tabName}')"]`);
    if (activeLink) {
        activeLink.classList.add('active');
    }
    
    // Update page title
    const titleMap = {
        'dashboard': 'Dashboard',
        'stations': 'Charging Stations',
        'bookings': 'My Bookings',
        'profile': 'My Profile'
    };
    
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
        pageTitle.textContent = titleMap[tabName] || 'Dashboard';
    }
}

// Header scroll hide/show behaviour
function initHeaderScroll() {
    var mainContent = document.querySelector('.main-content');
    var topNavbar = document.querySelector('.top-navbar');
    if (!mainContent || !topNavbar) return;

    var lastScrollTop = 0;
    var scrollThreshold = 10;

    mainContent.addEventListener('scroll', function () {
        var currentScroll = mainContent.scrollTop;
        if (Math.abs(currentScroll - lastScrollTop) < scrollThreshold) return;

        if (currentScroll > lastScrollTop && currentScroll > 60) {
            // Scrolling down – hide the header
            topNavbar.classList.add('header-hidden');
        } else {
            // Scrolling up – show the header
            topNavbar.classList.remove('header-hidden');
        }
        lastScrollTop = currentScroll;
    }, { passive: true });
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', function() {
    console.log('[v0] Dashboard UI initialized');
    // Default to dashboard tab
    switchTab('dashboard');
    // Initialize header scroll behaviour
    initHeaderScroll();
});
