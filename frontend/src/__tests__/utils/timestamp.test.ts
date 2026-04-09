import { describe, it, expect } from 'vitest';
import { parseFlexibleTimestamp, toDateTimeLocalValue, toDateTimeUTCValue, formatDateDisplayUTC, datetimeLocalToISO } from '../../utils/timestamp';

describe('timestamp utilities', () => {
    describe('parseFlexibleTimestamp', () => {
        it('parses ISO 8601 strings', () => {
            const result = parseFlexibleTimestamp('2024-03-15T14:30:00.000Z');
            expect(result).toBeInstanceOf(Date);
            expect(result!.toISOString()).toBe('2024-03-15T14:30:00.000Z');
        });

        it('returns null for invalid input', () => {
            expect(parseFlexibleTimestamp('not-a-date')).toBeNull();
        });
    });

    describe('toDateTimeLocalValue', () => {
        it('formats date using local time getters', () => {
            const date = new Date(2024, 2, 15, 14, 30); // March 15, 2024 14:30 local
            const result = toDateTimeLocalValue(date);
            expect(result).toBe('2024-03-15T14:30');
        });
    });

    describe('toDateTimeUTCValue', () => {
        it('formats date using UTC getters', () => {
            const date = new Date('2024-03-15T14:30:00.000Z');
            const result = toDateTimeUTCValue(date);
            expect(result).toBe('2024-03-15T14:30');
        });

        it('pads single digit months and hours', () => {
            const date = new Date('2024-01-05T03:07:00.000Z');
            const result = toDateTimeUTCValue(date);
            expect(result).toBe('2024-01-05T03:07');
        });
    });

    describe('formatDateDisplayUTC', () => {
        it('includes UTC suffix', () => {
            const date = new Date('2024-03-15T14:30:00.000Z');
            const result = formatDateDisplayUTC(date);
            expect(result).toContain('UTC');
        });

        it('displays the UTC time', () => {
            const date = new Date('2024-03-15T14:30:00.000Z');
            const result = formatDateDisplayUTC(date);
            // Should show time that corresponds to 14:30 UTC
            expect(result).toMatch(/2:30|14:30/);
        });
    });

    describe('datetimeLocalToISO', () => {
        it('treats value as UTC when utc=true', () => {
            const result = datetimeLocalToISO('2024-03-15T14:30', true);
            expect(result).toBe('2024-03-15T14:30:00.000Z');
        });

        it('treats value as local time when utc=false', () => {
            const result = datetimeLocalToISO('2024-03-15T14:30', false);
            // The result should be a valid ISO string, converted from local
            const parsed = new Date(result);
            expect(parsed.getHours()).toBe(14);
            expect(parsed.getMinutes()).toBe(30);
        });
    });
});
