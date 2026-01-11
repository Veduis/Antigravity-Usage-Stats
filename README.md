# Antigravity Stats

A VS Code extension for tracking AI model quota usage in the Antigravity IDE.

## What It Does

Connects to your local Antigravity language server and displays real-time quota information for all your AI models. See at a glance how much quota you have left and when it resets.

## Features

- Live quota tracking from the Antigravity language server
- Status bar indicators for individual models
- Dashboard view with all models grouped by pool
- Warning and critical threshold alerts
- Export quota data to JSON or CSV
- Per-model status bar toggles

## Installation

### From VSIX

1. Download the `.vsix` file from Releases
2. In VS Code: `Ctrl+Shift+P` > `Extensions: Install from VSIX`
3. Select the downloaded file

### From Source

```bash
git clone https://github.com/veduis/antigravity-stats.git
cd antigravity-stats
npm install
npm run build
```

Then press `F5` to launch Development Host, or package it:

```bash
npm run package
```

## Usage

1. Make sure Antigravity is running
2. The extension auto-connects to the local language server
3. Click "Usage" in the status bar to open the dashboard
4. Or press `Ctrl+Shift+Q`

### Status Bar Models

To show individual models in the status bar:

1. Run `Ctrl+Shift+P` and type "Select Status Bar Models"
2. Check the models you want to display
3. Click OK

Each selected model shows as a separate item with a status dot and percentage.

## Configuration

| Setting             | Default | Description                  |
| ------------------- | ------- | ---------------------------- |
| `statusBarModels`   | `[]`    | Models to show in status bar |
| `refreshInterval`   | `120`   | Seconds between auto-refresh |
| `warningThreshold`  | `30`    | Yellow alert at this %       |
| `criticalThreshold` | `10`    | Red alert at this %          |
| `groupingEnabled`   | `true`  | Group models by quota pool   |

## How It Works

The extension finds the running Antigravity language server process, extracts the connection port and auth token from its command line, then makes HTTPS requests to fetch quota data. All data stays local.

## Requirements

- Antigravity IDE must be running
- VS Code 1.90.0 or higher

## Troubleshooting

### "Could not register service worker" Error

If you see an error like "Could not register service worker: InvalidStateError" when opening the dashboard, this is a known VS Code issue, not a problem with this extension.

**Quick Fixes:**

1. **Restart VS Code completely**
   - Close ALL VS Code windows
   - On Linux/Mac: Run `killall code` in terminal (may need to repeat)
   - On Windows: End all "Code.exe" processes in Task Manager
   - Relaunch VS Code

2. **Clear VS Code cache**
   - Linux: Delete contents of `~/.config/Code/Cache`, `CachedData`, and `GPUCache`
   - Windows: `%APPDATA%\Code\Cache`, `CachedData`, and `GPUCache`
   - macOS: `~/Library/Application Support/Code/Cache`, `CachedData`, and `GPUCache`

3. **Use QuickPick mode as fallback**
   - Run `Ctrl+Shift+P` → "Antigravity Stats: Switch Display Mode"
   - This switches to a keyboard-friendly list view that doesn't use webviews

## License

MIT
