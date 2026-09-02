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

/**
 * Generate standard WireGuard .conf text from a wireguard:// URI or raw config text.
 */
export function generateWgConf(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    if (/^\[Interface\]/i.test(s)) return s.endsWith("\n") ? s : s + "\n";
    if (!/^wireguard:\/\//i.test(s)) return null;

    try {
        const u = new URL(s);
        const p = u.searchParams;
        const getParam = (name) => {
            const val = p.get(name);
            if (val !== null && val !== "") return val;
            const target = name.toLowerCase();
            for (const [k, v] of p.entries()) {
                if (k.toLowerCase() === target) return v;
            }
            return "";
        };

        const privateKey = decodeURIComponent(u.username || getParam("privatekey") || "").trim();
        const publicKey = getParam("publickey").trim();
        const address = getParam("address").trim() || getParam("ip").trim();
        if (!privateKey && !publicKey) return null;

        let host = u.hostname;
        if (host && host.includes(":") && !host.startsWith("[")) host = `[${host}]`;
        let endpoint = getParam("endpoint").trim();
        if (!endpoint && host) {
            endpoint = u.port ? `${host}:${u.port}` : host;
        }

        const lines = ["[Interface]"];
        if (privateKey) lines.push(`PrivateKey = ${privateKey.replace(/\s/g, "+")}`);
        if (address) lines.push(`Address = ${address}`);
        const dns = getParam("dns").trim();
        if (dns) lines.push(`DNS = ${dns}`);
        const mtu = getParam("mtu").trim();
        if (mtu) lines.push(`MTU = ${mtu}`);
        const reserved = getParam("reserved").trim();
        if (reserved) lines.push(`Reserved = ${reserved}`);

        lines.push("", "[Peer]");
        if (publicKey) lines.push(`PublicKey = ${publicKey.replace(/\s/g, "+")}`);
        const psk = getParam("presharedkey").trim() || getParam("psk").trim();
        if (psk) lines.push(`PresharedKey = ${psk.replace(/\s/g, "+")}`);
        const allowedIps = getParam("allowedips").trim() || "0.0.0.0/0, ::/0";
        lines.push(`AllowedIPs = ${allowedIps}`);
        if (endpoint) lines.push(`Endpoint = ${endpoint}`);
        const keepalive = getParam("persistentkeepalive").trim() || getParam("keepalive").trim() || "25";
        lines.push(`PersistentKeepalive = ${keepalive}`);

        return lines.join("\n") + "\n";
    } catch (_) {
        return null;
    }
}

/** Trigger browser file download from an in-memory string. */
export function downloadTextFile(text, filename, mimeType = "application/x-wireguard-profile;charset=utf-8") {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Sanitize file name for downloading configurations. */
export function safeFileName(name, fallback = "config", ext = ".conf") {
    let clean = String(name || fallback)
        .replace(/[\\/:*?"<>|]+/g, "-")
        .replace(/\s+/g, "-")
        .replace(/^-+|-+$/g, "")
        .trim();
    if (!clean) clean = fallback;
    const re = new RegExp(`\\${ext}$`, "i");
    return re.test(clean) ? clean : `${clean}${ext}`;
}

