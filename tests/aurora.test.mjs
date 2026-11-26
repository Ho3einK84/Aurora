import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
    fmtBytes, fmtBytesStr, generateWgConf, parseConfigMeta,
    safeFileName, generatePbkEntry, generatePbkFile, generateGreCli,
    escapeHtml, escapeAttr,
} from "../src/format.js";
import {
    I18N, locNum, locPct, fmtRelative, fmtDaysUnit, fmtHoursUnit, fmtDevicesUnit, locCountry,
} from "../src/i18n.js";
import {
    parseLinks, configLabel, countryOf, normSearch, protocolBadge, protocolOf,
} from "../src/configs.js";
import {
    isOvpnLink, isWgLink, isAwgLink, profileLabel, ovpnLabel, mergeProfiles,
} from "../src/vpn.js";
import { dateOf, usageValOf, trimPreCreationZeros } from "../src/usage.js";
import { importUrl } from "../src/apps.js";
import { qrSvg } from "../src/qr.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("format.js — generateWgConf & parseConfigMeta handle unencoded slashes and plus signs in base64 keys", () => {
    const wgUri = "wireguard://abc/def+ghi=@de.example.com:51820?address=10.0.0.2/32&publickey=srv/Pub+Key123=&jc=4&s1=15#Germany";
    const conf = generateWgConf(wgUri);
    assert.ok(conf, "conf should be generated");
    assert.match(conf, /PrivateKey = abc\/def\+ghi=/);
    assert.match(conf, /PublicKey = srv\/Pub\+Key123=/);
    assert.match(conf, /Endpoint = de\.example\.com:51820/);
    assert.match(conf, /Address = 10\.0\.0\.2\/32/);
    assert.match(conf, /Jc = 4/);
    assert.match(conf, /S1 = 15/);

    const wgMeta = parseConfigMeta(wgUri);
    assert.equal(wgMeta.protocol, "WIREGUARD");
    assert.equal(wgMeta.server, "de.example.com");
    assert.equal(wgMeta.port, "51820");
    assert.equal(wgMeta.id, "abc/def+ghi=");
    assert.equal(wgMeta.summary, "UDP · de.example.com:51820");

    // Shadowsocks SIP002 with slash in base64 userinfo must NOT leak secret into server
    const ssSip002 = "ss://MjAyMi1ibGFrZTMtYWVzLTI1Ni1nY206abc+def/ghi=@de.example.com:8388?type=tcp#SS-2022";
    const ssMeta = parseConfigMeta(ssSip002);
    assert.equal(ssMeta.protocol, "SS");
    assert.equal(ssMeta.server, "de.example.com");
    assert.equal(ssMeta.port, "8388");
    assert.equal(ssMeta.summary, "TCP · de.example.com:8388");

    // Legacy SS with slash inside base64 payload
    const ssLegacy = "ss://" + Buffer.from("aes-256-gcm:p?ss/word@1.2.3.4:8388").toString("base64") + "#Legacy";
    const ssLegMeta = parseConfigMeta(ssLegacy);
    assert.equal(ssLegMeta.server, "1.2.3.4");
    assert.equal(ssLegMeta.port, "8388");
    assert.equal(ssLegMeta.id, "aes-256-gcm:p?ss/word");

    // SSH with @ and / in password
    const sshMeta = parseConfigMeta("ssh://alice:p@ss/w:ord@de.example.com:22#SSH");
    assert.equal(sshMeta.server, "de.example.com");
    assert.equal(sshMeta.port, "22");
    assert.equal(sshMeta.id, "alice:p@ss/w:ord");

    // IPv6 endpoint
    const wgV6 = generateWgConf("wireguard://privKey123=@[2001:db8::1]:51820?address=10.0.0.2/32&publickey=pubKey456=");
    assert.match(wgV6, /Endpoint = \[2001:db8::1\]:51820/);
});

