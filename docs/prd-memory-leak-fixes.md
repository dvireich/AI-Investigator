# PRD: Memory Leak Remediation

**Date:** 2026-03-28  
**Severity:** Critical  
**Component:** Backend (`backend/src/`)

---

## Problem Statement

On March 28, 2026, a `node.exe` process running the AI-Investigator backend consumed **~117 GB of virtual memory**, exhausting the system's virtual memory, causing a cascade of application crashes and rendering the host machine unresponsive for several minutes.

The process had been running continuously for **2+ days** (since March 26) via `ts-node-dev --respawn`. Root cause analysis identified **six architectural memory leak sources** in the backend that compound over time.

---

## Root Cause Analysis

### 1. `fullHistory` / `fullActions` arrays held in memory unnecessarily (CRITICAL)

**File:** `Runner.ts` — lines 65-66, 118-142  
**Mechanism:** Every investigation step appends to `fullHistory` and `fullActions`. These arrays are explicitly designed to "always retain every original entry" and are never released from memory — even though they are persisted to `state.json` on every step. Each observation entry can be up to **80 KB** (the `MAX_OBSERVATION_CHARS` limit at line 409). The arrays are only consumed on-demand (retrospect analysis, report generation, UI step-detail requests), yet they remain in the live runner's heap for the entire investigation lifetime and beyond.

**Impact:** A 50-step investigation with large tool results ≈ **4 MB**. A long-running or contested investigation with hundreds of steps ≈ **tens of MB**. Multiple such runners held in memory for days → **gigabytes**. This is the single largest contributor to the 117 GB leak.

### 2. Stuck / paused runners held indefinitely (CRITICAL)

**File:** `server.ts` — lines 281, 1637-1647  
**Mechanism:** The global `runners` Map stores active `AgentRunner` instances. Runners are deleted only on terminal states (`completed`, `failed`, `aborted`). Paused or hung investigations remain in the map forever with no TTL or eviction.

**Impact:** Each runner holds the full `InvestigationState` (thoughts, fullHistory, fullActions, logs, retrospect). Over days of operation, stuck runners accumulate without bound.

### 3. Orphaned event listeners on runners (HIGH)

**File:** `server.ts` — lines 559-568, 1643, 2089, 2518  
**Mechanism:** `attachRunnerListeners()` registers 7 event listeners per runner (thought, action, log, status, retrospect, retrospect-proposal, retrospect-tool-activity). When a runner is deleted via `runners.delete(id)`, `removeAllListeners()` is never called. The closures capture `broadcast()` and the investigation ID, preventing garbage collection.

**Impact:** ~700+ orphaned listener closures per day under typical load. Each closure retains references to the runner's full state.

### 4. Unbounded in-memory history store (HIGH)

**File:** `server.ts` — lines 159-212, 283, 388-527  
**Mechanism:** `InvestigationHistoryStore` loads **every** investigation from disk at startup into a `Map`. Hydrated states (full `state.json` reads via `hydrateStoredState`) replace lightweight summaries and are never evicted back to summary form. The companion `storagePathCache` Map also grows without limit.

**Impact:** ~50-100 KB per investigation. After thousands of investigations, this alone can reach **gigabytes**.

### 5. MCP tool connections never disconnected (MODERATE)

**File:** `McpToolBridge.ts` — lines 26, 131-135; `server.ts` — runner deletion paths  
**Mechanism:** `McpToolBridge.disconnectAll()` is defined but never called when runners are deleted. The `connections` Map and child stdio transport processes persist.

**Impact:** Leaked child processes and connection objects per investigation lifecycle.

### 6. Puppeteer process listener accumulation (MODERATE)

**File:** `pdfRenderer.ts` — lines 63-65  
**Mechanism:** Each browser re-launch in `getBrowser()` adds 3 `process.on` handlers (`exit`, `SIGINT`, `SIGTERM`) without removing previous ones. Over time this produces a Node.js `MaxListenersExceededWarning` and prevents GC of old browser references.

**Impact:** Listener count grows linearly with browser restarts. Minor memory impact but indicates resource mismanagement.

---

## Proposed Fixes

### Fix 1: Lazy-load `fullHistory` / `fullActions` from disk instead of holding in memory

**Files:** `Runner.ts` — `syncFullHistory()`, `compactHistory()`, `buildRetrospectHistory()`, `saveArtifacts()`; `server.ts` — step-detail and investigation-detail endpoints

**Rationale:** `fullHistory`/`fullActions` exist to preserve the complete, uncompacted investigation record. However, analysis shows they are only consumed in specific on-demand scenarios:

