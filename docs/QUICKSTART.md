# AI Investigator — Quick Start Guide

## Installation Options

### Option A: Download Executable (Recommended for non-developers)

1. Download `ai-investigator-win-x64.zip` from the [latest GitHub Release](../../releases/latest)
2. Extract to any folder
3. Copy `config.sample.json` to `config.json`
4. Edit `config.json` to configure your LLM provider (see below)
5. Double-click `ai-investigator.exe`
6. Your browser opens to `http://localhost:3000`

**Requirements:** None. The exe bundles Node.js and Chromium.

### Option B: npm Global Install (For developers)

```bash
npm install -g ai-investigator
ai-investigator
```

On first launch, the onboarding wizard helps you configure the LLM provider.

### Option C: Clone Repository (For contributors)

```bash
git clone <repo-url>
cd AI-Investigator
npm run setup    # Install backend + frontend dependencies
npm run dev      # Start dev servers (backend:3000 + frontend:5173)
```

For production mode:

```bash
npm run build    # Build frontend + backend
npm start        # Serve on http://localhost:3000
```

---

## Minimal Configuration

The config file (`config.json`) needs at minimum an LLM provider:

```jsonc
{
    // GitHub Copilot (recommended if you have a Copilot license)
    "llmProvider": { "type": "copilot" }
}
```

Other provider examples:

```jsonc
// Azure OpenAI
{
    "llmProvider": {
        "type": "azure-openai",
        "endpoint": "https://<resource>.openai.azure.com",
        "apiKey": "<key>",
        "deployment": "gpt-4o"
    }
}

// OpenAI direct
{
    "llmProvider": {
        "type": "openai",
        "apiKey": "<key>"
    }
}
```

---

## Configuring Storage

The only filesystem path AI Investigator manages globally is where investigation outputs are written. Set it via **Settings → Paths** or in `config.json`:

```jsonc
{
    "investigationsPath": "C:\\Repos\\my-service\\investigations"
}
```

Everything else (repo root, system prompt, knowledge base, working directory) is declared per-agent inside each agent's markdown file. Add agents from **Settings → Pipeline**.

---

## Command-Line Options

| Flag | Description |
|------|------------|
| `--config <path>` | Use a specific config file |
| `--no-open` | Don't auto-open the browser |

---

## Auto-Updates

When running the exe, AI Investigator checks for updates on startup (once per hour). If a new version is available, a banner appears at the top of the dashboard with download links.

You can also check manually from the About page.

---

## PDF Export

PDF export requires Chromium. The packaged exe bundles Chromium automatically.

If using npm install, Chromium is downloaded on first `npm install` via Puppeteer. If it's missing, run:

```bash
npx puppeteer browsers install chrome
```

---

## MCP Servers

MCP (Model Context Protocol) servers provide data access tools to the investigation agent. These are user-provided — configure them in Settings or config.json:

```jsonc
{
    "mcpServers": [
        {
            "name": "kusto",
            "command": "node",
            "args": ["path/to/mcp-kql-server/dist/index.js"],
            "env": { "CLUSTER": "https://my-cluster.kusto.windows.net" }
        }
    ]
}
```

The exe does **not** bundle MCP servers. Ensure `node` (or `python`, etc.) is in your PATH if your MCP servers need it.

---

## Configuration Reference

All fields in `config.json` (and `config.sample.json`):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | `"gpt-4o"` | LLM model name passed to the provider |
| `maxSteps` | number | `50` | Max reasoning steps per investigation (0 = unlimited) |
| `retrospectTimeoutMinutes` | number | `10` | Timeout for retrospective analysis |
| `defaultTimeRange` | string | `"ago(1h)"` | Default KQL time range for queries |
| `maxConcurrentInvestigations` | number | `3` | Max simultaneous investigations (0 = unlimited) |
| `maxConcurrentScheduledInvestigations` | number | `2` | Max simultaneous scheduled investigations |
| `scheduledInvestigationMaxSteps` | number | `20` | Max steps for scheduled investigations |
| `autoRefreshInterval` | number | `30` | Dashboard auto-refresh interval in seconds |
| `notifications` | boolean | `true` | Enable browser notifications |
| `defaultView` | string | `"grid"` | Dashboard layout: `"grid"` or `"list"` |
| `defaultSortOrder` | string | `"newest"` | Sort order: `"newest"` or `"oldest"` |
| `defaultPageSize` | number | `12` | Investigations per page |
| `llmProvider` | object | — | LLM provider config (see examples above) |
| `llmProvider.type` | string | — | `"openai"`, `"azure-openai"`, `"anthropic"`, `"copilot"`, or `"ollama"` |
| `incidentProvider` | object | `{"type":"manual"}` | Incident provider (`"manual"` or `"sentinel"`) |
| `mcpServers` | array | `[]` | MCP server definitions (name, command, args, env, cwd) |
| `investigationsPath` | string | — | Absolute path where investigation state/reports are saved |

---

## Troubleshooting

### Port 3000 already in use

Another process is using port 3000. Either stop it or set a custom port:

```bash
# Find what's using port 3000
netstat -ano | findstr :3000

# Or use a different port
PORT=3001 npm start
```

### Node.js version errors

AI Investigator requires Node.js 18 or later. Check your version:

```bash
node --version
```

If outdated, update via [nodejs.org](https://nodejs.org) or `winget install OpenJS.NodeJS.LTS`.

### Chromium / PDF export fails

If PDF export shows an error, Chromium may be missing:

```bash
npx puppeteer browsers install chrome
```

The standalone exe bundles Chromium — this only applies to npm/source installs.

### LLM provider authentication errors

- **OpenAI**: Verify your API key starts with `sk-` and has active billing
- **Azure OpenAI**: Ensure endpoint URL, API key, and deployment name are all correct
- **Copilot**: Click "Connect" in the header and complete the device-code flow
- **Ollama**: Ensure Ollama is running locally (`ollama serve`) and the model is pulled

### MCP server won't start

- Verify the command (e.g., `node`, `npx`, `python`) is in your system PATH
- Check that arguments are correct — use Settings → MCP Servers to test
- Review the terminal/console output for error messages
