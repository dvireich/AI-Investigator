import { describe, it, expect } from 'vitest';

describe('backend barrel and interface modules', () => {
    it('loads llm provider interface module', async () => {
        const module = await import('../agent/llm/LlmProvider');
        expect(module).toBeDefined();
    });

    it('loads incident provider interface module', async () => {
        const module = await import('../agent/incidents/IncidentProvider');
        expect(module).toBeDefined();
    });

    it('loads llm barrel module', async () => {
        const module = await import('../agent/llm');
        expect(module.LlmProviderRegistry).toBeDefined();
    });

    it('loads incident barrel module', async () => {
        const module = await import('../agent/incidents');
        expect(module.IncidentProviderRegistry).toBeDefined();
    });

    it('loads tools barrel module', async () => {
        const module = await import('../agent/tools');
        expect(module.ToolManager).toBeDefined();
    });
});