import * as vscode from 'vscode';
import { logger } from '../services/logger';
import { credentialManager, AccountCredentials } from '../services';

/**
 * Manages multiple accounts with secure switching.
 */
export class AccountManager {
    private static instance: AccountManager;
    private activeAccountId: string | null = null;

    private constructor() { }

    /**
     * Gets the singleton instance.
     */
    public static getInstance(): AccountManager {
        if (!AccountManager.instance) {
            AccountManager.instance = new AccountManager();
        }
        return AccountManager.instance;
    }

    /**
     * Initializes the account manager.
     */
    public async initialize(): Promise<void> {
        const accounts = await this.listAccounts();
        if (accounts.length > 0) {
            const active = accounts.find(a => a.isActive);
            this.activeAccountId = active?.id || accounts[0].id;
            logger.info(`AccountManager initialized with ${accounts.length} accounts`);
        } else {
            logger.info('AccountManager initialized with no accounts');
        }
    }

    /**
     * Prompts user to add a new account.
     */
    public async addAccount(): Promise<AccountCredentials | undefined> {
        const displayName = await vscode.window.showInputBox({
            prompt: 'Enter account display name',
            placeHolder: 'e.g., Personal, Work',
            validateInput: value => {
                if (!value || value.trim().length === 0) {
                    return 'Display name cannot be empty';
                }
                return null;
            },
        });

        if (!displayName) {
            return undefined;
        }

        const token = await vscode.window.showInputBox({
            prompt: 'Enter API token or credentials',
            password: true,
            placeHolder: 'Your API token',
            validateInput: value => {
                if (!value || value.trim().length === 0) {
                    return 'Token cannot be empty';
                }
                return null;
            },
        });

        if (!token) {
            return undefined;
        }

        const accountId = this.generateAccountId();
        const credentials: AccountCredentials = {
            accountId,
            displayName,
            token,
        };

        await credentialManager.storeAccountCredentials(credentials);

        // Make this the active account if it's the first one
        const accounts = await credentialManager.getAccountCredentials();
        if (accounts.length === 1) {
            this.activeAccountId = accountId;
        }

        vscode.window.showInformationMessage(`Account "${displayName}" added successfully!`);
        logger.info(`Account added: ${displayName}`);

        return credentials;
    }

    /**
     * Shows account switcher.
     */
    public async switchAccount(): Promise<void> {
        const accounts = await this.listAccounts();

        if (accounts.length === 0) {
            const add = await vscode.window.showInformationMessage(
                'No accounts configured.',
                'Add Account'
            );
            if (add === 'Add Account') {
                await this.addAccount();
            }
            return;
        }

        const items = accounts.map(a => ({
            label: `${a.isActive ? '● ' : '○ '}${a.displayName}`,
            description: a.isActive ? 'Active' : '',
            accountId: a.id,
        }));

        items.push({
            label: '$(add) Add New Account',
            description: '',
            accountId: '__add__',
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an account',
        });

        if (!selected) {
            return;
        }

        if (selected.accountId === '__add__') {
            await this.addAccount();
            return;
        }

        if (selected.accountId !== this.activeAccountId) {
            this.activeAccountId = selected.accountId;
            const account = accounts.find(a => a.id === selected.accountId);
            vscode.window.showInformationMessage(`Switched to account: ${account?.displayName}`);
            logger.info(`Switched to account: ${account?.displayName}`);
        }
    }

    /**
     * Removes an account.
     */
    public async removeAccount(): Promise<void> {
        const accounts = await this.listAccounts();

        if (accounts.length === 0) {
            vscode.window.showInformationMessage('No accounts to remove.');
            return;
        }

        const items = accounts.map(a => ({
            label: a.displayName,
            description: a.isActive ? 'Active' : '',
            accountId: a.id,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select account to remove',
        });

        if (!selected) {
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Remove account "${selected.label}"?`,
            { modal: true },
            'Remove'
        );

        if (confirm === 'Remove') {
            await credentialManager.deleteAccountCredentials(selected.accountId);

            if (this.activeAccountId === selected.accountId) {
                const remaining = await credentialManager.getAccountCredentials();
                this.activeAccountId = remaining.length > 0 ? remaining[0].accountId : null;
            }

            vscode.window.showInformationMessage(`Account "${selected.label}" removed.`);
            logger.info(`Account removed: ${selected.label}`);
        }
    }

    /**
     * Lists all accounts with active status.
     */
    public async listAccounts(): Promise<Array<{ id: string; displayName: string; isActive: boolean }>> {
        const credentials = await credentialManager.getAccountCredentials();
        return credentials.map(c => ({
            id: c.accountId,
            displayName: c.displayName,
            isActive: c.accountId === this.activeAccountId,
        }));
    }

    /**
     * Gets the active account's credentials.
     */
    public async getActiveCredentials(): Promise<AccountCredentials | undefined> {
        if (!this.activeAccountId) {
            return undefined;
        }

        const credentials = await credentialManager.getAccountCredentials();
        return credentials.find(c => c.accountId === this.activeAccountId);
    }

    /**
     * Generates a unique account ID.
     */
    private generateAccountId(): string {
        return `account-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
}

// Export singleton
export const accountManager = AccountManager.getInstance();
