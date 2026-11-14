/* ===========================================================================
   Aurora — subscription page logic for the Rebecca panel.
   Vanilla JS (no framework): reads the pongo2 data island, drives i18n + RTL,
   theming, the dual rings, live quota-reset countdown, configs, apps, the
   usage dashboard and the QR modal. Bundled + minified by scripts/build.mjs
   and base64-injected at runtime so pongo2 never parses this source.
   =========================================================================== */

import { I18N, locNum, locPct, fmtDate, fmtRelative } from "./i18n.js";
import { num, hasValue, clamp, fmtBytes, fmtBytesStr, escapeHtml, escapeAttr } from "./format.js";
import { storeGet, storeSet } from "./store.js";
import {
    $, $$, setHidden, copyText, toast, flashCopied,
    animateCount, revealAll, hideSplash, showErrorBanner,
} from "./ui.js";
import { parseLinks, mountConfigs } from "./configs.js";
import { mountApps } from "./apps.js";
import { mountUsage } from "./usage.js";
import { isOvpnLink, isWgLink, isAwgLink, mountVpn } from "./vpn.js";

/* --- Optional remote apps.json override -----------------------------------
   A default apps list is inlined at build time (window.AURORA_APPS). Point
   this at a hosted apps.json raw URL to update the catalogue without a
   rebuild; the bundled list is the fallback. Leave "" to stay fully offline. */
const AURORA_APPS_REMOTE_URL = "";

const THEMES = [
    { id: "auroradark", label: "%brand% Dark", swatch: "linear-gradient(135deg,#0d1522,#2ad0e6,#2de0ba)" },
    { id: "amoleddark", label: "Amoled Dark", swatch: "linear-gradient(135deg,#000000,#38bdf8,#64748b)" },
    { id: "auroralight", label: "%brand% Light", swatch: "linear-gradient(135deg,#e0f2fe,#0891b2,#3b82f6)" },
    { id: "nord", label: "Nord", swatch: "linear-gradient(135deg,#2e3440,#88c0d0,#81a1c1)" },
];

/* ------------------------------------------------------------ data island */

function defaultBrand() {
    // Priority: runtime override (window.AURORA_BRAND) > <meta> fallback in HTML.
    const winBrand = window.AURORA_BRAND && window.AURORA_BRAND.name;
    if (winBrand && typeof winBrand === "string" && winBrand.trim()) return winBrand.trim();
    const meta = document.querySelector('meta[name="aurora-brand"]');
    return (meta && meta.content.trim()) || "Aurora";
}

/**
 * @typedef {Object} AuroraContext
 * @property {string} username
 * @property {string} brandName
 * @property {string} serviceName
 * @property {number} onlineCount
 * @property {string} onlineAt - ISO date or unix seconds
 * @property {string} createdAt - ISO date or unix seconds
 * @property {string} status - active|limited|expired|disabled|on_hold
 * @property {string} statusClass
 * @property {number} usedTraffic - bytes
 * @property {number} dataLimit - bytes (0 = unlimited)
 * @property {string|undefined} limitRaw - raw pongo2 value
 * @property {string} resetStrategy - no_reset|day|week|month|year
 * @property {number} expire - unix seconds (0 = never)
 * @property {string|undefined} expireRaw - raw pongo2 value
 * @property {number} remainingDays
 * @property {string} subUrl
 * @property {string} usageUrl
 * @property {string} supportUrl
 * @property {string[]} links - proxy config URIs (no .ovpn)
 * @property {string[]} ovpnLinks - .ovpn download URLs
 * @property {string[]} wgLinks - WireGuard URIs (.conf or wireguard://)
 */

function readContext() {
    const d = ($("#aurora-data") || {}).dataset || {};
    let subUrl = (d.subscriptionUrl || "").trim();
    if (!/^https?:\/\//i.test(subUrl)) {
        subUrl = location.origin + location.pathname.replace(/\/$/, "");
    }
    // Rebecca (dev) appends OpenVPN `.ovpn` profile download URLs to the links
    // list — split those out of the proxy-config rows and into the VPN card.
    const allLinks = parseLinks(($("#aurora-links") || {}).textContent);
    // Brand text priority: the panel's "Subscription profile title" setting
    // (subscription_profile_title) > the legacy brand_name binding > the
    // <meta name="aurora-brand"> fallback baked into the build.
    const brandName = (d.profileTitle || "").trim() || (d.brandName || "").trim() || defaultBrand();
    return {
        username: (d.username || "").trim(),
        brandName,
        serviceName: (d.serviceName || "").trim(),
        onlineCount: num(d.onlineCount),
        onlineAt: (d.onlineAt || "").trim(),
        createdAt: (d.createdAt || "").trim(),
        status: (d.status || "").trim().toLowerCase(),
        statusClass: (d.statusClass || "").trim().toLowerCase(),
        usedTraffic: num(d.used),
        lifetimeUsed: num(d.lifetimeUsed),
        dataLimit: num(d.limit),
        limitRaw: d.limit,
        resetStrategy: (d.resetStrategy || "").trim().toLowerCase(),
        expire: num(d.expire),
        expireRaw: d.expire,
        onHoldDuration: num(d.onHoldDuration),
        ipLimit: num(d.ipLimit),
        nextPlans: [],
        remainingDays: Math.max(0, num(d.remainingDays)),
        subUrl,
        usageUrl: (d.usageUrl || "").trim(),
        supportUrl: (d.supportUrl || "").trim() || (window.AURORA_BRAND && window.AURORA_BRAND.supportUrl ? String(window.AURORA_BRAND.supportUrl).trim() : ""),
        links: allLinks.filter((l) => !isOvpnLink(l) && !(/\.conf(?:[?#]|$)/i.test(l) && /^https?:\/\//i.test(l))),
        ovpnLinks: allLinks.filter(isOvpnLink),
        wgLinks: allLinks.filter(isWgLink),
        awgLinks: allLinks.filter(isAwgLink),
    };
}

/**
 * Effective account state. `status` is authoritative; `status_class` is only a
 * styling hint some panels normalize differently. When the server still says
 * "active", fall back to client-side conditions (a quota that ran out or an
 * expiry that passed after the page was rendered).
 */
function deriveState(ctx) {
    const KNOWN = ["disabled", "on_hold", "expired", "limited"];
    if (KNOWN.includes(ctx.status)) return ctx.status;
    if (KNOWN.includes(ctx.statusClass)) return ctx.statusClass;
    if (hasValue(ctx.expireRaw) && ctx.expire * 1000 < Date.now()) return "expired";
    if (hasValue(ctx.limitRaw) && ctx.dataLimit > 0 && ctx.usedTraffic >= ctx.dataLimit) return "limited";
    return "active";
}

/* ------------------------------------------------------------------ state */

let lang = "en";
let theme = "auroradark";
let CTX = null;
let STATE = "active";
let cardAnimated = false;
let configsView = null;
let appsView = null;
let usageView = null;
let vpnView = null;

const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;

/* ------------------------------------------------------------------- i18n */

function applyI18n() {
    const dict = I18N[lang];
    document.documentElement.lang = lang;
    document.documentElement.dir = dict.dir;
    $$("[data-i18n]").forEach((el) => {
        const key = el.getAttribute("data-i18n");
        if (dict[key] != null || I18N.en[key] != null) el.textContent = t(key);
    });
    $$("[data-i18n-ph]").forEach((el) => el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))));
    $$("[data-i18n-title]").forEach((el) => el.setAttribute("title", t(el.getAttribute("data-i18n-title"))));
    $$("[data-i18n-label]").forEach((el) => el.setAttribute("aria-label", t(el.getAttribute("data-i18n-label"))));
    $$("[data-i18n-dyn]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n-dyn")); });
}