| Consumer | When triggered |
|----------|---------------|
| `buildRetrospectHistory()` | User starts retrospect analysis |
| Report generation (`saveArtifacts`) | Investigation completes |
| UI step-detail endpoint (`GET /api/investigations/:id`) | User views investigation detail |
| `getThoughtSource()` | Extracting last-thought preview (only needs the last entry) |

All of these are **point-in-time reads**, not continuous. Meanwhile, `fullHistory` is already persisted to `state.json` on every step via `saveArtifacts()`. There is no reason to keep it in RAM.

**Problem with naïve lazy-load:** `fullHistory` currently lives inside the monolithic `state.json`. A "load from disk on demand" approach would still parse the entire file (which can be 50-100 MB+) into memory, just less frequently. This does not support true sliding-window access.

**Approach: Separate append-only history log + sliding-window reads**

1. **New file: `history.jsonl`** — alongside the existing `state.json` and `summary.json` in each investigation directory. This is an append-only, newline-delimited JSON file. Each line is a JSON object representing one step:
   ```jsonl
   {"index":0,"thought":{...},"action":{...}}
   {"index":1,"thought":{...},"action":{...}}
   ...
   ```
   - On each investigation step, `saveArtifacts()` appends the new entry as a single line to `history.jsonl` instead of re-serializing the entire `fullHistory` array.
   - This is an **O(1) append** per step, vs. the current O(N) full rewrite.

2. **Remove `fullHistory`/`fullActions` from the in-memory `InvestigationState` and from `state.json`.**
   - The live runner keeps only `thoughts`/`actions` (the compactable LLM working set) in memory, as today.
   - `state.json` no longer contains `fullHistory`/`fullActions`, drastically reducing its size. It remains the source of truth for the current working state, metadata, retrospect, etc.
   - `syncFullHistory()` is replaced by an append-to-JSONL operation.

3. **Sliding-window read helpers** — a utility to read `history.jsonl` in bounded windows:
   - `readHistoryRange(filePath, startIndex, count)` → reads lines `startIndex` to `startIndex + count` by scanning lines without loading the full file into a single parsed array. Returns an array of step objects.
   - `readHistoryTail(filePath, count)` → reads the last N entries (for last-thought preview, recent context).
   - `streamHistory(filePath, callback)` → streams entries one at a time for consumers that need to process all (report generation, retrospect prompt building) without holding the full array in memory.

4. **Consumer updates:**

   | Consumer | Current behavior | New behavior |
   |----------|-----------------|--------------|
   | `buildRetrospectHistory()` | Reads entire `fullHistory` array from memory | `streamHistory()` over `history.jsonl`, building the prompt incrementally with per-entry text caps. Memory = one entry at a time. |
   | Report generation (`saveArtifacts`) | Iterates in-memory `fullHistory` | `streamHistory()` over `history.jsonl`, writing report entries as it goes. |
   | UI step-detail endpoint (`GET /api/investigations/:id`) | Returns paginated slice of in-memory `fullHistory` | `readHistoryRange()` to read only the requested page from disk. |
   | `getThoughtSource()` (last-thought preview) | Returns entire `fullHistory` | `readHistoryTail(path, 1)` to read only the last entry. Or fall back to in-memory `thoughts` which always has the most recent entries (preferred — no disk I/O). |
   | Compaction (`compactHistory`) | Archives `thoughts` into in-memory `fullHistory` before discarding | Appends pre-compaction entries to `history.jsonl`, then proceeds with compaction. No in-memory accumulation. |

5. **Migration / backward compatibility:**
   - On startup, if a `state.json` contains `fullHistory` but no `history.jsonl` exists, backfill `history.jsonl` from the array and strip `fullHistory` from `state.json`.
   - If neither exists, fall back to `thoughts` (existing behavior for legacy investigations).

**Acceptance criteria:**
- `fullHistory`/`fullActions` arrays are never held in the in-memory `InvestigationState` during active investigation execution or when loaded into the history store.
- `history.jsonl` is the sole persistent store for the full uncompacted history. It is written to with O(1) appends per step.
- Retrospect, report generation, and the step-detail API use sliding-window or streaming reads — peak memory per read is bounded to the window size, not the total history size.
- `state.json` no longer contains `fullHistory`/`fullActions`, reducing its on-disk and in-memory footprint significantly.
- Old investigations with `fullHistory` in `state.json` are migrated automatically on first access.
- Existing tests updated to validate JSONL read/write, sliding-window access, and migration.

### Fix 2: Auto-evict idle runners with TTL

**File:** `server.ts` — near the `runners` Map declaration

- Add a periodic cleanup interval (every **60 seconds**) that inspects all entries in the `runners` Map.
- Evict any runner that has been in `paused` status for longer than a configurable `RUNNER_IDLE_TTL` (default: **30 minutes**).
- Before eviction: call `runner.removeAllListeners()`, persist state via `saveArtifacts()`, and move state to `history`.
- Log evictions for observability.

