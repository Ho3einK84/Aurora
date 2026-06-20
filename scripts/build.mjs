#!/usr/bin/env node
/* ===========================================================================
   Aurora build step.
   Produces a SINGLE, fully self-contained dist/index.html that Rebecca (pongo2)
   can render directly — with ZERO external network requests at runtime, so the
   page works even when CDNs (jsDelivr, Google Fonts, …) are blocked or slow:
     • inlines the built Tailwind v4 + DaisyUI v5 CSS into <style>
     • inlines the web fonts (Inter latin + Arad farsi) as base64 @font-face
     • inlines the Phosphor icons used on the page as CSS mask data-URIs
     • inlines app.js, qrcode-generator and Alpine.js (plus apps.json)
     • keeps all {{ ... }} / {% ... %} pongo2 placeholders byte-for-byte intact
   =========================================================================== */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const r = (p) => resolve(root, p);

const html = readFileSync(r("src/index.html"), "utf8");
const css = readFileSync(r("build/app.css"), "utf8");
const js = readFileSync(r("src/app.js"), "utf8");
const apps = readFileSync(r("src/apps.json"), "utf8");

// Counts pongo2 placeholders ({{ }} / {% %}) in a string.
const countPongo = (s) => (s.match(/\{\{.*?\}\}|\{%.*?%\}/gs) || []).length;

// Sanity check: the markers we replace must exist and be unique.
for (const marker of ["<!--AURORA_INLINE_CSS-->", "<!--AURORA_INLINE_JS-->"]) {
    const count = html.split(marker).length - 1;
    if (count !== 1) {
        throw new Error(`Expected exactly one "${marker}" in src/index.html, found ${count}.`);
    }
}

// Guard against accidentally trampling pongo2 tags during the build.
const placeholders = countPongo(html);
if (placeholders === 0) {
    throw new Error("No pongo2 placeholders found — refusing to emit a template with no bindings.");
}

/* --- Vendored libraries (read from node_modules, pinned via package-lock) --- */
const readVendor = (p, label) => {
    const abs = r(p);
    if (!existsSync(abs)) {
        throw new Error(`Missing ${label} at ${p}. Run "npm ci" first.`);
    }
    return readFileSync(abs, "utf8");
};
const qrcodeLib = readVendor("node_modules/qrcode-generator/qrcode.js", "qrcode-generator");
const alpineLib = readVendor("node_modules/alpinejs/dist/cdn.min.js", "alpinejs");

