# PRD: AI-Investigator Memory Leak & Performance Remediation

**Product**: AI-Investigator  
**Author**: Auto-generated from static analysis  
**Date**: 2026-03-29  
**Status**: Draft  
**Version**: 1.0

---

## 1. Overview

### 1.1 Problem Statement

A comprehensive static analysis of the AI-Investigator codebase identified **37 actionable memory leak and performance issues** (1 originally flagged issue was invalidated after deeper review) across the backend (Node.js/Express) and frontend (React/TypeScript). These issues range from leaked OS-level child processes to fire-and-forget timers and missing resource cleanup. Left unaddressed, they degrade reliability, waste server resources, and create a poor user experience — especially under sustained use (long-running investigations, scheduled runs, repeated server restarts).

### 1.2 Goals

| Goal | Measure of Success |
|------|-------------------|
| Eliminate all critical and high-severity resource leaks | Zero leaked OS processes after server restart; zero orphan Playwright browsers after SSE disconnect |
| Prevent unbounded memory growth | Backend heap stays stable during long investigations *(already mitigated via sliding window reads + memory release after save)* |
| Ensure clean React component lifecycle | Zero "setState on unmounted component" warnings in console |
| Improve frontend rendering efficiency | Dashboard re-render time reduced by ≥40% (measured via React DevTools Profiler) |
| Maintain zero regression in existing tests | All existing backend + frontend test suites pass |

### 1.3 Non-Goals

- Rewriting the application architecture (e.g., switching from Express to a different framework)
- Adding new features or changing user-facing behavior
- Migrating to a different state management library (e.g., Redux, Zustand)
- Performance optimizations for cold start / initial load time (Low-priority items like sync I/O at startup are deferred)

---

## 2. Issue Inventory

### 2.1 Summary

| Severity | Backend | Frontend | Total |
|----------|---------|----------|-------|
| 🔴 Critical | 2 | 2 | **4** |
| 🟠 High | 4 | 5 | **9** |
| 🟡 Medium | 5 | 9 | **14** |
| 🟢 Low | 6 | 5 | **11** |
| **Total** | **17** | **21** | **38** |

### 2.2 Critical Issues

| ID | Title | Component | Location | Impact |
|----|-------|-----------|----------|--------|
| C-1 | Server restart leaks MCP child processes | Backend | `server.ts:2401–2411` | Orphan OS processes accumulate on every restart, eventually exhausting system resources |
| C-2 | SSE endpoint leaks on client disconnect | Backend | `server.ts:1626–1657` | Playwright browser processes hang for 5+ minutes per disconnected client |
| C-3 | AudioContext leak in notification chime | Frontend | `useNotification.ts:43` | Notifications silently fail after ~6 uses due to browser AudioContext limit |
| C-4 | No AbortController for any frontend fetch | Frontend | `api.ts`, all pages | Every unmount during a fetch causes stale state updates, wasted network, React warnings |

### 2.3 High Issues

| ID | Title | Component | Location | Impact |
|----|-------|-----------|----------|--------|
| H-1 | ~~`fullHistory`/`fullActions` grow without bounds~~ **INVALID** | Backend | `Runner.ts:118–155` | **Not a real issue.** Reading is done via sliding window (50k char cap with HEAD-TAIL truncation in `buildRetrospectHistory()`, 110k token budget in `runRetrospectToolLoop()`). Arrays are cleared from memory after each `saveArtifacts()` call (line 1939-1943). LLM messages capped at last 10. |
| H-2 | Busy-wait polling while paused burns CPU | Backend | `Runner.ts:187–209, 277–279` | Each paused runner consumes a 1s timer chain on the event loop |
| H-3 | WebSocket clients missing error handler | Backend | `server.ts:705–711` | Zombie WebSocket entries accumulate in clients Set |
| H-4 | LRU `touch()` is O(n) per access | Backend | `server.ts:237–241` | Linear scan on every investigation detail request |
| H-5 | Dashboard fire-and-forget `setTimeout` calls | Frontend | `Dashboard.tsx:271,281,354` | setState on unmounted component |
| H-6 | InvestigationDetail `setTimeout` without cleanup | Frontend | `InvestigationDetail.tsx:581,678,920` | setState on unmounted component |
| H-7 | OnboardingWizard fetch without cleanup | Frontend | `OnboardingWizard.tsx:22–24` | Stale state update on unmount |
| H-8 | App.tsx onboarding fetch without cleanup | Frontend | `App.tsx:38–41` | Stale state update on unmount |
| H-9 | Settings.tsx fire-and-forget `setTimeout` calls | Frontend | `Settings.tsx:19,394,454,484` | setState on unmounted component |

