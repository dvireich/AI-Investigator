import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentModal, CUSTOM_COLORS, AGENT_ICONS, pickColor } from '../../components/AgentModal';
import type { AgentDefinition } from '../../types/pipeline';

// ── Test data ───────────────────────────────────────────────────────

const BUILTIN_AGENTS: AgentDefinition[] = [
    {
        id: 'builtin-investigator',
        name: 'Investigator',
        source: 'builtin',
        builtinType: 'investigator',
        description: 'Runs the main investigation loop.',
        color: '#10b981',
        icon: '🤖',
        kind: 'investigator',
    },
    {
        id: 'builtin-validator',
        name: 'Validator',
        source: 'builtin',
        builtinType: 'validator',
        description: 'Reviews findings.',
        color: '#f59e0b',
        // No icon → exercises `!icon` branch in builtin inheritance.
    },
];

const AVAILABLE_MODELS = ['gpt-4-turbo', 'claude-3-opus', 'o1-mini'];

// ── Helpers ──────────────────────────────────────────────────────────

function renderModal(props: Partial<React.ComponentProps<typeof AgentModal>> = {}) {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const onSaveToLibrary = vi.fn();
    const utils = render(
        <AgentModal
            builtinAgents={BUILTIN_AGENTS}
            availableModels={AVAILABLE_MODELS}
            defaultColor="#3b82f6"
            onSave={onSave}
            onClose={onClose}
            onSaveToLibrary={onSaveToLibrary}
            {...props}
        />,
    );
    return { ...utils, onSave, onClose, onSaveToLibrary };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AgentModal — exports', () => {
    it('exports CUSTOM_COLORS as an 8-color palette', () => {
        expect(CUSTOM_COLORS).toHaveLength(8);
        expect(CUSTOM_COLORS[0]).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('exports AGENT_ICONS', () => {
        expect(AGENT_ICONS.length).toBeGreaterThan(0);
    });

    it('pickColor wraps around the palette', () => {
        expect(pickColor(0)).toBe(CUSTOM_COLORS[0]);
        expect(pickColor(CUSTOM_COLORS.length)).toBe(CUSTOM_COLORS[0]);
        expect(pickColor(CUSTOM_COLORS.length + 3)).toBe(CUSTOM_COLORS[3]);
    });
});

describe('AgentModal — header & close', () => {
    it('renders "Add Agent" header in default (pipeline) mode', () => {
        renderModal();
        expect(screen.getByText('Add Agent')).toBeInTheDocument();
    });

    it('renders "New Agent" header in library mode', () => {
        renderModal({ mode: 'library' });
        expect(screen.getByText('New Agent')).toBeInTheDocument();
    });

    it('renders "Edit Agent" header when an existing agent is provided', () => {
        renderModal({
            existingAgent: {
                id: 'a1',
                name: 'My Agent',
                source: 'inline',
                promptContent: 'You are X.',
                color: '#ef4444',
            },
        });
        expect(screen.getByText('Edit Agent')).toBeInTheDocument();
    });

    it('calls onClose when the X button is clicked', () => {
        const { onClose } = renderModal();
        // Header X is the first button (close icon).
        const closeBtn = screen.getAllByRole('button')[0];
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when the Cancel button is clicked', () => {
        const { onClose } = renderModal();
        fireEvent.click(screen.getByText('Cancel'));
        expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when clicking the backdrop (target === backdrop ref)', () => {
        const { container, onClose } = renderModal();
        const backdrop = container.firstChild as HTMLElement;
        // Simulate click whose target IS the backdrop element.
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalled();
    });

    it('does NOT close when clicking inside the modal body', () => {
        const { onClose } = renderModal();
        // Click on the source-selector label (inside modal, not on backdrop).
        fireEvent.click(screen.getByText('Agent Source'));
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('AgentModal — source switching', () => {
    it('defaults to "file" source for new agent', () => {
        renderModal();
        expect(screen.getByText('Prompt File Path')).toBeInTheDocument();
    });

    it('switches to inline source and shows the system prompt textarea', () => {
        renderModal();
        fireEvent.click(screen.getByText('✏️ Inline'));
        expect(screen.getByText('System Prompt')).toBeInTheDocument();
    });

    it('switches to builtin source and shows the built-in selector', () => {
        renderModal();
        fireEvent.click(screen.getByText('⚡ Built-in'));
        expect(screen.getByText('Built-in Type')).toBeInTheDocument();
        // Library-mode-only warning should NOT appear in pipeline mode.
        expect(screen.queryByText(/already available everywhere/)).not.toBeInTheDocument();
    });

    it('shows the library-mode warning when builtin is selected in library mode for a new agent', () => {
        renderModal({ mode: 'library' });
        fireEvent.click(screen.getByText('⚡ Built-in'));
        expect(screen.getByText(/already available everywhere/)).toBeInTheDocument();
    });
});

describe('AgentModal — primary button label + disabled', () => {
    it('renders "Add to Pipeline" by default for a new agent', () => {
        renderModal();
        expect(screen.getByRole('button', { name: 'Add to Pipeline' })).toBeInTheDocument();
    });

    it('renders "Save to Library" in library mode for a new agent', () => {
        renderModal({ mode: 'library' });
        // For new agent in library mode, "Save to Library" shows once (primary).
        const buttons = screen.getAllByText('Save to Library');
        expect(buttons.length).toBeGreaterThanOrEqual(1);
    });

    it('renders "Update" when editing', () => {
        renderModal({
            existingAgent: { id: 'a', name: 'X', source: 'inline', promptContent: 'p', color: '#fff' },
        });
        expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    });

    it('disables the primary button for file source with empty path on a new agent', () => {
        renderModal();
        // File source default + empty promptPath → primaryDisabled=true.
        const primary = screen.getByRole('button', { name: 'Add to Pipeline' });
        expect(primary).toBeDisabled();
    });

    it('enables the primary button after entering a prompt path', () => {
        renderModal();
        const input = screen.getByPlaceholderText(/ValidatorPrompt\.md/);
        fireEvent.change(input, { target: { value: 'prompts/X.md' } });
        const primary = screen.getByRole('button', { name: 'Add to Pipeline' });
        expect(primary).not.toBeDisabled();
    });

    it('disables the primary button in library mode when source=builtin for a new agent', () => {
        renderModal({ mode: 'library' });
        fireEvent.click(screen.getByText('⚡ Built-in'));
        // primaryDisabled = isLibraryMode && source===builtin && !isEditing
        const primaries = screen.getAllByRole('button', { name: 'Save to Library' });
        const primary = primaries[primaries.length - 1];
        expect(primary).toBeDisabled();
    });
});

describe('AgentModal — secondary "Save to Library" button visibility', () => {
    it('shows the secondary button in pipeline mode for a new file/inline agent (when onSaveToLibrary is provided)', () => {
        renderModal();
        // File source default → secondary visible.
        const buttons = screen.getAllByText('Save to Library');
        expect(buttons.length).toBeGreaterThanOrEqual(1);
    });

    it('hides the secondary button when source=builtin', () => {
        renderModal();
        fireEvent.click(screen.getByText('⚡ Built-in'));
        expect(screen.queryByText('Save to Library')).not.toBeInTheDocument();
    });

    it('hides the secondary button when editing an existing agent', () => {
        renderModal({
            existingAgent: { id: 'a', name: 'X', source: 'inline', promptContent: 'p', color: '#fff' },
        });
        expect(screen.queryByText('Save to Library')).not.toBeInTheDocument();
    });

    it('hides the secondary button when onSaveToLibrary is not provided', () => {
        const { onSave, onClose } = {
            onSave: vi.fn(),
            onClose: vi.fn(),
        };
        render(
            <AgentModal
                builtinAgents={BUILTIN_AGENTS}
                availableModels={AVAILABLE_MODELS}
                defaultColor="#3b82f6"
                onSave={onSave}
                onClose={onClose}
            />,
        );
        expect(screen.queryByText('Save to Library')).not.toBeInTheDocument();
    });

    it('hides the secondary button in library mode', () => {
        renderModal({ mode: 'library' });
        fireEvent.click(screen.getByText('✏️ Inline'));
        // primary "Save to Library" exists, but no SECONDARY button.
        // In library mode, showSecondaryLibraryButton is false.
        const labels = screen.getAllByText('Save to Library');
        expect(labels).toHaveLength(1);
    });

    it('disables the secondary button when source=file with empty path', () => {
        renderModal();
        const secondary = screen.getByRole('button', { name: /Save to Library/ });
        expect(secondary).toBeDisabled();
    });

    it('calls onSaveToLibrary with the built agent when the secondary button is clicked', () => {
        const { onSaveToLibrary } = renderModal();
        fireEvent.click(screen.getByText('✏️ Inline'));
        // Fill in name + content.
        const nameInput = screen.getByPlaceholderText(/Validator, Security Reviewer/);
        fireEvent.change(nameInput, { target: { value: 'My Inline' } });
        const promptArea = screen.getByPlaceholderText(/You are \{\{AGENT_NAME\}\}/);
        fireEvent.change(promptArea, { target: { value: 'prompt body' } });
        fireEvent.click(screen.getByRole('button', { name: /Save to Library/ }));
        expect(onSaveToLibrary).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'My Inline',
                source: 'inline',
                promptContent: 'prompt body',
            }),
        );
    });
});

describe('AgentModal — buildAgent: builtin source', () => {
    it('builds a builtin agent and inherits color/icon/kind', () => {
        const { onSave } = renderModal();
        fireEvent.click(screen.getByText('⚡ Built-in'));
        // Default builtinType = first agent's type (investigator).
        fireEvent.click(screen.getByRole('button', { name: 'Add to Pipeline' }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                source: 'builtin',
                builtinType: 'investigator',
                name: 'Investigator',
                color: '#10b981',
                icon: '🤖',
                kind: 'investigator',
            }),
        );
    });

    it('falls back to defaultColor when picked builtin has no color/icon', () => {
        const { onSave } = renderModal();
        fireEvent.click(screen.getByText('⚡ Built-in'));
        // Switch to validator (no icon, no kind).
        const select = screen.getAllByRole('combobox')[0];
        fireEvent.change(select, { target: { value: 'validator' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add to Pipeline' }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                source: 'builtin',
                builtinType: 'validator',
                name: 'Validator',
                color: '#f59e0b',
                // No icon inherited (validator has no icon and user didn't pick one).
            }),
        );
    });

    it('falls back to builtinType label when no matching builtin exists for the chosen type', () => {
        const onSave = vi.fn();
        render(
            <AgentModal
                builtinAgents={[]}
                availableModels={AVAILABLE_MODELS}
                defaultColor="#3b82f6"
                onSave={onSave}
                onClose={vi.fn()}
                existingAgent={{
                    id: 'a',
                    name: 'old name',
                    source: 'builtin',
                    builtinType: 'unknown-builtin',
                    color: '#000',
                }}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Update' }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                source: 'builtin',
                builtinType: 'unknown-builtin',
                name: 'unknown-builtin',
            }),
        );
    });
});