/**
 * Supported languages. The popover is built from this list, the head-resolver
 * (src/index.html) reads the same IDs to apply the saved/queried language
 * before first paint, and `lang` defaults to its first entry ("en").
 *
 * Each entry uses `flag` (a Unicode emoji) for an inline glyph, except when a
 * real historical flag is required: in that case `flagClass` (a CSS class
 * driven by the build) replaces the emoji. The Persian entry opts into the
 * Lion-and-Sun data-URI injected by `scripts/build.mjs`.
 */
const LANGS = [
    { id: "en", short: "EN", label: "English", flag: "🇺🇸" },
    { id: "fa", short: "فا", label: "فارسی", flagClass: "lang-flag lang-flag-fa",
        flagTitle: "Iran historical flag (Lion and Sun)" },
    { id: "ru", short: "RU", label: "Русский", flag: "🇷🇺" },
    { id: "zh", short: "中", label: "中文", flag: "🇨🇳" },
];

function setLang(next, persist) {
    lang = I18N[next] ? next : "en";
    if (persist) storeSet("aurora_lang", lang);
    $("#lang-label").textContent = LANGS.find((l) => l.id === lang)?.short || "EN";
    applyI18n();
    renderAllDynamic();
    renderLangMenu();
}

function renderLangMenu() {
    const list = $("#lang-list");
    list.innerHTML = LANGS.map((lg) => {
        // Image-based icon (Persian Lion-and-Sun) or fallback to the emoji span.
        const flagSpan = lg.flagClass
            ? `<span class="${lg.flagClass}" role="img"${lg.flagTitle ? ` aria-label="${lg.flagTitle}" title="${lg.flagTitle}"` : ` aria-hidden="true"`}></span>`
            : `<span class="text-base leading-none" aria-hidden="true">${lg.flag}</span>`;
        return `<li><button data-lang-id="${lg.id}" class="justify-between rounded-xl${lg.id === lang ? " active font-semibold" : ""}">` +
            `<span class="flex items-center gap-2">` +
            flagSpan +
            `<span>${lg.label}</span></span>` +
            (lg.id === lang ? `<i class="ph ph-check text-base text-primary"></i>` : "") +
            `</button></li>`;
    }).join("");
    $$("[data-lang-id]", list).forEach((btn) => {
        btn.addEventListener("click", () => {
            setLang(btn.getAttribute("data-lang-id"), true);
            closeLangMenu();
        });
    });
}

function openLangMenu() {
    // Opening the language menu must dismiss the theme menu first so the two
    // popovers never overlap (mobile tap targets are tight, and the resulting
    // stacked glass is hard to dismiss on touch).
    if (!$("#theme-list").hidden) closeThemeMenu();
    closeSubFormatMenu();
    setHidden($("#lang-list"), false);
    $("#lang-toggle").setAttribute("aria-expanded", "true");
}

function closeLangMenu() {
    setHidden($("#lang-list"), true);
    $("#lang-toggle").setAttribute("aria-expanded", "false");
}

function wireLangMenu() {
    $("#lang-toggle").addEventListener("click", (e) => {
        e.stopPropagation();
        if ($("#lang-list").hidden) openLangMenu();
        else closeLangMenu();
    });
    document.addEventListener("click", (e) => {
        if (!$("#lang-menu").contains(e.target)) closeLangMenu();
        if (!$("#theme-menu").contains(e.target)) closeThemeMenu();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { closeLangMenu(); closeThemeMenu(); }
    });
}

/* ------------------------------------------------------------------ theme */

function themeToken(name, fallback) {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    } catch (_) {
        return fallback;
    }
}

function setTheme(id, persist) {
    theme = THEMES.some((th) => th.id === id) ? id : "auroradark";
    document.documentElement.setAttribute("data-theme", theme);
    if (persist) storeSet("aurora_theme", theme);
    renderThemeMenu();
    // Keep the browser chrome + PWA manifest colours in step with the theme.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", themeToken("--color-base-100", "#141c28"));
    if (CTX) installManifest();
}

function renderThemeMenu() {
    const list = $("#theme-list");
    const brand = defaultBrand();
    list.innerHTML = THEMES.map((th) => {
        const label = th.label.replace("%brand%", brand);
        return `<li><button data-theme-id="${th.id}" class="justify-between rounded-xl${th.id === theme ? " active font-semibold" : ""}">` +
            `<span class="flex items-center gap-2">` +
            `<span class="h-3.5 w-3.5 rounded-full border border-base-content/20" style="background:${th.swatch}"></span>` +
            `<span>${label}</span></span>` +
            (th.id === theme ? `<i class="ph ph-check text-base text-primary"></i>` : "") +
            `</button></li>`;
    }).join("");
    $$("[data-theme-id]", list).forEach((btn) => {
        btn.addEventListener("click", () => {
            setTheme(btn.getAttribute("data-theme-id"), true);
            closeThemeMenu();
        });
    });
}

