import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListToolsResultSchema, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { spawn, execSync, SpawnOptions } from "child_process";
import fs from 'fs';
import path from 'path';

export type KqlBackend = 'kusto-cli' | 'mcp' | 'none';

export class ToolManager {
    private mcpClient: Client | null = null;
    private transport: StdioClientTransport | null = null;
    private ready: boolean = false;
    public initError: string | null = null;
    private workDir: string | undefined;
    private kqlBackend: KqlBackend = 'none';
    private kustoCliPath: string | null = null;

    private repoRoot: string;

    constructor() {
        this.repoRoot = process.env.REPO_ROOT || path.resolve(process.cwd(), '..');
    }

    /**
     * Set the repo root path from config. Call this after loading config.
     */
    public setRepoRoot(repoRoot: string) {
        this.repoRoot = repoRoot;
    }

    public getKqlBackend(): KqlBackend { return this.kqlBackend; }

    public async checkAzureAuth(log: (msg: string) => void): Promise<boolean> {
        log("Checking Azure authentication status...");
        return new Promise((resolve) => {
            // Don't pass cwd here — az account show reads tokens from ~/.azure/
            // and doesn't need a specific working directory. Using a non-existent
            // cwd would cause spawn to ENOENT, falsely reporting auth failure.
            const check = spawn('az', ['account', 'show'], { shell: true });
            check.on('close', (code) => {
                if (code === 0) {
                    log("Azure authentication verified.");
                    resolve(true);
                } else {
                    log("Azure authentication failed. Please run 'az login'.");
                    resolve(false);
                }
            });
            check.on('error', () => {
                log("Failed to execute 'az' command. Is Azure CLI installed?");
                resolve(false);
            });
        });
    }

    async initialize(cwd?: string, logger?: (msg: string) => void) {
        this.workDir = cwd;
        const log = logger || console.log;

        // Reset state at the start of each initialization attempt so stale
        // errors from previous attempts don't persist.
        this.initError = null;
        this.ready = false;

        if (this.workDir) log(`Initializing ToolManager in ${this.workDir}`);

        // 1. Check Azure Auth
        const isAuth = await this.checkAzureAuth(log);
        if (!isAuth) {
            this.initError = "Azure Authentication Required. Please log in.";
            log("Initialization aborted due to missing Azure Auth.");
            return;
        }

        // 2. Validate working directory exists (if specified)
        if (this.workDir && !fs.existsSync(this.workDir)) {
            this.initError = `Working directory does not exist: ${this.workDir}. Please check the product configuration in Settings.`;
            log(`Working directory not found: ${this.workDir}`);
            return;
        }

        // 3. Try Kusto CLI first (fast, no server process needed)
        const cliPath = await this.detectKustoCli(log);
        if (cliPath) {
            this.kustoCliPath = cliPath;
            this.kqlBackend = 'kusto-cli';
            this.ready = true;
            this.initError = null;
            log(`Kusto CLI detected at: ${cliPath}`);
            log("Using Kusto CLI as primary KQL backend (no MCP server needed).");
            return;
        }

        log("Kusto CLI not found. Falling back to MCP KQL Server...");

        // 4. Fall back to MCP Server
        await this.initializeMcp(log);
    }

    /**
     * Detect Kusto.Cli.exe on the system. Checks:
     * 1. System PATH
     * 2. C:\Kusto\Kusto.Cli.exe (documented install location)
     * 3. NuGet packages cache
     * 4. Auto-installs from NuGet if not found anywhere
     */
    private async detectKustoCli(log: (msg: string) => void): Promise<string | null> {
        log("Checking for Kusto CLI...");

        // Check PATH first
        try {
            const result = execSync('where Kusto.Cli.exe 2>nul', { encoding: 'utf-8', timeout: 5000 }).trim();
            if (result) {
                const firstPath = result.split('\n')[0].trim();
                if (fs.existsSync(firstPath)) return firstPath;
            }
        } catch { /* not in PATH */ }

        // Check well-known locations
        const candidates = [
            'C:\\Kusto\\Kusto.Cli.exe',
            path.join(process.env.USERPROFILE || '', '.nuget', 'packages', 'microsoft.azure.kusto.tools'),
        ];

        for (const candidate of candidates) {
            if (candidate.endsWith('.exe') && fs.existsSync(candidate)) return candidate;
            // For the NuGet package dir, search for the exe inside
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                try {
                    const found = this.findFileRecursive(candidate, 'Kusto.Cli.exe', 4);
                    if (found) return found;
                } catch { /* ignore */ }
            }
        }

