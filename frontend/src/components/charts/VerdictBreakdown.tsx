import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import type { Investigation } from '../../api';

interface Props {
    investigations: Investigation[];
}

const VERDICT_COLORS: Record<string, string> = {
    healthy: '#34d399',
    warning: '#fbbf24',
    critical: '#f87171',
    error: '#ef4444',
    unknown: '#64748b',
};

const VERDICT_LABELS: Record<string, string> = {
    healthy: 'Healthy',
    warning: 'Warning',
    critical: 'Critical',
    error: 'Error',
    unknown: 'Unknown',
};

export const VerdictBreakdown = ({ investigations }: Props) => {
    const { scheduled, data, total, healthyPct } = useMemo(() => {
        const scheduled = investigations.filter(i => i.source === 'scheduled' && i.verdict);
        const counts = new Map<string, number>();
        for (const inv of scheduled) {
            counts.set(inv.verdict!, (counts.get(inv.verdict!) || 0) + 1);
        }
        const data = Array.from(counts.entries())
            .map(([name, value]) => ({ name: VERDICT_LABELS[name] || name, key: name, value }))
            .sort((a, b) => b.value - a.value);
        const total = scheduled.length;
        const healthyPct = total > 0 ? Math.round(((counts.get('healthy') || 0) / total) * 100) : 0;
        return { scheduled, data, total, healthyPct };
    }, [investigations]);

    if (scheduled.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-slate-600 text-xs">
                No scheduled verdicts
            </div>
        );
    }

    return (
        <div className="relative w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie
                        data={data}
                        cx="50%"
                        cy="50%"
                        innerRadius="60%"
                        outerRadius="85%"
                        paddingAngle={3}
                        dataKey="value"
                        stroke="none"
                    >
                        {data.map((entry) => (
                            <Cell key={entry.key} fill={VERDICT_COLORS[entry.key] || VERDICT_COLORS.unknown} />
                        ))}
                    </Pie>
                    <Tooltip
                        contentStyle={{
                            background: '#1e293b',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '8px',
                            fontSize: '11px',
                        }}
                        itemStyle={{ color: '#e2e8f0' }}
                        formatter={(value: number, name: string) => [
                            `${value} (${Math.round((value / total) * 100)}%)`,
                            name,
                        ]}
                    />
                </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-black text-white tabular-nums">{healthyPct}%</span>
                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Healthy</span>
            </div>
        </div>
    );
};
