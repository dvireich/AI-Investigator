import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentLibrary } from '../../components/AgentLibrary';
import type { AgentDefinition } from '../../types/pipeline';

// ── Mock api module ─────────────────────────────────────────────────

const mockGetSavedAgents = vi.fn().mockResolvedValue([]);
const mockDeleteSavedAgent = vi.fn().mockResolvedValue(undefined);

vi.mock('../../api', () => ({
    api: {
        getSavedAgents: (...args: unknown[]) => mockGetSavedAgents(...args),
        deleteSavedAgent: (...args: unknown[]) => mockDeleteSavedAgent(...args),
    },
}));

// ── Test data ───────────────────────────────────────────────────────

const BUILTIN_AGENTS: AgentDefinition[] = [
    {
        id: 'builtin-investigator',
        name: 'Investigator',
        source: 'builtin',
        builtinType: 'investigator',
        description: 'Runs the main investigation loop with full tool access.',
        color: '#10b981',
        icon: '🤖',
    },
    {
        id: 'builtin-validator',
        name: 'Validator',
        source: 'builtin',
        builtinType: 'validator',
        description: 'Reviews findings for accuracy and completeness.',
        color: '#f59e0b',
        icon: '🛡️',
        tools: { mode: 'whitelist', list: ['read_file', 'list_dir'] },
    },
    {
        id: 'builtin-planner',
        name: 'Planner',
        source: 'builtin',
        builtinType: 'planner',
        description: 'Produces a structured investigation plan.',
        color: '#0ea5e9',
        icon: '📋',
        tools: { mode: 'whitelist', list: ['read_file'] },
        model: 'gpt-4-turbo',
        maxSteps: 10,
    },
];

const SAVED_AGENTS = [
    {
        id: 'sa-1',
        agent: {
            id: 'custom-scanner',
            name: 'Custom Scanner',
            source: 'inline' as const,
            description: 'A custom scanner agent',
            color: '#ef4444',
            icon: '🔥',
        },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
    },
];

// ── Helpers ──────────────────────────────────────────────────────────

