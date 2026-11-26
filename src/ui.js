/* ===========================================================================
   Aurora UI utilities — DOM shorthand, visibility, toast, clipboard, reveal
   choreography and the boot splash.
   =========================================================================== */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export let reduceMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
if (typeof matchMedia === "function") {
    try {
        matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
            reduceMotion = e.matches;
        });
    } catch (_) { /* older engines */ }
}

export function setHidden(el, hidden) {
    if (el) el.hidden = !!hidden;
}

/* -------- clipboard -------- */

export async function copyText(text) {
    if (!text) return false;
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (_) { /* fall through to the legacy path */ }
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
    } catch (_) {
        return false;
    }
}

/* -------- toast -------- */

let toastTimer = null;
let toastHome = null;
let toastDialogListener = false;

export function toast(message, tone = "success") {
    const el = $("#toast");
    if (!el) return;
    if (!toastHome) toastHome = el.parentElement;
    if (!toastDialogListener) {
        toastDialogListener = true;
        document.addEventListener("close", (e) => {
            if (e.target && e.target.tagName === "DIALOG" && el.parentElement === e.target) {
                const nextHost = document.querySelector("dialog[open]") || toastHome;
                if (nextHost) nextHost.appendChild(el);
            }
        }, true);
    }
    const openDialog = document.querySelector("dialog[open]");
    const host = openDialog || toastHome;
    if (host && el.parentElement !== host) host.appendChild(el);
    const textEl = $("#toast-text", el);
    const iconEl = $("#toast-icon", el);
    if (textEl) textEl.textContent = message;
    else el.textContent = message;
    if (iconEl) {
        iconEl.className = tone === "error"
            ? "ph ph-warning-circle shrink-0 text-base text-error"
            : tone === "warn"
                ? "ph ph-warning-circle shrink-0 text-base text-warning"
                : tone === "info"
                    ? "ph ph-info shrink-0 text-base text-info"
                    : "ph ph-check-circle shrink-0 text-base text-success";
    }
    el.hidden = false;
    el.classList.remove("toast-in");
    void el.offsetWidth; // restart the enter animation
    el.classList.add("toast-in");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.hidden = true;
        if (toastHome && el.parentElement !== toastHome) toastHome.appendChild(el);
    }, 1800);
}

/**
 * Center an active tab horizontally inside an overflow-x container without
 * ever disturbing vertical page scroll (works identically in LTR & RTL).
 */
export function scrollTabIntoView(container, activeEl, smooth = false) {
    if (!container || !activeEl) return;
    if (container.scrollWidth <= container.clientWidth + 1) return;
    requestAnimationFrame(() => {
        const cr = container.getBoundingClientRect();
        const er = activeEl.getBoundingClientRect();
        if (!cr.width || !er.width) return;
        const delta = (er.left + er.width / 2) - (cr.left + cr.width / 2);
        if (Math.abs(delta) < 2) return;
        try {
            container.scrollBy({ left: delta, behavior: smooth && !reduceMotion ? "smooth" : "instant" });
        } catch (_) {
            container.scrollLeft += delta;
        }
    });
}

/**
 * Swap a button's icon + label to a "Copied!" state for a moment, then restore.
 * Buttons opt in via an <i> icon and a [data-i18n-dyn] label span.
 */
const copiedTimers = new WeakMap();

export function flashCopied(btn, t) {
    if (!btn) return;
    const icon = btn.querySelector("i.ph");
    const label = btn.querySelector("[data-i18n-dyn]");
    const prev = copiedTimers.get(btn);
    if (prev) { clearTimeout(prev.timer); prev.restore(); }

    const prevIcon = icon ? icon.className : "";
    const prevText = label ? label.textContent : "";
    if (icon) icon.className = "ph ph-check text-lg text-success";
    if (label) label.textContent = t("copied");

    const restore = () => {
        if (icon) icon.className = prevIcon;
        if (label) {
            const key = label.getAttribute("data-i18n-dyn");
            label.textContent = key && typeof t === "function" ? t(key) : prevText;
        }
        copiedTimers.delete(btn);
    };
    copiedTimers.set(btn, { timer: setTimeout(restore, 1600), restore });
}

/** Swap an icon-only copy button to a green check momentarily without double-click corruption. */
const copyIconTimers = new WeakMap();

export function flashCopyIcon(btn) {
    if (!btn) return;
    const icon = btn.querySelector("i");
    if (!icon) return;
    const prev = copyIconTimers.get(btn);
    if (prev) { clearTimeout(prev.timer); prev.restore(); }

    const origClass = icon.className;
    const sizeMatch = origClass.match(/\btext-(?:xs|sm|base|lg|xl)\b/);
    const sizeCls = sizeMatch ? sizeMatch[0] : "text-lg";
    icon.className = `ph ph-check ${sizeCls} text-success`;

    const restore = () => {
        icon.className = origClass;
        copyIconTimers.delete(btn);
    };
    copyIconTimers.set(btn, { timer: setTimeout(restore, 1600), restore });
}

/* -------- number count-up -------- */

const countAnims = new WeakMap();

/**
 * Tween an element's text 0 → `to`, formatting each frame with `fmt`.
 * Re-entrant, reduced-motion aware; `snap` forces the final value (used on
 * re-renders so the count-up only plays on the first reveal).
 */
export function animateCount(el, to, fmt, snap) {
    if (!el) return;
    const prev = countAnims.get(el);
    if (prev) cancelAnimationFrame(prev);
    if (snap || reduceMotion || !Number.isFinite(to)) {
        el.textContent = fmt(to);
        return;
    }
    const start = performance.now();
    const dur = 900;
    const step = (now) => {
        const p = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
        el.textContent = fmt(to * eased);
        if (p < 1) countAnims.set(el, requestAnimationFrame(step));
        else countAnims.delete(el);
    };
    countAnims.set(el, requestAnimationFrame(step));
}

/* -------- boot choreography -------- */

/** Reveal every .reveal section with a gentle stagger (never scroll-gated). */
export function revealAll() {
    const els = $$(".reveal");
    if (reduceMotion) {
        els.forEach((el) => el.classList.add("shown"));
        return;
    }
    els.forEach((el, i) => (el.style.transitionDelay = Math.min(i * 70, 350) + "ms"));
    requestAnimationFrame(() =>
        requestAnimationFrame(() => els.forEach((el) => el.classList.add("shown")))
    );
    setTimeout(() => els.forEach((el) => (el.style.transitionDelay = "")), 1000);
}

export function hideSplash() {
    const el = document.getElementById("aurora-loader");
    if (!el) return;
    el.classList.add("is-done");
    setTimeout(() => el.remove(), 500);
}

/** Visible, localized failure state — never leave a blank page. */
export function showErrorBanner() {
    setHidden($("#error-banner"), false);
}
