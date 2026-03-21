import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { About } from '../../pages/About';

describe('About', () => {
    it('renders heading', () => {
        render(<About />);
        expect(screen.getByText(/AI Investigator/)).toBeInTheDocument();
    });

    it('renders what it does section', () => {
        render(<About />);
        expect(screen.getByText('What it does')).toBeInTheDocument();
    });

    it('renders how it works section', () => {
        render(<About />);
        expect(screen.getByText('How it works')).toBeInTheDocument();
    });

    it('renders tech stack section', () => {
        render(<About />);
        expect(screen.getByText('Tech stack')).toBeInTheDocument();
    });
});
