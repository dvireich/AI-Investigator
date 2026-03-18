import React from 'react';
import { Brain, GitBranch, Search, Wrench, Sparkles, CheckCircle2, MessageSquare, RotateCcw, Shield, Zap, Database, FileText, ChevronRight, Code2, Globe, Lock, Radio, AlertCircle, Compass, PenLine, Layers, LayoutGrid, ShieldAlert, Share2, FileDown, FileUp, GripHorizontal, CalendarClock, BookOpen, BarChart3, Users, SlidersHorizontal, TrendingUp } from 'lucide-react';

const FeatureCard = ({ icon, color, bg, title, desc }: { icon: React.ReactNode; color: string; bg: string; title: string; desc: string }) => (
    <div className={`rounded-2xl p-5 border flex flex-col gap-3 transition-all hover:-translate-y-0.5 hover:shadow-lg ${bg}`}>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${color}`}>{icon}</div>
        <div>
            <div className="text-slate-200 font-semibold text-sm mb-1">{title}</div>
            <div className="text-slate-500 text-xs leading-relaxed">{desc}</div>
        </div>
    </div>
);

const PipelineStep = ({ n, icon, title, desc, last }: { n: number; icon: React.ReactNode; title: string; desc: string; last?: boolean }) => (
    <div className="flex gap-4">
        <div className="flex flex-col items-center">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500/30 to-purple-500/20 border border-brand-500/30 flex items-center justify-center shrink-0 shadow-inner">
                {icon}
            </div>
            {!last && <div className="w-px flex-1 bg-gradient-to-b from-brand-500/30 to-transparent mt-2 mb-1 min-h-[28px]" />}
        </div>
        <div className="pb-6">
            <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold text-brand-500 bg-brand-500/10 px-1.5 py-0.5 rounded-full border border-brand-500/20">0{n}</span>
                <span className="text-slate-200 font-semibold text-sm">{title}</span>
            </div>
            <p className="text-slate-500 text-xs leading-relaxed">{desc}</p>
        </div>
    </div>
);

const TechPill = ({ label, value, color }: { label: string; value: string; color: string }) => (
    <div className="flex items-center gap-2.5 bg-slate-800/60 border border-slate-700/60 rounded-xl px-3 py-2.5">
        <div className={`w-1.5 h-5 rounded-full ${color} shrink-0`} />
        <div>
            <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">{label}</div>
            <div className="text-slate-300 text-xs font-medium">{value}</div>
        </div>
    </div>
);

const SectionHeader = ({ icon, title }: { icon: React.ReactNode; title: string }) => (
    <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center shrink-0">
            {icon}
        </div>
        <h2 className="text-slate-100 font-bold text-lg">{title}</h2>
        <div className="flex-1 h-px bg-gradient-to-r from-slate-800 to-transparent" />
    </div>
);

export const About = () => (
    <div className="min-h-screen pt-16">

        {/* ── Hero ── */}
        <div className="relative overflow-hidden bg-gradient-to-b from-slate-900/60 via-transparent to-transparent border-b border-slate-800">
            <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[280px] h-[140px] sm:w-[480px] sm:h-[240px] rounded-full bg-brand-500/10 blur-3xl pointer-events-none" />
            <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-purple-600/5 blur-3xl pointer-events-none" />

            <div className="relative max-w-4xl mx-auto px-6 pt-20 pb-16 text-center space-y-5">
                <div className="inline-flex items-center gap-2 bg-slate-800 border border-slate-600 rounded-full px-4 py-1.5 text-xs text-slate-200 font-semibold mb-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                    Internal Tool
                </div>
                <div className="flex items-center justify-center mb-2">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-brand-500/30 to-purple-500/20 border border-brand-500/30 flex items-center justify-center shadow-2xl shadow-brand-500/10">
                        <Brain className="w-8 h-8 text-brand-400" />
                    </div>
                </div>
                <h1 className="text-3xl sm:text-5xl font-black tracking-tight">
                    <span className="text-white">AI </span>
                    <span className="text-white">Investigator</span>
                </h1>
                <p className="text-slate-400 text-lg max-w-xl mx-auto leading-relaxed">
                    A fully autonomous AI investigation platform powered by GitHub Copilot.
                    Point it at any knowledge base, connect it to your data sources, and get
                    from alert to root cause without manual spelunking.
                </p>
                <div className="flex items-center justify-center gap-3 pt-4 flex-wrap">
                    {([
                        [Zap,          'text-amber-400',   'bg-amber-500/10 border-amber-500/20',   'Autonomous agent loops'],
                        [Radio,        'text-sky-400',     'bg-sky-500/10 border-sky-500/20',       'Real-time tool streaming'],
                        [Sparkles,     'text-purple-400',  'bg-purple-500/10 border-purple-500/20', 'Self-improving knowledge base'],
                        [Lock,         'text-emerald-400', 'bg-emerald-500/10 border-emerald-500/20','Zero credentials stored'],
                    ] as const).map(([Icon, iconCls, bg, label]) => (
                        <div key={label} className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-semibold ${bg} ${iconCls}`}>
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            {label}
                        </div>
                    ))}
                </div>
            </div>
        </div>

        <div className="max-w-4xl mx-auto px-6 py-14 space-y-16">

            {/* ── What it does ── */}
            <section>
                <SectionHeader icon={<Search className="w-4 h-4 text-brand-400" />} title="What it does" />
                <div className="grid md:grid-cols-2 gap-4 mt-6">
                    <FeatureCard icon={<Zap className="w-4 h-4" />}
                        color="bg-amber-500/10 border border-amber-500/20 text-amber-400"
                        bg="bg-slate-900/60 border-slate-800 hover:border-amber-500/20"
                        title="Autonomous investigation"
                        desc="Connects to GitHub Copilot and runs a fully autonomous agent that reads your knowledge base guides, queries data sources, and produces a structured report — no manual tool expertise required." />
                    <FeatureCard icon={<Sparkles className="w-4 h-4" />}
                        color="bg-purple-500/10 border border-purple-500/20 text-purple-400"
                        bg="bg-slate-900/60 border-slate-800 hover:border-purple-500/20"
                        title="Self-improving knowledge base"
                        desc="After each investigation the Retrospective agent cross-references the transcript with your guides and proposes targeted file edits — so every investigation makes the next one better." />
                    <FeatureCard icon={<Globe className="w-4 h-4" />}
                        color="bg-brand-500/10 border border-brand-500/20 text-brand-400"
                        bg="bg-slate-900/60 border-slate-800 hover:border-brand-500/20"
                        title="Multi-product support"
                        desc="Configure multiple investigation targets with their own knowledge bases, prompts, and storage paths. Switch between products instantly from the investigation form." />
                    <FeatureCard icon={<Radio className="w-4 h-4" />}
                        color="bg-sky-500/10 border border-sky-500/20 text-sky-400"
                        bg="bg-slate-900/60 border-slate-800 hover:border-sky-500/20"
                        title="Live activity streaming"
                        desc="Every tool call, file read, and query streams to the UI in real time over WebSocket so you can watch the agent think and intervene at any point." />
                    <FeatureCard icon={<AlertCircle className="w-4 h-4" />}
                        color="bg-rose-500/10 border border-rose-500/20 text-rose-400"
                        bg="bg-slate-900/60 border-slate-800 hover:border-rose-500/20"
                        title="ICM incident integration"
                        desc="Start investigations directly from an IcM incident ID. The system auto-extracts stamp, time range, severity, and description — no manual form-filling required." />
                    <FeatureCard icon={<Compass className="w-4 h-4" />}
                        color="bg-teal-500/10 border border-teal-500/20 text-teal-400"
                        bg="bg-slate-900/60 border-slate-800 hover:border-teal-500/20"
                        title="Auto-discovery onboarding"
                        desc="Drop a .investigator.json manifest at any repo root for one-click product setup. Auto-scans for agent files, docs, and prompts when no manifest is found." />
                    <FeatureCard icon={<Share2 className="w-4 h-4" />}
                        color="bg-sky-500/10 border border-sky-500/20 text-sky-400"
                        bg="bg-slate-900/60 border-slate-800 hover:border-sky-500/20"
                        title="Share, export & import"
                        desc="Export investigations as portable JSON or styled PDF reports. Import them back with a file picker or by dragging and dropping onto the dashboard — complete with an animated drop zone." />
                    <FeatureCard icon={<CalendarClock className="w-4 h-4" />}
                        color="bg-indigo-500/10 border border-indigo-500/20 text-indigo-400"
                        bg="bg-slate-900/60 border-slate-800 hover:border-indigo-500/20"
                        title="Scheduled investigations"
                        desc="Set up recurring health checks that run on configurable intervals (5m to 24h). Each schedule tracks verdict history (healthy/warning/critical), supports inline editing, run-now, and auto-cascades deletes." />
                    <FeatureCard icon={<BookOpen className="w-4 h-4" />}
                        color="bg-orange-500/10 border border-orange-500/20 text-orange-400"
                        bg="bg-slate-900/60 border-slate-800 hover:border-orange-500/20"
                        title="Query bank"
                        desc="Save and reuse investigation templates. Store stamp, query, time range, issue type, and model as named presets — load them instantly from the New Investigation form or when creating schedules." />
                    <FeatureCard icon={<BarChart3 className="w-4 h-4" />}
                        color="bg-cyan-500/10 border border-cyan-500/20 text-cyan-400"
                        bg="bg-slate-900/60 border-slate-800 hover:border-cyan-500/20"
                        title="Dashboard analytics"
                        desc="Configurable widget system with 8 chart types — trend, issue donut, duration histogram, success rate, stamp activity, verdict breakdown, model usage, and contest rate. Choose any 3 from Settings." />
                    <FeatureCard icon={<TrendingUp className="w-4 h-4" />}
                        color="bg-lime-500/10 border border-lime-500/20 text-lime-400"
                        bg="bg-slate-900/60 border-slate-800 hover:border-lime-500/20"
                        title="KPI bar"
                        desc="At-a-glance operational metrics — success rate, average duration, weekly investigation count with week-over-week delta, and contest rate. Collapsible alongside the analytics charts." />
                    <FeatureCard icon={<Users className="w-4 h-4" />}
                        color="bg-pink-500/10 border border-pink-500/20 text-pink-400"
                        bg="bg-slate-900/60 border-slate-800 hover:border-pink-500/20"
                        title="Multi-user support"
                        desc="Each investigation tracks who created it — via GitHub login, OS username, or scheduler. Filter the dashboard by creator, see indigo badges on cards, and view the creator in the detail sidebar." />
                    <FeatureCard icon={<SlidersHorizontal className="w-4 h-4" />}
                        color="bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-400"
                        bg="bg-slate-900/60 border-slate-800 hover:border-fuchsia-500/20"
                        title="Settings Analytics tab"
                        desc="Pick which 3 analytics widgets appear on the dashboard from a registry of 8 chart types. Reset to defaults or swap charts instantly — selections persist in localStorage." />
                </div>
            </section>

            {/* ── How it works ── */}
            <section>
                <SectionHeader icon={<GitBranch className="w-4 h-4 text-brand-400" />} title="How it works" />
                <div className="mt-6 bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-0">
                    <PipelineStep n={1} icon={<Lock className="w-4 h-4 text-brand-400" />}
                        title="GitHub Copilot authentication"
                        desc="Uses GitHub device-flow OAuth to obtain a Copilot token. No credentials stored on disk." />
                    <PipelineStep n={2} icon={<Brain className="w-4 h-4 text-purple-400" />}
                        title="Agentic investigation loop"
                        desc="An agentic loop (gpt-4o or claude-sonnet via the Copilot API) reads your knowledge base guides, runs queries, reads logs, and reasons iteratively until it reaches a conclusion." />
                    <PipelineStep n={3} icon={<PenLine className="w-4 h-4 text-teal-400" />}
                        title="Real-time control"
                        desc="Pause, resume, switch models mid-run, or inject messages into the running agent's context to redirect its approach. A configurable max-steps limit auto-pauses the agent at your safety threshold." />
                    <PipelineStep n={4} icon={<FileText className="w-4 h-4 text-sky-400" />}
                        title="Structured report generation"
                        desc="The agent produces a markdown report with root cause analysis, evidence, timeline, and recommended actions. All artifacts are persisted to disk." />
                    <PipelineStep n={5} icon={<RotateCcw className="w-4 h-4 text-amber-400" />}
                        title="Contest & resume"
                        desc="Disagree with the report? Contest it with your feedback. The investigation resumes with your corrections injected — the agent re-examines its findings and produces an improved report." />
                    <PipelineStep n={6} icon={<Sparkles className="w-4 h-4 text-purple-400" />}
                        title="Retrospective analysis"
                        desc="A second agent pass reads the knowledge base and the full investigation transcript, then calls propose_change for each guide improvement it identifies." />
                    <PipelineStep n={7} last icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                        title="Review and apply"
                        desc="You review each proposed change in an inline diff, approve or reject, then apply — the knowledge base improves incrementally with every investigation." />
                </div>
            </section>

            {/* ── Capabilities ── */}
            <section>
                <SectionHeader icon={<Wrench className="w-4 h-4 text-brand-400" />} title="Capabilities" />
                <div className="mt-6 grid md:grid-cols-2 gap-2">
                    {([
                        [Shield,        'text-sky-400',     'Path traversal protection — agents cannot escape the repo root'],
                        [MessageSquare, 'text-purple-400',  'Follow-up chat after retrospective — ask the agent anything'],
                        [RotateCcw,     'text-amber-400',   'Contest reports — provide feedback and the agent re-investigates'],
                        [Database,      'text-emerald-400', 'Dual KQL backend — Kusto CLI primary (auto-installs) + MCP KQL Server fallback'],
                        [AlertCircle,   'text-rose-400',    'ICM auto-extraction — start from incident IDs with auto-populated fields'],
                        [Compass,       'text-teal-400',    'Auto-discovery — .investigator.json manifest for one-click product onboarding'],
                        [Layers,        'text-indigo-400',  'Token auto-compaction — proactive summarization before hitting context limits'],
                        [LayoutGrid,    'text-cyan-400',    'Rich dashboard — grid/list views, pinning, full-text search, keyboard shortcuts (press ?)'],
                        [ShieldAlert,   'text-orange-400',  'Destructive command blocking — Kusto CLI rejects .drop, .delete, .purge commands'],
                        [Globe,         'text-brand-400',   'Configurable model, timeout, knowledge base path, and stamp'],
                        [Lock,          'text-emerald-400', 'Azure CLI inline auth — in-app login prompt when Kusto auth expires mid-investigation'],
                        [Code2,         'text-pink-400',    'Inline diff viewer with LCS-based line-level change highlighting'],
                        [Share2,        'text-sky-400',     'Export as JSON — download any investigation as a portable state file'],
                        [FileDown,      'text-violet-400',  'Export as PDF — styled reports generated server-side via Puppeteer'],
                        [FileUp,        'text-teal-400',    'Import investigations — file picker or drag-and-drop with animated overlay'],
                        [GripHorizontal,'text-slate-400',   'Floating action dock — Resume All, Restart, Import, and New in one toolbar'],
                        [CalendarClock, 'text-indigo-400',   'Recurring schedules — automated stamp health checks with verdict tracking'],
                        [BookOpen,      'text-orange-400',   'Query bank — save and reuse investigation templates across forms'],
                        [BarChart3,     'text-cyan-400',     'Configurable analytics — pick 3 widgets from 8 chart types in Settings'],
                        [TrendingUp,    'text-lime-400',     'KPI bar — success rate, avg duration, weekly count with delta, contest rate'],
                        [Users,         'text-pink-400',     'Created By tracking — auto-detected GitHub login or OS username on every investigation'],
                        [SlidersHorizontal, 'text-fuchsia-400', 'Analytics Settings tab — choose which 3 charts appear on the dashboard'],
                    ] as const).map(([Icon, color, text], i) => (
                        <div key={i} className="flex items-center gap-3 bg-slate-900/40 border border-slate-800/60 rounded-xl px-4 py-3">
                            <Icon className={`w-4 h-4 ${color} shrink-0`} />
                            <span className="text-slate-400 text-sm">{text}</span>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Tech stack ── */}
            <section>
                <SectionHeader icon={<Code2 className="w-4 h-4 text-brand-400" />} title="Tech stack" />
                <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-3">
                    <TechPill label="Backend"  value="Node.js + TypeScript + Express + Puppeteer" color="bg-brand-500" />
                    <TechPill label="Frontend" value="React + Vite + TailwindCSS"     color="bg-sky-500" />
                    <TechPill label="AI"       value="GitHub Copilot API"             color="bg-purple-500" />
                    <TechPill label="Auth"     value="GitHub Device-flow OAuth"       color="bg-emerald-500" />
                    <TechPill label="Comms"    value="WebSockets (ws)"                color="bg-amber-500" />
                    <TechPill label="State"    value="File-based JSON persistence"    color="bg-pink-500" />
                </div>
            </section>

            {/* ── Credits ── */}
            <section>
                <SectionHeader icon={<Sparkles className="w-4 h-4 text-brand-400" />} title="Credits" />
                <div className="mt-6 relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950">
                    <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-brand-500/10 blur-2xl pointer-events-none" />
                    <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-purple-500/10 blur-2xl pointer-events-none" />
                    <div className="relative p-8 flex flex-col md:flex-row items-start md:items-center gap-6">
                        <div className="relative shrink-0">
                            <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-brand-500/40 to-purple-500/30 border border-brand-500/30 flex items-center justify-center shadow-xl shadow-brand-500/10">
                                <span className="text-3xl font-black text-brand-300">D</span>
                            </div>
                            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            </div>
                        </div>
                        <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-white font-black text-xl">dvreich</span>
                                <span className="text-[11px] font-bold text-white bg-brand-600 border border-brand-500 px-2 py-0.5 rounded-full">Designer &amp; Engineer</span>
                                <span className="text-[11px] font-bold text-white bg-purple-700 border border-purple-500 px-2 py-0.5 rounded-full">Azure Monitor</span>
                            </div>
                            <p className="text-slate-400 text-sm leading-relaxed max-w-lg">
                                Conceived, designed, and built entirely by <span className="text-slate-200 font-semibold">dvreich</span> on
                                the Azure Monitor Teleduct team. Born from real on-call pain — the goal was to turn
                                incident investigation from a manual spelunking exercise into a first-class,
                                AI-accelerated experience that gets smarter with every run, and that any team
                                can configure for their own domain.
                            </p>
                            <p className="text-slate-600 text-xs">
                                Built with GitHub Copilot assistance &bull; AM-Teleduct repository &bull; {new Date().getFullYear()}
                            </p>
                        </div>
                        <ChevronRight className="w-5 h-5 text-slate-700 shrink-0 hidden md:block" />
                    </div>
                </div>
            </section>

        </div>

        <div className="border-t border-white/[0.06] py-6 text-center text-slate-500 text-xs">
            AI Investigator &bull; AM-Teleduct &bull; Internal tool &bull; {new Date().getFullYear()}
        </div>
    </div>
);