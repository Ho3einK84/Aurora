/* ===========================================================================
   Aurora preference store — localStorage first, cookie fallback, always an
   in-memory copy so the page works where storage is blocked (private mode,
   embedded webviews).
   =========================================================================== */

const mem = {};

export function storeGet(key) {
    if (key in mem) return mem[key];
    try {
        const v = localStorage.getItem(key);
        if (v !== null) return v;
    } catch (_) { /* storage blocked */ }
    const m = document.cookie.match(new RegExp("(?:^|; )" + key + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
}

export function storeSet(key, value) {
    mem[key] = value;
    try { localStorage.setItem(key, value); } catch (_) { /* ignore */ }
    try {
        document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
    } catch (_) { /* ignore */ }
}
