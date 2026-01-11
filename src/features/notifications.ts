import * as vscode from 'vscode';
import { logger } from '../services/logger';
import { QuotaInfo, QuotaStatus, FetchResult } from '../data';
import { pollingManager } from '../data/pollingManager';

/**
 * Tracks which quotas have already triggered notifications to avoid spam.
 */
interface NotificationState {
    modelId: string;
    lastNotifiedStatus: QuotaStatus;
    lastNotifiedTime: Date;
}

/**
 * Manages notifications for quota alerts.
 */
export class NotificationManager {
    private static instance: NotificationManager;
    private notificationStates: Map<string, NotificationState> = new Map();
    private cooldownMs: number = 30000; // 30 seconds between repeated alerts

    private constructor() {
        // Listen for quota updates
        pollingManager.addListener(result => this.onQuotaUpdate(result));
    }

    /**
     * Gets the singleton instance.
     */
    public static getInstance(): NotificationManager {
        if (!NotificationManager.instance) {
            NotificationManager.instance = new NotificationManager();
        }
        return NotificationManager.instance;
    }

    /**
     * Initializes the notification manager.
     */
    public initialize(): void {
        logger.info('NotificationManager initialized');
    }

    /**
     * Checks if notifications are enabled in settings.
     */
    private areNotificationsEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        return config.get<boolean>('notificationsEnabled', true);
    }

    /**
     * Gets threshold configuration.
     */
    private getThresholds(): { warning: number; critical: number } {
        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        return {
            warning: config.get<number>('warningThreshold', 30),
            critical: config.get<number>('criticalThreshold', 10),
        };
    }

    /**
     * Handles quota update events.
     */
    private onQuotaUpdate(result: FetchResult): void {
        if (!result.success || !this.areNotificationsEnabled()) {
            return;
        }

        for (const quota of result.quotas) {
            this.checkAndNotify(quota);
        }
    }

    /**
     * Checks a quota and shows notification if needed.
     */
    private checkAndNotify(quota: QuotaInfo): void {
        const thresholds = this.getThresholds();
        const state = this.notificationStates.get(quota.modelId);
        const now = new Date();

        // Determine if we should show a notification
        const shouldNotify = this.shouldShowNotification(quota, state, now);

        if (!shouldNotify) {
            return;
        }

        // Show appropriate notification
        if (quota.status === QuotaStatus.EXHAUSTED) {
            this.showExhaustedNotification(quota);
        } else if (quota.status === QuotaStatus.CRITICAL) {
            this.showCriticalNotification(quota);
        } else if (quota.status === QuotaStatus.WARNING) {
            this.showWarningNotification(quota);
        }

        // Update state
        this.notificationStates.set(quota.modelId, {
            modelId: quota.modelId,
            lastNotifiedStatus: quota.status,
            lastNotifiedTime: now,
        });
    }

    /**
     * Determines whether to show a notification.
     */
    private shouldShowNotification(
        quota: QuotaInfo,
        state: NotificationState | undefined,
        now: Date
    ): boolean {
        // Only notify for warning, critical, or exhausted
        if (
            quota.status === QuotaStatus.HEALTHY ||
            quota.status === QuotaStatus.UNKNOWN
        ) {
            return false;
        }

        // First time seeing this quota in a non-healthy state
        if (!state) {
            return true;
        }

        // Status has gotten worse (escalation)
        const statusSeverity = {
            [QuotaStatus.HEALTHY]: 0,
            [QuotaStatus.WARNING]: 1,
            [QuotaStatus.CRITICAL]: 2,
            [QuotaStatus.EXHAUSTED]: 3,
            [QuotaStatus.UNKNOWN]: 0,
        };

        if (statusSeverity[quota.status] > statusSeverity[state.lastNotifiedStatus]) {
            return true;
        }

        // Same status but cooldown has passed
        if (
            quota.status === state.lastNotifiedStatus &&
            now.getTime() - state.lastNotifiedTime.getTime() > this.cooldownMs
        ) {
            return false; // Don't repeat same status unless it escalated
        }

        return false;
    }

    /**
     * Shows a warning notification.
     */
    private showWarningNotification(quota: QuotaInfo): void {
        const percent = Math.round(quota.percentRemaining);
        const message = `⚠️ ${quota.modelName}: Quota at ${percent}% (${quota.remaining}/${quota.capacity})`;

        vscode.window
            .showWarningMessage(message, 'View Quotas', 'Dismiss')
            .then(action => {
                if (action === 'View Quotas') {
                    vscode.commands.executeCommand('antigravityUsageStats.showQuotas');
                }
            });

        logger.info(`Warning notification shown for ${quota.modelName}`);
    }

    /**
     * Shows a critical notification.
     */
    private showCriticalNotification(quota: QuotaInfo): void {
        const percent = Math.round(quota.percentRemaining);
        const message = `🔴 ${quota.modelName}: Quota critically low at ${percent}%!`;

        vscode.window
            .showErrorMessage(message, 'View Quotas', 'Dismiss')
            .then(action => {
                if (action === 'View Quotas') {
                    vscode.commands.executeCommand('antigravityUsageStats.showQuotas');
                }
            });

        logger.warn(`Critical notification shown for ${quota.modelName}`);
    }

    /**
     * Shows an exhausted notification.
     */
    private showExhaustedNotification(quota: QuotaInfo): void {
        const resetInfo = quota.resetInSeconds
            ? `Resets in ${this.formatResetTime(quota.resetInSeconds)}`
            : 'Reset time unknown';
        const message = `⛔ ${quota.modelName}: Quota exhausted! ${resetInfo}`;

        vscode.window
            .showErrorMessage(message, 'View Quotas', 'Dismiss')
            .then(action => {
                if (action === 'View Quotas') {
                    vscode.commands.executeCommand('antigravityUsageStats.showQuotas');
                }
            });

        logger.warn(`Exhausted notification shown for ${quota.modelName}`);
    }

    /**
     * Formats reset time for display.
     */
    private formatResetTime(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    /**
     * Clears notification state for a model.
     */
    public clearState(modelId: string): void {
        this.notificationStates.delete(modelId);
    }

    /**
     * Clears all notification states.
     */
    public clearAllStates(): void {
        this.notificationStates.clear();
    }

    /**
     * Sets the cooldown period between repeated notifications.
     */
    public setCooldown(ms: number): void {
        this.cooldownMs = ms;
    }
}

// Export singleton
export const notificationManager = NotificationManager.getInstance();