**Acceptance criteria:**
- No runner stays in the `runners` Map longer than 30 minutes without activity.
- Evicted runners' state is preserved on disk and in the history store.
- Active (status `running`) runners are never evicted.

### Fix 3: Remove all listeners on runner cleanup

**File:** `server.ts` — every code path that calls `runners.delete(id)`

- Before or immediately after every `runners.delete(id)` call, call `runner.removeAllListeners()`.
- Extract a helper function `cleanupRunner(id: string)` that encapsulates: listener removal, MCP disconnection, and map deletion. Replace all direct `runners.delete(id)` calls with this helper.

**Acceptance criteria:**
- Every runner deletion path goes through the helper.
- No orphaned listeners remain after runner removal.
- Unit test confirms listener count returns to 0 after cleanup.

### Fix 4: LRU eviction for the history store

**File:** `server.ts` — `InvestigationHistoryStore` class

- Add an `MAX_IN_MEMORY` limit (default: **1000**).
- Track access order. On `get()` or `set()`, move the entry to most-recently-used.
- When size exceeds the limit, evict the least-recently-used entries by replacing them with their summary-only form (set `_summaryOnly = true`, drop full state data). The data remains on disk and can be re-hydrated on demand.
- Apply the same eviction after `loadHistory()` completes.

**Acceptance criteria:**
- In-memory record count never exceeds 1000 (or configured limit).
- Evicted investigations are still accessible (re-hydrated from disk on demand).
- Dashboard list endpoint still shows all investigations (uses summary data).

### Fix 5: Disconnect MCP connections on runner cleanup

**File:** `server.ts` — the `cleanupRunner()` helper from Fix 3; `Runner.ts` — expose toolManager cleanup

- Expose a `dispose()` or `cleanup()` method on `AgentRunner` that calls `this.toolManager.disconnectAll()`.
- Call this method in the `cleanupRunner()` helper before deleting from the map.

**Acceptance criteria:**
- MCP child processes are terminated when their parent runner is cleaned up.
- No orphaned MCP stdio transport processes after investigation completion.

### Fix 6: Fix Puppeteer process listener leak

**File:** `pdfRenderer.ts` — `getBrowser()`

- Register the `process.on('exit' | 'SIGINT' | 'SIGTERM')` cleanup handlers **once** at module level, not inside `getBrowser()`.
- Use a module-level flag to ensure handlers are registered exactly once.
- Alternatively, remove old handlers before adding new ones on each browser re-launch.

**Acceptance criteria:**
- Repeated calls to `getBrowser()` do not accumulate process listeners.
- Browser cleanup still works on process exit.

---

## Additional Issues Identified

A deep scan of the full codebase uncovered the following additional issues grouped by category.

### 7. Unbounded `retrospect.messages` array (HIGH)

**File:** `Runner.ts` — lines 1129-1137, 1254-1255, 1274, 1343, 1757  
**Mechanism:** `this.state.retrospect.messages` accumulates every tool-call, tool-result, user message, and assistant response across all retrospect operations (analysis, chat, implementation). The `runRetrospectToolLoop()` iterates up to 30 times, pushing 2+ messages per iteration. Multiple retrospect phases compound this: analysis (30 iterations) + chat + implementation (30 iterations) = 120+ messages with tool results up to 600 chars each. The array is never capped or trimmed and is persisted to disk with `state.json`.

**Impact:** 120+ messages per retrospect lifecycle, persisted to disk. Inflates both in-memory state and `state.json`/`summary.json` file sizes.

### 8. Unbounded `logs` array (HIGH)

**File:** `Runner.ts` — line 2021  
**Mechanism:** Every `log()` call pushes to `this.state.logs` unconditionally. A typical 50-step investigation generates 200+ log entries (multiple logs per step, plus compaction, retrospect, and tool initialization messages). The array is never capped, rotated, or cleaned. It is persisted to `state.json` on every save.

**Impact:** Hundreds of log entries per investigation, all held in memory and written to disk repeatedly.

### 9. Scheduler `tick()` overlap race condition (HIGH)

**File:** `Scheduler.ts` — lines 104, 138-166  
**Mechanism:** The master timer fires `tick()` via `setInterval(() => this.tick(), 60_000)`. Since `tick()` is async (performs file I/O, HTTP calls, and investigation creation), if a tick takes longer than 60 seconds the next tick fires concurrently. There is no guard preventing overlapping ticks. This causes race conditions on `activeCount` (non-atomic increment/decrement at lines 208, 244, 303, 337) and can launch duplicate investigations for the same schedule.

**Impact:** Corrupted `activeCount`, duplicate scheduled investigations, wasted resources.

### 10. Scheduler settlement error leaves orphaned `activeInvestigationId` (HIGH)

