import { describe, it, expect, vi, beforeEach } from 'vitest';

const renderMock = vi.fn();
const createRootMock = vi.fn(() => ({ render: renderMock }));

vi.mock('react-dom/client', () => ({
    createRoot: createRootMock,
}));

vi.mock('../App.tsx', () => ({
    default: () => <div data-testid="mock-app">App</div>,
}));

vi.mock('../components/Toast', () => ({
    ToastProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="toast-provider">{children}</div>,
}));

describe('main bootstrap', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="root"></div>';
        createRootMock.mockClear();
        renderMock.mockClear();
    });

    it('creates the root and renders the application tree', async () => {
        await import('../main');

        expect(createRootMock).toHaveBeenCalledWith(document.getElementById('root'));
        expect(renderMock).toHaveBeenCalledTimes(1);
    });
});