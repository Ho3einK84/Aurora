/* ===========================================================================
   Aurora apps — OS-grouped client catalogue with one-tap import deep links.
   The list renders lazily (IntersectionObserver) since it sits below the fold.
   =========================================================================== */

import { utf8ToB64, escapeHtml, escapeAttr } from "./format.js";
import { $, $$, setHidden, scrollTabIntoView } from "./ui.js";

const OS_ORDER = ["iOS", "Android", "Windows", "macOS", "Linux"];

const OS_ICONS = {
    iOS: "ph-apple-logo",
    macOS: "ph-apple-logo",
    Android: "ph-android-logo",
    Windows: "ph-windows-logo",
    Linux: "ph-linux-logo",
};

function detectOs(list) {
    const ua = navigator.userAgent || "";
    const isIpadDesktop = /mac/i.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;
    if ((/iphone|ipad|ipod/i.test(ua) || isIpadDesktop) && list.includes("iOS")) return "iOS";
    if (/android/i.test(ua) && list.includes("Android")) return "Android";
    if (/mac/i.test(ua) && list.includes("macOS")) return "macOS";
    if (/win/i.test(ua) && list.includes("Windows")) return "Windows";
    if (/linux/i.test(ua) && list.includes("Linux")) return "Linux";
    return list[0] || "";
}

/**
 * Expand the import URL template. Supported placeholders:
 *   {url} raw subscription URL · {url_enc} percent-encoded · {url_b64} base64
 *   {name} percent-encoded username
 */
export function importUrl(template, subUrl, username) {
    let b64 = "";
    try { b64 = utf8ToB64(subUrl); } catch (_) { /* leave empty */ }
    const out = String(template || "")
        .replace(/\{url_enc\}/g, encodeURIComponent(subUrl))
        .replace(/\{url_b64\}/g, b64)
        .replace(/\{url\}/g, subUrl)
        .replace(/\{name\}/g, encodeURIComponent(username || ""));
    if (/^\s*(?:javascript|data|vbscript):/i.test(out)) return "";
    return out;
}

/**
 * Mount the apps section. `deps`:
 *   apps: []           — bundled or remote catalogue
 *   subUrl, username   — for deep links
 *   t(key)             — i18n accessor
 * Returns { rerender }.
 */
export function mountApps(deps) {
    const { t } = deps;
    const apps = (deps.apps || []).filter((a) => a && a.name && a.ShowInMenu !== false);
    const card = $("#apps-card");
    if (!apps.length) return { rerender() { /* nothing to render */ } };

    const present = new Set();
    apps.forEach((a) => (a.os || []).forEach((o) => present.add(o)));
    const osList = OS_ORDER.filter((o) => present.has(o))
        .concat([...present].filter((o) => !OS_ORDER.includes(o)));
    let activeOs = detectOs(osList);
    let rendered = false;

    setHidden(card, false);
    const tabsEl = $("#os-tabs");
    const listEl = $("#apps-list");

    function renderTabs(smooth = false) {
        tabsEl.innerHTML = osList.map((os) =>
            `<button type="button" role="tab" class="os-tab${os === activeOs ? " active" : ""}" ` +
            `aria-selected="${os === activeOs}" data-os="${escapeAttr(os)}">` +
            `<i class="ph ${OS_ICONS[os] || "ph-device-mobile"} text-base"></i>` +
            `<span>${escapeHtml(os)}</span></button>`
        ).join("");
        $$("[data-os]", tabsEl).forEach((btn) => {
            btn.addEventListener("click", () => {
                activeOs = btn.getAttribute("data-os");
                renderTabs(true);
                renderList();
            });
        });
        const activeBtn = tabsEl.querySelector(".os-tab.active");
        if (activeBtn) scrollTabIntoView(tabsEl, activeBtn, smooth);
    }

    function appTile(app) {
        // Bundled entries ship without logos; a quiet letter tile keeps the
        // list consistent with the 36px icon column across Configs and VPN.
        const letter = escapeHtml(String(app.name).trim().charAt(0).toUpperCase() || "?");
        const tile = `<div class="app-tile grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-base-content/10 ` +
            `bg-base-content/[0.06] text-sm font-semibold text-base-content/85">${letter}</div>`;
        if (!app.image) return tile;
        return `<div class="relative h-9 w-9 shrink-0" data-app-tile>` +
            `<img src="${escapeAttr(app.image)}" alt="" loading="lazy" decoding="async" ` +
            `class="h-9 w-9 rounded-lg bg-base-100/50 object-contain p-1" />` +
            `${tile}</div>`;
    }

    function renderList() {
        const visible = apps.filter((a) => (a.os || []).includes(activeOs));
        listEl.innerHTML = visible.map((app) => {
            const scheme = app.urlScheme
                ? importUrl(app.urlScheme, deps.subUrl, deps.username)
                : "";
            const rawDl = (app.downloadLinks && app.downloadLinks[activeOs]) || app.link || "";
            const dl = /^https?:\/\//i.test(rawDl) ? rawDl : "";
            const subtitle = scheme ? t("tap_to_add") : t("download");
            return `<div class="sub-tile row-hover rounded-xl">` +
                `<div class="flex items-center gap-2.5 p-2.5 sm:gap-3 sm:p-3">` +
                appTile(app) +
                `<div class="min-w-0 flex-1 text-start">` +
                `<p class="truncate text-start text-sm font-medium"><span dir="auto">${escapeHtml(app.name)}</span></p>` +
                `<p class="text-[11px] text-base-content/55">${escapeHtml(subtitle)}</p>` +
                `</div>` +
                `<div class="flex shrink-0 items-center gap-1.5">` +
                (scheme
                    ? `<a class="btn btn-primary btn-sm h-8 min-h-0 rounded-lg px-3 text-xs font-medium" href="${escapeAttr(scheme)}">${escapeHtml(t("add"))}</a>`
                    : "") +
                (dl
                    ? `<a class="btn btn-ghost btn-sm glass h-8 min-h-0 gap-1.5 rounded-lg text-xs font-medium${scheme ? " w-8 px-0" : " px-2.5"}" target="_blank" ` +
                      `rel="noopener" href="${escapeAttr(dl)}" title="${escapeAttr(t("download"))}" aria-label="${escapeAttr(t("download"))}">` +
                      `<i class="ph ph-download-simple text-base"></i>` +
                      (scheme ? "" : `<span>${escapeHtml(t("download"))}</span>`) +
                      `</a>`
                    : "") +
                `</div></div></div>`;
        }).join("");
        // Wire image error/loads safely (no inline onerror — prevents XSS).
        $$("[data-app-tile]", listEl).forEach((wrap) => {
            const img = wrap.querySelector("img");
            const fallback = wrap.querySelector(".app-tile");
            if (!img || !fallback) return;
            fallback.style.display = "none";
            fallback.style.position = "absolute";
            fallback.style.inset = "0";
            img.addEventListener("error", () => {
                img.style.display = "none";
                fallback.style.display = "";
            });
        });
    }

    function renderAll() {
        rendered = true;
        renderTabs();
        renderList();
    }

    // Render synchronously from the already-loaded catalogue so the card is
    // never visible as an empty shell during fast scrolling.
    renderAll();

    return {
        rerender() {
            if (rendered) renderAll();
        },
    };
}
