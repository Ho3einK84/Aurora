#!/usr/bin/env node
/* ===========================================================================
   Local preview for dist/index.html (DEV ONLY — never part of the bundle).

   Rebecca renders the template through pongo2 at request time; this emulates
   exactly the directives Aurora uses, with sample data, so the built page is
   viewable in a normal browser:

     node scripts/serve.mjs                      active user on :8787
     STATE=expired node scripts/serve.mjs        other states
     open http://localhost:8787/?state=limited&lang=fa&theme=rebecca&brand=Nimbus

   States: active | limited | expired | disabled | on_hold | unlimited | forever | empty
   The /usage route serves a sample 30-day history (USAGE=json|html|empty)
   so the dashboard, tooltips, forecast and alerts are all exercisable.
   The /sub/alice/info route mirrors Rebecca dev's finalized subscription info
   payload (openvpn.downloads + l2tp + pptp; INFO=json|empty|off) and
   /sub/alice/ov/*.ovpn serves a sample profile, so the OpenVPN files card is
   fully exercisable too. ?title=YourBrand emulates the panel's "Subscription
   profile title" setting once Rebecca wires it into the pongo2 context.
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
const INFO = process.env.INFO || "json";
const PUSH = process.env.PUSH || "on";

// Valid uncompressed P-256 test VAPID public key (65 bytes, base64url) for local dev preview.
const MOCK_VAPID_PUBLIC_KEY =
    "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

const MOCK_SW_SCRIPT =
    "self.addEventListener('install', function () { self.skipWaiting(); });\n" +
    "self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });\n" +
    "self.addEventListener('push', function (e) {\n" +
    "  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) {}\n" +
    "  e.waitUntil(self.registration.showNotification(d.title || 'Rebecca', { body: d.body || '', dir: d.dir, lang: d.lang }));\n" +
    "});\n";

const mockPushState = {
    mode: PUSH,
    subs: new Map(), // endpoint -> { lang, page_url, keys }
    alerts: { usage_80: true, usage_95: false, expiry_24h: true, limited: true, expired: true },
    forceTestStatus: 0,
    forcePrefsStatus: 0,
};

function readJsonBody(req) {
    return new Promise((resolve) => {
        let raw = "";
        req.on("data", (c) => { raw += c; });
        req.on("end", () => {
            try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); }
        });
    });
}

function pushStatusPayload(endpoint) {
    const ep = String(endpoint || "").trim();
    const rec = ep ? mockPushState.subs.get(ep) : null;
    return {
        subscribed: Boolean(rec),
        devices: mockPushState.subs.size,
        alerts: { ...mockPushState.alerts },
        lang: (rec && rec.lang) || "en",
    };
}

const GB = 1024 ** 3;
const DAY = 86400;

const SAMPLE_LINKS = [
    "vless://11111111-2222-3333-4444-555555555555@example.com:443?type=ws&security=tls&path=%2Frebecca#Rebecca%20Germany%20%F0%9F%87%A9%F0%9F%87%AA",
    "vmess://eyJ2IjoiMiIsInBzIjoiUmViZWNjYSBGaW5sYW5kIPCfh6vwn4euIiwiYWRkIjoiZXhhbXBsZS5jb20iLCJwb3J0IjoiNDQzIn0=",
    "trojan://password123@example.com:443?security=tls&type=grpc#Rebecca%20Netherlands",
    "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@example.com:8388#Rebecca%20France",
    "vless://99999999-8888-7777-6666-555555555555@example.de:8443?security=reality#Frankfurt%20DE%20%F0%9F%87%A9%F0%9F%87%AA",
    "ssh://alice:s3cr3t-ssh-pass@de.example.com:22#Rebecca%20Germany%20%F0%9F%87%A9%F0%9F%87%AA%20SSH",
    "awg://aGVsbG8td29ybGQ=@de.example.com:51821?address=10.0.1.2%2F32&publickey=serverAwgPubkey123%3D#Rebecca%20Germany%20%F0%9F%87%A9%F0%9F%87%AA%20AWG",
    "tg://proxy?server=tg.example.com&port=443&secret=ee112233445566778899aabbccddeeff11676f6f676c652e636f6d#Rebecca%20Telegram%20Proxy",
];

// Rebecca dev appends profile download links to the links list.
const OV_DOWNLOADS = (port) => [
    `http://localhost:${port}/sub/alice/ov/Rebecca-Germany-OV.ovpn`,
    `http://localhost:${port}/sub/alice/ov/Rebecca-Finland-OV.ovpn`,
];

const AWG_DOWNLOADS = (port) => [
    `http://localhost:${port}/sub/alice/awg/Rebecca-Germany-AWG.conf`,
];

/**
 * Shaped like Rebecca dev's GET {sub}/info payload (user + openvpn/l2tp/pptp),
 * finalized schema as of commit 4579d6d: `openvpn` (not `ov`) plus the richer
 * L2TP/PPTP fields (host_name, address, port, ike_port, natt_port, tunnel_port).
 */
