# PixKit Admin — Fleet Management & Remote Control

Central management and fleet control panel for all PixKit clients (**Web Studio**, **Mobile Apps**, **Tablet**, and **Desktop**).

---

## 🚀 Quick Start

To launch the Admin Command Center:
```bash
cd "pixkit-admin"
python3 server.py 3001
```
Then visit **http://localhost:3001** in your browser.

- **Default Master PIN**: `7492` (Customizable inside the Security Settings tab).

---

## 🌟 Core Features

1. **Global & Selective Kill Switch**:
   - One-click shutdown of all apps or selective shutdown of individual platforms (Web, Android, iOS, Tablet, Desktop).
   - Live maintenance message customizer (headline, explanation, estimated return time).

2. **Granular Tool Feature Flags**:
   - Turn individual tools (HEIC to JPG, PDF Merge, Adjust, Filters, Compress) on or off without redeploying code.

3. **Leaderboard & Financial Hub**:
   - Real-time total collections metric.
   - Supporter table moderation (hide or delete spam entries, add manual sponsors, export to CSV).

4. **In-App Broadcast Notifications**:
   - Push instant announcements or alert banners to active users across Web & Mobile.

5. **App Version Enforcer**:
   - Set minimum supported versions for mobile apps and toggle forced updates.

---

## 📱 Connecting Client Apps

In any client app (`pixkit`, `pixkit-mobile`, etc.), simply add:
```html
<script src="/pixkit-admin/client-sdk/pixkit-remote.js"></script>
<script>
  PixKitRemote.init({
    configUrl: 'http://localhost:3001/api/status'
  });
</script>
```
The SDK will automatically:
- Check ecosystem health on launch.
- Intercept and display the polite maintenance screen if maintenance mode is active.
- Display broadcast banners if enabled.

