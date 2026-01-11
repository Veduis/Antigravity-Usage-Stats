import * as vscode from 'vscode';
import { QuotaInfo, QuotaHelpers, QuotaStatus, FetchResult } from '../data';
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
            title: '📊 Antigravity Usage Stats',
            placeHolder: 'Select a model or action',
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
     * Builds QuickPick items from current data.
     */
    private buildItems(): QuotaQuickPickItem[] {
        const items: QuotaQuickPickItem[] = [];

        // Add action items at the top
        items.push(
            {
                label: '$(refresh) Refresh',
                description: 'Fetch latest quota data',
                action: 'refresh',
                alwaysShow: true,
            },
            {
                label: '$(pin) Pin Model',
                description: 'Pin a model to status bar',
                action: 'pin',
                alwaysShow: true,
            },
            {
                label: '$(pinned) Unpin Model',
                description: 'Remove a model from status bar',
                action: 'unpin',
                alwaysShow: true,
            },
            {
                label: '$(gear) Settings',
                description: 'Configure extension',
                action: 'settings',
                alwaysShow: true,
            },
            {
                label: '$(output) View Logs',
                description: 'Open extension logs',
                action: 'logs',
                alwaysShow: true,
            }
        );

        // Add separator
        items.push({
            label: '',
            kind: vscode.QuickPickItemKind.Separator,
        } as QuotaQuickPickItem);

        if (this.currentQuotas.length === 0) {
            items.push({
                label: '$(warning) No quota data available',
                description: 'Click Refresh to fetch data',
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

        // Add quota items by group
        for (const group of groups) {
            // Add group header
            items.push({
                label: `$(folder) ${group.customName || group.groupName}`,
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
     * Builds a QuickPick item for a quota.
     */
    private buildQuotaItem(quota: QuotaInfo): QuotaQuickPickItem {
        const icon = this.getStatusIcon(quota.status);
        const percent = Math.round(quota.percentRemaining);
        const resetInfo = quota.resetInSeconds
            ? QuotaHelpers.formatResetCountdown(quota.resetInSeconds)
            : 'Unknown';

        return {
            label: `${icon} ${quota.modelName}`,
            description: `${percent}% remaining`,
            detail: `${quota.remaining}/${quota.capacity} • Resets in ${resetInfo}`,
            quotaId: quota.modelId,
        };
    }

    /**
     * Gets the appropriate icon for a status.
     */
    private getStatusIcon(status: QuotaStatus): string {
        switch (status) {
            case QuotaStatus.HEALTHY:
                return '$(check)';
            case QuotaStatus.WARNING:
                return '$(warning)';
            case QuotaStatus.CRITICAL:
                return '$(error)';
            case QuotaStatus.EXHAUSTED:
                return '$(circle-slash)';
            default:
                return '$(question)';
        }
    }

    /**
     * Handles selection of a QuickPick item.
     */
    private async handleSelection(item: QuotaQuickPickItem): Promise<void> {
        switch (item.action) {
            case 'refresh':
                await pollingManager.pollNow();
                vscode.window.showInformationMessage('Antigravity Usage Stats: Quota data refreshed!');
                break;
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
     * Shows detailed information for a specific model.
     */
    private async showModelDetails(modelId: string): Promise<void> {
        const quota = this.currentQuotas.find(q => q.modelId === modelId);
        if (!quota) return;

        const icon = QuotaHelpers.getStatusIcon(quota.status);
        const percent = Math.round(quota.percentRemaining);
        const resetInfo = quota.resetInSeconds
            ? QuotaHelpers.formatResetCountdown(quota.resetInSeconds)
            : 'Unknown';

        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        const statusBarModels = config.get<string[]>('statusBarModels', []);
        const isPinned = statusBarModels.includes(quota.modelName);

        const message = `${icon} ${quota.modelName}\n• ${quota.remaining}/${quota.capacity} (${percent}%)\n• Resets in ${resetInfo}`;

        const action = await vscode.window.showInformationMessage(
            message,
            isPinned ? 'Unpin from Status Bar' : 'Pin to Status Bar',
            'Close'
        );

        if (action === 'Pin to Status Bar') {
            const newPinned = [...statusBarModels, quota.modelName];
            await config.update('statusBarModels', newPinned, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Pinned ${quota.modelName} to status bar`);
        } else if (action === 'Unpin from Status Bar') {
            const newPinned = statusBarModels.filter(name => name !== quota.modelName);
            await config.update('statusBarModels', newPinned, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Unpinned ${quota.modelName} from status bar`);
        }
    }
}

// Export singleton
export const quickPickProvider = QuickPickProvider.getInstance();
