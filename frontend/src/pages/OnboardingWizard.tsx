import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, ChevronRight, ChevronLeft, Check, Sparkles, FolderSearch, Server, Rocket } from 'lucide-react';
import { api } from '../api';

type Step = 'welcome' | 'llm' | 'product' | 'done';

const STEPS: Step[] = ['welcome', 'llm', 'product', 'done'];

export const OnboardingWizard = () => {
    const navigate = useNavigate();
    const [step, setStep] = useState<Step>('welcome');
    const [providers, setProviders] = useState<Array<{ type: string; displayName?: string; authRequirement: { type: string } }>>([]);
    const [selectedProvider, setSelectedProvider] = useState('copilot');
    const [saving, setSaving] = useState(false);
    const [repoPath, setRepoPath] = useState('');
    const [discovering, setDiscovering] = useState(false);
    const [discoveryResult, setDiscoveryResult] = useState<string | null>(null);
    const [discoverySuccess, setDiscoverySuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.getAuthProviders().then(setProviders).catch(() => {});
    }, []);

    const stepIndex = STEPS.indexOf(step);
    const progress = ((stepIndex) / (STEPS.length - 1)) * 100;

    const handleSaveProvider = async () => {
        setSaving(true);
        setError(null);
        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ llmProvider: { type: selectedProvider } }),
            });
            if (!response.ok) throw new Error('Failed to save settings');
            setStep('product');
        } catch (e: any) {
            setError(e.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    const handleDiscover = async () => {
        setDiscovering(true);
        setDiscoveryResult(null);
        setDiscoverySuccess(false);
        setError(null);
        try {
            const result = await api.discoverProduct(repoPath.trim());
            if (result.source === 'none') {
                setDiscoveryResult('No investigation configuration found at that path. You can add one later from Settings.');
            } else {
                const p = result.product;
                const trimmedPath = repoPath.trim();
                try {
                    const added = await api.addProduct({
                        name: p.name || trimmedPath.split(/[\\/]/).pop() || 'Product',
                        repoRoot: p.repoRoot || trimmedPath,
                        systemPromptPath: p.systemPromptPath || '',
                        knowledgeBasePath: p.knowledgeBasePath || '',
                        workingDirectory: p.workingDirectory || p.repoRoot || trimmedPath,
                        investigationsPath: p.investigationsPath || '',
                    });
                    await api.setActiveProduct(added.id);
                    const sourceLabel = result.source === 'manifest' ? 'manifest' : 'auto-discovered';
                    setDiscoveryResult(`Found ${sourceLabel} configuration. Product "${added.name}" added and set as active!`);
                    setDiscoverySuccess(true);
                } catch (addErr: any) {
                    if (addErr.message?.includes('already exists')) {
                        setDiscoveryResult(`Found configuration. Product "${p.name}" is already configured.`);
                        setDiscoverySuccess(true);
                    } else {
                        throw addErr;
                    }
                }
            }
        } catch (e: any) {
            setError(e.message || 'Discovery failed');
        } finally {
            setDiscovering(false);
        }
    };

    const handleFinish = () => {
        navigate('/');
    };

    return (
        <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
            <div className="w-full max-w-lg">
                {/* Progress bar */}
                <div className="mb-8">
                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-brand-500 to-purple-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="flex justify-between mt-2 text-[10px] text-slate-600 font-semibold uppercase tracking-wider">
                        <span className="text-brand-400">Welcome</span>
                        <span className={stepIndex >= 1 ? 'text-brand-400' : ''}>LLM Provider</span>
                        <span className={stepIndex >= 2 ? 'text-brand-400' : ''}>Product</span>
                        <span className={stepIndex >= 3 ? 'text-brand-400' : ''}>Ready</span>
                    </div>
                </div>

                <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-8 shadow-2xl">
                    {/* Welcome */}
                    {step === 'welcome' && (
                        <div className="text-center space-y-6">
                            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-tr from-brand-500/30 to-purple-500/20 border border-brand-500/30 flex items-center justify-center">
                                <Brain className="w-8 h-8 text-brand-400" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-black text-white mb-2">Welcome to AI Investigator</h1>
                                <p className="text-slate-400 text-sm leading-relaxed">
                                    Let's get you set up in a couple of steps. You'll configure an LLM provider
                                    and optionally point to a product repository.
                                </p>
                            </div>
                            <button onClick={() => setStep('llm')} className="inline-flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-bold text-sm transition-colors">
                                Get started <ChevronRight size={16} />
                            </button>
                        </div>
                    )}

                    {/* LLM Provider */}
                    {step === 'llm' && (
                        <div className="space-y-6">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                                    <Sparkles className="w-5 h-5 text-amber-400" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white">Choose LLM Provider</h2>
                                    <p className="text-slate-500 text-xs">Powers the investigation agent</p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                {providers.map(p => (
                                    <button
                                        key={p.type}
                                        onClick={() => setSelectedProvider(p.type)}
                                        className={`w-full text-left p-4 rounded-xl border transition-all ${
                                            selectedProvider === p.type
                                                ? 'bg-brand-600/10 border-brand-500/50 ring-1 ring-brand-500/30'
                                                : 'bg-slate-800/60 border-slate-700/60 hover:border-slate-600'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="text-sm font-semibold text-white">{p.displayName || p.type}</div>
                                                <div className="text-xs text-slate-500 mt-0.5">
                                                    {p.authRequirement.type === 'none' ? 'No auth required' : `Requires ${p.authRequirement.type} auth`}
                                                </div>
                                            </div>
                                            {selectedProvider === p.type && (
                                                <Check size={18} className="text-brand-400" />
                                            )}
                                        </div>
                                    </button>
                                ))}
                                {providers.length === 0 && (
                                    <div className="text-center py-6 text-slate-500 text-sm">Loading providers...</div>
                                )}
                            </div>

                            {error && <div className="text-red-400 text-xs bg-red-400/10 rounded-lg p-3">{error}</div>}

                            <div className="flex justify-between">
                                <button onClick={() => setStep('welcome')} className="inline-flex items-center gap-1 px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">
                                    <ChevronLeft size={14} /> Back
                                </button>
                                <button onClick={handleSaveProvider} disabled={saving || !selectedProvider} className="inline-flex items-center gap-2 px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-bold text-sm transition-colors disabled:opacity-50">
                                    {saving ? 'Saving...' : 'Continue'} <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Product */}
                    {step === 'product' && (
                        <div className="space-y-6">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
                                    <FolderSearch className="w-5 h-5 text-teal-400" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white">Add a Product (optional)</h2>
                                    <p className="text-slate-500 text-xs">Point to a repo with investigation guides</p>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs text-slate-400 font-semibold mb-2">Repository Path</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={repoPath}
                                        onChange={e => setRepoPath(e.target.value)}
                                        placeholder="C:\Repos\my-product"
                                        className="flex-1 px-4 py-2.5 bg-slate-800/60 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-brand-500"
                                    />
                                    <button onClick={handleDiscover} disabled={discovering || !repoPath.trim()} className="px-4 py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50">
                                        {discovering ? 'Scanning...' : 'Discover'}
                                    </button>
                                </div>
                            </div>

                            {discoveryResult && (
                                <div className={`text-sm rounded-xl p-3 border ${discoverySuccess ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' : 'text-slate-300 bg-slate-800/60 border-slate-700'}`}>
                                    {discoverySuccess && <Check size={14} className="inline mr-1.5 -mt-0.5" />}
                                    {discoveryResult}
                                </div>
                            )}
                            {error && <div className="text-red-400 text-xs bg-red-400/10 rounded-lg p-3">{error}</div>}

                            <div className="flex justify-between">
                                <button onClick={() => { setStep('llm'); setError(null); }} className="inline-flex items-center gap-1 px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">
                                    <ChevronLeft size={14} /> Back
                                </button>
                                <button onClick={() => setStep('done')} className="inline-flex items-center gap-2 px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-bold text-sm transition-colors">
                                    {repoPath ? 'Continue' : 'Skip'} <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Done */}
                    {step === 'done' && (
                        <div className="text-center space-y-6">
                            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-tr from-emerald-500/30 to-brand-500/20 border border-emerald-500/30 flex items-center justify-center">
                                <Rocket className="w-8 h-8 text-emerald-400" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-black text-white mb-2">You're all set!</h1>
                                <p className="text-slate-400 text-sm leading-relaxed">
                                    AI Investigator is ready. You can always change settings or add more
                                    products from the Settings page.
                                </p>
                            </div>
                            <button onClick={handleFinish} className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm transition-colors">
                                Open Dashboard <ChevronRight size={16} />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
