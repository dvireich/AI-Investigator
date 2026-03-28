import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

import { renderPdf, closeBrowser, resolveChromiumPath, __resetProcessHandlersFlag } from '../pdfRenderer';

describe('pdfRenderer', () => {
    beforeEach(() => {
        mockPage.setContent.mockClear();
        mockPage.pdf.mockClear();
        mockPage.close.mockClear();
        mockBrowser.newPage.mockClear();
        __resetProcessHandlersFlag();
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

        it('does not accumulate process listeners on repeated browser launches', async () => {
            const processOnSpy = vi.spyOn(process, 'on');
            // Force re-launch twice
            mockBrowser.connected = false;
            await renderPdf('test1', { id: '1', status: 'completed' });
            const firstCount = processOnSpy.mock.calls.filter(c => c[0] === 'exit').length;

            mockBrowser.connected = false;
            await renderPdf('test2', { id: '2', status: 'completed' });
            const secondCount = processOnSpy.mock.calls.filter(c => c[0] === 'exit').length;

            // Should only register once thanks to the guard
            expect(firstCount).toBe(1);
            expect(secondCount).toBe(1);

            processOnSpy.mockRestore();
            mockBrowser.connected = true;
        });
    });
});

describe('resolveChromiumPath', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns undefined when not packaged', () => {
        expect(resolveChromiumPath(false, tmpDir)).toBeUndefined();
    });

    it('returns undefined when packaged but no chromium directory', () => {
        expect(resolveChromiumPath(true, tmpDir)).toBeUndefined();
    });

    it('returns undefined when chromium dir exists but no chrome.exe found', () => {
        const subDir = path.join(tmpDir, 'chromium', 'v120.0.0');
        fs.mkdirSync(subDir, { recursive: true });
        // No chrome.exe inside
        expect(resolveChromiumPath(true, tmpDir)).toBeUndefined();
    });

    it('finds chrome.exe in a versioned subfolder', () => {
        const subDir = path.join(tmpDir, 'chromium', 'v120.0.0');
        fs.mkdirSync(subDir, { recursive: true });
        const chromePath = path.join(subDir, 'chrome.exe');
        fs.writeFileSync(chromePath, '');
        expect(resolveChromiumPath(true, tmpDir)).toBe(chromePath);
    });

    it('finds chrome.exe in flat layout when no versioned subfolder has it', () => {
        const chromiumDir = path.join(tmpDir, 'chromium');
        fs.mkdirSync(path.join(chromiumDir, 'empty-sub'), { recursive: true });
        const flat = path.join(chromiumDir, 'chrome.exe');
        fs.writeFileSync(flat, '');
        expect(resolveChromiumPath(true, tmpDir)).toBe(flat);
    });

    it('passes executablePath to puppeteer.launch when chromium is found', async () => {
        // Set up a fake chrome.exe
        const subDir = path.join(tmpDir, 'chromium', 'v121');
        fs.mkdirSync(subDir, { recursive: true });
        const chromePath = path.join(subDir, 'chrome.exe');
        fs.writeFileSync(chromePath, '');

        // Reset singleton so getBrowser re-runs with the new executablePath
        await closeBrowser();
        const { default: puppeteer } = await import('puppeteer');
        const launchSpy = puppeteer.launch as ReturnType<typeof vi.fn>;
        launchSpy.mockClear();

        await renderPdf('test', { id: '99', status: 'completed' }, resolveChromiumPath(true, tmpDir));
        expect(launchSpy).toHaveBeenCalledWith(
            expect.objectContaining({ executablePath: chromePath }),
        );
    });
});
