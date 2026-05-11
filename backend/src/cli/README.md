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
| `--pipeline <ref>` | Builtin preset id (e.g. `default`, `deep`) or path to a pipeline JSON file |
| `--json` | Emit one JSON event per line (machine-readable) |
| `--no-stream` | Suppress per-step streaming output |
| `-h`, `--help` | Show help |

**Exit codes:** `0` completed, `1` failed/aborted/paused, `2` bad args / fatal startup error.

## Examples

```powershell
# Single-agent investigation
ai-investigator --target ServiceX --time-range "ago(1h)" --query "investigate spike"

# Multi-agent pipeline (builtin preset)
ai-investigator --pipeline deep --target ServiceX --time-range "ago(30m)"

# Custom pipeline from a JSON file
ai-investigator --pipeline ./my-pipeline.json --target ServiceX --time-range "ago(1h)"

# Incident-driven, JSON output for piping
ai-investigator --incident-id 12345 --json | ConvertFrom-Json

# Quiet mode (final summary only)
ai-investigator --target ServiceX --time-range "ago(1h)" --no-stream
```

## How it works

The CLI imports `src/server.ts` as a library and calls `createInvestigation()` directly. Setting `AI_INVESTIGATOR_CLI=1` (done automatically) tells `shouldAutoStartServer()` to skip binding the HTTP/WS port and starting the scheduler.

Config, LLM provider, and on-disk storage all use the same code paths as the dashboard. Results are written to `investigationsPath/<date>_<target>_<id>/state.json` + `report.md`.

## Notes

- Press `Ctrl+C` once to abort gracefully (state persists); twice to force-exit.
- One investigation per invocation. Run multiple processes for concurrency.
- `--pipeline` accepts either a builtin preset id or a path to a pipeline JSON file. Saved-workflow lookup (from `workflows.json`) is not yet wired up in CLI mode.
- Pause/resume, contest, and retrospect-apply are not yet exposed as subcommands. Use the dashboard for those, or open an issue if you need them in the CLI.

## See also

- Main project [README.md](../../../README.md) → "Command-Line Interface (CLI)" section
- [investigate.ts](./investigate.ts) — CLI source
