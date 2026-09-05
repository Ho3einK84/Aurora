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

const GB = 1024 ** 3;
const DAY = 86400;

const SAMPLE_LINKS = [
    "vless://11111111-2222-3333-4444-555555555555@example.com:443?type=ws&security=tls&path=%2Faurora#Aurora%20Germany%20%F0%9F%87%A9%F0%9F%87%AA",
    "vmess://eyJ2IjoiMiIsInBzIjoiQXVyb3JhIEZpbmxhbmQg8J+Hq/Cfh64iLCJhZGQiOiJleGFtcGxlLmNvbSIsInBvcnQiOiI0NDMifQ==",
    "trojan://password123@example.com:443?security=tls&type=grpc#Aurora%20Netherlands",
    "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@example.com:8388#Aurora%20France",
    "vless://99999999-8888-7777-6666-555555555555@example.de:8443?security=reality#Frankfurt%20DE%20%F0%9F%87%A9%F0%9F%87%AA",
    "ssh://alice:s3cr3t-ssh-pass@de.example.com:22#Aurora%20Germany%20%F0%9F%87%A9%F0%9F%87%AA%20SSH",
    "awg://aGVsbG8td29ybGQ=@de.example.com:51821?address=10.0.1.2%2F32&publickey=serverAwgPubkey123%3D#Aurora%20Germany%20%F0%9F%87%A9%F0%9F%87%AA%20AWG",
    "tg://proxy?server=tg.example.com&port=443&secret=ee112233445566778899aabbccddeeff11676f6f676c652e636f6d#Aurora%20Telegram%20Proxy",
];

// Rebecca dev appends profile download links to the links list.
const OV_DOWNLOADS = (port) => [
    `http://localhost:${port}/sub/alice/ov/Aurora-Germany-OV.ovpn`,
    `http://localhost:${port}/sub/alice/ov/Aurora-Finland-OV.ovpn`,
];

const AWG_DOWNLOADS = (port) => [
    `http://localhost:${port}/sub/alice/awg/Aurora-Germany-AWG.conf`,
];

/**
 * Shaped like Rebecca dev's GET {sub}/info payload (user + openvpn/l2tp/pptp),
 * finalized schema as of commit 4579d6d: `openvpn` (not `ov`) plus the richer
 * L2TP/PPTP fields (host_name, address, port, ike_port, natt_port, tunnel_port).
 */
