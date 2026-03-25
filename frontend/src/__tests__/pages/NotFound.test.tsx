import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { NotFound } from '../../pages/NotFound';
import { renderWithProviders } from '../helpers/renderHelpers';

describe('NotFound', () => {
    it('renders 404 heading', () => {
        renderWithProviders(<NotFound />);
        expect(screen.getByText('404')).toBeInTheDocument();
        expect(screen.getByText('Page not found')).toBeInTheDocument();
    });

    it('renders a link back to dashboard', () => {
        renderWithProviders(<NotFound />);
        const link = screen.getByRole('link', { name: /back to dashboard/i });
        expect(link).toHaveAttribute('href', '/');
    });
});
