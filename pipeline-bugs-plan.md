# Plan: Fix Pipeline Lifecycle Bugs

## TL;DR
Deep audit of the pipeline investigation lifecycle revealed 5 real bugs causing state loss on resume, state loss on contest, stale state on pause, timer leaks, and server restart data loss. All stem from incomplete state management between the PipelineOrchestrator and the anchor runner.

---

## Bug Inventory

### Bug 1 — Resume loses accumulated thoughts/actions/logs (CRITICAL)
- **Root cause**: `resumePipelineInvestigation()` passes only metadata fields (id, query, target, etc.) to `orchestrator.run()`. The orchestrator's `currentState` starts with empty `thoughts: []`, `actions: []`, `fullHistory: []`, `fullActions: []`. When the resumed stage runs, each per-stage runner inherits these empty arrays. The `.then()` handler then overwrites the anchor runner's accumulated state with the orchestrator's (now-incomplete) final state.
- **Impact**: If a 6-stage pipeline paused after stage 3, resuming from stage 3 loses all thoughts/actions/logs from stages 0-2 in the final saved state.
- **Files**: `server.ts` — `resumePipelineInvestigation()` ~line 2082-2098, `.then()` handler ~line 2107-2120

### Bug 2 — Pause doesn't sync pipeline state from orchestrator to anchor runner (CRITICAL)
- **Root cause**: When pause is called on an active pipeline, the action handler calls `runner.pause()` and `orchestrator.pause()`, but doesn't copy the orchestrator's current pipeline state (stage statuses, conversation log, current stage index) back to the anchor runner. The `saveToDisk` helper only fires on stage events (stage-start, stage-complete) — after pause, no more events fire, so stale state is persisted.
- **Impact**: When the investigation is later resumed from disk, it may restart from an outdated stage index or lose conversation log entries from the current stage.
- **Files**: `server.ts` — action handler pause block ~line 2757-2760

### Bug 5 — Contest/reject loses accumulated fullHistory/fullActions (CRITICAL)
- **Root cause**: `restartPipelineForContest()` creates a new `PipelineOrchestrator` and passes only metadata fields (id, query, target, contestCount, etc.) to `orchestrator.run()`. The orchestrator starts with empty `thoughts: []`, `actions: []`, `fullHistory: []`, `fullActions: []`. The `.then()` handler overwrites the anchor runner's state with the orchestrator's fresh-start state, destroying all pre-contest investigation history.
- **Impact**: After contest, `fullHistory` and `fullActions` are lost — the retrospect stage cannot analyze what happened in the prior run, and `restoreToLastCheckpoint()` fails because it can't find the "Report Contested:" boundary marker in fullHistory. All prior investigation work disappears.
- **Files**: `server.ts` — `restartPipelineForContest()` ~line 2180-2215, `.then()` handler ~line 2198-2210

### Bug 3 — setTimeout leak in runWithTimeout/runRetrospectStage (HIGH)
- **Root cause**: `Promise.race([runner.start(query), timeoutPromise])` — when the runner completes before the timeout, the `setTimeout` handler is never cleared. It remains in the Node.js timer queue and eventually fires, rejecting a promise that nobody is listening to.
- **Impact**: Memory leak (timer references), potential unhandled promise rejection warnings in logs, Node.js process may be kept alive by dangling timers.
- **Files**: `PipelineOrchestrator.ts` — `runWithTimeout()` ~line 637-655, `runRetrospectStage()` ~line 657-675

### Bug 4 — Server restart doesn't sync pipeline state before pausing (MEDIUM)
- **Root cause**: The `POST /api/server/restart` handler loops through all runners and calls `runner.pause()` then `cleanupRunner()`. For pipeline investigations, it doesn't sync the orchestrator's current pipeline state to the anchor runner before pausing/saving. The `cleanupRunner` call removes the orchestrator, so after restart, the rehydrated investigation has stale pipeline state.
- **Impact**: After server restart, resumed pipeline investigations may restart from an earlier stage, losing progress from the current stage.
- **Files**: `server.ts` — `POST /api/server/restart` handler ~line 2935-2945

---

## Steps

### Phase 1: Fix resume state loss (Bug 1) — *CRITICAL*

