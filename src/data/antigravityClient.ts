/**
 * Antigravity Client - Connects to the local Antigravity language server
 * to fetch real quota data.
 *
 * Supports Windows, macOS, and Linux platforms.
 * Based on reverse-engineering of the ag-quota extension by Henrik Mertens.
 * https://github.com/Henrik-3/AntigravityQuota
 */

import * as https from 'https';
import * as http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../services/logger';
import { QuotaInfo, FetchResult, QuotaHelpers, ThresholdConfig, PromptCreditsInfo } from './models';

const execAsync = promisify(exec);

/** 10MB buffer — prevents overflow when many VS Code instances are running */
const EXEC_OPTS = { timeout: 15000, maxBuffer: 10 * 1024 * 1024 };

/** Supported platforms. */
type Platform = 'win32' | 'darwin' | 'linux';

interface ProcessInfo {
    pid: number;
    extensionPort: number;
    csrfToken: string;
    connectPort: number;
    protocol: 'http' | 'https';
}

interface AntigravityModel {
    label?: string;
    modelOrAlias?: { model?: string };
    quotaInfo?: {
        remainingFraction?: number;
        resetTime?: string;
    };
}

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

/** Connection status for UI feedback. */
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export class AntigravityClient {
    private static instance: AntigravityClient;
    private processInfo: ProcessInfo | null = null;
    private thresholds: ThresholdConfig = { warning: 30, critical: 10 };
    private processName: string;
    private platform: Platform;
    private _status: ConnectionStatus = 'disconnected';
    private statusListeners: Array<(s: ConnectionStatus) => void> = [];

    private constructor() {
        this.platform = process.platform as Platform;
        const arch = process.arch === 'arm64' ? '_arm' : '_x64';

        switch (this.platform) {
            case 'win32':
                // Windows always ships x64 binary; ARM64 runs via emulation
                this.processName = `language_server_windows_x64.exe`;
                break;
            case 'darwin':
                this.processName = `language_server_macos${arch}`;
                break;
            default:
                this.processName = `language_server_linux${arch}`;
        }

        logger.info(`AntigravityClient initialized for ${this.platform}, process: ${this.processName}`);
    }

    public static getInstance(): AntigravityClient {
        if (!AntigravityClient.instance) {
            AntigravityClient.instance = new AntigravityClient();
        }
        return AntigravityClient.instance;
    }

    public setThresholds(thresholds: ThresholdConfig): void {
        this.thresholds = thresholds;
    }

    public isConnected(): boolean {
        return this.processInfo !== null;
    }

    public get status(): ConnectionStatus {
        return this._status;
    }

    public onStatusChange(listener: (s: ConnectionStatus) => void): () => void {
        this.statusListeners.push(listener);
        return () => {
            this.statusListeners = this.statusListeners.filter(l => l !== listener);
        };
    }

    private setStatus(s: ConnectionStatus): void {
        if (this._status === s) { return; }
        this._status = s;
        for (const l of this.statusListeners) {
            try { l(s); } catch { /* swallow */ }
        }
    }

    /** Discovers and connects to the Antigravity language server. */
    public async connect(): Promise<boolean> {
        logger.info(`Attempting to connect on ${this.platform}...`);
        this.setStatus('connecting');

        const maxRetries = 3;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            if (attempt > 0) {
                logger.debug(`Connection retry ${attempt + 1}/${maxRetries}, waiting 500ms...`);
                await new Promise(r => setTimeout(r, 500));
            }

            try {
                const basicInfo = await this.findProcess();
                if (!basicInfo) {
                    logger.warn(`Antigravity language server process not found (attempt ${attempt + 1})`);
                    continue;
                }

                logger.debug(`Found process PID: ${basicInfo.pid}, CSRF: ${basicInfo.csrfToken.substring(0, 8)}...`);

                const ports = await this.getListeningPorts(basicInfo.pid);
                if (ports.length === 0) {
                    logger.warn('No listening ports found for Antigravity process');
                    continue;
                }

                logger.debug(`Found ${ports.length} listening ports: ${ports.join(', ')}`);

                const workingPort = await this.findWorkingPort(ports, basicInfo.csrfToken);
                if (!workingPort) {
                    logger.warn('No working port found');
                    continue;
                }

                this.processInfo = {
                    ...basicInfo,
                    connectPort: workingPort.port,
                    protocol: workingPort.protocol,
                };

                logger.info(`Connected to Antigravity on port ${workingPort.port} (${workingPort.protocol})`);
                this.setStatus('connected');
                return true;
            } catch (error) {
                logger.error(`Connection attempt ${attempt + 1} failed`, error instanceof Error ? error : undefined);
            }
        }

        logger.error(`Failed to connect after ${maxRetries} attempts`);
        this.setStatus('disconnected');
        return false;
    }

    /** Fetches quota data from Antigravity. */
    public async fetchQuota(): Promise<FetchResult> {
        if (!this.processInfo) {
            const connected = await this.connect();
            if (!connected) {
                return {
                    success: false,
                    quotas: [],
                    promptCredits: undefined,
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

            const quotas = this.parseQuotas(response);
            const promptCredits = this.parsePromptCredits(response);

            this.setStatus('connected');
            return {
                success: true,
                quotas,
                promptCredits,
                source: 'local',
                timestamp: new Date(),
            };
        } catch (error) {
            logger.error('Failed to fetch quota', error instanceof Error ? error : undefined);
            this.processInfo = null;
            this.setStatus('error');

            return {
                success: false,
                quotas: [],
                promptCredits: undefined,
                error: error instanceof Error ? error.message : 'Fetch failed',
                source: 'local',
                timestamp: new Date(),
            };
        }
    }

    public disconnect(): void {
        this.processInfo = null;
        this.setStatus('disconnected');
        logger.info('Disconnected from Antigravity');
    }

    // =========================================================================
    // Platform-Specific Process Discovery
    // =========================================================================

    private async findProcess(): Promise<Omit<ProcessInfo, 'connectPort' | 'protocol'> | null> {
        switch (this.platform) {
            case 'win32':  return this.findProcessWindows();
            case 'darwin': return this.findProcessMacOS();
            default:       return this.findProcessLinux();
        }
    }

    /**
     * Checks if a command line belongs to an Antigravity process (vs Codeium).
     * Both share the same language_server binary name.
     */
    private isAntigravityProcess(commandLine: string): boolean {
        const lowerCmd = commandLine.toLowerCase();

        if (/--app_data_dir\s+antigravity\b/i.test(commandLine)) {
            logger.debug('Process identified as Antigravity (--app_data_dir match)');
            return true;
        }
        if (lowerCmd.includes('\\antigravity\\') || lowerCmd.includes('/antigravity/')) {
            logger.debug('Process identified as Antigravity (path match)');
            return true;
        }

        logger.debug('Process is NOT Antigravity (possibly Codeium or other)');
        return false;
    }

    /** Windows: PowerShell → tasklist fallback (WMIC removed in Win11 23H2+). */
    private async findProcessWindows(): Promise<Omit<ProcessInfo, 'connectPort' | 'protocol'> | null> {
        const psResult = await this.findProcessWindowsPowerShell();
        if (psResult) { return psResult; }

        logger.debug('PowerShell failed, trying tasklist fallback...');
        return this.findProcessWindowsTasklist();
    }

    private async findProcessWindowsPowerShell(): Promise<Omit<ProcessInfo, 'connectPort' | 'protocol'> | null> {
        try {
            const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \\"name='${this.processName}'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json"`;
            logger.debug(`PowerShell process cmd: ${cmd}`);
            const { stdout, stderr } = await execAsync(cmd, EXEC_OPTS);

            if (stderr) { logger.debug(`PowerShell stderr: ${stderr}`); }
            if (!stdout.trim()) { logger.debug('PowerShell returned empty output'); return null; }

            let processes;
            try {
                processes = JSON.parse(stdout.trim());
            } catch {
                logger.debug('Failed to parse PowerShell JSON output');
                return null;
            }

            if (!Array.isArray(processes)) { processes = [processes]; }
            logger.debug(`Found ${processes.length} language_server process(es)`);

            const ag = processes.filter(
                (p: { CommandLine?: string; ProcessId?: number }) =>
                    p.CommandLine && this.isAntigravityProcess(p.CommandLine)
            );
            logger.info(`${ag.length} Antigravity process(es) of ${processes.length} total`);

            for (const proc of ag) {
                if (proc.CommandLine && proc.ProcessId) {
                    const result = this.parseCommandLine(proc.ProcessId, proc.CommandLine);
                    if (result) { return result; }
                }
            }
            return null;
        } catch (error) {
            logger.debug('Windows PowerShell process discovery failed', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Windows: tasklist + findstr fallback. Works on Win11 23H2+ where WMIC is gone.
     * Gets CommandLine via a second PowerShell call using just Get-Process (lighter).
     */
    private async findProcessWindowsTasklist(): Promise<Omit<ProcessInfo, 'connectPort' | 'protocol'> | null> {
        try {
            // Use tasklist to find PID, then Get-Process for CommandLine
            const listCmd = `tasklist /FI "IMAGENAME eq ${this.processName}" /FO CSV /NH`;
            const { stdout: listOut } = await execAsync(listCmd, EXEC_OPTS);

            if (!listOut.trim() || listOut.includes('No tasks')) { return null; }

            // CSV format: "name","pid","session","#","mem"
            const pids: number[] = [];
            for (const line of listOut.split('\n')) {
                const parts = line.split(',');
                if (parts.length >= 2) {
                    const pid = parseInt(parts[1].replace(/"/g, '').trim(), 10);
                    if (!isNaN(pid)) { pids.push(pid); }
                }
            }

            if (pids.length === 0) { return null; }

            for (const pid of pids) {
                const cmdCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \\"ProcessId=${pid}\\" | Select-Object -ExpandProperty CommandLine"`;
                try {
                    const { stdout: cmdOut } = await execAsync(cmdCmd, EXEC_OPTS);
                    const cmdLine = cmdOut.trim();
                    if (cmdLine && this.isAntigravityProcess(cmdLine)) {
                        const result = this.parseCommandLine(pid, cmdLine);
                        if (result) {
                            logger.info(`tasklist fallback found Antigravity PID: ${pid}`);
                            return result;
                        }
                    }
                } catch { /* try next pid */ }
            }
            return null;
        } catch (error) {
            logger.debug('Windows tasklist fallback failed', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /** macOS: pgrep -fl with Antigravity filter. */
    private async findProcessMacOS(): Promise<Omit<ProcessInfo, 'connectPort' | 'protocol'> | null> {
        try {
            const cmd = `pgrep -fl ${this.processName}`;
            const { stdout } = await execAsync(cmd, { timeout: 5000, maxBuffer: EXEC_OPTS.maxBuffer });

            for (const line of stdout.split('\n')) {
                if (!line.includes('--extension_server_port')) { continue; }
                if (!this.isAntigravityProcess(line)) { continue; }
                const parts = line.trim().split(/\s+/);
                const pid = parseInt(parts[0], 10);
                const cmdLine = line.substring(parts[0].length).trim();
                const result = this.parseCommandLine(pid, cmdLine);
                if (result) { return result; }
            }
            return null;
        } catch (error) {
            logger.debug('macOS process discovery failed', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /** Linux: pgrep -af with Antigravity filter. */
    private async findProcessLinux(): Promise<Omit<ProcessInfo, 'connectPort' | 'protocol'> | null> {
        try {
            const cmd = `pgrep -af ${this.processName}`;
            const { stdout } = await execAsync(cmd, { timeout: 5000, maxBuffer: EXEC_OPTS.maxBuffer });

            for (const line of stdout.split('\n')) {
                if (!line.includes('--extension_server_port')) { continue; }
                if (!this.isAntigravityProcess(line)) { continue; }
                const parts = line.trim().split(/\s+/);
                const pid = parseInt(parts[0], 10);
                const cmdLine = line.substring(parts[0].length).trim();
                const result = this.parseCommandLine(pid, cmdLine);
                if (result) { return result; }
            }
            return null;
        } catch (error) {
            logger.debug('Linux process discovery failed', error instanceof Error ? error : undefined);
            return null;
        }
    }

    private parseCommandLine(pid: number, cmdLine: string): Omit<ProcessInfo, 'connectPort' | 'protocol'> | null {
        const portMatch = cmdLine.match(/--extension_server_port[=\s]+(\d+)/);
        const tokenMatch = cmdLine.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);

        if (tokenMatch && tokenMatch[1]) {
            logger.debug(`Parsed: PID=${pid}, port=${portMatch?.[1] ?? 'N/A'}, csrf=${tokenMatch[1].substring(0, 8)}...`);
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

    private async getListeningPorts(pid: number): Promise<number[]> {
        switch (this.platform) {
            case 'win32':  return this.getListeningPortsWindows(pid);
            case 'darwin': return this.getListeningPortsMacOS(pid);
            default:       return this.getListeningPortsLinux(pid);
        }
    }

    /**
     * Windows: Merge PowerShell + netstat results.
     * PowerShell requires admin on some configs; netstat always works.
     */
    private async getListeningPortsWindows(pid: number): Promise<number[]> {
        const [psPorts, netstatPorts] = await Promise.all([
            this.getListeningPortsWindowsPowerShell(pid),
            this.getListeningPortsWindowsNetstat(pid),
        ]);

        // Merge, deduplicate, sort
        const merged = [...new Set([...psPorts, ...netstatPorts])].sort((a, b) => a - b);
        logger.debug(`Windows ports (merged PS+netstat): [${merged.join(', ')}]`);
        return merged;
    }

    private async getListeningPortsWindowsPowerShell(pid: number): Promise<number[]> {
        try {
            const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -OwningProcess ${pid} -State Listen | Select-Object -ExpandProperty LocalPort | ConvertTo-Json"`;
            logger.debug(`PowerShell port cmd for PID ${pid}`);
            const { stdout } = await execAsync(cmd, EXEC_OPTS);

            if (!stdout.trim()) { return []; }

            const data = JSON.parse(stdout.trim());
            const ports: number[] = [];
            if (Array.isArray(data)) {
                for (const p of data) { if (typeof p === 'number') { ports.push(p); } }
            } else if (typeof data === 'number') {
                ports.push(data);
            }
            return [...new Set(ports)].sort((a, b) => a - b);
        } catch (error) {
            logger.debug('Windows PowerShell port discovery failed', error instanceof Error ? error : undefined);
            return [];
        }
    }

    private async getListeningPortsWindowsNetstat(pid: number): Promise<number[]> {
        try {
            // Use /E (end-of-line anchor) to match PID exactly, preventing partial matches
            const cmd = `netstat -ano | findstr "LISTENING" | findstr /E " ${pid}"`;
            logger.debug(`Netstat port cmd for PID ${pid}`);
            const { stdout } = await execAsync(cmd, EXEC_OPTS);

            const ports: number[] = [];
            // Match IPv4 (127.0.0.1, 0.0.0.0) and IPv6 ([::], [::1]) localhost
            const portRegex = /(?:127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d+)/gi;

            let match;
            while ((match = portRegex.exec(stdout)) !== null) {
                const port = parseInt(match[1], 10);
                if (!ports.includes(port)) { ports.push(port); }
            }

            logger.debug(`Netstat found ports: [${ports.join(', ')}]`);
            return ports.sort((a, b) => a - b);
        } catch (error) {
            // findstr exits 1 when no match — not a real error
            logger.debug('Windows netstat port discovery returned no results');
            return [];
        }
    }

    private async getListeningPortsMacOS(pid: number): Promise<number[]> {
        try {
            const cmd = `lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid}`;
            const { stdout } = await execAsync(cmd, { timeout: 5000, maxBuffer: EXEC_OPTS.maxBuffer });

            const ports: number[] = [];
            const regex = new RegExp(`^\\S+\\s+${pid}\\s+.*?(?:TCP|UDP)\\s+(?:\\*|[\\d.]+|\\[[\\da-f:]+\\]):(\\d+)\\s+\\(LISTEN\\)`, 'gim');
            let match;
            while ((match = regex.exec(stdout)) !== null) {
                const port = parseInt(match[1], 10);
                if (!ports.includes(port)) { ports.push(port); }
            }
            return ports.sort((a, b) => a - b);
        } catch (error) {
            logger.debug('macOS port discovery failed', error instanceof Error ? error : undefined);
            return [];
        }
    }

    /**
     * Linux: ss || lsof combined in a single shell command.
     * Using "|| true" prevents grep's exit code 1 (no match) from throwing.
     */
    private async getListeningPortsLinux(pid: number): Promise<number[]> {
        try {
            const cmd = `(ss -tlnp 2>/dev/null | grep "pid=${pid}," || true) && (lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null || true)`;
            const { stdout } = await execAsync(cmd, { timeout: 5000, maxBuffer: EXEC_OPTS.maxBuffer });

            const ports: number[] = [];

            // Parse ss output
            const ssRegex = /LISTEN\s+\d+\s+\d+\s+(?:\*|[\d.]+|\[[\da-f:]*\]):(\d+).*?users:.*?,pid=(\d+),/gi;
            let match;
            while ((match = ssRegex.exec(stdout)) !== null) {
                if (parseInt(match[2], 10) === pid) {
                    const port = parseInt(match[1], 10);
                    if (!ports.includes(port)) { ports.push(port); }
                }
            }

            // Parse lsof output
            const lsofRegex = new RegExp(`^\\S+\\s+${pid}\\s+.*?(?:TCP|UDP)\\s+(?:\\*|[\\d.]+|\\[[\\da-f:]+\\]):(\\d+)\\s+\\(LISTEN\\)`, 'gim');
            while ((match = lsofRegex.exec(stdout)) !== null) {
                const port = parseInt(match[1], 10);
                if (!ports.includes(port)) { ports.push(port); }
            }

            logger.debug(`Linux ports for PID ${pid}: [${ports.join(', ')}]`);
            return ports.sort((a, b) => a - b);
        } catch (error) {
            logger.debug('Linux port discovery failed', error instanceof Error ? error : undefined);
            return [];
        }
    }

    // =========================================================================
    // Port Testing & API Communication
    // =========================================================================

    private async findWorkingPort(ports: number[], csrfToken: string): Promise<{ port: number; protocol: 'http' | 'https' } | null> {
        for (const port of ports) {
            const protocol = await this.testPort(port, csrfToken);
            if (protocol) { return { port, protocol }; }
        }
        return null;
    }

    private async testPort(port: number, csrfToken: string): Promise<'http' | 'https' | null> {
        // The reference extension always uses HTTPS — try it first
        if (await this.testPortWithProtocol('https', port, csrfToken)) { return 'https'; }
        if (await this.testPortWithProtocol('http', port, csrfToken)) { return 'http'; }
        return null;
    }

    private testPortWithProtocol(protocol: 'http' | 'https', port: number, csrfToken: string): Promise<boolean> {
        return new Promise(resolve => {
            const data = JSON.stringify({ wrapper_data: {} });
            const options = {
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

            const reqLib = protocol === 'https' ? https : http;
            const req = reqLib.request(options, res => {
                let body = '';
                res.on('data', chunk => (body += chunk));
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try { JSON.parse(body); resolve(true); } catch { resolve(false); }
                    } else {
                        resolve(false);
                    }
                });
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
            req.write(data);
            req.end();
        });
    }

    private request<T>(path: string, body: object): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.processInfo) { reject(new Error('Not connected')); return; }

            const data = JSON.stringify(body);
            const options = {
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

            const reqLib = this.processInfo.protocol === 'https' ? https : http;
            const req = reqLib.request(options, res => {
                let body = '';
                res.on('data', chunk => (body += chunk));
                res.on('end', () => {
                    try { resolve(JSON.parse(body) as T); }
                    catch { reject(new Error('Invalid JSON response')); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
            req.write(data);
            req.end();
        });
    }

    // =========================================================================
    // Response Parsing
    // =========================================================================

    private parseQuotas(data: AntigravityUserStatus): QuotaInfo[] {
        const models = data.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];

        return models
            .filter(m => m.quotaInfo)
            .map(m => {
                const label = m.label || 'Unknown Model';
                const modelId = m.modelOrAlias?.model || label.toLowerCase().replace(/\s+/g, '-');
                const remainingFraction = m.quotaInfo?.remainingFraction ?? 1;

                let resetTime: Date | null = null;
                if (m.quotaInfo?.resetTime) {
                    const parsed = new Date(m.quotaInfo.resetTime);
                    if (!isNaN(parsed.getTime())) { resetTime = parsed; }
                }

                return QuotaHelpers.createQuotaInfo(
                    modelId,
                    label,
                    this.inferPoolId(label),
                    Math.round(remainingFraction * 100),
                    100,
                    resetTime,
                    this.thresholds
                );
            });
    }

    private parsePromptCredits(data: AntigravityUserStatus): PromptCreditsInfo | undefined {
        const planStatus = data.userStatus?.planStatus;
        if (!planStatus) { return undefined; }

        const available = Number(planStatus.availablePromptCredits);
        const monthly = Number(planStatus.planInfo?.monthlyPromptCredits);

        if (isNaN(available) || isNaN(monthly) || monthly <= 0) { return undefined; }

        // Robust calculation: handle cases where user has rollover/flex credits
        // (which can make available > monthly limit)
        const effectiveMax = Math.max(monthly, available);
        const remainingPercentage = Math.min(100, Math.max(0, (available / effectiveMax) * 100));
        const usedPercentage = Math.min(100, Math.max(0, ((effectiveMax - available) / effectiveMax) * 100));

        return {
            available,
            monthly,
            usedPercentage,
            remainingPercentage,
        };
    }

    private inferPoolId(label: string): string {
        const l = label.toLowerCase();
        if (l.includes('claude')) { return 'claude-pool'; }
        if (l.includes('gemini') && l.includes('pro')) { return 'gemini-pro-pool'; }
        if (l.includes('gemini') && l.includes('flash')) { return 'gemini-flash-pool'; }
        if (l.includes('gemini')) { return 'gemini-pool'; }
        if (l.includes('gpt')) { return 'gpt-pool'; }
        return 'default-pool';
    }
}

export const antigravityClient = AntigravityClient.getInstance();
