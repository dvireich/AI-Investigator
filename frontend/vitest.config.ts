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
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/**/__tests__/**', 'src/main.tsx', 'src/types/**'],
            thresholds: {
                lines: 90,
                branches: 80,
                functions: 75,
                statements: 90,
            },
        },
    },
});