**File:** `Scheduler.ts` — lines 235-292, specifically 268-269  
**Mechanism:** During `settleInvestigation()`, after decrementing `activeCount` (line 244), calls to `writeRunReport()` and `regenerateExecutiveReport()` (lines 268-269) perform file I/O without try/catch. If either throws, execution stops before `activeInvestigationId` is cleared (line 277). The schedule is then permanently blocked — future ticks skip it because `activeInvestigationId` is still set.

**Impact:** Schedule permanently stuck; requires manual intervention to unblock.

### 11. Fire-and-forget promise chains on runner lifecycle (HIGH)

**File:** `server.ts` — lines 1637-1657, 2087-2095, 2350-2383, 2418-2428, 2873-2900, 2957-2994  
**Mechanism:** `runner.start(query).then(() => { ... }).catch(err => { ... })` is used throughout for runner lifecycle management. These are fire-and-forget — if an error occurs inside the `.then()` handler (e.g., `saveArtifacts()` throws), it is not caught by the `.catch()` because `.catch()` only handles rejections from `runner.start()` itself. Temporary runners created for retrospect/analysis operations are especially vulnerable: they are added to the `runners` Map before the async operation and only cleaned up on the success path.

**Impact:** Runners leak in the `runners` Map with attached listeners; no error notification reaches the client.

### 12. Concurrent file I/O race in `ScheduleStore` (HIGH)