### 2.4 Medium Issues

| ID | Title | Component | Location |
|----|-------|-----------|----------|
| M-1 | `resetRuntimeState()` leaks runner resources in tests | Backend | `server.ts:4068–4078` |
| M-2 | Scheduler `activeCount` drifts on external deletion | Backend | `Scheduler.ts:227,263,323,357` |
| M-3 | `ScheduleStore.writeLocks` is dead code | Backend | `ScheduleStore.ts:57,203–205` |
| M-4 | `buildRetrospectHistory()` creates large intermediate strings | Backend | `Runner.ts:521–566` |
| M-5 | `GET /api/investigations` builds all summaries before filtering | Backend | `server.ts:1851–1929` |
| M-6 | Dashboard: ~30+ useState hooks causing cascading re-renders | Frontend | `Dashboard.tsx:148–211` |
| M-7 | InvestigationDetail: ~35 state variables in one component | Frontend | `InvestigationDetail.tsx:519–554` |
| M-8 | Chart components recompute data every render (no useMemo) | Frontend | All 7 chart components |
| M-9 | `widgetRegistry.ts` calls component as function | Frontend | `widgetRegistry.ts:27` |
| M-10 | `FileBrowserModal.tsx` async operation without cleanup | Frontend | `FileBrowserModal.tsx:27–34` |
| M-11 | `ScheduleForm`/`NewInvestigation` fire-and-forget setTimeout | Frontend | `NewInvestigation.tsx:435`, `ScheduleForm.tsx:354` |
| M-12 | Notification objects never closed | Frontend | `useNotification.ts:85–89` |
| M-13 | Module-level `_thoughtActivity` grows unboundedly | Frontend | `Dashboard.tsx:108,143` |

### 2.5 Low Issues

| ID | Title | Component | Location |
|----|-------|-----------|----------|
| L-1 | `saveArtifacts()` uses synchronous I/O | Backend | `Runner.ts:1840–1945` |
| L-2 | `loadHistory()` reads all files synchronously at startup | Backend | `server.ts:480–619` |
| L-3 | `discoverKnowledgeBase()` has no file count limit | Backend | `Runner.ts:582–661` |
| L-4 | `getHistoryCount()` reads entire file to count entries | Backend | `ScheduleStore.ts:131–163` |
| L-5 | Scheduler EventEmitter has no maxListeners setting | Backend | `Scheduler.ts:70` |
| L-6 | `cachedClient` in LLM providers ignores timeout changes | Backend | `CopilotProvider.ts:156–159` |
| L-7 | Duplicated `useCountUp` hook | Frontend | `Dashboard.tsx`, `Schedules.tsx` |
| L-8 | Duplicated `parseFlexibleTimestamp` function | Frontend | `NewInvestigation.tsx`, `ScheduleForm.tsx` |
| L-9 | Layout.tsx login poller closure captures stale provider name | Frontend | `Layout.tsx:71–97` |
| L-10 | Mixed localStorage/Settings API as source of truth | Frontend | `Dashboard.tsx`, `Schedules.tsx` |
| L-11 | `localStorage.getItem` in useState initializers flashes wrong values | Frontend | `Dashboard.tsx:162–211` |

---

## 3. Phased Delivery Plan

### Phase 1 — Critical Resource Leaks

**Scope**: C-1, C-2, C-3, C-4  
**Risk**: Highest — these cause OS-level resource exhaustion and silent feature breakage.

| Item | Work Description |
|------|-----------------|
| C-1 | Replace `runners.clear()` in restart handler with iteration calling `cleanupRunner(id)` for each active runner |
| C-2 | Add `req.on('close', ...)` abort handler to SSE endpoints; check `aborted` flag before every `res.write()` |
| C-3 | Create a single module-level `AudioContext` instance in `useNotification.ts`; reuse across all `playChime()` calls |
| C-4 | Add `AbortController` support to `api.ts` fetch wrapper; update all `useEffect` hooks that call API methods to pass signals and abort on cleanup |

