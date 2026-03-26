import React from 'react';

interface ProgressRingProps {
    current: number;
    max: number;
    size?: number;
    strokeWidth?: number;
    className?: string;
    ringColorClass?: string;
}

export const ProgressRing: React.FC<ProgressRingProps> = React.memo(({
    current,
    max,
    size = 40,
    strokeWidth = 3,
    className = '',
    ringColorClass = 'text-brand-400',
}) => {
    const effectiveMax = max > 0 ? max : 50;
    const pct = Math.min(current / effectiveMax, 1);
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - pct);
    const percent = Math.round(pct * 100);

    return (
        <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
            <svg width={size} height={size} className="transform -rotate-90">
                {/* Background circle */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={strokeWidth}
                    className="text-slate-700/50"
                />
                {/* Progress arc */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={strokeWidth}
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    className={`${ringColorClass} transition-all duration-500`}
                />
            </svg>
            <span className="absolute text-[9px] font-bold text-slate-300">{percent}%</span>
        </div>
    );
});

ProgressRing.displayName = 'ProgressRing';
