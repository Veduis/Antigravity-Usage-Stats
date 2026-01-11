# Technical Specification: AI Quota Dashboard VS Code Extension

## 1. Overview

### 1.1 Purpose
This extension provides a customizable dashboard for monitoring usage quotas of AI models (inspired by Google Antigravity AI models) directly within Visual Studio Code. It allows developers to track quota consumption, reset times, and remaining capacities in real-time, helping to optimize AI API usage during development workflows. The extension emphasizes security, privacy, and user control, avoiding any untrusted code from external sources.

**Key inspirations from the reference extension ("Antigravity Cockpit"):**
*   
*   Dashboard-style quota monitoring.
* Exenstion will be named Antigravity Stats
*   Support for multiple display modes (e.g., visual dashboard and keyboard-friendly quick pick).
*   Integration with VS Code's status bar for at-a-glance updates.
*   Grouping of models by shared quota pools.
*   Notifications for low quotas.
Multilingual support (expandable to more languages).


### This custom version introduces UI enhancements for better usability, accessibility, and visual appeal, while being built from scratch to ensure trustworthiness.
*   ****
*   **In Scope: Quo**ta monitoring via local or authorized remote sources, UI-driven interactions, basic automation for quota resets, and configuration options.
Out of Scope: Direct AI model invocation (focus only on monitoring), advanced analytics (e.g., usage forecasting), or integration with non-AI quota systems without extension.
### 
*   
*   Developers using AI APIs in VS Code.
*   Users concerned with quota` manage`ment for cost control and efficiency.
Supports VS Code versions ^1.90.0.
### 
*   
*   Assumes access to AI API quotas via a local client process or authorized remote API (e.g., similar to Google APIs).
*   No internet access required for local monitoring; optional for remote.
*   Extension must handle network failures gracefully with fallbacks.
*   Multilingual support limited to user-configured languages (initially English, with hooks for others).
Built using TypeScript for VS Code Extension API compatibility.
---

## 

### 2. Features
*   ****
    *   Quota Monitoring:
    *   Fetch and display remaining quota percentage, countdown timer to reset, and exact reset time.
*   ****
    *   Display Modes:
    *   Webview-based dashboard for visual interaction.
*   ****
    *   Grouping and Customization:
    *   Auto-group models by quota pools.
    *   Manual renaming of models or groups.
*   ****
    *   Status Bar Integration:
    *   Customizable display formats (e.g., icon, percentage, color-coded dots).
*   ****
    *   Notifications:
    *   Alerts for quotas below configurable warning/critical thresholds.
*   ****
    *   Account Management:
    *   Support for multiple accounts with secure swi`tching.`
*   ****
    *   Logging and Diagnostics:
*   **  **
    *   Auto Wake-up/Automation:
    *   Scheduled tasks to "wake" models and trigger quota resets (e.g., via cron-like scheduling).
Supports daily, weekly, or interval-based triggers.
### 
*   ****
    *   Enhanced Dashboard Layout:.
*   Use a responsive grid system in the webview for better scalability .
odnr*   Iduce collapsible sections for user profile, settings, anser``.
*****
    *   Improved Accessibility:
*   ARIA labels and keyboard navigation for all UI elements (e.g., drag-and-drop via keyboard shortcuts).
    *   High-contrast mode support, syncing with VS Code themes.
*   ****
    *   Visual Upgrades:
    *   Modern card designs we(e.g., fade-in on refresh, hover effects).
    *   Customizable themes (e.g., allow users to override colors for cprogress bars)..
*****
    *   Sidebar Integration:.
*****
    *   Settings and Profile Panels:
    *   Inline editable fields for faster confthresh/rly in dashboard).
*   ****
l   *   Sar Enhancements:frarge
    *   Add search/filter bar to quickly find mode
One-click export of quota data to JSON/CSV for external analysis.
### 
*   
*   No automatic data sharing; all fetches require explicit user authorization.
*   Local monitoring reads from user-controlled processes only.
*   Desensitize sensitive info (e.g., user IDs) in displays.
No telemetry without opt-in.
---

## 

### 3. Architecture
*   ****
    *   Extension Host (TypeScript):
    *   Manages activation, commands, and providers (e.g., status bar, webview).