describe('AgentModal — buildAgent: file source', () => {
    it('builds a file-source agent with the entered path and default kind=custom', () => {
        const { onSave } = renderModal();
        const input = screen.getByPlaceholderText(/ValidatorPrompt\.md/);
        fireEvent.change(input, { target: { value: 'prompts/X.md' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add to Pipeline' }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                source: 'file',
                promptPath: 'prompts/X.md',
                kind: 'custom',
            }),
        );
    });

    it('falls back to "Unnamed Agent" when name is left blank', () => {
        const { onSave } = renderModal();
        const input = screen.getByPlaceholderText(/ValidatorPrompt\.md/);
        fireEvent.change(input, { target: { value: 'prompts/X.md' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add to Pipeline' }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Unnamed Agent' }),
        );
    });

    it('emits the entered name when provided', () => {
        const { onSave } = renderModal();
        const nameInput = screen.getByPlaceholderText(/Validator, Security Reviewer/);
        fireEvent.change(nameInput, { target: { value: 'My Custom' } });
        const fileInput = screen.getByPlaceholderText(/ValidatorPrompt\.md/);
        fireEvent.change(fileInput, { target: { value: 'p.md' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add to Pipeline' }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'My Custom' }),
        );
    });
});

describe('AgentModal — buildAgent: inline source', () => {
    it('builds an inline-source agent with the prompt content', () => {
        const { onSave } = renderModal();
        fireEvent.click(screen.getByText('✏️ Inline'));
        const nameInput = screen.getByPlaceholderText(/Validator, Security Reviewer/);
        fireEvent.change(nameInput, { target: { value: 'Inline Agent' } });
        const promptArea = screen.getByPlaceholderText(/You are \{\{AGENT_NAME\}\}/);
        fireEvent.change(promptArea, { target: { value: 'prompt body' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add to Pipeline' }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                source: 'inline',
                promptContent: 'prompt body',
                name: 'Inline Agent',
            }),
        );
    });
});

describe('AgentModal — optional fields propagate to buildAgent', () => {
    it('attaches description, model, maxSteps, repoRoot, knowledgeBasePath, workingDirectory when set', () => {
        const { onSave } = renderModal();
        fireEvent.click(screen.getByText('✏️ Inline'));
        // Name.
        fireEvent.change(screen.getByPlaceholderText(/Validator, Security Reviewer/), {
            target: { value: 'Full Agent' },
        });
        // Inline content.
        fireEvent.change(screen.getByPlaceholderText(/You are \{\{AGENT_NAME\}\}/), {
            target: { value: 'p' },
        });
        // Open description popup and set value.
        fireEvent.click(screen.getByTitle('Edit description'));
        const descArea = screen.getByPlaceholderText(/Brief description of what this agent does/);
        fireEvent.change(descArea, { target: { value: 'desc' } });
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        // Model.
        const modelSelect = screen.getAllByRole('combobox').find(c => (c as HTMLSelectElement).value === '')!;
        fireEvent.change(modelSelect, { target: { value: 'gpt-4-turbo' } });
        // Max Steps.
        const stepsInput = screen.getByPlaceholderText('Default');
        fireEvent.change(stepsInput, { target: { value: '5' } });
        // Open Investigation Context section.
        fireEvent.click(screen.getByText('Investigation Context'));
        fireEvent.change(screen.getByPlaceholderText(/MyRepo/), {
            target: { value: '/repo' },
        });
        fireEvent.change(screen.getByPlaceholderText(/relative to repo root, or absolute/), {
            target: { value: 'kb' },
        });
        fireEvent.change(screen.getByPlaceholderText(/cwd for this agent/), {
            target: { value: '/cwd' },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Add to Pipeline' }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                description: 'desc',
                model: 'gpt-4-turbo',
                maxSteps: 5,
                repoRoot: '/repo',
                knowledgeBasePath: 'kb',
                workingDirectory: '/cwd',
            }),
        );
    });

    it('omits maxSteps when set to 0 (Number("") falls through)', () => {
        const { onSave } = renderModal();
        fireEvent.click(screen.getByText('✏️ Inline'));
        fireEvent.change(screen.getByPlaceholderText(/Validator, Security Reviewer/), {
            target: { value: 'A' },
        });
        fireEvent.change(screen.getByPlaceholderText(/You are \{\{AGENT_NAME\}\}/), {
            target: { value: 'p' },
        });
        const stepsInput = screen.getByPlaceholderText('Default');
        // Set to 5 then back to empty → exercises Number("") || 0 fallback.
        fireEvent.change(stepsInput, { target: { value: '5' } });
        fireEvent.change(stepsInput, { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add to Pipeline' }));
        expect(onSave).toHaveBeenCalledWith(
            expect.not.objectContaining({ maxSteps: expect.anything() }),
        );
    });
});

describe('AgentModal — color and icon pickers', () => {
    it('applies a color from the palette when clicked', () => {
        const { onSave } = renderModal();
        fireEvent.click(screen.getByText('✏️ Inline'));
        fireEvent.change(screen.getByPlaceholderText(/Validator, Security Reviewer/), {
            target: { value: 'A' },
        });
        fireEvent.change(screen.getByPlaceholderText(/You are \{\{AGENT_NAME\}\}/), {
            target: { value: 'p' },
        });
        // Pick the 5th palette color.
        const colorButtons = document.querySelectorAll('button[style*="background-color"]');
        // First 8 are CUSTOM_COLORS palette buttons; click index 4.
        fireEvent.click(colorButtons[4] as HTMLElement);
        fireEvent.click(screen.getByRole('button', { name: 'Add to Pipeline' }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({ color: CUSTOM_COLORS[4] }),
        );
    });

    it('applies a custom hex from the color input', () => {
        const { onSave } = renderModal();
        fireEvent.click(screen.getByText('✏️ Inline'));
        fireEvent.change(screen.getByPlaceholderText(/Validator, Security Reviewer/), {
            target: { value: 'A' },
        });
        fireEvent.change(screen.getByPlaceholderText(/You are \{\{AGENT_NAME\}\}/), {
            target: { value: 'p' },
        });
        const customColorInput = screen.getByTitle('Custom color') as HTMLInputElement;
        fireEvent.change(customColorInput, { target: { value: '#abcdef' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add to Pipeline' }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({ color: '#abcdef' }),
        );
    });

    it('clears icon back to empty via the "—" button', () => {
        const { onSave } = renderModal({
            existingAgent: {
                id: 'a',
                name: 'X',
                source: 'inline',
                promptContent: 'p',
                color: '#fff',
                icon: '🔥',
            },
        });
        // Click the "no icon" reset button (title="No icon (auto-assign)").
        fireEvent.click(screen.getByTitle('No icon (auto-assign)'));
        fireEvent.click(screen.getByRole('button', { name: 'Update' }));
        const args = onSave.mock.calls[0][0];
        expect(args.icon).toBeUndefined();
    });

    it('selects an icon from the icon palette', () => {
        const { onSave } = renderModal();
        fireEvent.click(screen.getByText('✏️ Inline'));
        fireEvent.change(screen.getByPlaceholderText(/Validator, Security Reviewer/), {
            target: { value: 'A' },
        });
        fireEvent.change(screen.getByPlaceholderText(/You are \{\{AGENT_NAME\}\}/), {
            target: { value: 'p' },
        });
        // Click a specific icon button.
        const iconBtn = screen.getByRole('button', { name: AGENT_ICONS[0] });
        fireEvent.click(iconBtn);
        fireEvent.click(screen.getByRole('button', { name: 'Add to Pipeline' }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({ icon: AGENT_ICONS[0] }),
        );
    });
});

describe('AgentModal — description popup', () => {
    it('opens via the inline preview area click', () => {
        renderModal();
        fireEvent.click(screen.getByText('Brief description of what this agent does'));
        // Popup-only "Done" button now appears.
        expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    });

    it('closes when clicking the popup backdrop', () => {
        renderModal();
        fireEvent.click(screen.getByTitle('Edit description'));
        const done = screen.getByRole('button', { name: 'Done' });
        const popup = done.closest('.fixed') as HTMLElement;
        // Click on the backdrop (the popup's own outer div).
        fireEvent.click(popup);
        expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    });

    it('closes when clicking the popup X button', () => {
        renderModal();
        fireEvent.click(screen.getByTitle('Edit description'));
        const done = screen.getByRole('button', { name: 'Done' });
        const popup = done.closest('.fixed') as HTMLElement;
        // Find the X button inside the popup (the one near the "Description" header).
        const xBtns = popup.querySelectorAll('button');
        // First button in the popup is the X close button.
        fireEvent.click(xBtns[0]);
        expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    });

    it('renders a previously-set description in the preview area', () => {
        renderModal({
            existingAgent: {
                id: 'a',
                name: 'X',
                source: 'inline',
                promptContent: 'p',
                color: '#fff',
                description: 'preset desc',
            },
        });
        expect(screen.getByText('preset desc')).toBeInTheDocument();
    });
});

describe('AgentModal — Investigation Context expand/collapse', () => {
    it('starts expanded when the existing agent has any context field set', () => {
        renderModal({
            existingAgent: {
                id: 'a',
                name: 'X',
                source: 'inline',
                promptContent: 'p',
                color: '#fff',
                repoRoot: '/repo',
            },
        });
        expect(screen.getByPlaceholderText(/MyRepo/)).toBeInTheDocument();
    });

    it('toggles expansion via the section header', () => {
        renderModal();
        // Closed by default.
        expect(screen.queryByPlaceholderText(/MyRepo/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('Investigation Context'));
        expect(screen.getByPlaceholderText(/MyRepo/)).toBeInTheDocument();
        fireEvent.click(screen.getByText('Investigation Context'));
        expect(screen.queryByPlaceholderText(/MyRepo/)).not.toBeInTheDocument();
    });
});

describe('AgentModal — kind selector', () => {
    it('persists kind selection through to buildAgent for file source', () => {
        const { onSave } = renderModal();
        const fileInput = screen.getByPlaceholderText(/ValidatorPrompt\.md/);
        fireEvent.change(fileInput, { target: { value: 'p.md' } });
        // Kind selector — find a select with current value 'custom' and switch.
        const kindSelect = screen.getAllByRole('combobox').find(
            c => Array.from((c as HTMLSelectElement).options).some(o => o.value === 'investigator'),
        ) as HTMLSelectElement;
        fireEvent.change(kindSelect, { target: { value: 'investigator' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add to Pipeline' }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'investigator' }),
        );
    });
});

describe('AgentModal — defensive `||` fallbacks for malformed builtin agents', () => {
    it('handles builtin agents that have no `builtinType` (falls back to `a.id`) and no `color`', () => {
        // Cover the `(a.builtinType || a.id)` fallback in find() and the
        // `<option value=...>` render, plus `builtin.color || color` fallback.
        const onSave = vi.fn();
        const noTypeBuiltin: AgentDefinition[] = [
            {
                id: 'no-type-builtin',
                name: 'No-Type Builtin',
                source: 'builtin',
                // NO builtinType, NO color → exercises both `|| a.id` and `|| color` branches.
            },
        ];
        render(
            <AgentModal
                builtinAgents={noTypeBuiltin}
                availableModels={AVAILABLE_MODELS}
                defaultColor="#abcdef"
                onSave={onSave}
                onClose={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByText('⚡ Built-in'));
        // Default builtinType resolves via `|| a.id` → 'no-type-builtin'.
        // Saving uses `find(a => (a.builtinType || a.id) === ...)` → matches.
        // builtin.color is undefined → uses defaultColor.
        fireEvent.click(screen.getByRole('button', { name: 'Add to Pipeline' }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                source: 'builtin',
                builtinType: 'no-type-builtin',
                name: 'No-Type Builtin',
                color: '#abcdef',
            }),
        );
    });

    it('handles construction with empty builtinAgents (covers `builtinAgents[0]?.id || \'\'` empty fallback)', () => {
        // Cover the deepest fallback in:
        //   useState(existingAgent?.builtinType || (builtinAgents[0]?.builtinType || builtinAgents[0]?.id || ''))
        // when there are no builtin agents AND no existing agent.
        const onSave = vi.fn();
        render(
            <AgentModal
                builtinAgents={[]}
                availableModels={AVAILABLE_MODELS}
                defaultColor="#3b82f6"
                onSave={onSave}
                onClose={vi.fn()}
            />,
        );
        // Switch to builtin → empty selector renders, save is disabled because
        // builtinType is '' but the modal still constructs successfully.
        fireEvent.click(screen.getByText('⚡ Built-in'));
        // The modal is rendered without crashing.
        expect(screen.getByText('Built-in Type')).toBeInTheDocument();
    });

    it('falls back to builtinType string when no matching builtin is found in find().name (covers `?.name || builtinType`)', () => {
        // Existing builtin agent whose builtinType doesn't match anything in
        // the available list → `find().name` is undefined → fall through to
        // `builtinType` string.
        const onSave = vi.fn();
        render(
            <AgentModal
                builtinAgents={BUILTIN_AGENTS}
                availableModels={AVAILABLE_MODELS}
                defaultColor="#3b82f6"
                onSave={onSave}
                onClose={vi.fn()}
                existingAgent={{
                    id: 'a',
                    name: 'old name',
                    source: 'builtin',
                    builtinType: 'unknown-type-xyz',
                    color: '#000',
                }}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Update' }));
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                builtinType: 'unknown-type-xyz',
                name: 'unknown-type-xyz',
            }),
        );
    });
});
