# Changelog

All notable changes to the Antigravity Usage Stats project will be documented in this file.

---

## [2026-06-25] - Version 0.4.1

### 🐛 Bug Fixes
- **Fixed QuickPick Dashboard ReferenceError**: Resolved the `"Cannot access 'config' before initialization"` error that was thrown when clicking the "models/usage" status bar item (which executes the `showQuotas` command). This reference error was previously intercepted by the command error handler and displayed to the user as a generic "Antigravity usage stats configuration error please check your settings" error. The fix initializes the `config` variable at the start of the `buildItems()` method in [quickPick.ts](file:///home/vedupro/Desktop/Dev/Software%20Dev/AntiGravityUsageStats/Antigravity-Usage-Stats/src/ui/quickPick.ts).

## [2026-05-27] - Version 0.4.0 — Full Audit Overhaul

### 🔴 Windows Bug Fixes
- **Fixed port discovery on non-admin accounts**: `Get-NetTCPConnection` now runs in parallel with netstat; results are merged so non-admin systems always get ports
- **Fixed `findstr` PID over-matching**: Now uses `/E` flag to match PID at end-of-line only (prevents port `12345` matching PID `123`)
- **Replaced WMIC fallback with tasklist**: WMIC is removed in Windows 11 23H2+; new fallback uses `tasklist /FI` + per-PID PowerShell query
- **Added `maxBuffer: 10MB` to all `execAsync` calls**: Prevents overflow with multiple VS Code instances
- **Added `-ExecutionPolicy Bypass` to ALL PowerShell commands**: Was previously missing from port discovery command

### 🟡 Cross-Platform Fixes
- **macOS now checks `isAntigravityProcess()`**: Prevents connecting to Codeium's language server instead of Antigravity's
- **Linux now checks `isAntigravityProcess()`**: Same fix for dual-install (Codeium + Antigravity) users
- **Linux ss+grep fix**: Added `|| true` so grep exit code 1 (no match) no longer throws; lsof fallback runs in same command
- **Connection stale detection**: After 2+ consecutive failures, auto-reconnect is scheduled with exponential backoff (handles laptop sleep/resume)
- **macOS uses `pgrep -fl`** instead of fragile `ps aux | grep` pipe

### 🟢 New Features
- **Smart Out-of-the-Box Auto-Pinning**: If the user hasn't configured any pinned models yet (first activation), the extension will automatically pin the top 3 discovered active models to the status bar, making it work instantly without configuration.
- **Unified Multi-Select Pin Manager**: The previous separate (and confusing) "Pin Model" and "Unpin Model" screens have been replaced by a beautiful unified Checklist selector. Users can check/uncheck all active models in one view to update their status bar pins at once.
- **Prompt Credits tracking (Optional/Disabled by default)**: Parses `availablePromptCredits` / `monthlyPromptCredits` from API. Since these fields are prone to cache delays or legacy placeholder limits (like 500/50,000) supplied by the local language server, this feature is disabled by default to guarantee 100% accurate data out-of-the-box, but can be enabled in settings if desired.
- **Reconnect command** (`Antigravity Usage Stats: Reconnect`): Clears cached process info and re-detects; essential after sleep/resume
- **Export command** (`Antigravity Usage Stats: Export Quota Data`): Export to JSON or CSV
- **Status bar loading/error states**: Shows `$(sync~spin)` while connecting, `$(error)` on error, `$(debug-disconnect)` when disconnected
- **Inline pin toggle**: Click a model in QuickPick to instantly toggle its pin status — menu stays open
- **Absolute reset times**: All reset displays now show "3h 24m (22:30)" format instead of countdown only
- **`enabled` setting**: Toggle all quota tracking on/off without uninstalling

### ⚙️ Settings Overhaul
- Added `enabled` toggle
- Added `showPromptCredits` option
- Removed broken `statusBarFormat` setting (was never read by code)
- All descriptions now use `markdownDescription` with examples
- Threshold descriptions clarified: alerts trigger when quota falls *below* the value

### 🗑️ Dead Code Removal
- Removed `httpClient.ts` from data barrel (was unused — `antigravityClient` uses raw Node.js http/https)
- `notificationManager.initialize()` now properly called from `extension.ts`
- Dashboard now uses `postMessage` for live updates instead of full HTML regeneration (fixes flicker)

---

## [2026-05-26] - Version 0.3.5 — Windows Tracking Fixes

### 🐛 Bug Fixes (Windows)
- **Fixed process name arch suffix**: Windows binary is always `_x64` (ARM64 Windows runs via emulation); previously could search for a non-existent `_arm` binary
- **Fixed IPv6 localhost matching in netstat fallback**: Regex now matches `[::1]` in addition to `[::]`, fixing port discovery on systems where the language server binds to IPv6 localhost
- **Added `-ExecutionPolicy Bypass` to PowerShell commands**: Prevents failures on locked-down Windows environments
- **Added connection retry logic**: `connect()` now retries up to 2 times with 500ms delay, handling race conditions during IDE startup or process restarts


---

## [2026-05-22] - Version 0.3.4

### 🎨 Extension Branding Update
- **Updated Extension Logo**: Replaced the legacy branding with a modern, high-contrast minimalist dark logo matching the new Antigravity IDE design language.
