<div align="center">

# 🔍 AI Investigator

**Autonomous investigation platform powered by GitHub Copilot**

An agentic system that runs, monitors, and learns from pipeline investigations — complete with live KQL execution, real-time streaming, and a self-improving knowledge base.

![Dashboard Overview](docs/screenshots/dashboard-overview.png)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Visual Walkthrough](#visual-walkthrough)
- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Taking Screenshots](#taking-screenshots)

---

## Overview

AI Investigator is a full-stack web application that orchestrates LLM-driven investigations. An agent reasons about the problem, executes KQL queries against live Kusto clusters, and produces structured investigation reports — all visible in real-time through a modern UI.

After each investigation, a **retrospective system** analyzes what went well and what didn't, then proposes concrete file changes to the knowledge base so the next investigation is smarter.

### Key Capabilities

| Capability | Description |
|------------|-------------|
| **Agentic Investigation** | LLM-driven think → act → observe loop with autonomous KQL execution |
| **Live Streaming** | WebSocket-powered real-time display of agent thoughts, tool calls, and results |
| **Dual KQL Backend** | Kusto CLI (primary) with MCP KQL Server fallback — auto-detects and auto-installs |
| **Full Lifecycle Control** | Start, pause, resume, abort, intervene, contest — all while the agent is running |
| **Retrospective Analysis** | Post-investigation AI analysis that reads the knowledge base and proposes improvements |
| **Proposal Workflow** | Review, approve, reject, and apply file changes directly from the UI |
| **Persistent History** | All investigations saved as JSON state + Markdown reports, survives server restarts |

---

## Visual Walkthrough

<!-- ### 1. Dashboard

The main dashboard shows all investigations as color-coded cards with live status, duration timers, and retrospective badges.

![Dashboard](docs/screenshots/dashboard.png)

Screenshot: The investigation cards grid showing a mix of running (blue pulse), completed (green), and failed (red) investigations. The stats bar at the top shows Active / Completed / Failed counts. -->

---

### 1. New Investigation

Launch investigations with structured context: stamp name, issue type, time window (8 quick presets or custom range), and model selection.

![New Investigation Form](docs/screenshots/new-investigation.png)

<!-- Screenshot: The full form with Target Scope (stamp, issue type dropdown, tracking ID), Time Window section with preset buttons, and Agent Configuration with model selector. -->

---

### 2. Investigation Start

Once launched, the investigation begins with the agent initializing and preparing to execute the task.

![Investigation Start](docs/screenshots/investigation-start.png)

<!-- Screenshot: The initial state of a running investigation showing the agent starting its work. -->

---

<!-- ### 3. Live Session

Watch the agent think and act in real-time. Each step shows the agent's reasoning (rendered Markdown) and tool executions with full arguments and results.

![Live Session](docs/screenshots/live-session.png)

Screenshot: An active investigation showing several thought bubbles and tool call results (KQL queries with table output). The sidebar shows investigation metadata.

--- -->

---

### 3. Paused Investigation

Pause a running investigation at any time to review progress or prepare for intervention.

![Paused Investigation](docs/screenshots/paused-by-user.png)

<!-- Screenshot: The investigation in paused state with the pause control visible. -->

---

### 4. User Intervention

Inject custom instructions to a running investigation to guide the agent in a specific direction or provide additional context without pausing.

![User Intervention](docs/screenshots/user-intervention.png)

<!-- Screenshot: The intervention input interface where users can type instructions to redirect the agent while it's running. -->

---

### 5. Contest Report

Disagree with the final report? Click **Contest Report** at the bottom of the Report tab, provide your feedback, and the investigation resumes — the agent re-examines its findings with your corrections.

![Contest Report](docs/screenshots/Consent-report.png)

---

### 6. Investigation Resumed After Contest

After contesting, the Live Session shows your feedback as an amber user bubble and a system notification. The agent acknowledges the feedback and continues investigating.

![Investigation Resumed After Contest](docs/screenshots/investigation-consent-resume.png)

---

<!-- ### 7. Token Management

When the context window fills up, a banner appears with a one-click Summarize button that compacts history while preserving recent context.

![Token Alert](docs/screenshots/token-alert.png)

Screenshot: The yellow/amber token alert banner at the top of the live session with the "Summarize" button.

--- -->

---

### 7. Final Report

Auto-generated Markdown report with findings, KQL queries used, and conclusions — styled with prose typography.

![Final Report](docs/screenshots/final-report.png)

<!-- Screenshot: The Report tab showing a rendered Markdown report with headers, bullet points, and KQL code blocks. -->

---

### 8. Retrospective — Auto-Analysis

When you open the Retrospect tab, an AI agent automatically reads the investigation transcript and knowledge base files, then proposes improvements.

![Retrospective Analysis](docs/screenshots/retrospective-analysis.png)

<!-- Screenshot: The split-panel Retrospect view. Left side: the analysis chat showing "Analyzing & Reading Files" progress with tool activity indicator. Right side: the Proposed Changes panel (can be empty during analysis). -->

---

### 9. Retrospective — Knowledge Base Analysis

The retrospective agent reads the investigation transcript and existing knowledge base files, then identifies gaps and proposes new documentation.

![Retrospective Analyzing Investigation](docs/screenshots/retrospective-analyze-investigation.png)

<!-- Screenshot: The retrospective agent analyzing the investigation and proposing to create a new knowledge base file (e.g., "Teleduct General Error Discovery Guide"). Shows the chat conversation with the agent's reasoning. -->

---

### 10. Retrospective — Proposed Changes

The agent proposes concrete file changes (edit existing or create new). Review each proposal, approve or reject, then apply all approved changes to disk.

![Proposed Changes Panel](docs/screenshots/proposals-panel.png)

<!-- Screenshot: The right panel with 3-5 proposals expanded. Show the approve/reject buttons, the "Apply 3" button in the header, and at least one expanded proposal showing the change description. If possible, show a mix of approved (green check) and pending proposals. -->

---

<!-- ### 9. Retrospective — Conversational Follow-up

After auto-analysis, continue chatting with the retrospective agent to explore additional improvements.

![Retrospective Chat](docs/screenshots/retrospective-chat.png)

Screenshot: The chat panel with the auto-analysis message, followed by a user question and an agent response.

--- -->

---

### 11. Settings

Configure agent behavior, model selection, investigation storage path (with server-side file browser), and system defaults.

![Settings](docs/screenshots/settings.png)

<!-- Screenshot: The Settings page showing the Agent Behavior tab with the model selector, max steps slider, and file browser for the investigations path. -->

---

<!-- ### 11. GitHub Copilot Authentication

Secure OAuth device flow — enter the code on GitHub, and you're connected.

![Auth Flow](docs/screenshots/auth-flow.png)

Screenshot: The login modal showing the device code and "Open Login Page" button. Also show the green "Connected" indicator in the header after login.

--- -->

---

## Features

### 🔄 Investigation Lifecycle

- **Create** — Define stamp, time range (8 presets or custom datetime), issue type, tracking ID, model selection, and free-text query
- **Run** — Autonomous think → act → observe loop with KQL execution against live Kusto clusters
- **Pause / Resume** — Freeze the agent, inspect state, optionally switch models, then continue
- **Intervene** — Inject messages into the running agent's context to redirect its approach
- **Contest Report** — Disagree with the final report? Provide feedback and the investigation resumes, the agent re-examines its findings and produces an improved report
- **Abort** — Stop immediately with state preserved
- **Max Steps** — Configurable safety limit (auto-pauses at threshold, resume for another batch)
- **Model Switching** — Change the LLM model mid-investigation (even while paused)

### 🔍 KQL Execution (Dual Backend)

| Backend | Role | Details |
|---------|------|---------|
| **Kusto CLI** | Primary | Auto-detects `Kusto.Cli.exe` in PATH, `C:\Kusto`, or NuGet cache. Auto-installs from NuGet if missing. Parses TSV output to structured JSON. |
| **MCP KQL Server** | Fallback | Python-based Model Context Protocol server. Auto-installs via pip. 3-minute startup timeout for Azure auth. |

Both backends support: `execute_kql_query`, `list_tables`, `discover` (table schema), `refresh_schema`.

### 📊 Real-Time Streaming

- WebSocket-powered live updates for every agent step
- Thought bubbles with Markdown rendering (headers, code blocks, tables)
- Tool call display with arguments and formatted results
- Status transitions broadcast instantly

### 🧠 Context Management

- **Auto-Compaction** — Summarizes older conversation history when approaching token limits (~100K tokens)
- **Manual Summarize** — One-click history compaction from the token alert banner
- **Smart Truncation** — API responses truncate large thoughts/actions; lazy-load full content on demand
- **Lightweight Polling** — Dashboard polls only metadata, not full investigation content

### 🔬 Retrospective System

The retrospective is a second-pass AI agent that learns from each investigation:

1. **Auto-Analysis** — Triggers when you open the Retrospect tab. Reads investigation guides from the knowledge base, cross-references with the transcript
2. **Tool Loop** — Up to 30 iterations of file reading, analysis, and proposal generation with smart retry logic
3. **Propose Changes** — Creates typed proposals (edit/create) with file paths, descriptions, and full content
4. **Review Workflow** — Approve ✅ / Reject ❌ each proposal individually
5. **Apply to Disk** — Writes all approved proposals to the filesystem in one click
6. **Conversational Follow-up** — Chat with the agent for additional improvements after auto-analysis
7. **Re-run** — Reset and re-trigger analysis from scratch
8. **Complete / Reopen** — Mark retrospective as done; status shown on dashboard cards

### 💾 Persistence & History

- State saved as JSON after every step: `{date}_{stamp}_{id}/state.json`
- Auto-generated Markdown reports alongside state files
- Configurable storage directory (via Settings or `config.json`)
- Server restart recovery — running investigations auto-pause, all state preserved
- Legacy format support — loads old flat JSON and standalone Markdown reports

### ⚙️ Settings

Three-tab Settings page:
- **Agent Behavior** — Max steps, default model, system prompt path, working directory, investigation storage path
- **Appearance** — Auto-refresh interval
- **System** — Default KQL time range

Includes a server-side **file browser** for selecting directories.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌─────────┐ │
│  │Dashboard  │  │Investigation │  │ Settings  │  │  Auth   │ │
│  │  Cards    │  │   Detail     │  │   Page    │  │  Modal  │ │
│  └────┬─────┘  └──────┬───────┘  └────┬─────┘  └────┬────┘ │
│       │               │               │              │       │
│       └───────────────┴───────────────┴──────────────┘       │
│                           │ REST + WebSocket                 │
└───────────────────────────┼──────────────────────────────────┘
                            │
┌───────────────────────────┼──────────────────────────────────┐
│                      Backend (Express)                        │
│  ┌─────────────┐  ┌──────┴──────┐  ┌───────────────────────┐│
│  │  REST API   │  │  WebSocket  │  │   Auth (OAuth Flow)   ││
│  │  Endpoints  │  │  Broadcast  │  │   Copilot Token Mgmt  ││
│  └──────┬──────┘  └─────────────┘  └───────────────────────┘│
│         │                                                    │
│  ┌──────┴──────────────────────────────────────────────────┐│
│  │                    Runner (Agent Core)                    ││
│  │  ┌──────────┐  ┌─────────────┐  ┌────────────────────┐  ││
│  │  │Think/Act │  │Retrospective│  │  State Persistence  │  ││
│  │  │  Loop    │  │   System    │  │  JSON + Markdown    │  ││
│  │  └────┬─────┘  └──────┬──────┘  └────────────────────┘  ││
│  │       │               │                                   ││
│  │  ┌────┴───────────────┴──────┐                           ││
│  │  │     Tool Execution        │                           ││
│  │  │  ┌──────────┐ ┌────────┐  │                           ││
│  │  │  │Kusto CLI │ │MCP KQL │  │                           ││
│  │  │  │(primary) │ │(backup)│  │                           ││
│  │  │  └────┬─────┘ └───┬────┘  │                           ││
│  │  └───────┼────────────┼──────┘                           ││
│  └──────────┼────────────┼──────────────────────────────────┘│
└─────────────┼────────────┼───────────────────────────────────┘
              │            │
     ┌────────┴────┐  ┌───┴────────┐
     │  Kusto CLI  │  │   MCP KQL  │
     │  (dotnet)   │  │  (Python)  │
     └──────┬──────┘  └──────┬─────┘
            │                │
            └────────┬───────┘
                     │
            ┌────────┴────────┐
            │  Azure Kusto    │
            │  Clusters       │
            └─────────────────┘
```

### Data Flow

1. **User** creates an investigation via the UI
2. **Backend** instantiates a `Runner` with the investigation context
3. **Runner** enters a think → act → observe loop, calling the LLM via GitHub Copilot API
4. **LLM** returns tool calls (KQL queries, schema discovery, finish)
5. **Tools** execute against Kusto clusters via Kusto CLI or MCP server
6. **Results** flow back to the LLM for the next reasoning step
7. **WebSocket** broadcasts each step to the frontend in real-time
8. **Runner** saves state to disk after every step
9. On completion, the **Retrospective** agent can analyze and propose knowledge base improvements

---

## Getting Started

### Prerequisites

| Requirement | Purpose |
|------------|---------|
| **Node.js 18+** | Backend + Frontend |
| **GitHub Copilot subscription** | LLM access via Copilot API |
| **Azure CLI** (`az login`) | Kusto cluster authentication |
| **.NET 8+ SDK** *(optional)* | For Kusto CLI auto-install from NuGet |
| **Python 3.10+** *(optional)* | For MCP KQL Server fallback |

### Quick Start

```powershell
# From the repository root
.\tools\InvestigationDashboard\Setup-Dashboard.ps1   # Install dependencies + Kusto CLI
.\tools\InvestigationDashboard\Run-Dashboard.ps1      # Launch backend + frontend
```

The dashboard opens at **http://localhost:5173**. Sign in with your GitHub account when prompted.

### Manual Setup

```bash
# Backend
cd tools/InvestigationDashboard/backend
npm install
npm run dev          # Starts on http://localhost:3000

# Frontend (separate terminal)
cd tools/InvestigationDashboard/frontend
npm install
npm run dev          # Starts on http://localhost:5173
```

### Stopping

```powershell
.\tools\InvestigationDashboard\Stop-Dashboard.ps1
```

---

## Configuration

Configuration is managed through the Settings UI or directly in `backend/config.json` (copy from `config.sample.json` to get started):

| Setting | Default | Description |
|---------|---------|-------------|
| `repoRoot` | Auto-detected | Absolute path to your repository root. All relative paths resolve from here |
| `model` | `gpt-4-turbo` | Default LLM model for new investigations |
| `maxSteps` | `50` | Max reasoning steps before auto-pause (0 = unlimited) |
| `systemPromptPath` | *(empty)* | Path to the agent's system prompt `.md` file |
| `retrospectPromptPath` | *(empty)* | Path to the retrospective prompt template. Supports `{{GOAL}}`, `{{STATUS}}`, `{{STAMP}}`, `{{ISSUE_TYPE}}` placeholders |
| `knowledgeBasePath` | *(empty)* | Repo-relative path to the knowledge base directory (e.g., `docs/investigations`). Used by retrospective for doc discovery |
| `investigationsPath` | `<repoRoot>/investigations` | Where investigation artifacts (JSON + Markdown) are saved |
| `defaultTimeRange` | `ago(1h)` | Default KQL time range preset |
| `maxConcurrentInvestigations` | `3` | Maximum parallel investigations |
| `autoRefreshInterval` | `30` | Dashboard refresh interval (seconds) |
| `workingDirectory` | Backend CWD | Working directory for file operations |

---

## API Reference

### Investigations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/investigations` | Start new investigation |
| `GET` | `/api/investigations` | List all investigations |
| `GET` | `/api/investigations/:id` | Get investigation state |
| `GET` | `/api/investigations/:id/steps/:index` | Lazy-load full step details |
| `POST` | `/api/investigations/:id/action` | Pause / Resume / Abort / Intervene |
| `POST` | `/api/investigations/:id/model` | Switch model mid-investigation |
| `POST` | `/api/investigations/:id/compact` | Summarize history to reduce tokens |

### Retrospective

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/investigations/:id/retrospect` | Send chat message |
| `POST` | `/api/investigations/:id/retrospect/analyze` | Trigger auto-analysis |
| `POST` | `/api/investigations/:id/retrospect/abort` | Cancel running analysis |
| `PATCH` | `/api/investigations/:id/retrospect/proposals/:pid` | Approve / Reject proposal |
| `POST` | `/api/investigations/:id/retrospect/apply` | Apply all approved proposals |
| `POST` | `/api/investigations/:id/retrospect/complete` | Mark complete / Reopen |

### Auth & System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/auth/status` | Check authentication status |
| `POST` | `/api/auth/login` | Start GitHub OAuth device flow |
| `GET` | `/api/models` | List available LLM models |
| `GET/POST` | `/api/settings` | Get / Save configuration |
| `GET` | `/api/files/list` | Browse server filesystem |

### WebSocket

Connect to `ws://localhost:3000/ws?id=<investigationId>` for real-time events:

| Event Type | Description |
|------------|-------------|
| `thought` | Agent reasoning step |
| `action` | Tool call with arguments and results |
| `status` | Investigation state change |
| `log` | Internal log message |
| `retrospect` | Retrospective state update |
| `retrospect-proposal` | New proposal created |
| `retrospect-tool-activity` | Retrospective agent reading/analyzing files |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19 · TypeScript · Vite 7 · Tailwind CSS · React Router · lucide-react |
| **Backend** | Node.js · Express · TypeScript · WebSocket (ws) · OpenAI SDK |
| **LLM** | GitHub Copilot API (OAuth device flow) — GPT-4o, Claude Opus 4.6, etc. |
| **KQL** | Kusto CLI (primary) · MCP KQL Server (fallback) |
| **Auth** | GitHub OAuth Device Flow · Azure CLI for Kusto |
| **Persistence** | JSON state files · Markdown reports |

---

## Project Structure

```
tools/InvestigationDashboard/
├── README.md                     # This file
├── Run-Dashboard.ps1             # Launch both services
├── Setup-Dashboard.ps1           # Install dependencies + Kusto CLI
├── Stop-Dashboard.ps1            # Kill dashboard processes
├── backend/
│   ├── config.json               # Runtime configuration (git-ignored, user-specific)
│   ├── config.sample.json        # Template config for new setups
│   ├── .gitignore                # Ignores config.json + build artifacts
│   ├── src/
│   │   ├── server.ts             # Express + WebSocket server
│   │   └── agent/
│   │       ├── Runner.ts         # Core agent loop + retrospective
│   │       ├── CopilotClient.ts  # GitHub OAuth + token management
│   │       └── Tools.ts          # KQL execution (Kusto CLI + MCP)
│   └── trigger_inv.js            # Dev utility: test investigation trigger
├── frontend/
│   ├── public/
│   │   └── favicon.svg           # Custom AI Investigator icon
│   └── src/
│       ├── App.tsx               # Router configuration
│       ├── api.ts                # API client (all endpoints)
│       ├── components/
│       │   ├── Layout.tsx        # App shell, nav, auth, branding
│       │   └── FileBrowserModal.tsx
│       └── pages/
│           ├── Dashboard.tsx         # Investigation cards grid
│           ├── NewInvestigation.tsx   # Investigation launch form
│           ├── InvestigationDetail.tsx  # Live session + Report + Retrospect
│           └── Settings.tsx          # Configuration management
└── docs/
    └── screenshots/              # UI screenshots (see Visual Walkthrough)
```

---
