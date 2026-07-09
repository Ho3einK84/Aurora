/* ===========================================================================
   Aurora configs — parsing, labelling, search / protocol filter / country
   grouping / bulk selection, list rendering and keyboard navigation.
   =========================================================================== */

import { b64ToUtf8, escapeHtml, escapeAttr } from "./format.js";
import { locNum } from "./i18n.js";
import { $, $$, setHidden, copyText, toast, flashCopied } from "./ui.js";

// pongo2 (the panel's template engine) autoescapes {{ link }} even though
// the surrounding <script type="text/plain"> is raw text the browser never
// entity-decodes — reverse exactly the 5 chars its htmlEscapeReplacer
// touches so a config's `path=`/`host=` query params survive intact.
const HTML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** Undo pongo2's HTML-entity autoescaping of a raw config URI. */
export function decodeHtmlEntities(s) {
    return String(s).replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, (e) => HTML_ENTITIES[e]);
}

/** Parse the newline-separated links block, dropping script-bearing schemes. */
export function parseLinks(rawText) {
    return String(rawText || "")
        .split(/\r?\n/)
        .map((s) => decodeHtmlEntities(s.trim()))
        .filter((s) => {
            if (!s || !/^[a-z][a-z0-9+.-]*:/i.test(s)) return false;
            const scheme = s.slice(0, s.indexOf(":")).toLowerCase();
            return scheme !== "javascript" && scheme !== "data" && scheme !== "vbscript";
        });
}

const PROTO_BADGES = {
    vmess: "VM", vless: "VL", trojan: "TR", ss: "SS", ssr: "SSR",
    hysteria: "HY", hysteria2: "HY2", hy2: "HY2", tuic: "TU",
    wireguard: "WG", socks: "SK",
};

/** Short badge for the tile ("VL", "TR", …). */
export function protocolBadge(uri) {
    const m = /^([a-z0-9+.-]+):/i.exec(uri);
    const p = (m ? m[1] : "?").toLowerCase();
    return PROTO_BADGES[p] || p.slice(0, 3).toUpperCase();
}

/** Full scheme in caps ("VLESS", "TROJAN", …) for the filter pills. */
export function protocolOf(uri) {
    const m = /^([a-z0-9+.-]+):/i.exec(uri);
    return m ? m[1].toUpperCase() : "OTHER";
}

/**
 * Friendly display name for a config URI. vmess:// carries base64 JSON whose
 * "ps" field is the name; everything else keeps a percent-encoded remark in
 * the URL fragment.
 */
