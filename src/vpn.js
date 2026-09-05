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

import { escapeHtml, escapeAttr, generateWgConf, downloadTextFile, safeFileName } from "./format.js";
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

function normCreds(row, withPsk) {
    if (!row || typeof row !== "object") return null;
    const item = {
        tag: clean(row.host_tag) || clean(row.inbound_tag),
        remark: clean(row.remark) || clean(row.host_tag) || clean(row.server),
        server: clean(row.server),
        username: clean(row.username),
        password: clean(row.password),
        psk: withPsk ? clean(row.ipsec_psk) : "",
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
        name: clean(row.remark) || clean(row.filename) || clean(row.host_name) || "AmneziaWG",
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
        name: clean(row.remark) || clean(row.filename) || clean(row.host_name) || "WireGuard",
        server: clean(row.server),
        address: clean(row.address),
        port: row.port || "",
        clientAddress: clean(row.client_address),
        clientPublicKey: clean(row.client_public_key),
        serverPublicKey: clean(row.server_public_key),
    };
    return item.downloadUrl || item.link || item.body || item.server ? item : null;
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

    let ovpn = (deps.ovpnLinks || []).map(normOvpn).filter(Boolean);
    let wg = (deps.wgLinks || []).map((link) => {
        if (/^wireguard:\/\//i.test(link)) return normWg({ link });
        return normWg({
            download_url: link,
            remark: ovpnLabel(link).replace(/\.conf$/i, ""),
        });
    }).filter(Boolean);
    let awg = (deps.awgLinks || []).map((link) => {
        if (/^(?:amneziawg|awg):\/\//i.test(link)) return normAwg({ link });
        return normAwg({
            download_url: link,
            remark: ovpnLabel(link).replace(/\.conf$/i, ""),
        });
    }).filter(Boolean);
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
            ovpn = dl.map(normOvpn).filter(Boolean);
            touched = true;
        }
        // WireGuard: prefer structured profiles; fall back to downloads/links arrays.
        const wgSource = data.wireguard;
        if (wgSource && typeof wgSource === "object") {
            if (Array.isArray(wgSource.profiles) && wgSource.profiles.length) {
                wg = wgSource.profiles.map(normWg).filter(Boolean);
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
                        remark: wgDl[i] ? ovpnLabel(wgDl[i]).replace(/\.ovpn$/i, "").replace(/\.conf$/i, "") : "",
                    });
                    if (item) fallback.push(item);
                }
                if (fallback.length) { wg = fallback; touched = true; }
            }
        }
        // AmneziaWG: prefer structured profiles; fall back to downloads array.
        const awgSource = data.amneziawg;
        if (awgSource && typeof awgSource === "object") {
            if (Array.isArray(awgSource.profiles) && awgSource.profiles.length) {
                awg = awgSource.profiles.map(normAwg).filter(Boolean);
                touched = true;
            } else if (Array.isArray(awgSource.downloads) && awgSource.downloads.length) {
                awg = awgSource.downloads.map((url) => normAwg({
                    download_url: url,
                    remark: ovpnLabel(url).replace(/\.conf$/i, ""),
                })).filter(Boolean);
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
            l2tp = data.l2tp.map((r) => normCreds(r, true)).filter(Boolean);
            touched = true;
        }
        if (Array.isArray(data.pptp)) {
            pptp = data.pptp.map((r) => normCreds(r, false)).filter(Boolean);
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
            const res = await fetch(infoUrl, {
                cache: "no-store",
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            });
            if (!res.ok) throw new Error("info HTTP " + res.status);
            const data = await res.json();
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
        return `<div class="flex items-center gap-2 rounded-xl bg-base-100/40 px-3 py-2">` +
            `<i class="ph ${icon} shrink-0 text-base text-base-content/40"></i>` +
            `<div class="min-w-0 flex-1">` +
            `<p class="text-[10px] uppercase tracking-wide text-base-content/50">${escapeHtml(t(labelKey))}</p>` +
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
        return `<div class="group card glass lift rounded-2xl border-0">` +
            `<div class="flex items-center gap-3 p-3">` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 text-[10px] font-bold text-primary">OVPN</div>` +
            `<div class="min-w-0 flex-1">` +
            `<p class="truncate text-sm font-semibold" dir="auto">${escapeHtml(profile.name)}</p>` +
            `<p class="truncate text-start font-mono text-[11px] text-base-content/40" dir="ltr">${escapeHtml(profile.url)}</p>` +
            `</div>` +
            `<button class="btn btn-circle btn-ghost btn-sm" data-copy="${escapeAttr(profile.url)}" aria-label="${escapeAttr(t("copy"))}">` +
            `<i class="ph ph-copy text-lg"></i></button>` +
            `<a class="btn btn-sm btn-primary gap-1.5 rounded-xl font-semibold" href="${escapeAttr(profile.url)}" download>` +
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
                `<a class="btn btn-sm btn-primary gap-1.5 rounded-xl font-semibold" ` +
                `href="${escapeAttr(profile.downloadUrl)}" download>` +
                `<i class="ph ph-download-simple text-base"></i>` +
                `<span class="hidden sm:inline">${escapeHtml(t("download_conf"))}</span></a>`
            );
        } else if (profile.body || profile.link) {
            buttons.push(
                `<button class="btn btn-sm btn-primary gap-1.5 rounded-xl font-semibold" data-dl-wg="${i}" ` +
                `aria-label="${escapeAttr(t("download_conf"))}"><i class="ph ph-download-simple text-base"></i>` +
                `<span class="hidden sm:inline">${escapeHtml(t("download_conf"))}</span></button>`
            );
        }
        if (profile.link && /^wireguard:\/\//i.test(profile.link)) {
            buttons.push(
                `<a class="btn btn-sm btn-accent gap-1.5 rounded-xl font-semibold" ` +
                `href="${escapeAttr(profile.link)}" ` +
                `aria-label="${escapeAttr(t("connect"))}"><i class="ph ph-plug-charging text-base"></i>` +
                `<span class="hidden sm:inline">${escapeHtml(t("connect"))}</span></a>`
            );
        }
        return `<div class="group card glass lift rounded-2xl border-0">` +
            `<div class="flex items-center gap-3 p-3">` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 text-[10px] font-bold text-primary">WG</div>` +
            `<div class="min-w-0 flex-1">` +
            `<p class="truncate text-sm font-semibold" dir="auto">${escapeHtml(profile.name)}</p>` +
            (profile.downloadUrl
                ? `<p class="truncate text-start font-mono text-[11px] text-base-content/40" dir="ltr">${escapeHtml(profile.downloadUrl)}</p>`
                : profile.link
                    ? `<p class="truncate text-start font-mono text-[11px] text-base-content/40" dir="ltr">${escapeHtml(profile.link)}</p>`
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
                `<a class="btn btn-sm btn-primary gap-1.5 rounded-xl font-semibold" ` +
                `href="${escapeAttr(profile.downloadUrl)}" download>` +
                `<i class="ph ph-download-simple text-base"></i>` +
                `<span class="hidden sm:inline">${escapeHtml(t("download_conf"))}</span></a>`
            );
        } else if (profile.body) {
            buttons.push(
                `<button class="btn btn-sm btn-primary gap-1.5 rounded-xl font-semibold" data-dl-awg="${i}" ` +
                `aria-label="${escapeAttr(t("download_conf"))}"><i class="ph ph-download-simple text-base"></i>` +
                `<span class="hidden sm:inline">${escapeHtml(t("download_conf"))}</span></button>`
            );
        }
        return `<div class="group card glass lift rounded-2xl border-0">` +
            `<div class="flex items-center gap-3 p-3">` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 text-[10px] font-bold text-accent">AWG</div>` +
            `<div class="min-w-0 flex-1">` +
            `<p class="truncate text-sm font-semibold" dir="auto">${escapeHtml(profile.name)}</p>` +
            (profile.downloadUrl
                ? `<p class="truncate text-start font-mono text-[11px] text-base-content/40" dir="ltr">${escapeHtml(profile.downloadUrl)}</p>`
                : profile.link
                    ? `<p class="truncate text-start font-mono text-[11px] text-base-content/40" dir="ltr">${escapeHtml(profile.link)}</p>`
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
        return `<div class="card glass rounded-2xl border-0">` +
            `<div class="space-y-2 p-3">` +
            `<div class="flex items-center gap-3">` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 text-[10px] font-bold text-primary">${badge}</div>` +
            `<p class="min-w-0 flex-1 truncate text-sm font-semibold" dir="auto">${escapeHtml(item.remark || badge)}</p>` +
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
        const badge = tab === "ikev2" ? "IKEv2" : tab === "anyconnect" ? "AnyConnect" : tab === "sstp" ? "SSTP" : "GRE";
        const keyOf = (field) => `${tab}:${index}:${field}`;
        const isCert = item.authMode === "certificate";

        if (tab === "gre") {
            return `<div class="card glass rounded-2xl border-0">` +
                `<div class="space-y-2 p-3">` +
                `<div class="flex items-center gap-3">` +
                `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 text-[10px] font-bold text-primary">${badge}</div>` +
                `<p class="min-w-0 flex-1 truncate text-sm font-semibold" dir="auto">${escapeHtml(item.remark || badge)}</p>` +
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

        return `<div class="card glass rounded-2xl border-0">` +
            `<div class="space-y-2 p-3">` +
            `<div class="flex items-center gap-3">` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 text-[10px] font-bold text-primary">${badge}</div>` +
            `<p class="min-w-0 flex-1 truncate text-sm font-semibold" dir="auto">${escapeHtml(item.remark || badge)}</p>` +
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
        listEl.innerHTML = rows.join("");
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
                const conf = profile.body;
                if (conf) {
                    downloadTextFile(conf, safeFileName(profile.name, "amneziawg", ".conf"));
                    toast(t("export_done"));
                } else {
                    toast(t("qr_error"));
                }
            });
        });
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
