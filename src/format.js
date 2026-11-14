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
 * Generate standard WireGuard / AmneziaWG .conf text from a wireguard:// or awg:// URI or raw config text.
 */
export function generateWgConf(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    if (/^\[Interface\]/i.test(s)) return s.endsWith("\n") ? s : s + "\n";
    if (!/^(?:wireguard|amneziawg|awg):\/\//i.test(s)) return null;

    try {
        const u = new URL(s.replace(/^(?:amneziawg|awg):\/\//i, "wireguard://"));
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

        // AmneziaWG obfuscation parameters when present
        for (const [key, label] of [
            ["jc", "Jc"], ["jmin", "Jmin"], ["jmax", "Jmax"],
            ["s1", "S1"], ["s2", "S2"],
            ["h1", "H1"], ["h2", "H2"], ["h3", "H3"], ["h4", "H4"],
        ]) {
            const val = getParam(key).trim();
            if (val) lines.push(`${label} = ${val}`);
        }

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

/**
 * Parse a proxy/tunnel URI into structured technical metadata for badges and the Config Inspector modal.
 */
export function parseConfigMeta(uri) {
    const raw = String(uri || "").trim();
    if (!raw) return null;
    const schemeMatch = /^([a-z0-9+.-]+):\/\//i.exec(raw);
    if (!schemeMatch) return null;
    const scheme = schemeMatch[1].toLowerCase();

    if (scheme === "vmess") {
        try {
            const payload = raw.replace(/^vmess:\/\//i, "").split("#")[0];
            const j = JSON.parse(b64ToUtf8(payload));
            if (j && typeof j === "object") {
                const net = String(j.net || "tcp").toUpperCase();
                const tls = String(j.tls || "").toLowerCase();
                const security = tls === "tls" ? "TLS" : tls === "reality" ? "Reality" : "";
                const server = String(j.add || "");
                const port = j.port ? String(j.port) : "";
                const sni = String(j.sni || j.host || "");
                const path = String(j.path || "");
                const chips = [security, net].filter(Boolean);
                const hostPort = server ? (port ? `${server}:${port}` : server) : "";
                return {
                    protocol: "VMESS",
                    server,
                    port,
                    id: String(j.id || ""),
                    security: security || "None",
                    transport: net,
                    sni,
                    host: String(j.host || ""),
                    path,
                    fp: String(j.fp || ""),
                    alpn: String(j.alpn || ""),
                    summary: [...chips, hostPort].filter(Boolean).join(" · "),
                };
            }
        } catch (_) { /* fall through */ }
    }

    try {
        // Normalize custom scheme to http:// for standard URL parsing
        const normUrl = new URL("http://" + raw.slice(schemeMatch[0].length));
        const p = normUrl.searchParams;
        const getP = (k) => p.get(k) || p.get(k.toLowerCase()) || "";

        let server = normUrl.hostname || "";
        let port = normUrl.port || "";
        let id = decodeURIComponent(normUrl.username || "");
        const pass = decodeURIComponent(normUrl.password || "");

        // Shadowsocks base64 userinfo or full host
        if ((scheme === "ss" || scheme === "ssr") && !port && id && !server.includes(".")) {
            try {
                const decoded = b64ToUtf8(raw.replace(/^ss:\/\/|^ssr:\/\//i, "").split("#")[0].split("?")[0]);
                const atIdx = decoded.lastIndexOf("@");
                if (atIdx > 0) {
                    id = decoded.slice(0, atIdx);
                    const hp = decoded.slice(atIdx + 1);
                    const colon = hp.lastIndexOf(":");
                    if (colon > 0) {
                        server = hp.slice(0, colon);
                        port = hp.slice(colon + 1);
                    }
                }
            } catch (_) { /* keep parsed */ }
        } else if (scheme === "ss" && id && !pass && !id.includes(":")) {
            try {
                const decUser = b64ToUtf8(id);
                if (decUser.includes(":")) id = decUser;
            } catch (_) { /* keep raw */ }
        } else if (pass) {
            id = `${id}:${pass}`;
        }

        const rawType = (getP("type") || getP("net") || (
            scheme === "hysteria2" || scheme === "hy2" || scheme === "tuic" ? "quic"
            : scheme === "wireguard" || scheme === "awg" || scheme === "amneziawg" ? "udp"
            : scheme === "ssh" ? "ssh"
            : ""
        )).toLowerCase();

        const TRANSPORT_MAP = {
            tcp: "TCP", ws: "WS", websocket: "WS", grpc: "gRPC", gun: "gRPC",
            xhttp: "XHTTP", splithttp: "XHTTP", httpupgrade: "HTTPUpgrade",
            h2: "H2", http: "HTTP", kcp: "mKCP", quic: "QUIC", udp: "UDP", ssh: "SSH",
        };
        const transport = TRANSPORT_MAP[rawType] || (rawType ? rawType.toUpperCase() : "");

        const rawSec = (getP("security") || (
            scheme === "trojan" || scheme === "hysteria2" || scheme === "hy2" || scheme === "tuic" ? "tls" : ""
        )).toLowerCase();
        const security = rawSec === "reality" ? "Reality"
            : rawSec === "tls" || rawSec === "xtls" ? rawSec.toUpperCase()
            : "";

        const sni = getP("sni") || getP("peer") || "";
        const host = getP("host") || getP("obfsParam") || "";
        const path = getP("path") || getP("serviceName") || "";
        const flow = getP("flow") || "";
        const fp = getP("fp") || "";
        const alpn = getP("alpn") || "";
        const pbk = getP("pbk") || getP("publickey") || "";
        const sid = getP("sid") || "";

        // Telegram MTProto proxy special handling
        if (scheme === "tg" || scheme === "mtproto") {
            server = getP("server") || server;
            port = getP("port") || port;
            id = getP("secret") || id;
        }

        const chips = [security, transport].filter(Boolean);
        const hostPort = server ? (port ? `${server}:${port}` : server) : "";
        return {
            protocol: scheme.toUpperCase(),
            server,
            port,
            id,
            security: security || "None",
            transport: transport || "TCP",
            sni,
            host,
            path,
            flow,
            fp,
            alpn,
            pbk,
            sid,
            summary: [...chips, hostPort].filter(Boolean).join(" · "),
        };
    } catch (_) {
        return null;
    }
}

/**
 * Generate ready-to-paste Linux iproute2 and MikroTik RouterOS commands for a GRE tunnel.
 */
export function generateGreCli(item) {
    if (!item || !item.server) return null;
    const server = String(item.address || item.server).trim();
    const clientIp = String(item.clientAddress || "10.10.10.2/30").trim();
    const mtu = item.mtu ? String(item.mtu).trim() : "1476";
    const ttl = item.ttl ? String(item.ttl).trim() : "64";
    const linux = [
        `sudo ip tunnel add gre-aurora mode gre remote ${server} ttl ${ttl}`,
        `sudo ip addr add ${clientIp} dev gre-aurora`,
        `sudo ip link set gre-aurora mtu ${mtu} up`,
    ].join(" && ");
    const mikrotik = [
        `/interface gre add name="gre-aurora" remote-address=${server} mtu=${mtu} !keepalive`,
        `/ip address add address=${clientIp} interface="gre-aurora"`,
    ].join(" ; ");
    return { linux, mikrotik };
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

const PBK_PROTOCOLS = {
    pptp: { strategy: 1, device: "WAN Miniport (PPTP)" },
    l2tp: { strategy: 3, device: "WAN Miniport (L2TP)" },
    sstp: { strategy: 5, device: "WAN Miniport (SSTP)" },
    ikev2: { strategy: 7, device: "WAN Miniport (IKEv2)" },
};

/**
 * Generate a single Windows Dial-Up / VPN Phonebook (.pbk) connection entry.
 */
export function generatePbkEntry(item, index = 1) {
    if (!item || !item.server) return "";
    const proto = String(item.protocol || "pptp").toLowerCase();
    const cfg = PBK_PROTOCOLS[proto] || PBK_PROTOCOLS.pptp;
    const sectionName = String(item.remark || item.name || item.server || "VPN")
        .replace(/[\[\]\r\n]/g, "_")
        .trim() || "VPN";
    const server = String(item.server).trim();
    const comment = item.username ? `Username: ${item.username}` : "";

    return [
        `[${sectionName}]`,
        "Encoding=1",
        "PBVersion=1",
        "Type=2",
        "AutoLogon=0",
        "UseRasCredentials=1",
        "LowDateTime=-1",
        "HighDateTime=-1",
        `DialParamsUID=${index}`,
        "Guid=00000000000000000000000000000000",
        `VpnStrategy=${cfg.strategy}`,
        "ExcludedProtocols=0",
        "LcpExtensions=1",
        "DataEncryption=8",
        "SwCompression=0",
        "NegotiateMultilinkAlways=0",
        "SkipDoubleAuthDialog=0",
        "RedialAttempts=3",
        "RedialPause=60",
        "RedialOnLinkFailure=1",
        "CallbackMode=0",
        "CustomAuthKey=0",
        "AuthRestrictions=608",
        "TypicalAuth=2",
        "IpPrioritizeRemote=1",
        "IpHeaderCompression=0",
        "IpAddress=0.0.0.0",
        "IpDnsAddress=0.0.0.0",
        "IpDns2Address=0.0.0.0",
        "IpWinsAddress=0.0.0.0",
        "IpWins2Address=0.0.0.0",
        "IpAssign=1",
        "IpNameAssign=1",
        "IpDnsFlags=0",
        "IpNBTFlags=1",
        "IpCheckStatus=0",
        "IpDnsSuffix=",
        "MEDIA=rastapi",
        "Port=VPN2-0",
        `Device=${cfg.device}`,
        "DEVICE=vpn",
        `PhoneNumber=${server}`,
        "AreaCode=",
        "CountryCode=0",
        "CountryID=0",
        "UseDialingRules=0",
        `Comment=${comment}`,
        `FriendlyName=${sectionName}`,
        "LastSelectedPhone=0",
        "PromoteAlternates=0",
        "TryNextAlternateOnFail=1",
        "",
    ].join("\r\n");
}

/**
 * Generate a complete .pbk file containing one or more entries.
 */
export function generatePbkFile(items) {
    if (!Array.isArray(items)) return "";
    return items
        .filter((item) => item && item.server)
        .map((item, i) => generatePbkEntry(item, i + 1))
        .join("\r\n");
}


