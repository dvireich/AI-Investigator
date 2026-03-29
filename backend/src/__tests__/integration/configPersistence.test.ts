/**
 * Integration tests that validate configuration persistence round-trips.
 *
 * These tests POST settings via the API, read the resulting config.json from
 * disk, and verify every expected key is present and correct.  They catch
 * silent key-dropping bugs caused by ALLOWED_KEYS / config-type drift.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import {
    __testUtils,
    loadConfigFromDisk,
} from '../../server';

const defaultConfig = JSON.parse(JSON.stringify(__testUtils.getConfig()));
const defaultPersistedConfig = JSON.parse(JSON.stringify(__testUtils.getPersistedConfig()));
const api = () => request(__testUtils.app);
const backendConfigFile = path.resolve(process.cwd(), 'config.json');

/** Read the persisted config.json from disk. */
function readDiskConfig(): Record<string, any> {
    return JSON.parse(fs.readFileSync(backendConfigFile, 'utf-8'));
}

describe('config persistence round-trip', () => {
    let originalConfig: string;

    beforeEach(() => {
        originalConfig = fs.readFileSync(backendConfigFile, 'utf-8');
        __testUtils.resetRuntimeState();
        __testUtils.setConfig(JSON.parse(JSON.stringify(defaultConfig)));
        __testUtils.setPersistedConfig(JSON.parse(JSON.stringify(defaultPersistedConfig)));
    });

    afterEach(() => {
        // Always restore the original config file
        fs.writeFileSync(backendConfigFile, originalConfig);
        __testUtils.setConfig(JSON.parse(JSON.stringify(defaultConfig)));
        __testUtils.setPersistedConfig(JSON.parse(JSON.stringify(defaultPersistedConfig)));
    });

    // ─── Round-trip: every user-facing ALLOWED_KEY ────────────────────

    it('every ALLOWED_KEY round-trips through POST → disk → load', async () => {
        // A payload containing one representative value for every non-path ALLOWED_KEY.
        // Path keys (repoRoot, workingDirectory, etc.) are INTERNAL_DEFAULT_KEYS and
        // only persist when already present in the file, so we skip them here.
        const payload: Record<string, any> = {
            mcpServers: [{ name: 'test', command: 'echo' }],
            maxSteps: 99,
            retrospectTimeoutMinutes: 42,
            model: 'test-model',
            defaultTimeRange: 'ago(2h)',
            maxConcurrentInvestigations: 5,
            maxConcurrentScheduledInvestigations: 4,
            scheduledInvestigationMaxSteps: 77,
            scheduledInvestigationRetentionCount: 15,
            scheduledReportModel: 'gpt-mini',
            autoRefreshInterval: 60,
            notifications: false,
            notifEnabled: false,
            notifSound: false,
            notifEvents: ['failed'],
            activeProductId: 'test-product',
            llmProvider: { type: 'copilot' },
            incidentProvider: { type: 'manual' },
            defaultView: 'list',
            defaultSortOrder: 'oldest',
            defaultPageSize: 24,
            analyticsWidgets: ['duration', 'modelUsage', 'contestRate'],
            analyticsVisible: false,
        };

        const res = await api().post('/api/settings').send(payload);
        expect(res.status).toBe(200);

        // Verify every key in the payload appears in the response
        for (const [key, value] of Object.entries(payload)) {
            expect(res.body).toHaveProperty(key);
            expect(res.body[key]).toEqual(value);
        }

        // Verify the values were actually written to disk
        const disk = readDiskConfig();
        for (const [key, value] of Object.entries(payload)) {
            expect(disk).toHaveProperty(key, value);
        }
    });

    // ─── scheduledInvestigationMaxSteps specifically ─────────────────

    it('scheduledInvestigationMaxSteps persists and survives reload', async () => {
        const res = await api().post('/api/settings').send({ scheduledInvestigationMaxSteps: 50 });
        expect(res.status).toBe(200);
        expect(res.body.scheduledInvestigationMaxSteps).toBe(50);

        // Verify on disk
        const disk = readDiskConfig();
        expect(disk.scheduledInvestigationMaxSteps).toBe(50);

        // Simulate server restart: reload config from disk
        const configDir = path.dirname(backendConfigFile);
        const reloaded = loadConfigFromDisk(backendConfigFile, defaultConfig as any, configDir);
        expect(reloaded.config.scheduledInvestigationMaxSteps).toBe(50);
    });

    // ─── Analytics preferences ───────────────────────────────────────

    it('analytics preferences persist and survive reload', async () => {
        const widgets = ['duration', 'modelUsage', 'contestRate'];
        const res = await api().post('/api/settings').send({
            analyticsWidgets: widgets,
            analyticsVisible: false,
        });
        expect(res.status).toBe(200);
        expect(res.body.analyticsWidgets).toEqual(widgets);
        expect(res.body.analyticsVisible).toBe(false);

        // Verify on disk
        const disk = readDiskConfig();
        expect(disk.analyticsWidgets).toEqual(widgets);
        expect(disk.analyticsVisible).toBe(false);

        // Simulate reload
        const configDir = path.dirname(backendConfigFile);
        const reloaded = loadConfigFromDisk(backendConfigFile, defaultConfig as any, configDir);
        expect(reloaded.config.analyticsWidgets).toEqual(widgets);
        expect(reloaded.config.analyticsVisible).toBe(false);
    });

    // ─── Export includes all persisted settings ──────────────────────

    it('export includes all previously saved settings', async () => {
        // Save a distinctive set of values
        await api().post('/api/settings').send({
            model: 'export-test-model',
            scheduledInvestigationMaxSteps: 33,
            analyticsWidgets: ['categories', 'verdictBreakdown', 'contestRate'],
            analyticsVisible: true,
            defaultPageSize: 50,
        });

        const exportRes = await api().get('/api/settings/export');
        expect(exportRes.status).toBe(200);
        expect(exportRes.body.model).toBe('export-test-model');
        expect(exportRes.body.scheduledInvestigationMaxSteps).toBe(33);
        expect(exportRes.body.analyticsWidgets).toEqual(['categories', 'verdictBreakdown', 'contestRate']);
        expect(exportRes.body.analyticsVisible).toBe(true);
        expect(exportRes.body.defaultPageSize).toBe(50);
    });

    // ─── Import → disk round-trip ────────────────────────────────────

    it('import writes all valid keys to disk', async () => {
        const importPayload = {
            model: 'imported-model',
            maxSteps: 42,
            scheduledInvestigationMaxSteps: 88,
            analyticsWidgets: ['trend', 'categories', 'successRate'],
            analyticsVisible: false,
            defaultPageSize: 36,
            defaultView: 'list',
            unknownKey: 'should-be-dropped', // not in ALLOWED_KEYS
        };

        const res = await api().post('/api/settings/import').send(importPayload);
        expect(res.status).toBe(200);
        // unknownKey should have been filtered out
        expect(res.body.config.unknownKey).toBeUndefined();

        // Verify disk
        const disk = readDiskConfig();
        expect(disk.model).toBe('imported-model');
        expect(disk.maxSteps).toBe(42);
        expect(disk.scheduledInvestigationMaxSteps).toBe(88);
        expect(disk.analyticsWidgets).toEqual(['trend', 'categories', 'successRate']);
        expect(disk.analyticsVisible).toBe(false);
        expect(disk.defaultPageSize).toBe(36);
        expect(disk.defaultView).toBe('list');
        expect(disk.unknownKey).toBeUndefined();
    });

    // ─── Structural: config type ↔ ALLOWED_KEYS sync ────────────────

    it('SETTINGS_ALLOWED_KEYS covers every non-internal config key', () => {
        const allowedKeys = __testUtils.SETTINGS_ALLOWED_KEYS;

        // Keys that are internal/auto-resolved and intentionally excluded from ALLOWED_KEYS
        const internalKeys = new Set([
            'retrospectPromptPath', // auto-resolved, never persisted
            'repoRoot',             // INTERNAL_DEFAULT_KEY (still in ALLOWED for manual override)
            'workingDirectory',     // INTERNAL_DEFAULT_KEY (still in ALLOWED for manual override)
            'systemPromptPath',     // INTERNAL_DEFAULT_KEY (still in ALLOWED for manual override)
            'knowledgeBasePath',    // INTERNAL_DEFAULT_KEY (still in ALLOWED for manual override)
            'investigationsPath',   // INTERNAL_DEFAULT_KEY (still in ALLOWED for manual override)
        ]);

        // Get all keys from the runtime config (which has the full type shape)
        const configKeys = Object.keys(__testUtils.getConfig());

        // Every config key should be in ALLOWED_KEYS or in the internal exclusion list
        const missingKeys = configKeys.filter(
            k => !allowedKeys.has(k) && !internalKeys.has(k)
        );

        expect(missingKeys).toEqual([]);
    });

    it('every SETTINGS_ALLOWED_KEY maps to a real config key or is a known extension', () => {
        const allowedKeys = Array.from(__testUtils.SETTINGS_ALLOWED_KEYS);
        const configKeys = new Set(Object.keys(__testUtils.getConfig()));

        // All allowed keys should either exist in the config or be documented extensions
        const orphanKeys = allowedKeys.filter(k => !configKeys.has(k));
        expect(orphanKeys).toEqual([]);
    });
});
