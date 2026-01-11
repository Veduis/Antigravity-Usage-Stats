import * as vscode from 'vscode';
import { logger } from '../services/logger';
import { QuotaInfo, QuotaStatus, QuotaHelpers, FetchResult } from '../data';
import { pollingManager } from '../data/pollingManager';

/**
 * Status bar display format options.
 */
export type StatusBarFormat = 'icon' | 'dot' | 'percent' | 'dot-percent' | 'name-percent' | 'full';

/**
 * Individual model status bar item.
 */
interface ModelStatusBarItem {
    item: vscode.StatusBarItem;
    modelName: string;
}

/**
 * Manages the status bar items for quota display.
 */
export class StatusBarProvider {
    private static instance: StatusBarProvider;
    private mainStatusBarItem: vscode.StatusBarItem;
    private modelStatusBarItems: ModelStatusBarItem[] = [];
    private currentQuotas: QuotaInfo[] = [];
    private context: vscode.ExtensionContext | null = null;

    private constructor() {
        // Create main "Usage" status bar item on the right side
        this.mainStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.mainStatusBarItem.command = 'antigravityUsageStats.showQuotas';
        this.mainStatusBarItem.name = 'Antigravity Usage Stats';
    }

    /**
     * Gets the singleton instance.
     */
    public static getInstance(): StatusBarProvider {
        if (!StatusBarProvider.instance) {
            StatusBarProvider.instance = new StatusBarProvider();
        }
        return StatusBarProvider.instance;
    }

