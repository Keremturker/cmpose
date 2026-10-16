document.addEventListener('DOMContentLoaded', () => {

    // 1. Deep Linking & Anchors
    const headings = document.querySelectorAll('h2');
    headings.forEach(heading => {
        if (heading.id) {
            const anchor = document.createElement('a');
            anchor.href = '#' + heading.id;
            anchor.className = 'anchor-link';
            anchor.innerHTML = `
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path>
                </svg>
            `;
            // Copy link on click
            anchor.addEventListener('click', (e) => {
                e.preventDefault();
                const url = window.location.origin + window.location.pathname + '#' + heading.id;
                navigator.clipboard.writeText(url).then(() => {
                    const toast = document.getElementById("toast");
                    toast.textContent = "Link copied!";
                    toast.className = "show";
                    setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 3000);
                });
            });
            heading.appendChild(anchor);
        }
    });

    // 2. Code Block Controls
    let isDarkMode = false;

    function updateAllWrappers() {
        document.querySelectorAll('.code-wrapper').forEach(wrapper => {
            if (isDarkMode) {
                wrapper.classList.add('dark-mode');
            } else {
                wrapper.classList.remove('dark-mode');
            }
        });
    }

    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            isDarkMode = !isDarkMode;
            updateAllWrappers();
        });
    });

    // 3. Copy Functionality
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent scrolling
            const wrapper = e.target.closest('.code-wrapper');
            const code = wrapper.querySelector('code').innerText;

            navigator.clipboard.writeText(code).then(() => {
                showToast();
            });
        });
    });

    function showToast() {
        const toast = document.getElementById("toast");
        toast.className = "show";
        setTimeout(function () { toast.className = toast.className.replace("show", ""); }, 3000);
    }

    // 4. Sidebar Navigation & Deep Linking
    const sidebarItems = document.querySelectorAll('.sidebar-item');
    const contentSections = document.querySelectorAll('.content-section');

    function switchSection(targetId) {
        // Remove active class from all
        sidebarItems.forEach(item => item.classList.remove('active'));
        contentSections.forEach(section => section.classList.remove('active'));

        // Add active class to target
        const activeItem = document.querySelector(`.sidebar-item[data-target="${targetId}"]`);
        const activeSection = document.getElementById(targetId);

        if (activeItem && activeSection) {
            activeItem.classList.add('active');
            activeSection.classList.add('active');

            // Scroll content area to top
            document.querySelector('.content-area').scrollTo(0, 0);

            // Update URL
            const newUrl = new URL(window.location);
            newUrl.searchParams.set('section', targetId);
            window.history.pushState({}, '', newUrl);
        }
    }

    // Handle Sidebar Clicks
    sidebarItems.forEach(item => {
        item.addEventListener('click', (e) => {
            // Ignore clicks on the info icon
            if (e.target.closest('.info-icon')) return;

            e.preventDefault();
            if (item.classList.contains('disabled')) return;
            const target = item.getAttribute('data-target');
            switchSection(target);
        });
    });

    // Handle Initial Load (Deep Link)
    const urlParams = new URLSearchParams(window.location.search);
    const sectionParam = urlParams.get('section');
    if (sectionParam) {
        switchSection(sectionParam);
    }

    // Handle hash-based deep linking (e.g., #koin-module)
    if (window.location.hash) {
        const hashId = window.location.hash.substring(1); // Remove #
        const targetElement = document.getElementById(hashId);
        if (targetElement) {
            // Find which section contains this element
            const parentSection = targetElement.closest('.content-section');
            if (parentSection) {
                switchSection(parentSection.id);
                // Scroll to the element after section switch
                setTimeout(() => {
                    targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }
        }
    }

    // 5. Mobile Hamburger Menu
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const sidebar = document.querySelector('.sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    function toggleSidebar() {
        sidebar.classList.toggle('open');
        sidebarOverlay.classList.toggle('active');
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('active');
    }

    hamburgerBtn.addEventListener('click', toggleSidebar);
    sidebarOverlay.addEventListener('click', closeSidebar);

    // Close sidebar when item clicked (mobile)
    sidebarItems.forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                closeSidebar();
            }
        });
    });
});
