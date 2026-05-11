# AI-Investigator CLI

Run a single investigation in-process from the command line. No HTTP server, no browser, no WebSocket. Useful for CI pipelines, cron jobs, scripting, and offline runs.

CLI runs share the same on-disk format as dashboard runs, so they appear in the dashboard the next time you open it.

## Quick start

From the repo root:

```powershell
.\Setup-Dashboard.ps1          # builds backend and registers the CLI on PATH (one-time)
ai-investigator --help
ai-investigator --target ServiceX --time-range "ago(1h)" --query "investigate latency spike"
```

If `ai-investigator` is not on PATH (e.g. you didn't run setup, or `npm link` was skipped), use the npm script instead:

```powershell
cd backend
npm run build                  # if not already built
npm run investigate -- --target ServiceX --time-range "ago(1h)"
```

## Options

| Option | Description |
|---|---|
| `--target <name>` | Investigation target (required unless `--incident-id`) |
| `--time-range <range>` | e.g. `"ago(1h)"` (required unless `--incident-id`) |
| `--query <text>` | User question / context |
| `--incident-id <id>` | Incident ID alternative to `--target` / `--time-range` |
| `--correlation-id <id>` | Optional correlation id |
| `--category <name>` | Optional category |
| `--model <name>` | Override LLM model |
| `--title <text>` | Optional title |
| `--max-steps <n>` | Override max agent steps |
| `--pipeline <ref>` | Builtin preset id (e.g. `default`, `deep-investigation`), path to a pipeline JSON file, or - when `--config` is used - a saved workflow id from `<investigationsPath>/workflows.json` |
| `--config <path>` | Load a product config (e.g. AM-Teleduct's `investigator-config.json`). Resolves MCP servers, `investigationsPath`, and `defaultPipelineId` from that file. Without `--config`, the AI-Investigator backend's own `config.json` is used. |
| `--json` | Emit one JSON event per line (machine-readable) |
| `--no-stream` | Suppress per-step streaming output (final summary only) |
| `-h`, `--help` | Show help |

**Exit codes:** `0` completed, `1` failed/aborted/paused, `2` bad args / fatal startup error.

## Examples

```powershell
# Single-agent investigation
ai-investigator --target ServiceX --time-range "ago(1h)" --query "investigate spike"

# Multi-agent pipeline (builtin preset)
ai-investigator --pipeline deep-investigation --target ServiceX --time-range "ago(30m)"

# Custom pipeline from a JSON file
ai-investigator --pipeline ./my-pipeline.json --target ServiceX --time-range "ago(1h)"

# Incident-driven, JSON output for piping
ai-investigator --incident-id 12345 --json | ConvertFrom-Json

# Quiet mode (final summary only)
ai-investigator --target ServiceX --time-range "ago(1h)" --no-stream

# AM-Teleduct: load product config (MCP servers + Teleduct pipeline + investigationsPath)
ai-investigator --config C:\Repositories\AM-Teleduct\investigator-config.json `
                --target ServiceX --time-range "ago(1h)"

# AM-Teleduct: same, but force a specific saved workflow from workflows.json
ai-investigator --config C:\Repositories\AM-Teleduct\investigator-config.json `
                --pipeline teleduct-deep-attainment-investigation `
                --target ServiceX --time-range "ago(1h)"
```

## How it works

The CLI imports `src/server.ts` as a library and calls `createInvestigation()` directly. Setting `AI_INVESTIGATOR_CLI=1` (done automatically) tells `shouldAutoStartServer()` to skip binding the HTTP/WS port and starting the scheduler.

Config, LLM provider, and on-disk storage all use the same code paths as the dashboard. Results are written to `investigationsPath/<date>_<target>_<id>/state.json` + `report.md`.

## Notes

- Press `Ctrl+C` once to abort gracefully (state persists); twice to force-exit.
- One investigation per invocation. Run multiple processes for concurrency.
- `--pipeline` accepts a builtin preset id, a path to a pipeline JSON file, or - when `--config` is supplied - a saved workflow id from that config's `<investigationsPath>/workflows.json`.
- `--config` makes the CLI load any product config (e.g. AM-Teleduct's `investigator-config.json`), so MCP servers, `investigationsPath`, and `defaultPipelineId` all come from that file. Without `--config`, only the AI-Investigator backend's own `config.json` is used and product-specific MCP servers are unavailable.
- Pause/resume, contest, and retrospect-apply are not yet exposed as subcommands. Use the dashboard for those, or open an issue if you need them in the CLI.

## See also

- Main project [README.md](../../../README.md) → "Command-Line Interface (CLI)" section
- [investigate.ts](./investigate.ts) — CLI source
