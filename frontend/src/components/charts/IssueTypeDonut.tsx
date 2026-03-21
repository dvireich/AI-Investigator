import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import type { Investigation } from '../../api';

interface Props {
    investigations: Investigation[];
}

const PALETTE = [
    '#38bdf8', // sky-400
    '#a78bfa', // violet-400
    '#fb923c', // orange-400
    '#34d399', // emerald-400
    '#f87171', // red-400
    '#facc15', // yellow-400
    '#2dd4bf', // teal-400
    '#e879f9', // fuchsia-400
];

const UNKNOWN_COLOR = '#64748b'; // slate-500

export const CategoryDonut = ({ investigations }: Props) => {
    // Count investigations by category
    const counts = new Map<string, number>();
    for (const inv of investigations) {
        const type = inv.category?.trim() || 'Unknown';
        counts.set(type, (counts.get(type) || 0) + 1);
    }

    if (counts.size === 0) {
        return (
            <div className="flex items-center justify-center h-full text-slate-600 text-xs">
                No data
            </div>
        );
    }

    // Sort descending by count, but keep "Unknown" last
    const data = Array.from(counts.entries())
        .sort((a, b) => {
            if (a[0] === 'Unknown') return 1;
            if (b[0] === 'Unknown') return -1;
            return b[1] - a[1];
        })
        .map(([name, value]) => ({ name, value }));

    // Assign colors: named types get palette colors, Unknown gets slate
    const colorMap = new Map<string, string>();
    let paletteIdx = 0;
    for (const d of data) {
        if (d.name === 'Unknown') {
            colorMap.set(d.name, UNKNOWN_COLOR);
        } else {
            colorMap.set(d.name, PALETTE[paletteIdx % PALETTE.length]);
            paletteIdx++;
        }
    }

    const total = investigations.length;

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
                            <Cell key={entry.name} fill={colorMap.get(entry.name)} />
                        ))}
                    </Pie>
                    <Tooltip
                        contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', fontSize: '11px' }}
                        itemStyle={{ color: '#e2e8f0' }}
                        formatter={(value: number, name: string) => [`${value} (${Math.round((value / total) * 100)}%)`, name]}
                    />
                </PieChart>
            </ResponsiveContainer>
            {/* Center label */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-black text-white tabular-nums">{data.length}</span>
                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{data.length === 1 ? 'Type' : 'Types'}</span>
            </div>
        </div>
    );
};
