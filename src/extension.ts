import * as vscode from 'vscode';
import {
    logger,
    stateManager,
    credentialManager,
    commandRegistry,
    LogLevel,
} from './services';
import { pollingManager, quotaFetcher } from './data';
import { statusBarProvider, showDashboard, quickPickProvider } from './ui';

/**
 * Called when the extension is activated.
 * Activation happens on startup (onStartupFinished) or when a command is invoked.
 */
export function activate(context: vscode.ExtensionContext): void {
    // Initialize core services
    stateManager.initialize(context);
    credentialManager.initialize(context);
    commandRegistry.initialize(context);
    statusBarProvider.initialize(context);

    // Add logger output channel to subscriptions
    context.subscriptions.push(logger.getOutputChannel());

    logger.info('Antigravity Stats extension is activating...');
    logger.info(`VS Code version: ${vscode.version}`);

    // Set log level based on development mode
    if (context.extensionMode === vscode.ExtensionMode.Development) {
        logger.setMinLevel(LogLevel.DEBUG);
        logger.debug('Debug logging enabled (development mode)');
    }

    // Register all commands
    registerCommands(context);

    // Start polling
    pollingManager.start();

    logger.info('Antigravity Stats extension activated successfully!');
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
    logger.info('Antigravity Stats extension deactivating...');
    pollingManager.stop();
    logger.dispose();
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Registers all extension commands.
 */
function registerCommands(context: vscode.ExtensionContext): void {
    commandRegistry.registerMany({
        'antigravityStats.openDashboard': () => openDashboard(context),
        'antigravityStats.refresh': refreshQuotaData,
        'antigravityStats.openLogs': openLogs,
        'antigravityStats.switchMode': switchDisplayMode,
        'antigravityStats.configureAutoWake': configureAutoWake,
        'antigravityStats.selectStatusBarModels': selectStatusBarModels,
    });

    logger.debug(`Registered ${commandRegistry.getRegisteredCommands().length} commands`);
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Opens the quota dashboard.
 */
async function openDashboard(context: vscode.ExtensionContext): Promise<void> {
    logger.info('Opening dashboard...');
    const config = vscode.workspace.getConfiguration('antigravityStats');
    const displayMode = config.get<string>('displayMode', 'webview');

    if (displayMode === 'quickpick') {
        await quickPickProvider.show();
    } else {
        showDashboard(context);
    }
}

/**
 * Refreshes quota data from the data source.
 */
async function refreshQuotaData(): Promise<void> {
    logger.info('Refreshing quota data...');
    await pollingManager.pollNow();
    vscode.window.showInformationMessage('Antigravity Stats: Quota data refreshed!');
}

/**
 * Opens the extension logs in the output channel.
 */
function openLogs(): void {
    logger.info('Opening logs...');
    logger.show();
}

/**
 * Switches between display modes (webview/quickpick).
 */
async function switchDisplayMode(): Promise<void> {
    const config = vscode.workspace.getConfiguration('antigravityStats');
    const currentMode = config.get<string>('displayMode', 'webview');
    const newMode = currentMode === 'webview' ? 'quickpick' : 'webview';

    await config.update('displayMode', newMode, vscode.ConfigurationTarget.Global);
    logger.info(`Switched display mode from ${currentMode} to ${newMode}`);
    vscode.window.showInformationMessage(`Antigravity Stats: Display mode set to ${newMode}`);
}

/**
 * Opens configuration for auto-wake scheduling.
 */
async function configureAutoWake(): Promise<void> {
    logger.info('Opening auto-wake configuration...');
    const config = vscode.workspace.getConfiguration('antigravityStats');
    const currentSchedule = config.get<string>('autoWakeSchedule', '');

    const schedule = await vscode.window.showInputBox({
        prompt: 'Enter cron expression for auto wake-up (leave empty to disable)',
        value: currentSchedule,
        placeHolder: 'e.g., 0 9 * * * (daily at 9am)',
    });

    if (schedule !== undefined) {
        await config.update('autoWakeSchedule', schedule, vscode.ConfigurationTarget.Global);
        logger.info(`Auto-wake schedule updated: ${schedule || 'disabled'}`);
        vscode.window.showInformationMessage(
            schedule
                ? `Antigravity Stats: Auto-wake scheduled: ${schedule}`
                : 'Antigravity Stats: Auto-wake disabled'
        );
    }
}

/**
 * Opens a multi-select picker for choosing which models to show in the status bar.
 */
async function selectStatusBarModels(): Promise<void> {
    logger.info('Opening status bar model selector...');

    // Get current quota data
    const result = quotaFetcher.getLastResult();
    if (!result || result.quotas.length === 0) {
        vscode.window.showWarningMessage('No quota data available. Try refreshing first.');
        return;
    }

    // Get currently selected models
    const config = vscode.workspace.getConfiguration('antigravityStats');
    const currentlySelected = new Set(config.get<string[]>('statusBarModels', []));

    // Create QuickPick items for each model
    const items: vscode.QuickPickItem[] = result.quotas.map(quota => ({
        label: quota.modelName,
        description: `${Math.round(quota.percentRemaining)}% remaining`,
        picked: currentlySelected.has(quota.modelName),
    }));

    // Show multi-select picker
    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Select models to show in status bar',
        title: 'Status Bar Models',
    });

    if (selected !== undefined) {
        const selectedNames = selected.map(item => item.label);
        await config.update('statusBarModels', selectedNames, vscode.ConfigurationTarget.Global);
        logger.info(`Status bar models updated: ${selectedNames.join(', ') || 'none'}`);
        vscode.window.showInformationMessage(
            selectedNames.length > 0
                ? `Showing ${selectedNames.length} model(s) in status bar`
                : 'Status bar models cleared'
        );
    }
}

