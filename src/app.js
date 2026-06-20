/* ===========================================================================
   Aurora — subscription page logic for the Rebecca panel.
   Vanilla Alpine.js component: i18n (EN/FA + RTL), theming, traffic math,
   clipboard, client-side QR codes, and app deep-links.
   =========================================================================== */

/* --- Optional remote apps.json override -----------------------------------
   A default apps list is inlined at build time (window.AURORA_APPS). If you
   host an updated apps.json somewhere reachable, point this at its raw URL and
   it will be fetched and used instead — no rebuild required. Leave as "" to
   rely solely on the bundled defaults. */
const AURORA_APPS_REMOTE_URL = "";

/* --- Internationalisation -------------------------------------------------- */
const AURORA_I18N = {
    en: {
        dir: "ltr",
        tagline: "Your connection, beautifully managed",
        brand: "Subscription",
        account: "Account",
        used: "Used", total: "Total", remaining: "Remaining", expires: "Expires",
        unlimited: "Unlimited", days: "days",
        status_active: "Active", status_limited: "Data limit reached",
        status_expired: "Expired", status_disabled: "Disabled",
        banner_limited: "Your data limit has been reached. Configs may stop working.",
        banner_expired: "Your subscription has expired. Please renew to continue.",
        banner_disabled: "This account is currently disabled.",
        configs: "Configurations", config: "Config",
        copy_sub: "Copy sub link", copy_all: "Copy all", copy: "Copy", copied: "Copied!",
        no_configs: "No configurations available",
        no_configs_hint: "There are no active configs for this account yet.",
        apps: "Recommended apps", add: "Add", download: "Download",
        tap_to_add: "One-tap import", qrcode: "QR code", close: "Close",
        sub_qr: "Subscription QR", subscription: "Subscription link",
        support: "Get support", switch_lang: "Switch language", switch_theme: "Switch theme",
        powered: "Powered by Claude",
    },
    fa: {
        dir: "rtl",
        tagline: "اتصال شما، با مدیریتی زیبا",
        brand: "اشتراک",
        account: "حساب کاربری",
        used: "مصرف‌شده", total: "کل", remaining: "باقی‌مانده", expires: "انقضا",
        unlimited: "نامحدود", days: "روز",
        status_active: "فعال", status_limited: "اتمام حجم",
        status_expired: "منقضی‌شده", status_disabled: "غیرفعال",
        banner_limited: "حجم مصرفی شما به پایان رسیده است. ممکن است کانفیگ‌ها قطع شوند.",
        banner_expired: "اشتراک شما منقضی شده است. لطفاً برای ادامه تمدید کنید.",
        banner_disabled: "این حساب در حال حاضر غیرفعال است.",
        configs: "کانفیگ‌ها", config: "کانفیگ",
        copy_sub: "کپی لینک", copy_all: "کپی همه", copy: "کپی", copied: "کپی شد!",
        no_configs: "کانفیگی موجود نیست",
        no_configs_hint: "هنوز هیچ کانفیگ فعالی برای این حساب وجود ندارد.",
        apps: "اپلیکیشن‌های پیشنهادی", add: "افزودن", download: "دانلود",
        tap_to_add: "افزودن با یک لمس", qrcode: "کد QR", close: "بستن",
        sub_qr: "کد QR اشتراک", subscription: "لینک اشتراک",
        support: "پشتیبانی", switch_lang: "تغییر زبان", switch_theme: "تغییر پوسته",
        powered: "قدرت‌گرفته از Claude",
    },
};

const AURORA_THEMES = [
    { id: "auroradark", label: "Aurora Dark", swatch: "linear-gradient(135deg,#34c6db,#5a86f5)" },
    { id: "amoleddark", label: "Amoled Dark", swatch: "linear-gradient(135deg,#000 35%,#4f8bf5,#8a6cff)" },
    { id: "auroralight", label: "Aurora Light", swatch: "linear-gradient(135deg,#1499b8,#3b6dd6)" },
    { id: "nord", label: "Nord", swatch: "#88c0d0" },
];

/* --- Tiny, dependency-free preference store (degrades gracefully) ----------
   Tries localStorage, then a cookie, and always keeps an in-memory copy so the
   page works even when storage is blocked (private mode / embedded webviews). */
