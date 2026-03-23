import { useState, useEffect } from 'react';
import { Download, X, ExternalLink } from 'lucide-react';

interface VersionStatus {
    current: string;
    latest: string | null;
    updateAvailable: boolean;
    downloadUrl: string | null;
    releaseNotesUrl: string | null;
}

export const UpdateBanner = () => {
    const [status, setStatus] = useState<VersionStatus | null>(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        fetch('/api/version')
            .then(r => r.ok ? r.json() : null)
            .then((data: VersionStatus | null) => {
                if (data?.updateAvailable) {
                    setStatus(data);
                }
            })
            .catch(() => { /* ignore */ });
    }, []);

    if (!status?.updateAvailable || dismissed) return null;

    const handleDismiss = () => {
        setDismissed(true);
    };

    return (
        <div className="fixed top-[4.5rem] sm:top-20 right-3 sm:right-6 z-40 w-72 bg-slate-800/95 backdrop-blur-md border border-brand-500/40 rounded-xl shadow-2xl shadow-black/40 p-3 animate-fade-in">
            <div className="flex items-start gap-2.5">
                <div className="mt-0.5 p-1.5 bg-brand-500/20 rounded-lg shrink-0">
                    <Download size={14} className="text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">
                        v{status.latest} available
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                        You have v{status.current}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                        {status.downloadUrl && (
                            <a
                                href={status.downloadUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-brand-500 hover:bg-brand-400 text-white rounded-lg text-xs font-bold transition-colors"
                            >
                                <Download size={11} /> Download
                            </a>
                        )}
                        {status.releaseNotesUrl && (
                            <a
                                href={status.releaseNotesUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
                            >
                                Notes <ExternalLink size={10} />
                            </a>
                        )}
                    </div>
                </div>
                <button
                    onClick={handleDismiss}
                    className="p-1 hover:bg-white/10 rounded transition-colors shrink-0"
                    aria-label="Dismiss"
                >
                    <X size={14} className="text-slate-400" />
                </button>
            </div>
        </div>
    );
};
