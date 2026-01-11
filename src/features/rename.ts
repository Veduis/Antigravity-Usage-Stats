import * as vscode from 'vscode';
import { logger } from '../services/logger';
import { stateManager, GlobalStateKey } from '../services';
import { QuotaInfo, QuotaGroup } from '../data';

/**
 * Custom name mapping with persistence.
 */
interface CustomNames {
    models: Record<string, string>;
    groups: Record<string, string>;
}

/**
 * Manages renaming of models and groups.
 */
export class RenameManager {
    private static instance: RenameManager;
    private customNames: CustomNames = { models: {}, groups: {} };

    private constructor() { }

    /**
     * Gets the singleton instance.
     */
    public static getInstance(): RenameManager {
        if (!RenameManager.instance) {
            RenameManager.instance = new RenameManager();
        }
        return RenameManager.instance;
    }

    /**
     * Initializes by loading saved names.
     */
    public async initialize(): Promise<void> {
        const saved = stateManager.getGlobal<CustomNames>(GlobalStateKey.CUSTOM_NAMES, {
            models: {},
            groups: {},
        });
        this.customNames = saved;
        logger.info(
            `RenameManager initialized with ${Object.keys(saved.models).length} model names and ${Object.keys(saved.groups).length} group names`
        );
    }

    /**
     * Prompts user to rename a model.
     */
    public async renameModel(quota: QuotaInfo): Promise<string | undefined> {
        const currentName = this.getModelName(quota.modelId) || quota.modelName;

        const newName = await vscode.window.showInputBox({
            prompt: `Enter new name for ${quota.modelName}`,
            value: currentName,
            placeHolder: 'Custom model name',
            validateInput: value => {
                if (!value || value.trim().length === 0) {
                    return 'Name cannot be empty';
                }
                if (value.length > 50) {
                    return 'Name cannot exceed 50 characters';
                }
                return null;
            },
        });

        if (newName && newName !== quota.modelName) {
            await this.setModelName(quota.modelId, newName);
            vscode.window.showInformationMessage(`Renamed to: ${newName}`);
            return newName;
        }

        return undefined;
    }

    /**
     * Prompts user to rename a group.
     */
    public async renameGroup(group: QuotaGroup): Promise<string | undefined> {
        const currentName = this.getGroupName(group.poolId) || group.groupName;

        const newName = await vscode.window.showInputBox({
            prompt: `Enter new name for ${group.groupName}`,
            value: currentName,
            placeHolder: 'Custom group name',
            validateInput: value => {
                if (!value || value.trim().length === 0) {
                    return 'Name cannot be empty';
                }
                if (value.length > 50) {
                    return 'Name cannot exceed 50 characters';
                }
                return null;
            },
        });

        if (newName && newName !== group.groupName) {
            await this.setGroupName(group.poolId, newName);
            vscode.window.showInformationMessage(`Group renamed to: ${newName}`);
            return newName;
        }

        return undefined;
    }

    /**
     * Gets custom model name.
     */
    public getModelName(modelId: string): string | undefined {
        return this.customNames.models[modelId];
    }

    /**
     * Gets custom group name.
     */
    public getGroupName(poolId: string): string | undefined {
        return this.customNames.groups[poolId];
    }

    /**
     * Sets custom model name.
     */
    public async setModelName(modelId: string, name: string): Promise<void> {
        this.customNames.models[modelId] = name;
        await this.save();
        logger.debug(`Model ${modelId} renamed to ${name}`);
    }

    /**
     * Sets custom group name.
     */
    public async setGroupName(poolId: string, name: string): Promise<void> {
        this.customNames.groups[poolId] = name;
        await this.save();
        logger.debug(`Group ${poolId} renamed to ${name}`);
    }

    /**
     * Removes custom model name.
     */
    public async resetModelName(modelId: string): Promise<void> {
        delete this.customNames.models[modelId];
        await this.save();
        logger.debug(`Model ${modelId} name reset`);
    }

    /**
     * Removes custom group name.
     */
    public async resetGroupName(poolId: string): Promise<void> {
        delete this.customNames.groups[poolId];
        await this.save();
        logger.debug(`Group ${poolId} name reset`);
    }

    /**
     * Clears all custom names.
     */
    public async clearAll(): Promise<void> {
        this.customNames = { models: {}, groups: {} };
        await this.save();
        logger.info('All custom names cleared');
    }

    /**
     * Saves custom names to persistent storage.
     */
    private async save(): Promise<void> {
        await stateManager.setGlobal(GlobalStateKey.CUSTOM_NAMES, this.customNames);
    }
}

// Export singleton
export const renameManager = RenameManager.getInstance();
