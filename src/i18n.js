/* ===========================================================================
   Aurora i18n — EN / FA dictionaries, Persian digits and date formatting.
   Keys are flat and stable; index.html binds static copy via data-i18n
   attributes, dynamic strings go through t() in app.js.
   =========================================================================== */

export const I18N = {
    en: {
        dir: "ltr",
        tagline: "Your connection, beautifully managed",
        account: "Account",
        online_now: "online now",
        used: "Used", total: "Total", remaining: "Remaining", expires: "Expires",
        never: "Never", days: "days", day: "day",
        status_active: "Active", status_limited: "Data limit reached",
        status_expired: "Expired", status_disabled: "Disabled",
        status_on_hold: "On hold", status_unknown: "Unknown",
        banner_limited: "Your data limit has been reached. Configs may stop working.",
        banner_expired: "Your subscription has expired. Please renew to continue.",
        banner_disabled: "This account is currently disabled.",
        banner_on_hold: "This subscription is on hold and hasn't started yet.",
        error_title: "Something went wrong",
        error_desc: "The page failed to load fully. Please refresh to try again.",
        configs: "Configurations", config: "Config",
        copy_sub: "Copy sub link", copy_all: "Copy all", copy: "Copy", copied: "Copied!",
        search_configs: "Search configs…", filter_all: "All",
        group_by_country: "Group by country", country_other: "Other",
        select_configs: "Select", select_done: "Done",
        copy_selected: "Copy selected", selected: "selected",
        export_configs: "Export configs", export_done: "Configs exported",
        no_configs: "No configurations available",
        no_configs_hint: "There are no active configs for this account yet.",
        no_match: "No configs match your search.",
        apps: "Recommended apps", add: "Add", download: "Download",
        tap_to_add: "One-tap import", qrcode: "QR code", close: "Close",
        sub_qr: "Subscription QR", subscription: "Subscription link",
        qr_too_long: "Link too long for a QR code — use Copy instead.",
        qr_loading: "Generating…",
        qr_error: "QR unavailable — use Copy instead.",
        support: "Get support", switch_lang: "Switch language", switch_theme: "Switch theme",
        offline_title: "You're offline",
        offline_desc: "Check your connection — this updates automatically.",
        reset: "Quota reset", resets_in: "next in",
        reset_day: "Daily", reset_week: "Weekly", reset_month: "Monthly", reset_year: "Yearly",
        soon: "soon",
        usage_history: "Usage history",
        usage_empty: "No usage recorded yet",
        usage_updated: "Updated",
        usage_stale: "offline copy",
        usage_alert_50: "Half of your data is used",
        usage_alert_80: "80% of your data is used",
        usage_alert_90: "90% used — limit reached soon",
        usage_by_server: "By server",
        usage_on: "on",
        forecast_deplete: "At this rate, data runs out",
        forecast_expire_first: "Your plan expires before your data runs out",
        vpn_access: "OpenVPN files",
        vpn_server: "Server", vpn_username: "Username", vpn_password: "Password",
        vpn_psk: "IPsec pre-shared key",
        ovpn_download: "Download",
        show_secret: "Show", hide_secret: "Hide",
        ovpn_note: "Download a profile and import it into an OpenVPN app (e.g. OpenVPN Connect), then connect with one tap.",
        l2tp_note: "Enter these in your device's built-in VPN settings as an L2TP/IPsec connection with a pre-shared key.",
        pptp_note: "Enter these in your device's built-in VPN settings as a PPTP connection.",
    },
    fa: {
        dir: "rtl",
        tagline: "اتصال شما، با مدیریتی زیبا",
        account: "حساب کاربری",
        online_now: "آنلاین",
        used: "مصرف‌شده", total: "کل", remaining: "باقی‌مانده", expires: "انقضا",
        never: "هرگز", days: "روز", day: "روز",
        status_active: "فعال", status_limited: "اتمام حجم",
        status_expired: "منقضی‌شده", status_disabled: "غیرفعال",
        status_on_hold: "در انتظار", status_unknown: "نامشخص",
        banner_limited: "حجم مصرفی شما به پایان رسیده است. ممکن است کانفیگ‌ها قطع شوند.",
        banner_expired: "اشتراک شما منقضی شده است. لطفاً برای ادامه تمدید کنید.",
        banner_disabled: "این حساب در حال حاضر غیرفعال است.",
        banner_on_hold: "این اشتراک در حالت انتظار است و هنوز شروع نشده.",
        error_title: "مشکلی پیش آمد",
        error_desc: "صفحه به‌طور کامل بارگذاری نشد. لطفاً صفحه را تازه‌سازی کنید.",
        configs: "کانفیگ‌ها", config: "کانفیگ",
        copy_sub: "کپی لینک", copy_all: "کپی همه", copy: "کپی", copied: "کپی شد!",
        search_configs: "جست‌وجوی کانفیگ‌ها…", filter_all: "همه",
        group_by_country: "گروه‌بندی بر اساس کشور", country_other: "سایر",
        select_configs: "انتخاب", select_done: "پایان",
        copy_selected: "کپی انتخاب‌شده‌ها", selected: "انتخاب‌شده",
        export_configs: "خروجی کانفیگ‌ها", export_done: "کانفیگ‌ها ذخیره شد",
        no_configs: "کانفیگی موجود نیست",
        no_configs_hint: "هنوز هیچ کانفیگ فعالی برای این حساب وجود ندارد.",
        no_match: "کانفیگی با جست‌وجوی شما مطابقت ندارد.",
        apps: "اپلیکیشن‌های پیشنهادی", add: "افزودن", download: "دانلود",
        tap_to_add: "افزودن با یک لمس", qrcode: "کد QR", close: "بستن",
        sub_qr: "کد QR اشتراک", subscription: "لینک اشتراک",
        qr_too_long: "لینک برای کد QR بسیار بلند است — از کپی استفاده کنید.",
        qr_loading: "در حال ساخت…",
        qr_error: "کد QR در دسترس نیست — از کپی استفاده کنید.",
        support: "پشتیبانی", switch_lang: "تغییر زبان", switch_theme: "تغییر پوسته",
        offline_title: "اتصال اینترنت قطع است",
        offline_desc: "اتصال خود را بررسی کنید — به‌صورت خودکار به‌روزرسانی می‌شود.",
        reset: "بازنشانی حجم", resets_in: "بازنشانی بعدی",
        reset_day: "روزانه", reset_week: "هفتگی", reset_month: "ماهانه", reset_year: "سالانه",
        soon: "به‌زودی",
        usage_history: "تاریخچه مصرف",
        usage_empty: "هنوز مصرفی ثبت نشده",
        usage_updated: "به‌روزرسانی",
        usage_stale: "نسخه آفلاین",
        usage_alert_50: "نیمی از حجم شما مصرف شده",
        usage_alert_80: "۸۰٪ حجم شما مصرف شده",
        usage_alert_90: "۹۰٪ مصرف شده — به‌زودی به سقف می‌رسید",
        usage_by_server: "به تفکیک سرور",
        usage_on: "در",
        forecast_deplete: "با این روند، حجم تمام می‌شود",
        forecast_expire_first: "اشتراک شما زودتر از حجم به پایان می‌رسد",
        vpn_access: "فایل‌های OpenVPN",
        vpn_server: "سرور", vpn_username: "نام کاربری", vpn_password: "رمز عبور",
        vpn_psk: "کلید مشترک IPsec",
        ovpn_download: "دانلود",
        show_secret: "نمایش", hide_secret: "پنهان",
        ovpn_note: "پروفایل را دانلود و در اپلیکیشن OpenVPN (مثل OpenVPN Connect) وارد کنید، سپس با یک لمس متصل شوید.",
        l2tp_note: "این مقادیر را در تنظیمات VPN داخلی دستگاه به‌صورت اتصال L2TP/IPsec با کلید مشترک وارد کنید.",
        pptp_note: "این مقادیر را در تنظیمات VPN داخلی دستگاه به‌صورت اتصال PPTP وارد کنید.",
    },
};

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Replace Latin digits with Persian ones (used whenever lang === "fa"). */
export function toFaDigits(str) {
    return String(str).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);
}

/** Localize a number/string per language. */
export function locNum(value, lang) {
    return lang === "fa" ? toFaDigits(value) : String(value);
}

/** Percent with the proper localized sign (٪ for Persian). */
export function locPct(value, lang) {
    return locNum(value, lang) + (lang === "fa" ? "٪" : "%");
}

/**
 * Format a Date per language. fa-IR defaults to the Persian (Jalali) calendar
 * in every modern engine; the ISO fallback covers exotic embedded webviews.
 */
export function fmtDate(date, lang, opts) {
    const locale = lang === "fa" ? "fa-IR" : "en-GB";
    try {
        return new Intl.DateTimeFormat(locale, opts || { year: "numeric", month: "short", day: "numeric" }).format(date);
    } catch (_) {
        return date.toISOString().slice(0, 10);
    }
}

/** Short "day month" stamp (chart tooltips, forecast). */
export function fmtDayMonth(date, lang) {
    return fmtDate(date, lang, { month: "short", day: "numeric" });
}

/** Localized "HH:MM" clock reading. */
export function fmtClock(date, lang) {
    const pad = (n) => String(n).padStart(2, "0");
    return locNum(`${pad(date.getHours())}:${pad(date.getMinutes())}`, lang);
}
