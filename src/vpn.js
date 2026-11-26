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
import { $, $$, setHidden, copyText, toast, flashCopyIcon, scrollTabIntoView } from "./ui.js";
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

/** Human label for a profile download URL — the decoded file name sans `.ovpn` / `.conf` suffix. */
export function profileLabel(url, fallback = "OpenVPN") {
    try {
        const path = new URL(url, "http://x").pathname;
        const file = (path.split("/").pop() || "").replace(/\.(?:ovpn|conf)$/i, "");
        const name = decodeURIComponent(file).trim();
        if (name) return name;
    } catch (_) { /* fall through */ }
    return fallback;
}

/** Human label for an .ovpn download URL — the decoded file name sans suffix. */
export function ovpnLabel(url) {
    return profileLabel(url, "OpenVPN");
}

const clean = (v) => (typeof v === "string" ? v.trim() : "");
const isSafeDownloadUrl = (u) => /^(?:https?:\/\/|\/)/i.test(clean(u));

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

function normProfileKey(s) {
    return String(s || "")
        .normalize("NFKC")
        .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
        .replace(/[^a-zA-Z0-9\u0080-\uffff]+/g, "")
        .toLowerCase();
}

export function mergeProfiles(list) {
    const out = [];
    for (const item of list) {
        if (!item) continue;
        const key = (item.name || "").trim().toLowerCase() || item.link || item.downloadUrl;
        const slug = normProfileKey(item.name);
        const cur = out.find((c) => {
            const cKey = (c.name || "").trim().toLowerCase() || c.link || c.downloadUrl;
            const cSlug = normProfileKey(c.name);
            const nameMatch = cKey === key || (slug && slug === cSlug);
            if (!nameMatch) return false;
            if (c.link && item.link && c.link !== item.link) return false;
            if (c.downloadUrl && item.downloadUrl && c.downloadUrl !== item.downloadUrl) return false;
            if (c.server && item.server && c.server !== item.server) return false;
            return true;
        });
        if (!cur) {
            out.push({ ...item });
        } else {
            // Prefer the richer display name (e.g. one with spaces/flags over a hyphenated filename).
            if (item.name && item.name.includes(" ") && (!cur.name || !cur.name.includes(" "))) {
                cur.name = item.name;
            }
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
    return out;
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
            remark: profileLabel(link, "WireGuard"),
        });
    }).filter(Boolean));
    let awg = mergeProfiles((deps.awgLinks || []).map((link) => {
        if (/^(?:amneziawg|awg):\/\//i.test(link)) return normAwg({ link, remark: configLabel(link) });
        return normAwg({
            download_url: link,
            remark: profileLabel(link, "AmneziaWG"),
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
            } else {
                // Fallback: synthesise minimal entries from downloads/links and merge with island entries.
                const wgDl = Array.isArray(wgSource.downloads) ? wgSource.downloads : [];
                const wgLinks = Array.isArray(wgSource.links) ? wgSource.links : [];
                const fallback = [];
                const max = Math.max(wgDl.length, wgLinks.length);
                for (let i = 0; i < max; i++) {
                    const item = normWg({
                        download_url: wgDl[i],
                        link: wgLinks[i],
                        remark: wgLinks[i] ? configLabel(wgLinks[i]) : (wgDl[i] ? profileLabel(wgDl[i], "WireGuard") : ""),
                    });
                    if (item) fallback.push(item);
                }
                if (fallback.length) { wg = mergeProfiles([...wg, ...fallback]); touched = true; }
            }
        }
        // AmneziaWG: prefer structured profiles; fall back to downloads/links arrays.
        const awgSource = data.amneziawg;
        if (awgSource && typeof awgSource === "object") {
            if (Array.isArray(awgSource.profiles) && awgSource.profiles.length) {
                awg = mergeProfiles(awgSource.profiles.map(normAwg).filter(Boolean));
                touched = true;
            } else {
                const awgDl = Array.isArray(awgSource.downloads) ? awgSource.downloads : [];
                const awgLinks = Array.isArray(awgSource.links) ? awgSource.links : [];
                const fallback = [];
                const max = Math.max(awgDl.length, awgLinks.length);
                for (let i = 0; i < max; i++) {
                    const item = normAwg({
                        download_url: awgDl[i],
                        link: awgLinks[i],
                        remark: awgLinks[i] ? configLabel(awgLinks[i]) : (awgDl[i] ? profileLabel(awgDl[i], "AmneziaWG") : ""),
                    });
                    if (item) fallback.push(item);
                }
                if (fallback.length) { awg = mergeProfiles([...awg, ...fallback]); touched = true; }
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
        let networkError = false;
        try {
            let data = null;
            if (typeof deps.fetchInfo === "function") {
                const res = await deps.fetchInfo();
                if (res && typeof res === "object" && "networkError" in res) {
                    data = res.data;
                    networkError = Boolean(res.networkError);
                } else {
                    data = res;
                }
            } else {
                const res = await fetch(infoUrl, {
                    cache: "no-store",
                    credentials: "same-origin",
                    headers: { Accept: "application/json" },
                });
                if (!res.ok) return; // Clean HTTP 404/non-2xx: do not resurrect stale cache
                data = await res.json();
            }
            if (!data) {
                if (networkError) throw new Error("network error");
                return;
            }
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
                }), { noCookie: true });
            }
        } catch (_) {
            // Only fall back to cached VPN data on genuine network failure / offline.
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

    function renderTabs(tabs, smooth = false) {
        if (tabs.length <= 1) {
            tabsEl.innerHTML = "";
            setHidden(tabsEl, true);
            return;
        }
        setHidden(tabsEl, false);
        tabsEl.innerHTML = tabs.map(([id, label]) =>
            `<button type="button" role="tab" class="filter-pill${id === activeTab ? " active" : ""}" ` +
            `aria-selected="${id === activeTab}" data-vpn-tab="${escapeAttr(id)}">${escapeHtml(label)}</button>`
        ).join("");
        $$("#vpn-tabs [data-vpn-tab]", tabsEl).forEach((btn) => {
            btn.addEventListener("click", () => {
                activeTab = btn.getAttribute("data-vpn-tab");
                revealed.clear();
                render(true);
            });
        });
        const activeBtn = tabsEl.querySelector(".filter-pill.active");
        if (activeBtn) scrollTabIntoView(tabsEl, activeBtn, smooth);
    }

    function copyButton(value, label) {
        return `<button type="button" class="btn btn-circle btn-ghost btn-xs shrink-0" data-copy="${escapeAttr(value)}" ` +
            `aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}"><i class="ph ph-copy text-base"></i></button>`;
    }

    function fieldRow(labelKey, value, opts = {}) {
        if (!value) return "";
        const { icon, secret, key } = opts;
        const hidden = secret && !revealed.has(key);
        const shown = hidden ? "••••••••" : value;
        return `<div class="flex items-center gap-2 rounded-lg border border-base-content/[0.08] bg-base-content/[0.03] px-3 py-2">` +
            `<i class="ph ${icon} shrink-0 text-base text-base-content/50"></i>` +
            `<div class="min-w-0 flex-1 text-start">` +
            `<p class="text-[11px] font-medium text-base-content/55">${escapeHtml(t(labelKey))}</p>` +
            `<p class="truncate text-start font-mono text-[12px]">` +
            `<span class="inline-block max-w-full truncate align-bottom" dir="ltr"${secret ? ` data-secret-val="${escapeAttr(key)}" data-secret-raw="${escapeAttr(value)}"` : ""}>${escapeHtml(shown)}</span>` +
            `</p>` +
            `</div>` +
            (secret
                ? `<button type="button" class="btn btn-circle btn-ghost btn-xs shrink-0" data-reveal="${escapeAttr(key)}" ` +
                  `aria-label="${escapeAttr(t(hidden ? "show_secret" : "hide_secret"))}" title="${escapeAttr(t(hidden ? "show_secret" : "hide_secret"))}" aria-pressed="${!hidden}">` +
                  `<i class="ph ${hidden ? "ph-eye" : "ph-eye-slash"} text-base"></i></button>`
                : "") +
            copyButton(value, t("copy")) +
            `</div>`;
    }

    function ovpnRow(profile) {
        const safeUrl = isSafeDownloadUrl(profile.url);
        return `<div class="group sub-tile row-hover rounded-xl">` +
            `<div class="flex items-center gap-2.5 p-2.5 sm:gap-3 sm:p-3">` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-primary/20 bg-primary/10 text-[10px] font-semibold text-primary">OVPN</div>` +
            `<div class="min-w-0 flex-1 text-start">` +
            `<p class="truncate text-sm font-medium"><span dir="auto">${escapeHtml(profile.name)}</span></p>` +
            `<p class="truncate text-start font-mono text-[11px] text-base-content/50"><span class="inline-block max-w-full truncate align-bottom" dir="ltr">${escapeHtml(profile.url)}</span></p>` +
            `</div>` +
            `<button type="button" class="btn btn-circle btn-ghost btn-sm shrink-0" data-copy="${escapeAttr(profile.url)}" aria-label="${escapeAttr(t("copy"))}" title="${escapeAttr(t("copy"))}">` +
            `<i class="ph ph-copy text-lg"></i></button>` +
            (safeUrl
                ? `<a class="btn btn-sm btn-primary h-8 min-h-0 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs font-medium sm:px-3" href="${escapeAttr(profile.url)}" download ` +
                  `aria-label="${escapeAttr(t("ovpn_download"))}" title="${escapeAttr(t("ovpn_download"))}">` +
                  `<i class="ph ph-download-simple text-base"></i><span class="hidden sm:inline">${escapeHtml(t("ovpn_download"))}</span></a>`
                : "") +
            `</div></div>`;
    }

    function wgRow(profile, i) {
        const iconBtns = [];
        const primaryBtns = [];
        if (profile.link) {
            iconBtns.push(
                `<button type="button" class="btn btn-ghost btn-sm glass h-8 w-8 min-h-0 shrink-0 rounded-lg p-0" data-copy="${escapeAttr(profile.link)}" ` +
                `aria-label="${escapeAttr(t("copy_link"))}" title="${escapeAttr(t("copy_link"))}"><i class="ph ph-link text-base"></i></button>`
            );
        }
        if (profile.body) {
            iconBtns.push(
                `<button type="button" class="btn btn-ghost btn-sm glass h-8 w-8 min-h-0 shrink-0 rounded-lg p-0" data-copy="${escapeAttr(profile.body)}" ` +
                `aria-label="${escapeAttr(t("copy_config"))}" title="${escapeAttr(t("copy_config"))}"><i class="ph ph-file-text text-base"></i></button>`
            );
        }
        if (profile.downloadUrl && isSafeDownloadUrl(profile.downloadUrl)) {
            primaryBtns.push(
                `<a class="btn btn-sm btn-primary h-8 min-h-0 flex-1 gap-1.5 rounded-lg px-3 text-xs font-medium sm:flex-initial" ` +
                `href="${escapeAttr(profile.downloadUrl)}" download aria-label="${escapeAttr(t("download_conf"))}" title="${escapeAttr(t("download_conf"))}">` +
                `<i class="ph ph-download-simple text-base"></i>` +
                `<span class="truncate">${escapeHtml(t("download_conf"))}</span></a>`
            );
        } else if (profile.body || profile.link) {
            primaryBtns.push(
                `<button type="button" class="btn btn-sm btn-primary h-8 min-h-0 flex-1 gap-1.5 rounded-lg px-3 text-xs font-medium sm:flex-initial" data-dl-wg="${i}" ` +
                `aria-label="${escapeAttr(t("download_conf"))}" title="${escapeAttr(t("download_conf"))}"><i class="ph ph-download-simple text-base"></i>` +
                `<span class="truncate">${escapeHtml(t("download_conf"))}</span></button>`
            );
        }
        if (profile.link && /^wireguard:\/\//i.test(profile.link)) {
            primaryBtns.push(
                `<a class="btn btn-sm btn-accent h-8 min-h-0 flex-1 gap-1.5 rounded-lg px-3 text-xs font-medium sm:flex-initial" ` +
                `href="${escapeAttr(profile.link)}" ` +
                `aria-label="${escapeAttr(t("connect"))}" title="${escapeAttr(t("connect"))}"><i class="ph ph-plug-charging text-base"></i>` +
                `<span class="truncate">${escapeHtml(t("connect"))}</span></a>`
            );
        }
        const actionsBar = (iconBtns.length || primaryBtns.length)
            ? `<div class="flex shrink-0 items-center gap-1.5">${primaryBtns.join("")}${iconBtns.join("")}</div>`
            : "";
        return `<div class="group sub-tile rounded-xl">` +
            `<div class="flex flex-col gap-2.5 p-2.5 sm:flex-row sm:items-center sm:gap-3 sm:p-3">` +
            `<div class="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-success/20 bg-success/10 text-[10px] font-semibold text-success">WG</div>` +
            `<div class="min-w-0 flex-1 text-start">` +
            `<p class="truncate text-sm font-medium"><span dir="auto">${escapeHtml(profile.name)}</span></p>` +
            (profile.downloadUrl
                ? `<p class="truncate text-start font-mono text-[11px] text-base-content/50"><span class="inline-block max-w-full truncate align-bottom" dir="ltr">${escapeHtml(profile.downloadUrl)}</span></p>`
                : profile.link
                    ? `<p class="truncate text-start font-mono text-[11px] text-base-content/50"><span class="inline-block max-w-full truncate align-bottom" dir="ltr">${escapeHtml(profile.link)}</span></p>`
                    : "") +
            `</div></div>` +
            actionsBar +
            `</div>` +
            `<div class="grid grid-cols-1 gap-2 px-2.5 pb-2.5 sm:grid-cols-2 sm:px-3 sm:pb-3">` +
            fieldRow("vpn_server", profile.server, { icon: "ph-hard-drives", key: `wg:${i}:server` }) +
            (profile.address && profile.address !== profile.server
                ? fieldRow("wg_address", profile.address, { icon: "ph-globe", key: `wg:${i}:address` })
                : "") +
            fieldRow("wg_port", profile.port ? String(profile.port) : "", { icon: "ph-plug", key: `wg:${i}:port` }) +
            fieldRow("wg_client_address", profile.clientAddress, { icon: "ph-network", key: `wg:${i}:clientAddr` }) +
            fieldRow("wg_client_pubkey", profile.clientPublicKey, { icon: "ph-key", key: `wg:${i}:clientPub` }) +
            fieldRow("wg_server_pubkey", profile.serverPublicKey, { icon: "ph-lock-key", key: `wg:${i}:serverPub` }) +
            `</div></div>`;
    }

    function awgRow(profile, i) {
        const iconBtns = [];
        const primaryBtns = [];
        if (profile.link) {
            iconBtns.push(
                `<button type="button" class="btn btn-ghost btn-sm glass h-8 w-8 min-h-0 shrink-0 rounded-lg p-0" data-copy="${escapeAttr(profile.link)}" ` +
                `aria-label="${escapeAttr(t("copy_link"))}" title="${escapeAttr(t("copy_link"))}"><i class="ph ph-link text-base"></i></button>`
            );
        }
        if (profile.body) {
            iconBtns.push(
                `<button type="button" class="btn btn-ghost btn-sm glass h-8 w-8 min-h-0 shrink-0 rounded-lg p-0" data-copy="${escapeAttr(profile.body)}" ` +
                `aria-label="${escapeAttr(t("copy_config"))}" title="${escapeAttr(t("copy_config"))}"><i class="ph ph-file-text text-base"></i></button>`
            );
        }
        if (profile.downloadUrl && isSafeDownloadUrl(profile.downloadUrl)) {
            primaryBtns.push(
                `<a class="btn btn-sm btn-primary h-8 min-h-0 flex-1 gap-1.5 rounded-lg px-3 text-xs font-medium sm:flex-initial" ` +
                `href="${escapeAttr(profile.downloadUrl)}" download aria-label="${escapeAttr(t("download_conf"))}" title="${escapeAttr(t("download_conf"))}">` +
                `<i class="ph ph-download-simple text-base"></i>` +
                `<span class="truncate">${escapeHtml(t("download_conf"))}</span></a>`
            );
        } else if (profile.body || profile.link) {
            primaryBtns.push(
                `<button type="button" class="btn btn-sm btn-primary h-8 min-h-0 flex-1 gap-1.5 rounded-lg px-3 text-xs font-medium sm:flex-initial" data-dl-awg="${i}" ` +
                `aria-label="${escapeAttr(t("download_conf"))}" title="${escapeAttr(t("download_conf"))}"><i class="ph ph-download-simple text-base"></i>` +
                `<span class="truncate">${escapeHtml(t("download_conf"))}</span></button>`
            );
        }
        const actionsBar = (iconBtns.length || primaryBtns.length)
            ? `<div class="flex shrink-0 items-center gap-1.5">${primaryBtns.join("")}${iconBtns.join("")}</div>`
            : "";
        return `<div class="group sub-tile rounded-xl">` +
            `<div class="flex flex-col gap-2.5 p-2.5 sm:flex-row sm:items-center sm:gap-3 sm:p-3">` +
            `<div class="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-accent/20 bg-accent/10 text-[10px] font-semibold text-accent">AWG</div>` +
            `<div class="min-w-0 flex-1 text-start">` +
            `<p class="truncate text-sm font-medium"><span dir="auto">${escapeHtml(profile.name)}</span></p>` +
            (profile.downloadUrl
                ? `<p class="truncate text-start font-mono text-[11px] text-base-content/50"><span class="inline-block max-w-full truncate align-bottom" dir="ltr">${escapeHtml(profile.downloadUrl)}</span></p>`
                : profile.link
                    ? `<p class="truncate text-start font-mono text-[11px] text-base-content/50"><span class="inline-block max-w-full truncate align-bottom" dir="ltr">${escapeHtml(profile.link)}</span></p>`
                    : "") +
            `</div></div>` +
            actionsBar +
            `</div>` +
            `<div class="grid grid-cols-1 gap-2 px-2.5 pb-2.5 sm:grid-cols-2 sm:px-3 sm:pb-3">` +
            fieldRow("vpn_server", profile.server, { icon: "ph-hard-drives", key: `awg:${i}:server` }) +
            (profile.address && profile.address !== profile.server
                ? fieldRow("wg_address", profile.address, { icon: "ph-globe", key: `awg:${i}:address` })
                : "") +
            fieldRow("wg_port", profile.port ? String(profile.port) : "", { icon: "ph-plug", key: `awg:${i}:port` }) +
            fieldRow("wg_client_address", profile.clientAddress, { icon: "ph-network", key: `awg:${i}:clientAddr` }) +
            fieldRow("wg_client_pubkey", profile.clientPublicKey, { icon: "ph-key", key: `awg:${i}:clientPub` }) +
            fieldRow("wg_server_pubkey", profile.serverPublicKey, { icon: "ph-lock-key", key: `awg:${i}:serverPub` }) +
            `</div></div>`;
    }

    function credsRow(item, tab, index) {
        const badge = tab === "l2tp" ? "L2TP" : "PPTP";
        const keyOf = (field) => `${tab}:${index}:${field}`;
        return `<div class="sub-tile rounded-xl">` +
            `<div class="space-y-2.5 p-2.5 sm:p-3">` +
            `<div class="flex items-center gap-2.5 sm:gap-3">` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-secondary/20 bg-secondary/10 text-[10px] font-semibold text-secondary">${badge}</div>` +
            `<p class="min-w-0 flex-1 truncate text-start text-sm font-medium"><span dir="auto">${escapeHtml(item.remark || badge)}</span></p>` +
            (item.server
                ? `<button type="button" class="btn btn-sm btn-primary h-8 min-h-0 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs font-medium sm:px-3" data-dl-pbk="${escapeAttr(tab)}:${index}" ` +
                  `aria-label="${escapeAttr(t("download_pbk"))}" title="${escapeAttr(t("download_pbk"))}"><i class="ph ph-windows-logo text-base"></i>` +
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
            return `<div class="sub-tile rounded-xl">` +
                `<div class="space-y-2.5 p-2.5 sm:p-3">` +
                `<div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">` +
                `<div class="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">` +
                `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-info/20 bg-info/10 text-[10px] font-semibold text-info">${badge}</div>` +
                `<p class="min-w-0 flex-1 truncate text-start text-sm font-medium"><span dir="auto">${escapeHtml(item.remark || badge)}</span></p>` +
                `</div>` +
                (cli
                    ? `<div class="flex shrink-0 items-center gap-1.5">` +
                      `<button type="button" class="btn btn-xs btn-ghost glass h-8 min-h-0 flex-1 gap-1.5 rounded-lg px-2.5 font-medium sm:flex-initial" data-copy="${escapeAttr(cli.linux)}" ` +
                      `aria-label="${escapeAttr(t("copy_linux_cmd"))}" title="${escapeAttr(t("copy_linux_cmd"))}"><i class="ph ph-terminal-window text-sm"></i>` +
                      `<span class="truncate">${escapeHtml(t("copy_linux_cmd"))}</span></button>` +
                      `<button type="button" class="btn btn-xs btn-ghost glass h-8 min-h-0 flex-1 gap-1.5 rounded-lg px-2.5 font-medium sm:flex-initial" data-copy="${escapeAttr(cli.mikrotik)}" ` +
                      `aria-label="${escapeAttr(t("copy_mikrotik_cmd"))}" title="${escapeAttr(t("copy_mikrotik_cmd"))}"><i class="ph ph-terminal text-sm"></i>` +
                      `<span class="truncate">${escapeHtml(t("copy_mikrotik_cmd"))}</span></button>` +
                      `</div>`
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

        return `<div class="sub-tile rounded-xl">` +
            `<div class="space-y-2.5 p-2.5 sm:p-3">` +
            `<div class="flex items-center gap-2.5 sm:gap-3">` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-secondary/20 bg-secondary/10 text-[10px] font-semibold text-secondary">${badge}</div>` +
            `<p class="min-w-0 flex-1 truncate text-start text-sm font-medium"><span dir="auto">${escapeHtml(item.remark || badge)}</span></p>` +
            (item.server && (tab === "ikev2" || tab === "sstp")
                ? `<button type="button" class="btn btn-sm btn-primary h-8 min-h-0 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs font-medium sm:px-3" data-dl-pbk="${escapeAttr(tab)}:${index}" ` +
                  `aria-label="${escapeAttr(t("download_pbk"))}" title="${escapeAttr(t("download_pbk"))}"><i class="ph ph-windows-logo text-base"></i>` +
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
                ? `<div class="col-span-full rounded-xl bg-warning/10 px-3 py-2 text-start text-[11px] text-warning">` +
                  `<span dir="auto">${escapeHtml(t("vpn_certificate_auth"))}</span>` +
                  `</div>`
                : fieldRow("vpn_username", item.username, { icon: "ph-user", key: keyOf("username") }) +
                  fieldRow("vpn_password", item.password, { icon: "ph-key", secret: true, key: keyOf("password") })) +
            `</div></div></div>`;
    }

    function render(smoothTab = false) {
        const tabs = availableTabs();
        if (!tabs.length) {
            setHidden(card, true);
            return;
        }
        setHidden(card, false);
        if (!tabs.some(([id]) => id === activeTab)) activeTab = tabs[0][0];
        renderTabs(tabs, smoothTab);

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
        const allPbkHeader = tabPbkItems.filter((item) => item && item.server).length > 1
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
                if (await copyText(btn.getAttribute("data-copy"))) {
                    toast(t("copied"));
                    flashCopyIcon(btn);
                } else {
                    toast(t("copy_failed"), "warn");
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
                    toast(t("qr_error"), "error");
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
                    toast(t("qr_error"), "error");
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
                        `${ctx.brandName || "rebecca"}_${tab}_all`,
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
                const show = !revealed.has(key);
                if (show) revealed.add(key);
                else revealed.delete(key);
                // Update in-place so focus and copy-flash states are preserved cleanly.
                const row = btn.parentElement;
                const valEl = row && row.querySelector("[data-secret-val]");
                if (valEl) {
                    valEl.textContent = show ? (valEl.getAttribute("data-secret-raw") || "") : "••••••••";
                }
                const label = t(show ? "hide_secret" : "show_secret");
                btn.setAttribute("aria-label", label);
                btn.setAttribute("title", label);
                btn.setAttribute("aria-pressed", String(show));
                const icon = btn.querySelector("i");
                if (icon) icon.className = `ph ${show ? "ph-eye-slash" : "ph-eye"} text-base`;
            });
        });
    }

    return {
        async start() {
            render(); // island-derived .ovpn links paint immediately
            await load();
            render();
        },
        rerender() { render(false); },
    };
}
