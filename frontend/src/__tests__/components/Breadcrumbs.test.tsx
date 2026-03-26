import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Breadcrumbs } from '../../components/Breadcrumbs';

function renderBreadcrumbs(crumbs: { label: string; to?: string }[], onEditLabel?: (label: string) => void) {
    return render(
        <MemoryRouter>
            <Breadcrumbs crumbs={crumbs} onEditLabel={onEditLabel} />
        </MemoryRouter>
    );
}

describe('Breadcrumbs', () => {
    it('renders nav with breadcrumb aria-label', () => {
        renderBreadcrumbs([{ label: 'Home', to: '/' }]);
        expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    });

    it('renders single non-navigable crumb as plain text', () => {
        renderBreadcrumbs([{ label: 'Dashboard' }]);
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('renders back pill linking to parent', () => {
        renderBreadcrumbs([{ label: 'Dashboard', to: '/' }, { label: 'Settings' }]);
        const link = screen.getByRole('link', { name: /Dashboard/i });
        expect(link).toHaveAttribute('href', '/');
        // Current page shown as text
        expect(screen.getByText('Settings')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    });

    it('renders separator between back pill and current page', () => {
        const { container } = renderBreadcrumbs([{ label: 'Home', to: '/' }, { label: 'Page' }]);
        // ArrowLeft + ChevronRight = 2 SVGs
        const svgs = container.querySelectorAll('svg');
        expect(svgs.length).toBeGreaterThanOrEqual(2);
    });

    it('uses nearest parent as back target for three-level breadcrumb', () => {
        renderBreadcrumbs([{ label: 'Dashboard', to: '/' }, { label: 'Schedules', to: '/schedules' }, { label: 'New Schedule' }]);
        // Back pill links to nearest parent (Schedules), not Dashboard
        const link = screen.getByRole('link', { name: /Schedules/i });
        expect(link).toHaveAttribute('href', '/schedules');
        expect(screen.getByText('New Schedule')).toBeInTheDocument();
    });

    it('renders no back pill when only a single navigable crumb', () => {
        renderBreadcrumbs([{ label: 'Dashboard', to: '/' }]);
        // Single navigable crumb with no current-page crumb — back pill shows but no current label
        const link = screen.getByRole('link', { name: /Dashboard/i });
        expect(link).toHaveAttribute('href', '/');
    });

    it('renders no links when all crumbs are non-navigable', () => {
        renderBreadcrumbs([{ label: 'Home' }, { label: 'Page' }]);
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    describe('Inline Editing', () => {
        it('shows pencil icon when onEditLabel is provided', () => {
            renderBreadcrumbs([{ label: 'Dashboard', to: '/' }, { label: 'My Investigation' }], vi.fn());
            expect(screen.getByRole('button', { name: /Edit title/i })).toBeInTheDocument();
        });

        it('does not show pencil icon when onEditLabel is not provided', () => {
            renderBreadcrumbs([{ label: 'Dashboard', to: '/' }, { label: 'My Investigation' }]);
            expect(screen.queryByRole('button', { name: /Edit title/i })).not.toBeInTheDocument();
        });

        it('enters edit mode on pencil click', async () => {
            const user = userEvent.setup();
            renderBreadcrumbs([{ label: 'Dashboard', to: '/' }, { label: 'My Investigation' }], vi.fn());
            await user.click(screen.getByRole('button', { name: /Edit title/i }));
            expect(screen.getByLabelText('Edit title')).toHaveValue('My Investigation');
        });

        it('enters edit mode on double-click of label', async () => {
            const user = userEvent.setup();
            renderBreadcrumbs([{ label: 'Dashboard', to: '/' }, { label: 'My Investigation' }], vi.fn());
            await user.dblClick(screen.getByText('My Investigation'));
            expect(screen.getByLabelText('Edit title')).toHaveValue('My Investigation');
        });

        it('calls onEditLabel with new value on Enter', async () => {
            const onEdit = vi.fn();
            const user = userEvent.setup();
            renderBreadcrumbs([{ label: 'Dashboard', to: '/' }, { label: 'Old Title' }], onEdit);
            await user.click(screen.getByRole('button', { name: /Edit title/i }));
            const input = screen.getByLabelText('Edit title');
            await user.clear(input);
            await user.type(input, 'New Title{Enter}');
            expect(onEdit).toHaveBeenCalledWith('New Title');
        });

        it('does not call onEditLabel when title is unchanged on Enter', async () => {
            const onEdit = vi.fn();
            const user = userEvent.setup();
            renderBreadcrumbs([{ label: 'Dashboard', to: '/' }, { label: 'Same Title' }], onEdit);
            await user.click(screen.getByRole('button', { name: /Edit title/i }));
            const input = screen.getByLabelText('Edit title');
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(onEdit).not.toHaveBeenCalled();
        });

        it('cancels edit on Escape without calling onEditLabel', async () => {
            const onEdit = vi.fn();
            const user = userEvent.setup();
            renderBreadcrumbs([{ label: 'Dashboard', to: '/' }, { label: 'Original' }], onEdit);
            await user.click(screen.getByRole('button', { name: /Edit title/i }));
            const input = screen.getByLabelText('Edit title');
            await user.type(input, ' changed');
            fireEvent.keyDown(input, { key: 'Escape' });
            expect(onEdit).not.toHaveBeenCalled();
            // Should exit edit mode and show original label
            expect(screen.getByText('Original')).toBeInTheDocument();
        });

        it('commits edit on blur', async () => {
            const onEdit = vi.fn();
            const user = userEvent.setup();
            renderBreadcrumbs([{ label: 'Dashboard', to: '/' }, { label: 'Title' }], onEdit);
            await user.click(screen.getByRole('button', { name: /Edit title/i }));
            const input = screen.getByLabelText('Edit title');
            await user.clear(input);
            await user.type(input, 'Blurred Title');
            fireEvent.blur(input);
            expect(onEdit).toHaveBeenCalledWith('Blurred Title');
        });

        it('does not call onEditLabel when input is empty on commit', async () => {
            const onEdit = vi.fn();
            const user = userEvent.setup();
            renderBreadcrumbs([{ label: 'Dashboard', to: '/' }, { label: 'Title' }], onEdit);
            await user.click(screen.getByRole('button', { name: /Edit title/i }));
            const input = screen.getByLabelText('Edit title');
            await user.clear(input);
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(onEdit).not.toHaveBeenCalled();
        });

        it('double-click does nothing when onEditLabel is not provided', async () => {
            const user = userEvent.setup();
            renderBreadcrumbs([{ label: 'Dashboard', to: '/' }, { label: 'No Edit' }]);
            await user.dblClick(screen.getByText('No Edit'));
            // Should NOT enter edit mode
            expect(screen.queryByLabelText('Edit title')).not.toBeInTheDocument();
        });

        it('initializes draft to empty string when current crumb label is empty', async () => {
            const onEdit = vi.fn();
            const user = userEvent.setup();
            renderBreadcrumbs([{ label: 'Dashboard', to: '/' }, { label: '' }], onEdit);
            await user.click(screen.getByRole('button', { name: /Edit title/i }));
            expect(screen.getByLabelText('Edit title')).toHaveValue('');
        });
    });
});
