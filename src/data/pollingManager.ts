import * as vscode from 'vscode';
import { logger } from '../services/logger';
import { quotaFetcher } from './quotaFetcher';
import { FetchResult } from './models';
import { antigravityClient } from './antigravityClient';

export type QuotaUpdateListener = (result: FetchResult) => void;

/** Auto-reconnect delay in ms after a failed fetch. */
const RECONNECT_DELAY_MS = 8000;

/**
 * Manages periodic polling of quota data.
 * Handles auto-reconnect when connection is lost (e.g. after laptop sleep/resume).
 */
export class PollingManager {
    private static instance: PollingManager;
    private timer: NodeJS.Timeout | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private intervalSeconds: number = 120;
    private listeners: Set<QuotaUpdateListener> = new Set();
    private isPaused: boolean = false;
    private lastPollTime: Date | null = null;
    private consecutiveFailures: number = 0;

    private constructor() {
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravityUsageStats.refreshInterval') ||
                e.affectsConfiguration('antigravityUsageStats.enabled')) {
                this.handleConfigChange();
            }
        });
    }

    public static getInstance(): PollingManager {
        if (!PollingManager.instance) {
            PollingManager.instance = new PollingManager();
        }
        return PollingManager.instance;
    }

    public start(): void {
        if (!this.isEnabled()) {
            logger.info('Polling disabled via settings, skipping start');
            return;
        }

        if (this.timer) {
            logger.debug('Polling already running');
            return;
        }

        this.updateIntervalFromConfig();
        logger.info(`Starting polling with ${this.intervalSeconds}s interval`);

        // Immediate fetch on start
        this.poll();

        this.timer = setInterval(() => {
            if (!this.isPaused) { this.poll(); }
        }, this.intervalSeconds * 1000);
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            logger.info('Polling stopped');
        }
        this.clearReconnectTimer();
    }

    public restart(): void {
        this.stop();
        this.start();
    }

    public pause(): void {
        this.isPaused = true;
        logger.debug('Polling paused');
    }

    public resume(): void {
        this.isPaused = false;
        logger.debug('Polling resumed');
    }

    public async pollNow(): Promise<FetchResult> {
        return this.poll();
    }

    /** Force-reconnect to Antigravity and then poll. */
    public async reconnect(): Promise<void> {
        logger.info('Manual reconnect triggered');
        this.consecutiveFailures = 0;
        this.clearReconnectTimer();
        antigravityClient.disconnect();
        await this.poll();
    }

    public addListener(listener: QuotaUpdateListener): void {
        this.listeners.add(listener);
    }

    public removeListener(listener: QuotaUpdateListener): void {
        this.listeners.delete(listener);
    }

    public getInterval(): number { return this.intervalSeconds; }
    public getLastPollTime(): Date | null { return this.lastPollTime; }
    public isRunning(): boolean { return this.timer !== null; }

    private isEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        return config.get<boolean>('enabled', true);
    }

    private handleConfigChange(): void {
        if (this.isEnabled()) {
            this.updateIntervalFromConfig();
            this.restart();
        } else {
            this.stop();
        }
    }

    private updateIntervalFromConfig(): void {
        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        const interval = config.get<number>('refreshInterval', 120);
        this.intervalSeconds = Math.max(10, Math.min(3600, interval));
        logger.debug(`Polling interval set to ${this.intervalSeconds}s`);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /** Schedules an auto-reconnect attempt after failures. */
    private scheduleReconnect(): void {
        this.clearReconnectTimer();
        const delay = Math.min(RECONNECT_DELAY_MS * this.consecutiveFailures, 60000);
        logger.info(`Auto-reconnect scheduled in ${delay / 1000}s (failure #${this.consecutiveFailures})`);
        this.reconnectTimer = setTimeout(async () => {
            logger.info('Auto-reconnect: attempting to reconnect...');
            antigravityClient.disconnect();
            await this.poll();
        }, delay);
    }

    private async poll(): Promise<FetchResult> {
        logger.debug('Polling for quota data...');
        this.lastPollTime = new Date();

        try {
            const result = await quotaFetcher.fetch();

            if (result.success) {
                this.consecutiveFailures = 0;
                this.clearReconnectTimer();
            } else {
                this.consecutiveFailures++;
                // Auto-reconnect on repeated failures (handles sleep/resume)
                if (this.consecutiveFailures >= 2) {
                    this.scheduleReconnect();
                }
            }

            for (const listener of this.listeners) {
                try { listener(result); } catch (e) {
                    logger.error('Error in quota update listener', e instanceof Error ? e : undefined);
                }
            }

            return result;
        } catch (error) {
            logger.error('Polling failed', error instanceof Error ? error : undefined);
            this.consecutiveFailures++;

            const errorResult: FetchResult = {
                success: false,
                quotas: [],
                error: error instanceof Error ? error.message : 'Unknown error',
                source: 'cache',
                timestamp: new Date(),
            };

            for (const listener of this.listeners) {
                try { listener(errorResult); } catch (e) {
                    logger.error('Error in listener', e instanceof Error ? e : undefined);
                }
            }

            return errorResult;
        }
    }
}

export const pollingManager = PollingManager.getInstance();
