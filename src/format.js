/* ===========================================================================
   Aurora format helpers — tolerant parsing of pongo2-rendered values and
   human-readable byte formatting.
   =========================================================================== */

import { locNum } from "./i18n.js";

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Parse a string/number into a finite number, else 0. */
export function num(v) {
    if (v == null) return 0;
    const n = typeof v === "number" ? v : parseFloat(String(v).trim());
    return Number.isFinite(n) ? n : 0;
}

/**
 * Truthy guard for values the server may emit as "", "0", "false", "none" or
 * "null" (Go int64 zero values and nil bindings all mean "not set").
 */
export function hasValue(v) {
    if (v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s !== "" && s !== "0" && s !== "false" && s !== "none" && s !== "null";
}

const UNITS_EN = ["B", "KB", "MB", "GB", "TB", "PB"];
const UNITS_FA = ["بایت", "کیلوبایت", "مگابایت", "گیگابایت", "ترابایت", "پتابایت"];

/**
 * Human-readable byte size as { value, unit, num }: `value` keeps Latin digits
 * (localize with locNum at display time), `num` is the numeric value for
 * count-up animations, `unit` is already language-appropriate.
 */
export function fmtBytes(bytes, lang) {
    let b = Math.max(0, num(bytes));
    const units = lang === "fa" ? UNITS_FA : UNITS_EN;
    let i = 0;
    while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
    const value = i === 0 ? String(Math.round(b)) : b.toFixed(b >= 100 ? 0 : b >= 10 ? 1 : 2);
    return { value, unit: units[i], num: parseFloat(value) };
}

/** Convenience: localized "12.4 GB" as a single string. */
export function fmtBytesStr(bytes, lang) {
    const f = fmtBytes(bytes, lang);
    return `${locNum(f.value, lang)} ${f.unit}`;
}

/** Decode a (possibly URL-safe / unpadded) base64 string as UTF-8. */
export function b64ToUtf8(b64) {
    let s = b64.replace(/-/g, "+").replace(/_/g, "/").trim();
    while (s.length % 4) s += "=";
    const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
}

/** UTF-8 safe base64 encode (for {url_b64} import schemes). */
export function utf8ToB64(str) {
    const bytes = new TextEncoder().encode(String(str));
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
}

/** Escape text for safe interpolation into innerHTML. */
export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
}

/**
 * Strict encoder for attribute values (href/title built from config remarks).
 * Every non-alphanumeric character outside the URL-safe set is entity-encoded
 * so hostile remarks can't break out of a quoted attribute.
 */
export function escapeAttr(s) {
    return String(s).replace(/[^a-zA-Z0-9]/g, (c) => {
        if ("-._~:/?#[]@!$&'()*+,;=%".indexOf(c) !== -1) {
            if (c === "&") return "&amp;";
            if (c === "'") return "&#39;";
            return c;
        }
        return "&#" + c.charCodeAt(0) + ";";
    });
}
