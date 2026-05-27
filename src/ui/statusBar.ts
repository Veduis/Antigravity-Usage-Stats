import * as vscode from 'vscode';
import { logger, stateManager } from '../services';
import { QuotaInfo, QuotaStatus, QuotaHelpers, FetchResult, PromptCreditsInfo } from '../data';
import { pollingManager } from '../data/pollingManager';
import { antigravityClient, ConnectionStatus } from '../data/antigravityClient';

export type StatusBarFormat = 'icon' | 'dot' | 'percent' | 'dot-percent' | 'name-percent' | 'full';

interface ModelStatusBarItem {
    item: vscode.StatusBarItem;
    modelName: string;
}

/**
 * Manages status bar items for quota display.
 * Shows loading/error/connected states with appropriate icons.
 */
export class StatusBarProvider {
    private static instance: StatusBarProvider;
    private mainStatusBarItem: vscode.StatusBarItem;
    private modelStatusBarItems: ModelStatusBarItem[] = [];
    private currentQuotas: QuotaInfo[] = [];
    private promptCredits: PromptCreditsInfo | undefined;
    private context: vscode.ExtensionContext | null = null;
    private connectionStatus: ConnectionStatus = 'disconnected';

    private constructor() {
        this.mainStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.mainStatusBarItem.command = 'antigravityUsageStats.showQuotas';
        this.mainStatusBarItem.name = 'Antigravity Usage Stats';
    }

    public static getInstance(): StatusBarProvider {
        if (!StatusBarProvider.instance) {
            StatusBarProvider.instance = new StatusBarProvider();
        }
        return StatusBarProvider.instance;
    }

