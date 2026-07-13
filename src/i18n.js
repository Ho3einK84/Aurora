/* ===========================================================================
   Aurora i18n — EN / FA / RU / ZH dictionaries, Persian digits and date
   formatting. Keys are flat and stable; index.html binds static copy via
   data-i18n attributes, dynamic strings go through t() in app.js.
   =========================================================================== */

export const I18N = {
    en: {
        dir: "ltr",
        tagline: "Your connection, beautifully managed",
        account: "Account",
        online_now: "online now",
        online_just_now: "Online now",
        online_never: "Never connected",
        online_ago: "ago",
        used: "Used", total: "Total", remaining: "Remaining", expires: "Expires",
        never: "Never", days: "days", day: "day",
        expires_in: "in",
        expired_since: "",
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
        last_online: "Last online",
        member_since: "Member since",
        usage_history: "Usage history",
        usage_empty: "No usage recorded yet",
        usage_updated: "Updated",
        usage_stale: "offline copy",
        usage_alert_50: "Half of your data is used",
        usage_alert_80: "80% of your data is used",
        usage_alert_90: "90% used — limit reached soon",
        usage_by_server: "By server",
        usage_on: "on",
        usage_range_7d: "7D",
        usage_range_30d: "30D",
        usage_range_90d: "90D",
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
        wg_note: "Download a WireGuard config and import it into the WireGuard app, or scan/copy the link. The full config text is also available for manual setup.",
        copy_link: "Copy link", copy_config: "Copy config",
        wg_address: "Address", wg_port: "Port",
        wg_client_address: "Client address",
        wg_client_pubkey: "Client public key",
        wg_server_pubkey: "Server public key",
        usage_api: "Usage data",
    },
    fa: {
        dir: "rtl",
        tagline: "اتصال شما، با مدیریتی زیبا",
        account: "حساب کاربری",
        online_now: "آنلاین",
        online_just_now: "الان آنلاین",
        online_never: "تاکنون متصل نشده",
        online_ago: "پیش",
        used: "مصرف‌شده", total: "کل", remaining: "باقی‌مانده", expires: "انقضا",
        never: "هرگز", days: "روز", day: "روز",
        expires_in: "تا",
        expired_since: "",
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
        last_online: "آخرین اتصال",
        member_since: "عضو از",
        usage_history: "تاریخچه مصرف",
        usage_empty: "هنوز مصرفی ثبت نشده",
        usage_updated: "به‌روزرسانی",
        usage_stale: "نسخه آفلاین",
        usage_alert_50: "نیمی از حجم شما مصرف شده",
        usage_alert_80: "۸۰٪ حجم شما مصرف شده",
        usage_alert_90: "۹۰٪ مصرف شده — به‌زودی به سقف می‌رسید",
        usage_by_server: "به تفکیک سرور",
        usage_on: "در",
        usage_range_7d: "۷ روز",
        usage_range_30d: "۳۰ روز",
        usage_range_90d: "۹۰ روز",
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
        wg_note: "فایل کانفیگ WireGuard را دانلود و در اپلیکیشن WireGuard وارد کنید، یا لینک را کپی/اسکن کنید. متن کامل کانفیگ نیز برای تنظیم دستی در دسترس است.",
        copy_link: "کپی لینک", copy_config: "کپی کانفیگ",
        wg_address: "آدرس", wg_port: "پورت",
        wg_client_address: "آدرس کلاینت",
        wg_client_pubkey: "کلید عمومی کلاینت",
        wg_server_pubkey: "کلید عمومی سرور",
        usage_api: "داده‌های مصرف",
    },
    ru: {
        dir: "ltr",
        tagline: "Ваше подключение, красиво настроенное",
        account: "Аккаунт",
        online_now: "онлайн",
        online_just_now: "В сети",
        online_never: "Не подключался",
        online_ago: "назад",
        used: "Использовано", total: "Всего", remaining: "Осталось", expires: "Истекает",
        never: "Никогда", days: "дн.", day: "день",
        expires_in: "через",
        expired_since: "",
        status_active: "Активна", status_limited: "Лимит трафика",
        status_expired: "Истекла", status_disabled: "Отключена",
        status_on_hold: "Ожидание", status_unknown: "Неизвестно",
        banner_limited: "Лимит трафика исчерпан. Конфигурации могут перестать работать.",
        banner_expired: "Срок подписки истёк. Пожалуйста, продлите её.",
        banner_disabled: "Этот аккаунт сейчас отключён.",
        banner_on_hold: "Подписка в режиме ожидания и ещё не активна.",
        error_title: "Что-то пошло не так",
        error_desc: "Страница загрузилась не полностью. Пожалуйста, обновите её.",
        configs: "Конфигурации", config: "Конфиг",
        copy_sub: "Скопировать ссылку", copy_all: "Скопировать всё", copy: "Копировать", copied: "Скопировано!",
        search_configs: "Поиск конфигураций…", filter_all: "Все",
        group_by_country: "Группировать по стране", country_other: "Прочее",
        select_configs: "Выбрать", select_done: "Готово",
        copy_selected: "Копировать выбранное", selected: "выбрано",
        export_configs: "Экспорт конфигов", export_done: "Конфигурации сохранены",
        no_configs: "Нет доступных конфигураций",
        no_configs_hint: "Для этого аккаунта пока нет активных конфигов.",
        no_match: "Конфигураций по вашему запросу не найдено.",
        apps: "Рекомендуемые приложения", add: "Добавить", download: "Скачать",
        tap_to_add: "Импорт в одно касание", qrcode: "QR-код", close: "Закрыть",
        sub_qr: "QR подписки", subscription: "Ссылка подписки",
        qr_too_long: "Ссылка слишком длинная для QR — используйте копирование.",
        qr_loading: "Генерация…",
        qr_error: "QR недоступен — используйте копирование.",
        support: "Поддержка", switch_lang: "Сменить язык", switch_theme: "Сменить тему",
        offline_title: "Нет подключения к сети",
        offline_desc: "Проверьте соединение — обновление произойдёт автоматически.",
        reset: "Сброс трафика", resets_in: "следующий через",
        reset_day: "Ежедневно", reset_week: "Еженедельно", reset_month: "Ежемесячно", reset_year: "Ежегодно",
        soon: "скоро",
        last_online: "Последний онлайн",
        member_since: "Дата регистрации",
        usage_history: "История использования",
        usage_empty: "Использование пока не зафиксировано",
        usage_updated: "Обновлено",
        usage_stale: "офлайн-копия",
        usage_alert_50: "Использована половина трафика",
        usage_alert_80: "Использовано 80% трафика",
        usage_alert_90: "Использовано 90% — скоро лимит",
        usage_by_server: "По серверам",
        usage_on: "в",
        usage_range_7d: "7Д",
        usage_range_30d: "30Д",
        usage_range_90d: "90Д",
        forecast_deplete: "При таком темпе трафик закончится",
        forecast_expire_first: "Подписка истечёт раньше, чем закончится трафик",
        vpn_access: "Файлы OpenVPN",
        vpn_server: "Сервер", vpn_username: "Имя пользователя", vpn_password: "Пароль",
        vpn_psk: "Общий ключ IPsec",
        ovpn_download: "Скачать",
        show_secret: "Показать", hide_secret: "Скрыть",
        ovpn_note: "Скачайте профиль и импортируйте его в приложение OpenVPN (например, OpenVPN Connect), затем подключитесь одним касанием.",
        l2tp_note: "Введите эти данные в системных настройках VPN как подключение L2TP/IPsec с общим ключом.",
        pptp_note: "Введите эти данные в системных настройках VPN как подключение PPTP.",
        wg_note: "Скачайте конфиг WireGuard и импортируйте в приложение WireGuard, или скопируйте/отсканируйте ссылку. Полный текст конфига также доступен для ручной настройки.",
        copy_link: "Копировать ссылку", copy_config: "Копировать конфиг",
        wg_address: "Адрес", wg_port: "Порт",
        wg_client_address: "Адрес клиента",
        wg_client_pubkey: "Публичный ключ клиента",
        wg_server_pubkey: "Публичный ключ сервера",
        usage_api: "Данные использования",
    },
    zh: {
        dir: "ltr",
        tagline: "您的连接,精美管理",
        account: "账户",
        online_now: "在线",
        online_just_now: "当前在线",
        online_never: "从未连接",
        online_ago: "前",
        used: "已用", total: "总计", remaining: "剩余", expires: "到期",
        never: "永不过期", days: "天", day: "天",
        expires_in: "还有",
        expired_since: "已过期",
        status_active: "活跃", status_limited: "流量已用尽",
        status_expired: "已过期", status_disabled: "已停用",
        status_on_hold: "待启用", status_unknown: "未知",
        banner_limited: "您的流量已用完。配置可能会停止工作。",
        banner_expired: "您的订阅已过期。请续费以继续使用。",
        banner_disabled: "此账户当前已停用。",
        banner_on_hold: "此订阅处于待启用状态,尚未开始。",
        error_title: "出错了",
        error_desc: "页面未完全加载。请刷新重试。",
        configs: "配置", config: "配置",
        copy_sub: "复制订阅链接", copy_all: "复制全部", copy: "复制", copied: "已复制!",
        search_configs: "搜索配置…", filter_all: "全部",
        group_by_country: "按国家分组", country_other: "其他",
        select_configs: "选择", select_done: "完成",
        copy_selected: "复制所选", selected: "已选",
        export_configs: "导出配置", export_done: "配置已导出",
        no_configs: "暂无可用配置",
        no_configs_hint: "此账户尚无活跃配置。",
        no_match: "没有符合搜索条件的配置。",
        apps: "推荐应用", add: "添加", download: "下载",
        tap_to_add: "一键导入", qrcode: "二维码", close: "关闭",
        sub_qr: "订阅二维码", subscription: "订阅链接",
        qr_too_long: "链接过长,无法生成二维码 — 请改用复制。",
        qr_loading: "生成中…",
        qr_error: "二维码不可用 — 请改用复制。",
        support: "获取支持", switch_lang: "切换语言", switch_theme: "切换主题",
        offline_title: "您已离线",
        offline_desc: "请检查您的网络连接 — 将自动重新连接。",
        reset: "流量重置", resets_in: "下次还有",
        reset_day: "每日", reset_week: "每周", reset_month: "每月", reset_year: "每年",
        soon: "即将",
        last_online: "最近在线",
        member_since: "注册时间",
        usage_history: "使用历史",
        usage_empty: "暂无使用记录",
        usage_updated: "已更新",
        usage_stale: "离线副本",
        usage_alert_50: "流量已使用一半",
        usage_alert_80: "已使用 80% 流量",
        usage_alert_90: "已使用 90% — 即将用尽",
        usage_by_server: "按服务器",
        usage_on: "于",
        usage_range_7d: "7天",
        usage_range_30d: "30天",
        usage_range_90d: "90天",
        forecast_deplete: "按此速度,流量将于",
        forecast_expire_first: "您的订阅将先于流量到期",
        vpn_access: "OpenVPN 文件",
        vpn_server: "服务器", vpn_username: "用户名", vpn_password: "密码",
        vpn_psk: "IPsec 预共享密钥",
        ovpn_download: "下载",
        show_secret: "显示", hide_secret: "隐藏",
        ovpn_note: "下载配置文件并导入 OpenVPN 应用(如 OpenVPN Connect),然后一键连接。",
        l2tp_note: "在设备的内置 VPN 设置中以 L2TP/IPsec 连接方式输入这些信息,并设置预共享密钥。",
        pptp_note: "在设备的内置 VPN 设置中以 PPTP 连接方式输入这些信息。",
        wg_note: "下载 WireGuard 配置文件并导入 WireGuard 应用,或复制/扫描链接。完整配置文本也可用于手动设置。",
        copy_link: "复制链接", copy_config: "复制配置",
        wg_address: "地址", wg_port: "端口",
        wg_client_address: "客户端地址",
        wg_client_pubkey: "客户端公钥",
        wg_server_pubkey: "服务器公钥",
        usage_api: "使用数据",
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

/**
 * Relative time: "3 min ago" / "2 days ago" / "just now" / "in 5 min".
 * Designed for `last online` / `expires` / countdown chips; uses the
 * language's own short unit names (min/hr/day/mo) — falls back to English.
 *
 * Plural rules are minimal: English adds "s", Russian uses the genitive
 * plural ("дн."), Persian/Chinese don't inflect for number.
 */
const RT_UNITS = [
    {
        ms: 60_000,
        en: ["min", "min"], fa: "دقیقه", ru: ["мин", "мин"], zh: "分钟",
    },
    {
        ms: 3_600_000,
        en: ["hr", "hr"], fa: "ساعت", ru: ["ч", "ч"], zh: "小时",
    },
    {
        ms: 86_400_000,
        en: ["day", "days"], fa: "روز",
        // Russian: один день / два-четыре дня / пять+ дней. Use the genitive
        // plural form ("дн.") for everything except exactly 1; the singular
        // form is the "дн" itself which we never reach thanks to the rule
        // below (we say "1 день" via the singular tuple).
        ru: ["день", "дн."], zh: "天",
    },
    {
        ms: 2_592_000_000,
        en: ["mo", "mos"], fa: "ماه", ru: ["мес.", "мес."], zh: "个月",
    },
    {
        ms: Infinity,
        en: ["yr", "yrs"], fa: "سال", ru: ["год", "лет"], zh: "年",
    },
];

export function fmtRelative(date, lang, opts) {
    const now = (opts && opts.now) || Date.now();
    const diff = date.getTime() - now;
    const past = diff < 0;
    const abs = Math.abs(diff);

    // Under 30s in either direction — "just now" / "now".
    if (abs < 30_000) {
        return lang === "fa" ? "الان" : lang === "ru" ? "только что" : lang === "zh" ? "刚刚" : "just now";
    }

    // Walk through the unit table and pick the largest unit that fits.
    let unit = RT_UNITS[0];
    for (let i = 0; i < RT_UNITS.length - 1; i++) {
        if (abs < RT_UNITS[i + 1].ms) { unit = RT_UNITS[i]; break; }
        if (i === RT_UNITS.length - 2) unit = RT_UNITS[i];
    }
    const value = Math.max(1, Math.floor(abs / unit.ms));
    let word;
    const candidate = unit[lang] != null ? unit[lang] : unit.en;
    if (Array.isArray(candidate)) word = candidate[value === 1 ? 0 : 1];
    else word = candidate;
    const localized = locNum(value, lang) + " " + word;

    if (lang === "fa") {
        return past ? `${localized} پیش` : `در ${localized}`;
    }
    if (lang === "ru") {
        return past ? `${localized} назад` : `через ${localized}`;
    }
    if (lang === "zh") {
        return past ? `${localized}前` : `${localized}后`;
    }
    return past ? `${localized} ago` : `in ${localized}`;
}
