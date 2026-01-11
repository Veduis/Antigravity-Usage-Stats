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
        const vsConfig = vscode.workspace.getConfiguration('antigravityStats');
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
            } catch {
                if (this.config.remoteUrl) {
                    result = await this.fetchRemote();
                } else {
                    // Return mock data for development/testing
                    result = this.getMockData();
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

    /**
     * Returns mock data for development/testing.
     */
    private getMockData(): FetchResult {
        logger.debug('Using mock data');
        const now = new Date();
        const resetTime = new Date(now.getTime() + 5 * 60 * 60 * 1000); // 5 hours from now

        const mockQuotas: QuotaInfo[] = [
            // Claude Pool
            QuotaHelpers.createQuotaInfo(
                'claude-3.5-sonnet',
                'Claude 3.5 Sonnet',
                'claude-pool',
                5,
                50,
                resetTime,
                this.config.thresholds
            ),
            QuotaHelpers.createQuotaInfo(
                'claude-sonnet-4.5-thinking',
                'Claude Sonnet 4.5 (Thinking)',
                'claude-pool',
                35,
                50,
                resetTime,
                this.config.thresholds
            ),
            QuotaHelpers.createQuotaInfo(
                'claude-opus-4.5-thinking',
                'Claude Opus 4.5 (Thinking)',
                'claude-pool',
                49,
                50,
                resetTime,
                this.config.thresholds
            ),

            // Gemini Pro Pool
            QuotaHelpers.createQuotaInfo(
                'gemini-3-pro-high',
                'Gemini 3 Pro (High)',
                'gemini-pro-pool',
                100,
                100,
                resetTime,
                this.config.thresholds
            ),
            QuotaHelpers.createQuotaInfo(
                'gemini-3-pro-low',
                'Gemini 3 Pro (Low)',
                'gemini-pro-pool',
                100,
                100,
                resetTime,
                this.config.thresholds
            ),
            QuotaHelpers.createQuotaInfo(
                'gemini-2.0-pro',
                'Gemini 2.0 Pro',
                'gemini-pro-pool',
                85,
                100,
                resetTime,
                this.config.thresholds
            ),

            // Gemini Flash Pool
            QuotaHelpers.createQuotaInfo(
                'gemini-3-flash',
                'Gemini 3 Flash',
                'gemini-flash-pool',
                167,
                500,
                resetTime,
                this.config.thresholds
            ),
            QuotaHelpers.createQuotaInfo(
                'gemini-2.0-flash',
                'Gemini 2.0 Flash',
                'gemini-flash-pool',
                470,
                500,
                resetTime,
                this.config.thresholds
            ),
            QuotaHelpers.createQuotaInfo(
                'gemini-1.5-flash',
                'Gemini 1.5 Flash',
                'gemini-flash-pool',
                400,
                500,
                resetTime,
                this.config.thresholds
            ),

            // GPT Pool (Media.ml)
            QuotaHelpers.createQuotaInfo(
                'gpt-o55-1208',
                'GPT-O55-1208 (Media.ml)',
                'gpt-pool',
                60,
                100,
                resetTime,
                this.config.thresholds
            ),
        ];

        return {
            success: true,
            quotas: mockQuotas,
            source: 'local',
            timestamp: new Date(),
        };
    }
}

// Export singleton
export const quotaFetcher = QuotaFetcher.getInstance();
