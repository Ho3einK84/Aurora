/* ===========================================================================
   Aurora VPN access — OpenVPN / WireGuard / AmneziaWG / SSTP / GRE /
   L2TP / PPTP / IKEv2 / Cisco AnyConnect support for the Rebecca panel
   (`dev` branch).

   Rebecca exposes the VPN and tunnel data in two places:
     • `.ovpn` (…/ov/{tag}.ovpn), WireGuard (…/wg/{tag}.conf) and AmneziaWG
       (…/awg/{tag}.conf) profile download links are appended to the
       template's `links` list and served by the panel;
     • the subscription `/info` endpoint returns
         { user, openvpn: { downloads: [url…], profiles: [{…}…] },
           wireguard: { downloads: [url…], links: [uri…], profiles: [{…}…] },
           amneziawg: { downloads: [url…], profiles: [{…}…] },
           sstp:       [{ RemoteAccessInfo }],
           gre:        [{ RemoteAccessInfo }],
           l2tp:       [{…}],
           pptp:       [{…}],
           ikev2:      [{ RemoteAccessInfo }],
           anyconnect: [{ RemoteAccessInfo }] }
     The `openvpn` key was `ov` on older `dev` builds (pre `4579d6d`) — both
     are read here so this template works against either schema.

   This module renders a tabbed "VPN files" card with download, copy and
   credential features tailored to each protocol.
   =========================================================================== */

import {
    escapeHtml, escapeAttr, generateWgConf, downloadTextFile,
    safeFileName, generatePbkEntry, generatePbkFile, generateGreCli,
} from "./format.js";
import { configLabel } from "./configs.js";
import { $, $$, setHidden, copyText, toast } from "./ui.js";
import { storeGet, storeSet } from "./store.js";

const CACHE_KEY = "aurora_vpn";

/* --------------------------------------------------------------- helpers */

