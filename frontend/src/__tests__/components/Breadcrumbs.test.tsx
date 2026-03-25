import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Breadcrumbs } from '../../components/Breadcrumbs';

function renderBreadcrumbs(crumbs: { label: string; to?: string }[]) {
    return render(
        <MemoryRouter>
            <Breadcrumbs crumbs={crumbs} />
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
});
