/* ===========================================================================
   Aurora preference store — localStorage first, cookie fallback, always an
   in-memory copy so the page works where storage is blocked (private mode,
   embedded webviews).
   =========================================================================== */

const mem = {};

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function storeGet(key) {
    if (key in mem) return mem[key];
    try {
        const v = localStorage.getItem(key);
        if (v !== null) return v;
    } catch (_) { /* storage blocked */ }
    try {
        const m = document.cookie.match(new RegExp("(?:^|; )" + escRe(key) + "=([^;]*)"));
        return m ? decodeURIComponent(m[1]) : null;
    } catch (_) {
        return null;
    }
}

export function storeSet(key, value, opts) {
    const str = String(value);
    mem[key] = str;
    try { localStorage.setItem(key, str); } catch (_) { /* ignore */ }
    if ((opts && opts.noCookie) || str.length > 512) return;
    try {
        const sec = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
        document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(str)}; path=/; max-age=31536000; SameSite=Lax${sec}`;
    } catch (_) { /* ignore */ }
}
