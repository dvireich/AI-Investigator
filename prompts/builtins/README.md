# Built-in Agent Prompts

This directory contains the prompt files for every built-in agent shipped with AI-Investigator. Each file corresponds to one `AgentKind` and is referenced by the `promptPath` of the matching factory in [backend/src/agent/pipeline/builtinAgents.ts](../../backend/src/agent/pipeline/builtinAgents.ts).

## Conventions

- **One file per kind.** File name = the kind's string value (e.g. `recommendation-extractor.md`). No two built-ins share a prompt.
- **No inline prompts in code.** Every built-in agent's system prompt lives here. If you find a string-literal prompt in `Runner.ts`, `Scheduler.ts`, or `server.ts`, that's a bug — file an issue.
- **Template variables.** Prompts may use `{{VARIABLE}}` placeholders, which are bound at runtime by the agent's context provider. Common variables:
  - `{{GOAL}}`, `{{TARGET}}`, `{{CATEGORY}}`, `{{STATUS}}`, `{{VERDICT}}` — investigation context
  - `{{REPORT}}` — the final investigation report
  - `{{RECOMMENDATIONS_JSON}}` — selected recommendations (for code-implementer)
  - `{{KNOWLEDGE_BASE_FILES}}` — discovered KB structure (for kb-improver)
  - `{{NOTES_TEXT}}` — user-supplied text (for notes-rephraser)
  - `{{SCHEDULE_NAME}}`, `{{SCHEDULE_TARGET}}`, `{{SCHEDULE_STATS_TABLE}}`, `{{SCHEDULE_HISTORY_DIGEST}}` — scheduled-investigation context (for executive-report)
  - `{{PLAN}}` — upstream Planner agent's output (for investigator)

## Customizing

To override a built-in's prompt without forking:

1. Copy the file to a path of your choice.
2. Edit it.
3. In Settings → Default Agents, create a custom agent of the matching kind that points to your file, and select it as the default for that kind.

The built-ins remain the fallback when no default override is set.
