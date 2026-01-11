/**
 * Antigravity Client - Connects to the local Antigravity language server
 * to fetch real quota data.
 * 
 * Based on reverse-engineering of the ag-quota extension by Henrik Mertens.
 * https://github.com/Henrik-3/AntigravityQuota
 */

import * as https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../services/logger';
import { QuotaInfo, FetchResult, QuotaHelpers, ThresholdConfig } from './models';

const execAsync = promisify(exec);

/**
 * Process info from Antigravity language server.
 */
interface ProcessInfo {
    pid: number;
    extensionPort: number;
    csrfToken: string;
    connectPort: number;
}

/**
 * Raw model from Antigravity API response.
 */
interface AntigravityModel {
    label?: string;
    modelOrAlias?: { model?: string };
    quotaInfo?: {
        remainingFraction?: number;
        resetTime?: string;
    };
}

/**
 * Antigravity API response structure.
 */
interface AntigravityUserStatus {
    userStatus?: {
        cascadeModelConfigData?: {
            clientModelConfigs?: AntigravityModel[];
        };
        planStatus?: {
            availablePromptCredits?: number;
            planInfo?: {
                monthlyPromptCredits?: number;
            };
        };
    };
}

/**
 * Client for connecting to the local Antigravity language server.
 */
export class AntigravityClient {
    private static instance: AntigravityClient;
    private processInfo: ProcessInfo | null = null;
    private thresholds: ThresholdConfig = { warning: 30, critical: 10 };
    private processName: string;

    private constructor() {
        // Determine process name based on platform
        const arch = process.arch === 'arm64' ? '_arm' : '_x64';
        this.processName = `language_server_linux${arch}`;
        logger.debug(`AntigravityClient initialized for process: ${this.processName}`);
    }

    /**
     * Gets the singleton instance.
     */
    public static getInstance(): AntigravityClient {
        if (!AntigravityClient.instance) {
            AntigravityClient.instance = new AntigravityClient();
        }
        return AntigravityClient.instance;
    }

    /**
     * Sets threshold configuration.
     */
    public setThresholds(thresholds: ThresholdConfig): void {
        this.thresholds = thresholds;
    }

    /**
     * Checks if connected to Antigravity.
     */
    public isConnected(): boolean {
        return this.processInfo !== null;
    }

    /**
     * Discovers and connects to the Antigravity language server.
     */
    public async connect(): Promise<boolean> {
        logger.info('Attempting to connect to Antigravity language server...');

        try {
            // Step 1: Find the language server process
            const basicInfo = await this.findProcess();
            if (!basicInfo) {
                logger.warn('Antigravity language server process not found');
                return false;
            }

            logger.debug(`Found process PID: ${basicInfo.pid}, CSRF token: ${basicInfo.csrfToken.substring(0, 8)}...`);

            // Step 2: Get listening ports for the process
            const ports = await this.getListeningPorts(basicInfo.pid);
            if (ports.length === 0) {
                logger.warn('No listening ports found for Antigravity process');
                return false;
            }

            logger.debug(`Found ${ports.length} listening ports: ${ports.join(', ')}`);

            // Step 3: Find the working port by testing each one
            const workingPort = await this.findWorkingPort(ports, basicInfo.csrfToken);
            if (!workingPort) {
                logger.warn('No working port found');
                return false;
            }

            this.processInfo = {
                ...basicInfo,
                connectPort: workingPort,
            };

            logger.info(`Connected to Antigravity on port ${workingPort}`);
            return true;
        } catch (error) {
            logger.error('Failed to connect to Antigravity', error instanceof Error ? error : undefined);
            return false;
        }
    }

    /**
     * Fetches quota data from Antigravity.
     */
    public async fetchQuota(): Promise<FetchResult> {
        if (!this.processInfo) {
            // Try to connect first
            const connected = await this.connect();
            if (!connected) {
                return {
                    success: false,
                    quotas: [],
                    error: 'Not connected to Antigravity',
                    source: 'local',
                    timestamp: new Date(),
                };
            }
        }

        try {
            const response = await this.request<AntigravityUserStatus>(
                '/exa.language_server_pb.LanguageServerService/GetUserStatus',
                {
                    metadata: {
                        ideName: 'antigravity',
                        extensionName: 'antigravity',
                        locale: 'en',
                    },
                }
            );

            const quotas = this.parseResponse(response);

            return {
                success: true,
                quotas,
                source: 'local',
                timestamp: new Date(),
            };
        } catch (error) {
            logger.error('Failed to fetch quota', error instanceof Error ? error : undefined);

            // Connection may be stale, clear it
            this.processInfo = null;

            return {
                success: false,
                quotas: [],
                error: error instanceof Error ? error.message : 'Fetch failed',
                source: 'local',
                timestamp: new Date(),
            };
        }
    }

    /**
     * Disconnects from Antigravity.
     */
    public disconnect(): void {
        this.processInfo = null;
        logger.info('Disconnected from Antigravity');
    }

