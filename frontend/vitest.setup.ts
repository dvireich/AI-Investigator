import '@testing-library/jest-dom/vitest';

// Polyfill scrollIntoView for jsdom (not implemented)
Element.prototype.scrollIntoView = () => {};

// Polyfill ResizeObserver for jsdom (not implemented). Used by the live-session
// auto-scroll effect in InvestigationDetail.
class ResizeObserverStub {
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || ResizeObserverStub;
