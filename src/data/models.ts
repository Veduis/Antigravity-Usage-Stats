/**
 * Data models for quota information in Antigravity Usage Stats.
 */

export enum QuotaStatus {
    HEALTHY = 'healthy',
    WARNING = 'warning',
    CRITICAL = 'critical',
    EXHAUSTED = 'exhausted',
    UNKNOWN = 'unknown',
}

export interface QuotaInfo {
    modelId: string;
    modelName: string;
    poolId: string;
    remaining: number;
    capacity: number;
    percentRemaining: number;
    status: QuotaStatus;
    resetTime: Date | null;
    resetInSeconds: number | null;
    /** Formatted reset time: countdown + absolute (e.g. "3h 24m (22:30)") */
    resetFormatted: string;
    lastUpdated: Date;
}

export interface QuotaGroup {
    poolId: string;
    groupName: string;
    customName?: string;
    models: QuotaInfo[];
    totalRemaining: number;
    totalCapacity: number;
    percentRemaining: number;
    status: QuotaStatus;
    resetTime: Date | null;
}

export interface ThresholdConfig {
    warning: number;
    critical: number;
}

/** Prompt credits (plan-level budget separate from per-model quotas). */
export interface PromptCreditsInfo {
    available: number;
    monthly: number;
    usedPercentage: number;
    remainingPercentage: number;
}

export interface FetchResult {
    success: boolean;
    quotas: QuotaInfo[];
    promptCredits?: PromptCreditsInfo;
    error?: string;
    source: 'local' | 'remote' | 'cache';
    timestamp: Date;
}

export interface AccountInfo {
    id: string;
    displayName: string;
    email: string;
    isActive: boolean;
    lastSync: Date | null;
}

export interface UsageHistoryEntry {
    timestamp: Date;
    entityId: string;
    usage: number;
    remaining: number;
}

export const QuotaHelpers = {
    calculateStatus(percentRemaining: number, thresholds: ThresholdConfig): QuotaStatus {
        if (percentRemaining <= 0) { return QuotaStatus.EXHAUSTED; }
        if (percentRemaining <= thresholds.critical) { return QuotaStatus.CRITICAL; }
        if (percentRemaining <= thresholds.warning) { return QuotaStatus.WARNING; }
        return QuotaStatus.HEALTHY;
    },

    formatResetCountdown(resetInSeconds: number | null): string {
        if (resetInSeconds === null || resetInSeconds < 0) { return 'Unknown'; }
        const hours = Math.floor(resetInSeconds / 3600);
        const minutes = Math.floor((resetInSeconds % 3600) / 60);
        const seconds = resetInSeconds % 60;
        if (hours > 0) { return `${hours}h ${minutes}m`; }
        if (minutes > 0) { return `${minutes}m ${seconds}s`; }
        return `${seconds}s`;
    },

    /** Returns "3h 24m (22:30)" — countdown + absolute local time. */
    formatResetFull(resetTime: Date | null): string {
        if (!resetTime) { return 'Unknown'; }
        const now = Date.now();
        const diffMs = resetTime.getTime() - now;
        if (diffMs <= 0) { return 'Ready'; }

        const countdown = QuotaHelpers.formatResetCountdown(Math.floor(diffMs / 1000));
        const absTime = resetTime.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
        return `${countdown} (${absTime})`;
    },

    getStatusColor(status: QuotaStatus): string {
        switch (status) {
            case QuotaStatus.HEALTHY:   return '#22c55e';
            case QuotaStatus.WARNING:   return '#eab308';
            case QuotaStatus.CRITICAL:  return '#ef4444';
            case QuotaStatus.EXHAUSTED: return '#6b7280';
            default:                    return '#9ca3af';
        }
    },

    getStatusIcon(status: QuotaStatus): string {
        switch (status) {
            case QuotaStatus.HEALTHY:   return '✅';
            case QuotaStatus.WARNING:   return '⚠️';
            case QuotaStatus.CRITICAL:  return '🔴';
            case QuotaStatus.EXHAUSTED: return '⛔';
            default:                    return '❓';
        }
    },

    createQuotaInfo(
        modelId: string,
        modelName: string,
        poolId: string,
        remaining: number,
        capacity: number,
        resetTime: Date | null,
        thresholds: ThresholdConfig
    ): QuotaInfo {
        const percentRemaining = capacity > 0 ? (remaining / capacity) * 100 : 0;
        const resetInSeconds = resetTime
            ? Math.max(0, Math.floor((resetTime.getTime() - Date.now()) / 1000))
            : null;

        return {
            modelId,
            modelName,
            poolId,
            remaining,
            capacity,
            percentRemaining,
            status: QuotaHelpers.calculateStatus(percentRemaining, thresholds),
            resetTime,
            resetInSeconds,
            resetFormatted: QuotaHelpers.formatResetFull(resetTime),
            lastUpdated: new Date(),
        };
    },
};
