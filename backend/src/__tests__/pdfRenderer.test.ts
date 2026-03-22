import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to define mock variables that can be referenced in vi.mock factory
const { mockPage, mockBrowser } = vi.hoisted(() => {
    const mockPage = {
        setContent: vi.fn(),
        pdf: vi.fn().mockResolvedValue(Buffer.from('fake-pdf')),
        close: vi.fn(),
    };
    const mockBrowser = {
        connected: true,
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined),
    };
    return { mockPage, mockBrowser };
});

vi.mock('puppeteer', () => ({
    default: {
        launch: vi.fn().mockResolvedValue(mockBrowser),
    },
}));

import { renderPdf, closeBrowser } from '../pdfRenderer';

describe('pdfRenderer', () => {
    beforeEach(() => {
        mockPage.setContent.mockClear();
        mockPage.pdf.mockClear();
        mockPage.close.mockClear();
        mockBrowser.newPage.mockClear();
    });
    describe('renderPdf', () => {
        it('renders a PDF from markdown and metadata', async () => {
            const pdf = await renderPdf('# Hello World\n\nTest report content', {
                id: '1234567890',
                status: 'completed',
                target: 'test-target',
                model: 'gpt-4o',
            });
            expect(Buffer.isBuffer(pdf)).toBe(true);
            expect(mockPage.setContent).toHaveBeenCalled();
            expect(mockPage.pdf).toHaveBeenCalledWith(expect.objectContaining({ format: 'A4' }));
            expect(mockPage.close).toHaveBeenCalled();
        });

        it('includes metadata in generated HTML', async () => {
            await renderPdf('Report', {
                id: '1000',
                status: 'completed',
                target: 'my-target',
                timeRange: 'ago(1h)',
                category: 'latency',
                correlationId: 'abc',
                incidentId: '42',
                model: 'gpt-4o',
                productName: 'MyProduct',
                contestCount: 2,
            });
            const html = mockPage.setContent.mock.calls[0][0] as string;
            expect(html).toContain('my-target');
            expect(html).toContain('ago(1h)');
            expect(html).toContain('latency');
            expect(html).toContain('abc');
            expect(html).toContain('42');
            expect(html).toContain('gpt-4o');
            expect(html).toContain('MyProduct');
            expect(html).toContain('2');
        });

        it('handles markdown features', async () => {
            const md = [
                '# Header 1',
                '## Header 2',
                '### Header 3',
                '#### Header 4',
                '##### Header 5',
                '###### Header 6',
                '',
                '**bold** *italic* ***both***',
                '',
                '`inline code`',
                '',
                '```javascript',
                'const x = 1;',
                '```',
                '',
                '| Col1 | Col2 |',
                '| --- | --- |',
                '| A | B |',
                '',
                '- item 1',
                '- item 2',
                '',
                '1. ordered',
                '',
                '[link](https://example.com)',
                '',
                '---',
            ].join('\n');

            await renderPdf(md, { id: '1', status: 'completed' });
            const html = mockPage.setContent.mock.calls[0][0] as string;
            expect(html).toContain('<h1>');
            expect(html).toContain('<h2>');
            expect(html).toContain('<h3>');
            expect(html).toContain('<h4>');
            expect(html).toContain('<h5>');
            expect(html).toContain('<h6>');
            expect(html).toContain('<strong>');
            expect(html).toContain('<em>');
            expect(html).toContain('<code>');
            expect(html).toContain('<pre>');
            expect(html).toContain('<table>');
            expect(html).toContain('<ul>');
            expect(html).toContain('<li>');
            expect(html).toContain('<a href=');
            expect(html).toContain('<hr>');
        });

        it('escapes HTML in metadata', async () => {
            await renderPdf('test', {
                id: '1',
                status: 'completed',
                target: '<script>alert("xss")</script>',
            });
            const html = mockPage.setContent.mock.calls[0][0] as string;
            expect(html).not.toContain('<script>');
            expect(html).toContain('&lt;script&gt;');
        });

        it('reuses browser singleton', async () => {
            await renderPdf('test1', { id: '1', status: 'completed' });
            await renderPdf('test2', { id: '2', status: 'completed' });
            // Should reuse the connected browser
        });

        it('handles various status badge types', async () => {
            for (const status of ['completed', 'failed', 'aborted', 'paused']) {
                mockPage.setContent.mockClear();
                await renderPdf('test', { id: '1', status });
                const html = mockPage.setContent.mock.calls[0][0] as string;
                expect(html).toContain(`status-${status}`);
            }
        });

        it('defaults to "text" for code blocks without language identifier', async () => {
            const md = '```\nconst x = 1;\n```';
            await renderPdf(md, { id: '1', status: 'completed' });
            const html = mockPage.setContent.mock.calls[0][0] as string;
            expect(html).toContain('language-text');
        });

        it('handles empty blocks from multiple consecutive blank lines', async () => {
            // Triple blank lines produce an empty block (trimmed = ''), which should return ''
            const md = 'First paragraph\n\n\n\nSecond paragraph';
            await renderPdf(md, { id: '1', status: 'completed' });
            const html = mockPage.setContent.mock.calls[0][0] as string;
            expect(html).toContain('First paragraph');
            expect(html).toContain('Second paragraph');
        });

        it('uses Unknown for non-numeric investigation id', async () => {
            await renderPdf('Report content', { id: 'not-a-number', status: 'completed' });
            const html = mockPage.setContent.mock.calls[0][0] as string;
            expect(html).toContain('Unknown');
        });
    });

    describe('closeBrowser', () => {
        it('closes the browser singleton', async () => {
            // First render to create browser
            await renderPdf('test', { id: '1', status: 'completed' });
            await closeBrowser();
            expect(mockBrowser.close).toHaveBeenCalled();
        });

        it('registers process exit cleanup handler', async () => {
            const processOnSpy = vi.spyOn(process, 'on');
            // Force a new browser launch by marking the mock as disconnected
            mockBrowser.connected = false;
            await renderPdf('test', { id: '1', status: 'completed' });
            // Cleanup listeners should be registered on process
            expect(processOnSpy).toHaveBeenCalledWith('exit', expect.any(Function));
            expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
            expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
            // Call the cleanup handler directly
            const exitHandler = processOnSpy.mock.calls.find(c => c[0] === 'exit')![1] as Function;
            exitHandler();
            expect(mockBrowser.close).toHaveBeenCalled();
            processOnSpy.mockRestore();
            mockBrowser.connected = true;
        });
    });
});
