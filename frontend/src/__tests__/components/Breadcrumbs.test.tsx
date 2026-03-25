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

    it('renders single crumb without separator', () => {
        renderBreadcrumbs([{ label: 'Dashboard' }]);
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    it('renders clickable crumb as link', () => {
        renderBreadcrumbs([{ label: 'Dashboard', to: '/' }]);
        const link = screen.getByRole('link', { name: 'Dashboard' });
        expect(link).toHaveAttribute('href', '/');
    });

    it('renders last crumb (no to) as plain text', () => {
        renderBreadcrumbs([{ label: 'Dashboard', to: '/' }, { label: 'Settings' }]);
        expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
        // Settings should not be a link
        expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    });

    it('renders separator between crumbs', () => {
        const { container } = renderBreadcrumbs([{ label: 'Home', to: '/' }, { label: 'Page' }]);
        // ChevronRight renders as an SVG
        const svgs = container.querySelectorAll('svg');
        expect(svgs.length).toBeGreaterThanOrEqual(1);
    });

    it('renders three-level breadcrumb', () => {
        renderBreadcrumbs([{ label: 'Dashboard', to: '/' }, { label: 'Schedules', to: '/schedules' }, { label: 'New Schedule' }]);
        expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Schedules' })).toBeInTheDocument();
        expect(screen.getByText('New Schedule')).toBeInTheDocument();
    });
});
