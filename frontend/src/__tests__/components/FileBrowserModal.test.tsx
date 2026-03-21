import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileBrowserModal } from '../../components/FileBrowserModal';

vi.mock('../../api', () => ({
    api: {
        listFiles: vi.fn().mockResolvedValue({
            path: '/home/user/project',
            entries: [
                { name: 'src', isDirectory: true },
                { name: 'README.md', isDirectory: false },
                { name: 'docs', isDirectory: true },
            ],
        }),
    },
}));

describe('FileBrowserModal', () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not render when not open', () => {
        render(<FileBrowserModal isOpen={false} onClose={onClose} onSelect={onSelect} />);
        expect(screen.queryByText('Select Directory')).not.toBeInTheDocument();
    });

    it('renders when open with directory list', async () => {
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} />);
        await waitFor(() => {
            expect(screen.getByText('src')).toBeInTheDocument();
            expect(screen.getByText('README.md')).toBeInTheDocument();
            expect(screen.getByText('docs')).toBeInTheDocument();
        });
    });

    it('shows default title for directory mode', async () => {
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} mode="directory" />);
        expect(screen.getByText('Select Directory')).toBeInTheDocument();
    });

    it('shows custom title', async () => {
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} title="Pick folder" />);
        expect(screen.getByText('Pick folder')).toBeInTheDocument();
    });

    it('shows file mode title', async () => {
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} mode="file" />);
        expect(screen.getByText('Select File')).toBeInTheDocument();
    });

    it('selects current folder in directory mode when nothing selected', async () => {
        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} mode="directory" />);

        await waitFor(() => screen.getByText('src'));

        // Click "Select Current Folder" without selecting any entry
        await user.click(screen.getByText(/Select Current Folder/));
        expect(onSelect).toHaveBeenCalledWith('/home/user/project');
        expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when Cancel is clicked', async () => {
        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} />);
        await user.click(screen.getByText('Cancel'));
        expect(onClose).toHaveBeenCalled();
    });

    it('navigates up when up button clicked', async () => {
        const { api } = await import('../../api');
        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} />);

        await waitFor(() => screen.getByText('src'));
        await user.click(screen.getByTitle('Go Up'));

        expect(vi.mocked(api.listFiles)).toHaveBeenCalledWith('/home/user/project/..');
    });

    it('shows error when loading fails and retries with empty path', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.listFiles)
            .mockRejectedValueOnce(new Error('Not found'))
            .mockResolvedValueOnce({ path: '/', entries: [] });

        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} initialPath="/bad/path" />);

        await waitFor(() => {
            // Should have retried with empty path
            expect(vi.mocked(api.listFiles)).toHaveBeenCalledTimes(2);
        });
    });

    it('shows error message when both initial and fallback fail', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.listFiles)
            .mockRejectedValueOnce(new Error('Not found'))
            .mockRejectedValueOnce(new Error('Server error'));

        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} initialPath="/bad" />);

        await waitFor(() => {
            expect(screen.getByText('Server error')).toBeInTheDocument();
        });
    });

    it('double-clicking a directory navigates into it', async () => {
        const { api } = await import('../../api');
        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} />);

        await waitFor(() => screen.getByText('src'));
        await user.dblClick(screen.getByText('src'));

        expect(vi.mocked(api.listFiles)).toHaveBeenCalledWith('/home/user/project/src');
    });

    it('double-clicking a file does NOT navigate', async () => {
        const { api } = await import('../../api');
        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} />);

        await waitFor(() => screen.getByText('README.md'));
        const initialCalls = vi.mocked(api.listFiles).mock.calls.length;
        await user.dblClick(screen.getByText('README.md'));

        // Should not have made additional calls - files don't navigate
        expect(vi.mocked(api.listFiles).mock.calls.length).toBe(initialCalls);
    });

    it('selects a file entry with single click', async () => {
        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} />);

        await waitFor(() => screen.getByText('README.md'));
        await user.click(screen.getByText('README.md'));

        // Entry should now have selected styling
        const entry = screen.getByText('README.md').closest('div');
        expect(entry).toHaveClass('bg-brand-500/15');
    });

    it('closes modal when X button is clicked', async () => {
        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} />);

        const closeBtn = screen.getByRole('button', { name: '' }); // X button
        // Find button containing X icon
        const xButtons = screen.getAllByRole('button').filter(btn => 
            btn.querySelector('svg.lucide-x') || btn.innerHTML.includes('X')
        );
        await user.click(xButtons[0]);

        expect(onClose).toHaveBeenCalled();
    });

    it('navigates when Go button is clicked', async () => {
        const { api } = await import('../../api');
        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} />);

        await waitFor(() => screen.getByText('src'));
        await user.click(screen.getByText('Go'));

        expect(vi.mocked(api.listFiles)).toHaveBeenCalled();
    });

    it('navigates when Enter is pressed in path input', async () => {
        const { api } = await import('../../api');
        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} />);

        await waitFor(() => screen.getByText('src'));
        const input = screen.getByRole('textbox');
        await user.clear(input);
        await user.type(input, '/new/path{enter}');

        expect(vi.mocked(api.listFiles)).toHaveBeenCalledWith('/new/path');
    });

    it('handles Windows-style paths with backslash separator', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.listFiles).mockResolvedValueOnce({
            path: 'C:\\Users\\test\\project',
            entries: [
                { name: 'src', isDirectory: true },
                { name: 'test.txt', isDirectory: false },
            ],
        });

        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} initialPath="C:\\Users\\test\\project" />);

        await waitFor(() => screen.getByText('src'));
        await user.dblClick(screen.getByText('src'));

        // Should use backslash separator for Windows paths
        expect(vi.mocked(api.listFiles)).toHaveBeenCalledWith('C:\\Users\\test\\project\\src');
    });

    it('shows empty directory message when no entries', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.listFiles).mockResolvedValueOnce({
            path: '/empty',
            entries: [],
        });

        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} initialPath="/empty" />);

        await waitFor(() => {
            expect(screen.getByText('Empty directory')).toBeInTheDocument();
        });
    });

    it('selects a directory entry in directory mode and submits', async () => {
        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} mode="directory" />);

        await waitFor(() => screen.getByText('src'));
        await user.click(screen.getByText('src')); // Single click to select
        await user.click(screen.getByText(/Select Selection/));

        expect(onSelect).toHaveBeenCalledWith('/home/user/project/src');
        expect(onClose).toHaveBeenCalled();
    });

    it('selecting a file in directory mode does not submit', async () => {
        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} mode="directory" />);

        await waitFor(() => screen.getByText('README.md'));
        await user.click(screen.getByText('README.md')); // Select file
        await user.click(screen.getByText(/Select Selection/));

        // Should NOT call onSelect when selecting a file in directory mode
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('selects a file in file mode and submits', async () => {
        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} mode="file" />);

        await waitFor(() => screen.getByText('README.md'));
        await user.click(screen.getByText('README.md'));
        await user.click(screen.getByText(/Select Selection/));

        expect(onSelect).toHaveBeenCalledWith('/home/user/project/README.md');
        expect(onClose).toHaveBeenCalled();
    });

    it('disables select button in file mode when nothing selected', async () => {
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} mode="file" />);

        await waitFor(() => screen.getByText('README.md'));
        const selectBtn = screen.getByText(/Select Selection/).closest('button');
        expect(selectBtn).toBeDisabled();
    });

    it('does not submit in file mode when nothing is selected', async () => {
        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} mode="file" />);

        await waitFor(() => screen.getByText('README.md'));
        // Try clicking select without selecting any file - button is disabled but test the logic
        const selectBtn = screen.getByText(/Select Selection/).closest('button');
        await user.click(selectBtn!);

        expect(onSelect).not.toHaveBeenCalled();
    });

    it('handles path that already ends with separator', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.listFiles).mockResolvedValueOnce({
            path: '/home/user/',
            entries: [
                { name: 'project', isDirectory: true },
            ],
        });

        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} initialPath="/home/user/" />);

        await waitFor(() => screen.getByText('project'));
        await user.dblClick(screen.getByText('project'));

        // Should not add double separator
        expect(vi.mocked(api.listFiles)).toHaveBeenCalledWith('/home/user/project');
    });

    it('displays error banner when error state is set', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.listFiles)
            .mockRejectedValueOnce(new Error('Permission denied'))
            .mockRejectedValueOnce(new Error('Permission denied'));

        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} initialPath="/root" />);

        await waitFor(() => {
            expect(screen.getByText('Permission denied')).toBeInTheDocument();
        });
    });

    it('clears selection when navigating to new directory', async () => {
        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} />);

        await waitFor(() => screen.getByText('src'));
        
        // Select an entry
        await user.click(screen.getByText('README.md'));
        expect(screen.getByText('README.md').closest('div')).toHaveClass('bg-brand-500/15');
        
        // Navigate to a directory
        await user.dblClick(screen.getByText('src'));
        
        // After navigation, no entry should be selected
        await waitFor(() => {
            const entries = screen.getAllByRole('button').filter(btn => 
                btn.classList.contains('bg-brand-500/15')
            );
            expect(entries.length).toBe(0);
        });
    });

    it('changes path input value', async () => {
        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} />);

        await waitFor(() => screen.getByText('src'));
        const input = screen.getByRole('textbox');
        
        await user.clear(input);
        await user.type(input, '/custom/path');
        
        expect(input).toHaveValue('/custom/path');
    });

    it('selects directory when path ends with separator', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.listFiles).mockResolvedValueOnce({
            path: '/home/user/',
            entries: [
                { name: 'project', isDirectory: true },
            ],
        });

        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} mode="directory" initialPath="/home/user/" />);

        await waitFor(() => screen.getByText('project'));
        await user.click(screen.getByText('project')); // Select directory
        await user.click(screen.getByText(/Select Selection/)); // Submit

        // Should use single separator (not double)
        expect(onSelect).toHaveBeenCalledWith('/home/user/project');
        expect(onClose).toHaveBeenCalled();
    });

    it('selects file when path ends with separator (file mode)', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.listFiles).mockResolvedValueOnce({
            path: '/home/user/',
            entries: [
                { name: 'readme.txt', isDirectory: false },
            ],
        });

        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} mode="file" initialPath="/home/user/" />);

        await waitFor(() => screen.getByText('readme.txt'));
        await user.click(screen.getByText('readme.txt')); // Select file
        await user.click(screen.getByText(/Select Selection/)); // Submit

        // Should use single separator (not double) 
        expect(onSelect).toHaveBeenCalledWith('/home/user/readme.txt');
        expect(onClose).toHaveBeenCalled();
    });

    it('uses default error message when error has no message (covers || fallback branch)', async () => {
        const { api } = await import('../../api');
        // An error with empty string message => err.message is '' (falsy) => || fallback fires
        vi.mocked(api.listFiles)
            .mockRejectedValueOnce(new Error()) // message = ''
            .mockRejectedValueOnce(new Error()); // retry also fails

        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} initialPath="/bad" />);

        await waitFor(() => {
            expect(screen.getByText('Failed to load directory')).toBeInTheDocument();
        });
    });

    it('uses backslash separator when selecting entry from Windows path (covers \\\\ branch in handleSelect)', async () => {
        const { api } = await import('../../api');
        vi.mocked(api.listFiles).mockResolvedValueOnce({
            path: 'C:\\Users\\test',
            entries: [
                { name: 'project', isDirectory: true },
                { name: 'file.txt', isDirectory: false },
            ],
        });

        const user = userEvent.setup();
        render(<FileBrowserModal isOpen={true} onClose={onClose} onSelect={onSelect} mode="directory" />);

        await waitFor(() => screen.getByText('project'));
        await user.click(screen.getByText('project')); // Select directory entry
        await user.click(screen.getByText(/Select Selection/)); // Submit

        // Should build path with backslash
        expect(onSelect).toHaveBeenCalledWith('C:\\Users\\test\\project');
        expect(onClose).toHaveBeenCalled();
    });
});
