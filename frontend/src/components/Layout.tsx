import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, Settings, Info, Menu, X, Clock, User } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { api } from '../api';
import { useToast } from './Toast';
import { UpdateBanner } from './UpdateBanner';

interface GitHubUser {
    login: string;
    name: string | null;
    avatar_url: string;
}

export const Layout = () => {
    const { toast } = useToast();
    const location = useLocation();
    const navigate = useNavigate();
    const [authenticated, setAuthenticated] = useState(false);
    const [providerType, setProviderType] = useState<string>('none');
    const [authRequirement, setAuthRequirement] = useState<{ type: string }>({ type: 'none' });
    const [user, setUser] = useState<GitHubUser | null>(null);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [loginData, setLoginData] = useState<any>(null);
    const loginPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const providerDisplayNameRef = useRef('');
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [appVersion, setAppVersion] = useState<string | null>(null);

    // Close mobile menu on route change
    useEffect(() => {
        setMobileMenuOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        checkAuth();
        fetch('/api/version')
            .then(r => { if (r.ok) return r.json(); })
            .then(d => { if (d?.current) setAppVersion(d.current); })
            .catch(() => { console.warn('Failed to fetch app version'); });
        // Cleanup poller on unmount
        return () => {
            if (loginPollerRef.current) clearInterval(loginPollerRef.current);
        };
    }, []);

    // Re-check auth on route changes so the header stays in sync after the user
    // saves a provider config on /settings or when the backend finishes its
    // async provider initialization after a cold start.
    useEffect(() => {
        checkAuth();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    const checkAuth = async () => {
        try {
            const status = await api.getAuthStatus();
            setAuthenticated(status.authenticated);
            setProviderType(status.providerType || 'none');
            setAuthRequirement(status.authRequirement || { type: 'none' });
            setUser(status.user || (status.username ? { login: status.username, name: status.displayName || null, avatar_url: status.avatarUrl || '' } : null));
        } catch (e) { console.error(e); }
    };

    const handleLogin = async () => {
        // Only providers with oauth-device-flow support interactive login
        if (authRequirement.type !== 'oauth-device-flow') {
            // For api-key or other providers, redirect to Settings
            navigate('/settings');
            return;
        }
        try {
            const data = await api.startLogin();
            setLoginData(data);
            setShowLoginModal(true);

            // Clear any existing poller
            if (loginPollerRef.current) clearInterval(loginPollerRef.current);

            // Poll
            const poller = setInterval(async () => {
                try {
                    const result = await api.pollLogin(data.deviceCode, data.interval);
                    if (result.pending) return; // Still waiting for user to authorize
                    if (result.success) {
                        clearInterval(poller);
                        loginPollerRef.current = null;
                        setShowLoginModal(false);
                        setAuthenticated(true);
                        // Fetch user info after successful login
                        checkAuth();
                        toast('success', `Connected to ${providerDisplayNameRef.current}!`);
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

    const providerDisplayName = providerType === 'copilot' ? 'GitHub Copilot'
        : providerType === 'openai' ? 'OpenAI'
        : providerType === 'anthropic' ? 'Anthropic'
        : providerType === 'azure-openai' ? 'Azure OpenAI'
        : providerType === 'ollama' ? 'Ollama'
        : providerType === 'none' ? 'Not Configured'
        : providerType.charAt(0).toUpperCase() + providerType.slice(1);
    providerDisplayNameRef.current = providerDisplayName;

    const connectLabel = providerType === 'none' || !providerType
        ? 'Configure LLM'
        : authRequirement.type === 'oauth-device-flow'
            ? `Connect ${providerDisplayName}`
            : `Configure ${providerDisplayName}`;

    const activeLabel = `${providerDisplayName} Active`;

    return (
        <div className={`min-h-screen bg-transparent text-slate-100 font-sans selection:bg-brand-500/30${location.pathname.startsWith('/investigation/') ? ' h-screen overflow-hidden' : ''}`}>
            <UpdateBanner />
            {/* Header */}
            <header className="fixed top-0 left-0 right-0 h-14 sm:h-16 bg-slate-900/70 backdrop-blur-xl border-b border-white/[0.06] z-50 flex items-center justify-between px-3 sm:px-6 shadow-2xl shadow-black/20">
                <div className="flex items-center gap-2 sm:gap-4">
                    <div className="flex items-center gap-2.5">
                        {/* AI Agent Logo */}
                        <div className="relative w-14 h-14 rounded-full flex items-center justify-center group cursor-pointer overflow-visible logo-container">
                            {/* Animated spinning border */}
                            <div className="absolute -inset-[2px] rounded-full overflow-hidden">
                                <div className="absolute -inset-[50%] bg-[conic-gradient(#06b6d4,#8b5cf6,#ec4899,#f59e0b,#06b6d4)] opacity-60 group-hover:opacity-100 transition-opacity duration-500 logo-border-spin"></div>
                            </div>
                            {/* Dark interior */}
                            <div className="absolute inset-0 rounded-full bg-slate-900"></div>
                            <img src="/icon-circle.png" alt="AI Investigator" width={48} height={48} className="relative z-10 rounded-full" />
                        </div>
                        <div>
                            <h1 className="text-lg font-black tracking-tight text-white/90">
                                <span className="bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">AI</span>
                                <span className="text-brand-400 font-medium ml-1 text-sm tracking-wide hidden sm:inline">Investigator</span>
                                {appVersion && <span className="ml-2 text-[10px] font-normal text-slate-400 align-middle">v{appVersion}</span>}
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
                            {connectLabel}
                        </button>
                    ) : (
                        <div className="flex items-center px-3 py-1.5 bg-green-900/30 text-green-400 rounded-lg text-xs font-bold border border-green-900/50">
                            <div className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse"></div>
                            {activeLabel}
                        </div>
                    )}
                    <Link to="/settings" className="p-2 text-slate-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-lg" aria-label="Settings">
                        <Settings size={20} />
                    </Link>
                    {user && user.avatar_url ? (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-purple-600 p-0.5" title={user.name || user.login} role="img" aria-label={user.name || user.login}>
                            <img 
                                src={user.avatar_url} 
                                alt={user.login}
                                className="w-full h-full rounded-full object-cover"
                            />
                        </div>
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 p-0.5" title={user?.name || user?.login || undefined}>
                            <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center text-slate-500">
                                <User size={14} />
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
                                    {connectLabel}
                                </button>
                            ) : (
                                <div className="flex items-center gap-3 w-full">
                                    <div className="flex items-center px-3 py-2 bg-green-900/30 text-green-400 rounded-lg text-xs font-bold border border-green-900/50 flex-1">
                                        <div className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse"></div>
                                        {activeLabel}
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
                        <h2 className="text-xl sm:text-2xl font-bold text-white mb-4">Connect to {providerDisplayName}</h2>
                        <p className="text-slate-400 mb-6 text-sm sm:text-base">Please visit the URL below and enter the code to authorize.</p>

                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 mb-6 text-center">
                            <div className="text-2xl sm:text-4xl font-mono font-black text-brand-400 tracking-widest mb-2">{loginData.userCode}</div>
                            <div className="text-xs text-slate-400">USER CODE</div>
                        </div>

                        <div className="flex flex-col gap-4">
                            <a href={loginData.verificationUri} target="_blank" rel="noreferrer" className="w-full py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-bold text-center transition-colors">
                                Open Login Page
                            </a>
                            <button onClick={() => { if (loginPollerRef.current) { clearInterval(loginPollerRef.current); loginPollerRef.current = null; } setShowLoginModal(false); }} className="text-slate-400 hover:text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 rounded-lg px-2 py-1">
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <main className={location.pathname.startsWith('/investigation/') ? 'animate-slide-up' : 'pt-[4.5rem] sm:pt-[5rem] px-3 sm:px-6 md:px-8 max-w-[1600px] mx-auto animate-slide-up'}>
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