1. **Pass accumulated state to orchestrator.run()**: In `resumePipelineInvestigation()`, add the anchor runner's accumulated arrays to the `initialMetadata` object passed to `orchestrator.run()`:
   - `thoughts: state.thoughts || []`
   - `actions: state.actions || []`
   - `fullHistory: state.fullHistory || []`
   - `fullActions: state.fullActions || []`
   - `logs: state.logs || []`
   
   Since `orchestrator.run()` spreads `...initialMetadata` AFTER the empty-array defaults, these will properly override them. Each per-stage runner created during the resumed run will then inherit the full accumulated state.

   The `.then()` handler's `Object.assign` overwrite is then correct — `finalState` will contain pre-pause state + new stage state because the orchestrator accumulated them.

   **File**: `backend/src/server.ts` — `resumePipelineInvestigation()` metadata object

### Phase 2: Fix pause state sync (Bug 2) — *CRITICAL*

2. **Sync orchestrator state on pause**: In the active-runner pause handler, after calling `orchestrator.pause()`, sync the orchestrator's pipeline state back to the anchor runner:
   ```typescript
   const st = (runner as any).state;
   st.pipeline = orchestrator.getPipelineState();
   ```
   This ensures when `saveToDisk` fires (or the investigation is saved to history), the latest pipeline progress is captured.

   **File**: `backend/src/server.ts` — action handler pause block

### Phase 3: Fix timeout leak (Bug 3) — *HIGH*

3. **Clear timeout in runWithTimeout()**: Store the timer ID and clear it after `Promise.race` resolves:
   ```typescript
   let timerId: ReturnType<typeof setTimeout>;
   const timeoutPromise = new Promise<never>((_, reject) => {
       timerId = setTimeout(() => reject(...), timeoutMs);
   });
   try {
       await Promise.race([runner.start(query), timeoutPromise]);
   } finally {
       clearTimeout(timerId!);
   }
   ```

4. **Same fix in runRetrospectStage()**: Identical pattern — store timer ID, clear in finally.

   **File**: `backend/src/agent/pipeline/PipelineOrchestrator.ts` — both methods

### Phase 4: Fix server restart state sync (Bug 4) — *MEDIUM*

5. **Sync pipeline state before pausing on restart**: In the server restart handler's runner-pause loop, add orchestrator state sync before `runner.pause()`:
   ```typescript
   const orch = pipelineOrchestrators.get(id);
   if (orch) {
       (runner as any).state.pipeline = orch.getPipelineState();
   }
   runner.pause();
   ```

   **File**: `backend/src/server.ts` — `POST /api/server/restart` handler

### Phase 5: Tests

6. Add server test: resume pipeline with pre-existing thoughts/actions — verify they survive in the final state after orchestrator.run() completes *(covers Bug 1)*
7. Add server test: pause on active pipeline with orchestrator — verify `runner.state.pipeline` is updated from orchestrator *(covers Bug 2)*
8. Add pipeline unit test: `runWithTimeout` clears timer when runner completes before timeout *(covers Bug 3)*
9. Add server test: server restart syncs pipeline orchestrator state before pausing *(covers Bug 4)*

### Phase 6: Verify & Ship

10. Run full backend test suite with coverage: `cd backend && npx vitest run --coverage`
11. Confirm 100% coverage across all metrics
12. Commit and push

---

## Relevant Files
- `backend/src/server.ts` — `resumePipelineInvestigation()`, action handler, server restart handler
- `backend/src/agent/pipeline/PipelineOrchestrator.ts` — `runWithTimeout()`, `runRetrospectStage()`
- `backend/src/__tests__/server.test.ts` — new tests for steps 6, 7, 9
- `backend/src/__tests__/agent/pipeline/pipeline.test.ts` — new test for step 8

## Verification
1. `cd backend && npx vitest run --coverage` — all pass, 100% coverage
2. Manual: start pipeline → pause mid-stage → check state.json has current pipeline state
3. Manual: resume paused pipeline → verify thoughts timeline shows pre-pause entries

## Decisions & Scope
- **Included**: Bugs 1-5 (critical state loss on resume/contest, pause sync, timeout leak, restart sync)
- **Excluded / Deferred**:
  - Intervene lost between stages — only happens in a tiny window between stage transitions, low impact
  - Abort not interrupting LLM calls — by design, the aborted flag is checked between steps in the runner loop
  - Race between `syncRunnerState` listeners and `.then()` handler — the `.then()` handler is the final authoritative state; transient inconsistencies during execution are acceptable since `saveToDisk` captures intermediate snapshots