function openThemeMenu() {
    // Mirror of openLangMenu — close the language menu first so the two
    // popovers never stack. See openLangMenu for context.
    if (!$("#lang-list").hidden) closeLangMenu();
    closeSubFormatMenu();
    setHidden($("#theme-list"), false);
    $("#theme-toggle").setAttribute("aria-expanded", "true");
}

function closeThemeMenu() {
    setHidden($("#theme-list"), true);
    $("#theme-toggle").setAttribute("aria-expanded", "false");
}

function wireThemeMenu() {
    $("#theme-toggle").addEventListener("click", (e) => {
        e.stopPropagation();
        if ($("#theme-list").hidden) openThemeMenu();
        else closeThemeMenu();
    });
    document.addEventListener("click", (e) => {
        if (!$("#theme-menu").contains(e.target)) closeThemeMenu();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeThemeMenu();
    });
}

/* ------------------------------------------------------------------ prefs */

function resolvePrefs() {
    const params = new URLSearchParams(location.search);
    const brand = window.AURORA_BRAND || {};
    const metaLang = (document.querySelector('meta[name="aurora-default-lang"]') || {}).content;
    const metaTheme = (document.querySelector('meta[name="aurora-default-theme"]') || {}).content;
    const defLang = brand.defaultLang || brand.lang || metaLang || document.documentElement.getAttribute("lang") || "en";
    const defTheme = brand.defaultTheme || brand.theme || metaTheme || document.documentElement.getAttribute("data-theme") || "auroradark";

    const qLang = params.get("lang");
    const sLang = storeGet("aurora_lang");
    if (I18N[qLang]) lang = qLang;
    else if (I18N[sLang]) lang = sLang;
    else if (I18N[defLang] && defLang !== "en") {
        lang = defLang;
    } else {
        // Best-effort: browser locale prefix → Aurora dictionary.
        const nav = (navigator.language || "").toLowerCase();
        if (nav.startsWith("fa")) lang = "fa";
        else if (nav.startsWith("ru")) lang = "ru";
        else if (nav.startsWith("zh")) lang = "zh";
        else if (I18N[defLang]) lang = defLang;
    }

    const qTheme = params.get("theme");
    const sTheme = storeGet("aurora_theme");
    const isTheme = (v) => THEMES.some((th) => th.id === v);
    if (isTheme(qTheme)) theme = qTheme;
    else if (isTheme(sTheme)) theme = sTheme;
    else if (isTheme(defTheme)) {
        theme = defTheme;
    } else if (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches) {
        theme = "auroralight";
    }
}

/* ------------------------------------------------------------- brand/PWA */

let defaultLogoHtml = null;

function renderBrand() {
    $("#brand-name").textContent = CTX.brandName;
    const splash = $("#splash-brand");
    if (splash) splash.textContent = CTX.brandName;
    document.title = CTX.username ? `${CTX.username} · ${CTX.brandName}` : CTX.brandName;

    // Optional brand logo inside the header emblem circle
    const brand = window.AURORA_BRAND || {};
    const metaLogo = (document.querySelector('meta[name="aurora-brand-logo"]') || {}).content || "";
    const logoUrl = String(brand.logo || metaLogo || "").trim();
    const logoEl = $("#brand-logo");
    if (logoEl) {
        if (defaultLogoHtml === null) defaultLogoHtml = logoEl.innerHTML;
        if (logoUrl && /^(?:https?:\/\/|data:image\/|\/)/i.test(logoUrl)) {
            if (logoEl.dataset.logoSrc !== logoUrl) {
                logoEl.dataset.logoSrc = logoUrl;
                const img = document.createElement("img");
                img.src = logoUrl;
                img.alt = "";
                img.className = "h-full w-full rounded-full object-cover";
                img.addEventListener("error", () => { logoEl.innerHTML = defaultLogoHtml; });
                logoEl.replaceChildren(img);
            }
        } else if (logoEl.dataset.logoSrc) {
            delete logoEl.dataset.logoSrc;
            logoEl.innerHTML = defaultLogoHtml;
        }
    }
}

function renderAnnouncement() {
    const banner = $("#announce-banner");
    if (!banner) return;
    const brand = window.AURORA_BRAND || {};
    const metaAnnounce = (document.querySelector('meta[name="aurora-brand-announcement"]') || {}).content || "";
    const text = String(brand.announcement || metaAnnounce || "").trim();
    if (!text || storeGet("aurora_announce_dismissed") === text) {
        setHidden(banner, true);
        return;
    }
    $("#announce-banner-text").textContent = text;
    setHidden(banner, false);
    const closeBtn = $("#announce-banner-close");
    if (closeBtn && !closeBtn.dataset.wired) {
        closeBtn.dataset.wired = "1";
        closeBtn.addEventListener("click", () => {
            storeSet("aurora_announce_dismissed", text);
            setHidden(banner, true);
        });
    }
}

let manifestUrl = null;

/** Dynamic PWA manifest so "Add to Home Screen" carries the brand + theme. */
function installManifest() {
    try {
        const manifest = {
            name: CTX.brandName,
            short_name: CTX.brandName,
            start_url: ".",
            display: "standalone",
            background_color: themeToken("--color-base-100", "#141c28"),
            theme_color: themeToken("--color-base-100", "#141c28"),
        };
        const blob = new Blob([JSON.stringify(manifest)], { type: "application/json" });
        if (manifestUrl) URL.revokeObjectURL(manifestUrl);
        manifestUrl = URL.createObjectURL(blob);
        let link = document.querySelector('link[rel="manifest"]');
        if (!link) {
            link = document.createElement("link");
            link.rel = "manifest";
            document.head.appendChild(link);
        }
        link.href = manifestUrl;
    } catch (_) { /* PWA extras are best-effort */ }
}

/* ----------------------------------------------------------- service card */

const STATUS_BADGES = {
    active: "bg-success/15 text-success",
    limited: "bg-error/15 text-error",
    expired: "bg-warning/15 text-warning",
    disabled: "bg-base-content/10 text-base-content/60",
    on_hold: "bg-info/15 text-info",
};

const BANNER_TONES = {
    limited: "text-error",
    expired: "text-warning",
    disabled: "text-base-content/70",
    on_hold: "text-info",
};

