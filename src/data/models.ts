/**
 * Data models for quota information in Antigravity Usage Stats.
 */

/**
 * Represents the status of a quota.
 */
export enum QuotaStatus {
    HEALTHY = 'healthy',
    WARNING = 'warning',
    CRITICAL = 'critical',
    EXHAUSTED = 'exhausted',
    UNKNOWN = 'unknown',
}

/**
 * Represents a single AI model's quota information.
 */
export interface QuotaInfo {
    /** Unique identifier for the model */
    modelId: string;
    /** Display name of the model */
    modelName: string;
    /** ID of the quota pool this model belongs to */
    poolId: string;
    /** Current remaining quota amount */
    remaining: number;
    /** Maximum quota capacity */
    capacity: number;
    /** Percentage of quota remaining (0-100) */
    percentRemaining: number;
    /** Current quota status based on thresholds */
    status: QuotaStatus;
    /** Timestamp of next quota reset */
    resetTime: Date | null;
    /** Seconds until quota resets */
    resetInSeconds: number | null;
    /** Last time this quota was fetched */
    lastUpdated: Date;
}

/**
 * Represents a group of models sharing the same quota pool.
 */
export interface QuotaGroup {
    /** Pool ID for this group */
    poolId: string;
    /** Display name for the group */
    groupName: string;
    /** Custom name set by user (if any) */
    customName?: string;
    /** Models in this group */
    models: QuotaInfo[];
    /** Aggregate remaining quota */
    totalRemaining: number;
    /** Aggregate capacity */
    totalCapacity: number;
    /** Aggregate percentage remaining */
    percentRemaining: number;
    /** Current status based on thresholds */
    status: QuotaStatus;
    /** Next reset time (earliest among all models) */
    resetTime: Date | null;
}

/**
 * Configuration for quota thresholds.
 */
export interface ThresholdConfig {
    /** Yellow warning threshold (percentage) */
    warning: number;
    /** Red critical threshold (percentage) */
    critical: number;
}

/**
 * Result of a quota fetch operation.
 */
export interface FetchResult {
    /** Whether the fetch was successful */
    success: boolean;
    /** Fetched quota data */
    quotas: QuotaInfo[];
    /** Error message if fetch failed */
    error?: string;
    /** Source of the data */
    source: 'local' | 'remote' | 'cache';
    /** Timestamp of the fetch */
    timestamp: Date;
}

/**
 * Account information for multi-account support.
 */
export interface AccountInfo {
    /** Unique account ID */
    id: string;
    /** Display name */
    displayName: string;
    /** Email address (masked) */
    email: string;
    /** Whether this is the active account */
    isActive: boolean;
    /** Last sync time */
    lastSync: Date | null;
}

/**
 * Usage history entry for charts.
 */
export interface UsageHistoryEntry {
    /** Timestamp of the entry */
    timestamp: Date;
    /** Model or pool ID */
    entityId: string;
    /** Usage amount at this point */
    usage: number;
    /** Remaining quota at this point */
    remaining: number;
}

/**
 * Helper functions for working with quota data.
 */
export const QuotaHelpers = {
    /**
     * Calculates the status based on remaining percentage and thresholds.
     */
    calculateStatus(percentRemaining: number, thresholds: ThresholdConfig): QuotaStatus {
        if (percentRemaining <= 0) {
            return QuotaStatus.EXHAUSTED;
        }
        if (percentRemaining <= thresholds.critical) {
            return QuotaStatus.CRITICAL;
        }
        if (percentRemaining <= thresholds.warning) {
            return QuotaStatus.WARNING;
        }
        return QuotaStatus.HEALTHY;
    },

    /**
     * Formats reset time as a human-readable countdown.
     */
    formatResetCountdown(resetInSeconds: number | null): string {
        if (resetInSeconds === null || resetInSeconds < 0) {
            return 'Unknown';
        }

        const hours = Math.floor(resetInSeconds / 3600);
        const minutes = Math.floor((resetInSeconds % 3600) / 60);
        const seconds = resetInSeconds % 60;

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        }
        return `${seconds}s`;
    },

    /**
     * Gets the color for a status.
     */
    getStatusColor(status: QuotaStatus): string {
        switch (status) {
            case QuotaStatus.HEALTHY:
                return '#22c55e'; // green
            case QuotaStatus.WARNING:
                return '#eab308'; // yellow
            case QuotaStatus.CRITICAL:
                return '#ef4444'; // red
            case QuotaStatus.EXHAUSTED:
                return '#6b7280'; // gray
            default:
                return '#9ca3af'; // light gray
        }
    },

    /**
     * Gets the icon for a status.
     */
    getStatusIcon(status: QuotaStatus): string {
        switch (status) {
            case QuotaStatus.HEALTHY:
                return '✅';
            case QuotaStatus.WARNING:
                return '⚠️';
            case QuotaStatus.CRITICAL:
                return '🔴';
            case QuotaStatus.EXHAUSTED:
                return '⛔';
            default:
                return '❓';
        }
    },

    /**
     * Creates a QuotaInfo object with calculated fields.
     */
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
            lastUpdated: new Date(),
        };
    },
};
