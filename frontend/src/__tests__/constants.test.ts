import { describe, it, expect } from 'vitest';
import { TIME_PRESETS, INVESTIGATION_MODES, SCHEDULE_INTERVAL_PRESETS } from '../constants';

describe('constants', () => {
    describe('TIME_PRESETS', () => {
        it('has expected presets', () => {
            expect(TIME_PRESETS.length).toBeGreaterThan(0);
            expect(TIME_PRESETS[0]).toHaveProperty('label');
            expect(TIME_PRESETS[0]).toHaveProperty('value');
        });

        it('all values follow ago() format', () => {
            for (const preset of TIME_PRESETS) {
                expect(preset.value).toMatch(/^ago\(\d+[hdm]\)$/);
            }
        });
    });

    describe('INVESTIGATION_MODES', () => {
        it('has standard and incident modes', () => {
            const values = INVESTIGATION_MODES.map(m => m.value);
            expect(values).toContain('standard');
            expect(values).toContain('incident');
        });

        it('each mode has label, value, and description', () => {
            for (const mode of INVESTIGATION_MODES) {
                expect(mode.label).toBeTruthy();
                expect(mode.value).toBeTruthy();
                expect(mode.description).toBeTruthy();
            }
        });
    });

    describe('SCHEDULE_INTERVAL_PRESETS', () => {
        it('has numeric values in ascending order', () => {
            const values = SCHEDULE_INTERVAL_PRESETS.map(p => p.value);
            for (let i = 1; i < values.length; i++) {
                expect(values[i]).toBeGreaterThan(values[i - 1]);
            }
        });

        it('all values are positive numbers', () => {
            for (const preset of SCHEDULE_INTERVAL_PRESETS) {
                expect(preset.value).toBeGreaterThan(0);
            }
        });
    });
});
