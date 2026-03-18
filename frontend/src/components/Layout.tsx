import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, Settings, Info, Menu, X, Clock } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { api } from '../api';
import { useToast } from './Toast';

interface GitHubUser {
    login: string;
    name: string | null;
    avatar_url: string;
}

export const Layout = () => {
    const { toast } = useToast();
    const location = useLocation();
    const [authenticated, setAuthenticated] = useState(false);
    const [user, setUser] = useState<GitHubUser | null>(null);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [loginData, setLoginData] = useState<any>(null);
    const loginPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    // Close mobile menu on route change
    useEffect(() => {
        setMobileMenuOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        checkAuth();
        // Cleanup poller on unmount
        return () => {
            if (loginPollerRef.current) clearInterval(loginPollerRef.current);
        };
    }, []);

    const checkAuth = async () => {
        try {
            const status = await api.getAuthStatus();
            setAuthenticated(status.authenticated);
            setUser(status.user || null);
        } catch (e) { console.error(e); }
    };

    const handleLogin = async () => {
        try {
            const data = await api.startLogin();
            setLoginData(data);
            setShowLoginModal(true);

            // Clear any existing poller
            if (loginPollerRef.current) clearInterval(loginPollerRef.current);

            // Poll
            const poller = setInterval(async () => {
                try {
                    const result = await api.pollLogin(data.device_code, data.interval);
                    if (result.pending) return; // Still waiting for user to authorize
                    if (result.success) {
                        clearInterval(poller);
                        loginPollerRef.current = null;
                        setShowLoginModal(false);
                        setAuthenticated(true);
                        // Fetch user info after successful login
                        checkAuth();
                        toast('success', 'Successfully logged in to GitHub Copilot!');
                    }
                } catch (e: any) {
                    const errMsg = e?.response?.data?.error || e?.message || '';
                    if (errMsg === 'expired_token') {
                        clearInterval(poller);
                        loginPollerRef.current = null;
                        setShowLoginModal(false);
                        toast('warning', 'Login session expired. Please try again.');
                    } else if (errMsg === 'slow_down') {
                        // Back off - skip this poll cycle
                    }
                    // else continue polling
                }
            }, (data.interval + 1) * 1000);
            loginPollerRef.current = poller;

        } catch (e) { toast('error', 'Failed to start login'); }
    };

    return (
        <div className="min-h-screen bg-transparent text-slate-100 font-sans selection:bg-brand-500/30">
            {/* Header */}
            <header className="fixed top-0 left-0 right-0 h-14 sm:h-16 bg-slate-900/70 backdrop-blur-xl border-b border-white/[0.06] z-50 flex items-center justify-between px-3 sm:px-6 shadow-2xl shadow-black/20">
                <div className="flex items-center gap-2 sm:gap-4">
                    <div className="flex items-center gap-2.5">
                        {/* AI Agent Robot Logo - Premium Head */}
                        <div className="relative w-11 h-11 rounded-2xl flex items-center justify-center group cursor-pointer overflow-visible logo-container">
                            {/* Animated spinning border */}
                            <div className="absolute -inset-[2px] rounded-[18px] overflow-hidden">
                                <div className="absolute -inset-[50%] bg-[conic-gradient(#06b6d4,#8b5cf6,#ec4899,#f59e0b,#06b6d4)] opacity-60 group-hover:opacity-100 transition-opacity duration-500 logo-border-spin"></div>
                            </div>
                            {/* Dark interior */}
                            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900"></div>
                            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-950/60 via-transparent to-violet-950/40"></div>
                            <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.1),transparent_50%)]"></div>
                            <svg width="30" height="30" viewBox="0 0 32 32" fill="none" className="relative z-10">
                                <defs>
                                    <filter id="glow-eye">
                                        <feGaussianBlur stdDeviation="1.5" result="blur" />
                                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                                    </filter>
                                    <filter id="glow-antenna">
                                        <feGaussianBlur stdDeviation="2" result="blur" />
                                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                                    </filter>
                                    <linearGradient id="headFill" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="rgba(255,255,255,0.25)" />
                                        <stop offset="40%" stopColor="rgba(255,255,255,0.07)" />
                                        <stop offset="100%" stopColor="rgba(255,255,255,0.15)" />
                                    </linearGradient>
                                    <linearGradient id="eyeFill" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#67e8f9" />
                                        <stop offset="100%" stopColor="#0891b2" />
                                    </linearGradient>
                                    <linearGradient id="visorFill" x1="0" y1="0" x2="1" y2="0">
                                        <stop offset="0%" stopColor="rgba(6,182,212,0.1)" />
                                        <stop offset="50%" stopColor="rgba(6,182,212,0.25)" />
                                        <stop offset="100%" stopColor="rgba(6,182,212,0.1)" />
                                    </linearGradient>
                                </defs>
                                {/* Antenna stem */}
                                <line x1="16" y1="5" x2="16" y2="8.5" stroke="rgba(255,255,255,0.45)" strokeWidth="1.4" strokeLinecap="round" />
                                {/* Antenna orb - pulsing */}
                                <circle cx="16" cy="3.8" r="2" fill="url(#eyeFill)" filter="url(#glow-antenna)" className="animate-pulse" />
                                <circle cx="16.5" cy="3.2" r="0.6" fill="white" fillOpacity="0.8" />
                                {/* Head - larger metallic rounded rect */}
                                <rect x="5" y="8.5" width="22" height="15" rx="4.5" fill="url(#headFill)" stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" />
                                {/* Visor band */}
                                <rect x="7" y="11.5" width="18" height="7" rx="3" fill="url(#visorFill)" />
                                {/* Left eye - outer ring */}
                                <circle cx="11.5" cy="15" r="3.2" fill="none" stroke="rgba(6,182,212,0.35)" strokeWidth="0.8" />
                                {/* Left eye - inner glow */}
                                <circle cx="11.5" cy="15" r="2.3" fill="url(#eyeFill)" filter="url(#glow-eye)" />
                                {/* Left eye - highlight */}
                                <circle cx="12.2" cy="14" r="0.8" fill="white" fillOpacity="0.9" />
                                {/* Right eye - outer ring */}
                                <circle cx="20.5" cy="15" r="3.2" fill="none" stroke="rgba(6,182,212,0.35)" strokeWidth="0.8" />
                                {/* Right eye - inner glow */}
                                <circle cx="20.5" cy="15" r="2.3" fill="url(#eyeFill)" filter="url(#glow-eye)" />
                                {/* Right eye - highlight */}
                                <circle cx="21.2" cy="14" r="0.8" fill="white" fillOpacity="0.9" />
                                {/* Mouth - LED segments */}
                                <rect x="12" y="20.5" width="1.5" height="1.2" rx="0.6" fill="#a78bfa" />
                                <rect x="14.2" y="20.5" width="3.6" height="1.2" rx="0.6" fill="#c084fc" />
                                <rect x="18.5" y="20.5" width="1.5" height="1.2" rx="0.6" fill="#a78bfa" />
                                {/* Ear modules */}
                                <rect x="1.5" y="11" width="3" height="8" rx="1.5" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
                                <circle cx="3" cy="15" r="0.8" fill="#22d3ee" fillOpacity="0.7" />
                                <rect x="27.5" y="11" width="3" height="8" rx="1.5" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
                                <circle cx="29" cy="15" r="0.8" fill="#22d3ee" fillOpacity="0.7" />
                                {/* Chin accent line */}
                                <line x1="11" y1="23.8" x2="21" y2="23.8" stroke="rgba(139,92,246,0.3)" strokeWidth="0.6" strokeLinecap="round" />
                            </svg>
                        </div>
                        <div>
                            <h1 className="text-lg font-black tracking-tight text-white/90">
                                <span className="bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">AI</span>
                                <span className="text-brand-400 font-medium ml-1 text-sm tracking-wide hidden sm:inline">Investigator</span>
                            </h1>
                        </div>
                    </div>

                    {/* Desktop nav */}
                    <nav className="hidden md:flex items-center space-x-1 ml-6">
                        <NavLink to="/" icon={<LayoutDashboard size={18} />} label="Investigations" active={location.pathname === '/'} />
                        <NavLink to="/new" icon={<PlusCircle size={18} />} label="New" active={location.pathname === '/new'} />
                        <NavLink to="/schedules" icon={<Clock size={18} />} label="Schedules" active={location.pathname === '/schedules'} />
                        <NavLink to="/about" icon={<Info size={18} />} label="About" active={location.pathname === '/about'} />
                    </nav>
                </div>

                {/* Desktop right-side controls */}
                <div className="hidden md:flex items-center gap-4">
                    {!authenticated ? (
                        <button onClick={handleLogin} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold transition-colors border border-slate-600">
                            Connect Copilot
                        </button>
                    ) : (
                        <div className="flex items-center px-3 py-1.5 bg-green-900/30 text-green-400 rounded-lg text-xs font-bold border border-green-900/50">
                            <div className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse"></div>
                            Copilot Active
                        </div>
                    )}
                    <Link to="/settings" className="p-2 text-slate-400 hover:text-white transition-colors">
                        <Settings size={20} />
                    </Link>
                    {user ? (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-purple-600 p-0.5" title={user.name || user.login}>
                            <img 
                                src={user.avatar_url} 
                                alt={user.login}
                                className="w-full h-full rounded-full object-cover"
                            />
                        </div>
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 p-0.5">
                            <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center text-slate-500 text-xs font-bold">
                                ?
                            </div>
                        </div>
                    )}
                </div>

                {/* Mobile hamburger button */}
                <button
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    className="md:hidden p-2 text-slate-400 hover:text-white transition-colors"
                    aria-label="Toggle menu"
                >
                    {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
                </button>
            </header>

            {/* Mobile menu drawer */}
            {mobileMenuOpen && (
                <div className="fixed inset-0 z-40 md:hidden">
                    {/* Backdrop */}
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
                    {/* Drawer */}
                    <div className="absolute top-14 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-b border-slate-700/50 shadow-2xl animate-fade-in">
                        <nav className="flex flex-col p-3 gap-1">
                            <MobileNavLink to="/" icon={<LayoutDashboard size={18} />} label="Investigations" active={location.pathname === '/'} />
                            <MobileNavLink to="/new" icon={<PlusCircle size={18} />} label="New Investigation" active={location.pathname === '/new'} />
                            <MobileNavLink to="/schedules" icon={<Clock size={18} />} label="Schedules" active={location.pathname === '/schedules'} />
                            <MobileNavLink to="/about" icon={<Info size={18} />} label="About" active={location.pathname === '/about'} />
                            <MobileNavLink to="/settings" icon={<Settings size={18} />} label="Settings" active={location.pathname === '/settings'} />
                        </nav>
                        <div className="border-t border-slate-800 p-3 flex items-center justify-between">
                            {!authenticated ? (
                                <button onClick={() => { setMobileMenuOpen(false); handleLogin(); }} className="w-full px-3 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-bold transition-colors border border-slate-600">
                                    Connect Copilot
                                </button>
                            ) : (
                                <div className="flex items-center gap-3 w-full">
                                    <div className="flex items-center px-3 py-2 bg-green-900/30 text-green-400 rounded-lg text-xs font-bold border border-green-900/50 flex-1">
                                        <div className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse"></div>
                                        Copilot Active
                                    </div>
                                    {user && (
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-purple-600 p-0.5 shrink-0" title={user.name || user.login}>
                                            <img src={user.avatar_url} alt={user.login} className="w-full h-full rounded-full object-cover" />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Login Modal */}
            {showLoginModal && loginData && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in p-4">
                    <div className="bg-slate-900 p-5 sm:p-8 rounded-2xl border border-slate-700 max-w-md w-full shadow-2xl">
                        <h2 className="text-xl sm:text-2xl font-bold text-white mb-4">Connect to GitHub Copilot</h2>
                        <p className="text-slate-400 mb-6 text-sm sm:text-base">Please visit the URL below and enter the code to authorize.</p>

                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 mb-6 text-center">
                            <div className="text-2xl sm:text-4xl font-mono font-black text-brand-400 tracking-widest mb-2">{loginData.user_code}</div>
                            <div className="text-xs text-slate-500">USER CODE</div>
                        </div>

                        <div className="flex flex-col gap-4">
                            <a href={loginData.verification_uri} target="_blank" rel="noreferrer" className="w-full py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-bold text-center transition-colors">
                                Open Login Page
                            </a>
                            <button onClick={() => { if (loginPollerRef.current) { clearInterval(loginPollerRef.current); loginPollerRef.current = null; } setShowLoginModal(false); }} className="text-slate-500 hover:text-white text-sm">
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <main className="pt-28 sm:pt-32 px-3 sm:px-6 md:px-12 max-w-[1600px] mx-auto animate-slide-up">
                <Outlet />
            </main>
        </div>
    );
};

const NavLink = ({ to, icon, label, active }: { to: string; icon: any; label: string; active: boolean }) => (
    <Link
        to={to}
        className={`flex items-center px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${active
            ? 'bg-white/[0.08] text-white border border-white/[0.08] shadow-inner shadow-white/5'
            : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
    >
        <span className={`mr-2 ${active ? 'text-brand-400' : ''}`}>{icon}</span>
        {label}
    </Link>
);

const MobileNavLink = ({ to, icon, label, active }: { to: string; icon: any; label: string; active: boolean }) => (
    <Link
        to={to}
        className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${active
            ? 'bg-white/[0.08] text-white border border-white/[0.08]'
            : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
    >
        <span className={active ? 'text-brand-400' : ''}>{icon}</span>
        {label}
    </Link>
);
