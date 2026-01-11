import { logger } from '../services/logger';
import { QuotaInfo, QuotaGroup, QuotaStatus, ThresholdConfig, QuotaHelpers } from './models';

/**
 * Service for grouping quotas by their pool IDs.
 */
export class QuotaGrouper {
    private static instance: QuotaGrouper;
    private customGroupNames: Map<string, string> = new Map();

    private constructor() { }

    /**
     * Gets the singleton instance.
     */
    public static getInstance(): QuotaGrouper {
        if (!QuotaGrouper.instance) {
            QuotaGrouper.instance = new QuotaGrouper();
        }
        return QuotaGrouper.instance;
    }

    /**
     * Sets a custom name for a group.
     */
    public setCustomGroupName(poolId: string, name: string): void {
        this.customGroupNames.set(poolId, name);
        logger.debug(`Custom group name set: ${poolId} -> ${name}`);
    }

    /**
     * Gets the custom name for a group if set.
     */
    public getCustomGroupName(poolId: string): string | undefined {
        return this.customGroupNames.get(poolId);
    }

    /**
     * Clears all custom group names.
     */
    public clearCustomNames(): void {
        this.customGroupNames.clear();
    }

    /**
     * Groups quotas by their pool IDs.
     */
    public groupByPool(quotas: QuotaInfo[], thresholds: ThresholdConfig): QuotaGroup[] {
        logger.debug(`Grouping ${quotas.length} quotas by pool`);

        // Group quotas by pool ID
        const poolMap = new Map<string, QuotaInfo[]>();

        for (const quota of quotas) {
            const existing = poolMap.get(quota.poolId) || [];
            existing.push(quota);
            poolMap.set(quota.poolId, existing);
        }

        // Create QuotaGroup objects
        const groups: QuotaGroup[] = [];

        for (const [poolId, models] of poolMap) {
            const group = this.createGroup(poolId, models, thresholds);
            groups.push(group);
        }

        // Sort groups by status (critical first) then by name
        groups.sort((a, b) => {
            const statusOrder = {
                [QuotaStatus.EXHAUSTED]: 0,
                [QuotaStatus.CRITICAL]: 1,
                [QuotaStatus.WARNING]: 2,
                [QuotaStatus.HEALTHY]: 3,
                [QuotaStatus.UNKNOWN]: 4,
            };

            const statusDiff = statusOrder[a.status] - statusOrder[b.status];
            if (statusDiff !== 0) return statusDiff;

            return a.groupName.localeCompare(b.groupName);
        });

        logger.debug(`Created ${groups.length} groups`);
        return groups;
    }

    /**
     * Flattens grouped quotas back into a list, maintaining group order.
     */
    public flattenGroups(groups: QuotaGroup[]): QuotaInfo[] {
        const result: QuotaInfo[] = [];
        for (const group of groups) {
            result.push(...group.models);
        }
        return result;
    }

    /**
     * Creates a QuotaGroup from a list of models.
     */
    private createGroup(
        poolId: string,
        models: QuotaInfo[],
        thresholds: ThresholdConfig
    ): QuotaGroup {
        // Calculate aggregates
        const totalRemaining = models.reduce((sum, m) => sum + m.remaining, 0);
        const totalCapacity = models.reduce((sum, m) => sum + m.capacity, 0);
        const percentRemaining = totalCapacity > 0 ? (totalRemaining / totalCapacity) * 100 : 0;

        // Find earliest reset time
        const validResetTimes = models
            .map(m => m.resetTime)
            .filter((t): t is Date => t !== null);
        const resetTime = validResetTimes.length > 0
            ? new Date(Math.min(...validResetTimes.map(t => t.getTime())))
            : null;

        // Generate group name from pool ID
        const groupName = this.generateGroupName(poolId);
        const customName = this.customGroupNames.get(poolId);

        // Calculate status based on aggregate or worst case
        const worstStatus = models.reduce((worst, m) => {
            const statusOrder = {
                [QuotaStatus.EXHAUSTED]: 0,
                [QuotaStatus.CRITICAL]: 1,
                [QuotaStatus.WARNING]: 2,
                [QuotaStatus.HEALTHY]: 3,
                [QuotaStatus.UNKNOWN]: 4,
            };
            return statusOrder[m.status] < statusOrder[worst] ? m.status : worst;
        }, QuotaStatus.HEALTHY as QuotaStatus);

        return {
            poolId,
            groupName,
            customName,
            models,
            totalRemaining,
            totalCapacity,
            percentRemaining,
            status: worstStatus,
            resetTime,
        };
    }

    /**
     * Generates a human-readable group name from a pool ID.
     */
    private generateGroupName(poolId: string): string {
        // Convert 'gemini-flash-pool' to 'Gemini Flash'
        return poolId
            .replace(/-pool$/i, '')
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
}

// Export singleton
export const quotaGrouper = QuotaGrouper.getInstance();
