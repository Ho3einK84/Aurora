<?php

/**
 * Shared-hosting proxy configuration for Aurora.
 *
 * This is a thin reverse proxy: it forwards every request to the real Rebecca
 * panel, which still renders dist/index.html server-side with pongo2 and serves
 * the subscription endpoints (/info, raw configs, .ovpn/.conf downloads, etc.).
 *
 * You MUST still place the built dist/index.html on the Rebecca server's
 * configured template path (see README.md "Installation on Rebecca"). This
 * proxy only makes that rendered output reachable from a separate public domain
 * hosted on cPanel-style PHP hosting; it does NOT replace Rebecca rendering.
 */

return [
    // Full URL of the Rebecca panel (including port if non-standard).
    // The proxy forwards every request to this address.
    'panel_url' => 'https://subdomin.example.com:port',

    // Max seconds to wait for a response from the panel.
    'timeout' => 30,

    // If true, SSL certs are verified (recommended for production).
    // Only disable for internal networks or self-signed certs.
    'verify_ssl' => false,
];