        // Not found — attempt auto-install
        log("Kusto CLI not found in PATH or known locations. Attempting auto-install...");
        return await this.autoInstallKustoCli(log);
    }

    /**
     * Auto-install Kusto CLI from the NuGet package.
     * Downloads Microsoft.Azure.Kusto.Tools and extracts Kusto.Cli.exe to C:\Kusto\.
     */
    private async autoInstallKustoCli(log: (msg: string) => void): Promise<string | null> {
        const installDir = 'C:\\Kusto';
        const nugetUrl = 'https://www.nuget.org/api/v2/package/Microsoft.Azure.Kusto.Tools/14.0.3';
        const nupkgPath = path.join(installDir, 'kusto-tools.nupkg');
        const zipPath = path.join(installDir, 'kusto-tools.zip');

        // Skip download if already extracted from a previous install (Setup-Dashboard.ps1 or prior auto-install)
        if (fs.existsSync(installDir)) {
            const existingExe = this.findFileRecursive(installDir, 'Kusto.Cli.exe', 5);
            if (existingExe) {
                log(`Kusto CLI found from previous install: ${existingExe}`);
                return existingExe;
            }
        }

        try {
            // Create install directory
            if (!fs.existsSync(installDir)) {
                fs.mkdirSync(installDir, { recursive: true });
                log(`Created directory: ${installDir}`);
            }

            // Download the NuGet package using curl (available on Windows 10+)
            log("Downloading Microsoft.Azure.Kusto.Tools NuGet package (this may take a minute)...");
            execSync(
                `curl -L -o "${nupkgPath}" "${nugetUrl}"`,
                { encoding: 'utf-8', timeout: 120000, stdio: 'pipe' }
            );

            if (!fs.existsSync(nupkgPath)) {
                log("Download failed — NuGet package file not created.");
                return null;
            }

            const fileSize = fs.statSync(nupkgPath).size;
            log(`Downloaded ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

            if (fileSize < 1024 * 100) {
                log("Download appears too small — possible network error. Cleaning up.");
                fs.unlinkSync(nupkgPath);
                return null;
            }

            // NuGet packages are ZIP files — rename and extract using PowerShell
            fs.renameSync(nupkgPath, zipPath);
            log("Extracting Kusto CLI from NuGet package...");
            execSync(
                `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${installDir}' -Force"`,
                { encoding: 'utf-8', timeout: 120000, stdio: 'pipe' }
            );

            // Clean up zip
            try { fs.unlinkSync(zipPath); } catch { /* ignore */ }

            // Search for Kusto.Cli.exe in the extracted contents
            // Typically at: tools/net6.0/Kusto.Cli.exe or tools/net8.0/Kusto.Cli.exe
            const found = this.findFileRecursive(installDir, 'Kusto.Cli.exe', 5);
            if (found) {
                log(`Kusto CLI auto-installed successfully: ${found}`);
                log("Tip: Add the containing directory to your PATH for faster startup next time.");
                return found;
            }

            log("Extraction completed but Kusto.Cli.exe not found in package contents.");
            return null;
        } catch (err: any) {
            log(`Auto-install failed: ${err.message}`);
            log("You can manually install: download https://www.nuget.org/packages/Microsoft.Azure.Kusto.Tools/14.0.3");
            log("  Extract to C:\\Kusto and add to PATH.");
            return null;
        }
    }

    private findFileRecursive(dir: string, filename: string, maxDepth: number): string | null {
        if (maxDepth <= 0) return null;
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return fullPath;
                if (entry.isDirectory()) {
                    const found = this.findFileRecursive(fullPath, filename, maxDepth - 1);
                    if (found) return found;
                }
            }
        } catch { /* permission error, etc. */ }
        return null;
    }

    /**
     * Execute a KQL query using Kusto.Cli.exe
     */
    private async executeKqlViaCli(query: string, clusterUrl: string, database: string): Promise<string> {
        if (!this.kustoCliPath) throw new Error("Kusto CLI not available");

        // Block destructive management commands
        const destructivePattern = /^\s*\.(drop|delete|purge|alter|set|append|move|replace|create-or-alter)\b/i;
        if (destructivePattern.test(query)) {
            throw new Error('Destructive management commands are not allowed.');
        }

        // Validate clusterUrl: must be a proper Kusto HTTPS URL
        if (!/^https:\/\/[a-zA-Z0-9._-]+\.kusto\.windows\.net$/i.test(clusterUrl)) {
            throw new Error(`Invalid cluster URL: ${clusterUrl}`);
        }
        // Validate database name: only alphanumeric, underscore, dash
        if (!/^[a-zA-Z0-9_-]+$/.test(database)) {
            throw new Error(`Invalid database name: ${database}`);
        }

        const connectionString = `Data Source=${clusterUrl};Initial Catalog=${database}`;

        // Use single quotes for the -execute argument to avoid PowerShell $variable expansion
        // This handles $left/$right in JOIN queries
        return new Promise((resolve, reject) => {
            const args = [connectionString, `-execute:${query}`];
            const options: SpawnOptions = {
                cwd: this.workDir,
                shell: false, // Don't use shell to avoid escaping issues
                timeout: 120000 // 2 minute timeout
            };

            const proc = spawn(this.kustoCliPath!, args, options);
            let stdout = '';
            let stderr = '';

            proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
            proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

            proc.on('close', (code) => {
                if (code !== 0 && !stdout) {
                    reject(new Error(`Kusto CLI failed (exit ${code}): ${stderr || 'Unknown error'}`));
                } else {
                    // Kusto CLI outputs results to stdout. Parse and return.
                    resolve(this.parseKustoCliOutput(stdout, query));
                }
            });

            proc.on('error', (err) => {
                reject(new Error(`Failed to run Kusto CLI: ${err.message}`));
            });
        });
    }

    /**
     * Parse Kusto.Cli.exe output into structured JSON result
     */
    private parseKustoCliOutput(raw: string, query: string): string {
        // Kusto CLI outputs tab-separated data with a header line
        // Lines starting with // are comments/status messages
        const lines = raw.split('\n');
        const dataLines: string[] = [];
        const statusLines: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('//') || trimmed.startsWith('@')) {
                statusLines.push(trimmed);
            } else {
                dataLines.push(trimmed);
            }
        }

        if (dataLines.length === 0) {
            return JSON.stringify({
                success: true,
                query,
                row_count: 0,
                results: [],
                status: statusLines.join('\n')
            });
        }

        // Parse TSV: first data line is headers
        const headers = dataLines[0].split('\t').map(h => h.trim());
        const rows: Record<string, string>[] = [];

        for (let i = 1; i < dataLines.length; i++) {
            const values = dataLines[i].split('\t');
            const row: Record<string, string> = {};
            for (let j = 0; j < headers.length; j++) {
                row[headers[j]] = (values[j] || '').trim();
            }
            rows.push(row);
        }

        return JSON.stringify({
            success: true,
            query,
            row_count: rows.length,
            results: rows
        });
    }

    private async initializeMcp(log: (msg: string) => void) {
        // Start the Python KQL MCP Server
        // Assuming python is in path and mcp_kql_server is installed
        log("Initializing KQL MCP Server...");
        this.initError = null;

        const spawnOptions = this.workDir ? { cwd: this.workDir, shell: true } : { shell: true };

        try {
            log("Checking if mcp_kql_server is installed...");
            // Use pip show to check installation without running the code
            const check = spawn('pip', ['show', 'mcp_kql_server'], spawnOptions);

            await new Promise((resolve, reject) => {
                check.on('close', (code) => {
                    if (code === 0) resolve(true);
                    else reject(new Error(`Package not found (code ${code})`));
                });
                check.on('error', reject);
            }).catch(async (err) => {
                log(`mcp_kql_server not found. Attempting install...`);

                const install = spawn('pip', ['install', 'mcp_kql_server'], spawnOptions);

                install.stdout.on('data', (data) => log(`[pip] ${data.toString().trim()}`));
                install.stderr.on('data', (data) => log(`[pip error] ${data.toString().trim()}`));

                await new Promise((resolve, reject) => {
                    install.on('close', (code) => {
                        if (code === 0) {
                            log("Installation successful.");
                            resolve(true);
                        }
                        else reject(new Error(`Failed to install mcp_kql_server (exit code ${code})`));
                    });
                    install.on('error', (err) => reject(new Error(`Failed to spawn pip install: ${err.message}`)));
                });
            });

            log("Connecting to MCP Server...");
            // Pass cwd to StdioClientTransport if supported, or via some mechanism
            // Note: StdioClientTransport constructor usually takes command, args, env. 
            // If it doesn't support cwd, we might be limited. 
            // However, we can trick it by using a shell command that cd's first if needed?
            // Or hopefully the SDK allows generic spawn options.
            // For now, I'll assume config object spreads into spawn.
            this.transport = new StdioClientTransport({
                command: "python",
                args: ["-m", "mcp_kql_server"],
                cwd: this.workDir
            } as any); // cast to any to avoid TS errors if definition is strict/missing

            this.mcpClient = new Client({
                name: "InvestigationDashboard",
                version: "1.0.0"
            }, {
                capabilities: {}
            });

            // Give the MCP server up to 3 minutes for the initialize handshake.
            // The KQL server does Azure CLI auth during startup, which can take >60s.
            await this.mcpClient.connect(this.transport, { timeout: 180000 });
            log("Connected to KQL MCP Server. Verifying responsiveness...");

            // Verify by listing tools (Readiness Check)
            const maxRetries = 10;
            for (let i = 1; i <= maxRetries; i++) {
                try {
                    // Timeout the request after 120 seconds to avoid hanging indefinitely if server is stuck
                    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 120000));
                    const listTools = this.mcpClient.request({ method: "tools/list" }, ListToolsResultSchema, { timeout: 120000 });

                    await Promise.race([listTools, timeout]);
                    log("MCP Server is ready and responding.");
                    this.ready = true;
                    this.kqlBackend = 'mcp';
                    break;
                } catch (e: any) {
                    if (i === maxRetries) throw new Error(`MCP Server unresponsive after ${maxRetries} attempts: ${e.message}`);
                    log(`Waiting for MCP server to be ready... (Attempt ${i}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }

        } catch (error: any) {
            this.initError = error.message || String(error);
            log(`Failed to connect/install MCP server: ${this.initError}`);
            log("Continuing without MCP server (some tools may be unavailable).");

            this.mcpClient = null;
            this.transport = null;
        }
    }



    async listTools(): Promise<any[]> {
        const localTools: any[] = [
            {
                name: "read_file",
                description: "Read file content",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" }
                    },
                    required: ["path"]
                }
            },
            {
                name: "list_dir",
                description: "List directory contents",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" }
                    },
                    required: ["path"]
                }
            },
            {
                name: "finish",
                description: "Complete the investigation with a summary. For scheduled health checks, include a verdict.",
                inputSchema: {
                    type: "object",
                    properties: {
                        summary: { type: "string", description: "Final summary of the investigation." },
                        verdict: { type: "string", enum: ["healthy", "warning", "critical"], description: "Health verdict for scheduled checks. Use 'healthy' if no issues, 'warning' for minor concerns, 'critical' for urgent issues." }
                    },
                    required: ["summary"]
                }
            }
        ];

        // If Kusto CLI is available, add KQL tools as local tools
        if (this.kqlBackend === 'kusto-cli') {
            localTools.push(
                {
                    name: "execute_kql_query",
                    description: "Execute a KQL query against Azure Data Explorer (Kusto) cluster. ALWAYS use time filters like 'where ingestion_time() > ago(1h)' to avoid timeouts. Uses Kusto CLI for fast execution.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "The KQL query to execute. Always include time filters." },
                            cluster_url: { type: "string", description: "Kusto cluster URL (e.g., 'https://your-cluster.region.kusto.windows.net')." },
                            database: { type: "string", description: "Database name to query (e.g., 'YourDatabase')." }
                        },
                        required: ["query", "cluster_url", "database"]
                    }
                },
                {
                    name: "schema_memory",
                    description: "Discover database schema. Use operation='list_tables' to see all tables, or operation='discover' with table_name to get a specific table's schema. Run this BEFORE querying to understand available data structures.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            operation: { type: "string", description: "Operation: 'list_tables' to list all tables, 'discover' to get table schema." },
                            cluster_url: { type: "string", description: "Kusto cluster URL." },
                            database: { type: "string", description: "Database name." },
                            table_name: { type: "string", description: "Table name (required for 'discover' operation)." }
                        },
                        required: ["operation", "cluster_url", "database"]
                    }
                }
            );
        }

        let mcpTools: any[] = [];
        if (this.kqlBackend === 'mcp' && this.mcpClient && this.ready) {
            try {
                const result = await this.mcpClient.request({ method: "tools/list" }, ListToolsResultSchema);
                mcpTools = result.tools || [];
            } catch (e) {
                console.error("Error listing MCP tools:", e);
            }
        }

        return [...localTools, ...mcpTools];
    }

    async callTool(name: string, args: any): Promise<any> {
        if (name === "read_file") {
            return this.readFile(args.path);
        }
        if (name === "list_dir") {
            return this.listDir(args.path);
        }
        if (name === "finish") {
            return "Investigation marked as finished.";
        }

        // Route KQL tools through Kusto CLI when available
        if (this.kqlBackend === 'kusto-cli') {
            if (name === "execute_kql_query") {
                return await this.executeKqlViaCli(args.query, args.cluster_url, args.database);
            }
            if (name === "schema_memory") {
                return await this.handleSchemaMemoryViaCli(args);
            }
        }

        // Fall back to MCP for any tool (including KQL tools when MCP is the backend)
        if (this.kqlBackend === 'mcp' && this.mcpClient && this.ready) {
            const result = await this.mcpClient.request({
                method: "tools/call",
                params: {
                    name,
                    arguments: args
                }
            }, CallToolResultSchema);

            return result;
        }

        throw new Error(`Tool ${name} not found or KQL backend not ready (backend: ${this.kqlBackend}).`);
    }

    /**
     * Handle schema_memory operations via Kusto CLI
     */
    private async handleSchemaMemoryViaCli(args: any): Promise<string> {
        const { operation, cluster_url, database, table_name } = args;

        if (operation === 'list_tables') {
            return await this.executeKqlViaCli('.show tables', cluster_url, database);
        }
        if (operation === 'discover' && table_name) {
            // Sanitize table_name to prevent KQL injection
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table_name)) {
                return JSON.stringify({ success: false, error: `Invalid table name: ${table_name}. Must be alphanumeric with underscores.` });
            }
            return await this.executeKqlViaCli(`.show table ${table_name} schema as json`, cluster_url, database);
        }
        if (operation === 'refresh_schema') {
            return await this.executeKqlViaCli('.show tables details | project TableName, TotalRowCount, TotalExtentSize', cluster_url, database);
        }
        return JSON.stringify({ success: false, error: `Unknown schema_memory operation: ${operation}. Supported: list_tables, discover, refresh_schema` });
    }

    private resolvePath(inputPath: string): string {
        const resolvedRoot = path.resolve(this.repoRoot);

        // 1. If absolute, validate within repo root
        if (path.isAbsolute(inputPath)) {
            const resolved = path.resolve(inputPath);
            if (!resolved.startsWith(resolvedRoot)) {
                throw new Error(`Access denied: path '${inputPath}' is outside the repository root`);
            }
            return resolved;
        }

        // 2. Resolve relative to repo root
        const repoPath = path.resolve(resolvedRoot, inputPath);
        if (repoPath.startsWith(resolvedRoot) && fs.existsSync(repoPath)) return repoPath;

        // 3. Check relative to CWD but only if within repo root
        const cwdPath = path.resolve(inputPath);
        if (cwdPath.startsWith(resolvedRoot) && fs.existsSync(cwdPath)) return cwdPath;

        // 4. Return repo-relative path for error messaging
        return repoPath;
    }

    private readFile(filePath: string): string {
        try {
            const resolvedPath = this.resolvePath(filePath);

            if (!fs.existsSync(resolvedPath)) return `File not found: ${filePath} (checked CWD and Repo Root)`;

            const MAX_FILE_CHARS = 50_000;
            const content = fs.readFileSync(resolvedPath, 'utf-8');
            if (content.length > MAX_FILE_CHARS) {
                return content.substring(0, MAX_FILE_CHARS) + `\n\n... [truncated — file is ${content.length.toLocaleString()} chars, limit ${MAX_FILE_CHARS.toLocaleString()}]`;
            }
            return content;
        } catch (e: any) {
            return `Error reading file: ${e.message}`;
        }
    }

    private listDir(dirPath: string): string {
        try {
            const resolvedPath = this.resolvePath(dirPath);

            // Check if path is a directory
            if (!fs.existsSync(resolvedPath)) return `Directory not found: ${dirPath} (checked CWD and Repo Root)`;
            if (!fs.lstatSync(resolvedPath).isDirectory()) return "Path is not a directory.";

            const files = fs.readdirSync(resolvedPath);
            return JSON.stringify(files);
        } catch (e: any) {
            return `Error listing directory: ${e.message}`;
        }
    }

    isConnected(): boolean {
        return this.ready && this.kqlBackend !== 'none';
    }

    async restart(logger?: (msg: string) => void) {
        const log = logger || console.log;

        // Clean up MCP if it was active
        if (this.transport) {
            try {
                this.transport.close(); 
            } catch (e) {
                console.error("Error closing transport:", e);
            }
        }
        this.mcpClient = null;
        this.transport = null;
        this.ready = false;
        this.kqlBackend = 'none';
        this.kustoCliPath = null;

        await this.initialize(this.workDir, log);
    }

    async cleanup() {
        if (this.transport) {
            try { this.transport.close(); } catch (e) { /* already closed */ }
        }
    }
}