function setRing(fillEl, pct) {
    fillEl.style.strokeDashoffset = String(100 - clamp(pct, 0, 100));
}

function renderCard() {
    const unlimited = !hasValue(CTX.limitRaw) || CTX.dataLimit <= 0;
    const neverExpire = !hasValue(CTX.expireRaw);
    const snap = cardAnimated;
    const hasNextPlan = Array.isArray(CTX.nextPlans) && CTX.nextPlans.length > 0;

    $("#username").textContent = CTX.username || "—";
    const svc = $("#service-name");
    svc.textContent = CTX.serviceName;
    setHidden(svc, !CTX.serviceName);

    const remainTraffic = unlimited ? Infinity : Math.max(0, CTX.dataLimit - CTX.usedTraffic);
    const isLowTraffic = !unlimited && (remainTraffic <= Math.min(1073741824, CTX.dataLimit * 0.12) || (CTX.usedTraffic / CTX.dataLimit >= 0.9));
    const isLowTime = !neverExpire && CTX.remainingDays > 0 && CTX.remainingDays <= 3;
    const isUrgent = ((STATE !== "active" && STATE !== "on_hold") || isLowTraffic || isLowTime) && !hasNextPlan;

    // Status badge + banner
    const badge = $("#status-badge");
    badge.className = `badge badge-md shrink-0 gap-1.5 rounded-full border border-current/15 px-2.5 py-2.5 text-xs font-medium ${STATUS_BADGES[STATE] || STATUS_BADGES.disabled}`;
    $("#status-badge-text").textContent = t("status_" + STATE) === "status_" + STATE ? t("status_unknown") : t("status_" + STATE);

    const banner = $("#status-banner");
    const bannerText = $("#status-banner-text");
    const bannerAction = $("#status-banner-action");
    const bannerIcon = $("#status-banner-icon");
    if (bannerIcon) {
        bannerIcon.className = STATE === "on_hold"
            ? "ph ph-info shrink-0 text-xl"
            : "ph ph-warning-circle shrink-0 text-xl";
    }

    if (STATE !== "active" && I18N.en["banner_" + STATE]) {
        banner.className = `reveal shown alert mb-4 items-center justify-between gap-3 rounded-2xl glass border border-current/15 sm:mb-5 ${BANNER_TONES[STATE] || ""}`;
        bannerText.textContent = t("banner_" + STATE);
        if (CTX.supportUrl && STATE !== "on_hold" && !hasNextPlan) {
            bannerAction.href = CTX.supportUrl;
            $("#status-banner-action-text").textContent = t("renew");
            setHidden(bannerAction, false);
        } else {
            setHidden(bannerAction, true);
        }
        setHidden(banner, false);
    } else if ((isLowTraffic || isLowTime) && !hasNextPlan) {
        banner.className = `reveal shown alert mb-4 items-center justify-between gap-3 rounded-2xl glass border border-warning/25 text-warning sm:mb-5`;
        const alertKey = isLowTraffic && isLowTime ? "banner_low_both" : isLowTraffic ? "banner_low_traffic" : "banner_low_time";
        bannerText.textContent = t(alertKey);
        if (CTX.supportUrl) {
            bannerAction.href = CTX.supportUrl;
            $("#status-banner-action-text").textContent = t("renew");
            setHidden(bannerAction, false);
        } else {
            setHidden(bannerAction, true);
        }
        setHidden(banner, false);
    } else {
        setHidden(banner, true);
    }

    // Top and footer support buttons + urgent attention glow
    const topSupport = $("#top-support-btn");
    if (topSupport) {
        if (CTX.supportUrl) {
            topSupport.href = CTX.supportUrl;
            setHidden(topSupport, false);
            topSupport.classList.toggle("alert-active", isUrgent);
        } else {
            setHidden(topSupport, true);
            topSupport.classList.remove("alert-active");
        }
    }
    const footerSupport = $("#support-link");
    if (footerSupport) {
        footerSupport.classList.toggle("alert-active", isUrgent);
    }

    // ---- usage ring + stats
    const usedPct = unlimited ? 0 : Math.min(100, Math.round((CTX.usedTraffic / CTX.dataLimit) * 100));
    const dataFill = $("#ring-data-fill");
    if (unlimited) {
        dataFill.style.stroke = "url(#aurora-ring-data)";
        setRing(dataFill, 100);
        $("#ring-data-pct").textContent = "∞";
        $("#ring-data").classList.remove("is-urgent");
    } else {
        const ringUrgent = usedPct >= 90 && !hasNextPlan;
        dataFill.style.stroke = ringUrgent ? "var(--color-error)" : "url(#aurora-ring-data)";
        setRing(dataFill, usedPct);
        $("#ring-data-pct").textContent = locPct(usedPct, lang);
        $("#ring-data").classList.toggle("is-urgent", ringUrgent);
    }

    // Count-up formatter matching the decimal precision of the final value.
    const countFmt = (final) => {
        const dot = final.indexOf(".");
        const dec = dot >= 0 ? final.length - dot - 1 : 0;
        return (n) => locNum(n.toFixed(dec), lang);
    };
    const usedF = fmtBytes(CTX.usedTraffic, lang);
    animateCount($("#stat-used"), usedF.num, countFmt(usedF.value), snap);
    $("#stat-used-unit").textContent = usedF.unit;

    if (unlimited) {
        $("#stat-total").textContent = "∞";
        $("#stat-total-unit").textContent = "";
        $("#stat-remaining").textContent = "∞";
        $("#stat-remaining-unit").textContent = "";
    } else {
        const totalF = fmtBytes(CTX.dataLimit, lang);
        animateCount($("#stat-total"), totalF.num, countFmt(totalF.value), snap);
        $("#stat-total-unit").textContent = totalF.unit;
        const remF = fmtBytes(Math.max(0, CTX.dataLimit - CTX.usedTraffic), lang);
        animateCount($("#stat-remaining"), remF.num, countFmt(remF.value), snap);
        $("#stat-remaining-unit").textContent = remF.unit;
    }

    // ---- time ring + expiry
    const timeFill = $("#ring-time-fill");
    const expireCell = $("#stat-expire");
    const expireRel = $("#stat-expire-rel");
    if (STATE === "on_hold" && neverExpire) {
        const holdDays = CTX.onHoldDuration > 0
            ? Math.max(1, Math.round(CTX.onHoldDuration / 86400))
            : Math.round(CTX.remainingDays);
        timeFill.style.stroke = "var(--color-info)";
        setRing(timeFill, 100);
        $("#ring-time").classList.remove("is-urgent");
        if (holdDays > 0) {
            $("#ring-time-val").textContent = locNum(holdDays, lang);
            expireCell.textContent = `${locNum(holdDays, lang)} ${t(holdDays === 1 ? "day" : "days")}`;
        } else {
            $("#ring-time-val").textContent = "—";
            expireCell.textContent = t("status_on_hold");
        }
        expireCell.classList.remove("text-error");
        expireRel.textContent = t("starts_on_connect");
    } else if (neverExpire) {
        timeFill.style.stroke = "url(#aurora-ring-time)";
        setRing(timeFill, 100);
        $("#ring-time-val").textContent = "∞";
        $("#ring-time").classList.remove("is-urgent");
        expireCell.textContent = t("never");
        expireCell.classList.remove("text-error");
        expireRel.textContent = "";
    } else {
        const nowSec = Date.now() / 1000;
        const remainingSec = Math.max(0, CTX.expire - nowSec);
        // `remaining_days` is precomputed server-side (no now() in pongo2) and can
        // be stale — derive live from `expire`, falling back to the server value.
        const days = hasValue(CTX.expireRaw)
            ? (remainingSec > 0 ? Math.max(0, Math.ceil(remainingSec / 86400)) : 0)
            : Math.round(CTX.remainingDays);
        // The ring empties across an adaptive cycle window so short plans show
        // useful motion and long plans don't pin to 100%.
        const windowDays = Math.max(CTX.remainingDays, remainingSec / 86400);
        const cycleDays = windowDays <= 1 ? 1 : windowDays <= 7 ? 7 : windowDays <= 31 ? 31
            : windowDays <= 93 ? 93 : windowDays <= 366 ? 366 : windowDays;
        const frac = clamp(remainingSec / (cycleDays * 86400), 0, 1);
        const tone = days <= 3 ? "var(--color-error)" : days <= 7 ? "var(--color-warning)" : "url(#aurora-ring-time)";
        timeFill.style.stroke = tone;
        setRing(timeFill, Math.round(frac * 100));
        $("#ring-time").classList.toggle("is-urgent", frac <= 0.1 && STATE === "active" && !hasNextPlan);
        $("#ring-time-val").textContent = locNum(days, lang);
        expireCell.textContent = fmtDate(new Date(CTX.expire * 1000), lang);
        expireCell.classList.toggle("text-error", days <= 3 && !hasNextPlan);
        // Relative hint under the date: "in 3 days" / "expired 2 days ago".
        // `fmtRelative` handles both past and future from the current clock.
        expireRel.textContent = fmtRelative(new Date(CTX.expire * 1000), lang);
    }
    $("#ring-time-unit").textContent = t("days");

    // ---- linear usage bar
    const bar = $("#usage-bar");
    if (unlimited) {
        setHidden(bar, true);
    } else {
        setHidden(bar, false);
        const prog = $("#usage-progress");
        prog.style.width = `${usedPct}%`;
        prog.parentElement?.setAttribute("aria-valuenow", String(usedPct));
        prog.className = `usage-fill${usedPct >= 90 ? " tone-err" : usedPct >= 75 ? " tone-warn" : ""}`;
        $("#usage-caption").textContent = `${fmtBytesStr(CTX.usedTraffic, lang)} / ${fmtBytesStr(CTX.dataLimit, lang)}`;
        $("#usage-pct").textContent = locPct(usedPct, lang);
    }

    renderReset();
    renderNextPlan();
    cardAnimated = true;
}

