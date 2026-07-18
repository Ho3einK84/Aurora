/* ===========================================================================
   Aurora usage dashboard — 30-day history chart, threshold alerts, per-server
   breakdown and a depletion forecast, fed by Rebecca's `usage_url` endpoint.

   Resilient by design: accepts JSON or an HTML page embedding JSON, caches the
   last good payload for offline visits (flagged stale), and auto-refreshes
   every 5 minutes while the tab is visible.
   =========================================================================== */

import { num, hasValue, fmtBytes, escapeHtml, escapeAttr } from "./format.js";
import { locNum, locPct, fmtDayMonth, fmtClock } from "./i18n.js";
import { $, $$, setHidden } from "./ui.js";
import { storeGet, storeSet } from "./store.js";

const CACHE_KEY = "aurora_usage";
const REFRESH_MS = 5 * 60 * 1000;

/* ------------------------------------------------------------- parsing */

function pickUsageArray(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") return data.usages || data.history || data.data || null;
    return null;
}

/** Per-server rows out of Rebecca's `node_usages[]`; null when absent. */
function pickNodeUsage(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const arr = data.node_usages || data.nodes || null;
    if (!Array.isArray(arr) || !arr.length) return null;
    const rows = arr
        .map((n) => ({
            name: String((n && (n.node_name || n.name)) || "").trim() || "—",
            value: num(n && n.uplink) + num(n && n.downlink) || num(n && n.used_traffic) || num(n && n.value),
        }))
        .filter((n) => n.value > 0);
    return rows.length ? rows : null;
}

/**
 * The usage endpoint may answer with an HTML panel page instead of JSON —
 * scrape an embedded <script type="application/json"> block (or a
 * `window.__USAGE__ = {…}` assignment) before giving up.
 */
function parseUsageFromHtml(html) {
    const re = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
        try {
            const parsed = JSON.parse(m[1].trim());
            const arr = pickUsageArray(parsed);
            if (arr && arr.length) return { arr, parsed };
        } catch (_) { /* keep scanning */ }
    }
    const assign = html.match(/(?:__USAGE__|usageHistory|usage)\s*=\s*(\[[\s\S]*?\]|\{[\s\S]*?\})\s*[;\n]/i);
    if (assign) {
        try {
            const parsed = JSON.parse(assign[1]);
            const arr = pickUsageArray(parsed);
            if (arr && arr.length) return { arr, parsed };
        } catch (_) { /* fall through */ }
    }
    return null;
}

const dateOf = (r) => new Date(r.date || r.day || r.t);

function usageValOf(r) {
    if (r == null) return 0;
    const direct = r.used_traffic != null ? r.used_traffic
        : r.used != null ? r.used
        : r.value != null ? r.value
        : r.bytes != null ? r.bytes
        : r.total;
    if (direct != null) return num(direct);
    if (r.uplink != null || r.downlink != null) return num(r.uplink) + num(r.downlink);
    return 0;
}

/* --------------------------------------------------------------- module */

/**
 * Mount the usage dashboard. `deps`:
 *   ctx    — parsed data island (usageUrl, dataLimit*, usedTraffic, expire*)
 *   state  — derived account state
 *   t(key), lang() — i18n accessors
 * Returns { start, rerender }.
 */
