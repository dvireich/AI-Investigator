import { useState, useEffect, useRef } from 'react';

/** Animated count-up from 0 to target — plays once on first non-zero value */
export const useCountUp = (target: number, duration = 700) => {
    const [display, setDisplay] = useState(0);
    const seenNonZero = useRef(false);
    const rafRef = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (seenNonZero.current) {
            // Post-animation: schedule update via rAF to avoid synchronous setState in effect
            rafRef.current = requestAnimationFrame(() => setDisplay(target));
            return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current); };
        }
        if (target === 0) return;
        seenNonZero.current = true;
        let start: number | null = null;
        const step = (ts: number) => {
            if (start === null) start = ts;
            const p = Math.min((ts - start) / duration, 1);
            setDisplay(Math.round(p * target));
            if (p < 1) rafRef.current = requestAnimationFrame(step);
        };
        rafRef.current = requestAnimationFrame(step);
        return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current); };
    }, [target, duration]);
    return display;
};
