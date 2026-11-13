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
      showToast('Welcome to PixKit Admin', 'success');
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

  window.saveNewPin = function () {
    const input = document.getElementById('newPinInput');
    const newPin = input?.value?.trim();
    if (!newPin || !/^\d{4}$/.test(newPin)) {
      alert('Please enter a valid 4-digit numeric PIN (e.g. 1234).');
      return;
    }
    try {
      localStorage.setItem(PIN_STORAGE_KEY, newPin);
      if (input) input.value = '';
      showToast('🔒 Master Security PIN updated successfully!', 'success');
    } catch (e) {
      alert('Could not save PIN to storage: ' + e.message);
    }
  };

  window.resetDefaultPin = function () {
    if (confirm('Reset master security PIN back to default (7492)?')) {
      try {
        localStorage.removeItem(PIN_STORAGE_KEY);
        const input = document.getElementById('newPinInput');
        if (input) input.value = '';
        showToast('Security PIN reset to default (7492).', 'info');
      } catch (e) {
        alert('Could not reset PIN: ' + e.message);
      }
    }
  };

  window.copySdkSnippet = function () {
    const snippet = `<script src="https://pixkit.site/js/pixkit-remote.js"><\/script>\n<script>\n  PixKitRemote.init({\n    platform: window.Capacitor ? 'mobile' : 'web'\n  });\n<\/script>`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(snippet).then(() => {
        showToast('📋 SDK integration snippet copied to clipboard!', 'success');
      });
    } else {
      showToast('Copied!', 'info');
    }
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
    const bcLabel = document.getElementById('broadcastLabel');
    const bcType = document.getElementById('broadcastType');
    const bcPlatform = document.getElementById('broadcastPlatform');
    const bcIcon = document.getElementById('broadcastIcon');
    const bcDismissible = document.getElementById('broadcastDismissible');

    if (bcToggle) bcToggle.checked = !!bc.enabled;
    if (bcHeadline && document.activeElement !== bcHeadline) bcHeadline.value = bc.headline || '';
    if (bcMessage && document.activeElement !== bcMessage) bcMessage.value = bc.message || '';
    if (bcUrl && document.activeElement !== bcUrl) bcUrl.value = bc.actionUrl || '';
    if (bcLabel && document.activeElement !== bcLabel) bcLabel.value = bc.actionLabel || '';
    if (bcType && document.activeElement !== bcType) bcType.value = bc.type || 'announcement';
    if (bcPlatform && document.activeElement !== bcPlatform) bcPlatform.value = bc.targetPlatform || 'all';
    if (bcIcon && document.activeElement !== bcIcon) bcIcon.value = bc.icon || (THEME_DEFAULT_ICONS[bc.type] || '✨');
    if (bcDismissible) bcDismissible.checked = bc.dismissible !== false;

    updateBroadcastPreview();

    // 7. Version Control Fields
    initVersionControlUI();

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

  // =========================================================================
  // Broadcast Alerts Engine & Customization
  // =========================================================================

  const THEME_DEFAULT_ICONS = {
    announcement: '✨',
    info: 'ℹ️',
    warning: '🛠️',
    urgent: '🚨',
    purple: '💜'
  };

  function updateBroadcastPreview() {
    const banner = document.getElementById('broadcastPreviewBanner');
    if (!banner) return;

    const type = document.getElementById('broadcastType')?.value || 'announcement';
    const icon = document.getElementById('broadcastIcon')?.value || THEME_DEFAULT_ICONS[type] || '✨';
    const headline = document.getElementById('broadcastHeadline')?.value || '';
    const message = document.getElementById('broadcastMessage')?.value || '';
    const url = document.getElementById('broadcastUrl')?.value || '';
    const label = document.getElementById('broadcastLabel')?.value || 'Try Now';
    const dismissible = document.getElementById('broadcastDismissible')?.checked !== false;
    const isLive = document.getElementById('broadcastToggle')?.checked || false;
    const platform = document.getElementById('broadcastPlatform')?.value || 'all';

    // 1. Update theme class
    banner.className = `broadcast-banner-mock theme-${type}`;

    // 2. Update content
    const iconEl = document.getElementById('previewBannerIcon');
    const headlineEl = document.getElementById('previewBannerHeadline');
    const messageEl = document.getElementById('previewBannerMessage');
    const btnEl = document.getElementById('previewBannerBtn');
    const btnLabelEl = document.getElementById('previewBannerBtnLabel');
    const dismissEl = document.getElementById('previewBannerDismiss');
    const platformTag = document.getElementById('previewPlatformTag');

    if (iconEl) iconEl.textContent = icon;
    if (headlineEl) {
      headlineEl.textContent = headline ? `${headline}:` : '';
      headlineEl.style.display = headline ? 'inline' : 'none';
    }
    if (messageEl) messageEl.textContent = message || 'Broadcast alert message preview...';

    if (btnEl) {
      if (url && url.trim()) {
        btnEl.style.display = 'inline-flex';
        if (btnLabelEl) btnLabelEl.textContent = label || 'Learn More';
      } else {
        btnEl.style.display = 'none';
      }
    }

    if (dismissEl) {
      dismissEl.style.display = dismissible ? 'inline-block' : 'none';
    }

    if (platformTag) {
      const platNames = { all: 'All Platforms (Web & Mobile)', web: 'Web Studio Only', mobile: 'Mobile App Only' };
      platformTag.textContent = platNames[platform] || 'All Platforms';
    }

    // 3. Status indicator
    const statusIndicator = document.getElementById('broadcastStatusIndicator');
    const statusSubtext = document.getElementById('broadcastStatusSubtext');

    if (statusIndicator) {
      if (isLive) {
        statusIndicator.innerHTML = '<span style="color: var(--admin-emerald); font-weight:800;">● Active &amp; Streaming Worldwide</span>';
      } else {
        statusIndicator.innerHTML = '<span style="color: var(--admin-amber); font-weight:800;">○ Inactive (Draft Mode)</span>';
      }
    }
    if (statusSubtext) {
      statusSubtext.textContent = isLive
        ? 'Currently streaming in real-time to active visitors across ' + (platform === 'all' ? 'Web & Mobile' : platform.toUpperCase()) + '.'
        : 'Saved as draft. Toggle switch on or click "Push Live Broadcast" to stream live.';
    }
  }
  window.updateBroadcastPreview = updateBroadcastPreview;

  window.updateBroadcastPreviewAndState = function () {
    const isLive = document.getElementById('broadcastToggle')?.checked || false;
    const headline = document.getElementById('broadcastHeadline')?.value || '';
    const message = document.getElementById('broadcastMessage')?.value || '';
    const url = document.getElementById('broadcastUrl')?.value || '';
    const label = document.getElementById('broadcastLabel')?.value || 'Learn More';
    const type = document.getElementById('broadcastType')?.value || 'announcement';
    const platform = document.getElementById('broadcastPlatform')?.value || 'all';
    const icon = document.getElementById('broadcastIcon')?.value || THEME_DEFAULT_ICONS[type] || '✨';
    const dismissible = document.getElementById('broadcastDismissible')?.checked !== false;

    if (!ecosystemState.broadcast) ecosystemState.broadcast = {};

    ecosystemState.broadcast.enabled = isLive;
    ecosystemState.broadcast.headline = headline;
    ecosystemState.broadcast.message = message;
    ecosystemState.broadcast.actionUrl = url;
    ecosystemState.broadcast.actionLabel = label;
    ecosystemState.broadcast.type = type;
    ecosystemState.broadcast.targetPlatform = platform;
    ecosystemState.broadcast.icon = icon;
    ecosystemState.broadcast.dismissible = dismissible;

    updateBroadcastPreview();
    saveEcosystemState();
  };
  window.updateBroadcast = window.updateBroadcastPreviewAndState;

  window.toggleBroadcastActive = function (isChecked) {
    if (!ecosystemState.broadcast) ecosystemState.broadcast = {};
    ecosystemState.broadcast.enabled = isChecked;
    if (isChecked) {
      ecosystemState.broadcast.id = 'broadcast_' + Date.now();
    }
    window.updateBroadcastPreviewAndState();
    showToast(isChecked ? '🚀 Broadcast alert is now LIVE worldwide!' : 'Broadcast alert turned off.', isChecked ? 'success' : 'info');
  };

  window.pushBroadcastLiveNow = function () {
    const headline = document.getElementById('broadcastHeadline')?.value?.trim();
    const message = document.getElementById('broadcastMessage')?.value?.trim();
    if (!headline && !message) {
      alert('Please enter at least a Notice Headline or Message Body before publishing.');
      return;
    }

    const toggle = document.getElementById('broadcastToggle');
    if (toggle) toggle.checked = true;

    if (!ecosystemState.broadcast) ecosystemState.broadcast = {};
    ecosystemState.broadcast.enabled = true;
    ecosystemState.broadcast.id = 'broadcast_' + Date.now();

    window.updateBroadcastPreviewAndState();
    showToast('🚀 Broadcast alert published live worldwide!', 'success');
  };

  window.resetBroadcastToDraft = function () {
    const toggle = document.getElementById('broadcastToggle');
    if (toggle) toggle.checked = false;

    if (!ecosystemState.broadcast) ecosystemState.broadcast = {};
    ecosystemState.broadcast.enabled = false;

    window.updateBroadcastPreviewAndState();
    showToast('Broadcast deactivated and saved as draft.', 'info');
  };

  window.applyBroadcastPreset = function (presetKey) {
    const presets = {
      feature: {
        type: 'announcement',
        icon: '✨',
        headline: 'New Tools Live in Studio',
        message: 'Explore brand new client-side image editing and format converter tools with zero upload limits.',
        url: '#/convert',
        label: 'Try Now'
      },
      maintenance: {
        type: 'warning',
        icon: '🛠️',
        headline: 'Scheduled Engine Maintenance',
        message: 'PixKit cloud services will undergo a brief 10-minute upgrade tonight. Local in-browser editing remains 100% safe.',
        url: '',
        label: 'Learn More'
      },
      community: {
        type: 'purple',
        icon: '📢',
        headline: 'Keep PixKit 100% Free & Open',
        message: 'We are completely serverless and private. Voluntary contributions keep our studio alive for thousands of users.',
        url: 'support',
        label: 'Support Studio'
      },
      urgent: {
        type: 'urgent',
        icon: '🚨',
        headline: 'Critical Infrastructure Advisory',
        message: 'Cloud sync is currently experiencing brief latency. All your active edits are safely preserved in local browser memory.',
        url: '',
        label: 'Status Details'
      }
    };

    const p = presets[presetKey];
    if (!p) return;

    document.getElementById('broadcastType').value = p.type;
    document.getElementById('broadcastIcon').value = p.icon;
    document.getElementById('broadcastHeadline').value = p.headline;
    document.getElementById('broadcastMessage').value = p.message;
    document.getElementById('broadcastUrl').value = p.url;
    document.getElementById('broadcastLabel').value = p.label;

    window.updateBroadcastPreviewAndState();
    showToast(`Preset "${p.headline}" applied! Review preview and click Push Live.`, 'info');
  };

  // =========================================================================
  // Version Control & Fleet Enforcement Engine
  // =========================================================================

  let currentVersionPlatform = 'mobile';

  function semverCompare(v1, v2) {
    if (!v1 || !v2) return 0;
    const p1 = String(v1).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const p2 = String(v2).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(p1.length, p2.length);
    for (let i = 0; i < len; i++) {
      const a = p1[i] || 0;
      const b = p2[i] || 0;
      if (a > b) return 1;
      if (a < b) return -1;
    }
    return 0;
  }

  function getActiveVersionPolicy() {
    if (!ecosystemState.versionControl) ecosystemState.versionControl = {};
    if (!ecosystemState.versionControl[currentVersionPlatform]) {
      ecosystemState.versionControl[currentVersionPlatform] = {
        minSupportedVersion: '1.0.0',
        latestVersion: '1.2.0',
        forceUpdate: false,
        updateUrl: currentVersionPlatform === 'mobile'
          ? 'https://play.google.com/store/apps/details?id=com.pixkit.studio'
          : 'https://pixkit.studio/download',
        notes: 'Performance improvements and new dark mode support.'
      };
    }
    return ecosystemState.versionControl[currentVersionPlatform];
  }

  function initVersionControlUI() {
    updateVersionPreview();
    renderVersionRegistryTable();
  }
  window.initVersionControlUI = initVersionControlUI;

  function updateVersionPreview() {
    const list = getVersionRegistryList();
    const latestItem = list.find(v => v.status === 'latest') || list[0] || {};
    const latestVer = latestItem.versionName || '1.0.2';
    const totalCount = list.length;

    const heroLatest = document.getElementById('heroLatestPill');
    const heroTotal = document.getElementById('heroTotalReleasesPill');
    const statusIndicator = document.getElementById('versionStatusIndicator');
    const statusSubtext = document.getElementById('versionStatusSubtext');

    if (heroLatest) heroLatest.textContent = `Latest: v${latestVer}`;
    if (heroTotal) heroTotal.textContent = `${totalCount} Official Releases`;

    if (statusIndicator) {
      statusIndicator.innerHTML = '<span style="color: var(--admin-emerald); font-weight:800;">● Live &amp; Protecting Fleet</span>';
    }
    if (statusSubtext) {
      statusSubtext.textContent = `Connected mobile clients are checked in real-time on launch. All versions managed below.`;
    }
  }
  window.updateVersionPreview = updateVersionPreview;

  window.updateVersionPreviewAndState = function () {
    const policy = getActiveVersionPolicy();
    policy.minSupportedVersion = document.getElementById('mobileMinVersion')?.value || '1.0.0';
    policy.latestVersion = document.getElementById('mobileLatestVersion')?.value || '1.2.0';
    policy.forceUpdate = document.getElementById('mobileForceUpdate')?.checked || false;
    policy.updateUrl = document.getElementById('mobileUpdateUrl')?.value || '';
    policy.notes = document.getElementById('mobileReleaseNotes')?.value || '';

    updateVersionPreview();
    saveEcosystemState();
  };
  window.updateVersionControl = window.updateVersionPreviewAndState;

  window.toggleVersionForceUpdate = function (isChecked) {
    const policy = getActiveVersionPolicy();
    policy.forceUpdate = isChecked;
    const forceToggle = document.getElementById('mobileForceUpdate');
    if (forceToggle) forceToggle.checked = isChecked;

    window.updateVersionPreviewAndState();
    showToast(isChecked ? '🚨 Force update enabled! Outdated versions will be hard-gated.' : 'Force update disabled. Updates are now recommended/soft.', isChecked ? 'warning' : 'info');
  };

  window.switchVersionPlatform = function (platformKey) {
    currentVersionPlatform = platformKey;
    initVersionControlUI();
    showToast(`Switched view to ${platformKey === 'mobile' ? 'Mobile App (Android / iOS)' : 'Desktop & Web Standalone'} policy`, 'info');
  };

  window.applyVersionPreset = function (presetKey) {
    const presets = {
      baseline: {
        min: '1.0.0',
        latest: '1.0.0',
        force: false,
        notes: 'Initial production release. All client-side tools fully operational.',
        url: 'https://play.google.com/store/apps/details?id=com.pixkit.studio'
      },
      soft_upgrade: {
        min: '1.0.0',
        latest: '1.2.0',
        force: false,
        notes: '⚡ Performance improvements, new dark mode support, and PDF rotation.',
        url: 'https://play.google.com/store/apps/details?id=com.pixkit.studio'
      },
      hard_force: {
        min: '1.2.0',
        latest: '1.2.0',
        force: true,
        notes: '🔒 Critical security update & native engine upgrade. Required to continue.',
        url: 'https://play.google.com/store/apps/details?id=com.pixkit.studio'
      }
    };

    const p = presets[presetKey];
    if (!p) return;

    const minInput = document.getElementById('mobileMinVersion');
    const latestInput = document.getElementById('mobileLatestVersion');
    const forceToggle = document.getElementById('mobileForceUpdate');
    const urlInput = document.getElementById('mobileUpdateUrl');
    const notesInput = document.getElementById('mobileReleaseNotes');

    if (minInput) minInput.value = p.min;
    if (latestInput) latestInput.value = p.latest;
    if (forceToggle) forceToggle.checked = p.force;
    if (urlInput) urlInput.value = p.url;
    if (notesInput) notesInput.value = p.notes;

    window.updateVersionPreviewAndState();
    showToast(`Applied "${presetKey.replace('_', ' ').toUpperCase()}" preset! Review preview and click Save & Publish.`, 'info');
  };

  window.saveAndPublishVersionPolicy = function () {
    window.updateVersionPreviewAndState();
    showToast('🚀 Version Policy successfully published live worldwide!', 'success');
  };

  window.runVersionSimulation = function () {
    const testVer = document.getElementById('simTestVersion')?.value?.trim() || '1.0.0';
    const policy = getActiveVersionPolicy();
    const minVer = policy.minSupportedVersion || '1.0.0';
    const latestVer = policy.latestVersion || '1.2.0';
    const force = policy.forceUpdate;

    const cmpMin = semverCompare(testVer, minVer);
    const cmpLatest = semverCompare(testVer, latestVer);

    const resultBox = document.getElementById('simResultBox');
    if (!resultBox) return;

    resultBox.style.display = 'flex';

    if (cmpMin < 0 && force) {
      resultBox.style.background = 'rgba(239, 68, 68, 0.15)';
      resultBox.style.border = '1px solid #EF4444';
      resultBox.style.color = '#EF4444';
      resultBox.innerHTML = `
        <span style="font-size: 20px;">🚨</span>
        <div>
          <strong style="display: block;">OUTCOME: HARD-LOCKED (Force Update Gate)</strong>
          <span style="font-size: 12px; color: #FCA5A5;">User on v${testVer} is strictly blocked from the app until they update to v${latestVer}. No bypass possible.</span>
        </div>
      `;
    } else if (cmpLatest < 0) {
      resultBox.style.background = 'rgba(56, 189, 248, 0.15)';
      resultBox.style.border = '1px solid #38BDF8';
      resultBox.style.color = '#38BDF8';
      resultBox.innerHTML = `
        <span style="font-size: 20px;">💡</span>
        <div>
          <strong style="display: block;">OUTCOME: SOFT UPDATE PROMPT</strong>
          <span style="font-size: 12px; color: #BAE6FD;">User on v${testVer} sees a friendly "New Update Available (v${latestVer})" prompt with an option to update or continue.</span>
        </div>
      `;
    } else {
      resultBox.style.background = 'rgba(16, 185, 129, 0.15)';
      resultBox.style.border = '1px solid #10B981';
      resultBox.style.color = '#10B981';
      resultBox.innerHTML = `
        <span style="font-size: 20px;">✅</span>
        <div>
          <strong style="display: block;">OUTCOME: FULL ACCESS (Compliant Build)</strong>
          <span style="font-size: 12px; color: #A7F3D0;">User on v${testVer} is completely up to date. App launches cleanly without any interruptions.</span>
        </div>
      `;
    }
  };

  // =========================================================================
  // 5.1 Official Releases Registry & Dedicated Per-Version Controls
  // =========================================================================

  function getVersionRegistryList() {
    if (!ecosystemState.versionRegistry) ecosystemState.versionRegistry = {};
    if (!Array.isArray(ecosystemState.versionRegistry.mobile)) {
      ecosystemState.versionRegistry.mobile = [
        {
          versionName: '1.0.2',
          versionCode: 3,
          releaseDate: '2026-11-13',
          status: 'latest',
          disabled: false,
          disabledMessage: 'This version is no longer supported. Please update on Google Play.',
          updatePrompt: {
            enabled: false,
            type: 'optional',
            title: 'PixKit 1.0.2 is Now Live',
            notes: [
              'Enhanced 3D button depth & shadows',
              'Smooth seamless page entrance & exit animations',
              'Hardware-rendered vector SVG icons in Privacy & Settings',
              'Zero web blue tap highlights'
            ],
            targetVersion: '1.0.2',
            updateUrl: 'https://play.google.com/store/apps/details?id=com.pixkit.studio'
          },
          customMessage: { enabled: false, text: '' },
          featureOverrides: {}
        },
        {
          versionName: '1.0.1',
          versionCode: 2,
          releaseDate: '2026-11-10',
          status: 'active',
          disabled: false,
          disabledMessage: 'Version 1.0.1 is no longer supported. Please update to continue.',
          updatePrompt: {
            enabled: true,
            type: 'optional',
            title: 'PixKit 1.0.2 Update Available',
            notes: [
              'Added 3D button depth and tactile press feel',
              'Optimized legal & privacy policy page',
              'Eliminated blue tap boxes and long-press highlights'
            ],
            targetVersion: '1.0.2',
            updateUrl: 'https://play.google.com/store/apps/details?id=com.pixkit.studio'
          },
          customMessage: { enabled: false, text: '' },
          featureOverrides: {}
        },
        {
          versionName: '1.0.0',
          versionCode: 1,
          releaseDate: '2026-11-01',
          status: 'deprecated',
          disabled: false,
          disabledMessage: 'Version 1.0.0 has been retired. Please update to the latest build to continue.',
          updatePrompt: {
            enabled: true,
            type: 'optional',
            title: 'New PixKit Update Available',
            notes: [
              'New PDF tools suite & format converter',
              'Enhanced performance and stability'
            ],
            targetVersion: '1.0.2',
            updateUrl: 'https://play.google.com/store/apps/details?id=com.pixkit.studio'
          },
          customMessage: { enabled: false, text: '' },
          featureOverrides: {}
        }
      ];
    }
    return ecosystemState.versionRegistry.mobile;
  }

  function renderVersionRegistryTable() {
    const list = getVersionRegistryList();
    const tbody = document.getElementById('versionRegistryTableBody');
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--admin-muted); padding: 24px;">No official releases registered yet. Click "+ Register New Official Release" to add one.</td></tr>`;
      return;
    }

    // Sort by versionCode descending (latest on top)
    list.sort((a, b) => (b.versionCode || 0) - (a.versionCode || 0));

    tbody.innerHTML = list.map(item => {
      let statusPill = '';
      if (item.disabled) {
        statusPill = `<span class="version-tag-pill pill-force" style="font-size: 11px; padding: 3px 8px;">🔴 Disabled (Killed)</span>`;
      } else if (item.status === 'latest') {
        statusPill = `<span class="version-tag-pill pill-recommended" style="font-size: 11px; padding: 3px 8px;">🟢 Latest Release</span>`;
      } else if (item.status === 'active') {
        statusPill = `<span class="version-tag-pill pill-clean" style="font-size: 11px; padding: 3px 8px;">🟡 Active</span>`;
      } else {
        statusPill = `<span class="version-tag-pill" style="font-size: 11px; padding: 3px 8px; background: rgba(255,255,255,0.06); color: var(--admin-muted);">⚪ Deprecated</span>`;
      }

      const updatePrompt = item.updatePrompt || {};
      const updateBadge = updatePrompt.enabled
        ? `<span style="color: var(--admin-lime); font-size: 12px; font-weight: 700;">🔔 Active (${updatePrompt.type === 'force' ? 'Mandatory' : 'Soft'})</span>`
        : `<span style="color: var(--admin-muted); font-size: 12px;">🔕 Off</span>`;

      const killBadge = item.disabled
        ? `<span style="color: #ef4444; font-weight: 800; font-size: 12px;">🚨 Locked</span>`
        : `<span style="color: var(--admin-emerald); font-weight: 700; font-size: 12px;">✓ Allowed</span>`;

      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <strong style="color: var(--admin-ink); font-size: 14px;">v${escapeHtml(item.versionName)}</strong>
              ${item.status === 'latest' ? '<span style="font-size: 9.5px; background: rgba(215,243,106,0.15); color: var(--admin-lime); border: 1px solid rgba(215,243,106,0.3); border-radius: 999px; padding: 1px 6px; font-weight: 800;">LATEST</span>' : ''}
            </div>
          </td>
          <td><span style="font-family: monospace; color: var(--admin-muted); font-size: 12px;">Build ${item.versionCode || 1}</span></td>
          <td style="color: var(--admin-muted); font-size: 12.5px;">${escapeHtml(item.releaseDate || 'N/A')}</td>
          <td>${statusPill}</td>
          <td>${updateBadge}</td>
          <td>${killBadge}</td>
          <td style="text-align: right;">
            <div style="display: flex; gap: 6px; justify-content: flex-end;">
              <button type="button" class="table-btn" onclick="openManageVersionModal('${escapeHtml(item.versionName)}')" style="font-size: 12px; padding: 5px 12px; font-weight: 700;" title="Configure kill-switch, update prompt, and feature flags">
                ⚙️ Manage
              </button>
              ${item.status !== 'latest' ? `
                <button type="button" class="table-btn danger" onclick="deleteVersionRelease('${escapeHtml(item.versionName)}')" style="font-size: 12px; padding: 5px 8px;" title="Delete this version entry">
                  🗑
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }
  window.renderVersionRegistryTable = renderVersionRegistryTable;

  window.openNewReleaseModal = function () {
    const modal = document.getElementById('modalNewRelease');
    if (!modal) return;
    const dateInput = document.getElementById('newReleaseDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    // Compute next suggested version
    const list = getVersionRegistryList();
    const highestBuild = list.reduce((max, cur) => Math.max(max, cur.versionCode || 0), 0);
    const codeInput = document.getElementById('newReleaseVersionCode');
    if (codeInput) codeInput.value = highestBuild + 1;

    modal.style.display = 'flex';
  };

  window.closeNewReleaseModal = function () {
    const modal = document.getElementById('modalNewRelease');
    if (modal) modal.style.display = 'none';
  };

  window.handleSaveNewRelease = function (event) {
    if (event) event.preventDefault();
    const versionName = document.getElementById('newReleaseVersionName')?.value?.trim();
    const versionCode = parseInt(document.getElementById('newReleaseVersionCode')?.value || '1', 10);
    const releaseDate = document.getElementById('newReleaseDate')?.value || new Date().toISOString().split('T')[0];
    const notesText = document.getElementById('newReleaseNotes')?.value?.trim() || '';
    const storeUrl = document.getElementById('newReleaseStoreUrl')?.value?.trim() || 'https://play.google.com/store/apps/details?id=com.pixkit.studio';
    const setLatest = document.getElementById('newReleaseSetLatest')?.checked;

    if (!versionName) {
      showToast('Version name is required.', 'warning');
      return;
    }

    const list = getVersionRegistryList();

    // Check if duplicate
    const existingIndex = list.findIndex(v => v.versionName === versionName);
    if (existingIndex >= 0) {
      showToast(`Version ${versionName} already exists. Click "Manage" on its row to edit it.`, 'warning');
      return;
    }

    // Split notes by newline
    const notesArray = notesText.split('\n').map(s => s.trim().replace(/^[-•*]\s*/, '')).filter(Boolean);

    if (setLatest) {
      // Demote current latest to active
      list.forEach(v => {
        if (v.status === 'latest') v.status = 'active';
      });
      // Also update general version policy
      if (ecosystemState.versionControl && ecosystemState.versionControl.mobile) {
        ecosystemState.versionControl.mobile.latestVersion = versionName;
        ecosystemState.versionControl.mobile.updateUrl = storeUrl;
        ecosystemState.versionControl.mobile.notes = notesText;
      }
    }

    const newRelease = {
      versionName: versionName,
      versionCode: versionCode,
      releaseDate: releaseDate,
      status: setLatest ? 'latest' : 'active',
      disabled: false,
      disabledMessage: `This version (${versionName}) is no longer supported. Please update on Google Play.`,
      updatePrompt: {
        enabled: false,
        type: 'optional',
        title: `PixKit ${versionName} is Available!`,
        notes: notesArray,
        targetVersion: versionName,
        updateUrl: storeUrl
      },
      customMessage: { enabled: false, text: '' },
      featureOverrides: {}
    };

    list.unshift(newRelease);

    saveEcosystemState();
    renderVersionRegistryTable();
    initVersionControlUI();
    closeNewReleaseModal();
    showToast(`✓ Official Release v${versionName} (Build ${versionCode}) successfully registered!`, 'success');
  };

  const ALL_TOOL_KEYS = [
    { key: 'crop', label: 'Crop Tool' },
    { key: 'resize', label: 'Resize' },
    { key: 'compress', label: 'Compress' },
    { key: 'adjust', label: 'Adjust' },
    { key: 'filters', label: 'Filters' },
    { key: 'rotateFlip', label: 'Rotate / Flip' },
    { key: 'drawShapes', label: 'Draw Shapes' },
    { key: 'addText', label: 'Add Text' },
    { key: 'formatConverter', label: 'Convert Hub' },
    { key: 'mergePdf', label: 'Merge PDF' },
    { key: 'splitPdf', label: 'Split PDF' },
    { key: 'compressPdf', label: 'Compress PDF' },
    { key: 'pdfToImages', label: 'PDF to Images' }
  ];

  window.openManageVersionModal = function (versionName) {
    const list = getVersionRegistryList();
    const item = list.find(v => v.versionName === versionName);
    if (!item) return;

    const modal = document.getElementById('modalManageVersion');
    if (!modal) return;

    document.getElementById('manageVersionModalHeading').textContent = `Managing Release: v${item.versionName} (Build ${item.versionCode || 1})`;
    document.getElementById('manageVersionOriginalName').value = item.versionName;

    // 1. Kill-Switch
    const disabledToggle = document.getElementById('manageVersionDisabled');
    const disabledMsgWrap = document.getElementById('manageVersionDisabledMsgWrap');
    const disabledMsg = document.getElementById('manageVersionDisabledMsg');
    if (disabledToggle) disabledToggle.checked = !!item.disabled;
    if (disabledMsgWrap) disabledMsgWrap.style.display = item.disabled ? 'block' : 'none';
    if (disabledMsg) disabledMsg.value = item.disabledMessage || `Version ${item.versionName} has been retired. Please update to continue creating.`;

    // 2. Update Pop-up
    const updatePrompt = item.updatePrompt || {};
    const promptToggle = document.getElementById('manageVersionUpdatePromptEnabled');
    const promptType = document.getElementById('manageVersionUpdateType');
    const promptTarget = document.getElementById('manageVersionTargetVer');
    const promptTitle = document.getElementById('manageVersionUpdateTitle');
    const promptNotes = document.getElementById('manageVersionUpdateNotes');
    const promptUrl = document.getElementById('manageVersionUpdateUrl');

    if (promptToggle) promptToggle.checked = !!updatePrompt.enabled;
    if (promptType) promptType.value = updatePrompt.type || 'optional';
    if (promptTarget) promptTarget.value = updatePrompt.targetVersion || ecosystemState.versionControl?.mobile?.latestVersion || '1.0.2';
    if (promptTitle) promptTitle.value = updatePrompt.title || `PixKit Update Available!`;
    if (promptNotes) promptNotes.value = Array.isArray(updatePrompt.notes) ? updatePrompt.notes.join('\n') : (updatePrompt.notes || '');
    if (promptUrl) promptUrl.value = updatePrompt.updateUrl || 'https://play.google.com/store/apps/details?id=com.pixkit.studio';

    // 3. Tool Overrides Grid
    const overrides = item.featureOverrides || {};
    const toolsGrid = document.getElementById('manageVersionToolsGrid');
    if (toolsGrid) {
      toolsGrid.innerHTML = ALL_TOOL_KEYS.map(tool => {
        const isAllowed = overrides[tool.key] !== false; // true unless explicitly false
        return `
          <label style="display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--admin-ink); background: rgba(0,0,0,0.25); border: 1px solid var(--admin-border); border-radius: 8px; padding: 6px 10px; cursor: pointer;">
            <input type="checkbox" class="version-tool-override-check" data-tool="${tool.key}" ${isAllowed ? 'checked' : ''} style="accent-color: var(--admin-lime); width: 14px; height: 14px;">
            <span>${tool.label}</span>
          </label>
        `;
      }).join('');
    }

    // 4. Custom Message
    const customMsg = item.customMessage || {};
    const customToggle = document.getElementById('manageVersionCustomMsgEnabled');
    const customText = document.getElementById('manageVersionCustomMsgText');
    if (customToggle) customToggle.checked = !!customMsg.enabled;
    if (customText) customText.value = customMsg.text || '';

    modal.style.display = 'flex';
  };

  window.closeManageVersionModal = function () {
    const modal = document.getElementById('modalManageVersion');
    if (modal) modal.style.display = 'none';
  };

  window.toggleManageVersionKillSwitch = function (checked) {
    const wrap = document.getElementById('manageVersionDisabledMsgWrap');
    if (wrap) wrap.style.display = checked ? 'block' : 'none';
  };

  window.handleSaveManageVersion = function (event) {
    if (event) event.preventDefault();
    const versionName = document.getElementById('manageVersionOriginalName')?.value;
    const list = getVersionRegistryList();
    const item = list.find(v => v.versionName === versionName);
    if (!item) return;

    // 1. Kill-Switch
    item.disabled = !!document.getElementById('manageVersionDisabled')?.checked;
    item.disabledMessage = document.getElementById('manageVersionDisabledMsg')?.value?.trim() || '';

    // 2. Update Prompt
    const notesStr = document.getElementById('manageVersionUpdateNotes')?.value?.trim() || '';
    const notesArray = notesStr.split('\n').map(s => s.trim().replace(/^[-•*]\s*/, '')).filter(Boolean);

    item.updatePrompt = {
      enabled: !!document.getElementById('manageVersionUpdatePromptEnabled')?.checked,
      type: document.getElementById('manageVersionUpdateType')?.value || 'optional',
      targetVersion: document.getElementById('manageVersionTargetVer')?.value?.trim() || '',
      title: document.getElementById('manageVersionUpdateTitle')?.value?.trim() || '',
      notes: notesArray,
      updateUrl: document.getElementById('manageVersionUpdateUrl')?.value?.trim() || ''
    };

    // 3. Tool Overrides
    const newOverrides = {};
    const checkboxes = document.querySelectorAll('.version-tool-override-check');
    checkboxes.forEach(cb => {
      const toolKey = cb.getAttribute('data-tool');
      if (toolKey) {
        newOverrides[toolKey] = cb.checked;
      }
    });
    item.featureOverrides = newOverrides;

    // 4. Custom Banner
    item.customMessage = {
      enabled: !!document.getElementById('manageVersionCustomMsgEnabled')?.checked,
      text: document.getElementById('manageVersionCustomMsgText')?.value?.trim() || ''
    };

    saveEcosystemState();
    renderVersionRegistryTable();
    closeManageVersionModal();
    showToast(`✓ Controls saved for Release v${versionName}!`, 'success');
  };

  window.deleteVersionRelease = function (versionName) {
    if (!confirm(`Are you sure you want to remove Release v${versionName} from the registry?`)) return;
    const list = getVersionRegistryList();
    const index = list.findIndex(v => v.versionName === versionName);
    if (index >= 0) {
      list.splice(index, 1);
      saveEcosystemState();
      renderVersionRegistryTable();
      showToast(`Release v${versionName} removed.`, 'info');
    }
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

  let currentSupportersTimeframe = 'all'; // 'all' (All-Time) | 'yearly' | 'monthly' | 'weekly'
  window.currentSupportersTimeframe = currentSupportersTimeframe;

  window.setSupportersTimeframe = function (tf) {
    currentSupportersTimeframe = tf;
    window.currentSupportersTimeframe = tf;

    ['all', 'yearly', 'monthly', 'weekly'].forEach(k => {
      const btnId = `btn-tf-${k === 'all' ? 'all' : (k === 'yearly' ? 'year' : (k === 'monthly' ? 'month' : 'week'))}`;
      const btn = document.getElementById(btnId);
      if (btn) btn.classList.toggle('active', k === tf);
    });

    renderSupportersTable();
  };

  function isWithinTimeframe(timestamp, timeframe) {
    if (!timestamp || timeframe === 'all') return true;
    const ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    if (isNaN(ts) || ts <= 0) return true;

    const now = new Date();

    if (timeframe === 'weekly') {
      // Current Calendar Week (Monday 00:00:00 to now, refreshes every Monday)
      const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const day = startOfWeek.getDay();
      const diffToMonday = (day === 0 ? -6 : 1) - day;
      startOfWeek.setDate(startOfWeek.getDate() + diffToMonday);
      startOfWeek.setHours(0, 0, 0, 0);
      return ts >= startOfWeek.getTime();
    }

    if (timeframe === 'monthly') {
      // Current Calendar Month (1st of this month 00:00:00 to now, refreshes on 1st of each month)
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return ts >= startOfMonth.getTime();
    }

    if (timeframe === 'yearly') {
      // Current Calendar Year (Jan 1 of this year 00:00:00 to now, refreshes on Jan 1)
      const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      return ts >= startOfYear.getTime();
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

      const idKey = (s.name || '').trim().toLowerCase() || s.id;
      uniqueBackers.add(idKey);
      if (s.hidden !== true) {
        visibleBackersCount++;
      }
    });

    const totalEl = document.getElementById('metricTotalCollection');
    const countEl = document.getElementById('metricSupportersCount');
    const breakdownEl = document.getElementById('metricTotalBreakdown');
    const backersSubtext = document.getElementById('metricBackersSubtext');

    if (totalEl) totalEl.textContent = '$' + totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (countEl) countEl.textContent = uniqueBackers.size;

    const now = new Date();
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const tfLabels = {
      weekly: 'This week (Refreshes Mondays)',
      monthly: `This month (${monthNames[now.getMonth()]}) • Refreshes 1st`,
      yearly: `This year (${now.getFullYear()}) • Refreshes Jan 1`,
      all: 'All-time cumulative'
    };
    const tfLabel = tfLabels[currentSupportersTimeframe] || 'All-time';

    const anonymousCount = timeframeSupporters.length - visibleBackersCount;
    if (breakdownEl) {
      breakdownEl.textContent = `${tfLabel} • ${timeframeSupporters.length} contribution${timeframeSupporters.length === 1 ? '' : 's'}${anonymousCount > 0 ? ` (${visibleBackersCount} visible on board, ${anonymousCount} anonymous)` : ''}`;
    }
    if (backersSubtext) {
      backersSubtext.textContent = `${uniqueBackers.size} unique donor${uniqueBackers.size === 1 ? '' : 's'} (${visibleBackersCount} visible on leaderboard)`;
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
        <tr style="${isHidden ? 'opacity: 0.75; background: rgba(245, 158, 11, 0.03);' : ''}">
          <td><strong>#${idx + 1}</strong></td>
          <td>
            <strong>${escapeHtml(s.name || 'Anonymous Supporter')}</strong>
            ${isHidden ? '<span class="platform-status-tag" style="margin-left: 8px; font-size: 10px; background: rgba(245, 158, 11, 0.15); color: var(--admin-amber); border-color: rgba(245, 158, 11, 0.3);">Anonymous (Unlisted)</span>' : ''}
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
            <button class="table-btn" onclick="openEditSupporterModal('${s.id}')" title="Edit supporter name, amount, badge, or note">
              Edit
            </button>
            <button class="table-btn" onclick="toggleHideSupporter('${s.id}')" title="${isHidden ? 'Show on public leaderboard' : 'Hide from public leaderboard'}">
              ${isHidden ? 'Unhide' : 'Hide'}
            </button>
            <button class="table-btn danger" onclick="deleteSupporter('${s.id}')" title="Delete permanently">
              Delete
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Calculate supporter badge based on normalized USD
  function calculateSupporterBadge(amount, currency) {
    let usd = Number(amount) || 0;
    if (currency === 'INR') usd = usd / 85;
    else if (currency === 'EUR') usd = usd / 0.92;
    else if (currency === 'GBP') usd = usd / 0.78;

    if (usd >= 50) return 'Patron';
    if (usd >= 15) return 'Backer';
    return 'Supporter';
  }

  window.openAddSupporterModal = function () {
    const overlay = document.getElementById('supporterModalOverlay');
    const form = document.getElementById('supporterModalForm');
    const title = document.getElementById('supporterModalTitle');
    if (!overlay || !form) return;

    form.reset();
    document.getElementById('modalSupporterId').value = '';
    if (title) title.textContent = '+ Add Manual Sponsor';
    document.getElementById('modalSupporterAmount').value = '25.00';
    document.getElementById('modalSupporterCurrency').value = 'USD';
    document.getElementById('modalSupporterBadge').value = 'Auto';
    document.getElementById('modalSupporterHidden').checked = false;

    overlay.style.display = 'flex';
    setTimeout(() => {
      document.getElementById('modalSupporterName')?.focus();
    }, 50);
  };
  window.addManualSupporter = window.openAddSupporterModal;

  window.openEditSupporterModal = function (id) {
    const sup = supportersData.find(s => s.id === id);
    if (!sup) return;

    const overlay = document.getElementById('supporterModalOverlay');
    const title = document.getElementById('supporterModalTitle');
    if (!overlay) return;

    document.getElementById('modalSupporterId').value = sup.id;
    if (title) title.textContent = `Edit Supporter — ${sup.name || 'Anonymous'}`;

    document.getElementById('modalSupporterName').value = sup.name || '';
    document.getElementById('modalSupporterAmount').value = Number(sup.amount) || '';
    document.getElementById('modalSupporterCurrency').value = sup.currency || 'USD';
    document.getElementById('modalSupporterBadge').value = sup.badge || 'Auto';
    document.getElementById('modalSupporterNote').value = sup.note || '';
    document.getElementById('modalSupporterHidden').checked = sup.hidden === true;

    overlay.style.display = 'flex';
    setTimeout(() => {
      document.getElementById('modalSupporterName')?.focus();
    }, 50);
  };

  window.closeSupporterModal = function () {
    const overlay = document.getElementById('supporterModalOverlay');
    if (overlay) overlay.style.display = 'none';
  };

  window.handleSupporterModalBackdrop = function (e) {
    if (e.target.id === 'supporterModalOverlay') {
      window.closeSupporterModal();
    }
  };

  window.handleSaveSupporterModal = async function (e) {
    e.preventDefault();
    const id = document.getElementById('modalSupporterId').value;
    const name = (document.getElementById('modalSupporterName').value || '').trim() || 'Anonymous Supporter';
    const amount = parseFloat(document.getElementById('modalSupporterAmount').value) || 0;
    const currency = document.getElementById('modalSupporterCurrency').value || 'USD';
    let badge = document.getElementById('modalSupporterBadge').value || 'Auto';
    if (badge === 'Auto') {
      badge = calculateSupporterBadge(amount, currency);
    }
    const note = (document.getElementById('modalSupporterNote').value || '').trim();
    const hidden = document.getElementById('modalSupporterHidden').checked;

    if (id) {
      // Editing existing supporter
      const existing = supportersData.find(s => s.id === id);
      if (existing) {
        existing.name = name;
        existing.amount = amount;
        existing.currency = currency;
        existing.badge = badge;
        existing.note = note;
        existing.hidden = hidden;
        await saveSupportersData();
        showToast(`Supporter "${name}" updated successfully!`, 'success');
      }
    } else {
      // Adding new supporter
      const newSup = {
        id: 'sup_manual_' + Date.now(),
        name: name,
        amount: amount,
        currency: currency,
        badge: badge,
        note: note,
        timestamp: Date.now(),
        platform: 'web',
        verified: true,
        hidden: hidden
      };
      supportersData.unshift(newSup);
      await saveSupportersData();
      showToast(`Added supporter "${name}" ($${amount})!`, 'success');
    }

    window.closeSupporterModal();
    renderSupportersTable();
  };

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

