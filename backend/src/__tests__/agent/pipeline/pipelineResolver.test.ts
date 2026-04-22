/// <summary>
/// Unit tests for pipelineResolver.ts - workflow-aware lookup of default pipeline IDs.
/// </summary>
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    findWorkflowPipelineById,
    resolveDefaultPipeline,
    matchDefaultPipelineId,
} from '../../../agent/pipeline/pipelineResolver';
import { buildPipelinePreset } from '../../../agent/pipeline/builtinAgents';

/// <summary>
/// Creates a fresh temp directory with a workflows.json containing the supplied entries.
/// </summary>
function createWorkflowsDir(entries: any[]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-resolver-'));
    fs.writeFileSync(path.join(dir, 'workflows.json'), JSON.stringify(entries));
    return dir;
}

describe('pipelineResolver', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ });
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* silence */ });
    });

    afterEach(() => {
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    describe('findWorkflowPipelineById', () => {
        it('returns undefined when investigationsPath is missing', () => {
            expect(findWorkflowPipelineById('any', undefined)).toBeUndefined();
            expect(findWorkflowPipelineById('any', '')).toBeUndefined();
            expect(findWorkflowPipelineById('any', 123 as any)).toBeUndefined();
        });

        it('returns undefined when workflows.json does not exist', () => {
            const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-workflows-'));
            expect(findWorkflowPipelineById('any', emptyDir)).toBeUndefined();
        });

        it('returns undefined when workflows.json is malformed', () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bad-workflows-'));
            fs.writeFileSync(path.join(dir, 'workflows.json'), '{not valid json');
            expect(findWorkflowPipelineById('any', dir)).toBeUndefined();
            expect(errorSpy).toHaveBeenCalled();
        });

        it('returns undefined when workflows.json is not an array', () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obj-workflows-'));
            fs.writeFileSync(path.join(dir, 'workflows.json'), '{"not":"an array"}');
            expect(findWorkflowPipelineById('any', dir)).toBeUndefined();
        });

        it('finds a workflow whose pipeline.id matches', () => {
            const dir = createWorkflowsDir([
                { id: '1', name: 'Other', pipeline: { id: 'other-id', name: 'Other', stages: [] } },
                { id: '2', name: 'Target', pipeline: { id: 'teleduct-deep', name: 'Teleduct Deep', stages: [] } },
            ]);
            const found = findWorkflowPipelineById('teleduct-deep', dir);
            expect(found).toBeDefined();
            expect(found!.name).toBe('Teleduct Deep');
        });

        it('returns undefined when no workflow has a matching pipeline.id', () => {
            const dir = createWorkflowsDir([
                { id: '1', name: 'Other', pipeline: { id: 'other-id', name: 'Other', stages: [] } },
            ]);
            expect(findWorkflowPipelineById('missing', dir)).toBeUndefined();
        });

        it('skips entries that have no pipeline field', () => {
            const dir = createWorkflowsDir([{ id: '1', name: 'No pipeline' }]);
            expect(findWorkflowPipelineById('1', dir)).toBeUndefined();
        });
    });

    describe('resolveDefaultPipeline', () => {
        it('returns undefined for empty / non-string ids', () => {
            expect(resolveDefaultPipeline('', undefined)).toBeUndefined();
            expect(resolveDefaultPipeline(undefined as any, undefined)).toBeUndefined();
            expect(resolveDefaultPipeline(null as any, undefined)).toBeUndefined();
        });

        it('resolves a built-in preset by id', () => {
            const result = resolveDefaultPipeline('deep-investigation', undefined);
            expect(result).toBeDefined();
            expect(result!.name).toBe('Deep Investigation');
            expect(result!.stages.length).toBeGreaterThan(0);
        });

        it('resolves a workflow id from workflows.json when no built-in matches', () => {
            const dir = createWorkflowsDir([
                { id: '1', name: 'Custom', pipeline: { id: 'my-custom', name: 'My Custom', stages: [] } },
            ]);
            const result = resolveDefaultPipeline('my-custom', dir);
            expect(result).toBeDefined();
            expect(result!.name).toBe('My Custom');
        });

        it('built-in preset wins over a workflow with the same id and warns', () => {
            const dir = createWorkflowsDir([
                {
                    id: '1',
                    name: 'Shadowed',
                    pipeline: { id: 'deep-investigation', name: 'Shadowed', stages: [] },
                },
            ]);
            const result = resolveDefaultPipeline('deep-investigation', dir);
            expect(result!.name).toBe('Deep Investigation');
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('shadowed by built-in'));
        });

        it('returns undefined and warns when neither builtin nor workflow matches', () => {
            const dir = createWorkflowsDir([]);
            const result = resolveDefaultPipeline('nope', dir);
            expect(result).toBeUndefined();
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No pipeline found'));
        });

        it('returns undefined and warns when investigationsPath is missing and id is not builtin', () => {
            const result = resolveDefaultPipeline('nope', undefined);
            expect(result).toBeUndefined();
            expect(warnSpy).toHaveBeenCalled();
        });
    });

    describe('matchDefaultPipelineId', () => {
        it('returns the preset id when the pipeline matches a builtin preset', () => {
            const pipeline = buildPipelinePreset('deep-investigation');
            expect(matchDefaultPipelineId(pipeline, undefined)).toBe('deep-investigation');
        });

        it('returns the workflow pipeline.id when the pipeline matches a saved workflow', () => {
            const dir = createWorkflowsDir([
                { id: '1', name: 'W', pipeline: { id: 'teleduct-deep', name: 'T', stages: [] } },
            ]);
            const pipeline = { id: 'teleduct-deep', name: 'T', stages: [] };
            expect(matchDefaultPipelineId(pipeline, dir)).toBe('teleduct-deep');
        });

        it('returns undefined for fully custom pipelines that match nothing', () => {
            const dir = createWorkflowsDir([]);
            const pipeline = { id: 'completely-custom', name: 'Custom', stages: [] };
            expect(matchDefaultPipelineId(pipeline, dir)).toBeUndefined();
        });

        it('returns undefined when pipeline has no id and is not a builtin', () => {
            const pipeline = { id: '', name: 'Anonymous', stages: [] };
            expect(matchDefaultPipelineId(pipeline, undefined)).toBeUndefined();
        });
    });
});
