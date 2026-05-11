#!/usr/bin/env node
/**
 * AI-Investigator CLI - runs a single investigation in-process and exits.
 *
 * Reuses the full backend stack (config loading, LLM provider, AgentRunner,
 * PipelineOrchestrator, on-disk persistence) by importing src/server.ts as
 * a library. Auto-start of the HTTP/WS server is suppressed via the
 * AI_INVESTIGATOR_CLI=1 env var, which gates `shouldAutoStartServer()`.
 */

// Must be set BEFORE importing ../server (which calls autoStartServerIfNeeded
// at module-load time).
process.env.AI_INVESTIGATOR_CLI = '1';

import * as fs from 'fs';
import * as path from 'path';
import {
    createInvestigation,
    historyReady,
    __testUtils,
    getInvestigationStoragePath,
} from '../server';
import {
    PipelineDefinition,
    PipelineOrchestrator,
    buildPipelinePreset,
    listPipelinePresets,
} from '../agent/pipeline';
import { AgentRunner, InvestigationState } from '../agent/Runner';

interface CliArgs {
    target?: string;
    timeRange?: string;
    query?: string;
    incidentId?: string;
    correlationId?: string;
    category?: string;
    model?: string;
    title?: string;
    maxSteps?: number;
    pipeline?: string;
    json: boolean;
    stream: boolean;
    help: boolean;
}

const HELP = `
ai-investigator - run an investigation from the command line

USAGE:
  ai-investigator [options]

OPTIONS:
  --target <name>          Investigation target (required unless --incident-id)
  --time-range <range>     Time range, e.g. "ago(1h)" (required unless --incident-id)
  --query <text>           User question / context for the investigation
  --incident-id <id>       Incident ID (alternative to --target/--time-range)
  --correlation-id <id>    Optional correlation id
  --category <name>        Optional category
  --model <name>           Override LLM model
  --title <text>           Optional human-readable title
  --max-steps <n>          Override max agent steps
  --pipeline <ref>         Pipeline preset id, or path to a JSON file
  --json                   Emit one JSON event per line (machine-readable)
  --no-stream              Suppress per-step streaming output
  -h, --help               Show this help

EXIT CODES:
  0  completed
  1  failed / aborted / paused
  2  bad arguments / fatal startup error

EXAMPLES:
  ai-investigator --target ServiceX --time-range "ago(1h)" --query "investigate spike"
  ai-investigator --incident-id 12345 --pipeline deep
  ai-investigator --pipeline ./my-pipeline.json --target ServiceX --time-range "ago(30m)"
`;

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = { json: false, stream: true, help: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => argv[++i];
        switch (a) {
            case '-h': case '--help': args.help = true; break;
            case '--target': args.target = next(); break;
            case '--time-range': args.timeRange = next(); break;
            case '--query': args.query = next(); break;
            case '--incident-id': args.incidentId = next(); break;
            case '--correlation-id': args.correlationId = next(); break;
            case '--category': args.category = next(); break;
            case '--model': args.model = next(); break;
            case '--title': args.title = next(); break;
            case '--max-steps': args.maxSteps = parseInt(next() || '', 10); break;
            case '--pipeline': args.pipeline = next(); break;
            case '--json': args.json = true; break;
            case '--no-stream': args.stream = false; break;
            default:
                if (a.startsWith('--')) {
                    console.error(`Unknown option: ${a}`);
                    process.exit(2);
                }
        }
    }
    return args;
}

/** Resolve --pipeline to a PipelineDefinition. Accepts: file path, builtin preset id. */
function resolvePipeline(ref: string): PipelineDefinition {
    const asPath = path.resolve(ref);
    if (fs.existsSync(asPath) && fs.statSync(asPath).isFile()) {
        try {
            return JSON.parse(fs.readFileSync(asPath, 'utf-8')) as PipelineDefinition;
        } catch (e: any) {
            throw new Error(`Failed to parse pipeline file ${asPath}: ${e.message}`);
        }
    }
    const preset = listPipelinePresets().find(p => p.id === ref);
    if (preset) {
        return buildPipelinePreset(preset.id);
    }
    // Saved-workflow lookup (WorkflowStore) is wired up only inside
    // initScheduler(); not loaded in CLI mode. Out of scope for v1.
    throw new Error(
        `Unknown --pipeline ref '${ref}'. Provide a file path or one of: ${
            listPipelinePresets().map(p => p.id).join(', ')
        }`
    );
}

/** Color helpers (no-op when not a TTY or when --json). */
function makeFmt(useColor: boolean) {
    const wrap = (code: string) => (s: string) => useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
    return {
        dim: wrap('2'),
        cyan: wrap('36'),
        green: wrap('32'),
        yellow: wrap('33'),
        red: wrap('31'),
        magenta: wrap('35'),
    };
}

function summarizeThought(t: any): string {
    if (typeof t === 'string') return t;
    if (t && typeof t === 'object') {
        const role = t.role || 'assistant';
        const content = typeof t.content === 'string' ? t.content : JSON.stringify(t.content || t);
        return `[${role}] ${content}`;
    }
    return String(t);
}

