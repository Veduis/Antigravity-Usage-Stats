/**
 * Antigravity Client - Connects to the local Antigravity language server
 * to fetch real quota data.
 * 
 * Supports Windows, macOS, and Linux platforms.
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
 * Supported platforms.
 */
type Platform = 'win32' | 'darwin' | 'linux';

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
 * Supports Windows, macOS, and Linux.
 */
export class AntigravityClient {
    private static instance: AntigravityClient;
    private processInfo: ProcessInfo | null = null;
    private thresholds: ThresholdConfig = { warning: 30, critical: 10 };
    private processName: string;
    private platform: Platform;

    private constructor() {
        // Detect platform and architecture
        this.platform = process.platform as Platform;
        const arch = process.arch === 'arm64' ? '_arm' : '_x64';
        
        // Set platform-specific process name
        switch (this.platform) {
            case 'win32':
                this.processName = `language_server_windows${arch}.exe`;
                break;
            case 'darwin':
                this.processName = `language_server_macos${arch}`;
                break;
            default:
                this.processName = `language_server_linux${arch}`;
        }
        
        logger.info(`AntigravityClient initialized for ${this.platform}, process: ${this.processName}`);
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
        logger.info(`Attempting to connect to Antigravity language server on ${this.platform}...`);

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

    // =========================================================================
    // Platform-Specific Process Discovery
    // =========================================================================

    /**
     * Finds the Antigravity language server process (platform-aware).
     */
    private async findProcess(): Promise<Omit<ProcessInfo, 'connectPort'> | null> {
        switch (this.platform) {
            case 'win32':
                return this.findProcessWindows();
            case 'darwin':
                return this.findProcessMacOS();
            default:
                return this.findProcessLinux();
        }
    }

    /**
     * Checks if a command line belongs to an Antigravity process (vs Codeium).
     * Both use the same language_server binary, so we need to distinguish them.
     */
    private isAntigravityProcess(commandLine: string): boolean {
        const lowerCmd = commandLine.toLowerCase();

        // Check for --app_data_dir antigravity parameter
        if (/--app_data_dir\s+antigravity\b/i.test(commandLine)) {
            logger.debug('Process identified as Antigravity (--app_data_dir match)');
            return true;
        }

        // Check for antigravity in the path
        if (lowerCmd.includes('\\antigravity\\') || lowerCmd.includes('/antigravity/')) {
            logger.debug('Process identified as Antigravity (path match)');
            return true;
        }

        logger.debug('Process is NOT Antigravity (possibly Codeium)');
        return false;
    }

    /**
     * Windows: Find process using PowerShell with WMIC fallback.
     */
    private async findProcessWindows(): Promise<Omit<ProcessInfo, 'connectPort'> | null> {
        // Try PowerShell first
        const psResult = await this.findProcessWindowsPowerShell();
        if (psResult) {
            return psResult;
        }

        // Fallback to WMIC for older Windows systems
        logger.debug('PowerShell failed, trying WMIC fallback...');
        return this.findProcessWindowsWmic();
    }

    /**
     * Windows: Find process using PowerShell.
     */
    private async findProcessWindowsPowerShell(): Promise<Omit<ProcessInfo, 'connectPort'> | null> {
        try {
            // Use proper PowerShell escaping with -Filter clause for better performance
            const cmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='${this.processName}'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json"`;
            
            logger.debug(`Executing PowerShell command: ${cmd}`);
            const { stdout, stderr } = await execAsync(cmd, { timeout: 15000 });
            
            if (stderr) {
                logger.debug(`PowerShell stderr: ${stderr}`);
            }

            if (!stdout.trim()) {
                logger.debug('PowerShell returned empty output');
                return null;
            }

            logger.debug(`PowerShell stdout (${stdout.length} chars): ${stdout.substring(0, 500)}`);

            // Parse JSON result (could be array or single object)
            let processes;
            try {
                processes = JSON.parse(stdout.trim());
            } catch (parseError) {
                logger.debug('Failed to parse PowerShell JSON output', parseError instanceof Error ? parseError : undefined);
                return null;
            }

            if (!Array.isArray(processes)) {
                processes = [processes];
            }

            logger.debug(`Found ${processes.length} language_server process(es)`);

            // Filter to only Antigravity processes (not Codeium)
            const antigravityProcesses = processes.filter(
                (proc: { CommandLine?: string; ProcessId?: number }) =>
                    proc.CommandLine && this.isAntigravityProcess(proc.CommandLine)
            );

            logger.info(`Found ${antigravityProcesses.length} Antigravity process(es) out of ${processes.length} total`);

            for (const proc of antigravityProcesses) {
                if (proc.CommandLine && proc.ProcessId) {
                    const result = this.parseCommandLine(proc.ProcessId, proc.CommandLine);
                    if (result) {
                        return result;
                    }
                }
            }

            return null;
        } catch (error) {
            logger.debug('Windows PowerShell process discovery failed', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Windows: Find process using WMIC (fallback for older systems).
     */
    private async findProcessWindowsWmic(): Promise<Omit<ProcessInfo, 'connectPort'> | null> {
        try {
            const cmd = `wmic process where "name='${this.processName}'" get ProcessId,CommandLine /format:list`;
            
            logger.debug(`Executing WMIC command: ${cmd}`);
            const { stdout } = await execAsync(cmd, { timeout: 10000 });
            
            if (!stdout.trim()) {
                return null;
            }

            // Parse WMIC output (format: key=value pairs separated by blank lines)
            const blocks = stdout.split(/\n\s*\n/).filter(block => block.trim().length > 0);
            
            for (const block of blocks) {
                const pidMatch = block.match(/ProcessId=(\d+)/);
                const cmdLineMatch = block.match(/CommandLine=(.+)/);

                if (!pidMatch || !cmdLineMatch) {
                    continue;
                }

                const commandLine = cmdLineMatch[1].trim();
                
                // Check if this is an Antigravity process
                if (!this.isAntigravityProcess(commandLine)) {
                    continue;
                }

                const pid = parseInt(pidMatch[1], 10);
                const result = this.parseCommandLine(pid, commandLine);
                if (result) {
                    logger.info(`WMIC found Antigravity process PID: ${pid}`);
                    return result;
                }
            }

            return null;
        } catch (error) {
            logger.debug('Windows WMIC process discovery failed', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * macOS: Find process using ps aux.
     */
    private async findProcessMacOS(): Promise<Omit<ProcessInfo, 'connectPort'> | null> {
        try {
            // Use ps aux to get all processes with full command line
            const cmd = `ps aux | grep -v grep | grep '${this.processName}'`;
            const { stdout } = await execAsync(cmd, { timeout: 5000 });

            const lines = stdout.split('\n');
            for (const line of lines) {
                if (line.includes('--csrf_token')) {
                    // macOS ps aux format: USER PID %CPU %MEM VSZ RSS TT STAT STARTED TIME COMMAND
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 11) {
                        const pid = parseInt(parts[1], 10);
                        // Command line starts at index 10
                        const cmdLine = parts.slice(10).join(' ');
                        const result = this.parseCommandLine(pid, cmdLine);
                        if (result) {
                            return result;
                        }
                    }
                }
            }

            return null;
        } catch (error) {
            logger.debug('macOS process discovery failed', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Linux: Find process using pgrep.
     */
    private async findProcessLinux(): Promise<Omit<ProcessInfo, 'connectPort'> | null> {
        try {
            const cmd = `pgrep -af ${this.processName}`;
            const { stdout } = await execAsync(cmd, { timeout: 5000 });

            const lines = stdout.split('\n');
            for (const line of lines) {
                if (line.includes('--extension_server_port')) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parseInt(parts[0], 10);
                    const cmdLine = line.substring(parts[0].length).trim();
                    const result = this.parseCommandLine(pid, cmdLine);
                    if (result) {
                        return result;
                    }
                }
            }

            return null;
        } catch (error) {
            logger.debug('Linux process discovery failed', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Parses command line to extract port and CSRF token.
     */
    private parseCommandLine(pid: number, cmdLine: string): Omit<ProcessInfo, 'connectPort'> | null {
        const portMatch = cmdLine.match(/--extension_server_port[=\s]+(\d+)/);
        // Use case-insensitive hex pattern for CSRF token (matches UUID format)
        const tokenMatch = cmdLine.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);

        if (tokenMatch && tokenMatch[1]) {
            logger.debug(`Parsed process: PID=${pid}, port=${portMatch ? portMatch[1] : 'N/A'}, csrf_token=${tokenMatch[1].substring(0, 8)}...`);
            return {
                pid,
                extensionPort: portMatch ? parseInt(portMatch[1], 10) : 0,
                csrfToken: tokenMatch[1],
            };
        }

        logger.debug(`Failed to parse CSRF token from command line for PID ${pid}`);
        return null;
    }

    // =========================================================================
    // Platform-Specific Port Discovery
    // =========================================================================

    /**
     * Gets listening ports for a process (platform-aware).
     */
    private async getListeningPorts(pid: number): Promise<number[]> {
        switch (this.platform) {
            case 'win32':
                return this.getListeningPortsWindows(pid);
            case 'darwin':
                return this.getListeningPortsMacOS(pid);
            default:
                return this.getListeningPortsLinux(pid);
        }
    }

    /**
     * Windows: Get listening ports using PowerShell with netstat fallback.
     */
    private async getListeningPortsWindows(pid: number): Promise<number[]> {
        // Try PowerShell first
        const psPorts = await this.getListeningPortsWindowsPowerShell(pid);
        if (psPorts.length > 0) {
            return psPorts;
        }

        // Fallback to netstat
        logger.debug('PowerShell port discovery returned no results, trying netstat...');
        return this.getListeningPortsWindowsNetstat(pid);
    }

    /**
     * Windows: Get listening ports using PowerShell.
     */
    private async getListeningPortsWindowsPowerShell(pid: number): Promise<number[]> {
        try {
            // Use simpler command that works across more Windows versions
            const cmd = `powershell -NoProfile -Command "Get-NetTCPConnection -OwningProcess ${pid} -State Listen | Select-Object -ExpandProperty LocalPort | ConvertTo-Json"`;
            
            logger.debug(`Executing PowerShell port command: ${cmd}`);
            const { stdout } = await execAsync(cmd, { timeout: 10000 });

            if (!stdout.trim()) {
                return [];
            }

            try {
                const data = JSON.parse(stdout.trim());
                const ports: number[] = [];

                if (Array.isArray(data)) {
                    for (const port of data) {
                        if (typeof port === 'number' && !ports.includes(port)) {
                            ports.push(port);
                        }
                    }
                } else if (typeof data === 'number') {
                    ports.push(data);
                }

                logger.debug(`PowerShell found ports: [${ports.join(', ')}]`);
                return ports.sort((a, b) => a - b);
            } catch {
                return [];
            }
        } catch (error) {
            logger.debug('Windows PowerShell port discovery failed', error instanceof Error ? error : undefined);
            return [];
        }
    }

    /**
     * Windows: Get listening ports using netstat (fallback).
     */
    private async getListeningPortsWindowsNetstat(pid: number): Promise<number[]> {
        try {
            const cmd = `netstat -ano | findstr "${pid}"`;
            
            logger.debug(`Executing netstat command: ${cmd}`);
            const { stdout } = await execAsync(cmd, { timeout: 10000 });

            const ports: number[] = [];
            // Match listening ports for the given PID
            // Format: TCP    127.0.0.1:42424        0.0.0.0:0              LISTENING       12345
            const portRegex = new RegExp(`(?:127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::\\]):(\\d+)\\s+(?:0\\.0\\.0\\.0:0|\\[::\\]:0|\\*:\\*).*?\\s+${pid}$`, 'gim');

            let match;
            while ((match = portRegex.exec(stdout)) !== null) {
                const port = parseInt(match[1], 10);
                if (!ports.includes(port)) {
                    ports.push(port);
                }
            }

            logger.debug(`Netstat found ports: [${ports.join(', ')}]`);
            return ports.sort((a, b) => a - b);
        } catch (error) {
            logger.debug('Windows netstat port discovery failed', error instanceof Error ? error : undefined);
            return [];
        }
    }

    /**
     * macOS: Get listening ports using lsof.
     */
    private async getListeningPortsMacOS(pid: number): Promise<number[]> {
        try {
            // lsof to find listening TCP ports for the process
            const cmd = `lsof -iTCP -sTCP:LISTEN -P -n -p ${pid} 2>/dev/null`;
            const { stdout } = await execAsync(cmd, { timeout: 5000 });

            const ports: number[] = [];
            const lines = stdout.split('\n');
            
            for (const line of lines) {
                // lsof output format: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
                // NAME contains the address:port, e.g., *:42424 or 127.0.0.1:42424
                const match = line.match(/:(\d+)\s*(\(LISTEN\))?$/);
                if (match) {
                    const port = parseInt(match[1], 10);
                    if (!ports.includes(port)) {
                        ports.push(port);
                    }
                }
            }

            return ports.sort((a, b) => a - b);
        } catch (error) {
            logger.debug('macOS port discovery failed', error instanceof Error ? error : undefined);
            return [];
        }
    }

    /**
     * Linux: Get listening ports using ss with lsof fallback.
     */
    private async getListeningPortsLinux(pid: number): Promise<number[]> {
        // Try ss first
        try {
            const cmd = `ss -tlnp 2>/dev/null | grep "pid=${pid},"`;
            const { stdout } = await execAsync(cmd, { timeout: 5000 });

            const ports: number[] = [];
            // Match ports from ss output
            const regex = /LISTEN\s+\d+\s+\d+\s+(?:\*|[\d.]+|\[[\da-f:]*\]):(\d+).*?users:.*?,pid=(\d+),/gi;

            let match;
            while ((match = regex.exec(stdout)) !== null) {
                const port = parseInt(match[1], 10);
                const matchedPid = parseInt(match[2], 10);
                if (matchedPid === pid && !ports.includes(port)) {
                    ports.push(port);
                }
            }

            if (ports.length > 0) {
                logger.debug(`ss found ports: [${ports.join(', ')}]`);
                return ports.sort((a, b) => a - b);
            }
        } catch (error) {
            logger.debug('Linux ss port discovery failed, trying lsof...', error instanceof Error ? error : undefined);
        }

        // Fallback to lsof
        try {
            const cmd = `lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null`;
            const { stdout } = await execAsync(cmd, { timeout: 5000 });

            const ports: number[] = [];
            const lsofRegex = new RegExp(`^\\S+\\s+${pid}\\s+.*?(?:TCP|UDP)\\s+(?:\\*|[\\d.]+|\\[[\\da-f:]+\\]):(\\d+)\\s+\\(LISTEN\\)`, 'gim');

            let match;
            while ((match = lsofRegex.exec(stdout)) !== null) {
                const port = parseInt(match[1], 10);
                if (!ports.includes(port)) {
                    ports.push(port);
                }
            }

            logger.debug(`lsof found ports: [${ports.join(', ')}]`);
            return ports.sort((a, b) => a - b);
        } catch (error) {
            logger.debug('Linux lsof port discovery failed', error instanceof Error ? error : undefined);
            return [];
        }
    }

    // =========================================================================
    // Port Testing & API Communication
    // =========================================================================

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
