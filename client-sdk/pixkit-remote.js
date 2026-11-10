/**
 * PixKit Ecosystem Remote SDK (pixkit-remote.js)
 * Drop-in client library for PixKit Web, Mobile (Capacitor), Tablet, and Desktop.
 * Checks central ecosystem state, enforces maintenance mode, feature flags, and broadcasts.
 */

(function (window) {
  'use strict';

  const DEFAULT_CONFIG_URL = '/pixkit-admin/config/ecosystem-state.json';
  const STORAGE_KEY = 'pixkit_remote_ecosystem_cache';

  const PixKitRemote = {
    state: null,
    platform: 'web', // 'web' | 'mobile'
    configUrl: DEFAULT_CONFIG_URL,
    listeners: [],

    detectPlatform: function () {
      if (window.Capacitor) {
        return 'mobile';
      }
      return 'web';
    },

    init: async function (options = {}) {
      this.platform = options.platform || this.detectPlatform();
      this.configUrl = options.configUrl || DEFAULT_CONFIG_URL;

      // Load cached state first for immediate UI
      try {
        const cached = localStorage.getItem(STORAGE_KEY);
        if (cached) {
          this.state = JSON.parse(cached);
          this.evaluateState();
        }
      } catch (_) {}

      // Fetch fresh state from endpoint
      await this.sync();

      // Poll periodically (every 60 seconds) or when returning to foreground
      setInterval(() => this.sync(), 60000);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.sync();
      });
    },

    sync: async function () {
      try {
        const res = await fetch(this.configUrl + '?t=' + Date.now());
        if (res.ok) {
          const fresh = await res.json();
          this.state = fresh;
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
          } catch (_) {}
          this.evaluateState();
          this.notifyListeners();
        }
      } catch (err) {
        // Fallback silently to cached state if network offline
      }
    },

    onUpdate: function (cb) {
      if (typeof cb === 'function') this.listeners.push(cb);
    },

    notifyListeners: function () {
      this.listeners.forEach(cb => {
        try { cb(this.state); } catch (_) {}
      });
    },

    // Check if current platform is under maintenance
    isMaintenanceActive: function () {
      if (!this.state || !this.state.maintenance) return false;
      const m = this.state.maintenance;
      if (m.global) return true;
      if (m.platforms && m.platforms[this.platform]) return true;
      return false;
    },

    // Check if a specific tool feature flag is enabled
    isFeatureEnabled: function (category, toolKey) {
      if (!this.state || !this.state.featureFlags) return true;
      const cat = this.state.featureFlags[category];
      if (cat && cat[toolKey] !== undefined) {
        return !!cat[toolKey];
      }
      return true;
    },

    // Evaluate ecosystem state and render maintenance overlay or broadcast banner if required
    evaluateState: function () {
      if (!this.state) return;

      // 1. Maintenance Check
      if (this.isMaintenanceActive()) {
        this.renderMaintenanceOverlay();
      } else {
        this.removeMaintenanceOverlay();
      }

      // 2. Broadcast Announcement Check
      if (this.state.broadcast && this.state.broadcast.enabled) {
        this.renderBroadcastBanner(this.state.broadcast);
      } else {
        this.removeBroadcastBanner();
      }
    },

    renderMaintenanceOverlay: function () {
      let overlay = document.getElementById('pixkit-maintenance-screen');
      const msg = this.state.maintenance?.message || {
        headline: 'PixKit is undergoing quick maintenance',
        body: 'We will be back shortly! All your files remain completely private and safe on your device.',
        estimatedUptime: 'A few moments'
      };

      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'pixkit-maintenance-screen';
        overlay.style.cssText = `
          position: fixed;
          inset: 0;
          z-index: 99999999;
          background: #121310;
          color: #F2F3EC;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px;
          text-align: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;
        document.body.appendChild(overlay);
      }

      overlay.innerHTML = `
        <div style="max-width: 480px; background: #1A1C16; border: 1px solid #292B23; padding: 40px 32px; border-radius: 24px; box-shadow: 0 20px 60px rgba(0,0,0,0.6);">
          <div style="width: 56px; height: 56px; border-radius: 16px; background: rgba(215, 243, 106, 0.12); color: #D7F36A; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 20px;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
            </svg>
          </div>
          <h2 style="font-size: 22px; font-weight: 800; margin: 0 0 12px; color: #FFFFFF; letter-spacing: -0.02em;">${msg.headline}</h2>
          <p style="font-size: 14px; line-height: 1.6; color: #9FA197; margin: 0 0 24px;">${msg.body}</p>
          ${msg.estimatedUptime ? `<div style="display: inline-block; padding: 6px 16px; border-radius: 999px; background: #22241D; border: 1px solid #3D4034; font-size: 12px; font-weight: 700; color: #D7F36A; margin-bottom: 20px;">Estimated return: ${msg.estimatedUptime}</div>` : ''}
          <div>
            <button onclick="PixKitRemote.sync()" style="padding: 10px 22px; border-radius: 12px; background: #D7F36A; color: #121310; font-size: 13px; font-weight: 800; border: none; cursor: pointer;">
              Check Again
            </button>
          </div>
        </div>
      `;
      document.body.style.overflow = 'hidden';
    },

    removeMaintenanceOverlay: function () {
      const overlay = document.getElementById('pixkit-maintenance-screen');
      if (overlay) {
        overlay.remove();
        document.body.style.overflow = '';
      }
    },

    renderBroadcastBanner: function (b) {
      let banner = document.getElementById('pixkit-broadcast-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'pixkit-broadcast-banner';
        banner.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 999999;
          background: #D7F36A;
          color: #121310;
          padding: 10px 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          font-size: 13px;
          font-weight: 700;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          box-shadow: 0 4px 16px rgba(0,0,0,0.15);
        `;
        document.body.prepend(banner);
      }

      banner.innerHTML = `
        <span><strong>${b.headline}:</strong> ${b.message}</span>
        ${b.actionUrl ? `<a href="${b.actionUrl}" style="background: #121310; color: #FFFFFF; padding: 4px 12px; border-radius: 999px; text-decoration: none; font-size: 11.5px; font-weight: 800;">${b.actionLabel || 'Learn More'}</a>` : ''}
        ${b.dismissible ? `<button onclick="document.getElementById('pixkit-broadcast-banner').remove()" style="background:none;border:none;cursor:pointer;font-weight:900;font-size:16px;margin-left:8px;line-height:1;">&times;</button>` : ''}
      `;
    },

    removeBroadcastBanner: function () {
      const banner = document.getElementById('pixkit-broadcast-banner');
      if (banner) banner.remove();
    }
  };

  window.PixKitRemote = PixKitRemote;
})(window);

