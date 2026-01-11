import * as vscode from 'vscode';
import { logger } from '../services/logger';
import { pollingManager } from '../data/pollingManager';

/**
 * Represents a scheduled wake task.
 */
interface ScheduledTask {
    id: string;
    cronExpression: string;
    enabled: boolean;
    lastRun: Date | null;
    nextRun: Date | null;
}

/**
 * Simple cron parser for common patterns.
 * Supports: minute hour day-of-month month day-of-week
 */
class CronParser {
    /**
     * Parses a cron expression and returns the next run time.
     */
    static getNextRunTime(cronExpression: string): Date | null {
        try {
            const parts = cronExpression.split(' ');
            if (parts.length !== 5) {
                return null;
            }

            const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
            const now = new Date();
            const next = new Date(now);

            // Simple implementation: find next matching time
            // For full cron support, a library would be needed
            if (minute !== '*') {
                next.setMinutes(parseInt(minute, 10));
            }
            if (hour !== '*') {
                next.setHours(parseInt(hour, 10));
            }

            // If the time is in the past today, move to tomorrow
            if (next <= now) {
                next.setDate(next.getDate() + 1);
            }

            next.setSeconds(0);
            next.setMilliseconds(0);

            return next;
        } catch {
            return null;
        }
    }

    /**
     * Validates a cron expression.
     */
    static validate(cronExpression: string): boolean {
        const parts = cronExpression.split(' ');
        if (parts.length !== 5) {
            return false;
        }

        // Basic validation: each part should be * or a number
        for (const part of parts) {
            if (part !== '*' && !/^\d+$/.test(part)) {
                // Allow ranges like 1-5 and lists like 1,3,5
                if (!/^(\d+(-\d+)?(,\d+(-\d+)?)*)$/.test(part)) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Gets a human-readable description of the schedule.
     */
    static describe(cronExpression: string): string {
        const parts = cronExpression.split(' ');
        if (parts.length !== 5) {
            return 'Invalid expression';
        }

        const [minute, hour] = parts;

        // Common patterns
        if (minute === '0' && hour !== '*') {
            return `Daily at ${hour}:00`;
        }
        if (minute !== '*' && hour !== '*') {
            return `Daily at ${hour}:${minute.padStart(2, '0')}`;
        }

        return `Cron: ${cronExpression}`;
    }
}

/**
 * Manages scheduled wake-up tasks.
 */
export class SchedulerManager {
    private static instance: SchedulerManager;
    private timer: NodeJS.Timeout | null = null;
    private currentTask: ScheduledTask | null = null;
    private checkIntervalMs: number = 60000; // Check every minute

    private constructor() { }

    /**
     * Gets the singleton instance.
     */
    public static getInstance(): SchedulerManager {
        if (!SchedulerManager.instance) {
            SchedulerManager.instance = new SchedulerManager();
        }
        return SchedulerManager.instance;
    }

    /**
     * Initializes the scheduler from configuration.
     */
    public initialize(): void {
        this.loadFromConfig();
        this.startChecking();

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravityUsageStats.autoWakeSchedule')) {
                this.loadFromConfig();
            }
        });

        logger.info('SchedulerManager initialized');
    }

    /**
     * Loads schedule from VS Code configuration.
     */
    private loadFromConfig(): void {
        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        const cronExpression = config.get<string>('autoWakeSchedule', '');

        if (cronExpression && CronParser.validate(cronExpression)) {
            this.currentTask = {
                id: 'auto-wake',
                cronExpression,
                enabled: true,
                lastRun: null,
                nextRun: CronParser.getNextRunTime(cronExpression),
            };
            logger.info(`Scheduler configured: ${CronParser.describe(cronExpression)}`);
        } else {
            this.currentTask = null;
            if (cronExpression) {
                logger.warn(`Invalid cron expression: ${cronExpression}`);
            }
        }
    }

    /**
     * Starts the periodic checking.
     */
    private startChecking(): void {
        if (this.timer) {
            clearInterval(this.timer);
        }

        this.timer = setInterval(() => this.check(), this.checkIntervalMs);
        logger.debug('Scheduler checking started');
    }

    /**
     * Stops the scheduler.
     */
    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        logger.info('Scheduler stopped');
    }

    /**
     * Checks if it's time to run the scheduled task.
     */
    private check(): void {
        if (!this.currentTask || !this.currentTask.enabled || !this.currentTask.nextRun) {
            return;
        }

        const now = new Date();

        if (now >= this.currentTask.nextRun) {
            this.executeTask();

            // Calculate next run time
            this.currentTask.lastRun = now;
            this.currentTask.nextRun = CronParser.getNextRunTime(this.currentTask.cronExpression);
        }
    }

    /**
     * Executes the scheduled task (refresh quota data).
     */
    private async executeTask(): Promise<void> {
        logger.info('Executing scheduled auto-wake task...');

        try {
            await pollingManager.pollNow();
            logger.info('Auto-wake task completed successfully');
        } catch (error) {
            logger.error('Auto-wake task failed', error instanceof Error ? error : undefined);
        }
    }

    /**
     * Gets the current schedule info.
     */
    public getScheduleInfo(): { expression: string; description: string; nextRun: Date | null } | null {
        if (!this.currentTask) {
            return null;
        }

        return {
            expression: this.currentTask.cronExpression,
            description: CronParser.describe(this.currentTask.cronExpression),
            nextRun: this.currentTask.nextRun,
        };
    }

    /**
     * Prompts user to configure the schedule.
     */
    public async configure(): Promise<void> {
        const config = vscode.workspace.getConfiguration('antigravityUsageStats');
        const current = config.get<string>('autoWakeSchedule', '');

        const presets = [
            { label: '$(clock) Every hour', description: 'At minute 0', value: '0 * * * *' },
            { label: '$(calendar) Daily at 9 AM', description: 'Every day at 9:00', value: '0 9 * * *' },
            { label: '$(calendar) Daily at 6 PM', description: 'Every day at 18:00', value: '0 18 * * *' },
            { label: '$(edit) Custom...', description: 'Enter custom cron expression', value: '__custom__' },
            { label: '$(x) Disable', description: 'Turn off auto-wake', value: '' },
        ];

        const selected = await vscode.window.showQuickPick(presets, {
            placeHolder: 'Select auto-wake schedule',
        });

        if (!selected) {
            return;
        }

        let value = selected.value;

        if (value === '__custom__') {
            const custom = await vscode.window.showInputBox({
                prompt: 'Enter cron expression (minute hour day month weekday)',
                value: current,
                placeHolder: '0 9 * * * (daily at 9am)',
                validateInput: input => {
                    if (input && !CronParser.validate(input)) {
                        return 'Invalid cron expression. Format: minute hour day month weekday';
                    }
                    return null;
                },
            });

            if (custom === undefined) {
                return;
            }
            value = custom;
        }

        await config.update('autoWakeSchedule', value, vscode.ConfigurationTarget.Global);

        if (value) {
            vscode.window.showInformationMessage(`Auto-wake scheduled: ${CronParser.describe(value)}`);
        } else {
            vscode.window.showInformationMessage('Auto-wake disabled');
        }
    }
}

// Export singleton
export const schedulerManager = SchedulerManager.getInstance();
