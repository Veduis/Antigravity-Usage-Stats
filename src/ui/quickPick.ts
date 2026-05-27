import * as vscode from 'vscode';
import { QuotaInfo, QuotaHelpers, QuotaStatus, FetchResult, QuotaGroup, PromptCreditsInfo } from '../data';
import { quotaGrouper } from '../data/quotaGrouper';
import { pollingManager } from '../data/pollingManager';
import { antigravityClient } from '../data/antigravityClient';

interface QuotaQuickPickItem extends vscode.QuickPickItem {
    quotaId?: string;
    action?: 'refresh' | 'reconnect' | 'settings' | 'logs' | 'export';
}

const PROGRESS_BAR = { filled: '█', empty: '░', length: 10 };

const STATUS_EMOJI: Record<QuotaStatus, string> = {
    [QuotaStatus.HEALTHY]:   '🟢',
    [QuotaStatus.WARNING]:   '🟡',
    [QuotaStatus.CRITICAL]:  '🔴',
    [QuotaStatus.EXHAUSTED]: '⚫',
    [QuotaStatus.UNKNOWN]:   '⚪',
};

const POOL_ICONS: Record<string, string> = {
    'claude-pool':       '🤖',
    'gemini-pro-pool':   '✨',
    'gemini-flash-pool': '⚡',
    'gemini-pool':       '🪐',
    'gpt-pool':          '🧠',
    'default-pool':      '📦',
};

/**
 * Keyboard-friendly QuickPick interface.
 * Features: inline pin toggle, prompt credits, absolute reset times,
 * connection status header, export action.
 */
export class QuickPickProvider {
    private static instance: QuickPickProvider;
    private currentQuotas: QuotaInfo[] = [];
    private promptCredits: PromptCreditsInfo | undefined;

    private constructor() {
        pollingManager.addListener(result => this.onQuotaUpdate(result));
    }

    public static getInstance(): QuickPickProvider {
        if (!QuickPickProvider.instance) {
            QuickPickProvider.instance = new QuickPickProvider();
        }
        return QuickPickProvider.instance;
    }

    /** Shows the QuickPick dashboard. Stays open after pin toggles. */
    public async show(): Promise<void> {
        const pick = vscode.window.createQuickPick<QuotaQuickPickItem>();
        pick.title = '✦ Antigravity Usage Stats';
        pick.placeholder = 'Select a model to pin/unpin · Choose an action above';
        pick.matchOnDescription = true;
        pick.matchOnDetail = true;

        const refresh = () => { pick.items = this.buildItems(); };
        refresh();

        let activeItem: QuotaQuickPickItem | undefined;
        pick.onDidChangeActive(items => { activeItem = items[0]; });

        pick.onDidAccept(async () => {
            const item = activeItem ?? pick.activeItems[0];
            if (!item) { return; }

            if (item.action) {
                pick.hide();
                await this.handleAction(item.action);
                return;
            }

            // Inline pin toggle for model items
            if (item.quotaId) {
                await this.togglePin(item.quotaId);
                refresh(); // Stay open, update checkmarks
            }
        });

        pick.onDidHide(() => pick.dispose());
        pick.show();
    }

    private onQuotaUpdate(result: FetchResult): void {
        if (result.success) {
            this.currentQuotas = result.quotas;
            this.promptCredits = result.promptCredits;
        }
    }

    private buildProgressBar(percent: number): string {
        const filled = Math.round((percent / 100) * PROGRESS_BAR.length);
        const empty = PROGRESS_BAR.length - filled;
        return PROGRESS_BAR.filled.repeat(filled) + PROGRESS_BAR.empty.repeat(empty);
    }

    private getPoolIcon(poolId: string): string {
        return POOL_ICONS[poolId] || POOL_ICONS['default-pool'];
    }

    private getPinnedModels(): Set<string> {
        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        return new Set(config.get<string[]>('statusBarModels', []));
    }

    private async togglePin(modelId: string): Promise<void> {
        const quota = this.currentQuotas.find(q => q.modelId === modelId);
        if (!quota) { return; }

        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        const pinned = config.get<string[]>('statusBarModels', []);
        const isPinned = pinned.includes(quota.modelName);
        const newPinned = isPinned
            ? pinned.filter(n => n !== quota.modelName)
            : [...pinned, quota.modelName];

        await config.update('statusBarModels', newPinned, vscode.ConfigurationTarget.Global);
        const action = isPinned ? 'Unpinned' : 'Pinned';
        vscode.window.showInformationMessage(`${action} ${quota.modelName} ${isPinned ? 'from' : 'to'} status bar`);
    }