function trim(s: string, max = 200): string {
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '...' : s;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(HELP);
        process.exit(0);
    }

    if (!args.incidentId) {
        if (!args.target || !args.timeRange) {
            console.error('Error: --target and --time-range are required (or use --incident-id).');
            console.error('Run with --help for usage.');
            process.exit(2);
        }
    }

    let pipeline: PipelineDefinition | undefined;
    if (args.pipeline) {
        try {
            pipeline = resolvePipeline(args.pipeline);
        } catch (e: any) {
            console.error(`Error: ${e.message}`);
            process.exit(2);
        }
    }

    // Wait for the deferred history scan so the runners/history maps are
    // consistent before we add a new investigation.
    await historyReady;

    const useColor = !args.json && !!process.stdout.isTTY;
    const fmt = makeFmt(useColor);

    const emit = (kind: string, payload: any, human: () => string) => {
        if (!args.stream) return;
        if (args.json) {
            process.stdout.write(JSON.stringify({ kind, ts: Date.now(), ...payload }) + '\n');
        } else {
            process.stdout.write(human() + '\n');
        }
    };

    let runner: AgentRunner;
    let id: string;
    try {
        const result = createInvestigation({
            target: args.target,
            timeRange: args.timeRange,
            query: args.query,
            incidentId: args.incidentId,
            correlationId: args.correlationId,
            category: args.category,
            model: args.model,
            title: args.title,
            maxSteps: args.maxSteps,
            source: 'manual',
            createdBy: process.env.USERNAME || process.env.USER || 'cli',
            pipeline,
        });
        runner = result.runner;
        id = result.id;
    } catch (e: any) {
        console.error(`Error starting investigation: ${e.message}`);
        process.exit(2);
    }

    const storagePath = getInvestigationStoragePath((runner as any).state);
    emit('start', { id, storagePath, pipeline: !!pipeline }, () =>
        fmt.cyan(`> Investigation ${id} started`) + fmt.dim(` (${storagePath})`)
    );

    // For pipeline runs, the orchestrator is the event source. It is added to
    // the pipelineOrchestrators map synchronously inside createPipelineInvestigation(),
    // so it's available immediately after createInvestigation() returns.
    const orchestrator: PipelineOrchestrator | undefined =
        __testUtils.getPipelineOrchestrators().get(id);

    type Emitter = { on: (event: string, cb: (data: any) => void) => any };
    const sources: Emitter[] = [runner];
    if (orchestrator) sources.push(orchestrator);

    for (const src of sources) {
        src.on('thought', (data: any) => {
            emit('thought', { data }, () => fmt.dim('  . ') + trim(summarizeThought(data)));
        });
        src.on('action', (data: any) => {
            const name = data?.tool || data?.name || 'action';
            emit('action', { data }, () => fmt.yellow('  > ') + name +
                (data?.args ? fmt.dim(' ' + trim(JSON.stringify(data.args), 120)) : ''));
        });
        src.on('log', (data: any) => {
            emit('log', { data }, () => fmt.dim('  i ') + trim(typeof data === 'string' ? data : JSON.stringify(data)));
        });
        src.on('status', (data: any) => {
            emit('status', { status: data?.status }, () => fmt.magenta(`  * status: ${data?.status}`));
        });
    }
    if (orchestrator) {
        orchestrator.on('stage-start', (data: any) => {
            emit('stage-start', { data }, () =>
                fmt.cyan(`\n>> Stage ${data?.stageIndex + 1}/${data?.totalStages}: ${data?.agentName}`));
        });
        orchestrator.on('stage-complete', (data: any) => {
            emit('stage-complete', { data }, () =>
                fmt.green(`[ok] Stage complete: ${data?.agentName || ''}`));
        });
        orchestrator.on('stage-reject', (data: any) => {
            emit('stage-reject', { data }, () =>
                fmt.red(`[reject] ${data?.agentName} - ${trim(data?.feedback || '')}`));
        });
    }

    // Ctrl-C: graceful abort
    let aborting = false;
    const onSigint = () => {
        if (aborting) {
            console.error('\nForce exit.');
            process.exit(130);
        }
        aborting = true;
        console.error(fmt.yellow('\nAborting (Ctrl-C again to force)...'));
        try { runner.abort(); } catch { /* ignore */ }
        try { orchestrator?.abort(); } catch { /* ignore */ }
    };
    process.on('SIGINT', onSigint);

    // Wait for terminal status. createInvestigation runs asynchronously and
    // removes the runner from the runners map via cleanupRunner() once it
    // reaches completed/failed/aborted. Poll the state until then; this also
    // covers paused/suspended (which we treat as a terminal exit for CLI).
    const TERMINAL = new Set(['completed', 'failed', 'aborted', 'paused']);
    const finalStatus: string = await new Promise((resolve) => {
        const tick = () => {
            const state = (runner as any).state as InvestigationState | undefined;
            if (state && TERMINAL.has(state.status)) {
                resolve(state.status);
                return;
            }
            setTimeout(tick, 500);
        };
        tick();
    });

    process.removeListener('SIGINT', onSigint);

    const finalState = (runner as any).state as InvestigationState;
    const reportPath = path.join(storagePath, 'report.md');
    const statePath = path.join(storagePath, 'state.json');

    if (args.json) {
        process.stdout.write(JSON.stringify({
            kind: 'finish',
            id,
            status: finalStatus,
            storagePath,
            reportPath: fs.existsSync(reportPath) ? reportPath : undefined,
            statePath: fs.existsSync(statePath) ? statePath : undefined,
            recommendations: finalState.recommendations?.length || 0,
            verdict: finalState.verdict,
        }) + '\n');
    } else {
        const color = finalStatus === 'completed' ? fmt.green
            : finalStatus === 'paused' ? fmt.yellow : fmt.red;
        console.log('');
        console.log(color(`[${finalStatus}] Investigation ${id}`));
        if (finalState.verdict) console.log(fmt.dim(`  verdict: ${finalState.verdict}`));
        if (finalState.recommendations?.length) {
            console.log(fmt.dim(`  recommendations: ${finalState.recommendations.length}`));
        }
        if (fs.existsSync(reportPath)) console.log(fmt.dim(`  report: ${reportPath}`));
        if (fs.existsSync(statePath)) console.log(fmt.dim(`  state:  ${statePath}`));
    }

    process.exit(finalStatus === 'completed' ? 0 : 1);
}

main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(2);
});
