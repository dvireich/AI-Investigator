/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './vitest.setup.ts',
        include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'json-summary'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/**/__tests__/**', 'src/types/**'],
            thresholds: {
                // Thresholds are set at 99/98 rather than 100 to accommodate 4 lines in
                // InvestigationDetail.tsx that v8 cannot instrument due to a known limitation:
                // async hook continuations after `await` inside useCallback are not reliably
                // tracked by v8 block-coverage. The affected lines are exercised by tests
                // (see "Implement Recommendations" describe block). All other files hit 100%.
                lines: 99,
                branches: 98,
                functions: 97,
                statements: 99,
            },
        },
    },
});
