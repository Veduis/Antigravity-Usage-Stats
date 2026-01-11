import * as vscode from 'vscode';
import {
    logger,
    stateManager,
    credentialManager,
    commandRegistry,
    LogLevel,
} from './services';
import { pollingManager, quotaFetcher } from './data';
import { statusBarProvider, quickPickProvider } from './ui';

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

    logger.info('Antigravity Usage Stats extension is activating...');
    logger.info(`VS Code version: ${vscode.version}`);

    // Set log level based on development mode
    if (context.extensionMode === vscode.ExtensionMode.Development) {
        logger.setMinLevel(LogLevel.DEBUG);
        logger.debug('Debug logging enabled (development mode)');
    }

    // Register all commands
    registerCommands();

    // Start polling
    pollingManager.start();

    logger.info('Antigravity Usage Stats extension activated successfully!');
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
    logger.info('Antigravity Usage Stats extension deactivating...');
    pollingManager.stop();
    logger.dispose();
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Registers all extension commands.
 */
function registerCommands(): void {
    commandRegistry.registerMany({
        'antigravityStats.showQuotas': showQuotas,
        'antigravityStats.refresh': refreshQuotaData,
        'antigravityStats.openLogs': openLogs,
        'antigravityStats.pinModel': pinModel,
        'antigravityStats.unpinModel': unpinModel,
    });

    logger.debug(`Registered ${commandRegistry.getRegisteredCommands().length} commands`);
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Shows the quota QuickPick interface.
 */
async function showQuotas(): Promise<void> {
    logger.info('Opening quota view...');
    await quickPickProvider.show();
}

/**
 * Refreshes quota data from the data source.
 */
async function refreshQuotaData(): Promise<void> {
    logger.info('Refreshing quota data...');
    await pollingManager.pollNow();
    vscode.window.showInformationMessage('Antigravity Usage Stats: Quota data refreshed!');
}

/**
 * Opens the extension logs in the output channel.
 */
function openLogs(): void {
    logger.info('Opening logs...');
    logger.show();
}

/**
 * Pins a model to the status bar.
 */
async function pinModel(): Promise<void> {
    logger.info('Opening pin model selector...');

    // Get current quota data
    const result = quotaFetcher.getLastResult();
    if (!result || result.quotas.length === 0) {
        vscode.window.showWarningMessage('No quota data available. Try refreshing first.');
        return;
    }

    // Get currently pinned models
    const config = vscode.workspace.getConfiguration('antigravityStats');
    const currentlyPinned = new Set(config.get<string[]>('pinnedModels', []));

    // Create QuickPick items for unpinned models
    const items: vscode.QuickPickItem[] = result.quotas
        .filter(quota => !currentlyPinned.has(quota.modelName))
        .map(quota => ({
            label: quota.modelName,
            description: `${Math.round(quota.percentRemaining)}% remaining`,
        }));

    if (items.length === 0) {
        vscode.window.showInformationMessage('All models are already pinned to the status bar.');
        return;
    }

    // Show picker
    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Select models to pin to status bar',
        title: 'Pin Models to Status Bar',
    });

    if (selected && selected.length > 0) {
        const newPinned = [...currentlyPinned, ...selected.map(item => item.label)];
        await config.update('pinnedModels', newPinned, vscode.ConfigurationTarget.Global);
        logger.info(`Pinned models: ${selected.map(s => s.label).join(', ')}`);
        vscode.window.showInformationMessage(
            `Pinned ${selected.length} model(s) to status bar`
        );
    }
}

/**
 * Unpins a model from the status bar.
 */
async function unpinModel(): Promise<void> {
    logger.info('Opening unpin model selector...');

    // Get currently pinned models
    const config = vscode.workspace.getConfiguration('antigravityStats');
    const currentlyPinned = config.get<string[]>('pinnedModels', []);

    if (currentlyPinned.length === 0) {
        vscode.window.showInformationMessage('No models are currently pinned.');
        return;
    }

    // Create QuickPick items
    const items: vscode.QuickPickItem[] = currentlyPinned.map(name => ({
        label: name,
    }));

    // Show picker
    const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Select models to unpin from status bar',
        title: 'Unpin Models from Status Bar',
    });

    if (selected && selected.length > 0) {
        const selectedNames = new Set(selected.map(item => item.label));
        const newPinned = currentlyPinned.filter(name => !selectedNames.has(name));
        await config.update('pinnedModels', newPinned, vscode.ConfigurationTarget.Global);
        logger.info(`Unpinned models: ${selected.map(s => s.label).join(', ')}`);
        vscode.window.showInformationMessage(
            `Unpinned ${selected.length} model(s) from status bar`
        );
    }
}
