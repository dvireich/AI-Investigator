import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';
import type { Investigation } from '../../api';

interface Props {
    investigations: Investigation[];
}

const STATUS_COLORS: Record<string, string> = {
    completed: '#34d399',
    failed: '#f87171',
    running: '#38bdf8',
    paused: '#fbbf24',
    aborted: '#64748b',
};

export const TargetActivity = ({ investigations }: Props) => {
    // Group by stamp, count per status
    const stampMap = new Map<string, Record<string, number>>();

    for (const inv of investigations) {
        const stamp = inv.target?.trim() || 'Unknown';
        if (!stampMap.has(stamp)) {
            stampMap.set(stamp, { completed: 0, failed: 0, running: 0, paused: 0, aborted: 0 });
        }
        const counts = stampMap.get(stamp)!;
        counts[inv.status] = (counts[inv.status] || 0) + 1;
    }

    if (stampMap.size === 0) {
        return (
            <div className="flex items-center justify-center h-full text-slate-600 text-xs">
                No stamp data
            </div>
        );
    }

    // Sort by total count descending, take top 8
    const sorted = Array.from(stampMap.entries())
        .map(([stamp, counts]) => ({
            stamp: stamp.length > 20 ? stamp.slice(0, 18) + '…' : stamp,
            fullStamp: stamp,
            ...counts,
            total: Object.values(counts).reduce((s, v) => s + v, 0),
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 8);

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <XAxis
                    type="number"
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                />
                <YAxis
                    type="category"
                    dataKey="stamp"
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={100}
                />
                <Tooltip
                    contentStyle={{
                        backgroundColor: '#0f172a',
                        border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '12px',
                        fontSize: '12px',
                        color: '#e2e8f0',
                        boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
                    }}
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                    labelFormatter={(label: string) => {
                        const entry = sorted.find(s => s.target === label);
                        return entry?.fullStamp || label;
                    }}
                />
                <Bar dataKey="completed" stackId="a" fill={STATUS_COLORS.completed} name="Completed" radius={0} />
                <Bar dataKey="failed" stackId="a" fill={STATUS_COLORS.failed} name="Failed" radius={0} />
                <Bar dataKey="running" stackId="a" fill={STATUS_COLORS.running} name="Running" radius={0} />
                <Bar dataKey="paused" stackId="a" fill={STATUS_COLORS.paused} name="Paused" radius={0} />
                <Bar dataKey="aborted" stackId="a" fill={STATUS_COLORS.aborted} name="Aborted" radius={[0, 4, 4, 0]} />
            </BarChart>
        </ResponsiveContainer>
    );
};
