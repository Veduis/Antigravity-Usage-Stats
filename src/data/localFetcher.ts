import { logger } from '../services/logger';
import { AntigravityError, ErrorType } from '../services/errorHandler';
import { QuotaInfo, FetchResult, QuotaHelpers, ThresholdConfig } from './models';

/**
 * Default Antigravity server configuration.
 */
const ANTIGRAVITY_SERVER = {
    host: 'localhost',
    port: 42424,
    endpoints: {
        userStatus: '/GetUserStatus',
        modelList: '/GetModelList',
    },
};

/**
 * Raw quota data from Antigravity server.
 */
interface AntigravityQuotaRaw {
    modelId?: string;
    model?: string;
    name?: string;
    displayName?: string;
    remaining?: number;
    limit?: number;
    capacity?: number;
    used?: number;
    total?: number;
    resetTime?: string | number;
    resetAt?: string | number;
    poolId?: string;
    pool?: string;
    tier?: string;
}

/**
 * Raw response from Antigravity server.
 */
interface AntigravityResponse {
    quotas?: AntigravityQuotaRaw[];
    models?: AntigravityQuotaRaw[];
    usage?: AntigravityQuotaRaw[];
    data?: AntigravityQuotaRaw[];
    user?: {
        quotas?: AntigravityQuotaRaw[];
    };
    error?: string;
    success?: boolean;
}

/**
 * Fetches quota data from the local Antigravity server.
 */
export class LocalAntigravityFetcher {
    private static instance: LocalAntigravityFetcher;
    private serverUrl: string;
    private thresholds: ThresholdConfig = { warning: 30, critical: 10 };
    private lastSuccessfulData: QuotaInfo[] | null = null;

    private constructor() {
        this.serverUrl = `http://${ANTIGRAVITY_SERVER.host}:${ANTIGRAVITY_SERVER.port}`;
    }

    /**
     * Gets the singleton instance.
     */
    public static getInstance(): LocalAntigravityFetcher {
        if (!LocalAntigravityFetcher.instance) {
            LocalAntigravityFetcher.instance = new LocalAntigravityFetcher();
        }
        return LocalAntigravityFetcher.instance;
    }

    /**
     * Sets threshold configuration.
     */
    public setThresholds(thresholds: ThresholdConfig): void {
        this.thresholds = thresholds;
    }

    /**
     * Checks if the local Antigravity server is available.
     */
    public async isServerAvailable(): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);

            const response = await fetch(this.serverUrl, {
                method: 'GET',
                signal: controller.signal,
            });

            clearTimeout(timeoutId);
            return response.ok || response.status === 404; // Server is up even if endpoint doesn't exist
        } catch {
            return false;
        }
    }

    /**
     * Fetches quota data from the local Antigravity server.
     */
    public async fetch(): Promise<FetchResult> {
        logger.debug(`Fetching from local Antigravity server: ${this.serverUrl}`);

        try {
            // Try multiple endpoints - different versions may use different ones
            let data: AntigravityResponse | null = null;

            for (const endpoint of [
                ANTIGRAVITY_SERVER.endpoints.userStatus,
                ANTIGRAVITY_SERVER.endpoints.modelList,
                '/api/status',
                '/api/quotas',
                '/status',
                '/quotas',
            ]) {
                try {
                    data = await this.fetchEndpoint(endpoint);
                    if (data) {
                        logger.info(`Successfully fetched from ${endpoint}`);
                        break;
                    }
                } catch {
                    // Try next endpoint
                    continue;
                }
            }

            if (!data) {
                throw new AntigravityError(
                    'No valid data from any endpoint',
                    ErrorType.NETWORK
                );
            }

            const quotas = this.parseResponse(data);
            this.lastSuccessfulData = quotas;

            return {
                success: true,
                quotas,
                source: 'local',
                timestamp: new Date(),
            };
        } catch (error) {
            logger.warn('Local fetch failed, checking for cached data');

            // Return cached data if available
            if (this.lastSuccessfulData) {
                return {
                    success: true,
                    quotas: this.lastSuccessfulData,
                    source: 'cache',
                    timestamp: new Date(),
                    error: error instanceof Error ? error.message : 'Fetch failed',
                };
            }

            throw error;
        }
    }

    /**
     * Fetches from a specific endpoint.
     */
    private async fetchEndpoint(endpoint: string): Promise<AntigravityResponse> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            const response = await fetch(`${this.serverUrl}${endpoint}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                },
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.json() as AntigravityResponse;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    /**
     * Parses the response from various possible formats.
     */
    private parseResponse(data: AntigravityResponse): QuotaInfo[] {
        // Try to find the quotas array in various possible locations
        const rawQuotas =
            data.quotas ||
            data.models ||
            data.usage ||
            data.data ||
            data.user?.quotas ||
            [];

        if (!Array.isArray(rawQuotas)) {
            logger.warn('Response does not contain a valid quotas array');
            return [];
        }

        return rawQuotas
            .map(raw => this.parseQuota(raw))
            .filter((q): q is QuotaInfo => q !== null);
    }

    /**
     * Parses a single quota entry.
     */
    private parseQuota(raw: AntigravityQuotaRaw): QuotaInfo | null {
        try {
            // Extract model ID and name
            const modelId = raw.modelId || raw.model || 'unknown';
            const modelName = raw.displayName || raw.name || raw.model || 'Unknown Model';

            // Extract quota values - handle various field names
            let remaining: number;
            let capacity: number;

            if (raw.remaining !== undefined && raw.limit !== undefined) {
                remaining = raw.remaining;
                capacity = raw.limit;
            } else if (raw.remaining !== undefined && raw.capacity !== undefined) {
                remaining = raw.remaining;
                capacity = raw.capacity;
            } else if (raw.used !== undefined && raw.total !== undefined) {
                remaining = raw.total - raw.used;
                capacity = raw.total;
            } else {
                // Default values if not found
                remaining = 0;
                capacity = 100;
            }

            // Extract pool ID
            const poolId = raw.poolId || raw.pool || raw.tier || this.inferPoolId(modelName);

            // Extract reset time
            let resetTime: Date | null = null;
            const resetRaw = raw.resetTime || raw.resetAt;
            if (resetRaw) {
                if (typeof resetRaw === 'number') {
                    // Unix timestamp (seconds or milliseconds)
                    resetTime = new Date(resetRaw > 1e10 ? resetRaw : resetRaw * 1000);
                } else {
                    resetTime = new Date(resetRaw);
                }
            }

            return QuotaHelpers.createQuotaInfo(
                modelId,
                modelName,
                poolId,
                remaining,
                capacity,
                resetTime,
                this.thresholds
            );
        } catch (error) {
            logger.warn(`Failed to parse quota entry: ${JSON.stringify(raw)}`);
            return null;
        }
    }

    /**
     * Infers a pool ID from the model name.
     */
    private inferPoolId(modelName: string): string {
        const lowerName = modelName.toLowerCase();

        if (lowerName.includes('claude')) {
            return 'claude-pool';
        }
        if (lowerName.includes('gemini') && lowerName.includes('pro')) {
            return 'gemini-pro-pool';
        }
        if (lowerName.includes('gemini') && lowerName.includes('flash')) {
            return 'gemini-flash-pool';
        }
        if (lowerName.includes('gemini')) {
            return 'gemini-pool';
        }
        if (lowerName.includes('gpt')) {
            return 'gpt-pool';
        }

        return 'default-pool';
    }
}

// Export singleton
export const localAntigravityFetcher = LocalAntigravityFetcher.getInstance();