function sampleInfo(port) {
    return {
        user: { username: "alice_wonder", status: "active" },
        openvpn: { downloads: OV_DOWNLOADS(port) },
        l2tp: [
            {
                host_tag: "Aurora-Germany-L2TP",
                host_name: "Aurora Germany 🇩🇪 L2TP",
                inbound_tag: "l2tp-de",
                remark: "Aurora Germany 🇩🇪 L2TP",
                server: "de.example.com",
                address: "de.example.com",
                port: 1701,
                ike_port: 500,
                natt_port: 4500,
                tunnel_port: 1702,
                username: "alice_wonder",
                password: "s3cr3t-l2tp-pass",
                ipsec_psk: "aurora-shared-key",
            },
            {
                host_tag: "Aurora-Finland-L2TP",
                host_name: "Aurora Finland 🇫🇮 L2TP",
                inbound_tag: "l2tp-fi",
                remark: "Aurora Finland 🇫🇮 L2TP",
                server: "fi.example.com",
                address: "fi.example.com",
                port: 1701,
                ike_port: 500,
                natt_port: 4500,
                tunnel_port: 1702,
                username: "alice_wonder",
                password: "s3cr3t-l2tp-pass",
                ipsec_psk: "aurora-shared-key",
            },
        ],
        pptp: [
            {
                host_tag: "Aurora-Germany-PPTP",
                host_name: "Aurora Germany 🇩🇪 PPTP",
                inbound_tag: "pptp-de",
                remark: "Aurora Germany 🇩🇪 PPTP",
                server: "de.example.com",
                address: "de.example.com",
                port: 1723,
                username: "alice_wonder",
                password: "s3cr3t-pptp-pass",
            },
        ],
        wireguard: {
            downloads: [`http://localhost:${port}/sub/alice/wg/Aurora-Germany-WG.conf`],
            links: [
                "wireguard://aGVsbG8td29ybGQ=@de.example.com:51820?address=10.0.0.2%2F32&publickey=serverPubkey123%3D#Aurora%20Germany%20%F0%9F%87%A9%F0%9F%87%AA%20WG",
            ],
            profiles: [
                {
                    host_tag: "Aurora-Germany-WG",
                    host_name: "Aurora Germany 🇩🇪 WG",
                    inbound_tag: "wg-de",
                    remark: "Aurora Germany 🇩🇪 WireGuard",
                    filename: "Aurora-Germany-WG.conf",
                    download_url: `http://localhost:${port}/sub/alice/wg/Aurora-Germany-WG.conf`,
                    link: "wireguard://aGVsbG8td29ybGQ=@de.example.com:51820?address=10.0.0.2%2F32&publickey=serverPubkey123%3D#Aurora%20Germany%20%F0%9F%87%A9%F0%9F%87%AA%20WG",
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
                host_tag: "Aurora-Germany-IKEv2",
                host_name: "Aurora Germany 🇩🇪 IKEv2",
                inbound_tag: "ikev2-de",
                remark: "Aurora Germany 🇩🇪 IKEv2",
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
                host_tag: "Aurora-Finland-IKEv2-Cert",
                host_name: "Aurora Finland 🇫🇮 IKEv2 (Cert)",
                inbound_tag: "ikev2-fi-cert",
                remark: "Aurora Finland 🇫🇮 IKEv2 (Cert)",
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
                host_tag: "Aurora-Germany-AnyConnect",
                host_name: "Aurora Germany 🇩🇪 AnyConnect",
                inbound_tag: "anyconnect-de",
                remark: "Aurora Germany 🇩🇪 AnyConnect",
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
                "awg://aGVsbG8td29ybGQ=@de.example.com:51821?address=10.0.1.2%2F32&publickey=serverAwgPubkey123%3D#Aurora%20Germany%20%F0%9F%87%A9%F0%9F%87%AA%20AWG",
            ],
            profiles: [
                {
                    host_tag: "Aurora-Germany-AWG",
                    host_name: "Aurora Germany 🇩🇪 AWG",
                    inbound_tag: "awg-de",
                    remark: "Aurora Germany 🇩🇪 AmneziaWG",
                    filename: "Aurora-Germany-AWG.conf",
                    download_url: `http://localhost:${port}/sub/alice/awg/Aurora-Germany-AWG.conf`,
                    link: "awg://aGVsbG8td29ybGQ=@de.example.com:51821?address=10.0.1.2%2F32&publickey=serverAwgPubkey123%3D#Aurora%20Germany%20%F0%9F%87%A9%F0%9F%87%AA%20AWG",
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
                host_tag: "Aurora-Germany-SSTP",
                host_name: "Aurora Germany 🇩🇪 SSTP",
                inbound_tag: "sstp-de",
                remark: "Aurora Germany 🇩🇪 SSTP",
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
                host_tag: "Aurora-Germany-GRE",
                host_name: "Aurora Germany 🇩🇪 GRE",
                inbound_tag: "gre-de",
                remark: "Aurora Germany 🇩🇪 GRE Tunnel",
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

function ctxFor(state, brand, profileTitle) {
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
        "user.service_name": "Nebula 50GB",
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
        const tpl = await readFile(OUT, "utf8");
        const state = url.searchParams.get("state") || STATE;
        const info = url.searchParams.get("info") || INFO;
        let links = state === "empty" ? [] : SAMPLE_LINKS;
        if (state !== "empty" && info !== "off") links = links.concat(OV_DOWNLOADS(PORT), AWG_DOWNLOADS(PORT));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(render(
            tpl,
            ctxFor(state, url.searchParams.get("brand"), url.searchParams.get("title")),
            links
        ));
    } catch (e) {
        res.writeHead(500);
        res.end(String(e));
    }
}).listen(PORT, () => {
    console.log(`Aurora preview → http://localhost:${PORT}  (state=${STATE}, usage=${USAGE}, info=${INFO})`);
    console.log("Try ?state=expired|limited|disabled|on_hold|unlimited|forever|empty · ?lang=fa · ?theme=nord · ?brand=Nimbus · ?title=YourBrand · ?info=empty|off");
});
