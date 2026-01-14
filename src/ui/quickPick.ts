import * as vscode from 'vscode';
import { QuotaInfo, QuotaHelpers, QuotaStatus, FetchResult, QuotaGroup } from '../data';
import { quotaGrouper } from '../data/quotaGrouper';
import { pollingManager } from '../data/pollingManager';

/**
 * QuickPick item with quota data.
 */
interface QuotaQuickPickItem extends vscode.QuickPickItem {
    quotaId?: string;
    action?: 'refresh' | 'settings' | 'logs' | 'pin' | 'unpin';
}

/**
 * Progress bar configuration.
 */
const PROGRESS_BAR = {
    filled: '█',
    empty: '░',
    length: 10,
};

/**
 * Status emoji mapping for visual appeal.
 */
const STATUS_EMOJI = {
    [QuotaStatus.HEALTHY]: '🟢',
    [QuotaStatus.WARNING]: '🟡',
    [QuotaStatus.CRITICAL]: '🔴',
    [QuotaStatus.EXHAUSTED]: '⚫',
    [QuotaStatus.UNKNOWN]: '⚪',
};

/**
 * Pool icons for different quota pools.
 */
const POOL_ICONS: Record<string, string> = {
    'claude-pool': '🤖',
    'gemini-pro-pool': '✨',
    'gemini-flash-pool': '⚡',
    'default-pool': '📦',
};

/**
 * Provides a keyboard-friendly QuickPick interface for quota viewing.
 */
export class QuickPickProvider {
    private static instance: QuickPickProvider;
    private currentQuotas: QuotaInfo[] = [];

    private constructor() {
        // Listen for quota updates
        pollingManager.addListener(result => this.onQuotaUpdate(result));
    }

    /**
     * Gets the singleton instance.
     */
    public static getInstance(): QuickPickProvider {
        if (!QuickPickProvider.instance) {
            QuickPickProvider.instance = new QuickPickProvider();
        }
        return QuickPickProvider.instance;
    }

    /**
     * Shows the QuickPick dashboard.
     */
    public async show(): Promise<void> {
        const items = this.buildItems();

        const selected = await vscode.window.showQuickPick(items, {
            title: '✦ Antigravity Usage Stats',
            placeHolder: 'Select a model to view details or choose an action',
            matchOnDescription: true,
            matchOnDetail: true,
        });

        if (selected) {
            await this.handleSelection(selected);
        }
    }

    /**
     * Updates the current quota data.
     */
    public update(quotas: QuotaInfo[]): void {
        this.currentQuotas = quotas;
    }

    /**
     * Handles quota update events.
     */
    private onQuotaUpdate(result: FetchResult): void {
        if (result.success) {
            this.currentQuotas = result.quotas;
        }
    }

    /**
     * Builds a Unicode progress bar.
     */
    private buildProgressBar(percent: number): string {
        const filled = Math.round((percent / 100) * PROGRESS_BAR.length);
        const empty = PROGRESS_BAR.length - filled;
        return PROGRESS_BAR.filled.repeat(filled) + PROGRESS_BAR.empty.repeat(empty);
    }

    /**
     * Gets the pool icon for a pool ID.
     */
    private getPoolIcon(poolId: string): string {
        return POOL_ICONS[poolId] || POOL_ICONS['default-pool'];
    }

    /**
     * Formats a group separator with statistics.
     */
    private formatGroupSeparator(group: QuotaGroup): string {
        const poolIcon = this.getPoolIcon(group.poolId);
        const groupName = group.customName || group.groupName;
        const modelCount = group.models.length;
        const avgPercent = Math.round(group.percentRemaining);
        const statusEmoji = STATUS_EMOJI[group.status];
        
        return `${poolIcon} ${groupName}  ─  ${modelCount} model${modelCount !== 1 ? 's' : ''} ${statusEmoji} ${avgPercent}%`;
    }

