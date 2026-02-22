"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolManager = void 0;
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/client/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class ToolManager {
    constructor() {
        this.mcpClient = null;
        this.transport = null;
        this.ready = false;
        this.initError = null;
        this.kqlBackend = 'none';
        this.kustoCliPath = null;
    }
    getKqlBackend() { return this.kqlBackend; }
    async checkAzureAuth(log) {
        log("Checking Azure authentication status...");
        return new Promise((resolve) => {
            const options = this.workDir ? { cwd: this.workDir, shell: true } : { shell: true };
            const check = (0, child_process_1.spawn)('az', ['account', 'show'], options);
            check.on('close', (code) => {
                if (code === 0) {
                    log("Azure authentication verified.");
                    resolve(true);
                }
                else {
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
    async initialize(cwd, logger) {
        this.workDir = cwd;
        const log = logger || console.log;
        if (this.workDir)
            log(`Initializing ToolManager in ${this.workDir}`);
        // 1. Check Azure Auth
        const isAuth = await this.checkAzureAuth(log);
        if (!isAuth) {
            this.initError = "Azure Authentication Required. Please log in.";
            log("Initialization aborted due to missing Azure Auth.");
            return;
        }
        // 2. Try Kusto CLI first (fast, no server process needed)
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
        // 3. Fall back to MCP Server
        await this.initializeMcp(log);
    }
    /**
     * Detect Kusto.Cli.exe on the system. Checks:
     * 1. System PATH
     * 2. C:\Kusto\Kusto.Cli.exe (documented install location)
     * 3. NuGet packages cache
     */
    async detectKustoCli(log) {
        log("Checking for Kusto CLI...");
        // Check PATH first
        try {
            const result = (0, child_process_1.execSync)('where Kusto.Cli.exe 2>nul', { encoding: 'utf-8', timeout: 5000 }).trim();
            if (result) {
                const firstPath = result.split('\n')[0].trim();
                if (fs_1.default.existsSync(firstPath))
                    return firstPath;
            }
        }
        catch { /* not in PATH */ }
        // Check well-known locations
        const candidates = [
            'C:\\Kusto\\Kusto.Cli.exe',
            path_1.default.join(process.env.USERPROFILE || '', '.nuget', 'packages', 'microsoft.azure.kusto.tools'),
        ];
        for (const candidate of candidates) {
            if (candidate.endsWith('.exe') && fs_1.default.existsSync(candidate))
                return candidate;
            // For the NuGet package dir, search for the exe inside
            if (fs_1.default.existsSync(candidate) && fs_1.default.statSync(candidate).isDirectory()) {
                try {
                    const found = this.findFileRecursive(candidate, 'Kusto.Cli.exe', 4);
                    if (found)
                        return found;
                }
                catch { /* ignore */ }
            }
        }
        log("Kusto CLI not found in PATH or known locations.");
        return null;
    }
    findFileRecursive(dir, filename, maxDepth) {
        if (maxDepth <= 0)
            return null;
        try {
            const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path_1.default.join(dir, entry.name);
                if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase())
                    return fullPath;
                if (entry.isDirectory()) {
                    const found = this.findFileRecursive(fullPath, filename, maxDepth - 1);
                    if (found)
                        return found;
                }
            }
        }
        catch { /* permission error, etc. */ }
        return null;
    }
    /**
     * Execute a KQL query using Kusto.Cli.exe
     */
    async executeKqlViaCli(query, clusterUrl, database) {
        if (!this.kustoCliPath)
            throw new Error("Kusto CLI not available");
        const connectionString = `Data Source=${clusterUrl};Initial Catalog=${database}`;
        // Use single quotes for the -execute argument to avoid PowerShell $variable expansion
        // This handles $left/$right in JOIN queries
        return new Promise((resolve, reject) => {
            const args = [connectionString, `-execute:${query}`];
            const options = {
                cwd: this.workDir,
                shell: false, // Don't use shell to avoid escaping issues
                timeout: 120000 // 2 minute timeout
            };
            const proc = (0, child_process_1.spawn)(this.kustoCliPath, args, options);
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (data) => { stdout += data.toString(); });
            proc.stderr?.on('data', (data) => { stderr += data.toString(); });
            proc.on('close', (code) => {
                if (code !== 0 && !stdout) {
                    reject(new Error(`Kusto CLI failed (exit ${code}): ${stderr || 'Unknown error'}`));
                }
                else {
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
    parseKustoCliOutput(raw, query) {
        // Kusto CLI outputs tab-separated data with a header line
        // Lines starting with // are comments/status messages
        const lines = raw.split('\n');
        const dataLines = [];
        const statusLines = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            if (trimmed.startsWith('//') || trimmed.startsWith('@')) {
                statusLines.push(trimmed);
            }
            else {
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
        const rows = [];
        for (let i = 1; i < dataLines.length; i++) {
            const values = dataLines[i].split('\t');
            const row = {};
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
    async initializeMcp(log) {
        // Start the Python KQL MCP Server
        // Assuming python is in path and mcp_kql_server is installed
        log("Initializing KQL MCP Server...");
        this.initError = null;
        const spawnOptions = this.workDir ? { cwd: this.workDir, shell: true } : { shell: true };
        try {
            log("Checking if mcp_kql_server is installed...");
            // Use pip show to check installation without running the code
            const check = (0, child_process_1.spawn)('pip', ['show', 'mcp_kql_server'], spawnOptions);
            await new Promise((resolve, reject) => {
                check.on('close', (code) => {
                    if (code === 0)
                        resolve(true);
                    else
                        reject(new Error(`Package not found (code ${code})`));
                });
                check.on('error', reject);
            }).catch(async (err) => {
                log(`mcp_kql_server not found. Attempting install...`);
                const install = (0, child_process_1.spawn)('pip', ['install', 'mcp_kql_server'], spawnOptions);
                install.stdout.on('data', (data) => log(`[pip] ${data.toString().trim()}`));
                install.stderr.on('data', (data) => log(`[pip error] ${data.toString().trim()}`));
                await new Promise((resolve, reject) => {
                    install.on('close', (code) => {
                        if (code === 0) {
                            log("Installation successful.");
                            resolve(true);
                        }
                        else
                            reject(new Error(`Failed to install mcp_kql_server (exit code ${code})`));
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
            this.transport = new stdio_js_1.StdioClientTransport({
                command: "python",
                args: ["-m", "mcp_kql_server"],
                cwd: this.workDir
            }); // cast to any to avoid TS errors if definition is strict/missing
            this.mcpClient = new index_js_1.Client({
                name: "TeleductInvestigationBackend",
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
                    const listTools = this.mcpClient.request({ method: "tools/list" }, types_js_1.ListToolsResultSchema, { timeout: 120000 });
                    await Promise.race([listTools, timeout]);
                    log("MCP Server is ready and responding.");
                    this.ready = true;
                    this.kqlBackend = 'mcp';
                    break;
                }
                catch (e) {
                    if (i === maxRetries)
                        throw new Error(`MCP Server unresponsive after ${maxRetries} attempts: ${e.message}`);
                    log(`Waiting for MCP server to be ready... (Attempt ${i}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        }
        catch (error) {
            this.initError = error.message || String(error);
            log(`Failed to connect/install MCP server: ${this.initError}`);
            log("Continuing without MCP server (some tools may be unavailable).");
            this.mcpClient = null;
            this.transport = null;
        }
    }
    async listTools() {
        const localTools = [
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
                description: "Complete the investigation with a summary.",
                inputSchema: {
                    type: "object",
                    properties: {
                        summary: { type: "string", description: "Final summary of the investigation." }
                    },
                    required: ["summary"]
                }
            }
        ];
        // If Kusto CLI is available, add KQL tools as local tools
        if (this.kqlBackend === 'kusto-cli') {
            localTools.push({
                name: "execute_kql_query",
                description: "Execute a KQL query against Azure Data Explorer (Kusto) cluster. ALWAYS use time filters like 'where ingestion_time() > ago(1h)' to avoid timeouts. Uses Kusto CLI for fast execution.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "The KQL query to execute. Always include time filters." },
                        cluster_url: { type: "string", description: "Kusto cluster URL (e.g., 'https://oiildc02.eastus.kusto.windows.net')." },
                        database: { type: "string", description: "Database name to query (e.g., 'AMBackend_PROD')." }
                    },
                    required: ["query", "cluster_url", "database"]
                }
            }, {
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
            });
        }
        let mcpTools = [];
        if (this.kqlBackend === 'mcp' && this.mcpClient && this.ready) {
            try {
                const result = await this.mcpClient.request({ method: "tools/list" }, types_js_1.ListToolsResultSchema);
                mcpTools = result.tools || [];
            }
            catch (e) {
                console.error("Error listing MCP tools:", e);
            }
        }
        return [...localTools, ...mcpTools];
    }
    async callTool(name, args) {
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
            }, types_js_1.CallToolResultSchema);
            return result;
        }
        throw new Error(`Tool ${name} not found or KQL backend not ready (backend: ${this.kqlBackend}).`);
    }
    /**
     * Handle schema_memory operations via Kusto CLI
     */
    async handleSchemaMemoryViaCli(args) {
        const { operation, cluster_url, database, table_name } = args;
        if (operation === 'list_tables') {
            return await this.executeKqlViaCli('.show tables', cluster_url, database);
        }
        if (operation === 'discover' && table_name) {
            return await this.executeKqlViaCli(`.show table ${table_name} schema as json`, cluster_url, database);
        }
        if (operation === 'refresh_schema') {
            return await this.executeKqlViaCli('.show tables details | project TableName, TotalRowCount, TotalExtentSize', cluster_url, database);
        }
        return JSON.stringify({ success: false, error: `Unknown schema_memory operation: ${operation}. Supported: list_tables, discover, refresh_schema` });
    }
    resolvePath(inputPath) {
        // 1. If absolute, use as is
        if (path_1.default.isAbsolute(inputPath))
            return inputPath;
        // 2. Check relative to CWD (backend folder)
        if (fs_1.default.existsSync(inputPath))
            return inputPath;
        // 3. Check relative to Repo Root (Dynamic or Fallback)
        const repoRoot = process.env.REPO_ROOT || path_1.default.resolve(process.cwd(), '../../..');
        const repoPath = path_1.default.join(repoRoot, inputPath);
        if (fs_1.default.existsSync(repoPath))
            return repoPath;
        // 4. Return original to let error message show what was requested
        return inputPath;
    }
    readFile(filePath) {
        try {
            const resolvedPath = this.resolvePath(filePath);
            // Security check: ensure path is within repo? 
            // For now, allow reading repo files.
            if (!fs_1.default.existsSync(resolvedPath))
                return `File not found: ${filePath} (checked CWD and Repo Root)`;
            return fs_1.default.readFileSync(resolvedPath, 'utf-8');
        }
        catch (e) {
            return `Error reading file: ${e.message}`;
        }
    }
    listDir(dirPath) {
        try {
            const resolvedPath = this.resolvePath(dirPath);
            // Check if path is a directory
            if (!fs_1.default.existsSync(resolvedPath))
                return `Directory not found: ${dirPath} (checked CWD and Repo Root)`;
            if (!fs_1.default.lstatSync(resolvedPath).isDirectory())
                return "Path is not a directory.";
            const files = fs_1.default.readdirSync(resolvedPath);
            return JSON.stringify(files);
        }
        catch (e) {
            return `Error listing directory: ${e.message}`;
        }
    }
    isConnected() {
        return this.ready && this.kqlBackend !== 'none';
    }
    async restart(logger) {
        const log = logger || console.log;
        // Clean up MCP if it was active
        if (this.transport) {
            try {
                // this.transport.close(); 
            }
            catch (e) {
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
            // this.transport.close();
        }
    }
}
exports.ToolManager = ToolManager;
