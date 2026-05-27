import * as vscode from 'vscode';
import {
    logger,
    stateManager,
    credentialManager,
    commandRegistry,
    LogLevel,
} from './services';
import { pollingManager, quotaFetcher, antigravityClient } from './data';
import { statusBarProvider, quickPickProvider } from './ui';
import { notificationManager } from './features/notifications';
import { exportManager } from './features/export';

/**
 * Called when the extension is activated.
 */
export function activate(context: vscode.ExtensionContext): void {
    stateManager.initialize(context);
    credentialManager.initialize(context);
    commandRegistry.initialize(context);
    statusBarProvider.initialize(context);
    notificationManager.initialize();

    context.subscriptions.push(logger.getOutputChannel());

    logger.info('Antigravity Usage Stats activating...');
    logger.info(`VS Code version: ${vscode.version}`);

    if (context.extensionMode === vscode.ExtensionMode.Development) {
        logger.setMinLevel(LogLevel.DEBUG);
        logger.debug('Debug logging enabled (development mode)');
    }

    registerCommands();
    pollingManager.start();

    logger.info('Antigravity Usage Stats activated!');
}

export function deactivate(): void {
    logger.info('Antigravity Usage Stats deactivating...');
    pollingManager.stop();
    logger.dispose();
}

// ============================================================================
// Command Registration
// ============================================================================

function registerCommands(): void {
    commandRegistry.registerMany({
        'antigravityUsageStats.showQuotas':  showQuotas,
        'antigravityUsageStats.refresh':     refreshQuotaData,
        'antigravityUsageStats.reconnect':   reconnect,
        'antigravityUsageStats.openLogs':    openLogs,
        'antigravityUsageStats.pinModel':    pinModel,
        'antigravityUsageStats.unpinModel':  unpinModel,
        'antigravityUsageStats.export':      exportData,
    });

    logger.debug(`Registered ${commandRegistry.getRegisteredCommands().length} commands`);
}

// ============================================================================
// Command Handlers
// ============================================================================

async function showQuotas(): Promise<void> {
    await quickPickProvider.show();
}

async function refreshQuotaData(): Promise<void> {
    logger.info('Manual refresh triggered');
    await pollingManager.pollNow();
    vscode.window.showInformationMessage('✅ Antigravity Usage Stats: Quota data refreshed!');
}

/**
 * Reconnect to Antigravity (clears cached process info and re-detects).
 * Essential after laptop sleep/resume or IDE restart.
 */
async function reconnect(): Promise<void> {
    logger.info('Reconnect command triggered');
    vscode.window.showInformationMessage('$(sync~spin) Reconnecting to Antigravity...');
    await pollingManager.reconnect();
    if (antigravityClient.isConnected()) {
        vscode.window.showInformationMessage('✅ Reconnected to Antigravity!');
    } else {
        vscode.window.showWarningMessage(
            '⚠️ Could not connect to Antigravity. Is it running?',
            'View Logs'
        ).then(action => { if (action === 'View Logs') { logger.show(); } });
    }
}

function openLogs(): void {
    logger.show();
}

async function pinModel(): Promise<void> {
    await managePins();
}

async function unpinModel(): Promise<void> {
    await managePins();
}

/**
 * Unified checklist pin manager. Shows all models with checkboxes.
 */
async function managePins(): Promise<void> {
    const result = quotaFetcher.getLastResult();
    if (!result || result.quotas.length === 0) {
        const ans = await vscode.window.showWarningMessage(
            'No quota data available. Refresh first?',
            'Refresh'
        );
        if (ans === 'Refresh') { await pollingManager.pollNow(); }
        return;
    }

    const config = vscode.workspace.getConfiguration('antigravityUsageStats');
    const currentlyPinned = new Set(config.get<string[]>('statusBarModels', []));

    // Show all models with their current pin status pre-selected
    const items = result.quotas.map(q => ({
        label: q.modelName,
        description: `${Math.round(q.percentRemaining)}% remaining`,
        picked: currentlyPinned.has(q.modelName),
    }));

    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Toggle checkboxes to pin or unpin models on status bar',
        title: 'Manage Status Bar Models',
    });

    if (selected !== undefined) {
        const newPinned = selected.map(i => i.label);
        await config.update('statusBarModels', newPinned, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`📌 Updated status bar: ${newPinned.length} model(s) displayed`);
    }
}

async function exportData(): Promise<void> {
    const result = quotaFetcher.getLastResult();
    if (!result || result.quotas.length === 0) {
        const ans = await vscode.window.showWarningMessage(
            'No quota data to export. Refresh first?',
            'Refresh'
        );
        if (ans === 'Refresh') { await pollingManager.pollNow(); }
        return;
    }
    await exportManager.exportQuotaData(result.quotas);
}
