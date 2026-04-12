/** Parse a flexible timestamp string into a Date, supporting ISO 8601, US format, and unix timestamps */
export function parseFlexibleTimestamp(input: string): Date | null {
    const trimmed = input.trim();

    // Try direct Date parse first (handles ISO 8601, various formats)
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) return parsed;

    // Format: "03/15/2024 2:30 PM" or "3/15/2024 14:30"
    const usFormatMatch = trimmed.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i,
    );
    if (usFormatMatch) {
        const [, month, day, year, hour, min, sec, ampm] = usFormatMatch;
        let h = parseInt(hour);
        if (ampm) {
            if (ampm.toUpperCase() === 'PM' && h !== 12) h += 12;
            if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;
        }
        const usParsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), h, parseInt(min), parseInt(sec || '0'));
        if (!isNaN(usParsed.getTime())) return usParsed;
    }

    // Unix timestamp (seconds or milliseconds)
    if (/^\d{10,13}$/.test(trimmed)) {
        const ts = parseInt(trimmed);
        const tsParsed = new Date(ts < 1e12 ? ts * 1000 : ts);
        if (!isNaN(tsParsed.getTime())) return tsParsed;
    }

    return null;
}

/** Format Date to datetime-local input value (local timezone) */
export function toDateTimeLocalValue(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Format Date to datetime-local input value (UTC) */
export function toDateTimeUTCValue(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** Format Date for display in UTC */
export function formatDateDisplayUTC(date: Date): string {
    return date.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
        timeZone: 'UTC',
    }) + ' UTC';
}

/**
 * Convert a datetime-local string to an ISO string.
 * In UTC mode the value represents UTC (we append 'Z').
 * In local mode the value represents local time (browser converts).
 */
export function datetimeLocalToISO(value: string, utc: boolean): string {
    const d = utc ? new Date(value + 'Z') : new Date(value);
    return d.toISOString();
}
