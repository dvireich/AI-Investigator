import { useState, useEffect } from 'react';
import { Download, X, ExternalLink } from 'lucide-react';

interface VersionStatus {
    current: string;
    latest: string | null;
    updateAvailable: boolean;
    downloadUrl: string | null;
    releaseNotesUrl: string | null;
}

const DISMISSED_KEY = 'update-banner-dismissed-version';

export const UpdateBanner = () => {
    const [status, setStatus] = useState<VersionStatus | null>(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        fetch('/api/version')
            .then(r => r.ok ? r.json() : null)
            .then((data: VersionStatus | null) => {
                if (data?.updateAvailable) {
                    const dismissedVersion = localStorage.getItem(DISMISSED_KEY);
                    if (dismissedVersion === data.latest) {
                        setDismissed(true);
                    }
                    setStatus(data);
                }
            })
            .catch(() => { /* ignore */ });
    }, []);

    if (!status?.updateAvailable || dismissed) return null;

    const handleDismiss = () => {
        if (status.latest) {
            localStorage.setItem(DISMISSED_KEY, status.latest);
        }
        setDismissed(true);
    };

    return (
        <div className="fixed top-14 sm:top-16 left-0 right-0 z-40 bg-brand-600/90 backdrop-blur-sm border-b border-brand-500/50 px-4 py-2 flex items-center justify-center gap-3 text-sm text-white animate-fade-in">
            <Download size={14} className="shrink-0" />
            <span>
                Version <strong>{status.latest}</strong> is available
                {status.current && <span className="text-white/70"> (you have {status.current})</span>}
            </span>
            {status.releaseNotesUrl && (
                <a
                    href={status.releaseNotesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded text-xs font-semibold transition-colors"
                >
                    Release notes <ExternalLink size={10} />
                </a>
            )}
            {status.downloadUrl && (
                <a
                    href={status.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1 bg-white text-brand-700 hover:bg-white/90 rounded-lg text-xs font-bold transition-colors"
                >
                    <Download size={12} /> Download
                </a>
            )}
            <button
                onClick={handleDismiss}
                className="ml-2 p-1 hover:bg-white/20 rounded transition-colors"
                aria-label="Dismiss"
            >
                <X size={14} />
            </button>
        </div>
    );
};
