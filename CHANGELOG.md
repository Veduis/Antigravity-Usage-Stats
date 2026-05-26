# Changelog

All notable changes to the Antigravity Usage Stats project will be documented in this file.

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
