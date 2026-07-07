#!/usr/bin/env node
/* ===========================================================================
   Aurora build.
   Produces ONE fully self-contained dist/index.html that Rebecca (pongo2)
   renders directly, with ZERO external requests at runtime:

     • bundles + minifies the app (src/app.js + modules) with esbuild
     • bundles the QR module SEPARATELY — embedded as an inert base64 blob and
       only decoded/imported the first time a QR modal opens
     • inlines the built Tailwind v4 + DaisyUI v5 CSS
     • inlines web fonts: Inter variable (latin) + Arad 400/700/800, base64
     • inlines the Phosphor icons actually used, as CSS mask data-URIs
     • inlines apps.json as a plain (hand-editable) JSON literal

   Template-engine safety — the reason for the base64 dance: pongo2 (and the
   legacy Jinja2 branch) treats {{ }} / {% %} / {# #} as directives, and
   minified JS legitimately contains such sequences. The engine must only ever
   see the data-island bindings, so all executable JS travels base64-encoded
   (alphabet [A-Za-z0-9+/=] — no brace pairs possible) and is decoded at
   runtime. The guard below fails the build on ANY stray directive, unknown
   island binding, or external resource reference.

   Usage:
     node scripts/build.mjs                build → dist/index.html
     node scripts/build.mjs --guard-only   re-run the guard on dist/index.html
   =========================================================================== */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const r = (p) => resolve(root, p);
const GUARD_ONLY = process.argv.includes("--guard-only");

/* -------------------------------------------------------- directive guard */

// The exact pongo2 bindings allowed to survive, all inside #aurora-data.
const ALLOWED_DIRECTIVES = new Set([
    "{{ user.username }}",
    "{{ user.status }}",
    "{{ user.status_class }}",
    "{{ user.used_traffic }}",
    "{{ user.data_limit }}",
    "{{ user.data_limit_reset_strategy }}",
    "{{ user.expire }}",
    "{{ remaining_days }}",
    "{{ user.subscription_url }}",
    "{{ support_url }}",
    "{{ usage_url }}",
    "{{ brand_name }}",
    "{{ user.online_count }}",
    "{{ user.service_name }}",
    "{{ link }}",
    "{% for link in links %}",
    "{% endfor %}",
].map(normalize));

function normalize(d) {
    return d.replace(/\s+/g, " ").trim();
}

/**
 * Fail unless: every directive inside #aurora-data is a known binding, there
 * are no directive-openers anywhere else, and nothing references an external
 * resource (the self-contained promise).
 */
