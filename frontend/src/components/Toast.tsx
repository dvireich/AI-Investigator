import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
    id: string;
    type: ToastType;
    message: string;
    duration: number;
}

interface ConfirmOptions {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'default';
}

interface ToastContextType {
    toast: (type: ToastType, message: string, duration?: number) => void;
    confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
    return ctx;
};

// ── Icon map ─────────────────────────────────────────────────────────────

const iconMap: Record<ToastType, { icon: React.ReactNode; color: string; bg: string; border: string }> = {
    success: {
        icon: <CheckCircle2 className="w-4 h-4" />,
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/20',
    },
    error: {
        icon: <XCircle className="w-4 h-4" />,
        color: 'text-red-400',
        bg: 'bg-red-500/10',
        border: 'border-red-500/20',
    },
    warning: {
        icon: <AlertTriangle className="w-4 h-4" />,
        color: 'text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/20',
    },
    info: {
        icon: <Info className="w-4 h-4" />,
        color: 'text-blue-400',
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/20',
    },
};

// ── Single Toast ─────────────────────────────────────────────────────────

const ToastItem = ({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) => {
    const [exiting, setExiting] = useState(false);
    const cfg = iconMap[toast.type];

    useEffect(() => {
        const timer = setTimeout(() => setExiting(true), toast.duration - 300);
        const remove = setTimeout(() => onDismiss(toast.id), toast.duration);
        return () => { clearTimeout(timer); clearTimeout(remove); };
    }, [toast, onDismiss]);

    return (
        <div
            className={`flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl shadow-2xl max-w-sm transition-all duration-300 ${cfg.bg} ${cfg.border} ${
                exiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'
            }`}
        >
            <div className={`mt-0.5 shrink-0 ${cfg.color}`}>{cfg.icon}</div>
            <p className="text-sm text-slate-200 flex-1 break-words">{toast.message}</p>
            <button
                onClick={() => onDismiss(toast.id)}
                className="shrink-0 p-0.5 rounded text-slate-500 hover:text-slate-300 transition-colors"
            >
                <X className="w-3.5 h-3.5" />
            </button>
        </div>
    );
};

// ── Confirm Modal ────────────────────────────────────────────────────────

interface ConfirmState extends ConfirmOptions {
    resolve: (value: boolean) => void;
}

const ConfirmModal = ({ state, onClose }: { state: ConfirmState; onClose: (result: boolean) => void }) => {
    const isDanger = state.variant === 'danger';

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose(false);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center" onClick={() => onClose(false)}>
            <div
                className="bg-slate-900/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl shadow-2xl p-6 max-w-sm mx-4 w-full animate-fade-in"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                        isDanger
                            ? 'bg-red-500/15 border-red-500/20'
                            : 'bg-blue-500/15 border-blue-500/20'
                    }`}>
                        {isDanger
                            ? <AlertTriangle className="w-5 h-5 text-red-400" />
                            : <Info className="w-5 h-5 text-blue-400" />
                        }
                    </div>
                    <h3 className="text-base font-bold text-white">{state.title}</h3>
                </div>
                <p className="text-sm text-slate-400 mb-6 leading-relaxed">{state.message}</p>
                <div className="flex justify-end gap-2">
                    <button
                        onClick={() => onClose(false)}
                        className="px-4 py-2 text-sm font-bold text-slate-400 hover:bg-slate-800 rounded-xl transition-colors"
                    >
                        {state.cancelLabel || 'Cancel'}
                    </button>
                    <button
                        onClick={() => onClose(true)}
                        className={`px-4 py-2 text-sm font-bold text-white rounded-xl transition-colors shadow-lg ${
                            isDanger
                                ? 'bg-red-600 hover:bg-red-500 shadow-red-500/20'
                                : 'bg-brand-600 hover:bg-brand-500 shadow-brand-500/20'
                        }`}
                    >
                        {state.confirmLabel || 'Confirm'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ── Provider ─────────────────────────────────────────────────────────────

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
    const idCounter = useRef(0);

    const addToast = useCallback((type: ToastType, message: string, duration = 4000) => {
        const id = String(++idCounter.current);
        setToasts(prev => [...prev.slice(-4), { id, type, message, duration }]); // keep max 5
    }, []);

    const dismissToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const showConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
            setConfirmState({ ...options, resolve });
        });
    }, []);

    const handleConfirmClose = useCallback((result: boolean) => {
        if (confirmState) {
            confirmState.resolve(result);
            setConfirmState(null);
        }
    }, [confirmState]);

    return (
        <ToastContext.Provider value={{ toast: addToast, confirm: showConfirm }}>
            {children}

            {/* Toast stack */}
            <div className="fixed top-4 right-4 z-[110] flex flex-col gap-2 pointer-events-auto">
                {toasts.map(t => (
                    <ToastItem key={t.id} toast={t} onDismiss={dismissToast} />
                ))}
            </div>

            {/* Confirm modal */}
            {confirmState && <ConfirmModal state={confirmState} onClose={handleConfirmClose} />}
        </ToastContext.Provider>
    );
};
