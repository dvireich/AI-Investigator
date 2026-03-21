import '@testing-library/jest-dom/vitest';

// Polyfill scrollIntoView for jsdom (not implemented)
Element.prototype.scrollIntoView = () => {};
