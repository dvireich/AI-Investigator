import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class',
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        screens: {
            'xs': '480px',
            'sm': '640px',
            'md': '768px',
            'lg': '1024px',
            'xl': '1280px',
            '2xl': '1536px',
        },
        extend: {
            colors: {
                'brand': {
                    50: '#f0f9ff',
                    100: '#e0f2fe',
                    200: '#bae6fd',
                    300: '#7dd3fc',
                    400: '#38bdf8',
                    500: '#0ea5e9',
                    600: '#0284c7',
                    700: '#0369a1',
                    800: '#075985',
                    900: '#0c4a6e',
                },
                'surface': {
                    DEFAULT: '#0a0f1a',
                    50: '#0d1321',
                    100: '#111827',
                    200: '#1e293b',
                    300: '#334155',
                },
            },
            keyframes: {
                shimmer: {
                    '0%': { backgroundPosition: '-200% center' },
                    '100%': { backgroundPosition: '200% center' },
                },
                'fade-in': {
                    '0%': { opacity: '0', transform: 'translateY(8px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'slide-up': {
                    '0%': { opacity: '0', transform: 'translateY(16px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                shine: {
                    '0%': { transform: 'translateX(-100%) skewX(-12deg)' },
                    '100%': { transform: 'translateX(200%) skewX(-12deg)' },
                },
                'glow-pulse': {
                    '0%, 100%': { opacity: '1', boxShadow: '0 0 8px 0 currentColor' },
                    '50%': { opacity: '0.6', boxShadow: '0 0 20px 4px currentColor' },
                },
                'gradient-shift': {
                    '0%': { backgroundPosition: '0% 50%' },
                    '50%': { backgroundPosition: '100% 50%' },
                    '100%': { backgroundPosition: '0% 50%' },
                },
                'dropzone-in': {
                    '0%': { opacity: '0', transform: 'scale(0.95)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                },
                'dropzone-icon': {
                    '0%, 100%': { transform: 'translateY(0)', opacity: '1' },
                    '50%': { transform: 'translateY(-6px)', opacity: '0.7' },
                },
                'dropzone-ring': {
                    '0%': { transform: 'scale(1)', opacity: '0.5' },
                    '100%': { transform: 'scale(1.8)', opacity: '0' },
                },
                'border-dance': {
                    '0%': { backgroundPosition: '0% 0%' },
                    '100%': { backgroundPosition: '200% 0%' },
                },
                'flicker-red': {
                    '0%':   { boxShadow: '0 0 6px 2px rgba(239,68,68,0.25)', borderColor: 'rgba(239,68,68,0.35)' },
                    '50%':  { boxShadow: '0 0 12px 4px rgba(239,68,68,0.4)',  borderColor: 'rgba(239,68,68,0.55)' },
                    '100%': { boxShadow: '0 0 6px 2px rgba(239,68,68,0.25)', borderColor: 'rgba(239,68,68,0.35)' },
                },
                'slide-in-bottom': {
                    '0%': { opacity: '0', transform: 'translateY(20px) scale(0.97)' },
                    '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
                },
                'expand-in': {
                    '0%': { opacity: '0', transform: 'scale(0.9)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                },
                'highlight-flash': {
                    '0%': { backgroundColor: 'rgba(14,165,233,0.15)' },
                    '100%': { backgroundColor: 'transparent' },
                },
                'celebrate': {
                    '0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(16,185,129,0.4)' },
                    '50%': { transform: 'scale(1.08)', boxShadow: '0 0 20px 8px rgba(16,185,129,0.3)' },
                    '100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(16,185,129,0)' },
                },
            },
            animation: {
                shimmer: 'shimmer 2s linear infinite',
                'fade-in': 'fade-in 0.3s ease-out',
                'slide-up': 'slide-up 0.4s ease-out',
                shine: 'shine 0.8s ease-in-out',
                'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
                'gradient-shift': 'gradient-shift 8s ease infinite',
                'dropzone-in': 'dropzone-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
                'dropzone-icon': 'dropzone-icon 2s ease-in-out infinite',
                'dropzone-ring': 'dropzone-ring 1.5s ease-out infinite',
                'border-dance': 'border-dance 3s linear infinite',
                'flicker-red': 'flicker-red 3s ease-in-out infinite',
                'slide-in-bottom': 'slide-in-bottom 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
                'expand-in': 'expand-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                'highlight-flash': 'highlight-flash 0.8s ease-out forwards',
                'celebrate': 'celebrate 1s ease-out',
            },
        },
    },
    plugins: [
        typography,
        function ({ addUtilities }) {
            addUtilities({
                '.scrollbar-hide': {
                    '-ms-overflow-style': 'none',
                    'scrollbar-width': 'none',
                    '&::-webkit-scrollbar': { display: 'none' },
                },
            });
        },
    ],
}
