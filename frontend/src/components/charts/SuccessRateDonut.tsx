import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface Props {
    completed: number;
    failed: number;
    aborted: number;
}

const COLORS = {
    completed: '#34d399',
    failed: '#f87171',
    aborted: '#64748b',
};

export const SuccessRateDonut = ({ completed, failed, aborted }: Props) => {
    const total = completed + failed + aborted;
    if (total === 0) {
        return (
            <div className="flex items-center justify-center h-full text-slate-600 text-xs">
                No data
            </div>
        );
    }

    const rate = Math.round((completed / total) * 100);
    const data = [
        { name: 'Completed', value: completed },
        { name: 'Failed', value: failed },
        { name: 'Aborted', value: aborted },
    ].filter(d => d.value > 0);

    const colorMap: Record<string, string> = {
        Completed: COLORS.completed,
        Failed: COLORS.failed,
        Aborted: COLORS.aborted,
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
            {/* Center label */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-black text-white tabular-nums">{rate}%</span>
                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Success</span>
            </div>
        </div>
    );
};
