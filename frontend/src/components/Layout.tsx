import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, Settings } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { api } from '../api';

export const Layout = () => {
    const location = useLocation();
    const [authenticated, setAuthenticated] = useState(false);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [loginData, setLoginData] = useState<any>(null);
    const loginPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
                        alert("Successfully logged in to GitHub Copilot!");
                    }
                } catch (e: any) {
                    const errMsg = e?.response?.data?.error || e?.message || '';
                    if (errMsg === 'expired_token') {
                        clearInterval(poller);
                        loginPollerRef.current = null;
                        setShowLoginModal(false);
                        alert('Login session expired. Please try again.');
                    } else if (errMsg === 'slow_down') {
                        // Back off — skip this poll cycle
                    }
                    // else continue polling
                }
            }, (data.interval + 1) * 1000);
            loginPollerRef.current = poller;

        } catch (e) { alert("Failed to start login"); }
    };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-brand-500/30">
            {/* Header */}
            <header className="fixed top-0 left-0 right-0 h-16 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-white/10 z-50 flex items-center justify-between px-6 shadow-2xl">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        {/* CSS LOGO */}
                        <div className="relative w-8 h-8 rounded-xl bg-gradient-to-tr from-brand-400 to-brand-600 flex items-center justify-center shadow-lg shadow-brand-500/20 group cursor-pointer overflow-hidden">
                            <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <div className="w-4 h-4 rounded-full border-2 border-white/90"></div>
                            <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.8)]"></div>
                        </div>
                        <div>
                            <h1 className="text-lg font-black tracking-tight text-white/90">
                                <span className="bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">AI</span>
                                <span className="text-brand-400 font-medium ml-1 text-sm tracking-wide">Investigator</span>
                            </h1>
                        </div>
                    </div>

                    <nav className="flex items-center space-x-1 ml-6">
                        <NavLink to="/" icon={<LayoutDashboard size={18} />} label="Investigations" active={location.pathname === '/'} />
                        <NavLink to="/new" icon={<PlusCircle size={18} />} label="New" active={location.pathname === '/new'} />
                    </nav>
                </div>

                <div className="flex items-center gap-4">
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
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-purple-600 p-0.5">
                        <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center text-white text-xs font-bold">
                            DR
                        </div>
                    </div>
                </div>
            </header>

            {/* Login Modal */}
            {showLoginModal && loginData && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
                    <div className="bg-slate-900 p-8 rounded-2xl border border-slate-700 max-w-md w-full shadow-2xl">
                        <h2 className="text-2xl font-bold text-white mb-4">Connect to GitHub Copilot</h2>
                        <p className="text-slate-400 mb-6">Please visit the URL below and enter the code to authorize.</p>

                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 mb-6 text-center">
                            <div className="text-4xl font-mono font-black text-brand-400 tracking-widest mb-2">{loginData.user_code}</div>
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
            <main className="pt-24 px-6 md:px-12 max-w-[1600px] mx-auto animate-slide-up">
                <Outlet />
            </main>
        </div>
    );
};

const NavLink = ({ to, icon, label, active }: { to: string; icon: any; label: string; active: boolean }) => (
    <Link
        to={to}
        className={`flex items-center px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${active
            ? 'bg-white/10 text-white shadow-inner shadow-white/5'
            : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
    >
        <span className={`mr-2 ${active ? 'text-brand-400' : ''}`}>{icon}</span>
        {label}
    </Link>
);