    public initialize(context: vscode.ExtensionContext): void {
        this.context = context;
        context.subscriptions.push(this.mainStatusBarItem);

        // Config changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('antigravityUsageStats.statusBarModels') ||
                    e.affectsConfiguration('antigravityUsageStats.statusBarFormat')) {
                    this.rebuildModelStatusBars();
                    this.updateDisplay();
                }
            })
        );

        // Quota updates from polling
        pollingManager.addListener(result => this.onQuotaUpdate(result));

        // Connection status changes for loading/error indicator
        antigravityClient.onStatusChange(status => {
            this.connectionStatus = status;
            this.updateMainItem();
        });

        this.mainStatusBarItem.show();
        this.rebuildModelStatusBars();
        this.updateDisplay();
        logger.info('StatusBarProvider initialized');
    }

    public update(quotas: QuotaInfo[], promptCredits?: PromptCreditsInfo): void {
        this.currentQuotas = quotas;
        this.promptCredits = promptCredits;

        // Auto-pin check: If no models are configured yet, auto-pin the first 3 discovered models
        // so the user sees active quotas immediately without having to configure anything!
        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        const statusBarModels = config.get<string[]>('statusBarModels', []);
        
        if (statusBarModels.length === 0 && quotas.length > 0 && !stateManager.get('hasInitializedPins')) {
            const defaultModels = quotas.slice(0, 3).map(q => q.modelName);
            logger.info(`Auto-pinning first active models: ${defaultModels.join(', ')}`);
            config.update('statusBarModels', defaultModels, vscode.ConfigurationTarget.Global).then(() => {
                stateManager.set('hasInitializedPins', true);
                this.rebuildModelStatusBars();
                this.updateDisplay();
            });
            return;
        }

        // Only rebuild pinned bars when config changes, not on every data update
        this.updateDisplay();
    }

    public show(): void {
        this.mainStatusBarItem.show();
        this.modelStatusBarItems.forEach(i => i.item.show());
    }

    public hide(): void {
        this.mainStatusBarItem.hide();
        this.modelStatusBarItems.forEach(i => i.item.hide());
    }

    public dispose(): void {
        this.mainStatusBarItem.dispose();
        this.disposeModelStatusBars();
    }

    private onQuotaUpdate(result: FetchResult): void {
        if (result.success) {
            this.update(result.quotas, result.promptCredits);
        } else {
            // Keep stale quota display but show error state on main button
            this.updateMainItem();
        }
    }

    private disposeModelStatusBars(): void {
        this.modelStatusBarItems.forEach(i => i.item.dispose());
        this.modelStatusBarItems = [];
    }

    /** Only rebuild model bars when the pinned set has actually changed. */
    private rebuildModelStatusBars(): void {
        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        const statusBarModels = config.get<string[]>('statusBarModels', []);

        const currentPinned = new Set(this.modelStatusBarItems.map(m => m.modelName));
        const targetPinned = new Set(statusBarModels);

        const needsRebuild =
            currentPinned.size !== targetPinned.size ||
            ![...currentPinned].every(m => targetPinned.has(m));

        if (!needsRebuild) { return; }

        this.disposeModelStatusBars();

        let priority = 99;
        for (const modelName of statusBarModels) {
            const item = vscode.window.createStatusBarItem(
                vscode.StatusBarAlignment.Right,
                priority--
            );
            item.command = 'antigravityUsageStats.showQuotas';
            item.name = `Antigravity: ${modelName}`;

            if (this.context) { this.context.subscriptions.push(item); }
            this.modelStatusBarItems.push({ item, modelName });
            item.show();
        }
        logger.debug(`Rebuilt ${statusBarModels.length} model status bar items`);
    }

    private updateDisplay(): void {
        this.updateMainItem();
        this.updateModelItems();
    }

    /** Main "Usage" button — shows connecting/error/data states. */
    private updateMainItem(): void {
        switch (this.connectionStatus) {
            case 'connecting':
                this.mainStatusBarItem.text = '$(sync~spin) Usage';
                this.mainStatusBarItem.tooltip = 'Connecting to Antigravity...';
                this.mainStatusBarItem.backgroundColor = undefined;
                break;
            case 'error':
                this.mainStatusBarItem.text = '$(error) Usage';
                this.mainStatusBarItem.tooltip = 'Antigravity connection error — click to retry';
                this.mainStatusBarItem.backgroundColor =
                    new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
            case 'disconnected':
                this.mainStatusBarItem.text = '$(debug-disconnect) Usage';
                this.mainStatusBarItem.tooltip = 'Not connected to Antigravity — click to reconnect';
                this.mainStatusBarItem.backgroundColor = undefined;
                break;
            default: // connected
                if (this.currentQuotas.length === 0) {
                    this.mainStatusBarItem.text = '$(pulse) Usage';
                    this.mainStatusBarItem.tooltip = 'No quota data — click to refresh';
                } else {
                    this.mainStatusBarItem.text = '$(pulse) Usage';
                    this.mainStatusBarItem.tooltip = this.formatTooltip();
                }
                this.mainStatusBarItem.backgroundColor = undefined;
        }
    }

    private updateModelItems(): void {
        for (const modelItem of this.modelStatusBarItems) {
            const quota = this.currentQuotas.find(q =>
                q.modelName.toLowerCase() === modelItem.modelName.toLowerCase() ||
                q.modelName.includes(modelItem.modelName) ||
                modelItem.modelName.includes(q.modelName)
            );

            if (quota) {
                const percent = Math.round(quota.percentRemaining);
                const dot = this.getStatusDot(quota.status);
                const shortName = this.getShortName(quota.modelName);
                modelItem.item.text = `${dot} ${shortName}: ${percent}%`;
                modelItem.item.tooltip = this.formatModelTooltip(quota);
                modelItem.item.backgroundColor = this.getBackgroundColor(quota.status);
            } else {
                modelItem.item.text = `⚪ ${this.getShortName(modelItem.modelName)}: --`;
                modelItem.item.tooltip = `${modelItem.modelName}: No data`;
                modelItem.item.backgroundColor = undefined;
            }
        }
    }

    private getShortName(name: string): string {
        const short = name
            .replace(/^Gemini\s+/i, 'G')
            .replace(/^Claude\s+/i, 'C')
            .replace(/\(Thinking\)/i, 'T')
            .replace(/\(High\)/i, 'H')
            .replace(/\(Low\)/i, 'L')
            .replace(/\s+/g, ' ');
        return short.length > 20 ? short.substring(0, 18) + '..' : short;
    }

    private formatModelTooltip(quota: QuotaInfo): string {
        const icon = QuotaHelpers.getStatusIcon(quota.status);
        const percent = Math.round(quota.percentRemaining);
        return `${icon} ${quota.modelName}\n${percent}% remaining\nResets: ${quota.resetFormatted}\n\nClick to show quotas`;
    }

    private formatTooltip(): string {
        const lines = ['**Antigravity Usage Stats**\n'];

        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        const showCredits = config.get<boolean>('showPromptCredits', false);

        if (this.promptCredits && showCredits) {
            const pc = this.promptCredits;
            lines.push(`💳 Credits: ${pc.available.toLocaleString()} / ${pc.monthly.toLocaleString()} (${Math.round(pc.remainingPercentage)}% remaining)`);
            lines.push('');
        }

        for (const quota of this.currentQuotas) {
            const icon = QuotaHelpers.getStatusIcon(quota.status);
            const percent = Math.round(quota.percentRemaining);
            lines.push(`${icon} ${quota.modelName}: ${percent}% (${quota.resetFormatted})`);
        }

        lines.push('\n*Click to show quotas*');
        return lines.join('\n');
    }

    private getStatusDot(status: QuotaStatus): string {
        switch (status) {
            case QuotaStatus.HEALTHY:   return '🟢';
            case QuotaStatus.WARNING:   return '🟡';
            case QuotaStatus.CRITICAL:  return '🔴';
            case QuotaStatus.EXHAUSTED: return '⚫';
            default:                    return '⚪';
        }
    }

    private getBackgroundColor(status: QuotaStatus): vscode.ThemeColor | undefined {
        if (status === QuotaStatus.CRITICAL || status === QuotaStatus.EXHAUSTED) {
            return new vscode.ThemeColor('statusBarItem.errorBackground');
        }
        if (status === QuotaStatus.WARNING) {
            return new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        return undefined;
    }
}

export const statusBarProvider = StatusBarProvider.getInstance();
