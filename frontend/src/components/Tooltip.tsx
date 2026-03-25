import { useState, useRef, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';

interface TooltipProps {
    text: string;
    children?: React.ReactNode;
}

export const Tooltip = ({ text, children }: TooltipProps) => {
    const [visible, setVisible] = useState(false);
    const [above, setAbove] = useState(true);
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (visible && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setAbove(rect.top > 120);
        }
    }, [visible]);

    return (
        <span className="relative inline-flex items-center">
            {children}
            <button
                ref={triggerRef}
                type="button"
                className="ml-1 text-slate-500 hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded"
                onMouseEnter={() => setVisible(true)}
                onMouseLeave={() => setVisible(false)}
                onFocus={() => setVisible(true)}
                onBlur={() => setVisible(false)}
                aria-label="Help"
            >
                <HelpCircle className="w-3.5 h-3.5" />
            </button>
            {visible && (
                <span
                    role="tooltip"
                    className={`absolute z-50 left-1/2 -translate-x-1/2 px-3 py-2 text-xs text-slate-200 bg-slate-800 border border-slate-700/60 rounded-lg shadow-xl whitespace-normal max-w-xs w-max pointer-events-none ${
                        above ? 'bottom-full mb-2' : 'top-full mt-2'
                    }`}
                >
                    {text}
                </span>
            )}
        </span>
    );
};