function sampleInfo(port) {
    return {
        user: {
            username: "alice_wonder",
            ip_limit: 3,
            lifetime_used_traffic: Math.floor(84.2 * GB),
            on_hold_expire_duration: 30 * DAY,
            next_plans: [
                { data_limit: 50 * GB, expire_duration: 30 * DAY },
            ],
        },
        openvpn: { downloads: OV_DOWNLOADS(port) },
        l2tp: [
            {
                host_tag: "Rebecca-Germany-L2TP",
                host_name: "Rebecca Germany 🇩🇪 L2TP",
                inbound_tag: "l2tp-de",
                remark: "Rebecca Germany 🇩🇪 L2TP",
                server: "de.example.com",
                address: "de.example.com",
                port: 1701,
                ike_port: 500,
                natt_port: 4500,
                tunnel_port: 1702,
                username: "alice_wonder",
                password: "s3cr3t-l2tp-pass",
                ipsec_psk: "rebecca-shared-key",
            },
            {
                host_tag: "Rebecca-Finland-L2TP",
                host_name: "Rebecca Finland 🇫🇮 L2TP",
                inbound_tag: "l2tp-fi",
                remark: "Rebecca Finland 🇫🇮 L2TP",
                server: "fi.example.com",
                address: "fi.example.com",
                port: 1701,
                ike_port: 500,
                natt_port: 4500,
                tunnel_port: 1702,
                username: "alice_wonder",
                password: "s3cr3t-l2tp-pass",
                ipsec_psk: "rebecca-shared-key",
            },
        ],
        pptp: [
            {
                host_tag: "Rebecca-Germany-PPTP",
                host_name: "Rebecca Germany 🇩🇪 PPTP",
                inbound_tag: "pptp-de",
                remark: "Rebecca Germany 🇩🇪 PPTP",
                server: "de.example.com",
                address: "de.example.com",
                port: 1723,
                username: "alice_wonder",
                password: "s3cr3t-pptp-pass",
            },
        ],
        wireguard: {
            downloads: [`http://localhost:${port}/sub/alice/wg/Rebecca-Germany-WG.conf`],
            links: [
                "wireguard://aGVsbG8td29ybGQ=@de.example.com:51820?address=10.0.0.2%2F32&publickey=serverPubkey123%3D#Rebecca%20Germany%20%F0%9F%87%A9%F0%9F%87%AA%20WG",
            ],
            profiles: [
                {
                    host_tag: "Rebecca-Germany-WG",
                    host_name: "Rebecca Germany 🇩🇪 WG",
                    inbound_tag: "wg-de",
                    remark: "Rebecca Germany 🇩🇪 WireGuard",
                    filename: "Rebecca-Germany-WG.conf",
                    download_url: `http://localhost:${port}/sub/alice/wg/Rebecca-Germany-WG.conf`,
                    link: "wireguard://aGVsbG8td29ybGQ=@de.example.com:51820?address=10.0.0.2%2F32&publickey=serverPubkey123%3D#Rebecca%20Germany%20%F0%9F%87%A9%F0%9F%87%AA%20WG",
                    body: "[Interface]\nPrivateKey = aGVsbG8td29ybGQ=\nAddress = 10.0.0.2/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = serverPubkey123=\nEndpoint = de.example.com:51820\nAllowedIPs = 0.0.0.0/0",
                    server: "de.example.com",
                    address: "de.example.com",
                    port: 51820,
                    client_address: "10.0.0.2/32",
                    client_public_key: "clientPubkey456=",
                    server_public_key: "serverPubkey123=",
                },
            ],
        },
        ikev2: [
            {
                host_tag: "Rebecca-Germany-IKEv2",
                host_name: "Rebecca Germany 🇩🇪 IKEv2",
                inbound_tag: "ikev2-de",
                remark: "Rebecca Germany 🇩🇪 IKEv2",
                server: "de.example.com",
                address: "de.example.com",
                port: 500,
                protocol: "ikev2",
                auth_mode: "password",
                username: "alice_wonder",
                password: "s3cr3t-ikev2-pass",
                dns: ["1.1.1.1", "8.8.8.8"],
            },
            {
                host_tag: "Rebecca-Finland-IKEv2-Cert",
                host_name: "Rebecca Finland 🇫🇮 IKEv2 (Cert)",
                inbound_tag: "ikev2-fi-cert",
                remark: "Rebecca Finland 🇫🇮 IKEv2 (Cert)",
                server: "fi.example.com",
                address: "fi.example.com",
                port: 500,
                protocol: "ikev2",
                auth_mode: "certificate",
                dns: ["1.1.1.1"],
            },
        ],
        anyconnect: [
            {
                host_tag: "Rebecca-Germany-AnyConnect",
                host_name: "Rebecca Germany 🇩🇪 AnyConnect",
                inbound_tag: "anyconnect-de",
                remark: "Rebecca Germany 🇩🇪 AnyConnect",
                server: "de.example.com",
                address: "de.example.com",
                port: 443,
                protocol: "anyconnect",
                auth_mode: "password",
                username: "alice_wonder",
                password: "s3cr3t-anyconnect-pass",
                dns: ["1.1.1.1", "8.8.8.8"],
            },
        ],
        amneziawg: {
            downloads: AWG_DOWNLOADS(port),
            links: [
                "awg://aGVsbG8td29ybGQ=@de.example.com:51821?address=10.0.1.2%2F32&publickey=serverAwgPubkey123%3D#Rebecca%20Germany%20%F0%9F%87%A9%F0%9F%87%AA%20AWG",
            ],
            profiles: [
                {
                    host_tag: "Rebecca-Germany-AWG",
                    host_name: "Rebecca Germany 🇩🇪 AWG",
                    inbound_tag: "awg-de",
                    remark: "Rebecca Germany 🇩🇪 AmneziaWG",
                    filename: "Rebecca-Germany-AWG.conf",
                    download_url: `http://localhost:${port}/sub/alice/awg/Rebecca-Germany-AWG.conf`,
                    link: "awg://aGVsbG8td29ybGQ=@de.example.com:51821?address=10.0.1.2%2F32&publickey=serverAwgPubkey123%3D#Rebecca%20Germany%20%F0%9F%87%A9%F0%9F%87%AA%20AWG",
                    body: "[Interface]\nPrivateKey = aGVsbG8td29ybGQ=\nAddress = 10.0.1.2/32\nDNS = 1.1.1.1\nJc = 4\nJmin = 50\nJmax = 1000\nS1 = 15\nS2 = 20\nH1 = 1\nH2 = 2\nH3 = 3\nH4 = 4\n\n[Peer]\nPublicKey = serverAwgPubkey123=\nEndpoint = de.example.com:51821\nAllowedIPs = 0.0.0.0/0\nPersistentKeepalive = 25",
                    server: "de.example.com",
                    address: "de.example.com",
                    port: 51821,
                    client_address: "10.0.1.2/32",
                    client_public_key: "clientAwgPubkey456=",
                    server_public_key: "serverAwgPubkey123=",
                },
            ],
        },
        sstp: [
            {
                host_tag: "Rebecca-Germany-SSTP",
                host_name: "Rebecca Germany 🇩🇪 SSTP",
                inbound_tag: "sstp-de",
                remark: "Rebecca Germany 🇩🇪 SSTP",
                server: "de.example.com",
                address: "de.example.com",
                port: 444,
                protocol: "sstp",
                auth_mode: "password",
                username: "alice_wonder",
                password: "s3cr3t-sstp-pass",
                dns: ["1.1.1.1", "8.8.8.8"],
                mtu: "1452",
            },
        ],
        gre: [
            {
                host_tag: "Rebecca-Germany-GRE",
                host_name: "Rebecca Germany 🇩🇪 GRE",
                inbound_tag: "gre-de",
                remark: "Rebecca Germany 🇩🇪 GRE Tunnel",
                server: "de.example.com",
                address: "de.example.com",
                port: 0,
                protocol: "gre",
                auth_mode: "none",
                client_address: "10.10.10.2/30",
                server_address: "10.10.10.1/30",
                dns: ["1.1.1.1"],
                mtu: "1476",
                ttl: "64",
            },
        ],
    };
}

