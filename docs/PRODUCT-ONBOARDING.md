# Product Onboarding Guide

This guide explains how to configure a product repository so AI Investigator can investigate it effectively.

## What is a "Product"?

A product is a codebase or service that AI Investigator can run investigations against. Each product has:

- **Knowledge base** — investigation guides, runbooks, architecture docs
- **System prompt** — instructions that tell the AI agent how to investigate this product
- **Investigation storage** — where completed investigation reports are saved

## Quick Setup: `.investigator.json` Manifest

Drop a `.investigator.json` file at your repository root for one-click onboarding:

```jsonc
{
    "name": "My Service",
    "systemPrompt": "docs/agent-prompt.md",
    "knowledgeBase": "docs/investigations",
    "investigations": "investigations",
    "mcpServers": [
        {
            "name": "kusto",
            "command": "node",
            "args": ["tools/mcp-kql-server/dist/index.js"]
        }
    ]
}
```

All paths are relative to the repo root. When someone adds this repo as a product in AI Investigator, the manifest auto-configures everything.

## Manual Setup (No Manifest)

If no manifest is found, AI Investigator auto-discovers common patterns:

| It looks for | Common locations |
|---|---|
| Agent prompt | `docs/agent-prompt.md`, `.github/agents/*.md`, `prompts/*.md` |
| Knowledge base | `docs/investigations/`, `docs/runbooks/`, `docs/telemetry-investigations/` |
| Investigation storage | `investigations/` |

You can also specify everything manually in AI Investigator's config.json.

## Writing an Agent Prompt

The system prompt tells the AI agent how to investigate issues for your product. Good prompts include:

1. **Product overview** — What the service does, key components
2. **Data sources** — Which MCP tools are available, how to query them
3. **Investigation methodology** — Step-by-step process for common issue types
4. **Key terminology** — Domain-specific terms and their definitions
5. **Known patterns** — Common failure modes and their root causes

Example structure:

```markdown
# Investigation Agent — My Service

## Overview
My Service is a data processing pipeline that ingests telemetry data...

## Available Tools
- `execute_kql_query` — Run KQL queries against the Kusto cluster
- `read_file` — Read investigation guides from the knowledge base

## Investigation Process
1. Start by identifying the issue type from the user's query
2. Check relevant metrics using KQL
3. Narrow down to specific components
4. Cross-reference with known patterns in the knowledge base
5. Write a structured report

## Key Terminology
| Term | Definition |
|------|-----------|
| Stamp | A deployment unit identified by name like `svc-prd-eus2-01` |
```

## Knowledge Base Structure

Organize investigation guides by category:

```
docs/investigations/
├── README.md                          # Index / decision tree
├── latency-investigation.md           # Guide for latency issues
├── error-investigation.md             # Guide for error spikes
├── deployment-investigation.md        # Guide for deployment issues
└── common-kql-queries.md              # Reusable query templates
```

The `README.md` should serve as a routing table — the agent reads it first to decide which guide to follow.

## MCP Server Integration

MCP servers give the agent access to data sources (Kusto, APIs, databases). Each server runs as a child process with stdio transport.

### Server Configuration

```jsonc
{
    "mcpServers": [
        {
            "name": "kusto",
            "command": "node",
            "args": ["tools/mcp-kql-server/dist/index.js"],
            "env": {
                "CLUSTER": "https://my-cluster.kusto.windows.net",
                "DATABASE": "MyDatabase"
            }
        }
    ]
}
```

### Writing an MCP Server

An MCP server exposes tools that the agent can call. Minimum implementation:

1. Accept stdio transport (stdin/stdout)
2. Implement the MCP protocol `tools/list` and `tools/call` methods
3. Return structured results the agent can reason about

See the [MCP specification](https://modelcontextprotocol.io/) for protocol details.

## Self-Improving Knowledge Base

After each investigation, the Retrospective agent analyzes the transcript and proposes improvements to your knowledge base:

- New guides for previously undocumented scenarios
- Updated KQL queries based on what worked
- Corrected procedures based on investigation outcomes

Review and approve proposals from the investigation detail page.
