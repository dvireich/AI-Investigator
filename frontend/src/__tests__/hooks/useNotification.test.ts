import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    useNotification,
    getNotifEnabled, setNotifEnabled,
    getNotifSound, setNotifSound,
    getNotifEvents, setNotifEvents,
    ALL_NOTIF_EVENTS, DEFAULT_NOTIF_EVENTS,
    NOTIF_ENABLED_KEY, NOTIF_SOUND_KEY, NOTIF_EVENTS_KEY,
    playChime,
    _resetSharedAudioCtx,
} from '../../hooks/useNotification';

// We need to test the non-exported playChime indirectly via notify

describe('useNotification', () => {
    let originalNotification: typeof Notification;

    beforeEach(() => {
        localStorage.clear();
        originalNotification = globalThis.Notification;
        // Mock Notification API
        const MockNotification = vi.fn() as any;
        MockNotification.permission = 'granted';
        MockNotification.requestPermission = vi.fn().mockResolvedValue('granted');
        globalThis.Notification = MockNotification;
    });

    afterEach(() => {
        globalThis.Notification = originalNotification;
        _resetSharedAudioCtx();
    });

    describe('localStorage helpers', () => {
        it('getNotifEnabled returns false by default', () => {
            expect(getNotifEnabled()).toBe(false);
        });

        it('setNotifEnabled persists true', () => {
            setNotifEnabled(true);
            expect(localStorage.getItem(NOTIF_ENABLED_KEY)).toBe('true');
            expect(getNotifEnabled()).toBe(true);
        });

        it('setNotifEnabled persists false', () => {
            setNotifEnabled(false);
            expect(localStorage.getItem(NOTIF_ENABLED_KEY)).toBe('false');
            expect(getNotifEnabled()).toBe(false);
        });

        it('getNotifSound returns true by default', () => {
            expect(getNotifSound()).toBe(true);
        });

        it('setNotifSound persists false', () => {
            setNotifSound(false);
            expect(localStorage.getItem(NOTIF_SOUND_KEY)).toBe('false');
            expect(getNotifSound()).toBe(false);
        });

        it('getNotifEvents returns defaults when not set', () => {
            expect(getNotifEvents()).toEqual(DEFAULT_NOTIF_EVENTS);
        });

        it('setNotifEvents persists and retrieves events', () => {
            const events = ['completed', 'failed', 'paused'] as any;
            setNotifEvents(events);
            expect(getNotifEvents()).toEqual(events);
        });

        it('getNotifEvents returns defaults on invalid JSON', () => {
            localStorage.setItem(NOTIF_EVENTS_KEY, 'invalid-json');
            expect(getNotifEvents()).toEqual(DEFAULT_NOTIF_EVENTS);
        });
    });

    describe('ALL_NOTIF_EVENTS', () => {
        it('contains 4 event types', () => {
            expect(ALL_NOTIF_EVENTS).toHaveLength(4);
            expect(ALL_NOTIF_EVENTS.map(e => e.value)).toEqual([
                'completed', 'failed', 'paused', 'requires_intervention',
            ]);
        });
    });

    describe('requestPermission', () => {
        it('returns granted when already granted', async () => {
            const { result } = renderHook(() => useNotification());
            const perm = await act(() => result.current.requestPermission());
            expect(perm).toBe('granted');
        });

        it('calls Notification.requestPermission when not granted', async () => {
            (Notification as any).permission = 'default';
            const { result } = renderHook(() => useNotification());
            await act(() => result.current.requestPermission());
            expect(Notification.requestPermission).toHaveBeenCalled();
        });

        it('returns denied when Notification not available', async () => {
            delete (globalThis as any).Notification;
            const { result } = renderHook(() => useNotification());
            const perm = await act(() => result.current.requestPermission());
            expect(perm).toBe('denied');
            globalThis.Notification = originalNotification; // restore for afterEach
        });
    });

    describe('notify', () => {
        it('does not fire when notifications disabled', () => {
            setNotifEnabled(false);
            const { result } = renderHook(() => useNotification());
            act(() => result.current.notify('Title', 'Body', 'completed'));
            expect(Notification).not.toHaveBeenCalled();
        });

        it('does not fire when permission not granted', () => {
            setNotifEnabled(true);
            (Notification as any).permission = 'denied';
            const { result } = renderHook(() => useNotification());
            act(() => result.current.notify('Title', 'Body', 'completed'));
            expect(Notification).not.toHaveBeenCalled();
        });

        it('does not fire when event type not in enabled events', () => {
            setNotifEnabled(true);
            setNotifEvents(['failed']);
            const { result } = renderHook(() => useNotification());
            act(() => result.current.notify('Title', 'Body', 'completed'));
            expect(Notification).not.toHaveBeenCalled();
        });

        it('fires notification when enabled and event type is allowed', () => {
            setNotifEnabled(true);
            setNotifEvents(['completed']);
            const { result } = renderHook(() => useNotification());
            act(() => result.current.notify('Test Title', 'Test Body', 'completed'));
            expect(Notification).toHaveBeenCalledWith('Test Title', expect.objectContaining({
                body: 'Test Body',
                icon: '/favicon.ico',
            }));
        });

        it('deduplicates rapid notifications within 2s', () => {
            setNotifEnabled(true);
            setNotifEvents(['completed']);
            const { result } = renderHook(() => useNotification());
            act(() => result.current.notify('Title1', 'Body1', 'completed'));
            act(() => result.current.notify('Title2', 'Body2', 'completed'));
            // Only first fires
            expect(Notification).toHaveBeenCalledTimes(1);
        });

        it('does not fire when Notification API unavailable', () => {
            setNotifEnabled(true);
            delete (globalThis as any).Notification;
            const { result } = renderHook(() => useNotification());
            act(() => result.current.notify('Title', 'Body', 'completed'));
            // No error thrown
            globalThis.Notification = originalNotification;
        });

        it('plays chime when sound is on', () => {
            setNotifEnabled(true);
            setNotifEvents(['completed']);
            setNotifSound(true);
            // Mock AudioContext
            const mockOsc = { connect: vi.fn(), type: '', frequency: { setValueAtTime: vi.fn() }, start: vi.fn(), stop: vi.fn() };
            const mockGain = { connect: vi.fn(), gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } };
            const mockCtx = { createOscillator: () => mockOsc, createGain: () => mockGain, destination: {}, currentTime: 0 };
            vi.stubGlobal('AudioContext', vi.fn(() => mockCtx));

            const { result } = renderHook(() => useNotification());
            act(() => result.current.notify('Title', 'Body', 'completed'));
            expect(mockOsc.start).toHaveBeenCalled();
            vi.unstubAllGlobals();
        });

        it('resumes suspended AudioContext before playing chime', () => {
            setNotifEnabled(true);
            setNotifEvents(['completed']);
            setNotifSound(true);
            const mockOsc = { connect: vi.fn(), type: '', frequency: { setValueAtTime: vi.fn() }, start: vi.fn(), stop: vi.fn() };
            const mockGain = { connect: vi.fn(), gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } };
            const mockCtx = { state: 'suspended', resume: vi.fn(), createOscillator: () => mockOsc, createGain: () => mockGain, destination: {}, currentTime: 0 };
            vi.stubGlobal('AudioContext', vi.fn(() => mockCtx));

            const { result } = renderHook(() => useNotification());
            act(() => result.current.notify('Title', 'Body', 'completed'));
            expect(mockCtx.resume).toHaveBeenCalled();
            expect(mockOsc.start).toHaveBeenCalled();
            vi.unstubAllGlobals();
        });

        it('does not play chime when sound is off', () => {
            setNotifEnabled(true);
            setNotifEvents(['completed']);
            setNotifSound(false);
            const mockOsc = { connect: vi.fn(), type: '', frequency: { setValueAtTime: vi.fn() }, start: vi.fn(), stop: vi.fn() };
            const mockGain = { connect: vi.fn(), gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } };
            const mockCtx = { createOscillator: () => mockOsc, createGain: () => mockGain, destination: {}, currentTime: 0 };
            vi.stubGlobal('AudioContext', vi.fn(() => mockCtx));

            const { result } = renderHook(() => useNotification());
            act(() => result.current.notify('Title', 'Body', 'completed'));
            expect(mockOsc.start).not.toHaveBeenCalled();
            vi.unstubAllGlobals();
        });

        it('handles AudioContext failure gracefully', () => {
            setNotifEnabled(true);
            setNotifEvents(['completed']);
            setNotifSound(true);
            vi.stubGlobal('AudioContext', vi.fn(() => { throw new Error('no audio'); }));

            const { result } = renderHook(() => useNotification());
            // Should not throw
            act(() => result.current.notify('Title', 'Body', 'completed'));
            expect(Notification).toHaveBeenCalled();
            vi.unstubAllGlobals();
        });
    });
});
