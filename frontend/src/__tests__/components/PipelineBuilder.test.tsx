import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PipelineBuilder } from '../../components/PipelineBuilder';
import type { AgentDefinition } from '../../types/pipeline';

// ── Mock api module ─────────────────────────────────────────────────

const mockGetSavedAgents = vi.fn().mockResolvedValue([]);
const mockCreateSavedAgent = vi.fn().mockResolvedValue({ id: 'sa-1', agent: {}, createdAt: '', updatedAt: '' });
const mockDeleteSavedAgent = vi.fn().mockResolvedValue(undefined);
const mockUpdateSavedAgent = vi.fn().mockResolvedValue({ id: 'sa-1', agent: {}, createdAt: '', updatedAt: '' });

vi.mock('../../api', () => ({
    api: {
        getSavedAgents: (...args: unknown[]) => mockGetSavedAgents(...args),
        createSavedAgent: (...args: unknown[]) => mockCreateSavedAgent(...args),
        deleteSavedAgent: (...args: unknown[]) => mockDeleteSavedAgent(...args),
        updateSavedAgent: (...args: unknown[]) => mockUpdateSavedAgent(...args),
    },
}));

// ── Helpers ─────────────────────────────────────────────────────────

const BUILTIN_AGENTS: AgentDefinition[] = [
    { id: 'builtin-investigator', name: 'Investigator', source: 'builtin', builtinType: 'investigator', color: '#3b82f6', icon: '🔍' },
    { id: 'builtin-validator', name: 'Validator', source: 'builtin', builtinType: 'validator', color: '#f59e0b', icon: '🛡️' },
];

function renderBuilder(props: Partial<React.ComponentProps<typeof PipelineBuilder>> = {}) {
    const onChange = vi.fn();
    const result = render(
        <PipelineBuilder
            value={null}
            onChange={onChange}
            builtinAgents={BUILTIN_AGENTS}
            availableModels={['gpt-4', 'gpt-3.5-turbo']}
            {...props}
        />,
    );
    return { ...result, onChange };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('PipelineBuilder – Saved Agents', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSavedAgents.mockResolvedValue([]);
    });

    it('loads saved agents from API on mount', async () => {
        mockGetSavedAgents.mockResolvedValue([
            { id: 'sa-1', agent: { id: 'custom-1', name: 'My Custom Agent', source: 'file', promptPath: 'prompts/custom.md', color: '#ec4899' }, createdAt: '', updatedAt: '' },
        ]);
        renderBuilder();
        await waitFor(() => {
            expect(mockGetSavedAgents).toHaveBeenCalledTimes(1);
        });
        expect(screen.getByText('My Custom Agent')).toBeInTheDocument();
    });

    it('shows saved agents alongside builtin agents in the palette', async () => {
        mockGetSavedAgents.mockResolvedValue([
            { id: 'sa-1', agent: { id: 'custom-1', name: 'Security Reviewer', source: 'inline', promptContent: 'Review security', color: '#14b8a6' }, createdAt: '', updatedAt: '' },
        ]);
        renderBuilder();
        await waitFor(() => expect(screen.getByText('Security Reviewer')).toBeInTheDocument());
        expect(screen.getByText('Investigator')).toBeInTheDocument();
        expect(screen.getByText('Validator')).toBeInTheDocument();
    });

    it('clicking a saved agent adds it as a pipeline stage', async () => {
        mockGetSavedAgents.mockResolvedValue([
            { id: 'sa-1', agent: { id: 'custom-1', name: 'Security Reviewer', source: 'inline', promptContent: 'Review', color: '#14b8a6' }, createdAt: '', updatedAt: '' },
        ]);
        const { onChange } = renderBuilder();
        await waitFor(() => expect(screen.getByText('Security Reviewer')).toBeInTheDocument());
        fireEvent.click(screen.getByText('Security Reviewer'));
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                stages: expect.arrayContaining([
                    expect.objectContaining({ agent: expect.objectContaining({ name: 'Security Reviewer' }) }),
                ]),
            }),
        );
    });

    it('deletes a saved agent when the X badge is clicked', async () => {
        mockGetSavedAgents.mockResolvedValue([
            { id: 'sa-1', agent: { id: 'custom-1', name: 'My Agent', source: 'file', promptPath: 'x.md', color: '#ec4899' }, createdAt: '', updatedAt: '' },
        ]);
        renderBuilder();
        await waitFor(() => expect(screen.getByText('My Agent')).toBeInTheDocument());
        const removeBtn = screen.getByTitle('Remove from library');
        fireEvent.click(removeBtn);
        await waitFor(() => {
            expect(mockDeleteSavedAgent).toHaveBeenCalledWith('sa-1');
        });
    });

    it('continues to work when getSavedAgents fails', async () => {
        mockGetSavedAgents.mockRejectedValue(new Error('network error'));
        renderBuilder();
        await waitFor(() => expect(mockGetSavedAgents).toHaveBeenCalled());
        expect(screen.getByText('Investigator')).toBeInTheDocument();
    });
});