**File:** `ScheduleStore.ts` — lines 140-157, 159-167, 195-199  
**Mechanism:** `appendHistory()` and `removeHistoryEntries()` both read a JSON file, modify it in memory, and write it back — without any locking. When scheduler ticks overlap (issue #9), concurrent read-modify-write cycles on the same history file cause data loss (last writer wins, discarding the other's changes).

**Impact:** Lost schedule history entries; silent data corruption.

### 13. Synchronous file I/O in Express request handlers (HIGH)

**File:** `server.ts` — lines 1450-1462 (GET `/api/files/list`), line 3035 (health check)  
**Mechanism:** Request handlers use `fs.statSync()`, `fs.readdirSync()`, and `fs.accessSync()` — synchronous calls that block the entire Node.js event loop for the duration of the I/O. If a directory contains thousands of files, all other requests (API, WebSocket) are blocked.

**Impact:** Event loop stalls; all concurrent requests and WebSocket messages delayed.

### 14. Axios calls without timeout in `CopilotProvider` (HIGH)

**File:** `CopilotProvider.ts` — lines 64-69, 79-85, 127-132, 173-177  
**Mechanism:** HTTP calls to `github.com/login/device/code`, `github.com/login/oauth/access_token`, `api.github.com/copilot_internal/v2/token`, and the models endpoint have no `timeout` option. If the GitHub API is slow or unreachable, these calls hang indefinitely, blocking the calling function and accumulating socket connections.

**Impact:** Indefinite hangs on auth/token flows; socket connection accumulation.

### 15. Missing error responses in async Express routes (MEDIUM)

**File:** `server.ts` — line 898-902 (GET `/api/version`), and various other async handlers  
**Mechanism:** Async route handlers that `await` external calls without try/catch. If the awaited promise rejects, no response is sent and the HTTP connection hangs until the client's timeout.

**Impact:** Hanging HTTP connections; client timeouts; connection pool exhaustion under load.

### 16. WebSocket `broadcast` missing error handling (MEDIUM)

**File:** `server.ts` — lines 544-551  
**Mechanism:** `ws.send()` inside `clientSet.forEach()` can throw if the send buffer is full or the connection closes between the `readyState` check and the `send()` call. An unhandled exception stops the `forEach` loop, preventing remaining clients from receiving the broadcast.

**Impact:** Partial broadcast delivery; investigation UI updates lost for some clients.

### 17. OpenAI client cache thrashing on timeout changes (MEDIUM)

**File:** `CopilotProvider.ts` — lines 149-166; `Runner.ts` — lines 842, 2049, 1525, 2287  
**Mechanism:** `getClient(timeout)` caches the OpenAI client keyed by both token and timeout. Different call sites pass different timeouts (180s for LLM calls, 600s for retrospect, 30s for classification, default for compaction). Each timeout change evicts the cached client and creates a new `OpenAI` instance. The old instance (with its HTTP agent and connection pool) is dereferenced but not explicitly closed.

**Impact:** Multiple OpenAI client instances with open connection pools accumulate; relies on GC to clean up HTTP agents.

### 18. Child process stderr unbounded in `IcmProvider` (MEDIUM)

**File:** `IcmProvider.ts` — lines 36-108  
**Mechanism:** Spawned child process stderr is accumulated via `stderr += data.toString()` with no size cap. If the ICM script produces large error output, this string grows without limit. Additionally, event listeners on the child process are never explicitly removed after the promise resolves/rejects.

**Impact:** Unbounded memory growth from error output; listener leak on child process objects.

### 19. Console.log flooding in broadcast hot path (MEDIUM)

**File:** `server.ts` — lines 542, 547, 549, 560, 579, 586, 589  
**Mechanism:** Every WebSocket broadcast logs multiple messages (`[WS Broadcast] id=... type=... clients=...` and `[WS Broadcast] Sent ... to client`). During active investigations that emit frequent thought/action/status events, this produces hundreds of log lines per minute. If stdout is redirected to a file (common in production), this fills disk; if piped, it can cause backpressure on the event loop.

**Impact:** Disk consumption; event loop slowdown from write backpressure.

### 20. `pendingInterventions` array unbounded (LOW)

**File:** `Runner.ts` — lines 97, 274-280, 1935-1939  
**Mechanism:** `intervene()` pushes to `this.pendingInterventions` without a size cap. If the main loop is paused or slow (waiting for LLM), rapid API calls to the intervene endpoint accumulate entries indefinitely.

**Impact:** Minor — interventions are small strings. But a malicious or buggy client could flood the queue.

---

## Proposed Fixes for Additional Issues

### Fix 7: Cap `retrospect.messages` and `logs`

**Files:** `Runner.ts`

- Cap `this.state.retrospect.messages` to the most recent **100 entries**. Before pushing a new message, if the array exceeds the cap, shift the oldest entries. Tool-result messages (which contain the bulk of the data) should be truncated to a shorter limit (e.g., 200 chars) when they age out of the recent window.
- Cap `this.state.logs` to the most recent **500 entries** using a ring-buffer approach: when the array exceeds the cap, splice out the oldest entries.
- Both caps apply before `saveArtifacts()` writes to disk, reducing `state.json` file size.

**Acceptance criteria:**
- `retrospect.messages` never exceeds 100 entries in memory or on disk.
- `logs` never exceeds 500 entries in memory or on disk.
- Oldest entries are discarded gracefully; no data corruption.

### Fix 8: Guard scheduler `tick()` against overlap

**File:** `Scheduler.ts`

- Add a `private tickInProgress = false` flag. At the start of `tick()`, return immediately if the flag is set. Set the flag to `true` on entry, `false` in a `finally` block.
- This prevents concurrent tick invocations from racing on `activeCount` and launching duplicate investigations.

**Acceptance criteria:**
- Only one `tick()` executes at a time.
- Long-running ticks do not cause duplicate investigation launches.
- `activeCount` remains consistent.

### Fix 9: Wrap settlement file I/O in try/catch

**File:** `Scheduler.ts` — `settleInvestigation()` and `settleEscalation()`

- Wrap `writeRunReport()` and `regenerateExecutiveReport()` in try/catch blocks.
- On failure, log the error but still proceed to clear `activeInvestigationId` and update the schedule.
- This prevents a file I/O error from permanently blocking a schedule.

**Acceptance criteria:**
- A report-generation failure never blocks future schedule runs.
- `activeInvestigationId` is always cleared after settlement, regardless of report success.

### Fix 10: Use `.finally()` for guaranteed runner cleanup

**File:** `server.ts` — all `runner.start().then().catch()` chains and temporary runner creation paths

- Replace `.then().catch()` patterns with `try/await/finally` or add `.finally()` to guarantee cleanup.
- For temporary runners: always call `cleanupRunner(id)` (from Fix 3) in `.finally()`, regardless of success or failure.
- For the main `createInvestigation` flow: ensure `runners.delete(id)` and `removeAllListeners()` happen in `.finally()`.

**Acceptance criteria:**
- No runner is ever left in the `runners` Map after its operation completes, succeeds, or fails.
- Temporary runners are always cleaned up, even if `saveArtifacts()` throws.

### Fix 11: Atomic file writes and read-locking in `ScheduleStore`

**File:** `ScheduleStore.ts`

- All write operations (`appendHistory`, `removeHistoryEntries`, `save`) must use atomic write-via-rename (write to `.tmp`, then `fs.renameSync`).
- Add a per-file in-memory write lock (a simple `Promise` chain or mutex) to serialize read-modify-write cycles on the same file.
- Wrap all `JSON.parse()` calls in try/catch with fallback to empty defaults.

**Acceptance criteria:**
- Concurrent writes to the same history file never cause data loss.
- Corrupted JSON files are handled gracefully (reset to empty, logged).
- All writes are atomic (no partial file content on crash).

### Fix 12: Replace sync file I/O in request handlers with async

**File:** `server.ts` — `/api/files/list` endpoint, health check endpoint

- Replace `fs.statSync`, `fs.readdirSync`, `fs.accessSync` with their async counterparts (`fs.promises.stat`, `fs.promises.readdir`, `fs.promises.access`).
- Add try/catch to return proper error responses.

**Acceptance criteria:**
- No synchronous file I/O in any Express request handler.
- Event loop is never blocked by file operations during request processing.

### Fix 13: Add timeouts to all external HTTP calls

**Files:** `CopilotProvider.ts`, `IcmProvider.ts`, `updateChecker.ts`, `server.ts` (incident provider calls)

- Add `timeout: 10_000` (10 seconds) to all axios calls for auth flows.
- Add `timeout: 30_000` (30 seconds) to model listing and token refresh calls.
- Add a size cap (100 KB) on child process stderr accumulation in `IcmProvider`.
- Add `AbortSignal.timeout()` or equivalent to any `fetch`/axios call that currently has no timeout.

**Acceptance criteria:**
- No HTTP call can hang indefinitely.
- Child process stderr is bounded.
- Timeout errors are caught and returned as proper error responses.

### Fix 14: Harden WebSocket broadcast and reduce hot-path logging

**File:** `server.ts` — `broadcastToClients()`, WebSocket connection handler

- Wrap `ws.send()` in try/catch inside the `forEach` loop so one failed send does not abort the loop.
- Remove or gate verbose broadcast logging behind a debug flag (e.g., `process.env.DEBUG_WS`). In production, only log errors and connection/disconnection events.

**Acceptance criteria:**
- A single broken WebSocket connection never prevents other clients from receiving broadcasts.
- Broadcast hot path produces zero log output in production mode.

### Fix 15: Reuse OpenAI client across timeout changes

**File:** `CopilotProvider.ts` — `getClient()`

- Decouple the HTTP client timeout from client instance creation. Use per-request timeout (via `AbortSignal.timeout()` or request-level options) instead of creating a new `OpenAI` instance for each timeout value.
- Cache the client by token only (not by token + timeout).

**Acceptance criteria:**
- Only one `OpenAI` client instance exists per token, regardless of how many different timeouts are used.
- Per-call timeouts still work correctly.

---

---

## Security Issues

### 21. Path traversal via `startsWith()` check (CRITICAL)

**File:** `server.ts` — lines 1444-1448 (GET `/api/files/list`)  
**Mechanism:** The file-listing endpoint resolves user-supplied `req.query.path` and validates it against allowed roots using `targetPath.startsWith(root)`. This check is insufficient: a path like `C:\repo-data` would pass validation when the allowed root is `C:\repo`, even though it is not a subdirectory. On Windows, symlinks and junction points can also bypass this check.

**Impact:** An attacker can read directory listings outside the intended boundaries.

**Fix:** Use `path.relative()` and verify the result does not start with `..`, or append `path.sep` to the root before comparing: `targetPath.startsWith(root + path.sep)`. Also resolve symlinks with `fs.realpathSync()`.

### 22. SSRF via user-configurable update manifest URL (HIGH)

**File:** `updateChecker.ts` — line 143  
**Mechanism:** The update checker fetches a URL from configuration (`updateManifestUrl`). If this URL can be set via the settings API, an attacker could point it at internal services (`http://localhost:6379`, `http://169.254.169.254/` for cloud metadata).

**Impact:** Server-side request forgery — access to internal network services from the server process.

**Fix:** Validate that the URL uses HTTPS and does not resolve to localhost, link-local, or private IP ranges.

### 23. Incident ID not validated before `spawn()` (MEDIUM)

**File:** `IcmProvider.ts` — line 36  
**Mechanism:** The `id` parameter from `fetchIncident(id, ...)` is passed directly as an argument to `child_process.spawn()`. While `spawn()` with array args is safer than `exec()`, no validation is performed on the ID format.

**Impact:** Low — `spawn()` argument array prevents shell interpretation, but excessively long or malformed IDs could cause unexpected behavior in the child script.

**Fix:** Validate that `id` matches an expected format: `if (!/^[a-zA-Z0-9\-_]+$/.test(id)) throw new Error('Invalid incident ID')`.

### 24. Prototype pollution via config merge (MEDIUM)

**File:** `server.ts` — lines 959, 1020-1026  
**Mechanism:** User-supplied settings are filtered via an `ALLOWED_KEYS` whitelist, then spread-merged into the config: `config = { ...config, ...filtered }`. While the whitelist blocks top-level unknown keys, nested objects (e.g., `products` array entries) are merged without deep validation. A crafted payload with `__proto__` in a nested object could pollute Object.prototype.

**Impact:** Prototype pollution could alter the behavior of unrelated code paths that read inherited properties.

**Fix:** Deep-sanitize filtered config via `JSON.parse(JSON.stringify(filtered))` to break prototype chains before merging.

### 25. Information disclosure in error responses (MEDIUM)

**Files:** `server.ts` — lines 1476, 1532-1533, and various catch blocks; `CopilotClient.ts` — lines 118-119  
**Mechanism:** Multiple catch blocks return `err.message` directly to the client via `res.status(500).json({ error: e.message })`. Error messages often contain internal file paths, stack fragments, or details about the server's configuration.

**Impact:** Reveals internal architecture, file paths, and library versions to potential attackers.

**Fix:** Return generic error messages to clients; log full error details server-side only.

### 26. No rate limiting on API endpoints (LOW)

**File:** `server.ts` — throughout  
**Mechanism:** No rate-limiting middleware is applied to any endpoint. All endpoints can be called at unlimited frequency.

**Impact:** Brute-force attacks on auth endpoints; resource exhaustion via rapid polling.

**Fix:** Add `express-rate-limit` middleware, at least on auth and mutation endpoints.

---

## Performance Issues

### 27. PDF buffer held entirely in memory (HIGH)

**File:** `server.ts` — lines 2750-2771  
**Mechanism:** `renderPdf()` returns the entire PDF as a `Buffer`, which is held in memory until `res.send(pdfBuffer)` completes. For large reports, this buffer can be 10+ MB. Concurrent PDF requests multiply this.

**Impact:** Memory spikes on concurrent PDF exports; no streaming, no cleanup on error.

**Fix:** Stream Puppeteer's PDF output directly to the response, or write to a temp file and use `res.sendFile()`.

### 28. N+1 pattern in investigation list endpoint (HIGH)

**File:** `server.ts` — lines 1748-1825  
**Mechanism:** The `GET /api/investigations` endpoint loops through every investigation in the history store, calling `getThoughtSource()`, `getThoughtPreview()`, and constructing a 20+ field summary object per iteration. With 1000+ investigations, this creates 1000+ intermediate objects with per-item function calls before pagination is applied.

**Impact:** Memory spikes and CPU waste on every dashboard poll; all summaries built before page slice.

**Fix:** Apply pagination early — only build summary objects for the requested page. Pre-index by status/product for filtered queries.

### 29. Unbounded `getHistory()` in schedule endpoints (HIGH)

**File:** `server.ts` — lines 3297-3350, 3552, 3619-3624  
**Mechanism:** Multiple schedule endpoints call `scheduleStore.getHistory(id)` which loads the full history array from disk without pagination. In `GET /api/schedules`, this is called once per schedule in a loop. A system with 100 schedules, each with 10K history entries, loads 1M entries into memory in a single request.

**Impact:** O(N×M) memory allocation on schedule list requests; major bottleneck.

**Fix:** Add a `maxEntries` or pagination parameter to `getHistory()`. For the schedule list, only load verdict/status, not full history.

### 30. Redundant JSON.stringify in WebSocket broadcast (MEDIUM)

**File:** `server.ts` — line 546  
**Mechanism:** `JSON.stringify({ type, data })` is called inside `clientSet.forEach()`, meaning the same object is serialized once per connected client. For 10 clients watching the same investigation, 10 identical serializations occur.

**Impact:** CPU waste proportional to client count × broadcast frequency.

**Fix:** Stringify once before the loop, send the pre-serialized string to each client.

### 31. Missing response compression (MEDIUM)

**File:** `server.ts` — line 239  
**Mechanism:** No gzip/brotli compression middleware is applied. Large JSON responses (investigation lists, full state objects) are sent uncompressed over the wire.

**Impact:** Higher bandwidth usage; slower response times on limited connections.

**Fix:** Add `compression` middleware: `app.use(compression({ threshold: 1024 }))`.

### 32. Multiple redundant `readdirSync()` calls (MEDIUM)

**File:** `server.ts` — lines 2542, 2593, 2642, 2466  
**Mechanism:** Different endpoints (delete, export, clone) each independently call `fs.readdirSync(investigationsDir)` and scan for a matching folder by ID suffix. The `storagePathCache` already exists but is not used in these paths.

**Impact:** Repeated synchronous I/O on large investigation directories (10K+ folders).

**Fix:** Use `storagePathCache` consistently. Fall back to `readdirSync` only on cache miss.

---

## Frontend Issues

### 33. Dashboard polls every 3 seconds even when idle (MODERATE)

**File:** `frontend/src/pages/Dashboard.tsx` — lines 281-329  
**Mechanism:** `setInterval(fetchData, 3000)` runs unconditionally — even when the tab is in the background or no investigations are active.

**Impact:** 1,200 API calls per hour; constant network traffic and server load; contributes to the N+1 issue (#28) on the backend.

**Fix:** Increase interval to 10-15 seconds. Use `document.visibilityState` to pause polling when the tab is hidden. Use adaptive polling (longer intervals when no active investigations).

### 34. Investigation thoughts rendered without virtualization (MODERATE)

**File:** `frontend/src/pages/InvestigationDetail.tsx` — lines 1587-1605  
**Mechanism:** All filtered thoughts are rendered as DOM nodes via `.map()` with no virtualization or pagination. A long investigation (24 hours at 1 step/minute = 1,440 steps) renders 1,440+ `StepItem` components simultaneously.

**Impact:** DOM bloat; UI jank on longer investigations; memory pressure in the browser.

**Fix:** Use `react-window` or similar for virtual scrolling, or paginate with a "load more" button. The backend step-detail endpoint already supports index-based access.

### 35. No `AbortController` on fetch calls (MODERATE)

**File:** `frontend/src/api.ts` — 50+ fetch calls  
**Mechanism:** All `fetch()` calls in the API module lack an `AbortSignal`. If a component unmounts while a request is in flight (e.g., user navigates away), the response callback still executes, potentially calling `setState` on an unmounted component.

**Impact:** React warnings; wasted network resources; potential state corruption on rapid navigation.

**Fix:** Accept an `AbortSignal` parameter in API functions. Pass signals from `useEffect` cleanup functions.

---

## Proposed Fixes for Security, Performance, and Frontend Issues

### Fix 16: Harden path traversal check

**File:** `server.ts` — `/api/files/list` endpoint

- Replace the `startsWith()` check with `path.relative(root, targetPath)` and verify the result does not start with `..` and does not equal the empty string.
- Resolve symlinks with `fs.realpathSync()` before comparison.
- Add `path.sep` boundary check.

### Fix 17: Validate and restrict external URLs

**Files:** `updateChecker.ts`, `server.ts` (settings import)

- Validate that any user-configurable URL uses HTTPS.
- Block localhost, 127.x.x.x, 169.254.x.x, 10.x.x.x, 172.16-31.x.x, 192.168.x.x addresses.
- Sanitize nested objects in config merges via `JSON.parse(JSON.stringify())`.

### Fix 18: Stream PDF output and bound schedule history

**Files:** `server.ts` (PDF export endpoint), `ScheduleStore.ts`

- Write PDF to a temp file, then `res.sendFile()` with cleanup callback — avoids holding the full buffer in memory.
- Add a `limit` parameter to `getHistory()` (default: 100). Schedule list endpoints pass a small limit; report endpoint passes a larger one.
- Use `storagePathCache` in delete/export/clone endpoints instead of redundant `readdirSync`.

### Fix 19: Reduce dashboard polling and add virtualization

**Files:** `frontend/src/pages/Dashboard.tsx`, `frontend/src/pages/InvestigationDetail.tsx`, `frontend/src/api.ts`

- Increase dashboard poll interval from 3s to 10s. Pause polling when `document.visibilityState === 'hidden'`.
- Add `react-window` or `react-virtual` for the thoughts/steps list in `InvestigationDetail`. Fall back to paginated loading for investigations with 500+ steps.
- Add `AbortController` support to the API module. Pass `signal` from `useEffect` cleanup in all data-fetching hooks.

### Fix 20: Sanitize error responses

**Files:** `server.ts` — all catch blocks that return `e.message` to the client

- Replace `res.status(500).json({ error: e.message })` with a generic message: `{ error: 'Internal server error' }`.
- Log the full error server-side with `console.error()`.
- In development mode (`NODE_ENV !== 'production'`), optionally include the original message for debugging.

---

## Out of Scope

- Adding external caching layers (Redis, etc.).
- Complete rewrite of the Express routing layer.
- Migration to a database-backed storage engine.

## Rollout

- **Phase 1 (Critical):** Fixes 1-6 address the core memory leaks. Fix 16 addresses the critical security issue. Deploy first.
- **Phase 2 (High):** Fixes 7-15 address robustness, race conditions, and secondary resource leaks.
- **Phase 3 (Hardening):** Fixes 17-20 address security hardening, performance, and frontend improvements.
- All fixes are backward-compatible. Fix 1 (history.jsonl) requires a one-time auto-migration from `state.json`.
- Monitor `process.memoryUsage().heapUsed` and `process.memoryUsage().rss` after deployment to validate.

## Success Metrics

- Heap usage remains **under 1 GB** after 7 days of continuous operation under typical load.
- No virtual memory exhaustion events in Windows Event Log.
- No `MaxListenersExceededWarning` in server logs.
- No orphaned `activeInvestigationId` blocking schedules.
- WebSocket broadcast errors logged but never crash the broadcast loop.
- Zero hanging HTTP connections from async route errors.
- No path traversal or SSRF vulnerabilities in penetration testing.
- Dashboard poll frequency reduced by 70% (3s → 10s).
