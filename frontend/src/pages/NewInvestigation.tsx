import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type IcmIncidentPreview, type IcmProgressEvent, type Product, type ProductValidation } from '../api';
import { Search, Command, Clock, AlertTriangle, ArrowRight, Sparkles, Zap, Target, ShieldAlert, Loader2, CheckCircle2, Circle, AlertCircle, Package, Calendar } from 'lucide-react';
import { TIME_PRESETS, INVESTIGATION_MODES, type InvestigationMode } from '../constants';

/**
 * Try to parse a flexible timestamp string into a Date object.
 * Supports: ISO 8601, various date/time formats, Unix timestamps, etc.
 * Returns null if parsing fails.
 */
function parseFlexibleTimestamp(input: string): Date | null {
    if (!input || !input.trim()) return null;
    
    const trimmed = input.trim();
    
    // Try direct Date parse first (handles ISO 8601, etc.)
    let parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) return parsed;
    
    // Try common formats with regex replacements
    // Format: "2024-03-15 14:30:00" or "2024/03/15 14:30:00"
    const dashSlashFormat = trimmed.replace(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/, 
        (_, y, m, d, h, min, s) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${min}:${s || '00'}`);
    parsed = new Date(dashSlashFormat);
    if (!isNaN(parsed.getTime())) return parsed;
    
    // Format: "03/15/2024 2:30 PM" or "3/15/2024 14:30"
    const usFormatMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (usFormatMatch) {
        let [, month, day, year, hour, min, sec, ampm] = usFormatMatch;
        let h = parseInt(hour);
        if (ampm) {
            if (ampm.toUpperCase() === 'PM' && h !== 12) h += 12;
            if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;
        }
        parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), h, parseInt(min), parseInt(sec || '0'));
        if (!isNaN(parsed.getTime())) return parsed;
    }
    
    // Unix timestamp (seconds or milliseconds)
    if (/^\d{10,13}$/.test(trimmed)) {
        const ts = parseInt(trimmed);
        parsed = new Date(ts < 1e12 ? ts * 1000 : ts);
        if (!isNaN(parsed.getTime())) return parsed;
    }
    
    // Format: "Mar 15, 2024 14:30" or "March 15 2024 2:30 PM"
    parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) return parsed;
    
    return null;
}

/** Format Date to datetime-local input value */
function toDateTimeLocalValue(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Format Date to display string */
function formatDateDisplay(date: Date): string {
    return date.toLocaleString(undefined, { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric',
        hour: '2-digit', 
        minute: '2-digit'
    });
}

/** Format the KQL time range into a human-readable string */
function formatTimeRange(timeRange: string): string {
    // Extract dates from format: between(datetime(ISO) .. datetime(ISO))
    const match = timeRange.match(/datetime\(([^)]+)\)\s*\.\.\s*datetime\(([^)]+)\)/);
    if (!match) return 'Time range set';
    
    try {
        const start = new Date(match[1]);
        const end = new Date(match[2]);
        
        const formatShort = (d: Date) => {
            const month = (d.getMonth() + 1).toString().padStart(2, '0');
            const day = d.getDate().toString().padStart(2, '0');
            const hours = d.getHours().toString().padStart(2, '0');
            const mins = d.getMinutes().toString().padStart(2, '0');
            return `${month}/${day} ${hours}:${mins}`;
        };
        
        return `${formatShort(start)} → ${formatShort(end)}`;
    } catch {
        return 'Time range set';
    }
}

export const NewInvestigation = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [models, setModels] = useState<string[]>([]);

    // Investigation Mode State
    const [mode, setMode] = useState<InvestigationMode>('standard');

    // ICM State
    const [incidentId, setIncidentId] = useState('');
    const [icmLoading, setIcmLoading] = useState(false);
    const [icmPreview, setIcmPreview] = useState<IcmIncidentPreview | null>(null);
    const [icmError, setIcmError] = useState('');
    const [icmAvailable, setIcmAvailable] = useState<boolean | null>(null);
    const [icmSteps, setIcmSteps] = useState<IcmProgressEvent[]>([]);

    // Product State
    const [products, setProducts] = useState<Product[]>([]);
    const [selectedProductId, setSelectedProductId] = useState<string>('');

    // Product validation state
    const [productValidation, setProductValidation] = useState<ProductValidation | null>(null);
    // Time Range State
    const [timeMode, setTimeMode] = useState<'preset' | 'custom'>('preset');
    const [timePreset, setTimePreset] = useState('ago(1h)');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    
    // Flexible time input state
    const [startTimeText, setStartTimeText] = useState('');
    const [endTimeText, setEndTimeText] = useState('');
    const [startTimeValid, setStartTimeValid] = useState<boolean | null>(null); // null = not yet validated
    const [endTimeValid, setEndTimeValid] = useState<boolean | null>(null);
    const startPickerRef = useRef<HTMLInputElement>(null);
    const endPickerRef = useRef<HTMLInputElement>(null);

    // Validate and sync time text with customStart/customEnd
    const handleStartTimeChange = (text: string) => {
        setStartTimeText(text);
        if (!text.trim()) {
            setStartTimeValid(null);
            setCustomStart('');
            return;
        }
        const parsed = parseFlexibleTimestamp(text);
        if (parsed) {
            setStartTimeValid(true);
            setCustomStart(toDateTimeLocalValue(parsed));
        } else {
            setStartTimeValid(false);
            setCustomStart('');
        }
    };

    const handleEndTimeChange = (text: string) => {
        setEndTimeText(text);
        if (!text.trim()) {
            setEndTimeValid(null);
            setCustomEnd('');
            return;
        }
        const parsed = parseFlexibleTimestamp(text);
        if (parsed) {
            setEndTimeValid(true);
            setCustomEnd(toDateTimeLocalValue(parsed));
        } else {
            setEndTimeValid(false);
            setCustomEnd('');
        }
    };

    // Handle picker selection
    const handleStartPickerChange = (value: string) => {
        setCustomStart(value);
        if (value) {
            const date = new Date(value);
            setStartTimeText(formatDateDisplay(date));
            setStartTimeValid(true);
        }
    };

    const handleEndPickerChange = (value: string) => {
        setCustomEnd(value);
        if (value) {
            const date = new Date(value);
            setEndTimeText(formatDateDisplay(date));
            setEndTimeValid(true);
        }
    };

    const [formData, setFormData] = useState({
        stamp: '',
        trackingId: '',
        issueType: '',
        query: '',
        model: 'gpt-4o'
    });

    useEffect(() => {
        // Load models and deduplicate
        api.listModels()
            .then(data => setModels(Array.from(new Set(data))))
            .catch(() => setModels(['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo']));

        // Load default model and time range from settings
        api.getSettings().then(settings => {
            if (settings.model) {
                setFormData(prev => ({ ...prev, model: settings.model }));
            }
            if (settings.defaultTimeRange) {
                setTimePreset(settings.defaultTimeRange);
            }
        }).catch(err => console.error("Failed to load settings:", err));

        // Load products and active product
        api.listProducts().then(productList => {
            setProducts(productList);
            api.getActiveProduct().then(active => {
                if (active) {
                    setSelectedProductId(active.id);
                } else if (productList.length > 0) {
                    setSelectedProductId(productList[0].id);
                }
            }).catch(() => {
                if (productList.length > 0) {
                    setSelectedProductId(productList[0].id);
                }
            });
        }).catch(err => console.error("Failed to load products:", err));

        // Check ICM availability
        api.checkIcmStatus()
            .then(status => setIcmAvailable(status.available))
            .catch(() => setIcmAvailable(false));
    }, []);

    // Validate product paths whenever selection changes
    useEffect(() => {
        if (!selectedProductId) {
            setProductValidation(null);
            return;
        }
        api.validateProduct(selectedProductId)
            .then(v => setProductValidation(v))
            .catch(() => setProductValidation(null));
    }, [selectedProductId]);

    const handleFetchIcm = async () => {
        if (!incidentId.trim()) return;
        setIcmLoading(true);
        setIcmError('');
        setIcmPreview(null);
        setIcmSteps([]);
        try {
            const preview = await api.fetchIcmIncident(incidentId.trim(), (event) => {
                setIcmSteps(prev => {
                    // Update existing step or add new one
                    const existing = prev.findIndex(s => s.step === event.step);
                    if (existing >= 0) {
                        const updated = [...prev];
                        updated[existing] = event;
                        return updated;
                    }
                    return [...prev, event];
                });
            });
            setIcmPreview(preview);
            // Auto-fill form fields from ICM data
            if (preview.stamp) {
                setFormData(prev => ({ ...prev, stamp: preview.stamp }));
            }
        } catch (err: any) {
            setIcmError(err.message || 'Failed to read ICM incident');
        } finally {
            setIcmLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        // ICM mode: incidentId is required, stamp/timeRange are optional
        if (mode === 'icm') {
            if (!incidentId.trim()) {
                alert("Please enter an IcM Incident ID.");
                setLoading(false);
                return;
            }
            try {
                const payload: any = {
                    ...formData,
                    incidentId: incidentId.trim(),
                    timeRange: icmPreview?.timeRange || timePreset,
                    productId: selectedProductId || undefined
                };
                // Include stamp if available (from preview or manual entry)
                if (formData.stamp) payload.stamp = formData.stamp;
                // Include ICM context in query
                if (icmPreview) {
                    const icmContext = `[ICM Incident ${incidentId}]\nTitle: ${icmPreview.title}\nSeverity: ${icmPreview.severity}\n\n${icmPreview.raw}`;
                    payload.query = payload.query
                        ? `${icmContext}\n\n---\nAdditional context: ${payload.query}`
                        : icmContext;
                }
                const result = await api.startInvestigation(payload);
                navigate(`/investigation/${result.id}`);
            } catch (error) {
                console.error('Failed to start:', error);
                alert('Failed to start investigation');
            } finally {
                setLoading(false);
            }
            return;
        }

        // Standard mode: stamp and timeRange are required

        // Construct effective time range
        let effectiveTimeRange = timePreset;
        if (timeMode === 'custom') {
            // Check for invalid timestamps
            if (startTimeValid === false || endTimeValid === false) {
                alert("Please fix the invalid timestamp format before starting.");
                setLoading(false);
                return;
            }
            if (!customStart || !customEnd) {
                alert("Please select both start and end times for custom range.");
                setLoading(false);
                return;
            }
            if (new Date(customStart) >= new Date(customEnd)) {
                alert("Start time must be before end time.");
                setLoading(false);
                return;
            }
            const startISO = new Date(customStart).toISOString();
            const endISO = new Date(customEnd).toISOString();
            // Format as KQL-friendly range description
            effectiveTimeRange = `between(datetime(${startISO}) .. datetime(${endISO}))`;
        }

        try {
            const payload = {
                ...formData,
                timeRange: effectiveTimeRange,
                productId: selectedProductId || undefined
            };
            const result = await api.startInvestigation(payload);
            navigate(`/investigation/${result.id}`);
        } catch (error) {
            console.error('Failed to start:', error);
            alert('Failed to start investigation');
        } finally {
            setLoading(false);
        }
    };



    return (
        <div className="max-w-5xl mx-auto space-y-4 animate-fade-in pb-8">
            {/* Header */}
            <div className="text-center space-y-1">
                <h1 className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-brand-600 via-brand-500 to-brand-400 dark:from-brand-400 dark:via-brand-300 dark:to-brand-200 drop-shadow-sm">
                    Initiate Investigation
                </h1>
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                    Launch a new AI-driven telemetry analysis session.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">

                {/* Investigation Mode Toggle */}
                <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/50 dark:border-slate-800 overflow-hidden relative">
                    <div className="p-4 space-y-4">
                        {/* Product Selector */}
                        {products.length > 0 && (
                            <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                                <Package className="w-4 h-4 text-slate-400" />
                                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Product</span>
                                <select
                                    value={selectedProductId}
                                    onChange={(e) => setSelectedProductId(e.target.value)}
                                    className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/50 text-sm font-medium text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-brand-500 outline-none transition-all"
                                >
                                    {products.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Path validation warning */}
                        {productValidation && !productValidation.valid && (
                            <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                <div className="text-sm">
                                    <div className="font-semibold text-red-700 dark:text-red-400 mb-1">Cannot start investigation - path issues detected</div>
                                    <ul className="space-y-0.5">
                                        {productValidation.paths.filter(p => p.error).map(p => (
                                            <li key={p.field} className="text-red-600 dark:text-red-300 text-xs">
                                                <span className="font-medium">{p.label}:</span> {p.error}
                                                {p.value && <span className="ml-1 font-mono text-red-400 dark:text-red-500">({p.value})</span>}
                                            </li>
                                        ))}
                                    </ul>
                                    <div className="mt-2 text-xs text-red-500 dark:text-red-400">
                                        Fix these paths in <button type="button" onClick={() => navigate('/settings')} className="underline font-semibold hover:text-red-700 dark:hover:text-red-200">Settings &gt; Products</button> before starting an investigation.
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Mode Toggle */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-1 rounded-lg flex gap-1">
                            {INVESTIGATION_MODES.map((m) => (
                                <button
                                    key={m.value}
                                    type="button"
                                    onClick={() => setMode(m.value)}
                                    disabled={m.value === 'icm' && icmAvailable === false}
                                    className={`flex-1 py-2 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                                        mode === m.value
                                            ? 'bg-white dark:bg-slate-700 text-brand-600 dark:text-brand-400 shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                                            : m.value === 'icm' && icmAvailable === false
                                                ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                    }`}
                                    title={m.value === 'icm' && icmAvailable === false ? 'ICM scripts not configured' : m.description}
                                >
                                    {m.value === 'icm' && <ShieldAlert className="w-3.5 h-3.5" />}
                                    {m.value === 'standard' && <Target className="w-3.5 h-3.5" />}
                                    {m.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ICM Incident Card (only in ICM mode) */}
                {mode === 'icm' && (
                    <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/50 dark:border-slate-800 overflow-hidden relative group transition-all hover:shadow-2xl hover:bg-white/80 dark:hover:bg-slate-900/80">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-500 to-transparent"></div>
                        <div className="p-5 space-y-4">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg text-orange-600 dark:text-orange-400">
                                    <ShieldAlert className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800 dark:text-white">IcM Incident</h2>
                                    <p className="text-xs text-slate-400">Enter an incident ID to auto-extract investigation context</p>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="e.g. 712467004"
                                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all outline-none font-mono text-sm shadow-sm"
                                    value={incidentId}
                                    onChange={(e) => setIncidentId(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleFetchIcm(); } }}
                                />
                                <button
                                    type="button"
                                    onClick={handleFetchIcm}
                                    disabled={icmLoading || !incidentId.trim()}
                                    className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                                        icmLoading || !incidentId.trim()
                                            ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                            : 'bg-orange-500 hover:bg-orange-600 text-white shadow-sm'
                                    }`}
                                >
                                    {icmLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Fetch'}
                                </button>
                            </div>

                            {icmError && (
                                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
                                    {icmError}
                                </div>
                            )}

                            {/* Live Progress Steps */}
                            {icmSteps.length > 0 && (
                                <div className="space-y-1.5 animate-fade-in">
                                    {icmSteps.map((step, i) => (
                                        <div key={step.step || i} className="flex items-center gap-2.5 text-xs">
                                            {step.status === 'running' && (
                                                <Loader2 className="w-3.5 h-3.5 text-orange-500 animate-spin shrink-0" />
                                            )}
                                            {step.status === 'done' && (
                                                <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                                            )}
                                            {step.status === 'error' && (
                                                <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                                            )}
                                            {!step.status && (
                                                <Circle className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                                            )}
                                            <span className={`${
                                                step.status === 'running' ? 'text-orange-600 dark:text-orange-400 font-medium' :
                                                step.status === 'done' ? 'text-slate-500 dark:text-slate-400' :
                                                step.status === 'error' ? 'text-red-600 dark:text-red-400' :
                                                'text-slate-400'
                                            }`}>
                                                {step.detail}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {icmPreview && (
                                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3 animate-fade-in">
                                    <div className="flex items-start justify-between gap-2">
                                        <h3 className="text-sm font-bold text-slate-800 dark:text-white line-clamp-2">{icmPreview.title}</h3>
                                        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                            icmPreview.severity === '1' || icmPreview.severity === '2'
                                                ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                                        }`}>
                                            Sev {icmPreview.severity}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                                        {icmPreview.stamp && (
                                            <span className="bg-brand-50 text-brand-600 px-2 py-0.5 rounded-md border border-brand-200">
                                                {icmPreview.stamp}
                                            </span>
                                        )}
                                        {icmPreview.timeRange && (
                                            <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md border border-blue-200" title={icmPreview.timeRange}>
                                                📅 {formatTimeRange(icmPreview.timeRange)}
                                            </span>
                                        )}
                                        {icmPreview.status && (
                                            <span className={`px-2 py-0.5 rounded-md border ${
                                                icmPreview.status === 'Active' 
                                                    ? 'bg-red-50 text-red-600 border-red-200'
                                                    : icmPreview.status === 'Mitigated'
                                                        ? 'bg-amber-50 text-amber-600 border-amber-200'
                                                        : 'bg-green-50 text-green-600 border-green-200'
                                            }`}>
                                                {icmPreview.status}
                                            </span>
                                        )}
                                    </div>
                                    {/* Owner info */}
                                    {(icmPreview.owner || icmPreview.owningTeam) && (
                                        <div className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
                                            {icmPreview.owner && <div><span className="font-medium">Owner:</span> {icmPreview.owner}</div>}
                                            {icmPreview.owningTeam && <div><span className="font-medium">Team:</span> {icmPreview.owningTeam}</div>}
                                        </div>
                                    )}
                                    {/* Scrollable incident content */}
                                    <div className="max-h-64 overflow-y-auto rounded-md bg-slate-100 dark:bg-slate-900/50 p-3 border border-slate-200 dark:border-slate-700">
                                        <pre className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">{icmPreview.raw}</pre>
                                    </div>
                                    {!icmPreview.stamp && (
                                        <p className="text-[11px] text-amber-600 font-medium">
                                            No stamp auto-detected - the agent will extract it from the incident context.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {mode === 'standard' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Section 1: Target Scope */}
                    <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/50 dark:border-slate-800 overflow-hidden relative group transition-all hover:shadow-2xl hover:bg-white/80 dark:hover:bg-slate-900/80 h-full flex flex-col">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-500 to-transparent"></div>
                        <div className="p-5 space-y-4 flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-lg text-brand-600 dark:text-brand-400">
                                    <Target className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800 dark:text-white">Target Scope</h2>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="space-y-2 group/input">
                                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 group-focus-within/input:text-brand-500 transition-colors">
                                        <Command className="w-3 h-3" /> Stamp Name
                                    </label>
                                    <input
                                        type="text"
                                        required={mode === 'standard'}
                                        placeholder={mode === 'icm' ? 'Auto-filled from ICM or enter manually' : 'e.g. my-app-prd-eus2-01'}
                                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none font-mono text-sm shadow-sm"
                                        value={formData.stamp}
                                        onChange={(e) => setFormData({ ...formData, stamp: e.target.value })}
                                    />
                                </div>

                                <div className="space-y-2 group/input">
                                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 group-focus-within/input:text-brand-500 transition-colors">
                                        <AlertTriangle className="w-3 h-3" /> Issue Type
                                    </label>
                                    <div className="relative">
                                        <select
                                            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none appearance-none shadow-sm cursor-pointer text-sm"
                                            value={formData.issueType}
                                            onChange={(e) => setFormData({ ...formData, issueType: e.target.value })}
                                        >
                                            <option value="">Unknown / Discovery</option>
                                            <option value="latency">Latency / Performance</option>
                                            <option value="error">Error / Failure Rate</option>
                                            <option value="throttling">Throttling / Quota</option>
                                            <option value="data_loss">Data Loss / Inconsistency</option>
                                            <option value="availability">Availability / Downtime</option>
                                        </select>
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                            <ArrowRight className="w-4 h-4 rotate-90" />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2 group/input">
                                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 group-focus-within/input:text-brand-500 transition-colors">
                                        <Search className="w-3 h-3" /> Tracking ID (Optional)
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="Correlation ID, Request ID, or Incident GUID"
                                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none font-mono text-sm shadow-sm"
                                        value={formData.trackingId}
                                        onChange={(e) => setFormData({ ...formData, trackingId: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Section 2: Time Window */}
                    <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/50 dark:border-slate-800 overflow-hidden relative group transition-all hover:shadow-2xl hover:bg-white/80 dark:hover:bg-slate-900/80 h-full flex flex-col">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-transparent"></div>
                        <div className="p-5 space-y-4 flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                                    <Clock className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800 dark:text-white">Time Window</h2>
                                </div>
                            </div>

                            <div className="bg-slate-50 dark:bg-slate-800/50 p-1 rounded-lg flex gap-1 mb-2">
                                <button
                                    type="button"
                                    onClick={() => setTimeMode('preset')}
                                    className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${timeMode === 'preset'
                                        ? 'bg-white dark:bg-slate-700 text-brand-600 dark:text-brand-400 shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                        }`}
                                >
                                    Quick Preset
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTimeMode('custom')}
                                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${timeMode === 'custom'
                                        ? 'bg-white dark:bg-slate-700 text-brand-600 dark:text-brand-400 shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                        }`}
                                >
                                    Custom Range
                                </button>
                            </div>

                            {timeMode === 'preset' ? (
                                <div className="grid grid-cols-2 gap-3">
                                    {TIME_PRESETS.map((preset) => (
                                        <button
                                            key={preset.value}
                                            type="button"
                                            onClick={() => setTimePreset(preset.value)}
                                            className={`px-2 py-2 rounded-lg border text-xs font-bold transition-all ${timePreset === preset.value
                                                ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-300 ring-2 ring-brand-500 ring-offset-2 dark:ring-offset-slate-900'
                                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-300 hover:shadow-md'
                                                }`}
                                        >
                                            {preset.label}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-4 animate-fade-in">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                            Start Time (Local)
                                        </label>
                                        <div className="relative flex gap-2">
                                            <input
                                                type="text"
                                                placeholder="e.g., 2024-03-15 14:30, Mar 15 2024 2:30 PM"
                                                className={`flex-1 px-4 py-3 rounded-xl border bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 outline-none transition-all shadow-sm ${
                                                    startTimeValid === false 
                                                        ? 'border-red-500 focus:ring-red-500 bg-red-50 dark:bg-red-900/20' 
                                                        : startTimeValid === true
                                                            ? 'border-green-500 focus:ring-green-500'
                                                            : 'border-slate-200 dark:border-slate-700 focus:ring-brand-500'
                                                }`}
                                                value={startTimeText}
                                                onChange={(e) => handleStartTimeChange(e.target.value)}
                                            />
                                            <input
                                                ref={startPickerRef}
                                                type="datetime-local"
                                                className="sr-only"
                                                value={customStart}
                                                onChange={(e) => handleStartPickerChange(e.target.value)}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => startPickerRef.current?.showPicker()}
                                                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
                                                title="Pick from calendar"
                                            >
                                                <Calendar className="w-5 h-5" />
                                            </button>
                                        </div>
                                        {startTimeValid === false && (
                                            <p className="text-xs text-red-500 flex items-center gap-1">
                                                <AlertCircle className="w-3 h-3" /> Invalid format. Try: YYYY-MM-DD HH:MM or MM/DD/YYYY HH:MM AM/PM
                                            </p>
                                        )}
                                        {startTimeValid === true && customStart && (
                                            <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                                                <CheckCircle2 className="w-3 h-3" /> Parsed: {formatDateDisplay(new Date(customStart))}
                                            </p>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                            End Time (Local)
                                        </label>
                                        <div className="relative flex gap-2">
                                            <input
                                                type="text"
                                                placeholder="e.g., 2024-03-15 16:00, Mar 15 2024 4:00 PM"
                                                className={`flex-1 px-4 py-3 rounded-xl border bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 outline-none transition-all shadow-sm ${
                                                    endTimeValid === false 
                                                        ? 'border-red-500 focus:ring-red-500 bg-red-50 dark:bg-red-900/20' 
                                                        : endTimeValid === true
                                                            ? 'border-green-500 focus:ring-green-500'
                                                            : 'border-slate-200 dark:border-slate-700 focus:ring-brand-500'
                                                }`}
                                                value={endTimeText}
                                                onChange={(e) => handleEndTimeChange(e.target.value)}
                                            />
                                            <input
                                                ref={endPickerRef}
                                                type="datetime-local"
                                                className="sr-only"
                                                value={customEnd}
                                                onChange={(e) => handleEndPickerChange(e.target.value)}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => endPickerRef.current?.showPicker()}
                                                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
                                                title="Pick from calendar"
                                            >
                                                <Calendar className="w-5 h-5" />
                                            </button>
                                        </div>
                                        {endTimeValid === false && (
                                            <p className="text-xs text-red-500 flex items-center gap-1">
                                                <AlertCircle className="w-3 h-3" /> Invalid format. Try: YYYY-MM-DD HH:MM or MM/DD/YYYY HH:MM AM/PM
                                            </p>
                                        )}
                                        {endTimeValid === true && customEnd && (
                                            <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                                                <CheckCircle2 className="w-3 h-3" /> Parsed: {formatDateDisplay(new Date(customEnd))}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>}

                {/* Section 3: Agent Configuration (Full Width) */}
                <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/50 dark:border-slate-800 overflow-hidden relative group transition-all hover:shadow-2xl hover:bg-white/80 dark:hover:bg-slate-900/80">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-transparent"></div>
                    <div className="p-5 space-y-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg text-purple-600 dark:text-purple-400">
                                <Sparkles className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-slate-800 dark:text-white">Agent Configuration</h2>
                            </div>
                        </div>

                        <div className="space-y-2 group/input">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 group-focus-within/input:text-purple-500 transition-colors">
                                <Zap className="w-3 h-3" /> Selected Model
                            </label>
                            <div className="relative">
                                <select
                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none appearance-none shadow-sm cursor-pointer text-sm"
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                >
                                    {models.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                    <ArrowRight className="w-4 h-4 rotate-90" />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2 group/input">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 group-focus-within/input:text-purple-500 transition-colors">
                                Additional Context / Query
                            </label>
                            <textarea
                                rows={2}
                                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none text-sm shadow-sm"
                                placeholder="Describe the issue symptoms, specific errors observed, or any hypotheses you have..."
                                value={formData.query}
                                onChange={(e) => setFormData({ ...formData, query: e.target.value })}
                            />
                        </div>
                    </div>
                </div>

                {/* Footer Action */}
                <div className="pt-4 pb-0">
                    <button
                        type="submit"
                        disabled={loading || (productValidation !== null && !productValidation.valid)}
                        className={`w-full group relative px-6 py-3 rounded-xl font-black text-white text-lg shadow-xl shadow-brand-500/30 transition-all transform hover:scale-[1.01] active:scale-95 overflow-hidden ring-4 ring-transparent hover:ring-brand-500/20 ${
                            loading || (productValidation !== null && !productValidation.valid)
                                ? 'bg-slate-400 cursor-not-allowed' 
                                : 'bg-gradient-to-r from-brand-600 via-brand-500 to-brand-400 hover:from-brand-500 hover:via-brand-400 hover:to-brand-300'
                            }`}
                    >
                        <div className="absolute inset-0 bg-white/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                        <span className="relative flex items-center justify-center gap-3">
                            {loading ? (
                                <>
                                    <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                                    Initializing Agent...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="w-6 h-6 animate-pulse" />
                                    Start Investigation
                                </>
                            )}
                        </span>
                    </button>
                    <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-4">
                        By starting an investigation, you agree to the usage of AI for telemetry analysis.
                    </p>
                </div>
            </form>
        </div>
    );
};