test("format.js — fmtBytes handles unit rollover and precision boundaries cleanly", () => {
    assert.deepEqual(fmtBytes(0, "en"), { value: "0", unit: "B", num: 0 });
    assert.deepEqual(fmtBytes(1023.999 * 1024, "en"), { value: "1.00", unit: "MB", num: 1 });
    assert.deepEqual(fmtBytes(9.996 * 1024 ** 3, "en"), { value: "10.0", unit: "GB", num: 10 });
    assert.deepEqual(fmtBytes(99.96 * 1024 ** 3, "en"), { value: "100", unit: "GB", num: 100 });
    assert.equal(fmtBytesStr(50 * 1024 ** 3, "fa"), "۵۰.۰ گیگابایت");
});

test("i18n.js — all 4 dictionaries have 100% key parity and fmtRelative promotes rounded boundaries", () => {
    const enKeys = Object.keys(I18N.en).sort();
    for (const lg of ["fa", "ru", "zh"]) {
        assert.deepEqual(Object.keys(I18N[lg]).sort(), enKeys, `Dictionary mismatch for ${lg}`);
    }

    const now = 1_700_000_000_000;
    assert.equal(fmtRelative(new Date(now + 23.8 * 3600_000), "en", { now }), "in 1 day");
    assert.equal(fmtRelative(new Date(now + 23.8 * 3600_000), "fa", { now }), "۱ روز دیگر");
    assert.equal(fmtRelative(new Date(now + 5 * 3600_000), "en", { now }), "in 5 hrs");
    assert.equal(fmtRelative(new Date(now + 29.8 * 86400_000), "en", { now }), "in 1 mo");
    assert.equal(locPct(80, "fa"), "\u2066۸۰٪\u2069");
    assert.equal(fmtDaysUnit(1, "en"), "day");
    assert.equal(fmtDaysUnit(5, "ru"), "дней");
    assert.equal(fmtHoursUnit(2, "ru"), "часа");
    assert.equal(fmtDevicesUnit(1, "en"), "device");
});

test("configs.js — normSearch & countryOf support Mathematical Unicode, flags, ISO codes, and Persian", () => {
    // Mathematical Bold Unicode used by live Rebecca remarks
    const fancy = "𝑮𝒆𝒓𝒎𝒂𝒏𝒚 🇩🇪 (XHTTP☁️)";
    assert.ok(normSearch(fancy).includes("germany"));
    assert.equal(countryOf("𝑮𝒆𝒓𝒎𝒂𝒏𝒚")?.code, "DE");
    assert.equal(countryOf("𝑼𝒏𝒊𝒕𝒆𝒅𝑺𝒕𝒂𝒕𝒆𝒔")?.code, "US");
    assert.equal(countryOf("𝑫𝑬 (2×)")?.code, "DE");
    assert.equal(countryOf("NL-Relay")?.code, "NL");

    // Must NOT false-match common English words or protocol tokens
    assert.equal(countryOf("Fast WS TLS"), null);
    assert.equal(countryOf("Best SS Server"), null);
    assert.equal(countryOf("Sign in to VIP"), null);

    // Persian digits & Arabic Yeh/Kaf normalization
    assert.equal(normSearch("سرور ۱۲ آلمان ي ك"), "سرور 12 آلمان ی ک");
    assert.equal(locCountry("DE", "Germany", "fa"), "آلمان");

    // parseLinks strips dangerous schemes, HTML entities, and unrendered pongo2 tokens
    const links = parseLinks([
        "vless://id@host:443?type=ws&amp;path=%2Fws#Test",
        "javascript:alert(1)",
        "{{ link }}",
    ].join("\n"));
    assert.deepEqual(links, ["vless://id@host:443?type=ws&path=%2Fws#Test"]);
    assert.equal(protocolBadge(links[0]), "VL");
    assert.equal(protocolOf(links[0]), "VLESS");
    assert.equal(configLabel(links[0]), "Test");
});

