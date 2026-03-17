import { useMemo } from 'react';
import { TrendingUp, Clock, CalendarDays, RotateCcw } from 'lucide-react';
import type { Investigation } from '../../api';

interface Props {
    investigations: Investigation[];
}

export const KpiBar = ({ investigations }: Props) => {
    const kpis = useMemo(() => {
    // Success Rate
    const resolved = investigations.filter(i => i.status === 'completed' || i.status === 'failed' || i.status === 'aborted');
    const completed = investigations.filter(i => i.status === 'completed').length;
    const successRate = resolved.length > 0 ? Math.round((completed / resolved.length) * 100) : 0;

    // Avg Duration (using lastModified - id timestamp)
    const withDuration = investigations
        .filter(i => (i.status === 'completed' || i.status === 'failed') && i.lastModified && !isNaN(Number(i.id)))
        .map(i => i.lastModified! - Number(i.id))
        .filter(d => d > 0 && d < 86400000); // exclude > 24h as outliers

    const avgDurationMs = withDuration.length > 0
        ? withDuration.reduce((s, d) => s + d, 0) / withDuration.length
        : 0;

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

    // This Week count + delta vs last week
    const now = Date.now();
    const dayMs = 86400000;
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const dayOfWeek = today.getDay(); // 0=Sun
    const weekStart = today.getTime() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) * dayMs; // Monday
    const lastWeekStart = weekStart - 7 * dayMs;

    const thisWeek = investigations.filter(i => {
        const ts = Number(i.id);
        return !isNaN(ts) && ts >= weekStart;
    }).length;

    const lastWeek = investigations.filter(i => {
        const ts = Number(i.id);
        return !isNaN(ts) && ts >= lastWeekStart && ts < weekStart;
    }).length;

    const weekDelta = thisWeek - lastWeek;
    const weekDeltaStr = weekDelta > 0 ? `+${weekDelta}` : weekDelta === 0 ? '±0' : `${weekDelta}`;

    // Contest Rate
    const contestable = investigations.filter(i => i.status === 'completed' || i.status === 'failed');
    const contested = contestable.filter(i => (i.contestCount ?? 0) > 0).length;
    const contestRate = contestable.length > 0 ? Math.round((contested / contestable.length) * 100) : 0;

    const kpiItems = [
        {
            label: 'Success Rate',
            value: resolved.length > 0 ? `${successRate}%` : '--',
            icon: TrendingUp,
            color: successRate >= 80 ? 'text-emerald-400' : successRate >= 50 ? 'text-yellow-400' : 'text-red-400',
            iconColor: successRate >= 80 ? 'text-emerald-400' : successRate >= 50 ? 'text-yellow-400' : 'text-red-400',
            sub: `${resolved.length} resolved`,
        },
        {
            label: 'Avg Duration',
            value: formatDuration(avgDurationMs),
            icon: Clock,
            color: 'text-sky-400',
            iconColor: 'text-sky-400',
            sub: `${withDuration.length} samples`,
        },
        {
            label: 'This Week',
            value: String(thisWeek),
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
            value: contestable.length > 0 ? `${contestRate}%` : '--',
            icon: RotateCcw,
            color: contestRate > 20 ? 'text-orange-400' : 'text-slate-100',
            iconColor: contestRate > 20 ? 'text-orange-400' : 'text-slate-500',
            sub: `${contested} contested`,
        },
    ];

    return kpiItems;
    }, [investigations]);

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
