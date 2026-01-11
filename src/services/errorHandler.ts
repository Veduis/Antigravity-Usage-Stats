import * as vscode from 'vscode';
import { logger } from './logger';

/**
 * Error types for categorizing extension errors.
 */
export enum ErrorType {
    NETWORK = 'NETWORK',
    CONFIGURATION = 'CONFIGURATION',
    PERMISSION = 'PERMISSION',
    PARSING = 'PARSING',
    STATE = 'STATE',
    UNKNOWN = 'UNKNOWN',
}

/**
 * Custom error class for extension-specific errors.
 */
export class AntigravityError extends Error {
    public readonly type: ErrorType;
    public readonly recoverable: boolean;
    public readonly userMessage: string;

    constructor(
        message: string,
        type: ErrorType = ErrorType.UNKNOWN,
        recoverable = true,
        userMessage?: string
    ) {
        super(message);
        this.name = 'AntigravityError';
        this.type = type;
        this.recoverable = recoverable;
        this.userMessage = userMessage || message;
    }
}

/**
 * Centralized error handler for the extension.
 * Provides consistent error logging, user notifications, and recovery strategies.
 */
export class ErrorHandler {
    private static instance: ErrorHandler;
    private errorCount = 0;
    private lastErrorTime: Date | null = null;

    private constructor() { }

    /**
     * Gets the singleton instance of the ErrorHandler.
     */
    public static getInstance(): ErrorHandler {
        if (!ErrorHandler.instance) {
            ErrorHandler.instance = new ErrorHandler();
        }
        return ErrorHandler.instance;
    }

    /**
     * Handles an error with appropriate logging and user feedback.
     */
    public async handle(
        error: unknown,
        context?: string,
        showNotification = true
    ): Promise<void> {
        this.errorCount++;
        this.lastErrorTime = new Date();

        const antigravityError = this.normalize(error);
        const contextStr = context ? ` [${context}]` : '';

        // Log the error
        logger.error(
            `${antigravityError.type}${contextStr}: ${antigravityError.message}`,
            error instanceof Error ? error : undefined
        );

        // Show notification if needed
        if (showNotification) {
            await this.showNotification(antigravityError);
        }

        // Execute recovery strategy if applicable
        if (antigravityError.recoverable) {
            await this.attemptRecovery(antigravityError);
        }
    }

    /**
     * Wraps an async function with error handling.
     */
    public wrapAsync<T>(
        fn: () => Promise<T>,
        context?: string
    ): () => Promise<T | undefined> {
        return async () => {
            try {
                return await fn();
            } catch (error) {
                await this.handle(error, context);
                return undefined;
            }
        };
    }

    /**
     * Gets error statistics.
     */
    public getStats(): { count: number; lastError: Date | null } {
        return {
            count: this.errorCount,
            lastError: this.lastErrorTime,
        };
    }

    /**
     * Resets error statistics.
     */
    public resetStats(): void {
        this.errorCount = 0;
        this.lastErrorTime = null;
    }

    /**
     * Normalizes any error to an AntigravityError.
     */
    private normalize(error: unknown): AntigravityError {
        if (error instanceof AntigravityError) {
            return error;
        }

        if (error instanceof Error) {
            // Try to categorize based on error message
            const message = error.message.toLowerCase();

            if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
                return new AntigravityError(error.message, ErrorType.NETWORK, true,
                    'Network error occurred. Please check your connection.');
            }

            if (message.includes('config') || message.includes('setting')) {
                return new AntigravityError(error.message, ErrorType.CONFIGURATION, true,
                    'Configuration error. Please check your settings.');
            }

            if (message.includes('permission') || message.includes('access denied')) {
                return new AntigravityError(error.message, ErrorType.PERMISSION, false,
                    'Permission denied. Please check access rights.');
            }

            if (message.includes('parse') || message.includes('json') || message.includes('syntax')) {
                return new AntigravityError(error.message, ErrorType.PARSING, true,
                    'Data parsing error. Please try again.');
            }

            return new AntigravityError(error.message, ErrorType.UNKNOWN, true);
        }

        return new AntigravityError(String(error), ErrorType.UNKNOWN, true);
    }

    /**
     * Shows appropriate notification to the user.
     */
    private async showNotification(error: AntigravityError): Promise<void> {
        const actions: string[] = error.recoverable ? ['Retry', 'Open Logs'] : ['Open Logs'];

        const action = await vscode.window.showErrorMessage(
            `Antigravity Usage Stats: ${error.userMessage}`,
            ...actions
        );

        if (action === 'Open Logs') {
            logger.show();
        }
        // Retry action would be handled by the calling code
    }

    /**
     * Attempts recovery based on error type.
     */
    private async attemptRecovery(error: AntigravityError): Promise<void> {
        logger.info(`Attempting recovery for ${error.type} error...`);

        switch (error.type) {
            case ErrorType.NETWORK:
                // Network errors might self-resolve, log for retry
                logger.info('Network error - will retry on next refresh');
                break;
            case ErrorType.CONFIGURATION:
                // Offer to reset configuration
                logger.info('Configuration error - check settings');
                break;
            case ErrorType.STATE:
                // State errors might need state reset
                logger.info('State error - may need state cleanup');
                break;
            default:
                logger.info('No specific recovery action for this error type');
        }
    }
}

// Export singleton instance
export const errorHandler = ErrorHandler.getInstance();
