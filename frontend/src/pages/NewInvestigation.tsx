import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type IncidentPreview, type IncidentProgressEvent, type Product, type ProductValidation, type SavedQuery, type SavedWorkflow, type SavedAgent } from '../api';
import { useToast } from '../components/Toast';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { Tooltip } from '../components/Tooltip';
import { Search, Command, Clock, AlertTriangle, ArrowRight, Sparkles, Zap, Target, ShieldAlert, Loader2, CheckCircle2, Circle, AlertCircle, Package, Calendar, BookOpen, Save, Trash2, ChevronDown, X, Check, Pencil, GitBranch, Plus } from 'lucide-react';
import { TIME_PRESETS, INVESTIGATION_MODES, type InvestigationMode } from '../constants';
import { parseFlexibleTimestamp, toDateTimeLocalValue, toDateTimeUTCValue, formatDateDisplayUTC, datetimeLocalToISO } from '../utils/timestamp';
import { PIPELINE_PRESETS, buildPipelinePreset, PipelineBuilder } from '../components/PipelineBuilder';
import type { AgentDefinition, PipelineDefinition } from '../types/pipeline';

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

/** Format the time range into a human-readable string */
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
    const { toast } = useToast();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [models, setModels] = useState<string[]>([]);

    // Investigation Mode State
    const [mode, setMode] = useState<InvestigationMode>('standard');

    // Workflow Preset State
    const [builtinAgents, setBuiltinAgents] = useState<AgentDefinition[]>([]);
    const [selectedWorkflow, setSelectedWorkflow] = useState<string>(''); // set dynamically after settings load
    const [configuredPipeline, setConfiguredPipeline] = useState<PipelineDefinition | null>(null);


    // Saved workflows & agents state
    const [savedWorkflows, setSavedWorkflows] = useState<SavedWorkflow[]>([]);
    const [savedAgents, setSavedAgents] = useState<SavedAgent[]>([]);
    const [showWorkflowEditor, setShowWorkflowEditor] = useState(false);
    const [editingPipeline, setEditingPipeline] = useState<PipelineDefinition | null>(null);
    const [savingWorkflow, setSavingWorkflow] = useState(false);
    const [workflowSaveName, setWorkflowSaveName] = useState('');
    const [workflowSaveDesc, setWorkflowSaveDesc] = useState('');
    const [workflowSaveIcon, setWorkflowSaveIcon] = useState('🔧');
    const [iconPickerOpen, setIconPickerOpen] = useState(false);
    const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);

    // Incident State
    const [incidentId, setIncidentId] = useState('');
    const [incidentLoading, setincidentLoading] = useState(false);
    const [incidentPreview, setincidentPreview] = useState<IncidentPreview | null>(null);
    const [incidentError, setincidentError] = useState('');
    const [incidentAvailable, setincidentAvailable] = useState<boolean | null>(null);
    const [incidentSteps, setincidentSteps] = useState<IncidentProgressEvent[]>([]);

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
    const saveSuccessTimerRef = useRef<ReturnType<typeof setTimeout>>();

    // Time zone mode: 'utc' or 'local'
    const [timeZoneMode, setTimeZoneMode] = useState<'utc' | 'local'>('utc');
    const toDateTimeValue = (date: Date) => timeZoneMode === 'utc' ? toDateTimeUTCValue(date) : toDateTimeLocalValue(date);
    const formatParsedDisplay = (value: string) => {
        const d = timeZoneMode === 'utc' ? new Date(value + 'Z') : new Date(value);
        return timeZoneMode === 'utc' ? formatDateDisplayUTC(d) : formatDateDisplay(d);
    };

    // Re-convert existing text inputs when timezone mode changes
    useEffect(() => {
        if (startTimeText) {
            const parsed = parseFlexibleTimestamp(startTimeText);
            if (parsed) setCustomStart(toDateTimeValue(parsed));
        }
        if (endTimeText) {
            const parsed = parseFlexibleTimestamp(endTimeText);
            if (parsed) setCustomEnd(toDateTimeValue(parsed));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeZoneMode]);
    useEffect(() => () => { clearTimeout(saveSuccessTimerRef.current); }, []);

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
            setCustomStart(toDateTimeValue(parsed));
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
            setCustomEnd(toDateTimeValue(parsed));
        } else {
            setEndTimeValid(false);
            setCustomEnd('');
        }
    };

    // Handle picker selection
    const handleStartPickerChange = (value: string) => {
        setCustomStart(value);
        if (value) {
            const date = timeZoneMode === 'utc' ? new Date(value + 'Z') : new Date(value);
            setStartTimeText(timeZoneMode === 'utc' ? formatDateDisplayUTC(date) : formatDateDisplay(date));
            setStartTimeValid(true);
        }
    };

    const handleEndPickerChange = (value: string) => {
        setCustomEnd(value);
        if (value) {
            const date = timeZoneMode === 'utc' ? new Date(value + 'Z') : new Date(value);
            setEndTimeText(timeZoneMode === 'utc' ? formatDateDisplayUTC(date) : formatDateDisplay(date));
            setEndTimeValid(true);
        }
    };

    const [formData, setFormData] = useState({
        target: '',
        correlationId: '',
        category: '',
        query: '',
        model: 'gpt-4o',
        title: ''
    });

    // ── Query Bank State ──────────────────────────────────────────────────
    const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
    const [loadedQueryId, setLoadedQueryId] = useState<string | null>(null);
    const [queryBankOpen, setQueryBankOpen] = useState(false);
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [saveQueryName, setSaveQueryName] = useState('');
    const [savingQuery, setSavingQuery] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
    const queryBankRef = useRef<HTMLDivElement>(null);

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
            if (settings.defaultTimeZoneMode === 'utc' || settings.defaultTimeZoneMode === 'local') {
                setTimeZoneMode(settings.defaultTimeZoneMode);
            }
            // Check for a configured pipeline (global or product-level)
            if (settings.pipeline && settings.pipeline.stages && settings.pipeline.stages.length > 1) {
                setConfiguredPipeline(settings.pipeline as PipelineDefinition);
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

        // Check Incident availability
        api.checkIncidentStatus()
            .then(status => setincidentAvailable(status.available))
            .catch(() => setincidentAvailable(false));

        // Load saved queries (query bank)
        api.getSavedQueries()
            .then(queries => setSavedQueries(queries))
            .catch(err => console.error('Failed to load saved queries:', err));

        // Load builtin agents for workflow presets
        api.getPipelineBuiltins()
            .then(agents => setBuiltinAgents(agents))
            .catch(err => console.error('Failed to load pipeline builtins:', err));

        // Load saved workflows
        api.getSavedWorkflows()
            .then(workflows => setSavedWorkflows(workflows))
            .catch(err => console.error('Failed to load saved workflows:', err));

        // Load saved custom agents
        api.getSavedAgents()
            .then(agents => setSavedAgents(agents))
            .catch(err => console.error('Failed to load saved agents:', err));
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

    // Auto-select workflow: use configured pipeline if it exists, else 'default' preset
    useEffect(() => {
        if (configuredPipeline) {
            setSelectedWorkflow('configured');
        } else {
            setSelectedWorkflow('default');
        }
    }, [configuredPipeline]);

    const handleFetchIncident = async () => {
        if (!incidentId.trim()) return;
        setincidentLoading(true);
        setincidentError('');
        setincidentPreview(null);
        setincidentSteps([]);
        try {
            const preview = await api.fetchIncident(incidentId.trim(), (event) => {
                setincidentSteps(prev => {
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
            setincidentPreview(preview);
            // Auto-fill form fields from Incident data
            if (preview.target) {
                setFormData(prev => ({ ...prev, target: preview.target }));
            }
        } catch (err: any) {
            setincidentError(err.message || 'Failed to read Incident');
        } finally {
            setincidentLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        // Build pipeline from selected workflow preset (if agents are available)
        // 'configured' means use the already-configured pipeline from settings — don't override
        // 'saved-XXX' means use a saved workflow's pipeline directly
        let pipelinePayload: any = undefined;
        if (selectedWorkflow && selectedWorkflow !== 'configured') {
            if (selectedWorkflow.startsWith('saved-')) {
                // Use saved workflow pipeline
                const savedId = selectedWorkflow.replace('saved-', '');
                const saved = savedWorkflows.find(w => w.id === savedId);
                if (saved) {
                    pipelinePayload = saved.pipeline;
                }
            } else if (builtinAgents.length > 0) {
                try {
                    pipelinePayload = buildPipelinePreset(selectedWorkflow, builtinAgents);
                } catch {
                    // If preset fails (missing agents), proceed without pipeline
                }
            }
        }

        // Incident mode: incidentId is required, target/timeRange are optional
        if (mode === 'incident') {
            if (!incidentId.trim()) {
                toast('warning', 'Please enter an Incident ID.');
                setLoading(false);
                return;
            }
            try {
                const payload: any = {
                    ...formData,
                    title: formData.title.trim() || undefined,
                    incidentId: incidentId.trim(),
                    timeRange: incidentPreview?.timeRange || timePreset,
                    productId: selectedProductId || undefined,
                    pipeline: pipelinePayload,
                };
                // Include target if available (from preview or manual entry)
                if (formData.target) payload.target = formData.target;
                // Include Incident context in query
                if (incidentPreview) {
                    const IncidentContext = `[Incident ${incidentId}]\nTitle: ${incidentPreview.title}\nSeverity: ${incidentPreview.severity}\n\n${incidentPreview.raw}`;
                    payload.query = payload.query
                        ? `${IncidentContext}\n\n---\nAdditional context: ${payload.query}`
                        : IncidentContext;
                }
                const result = await api.startInvestigation(payload);
                navigate(`/investigation/${result.id}`);
            } catch (error) {
                console.error('Failed to start:', error);
                toast('error', 'Failed to start investigation');
            } finally {
                setLoading(false);
            }
            return;
        }

        // Standard mode: target and timeRange are required

        // Construct effective time range
        let effectiveTimeRange = timePreset;
        if (timeMode === 'custom') {
            // Check for invalid timestamps
            if (startTimeValid === false || endTimeValid === false) {
                toast('warning', 'Please fix the invalid timestamp format before starting.');
                setLoading(false);
                return;
            }
            if (!customStart || !customEnd) {
                toast('warning', 'Please select both start and end times for custom range.');
                setLoading(false);
                return;
            }
            if (new Date(customStart) >= new Date(customEnd)) {
                toast('warning', 'Start time must be before end time.');
                setLoading(false);
                return;
            }
            const startISO = datetimeLocalToISO(customStart, timeZoneMode === 'utc');
            const endISO = datetimeLocalToISO(customEnd, timeZoneMode === 'utc');
            // Format as time range description
            effectiveTimeRange = `${startISO} to ${endISO}`;
        }

        try {
            const payload = {
                ...formData,
                title: formData.title.trim() || undefined,
                timeRange: effectiveTimeRange,
                productId: selectedProductId || undefined,
                pipeline: pipelinePayload,
            };
            const result = await api.startInvestigation(payload);
            navigate(`/investigation/${result.id}`);
        } catch (error) {
            console.error('Failed to start:', error);
            toast('error', 'Failed to start investigation');
        } finally {
            setLoading(false);
        }
    };

    // ── Query Bank Handlers ───────────────────────────────────────────────

    const loadSavedQuery = useCallback((sq: SavedQuery) => {
        setFormData({
            target: sq.target || '',
            correlationId: sq.correlationId || '',
            category: sq.category || '',
            query: sq.query || '',
            model: sq.model || formData.model,
        });
        if (sq.productId) setSelectedProductId(sq.productId);
        if (sq.timeMode === 'custom') {
            setTimeMode('custom');
            // If the timeRange is a between(...) expression, extract the dates
            const match = sq.timeRange?.match(/datetime\(([^)]+)\)\s*\.\.\s*datetime\(([^)]+)\)/);
            if (match) {
                const startDate = new Date(match[1]);
                const endDate = new Date(match[2]);
                setCustomStart(toDateTimeValue(startDate));
                setCustomEnd(toDateTimeValue(endDate));
                setStartTimeText(timeZoneMode === 'utc' ? formatDateDisplayUTC(startDate) : formatDateDisplay(startDate));
                setEndTimeText(timeZoneMode === 'utc' ? formatDateDisplayUTC(endDate) : formatDateDisplay(endDate));
                setStartTimeValid(true);
                setEndTimeValid(true);
            }
        } else {
            setTimeMode('preset');
            if (sq.timeRange) setTimePreset(sq.timeRange);
        }
        setLoadedQueryId(sq.id);
        setQueryBankOpen(false);
    }, [formData.model, timeZoneMode]);

    const handleSaveQuery = async () => {
        const name = saveQueryName.trim();
        setSavingQuery(true);
        try {
            let effectiveTimeRange = timePreset;
            let effectiveTimeMode: 'preset' | 'custom' = 'preset';
            if (timeMode === 'custom' && customStart && customEnd) {
                const startISO = new Date(customStart).toISOString();
                const endISO = new Date(customEnd).toISOString();
                effectiveTimeRange = `between(datetime(${startISO}) .. datetime(${endISO}))`;
                effectiveTimeMode = 'custom';
            }
            const payload = {
                name,
                target: formData.target || undefined,
                query: formData.query || undefined,
                category: formData.category || undefined,
                correlationId: formData.correlationId || undefined,
                timeRange: effectiveTimeRange,
                timeMode: effectiveTimeMode,
                model: formData.model,
                productId: selectedProductId || undefined,
            };
            let saved: SavedQuery;
            if (loadedQueryId) {
                // Update existing
                saved = await api.updateSavedQuery(loadedQueryId, payload);
                setSavedQueries(prev => prev.map(q => q.id === saved.id ? saved : q));
            } else {
                // Create new
                saved = await api.createSavedQuery(payload);
                setSavedQueries(prev => [...prev, saved]);
            }
            setLoadedQueryId(saved.id);
            setSaveSuccess(saved.name);
            setShowSaveDialog(false);
            setSaveQueryName('');
            saveSuccessTimerRef.current = setTimeout(() => setSaveSuccess(null), 2500);
        } catch (err) {
            console.error('Failed to save query:', err);
            toast('error', 'Failed to save query to bank');
        } finally {
            setSavingQuery(false);
        }
    };

    const handleDeleteSavedQuery = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await api.deleteSavedQuery(id);
            setSavedQueries(prev => prev.filter(q => q.id !== id));
            if (loadedQueryId === id) setLoadedQueryId(null);
        } catch (err) {
            console.error('Failed to delete saved query:', err);
        }
    };

    // Close query bank dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (queryBankRef.current && !queryBankRef.current.contains(e.target as Node)) {
                setQueryBankOpen(false);
            }
        };
        if (queryBankOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [queryBankOpen]);

    const handleSaveWorkflow = async () => {
        setSavingWorkflow(true);
        try {
            const descTrimmed = workflowSaveDesc.trim();
            if (editingWorkflowId) {
                const updated = await api.updateSavedWorkflow(editingWorkflowId, {
                    name: workflowSaveName.trim(),
                    description: descTrimmed || undefined,
                    icon: workflowSaveIcon,
                    pipeline: editingPipeline,
                });
                setSavedWorkflows(savedWorkflows.map(w => w.id === editingWorkflowId ? updated : w));
                toast('success', 'Workflow updated');
            } else {
                const saved = await api.createSavedWorkflow({
                    name: workflowSaveName.trim(),
                    description: descTrimmed || undefined,
                    icon: workflowSaveIcon,
                    pipeline: editingPipeline,
                });
                setSavedWorkflows([...savedWorkflows, saved]);
                setSelectedWorkflow(`saved-${saved.id}`);
                toast('success', 'Workflow saved');
            }
            setShowWorkflowEditor(false);
        } catch (err: any) {
            toast('error', err.message || 'Failed to save workflow');
        } finally {
            setSavingWorkflow(false);
        }
    };



    return (
        <div className="max-w-5xl mx-auto space-y-4 animate-fade-in pb-8">
            {/* Breadcrumbs */}
            <Breadcrumbs crumbs={[
                { label: 'Dashboard', to: '/' },
                { label: 'New Investigation' },
            ]} />

            {/* Header */}
            <div className="text-center space-y-1">
                <h1 className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-brand-400 via-brand-300 to-brand-200 drop-shadow-sm">
                    Initiate Investigation
                </h1>
                <p className="text-slate-400 text-sm">
                    Launch a new AI-driven telemetry analysis session.
                </p>
            </div>

            {/* Query Bank + Product side by side */}
            <div className="flex flex-col sm:flex-row gap-4 items-stretch relative z-10">
            {/* Query Bank Bar */}
            <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/[0.06] flex-1">
                <div className="px-4 py-3 flex items-center gap-3">
                    <div className="flex items-center gap-2 text-slate-400">
                        <BookOpen className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">Query Bank</span>
                    </div>

                    {/* Load dropdown */}
                    <div className="relative flex-1" ref={queryBankRef}>
                        <button
                            type="button"
                            onClick={() => setQueryBankOpen(!queryBankOpen)}
                            className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg border text-sm transition-all outline-none ${
                                loadedQueryId
                                    ? 'border-brand-500/40 bg-brand-900/20 text-brand-300'
                                    : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600'
                            }`}
                        >
                            <span className="truncate">
                                {loadedQueryId
                                    ? savedQueries.find(q => q.id === loadedQueryId)?.name || 'Loaded query'
                                    : savedQueries.length > 0
                                        ? `Select a saved query (${savedQueries.length})`
                                        : 'No saved queries yet'
                                }
                            </span>
                            <ChevronDown className={`w-4 h-4 shrink-0 ml-2 transition-transform ${queryBankOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {/* Dropdown */}
                        {queryBankOpen && (
                            <div className="absolute z-50 mt-1 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-2xl max-h-64 overflow-y-auto animate-fade-in">
                                {savedQueries.length === 0 ? (
                                    <div className="px-4 py-3 text-center">
                                        <p className="text-sm text-slate-500">No saved queries yet</p>
                                        <p className="text-xs text-slate-600 mt-1">Fill out the form below, then click <strong className="text-slate-400">Save</strong> to store it as a reusable template.</p>
                                    </div>
                                ) : (
                                    savedQueries.map(sq => (
                                        <div
                                            key={sq.id}
                                            onClick={() => loadSavedQuery(sq)}
                                            className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors hover:bg-slate-700/60 group ${
                                                loadedQueryId === sq.id ? 'bg-brand-900/20' : ''
                                            }`}
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-semibold text-white truncate flex items-center gap-2">
                                                    {sq.name}
                                                    {loadedQueryId === sq.id && <Check className="w-3.5 h-3.5 text-brand-400" />}
                                                </div>
                                                <div className="text-[11px] text-slate-400 truncate">
                                                    {[sq.target, sq.category, sq.timeRange].filter(Boolean).join(' · ') || 'No details'}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(e) => handleDeleteSavedQuery(sq.id, e)}
                                                className="p-1 rounded-md opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-all"
                                                title="Delete saved query"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>

                    {/* Clear loaded query */}
                    {loadedQueryId && (
                        <button
                            type="button"
                            onClick={() => setLoadedQueryId(null)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all"
                            title="Clear loaded query"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}

                    {/* Save button */}
                    <div className="relative">
                        {saveSuccess ? (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-900/20 border border-green-500/30 text-green-400 text-xs font-bold animate-fade-in">
                                <Check className="w-3.5 h-3.5" />
                                Saved
                            </div>
                        ) : showSaveDialog ? (
                            <div className="flex items-center gap-2 animate-fade-in">
                                <input
                                    type="text"
                                    placeholder={loadedQueryId ? savedQueries.find(q => q.id === loadedQueryId)?.name || 'Query name' : 'Query name'}
                                    className="px-3 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-white text-sm outline-none focus:ring-2 focus:ring-brand-500 w-48"
                                    value={saveQueryName}
                                    onChange={(e) => setSaveQueryName(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveQuery(); } if (e.key === 'Escape') setShowSaveDialog(false); }}
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={handleSaveQuery}
                                    disabled={savingQuery || !saveQueryName.trim()}
                                    className="p-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    title="Confirm save"
                                >
                                    {savingQuery ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setShowSaveDialog(false); setSaveQueryName(''); }}
                                    className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => {
                                    // Pre-fill name if updating an existing query
                                    if (loadedQueryId) {
                                        const existing = savedQueries.find(q => q.id === loadedQueryId);
                                        setSaveQueryName(existing?.name || '');
                                    }
                                    setShowSaveDialog(true);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/50 text-slate-300 hover:text-white hover:border-slate-600 text-xs font-bold transition-all"
                                title={loadedQueryId ? 'Update saved query with current form values' : 'Save current form (target, category, time range, query, model) as a reusable template'}
                            >
                                {loadedQueryId ? <Pencil className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                                {loadedQueryId ? 'Update' : 'Save'}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Product Selector */}
            {products.length > 0 && (
                <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/[0.06] flex items-center px-4 py-3 gap-3">
                    <Package className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400 shrink-0">Product</span>
                    <select
                        value={selectedProductId}
                        onChange={(e) => setSelectedProductId(e.target.value)}
                        className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/50 text-sm font-medium text-slate-200 focus:ring-2 focus:ring-brand-500 outline-none transition-all min-w-[180px]"
                    >
                        {products.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                </div>
            )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">

                {/* Investigation Mode Toggle */}
                <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/[0.06] overflow-hidden relative">
                    <div className="p-4 space-y-4">
                        {/* Path validation warning */}
                        {productValidation && !productValidation.valid && (
                            <div className="flex items-start gap-3 p-3 bg-red-900/20 border border-red-800 rounded-xl">
                                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                <div className="text-sm">
                                    <div className="font-semibold text-red-400 mb-1">Cannot start investigation - path issues detected</div>
                                    <ul className="space-y-0.5">
                                        {productValidation.paths.filter(p => p.error).map(p => (
                                            <li key={p.field} className="text-red-300 text-xs">
                                                <span className="font-medium">{p.label}:</span> {p.error}
                                                {p.value && <span className="ml-1 font-mono text-red-500">({p.value})</span>}
                                            </li>
                                        ))}
                                    </ul>
                                    <div className="mt-2 text-xs text-red-400">
                                        Fix these paths in <button type="button" onClick={() => navigate('/settings')} className="underline font-semibold hover:text-red-200">Settings &gt; Products</button> before starting an investigation.
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Mode Toggle */}
                        <div className="bg-slate-800/50 p-1 rounded-lg flex gap-1">
                            {INVESTIGATION_MODES.map((m) => (
                                <button
                                    key={m.value}
                                    type="button"
                                    onClick={() => setMode(m.value)}
                                    disabled={m.value === 'incident' && incidentAvailable === false}
                                    className={`flex-1 py-2 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                                        mode === m.value
                                            ? 'bg-slate-700 text-brand-400 shadow-sm ring-1 ring-white/10'
                                            : m.value === 'incident' && incidentAvailable === false
                                                ? 'text-slate-600 cursor-not-allowed'
                                                : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                    title={m.value === 'incident' && incidentAvailable === false ? 'Incident scripts not configured' : m.description}
                                >
                                    {m.value === 'incident' && <ShieldAlert className="w-3.5 h-3.5" />}
                                    {m.value === 'standard' && <Target className="w-3.5 h-3.5" />}
                                    {m.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Investigation Name (Optional) */}
                <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/[0.06] flex items-center px-4 py-3 gap-3">
                    <Pencil className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400 shrink-0">Name</span>
                    <input
                        type="text"
                        placeholder="Optional — auto-generated if empty"
                        className="flex-1 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/50 text-sm font-medium text-slate-200 focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition-all"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    />
                </div>

                {/* Incident Card (only in Incident mode) */}
                {mode === 'incident' && (
                    <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/[0.06] overflow-hidden relative group transition-all hover:shadow-2xl hover:bg-slate-900/80">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-500 to-transparent"></div>
                        <div className="p-5 space-y-4">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-orange-900/30 rounded-lg text-orange-400">
                                    <ShieldAlert className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white">Incident</h2>
                                    <p className="text-xs text-slate-400">Enter an incident ID to auto-extract investigation context</p>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="e.g. 712467004"
                                    className="flex-1 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all outline-none font-mono text-sm shadow-sm"
                                    value={incidentId}
                                    onChange={(e) => setIncidentId(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleFetchIncident(); } }}
                                />
                                <button
                                    type="button"
                                    onClick={handleFetchIncident}
                                    disabled={incidentLoading || !incidentId.trim()}
                                    className={`px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                                        incidentLoading || !incidentId.trim()
                                            ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                            : 'bg-orange-500 hover:bg-orange-600 text-white shadow-sm'
                                    }`}
                                >
                                    {incidentLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Fetch'}
                                </button>
                            </div>

                            {incidentError && (
                                <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg text-sm text-red-400">
                                    {incidentError}
                                </div>
                            )}

                            {/* Live Progress Steps */}
                            {incidentSteps.length > 0 && (
                                <div className="space-y-1.5 animate-fade-in">
                                    {incidentSteps.map((step, i) => {
                                        const stepCls = step.status === 'running' ? 'text-orange-400 font-medium' :
                                            step.status === 'error' ? 'text-red-400' : 'text-slate-400';
                                        const stepIcon = step.status === 'running' ? <Loader2 className="w-3.5 h-3.5 text-orange-500 animate-spin shrink-0" /> :
                                            step.status === 'done' ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" /> :
                                            step.status === 'error' ? <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" /> :
                                            <Circle className="w-3.5 h-3.5 text-slate-300 shrink-0" />;
                                        return (
                                        <div key={i} className="flex items-center gap-2.5 text-xs">
                                            {stepIcon}
                                            <span className={stepCls}>
                                                {step.detail ?? ''}
                                            </span>
                                        </div>
                                        );
                                    })}
                                </div>
                            )}

                            {incidentPreview && (
                                <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-lg space-y-3 animate-fade-in">
                                    <div className="flex items-start justify-between gap-2">
                                        <h3 className="text-sm font-bold text-white line-clamp-2">{incidentPreview.title}</h3>
                                        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                            incidentPreview.severity === '1' || incidentPreview.severity === '2'
                                                ? 'bg-red-500/15 text-red-400 border border-red-500/20' : 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                                        }`}>
                                            Sev {incidentPreview.severity}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                                        {incidentPreview.target && (
                                            <span className="bg-brand-500/10 text-brand-400 px-2 py-0.5 rounded-md border border-brand-500/20">
                                                {incidentPreview.target}
                                            </span>
                                        )}
                                        {incidentPreview.timeRange && (
                                            <span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-md border border-blue-500/20" title={incidentPreview.timeRange}>
                                                📅 {formatTimeRange(incidentPreview.timeRange)}
                                            </span>
                                        )}
                                        {incidentPreview.status && (
                                            <span className={`px-2 py-0.5 rounded-md border ${
                                                incidentPreview.status === 'Active' 
                                                    ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                                    : incidentPreview.status === 'Mitigated'
                                                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                                        : 'bg-green-500/10 text-green-400 border-green-500/20'
                                            }`}>
                                                {incidentPreview.status}
                                            </span>
                                        )}
                                    </div>
                                    {/* Owner info */}
                                    {(incidentPreview.owner || incidentPreview.owningTeam) && (
                                        <div className="text-xs text-slate-400 space-y-0.5">
                                            {incidentPreview.owner && <div><span className="font-medium">Owner:</span> {incidentPreview.owner}</div>}
                                            {incidentPreview.owningTeam && <div><span className="font-medium">Team:</span> {incidentPreview.owningTeam}</div>}
                                        </div>
                                    )}
                                    {/* Scrollable incident content */}
                                    <div className="max-h-64 overflow-y-auto rounded-md bg-slate-900/50 p-3 border border-slate-700">
                                        <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">{incidentPreview.raw}</pre>
                                    </div>
                                    {!incidentPreview.target && (
                                        <p className="text-[11px] text-amber-600 font-medium">
                                            No target auto-detected - the agent will extract it from the incident context.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {mode === 'standard' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Section 1: Target Scope */}
                    <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/[0.06] overflow-hidden relative group transition-all hover:shadow-2xl hover:bg-slate-900/80 h-full flex flex-col">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-500 to-transparent"></div>
                        <div className="p-5 space-y-4 flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-brand-900/30 rounded-lg text-brand-400">
                                    <Target className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white">Target Scope</h2>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="space-y-2 group/input">
                                    <label htmlFor="inv-target" className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 group-focus-within/input:text-brand-500 transition-colors">
                                        <Command className="w-3 h-3" /> Target Name <span className="text-red-400">*</span>
                                    </label>
                                    <input
                                        id="inv-target"
                                        type="text"
                                        required={mode === 'standard'}
                                        placeholder="e.g. my-app-prd-eus2-01"
                                        className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none font-mono text-sm shadow-sm"
                                        value={formData.target}
                                        onChange={(e) => setFormData({ ...formData, target: e.target.value })}
                                    />
                                </div>

                                <div className="space-y-2 group/input">
                                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 group-focus-within/input:text-brand-500 transition-colors">
                                        <AlertTriangle className="w-3 h-3" /> Category
                                    </label>
                                    <div className="relative">
                                        <select
                                            className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none appearance-none shadow-sm cursor-pointer text-sm"
                                            value={formData.category}
                                            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
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
                                    <label htmlFor="inv-correlation" className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 group-focus-within/input:text-brand-500 transition-colors">
                                        <Search className="w-3 h-3" /> Correlation ID (Optional)
                                        <Tooltip text="A unique identifier for correlating events across services — e.g. Request ID, Correlation ID, or Incident GUID" />
                                    </label>
                                    <input
                                        id="inv-correlation"
                                        type="text"
                                        placeholder="Correlation ID, Request ID, or Incident GUID"
                                        className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none font-mono text-sm shadow-sm"
                                        value={formData.correlationId}
                                        onChange={(e) => setFormData({ ...formData, correlationId: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Section 2: Time Window */}
                    <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/[0.06] overflow-hidden relative group transition-all hover:shadow-2xl hover:bg-slate-900/80 h-full flex flex-col">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-transparent"></div>
                        <div className="p-5 space-y-4 flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-blue-900/30 rounded-lg text-blue-400">
                                    <Clock className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white">Time Window</h2>
                                </div>
                            </div>

                            <div className="bg-slate-800/50 p-1 rounded-lg flex gap-1 mb-2">
                                <button
                                    type="button"
                                    onClick={() => setTimeMode('preset')}
                                    className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${timeMode === 'preset'
                                        ? 'bg-slate-700 text-brand-400 shadow-sm ring-1 ring-white/10'
                                        : 'text-slate-400 hover:text-slate-200'
                                        }`}
                                >
                                    Quick Preset
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTimeMode('custom')}
                                    className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all ${timeMode === 'custom'
                                        ? 'bg-slate-700 text-brand-400 shadow-sm ring-1 ring-white/10'
                                        : 'text-slate-400 hover:text-slate-200'
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
                                                ? 'bg-brand-900/20 border-brand-800 text-brand-300 ring-2 ring-brand-500 ring-offset-2 ring-offset-slate-900'
                                                : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-brand-300 hover:shadow-md'
                                                }`}
                                        >
                                            {preset.label}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-4 animate-fade-in">
                                    {/* UTC / Local toggle */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Zone:</span>
                                        <div className="flex items-center bg-slate-800 rounded-lg p-0.5 gap-0.5 border border-slate-700/40">
                                            <button type="button" onClick={() => setTimeZoneMode('utc')}
                                                className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${timeZoneMode === 'utc' ? 'bg-brand-500/20 text-brand-300 border border-brand-500/20' : 'text-slate-500 hover:text-slate-300 border border-transparent'}`}>
                                                UTC
                                            </button>
                                            <button type="button" onClick={() => setTimeZoneMode('local')}
                                                className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${timeZoneMode === 'local' ? 'bg-brand-500/20 text-brand-300 border border-brand-500/20' : 'text-slate-500 hover:text-slate-300 border border-transparent'}`}>
                                                Local
                                            </button>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                                            Start Time ({timeZoneMode === 'utc' ? 'UTC' : 'Local'})
                                        </label>
                                        <div className="relative flex gap-2">
                                            <input
                                                type="text"
                                                placeholder="e.g., 2024-03-15 14:30, Mar 15 2024 2:30 PM"
                                                className={`flex-1 px-4 py-3 rounded-xl border bg-slate-800 text-white focus:ring-2 outline-none transition-all shadow-sm ${
                                                    startTimeValid === false 
                                                        ? 'border-red-500 focus:ring-red-500 bg-red-900/20' 
                                                        : startTimeValid === true
                                                            ? 'border-green-500 focus:ring-green-500'
                                                            : 'border-slate-700 focus:ring-brand-500'
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
                                                className="px-3 py-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
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
                                            <p className="text-xs text-green-400 flex items-center gap-1">
                                                <CheckCircle2 className="w-3 h-3" /> Parsed: {formatParsedDisplay(customStart)}
                                            </p>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                                            End Time ({timeZoneMode === 'utc' ? 'UTC' : 'Local'})
                                        </label>
                                        <div className="relative flex gap-2">
                                            <input
                                                type="text"
                                                placeholder="e.g., 2024-03-15 16:00, Mar 15 2024 4:00 PM"
                                                className={`flex-1 px-4 py-3 rounded-xl border bg-slate-800 text-white focus:ring-2 outline-none transition-all shadow-sm ${
                                                    endTimeValid === false 
                                                        ? 'border-red-500 focus:ring-red-500 bg-red-900/20' 
                                                        : endTimeValid === true
                                                            ? 'border-green-500 focus:ring-green-500'
                                                            : 'border-slate-700 focus:ring-brand-500'
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
                                                className="px-3 py-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
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
                                            <p className="text-xs text-green-400 flex items-center gap-1">
                                                <CheckCircle2 className="w-3 h-3" /> Parsed: {formatParsedDisplay(customEnd)}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>}

                {/* Section 3: Agent Configuration (Full Width) */}
                <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/[0.06] overflow-hidden relative group transition-all hover:shadow-2xl hover:bg-slate-900/80">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-transparent"></div>
                    <div className="p-5 space-y-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-purple-900/30 rounded-lg text-purple-400">
                                <Sparkles className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-white">Agent Configuration</h2>
                            </div>
                        </div>

                        {/* Workflow Preset Selector */}
                        {builtinAgents.length > 0 && (() => {
                            const hasConfiguredPipeline = !!configuredPipeline;
                            // If the configured pipeline matches a built-in preset, exclude it from the preset list to avoid duplicates
                            const configuredPresetId = configuredPipeline?.id?.startsWith('preset-') ? configuredPipeline.id.replace('preset-', '') : null;
                            const availablePresets = PIPELINE_PRESETS.filter(preset =>
                                preset.stages.every(s => builtinAgents.some(a => a.builtinType === s.builtinType))
                                && preset.id !== configuredPresetId
                            );

                            // Separate saved workflows from built-in presets for clear visual grouping
                            const builtinItems: { type: 'configured' | 'preset'; preset?: typeof availablePresets[number] }[] = [
                                ...(hasConfiguredPipeline ? [{ type: 'configured' as const }] : []),
                                ...availablePresets.map(preset => ({ type: 'preset' as const, preset })),
                            ];


                            const handleDeleteSavedWorkflow = async (e: React.MouseEvent, wfId: string) => {
                                e.stopPropagation();
                                try {
                                    await api.deleteSavedWorkflow(wfId);
                                    setSavedWorkflows(savedWorkflows.filter(w => w.id !== wfId));
                                    if (selectedWorkflow === `saved-${wfId}`) setSelectedWorkflow('default');
                                    toast('success', 'Workflow deleted');
                                } catch {
                                    toast('error', 'Failed to delete workflow');
                                }
                            };

                            const handleEditSavedWorkflow = (e: React.MouseEvent, wf: SavedWorkflow) => {
                                e.stopPropagation();
                                setEditingWorkflowId(wf.id);
                                setWorkflowSaveName(wf.name);
                                setWorkflowSaveDesc(wf.description || '');
                                setWorkflowSaveIcon(wf.icon || '🔧');
                                setEditingPipeline(wf.pipeline);
                                setShowWorkflowEditor(true);
                            };

                            const openCreateWorkflow = () => {
                                setEditingWorkflowId(null);
                                setWorkflowSaveName('');
                                setWorkflowSaveDesc('');
                                setWorkflowSaveIcon('🔧');
                                setEditingPipeline(null);
                                setShowWorkflowEditor(true);
                            };

                            return (
                                <div className="space-y-3">
                                    {/* ── Header: label + Create button (always visible) ── */}
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                                            <GitBranch className="w-3 h-3" /> Agent Workflow
                                        </label>
                                        <button
                                            type="button"
                                            onClick={openCreateWorkflow}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/40 hover:border-purple-500/50 hover:text-purple-200 transition-all"
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                            Create Custom Workflow
                                        </button>
                                    </div>

                                    {/* ── My Workflows section (only when saved workflows exist) ── */}
                                    {savedWorkflows.length > 0 && (
                                        <div className="space-y-1.5">
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-400/70 flex items-center gap-2">
                                                <span className="flex-1 h-px bg-blue-500/10"></span>
                                                My Workflows ({savedWorkflows.length})
                                                <span className="flex-1 h-px bg-blue-500/10"></span>
                                            </div>
                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                                {savedWorkflows.map(workflow => {
                                                    const isSelected = selectedWorkflow === `saved-${workflow.id}`;
                                                    return (
                                                        <button
                                                            key={`saved-${workflow.id}`}
                                                            type="button"
                                                            onClick={() => setSelectedWorkflow(`saved-${workflow.id}`)}
                                                            className={`text-left p-2.5 rounded-xl border transition-all relative group/saved ${
                                                                isSelected
                                                                    ? 'bg-blue-950/50 border-blue-500/50 ring-1 ring-blue-500/20'
                                                                    : 'bg-slate-800/40 border-slate-700/40 hover:border-blue-600/40 hover:bg-slate-800/70'
                                                            }`}
                                                        >
                                                            <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 group-hover/saved:opacity-100 transition-opacity">
                                                                <span
                                                                    onClick={(e) => handleEditSavedWorkflow(e, workflow)}
                                                                    className="p-1 rounded hover:bg-slate-600/50 cursor-pointer"
                                                                    title="Edit workflow"
                                                                >
                                                                    <Pencil className="w-3 h-3 text-slate-400 hover:text-white" />
                                                                </span>
                                                                <span
                                                                    onClick={(e) => handleDeleteSavedWorkflow(e, workflow.id)}
                                                                    className="p-1 rounded hover:bg-red-600/30 cursor-pointer"
                                                                    title="Delete workflow"
                                                                >
                                                                    <Trash2 className="w-3 h-3 text-slate-400 hover:text-red-400" />
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className="text-sm">{workflow.icon || '🔧'}</span>
                                                                <span className={`text-xs font-bold truncate ${isSelected ? 'text-blue-200' : 'text-slate-300'}`}>{workflow.name}</span>
                                                            </div>
                                                            <p className={`text-[10px] leading-snug line-clamp-2 ${isSelected ? 'text-blue-300/70' : 'text-slate-500'}`}>
                                                                {workflow.description || `${workflow.pipeline.stages.length} stages`}
                                                            </p>
                                                            <div className="flex flex-wrap gap-0.5 mt-1.5">
                                                                {workflow.pipeline.stages.map((stage, i) => {
                                                                    const agent = stage.agent;
                                                                    const color = agent?.color || '#6b7280';
                                                                    const agentTitle = agent?.name || `Stage ${i + 1}`;
                                                                    const agentLabel = agent?.icon || agent?.name?.charAt(0) || (i + 1);
                                                                    return (
                                                                        <span
                                                                            key={i}
                                                                            className="w-4 h-4 rounded-full flex items-center justify-center text-[7px]"
                                                                            style={{ backgroundColor: color }}
                                                                            title={agentTitle}
                                                                        >
                                                                            {agentLabel}
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* ── Built-in Presets section ── */}
                                    <div className="space-y-1.5">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                            <span className="flex-1 h-px bg-slate-700/50"></span>
                                            Built-in Presets
                                            <span className="flex-1 h-px bg-slate-700/50"></span>
                                        </div>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                            {builtinItems.map((item) => {
                                                if (item.type === 'configured') {
                                                    const isSelected = selectedWorkflow === 'configured';
                                                    return (
                                                        <button
                                                            key="configured"
                                                            type="button"
                                                            onClick={() => setSelectedWorkflow('configured')}
                                                            className={`text-left p-2.5 rounded-xl border transition-all ${
                                                                isSelected
                                                                    ? 'bg-purple-950/50 border-purple-500/50 ring-1 ring-purple-500/20'
                                                                    : 'bg-slate-800/40 border-slate-700/40 hover:border-slate-600 hover:bg-slate-800/70'
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className="text-sm">⚙️</span>
                                                                <span className={`text-xs font-bold ${isSelected ? 'text-purple-200' : 'text-slate-300'}`}>
                                                                    {configuredPipeline!.name || 'Custom Pipeline'}
                                                                </span>
                                                                <span className="text-[8px] bg-emerald-600/30 text-emerald-400 px-1 py-0.5 rounded-full font-bold">CONFIGURED</span>
                                                            </div>
                                                            <p className={`text-[10px] leading-snug line-clamp-2 ${isSelected ? 'text-purple-300/70' : 'text-slate-500'}`}>
                                                                Your pipeline from Settings. {configuredPipeline!.stages.length} stages.
                                                            </p>
                                                            <div className="flex flex-wrap gap-0.5 mt-1.5">
                                                                {configuredPipeline!.stages.map((stage, i) => {
                                                                    const agent = stage.agent;
                                                                    const color = agent?.color || '#6b7280';
                                                                    const agentTitle = agent?.name || `Stage ${i + 1}`;
                                                                    const agentLabel = agent?.icon || agent?.name?.charAt(0) || (i + 1);
                                                                    return (
                                                                        <span
                                                                            key={i}
                                                                            className="w-4 h-4 rounded-full flex items-center justify-center text-[7px]"
                                                                            style={{ backgroundColor: color }}
                                                                            title={agentTitle}
                                                                        >
                                                                            {agentLabel}
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                        </button>
                                                    );
                                                }
                                                const { preset } = item as { type: 'preset'; preset: typeof availablePresets[number] };
                                                const isSelected = selectedWorkflow === preset.id;
                                                return (
                                                    <button
                                                        key={preset.id}
                                                        type="button"
                                                        onClick={() => setSelectedWorkflow(preset.id)}
                                                        className={`text-left p-2.5 rounded-xl border transition-all ${
                                                            isSelected
                                                                ? 'bg-purple-950/50 border-purple-500/50 ring-1 ring-purple-500/20'
                                                                : 'bg-slate-800/40 border-slate-700/40 hover:border-slate-600 hover:bg-slate-800/70'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className="text-sm">{preset.icon}</span>
                                                            <span className={`text-xs font-bold ${isSelected ? 'text-purple-200' : 'text-slate-300'}`}>{preset.name}</span>
                                                            {preset.id === 'default' && !hasConfiguredPipeline && (
                                                                <span className="text-[8px] bg-purple-600/30 text-purple-400 px-1 py-0.5 rounded-full font-bold">DEFAULT</span>
                                                            )}
                                                        </div>
                                                        <p className={`text-[10px] leading-snug line-clamp-2 ${isSelected ? 'text-purple-300/70' : 'text-slate-500'}`}>{preset.description}</p>
                                                        <div className="flex flex-wrap gap-0.5 mt-1.5">
                                                            {preset.stages.map((s, i) => {
                                                                const agent = builtinAgents.find(a => a.builtinType === s.builtinType)!;
                                                                return (
                                                                    <span
                                                                        key={i}
                                                                        className="w-4 h-4 rounded-full flex items-center justify-center text-[7px]"
                                                                        style={{ backgroundColor: agent.color || '#6b7280' }}
                                                                        title={agent.name}
                                                                    >
                                                                        {agent.icon || agent.name.charAt(0)}
                                                                    </span>
                                                                );
                                                            })}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}

                        <div className="space-y-2 group/input">
                            <label htmlFor="inv-model" className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 group-focus-within/input:text-purple-500 transition-colors">
                                <Zap className="w-3 h-3" /> Selected Model
                            </label>
                            <div className="relative">
                                <select
                                    id="inv-model"
                                    className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none appearance-none shadow-sm cursor-pointer text-sm"
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
                            <label htmlFor="inv-query" className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 group-focus-within/input:text-purple-500 transition-colors">
                                Additional Context / Query
                            </label>
                            <textarea
                                id="inv-query"
                                rows={2}
                                className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none text-sm shadow-sm"
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
                                ? 'bg-slate-700 cursor-not-allowed' 
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
                    <p className="text-center text-xs text-slate-500 mt-4">
                        By starting an investigation, you agree to the usage of AI for telemetry analysis.
                    </p>
                </div>
            </form>

            {/* ── Workflow Editor Modal ───────────────────────────────────────── */}
            {showWorkflowEditor && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowWorkflowEditor(false)}>
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-slate-700/50">
                            <h3 className="text-lg font-bold text-white">
                                {editingWorkflowId ? 'Edit Workflow' : 'Create New Workflow'}
                            </h3>
                            <button type="button" onClick={() => setShowWorkflowEditor(false)} className="p-1 rounded hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {/* Workflow metadata */}
                            <div className="grid grid-cols-[auto_1fr_1fr] gap-3 items-end">
                                <div className="space-y-1 relative">
                                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Icon</label>
                                    <button
                                        type="button"
                                        onClick={() => setIconPickerOpen(!iconPickerOpen)}
                                        className="w-11 h-10 flex items-center justify-center text-xl rounded-lg border border-slate-700 bg-slate-800/50 hover:border-slate-500 focus:ring-2 focus:ring-purple-500 outline-none transition-colors"
                                    >
                                        {workflowSaveIcon}
                                    </button>
                                    {iconPickerOpen && (
                                        <div className="absolute top-full left-0 mt-1 z-10 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-2 grid grid-cols-5 gap-1 w-[180px]">
                                            {['🔧','⚡','🔬','🚨','💚','📜','🔍','🛡️','🧠','🎯','📊','🔥','💎','🚀','⚙️','🧪','🔮','📡','🌐','🤖'].map(icon => (
                                                <button
                                                    key={icon}
                                                    type="button"
                                                    onClick={() => { setWorkflowSaveIcon(icon); setIconPickerOpen(false); }}
                                                    className={`w-8 h-8 flex items-center justify-center text-lg rounded-lg hover:bg-slate-700 transition-colors ${workflowSaveIcon === icon ? 'bg-purple-600/30 ring-1 ring-purple-500' : ''}`}
                                                >
                                                    {icon}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Name *</label>
                                    <input
                                        type="text"
                                        value={workflowSaveName}
                                        onChange={e => setWorkflowSaveName(e.target.value)}
                                        placeholder="My Custom Workflow"
                                        className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white text-sm outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Description</label>
                                    <input
                                        type="text"
                                        value={workflowSaveDesc}
                                        onChange={e => setWorkflowSaveDesc(e.target.value)}
                                        placeholder="Optional description..."
                                        className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-white text-sm outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                </div>
                            </div>

                            {/* Pipeline builder */}
                            <PipelineBuilder
                                value={editingPipeline}
                                onChange={setEditingPipeline}
                                builtinAgents={builtinAgents}
                                availableModels={models}
                            />
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-end gap-3 p-4 border-t border-slate-700/50">
                            <button
                                type="button"
                                onClick={() => setShowWorkflowEditor(false)}
                                className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!workflowSaveName.trim() || !editingPipeline || editingPipeline.stages.length === 0 || savingWorkflow}
                                onClick={handleSaveWorkflow}
                                className="px-5 py-2 rounded-lg text-sm font-bold bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                            >
                                {savingWorkflow ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                {editingWorkflowId ? 'Update Workflow' : 'Save Workflow'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