    /**
     * Builds QuickPick items from current data.
     */
    private buildItems(): QuotaQuickPickItem[] {
        const items: QuotaQuickPickItem[] = [];

        // Add action items at the top with enhanced styling
        items.push(
            {
                label: '$(sync~spin) Refresh',
                description: 'Fetch latest quota data',
                action: 'refresh',
                alwaysShow: true,
            },
            {
                label: '$(pin) Pin Model',
                description: 'Add model to status bar',
                action: 'pin',
                alwaysShow: true,
            },
            {
                label: '$(pinned) Unpin Model',
                description: 'Remove from status bar',
                action: 'unpin',
                alwaysShow: true,
            },
            {
                label: '$(settings-gear) Settings',
                description: 'Configure extension',
                action: 'settings',
                alwaysShow: true,
            },
            {
                label: '$(terminal) View Logs',
                description: 'Open extension logs',
                action: 'logs',
                alwaysShow: true,
            }
        );

        // Add separator before quotas
        items.push({
            label: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            kind: vscode.QuickPickItemKind.Separator,
        } as QuotaQuickPickItem);

        if (this.currentQuotas.length === 0) {
            items.push({
                label: '⚠️ No quota data available',
                description: 'Press Enter on Refresh to fetch data',
                detail: 'Make sure Antigravity is running in VS Code',
                alwaysShow: true,
            });
            return items;
        }

        // Group quotas
        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        const thresholds = {
            warning: config.get<number>('warningThreshold', 30),
            critical: config.get<number>('criticalThreshold', 10),
        };
        const groups = quotaGrouper.groupByPool(this.currentQuotas, thresholds);

        // Add quota items by group with enhanced formatting
        for (const group of groups) {
            // Add enhanced group header
            items.push({
                label: this.formatGroupSeparator(group),
                kind: vscode.QuickPickItemKind.Separator,
            } as QuotaQuickPickItem);

            // Add models in group
            for (const quota of group.models) {
                items.push(this.buildQuotaItem(quota));
            }
        }

        return items;
    }

    /**
     * Builds a QuickPick item for a quota with enhanced visuals.
     */
    private buildQuotaItem(quota: QuotaInfo): QuotaQuickPickItem {
        const statusEmoji = STATUS_EMOJI[quota.status];
        const percent = Math.round(quota.percentRemaining);
        const progressBar = this.buildProgressBar(percent);
        const resetInfo = quota.resetInSeconds
            ? QuotaHelpers.formatResetCountdown(quota.resetInSeconds)
            : '—';

        // Build rich description with progress bar
        const description = `${progressBar} ${percent}%`;
        
        // Build detailed info line
        const detail = `⏱ Resets in ${resetInfo}  ·  ${quota.remaining}/${quota.capacity} requests`;

        return {
            label: `${statusEmoji} ${quota.modelName}`,
            description,
            detail,
            quotaId: quota.modelId,
        };
    }

    /**
     * Handles selection of a QuickPick item.
     */
    private async handleSelection(item: QuotaQuickPickItem): Promise<void> {
        switch (item.action) {
            case 'refresh':
                await pollingManager.pollNow();
                vscode.window.showInformationMessage('✅ Quota data refreshed!');
                // Re-show the QuickPick with updated data
                await this.show();
                return; // Exit early to prevent fall-through
            case 'pin':
                await vscode.commands.executeCommand('antigravityUsageStats.pinModel');
                break;
            case 'unpin':
                await vscode.commands.executeCommand('antigravityUsageStats.unpinModel');
                break;
            case 'settings':
                await vscode.commands.executeCommand('workbench.action.openSettings', 'antigravityUsageStats');
                break;
            case 'logs':
                await vscode.commands.executeCommand('antigravityUsageStats.openLogs');
                break;
            default:
                if (item.quotaId) {
                    // Show details for selected model
                    await this.showModelDetails(item.quotaId);
                }
        }
    }

    /**
     * Shows detailed information for a specific model with enhanced formatting.
     */
    private async showModelDetails(modelId: string): Promise<void> {
        const quota = this.currentQuotas.find(q => q.modelId === modelId);
        if (!quota) return;

        const statusEmoji = STATUS_EMOJI[quota.status];
        const percent = Math.round(quota.percentRemaining);
        const progressBar = this.buildProgressBar(percent);
        const resetInfo = quota.resetInSeconds
            ? QuotaHelpers.formatResetCountdown(quota.resetInSeconds)
            : 'Unknown';

        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        const statusBarModels = config.get<string[]>('statusBarModels', []);
        const isPinned = statusBarModels.includes(quota.modelName);

        // Enhanced message with visual elements
        const message = [
            `${statusEmoji} ${quota.modelName}`,
            `${progressBar} ${percent}%`,
            `📊 ${quota.remaining}/${quota.capacity} requests`,
            `⏱ Resets in ${resetInfo}`,
        ].join('\n');

        const action = await vscode.window.showInformationMessage(
            message,
            isPinned ? 'Unpin from Status Bar' : 'Pin to Status Bar',
            'Close'
        );

        if (action === 'Pin to Status Bar') {
            const newPinned = [...statusBarModels, quota.modelName];
            await config.update('statusBarModels', newPinned, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`📌 Pinned ${quota.modelName} to status bar`);
        } else if (action === 'Unpin from Status Bar') {
            const newPinned = statusBarModels.filter(name => name !== quota.modelName);
            await config.update('statusBarModels', newPinned, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`📍 Unpinned ${quota.modelName} from status bar`);
        }
    }
}

// Export singleton
export const quickPickProvider = QuickPickProvider.getInstance();