*   ****
    *   Webview Panel:
    *   Renders HTML/CSS/JS for dashboard usi`ng VS Code `.
*WiP****
    *   QuickPick Provider:keybardcentrc
*   ****
    *   **Data Layer:**
    *   **Quota Fetc**her: Polls local process or remote API at configurable intervals.
*   ****
    *   Storage:uration
    *   `VS Code globa`l/workspace state for configs.
SecretStorage for credentials.
### 
1.  
2.  User activates dashboard via command or status bar.
3.  Extenis sion fetches quota data (local/remote).the 
4.  Data processed (grouped, sorted) and seUI layer.the 
5.  UI renders visuals; user interactions (e.g., pin, rename) update state.
6.  Notifications triggered on threshold breaches.
Scheduled tasks run in background to wake models.
---
mote failure).
##l

### 4. UI Design4.1 Webview Dashboard
*   ****
*   **Layout** Soolbar (refresh, toggle group, searcMain grid of cardG/groups. BoYtom status/fooRer with account info.
*   **Cards: **Each shows model name, progress bar/ring (enhanced with.
*  i**Charts: Small** line chart pe last 24h usage (data from logs).
Interactions: Drag-and-drop (with keyboard alt), context menus, inline edits.
### 4.2 QuickPick Mode
*   
*   List-based with sections for groups.
*   Enhanced with e implementedmojis for status (e.g., ✅ for healthy).
Toolbar buttons as QuickPick items.
###  / Themes4.3 Status Bar
*   **Status Bar:** ; tlickable item opens dashboTooltips show full details.
***:**  using mync with VS eme (light/dark).

---
Media queries in CSS for adaptive layouts.
## 

###5. Implementatio5.1 Technologies
*   ****
*   **Language: Typ**e`Script`.``````
*   **Dependencies**:` vscode` (AP`I), nod`remote API), cron (for scheduling), chart.js (webview-only).
Build Tools: esbuild or webpack for bundling.
### 5.2 Key APIs
*   ****CW``````
*   **VS Code: Exten**sion API (commands, webviews, statusBarItem, QuickPick, SecretStorage).
Data Fetching: Custom parsers for local logs or HTTP clients for remote.
### 5.3 Development Steps
1.  ``
2 Set up package.json withWactivation events (e.g., onCommand).
3.  Implement providers for webview and QuickPick.
4.  Create data fetch logic with pollS/CSing.
5.  Add UI scripts iwHT
5.4 Testing
---

##6. Configuration Options

|  |  |  |  |
| :--- | :--- | :--- | :--- |
| `` |  | `` | ```` |
| `` |  | `` | - |
| `` |  | `` |  |
| `` |  | `` |  |
| `` |  | `` |  |
| `` |  | `` |  |
| ``|  | `` |  |
| `` |  | `` |  to status bar |
| `` |  | `` |  |
| `` |  | `` | `` |

---

## SettingTypeDefaultDescriptiondisplayModestring"webview""webview" or "quickpick"refreshIntervalnumber120Seconds between auto-refreshes (min 10, max 3600)statusBarFormatstring"dot-percent"Options: "icon", "dot", "percent", "dot-percent", "name-percent", "full"groupingEnabledbooleantrueAuto-group by quota poolswarningThresholdnumber30Yellow alert at this %criticalThresholdnumber10Red alert at this %notificationEnabledbooleantrueShow quota alertspinnedModelsarray[]Models to pinautoWakeSchedulestring""Cron expression for wake-upsthemeOverridesobject{}Custom colors (e.g., { progressGreen: "#00ff00" })
7. Commands
*   ``S``
*   `aiQuotaDashboard.open: O`pen dashboard (shortcut: Ctrl+Shift+Q).
*   `aiQuotaDashboard.refresh:` Manual refresh.
*   `aiQuotaDashboard.openLogs: `View logs.
*   `aiQuotaDashboard.switchMode: Toggl`e display mode.

---
aiQuotaDashboard.configureAutoWake: Set up scheduling.
## 
8. Deployment and Maintenance
*   **gin:**
*   **Package as **VSIX for intion.
*   **Versioning:** Semantic (
*   **Reposito**ry: Private Git for development.ptes: Focus on bug fixes, new AI model support, and further UI refinements based on user feedback.
4.6s