const SAMPLE_OVPN = [
    "client", "dev tun", "proto udp", "remote de.example.com 1194",
    "resolv-retry infinite", "nobind", "persist-key", "persist-tun",
    "remote-cert-tls server", "auth-nocache", "verb 3", "auth-user-pass",
].join("\n") + "\n";

function ctxFor(state, brand, profileTitle, pushMode) {
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
        "user.online_at": new Date(Date.now() - 2 * 60_000).toISOString(),
        "user.created_at": new Date(Date.now() - 240 * 86400_000).toISOString(),
        "user.service_name": "Pro 50GB",
        remaining_days: "18",
        "user.subscription_url": `http://localhost:${PORT}/sub/alice`,
        usage_url: `/usage`,
        support_url: "https://t.me/support",
        brand_name: brand || "",
        // Not yet populated by Rebecca's real pongo2 context — exercised here
        // so Aurora is ready the day the panel wires "Subscription profile
        // title" into it.
        subscription_profile_title: profileTitle || "",
    };
    if (pushMode === "on") {
        base.web_push_public_key = MOCK_VAPID_PUBLIC_KEY;
        base.web_push_base_url = "/sub/alice/push";
        base.web_push_sw_url = "/sub/alice/push/sw.js";
        base.web_push_manifest_url = "/sub/alice/push/manifest.webmanifest";
    } else if (pushMode === "off") {
        // Exact Rebecca PR #228 disabled-toggle context: empty public key, non-empty paths.
        base.web_push_public_key = "";
        base.web_push_base_url = "/sub/alice/push";
        base.web_push_sw_url = "/sub/alice/push/sw.js";
        base.web_push_manifest_url = "/sub/alice/push/manifest.webmanifest";
    }
    // pushMode === "legacy": omit all web_push_* keys (exact pre-PR Rebecca behavior).
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
            base["user.online_at"] = "";
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

