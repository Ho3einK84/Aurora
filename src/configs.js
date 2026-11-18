/* ===========================================================================
   Aurora configs — parsing, labelling, search / protocol filter / country
   grouping / bulk selection, list rendering and keyboard navigation.
   =========================================================================== */

import {
    b64ToUtf8, escapeHtml, escapeAttr, generateWgConf,
    downloadTextFile, safeFileName, parseConfigMeta,
} from "./format.js";
import { locNum, locCountry } from "./i18n.js";
import { $, $$, setHidden, copyText, toast, flashCopied, flashCopyIcon, scrollTabIntoView } from "./ui.js";
import { storeGet, storeSet } from "./store.js";

// pongo2 (the panel's template engine) autoescapes {{ link }} even though
// the surrounding <script type="text/plain"> is raw text the browser never
// entity-decodes — reverse exactly the 5 chars its htmlEscapeReplacer
// touches so a config's `path=`/`host=` query params survive intact.
const HTML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** Undo pongo2's HTML-entity autoescaping of a raw config URI. */
export function decodeHtmlEntities(s) {
    return String(s).replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, (e) => HTML_ENTITIES[e]);
}

/** Parse the newline-separated links block, dropping script-bearing schemes and duplicate URIs. */
export function parseLinks(rawText) {
    const seen = new Set();
    const result = [];
    String(rawText || "")
        .split(/\r?\n/)
        .map((s) => decodeHtmlEntities(s.trim()))
        .filter((s) => {
            if (!s || !/^[a-z][a-z0-9+.-]*:/i.test(s)) return false;
            const scheme = s.slice(0, s.indexOf(":")).toLowerCase();
            return scheme !== "javascript" && scheme !== "data" && scheme !== "vbscript";
        })
        .forEach((s) => {
            if (!seen.has(s)) {
                seen.add(s);
                result.push(s);
            }
        });
    return result;
}

const PROTO_BADGES = {
    vmess: "VM", vless: "VL", trojan: "TR", ss: "SS", ssr: "SSR",
    hysteria: "HY", hysteria2: "HY2", hy2: "HY2", tuic: "TU",
    wireguard: "WG", awg: "AWG", amneziawg: "AWG",
    ssh: "SSH", socks: "SK", tg: "TG", mtproto: "MT",
};

const PROTO_TONES = {
    VLESS: "bg-primary/10 text-primary border-primary/20",
    VMESS: "bg-primary/10 text-primary border-primary/20",
    TROJAN: "bg-secondary/10 text-secondary border-secondary/20",
    HYSTERIA2: "bg-accent/10 text-accent border-accent/20",
    HY2: "bg-accent/10 text-accent border-accent/20",
    HYSTERIA: "bg-accent/10 text-accent border-accent/20",
    TUIC: "bg-accent/10 text-accent border-accent/20",
    WIREGUARD: "bg-success/10 text-success border-success/20",
    AMNEZIAWG: "bg-success/10 text-success border-success/20",
    AWG: "bg-success/10 text-success border-success/20",
    SS: "bg-warning/10 text-warning border-warning/20",
    SSR: "bg-warning/10 text-warning border-warning/20",
    SSH: "bg-warning/10 text-warning border-warning/20",
    TG: "bg-info/10 text-info border-info/20",
    MTPROTO: "bg-info/10 text-info border-info/20",
};

