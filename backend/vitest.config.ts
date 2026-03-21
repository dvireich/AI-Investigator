import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/__tests__/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: [
                'src/**/__tests__/**',
                'src/server.ts',           // Module-level side effects, integration-tested
                'src/**/index.ts',         // Barrel re-exports only
                'src/agent/llm/LlmProvider.ts',        // Interface/type definitions
                'src/agent/incidents/IncidentProvider.ts', // Interface/type definitions
            ],
            thresholds: {
                lines: 99,
                branches: 93,
                functions: 100,
                statements: 99,
            },
        },
    },
});
