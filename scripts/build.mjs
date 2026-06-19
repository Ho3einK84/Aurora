#!/usr/bin/env node
/* ===========================================================================
   Aurora build step.
   Produces a SINGLE self-contained dist/index.html that Rebecca (pongo2) can
   render directly:
     • inlines the built Tailwind v4 + DaisyUI v5 CSS into <style>
     • inlines app.js (plus the default apps.json as window.AURORA_APPS)
     • keeps all {{ ... }} / {% ... %} pongo2 placeholders byte-for-byte intact
   CDN libs (Alpine, qrcode-generator) stay pinned in the <head>.
   =========================================================================== */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const r = (p) => resolve(root, p);

const html = readFileSync(r("src/index.html"), "utf8");
const css = readFileSync(r("build/app.css"), "utf8");
const js = readFileSync(r("src/app.js"), "utf8");
const apps = readFileSync(r("src/apps.json"), "utf8");

// Sanity check: the markers we replace must exist and be unique.
for (const marker of ["<!--AURORA_INLINE_CSS-->", "<!--AURORA_INLINE_JS-->"]) {
    const count = html.split(marker).length - 1;
    if (count !== 1) {
        throw new Error(`Expected exactly one "${marker}" in src/index.html, found ${count}.`);
    }
}

// Guard against accidentally trampling pongo2 tags during the build.
const placeholders = (html.match(/\{\{.*?\}\}|\{%.*?%\}/gs) || []).length;
if (placeholders === 0) {
    throw new Error("No pongo2 placeholders found — refusing to emit a template with no bindings.");
}

const styleTag = `<style>\n${css}\n</style>`;
// </script> inside an inlined script would close the tag early — escape it.
const safeApps = apps.replace(/<\/script>/gi, "<\\/script>");
const safeJs = js.replace(/<\/script>/gi, "<\\/script>");
const scriptTag =
    `<script>window.AURORA_APPS = ${safeApps.trim()};</script>\n` +
    `<script>\n${safeJs}\n</script>`;

const out = html
    .replace("<!--AURORA_INLINE_CSS-->", () => styleTag)
    .replace("<!--AURORA_INLINE_JS-->", () => scriptTag);

const finalPlaceholders = (out.match(/\{\{.*?\}\}|\{%.*?%\}/gs) || []).length;
if (finalPlaceholders !== placeholders) {
    throw new Error(`pongo2 placeholder count changed during build (${placeholders} → ${finalPlaceholders}).`);
}

mkdirSync(r("dist"), { recursive: true });
writeFileSync(r("dist/index.html"), out, "utf8");

const kb = (Buffer.byteLength(out, "utf8") / 1024).toFixed(1);
console.log(`✓ dist/index.html written (${kb} KB, ${placeholders} pongo2 placeholders preserved)`);
