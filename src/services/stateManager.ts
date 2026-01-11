import * as vscode from 'vscode';
import { logger } from './logger';

/**
 * Keys for global state storage.
 */
export enum GlobalStateKey {
    LAST_REFRESH_TIME = 'lastRefreshTime',
    PINNED_MODELS = 'statusBarModels',
    CUSTOM_NAMES = 'customNames',
    DISPLAY_ORDER = 'displayOrder',
    LAST_QUOTA_DATA = 'lastQuotaData',
}

/**
 * Keys for workspace state storage.
 */
export enum WorkspaceStateKey {
    WORKSPACE_SETTINGS = 'workspaceSettings',
}

/**
 * Manages persistent state storage for the extension.
 * Uses VS Code's global and workspace state APIs.
 */
export class StateManager {
    private static instance: StateManager;
    private context: vscode.ExtensionContext | null = null;

    private constructor() { }

    /**
     * Gets the singleton instance of the StateManager.
     */
    public static getInstance(): StateManager {
        if (!StateManager.instance) {
            StateManager.instance = new StateManager();
        }
        return StateManager.instance;
    }

    /**
     * Initializes the state manager with the extension context.
     * Must be called during extension activation.
     */
    public initialize(context: vscode.ExtensionContext): void {
        this.context = context;
        logger.info('StateManager initialized');
    }

    /**
     * Gets a value from global state.
     */
    public getGlobal<T>(key: GlobalStateKey, defaultValue: T): T {
        this.ensureInitialized();
        return this.context!.globalState.get(key, defaultValue);
    }

    /**
     * Sets a value in global state.
     */
    public async setGlobal<T>(key: GlobalStateKey, value: T): Promise<void> {
        this.ensureInitialized();
        await this.context!.globalState.update(key, value);
        logger.debug(`Global state updated: ${key}`);
    }

    /**
     * Gets a value from workspace state.
     */
    public getWorkspace<T>(key: WorkspaceStateKey, defaultValue: T): T {
        this.ensureInitialized();
        return this.context!.workspaceState.get(key, defaultValue);
    }

    /**
     * Sets a value in workspace state.
     */
    public async setWorkspace<T>(key: WorkspaceStateKey, value: T): Promise<void> {
        this.ensureInitialized();
        await this.context!.workspaceState.update(key, value);
        logger.debug(`Workspace state updated: ${key}`);
    }

    /**
     * Clears all global state.
     */
    public async clearGlobalState(): Promise<void> {
        this.ensureInitialized();
        const keys = Object.values(GlobalStateKey);
        for (const key of keys) {
            await this.context!.globalState.update(key, undefined);
        }
        logger.info('Global state cleared');
    }

    /**
     * Clears all workspace state.
     */
    public async clearWorkspaceState(): Promise<void> {
        this.ensureInitialized();
        const keys = Object.values(WorkspaceStateKey);
        for (const key of keys) {
            await this.context!.workspaceState.update(key, undefined);
        }
        logger.info('Workspace state cleared');
    }

    /**
     * Gets the extension context.
     */
    public getContext(): vscode.ExtensionContext {
        this.ensureInitialized();
        return this.context!;
    }

    /**
     * Ensures the state manager is initialized.
     */
    private ensureInitialized(): void {
        if (!this.context) {
            throw new Error('StateManager not initialized. Call initialize() first.');
        }
    }
}

// Export singleton instance
export const stateManager = StateManager.getInstance();
