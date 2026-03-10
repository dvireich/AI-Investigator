
export const TIME_PRESETS = [
    { label: 'Past 1 Hour', value: 'ago(1h)' },
    { label: 'Past 2 Hours', value: 'ago(2h)' },
    { label: 'Past 6 Hours', value: 'ago(6h)' },
    { label: 'Past 12 Hours', value: 'ago(12h)' },
    { label: 'Past 24 Hours', value: 'ago(24h)' },
    { label: 'Past 3 Days', value: 'ago(3d)' },
    { label: 'Past 7 Days', value: 'ago(7d)' },
    { label: 'Past 30 Days', value: 'ago(30d)' },
];

export const INVESTIGATION_MODES = [
    { label: 'Standard Investigation', value: 'standard', description: 'Investigate by stamp, time range, and issue type' },
    { label: 'ICM Incident', value: 'icm', description: 'Start from an IcM incident - auto-extracts context' },
] as const;

export type InvestigationMode = typeof INVESTIGATION_MODES[number]['value'];
