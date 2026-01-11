import * as vscode from 'vscode';
import { logger } from '../services/logger';
import { AntigravityError, ErrorType } from '../services/errorHandler';
import { QuotaInfo, FetchResult, QuotaHelpers, ThresholdConfig } from './models';
import { antigravityClient } from './antigravityClient';

/**
 * Configuration for the quota fetcher.
 */
export interface FetcherConfig {
    /** URL for remote API (if using remote fetch) */
    remoteUrl?: string;
    /** Timeout for fetch operations in ms */
    timeout: number;
    /** Threshold configuration */
    thresholds: ThresholdConfig;
}

/**
 * Service for fetching quota data from local or remote sources.
 */
export class QuotaFetcher {
    private static instance: QuotaFetcher;
    private config: FetcherConfig = {
        timeout: 10000,
        thresholds: { warning: 30, critical: 10 },
    };
    private lastFetchResult: FetchResult | null = null;
    private abortController: AbortController | null = null;

    private constructor() { }

    /**
     * Gets the singleton instance.
     */
    public static getInstance(): QuotaFetcher {
        if (!QuotaFetcher.instance) {
            QuotaFetcher.instance = new QuotaFetcher();
        }
        return QuotaFetcher.instance;
    }

    /**
     * Updates the fetcher configuration.
     */
    public configure(config: Partial<FetcherConfig>): void {
        this.config = { ...this.config, ...config };
        logger.debug('QuotaFetcher configured', this.config);
    }

    /**
     * Updates thresholds from VS Code configuration.
     */
    public updateThresholdsFromConfig(): void {
        const vsConfig = vscode.workspace.getConfiguration('antigravityUsageStats');
        this.config.thresholds = {
            warning: vsConfig.get<number>('warningThreshold', 30),
            critical: vsConfig.get<number>('criticalThreshold', 10),
        };
        logger.debug('Thresholds updated from config', this.config.thresholds);
    }

    /**
     * Fetches quota data from the appropriate source.
     */
    public async fetch(): Promise<FetchResult> {
        logger.info('Fetching quota data...');
        this.updateThresholdsFromConfig();

        try {
            // Cancel any in-flight request
            this.abort();
            this.abortController = new AbortController();

            // Try local fetch first, then remote
            let result: FetchResult;

            try {
                result = await this.fetchLocal();
            } catch (localError) {
                if (this.config.remoteUrl) {
                    result = await this.fetchRemote();
                } else {
                    // No mock data - return empty result with clear error
                    const errorMsg = localError instanceof Error 
                        ? localError.message 
                        : 'Antigravity language server not found. Please ensure Antigravity is installed and running.';
                    logger.warn(`Local fetch failed: ${errorMsg}`);
                    return {
                        success: false,
                        quotas: [],
                        error: errorMsg,
                        source: 'local',
                        timestamp: new Date(),
                    };
                }
            }

            this.lastFetchResult = result;
            logger.info(`Fetch complete: ${result.quotas.length} quotas from ${result.source}`);
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error('Fetch failed', error instanceof Error ? error : undefined);

            // Return cached data if available
            if (this.lastFetchResult) {
                logger.info('Returning cached data');
                return {
                    ...this.lastFetchResult,
                    source: 'cache',
                    error: errorMessage,
                };
            }

            return {
                success: false,
                quotas: [],
                error: errorMessage,
                source: 'cache',
                timestamp: new Date(),
            };
        }
    }

    /**
     * Aborts any in-flight fetch operation.
     */
    public abort(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    /**
     * Gets the last fetch result (cached data).
     */
    public getLastResult(): FetchResult | null {
        return this.lastFetchResult;
    }

    /**
     * Fetches quota data from local Antigravity language server.
     */
    private async fetchLocal(): Promise<FetchResult> {
        logger.debug('Attempting to connect to Antigravity language server...');

        // Set thresholds
        antigravityClient.setThresholds(this.config.thresholds);

        // Fetch quota data (client handles connection automatically)
        const result = await antigravityClient.fetchQuota();

        if (!result.success) {
            throw new AntigravityError(
                result.error || 'Failed to fetch from Antigravity',
                ErrorType.NETWORK
            );
        }

        return result;
    }

    /**
     * Fetches quota data from remote API.
     */
    private async fetchRemote(): Promise<FetchResult> {
        if (!this.config.remoteUrl) {
            throw new AntigravityError(
                'Remote URL not configured',
                ErrorType.CONFIGURATION
            );
        }

        logger.debug(`Fetching from remote: ${this.config.remoteUrl}`);

        const response = await fetch(this.config.remoteUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            signal: this.abortController?.signal,
        });

        if (!response.ok) {
            throw new AntigravityError(
                `Remote fetch failed: ${response.status}`,
                ErrorType.NETWORK
            );
        }

        const data = await response.json();
        return this.parseRemoteResponse(data);
    }

    /**
     * Parses remote API response into FetchResult.
     */
    private parseRemoteResponse(data: unknown): FetchResult {
        // This would be customized based on actual API response format
        if (!Array.isArray(data)) {
            throw new AntigravityError(
                'Invalid response format',
                ErrorType.PARSING
            );
        }

        const quotas: QuotaInfo[] = data.map((item: Record<string, unknown>) =>
            QuotaHelpers.createQuotaInfo(
                String(item.id || ''),
                String(item.name || 'Unknown Model'),
                String(item.poolId || 'default'),
                Number(item.remaining || 0),
                Number(item.capacity || 100),
                item.resetTime ? new Date(String(item.resetTime)) : null,
                this.config.thresholds
            )
        );

        return {
            success: true,
            quotas,
            source: 'remote',
            timestamp: new Date(),
        };
    }

}

// Export singleton
export const quotaFetcher = QuotaFetcher.getInstance();
