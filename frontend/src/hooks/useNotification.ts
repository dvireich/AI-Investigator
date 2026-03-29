import { useCallback, useRef } from 'react';

// localStorage keys
export const NOTIF_ENABLED_KEY = 'notif-enabled';
export const NOTIF_SOUND_KEY = 'notif-sound';
export const NOTIF_EVENTS_KEY = 'notif-events';

export type NotifEvent = 'completed' | 'failed' | 'paused' | 'requires_intervention';

export const ALL_NOTIF_EVENTS: { value: NotifEvent; label: string }[] = [
    { value: 'completed', label: 'Investigation Completed' },
    { value: 'failed', label: 'Investigation Failed' },
    { value: 'paused', label: 'Investigation Paused' },
    { value: 'requires_intervention', label: 'Requires Intervention' },
];

export const DEFAULT_NOTIF_EVENTS: NotifEvent[] = ['completed', 'failed'];

export function getNotifEnabled(): boolean {
    return localStorage.getItem(NOTIF_ENABLED_KEY) === 'true';
}
export function setNotifEnabled(v: boolean): void {
    localStorage.setItem(NOTIF_ENABLED_KEY, String(v));
}
export function getNotifSound(): boolean {
    return localStorage.getItem(NOTIF_SOUND_KEY) !== 'false'; // default true
}
export function setNotifSound(v: boolean): void {
    localStorage.setItem(NOTIF_SOUND_KEY, String(v));
}
export function getNotifEvents(): NotifEvent[] {
    const raw = localStorage.getItem(NOTIF_EVENTS_KEY);
    if (!raw) return DEFAULT_NOTIF_EVENTS;
    try { return JSON.parse(raw); } catch { return DEFAULT_NOTIF_EVENTS; }
}
export function setNotifEvents(events: NotifEvent[]): void {
    localStorage.setItem(NOTIF_EVENTS_KEY, JSON.stringify(events));
}

/** Shared AudioContext singleton — avoids browser limit of ~6 instances. */
let sharedAudioCtx: AudioContext | null = null;

/** @internal Reset shared AudioContext — test-only */
export function _resetSharedAudioCtx(): void { sharedAudioCtx = null; }

/** Play a short synthesized chime using Web Audio API */
function playChime(): void {
    try {
        if (!sharedAudioCtx) sharedAudioCtx = new AudioContext();
        const ctx = sharedAudioCtx;
        // Resume if suspended (browsers auto-suspend after inactivity)
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
    } catch { /* audio not available */ }
}

export interface UseNotificationReturn {
    notify: (title: string, body: string, event: NotifEvent) => void;
    requestPermission: () => Promise<NotificationPermission>;
}

export function useNotification(): UseNotificationReturn {
    const lastNotifRef = useRef<number>(0);

    const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
        if (!('Notification' in window)) return 'denied';
        if (Notification.permission === 'granted') return 'granted';
        return Notification.requestPermission();
    }, []);

    const notify = useCallback((title: string, body: string, event: NotifEvent) => {
        if (!getNotifEnabled()) return;
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;

        const enabledEvents = getNotifEvents();
        if (!enabledEvents.includes(event)) return;

        // Dedupe: don't fire same notification within 2s
        const now = Date.now();
        if (now - lastNotifRef.current < 2000) return;
        lastNotifRef.current = now;

        const n = new Notification(title, {
            body,
            icon: '/favicon.ico',
            tag: `ai-inv-${event}-${now}`,
        });
        // Auto-close after 10s to avoid accumulation in system tray
        setTimeout(() => n.close(), 10_000);

        if (getNotifSound()) {
            playChime();
        }
    }, []);

    return { notify, requestPermission };
}
