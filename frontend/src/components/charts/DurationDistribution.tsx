import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface Props {
    investigations: { id: string; status: string; lastModified?: number; thoughts?: any[]; thoughtCount?: number }[];
}

const BUCKETS = [
    { label: '< 1m', max: 60000, color: '#34d399' },
    { label: '1-5m', max: 300000, color: '#38bdf8' },
    { label: '5-15m', max: 900000, color: '#a78bfa' },
    { label: '15-30m', max: 1800000, color: '#fbbf24' },
    { label: '30m+', max: Infinity, color: '#f87171' },
];

export const DurationDistribution = ({ investigations }: Props) => {
    const finished = investigations.filter(
        i => (i.status === 'completed' || i.status === 'failed') && !isNaN(Number(i.id))
    );

    if (finished.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-slate-600 text-xs">
                No duration data yet
            </div>
        );
    }

    // Use real duration: lastModified - id timestamp, with step-based fallback
    const data = BUCKETS.map(bucket => ({ name: bucket.label, count: 0, color: bucket.color }));

    finished.forEach(inv => {
        const startTs = Number(inv.id);
        let duration: number;

        if (inv.lastModified && inv.lastModified > startTs) {
            duration = inv.lastModified - startTs;
        } else {
            // Fallback: estimate from step count
            const stepCount = inv.thoughtCount ?? inv.thoughts?.length ?? 0;
            duration = stepCount * 15000;
        }
        
        for (let i = 0; i < BUCKETS.length; i++) {
            if (duration < BUCKETS[i].max) {
                data[i].count++;
                break;
            }
        }
    });

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis
                    dataKey="name"
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    axisLine={{ stroke: '#1e293b' }}
                    tickLine={false}
                />
                <YAxis
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
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
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} name="Investigations">
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.7} />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
};