function guard(html) {
    const island = (html.match(/<div\b[^>]*\bid="aurora-data"[\s\S]*?<\/div>/) || [])[0];
    if (!island) throw new Error("[guard] #aurora-data island not found — bindings missing.");
    const rest = html.replace(island, "");

    const strays = rest.match(/\{\{|\{%|\{#/g);
    if (strays) {
        const ctx = [];
        const re = /\{\{|\{%|\{#/g;
        let m;
        while ((m = re.exec(rest)) && ctx.length < 6) {
            ctx.push(JSON.stringify(rest.slice(Math.max(0, m.index - 34), m.index + 34)));
        }
        throw new Error(
            `[guard] ${strays.length} stray template directive(s) outside the data island:\n  ` + ctx.join("\n  ")
        );
    }

    const directives = island.match(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g) || [];
    for (const d of directives) {
        if (!ALLOWED_DIRECTIVES.has(normalize(d))) {
            throw new Error(`[guard] Unexpected directive in the data island: ${JSON.stringify(d)}`);
        }
    }

    const offenders = [];
    if (/<link\b[^>]*\brel=/i.test(rest)) offenders.push("<link rel> tag");
    if (/<script\b[^>]*\bsrc=/i.test(html)) offenders.push("<script src> tag");
    if (/@import\b/i.test(html)) offenders.push("@import in CSS");
    if (/url\(\s*['"]?https?:/i.test(html)) offenders.push("url(http…) in CSS");
    if (offenders.length) {
        throw new Error("[guard] external resource reference(s): " + offenders.join(", "));
    }

    return directives.length;
}

if (GUARD_ONLY) {
    const out = r("dist/index.html");
    if (!existsSync(out)) {
        console.error("[guard-only] dist/index.html not found — run `npm run build` first.");
        process.exit(1);
    }
    try {
        const n = guard(readFileSync(out, "utf8"));
        console.log(`✓ guard: ${n} known binding(s) in the data island, 0 strays, no external loads.`);
        process.exit(0);
    } catch (err) {
        console.error(err.message || err);
        process.exit(1);
    }
}

/* ------------------------------------------------------------------ inputs */

const html = readFileSync(r("src/index.html"), "utf8");
const apps = readFileSync(r("src/apps.json"), "utf8");
if (!existsSync(r("build/app.css"))) {
    throw new Error("build/app.css missing — run `npm run build:css` first (or `npm run build`).");
}
const css = readFileSync(r("build/app.css"), "utf8");

for (const marker of ["<!--AURORA_INLINE_CSS-->", "<!--AURORA_INLINE_JS-->"]) {
    const count = html.split(marker).length - 1;
    if (count !== 1) throw new Error(`Expected exactly one "${marker}" in src/index.html, found ${count}.`);
}

/* --------------------------------------------------------------- JS bundles */

const bundle = async (entry, format) => {
    const result = await esbuild.build({
        entryPoints: [r(entry)],
        bundle: true,
        minify: true,
        format,
        target: ["es2018"],
        charset: "utf8",
        legalComments: "none",
        write: false,
    });
    return result.outputFiles[0].text;
};

const appJs = await bundle("src/app.js", "iife");
const qrJs = await bundle("src/qr.js", "esm");

/* -------------------- fonts → base64 @font-face (no CDNs at runtime) ------ */

const fontFace = (family, weight, file) => {
    const abs = r(file);
    if (!existsSync(abs)) throw new Error(`Missing font ${file}. Run "npm ci" first.`);
    const b64 = readFileSync(abs).toString("base64");
    return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
        `font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
};

// Inter ships as ONE variable file covering wght 100–900 (~48KB vs ~120KB of
// static cuts). Arad (farsi) ships the three weights the UI resolves to —
// 500/600 requests match 400/700 via the browser's nearest-weight rules.
const fontCss = [
    fontFace("Inter", "100 900", "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"),
    fontFace("Arad", 400, "assets/fonts/Arad-Regular.woff2"),
    fontFace("Arad", 700, "assets/fonts/Arad-Bold.woff2"),
    fontFace("Arad", 800, "assets/fonts/Arad-ExtraBold.woff2"),
].join("\n");

/* ------------- Phosphor icons → CSS mask data-URIs (used glyphs only) ----- */

const jsSources = ["src/app.js", "src/ui.js", "src/i18n.js", "src/format.js", "src/store.js",
    "src/configs.js", "src/apps.js", "src/usage.js", "src/vpn.js"]
    .map((p) => readFileSync(r(p), "utf8")).join("\n");

const usedIcons = [...new Set(
    (html + "\n" + jsSources).match(/ph-[a-z0-9]+(?:-[a-z0-9]+)*/g) || []
)].map((c) => c.replace(/^ph-/, "")).sort();

const svgToDataUri = (svg) =>
    "data:image/svg+xml," + svg
        .replace(/\s*\n\s*/g, " ")
        .replace(/"/g, "'")
        .replace(/</g, "%3C")
        .replace(/>/g, "%3E")
        .replace(/#/g, "%23")
        .replace(/&/g, "%26")
        .trim();

const iconRules = usedIcons.map((name) => {
    const file = r(`node_modules/@phosphor-icons/core/assets/regular/${name}.svg`);
    if (!existsSync(file)) throw new Error(`Icon "ph-${name}" used but not found in @phosphor-icons/core.`);
    return `.ph-${name}{--ph:url("${svgToDataUri(readFileSync(file, "utf8"))}")}`;
}).join("\n");

const iconBase =
    ".ph{display:inline-block;width:1em;height:1em;flex-shrink:0;vertical-align:-0.125em;" +
    "background-color:currentColor;-webkit-mask:var(--ph) center/contain no-repeat;" +
    "mask:var(--ph) center/contain no-repeat}";

/* -------------------------------------------------------------- assemble */

/**
 * Neutralize directive-opener/closer pairs the CSS minifier can incidentally
 * produce (e.g. `@media{…}}` → `}}`). A single space is CSS-insignificant and
 * keeps the output clean for engines that scan greedily.
 */
const neutralizeCss = (s) => s.replace(/\{\{|\}\}|\{%|%\}|\{#|#\}/g, (m) => m[0] + " " + m[1]);

const styleTag = `<style>\n${neutralizeCss(css)}\n${fontCss}\n${iconBase}\n${iconRules}\n</style>`;

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const appB64 = b64(appJs);
const qrB64 = b64(qrJs);
if (/[{}<]/.test(appB64) || /[{}<]/.test(qrB64)) {
    throw new Error("base64 payload contained a brace/angle bracket — impossible?");
}

// The apps list stays a plain JSON literal so self-hosters can edit the
// catalogue directly in dist/index.html without a rebuild.
const appsLiteral = apps.trim();
if (/\{\{|\{%|\{#/.test(appsLiteral)) {
    throw new Error("apps.json contains a template-directive sequence — refusing to inline it.");
}
if (/<\/script/i.test(appsLiteral)) {
    throw new Error("apps.json contains </script> — refusing to inline it.");
}

const loaderScript =
    "(function(){var b=document.getElementById('aurora-app').textContent;" +
    "var s=atob(b.trim()),n=s.length,a=new Uint8Array(n);" +
    "for(var i=0;i<n;i++)a[i]=s.charCodeAt(i);" +
    "var e=document.createElement('script');" +
    "e.textContent=new TextDecoder('utf-8').decode(a);" +
    "document.head.appendChild(e);})();";

const scriptTag =
    `<script>window.AURORA_APPS = ${appsLiteral};</script>\n` +
    `<script id="aurora-app" type="application/octet-stream">${appB64}</script>\n` +
    `<script id="aurora-qr" type="application/octet-stream">${qrB64}</script>\n` +
    `<script>${loaderScript}</script>`;

const out = html
    .replace("<!--AURORA_INLINE_CSS-->", () => styleTag)
    .replace("<!--AURORA_INLINE_JS-->", () => scriptTag);

const bindings = guard(out);

mkdirSync(r("dist"), { recursive: true });
writeFileSync(r("dist/index.html"), out, "utf8");

const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log(
    `✓ dist/index.html written (${kb(Buffer.byteLength(out, "utf8"))}, self-contained)\n` +
    `  app ${kb(appJs.length)} (b64 ${kb(appB64.length)}) · qr ${kb(qrJs.length)} lazy (b64 ${kb(qrB64.length)})\n` +
    `  css ${kb(css.length)} · fonts ${kb(fontCss.length)} · ${usedIcons.length} icons · ` +
    `${bindings} pongo2 bindings preserved`
);
