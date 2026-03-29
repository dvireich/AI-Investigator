import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { Investigation } from '../../api';

interface Props {
    investigations: Investigation[];
}

const PALETTE = [
    '#a78bfa', // violet-400
    '#38bdf8', // sky-400
    '#34d399', // emerald-400
    '#fb923c', // orange-400
    '#f87171', // red-400
    '#e879f9', // fuchsia-400
    '#facc15', // yellow-400
    '#2dd4bf', // teal-400
];

export const ModelUsage = ({ investigations }: Props) => {
    const { counts, data } = useMemo(() => {
        const counts = new Map<string, number>();
        for (const inv of investigations) {
            const model = inv.model?.trim() || 'Unknown';
            counts.set(model, (counts.get(model) || 0) + 1);
        }
        const data = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([name, value], i) => ({
                model: name.length > 22 ? name.slice(0, 20) + '…' : name,
                fullModel: name,
                count: value,
                color: PALETTE[i % PALETTE.length],
            }));
        return { counts, data };
    }, [investigations]);

    if (counts.size === 0) {
        return (
            <div className="flex items-center justify-center h-full text-slate-600 text-xs">
                No model data
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <XAxis
                    type="number"
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                />
                <YAxis
                    type="category"
                    dataKey="model"
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={110}
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
                        const entry = data.find(d => d.model === label);
                        return entry?.fullModel || label;
                    }}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} name="Uses">
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.75} />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
};