function renderNextPlan() {
    const row = $("#next-plan-row");
    if (!row) return;
    if (!Array.isArray(CTX.nextPlans) || !CTX.nextPlans.length) {
        setHidden(row, true);
        return;
    }
    const np = CTX.nextPlans[0] || {};
    const parts = [];
    if (num(np.data_limit) > 0) {
        parts.push(fmtBytesStr(num(np.data_limit), lang));
    } else if (np.data_limit === 0 || np.data_limit === null) {
        parts.push(t("unlimited"));
    }
    if (num(np.expire_duration) > 0) {
        const d = Math.max(1, Math.round(num(np.expire_duration) / 86400));
        parts.push(`${locNum(d, lang)} ${t(d === 1 ? "day" : "days")}`);
    }
    let label = parts.join(" · ");
    if (CTX.nextPlans.length > 1) {
        label += ` (+${locNum(CTX.nextPlans.length - 1, lang)})`;
    }
    $("#next-plan-label").textContent = label || "1";
    setHidden(row, false);
}

/* -------------------------------------------------------- reset countdown */

let resetTimer = null;

function nextResetDate(strategy) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    switch (strategy) {
        case "day":
            d.setDate(d.getDate() + 1);
            return d;
        case "week": {
            const day = d.getDay(); // 0 Sun .. 6 Sat → next Monday
            d.setDate(d.getDate() + (((8 - (day === 0 ? 7 : day)) % 7) || 7));
            return d;
        }
        case "month":
            d.setMonth(d.getMonth() + 1, 1);
            return d;
        case "year":
            d.setFullYear(d.getFullYear() + 1, 0, 1);
            return d;
        default:
            return null;
    }
}