export function mountUsage(deps) {
    const { ctx, t, lang } = deps;
    // Scope the offline cache per user — several accounts can share one origin.
    const cacheKey = `${CACHE_KEY}:${ctx.username || ""}`;

    let history = null;     // array of daily rows, or null = nothing to show
    let nodes = null;       // per-server rows, or null
    let updatedAt = 0;      // epoch ms of the data shown
    let stale = false;      // true when showing a cached copy
    let rangeDays = 30;     // 7/30/90 — the user-toggleable chart window

    async function load() {
        if (!ctx.usageUrl) return;
        try {
            const res = await fetch(ctx.usageUrl, {
                cache: "no-store",
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            });
            if (!res.ok) throw new Error("usage HTTP " + res.status);
            const ctype = (res.headers.get("content-type") || "").toLowerCase();
            const body = await res.text();
            let arr = null;
            let parsed = null;
            if (ctype.includes("application/json") || /^\s*[[{]/.test(body)) {
                try {
                    parsed = JSON.parse(body);
                    arr = pickUsageArray(parsed);
                } catch (_) {
                    const scraped = parseUsageFromHtml(body);
                    if (scraped) ({ arr, parsed } = scraped);
                }
            } else {
                const scraped = parseUsageFromHtml(body);
                if (scraped) ({ arr, parsed } = scraped);
            }
            if (arr) {
                history = arr;
                nodes = pickNodeUsage(parsed);
                updatedAt = Date.now();
                stale = false;
                storeSet(cacheKey, JSON.stringify({ ts: updatedAt, data: arr, nodes }));
                return;
            }
            history = [];
        } catch (_) {
            // Network/parse failure → fall back to the last cached payload.
            try {
                const cached = JSON.parse(storeGet(cacheKey));
                if (cached && Array.isArray(cached.data)) {
                    history = cached.data;
                    nodes = cached.nodes || null;
                    updatedAt = cached.ts || 0;
                    stale = true;
                }
            } catch (_) { /* no cache — stay hidden */ }
        }
    }

    function render() {
        const card = $("#usage-card");
        if (history == null) {
            setHidden(card, true);
            return;
        }
        setHidden(card, false);

        renderRangePills();
        renderChart();
        renderForecast();
        renderAlert();
        renderNodes();
        renderUpdated();
    }

    function renderRangePills() {
        // Sync the three range pills with the current `rangeDays`; one-time
        // wiring for clicks lives in `wireRangePills` (called from `start`).
        $$("#usage-range .range-pill").forEach((btn) => {
            const days = num(btn.getAttribute("data-range"));
            const active = days === rangeDays;
            btn.classList.toggle("active", active);
            btn.setAttribute("aria-selected", String(active));
        });
    }

    function wireRangePills() {
        $$("#usage-range .range-pill").forEach((btn) => {
            btn.addEventListener("click", () => {
                const next = num(btn.getAttribute("data-range")) || 30;
                if (next === rangeDays) return;
                rangeDays = next;
                render();
            });
        });
    }

    function renderChart() {
        const chart = $("#usage-chart");
        const period = $("#usage-period");
        if (!history.length) {
            chart.innerHTML = `<p class="py-5 text-center text-sm text-base-content/50">${escapeHtml(t("usage_empty"))}</p>`;
            chart.setAttribute("aria-label", t("usage_empty"));
            period.textContent = "";
            return;
        }
        // Take the most recent N days so the bar widths stay consistent across
        // ranges — the visual density (more bars for 90D, fewer for 7D) carries
        // the "this is a wider window" signal.
        const rows = history.slice().sort((a, b) => dateOf(a) - dateOf(b)).slice(-rangeDays);
        const max = Math.max(1, ...rows.map(usageValOf));

        const W = 300, H = 80, pad = 3;
        const step = (W - pad * 2) / rows.length;
        const barW = Math.max(1.5, step - 2);
        let rects = "";
        rows.forEach((r, i) => {
            const v = usageValOf(r);
            const h = Math.max(v > 0 ? 2 : 0.75, (v / max) * (H - 8));
            const x = pad + i * step;
            const y = H - h;
            const d = dateOf(r);
            const f = fmtBytes(v, lang());
            const when = isNaN(d) ? "" : ` ${t("usage_on")} ${fmtDayMonth(d, lang())}`;
            rects += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" ` +
                `height="${h.toFixed(2)}" rx="1.5"><title>${escapeHtml(`${locNum(f.value, lang())} ${f.unit}${when}`)}</title></rect>`;
        });
        chart.innerHTML =
            `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="usage-svg">${rects}</svg>`;

        const total = fmtBytes(rows.reduce((s, r) => s + usageValOf(r), 0), lang());
        chart.setAttribute("aria-label",
            `${t("usage_history")} — ${locNum(rows.length, lang())} ${t("days")}, ${t("total")} ${locNum(total.value, lang())} ${total.unit}`);

        const first = dateOf(rows[0]);
        const last = dateOf(rows[rows.length - 1]);
        period.textContent = (!isNaN(first) && !isNaN(last))
            ? `${fmtDayMonth(first, lang())} – ${fmtDayMonth(last, lang())}`
            : "";

        wireChartTap(chart);
    }

    /**
     * Minimal tap-to-reveal readout for the usage chart bars. The native SVG
     * `<title>` already covers hover (desktop); on touch, hover barely fires,
     * so a tap on a bar flips up a small floating bubble with the same text
     * the `<title>` holds. Built from scratch — no tooltip library, no
     * persistent hover layer, no per-bar DOM nodes. One reused bubble, one
     * delegated listener, ~2s auto-hide. Re-wired on every render because
     * `renderChart` replaces chart.innerHTML; the listener is cheap.
     */
    function wireChartTap(chart) {
        const svg = chart.querySelector("svg.usage-svg");
        if (!svg) return;
        // One reused bubble, created on first tap.
        let bubble = null;
        let hideTimer = 0;
        const ensureBubble = () => {
            if (bubble) return bubble;
            bubble = document.createElement("div");
            bubble.className = "usage-readout";
            bubble.setAttribute("role", "status");
            bubble.setAttribute("aria-live", "polite");
            bubble.hidden = true;
            chart.appendChild(bubble);
            return bubble;
        };
        const show = (text, x, y) => {
            const b = ensureBubble();
            b.textContent = text;
            b.hidden = false;
            // Position relative to the chart box; clamp inside.
            const cw = chart.clientWidth || 1;
            const bw = b.offsetWidth || 0;
            const left = Math.max(0, Math.min(cw - bw, x - bw / 2));
            b.style.left = `${left}px`;
            b.style.bottom = "0.25rem";
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => { b.hidden = true; }, 2000);
        };
        const onPointer = (e) => {
            // Only react to touch-style taps here — mouse hover still uses the
            // native <title>. Treat pointer events of type "touch" as taps.
            if (e.pointerType === "mouse") return;
            const target = e.target.closest("rect");
            if (!target) return;
            const titleEl = target.querySelector("title");
            const text = titleEl ? titleEl.textContent : "";
            if (!text) return;
            const rect = target.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            show(text, cx - chart.getBoundingClientRect().left, rect.top);
        };
        svg.addEventListener("pointerdown", onPointer);
    }

    /** Project when the data limit will be hit from the recent daily average. */
    function renderForecast() {
        const box = $("#usage-forecast");
        const limit = ctx.dataLimit;
        const unlimited = !hasValue(ctx.limitRaw) || limit <= 0;
        const remaining = limit - ctx.usedTraffic;
        const inactive = deps.state !== "active";
        if (unlimited || remaining <= 0 || inactive || !history || !history.length) {
            setHidden(box, true);
            return;
        }
        const recent = history.slice().sort((a, b) => dateOf(a) - dateOf(b)).slice(-7);
        const avg = recent.reduce((s, r) => s + usageValOf(r), 0) / (recent.length || 1);
        if (avg <= 0) {
            setHidden(box, true);
            return;
        }
        const daysLeft = remaining / avg;
        const depleteAt = new Date(Date.now() + daysLeft * 86400000);
        const expiresFirst = hasValue(ctx.expireRaw) && ctx.expire * 1000 <= depleteAt.getTime();
        const days = Math.max(0, Math.ceil(daysLeft));
        $("#usage-forecast-text").innerHTML = expiresFirst
            ? escapeHtml(t("forecast_expire_first"))
            : `${escapeHtml(t("forecast_deplete"))} <strong class="text-base-content/80">${escapeHtml(fmtDayMonth(depleteAt, lang()))}</strong>` +
              ` · ${locNum(days, lang())} ${escapeHtml(days === 1 ? t("day") : t("days"))}`;
        setHidden(box, false);
    }

    function renderAlert() {
        const el = $("#usage-alert");
        const limit = ctx.dataLimit;
        if (!(limit > 0)) {
            setHidden(el, true);
            return;
        }
        const pct = ctx.usedTraffic / limit;
        let cls = "", key = "";
        if (pct >= 0.9) { cls = "bg-error/15 text-error"; key = "usage_alert_90"; }
        else if (pct >= 0.8) { cls = "bg-warning/15 text-warning"; key = "usage_alert_80"; }
        else if (pct >= 0.5) { cls = "bg-info/15 text-info"; key = "usage_alert_50"; }
        if (!key) {
            setHidden(el, true);
            return;
        }
        el.className = `rounded-xl px-3 py-2 text-[12px] font-semibold ${cls}`;
        el.textContent = t(key);
        setHidden(el, false);
    }

    /** Horizontal per-server bars (top 6 by traffic) with share of total. */
    function renderNodes() {
        const box = $("#usage-nodes");
        if (!nodes || !nodes.length) {
            setHidden(box, true);
            return;
        }
        const rows = nodes.slice().sort((a, b) => b.value - a.value).slice(0, 6);
        const max = Math.max(1, ...rows.map((r) => r.value));
        const total = nodes.reduce((s, r) => s + r.value, 0);
        box.innerHTML =
            `<p class="text-[11px] font-semibold uppercase tracking-wide text-base-content/50">${escapeHtml(t("usage_by_server"))}</p>` +
            rows.map((r) => {
                const f = fmtBytes(r.value, lang());
                const pct = total > 0 ? Math.round((r.value / total) * 100) : 0;
                const w = Math.max(3, Math.round((r.value / max) * 100));
                return `<div>` +
                    `<div class="flex items-baseline justify-between gap-2 text-[12px]">` +
                    `<span class="truncate font-medium" dir="auto" title="${escapeAttr(r.name)}">${escapeHtml(r.name)}</span>` +
                    `<span class="shrink-0 text-base-content/50">${locNum(f.value, lang())} ${f.unit} · ${locPct(pct, lang())}</span>` +
                    `</div>` +
                    `<div class="node-bar mt-1"><span style="width:${w}%"></span></div>` +
                    `</div>`;
            }).join("");
        setHidden(box, false);
    }

    function renderUpdated() {
        const el = $("#usage-updated");
        if (!updatedAt) {
            setHidden(el, true);
            return;
        }
        const d = new Date(updatedAt);
        el.textContent = `${t("usage_updated")} ${fmtDayMonth(d, lang())} ${fmtClock(d, lang())}` +
            (stale ? ` · ${t("usage_stale")}` : "");
        el.classList.toggle("text-warning", stale);
        setHidden(el, false);
    }

    /** Refresh every 5 minutes, but only while the tab is visible. */
    function startAutoRefresh() {
        if (!ctx.usageUrl) return;
        let last = Date.now();
        const tick = async () => {
            if (document.visibilityState !== "visible") return;
            if (Date.now() - last < REFRESH_MS) return;
            last = Date.now();
            await load();
            render();
        };
        setInterval(tick, 30 * 1000);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") tick();
        });
    }

    return {
        async start() {
            await load();
            render();
            wireRangePills();
            startAutoRefresh();
        },
        rerender: render,
    };
}
