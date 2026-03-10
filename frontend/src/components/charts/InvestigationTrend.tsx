import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface TrendData {
    date: string;
    completed: number;
    failed: number;
}

interface Props {
    investigations: { id: string; status: string }[];
}

const CHART_COLORS = {
    completed: '#34d399',
    completedFill: 'rgba(52, 211, 153, 0.15)',
    failed: '#f87171',
    failedFill: 'rgba(248, 113, 113, 0.1)',
    grid: '#1e293b',
    text: '#64748b',
    tooltip: '#0f172a',
};

export const InvestigationTrend = ({ investigations }: Props) => {
    // Build daily counts for last 14 days
    const now = Date.now();
    const days = 14;
    const dayMs = 86400000;
    const data: TrendData[] = [];

    for (let i = days - 1; i >= 0; i--) {
        const dayStart = new Date(now - i * dayMs);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart.getTime() + dayMs);

        const dayInvs = investigations.filter(inv => {
            const ts = Number(inv.id);
            return !isNaN(ts) && ts >= dayStart.getTime() && ts < dayEnd.getTime();
        });

        data.push({
            date: dayStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            completed: dayInvs.filter(i => i.status === 'completed').length,
            failed: dayInvs.filter(i => i.status === 'failed').length,
        });
    }

    const hasData = data.some(d => d.completed > 0 || d.failed > 0);
    if (!hasData) {
        return (
            <div className="flex items-center justify-center h-full text-slate-600 text-xs">
                No trend data yet
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                    <linearGradient id="completedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={CHART_COLORS.completed} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={CHART_COLORS.completed} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="failedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={CHART_COLORS.failed} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={CHART_COLORS.failed} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <XAxis
                    dataKey="date"
                    tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
                    axisLine={{ stroke: CHART_COLORS.grid }}
                    tickLine={false}
                    interval="preserveStartEnd"
                />
                <YAxis
                    tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                />
                <Tooltip
                    contentStyle={{
                        backgroundColor: CHART_COLORS.tooltip,
                        border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '12px',
                        fontSize: '12px',
                        color: '#e2e8f0',
                        boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
                    }}
                    itemStyle={{ color: '#e2e8f0' }}
                />
                <Area
                    type="monotone"
                    dataKey="completed"
                    stroke={CHART_COLORS.completed}
                    strokeWidth={2}
                    fill="url(#completedGrad)"
                    name="Completed"
                />
                <Area
                    type="monotone"
                    dataKey="failed"
                    stroke={CHART_COLORS.failed}
                    strokeWidth={2}
                    fill="url(#failedGrad)"
                    name="Failed"
                />
            </AreaChart>
        </ResponsiveContainer>
    );
};
