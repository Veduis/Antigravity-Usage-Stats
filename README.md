# Antigravity Usage Stats

A VS Code extension for tracking AI model usage quotas in the Antigravity IDE with status bar indicators and quick access.

## What It Does

Connects to your local Antigravity language server and displays real-time quota information for all your AI models. See at a glance how much quota you have left and when it resets, directly in your status bar or via a quick-access menu.

## Features

- 📊 **Live Quota Tracking** - Real-time data from the Antigravity language server
- 📌 **Status Bar Pinning** - Pin your favorite models to the status bar for instant visibility
- ⚡ **Quick Access Menu** - Keyboard-friendly QuickPick interface (`Ctrl+Shift+Q`)
- 🎨 **Color-Coded Alerts** - Visual indicators for healthy, warning, and critical quota levels
- 🔄 **Auto-Refresh** - Configurable polling intervals
- 📦 **Grouped by Pool** - Models automatically organized by quota pool

## Installation

### From VSIX

1. Download the `.vsix` file from Releases
2. In VS Code: `Ctrl+Shift+P` > `Extensions: Install from VSIX`
3. Select the downloaded file

### From Source

```bash
git clone https://github.com/veduis/antigravity-usage-stats.git
cd antigravity-usage-stats
npm install
npm run build
```

Then press `F5` to launch Development Host, or package it:

```bash
npm run package
```

## Usage

### Quick Access Menu

1. Press `Ctrl+Shift+Q` (or `Cmd+Shift+Q` on Mac)
2. Browse all your models with real-time quota information
3. Click any model to see details and pin/unpin options

### Pin Models to Status Bar

**Option 1: From Quick Access Menu**

1. Press `Ctrl+Shift+Q`
2. Select "Pin Model"
3. Choose models to display in the status bar

**Option 2: From Model Details**

1. Press `Ctrl+Shift+Q`
2. Click any model
3. Select "Pin to Status Bar"

**Option 3: Via Command**

- Run `Ctrl+Shift+P` > "Antigravity Usage Stats: Pin Model to Status Bar"

Pinned models appear in your status bar with:

- Color-coded status dot (green/yellow/red)
- Model name
- Percentage remaining

### Unpin Models

1. Press `Ctrl+Shift+Q`
2. Select "Unpin Model"
3. Choose models to remove from status bar

## Configuration

| Setting                | Default       | Description                  |
| ---------------------- | ------------- | ---------------------------- |
| `pinnedModels`         | `[]`          | Models pinned to status bar  |
| `refreshInterval`      | `120`         | Seconds between auto-refresh |
| `warningThreshold`     | `30`          | Yellow alert at this %       |
| `criticalThreshold`    | `10`          | Red alert at this %          |
| `groupingEnabled`      | `true`        | Group models by quota pool   |
| `statusBarFormat`      | `dot-percent` | Status bar display format    |
| `notificationsEnabled` | `true`        | Show quota alerts            |

## How It Works

The extension finds the running Antigravity language server process, extracts the connection port and auth token from its command line, then makes HTTPS requests to fetch quota data. All data stays local.

## Requirements

- Antigravity IDE must be running
- VS Code 1.90.0 or higher

## Commands

- **Show Quotas** (`Ctrl+Shift+Q`) - Open the quick access menu
- **Pin Model to Status Bar** - Add a model to the status bar
- **Unpin Model from Status Bar** - Remove a model from the status bar
- **Refresh Quota Data** - Manually refresh all quota information
- **Open Logs** - View extension logs for troubleshooting

## License

MIT
