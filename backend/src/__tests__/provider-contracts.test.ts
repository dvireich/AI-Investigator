import { describe, expect, it } from 'vitest';
import { isLlmProvider } from '../agent/llm/LlmProvider';
import { isIncidentProvider } from '../agent/incidents/IncidentProvider';

describe('provider contract modules', () => {
    it('validates runtime provider contract guards', () => {
        expect(isLlmProvider(null)).toBe(false);
        expect(isLlmProvider({
            type: 'fake',
            displayName: 'Fake',
            getAuthRequirement: () => ({ type: 'none' }),
            configure: () => {},
            getAuthStatus: async () => ({ authenticated: true }),
            getClient: async () => ({}) as any,
            listModels: async () => ['model-a'],
        })).toBe(true);

        expect(isIncidentProvider(undefined)).toBe(false);
        expect(isIncidentProvider({
            type: 'fake',
            displayName: 'Fake',
            isAvailable: async () => true,
            configure: () => {},
            fetchIncident: async () => ({ id: 'INC', title: 'Incident' }),
        })).toBe(true);
    });
});