/** 90 days + 24 hours shaped like Rebecca's real payload (usages + hourly_usages + node_usages). */
function sampleUsage() {
    const usages = [];
    const hourly_usages = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 90; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const base = 0.3 + Math.abs(Math.sin(i * 0.7)) * 1.6;
        usages.push({
            date: d.toISOString().slice(0, 10),
            used_traffic: i % 9 === 0 ? 0 : Math.floor(base * GB),
        });
    }
    const nowHour = new Date();
    nowHour.setMinutes(0, 0, 0);
    for (let h = 23; h >= 0; h--) {
        const hd = new Date(nowHour.getTime() - h * 3600_000);
        const hBase = 0.02 + Math.abs(Math.cos(h * 0.5)) * 0.18;
        hourly_usages.push({
            date: hd.toISOString(),
            used_traffic: h % 7 === 0 ? 0 : Math.floor(hBase * GB),
        });
    }
    return {
        usages,
        hourly_usages,
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
        res.setHeader("Access-Control-Allow-Origin", "*");
        const url = new URL(req.url, "http://x");
        if (url.pathname === "/usage") {
            usageResponse(res, url.searchParams.get("mode") || USAGE);
            return;
        }
        if (url.pathname === "/sub/alice/info" || url.pathname === "/info" || url.pathname.endsWith("/info")) {
            const mode = url.searchParams.get("info") || INFO;
            if (mode === "off") {
                res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ detail: "Not Found" }));
                return;
            }
            res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(mode === "empty"
                ? { user: {}, openvpn: { downloads: [] }, wireguard: {}, amneziawg: {}, l2tp: [], pptp: [], ikev2: [], anyconnect: [], sstp: [], gre: [] }
                : sampleInfo(PORT)));
            return;
        }
        if (/^\/sub\/alice\/ov\/[^/]+\.ovpn$/.test(url.pathname)) {
            res.writeHead(200, {
                "content-type": "application/x-openvpn-profile",
                "content-disposition": `attachment; filename="${url.pathname.split("/").pop()}"`,
            });
            res.end(SAMPLE_OVPN);
            return;
        }
        if (/^\/sub\/alice\/wg\/[^/]+\.conf$/.test(url.pathname)) {
            res.writeHead(200, {
                "content-type": "text/plain; charset=utf-8",
                "content-disposition": `attachment; filename="${url.pathname.split("/").pop()}"`,
            });
            res.end("[Interface]\nPrivateKey = aGVsbG8td29ybGQ=\nAddress = 10.0.0.2/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = serverPubkey123=\nEndpoint = de.example.com:51820\nAllowedIPs = 0.0.0.0/0\n");
            return;
        }
        if (/^\/sub\/alice\/awg\/[^/]+\.conf$/.test(url.pathname)) {
            res.writeHead(200, {
                "content-type": "text/plain; charset=utf-8",
                "content-disposition": `attachment; filename="${url.pathname.split("/").pop()}"`,
            });
            res.end("[Interface]\nPrivateKey = aGVsbG8td29ybGQ=\nAddress = 10.1.0.2/32\nDNS = 1.1.1.1\nJc = 4\nJmin = 50\nJmax = 1000\nS1 = 15\nS2 = 20\nH1 = 1\nH2 = 2\nH3 = 3\nH4 = 4\n\n[Peer]\nPublicKey = serverAwgPubkey123=\nEndpoint = de.example.com:51821\nAllowedIPs = 0.0.0.0/0\nPersistentKeepalive = 25\n");
            return;
        }
        if (url.pathname === "/__push_mock" && req.method === "POST") {
            const cfg = await readJsonBody(req);
            if (cfg.reset) {
                mockPushState.subs.clear();
                mockPushState.alerts = { usage_80: true, usage_95: false, expiry_24h: true, limited: true, expired: true };
                mockPushState.forceTestStatus = 0;
                mockPushState.forcePrefsStatus = 0;
            }
            if (cfg.mode) mockPushState.mode = cfg.mode;
            if (cfg.seedEndpoint) {
                mockPushState.subs.set(cfg.seedEndpoint, { lang: cfg.lang || "en", page_url: "/sub/alice", keys: {} });
            }
            if (cfg.forceTestStatus != null) mockPushState.forceTestStatus = Number(cfg.forceTestStatus) || 0;
            if (cfg.forcePrefsStatus != null) mockPushState.forcePrefsStatus = Number(cfg.forcePrefsStatus) || 0;
            res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, mode: mockPushState.mode, devices: mockPushState.subs.size }));
            return;
        }
        if (url.pathname === "/rebecca-sub-sw.js" || /\/push\/sw\.js$/.test(url.pathname)) {
            if (mockPushState.mode !== "on") {
                res.writeHead(mockPushState.mode === "off" ? 403 : 404, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ detail: mockPushState.mode === "off" ? "subscription web push is disabled" : "Not Found" }));
                return;
            }
            res.writeHead(200, {
                "content-type": "application/javascript; charset=utf-8",
                "cache-control": "no-cache",
                "service-worker-allowed": "/",
            });
            res.end(MOCK_SW_SCRIPT);
            return;
        }
        const pushMatch = url.pathname.match(/^(.*)\/push\/(manifest\.webmanifest|config|status|subscribe|preferences|unsubscribe|test)$/);
        if (pushMatch) {
            const [, subBase, action] = pushMatch;
            if (mockPushState.mode !== "on") {
                if (action === "config" && mockPushState.mode === "off") {
                    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ enabled: false }));
                    return;
                }
                res.writeHead(mockPushState.mode === "off" ? 403 : 404, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ detail: mockPushState.mode === "off" ? "subscription web push is disabled" : "Not Found" }));
                return;
            }
            if (action === "manifest.webmanifest") {
                const startURL = url.searchParams.get("path") || subBase || "/";
                res.writeHead(200, { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "no-cache" });
                res.end(JSON.stringify({
                    name: "Rebecca",
                    short_name: "Rebecca",
                    start_url: startURL,
                    scope: startURL,
                    display: "standalone",
                    background_color: "#060913",
                    theme_color: "#060913",
                }));
                return;
            }
            if (action === "config") {
                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({
                    enabled: true,
                    public_key: MOCK_VAPID_PUBLIC_KEY,
                    sw_url: `${subBase}/push/sw.js`,
                    manifest_url: `${subBase}/push/manifest.webmanifest`,
                }));
                return;
            }
            const body = await readJsonBody(req);
            if (action === "status") {
                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(pushStatusPayload(body.endpoint)));
                return;
            }
            if (action === "subscribe") {
                const ep = String(body.endpoint || "").trim();
                if (!ep || !body.keys || !body.keys.p256dh || !body.keys.auth) {
                    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ detail: "invalid push subscription" }));
                    return;
                }
                mockPushState.subs.set(ep, {
                    lang: body.lang || "en",
                    page_url: body.page_url || subBase || "/",
                    keys: body.keys,
                });
                if (body.alerts && typeof body.alerts === "object") {
                    mockPushState.alerts = {
                        usage_80: Boolean(body.alerts.usage_80),
                        usage_95: Boolean(body.alerts.usage_95),
                        expiry_24h: Boolean(body.alerts.expiry_24h),
                        limited: Boolean(body.alerts.limited),
                        expired: Boolean(body.alerts.expired),
                    };
                }
                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(pushStatusPayload(ep)));
                return;
            }
            if (action === "preferences") {
                if (mockPushState.forcePrefsStatus) {
                    const code = mockPushState.forcePrefsStatus;
                    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ detail: `forced error ${code}` }));
                    return;
                }
                if (mockPushState.subs.size === 0) {
                    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ detail: "push subscription not found" }));
                    return;
                }
                const ep = String(body.endpoint || "").trim();
                if (ep && body.lang && mockPushState.subs.has(ep)) {
                    mockPushState.subs.get(ep).lang = body.lang;
                }
                if (body.alerts && typeof body.alerts === "object") {
                    mockPushState.alerts = {
                        usage_80: Boolean(body.alerts.usage_80),
                        usage_95: Boolean(body.alerts.usage_95),
                        expiry_24h: Boolean(body.alerts.expiry_24h),
                        limited: Boolean(body.alerts.limited),
                        expired: Boolean(body.alerts.expired),
                    };
                }
                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(pushStatusPayload(ep)));
                return;
            }
            if (action === "unsubscribe") {
                const ep = String(body.endpoint || "").trim();
                mockPushState.subs.delete(ep);
                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(pushStatusPayload("")));
                return;
            }
            if (action === "test") {
                if (mockPushState.forceTestStatus) {
                    const code = mockPushState.forceTestStatus;
                    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ detail: `forced error ${code}` }));
                    return;
                }
                const ep = String(body.endpoint || "").trim();
                if (!ep || !mockPushState.subs.has(ep)) {
                    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ detail: "push subscription not found" }));
                    return;
                }
                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ sent: true }));
                return;
            }
        }
        const tpl = await readFile(OUT, "utf8");
        const state = url.searchParams.get("state") || STATE;
        const info = url.searchParams.get("info") || INFO;
        const pushMode = url.searchParams.get("push") || PUSH;
        mockPushState.mode = pushMode;
        let links = state === "empty" ? [] : SAMPLE_LINKS;
        if (state !== "empty" && info !== "off") links = links.concat(OV_DOWNLOADS(PORT), AWG_DOWNLOADS(PORT));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(render(
            tpl,
            ctxFor(state, url.searchParams.get("brand"), url.searchParams.get("title"), pushMode),
            links
        ));
    } catch (e) {
        res.writeHead(500);
        res.end(String(e));
    }
}).listen(PORT, () => {
    console.log(`Rebecca default template preview → http://localhost:${PORT}  (state=${STATE}, usage=${USAGE}, info=${INFO}, push=${PUSH})`);
    console.log("Try ?state=expired|limited|disabled|on_hold|unlimited|forever|empty · ?lang=fa · ?theme=rebecca · ?brand=Nimbus · ?title=YourBrand · ?info=empty|off · ?push=on|off|legacy");
});
