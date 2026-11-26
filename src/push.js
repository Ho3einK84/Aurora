/* ===========================================================================
   Aurora Web Push Alerts — opt-in client for Rebecca's subscription Web Push
   API (PR #228). Completely dormant (zero network calls, zero SW touches,
   hidden UI) whenever `ctx.webPushKey` is empty (pre-PR Rebecca or disabled).
   =========================================================================== */

import { escapeHtml, escapeAttr } from "./format.js";
import { locNum, fmtDevicesUnit } from "./i18n.js";
import { storeGet, storeSet } from "./store.js";
import { $, $$, setHidden, copyText, toast } from "./ui.js";

const PROMPT_DISMISS_KEY = "aurora_alerts_prompt_dismissed";

const DEFAULT_ALERTS = {
    usage_80: true,
    usage_95: false,
    expiry_24h: true,
    limited: true,
    expired: true,
};

const ALERT_OPTIONS = [
    { key: "usage_80", icon: "ph-gauge", tone: "text-warning" },
    { key: "usage_95", icon: "ph-warning-circle", tone: "text-error" },
    { key: "expiry_24h", icon: "ph-calendar-blank", tone: "text-info" },
    { key: "limited", icon: "ph-warning", tone: "text-error" },
    { key: "expired", icon: "ph-clock-counter-clockwise", tone: "text-warning" },
];

const NOOP_VIEW = {
    rerender() {},
    syncLang() {},
    isSubscribed: () => false,
    close() {},
};

/* ----------------------------------------------------------- platform env */

function isIOSDevice() {
    const ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalonePWA() {
    if (window.navigator && window.navigator.standalone === true) return true;
    try {
        return typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches;
    } catch (_) {
        return false;
    }
}

function isInAppWebView() {
    const ua = navigator.userAgent || "";
    return /Telegram|FBAN|FBAV|Instagram|Line\/|MicroMessenger|WhatsApp|Snapchat|TikTok|;\s*wv\)/i.test(ua);
}

function detectPushEnv() {
    if (!window.isSecureContext) return "insecure";
    const webview = isInAppWebView();
    if (isIOSDevice() && !isStandalonePWA()) {
        return webview ? "webview" : "ios_browser";
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
        return webview ? "webview" : "unsupported";
    }
    if (Notification.permission === "denied") return "denied";
    return "ready";
}

/* ----------------------------------------------------------- VAPID & keys */

function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

function bytesToBase64Url(buf) {
    if (!buf) return "";
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function appServerKeysMatch(sub, expectedBytes) {
    try {
        const cur = sub && sub.options && sub.options.applicationServerKey;
        if (!cur) return true; // older engines omit options.applicationServerKey
        const a = new Uint8Array(cur);
        if (a.length !== expectedBytes.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== expectedBytes[i]) return false;
        }
        return true;
    } catch (_) {
        return true;
    }
}

function extractSubPayload(sub) {
    const json = typeof sub.toJSON === "function" ? sub.toJSON() : {};
    const keys = json.keys || {};
    let p256dh = keys.p256dh || "";
    let auth = keys.auth || "";
    if ((!p256dh || !auth) && typeof sub.getKey === "function") {
        if (!p256dh) p256dh = bytesToBase64Url(sub.getKey("p256dh"));
        if (!auth) auth = bytesToBase64Url(sub.getKey("auth"));
    }
    return {
        endpoint: (sub && sub.endpoint) || json.endpoint || "",
        keys: { p256dh, auth },
    };
}

/* -------------------------------------------------------- service worker */

function waitForActiveWorker(reg, timeoutMs = 6000) {
    if (!reg || reg.active) return Promise.resolve(reg);
    const sw = reg.installing || reg.waiting;
    if (!sw) return Promise.resolve(reg);
    return new Promise((resolve) => {
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(reg);
        };
        const timer = setTimeout(done, timeoutMs);
        sw.addEventListener("statechange", () => {
            if (sw.state === "activated" || sw.state === "redundant") done();
        });
        if (sw.state === "activated" || sw.state === "redundant") done();
    });
}

