import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import type { Investigation } from '../../api';

interface Props {
    investigations: Investigation[];
}

const COLORS = {
    contested: '#fb923c',  // orange-400
    uncontested: '#334155', // slate-700
};

export const ContestRate = ({ investigations }: Props) => {
    const resolved = investigations.filter(
        i => i.status === 'completed' || i.status === 'failed'
    );

    if (resolved.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-slate-600 text-xs">
                No data
            </div>
        );
    }

    const contested = resolved.filter(i => (i.contestCount ?? 0) > 0).length;
    const uncontested = resolved.length - contested;
    const rate = Math.round((contested / resolved.length) * 100);

    const data = [
        { name: 'Contested', value: contested },
        { name: 'Uncontested', value: uncontested },
    ].filter(d => d.value > 0);

    const colorMap: Record<string, string> = {
        Contested: COLORS.contested,
        Uncontested: COLORS.uncontested,
    };

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
                            <Cell key={entry.name} fill={colorMap[entry.name]} />
                        ))}
                    </Pie>
                </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-black text-white tabular-nums">{rate}%</span>
                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Contested</span>
            </div>
        </div>
    );
};
