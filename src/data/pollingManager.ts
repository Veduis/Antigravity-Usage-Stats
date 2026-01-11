import * as vscode from 'vscode';
import { logger } from '../services/logger';
import { quotaFetcher } from './quotaFetcher';
import { FetchResult } from './models';

/**
 * Event emitter for quota updates.
 */
export type QuotaUpdateListener = (result: FetchResult) => void;

/**
 * Service for managing periodic polling of quota data.
 */
export class PollingManager {
    private static instance: PollingManager;
    private timer: NodeJS.Timeout | null = null;
    private intervalSeconds: number = 120;
    private listeners: Set<QuotaUpdateListener> = new Set();
    private isPaused: boolean = false;
    private lastPollTime: Date | null = null;

    private constructor() {
        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravityStats.refreshInterval')) {
                this.updateIntervalFromConfig();
                this.restart();
            }
        });
    }

    /**
     * Gets the singleton instance.
     */
    public static getInstance(): PollingManager {
        if (!PollingManager.instance) {
            PollingManager.instance = new PollingManager();
        }
        return PollingManager.instance;
    }

    /**
     * Starts the polling timer.
     */
    public start(): void {
        if (this.timer) {
            logger.debug('Polling already running');
            return;
        }

        this.updateIntervalFromConfig();
        logger.info(`Starting polling with ${this.intervalSeconds}s interval`);

        // Do an immediate fetch
        this.poll();

        // Start the timer
        this.timer = setInterval(() => {
            if (!this.isPaused) {
                this.poll();
            }
        }, this.intervalSeconds * 1000);
    }

    /**
     * Stops the polling timer.
     */
    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            logger.info('Polling stopped');
        }
    }

    /**
     * Restarts the polling timer with current configuration.
     */
    public restart(): void {
        this.stop();
        this.start();
    }

    /**
     * Pauses polling without stopping the timer.
     */
    public pause(): void {
        this.isPaused = true;
        logger.debug('Polling paused');
    }

    /**
     * Resumes polling.
     */
    public resume(): void {
        this.isPaused = false;
        logger.debug('Polling resumed');
    }

    /**
     * Triggers an immediate poll.
     */
    public async pollNow(): Promise<FetchResult> {
        return this.poll();
    }

    /**
     * Adds a listener for quota updates.
     */
    public addListener(listener: QuotaUpdateListener): void {
        this.listeners.add(listener);
    }

    /**
     * Removes a listener.
     */
    public removeListener(listener: QuotaUpdateListener): void {
        this.listeners.delete(listener);
    }

    /**
     * Gets the polling interval in seconds.
     */
    public getInterval(): number {
        return this.intervalSeconds;
    }

    /**
     * Gets the time of the last poll.
     */
    public getLastPollTime(): Date | null {
        return this.lastPollTime;
    }

    /**
     * Checks if polling is currently running.
     */
    public isRunning(): boolean {
        return this.timer !== null;
    }

    /**
     * Updates the interval from VS Code configuration.
     */
    private updateIntervalFromConfig(): void {
        const config = vscode.workspace.getConfiguration('antigravityStats');
        const interval = config.get<number>('refreshInterval', 120);

        // Clamp to valid range (10-3600 seconds)
        this.intervalSeconds = Math.max(10, Math.min(3600, interval));

        logger.debug(`Polling interval set to ${this.intervalSeconds}s`);
    }

    /**
     * Performs a poll and notifies listeners.
     */
    private async poll(): Promise<FetchResult> {
        logger.debug('Polling for quota data...');
        this.lastPollTime = new Date();

        try {
            const result = await quotaFetcher.fetch();

            // Notify all listeners
            for (const listener of this.listeners) {
                try {
                    listener(result);
                } catch (error) {
                    logger.error('Error in quota update listener', error instanceof Error ? error : undefined);
                }
            }

            return result;
        } catch (error) {
            logger.error('Polling failed', error instanceof Error ? error : undefined);

            const errorResult: FetchResult = {
                success: false,
                quotas: [],
                error: error instanceof Error ? error.message : 'Unknown error',
                source: 'cache',
                timestamp: new Date(),
            };

            // Still notify listeners of failure
            for (const listener of this.listeners) {
                try {
                    listener(errorResult);
                } catch (e) {
                    logger.error('Error in quota update listener', e instanceof Error ? e : undefined);
                }
            }

            return errorResult;
        }
    }
}

// Export singleton
export const pollingManager = PollingManager.getInstance();