export function configLabel(uri) {
    if (/^vmess:\/\//i.test(uri)) {
        try {
            const payload = uri.replace(/^vmess:\/\//i, "").split("#")[0];
            const json = JSON.parse(b64ToUtf8(payload));
            if (json && (json.ps || json.remark)) return String(json.ps || json.remark);
        } catch (_) { /* fall through to the fragment */ }
    }
    const hash = uri.split("#").slice(1).join("#");
    if (hash) {
        try { return decodeURIComponent(hash).trim(); }
        catch (_) { return hash; }
    }
    return "";
}

/* ------------------------------------------------------- country detection */

// ISO-3166 alpha-2 → display name for the common VPN-exit countries; anything
// unmatched lands in the pinned "Other" group.
const COUNTRIES = {
    US: "United States", GB: "United Kingdom", DE: "Germany", NL: "Netherlands",
    FR: "France", FI: "Finland", SE: "Sweden", NO: "Norway", DK: "Denmark",
    IE: "Ireland", IS: "Iceland", CH: "Switzerland", AT: "Austria", BE: "Belgium",
    IT: "Italy", ES: "Spain", PT: "Portugal", PL: "Poland", CZ: "Czechia",
    RO: "Romania", RU: "Russia", UA: "Ukraine", TR: "Turkey", AE: "United Arab Emirates",
    QA: "Qatar", SA: "Saudi Arabia", IR: "Iran", IN: "India", SG: "Singapore",
    JP: "Japan", KR: "South Korea", HK: "Hong Kong", TW: "Taiwan", CN: "China",
    AU: "Australia", CA: "Canada", BR: "Brazil", AM: "Armenia", AZ: "Azerbaijan",
    GE: "Georgia", KZ: "Kazakhstan", LT: "Lithuania", LV: "Latvia", EE: "Estonia",
};

// Name/alias needles → code, longest first so "Iran" can't shadow "Ireland".
const COUNTRY_NEEDLES = (() => {
    const extra = {
        "united states": "US", usa: "US", america: "US",
        "united kingdom": "GB", uk: "GB", england: "GB", britain: "GB",
        holland: "NL", deutschland: "DE", "türkiye": "TR", turkiye: "TR",
        "south korea": "KR", korea: "KR", "hong kong": "HK", emirates: "AE", uae: "AE",
    };
    const map = new Map();
    for (const [code, name] of Object.entries(COUNTRIES)) map.set(name.toLowerCase(), code);
    for (const [needle, code] of Object.entries(extra)) map.set(needle, code);
    return [...map.entries()].sort((a, b) => b[0].length - a[0].length);
})();

function codeFromFlag(str) {
    const cps = Array.from(String(str))
        .map((c) => c.codePointAt(0))
        .filter((cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff);
    if (cps.length < 2) return null;
    return String.fromCharCode(cps[0] - 0x1f1e6 + 65) + String.fromCharCode(cps[1] - 0x1f1e6 + 65);
}

const flagOf = (code) =>
    code.replace(/[A-Z]/g, (c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65));

/** Detect the server country from a remark: flag emoji first, then name/alias. */
export function countryOf(label) {
    const fromFlag = codeFromFlag(label);
    if (fromFlag) return { code: fromFlag, name: COUNTRIES[fromFlag] || fromFlag, flag: flagOf(fromFlag) };
    const low = String(label).toLowerCase();
    for (const [needle, code] of COUNTRY_NEEDLES) {
        const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp("(^|[^a-z])" + esc + "([^a-z]|$)", "i").test(low)) {
            return { code, name: COUNTRIES[code] || code, flag: flagOf(code) };
        }
    }
    return null;
}

/* -------------------------------------------------------------- list view */

/**
 * Mount the configs section. `deps`:
 *   links: string[] — raw config URIs
 *   t(key), lang() — i18n accessors
 *   openQr(title, text) — QR modal service
 * Returns { rerender } for language switches.
 */
export function mountConfigs(deps) {
    const { links, t, lang, openQr } = deps;
    const rows = links.map((link, i) => ({
        link,
        i,
        name: configLabel(link) || `${t("config")} ${i + 1}`,
        badge: protocolBadge(link),
        proto: protocolOf(link),
    }));

    let search = "";
    let activeProto = "all";
    let selecting = false;
    let grouped = false;
    const selected = new Set();

    const listEl = $("#configs-list");
    const filtersEl = $("#config-filters");
    const selectionBar = $("#selection-bar");

    const filtered = () => {
        const q = search.trim().toLowerCase();
        return rows
            .filter((r) => activeProto === "all" || r.proto === activeProto)
            .filter((r) => !q ||
                r.name.toLowerCase().includes(q) ||
                r.proto.toLowerCase().includes(q) ||
                r.link.toLowerCase().includes(q));
    };

    function renderFilters() {
        const protos = [...new Set(rows.map((r) => r.proto))];
        if (protos.length <= 1) {
            filtersEl.innerHTML = "";
            setHidden(filtersEl, true);
            return;
        }
        setHidden(filtersEl, false);
        if (activeProto !== "all" && !protos.includes(activeProto)) activeProto = "all";
        const pills = [["all", t("filter_all")], ...protos.map((p) => [p, p])];
        filtersEl.innerHTML = pills.map(([val, label]) =>
            `<button role="tab" class="filter-pill${val === activeProto ? " active" : ""}" ` +
            `aria-selected="${val === activeProto}" data-proto="${escapeAttr(val)}">${escapeHtml(label)}</button>`
        ).join("");
        $$(".filter-pill", filtersEl).forEach((btn) => {
            btn.addEventListener("click", () => {
                activeProto = btn.getAttribute("data-proto");
                renderFilters();
                renderList();
            });
        });
    }

    function emptyState(textKey, hintKey) {
        return `<div class="card glass rounded-2xl border-0 p-10 text-center">
            <i class="ph ph-tray mx-auto text-5xl text-base-content/30"></i>
            <p class="mt-3 font-semibold">${escapeHtml(t(textKey))}</p>
            ${hintKey ? `<p class="mt-1 text-sm text-base-content/50">${escapeHtml(t(hintKey))}</p>` : ""}
        </div>`;
    }

    function buildRow(r) {
        const el = document.createElement("div");
        el.className = "group card glass lift cfg-row rounded-2xl border-0";
        el.tabIndex = 0;
        el.dataset.link = r.link;
        el.innerHTML =
            `<div class="flex items-center gap-3 p-3">` +
            `<label class="cfg-check${selecting ? "" : " hidden"}">` +
            `<input type="checkbox" class="checkbox checkbox-sm checkbox-primary" ` +
            `aria-label="${escapeAttr(t("select_configs"))}"${selected.has(r.link) ? " checked" : ""} /></label>` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 text-xs font-bold text-primary">${escapeHtml(r.badge)}</div>` +
            `<div class="min-w-0 flex-1">` +
            `<p class="truncate text-sm font-semibold" dir="auto">${escapeHtml(r.name)}</p>` +
            `<p class="truncate text-start font-mono text-[11px] text-base-content/40" dir="ltr">${escapeHtml(r.link)}</p>` +
            `</div>` +
            `<button class="btn btn-circle btn-ghost btn-sm" data-act="copy" aria-label="${escapeAttr(t("copy"))}">` +
            `<i class="ph ph-copy text-lg"></i></button>` +
            `<button class="btn btn-circle btn-ghost btn-sm" data-act="qr" aria-label="${escapeAttr(t("qrcode"))}">` +
            `<i class="ph ph-qr-code text-lg"></i></button>` +
            `</div>`;

        el.querySelector('[data-act="copy"]').addEventListener("click", async (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            const icon = btn.querySelector("i");
            if (await copyText(r.link)) {
                icon.className = "ph ph-check text-lg text-success";
                setTimeout(() => { icon.className = "ph ph-copy text-lg"; }, 1600);
            }
        });
        el.querySelector('[data-act="qr"]').addEventListener("click", (e) => {
            e.stopPropagation();
            openQr(r.name, r.link);
        });
        const cb = el.querySelector("input[type=checkbox]");
        cb.addEventListener("change", () => {
            if (cb.checked) selected.add(r.link);
            else selected.delete(r.link);
            updateSelectionBar();
        });
        // In selection mode, tapping anywhere on the row toggles it.
        el.addEventListener("click", (e) => {
            if (!selecting || e.target.closest("button") || e.target.closest("input")) return;
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event("change"));
        });
        return el;
    }

    function renderList() {
        $("#configs-count").textContent = locNum(rows.length, lang());
        listEl.innerHTML = "";
        if (!rows.length) {
            listEl.innerHTML = emptyState("no_configs", "no_configs_hint");
            return;
        }
        const visible = filtered();
        if (!visible.length) {
            listEl.innerHTML = emptyState("no_match");
            return;
        }
        if (grouped) {
            const groups = new Map();
            visible.forEach((r) => {
                const c = countryOf(r.name);
                const key = c ? c.code : "_other";
                if (!groups.has(key)) {
                    groups.set(key, { flag: c ? c.flag : "🏳️", name: c ? c.name : t("country_other"), other: !c, items: [] });
                }
                groups.get(key).items.push(r);
            });
            [...groups.values()]
                .sort((a, b) => (a.other !== b.other ? (a.other ? 1 : -1) : b.items.length - a.items.length))
                .forEach((g) => {
                    const head = document.createElement("div");
                    head.className = "flex items-center gap-2 px-1 pt-1 text-[12px] font-semibold text-base-content/60";
                    head.innerHTML =
                        `<span>${escapeHtml(g.flag)}</span><span dir="auto">${escapeHtml(g.name)}</span>` +
                        `<span class="badge badge-xs badge-ghost">${locNum(g.items.length, lang())}</span>`;
                    listEl.appendChild(head);
                    g.items.forEach((r) => listEl.appendChild(buildRow(r)));
                });
        } else {
            visible.forEach((r) => listEl.appendChild(buildRow(r)));
        }
    }

    function updateSelectionBar() {
        setHidden(selectionBar, !selecting);
        $("#selection-count").textContent = locNum(selected.size, lang());
        $("#copy-selected").disabled = selected.size === 0;
    }

    /* ---- toolbar wiring (once) ---- */

    $("#config-search").addEventListener("input", (e) => {
        search = e.target.value || "";
        renderList();
    });

    $("#config-group").addEventListener("click", (e) => {
        grouped = !grouped;
        e.currentTarget.setAttribute("aria-pressed", String(grouped));
        e.currentTarget.classList.toggle("tool-active", grouped);
        renderList();
    });

    $("#config-select").addEventListener("click", (e) => {
        selecting = !selecting;
        if (!selecting) selected.clear();
        e.currentTarget.setAttribute("aria-pressed", String(selecting));
        e.currentTarget.classList.toggle("tool-active", selecting);
        renderList();
        updateSelectionBar();
    });

    $("#copy-selected").addEventListener("click", async () => {
        if (!selected.size) return;
        // Preserve original order rather than insertion order.
        const list = rows.filter((r) => selected.has(r.link)).map((r) => r.link);
        if (await copyText(list.join("\n"))) toast(t("copied"));
    });

    $("#config-export").addEventListener("click", () => {
        if (!rows.length) return;
        const blob = new Blob([links.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = (deps.username || "aurora").replace(/[^a-z0-9_-]+/gi, "_") + "-configs.txt";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast(t("export_done"));
    });

    // Keyboard navigation: ↑/↓ move, Enter copies, Space opens the QR.
    listEl.addEventListener("keydown", (e) => {
        const items = $$(".cfg-row", listEl);
        if (!items.length) return;
        const idx = items.indexOf(document.activeElement);
        if (e.key === "ArrowDown") {
            e.preventDefault();
            items[idx < 0 ? 0 : Math.min(items.length - 1, idx + 1)].focus();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            items[idx <= 0 ? 0 : idx - 1].focus();
        } else if (idx >= 0 && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            const link = document.activeElement.dataset.link;
            const row = rows.find((r) => r.link === link);
            if (!row) return;
            if (e.key === "Enter") {
                copyText(link).then((ok) => { if (ok) toast(t("copied")); });
            } else {
                openQr(row.name, link);
            }
        }
    });

    // Bulk buttons live in app.js scope but need row state → expose them here.
    $("#copy-all").addEventListener("click", async (e) => {
        if (!links.length) return;
        if (await copyText(links.join("\n"))) flashCopied(e.currentTarget, t);
    });

    // Ctrl/Cmd+Shift+C copies everything from anywhere on the page.
    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") {
            if (!links.length) return;
            e.preventDefault();
            copyText(links.join("\n")).then((ok) => { if (ok) toast(t("copied")); });
        }
    });

    const disabled = !rows.length;
    ["#copy-all", "#config-group", "#config-select", "#config-export"].forEach((sel) => {
        const el = $(sel);
        if (el) el.disabled = disabled;
    });

    function rerender() {
        // Refresh generated fallback labels for the new language.
        rows.forEach((r) => {
            r.name = configLabel(r.link) || `${t("config")} ${r.i + 1}`;
        });
        renderFilters();
        renderList();
        updateSelectionBar();
    }

    renderFilters();
    renderList();
    updateSelectionBar();
    return { rerender };
}
