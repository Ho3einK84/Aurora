/* ===========================================================================
   Aurora VPN access — OpenVPN / L2TP / PPTP support for the Rebecca panel
   (`dev` branch).

   Rebecca exposes the classic-VPN data in two places:
     • `.ovpn` profile download links (https://…/sub/{token}/ov/{tag}.ovpn) are
       appended to the template's `links` list and served by the panel;
     • the subscription `/info` endpoint returns
         { user, ov: { downloads: [url…] },
           l2tp: [{ host_tag, inbound_tag, remark, server, username,
                    password, ipsec_psk }…],
           pptp: [{ host_tag, inbound_tag, remark, server, username,
                    password }…] }

   This module renders a tabbed "OpenVPN files" card: download + copy-link
   buttons for OpenVPN profiles and copy-friendly credential cards for
   L2TP/IPsec and PPTP, with masked secrets. The `.ovpn` links found in the data island
   paint immediately; the /info payload then refreshes/extends them. The last
   good payload is cached per user for offline visits.
   =========================================================================== */

import { escapeHtml, escapeAttr } from "./format.js";
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

/* ---------------------------------------------------------------- module */

/**
 * Mount the OpenVPN files section. `deps`:
 *   ctx        — parsed data island (subUrl, username)
 *   ovpnLinks  — `.ovpn` download URLs already present in the links list
 *   t(key), lang() — i18n accessors
 * Returns { start, rerender }.
 */
export function mountVpn(deps) {
    const { ctx, t } = deps;
    const cacheKey = `${CACHE_KEY}:${ctx.username || ""}`;

    let ovpn = (deps.ovpnLinks || []).map(normOvpn).filter(Boolean);
    let l2tp = [];
    let pptp = [];
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
        // /info omits or empties `ov.downloads`, keep the island-derived list.
        const dl = data.ov && Array.isArray(data.ov.downloads) ? data.ov.downloads : null;
        if (dl && dl.length) {
            ovpn = dl.map(normOvpn).filter(Boolean);
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
                    ov: { downloads: ovpn.map((o) => o.url) },
                    l2tp: data.l2tp || [],
                    pptp: data.pptp || [],
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
        ["l2tp", "L2TP/IPsec", () => l2tp.length],
        ["pptp", "PPTP", () => pptp.length],
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
        $$("[data-vpn-tab]", tabsEl).forEach((btn) => {
            btn.addEventListener("click", () => {
                activeTab = btn.getAttribute("data-vpn-tab");
                render();
            });
        });
    }

    function copyButton(value, label) {
        return `<button class="btn btn-circle btn-ghost btn-xs" data-copy="${escapeAttr(value)}" ` +
            `aria-label="${escapeAttr(label)}"><i class="ph ph-copy text-base"></i></button>`;
    }

    function fieldRow(labelKey, value, opts) {
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
            : activeTab === "l2tp" ? l2tp.map((r, i) => credsRow(r, "l2tp", i))
            : pptp.map((r, i) => credsRow(r, "pptp", i));
        listEl.innerHTML = rows.join("");
        noteEl.textContent = t(activeTab + "_note");

        $$("[data-copy]", listEl).forEach((btn) => {
            btn.addEventListener("click", async () => {
                const icon = btn.querySelector("i");
                const prev = icon.className;
                if (await copyText(btn.getAttribute("data-copy"))) {
                    toast(t("copied"));
                    icon.className = prev.replace("ph-copy", "ph-check") + " text-success";
                    setTimeout(() => { icon.className = prev; }, 1600);
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