    /**
     * Finds the Antigravity language server process.
     */
    private async findProcess(): Promise<Omit<ProcessInfo, 'connectPort'> | null> {
        try {
            const cmd = `pgrep -af ${this.processName}`;
            const { stdout } = await execAsync(cmd);

            const lines = stdout.split('\n');
            for (const line of lines) {
                if (line.includes('--extension_server_port')) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parseInt(parts[0], 10);
                    const cmdLine = line.substring(parts[0].length).trim();

                    const portMatch = cmdLine.match(/--extension_server_port[=\s]+(\d+)/);
                    const tokenMatch = cmdLine.match(/--csrf_token[=\s]+([a-zA-Z0-9-]+)/);

                    if (tokenMatch && tokenMatch[1]) {
                        return {
                            pid,
                            extensionPort: portMatch ? parseInt(portMatch[1], 10) : 0,
                            csrfToken: tokenMatch[1],
                        };
                    }
                }
            }

            return null;
        } catch {
            return null;
        }
    }

    /**
     * Gets listening ports for a process.
     */
    private async getListeningPorts(pid: number): Promise<number[]> {
        try {
            const cmd = `ss -tlnp 2>/dev/null | grep "pid=${pid},"`;
            const { stdout } = await execAsync(cmd);

            const ports: number[] = [];
            const regex = /LISTEN\s+\d+\s+\d+\s+(?:\*|[\d.]+|\[[\da-f:]*\]):(\d+).*?pid=(\d+)/gi;

            let match;
            while ((match = regex.exec(stdout)) !== null) {
                const port = parseInt(match[1], 10);
                const matchedPid = parseInt(match[2], 10);
                if (matchedPid === pid && !ports.includes(port)) {
                    ports.push(port);
                }
            }

            return ports.sort((a, b) => a - b);
        } catch {
            return [];
        }
    }

    /**
     * Tests ports to find one that responds.
     */
    private async findWorkingPort(ports: number[], csrfToken: string): Promise<number | null> {
        for (const port of ports) {
            const isWorking = await this.testPort(port, csrfToken);
            if (isWorking) {
                return port;
            }
        }
        return null;
    }

    /**
     * Tests if a port responds to Antigravity API requests.
     */
    private testPort(port: number, csrfToken: string): Promise<boolean> {
        return new Promise(resolve => {
            const data = JSON.stringify({ wrapper_data: {} });

            const options: https.RequestOptions = {
                hostname: '127.0.0.1',
                port,
                path: '/exa.language_server_pb.LanguageServerService/GetUnleashData',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'Connect-Protocol-Version': '1',
                    'X-Codeium-Csrf-Token': csrfToken,
                },
                rejectUnauthorized: false,
                timeout: 3000,
            };

            const req = https.request(options, res => {
                let body = '';
                res.on('data', chunk => (body += chunk));
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            JSON.parse(body);
                            resolve(true);
                        } catch {
                            resolve(false);
                        }
                    } else {
                        resolve(false);
                    }
                });
            });

            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });

            req.write(data);
            req.end();
        });
    }

    /**
     * Makes a request to the Antigravity API.
     */
    private request<T>(path: string, body: object): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.processInfo) {
                reject(new Error('Not connected'));
                return;
            }

            const data = JSON.stringify(body);

            const options: https.RequestOptions = {
                hostname: '127.0.0.1',
                port: this.processInfo.connectPort,
                path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'Connect-Protocol-Version': '1',
                    'X-Codeium-Csrf-Token': this.processInfo.csrfToken,
                },
                rejectUnauthorized: false,
                timeout: 5000,
            };

            const req = https.request(options, res => {
                let body = '';
                res.on('data', chunk => (body += chunk));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body) as T);
                    } catch {
                        reject(new Error('Invalid JSON response'));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.write(data);
            req.end();
        });
    }

    /**
     * Parses the Antigravity API response into QuotaInfo objects.
     */
    private parseResponse(data: AntigravityUserStatus): QuotaInfo[] {
        const models = data.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];

        return models
            .filter(m => m.quotaInfo)
            .map(m => {
                const label = m.label || 'Unknown Model';
                const modelId = m.modelOrAlias?.model || label.toLowerCase().replace(/\s+/g, '-');
                const remainingFraction = m.quotaInfo?.remainingFraction ?? 1;
                const percentRemaining = remainingFraction * 100;

                // Parse reset time
                let resetTime: Date | null = null;
                if (m.quotaInfo?.resetTime) {
                    resetTime = new Date(m.quotaInfo.resetTime);
                }

                // Infer pool ID from model label
                const poolId = this.inferPoolId(label);

                // Calculate remaining/capacity (Antigravity uses fraction, we'll use 100 as capacity)
                const capacity = 100;
                const remaining = Math.round(remainingFraction * capacity);

                return QuotaHelpers.createQuotaInfo(
                    modelId,
                    label,
                    poolId,
                    remaining,
                    capacity,
                    resetTime,
                    this.thresholds
                );
            });
    }

    /**
     * Infers pool ID from model label.
     */
    private inferPoolId(label: string): string {
        const lowerLabel = label.toLowerCase();

        // Claude models share a pool (including GPT on some configs)
        if (lowerLabel.includes('claude')) {
            return 'claude-pool';
        }

        // Gemini Pro models (including numbered versions like Gemini 3 Pro)
        if (lowerLabel.includes('gemini') && lowerLabel.includes('pro')) {
            return 'gemini-pro-pool';
        }

        // Gemini Flash models
        if (lowerLabel.includes('gemini') && lowerLabel.includes('flash')) {
            return 'gemini-flash-pool';
        }

        // GPT models - may share with Claude
        if (lowerLabel.includes('gpt')) {
            return 'claude-pool'; // Based on user feedback
        }

        return 'default-pool';
    }
}

// Export singleton
export const antigravityClient = AntigravityClient.getInstance();