function renderLibrary(props: Partial<React.ComponentProps<typeof AgentLibrary>> = {}) {
    return render(
        <AgentLibrary builtinAgents={BUILTIN_AGENTS} {...props} />,
    );
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AgentLibrary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSavedAgents.mockResolvedValue([]);
    });

    it('renders header with agent counts', async () => {
        renderLibrary();
        expect(screen.getByText('Agent Library')).toBeInTheDocument();
        expect(screen.getByText(/3 built-in/)).toBeInTheDocument();
        expect(screen.getByText(/0 custom/)).toBeInTheDocument();
    });

    it('renders all builtin agent cards', () => {
        renderLibrary();
        expect(screen.getByText('Investigator')).toBeInTheDocument();
        expect(screen.getByText('Validator')).toBeInTheDocument();
        expect(screen.getByText('Planner')).toBeInTheDocument();
    });

    it('shows agent descriptions on cards', () => {
        renderLibrary();
        expect(screen.getByText('Runs the main investigation loop with full tool access.')).toBeInTheDocument();
        expect(screen.getByText('Reviews findings for accuracy and completeness.')).toBeInTheDocument();
    });

    it('shows tool summary pills', () => {
        renderLibrary();
        expect(screen.getByText('All tools')).toBeInTheDocument();
        expect(screen.getByText('2 tools (whitelist)')).toBeInTheDocument();
        expect(screen.getByText('1 tool (whitelist)')).toBeInTheDocument();
    });

    it('shows model and maxSteps pills when present', () => {
        renderLibrary();
        expect(screen.getByText('gpt-4-turbo')).toBeInTheDocument();
        expect(screen.getByText('10 steps')).toBeInTheDocument();
    });

    it('shows builtinType pills', () => {
        renderLibrary();
        expect(screen.getByText('investigator')).toBeInTheDocument();
        expect(screen.getByText('validator')).toBeInTheDocument();
        expect(screen.getByText('planner')).toBeInTheDocument();
    });

    it('displays saved agents from API', async () => {
        mockGetSavedAgents.mockResolvedValue(SAVED_AGENTS);
        renderLibrary();
        await waitFor(() => {
            expect(screen.getByText('Custom Scanner')).toBeInTheDocument();
        });
        expect(screen.getByText('A custom scanner agent')).toBeInTheDocument();
        expect(screen.getByText(/1 custom/)).toBeInTheDocument();
    });

    it('filters agents by search text', () => {
        renderLibrary();
        const searchInput = screen.getByPlaceholderText(/Search agents/);
        fireEvent.change(searchInput, { target: { value: 'Investigator' } });
        expect(screen.getByText('Investigator')).toBeInTheDocument();
        expect(screen.queryByText('Validator')).not.toBeInTheDocument();
        expect(screen.queryByText('Planner')).not.toBeInTheDocument();
    });

    it('filters agents by description text', () => {
        renderLibrary();
        const searchInput = screen.getByPlaceholderText(/Search agents/);
        fireEvent.change(searchInput, { target: { value: 'accuracy' } });
        expect(screen.getByText('Validator')).toBeInTheDocument();
        expect(screen.queryByText('Investigator')).not.toBeInTheDocument();
    });

    it('shows empty state when no agents match search', () => {
        renderLibrary();
        const searchInput = screen.getByPlaceholderText(/Search agents/);
        fireEvent.change(searchInput, { target: { value: 'nonexistent-xyz' } });
        expect(screen.getByText(/No agents match "nonexistent-xyz"/)).toBeInTheDocument();
    });

    it('filters by Built-in tab', () => {
        mockGetSavedAgents.mockResolvedValue(SAVED_AGENTS);
        renderLibrary();
        fireEvent.click(screen.getByText('Built-in'));
        expect(screen.getByText('Investigator')).toBeInTheDocument();
        // Custom Scanner should be hidden
        expect(screen.queryByText('Custom Scanner')).not.toBeInTheDocument();
    });

    it('filters by Custom tab', async () => {
        mockGetSavedAgents.mockResolvedValue(SAVED_AGENTS);
        renderLibrary();
        await waitFor(() => {
            expect(screen.getByText('Custom Scanner')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('Custom'));
        expect(screen.getByText('Custom Scanner')).toBeInTheDocument();
        expect(screen.queryByText('Investigator')).not.toBeInTheDocument();
    });

    it('resets to All filter', async () => {
        mockGetSavedAgents.mockResolvedValue(SAVED_AGENTS);
        renderLibrary();
        await waitFor(() => {
            expect(screen.getByText('Custom Scanner')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('Custom'));
        expect(screen.queryByText('Investigator')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('All'));
        expect(screen.getByText('Investigator')).toBeInTheDocument();
        expect(screen.getByText('Custom Scanner')).toBeInTheDocument();
    });

    it('opens detail modal when Eye button is clicked', async () => {
        renderLibrary();
        const viewButtons = screen.getAllByTitle('View details');
        fireEvent.click(viewButtons[0]);
        // BuiltinDetailModal should show — check for description in modal context
        await waitFor(() => {
            expect(screen.getByText('Built-in Agent')).toBeInTheDocument();
        });
    });

    it('closes detail modal', async () => {
        renderLibrary();
        const viewButtons = screen.getAllByTitle('View details');
        fireEvent.click(viewButtons[0]);
        await waitFor(() => {
            expect(screen.getByText('Built-in Agent')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('Close'));
        await waitFor(() => {
            expect(screen.queryByText('Built-in Agent')).not.toBeInTheDocument();
        });
    });

    it('deletes a saved agent', async () => {
        mockGetSavedAgents.mockResolvedValue(SAVED_AGENTS);
        mockDeleteSavedAgent.mockResolvedValue(undefined);
        renderLibrary();
        await waitFor(() => {
            expect(screen.getByText('Custom Scanner')).toBeInTheDocument();
        });
        const deleteButton = screen.getByTitle('Delete agent');
        fireEvent.click(deleteButton);
        await waitFor(() => {
            expect(mockDeleteSavedAgent).toHaveBeenCalledWith('sa-1');
        });
        expect(screen.queryByText('Custom Scanner')).not.toBeInTheDocument();
    });

    it('does not show delete button for builtin agents', () => {
        renderLibrary();
        expect(screen.queryByTitle('Delete agent')).not.toBeInTheDocument();
    });

    it('shows New Agent button when onCreateAgent is provided', () => {
        const onCreateAgent = vi.fn();
        renderLibrary({ onCreateAgent });
        const btn = screen.getByText('New Agent');
        fireEvent.click(btn);
        expect(onCreateAgent).toHaveBeenCalledOnce();
    });

    it('does not show New Agent button when onCreateAgent is absent', () => {
        renderLibrary();
        expect(screen.queryByText('New Agent')).not.toBeInTheDocument();
    });

    it('shows results count', () => {
        renderLibrary();
        expect(screen.getByText('3 agents')).toBeInTheDocument();
    });

    it('shows singular agent count', async () => {
        renderLibrary();
        const searchInput = screen.getByPlaceholderText(/Search agents/);
        fireEvent.change(searchInput, { target: { value: 'Investigator' } });
        expect(screen.getByText(/^1 agent\b/)).toBeInTheDocument();
    });

    it('shows search text in results count', () => {
        renderLibrary();
        const searchInput = screen.getByPlaceholderText(/Search agents/);
        fireEvent.change(searchInput, { target: { value: 'test' } });
        expect(screen.getByText(/matching "test"/)).toBeInTheDocument();
    });

    it('handles getSavedAgents failure gracefully', async () => {
        mockGetSavedAgents.mockRejectedValue(new Error('Network error'));
        renderLibrary();
        // Should still render builtin agents
        expect(screen.getByText('Investigator')).toBeInTheDocument();
    });

    it('handles deleteSavedAgent failure gracefully', async () => {
        mockGetSavedAgents.mockResolvedValue(SAVED_AGENTS);
        mockDeleteSavedAgent.mockRejectedValue(new Error('Delete failed'));
        renderLibrary();
        await waitFor(() => {
            expect(screen.getByText('Custom Scanner')).toBeInTheDocument();
        });
        const deleteButton = screen.getByTitle('Delete agent');
        fireEvent.click(deleteButton);
        // Agent should remain since delete failed
        await waitFor(() => {
            expect(mockDeleteSavedAgent).toHaveBeenCalledWith('sa-1');
        });
        expect(screen.getByText('Custom Scanner')).toBeInTheDocument();
    });

    it('shows "No description" for agents without description', () => {
        const agent: AgentDefinition = {
            id: 'no-desc',
            name: 'No Desc Agent',
            source: 'builtin',
        };
        renderLibrary({ builtinAgents: [agent] });
        expect(screen.getByText('No description')).toBeInTheDocument();
    });

    it('shows source labels correctly', async () => {
        mockGetSavedAgents.mockResolvedValue(SAVED_AGENTS);
        renderLibrary();
        await waitFor(() => {
            expect(screen.getByText('Custom Scanner')).toBeInTheDocument();
        });
        // Builtin agents have "⚡ Built-in" label
        const builtinLabels = screen.getAllByText(/Built-in/);
        expect(builtinLabels.length).toBeGreaterThan(0);
    });

    it('paginates when more than 12 agents exist', () => {
        const manyAgents: AgentDefinition[] = Array.from({ length: 15 }, (_, i) => ({
            id: `agent-${i}`,
            name: `Agent ${i}`,
            source: 'builtin' as const,
            builtinType: `type-${i}`,
            description: `Description for agent ${i}`,
        }));
        renderLibrary({ builtinAgents: manyAgents });
        // Should show 12 on first page
        expect(screen.getByText('Agent 0')).toBeInTheDocument();
        expect(screen.getByText('Agent 11')).toBeInTheDocument();
        expect(screen.queryByText('Agent 12')).not.toBeInTheDocument();
        // Pagination should be visible
        expect(screen.getByText('1/2')).toBeInTheDocument();
    });

    it('navigates pages', () => {
        const manyAgents: AgentDefinition[] = Array.from({ length: 15 }, (_, i) => ({
            id: `agent-${i}`,
            name: `Agent ${i}`,
            source: 'builtin' as const,
        }));
        renderLibrary({ builtinAgents: manyAgents });
        // Go to page 2
        const nextBtn = screen.getByText('1/2').nextElementSibling!;
        fireEvent.click(nextBtn);
        expect(screen.getByText('Agent 12')).toBeInTheDocument();
        expect(screen.queryByText('Agent 0')).not.toBeInTheDocument();
        expect(screen.getByText('2/2')).toBeInTheDocument();
        // Go back to page 1 via prev button
        const prevBtn = screen.getByText('2/2').previousElementSibling!;
        fireEvent.click(prevBtn);
        expect(screen.getByText('Agent 0')).toBeInTheDocument();
        expect(screen.getByText('1/2')).toBeInTheDocument();
    });

    it('resets page when search changes', () => {
        const manyAgents: AgentDefinition[] = Array.from({ length: 15 }, (_, i) => ({
            id: `agent-${i}`,
            name: `Agent ${i}`,
            source: 'builtin' as const,
            description: i === 14 ? 'special' : 'normal',
        }));
        renderLibrary({ builtinAgents: manyAgents });
        // Go to page 2
        const nextBtn = screen.getByText('1/2').nextElementSibling!;
        fireEvent.click(nextBtn);
        // Search resets to page 1
        const searchInput = screen.getByPlaceholderText(/Search agents/);
        fireEvent.change(searchInput, { target: { value: 'special' } });
        expect(screen.getByText('Agent 14')).toBeInTheDocument();
    });

    it('resets page when filter changes', () => {
        const manyAgents: AgentDefinition[] = Array.from({ length: 15 }, (_, i) => ({
            id: `agent-${i}`,
            name: `Agent ${i}`,
            source: 'builtin' as const,
        }));
        renderLibrary({ builtinAgents: manyAgents });
        // Go to page 2
        const nextBtn = screen.getByText('1/2').nextElementSibling!;
        fireEvent.click(nextBtn);
        // Switch filter resets page
        fireEvent.click(screen.getByText('Built-in'));
        expect(screen.getByText('Agent 0')).toBeInTheDocument();
    });

    it('uses agent name initial when no icon', () => {
        const agent: AgentDefinition = {
            id: 'no-icon',
            name: 'Zebra Agent',
            source: 'builtin',
            color: '#ef4444',
        };
        renderLibrary({ builtinAgents: [agent] });
        expect(screen.getByText('Z')).toBeInTheDocument();
    });

    it('shows empty state with no agents', () => {
        renderLibrary({ builtinAgents: [] });
        expect(screen.getByText('No agents available')).toBeInTheDocument();
    });

    it('shows "All tools" when tools.mode is all', () => {
        const agent: AgentDefinition = {
            id: 'all-tools',
            name: 'All Tools Agent',
            source: 'builtin',
            tools: { mode: 'all' },
        };
        renderLibrary({ builtinAgents: [agent] });
        expect(screen.getByText('All tools')).toBeInTheDocument();
    });

    it('shows 0 tools when tools list is undefined', () => {
        const agent: AgentDefinition = {
            id: 'no-list',
            name: 'No List Agent',
            source: 'builtin',
            tools: { mode: 'blacklist' },
        };
        renderLibrary({ builtinAgents: [agent] });
        expect(screen.getByText('0 tools (blacklist)')).toBeInTheDocument();
    });

    it('shows file source label', () => {
        const agent: AgentDefinition = {
            id: 'file-agent',
            name: 'File Agent',
            source: 'file',
        };
        renderLibrary({ builtinAgents: [agent] });
        expect(screen.getByText('📄 File')).toBeInTheDocument();
    });

    it('filters out non-builtin agents in Built-in tab', async () => {
        mockGetSavedAgents.mockResolvedValue(SAVED_AGENTS);
        renderLibrary();
        await waitFor(() => {
            expect(screen.getByText('Custom Scanner')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('Built-in'));
        expect(screen.queryByText('Custom Scanner')).not.toBeInTheDocument();
        expect(screen.getByText('Investigator')).toBeInTheDocument();
    });

    it('filters agents by builtinType search text', () => {
        const agents: AgentDefinition[] = [
            { id: 'a1', name: 'Alpha', source: 'builtin', builtinType: 'zzz-unique-type', description: 'desc' },
            { id: 'a2', name: 'Beta', source: 'builtin' },
        ];
        renderLibrary({ builtinAgents: agents });
        const searchInput = screen.getByPlaceholderText(/Search agents/);
        fireEvent.change(searchInput, { target: { value: 'zzz-unique-type' } });
        expect(screen.getByText('Alpha')).toBeInTheDocument();
        expect(screen.queryByText('Beta')).not.toBeInTheDocument();
    });
});
