import * as vscode from 'vscode';
import { logger } from './logger';
import { errorHandler } from './errorHandler';

/**
 * Command handler function type.
 */
type CommandHandler = (...args: unknown[]) => Promise<void> | void;

/**
 * Registered command information.
 */
interface RegisteredCommand {
    id: string;
    handler: CommandHandler;
    disposable: vscode.Disposable;
}

/**
 * Manages command registration and execution for the extension.
 */
export class CommandRegistry {
    private static instance: CommandRegistry;
    private commands: Map<string, RegisteredCommand> = new Map();
    private context: vscode.ExtensionContext | null = null;

    private constructor() { }

    /**
     * Gets the singleton instance of the CommandRegistry.
     */
    public static getInstance(): CommandRegistry {
        if (!CommandRegistry.instance) {
            CommandRegistry.instance = new CommandRegistry();
        }
        return CommandRegistry.instance;
    }

    /**
     * Initializes the command registry with the extension context.
     */
    public initialize(context: vscode.ExtensionContext): void {
        this.context = context;
        logger.info('CommandRegistry initialized');
    }

    /**
     * Registers a command with error handling wrapper.
     */
    public register(commandId: string, handler: CommandHandler): void {
        this.ensureInitialized();

        // Wrap the handler with error handling
        const wrappedHandler = async (...args: unknown[]) => {
            try {
                await handler(...args);
            } catch (error) {
                await errorHandler.handle(error, commandId);
            }
        };

        const disposable = vscode.commands.registerCommand(commandId, wrappedHandler);
        this.context!.subscriptions.push(disposable);

        this.commands.set(commandId, {
            id: commandId,
            handler: wrappedHandler,
            disposable,
        });

        logger.debug(`Command registered: ${commandId}`);
    }

    /**
     * Registers multiple commands at once.
     */
    public registerMany(commands: Record<string, CommandHandler>): void {
        for (const [commandId, handler] of Object.entries(commands)) {
            this.register(commandId, handler);
        }
    }

    /**
     * Unregisters a command.
     */
    public unregister(commandId: string): void {
        const command = this.commands.get(commandId);
        if (command) {
            command.disposable.dispose();
            this.commands.delete(commandId);
            logger.debug(`Command unregistered: ${commandId}`);
        }
    }

    /**
     * Executes a registered command programmatically.
     */
    public async execute(commandId: string, ...args: unknown[]): Promise<void> {
        await vscode.commands.executeCommand(commandId, ...args);
    }

    /**
     * Gets all registered command IDs.
     */
    public getRegisteredCommands(): string[] {
        return Array.from(this.commands.keys());
    }

    /**
     * Checks if a command is registered.
     */
    public isRegistered(commandId: string): boolean {
        return this.commands.has(commandId);
    }

    /**
     * Ensures the command registry is initialized.
     */
    private ensureInitialized(): void {
        if (!this.context) {
            throw new Error('CommandRegistry not initialized. Call initialize() first.');
        }
    }
}

// Export singleton instance
export const commandRegistry = CommandRegistry.getInstance();
