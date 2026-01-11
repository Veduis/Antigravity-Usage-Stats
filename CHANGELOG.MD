# Changelog

All notable changes to the Antigravity Usage Stats project will be documented in this file.

---

## [2026-01-11] - Version 0.2.1

### Models & Usage Stats

- **Updated Model List**: Added support for newer models (Claude 3.5 Sonnet, Claude 3 Opus, Gemini 2.0 Flash, GPT-4o, etc.) and removed deprecated ones.
- **Accurate Quota Tracking**: Improved mock data and status bar abbreviations to reflect real-world model usage.

### UX Improvements

- **Status Bar Settings**: Changed `pinnedModels` to `statusBarModels`. Now supports a checkbox-style selection in settings for easier configuration.
- **Branding Update**: Renamed all instances of "Antigravity Stats" to "Antigravity Usage Stats" for consistency.
- **Config Key Update**: Updated all configuration keys to use `antigravityUsageStats` prefix (e.g., `antigravityUsageStats.statusBarModels`).

### Bug Fixes

- Fixed linting errors in status bar provider.
- Resolved configuration inconsistencies.

---

## [2026-01-11] - Release Candidate (v0.1.0)

### Real Data Integration ✅

- **src/data/antigravityClient.ts** - Successfully reverse-engineered Antigravity language server connection
- Automatically discovers local server port, extracts CSRF token, and fetches real user status
- Reliable fallback to mock data when Antigravity is not active

### UI & UX Polish ✅

- **Clean Aesthetic** - Removed high-contrast gradients and glows for a premium, native VS Code feel
- **Multi-select Picker** - Added `antigravityStats.selectStatusBarModels` for easy status bar configuration
- **Abbreviated Names** - Improved status bar display for better readability in tight spaces

### Release Engineering ✅

- **create-public-release.sh** - Automated script to generate a clean `PUBLIC` folder for GitHub
- **README.md** - Written simple, clear public documentation (no AI tropes, no em dashes)

**Project Progress: 100%** (39/39 tasks complete)

- Gemini 2.5 Ultra (DeepMind Antigravity)

---

### Phase 2: Core Infrastructure ✅

- **src/services/logger.ts** - Centralized logging with log levels and timestamps
- **src/services/errorHandler.ts** - Error categorization, user notifications, recovery strategies
- **src/services/stateManager.ts** - Global/workspace state persistence
- **src/services/credentialManager.ts** - Secure credential storage using SecretStorage API
- **src/services/commandRegistry.ts** - Command registration with error handling wrapper

### Phase 3: Data Layer ✅

- **src/data/models.ts** - Comprehensive data models for quotas, groups, accounts
- **src/data/quotaFetcher.ts** - Local/remote/mock data fetching with caching
- **src/data/quotaGrouper.ts** - Auto-grouping by quota pools with aggregate calculations
- **src/data/pollingManager.ts** - Configurable periodic polling with listener pattern
- **src/data/httpClient.ts** - HTTP client with timeout handling and auth support

### Phase 4: UI Components ✅

- **src/ui/statusBar.ts** - Status bar with 6 display formats and color-coded indicators
- **src/ui/dashboard.ts** - Webview dashboard with responsive grid, progress bars, VS Code theme integration
- **src/ui/quickPick.ts** - QuickPick interface with grouped sections and emoji indicators

### Phase 5: Features ✅

- **src/features/notifications.ts** - Smart notifications with escalation tracking and cooldowns
- **src/features/rename.ts** - Model/group renaming with persistence
- **src/features/export.ts** - JSON/CSV data export
- **src/features/accountManager.ts** - Multi-account support with secure switching
- **src/features/scheduler.ts** - Cron-like scheduling for auto-wake tasks

### Phase 7: Documentation 🔄

- **README.md** - Comprehensive documentation with features, installation, configuration

### Build Stats

- Final bundle size: 60.8kb (development), 118.2kb (with source maps)
- Build time: ~8ms with esbuild

**Project Progress: 79%** (31/39 tasks complete)

- Gemini 2.5 Pro (Antigravity)

---

## [2026-01-10] - Phase 1: Project Setup Complete

### Added

- **package.json** - Extension manifest with commands, keybindings, and configuration schema
- **tsconfig.json** - TypeScript configuration with strict mode
- **esbuild.config.js** - Build configuration with watch mode and production optimization
- **.eslintrc.json** - ESLint configuration with TypeScript support
- **.prettierrc** - Prettier formatting rules
- **src/extension.ts** - Main extension entry point with activation lifecycle and command stubs
- **.vscode/launch.json** - Debug configuration for Extension Development Host
- **.vscode/tasks.json** - Build, watch, and lint tasks
- **.vscode/extensions.json** - Recommended extensions

### Updated

- **.gitignore** - Added Node.js, TypeScript, and VS Code extension patterns

### Verified

- TypeScript compilation successful
- esbuild bundling working (5.5kb output in 3ms)
- ESLint passing

**Project Progress: 13%** (5/39 tasks complete)

- Gemini 2.5 Pro (Antigravity)

---

## [2026-01-10] - Initial Project Setup

### Added

- Created `TODO.md` - Comprehensive task list with 39 tasks across 7 phases:
  - Phase 1: Project Setup (5 tasks)
  - Phase 2: Core Infrastructure (6 tasks)
  - Phase 3: Data Layer (5 tasks)
  - Phase 4: UI Components (8 tasks)
  - Phase 5: Features (7 tasks)
  - Phase 6: Testing & QA (4 tasks)
  - Phase 7: Documentation & Release (4 tasks)

### Updated

- Updated `CLAUDE.md` with project progress tracking rules
- Updated `.cursorrules` with project progress tracking rules
- Updated `.windsurfrules` with project progress tracking rules
- Updated `.gemini/GEMINI.md` with project progress tracking rules

### Progress Tracking Rules Added

- AI agents must check `TODO.md` before starting work
- AI agents must update `TODO.md` after completing tasks
- AI agents must report completion percentage at session start/end

---

**Project Progress: 0%** (0/39 tasks complete)

- Gemini 2.5 Pro (Antigravity)