/** True for the panel's OpenVPN profile download links (…/ov/{tag}.ovpn). */
export function isOvpnLink(uri) {
    if (!/^https?:\/\//i.test(uri)) return false;
    try {
        const path = new URL(uri).pathname;
        return /\.ovpn$/i.test(path);
    } catch (_) {
        return /\.ovpn(?:[?#]|$)/i.test(uri);
    }
}

/** True for AmneziaWG URIs (awg://…) or panel AmneziaWG download links (…/awg/….conf). */
export function isAwgLink(uri) {
    if (!uri || typeof uri !== "string") return false;
    const s = uri.trim();
    if (/^(?:amneziawg|awg):\/\//i.test(s)) return true;
    if (!/^https?:\/\//i.test(s)) return false;
    try {
        const path = new URL(s).pathname;
        return /\/awg\/[^/]+\.conf$/i.test(path) || (/\.conf$/i.test(path) && /\bawg\b/i.test(path));
    } catch (_) {
        return /\/awg\/[^/?#]+\.conf(?:[?#]|$)/i.test(s);
    }
}

/** True for WireGuard URIs (wireguard://…) or panel WireGuard download links (…/wg/….conf). */
export function isWgLink(uri) {
    if (!uri || typeof uri !== "string") return false;
    const s = uri.trim();
    if (isAwgLink(s)) return false;
    if (/^wireguard:\/\//i.test(s)) return true;
    if (!/^https?:\/\//i.test(s)) return false;
    try {
        const path = new URL(s).pathname;
        return /\.conf$/i.test(path);
    } catch (_) {
        return /\.conf(?:[?#]|$)/i.test(s);
    }
}

/** Human label for an .ovpn download URL — the decoded file name sans suffix. */
export function ovpnLabel(url) {
    try {
        const path = new URL(url, "http://x").pathname;
        const file = (path.split("/").pop() || "").replace(/\.ovpn$/i, "");
        const name = decodeURIComponent(file).trim();
        if (name) return name;
    } catch (_) { /* fall through */ }
    return "OpenVPN";
}

const clean = (v) => (typeof v === "string" ? v.trim() : "");

function normOvpn(url) {
    url = clean(url);
    return url ? { url, name: ovpnLabel(url) } : null;
}

function normCreds(row, withPsk, proto = "l2tp") {
    if (!row || typeof row !== "object") return null;
    const item = {
        tag: clean(row.host_tag) || clean(row.inbound_tag),
        remark: clean(row.remark) || clean(row.host_tag) || clean(row.server),
        server: clean(row.server),
        username: clean(row.username),
        password: clean(row.password),
        psk: withPsk ? clean(row.ipsec_psk) : "",
        protocol: proto,
    };
    return item.server || item.username ? item : null;
}

/**
 * Normalize an IKEv2 or AnyConnect (Cisco) entry from the /info response.
 * Same RemoteAccessInfo shape as L2TP/PPTP, plus:
 *   protocol, auth_mode ("password" | "certificate"), dns
 * When auth_mode === "certificate", username and password are empty — the
 * backend does not currently expose a certificate/profile download endpoint
 * for these protocols (TODO: revisit when/if Rebecca adds one).
 */
function normRemoteAccess(row) {
    if (!row || typeof row !== "object") return null;
    const proto = clean(row.protocol).toLowerCase();
    const authMode = clean(row.auth_mode) || (proto === "gre" ? "none" : "password");
    let dns = "";
    if (Array.isArray(row.dns)) {
        dns = row.dns.map(clean).filter(Boolean).join(", ");
    } else if (typeof row.dns === "string") {
        dns = clean(row.dns);
    }
    const server = clean(row.server) || clean(row.address);
    const address = clean(row.address) || server;
    const item = {
        tag: clean(row.host_tag) || clean(row.inbound_tag),
        remark: clean(row.remark) || clean(row.host_tag) || clean(row.server),
        server,
        address,
        port: row.port || "",
        protocol: proto || clean(row.protocol),
        authMode,
        username: clean(row.username),
        password: clean(row.password),
        dns,
        clientAddress: clean(row.client_address),
        serverAddress: clean(row.server_address),
        mtu: row.mtu ? String(row.mtu) : "",
        ttl: row.ttl ? String(row.ttl) : "",
    };
    return item.server || item.address || item.username || item.clientAddress ? item : null;
}

function normAwg(row) {
    if (!row || typeof row !== "object") return null;
    const item = {
        downloadUrl: clean(row.download_url),
        link: clean(row.link),
        body: clean(row.body),
        name: clean(row.remark) || clean(row.filename) || clean(row.host_name) || (row.link ? configLabel(row.link) : "") || "AmneziaWG",
        server: clean(row.server),
        address: clean(row.address),
        port: row.port || "",
        clientAddress: clean(row.client_address),
        clientPublicKey: clean(row.client_public_key),
        serverPublicKey: clean(row.server_public_key),
    };
    return item.downloadUrl || item.link || item.body || item.server ? item : null;
}

function normWg(row) {
    if (!row || typeof row !== "object") return null;
    const item = {
        downloadUrl: clean(row.download_url),
        link: clean(row.link),
        body: clean(row.body),
        name: clean(row.remark) || clean(row.filename) || clean(row.host_name) || (row.link ? configLabel(row.link) : "") || "WireGuard",
        server: clean(row.server),
        address: clean(row.address),
        port: row.port || "",
        clientAddress: clean(row.client_address),
        clientPublicKey: clean(row.client_public_key),
        serverPublicKey: clean(row.server_public_key),
    };
    return item.downloadUrl || item.link || item.body || item.server ? item : null;
}

function mergeProfiles(list) {
    const map = new Map();
    for (const item of list) {
        if (!item) continue;
        const key = (item.name || "").trim().toLowerCase() || item.link || item.downloadUrl;
        if (!map.has(key)) {
            map.set(key, { ...item });
        } else {
            const cur = map.get(key);
            if (!cur.downloadUrl && item.downloadUrl) cur.downloadUrl = item.downloadUrl;
            if (!cur.link && item.link) cur.link = item.link;
            if (!cur.body && item.body) cur.body = item.body;
            if (!cur.server && item.server) cur.server = item.server;
            if (!cur.address && item.address) cur.address = item.address;
            if (!cur.port && item.port) cur.port = item.port;
            if (!cur.clientAddress && item.clientAddress) cur.clientAddress = item.clientAddress;
            if (!cur.clientPublicKey && item.clientPublicKey) cur.clientPublicKey = item.clientPublicKey;
            if (!cur.serverPublicKey && item.serverPublicKey) cur.serverPublicKey = item.serverPublicKey;
        }
    }
    return Array.from(map.values());
}

function mergeOvpn(list) {
    const seen = new Set();
    return list.filter((item) => {
        if (!item || !item.url) return false;
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
    });
}

/* ---------------------------------------------------------------- module */

/**
 * Mount the OpenVPN files section. `deps`:
 *   ctx        — parsed data island (subUrl, username)
 *   ovpnLinks  — `.ovpn` download URLs already present in the links list
 *   wgLinks    — WireGuard URIs already present in the links list
 *   t(key), lang() — i18n accessors
 * Returns { start, rerender }.
 */
export function mountVpn(deps) {
    const { ctx, t } = deps;
    const cacheKey = `${CACHE_KEY}:${ctx.username || ""}`;

    let ovpn = mergeOvpn((deps.ovpnLinks || []).map(normOvpn).filter(Boolean));
    let wg = mergeProfiles((deps.wgLinks || []).map((link) => {
        if (/^wireguard:\/\//i.test(link)) return normWg({ link, remark: configLabel(link) });
        return normWg({
            download_url: link,
            remark: ovpnLabel(link).replace(/\.conf$/i, ""),
        });
    }).filter(Boolean));
    let awg = mergeProfiles((deps.awgLinks || []).map((link) => {
        if (/^(?:amneziawg|awg):\/\//i.test(link)) return normAwg({ link, remark: configLabel(link) });
        return normAwg({
            download_url: link,
            remark: ovpnLabel(link).replace(/\.conf$/i, ""),
        });
    }).filter(Boolean));
    let sstp = [];
    let gre = [];
    let l2tp = [];
    let pptp = [];
    let ikev2 = [];
    let anyconnect = [];
    let activeTab = "";
    const revealed = new Set(); // "tab:index:field" keys of unmasked secrets

    const card = $("#vpn-card");
    const tabsEl = $("#vpn-tabs");
    const listEl = $("#vpn-list");
    const noteEl = $("#vpn-note");

    /* ---- data ---- */

    function applyInfo(data) {
        if (!data || typeof data !== "object") return false;
        let touched = false;
        // The island's `.ovpn` links and /info come from the same panel; when
        // /info omits or empties the downloads list, keep the island-derived
        // list. `openvpn` is the current key; `ov` is the pre-4579d6d alias.
        const ovSource = data.openvpn || data.ov;
        const dl = ovSource && Array.isArray(ovSource.downloads) ? ovSource.downloads : null;
        if (dl && dl.length) {
            ovpn = mergeOvpn(dl.map(normOvpn).filter(Boolean));
            touched = true;
        }
        // WireGuard: prefer structured profiles; fall back to downloads/links arrays.
        const wgSource = data.wireguard;
        if (wgSource && typeof wgSource === "object") {
            if (Array.isArray(wgSource.profiles) && wgSource.profiles.length) {
                wg = mergeProfiles(wgSource.profiles.map(normWg).filter(Boolean));
                touched = true;
            } else if (!wg.length) {
                // Fallback: synthesise minimal entries from downloads/links.
                const wgDl = Array.isArray(wgSource.downloads) ? wgSource.downloads : [];
                const wgLinks = Array.isArray(wgSource.links) ? wgSource.links : [];
                const fallback = [];
                const max = Math.max(wgDl.length, wgLinks.length);
                for (let i = 0; i < max; i++) {
                    const item = normWg({
                        download_url: wgDl[i],
                        link: wgLinks[i],
                        remark: wgDl[i] ? ovpnLabel(wgDl[i]).replace(/\.ovpn$/i, "").replace(/\.conf$/i, "") : (wgLinks[i] ? configLabel(wgLinks[i]) : ""),
                    });
                    if (item) fallback.push(item);
                }
                if (fallback.length) { wg = mergeProfiles(fallback); touched = true; }
            }
        }
        // AmneziaWG: prefer structured profiles; fall back to downloads array.
        const awgSource = data.amneziawg;
        if (awgSource && typeof awgSource === "object") {
            if (Array.isArray(awgSource.profiles) && awgSource.profiles.length) {
                awg = mergeProfiles(awgSource.profiles.map(normAwg).filter(Boolean));
                touched = true;
            } else if (Array.isArray(awgSource.downloads) && awgSource.downloads.length) {
                awg = mergeProfiles(awgSource.downloads.map((url) => normAwg({
                    download_url: url,
                    remark: ovpnLabel(url).replace(/\.conf$/i, ""),
                })).filter(Boolean));
                touched = true;
            }
        }
        if (Array.isArray(data.sstp)) {
            sstp = data.sstp.map((r) => normRemoteAccess(r)).filter(Boolean);
            touched = true;
        }
        if (Array.isArray(data.gre)) {
            gre = data.gre.map((r) => normRemoteAccess(r)).filter(Boolean);
            touched = true;
        }
        if (Array.isArray(data.l2tp)) {
            l2tp = data.l2tp.map((r) => normCreds(r, true, "l2tp")).filter(Boolean);
            touched = true;
        }
        if (Array.isArray(data.pptp)) {
            pptp = data.pptp.map((r) => normCreds(r, false, "pptp")).filter(Boolean);
            touched = true;
        }
        if (Array.isArray(data.ikev2)) {
            ikev2 = data.ikev2.map((r) => normRemoteAccess(r)).filter(Boolean);
            touched = true;
        }
        if (Array.isArray(data.anyconnect)) {
            anyconnect = data.anyconnect.map((r) => normRemoteAccess(r)).filter(Boolean);
            touched = true;
        }
        return touched;
    }

    async function load() {
        if (!ctx.subUrl) return;
        const infoUrl = ctx.subUrl.replace(/\/+$/, "") + "/info";
        try {
            let data = null;
            if (typeof deps.fetchInfo === "function") {
                data = await deps.fetchInfo();
            } else {
                const res = await fetch(infoUrl, {
                    cache: "no-store",
                    credentials: "same-origin",
                    headers: { Accept: "application/json" },
                });
                if (!res.ok) throw new Error("info HTTP " + res.status);
                data = await res.json();
            }
            if (!data) throw new Error("empty info");
            if (applyInfo(data)) {
                storeSet(cacheKey, JSON.stringify({
                    openvpn: { downloads: ovpn.map((o) => o.url) },
                    wireguard: data.wireguard || {},
                    amneziawg: data.amneziawg || {},
                    sstp: data.sstp || [],
                    gre: data.gre || [],
                    l2tp: data.l2tp || [],
                    pptp: data.pptp || [],
                    ikev2: data.ikev2 || [],
                    anyconnect: data.anyconnect || [],
                }));
            }
        } catch (_) {
            // Older panels (or offline) — fall back to the last cached payload;
            // the .ovpn links parsed from the data island are already showing.
            try { applyInfo(JSON.parse(storeGet(cacheKey))); }
            catch (_) { /* nothing cached — keep island-derived state */ }
        }
    }

    /* ---- rendering ---- */

    const TABS = [
        ["ovpn", "OpenVPN", () => ovpn.length],
        ["wg", "WireGuard", () => wg.length],
        ["awg", "AmneziaWG", () => awg.length],
        ["sstp", "SSTP", () => sstp.length],
        ["l2tp", "L2TP/IPsec", () => l2tp.length],
        ["pptp", "PPTP", () => pptp.length],
        ["ikev2", "IKEv2", () => ikev2.length],
        ["anyconnect", "Cisco AnyConnect", () => anyconnect.length],
        ["gre", "GRE", () => gre.length],
    ];

    const availableTabs = () => TABS.filter(([, , count]) => count() > 0);

    function renderTabs(tabs) {
        if (tabs.length <= 1) {
            tabsEl.innerHTML = "";
            setHidden(tabsEl, true);
            return;
        }
        setHidden(tabsEl, false);
        tabsEl.innerHTML = tabs.map(([id, label]) =>
            `<button role="tab" class="filter-pill${id === activeTab ? " active" : ""}" ` +
            `aria-selected="${id === activeTab}" data-vpn-tab="${escapeAttr(id)}">${escapeHtml(label)}</button>`
        ).join("");
        $$("#vpn-tabs [data-vpn-tab]", tabsEl).forEach((btn) => {
            btn.addEventListener("click", () => {
                activeTab = btn.getAttribute("data-vpn-tab");
                revealed.clear();
                render();
            });
        });
    }

    function copyButton(value, label) {
        return `<button class="btn btn-circle btn-ghost btn-xs" data-copy="${escapeAttr(value)}" ` +
            `aria-label="${escapeAttr(label)}"><i class="ph ph-copy text-base"></i></button>`;
    }

    function fieldRow(labelKey, value, opts = {}) {
        if (!value) return "";
        const { icon, secret, key } = opts;
        const hidden = secret && !revealed.has(key);
        const shown = hidden ? "••••••••" : value;
        return `<div class="sub-tile flex items-center gap-2 rounded-lg px-3 py-2">` +
            `<i class="ph ${icon} shrink-0 text-base text-base-content/45"></i>` +
            `<div class="min-w-0 flex-1 text-start">` +
            `<p class="text-[11px] font-medium text-base-content/55">${escapeHtml(t(labelKey))}</p>` +
            `<p class="truncate font-mono text-[12px]" dir="ltr">${escapeHtml(shown)}</p>` +
            `</div>` +
            (secret
                ? `<button class="btn btn-circle btn-ghost btn-xs" data-reveal="${escapeAttr(key)}" ` +
                  `aria-label="${escapeAttr(t(hidden ? "show_secret" : "hide_secret"))}" aria-pressed="${!hidden}">` +
                  `<i class="ph ${hidden ? "ph-eye" : "ph-eye-slash"} text-base"></i></button>`
                : "") +
            copyButton(value, t("copy")) +
            `</div>`;
    }

    function ovpnRow(profile) {
        return `<div class="group card glass row-hover rounded-xl">` +
            `<div class="flex items-center gap-2.5 p-2.5 sm:gap-3 sm:p-3">` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-primary/20 bg-primary/10 text-[10px] font-semibold text-primary">OVPN</div>` +
            `<div class="min-w-0 flex-1 text-start">` +
            `<p class="truncate text-sm font-medium"><span dir="auto">${escapeHtml(profile.name)}</span></p>` +
            `<p class="truncate text-start font-mono text-[11px] text-base-content/45"><span class="inline-block max-w-full truncate align-bottom" dir="ltr">${escapeHtml(profile.url)}</span></p>` +
            `</div>` +
            `<button class="btn btn-circle btn-ghost btn-sm" data-copy="${escapeAttr(profile.url)}" aria-label="${escapeAttr(t("copy"))}">` +
            `<i class="ph ph-copy text-lg"></i></button>` +
            `<a class="btn btn-sm btn-primary h-8 min-h-0 gap-1.5 rounded-lg px-3 text-xs font-medium" href="${escapeAttr(profile.url)}" download>` +
            `<i class="ph ph-download-simple text-base"></i><span class="hidden sm:inline">${escapeHtml(t("ovpn_download"))}</span></a>` +
            `</div></div>`;
    }

    function wgRow(profile, i) {
        const buttons = [];
        if (profile.link) {
            buttons.push(
                `<button class="btn btn-circle btn-ghost btn-sm" data-copy="${escapeAttr(profile.link)}" ` +
                `aria-label="${escapeAttr(t("copy_link"))}"><i class="ph ph-link text-lg"></i></button>`
            );
        }
        if (profile.body) {
            buttons.push(
                `<button class="btn btn-circle btn-ghost btn-sm" data-copy="${escapeAttr(profile.body)}" ` +
                `aria-label="${escapeAttr(t("copy_config"))}"><i class="ph ph-file-text text-lg"></i></button>`
            );
        }
        if (profile.downloadUrl) {
            buttons.push(
                `<a class="btn btn-sm btn-primary h-8 min-h-0 gap-1.5 rounded-lg px-3 text-xs font-medium" ` +
                `href="${escapeAttr(profile.downloadUrl)}" download>` +
                `<i class="ph ph-download-simple text-base"></i>` +
                `<span class="hidden sm:inline">${escapeHtml(t("download_conf"))}</span></a>`
            );
        } else if (profile.body || profile.link) {
            buttons.push(
                `<button class="btn btn-sm btn-primary h-8 min-h-0 gap-1.5 rounded-lg px-3 text-xs font-medium" data-dl-wg="${i}" ` +
                `aria-label="${escapeAttr(t("download_conf"))}"><i class="ph ph-download-simple text-base"></i>` +
                `<span class="hidden sm:inline">${escapeHtml(t("download_conf"))}</span></button>`
            );
        }
        if (profile.link && /^wireguard:\/\//i.test(profile.link)) {
            buttons.push(
                `<a class="btn btn-sm btn-accent h-8 min-h-0 gap-1.5 rounded-lg px-3 text-xs font-medium" ` +
                `href="${escapeAttr(profile.link)}" ` +
                `aria-label="${escapeAttr(t("connect"))}"><i class="ph ph-plug-charging text-base"></i>` +
                `<span class="hidden sm:inline">${escapeHtml(t("connect"))}</span></a>`
            );
        }
        return `<div class="group card glass row-hover rounded-xl">` +
            `<div class="flex items-center gap-2.5 p-2.5 sm:gap-3 sm:p-3">` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-success/20 bg-success/10 text-[10px] font-semibold text-success">WG</div>` +
            `<div class="min-w-0 flex-1 text-start">` +
            `<p class="truncate text-sm font-medium"><span dir="auto">${escapeHtml(profile.name)}</span></p>` +
            (profile.downloadUrl
                ? `<p class="truncate text-start font-mono text-[11px] text-base-content/45"><span class="inline-block max-w-full truncate align-bottom" dir="ltr">${escapeHtml(profile.downloadUrl)}</span></p>`
                : profile.link
                    ? `<p class="truncate text-start font-mono text-[11px] text-base-content/45"><span class="inline-block max-w-full truncate align-bottom" dir="ltr">${escapeHtml(profile.link)}</span></p>`
                    : "") +
            `</div>` +
            buttons.join("") +
            `</div>` +
            `<div class="grid grid-cols-1 gap-2 px-3 pb-3 sm:grid-cols-2">` +
            fieldRow("vpn_server", profile.server, { icon: "ph-hard-drives", key: `wg:server:${profile.server}` }) +
            fieldRow("wg_address", profile.address, { icon: "ph-globe", key: `wg:address:${profile.address}` }) +
            fieldRow("wg_port", profile.port ? String(profile.port) : "", { icon: "ph-plug", key: `wg:port:${profile.port}` }) +
            fieldRow("wg_client_address", profile.clientAddress, { icon: "ph-network", key: `wg:clientAddr:${profile.clientAddress}` }) +
            fieldRow("wg_client_pubkey", profile.clientPublicKey, { icon: "ph-key", key: `wg:clientPub:${profile.clientPublicKey}` }) +
            fieldRow("wg_server_pubkey", profile.serverPublicKey, { icon: "ph-lock-key", key: `wg:serverPub:${profile.serverPublicKey}` }) +
            `</div></div>`;
    }

    function awgRow(profile, i) {
        const buttons = [];
        if (profile.link) {
            buttons.push(
                `<button class="btn btn-circle btn-ghost btn-sm" data-copy="${escapeAttr(profile.link)}" ` +
                `aria-label="${escapeAttr(t("copy_link"))}"><i class="ph ph-link text-lg"></i></button>`
            );
        }
        if (profile.body) {
            buttons.push(
                `<button class="btn btn-circle btn-ghost btn-sm" data-copy="${escapeAttr(profile.body)}" ` +
                `aria-label="${escapeAttr(t("copy_config"))}"><i class="ph ph-file-text text-lg"></i></button>`
            );
        }
        if (profile.downloadUrl) {
            buttons.push(
                `<a class="btn btn-sm btn-primary h-8 min-h-0 gap-1.5 rounded-lg px-3 text-xs font-medium" ` +
                `href="${escapeAttr(profile.downloadUrl)}" download>` +
                `<i class="ph ph-download-simple text-base"></i>` +
                `<span class="hidden sm:inline">${escapeHtml(t("download_conf"))}</span></a>`
            );
        } else if (profile.body || profile.link) {
            buttons.push(
                `<button class="btn btn-sm btn-primary h-8 min-h-0 gap-1.5 rounded-lg px-3 text-xs font-medium" data-dl-awg="${i}" ` +
                `aria-label="${escapeAttr(t("download_conf"))}"><i class="ph ph-download-simple text-base"></i>` +
                `<span class="hidden sm:inline">${escapeHtml(t("download_conf"))}</span></button>`
            );
        }
        return `<div class="group card glass row-hover rounded-xl">` +
            `<div class="flex items-center gap-2.5 p-2.5 sm:gap-3 sm:p-3">` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-accent/20 bg-accent/10 text-[10px] font-semibold text-accent">AWG</div>` +
            `<div class="min-w-0 flex-1 text-start">` +
            `<p class="truncate text-sm font-medium"><span dir="auto">${escapeHtml(profile.name)}</span></p>` +
            (profile.downloadUrl
                ? `<p class="truncate text-start font-mono text-[11px] text-base-content/45"><span class="inline-block max-w-full truncate align-bottom" dir="ltr">${escapeHtml(profile.downloadUrl)}</span></p>`
                : profile.link
                    ? `<p class="truncate text-start font-mono text-[11px] text-base-content/45"><span class="inline-block max-w-full truncate align-bottom" dir="ltr">${escapeHtml(profile.link)}</span></p>`
                    : "") +
            `</div>` +
            buttons.join("") +
            `</div>` +
            `<div class="grid grid-cols-1 gap-2 px-3 pb-3 sm:grid-cols-2">` +
            fieldRow("vpn_server", profile.server, { icon: "ph-hard-drives", key: `awg:server:${profile.server}` }) +
            fieldRow("wg_address", profile.address, { icon: "ph-globe", key: `awg:address:${profile.address}` }) +
            fieldRow("wg_port", profile.port ? String(profile.port) : "", { icon: "ph-plug", key: `awg:port:${profile.port}` }) +
            fieldRow("wg_client_address", profile.clientAddress, { icon: "ph-network", key: `awg:clientAddr:${profile.clientAddress}` }) +
            fieldRow("wg_client_pubkey", profile.clientPublicKey, { icon: "ph-key", key: `awg:clientPub:${profile.clientPublicKey}` }) +
            fieldRow("wg_server_pubkey", profile.serverPublicKey, { icon: "ph-lock-key", key: `awg:serverPub:${profile.serverPublicKey}` }) +
            `</div></div>`;
    }

    function credsRow(item, tab, index) {
        const badge = tab === "l2tp" ? "L2TP" : "PPTP";
        const keyOf = (field) => `${tab}:${index}:${field}`;
        return `<div class="card glass rounded-xl">` +
            `<div class="space-y-2 p-2.5 sm:p-3">` +
            `<div class="flex items-center gap-2.5 sm:gap-3">` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-secondary/20 bg-secondary/10 text-[10px] font-semibold text-secondary">${badge}</div>` +
            `<p class="min-w-0 flex-1 truncate text-start text-sm font-medium"><span dir="auto">${escapeHtml(item.remark || badge)}</span></p>` +
            (item.server
                ? `<button class="btn btn-sm btn-primary h-8 min-h-0 gap-1.5 rounded-lg px-3 text-xs font-medium" data-dl-pbk="${escapeAttr(tab)}:${index}" ` +
                  `aria-label="${escapeAttr(t("download_pbk"))}"><i class="ph ph-windows-logo text-base"></i>` +
                  `<span class="hidden sm:inline">${escapeHtml(t("download_pbk"))}</span></button>`
                : "") +
            `</div>` +
            `<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">` +
            fieldRow("vpn_server", item.server, { icon: "ph-hard-drives", key: keyOf("server") }) +
            fieldRow("vpn_username", item.username, { icon: "ph-user", key: keyOf("username") }) +
            fieldRow("vpn_password", item.password, { icon: "ph-key", secret: true, key: keyOf("password") }) +
            (tab === "l2tp"
                ? fieldRow("vpn_psk", item.psk, { icon: "ph-lock-key", secret: true, key: keyOf("psk") })
                : "") +
            `</div></div></div>`;
    }

    function remoteAccessRow(item, tab, index) {
        const badge = tab === "ikev2" ? "IKEv2" : tab === "anyconnect" ? "Cisco" : tab === "sstp" ? "SSTP" : "GRE";
        const keyOf = (field) => `${tab}:${index}:${field}`;
        const isCert = item.authMode === "certificate";

        if (tab === "gre") {
            const cli = generateGreCli(item);
            return `<div class="card glass rounded-xl">` +
                `<div class="space-y-2 p-2.5 sm:p-3">` +
                `<div class="flex flex-wrap items-center gap-2">` +
                `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-info/20 bg-info/10 text-[10px] font-semibold text-info">${badge}</div>` +
                `<p class="min-w-0 flex-1 truncate text-start text-sm font-medium"><span dir="auto">${escapeHtml(item.remark || badge)}</span></p>` +
                (cli
                    ? `<button class="btn btn-xs btn-ghost glass gap-1 rounded-lg font-medium" data-copy="${escapeAttr(cli.linux)}" ` +
                      `aria-label="${escapeAttr(t("copy_linux_cmd"))}"><i class="ph ph-terminal-window text-sm"></i>` +
                      `<span>${escapeHtml(t("copy_linux_cmd"))}</span></button>` +
                      `<button class="btn btn-xs btn-ghost glass gap-1 rounded-lg font-medium" data-copy="${escapeAttr(cli.mikrotik)}" ` +
                      `aria-label="${escapeAttr(t("copy_mikrotik_cmd"))}"><i class="ph ph-terminal text-sm"></i>` +
                      `<span>${escapeHtml(t("copy_mikrotik_cmd"))}</span></button>`
                    : "") +
                `</div>` +
                `<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">` +
                fieldRow("vpn_server", item.server, { icon: "ph-hard-drives", key: keyOf("server") }) +
                (item.address && item.address !== item.server
                    ? fieldRow("vpn_address", item.address, { icon: "ph-globe", key: keyOf("address") })
                    : "") +
                fieldRow("gre_client_address", item.clientAddress, { icon: "ph-network", key: keyOf("clientAddr") }) +
                fieldRow("gre_server_address", item.serverAddress, { icon: "ph-network", key: keyOf("serverAddr") }) +
                (item.port ? fieldRow("vpn_port", String(item.port), { icon: "ph-plug", key: keyOf("port") }) : "") +
                (item.mtu ? fieldRow("vpn_mtu", item.mtu, { icon: "ph-arrows-left-right", key: keyOf("mtu") }) : "") +
                (item.ttl ? fieldRow("vpn_ttl", item.ttl, { icon: "ph-timer", key: keyOf("ttl") }) : "") +
                (item.dns ? fieldRow("vpn_dns", item.dns, { icon: "ph-cloud", key: keyOf("dns") }) : "") +
                `</div></div></div>`;
        }

        return `<div class="card glass rounded-xl">` +
            `<div class="space-y-2 p-2.5 sm:p-3">` +
            `<div class="flex items-center gap-2.5 sm:gap-3">` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-secondary/20 bg-secondary/10 text-[10px] font-semibold text-secondary">${badge}</div>` +
            `<p class="min-w-0 flex-1 truncate text-start text-sm font-medium"><span dir="auto">${escapeHtml(item.remark || badge)}</span></p>` +
            (item.server && (tab === "ikev2" || tab === "sstp")
                ? `<button class="btn btn-sm btn-primary h-8 min-h-0 gap-1.5 rounded-lg px-3 text-xs font-medium" data-dl-pbk="${escapeAttr(tab)}:${index}" ` +
                  `aria-label="${escapeAttr(t("download_pbk"))}"><i class="ph ph-windows-logo text-base"></i>` +
                  `<span class="hidden sm:inline">${escapeHtml(t("download_pbk"))}</span></button>`
                : "") +
            `</div>` +
            `<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">` +
            fieldRow("vpn_server", item.server, { icon: "ph-hard-drives", key: keyOf("server") }) +
            (item.address && item.address !== item.server
                ? fieldRow("vpn_address", item.address, { icon: "ph-globe", key: keyOf("address") })
                : "") +
            fieldRow("vpn_port", item.port ? String(item.port) : "", { icon: "ph-plug", key: keyOf("port") }) +
            (item.mtu ? fieldRow("vpn_mtu", item.mtu, { icon: "ph-arrows-left-right", key: keyOf("mtu") }) : "") +
            fieldRow("vpn_dns", item.dns, { icon: "ph-cloud", key: keyOf("dns") }) +
            (isCert
                ? `<div class="col-span-full rounded-xl bg-warning/10 px-3 py-2 text-[11px] text-warning">` +
                  `<span dir="auto">${escapeHtml(t("vpn_certificate_auth"))}</span>` +
                  `</div>`
                : fieldRow("vpn_username", item.username, { icon: "ph-user", key: keyOf("username") }) +
                  fieldRow("vpn_password", item.password, { icon: "ph-key", secret: true, key: keyOf("password") })) +
            `</div></div></div>`;
    }

    function render() {
        const tabs = availableTabs();
        if (!tabs.length) {
            setHidden(card, true);
            return;
        }
        setHidden(card, false);
        if (!tabs.some(([id]) => id === activeTab)) activeTab = tabs[0][0];
        renderTabs(tabs);

        const rows =
            activeTab === "ovpn" ? ovpn.map(ovpnRow)
            : activeTab === "wg" ? wg.map((w, i) => wgRow(w, i))
            : activeTab === "awg" ? awg.map((w, i) => awgRow(w, i))
            : activeTab === "sstp" ? sstp.map((r, i) => remoteAccessRow(r, "sstp", i))
            : activeTab === "l2tp" ? l2tp.map((r, i) => credsRow(r, "l2tp", i))
            : activeTab === "pptp" ? pptp.map((r, i) => credsRow(r, "pptp", i))
            : activeTab === "ikev2" ? ikev2.map((r, i) => remoteAccessRow(r, "ikev2", i))
            : activeTab === "anyconnect" ? anyconnect.map((r, i) => remoteAccessRow(r, "anyconnect", i))
            : gre.map((r, i) => remoteAccessRow(r, "gre", i));

        const tabPbkItems =
            activeTab === "l2tp" ? l2tp
            : activeTab === "pptp" ? pptp
            : activeTab === "ikev2" ? ikev2
            : activeTab === "sstp" ? sstp
            : [];
        const allPbkHeader = tabPbkItems.length > 1
            ? `<div class="flex items-center justify-end pb-1">` +
              `<button class="btn btn-xs btn-ghost glass gap-1 rounded-xl font-semibold text-primary" data-dl-all-pbk="${escapeAttr(activeTab)}">` +
              `<i class="ph ph-windows-logo text-sm"></i>` +
              `<span>${escapeHtml(t("download_all_pbk"))}</span>` +
              `</button></div>`
            : "";

        listEl.innerHTML = allPbkHeader + rows.join("");
        noteEl.textContent = t(activeTab + "_note");

        $$("[data-copy]", listEl).forEach((btn) => {
            btn.addEventListener("click", async () => {
                const icon = btn.querySelector("i");
                const prev = icon.className;
                if (await copyText(btn.getAttribute("data-copy"))) {
                    toast(t("copied"));
                    icon.className = "ph ph-check text-lg text-success";
                    setTimeout(() => { icon.className = prev; }, 1600);
                }
            });
        });
        $$("[data-dl-wg]", listEl).forEach((btn) => {
            btn.addEventListener("click", () => {
                const idx = parseInt(btn.getAttribute("data-dl-wg"), 10);
                const profile = wg[idx];
                if (!profile) return;
                const conf = profile.body || generateWgConf(profile.link);
                if (conf) {
                    downloadTextFile(conf, safeFileName(profile.name, "wireguard", ".conf"));
                    toast(t("export_done"));
                } else {
                    toast(t("qr_error"));
                }
            });
        });
        $$("[data-dl-awg]", listEl).forEach((btn) => {
            btn.addEventListener("click", () => {
                const idx = parseInt(btn.getAttribute("data-dl-awg"), 10);
                const profile = awg[idx];
                if (!profile) return;
                const conf = profile.body || generateWgConf(profile.link);
                if (conf) {
                    downloadTextFile(conf, safeFileName(profile.name, "amneziawg", ".conf"));
                    toast(t("export_done"));
                } else {
                    toast(t("qr_error"));
                }
            });
        });
        $$("[data-dl-pbk]", listEl).forEach((btn) => {
            btn.addEventListener("click", () => {
                const target = btn.getAttribute("data-dl-pbk") || "";
                const [tab, idxStr] = target.split(":");
                const idx = parseInt(idxStr, 10);
                const list =
                    tab === "l2tp" ? l2tp
                    : tab === "pptp" ? pptp
                    : tab === "ikev2" ? ikev2
                    : tab === "sstp" ? sstp
                    : [];
                const item = list[idx];
                if (!item || !item.server) return;
                const pbk = generatePbkEntry({
                    remark: item.remark || item.server || tab.toUpperCase(),
                    server: item.server,
                    protocol: item.protocol || tab,
                    username: item.username,
                });
                if (pbk) {
                    const fname = safeFileName(
                        `${item.remark || item.server || tab}`,
                        "vpn",
                        ".pbk"
                    );
                    downloadTextFile(pbk, fname, "application/x-ms-phonebook;charset=utf-8");
                    toast(t("export_done"));
                }
            });
        });
        const allPbkBtn = listEl.querySelector("[data-dl-all-pbk]");
        if (allPbkBtn) {
            allPbkBtn.addEventListener("click", () => {
                const tab = allPbkBtn.getAttribute("data-dl-all-pbk");
                const list =
                    tab === "l2tp" ? l2tp
                    : tab === "pptp" ? pptp
                    : tab === "ikev2" ? ikev2
                    : tab === "sstp" ? sstp
                    : [];
                if (!list.length) return;
                const items = list.map((item) => ({
                    remark: item.remark || item.server || tab.toUpperCase(),
                    server: item.server,
                    protocol: item.protocol || tab,
                    username: item.username,
                }));
                const pbk = generatePbkFile(items);
                if (pbk) {
                    const fname = safeFileName(
                        `${ctx.brandName || "aurora"}_${tab}_all`,
                        "windows_vpn",
                        ".pbk"
                    );
                    downloadTextFile(pbk, fname, "application/x-ms-phonebook;charset=utf-8");
                    toast(t("export_done"));
                }
            });
        }
        $$("[data-reveal]", listEl).forEach((btn) => {
            btn.addEventListener("click", () => {
                const key = btn.getAttribute("data-reveal");
                if (revealed.has(key)) revealed.delete(key);
                else revealed.add(key);
                render();
            });
        });
    }

    return {
        async start() {
            render(); // island-derived .ovpn links paint immediately
            await load();
            render();
        },
        rerender: render,
    };
}
