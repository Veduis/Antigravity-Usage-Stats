import * as vscode from 'vscode';
import { logger } from '../services/logger';
import { QuotaInfo, QuotaGroup, QuotaHelpers, QuotaStatus } from '../data';
import { quotaGrouper } from '../data/quotaGrouper';
import { pollingManager } from '../data/pollingManager';

/**
 * Webview dashboard panel provider.
 */
export class DashboardPanel {
  private static instance: DashboardPanel | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private context: vscode.ExtensionContext | null = null;
  private currentQuotas: QuotaInfo[] = [];

  private constructor() { }

  /**
   * Creates or shows the dashboard panel.
   */
  public static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DashboardPanel.instance) {
      DashboardPanel.instance.panel?.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'antigravityStats',
      'Antigravity Stats',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri],
      }
    );

    DashboardPanel.instance = new DashboardPanel();
    DashboardPanel.instance.panel = panel;
    DashboardPanel.instance.context = context;

    // Set up panel event handlers
    panel.onDidDispose(
      () => DashboardPanel.instance = undefined,
      null,
      context.subscriptions
    );

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(
      message => DashboardPanel.instance?.handleMessage(message),
      null,
      context.subscriptions
    );

    // Update content
    DashboardPanel.instance.updateContent();

    // Listen for quota updates
    pollingManager.addListener(result => {
      if (result.success && DashboardPanel.instance) {
        DashboardPanel.instance.currentQuotas = result.quotas;
        DashboardPanel.instance.updateContent();
      }
    });

    logger.info('Dashboard panel created');
  }

  /**
   * Updates the webview content.
   */
  private updateContent(): void {
    if (!this.panel) return;

    const config = vscode.workspace.getConfiguration('antigravityStats');
    const groupingEnabled = config.get<boolean>('groupingEnabled', true);
    const thresholds = {
      warning: config.get<number>('warningThreshold', 30),
      critical: config.get<number>('criticalThreshold', 10),
    };

    let groups: QuotaGroup[] = [];
    if (groupingEnabled) {
      groups = quotaGrouper.groupByPool(this.currentQuotas, thresholds);
    }

    this.panel.webview.html = this.getHtmlContent(groups);
  }

  /**
   * Handles messages from the webview.
   */
  private handleMessage(message: { type: string; payload?: unknown }): void {
    switch (message.type) {
      case 'refresh':
        pollingManager.pollNow();
        break;
      case 'openSettings':
        vscode.commands.executeCommand('workbench.action.openSettings', 'antigravityStats');
        break;
      case 'pinModel':
        // TODO: Implement pinning
        break;
      default:
        logger.warn(`Unknown message type: ${message.type}`);
    }
  }

  /**
   * Generates the HTML content for the webview.
   */
  private getHtmlContent(groups: QuotaGroup[]): string {
    const quotaCards = groups.map(group => this.renderGroup(group)).join('');
    const noDataMessage = groups.length === 0
      ? '<div class="no-data">No quota data available. Click refresh to fetch data.</div>'
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>Antigravity Stats</title>
  <style>
    ${this.getStyles()}
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <h1>📊 Antigravity Stats</h1>
      <div class="header-actions">
        <button class="btn btn-primary" onclick="refresh()">
          🔄 Refresh
        </button>
        <button class="btn btn-secondary" onclick="openSettings()">
          ⚙️ Settings
        </button>
      </div>
    </header>
    
    <main class="main">
      ${noDataMessage}
      <div class="grid">
        ${quotaCards}
      </div>
    </main>
    
    <footer class="footer">
      <span>Last updated: ${new Date().toLocaleTimeString()}</span>
      <span>•</span>
      <span>${this.currentQuotas.length} models tracked</span>
    </footer>
  </div>
  
  <script>
    const vscode = acquireVsCodeApi();
    
    function refresh() {
      vscode.postMessage({ type: 'refresh' });
    }
    
    function openSettings() {
      vscode.postMessage({ type: 'openSettings' });
    }
    
    function pinModel(modelId) {
      vscode.postMessage({ type: 'pinModel', payload: modelId });
    }
  </script>
</body>
</html>`;
  }

  /**
   * Renders a quota group.
   */
  private renderGroup(group: QuotaGroup): string {
    const statusColor = QuotaHelpers.getStatusColor(group.status);
    const statusIcon = QuotaHelpers.getStatusIcon(group.status);
    const displayName = group.customName || group.groupName;

    const modelCards = group.models.map(model => this.renderModelCard(model)).join('');

    return `
      <div class="group-card" style="--status-color: ${statusColor}">
        <div class="group-header">
          <span class="group-icon">${statusIcon}</span>
          <h2 class="group-name">${displayName}</h2>
          <span class="group-percent">${Math.round(group.percentRemaining)}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${group.percentRemaining}%; background-color: ${statusColor}"></div>
        </div>
        <div class="group-models">
          ${modelCards}
        </div>
        ${group.resetTime ? `<div class="reset-time">Resets in: ${QuotaHelpers.formatResetCountdown(Math.floor((group.resetTime.getTime() - Date.now()) / 1000))}</div>` : ''}
      </div>
    `;
  }

  /**
   * Renders an individual model card.
   */
  private renderModelCard(model: QuotaInfo): string {
    const statusColor = QuotaHelpers.getStatusColor(model.status);

    return `
      <div class="model-card">
        <div class="model-header">
          <span class="status-dot" style="background-color: ${statusColor}"></span>
          <span class="model-name">${model.modelName}</span>
          <span class="model-percent">${Math.round(model.percentRemaining)}%</span>
        </div>
        <div class="model-details">
          <span>${model.remaining} / ${model.capacity}</span>
          ${model.resetInSeconds ? `<span>⏱️ ${QuotaHelpers.formatResetCountdown(model.resetInSeconds)}</span>` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Returns CSS styles for the webview.
   */
  private getStyles(): string {
    return `
      :root {
        --bg-color: var(--vscode-editor-background);
        --text-color: var(--vscode-editor-foreground);
        --border-color: var(--vscode-widget-border);
        --card-bg: var(--vscode-editorWidget-background);
        --hover-bg: var(--vscode-list-hoverBackground);
        --btn-primary: var(--vscode-button-background);
        --btn-primary-hover: var(--vscode-button-hoverBackground);
        --btn-secondary: var(--vscode-button-secondaryBackground);
        --healthy: #22c55e;
        --warning: #eab308;
        --critical: #ef4444;
      }

      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      body {
        font-family: var(--vscode-font-family), -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px;
        color: var(--text-color);
        background-color: var(--bg-color);
        line-height: 1.6;
      }

      .container {
        max-width: 1400px;
        margin: 0 auto;
        padding: 24px;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        margin-bottom: 24px;
        background: var(--card-bg);
        border-radius: 12px;
        border: 1px solid var(--border-color);
      }

      .header h1 {
        font-size: 1.5em;
        font-weight: 700;
        color: var(--text-color);
      }

      .header-actions {
        display: flex;
        gap: 10px;
      }

      .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.9em;
        font-weight: 600;
        transition: all 0.2s ease;
      }

      .btn-primary {
        background-color: var(--btn-primary);
        color: white;
      }

      .btn-primary:hover {
        background-color: var(--btn-primary-hover);
      }

      .btn-secondary {
        background-color: var(--btn-secondary);
        color: var(--text-color);
        border: 1px solid var(--border-color);
      }

      .btn-secondary:hover {
        background-color: var(--hover-bg);
      }

      .main {
        flex: 1;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 20px;
      }

      .no-data {
        text-align: center;
        padding: 48px 32px;
        color: var(--vscode-descriptionForeground);
        background: var(--card-bg);
        border-radius: 12px;
        border: 1px dashed var(--border-color);
      }

      .group-card {
        background: var(--card-bg);
        border-radius: 12px;
        padding: 20px;
        border: 1px solid var(--border-color);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      .group-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      .group-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 14px;
      }

      .group-icon {
        font-size: 1.3em;
      }

      .group-name {
        flex: 1;
        font-size: 1.1em;
        font-weight: 600;
      }

      .group-percent {
        font-size: 1.5em;
        font-weight: 700;
        color: var(--status-color);
      }

      .progress-bar {
        height: 8px;
        background: rgba(128, 128, 128, 0.2);
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 16px;
      }

      .progress-fill {
        height: 100%;
        border-radius: 4px;
        transition: width 0.4s ease;
      }

      .group-models {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .model-card {
        padding: 12px 14px;
        background: var(--bg-color);
        border-radius: 8px;
        transition: background-color 0.2s ease;
      }

      .model-card:hover {
        background: var(--hover-bg);
      }

      .model-header {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }

      .model-name {
        flex: 1;
        font-weight: 500;
      }

      .model-percent {
        font-weight: 600;
        color: var(--status-color);
      }

      .model-details {
        display: flex;
        justify-content: space-between;
        font-size: 0.8em;
        color: var(--vscode-descriptionForeground);
        margin-top: 6px;
        padding-left: 16px;
      }

      .reset-time {
        margin-top: 14px;
        padding-top: 14px;
        border-top: 1px solid var(--border-color);
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
        text-align: center;
      }

      .footer {
        margin-top: 24px;
        padding: 16px;
        background: var(--card-bg);
        border-radius: 8px;
        border: 1px solid var(--border-color);
        display: flex;
        justify-content: center;
        gap: 16px;
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .group-card {
        animation: fadeIn 0.3s ease-out;
      }

      @media (max-width: 768px) {
        .header {
          flex-direction: column;
          gap: 12px;
          text-align: center;
        }
        
        .grid {
          grid-template-columns: 1fr;
        }
      }
    `;
  }
}

// Convenience function
export function showDashboard(context: vscode.ExtensionContext): void {
  DashboardPanel.createOrShow(context);
}
