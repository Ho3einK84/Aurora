#!/usr/bin/env node
/* ===========================================================================
   Local preview for dist/index.html (DEV ONLY — never part of the bundle).

   Rebecca renders the template through pongo2 at request time; this emulates
   exactly the directives Aurora uses, with sample data, so the built page is
   viewable in a normal browser:

     node scripts/serve.mjs                      active user on :8787
     STATE=expired node scripts/serve.mjs        other states
     open http://localhost:8787/?state=limited&lang=fa&theme=nord&brand=Nimbus

   States: active | limited | expired | disabled | on_hold | unlimited | forever | empty
   The /usage route serves a sample 30-day history (USAGE=json|html|empty)
   so the dashboard, tooltips, forecast and alerts are all exercisable.
   =========================================================================== */

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "index.html");
const PORT = Number(process.env.PORT || 8787);
const STATE = process.env.STATE || "active";
const USAGE = process.env.USAGE || "json";

const GB = 1024 ** 3;
const DAY = 86400;

const SAMPLE_LINKS = [
    "vless://11111111-2222-3333-4444-555555555555@example.com:443?type=ws&security=tls&path=%2Faurora#Aurora%20Germany%20%F0%9F%87%A9%F0%9F%87%AA",
    "vmess://eyJ2IjoiMiIsInBzIjoiQXVyb3JhIEZpbmxhbmQg8J+Hq/Cfh64iLCJhZGQiOiJleGFtcGxlLmNvbSIsInBvcnQiOiI0NDMifQ==",
    "trojan://password123@example.com:443?security=tls&type=grpc#Aurora%20Netherlands",
    "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@example.com:8388#Aurora%20France",
    "vless://99999999-8888-7777-6666-555555555555@example.de:8443?security=reality#Frankfurt%20DE%20%F0%9F%87%A9%F0%9F%87%AA",
];

function ctxFor(state, brand) {
    const now = Math.floor(Date.now() / 1000);
    const base = {
        "user.username": "alice_wonder",
        "user.status": "active",
        "user.status_class": "active",
        "user.data_limit": String(50 * GB),
        "user.data_limit_reset_strategy": "month",
        "user.used_traffic": String(Math.floor(21.4 * GB)),
        "user.expire": String(now + 18 * DAY),
        "user.online_count": "3",
        "user.service_name": "Nebula 50GB",
        remaining_days: "18",
        "user.subscription_url": `http://localhost:${PORT}/sub/alice`,
        usage_url: `http://localhost:${PORT}/usage`,
        support_url: "https://t.me/support",
        brand_name: brand || "",
    };
    switch (state) {
        case "expired":
            base["user.status"] = "expired";
            base["user.status_class"] = "expired";
            base["user.expire"] = String(now - 3 * DAY);
            base.remaining_days = "0";
            break;
        case "limited":
            base["user.status"] = "limited";
            base["user.status_class"] = "limited";
            base["user.used_traffic"] = String(50 * GB);
            break;
        case "disabled":
            base["user.status"] = "disabled";
            base["user.status_class"] = "disabled";
            break;
        case "on_hold":
            base["user.status"] = "on_hold";
            base["user.status_class"] = "on_hold";
            base["user.expire"] = "0";
            break;
        case "unlimited":
            base["user.data_limit"] = "0";
            base["user.data_limit_reset_strategy"] = "no_reset";
            break;
        case "forever":
            base["user.expire"] = "0";
            base.remaining_days = "0";
            break;
    }
    return base;
}

/** 30 days shaped like Rebecca's real payload (usages + node_usages). */
function sampleUsage() {
    const usages = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 30; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const base = 0.3 + Math.abs(Math.sin(i * 0.7)) * 1.6;
        usages.push({
            date: d.toISOString().slice(0, 10),
            used_traffic: i % 9 === 0 ? 0 : Math.floor(base * GB),
        });
    }
    return {
        usages,
        hourly_usages: [],
        node_usages: [
            { node_id: 10, node_name: "DE 🇩🇪 Frankfurt", uplink: 0, downlink: 7449106461 },
            { node_id: 12, node_name: "FI 🇫🇮 Helsinki", uplink: 0, downlink: 2099268800 },
            { node_id: 14, node_name: "NL 🇳🇱 Amsterdam", uplink: 0, downlink: 449106461 },
        ],
        username: "alice_wonder",
    };
}

function usageResponse(res, mode) {
    if (mode === "empty") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ usages: [], node_usages: [], hourly_usages: [] }));
        return;
    }
    if (mode === "html") {
        // Emulates Rebecca answering with an HTML panel page embedding the JSON
        // (exercises the scrape fallback).
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
            `<!doctype html><html><head><title>Usage</title></head><body><h1>Usage</h1>` +
            `<script type="application/json" id="usage-data">${JSON.stringify(sampleUsage())}</script>` +
            `</body></html>`
        );
        return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(sampleUsage()));
}

/** Minimal pongo2 emulation for exactly the directives Aurora uses. */
function render(html, ctx, links) {
    html = html.replace(
        /\{%\s*for\s+link\s+in\s+links\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/g,
        (_, body) => links.map((l) => body.replace(/\{\{\s*link\s*\}\}/g, l)).join("")
    );
    return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => (ctx[key] != null ? ctx[key] : ""));
}

createServer(async (req, res) => {
    try {
        const url = new URL(req.url, "http://x");
        if (url.pathname === "/usage") {
            usageResponse(res, url.searchParams.get("mode") || USAGE);
            return;
        }
        const tpl = await readFile(OUT, "utf8");
        const state = url.searchParams.get("state") || STATE;
        const links = state === "empty" ? [] : SAMPLE_LINKS;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(render(tpl, ctxFor(state, url.searchParams.get("brand")), links));
    } catch (e) {
        res.writeHead(500);
        res.end(String(e));
    }
}).listen(PORT, () => {
    console.log(`Aurora preview → http://localhost:${PORT}  (state=${STATE}, usage=${USAGE})`);
    console.log("Try ?state=expired|limited|disabled|on_hold|unlimited|forever|empty · ?lang=fa · ?theme=nord · ?brand=Nimbus");
});