describe('PipelineBuilder – Custom Agent button always visible', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSavedAgents.mockResolvedValue([]);
    });

    it('shows Custom Agent button on first page', () => {
        renderBuilder();
        expect(screen.getByText(/Custom Agent/)).toBeInTheDocument();
    });
});

describe('PipelineBuilder – AgentModal Save to Library', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSavedAgents.mockResolvedValue([]);
    });

    it('shows Save to Library button in the add agent modal for file/inline agents', async () => {
        renderBuilder();
        fireEvent.click(screen.getByText(/Custom Agent/));
        await waitFor(() => expect(screen.getByText('Add Agent')).toBeInTheDocument());
        expect(screen.getByText('Save to Library')).toBeInTheDocument();
    });

    it('calls createSavedAgent when Save to Library is clicked', async () => {
        mockCreateSavedAgent.mockResolvedValue({ id: 'sa-new', agent: {}, createdAt: '', updatedAt: '' });
        renderBuilder();
        fireEvent.click(screen.getByText(/Custom Agent/));
        await waitFor(() => expect(screen.getByText('Add Agent')).toBeInTheDocument());

        // Fill in the required fields (default source is 'file')
        const nameInput = screen.getByPlaceholderText('e.g., Validator, Security Reviewer');
        fireEvent.change(nameInput, { target: { value: 'Test Agent' } });
        const pathInput = screen.getByPlaceholderText('prompts/examples/ValidatorPrompt.md');
        fireEvent.change(pathInput, { target: { value: 'prompts/test.md' } });

        fireEvent.click(screen.getByText('Save to Library'));
        await waitFor(() => {
            expect(mockCreateSavedAgent).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Test Agent', source: 'file', promptPath: 'prompts/test.md' }),
            );
        });
    });

    it('does not show Save to Library when editing an existing stage agent', async () => {
        const pipeline = {
            id: 'test-pipeline',
            name: 'Test',
            stages: [{ agent: { id: 'a1', name: 'Existing', source: 'file' as const, promptPath: 'x.md', color: '#333' } }],
        };
        renderBuilder({ value: pipeline });
        // Click the edit-agent button (pen icon) on the stage card
        const editBtn = screen.getByTitle('Edit agent');
        fireEvent.click(editBtn);
        await waitFor(() => expect(screen.getByText('Edit Agent')).toBeInTheDocument());
        expect(screen.queryByText('Save to Library')).not.toBeInTheDocument();
    });
});

describe('PipelineBuilder – Edit Saved Agent from palette', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSavedAgents.mockResolvedValue([]);
    });

    it('shows edit button on saved agent chips on hover', async () => {
        mockGetSavedAgents.mockResolvedValue([
            { id: 'sa-1', agent: { id: 'custom-1', name: 'My Agent', source: 'file', promptPath: 'x.md', color: '#ec4899' }, createdAt: '', updatedAt: '' },
        ]);
        renderBuilder();
        await waitFor(() => expect(screen.getByText('My Agent')).toBeInTheDocument());
        expect(screen.getByTitle('Edit saved agent')).toBeInTheDocument();
    });

    it('opens the edit modal pre-filled when edit button is clicked', async () => {
        mockGetSavedAgents.mockResolvedValue([
            { id: 'sa-1', agent: { id: 'custom-1', name: 'My Agent', source: 'file', promptPath: 'prompts/my.md', color: '#ec4899' }, createdAt: '', updatedAt: '' },
        ]);
        renderBuilder();
        await waitFor(() => expect(screen.getByText('My Agent')).toBeInTheDocument());
        fireEvent.click(screen.getByTitle('Edit saved agent'));
        await waitFor(() => expect(screen.getByText('Edit Agent')).toBeInTheDocument());
        // The name field should be pre-filled
        const nameInput = screen.getByDisplayValue('My Agent');
        expect(nameInput).toBeInTheDocument();
    });

    it('calls updateSavedAgent when saving an edited saved agent', async () => {
        mockGetSavedAgents.mockResolvedValue([
            { id: 'sa-1', agent: { id: 'custom-1', name: 'My Agent', source: 'file', promptPath: 'prompts/my.md', color: '#ec4899' }, createdAt: '', updatedAt: '' },
        ]);
        mockUpdateSavedAgent.mockResolvedValue({ id: 'sa-1', agent: {}, createdAt: '', updatedAt: '' });
        renderBuilder();
        await waitFor(() => expect(screen.getByText('My Agent')).toBeInTheDocument());
        fireEvent.click(screen.getByTitle('Edit saved agent'));
        await waitFor(() => expect(screen.getByText('Edit Agent')).toBeInTheDocument());

        // Change the name
        const nameInput = screen.getByDisplayValue('My Agent');
        fireEvent.change(nameInput, { target: { value: 'Renamed Agent' } });

        fireEvent.click(screen.getByText('Update'));
        await waitFor(() => {
            expect(mockUpdateSavedAgent).toHaveBeenCalledWith(
                'sa-1',
                expect.objectContaining({ agent: expect.objectContaining({ name: 'Renamed Agent' }) }),
            );
        });
    });
});
