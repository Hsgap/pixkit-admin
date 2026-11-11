/**
 * PixKit Fleet HQ — Master Admin Command Center Logic
 * Controls state persistence, REST API synchronization, PIN lock, kill switches,
 * feature flags, and supporter moderation.
 */

(function () {
  'use strict';

  const DEFAULT_PIN = '7492';
  const PIN_STORAGE_KEY = 'pixkit_admin_pin_hash';
  const SESSION_AUTH_KEY = 'pixkit_admin_authenticated';
  const API_ENDPOINT = '/api/status';
  const SUPPORTERS_API = '/api/supporters';

  // Global Firebase Realtime Database Configuration
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDCueyN5HjZWuCFuXbVcV5v27QhM3jC0vw",
    authDomain: "pixkit-a7862.firebaseapp.com",
    databaseURL: "https://pixkit-a7862-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "pixkit-a7862",
    storageBucket: "pixkit-a7862.firebasestorage.app",
    messagingSenderId: "704646920606",
    appId: "1:704646920606:web:f50077d6ab0a913bb2fe8f"
  };

  let rtdbInstance = null;
  function getRTDB() {
    if (rtdbInstance) return rtdbInstance;
    try {
      if (typeof firebase !== 'undefined') {
        if (!firebase.apps || !firebase.apps.length) {
          firebase.initializeApp(FIREBASE_CONFIG);
        }
        rtdbInstance = firebase.database();
        return rtdbInstance;
      }
    } catch (_) {}
    return null;
  }

  let currentEnteredPin = '';
  let ecosystemState = null;
  let supportersData = [];

  // =========================================================================
  // 0. Theme Management (PixKit Light / Dark System & View Transition Ripple)
  // =========================================================================
  const THEME_STORAGE_KEY = 'pixkit_admin_theme';

  function applyAdminTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (_) {}
    updateThemeIcon(theme);
  }

  function updateThemeIcon(theme) {
    const btn = document.getElementById('adminThemeToggleBtn');
    if (!btn) return;
    if (theme === 'dark') {
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
      btn.title = "Switch to Light Mode (Press 'T')";
      btn.setAttribute('aria-label', 'Switch to Light Mode');
    } else {
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
      btn.title = "Switch to Dark Mode (Press 'T')";
      btn.setAttribute('aria-label', 'Switch to Dark Mode');
    }
  }

  window.toggleAdminTheme = function (event) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const nextTheme = isDark ? 'light' : 'dark';

    const btn = document.getElementById('adminThemeToggleBtn');
    const rect = btn?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : (event?.clientX ?? window.innerWidth / 2);
    const y = rect ? rect.top + rect.height / 2 : (event?.clientY ?? window.innerHeight / 2);

    if (!document.startViewTransition) {
      applyAdminTheme(nextTheme);
      return;
    }

    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = document.startViewTransition(() => {
      applyAdminTheme(nextTheme);
    });

    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`
      ];
      document.documentElement.animate(
        { clipPath: clipPath },
        {
          duration: 350,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          pseudoElement: '::view-transition-new(root)'
        }
      );
    });
  };

  // Keyboard shortcut: Press 'T' to toggle theme anytime
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 't' || e.key === 'T') {
      window.toggleAdminTheme();
    }
  });

  // Apply saved theme immediately on script execution
  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyAdminTheme(savedTheme);
  } catch (_) {}

  // =========================================================================
  // 1. PIN Security & Lock Screen
  // =========================================================================

  function getStoredPin() {
    try {
      return localStorage.getItem(PIN_STORAGE_KEY) || DEFAULT_PIN;
    } catch (_) {
      return DEFAULT_PIN;
    }
  }

  function checkSessionAuth() {
    try {
      return sessionStorage.getItem(SESSION_AUTH_KEY) === 'true';
    } catch (_) {
      return false;
    }
  }

  window.handleNumpadPress = function (val) {
    if (val === 'C') {
      currentEnteredPin = '';
    } else if (val === 'DEL') {
      currentEnteredPin = currentEnteredPin.slice(0, -1);
    } else if (currentEnteredPin.length < 4) {
      currentEnteredPin += val;
    }

    updatePinDots();

    if (currentEnteredPin.length === 4) {
      setTimeout(verifyPin, 150);
    }
  };

  function updatePinDots() {
    const dots = document.querySelectorAll('.pin-dot');
    dots.forEach((dot, idx) => {
      if (idx < currentEnteredPin.length) {
        dot.classList.add('filled');
      } else {
        dot.classList.remove('filled');
      }
    });
  }

  function verifyPin() {
    const correctPin = getStoredPin();
    if (currentEnteredPin === correctPin) {
      try {
        sessionStorage.setItem(SESSION_AUTH_KEY, 'true');
      } catch (_) {}
      const lockScreen = document.getElementById('adminLockScreen');
      if (lockScreen) {
        lockScreen.style.display = 'none';
      }
      currentEnteredPin = '';
      updatePinDots();
      showToast('Welcome to PixKit Fleet HQ', 'success');
      initDashboard();
    } else {
      const lockBox = document.querySelector('.admin-lock-box');
      if (lockBox) {
        lockBox.style.animation = 'shake 0.3s ease';
        setTimeout(() => { lockBox.style.animation = ''; }, 350);
      }
      currentEnteredPin = '';
      updatePinDots();
      alert('Incorrect PIN. (Default is 7492)');
    }
  }

  window.lockAdminSession = function () {
    try {
      sessionStorage.removeItem(SESSION_AUTH_KEY);
    } catch (_) {}
    const lockScreen = document.getElementById('adminLockScreen');
    if (lockScreen) {
      lockScreen.style.display = 'flex';
    }
    currentEnteredPin = '';
    updatePinDots();
  };

  // =========================================================================
  // 2. Tab Navigation
  // =========================================================================

  window.switchTab = function (tabId, btn) {
    document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

    const target = document.getElementById('tab-' + tabId);
    if (target) target.classList.add('active');
    if (btn) btn.classList.add('active');
  };

  // =========================================================================
  // 3. Ecosystem State Management (Load & Save)
  // =========================================================================

  async function loadEcosystemState() {
    let loaded = false;

    // 1. Try Firebase RTDB (Realtime ecosystem state shared globally)
    try {
      const rtdb = getRTDB();
      if (rtdb) {
        const snap = await rtdb.ref('ecosystem').once('value');
        const cloudState = snap.val();
        if (cloudState && typeof cloudState === 'object') {
          ecosystemState = cloudState;
          loaded = true;
        }

        // Realtime listener for cross-admin or multi-device updates
        rtdb.ref('ecosystem').on('value', s => {
          const val = s.val();
          if (val && typeof val === 'object') {
            ecosystemState = val;
            renderDashboardData();
          }
        });
      }
    } catch (_) {}

    // 2. Try REST API endpoint (when running dedicated local server)
    if (!loaded) {
      try {
        const res = await fetch(API_ENDPOINT + '?t=' + Date.now());
        if (res.ok) {
          ecosystemState = await res.json();
          loaded = true;
        }
      } catch (_) {}
    }

    // 3. Fallback to static config/ecosystem-state.json (for GitHub Pages hosting)
    if (!loaded) {
      try {
        const staticRes = await fetch('config/ecosystem-state.json?t=' + Date.now());
        if (staticRes.ok) {
          ecosystemState = await staticRes.json();
          loaded = true;
        }
      } catch (_) {}
    }

    // 4. Fallback to local storage cache
    if (!loaded) {
      try {
        const cached = localStorage.getItem('pixkit_admin_state_cache');
        if (cached) ecosystemState = JSON.parse(cached);
      } catch (_) {}
    }

    if (!ecosystemState) {
      ecosystemState = getDefaultState();
    }

    // If Firebase RTDB was empty, seed it with current ecosystemState
    if (!loaded) {
      try {
        const rtdb = getRTDB();
        if (rtdb) rtdb.ref('ecosystem').set(ecosystemState);
      } catch (_) {}
    }

    ensureFeatureFlagsStructure();
    renderDashboardData();
  }

  async function saveEcosystemState() {
    if (!ecosystemState) return;

    try {
      // 1. Save locally in browser
      localStorage.setItem('pixkit_admin_state_cache', JSON.stringify(ecosystemState));

      // 2. Broadcast LIVE to Firebase Realtime Database (instantly triggers on pixkit.site & mobile app within 50ms)
      const rtdb = getRTDB();
      if (rtdb) {
        await rtdb.ref('ecosystem').set(ecosystemState);
      }

      // 3. Post to local server if available
      fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ecosystemState)
      }).catch(() => {});

      showToast('Ecosystem changes synced live to all clients!', 'success');
    } catch (err) {
      showToast('Saved locally in browser cache', 'info');
    }

    renderDashboardData();
  }
  window.saveEcosystemState = saveEcosystemState;

  // =========================================================================
  // Granular All-Tools Ecosystem Schema (24 Ready Tools Across 4 Categories)
  // =========================================================================
  const ALL_TOOLS_SCHEMA = [
    {
      categoryKey: 'editTools',
      title: 'Image Edit Tools',
      icon: '🎨',
      description: 'Standard client-side canvas manipulation, tone tuning, filters, and layer tools',
      tools: [
        { id: 'adjust', name: 'Adjust Tones', desc: 'Brightness, Contrast, Saturation, & Vibrance controls' },
        { id: 'filters', name: 'Preset Filters', desc: 'Mono, Warm, Cool, Vintage, Cyberpunk, Film presets' },
        { id: 'crop', name: 'Crop & Aspect Ratio', desc: 'Freeform selection & social media preset ratios' },
        { id: 'resize', name: 'Resize & Dimensions', desc: 'Pixel width/height scaling & DPI preservation' },
        { id: 'rotateFlip', name: 'Rotate & Flip', desc: '90° step rotation, horizontal & vertical mirror' },
        { id: 'compress', name: 'Compress Image', desc: 'Client-side JPEG/PNG/WebP compression engine' },
        { id: 'drawShapes', name: 'Draw & Shapes', desc: 'Freehand brush, rectangles, circles, arrows, highlighter' },
        { id: 'addText', name: 'Add Text & Typography', desc: 'Custom text overlays, system fonts, styling & watermarks' }
      ]
    },
    {
      categoryKey: 'convertTools',
      title: 'Format Conversion Tools',
      icon: '🔄',
      description: 'Zero-cloud image and document format conversion routines running directly in client',
      tools: [
        { id: 'formatConverter', name: 'Format Converter', desc: 'Batch PNG, JPG, WebP, AVIF, BMP converter' },
        { id: 'heicToJpg', name: 'HEIC to JPG Converter', desc: 'Apple HEIC/HEIF client decoding into JPG' },
        { id: 'svgToPng', name: 'SVG to PNG Converter', desc: 'High-res vector to raster image client rendering' },
        { id: 'imageToPdf', name: 'Image to PDF', desc: 'Bundle one or more photos into multi-page PDF documents' },
        { id: 'imageToIco', name: 'Image to ICO', desc: 'Multi-resolution website favicon generator' },
        { id: 'imageToBase64', name: 'Image to Base64', desc: 'Convert image files to direct Data URI strings for web devs' }
      ]
    },
    {
      categoryKey: 'pdfTools',
      title: 'PDF Document Tools',
      icon: '📄',
      description: 'Client-side PDF-Lib document assembly, extraction, page manipulation, and compression',
      tools: [
        { id: 'mergePdf', name: 'Merge PDF Files', desc: 'Concatenate multiple PDF documents in custom order' },
        { id: 'splitPdf', name: 'Split PDF Files', desc: 'Extract individual pages or range splits into separate files' },
        { id: 'compressPdf', name: 'Compress PDF', desc: 'DPI reduction and embedded image resampling' },
        { id: 'pdfToImages', name: 'PDF to Images', desc: 'Render PDF pages into crisp PNG/JPG image files' },
        { id: 'imagesToPdf', name: 'Images to PDF', desc: 'Compile multiple JPG/PNG images into a formatted PDF' },
        { id: 'rotatePdf', name: 'Rotate PDF Pages', desc: 'Permanent 90°/180° page rotation per page or document' },
        { id: 'deletePdfPages', name: 'Delete PDF Pages', desc: 'Selectively remove pages and download cleaned document' }
      ]
    },
    {
      categoryKey: 'community',
      title: 'Community & Ecosystem Features',
      icon: '🤝',
      description: 'Ecosystem modals, contribution banners, user leaderboard, and local edit history',
      tools: [
        { id: 'leaderboard', name: 'Public Leaderboard', desc: 'Show contributor hall of fame & top supporters modal (Web Studio only)', platforms: ['web'] },
        { id: 'supportModal', name: 'Support / Donate Modal', desc: 'Allow Buy Me a Coffee & voluntary contribution navigation' },
        { id: 'recentFiles', name: 'Recent Files & History', desc: 'Local browser storage for recent edits and quick re-opens' }
      ]
    }
  ];

  let currentFlagsPlatform = 'web';
  window.currentFlagsPlatform = currentFlagsPlatform;

  function ensureFeatureFlagsStructure() {
    if (!ecosystemState.featureFlags || typeof ecosystemState.featureFlags !== 'object') {
      ecosystemState.featureFlags = {};
    }

    const legacyFlags = {
      editTools: ecosystemState.featureFlags.editTools,
      convertTools: ecosystemState.featureFlags.convertTools,
      pdfTools: ecosystemState.featureFlags.pdfTools,
      community: ecosystemState.featureFlags.community
    };

    ['web', 'mobile'].forEach(plat => {
      if (!ecosystemState.featureFlags[plat] || typeof ecosystemState.featureFlags[plat] !== 'object') {
        ecosystemState.featureFlags[plat] = {};
      }
      ALL_TOOLS_SCHEMA.forEach(cat => {
        if (!ecosystemState.featureFlags[plat][cat.categoryKey]) {
          ecosystemState.featureFlags[plat][cat.categoryKey] = {};
        }
        cat.tools.forEach(tool => {
          if (tool.platforms && !tool.platforms.includes(plat)) {
            ecosystemState.featureFlags[plat][cat.categoryKey][tool.id] = false;
            return;
          }
          if (ecosystemState.featureFlags[plat][cat.categoryKey][tool.id] === undefined) {
            // Check legacy migration
            if (legacyFlags[cat.categoryKey] && legacyFlags[cat.categoryKey][tool.id] !== undefined) {
              ecosystemState.featureFlags[plat][cat.categoryKey][tool.id] = legacyFlags[cat.categoryKey][tool.id];
            } else {
              ecosystemState.featureFlags[plat][cat.categoryKey][tool.id] = true;
            }
          }
        });
      });
    });

    // Cleanup legacy top-level keys if any
    delete ecosystemState.featureFlags.editTools;
    delete ecosystemState.featureFlags.convertTools;
    delete ecosystemState.featureFlags.pdfTools;
    delete ecosystemState.featureFlags.community;
  }

  function updatePlatformFlagsCounters() {
    if (!ecosystemState || !ecosystemState.featureFlags) return;

    ['web', 'mobile'].forEach(plat => {
      const platFlags = ecosystemState.featureFlags[plat] || {};
      let activeCount = 0;
      let totalCount = 0;

      ALL_TOOLS_SCHEMA.forEach(cat => {
        const catFlags = platFlags[cat.categoryKey] || {};
        cat.tools.forEach(tool => {
          if (tool.platforms && !tool.platforms.includes(plat)) return;
          totalCount++;
          if (catFlags[tool.id] !== false) {
            activeCount++;
          }
        });
      });

      const badge = document.getElementById(`badge-flags-count-${plat}`);
      if (badge) {
        badge.textContent = `${activeCount}/${totalCount} Active`;
      }
    });
  }

  function renderFeatureFlagsUI(searchQuery = '') {
    const container = document.getElementById('featureFlagsCategoriesContainer');
    if (!container || !ecosystemState || !ecosystemState.featureFlags) return;

    ensureFeatureFlagsStructure();
    updatePlatformFlagsCounters();

    const plat = currentFlagsPlatform || 'web';
    const platFlags = ecosystemState.featureFlags[plat] || {};
    const query = (searchQuery || '').trim().toLowerCase();

    let renderedCategoriesCount = 0;
    let html = '';

    ALL_TOOLS_SCHEMA.forEach(cat => {
      const catFlags = platFlags[cat.categoryKey] || {};

      // Filter tools based on search query and platform applicability
      const matchingTools = cat.tools.filter(t => {
        if (t.platforms && !t.platforms.includes(plat)) return false;
        if (!query) return true;
        return t.name.toLowerCase().includes(query) ||
               t.desc.toLowerCase().includes(query) ||
               t.id.toLowerCase().includes(query);
      });

      if (matchingTools.length === 0 && (query || cat.tools.some(t => t.platforms && !t.platforms.includes(plat)))) {
        if (matchingTools.length === 0) return;
      }

      renderedCategoriesCount++;

      // Count active tools in this category for current platform
      let catActiveCount = 0;
      let catTotalCount = 0;
      cat.tools.forEach(t => {
        if (t.platforms && !t.platforms.includes(plat)) return;
        catTotalCount++;
        if (catFlags[t.id] !== false) catActiveCount++;
      });

      const toolsHtml = matchingTools.map(tool => {
        const isEnabled = catFlags[tool.id] !== false;
        return `
          <div class="flag-row">
            <div class="flag-label-col">
              <h5>${escapeHtml(tool.name)}</h5>
              <p>${escapeHtml(tool.desc)}</p>
            </div>
            <label class="switch-box mini-switch">
              <input type="checkbox"
                     id="flag-${plat}-${cat.categoryKey}-${tool.id}"
                     ${isEnabled ? 'checked' : ''}
                     onchange="togglePlatformFeatureFlag('${plat}', '${cat.categoryKey}', '${tool.id}', this.checked)">
              <span class="slider-round"></span>
            </label>
          </div>
        `;
      }).join('');

      html += `
        <div class="flags-category-box">
          <div class="category-header-row">
            <h3>
              <span>${cat.icon}</span>
              <span>${escapeHtml(cat.title)}</span>
            </h3>
            <span class="category-count-badge" id="cat-badge-${cat.categoryKey}">${catActiveCount}/${catTotalCount} Active</span>
          </div>
          <p style="font-size: 12.5px; color: var(--admin-muted); margin-bottom: 16px;">${escapeHtml(cat.description)}</p>
          <div class="flags-items-list">
            ${toolsHtml}
          </div>
        </div>
      `;
    });

    if (renderedCategoriesCount === 0 && query) {
      container.innerHTML = `
        <div class="flags-category-box" style="text-align: center; padding: 48px 24px;">
          <div style="font-size: 32px; margin-bottom: 12px;">🔍</div>
          <h3 style="justify-content: center; margin-bottom: 6px;">No tools found matching "${escapeHtml(query)}"</h3>
          <p style="color: var(--admin-muted); font-size: 13px;">Try searching for "PDF", "crop", "resize", "filters", or "converter".</p>
        </div>
      `;
    } else {
      container.innerHTML = html;
    }
  }

  window.setFlagsPlatform = function (platKey) {
    currentFlagsPlatform = platKey;
    window.currentFlagsPlatform = platKey;

    document.querySelectorAll('.platform-pill-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`btn-flags-plat-${platKey}`);
    if (activeBtn) activeBtn.classList.add('active');

    const searchInput = document.getElementById('flagsToolSearchInput');
    const query = searchInput ? searchInput.value : '';
    renderFeatureFlagsUI(query);
  };

  window.togglePlatformFeatureFlag = function (plat, category, toolId, isChecked) {
    if (!ecosystemState.featureFlags[plat]) ecosystemState.featureFlags[plat] = {};
    if (!ecosystemState.featureFlags[plat][category]) ecosystemState.featureFlags[plat][category] = {};
    ecosystemState.featureFlags[plat][category][toolId] = isChecked;

    updatePlatformFlagsCounters();

    const cat = ALL_TOOLS_SCHEMA.find(c => c.categoryKey === category);
    if (cat) {
      let activeCount = 0;
      let totalCount = 0;
      cat.tools.forEach(t => {
        if (t.platforms && !t.platforms.includes(plat)) return;
        totalCount++;
        if (ecosystemState.featureFlags[plat][category][t.id] !== false) activeCount++;
      });
      const badge = document.getElementById(`cat-badge-${category}`);
      if (badge) badge.textContent = `${activeCount}/${totalCount} Active`;
    }

    if (category === 'community' && toolId === 'leaderboard') {
      updateLeaderboardMetricStatus();
    }

    saveEcosystemState();
  };

  window.batchTogglePlatformFlags = function (plat, isEnabled) {
    if (!ecosystemState.featureFlags[plat]) ecosystemState.featureFlags[plat] = {};
    ALL_TOOLS_SCHEMA.forEach(cat => {
      if (!ecosystemState.featureFlags[plat][cat.categoryKey]) ecosystemState.featureFlags[plat][cat.categoryKey] = {};
      cat.tools.forEach(tool => {
        if (tool.platforms && !tool.platforms.includes(plat)) return;
        ecosystemState.featureFlags[plat][cat.categoryKey][tool.id] = isEnabled;
      });
    });

    saveEcosystemState();
    const searchInput = document.getElementById('flagsToolSearchInput');
    renderFeatureFlagsUI(searchInput ? searchInput.value : '');
    showToast(`${plat === 'web' ? 'Web Studio' : 'Mobile App'}: All tools ${isEnabled ? 'enabled' : 'disabled'}!`, 'info');
  };

  window.filterFeatureFlags = function (query) {
    renderFeatureFlagsUI(query);
  };

  function getDefaultState() {
    const makeFlags = () => ({
      editTools: {
        adjust: true, filters: true, crop: true, resize: true,
        rotateFlip: true, compress: true, drawShapes: true, addText: true
      },
      convertTools: {
        formatConverter: true, heicToJpg: true, svgToPng: true,
        imageToPdf: true, imageToIco: true, imageToBase64: true
      },
      pdfTools: {
        mergePdf: true, splitPdf: true, compressPdf: true,
        pdfToImages: true, imagesToPdf: true, rotatePdf: true, deletePdfPages: true
      },
      community: {
        leaderboard: true, supportModal: true, recentFiles: true
      }
    });

    return {
      system: { version: '1.0.0', lastUpdated: new Date().toISOString() },
      maintenance: {
        global: false,
        platforms: { web: false, mobile: false },
        message: {
          headline: 'PixKit is undergoing scheduled maintenance',
          body: 'Our studio is undergoing a quick engine upgrade. All local browser files remain 100% safe. Back shortly!',
          estimatedUptime: '15 minutes'
        }
      },
      featureFlags: {
        web: makeFlags(),
        mobile: makeFlags()
      },
      broadcast: { enabled: false, headline: 'Welcome to PixKit Studio', message: '', actionUrl: '', dismissible: true },
      versionControl: {
        mobile: { minSupportedVersion: '1.0.0', latestVersion: '1.2.0', forceUpdate: false },
        desktop: { minSupportedVersion: '1.0.0', latestVersion: '1.0.4', forceUpdate: false }
      }
    };
  }

  // =========================================================================
  // 4. Render Dashboard Controls
  // =========================================================================

  function renderDashboardData() {
    if (!ecosystemState) return;

    // 1. Topbar Fleet Pill
    const isGlobalShutdown = ecosystemState.maintenance.global;
    const pill = document.getElementById('fleetStatusPill');
    if (pill) {
      if (isGlobalShutdown) {
        pill.className = 'fleet-status-pill maintenance';
        pill.innerHTML = '<span class="pulse-dot"></span> EMERGENCY SHUTDOWN ACTIVE';
      } else {
        pill.className = 'fleet-status-pill operational';
        pill.innerHTML = '<span class="pulse-dot"></span> ALL FLEET OPERATIONAL';
      }
    }

    // 2. Master Kill Switch Hero
    const masterKillCheckbox = document.getElementById('masterKillToggle');
    const heroCard = document.getElementById('heroKillCard');
    if (masterKillCheckbox) {
      masterKillCheckbox.checked = isGlobalShutdown;
      if (heroCard) {
        if (isGlobalShutdown) {
          heroCard.classList.add('is-active-shutdown');
        } else {
          heroCard.classList.remove('is-active-shutdown');
        }
      }
    }

    // 3. Platform Toggles (Active Ready Builds: Web Studio & Mobile App)
    const plats = ecosystemState.maintenance.platforms || {};
    ['web', 'mobile'].forEach(plat => {
      const toggle = document.getElementById('plat-toggle-' + plat);
      const tag = document.getElementById('plat-tag-' + plat);
      const isDown = isGlobalShutdown || plats[plat];

      if (toggle) toggle.checked = !plats[plat];
      if (tag) {
        if (isDown) {
          tag.className = 'platform-status-tag status-down';
          tag.textContent = 'Maintenance';
        } else {
          tag.className = 'platform-status-tag status-live';
          tag.textContent = 'Live & Healthy';
        }
      }
    });

    // 4. Maintenance Message inputs
    const msg = ecosystemState.maintenance.message || {};
    const inputHeadline = document.getElementById('maintHeadlineInput');
    const inputBody = document.getElementById('maintBodyInput');
    const inputUptime = document.getElementById('maintUptimeInput');
    if (inputHeadline && document.activeElement !== inputHeadline) inputHeadline.value = msg.headline || '';
    if (inputBody && document.activeElement !== inputBody) inputBody.value = msg.body || '';
    if (inputUptime && document.activeElement !== inputUptime) inputUptime.value = msg.estimatedUptime || '';

    // 5. Feature Flags (Granular Platform-Specific UI)
    renderFeatureFlagsUI();

    // 6. Broadcast Fields
    const bc = ecosystemState.broadcast || {};
    const bcToggle = document.getElementById('broadcastToggle');
    const bcHeadline = document.getElementById('broadcastHeadline');
    const bcMessage = document.getElementById('broadcastMessage');
    const bcUrl = document.getElementById('broadcastUrl');
    if (bcToggle) bcToggle.checked = !!bc.enabled;
    if (bcHeadline && document.activeElement !== bcHeadline) bcHeadline.value = bc.headline || '';
    if (bcMessage && document.activeElement !== bcMessage) bcMessage.value = bc.message || '';
    if (bcUrl && document.activeElement !== bcUrl) bcUrl.value = bc.actionUrl || '';

    // 7. Version Control Fields
    const vc = ecosystemState.versionControl || {};
    const mobMin = document.getElementById('mobileMinVersion');
    const mobLatest = document.getElementById('mobileLatestVersion');
    const mobForce = document.getElementById('mobileForceUpdate');
    if (mobMin && document.activeElement !== mobMin) mobMin.value = vc.mobile?.minSupportedVersion || '';
    if (mobLatest && document.activeElement !== mobLatest) mobLatest.value = vc.mobile?.latestVersion || '';
    if (mobForce) mobForce.checked = !!vc.mobile?.forceUpdate;

    // 8. Public Leaderboard status in Supporters card
    updateLeaderboardMetricStatus();
  }

  // =========================================================================
  // 5. Interactive Event Handlers
  // =========================================================================

  window.toggleMasterKillSwitch = function (isChecked) {
    if (isChecked) {
      const confirmKill = confirm('⚠️ EMERGENCY WARNING:\n\nAre you sure you want to SHUT DOWN ALL PIXKIT APPS?\n\nThis will instantly show a maintenance screen to every active visitor on Web, Android, iOS, and Desktop.');
      if (!confirmKill) {
        document.getElementById('masterKillToggle').checked = false;
        return;
      }
    }
    ecosystemState.maintenance.global = isChecked;
    saveEcosystemState();
  };

  window.togglePlatformStatus = function (platformKey, isOnline) {
    if (!ecosystemState.maintenance.platforms) {
      ecosystemState.maintenance.platforms = {};
    }
    // isOnline checkbox is checked = platform is ONLINE (maintenance = false)
    ecosystemState.maintenance.platforms[platformKey] = !isOnline;
    saveEcosystemState();
  };

  window.updateMaintenanceMessage = function () {
    ecosystemState.maintenance.message = {
      headline: document.getElementById('maintHeadlineInput')?.value || '',
      body: document.getElementById('maintBodyInput')?.value || '',
      estimatedUptime: document.getElementById('maintUptimeInput')?.value || ''
    };
    saveEcosystemState();
  };

  window.toggleFeatureFlag = function (cat, key, isEnabled) {
    window.togglePlatformFeatureFlag(currentFlagsPlatform, cat, key, isEnabled);
  };

  window.updateBroadcast = function () {
    ecosystemState.broadcast = {
      enabled: document.getElementById('broadcastToggle')?.checked || false,
      headline: document.getElementById('broadcastHeadline')?.value || '',
      message: document.getElementById('broadcastMessage')?.value || '',
      actionUrl: document.getElementById('broadcastUrl')?.value || '',
      dismissible: true
    };
    saveEcosystemState();
  };

  window.updateVersionControl = function () {
    ecosystemState.versionControl.mobile = {
      minSupportedVersion: document.getElementById('mobileMinVersion')?.value || '1.0.0',
      latestVersion: document.getElementById('mobileLatestVersion')?.value || '1.2.0',
      forceUpdate: document.getElementById('mobileForceUpdate')?.checked || false
    };
    saveEcosystemState();
  };

  // =========================================================================
  // 6. Supporter & Leaderboard Moderation (Real-Time Cloud & 1-Min Auto-Refresh)
  // =========================================================================

  let supportersRef = null;
  let lastSyncTimestamp = Date.now();
  let refreshSecondsRemaining = 60;
  let autoRefreshTimer = null;
  let countdownTimer = null;

  function updateSyncUIStatus(statusText, isOnline = true) {
    const textEl = document.getElementById('supportersSyncStatusText');
    const dotEl = document.getElementById('supportersPulseDot');
    if (textEl) textEl.textContent = statusText;
    if (dotEl) {
      if (isOnline) {
        dotEl.style.background = 'var(--admin-emerald)';
        dotEl.style.boxShadow = '0 0 10px var(--admin-emerald)';
      } else {
        dotEl.style.background = 'var(--admin-amber)';
        dotEl.style.boxShadow = '0 0 10px var(--admin-amber)';
      }
    }
  }

  function initFirebaseSupportersSync() {
    try {
      const rtdb = getRTDB();
      if (rtdb) {
        supportersRef = rtdb.ref('supporters');

        // Real-Time listener for any donation worldwide
        supportersRef.on('value', snapshot => {
          const val = snapshot.val();
          if (val) {
            let list = Array.isArray(val) ? val : Object.values(val);
            // Purge dummy mockups like Marcus Vance or sup_initial_01
            supportersData = list.filter(s => s && s.id !== 'sup_initial_01' && s.name !== 'Marcus Vance');
            if (supportersData.length !== list.length) {
              supportersRef.set(supportersData);
            }
          } else {
            supportersData = [];
          }
          lastSyncTimestamp = Date.now();
          updateSyncUIStatus('Firebase Real-Time Stream Active', true);
          renderSupportersTable();
        }, error => {
          console.warn('Firebase RTDB error:', error);
          updateSyncUIStatus('Local Cache / Polling Active', false);
        });
      }
    } catch (err) {
      console.warn('Firebase init error:', err);
      updateSyncUIStatus('Local Cache Mode', false);
    }
  }

  let currentSupportersTimeframe = 'all'; // 'all' (Yearly / All-Time) | 'monthly' | 'weekly'
  window.currentSupportersTimeframe = currentSupportersTimeframe;

  window.setSupportersTimeframe = function (tf) {
    currentSupportersTimeframe = tf;
    window.currentSupportersTimeframe = tf;

    ['all', 'monthly', 'weekly'].forEach(k => {
      const btnId = `btn-tf-${k === 'all' ? 'all' : (k === 'monthly' ? 'month' : 'week')}`;
      const btn = document.getElementById(btnId);
      if (btn) btn.classList.toggle('active', k === tf);
    });

    renderSupportersTable();
  };

  function isWithinTimeframe(timestamp, timeframe) {
    if (!timestamp || timeframe === 'all') return true;
    const ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    if (isNaN(ts) || ts <= 0) return true;

    const now = Date.now();
    if (timeframe === 'weekly') {
      return (now - ts) <= (7 * 24 * 60 * 60 * 1000);
    }
    if (timeframe === 'monthly') {
      return (now - ts) <= (30 * 24 * 60 * 60 * 1000);
    }
    return true;
  }

  function updateLeaderboardMetricStatus() {
    const statusEl = document.getElementById('metricLeaderboardStatus');
    const subtextEl = document.getElementById('metricLeaderboardSubtext');
    if (!statusEl || !subtextEl) return;

    const isLive = ecosystemState?.featureFlags?.web?.community?.leaderboard !== false;

    if (isLive) {
      statusEl.innerHTML = '<span style="color: var(--admin-emerald); font-weight: 800;">● Active &amp; Visible</span>';
      subtextEl.innerHTML = `Live on pixkit.site &nbsp;•&nbsp; <button type="button" onclick="quickToggleLeaderboard()" style="background:none; border:none; color:var(--admin-lime); text-decoration:underline; font-weight:700; cursor:pointer; font-size:12px; padding:0;">Pause</button>`;
    } else {
      statusEl.innerHTML = '<span style="color: var(--admin-amber); font-weight: 800;">○ Hidden / Paused</span>';
      subtextEl.innerHTML = `Disabled on pixkit.site &nbsp;•&nbsp; <button type="button" onclick="quickToggleLeaderboard()" style="background:none; border:none; color:var(--admin-lime); text-decoration:underline; font-weight:700; cursor:pointer; font-size:12px; padding:0;">Turn On</button>`;
    }
  }
  window.updateLeaderboardMetricStatus = updateLeaderboardMetricStatus;

  window.quickToggleLeaderboard = async function () {
    if (!ecosystemState) return;
    ensureFeatureFlagsStructure();
    const current = ecosystemState?.featureFlags?.web?.community?.leaderboard !== false;
    ecosystemState.featureFlags.web.community.leaderboard = !current;
    await saveEcosystemState();
    updateLeaderboardMetricStatus();
    renderFeatureFlagsUI();
    showToast(`Public Leaderboard is now ${!current ? 'ENABLED' : 'PAUSED'} on pixkit.site!`, 'success');
  };

  async function loadSupportersData() {
    let loaded = false;

    // 1. Try Firebase RTDB
    if (supportersRef) {
      try {
        const snap = await supportersRef.once('value');
        const val = snap.val();
        if (val) {
          let list = Array.isArray(val) ? val : Object.values(val);
          supportersData = list.filter(s => s && s.id !== 'sup_initial_01' && s.name !== 'Marcus Vance');
          if (supportersData.length !== list.length) {
            supportersRef.set(supportersData);
          }
          loaded = true;
          updateSyncUIStatus('Firebase Real-Time Stream Active', true);
        }
      } catch (_) {}
    }

    // 2. Try Local Dedicated REST API (/api/supporters)
    if (!loaded) {
      try {
        const res = await fetch(SUPPORTERS_API + '?t=' + Date.now());
        if (res.ok) {
          const apiData = await res.json();
          if (Array.isArray(apiData)) {
            supportersData = apiData.filter(s => s && s.id !== 'sup_initial_01' && s.name !== 'Marcus Vance');
            loaded = true;
            updateSyncUIStatus('Dedicated Admin Server Connected', true);
          }
        }
      } catch (_) {}
    }

    // 3. Try Static Config File (config/supporters.json for GitHub Pages)
    if (!loaded) {
      try {
        const staticRes = await fetch('config/supporters.json?t=' + Date.now());
        if (staticRes.ok) {
          const staticData = await staticRes.json();
          if (Array.isArray(staticData)) {
            supportersData = staticData.filter(s => s && s.id !== 'sup_initial_01' && s.name !== 'Marcus Vance');
            loaded = true;
            updateSyncUIStatus('Static Cloud Config Loaded', true);
          }
        }
      } catch (_) {}
    }

    // 4. Try Browser LocalStorage Cache
    if (!loaded) {
      try {
        const local = localStorage.getItem('pixkit_leaderboard_supporters_v2');
        if (local) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed)) {
            supportersData = parsed.filter(s => s && s.id !== 'sup_initial_01' && s.name !== 'Marcus Vance');
            localStorage.setItem('pixkit_leaderboard_supporters_v2', JSON.stringify(supportersData));
            loaded = true;
            updateSyncUIStatus('Local Storage Loaded', true);
          }
        }
      } catch (_) {}
    }

    // 5. Final fallback: If still empty, keep as empty array (0 mockups)
    if (!loaded || !Array.isArray(supportersData)) {
      supportersData = [];
    }

    lastSyncTimestamp = Date.now();
    renderSupportersTable();
  }

  async function saveSupportersData() {
    try {
      supportersData = supportersData.filter(s => s && s.id !== 'sup_initial_01' && s.name !== 'Marcus Vance');
      localStorage.setItem('pixkit_leaderboard_supporters_v2', JSON.stringify(supportersData));

      // 1. Save to Firebase RTDB in real time
      if (supportersRef) {
        await supportersRef.set(supportersData);
      }

      // 2. Save to local REST API if available
      await fetch(SUPPORTERS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supportersData)
      });
    } catch (_) {}

    lastSyncTimestamp = Date.now();
    renderSupportersTable();
  }

  window.clearAllSupportersMockups = async function () {
    if (!confirm('Clear all mockup and test supporter records? Total collection will be reset to $0.00.')) {
      return;
    }
    supportersData = [];
    try {
      localStorage.removeItem('pixkit_leaderboard_supporters_v2');
      localStorage.setItem('pixkit_leaderboard_supporters_v2', JSON.stringify([]));
    } catch (_) {}

    if (supportersRef) {
      try {
        await supportersRef.set([]);
      } catch (_) {}
    }

    try {
      await fetch(SUPPORTERS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([])
      });
    } catch (_) {}

    renderSupportersTable();
    showToast('Mockup data completely cleared! Collection reset to $0.00.', 'success');
  };

  window.refreshSupportersData = async function (isAuto = false) {
    const btn = document.getElementById('btnManualRefreshSupporters');
    if (btn) btn.classList.add('is-spinning');

    await loadSupportersData();

    refreshSecondsRemaining = 60;
    const badge = document.getElementById('supportersRefreshTimerBadge');
    if (badge) badge.textContent = 'Auto-refreshes in 60s';

    if (btn) {
      setTimeout(() => { btn.classList.remove('is-spinning'); }, 500);
    }

    if (!isAuto) {
      showToast('Supporters & finance data refreshed live!', 'success');
    }
  };

  function startSupportersAutoRefreshEngine() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    if (countdownTimer) clearInterval(countdownTimer);

    refreshSecondsRemaining = 60;

    // 1-minute recurring poll
    autoRefreshTimer = setInterval(() => {
      window.refreshSupportersData(true);
    }, 60000);

    // 1-second countdown display updater
    countdownTimer = setInterval(() => {
      refreshSecondsRemaining--;
      if (refreshSecondsRemaining < 0) refreshSecondsRemaining = 60;

      const badge = document.getElementById('supportersRefreshTimerBadge');
      if (badge) {
        badge.textContent = `Auto-refreshes in ${refreshSecondsRemaining}s`;
      }

      const timeTag = document.getElementById('supportersLastSyncBadge');
      if (timeTag) {
        const secAgo = Math.floor((Date.now() - lastSyncTimestamp) / 1000);
        if (secAgo < 5) {
          timeTag.textContent = 'Last synced: Just now';
        } else if (secAgo < 60) {
          timeTag.textContent = `Last synced: ${secAgo}s ago`;
        } else {
          timeTag.textContent = `Last synced: ${Math.floor(secAgo / 60)}m ago`;
        }
      }
    }, 1000);
  }

  function renderSupportersTable() {
    const tbody = document.getElementById('supportersTableBody');
    if (!tbody) return;

    if (!Array.isArray(supportersData)) supportersData = [];
    supportersData = supportersData.filter(s => s && s.id !== 'sup_initial_01' && s.name !== 'Marcus Vance');

    // 1. Timeframe filter
    const timeframeSupporters = supportersData.filter(s => isWithinTimeframe(s.timestamp, currentSupportersTimeframe));

    // 2. Metrics calculation based on selected timeframe
    let totalUSD = 0;
    const uniqueBackers = new Set();
    let visibleBackersCount = 0;

    timeframeSupporters.forEach(s => {
      const amt = Number(s.amount) || 0;
      let usdVal = amt;
      if (s.currency === 'INR') usdVal = amt / 85;
      else if (s.currency === 'EUR') usdVal = amt / 0.92;
      else if (s.currency === 'GBP') usdVal = amt / 0.78;

      totalUSD += usdVal;

      if (s.hidden !== true) {
        visibleBackersCount++;
        const idKey = (s.name || '').trim().toLowerCase() || s.id;
        uniqueBackers.add(idKey);
      }
    });

    const totalEl = document.getElementById('metricTotalCollection');
    const countEl = document.getElementById('metricSupportersCount');
    const breakdownEl = document.getElementById('metricTotalBreakdown');
    const backersSubtext = document.getElementById('metricBackersSubtext');

    if (totalEl) totalEl.textContent = '$' + totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (countEl) countEl.textContent = uniqueBackers.size;

    const tfLabels = {
      weekly: 'Past 7 days',
      monthly: 'Past 30 days',
      all: 'All-time (Yearly)'
    };
    const tfLabel = tfLabels[currentSupportersTimeframe] || 'All-time';

    if (breakdownEl) {
      breakdownEl.textContent = `${tfLabel} • ${timeframeSupporters.length} contribution${timeframeSupporters.length === 1 ? '' : 's'}`;
    }
    if (backersSubtext) {
      backersSubtext.textContent = `${uniqueBackers.size} unique donor${uniqueBackers.size === 1 ? '' : 's'} (${visibleBackersCount} visible)`;
    }

    updateLeaderboardMetricStatus();

    // 3. Search query filter
    const searchVal = (document.getElementById('supporterSearchInput')?.value || '').toLowerCase().trim();
    let filtered = timeframeSupporters.filter(s => {
      if (!searchVal) return true;
      const name = (s.name || '').toLowerCase();
      const note = (s.note || '').toLowerCase();
      return name.includes(searchVal) || note.includes(searchVal);
    });

    // 4. Sort by amount descending (highest sponsor first)
    filtered.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));

    if (filtered.length === 0) {
      if (supportersData.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; color: var(--admin-muted); padding: 44px 20px;">
              <div style="font-size: 26px; margin-bottom: 8px;">🌱</div>
              <strong style="color: var(--admin-ink); font-size: 14.5px;">No supporters recorded yet</strong>
              <p style="margin: 6px 0 0; font-size: 12.5px;">Real donor contributions will appear here live as they arrive.</p>
            </td>
          </tr>`;
      } else {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; color: var(--admin-muted); padding: 36px 20px;">
              No supporter records found matching "${escapeHtml(searchVal || tfLabel)}".
            </td>
          </tr>`;
      }
      return;
    }

    tbody.innerHTML = filtered.map((s, idx) => {
      const isHidden = s.hidden === true;
      const currencySymbol = s.currency === 'INR' ? '₹' : (s.currency === 'EUR' ? '€' : (s.currency === 'GBP' ? '£' : '$'));
      const formattedAmt = Number(s.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const dateStr = new Date(s.timestamp || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

      return `
        <tr style="${isHidden ? 'opacity: 0.45;' : ''}">
          <td><strong>#${idx + 1}</strong></td>
          <td>
            <strong>${escapeHtml(s.name || 'Anonymous Supporter')}</strong>
            ${s.note ? `<br><small style="color:var(--admin-muted);font-style:italic;">"${escapeHtml(s.note)}"</small>` : ''}
          </td>
          <td>
            <span style="font-weight: 800; color: var(--admin-lime);">
              ${currencySymbol}${formattedAmt} <small style="font-size:10.5px; opacity:0.8;">${s.currency || 'USD'}</small>
            </span>
          </td>
          <td><span class="platform-status-tag status-live">${escapeHtml(s.badge || 'Supporter')}</span></td>
          <td>${dateStr}</td>
          <td>
            <button class="table-btn" onclick="toggleHideSupporter('${s.id}')">
              ${isHidden ? 'Unhide' : 'Hide'}
            </button>
            <button class="table-btn danger" onclick="deleteSupporter('${s.id}')">
              Delete
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.toggleHideSupporter = function (id) {
    const item = supportersData.find(s => s.id === id);
    if (item) {
      item.hidden = !item.hidden;
      saveSupportersData();
      showToast(item.hidden ? 'Supporter hidden from public board' : 'Supporter unhidden', 'info');
    }
  };

  window.deleteSupporter = function (id) {
    if (confirm('Delete this supporter record permanently?')) {
      supportersData = supportersData.filter(s => s.id !== id);
      saveSupportersData();
      showToast('Record deleted', 'info');
    }
  };

  window.addManualSupporter = function () {
    const name = prompt('Supporter Name:');
    if (!name || !name.trim()) return;
    const amountStr = prompt('Contribution Amount (USD):', '25');
    if (amountStr === null) return;
    const amount = parseFloat(amountStr) || 25;
    const note = prompt('Optional Message / Note:') || '';

    const newSup = {
      id: 'sup_manual_' + Date.now(),
      name: name.trim(),
      amount: amount,
      currency: 'USD',
      badge: amount >= 50 ? 'Patron' : (amount >= 15 ? 'Backer' : 'Supporter'),
      note: note.trim(),
      timestamp: Date.now(),
      platform: 'web',
      verified: true,
      hidden: false
    };

    supportersData.unshift(newSup);
    saveSupportersData();
    showToast(`Added manual sponsor ${newSup.name} ($${newSup.amount})!`, 'success');
  };

  window.exportSupportersCSV = function () {
    if (!supportersData || supportersData.length === 0) {
      alert('No supporter records to export.');
      return;
    }
    let csv = 'ID,Name,Amount,Currency,Badge,Date,Note,Hidden\n';
    supportersData.forEach(s => {
      const d = s.timestamp ? new Date(s.timestamp).toISOString() : '';
      csv += `"${s.id}","${(s.name||'').replace(/"/g, '""')}",${s.amount},"${s.currency||'USD'}","${s.badge||'Supporter'}","${d}","${(s.note||'').replace(/"/g, '""')}",${s.hidden ? 'true' : 'false'}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pixkit_supporters_${Date.now()}.csv`;
    a.click();
    showToast('Supporters CSV exported!', 'success');
  };

  window.filterSupportersTable = function () {
    renderSupportersTable();
  };

  // =========================================================================
  // 7. Utilities & Toast Notifications
  // =========================================================================

  function showToast(msg, type = 'info') {
    let toast = document.getElementById('adminToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'adminToast';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9999999;
        background: #D7F36A;
        color: #121310;
        padding: 12px 22px;
        border-radius: 12px;
        font-weight: 800;
        font-size: 13.5px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        transition: opacity 0.3s ease;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 3000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  function initDashboard() {
    loadEcosystemState();
    initFirebaseSupportersSync();
    loadSupportersData();
    startSupportersAutoRefreshEngine();
  }

  // =========================================================================
  // Initialize on load
  // =========================================================================

  document.addEventListener('DOMContentLoaded', () => {
    if (checkSessionAuth()) {
      const lock = document.getElementById('adminLockScreen');
      if (lock) lock.style.display = 'none';
      initDashboard();
    } else {
      const lock = document.getElementById('adminLockScreen');
      if (lock) lock.style.display = 'flex';
    }
  });

})();

