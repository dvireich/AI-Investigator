import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pagination, DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../../components/Pagination';

describe('Pagination', () => {
    const defaultProps = {
        totalItems: 50,
        currentPage: 1,
        pageSize: 12,
        onPageChange: vi.fn(),
        onPageSizeChange: vi.fn(),
    };

    it('renders nothing when totalItems is 0', () => {
        const { container } = render(<Pagination {...defaultProps} totalItems={0} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders item range and total', () => {
        render(<Pagination {...defaultProps} />);
        expect(screen.getByText('1–12 of 50 items')).toBeInTheDocument();
    });

    it('renders custom noun', () => {
        render(<Pagination {...defaultProps} noun="investigations" />);
        expect(screen.getByText('1–12 of 50 investigations')).toBeInTheDocument();
    });

    it('shows correct range on page 2', () => {
        render(<Pagination {...defaultProps} currentPage={2} />);
        expect(screen.getByText('13–24 of 50 items')).toBeInTheDocument();
    });

    it('shows clamped range on last page', () => {
        render(<Pagination {...defaultProps} currentPage={5} pageSize={12} />);
        // 49-50 on last page
        expect(screen.getByText('49–50 of 50 items')).toBeInTheDocument();
    });

    it('disables previous button on first page', () => {
        render(<Pagination {...defaultProps} currentPage={1} />);
        const prevBtn = screen.getByLabelText('Previous page');
        expect(prevBtn).toBeDisabled();
    });

    it('disables next button on last page', () => {
        render(<Pagination {...defaultProps} currentPage={5} pageSize={12} />);
        const nextBtn = screen.getByLabelText('Next page');
        expect(nextBtn).toBeDisabled();
    });

    it('enables both buttons on middle page', () => {
        render(<Pagination {...defaultProps} currentPage={3} />);
        expect(screen.getByLabelText('Previous page')).not.toBeDisabled();
        expect(screen.getByLabelText('Next page')).not.toBeDisabled();
    });

    it('calls onPageChange with previous page', async () => {
        const user = userEvent.setup();
        const onPageChange = vi.fn();
        render(<Pagination {...defaultProps} currentPage={3} onPageChange={onPageChange} />);
        await user.click(screen.getByLabelText('Previous page'));
        expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('calls onPageChange with next page', async () => {
        const user = userEvent.setup();
        const onPageChange = vi.fn();
        render(<Pagination {...defaultProps} currentPage={2} onPageChange={onPageChange} />);
        await user.click(screen.getByLabelText('Next page'));
        expect(onPageChange).toHaveBeenCalledWith(3);
    });

    it('calls onPageChange when a page number is clicked', async () => {
        const user = userEvent.setup();
        const onPageChange = vi.fn();
        render(<Pagination {...defaultProps} currentPage={1} onPageChange={onPageChange} />);
        await user.click(screen.getByText('3'));
        expect(onPageChange).toHaveBeenCalledWith(3);
    });

    it('highlights the current page button', () => {
        render(<Pagination {...defaultProps} currentPage={2} />);
        const btn = screen.getByText('2');
        expect(btn.className).toContain('bg-brand-500/20');
    });

    it('renders page size selector with options', () => {
        render(<Pagination {...defaultProps} />);
        const select = screen.getByRole('combobox');
        const options = Array.from(select.querySelectorAll('option'));
        expect(options.map(o => Number(o.value))).toEqual(PAGE_SIZE_OPTIONS);
    });

    it('calls onPageSizeChange and resets to page 1 when page size changes', async () => {
        const user = userEvent.setup();
        const onPageChange = vi.fn();
        const onPageSizeChange = vi.fn();
        render(<Pagination {...defaultProps} currentPage={3} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />);
        const select = screen.getByRole('combobox');
        await user.selectOptions(select, '24');
        expect(onPageSizeChange).toHaveBeenCalledWith(24);
        expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it('shows ellipsis for many pages', () => {
        render(<Pagination {...defaultProps} totalItems={200} pageSize={6} currentPage={10} />);
        // Should show page numbers with ellipsis
        const dots = screen.getAllByText('...');
        expect(dots.length).toBeGreaterThan(0);
    });

    it('shows all page numbers when total pages <= 7', () => {
        render(<Pagination {...defaultProps} totalItems={42} pageSize={6} currentPage={1} />);
        // 7 pages, all shown as buttons (not in the select dropdown)
        const pageButtons = screen.getAllByRole('button').filter(btn => {
            const text = btn.textContent?.trim();
            return text && /^\d+$/.test(text);
        });
        const pageNumbers = pageButtons.map(btn => Number(btn.textContent?.trim()));
        expect(pageNumbers).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('handles single page', () => {
        render(<Pagination {...defaultProps} totalItems={5} pageSize={12} currentPage={1} />);
        expect(screen.getByText('1–5 of 5 items')).toBeInTheDocument();
        expect(screen.getByLabelText('Previous page')).toBeDisabled();
        expect(screen.getByLabelText('Next page')).toBeDisabled();
    });

    it('exports DEFAULT_PAGE_SIZE', () => {
        expect(DEFAULT_PAGE_SIZE).toBe(12);
    });

    it('exports PAGE_SIZE_OPTIONS', () => {
        expect(PAGE_SIZE_OPTIONS).toEqual([6, 12, 24, 48]);
    });
});