test("vpn.js — profileLabel & mergeProfiles deduplicate island URI + .conf download pairs", () => {
    const awgUri = "awg://aGVsbG8=@de.example.com:51821?address=10.0.1.2%2F32&publickey=pub123%3D#Aurora%20Germany%20%F0%9F%87%A9%F0%9F%87%AA%20AWG";
    const awgConfUrl = "http://localhost:8787/sub/alice/awg/Aurora-Germany-AWG.conf";
    assert.equal(isAwgLink(awgUri), true);
    assert.equal(isAwgLink(awgConfUrl), true);
    assert.equal(isWgLink(awgConfUrl), false);
    assert.equal(isOvpnLink("https://x.test/sub/a/ov/DE.ovpn"), true);
    assert.equal(profileLabel("http://x/%E0%A4%A", "WireGuard"), "WireGuard");
    assert.equal(ovpnLabel("https://x.test/sub/a/ov/DE-Main.ovpn"), "DE-Main");

    const merged = mergeProfiles([
        { name: configLabel(awgUri), link: awgUri, downloadUrl: "" },
        { name: profileLabel(awgConfUrl, "AmneziaWG"), link: "", downloadUrl: awgConfUrl },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].link, awgUri);
    assert.equal(merged[0].downloadUrl, awgConfUrl);
    assert.equal(merged[0].name, "Aurora Germany 🇩🇪 AWG");

    // PBK & GRE helpers
    const pbk = generatePbkFile([
        { remark: "DE L2TP", server: "de.example.com", protocol: "l2tp", username: "alice" },
    ]);
    assert.match(pbk, /\[DE L2TP\]/);
    assert.match(pbk, /VpnStrategy=3/);
    const gre = generateGreCli({ server: "1.2.3.4", clientAddress: "10.10.10.2/30", mtu: "1476", ttl: "64" });
    assert.match(gre.linux, /remote 1\.2\.3\.4 ttl 64/);
});

test("usage.js — dateOf anchors YYYY-MM-DD at local noon and trimPreCreationZeros removes pre-creation padding", () => {
    const d = dateOf({ date: "2026-09-01" });
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 8);
    assert.equal(d.getDate(), 1);
    assert.equal(d.getHours(), 12);

    const padded = [
        { date: "2026-11-24", used_traffic: 0 },
        { date: "2026-11-25", used_traffic: 0 },
        { date: "2026-11-26", used_traffic: 174_000_000 },
    ];
    const trimmed = trimPreCreationZeros(padded, "2026-11-26T18:31:22Z");
    assert.equal(trimmed.length, 1);
    assert.equal(usageValOf(trimmed[0]), 174_000_000);
});

test("apps.js, qr.js & format.js — deep links, QR SVG, and filename/HTML escaping", () => {
    const deep = importUrl("v2rayng://install-sub?url={url_enc}&name={name}", "https://ex.com/sub/a", "ali");
    assert.equal(deep, "v2rayng://install-sub?url=https%3A%2F%2Fex.com%2Fsub%2Fa&name=ali");
    assert.equal(importUrl("javascript:alert(1)", "https://ex.com", "a"), "");

    const svg = qrSvg("https://example.com/sub/alice");
    assert.match(svg, /^<svg\b/);
    const fallbackSvg = qrSvg("x".repeat(4000), { errorText: "Too long" });
    assert.match(fallbackSvg, /Too long/);

    assert.equal(safeFileName("../bad:name\x00", "aurora", ".conf"), "bad-name.conf");
    assert.equal(escapeHtml("<script>\"'&"), "&lt;script&gt;&quot;&#39;&amp;");
    assert.ok(!escapeAttr('" onclick="alert(1)').includes('"'));
});

test("build artifact — dist/index.html places AURORA_BRAND before blocking head script and passes guard", () => {
    const distHtml = readFileSync(resolve(ROOT, "dist/index.html"), "utf8");
    const brandPos = distHtml.indexOf("window.AURORA_BRAND =");
    const resolverPos = distHtml.indexOf("aurora-default-theme");
    const headEndPos = distHtml.indexOf("</head>");
    assert.ok(brandPos > 0 && brandPos < headEndPos, "window.AURORA_BRAND must be defined inside <head>");
    assert.ok(brandPos > resolverPos, "window.AURORA_BRAND must appear after <meta> tags");
    const scriptAfterBrand = distHtml.indexOf("new URLSearchParams(location.search)");
    assert.ok(brandPos < scriptAfterBrand, "window.AURORA_BRAND must precede the blocking pref resolver script");
});

