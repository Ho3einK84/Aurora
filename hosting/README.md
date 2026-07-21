# Shared-hosting proxy for Aurora

These files let you serve the Aurora subscription page from a separate
cPanel-style PHP host while the real Rebecca panel stays where it is.

## What this is

Aurora is normally rendered **server-side by Rebecca** with pongo2 templating.
That means the built `dist/index.html` must physically exist on the Rebecca
server at the path configured under **Master Settings → Subscriptions**.

If your public domain is on shared hosting and you cannot place files directly
on the Rebecca server, or you simply want the subscription page to appear under
your own domain, you can install these PHP proxy files on the shared host. The
proxy forwards every request to Rebecca and returns the response as-is.

> **The proxy is not a replacement for Rebecca.** Rebecca still does the
> pongo2 rendering and serves `/info`, raw configs, and VPN downloads. The
> proxy only relays that traffic to a different public domain.

## Files

| File | Purpose |
|------|---------|
| `index.php` | Reverse proxy — forwards all traffic to Rebecca. |
| `config.php` | Panel URL, timeout, and SSL verification setting. |
| `.htaccess` | Apache rewrite rules that route every request to `index.php`. |

## Setup

1. On the **Rebecca server**, install `dist/index.html` as described in the main
   README (`Installation on Rebecca`). The subscription page must render there.

2. Copy these three files to the shared-hosting account's document root (or a
   subdirectory, e.g. `subscription/`):

   ```bash
   cp hosting/config.php /var/www/my-domain/subscription/config.php
   cp hosting/index.php  /var/www/my-domain/subscription/index.php
   cp hosting/.htaccess  /var/www/my-domain/subscription/.htaccess
   ```

   Make sure the leading dot on `.htaccess` is preserved; some file managers and
   zip tools strip it, and Apache will not load the file without the dot.

3. Edit `config.php` and set `panel_url` to the full URL of the Rebecca panel.

   ```php
   'panel_url' => 'https://panel.example.com:8443',
   ```

4. Ensure the host has:
   - PHP 7.0+ with the `curl` extension enabled.
   - Apache `mod_rewrite` enabled.
   - `AllowOverride All` (or at least `FileInfo`) for the directory so
     `.htaccess` is honored.

5. Visit the shared-hosting URL. The subscription page served by Rebecca should
   appear under your own domain.

## Configuration options

```php
return [
    'panel_url'  => 'https://panel.example.com:8443', // Rebecca base URL
    'timeout'    => 30,                               // cURL timeout in seconds
    'verify_ssl' => false,                            // set true in production
];
```

Set `verify_ssl` to `true` once the panel has a valid, publicly trusted
certificate. Disabling it is only appropriate for internal networks or
self-signed certificates.

## How requests flow

```
Client
  → your shared-hosting domain /subscription/...
    → index.php
      → Rebecca panel (panel_url)
        ← rendered HTML or JSON response
      ← forwarded back to the client
```

`Location` headers returned by Rebecca are rewritten to point back at your
shared-hosting domain, so users never see the panel's real URL.