const protoTone = (proto) => PROTO_TONES[proto] || "bg-base-content/[0.06] text-base-content/75 border-base-content/12";

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
            const payload = uri.replace(/^vmess:\/\//i, "").split("#")[0].split("?")[0];
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
    const { t, lang, openQr } = deps;
    const seen = new Set();
    const links = [];
    (deps.links || []).forEach((link) => {
        if (link && !seen.has(link)) {
            seen.add(link);
            links.push(link);
        }
    });
    const rows = links.map((link, i) => ({
        link,
        i,
        name: configLabel(link) || `${t("config")} ${i + 1}`,
        badge: protocolBadge(link),
        proto: protocolOf(link),
        meta: parseConfigMeta(link),
    }));

    let search = "";
    let activeProto = "all";
    let selecting = false;
    let grouped = false;
    const selected = new Set();

    // Load persisted pinned config URIs
    const PIN_KEY = `aurora_pinned:${deps.username || ""}`;
    const pinned = new Set();
    try {
        const saved = JSON.parse(storeGet(PIN_KEY) || "[]");
        if (Array.isArray(saved)) saved.forEach((k) => pinned.add(String(k)));
    } catch (_) { /* ignore */ }

    const isPinned = (r) => pinned.has(r.link);
    const syncModalPinBtn = () => {
        const pinBtn = $("#cfg-modal-pin");
        if (!pinBtn || !activeModalRow) return;
        const on = isPinned(activeModalRow);
        pinBtn.setAttribute("aria-label", t(on ? "unpin" : "pin"));
        pinBtn.setAttribute("title", t(on ? "unpin" : "pin"));
        pinBtn.classList.toggle("text-primary", on);
        const icon = pinBtn.querySelector("i");
        if (icon) icon.className = `ph ${on ? "ph-push-pin-slash" : "ph-push-pin"} text-lg`;
    };
    const togglePin = (r) => {
        if (isPinned(r)) pinned.delete(r.link);
        else pinned.add(r.link);
        storeSet(PIN_KEY, JSON.stringify([...pinned]), { noCookie: true });
        syncModalPinBtn();
        renderList();
    };

    const listEl = $("#configs-list");
    const filtersEl = $("#config-filters");
    const selectionBar = $("#selection-bar");

    // Connection Details modal (#cfg-modal)
    let activeModalRow = null;
    const cfgModal = $("#cfg-modal");
    const canShare = typeof navigator.share === "function";
    if (cfgModal) {
        const closeBtn = $("#cfg-modal-close");
        const copyBtn = $("#cfg-modal-copy");
        const qrBtn = $("#cfg-modal-qr");
        const pinModalBtn = $("#cfg-modal-pin");
        const shareModalBtn = $("#cfg-modal-share");
        if (closeBtn) closeBtn.addEventListener("click", () => cfgModal.close());
        if (pinModalBtn) {
            pinModalBtn.addEventListener("click", () => {
                if (!activeModalRow) return;
                togglePin(activeModalRow);
            });
        }
        if (shareModalBtn) {
            setHidden(shareModalBtn, !canShare);
            if (canShare) {
                shareModalBtn.addEventListener("click", async () => {
                    if (!activeModalRow) return;
                    try {
                        await navigator.share({ title: activeModalRow.name, text: activeModalRow.link });
                    } catch (_) { /* user cancelled */ }
                });
            }
        }
        if (copyBtn) {
            copyBtn.addEventListener("click", async (e) => {
                if (!activeModalRow) return;
                if (await copyText(activeModalRow.link)) flashCopied(e.currentTarget, t);
            });
        }
        if (qrBtn) {
            qrBtn.addEventListener("click", () => {
                if (!activeModalRow) return;
                cfgModal.close();
                openQr(activeModalRow.name, activeModalRow.link);
            });
        }
    }

    function renderCfgModalBody(r) {
        const titleEl = $("#cfg-modal-title");
        const inner = titleEl && titleEl.querySelector("span");
        if (inner) inner.textContent = r.name;
        else if (titleEl) titleEl.textContent = r.name;
        syncModalPinBtn();
        const m = r.meta || {};
        const fields = [
            [t("cfg_protocol"), m.protocol, "ph-shield-check", false],
            [t("cfg_transport"), m.transport, "ph-arrows-left-right", false],
            [t("cfg_security"), m.security ? (m.flow ? `${m.security} (${m.flow})` : m.security) : "", "ph-lock-key", Boolean(m.flow)],
            [t("vpn_port"), m.port, "ph-plug", false],
            [t("vpn_server"), m.server, "ph-hard-drives", true],
            [t("cfg_sni"), m.sni || m.host, "ph-globe", true],
            [t("cfg_path"), m.path, "ph-folder-simple", true],
            [t("cfg_id"), m.id || m.pbk, "ph-key", true],
            [t("cfg_raw_uri"), r.link, "ph-link-simple", true],
        ].filter(([, val]) => Boolean(val));

        const compactIndices = fields.map((f, idx) => (f[3] ? -1 : idx)).filter((idx) => idx >= 0);
        if (compactIndices.length % 2 === 1) {
            fields[compactIndices[compactIndices.length - 1]][3] = true;
        }

        const fieldsEl = $("#cfg-modal-fields");
        fieldsEl.innerHTML = fields.map(([label, val, icon, full]) =>
            `<div class="sub-tile flex items-center gap-2 rounded-xl px-3 py-2${full ? " col-span-2" : ""}">` +
            `<i class="ph ${icon} shrink-0 text-base text-base-content/50"></i>` +
            `<div class="min-w-0 flex-1 text-start">` +
            `<p class="text-[11px] font-medium text-base-content/55">${escapeHtml(label)}</p>` +
            `<p class="truncate text-start font-mono text-[12px]"><span class="inline-block max-w-full truncate align-bottom" dir="ltr">${escapeHtml(val)}</span></p>` +
            `</div>` +
            `<button type="button" class="btn btn-circle btn-ghost btn-xs shrink-0" data-cfg-copy="${escapeAttr(val)}" aria-label="${escapeAttr(t("copy"))}" title="${escapeAttr(t("copy"))}">` +
            `<i class="ph ph-copy text-base"></i></button>` +
            `</div>`
        ).join("");

        $$("[data-cfg-copy]", fieldsEl).forEach((btn) => {
            btn.addEventListener("click", async () => {
                if (await copyText(btn.getAttribute("data-cfg-copy"))) {
                    toast(t("copied"));
                    flashCopyIcon(btn);
                }
            });
        });
    }

    function openCfgModal(r) {
        if (!cfgModal) return;
        activeModalRow = r;
        renderCfgModalBody(r);
        if (!cfgModal.open) cfgModal.showModal();
    }

    function normSearch(str) {
        return String(str || "")
            .toLowerCase()
            .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
            .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
            .replace(/ي/g, "ی")
            .replace(/ك/g, "ک");
    }

    const filtered = () => {
        const q = normSearch(search.trim());
        return rows
            .filter((r) => activeProto === "all" || r.proto === activeProto)
            .filter((r) => !q ||
                normSearch(r.name).includes(q) ||
                normSearch(r.proto).includes(q) ||
                normSearch(r.meta && r.meta.summary).includes(q) ||
                normSearch(r.link).includes(q))
            .sort((a, b) => {
                const pa = isPinned(a) ? 0 : 1;
                const pb = isPinned(b) ? 0 : 1;
                return pa !== pb ? pa - pb : a.i - b.i;
            });
    };

    function renderFilters(smooth = false) {
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
            `<button type="button" role="tab" class="filter-pill${val === activeProto ? " active" : ""}" ` +
            `aria-selected="${val === activeProto}" data-proto="${escapeAttr(val)}">${escapeHtml(label)}</button>`
        ).join("");
        $$(".filter-pill", filtersEl).forEach((btn) => {
            btn.addEventListener("click", () => {
                activeProto = btn.getAttribute("data-proto");
                renderFilters(true);
                renderList();
                updateSelectionBar();
            });
        });
        const activeBtn = filtersEl.querySelector(".filter-pill.active");
        if (activeBtn) scrollTabIntoView(filtersEl, activeBtn, smooth);
    }

    function emptyState(textKey, hintKey, withReset = false) {
        return `<div class="sub-tile rounded-xl px-6 py-8 text-center">` +
            `<i class="ph ph-tray mx-auto text-4xl text-base-content/30"></i>` +
            `<p class="mt-2.5 text-sm font-semibold">${escapeHtml(t(textKey))}</p>` +
            (hintKey ? `<p class="mt-1 text-xs text-base-content/55">${escapeHtml(t(hintKey))}</p>` : "") +
            (withReset
                ? `<button type="button" data-reset-filters class="btn btn-ghost btn-xs glass mt-3 gap-1.5 rounded-lg px-3 font-medium text-primary">` +
                  `<i class="ph ph-arrow-counter-clockwise text-sm"></i><span>${escapeHtml(t("reset_filters"))}</span></button>`
                : "") +
            `</div>`;
    }

    function buildRow(r) {
        const el = document.createElement("div");
        const pinActive = isPinned(r);
        el.className = "group sub-tile row-hover cfg-row cursor-pointer rounded-xl" + (pinActive ? " cfg-row-pinned" : "");
        el.tabIndex = 0;
        el.dataset.link = r.link;
        const isWg = r.proto === "WIREGUARD" || r.proto === "AMNEZIAWG" || r.proto === "AWG" ||
            /^(?:wireguard|amneziawg|awg):\/\//i.test(r.link) || /\.conf(?:[?#]|$)/i.test(r.link);
        const subline = (r.meta && r.meta.summary) || r.link;
        el.innerHTML =
            `<div class="flex items-center gap-2.5 p-2.5 sm:gap-3 sm:p-3">` +
            `<label class="cfg-check${selecting ? "" : " hidden"}">` +
            `<input type="checkbox" class="checkbox checkbox-sm checkbox-primary" ` +
            `aria-label="${escapeAttr(t("select_configs"))}"${selected.has(r.link) ? " checked" : ""} /></label>` +
            `<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-[11px] font-semibold ${protoTone(r.proto)}">${escapeHtml(r.badge)}</div>` +
            `<div class="min-w-0 flex-1 text-start">` +
            `<p class="flex items-center gap-1.5 text-sm font-medium">` +
            `<span class="truncate" dir="auto">${escapeHtml(r.name)}</span>` +
            (pinActive ? `<i class="ph ph-push-pin shrink-0 text-xs text-primary/80" aria-hidden="true"></i>` : "") +
            `</p>` +
            `<p class="truncate text-start font-mono text-[11px] text-base-content/55"><span class="inline-block max-w-full truncate align-bottom" dir="ltr">${escapeHtml(subline)}</span></p>` +
            `</div>` +
            `<div class="cfg-actions">` +
            `<button type="button" class="cfg-action cfg-action-desktop${pinActive ? " text-primary opacity-100" : ""}" data-act="pin" ` +
            `aria-label="${escapeAttr(t(pinActive ? "unpin" : "pin"))}" title="${escapeAttr(t(pinActive ? "unpin" : "pin"))}">` +
            `<i class="ph ${pinActive ? "ph-push-pin-slash" : "ph-push-pin"}"></i></button>` +
            (canShare
                ? `<button type="button" class="cfg-action cfg-action-desktop" data-act="share" aria-label="${escapeAttr(t("share"))}" title="${escapeAttr(t("share"))}">` +
                  `<i class="ph ph-share-network"></i></button>`
                : "") +
            (isWg
                ? `<button type="button" class="cfg-action" data-act="download" aria-label="${escapeAttr(t("download_conf"))}" title="${escapeAttr(t("download_conf"))}">` +
                  `<i class="ph ph-download-simple"></i></button>`
                : "") +
            `<button type="button" class="cfg-action" data-act="copy" aria-label="${escapeAttr(t("copy"))}" title="${escapeAttr(t("copy"))}">` +
            `<i class="ph ph-copy"></i></button>` +
            `<button type="button" class="cfg-action" data-act="qr" aria-label="${escapeAttr(t("qrcode"))}" title="${escapeAttr(t("qrcode"))}">` +
            `<i class="ph ph-qr-code"></i></button>` +
            `</div>` +
            `</div>`;

        el.querySelector('[data-act="pin"]').addEventListener("click", (e) => {
            e.stopPropagation();
            togglePin(r);
        });
        el.querySelector('[data-act="copy"]').addEventListener("click", async (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            if (await copyText(r.link)) {
                flashCopyIcon(btn);
                toast(t("copied"));
            }
        });
        const shareBtn = el.querySelector('[data-act="share"]');
        if (shareBtn) {
            shareBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                try {
                    await navigator.share({ title: r.name, text: r.link });
                } catch (_) { /* user cancelled — ignore */ }
            });
        }
        const dlBtn = el.querySelector('[data-act="download"]');
        if (dlBtn) {
            dlBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const fallbackName = /\/awg\/|\bawg\b|amnezia/i.test(r.link) ? "amneziawg" : "wireguard";
                if (/^https?:\/\//i.test(r.link) && /\.conf(?:[?#]|$)/i.test(r.link)) {
                    const a = document.createElement("a");
                    a.href = r.link;
                    a.download = safeFileName(r.name, fallbackName, ".conf");
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    toast(t("export_done"));
                    return;
                }
                const confText = generateWgConf(r.link);
                if (confText) {
                    downloadTextFile(confText, safeFileName(r.name, fallbackName, ".conf"));
                    toast(t("export_done"));
                } else {
                    toast(t("qr_error"));
                }
            });
        }
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
        // In selection mode, tapping anywhere on the row toggles it; otherwise opens details modal.
        el.addEventListener("click", (e) => {
            if (e.target.closest("button") || e.target.closest("input") || e.target.closest("label")) return;
            if (selecting) {
                cb.checked = !cb.checked;
                cb.dispatchEvent(new Event("change"));
            } else {
                openCfgModal(r);
            }
        });
        return el;
    }

    function renderList() {
        const isFiltered = Boolean(search.trim()) || activeProto !== "all";
        listEl.innerHTML = "";
        if (!rows.length) {
            $("#configs-count").textContent = locNum(0, lang());
            listEl.innerHTML = emptyState("no_configs", "no_configs_hint");
            return;
        }
        const visible = filtered();
        $("#configs-count").textContent = isFiltered
            ? `${locNum(visible.length, lang())} / ${locNum(rows.length, lang())}`
            : locNum(rows.length, lang());
        if (!visible.length) {
            listEl.innerHTML = emptyState("no_match", "", true);
            const resetBtn = listEl.querySelector("[data-reset-filters]");
            if (resetBtn) {
                resetBtn.addEventListener("click", () => {
                    search = "";
                    activeProto = "all";
                    const inp = $("#config-search");
                    if (inp) inp.value = "";
                    setHidden($("#config-search-clear"), true);
                    renderFilters();
                    renderList();
                    updateSelectionBar();
                });
            }
            return;
        }
        const frag = document.createDocumentFragment();
        if (grouped) {
            const groups = new Map();
            visible.forEach((r) => {
                const c = countryOf(r.name);
                const key = c ? c.code : "_other";
                if (!groups.has(key)) {
                    const dispName = c ? locCountry(c.code, c.name, lang()) : t("country_other");
                    groups.set(key, { flag: c ? c.flag : "🏳️", name: dispName, other: !c, items: [] });
                }
                groups.get(key).items.push(r);
            });
            [...groups.values()]
                .sort((a, b) => (a.other !== b.other ? (a.other ? 1 : -1) : b.items.length - a.items.length))
                .forEach((g) => {
                    const head = document.createElement("div");
                    head.className = "flex items-center gap-2 px-1 pt-1 text-xs font-medium text-base-content/60";
                    head.innerHTML =
                        `<span>${escapeHtml(g.flag)}</span><span dir="auto">${escapeHtml(g.name)}</span>` +
                        `<span class="text-[11px] tabular-nums text-base-content/45">${locNum(g.items.length, lang())}</span>`;
                    frag.appendChild(head);
                    g.items.forEach((r) => frag.appendChild(buildRow(r)));
                });
        } else {
            visible.forEach((r) => frag.appendChild(buildRow(r)));
        }
        listEl.appendChild(frag);
    }

    function updateSelectionBar() {
        setHidden(selectionBar, !selecting);
        $("#selection-count").textContent = locNum(selected.size, lang());
        $("#copy-selected").disabled = selected.size === 0;
        const toggleBtn = $("#select-all-toggle");
        if (toggleBtn) {
            const vis = filtered();
            const allSelected = vis.length > 0 && vis.every((r) => selected.has(r.link));
            toggleBtn.textContent = t(allSelected ? "deselect_all" : "select_all");
            toggleBtn.disabled = !vis.length;
        }
    }

    /* ---- toolbar wiring (once) ---- */

    // Debounce the search input so rapid typing fires one `renderList()`
    // after the user pauses (~180ms trailing) instead of one reflow per
    // keystroke.
    let searchTimer = 0;
    const SEARCH_DEBOUNCE_MS = 180;
    const scheduleSearchRender = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            renderList();
            updateSelectionBar();
        }, SEARCH_DEBOUNCE_MS);
    };

    const searchInput = $("#config-search");
    const searchClear = $("#config-search-clear");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            search = e.target.value || "";
            setHidden(searchClear, !search);
            scheduleSearchRender();
        });
        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && search) {
                e.stopPropagation();
                search = "";
                searchInput.value = "";
                setHidden(searchClear, true);
                clearTimeout(searchTimer);
                renderList();
                updateSelectionBar();
            }
        });
    }
    if (searchClear) {
        searchClear.addEventListener("click", () => {
            search = "";
            if (searchInput) { searchInput.value = ""; searchInput.focus(); }
            setHidden(searchClear, true);
            clearTimeout(searchTimer);
            renderList();
            updateSelectionBar();
        });
    }

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

    const selectAllBtn = $("#select-all-toggle");
    if (selectAllBtn) {
        selectAllBtn.addEventListener("click", () => {
            const vis = filtered();
            const allSelected = vis.length > 0 && vis.every((r) => selected.has(r.link));
            if (allSelected) vis.forEach((r) => selected.delete(r.link));
            else vis.forEach((r) => selected.add(r.link));
            renderList();
            updateSelectionBar();
        });
    }

    $("#copy-selected").addEventListener("click", async (e) => {
        if (!selected.size) return;
        const list = rows.filter((r) => selected.has(r.link)).map((r) => r.link);
        if (await copyText(list.join("\n"))) {
            flashCopied(e.currentTarget, t);
            toast(t("copied"));
        }
    });

    const sanitizeFilename = (name) => String(name || "").replace(/[/\\?%*:|"<>]+/g, "_").trim() || "aurora";

    $("#config-export").addEventListener("click", () => {
        if (!rows.length) return;
        const blob = new Blob([links.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${sanitizeFilename(deps.username)}-configs.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast(t("export_done"));
    });

    $("#config-export-json").addEventListener("click", () => {
        if (!rows.length) return;
        const data = rows.map((r) => ({ name: r.name, protocol: r.proto, link: r.link }));
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${sanitizeFilename(deps.username)}-configs.json`;
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
    setHidden($("#configs-toolbar"), disabled);
    ["#copy-all", "#config-group", "#config-select", "#config-export", "#config-export-json"].forEach((sel) => {
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
        if (cfgModal && cfgModal.open && activeModalRow) {
            renderCfgModalBody(activeModalRow);
        }
    }

    renderFilters();
    renderList();
    updateSelectionBar();
    return { rerender };
}
