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
    try {
      const res = await fetch(API_ENDPOINT + '?t=' + Date.now());
      if (res.ok) {
        ecosystemState = await res.json();
      } else {
        throw new Error('API unreachable');
      }
    } catch (err) {
      // Fallback to local storage or defaults
      try {
        const cached = localStorage.getItem('pixkit_admin_state_cache');
        if (cached) ecosystemState = JSON.parse(cached);
      } catch (_) {}
    }

    if (!ecosystemState) {
      ecosystemState = getDefaultState();
    }

    renderDashboardData();
  }

  async function saveEcosystemState() {
    try {
      // Save locally
      localStorage.setItem('pixkit_admin_state_cache', JSON.stringify(ecosystemState));

      // Post to dedicated server
      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ecosystemState)
      });

      if (res.ok) {
        showToast('Ecosystem changes synced live!', 'success');
      } else {
        showToast('Saved locally in browser cache', 'info');
      }
    } catch (err) {
      showToast('Saved to local storage cache', 'info');
    }

    renderDashboardData();
  }
  window.saveEcosystemState = saveEcosystemState;

  function getDefaultState() {
    return {
      system: { version: '1.0.0', lastUpdated: new Date().toISOString() },
      maintenance: {
        global: false,
        platforms: { web: false, mobile_android: false, mobile_ios: false, tablet: false, desktop_pc: false },
        message: {
          headline: 'PixKit is undergoing scheduled maintenance',
          body: 'Our studio is undergoing a quick engine upgrade. All local browser files remain 100% safe. Back shortly!',
          estimatedUptime: '15 minutes'
        }
      },
      featureFlags: {
        editTools: { adjust: true, filters: true, crop: true, resize: true, rotateFlip: true, blurFocus: true, drawShapes: true, addText: true },
        convertTools: { formatConverter: true, svgToPng: true, heicToJpg: true, imageToPdf: true, imageToIco: true, imageToBase64: true },
        pdfTools: { mergePdf: true, splitPdf: true, compressPdf: true, pdfToImages: true, rotatePdf: true, deletePdfPages: true },
        community: { leaderboard: true, supportModal: true, allowNewDonations: true, showTotalCollection: true }
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

    // 3. Platform Toggles
    const plats = ecosystemState.maintenance.platforms || {};
    ['web', 'mobile_android', 'mobile_ios', 'tablet', 'desktop_pc'].forEach(plat => {
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

    // 5. Feature Flags
    const flags = ecosystemState.featureFlags || {};
    ['editTools', 'convertTools', 'pdfTools', 'community'].forEach(cat => {
      const group = flags[cat] || {};
      Object.keys(group).forEach(key => {
        const cb = document.getElementById(`flag-${cat}-${key}`);
        if (cb) cb.checked = !!group[key];
      });
    });

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
    if (!ecosystemState.featureFlags[cat]) {
      ecosystemState.featureFlags[cat] = {};
    }
    ecosystemState.featureFlags[cat][key] = isEnabled;
    saveEcosystemState();
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
  // 6. Supporter & Leaderboard Moderation
  // =========================================================================

  async function loadSupportersData() {
    try {
      const res = await fetch(SUPPORTERS_API + '?t=' + Date.now());
      if (res.ok) {
        supportersData = await res.json();
      } else {
        throw new Error('API offline');
      }
    } catch (_) {
      try {
        const local = localStorage.getItem('pixkit_leaderboard_supporters_v2');
        if (local) supportersData = JSON.parse(local);
      } catch (_) {}
    }

    if (!Array.isArray(supportersData)) supportersData = [];
    renderSupportersTable();
  }

  async function saveSupportersData() {
    try {
      localStorage.setItem('pixkit_leaderboard_supporters_v2', JSON.stringify(supportersData));
      await fetch(SUPPORTERS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supportersData)
      });
    } catch (_) {}
    renderSupportersTable();
  }

  function renderSupportersTable() {
    const tbody = document.getElementById('supportersTableBody');
    const searchVal = (document.getElementById('supporterSearchInput')?.value || '').toLowerCase();
    if (!tbody) return;

    let filtered = supportersData.filter(s => {
      const name = (s.name || '').toLowerCase();
      const note = (s.note || '').toLowerCase();
      return name.includes(searchVal) || note.includes(searchVal);
    });

    // Update Metrics
    let totalUSD = 0;
    supportersData.forEach(s => {
      const amt = Number(s.amount) || 0;
      totalUSD += (s.currency === 'INR' ? amt / 85 : amt);
    });

    const totalEl = document.getElementById('metricTotalCollection');
    const countEl = document.getElementById('metricSupportersCount');
    if (totalEl) totalEl.textContent = '$' + totalUSD.toFixed(2);
    if (countEl) countEl.textContent = supportersData.length;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--admin-muted); padding: 32px;">No supporter records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((s, idx) => {
      const isHidden = s.hidden === true;
      return `
        <tr style="${isHidden ? 'opacity: 0.45;' : ''}">
          <td><strong>#${idx + 1}</strong></td>
          <td>
            <strong>${escapeHtml(s.name || 'Anonymous')}</strong>
            ${s.note ? `<br><small style="color:var(--admin-muted);font-style:italic;">"${escapeHtml(s.note)}"</small>` : ''}
          </td>
          <td>
            <span style="font-weight: 800; color: var(--admin-lime);">
              ${s.currency === 'INR' ? '₹' : '$'}${Number(s.amount).toFixed(2)} ${s.currency || 'USD'}
            </span>
          </td>
          <td><span class="platform-status-tag status-live">${s.badge || 'Supporter'}</span></td>
          <td>${new Date(s.timestamp || Date.now()).toLocaleDateString()}</td>
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
    if (!name) return;
    const amount = parseFloat(prompt('Contribution Amount (USD):', '25')) || 25;
    const note = prompt('Optional Message / Note:') || '';

    const newSup = {
      id: 'sup_manual_' + Date.now(),
      name: name,
      amount: amount,
      currency: 'USD',
      badge: amount >= 50 ? 'Patron' : (amount >= 15 ? 'Backer' : 'Supporter'),
      note: note,
      timestamp: Date.now(),
      platform: 'manual',
      hidden: false
    };

    supportersData.unshift(newSup);
    saveSupportersData();
    showToast('Manual supporter added to board!', 'success');
  };

  window.exportSupportersCSV = function () {
    if (supportersData.length === 0) {
      alert('No supporter records to export.');
      return;
    }
    let csv = 'ID,Name,Amount,Currency,Badge,Date,Note\n';
    supportersData.forEach(s => {
      csv += `"${s.id}","${(s.name||'').replace(/"/g, '""')}",${s.amount},"${s.currency}","${s.badge}","${new Date(s.timestamp).toISOString()}","${(s.note||'').replace(/"/g, '""')}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pixkit_supporters_${Date.now()}.csv`;
    a.click();
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
    loadSupportersData();
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

