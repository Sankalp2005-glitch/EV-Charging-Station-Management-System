/**
 * Dashboard UI - Tab Navigation and Sidebar Management
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

// Initialize dashboard
document.addEventListener('DOMContentLoaded', function() {
    console.log('[v0] Dashboard UI initialized');
    // Default to dashboard tab
    switchTab('dashboard');
});