function renderReset() {
    const row = $("#reset-row");
    clearInterval(resetTimer);
    const unlimited = !hasValue(CTX.limitRaw) || CTX.dataLimit <= 0;
    const strategy = CTX.resetStrategy;
    const target = nextResetDate(strategy);
    if (unlimited || !target || STATE === "expired" || STATE === "disabled") {
        setHidden(row, true);
        return;
    }
    setHidden(row, false);
    $("#reset-label").textContent = t("reset_" + strategy);

    const out = $("#reset-countdown");
    const tick = () => {
        try {
            let diff = target.getTime() - Date.now();
            if (diff <= 0) {
                out.textContent = t("soon");
                return;
            }
            const dd = Math.floor(diff / 86400000); diff -= dd * 86400000;
            const hh = Math.floor(diff / 3600000); diff -= hh * 3600000;
            const mm = Math.floor(diff / 60000); diff -= mm * 60000;
            const ss = Math.floor(diff / 1000);
            const pad = (n) => String(n).padStart(2, "0");
            const clock = `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
            out.textContent = locNum(dd > 0 ? `${dd} ${t(dd === 1 ? "day" : "days")} ${clock}` : clock, lang);
        } catch (_) {
            clearInterval(resetTimer);
        }
    };
    tick();
    resetTimer = setInterval(tick, 1000);
}

/* --------------------------------------------------------------- QR modal */

let qrSvgFn = null;
let qrSvgPromise = null;
let qrCurrentText = "";

/**
 * Decode + import the QR module embedded by the build as an inert base64 blob
 * (#aurora-qr), exactly once. Blob-URL import — no network request — so the
 * ~20KB generator costs nothing until a QR is actually opened.
 */
function loadQrSvg() {
    if (qrSvgFn) return Promise.resolve(qrSvgFn);
    if (qrSvgPromise) return qrSvgPromise;
    qrSvgPromise = (async () => {
        const el = document.getElementById("aurora-qr");
        const bytes = Uint8Array.from(atob(el.textContent.trim()), (c) => c.charCodeAt(0));
        const src = new TextDecoder("utf-8").decode(bytes);
        const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
        try {
            const mod = await import(/* @vite-ignore */ url);
            qrSvgFn = mod.qrSvg;
            return qrSvgFn;
        } finally {
            URL.revokeObjectURL(url);
        }
    })();
    return qrSvgPromise;
}

async function openQr(title, text) {
    const modal = $("#qr-modal");
    qrCurrentText = text;
    $("#qr-title").textContent = title || t("qrcode");
    $("#qr-text").textContent = text;
    const box = $("#qr-box");
    box.innerHTML = `<span class="text-xs text-base-content/50">${escapeHtml(t("qr_loading"))}</span>`;
    if (!modal.open) modal.showModal();
    try {
        const qrSvg = await loadQrSvg();
        if (!modal.open) return; // closed before the module resolved
        box.innerHTML = qrSvg(text, { margin: 0, errorText: t("qr_too_long") });
    } catch (_) {
        if (modal.open) box.innerHTML = `<span class="text-xs text-error">${escapeHtml(t("qr_error"))}</span>`;
    }
}

function wireQrModal() {
    $("#qr-close").addEventListener("click", () => $("#qr-modal").close());
    $("#qr-copy").addEventListener("click", async (e) => {
        if (await copyText(qrCurrentText)) flashCopied(e.currentTarget, t);
    });
}

/* ------------------------------------------------------------- collapses */

function wireCollapses() {
    $$("[data-collapse]").forEach((head) => {
        const id = head.getAttribute("data-collapse");
        const target = $("#" + id);
        if (!target) return;
        // Restore the persisted open/closed choice.
        const saved = storeGet("aurora_collapse_" + id);
        if (saved === "open" || saved === "closed") {
            const open = saved === "open";
            target.classList.toggle("open", open);
            head.setAttribute("aria-expanded", String(open));
        }
        head.addEventListener("click", () => {
            const open = !target.classList.contains("open");
            target.classList.toggle("open", open);
            head.setAttribute("aria-expanded", String(open));
            head.querySelector(".chev")?.classList.toggle("open", open);
            storeSet("aurora_collapse_" + id, open ? "open" : "closed");
        });
        // Sync the chevron with the (possibly restored) state.
        head.querySelector(".chev")?.classList.toggle("open", target.classList.contains("open"));
    });
}

/* ---------------------------------------------------------------- offline */

function wireOffline() {
    const sync = () => setHidden($("#offline-banner"), navigator.onLine !== false);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    sync();
}

/* ---- system preference watchers ---- */

/** Watch for OS color-scheme changes and follow automatically (unless the user explicitly picked). */
function wireThemeWatcher() {
    if (typeof matchMedia !== "function") return;
    try {
        matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
            if (!storeGet("aurora_theme")) {
                setTheme(e.matches ? "auroralight" : "auroradark", false);
                renderAllDynamic();
            }
        });
    } catch (_) { /* older engines */ }
}

/** Re-render relative time strings ("3 min ago", "in 2 days") every 60 s. */
function startRelativeTimeRefresh() {
    setInterval(() => {
        if (!CTX || document.visibilityState !== "visible") return;
        // Only update the two cells that carry relative text — cheap DOM writes.
        const neverExpire = !hasValue(CTX.expireRaw);
        if (!neverExpire) {
            const rel = $("#stat-expire-rel");
            if (rel) rel.textContent = fmtRelative(new Date(CTX.expire * 1000), lang);
        }
        const online = parsePanelDate(CTX.onlineAt);
        if (online) {
            const fresh = Date.now() - online.getTime() < 30_000;
            const el = $("#last-online");
            if (el && !fresh) el.textContent = fmtRelative(online, lang);
        }
    }, 60_000);
}

/* ------------------------------------------------------------------- apps */

async function loadAppsCatalogue() {
    let data = Array.isArray(window.AURORA_APPS) ? window.AURORA_APPS : [];
    if (AURORA_APPS_REMOTE_URL) {
        try {
            const res = await fetch(AURORA_APPS_REMOTE_URL, { cache: "no-store" });
            if (res.ok) {
                const remote = await res.json();
                if (Array.isArray(remote) && remote.length) data = remote;
            }
        } catch (_) { /* bundled defaults remain */ }
    }
    return data;
}

/* --------------------------------------------------- sub format modal */

const SUB_FORMATS = [
    { id: "auto", labelKey: "fmt_auto", suffix: "" },
    { id: "v2ray", label: "V2Ray (Base64)", suffix: "/v2ray" },
    { id: "v2ray-json", label: "Xray / V2Ray JSON", suffix: "/v2ray-json" },
    { id: "clash-meta", label: "Clash Meta (Mihomo)", suffix: "/clash-meta" },
    { id: "sing-box", label: "Sing-box", suffix: "/sing-box" },
    { id: "passwall", label: "OpenWrt PassWall", suffix: "/passwall" },
];

function renderSubFormatMenu() {
    const list = $("#sub-format-list");
    if (!list || !CTX) return;
    const base = CTX.subUrl.replace(/\/+$/, "");
    list.innerHTML = SUB_FORMATS.map((f) => {
        const label = f.labelKey ? t(f.labelKey) : f.label;
        const url = base + f.suffix;
        return `<div class="sub-tile flex items-center gap-2 rounded-xl px-3 py-2.5">` +
            `<span class="min-w-0 flex-1 truncate text-sm font-medium">${escapeHtml(label)}</span>` +
            `<button data-fmt-copy="${escapeAttr(url)}" class="btn btn-ghost btn-xs btn-square rounded-lg" aria-label="${escapeAttr(t("copy"))}">` +
            `<i class="ph ph-copy text-base"></i></button>` +
            `<button data-fmt-qr="${escapeAttr(url)}" data-fmt-title="${escapeAttr(label)}" ` +
            `class="btn btn-ghost btn-xs btn-square rounded-lg" aria-label="${escapeAttr(t("qrcode"))}">` +
            `<i class="ph ph-qr-code text-base text-base-content/75"></i></button>` +
            `</div>`;
    }).join("");

    $$("[data-fmt-copy]", list).forEach((btn) => {
        btn.addEventListener("click", async () => {
            const icon = btn.querySelector("i");
            if (await copyText(btn.getAttribute("data-fmt-copy"))) {
                toast(t("copied"));
                if (icon) {
                    icon.className = "ph ph-check text-base text-success";
                    setTimeout(() => { icon.className = "ph ph-copy text-base"; }, 1400);
                }
            }
        });
    });
    $$("[data-fmt-qr]", list).forEach((btn) => {
        btn.addEventListener("click", () => {
            closeSubFormatMenu();
            openQr(btn.getAttribute("data-fmt-title"), btn.getAttribute("data-fmt-qr"));
        });
    });
}

function closeSubFormatMenu() {
    const modal = $("#fmt-modal");
    if (modal && modal.open) modal.close();
}

function wireSubFormatMenu() {
    const btn = $("#sub-format-btn");
    const modal = $("#fmt-modal");
    const closeBtn = $("#fmt-modal-close");
    if (!btn || !modal) return;
    btn.addEventListener("click", () => {
        closeLangMenu();
        closeThemeMenu();
        renderSubFormatMenu();
        if (!modal.open) modal.showModal();
    });
    if (closeBtn) closeBtn.addEventListener("click", () => closeSubFormatMenu());
}

/* ----------------------------------------------------- live /info sync */

let infoPromise = null;

function applyUserInfo(u) {
    if (!u || typeof u !== "object" || !CTX) return;
    if (u.used_traffic != null) CTX.usedTraffic = num(u.used_traffic);
    if (u.lifetime_used_traffic != null) CTX.lifetimeUsed = num(u.lifetime_used_traffic);
    if (u.data_limit !== undefined) {
        CTX.limitRaw = u.data_limit != null && u.data_limit > 0 ? String(u.data_limit) : "";
        CTX.dataLimit = num(u.data_limit);
    }
    if (u.data_limit_reset_strategy) {
        CTX.resetStrategy = String(u.data_limit_reset_strategy).trim().toLowerCase();
    }
    if (u.expire !== undefined) {
        CTX.expireRaw = u.expire != null && u.expire > 0 ? String(u.expire) : "";
        CTX.expire = num(u.expire);
    }
    if (u.status) CTX.status = String(u.status).trim().toLowerCase();
    if (u.online_count != null) CTX.onlineCount = num(u.online_count);
    if (u.online_at != null) CTX.onlineAt = String(u.online_at).trim();
    if (u.created_at != null) CTX.createdAt = String(u.created_at).trim();
    if (u.on_hold_expire_duration != null) CTX.onHoldDuration = num(u.on_hold_expire_duration);
    if (u.ip_limit != null) CTX.ipLimit = num(u.ip_limit);
    if (u.service_name) CTX.serviceName = String(u.service_name).trim();
    if (Array.isArray(u.next_plans)) CTX.nextPlans = u.next_plans;

    STATE = deriveState(CTX);
    renderOnlineBadge();
    renderCard();
    renderUserDetails();
}

function fetchSubInfo(force = false) {
    if (!CTX || !CTX.subUrl) return Promise.resolve(null);
    if (infoPromise && !force) return infoPromise;
    const infoUrl = CTX.subUrl.replace(/\/+$/, "") + "/info";
    infoPromise = (async () => {
        try {
            const res = await fetch(infoUrl, {
                cache: "no-store",
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            });
            if (!res.ok) return null;
            const data = await res.json();
            if (data && data.user) applyUserInfo(data.user);
            return data;
        } catch (_) {
            return null;
        }
    })();
    return infoPromise;
}

function startInfoAutoRefresh() {
    let last = Date.now();
    const REFRESH_MS = 5 * 60 * 1000;
    const tick = () => {
        if (document.visibilityState !== "visible") return;
        if (Date.now() - last < REFRESH_MS) return;
        last = Date.now();
        fetchSubInfo(true);
    };
    setInterval(tick, 30 * 1000);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") tick();
    });
}

/* ------------------------------------------------------------- re-render */

function renderAllDynamic() {
    if (!CTX) return;
    renderBrand();
    renderAnnouncement();
    renderOnlineBadge();
    renderCard();
    renderUserDetails();
    renderSubFormatMenu();
    if (configsView) configsView.rerender();
    if (appsView) appsView.rerender();
    if (usageView) usageView.rerender();
    if (vpnView) vpnView.rerender();
}

function renderOnlineBadge() {
    const badge = $("#online-badge");
    if (CTX.onlineCount > 0) {
        $("#online-count").textContent = locNum(CTX.onlineCount, lang);
        setHidden(badge, false);
    } else {
        setHidden(badge, true);
    }
}

/* --------------------------------------------------------- user details */

/**
 * Parse the panel's `user.online_at` / `user.created_at` payloads — they may
 * arrive as an ISO string, an ISO with a trailing "Z", or a unix-seconds
 * integer. Anything we can't parse is silently treated as "not set" so an
 * older panel never throws here.
 */
function parsePanelDate(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    // Pure digits → unix seconds (Rebecca's `online_at` for "never" is 0).
    if (/^\d+$/.test(s)) {
        const sec = num(s);
        return sec > 0 ? new Date(sec * 1000) : null;
    }
    const d = new Date(s.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z");
    return isNaN(d) ? null : d;
}

/** "Last online" / "Member since" / "Device limit" / "Lifetime used" grid. */
function renderUserDetails() {
    const row = $("#user-details");
    const online = parsePanelDate(CTX.onlineAt);
    const member = parsePanelDate(CTX.createdAt);
    const hasDeviceLimit = CTX.ipLimit > 0;
    const hasLifetime = CTX.lifetimeUsed > 0 && CTX.lifetimeUsed > CTX.usedTraffic;

    if (!online && !member && !hasDeviceLimit && !hasLifetime) {
        setHidden(row, true);
        return;
    }
    setHidden(row, false);

    const liveCell = $("#cell-last-online") || row.firstElementChild;
    const memberCell = $("#cell-member-since") || (liveCell && liveCell.nextElementSibling);
    const devCell = $("#cell-device-limit");
    const lifeCell = $("#cell-lifetime-used");
    const lastEl = $("#last-online");
    const memberEl = $("#member-since");

    if (online) {
        const fresh = Date.now() - online.getTime() < 30_000;
        lastEl.textContent = fresh
            ? t("online_just_now")
            : fmtRelative(online, lang);
    } else {
        lastEl.textContent = t("online_never");
    }
    if (member) {
        memberEl.textContent = fmtDate(member, lang);
    }
    if (liveCell) setHidden(liveCell, !online);
    if (memberCell) setHidden(memberCell, !member);

    if (devCell) {
        if (hasDeviceLimit) {
            const val = CTX.onlineCount > 0
                ? `${locNum(CTX.onlineCount, lang)} / ${locNum(CTX.ipLimit, lang)} ${t("devices")}`
                : `${locNum(CTX.ipLimit, lang)} ${t("devices")}`;
            $("#device-limit-val").textContent = val;
            setHidden(devCell, false);
        } else {
            setHidden(devCell, true);
        }
    }

    if (lifeCell) {
        if (hasLifetime) {
            $("#lifetime-used-val").textContent = fmtBytesStr(CTX.lifetimeUsed, lang);
            setHidden(lifeCell, false);
        } else {
            setHidden(lifeCell, true);
        }
    }

    const visibleCells = [liveCell, memberCell, devCell, lifeCell].filter((el) => el && !el.hidden);
    visibleCells.forEach((el) => el.classList.remove("col-span-2"));
    if (visibleCells.length % 2 === 1) {
        visibleCells[visibleCells.length - 1].classList.add("col-span-2");
    }
}

/* -------------------------------------------------------------- bootstrap */

async function init() {
    try {
        CTX = readContext();
        STATE = deriveState(CTX);

        resolvePrefs();
        setTheme(theme, false);
        setLang(lang, false); // applies i18n and the first dynamic render

        wireLangMenu();
        renderLangMenu();
        wireThemeMenu();
        wireSubFormatMenu();
        wireQrModal();
        wireCollapses();
        wireOffline();
        wireThemeWatcher();
        startRelativeTimeRefresh();

        // Kick off non-blocking /info fetch to hydrate on_hold duration, ip_limit,
        // next_plans, lifetime usage, and live traffic/expiry state.
        fetchSubInfo(false);
        startInfoAutoRefresh();

        // Header copy-sub + sub-QR act on the subscription URL.
        $("#copy-sub").addEventListener("click", async (e) => {
            if (await copyText(CTX.subUrl)) flashCopied(e.currentTarget, t);
        });
        $("#sub-qr").addEventListener("click", () => openQr(t("subscription"), CTX.subUrl));

        const support = $("#support-link");
        if (CTX.supportUrl) {
            support.href = CTX.supportUrl;
            setHidden(support, false);
        }
        // External raw usage link — same endpoint `mountUsage` already polls
        // for the chart; expose it as a "View raw data" footer button.
        const usageLink = $("#usage-link");
        if (usageLink && CTX.usageUrl) {
            usageLink.href = CTX.usageUrl;
            setHidden(usageLink, false);
        }

        // Sections. Configs mounts synchronously; usage and VPN lazy-load via
        // IntersectionObserver (like apps). Each section is wrapped in its own
        // try/catch so a failure in one never blocks the others.
        try {
            configsView = mountConfigs({
                links: CTX.links,
                username: CTX.username,
                t,
                lang: () => lang,
                openQr,
            });
        } catch (err) { console.error("[aurora] configs failed:", err); }

        // Lazy-mount usage dashboard when it scrolls near the viewport.
        const usageCard = $("#usage-card");
        const mountUsageOnce = () => {
            if (usageView) return;
            try {
                usageView = mountUsage({ ctx: CTX, state: () => STATE, t, lang: () => lang });
                usageView.start();
            } catch (err) { console.error("[aurora] usage failed:", err); }
        };
        const usageSentinel = $("#usage-sentinel");
        if ("IntersectionObserver" in window && usageSentinel) {
            const io = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) { mountUsageOnce(); io.disconnect(); }
            }, { rootMargin: "200px" });
            io.observe(usageSentinel);
        } else { mountUsageOnce(); }

        // Lazy-mount VPN card when it scrolls near the viewport.
        const vpnCard = $("#vpn-card");
        const mountVpnOnce = () => {
            if (vpnView) return;
            try {
                vpnView = mountVpn({
                    ctx: CTX,
                    ovpnLinks: CTX.ovpnLinks,
                    wgLinks: CTX.wgLinks,
                    awgLinks: CTX.awgLinks,
                    fetchInfo: () => fetchSubInfo(false),
                    t,
                    lang: () => lang,
                });
                vpnView.start();
            } catch (err) { console.error("[aurora] vpn failed:", err); }
        };
        const vpnSentinel = $("#vpn-sentinel");
        if ("IntersectionObserver" in window && vpnSentinel) {
            const io = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) { mountVpnOnce(); io.disconnect(); }
            }, { rootMargin: "200px" });
            io.observe(vpnSentinel);
        } else { mountVpnOnce(); }

        loadAppsCatalogue().then((apps) => {
            try {
                appsView = mountApps({ apps, subUrl: CTX.subUrl, username: CTX.username, t });
            } catch (err) { console.error("[aurora] apps failed:", err); }
        });

        renderAllDynamic();

        requestAnimationFrame(() => {
            revealAll();
            hideSplash();
        });
    } catch (err) {
        try { console.error("[aurora] init failed:", err); } catch (_) { /* ignore */ }
        showErrorBanner();
        hideSplash();
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