    /**
     * Initializes the status bar provider.
     */
    public initialize(context: vscode.ExtensionContext): void {
        this.context = context;
        context.subscriptions.push(this.mainStatusBarItem);

        // Listen for configuration changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('antigravityUsageStats.statusBarModels') ||
                    e.affectsConfiguration('antigravityUsageStats.statusBarFormat')) {
                    this.rebuildModelStatusBars();
                    this.updateDisplay();
                }
            })
        );

        // Listen for quota updates
        pollingManager.addListener(result => this.onQuotaUpdate(result));

        this.mainStatusBarItem.show();
        this.rebuildModelStatusBars();
        this.updateDisplay();
        logger.info('StatusBarProvider initialized');
    }

    /**
     * Updates the status bar with current quota data.
     */
    public update(quotas: QuotaInfo[]): void {
        this.currentQuotas = quotas;
        this.rebuildModelStatusBars();
        this.updateDisplay();
    }

    /**
     * Shows all status bar items.
     */
    public show(): void {
        this.mainStatusBarItem.show();
        this.modelStatusBarItems.forEach(item => item.item.show());
    }

    /**
     * Hides all status bar items.
     */
    public hide(): void {
        this.mainStatusBarItem.hide();
        this.modelStatusBarItems.forEach(item => item.item.hide());
    }

    /**
     * Disposes all status bar items.
     */
    public dispose(): void {
        this.mainStatusBarItem.dispose();
        this.disposeModelStatusBars();
    }

    /**
     * Handles quota update events from polling manager.
     */
    private onQuotaUpdate(result: FetchResult): void {
        if (result.success) {
            this.update(result.quotas);
        }
    }

    /**
     * Disposes all model-specific status bar items.
     */
    private disposeModelStatusBars(): void {
        this.modelStatusBarItems.forEach(item => item.item.dispose());
        this.modelStatusBarItems = [];
    }

    /**
     * Rebuilds the model-specific status bar items based on settings.
     */
    private rebuildModelStatusBars(): void {
        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        const statusBarModels = config.get<string[]>('statusBarModels', []);

        // Get current model names that are pinned
        const currentPinned = new Set(this.modelStatusBarItems.map(m => m.modelName));
        const targetPinned = new Set(statusBarModels);

        // Check if we need to rebuild
        const needsRebuild =
            currentPinned.size !== targetPinned.size ||
            ![...currentPinned].every(m => targetPinned.has(m));

        if (!needsRebuild) {
            return;
        }

        // Dispose old items
        this.disposeModelStatusBars();

        // Create new items for each pinned model
        let priority = 99; // Just below the main "Usage" button
        for (const modelName of statusBarModels) {
            const item = vscode.window.createStatusBarItem(
                vscode.StatusBarAlignment.Right,
                priority--
            );
            item.command = 'antigravityUsageStats.showQuotas';
            item.name = `Antigravity: ${modelName}`;

            if (this.context) {
                this.context.subscriptions.push(item);
            }

            this.modelStatusBarItems.push({
                item,
                modelName,
            });

            item.show();
        }

        logger.debug(`Rebuilt ${statusBarModels.length} model status bar items`);
    }

    /**
     * Updates the display based on current quota data.
     */
    private updateDisplay(): void {
        // Update main "Usage" button
        if (this.currentQuotas.length === 0) {
            this.mainStatusBarItem.text = '$(pulse) Usage';
            this.mainStatusBarItem.tooltip = 'No quota data available. Click to show quotas.';
            this.mainStatusBarItem.backgroundColor = undefined;
        } else {
            this.mainStatusBarItem.text = '$(pulse) Usage';
            this.mainStatusBarItem.tooltip = this.formatTooltip();
            this.mainStatusBarItem.backgroundColor = undefined;
        }

        // Update individual model status bar items
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

    /**
     * Gets a short display name for a model.
     */
    private getShortName(name: string): string {
        // Common abbreviations
        const abbreviations: Record<string, string> = {
            'Claude Sonnet 4.5 (Thinking)': 'Claude 4.5T',
            'Claude Opus 4.5 (Thinking)': 'Opus 4.5T',
            'Gemini 3 Pro (High)': 'G3 Pro H',
            'Gemini 3 Pro (Low)': 'G3 Pro L',
            'Gemini 3 Flash': 'G3 Flash',
            'GPT OSS 120b': 'GPT 120b',
        };

        if (abbreviations[name]) {
            return abbreviations[name];
        }

        // Generic shortening
        const short = name
            .replace(/^Gemini\s+/i, 'G')
            .replace(/^Claude\s+/i, 'C')
            .replace(/\(Thinking\)/i, 'T')
            .replace(/\s+/g, ' ');

        return short.length > 20 ? short.substring(0, 18) + '..' : short;
    }

    /**
     * Formats tooltip for a single model.
     */
    private formatModelTooltip(quota: QuotaInfo): string {
        const icon = QuotaHelpers.getStatusIcon(quota.status);
        const percent = Math.round(quota.percentRemaining);
        const reset = quota.resetInSeconds
            ? QuotaHelpers.formatResetCountdown(quota.resetInSeconds)
            : 'Unknown';

        return `${icon} ${quota.modelName}\n${percent}% remaining\nResets in: ${reset}\n\nClick to show quotas`;
    }

    /**
     * Formats the full tooltip with all quota information.
     */
    private formatTooltip(): string {
        const lines = ['**Antigravity Usage Stats**\n'];

        for (const quota of this.currentQuotas) {
            const icon = QuotaHelpers.getStatusIcon(quota.status);
            const percent = Math.round(quota.percentRemaining);
            const reset = quota.resetInSeconds
                ? QuotaHelpers.formatResetCountdown(quota.resetInSeconds)
                : 'Unknown';

            lines.push(`${icon} ${quota.modelName}: ${percent}% (resets in ${reset})`);
        }

        lines.push('\n*Click to show quotas*');
        return lines.join('\n');
    }

    /**
     * Gets the status dot character.
     */
    private getStatusDot(status: QuotaStatus): string {
        switch (status) {
            case QuotaStatus.HEALTHY:
                return '🟢';
            case QuotaStatus.WARNING:
                return '🟡';
            case QuotaStatus.CRITICAL:
                return '🔴';
            case QuotaStatus.EXHAUSTED:
                return '⚫';
            default:
                return '⚪';
        }
    }

    /**
     * Gets background color for error states.
     */
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

// Export singleton
export const statusBarProvider = StatusBarProvider.getInstance();
