import { useMemo } from 'react';
import { TrendingUp, Clock, CalendarDays, RotateCcw } from 'lucide-react';
import type { InvestigationStats } from '../../api';

interface Props {
    stats: InvestigationStats;
}

export const KpiBar = ({ stats }: Props) => {
    const kpis = useMemo(() => {
    const { successRate, resolvedCount, avgDurationMs, durationSamples, thisWeekCount, lastWeekCount, contestRate, contestableCount } = stats;

    const formatDuration = (ms: number): string => {
        if (ms === 0) return '--';
        const totalSec = Math.round(ms / 1000);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        if (mins >= 60) {
            const hrs = Math.floor(mins / 60);
            const m = mins % 60;
            return `${hrs}h ${m}m`;
        }
        if (mins > 0) return `${mins}m ${secs}s`;
        return `${secs}s`;
    };

    const weekDelta = thisWeekCount - lastWeekCount;
    const weekDeltaStr = weekDelta > 0 ? `+${weekDelta}` : weekDelta === 0 ? '±0' : `${weekDelta}`;
    const contested = contestableCount > 0 ? Math.round(contestRate * contestableCount / 100) : 0;

    const kpiItems = [
        {
            label: 'Success Rate',
            value: resolvedCount > 0 ? `${successRate}%` : '--',
            icon: TrendingUp,
            color: successRate >= 80 ? 'text-emerald-400' : successRate >= 50 ? 'text-yellow-400' : 'text-red-400',
            iconColor: successRate >= 80 ? 'text-emerald-400' : successRate >= 50 ? 'text-yellow-400' : 'text-red-400',
            sub: `${resolvedCount} resolved`,
        },
        {
            label: 'Avg Duration',
            value: formatDuration(avgDurationMs),
            icon: Clock,
            color: 'text-sky-400',
            iconColor: 'text-sky-400',
            sub: `${durationSamples} samples`,
        },
        {
            label: 'This Week',
            value: String(thisWeekCount),
            icon: CalendarDays,
            color: 'text-slate-100',
            iconColor: 'text-violet-400',
            sub: (
                <span className={weekDelta > 0 ? 'text-emerald-400' : weekDelta < 0 ? 'text-red-400' : 'text-slate-500'}>
                    {weekDeltaStr} vs last week
                </span>
            ),
        },
        {
            label: 'Contest Rate',
            value: contestableCount > 0 ? `${contestRate}%` : '--',
            icon: RotateCcw,
            color: contestRate > 20 ? 'text-orange-400' : 'text-slate-100',
            iconColor: contestRate > 20 ? 'text-orange-400' : 'text-slate-500',
            sub: `${contested} contested`,
        },
    ];

    return kpiItems;
    }, [stats]);

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {kpis.map(kpi => (
                <div key={kpi.label} className="glass-card rounded-xl p-3 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                        <kpi.icon className={`w-3.5 h-3.5 ${kpi.iconColor}`} />
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{kpi.label}</span>
                    </div>
                    <div className={`text-xl font-black tabular-nums ${kpi.color}`}>{kpi.value}</div>
                    <div className="text-slate-500 text-[10px]">{kpi.sub}</div>
                </div>
            ))}
        </div>
    );
};
