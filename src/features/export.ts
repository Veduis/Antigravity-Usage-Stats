import * as vscode from 'vscode';
import { logger } from '../services/logger';
import { QuotaInfo, QuotaGroup } from '../data';

/**
 * Export format options.
 */
export type ExportFormat = 'json' | 'csv';

/**
 * Manages export of quota data.
 */
export class ExportManager {
    private static instance: ExportManager;

    private constructor() { }

    /**
     * Gets the singleton instance.
     */
    public static getInstance(): ExportManager {
        if (!ExportManager.instance) {
            ExportManager.instance = new ExportManager();
        }
        return ExportManager.instance;
    }

    /**
     * Prompts user for export format and exports data.
     */
    public async exportQuotaData(quotas: QuotaInfo[]): Promise<void> {
        const format = await vscode.window.showQuickPick(
            [
                { label: 'JSON', description: 'Export as JSON file', format: 'json' as ExportFormat },
                { label: 'CSV', description: 'Export as CSV file', format: 'csv' as ExportFormat },
            ],
            { placeHolder: 'Select export format' }
        );

        if (!format) {
            return;
        }

        const content =
            format.format === 'json'
                ? this.toJson(quotas)
                : this.toCsv(quotas);

        const filename = `antigravity-stats-${this.getTimestamp()}.${format.format}`;
        await this.saveFile(content, filename, format.format);
    }

    /**
     * Exports grouped data.
     */
    public async exportGroupedData(groups: QuotaGroup[]): Promise<void> {
        const format = await vscode.window.showQuickPick(
            [
                { label: 'JSON', description: 'Export as JSON file', format: 'json' as ExportFormat },
                { label: 'CSV', description: 'Export as CSV file', format: 'csv' as ExportFormat },
            ],
            { placeHolder: 'Select export format' }
        );

        if (!format) {
            return;
        }

        const content =
            format.format === 'json'
                ? this.groupsToJson(groups)
                : this.groupsToCsv(groups);

        const filename = `antigravity-stats-grouped-${this.getTimestamp()}.${format.format}`;
        await this.saveFile(content, filename, format.format);
    }

    /**
     * Converts quotas to JSON string.
     */
    private toJson(quotas: QuotaInfo[]): string {
        const exportData = {
            exportedAt: new Date().toISOString(),
            totalModels: quotas.length,
            quotas: quotas.map(q => ({
                modelId: q.modelId,
                modelName: q.modelName,
                poolId: q.poolId,
                remaining: q.remaining,
                capacity: q.capacity,
                percentRemaining: Math.round(q.percentRemaining * 100) / 100,
                status: q.status,
                resetTime: q.resetTime?.toISOString() || null,
                lastUpdated: q.lastUpdated.toISOString(),
            })),
        };
        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Converts quotas to CSV string.
     */
    private toCsv(quotas: QuotaInfo[]): string {
        const headers = [
            'Model ID',
            'Model Name',
            'Pool ID',
            'Remaining',
            'Capacity',
            'Percent Remaining',
            'Status',
            'Reset Time',
            'Last Updated',
        ];

        const rows = quotas.map(q => [
            this.escapeCsv(q.modelId),
            this.escapeCsv(q.modelName),
            this.escapeCsv(q.poolId),
            q.remaining.toString(),
            q.capacity.toString(),
            (Math.round(q.percentRemaining * 100) / 100).toString(),
            q.status,
            q.resetTime?.toISOString() || '',
            q.lastUpdated.toISOString(),
        ]);

        return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }

    /**
     * Converts groups to JSON.
     */
    private groupsToJson(groups: QuotaGroup[]): string {
        const exportData = {
            exportedAt: new Date().toISOString(),
            totalGroups: groups.length,
            groups: groups.map(g => ({
                poolId: g.poolId,
                groupName: g.groupName,
                customName: g.customName,
                totalRemaining: g.totalRemaining,
                totalCapacity: g.totalCapacity,
                percentRemaining: Math.round(g.percentRemaining * 100) / 100,
                status: g.status,
                resetTime: g.resetTime?.toISOString() || null,
                modelCount: g.models.length,
                models: g.models.map(m => m.modelId),
            })),
        };
        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Converts groups to CSV.
     */
    private groupsToCsv(groups: QuotaGroup[]): string {
        const headers = [
            'Pool ID',
            'Group Name',
            'Custom Name',
            'Total Remaining',
            'Total Capacity',
            'Percent Remaining',
            'Status',
            'Reset Time',
            'Model Count',
        ];

        const rows = groups.map(g => [
            this.escapeCsv(g.poolId),
            this.escapeCsv(g.groupName),
            this.escapeCsv(g.customName || ''),
            g.totalRemaining.toString(),
            g.totalCapacity.toString(),
            (Math.round(g.percentRemaining * 100) / 100).toString(),
            g.status,
            g.resetTime?.toISOString() || '',
            g.models.length.toString(),
        ]);

        return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }

    /**
     * Escapes a value for CSV.
     */
    private escapeCsv(value: string): string {
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    }

    /**
     * Gets timestamp for filename.
     */
    private getTimestamp(): string {
        const now = new Date();
        return now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
    }

    /**
     * Saves content to a file.
     */
    private async saveFile(content: string, filename: string, format: ExportFormat): Promise<void> {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(filename),
            filters: {
                [format.toUpperCase()]: [format],
            },
        });

        if (uri) {
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
            vscode.window.showInformationMessage(`Exported to: ${uri.fsPath}`);
            logger.info(`Data exported to ${uri.fsPath}`);
        }
    }
}

// Export singleton
export const exportManager = ExportManager.getInstance();
