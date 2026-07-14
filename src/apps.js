/* ===========================================================================
   Aurora apps — OS-grouped client catalogue with one-tap import deep links.
   The list renders lazily (IntersectionObserver) since it sits below the fold.
   =========================================================================== */

import { utf8ToB64, escapeHtml, escapeAttr } from "./format.js";
import { $, $$, setHidden } from "./ui.js";

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
    if (/iphone|ipad|ipod/i.test(ua) && list.includes("iOS")) return "iOS";
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
    return String(template || "")
        .replace(/\{url_enc\}/g, encodeURIComponent(subUrl))
        .replace(/\{url_b64\}/g, b64)
        .replace(/\{url\}/g, subUrl)
        .replace(/\{name\}/g, encodeURIComponent(username || ""));
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

    function renderTabs() {
        tabsEl.innerHTML = osList.map((os) =>
            `<button role="tab" class="tab shrink-0 gap-1.5 rounded-xl font-semibold transition` +
            `${os === activeOs ? " tab-active bg-primary/15 text-primary" : ""}" ` +
            `aria-selected="${os === activeOs}" data-os="${escapeAttr(os)}">` +
            `<i class="ph ${OS_ICONS[os] || "ph-device-mobile"} text-lg"></i>` +
            `<span>${escapeHtml(os)}</span></button>`
        ).join("");
        $$("[data-os]", tabsEl).forEach((btn) => {
            btn.addEventListener("click", () => {
                activeOs = btn.getAttribute("data-os");
                renderTabs();
                renderList();
            });
        });
    }

    function appTile(app) {
        // Bundled entries ship without logos; a gradient letter tile keeps the
        // list consistent and theme-aware. Remote catalogues may still provide
        // an image URL, honoured with a lazy <img> that falls back to the tile.
        const letter = escapeHtml(String(app.name).trim().charAt(0).toUpperCase() || "?");
        const tile = `<div class="app-tile grid h-11 w-11 shrink-0 place-items-center rounded-xl ` +
            `bg-gradient-to-br from-primary/25 to-secondary/25 text-lg font-extrabold text-primary">${letter}</div>`;
        if (!app.image) return tile;
        return `<div class="relative h-11 w-11 shrink-0" data-app-tile>` +
            `<img src="${escapeAttr(app.image)}" alt="" loading="lazy" decoding="async" ` +
            `class="h-11 w-11 rounded-xl bg-base-100/50 object-contain p-1" />` +
            `${tile}</div>`;
    }

    function renderList() {
        const visible = apps.filter((a) => (a.os || []).includes(activeOs));
        listEl.innerHTML = visible.map((app) => {
            const scheme = app.urlScheme
                ? importUrl(app.urlScheme, deps.subUrl, deps.username)
                : "";
            const dl = (app.downloadLinks && app.downloadLinks[activeOs]) || app.link || "";
            return `<div class="card glass lift rounded-2xl border-0">` +
                `<div class="flex items-center gap-3 p-3">` +
                appTile(app) +
                `<div class="min-w-0 flex-1">` +
                `<p class="truncate font-semibold">${escapeHtml(app.name)}</p>` +
                `<p class="text-[11px] text-base-content/50">${escapeHtml(t("tap_to_add"))}</p>` +
                `</div>` +
                `<div class="flex items-center gap-1.5">` +
                (scheme
                    ? `<a class="btn btn-primary btn-sm rounded-xl font-semibold" href="${escapeAttr(scheme)}">${escapeHtml(t("add"))}</a>`
                    : "") +
                (dl
                    ? `<a class="btn btn-ghost btn-sm glass gap-1 rounded-xl font-semibold" target="_blank" ` +
                      `rel="noopener" href="${escapeAttr(dl)}" aria-label="${escapeAttr(t("download"))}">` +
                      `<i class="ph ph-download-simple text-base"></i>` +
                      `<span class="hidden sm:inline">${escapeHtml(t("download"))}</span></a>`
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

    // Lazy-render when the section scrolls near the viewport.
    if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                renderAll();
                io.disconnect();
            }
        }, { rootMargin: "150px" });
        io.observe(card);
    } else {
        renderAll();
    }

    return {
        rerender() {
            if (rendered) renderAll();
        },
    };
}
