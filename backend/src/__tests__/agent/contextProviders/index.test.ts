import { describe, it, expect } from 'vitest';
import { getContextProvider, CONTEXT_PROVIDERS } from '../../../agent/contextProviders';
import { InvestigationState } from '../../../agent/Runner';

describe('getContextProvider', () => {
    it('returns default provider when kind is undefined', () => {
        const provider = getContextProvider(undefined);
        const ctx = provider({ goal: 'g' });
        expect(ctx.goal).toBe('g');
    });

    it('returns default provider for unregistered kinds', () => {
        const provider = getContextProvider('custom');
        const ctx = provider({ goal: 'x' });
        expect(ctx.goal).toBe('x');
    });

    it('returns a kind-specific provider when registered', () => {
        const provider = getContextProvider('notes-rephraser');
        expect(provider).toBe(CONTEXT_PROVIDERS['notes-rephraser']);
    });
});

describe('default provider', () => {
    const provider = getContextProvider('custom');

    it('falls back to investigation fields when rawInput lacks them', () => {
        const inv = {
            query: 'inv-goal', target: 't', category: 'c', status: 'running',
            verdict: 'healthy', finalReport: 'report-text',
        } as Partial<InvestigationState> as InvestigationState;
        const ctx = provider({}, inv);
        expect(ctx.goal).toBe('inv-goal');
        expect(ctx.target).toBe('t');
        expect(ctx.category).toBe('c');
        expect(ctx.status).toBe('running');
        expect(ctx.verdict).toBe('healthy');
        expect(ctx.report).toBe('report-text');
    });

    it('prefers rawInput over investigation fields', () => {
        const ctx = provider(
            { goal: 'raw-goal', report: 'raw-report' },
            { query: 'inv-goal', finalReport: 'inv-rep' } as InvestigationState,
        );
        expect(ctx.goal).toBe('raw-goal');
        expect(ctx.report).toBe('raw-report');
    });

    it('forwards extra string keys via custom map', () => {
        const ctx = provider({ goal: 'g', myKey: 'myVal', anotherKey: 'x' });
        expect(ctx.custom).toEqual({ myKey: 'myVal', anotherKey: 'x' });
    });

    it('omits custom when no extra keys', () => {
        const ctx = provider({ goal: 'g' });
        expect(ctx.custom).toBeUndefined();
    });

    it('skips non-string extra fields', () => {
        const ctx = provider({ goal: 'g', numField: 42, objField: { a: 1 } });
        expect(ctx.custom).toBeUndefined();
    });

    it('ignores non-string standard fields', () => {
        const ctx = provider({ goal: 42 as any });
        expect(ctx.goal).toBeUndefined();
    });
});

describe('recommendation-extractor provider', () => {
    const provider = getContextProvider('recommendation-extractor');

    it('uses report from rawInput first', () => {
        const ctx = provider({ report: 'r1' });
        expect(ctx.report).toBe('r1');
    });

    it('falls back to investigation.finalReport', () => {
        const ctx = provider({}, { finalReport: 'inv-r' } as InvestigationState);
        expect(ctx.report).toBe('inv-r');
    });

    it('defaults to empty string when no report', () => {
        const ctx = provider({});
        expect(ctx.report).toBe('');
    });

    it('also propagates goal/target', () => {
        const ctx = provider({ goal: 'g', target: 't' });
        expect(ctx.goal).toBe('g');
        expect(ctx.target).toBe('t');
    });
});

describe('code-implementer provider', () => {
    const provider = getContextProvider('code-implementer');

    it('uses recommendationsJson from rawInput when present', () => {
        const ctx = provider({ recommendationsJson: '[{"x":1}]' });
        expect(ctx.recommendationsJson).toBe('[{"x":1}]');
    });

    it('serializes recommendations array from rawInput', () => {
        const ctx = provider({ recommendations: [{ id: '1', priority: 'P0' }] });
        expect(JSON.parse(ctx.recommendationsJson!)).toEqual([{ id: '1', priority: 'P0' }]);
    });

    it('serializes investigation.recommendations when not in rawInput', () => {
        const ctx = provider(
            {},
            { recommendations: [{ id: 'a', priority: 'P1', title: 't', description: 'd', category: 'code' }] } as InvestigationState,
        );
        expect(JSON.parse(ctx.recommendationsJson!)).toHaveLength(1);
    });

    it('defaults to empty JSON array string when no recommendations anywhere', () => {
        const ctx = provider({});
        expect(ctx.recommendationsJson).toBe('[]');
    });

    it('propagates investigation context fields', () => {
        const ctx = provider(
            {},
            { query: 'q', target: 't', category: 'c', verdict: 'critical', finalReport: 'r' } as InvestigationState,
        );
        expect(ctx.goal).toBe('q');
        expect(ctx.target).toBe('t');
        expect(ctx.category).toBe('c');
        expect(ctx.verdict).toBe('critical');
        expect(ctx.report).toBe('r');
    });
});

describe('kb-improver provider', () => {
    const provider = getContextProvider('kb-improver');

    it('forwards knowledgeBaseFiles when supplied', () => {
        const ctx = provider({ knowledgeBaseFiles: 'a.md\nb.md' });
        expect(ctx.knowledgeBaseFiles).toBe('a.md\nb.md');
    });

    it('defaults to empty string', () => {
        const ctx = provider({});
        expect(ctx.knowledgeBaseFiles).toBe('');
    });

    it('uses investigation context when raw is empty', () => {
        const ctx = provider({}, {
            query: 'q', target: 't', category: 'c', status: 'completed',
        } as InvestigationState);
        expect(ctx.goal).toBe('q');
        expect(ctx.status).toBe('completed');
    });
});

describe('executive-report provider', () => {
    const provider = getContextProvider('executive-report');

    it('forwards all schedule fields', () => {
        const ctx = provider({
            scheduleName: 'sn', scheduleTarget: 'st',
            scheduleStatsTable: 'sst', scheduleHistoryDigest: 'shd',
        });
        expect(ctx.scheduleName).toBe('sn');
        expect(ctx.scheduleTarget).toBe('st');
        expect(ctx.scheduleStatsTable).toBe('sst');
        expect(ctx.scheduleHistoryDigest).toBe('shd');
    });

    it('defaults all fields to empty', () => {
        const ctx = provider({});
        expect(ctx.scheduleName).toBe('');
        expect(ctx.scheduleTarget).toBe('');
        expect(ctx.scheduleStatsTable).toBe('');
        expect(ctx.scheduleHistoryDigest).toBe('');
    });
});

describe('notes-rephraser provider', () => {
    const provider = getContextProvider('notes-rephraser');

    it('uses notesText when supplied', () => {
        const ctx = provider({ notesText: 'hello' });
        expect(ctx.notesText).toBe('hello');
    });

    it('falls back to text alias', () => {
        const ctx = provider({ text: 'world' });
        expect(ctx.notesText).toBe('world');
    });

    it('defaults to empty string', () => {
        const ctx = provider({});
        expect(ctx.notesText).toBe('');
    });
});