**Acceptance Criteria**:
- After server restart, `tasklist` shows zero orphan MCP/Playwright child processes
- Disconnecting from SSE mid-stream causes immediate cleanup (no lingering browser process)
- Triggering 20+ notification chimes in succession all play correctly
- Navigating away from Dashboard mid-poll produces zero React warnings in console

---

### Phase 2 — High-Severity Stability Fixes

**Scope**: H-1 through H-9  
**Risk**: High — these cause gradual memory bloat, CPU waste, and React lifecycle violations.

| Item | Work Description |
|------|-----------------|
| H-1 | ~~`fullHistory`/`fullActions` grow without bounds~~ — **INVALID**: Reading uses a sliding window (50k char cap, HEAD-TAIL truncation, 110k token budget). Arrays cleared from memory after each `saveArtifacts()`. No action needed. |
| H-2 | Replace busy-wait `while(paused)` loop with event-based `await this.once('_resume')` pattern |
| H-3 | Add `ws.on('error', () => ws.terminate())` to WebSocket connection handler |
| H-4 | Replace `accessOrder` array in `InvestigationHistoryStore` with a `Map<string, number>` for O(1) LRU operations |
| H-5 | Create a `useTimeout` utility hook that stores IDs in a ref and clears on unmount; apply to Dashboard |
| H-6 | Apply `useTimeout` hook to InvestigationDetail |
| H-7 | Add AbortController + cleanup to OnboardingWizard fetch |
| H-8 | Add mounted flag or AbortController to App.tsx onboarding redirect |
| H-9 | Apply `useTimeout` hook to Settings.tsx |

**Acceptance Criteria**:
- ~~A 500-step investigation keeps backend heap under 512 MB~~ (H-1 invalidated — already handled by sliding window + memory release after save)
- Pausing 5 runners shows zero CPU overhead (no 1s polling timers in profiler)
- Simulating WebSocket errors leaves zero zombie entries in clients Set
- Investigation list with 1000 entries: `touch()` shows O(1) in profiler
- Navigating away from any page mid-timer produces zero React warnings

---

### Phase 3 — Medium-Severity Performance & Cleanup

**Scope**: M-1 through M-13  
**Risk**: Medium — these cause wasted computation, test flakiness, and maintenance debt.

| Item | Work Description |
|------|-----------------|
| M-1 | Fix `resetRuntimeState()` to iterate and call `cleanupRunner()` before `runners.clear()` |
| M-2 | Recalculate `activeCount` from actual schedule state at the start of each `tick()` |
| M-3 | Remove dead `writeLocks` code or implement proper file locking for concurrent `appendHistory()` |
| M-4 | Track running string length in `buildRetrospectHistory()` and stop appending when budget is reached |
| M-5 | Apply filters and product filtering before building investigation summaries; cache KPI computation |
| M-6 | Extract Dashboard filter/sort state into `useReducer`; memoize investigation card rendering |
| M-7 | Break InvestigationDetail into sub-components with isolated state |
| M-8 | Wrap all chart data transformations in `useMemo` |
| M-9 | Change `widgetRegistry.ts` to use JSX (`<SuccessRateDonut .../>`) instead of calling component as function |
| M-10 | Add cleanup flag for async operation in `FileBrowserModal` |
| M-11 | Apply `useTimeout` hook to ScheduleForm and NewInvestigation |
| M-12 | Store Notification reference and call `.close()` on unmount |
| M-13 | Add periodic cleanup of `_thoughtActivity` entries older than 1 hour |

**Acceptance Criteria**:
- Backend test suite shows zero leaked runners between test files
- Scheduler `activeCount` stays accurate after manual investigation deletion
- Dashboard with 100 investigations: chart components skip re-computation when data hasn't changed (verified via React Profiler)
- `GET /api/investigations` with 1000 items + filters: response time reduced by ≥30%

---

### Phase 4 — Low-Severity Tech Debt

**Scope**: L-1 through L-11  
**Risk**: Low — these are optimizations and code quality improvements.

