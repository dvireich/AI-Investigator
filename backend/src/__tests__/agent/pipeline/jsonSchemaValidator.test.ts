import { describe, it, expect } from 'vitest';
import { validateAgainstSchema, extractFirstJson } from '../../../agent/pipeline/jsonSchemaValidator';

describe('validateAgainstSchema', () => {
    it('passes when schema is undefined', () => {
        const r = validateAgainstSchema({ any: 'thing' }, undefined);
        expect(r.valid).toBe(true);
        expect(r.errors).toEqual([]);
    });

    it('passes when schema is empty object', () => {
        const r = validateAgainstSchema('hello', {});
        expect(r.valid).toBe(true);
    });

    it('checks string type', () => {
        const r = validateAgainstSchema(42, { type: 'string' });
        expect(r.valid).toBe(false);
        expect(r.errors[0].message).toContain('expected string');
        expect(r.errors[0].path).toBe('root');
    });

    it('checks number type', () => {
        const r = validateAgainstSchema('not a number', { type: 'number' });
        expect(r.valid).toBe(false);
        expect(r.errors[0].message).toContain('expected number');
    });

    it('checks boolean type', () => {
        const r = validateAgainstSchema('false', { type: 'boolean' });
        expect(r.valid).toBe(false);
    });

    it('passes valid boolean', () => {
        const r = validateAgainstSchema(false, { type: 'boolean' });
        expect(r.valid).toBe(true);
    });

    it('passes valid integer', () => {
        const r = validateAgainstSchema(7, { type: 'integer' });
        expect(r.valid).toBe(true);
    });

    it('rejects float for integer type', () => {
        const r = validateAgainstSchema(1.5, { type: 'integer' });
        expect(r.valid).toBe(false);
        expect(r.errors[0].message).toContain('expected integer');
    });

    it('rejects string for integer type', () => {
        const r = validateAgainstSchema('1', { type: 'integer' });
        expect(r.valid).toBe(false);
    });

    it('detects null as null', () => {
        const r = validateAgainstSchema(null, { type: 'null' });
        expect(r.valid).toBe(true);
    });

    it('rejects null when type is string', () => {
        const r = validateAgainstSchema(null, { type: 'string' });
        expect(r.valid).toBe(false);
        expect(r.errors[0].message).toContain('got null');
    });

    it('validates array items', () => {
        const r = validateAgainstSchema([1, 2, 'oops'], {
            type: 'array',
            items: { type: 'number' },
        });
        expect(r.valid).toBe(false);
        expect(r.errors[0].path).toBe('root[2]');
    });

    it('passes valid array', () => {
        const r = validateAgainstSchema([1, 2, 3], {
            type: 'array',
            items: { type: 'number' },
        });
        expect(r.valid).toBe(true);
    });

    it('validates required object properties', () => {
        const r = validateAgainstSchema({ a: 1 }, {
            type: 'object',
            required: ['a', 'b'],
        });
        expect(r.valid).toBe(false);
        expect(r.errors[0].path).toBe('root.b');
        expect(r.errors[0].message).toContain('missing required');
    });

    it('validates property schemas', () => {
        const r = validateAgainstSchema({ name: 42 }, {
            type: 'object',
            properties: { name: { type: 'string' } },
        });
        expect(r.valid).toBe(false);
        expect(r.errors[0].path).toBe('root.name');
    });

    it('validates enum values', () => {
        const r = validateAgainstSchema('purple', {
            type: 'string',
            enum: ['red', 'blue'],
        });
        expect(r.valid).toBe(false);
        expect(r.errors[0].message).toContain('not in enum');
    });

    it('passes valid enum', () => {
        const r = validateAgainstSchema('red', {
            type: 'string',
            enum: ['red', 'blue'],
        });
        expect(r.valid).toBe(true);
    });

    it('validates nested arrays of objects with required + enum', () => {
        const schema = {
            type: 'array',
            items: {
                type: 'object',
                required: ['priority', 'title'],
                properties: {
                    priority: { type: 'string', enum: ['P0', 'P1'] },
                    title: { type: 'string' },
                },
            },
        };
        const r = validateAgainstSchema([
            { priority: 'P0', title: 'ok' },
            { priority: 'P9', title: 'bad' }, // bad enum
            { title: 'no-priority' },           // missing required
        ], schema);
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => e.path === 'root[1].priority')).toBe(true);
        expect(r.errors.some(e => e.path === 'root[2].priority')).toBe(true);
    });

    it('skips items validation when value is not an array', () => {
        const r = validateAgainstSchema('not array', { type: 'array', items: { type: 'string' } });
        expect(r.valid).toBe(false);
        expect(r.errors[0].message).toContain('expected array');
    });

    it('skips required when value is not an object', () => {
        const r = validateAgainstSchema('not obj', { type: 'object', required: ['x'] });
        expect(r.valid).toBe(false);
        expect(r.errors[0].message).toContain('expected object');
    });

    it('skips properties recursion when value is array', () => {
        // array values should not trigger properties recursion
        const r = validateAgainstSchema([1, 2], { properties: { foo: { type: 'string' } } });
        expect(r.valid).toBe(true);
    });

    it('reports correct js typeof for symbols', () => {
        const r = validateAgainstSchema(Symbol('x'), { type: 'string' });
        expect(r.valid).toBe(false);
        expect(r.errors[0].message).toContain('symbol');
    });
});

describe('extractFirstJson', () => {
    it('returns undefined for empty input', () => {
        expect(extractFirstJson('')).toBeUndefined();
    });

    it('parses pure JSON object', () => {
        expect(extractFirstJson('{"a":1}')).toEqual({ a: 1 });
    });

    it('parses pure JSON array', () => {
        expect(extractFirstJson('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('strips ```json fences', () => {
        const raw = '```json\n[{"x":1}]\n```';
        expect(extractFirstJson(raw)).toEqual([{ x: 1 }]);
    });

    it('strips bare ``` fences', () => {
        const raw = '```\n{"y":2}\n```';
        expect(extractFirstJson(raw)).toEqual({ y: 2 });
    });

    it('extracts array embedded in prose', () => {
        const raw = 'Here you go:\n[1, 2, 3]\nThanks!';
        expect(extractFirstJson(raw)).toEqual([1, 2, 3]);
    });

    it('extracts object embedded in prose', () => {
        const raw = 'Result: {"ok": true}';
        expect(extractFirstJson(raw)).toEqual({ ok: true });
    });

    it('returns undefined for unparseable text', () => {
        expect(extractFirstJson('no json here')).toBeUndefined();
    });

    it('returns undefined when array regex matches but JSON.parse fails', () => {
        // Has [ and ] so arrayMatch hits, but contents are not valid JSON
        expect(extractFirstJson('[unparseable content]')).toBeUndefined();
    });

    it('returns undefined when object regex matches but JSON.parse fails', () => {
        // Has { and } so objectMatch hits, but contents are not valid JSON
        expect(extractFirstJson('{not: valid json}')).toBeUndefined();
    });

    it('returns undefined when fenced content is malformed', () => {
        expect(extractFirstJson('```json\nnot real json\n```')).toBeUndefined();
    });
});