/* --- Web fonts → base64 @font-face (no Google Fonts / jsDelivr at runtime) -- */
const fontFace = (family, weight, file) => {
    const b64 = readFileSync(r(file)).toString("base64");
    return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
        `font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
};
// Inter (latin) ships pre-subset per weight via @fontsource; Arad (farsi) is
// vendored under assets/fonts (fetched once from the upstream GitHub release).
const interDir = "node_modules/@fontsource/inter/files";
const aradDir = "assets/fonts";
const fontCss = [
    fontFace("Inter", 400, `${interDir}/inter-latin-400-normal.woff2`),
    fontFace("Inter", 500, `${interDir}/inter-latin-500-normal.woff2`),
    fontFace("Inter", 600, `${interDir}/inter-latin-600-normal.woff2`),
    fontFace("Inter", 700, `${interDir}/inter-latin-700-normal.woff2`),
    fontFace("Inter", 800, `${interDir}/inter-latin-800-normal.woff2`),
    fontFace("Arad", 400, `${aradDir}/Arad-Regular.woff2`),
    fontFace("Arad", 500, `${aradDir}/Arad-Medium.woff2`),
    fontFace("Arad", 600, `${aradDir}/Arad-SemiBold.woff2`),
    fontFace("Arad", 700, `${aradDir}/Arad-Bold.woff2`),
    fontFace("Arad", 800, `${aradDir}/Arad-ExtraBold.woff2`),
].join("\n");

/* --- Phosphor icons → CSS mask data-URIs (only the glyphs actually used) ----
   Every `ph-<name>` class referenced in the HTML/JS is turned into a CSS custom
   property holding the inlined SVG. The shared `.ph` rule paints it with the
   current text colour, so icons inherit colour/size exactly like the webfont
   did — but with no network request. */
const usedIcons = [...new Set(
    [html, js].join("\n").match(/ph-[a-z0-9]+(?:-[a-z0-9]+)*/g) || []
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
    if (!existsSync(file)) {
        throw new Error(`Icon "ph-${name}" used but not found in @phosphor-icons/core.`);
    }
    const svg = readFileSync(file, "utf8");
    return `.ph-${name}{--ph:url("${svgToDataUri(svg)}")}`;
}).join("\n");

const iconBase =
    ".ph{display:inline-block;width:1em;height:1em;flex-shrink:0;vertical-align:-0.125em;" +
    "background-color:currentColor;-webkit-mask:var(--ph) center/contain no-repeat;" +
    "mask:var(--ph) center/contain no-repeat}";

const assetCss = `${fontCss}\n${iconBase}\n${iconRules}`;

/* --- Assemble the single-file output --------------------------------------- */
const styleTag = `<style>\n${css}\n${assetCss}\n</style>`;

// </script> inside an inlined script would close the tag early — escape it.
const esc = (s) => s.replace(/<\/script>/gi, "<\\/script>");

/* CRITICAL — template-engine safety.
   Rebecca renders this file through a template engine (pongo2 on the Go `dev`
   branch, Jinja2 on the legacy Python branch). Both treat `{{ }}`, `{% %}` and
   `{# #}` as directives. The inlined JS libraries legitimately contain such
   sequences (e.g. Alpine has a `{{…}}` inside an error-message template
   literal), which the engine would try to evaluate — crashing the render with
   an HTTP 502. pongo2 has no `{% raw %}`/`{% verbatim %}` we can rely on, and
   Rebecca even pre-normalizes whitespace inside `{{ }}`/`{% %}` before parsing.
   So we never let the engine SEE library code: each library is base64-encoded
   (alphabet [A-Za-z0-9+/=] — no brace sequences possible) and decoded + injected
   at runtime. The engine only ever sees the safe head bindings, the CSS, and the
   apps JSON (asserted brace-free below). */
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

// The apps list rides as a normal (brace-free) JSON literal so it's easy to read
// and is available before app.js runs. Guard the assumption at build time.
const appsLiteral = apps.trim();
if (/\{\{|\{%|\{#/.test(appsLiteral)) {
    throw new Error("apps.json contains a `{{`/`{%`/`{#` sequence that would break template rendering — base64-encode it too.");
}

const loaderScript =
    "(function(){function inject(b){var s=atob(b),n=s.length,a=new Uint8Array(n);" +
    "for(var i=0;i<n;i++)a[i]=s.charCodeAt(i);var e=document.createElement('script');" +
    "e.textContent=new TextDecoder('utf-8').decode(a);document.head.appendChild(e);}" +
    `inject(${JSON.stringify(b64(qrcodeLib))});` + // defines window.qrcode
    `inject(${JSON.stringify(b64(js))});` +        // defines window.aurora
    `inject(${JSON.stringify(b64(alpineLib))});` + // boots Alpine (finds window.aurora)
    "})();";

const scriptTag =
    `<script>window.AURORA_APPS = ${esc(appsLiteral)};</script>\n` +
    `<script>${loaderScript}</script>`;

const out = html
    .replace("<!--AURORA_INLINE_CSS-->", () => styleTag)
    .replace("<!--AURORA_INLINE_JS-->", () => scriptTag);

// Invariant: the ONLY template directives left in the output are the template's
// own bindings — nothing was injected that the engine could try to evaluate.
const finalPlaceholders = countPongo(out);
if (finalPlaceholders !== placeholders) {
    throw new Error(
        `Unexpected template directives after assembly ` +
        `(template had ${placeholders}, output has ${finalPlaceholders}). ` +
        `Inlined assets must not contain {{ }} / {% %} sequences.`
    );
}
const strayComments = (out.match(/\{#/g) || []).length - (html.match(/\{#/g) || []).length;
if (strayComments !== 0) {
    throw new Error(`Inlined assets introduced ${strayComments} stray {# template-comment sequence(s).`);
}

mkdirSync(r("dist"), { recursive: true });
writeFileSync(r("dist/index.html"), out, "utf8");

const kb = (Buffer.byteLength(out, "utf8") / 1024).toFixed(1);
console.log(
    `✓ dist/index.html written (${kb} KB, self-contained: ` +
    `${usedIcons.length} icons, fonts inlined, Alpine + qrcode base64-injected, ` +
    `${placeholders} template placeholders preserved)`
);