| Item | Work Description |
|------|-----------------|
| L-1 | Migrate `saveArtifacts()` from `fs.*Sync` to `fs.promises.*` |
| L-2 | Convert `loadHistory()` to async I/O (optional; acceptable for startup) |
| L-3 | Add `MAX_FILES = 200` limit to `discoverKnowledgeBase()` |
| L-4 | Cache history count in memory instead of re-reading file |
| L-5 | Set `scheduler.setMaxListeners(20)` and clean up listeners on restart |
| L-6 | Document `cachedClient` timeout behavior in code comments |
| L-7 | Extract `useCountUp` into `hooks/useCountUp.ts` |
| L-8 | Extract `parseFlexibleTimestamp` into shared `utils/` |
| L-9 | Move `providerDisplayName` computation inside polling callback or use a ref |
| L-10 | Consolidate on a single source of truth for user settings |
| L-11 | Eliminate flash by reading settings in a single initialization pass |

**Acceptance Criteria**:
- `saveArtifacts()` no longer blocks event loop (measured via async hooks or profiler)
- No duplicated utility functions across files
- All existing tests continue to pass

---

## 4. Shared Utilities to Create

Several fixes share common patterns. These should be built as reusable utilities:

| Utility | Used By | Description |
|---------|---------|-------------|
| `useTimeout(callback, delay)` hook | H-5, H-6, H-9, M-11 | Returns a `set`/`clear` pair; auto-clears on unmount |
| `useAbortableFetch()` hook | C-4, H-7, H-8 | Wraps fetch with AbortController; aborts on unmount |
| Shared `AudioContext` singleton | C-3 | Module-level audio context reused across notification sounds |
| `parseFlexibleTimestamp()` in `utils/` | L-8 | Single source for timestamp parsing |
| `useCountUp()` in `hooks/` | L-7 | Animated count-up hook |

---

## 5. Testing Strategy

| Phase | Testing Approach |
|-------|-----------------|
| Phase 1 | Manual verification of OS process cleanup + automated tests for AbortController behavior |
| Phase 2 | Heap snapshot comparison before/after 500-step investigation; React warning monitoring |
| Phase 3 | React Profiler measurements for re-render counts; API response time benchmarks |
| Phase 4 | Existing test suite regression + manual code review |

**Regression**: All phases must pass `npm test --prefix backend && npm test --prefix frontend` before merge.

---

## 6. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| AbortController changes break existing fetch error handling | Medium | High | Add AbortError-specific catch handling; test with rapid navigation |
| Event-based pause/resume introduces race conditions | Low | High | Add integration tests for pause→resume→pause sequences |
| Chart useMemo dependencies are incorrect (stale renders) | Medium | Medium | Verify with React Strict Mode double-render |
| Refactoring Dashboard/InvestigationDetail into sub-components causes state sync bugs | Medium | High | Incremental extraction with snapshot tests at each step |

---

## 7. Success Metrics

| Metric | Current State | Target |
|--------|--------------|--------|
| Orphan processes after restart | Unbounded growth | 0 |
| Backend heap during long runs | Stable (sliding window + save release) | Already mitigated |
| React "unmounted setState" warnings | Frequent | 0 |
| Dashboard re-render time (100 investigations) | Baseline | ≥40% reduction |
| `GET /api/investigations` (1000 items, filtered) | Baseline | ≥30% faster |
| Notification chime reliability | Fails after ~6 | 100% reliability |

---

## Appendix A: File Reference

All issues trace to these source files:

**Backend** (`backend/src/`):
- `server.ts` — Express server, routes, WebSocket, InvestigationHistoryStore
- `agent/Runner.ts` — Investigation execution engine
- `agent/CopilotClient.ts` — LLM client wrapper
- `agent/tools/McpToolBridge.ts` — MCP child process management
- `schedules/Scheduler.ts` — Cron-style investigation scheduler
- `schedules/ScheduleStore.ts` — File-based schedule persistence
- `agent/llm/providers/CopilotProvider.ts` — Copilot LLM provider

**Frontend** (`frontend/src/`):
- `api.ts` — Centralized API client
- `App.tsx` — Router and onboarding redirect
- `hooks/useNotification.ts` — Browser notification + chime
- `pages/Dashboard.tsx` — Main investigation list view
- `pages/InvestigationDetail.tsx` — Single investigation view
- `pages/Settings.tsx`, `OnboardingWizard.tsx`, `ScheduleForm.tsx`, `NewInvestigation.tsx`
- `components/charts/*` — Dashboard chart widgets
- `components/Layout.tsx`, `FileBrowserModal.tsx`, `widgetRegistry.ts`
