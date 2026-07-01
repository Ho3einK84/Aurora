/* ===========================================================================
   Aurora QR module — wraps qrcode-generator and renders crisp, scalable SVG.

   This file is NOT bundled into app.js. The build compiles it as a separate
   ES module, embeds it as an inert base64 blob, and app.js decodes + imports
   it (via a Blob URL, no network) the first time a QR modal opens — so the
   ~20KB library never costs parse/execute time on page load.
   =========================================================================== */

import qrcode from "qrcode-generator";

/**
 * Build standalone <svg> markup for `text`.
 * @param {string} text payload to encode
 * @param {{ margin?: number, errorText?: string }} [opts]
 */
export function qrSvg(text, opts = {}) {
    const margin = opts.margin == null ? 2 : opts.margin;

    // typeNumber 0 auto-fits; "M" error correction balances density/resilience.
    // Payloads beyond QR version 40 make the library throw — show a legible
    // notice tile instead of crashing the modal.
    let qr;
    try {
        qr = qrcode(0, "M");
        qr.addData(String(text == null ? "" : text));
        qr.make();
    } catch (_) {
        return noticeSvg(opts.errorText || "Too long for QR");
    }

    const count = qr.getModuleCount();
    const size = count + margin * 2;
    let rects = "";
    for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
            if (qr.isDark(r, c)) {
                rects += `<rect x="${c + margin}" y="${r + margin}" width="1.02" height="1.02"/>`;
            }
        }
    }
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
        `shape-rendering="crispEdges" width="100%" height="100%">` +
        `<rect width="${size}" height="${size}" fill="#fff"/>` +
        `<g fill="#000">${rects}</g></svg>`
    );
}

/** Word-wrapped notice tile for payloads that exceed QR capacity. */
function noticeSvg(message) {
    const safe = String(message).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    const lines = [];
    let line = "";
    for (const w of safe.split(/\s+/)) {
        if ((line + " " + w).trim().length > 18 && line) { lines.push(line); line = w; }
        else line = (line + " " + w).trim();
    }
    if (line) lines.push(line);
    const shown = lines.slice(0, 3);
    const startY = 50 - (shown.length - 1) * 6;
    const tspans = shown.map((l, i) => `<tspan x="50" y="${startY + i * 12}">${l}</tspan>`).join("");
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">` +
        `<rect width="100" height="100" fill="#fff"/>` +
        `<text fill="#000" font-size="7" font-family="ui-monospace,monospace" font-weight="700" ` +
        `text-anchor="middle">${tspans}</text></svg>`
    );
}