function normalizeAlerts(raw, fallback = DEFAULT_ALERTS) {
    const src = raw && typeof raw === "object" ? raw : fallback;
    return {
        usage_80: Boolean(src.usage_80),
        usage_95: Boolean(src.usage_95),
        expiry_24h: Boolean(src.expiry_24h),
        limited: Boolean(src.limited),
        expired: Boolean(src.expired),
    };
}

function fmtTemplate(str, vars) {
    return String(str || "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ""));
}

/* ------------------------------------------------------------------ mount */

export function mountPush({ ctx, state, t, lang, onCloseMenus }) {
    const btn = $("#alerts-btn");
    const btnIcon = $("#alerts-btn-icon");
    const btnDot = $("#alerts-btn-dot");
    const promptEl = $("#alerts-prompt");
    const promptCta = $("#alerts-prompt-cta");
    const promptDismiss = $("#alerts-prompt-dismiss");
    const modal = $("#alerts-modal");
    const modalClose = $("#alerts-modal-close");
    const modalIcon = $("#alerts-modal-icon");
    const modalBadge = $("#alerts-modal-badge");
    const modalBody = $("#alerts-modal-body");

    if (!ctx || !ctx.webPushKey || !ctx.webPushBase || !btn || !modal) {
        setHidden(btn, true);
        setHidden(promptEl, true);
        return NOOP_VIEW;
    }

    let serverDisabled = false;
    let subscribed = false;
    let devices = 0;
    let alerts = { ...DEFAULT_ALERTS };
    let confirmedAlerts = { ...DEFAULT_ALERTS };
    let currentSub = null;
    let busyAction = ""; // "", "enable", "disable", "test", "prefs"
    let prefsQueue = Promise.resolve();
    let prefsSeq = 0;

    const pushBase = ctx.webPushBase.replace(/\/+$/, "");
    const subScope = pushBase.replace(/\/push$/, "") || "/";
    const swUrl = ctx.webPushSw || (pushBase + "/sw.js");

    function handleServerDisabled(notify) {
        serverDisabled = true;
        subscribed = false;
        currentSub = null;
        setHidden(btn, true);
        setHidden(promptEl, true);
        if (modal.open) modal.close();
        if (notify) toast(t("alerts_err_disabled_server"), "warn");
    }

    async function postPush(action, payload) {
        const res = await fetch(`${pushBase}/${action}`, {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(payload || {}),
        });
        let data = null;
        try {
            data = await res.json();
        } catch (_) {
            data = null;
        }
        return { ok: res.ok, status: res.status, data };
    }

    async function findExistingRegistration() {
        if (!("serviceWorker" in navigator)) return null;
        const expectedScopes = new Set();
        try {
            expectedScopes.add(new URL(subScope, location.href).href);
            expectedScopes.add(new URL(subScope.replace(/\/+$/, "") + "/", location.href).href);
            expectedScopes.add(new URL(pushBase + "/", location.href).href);
        } catch (_) {}
        try {
            if (typeof navigator.serviceWorker.getRegistrations === "function") {
                const targetHref = new URL(swUrl, location.href).href;
                const regs = await navigator.serviceWorker.getRegistrations();
                for (const reg of regs) {
                    if (expectedScopes.has(reg.scope)) return reg;
                    const worker = reg.active || reg.waiting || reg.installing;
                    if (worker && worker.scriptURL === targetHref && reg.scope.startsWith(new URL(subScope, location.href).href)) {
                        return reg;
                    }
                }
                return null;
            }
        } catch (_) {}
        try {
            const direct = await navigator.serviceWorker.getRegistration(subScope);
            if (direct && (!expectedScopes.size || expectedScopes.has(direct.scope))) return direct;
        } catch (_) {}
        try {
            const fallback = await navigator.serviceWorker.getRegistration(pushBase + "/");
            if (fallback && (!expectedScopes.size || expectedScopes.has(fallback.scope))) return fallback;
        } catch (_) {}
        return null;
    }

    async function ensureRegistration() {
        const existing = await findExistingRegistration();
        if (existing) return waitForActiveWorker(existing);
        let reg;
        try {
            reg = await navigator.serviceWorker.register(swUrl, { scope: subScope });
        } catch (err) {
            // If an intermediary proxy stripped `Service-Worker-Allowed: /`,
            // fall back to the script's own directory scope (`{pushBase}/`).
            if (err && err.name === "SecurityError") {
                reg = await navigator.serviceWorker.register(swUrl);
            } else {
                throw err;
            }
        }
        return waitForActiveWorker(reg);
    }

    /* -------------------------------------------------------- UI syncing */

    function syncHeaderAndPrompt() {
        if (serverDisabled) {
            setHidden(btn, true);
            setHidden(promptEl, true);
            return;
        }

        const env = detectPushEnv();
        setHidden(btn, false);
        btn.classList.toggle("alerts-btn-active", subscribed);
        if (btnIcon) {
            btnIcon.className = subscribed
                ? "ph ph-bell-ringing text-lg"
                : env === "denied"
                    ? "ph ph-bell-slash text-lg opacity-65"
                    : "ph ph-bell text-lg";
        }
        setHidden(btnDot, !subscribed);

        const acctState = typeof state === "function" ? state() : "active";
        const dismissed = storeGet(PROMPT_DISMISS_KEY) === "1";
        const promptEligible =
            !subscribed &&
            !dismissed &&
            acctState !== "disabled" &&
            (env === "ready" || env === "ios_browser");
        setHidden(promptEl, !promptEligible);
    }

    function renderToggleRows({ disabled }) {
        const allOff = Object.values(alerts).every((v) => !v);
        const rows = ALERT_OPTIONS.map((opt) => {
            const checked = Boolean(alerts[opt.key]);
            return (
                `<label class="sub-tile row-hover flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5">` +
                    `<div class="flex min-w-0 items-center gap-2.5">` +
                        `<span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-base-content/[0.06] ${opt.tone}">` +
                            `<i class="ph ${opt.icon} text-base"></i>` +
                        `</span>` +
                        `<div class="min-w-0">` +
                            `<p class="text-xs font-semibold text-base-content sm:text-[13px]">${escapeHtml(t("alerts_opt_" + opt.key))}</p>` +
                            `<p class="mt-0.5 text-[11px] leading-snug text-base-content/55">${escapeHtml(t("alerts_opt_" + opt.key + "_desc"))}</p>` +
                        `</div>` +
                    `</div>` +
                    `<input type="checkbox" role="switch" class="aurora-switch" data-alert-key="${escapeAttr(opt.key)}"` +
                        `${checked ? " checked" : ""}${disabled ? " disabled" : ""} />` +
                `</label>`
            );
        }).join("");

        const allOffNote = allOff
            ? `<p class="flex items-start gap-1.5 px-0.5 text-[11px] text-warning">` +
                  `<i class="ph ph-info mt-0.5 shrink-0 text-sm"></i>` +
                  `<span>${escapeHtml(t("alerts_all_off_hint"))}</span>` +
              `</p>`
            : "";

        return (
            `<div class="space-y-2">` +
                `<p class="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-base-content/50">${escapeHtml(t("alerts_choose_events"))}</p>` +
                `<div class="space-y-1.5">${rows}</div>` +
                allOffNote +
            `</div>`
        );
    }

    function renderModal() {
        if (!modalBody) return;
        const env = detectPushEnv();
        const lg = lang();

        if (modalIcon) {
            modalIcon.className = subscribed
                ? "ph ph-bell-ringing text-lg"
                : env === "denied"
                    ? "ph ph-bell-slash text-lg"
                    : "ph ph-bell text-lg";
        }

        if (modalBadge) {
            let badgeText = t("alerts_status_off");
            let badgeTone = "bg-base-content/10 text-base-content/65";
            if (subscribed) {
                badgeText = t("alerts_status_active");
                badgeTone = "bg-success/15 text-success";
            } else if (env === "denied") {
                badgeText = t("alerts_status_blocked");
                badgeTone = "bg-error/15 text-error";
            } else if (env === "ios_browser") {
                badgeText = t("alerts_status_setup");
                badgeTone = "bg-info/15 text-info";
            }
            modalBadge.className = `badge badge-sm shrink-0 rounded-full border border-current/20 px-2 font-medium ${badgeTone}`;
            modalBadge.textContent = badgeText;
        }

        if (env === "ios_browser") {
            modalBody.innerHTML =
                `<p class="text-xs leading-relaxed text-base-content/70 sm:text-[13px]">${escapeHtml(t("alerts_ios_desc"))}</p>` +
                `<div class="space-y-2">` +
                    `<div class="sub-tile flex items-start gap-3 rounded-xl p-3">` +
                        `<span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">` +
                            `<i class="ph ph-export text-base"></i>` +
                        `</span>` +
                        `<div class="min-w-0 flex-1">` +
                            `<p class="text-xs font-semibold text-base-content">${escapeHtml(locNum(1, lg))}. ${escapeHtml(t("alerts_ios_step1"))}</p>` +
                        `</div>` +
                    `</div>` +
                    `<div class="sub-tile flex items-start gap-3 rounded-xl p-3">` +
                        `<span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">` +
                            `<i class="ph ph-plus-square text-base"></i>` +
                        `</span>` +
                        `<div class="min-w-0 flex-1">` +
                            `<p class="text-xs font-semibold text-base-content">${escapeHtml(locNum(2, lg))}. ${escapeHtml(t("alerts_ios_step2"))}</p>` +
                        `</div>` +
                    `</div>` +
                `</div>` +
                `<p class="flex items-center gap-1.5 text-[11px] text-base-content/55">` +
                    `<i class="ph ph-info shrink-0 text-sm"></i>` +
                    `<span>${escapeHtml(t("alerts_ios_note"))}</span>` +
                `</p>`;
            return;
        }

        if (env === "denied") {
            modalBody.innerHTML =
                `<div class="sub-tile rounded-xl border-error/25 bg-error/[0.06] p-3.5">` +
                    `<div class="flex items-start gap-2.5">` +
                        `<i class="ph ph-bell-slash mt-0.5 shrink-0 text-lg text-error"></i>` +
                        `<div class="min-w-0 space-y-1">` +
                            `<p class="text-xs font-semibold text-base-content sm:text-sm">${escapeHtml(t("alerts_denied_title"))}</p>` +
                            `<p class="text-xs leading-relaxed text-base-content/70">${escapeHtml(t("alerts_denied_desc"))}</p>` +
                        `</div>` +
                    `</div>` +
                `</div>`;
            return;
        }

        if (env === "insecure" || env === "webview" || env === "unsupported") {
            const descKey = env === "insecure"
                ? "alerts_insecure_desc"
                : env === "webview"
                    ? "alerts_webview_desc"
                    : "alerts_unsupported_desc";
            modalBody.innerHTML =
                `<div class="sub-tile rounded-xl p-3.5">` +
                    `<div class="flex items-start gap-2.5">` +
                        `<i class="ph ph-warning-circle mt-0.5 shrink-0 text-lg text-warning"></i>` +
                        `<div class="min-w-0 space-y-1">` +
                            `<p class="text-xs font-semibold text-base-content sm:text-sm">${escapeHtml(t("alerts_unsupported_title"))}</p>` +
                            `<p class="text-xs leading-relaxed text-base-content/70">${escapeHtml(t(descKey))}</p>` +
                        `</div>` +
                    `</div>` +
                `</div>` +
                (env !== "insecure"
                    ? `<button id="alerts-copy-link" type="button" class="btn btn-aurora-cta h-10 w-full gap-1.5 rounded-xl text-xs font-semibold sm:text-sm">` +
                          `<i class="ph ph-copy text-base"></i>` +
                          `<span>${escapeHtml(t("alerts_copy_page"))}</span>` +
                      `</button>`
                    : "");
            const copyBtn = $("#alerts-copy-link", modalBody);
            if (copyBtn) {
                copyBtn.addEventListener("click", async () => {
                    if (await copyText(location.href)) toast(t("copied"));
                    else toast(t("copy_failed"), "warn");
                });
            }
            return;
        }

        if (subscribed) {
            const devText = fmtTemplate(t("alerts_devices_total"), {
                n: locNum(Math.max(1, devices), lg),
                unit: fmtDevicesUnit(Math.max(1, devices), lg),
            });
            const isTesting = busyAction === "test";
            const isDisabling = busyAction === "disable";
            modalBody.innerHTML =
                `<div class="sub-tile flex items-center justify-between gap-2 rounded-xl border-success/25 bg-success/[0.06] px-3 py-2.5">` +
                    `<span class="flex min-w-0 items-center gap-2 text-xs font-semibold text-success">` +
                        `<i class="ph ph-check-circle shrink-0 text-base"></i>` +
                        `<span class="truncate">${escapeHtml(t("alerts_active_device"))}</span>` +
                    `</span>` +
                    `<span class="inline-flex shrink-0 items-center gap-1 rounded-lg bg-base-content/[0.07] px-2 py-0.5 text-[11px] font-medium text-base-content/75">` +
                        `<i class="ph ph-device-mobile text-xs"></i>` +
                        `<span>${escapeHtml(devText)}</span>` +
                    `</span>` +
                `</div>` +
                renderToggleRows({ disabled: busyAction === "disable" }) +
                `<div class="flex items-center gap-2 pt-1">` +
                    `<button id="alerts-test-btn" type="button" class="btn glass h-10 flex-1 gap-1.5 whitespace-nowrap rounded-xl text-xs font-semibold sm:text-sm"${busyAction ? " disabled" : ""}>` +
                        (isTesting ? `<span class="alerts-spinner"></span>` : `<i class="ph ph-paper-plane-tilt text-base"></i>`) +
                        `<span>${escapeHtml(isTesting ? t("alerts_testing") : t("alerts_test"))}</span>` +
                    `</button>` +
                    `<button id="alerts-disable-btn" type="button" class="btn btn-ghost glass h-10 flex-1 gap-1.5 whitespace-nowrap rounded-xl text-xs font-medium text-error hover:bg-error/10 sm:text-sm"${busyAction ? " disabled" : ""}>` +
                        (isDisabling ? `<span class="alerts-spinner"></span>` : `<i class="ph ph-bell-slash text-base"></i>`) +
                        `<span>${escapeHtml(isDisabling ? t("alerts_disabling") : t("alerts_disable"))}</span>` +
                    `</button>` +
                `</div>`;
            wireModalControls();
            return;
        }

        // Ready (not subscribed yet on this device)
        const isEnabling = busyAction === "enable";
        const otherDevNote = devices > 0
            ? `<p class="flex items-center gap-1.5 rounded-xl bg-base-content/[0.05] px-3 py-2 text-[11px] font-medium text-base-content/70">` +
                  `<i class="ph ph-device-mobile shrink-0 text-sm text-primary"></i>` +
                  `<span>${escapeHtml(fmtTemplate(t("alerts_other_devices"), { n: locNum(devices, lg), unit: fmtDevicesUnit(devices, lg) }))}</span>` +
              `</p>`
            : "";

        modalBody.innerHTML =
            `<p class="text-xs leading-relaxed text-base-content/70 sm:text-[13px]">${escapeHtml(t("alerts_subtitle"))}</p>` +
            otherDevNote +
            renderToggleRows({ disabled: isEnabling }) +
            `<button id="alerts-enable-btn" type="button" class="btn btn-aurora-cta mt-1 h-11 w-full gap-2 rounded-xl text-sm font-semibold"${isEnabling ? " disabled" : ""}>` +
                (isEnabling ? `<span class="alerts-spinner"></span>` : `<i class="ph ph-bell-ringing text-base"></i>`) +
                `<span>${escapeHtml(isEnabling ? t("alerts_enabling") : t("alerts_enable"))}</span>` +
            `</button>`;
        wireModalControls();
    }

    function wireModalControls() {
        $$("[data-alert-key]", modalBody).forEach((input) => {
            input.addEventListener("change", () => {
                const key = input.getAttribute("data-alert-key");
                if (!key || !(key in alerts)) return;
                const nextAlerts = { ...alerts, [key]: input.checked };
                if (!subscribed) {
                    alerts = nextAlerts;
                    renderModal();
                    return;
                }
                queuePreferenceUpdate(nextAlerts);
            });
        });

        const enableBtn = $("#alerts-enable-btn", modalBody);
        if (enableBtn) enableBtn.addEventListener("click", () => enableAlerts({ fromPrompt: false }));

        const testBtn = $("#alerts-test-btn", modalBody);
        if (testBtn) testBtn.addEventListener("click", () => sendTestAlert());

        const disableBtn = $("#alerts-disable-btn", modalBody);
        if (disableBtn) disableBtn.addEventListener("click", () => disableAlerts());
    }

    /* -------------------------------------------------------- core actions */

    async function hydrateExisting() {
        if (detectPushEnv() !== "ready") return;
        try {
            const reg = await findExistingRegistration();
            if (!reg || !reg.pushManager) return;
            const sub = await reg.pushManager.getSubscription();
            if (!sub || !sub.endpoint) return; // Zero network requests for unsubscribed visitors.

            currentSub = sub;
            const res = await postPush("status", { endpoint: sub.endpoint });
            if (res.status === 403) {
                handleServerDisabled(false);
                return;
            }
            if (!res.ok || !res.data) return;

            devices = Number(res.data.devices) || 0;
            alerts = normalizeAlerts(res.data.alerts, alerts);
            confirmedAlerts = { ...alerts };
            if (res.data.subscribed) {
                subscribed = true;
            } else {
                // Server pruned or revoked this subscription — clean up stale local registration
                // ONLY if this registration is dedicated to this subscription's scope (not shared root "/").
                subscribed = false;
                const rootHref = new URL("/", location.href).href;
                if (subScope !== "/" && reg.scope !== rootHref) {
                    try { await sub.unsubscribe(); } catch (_) {}
                }
                currentSub = null;
            }
            syncHeaderAndPrompt();
            if (modal.open) renderModal();
        } catch (_) {
            // Non-blocking background sync — never disturb page boot.
        }
    }

    async function enableAlerts({ fromPrompt = false } = {}) {
        if (busyAction) return;
        const env = detectPushEnv();
        if (env !== "ready") {
            openModal();
            return;
        }

        busyAction = "enable";
        if (fromPrompt && promptCta) {
            promptCta.disabled = true;
            promptCta.innerHTML = `<span class="alerts-spinner"></span><span>${escapeHtml(t("alerts_enabling"))}</span>`;
        }
        if (modal.open) renderModal();

        try {
            let perm = Notification.permission;
            if (perm === "default") {
                perm = await Notification.requestPermission();
            }
            if (perm !== "granted") {
                syncHeaderAndPrompt();
                if (modal.open) renderModal();
                else if (fromPrompt && perm === "denied") openModal();
                toast(t("alerts_err_denied"), "warn");
                return;
            }

            const appServerKey = urlBase64ToUint8Array(ctx.webPushKey);
            const reg = await ensureRegistration();
            let sub = await reg.pushManager.getSubscription();
            if (sub && !appServerKeysMatch(sub, appServerKey)) {
                try { await sub.unsubscribe(); } catch (_) {}
                sub = null;
            }
            if (!sub) {
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: appServerKey,
                });
            }

            const subPayload = extractSubPayload(sub);
            if (!subPayload.endpoint || !subPayload.keys.p256dh || !subPayload.keys.auth) {
                throw new Error("incomplete push subscription keys");
            }

            const res = await postPush("subscribe", {
                endpoint: subPayload.endpoint,
                keys: subPayload.keys,
                page_url: location.pathname || subScope,
                lang: lang(),
                alerts,
            });

            if (res.status === 403) {
                try { await sub.unsubscribe(); } catch (_) {}
                handleServerDisabled(true);
                return;
            }
            if (res.status === 429) {
                toast(t("alerts_err_rate_limit"), "warn");
                return;
            }
            if (!res.ok || !res.data) {
                toast(t("alerts_err_generic"), "error");
                return;
            }

            currentSub = sub;
            subscribed = Boolean(res.data.subscribed);
            devices = Number(res.data.devices) || 1;
            alerts = normalizeAlerts(res.data.alerts, alerts);
            confirmedAlerts = { ...alerts };
            toast(t("alerts_enabled_toast"));
        } catch (err) {
            console.error("[rebecca-sub] web push subscribe failed:", err);
            toast(t("alerts_err_generic"), "error");
        } finally {
            busyAction = "";
            if (promptCta) {
                promptCta.disabled = false;
                promptCta.innerHTML = `<i class="ph ph-bell text-sm"></i><span data-i18n="alerts_prompt_cta">${escapeHtml(t("alerts_prompt_cta"))}</span>`;
            }
            syncHeaderAndPrompt();
            if (modal.open) renderModal();
        }
    }

    function queuePreferenceUpdate(nextAlerts) {
        const seq = ++prefsSeq;
        const targetAlerts = normalizeAlerts(nextAlerts, alerts);
        alerts = targetAlerts;
        if (modal.open) renderModal();

        prefsQueue = prefsQueue.then(async () => {
            if (!subscribed || !currentSub) return;
            try {
                const res = await postPush("preferences", {
                    endpoint: currentSub.endpoint,
                    lang: lang(),
                    alerts: targetAlerts,
                });
                if (res.status === 403) {
                    handleServerDisabled(true);
                    return;
                }
                if (res.status === 404) {
                    subscribed = false;
                    try { await currentSub.unsubscribe(); } catch (_) {}
                    currentSub = null;
                    syncHeaderAndPrompt();
                    if (modal.open) renderModal();
                    toast(t("alerts_err_expired_sub"), "warn");
                    return;
                }
                if (res.status === 429) {
                    if (seq === prefsSeq) {
                        alerts = { ...confirmedAlerts };
                        if (modal.open) renderModal();
                    }
                    toast(t("alerts_err_rate_limit"), "warn");
                    return;
                }
                if (!res.ok || !res.data) {
                    if (seq === prefsSeq) {
                        alerts = { ...confirmedAlerts };
                        if (modal.open) renderModal();
                    }
                    toast(t("alerts_err_generic"), "error");
                    return;
                }
                devices = Number(res.data.devices) || devices;
                confirmedAlerts = normalizeAlerts(res.data.alerts, targetAlerts);
                if (seq === prefsSeq) {
                    alerts = { ...confirmedAlerts };
                    if (modal.open) renderModal();
                }
            } catch (_) {
                if (seq === prefsSeq) {
                    alerts = { ...confirmedAlerts };
                    if (modal.open) renderModal();
                }
                toast(t("alerts_err_generic"), "error");
            }
        });
    }

    async function sendTestAlert() {
        if (busyAction || !subscribed || !currentSub) return;
        busyAction = "test";
        if (modal.open) renderModal();

        try {
            const res = await postPush("test", { endpoint: currentSub.endpoint });
            if (res.status === 403) {
                handleServerDisabled(true);
                return;
            }
            if (res.status === 404 || res.status === 410) {
                subscribed = false;
                devices = Math.max(0, devices - 1);
                try { await currentSub.unsubscribe(); } catch (_) {}
                currentSub = null;
                toast(t("alerts_err_expired_sub"), "warn");
                return;
            }
            if (res.status === 429) {
                toast(t("alerts_err_rate_limit"), "warn");
                return;
            }
            if (res.status === 502 || !res.ok) {
                toast(t("alerts_err_delivery"), "error");
                return;
            }
            toast(t("alerts_test_sent"));
        } catch (_) {
            toast(t("alerts_err_delivery"), "error");
        } finally {
            busyAction = "";
            syncHeaderAndPrompt();
            if (modal.open) renderModal();
        }
    }

    async function disableAlerts() {
        if (busyAction || !currentSub) return;
        busyAction = "disable";
        if (modal.open) renderModal();

        try {
            const endpoint = currentSub.endpoint;
            const res = await postPush("unsubscribe", { endpoint });
            if (res.status === 403) {
                try { await currentSub.unsubscribe(); } catch (_) {}
                handleServerDisabled(true);
                return;
            }
            if (res.status === 429) {
                toast(t("alerts_err_rate_limit"), "warn");
                return;
            }
            if (!res.ok) {
                toast(t("alerts_err_generic"), "error");
                return;
            }
            try { await currentSub.unsubscribe(); } catch (_) {}
            currentSub = null;
            subscribed = false;
            devices = Number(res.data && res.data.devices) || 0;
            toast(t("alerts_disabled_toast"));
        } catch (_) {
            toast(t("alerts_err_generic"), "error");
        } finally {
            busyAction = "";
            syncHeaderAndPrompt();
            if (modal.open) renderModal();
        }
    }

    function syncLang(nextLang) {
        if (serverDisabled || !subscribed || !currentSub || !nextLang) return;
        // Serialize through prefsQueue with current confirmedAlerts so language sync never
        // races with toggle updates or resets omitted alert booleans on strict servers.
        prefsQueue = prefsQueue.then(async () => {
            if (serverDisabled || !subscribed || !currentSub) return;
            try {
                await postPush("preferences", {
                    endpoint: currentSub.endpoint,
                    lang: nextLang,
                    alerts: { ...confirmedAlerts },
                });
            } catch (_) {}
        });
    }

    function openModal() {
        if (serverDisabled) return;
        if (typeof onCloseMenus === "function") onCloseMenus();
        renderModal();
        if (!modal.open) modal.showModal();
    }

    function closeModal() {
        if (modal.open) modal.close();
    }

    /* ------------------------------------------------------------ wiring */

    btn.addEventListener("click", openModal);
    if (modalClose) modalClose.addEventListener("click", closeModal);

    if (promptCta) {
        promptCta.addEventListener("click", () => {
            if (detectPushEnv() === "ready") {
                enableAlerts({ fromPrompt: true });
            } else {
                openModal();
            }
        });
    }
    if (promptDismiss) {
        promptDismiss.addEventListener("click", () => {
            storeSet(PROMPT_DISMISS_KEY, "1");
            setHidden(promptEl, true);
        });
    }

    syncHeaderAndPrompt();
    // Defer local SW check slightly so first paint & splash dismissal stay instant.
    setTimeout(hydrateExisting, 50);

    return {
        rerender() {
            syncHeaderAndPrompt();
            if (modal.open) renderModal();
        },
        syncLang,
        isSubscribed: () => subscribed,
        close: closeModal,
    };
}
