import { Link } from 'react-router-dom';
import { Home, Search } from 'lucide-react';

export const NotFound = () => (
    <div className="flex items-center justify-center min-h-[60vh] p-6 animate-fade-in">
        <div className="text-center max-w-md">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-800/60 border border-slate-700/40 mb-5">
                <Search className="w-8 h-8 text-slate-500" />
            </div>
            <h1 className="text-5xl font-black text-white mb-2">404</h1>
            <h2 className="text-lg font-bold text-slate-300 mb-2">Page not found</h2>
            <p className="text-slate-400 text-sm mb-6">
                The page you're looking for doesn't exist or has been moved.
            </p>
            <Link
                to="/"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 text-white rounded-xl font-bold text-sm hover:bg-brand-500 transition-colors shadow-lg shadow-brand-500/20"
            >
                <Home className="w-4 h-4" />
                Back to Dashboard
            </Link>
        </div>
    </div>
);