test("install.sh — patch_branding safely handles '};' and '$' in branding fields and preserves extra brand keys", () => {
    const distPath = resolve(ROOT, "dist/index.html");
    const tmpDir = mkdtempSync(join(tmpdir(), "aurora-test-"));
    const targetFile = join(tmpDir, "index.html");
    try {
        copyFileSync(distPath, targetFile);
        // Seed an extra custom key ("alerts": false) inside window.AURORA_BRAND
        let seeded = readFileSync(targetFile, "utf8").replace(
            /window\.AURORA_BRAND\s*=\s*\{.*?\};/,
            'window.AURORA_BRAND = {"name":"OldBrand","alerts":false};'
        );
        execFileSync("python3", ["-c", "import sys; open(sys.argv[1],'w').write(sys.stdin.read())", targetFile], { input: seeded });

        // Run install.sh branding patch via bash sourcing / CLI simulation on targetFile
        const scriptPath = resolve(ROOT, "install.sh");
        execFileSync("bash", [
            scriptPath,
            "--target", targetFile,
            "--brand", "$kyLink VIP",
            "--support", "https://t.me/SkySupport",
            "--lang", "fa",
            "--theme", "auroralight",
            "--announce", "Notice: maintenance {22:00}; back soon;",
            "--no-server-breakdown",
        ], { env: { ...process.env, PATH: process.env.PATH } });

        // Wait: install.sh downloads fresh dist/index.html AND preserves CUR_BRAND_RAW from targetFile!
        const patched = readFileSync(targetFile, "utf8");
        assert.ok(patched.includes("<title>$kyLink VIP</title>"), "Brand with $ should not be corrupted");
        assert.ok(patched.includes('lang="fa"'), "html lang should be fa");
        assert.ok(patched.includes('dir="rtl"'), "html dir should be rtl");
        assert.ok(patched.includes('data-theme="auroralight"'), "html theme should be auroralight");

        const m = /window\.AURORA_BRAND\s*=\s*(\{[\s\S]*?\});<\/script>/.exec(patched);
        assert.ok(m, "window.AURORA_BRAND script tag must remain valid");
        const parsedBrand = JSON.parse(m[1]);
        assert.equal(parsedBrand.name, "$kyLink VIP");
        assert.equal(parsedBrand.announcement, "Notice: maintenance {22:00}; back soon;");
        assert.equal(parsedBrand.alerts, false, "Extra custom keys like alerts:false must survive updates");
        assert.equal(parsedBrand.serverBreakdown, false);

        // Now run `--auto` (no CLI flags) and verify 2-byte "fa" + "auroralight" + "$kyLink VIP" + "};" all survive round-trip!
        execFileSync("bash", [
            scriptPath,
            "--auto",
            "--target", targetFile,
        ], { env: { ...process.env, PATH: process.env.PATH } });

        const afterAuto = readFileSync(targetFile, "utf8");
        const mAuto = /window\.AURORA_BRAND\s*=\s*(\{[\s\S]*?\});<\/script>/.exec(afterAuto);
        assert.ok(mAuto, "window.AURORA_BRAND must remain valid after --auto");
        const autoBrand = JSON.parse(mAuto[1]);
        assert.equal(autoBrand.name, "$kyLink VIP");
        assert.equal(autoBrand.defaultLang, "fa");
        assert.equal(autoBrand.defaultTheme, "auroralight");
        assert.equal(autoBrand.supportUrl, "https://t.me/SkySupport");
        assert.equal(autoBrand.announcement, "Notice: maintenance {22:00}; back soon;");
        assert.equal(autoBrand.alerts, false);
        assert.equal(autoBrand.serverBreakdown, false);
        assert.ok(afterAuto.includes('lang="fa"'));
        assert.ok(afterAuto.includes('dir="rtl"'));
        assert.ok(afterAuto.includes('data-theme="auroralight"'));

        // Verify build guard passes on the patched file!
        execFileSync("node", [resolve(ROOT, "scripts/build.mjs"), "--guard-only"], { cwd: ROOT });
    } finally {
        rmSync(tmpDir, { recursive: true, force: true });
    }
});