    private buildItems(): QuotaQuickPickItem[] {
        const items: QuotaQuickPickItem[] = [];
        const isConnected = antigravityClient.isConnected();
        const status = antigravityClient.status;

        // Connection status header
        const statusText = status === 'connected' ? '$(check) Connected'
            : status === 'connecting' ? '$(sync~spin) Connecting...'
            : status === 'error' ? '$(error) Connection Error'
            : '$(debug-disconnect) Disconnected';

        items.push({
            label: statusText,
            description: isConnected
                ? `${this.currentQuotas.length} model${this.currentQuotas.length !== 1 ? 's' : ''} tracked`
                : 'Run "Reconnect" to retry',
            alwaysShow: true,
            kind: vscode.QuickPickItemKind.Separator,
        } as QuotaQuickPickItem);

        // Action buttons
        items.push(
            { label: '$(sync~spin) Refresh', description: 'Fetch latest quota data', action: 'refresh', alwaysShow: true },
            { label: '$(debug-disconnect) Reconnect', description: 'Re-detect Antigravity process', action: 'reconnect', alwaysShow: true },
            { label: '$(cloud-download) Export', description: 'Save quotas to JSON or CSV', action: 'export', alwaysShow: true },
            { label: '$(settings-gear) Settings', description: 'Configure extension', action: 'settings', alwaysShow: true },
            { label: '$(terminal) View Logs', description: 'Open extension logs', action: 'logs', alwaysShow: true },
        );

        const showCredits = config.get<boolean>('showPromptCredits', false);

        // Prompt credits section
        if (this.promptCredits && showCredits) {
            const pc = this.promptCredits;
            const bar = this.buildProgressBar(pc.remainingPercentage);
            items.push({
                label: '💳 Prompt Credits',
                kind: vscode.QuickPickItemKind.Separator,
            } as QuotaQuickPickItem);
            items.push({
                label: `💳 ${pc.available.toLocaleString()} / ${pc.monthly.toLocaleString()} credits`,
                description: `${bar} ${Math.round(pc.remainingPercentage)}% remaining`,
                detail: `${Math.round(pc.usedPercentage)}% used this billing cycle`,
                alwaysShow: true,
            });
        }

        // Quota models
        items.push({
            label: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            kind: vscode.QuickPickItemKind.Separator,
        } as QuotaQuickPickItem);

        if (this.currentQuotas.length === 0) {
            items.push({
                label: isConnected ? '⏳ Waiting for quota data...' : '⚠️ No quota data available',
                description: isConnected ? 'Data will appear shortly' : 'Click Reconnect above',
                detail: 'Make sure Antigravity is running',
                alwaysShow: true,
            });
            return items;
        }

        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        const thresholds = {
            warning: config.get<number>('warningThreshold', 30),
            critical: config.get<number>('criticalThreshold', 10),
        };
        const pinned = this.getPinnedModels();
        const groups = quotaGrouper.groupByPool(this.currentQuotas, thresholds);

        for (const group of groups) {
            items.push({
                label: this.formatGroupHeader(group),
                kind: vscode.QuickPickItemKind.Separator,
            } as QuotaQuickPickItem);

            for (const quota of group.models) {
                items.push(this.buildQuotaItem(quota, pinned));
            }
        }

        return items;
    }

    private formatGroupHeader(group: QuotaGroup): string {
        const icon = this.getPoolIcon(group.poolId);
        const name = group.customName || group.groupName;
        const count = group.models.length;
        const pct = Math.round(group.percentRemaining);
        const emoji = STATUS_EMOJI[group.status];
        return `${icon} ${name}  ─  ${count} model${count !== 1 ? 's' : ''} ${emoji} ${pct}%`;
    }

    private buildQuotaItem(quota: QuotaInfo, pinned: Set<string>): QuotaQuickPickItem {
        const statusEmoji = STATUS_EMOJI[quota.status];
        const percent = Math.round(quota.percentRemaining);
        const bar = this.buildProgressBar(percent);
        const isPinned = pinned.has(quota.modelName);
        const pinIcon = isPinned ? '$(pinned)' : '$(pin)';

        return {
            label: `${statusEmoji} ${quota.modelName}`,
            description: `${bar} ${percent}%   ${pinIcon}`,
            detail: `⏱ ${quota.resetFormatted}  ·  ${quota.remaining}/${quota.capacity} requests`,
            quotaId: quota.modelId,
        };
    }

    private async handleAction(action: string): Promise<void> {
        switch (action) {
            case 'refresh':
                await pollingManager.pollNow();
                vscode.window.showInformationMessage('✅ Quota data refreshed!');
                await this.show();
                break;
            case 'reconnect':
                await vscode.commands.executeCommand('antigravityUsageStats.reconnect');
                await this.show();
                break;
            case 'export':
                await vscode.commands.executeCommand('antigravityUsageStats.export');
                break;
            case 'settings':
                await vscode.commands.executeCommand('workbench.action.openSettings', 'antigravityUsageStats');
                break;
            case 'logs':
                await vscode.commands.executeCommand('antigravityUsageStats.openLogs');
                break;
        }
    }
}

export const quickPickProvider = QuickPickProvider.getInstance();