const AuroraStore = {
    mem: {},
    get(key) {
        if (key in this.mem) return this.mem[key];
        try {
            const v = localStorage.getItem(key);
            if (v !== null) return v;
        } catch (_) { /* ignore */ }
        const m = document.cookie.match(new RegExp("(?:^|; )" + key + "=([^;]*)"));
        return m ? decodeURIComponent(m[1]) : null;
    },
    set(key, value) {
        this.mem[key] = value;
        try { localStorage.setItem(key, value); } catch (_) { /* ignore */ }
        try { document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`; } catch (_) { /* ignore */ }
    },
};

function aurora() {
    return {
        /* state */
        lang: "en",
        theme: "auroradark",
        username: "", serviceName: "", status: "active", statusClass: "active",
        used: 0, limit: 0, unlimited: true,
        expire: 0, neverExpire: true, remainingDays: 0,
        subscriptionUrl: "", supportUrl: "", usageUrl: "",
        configs: [],
        apps: [], appsLoaded: false, osList: [], activeOs: "",
        copied: "",
        qrOpen: false, qrText: "", qrTitle: "",
        themeOpen: false, configsOpen: true, appsOpen: true,
        _copyTimer: null,

        /* -------- lifecycle -------- */
        init() {
            this.readData();
            this.readConfigs();
            this.restorePrefs();
            this.applyLang();
            this.loadApps();
            this.$nextTick(() => {
                this.revealAll();
                this.hideLoader();
            });
        },

        // Fade out and remove the loading splash once the app is ready.
        hideLoader() {
            const el = document.getElementById("aurora-loader");
            if (!el) return;
            el.classList.add("is-done");
            setTimeout(() => el.remove(), 500);
        },

        /* -------- data binding (from the pongo2-rendered data island) -------- */
        readData() {
            const d = document.getElementById("aurora-data")?.dataset || {};
            this.username = d.username || "";
            this.serviceName = d.serviceName || "";
            this.status = d.status || "active";
            this.statusClass = d.statusClass || "active";
            this.used = this.num(d.used);
            this.limit = this.num(d.limit);
            this.unlimited = !d.limit || this.limit <= 0;
            this.expire = this.num(d.expire);
            this.neverExpire = !d.expire || this.expire <= 0;
            this.remainingDays = Math.max(0, this.num(d.remainingDays));
            this.usageUrl = d.usageUrl || "";
            this.supportUrl = (d.supportUrl || "").trim();
            this.subscriptionUrl = this.resolveSubUrl(d.subscriptionUrl);
        },

        readConfigs() {
            const nodes = document.querySelectorAll("#aurora-configs .cfg");
            this.configs = Array.from(nodes)
                .map((n) => (n.textContent || "").trim())
                .filter(Boolean)
                .map((raw) => ({ raw, name: this.remarkOf(raw), protocol: this.protocolOf(raw) }));
        },

        resolveSubUrl(value) {
            const v = (value || "").trim();
            if (/^https?:\/\//i.test(v)) return v;
            // Prefix-relative or empty → derive from the current page (drop query).
            return window.location.origin + window.location.pathname.replace(/\/$/, "");
        },

        /* -------- helpers -------- */
        num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; },

        protocolOf(link) {
            const m = /^([a-z0-9-]+):\/\//i.exec(link);
            const p = (m ? m[1] : "?").toLowerCase();
            const map = { vmess: "VM", vless: "VL", trojan: "TR", ss: "SS", ssr: "SSR", hysteria: "HY", hysteria2: "HY2", hy2: "HY2", tuic: "TU", wireguard: "WG", socks: "SK" };
            return map[p] || p.slice(0, 3).toUpperCase();
        },

        remarkOf(link) {
            // vmess:// carries a base64-encoded JSON payload whose "ps" field is
            // the display name (UTF-8 — must be decoded as bytes, not Latin-1).
            if (/^vmess:\/\//i.test(link)) {
                try {
                    const payload = link.replace(/^vmess:\/\//i, "").split("#")[0];
                    const json = JSON.parse(this.b64ToUtf8(payload));
                    if (json && (json.ps || json.remark)) return String(json.ps || json.remark);
                } catch (_) { /* fall through to the URL fragment */ }
            }
            // Every other protocol keeps the remark in the URL fragment (#...),
            // percent-encoded by Rebecca.
            const hash = link.split("#").slice(1).join("#");
            if (hash) {
                try { return decodeURIComponent(hash); }
                catch (_) { return hash; }
            }
            return "";
        },

        // Decode a (possibly URL-safe / unpadded) base64 string as UTF-8.
        b64ToUtf8(b64) {
            let s = b64.replace(/-/g, "+").replace(/_/g, "/").trim();
            while (s.length % 4) s += "=";
            const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
            return new TextDecoder("utf-8").decode(bytes);
        },

        fmtBytes(bytes) {
            const b = Number(bytes) || 0;
            if (b <= 0) return "0 B";
            const units = this.lang === "fa"
                ? ["بایت", "کیلوبایت", "مگابایت", "گیگابایت", "ترابایت", "پتابایت"]
                : ["B", "KB", "MB", "GB", "TB", "PB"];
            let i = 0, n = b;
            while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
            const val = i === 0 ? n : n.toFixed(2);
            return this.localizeDigits(`${val} ${units[i]}`);
        },

        fmtDate(ts) {
            if (!ts) return "∞";
            const date = new Date(ts * 1000);
            const locale = this.lang === "fa" ? "fa-IR" : "en-GB";
            try {
                return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(date);
            } catch (_) {
                return date.toISOString().slice(0, 10);
            }
        },

        localizeDigits(str) {
            if (this.lang !== "fa") return str;
            const fa = "۰۱۲۳۴۵۶۷۸۹";
            return str.replace(/[0-9]/g, (d) => fa[+d]);
        },

        get usagePercent() {
            if (this.unlimited || this.limit <= 0) return 0;
            return Math.min(100, Math.round((this.used / this.limit) * 100));
        },
        get remainingBytes() { return Math.max(0, this.limit - this.used); },

        /* -------- ring indicators -------- */
        // Usage ring colour by how full it is.
        get usageTone() {
            return this.usagePercent >= 90 ? "error" : this.usagePercent >= 75 ? "warning" : "primary";
        },
        // Time ring fills relative to a 30-day window (we only know days left),
        // so it visibly empties as expiry approaches within the final month.
        get timePercent() {
            if (this.neverExpire) return 100;
            return Math.max(0, Math.min(100, Math.round((this.remainingDays / 30) * 100)));
        },
        get timeTone() {
            if (this.neverExpire) return "accent";
            if (this.remainingDays <= 3) return "error";
            if (this.remainingDays <= 7) return "warning";
            return "accent";
        },

        get statusBadge() {
            return {
                active: "bg-success/15 text-success",
                limited: "bg-error/15 text-error",
                expired: "bg-warning/15 text-warning",
                disabled: "bg-base-content/10 text-base-content/60",
            }[this.statusClass] || "bg-base-content/10 text-base-content/60";
        },

        /* -------- i18n -------- */
        t(key) { return (AURORA_I18N[this.lang] && AURORA_I18N[this.lang][key]) || key; },
        applyLang() {
            const dir = AURORA_I18N[this.lang].dir;
            document.documentElement.lang = this.lang;
            document.documentElement.dir = dir;
            document.title = `${this.username} · ${this.t("brand")}`;
        },
        toggleLang() {
            this.lang = this.lang === "en" ? "fa" : "en";
            AuroraStore.set("aurora_lang", this.lang);
            this.applyLang();
        },

        /* -------- theming -------- */
        themes: AURORA_THEMES,
        setTheme(id) {
            this.theme = id;
            document.documentElement.setAttribute("data-theme", id);
            AuroraStore.set("aurora_theme", id);
            document.activeElement?.blur?.();
        },
        restorePrefs() {
            const params = new URLSearchParams(window.location.search);
            const lang = params.get("lang") || AuroraStore.get("aurora_lang");
            const theme = params.get("theme") || AuroraStore.get("aurora_theme");
            if (lang && AURORA_I18N[lang]) this.lang = lang;
            else if ((navigator.language || "").toLowerCase().startsWith("fa")) this.lang = "fa";
            if (theme && this.themes.some((th) => th.id === theme)) this.theme = theme;
            document.documentElement.setAttribute("data-theme", this.theme);
        },

        /* -------- clipboard -------- */
        async copy(text, tag) {
            if (!text) return;
            let ok = false;
            try { await navigator.clipboard.writeText(text); ok = true; }
            catch (_) { ok = this.legacyCopy(text); }
            if (!ok) return;
            this.copied = tag;
            clearTimeout(this._copyTimer);
            this._copyTimer = setTimeout(() => (this.copied = ""), 1600);
        },
        legacyCopy(text) {
            try {
                const ta = document.createElement("textarea");
                ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
                document.body.appendChild(ta); ta.select();
                const ok = document.execCommand("copy");
                document.body.removeChild(ta);
                return ok;
            } catch (_) { return false; }
        },
        copyAll() { this.copy(this.configs.map((c) => c.raw).join("\n"), "all"); },

        /* -------- QR codes (qrcode-generator) -------- */
        showQr(cfg) {
            this.qrText = cfg.raw;
            this.qrTitle = cfg.name || cfg.protocol;
            this.qrOpen = true;
            this.$nextTick(() => {
                this.renderQr(cfg.raw);
                const el = this.$refs.qrModal;
                if (el && !el.open) el.showModal();
            });
        },
        // QR code of the subscription link itself.
        showSubQr() {
            this.showQr({ raw: this.subscriptionUrl, name: this.t("subscription") });
        },
        renderQr(text) {
            const box = this.$refs.qrBox;
            if (!box || typeof qrcode === "undefined") return;
            box.innerHTML = "";
            // typeNumber 0 = auto-fit; error correction "M" balances density/resilience.
            const qr = qrcode(0, "M");
            qr.addData(text);
            qr.make();
            box.innerHTML = qr.createSvgTag({ scalable: true, margin: 0 });
        },
        closeQr() {
            this.qrOpen = false;
            this.$refs.qrModal?.close();
        },

        /* -------- apps -------- */
        async loadApps() {
            let data = Array.isArray(window.AURORA_APPS) ? window.AURORA_APPS : [];
            if (AURORA_APPS_REMOTE_URL) {
                try {
                    const res = await fetch(AURORA_APPS_REMOTE_URL, { cache: "no-store" });
                    if (res.ok) {
                        const remote = await res.json();
                        if (Array.isArray(remote) && remote.length) data = remote;
                    }
                } catch (_) { /* fall back to bundled defaults */ }
            }
            this.apps = data.filter((a) => a && a.ShowInMenu !== false);
            const order = ["iOS", "Android", "Windows", "macOS", "Linux"];
            const present = new Set();
            this.apps.forEach((a) => (a.os || []).forEach((o) => present.add(o)));
            this.osList = order.filter((o) => present.has(o)).concat([...present].filter((o) => !order.includes(o)));
            this.activeOs = this.detectOs(this.osList);
            this.appsLoaded = this.apps.length > 0;
        },
        detectOs(list) {
            const ua = navigator.userAgent || "";
            if (/iphone|ipad|ipod/i.test(ua) && list.includes("iOS")) return "iOS";
            if (/android/i.test(ua) && list.includes("Android")) return "Android";
            if (/mac/i.test(ua) && list.includes("macOS")) return "macOS";
            if (/win/i.test(ua) && list.includes("Windows")) return "Windows";
            if (/linux/i.test(ua) && list.includes("Linux")) return "Linux";
            return list[0] || "";
        },
        get appsForOs() { return this.apps.filter((a) => (a.os || []).includes(this.activeOs)); },
        deepLink(app) {
            const url = encodeURIComponent(this.subscriptionUrl);
            const tpl = app.urlScheme || "";
            return tpl.includes("{url}") ? tpl.replace(/\{url\}/g, url) : tpl + url;
        },
        // Resolve the download URL for the active OS, falling back to the
        // generic "link" field.
        downloadLink(app) {
            const byOs = app.downloadLinks && app.downloadLinks[this.activeOs];
            return byOs || app.link || "";
        },
        // Phosphor icon class for each OS tab.
        osIcon(os) {
            return {
                iOS: "ph-apple-logo",
                macOS: "ph-apple-logo",
                Android: "ph-android-logo",
                Windows: "ph-windows-logo",
                Linux: "ph-linux-logo",
            }[os] || "ph-device-mobile";
        },

        /* -------- entrance animation -------- */
        // Reveal EVERY section on load (gently staggered) — never gate visibility
        // on scrolling, so below-the-fold cards are always present.
        revealAll() {
            const els = Array.from(document.querySelectorAll(".reveal"));
            els.forEach((el, i) => (el.style.transitionDelay = Math.min(i * 70, 350) + "ms"));
            requestAnimationFrame(() =>
                requestAnimationFrame(() => els.forEach((el) => el.classList.add("shown")))
            );
            // Drop the stagger afterwards so later state changes don't lag.
            setTimeout(() => els.forEach((el) => (el.style.transitionDelay = "")), 1000);
        },
    };
}

window.aurora = aurora;
