import * as vscode from 'vscode';
import { logger } from './logger';
import { AntigravityError, ErrorType } from './errorHandler';

/**
 * Keys for secure credential storage.
 */
export enum SecretKey {
    API_KEY = 'apiKey',
    ACCOUNT_CREDENTIALS = 'accountCredentials',
    AUTH_TOKEN = 'authToken',
}

/**
 * Represents stored account credentials.
 */
export interface AccountCredentials {
    accountId: string;
    displayName: string;
    token: string;
}

/**
 * Manages secure credential storage using VS Code's SecretStorage API.
 * All sensitive data (API keys, tokens) should be stored through this service.
 */
export class CredentialManager {
    private static instance: CredentialManager;
    private secretStorage: vscode.SecretStorage | null = null;

    private constructor() { }

    /**
     * Gets the singleton instance of the CredentialManager.
     */
    public static getInstance(): CredentialManager {
        if (!CredentialManager.instance) {
            CredentialManager.instance = new CredentialManager();
        }
        return CredentialManager.instance;
    }

    /**
     * Initializes the credential manager with the extension context.
     * Must be called during extension activation.
     */
    public initialize(context: vscode.ExtensionContext): void {
        this.secretStorage = context.secrets;
        logger.info('CredentialManager initialized');
    }

    /**
     * Stores a secret value.
     */
    public async store(key: SecretKey, value: string): Promise<void> {
        this.ensureInitialized();
        try {
            await this.secretStorage!.store(key, value);
            logger.info(`Secret stored: ${key}`);
        } catch (error) {
            throw new AntigravityError(
                `Failed to store secret: ${key}`,
                ErrorType.PERMISSION,
                false,
                'Unable to securely store credentials.'
            );
        }
    }

    /**
     * Retrieves a secret value.
     */
    public async retrieve(key: SecretKey): Promise<string | undefined> {
        this.ensureInitialized();
        try {
            return await this.secretStorage!.get(key);
        } catch (error) {
            throw new AntigravityError(
                `Failed to retrieve secret: ${key}`,
                ErrorType.PERMISSION,
                false,
                'Unable to access stored credentials.'
            );
        }
    }

    /**
     * Deletes a secret value.
     */
    public async delete(key: SecretKey): Promise<void> {
        this.ensureInitialized();
        try {
            await this.secretStorage!.delete(key);
            logger.info(`Secret deleted: ${key}`);
        } catch (error) {
            throw new AntigravityError(
                `Failed to delete secret: ${key}`,
                ErrorType.PERMISSION,
                false,
                'Unable to delete stored credentials.'
            );
        }
    }

    /**
     * Stores account credentials.
     */
    public async storeAccountCredentials(credentials: AccountCredentials): Promise<void> {
        const existing = await this.getAccountCredentials();
        const updated = existing.filter(c => c.accountId !== credentials.accountId);
        updated.push(credentials);
        await this.store(SecretKey.ACCOUNT_CREDENTIALS, JSON.stringify(updated));
        logger.info(`Account credentials stored for: ${credentials.displayName}`);
    }

    /**
     * Retrieves all account credentials.
     */
    public async getAccountCredentials(): Promise<AccountCredentials[]> {
        const data = await this.retrieve(SecretKey.ACCOUNT_CREDENTIALS);
        if (!data) {
            return [];
        }
        try {
            return JSON.parse(data) as AccountCredentials[];
        } catch {
            logger.warn('Failed to parse account credentials, returning empty array');
            return [];
        }
    }

    /**
     * Deletes account credentials by account ID.
     */
    public async deleteAccountCredentials(accountId: string): Promise<void> {
        const existing = await this.getAccountCredentials();
        const updated = existing.filter(c => c.accountId !== accountId);
        await this.store(SecretKey.ACCOUNT_CREDENTIALS, JSON.stringify(updated));
        logger.info(`Account credentials deleted for ID: ${accountId}`);
    }

    /**
     * Clears all stored secrets.
     */
    public async clearAll(): Promise<void> {
        const keys = Object.values(SecretKey);
        for (const key of keys) {
            await this.delete(key);
        }
        logger.info('All secrets cleared');
    }

    /**
     * Checks if any credentials are stored.
     */
    public async hasCredentials(): Promise<boolean> {
        const credentials = await this.getAccountCredentials();
        return credentials.length > 0;
    }

    /**
     * Ensures the credential manager is initialized.
     */
    private ensureInitialized(): void {
        if (!this.secretStorage) {
            throw new Error('CredentialManager not initialized. Call initialize() first.');
        }
    }
}

// Export singleton instance
export const credentialManager = CredentialManager.getInstance();
