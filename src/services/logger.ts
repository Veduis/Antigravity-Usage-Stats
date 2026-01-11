import * as vscode from 'vscode';

/**
 * Log levels for the logging system.
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

/**
 * Centralized logging service for the Antigravity Stats extension.
 * Provides timestamped logging with different severity levels.
 */
export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private minLevel: LogLevel = LogLevel.INFO;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Antigravity Stats');
    }

    /**
     * Gets the singleton instance of the Logger.
     */
    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Sets the minimum log level to display.
     */
    public setMinLevel(level: LogLevel): void {
        this.minLevel = level;
    }

    /**
     * Logs a debug message.
     */
    public debug(message: string, ...args: unknown[]): void {
        this.log(LogLevel.DEBUG, message, ...args);
    }

    /**
     * Logs an info message.
     */
    public info(message: string, ...args: unknown[]): void {
        this.log(LogLevel.INFO, message, ...args);
    }

    /**
     * Logs a warning message.
     */
    public warn(message: string, ...args: unknown[]): void {
        this.log(LogLevel.WARN, message, ...args);
    }

    /**
     * Logs an error message.
     */
    public error(message: string, error?: Error, ...args: unknown[]): void {
        this.log(LogLevel.ERROR, message, ...args);
        if (error) {
            this.outputChannel.appendLine(`  Stack: ${error.stack || 'No stack trace'}`);
        }
    }

    /**
     * Shows the output channel.
     */
    public show(): void {
        this.outputChannel.show(true);
    }

    /**
     * Disposes the output channel.
     */
    public dispose(): void {
        this.outputChannel.dispose();
    }

    /**
     * Gets the output channel for subscription.
     */
    public getOutputChannel(): vscode.OutputChannel {
        return this.outputChannel;
    }

    /**
     * Core logging method.
     */
    private log(level: LogLevel, message: string, ...args: unknown[]): void {
        if (level < this.minLevel) {
            return;
        }

        const timestamp = new Date().toISOString();
        const levelStr = LogLevel[level].padEnd(5);
        const formattedArgs = args.length > 0 ? ` ${JSON.stringify(args)}` : '';

        this.outputChannel.appendLine(`[${timestamp}] [${levelStr}] ${message}${formattedArgs}`);
    }
}

// Export singleton instance
export const logger = Logger.getInstance();
