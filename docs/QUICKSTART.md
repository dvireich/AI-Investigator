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

## Adding a Product

A "product" is a repository you want to investigate. You can add products from:

- **Settings page** → Products section → enter the repo path
- **Onboarding wizard** (first launch) → Discover step
- **config.json** → `products` array

```jsonc
{
    "products": [
        {
            "id": "my-service",
            "name": "My Service",
            "repoRoot": "C:\\Repos\\my-service",
            "systemPromptPath": "docs/agent-prompt.md",
            "knowledgeBasePath": "docs/investigations",
            "investigationsPath": "investigations"
        }
    ]
}
```

Or just point to a repo that has a `.investigator.json` manifest — AI Investigator will auto-discover the configuration.

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
